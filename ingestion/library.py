"""Yerel kütüphane yayımlayıcısı — the spool reader half of B-20 (ADR-027).

WHAT THIS CLOSES
----------------
Until now every FULL TEXT a live research run fetched was thrown away when
the run ended: ``collex_local`` carried 0 public documents and 0 chunks, so
the Turkish FTS lane, the citator lane and the as-of engine had nothing to
work on, and the same question asked twice went to the network twice.
``control-plane/src/sources/localLibrary.ts`` writes half the fix — every
fetched document lands in a durable SPOOL directory as one
``collex.library.document/v1`` envelope, deduplicated by identity + content
hash. This module is the other half: it READS that spool and publishes the
envelopes through the EXISTING ingestion pipeline.

WHY PYTHON AND NOT TYPESCRIPT. The corpus contract lives here:
``ingestion/identity.py`` (logical identity), ``ingestion/versioning.py``
(temporal close-on-append, ADR-012), ``ingestion/chunking.py``
(non-overlapping chunks, ADR-013) and ``ingestion/relations.py`` (citator
edges). Re-implementing any of them in the control plane would give ONE
document TWO identities depending on which runtime wrote it — precisely the
defect ADR-013 exists to prevent. So nothing here re-derives identity,
versioning or chunking: it builds a ``SourcePort`` and hands it to
``ingestion.pipeline.Pipeline``, the same object the fixture corpus and the
tenant uploads go through.

FOUR PROPERTIES THAT ARE NOT NEGOTIABLE
---------------------------------------
1. **An unknown envelope is REJECTED, never silently skipped.** A spool file
   whose ``schema`` this reader does not know, whose declared code-point
   length disagrees with its text, or whose ``contentSha256`` does not
   re-derive from the text it carries, is reported by NAME with a machine
   code. A silent skip in an ingestion pipeline is a correctness hazard:
   "the document is not in the library" and "the document was dropped during
   discovery" look identical downstream. (Same reasoning as the
   ``FixtureSource`` discovery fix of 2026-08-27.)
2. **A published envelope is marked and never processed again.** On success
   the file is MOVED to ``<spool>/yayimlandi/``. It is not deleted: the
   lawyer's fetched text is the thing this whole lane exists to keep.
3. **A failed envelope is never deleted.** It stays exactly where it is,
   with its error reported, so the next run retries it and nothing is lost.
4. **Partial success does not lie.** The report carries how many envelopes
   were published, how many were already in the library, and how many
   failed — with the sub-counts (rejected envelope vs. pipeline failure)
   kept apart, because a malformed file and a dead database are different
   problems with different fixes.

SYNTHETIC VS. REAL — THE MARK SURVIVES
---------------------------------------
The fixture corpus writes ``source: "fixture-*"`` and ``_meta.synthetic:
true``. A spooled document is the opposite of that and says so in the row
itself: ``source`` is the PROVIDER family (BEDESTEN, MEVZUAT, …), and the
version's ``metadata.fixture_meta`` carries ``synthetic: false`` plus
``origin_label: "resmî kaynak"`` and the full fetch provenance. A ``source``
beginning with ``fixture-`` is REFUSED here, so a synthetic file can never
enter the library through this door and the two can always be told apart in
one query even when they share a database.

WHAT THIS MODULE DOES NOT DO
----------------------------
It measures no quality, promises no coverage and computes no percentage. It
moves text the lawyer already fetched from a temporary folder into their own
database, with provenance intact.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import psycopg

from ingestion.pipeline import DEFAULT_EMBEDDING_PROFILES, Pipeline, connect_local
from ingestion.ports import DocumentRef, ParsedDocument, RawFetch

__all__ = [
    "LIBRARY_DATABASES",
    "LIBRARY_MEDIA_TYPE",
    "LIBRARY_ORIGIN_LABEL",
    "LIBRARY_RECORD_SCHEMA",
    "LIBRARY_SCOPE",
    "PUBLISHED_SUBDIR",
    "DatabaseNameRefused",
    "LibraryPublishReport",
    "LibraryRecord",
    "LibraryRecordError",
    "LibrarySpoolSource",
    "parse_library_record",
    "publish_library",
    "read_spool",
    "spool_files",
]

#: Envelope this reader understands. Anything else is REJECTED (never
#: skipped). Mirrors ``LIBRARY_RECORD_SCHEMA`` in
#: ``control-plane/src/sources/localLibrary.ts``.
LIBRARY_RECORD_SCHEMA = "collex.library.document/v1"

#: Every spooled document is public corpus. A tenant upload never comes
#: through this door — those have their own path (``intake/ingest.py``) with
#: their own scope, and mixing the two would put a client's document into the
#: shared library.
LIBRARY_SCOPE = "public"

#: The provenance label the writer asserts on every envelope. Never
#: "(SENTETİK)" — for a lawyer that word reads as "this system invents
#: decisions" (TRMARKET).
LIBRARY_ORIGIN_LABEL = "resmî kaynak"

#: Media type the control plane writes. Kept as a constant so a future
#: envelope version that adds one is a REJECTION here rather than a surprise.
LIBRARY_MEDIA_TYPE = "text/markdown"

#: Where a successfully published envelope is moved to. It is MOVED, never
#: deleted: this directory is the lawyer's own copy of what they fetched.
PUBLISHED_SUBDIR = "yayimlandi"

#: Databases this publisher will write to. Same posture as
#: ``intake.cli.ENSURABLE_DBS``: the persistent local product store and this
#: lane's scratch database, nothing else. It exists so a mistyped DSN cannot
#: reach a real database, and so a test database can never be handed
#: production text by accident.
LIBRARY_DATABASES = ("collex_local", "collex_ingest_test")

#: Source names beginning with this are the SYNTHETIC fixture corpus
#: (``evals/fixtures/corpus``). They must never enter the library.
SYNTHETIC_SOURCE_PREFIX = "fixture-"

#: Provider families whose full text is legislation, and whose chunker is
#: therefore the madde/fıkra one. Matched on the UPPERCASED provider name.
LEGISLATION_SOURCES = frozenset({
    "MEVZUAT", "KANUN", "KHK", "TUZUK", "YONETMELIK", "CBYONETMELIK",
    "KURUM_YONETMELIK", "TEBLIG", "CBK", "CBKARAR", "CBGENELGE",
})

#: Provider families whose full text is a decision (ÖZET/OLAY/GEREKÇE/HÜKÜM).
DECISION_SOURCES = frozenset({
    "BEDESTEN", "EMSAL", "YARGITAY", "DANISTAY", "UYUSMAZLIK", "ANAYASA",
    "AYM", "KIK", "REKABET", "SAYISTAY", "KVKK", "BDDK", "BTK", "GIB",
    "GIB_OZELGE", "SIGORTA_TAHKIM",
})

#: (chunker kind, legal.documents.document_type) per family. An unknown
#: provider gets the GENERIC chunker rather than a guess: both other chunkers
#: already fall back to it when their structure is absent, so the wrong guess
#: costs nothing here but a wrong document_type would mislabel the row.
_GENERIC_KIND = ("generic", "belge")


class LibraryRecordError(ValueError):
    """One spool envelope this reader refuses, with a machine code.

    ``code`` is stable and testable; ``message`` is the operator sentence.
    Both are reported — a rejected envelope is always named.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class DatabaseNameRefused(ValueError):
    """The DSN names a database this publisher will not write to."""


