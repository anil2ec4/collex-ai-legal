"""CLI contract tests: exactly what the TS /v1/files API will shell to."""

from __future__ import annotations

import json

import pytest

from intake import cli


def _run(capsys, argv: list[str]) -> tuple[int, dict]:
    code = cli.main(argv)
    out = capsys.readouterr().out
    return code, json.loads(out)


def test_file_json_prints_intake_result(dsn, uploads_dir, store_dir, capsys):
    code, body = _run(capsys, [
        "--dsn", dsn, "--file", str(uploads_dir / "dilekce_ornek.docx"),
        "--store-dir", str(store_dir), "--json",
    ])
    assert code == 0
    # Original contract keys, plus the additive `action` (W12-F). `pages`
    # and `message` appear only for PDFs / re-uploads respectively.
    assert set(body) == {
        "fileId", "name", "mime", "sha256", "sizeBytes", "kind",
        "extraction", "analysis", "warnings", "action",
    }
    assert body["kind"] == "docx"
    assert body["action"] == "created"
    assert body["extraction"]["chars"] > 0
    assert body["extraction"]["chunkCount"] > 0
    assert body["extraction"]["ocr"] is False
    assert body["analysis"]["parties"]


def test_file_json_reupload_and_pdf_pages(dsn, uploads_dir, store_dir, capsys,
                                          tmp_path):
    from tests.intake.pdf_fixtures import mixed_pdf

    code, first = _run(capsys, [
        "--dsn", dsn, "--file", str(uploads_dir / "metin_ornek.txt"),
        "--store-dir", str(store_dir), "--json",
    ])
    assert code == 0 and first["action"] == "created"
    code, again = _run(capsys, [
        "--dsn", dsn, "--file", str(uploads_dir / "metin_ornek.txt"),
        "--store-dir", str(store_dir), "--json",
    ])
    assert code == 0
    assert again["fileId"] == first["fileId"]
    assert again["action"] == "already-existed"
    assert again["message"] == "Bu belge zaten yüklüydü"

    pdf = tmp_path / "karisik.pdf"
    pdf.write_bytes(mixed_pdf(text_pages=2, empty_pages=3))
    code, body = _run(capsys, [
        "--dsn", dsn, "--file", str(pdf), "--store-dir", str(store_dir),
        "--json",
    ])
    assert code == 0
    assert body["extraction"]["pages"] == 5
    assert body["pages"] == {
        "pageCount": 5, "pagesWithText": 2, "emptyPages": [3, 4, 5],
    }
    assert "SCANNED_PAGES:3" in body["warnings"]


def test_unreachable_store_prints_store_unavailable_and_exits_2(
    uploads_dir, store_dir, capsys
):
    """Contract [X]: {"error":{"kind":"STORE_UNAVAILABLE","message":
    "Yerel veritabanına ulaşılamadı."}} on stdout, exit 2, within ~6 s."""
    import socket
    import time

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    dsn = f"postgres://postgres@127.0.0.1:{port}/collex_intake_test"

    for argv in (
        ["--dsn", dsn, "--file", str(uploads_dir / "metin_ornek.txt"),
         "--store-dir", str(store_dir), "--json"],
        ["--dsn", dsn, "--list"],
        ["--dsn", dsn, "--show", "deadbeef00000000"],
        ["--dsn", dsn, "--delete", "deadbeef00000000"],
    ):
        started = time.monotonic()
        code, body = _run(capsys, argv)
        assert time.monotonic() - started < 10
        assert code == 2
        assert body == {
            "error": {"kind": "STORE_UNAVAILABLE",
                      "message": "Yerel veritabanına ulaşılamadı."},
        }


def test_list_show_delete_roundtrip(dsn, uploads_dir, store_dir, capsys):
    code, body = _run(capsys, [
        "--dsn", dsn, "--file", str(uploads_dir / "metin_ornek.txt"),
        "--store-dir", str(store_dir), "--json",
    ])
    assert code == 0
    file_id = body["fileId"]

    code, listing = _run(capsys, ["--dsn", dsn, "--list"])
    assert code == 0
    assert [f["fileId"] for f in listing["files"]] == [file_id]

    code, detail = _run(capsys, ["--dsn", dsn, "--show", file_id])
    assert code == 0
    assert detail["chunks"]

    code, deleted = _run(capsys, [
        "--dsn", dsn, "--delete", file_id, "--store-dir", str(store_dir),
    ])
    assert code == 0
    assert deleted["deleted"] == file_id

    code, listing = _run(capsys, ["--dsn", dsn, "--list"])
    assert code == 0
    assert listing["files"] == []


def test_typed_error_json_and_exit_2(dsn, uploads_dir, store_dir, capsys):
    code, body = _run(capsys, [
        "--dsn", dsn, "--file", str(uploads_dir / "taranmis.pdf"),
        "--store-dir", str(store_dir), "--json",
    ])
    assert code == 2
    assert body["error"]["kind"] == "EXTRACTION_FAILED"
    assert "taranmış PDF" in " ".join(body["error"].get("warnings", []))


def test_unsupported_type_error_kind(dsn, uploads_dir, store_dir, capsys,
                                     tmp_path):
    disguised = tmp_path / "sahte.pdf"
    disguised.write_bytes((uploads_dir / "dilekce_ornek.docx").read_bytes())
    code, body = _run(capsys, [
        "--dsn", dsn, "--file", str(disguised),
        "--store-dir", str(store_dir), "--json",
    ])
    assert code == 2
    assert body["error"]["kind"] == "UNSUPPORTED_TYPE"


def test_delete_unknown_id_not_found(dsn, capsys):
    code, body = _run(capsys, ["--dsn", dsn, "--delete", "deadbeef00000000"])
    assert code == 2
    assert body["error"]["kind"] == "NOT_FOUND"


def test_ensure_db_refuses_foreign_database_names(dsn):
    # Guard must trip BEFORE any connection is attempted.
    with pytest.raises(SystemExit) as exc:
        cli.ensure_database(
            "postgres://postgres@127.0.0.1:55432/collex_demo"
        )
    assert "refuses" in str(exc.value)
    with pytest.raises(SystemExit):
        cli.ensure_database(
            "postgres://postgres@127.0.0.1:55432/collex_mig_test"
        )


def test_ensure_db_is_idempotent_on_existing_schema(dsn, capsys):
    # The scratch DB already has every migration applied by the session
    # fixture; --ensure-db must not replay them (create table would fail).
    code = cli.main(["--dsn", dsn, "--ensure-db", "--list"])
    out = capsys.readouterr().out
    assert code == 0
    ensure_line, list_line = out.strip().split("\n{", 1)
    ensure = json.loads(ensure_line)["ensureDb"]
    assert ensure["database"] == "collex_intake_test"
    assert ensure["created"] is False
    assert ensure["migrationsApplied"] == []
    listing = json.loads("{" + list_line)
    assert "files" in listing
