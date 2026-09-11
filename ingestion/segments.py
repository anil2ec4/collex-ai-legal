"""Idempotent source-locator insertion (legal.document_version_segments).

A segment maps a half-open canonical code-point range to a place in the
ORIGINAL file: a physical PDF page, a DOCX paragraph, or the single block of
a flat text file. ``ingestion/locators.py`` builds and verifies the map;
this module is the only writer.

Written in the SAME transaction as the version and its chunks
(``ingestion/pipeline.py``), so a document can never be published with a
half-written page map. Re-inserting is keyed off the table's
``primary key (document_version_id, segment_no)`` with
``on conflict do nothing``, matching ``ingestion/indexer.py``: a version is
immutable and content-hash-keyed, so re-running the same extractor over the
same bytes yields the same segments and a conflicting segment_no is
genuinely the same row.

Empty ranges are expected, not an error: a page with no text layer
contributes no characters and is stored with ``start_char == end_char`` so
processing coverage can count what was NOT read. The table's EXCLUDE
constraint tolerates them because an empty ``int4range`` never overlaps.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import psycopg
from psycopg.types.json import Json

from ingestion.locators import SourceSegment

#: Rows per executemany round trip. A 600-page PDF is one round trip.
INSERT_BATCH_SIZE = 500

_INSERT_SQL = (
    "insert into legal.document_version_segments"
    " (document_version_id, segment_no, locator_kind, locator_label,"
    "  start_char, end_char, extraction_method, extraction_status,"
    "  confidence, metadata)"
    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    " on conflict (document_version_id, segment_no) do nothing"
)


def segment_row(
    version_id: str,
    segment: SourceSegment,
    *,
    confidence: float | None = None,
    metadata: dict | None = None,
) -> tuple:
    """The exact parameter tuple one segment is written with."""
    return (
        version_id,
        segment.segment_no,
        segment.locator_kind,
        segment.locator_label,
        segment.start_char,
        segment.end_char,
        segment.extraction_method,
        segment.extraction_status,
        # W20: an OCR page's own confidence unless the caller overrides it.
        confidence if confidence is not None else segment.confidence,
        Json(metadata or {}),
    )


def insert_segments(
    conn: psycopg.Connection,
    version_id: str,
    segments: Iterable[SourceSegment],
    *,
    batch_size: int = INSERT_BATCH_SIZE,
) -> int:
    """Insert segments for ``version_id``; returns rows actually inserted."""
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    inserted = 0
    batch: list[tuple] = []
    with conn.cursor() as cur:
        for segment in segments:
            batch.append(segment_row(version_id, segment))
            if len(batch) >= batch_size:
                cur.executemany(_INSERT_SQL, batch)
                inserted += max(0, cur.rowcount)
                batch = []
        if batch:
            cur.executemany(_INSERT_SQL, batch)
            inserted += max(0, cur.rowcount)
    return inserted


def segments_from_hints(structure_hints: dict | None) -> tuple[SourceSegment, ...]:
    """Read the segment map a source adapter attached to its parse output.

    ``ParsedDocument.structure_hints["segments"]`` is the additive channel an
    adapter uses to hand its locator map to the pipeline. An adapter that
    does not produce one (every corpus fetcher today) yields no segments and
    the document simply has no source map -- which is reported as such,
    never guessed.
    """
    if not structure_hints:
        return ()
    raw = structure_hints.get("segments")
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return ()
    out: list[SourceSegment] = []
    for item in raw:
        if isinstance(item, SourceSegment):
            out.append(item)
        elif isinstance(item, dict):
            try:
                out.append(SourceSegment.from_json_dict(item))
            except (KeyError, TypeError, ValueError):
                # A malformed map is dropped whole: a partial page map is
                # worse than none, because it would cite the wrong page.
                return ()
    return tuple(out)


def read_segments(
    conn: psycopg.Connection, version_id: str
) -> tuple[SourceSegment, ...]:
    """Every segment of a version, in document order."""
    rows = conn.execute(
        "select segment_no, locator_kind, locator_label, start_char,"
        " end_char, extraction_method, extraction_status"
        " from legal.document_version_segments"
        " where document_version_id = %s order by segment_no",
        (version_id,),
    ).fetchall()
    return tuple(
        SourceSegment(
            segment_no=int(r[0]),
            locator_kind=str(r[1]),
            locator_label=str(r[2]),
            start_char=int(r[3]),
            end_char=int(r[4]),
            extraction_method=str(r[5]),
            extraction_status=str(r[6]),
        )
        for r in rows
    )
