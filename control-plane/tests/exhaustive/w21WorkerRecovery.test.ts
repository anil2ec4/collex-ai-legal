/**
 * W21 round-two review · the durable worker's failure bounds, through
 * PostgreSQL and the real worker.
 *
 *   R2-16  an orchestrator pass that CRASHES the process never reached a
 *          catch, so it was never counted: a run whose planning ran out of
 *          memory was re-claimed (and crashed the server) forever. The budget
 *          is now checked before any heavy work.
 *   R2-17  a run of another analysis version was failed only once every one
 *          of its units and tasks had been processed, ahead of its
 *          replacement. It is now failed at the start of a tick, before
 *          anything of it is claimed — and a run read under another
 *          DETERMINISTIC extractor version is refused the same way.
 *   R2-19  a model outage of ~20 s spent every attempt of every pending task
 *          and failed them for good. An ENDPOINT failure (unreachable,
 *          429/502/503/504) now spends no attempt, pauses model work for a
 *          backoff, and only an outage longer than the window lets attempts
 *          be spent (the run then ends honestly incomplete). Round three: a
 *          REQUEST failure (time-out, 408/500) that one slow prompt causes
 *          every time must not stall every run — it pauses nothing, and it
 *          spends attempts as soon as other model calls succeed meanwhile or
 *          its short grace is over.
 *
 * The model is `ScriptedModel`, a CONTROLLED test double: this proves the
 * worker's bookkeeping, never the quality of any real language model.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import { EXTRACTOR_VERSION, extractPropositions } from "../../src/exhaustive/observations.js";
import {
  ANALYSIS_VERSION_CHANGED_TR,
  AnalysisWorker,
  CURRENT_INTEL_VERSION,
  isTransientModelFailure,
  STAGE_CRASHED_TR,
  transportFailureScope,
  versionMismatch,
  WorkerAbort,
} from "../../src/exhaustive/worker.js";
import { LocalGenerationError } from "../../src/llm/localGenerationAdapter.js";
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
  insertUpload,
  isExtractRequest,
  isWeighRequest,
  linkFiles,
  paragraphs,
  post,
  ScriptedModel,
  sleep,
} from "./durableFixtures.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_w21_worker_recovery_test");

const CLAIMS = Array.from(
  { length: 5 },
  (_, index) => `Davacı ${index + 1} numaralı teslimattaki malın ayıplı olduğunu iddia etmektedir.`,
);
const EVIDENCE = ["Banka dekontu teslimat bedelinin ödendiğini göstermektedir."];
const OTHER_CLAIMS = ["Davalı kira sözleşmesinin feshedildiğini iddia etmektedir."];
/** Enough units for another run's reading to span many ticks (R2-19 round three). */
const MANY_CLAIMS = Array.from(
  { length: 12 },
  (_, index) => `Davalı ${index + 1} numaralı kira bedelini ödemediğini iddia etmektedir.`,
);
const DATED = ["Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır.", "Tahliye ihtarı 11.03.2024 tarihinde tebliğ edilmiştir."];

let sql: Sql;
let matters: MatterStore;
let store: PgDurableAnalysisStore;

function routes(model: ScriptedModel | undefined) {
  return () => (model === undefined ? {} : { extraction: model, synthesis: model });
}

async function startRun(
  model: ScriptedModel | undefined,
  task: string,
  fileIds: readonly string[],
): Promise<{ app: ReturnType<typeof createExhaustiveRouter>; runId: string; matterId: string }> {
  const app = createExhaustiveRouter({ store, matters, models: routes(model) });
  const matter = await matters.create({ title: `Kurtarma ${task}` });
  await linkFiles(matters, matter.id, fileIds);
  const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task });
  expect(started.status).toBe(202);
  return { app, runId: started.body.runId, matterId: matter.id };
}

