"""Migration ledger (W12-A): apply MISSING migrations to an EXISTING database.

Real integration tests against the local scratch PostgreSQL. This module
owns exactly ONE scratch database, ``collex_persist_test`` (shared with
control-plane/tests/store/persistence.test.ts, which is never run
concurrently with pytest), creates and drops ONLY that name, and SKIPS
cleanly when the server is unreachable — the package conftest already
skips when psycopg itself is missing.

Why the test exists: ``intake.cli --ensure-db`` replayed the migrations only
on a FRESH database, so a persistent ``collex_local`` created on 27.08 could
never receive the 02.09 matters migration, and replaying non-re-entrant
migrations was not an option either.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import psycopg
import pytest

from ingestion.migrations import (
    LEDGER_BOOTSTRAP_BOUNDARY,
    LEDGER_TABLE,
    SENTINEL_KINDS,
    apply_missing_migrations,
    ledger_sentinel,
    ledger_sentinels,
    ledger_state,
    migration_files,
    migration_timestamp,
    parse_sentinel,
    runnable_migrations,
    sentinel_resolves,
)

HOST = os.environ.get("COLLEX_DB_HOST", "127.0.0.1")
PORT = int(os.environ.get("COLLEX_DB_PORT", "55432"))
USER = os.environ.get("COLLEX_DB_USER", "postgres")
DBNAME = "collex_persist_test"
DSN = f"postgres://{USER}@{HOST}:{PORT}/{DBNAME}"
ADMIN_DSN = f"postgres://{USER}@{HOST}:{PORT}/postgres"

MATTERS_MIGRATION = "20260902120000_matters_persistence.sql"
AI_AUDIT_MIGRATION = "20260903100000_ai_audit_and_scale_indexes.sql"
#: W14 L-FIX: widens matter_items.kind (hearing) + three search indexes.
HEARING_MIGRATION = "20260904090000_hearing_kind_and_search_indexes.sql"
#: W19 phase A: source locators (canonical range -> PDF page /
#: DOCX paragraph) + its RLS policy.
LOCATORS_MIGRATION = "20260911100000_source_locators.sql"
#: W19 phases G+H: exhaustive analysis ledger + derived Matter
#: intelligence, with four RLS policies.
ANALYSIS_MIGRATION = "20260911110000_matter_analysis.sql"


def _db_unavailable() -> str | None:
    try:
        with psycopg.connect(ADMIN_DSN, connect_timeout=5):
            return None
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        return (
            f"local scratch PostgreSQL {USER}@{HOST}:{PORT} is not reachable"
            f" ({type(exc).__name__}: {exc}); the ledger tests are real"
            " integration tests and cannot run without it"
        )


@pytest.fixture()
def fresh_db() -> Iterator[str]:
    """Drop + recreate ``collex_persist_test`` (this lane's ONLY name)."""
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
    yield DSN
    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f"drop database if exists {DBNAME} with (force)")


def _tables(conn, schema: str) -> set[str]:
    return {
        r[0] for r in conn.execute(
            "select table_name from information_schema.tables"
            " where table_schema = %s",
            (schema,),
        ).fetchall()
    }


def _ledger_rows(conn) -> list[str]:
    return [
        r[0] for r in conn.execute(
            f"select filename from {LEDGER_TABLE} order by filename"
        ).fetchall()
    ]


# ---------------------------------------------------------------------------
# Pure checks (no database)
# ---------------------------------------------------------------------------

def test_migration_timestamp_parses_the_leading_stamp():
    assert migration_timestamp(Path(MATTERS_MIGRATION)) == "20260902120000"
    assert migration_timestamp("20260826010000_x.sql") == "20260826010000"
    with pytest.raises(ValueError):
        migration_timestamp("no_timestamp.sql")