@dataclass(frozen=True)
class LibraryRecord:
    """One validated ``collex.library.document/v1`` envelope."""

    path: Path
    #: Spool file stem: ``provider__externalId__sha256[0:16]``.
    key: str
    source: str
    external_id: str
    title: str | None
    source_url: str | None
    tool_name: str | None
    fetched_at: str
    text: str
    content_sha256: str
    content_code_points: int
    media_type: str
    run_id: str | None
    #: The envelope's own bytes — what the snapshot table records as the raw
    #: fetch artifact.
    raw_bytes: bytes

    @property
    def chunker_kind(self) -> str:
        return _family(self.source)[0]

    @property
    def document_type(self) -> str:
        return _family(self.source)[1]

    @property
    def retrieved_at(self) -> datetime:
        return _parse_iso(self.fetched_at)

    def parsed_document(self) -> ParsedDocument:
        """The ingestion-ready document. No identity/versioning logic here."""
        kind, document_type = _family(self.source)
        return ParsedDocument(
            source=self.source,
            external_id=self.external_id,
            document_type=document_type,
            title=self.title,
            retrieved_url=self.source_url,
            media_type=self.media_type,
            # Already validated NFC and CR-free, so the version's
            # content_sha256 equals the envelope's contentSha256 exactly.
            canonical_text=self.text,
            # Deliberately EMPTY. The envelope carries a FETCH time, not a
            # decision, publication or commencement date, and inventing an
            # effective_period from a download timestamp would put a false
            # as-of answer into the temporal engine.
            dates={},
            structure_hints={"kind": kind},
            meta={
                "scope": LIBRARY_SCOPE,
                # The mark that survives into legal.document_versions.metadata
                # -> fixture_meta, so one query separates the real library
                # from the synthetic corpus even in a shared database.
                "synthetic": False,
                "origin_label": LIBRARY_ORIGIN_LABEL,
                "library": {
                    "schema": LIBRARY_RECORD_SCHEMA,
                    "key": self.key,
                    "spool_file": self.path.name,
                    "tool_name": self.tool_name,
                    "fetched_at": self.fetched_at,
                    "source_url": self.source_url,
                    "content_sha256": self.content_sha256,
                    "content_code_points": self.content_code_points,
                    "run_id": self.run_id,
                    "chunker_kind": kind,
                },
            },
        )


