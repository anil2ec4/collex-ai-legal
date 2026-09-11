"""W20 acceptance K: local OCR keeps the ORIGINAL page identity.

A scanned page OCR'd through the provider boundary lands in its own page
slot of the canonical text, carries ``extraction_method='ocr'`` and the
engine's confidence, and is cited as "s. N" like any text-layer page. When
OCR is unavailable (or fails), the page stays UNREADABLE and coverage stays
incomplete — exactly the W19 behaviour.

The provider here is a FAKE (a test double). It proves the boundary and the
provenance mapping, not recognition quality. A real Tesseract smoke test runs
only when the executables and Turkish language data exist on this machine;
otherwise it is skipped with an explicit environment-blocker reason.
"""

from __future__ import annotations

import shutil

import pytest

from intake import extract as extract_mod
from intake.errors import ExtractionFailedError
from intake.ocr import (
    LOW_CONFIDENCE,
    OcrError,
    OcrPageResult,
    detect_ocr_capability,
    parse_tesseract_tsv,
    resolve_ocr_provider,
)
from tests.intake.pdf_fixtures import build_multipage_pdf, mixed_pdf


class FakeOcr:
    """Recognizes a fixed text per page index; can fail or be unsure."""

    name = "fake-ocr"

    def __init__(self, *, fail_pages=(), low_confidence_pages=()):
        self.calls: list[int] = []
        self._fail = set(fail_pages)
        self._low = set(low_confidence_pages)

    def ocr_page(self, pdf_bytes: bytes, page_index: int) -> OcrPageResult:
        self.calls.append(page_index)
        if page_index in self._fail:
            raise OcrError(f"sayfa {page_index + 1} okunamadı")
        confidence = 0.35 if page_index in self._low else 0.91
        return OcrPageResult(
            text=f"Taranmış sayfa {page_index + 1}: tahliye ihtarı 11.03.2024 tarihinde tebliğ edilmiştir ve kira bedeli 45.000 TL olarak ödenmiştir.",
            confidence=confidence,
            engine=self.name,
        )


def _slice(text: str, start: int, end: int) -> str:
    return "".join(list(text)[start:end])


def test_ocr_text_lands_in_its_own_page_slot_with_method_ocr():
    data = mixed_pdf(text_pages=2, empty_pages=3)  # pages 3-5 have no text layer
    fake = FakeOcr()
    outcome = extract_mod.extract_pdf(data, ocr=fake)

    assert fake.calls == [2, 3, 4]  # only the pages with no text layer
    by_label = {segment.locator_label: segment for segment in outcome.segments}
    assert [s.locator_label for s in outcome.segments] == ["1", "2", "3", "4", "5"]
    for label in ("3", "4", "5"):
        segment = by_label[label]
        assert segment.extraction_method == "ocr"
        assert segment.extraction_status == "EXTRACTED"
        assert segment.confidence == pytest.approx(0.91)
        # The page's range slices the canonical text back to what OCR read
        # on THAT page: provenance is the physical page, not a shadow copy.
        assert _slice(outcome.text, segment.start_char, segment.end_char).startswith(
            f"Taranmış sayfa {label}:"
        )
    for label in ("1", "2"):
        assert by_label[label].extraction_method == "pdf_text_layer"
        assert by_label[label].confidence is None
    assert any(w.startswith("OCR_PAGES:3") for w in outcome.warnings)


def test_a_fully_scanned_pdf_is_ingested_when_local_ocr_reads_it():
    data = mixed_pdf(text_pages=0, empty_pages=2)
    outcome = extract_mod.extract_pdf(data, ocr=FakeOcr())
    assert [s.extraction_method for s in outcome.segments] == ["ocr", "ocr"]
    assert "Taranmış sayfa 2:" in outcome.text


def test_without_ocr_a_fully_scanned_pdf_still_fails_closed():
    data = mixed_pdf(text_pages=0, empty_pages=2)
    with pytest.raises(ExtractionFailedError) as caught:
        extract_mod.extract_pdf(data, ocr=None)
    assert extract_mod.SCANNED_PDF_WARNING in caught.value.warnings


def test_a_page_ocr_could_not_read_stays_unreadable():
    data = mixed_pdf(text_pages=1, empty_pages=2)  # pages 2-3 scanned
    outcome = extract_mod.extract_pdf(data, ocr=FakeOcr(fail_pages={2}))
    by_label = {s.locator_label: s for s in outcome.segments}
    assert by_label["2"].extraction_method == "ocr"
    assert by_label["3"].extraction_method == "none"
    assert by_label["3"].extraction_status == "UNREADABLE"
    assert by_label["3"].start_char == by_label["3"].end_char
    assert any("OCR" in w and "3" in w for w in outcome.warnings)


def test_low_confidence_ocr_is_read_but_never_verified():
    data = mixed_pdf(text_pages=1, empty_pages=1)
    outcome = extract_mod.extract_pdf(data, ocr=FakeOcr(low_confidence_pages={1}))
    page = next(s for s in outcome.segments if s.locator_label == "2")
    assert page.extraction_method == "ocr"
    assert page.confidence is not None and page.confidence < LOW_CONFIDENCE
    assert page.extraction_status == "SPARSE"


def test_text_layer_pages_are_never_sent_to_ocr():
    data = build_multipage_pdf([["Sayfa 1", "Bu sayfanın metin katmanı vardır ve okunabilir durumdadır."]])
    fake = FakeOcr()
    outcome = extract_mod.extract_pdf(data, ocr=fake)
    assert fake.calls == []
    assert outcome.segments[0].extraction_method == "pdf_text_layer"


def test_detection_never_guesses(monkeypatch):
    assert detect_ocr_capability({"COLLEX_OCR": "off"}).available is False
    assert detect_ocr_capability({"COLLEX_OCR": "bulut"}).available is False
    monkeypatch.setattr(shutil, "which", lambda name: None)
    capability = detect_ocr_capability({})
    assert capability.available is False
    assert "tesseract" in capability.reason
    assert resolve_ocr_provider({}) is None


def test_tesseract_tsv_is_rebuilt_in_reading_order_with_mean_confidence():
    header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
    rows = [
        "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t90\tKira",
        "5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t80\tbedeli",
        "5\t1\t1\t1\t2\t1\t0\t0\t1\t1\t70\tödenmiştir.",
        "4\t1\t1\t1\t2\t0\t0\t0\t1\t1\t-1\t",
    ]
    result = parse_tesseract_tsv("\n".join([header, *rows]))
    assert result.text == "Kira bedeli\nödenmiştir."
    assert result.confidence == pytest.approx(0.8)


@pytest.mark.skipif(
    not detect_ocr_capability({}).available,
    reason="ENVIRONMENT BLOCKER: no local OCR runtime (tesseract + pdftoppm + tur)"
    " on this machine; the real one-page OCR smoke test did not run",
)
def test_real_local_ocr_smoke_one_page():  # pragma: no cover - environment dependent
    provider = resolve_ocr_provider({})
    assert provider is not None
    data = mixed_pdf(text_pages=0, empty_pages=1)
    # An empty page recognizes to (near) nothing; the point is that the real
    # engine runs end to end through the boundary without error.
    result = provider.ocr_page(data, 0)
    assert isinstance(result.text, str)
