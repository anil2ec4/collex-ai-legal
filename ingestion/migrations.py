"""Which supabase/ migrations can run on a pgvector-less PostgreSQL, and the
migration ledger that lets an EXISTING database receive the ones it lacks.

Single source of truth, shared by ``ingestion.cli --apply-migrations``,
``intake.cli --ensure-db``, ``tests/ingestion`` and
``scripts/db_local_check.py``. Keeping the rule in one place matters: the
previous rule was a filename-timestamp boundary duplicated in two files, and
it silently demoted ``20260826100000_version_transitions.sql`` — which needs
no pgvector at all — to "not runnable locally", so the close-on-append
trigger it defines was never executed by any local check.

The rule is the marker each pgvector-dependent migration OPENS its header
comment with. It must start the comment line, so a file that merely mentions
the marker in prose (as 20260826100000 does, explaining why it is not one of
them) is not misclassified.

Migration ledger (W12-A, 02.09.2026)
------------------------------------
``intake.cli --ensure-db`` used to replay the runnable migrations ONLY on a
fresh database ("legal schema absent"); an existing ``collex_local`` could
never receive a migration added later, and the migrations are not
re-entrant, so replaying them was not an option either. The ledger fixes
that:

* ``app_private.schema_migrations(filename text primary key, applied_at)``
  records every runnable migration that has been applied. The LEDGER CODE
  creates the table when it is absent — never a migration file (an empty
  ledger created by a migration would make every pre-ledger database look
  like "nothing applied").
* BOOTSTRAP: when the ledger is absent or empty but ``legal.documents``
  exists, the database predates the ledger. A runnable migration is recorded
  as applied WITHOUT being run ONLY when its ``[LEDGER SENTINEL]`` probe
  resolves against the database — i.e. when the schema really reflects it.
  Otherwise it is applied. The whole bootstrap (ledger table + rows) is one
  transaction.

  W12-FIX2 (02.09.2026, review P1-9/P2-12): the first ledger recorded every
  migration whose timestamp was <= ``LEDGER_BOOTSTRAP_BOUNDARY`` by
  TIMESTAMP ALONE, so a psql-built or old-ensure-db database that lacked one
  pre-boundary migration (say the close-on-append trigger of
  20260826100000) was recorded as complete and never received it. Every
  runnable migration now carries a probe that proves it, in the grammar
  below; the boundary constant is kept as documentation of where the ledger
  started and is no longer a rule.

Probe grammar (one or MORE header lines per runnable migration)::

    -- [LEDGER SENTINEL] <kind>:<name>

  kind ∈ ``regclass`` (a table/index/view: ``to_regclass``),
  ``regprocedure`` (a function with its argument list:
  ``to_regprocedure('app_private.current_tenant_id()')``),
  ``extension`` (``pg_extension.extname``),
  ``type:<schema.name>`` (``to_regtype``; W14),
  ``column:<schema.table>.<column>`` (``pg_attribute``),
  ``trigger:<schema.table>.<trigger>`` (``pg_trigger``, non-internal),
  ``policy:<schema.table>.<policy>`` (``pg_policies``; W14),
  ``constraint:<schema.table>.<constraint>`` (``pg_constraint``; W14 L-FIX).
  ``constraint`` exists because a migration whose PRIMARY effect is an
  ``alter table ... add constraint`` creates no relation to probe. The
  hearing migration (20260904090000) is the first: without this kind its
  only honest probes would have been the indexes it also creates, and a
  database that had the indexes but the OLD kind CHECK would have read as
  applied — the exact half-applied blindness B-05 closed.
  The original bare form (``-- [LEDGER SENTINEL] app_private.settings``)
  stays valid and means ``regclass``. ``control-plane/src/store/health.ts``
  evaluates the SAME grammar so ``/v1/health`` ``migrations.missing`` agrees
  with this module (tests/ingestion/test_migrations_ledger.py and
  control-plane/tests/store/persistence.test.ts pin both sides).

* After bootstrap, every runnable migration missing from the ledger is
  applied in filename order, each one inside a transaction together with its
  ledger row, so a migration is never applied-but-unrecorded.

W14 (B-05) — MULTI-SENTINEL: "started" is not "finished"
--------------------------------------------------------
ENGRISK proved the hole on a scratch database: a probe naming an object
created in the MIDDLE of a file makes a HALF-APPLIED file look complete.
Concretely — apply the first 228 lines of ``20260902120000_matters_persistence``
and stop before the RLS block (lines 229-283) and the old single probe
(``app_private.settings``, created at line ~180) still resolves. Bootstrap
records the file as applied, ``--ensure-db`` never runs it again, and the
five ``app_private`` tables that hold the lawyer's matters, answers and
drafts stay WITHOUT row-level security and WITHOUT policies — the exact
class ADR-011 exists to prevent. ``/v1/health`` says ``11/11``.

The fix has three parts:

1. ``ledger_sentinels(path) -> list[str]`` — a file may declare SEVERAL
   probes and bootstrap records it only when **every** probe resolves.
2. Each runnable migration declares a probe for the object created by its
   FIRST creating statement and one for the object created by its LAST
   creating statement, so "half applied" can never resolve as complete.
   ``tests/ingestion/test_migrations_ledger.py`` enforces the last-object
   rule by parsing each file.
3. New kinds ``policy:`` and ``type:`` so the last object of the two RLS
   files and of ``20260826010000`` can actually be named.

``apply_missing_migrations`` additionally takes a session-level advisory
lock (``MIGRATION_LOCK_KEY``) so two concurrent ``--ensure-db`` runs cannot
both try to create the same enum type (E12a: ``create type`` has no
``if not exists``, so the loser aborted its transaction and the launcher
stopped with "Veritabani semasi hazirlanamadi").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
SEED_FILE = REPO_ROOT / "supabase" / "seed.sql"

PGVECTOR_MARKER = "[REQUIRES PGVECTOR]"
_MARKER_LINE_PREFIX = f"-- {PGVECTOR_MARKER}"

#: Header marker naming a relation whose existence proves the migration is
#: already reflected in the schema (used ONLY during ledger bootstrap).
LEDGER_SENTINEL_MARKER = "[LEDGER SENTINEL]"
_SENTINEL_LINE_PREFIX = f"-- {LEDGER_SENTINEL_MARKER}"

#: Fully qualified ledger table (schema created by the ledger code itself).
LEDGER_TABLE = "app_private.schema_migrations"

#: Timestamp of the newest migration that predates the ledger. Documentation
#: only since W12-FIX2: bootstrap records a migration on the strength of its
#: sentinel probe, never on its timestamp.
LEDGER_BOOTSTRAP_BOUNDARY = "20260827120000"

#: Sentinel probe kinds (see the module docstring). A bare name is regclass.
SENTINEL_KINDS = (
    "regclass",
    "regprocedure",
    "extension",
    "type",
    "column",
    "trigger",
    "policy",
    "constraint",
)

#: Kinds whose target must be ``<schema>.<table>.<name>`` (three segments).
SENTINEL_THREE_PART_KINDS = ("column", "trigger", "policy", "constraint")

#: ONE SQL expression evaluates every probe kind; the TS mirror
#: (control-plane/src/store/health.ts) carries the same CASE, verbatim.
SENTINEL_PROBE_SQL = """
select case %(kind)s
  when 'regclass' then to_regclass(%(target)s) is not null
  when 'regprocedure' then to_regprocedure(%(target)s) is not null
  when 'type' then to_regtype(%(target)s) is not null
  when 'extension' then exists (
    select 1 from pg_extension where extname = %(target)s)
  when 'column' then exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass(regexp_replace(%(target)s, '\\.[^.]+$', ''))
      and a.attname = substring(%(target)s from '[^.]+$')
      and a.attnum > 0 and not a.attisdropped)
  when 'trigger' then exists (
    select 1 from pg_trigger t
    where t.tgrelid = to_regclass(regexp_replace(%(target)s, '\\.[^.]+$', ''))
      and t.tgname = substring(%(target)s from '[^.]+$')
      and not t.tgisinternal)
  when 'policy' then exists (
    select 1 from pg_policy p
    where p.polrelid = to_regclass(regexp_replace(%(target)s, '\\.[^.]+$', ''))
      and p.polname = substring(%(target)s from '[^.]+$'))
  when 'constraint' then exists (
    select 1 from pg_constraint k
    where k.conrelid = to_regclass(regexp_replace(%(target)s, '\\.[^.]+$', ''))
      and k.conname = substring(%(target)s from '[^.]+$'))
  else false
