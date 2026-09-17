"""W21 round-two review: what local OCR adds to a page, and what it may claim.

* R2-32 — an image-backed page with a SHORT but real text layer (a cover or
  signature page over a letterhead image, the short page of a searchable scan)
  went to OCR, and the OCR re-reading of the same sentences — misreadings
  included — was stored as a second citable copy on the same page. Without OCR
  the page's warning called it a scan whose image text was not read. Round
  three: the first fix dropped DISTINCT short lines (a lone date next to a
  footer's close date) silently and let an OCR echo of a 150+ character
  footer vouch for a faint scan; near matches are now withheld and flagged,
  and an echo never vouches.
* R2-33 — a page local OCR read with low confidence, or only a few characters
  of, was stored SPARSE but reported as fully converted: not in
  ``sparsePages``, no warning beyond "read by OCR".
* R2-35 — when the drawing of a page could not be analysed, only a direct
  image XObject counted as a possible scan; a scan wrapped in a Form XObject
  or drawn inline was "not a scan", and an indirect /Matrix made the analysis
  fail on a spec-valid file.

The OCR providers here are fakes: they prove what reaches the canonical text,
the page statuses and the warnings, not recognition quality.
"""

from __future__ import annotations

from io import BytesIO

import pytest

from intake import extract as extract_mod
from intake.ocr import OcrPageResult
from tests.intake.pdf_fixtures import (
    SIGNATURE_FOOTER,
    TEXT_PAGE,
    build_image_pdf,
    mixed_pdf,
    scanned_page,
)

#: A short born-digital page (about 230 characters): a cover or closing page.
SHORT_PAGE = [
    "Karar tarihi 12.03.2024 olup ödeme tutarı 1.500.000 TL olarak belirlenmiştir.",
    "Taraflar arasındaki sözleşme gereği bu tutar otuz gün içinde ödenecektir ve",
    "gecikme halinde yasal faiz uygulanacaktır. İmza: Av. Deneme Soyadı, Ankara.",
]
#: What tesseract makes of the same page: the same sentences, two digits wrong.
SHORT_PAGE_MISREAD = "\n".join(SHORT_PAGE).replace("12.03.2024", "12.08.2024").replace("1.500.000", "1.500.600")

SCAN_BODY = (
    "T.C. İSTANBUL 3. ASLİYE HUKUK MAHKEMESİ — davacı vekilinin dilekçesi incelendi;\n"
    "kira bedelinin 45.000 TL olarak ödendiği tespit edilmiştir."
)


class FixedOcr:
    """Reads the same text, at the same confidence, on every page it is asked about."""

    name = "fixed-ocr"

    def __init__(self, text: str, confidence: float):
        self.text = text
        self.confidence = confidence
        self.calls: list[int] = []

    def ocr_page(self, pdf_bytes: bytes, page_index: int) -> OcrPageResult:
        self.calls.append(page_index)
        return OcrPageResult(text=self.text, confidence=self.confidence, engine=self.name)


def _by_label(outcome):
    return {segment.locator_label: segment for segment in outcome.segments}


def _slice(text: str, start: int, end: int) -> str:
    return "".join(list(text)[start:end])


def _short_page_pdf() -> bytes:
    return build_image_pdf([{"lines": list(SHORT_PAGE), "image": (595, 842)}])


# ---------------------------------------------------------------------------
# R2-32 — OCR never adds a second (misread) copy of the text layer
# ---------------------------------------------------------------------------


def test_ocr_that_only_rereads_a_short_page_adds_no_copy_and_no_misread_value():
    fake = FixedOcr(SHORT_PAGE_MISREAD, confidence=0.91)
    outcome = extract_mod.extract_pdf(_short_page_pdf(), ocr=fake)

    assert fake.calls == [0]  # the page IS a candidate: a short layer over a page image
    # Before the fix the page held both "1.500.000 TL" and "1.500.600 TL": the
    # misread value was a unique, verifiable quote on a page whose exact text
    # was already readable.
    assert "1.500.600" not in outcome.text
    assert "12.08.2024" not in outcome.text
    for line in SHORT_PAGE:
        assert outcome.text.count(line) == 1
    page = outcome.segments[0]
    # A text-layer page, never an OCR page. Round three: SPARSE, not EXTRACTED
    # (the earlier pin was an overclaim) — an echo cannot vouch for the image:
    # a faint scan whose OCR re-read only its footer looks exactly the same.
    assert (page.extraction_method, page.extraction_status) == ("pdf_text_layer", "SPARSE")
    assert page.confidence is None
    assert outcome.page_stats.ocr_pages == ()
    assert outcome.page_stats.sparse_pages == (1,)
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
    assert not any(w.startswith(("OCR_PAGES", "OCR_WITHHELD_LINES_PAGES")) for w in outcome.warnings)


