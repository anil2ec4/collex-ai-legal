"""Fixtures for the intake integration suite.

Same posture as tests/ingestion/conftest.py (see its docstring for the
reasoning, kept in sync deliberately): REAL integration tests against the
local scratch PostgreSQL (127.0.0.1:55432, user postgres, no password) and
nothing else. Provider env vars are blanked before any server module can
be imported; a missing psycopg driver or an unreachable server SKIPS the
package (``COLLEX_REQUIRE_DB=1`` turns either skip into a failure).

Database contract (scratch-database discipline, CLAUDE.md): this lane owns
``collex_intake_test`` and ONLY that name — created once per session,
dropped afterwards, truncated between tests. The persistent local store
``collex_local`` is never touched by tests.

The quarantine/extract/analysis unit tests in this package do not request
the ``dsn``/``conn`` fixtures and therefore run even without a database.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Iterator

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Fail closed before anything imports a provider-gated module.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
os.environ["MCP_API_TOKEN"] = "offline-pytest-dummy-token-0123456789abc"

def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "slow: multi-second end-to-end timing tests (run by default;"
        " deselect with -m 'not slow')",
    )


@pytest.fixture(autouse=True)
def _no_local_ocr_unless_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin ``COLLEX_OCR=off`` for every intake test (W21).

    Most intake tests assert the NO-OCR behaviour of scanned pages
    (UNREADABLE, the fail-closed "OCR bu modda devre dışı" warning). On a
    machine that happens to have tesseract + pdftoppm + tur installed — a
    Mac with Homebrew, say — default detection would run REAL OCR on the
    fixtures and silently change what those tests mean. The OCR tests hand
    in their provider (a fake) or an explicit environment instead, so this
    pin does not touch them.
    """
    monkeypatch.setenv("COLLEX_OCR", "off")


_MISSING_DRIVER = (
    "the psycopg driver is not importable; tests/intake are REAL"
    " integration tests against the local scratch PostgreSQL and cannot run"
    " without it (declared in pyproject [dependency-groups] dev)"
)

try:
    import psycopg  # noqa: E402 - after the env fail-closed block
except ImportError as _driver_error:  # pragma: no cover - env-dependent
    _reason = (
        f"{_MISSING_DRIVER} ({type(_driver_error).__name__}: {_driver_error})"
    )
    if os.environ.get("COLLEX_REQUIRE_DB") == "1":
        pytest.fail(_reason, pytrace=False)
    pytest.skip(_reason, allow_module_level=True)

from ingestion.migrations import runnable_migrations  # noqa: E402

HOST = os.environ.get("COLLEX_DB_HOST", "127.0.0.1")
PORT = int(os.environ.get("COLLEX_DB_PORT", "55432"))
USER = os.environ.get("COLLEX_DB_USER", "postgres")
DBNAME = "collex_intake_test"

UPLOADS_DIR = _REPO_ROOT / "evals" / "fixtures" / "uploads"
CORPUS_DIR = _REPO_ROOT / "evals" / "fixtures" / "corpus"

DSN = f"postgres://{USER}@{HOST}:{PORT}/{DBNAME}"
ADMIN_DSN = f"postgres://{USER}@{HOST}:{PORT}/postgres"

_TRUNCATE = (
    "truncate"
    " legal.documents,"
    " legal.source_snapshots,"
    " legal.document_versions,"
    " legal.chunks,"
    " legal.document_relations,"
    " app_private.jobs"
    " restart identity cascade"
)


def _db_unavailable() -> str | None:
    try:
        with psycopg.connect(ADMIN_DSN, connect_timeout=5):
            return None
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        return (
            f"local scratch PostgreSQL {USER}@{HOST}:{PORT} is not reachable"
            f" ({type(exc).__name__}: {exc}); these are real integration"
            " tests and cannot run without it"
        )


@pytest.fixture(scope="session")
def scratch_db() -> Iterator[str]:
    """Recreate ``collex_intake_test`` and apply the runnable migrations."""
    reason = _db_unavailable()
    if reason is not None:
        if os.environ.get("COLLEX_REQUIRE_DB") == "1":
            pytest.fail(reason)
        pytest.skip(reason)

    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f"drop database if exists {DBNAME} with (force)")
        admin.execute(
            f"create database {DBNAME} template template0"
            " encoding 'UTF8' locale 'C'"
        )

    with psycopg.connect(DSN, autocommit=True) as conn:
        for path in runnable_migrations():
            # Read in Python; psql never sees this non-ASCII repo path.
            conn.execute(path.read_text(encoding="utf-8"))

    yield DSN

    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f"drop database if exists {DBNAME} with (force)")


@pytest.fixture()
def dsn(scratch_db: str) -> str:
    with psycopg.connect(scratch_db, autocommit=True) as conn:
        conn.execute(_TRUNCATE)
    return scratch_db


@pytest.fixture()
def conn(dsn: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(dsn, autocommit=True) as connection:
        yield connection


@pytest.fixture()
def uploads_dir() -> Path:
    assert UPLOADS_DIR.is_dir(), f"missing upload fixtures at {UPLOADS_DIR}"
    return UPLOADS_DIR


@pytest.fixture()
def corpus_dir() -> Path:
    assert CORPUS_DIR.is_dir(), f"missing fixture corpus at {CORPUS_DIR}"
    return CORPUS_DIR


@pytest.fixture()
def store_dir(tmp_path: Path) -> Path:
    """Isolated stand-in for var/uploads so tests never touch the real one."""
    return tmp_path / "uploads"
