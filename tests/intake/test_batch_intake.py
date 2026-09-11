# -*- coding: utf-8 -*-
"""W14 B-19 — folder / bulk intake ("drop the folder you downloaded from UYAP").

Both competitors close this gap by binding to the lawyer's UYAP identity —
Apilex with a Chrome extension, De Jure with a desktop editor a vendor
installs over AnyDesk that then connects to UYAP as the lawyer and ships the
data to Google Cloud. We deliberately do neither (backlog §C.3): that is the
one move that would destroy the only clear position we have. Most of the
pain, though, is not the login — it is dropping thirty files one at a time.

So: a folder goes in, files come out one at a time, through EXACTLY the same
``process_file`` path a single upload uses. What these tests pin is that the
batch mode adds no second, looser intake path and that one bad file never
costs the lawyer the other nineteen.

Real integration tests against the scratch database (the package conftest
skips cleanly when it is unreachable).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from intake import cli
from intake.errors import InvalidRequestError, NotFoundError


def _folder(tmp_path: Path, uploads_dir: Path) -> Path:
    """A realistic UYAP-ish download: real documents, side-car files, and
    one broken PDF that must not take the batch down with it."""
    folder = tmp_path / "UYAP-2026-1234"
    (folder / "ekler").mkdir(parents=True)
    for name in ("dilekce_ornek.docx", "metin_ornek.txt", "sozlesme_ornek.pdf"):
        (folder / name).write_bytes((uploads_dir / name).read_bytes())
    (folder / "ekler" / "udf_ornek.udf").write_bytes(
        (uploads_dir / "udf_ornek.udf").read_bytes()
    )
    # A scan: OCR is fail-closed, so this one legitimately fails.
    (folder / "taranmis.pdf").write_bytes((uploads_dir / "taranmis.pdf").read_bytes())
    # Side-cars UYAP downloads carry; not documents, not failures.
    (folder / "index.html").write_text("<html></html>", encoding="utf-8")
    (folder / "evrak.xml").write_text("<x/>", encoding="utf-8")
    return folder


def test_a_folder_is_processed_file_by_file_and_reports_each_one(
    dsn, uploads_dir, store_dir, tmp_path, capsys
):
    folder = _folder(tmp_path, uploads_dir)
    code = cli.main([
        "--dsn", dsn, "--dir", str(folder),
        "--store-dir", str(store_dir), "--json",
    ])
    body = json.loads(capsys.readouterr().out)["batch"]

    # One bad file among five must not fail the batch.
    assert code == 0
    assert body["total"] == 5
    assert body["ok"] == 4
    assert body["failed"] == 1

    by_path = {entry["path"]: entry for entry in body["files"]}
    # Nested folders are walked; the path is relative and POSIX-shaped so a
    # console can show it verbatim.
    assert "ekler/udf_ornek.udf" in by_path
    assert by_path["ekler/udf_ornek.udf"]["status"] == "ok"

    # B-10: a failed file is named, with its reason, in Turkish.
    failed = by_path["taranmis.pdf"]
    assert failed["status"] == "error"
    assert failed["name"] == "taranmis.pdf"
    assert failed["kind"] == "EXTRACTION_FAILED"
    assert "OCR" in failed["message"] or "taranmış" in failed["message"]

    # Side-cars are skipped silently — calling them errors would bury the
    # one real problem in noise.
    assert not any(entry["path"].endswith((".html", ".xml")) for entry in body["files"])

    # Each successful entry carries the SAME IntakeResult body a single
    # upload returns, so the console needs no second renderer.
    ok_entry = by_path["dilekce_ornek.docx"]["result"]
    assert set(ok_entry) >= {"fileId", "name", "mime", "sha256", "kind", "extraction"}
    assert len(ok_entry["fileId"]) == 16


def test_re_running_the_same_folder_is_idempotent(
    dsn, uploads_dir, store_dir, tmp_path, capsys
):
    """A partially-completed batch is resumable by simply running it again:
    an already-ingested document answers `already-existed`, not an error."""
    folder = tmp_path / "tekrar"
    folder.mkdir()
    (folder / "metin_ornek.txt").write_bytes((uploads_dir / "metin_ornek.txt").read_bytes())

    cli.main(["--dsn", dsn, "--dir", str(folder), "--store-dir", str(store_dir), "--json"])
    first = json.loads(capsys.readouterr().out)["batch"]
    assert first["ok"] == 1
    assert first["files"][0]["result"]["action"] == "created"

    cli.main(["--dsn", dsn, "--dir", str(folder), "--store-dir", str(store_dir), "--json"])
    second = json.loads(capsys.readouterr().out)["batch"]
    assert second["ok"] == 1
    assert second["files"][0]["result"]["action"] == "already-existed"


def test_a_folder_where_EVERY_file_fails_exits_2(
    dsn, uploads_dir, store_dir, tmp_path, capsys
):
    folder = tmp_path / "hepsi-bozuk"
    folder.mkdir()
    (folder / "taranmis.pdf").write_bytes((uploads_dir / "taranmis.pdf").read_bytes())
    code = cli.main([
        "--dsn", dsn, "--dir", str(folder), "--store-dir", str(store_dir), "--json",
    ])
    body = json.loads(capsys.readouterr().out)["batch"]
    assert code == 2
    assert body["ok"] == 0 and body["failed"] == 1


def test_a_missing_folder_is_a_typed_NOT_FOUND(dsn, tmp_path, capsys):
    code = cli.main(["--dsn", dsn, "--dir", str(tmp_path / "yok"), "--json"])
    body = json.loads(capsys.readouterr().out)
    assert code == 2
    assert body["error"]["kind"] == "NOT_FOUND"


def test_the_batch_cap_refuses_UP_FRONT_and_names_the_count(tmp_path):
    """An accidental drop of a huge tree must be refused before any work,
    not discovered three hundred documents in."""
    folder = tmp_path / "cok"
    folder.mkdir()
    for index in range(cli.BATCH_MAX_FILES + 3):
        (folder / f"belge{index:04d}.txt").write_text("metin", encoding="utf-8")
    with pytest.raises(InvalidRequestError) as exc:
        cli.collect_batch_files(folder)
    assert str(cli.BATCH_MAX_FILES) in exc.value.message
    assert str(cli.BATCH_MAX_FILES + 3) in exc.value.message
    assert "klasörü bölün" in exc.value.message.lower()


def test_collect_batch_files_is_sorted_recursive_and_extension_filtered(tmp_path):
    folder = tmp_path / "karisik"
    (folder / "alt").mkdir(parents=True)
    for name in ("b.txt", "a.pdf", "c.notes", "d.HTML"):
        (folder / name).write_text("x", encoding="utf-8")
    (folder / "alt" / "e.docx").write_text("x", encoding="utf-8")
    found = [p.relative_to(folder).as_posix() for p in cli.collect_batch_files(folder)]
    assert found == ["a.pdf", "alt/e.docx", "b.txt"]

    with pytest.raises(NotFoundError):
        cli.collect_batch_files(folder / "yok")


def test_batch_mode_uses_the_SAME_intake_path_as_a_single_upload():
    """No second, looser path: quarantine, the magic-byte sniff, the
    ZIP-bomb gates and the page cap all apply because the batch calls
    ``process_file`` per file and nothing else."""
    source = (Path(cli.__file__)).read_text(encoding="utf-8")
    body = source.split("def process_directory(", 1)[1].split("\ndef ", 1)[0]
    assert "process_file(" in body
    for forbidden in ("verify_upload(", "extract_text(", "Pipeline("):
        assert forbidden not in body, (
            f"process_directory reimplements {forbidden} instead of going"
            " through process_file — that is a hole in every intake gate"
        )
