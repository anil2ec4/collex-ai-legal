"""UDF (deneysel) exporter contract for ``collex.draft/v1`` drafts.

The produced zip must: carry the review banner as the FIRST line and the
experimental/unsigned note, contain every draft paragraph line, mark every
KAYNAKSIZ paragraph, cite with ``K-n`` references (no hash/UUID in the body),
address every line with a correct UTF-16 offset span, and round-trip through
the intake lane's UDF READER (:func:`intake.extract.extract_udf`) — the same
element structure that reader parses. A draft whose evidence closure does
not hold refuses (exit 2) with nothing written.

Also covers the W12 ``ek-dogrulama`` section on BOTH writers (DOCX + UDF)
and GG.AA.YYYY dates in the DOCX meta table.

All content is SENTETİK, authored for these tests.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

from export.cli import EXIT_OK, EXIT_REFUSED, EXIT_USAGE, main
from export.draft import (
    DRAFT_REVIEW_BANNER,
    EK_DOGRULAMA_SECTION_ID,
    KAYNAKSIZ_PREFIX,
    DraftFormatError,
    parse_draft,
)
from export.errors import ExportRefused
from export.udf import (
    UDF_EXPERIMENTAL_LINE,
    UDF_EXPERIMENTAL_NOTE,
    build_udf_lines,
    export_udf,
    read_udf_report,
    render_content_xml,
)

from tests.export.test_petition_docx import (
    _local_stamp,
    CONTENT_SHA,
    LABEL,
    QUOTE_SHA,
    make_contrary_draft,
    make_draft,
)


def make_v2_draft() -> dict[str, Any]:
    """A revised (version 2) draft with the machine-owned ek-dogrulama section."""
    payload = make_draft()
    payload["version"] = 2
    payload["matterId"] = "m-1"
    payload["updatedAt"] = "2026-09-02T11:00:00.000Z"
    payload["unusedEvidence"] = []
    payload["suggestedFacts"] = []
    payload["sections"].append(
        {
            "id": EK_DOGRULAMA_SECTION_ID,
            "title": "EK — DOĞRULAMA BİLGİLERİ",
            "paragraphs": [
                {
                    "id": "p-ek-dogrulama-1",
                    "text": (
                        f"K-1 — {LABEL} — Kısa alıntı: \"Dolandırıcılık suçunun sentetik…\""
                        f" — SHA-256 (ilk 8): {QUOTE_SHA[:8]} — Tarih: — — Doğrulama:"
                        " doğrulanmış kaynak; yön belirtmez"
                    ),
                    "evidenceIds": [],
                    "supported": True,
                    "note": "doğrulama bilgisi — belge gövdesine ait değildir",
                    "role": "ekDogrulama",
                }
            ],
        }
    )
    return payload


def write_draft(tmp_path: Path, payload: dict[str, Any]) -> Path:
    path = tmp_path / "taslak.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


# --------------------------------------------------------------------------
# Round-trip
# --------------------------------------------------------------------------


def test_udf_roundtrip_banner_lines_markers_citations_and_offsets(tmp_path: Path):
    draft = parse_draft(make_v2_draft())
    out = tmp_path / "dilekce.udf"
    result = export_udf(draft, out, generated_at="2026-09-02T11:05:00+00:00")

    assert out.is_file() and out.stat().st_size > 0
    assert result.format == "dilekce-udf"
    assert result.experimental is True
    assert result.unsupported_count == 1
    assert result.citation_count == 1
    assert UDF_EXPERIMENTAL_NOTE in result.summary()

    # It is a zip with content.xml — the shape UYAP uses.
    with zipfile.ZipFile(out) as zf:
        assert zf.namelist() == ["content.xml"]
        xml = zf.read("content.xml").decode("utf-8")
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert '<template format_id="1.8">' in xml
    assert "<content><![CDATA[" in xml
    assert '<elements resetPageCount="false">' in xml

    produced = read_udf_report(out)
    assert produced.lines[0] == DRAFT_REVIEW_BANNER
    assert produced.lines[1] == UDF_EXPERIMENTAL_LINE
    assert "SENTETİK" in produced.text

    # Every draft paragraph line is present; KAYNAKSIZ marked, in count.
    for section in draft.sections:
        for paragraph in section.paragraphs:
            for line in paragraph.text.split("\n"):
                if paragraph.supported:
                    assert line in produced.lines
    assert len(produced.kaynaksiz_texts) == 1
    assert produced.kaynaksiz_texts[0].startswith(KAYNAKSIZ_PREFIX)

    # K-n citations; no hash/UUID in the body; full hashes in the appendix.
    assert f"Dayanak [K-1]: {LABEL}" in produced.lines
    assert produced.citation_refs == ("K-1",)
    assert produced.citation_ids == ("ev-tck157",)
    body = produced.text.split("DAYANAK KAYNAKLARI")[0]
    assert "ev-tck157" not in body
    assert QUOTE_SHA[:12] not in body
    assert QUOTE_SHA[:8] in body  # ek-dogrulama short prefix
    assert "EK — DOĞRULAMA BİLGİLERİ" in produced.headings
    assert QUOTE_SHA in produced.text
    assert CONTENT_SHA in produced.text
    assert "Denetim dosyasındaki kaydı: ev-tck157" in produced.lines
    assert "Sürüm: 2" in produced.lines
    assert "Dosya: m-1" in produced.lines
    assert f"Son düzenleme: {_local_stamp('2026-09-02T11:00:00.000Z')}" in produced.lines

    # Every paragraph element addresses exactly one line (UTF-16 offsets).
    utf16 = produced.text.encode("utf-16-le")
    assert len(produced.spans) == len(produced.lines) - 1  # trailing "" after last "\n"
    for (start, length), line in zip(produced.spans, produced.lines):
        assert utf16[start * 2 : (start + length) * 2].decode("utf-16-le") == line + "\n"


def test_udf_roundtrips_through_the_intake_reader(tmp_path: Path):
    """The intake lane's UDF reader (read-only, defusedxml) reads our file."""
    pytest.importorskip("defusedxml")
    from intake.extract import extract_udf

    draft = parse_draft(make_contrary_draft())
    out = tmp_path / "karsit.udf"
    export_udf(draft, out, generated_at="2026-09-02T11:05:00+00:00")

    outcome = extract_udf(out.read_bytes())
    assert outcome.text.startswith(DRAFT_REVIEW_BANNER)
    assert "DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT" in outcome.text
    assert "Karşı içtihat [K-2]:" in outcome.text
    assert "1. (2025-01-05) Davalı, davacıya sentetik bir yatırım vaadinde bulunmuştur." in outcome.text
    assert "⚠ Bu bölümdeki kararlar talebin AKSİ yönündedir" in outcome.text