@dataclass(frozen=True)
class RejectedEnvelope:
    """A file the reader refused BEFORE any database work."""

    path: str
    code: str
    message: str

    def to_json_dict(self) -> dict[str, Any]:
        return {"path": self.path, "code": self.code, "message": self.message}


@dataclass(frozen=True)
class PublishedEnvelope:
    """A file the pipeline accepted (published / already present)."""

    path: str
    key: str
    source: str
    external_id: str
    #: 'published' | 'unchanged' | 'reverted_content' (pipeline vocabulary).
    action: str
    document_id: str | None = None
    version_id: str | None = None
    chunks: int = 0
    relations: int = 0
    #: Where the envelope was moved to, or None in --dry-run.
    moved_to: str | None = None

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "key": self.key,
            "source": self.source,
            "externalId": self.external_id,
            "action": self.action,
            "documentId": self.document_id,
            "versionId": self.version_id,
            "chunks": self.chunks,
            "relations": self.relations,
            "movedTo": self.moved_to,
        }


@dataclass(frozen=True)
class FailedEnvelope:
    """A valid envelope the pipeline could not publish. NEVER deleted."""

    path: str
    key: str
    source: str
    external_id: str
    error: str
    error_type: str | None = None

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "key": self.key,
            "source": self.source,
            "externalId": self.external_id,
            "error": self.error,
            "errorType": self.error_type,
        }


@dataclass
class LibraryPublishReport:
    """Counts that do not lie about a partial run."""

    spool_dir: str
    dry_run: bool = False
    scanned: int = 0
    rejected: list[RejectedEnvelope] = field(default_factory=list)
    accepted: list[PublishedEnvelope] = field(default_factory=list)
    failures: list[FailedEnvelope] = field(default_factory=list)

    def _count(self, action: str) -> int:
        return sum(1 for entry in self.accepted if entry.action == action)

    @property
    def published(self) -> int:
        """Envelopes that produced a NEW version in the library."""
        return self._count("published")

    @property
    def unchanged(self) -> int:
        """Envelopes whose text was already the CURRENT version."""
        return self._count("unchanged")

    @property
    def reverted(self) -> int:
        """Envelopes whose text matched an older, already-closed version."""
        return self._count("reverted_content")

    @property
    def skipped(self) -> int:
        """Already in the library — nothing was written for these."""
        return self.unchanged + self.reverted

    @property
    def failed(self) -> int:
        """Everything that did not land: bad envelopes AND pipeline errors."""
        return len(self.rejected) + len(self.failures)

    @property
    def moved(self) -> int:
        return sum(1 for entry in self.accepted if entry.moved_to is not None)

    @property
    def chunks(self) -> int:
        return sum(entry.chunks for entry in self.accepted)

    @property
    def relations(self) -> int:
        return sum(entry.relations for entry in self.accepted)

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "spoolDir": self.spool_dir,
            "dryRun": self.dry_run,
            "scanned": self.scanned,
            # The three numbers the operator is owed, always all three.
            "published": self.published,
            "skipped": self.skipped,
            "failed": self.failed,
            # ...and the sub-counts, because a malformed file and a dead
            # database are different problems with different fixes.
            "unchanged": self.unchanged,
            "reverted": self.reverted,
            "rejected": len(self.rejected),
            "pipelineFailed": len(self.failures),
            "moved": self.moved,
            "chunks": self.chunks,
            "relations": self.relations,
            "documents": [entry.to_json_dict() for entry in self.accepted],
            "rejectedEnvelopes": [e.to_json_dict() for e in self.rejected],
            "failures": [entry.to_json_dict() for entry in self.failures],
        }


