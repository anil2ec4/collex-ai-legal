/**
 * W20 acceptance A-E: durable, resumable, idempotent exhaustive runs —
 * proven THROUGH PERSISTENCE against the real local PostgreSQL.
 *
 *   A  REAL CRASH RESUME   a worker "dies" half-way (its claim is left
 *                          running under a lease); a FRESH worker on a NEW
 *                          connection pool continues and never re-reads the
 *                          units the dead one finished.
 *   B  RESUMED FINDINGS    the resumed run's stored observations, relations
 *                          and Matter Intelligence equal an uninterrupted
 *                          run's over the same text.
 *   C  NO DUPLICATES       a unit processed twice (re-queued after commit,
 *                          or finished late by a worker whose lease was taken
 *                          over) is stored once.
 *   D  TASK ISOLATION      a chronology request never resumes a
 *                          contradictions run.
 *   E  VERSION SNAPSHOT    a new upload of a file while a run is interrupted
 *                          does not leak into that run; the result is marked
 *                          stale and a new request gets a new run.
 *
 * Plus: cancellation, terminal failure after the retry budget, and the
 * database refusing a Matter Intelligence item with no source span.
 *
 * A separate suite (durableProcess.test.ts) kills a real OS process.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { LeaseLostError, PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import { AnalysisWorker, WorkerAbort } from "../../src/exhaustive/worker.js";
import { extractPropositions } from "../../src/exhaustive/observations.js";
import { LOCAL_TENANT_ID } from "../../src/exhaustive/store.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import {
  get,
  insertNewVersion,
  insertUpload,
  linkFiles,
  paragraphs,
  post,
  sha256,
  sleep,
} from "./durableFixtures.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_durable_test");

let sql: Sql;
let matters: MatterStore;
let store: PgDurableAnalysisStore;
let app: ReturnType<typeof createExhaustiveRouter>;
let replaced: { documentId: string; versionId: string };

const PLANTED_A = [
  "Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir.",
  "Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır.",
  "Temerrüt faizi oranı %9 olarak uygulanmıştır.",
  "Tahliye ihtarı 11.03.2024 tarihinde tebliğ edilmiştir.",
];
const PLANTED_B = [
  "İnceleme sonucunda ödenen kira bedeli 32.000 TL olarak tespit edilmiştir.",
  "Kira sözleşmesi 01.05.2023 tarihinde imzalanmıştır.",
  "Temerrüt faizi oranı %12 olarak uygulanmıştır.",
];

function app_(): ReturnType<typeof createExhaustiveRouter> {
  return app;
}

async function newMatter(title: string, fileIds: readonly string[]): Promise<string> {
  const matter = await matters.create({ title });
  await linkFiles(matters, matter.id, fileIds);
  return matter.id;
}

async function start(matterId: string, body: unknown): Promise<any> {
  const response = await post(app_(), `/v1/matters/${matterId}/analysis`, body);
  expect(response.status).toBe(202);
  return response.body;
}

/** Run-independent identity of every stored observation. */
async function observationTuples(runId: string): Promise<string[]> {
  const rows = await sql`
    select file_id, unit_no, kind, start_char, end_char, quote_sha256,
           metadata->>'normalizedValue' as value
    from app_private.matter_observations where run_id = ${runId}::uuid`;
  return rows
    .map((r) => `${r["file_id"]}|${r["unit_no"]}|${r["kind"]}|${r["start_char"]}|${r["end_char"]}|${r["quote_sha256"]}|${r["value"]}`)
    .sort();
}

async function relationTuples(runId: string): Promise<string[]> {
  const rows = await sql`
    select r.relation, lo.file_id as lf, lo.start_char as ls, ro.file_id as rf, ro.start_char as rs
    from app_private.matter_observation_relations r
    join app_private.matter_observations lo on lo.observation_id = r.left_observation_id
    join app_private.matter_observations ro on ro.observation_id = r.right_observation_id
    where r.run_id = ${runId}::uuid`;
  return rows.map((r) => `${r["relation"]}|${r["lf"]}:${r["ls"]}|${r["rf"]}:${r["rs"]}`).sort();
}

async function itemTuples(runId: string): Promise<string[]> {
  const rows = await sql`
    select i.item_kind, i.title,
           string_agg(o.file_id || ':' || o.start_char || ':' || s.role, ',' order by o.file_id, o.start_char, s.role) as sources
    from app_private.matter_intel_items i
    join app_private.matter_intel_sources s on s.item_id = i.item_id
    join app_private.matter_observations o on o.observation_id = s.observation_id
    where i.run_id = ${runId}::uuid
    group by i.item_id, i.item_kind, i.title`;
  return rows.map((r) => `${r["item_kind"]}|${r["title"]}|${r["sources"]}`).sort();
}

