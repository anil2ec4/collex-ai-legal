"""R2-34: a re-read of an unchanged text re-judges the STORED page statuses.

The W21 #25 fix changed how a scanned page carrying only an e-signature footer
is judged (SPARSE, no longer EXTRACTED) without changing a character of the
canonical text. Re-uploading such a document, or "Analizi yenile", found the
version by its content hash and only merged ``page_stats`` / ``warnings`` into
the metadata: the file page then said "not fully read" while the stored
segment rows — what the exhaustive review counts — still said EXTRACTED, so
the review could still call the file completely read. Documents nobody touched
had no way to be re-judged at all.

REAL integration tests against the scratch PostgreSQL (see conftest.py).
"""

from __future__ import annotations

from psycopg.types.json import Jsonb

from intake import extract as extract_mod
from intake import ingest
from intake.ingest import LOCAL_TENANT_ID, UPLOAD_SOURCE, process_file, reanalyze_file
from intake.ocr import OcrPageResult
from scripts.backfill_locators import reclassify
from tests.intake.pdf_fixtures import TEXT_PAGE, build_image_pdf, mixed_pdf, scanned_page


def _scan_with_footer(tmp_path, name="imzali_tarama.pdf"):
    path = tmp_path / name
    path.write_bytes(build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page()]))
    return path


def _version_id(conn, file_id: str) -> str:
    return conn.execute(
        "select v.id::text from legal.documents d"
        " join legal.document_versions v"
        "   on v.document_id = d.id and upper_inf(v.system_period)"
        " where d.source = %s and d.tenant_id = %s and d.external_id = %s",
        (UPLOAD_SOURCE, LOCAL_TENANT_ID, file_id),
    ).fetchone()[0]


def _rows(conn, version_id: str) -> list[tuple]:
    return conn.execute(
        "select segment_no, locator_label, extraction_method, extraction_status, confidence"
        " from legal.document_version_segments where document_version_id = %s"
        " order by segment_no",
        (version_id,),
    ).fetchall()


def _unread_page_count(conn, version_id: str) -> int:
    """What processing coverage counts against "the whole file was read"."""
    return conn.execute(
        "select count(*) from legal.document_version_segments"
        " where document_version_id = %s and extraction_status <> 'EXTRACTED'",
        (version_id,),
    ).fetchone()[0]


def _make_pre_fix(conn, version_id: str) -> None:
    """What an extractor before W21 #25 stored for the same bytes and text."""
    conn.execute(
        "update legal.document_version_segments set extraction_status = 'EXTRACTED'"
        " where document_version_id = %s and segment_no = 2",
        (version_id,),
    )
    conn.execute(
        "update legal.document_versions set metadata = jsonb_set(metadata,"
        " '{fixture_meta,upload,page_stats}', %s::jsonb) where id = %s",
        (Jsonb({"pageCount": 2, "pagesWithText": 2, "emptyPages": []}), version_id),
    )


def _versions(conn) -> int:
    return conn.execute("select count(*) from legal.document_versions").fetchone()[0]