/** Rewrite one pinned version inside a run's stored identity (what an upgrade leaves behind). */
async function staleIdentity(runId: string, from: string, to: string): Promise<void> {
  const rows = await sql`select snapshot->>'identity' as identity from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
  const identity = String(rows[0]!["identity"]);
  expect(identity).toContain(from);
  await sql`
    update app_private.matter_analysis_runs
    set snapshot = jsonb_set(snapshot, '{identity}', to_jsonb(${identity.replace(from, to)}::text))
    where run_id = ${runId}::uuid`;
}

async function unitAttempts(runId: string): Promise<number[]> {
  const rows = await sql`
    select attempts from app_private.matter_analysis_units where run_id = ${runId}::uuid order by unit_no`;
  return rows.map((row) => Number(row["attempts"]));
}

async function taskStates(runId: string, stage: string): Promise<Map<string, number>> {
  const rows = await sql`
    select state, count(*)::int as n from app_private.matter_analysis_tasks
    where run_id = ${runId}::uuid and stage = ${stage} group by state`;
  return new Map(rows.map((row) => [String(row["state"]), Number(row["n"])]));
}

async function activeRuns(): Promise<number> {
  const rows = await sql`
    select count(*)::int as n from app_private.matter_analysis_runs
    where status in ('queued', 'mapping', 'aggregating', 'reducing')`;
  return Number(rows[0]!["n"]);
}

/**
 * Plan a claim_evidence run's weighing and stop before any weighing call:
 * the first claimed task "dies" (WorkerAbort) under a 50 ms lease, so every
 * weighing task is left pending (or recoverable) with no model call made.
 */
async function planWeighingOnly(model: ScriptedModel, runId: string): Promise<void> {
  const doomed = new AnalysisWorker({
    store,
    retryBackoffMs: 0,
    stageBackoffMs: 0,
    taskLeaseMs: 50,
    models: routes(model),
    hooks: { beforeTask: () => { throw new WorkerAbort(); } },
  });
  await expect(doomed.drain()).rejects.toBeInstanceOf(WorkerAbort);
  const planned = await taskStates(runId, "weigh_claim");
  expect([...planned.values()].reduce((a, b) => a + b, 0)).toBe(CLAIMS.length);
  await sleep(120);
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, { fileId: "rec-claims", title: "Dava dilekçesi", blocks: paragraphs([...CLAIMS, ...EVIDENCE], 8) });
  await insertUpload(sql, { fileId: "rec-other", title: "Cevap dilekçesi", blocks: paragraphs(OTHER_CLAIMS, 4) });
  await insertUpload(sql, { fileId: "rec-dated", title: "Olay tutanağı", blocks: paragraphs(DATED, 4) });
  await insertUpload(sql, { fileId: "rec-many", title: "Kira dosyası", blocks: paragraphs(MANY_CLAIMS, 160) });
  matters = new PgMatterStore({ sql });
  store = new PgDurableAnalysisStore(sql);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// R2-16
// ---------------------------------------------------------------------------

describe("R2-16: orchestrator passes that crashed the process are counted", () => {
  /** Reads every unit but never orchestrates: the run waits for its orchestrator. */
  class ReadOnlyStore extends PgDurableAnalysisStore {
    override claimReduce() {
      return Promise.resolve(undefined);
    }
  }
  /** Counts the heavy planning reads an orchestrator pass makes. */
  class CountingStore extends PgDurableAnalysisStore {
    observationLoads = 0;
    override loadObservations(runId: string) {
      this.observationLoads += 1;
      return super.loadObservations(runId);
    }
  }

  /**
   * A contradictions run whose units are all read, followed by
   * `maxStageAttempts + offset` orchestrator passes that never returned:
   * claimed, never released, their lease lapsing, nothing caught — what a
   * pass that dies of OOM (or a kill) leaves behind.
   */
  async function crashedPasses(offset: number) {
    expect(await activeRuns()).toBe(0);
    const { app, runId, matterId } = await startRun(undefined, "contradictions", ["rec-dated"]);
    await new AnalysisWorker({ store: new ReadOnlyStore(sql), retryBackoffMs: 0, stageBackoffMs: 0 }).drain();
    const rows = await sql`select max_stage_attempts from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
    const max = Number(rows[0]!["max_stage_attempts"]);
    for (let pass = 0; pass < max + offset; pass += 1) {
      const claim = await store.claimReduce("crashed-process", 1);
      expect(claim?.runId).toBe(runId);
      await sleep(5);
    }
    return { runId, app, matterId, max };
  }

  it("after maxStageAttempts + 2 passes that never returned, the next claim closes the run FAILED with its coverage and no heavy pass", async () => {
    const { runId, app, matterId, max } = await crashedPasses(2);
    const counting = new CountingStore(sql);
    const report = await new AnalysisWorker({ store: counting, retryBackoffMs: 0, stageBackoffMs: 0 }).drain();
    expect(report.reduced).toBe(1);
    // Closed without planning again: the pass that crashed is not re-run.
    expect(counting.observationLoads).toBe(0);

    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(STAGE_CRASHED_TR);
    expect(run?.summary["stageCrashed"]).toBe(true);
    // Every unit was read: the source coverage stays what it was.
    expect(run?.coverage?.complete).toBe(true);
    const attempts = await sql`select stage_attempts from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
    expect(Number(attempts[0]!["stage_attempts"])).toBe(max + 3);
    const view = await get(app, `/v1/matters/${matterId}/analysis/${runId}`);
    expect(view.body.status).toBe("failed");
    expect(view.body.analysisCompleteness.complete).toBe(false);
    expect(await activeRuns()).toBe(0);
  });

  it("a run with fewer crashed passes than the budget still gets its real pass and finishes", async () => {
    const { runId } = await crashedPasses(1);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0 }).drain();
    const run = await store.getRun(runId);
    expect(run?.status).toBe("done");
    expect(run?.summary["stageCrashed"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R2-17
// ---------------------------------------------------------------------------

describe("R2-17: a run of another analysis version is failed before any of its work is claimed", () => {
  it("another intelligence version: not one extraction call, every unit untouched, failed with the reason", async () => {
    expect(await activeRuns()).toBe(0);
    const model = new ScriptedModel("rec-version-intel");
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await staleIdentity(runId, CURRENT_INTEL_VERSION, "intel-v1+stage-v0");

    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    // Before the fix every unit was model-extracted first (zero WEIGHING
    // calls was all the old test could say).
    expect(model.calls.filter(isExtractRequest)).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
    expect((await unitAttempts(runId)).every((attempts) => attempts === 0)).toBe(true);

    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(ANALYSIS_VERSION_CHANGED_TR);
    expect(run?.error).toContain("intel-v1+stage-v0");
    expect(run?.summary["versionMismatch"]).toBe(true);
    // Nothing was read, and the run says so.
    expect(run?.coverage?.complete).toBe(false);
    const view = await get(app, `/v1/matters/${matterId}/analysis/${runId}`);
    expect(view.body.status).toBe("failed");
    expect(view.body.analysisCompleteness.complete).toBe(false);
  });

  it("another DETERMINISTIC extractor version: refused the same way, no unit read under the new rules", async () => {
    expect(await activeRuns()).toBe(0);
    let deterministicCalls = 0;
    const { runId } = await startRun(undefined, "chronology", ["rec-dated"]);
    await staleIdentity(runId, `"extractorVersion":"${EXTRACTOR_VERSION}"`, `"extractorVersion":"extract-v3"`);

    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      extractDeterministic: (text) => {
        deterministicCalls += 1;
        return extractPropositions(text);
      },
    }).drain();
    expect(deterministicCalls).toBe(0);
    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(ANALYSIS_VERSION_CHANGED_TR);
    expect(run?.error).toContain(`extract-v3 → ${EXTRACTOR_VERSION}`);
    expect(run?.summary["versionMismatch"]).toBe(true);
  });

  it("versionMismatch() names another deterministic extractor version and accepts the current one", () => {
    const snapshot = (extractorVersion?: string) => ({
      snapshot: {
        identity: JSON.stringify({ v: 1, intelVersion: CURRENT_INTEL_VERSION, ...(extractorVersion !== undefined ? { extractorVersion } : {}) }),
      },
    });
    expect(versionMismatch(snapshot("extract-v3"), [])).toContain(`extract-v3 → ${EXTRACTOR_VERSION}`);
    expect(versionMismatch(snapshot(EXTRACTOR_VERSION), [])).toBeNull();
    expect(versionMismatch(snapshot(), [])).toBeNull();
  });

  it("the replacement run created after a stale one has its units claimed in the very first tick", async () => {
    expect(await activeRuns()).toBe(0);
    const model = new ScriptedModel("rec-version-replacement");
    const stale = await startRun(model, "claim_evidence", ["rec-claims"]);
    await staleIdentity(stale.runId, CURRENT_INTEL_VERSION, "intel-v1+stage-v0");
    const replacement = await startRun(model, "claim_evidence", ["rec-other"]);

    // One unit per tick: before the fix the OLDER (stale) run's unit was the
    // one claimed, and its replacement waited until it had all been read.
    const report = await new AnalysisWorker({ store, batchSize: 1, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).tick();
    expect(report.claimed).toBe(1);
    expect((await store.getRun(stale.runId))?.status).toBe("failed");
    expect((await unitAttempts(stale.runId)).every((attempts) => attempts === 0)).toBe(true);
    expect((await unitAttempts(replacement.runId))[0]).toBe(1);
    const extracted = model.calls.filter(isExtractRequest).map((request) => request.untrustedText ?? "");
    expect(extracted.some((text) => text.includes("Davacı 1 numaralı"))).toBe(false);

    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    expect((await store.getRun(replacement.runId))?.status).toBe("done");
  });

  it("a stale run whose stage lease another worker holds: none of its tasks is claimed until it can be failed", async () => {
    expect(await activeRuns()).toBe(0);
    const model = new ScriptedModel("rec-version-leased");
    const { runId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await planWeighingOnly(model, runId);
    await staleIdentity(runId, CURRENT_INTEL_VERSION, "intel-v1+stage-v0");
    await sql`
      update app_private.matter_analysis_runs
      set lease_owner = 'another-worker', lease_expires_at = now() + interval '10 minutes'
      where run_id = ${runId}::uuid`;

    const weighing = (): number => model.calls.filter(isWeighRequest).length;
    const before = weighing();
    const report = await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).tick();
    expect(report.tasksClaimed).toBe(0);
    expect(weighing()).toBe(before);
    expect((await store.getRun(runId))?.status).not.toBe("failed");

    // The other worker's lease lapses: the next tick fails the run.
    await sql`update app_private.matter_analysis_runs set lease_expires_at = now() - interval '1 second' where run_id = ${runId}::uuid`;
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    expect(weighing()).toBe(before);
    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(ANALYSIS_VERSION_CHANGED_TR);
  });
});

// ---------------------------------------------------------------------------
// R2-19
// ---------------------------------------------------------------------------

/** Throws a transport failure for the first `failures` requests `when` matches. */
class FlakyModel extends ScriptedModel {
  constructor(
    model: string,
    private failures: number,
    private readonly when: (request: Parameters<ScriptedModel["generateJson"]>[0]) => boolean,
    private readonly error: () => LocalGenerationError = () => new LocalGenerationError("Yerel modele ulaşılamadı.", "UNREACHABLE"),
    private readonly onFailure: () => void = () => {},
  ) {
    super(model);
  }

  override async generateJson<T = unknown>(request: Parameters<ScriptedModel["generateJson"]>[0]): Promise<T> {
    if (this.failures > 0 && this.when(request)) {
      this.failures -= 1;
      this.calls.push(request);
      this.onFailure();
      throw this.error();
    }
    return super.generateJson<T>(request);
  }
}

describe("R2-19: a briefly unreachable model spends no attempt", () => {
  it("classifies transport failures, and only them, as transient", () => {
    expect(isTransientModelFailure(new LocalGenerationError("x", "UNREACHABLE"))).toBe(true);
    expect(isTransientModelFailure(new LocalGenerationError("x", "TIMEOUT"))).toBe(true);
    expect(isTransientModelFailure(new LocalGenerationError("x", "HTTP", 503))).toBe(true);
    expect(isTransientModelFailure(new LocalGenerationError("x", "HTTP", 500))).toBe(true);
    expect(isTransientModelFailure(new LocalGenerationError("x", "HTTP", 429))).toBe(true);
    expect(isTransientModelFailure(new LocalGenerationError("x", "HTTP", 400))).toBe(false);
    expect(isTransientModelFailure(new LocalGenerationError("x", "HTTP"))).toBe(false);
    expect(isTransientModelFailure(new LocalGenerationError("x", "MALFORMED_JSON"))).toBe(false);
    expect(isTransientModelFailure(new LocalGenerationError("x", "EMPTY_RESPONSE"))).toBe(false);
    expect(isTransientModelFailure(new LocalGenerationError("x", "BOUNDARY"))).toBe(false);
    expect(isTransientModelFailure(new Error("UNREACHABLE"))).toBe(false);
  });

  it("separates ENDPOINT failures (the server serves nobody) from REQUEST failures (this request failed)", () => {
    expect(transportFailureScope(new LocalGenerationError("x", "UNREACHABLE"))).toBe("endpoint");
    for (const status of [429, 502, 503, 504]) {
      expect(transportFailureScope(new LocalGenerationError("x", "HTTP", status))).toBe("endpoint");
    }
    // A time-out or a 500 can be this one request (a prompt slower than the
    // time-out): it must not be treated as an outage of the model.
    expect(transportFailureScope(new LocalGenerationError("x", "TIMEOUT"))).toBe("request");
    for (const status of [408, 500, 501, 507]) {
      expect(transportFailureScope(new LocalGenerationError("x", "HTTP", status))).toBe("request");
    }
    expect(transportFailureScope(new LocalGenerationError("x", "HTTP", 400))).toBeNull();
    expect(transportFailureScope(new LocalGenerationError("x", "MALFORMED_JSON"))).toBeNull();
    expect(transportFailureScope(new Error("TIMEOUT"))).toBeNull();
  });

  it("an outage longer than every task's retry budget: every weighing still ends done", async () => {
    expect(await activeRuns()).toBe(0);
    // 5 weighing tasks x 3 attempts = 15: before the fix, 20 unreachable
    // answers failed every one of them for good.
    const model = new FlakyModel("rec-flaky-weigh", 20, isWeighRequest);
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      models: routes(model),
    }).drain();

    const states = await taskStates(runId, "weigh_claim");
    expect(states.get("failed") ?? 0).toBe(0);
    expect(states.get("done")).toBe(CLAIMS.length);
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.intelligenceCoverage.claimsWeighed).toBe(CLAIMS.length);
    expect(findings.intelligenceCoverage.failedStages).toEqual([]);
    expect(findings.analysisCompleteness.complete).toBe(true);
  });

  it("an extraction outage (HTTP 503 while the model loads): every unit is read, none failed", async () => {
    expect(await activeRuns()).toBe(0);
    const model = new FlakyModel(
      "rec-flaky-extract",
      6,
      isExtractRequest,
      () => new LocalGenerationError("Yerel model isteği reddetti.", "HTTP", 503),
    );
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await new AnalysisWorker({
      store,
      unitLeaseMs: 60_000,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      models: routes(model),
    }).drain();
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.processingCoverage.analysisUnitsFailed).toBe(0);
    expect(findings.processingCoverage.complete).toBe(true);
    expect((await store.getRun(runId))?.status).toBe("done");
  });

  it("the first transport failure stops the tick's model work; the backoff keeps model work paused, not reading without a model", async () => {
    expect(await activeRuns()).toBe(0);
    const model = new FlakyModel("rec-flaky-pause", 1_000, isWeighRequest);
    const { runId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await planWeighingOnly(model, runId);
    const weighing = (): number => model.calls.filter(isWeighRequest).length;
    const attemptsBefore = await sql`
      select task_id::text as id, attempts from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim'`;

    let clock = 1_000_000;
    const worker = new AnalysisWorker({
      store,
      taskBatchSize: 4,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [60_000],
      now: () => clock,
      models: routes(model),
    });
    const first = await worker.tick();
    expect(first.tasksClaimed).toBe(4);
    expect(first.deferred).toBe(1);
    expect(first.tasksFailed).toBe(0);
    // One model call, not four.
    expect(weighing()).toBe(1);
    const attemptsAfter = await sql`
      select task_id::text as id, attempts, state from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim'`;
    const before = new Map(attemptsBefore.map((row) => [String(row["id"]), Number(row["attempts"])]));
    for (const row of attemptsAfter) {
      expect(String(row["state"])).toBe("pending");
      expect(Number(row["attempts"])).toBe(before.get(String(row["id"])));
    }

    // Inside the backoff: no model work is claimed, but reading that needs no
    // model goes on.
    const deterministic = await startRun(undefined, "chronology", ["rec-dated"]);
    clock += 1_000;
    const paused = await worker.tick();
    expect(paused.tasksClaimed).toBe(0);
    expect(weighing()).toBe(1);
    expect(paused.claimed).toBeGreaterThan(0);
    expect((await unitAttempts(deterministic.runId)).every((attempts) => attempts === 1)).toBe(true);

    // Clean up: cancel the paused run so later tests start from nothing.
    await store.requestCancel(runId);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0 }).drain();
    expect(await activeRuns()).toBe(0);
  });

  it("an outage longer than the window: attempts are spent again and the run ends honestly incomplete", async () => {
    expect(await activeRuns()).toBe(0);
    let clock = 5_000_000;
    // Every failed weighing call moves the clock 400 ms: the 1 s window is
    // spent after the third one, and the model never comes back. (This test
    // used a TIMEOUT; a time-out is a REQUEST failure since round three and
    // is bounded by the request grace, tested below — the endpoint window is
    // tested with a refused connection.)
    const model = new FlakyModel(
      "rec-flaky-gone",
      1_000,
      isWeighRequest,
      () => new LocalGenerationError("Yerel modele ulaşılamadı.", "UNREACHABLE"),
      () => { clock += 400; },
    );
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      modelOutageWindowMs: 1_000,
      now: () => clock,
      models: routes(model),
    }).drain();

    const states = await taskStates(runId, "weigh_claim");
    expect(states.get("failed")).toBe(CLAIMS.length);
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.intelligenceCoverage.failedStages).toContain("claim_weighing");
    expect(findings.intelligenceCoverage.complete).toBe(false);
    expect(findings.analysisCompleteness.complete).toBe(false);
    for (const item of findings.items.filter((entry: { kind: string }) => entry.kind === "claim")) {
      expect(item.supportStatus).toBe("search_incomplete");
    }
  });

  it("a request failure while no model call succeeds: nothing pauses, and attempts are spent once the request grace is over", async () => {
    expect(await activeRuns()).toBe(0);
    let clock = 7_000_000;
    const model = new FlakyModel(
      "rec-flaky-slow-all",
      1_000,
      isWeighRequest,
      () => new LocalGenerationError("Yerel model yanıt vermedi (süre aşıldı).", "TIMEOUT"),
      () => { clock += 400; },
    );
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    await planWeighingOnly(model, runId);
    const worker = new AnalysisWorker({
      store,
      taskBatchSize: 4,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      requestFailureGraceMs: 1_000,
      now: () => clock,
      models: routes(model),
    });
    // A time-out stops neither the batch nor later model work: all four
    // claimed weighings were asked, each handed back without an attempt.
    const first = await worker.tick();
    expect(first.tasksClaimed).toBe(4);
    expect(model.calls.filter(isWeighRequest)).toHaveLength(4);
    expect(first.deferred).toBe(4);
    expect(first.tasksFailed).toBe(0);
    await worker.drain();

    const states = await taskStates(runId, "weigh_claim");
    expect(states.get("failed")).toBe(CLAIMS.length);
    // Bounded: a 1 s grace at 400 ms per failure is at most three deferrals
    // per weighing before its three attempts.
    expect(model.calls.filter(isWeighRequest).length).toBeLessThanOrEqual(CLAIMS.length * 6);
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.intelligenceCoverage.failedStages).toContain("claim_weighing");
    expect(findings.analysisCompleteness.complete).toBe(false);
    for (const item of findings.items.filter((entry: { kind: string }) => entry.kind === "claim")) {
      expect(item.supportStatus).toBe("search_incomplete");
    }
  });

  it("one weighing that ALWAYS times out, first in claim order, beside answering ones: a few calls, and nothing stalls", async () => {
    expect(await activeRuns()).toBe(0);
    // Real defaults (30 min window, 5 min grace); every time-out costs
    // 120 s of the clock, every answer 1 s. Before round three this weighing
    // was called 33 times and no other weighing ran for 30 minutes after its
    // first time-out.
    const clock = { now: 20_000_000 };
    const model = new PoisonModel("rec-poison-first", timeoutError, clock, 120_000);
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    model.poisonKey = await plannedWeighingKey(model, runId, "first");
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      now: () => clock.now,
      models: routes(model),
    }).drain();

    // One deferral (nothing had answered yet), then its three attempts: the
    // other weighings answered meanwhile, so the model is up and this
    // request is the problem.
    expect(model.poisonCalls).toHaveLength(4);
    expect(await poisonTask(runId, model.poisonKey)).toEqual({ state: "failed", attempts: 3 });
    // No pause: the next weighing answered right after the first time-out.
    const firstTimeout = model.poisonCalls[0]!;
    const nextAnswer = model.weighAnsweredAt.find((at) => at > firstTimeout);
    expect(nextAnswer).toBeDefined();
    expect(nextAnswer! - firstTimeout).toBeLessThanOrEqual(1_000);
    expect((await taskStates(runId, "weigh_claim")).get("done")).toBe(CLAIMS.length - 1);

    // Honest: the run finished, but not as a complete analysis.
    expect((await store.getRun(runId))?.status).toBe("done");
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.intelligenceCoverage.claimsWeighed).toBe(CLAIMS.length - 1);
    expect(findings.intelligenceCoverage.failedStages).toContain("claim_weighing");
    expect(findings.analysisCompleteness.complete).toBe(false);
  });

  it("the same time-out as the LAST model work left: waited out only for the request grace, then its attempts", async () => {
    expect(await activeRuns()).toBe(0);
    const clock = { now: 30_000_000 };
    const model = new PoisonModel("rec-poison-last", timeoutError, clock, 120_000);
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    model.poisonKey = await plannedWeighingKey(model, runId, "last");
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      now: () => clock.now,
      models: routes(model),
    }).drain();

    // Nothing else answers between its calls, so nothing shows whether the
    // model or the request is at fault: the 5 min grace decides. Failures at
    // 0, 2 and 4 min into it are handed back, the 6 min one spends attempt 1:
    // six calls, not the ~15 a 30 min outage window allowed.
    expect(model.poisonCalls).toHaveLength(6);
    expect(await poisonTask(runId, model.poisonKey)).toEqual({ state: "failed", attempts: 3 });
    expect((await store.getRun(runId))?.status).toBe("done");
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.intelligenceCoverage.failedStages).toContain("claim_weighing");
    expect(findings.analysisCompleteness.complete).toBe(false);
  });

  it("a request that always times out while ANOTHER run is being read: it fails in a few calls and the other weighings finish meanwhile", async () => {
    expect(await activeRuns()).toBe(0);
    const clock = { now: 40_000_000 };
    const model = new PoisonModel("rec-poison-busy", timeoutError, clock, 120_000);
    const weighing = await startRun(model, "claim_evidence", ["rec-claims"]);
    model.poisonKey = await plannedWeighingKey(model, weighing.runId, "first");
    const reading = await startRun(model, "claim_evidence", ["rec-many"]);
    const worker = new AnalysisWorker({
      store,
      // One unit per tick: the other run's reading spans many ticks.
      batchSize: 1,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      now: () => clock.now,
      models: routes(model),
    });
    const answeredBefore = model.weighAnsweredAt.length;
    let ticks = 0;
    for (; ticks < 500; ticks += 1) {
      const pending = await sql`
        select count(*)::int as n from app_private.matter_analysis_units
        where run_id = ${reading.runId}::uuid and state in ('pending', 'running')`;
      if (Number(pending[0]!["n"]) === 0) break;
      await worker.tick();
    }
    expect(ticks).toBeGreaterThan(4);
    // Every successful extraction used to restart the outage clock, so the
    // time-out was handed back once per tick, never spent an attempt, and
    // held back the weighings behind it.
    expect(model.poisonCalls).toHaveLength(4);
    expect(await poisonTask(weighing.runId, model.poisonKey)).toEqual({ state: "failed", attempts: 3 });
    expect(model.weighAnsweredAt.length - answeredBefore).toBe(CLAIMS.length - 1);
    expect((await taskStates(weighing.runId, "weigh_claim")).get("done")).toBe(CLAIMS.length - 1);

    await store.requestCancel(weighing.runId);
    await store.requestCancel(reading.runId);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0 }).drain();
    expect(await activeRuns()).toBe(0);
  });

  it("a request that makes the server unreachable every time, beside answering ones: its attempts are spent, the rest finish", async () => {
    expect(await activeRuns()).toBe(0);
    const clock = { now: 60_000_000 };
    const model = new PoisonModel(
      "rec-poison-crash",
      () => new LocalGenerationError("Yerel modele ulaşılamadı.", "UNREACHABLE"),
      clock,
      1_000,
    );
    const { runId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    model.poisonKey = await plannedWeighingKey(model, runId, "first");
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      now: () => clock.now,
      models: routes(model),
    }).drain();

    // An endpoint failure pauses the batch, but the suspect goes behind the
    // rest of its next batch, so the others' answers are seen before it is
    // called again: one deferral, then its three attempts — also once it is
    // the last weighing left and nothing else answers between its calls.
    expect(model.poisonCalls).toHaveLength(4);
    expect(await poisonTask(runId, model.poisonKey)).toEqual({ state: "failed", attempts: 3 });
    expect((await taskStates(runId, "weigh_claim")).get("done")).toBe(CLAIMS.length - 1);
    expect((await store.getRun(runId))?.status).toBe("done");
  });
});

