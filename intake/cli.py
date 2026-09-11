"""Intake CLI — what the TS /v1/files API shells to.

Usage (always through the repo venv interpreter):

    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --file <path> --json
    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --dir <folder> --json
    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --list
    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --show <fileId>
    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --reanalyze <fileId>
    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --delete <fileId>
    .venv/Scripts/python.exe -m intake.cli --dsn <dsn> --ensure-db [...]

Output contract:

* ``--file --json``  -> the IntakeResult JSON (POST /v1/files 200 body).
* ``--dir --json``   -> ``{"batch": {...}}`` (W14 B-19): one folder,
  processed FILE BY FILE through exactly the same
  ``process_file`` path — same quarantine, same magic-byte sniff, same
  caps. Per file the batch reports ``ok`` with its IntakeResult, or
  ``error`` with the file's NAME and the typed kind+message, so a folder
  where three of twenty documents are scans still ingests seventeen and
  says exactly which three failed and why. Exit code is 0 when at least
  one file succeeded, 2 when every file failed.
* ``--list``         -> ``{"files": [...]}``   (GET /v1/files body).
* ``--show``         -> the detail body        (GET /v1/files/{id}).
* ``--delete``       -> ``{"deleted": ...}``; document, versions, chunks,
  embedding-job rows, snapshots and the stored original are all removed.
* Typed failures print ``{"error": {"kind", "message"}}`` on stdout and
  exit 2 — kinds INVALID_REQUEST / UNSUPPORTED_TYPE / EXTRACTION_FAILED /
  NOT_FOUND map to HTTP 400 / 415 / 422 / 404.
* ``STORE_UNAVAILABLE`` (W12-A, contract [X]): when PostgreSQL cannot be
  reached (``psycopg.OperationalError`` — refused, unreachable, or the
  connect timeout below expiring) the CLI prints
  ``{"error": {"kind": "STORE_UNAVAILABLE", "message": "Yerel
  veritabanına ulaşılamadı."}}`` and exits 2 within ~6 s. Every psycopg
  connect made through this CLI carries ``connect_timeout=5`` (added to the
  DSN unless the caller already set one), including the connections opened
  inside ``intake.ingest`` and ``ingestion.pipeline`` — they all receive the
  timeout-carrying DSN. The API maps this kind to HTTP 503. Before this the
  process hung for the OS-level TCP timeout (~3 min measured) and the API
  answered a generic 500.

Safety rails (scratch-database discipline, CLAUDE.md):

* ``--ensure-db`` CREATEs the DSN's database if absent and brings it up to
  date with every non-pgvector migration through the migration ledger
  (``ingestion.migrations.apply_missing_migrations``): a fresh database
  receives the whole runnable chain, an EXISTING database receives only the
  migrations its ledger lacks (pre-ledger databases are bootstrapped first —
  see ingestion/migrations.py). The two pgvector migrations are never
  touched. It is HARD-LIMITED to the names ``collex_local`` (the persistent
  local product store) and ``collex_intake_test`` (this lane's scratch DB)
  and refuses everything else. Nothing in this CLI can DROP a database.
* No remote/Supabase connection is ever made; the DSN is expected to be
  127.0.0.1.
"""

from __future__ import annotations

import argparse
import json
import sys

import psycopg

from pathlib import Path

from ingestion.migrations import apply_missing_migrations
from intake.errors import IntakeError, InvalidRequestError, NotFoundError
from intake.ingest import (
    LOCAL_TENANT_ID,
    delete_file,
    list_files,
    process_file,
    reanalyze_file,
    show_file,
)

#: --ensure-db will create (never drop) ONLY these database names.
ENSURABLE_DBS = ("collex_local", "collex_intake_test")

#: Seconds every connection attempt made through this CLI waits at most.
CONNECT_TIMEOUT_S = 5

#: Machine code + user-facing message printed when PostgreSQL is unreachable.
STORE_UNAVAILABLE_KIND = "STORE_UNAVAILABLE"
STORE_UNAVAILABLE_MESSAGE = "Yerel veritabanına ulaşılamadı."

#: Most files one ``--dir`` run will take (W14 B-19). A UYAP case-file
#: download is tens of documents, not thousands; a cap keeps one accidental
#: "C:\\" drop from becoming an hours-long process with no way to stop it.
#: Over the cap the CLI refuses UP FRONT and names the count, instead of
#: starting work it cannot finish.
BATCH_MAX_FILES = 200

#: Extensions ``--dir`` will attempt. Everything else in the folder is
#: reported as `skipped`, never as a failure: a UYAP download folder is full
#: of .html indexes and .xml side-cars, and calling those "errors" would bury
#: the three real problems the lawyer needs to see.
BATCH_EXTENSIONS = (".pdf", ".docx", ".txt", ".udf")


def _dbname_from_dsn(dsn: str) -> str:
    return psycopg.conninfo.conninfo_to_dict(dsn).get("dbname") or ""


