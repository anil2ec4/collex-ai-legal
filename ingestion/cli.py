"""Ingestion CLI (local scratch Postgres only).

Usage (always through the repo venv interpreter):

    .venv/Scripts/python.exe -m ingestion.cli \
        --dsn postgres://postgres@127.0.0.1:55432/collex_ingest_test \
        --corpus evals/fixtures/corpus \
        [--include kanun_5237_v2.json ...] \
        [--profiles bge-m3-1024-v1,voyage-4-1024-v1] \
        [--recreate-db] [--apply-migrations]

    .venv/Scripts/python.exe -m ingestion.cli \
        --publish-library var/library \
        --dsn postgres://postgres@127.0.0.1:55432/collex_local \
        [--dry-run] [--json]

Safety rails:

* ``--recreate-db`` (drop + create) is HARD-LIMITED to the database name
  ``collex_ingest_test`` — the CLI refuses to drop anything else.
* ``--publish-library`` (W16 / B-20 second half) writes ONLY to
  ``collex_local`` or ``collex_ingest_test`` — the same posture as
  ``intake.cli --ensure-db`` — and refuses every other name before it opens
  a connection. It never drops or creates a database. ``--dry-run`` is
  strictly read-only: it says which envelopes WOULD be published and writes,
  moves and creates nothing.
* ``--apply-migrations`` applies missing supabase/migrations that do not
  require pgvector (``ingestion.migrations.runnable_migrations`` — the same
  classifier scripts/db_local_check.py and tests/ingestion use), using the
  shared ledger, sentinel bootstrap and advisory lock. It reads
  each file in Python and executing it over the wire (the repo path
  contains non-ASCII characters, so file contents are never handed to psql
  as a path).
* No remote/Supabase connection is ever made; the DSN is whatever the
  caller passes, expected to be 127.0.0.1.

Exit codes: 0 when nothing failed, 2 when at least one document (or one
spool envelope) did not land. A partially successful library run reports
its counts and still exits 2 — the operator is told, not reassured.
``STORE_UNAVAILABLE`` (a dead/unreachable PostgreSQL) is typed on the
library path exactly as ``intake.cli`` types it, so the driver text — which
can carry the DSN — never reaches the caller.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg

from ingestion.library import (
    DatabaseNameRefused,
    LibraryPublishReport,
    publish_library,
)
from ingestion.migrations import REPO_ROOT, apply_missing_migrations
from ingestion.pipeline import DEFAULT_EMBEDDING_PROFILES, Pipeline
from ingestion.ports import FixtureSource

SCRATCH_DB = "collex_ingest_test"
DEFAULT_CORPUS = REPO_ROOT / "evals" / "fixtures" / "corpus"

#: Machine code + user-facing message printed when PostgreSQL is unreachable
#: (mirrors intake.cli's contract [X] wording exactly).
STORE_UNAVAILABLE_KIND = "STORE_UNAVAILABLE"
STORE_UNAVAILABLE_MESSAGE = "Yerel veritabanına ulaşılamadı."


def _dbname_from_dsn(dsn: str) -> str:
    return psycopg.conninfo.conninfo_to_dict(dsn).get("dbname") or ""


def _admin_dsn(dsn: str) -> str:
    params = psycopg.conninfo.conninfo_to_dict(dsn)
    params["dbname"] = "postgres"
    return psycopg.conninfo.make_conninfo(**params)


def recreate_database(dsn: str) -> None:
    dbname = _dbname_from_dsn(dsn)
    if dbname != SCRATCH_DB:
        raise SystemExit(
            f"--recreate-db refuses to drop {dbname!r}; only {SCRATCH_DB!r}"
            " may be recreated by this CLI"
        )
    with psycopg.connect(_admin_dsn(dsn), autocommit=True) as admin:
        admin.execute(f"drop database if exists {SCRATCH_DB} with (force)")
        admin.execute(
            f"create database {SCRATCH_DB} template template0"
            " encoding 'UTF8' locale 'C'"
        )


def apply_migrations(dsn: str) -> list[str]:
    """Prepare fresh or existing stores using the shared migration ledger."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        return apply_missing_migrations(conn).applied


def _print_library_report(report: LibraryPublishReport) -> None:
    """Human rendering. Every envelope that did not land is NAMED."""
    verb = "yayımlanacak" if report.dry_run else "yayımlandı"
    for entry in report.accepted:
        if entry.action == "published":
            line = f"{verb:>14}  {entry.source} {entry.external_id}"
            if not report.dry_run:
                line += f"  parça={entry.chunks}"
                if entry.relations:
                    line += f" atıf={entry.relations}"
        else:
            line = (
                f"{'zaten var':>14}  {entry.source} {entry.external_id}"
                f"  ({entry.action})"
            )
        print(line)
    for bad in report.rejected:
        print(f"{'REDDEDİLDİ':>14}  {Path(bad.path).name}"
              f"  [{bad.code}] {bad.message}")
    for failure in report.failures:
        print(f"{'HATA':>14}  {Path(failure.path).name}"
              f"  {failure.error}  (dosya silinmedi)")
    print(
        "özet:"
        f" zarf={report.scanned}"
        f" yayımlanan={report.published}"
        f" atlanan={report.skipped}"
        f" hatalı={report.failed}"
        f" (reddedilen={len(report.rejected)}"
        f" boru-hattı-hatası={len(report.failures)})"
        f" parça={report.chunks}"
        f" atıf={report.relations}"
        f" taşınan={report.moved}"
    )


