/**
 * Exhaustive Matter analysis, end to end over HTTP against the REAL local
 * PostgreSQL: matter scope -> frozen census -> durable worker -> coverage.
 *
 * W20: POST no longer runs the analysis. It freezes the run (identity +
 * census, one transaction) and answers 202 with a run id; the durable worker
 * does the work; the client polls. These tests drive the worker explicitly
 * (`worker.drain()`), which is exactly what the background loop in
 * serve.mjs does, and assert the W19 guarantees still hold through it:
 *
 *   1. the census is DURABLE (units exist as rows before any result does);
 *   2. `processingCoverage.complete` reflects what was actually read, and an
 *      unreadable page makes it false;
 *   3. an unfinished run can never report complete coverage.
 *
 * The corpus is synthetic. This proves plumbing, never Turkish legal quality.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import { AnalysisWorker } from "../../src/exhaustive/worker.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { get, insertUpload, linkFiles, paragraphs, post } from "./durableFixtures.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

/** This lane owns its own scratch database (see testDb.ts::scratchDatabase). */
const SCRATCH = scratchDatabase("collex_exhaustive_test");

let sql: Sql;
let matters: MatterStore;
let store: PgDurableAnalysisStore;
let worker: AnalysisWorker;
let app: ReturnType<typeof createExhaustiveRouter>;