def test_bootstrap_boundary_is_a_real_migration_and_newer_ones_declare_sentinels():
    """W12-FIX2 (P1-9): EVERY runnable migration must carry a
    [LEDGER SENTINEL] probe that parses — the timestamp boundary no longer
    records anything by itself. A pre-ledger database loaded through psql
    (or an old ensure-db run) is classified file by file on bootstrap; a
    file whose probe does not resolve is applied, never assumed."""
    stamps = {migration_timestamp(p) for p in migration_files()}
    assert LEDGER_BOOTSTRAP_BOUNDARY in stamps
    newer = [
        p for p in runnable_migrations()
        if migration_timestamp(p) > LEDGER_BOOTSTRAP_BOUNDARY
    ]
    # The boundary is documentation, not a rule (W12-FIX2): everything past
    # it is classified by its probes like any other file. W14 added the AI
    # audit ledger + scale indexes migration, and W14 L-FIX the hearing kind
    # + search indexes migration.
    assert [p.name for p in newer] == [
        MATTERS_MIGRATION,
        AI_AUDIT_MIGRATION,
        HEARING_MIGRATION,
        LOCATORS_MIGRATION,
        ANALYSIS_MIGRATION,
    ]
    probes: dict[str, list[tuple[str, str]]] = {}
    by_path = {p.name: p for p in runnable_migrations()}
    for path in runnable_migrations():
        declared = ledger_sentinels(path)
        assert declared, f"{path.name} declares no ledger sentinel"
        assert ledger_sentinel(path) == declared[0]
        parsed = []
        for raw in declared:
            kind, target = parse_sentinel(raw)
            assert kind in SENTINEL_KINDS
            parsed.append((kind, target))
        probes[path.name] = parsed
    # Each file proves ITSELF (never a relation an older file created), so
    # no probe is ever shared between two files.
    flat = [probe for entries in probes.values() for probe in entries]
    assert len(set(flat)) == len(flat)
    # The reviewer's example: the trigger migration is proven by its trigger,
    # the RLS file by its tenant function, the FTS lane by its column.
    assert ("trigger", "legal.document_versions.document_versions_close_previous") in (
        probes["20260826100000_version_transitions.sql"]
    )
    assert ("regprocedure", "app_private.current_tenant_id()") in (
        probes["20260826060000_rls.sql"]
    )
    assert ("column", "legal.chunks.search_tsv_tr") in probes["20260826110000_turkish_fts.sql"]
    # The original bare form stays valid and means regclass.
    assert ("regclass", "app_private.settings") in probes[MATTERS_MIGRATION]
    # W14 B-05: the two new kinds are actually used by the shipped files, so
    # the SQL CASE clauses for them are exercised by the resolve test below.
    assert ("policy", "app_private.settings.settings_tenant") in probes[MATTERS_MIGRATION]
    assert ("type", "legal.relation_kind") in (
        probes["20260826010000_extensions_and_schemas.sql"]
    )
    # W14 L-FIX: `constraint` is the kind for a migration whose primary effect
    # is an ALTER. It is declared FIRST by the hearing migration, so a
    # database carrying that file's indexes but the OLD five-value CHECK is
    # recognised as incomplete instead of reading as applied.
    assert ("constraint", "app_private.matter_items.matter_items_kind_check") in (
        probes[HEARING_MIGRATION]
    )
    assert ledger_sentinels(by_path[HEARING_MIGRATION])[0].startswith("constraint:")


def test_parse_sentinel_grammar():
    assert parse_sentinel("app_private.settings") == ("regclass", "app_private.settings")
    assert parse_sentinel(" regclass:legal.chunks ") == ("regclass", "legal.chunks")
    assert parse_sentinel("extension:btree_gist") == ("extension", "btree_gist")
    assert parse_sentinel("regprocedure:app_private.fail_job(bigint, jsonb, interval)") == (
        "regprocedure", "app_private.fail_job(bigint, jsonb, interval)",
    )
    assert parse_sentinel("column:legal.chunks.search_tsv_tr") == (
        "column", "legal.chunks.search_tsv_tr",
    )
    assert parse_sentinel("policy:app_private.settings.settings_tenant") == (
        "policy", "app_private.settings.settings_tenant",
    )
    assert parse_sentinel("type:legal.relation_kind") == ("type", "legal.relation_kind")
    for bad in (
        "view:legal.x", "regclass:", "column:chunks.col", "trigger:legal.t",
        "policy:app_private.settings",
    ):
        with pytest.raises(ValueError):
            parse_sentinel(bad)


def test_sentinel_line_must_open_the_comment(tmp_path: Path):
    prose = tmp_path / "20260101000000_prose.sql"
    prose.write_text(
        "-- this file only mentions [LEDGER SENTINEL] in prose\nselect 1;\n",
        encoding="utf-8",
    )
    assert ledger_sentinel(prose) is None
    assert ledger_sentinels(prose) == []
    real = tmp_path / "20260101000001_real.sql"
    real.write_text(
        "-- header\n  -- [LEDGER SENTINEL] app_private.settings \nselect 1;\n",
        encoding="utf-8",
    )
    assert ledger_sentinel(real) == "app_private.settings"
    assert ledger_sentinels(real) == ["app_private.settings"]
    # W14 B-05: several probes per file, in file order.
    multi = tmp_path / "20260101000002_multi.sql"
    multi.write_text(
        "-- [LEDGER SENTINEL] regclass:app_private.first\n"
        "-- prose that mentions [LEDGER SENTINEL] mid-line is ignored\n"
        "-- [LEDGER SENTINEL] policy:app_private.first.first_tenant\n"
        "select 1;\n",
        encoding="utf-8",
    )
    assert ledger_sentinels(multi) == [
        "regclass:app_private.first",
        "policy:app_private.first.first_tenant",
    ]