def _admin_dsn(dsn: str) -> str:
    params = psycopg.conninfo.conninfo_to_dict(dsn)
    params["dbname"] = "postgres"
    return psycopg.conninfo.make_conninfo(**params)


def with_connect_timeout(dsn: str, seconds: int = CONNECT_TIMEOUT_S) -> str:
    """Return ``dsn`` carrying ``connect_timeout`` (kept if already set).

    The timeout travels INSIDE the DSN so that every ``psycopg.connect`` the
    intake and ingestion modules perform with it — not only the ones in this
    file — is bounded, without changing their signatures.
    """
    params = psycopg.conninfo.conninfo_to_dict(dsn)
    if not params.get("connect_timeout"):
        params["connect_timeout"] = str(seconds)
    return psycopg.conninfo.make_conninfo(**params)


def ensure_database(dsn: str) -> dict:
    """Create the DSN's database if absent + apply MISSING migrations.

    Idempotent through the migration ledger: a second call on the same
    database applies nothing and reports ``migrationsApplied: []``. Raises
    ``psycopg.OperationalError`` when the server cannot be reached (mapped
    to STORE_UNAVAILABLE by ``main``).
    """
    dbname = _dbname_from_dsn(dsn)
    if dbname not in ENSURABLE_DBS:
        raise SystemExit(
            f"--ensure-db refuses database {dbname!r}; allowed names:"
            f" {', '.join(ENSURABLE_DBS)}"
        )
    dsn = with_connect_timeout(dsn)
    created = False
    with psycopg.connect(_admin_dsn(dsn), autocommit=True) as admin:
        exists = admin.execute(
            "select 1 from pg_database where datname = %s", (dbname,)
        ).fetchone()
        if not exists:
            # Same locale posture as the other scratch lanes: deterministic
            # character semantics for code-point offset math.
            admin.execute(
                f'create database "{dbname}" template template0'
                " encoding 'UTF8' locale 'C'"
            )
            created = True

    with psycopg.connect(dsn, autocommit=True) as conn:
        report = apply_missing_migrations(conn)
    return {
        "database": dbname,
        "created": created,
        "migrationsApplied": list(report.applied),
        # Additive (W12-A): ledger bookkeeping, for operators and tests.
        "migrationsBootstrapped": list(report.bootstrapped),
        "migrationsAlreadyApplied": len(report.already_applied),
    }


def collect_batch_files(directory: Path) -> list[Path]:
    """Intake-eligible files under ``directory``, recursively, sorted.

    Sorted so a re-run processes the same folder in the same order, which
    makes a partially-completed batch resumable by simply running it again
    (an already-ingested document answers `unchanged`).
    """
    if not directory.is_dir():
        raise NotFoundError(f"klasör bulunamadı: {directory}")
    found = [
        path
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.suffix.lower() in BATCH_EXTENSIONS
    ]
    if len(found) > BATCH_MAX_FILES:
        raise InvalidRequestError(
            f"Klasörde {len(found)} belge var; tek seferde en fazla"
            f" {BATCH_MAX_FILES} belge işlenebilir — klasörü bölün."
        )
    return found


def process_directory(
    directory: str | Path,
    dsn: str,
    tenant_id: str = LOCAL_TENANT_ID,
    *,
    store_dir: str | Path | None = None,
    on_progress=None,
) -> dict:
    """Process every eligible file in ``directory``, one at a time.

    W14 B-19 ("drop the folder you downloaded from UYAP"). We deliberately
    do NOT build a browser extension or bind to the lawyer's UYAP identity
    (backlog §C.3 — that is the one thing that would destroy our position),
    but most of the pain disappears without one: the lawyer drops the folder
    and intake walks it.

    Two properties matter more than speed:

    * **No new intake path.** Every file goes through the same
      ``process_file`` as a single upload, so quarantine, the magic-byte
      sniff, the ZIP-bomb gates and the page cap all apply unchanged. A bulk
      mode with its own looser path would be a hole in every one of them.
    * **One failure does not lose the batch.** A scanned PDF (OCR is
      fail-closed) or a corrupt file is recorded by NAME with its typed kind
      and Turkish message, and the walk continues. The console renders that
      list; B-10 requires a failed file to be named with its reason, and a
      folder is where that matters most.

    ``on_progress`` is called with (index, total, path) before each file so
    a caller can emit a progress channel; it is never used for control flow.
    """
    directory = Path(directory)
    files = collect_batch_files(directory)
    results: list[dict] = []
    ok_count = 0
    for index, path in enumerate(files, start=1):
        if on_progress is not None:
            on_progress(index, len(files), path)
        rel = path.relative_to(directory).as_posix()
        try:
            outcome = process_file(path, dsn, tenant_id, store_dir=store_dir)
        except IntakeError as exc:
            body = exc.to_json_dict()["error"]
            results.append({
                "path": rel,
                "name": path.name,
                "status": "error",
                "kind": body["kind"],
                "message": body["message"],
            })
            continue
        ok_count += 1
        results.append({
            "path": rel,
            "name": path.name,
            "status": "ok",
            "result": outcome.to_json_dict(),
        })
    return {
        "directory": str(directory),
        "total": len(files),
        "ok": ok_count,
        "failed": len(files) - ok_count,
        "files": results,
    }


