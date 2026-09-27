"""Filed-copy defects, exporter half (drafting audit, 27.09.2026).

These documents get FILED in court; wrong content in a filed copy is the worst
class of defect. Every test here failed on the tree before the fix it pins:

  #1  the render guard's entity escapes were printed into the DOCX, the UDF
      and the NİHAİ copy ("Yılmaz &amp; Kaya İnşaat", "&lt;%5&gt;");
  #3  the NİHAİ copy printed system placeholders and KAYNAKSIZ stubs as body
      text;
  #7  the NİHAİ DELİLLER line carried a note to the lawyer;
  #5  two package entries with one name: one silently lost, or refused with
      a FALSE tampering finding.

All content is SENTETİK — authored for these tests, not real Turkish law.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

pytest.importorskip("docx")

from export.cli import EXIT_REFUSED, main
from export.draft import (
    ANNEX_NONE,
    MARKS_NONE,
    ExportMode,
    parse_draft,
)
from export.errors import ExportRefused
from export.package import export_matter_package, load_plan, sha256_bytes
from export.petition import export_petition_docx, read_petition_report
from export.udf import export_udf, read_udf_report

from tests.export.test_petition_docx import make_draft

FINAL = ExportMode(annex=ANNEX_NONE, marks=MARKS_NONE)
STAMP = "2026-09-27T10:00:00+00:00"
ESCAPES = ("&amp;", "&lt;", "&gt;", "&#40;", "&#58;", "&#46;")


def _paragraph(payload: dict, paragraph_id: str) -> dict:
    for section in payload["sections"]:
        for paragraph in section["paragraphs"]:
            if paragraph["id"] == paragraph_id:
                return paragraph
    raise KeyError(paragraph_id)


def _entity_draft(*, legacy: bool) -> dict:
    """make_draft() with the audit's strings — stored escaped (legacy) or plain."""
    payload = make_draft()
    amp = "&amp;" if legacy else "&"
    lt, gt = ("&lt;", "&gt;") if legacy else ("<", ">")
    _paragraph(payload, "p-taraflar-2")["text"] = f"DAVACI : Yılmaz {amp} Kaya İnşaat Ltd. Şti."
    _paragraph(payload, "p-aciklamalar-4")["text"] = (
        f"1. (10.01.2025) Sözleşmenin 5.2. maddesi uyarınca gecikme faizi {lt}%5{gt} kararlaştırıldı."
    )
    _paragraph(payload, "p-sonuc-7")["text"] = f"1. Faiz oranının %9 {gt} yasal faiz olduğunun tespitine"
    _paragraph(payload, "p-imza-8")["text"] = f"Yılmaz {amp} Kaya İnşaat Ltd. Şti. — (imza)"
    payload["warnings"].append(f"Kullanıcı talimatı (bilgi amaçlı): Yılmaz {amp} Kaya")
    return payload


def _docx_text(path: Path) -> str:
    return read_petition_report(path).full_text


def _udf_text(path: Path) -> str:
    return read_udf_report(path).text


@pytest.mark.parametrize("legacy", [True, False], ids=["legacy-escaped", "plain"])
@pytest.mark.parametrize("mode", [ExportMode(), FINAL], ids=["taslak", "nihai"])
def test_no_entity_escape_reaches_docx_or_udf(tmp_path: Path, legacy: bool, mode: ExportMode):
    draft = parse_draft(_entity_draft(legacy=legacy))
    docx_out = tmp_path / "dilekce.docx"
    udf_out = tmp_path / "dilekce.udf"
    export_petition_docx(draft, docx_out, generated_at=STAMP, mode=mode)
    export_udf(draft, udf_out, generated_at=STAMP, mode=mode)
    for text in (_docx_text(docx_out), _udf_text(udf_out)):
        assert "DAVACI : Yılmaz & Kaya İnşaat Ltd. Şti." in text
        assert "Yılmaz & Kaya İnşaat Ltd. Şti. — (imza)" in text
        assert "gecikme faizi <%5> kararlaştırıldı" in text
        assert "%9 > yasal faiz" in text
        for escape in ESCAPES:
            assert escape not in text, f"{escape!r} basıldı"