end
"""

#: Session-level advisory lock key guarding the whole apply pass (E12a).
#: ``hashtext`` is stable within a PostgreSQL major version and the value is
#: only ever compared against itself, so the exact number does not matter.
MIGRATION_LOCK_SQL = "select pg_advisory_lock(hashtext('collex.migrations'))"
MIGRATION_UNLOCK_SQL = "select pg_advisory_unlock(hashtext('collex.migrations'))"

__all__ = [
    "LEDGER_BOOTSTRAP_BOUNDARY",
    "LEDGER_SENTINEL_MARKER",
    "LEDGER_TABLE",
    "LedgerState",
    "MIGRATIONS_DIR",
    "MIGRATION_LOCK_SQL",
    "MIGRATION_UNLOCK_SQL",
    "MigrationReport",
    "PGVECTOR_MARKER",
    "REPO_ROOT",
    "SEED_FILE",
    "SENTINEL_KINDS",
    "SENTINEL_PROBE_SQL",
    "SENTINEL_THREE_PART_KINDS",
    "apply_missing_migrations",
    "ensure_ledger",
    "ledger_sentinel",
    "ledger_sentinels",
    "ledger_state",
    "migration_files",
    "migration_timestamp",
    "needs_pgvector",
    "parse_sentinel",
    "pgvector_migrations",
    "runnable_migrations",
    "sentinel_resolves",
]


def needs_pgvector(path: Path) -> bool:
    """True when ``path`` declares the pgvector marker as its opening tag."""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(_MARKER_LINE_PREFIX):
            return True
    return False


def migration_files(directory: Path | None = None) -> list[Path]:
    """All migrations in filename (== timestamp) order."""
    directory = directory or MIGRATIONS_DIR
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no migrations found in {directory}")
    return files


def runnable_migrations(directory: Path | None = None) -> list[Path]:
    """Migrations executable against a PostgreSQL WITHOUT pgvector."""
    return [f for f in migration_files(directory) if not needs_pgvector(f)]


def pgvector_migrations(directory: Path | None = None) -> list[Path]:
    """Migrations that require pgvector (syntax-validated offline only)."""
    return [f for f in migration_files(directory) if needs_pgvector(f)]


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------

def migration_timestamp(path: Path | str) -> str:
    """The leading ``YYYYMMDDHHMMSS`` of a migration filename."""
    name = path.name if isinstance(path, Path) else path
    stamp = name.split("_", 1)[0]
    if len(stamp) != 14 or not stamp.isdigit():
        raise ValueError(f"migration name has no 14-digit timestamp: {name}")
    return stamp


def ledger_sentinels(path: Path) -> list[str]:
    """Every ``[LEDGER SENTINEL]`` probe declared by ``path``, in file order.

    W14 (B-05): a migration declares one probe for the object created by its
    FIRST creating statement and one for the object created by its LAST, and
    bootstrap records the file only when they ALL resolve. With a single
    mid-file probe a half-applied migration reads as complete — see the
    module docstring for the measured case.
    """
    out: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(_SENTINEL_LINE_PREFIX):
            value = stripped[len(_SENTINEL_LINE_PREFIX):].strip()
            if value:
                out.append(value)
    return out


def ledger_sentinel(path: Path) -> str | None:
    """The FIRST probe declared by ``path`` (compatibility shim).

    Kept because ``scripts/db_local_check.py`` and older callers read one
    probe per file; the ledger itself uses :func:`ledger_sentinels`.
    """
    probes = ledger_sentinels(path)
    return probes[0] if probes else None


def parse_sentinel(value: str) -> tuple[str, str]:
    """``<kind>:<name>`` -> (kind, name); a bare name is ``regclass``.

    Raises ``ValueError`` for an unknown kind or an empty name, so a typo in
    a migration header fails the pure test instead of silently never
    resolving (which would make bootstrap re-apply the file).
    """
    raw = value.strip()
    kind, sep, target = raw.partition(":")
    if not sep:
        kind, target = "regclass", raw
    kind, target = kind.strip(), target.strip()
    if kind not in SENTINEL_KINDS:
        raise ValueError(f"unknown ledger sentinel kind {kind!r} in {value!r}")
    if not target:
        raise ValueError(f"ledger sentinel without a name: {value!r}")
    if kind in SENTINEL_THREE_PART_KINDS and target.count(".") < 2:
        raise ValueError(
            f"ledger sentinel {kind} needs <schema.table>.<name>: {value!r}"
        )
    return kind, target


def sentinel_resolves(conn: Any, value: str) -> bool:
    """True when the probe named by ``value`` exists in ``conn``'s database."""
    kind, target = parse_sentinel(value)
    row = conn.execute(
        SENTINEL_PROBE_SQL, {"kind": kind, "target": target}
    ).fetchone()
    return bool(row and row[0])