# ---------------------------------------------------------------------------
# Database-backed checks
# ---------------------------------------------------------------------------

def test_fresh_database_applies_everything_and_records_it(fresh_db):
    names = [p.name for p in runnable_migrations()]
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        before = ledger_state(conn)
        assert before.exists is False
        assert before.has_documents is False
        assert before.needs_bootstrap is False

        report = apply_missing_migrations(conn)
        assert report.bootstrapped == []
        assert report.applied == names
        assert report.already_applied == []
        assert _ledger_rows(conn) == sorted(names)
        assert {"documents", "chunks"} <= _tables(conn, "legal")
        assert {"matters", "matter_items", "answers", "drafts",
                "settings", "schema_migrations"} <= _tables(conn, "app_private")

        again = apply_missing_migrations(conn)
        assert again.applied == [] and again.bootstrapped == []
        assert again.already_applied == names
        assert ledger_state(conn).needs_bootstrap is False


def test_ingestion_cli_can_prepare_the_same_database_twice(fresh_db):
    from ingestion.cli import apply_migrations

    names = [p.name for p in runnable_migrations()]
    assert apply_migrations(fresh_db) == names
    assert apply_migrations(fresh_db) == []
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        assert _ledger_rows(conn) == sorted(names)


def test_pre_ledger_database_bootstraps_then_applies_the_newer_migration(fresh_db):
    """The collex_local case: schema from 27.08, no ledger, new file on disk."""
    old = [
        p for p in runnable_migrations()
        if migration_timestamp(p) <= LEDGER_BOOTSTRAP_BOUNDARY
    ]
    newer = [
        p for p in runnable_migrations()
        if migration_timestamp(p) > LEDGER_BOOTSTRAP_BOUNDARY
    ]
    assert old and newer
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        for path in old:  # the way ensure-db used to load a database
            conn.execute(path.read_text(encoding="utf-8"))
        state = ledger_state(conn)
        assert state.exists is False and state.has_documents is True
        assert state.needs_bootstrap is True
        assert "settings" not in _tables(conn, "app_private")

        report = apply_missing_migrations(conn)
        assert report.bootstrapped == [p.name for p in old]
        assert report.applied == [p.name for p in newer]
        assert report.already_applied == []
        assert "settings" in _tables(conn, "app_private")
        assert _ledger_rows(conn) == sorted(p.name for p in runnable_migrations())

        again = apply_missing_migrations(conn)
        assert again.applied == [] and again.bootstrapped == []


def test_psql_loaded_database_bootstraps_via_sentinel_without_rerunning(fresh_db):
    """scripts/db_local_check.py and the vitest harnesses load EVERY runnable
    migration without a ledger; bootstrap must recognise the newer file
    through its sentinel relation instead of re-running it."""
    names = [p.name for p in runnable_migrations()]
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        for path in runnable_migrations():
            conn.execute(path.read_text(encoding="utf-8"))
        report = apply_missing_migrations(conn)
        assert report.applied == []
        assert report.bootstrapped == names
        assert _ledger_rows(conn) == sorted(names)


def _load_all_but(conn, skipped: set[str]) -> list[str]:
    loaded = []
    for path in runnable_migrations():
        if path.name in skipped:
            continue
        conn.execute(path.read_text(encoding="utf-8"))
        loaded.append(path.name)
    return loaded