def test_reanalysis_of_an_unchanged_text_downgrades_a_pre_fix_extracted_page(dsn, conn, tmp_path, store_dir):
    first = process_file(_scan_with_footer(tmp_path), dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    assert _rows(conn, version_id)[1][3] == "SPARSE"
    _make_pre_fix(conn, version_id)
    assert _unread_page_count(conn, version_id) == 0  # the review would say "all read"

    detail = reanalyze_file(dsn, first.file_id, store_dir=store_dir)

    # Before the fix only the metadata moved: the file page said "sparse" and
    # the stored row — what the review reads — still said EXTRACTED.
    assert detail["pages"]["sparsePages"] == [2]
    assert _rows(conn, version_id)[1][1:4] == ("2", "pdf_text_layer", "SPARSE")
    assert _unread_page_count(conn, version_id) == 1
    assert _versions(conn) == 1  # re-judged in place, no new version
    assert ingest.PAGE_STATUS_RESYNC_REFUSED_TR not in detail["warnings"]


def test_reuploading_the_same_bytes_resyncs_the_page_and_says_so(dsn, conn, tmp_path, store_dir):
    path = _scan_with_footer(tmp_path)
    first = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    _make_pre_fix(conn, version_id)

    again = process_file(path, dsn, store_dir=store_dir)

    assert again.action == "unchanged"
    assert _rows(conn, version_id)[1][3] == "SPARSE"
    assert "1 sayfanın okunma durumu bu okumaya göre güncellendi; 1 sayfa artık tamamı okunmuş sayılmıyor" in again.warnings


def test_an_identical_ocr_reading_changes_nothing(dsn, conn, tmp_path, store_dir, monkeypatch):
    class FakeOcr:
        name = "fake-ocr"

        def ocr_page(self, pdf_bytes, page_index):
            return OcrPageResult(
                text="T.C. ANKARA 5. İŞ MAHKEMESİ — işçilik alacağı davasında bilirkişi raporu alınmıştır.",
                confidence=0.93,
                engine=self.name,
            )

    monkeypatch.setattr(extract_mod, "resolve_ocr_provider", lambda: FakeOcr())
    path = tmp_path / "ocr_belge.pdf"
    path.write_bytes(mixed_pdf(text_pages=1, empty_pages=1))
    first = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    before = _rows(conn, version_id)
    assert before[1][2:4] == ("ocr", "EXTRACTED")

    again = process_file(path, dsn, store_dir=store_dir)

    # A stored real (float4) confidence is the same reading, not a new one.
    assert _rows(conn, version_id) == before
    assert not any("okunma durumu" in w for w in again.warnings)


def test_a_stored_map_describing_other_ranges_is_never_rewritten(dsn, conn, tmp_path, store_dir):
    first = process_file(_scan_with_footer(tmp_path), dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    _make_pre_fix(conn, version_id)
    conn.execute(
        "update legal.document_version_segments set locator_label = '2a'"
        " where document_version_id = %s and segment_no = 2",
        (version_id,),
    )

    detail = reanalyze_file(dsn, first.file_id, store_dir=store_dir)

    assert _rows(conn, version_id)[1][1:4] == ("2a", "pdf_text_layer", "EXTRACTED")
    # Said, and stored with the document, never silently kept.
    assert ingest.PAGE_STATUS_RESYNC_REFUSED_TR in detail["warnings"]


def test_a_version_without_a_page_map_gets_one_on_reanalysis(dsn, conn, tmp_path, store_dir):
    first = process_file(_scan_with_footer(tmp_path), dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    conn.execute("delete from legal.document_version_segments where document_version_id = %s", (version_id,))

    reanalyze_file(dsn, first.file_id, store_dir=store_dir)

    assert [r[3] for r in _rows(conn, version_id)] == ["EXTRACTED", "SPARSE"]


# ---------------------------------------------------------------------------
# The migration path for documents nobody re-uploads (scripts/backfill_locators.py --reclassify)
# ---------------------------------------------------------------------------


def test_reclassify_dry_run_reports_and_apply_downgrades_in_place(dsn, conn, tmp_path, store_dir):
    first = process_file(_scan_with_footer(tmp_path), dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    _make_pre_fix(conn, version_id)

    dry = reclassify(dsn, apply=False, tenant_id=None, store_dir=store_dir)
    assert dry["examined"] == 1
    assert dry["pagesDowngraded"] == 1
    assert _rows(conn, version_id)[1][3] == "EXTRACTED"  # nothing written

    applied = reclassify(dsn, apply=True, tenant_id=None, store_dir=store_dir)
    assert applied["resynced"] == 1
    assert _rows(conn, version_id)[1][3] == "SPARSE"
    page_stats = conn.execute(
        "select metadata #> '{fixture_meta,upload,page_stats}' from legal.document_versions where id = %s",
        (version_id,),
    ).fetchone()[0]
    assert page_stats["sparsePages"] == [2]
    assert _versions(conn) == 1

    # Idempotent: a second pass finds nothing to change.
    again = reclassify(dsn, apply=True, tenant_id=None, store_dir=store_dir)
    assert again["pagesUpdated"] == 0


def test_reclassify_judges_a_text_ingested_without_ocr_as_such(dsn, conn, tmp_path, store_dir):
    first = process_file(_scan_with_footer(tmp_path), dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    _make_pre_fix(conn, version_id)

    class BodyOcr:
        name = "body-ocr"

        def ocr_page(self, pdf_bytes, page_index):
            return OcrPageResult(
                text="T.C. İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ — kira bedelinin 45.000 TL olarak ödendiği tespit edilmiştir.",
                confidence=0.9,
                engine=self.name,
            )

    # This machine now has OCR: its reading adds the scan body, so its text is
    # not the stored one; the stored text is the no-OCR reading, judged as such.
    report = reclassify(dsn, apply=True, tenant_id=None, store_dir=store_dir, ocr_provider=BodyOcr())
    assert report["needsReanalysis"] == []
    assert _rows(conn, version_id)[1][2:4] == ("pdf_text_layer", "SPARSE")


def test_reclassify_never_rejudges_a_text_it_cannot_reproduce(dsn, conn, tmp_path, store_dir):
    first = process_file(_scan_with_footer(tmp_path), dsn, store_dir=store_dir)
    version_id = _version_id(conn, first.file_id)
    _make_pre_fix(conn, version_id)
    conn.execute(
        "update legal.document_versions set canonical_text = canonical_text || ' ek' where id = %s",
        (version_id,),
    )

    report = reclassify(dsn, apply=True, tenant_id=None, store_dir=store_dir)

    assert report["needsReanalysis"] == [first.file_id]
    assert _rows(conn, version_id)[1][3] == "EXTRACTED"