@dataclass(frozen=True)
class LedgerState:
    """What the database says about migrations before anything is applied."""

    #: The ledger table exists.
    exists: bool
    #: Filenames recorded as applied (empty when the table is absent).
    applied: frozenset[str]
    #: ``legal.documents`` exists, i.e. the schema was created at some point.
    has_documents: bool

    @property
    def needs_bootstrap(self) -> bool:
        """Pre-ledger database: schema present, nothing recorded."""
        return self.has_documents and not self.applied


@dataclass
class MigrationReport:
    """Outcome of one ``apply_missing_migrations`` call."""

    #: Recorded as already applied during bootstrap (never executed here).
    bootstrapped: list[str] = field(default_factory=list)
    #: Executed and recorded in this call, in order.
    applied: list[str] = field(default_factory=list)
    #: Already in the ledger before this call.
    already_applied: list[str] = field(default_factory=list)

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "bootstrapped": list(self.bootstrapped),
            "applied": list(self.applied),
            "alreadyApplied": list(self.already_applied),
        }


def _regclass_exists(conn: Any, relation: str) -> bool:
    row = conn.execute(
        "select to_regclass(%s) is not null", (relation,)
    ).fetchone()
    return bool(row and row[0])


def ledger_state(conn: Any) -> LedgerState:
    """Read the ledger without modifying anything."""
    exists = _regclass_exists(conn, LEDGER_TABLE)
    applied: frozenset[str] = frozenset()
    if exists:
        applied = frozenset(
            r[0] for r in conn.execute(
                f"select filename from {LEDGER_TABLE}"
            ).fetchall()
        )
    return LedgerState(
        exists=exists,
        applied=applied,
        has_documents=_regclass_exists(conn, "legal.documents"),
    )


