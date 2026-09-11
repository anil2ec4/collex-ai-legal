"""``python -m ingestion.library`` — the process contract the control plane
spawns (``POST /v1/library/ingest``).

The in-process behaviour of the publisher is covered by ``test_library.py``;
this module pins the PROCESS surface: the argument spelling, the
machine-readable stdout, the exit codes, the typed ``STORE_UNAVAILABLE``
(no driver prose, no DSN on stdout), idempotency across two real runs, and
the one count ``/v1/health.corpus.publicDocuments`` reads
(``legal.documents`` rows with ``scope = 'public'``).

Same database contract as the rest of the package: the scratch
``collex_ingest_test`` from ``conftest.py`` — never ``collex_local``.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from ingestion import library

REPO_ROOT = Path(__file__).resolve().parents[2]

TEXT = (
    "T.C. YARGITAY 3. Hukuk Dairesi\nE. 2025/77 K. 2025/88\n\n"
    "ÖZET: Kira sözleşmesinin feshi ve tahliye talebi.\n\n"
    "OLAY: Davacı kiraya veren, kiracının kira bedelini ödemediğini ileri"
    " sürmüştür.\n\n"
    "GEREKÇE: 6098 sayılı Türk Borçlar Kanunu m. 315 uyarınca temerrüt"
    " koşulları oluşmuştur.\n\n"
    "HÜKÜM: Kararın ONANMASINA oybirliğiyle karar verildi.\n"
)


def _envelope(text: str = TEXT, external_id: str = "yargitay-2025-88") -> dict:
    return {
        "schema": library.LIBRARY_RECORD_SCHEMA,
        "source": "BEDESTEN",
        "externalId": external_id,
        "title": "Yargıtay 3. HD 2025/77 E., 2025/88 K.",
        "sourceUrl": "https://bedesten.adalet.gov.tr/karar/88",
        "toolName": "get_bedesten_document_markdown",
        "fetchedAt": "2026-09-08T10:00:00.000Z",
        "originLabel": library.LIBRARY_ORIGIN_LABEL,
        "scope": library.LIBRARY_SCOPE,
        "mediaType": library.LIBRARY_MEDIA_TYPE,
        "text": text,
        "contentSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "contentCodePoints": len(text),
        "runId": "run-cli-0001",
    }


def _write(spool: Path, body: dict) -> Path:
    spool.mkdir(parents=True, exist_ok=True)
    name = f"{body['source']}__{body['externalId']}__{body['contentSha256'][:16]}.json"
    path = spool / name
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    return path


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    """Spawn the module exactly as the control plane does (venv interpreter,
    ``-X utf8``, repo root as cwd, provider keys blanked)."""
    env = dict(os.environ)
    env.update({
        "OPENROUTER_API_KEY": "", "BRAVE_API_TOKEN": "", "TAVILY_API_KEY": "",
        "COLLEX_NO_DOTENV": "1", "PYTHONIOENCODING": "utf-8",
    })
    return subprocess.run(
        [sys.executable, "-X", "utf8", "-m", "ingestion.library", *args],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True,
        encoding="utf-8", timeout=180, check=False,
    )


def _public_documents(conn) -> int:
    """The exact expression ``control-plane/src/api/healthReport.ts``
    ``countCorpus`` evaluates for ``corpus.publicDocuments``."""
    return conn.execute(
        "select count(*) filter (where scope = 'public')::int"
        " from legal.documents"
    ).fetchone()[0]


@pytest.fixture()
def spool(tmp_path: Path) -> Path:
    directory = tmp_path / "library"
    directory.mkdir()
    return directory


def test_cli_publishes_reports_json_and_second_run_ingests_nothing(
    dsn: str, spool: Path, conn
):
    _write(spool, _envelope())
    assert _public_documents(conn) == 0

    first = _run("--dsn", dsn, "--dir", str(spool), "--json")
    assert first.returncode == 0, first.stderr
    report = json.loads(first.stdout)["library"]
    assert report["scanned"] == 1
    assert report["published"] == 1
    assert report["skipped"] == 0
    assert report["failed"] == 0
    assert report["chunks"] > 0
    assert report["documents"][0]["movedTo"].endswith(
        os.path.join(library.PUBLISHED_SUBDIR,
                     Path(report["documents"][0]["path"]).name)
    )

    # (4) the health page's corpus counter is exactly this row count.
    assert _public_documents(conn) == 1

    # Provenance survives into the version row: source, url, fetch date, hash.
    meta, sha = conn.execute(
        "select v.metadata -> 'fixture_meta', v.content_sha256"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.source = 'BEDESTEN' and d.external_id = 'yargitay-2025-88'"
    ).fetchone()
    assert meta["synthetic"] is False
    assert meta["library"]["source_url"] == "https://bedesten.adalet.gov.tr/karar/88"
    assert meta["library"]["fetched_at"] == "2026-09-08T10:00:00.000Z"
    assert meta["library"]["content_sha256"] == sha == _envelope()["contentSha256"]

    # (2) idempotent: the envelope was moved to yayimlandi/, the spool is
    # empty, and a second run touches nothing.
    second = _run("--dsn", dsn, "--dir", str(spool), "--json")
    assert second.returncode == 0, second.stderr
    again = json.loads(second.stdout)["library"]
    assert again["scanned"] == 0
    assert again["published"] == 0
    assert again["failed"] == 0
    assert _public_documents(conn) == 1


def test_re_queued_identical_content_is_deduplicated_by_hash(
    dsn: str, spool: Path, conn
):
    path = _write(spool, _envelope())
    assert _run("--dsn", dsn, "--dir", str(spool), "--json").returncode == 0
    # The same document arrives again (e.g. fetched by a second research
    # run): the writer would have called it a duplicate, but even if a copy
    # lands in the spool it publishes NO second document.
    shutil.copy(spool / library.PUBLISHED_SUBDIR / path.name, path)

    result = _run("--dsn", dsn, "--dir", str(spool), "--json")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)["library"]
    assert report["published"] == 0
    assert report["skipped"] == 1
    assert report["unchanged"] == 1
    assert _public_documents(conn) == 1
    assert conn.execute("select count(*) from legal.document_versions").fetchone()[0] == 1


def test_dry_run_writes_nothing(dsn: str, spool: Path, conn):
    path = _write(spool, _envelope())
    result = _run("--dsn", dsn, "--dir", str(spool), "--json", "--dry-run")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)["library"]
    assert report["dryRun"] is True
    assert report["published"] == 1  # WOULD be published
    assert path.exists()
    assert _public_documents(conn) == 0


def test_cli_refuses_every_other_database_name(spool: Path):
    _write(spool, _envelope())
    result = _run("--dsn", "postgres://postgres@127.0.0.1:55432/collex_demo",
                  "--dir", str(spool), "--json")
    assert result.returncode == 2
    body = json.loads(result.stdout)
    assert body["error"]["kind"] == "INVALID_REQUEST"
    assert "collex_demo" in body["error"]["message"]
    assert (spool / library.PUBLISHED_SUBDIR).exists() is False


def test_dead_database_is_a_typed_store_unavailable_without_the_dsn(spool: Path):
    _write(spool, _envelope())
    # Port 1 refuses immediately; an allowed database NAME so the name gate
    # passes and the connection is what fails.
    dsn = "postgres://postgres@127.0.0.1:1/collex_ingest_test"
    result = _run("--dsn", dsn, "--dir", str(spool), "--json")
    assert result.returncode == 2
    body = json.loads(result.stdout)
    assert body["error"]["kind"] == "STORE_UNAVAILABLE"
    assert body["error"]["message"] == "Yerel veritabanına ulaşılamadı."
    assert "127.0.0.1:1" not in result.stdout
    assert "postgres://" not in result.stdout
    # The envelope is untouched: the next run (with a live database) retries.
    assert list(spool.glob("*.json"))


def test_module_argument_spelling_is_the_one_the_control_plane_spawns():
    """The TS router builds ``-m ingestion.library --dsn … --dir … --json``;
    the parser must keep accepting exactly that (and reject nothing else
    silently)."""
    with pytest.raises(SystemExit) as excinfo:
        library.main(["--dir", "x"])  # --dsn missing
    assert excinfo.value.code == 2
    with pytest.raises(SystemExit) as excinfo:
        library.main(["--dsn", "x", "--dir", "y", "--bogus"])
    assert excinfo.value.code == 2
