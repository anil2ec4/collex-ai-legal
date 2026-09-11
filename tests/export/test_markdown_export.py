"""Markdown export: same guarantees as DOCX, in a stdlib-only format.

The Markdown path must work with NO optional dependency installed, so nothing
here imports ``docx``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from export import text as T
from export.bundle import parse_bundle
from export.bundle_markdown import (
    escape_inline,
    export_markdown,
    read_markdown_report,
)
from export.errors import ExportRefused
from export.plan import build_citation_plan
from export.verify import sha256_utf8


def _local_stamp(iso: str) -> str:
    """W12-FIX2 (P2-5): human rows show LOCAL time (no zone tag); the ISO
    stamp stays in the Teknik künye row. Expected values are derived the
    same way the exporter does so the test holds in any time zone."""
    from datetime import datetime

    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d.%m.%Y %H:%M")

_FENCE_BLOCK = re.compile(r"^(`{3,})\n(.*?)\n\1$", re.MULTILINE | re.DOTALL)


@pytest.fixture()
def exported_md(qualified_bundle, tmp_path: Path, generated_at: str) -> str:
    target = tmp_path / "cevap.md"
    result = export_markdown(qualified_bundle, target, generated_at=generated_at)
    assert result.citation_count == 4
    return target.read_text(encoding="utf-8")


def test_markdown_export_needs_no_optional_dependency(exported_md: str):
    import export.bundle_markdown as module

    assert "docx" not in {name for name in dir(module)}
    assert exported_md.startswith("# " + T.TITLE)


def test_body_and_appendix_citations_match(exported_md: str, qualified_bundle):
    body, appendix = read_markdown_report(exported_md)
    plan = build_citation_plan(qualified_bundle)

    assert body == appendix
    assert appendix == plan.numbered_ids
    assert appendix == frozenset({1, 2, 3, 4})


def test_quotes_are_byte_identical_and_hash_correctly(exported_md: str, qualified_bundle):
    """Fenced blocks preserve the quote exactly, so it still hashes right."""
    blocks = [match.group(2) for match in _FENCE_BLOCK.finditer(exported_md)]
    plan = build_citation_plan(qualified_bundle)

    for _, entry in plan.entries:
        assert entry.quote in blocks
        assert sha256_utf8(entry.quote) == entry.quote_sha256
        assert entry.quote_sha256 in exported_md
        assert entry.content_sha256 in exported_md


def test_lawyer_review_notice_opens_and_closes_the_file(exported_md: str):
    """Markdown has no pages, so the mandatory notice bookends the document."""
    assert exported_md.count(T.LAWYER_REVIEW_FOOTER) >= 2
    head, tail = exported_md[:1200], exported_md[-1500:]
    assert T.LAWYER_REVIEW_FOOTER in head
    assert T.LAWYER_REVIEW_FOOTER in tail


def test_synthetic_bundle_is_labelled(exported_md: str):
    assert "DENEME VERİSİ" in exported_md
    assert exported_md.count(T.SYNTHETIC_BANNER) >= 2


def test_all_mandatory_sections_are_present(exported_md: str):
    for heading in (
        T.H_META,
        T.H_BODY,
        T.H_CONFIDENCE,
        T.H_CONFLICT,
        T.H_ABSTAIN,
        T.H_SOURCES,
        T.H_VERIFY,
    ):
        assert f"## {heading}" in exported_md


def test_confidence_table_lists_five_dimensions(exported_md: str):
    # Shared five-dimension wording across every surface (terim sözlüğü).
    for label in (
        "Doğru kaynağa ulaşma",
        "Alıntının sonucu karşılaması",
        "Kaynağın ağırlığı",
        "Metnin güncelliği",
        "Sorunun kapsanması",
    ):
        assert label in exported_md
    assert "Kaynak bulma (retrieval)" not in exported_md
    assert "Kapsam (coverage)" not in exported_md


def test_kunye_speaks_turkish_and_keeps_iso_in_tech_table(exported_md: str):
    """Critic #21/#23/#24: human künye in Turkish + GG.AA.YYYY; machine facts
    (raw enum, ISO stamps, pipeline identity) in the Teknik künye sub-table."""
    # Human rows.
    assert "| Cevap durumu | " + T.STATUS_TR["QUALIFIED"] + " |" in exported_md
    assert "Teknik kontroller tamamlandı" in exported_md
    assert (T.FINALIZE_OK in exported_md) or (T.FINALIZE_BLOCKED in exported_md)
    assert "Finalize edilebilir" not in exported_md
    assert "| Yürürlük hangi tarihe göre değerlendirildi |" in exported_md
    # Belge üretim zamanı is GG.AA.YYYY HH:MM on the human row.
    assert f"| Belge üretim zamanı | {_local_stamp('2026-08-26T12:00:00+00:00')} |" in exported_md
    assert "(UTC)" not in exported_md.split("### ")[0]
    # Technical sub-table keeps the raw machine values.
    assert f"### {T.H_TECH_META}" in exported_md
    assert "| Durum kodu | QUALIFIED |" in exported_md
    assert "| Belge üretim zamanı (ISO) | 2026-08-26T12:00:00+00:00 |" in exported_md
    assert "retrieval" in exported_md  # English keys survive, in tech view only


def test_source_entries_use_shared_terms(exported_md: str):
    """'kademe' (never 'tier'), 'Sonuç yönü' with dictionary values, dates in
    GG.AA.YYYY."""
    assert "(kademe " in exported_md
    assert "(tier " not in exported_md
    assert "- Sonuç yönü: " in exported_md
    assert "- Duruş:" not in exported_md
    # Raw stance enums must never reach the reader.
    assert "- Sonuç yönü: neutral" not in exported_md
    assert "- Sonuç yönü: supporting" not in exported_md
    assert "- Sonuç yönü: contrary" not in exported_md
    assert "- Tarih: 12.03.2024" in exported_md


def test_uploaded_document_currentness_prints_the_shared_label(qualified_payload, tmp_path: Path):
    """W12-B2/API2: an uploaded document's currentness is NOT_APPLICABLE and
    the KAYNAKLAR entry says "yüklediğiniz belge — yürürlük değerlendirilemez"
    (the same wording as renderer.ts and the console), never the raw code."""
    entry = next(e for e in qualified_payload["evidence"] if e["evidenceId"] == "ev-tck-157")
    entry["currentness"]["status"] = "NOT_APPLICABLE"
    entry["currentness"]["score"] = 1.0
    entry["origin"] = "upload"  # additive bundle field; the reader ignores it
    bundle = parse_bundle(qualified_payload)
    target = tmp_path / "yukleme.md"
    export_markdown(bundle, target, generated_at="2026-08-26T12:00:00+00:00")
    content = target.read_text(encoding="utf-8")

    assert T.CURRENTNESS_TR["NOT_APPLICABLE"] == "yüklediğiniz belge — yürürlük değerlendirilemez"
    assert "- Güncellik: yüklediğiniz belge — yürürlük değerlendirilemez" in content
    assert "NOT_APPLICABLE" not in content
    # The other sources keep their own verdicts.
    assert "- Güncellik: yürürlükte" in content


def test_abstain_status_wording_is_cekimser(abstain_bundle, tmp_path: Path):
    target = tmp_path / "cekimser-dil.md"
    export_markdown(abstain_bundle, target, generated_at="2026-08-26T12:00:00+00:00")
    content = target.read_text(encoding="utf-8")

    assert T.STATUS_TR["ABSTAIN"] == (
        "DAYANAK BULUNAMADI (ÇEKİMSER) — dayanak bulunamadığı için cevap"
        " yazılmadı"
    )
    assert "DAYANAK BULUNAMADI (ÇEKİMSER)" in content
    assert "CEVAPTAN KAÇINMA" not in content
    assert f"## {T.H_ABSTAIN}" in content
    assert T.H_ABSTAIN == "Dayanak Bulunamayan Sonuçlar"
    assert "Çekimser (Abstention)" not in content


def test_untrusted_text_cannot_forge_a_citation_marker(qualified_payload, tmp_path: Path):
    qualified_payload["claims"][0]["text"] += " (bkz. [9])"
    bundle = parse_bundle(qualified_payload)
    target = tmp_path / "enjeksiyon.md"
    export_markdown(bundle, target)

    content = target.read_text(encoding="utf-8")
    body, appendix = read_markdown_report(content)
    assert 9 not in body
    assert body == appendix
    assert "&#91;9&#93;" in content


def test_escape_inline_matches_the_typescript_contract():
    """Same order of operations as ``escapeInline`` in renderer.ts.

    ``&`` is replaced FIRST, so the ampersands introduced by the later
    replacements are not double-escaped — exactly as the TypeScript side does
    it. Getting the order wrong would render ``&amp;lt;`` to the reader.
    """
    assert escape_inline("<b>[x]`y`</b>&") == (
        "&lt;b&gt;&#91;x&#93;&#96;y&#96;&lt;/b&gt;&amp;"
    )


def test_unsafe_urls_are_not_rendered(qualified_payload, tmp_path: Path):
    qualified_payload["evidence"][0]["sourceUrl"] = "javascript:alert(1)"
    bundle = parse_bundle(qualified_payload)
    target = tmp_path / "url.md"
    export_markdown(bundle, target)

    content = target.read_text(encoding="utf-8")
    assert "javascript:alert(1)" not in content
    assert T.UNSAFE_URL_PLACEHOLDER in content


def test_abstention_markdown_has_zero_citations(abstain_bundle, tmp_path: Path):
    target = tmp_path / "cekimser.md"
    result = export_markdown(abstain_bundle, target)
    content = target.read_text(encoding="utf-8")
    body, appendix = read_markdown_report(content)

    assert result.citation_count == 0
    assert body == frozenset()
    assert appendix == frozenset()
    assert f"## {T.H_ABSTAIN}" in content
    assert "numaralandırılmış kaynak YOKTUR (0 atıf)" in content
    assert T.ABSTENTION_TEXT in content


def test_tampered_bundle_never_produces_markdown(
    qualified_payload, tamper, tmp_path: Path
):
    bundle = parse_bundle(tamper(qualified_payload, 3))
    target = tmp_path / "sahte.md"
    with pytest.raises(ExportRefused):
        export_markdown(bundle, target)
    assert not target.exists()