def test_a_legacy_escaped_quote_still_binds_and_prints_plain(tmp_path: Path):
    """The canonical comparison is unchanged: an old paragraph that stored the
    guard's escape still verifies against the raw quote, and prints '&'."""
    payload = make_draft()
    quote = "Ortaklar Yılmaz & Kaya, borçtan müteselsilen sorumludur."
    evidence = payload["evidence"][0]
    evidence["quote"] = quote
    evidence["quoteSha256"] = sha256_bytes(quote.encode("utf-8"))
    _paragraph(payload, "p-aciklamalar-5")["text"] = (
        'Doğrulanmış kaynak uyarınca — Ortaklar Yılmaz &amp; Kaya, borçtan müteselsilen sorumludur.'
    )
    out = tmp_path / "dilekce.docx"
    export_petition_docx(parse_draft(payload), out, generated_at=STAMP)
    text = _docx_text(out)
    assert "Ortaklar Yılmaz & Kaya, borçtan" in text
    assert "&amp;" not in text


# --------------------------------------------------------------------------
# #3 — placeholders in the NİHAİ copy
# --------------------------------------------------------------------------

PLACEHOLDER = "[Kararın özeti — doldurun]"


def _placeholder_draft() -> dict:
    payload = make_draft()
    payload["sections"].insert(
        2,
        {
            "id": "karar-ozeti",
            "title": "KARARIN ÖZETİ",
            "paragraphs": [
                {
                    "id": "p-karar-ozeti-9",
                    "text": PLACEHOLDER,
                    "evidenceIds": [],
                    "supported": True,
                    "note": "beyan/İRADE — kanıt gerektirmez",
                    "role": "hukum",
                    "placeholders": [PLACEHOLDER],
                }
            ],
        },
    )
    return payload


@pytest.mark.parametrize("writer", ["docx", "udf"])
def test_final_copy_refuses_an_unfilled_placeholder_and_writes_nothing(tmp_path: Path, writer: str):
    draft = parse_draft(_placeholder_draft())
    out = tmp_path / f"nihai.{writer}"
    export = export_petition_docx if writer == "docx" else export_udf
    with pytest.raises(ExportRefused) as refused:
        export(draft, out, generated_at=STAMP, mode=FINAL)
    assert any("PLACEHOLDER_UNFILLED" in finding for finding in refused.value.findings)
    assert any(PLACEHOLDER in finding for finding in refused.value.findings)
    assert not out.exists()
    assert list(tmp_path.iterdir()) == [], "reddedilen dışa aktarma dosya bıraktı"


def test_draft_copy_keeps_the_placeholder_visible(tmp_path: Path):
    out = tmp_path / "taslak.docx"
    export_petition_docx(parse_draft(_placeholder_draft()), out, generated_at=STAMP)
    assert PLACEHOLDER in _docx_text(out)


def test_a_filled_placeholder_no_longer_blocks_the_final_copy(tmp_path: Path):
    payload = _placeholder_draft()
    _paragraph(payload, "p-karar-ozeti-9")["text"] = "Bölge adliye mahkemesi davayı reddetmiştir."
    out = tmp_path / "nihai.docx"
    export_petition_docx(parse_draft(payload), out, generated_at=STAMP, mode=FINAL)
    assert "doldurun" not in _docx_text(out)


