/**
 * REAL persistence tests (W12-A) against the LOCAL scratch PostgreSQL 18 at
 * 127.0.0.1:55432 — PgAnswerStore, PgDraftStore, PgMatterStore,
 * PgSettingsStore and checkDatabase, on the database `collex_persist_test`.
 *
 * Scratch-database discipline: this file creates and drops ONLY
 * `collex_persist_test` (shared with tests/ingestion/test_migrations_ledger.py,
 * never run at the same time) and refuses every other name by construction
 * (the name is a constant). When the server is unreachable the suite SKIPS
 * cleanly and an always-running marker documents why — the same posture as
 * tests/integration/real-exec.test.ts. Everything is loopback-local.
 *
 * The pure checks (constants mirrored from ingestion/migrations.py,
 * deriveMigrationHealth, the checkDatabase timeout race) run everywhere.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { StoredAnswer } from "../../src/api/answerService.js";
import { LOCAL_TENANT_ID, PgAnswerStore } from "../../src/store/answerStore.js";
import { createDb, type Sql } from "../../src/store/db.js";
import { PgDraftStore, type StorableDraft } from "../../src/store/draftStore.js";
import {
  EXPECTED_RLS_POLICIES,
  LEDGER_BOOTSTRAP_BOUNDARY,
  LEDGER_SENTINEL_MARKER,
  LEDGER_TABLE,
  PGVECTOR_MARKER,
  SENTINEL_KINDS,
  checkDatabase,
  deriveMigrationHealth,
  describeDatabaseHealth,
  parseSentinel,
  planRunnableMigrations,
  resolveSentinels,
} from "../../src/store/health.js";
import { PgMatterStore } from "../../src/matters/store.js";
import { PgSettingsStore } from "../../src/settings/store.js";
import { planMigrations } from "./testDb.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 300_000 });

const TEST_DB_NAME = "collex_persist_test";
const HOST_PORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
const ADMIN_URL = "postgres://postgres@" + HOST_PORT + "/postgres";
const TEST_DB_URL = "postgres://postgres@" + HOST_PORT + "/" + TEST_DB_NAME;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

// Availability probe at collection time (top-level await), like real-exec.
let available = false;
let unavailableReason = "";
{
  const admin = postgres(ADMIN_URL, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await admin`select 1`;
    available = true;
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : String(error);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function resetDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe("drop database if exists " + TEST_DB_NAME + " with (force)");
    await admin.unsafe(
      "create database " + TEST_DB_NAME + " template template0 encoding 'UTF8' locale 'C'",
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function dropDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe("drop database if exists " + TEST_DB_NAME + " with (force)");
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** Apply every runnable migration (marker rule) on one connection, no ledger. */
async function applyRunnableMigrations(): Promise<string[]> {
  const plan = await planMigrations();
  const runner = postgres(TEST_DB_URL, { max: 1, connect_timeout: 10, onnotice: () => undefined });
  try {
    for (const file of plan.runnable) {
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await runner.unsafe(text);
    }
  } finally {
    await runner.end({ timeout: 10 });
  }
  return plan.runnable;
}

const answer = (runId: string, question: string, extra: Partial<StoredAnswer> = {}): StoredAnswer => ({
  runId,
  result: {
    schema: "collex.answer.result/v1",
    runId,
    question,
    asOf: "2026-09-02",
    status: "COMPLETE",
    finalizable: true,
    evidence: [{ evidenceId: "e1", quote: "İmzalı sözleşme" }],
    claims: [],
  } as unknown as StoredAnswer["result"],
  bundle: {
    schema: "collex.answer.evidence-bundle/v1",
    texts: { "v-1": "Kanonik metin — İstanbul'da 𝔘nicode sınırları" },
  } as unknown as StoredAnswer["bundle"],
  storedAt: "2026-09-02T10:00:00.000Z",
  ...extra,
});

const draft = (draftId: string, version: number, extra: Partial<StorableDraft> = {}): StorableDraft & {
  sections: Array<{ id: string }>;
} => ({
  draftId,
  version,
  kind: "dilekce",
  template: "dava-dilekcesi",
  title: `Dava Dilekçesi v${version}`,
  createdAt: `2026-09-02T1${version}:00:00.000Z`,
  unsupportedCount: version,
  sections: [{ id: `s${version}` }],
  ...extra,
});

// ---------------------------------------------------------------------------
// Pure checks (always run)
// ---------------------------------------------------------------------------