function timeoutError(): LocalGenerationError {
  return new LocalGenerationError("Yerel model yanıt vermedi (süre aşıldı).", "TIMEOUT");
}

/** The claim part of a weighing request's data block (before its candidates). */
function weighedClaimText(request: Parameters<ScriptedModel["generateJson"]>[0]): string {
  return (request.untrustedText ?? "").split("\n\n")[0] ?? "";
}

/**
 * Fails the weighing of the claim named by `poisonKey` the same way EVERY
 * time (the model is up; that request is the problem) and answers every
 * other request. Moves a shared clock: `failMs` per failure, 1 s per answer.
 */
class PoisonModel extends ScriptedModel {
  poisonKey: string | undefined;
  readonly poisonCalls: number[] = [];
  readonly weighAnsweredAt: number[] = [];

  constructor(
    model: string,
    private readonly error: () => LocalGenerationError,
    private readonly clock: { now: number },
    private readonly failMs: number,
  ) {
    super(model);
  }

  override async generateJson<T = unknown>(request: Parameters<ScriptedModel["generateJson"]>[0]): Promise<T> {
    if (this.poisonKey !== undefined && isWeighRequest(request) && weighedClaimText(request).includes(this.poisonKey)) {
      this.calls.push(request);
      this.clock.now += this.failMs;
      this.poisonCalls.push(this.clock.now);
      throw this.error();
    }
    const result = await super.generateJson<T>(request);
    this.clock.now += 1_000;
    if (isWeighRequest(request)) this.weighAnsweredAt.push(this.clock.now);
    return result;
  }
}