def test_cli_exit_2_for_an_unfilled_final_copy(tmp_path: Path):
    draft_path = tmp_path / "taslak.json"
    draft_path.write_text(json.dumps(_placeholder_draft(), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "nihai.docx"
    code = main(
        [
            "--draft", str(draft_path), "--out", str(out), "--format", "dilekce-docx",
            "--annex", "none", "--marks", "none", "--quiet",
        ]
    )
    assert code == EXIT_REFUSED
    assert not out.exists()


# --------------------------------------------------------------------------
# #7 — the NİHAİ DELİLLER line is the exhibit alone
# --------------------------------------------------------------------------


def _deliller_draft() -> dict:
    payload = make_draft()
    payload["sections"].insert(
        -1,
        {
            "id": "deliller",
            "title": "DELİLLER",
            "paragraphs": [
                {
                    "id": "p-deliller-10",
                    "text": "Ek-1: tanik-bom (dosyaya eklediğiniz belge)",
                    "evidenceIds": [],
                    "supported": True,
                    "note": "beyan/İRADE — kanıt gerektirmez",
                    "role": "deliller",
                }
            ],
        },
    )
    return payload


def test_final_deliller_line_drops_the_note_to_the_lawyer(tmp_path: Path):
    draft = parse_draft(_deliller_draft())
    nihai = tmp_path / "nihai.docx"
    taslak = tmp_path / "taslak.docx"
    export_petition_docx(draft, nihai, generated_at=STAMP, mode=FINAL)
    export_petition_docx(draft, taslak, generated_at=STAMP)
    assert "Ek-1: tanik-bom" in read_petition_report(nihai).paragraph_texts
    assert "dosyaya eklediğiniz belge" not in _docx_text(nihai)
    assert "Ek-1: tanik-bom (dosyaya eklediğiniz belge)" in _docx_text(taslak)
    udf = tmp_path / "nihai.udf"
    export_udf(draft, udf, generated_at=STAMP, mode=FINAL)
    assert "Ek-1: tanik-bom" in read_udf_report(udf).lines
    assert "dosyaya eklediğiniz belge" not in _udf_text(udf)


# --------------------------------------------------------------------------
# #5 — the matter package: one name, one entry
# --------------------------------------------------------------------------


def _package_plan(tmp_path: Path, *, same_draft_names: bool, same_document_names: bool) -> Path:
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    doc_a = uploads / "a.txt"
    doc_a.write_text("SENTETİK birinci belge.", encoding="utf-8")
    doc_b = uploads / "b.txt"
    doc_b.write_text("SENTETİK ikinci belge.", encoding="utf-8")
    drafts = tmp_path / "drafts"
    drafts.mkdir()
    first = make_draft()
    second = copy.deepcopy(first)
    second["draftId"] = "dft-test-0002"
    _paragraph(second, "p-taraflar-2")["text"] = "DAVACI : İkinci Taslak Sahibi"
    first_path = drafts / "d1.json"
    second_path = drafts / "d2.json"
    first_path.write_text(json.dumps(first, ensure_ascii=False), encoding="utf-8")
    second_path.write_text(json.dumps(second, ensure_ascii=False), encoding="utf-8")
    plan = {
        "schema": "collex.matter-package/v1",
        "matterId": "m-1",
        "matterTitle": "SENTETİK dosya",
        "documents": [
            {"fileName": "dilekce.txt", "sourcePath": str(doc_a), "sha256": sha256_bytes(doc_a.read_bytes())},
            {
                "fileName": "dilekce.txt" if same_document_names else "dilekce (2).txt",
                "sourcePath": str(doc_b),
                "sha256": sha256_bytes(doc_b.read_bytes()),
            },
        ],
        "drafts": [
            {"fileName": "Dava Dilekçesi - v1.docx", "draftPath": str(first_path)},
            {
                "fileName": "Dava Dilekçesi - v1.docx" if same_draft_names else "Dava Dilekçesi - v1 (2).docx",
                "draftPath": str(second_path),
            },
        ],
        "answers": [],
    }
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
    return plan_path


@pytest.mark.parametrize(
    "same_drafts,same_documents",
    [(True, False), (False, True)],
    ids=["iki-taslak-ayni-ad", "iki-belge-ayni-ad"],
)
def test_package_refuses_a_colliding_name_honestly(tmp_path: Path, same_drafts: bool, same_documents: bool):
    plan = load_plan(_package_plan(tmp_path, same_draft_names=same_drafts, same_document_names=same_documents))
    out = tmp_path / "paket.zip"
    with pytest.raises(ExportRefused) as refused:
        export_matter_package(plan, out)
    findings = refused.value.findings
    assert any(f.startswith("YINELENEN_AD") for f in findings), findings
    # Never the tampering finding for a mere name collision.
    assert not any("GIRDI_OZETI" in f or "ASIL_BOZUK" in f for f in findings), findings
    assert not out.exists()


def test_package_with_distinct_names_keeps_both_drafts(tmp_path: Path):
    import zipfile

    plan = load_plan(_package_plan(tmp_path, same_draft_names=False, same_document_names=False))
    out = tmp_path / "paket.zip"
    export_matter_package(plan, out)
    with zipfile.ZipFile(out) as archive:
        names = archive.namelist()
        assert "taslaklar/Dava Dilekçesi - v1.docx" in names
        assert "taslaklar/Dava Dilekçesi - v1 (2).docx" in names
        second = archive.read("taslaklar/Dava Dilekçesi - v1 (2).docx")
    from io import BytesIO

    from docx import Document

    text = "\n".join(p.text for p in Document(BytesIO(second)).paragraphs)
    assert "İkinci Taslak Sahibi" in text