/** Start a run, let the worker finish it, and read the finished run back. */
async function analyze(matterId: string, body: unknown): Promise<{ started: any; run: any }> {
  const started = await post(app, `/v1/matters/${matterId}/analysis`, body);
  expect(started.status).toBe(202);
  await worker.drain();
  const run = await get(app, `/v1/matters/${matterId}/analysis/${started.body.runId}`);
  expect(run.status).toBe(200);
  return { started: started.body, run: run.body };
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);

  await insertUpload(sql, {
    fileId: "aaaa1111",
    title: "Dava dilekçesi",
    blocks: paragraphs(["Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir."], 12),
  });
  await insertUpload(sql, {
    fileId: "bbbb2222",
    title: "Bilirkişi raporu",
    blocks: paragraphs(["İnceleme sonucunda ödenen kira bedeli 32.000 TL olarak tespit edilmiştir."], 12),
  });
  await insertUpload(sql, {
    fileId: "cccc3333",
    title: "Taranmış ek",
    blocks: paragraphs(["Ekte sunulan belge dosyaya konulmuştur."], 4),
    unreadablePage: true,
  });

  // The REAL matter store: runs carry a foreign key to app_private.matters.
  matters = new PgMatterStore({ sql });
  store = new PgDurableAnalysisStore(sql);
  worker = new AnalysisWorker({ store, retryBackoffMs: 0 });
  app = createExhaustiveRouter({ store, matters });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("POST /v1/matters/{id}/analysis", () => {
  it("answers 202 with a frozen census and does NOT do the work in the request", async () => {
    const matter = await matters.create({ title: "Zaman uyumsuz" });
    await linkFiles(matters, matter.id, ["aaaa1111", "bbbb2222"]);

    const { status, body } = await post(app, `/v1/matters/${matter.id}/analysis`, {
      task: "contradictions",
    });

    expect(status).toBe(202);
    expect(body.status).toBe("queued");
    expect(body.resumed).toBe(false);
    // The census exists as rows before any unit is processed...
    expect(body.progress.total).toBeGreaterThan(0);
    expect(body.progress.pending).toBe(body.progress.total);
    // ...and a run nobody has worked on can NEVER claim complete coverage.
    expect(body.processingCoverage.complete).toBe(false);
    expect(body.processingCoverage.analysisUnitsProcessed).toBe(0);
    expect(body.processingCoverage.gaps).toContainEqual(
      expect.objectContaining({ reason: "UNIT_NOT_PROCESSED" }),
    );
    expect(body.exhaustiveClaimRefusedBecause).toContain("henüz işlenmedi");
    await worker.drain();
  });

  it("reviews the WHOLE matter and reports complete coverage", async () => {
    const matter = await matters.create({ title: "Kira davası" });
    await linkFiles(matters, matter.id, ["aaaa1111", "bbbb2222"]);

    const { run } = await analyze(matter.id, { task: "contradictions" });

    expect(run.status).toBe("done");
    const coverage = run.processingCoverage;
    expect(coverage.filesTotal).toBe(2);
    expect(coverage.filesProcessed).toBe(2);
    expect(coverage.pagesTotal).toBe(2);
    expect(coverage.pagesUnreadable).toBe(0);
    expect(coverage.analysisUnitsProcessed).toBe(coverage.analysisUnitsTotal);
    expect(coverage.analysisUnitsTotal).toBeGreaterThan(0);
    expect(coverage.complete).toBe(true);
    expect(run.coverageSummary).toContain("tamamı okundu");
    expect(run.exhaustiveClaimRefusedBecause).toBeNull();
    expect(run.stale).toBe(false);
  });

  it("finds the contradiction planted in two different documents", async () => {
    const matter = await matters.create({ title: "Kira davası 2" });
    await linkFiles(matters, matter.id, ["aaaa1111", "bbbb2222"]);

    const { started } = await analyze(matter.id, { task: "contradictions" });
    const findings = await get(app, `/v1/matters/${matter.id}/analysis/${started.runId}/findings`);
    expect(findings.status).toBe(200);

    const contradictions = findings.body.relations.filter(
      (r: { relation: string }) => r.relation === "CONTRADICTION",
    );
    expect(contradictions.length).toBeGreaterThan(0);
    const crossDocument = contradictions.find(
      (r: { left: { fileId: string }; right: { fileId: string } }) =>
        r.left.fileId !== r.right.fileId,
    );
    expect(crossDocument).toBeDefined();
    expect(crossDocument.rationale).toContain("İkisi birden doğru olamaz");

    // The same contradiction is a Matter Intelligence item with both spans.
    const item = findings.body.items.find((i: { kind: string }) => i.kind === "contradiction");
    expect(item).toBeDefined();
    expect(item.sources.length).toBe(2);
    for (const source of item.sources) {
      expect(source.quoteSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(source.locator).toBe("s. 1");
    }
  });

  it("writes a DURABLE census: units are rows, observations keep provenance", async () => {
    const matter = await matters.create({ title: "Kalıcı sayım" });
    await linkFiles(matters, matter.id, ["aaaa1111"]);
    const { started, run } = await analyze(matter.id, { task: "contradictions" });

    const rows = await sql`
      select state, count(*)::int as n
      from app_private.matter_analysis_units
      where run_id = ${started.runId}::uuid
      group by state`;
    const byState = new Map(rows.map((r) => [String(r["state"]), Number(r["n"])]));
    expect(byState.get("done")).toBe(run.processingCoverage.analysisUnitsTotal);

    const observations = await sql`
      select o.quote, o.quote_sha256, o.locator, o.start_char, o.end_char,
             o.observation_key,
             substring(v.canonical_text from o.start_char + 1
                       for o.end_char - o.start_char) as slice
      from app_private.matter_observations o
      join legal.document_versions v on v.id = o.document_version_id
      where o.run_id = ${started.runId}::uuid`;
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(String(observation["quote_sha256"])).toMatch(/^[0-9a-f]{64}$/u);
      expect(String(observation["observation_key"])).toMatch(/^[0-9a-f]{64}$/u);
      expect(String(observation["locator"])).toBe("s. 1");
      // The offsets slice the stored canonical text back to the quote.
      expect(String(observation["slice"])).toBe(String(observation["quote"]));
    }
  });

  it("an unreadable page makes coverage incomplete and is itemized", async () => {
    const matter = await matters.create({ title: "Taranmış ek dosyası" });
    await linkFiles(matters, matter.id, ["aaaa1111", "cccc3333"]);

    const { run } = await analyze(matter.id, { task: "contradictions" });

    expect(run.processingCoverage.complete).toBe(false);
    expect(run.processingCoverage.pagesUnreadable).toBe(1);
    expect(run.processingCoverage.gaps).toContainEqual(
      expect.objectContaining({ locator: "s. 2", reason: "UNREADABLE_NO_TEXT" }),
    );
    expect(run.coverageSummary).not.toContain("tamamı okundu");
    expect(run.exhaustiveClaimRefusedBecause).toContain("okunamadı");
  });

  it("a SECOND analysis of an unchanged matter returns the SAME findings", async () => {
    // Reuse across FINISHED runs once returned complete coverage with zero
    // findings. A finished run is never resumed: a new request after it is a
    // new run with its own complete extraction.
    const matter = await matters.create({ title: "Yeniden çalıştırma" });
    await linkFiles(matters, matter.id, ["aaaa1111", "bbbb2222"]);
    const first = await analyze(matter.id, { task: "contradictions" });
    const second = await analyze(matter.id, { task: "contradictions" });

    expect(second.started.runId).not.toBe(first.started.runId);
    expect(second.started.resumed).toBe(false);
    expect(second.run.processingCoverage).toEqual(first.run.processingCoverage);
    expect(second.run.processingCoverage.complete).toBe(true);
    expect(first.run.summary.observations).toBeGreaterThan(0);
    expect(second.run.summary.observations).toBe(first.run.summary.observations);
    expect(second.run.summary.relations).toEqual(first.run.summary.relations);

    const stored = await sql`
      select count(*)::int as n from app_private.matter_observations
      where run_id = ${second.started.runId}::uuid`;
    expect(Number(stored[0]!["n"])).toBe(second.run.summary.observations);
  });

  it("refuses a matter with no documents instead of reporting a clean run", async () => {
    const matter = await matters.create({ title: "Boş dosya" });
    const { status, body } = await post(app, `/v1/matters/${matter.id}/analysis`, {});
    expect(status).toBe(409);
    expect(body.error.kind).toBe("MATTER_EMPTY");
  });

  it("refuses a file that is not linked to the matter", async () => {
    const matter = await matters.create({ title: "Kapsam dışı" });
    await linkFiles(matters, matter.id, ["aaaa1111"]);
    const { status, body } = await post(app, `/v1/matters/${matter.id}/analysis`, {
      task: "contradictions",
      fileIds: ["bbbb2222"],
    });
    expect(status).toBe(409);
    expect(body.error.kind).toBe("FILES_OUTSIDE_MATTER");
  });

  it("an unknown matter is 404, never an empty review", async () => {
    const { status } = await post(
      app,
      "/v1/matters/11111111-2222-3333-4444-555555555555/analysis",
      { task: "contradictions" },
    );
    expect(status).toBe(404);
  });

  it("rejects an unknown field rather than ignoring it", async () => {
    const matter = await matters.create({ title: "Katı doğrulama" });
    await linkFiles(matters, matter.id, ["aaaa1111"]);
    const { status, body } = await post(app, `/v1/matters/${matter.id}/analysis`, {
      task: "contradictions",
      derinlik: 9,
    });
    expect(status).toBe(400);
    expect(body.error.kind).toBe("INVALID_REQUEST");
  });

  it("findings of an unfinished run are refused, not served half-made", async () => {
    const matter = await matters.create({ title: "Bitmemiş" });
    await linkFiles(matters, matter.id, ["aaaa1111"]);
    const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "contradictions" });
    const findings = await get(app, `/v1/matters/${matter.id}/analysis/${started.body.runId}/findings`);
    expect(findings.status).toBe(409);
    expect(findings.body.error.kind).toBe("RUN_NOT_FINISHED");
    await worker.drain();
  });
});