def test_a_low_confidence_echo_cannot_vouch_for_the_page_image():
    outcome = extract_mod.extract_pdf(_short_page_pdf(), ocr=FixedOcr(SHORT_PAGE_MISREAD, confidence=0.4))
    assert "1.500.600" not in outcome.text
    page = outcome.segments[0]
    assert (page.extraction_method, page.extraction_status) == ("pdf_text_layer", "SPARSE")
    assert outcome.page_stats.sparse_pages == (1,)
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
    sentence = next(w for w in outcome.warnings if "sayfanın büyük bölümünü kaplayan bir görüntü" in w)
    assert "yerel OCR görüntüde bu kısa metinden başka yazı bulmadı" in sentence
    assert "tamamının okunduğu doğrulanmadı" in sentence


def test_without_ocr_a_short_page_over_an_image_is_never_called_an_unread_scan():
    outcome = extract_mod.extract_pdf(_short_page_pdf(), ocr=None)
    page = outcome.segments[0]
    # Still not counted as fully read: nothing checked the image.
    assert (page.extraction_method, page.extraction_status) == ("pdf_text_layer", "SPARSE")
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
    sentence = next(w for w in outcome.warnings if "sayfa 1" in w)
    # Before the fix: "taranmış bir görüntüden oluşuyor … görüntüdeki yazı
    # okunmadı" — false for a born-digital page over a letterhead image.
    assert "taranmış" not in sentence
    assert "görüntüdeki yazı okunmadı" not in sentence
    assert "görüntüde başka yazı olup olmadığı doğrulanamadı" in sentence
    assert "yerel OCR bu okumada kullanılmadı" in sentence


def test_ocr_of_a_scan_adds_the_body_but_not_a_misread_copy_of_the_footer():
    # Round three: the misreading sits in the LONG footer line, whose exact
    # words show that it re-reads that line. A misread code on the short
    # "Doğrulama kodu" line is withheld and flagged instead (see below).
    footer_misread = "\n".join(SIGNATURE_FOOTER).replace("güvenli", "güvenIi")
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page()])
    outcome = extract_mod.extract_pdf(data, ocr=FixedOcr(f"{SCAN_BODY}\n{footer_misread}", confidence=0.9))

    page = _by_label(outcome)["2"]
    assert (page.extraction_method, page.extraction_status) == ("ocr", "EXTRACTED")
    body = _slice(outcome.text, page.start_char, page.end_char)
    assert "kira bedelinin 45.000 TL" in body  # what the image adds
    assert body.count("Doğrulama kodu") == 1  # the exact text layer, once
    assert "AB12-CD34-EF56" in body
    assert "güvenIi" not in outcome.text  # never the misread copy
    assert body.count("güvenli elektronik imza") == 1
    assert outcome.page_stats.ocr_pages == (2,)
    assert outcome.page_stats.sparse_pages == ()
    assert not any(w.startswith("OCR_WITHHELD_LINES_PAGES") for w in outcome.warnings)


def test_an_echo_of_a_footer_does_not_make_a_scan_read():
    # A faint scan: OCR re-reads the crisp digital footer confidently and finds
    # no words in the body. A footer is not a page body, so the page stays
    # "not fully read" — the #25 overclaim must not come back through OCR.
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page()])
    outcome = extract_mod.extract_pdf(data, ocr=FixedOcr("\n".join(SIGNATURE_FOOTER), confidence=0.96))
    page = _by_label(outcome)["2"]
    assert (page.extraction_method, page.extraction_status) == ("pdf_text_layer", "SPARSE")
    assert outcome.text.count("Doğrulama kodu") == 1
    assert outcome.page_stats.sparse_pages == (2,)
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings


