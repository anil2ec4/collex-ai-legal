/**
 * Database health for /v1/health and the serve.mjs start-up diagnosis
 * (W12-A, contract [H]).
 *
 *   checkDatabase(sql) -> { db: 'ok' | 'down' | 'missing', dbName?, migrations? }
 *
 *   'ok'       reachable and legal.documents exists;
 *   'missing'  reachable but legal.documents is absent — the database was
 *              created without the schema; run
 *              `intake.cli --dsn <dsn> --ensure-db`;
 *   'down'     unreachable, or no answer within `timeoutMs` (default 3 s).
 *
 * The timeout is enforced HERE with a race, not only by postgres.js
 * connect_timeout: the caller hands in an existing pooled client whose
 * connect_timeout (createDb default 10 s) cannot be changed after the fact,
 * and a health probe that blocks the start-up banner for ten seconds is
 * itself a defect. A timed-out probe's connection attempt is left to finish
 * in the background; the client is still usable.
 *
 * `migrations` mirrors the Python ledger (ingestion/migrations.py):
 *   - expected = runnable migrations on disk (marker rule, same as
 *     tests/store/testDb.ts);
 *   - with a non-empty app_private.schema_migrations: applied = ledger
 *     rows that are on disk, missing = on disk but not in the ledger;
 *   - without a ledger (pre-ledger database, or one loaded through psql):
 *     the BOOTSTRAP RULE — a file counts as applied ONLY when its
 *     [LEDGER SENTINEL] probe resolves (W12-FIX2: the timestamp boundary is
 *     no longer a rule; every runnable migration declares a probe).
 *
 * Probe grammar (`-- [LEDGER SENTINEL] <kind>:<name>`; a bare name is
 * regclass): regclass | regprocedure | extension | column:<schema.table>.<col>
 * | trigger:<schema.table>.<name>. `SENTINEL_PROBE_CASE` below is the SAME
 * SQL CASE ingestion/migrations.py evaluates, so /v1/health
 * `migrations.missing` and `intake.cli --ensure-db` agree.
 * The constants below are duplicated from the Python module on purpose (no
 * cross-runtime import); tests/store/persistence.test.ts reads migrations.py
 * and fails when they drift.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./db.js";

/** Mirror of ingestion.migrations.PGVECTOR_MARKER. */
export const PGVECTOR_MARKER = "[REQUIRES PGVECTOR]";
/** Mirror of ingestion.migrations.LEDGER_SENTINEL_MARKER. */
export const LEDGER_SENTINEL_MARKER = "[LEDGER SENTINEL]";
/** Mirror of ingestion.migrations.LEDGER_BOOTSTRAP_BOUNDARY. */
export const LEDGER_BOOTSTRAP_BOUNDARY = "20260827120000";
/** Mirror of ingestion.migrations.LEDGER_TABLE. */
export const LEDGER_TABLE = "app_private.schema_migrations";

/** Mirror of ingestion.migrations.SENTINEL_KINDS (W14 B-05 adds type + policy). */
export const SENTINEL_KINDS = [
  "regclass",
  "regprocedure",
  "extension",
  "type",
  "column",
  "trigger",
  "policy",
  // W14 L-FIX: a migration whose primary effect is `alter table ... add
  // constraint` creates no relation to probe. See ingestion/migrations.py.
  "constraint",
] as const;
export type SentinelKind = (typeof SENTINEL_KINDS)[number];

/** Mirror of ingestion.migrations.SENTINEL_THREE_PART_KINDS. */
export const SENTINEL_THREE_PART_KINDS: readonly SentinelKind[] = [
  "column",
  "trigger",
  "policy",
  "constraint",
];

export interface SentinelProbe {
  kind: SentinelKind;
  target: string;
}

/**
 * `<kind>:<name>` -> probe; a bare name is regclass. Throws for an unknown
 * kind or a malformed column/trigger target (mirror of
 * ingestion.migrations.parse_sentinel).
 */
