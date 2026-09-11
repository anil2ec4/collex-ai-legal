/**
 * Scratch-database lifecycle for the store integration tests.
 *
 * These tests are REAL integration tests: they talk to the local scratch
 * PostgreSQL 18 at 127.0.0.1:55432 (user postgres, no password) and they do
 * NOT skip. If the server is unreachable the suite fails with an explicit
 * message, because a silently-skipped integration suite is indistinguishable
 * from a passing one and this lane exists precisely to stop that.
 *
 * Objects created/dropped, and nothing else:
 *   - database  collex_retrieval_test
 *   - role      collex_retrieval_test_probe   (nologin; the RLS probe)
 * Never touches remote Supabase.
 *
 * Every identifier interpolated into DDL below is a module-level constant
 * defined in this file; none of it comes from a request, a fixture or an
 * environment value, so the DDL strings are assembled by concatenation and
 * carry no injection surface.
 *
 * ---------------------------------------------------------------------------
 * MIGRATION SELECTION — mirrors ingestion/migrations.py, deliberately.
 *
 * The previous draft of this harness carried a hardcoded list of runnable
 * filename prefixes. That is the exact bug ingestion/migrations.py was
 * written to kill: a filename/timestamp boundary silently demoted
 * 20260826100000_version_transitions.sql (which needs no pgvector at all) to
 * "not runnable locally", so the close-on-append trigger it defines was never
 * executed by any local check. The rule is the MARKER each pgvector-dependent
 * migration opens its header comment with — it must start the comment line,
 * so a file that merely mentions the marker in prose is not misclassified.
 *
 * needsPgvector() below is a line-for-line port of
 * ingestion.migrations.needs_pgvector, and pgvectorRuleContract() re-reads
 * migrations.py so a change to the Python rule breaks this suite instead of
 * letting the two drift apart.
 * ---------------------------------------------------------------------------
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createDb, type Sql } from "../../src/store/db.js";

export const TEST_DB_NAME = "collex_retrieval_test";
export const PROBE_ROLE = "collex_retrieval_test_probe";

export const HOST_PORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
export const ADMIN_URL = "postgres://postgres@" + HOST_PORT + "/postgres";
export const TEST_DB_URL =
  "postgres://postgres@" + HOST_PORT + "/" + TEST_DB_NAME;

/**
 * Scratch-database discipline (CLAUDE.md): a lane owns ONE database name and
 * only that name.
 *
 * vitest runs test FILES in parallel, so two suites that both reset
 * `collex_retrieval_test` would drop the database out from under each other
 * — which is exactly what happened when the dense-lane suite was added. A
 * suite that needs its own corpus therefore passes its own name here; the
 * default keeps every existing caller on the historical database, unchanged.
 */
export interface ScratchDatabase {
  readonly database: string;
  readonly probeRole: string;
  readonly url: string;
}

export function scratchDatabase(name: string = TEST_DB_NAME): ScratchDatabase {
  return {
    database: name,
    probeRole: name + "_probe",
    url: "postgres://postgres@" + HOST_PORT + "/" + name,
  };
}

const DEFAULT_SCRATCH = scratchDatabase();

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const SEED_FILE = path.join(REPO_ROOT, "supabase", "seed.sql");
const PY_MIGRATIONS_MODULE = path.join(REPO_ROOT, "ingestion", "migrations.py");

/** Mirror of ingestion.migrations.PGVECTOR_MARKER. */
export const PGVECTOR_MARKER = "[REQUIRES PGVECTOR]";
const MARKER_LINE_PREFIX = "-- " + PGVECTOR_MARKER;

/**
 * Port of ingestion.migrations.needs_pgvector: true when ANY line of the file,
 * after stripping, opens with the marker comment.
 */
export function needsPgvector(sqlText: string): boolean {
  return sqlText
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(MARKER_LINE_PREFIX));
}

export interface MigrationPlan {
  /** Every *.sql in supabase/migrations, filename (== timestamp) order. */
  all: string[];
  /** Executable without pgvector — applied here, in this order. */
  runnable: string[];
  /** pgvector-only; never applied on the local scratch server. */
  pgvector: string[];
}

/** Classify every migration on disk by the shared marker rule. */
export async function planMigrations(): Promise<MigrationPlan> {
  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (entries.length === 0) {
    throw new Error("no migrations found in " + MIGRATIONS_DIR);
  }
  const runnable: string[] = [];
  const pgvector: string[] = [];
  for (const name of entries) {
    const text = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    (needsPgvector(text) ? pgvector : runnable).push(name);
  }
  return { all: entries, runnable, pgvector };
}

/**
 * The two constants the TS port above depends on, read straight out of
 * ingestion/migrations.py. Used by a test assertion so that changing the rule
 * in Python without changing it here fails loudly instead of silently
 * skipping a migration (again).
 */
export async function pgvectorRuleContract(): Promise<{
  marker: string | null;
  prefixExpression: string | null;
}> {
  const source = await readFile(PY_MIGRATIONS_MODULE, "utf8");
  const marker = /PGVECTOR_MARKER\s*=\s*"([^"]*)"/.exec(source);
  const prefix = /_MARKER_LINE_PREFIX\s*=\s*(.+)/.exec(source);
  return {
    marker: marker?.[1] ?? null,
    prefixExpression: prefix?.[1]?.trim() ?? null,
  };
}

