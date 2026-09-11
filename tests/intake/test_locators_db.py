"""End-to-end: a real upload's chunks resolve to real physical pages.

``tests/intake/test_locators.py`` proves the map is correct in memory. This
suite proves it survives the whole intake path -- extraction, NFC, chunking,
the publish transaction and PostgreSQL -- and that the ranges stored in
``legal.document_version_segments`` still slice the stored
``canonical_text`` exactly.

Same database contract as the rest of the package: the local scratch
PostgreSQL and ``collex_intake_test`` only.
"""

from __future__ import annotations

import unicodedata

from ingestion.locators import locator_for_range
from ingestion.segments import read_segments
from intake.ingest import LOCAL_TENANT_ID, UPLOAD_SOURCE, process_file
from tests.intake.pdf_fixtures import build_multipage_pdf

PLANTED = "GIZLI IBARE ALFA VE BETA BURADA GECER"
PLANTED_PAGE = 137
TOTAL_PAGES = 200

_BODY = (
    "Bu sayfanin govde metnidir ve dosyanin okunabilir bir sayfasi"
    " oldugunu gostermek icin yeterince uzundur."
)


def _write_pdf(tmp_path, name: str, pages: list[list[str]]):
    path = tmp_path / name
    path.write_bytes(build_multipage_pdf(pages))
    return path


def _version_id(conn, file_id: str) -> str:
    row = conn.execute(
        "select v.id::text from legal.documents d"
        " join legal.document_versions v"
        "   on v.document_id = d.id and upper_inf(v.system_period)"
        " where d.source = %s and d.tenant_id = %s and d.external_id = %s",
        (UPLOAD_SOURCE, LOCAL_TENANT_ID, file_id),
    ).fetchone()
    assert row is not None, "uploaded document has no current version"
    return row[0]


def _canonical_text(conn, version_id: str) -> str:
    row = conn.execute(
        "select canonical_text from legal.document_versions where id = %s",
        (version_id,),
    ).fetchone()
    return row[0]


def test_two_hundred_page_upload_stores_one_segment_per_page(
    dsn, conn, tmp_path, store_dir
):
    pages = [
        [f"Sayfa {n}", PLANTED, _BODY] if n == PLANTED_PAGE
        else [f"Sayfa {n}", f"{n}. sayfa. {_BODY}"]
        for n in range(1, TOTAL_PAGES + 1)
    ]
    result = process_file(
        _write_pdf(tmp_path, "iki_yuz_sayfa.pdf", pages), dsn, store_dir=store_dir
    )
    assert result.action == "published"
    assert result.pages == TOTAL_PAGES

    version_id = _version_id(conn, result.file_id)
    segments = read_segments(conn, version_id)

    # Every page is in the ledger, in order, labelled by its page number.
    assert len(segments) == TOTAL_PAGES
    assert [s.segment_no for s in segments] == list(range(1, TOTAL_PAGES + 1))
    assert [s.locator_label for s in segments] == [
        str(n) for n in range(1, TOTAL_PAGES + 1)
    ]
    assert {s.locator_kind for s in segments} == {"page"}
    assert {s.extraction_method for s in segments} == {"pdf_text_layer"}


def test_stored_segment_ranges_slice_the_stored_canonical_text(
    dsn, conn, tmp_path, store_dir
):
    """The offset invariant holds across Python AND PostgreSQL."""
    pages = [[f"Sayfa {n}", f"{n}. sayfa. {_BODY}"] for n in range(1, 13)]
    result = process_file(
        _write_pdf(tmp_path, "on_iki_sayfa.pdf", pages), dsn, store_dir=store_dir
    )
    version_id = _version_id(conn, result.file_id)
    canonical = _canonical_text(conn, version_id)
    segments = read_segments(conn, version_id)

    assert unicodedata.normalize("NFC", canonical) == canonical
    for segment in segments:
        piece = canonical[segment.start_char : segment.end_char]
        assert piece, f"page {segment.locator_label} sliced empty"
        assert f"Sayfa {segment.locator_label}" in piece

    # And the same slice computed BY PostgreSQL, which counts characters,
    # not UTF-16 units -- the ADR-003 cross-runtime invariant.
    for segment in segments[:3]:
        row = conn.execute(
            "select substring(canonical_text from %s for %s)"
            " from legal.document_versions where id = %s",
            (segment.start_char + 1, segment.char_count, version_id),
        ).fetchone()
        assert row[0] == canonical[segment.start_char : segment.end_char]


