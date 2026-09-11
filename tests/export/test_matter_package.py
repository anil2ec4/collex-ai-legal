"""W14 · B-30 — the matter package (ZIP).

KABUL: a matter with 2 documents, 2 answers, 1 draft (v2) and 2 deadlines
produces an archive with four folders and a MANIFEST.json; every sha256 in
the manifest verifies against the entry itself; and **if a single citation
cannot be verified, no package is written**.

All content is SENTETİK.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from export.cli import EXIT_OK, EXIT_REFUSED, EXIT_USAGE, main
from export.errors import ExportRefused
from export.package import (
    DOCUMENTS_DIR,
    DRAFTS_DIR,
    MANIFEST_NAME,
    PACKAGE_NOTICE,
    RESEARCH_DIR,
    SUMMARY_NAME,
    PackageFormatError,
    export_matter_package,
    load_plan,
    parse_plan,
    read_package,
    sha256_bytes,
    verify_package,
)

from tests.export.test_petition_docx import make_draft

BUNDLE = Path(__file__).resolve().parent / "fixtures" / "bundle_sentetik_serhli.json"


def _v2_draft() -> dict:
    payload = make_draft()
    payload["version"] = 2
    return payload


def build_workspace(tmp_path: Path, *, break_quote: bool = False) -> Path:
    """Lay out the files a real matter would have on disk, then plan them."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    doc_a = uploads / "kira_sozlesmesi.txt"
    doc_a.write_text("SENTETİK kira sözleşmesi metni.", encoding="utf-8")
    doc_b = uploads / "ihtarname.txt"
    doc_b.write_text("SENTETİK ihtarname metni.", encoding="utf-8")

    drafts = tmp_path / "drafts"
    drafts.mkdir()
    payload = _v2_draft()
    if break_quote:
        # W14 · B-01: edit the text INSIDE the quoted passage. The evidence
        # entry still hashes to itself, so only the quote-integrity check
        # catches it — and it must cost the WHOLE package.
        for section in payload["sections"]:
            for paragraph in section["paragraphs"]:
                if paragraph["evidenceIds"]:
                    paragraph["text"] = paragraph["text"].replace(
                        "bir yıldan beş yıla", "üç yıldan yedi yıla"
                    )
    draft_path = drafts / "dava.json"
    draft_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    summary = tmp_path / "dosya-ozeti.docx"
    summary.write_bytes(b"PK\x03\x04 SENTETIK ozet")

    plan = {
        "schema": "collex.matter-package/v1",
        "matterId": "m-1",
        "matterTitle": "Yılmaz / Kira tahliye (SENTETİK)",
        "summaryPath": str(summary),
        "generatedAt": "2026-09-02T10:00:00+00:00",
        "notes": ["2 süre kaydı dosya özetindedir."],
        "documents": [
            {
                "fileName": doc_a.name,
                "sourcePath": str(doc_a),
                "sha256": sha256_bytes(doc_a.read_bytes()),
            },
            {
                "fileName": doc_b.name,
                "sourcePath": str(doc_b),
                "sha256": sha256_bytes(doc_b.read_bytes()),
            },
        ],
        "drafts": [{"fileName": "Dava Dilekcesi - v2.docx", "draftPath": str(draft_path)}],
        "answers": [
            {"fileName": "arastirma-1.json", "bundlePath": str(BUNDLE)},
            {"fileName": "arastirma-2.json", "bundlePath": str(BUNDLE)},
        ],
    }
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
    return plan_path


def test_package_has_four_folders_a_manifest_and_verifies(tmp_path: Path):
    pytest.importorskip("docx")
    plan = load_plan(build_workspace(tmp_path))
    out = tmp_path / "dosya-paketi.zip"
    result = export_matter_package(plan, out)

    assert out.is_file()
    assert result.document_count == 2
    assert result.draft_count == 1
    assert result.answer_count == 2

    report = read_package(out)
    names = set(report.names)
    assert SUMMARY_NAME in names
    assert MANIFEST_NAME in names
    assert sum(1 for n in names if n.startswith(f"{DOCUMENTS_DIR}/")) == 2
    assert sum(1 for n in names if n.startswith(f"{DRAFTS_DIR}/")) == 1
    # Each answer contributes a JSON and a DOCX.
    assert sum(1 for n in names if n.startswith(f"{RESEARCH_DIR}/")) == 4

    # Every manifest digest verifies against the entry itself, with nothing
    # in the archive that the manifest does not list.
    assert verify_package(out) == []
    assert report.manifest["notice"] == PACKAGE_NOTICE
    assert report.manifest["matterTitle"] == "Yılmaz / Kira tahliye (SENTETİK)"