describe("GET /v1/matters/{id}/analysis", () => {
  it("lists runs and replays the stored coverage verbatim", async () => {
    const matter = await matters.create({ title: "Geçmiş" });
    await linkFiles(matters, matter.id, ["aaaa1111"]);
    const { started, run } = await analyze(matter.id, { task: "contradictions" });

    const list = await get(app, `/v1/matters/${matter.id}/analysis`);
    expect(list.status).toBe(200);
    expect(list.body.runs.some((r: { runId: string }) => r.runId === started.runId)).toBe(true);

    const again = await get(app, `/v1/matters/${matter.id}/analysis/${started.runId}`);
    expect(again.body.status).toBe("done");
    expect(again.body.processingCoverage).toEqual(run.processingCoverage);
    expect(again.body.coverageSummary).toBe(run.coverageSummary);
  });

  it("a run id from another matter is not readable through this matter", async () => {
    const a = await matters.create({ title: "A" });
    const b = await matters.create({ title: "B" });
    await linkFiles(matters, a.id, ["aaaa1111"]);
    const { started } = await analyze(a.id, { task: "contradictions" });

    const wrong = await get(app, `/v1/matters/${b.id}/analysis/${started.runId}`);
    expect(wrong.status).toBe(404);
    const wrongFindings = await get(app, `/v1/matters/${b.id}/analysis/${started.runId}/findings`);
    expect(wrongFindings.status).toBe(404);
  });
});
