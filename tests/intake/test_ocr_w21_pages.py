"""W21 platform lane: what local OCR really read, page by page.

* #25 — a SCANNED page whose text layer holds only a stamp or an e-signature
  footer (50+ characters) used to be recorded EXTRACTED via its text layer,
  was never sent to OCR and left no coverage gap, so a review could call the
  whole file read although no page body had been read.
* #29 — page statistics were computed from the text layer BEFORE OCR, so a
  page local OCR did read was still reported as "no text, cannot be quoted".
* #30 — OCR had no overall time budget under the 180 s intake kill, and the
  per-page timeout applied to pdftoppm AND tesseract separately.

The OCR providers here are fakes: they prove the boundary, the provenance and
the accounting, not recognition quality.
"""

from __future__ import annotations

import signal
from pathlib import Path

import pytest

from intake import extract as extract_mod
from intake import ocr as ocr_mod
from intake.errors import ExtractionFailedError
from intake.ocr import OcrError, OcrPageResult
from tests.intake.pdf_fixtures import (
    SIGNATURE_FOOTER,
    TEXT_PAGE,
    build_image_pdf,
    mixed_pdf,
    scanned_page,
)

OCR_BODY = (
    "T.C. İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ — davacı vekilinin dilekçesi incelendi;"
    " kira bedelinin 45.000 TL olarak ödendiği tespit edilmiştir."
)


class FakeOcr:
    """Reads a fixed body on every page it is asked about (0-based index)."""

    name = "fake-ocr"

    def __init__(self, *, fail_pages=()):
        self.calls: list[int] = []
        self._fail = set(fail_pages)

    def ocr_page(self, pdf_bytes: bytes, page_index: int) -> OcrPageResult:
        self.calls.append(page_index)
        if page_index in self._fail:
            raise OcrError(f"sayfa {page_index + 1} okunamadı")
        return OcrPageResult(text=f"{OCR_BODY} (s. {page_index + 1})", confidence=0.93, engine=self.name)


def _slice(text: str, start: int, end: int) -> str:
    return "".join(list(text)[start:end])


def _by_label(outcome):
    return {segment.locator_label: segment for segment in outcome.segments}


# ---------------------------------------------------------------------------
# #25 — an image-backed page with a short text layer is not a read page
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("how", ["xobject", "form", "inline"])
def test_a_scan_carrying_only_a_signature_footer_is_not_read_without_ocr(how):
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page(how=how)])
    outcome = extract_mod.extract_pdf(data, ocr=None)

    page = _by_label(outcome)["2"]
    # Before W21 this page was EXTRACTED via its text layer: the review then
    # counted it as fully read and could call the file completely read.
    assert page.extraction_status == "SPARSE"
    assert page.extraction_method == "pdf_text_layer"
    # The footer itself stays citable — it IS on the page.
    assert "Doğrulama kodu" in _slice(outcome.text, page.start_char, page.end_char)
    assert outcome.page_stats.sparse_pages == (2,)
    assert outcome.page_stats.empty_pages == ()
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
    # R2-32: the sentence no longer calls the page a scan whose image text was
    # not read (a born-digital page over a letterhead image looks the same).
    sentence = next(w for w in outcome.warnings if "sayfanın büyük bölümünü kaplayan bir görüntü" in w)
    assert "taranmış" not in sentence
    assert "sayfa 2" in sentence
    assert "tamamının okunduğu doğrulanmadı" in sentence
    # The born-digital page next to it is untouched.
    assert _by_label(outcome)["1"].extraction_status == "EXTRACTED"


def test_with_local_ocr_the_scan_is_read_and_its_footer_is_kept_in_the_same_page_slot():
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page()])
    fake = FakeOcr()
    outcome = extract_mod.extract_pdf(data, ocr=fake)

    assert fake.calls == [1]  # the image-backed page, not the text page
    page = _by_label(outcome)["2"]
    assert page.extraction_method == "ocr"
    assert page.extraction_status == "EXTRACTED"
    body = _slice(outcome.text, page.start_char, page.end_char)
    # The exact text-layer characters come first (OCR may garble a code the
    # text layer holds verbatim), then what OCR read in the image.
    assert body.startswith(SIGNATURE_FOOTER[0][:30])
    assert "Doğrulama kodu: AB12-CD34-EF56" in body
    assert "kira bedelinin 45.000 TL" in body
    assert outcome.page_stats.ocr_pages == (2,)
    assert outcome.page_stats.sparse_pages == ()
    assert not any(w.startswith("IMAGE_TEXT_PAGES") for w in outcome.warnings)


