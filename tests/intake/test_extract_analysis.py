"""Extraction + heuristic-analysis unit tests (no database needed)."""

from __future__ import annotations

import pytest

from intake import analysis, extract
from intake.errors import ExtractionFailedError


# --- extraction -------------------------------------------------------------

def test_docx_extracts_paragraphs_and_tables(uploads_dir):
    data = (uploads_dir / "dilekce_ornek.docx").read_bytes()
    outcome = extract.extract_text("docx", data)
    assert "ASLİYE HUKUK MAHKEMESİNE" in outcome.text
    assert "SENTETİK" in outcome.text
    # Table content flattened as "cell | cell | cell" rows.
    assert "Banka dekontu (sentetik) | 12.05.2024" in outcome.text


def test_pdf_extracts_turkish_text_with_pages(uploads_dir):
    data = (uploads_dir / "sozlesme_ornek.pdf").read_bytes()
    outcome = extract.extract_text("pdf", data)
    assert outcome.pages == 1
    assert "SENTETİK HİZMET SÖZLEŞMESİ" in outcome.text
    assert "6098 sayılı Türk Borçlar Kanunu" in outcome.text


def test_txt_utf8_with_bom():
    data = "﻿Türkçe içerik: şğıİÖÜ".encode("utf-8")
    outcome = extract.extract_text("txt", data)
    assert outcome.text.startswith("Türkçe içerik")
    assert not outcome.warnings


def test_txt_windows_1254_fallback_warns():
    data = "Türkçe: şğıİ dilekçe".encode("windows-1254")
    outcome = extract.extract_text("txt", data)
    assert "şğıİ" in outcome.text
    assert any("windows-1254" in w for w in outcome.warnings)


def test_udf_content_xml_extracted(uploads_dir):
    data = (uploads_dir / "udf_ornek.udf").read_bytes()
    outcome = extract.extract_text("udf", data)
    assert "SENTETİK CEVAP DİLEKÇESİ" in outcome.text
    assert "TCK m. 157" in outcome.text


def test_scanned_pdf_fails_closed_with_ocr_warning(uploads_dir):
    data = (uploads_dir / "taranmis.pdf").read_bytes()
    with pytest.raises(ExtractionFailedError) as exc:
        extract.extract_text("pdf", data)
    assert exc.value.kind == "EXTRACTION_FAILED"
    assert extract.SCANNED_PDF_WARNING in exc.value.warnings
    assert "taranmış PDF — OCR bu modda devre dışı" in str(exc.value)


# --- per-page statistics (W12-F) ---------------------------------------------

def test_pdf_page_stats_all_pages_with_text():
    from tests.intake.pdf_fixtures import mixed_pdf

    outcome = extract.extract_text("pdf", mixed_pdf(text_pages=3, empty_pages=0))
    assert outcome.pages == 3
    assert outcome.page_stats is not None
    assert outcome.page_stats.to_json_dict() == {
        "pageCount": 3, "pagesWithText": 3, "emptyPages": [],
    }
    assert outcome.warnings == []


def test_mixed_pdf_keeps_text_pages_and_reports_empty_ones_loudly():
    """The audit case: 1 text page + 9 empty pages used to pass as a clean
    document. Now the text is ingested AND the nine pages are named."""
    from tests.intake.pdf_fixtures import mixed_pdf

    outcome = extract.extract_text("pdf", mixed_pdf(text_pages=1, empty_pages=9))
    assert outcome.pages == 10
    assert "TCK m. 157" in outcome.text
    stats = outcome.page_stats
    assert stats is not None
    assert stats.page_count == 10
    assert stats.pages_with_text == 1
    assert stats.empty_pages == tuple(range(2, 11))
    # Machine code for the console dictionary + a Turkish sentence.
    assert "SCANNED_PAGES:9" in outcome.warnings
    prose = [w for w in outcome.warnings if w.startswith("9 / 10 sayfada")]
    assert prose, outcome.warnings
    assert "sayfa 2, 3, 4, 5, 6, 7, 8, 9, 10" in prose[0]
    assert "OCR bu modda devre dışı" in prose[0]


def test_fully_scanned_multipage_pdf_still_fails_closed():
    from tests.intake.pdf_fixtures import mixed_pdf

    with pytest.raises(ExtractionFailedError) as exc:
        extract.extract_text("pdf", mixed_pdf(text_pages=0, empty_pages=4))
    assert exc.value.kind == "EXTRACTION_FAILED"
    assert extract.SCANNED_PDF_WARNING in exc.value.warnings
    assert "4 sayfa" in str(exc.value)


def test_scanned_pages_sentence_is_bounded():
    stats = extract.PageStats(
        page_count=40, pages_with_text=2, empty_pages=tuple(range(3, 41)),
    )
    sentence = extract.scanned_pages_warning(stats)
    assert sentence.startswith("38 / 40 sayfada")
    assert sentence.count(",") <= 15
    assert "…" in sentence