describe("health constants mirror ingestion/migrations.py", () => {
  it("marker, sentinel marker, boundary and ledger table match the Python source", async () => {
    const source = await readFile(path.join(REPO_ROOT, "ingestion", "migrations.py"), "utf8");
    const py = (name: string): string | null => {
      const m = source.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
      return m?.[1] ?? null;
    };
    expect(py("PGVECTOR_MARKER")).toBe(PGVECTOR_MARKER);
    expect(py("LEDGER_SENTINEL_MARKER")).toBe(LEDGER_SENTINEL_MARKER);
    expect(py("LEDGER_BOOTSTRAP_BOUNDARY")).toBe(LEDGER_BOOTSTRAP_BOUNDARY);
    expect(py("LEDGER_TABLE")).toBe(LEDGER_TABLE);
    // W12-FIX2: the probe grammar and the CASE that evaluates it are mirrored.
    const kinds = source.match(/SENTINEL_KINDS\s*=\s*\(([^)]*)\)/)?.[1] ?? "";
    expect(kinds.match(/"([a-z]+)"/g)?.map((k) => k.replace(/"/g, ""))).toEqual([...SENTINEL_KINDS]);
    for (const clause of ["when 'regclass' then to_regclass(", "when 'regprocedure' then to_regprocedure(", "when 'type' then to_regtype(", "from pg_extension where extname =", "and a.attnum > 0 and not a.attisdropped", "and not t.tgisinternal", "from pg_policy p"]) {
      expect(source).toContain(clause);
    }
  });

  it("plans the same runnable set as the store harness; EVERY file carries a parseable probe (W12-FIX2)", async () => {
    const plan = await planRunnableMigrations(MIGRATIONS_DIR);
    const harness = await planMigrations();
    expect(plan.map((m) => m.name)).toEqual(harness.runnable);
    const matters = plan.find((m) => m.name.startsWith("20260902120000"));
    expect(matters?.sentinel).toBe("regclass:app_private.matters");
    expect(matters?.probe).toEqual({ kind: "regclass", target: "app_private.matters" });
    expect(plan.every((m) => m.sentinel !== null && m.probe !== null)).toBe(true);
    const probes = plan.map((m) => `${m.probe?.kind}:${m.probe?.target}`);
    expect(new Set(probes).size).toBe(plan.length);
    expect(plan.find((m) => m.name.startsWith("20260826100000"))?.sentinels).toContain(
      "trigger:legal.document_versions.document_versions_close_previous",
    );

    // W14 B-05: a file whose sentinel sits mid-file reads as complete when it
    // is only half applied. Every multi-object migration therefore declares a
    // probe for its LAST object too, and every declared probe must parse.
    for (const m of plan) {
      expect(m.sentinels.length).toBeGreaterThan(0);
      for (const raw of m.sentinels) expect(() => parseSentinel(raw)).not.toThrow();
    }
    expect(matters?.sentinels).toEqual([
      "regclass:app_private.matters",
      "app_private.settings",
      "policy:app_private.settings.settings_tenant",
    ]);
    // The two new kinds are actually used by the shipped files.
    const allProbes = plan.flatMap((m) => m.sentinels);
    expect(allProbes.some((s) => s.startsWith("policy:"))).toBe(true);
    expect(allProbes.some((s) => s.startsWith("type:"))).toBe(true);
  });

  it("parseSentinel mirrors parse_sentinel", () => {
    expect(parseSentinel("app_private.settings")).toEqual({ kind: "regclass", target: "app_private.settings" });
    expect(parseSentinel(" extension:btree_gist ")).toEqual({ kind: "extension", target: "btree_gist" });
    expect(parseSentinel("regprocedure:app_private.reap_stuck_jobs(interval)")).toEqual({
      kind: "regprocedure",
      target: "app_private.reap_stuck_jobs(interval)",
    });
    expect(parseSentinel("policy:app_private.settings.settings_tenant")).toEqual({
      kind: "policy",
      target: "app_private.settings.settings_tenant",
    });
    expect(parseSentinel("type:legal.relation_kind")).toEqual({ kind: "type", target: "legal.relation_kind" });
    for (const bad of ["view:legal.x", "regclass:", "column:chunks.col", "trigger:legal.t", "policy:legal.t"]) {
      expect(() => parseSentinel(bad)).toThrow();
    }
  });
});

describe("deriveMigrationHealth", () => {
  const planned = (name: string, timestamp: string, sentinels: string[]) => ({
    name,
    timestamp,
    sentinel: sentinels[0] ?? null,
    sentinels,
  });
  const plan = [
    planned("20260826010000_a.sql", "20260826010000", ["extension:btree_gist"]),
    planned("20260827120000_b.sql", "20260827120000", ["regclass:legal.some_idx"]),
    planned("20260902120000_c.sql", "20260902120000", ["app_private.settings"]),
  ];
  it("no schema: nothing applied", () => {
    expect(deriveMigrationHealth(plan, { hasDocuments: false, ledger: null, existing: new Set() })).toEqual({
      applied: 0,
      expected: 3,
      missing: plan.map((m) => m.name),
      unknown: [],
    });
  });
  it("ledger present: missing = on disk but unrecorded", () => {
    expect(
      deriveMigrationHealth(plan, { hasDocuments: true, ledger: ["20260826010000_a.sql", "20260827120000_b.sql"], existing: new Set() }),
    ).toEqual({ applied: 2, expected: 3, missing: ["20260902120000_c.sql"], unknown: [] });
  });
  it("no ledger: a file counts as applied ONLY when its probe resolved — no timestamp shortcut (W12-FIX2)", () => {
    expect(deriveMigrationHealth(plan, { hasDocuments: true, ledger: null, existing: new Set() })).toEqual({
      applied: 0,
      expected: 3,
      missing: plan.map((m) => m.name),
      unknown: [],
    });
    expect(
      deriveMigrationHealth(plan, {
        hasDocuments: true,
        ledger: [],
        existing: new Set(["extension:btree_gist", "app_private.settings"]),
      }),
    ).toEqual({ applied: 2, expected: 3, missing: ["20260827120000_b.sql"], unknown: [] });
    expect(
      deriveMigrationHealth(plan, {
        hasDocuments: true,
        ledger: [],
        existing: new Set(["extension:btree_gist", "regclass:legal.some_idx", "app_private.settings"]),
      }),
    ).toEqual({ applied: 3, expected: 3, missing: [], unknown: [] });
    const bare = [planned("20260826010000_a.sql", "20260826010000", [])];
    expect(deriveMigrationHealth(bare, { hasDocuments: true, ledger: null, existing: new Set() }).missing).toEqual([
      "20260826010000_a.sql",
    ]);
  });

  // W14 B-05: the ENGRISK E3 case in pure form. The file declares a mid-file
  // probe AND a last-object probe; only the mid-file one resolves, i.e. the
  // migration stopped between them. Under the old single-probe rule the file
  // read as APPLIED and the RLS block was lost forever.
  it("multi-sentinel: a HALF-applied file is missing, not applied (B-05)", () => {
    const half = [
      planned("20260902120000_matters.sql", "20260902120000", [
        "regclass:app_private.matters",
        "app_private.settings",
        "policy:app_private.settings.settings_tenant",
      ]),
    ];
    const halfApplied = deriveMigrationHealth(half, {
      hasDocuments: true,
      ledger: [],
      existing: new Set(["regclass:app_private.matters", "app_private.settings"]),
    });
    expect(halfApplied.missing).toEqual(["20260902120000_matters.sql"]);
    expect(halfApplied.applied).toBe(0);

    const fullyApplied = deriveMigrationHealth(half, {
      hasDocuments: true,
      ledger: [],
      existing: new Set([
        "regclass:app_private.matters",
        "app_private.settings",
        "policy:app_private.settings.settings_tenant",
      ]),
    });
    expect(fullyApplied.missing).toEqual([]);
    expect(fullyApplied.applied).toBe(1);
  });

  // W14 B-45 / ENGRISK E15: a ledger row with no file on disk means the
  // database is AHEAD of this build; it used to be invisible while health
  // still said 11/11 OK.
  it("reports ledger rows that are not on disk as `unknown` (E15)", () => {
    const health = deriveMigrationHealth(plan, {
      hasDocuments: true,
      ledger: [...plan.map((m) => m.name), "20270101000000_from_the_future.sql"],
      existing: new Set(),
    });
    expect(health.missing).toEqual([]);
    expect(health.unknown).toEqual(["20270101000000_from_the_future.sql"]);
    expect(describeDatabaseHealth({ db: "ok", dbName: "collex_local", migrations: health })).toContain(
      "bu sürümden daha yeni (1 bilinmeyen migrasyon)",
    );
  });

  // B-05 (d): the console must be able to say "row security is incomplete".
  it("describeDatabaseHealth warns when policies are missing (B-05)", () => {
    const line = describeDatabaseHealth({
      db: "ok",
      dbName: "collex_local",
      migrations: { applied: 11, expected: 11, missing: [], unknown: [] },
      rls: { expected: 17, present: 12 },
    });
    expect(line).toContain("satır güvenliği eksik: 12/17 politika");
  });
});

describe("checkDatabase without a server", () => {
  it("a refused port is 'down' quickly", async () => {
    const dead = createDb({ url: "postgres://postgres@127.0.0.1:1/collex_local", connectTimeoutS: 2, max: 1 });
    const started = Date.now();
    try {
      const health = await checkDatabase(dead, { migrationsDir: MIGRATIONS_DIR });
      expect(health).toEqual({ db: "down" });
      expect(Date.now() - started).toBeLessThan(3500);
      expect(describeDatabaseHealth(health)).toMatch(/Yerel veritabanına ulaşılamadı/);
    } finally {
      await dead.end({ timeout: 1 });
    }
  });

  it("a probe that never answers is 'down' after timeoutMs (the race, not the driver)", async () => {
    const hanging = (() => new Promise<never>(() => undefined)) as unknown as Sql;
    const started = Date.now();
    expect(await checkDatabase(hanging, { timeoutMs: 150, migrationsDir: MIGRATIONS_DIR })).toEqual({ db: "down" });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(2000);
  });

  it("describes every state in Turkish", () => {
    expect(describeDatabaseHealth({ db: "missing", dbName: "collex_local" })).toMatch(/şema yok.*--ensure-db/);
    expect(
      describeDatabaseHealth({
        db: "ok",
        dbName: "collex_local",
        migrations: { applied: 10, expected: 11, missing: ["20260902120000_matters_persistence.sql"], unknown: [] },
      }),
    ).toMatch(/10\/11 migrasyon.*eksik: 20260902120000_matters_persistence.sql/);
    expect(
      describeDatabaseHealth({ db: "ok", dbName: "collex_local", migrations: { applied: 11, expected: 11, missing: [], unknown: [] } }),
    ).toBe("Veritabanı (collex_local) bağlı; 11/11 migrasyon uygulanmış.");
  });
});

// ---------------------------------------------------------------------------
// Integration (collex_persist_test)
// ---------------------------------------------------------------------------

describe.skipIf(!available)("persistence stores (collex_persist_test)", () => {
  let sql: Sql;
  let runnable: string[];
  const logged: string[] = [];
  const log = (line: string) => {
    logged.push(line);
  };

  beforeAll(async () => {
    await resetDatabase();
    runnable = await applyRunnableMigrations();
    sql = createDb({ url: TEST_DB_URL, max: 4, statementTimeoutMs: 30_000, applicationName: "collex-persist-tests" });
  });

  afterAll(async () => {
    if (sql !== undefined) await sql.end({ timeout: 5 });
    await dropDatabase();
  });

  it("checkDatabase: ok on a psql-loaded database (bootstrap rule), missing on a schema-less one", async () => {
    const health = await checkDatabase(sql, { migrationsDir: MIGRATIONS_DIR });
    expect(health.db).toBe("ok");
    expect(health.dbName).toBe(TEST_DB_NAME);
    expect(health.migrations).toEqual({ applied: runnable.length, expected: runnable.length, missing: [], unknown: [] });
    // B-05 (d): a complete database carries every RLS policy the migrations create.
    expect(health.rls).toEqual({ expected: EXPECTED_RLS_POLICIES, present: EXPECTED_RLS_POLICIES });

    // W12-FIX2 (P1-9): every probe kind resolves on the complete schema, and
    // a psql-built database that LACKS the trigger migration is reported as
    // missing exactly that file — a timestamp rule said "complete" here.
    const plan = await planRunnableMigrations(MIGRATIONS_DIR);
    const resolved = await resolveSentinels(sql, plan);
    expect([...resolved].sort()).toEqual([...new Set(plan.flatMap((m) => m.sentinels))].sort());
    expect(
      await resolveSentinels(sql, [
        {
          name: "x.sql",
          timestamp: "0",
          sentinel: "trigger:legal.document_versions.nope",
          sentinels: ["trigger:legal.document_versions.nope"],
        },
      ]),
    ).toEqual(new Set());
    await sql.unsafe("drop trigger document_versions_close_previous on legal.document_versions");
    try {
      const lacking = await checkDatabase(sql, { migrationsDir: MIGRATIONS_DIR });
      expect(lacking.migrations).toEqual({
        applied: runnable.length - 1,
        expected: runnable.length,
        missing: ["20260826100000_version_transitions.sql"],
        unknown: [],
      });
      expect(describeDatabaseHealth(lacking)).toContain("eksik: 20260826100000_version_transitions.sql");
    } finally {
      await sql.unsafe(
        "create trigger document_versions_close_previous before insert on legal.document_versions" +
          " for each row execute function legal.close_previous_current_version()",
      );
    }
    expect((await checkDatabase(sql, { migrationsDir: MIGRATIONS_DIR })).migrations?.missing).toEqual([]);

    // A partial ledger is reported honestly.
    await sql.unsafe(
      "create table app_private.schema_migrations (filename text primary key, applied_at timestamptz not null default now())",
    );
    const partial = runnable.filter((n) => !n.startsWith("20260902120000"));
    for (const name of partial) await sql`insert into app_private.schema_migrations (filename) values (${name})`;
    const withLedger = await checkDatabase(sql, { migrationsDir: MIGRATIONS_DIR });
    expect(withLedger.migrations).toEqual({
      applied: partial.length,
      expected: runnable.length,
      missing: ["20260902120000_matters_persistence.sql"],
      unknown: [],
    });
    await sql`insert into app_private.schema_migrations (filename) values ('20260902120000_matters_persistence.sql')`;
    expect((await checkDatabase(sql, { migrationsDir: MIGRATIONS_DIR })).migrations?.missing).toEqual([]);

    // The maintenance database has no legal schema: reachable but 'missing'.
    const maintenance = createDb({ url: ADMIN_URL, max: 1 });
    try {
      const missing = await checkDatabase(maintenance, { migrationsDir: MIGRATIONS_DIR });
      expect(missing.db).toBe("missing");
      expect(missing.dbName).toBe("postgres");
      expect(missing.migrations?.applied).toBe(0);
    } finally {
      await maintenance.end({ timeout: 5 });
    }
  });

  it("answers: put -> warm on a FRESH instance -> get, texts intact; list newest first", async () => {
    const first = new PgAnswerStore({ sql, log });
    first.put(answer("run-a", "Birinci soru", { storedAt: "2026-09-02T10:00:00.000Z" }));
    first.put(answer("run-b", "İkinci soru", { storedAt: "2026-09-02T11:00:00.000Z", mode: "live" }));
    expect(first.get("run-a")?.runId).toBe("run-a");
    await first.flush();
    expect(logged).toEqual([]);

    const second = new PgAnswerStore({ sql, log });
    expect(second.get("run-a")).toBeUndefined();
    await second.warm("run-a");
    const warmed = second.get("run-a");
    expect(warmed).toBeDefined();
    expect(warmed?.result).toEqual(answer("run-a", "Birinci soru").result);
    expect(warmed?.bundle).toEqual(answer("run-a", "Birinci soru").bundle);
    expect(warmed?.storedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(warmed?.mode).toBe("local");
    expect(warmed?.question).toBe("Birinci soru");
    expect(warmed?.matterId).toBeNull();
    await second.warm("run-does-not-exist");
    expect(second.get("run-does-not-exist")).toBeUndefined();

    const list = await second.list();
    expect(list.map((s) => s.runId)).toEqual(["run-b", "run-a"]);
    expect(list[0]).toEqual({
      runId: "run-b",
      question: "İkinci soru",
      status: "COMPLETE",
      mode: "live",
      matterId: null,
      createdAt: "2026-09-02T11:00:00.000Z",
      evidenceCount: 1,
      finalizable: true,
    });
    expect(await second.list({ limit: 1 })).toHaveLength(1);
  });

  it("answers: attach files under a matter and survives a re-put; matter deletion detaches (FK set null)", async () => {
    const matters = new PgMatterStore({ sql });
    const store = new PgAnswerStore({ sql, log });
    const matter = await matters.create({ title: "Yılmaz / Kira tahliye" });
    store.put(answer("run-c", "Üçüncü soru"));
    await store.attach("run-c", matter.id);
    expect(store.get("run-c")?.matterId).toBe(matter.id);
    expect((await store.list({ matterId: matter.id })).map((s) => s.runId)).toEqual(["run-c"]);

    // A re-put WITHOUT matterId keeps the filing (in the DB and in the cache).
    store.put(answer("run-c", "Üçüncü soru (yeniden)"));
    await store.flush();
    expect(store.get("run-c")?.matterId).toBe(matter.id);
    const fresh = new PgAnswerStore({ sql, log });
    await fresh.warm("run-c");
    expect(fresh.get("run-c")?.matterId).toBe(matter.id);
    expect(fresh.get("run-c")?.question).toBe("Üçüncü soru (yeniden)");

    await store.attach("run-c", null);
    expect((await store.list({ matterId: matter.id })).map((s) => s.runId)).toEqual([]);
    await store.attach("run-c", matter.id);
    expect(await matters.remove(matter.id)).toBe(true);
    const after = new PgAnswerStore({ sql, log });
    await after.warm("run-c");
    expect(after.get("run-c")?.matterId).toBeNull();

    await expect(store.attach("run-c", "not-a-uuid")).rejects.toThrow(RangeError);
    expect(logged).toEqual([]);
  });

  it("answers: fileScope is listed from the result column and list({fileId}) filters by jsonb containment (W12-API2)", async () => {
    const matters = new PgMatterStore({ sql });
    const matter = await matters.create({ title: "Belge kapsamı" });
    const store = new PgAnswerStore({ sql, log });
    const scope = { fileIds: ["abc123def4567890", "0123456789abcdef"], includeCorpus: false };
    const scoped = answer("run-f", "Depozito ne zaman iade edilir?", {
      storedAt: "2026-09-02T12:00:00.000Z",
      matterId: matter.id,
    });
    store.put({
      ...scoped,
      result: { ...(scoped.result as unknown as Record<string, unknown>), fileScope: scope } as StoredAnswer["result"],
    });
    store.put(answer("run-g", "Korpus sorusu", { storedAt: "2026-09-02T12:30:00.000Z", matterId: matter.id }));
    await store.flush();
    expect(logged).toEqual([]);

    const fresh = new PgAnswerStore({ sql, log });
    const all = await fresh.list({ matterId: matter.id });
    expect(all.map((s) => s.runId)).toEqual(["run-g", "run-f"]);
    expect(all[1]?.fileScope).toEqual(scope);
    expect("fileScope" in all[0]!).toBe(false);

    expect((await fresh.list({ fileId: "abc123def4567890" })).map((s) => s.runId)).toEqual(["run-f"]);
    expect((await fresh.list({ fileId: "0123456789abcdef", matterId: matter.id })).map((s) => s.runId)).toEqual(["run-f"]);
    expect(await fresh.list({ fileId: "yok" })).toEqual([]);
    // Element containment, never a substring match.
    expect(await fresh.list({ fileId: "abc123" })).toEqual([]);
    // An id that would be a JSON-injection attempt is just a value.
    expect(await fresh.list({ fileId: '"]}' })).toEqual([]);
    await expect(fresh.list({ fileId: "" })).rejects.toThrow(RangeError);
    await expect(fresh.list({ fileId: "x".repeat(201) })).rejects.toThrow(RangeError);

    // The warmed entry carries the scope back into the cache (summary path).
    await fresh.warm("run-f");
    expect((fresh.get("run-f")?.result as { fileScope?: unknown }).fileScope).toEqual(scope);
    expect(logged).toEqual([]);
  });

  it("answers: a persistence failure is logged with a code, never thrown, and the cache still serves", async () => {
    const dead = createDb({ url: TEST_DB_URL, max: 1 });
    await dead.end({ timeout: 1 });
    const lines: string[] = [];
    const store = new PgAnswerStore({ sql: dead, log: (l) => lines.push(l) });
    expect(() => store.put(answer("run-dead", "Kapalı bağlantı"))).not.toThrow();
    expect(store.get("run-dead")?.runId).toBe("run-dead");
    await store.flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[collex\] ANSWER_PERSIST_FAILED runId=run-dead: /);
  });

  it("drafts: every put appends a version; get/warm return the highest; list shows latest only", async () => {
    const matters = new PgMatterStore({ sql });
    const matter = await matters.create({ title: "Taslak dosyası" });
    const store = new PgDraftStore({ sql, log });
    store.put(draft("dft-1", 1, { matterId: matter.id }));
    store.put(draft("dft-1", 2, { matterId: matter.id }));
    store.put(draft("dft-1", 2, { matterId: matter.id, title: "Dava Dilekçesi v2 (yeniden)" })); // idempotent re-put
    store.put(draft("dft-2", 1));
    await store.flush();
    expect(logged).toEqual([]);
    expect(store.get("dft-1")?.title).toBe("Dava Dilekçesi v2 (yeniden)");

    const fresh = new PgDraftStore({ sql, log });
    expect(fresh.get("dft-1")).toBeUndefined();
    await fresh.warm("dft-1");
    const latest = fresh.get("dft-1");
    expect(latest?.version).toBe(2);
    expect(latest?.title).toBe("Dava Dilekçesi v2 (yeniden)");
    expect((latest as { sections?: unknown }).sections).toEqual([{ id: "s2" }]);

    const versions = await fresh.versions("dft-1");
    expect(versions.map((v) => [v.version, v.unsupportedCount])).toEqual([
      [2, 2],
      [1, 1],
    ]);
    expect(versions[0]).toMatchObject({
      draftId: "dft-1",
      kind: "dilekce",
      template: "dava-dilekcesi",
      matterId: matter.id,
      createdAt: "2026-09-02T12:00:00.000Z",
    });

    const all = await fresh.list();
    expect(all.map((d) => [d.draftId, d.version])).toEqual([
      ["dft-1", 2],
      ["dft-2", 1],
    ]);
    expect((await fresh.list({ matterId: matter.id })).map((d) => d.draftId)).toEqual(["dft-1"]);
    expect(await fresh.versions("dft-none")).toEqual([]);

    // A draft without `version` is version 1.
    store.put(draft("dft-3", 1, { version: undefined }));
    await store.flush();
    expect((await store.versions("dft-3")).map((v) => v.version)).toEqual([1]);
  });

  it("drafts: a version written after its matter was deleted is STORED (FK retry), and detachMatter nulls the rows (W12-FIX)", async () => {
    // Reviewed 02.09.2026: after DELETE /v1/matters/{id} every later PUT
    // answered 200 while drafts_matter_id_fkey refused the row — v2..vN
    // existed only in the cache and vanished on restart.
    const matters = new PgMatterStore({ sql });
    const matter = await matters.create({ title: "Silinecek dosya" });
    const store = new PgDraftStore({ sql, log });
    store.put(draft("dft-fk", 1, { matterId: matter.id }));
    await store.flush();
    expect(logged).toEqual([]);
    expect(await matters.remove(matter.id)).toBe(true);

    // The cached draft still names the dead matter (no detach was called).
    store.put(draft("dft-fk", 2, { matterId: matter.id }));
    expect(await store.persisted("dft-fk")).toBe(true);
    expect(logged.some((l) => l.startsWith("[collex] DRAFT_MATTER_GONE draftId=dft-fk version=2"))).toBe(true);
    expect(logged.some((l) => l.includes("DRAFT_PERSIST_FAILED"))).toBe(false);
    expect(store.get("dft-fk")?.matterId).toBeNull();

    const fresh = new PgDraftStore({ sql, log });
    const versions = await fresh.versions("dft-fk");
    expect(versions.map((v) => [v.version, v.matterId])).toEqual([
      [2, null],
      [1, null],
    ]);
    await fresh.warm("dft-fk");
    expect(fresh.get("dft-fk")?.version).toBe(2);
    expect(fresh.get("dft-fk")?.matterId).toBeNull();

    // detachMatter: the route's own path — cache and rows (column + body).
    const other = await matters.create({ title: "Ayrılacak dosya" });
    store.put(draft("dft-det", 1, { matterId: other.id }));
    store.put(draft("dft-det", 2, { matterId: other.id }));
    await store.flush();
    await store.detachMatter(other.id);
    expect(store.get("dft-det")?.matterId).toBeNull();
    const rows = await sql`
      select version_no, matter_id, body ->> 'matterId' as body_matter
      from app_private.drafts where draft_id = 'dft-det' order by version_no`;
    expect(rows.map((r) => [Number(r["version_no"]), r["matter_id"], r["body_matter"]])).toEqual([
      [1, null, null],
      [2, null, null],
    ]);
    expect(await matters.remove(other.id)).toBe(true);
    store.put(draft("dft-det", 3));
    expect(await store.persisted("dft-det")).toBe(true);
    expect((await store.versions("dft-det")).map((v) => v.version)).toEqual([3, 2, 1]);

    // A persist that really fails reports false (dead connection).
    const dead = createDb({ url: TEST_DB_URL, max: 1 });
    await dead.end({ timeout: 1 });
    const lines: string[] = [];
    const broken = new PgDraftStore({ sql: dead, log: (l) => lines.push(l) });
    broken.put(draft("dft-dead", 1));
    expect(await broken.persisted("dft-dead")).toBe(false);
    expect(lines[0]).toMatch(/^\[collex\] DRAFT_PERSIST_FAILED draftId=dft-dead version=1: /);
    expect(await broken.persisted("dft-never-put")).toBe(true);
  });

  it("answers: a run whose matter vanished mid-flight is stored without the matter (FK retry) and persisted() reports it (W12-FIX)", async () => {
    const matters = new PgMatterStore({ sql });
    const matter = await matters.create({ title: "Araştırma sırasında silinen dosya" });
    const store = new PgAnswerStore({ sql, log });
    expect(await matters.remove(matter.id)).toBe(true);
    store.put(answer("run-gone", "Dosya silindikten sonra biten çalışma", { matterId: matter.id }));
    expect(await store.persisted("run-gone")).toBe(true);
    expect(logged.some((l) => l.startsWith("[collex] ANSWER_MATTER_GONE runId=run-gone"))).toBe(true);
    expect(logged.some((l) => l.includes("ANSWER_PERSIST_FAILED"))).toBe(false);
    expect(store.get("run-gone")?.matterId).toBeNull();
    const fresh = new PgAnswerStore({ sql, log });
    await fresh.warm("run-gone");
    expect(fresh.get("run-gone")?.question).toBe("Dosya silindikten sonra biten çalışma");
    expect(fresh.get("run-gone")?.matterId).toBeNull();

    const dead = createDb({ url: TEST_DB_URL, max: 1 });
    await dead.end({ timeout: 1 });
    const broken = new PgAnswerStore({ sql: dead, log: () => undefined });
    broken.put(answer("run-dead-2", "Kapalı bağlantı"));
    expect(await broken.persisted("run-dead-2")).toBe(false);
  });

  it("matters: CRUD + items + deadlines + summaries against real SQL", async () => {
    const store = new PgMatterStore({ sql });
    const a = await store.create({ title: "Yılmaz / Kira tahliye", client: "Ayşe Yılmaz", opposing: "Veli Kaya" });
    const b = await store.create({ title: "Demir / İşe iade", client: "Mehmet Demir", kind: "danismanlik", status: "beklemede" });
    expect(a.kind).toBe("dava");
    expect(b.status).toBe("beklemede");

    expect((await store.get(a.id))?.title).toBe("Yılmaz / Kira tahliye");
    expect(await store.get("not-a-uuid")).toBeUndefined();
    const updated = await store.update(a.id, { court: "İstanbul 3. Sulh Hukuk", docketNo: "2026/123" });
    expect(updated?.court).toBe("İstanbul 3. Sulh Hukuk");
    expect(updated?.client).toBe("Ayşe Yılmaz");
    expect(await store.update("00000000-0000-4000-8000-00000000dead", { title: "x" })).toBeUndefined();

    // Relative to the day this runs: an OPEN deadline that has passed is no
    // longer "the next one", so absolute dates made this test rot.
    const inDays = (days: number): string =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const soonDue = inDays(3);
    const laterDue = inDays(20);
    const soon = await store.addItem(a.id, {
      kind: "deadline",
      payload: { title: "Cevap süresi", dueDate: soonDue, status: "acik", source: "manual" },
    });
    const later = await store.addItem(a.id, {
      kind: "deadline",
      payload: { title: "İstinaf", dueDate: laterDue, status: "acik", source: "hesap" },
    });
    await store.addItem(b.id, {
      kind: "deadline",
      payload: { title: "Görüşme", dueDate: inDays(1), status: "acik", source: "manual" },
    });
    await store.addItem(b.id, {
      kind: "deadline",
      payload: { title: "Bitti", dueDate: inDays(-10), status: "tamam", source: "manual" },
    });
    const note = await store.addItem(a.id, { kind: "note", refId: null, payload: { text: "Not", source: "manual" } });
    expect(soon?.itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(note?.payload).toEqual({ text: "Not", source: "manual" });
    expect(await store.addItem("00000000-0000-4000-8000-00000000dead", { kind: "note", payload: {} })).toBeUndefined();

    const items = await store.listItems(a.id);
    expect(items.map((i) => i.kind)).toEqual(["deadline", "deadline", "note"]);
    expect((await store.getItem(a.id, note!.itemId))?.itemId).toBe(note!.itemId);
    expect(await store.getItem(b.id, note!.itemId)).toBeUndefined();

    let list = await store.list();
    const summaryA = list.find((m) => m.id === a.id);
    // toMatchObject, not toEqual: the item-kind set is ADDITIVE (a new kind
    // adds a counter), and this suite pins the persistence layer, not the
    // matters lane's kind list.
    expect(summaryA?.counts).toMatchObject({ files: 0, answers: 0, drafts: 0, notes: 1, events: 0, deadlines: 2 });
    // toMatchObject: the deadline summary is ADDITIVE (the matters lane adds
    // derived fields such as daysLeft/overdue); this suite pins persistence,
    // not that lane's field list.
    expect(summaryA?.nextDeadline).toMatchObject({
      itemId: soon!.itemId,
      title: "Cevap süresi",
      dueDate: soonDue,
    });
    expect(summaryA?.lastActivityAt).toBe(note!.updatedAt);
    // Newest activity first (other tests in this file leave their own matters behind).
    expect(list.map((m) => m.id).filter((id) => id === a.id || id === b.id)).toEqual([a.id, b.id]);

    expect((await store.list({ status: "beklemede" })).map((m) => m.id)).toEqual([b.id]);
    expect((await store.list({ q: "ayşe" })).map((m) => m.id)).toEqual([a.id]);
    expect((await store.list({ q: "İşe" })).map((m) => m.id)).toEqual([b.id]);
    expect((await store.list({ q: "2026/123" })).map((m) => m.id)).toEqual([a.id]);
    expect(await store.list({ q: "%" })).toHaveLength(0);

    const deadlines = await store.listDeadlines();
    expect(deadlines.map((d) => [d.payload["title"], d.matterTitle])).toEqual([
      ["Görüşme", "Demir / İşe iade"],
      ["Cevap süresi", "Yılmaz / Kira tahliye"],
      ["İstinaf", "Yılmaz / Kira tahliye"],
    ]);
    expect((await store.listDeadlines({ until: soonDue })).map((d) => d.payload["title"])).toEqual([
      "Görüşme",
      "Cevap süresi",
    ]);

    const closed = await store.updateItem(a.id, soon!.itemId, {
      payload: { ...soon!.payload, status: "tamam" },
    });
    expect(closed?.payload["status"]).toBe("tamam");
    expect(closed?.refId).toBeNull();
    const reffed = await store.updateItem(a.id, note!.itemId, { refId: "abcdef0123456789" });
    expect(reffed?.refId).toBe("abcdef0123456789");
    expect(reffed?.payload).toEqual({ text: "Not", source: "manual" });
    list = await store.list();
    expect(list.find((m) => m.id === a.id)?.nextDeadline?.itemId).toBe(later!.itemId);

    expect(await store.removeItem(a.id, later!.itemId)).toBe(true);
    expect(await store.removeItem(a.id, later!.itemId)).toBe(false);
    expect(await store.remove(b.id)).toBe(true);
    expect(await store.remove(b.id)).toBe(false);
    expect(await store.listItems(b.id)).toEqual([]);
    expect((await store.listDeadlines()).map((d) => d.payload["title"])).toEqual([]);
  });

  it("settings: defaults, round-trip, and an older/partial document laid over the defaults", async () => {
    const store = new PgSettingsStore({ sql });
    const initial = await store.load();
    expect(initial.preferences).toEqual({ defaultCity: "", defaultAsOf: "today", theme: "system", showDemoPresets: true });
    expect(initial.profile.ad).toBe("");

    const saved = await store.save({
      profile: { ...initial.profile, ad: "Av. Anıl Eray", baro: "İstanbul Barosu", sicilNo: "12345" },
      preferences: { defaultCity: "İstanbul", defaultAsOf: "2026-09-02", theme: "dark", showDemoPresets: false },
    });
    expect(saved.profile.ad).toBe("Av. Anıl Eray");
    expect(await store.load()).toEqual(saved);

    await sql`
      update app_private.settings set value = '{"ad": "Av. Eski", "eskiAlan": 1}'::jsonb
      where key = 'profile'`;
    await sql`delete from app_private.settings where key = 'preferences'`;
    const migrated = await store.load();
    expect(migrated.profile).toEqual({ ...initial.profile, ad: "Av. Eski" });
    expect(migrated.preferences).toEqual(initial.preferences);
  });

  // -------------------------------------------------------------------------
  // W14 F-PERF, V-2 — list({fileId}) must USE answers_filescope_gin.
  //
  // The `fileScope … jsonb containment` test above proves the filter returns
  // the right ROWS. It stayed green while the query ran `Seq Scan on answers`,
  // because a correct result set says nothing about the plan: the index
  // (`gin ((result -> 'fileScope') jsonb_path_ops)`, migration
  // 20260903100000) was created for a predicate the product never sent.
  // Measured on a 2 000-answer probe database (`collex_perf_test`,
  // 02.09.2026): the old whole-column predicate 1.683 ms with
  // `Rows Removed by Filter: 2024`; the corrected one 0.890 ms through a
  // Bitmap Index Scan; the SAME six rows; and
  // `pg_stat_user_indexes.idx_scan = 0` for the index before the fix.
  //
  // Three assertions, because each one alone is passable by a wrong query:
  //  (1) the PRODUCT's own list({fileId}) moves the index's scan counter — a
  //      plan assertion on a hand-written copy of the SQL would not;
  //  (2) the three predicate shapes are explained side by side, so the shape
  //      the migration comment used to prescribe is pinned as index-using AND
  //      row-losing, which is exactly why that comment was wrong;
  //  (3) the migration on disk no longer prescribes it.
  //
  // Everything runs on its OWN max:1 connection: `pg_stat_force_next_flush()`
  // only flushes the backend that ran the query, and keeping the shared pool
  // untouched keeps this test from perturbing the ones above.
  //
  // `enable_seqscan = off` is the same device the trigram plan test uses
  // (tests/store/retrieval.test.ts block (k)): at this fixture's row count a
  // sequential scan is cheaper whatever the predicate, so the question worth
  // asking is "CAN an index serve this predicate?", not "does the planner
  // prefer one over four rows?". The whole-column shape below stays on a Seq
  // Scan even with the setting off, because no index can serve it.
  // -------------------------------------------------------------------------
  it("answers: list({fileId}) is served by answers_filescope_gin, not a Seq Scan (W14 F-PERF V-2)", async () => {
    const solo = createDb({ url: TEST_DB_URL, max: 1, applicationName: "collex-v2-plan" });
    const soloLog: string[] = [];
    try {
      const fileId = "feedfacecafe0001";
      const scope = { fileIds: [fileId], includeCorpus: false };
      const store = new PgAnswerStore({ sql: solo, log: (l) => soloLog.push(l) });
      for (const runId of ["run-p1", "run-p2"]) {
        const base = answer(runId, "Belge sorusu " + runId);
        store.put({
          ...base,
          result: {
            ...(base.result as unknown as Record<string, unknown>),
            fileScope: scope,
          } as StoredAnswer["result"],
        });
      }
      store.put(answer("run-p3", "Korpus sorusu"));
      await store.flush();
      expect(soloLog).toEqual([]);
      // Enough rows that the planner has a real choice and makes it unaided.
      // Below a few hundred rows a sequential scan is cheaper whatever the
      // predicate, so a plan assertion there would measure the row count, not
      // the predicate. 1 000 is the smallest round number at which the probe
      // database's plan (Bitmap Index Scan, cost 17 against a 121-cost Seq
      // Scan at 2 030 rows) reproduces here. No planner setting is forced:
      // this asserts what the PRODUCT actually does on a real table.
      const filler = Array.from({ length: 1000 }, (_, i) => ({
        run_id: "run-bulk-" + String(i),
        tenant_id: LOCAL_TENANT_ID,
        question: "Toplu soru " + String(i),
        status: "ABSTAIN",
        result: JSON.stringify({
          fileScope: { fileIds: ["0000000000000" + String(i % 7) + "00"], includeCorpus: false },
        }),
        bundle: "{}",
      }));
      await solo`
        insert into app_private.answers ${solo(
          filler, "run_id", "tenant_id", "question", "status", "result", "bundle",
        )}`;
      await solo.unsafe("analyze app_private.answers");

      // (1) The product's own query moves the index counter.
      const readScans = async (): Promise<number> => {
        const rows = await solo`
          select coalesce(idx_scan, 0)::int as n
          from pg_stat_user_indexes
          where schemaname = 'app_private' and indexrelname = 'answers_filescope_gin'`;
        return rows[0] === undefined ? -1 : Number(rows[0]["n"]);
      };
      await solo`select pg_stat_force_next_flush()`;
      const before = await readScans();
      expect(before).toBeGreaterThanOrEqual(0); // the index exists at all
      const listed = await store.list({ fileId });
      await solo`select pg_stat_force_next_flush()`;
      const after = await readScans();
      expect(listed.map((s) => s.runId).sort()).toEqual(["run-p1", "run-p2"]);
      expect(after).toBeGreaterThan(before);

      // (2) The three shapes, explained. `sql.json(...)` is how the product
      // passes the needle; a pre-stringified value under `::jsonb` would be
      // double-encoded and match nothing (see answerStore's comment).
      const planOf = (rows: readonly Record<string, unknown>[]): string =>
        rows.map((r) => String(r["QUERY PLAN"])).join("\n");

      const productShape = planOf(await solo`
        explain (analyze, format text)
        select a.run_id from app_private.answers a
        where a.result -> 'fileScope' @> ${solo.json({ fileIds: [fileId] })}::jsonb`);
      expect(productShape).toMatch(/Bitmap Index Scan on answers_filescope_gin/);
      expect(productShape).toMatch(/rows=2/);

      const wholeColumnShape = planOf(await solo`
        explain (analyze, format text)
        select a.run_id from app_private.answers a
        where a.result @> ${solo.json({ fileScope: { fileIds: [fileId] } })}::jsonb`);
      expect(wholeColumnShape).toMatch(/Seq Scan on answers/);
      expect(wholeColumnShape).not.toMatch(/answers_filescope_gin/);

      // The shape the migration comment used to prescribe: index-using and
      // EMPTY, because `result -> 'fileScope'` is an object, not an array.
      const bareArrayShape = planOf(await solo`
        explain (analyze, format text)
        select a.run_id from app_private.answers a
        where a.result -> 'fileScope' @> ${solo.json([fileId])}::jsonb`);
      expect(bareArrayShape).toMatch(/Bitmap Index Scan on answers_filescope_gin/);
      expect(bareArrayShape).toMatch(/rows=0/);
    } finally {
      await solo.end({ timeout: 5 });
    }

    // (3) ...and the migration on disk no longer PRESCRIBES the empty shape.
    // Only the `comment on index` statement is read: the file's header keeps
    // the wrong shape on purpose, marked [WRONG], so the next reader learns
    // why it was wrong instead of rediscovering it.
    const migration = await readFile(
      path.join(MIGRATIONS_DIR, "20260903100000_ai_audit_and_scale_indexes.sql"),
      "utf8",
    );
    const start = migration.indexOf("comment on index app_private.answers_filescope_gin is");
    expect(start).toBeGreaterThan(-1);
    const indexComment = migration.slice(start, migration.indexOf(";", start));
    expect(indexComment).toContain(`result -> ''fileScope'' @> ''{"fileIds":["<id>"]}''::jsonb`);
    expect(indexComment).not.toContain(`@> ''["<id>"]''`);
    // The header's own prescription line is the corrected one, and the wrong
    // shape only ever appears behind the [WRONG] marker.
    expect(migration).toContain(`--   result -> 'fileScope' @> '{"fileIds":["<id>"]}'::jsonb`);
    expect(migration).not.toContain(`--   result -> 'fileScope' @> '["<id>"]'::jsonb`);
    expect(migration).toContain(`--   [WRONG]  result -> 'fileScope' @> '["<id>"]'::jsonb`);
  });
});

describe.skipIf(available)("persistence stores (environment unavailable)", () => {
  it("skips cleanly: scratch PostgreSQL at " + HOST_PORT + " is not reachable", () => {
    expect(available).toBe(false);
    expect(unavailableReason).not.toBe("");
  });
});