export function parseSentinel(value: string): SentinelProbe {
  const raw = value.trim();
  const colon = raw.indexOf(":");
  const kind = colon === -1 ? "regclass" : raw.slice(0, colon).trim();
  const target = colon === -1 ? raw : raw.slice(colon + 1).trim();
  if (!(SENTINEL_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown ledger sentinel kind '${kind}' in '${value}'`);
  }
  if (target === "") throw new Error(`ledger sentinel without a name: '${value}'`);
  if (
    SENTINEL_THREE_PART_KINDS.includes(kind as SentinelKind) &&
    target.split(".").length < 3
  ) {
    throw new Error(`ledger sentinel ${kind} needs <schema.table>.<name>: '${value}'`);
  }
  return { kind: kind as SentinelKind, target };
}

export const DEFAULT_HEALTH_TIMEOUT_MS = 3000;

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);

export type DatabaseState = "ok" | "down" | "missing";

export interface MigrationHealth {
  applied: number;
  expected: number;
  missing: string[];
  /**
   * Additive (W14 B-45 / ENGRISK E15): ledger rows that are NOT on disk.
   * A file a newer build applied, after the code was rolled back, used to be
   * invisible and `/v1/health` still said `11/11 OK` while the application
   * ran against a newer schema. Non-empty means "the database is ahead of
   * this build".
   */
  unknown: string[];
}

/**
 * Additive (W14 B-05): row-level-security policy count for the two schemas
 * the product owns. A complete database has EXPECTED_RLS_POLICIES; fewer
 * means a migration ran only half-way (ENGRISK E3) and client rows are not
 * protected by a policy.
 */
export interface RlsHealth {
  expected: number;
  present: number;
}

export interface DatabaseHealth {
  db: DatabaseState;
  dbName?: string;
  migrations?: MigrationHealth;
  rls?: RlsHealth;
}

/**
 * Policies created by the runnable migrations across `legal` + `app_private`:
 *   20260826060000_rls.sql                  12
 *   20260902120000_matters_persistence.sql   5
 *   20260903100000_ai_audit_and_scale_indexes.sql  1  (W14 B-23)
 *   20260911100000_source_locators.sql             1  (W19 phase A)
 *   20260911110000_matter_analysis.sql             4  (W19 phases G+H)
 * ENGRISK counted 17 on a restored database before the W14 migration; this
 * build ships 23. Re-measured against a real cluster by
 * `tests/ingestion/test_migrations_ledger.py` and `persistence.test.ts`, so
 * a dropped policy block — the ENGRISK E3 failure — is caught rather than
 * reported as `11/11 OK`.
 */
export const EXPECTED_RLS_POLICIES = 23;

export interface CheckDatabaseOptions {
  /** Probe budget in milliseconds (default 3000). */
  timeoutMs?: number;
  /** Override the migrations directory (tests). */
  migrationsDir?: string;
}

// ---------------------------------------------------------------------------
// Migration plan (disk)
// ---------------------------------------------------------------------------

export interface PlannedMigration {
  name: string;
  timestamp: string;
  /** Raw text of the FIRST `[LEDGER SENTINEL]` line (compat; see `sentinels`). */
  sentinel: string | null;
  /** Additive (W12-FIX2): the parsed first probe; null when the file has none. */
  probe?: SentinelProbe | null;
  /**
   * Additive (W14 B-05): EVERY probe the file declares, in file order. A file
   * counts as bootstrapped only when they ALL resolve — one mid-file probe
   * made a half-applied migration read as complete (ENGRISK E3).
   */
  sentinels: string[];
}

function classify(text: string): { pgvector: boolean; sentinels: string[] } {
  let pgvector = false;
  const sentinels: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("-- " + PGVECTOR_MARKER)) pgvector = true;
    if (line.startsWith("-- " + LEDGER_SENTINEL_MARKER)) {
      const value = line.slice(("-- " + LEDGER_SENTINEL_MARKER).length).trim();
      if (value !== "") sentinels.push(value);
    }
  }
  return { pgvector, sentinels };
}

const planCache = new Map<string, Promise<PlannedMigration[]>>();

/** Runnable (non-pgvector) migrations on disk, filename order. Cached per dir. */
export function planRunnableMigrations(dir = DEFAULT_MIGRATIONS_DIR): Promise<PlannedMigration[]> {
  const cached = planCache.get(dir);
  if (cached !== undefined) return cached;
  const plan = (async () => {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
    const runnable: PlannedMigration[] = [];
    for (const name of names) {
      const text = await readFile(path.join(dir, name), "utf8");
      const { pgvector, sentinels } = classify(text);
      if (pgvector) continue;
      const timestamp = name.split("_", 1)[0] ?? "";
      const sentinel = sentinels[0] ?? null;
      runnable.push({
        name,
        timestamp,
        sentinel,
        probe: sentinel === null ? null : parseSentinel(sentinel),
        sentinels,
      });
    }
    return runnable;
  })();
  planCache.set(dir, plan);
  plan.catch(() => planCache.delete(dir));
  return plan;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

interface ProbeResult {
  dbName: string;
  hasDocuments: boolean;
  ledger: string[] | null;
  /** Raw sentinel strings whose probe RESOLVED, when the ledger is unusable. */
  existing: Set<string>;
  /** Additive (B-05): policies present across legal + app_private. */
  rlsPolicies: number;
}

/**
 * Evaluate every planned sentinel probe in ONE round trip. Returns the raw
 * sentinel strings that resolved. The CASE is the verbatim mirror of
 * ingestion.migrations.SENTINEL_PROBE_SQL (per row instead of per call).
 */
export async function resolveSentinels(sql: Sql, plan: readonly PlannedMigration[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const rows: { raw: string; probe: SentinelProbe }[] = [];
  for (const m of plan) {
    const declared = m.sentinels.length > 0 ? m.sentinels : m.sentinel !== null ? [m.sentinel] : [];
    for (const raw of declared) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      rows.push({ raw, probe: parseSentinel(raw) });
    }
  }
  const existing = new Set<string>();
  if (rows.length === 0) return existing;
  const raws = rows.map((r) => r.raw);
  const kinds = rows.map((r) => r.probe.kind);
  const targets = rows.map((r) => r.probe.target);
  const found = await sql`
    select s.raw
    from unnest(${raws}::text[], ${kinds}::text[], ${targets}::text[]) as s(raw, kind, target)
    where case s.kind
      when 'regclass' then to_regclass(s.target) is not null
      when 'regprocedure' then to_regprocedure(s.target) is not null
      when 'type' then to_regtype(s.target) is not null
      when 'extension' then exists (
        select 1 from pg_extension where extname = s.target)
      when 'column' then exists (
        select 1 from pg_attribute a
        where a.attrelid = to_regclass(regexp_replace(s.target, '\\.[^.]+$', ''))
          and a.attname = substring(s.target from '[^.]+$')
          and a.attnum > 0 and not a.attisdropped)
      when 'trigger' then exists (
        select 1 from pg_trigger t
        where t.tgrelid = to_regclass(regexp_replace(s.target, '\\.[^.]+$', ''))
          and t.tgname = substring(s.target from '[^.]+$')
          and not t.tgisinternal)
      when 'policy' then exists (
        select 1 from pg_policy p
        where p.polrelid = to_regclass(regexp_replace(s.target, '\\.[^.]+$', ''))
          and p.polname = substring(s.target from '[^.]+$'))
      when 'constraint' then exists (
        select 1 from pg_constraint k
        where k.conrelid = to_regclass(regexp_replace(s.target, '\\.[^.]+$', ''))
          and k.conname = substring(s.target from '[^.]+$'))
      else false
    end`;
  for (const r of found) existing.add(String(r["raw"]));
  return existing;
}

async function probe(sql: Sql, plan: PlannedMigration[]): Promise<ProbeResult> {
  const rows = await sql`
    select current_database()::text as db_name,
           to_regclass('legal.documents') is not null as has_documents,
           to_regclass('app_private.schema_migrations') is not null as has_ledger,
           (select count(*) from pg_policies
             where schemaname in ('legal', 'app_private'))::int as rls_policies`;
  const row = rows[0] ?? {};
  const dbName = typeof row["db_name"] === "string" ? row["db_name"] : "";
  const hasDocuments = row["has_documents"] === true;
  const rlsPolicies = Number(row["rls_policies"] ?? 0);
  let ledger: string[] | null = null;
  if (row["has_ledger"] === true) {
    const files = await sql`select filename from app_private.schema_migrations`;
    ledger = files.map((r) => String(r["filename"]));
  }
  const existing =
    hasDocuments && (ledger === null || ledger.length === 0)
      ? await resolveSentinels(sql, plan)
      : new Set<string>();
  return { dbName, hasDocuments, ledger, existing, rlsPolicies };
}

/** Pure: derive the migration health from what the probe saw. */
export function deriveMigrationHealth(
  plan: PlannedMigration[],
  result: Pick<ProbeResult, "hasDocuments" | "ledger" | "existing">,
): MigrationHealth {
  const expected = plan.length;
  // Ledger rows that name a file this build does not ship (E15). Reported
  // whatever the rest of the state is: it means the database is AHEAD.
  const onDisk = new Set(plan.map((m) => m.name));
  const unknown = (result.ledger ?? []).filter((name) => !onDisk.has(name)).sort();
  if (!result.hasDocuments) {
    return { applied: 0, expected, missing: plan.map((m) => m.name), unknown };
  }
  if (result.ledger !== null && result.ledger.length > 0) {
    const recorded = new Set(result.ledger);
    const missing = plan.filter((m) => !recorded.has(m.name)).map((m) => m.name);
    return { applied: expected - missing.length, expected, missing, unknown };
  }
  // Bootstrap rule (pre-ledger database): a file is applied iff EVERY probe
  // it declares resolved (W12-FIX2 P1-9, tightened by W14 B-05 — one
  // mid-file probe let a half-applied file read as complete).
  const missing = plan
    .filter((m) => {
      const declared = m.sentinels.length > 0 ? m.sentinels : m.sentinel !== null ? [m.sentinel] : [];
      return declared.length === 0 || !declared.every((s) => result.existing.has(s));
    })
    .map((m) => m.name);
  return { applied: expected - missing.length, expected, missing, unknown };
}

/**
 * Probe the database within `timeoutMs`. Never throws: an unreachable
 * server, a bad DSN or a slow probe all resolve to `{ db: 'down' }`.
 */
export async function checkDatabase(
  sql: Sql,
  options: CheckDatabaseOptions = {},
): Promise<DatabaseHealth> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  let plan: PlannedMigration[];
  try {
    plan = await planRunnableMigrations(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  } catch {
    plan = [];
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([
      probe(sql, plan).then((r) => ({ ok: true as const, r }), () => ({ ok: false as const })),
      timeout,
    ]);
    if (outcome === "timeout" || outcome.ok === false) return { db: "down" };
    const { r } = outcome;
    const migrations = deriveMigrationHealth(plan, r);
    return {
      db: r.hasDocuments ? "ok" : "missing",
      ...(r.dbName !== "" ? { dbName: r.dbName } : {}),
      migrations,
      rls: { expected: EXPECTED_RLS_POLICIES, present: r.rlsPolicies },
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One Turkish start-up line for serve.mjs / the console's system status. */
export function describeDatabaseHealth(health: DatabaseHealth): string {
  const name = health.dbName !== undefined ? ` (${health.dbName})` : "";
  if (health.db === "down") {
    return (
      "Yerel veritabanına ulaşılamadı — PostgreSQL 127.0.0.1:55432 çalışmıyor olabilir;" +
      " kayıt ve dosya işlemleri kapalı."
    );
  }
  if (health.db === "missing") {
    return (
      `Veritabanı${name} var ama şema yok — .venv/Scripts/python.exe -m intake.cli` +
      " --dsn <dsn> --ensure-db çalıştırın."
    );
  }
  const m = health.migrations;
  if (m !== undefined && m.missing.length > 0) {
    return (
      `Veritabanı${name} bağlı; ${m.applied}/${m.expected} migrasyon uygulanmış —` +
      ` eksik: ${m.missing.join(", ")} (intake.cli --ensure-db ile tamamlanır).`
    );
  }
  // E15: the database carries migrations this build does not ship.
  if (m !== undefined && m.unknown.length > 0) {
    return (
      `Veritabanı${name} bu sürümden daha yeni (${m.unknown.length} bilinmeyen` +
      ` migrasyon) — ColleX'i güncelleyin.`
    );
  }
  const count = m !== undefined ? ` ${m.applied}/${m.expected} migrasyon uygulanmış.` : "";
  // B-05: policies missing means client rows are not protected by RLS.
  const rls = health.rls;
  if (rls !== undefined && rls.present < rls.expected) {
    return (
      `Veritabanı${name} bağlı;${count} ANCAK satır güvenliği eksik:` +
      ` ${rls.present}/${rls.expected} politika var —` +
      ` intake.cli --ensure-db ile tamamlayın.`
    );
  }
  return `Veritabanı${name} bağlı;${count}`;
}