def test_non_pdf_kinds_have_no_page_stats(uploads_dir):
    data = (uploads_dir / "dilekce_ornek.docx").read_bytes()
    assert extract.extract_text("docx", data).page_stats is None


def test_garbage_pdf_fails_typed(uploads_dir):
    data = (uploads_dir / "bozuk.pdf").read_bytes()
    with pytest.raises(ExtractionFailedError) as exc:
        extract.extract_text("pdf", data)
    assert exc.value.kind == "EXTRACTION_FAILED"


def test_udf_without_content_xml_fails():
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("baska.xml", "<a/>")
    with pytest.raises(ExtractionFailedError) as exc:
        extract.extract_text("udf", buf.getvalue())
    assert "content.xml" in str(exc.value)


# --- heuristic analysis -----------------------------------------------------

DILEKCE_TEXT = """SENTETİK TEST BELGESİDİR.

DAVACI : Ayşe Yılmaz
VEKİLİ : Av. Mehmet Demir
DAVALI : Mustafa Kaya

Davalı 12.05.2024 tarihinde davacıyı aldatmıştır. Bu eylem TCK m. 157
kapsamındadır. Yargıtay 9. Hukuk Dairesi'nin E. 2021/123, K. 2022/456
sayılı kararı emsaldir. İhtarname 3 Haziran 2024 tarihinde
gönderilmiştir.

SONUÇ VE İSTEM : Davanın kabulü ile 45.000 TL tazminata karar
verilmesini talep ederiz.
"""


def test_parties_with_roles():
    parties = analysis.extract_parties(DILEKCE_TEXT)
    by_name = {p["name"]: p.get("role") for p in parties}
    assert by_name.get("Ayşe Yılmaz") == "davacı"
    assert by_name.get("Mustafa Kaya") == "davalı"
    assert by_name.get("Av. Mehmet Demir") == "vekil"


def test_references_resolve_abbreviation_and_docket():
    refs = analysis.extract_references(DILEKCE_TEXT)
    # TCK m. 157 resolves through the abbreviation table to 5237.
    assert any(
        r.get("legislationNo") == "5237" and r.get("articleNo") == "157"
        for r in refs
    )
    assert any(
        r.get("docketNo") == "2021/123" and r.get("decisionNo") == "2022/456"
        for r in refs
    )


def test_dates_numeric_and_turkish_long_form_with_context():
    dates = analysis.extract_dates(DILEKCE_TEXT)
    by_iso = {d["date"]: d["context"] for d in dates}
    assert "2024-05-12" in by_iso
    assert "2024-06-03" in by_iso
    assert "aldatmıştır" in by_iso["2024-05-12"]
    # Context is bounded: match + 40 chars each side, whitespace-collapsed.
    assert all(len(d["context"]) <= 100 for d in dates)


def test_invalid_calendar_date_ignored():
    dates = analysis.extract_dates("Toplantı 31.02.2024 tarihinde yapıldı.")
    assert dates == []


def test_claims_marked_heuristic():
    claims = analysis.extract_claims(DILEKCE_TEXT)
    assert claims, "talep sentence must be found"
    assert all(c["source"] == "heuristic" for c in claims)
    assert any("talep ederiz" in c["text"] for c in claims)


def test_few_signals_warning():
    _, warnings = analysis.analyze("Kısa ve alakasız bir metin.")
    assert analysis.FEW_SIGNALS_WARNING in warnings


def test_rich_text_has_no_few_signals_warning():
    _, warnings = analysis.analyze(DILEKCE_TEXT)
    assert analysis.FEW_SIGNALS_WARNING not in warnings


# --- blockwise reference parsing (W12-F performance fix) --------------------

def test_blockwise_references_equal_whole_text_parse_with_rebased_spans():
    """Parsing per paragraph block must yield the SAME references as one
    call over the whole text, with spans re-based so `raw` merging still
    slices the full text correctly."""
    from legal_reference.parser import parse_references

    text = "\n\n".join([DILEKCE_TEXT] * 5)
    whole = parse_references(text)
    blockwise = analysis._parse_references_blockwise(text)
    assert [(r.kind, r.raw, r.span) for r in blockwise] == [
        (r.kind, r.raw, r.span) for r in whole
    ]
    assert any(r.span[0] > len(DILEKCE_TEXT) for r in blockwise)
    for ref in blockwise:
        assert text[ref.span[0]:ref.span[1]] == ref.raw

    # The raw (pre-dedupe) list carries every occurrence; the public list
    # folds them into ONE entry with a count (W12-FIX2, P2-3).
    merged = [r for r in analysis._extract_references_all(text) if r.get("legislationNo") == "5237"]
    assert len(merged) == 5
    assert all(r["articleNo"] == "157" and r["raw"] == "TCK m. 157" for r in merged)
    public = [r for r in analysis.extract_references(text) if r.get("legislationNo") == "5237"]
    assert len(public) == 1 and public[0]["count"] == 5