def test_a_chunk_resolves_to_the_page_its_text_was_printed_on(
    dsn, conn, tmp_path, store_dir
):
    """The product question: which page do I turn to for this passage?"""
    pages = [
        [f"Sayfa {n}", PLANTED, _BODY] if n == PLANTED_PAGE
        else [f"Sayfa {n}", f"{n}. sayfa. {_BODY}"]
        for n in range(1, TOTAL_PAGES + 1)
    ]
    result = process_file(
        _write_pdf(tmp_path, "atif_sayfasi.pdf", pages), dsn, store_dir=store_dir
    )
    version_id = _version_id(conn, result.file_id)
    segments = read_segments(conn, version_id)

    # The chunk that actually carries the planted phrase, straight from the
    # chunk table -- no in-memory shortcut.
    row = conn.execute(
        "select start_char, end_char, original_text from legal.chunks"
        " where document_version_id = %s and original_text like %s",
        (version_id, f"%{PLANTED}%"),
    ).fetchone()
    assert row is not None, "planted phrase produced no chunk"
    start_char, end_char, original_text = row
    assert PLANTED in original_text

    assert locator_for_range(segments, start_char, end_char) == f"s. {PLANTED_PAGE}"


def test_unreadable_pages_are_stored_as_empty_ranges(
    dsn, conn, tmp_path, store_dir
):
    """A mixed scan keeps its blank pages in the ledger, not in the text."""
    pages = [[f"Sayfa 1", _BODY], [], [f"Sayfa 3", _BODY], []]
    result = process_file(
        _write_pdf(tmp_path, "karisik_tarama.pdf", pages), dsn, store_dir=store_dir
    )
    version_id = _version_id(conn, result.file_id)
    segments = read_segments(conn, version_id)

    assert [s.extraction_status for s in segments] == [
        "EXTRACTED", "UNREADABLE", "EXTRACTED", "UNREADABLE",
    ]
    unreadable = [s for s in segments if s.extraction_status == "UNREADABLE"]
    assert [s.locator_label for s in unreadable] == ["2", "4"]
    assert all(s.char_count == 0 for s in unreadable)

    # The unreadable pages are countable in SQL, which is what processing
    # coverage will do per file.
    count = conn.execute(
        "select count(*) from legal.document_version_segments"
        " where document_version_id = %s and extraction_status = 'UNREADABLE'",
        (version_id,),
    ).fetchone()[0]
    assert count == 2


def test_docx_upload_gets_paragraph_locators_never_page_numbers(
    dsn, conn, uploads_dir, store_dir
):
    """A DOCX has no stable pages, so it must not claim any."""
    result = process_file(uploads_dir / "dilekce_ornek.docx", dsn,
                          store_dir=store_dir)
    version_id = _version_id(conn, result.file_id)
    segments = read_segments(conn, version_id)

    assert segments, "DOCX produced no source map"
    assert {s.locator_kind for s in segments} <= {"paragraph"}
    assert "page" not in {s.locator_kind for s in segments}
    assert {s.extraction_method for s in segments} <= {
        "docx_paragraph", "docx_table", "none",
    }
    readable = [s for s in segments if s.char_count > 0]
    assert locator_for_range(
        segments, readable[0].start_char, readable[0].end_char
    ).startswith("par. ")


def test_reupload_of_the_same_bytes_does_not_duplicate_segments(
    dsn, conn, tmp_path, store_dir
):
    """Segment insertion is idempotent, like chunk insertion."""
    pages = [[f"Sayfa {n}", f"{n}. sayfa. {_BODY}"] for n in range(1, 6)]
    path = _write_pdf(tmp_path, "tekrar.pdf", pages)
    first = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    before = len(read_segments(conn, version_id))

    second = process_file(path, dsn, store_dir=store_dir)
    assert second.action in {"unchanged", "reverted_content"}
    assert len(read_segments(conn, version_id)) == before == 5
