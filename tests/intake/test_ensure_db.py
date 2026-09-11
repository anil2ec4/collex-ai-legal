"""``intake.cli --ensure-db`` on an EXISTING database + contract [X]
(STORE_UNAVAILABLE, connect_timeout=5) — W12-A.

Pure tests run without a database. The one database-backed test uses the
package's own ``dsn`` fixture (``collex_intake_test``, the name this
package owns) and skips with it when PostgreSQL is unreachable.
"""

from __future__ import annotations

import json
import time

import psycopg
import pytest

from ingestion.migrations import (
    LEDGER_TABLE,
    runnable_migrations,
)
from intake import cli

REFUSED_DSN = "postgres://postgres@127.0.0.1:1/collex_local"
MATTERS_MIGRATION = "20260902120000_matters_persistence.sql"
AI_AUDIT_MIGRATION = "20260903100000_ai_audit_and_scale_indexes.sql"
#: W14 L-FIX: widens matter_items.kind ("hearing") + three search indexes.
HEARING_MIGRATION = "20260904090000_hearing_kind_and_search_indexes.sql"
#: W19 phase A: source locators (canonical range -> PDF page /
#: DOCX paragraph) + its RLS policy.
LOCATORS_MIGRATION = "20260911100000_source_locators.sql"
#: W19 phases G+H: exhaustive analysis ledger + derived Matter
#: intelligence, with four RLS policies.
ANALYSIS_MIGRATION = "20260911110000_matter_analysis.sql"


def _run(capsys, argv: list[str]) -> tuple[int, str]:
    code = cli.main(argv)
    return code, capsys.readouterr().out


# ---------------------------------------------------------------------------
# Pure
# ---------------------------------------------------------------------------

def test_with_connect_timeout_adds_the_default_and_keeps_an_explicit_one():
    params = psycopg.conninfo.conninfo_to_dict(
        cli.with_connect_timeout("postgres://postgres@127.0.0.1:55432/collex_local")
    )
    assert params["connect_timeout"] == "5"
    assert params["dbname"] == "collex_local"
    assert params["host"] == "127.0.0.1"

    explicit = psycopg.conninfo.conninfo_to_dict(cli.with_connect_timeout(
        "postgres://postgres@127.0.0.1:55432/collex_local?connect_timeout=9"
    ))
    assert explicit["connect_timeout"] == "9"


def test_ensure_db_name_guard_trips_before_any_connection(monkeypatch):
    def no_connect(*_args, **_kwargs):  # pragma: no cover - must not run
        raise AssertionError("psycopg.connect must not be called")

    monkeypatch.setattr(cli.psycopg, "connect", no_connect)
    with pytest.raises(SystemExit) as exc:
        cli.ensure_database("postgres://postgres@127.0.0.1:55432/collex_persist_test")
    assert "refuses" in str(exc.value)


def test_every_data_command_receives_the_timeout_carrying_dsn(monkeypatch, capsys):
    seen: list[str] = []

    def fake_list(dsn: str, tenant: str) -> list[dict]:
        seen.append(dsn)
        return []

    monkeypatch.setattr(cli, "list_files", fake_list)
    code, out = _run(capsys, ["--dsn", "postgres://postgres@127.0.0.1:55432/x", "--list"])
    assert code == 0 and json.loads(out) == {"files": []}
    assert len(seen) == 1
    assert psycopg.conninfo.conninfo_to_dict(seen[0])["connect_timeout"] == "5"


def test_operational_error_maps_to_typed_store_unavailable(monkeypatch, capsys):
    def boom(dsn: str, tenant: str) -> list[dict]:
        raise psycopg.OperationalError("connection failed: secret-dsn-here")

    monkeypatch.setattr(cli, "list_files", boom)
    code, out = _run(capsys, ["--dsn", "postgres://postgres@127.0.0.1:55432/x", "--list"])
    assert code == 2
    body = json.loads(out)
    assert body == {"error": {"kind": "STORE_UNAVAILABLE",
                              "message": "Yerel veritabanına ulaşılamadı."}}
    assert "secret-dsn-here" not in out