def test_ocr_lines_the_text_layer_does_not_hold_are_kept_in_reading_order():
    beyond = extract_mod._ocr_text_beyond_layer(
        "\n".join(SIGNATURE_FOOTER),
        "ANKARA BAROSU\n" + "\n".join(SIGNATURE_FOOTER) + "\nAsıl gibidir — mühür",
    )
    assert beyond == "ANKARA BAROSU\nAsıl gibidir — mühür"
    # No text layer: OCR text comes back unchanged.
    assert extract_mod._ocr_text_beyond_layer("", SCAN_BODY) == SCAN_BODY
    # Only copies: nothing beyond the layer.
    assert extract_mod._ocr_text_beyond_layer("\n".join(SHORT_PAGE), SHORT_PAGE_MISREAD) is None


# ---------------------------------------------------------------------------
# R2-32 round three — a near match is never silently a copy, an echo never
# vouches
# ---------------------------------------------------------------------------

#: A UYAP-style e-signature footer (~200 characters): longer than the 150
#: characters the previous round let an echo vouch for.
UYAP_FOOTER = [
    "Bu belge 5070 sayılı Elektronik İmza Kanunu uyarınca güvenli elektronik imza ile imzalanmıştır.",
    "Belgenin aslına https://vatandas.uyap.gov.tr adresinden AB12CD3 - EF45GH6 - IJ78KL9 kodu ile erişebilirsiniz.",
]
#: A footer naming the signing date.
DATED_FOOTER = [
    "Bu belge 5070 sayılı Kanun uyarınca 12.03.2024 tarihinde güvenli elektronik imza ile imzalanmıştır.",
    "Doğrulama kodu: AB12-CD34-EF56",
]
PETITION_BODY = [
    "ANKARA NÖBETÇİ İŞ MAHKEMESİ HAKİMLİĞİNE",
    "Müvekkilin işten çıkarılması üzerine kıdem ve ihbar tazminatının ödenmesi talep edilmektedir.",
    "Yukarıda açıklanan nedenlerle davanın kabulüne karar verilmesini saygıyla arz ederiz.",
    "11.03.2024",
    "Davacı Vekili",
    "Av. Deneme Soyadı",
]


def _scan_with(lines: list[str]) -> bytes:
    return build_image_pdf([{"lines": list(TEXT_PAGE)}, {"lines": lines, "image": (595, 842)}])


def test_a_lone_date_of_the_scan_is_kept_when_the_footer_holds_a_close_date():
    # A scanned petition uploaded to UYAP: the footer says 12.03.2024, the
    # lawyer's own date line above "Davacı Vekili" says 11.03.2024. Before
    # round three the fuzzy copy test dropped the body's date silently and the
    # page stayed ocr/EXTRACTED.
    outcome = extract_mod.extract_pdf(
        _scan_with(DATED_FOOTER), ocr=FixedOcr("\n".join(PETITION_BODY + DATED_FOOTER), confidence=0.9)
    )
    page = _by_label(outcome)["2"]
    body = _slice(outcome.text, page.start_char, page.end_char)
    assert "11.03.2024" in body
    assert body.count("12.03.2024") == 1  # the footer, once
    assert (page.extraction_method, page.extraction_status) == ("ocr", "EXTRACTED")
    assert outcome.page_stats.sparse_pages == ()
    assert not any(w.startswith("OCR_WITHHELD_LINES_PAGES") for w in outcome.warnings)


def test_a_lone_value_near_a_text_layer_value_nothing_re_read_is_withheld_and_flagged():
    # The stamp says "Tutar 1.500.000 TL"; OCR did not re-read it but read a
    # lone "1.500.600 TL": a misread copy (a table cell) and a distinct amount
    # look the same. Before round three it vanished with the page EXTRACTED.
    scan_body = "T.C. ANKARA 5. İŞ MAHKEMESİ\n" + PETITION_BODY[1] + "\nDuruşma tarihi:\n12.08.2024\n1.500.600 TL"
    outcome = extract_mod.extract_pdf(
        _scan_with(DATED_FOOTER + ["Tutar 1.500.000 TL"]),
        ocr=FixedOcr(scan_body + "\n" + "\n".join(DATED_FOOTER), confidence=0.92),
    )
    page = _by_label(outcome)["2"]
    body = _slice(outcome.text, page.start_char, page.end_char)
    assert "1.500.600" not in outcome.text  # never citable
    assert "12.08.2024" in body  # the footer's own date was re-read: a distinct date
    assert PETITION_BODY[1] in body
    assert (page.extraction_method, page.extraction_status) == ("ocr", "SPARSE")
    assert outcome.page_stats.sparse_pages == (2,)
    assert outcome.page_stats.ocr_pages == (2,)
    assert "OCR_WITHHELD_LINES_PAGES:1" in outcome.warnings
    sentence = next(w for w in outcome.warnings if "metne eklenmedi" in w)
    assert "sayfa 2" in sentence
    assert "«1.500.600 TL»" in sentence  # never hidden either
    assert "aramada çıkmaz ve alıntılanamaz" in sentence
    assert "tamamının okunduğu doğrulanmadı" in sentence