def test_psql_built_database_missing_one_pre_boundary_migration_receives_it(fresh_db):
    """P1-9 (W12-FIX2): the reviewer's case. A database built through psql
    from every runnable file EXCEPT the close-on-append trigger migration
    (timestamp <= boundary) used to be recorded as complete on bootstrap;
    it must now be recorded WITHOUT that file, which is then applied."""
    trigger = "20260826100000_version_transitions.sql"
    index = "20260827120000_relations_index.sql"
    names = [p.name for p in runnable_migrations()]
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        loaded = _load_all_but(conn, {trigger, index})
        assert ledger_state(conn).needs_bootstrap is True
        assert sentinel_resolves(conn, "regclass:legal.document_versions") is True
        assert sentinel_resolves(
            conn, "trigger:legal.document_versions.document_versions_close_previous"
        ) is False
        assert sentinel_resolves(
            conn, "regclass:legal.document_relations_source_chunk_idx"
        ) is False

        report = apply_missing_migrations(conn)
        assert report.bootstrapped == loaded
        assert report.applied == [trigger, index]
        assert report.already_applied == []
        assert _ledger_rows(conn) == sorted(names)
        trigger_rows = conn.execute(
            "select 1 from pg_trigger where tgname = 'document_versions_close_previous'"
            " and not tgisinternal"
        ).fetchall()
        assert trigger_rows, "the trigger migration was not applied"
        assert conn.execute(
            "select to_regclass('legal.document_relations_source_chunk_idx') is not null"
        ).fetchone()[0] is True

        again = apply_missing_migrations(conn)
        assert again.applied == [] and again.bootstrapped == []
        assert len(again.already_applied) == len(names)


def test_every_probe_kind_resolves_on_a_complete_database_and_nothing_bogus_does(fresh_db):
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        _load_all_but(conn, set())
        for path in runnable_migrations():
            declared = ledger_sentinels(path)
            assert declared
            for raw in declared:
                assert sentinel_resolves(conn, raw) is True, f"{path.name}: {raw}"
        for absent in (
            "regclass:legal.nope",
            "regprocedure:app_private.nope()",
            "extension:nope_ext",
            "type:legal.nope_enum",
            "column:legal.chunks.nope",
            "trigger:legal.document_versions.nope",
            "trigger:legal.nope.document_versions_close_previous",
            "policy:app_private.settings.nope",
            "policy:app_private.nope.settings_tenant",
            "constraint:app_private.matter_items.nope",
            "constraint:app_private.nope.matter_items_kind_check",
        ):
            assert sentinel_resolves(conn, absent) is False, absent


def test_bootstrap_is_one_transaction(fresh_db, monkeypatch):
    """A failure while recording the bootstrap rows must leave NO ledger
    table behind (an empty ledger would look like "nothing applied")."""
    import ingestion.migrations as mig

    calls = {"n": 0}
    original = mig._record

    def failing_record(conn, filename):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("simulated crash during bootstrap")
        original(conn, filename)

    monkeypatch.setattr(mig, "_record", failing_record)
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        _load_all_but(conn, set())
        with pytest.raises(RuntimeError):
            apply_missing_migrations(conn)
        assert ledger_state(conn).exists is False
    monkeypatch.setattr(mig, "_record", original)
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        report = apply_missing_migrations(conn)
        assert report.applied == []
        assert len(report.bootstrapped) == len(runnable_migrations())


def test_failed_migration_is_rolled_back_and_left_unrecorded(fresh_db, tmp_path):
    good = tmp_path / "20260101000000_good.sql"
    good.write_text(
        "create schema if not exists ledger_probe;\n"
        "create table ledger_probe.ok (id int);\n",
        encoding="utf-8",
    )
    broken = tmp_path / "20260101000001_broken.sql"
    broken.write_text(
        "create table ledger_probe.half (id int);\n"
        "select * from ledger_probe.does_not_exist;\n",
        encoding="utf-8",
    )
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        with pytest.raises(psycopg.Error):
            apply_missing_migrations(conn, directory=tmp_path)
        assert _ledger_rows(conn) == [good.name]
        probe_tables = _tables(conn, "ledger_probe")
        assert "ok" in probe_tables
        # The broken file's first statement was rolled back with the rest.
        assert "half" not in probe_tables

        # Fixing the file lets the ledger pick up exactly where it stopped.
        broken.write_text(
            "create table ledger_probe.half (id int);\n", encoding="utf-8"
        )
        report = apply_missing_migrations(conn, directory=tmp_path)
        assert report.applied == [broken.name]
        assert report.already_applied == [good.name]
        assert "half" in _tables(conn, "ledger_probe")


# ---------------------------------------------------------------------------
# W14 B-05 — multi-sentinel: "started" must not read as "finished"
# ---------------------------------------------------------------------------

#: Words that decorate a CREATE statement but are not the object name.
_DDL_NOISE = {
    "create", "or", "replace", "unique", "index", "table", "type", "policy",
    "trigger", "function", "schema", "extension", "view", "materialized",
    "if", "not", "exists", "concurrently", "procedure", "domain", "sequence",
}


