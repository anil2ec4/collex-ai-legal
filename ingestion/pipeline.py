"""Ingestion orchestration (brief 6.9):

    discover -> fetch raw -> immutable snapshot -> parse/normalize
    -> logical identity -> content hash/dedupe -> append version
    -> structural chunking -> lexical index -> embedding job -> publish

Transaction layout (per document)
---------------------------------
1. SNAPSHOT transaction (short, committed first): the immutable
   ``legal.source_snapshots`` row is an audit record of the fetch and
   must survive downstream parse/chunk/index failures. Raw-hash dedupe
   makes it idempotent.
2. PUBLISH transaction: identity resolution, version append (status
   'parsed'), chunk insertion, embedding-job enqueue and the final flip
   to status 'published' all happen in ONE transaction. A crash or
   exception anywhere inside it rolls the whole document back — a version
   is therefore either fully indexed+published or completely absent;
   half-indexed versions are never visible (brief 6.9: "Yeni version,
   indeksleri yarım halde kullanıcıya görünür yapmamalı").

Relations/resolver (brief 6.8) ARE written here, inside the SAME publish
transaction as the version and its chunks (``ingestion/relations.py``): an
amendment edge derived from a version's text is part of that version, and a
half-published edge would be a citator pointing at a document nobody can
see. Every edge carries its ``resolution_status`` / ``confidence`` /
``resolver_version``, and an edge that could not be resolved to a local
document is reported on the outcome instead of being dropped.

Failures are captured per document in the run report (the pipeline keeps
going); nothing failure-related is persisted beyond the snapshot, so a
re-run converges cleanly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Iterable, Sequence

import psycopg

from ingestion import (
    chunking,
    identity,
    indexer,
    jobs,
    relations,
    segments as segments_mod,
    snapshot,
    versioning,
)
from ingestion.chunking import Chunk
from ingestion.ports import ParsedDocument, SourcePort
from ingestion.relations import UnresolvedRelation

# Default embedding profiles (must match legal.embedding_profiles keys
# seeded by supabase/seed.sql; jobs are decoupled from the registry by
# design, workers re-validate the profile at claim time).
DEFAULT_EMBEDDING_PROFILES: tuple[str, ...] = (
    "bge-m3-1024-v1",
    "voyage-4-1024-v1",
)

ChunkFn = Callable[[ParsedDocument], Iterable[Chunk]]

#: libpq ``connect_timeout`` (seconds) applied to EVERY local connection this
#: package and ``intake`` open. Without it a refused or black-holed loopback
#: port left psycopg waiting for minutes (Windows TCP retransmit schedule)
#: while the HTTP caller showed an empty error; the intake CLI must answer
#: within ~6 s so the API can map it to a typed 503 (contract [X]).
CONNECT_TIMEOUT_S = 5


def connect_local(dsn: str, **kwargs) -> psycopg.Connection:
    """``psycopg.connect`` with a bounded connect timeout.

    DSN semantics are untouched: the string goes to psycopg verbatim. A
    ``connect_timeout`` already present in the DSN (or passed explicitly)
    wins; only when neither carries one is ``CONNECT_TIMEOUT_S`` applied.
    """
    if "connect_timeout" not in kwargs:
        params = psycopg.conninfo.conninfo_to_dict(dsn)
        if "connect_timeout" not in params:
            kwargs["connect_timeout"] = CONNECT_TIMEOUT_S
    return psycopg.connect(dsn, **kwargs)


@dataclass(frozen=True)
class DocumentOutcome:
    external_id: str
    action: str  # 'published' | 'unchanged' | 'reverted_content' | 'failed'
    document_id: str | None = None
    version_id: str | None = None
    snapshot_created: bool = False
    chunks_inserted: int = 0
    jobs_enqueued: int = 0
    error: str | None = None
    #: Exception class name behind ``error`` (additive). Lets a caller tell a
    #: dead database connection (``OperationalError``) apart from a document
    #: problem without parsing the message.
    error_type: str | None = None
    #: legal.document_relations rows written for this version.
    relations_written: int = 0
    #: ...of which the resolver decided without ambiguity.
    relations_resolved: int = 0
    #: Amendment edges the source claimed that could NOT be stored. Never
    #: silent: a citator that quietly loses an edge answers "no instrument
    #: amended this provision" when the truth is "we failed to look".
    relations_unresolved: tuple[UnresolvedRelation, ...] = ()


@dataclass
class PipelineResult:
    outcomes: list[DocumentOutcome] = field(default_factory=list)

    def _count(self, action: str) -> int:
        return sum(1 for o in self.outcomes if o.action == action)

    @property
    def published(self) -> int:
        return self._count("published")

    @property
    def unchanged(self) -> int:
        return self._count("unchanged")

    @property
    def reverted(self) -> int:
        """Upstream text returned to a previously seen (closed) version."""
        return self._count("reverted_content")

    @property
    def failed(self) -> int:
        return self._count("failed")

    @property
    def snapshots_created(self) -> int:
        return sum(1 for o in self.outcomes if o.snapshot_created)

    @property
    def total_chunks(self) -> int:
        return sum(o.chunks_inserted for o in self.outcomes)

    @property
    def total_jobs(self) -> int:
        return sum(o.jobs_enqueued for o in self.outcomes)

    @property
    def total_relations(self) -> int:
        return sum(o.relations_written for o in self.outcomes)

    @property
    def unresolved_relations(self) -> list[tuple[str, UnresolvedRelation]]:
        """(external_id, edge) for every amendment edge that was not stored."""
        return [
            (o.external_id, edge)
            for o in self.outcomes
            for edge in o.relations_unresolved
        ]


def _chunk_ids_by_article(
    conn: psycopg.Connection, version_id: str
) -> dict[str, str]:
    """article_no -> the chunk carrying it (lowest ordinal wins).

    An article split across fıkra chunks is represented by its FIRST chunk,
    which is the one carrying the "MADDE n -" header and therefore the
    passage a reader is shown when asked "what did this instrument change?".
    """
    rows = conn.execute(
        "select article_no, id::text from legal.chunks"
        " where document_version_id = %s and article_no is not null"
        " order by ordinal desc",
        (version_id,),
    ).fetchall()
    # Descending ordinal, so the last write per article is the lowest ordinal.
    return {str(article): str(chunk_id) for article, chunk_id in rows}


class Pipeline:
    def __init__(
        self,
        dsn: str,
        source: SourcePort,
        *,
        embedding_profiles: Sequence[str] = DEFAULT_EMBEDDING_PROFILES,
        chunk_fn: ChunkFn | None = None,
    ) -> None:
        self.dsn = dsn
        self.source = source
        self.embedding_profiles = tuple(embedding_profiles)
        # Injectable for tests (publish-atomicity fault injection).
        self.chunk_fn: ChunkFn = chunk_fn or chunking.iter_chunks

    def run(self) -> PipelineResult:
        result = PipelineResult()
        with connect_local(self.dsn) as conn:
            for ref in self.source.list_documents():
                try:
                    outcome = self._ingest_one(conn, ref)
                except Exception as exc:  # noqa: BLE001 - per-doc isolation
                    conn.rollback()
                    outcome = DocumentOutcome(
                        external_id=ref.external_id,
                        action="failed",
                        error=f"{type(exc).__name__}: {exc}",
                        error_type=type(exc).__name__,
                    )
                result.outcomes.append(outcome)
        return result

    def _ingest_one(self, conn: psycopg.Connection, ref) -> DocumentOutcome:
        fetch = self.source.fetch_raw(ref)
        parsed = self.source.parse(fetch)

        # --- snapshot transaction (committed before anything else) -------
        snap = snapshot.ensure_snapshot(conn, source=parsed.source,
                                        fetch=fetch)
        conn.commit()

        # --- publish transaction -----------------------------------------
        doc = identity.resolve_document(
            conn,
            source=parsed.source,
            external_id=parsed.external_id,
            document_type=parsed.document_type,
            scope=parsed.scope,
            tenant_id=parsed.tenant_id,
            title=parsed.title,
            canonical_source_url=parsed.retrieved_url,
        )
        content_hash = versioning.content_sha256(parsed.canonical_text)
        existing = versioning.find_version_by_hash(
            conn, doc.document_id, content_hash
        )
        if existing is not None:
            conn.commit()
            return DocumentOutcome(
                external_id=parsed.external_id,
                action="unchanged" if existing.is_current
                else "reverted_content",
                document_id=doc.document_id,
                version_id=existing.version_id,
                snapshot_created=snap.created,
            )

        version_id = versioning.append_version(
            conn,
            document_id=doc.document_id,
            snapshot_id=snap.snapshot_id,
            parsed=parsed,
            content_hash=content_hash,
            status="parsed",
        )
        n_chunks = indexer.insert_chunks(conn, version_id,
                                         self.chunk_fn(parsed))
        if n_chunks <= 0:
            raise RuntimeError(
                f"chunker produced no chunks for {parsed.external_id}"
            )
        # Source locators (W19 phase A), in the SAME transaction as the text
        # they were measured against: a version can never be published with
        # a half-written page map. Sources that produce no map (every corpus
        # fetcher today) write nothing and the document simply has none.
        segments_mod.insert_segments(
            conn,
            version_id,
            segments_mod.segments_from_hints(parsed.structure_hints),
        )
        n_jobs = jobs.enqueue_embedding_jobs(
            conn, version_id=version_id, profiles=self.embedding_profiles
        )
        # Amendment edges, in the same transaction as the text they were
        # derived from (see relations.py). The chunk map lets an edge point at
        # the exact passage that made the change.
        rel = relations.write_amendment_relations(
            conn,
            document_version_id=version_id,
            amending_legislation_no=parsed.structure_hints.get("legislation_no"),
            structure_hints=parsed.structure_hints,
            chunk_ids_by_article=_chunk_ids_by_article(conn, version_id),
        )
        versioning.mark_published(conn, version_id)
        conn.commit()
        return DocumentOutcome(
            external_id=parsed.external_id,
            action="published",
            document_id=doc.document_id,
            version_id=version_id,
            snapshot_created=snap.created,
            chunks_inserted=n_chunks,
            jobs_enqueued=n_jobs,
            relations_written=rel.written,
            relations_resolved=rel.resolved,
            relations_unresolved=tuple(rel.unresolved),
        )