# --------------------------------------------------------------------------
# Envelope validation
# --------------------------------------------------------------------------


def _require_str(obj: dict[str, Any], name: str) -> str:
    if name not in obj:
        raise LibraryRecordError(
            f"MISSING_FIELD:{name}", f"zarfta '{name}' alanı yok"
        )
    value = obj[name]
    if not isinstance(value, str):
        raise LibraryRecordError(
            f"WRONG_TYPE:{name}",
            f"'{name}' metin olmalı, {type(value).__name__} geldi",
        )
    return value


def _optional_str(obj: dict[str, Any], name: str) -> str | None:
    value = obj.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise LibraryRecordError(
            f"WRONG_TYPE:{name}",
            f"'{name}' metin olmalı, {type(value).__name__} geldi",
        )
    return value or None


def parse_library_record(raw: bytes | str, path: Path | str) -> LibraryRecord:
    """Validate one spool envelope or raise :class:`LibraryRecordError`.

    Every check here exists because its absence would let a WRONG document
    into the lawyer's library under a RIGHT-looking künye. In particular the
    content hash is RE-DERIVED from the text rather than trusted: the
    envelope's ``contentSha256`` is what a later citation will be checked
    against, so if the two ever disagree the citation would verify against a
    hash of text nobody has.
    """
    path = Path(path)
    raw_bytes = raw.encode("utf-8") if isinstance(raw, str) else raw
    try:
        text_form = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise LibraryRecordError(
            "NOT_UTF8", f"dosya UTF-8 değil ({exc.reason})"
        ) from exc
    try:
        value = json.loads(text_form)
    except json.JSONDecodeError as exc:
        raise LibraryRecordError(
            "INVALID_JSON", f"JSON çözümlenemedi ({exc.msg}, satır {exc.lineno})"
        ) from exc
    if not isinstance(value, dict):
        raise LibraryRecordError(
            "NOT_AN_OBJECT",
            f"zarf bir JSON nesnesi olmalı, {type(value).__name__} geldi",
        )

    # Unknown envelope -> REFUSED. Not skipped, not guessed at.
    schema = value.get("schema")
    if schema != LIBRARY_RECORD_SCHEMA:
        raise LibraryRecordError(
            "UNKNOWN_SCHEMA",
            f"bilinmeyen kayıt şeması {schema!r};"
            f" beklenen {LIBRARY_RECORD_SCHEMA!r}",
        )

    scope = _require_str(value, "scope")
    if scope != LIBRARY_SCOPE:
        raise LibraryRecordError(
            "WRONG_SCOPE",
            f"kütüphane yalnız {LIBRARY_SCOPE!r} kapsamı yayımlar,"
            f" {scope!r} geldi",
        )
    origin = _require_str(value, "originLabel")
    if origin != LIBRARY_ORIGIN_LABEL:
        raise LibraryRecordError(
            "WRONG_ORIGIN_LABEL",
            f"köken etiketi {LIBRARY_ORIGIN_LABEL!r} olmalı, {origin!r} geldi",
        )
    media_type = _require_str(value, "mediaType")
    if media_type != LIBRARY_MEDIA_TYPE:
        raise LibraryRecordError(
            "UNKNOWN_MEDIA_TYPE",
            f"bu okuyucu yalnız {LIBRARY_MEDIA_TYPE!r} tanır,"
            f" {media_type!r} geldi",
        )

    source = _require_str(value, "source").strip()
    if not source:
        raise LibraryRecordError("EMPTY_SOURCE", "'source' boş")
    if source.lower().startswith(SYNTHETIC_SOURCE_PREFIX):
        # The synthetic corpus and the real library must never share a door.
        raise LibraryRecordError(
            "SYNTHETIC_SOURCE",
            f"{source!r} sentetik fikstür korpusunun ön ekini taşıyor;"
            " kütüphane yalnız resmî kaynak yayımlar",
        )
    external_id = _require_str(value, "externalId").strip()
    if not external_id:
        raise LibraryRecordError("EMPTY_EXTERNAL_ID", "'externalId' boş")

    text = _require_str(value, "text")
    if not text.strip():
        raise LibraryRecordError("EMPTY_TEXT", "belge metni boş")
    if "\r" in text:
        raise LibraryRecordError(
            "TEXT_NOT_CANONICAL",
            "metin CR taşıyor; kanonik biçim yalnız '\\n' kullanır",
        )
    if unicodedata.normalize("NFC", text) != text:
        raise LibraryRecordError(
            "TEXT_NOT_CANONICAL",
            "metin NFC değil; ofsetler ve karma kanonik metin üzerinden"
            " tanımlıdır (ADR-003)",
        )

    declared_points = value.get("contentCodePoints")
    if not isinstance(declared_points, int) or isinstance(declared_points, bool):
        raise LibraryRecordError(
            "WRONG_TYPE:contentCodePoints",
            "'contentCodePoints' tam sayı olmalı",
        )
    actual_points = len(text)
    if declared_points != actual_points:
        raise LibraryRecordError(
            "CODEPOINT_MISMATCH",
            f"bildirilen uzunluk {declared_points}, gerçek uzunluk"
            f" {actual_points} kod noktası",
        )

    declared_hash = _require_str(value, "contentSha256").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", declared_hash):
        raise LibraryRecordError(
            "WRONG_TYPE:contentSha256",
            "'contentSha256' 64 haneli onaltılık sha256 olmalı",
        )
    # Re-derived, never trusted (see docstring).
    actual_hash = _content_sha256(text)
    if declared_hash != actual_hash:
        raise LibraryRecordError(
            "CONTENT_HASH_MISMATCH",
            f"bildirilen içerik özeti {declared_hash[:16]}…,"
            f" metinden hesaplanan {actual_hash[:16]}…",
        )

    fetched_at = _require_str(value, "fetchedAt").strip()
    if not fetched_at:
        raise LibraryRecordError("EMPTY_FETCHED_AT", "'fetchedAt' boş")

    return LibraryRecord(
        path=path,
        key=path.stem,
        source=source,
        external_id=external_id,
        title=_optional_str(value, "title"),
        source_url=_optional_str(value, "sourceUrl"),
        tool_name=_optional_str(value, "toolName"),
        fetched_at=fetched_at,
        text=text,
        content_sha256=declared_hash,
        content_code_points=actual_points,
        media_type=media_type,
        run_id=_optional_str(value, "runId"),
        raw_bytes=raw_bytes,
    )