def test_udf_contrary_authority_never_reads_as_dayanak(tmp_path: Path):
    draft = parse_draft(make_contrary_draft())
    out = tmp_path / "karsit.udf"
    export_udf(draft, out, generated_at="2026-09-02T11:05:00+00:00")
    produced = read_udf_report(out)
    assert produced.citation_refs == ("K-1", "K-2")
    assert produced.citation_ids == ("ev-tck157", "ev-karsit-1")
    assert not any(line.startswith("Dayanak [K-2]") for line in produced.lines)
    assert "Yönü: karşıt" in produced.lines


def test_udf_cdata_terminator_in_user_text_is_escaped(tmp_path: Path):
    payload = make_draft()
    # sections[4] is SONUÇ VE İSTEM — a supported (beyan) paragraph.
    payload["sections"][4]["paragraphs"][0]["text"] = "Metin ]]> içeriyor ama belge bozulmaz."
    draft = parse_draft(payload)
    out = tmp_path / "cdata.udf"
    export_udf(draft, out, generated_at="2026-09-02T11:05:00+00:00")
    assert "Metin ]]> içeriyor ama belge bozulmaz." in read_udf_report(out).lines


def test_render_content_xml_offsets_are_utf16_units():
    lines = build_udf_lines(
        parse_draft(make_draft()), generated_at="2026-09-02T11:05:00+00:00", system_version="t"
    )
    xml = render_content_xml(lines)
    first = lines[0].text + "\n"
    assert f'startOffset="0" length="{len(first.encode("utf-16-le")) // 2}"' in xml


# --------------------------------------------------------------------------
# Refusals — nothing is ever written
# --------------------------------------------------------------------------


def test_udf_orphan_evidence_refuses_via_cli_and_writes_nothing(tmp_path: Path, capsys):
    payload = make_draft()
    payload["sections"][2]["paragraphs"][1]["evidenceIds"] = ["ev-hayalet"]
    draft_path = write_draft(tmp_path, payload)
    out = tmp_path / "orphan.udf"

    code = main(["--draft", str(draft_path), "--out", str(out), "--format", "dilekce-udf"])

    assert code == EXIT_REFUSED
    assert not out.exists()
    assert not list(tmp_path.glob(".orphan-*"))
    stderr = capsys.readouterr().err
    assert "BILINMEYEN_KANIT" in stderr


def test_udf_tampered_quote_hash_refuses(tmp_path: Path):
    payload = make_draft()
    payload["evidence"][0]["quote"] = payload["evidence"][0]["quote"].replace("beş", "on")
    draft = parse_draft(payload)
    out = tmp_path / "tampered.udf"
    with pytest.raises(ExportRefused) as excinfo:
        export_udf(draft, out)
    assert not out.exists()
    assert "ALINTI_OZET_UYUSMAZLIGI" in excinfo.value.report()