def _last_created_name(path: Path) -> str:
    """Bare identifier created by the LAST top-level ``create`` in ``path``.

    Only column-0 statements count: a ``grant`` inside a ``do $$ … $$`` block
    is indented and is not an object this file creates on a scratch cluster
    (the Supabase roles do not exist there).
    """
    import re

    last: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line[0].isspace():
            continue
        if line.lower().startswith("create "):
            last = line
    assert last is not None, f"{path.name} has no top-level create statement"
    for token in re.split(r"[\s(]+", last):
        bare = token.strip().strip(";").strip('"')
        if not bare or bare.lower() in _DDL_NOISE:
            continue
        return bare.split(".")[-1]
    raise AssertionError(f"could not read an object name out of: {last!r}")


def _probe_name(raw: str) -> str:
    """Bare identifier a probe target names (arguments and schema stripped)."""
    _, target = parse_sentinel(raw)
    return target.split("(")[0].split(".")[-1]


def test_every_runnable_file_probes_the_object_it_creates_LAST():
    """B-05 acceptance (1).

    ENGRISK's finding: a probe naming an object created in the MIDDLE of a
    file makes a half-applied file read as complete. Applying only the first
    228 lines of the matters migration left five ``app_private`` tables
    without RLS and without policies, while the ledger said "applied" and
    ``--ensure-db`` never revisited the file.

    The rule that closes it: every runnable migration must declare a probe
    for the object created by its LAST create statement.
    """
    for path in runnable_migrations():
        declared = ledger_sentinels(path)
        assert declared, path.name
        names = {_probe_name(raw) for raw in declared}
        last = _last_created_name(path)
        assert last in names, (
            f"{path.name}: no [LEDGER SENTINEL] names {last!r}, the object its"
            f" LAST create statement builds; declared probes: {declared}"
        )


def test_multi_object_files_also_probe_their_FIRST_object():
    """The pair (first, last) is what brackets a half-applied file."""
    expected_first = {
        "20260826010000_extensions_and_schemas.sql": "btree_gist",
        "20260826020000_documents_snapshots_versions.sql": "documents",
        "20260826030000_chunks_relations.sql": "chunks",
        "20260826040000_research_state.sql": "run_status",
        "20260826050000_jobs.sql": "jobs",
        "20260826060000_rls.sql": "current_tenant_id",
        "20260826100000_version_transitions.sql": "close_previous_current_version",
        "20260826110000_turkish_fts.sql": "search_tsv_tr",
        MATTERS_MIGRATION: "matters",
    }
    by_name = {p.name: p for p in runnable_migrations()}
    for name, first in expected_first.items():
        assert _probe_name(ledger_sentinels(by_name[name])[0]) == first, name
    # Files that create exactly one object legitimately declare one probe.
    for single in (
        "20260826070000_embedding_profiles.sql",
        "20260827120000_relations_index.sql",
    ):
        assert len(ledger_sentinels(by_name[single])) == 1


def _matters_migration_split() -> tuple[str, str]:
    """(everything before the RLS block, the whole file)."""
    path = next(p for p in runnable_migrations() if p.name == MATTERS_MIGRATION)
    text = path.read_text(encoding="utf-8")
    marker = "alter table app_private.matters enable row level security"
    cut = text.index(marker)
    return text[:cut], text


