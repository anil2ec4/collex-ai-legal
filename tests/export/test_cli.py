"""CLI contract: exit codes carry the meaning, not just the stderr text.

A caller (a UYAP-side integration, a CI job, a lawyer's script) must be able
to distinguish "the pipeline handed me garbage" (1) from "the evidence did
not verify" (2) without parsing prose, and must be able to rely on nothing
being written on any non-zero exit.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from export.cli import EXIT_OK, EXIT_REFUSED, EXIT_USAGE, main

QUALIFIED_JSON = Path(__file__).resolve().parent / "fixtures" / "bundle_sentetik_serhli.json"
ABSTAIN_JSON = Path(__file__).resolve().parent / "fixtures" / "bundle_sentetik_cekimser.json"


def test_docx_export_succeeds(tmp_path: Path, capsys):
    pytest.importorskip("docx")
    out = tmp_path / "cevap.docx"
    code = main(["--bundle", str(QUALIFIED_JSON), "--out", str(out), "--format", "docx"])

    assert code == EXIT_OK
    assert out.is_file() and out.stat().st_size > 0
    stdout = capsys.readouterr().out
    assert "DOCX yazıldı" in stdout
    assert "atıf: 4" in stdout
    assert "DENEME VERİSİ" in stdout


def test_markdown_export_succeeds(tmp_path: Path, capsys):
    out = tmp_path / "cevap.md"
    code = main(["--bundle", str(QUALIFIED_JSON), "--out", str(out), "--format", "md"])

    assert code == EXIT_OK
    assert out.is_file()
    assert "MD yazıldı" in capsys.readouterr().out


def test_format_is_inferred_from_the_output_suffix(tmp_path: Path):
    out = tmp_path / "cevap.md"
    assert main(["--bundle", str(QUALIFIED_JSON), "--out", str(out), "--quiet"]) == EXIT_OK
    assert out.read_text(encoding="utf-8").startswith("# ")


def test_abstention_export_succeeds_with_zero_citations(tmp_path: Path, capsys):
    out = tmp_path / "cekimser.md"
    code = main(["--bundle", str(ABSTAIN_JSON), "--out", str(out), "--format", "md"])

    assert code == EXIT_OK
    assert "atıf: 0" in capsys.readouterr().out


def test_tampered_bundle_exits_non_zero_and_writes_nothing(
    tmp_path: Path, tamper, capsys
):
    """One character changed inside one quote => refusal, exit 2, no file."""
    payload = json.loads(QUALIFIED_JSON.read_text(encoding="utf-8"))
    bad = tmp_path / "sahte.json"
    bad.write_text(
        json.dumps(tamper(payload, 0), ensure_ascii=False), encoding="utf-8"
    )
    out = tmp_path / "sahte.docx"

    code = main(["--bundle", str(bad), "--out", str(out), "--format", "docx"])

    assert code == EXIT_REFUSED
    assert code != 0
    assert not out.exists()
    stderr = capsys.readouterr().err
    assert "DIŞA AKTARMA REDDEDİLDİ" in stderr
    assert "QUOTE_HASH_MISMATCH" in stderr


def test_tampered_bundle_also_refuses_markdown(tmp_path: Path, tamper):
    payload = json.loads(QUALIFIED_JSON.read_text(encoding="utf-8"))
    bad = tmp_path / "sahte.json"
    bad.write_text(json.dumps(tamper(payload, 1), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "sahte.md"

    assert main(["--bundle", str(bad), "--out", str(out), "--format", "md"]) == EXIT_REFUSED
    assert not out.exists()


def test_invented_citation_exits_refused(tmp_path: Path, capsys):
    payload = json.loads(QUALIFIED_JSON.read_text(encoding="utf-8"))
    payload["claims"][0]["evidenceIds"].append("ev-uydurma")
    bad = tmp_path / "uydurma.json"
    bad.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "uydurma.md"

    assert main(["--bundle", str(bad), "--out", str(out), "--format", "md"]) == EXIT_REFUSED
    assert not out.exists()
    assert "UNKNOWN_EVIDENCE_ID" in capsys.readouterr().err


def test_missing_bundle_file_exits_usage(tmp_path: Path, capsys):
    code = main(
        ["--bundle", str(tmp_path / "yok.json"), "--out", str(tmp_path / "a.md")]
    )
    assert code == EXIT_USAGE
    assert "GEÇERSİZ KANIT PAKETİ" in capsys.readouterr().err


def test_wrong_schema_exits_usage(tmp_path: Path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema": "other/v1"}), encoding="utf-8")

    code = main(["--bundle", str(bad), "--out", str(tmp_path / "a.md")])
    assert code == EXIT_USAGE
    assert "desteklenmeyen şema" in capsys.readouterr().err


def test_module_is_runnable_as_python_m_export_cli(tmp_path: Path):
    """``python -m export.cli`` really works as a process, offline.

    Documented invocation, so it is exercised as an actual subprocess rather
    than by calling ``main()`` in-process. No network is involved: the child
    only reads a local fixture and writes into ``tmp_path``.
    """
    import subprocess
    import sys

    repo_root = Path(__file__).resolve().parents[2]
    out = tmp_path / "subprocess.md"
    completed = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8",
            "-m",
            "export.cli",
            "--bundle",
            str(QUALIFIED_JSON),
            "--out",
            str(out),
            "--format",
            "md",
        ],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )

    assert completed.returncode == EXIT_OK, completed.stderr
    assert out.is_file()
    assert "MD yazıldı" in completed.stdout


# --------------------------------------------------------------------------
# W14 · B-01 — the quote integrity gate on the CLI path
# --------------------------------------------------------------------------
#
# Replays W13-UXAUDIT P0-1. The evidence entry itself is NEVER touched (its
# `quoteSha256` still verifies, so the old gate stayed happy); only the
# paragraph text is edited, exactly as the editor allowed:
#   (a) `uc yildan yedi yila` -> `bes yildan on yila`  (a penalty in WORDS)
#   (b) `MADDE 157` -> `MADDE 158`                     (the kunye still says 157)
# Every draft format must refuse, and nothing may be written.
#
# All content is SENTETIK - authored for this test, not real Turkish law.

import hashlib

B01_QUOTE = (
    "MADDE 157 - (1) Hileli davranislarla bir kimseyi aldatarak sentetik bir"
    " yarar saglayan kisiye üç yıldan yedi yıla kadar hapis ve besbin güne"
    " kadar adli para cezasi verilir."
)
B01_LABEL = "5237 sayili Turk Ceza Kanunu (SENTETIK), m. 157"


def _b01_draft(mutation: tuple[str, str] | None = None) -> dict:
    """A minimal, valid `collex.draft/v1` whose one legal paragraph cites K-1."""
    quote_in_paragraph = B01_QUOTE
    if mutation is not None:
        frm, to = mutation
        quote_in_paragraph = B01_QUOTE.replace(frm, to)
        assert quote_in_paragraph != B01_QUOTE, "the mutation must change the quote"
    return {
        "schema": "collex.draft/v1",
        "draftId": "dft-b01",
        "kind": "dilekce",
        "template": "dava-dilekcesi",
        "title": "Dava Dilekcesi",
        "createdAt": "2026-09-02T10:00:00.000Z",
        "reviewRequired": True,
        "sections": [
            {
                "id": "hukuki-sebepler",
                "title": "HUKUKI SEBEPLER",
                "paragraphs": [
                    {
                        "id": "p-sebepler-1",
                        "text": f'Dayanak: {B01_LABEL} — "{quote_in_paragraph}"',
                        "evidenceIds": ["ev-b01"],
                        "supported": True,
                        "note": "dogrulanmis kaynaga bagli",
                        "role": "hukukiSebepler",
                    }
                ],
            }
        ],
        "evidence": [
            {
                "evidenceId": "ev-b01",
                "label": B01_LABEL,
                "source": "MEVZUAT",
                "title": "Turk Ceza Kanunu (SENTETIK)",
                "quote": B01_QUOTE,
                "quoteSha256": hashlib.sha256(B01_QUOTE.encode("utf-8")).hexdigest(),
                "contentSha256": hashlib.sha256(
                    ("SENTETIK TAM METIN" + chr(10) + B01_QUOTE).encode("utf-8")
                ).hexdigest(),
            }
        ],
        "unsupportedCount": 0,
        "warnings": [],
        "synthetic": True,
    }


@pytest.mark.parametrize(
    "mutation",
    [
        ("üç yıldan yedi yıla", "beş yıldan on yıla"),
        ("MADDE 157", "MADDE 158"),
    ],
    ids=["words", "digits"],
)
@pytest.mark.parametrize("fmt", ["dilekce-docx", "dilekce-udf"])
def test_altered_quote_refuses_every_draft_format_and_writes_nothing(
    tmp_path: Path, capsys, mutation, fmt
):
    if fmt == "dilekce-docx":
        pytest.importorskip("docx")
    src = tmp_path / "taslak.json"
    src.write_text(json.dumps(_b01_draft(mutation), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / ("dilekce.udf" if fmt == "dilekce-udf" else "dilekce.docx")

    code = main(["--draft", str(src), "--out", str(out), "--format", fmt])

    assert code == EXIT_REFUSED
    assert not out.exists()
    assert list(tmp_path.glob("*.tmp")) == []
    err = capsys.readouterr().err
    assert "QUOTE_ALTERED" in err
    assert "alıntı değiştirildi — kanıt bağı koptu" in err
    assert "[K-1]" in err


@pytest.mark.parametrize("fmt", ["dilekce-docx", "dilekce-udf"])
def test_untouched_draft_still_exports_after_the_gate(tmp_path: Path, fmt):
    """The gate is invisible to a draft nobody tampered with."""
    if fmt == "dilekce-docx":
        pytest.importorskip("docx")
    src = tmp_path / "taslak.json"
    src.write_text(json.dumps(_b01_draft(), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / ("dilekce.udf" if fmt == "dilekce-udf" else "dilekce.docx")
    assert main(["--draft", str(src), "--out", str(out), "--format", fmt, "--quiet"]) == EXIT_OK
    assert out.is_file() and out.stat().st_size > 0
