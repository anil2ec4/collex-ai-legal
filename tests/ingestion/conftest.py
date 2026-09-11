"""Fixtures for the ingestion integration suite.

These are REAL integration tests. They talk to the local scratch PostgreSQL
(127.0.0.1:55432, user postgres, no password) and to nothing else — no
remote/Supabase connection is ever opened, no provider API is called, and
the credential env vars are blanked below before any server module can be
imported (the same fail-closed pattern as scripts/smoke_check.py and
tests/conftest.py).

Database contract
-----------------
Everything runs against the scratch database ``collex_ingest_test``, which
is dropped and recreated ONCE per session and then loaded with every
migration that does not require pgvector
(``ingestion.migrations.runnable_migrations`` — the same classifier the CLI
and scripts/db_local_check.py use). Migration SQL is read in Python and
sent over the wire; psql is never asked to open a path, because this repo
lives under a directory with non-ASCII characters.

Per-test isolation is a TRUNCATE of the data tables rather than a database
rebuild: applying nine migrations per test would dominate the runtime, and
TRUNCATE ... RESTART IDENTITY CASCADE gives the same clean slate.

If the scratch server is not reachable — or the ``psycopg`` driver is not
installed at all — the whole package SKIPS with a clear reason, so the
offline CI job (which has no PostgreSQL) stays green. Both cases have to
skip for that promise to hold: a MISSING driver used to raise at this
module's import line instead, and because every test module here imports
``ingestion.pipeline`` (which imports psycopg too), the failure was a
COLLECTION error that took the whole ``pytest tests`` run to exit 2. The
guarded import plus ``pytest.importorskip`` below turn that into the skip
the docstring always promised. Set ``COLLEX_REQUIRE_DB=1`` to turn either
skip into a hard failure — use it whenever these tests are meant to be part
of the evidence.
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

_MISSING_DRIVER = (
    "the psycopg driver is not importable; tests/ingestion are REAL"
    " integration tests against the local scratch PostgreSQL and cannot run"
    " without it. It is declared in the [dependency-groups] dev group of"
    " pyproject.toml (psycopg[binary])"
)

# Guarded on purpose. Every test module in this package imports
# ``ingestion.pipeline``, which imports psycopg at module level, so an
# unguarded import here made a MISSING package a collection ERROR for the
# whole run (exit 2) rather than the package skip this file promises. Skipping
# is the honest outcome for an integration package with no driver; failing the
# entire suite is not.
try:
    import psycopg  # noqa: E402 - after the env fail-closed block
except ImportError as _driver_error:  # pragma: no cover - env-dependent
    _reason = f"{_MISSING_DRIVER} ({type(_driver_error).__name__}: {_driver_error})"
    # Same escape hatch as an unreachable server: when these tests are meant to
    # be part of the evidence, a silent skip is itself the failure.
    if os.environ.get("COLLEX_REQUIRE_DB") == "1":
        pytest.fail(_reason, pytrace=False)
    pytest.skip(_reason, allow_module_level=True)

from ingestion.migrations import runnable_migrations  # noqa: E402

HOST = os.environ.get("COLLEX_DB_HOST", "127.0.0.1")
PORT = int(os.environ.get("COLLEX_DB_PORT", "55432"))
USER = os.environ.get("COLLEX_DB_USER", "postgres")
DBNAME = "collex_ingest_test"
PROBE_ROLE = "collex_ingest_probe"

CORPUS_DIR = _REPO_ROOT / "evals" / "fixtures" / "corpus"

DSN = f"postgres://{USER}@{HOST}:{PORT}/{DBNAME}"
ADMIN_DSN = f"postgres://{USER}@{HOST}:{PORT}/postgres"

# Data tables cleared between tests. app_private.jobs is included so job
# idempotency assertions start from zero.
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
    """Return a skip reason, or None when the scratch server answers."""
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
    """Recreate ``collex_ingest_test`` and apply the runnable migrations."""
    reason = _db_unavailable()
    if reason is not None:
        if os.environ.get("COLLEX_REQUIRE_DB") == "1":
            pytest.fail(reason)
        pytest.skip(reason)

    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f"drop database if exists {DBNAME} with (force)")
        admin.execute(f"drop role if exists {PROBE_ROLE}")
        admin.execute(f"create role {PROBE_ROLE} nologin")
        # template0 + UTF8 + C locale: deterministic character semantics for
        # the code-point offset assertions regardless of cluster defaults.
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
        admin.execute(f"drop role if exists {PROBE_ROLE}")


@pytest.fixture()
def dsn(scratch_db: str) -> str:
    """Clean scratch DSN: every data table emptied before the test."""
    with psycopg.connect(scratch_db, autocommit=True) as conn:
        conn.execute(_TRUNCATE)
    return scratch_db


@pytest.fixture()
def conn(dsn: str) -> Iterator[psycopg.Connection]:
    """Autocommit connection on the cleaned scratch database."""
    with psycopg.connect(dsn, autocommit=True) as connection:
        yield connection


@pytest.fixture()
def corpus_dir() -> Path:
    assert CORPUS_DIR.is_dir(), f"missing fixture corpus at {CORPUS_DIR}"
    return CORPUS_DIR