def _print_json(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _print_progress(index: int, total: int, path: Path) -> None:
    """Human progress line for the text mode (--json stays machine-clean)."""
    print(f"[{index}/{total}] {path.name}", flush=True)


def _store_unavailable() -> dict:
    return {
        "error": {
            "kind": STORE_UNAVAILABLE_KIND,
            "message": STORE_UNAVAILABLE_MESSAGE,
        }
    }


def main(argv: list[str] | None = None) -> int:
    # The TS API captures stdout; force UTF-8 regardless of console codepage.
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):  # pragma: no cover - exotic stdout
        pass

    parser = argparse.ArgumentParser(prog="python -m intake.cli")
    parser.add_argument("--dsn", required=True,
                        help="local Postgres DSN (127.0.0.1 expected)")
    parser.add_argument("--tenant", default=LOCAL_TENANT_ID,
                        help="tenant UUID (defaults to the local tenant)")
    parser.add_argument("--store-dir", default=None,
                        help="override var/uploads for stored originals")
    parser.add_argument("--json", action="store_true",
                        help="print the IntakeResult JSON for --file")
    parser.add_argument("--ensure-db", action="store_true",
                        help="create the DSN database if absent and apply"
                             " the non-pgvector migrations it lacks"
                             " (collex_local / collex_intake_test only;"
                             " never drops)")

    action = parser.add_mutually_exclusive_group()
    action.add_argument("--file", metavar="PATH",
                        help="process one upload end-to-end")
    action.add_argument("--dir", metavar="PATH", dest="directory",
                        help="process every pdf/docx/txt/udf under a folder,"
                             " one at a time, through the SAME path as"
                             " --file; per-file failures are reported by"
                             " name and never abort the batch")
    action.add_argument("--list", action="store_true",
                        help="list tenant upload documents")
    action.add_argument("--show", metavar="FILEID",
                        help="detail for one fileId (analysis + chunks)")
    action.add_argument("--reanalyze", metavar="FILEID",
                        help="refresh analysis from the verified stored original")
    action.add_argument("--delete", metavar="FILEID",
                        help="delete one fileId (doc, versions, chunks,"
                             " jobs, snapshots, stored original)")
    args = parser.parse_args(argv)

    # Every connection opened from here on is bounded (contract [X]).
    dsn = with_connect_timeout(args.dsn)

    try:
        if args.ensure_db:
            _print_json({"ensureDb": ensure_database(args.dsn)})

        if args.file:
            result = process_file(
                args.file, dsn, args.tenant, store_dir=args.store_dir
            )
            if args.json:
                _print_json(result.to_json_dict())
            else:
                print(
                    f"{result.action:>10}  {result.file_id}  {result.name}"
                    f"  kind={result.kind} chars={result.chars}"
                    f" chunks={result.chunk_count}"
                    f" warnings={len(result.warnings)}"
                )
                for warning in result.warnings:
                    print(f"   uyarı: {warning}")
        elif args.directory:
            batch = process_directory(
                args.directory, dsn, args.tenant, store_dir=args.store_dir,
                on_progress=None if args.json else _print_progress,
            )
            if args.json:
                _print_json({"batch": batch})
            else:
                for entry in batch["files"]:
                    if entry["status"] == "ok":
                        r = entry["result"]
                        print(f"  {r['action']:>10}  {entry['path']}")
                    else:
                        print(f"  {'HATA':>10}  {entry['path']}"
                              f"  [{entry['kind']}] {entry['message']}")
                print(
                    f"toplam={batch['total']} başarılı={batch['ok']}"
                    f" başarısız={batch['failed']}"
                )
            # Every file failed: the batch itself failed.
            if batch["total"] > 0 and batch["ok"] == 0:
                return 2
        elif args.list:
            _print_json({"files": list_files(dsn, args.tenant)})
        elif args.show:
            _print_json(show_file(dsn, args.show, args.tenant))
        elif args.reanalyze:
            _print_json(reanalyze_file(
                dsn, args.reanalyze, args.tenant, store_dir=args.store_dir,
            ))
        elif args.delete:
            _print_json(delete_file(
                dsn, args.delete, args.tenant,
                store_dir=args.store_dir,
            ))
        elif not args.ensure_db:
            parser.error(
                "one of --file/--dir/--list/--show/--reanalyze/--delete (or --ensure-db)"
                " is required"
            )
    except IntakeError as exc:
        _print_json(exc.to_json_dict())
        return 2
    except psycopg.OperationalError:
        # Connection refused / host unreachable / connect_timeout expired.
        # Typed, driver text never echoed (it can carry the DSN).
        _print_json(_store_unavailable())
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