def test_overlong_block_is_split_at_line_or_sentence_ends():
    sentence = (
        "Sanık TCK m. 157 uyarınca Yargıtay 9. Hukuk Dairesi'nin E. 2021/123,"
        " K. 2022/456 sayılı kararı doğrultusunda cezalandırılmıştır. "
    )
    long_line = sentence * 200
    blocks = analysis._reference_blocks(long_line)
    assert len(blocks) > 1
    assert all(len(b) <= analysis._REF_BLOCK_MAX_CHARS for _, b in blocks)
    # Pieces tile the text exactly.
    assert "".join(b for _, b in blocks) == long_line
    assert all(long_line[o:o + len(b)] == b for o, b in blocks)
    # Every cut lands on a REAL sentence end (never after "m.", "E.", "9."),
    # so no reference is split across blocks.
    assert all(b.rstrip().endswith("cezalandırılmıştır.") for _, b in blocks[:-1])
    refs = analysis._extract_references_all(long_line)
    assert len([r for r in refs if r.get("articleNo") == "157"]) == 200
    assert len([r for r in refs if r.get("docketNo") == "2021/123"]) == 200
    deduped = analysis.extract_references(long_line)
    assert sum(r["count"] for r in deduped if r.get("articleNo") == "157") == 200
    # Same result as one whole-text parse.
    from legal_reference.parser import parse_references
    whole = parse_references(long_line)
    assert [(r.kind, r.raw, r.span) for r in analysis._parse_references_blockwise(long_line)] == [
        (r.kind, r.raw, r.span) for r in whole
    ]


def test_reference_analysis_is_linear_on_large_text():
    """30 000 paragraphs used to take ~110 s (quadratic parser); blockwise
    parsing must stay in the low seconds."""
    import time

    paragraph = (
        "{n}. Davalı, {n}.05.2024 tarihli sözleşmeye aykırı davranmış ve"
        " TBK m. 112 uyarınca tazminat borcu doğmuştur."
    )
    text = "\n\n".join(paragraph.format(n=i + 1) for i in range(30_000))
    started = time.monotonic()
    refs = analysis.extract_references(text)
    elapsed = time.monotonic() - started
    assert sum(r["count"] for r in refs) >= 30_000
    assert elapsed < 20, f"reference analysis took {elapsed:.1f}s"


# --- W12-FIX2 (P2-3): dedupe, word boundaries, party tagging ----------------

def test_repeated_references_and_dates_are_one_entry_with_a_count():
    text = "\n\n".join([DILEKCE_TEXT] * 4)
    refs = analysis.extract_references(text)
    tck = [r for r in refs if r.get("legislationNo") == "5237" and r.get("articleNo") == "157"]
    assert len(tck) == 1 and tck[0]["count"] == 4
    dockets = [r for r in refs if r.get("docketNo") == "2021/123"]
    assert len(dockets) == 1 and dockets[0]["count"] == 4
    # Surface variants of the same citation collapse too.
    variants = analysis.extract_references("TCK m. 157 ... TCK m.157 ... 5237 sayılı Kanun m. 157")
    assert len([r for r in variants if r.get("articleNo") == "157"]) == 1
    dates = analysis.extract_dates(text)
    assert [d["date"] for d in dates] == ["2024-05-12", "2024-06-03"]
    assert all(d["count"] == 4 for d in dates)
    assert "aldatmıştır" in dates[0]["context"]


def test_claim_markers_match_at_word_starts_only():
    assert analysis.extract_claims("Bu bir kartalep değildir, istalep de değildir.") == []
    hit = analysis.extract_claims("Davacı, taleplerinin kabulünü ister; aksi hâlde başvurur.")
    assert hit and "talep" in hit[0]["text"]
    assert analysis.extract_claims("Sözleşme feshedilmiştir, bu bir kayıttır.") == []


def test_claims_are_tagged_with_the_party_they_speak_for():
    text = (
        "DAVACI : Ayşe Yılmaz\nDAVALI : Mustafa Kaya\n\n"
        "Davacı vekili, 45.000 TL tazminata hükmedilmesini talep etmektedir. "
        "Davalı ise davanın reddini talep etmiştir. "
        "Mahkemece talep konusu değerlendirilecektir. "
        "Davacı ve davalı ortak bir talep sunmamıştır."
    )
    claims = analysis.extract_claims(text)
    by_text = {c["text"]: c.get("party") for c in claims}
    assert by_text["Davacı vekili, 45.000 TL tazminata hükmedilmesini talep etmektedir."] == "davacı"
    assert by_text["Davalı ise davanın reddini talep etmiştir."] == "davalı"
    assert by_text["Mahkemece talep konusu değerlendirilecektir."] is None
    assert by_text["Davacı ve davalı ortak bir talep sunmamıştır."] is None
    assert analysis.claim_party("Kiracı tahliyeyi kabul etmedi.") == "kiracı"
    assert analysis.claim_party("Kiraya veren tahliye istedi.") == "kiralayan"