def test_the_same_value_line_is_kept_once_ocr_re_read_the_text_layer_value():
    # A text-layer word can be re-read once: with "Tutar 1.500.000 TL" re-read
    # exactly, the lone "1.500.600 TL" cannot be a second re-reading of it.
    outcome = extract_mod.extract_pdf(
        _scan_with(DATED_FOOTER + ["Tutar 1.500.000 TL"]),
        ocr=FixedOcr(
            PETITION_BODY[1] + "\n1.500.600 TL\n" + "\n".join(DATED_FOOTER) + "\nTutar 1.500.000 TL",
            confidence=0.92,
        ),
    )
    page = _by_label(outcome)["2"]
    body = _slice(outcome.text, page.start_char, page.end_char)
    assert "1.500.600 TL" in body
    assert body.count("1.500.000 TL") == 1
    assert (page.extraction_method, page.extraction_status) == ("ocr", "EXTRACTED")
    assert not any(w.startswith("OCR_WITHHELD_LINES_PAGES") for w in outcome.warnings)


def test_a_case_number_line_one_digit_off_is_never_dropped_silently():
    split = extract_mod._split_ocr_lines("ESAS NO : 2024/123", "ESAS NO : 2024/128")
    # Two exact words are not enough to call "2024/128" a misreading.
    assert split.added is None
    assert split.withheld == ("ESAS NO : 2024/128",)

    outcome = extract_mod.extract_pdf(
        _scan_with(["ESAS NO : 2024/123"]), ocr=FixedOcr(SCAN_BODY + "\nESAS NO : 2024/128", confidence=0.9)
    )
    page = _by_label(outcome)["2"]
    assert "2024/128" not in outcome.text
    assert page.extraction_status == "SPARSE"
    assert "OCR_WITHHELD_LINES_PAGES:1" in outcome.warnings
    assert any("«ESAS NO : 2024/128»" in w for w in outcome.warnings)

    # OCR read nothing but that line: still a text-layer page, and the image
    # sentence does not claim OCR found nothing else.
    only = extract_mod.extract_pdf(_scan_with(["ESAS NO : 2024/123"]), ocr=FixedOcr("ESAS NO : 2024/128", confidence=0.9))
    page = _by_label(only)["2"]
    assert (page.extraction_method, page.extraction_status) == ("pdf_text_layer", "SPARSE")
    assert "2024/128" not in only.text
    assert {"IMAGE_TEXT_PAGES:1", "OCR_WITHHELD_LINES_PAGES:1"} <= set(only.warnings)
    sentence = next(w for w in only.warnings if "sayfanın büyük bölümünü kaplayan bir görüntü" in w)
    assert "başka yazı bulmadı" not in sentence
    assert "metne eklenmeyen satırlar okudu" in sentence


def test_a_misread_code_on_its_own_short_line_is_withheld_not_cited():
    footer_misread = "\n".join(SIGNATURE_FOOTER).replace("AB12-CD34-EF56", "AB12-CD34-EF5G")
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page()])
    outcome = extract_mod.extract_pdf(data, ocr=FixedOcr(f"{SCAN_BODY}\n{footer_misread}", confidence=0.9))
    page = _by_label(outcome)["2"]
    body = _slice(outcome.text, page.start_char, page.end_char)
    assert "EF5G" not in outcome.text
    assert body.count("Doğrulama kodu: AB12-CD34-EF56") == 1  # the exact text layer
    assert "kira bedelinin 45.000 TL" in body
    assert (page.extraction_method, page.extraction_status) == ("ocr", "SPARSE")
    assert "OCR_WITHHELD_LINES_PAGES:1" in outcome.warnings