def ensure_ledger(conn: Any) -> None:
    """Create the ledger table (and its schema) when absent. Idempotent."""
    conn.execute("create schema if not exists app_private")
    conn.execute(
        f"create table if not exists {LEDGER_TABLE} ("
        " filename text primary key,"
        " applied_at timestamptz not null default now()"
        ")"
    )


def _record(conn: Any, filename: str) -> None:
    conn.execute(
        f"insert into {LEDGER_TABLE} (filename) values (%s)"
        " on conflict (filename) do nothing",
        (filename,),
    )


def apply_missing_migrations(
    conn: Any, directory: Path | None = None
) -> MigrationReport:
    """Bring ``conn``'s database up to date with the runnable migrations.

    ``conn`` must be an AUTOCOMMIT psycopg connection: the bootstrap is one
    explicit transaction, then each migration runs in its own explicit
    transaction together with its ledger row (a file cannot end up applied
    but unrecorded), and the migration files themselves carry no transaction
    control of their own (verified: the only ``begin`` lines in
    supabase/migrations are plpgsql block openers inside DO bodies).

    Safe to call repeatedly; the second call applies nothing.
    """
    # E12a: serialize the whole pass. Two concurrent --ensure-db runs on an
    # empty database both read "nothing applied" and both try
    # `create type legal.document_scope as enum (…)`, which PostgreSQL has no
    # `if not exists` form for; the loser aborted its transaction and the
    # launcher stopped with "Veritabani semasi hazirlanamadi". The lock is
    # session-level and released in the finally block below.
    conn.execute(MIGRATION_LOCK_SQL)
    try:
        return _apply_missing_migrations_locked(conn, directory)
    finally:
        try:
            conn.execute(MIGRATION_UNLOCK_SQL)
        except Exception:  # pragma: no cover - connection already gone
            pass


def _apply_missing_migrations_locked(
    conn: Any, directory: Path | None = None
) -> MigrationReport:
    state = ledger_state(conn)
    report = MigrationReport()
    runnable = runnable_migrations(directory)

    # Ledger table + bootstrap rows land together or not at all (P2-12): a
    # crash between the two used to leave an EMPTY ledger, which the next
    # call would have bootstrapped again — harmless, but not atomic.
    with conn.transaction():
        ensure_ledger(conn)
        if state.needs_bootstrap:
            for path in runnable:
                sentinels = ledger_sentinels(path)
                # Recorded ONLY when EVERY probe proves the schema reflects
                # the file (B-05). A migration without a sentinel, or with
                # one probe that does not resolve — a half-applied file — is
                # applied below (P1-9 + B-05).
                if sentinels and all(
                    sentinel_resolves(conn, s) for s in sentinels
                ):
                    _record(conn, path.name)
                    report.bootstrapped.append(path.name)

    applied_now = ledger_state(conn).applied
    for path in runnable:
        if path.name in applied_now:
            if path.name not in report.bootstrapped:
                report.already_applied.append(path.name)
            continue
        # Read in Python; psql never sees this non-ASCII repo path.
        sql = path.read_text(encoding="utf-8")
        with conn.transaction():
            conn.execute(sql)
            _record(conn, path.name)
        report.applied.append(path.name)
    return report