def test_ocr_that_cannot_read_the_scan_leaves_it_sparse_and_names_the_real_cause():
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page()])
    outcome = extract_mod.extract_pdf(data, ocr=FakeOcr(fail_pages={1}))
    assert _by_label(outcome)["2"].extraction_status == "SPARSE"
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
    assert "OCR_FAILED_PAGES:1" in outcome.warnings
    # R2-32: new wording of the same warning (see the test above).
    sentence = next(w for w in outcome.warnings if "sayfanın büyük bölümünü kaplayan bir görüntü" in w)
    assert "yerel OCR bu sayfaları okuyamadı" in sentence
    assert "OCR yok" not in sentence


def test_a_born_digital_page_with_a_small_logo_is_not_flagged():
    # A letterhead logo (60 x 30 pt) next to a short but real text layer.
    data = build_image_pdf([{"lines": list(TEXT_PAGE), "image": (60, 30)}])
    fake = FakeOcr()
    outcome = extract_mod.extract_pdf(data, ocr=fake)
    assert fake.calls == []
    assert outcome.segments[0].extraction_status == "EXTRACTED"
    assert outcome.segments[0].extraction_method == "pdf_text_layer"
    assert outcome.page_stats.sparse_pages == ()
    assert not any(w.startswith("IMAGE_TEXT_PAGES") for w in outcome.warnings)


def test_a_long_text_layer_over_a_page_image_is_body_text_and_never_re_read():
    data = build_image_pdf([{"lines": list(TEXT_PAGE) * 8, "image": (595, 842)}])
    fake = FakeOcr()
    outcome = extract_mod.extract_pdf(data, ocr=fake)
    assert fake.calls == []
    assert outcome.segments[0].extraction_status == "EXTRACTED"


def test_a_page_whose_drawing_cannot_be_analysed_but_names_an_image_counts_as_a_possible_scan(monkeypatch):
    from io import BytesIO

    from pypdf import PdfReader
    from pypdf._page import PageObject

    reader = PdfReader(BytesIO(build_image_pdf([scanned_page()])))
    page = reader.pages[0]

    def broken(self):
        raise ValueError("content stream could not be parsed")

    monkeypatch.setattr(PageObject, "get_contents", broken)
    # Unknown is treated as "possibly a scan", never as a fully read page.
    assert extract_mod._page_image_coverage(page, reader) == 1.0


@pytest.mark.parametrize("tiles", [3, 8])
def test_a_scan_cut_into_strips_is_an_image_page(tiles):
    # A scanner (or MRC compressor) that writes the page as strips draws no
    # single image over half the page. Before the fix the largest strip was
    # measured, so this page was EXTRACTED by its footer and called read.
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page(tiles=tiles)])
    outcome = extract_mod.extract_pdf(data, ocr=None)
    page = _by_label(outcome)["2"]
    assert page.extraction_status == "SPARSE"
    assert outcome.page_stats.sparse_pages == (2,)
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings

    fake = FakeOcr()
    with_ocr = extract_mod.extract_pdf(data, ocr=fake)
    assert fake.calls == [1]
    assert _by_label(with_ocr)["2"].extraction_method == "ocr"


def test_a_few_small_images_still_do_not_add_up_to_a_scan():
    # Summing the drawn images must not turn a letterhead into a scan.
    data = build_image_pdf([{"lines": list(TEXT_PAGE), "image": (60, 30), "tiles": 2}])
    fake = FakeOcr()
    outcome = extract_mod.extract_pdf(data, ocr=fake)
    assert fake.calls == []
    assert outcome.segments[0].extraction_status == "EXTRACTED"
    assert not any(w.startswith("IMAGE_TEXT_PAGES") for w in outcome.warnings)


@pytest.mark.parametrize("image_ref", ["99 0 R", "42", "[1 2 3]"])
def test_a_broken_image_entry_never_crashes_the_intake(image_ref):
    # Regression of the #25 fix: a page with a short text layer whose
    # /XObject entry is a dangling reference (pypdf resolves it to None) or
    # not a dictionary raised an uncaught AttributeError from
    # _page_image_coverage — POST /v1/files answered 500 and `intake.cli
    # --dir` aborted the whole batch — for a PDF whose text layer reads fine.
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page(image_ref=image_ref)])
    fake = FakeOcr()
    outcome = extract_mod.extract_text("pdf", data, ocr=fake)
    # Nothing drawable is named, so no renderer (and no OCR) could see an
    # image there: the page is what its text layer says.
    assert fake.calls == []
    page = _by_label(outcome)["2"]
    assert page.extraction_method == "pdf_text_layer"
    assert "Doğrulama kodu" in _slice(outcome.text, page.start_char, page.end_char)
    assert not any(w.startswith("IMAGE_TEXT_PAGES") for w in outcome.warnings)


def test_image_coverage_never_raises_on_unreadable_resources():
    from io import BytesIO

    from pypdf import PdfReader
    from pypdf.generic import NameObject, NumberObject

    reader = PdfReader(BytesIO(build_image_pdf([scanned_page()])))
    page = reader.pages[0]
    page[NameObject("/Resources")] = NumberObject(7)
    assert extract_mod._page_image_coverage(page, reader) == 0.0