def test_a_long_footer_line_with_a_misread_code_is_still_a_copy():
    misread = "\n".join(UYAP_FOOTER).replace("EF45GH6", "EF45GHG")
    outcome = extract_mod.extract_pdf(_scan_with(UYAP_FOOTER), ocr=FixedOcr(f"{SCAN_BODY}\n{misread}", confidence=0.93))
    page = _by_label(outcome)["2"]
    assert "EF45GHG" not in outcome.text
    assert (page.extraction_method, page.extraction_status) == ("ocr", "EXTRACTED")
    assert not any(w.startswith("OCR_WITHHELD_LINES_PAGES") for w in outcome.warnings)


def test_an_echo_of_a_real_length_e_signature_footer_does_not_make_a_scan_read():
    assert len("\n".join(UYAP_FOOTER)) > 200
    # A faint or handwritten scan: OCR read nothing but the crisp footer.
    # Before round three a text layer of 150+ characters let this echo vouch:
    # pdf_text_layer EXTRACTED, no warning, no trace.
    outcome = extract_mod.extract_pdf(_scan_with(UYAP_FOOTER), ocr=FixedOcr("\n".join(UYAP_FOOTER), confidence=0.95))
    page = _by_label(outcome)["2"]
    assert (page.extraction_method, page.extraction_status) == ("pdf_text_layer", "SPARSE")
    assert outcome.page_stats.sparse_pages == (2,)
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
    sentence = next(w for w in outcome.warnings if "sayfanın büyük bölümünü kaplayan bir görüntü" in w)
    assert "başka yazı olmadığını göstermez" in sentence
    assert "tamamının okunduğu doğrulanmadı" in sentence


def test_ocr_adding_only_a_letterhead_line_is_not_called_low_confidence():
    outcome = extract_mod.extract_pdf(
        _short_page_pdf(), ocr=FixedOcr("ÖRNEK HUKUK BÜROSU\n" + "\n".join(SHORT_PAGE), confidence=0.9)
    )
    page = outcome.segments[0]
    assert outcome.text.count(SHORT_PAGE[0]) == 1
    assert "ÖRNEK HUKUK BÜROSU" in outcome.text
    # Still not fully read (a faint scan could look the same) …
    assert (page.extraction_method, page.extraction_status) == ("ocr", "SPARSE")
    assert "OCR_LOW_CONFIDENCE_PAGES:1" in outcome.warnings
    # … but the sentence says what happened: before round three it read
    # "düşük güvenle ya da yalnız çok az okundu" at confidence 0.9.
    sentence = next(w for w in outcome.warnings if "eksik ya da belirsiz" in w)
    assert "düşük güven" not in sentence
    assert "kısa metin katmanı okundu" in sentence
    assert "yalnız birkaç karakter buldu" in sentence


def test_a_short_line_of_exact_words_is_kept_and_the_split_explains_itself():
    # Exact words, not word for word: nothing can be misread, so it is kept.
    split = extract_mod._split_ocr_lines("Davacı asil vekili", "Davacı Vekili")
    assert split.added == "Davacı Vekili"
    assert split.withheld == ()
    # A word-for-word copy is dropped, whatever its length.
    assert extract_mod._split_ocr_lines("Davacı Vekili", "DAVACI VEKİLİ").added is None

# ---------------------------------------------------------------------------
# R2-33 — pages OCR barely read, or read with low confidence, are sparse
# ---------------------------------------------------------------------------


def test_a_scan_ocr_read_only_a_header_of_is_sparse_in_the_page_statistics():
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=0, empty_pages=3), ocr=FixedOcr("T.C. ANKARA", confidence=0.31))
    assert [s.extraction_status for s in outcome.segments] == ["SPARSE"] * 3
    stats = outcome.page_stats
    # Before the fix: {pageCount 3, pagesWithText 3, emptyPages [], ocrPages
    # [1, 2, 3]} and nothing else — shown as "fully converted, searchable".
    assert stats.sparse_pages == (1, 2, 3)
    assert stats.ocr_pages == (1, 2, 3)
    assert stats.to_json_dict() == {
        "pageCount": 3,
        "pagesWithText": 3,
        "emptyPages": [],
        "sparsePages": [1, 2, 3],
        "ocrPages": [1, 2, 3],
    }
    assert "OCR_LOW_CONFIDENCE_PAGES:3" in outcome.warnings
    sentence = next(w for w in outcome.warnings if "düşük güvenle" in w)
    assert "sayfa 1, 2, 3" in sentence
    assert "tamamının okunduğu doğrulanmadı" in sentence
    assert "geçmediğini göstermez" in sentence