def test_half_applied_matters_migration_is_NOT_bootstrapped_and_gets_applied(fresh_db):
    """B-05 acceptance (2) — the exact ENGRISK E3 scenario.

    Load every earlier migration plus the matters migration UP TO its RLS
    block. The old single probe (``app_private.settings``, created well before
    the cut) resolved, so bootstrap recorded the file as applied and the five
    tables holding the lawyer's matters, answers and drafts stayed without row
    security forever. With the last-object probe (``policy:…settings_tenant``)
    the file is recognised as incomplete and applied.
    """
    head, _full = _matters_migration_split()
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        for path in runnable_migrations():
            # The AI-audit migration indexes app_private.answers, the
            # hearing migration alters app_private.matter_items, and the
            # W19 analysis migration references app_private.matters — all of
            # which the matters migration creates, so none can be loaded
            # ahead of it.
            if path.name in (
                MATTERS_MIGRATION,
                AI_AUDIT_MIGRATION,
                HEARING_MIGRATION,
                ANALYSIS_MIGRATION,
            ):
                continue
            conn.execute(path.read_text(encoding="utf-8"))
        conn.execute(head)

        # Precondition: the schema really is in the dangerous half state.
        assert "settings" in _tables(conn, "app_private")
        assert sentinel_resolves(conn, "app_private.settings") is True
        assert sentinel_resolves(
            conn, "policy:app_private.settings.settings_tenant"
        ) is False
        policies = conn.execute(
            "select count(*) from pg_policies where schemaname = 'app_private'"
            " and tablename in ('matters', 'matter_items', 'answers', 'drafts', 'settings')"
        ).fetchone()[0]
        assert policies == 0, "fixture is wrong: the RLS block was applied"

        report = apply_missing_migrations(conn)
        assert MATTERS_MIGRATION not in report.bootstrapped, (
            "half-applied migration was recorded as already applied"
        )
        assert report.applied == [
            MATTERS_MIGRATION,
            AI_AUDIT_MIGRATION,
            HEARING_MIGRATION,
            ANALYSIS_MIGRATION,
        ]

        # And the policies the half-applied file skipped now exist.
        policies_after = conn.execute(
            "select count(*) from pg_policies where schemaname = 'app_private'"
            " and tablename in ('matters', 'matter_items', 'answers', 'drafts', 'settings')"
        ).fetchone()[0]
        assert policies_after == 5
        assert _ledger_rows(conn) == sorted(p.name for p in runnable_migrations())

        again = apply_missing_migrations(conn)
        assert again.applied == [] and again.bootstrapped == []


def test_complete_database_carries_the_expected_rls_policy_count(fresh_db):
    """B-05 (d): ``/v1/health rls.present == rls.expected`` on a full database.

    18 = 12 policies from 20260826060000_rls.sql + 5 from the matters
    migration + 1 from the W14 AI audit ledger + 1 from the W19 source
    locators migration + 4 from the W19 matter-analysis migration.
    ``control-plane/src/store/health.ts`` EXPECTED_RLS_POLICIES carries the
    same number and persistence.test.ts asserts it against a real cluster;
    this is the Python side of the same count. (ENGRISK measured 17 before
    the W14 migration existed.)
    """
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        apply_missing_migrations(conn)
        present = conn.execute(
            "select count(*) from pg_policies"
            " where schemaname in ('legal', 'app_private')"
        ).fetchone()[0]
        assert present == 23


def test_two_concurrent_apply_passes_on_an_empty_database_both_succeed(fresh_db):
    """B-05 acceptance (3) / ENGRISK E12a.

    ``create type legal.document_scope as enum (…)`` has no ``if not exists``
    form, so two ``--ensure-db`` runs racing on an empty database used to make
    the loser abort its transaction; the launcher then printed
    "Veritabani semasi hazirlanamadi" and stopped. The session-level advisory
    lock serialises the whole pass.

    Honest scope note: this drives two THREADS with two independent psycopg
    connections, not two OS processes. The lock is server-side and per
    session, so the mechanism under test is the same one two processes would
    hit; a two-process variant would only add process spawn cost.
    """
    import threading

    results: list[object] = [None, None]

    def worker(slot: int) -> None:
        try:
            with psycopg.connect(fresh_db, autocommit=True) as conn:
                results[slot] = apply_missing_migrations(conn)
        except Exception as exc:  # noqa: BLE001 - recorded, asserted below
            results[slot] = exc

    threads = [threading.Thread(target=worker, args=(i,)) for i in (0, 1)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=180)
    for slot, outcome in enumerate(results):
        assert not isinstance(outcome, Exception), f"worker {slot} failed: {outcome!r}"
        assert outcome is not None, f"worker {slot} never finished"

    names = sorted(p.name for p in runnable_migrations())
    # Exactly one worker applied each file; the other saw it already applied.
    applied = [n for r in results for n in getattr(r, "applied", [])]
    assert sorted(applied) == names
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        assert _ledger_rows(conn) == names


def test_advisory_lock_is_released_even_when_a_migration_fails(fresh_db, tmp_path):
    """A failed pass must not leave the lock held: the next run would hang."""
    broken = tmp_path / "20260101000000_broken.sql"
    broken.write_text("select * from nope.does_not_exist;\n", encoding="utf-8")
    with psycopg.connect(fresh_db, autocommit=True) as conn:
        with pytest.raises(psycopg.Error):
            apply_missing_migrations(conn, directory=tmp_path)
        held = conn.execute(
            "select count(*) from pg_locks where locktype = 'advisory'"
            " and pid = pg_backend_pid()"
        ).fetchone()[0]
        assert held == 0, "the migration advisory lock was not released"
