"""Append-only document versioning (legal.document_versions).

Content identity
----------------
``content_sha256(canonical_text)`` (sha256 hex over UTF-8 bytes) is the
version identity within a document. A new version row is appended ONLY
when no version of the document already carries that hash:

* current version has the same hash  -> "unchanged" (idempotent re-crawl);
* an OLDER (closed) version has it   -> "reverted_content": the upstream
  text returned to a previously seen state. The schema's
  unique (document_id, content_sha256) makes re-appending it impossible,
  so this module reports it as a distinct outcome instead of inserting a
  duplicate; promoting an old version back to "current" is a deliberate
  manual/operator action, not something ingestion does silently.

Closing the previous current version
------------------------------------
DESIGN DECISION (mirrored in migration 20260826100000_version_transitions
.sql): the previous open version's ``system_period`` is closed by a
BEFORE INSERT trigger in the database, not by application code. The
trigger runs inside the same transaction as the append, so close+append
is atomic by construction and holds for ANY writer (pipeline, backfill,
manual SQL). A unique partial index
(``document_versions_one_current_uq``) declaratively enforces "at most
one current version per document" as a backstop. This module therefore
only inserts; it never updates ``system_period`` itself. There is no
app-side close to delete because that decision predates this module —
what changed on 2026-08-27 is that the mechanism actually WORKS: until
20260826020000 was corrected, ``system_period`` defaulted to
``tstzrange(now(), 'infinity', '[)')`` and ``'infinity'`` is a finite
timestamptz value, so ``upper_inf()`` was always false, the trigger's
guard never fired, ``current_version_id()`` below always returned NULL,
and every re-crawl of unchanged text was misreported as
"reverted_content" instead of "unchanged".

``effective_period`` is set from ``dates.effective_start`` when present
(daterange ``[start,)``); decision/publication dates map to their
dedicated columns. The SAME trigger closes the previous version's open
``effective_period`` at the new version's start, which is what keeps the
``document_versions_effective_no_overlap`` EXCLUDE constraint satisfied
when a document is re-crawled after an amendment. Again: not this
module's job, deliberately — one mechanism, in the database.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Json

from ingestion.chunking import CHUNKER_VERSION, NORMALIZER_VERSION
from ingestion.ports import ParsedDocument
from legal_reference.normalize import normalize_turkish_search

__all__ = [
    "CHUNKER_VERSION",
    "NORMALIZER_VERSION",
    "ExistingVersion",
    "append_version",
    "content_sha256",
    "current_version_id",
    "find_version_by_hash",
    "mark_published",
]


def content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ExistingVersion:
    version_id: str
    is_current: bool


def find_version_by_hash(
    conn: psycopg.Connection, document_id: str, content_hash: str
) -> ExistingVersion | None:
    row = conn.execute(
        "select id, upper_inf(system_period)"
        " from legal.document_versions"
        " where document_id = %s and content_sha256 = %s",
        (document_id, content_hash),
    ).fetchone()
    if row is None:
        return None
    return ExistingVersion(str(row[0]), bool(row[1]))


def current_version_id(
    conn: psycopg.Connection, document_id: str
) -> str | None:
    row = conn.execute(
        "select id from legal.document_versions"
        " where document_id = %s and upper_inf(system_period)",
        (document_id,),
    ).fetchone()
    return str(row[0]) if row else None


def _effective_period(dates: dict[str, Any]) -> str | None:
    start = dates.get("effective_start")
    return f"[{start},)" if start else None


def append_version(
    conn: psycopg.Connection,
    *,
    document_id: str,
    snapshot_id: str,
    parsed: ParsedDocument,
    content_hash: str,
    status: str = "parsed",
) -> str:
    """Append one version row (status defaults to the pre-publish 'parsed').

    The 20260826100000 trigger closes the previous current version within
    this same transaction; nothing else here mutates existing rows.
    """
    hints = parsed.structure_hints
    row = conn.execute(
        "insert into legal.document_versions"
        " (document_id, source_snapshot_id, version_label, status,"
        "  effective_period, decision_date, publication_date,"
        "  court, chamber, docket_no, decision_no, legislation_no,"
        "  canonical_text, normalized_text, content_sha256,"
        "  structure, metadata)"
        " values (%s, %s, %s, %s, %s::daterange, %s::date, %s::date,"
        "         %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " returning id",
        (
            document_id,
            snapshot_id,
            parsed.version_label,
            status,
            _effective_period(parsed.dates),
            parsed.dates.get("decision"),
            parsed.dates.get("publication"),
            hints.get("court"),
            hints.get("chamber"),
            hints.get("docket_no"),
            hints.get("decision_no"),
            hints.get("legislation_no"),
            parsed.canonical_text,
            # Search-side normalization only; canonical_text stays exact.
            normalize_turkish_search(parsed.canonical_text),
            content_hash,
            Json({
                "kind": hints.get("kind", "generic"),
                "chunker_version": CHUNKER_VERSION,
                # normalized_text above was produced by this normalizer;
                # legal.chunks carries the same identity per row.
                "normalizer_version": NORMALIZER_VERSION,
            }),
            Json({"fixture_meta": parsed.meta,
                  "structure_hints": hints,
                  "dates": parsed.dates}),
        ),
    ).fetchone()
    return str(row[0])


def mark_published(conn: psycopg.Connection, version_id: str) -> None:
    """Flip a version to 'published' (called last inside the ingest tx)."""
    conn.execute(
        "update legal.document_versions set status = 'published'"
        " where id = %s",
        (version_id,),
    )