# ---------------------------------------------------------------------------
# #29 — page statistics describe what was read, AFTER OCR
# ---------------------------------------------------------------------------


def test_pages_local_ocr_read_are_not_reported_as_empty():
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=2, empty_pages=3), ocr=FakeOcr())
    stats = outcome.page_stats
    # Before W21: emptyPages [3, 4, 5] and pagesWithText 2, although every
    # one of those pages sat in the canonical text with method 'ocr'.
    assert stats.empty_pages == ()
    assert stats.pages_with_text == 5
    assert stats.ocr_pages == (3, 4, 5)
    assert stats.to_json_dict() == {
        "pageCount": 5,
        "pagesWithText": 5,
        "emptyPages": [],
        "ocrPages": [3, 4, 5],
    }
    assert not any(w.startswith("SCANNED_PAGES") for w in outcome.warnings)


def test_a_page_ocr_failed_on_stays_empty_while_the_others_are_ocr_pages():
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=2, empty_pages=3), ocr=FakeOcr(fail_pages={3}))
    stats = outcome.page_stats
    assert stats.empty_pages == (4,)
    assert stats.ocr_pages == (3, 5)
    assert stats.pages_with_text == 4
    assert "SCANNED_PAGES:1" in outcome.warnings
    assert "OCR_PAGES:2" in outcome.warnings


def test_without_ocr_the_wire_shape_is_unchanged():
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=2, empty_pages=1), ocr=None)
    assert outcome.page_stats.to_json_dict() == {"pageCount": 3, "pagesWithText": 2, "emptyPages": [3]}


# ---------------------------------------------------------------------------
# #30 — one time budget for all OCR of a file, one per page
# ---------------------------------------------------------------------------


class ClockedOcr:
    """Takes ``seconds`` of a fake clock per page and records its timeout."""

    name = "clocked-ocr"

    def __init__(self, clock: list[float], seconds: float):
        self._clock = clock
        self._seconds = seconds
        self.calls: list[int] = []
        self.timeouts: list[float | None] = []

    def ocr_page(self, pdf_bytes: bytes, page_index: int, timeout_s: float | None = None) -> OcrPageResult:
        self.calls.append(page_index)
        self.timeouts.append(timeout_s)
        self._clock[0] += self._seconds
        return OcrPageResult(text=f"{OCR_BODY} (s. {page_index + 1})", confidence=0.9, engine=self.name)


def test_ocr_stops_at_the_file_budget_and_the_pages_it_did_not_reach_stay_unread():
    now = [0.0]
    provider = ClockedOcr(now, seconds=40)
    outcome = extract_mod.extract_pdf(
        mixed_pdf(text_pages=1, empty_pages=5),
        ocr=provider,
        ocr_budget_s=90,
        clock=lambda: now[0],
    )
    # 90 s budget, 40 s a page: pages 2, 3, 4 start (90, 50 and 10 s left);
    # pages 5 and 6 are never started. Each page may take no more than what
    # is left of the file budget.
    assert provider.calls == [1, 2, 3]
    assert provider.timeouts == [90, 50, 10]
    by_label = _by_label(outcome)
    for label in ("5", "6"):
        assert by_label[label].extraction_status == "UNREADABLE"
        assert by_label[label].start_char == by_label[label].end_char
    assert outcome.page_stats.empty_pages == (5, 6)
    assert outcome.page_stats.ocr_pages == (2, 3, 4)
    assert "OCR_BUDGET_EXCEEDED:2" in outcome.warnings
    sentence = next(w for w in outcome.warnings if "süre sınırı" in w)
    assert "sayfa 5, 6" in sentence
    assert "okunmamış sayılır" in sentence


def test_a_budget_spent_before_any_page_fails_closed_and_says_why():
    provider = ClockedOcr([0.0], seconds=1)
    with pytest.raises(ExtractionFailedError) as caught:
        extract_mod.extract_pdf(
            mixed_pdf(text_pages=0, empty_pages=2),
            ocr=provider,
            ocr_budget_s=ocr_mod.OCR_MIN_PAGE_S - 1,
            clock=lambda: 0.0,
        )
    assert provider.calls == []
    warnings = caught.value.warnings
    assert warnings[0] == extract_mod.SCANNED_PDF_OCR_BUDGET_WARNING
    assert extract_mod.SCANNED_PDF_OCR_FAILED_CODE in warnings
    assert "OCR_BUDGET_EXCEEDED:2" in warnings
    assert all("devre dışı" not in w for w in warnings)


