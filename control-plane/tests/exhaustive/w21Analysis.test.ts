/**
 * W21 acceptance A, E, I, J through PostgreSQL and the real durable worker.
 *
 *   A  MORE THAN 25 CLAIMS   70 claims are extracted; every one is weighed
 *                            (claimsTotal = claimsWeighed = 70), each through
 *                            its own durable task.
 *   E  FREE-TEXT CONTRADICTION  "araç duruyordu" vs "araç hareket halindeydi"
 *                            across two uploads is paired by the semantic lane
 *                            and stored with exact provenance on BOTH sides.
 *   I  COVERAGE DISTINCTION  every page read, one comparison failed: source
 *                            coverage is complete, the analysis is NOT, and the
 *                            API says so in plain Turkish.
 *   J  HIERARCHICAL RESTART  the worker dies after 20 of 70 weighings; a fresh
 *                            worker finishes the other 50 without recomputing
 *                            the 20 and without duplicating anything.
 *
 * The model is `ScriptedModel`, a CONTROLLED test double: this proves the
 * architecture (planning, durability, provenance, coverage), never the
 * quality of any real language model. No real model is called.
 *
 * W21 hostile-review regressions (durability):
 *   #14  a planning insert that keeps failing closes the run as FAILED with
 *        its coverage instead of retrying forever;
 *   #15  a cancel that arrives while a batch of analytical tasks is claimed
 *        stops the batch: no further model call, no result stored;
 *   #16  a run planned under another analysis version is never finalized by
 *        this code — it fails with the reason.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import type { PlanMarker, StageTaskSpec } from "../../src/exhaustive/stageTypes.js";
import {
  ANALYSIS_VERSION_CHANGED_TR,
  AnalysisWorker,
  CURRENT_INTEL_VERSION,
  FINALIZE_FAILED_TR,
  PLANNING_FAILED_TR,
  WorkerAbort,
} from "../../src/exhaustive/worker.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { get, insertUpload, isWeighRequest, linkFiles, paragraphs, post, ScriptedModel } from "./durableFixtures.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_w21_analysis_test");

const CLAIMS = Array.from(
  { length: 70 },
  (_, index) => `Davacı ${index + 1} numaralı teslimattaki malın ayıplı olduğunu iddia etmektedir.`,
);
const EVIDENCE = Array.from(
  { length: 5 },
  (_, index) => `Banka dekontu ${index + 1} numaralı teslimatın bedelinin ödendiğini göstermektedir.`,
);
const STANDING = "34 ABC 123 plakalı araç olay anında duruyordu.";
const MOVING = "34 ABC 123 plakalı araç çarpışma sırasında hareket halindeydi.";

let sql: Sql;
let matters: MatterStore;
let store: PgDurableAnalysisStore;

function routes(model: ScriptedModel) {
  return () => ({ extraction: model, synthesis: model });
}

async function startRun(
  model: ScriptedModel,
  task: string,
  fileIds: readonly string[],
  extra: Record<string, unknown> = {},
): Promise<{ app: ReturnType<typeof createExhaustiveRouter>; runId: string; matterId: string }> {
  const app = createExhaustiveRouter({ store, matters, models: routes(model) });
  const matter = await matters.create({ title: `W21 ${task}` });
  await linkFiles(matters, matter.id, fileIds);
  const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task, ...extra });
  expect(started.status).toBe(202);
  return { app, runId: started.body.runId, matterId: matter.id };
}

async function findingsOf(app: ReturnType<typeof createExhaustiveRouter>, matterId: string, runId: string) {
  const response = await get(app, `/v1/matters/${matterId}/analysis/${runId}/findings`);
  expect(response.status).toBe(200);
  return response.body;
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, { fileId: "w21-claims", title: "Dava dilekçesi", blocks: paragraphs([...CLAIMS, ...EVIDENCE], 20) });
  await insertUpload(sql, { fileId: "w21-car-a", title: "Olay tutanağı", blocks: paragraphs([STANDING], 4) });
  await insertUpload(sql, { fileId: "w21-car-b", title: "Bilirkişi raporu", blocks: paragraphs([MOVING], 4) });
  matters = new PgMatterStore({ sql });
  store = new PgDurableAnalysisStore(sql);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("A: more than 25 claims", () => {
  it("weighs all 70 claims, each through its own durable task, and says so", async () => {
    const model = new ScriptedModel("w21-a");
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["w21-claims"]);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    const findings = await findingsOf(app, matterId, runId);

    expect(findings.intelligenceCoverage.claimsTotal).toBe(70);
    expect(findings.intelligenceCoverage.claimsWeighed).toBe(70);
    expect(findings.intelligenceCoverage.complete).toBe(true);
    const claims = findings.items.filter((item: { kind: string }) => item.kind === "claim");
    expect(claims).toHaveLength(70);
    for (const claim of claims) {
      expect(["not_weighed", "search_incomplete"]).not.toContain(claim.supportStatus);
    }
    const tasks = await sql`
      select count(distinct input->>'claimRef')::int as claims,
             count(*) filter (where state = 'done')::int as done,
             count(*)::int as total
      from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim'`;
    expect(Number(tasks[0]!["claims"])).toBe(70);
    expect(Number(tasks[0]!["done"])).toBe(Number(tasks[0]!["total"]));
    // Reading, extraction and analysis all complete: only now may the whole
    // task be called complete.
    expect(findings.processingCoverage.complete).toBe(true);
    expect(findings.extractionCoverage.complete).toBe(true);
    expect(findings.analysisCompleteness.complete).toBe(true);
  });
});

describe("I: all pages read is not a complete analysis", () => {
  it("one failed comparison: source complete, analysis incomplete, and the list says the same", async () => {
    const model = new ScriptedModel("w21-i", {
      // The claim text is DATA (fenced), so the marker is looked for there.
      failWhen: (request) => isWeighRequest(request) && (request.untrustedText ?? "").includes("Davacı 17 numaralı"),
    });
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["w21-claims"]);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    const findings = await findingsOf(app, matterId, runId);

    expect(findings.processingCoverage.complete).toBe(true);
    expect(findings.intelligenceCoverage.complete).toBe(false);
    expect(findings.intelligenceCoverage.claimsWeighed).toBe(69);
    expect(findings.intelligenceCoverage.claimsFailed).toBe(1);
    expect(findings.analysisCompleteness.complete).toBe(false);
    expect(findings.analysisCompleteness.state).toBe("INCOMPLETE");
    expect(findings.analysisCompleteness.headlineTr).toContain("bütün sayfaları okundu");
    expect(findings.analysisCompleteness.sectionsTr.analysis).toContain("69 / 70 iddia");

    const failedClaim = findings.items.find(
      (item: { kind: string; title: string }) => item.kind === "claim" && item.title.includes("Davacı 17 numaralı"),
    );
    expect(failedClaim.supportStatus).toBe("search_incomplete");

    const list = await get(app, `/v1/matters/${matterId}/analysis`);
    const listed = list.body.runs.find((run: { runId: string }) => run.runId === runId);
    expect(listed.complete).toBe(true);
    expect(listed.analysisComplete).toBe(false);
  });
});

describe("J: hierarchical restart", () => {
  it("a fresh worker finishes the other 50 weighings without recomputing the first 20 or duplicating anything", async () => {
    const model = new ScriptedModel("w21-j");
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["w21-claims"]);
    const weighingCalls = (): number => model.calls.filter(isWeighRequest).length;

    let started = 0;
    const doomed = new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      taskLeaseMs: 50,
      models: routes(model),
      hooks: {
        beforeTask: () => {
          started += 1;
          if (started === 21) throw new WorkerAbort();
        },
      },
    });
    await expect(doomed.drain()).rejects.toBeInstanceOf(WorkerAbort);

    const mid = await sql`
      select state, count(*)::int as n from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim' group by state`;
    const midCounts = new Map(mid.map((row) => [String(row["state"]), Number(row["n"])]));
    expect(midCounts.get("done")).toBe(20);
    expect(weighingCalls()).toBe(20);

    // The dead worker's leases lapse; a NEW worker object continues.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();

    expect(weighingCalls()).toBe(70);
    const after = await sql`
      select count(*)::int as total,
             count(*) filter (where state = 'done')::int as done,
             count(distinct task_key)::int as keys
      from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim'`;
    expect(Number(after[0]!["total"])).toBe(70);
    expect(Number(after[0]!["done"])).toBe(70);
    expect(Number(after[0]!["keys"])).toBe(70);
    const duplicates = await sql`
      select item_kind, item_key, count(*)::int as n from app_private.matter_intel_items
      where run_id = ${runId}::uuid group by item_kind, item_key having count(*) > 1`;
    expect(duplicates).toHaveLength(0);

    const findings = await findingsOf(app, matterId, runId);
    expect(findings.intelligenceCoverage.claimsWeighed).toBe(70);
    expect(findings.items.filter((item: { kind: string }) => item.kind === "claim")).toHaveLength(70);
  });
});

describe("#15: cancellation is honoured inside a claimed batch of analytical tasks", () => {
  it("after a cancel, the remaining claimed tasks get no model call and no result is stored", async () => {
    const model = new ScriptedModel("w21-cancel");
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["w21-claims"]);
    let firstTask = true;
    const worker = new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      taskBatchSize: 4,
      models: routes(model),
      hooks: {
        beforeTask: async () => {
          if (!firstTask) return;
          firstTask = false;
          expect(await store.requestCancel(runId)).toBe("requested");
        },
      },
    });
    await worker.drain();

    // Only the task already started before the cancel called the model; the
    // other claimed tasks of the batch were handed back untouched.
    expect(model.calls.filter(isWeighRequest).length).toBe(1);
    const stored = await sql`
      select count(*) filter (where state = 'done')::int as done,
             count(*) filter (where state = 'running')::int as running
      from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim'`;
    // The started task's late result was NOT stored on the cancelled run.
    expect(Number(stored[0]!["done"])).toBe(0);
    expect(Number(stored[0]!["running"])).toBe(0);
    const view = await get(app, `/v1/matters/${matterId}/analysis/${runId}`);
    expect(view.body.status).toBe("cancelled");
    expect(view.body.analysisCompleteness.complete).toBe(false);
  });
});

describe("#14: a planning step that keeps failing closes the run instead of retrying forever", () => {
  class PoisonedPlanningStore extends PgDurableAnalysisStore {
    override insertStageTasks(
      _runId: string,
      _workerId: string,
      _specs: readonly StageTaskSpec[],
      _marker: { readonly step: string; readonly result: PlanMarker },
      _modelId: string | null,
    ): Promise<number> {
      // What a lone surrogate in a clipped title used to do (22P02).
      return Promise.reject(new Error("invalid input syntax for type json"));
    }
  }

  it("the run ends FAILED with its source coverage and a Turkish reason, within the stage budget", async () => {
    const model = new ScriptedModel("w21-poison");
    const poisoned = new PoisonedPlanningStore(sql);
    const app = createExhaustiveRouter({ store: poisoned, matters, models: routes(model) });
    const matter = await matters.create({ title: "W21 poisoned planning" });
    await linkFiles(matters, matter.id, ["w21-claims"]);
    const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "claim_evidence" });
    expect(started.status).toBe(202);
    const runId: string = started.body.runId;

    const report = await new AnalysisWorker({ store: poisoned, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain(200);
    expect(report.reduced).toBe(1);

    const run = await poisoned.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(PLANNING_FAILED_TR);
    expect(run?.coverage?.complete).toBe(true);
    expect(run?.summary["planningFailed"]).toBe(true);
    const attempts = await sql`
      select stage_attempts, max_stage_attempts from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
    expect(Number(attempts[0]!["stage_attempts"])).toBeLessThanOrEqual(Number(attempts[0]!["max_stage_attempts"]) + 2);
    const view = await get(app, `/v1/matters/${matter.id}/analysis/${runId}`);
    expect(view.body.status).toBe("failed");
    expect(view.body.analysisCompleteness.complete).toBe(false);
    expect(view.body.analysisCompleteness.state).toBe("INCOMPLETE");
  });
});

describe("#14: assembling the result is bounded by the same budget", () => {
  /**
   * A store whose ledger read fails only while a run is being FINALIZED: the
   * first ledger read of an orchestrator pass is planning's source coverage,
   * the second happens only inside finalize. Before the fix that error
   * escaped the orchestrator (the tick threw, the run stayed "reducing" and
   * was re-claimed without any budget).
   */
  class FailingFinalizeStore extends PgDurableAnalysisStore {
    private ledgerReads = 0;
    override loadObservations(runId: string) {
      this.ledgerReads = 0;
      return super.loadObservations(runId);
    }
    override loadLedger(runId: string) {
      this.ledgerReads += 1;
      if (this.ledgerReads === 2) return Promise.reject(new Error("connection reset while finalizing"));
      return super.loadLedger(runId);
    }
  }

  it("a finalize step that keeps failing ends the run FAILED with its coverage, within the stage budget", async () => {
    const app = createExhaustiveRouter({ store, matters, models: () => ({}) });
    const matter = await matters.create({ title: "W21 failing finalize" });
    await linkFiles(matters, matter.id, ["w21-car-a"]);
    const started = await post(app, `/v1/matters/${matter.id}/analysis`, { task: "contradictions" });
    expect(started.status).toBe(202);
    const runId: string = started.body.runId;

    const failing = new FailingFinalizeStore(sql);
    const report = await new AnalysisWorker({ store: failing, retryBackoffMs: 0, stageBackoffMs: 0 }).drain(200);
    expect(report.reduced).toBe(1);

    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(FINALIZE_FAILED_TR);
    expect(run?.coverage?.complete).toBe(true);
    expect(run?.summary["finalizeFailed"]).toBe(true);
    const attempts = await sql`
      select stage_attempts, max_stage_attempts from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
    expect(Number(attempts[0]!["stage_attempts"])).toBeLessThanOrEqual(Number(attempts[0]!["max_stage_attempts"]) + 2);
    const view = await get(app, `/v1/matters/${matter.id}/analysis/${runId}`);
    expect(view.body.status).toBe("failed");
    expect(view.body.analysisCompleteness.complete).toBe(false);
  });
});

describe("#16: a run of another analysis version is failed, never finalized", () => {
  it("task rows planned under another stage schema are not run, and the run fails with the reason", async () => {
    const model = new ScriptedModel("w21-version-tasks");
    const { app, runId, matterId } = await startRun(model, "claim_evidence", ["w21-claims"]);
    // Read everything and plan the weighing; die before the first task runs.
    const doomed = new AnalysisWorker({
      store,
      retryBackoffMs: 0,
      stageBackoffMs: 0,
      taskLeaseMs: 50,
      models: routes(model),
      hooks: { beforeTask: () => { throw new WorkerAbort(); } },
    });
    await expect(doomed.drain()).rejects.toBeInstanceOf(WorkerAbort);
    const planned = await sql`
      select count(*)::int as n from app_private.matter_analysis_tasks
      where run_id = ${runId}::uuid and stage = 'weigh_claim'`;
    expect(Number(planned[0]!["n"])).toBe(70);
    await sql`
      update app_private.matter_analysis_tasks set schema_version = 'stage-v0'
      where run_id = ${runId}::uuid`;
    await new Promise((resolve) => setTimeout(resolve, 120));

    const before = model.calls.filter(isWeighRequest).length;
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    expect(model.calls.filter(isWeighRequest).length).toBe(before);

    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(ANALYSIS_VERSION_CHANGED_TR);
    expect(run?.summary["versionMismatch"]).toBe(true);
    const items = await sql`select count(*)::int as n from app_private.matter_intel_items where run_id = ${runId}::uuid`;
    expect(Number(items[0]!["n"])).toBe(0);
    const view = await get(app, `/v1/matters/${matterId}/analysis/${runId}`);
    expect(view.body.status).toBe("failed");
    expect(view.body.analysisCompleteness.complete).toBe(false);
  });

  it("a run whose pinned identity names another intelligence version fails before planning", async () => {
    const model = new ScriptedModel("w21-version-identity");
    const { runId } = await startRun(model, "claim_evidence", ["w21-claims"]);
    const rows = await sql`select snapshot->>'identity' as identity from app_private.matter_analysis_runs where run_id = ${runId}::uuid`;
    const identity = String(rows[0]!["identity"]);
    expect(identity).toContain(CURRENT_INTEL_VERSION);
    const stale = identity.replace(CURRENT_INTEL_VERSION, "intel-v1+stage-v0");
    await sql`
      update app_private.matter_analysis_runs
      set snapshot = jsonb_set(snapshot, '{identity}', to_jsonb(${stale}::text))
      where run_id = ${runId}::uuid`;

    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    expect(model.calls.filter(isWeighRequest).length).toBe(0);
    const run = await store.getRun(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(ANALYSIS_VERSION_CHANGED_TR);
    expect(run?.error).toContain("intel-v1+stage-v0");
  });
});

describe("E: free-text contradiction across distant documents", () => {
  it("the semantic lane pairs and classifies it, with exact provenance on both sides", async () => {
    const model = new ScriptedModel("w21-e", {
      classify: (left, right) =>
        (left.includes("duruyordu") && right.includes("hareket")) || (left.includes("hareket") && right.includes("duruyordu"))
          ? "CONTRADICTION"
          : "INDEPENDENT",
    });
    const { app, runId, matterId } = await startRun(model, "full_review", ["w21-car-a", "w21-car-b"]);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    const findings = await findingsOf(app, matterId, runId);

    expect(findings.intelligenceCoverage.semanticContradictionLane).toBe("PERFORMED");
    expect(findings.intelligenceCoverage.contradictionGroupsProcessed).toBe(
      findings.intelligenceCoverage.contradictionGroupsTotal,
    );
    const semantic = findings.items.filter(
      (item: { kind: string; attributes: Record<string, unknown> }) =>
        item.kind === "contradiction" && item.attributes["lane"] === "semantic",
    );
    expect(semantic).toHaveLength(1);
    const sides = semantic[0].sources;
    expect(new Set(sides.map((source: { fileId: string }) => source.fileId))).toEqual(new Set(["w21-car-a", "w21-car-b"]));
    expect(sides.map((source: { quote: string }) => source.quote).sort()).toEqual([MOVING, STANDING].sort());

    // Both sides slice the pinned canonical text back to exactly their quote.
    const spans = await sql`
      select o.quote, substring(v.canonical_text from o.start_char + 1 for o.end_char - o.start_char) as slice
      from app_private.matter_observations o
      join legal.document_versions v on v.id = o.document_version_id
      where o.run_id = ${runId}::uuid and o.quote in (${STANDING}, ${MOVING})`;
    expect(spans.length).toBeGreaterThanOrEqual(2);
    for (const span of spans) expect(String(span["slice"])).toBe(String(span["quote"]));

    const lanes = new Set(findings.relations.map((relation: { lane: string }) => relation.lane));
    expect(lanes.has("semantic")).toBe(true);
    // The hierarchical review produced a final, source-linked summary.
    const review = findings.items.filter((item: { kind: string }) => item.kind === "review_summary");
    expect(review).toHaveLength(1);
    expect(review[0].sources.length).toBeGreaterThan(0);
  });
});

describe("W21 round-two review · a run no longer speaks for a matter that changed after it", () => {
  it("a document added to the matter makes a whole-matter run stale and never complete; an explicit subset run is not", async () => {
    const model = new ScriptedModel("w21-drift");
    const { app, runId, matterId } = await startRun(model, "contradictions", ["w21-car-a"]);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    const before = await get(app, `/v1/matters/${matterId}/analysis/${runId}`);
    expect(before.body.stale).toBe(false);
    expect(before.body.sourceAdded).toEqual([]);

    await linkFiles(matters, matterId, ["w21-car-b"]);
    const after = await get(app, `/v1/matters/${matterId}/analysis/${runId}`);
    expect(after.body.stale).toBe(true);
    expect(after.body.sourceAdded).toEqual(["w21-car-b"]);
    expect(after.body.analysisCompleteness.complete).toBe(false);
    expect(after.body.exhaustiveClaimRefusedBecause).not.toBeNull();
    const list = await get(app, `/v1/matters/${matterId}/analysis`);
    const listed = list.body.runs.find((run: { runId: string }) => run.runId === runId);
    expect(listed.stale).toBe(true);
    expect(listed.complete).toBe(false);
    expect(listed.analysisComplete).toBe(false);
    const intelligence = await get(app, `/v1/matters/${matterId}/intelligence`);
    const latest = intelligence.body.tasks.find((task: { runId: string }) => task.runId === runId);
    expect(latest.stale).toBe(true);
    expect(latest.sourceAdded).toEqual(["w21-car-b"]);

    // control: a run over an EXPLICIT subset is not stale when another document joins the matter
    const subset = await post(app, `/v1/matters/${matterId}/analysis`, { task: "chronology", fileIds: ["w21-car-a"] });
    expect(subset.status).toBe(202);
    await new AnalysisWorker({ store, retryBackoffMs: 0, stageBackoffMs: 0, models: routes(model) }).drain();
    await linkFiles(matters, matterId, ["w21-claims"]);
    const subsetView = await get(app, `/v1/matters/${matterId}/analysis/${subset.body.runId}`);
    expect(subsetView.body.sourceAdded).toEqual([]);
    expect(subsetView.body.stale).toBe(false);
  });
});