def test_a_long_but_low_confidence_ocr_page_is_sparse_and_the_confident_one_is_not():
    long_low = SCAN_BODY * 4  # ~450 characters
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=2, empty_pages=1), ocr=FixedOcr(long_low, confidence=0.42))
    assert outcome.page_stats.sparse_pages == (3,)
    assert outcome.page_stats.ocr_pages == (3,)
    assert "OCR_LOW_CONFIDENCE_PAGES:1" in outcome.warnings

    confident = extract_mod.extract_pdf(mixed_pdf(text_pages=2, empty_pages=1), ocr=FixedOcr(long_low, confidence=0.93))
    assert confident.page_stats.sparse_pages == ()
    assert not any(w.startswith("OCR_LOW_CONFIDENCE_PAGES") for w in confident.warnings)


def test_the_page_status_and_the_statistics_use_the_same_verdict():
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=1, empty_pages=2), ocr=FixedOcr("T.C. ANKARA", confidence=0.95))
    sparse_segments = tuple(int(s.locator_label) for s in outcome.segments if s.extraction_status == "SPARSE")
    assert sparse_segments == outcome.page_stats.sparse_pages == (2, 3)


# ---------------------------------------------------------------------------
# R2-35 — an unknown drawing is a possible scan, whatever wraps the image
# ---------------------------------------------------------------------------


def _reader_page(data: bytes, index: int = 0):
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    return reader.pages[index], reader


def test_a_form_with_an_indirect_matrix_and_subtype_is_measured(monkeypatch):
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page(how="form", indirect=True)])
    page, reader = _reader_page(data, 1)
    # The measurement itself resolves the references; the fallback is not what
    # answers here.
    monkeypatch.setattr(extract_mod, "_coverage_when_unanalysable", lambda *_args: 0.0)
    assert extract_mod._page_image_coverage(page, reader) == 1.0


def test_a_form_wrapped_scan_with_an_indirect_matrix_is_not_read_by_its_footer():
    data = build_image_pdf([{"lines": list(TEXT_PAGE)}, scanned_page(how="form", indirect=True)])
    outcome = extract_mod.extract_pdf(data, ocr=None)
    # Before the fix: len(IndirectObject) raised, the fallback saw no /Image
    # and the page was EXTRACTED by its footer with no warning.
    assert _by_label(outcome)["2"].extraction_status == "SPARSE"
    assert outcome.page_stats.sparse_pages == (2,)
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings


@pytest.mark.parametrize("how", ["xobject", "form", "inline"])
def test_a_page_whose_drawing_cannot_be_analysed_counts_as_a_possible_scan(monkeypatch, how):
    page, reader = _reader_page(build_image_pdf([scanned_page(how=how)]))

    def broken(*_args, **_kwargs):
        raise ValueError("a non-numeric cm operand")

    monkeypatch.setattr(extract_mod, "_drawn_image_area", broken)
    assert extract_mod._page_image_coverage(page, reader) == 1.0


def test_an_unreadable_content_stream_is_a_possible_scan(monkeypatch):
    from pypdf._page import PageObject

    page, reader = _reader_page(build_image_pdf([scanned_page(how="inline")]))

    def broken(self):
        raise ValueError("content stream could not be decoded")

    monkeypatch.setattr(PageObject, "get_contents", broken)
    assert extract_mod._page_image_coverage(page, reader) == 1.0


def test_a_page_without_any_image_is_still_not_a_scan_when_analysis_would_fail(monkeypatch):
    from tests.intake.pdf_fixtures import build_multipage_pdf

    page, reader = _reader_page(build_multipage_pdf([["kısa satır"]]))

    def broken(*_args, **_kwargs):
        raise ValueError("a non-numeric cm operand")

    monkeypatch.setattr(extract_mod, "_drawn_image_area", broken)
    # Nothing on the page can draw an image, so there is nothing to analyse.
    assert extract_mod._page_image_coverage(page, reader) == 0.0