async function duplicateKeys(runId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int - count(distinct observation_key)::int as dup
    from app_private.matter_observations where run_id = ${runId}::uuid`;
  return Number(rows[0]!["dup"]);
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, { fileId: "dur-aaa", title: "Dilekçe", blocks: paragraphs(PLANTED_A, 40) });
  await insertUpload(sql, { fileId: "dur-bbb", title: "Rapor", blocks: paragraphs(PLANTED_B, 40) });
  await insertUpload(sql, {
    fileId: "dur-poison",
    title: "Bozuk bölüm",
    blocks: paragraphs(["ZEHİRLİ PARAGRAF: bu bölüm her denemede başarısız olur."], 8),
  });
  replaced = await insertUpload(sql, {
    fileId: "dur-swap",
    title: "Değişecek belge",
    blocks: paragraphs(["Eski sürümde tutar 10.000 TL olarak yazılmıştır."], 20),
  });
  matters = new PgMatterStore({ sql });
  store = new PgDurableAnalysisStore(sql);
  app = createExhaustiveRouter({ store, matters });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("A/B/C: crash resume through persistence", () => {
  it("a fresh worker continues after process death, recomputes nothing, and ends identical", async () => {
    // Reference: the same text, uninterrupted.
    const refMatter = await newMatter("Kesintisiz", ["dur-aaa", "dur-bbb"]);
    const reference = await start(refMatter, { task: "contradictions" });
    await new AnalysisWorker({ store }).drain();

    // The run that will be interrupted.
    const matterId = await newMatter("Kesintili", ["dur-aaa", "dur-bbb"]);
    const run = await start(matterId, { task: "contradictions" });
    const total = run.progress.total as number;
    expect(total).toBeGreaterThanOrEqual(6);
    const half = Math.floor(total / 2);

    // Worker 1 finishes `half` units, then "dies" on the next one: the
    // abort escapes the worker, leaving that unit RUNNING under its lease —
    // precisely the state a killed process leaves behind.
    let finished = 0;
    const dying = new AnalysisWorker({
      store: new PgDurableAnalysisStore(sql),
      workerId: "worker-that-dies",
      batchSize: 1,
      unitLeaseMs: 400,
      hooks: {
        beforeUnit: () => {
          if (finished === half) throw new WorkerAbort();
        },
        afterUnit: () => {
          finished += 1;
        },
      },
    });
    await expect(dying.drain()).rejects.toBeInstanceOf(WorkerAbort);

    const afterDeath = await store.progress(run.runId);
    expect(afterDeath.done).toBe(half);
    expect(afterDeath.running).toBe(1);
    expect(afterDeath.pending).toBe(total - half - 1);
    // The first half's observations are already durable.
    const persistedBefore = await sql`
      select count(*)::int as n from app_private.matter_observations
      where run_id = ${run.runId}::uuid`;
    expect(Number(persistedBefore[0]!["n"])).toBeGreaterThan(0);
    // Identified by NUMBER: identical boilerplate units share a text hash.
    const doneBefore = await sql`
      select unit_no from app_private.matter_analysis_units
      where run_id = ${run.runId}::uuid and state = 'done'`;
    const doneUnitNos = new Set(doneBefore.map((r) => Number(r["unit_no"])));

    // A NEW process: new connection pool, new store, new worker object.
    await sleep(600); // the dead worker's lease expires
    const freshSql = connectTestDb(SCRATCH);
    try {
      const readUnits: string[] = [];
      const processedUnits: number[] = [];
      const fresh = new AnalysisWorker({
        store: new PgDurableAnalysisStore(freshSql),
        workerId: "fresh-worker",
        hooks: { beforeUnit: (claim) => void processedUnits.push(claim.unitNo) },
        extractDeterministic: (unitText) => {
          readUnits.push(sha256(unitText));
          return extractPropositions(unitText);
        },
      });
      await fresh.drain();

      // Only the unfinished units were read again — never the first half.
      expect(readUnits.length).toBe(total - half);
      expect(processedUnits.length).toBe(total - half);
      for (const unitNo of processedUnits) expect(doneUnitNos.has(unitNo)).toBe(false);
    } finally {
      await freshSql.end({ timeout: 5 });
    }

    const finishedRun = await get(app_(), `/v1/matters/${matterId}/analysis/${run.runId}`);
    expect(finishedRun.body.status).toBe("done");
    expect(finishedRun.body.processingCoverage.complete).toBe(true);

    // B: the resumed run's stored results equal the uninterrupted run's.
    expect(await observationTuples(run.runId)).toEqual(await observationTuples(reference.runId));
    expect(await relationTuples(run.runId)).toEqual(await relationTuples(reference.runId));
    expect(await itemTuples(run.runId)).toEqual(await itemTuples(reference.runId));
    expect((await relationTuples(run.runId)).length).toBeGreaterThan(0);
    // C: and nothing was stored twice.
    expect(await duplicateKeys(run.runId)).toBe(0);
  });

  it("re-processing a finished unit (lost acknowledgement) does not duplicate findings", async () => {
    const matterId = await newMatter("Tekrar işleme", ["dur-aaa"]);
    const run = await start(matterId, { task: "contradictions" });
    await new AnalysisWorker({ store }).drain();
    const before = await observationTuples(run.runId);
    expect(before.length).toBeGreaterThan(0);

    // Force one unit back to pending (as if its commit acknowledgement were
    // lost and the unit re-queued) and the run back to mapping.
    await sql`
      update app_private.matter_analysis_units set state = 'pending'
      where run_id = ${run.runId}::uuid and unit_no = 1`;
    await sql`
      update app_private.matter_analysis_runs set status = 'mapping', finished_at = null
      where run_id = ${run.runId}::uuid`;
    await new AnalysisWorker({ store }).drain();

    expect(await observationTuples(run.runId)).toEqual(before);
    expect(await duplicateKeys(run.runId)).toBe(0);
  });

  it("a worker that lost its lease cannot mark the unit done", async () => {
    const matterId = await newMatter("Kiralama kaybı", ["dur-bbb"]);
    const run = await start(matterId, { task: "contradictions" });
    const [slowClaim] = await store.claimUnits("slow-worker", 1, 200);
    expect(slowClaim).toBeDefined();
    await sleep(350);
    // Another worker recovers the stale lease and finishes everything.
    await new AnalysisWorker({ store, workerId: "fast-worker" }).drain();

    await expect(
      store.completeUnit(slowClaim!, "slow-worker", [], {
        rejectedQuotes: 0,
        invalidItems: 0,
        extractorVersion: "extract-v2",
      }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(await duplicateKeys(run.runId)).toBe(0);
  });
});

describe("D: task isolation", () => {
  it("a chronology request never resumes a contradictions run", async () => {
    const matterId = await newMatter("Görev ayrımı", ["dur-aaa"]);
    const contradictions = await start(matterId, { task: "contradictions" });
    const chronology = await start(matterId, { task: "chronology" });
    expect(chronology.runId).not.toBe(contradictions.runId);
    expect(chronology.resumed).toBe(false);

    // The SAME work does join the active run instead of a second census.
    const again = await start(matterId, { task: "contradictions" });
    expect(again.runId).toBe(contradictions.runId);
    expect(again.resumed).toBe(true);
    const runs = await sql`
      select count(*)::int as n from app_private.matter_analysis_runs
      where matter_id = ${matterId}::uuid`;
    expect(Number(runs[0]!["n"])).toBe(2);
    await new AnalysisWorker({ store }).drain();
  });
});

describe("E: version snapshot", () => {
  it("a re-upload during an interrupted run does not leak into it", async () => {
    const matterId = await newMatter("Sürüm anlık görüntüsü", ["dur-swap"]);
    const oldVersion = replaced.versionId;
    const run = await start(matterId, { task: "contradictions" });

    // The file is re-uploaded while the run has not been worked on.
    const newVersion = await insertNewVersion(
      sql,
      replaced.documentId,
      "dur-swap",
      "v2",
      paragraphs(["Yeni sürümde tutar 99.000 TL olarak yazılmıştır."], 20),
    );
    await new AnalysisWorker({ store }).drain();

    // Every unit and every observation of the run names the OLD version.
    const versions = await sql`
      select distinct document_version_id::text as v from app_private.matter_observations
      where run_id = ${run.runId}::uuid
      union
      select distinct document_version_id::text from app_private.matter_analysis_units
      where run_id = ${run.runId}::uuid`;
    expect(versions.map((r) => String(r["v"]))).toEqual([oldVersion]);
    const quotes = await sql`
      select quote from app_private.matter_observations where run_id = ${run.runId}::uuid`;
    expect(quotes.some((r) => String(r["quote"]).includes("99.000"))).toBe(false);

    // The finished run is honest about being over an old version.
    const view = await get(app_(), `/v1/matters/${matterId}/analysis/${run.runId}`);
    expect(view.body.stale).toBe(true);
    expect(view.body.sourceChanged).toEqual(["dur-swap"]);

    // A new request has a different identity and reads the NEW version.
    const rerun = await start(matterId, { task: "contradictions" });
    expect(rerun.runId).not.toBe(run.runId);
    await new AnalysisWorker({ store }).drain();
    const newVersions = await sql`
      select distinct document_version_id::text as v from app_private.matter_analysis_units
      where run_id = ${rerun.runId}::uuid`;
    expect(newVersions.map((r) => String(r["v"]))).toEqual([newVersion]);
    const intelligence = await get(app_(), `/v1/matters/${matterId}/intelligence`);
    const latest = intelligence.body.tasks.find((t: { task: string }) => t.task === "contradictions");
    expect(latest.runId).toBe(rerun.runId);
    expect(latest.stale).toBe(false);
  });
});

describe("cancellation, retries, terminal failure", () => {
  it("a cancelled run stops, keeps what it finished, and never claims completeness", async () => {
    const matterId = await newMatter("İptal", ["dur-aaa", "dur-bbb"]);
    const run = await start(matterId, { task: "contradictions" });
    let cancelled = false;
    const worker = new AnalysisWorker({
      store,
      batchSize: 1,
      hooks: {
        afterUnit: async () => {
          if (cancelled) return;
          cancelled = true;
          const response = await post(app_(), `/v1/matters/${matterId}/analysis/${run.runId}/cancel`);
          expect(response.status).toBe(202);
        },
      },
    });
    await worker.drain();

    const view = await get(app_(), `/v1/matters/${matterId}/analysis/${run.runId}`);
    expect(view.body.status).toBe("cancelled");
    expect(view.body.progress.done).toBe(1);
    expect(view.body.processingCoverage.complete).toBe(false);
    expect(view.body.processingCoverage.gaps).toContainEqual(
      expect.objectContaining({ reason: "UNIT_NOT_PROCESSED" }),
    );
    expect(view.body.exhaustiveClaimRefusedBecause).toContain("henüz işlenmedi");
    const again = await post(app_(), `/v1/matters/${matterId}/analysis/${run.runId}/cancel`);
    expect(again.status).toBe(409);
  });

  it("a unit that fails every attempt ends as a TERMINAL failure, counted in coverage", async () => {
    const matterId = await newMatter("Zehirli bölüm", ["dur-poison"]);
    const run = await start(matterId, { task: "contradictions" });
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      extractDeterministic: (unitText) => {
        if (unitText.includes("ZEHİRLİ")) throw new Error("bu bölüm okunamadı");
        return extractPropositions(unitText);
      },
    }).drain();

    const failed = await sql`
      select unit_no, attempts, error from app_private.matter_analysis_units
      where run_id = ${run.runId}::uuid and state = 'failed'`;
    expect(failed.length).toBe(1);
    expect(Number(failed[0]!["attempts"])).toBe(3);
    const view = await get(app_(), `/v1/matters/${matterId}/analysis/${run.runId}`);
    expect(view.body.status).toBe("done");
    expect(view.body.processingCoverage.complete).toBe(false);
    expect(view.body.processingCoverage.analysisUnitsFailed).toBe(1);
    expect(view.body.processingCoverage.gaps).toContainEqual(
      expect.objectContaining({ reason: "UNIT_FAILED" }),
    );
  });
});

describe("Matter Intelligence provenance is enforced by the database", () => {
  it("an item without any source span cannot be committed", async () => {
    const matterId = await newMatter("Kaynaksız öğe", ["dur-aaa"]);
    const run = await start(matterId, { task: "contradictions" });
    await new AnalysisWorker({ store }).drain();
    await expect(
      sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        await t`
          insert into app_private.matter_intel_items
            (run_id, tenant_id, matter_id, item_kind, item_key, title,
             producer, producer_version)
          values (${run.runId}::uuid, ${LOCAL_TENANT_ID}::uuid, ${matterId}::uuid,
                  'claim', 'kaynaksiz', 'Kaynaksız iddia', 'model', 'test')`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