// --------------------------------------------------------------------------
// Server lifecycle
// --------------------------------------------------------------------------

/**
 * Fail loudly (never skip) when the scratch server is not reachable. Returns
 * the server version string on success so the suite can report what it ran
 * against.
 */
export async function requireScratchPostgres(): Promise<string> {
  const admin = postgres(ADMIN_URL, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    const rows = await admin`select version() as version`;
    return String(rows[0]?.["version"] ?? "unknown");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "store integration tests require the LOCAL scratch PostgreSQL at " +
        HOST_PORT +
        " (user postgres, no password) and must not be skipped. " +
        "Connection failed: " +
        detail +
        ". Start the scratch server, or point COLLEX_TEST_DB_HOSTPORT at it.",
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/**
 * Drop + recreate the scratch database and the RLS probe role.
 *
 * template0 + UTF8 + locale 'C' mirrors scripts/db_local_check.py: it makes
 * character semantics deterministic regardless of cluster defaults, which is
 * what the Unicode code-point offset invariants depend on. (The Turkish
 * snowball text-search config is locale-independent, verified on 18.1.)
 *
 * The role is dropped AFTER the database, because its grants live inside it.
 */
export async function resetScratchDatabase(
  target: ScratchDatabase = DEFAULT_SCRATCH,
): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(
      "drop database if exists " + target.database + " with (force)",
    );
    await admin.unsafe("drop role if exists " + target.probeRole);
    await admin.unsafe("create role " + target.probeRole + " nologin");
    await admin.unsafe(
      "create database " +
        target.database +
        " template template0 encoding 'UTF8' locale 'C'",
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/**
 * Apply every non-pgvector migration in order, then supabase/seed.sql.
 *
 * Runs on its OWN max:1 client: the migration and seed files are
 * multi-statement scripts that open explicit transactions (`begin; … commit;`
 * in seed.sql), and postgres.js refuses a bare BEGIN on a pooled connection
 * ("UNSAFE_TRANSACTION") because a later statement could land on a different
 * backend. Single-connection is the supported way to replay a .sql file.
 */
export async function applyMigrationsAndSeed(
  target: ScratchDatabase = DEFAULT_SCRATCH,
): Promise<MigrationPlan> {
  const plan = await planMigrations();
  const runner = postgres(target.url, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    for (const file of plan.runnable) {
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await runner.unsafe(text);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error("migration " + file + " failed: " + detail);
      }
    }
    const seed = await readFile(SEED_FILE, "utf8");
    try {
      await runner.unsafe(seed);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error("supabase/seed.sql failed: " + detail);
    }
  } finally {
    await runner.end({ timeout: 10 });
  }
  return plan;
}

/**
 * Hand the probe role EXACTLY the grants migration 20260826060000 hands to
 * Supabase's "authenticated" role — no more (plus USAGE on "extensions", the
 * schema pg_trgm lives in, which Supabase grants cluster-wide). Anything the
 * store can still read through this connection is something a real end user
 * can read.
 */
export async function grantProbeRole(
  sql: Sql,
  target: ScratchDatabase = DEFAULT_SCRATCH,
): Promise<void> {
  const role = target.probeRole;
  const statements = [
    "grant usage on schema legal to " + role,
    "grant usage on schema app_private to " + role,
    "grant usage on schema extensions to " + role,
    "grant select on legal.documents to " + role,
    "grant select on legal.document_versions to " + role,
    "grant select on legal.chunks to " + role,
    "grant select on legal.document_relations to " + role,
    "grant execute on function app_private.current_tenant_id() to " + role,
  ];
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

/** Pooled client for the scratch test database (via the real factory). */
export function connectTestDb(target: ScratchDatabase = DEFAULT_SCRATCH): Sql {
  return createDb({
    url: target.url,
    max: 4,
    statementTimeoutMs: 30_000,
    applicationName: "collex-store-tests",
  });
}

/**
 * A SINGLE-connection client already switched to the probe role, optionally
 * with a tenant context, so RLS applies exactly as it would for a signed-in
 * end user.
 *
 * max:1 is load-bearing: `SET`/`SET ROLE` are session state, and on a pooled
 * client a later query can land on a different backend that never saw them.
 * `set app.tenant_id` runs BEFORE `set role`, matching
 * scripts/db_local_check.py.
 */
export async function connectAsTenant(tenantId: string | null): Promise<Sql> {
  const sql = createDb({
    url: TEST_DB_URL,
    max: 1,
    statementTimeoutMs: 30_000,
    applicationName: "collex-store-tests-rls",
  });
  if (tenantId !== null) {
    await sql.unsafe("set app.tenant_id = '" + assertUuid(tenantId) + "'");
  }
  await sql.unsafe("set role " + PROBE_ROLE);
  return sql;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new RangeError('tenant id must be a UUID, got "' + value + '"');
  }
  return value;
}