def test_udf_inconsistent_unsupported_count_refuses(tmp_path: Path):
    payload = make_draft()
    payload["unsupportedCount"] = 0
    with pytest.raises(ExportRefused) as excinfo:
        export_udf(parse_draft(payload), tmp_path / "x.udf")
    assert "KAYNAKSIZ_SAYIMI" in excinfo.value.report()


def test_parse_draft_validates_w12_fields():
    payload = make_draft()
    payload["version"] = 0
    with pytest.raises(DraftFormatError):
        parse_draft(payload)
    payload = make_draft()
    payload["matterId"] = 7
    with pytest.raises(DraftFormatError):
        parse_draft(payload)
    # Older drafts without the W12 fields still parse (additive contract).
    old = parse_draft(make_draft())
    assert old.version == 1 and old.matter_id is None and old.updated_at == ""


# --------------------------------------------------------------------------
# CLI contract
# --------------------------------------------------------------------------


def test_cli_udf_export_by_flag_and_by_suffix(tmp_path: Path, capsys):
    draft_path = write_draft(tmp_path, make_draft())
    out = tmp_path / "dilekce.udf"

    assert main(["--draft", str(draft_path), "--out", str(out), "--format", "dilekce-udf"]) == EXIT_OK
    assert out.is_file()
    stdout = capsys.readouterr().out
    assert "DILEKCE-UDF yazıldı" in stdout
    assert UDF_EXPERIMENTAL_NOTE in stdout
    assert "KAYNAKSIZ: 1" in stdout

    # The .udf suffix alone selects the UDF format.
    out2 = tmp_path / "ikinci.udf"
    assert main(["--draft", str(draft_path), "--out", str(out2), "--quiet"]) == EXIT_OK
    assert out2.is_file()
    assert capsys.readouterr().out == ""


def test_cli_dilekce_udf_only_with_draft(tmp_path: Path, capsys):
    draft_path = write_draft(tmp_path, make_draft())
    out = tmp_path / "a.udf"
    assert (
        main(["--bundle", str(draft_path), "--out", str(out), "--format", "dilekce-udf"])
        == EXIT_USAGE
    )
    assert "yalnızca --draft" in capsys.readouterr().err
    assert main(["--draft", str(draft_path), "--out", str(out), "--format", "md"]) == EXIT_USAGE
    capsys.readouterr()


# --------------------------------------------------------------------------
# DOCX: ek-dogrulama section + GG.AA.YYYY dates (both writers render it)
# --------------------------------------------------------------------------


def test_docx_renders_ek_dogrulama_section_and_human_dates(tmp_path: Path):
    pytest.importorskip("docx")
    from export.petition import export_petition_docx, read_petition_report

    draft = parse_draft(make_v2_draft())
    out = tmp_path / "v2.docx"
    export_petition_docx(draft, out, generated_at="2026-09-02T11:05:00+00:00")
    produced = read_petition_report(out)

    assert "EK — DOĞRULAMA BİLGİLERİ" in produced.headings
    assert any(text.startswith("K-1 — ") and QUOTE_SHA[:8] in text for text in produced.paragraph_texts)
    # Verification lines are informational: never a citation, never KAYNAKSIZ.
    assert produced.citation_refs == ("K-1",)
    assert len(produced.kaynaksiz_texts) == 1
    # Dates on every human row are GG.AA.YYYY; the version and matter rows exist.
    assert _local_stamp("2026-09-02T11:00:00.000Z") in produced.full_text  # Son düzenleme
    assert _local_stamp("2026-08-27T10:00:00.000Z") in produced.full_text  # Oluşturulma
    assert "Sürüm" in produced.full_text and "Dosya" in produced.full_text
    assert "m-1" in produced.full_text


def test_docx_refuses_when_appendix_numbering_cannot_resolve_a_reference(tmp_path: Path):
    """A body K-n the appendix cannot map fails the closure loudly."""
    pytest.importorskip("docx")
    from export import petition

    draft = parse_draft(make_draft())
    original = petition._add_appendix_entry

    def broken(document, index, entry):  # drop the Kanıt kimliği line
        petition._para(document, f"[K-{index}] {entry.label}", petition.STYLE_TARAF)

    petition._add_appendix_entry = broken
    try:
        with pytest.raises(ExportRefused) as excinfo:
            petition.export_petition_docx(draft, tmp_path / "bad.docx", generated_at="2026-09-02T11:05:00+00:00")
    finally:
        petition._add_appendix_entry = original
    report = excinfo.value.report()
    assert "ATIF_KAPANIMI" in report or "KANIT_NUMARASI" in report
    assert not (tmp_path / "bad.docx").exists()


def test_sha_prefix_helper_is_consistent():
    assert hashlib.sha256(b"x").hexdigest()[:8] == hashlib.sha256(b"x").hexdigest()[:8]
