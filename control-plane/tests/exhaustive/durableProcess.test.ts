/**
 * W20 acceptance A, with a REAL process: kill the worker PROCESS mid-run.
 *
 * durableRun.test.ts proves resumption by abandoning a worker object. That is
 * close, but an object in the same process shares a heap, a connection pool
 * and an event loop with its successor. Here the first worker is a separate
 * Node process (`scripts/analysis_worker.mjs`, the same entry point an
 * operator can run), and it is terminated with SIGKILL — on Windows
 * TerminateProcess — with no chance to clean up. Everything the successor
 * knows it reads from the database.
 *
 * Asserted:
 *   - units finished before the kill stay done with their observations;
 *   - the successor never re-reads them (its extractor sees only the rest);
 *   - the final stored findings equal an uninterrupted run's;
 *   - no observation is stored twice.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import { AnalysisWorker } from "../../src/exhaustive/worker.js";
import { extractPropositions } from "../../src/exhaustive/observations.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { insertUpload, linkFiles, paragraphs, post, sha256, sleep } from "./durableFixtures.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_durable_process_test");
const WORKER_SCRIPT = fileURLToPath(new URL("../../scripts/analysis_worker.mjs", import.meta.url));

let sql: Sql;
let matters: MatterStore;
let store: PgDurableAnalysisStore;
let app: ReturnType<typeof createExhaustiveRouter>;

async function tuples(runId: string): Promise<string[]> {
  const rows = await sql`
    select file_id, unit_no, kind, start_char, end_char, quote_sha256,
           metadata->>'normalizedValue' as value
    from app_private.matter_observations where run_id = ${runId}::uuid`;
  return rows
    .map((r) => `${r["file_id"]}|${r["unit_no"]}|${r["kind"]}|${r["start_char"]}|${r["end_char"]}|${r["quote_sha256"]}|${r["value"]}`)
    .sort();
}

/**
 * Units are identified by NUMBER, not by text hash: two documents with the
 * same boilerplate produce byte-identical units, and a hash set would
 * conflate them (the W19 hash-only reuse bug, in test form).
 */
async function doneUnits(runId: string): Promise<Set<number>> {
  const rows = await sql`
    select unit_no from app_private.matter_analysis_units
    where run_id = ${runId}::uuid and state = 'done'`;
  return new Set(rows.map((r) => Number(r["unit_no"])));
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, {
    fileId: "proc-aaa",
    title: "Dilekçe",
    blocks: paragraphs(
      [
        "Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir.",
        "Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır.",
      ],
      48,
    ),
  });
  await insertUpload(sql, {
    fileId: "proc-bbb",
    title: "Rapor",
    blocks: paragraphs(
      [
        "İnceleme sonucunda ödenen kira bedeli 32.000 TL olarak tespit edilmiştir.",
        "Kira sözleşmesi 01.05.2023 tarihinde imzalanmıştır.",
      ],
      48,
    ),
  });
  matters = new PgMatterStore({ sql });
  store = new PgDurableAnalysisStore(sql);
  app = createExhaustiveRouter({ store, matters });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("A: a killed worker PROCESS", () => {
  it("loses nothing, recomputes nothing, and the successor ends identical", async () => {
    const reference = await (async () => {
      const matter = await matters.create({ title: "Kesintisiz (süreç)" });
      await linkFiles(matters, matter.id, ["proc-aaa", "proc-bbb"]);
      const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "contradictions" });
      await new AnalysisWorker({ store }).drain();
      return started.body.runId as string;
    })();

    const matter = await matters.create({ title: "Öldürülen süreç" });
    await linkFiles(matters, matter.id, ["proc-aaa", "proc-bbb"]);
    const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "contradictions" });
    const runId = started.body.runId as string;
    const total = started.body.progress.total as number;
    expect(total).toBeGreaterThanOrEqual(6);

    const child = spawn(
      process.execPath,
      [
        WORKER_SCRIPT,
        "--dsn", SCRATCH.url,
        "--batch", "1",
        "--lease-ms", "1500",
        "--poll-ms", "100",
        "--pause-ms", "300",
        "--worker-id", "child-worker",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COLLEX_NO_DOTENV: "1" } },
    );
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    // Wait until the child has durably finished some — but not all — units.
    const deadline = Date.now() + 90_000;
    let done = 0;
    while (Date.now() < deadline) {
      done = (await doneUnits(runId)).size;
      if (done >= 3) break;
      // A child that exits on its own is a broken worker, not a slow one.
      if (child.exitCode !== null) {
        throw new Error(`worker exited early (${child.exitCode}): ${stdout.slice(-500)} ${stderr.slice(-500)}`);
      }
      await sleep(50);
    }
    const exited = child.exitCode !== null;
    child.kill("SIGKILL");
    if (!exited) await once(child, "exit");
    expect(stderr).toBe("");
    const atKill = await doneUnits(runId);
    expect(atKill.size).toBeGreaterThanOrEqual(3);
    expect(atKill.size).toBeLessThan(total);

    // The successor: this process, a new pool, a new store, a new worker.
    await sleep(1_700); // any lease the child held expires
    const freshSql = connectTestDb(SCRATCH);
    const read: string[] = [];
    const processedUnits: number[] = [];
    try {
      await new AnalysisWorker({
        store: new PgDurableAnalysisStore(freshSql),
        workerId: "successor",
        hooks: { beforeUnit: (claim) => void processedUnits.push(claim.unitNo) },
        extractDeterministic: (unitText) => {
          read.push(sha256(unitText));
          return extractPropositions(unitText);
        },
      }).drain();
    } finally {
      await freshSql.end({ timeout: 5 });
    }

    // The successor's extractor ran exactly once per unfinished unit, and on
    // none of the units the killed process had finished.
    for (const unitNo of processedUnits) expect(atKill.has(unitNo)).toBe(false);
    expect(processedUnits.length).toBe(total - atKill.size);
    expect(read.length).toBe(total - atKill.size);

    const run = await sql`
      select status, coverage from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
    expect(run[0]!["status"]).toBe("done");
    expect((run[0]!["coverage"] as { complete: boolean }).complete).toBe(true);
    expect(await tuples(runId)).toEqual(await tuples(reference));
    const duplicates = await sql`
      select count(*)::int - count(distinct observation_key)::int as dup
      from app_private.matter_observations where run_id = ${runId}::uuid`;
    expect(Number(duplicates[0]!["dup"])).toBe(0);
  });
});