def _run_publish_library(args) -> int:
    try:
        report = publish_library(
            args.publish_library,
            args.dsn,
            dry_run=args.dry_run,
            embedding_profiles=tuple(
                p.strip() for p in args.profiles.split(",") if p.strip()
            ),
        )
    except DatabaseNameRefused as exc:
        if args.json:
            print(json.dumps(
                {"error": {"kind": "INVALID_REQUEST", "message": str(exc)}},
                ensure_ascii=False, indent=2,
            ))
        else:
            print(str(exc), file=sys.stderr)
        return 2
    except psycopg.OperationalError:
        # Typed; the driver text (which can carry the DSN) is never echoed.
        print(json.dumps(
            {"error": {"kind": STORE_UNAVAILABLE_KIND,
                       "message": STORE_UNAVAILABLE_MESSAGE}},
            ensure_ascii=False, indent=2,
        ))
        return 2

    if args.json:
        print(json.dumps({"library": report.to_json_dict()},
                         ensure_ascii=False, indent=2))
    else:
        _print_library_report(report)
    return 0 if report.failed == 0 else 2


def main(argv: list[str] | None = None) -> int:
    # The report carries Turkish text; force UTF-8 regardless of codepage.
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):  # pragma: no cover - exotic stdout
        pass

    parser = argparse.ArgumentParser(prog="python -m ingestion.cli")
    parser.add_argument("--dsn", required=True,
                        help="local Postgres DSN (no password expected)")
    parser.add_argument("--corpus", default=str(DEFAULT_CORPUS),
                        help="fixture corpus directory (JSON files); "
                             "defaults to evals/fixtures/corpus")
    parser.add_argument("--include", action="append", default=None,
                        help="filename glob(s) restricting discovery")
    parser.add_argument("--profiles",
                        default=",".join(DEFAULT_EMBEDDING_PROFILES),
                        help="comma-separated embedding profile keys")
    parser.add_argument("--recreate-db", action="store_true",
                        help=f"drop+create {SCRATCH_DB} (that name only)")
    parser.add_argument("--apply-migrations", action="store_true",
                        help="apply non-pgvector migrations + "
                             "version_transitions before ingesting")
    parser.add_argument("--publish-library", metavar="SPOOL", default=None,
                        help="publish the collex.library.document/v1 "
                             "envelopes in SPOOL through this pipeline "
                             "(collex_local / collex_ingest_test only); "
                             "landed envelopes move to SPOOL/yayimlandi, "
                             "failed ones are never deleted")
    parser.add_argument("--dry-run", action="store_true",
                        help="with --publish-library: read-only. Print what "
                             "would be published and write nothing")
    parser.add_argument("--json", action="store_true",
                        help="with --publish-library: machine-readable report")
    args = parser.parse_args(argv)

    # The library lane is its own subcommand: it never touches the fixture
    # corpus, and the fixture corpus never touches the library.
    if args.publish_library is not None:
        if args.recreate_db:
            parser.error("--publish-library refuses --recreate-db")
        if args.apply_migrations:
            parser.error(
                "--publish-library refuses --apply-migrations; bring the"
                " database up to date with"
                " `python -m intake.cli --dsn <dsn> --ensure-db` first"
            )
        return _run_publish_library(args)

    if args.dry_run:
        parser.error("--dry-run is only meaningful with --publish-library")

    if args.recreate_db:
        recreate_database(args.dsn)
        print(f"recreated database {SCRATCH_DB}")
    if args.apply_migrations:
        applied = apply_migrations(args.dsn)
        print(f"applied {len(applied)} migrations: {', '.join(applied)}")

    source = FixtureSource(Path(args.corpus), include=args.include)
    profiles = tuple(p.strip() for p in args.profiles.split(",") if p.strip())
    pipeline = Pipeline(args.dsn, source, embedding_profiles=profiles)
    result = pipeline.run()

    for outcome in result.outcomes:
        line = f"{outcome.action:>10}  {outcome.external_id}"
        if outcome.action == "published":
            line += (f"  chunks={outcome.chunks_inserted}"
                     f" jobs={outcome.jobs_enqueued}")
            if outcome.relations_written:
                line += (f" relations={outcome.relations_written}"
                         f"({outcome.relations_resolved} resolved)")
        if outcome.error:
            line += f"  error={outcome.error}"
        print(line)

    # Loud, never silent: an amendment edge the source claimed but that could
    # not be stored means the citator will answer "nothing amends this".
    for external_id, edge in result.unresolved_relations:
        print(
            f"  UNRESOLVED RELATION  {external_id}: {edge.action} ->"
            f" {edge.target_legislation_no or '(no target no.)'}"
            f"  reason={edge.reason}"
        )

    print(
        "summary:"
        f" documents={len(result.outcomes)}"
        f" published={result.published}"
        f" unchanged={result.unchanged}"
        f" reverted={result.reverted}"
        f" failed={result.failed}"
        f" snapshots_created={result.snapshots_created}"
        f" chunks={result.total_chunks}"
        f" jobs={result.total_jobs}"
        f" relations={result.total_relations}"
        f" relations_unresolved={len(result.unresolved_relations)}"
    )
    return 0 if result.failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