/**
 * Plan a claim_evidence run's weighing with no weighing call, give every
 * weighing task a clean slate (the planning worker's aborted claim used an
 * attempt), and name the claim ("Davacı N numaralı") whose weighing is
 * `position` in claim order — planning order is not fixed across runs.
 */
async function plannedWeighingKey(model: ScriptedModel, runId: string, position: "first" | "last"): Promise<string> {
  await planWeighingOnly(model, runId);
  await sql`
    update app_private.matter_analysis_tasks
    set state = 'pending', attempts = 0, lease_owner = null, lease_expires_at = null, available_at = now()
    where run_id = ${runId}::uuid and stage = 'weigh_claim'`;
  const rows = await sql`
    select coalesce(input->>'claimQuote', input->>'claimTitle') as claim
    from app_private.matter_analysis_tasks
    where run_id = ${runId}::uuid and stage = 'weigh_claim'
    order by level, seq, task_key`;
  expect(rows).toHaveLength(CLAIMS.length);
  const claim = String(rows[position === "first" ? 0 : rows.length - 1]!["claim"]);
  const key = claim.match(/Davacı \d+ numaralı/)?.[0];
  expect(key).toBeDefined();
  return key!;
}

/** State and attempts of the weighing task of the claim named by `key`. */
async function poisonTask(runId: string, key: string): Promise<{ state: string; attempts: number }> {
  const rows = await sql`
    select state, attempts from app_private.matter_analysis_tasks
    where run_id = ${runId}::uuid and stage = 'weigh_claim'
      and coalesce(input->>'claimQuote', input->>'claimTitle') like ${"%" + key + "%"}`;
  expect(rows).toHaveLength(1);
  return { state: String(rows[0]!["state"]), attempts: Number(rows[0]!["attempts"]) };
}