def test_originals_come_back_byte_for_byte(tmp_path: Path):
    pytest.importorskip("docx")
    plan_path = build_workspace(tmp_path)
    plan = load_plan(plan_path)
    out = tmp_path / "paket.zip"
    export_matter_package(plan, out)

    with zipfile.ZipFile(out) as archive:
        for document in plan.documents:
            stored = archive.read(f"{DOCUMENTS_DIR}/{document.file_name}")
            assert stored == document.source_path.read_bytes()
            assert sha256_bytes(stored) == document.sha256


def test_an_unverifiable_citation_writes_no_package(tmp_path: Path):
    """The whole point: a broken quote costs the archive, not just the draft."""
    pytest.importorskip("docx")
    plan = load_plan(build_workspace(tmp_path, break_quote=True))
    out = tmp_path / "paket.zip"
    with pytest.raises(ExportRefused) as excinfo:
        export_matter_package(plan, out)
    assert "QUOTE_ALTERED" in excinfo.value.report()
    assert not out.exists()
    assert list(tmp_path.glob("*.tmp")) == []


def test_a_corrupted_original_writes_no_package(tmp_path: Path):
    pytest.importorskip("docx")
    plan_path = build_workspace(tmp_path)
    payload = json.loads(plan_path.read_text(encoding="utf-8"))
    payload["documents"][0]["sha256"] = "0" * 64
    plan_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    out = tmp_path / "paket.zip"
    with pytest.raises(ExportRefused) as excinfo:
        export_matter_package(load_plan(plan_path), out)
    assert "ASIL_BOZUK" in excinfo.value.report()
    assert not out.exists()


def test_a_missing_original_writes_no_package(tmp_path: Path):
    pytest.importorskip("docx")
    plan_path = build_workspace(tmp_path)
    payload = json.loads(plan_path.read_text(encoding="utf-8"))
    payload["documents"][1]["sourcePath"] = str(tmp_path / "yok.txt")
    plan_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    out = tmp_path / "paket.zip"
    with pytest.raises(ExportRefused) as excinfo:
        export_matter_package(load_plan(plan_path), out)
    assert "ASIL_YOK" in excinfo.value.report()
    assert not out.exists()


def test_a_traversing_file_name_is_refused_by_the_parser():
    for bad in ("../gizli.txt", "belgeler/x.txt", "C:\\x.txt", "."):
        with pytest.raises(PackageFormatError):
            parse_plan(
                {
                    "schema": "collex.matter-package/v1",
                    "matterId": "m-1",
                    "matterTitle": "",
                    "documents": [
                        {"fileName": bad, "sourcePath": "x", "sha256": "a" * 64}
                    ],
                }
            )


def test_a_bad_sha_in_the_plan_is_refused_by_the_parser():
    with pytest.raises(PackageFormatError):
        parse_plan(
            {
                "schema": "collex.matter-package/v1",
                "matterId": "m-1",
                "matterTitle": "",
                "documents": [{"fileName": "a.txt", "sourcePath": "x", "sha256": "kısa"}],
            }
        )


def test_verify_package_reports_a_tampered_entry(tmp_path: Path):
    pytest.importorskip("docx")
    plan = load_plan(build_workspace(tmp_path))
    out = tmp_path / "paket.zip"
    export_matter_package(plan, out)

    # Rebuild the archive with one entry's bytes changed.
    tampered = tmp_path / "bozuk.zip"
    with zipfile.ZipFile(out) as source, zipfile.ZipFile(tampered, "w") as target:
        for name in source.namelist():
            data = source.read(name)
            if name.startswith(f"{DOCUMENTS_DIR}/"):
                data = data + b" (degistirildi)"
            target.writestr(name, data)

    problems = verify_package(tampered)
    assert any(p.startswith("GIRDI_OZETI") for p in problems)


def test_cli_writes_the_package_and_guards_the_format(tmp_path: Path, capsys):
    pytest.importorskip("docx")
    plan_path = build_workspace(tmp_path)
    out = tmp_path / "paket.zip"

    code = main(["--package", str(plan_path), "--out", str(out), "--format", "dosya-paketi-zip"])
    assert code == EXIT_OK
    assert out.is_file()
    stdout = capsys.readouterr().out
    assert "DOSYA-PAKETI yazıldı" in stdout
    assert "belge: 2" in stdout

    assert main(["--package", str(plan_path), "--out", str(out), "--format", "md"]) == EXIT_USAGE
    assert (
        main(["--bundle", str(BUNDLE), "--out", str(out), "--format", "dosya-paketi-zip"])
        == EXIT_USAGE
    )


def test_cli_refuses_a_broken_package_with_exit_two(tmp_path: Path, capsys):
    pytest.importorskip("docx")
    plan_path = build_workspace(tmp_path, break_quote=True)
    out = tmp_path / "paket.zip"
    assert main(["--package", str(plan_path), "--out", str(out)]) == EXIT_REFUSED
    assert not out.exists()
    assert "QUOTE_ALTERED" in capsys.readouterr().err