def test_the_default_budget_leaves_room_under_the_intake_kill():
    # control-plane/src/files/routes.ts kills the intake at 180 s; OCR may
    # use at most half of it, the rest is text extraction and indexing.
    assert 0 < ocr_mod.OCR_TOTAL_BUDGET_S <= 90
    assert ocr_mod.PAGE_TIMEOUT_S >= ocr_mod.OCR_MIN_PAGE_S


def test_tesseract_gets_only_what_rasterizing_left_of_one_page_budget(monkeypatch):
    now = [100.0]
    seen: list[tuple[str, float]] = []

    class Done:
        def __init__(self, stdout: bytes = b""):
            self.returncode = 0
            self.stdout = stdout
            self.stderr = b""

    def fake_run(args, *, timeout, stdin=None):
        seen.append((Path(args[0]).name, timeout))
        if Path(args[0]).name == "pdftoppm":
            Path(args[-1] + ".png").write_bytes(b"png")
            now[0] += 30  # rasterizing took 30 s
            return Done()
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        return Done((header + "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t91\tkira\n").encode())

    monkeypatch.setattr(ocr_mod, "_run", fake_run)
    monkeypatch.setattr(ocr_mod, "_clock", lambda: now[0])
    provider = ocr_mod.TesseractCliProvider("tesseract", "pdftoppm")
    result = provider.ocr_page(b"%PDF-1.4", 0, timeout_s=50)
    assert result.text == "kira"
    # Before W21 both programs got the full 120 s: one page could take 240 s.
    assert seen == [("pdftoppm", 50.0), ("tesseract", 20.0)]


def test_a_page_with_no_budget_left_is_not_started(monkeypatch):
    def must_not_run(*_args, **_kwargs):
        raise AssertionError("no process may start")

    monkeypatch.setattr(ocr_mod, "_run", must_not_run)
    with pytest.raises(OcrError):
        ocr_mod.TesseractCliProvider("tesseract", "pdftoppm").ocr_page(b"%PDF-1.4", 0, timeout_s=0)


def test_a_provider_written_before_the_budget_still_works():
    assert extract_mod._accepts_timeout(ClockedOcr([0.0], 1)) is True
    assert extract_mod._accepts_timeout(FakeOcr()) is False
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=1, empty_pages=1), ocr=FakeOcr())
    assert outcome.page_stats.ocr_pages == (2,)


def test_sigterm_during_ocr_unwinds_through_the_running_child_and_is_restored():
    before = signal.getsignal(signal.SIGTERM)
    with ocr_mod.sigterm_stops_ocr(enabled=True):
        assert signal.getsignal(signal.SIGTERM) is ocr_mod._on_sigterm
        with pytest.raises(SystemExit) as caught:
            ocr_mod._on_sigterm(signal.SIGTERM, None)
        assert caught.value.code == 128 + signal.SIGTERM
    assert signal.getsignal(signal.SIGTERM) is before
    # Off (Windows default): nothing is installed.
    with ocr_mod.sigterm_stops_ocr(enabled=False):
        assert signal.getsignal(signal.SIGTERM) is before


def test_a_page_with_no_image_resources_is_not_parsed_for_images(monkeypatch):
    """W21 review: a page with a short text layer, no XObject and no inline
    image operator cannot be image-backed, so its content stream is not
    parsed a second time (that doubled the text-layer time on large vector
    PDFs). The inline-image case stays covered by the parametrized test above.
    """
    import io

    from pypdf import PdfReader

    from tests.intake.pdf_fixtures import build_multipage_pdf

    reader = PdfReader(io.BytesIO(build_multipage_pdf([["kısa satır"]])))
    calls = []
    monkeypatch.setattr(extract_mod, "_drawn_image_area", lambda *args, **kwargs: calls.append(1) or 0.0)
    assert extract_mod._page_image_coverage(reader.pages[0], reader) == 0.0
    assert calls == []


def test_intake_result_reports_ocr_when_local_ocr_read_a_page():
    """W21 (#29): the raw intake JSON said ``extraction.ocr: false`` even when
    local OCR read pages; it now follows ``ocrPages`` / ``OCR_PAGES:n``."""
    from intake.extract import PageStats
    from intake.ingest import IntakeResult

    def result(**extra):
        base = dict(
            file_id="f", name="a.pdf", mime="application/pdf", sha256="0" * 64,
            size_bytes=1, kind="pdf", chars=10, chunk_count=1, pages=2, analysis={},
        )
        base.update(extra)
        return IntakeResult(**base).to_json_dict()["extraction"]["ocr"]

    assert result() is False
    assert result(page_stats=PageStats(page_count=2, pages_with_text=2, empty_pages=())) is False
    assert result(page_stats=PageStats(page_count=2, pages_with_text=2, empty_pages=(), ocr_pages=(2,))) is True
    assert result(warnings=["OCR_PAGES:1"]) is True
    assert result(warnings=["OCR_PAGES:0", "SCANNED_PAGES:1"]) is False