/**
 * Times out ONE weighing once (a slow prompt), lets the other weighings
 * answer, then makes the endpoint unreachable for `outage` calls (a model
 * server restart) and answers everything after that.
 */
class SlowThenRestartModel extends ScriptedModel {
  poisonKey: string | undefined;
  readonly poisonOutcomes: string[] = [];
  private timedOut = false;
  private weighAnswers = 0;

  constructor(model: string, private outage: number) {
    super(model);
  }

  override async generateJson<T = unknown>(request: Parameters<ScriptedModel["generateJson"]>[0]): Promise<T> {
    const poison = this.poisonKey !== undefined && isWeighRequest(request) && weighedClaimText(request).includes(this.poisonKey);
    if (poison && !this.timedOut) {
      this.timedOut = true;
      this.calls.push(request);
      this.poisonOutcomes.push("timeout");
      throw timeoutError();
    }
    if (this.timedOut && this.weighAnswers >= CLAIMS.length - 1 && this.outage > 0) {
      this.outage -= 1;
      this.calls.push(request);
      if (poison) this.poisonOutcomes.push("unreachable");
      throw new LocalGenerationError("Yerel modele ulaşılamadı.", "UNREACHABLE");
    }
    const result = await super.generateJson<T>(request);
    if (isWeighRequest(request)) {
      this.weighAnswers += 1;
      if (poison) this.poisonOutcomes.push("answered");
    }
    return result;
  }
}

describe("R2-19 closing re-check: an earlier slow request does not make a later restart spend every attempt", () => {
  it("one time-out, the other weighings answer, then a restart: the weighing waits the restart out and ends done", async () => {
    expect(await activeRuns()).toBe(0);
    const model = new SlowThenRestartModel("rec-slow-then-restart", 4);
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["rec-claims"]);
    model.poisonKey = await plannedWeighingKey(model, runId, "first");
    await new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      modelOutageBackoffMs: [0],
      models: routes(model),
    }).drain();

    // The restart hit this weighing four times in a row; before the fix the
    // flag from its earlier time-out made each of them spend an attempt, and
    // the weighing failed for good after three.
    expect(model.poisonOutcomes.filter((outcome) => outcome === "unreachable")).toHaveLength(4);
    expect(model.poisonOutcomes.at(-1)).toBe("answered");
    const poisoned = await poisonTask(runId, model.poisonKey);
    expect(poisoned.state).toBe("done");
    expect(poisoned.attempts).toBeLessThanOrEqual(2);
    expect((await taskStates(runId, "weigh_claim")).get("done")).toBe(CLAIMS.length);
    const findings = (await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`)).body;
    expect(findings.intelligenceCoverage.failedStages).toEqual([]);
  });
});
