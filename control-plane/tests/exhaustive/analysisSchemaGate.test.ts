/**
 * W21 round-two review · R2-20 — the analysis worker starts only on a schema
 * that has every object it uses.
 *
 * WHAT WENT WRONG. serve.mjs gated its workers on the W20 tables
 * (matter_intel_items, chunk_vectors, review_table_cells). On a database
 * with the W20 migrations but not 20260913090000_analysis_stages.sql that
 * gate passed, the W21 worker started, and every tick failed on the missing
 * matter_analysis_tasks relation — logged every second, forever — while
 * POST /analysis inserted a run and answered 500 and no run ever moved.
 *
 * WHAT THESE TESTS PIN. `checkAnalysisSchema` probes every object the worker
 * uses (not the ledger); the list of migrations it covers cannot silently
 * miss a new one; and the two real entry points (serve.mjs, spawned for
 * real, and analysis_worker.mjs) keep the worker off on a W20-only schema
 * and say why in Turkish.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "../../src/store/db.js";
import {
  ANALYSIS_WORKER_MIGRATIONS,
  checkAnalysisSchema,
} from "../../src/store/health.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_w21_schema_gate_test");
const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const SERVE = join(REPO_ROOT, "control-plane", "scripts", "serve.mjs");
const WORKER = join(REPO_ROOT, "control-plane", "scripts", "analysis_worker.mjs");
const VENV_PYTHON =
  process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
const venvPresent = existsSync(VENV_PYTHON);
/** This suite's own port (serve.test.ts owns 8817-8819). */
const PORT = 8827;
/**
 * serve.mjs writes collex.pid and polls collex.stop in its DATA directory:
 * never the repository's `var/`, which a running product server owns.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), "collex-schema-gate-"));

let sql: Sql;

interface Spawned {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function spawnNode(script: string, args: string[]): Spawned {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, COLLEX_DATA_DIR: DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8"); });
  const exited = new Promise<number | null>((resolvePromise) => child.once("exit", (code) => resolvePromise(code)));
  return { child, output: () => buffer, exited };
}

async function killAndWait(spawned: Spawned): Promise<void> {
  if (spawned.child.exitCode === null) spawned.child.kill();
  await Promise.race([spawned.exited, new Promise((r) => setTimeout(r, 5_000))]);
  if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL");
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

/** Remove what 20260913090000_analysis_stages.sql added: a W20-only analysis schema. */
async function dropAnalysisStages(target: Sql): Promise<void> {
  await target`drop table if exists app_private.matter_analysis_tasks`;
  await target`
    alter table app_private.matter_analysis_runs
      drop column if exists extraction_coverage,
      drop column if exists intelligence_coverage`;
  await target`
    alter table app_private.matter_analysis_units
      drop column if exists repair_passes`;
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("R2-20: checkAnalysisSchema probes what the W21 worker uses", () => {
  it("every migration that touches the analysis tables is in the gate's list", () => {
    const dir = join(REPO_ROOT, "supabase", "migrations");
    const touching = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => /matter_analysis_|matter_observation|matter_intel_/u.test(readFileSync(join(dir, name), "utf8")));
    expect(touching.length).toBeGreaterThan(0);
    for (const name of touching) expect(ANALYSIS_WORKER_MIGRATIONS).toContain(name);
    expect(ANALYSIS_WORKER_MIGRATIONS).toContain("20260913090000_analysis_stages.sql");
  });

  it("a fully migrated database is ready", async () => {
    expect(await checkAnalysisSchema(sql)).toEqual({ ready: true, missing: [] });
  });

  it("a W20-only schema is NOT ready and names the missing objects (the W20 tables alone passed the old gate)", async () => {
    const ROLLBACK = new Error("rollback");
    let seen: Awaited<ReturnType<typeof checkAnalysisSchema>> | undefined;
    let w20Gate: unknown;
    await sql
      .begin(async (tx) => {
        const t = tx as unknown as Sql;
        await dropAnalysisStages(t);
        // The pre-fix gate, verbatim: it still says yes on this schema.
        const rows = await t`select to_regclass('app_private.matter_intel_items') is not null
                 and to_regclass('app_private.chunk_vectors') is not null
                 and to_regclass('app_private.review_table_cells') is not null as ok`;
        w20Gate = rows[0]?.["ok"];
        seen = await checkAnalysisSchema(t);
        throw ROLLBACK;
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error;
      });
    expect(w20Gate).toBe(true);
    expect(seen?.ready).toBe(false);
    expect(seen?.missing).toContain("regclass:app_private.matter_analysis_tasks");
    expect(seen?.missing).toContain("column:app_private.matter_analysis_runs.intelligence_coverage");
    expect(seen?.missing).toContain("column:app_private.matter_analysis_units.repair_passes");
    // Rolled back: the database is whole again.
    expect((await checkAnalysisSchema(sql)).ready).toBe(true);
  });
});

describe.skipIf(!venvPresent)("R2-20: the real entry points on a W20-only schema", () => {
  const running: Spawned[] = [];
  afterAll(async () => {
    for (const spawned of running.splice(0)) await killAndWait(spawned);
  });

  it("serve.mjs starts, keeps the analysis worker OFF with a Turkish reason, and never logs a failing tick", { timeout: 90_000 }, async () => {
    await dropAnalysisStages(sql);
    const spawned = spawnNode(SERVE, ["--port", String(PORT), "--dsn", SCRATCH.url]);
    running.push(spawned);
    const health = await waitFor(async () => {
      if (spawned.child.exitCode !== null) return { status: -1 };
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/v1/health`, { signal: AbortSignal.timeout(1_000) });
        return { status: res.status };
      } catch {
        return undefined;
      }
    }, 30_000);
    expect(health?.status, spawned.output()).toBe(200);
    // Several poll intervals of the worker (1 s): before the fix each one
    // logged `analiz: {"event":"tick-failed",...}`.
    await new Promise((r) => setTimeout(r, 3_500));
    const output = spawned.output();
    expect(output).toContain("dosya incelemesi (analiz aşamaları) için veritabanı şeması eksik");
    expect(output).toContain("regclass:app_private.matter_analysis_tasks");
    expect(output).toContain("dosya incelemesi işi kapalı");
    expect(output).not.toContain("tick-failed");
    await killAndWait(spawned);
  });

  it("analysis_worker.mjs refuses to start and says which objects are missing", { timeout: 60_000 }, async () => {
    await dropAnalysisStages(sql);
    const spawned = spawnNode(WORKER, ["--dsn", SCRATCH.url, "--once"]);
    running.push(spawned);
    const code = await Promise.race([spawned.exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 45_000))]);
    expect(code, spawned.output()).toBe(1);
    expect(spawned.output()).toContain("analiz çalışanı başlatılmadı: veritabanı şeması eksik");
    expect(spawned.output()).toContain("matter_analysis_tasks");
    expect(spawned.output()).not.toContain("tick-failed");
  });
});