# ---------------------------------------------------------------------------
# W21 closing re-check of the lane-D verifier leftovers
# ---------------------------------------------------------------------------


def test_a_printed_older_footer_ahead_of_a_misread_digital_footer_keeps_the_distinct_line():
    # The scan carries a printed copy of an earlier footer (11.03.2024) above
    # the crisp digital one (12.03.2024, the text layer), and OCR misread one
    # letter of the digital one. Before this re-check the older footer claimed
    # the text-layer stretch as a "near copy" (a digit changed), was dropped,
    # and the misread copy of the text layer was ADDED and citable.
    digital = "Bu belge 5070 sayılı Kanun uyarınca 12.03.2024 tarihinde güvenli elektronik imza ile imzalanmıştır."
    printed_older = digital.replace("12.03.2024", "11.03.2024")
    misread_digital = digital.replace("güvenli", "güvenIi")
    split = extract_mod._split_ocr_lines(digital, printed_older + "\n" + misread_digital)
    assert split.added is not None
    assert "11.03.2024" in split.added
    assert "güvenIi" not in split.added
    # the order of the two lines does not matter
    swapped = extract_mod._split_ocr_lines(digital, misread_digital + "\n" + printed_older)
    assert swapped.added is not None and "11.03.2024" in swapped.added and "güvenIi" not in swapped.added


def test_digit_changes_are_distinct_values_and_letter_digit_swaps_are_misreadings():
    assert extract_mod._digit_changed("11.03.2024", "12.03.2024")
    assert extract_mod._digit_changed("2024/1234", "2024/123")
    assert not extract_mod._digit_changed("ef45ghg", "ef45gh6")
    assert not extract_mod._digit_changed("12.03.2o24", "12.03.2024")
    assert not extract_mod._digit_changed("guvenii", "guvenli")


def _nested_form_scan(depth: int) -> bytes:
    """A full-page image drawn through ``depth`` nested Form XObjects, over the
    109-character e-signature footer as the only text layer."""
    from tests.intake.pdf_fixtures import _GLYPH_NAMES, _encode_pdf_text

    diff = " ".join(["128"] + ["/" + g for g in _GLYPH_NAMES])
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [PAGE 0 R] /Count 1 >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 4 0 R >>",
        b"<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [" + diff.encode() + b"] >>",
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream",
    ]
    inner_name, inner_ref = b"/Im1", b"5 0 R"
    for level in range(depth):
        body = inner_name + b" Do\n"
        res = b"<< /XObject << " + inner_name + b" " + inner_ref + b" >> >>"
        objs.append(
            b"<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources " + res
            + b" /Length " + str(len(body)).encode() + b" >>\nstream\n" + body + b"endstream"
        )
        inner_name, inner_ref = f"/Fx{level}".encode(), f"{len(objs)} 0 R".encode()
    stream = bytearray(b"q 595 0 0 842 0 0 cm\n" + inner_name + b" Do\nQ\n")
    stream += b"BT\n/F1 9 Tf\n12 TL\n40 40 Td\n"
    for line in SIGNATURE_FOOTER:
        stream += b"(" + _encode_pdf_text(line) + b") Tj\nT*\n"
    stream += b"ET\n"
    objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + bytes(stream) + b"endstream")
    content = len(objs)
    objs.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << "
        + inner_name + b" " + inner_ref + b" >> >> /Contents " + str(content).encode() + b" 0 R >>"
    )
    page = len(objs)
    objs[1] = objs[1].replace(b"PAGE", str(page).encode())
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


@pytest.mark.parametrize("depth", [1, 3, 4, 6])
def test_a_scan_wrapped_in_forms_deeper_than_followed_is_never_read_by_its_footer(depth):
    from pypdf import PdfReader

    data = _nested_form_scan(depth)
    reader = PdfReader(BytesIO(data))
    assert extract_mod._page_image_coverage(reader.pages[0], reader) == 1.0
    outcome = extract_mod.extract_pdf(data, ocr=None)
    assert outcome.segments[0].extraction_status == "SPARSE"
    assert "IMAGE_TEXT_PAGES:1" in outcome.warnings