def _content_sha256(text: str) -> str:
    """sha256 over the UTF-8 bytes of the canonical text (ADR-003).

    Imported from ``versioning`` rather than re-implemented so the library
    and the version row can never disagree about what a content hash is.
    """
    from ingestion import versioning

    return versioning.content_sha256(text)


def _normalize_family(source: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", source).strip("_").upper()


def _family(source: str) -> tuple[str, str]:
    """(chunker kind, document_type) for a provider family."""
    name = _normalize_family(source)
    if name in LEGISLATION_SOURCES:
        return ("legislation", "mevzuat")
    if name in DECISION_SOURCES:
        return ("decision", "karar")
    return _GENERIC_KIND


def _parse_iso(value: str) -> datetime:
    """``fetchedAt`` as an aware datetime; unparseable falls back to now.

    A malformed timestamp is not a reason to lose the document — the exact
    string is preserved verbatim in the version metadata either way.
    """
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


# --------------------------------------------------------------------------
# Spool discovery
# --------------------------------------------------------------------------


def spool_files(spool_dir: Path | str) -> list[Path]:
    """Envelope files awaiting publication, sorted, NON-recursive.

    Non-recursive on purpose: ``<spool>/yayimlandi/`` holds what has already
    been published, and walking into it would re-process the whole library on
    every run.
    """
    directory = Path(spool_dir)
    if not directory.is_dir():
        return []
    return sorted(
        path for path in directory.glob("*.json")
        if path.is_file()
    )


def read_spool(
    spool_dir: Path | str,
) -> tuple[list[LibraryRecord], list[RejectedEnvelope]]:
    """Validate every envelope in the spool. Reads only; writes nothing.

    Records are returned in FETCH order (then key), because two envelopes for
    one logical document are two VERSIONS and the version machinery can only
    append them oldest-first.
    """
    records: list[LibraryRecord] = []
    rejected: list[RejectedEnvelope] = []
    for path in spool_files(spool_dir):
        try:
            raw = path.read_bytes()
        except OSError as exc:
            rejected.append(RejectedEnvelope(
                path=str(path),
                code="UNREADABLE",
                message=f"dosya okunamadı ({type(exc).__name__}: {exc})",
            ))
            continue
        try:
            records.append(parse_library_record(raw, path))
        except LibraryRecordError as exc:
            rejected.append(RejectedEnvelope(
                path=str(path), code=exc.code, message=exc.message
            ))
    records.sort(key=lambda record: (record.fetched_at, record.key))
    return records, rejected


class LibrarySpoolSource:
    """``SourcePort`` over already-validated spool records.

    It adds nothing: no identity, no hashing, no chunking decision beyond
    naming the family whose chunker applies. Everything downstream is the
    existing pipeline.
    """

    def __init__(self, records: Sequence[LibraryRecord]) -> None:
        self._records = list(records)
        # Keyed by locator: two records may share an external_id (two
        # versions of one document), so the external id alone is not a key.
        self._by_locator = {str(r.path): r for r in self._records}

    @property
    def source_name(self) -> str:
        return "collex-library-spool"

    @property
    def records(self) -> tuple[LibraryRecord, ...]:
        return tuple(self._records)

    def list_documents(self) -> Iterable[DocumentRef]:
        for record in self._records:
            yield DocumentRef(
                external_id=record.external_id, locator=str(record.path)
            )

    def _record(self, ref: DocumentRef) -> LibraryRecord:
        record = self._by_locator.get(ref.locator)
        if record is None:  # pragma: no cover - refs come from this class
            raise KeyError(f"unknown spool locator {ref.locator!r}")
        return record

    def fetch_raw(self, ref: DocumentRef) -> RawFetch:
        record = self._record(ref)
        return RawFetch(
            ref=ref,
            # The envelope's own bytes ARE the fetch artifact we hold; the
            # snapshot table dedupes on their hash.
            raw_bytes=record.raw_bytes,
            retrieved_url=record.source_url,
            final_url=record.source_url,
            media_type=record.media_type,
            http_status=None,
            retrieved_at=record.retrieved_at,
        )

    def parse(self, fetch: RawFetch) -> ParsedDocument:
        return self._record(fetch.ref).parsed_document()


# --------------------------------------------------------------------------
# Publication
# --------------------------------------------------------------------------


def _dbname(dsn: str) -> str:
    return psycopg.conninfo.conninfo_to_dict(dsn).get("dbname") or ""


def assert_library_database(dsn: str) -> str:
    """Refuse every database name but the two this lane owns."""
    name = _dbname(dsn)
    if name not in LIBRARY_DATABASES:
        raise DatabaseNameRefused(
            f"kütüphane yayımı {name!r} veritabanını kabul etmez;"
            f" izin verilen adlar: {', '.join(LIBRARY_DATABASES)}"
        )
    return name


def _mark_published(record: LibraryRecord, spool_dir: Path) -> str | None:
    """Move a landed envelope into ``yayimlandi/``. Never deletes."""
    target_dir = spool_dir / PUBLISHED_SUBDIR
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / record.path.name
        # os.replace is atomic; an identical key means identical content, so
        # overwriting an earlier copy loses nothing.
        os.replace(record.path, target)
        return str(target)
    except OSError:
        # The document IS published; failing to move it only means the next
        # run will see it again and answer "unchanged". That is a wasted
        # pass, not a lost document, so it is not an error.
        return None


def _existing_action(
    conn: psycopg.Connection, record: LibraryRecord
) -> str | None:
    """Read-only classification used by --dry-run. Writes nothing."""
    row = conn.execute(
        "select v.id, upper_inf(v.system_period)"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = %s and d.external_id = %s"
        "   and d.tenant_id is null and v.content_sha256 = %s",
        (record.source, record.external_id, record.content_sha256),
    ).fetchone()
    if row is None:
        return None
    return "unchanged" if row[1] else "reverted_content"


def publish_library(
    spool_dir: Path | str,
    dsn: str,
    *,
    dry_run: bool = False,
    embedding_profiles: Sequence[str] = DEFAULT_EMBEDDING_PROFILES,
) -> LibraryPublishReport:
    """Read the spool and publish it through the existing pipeline.

    ``dry_run`` is strictly read-only: envelopes are validated, the database
    is QUERIED to say which of them are already present, and nothing is
    written, moved or created.
    """
    spool_dir = Path(spool_dir)
    assert_library_database(dsn)

    records, rejected = read_spool(spool_dir)
    report = LibraryPublishReport(
        spool_dir=str(spool_dir),
        dry_run=dry_run,
        scanned=len(records) + len(rejected),
        rejected=rejected,
    )
    if not records:
        return report

    if dry_run:
        with connect_local(dsn) as conn:
            for record in records:
                action = _existing_action(conn, record)
                report.accepted.append(PublishedEnvelope(
                    path=str(record.path),
                    key=record.key,
                    source=record.source,
                    external_id=record.external_id,
                    action=action or "published",
                ))
            conn.rollback()
        return report

    source = LibrarySpoolSource(records)
    result = Pipeline(dsn, source, embedding_profiles=embedding_profiles).run()

    # The pipeline appends exactly one outcome per ref, in discovery order —
    # so the correlation is POSITIONAL. It cannot be by external_id: two
    # envelopes of one document share it, which is the whole versioning case.
    if len(result.outcomes) != len(records):  # pragma: no cover - contract
        raise RuntimeError(
            f"pipeline returned {len(result.outcomes)} outcomes for"
            f" {len(records)} envelopes"
        )

    for record, outcome in zip(records, result.outcomes):
        if outcome.action == "failed":
            # NOT deleted, NOT moved: it stays for the next run.
            report.failures.append(FailedEnvelope(
                path=str(record.path),
                key=record.key,
                source=record.source,
                external_id=record.external_id,
                error=outcome.error or "bilinmeyen hata",
                error_type=outcome.error_type,
            ))
            continue
        report.accepted.append(PublishedEnvelope(
            path=str(record.path),
            key=record.key,
            source=record.source,
            external_id=record.external_id,
            action=outcome.action,
            document_id=outcome.document_id,
            version_id=outcome.version_id,
            chunks=outcome.chunks_inserted,
            relations=outcome.relations_written,
            moved_to=_mark_published(record, spool_dir),
        ))
    return report


# --------------------------------------------------------------------------
# Module entry point — ``python -m ingestion.library``
# --------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """``python -m ingestion.library --dsn <dsn> --dir <spool> [--dry-run] [--json]``.

    This is the SAME lane as ``python -m ingestion.cli --publish-library``:
    the arguments are re-spelled and forwarded, so there is exactly one
    publication path, one database-name gate and one typed
    ``STORE_UNAVAILABLE``. The control plane's ``POST /v1/library/ingest``
    spawns this entry point with ``--json`` and reads the report from stdout;
    stderr never reaches an HTTP body (it is logged under a correlation id).
    """
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m ingestion.library",
        description="Publish queued collex.library.document/v1 envelopes into"
                    " the local library (collex_local / collex_ingest_test).",
    )
    parser.add_argument("--dsn", required=True,
                        help="local Postgres DSN (collex_local or"
                             " collex_ingest_test; every other name is refused)")
    parser.add_argument("--dir", required=True, metavar="SPOOL",
                        help="spool directory serve.mjs --library-dir writes"
                             " to (default var/library)")
    parser.add_argument("--dry-run", action="store_true",
                        help="read-only: report what would be published")
    parser.add_argument("--json", action="store_true",
                        help="machine-readable report on stdout")
    parser.add_argument("--profiles",
                        default=",".join(DEFAULT_EMBEDDING_PROFILES),
                        help="comma-separated embedding profile keys")
    args = parser.parse_args(argv)

    # Imported here: ingestion.cli imports this module, and a module-level
    # import would be circular.
    from ingestion.cli import main as cli_main

    forwarded = [
        "--dsn", args.dsn,
        "--publish-library", args.dir,
        "--profiles", args.profiles,
    ]
    if args.dry_run:
        forwarded.append("--dry-run")
    if args.json:
        forwarded.append("--json")
    return cli_main(forwarded)


if __name__ == "__main__":  # pragma: no cover - exercised by the CLI test
    import sys

    sys.exit(main())