def test_refused_port_is_store_unavailable_within_the_budget(capsys):
    """Real socket, loopback only: port 1 refuses immediately; the CLI must
    answer the typed error (exit 2) well inside the ~6 s contract for both
    a data command and --ensure-db (admin connection)."""
    for argv in (["--dsn", REFUSED_DSN, "--list"],
                 ["--dsn", REFUSED_DSN, "--ensure-db"]):
        started = time.monotonic()
        code, out = _run(capsys, argv)
        elapsed = time.monotonic() - started
        assert code == 2, argv
        assert json.loads(out)["error"]["kind"] == "STORE_UNAVAILABLE", argv
        assert elapsed < 15, f"{argv} took {elapsed:.1f}s"


# ---------------------------------------------------------------------------
# Database-backed (collex_intake_test through the package fixture)
# ---------------------------------------------------------------------------

def _split_two_json_documents(out: str) -> tuple[dict, dict]:
    first, rest = out.strip().split("\n{", 1)
    return json.loads(first), json.loads("{" + rest)


def test_ensure_db_applies_the_missing_migration_to_an_existing_database(dsn, capsys):
    # Simulate collex_local as created on 27.08: schema present (the fixture
    # applied every runnable migration), no ledger, matters tables absent.
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(f"drop table if exists {LEDGER_TABLE}")
        conn.execute(
            "drop table if exists app_private.matter_items,"
            " app_private.answers, app_private.drafts, app_private.settings,"
            " app_private.matters cascade"
        )

    code, out = _run(capsys, ["--dsn", dsn, "--ensure-db", "--list"])
    assert code == 0
    ensure, listing = _split_two_json_documents(out)
    ensure = ensure["ensureDb"]
    assert ensure["database"] == "collex_intake_test"
    assert ensure["created"] is False
    # W14: dropping app_private.answers also drops answers_filescope_gin,
    # which the AI-audit migration creates — so that file is correctly seen
    # as NOT applied and is re-applied together with the matters migration.
    # (Before B-05's multi-sentinel rule the index would have stayed missing
    # while the ledger said "applied": exactly the ENGRISK E3 failure.)
    #
    # W14 L-FIX: the same rule catches a third file. Dropping matter_items
    # drops matter_items_kind_check and matter_items_hearing_date_idx, and
    # the hearing migration declares BOTH as probes, so it too is seen as
    # not applied. Its `constraint:` probe is what makes that visible:
    # without it a rebuilt matter_items would have kept the OLD six-value
    # kind CHECK while the ledger said the file was applied, and every
    # hearing insert would have failed forever.
    applied = [MATTERS_MIGRATION, AI_AUDIT_MIGRATION, HEARING_MIGRATION]
    assert ensure["migrationsApplied"] == applied
    # Everything else still had every object it declares, so the ledger
    # RECORDS it without running it. The W12 timestamp boundary is not the
    # cut any more: 20260911's source-locator table and policy survived the
    # drop above, so that file bootstraps even though it is newer than the
    # boundary. Deriving the expectation from "not re-applied" keeps this
    # assertion true for the next migration too, without weakening it --
    # a file that SHOULD have been re-applied still fails the line above.
    untouched = [
        p.name for p in runnable_migrations() if p.name not in applied
    ]
    assert ensure["migrationsBootstrapped"] == untouched
    assert ensure["migrationsAlreadyApplied"] == 0
    assert "files" in listing

    with psycopg.connect(dsn, autocommit=True) as conn:
        tables = {
            r[0] for r in conn.execute(
                "select table_name from information_schema.tables"
                " where table_schema = 'app_private'"
            ).fetchall()
        }
        assert {"matters", "matter_items", "answers", "drafts", "settings",
                "schema_migrations"} <= tables

    # Second run: nothing to do, everything recorded.
    code, out = _run(capsys, ["--dsn", dsn, "--ensure-db", "--list"])
    assert code == 0
    ensure, _listing = _split_two_json_documents(out)
    ensure = ensure["ensureDb"]
    assert ensure["migrationsApplied"] == []
    assert ensure["migrationsBootstrapped"] == []
    assert ensure["migrationsAlreadyApplied"] == len(runnable_migrations())
