"""Intake throughput with the batched indexer (W12-F).

The HTTP layer gives the intake CLI 180 s. Before batching, one INSERT per
chunk meant a large text upload (tens of thousands of paragraphs) could not
finish inside that budget. This test pushes 30 000 paragraphs through the
REAL intake path (quarantine -> extract -> analysis -> pipeline -> batched
indexer) and requires the whole thing to finish well under the budget.

Marked ``slow`` (a few seconds on a local PostgreSQL); it runs by default
because the number it measures is the one the upload path depends on.
"""

from __future__ import annotations

import time

import pytest

from intake.ingest import process_file

PARAGRAPHS = 30_000

# ~120 code points per paragraph, Turkish letters included so the offset
# math is exercised on multi-byte text (3.6 M code points of canonical text).
_PARAGRAPH = (
    "{n}. Davalı, {n}.05.2024 tarihli sözleşmeye aykırı davranmış ve TBK m. 112"
    " uyarınca tazminat borcu doğmuştur; ihtarnameye rağmen ödeme yapılmamıştır."
)


@pytest.mark.slow
def test_thirty_thousand_paragraphs_ingest_under_sixty_seconds(dsn, conn,
                                                               tmp_path,
                                                               store_dir):
    text = "\n\n".join(_PARAGRAPH.format(n=i + 1) for i in range(PARAGRAPHS))
    upload = tmp_path / "buyuk_dilekce.txt"
    upload.write_text(text, encoding="utf-8")

    started = time.monotonic()
    result = process_file(upload, dsn, store_dir=store_dir)
    elapsed = time.monotonic() - started

    assert result.action == "published"
    assert result.chunk_count == PARAGRAPHS
    assert elapsed < 60, f"30k-paragraph intake took {elapsed:.1f}s"

    stored, ordinal_span = conn.execute(
        "select count(*), max(ordinal) - min(ordinal) + 1 from legal.chunks"
    ).fetchone()
    assert stored == PARAGRAPHS
    assert ordinal_span == PARAGRAPHS

    # Spot-check provenance on a batch boundary (500-row batches).
    row = conn.execute(
        "select c.original_text, c.start_char, c.end_char, v.canonical_text"
        " from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " where c.ordinal = 500"
    ).fetchone()
    original, start, end, canonical = row
    assert canonical[start:end] == original
    assert original.startswith("501. Davalı")