# ---------------------------------------------------------------------------
# 27.09.2026 — found by uploading a real (OCR'd) iş davası dilekçesi.
# ---------------------------------------------------------------------------

def test_a_claim_is_never_cut_at_an_abbreviation_dot():
    # The splitter cut after "m." and the talep came back as "14 uyarınca
    # kıdem …" — the stump the "Taslağa talep olarak aktar" button copied
    # into the lawyer's draft, with both statutes gone.
    text = (
        "3- 4857 sayılı İş Kanunu m. 17 ve 1475 sayılı Kanun m. 14 uyarınca\n"
        "kıdem ve ihbar tazminatı talep edilmektedir. Yargıtay 9. HD. "
        "2019/1234 E., 2020/55 K. sayılı ilamında da Av. Mehmet Öztürk'ün "
        "Örnek A.Ş. yönünden talep ettiği alacak kabul edilmiştir."
    )
    texts = [c["text"] for c in analysis.extract_claims(text)]
    assert texts[0].startswith("3- 4857 sayılı İş Kanunu m. 17 ve 1475 sayılı Kanun m. 14 uyarınca kıdem")
    assert not any(t.startswith(("14 ", "17 ", "HD", "2019/", "Mehmet", "Örnek A.Ş")) for t in texts), texts
    assert any("Yargıtay 9. HD. 2019/1234 E., 2020/55 K." in t for t in texts), texts


def test_split_sentences_still_splits_real_sentence_ends():
    parts = [p.strip() for p in analysis.split_sentences(
        "Ödeme yapılmamıştır. Fesih haksızdır! Neden? Talep ederiz; ayrıca\n\nYENİ PARAGRAF"
    )]
    assert parts == ["Ödeme yapılmamıştır.", "Fesih haksızdır!", "Neden?", "Talep ederiz;", "ayrıca", "YENİ PARAGRAF"]


def test_a_case_marked_role_word_is_the_addressee_not_the_speaker():
    # "davalıdan tahsiline" is the DAVACI's demand; it used to be tagged
    # "davalı" — the side the money is taken FROM.
    assert analysis.claim_party(
        "Şimdilik 10.000 TL kıdem tazminatının davalıdan tahsiline karar verilmesini talep ederiz."
    ) is None
    assert analysis.claim_party("Yargılama giderlerinin davalıya yükletilmesini talep ederiz.") is None
    assert analysis.claim_party("Davacının taleplerinin reddine karar verilmesini talep ederiz.") is None
    assert analysis.claim_party("Davalı aleyhine hükmedilmesini talep ederiz.") is None
    # The nominative still names the speaker, singular and plural.
    assert analysis.claim_party("Davacı vekili tazminata hükmedilmesini talep etmektedir.") == "davacı"
    assert analysis.claim_party("Davalılar davanın reddini talep etmiştir.") == "davalı"


def test_the_talep_preview_is_capped_with_a_warning_never_silently():
    text = "\n\n".join(
        f"{n}. Davalı, {n % 28 + 1}.05.2024 tarihli sözleşme uyarınca {n} TL tazminat borcu doğmuştur."
        for n in range(1, analysis.MAX_PREVIEW_CLAIMS + 51)
    )
    result, warnings = analysis.analyze(text)
    assert len(result["claims"]) == analysis.MAX_PREVIEW_CLAIMS
    assert analysis.claims_capped_warning(analysis.MAX_PREVIEW_CLAIMS + 50) in warnings
    assert f"{analysis.MAX_PREVIEW_CLAIMS + 50} talep cümlesi" in warnings[0]


def test_the_softened_talep_stem_is_a_claim_marker():
    # "talebi" / "talebimizin" never matched the "talep" marker.
    claims = analysis.extract_claims("Müvekkilin talebimizin kabulüne karar verilmesi yönündeki istemi açıktır. Davalının talebi yerinde değildir.")
    assert any("talebimizin kabulüne" in c["text"] for c in claims), claims
    assert any("Davalının talebi yerinde değildir." == c["text"] for c in claims), claims


def test_a_date_at_the_end_of_a_sentence_is_still_a_date():
    dates = analysis.extract_dates("Bilirkişi raporu tarihi: 20.06.2026. Rapor dosyaya sunulmuştur.")
    assert [d["date"] for d in dates] == ["2026-06-20"]
    # Still not a date: a longer dotted number.
    assert analysis.extract_dates("Sürüm 20.06.2026.1 yüklendi.") == []
