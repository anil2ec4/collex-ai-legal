"""Petition (collex.draft/v1) DOCX exporter contract.

Real python-docx round-trip: the mandatory review banner and footer, every
paragraph of the draft, the KAYNAKSIZ marker, and the evidence citations with
their hashes must all be provably present on the written artifact — and a
draft whose evidence closure does not hold must refuse (exit 2) with nothing
written.

All content is SENTETİK, authored for these tests.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("docx")

from export.cli import EXIT_OK, EXIT_REFUSED, EXIT_USAGE, main
from export.errors import ExportRefused
from export.petition import (
    DRAFT_REVIEW_BANNER,
    KARSI_ICTIHAT_INTRO,
    KARSI_ICTIHAT_NOTE,
    KARSI_ICTIHAT_SECTION_ID,
    KAYNAKSIZ_PREFIX,
    DraftFormatError,
    export_petition_docx,
    parse_draft,
    read_petition_report,
)

def _local_stamp(iso: str) -> str:
    """W12-FIX2 (P2-5): human rows show LOCAL time (no zone tag); the ISO
    stamp stays in the Teknik künye row. Expected values are derived the
    same way the exporter does so the test holds in any time zone."""
    from datetime import datetime

    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d.%m.%Y %H:%M")


QUOTE = (
    "Dolandırıcılık suçunun sentetik temel hâlinde faile bir yıldan beş yıla"
    " kadar hapis cezası verilir."
)
QUOTE_SHA = hashlib.sha256(QUOTE.encode("utf-8")).hexdigest()
CONTENT_SHA = hashlib.sha256(f"SENTETİK TAM METİN\n{QUOTE}".encode("utf-8")).hexdigest()
LABEL = "5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 157"


def make_draft() -> dict[str, Any]:
    """A realistic dava dilekçesi draft: bound, beyan and KAYNAKSIZ paragraphs."""
    return {
        "schema": "collex.draft/v1",
        "draftId": "dft-test-0001",
        "kind": "dilekce",
        "template": "dava-dilekcesi",
        "title": "Dava Dilekçesi",
        "createdAt": "2026-08-27T10:00:00.000Z",
        "reviewRequired": True,
        "sections": [
            {
                "id": "baslik",
                "title": "",
                "paragraphs": [
                    {
                        "id": "p-baslik-1",
                        "text": "İSTANBUL NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE",
                        "evidenceIds": [],
                        "supported": True,
                        "note": "beyan/İRADE — kanıt gerektirmez",
                        "role": "baslik",
                    }
                ],
            },
            {
                "id": "taraflar",
                "title": "TARAFLAR",
                "paragraphs": [
                    {
                        "id": "p-taraflar-2",
                        "text": "DAVACI : Ayşe Yılmaz",
                        "evidenceIds": [],
                        "supported": True,
                        "note": "beyan/İRADE — kanıt gerektirmez",
                        "role": "taraflar",
                    },
                    {
                        "id": "p-taraflar-3",
                        "text": "DAVALI : Veli Kaya",
                        "evidenceIds": [],
                        "supported": True,
                        "note": "beyan/İRADE — kanıt gerektirmez",
                        "role": "taraflar",
                    },
                ],
            },
            {
                "id": "aciklamalar",
                "title": "AÇIKLAMALAR",
                "paragraphs": [
                    {
                        "id": "p-aciklamalar-4",
                        "text": "1. (2025-01-05) Davalı, davacıya sentetik bir yatırım vaadinde bulunmuştur.",
                        "evidenceIds": [],
                        "supported": True,
                        "note": "beyan/İRADE — kanıt gerektirmez",
                        "role": "olaylar",
                    },
                    {
                        "id": "p-aciklamalar-5",
                        "text": f'Doğrulanmış kaynak uyarınca — {LABEL}: "{QUOTE}"',
                        "evidenceIds": ["ev-tck157"],
                        "supported": True,
                        "note": "doğrulanmış kaynağa bağlı",
                        "role": "hukukiDegerlendirme",
                    },
                ],
            },
            {
                "id": "hukuki-sebepler",
                "title": "HUKUKÎ SEBEPLER",
                "paragraphs": [
                    {
                        "id": "p-sebepler-6",
                        "text": "Faiz başlangıcına ilişkin hukukî dayanak doğrulanamamıştır.",
                        "evidenceIds": [],
                        "supported": False,
                        "note": "KAYNAKSIZ — hukukî dayanak doğrulanmadı; avukat eklemeli",
                        "role": "hukukiSebepler",
                    }
                ],
            },
            {
                "id": "sonuc",
                "title": "SONUÇ VE İSTEM",
                "paragraphs": [
                    {
                        "id": "p-sonuc-7",
                        "text": "1. Sentetik alacağın davalıdan tahsiline karar verilmesini talep ederiz.",
                        "evidenceIds": [],
                        "supported": True,
                        "note": "beyan/İRADE — kanıt gerektirmez",
                        "role": "talepler",
                    }
                ],
            },
            {
                "id": "imza",
                "title": "",
                "paragraphs": [
                    {
                        "id": "p-imza-8",
                        "text": "Davacı Vekili Av. Mehmet Demir — (imza)",
                        "evidenceIds": [],
                        "supported": True,
                        "note": "beyan/İRADE — kanıt gerektirmez",
                        "role": "imza",
                    }
                ],
            },
        ],
        "evidence": [
            {
                "evidenceId": "ev-tck157",
                "label": LABEL,
                "source": "MEVZUAT",
                "title": "Türk Ceza Kanunu (SENTETİK)",
                "legislationNo": "5237",
                "article": "157",
                "quote": QUOTE,
                "quoteSha256": QUOTE_SHA,
                "contentSha256": CONTENT_SHA,
            }
        ],
        "unsupportedCount": 1,
        "warnings": [
            DRAFT_REVIEW_BANNER,
            "1 paragraf KAYNAKSIZ: hukukî dayanağı doğrulanamadı.",
        ],
        "synthetic": True,
        "syntheticNotice": "Sentetik fixture korpusu",
    }


CONTRARY_QUOTE = (
    "Sentetik somut olayda dolandırıcılık suçunun unsurlarının oluşmadığı"
    " anlaşılmakla sanığın beraatine karar verilmiştir."
)
CONTRARY_QUOTE_SHA = hashlib.sha256(CONTRARY_QUOTE.encode("utf-8")).hexdigest()
CONTRARY_CONTENT_SHA = hashlib.sha256(
    f"SENTETİK TAM METİN\n{CONTRARY_QUOTE}".encode("utf-8")
).hexdigest()
CONTRARY_LABEL = "Yargıtay 15. Ceza Dairesi (SENTETİK), E. 2023/7810, K. 2024/2356"


def make_contrary_draft() -> dict[str, Any]:
    """Contract-A shape: evidence with ``direction`` + a karsi-ictihat section."""
    payload = make_draft()
    payload["evidence"][0]["direction"] = "destekleyen"
    payload["evidence"].append(
        {
            "evidenceId": "ev-karsit-1",
            "label": CONTRARY_LABEL,
            "source": "ICTIHAT",
            "title": "Yargıtay 15. Ceza Dairesi kararı (SENTETİK)",
            "quote": CONTRARY_QUOTE,
            "quoteSha256": CONTRARY_QUOTE_SHA,
            "contentSha256": CONTRARY_CONTENT_SHA,
            "direction": "karşıt",
        }
    )
    payload["sections"].insert(
        4,
        {
            "id": KARSI_ICTIHAT_SECTION_ID,
            "title": "DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT",
            "paragraphs": [
                {
                    "id": "p-karsi-9",
                    # W14 · B-01: the fixture now carries the VERBATIM quote,
                    # exactly as `appendix.ts::karsiIctihatParagraphText`
                    # emits it (`<künye> — "<alıntı>"`). The old summary text
                    # ("… — ÖZET: …") cited K-2 without containing its quote,
                    # which is precisely the state the quote-integrity gate
                    # refuses: it never came out of the composer.
                    "text": f'{CONTRARY_LABEL} — "{CONTRARY_QUOTE}"',
                    "evidenceIds": ["ev-karsit-1"],
                    "supported": True,
                    "note": (
                        "Bu karar talebin aksi yönündedir; dilekçeye alınıp"
                        " alınmayacağına avukat karar verir."
                    ),
                    "role": "karsiIctihat",
                }
            ],
        },
    )
    return payload


def write_draft(tmp_path: Path, payload: dict[str, Any]) -> Path:
    path = tmp_path / "taslak.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


# --------------------------------------------------------------------------
# Round-trip
# --------------------------------------------------------------------------


def test_docx_roundtrip_banner_paragraphs_markers_and_citations(tmp_path: Path):
    draft = parse_draft(make_draft())
    out = tmp_path / "dilekce.docx"
    result = export_petition_docx(draft, out, generated_at="2026-08-27T10:05:00+00:00")

    assert out.is_file() and out.stat().st_size > 0
    assert result.unsupported_count == 1
    assert result.citation_count == 1
    assert result.synthetic is True

    produced = read_petition_report(out)

    # Mandatory banner: first paragraph of the first page AND every footer.
    assert produced.paragraph_texts[0] == DRAFT_REVIEW_BANNER
    assert any(DRAFT_REVIEW_BANNER in footer for footer in produced.footer_texts)

    # SENTETİK notice visible in body and footer.
    assert "SENTETİK" in produced.full_text
    assert any("DENEME VERİSİ" in footer for footer in produced.footer_texts)

    # Every draft paragraph line is present on the artifact.
    for section in draft.sections:
        for paragraph in section.paragraphs:
            for line in paragraph.text.split("\n"):
                if paragraph.supported:
                    assert line in produced.full_text
    # Section headings survive.
    assert "HUKUKÎ SEBEPLER" in produced.headings
    assert "SONUÇ VE İSTEM" in produced.headings

    # The KAYNAKSIZ paragraph is loudly marked, in its own style — not dropped.
    assert len(produced.kaynaksiz_texts) == 1
    assert produced.kaynaksiz_texts[0].startswith(KAYNAKSIZ_PREFIX)
    assert "Faiz başlangıcına ilişkin" in produced.kaynaksiz_texts[0]

    # W12: body citations are K-n references with the künye only — no hash
    # and no evidence UUID inside the court text; the appendix carries the
    # full hashes under a [K-n] heading closed by the "Denetim dosyasındaki kaydı" line.
    assert f"Dayanak [K-1]: {LABEL}" in produced.paragraph_texts
    body_before_appendix = produced.full_text.split("DAYANAK KAYNAKLARI")[0]
    assert "alıntı SHA-256" not in body_before_appendix
    assert QUOTE_SHA[:12] not in body_before_appendix
    assert "Dayanak [ev-tck157]" not in produced.full_text
    assert f"[K-1] {LABEL}" in produced.paragraph_texts
    assert "Denetim dosyasındaki kaydı: ev-tck157" in produced.paragraph_texts
    assert QUOTE_SHA in produced.full_text
    assert CONTENT_SHA in produced.full_text
    assert produced.citation_refs == ("K-1",)
    assert produced.numbering == ((1, "ev-tck157"),)
    assert produced.citation_ids == ("ev-tck157",)
    # The meta table shows the version.
    assert "Sürüm" in produced.full_text


# --------------------------------------------------------------------------
# Karşı içtihat (contract A) — contrary authority must be loud, never "Dayanak"
# --------------------------------------------------------------------------


def test_contrary_authority_renders_loudly_and_never_as_dayanak(tmp_path: Path):
    draft = parse_draft(make_contrary_draft())
    out = tmp_path / "karsit.docx"
    export_petition_docx(draft, out, generated_at="2026-08-27T10:05:00+00:00")
    produced = read_petition_report(out)

    # Separate heading + loud intro under it.
    assert "DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT" in produced.headings
    assert KARSI_ICTIHAT_INTRO in produced.paragraph_texts

    # The contrary citation line says "Karşı içtihat", never "Dayanak", and
    # references the entry as K-2 (its position in the evidence list).
    assert any(
        text.startswith("Karşı içtihat [K-2]:")
        for text in produced.paragraph_texts
    )
    assert not any(
        text.startswith("Dayanak [K-2]:") or "ev-karsit-1]" in text
        for text in produced.paragraph_texts
    )
    # ... and it still participates in the citation closure, in order.
    assert produced.citation_refs == ("K-1", "K-2")
    assert produced.citation_ids == ("ev-tck157", "ev-karsit-1")

    # The section's lawyer-decision note is printed, loudly.
    assert (
        "⚠ Bu karar talebin aksi yönündedir; dilekçeye alınıp alınmayacağına"
        " avukat karar verir." in produced.paragraph_texts
    )

    # DAYANAK KAYNAKLARI appendix carries the direction line per entry and the
    # red-flag note on the contrary one.
    assert "Yönü: destekleyen" in produced.paragraph_texts
    assert "Yönü: karşıt" in produced.paragraph_texts
    assert KARSI_ICTIHAT_NOTE in produced.paragraph_texts

    # The künye counts the contrary records.
    assert "Karşı içtihat kaydı" in produced.full_text


def test_direction_free_draft_keeps_old_rendering(tmp_path: Path):
    """Backward compatibility: an old draft (no direction, no karsi-ictihat
    section) renders exactly as before — no Yönü lines, no contrary labels."""
    draft = parse_draft(make_draft())
    out = tmp_path / "eski-taslak.docx"
    export_petition_docx(draft, out, generated_at="2026-08-27T10:05:00+00:00")
    produced = read_petition_report(out)

    assert not any(text.startswith("Yönü:") for text in produced.paragraph_texts)
    assert not any(
        text.startswith("Karşı içtihat [") for text in produced.paragraph_texts
    )
    assert KARSI_ICTIHAT_INTRO not in produced.paragraph_texts
    assert "Karşı içtihat kaydı" not in produced.full_text
    assert produced.citation_ids == ("ev-tck157",)


def test_meta_table_shows_human_dates_and_keeps_iso_in_tech_row(tmp_path: Path):
    """Critic #23: user-facing timestamps are GG.AA.YYYY HH:MM; ISO stays in
    the single Teknik künye row."""
    draft = parse_draft(make_draft())
    out = tmp_path / "tarih.docx"
    export_petition_docx(draft, out, generated_at="2026-08-27T10:05:00+00:00")
    full_text = read_petition_report(out).full_text

    assert _local_stamp("2026-08-27T10:05:00+00:00") in full_text  # Belge üretim zamanı (insan)
    assert _local_stamp("2026-08-27T10:00:00.000Z") in full_text  # Oluşturulma (insan)
    assert "(UTC)" not in full_text
    assert "Teknik künye" in full_text
    assert "oluşturulma (ISO): 2026-08-27T10:00:00.000Z" in full_text
    assert "üretim (ISO): 2026-08-27T10:05:00+00:00" in full_text


# --------------------------------------------------------------------------
# Refusals — nothing is ever written
# --------------------------------------------------------------------------


def test_orphan_evidence_refuses_via_cli_and_writes_nothing(tmp_path: Path, capsys):
    payload = make_draft()
    payload["sections"][2]["paragraphs"][1]["evidenceIds"] = ["ev-hayalet"]
    draft_path = write_draft(tmp_path, payload)
    out = tmp_path / "orphan.docx"

    code = main(["--draft", str(draft_path), "--out", str(out), "--format", "dilekce-docx"])

    assert code == EXIT_REFUSED
    assert not out.exists()
    stderr = capsys.readouterr().err
    assert "BILINMEYEN_KANIT" in stderr
    assert "DIŞA AKTARMA REDDEDİLDİ" in stderr


def test_tampered_quote_hash_refuses(tmp_path: Path):
    payload = make_draft()
    payload["evidence"][0]["quote"] = QUOTE.replace("beş", "on")
    draft = parse_draft(payload)
    out = tmp_path / "tampered.docx"

    with pytest.raises(ExportRefused) as excinfo:
        export_petition_docx(draft, out)

    assert not out.exists()
    assert "ALINTI_OZET_UYUSMAZLIGI" in excinfo.value.report()


def test_inconsistent_unsupported_count_refuses(tmp_path: Path):
    payload = make_draft()
    payload["unsupportedCount"] = 0  # lies about its own gap count
    draft = parse_draft(payload)

    with pytest.raises(ExportRefused) as excinfo:
        export_petition_docx(draft, tmp_path / "x.docx")
    assert "KAYNAKSIZ_SAYIMI" in excinfo.value.report()


def test_review_required_false_is_a_format_error():
    payload = make_draft()
    payload["reviewRequired"] = False
    with pytest.raises(DraftFormatError):
        parse_draft(payload)


# --------------------------------------------------------------------------
# CLI contract
# --------------------------------------------------------------------------


def test_cli_draft_export_succeeds_and_reports(tmp_path: Path, capsys):
    draft_path = write_draft(tmp_path, make_draft())
    out = tmp_path / "dilekce.docx"

    code = main(["--draft", str(draft_path), "--out", str(out)])

    assert code == EXIT_OK
    assert out.is_file()
    stdout = capsys.readouterr().out
    assert "DILEKCE-DOCX yazıldı" in stdout
    assert "KAYNAKSIZ: 1" in stdout
    assert "DENEME VERİSİ" in stdout


def test_cli_usage_errors(tmp_path: Path, capsys):
    draft_path = write_draft(tmp_path, make_draft())
    out = tmp_path / "a.docx"

    # Neither input, or both inputs, is a usage error.
    assert main(["--out", str(out)]) == EXIT_USAGE
    assert (
        main(["--bundle", str(draft_path), "--draft", str(draft_path), "--out", str(out)])
        == EXIT_USAGE
    )
    # --draft only speaks dilekce-docx.
    assert main(["--draft", str(draft_path), "--out", str(out), "--format", "md"]) == EXIT_USAGE
    # ... and dilekce-docx only speaks --draft.
    assert (
        main(["--bundle", str(draft_path), "--out", str(out), "--format", "dilekce-docx"])
        == EXIT_USAGE
    )
    capsys.readouterr()


def test_cli_malformed_draft_is_usage_error(tmp_path: Path, capsys):
    bad = tmp_path / "bozuk.json"
    bad.write_text(json.dumps({"schema": "collex.draft/v1"}), encoding="utf-8")
    out = tmp_path / "a.docx"

    assert main(["--draft", str(bad), "--out", str(out)]) == EXIT_USAGE
    assert not out.exists()
    assert "GEÇERSİZ TASLAK" in capsys.readouterr().err
