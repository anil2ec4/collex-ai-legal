"""Amendment relations (``legal.document_relations``) written at ingest.

WHAT THIS IS FOR
----------------
Retrieval that only follows the words in a passage can answer "what does
TCK 157 say?" but not "which instrument changed it, and when?". The second
question is a CITATOR question, and a citator needs an index of edges, not
of text: the amending provision ("...157 nci maddesinin birinci fıkrasında
yer alan ... ibaresi ... şeklinde değiştirilmiştir") shares almost no
vocabulary with the amended provision, so no lexical lane can connect them
and the dense lane is inert here (pgvector is absent from the local scratch
PostgreSQL). ``legal.document_relations`` is that index; this module is what
finally populates it. The retrieval side is
``control-plane/src/store/chunkStore.ts :: citatorLookup``.

WHERE THE EDGES COME FROM
-------------------------
``structure_hints.amendments`` on the amending document. Each hint names the
action, the target legislation number, the target article, and (in the
fixture corpus) the target's external id. The hint is a CLAIM by the source,
not a resolution: the target number still has to be matched against a
document that actually exists in this database.

HOW A TARGET IS RESOLVED
------------------------
Through ``legal_reference.resolver.AmendmentTargetResolver`` — the module
already written for exactly this job — over a ``SearchPort`` backed by this
database (``LocalLegislationSearchPort`` below). Its decision drives
``legal.document_relations.resolution_status``:

    resolved   -> a single candidate above threshold, with margin
    ambiguous  -> several candidates above threshold within the margin
    manual     -> the resolver abstained (top confidence below threshold)

AN AMBIGUOUS TARGET IS NEVER SILENTLY RESOLVED. When the resolver does not
resolve, the row is still written when — and only when — the hint names a
target document that exists here, so the ambiguity is QUEUED and visible
rather than dropped; ``resolution_status`` says which it is, and the
retrieval lane admits ``resolved`` rows only. When no local document can be
identified at all there is nothing to point ``to_document_id`` at (the
column is NOT NULL), so the edge cannot be stored: it is reported on the
``DocumentOutcome`` as an unresolved relation with a reason, never dropped
in silence.

``confidence`` and ``resolver_version`` travel with every row, and
``evidence`` carries the hint verbatim plus the resolver's own notes, so a
reviewer can see what the machine was looking at when it decided.

IDEMPOTENCE
-----------
Relations are derived from one version's immutable text, so they are
rewritten wholesale for that version (delete-then-insert) inside the same
publish transaction that created it. Re-running the pipeline over unchanged
text never reaches this module: the version already exists and the pipeline
reports "unchanged" before any relation work.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional, Sequence

import psycopg
from psycopg.types.json import Json

from legal_reference.parser import ParsedReference
from legal_reference.resolver import (
    AmendmentTargetResolver,
    CandidateLaw,
    TargetResolution,
)

__all__ = [
    "RELATION_RESOLVER_VERSION",
    "AmendmentHint",
    "LocalLegislationSearchPort",
    "RelationWriteResult",
    "UnresolvedRelation",
    "iter_amendment_hints",
    "write_amendment_relations",
]

# Identity of the (resolver + mapping) pair that produced a relation row.
# Bump it whenever the decision procedure changes, so stored rows stay
# attributable to the code that made them.
RELATION_RESOLVER_VERSION = "amend-resolver-v1"

# legal.relation_kind values this module may write. A hint naming anything
# else is reported, not guessed at.
SUPPORTED_ACTIONS = frozenset({"AMENDS", "REPEALS"})

# resolver decision -> legal.document_relations.resolution_status
_DECISION_STATUS = {
    "resolved": "resolved",
    "ambiguous": "ambiguous",
    "abstain": "manual",
    "not_found": "manual",
}


@dataclass(frozen=True)
class AmendmentHint:
    """One ``structure_hints.amendments`` entry, normalized."""

    action: str
    target_legislation_no: Optional[str]
    target_external_id: Optional[str]
    target_article: Optional[str]
    target_paragraph: Optional[str]
    changing_article: Optional[str]
    raw: dict[str, Any]


@dataclass(frozen=True)
class UnresolvedRelation:
    """An edge the source claimed that could not be stored, and why."""

    action: str
    target_legislation_no: Optional[str]
    reason: str


@dataclass
class RelationWriteResult:
    written: int = 0
    resolved: int = 0
    unresolved: list[UnresolvedRelation] = field(default_factory=list)


def iter_amendment_hints(structure_hints: dict[str, Any]) -> list[AmendmentHint]:
    """Normalize ``structure_hints.amendments`` into typed hints."""
    raw_list = structure_hints.get("amendments") or []
    if not isinstance(raw_list, (list, tuple)):
        return []
    hints: list[AmendmentHint] = []
    for entry in raw_list:
        if not isinstance(entry, dict):
            continue
        hints.append(
            AmendmentHint(
                action=str(entry.get("action") or "AMENDS").upper(),
                target_legislation_no=_str_or_none(entry.get("target_legislation_no")),
                target_external_id=_str_or_none(entry.get("target_external_id")),
                target_article=_str_or_none(entry.get("target_article")),
                target_paragraph=_str_or_none(entry.get("target_paragraph")),
                changing_article=_str_or_none(entry.get("changing_article")),
                raw=dict(entry),
            )
        )
    return hints


def _str_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


# ---------------------------------------------------------------------------
# SearchPort over this database
# ---------------------------------------------------------------------------


class LocalLegislationSearchPort:
    """``resolver.SearchPort`` backed by ``legal.documents``/``document_versions``.

    ``mevzuat_id`` carries the local ``legal.documents.id``, which is what
    makes a resolved candidate directly usable as ``to_document_id``.

    The lookup is deliberately over PUBLISHED versions only and takes the
    widest effective period recorded for a legislation number, so a law is
    findable as a target regardless of which of its versions is current.
    The query blocks; that is fine here — the resolver's async surface exists
    for network-backed ports, this one is a local scratch database and the
    ingest transaction is single-threaded anyway. (For the same reason the
    caller drives the resolver with ``asyncio.run``: ``Pipeline`` is a
    synchronous psycopg program throughout, so there is never an event loop
    already running underneath it.)
    """

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    async def search_exact(
        self,
        *,
        legislation_no: str = "",
        name: str = "",
        as_of: Optional[date] = None,
    ) -> Sequence[CandidateLaw]:
        if not legislation_no:
            return ()
        rows = self._conn.execute(
            # ORDER BY IS PART OF THE CONTRACT, NOT A COSMETIC. Two documents
            # can share one legislation_no (the corpus models an amended law
            # as a second document), and without an explicit order PostgreSQL
            # returns the groups in whatever order the aggregate produced them
            # — which depends on ids minted at ingest. The resolver then saw a
            # different candidate list after every re-ingest of the SAME
            # corpus, wrote different edges, and moved a gold row's answer
            # between runs. Measured 03.09.2026 (W14 N-7). (source,
            # external_id) is the corpus identity and is stable across
            # ingests; d.id stays last so the order is total.
            "select d.id::text, d.title, v.legislation_no, d.document_type,"
            "       min(lower(v.effective_period)) as first_start,"
            "       max(upper(v.effective_period)) as last_end"
            " from legal.document_versions v"
            " join legal.documents d on d.id = v.document_id"
            " where v.status = 'published' and v.legislation_no = %s"
            " group by d.id, d.title, v.legislation_no, d.document_type,"
            "          d.source, d.external_id"
            " order by d.source asc, d.external_id asc, d.id asc",
            (legislation_no,),
        ).fetchall()
        return tuple(
            CandidateLaw(
                mevzuat_id=str(row[0]),
                name=str(row[1] or ""),
                legislation_no=_str_or_none(row[2]),
                law_type=_law_type(str(row[3] or "")),
                effective_start=row[4],
                effective_end=row[5],
            )
            for row in rows
        )


def _law_type(document_type: str) -> str:
    """Map ``legal.documents.document_type`` onto the resolver's law_type."""
    lowered = document_type.strip().lower()
    if lowered == "khk":
        return "KHK"
    if lowered == "cbk":
        return "CBK"
    return "KANUN"


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def write_amendment_relations(
    conn: psycopg.Connection,
    *,
    document_version_id: str,
    amending_legislation_no: Optional[str],
    structure_hints: dict[str, Any],
    chunk_ids_by_article: dict[str, str],
) -> RelationWriteResult:
    """Derive and store this version's outbound amendment edges.

    ``chunk_ids_by_article`` maps the AMENDING instrument's own article
    number to the chunk that carries it, so a stored relation points at the
    exact passage that made the change rather than at the whole instrument.
    """
    result = RelationWriteResult()
    hints = iter_amendment_hints(structure_hints)

    # Derived data: rebuild wholesale so a re-derivation can never leave a
    # stale edge behind next to a fresh one.
    conn.execute(
        "delete from legal.document_relations where from_document_version_id = %s",
        (document_version_id,),
    )
    if not hints:
        return result

    resolver = AmendmentTargetResolver(LocalLegislationSearchPort(conn))

    for hint in hints:
        if hint.action not in SUPPORTED_ACTIONS:
            result.unresolved.append(
                UnresolvedRelation(
                    action=hint.action,
                    target_legislation_no=hint.target_legislation_no,
                    reason=f"UNSUPPORTED_ACTION:{hint.action}",
                )
            )
            continue
        if hint.target_legislation_no is None:
            result.unresolved.append(
                UnresolvedRelation(
                    action=hint.action,
                    target_legislation_no=None,
                    reason="HINT_HAS_NO_TARGET_LEGISLATION_NO",
                )
            )
            continue
        if (
            amending_legislation_no is not None
            and hint.target_legislation_no.lstrip("0")
            == str(amending_legislation_no).lstrip("0")
        ):
            # The classic wrong-changing-id bug: an instrument is never a
            # valid target of its own amendment.
            result.unresolved.append(
                UnresolvedRelation(
                    action=hint.action,
                    target_legislation_no=hint.target_legislation_no,
                    reason="SELF_REFERENCE_SKIPPED",
                )
            )
            continue

        resolution = asyncio.run(
            resolver.resolve_reference(
                ParsedReference(
                    kind="legislation",
                    raw=hint.target_legislation_no,
                    legislation_no=hint.target_legislation_no,
                ),
                exclude_legislation_no=(
                    str(amending_legislation_no)
                    if amending_legislation_no is not None
                    else None
                ),
            )
        )
        status = _DECISION_STATUS.get(resolution.decision, "manual")
        to_document_id = _target_document_id(conn, hint, resolution)
        if to_document_id is None:
            result.unresolved.append(
                UnresolvedRelation(
                    action=hint.action,
                    target_legislation_no=hint.target_legislation_no,
                    reason=f"NO_LOCAL_TARGET_DOCUMENT:{resolution.decision}",
                )
            )
            continue

        source_chunk_id = (
            chunk_ids_by_article.get(hint.changing_article)
            if hint.changing_article is not None
            else None
        )
        confidence = (
            resolution.selected.confidence if resolution.selected is not None else None
        )
        conn.execute(
            "insert into legal.document_relations"
            " (from_document_version_id, to_document_id, kind, source_chunk_id,"
            "  target_locator, resolution_status, confidence, resolver_version,"
            "  evidence)"
            " values (%s, %s, %s::legal.relation_kind, %s, %s, %s, %s, %s, %s)",
            (
                document_version_id,
                to_document_id,
                hint.action,
                source_chunk_id,
                Json(_target_locator(hint)),
                status,
                confidence,
                RELATION_RESOLVER_VERSION,
                Json(
                    {
                        "structure_hint": hint.raw,
                        "resolver_decision": resolution.decision,
                        "resolver_notes": list(resolution.notes),
                        "is_mulga": resolution.is_mulga,
                    }
                ),
            ),
        )
        result.written += 1
        if status == "resolved":
            result.resolved += 1

    return result


def _target_locator(hint: AmendmentHint) -> dict[str, Any]:
    locator: dict[str, Any] = {"legislation_no": hint.target_legislation_no}
    if hint.target_article is not None:
        locator["article"] = hint.target_article
    if hint.target_paragraph is not None:
        locator["paragraph"] = hint.target_paragraph
    if hint.target_external_id is not None:
        locator["external_id"] = hint.target_external_id
    return locator


def _target_document_id(
    conn: psycopg.Connection,
    hint: AmendmentHint,
    resolution: TargetResolution,
) -> Optional[str]:
    """The local document this edge points at, or None when there is none.

    A RESOLVED decision carries the document id in the selected candidate
    (``LocalLegislationSearchPort`` puts it there). An ambiguous or abstained
    decision does not select anything — that is the point — so the edge is
    stored only when the hint names a target that unambiguously exists here,
    and the row keeps the non-``resolved`` status that says a human must
    still confirm it.
    """
    if resolution.selected is not None:
        return resolution.selected.candidate.mevzuat_id

    if hint.target_external_id is not None:
        row = conn.execute(
            "select id::text from legal.documents where external_id = %s",
            (hint.target_external_id,),
        ).fetchall()
        if len(row) == 1:
            return str(row[0][0])
    return None
