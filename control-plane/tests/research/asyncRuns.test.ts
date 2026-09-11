/**
 * W12-F research additions, fully offline through app.request():
 *   - a successful run is persisted to the injected answer store in the
 *     /v1/answer shape (bundle carries the fetched texts);
 *   - POST /v1/research/start -> 202 + GET /v1/research/runs/{id} lifecycle
 *     (running -> done) with Turkish progress labels, using a GATED gateway
 *     so the running state is observable;
 *   - TIMEOUT vs upstream classification of failed calls;
 *   - registry bounds (429 when every slot is running, TTL expiry -> 404);
 *   - health `state` derivation with and without a launcher-reported state.
 */

import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/capabilities/types.js";
import type { ProviderGateway, ToolCallRequest } from "../../src/gateway/gateway.js";
import {
  classifyOutcome,
  createLiveCapabilityExecutor,
  perCallTimeout,
} from "../../src/research/liveExecutor.js";
import { LiveDocumentStore } from "../../src/research/liveEvidence.js";
import {
  createResearchRouter,
  ResearchRunRegistry,
  RegistryFullError,
  type ResearchAnswerEntry,
  type ResearchRunView,
} from "../../src/research/routes.js";
import { runResearch } from "../../src/research/researchService.js";
import { QUESTION, ScriptedGateway, errorOutcome, fixedClocks, happyScripts } from "./helpers.js";

const BIG_BUDGET = { maxToolCalls: 24, maxFetches: 6, maxWallTimeMs: 120_000 };

/** A gateway whose FIRST call waits until `release()` is called. */
class GatedGateway implements ProviderGateway {
  readonly inner: ScriptedGateway;
  private release: (() => void) | undefined;
  private readonly gate: Promise<void>;
  private gated = false;

  constructor(inner: ScriptedGateway) {
    this.inner = inner;
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release?.();
  }

  async callTool(request: ToolCallRequest): Promise<Outcome<unknown>> {
    if (!this.gated) {
      this.gated = true;
      await this.gate;
    }
    return this.inner.callTool(request);
  }
}

class RecordingStore {
  readonly entries: ResearchAnswerEntry[] = [];
  put(entry: ResearchAnswerEntry): void {
    this.entries.push(entry);
  }
}

function counterIds(): () => string {
  let n = 0;
  return () => `run-${++n}`;
}

async function post(app: ReturnType<typeof createResearchRouter>, url: string, body: unknown) {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function poll(
  app: ReturnType<typeof createResearchRouter>,
  runId: string,
): Promise<ResearchRunView> {
  const res = await app.request(`/v1/research/runs/${runId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ResearchRunView;
}

async function until<T>(fn: () => Promise<T>, done: (v: T) => boolean, tries = 200): Promise<T> {
  for (let i = 0; i < tries; i += 1) {
    const value = await fn();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("answer-store persistence of live runs", () => {
  it("POST /v1/research stores the result in the /v1/answer shape with texts", async () => {
    const store = new RecordingStore();
    const app = createResearchRouter({
      gateway: new ScriptedGateway(happyScripts()),
      answerStore: store,
      ...fixedClocks(),
    });
    const res = await post(app, "/v1/research", {
      question: QUESTION,
      budgets: BIG_BUDGET,
      matterId: "matter-7",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; evidence: Array<{ documentVersionId: string; contentSha256: string }> };

    expect(store.entries).toHaveLength(1);
    const stored = store.entries[0]!;
    expect(stored.runId).toBe(body.runId);
    expect(stored.mode).toBe("live");
    expect(stored.question).toBe(QUESTION);
    expect(stored.matterId).toBe("matter-7");
    expect(stored.storedAt).toBe("2026-08-27T10:00:00.000Z");
    expect(stored.result.runId).toBe(body.runId);
    // The bundle carries the FETCHED canonical texts keyed by version id —
    // exactly what buildAnswerBundle(run, {includeTexts:true}) produces.
    expect(stored.bundle.schema).toBe(stored.result.bundle.schema);
    expect(Object.keys(stored.bundle.texts).length).toBeGreaterThan(0);
    for (const item of body.evidence) {
      expect(stored.bundle.texts[item.documentVersionId]).toBeDefined();
    }
  });

  it("does not persist when the upstream was unreachable (typed 502)", async () => {
    const store = new RecordingStore();
    const app = createResearchRouter({
      gateway: new ScriptedGateway({}, () => ({ error: "UNAVAILABLE" })),
      answerStore: store,
      ...fixedClocks(),
    });
    const res = await post(app, "/v1/research", { question: QUESTION });
    expect(res.status).toBe(502);
    expect(store.entries).toHaveLength(0);
  });

  it("a throwing store never fails the response", async () => {
    const app = createResearchRouter({
      gateway: new ScriptedGateway(happyScripts()),
      answerStore: {
        put: () => {
          throw new Error("disk full");
        },
      },
      ...fixedClocks(),
    });
    const res = await post(app, "/v1/research", { question: QUESTION, budgets: BIG_BUDGET });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Async lifecycle
// ---------------------------------------------------------------------------

describe("POST /v1/research/start + GET /v1/research/runs/{id}", () => {
  it("runs in the background: 202, running with Turkish steps, then done + persisted", async () => {
    const gateway = new GatedGateway(new ScriptedGateway(happyScripts()));
    const store = new RecordingStore();
    const app = createResearchRouter({
      gateway,
      answerStore: store,
      now: () => "2026-09-02T09:00:00.000Z",
      newRunId: counterIds(),
      today: () => "2026-09-02",
    });

    const started = await post(app, "/v1/research/start", {
      question: QUESTION,
      budgets: BIG_BUDGET,
      matterId: "matter-1",
    });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    expect(runId).toBe("run-1");

    // The first gateway call is gated: the run is observably RUNNING with
    // its first step in progress and a Turkish label.
    const running = await until(() => poll(app, runId), (v) => v.progress.steps.length > 0);
    expect(running.state).toBe("running");
    expect(running.startedAt).toBe("2026-09-02T09:00:00.000Z");
    expect(running.matterId).toBe("matter-1");
    expect(running.result).toBeUndefined();
    expect(running.progress.steps[0]?.status).toBe("running");
    expect(running.progress.steps[0]?.label).toMatch(/aranıyor$/u);
    expect(running.progress.toolCalls).toBe(1);

    gateway.open();
    const done = await until(() => poll(app, runId), (v) => v.state !== "running");
    expect(done.state).toBe("done");
    expect(done.finishedAt).toBeDefined();
    expect(done.result?.schema).toBe("collex.answer.result/v1");
    expect(done.result?.runId).toBe("run-1");
    expect(done.progress.steps.every((s) => s.status !== "running")).toBe(true);
    expect(done.progress.toolCalls).toBe(done.result?.research.toolCalls.length);
    expect(done.progress.fetches).toBe(done.result?.research.budgetSpent.fetches);

    // Every step label is Turkish; fetches are numbered against the budget.
    const labels = done.progress.steps.map((s) => s.label);
    expect(labels).toContain("Yargıtay/Danıştay kararları aranıyor");
    expect(labels).toContain("Mevzuat aranıyor");
    expect(labels.some((l) => /^Belge çekiliyor \d+\/6$/u.test(l))).toBe(true);
    for (const step of done.progress.steps) {
      expect(step.status).toMatch(/^(ok|failed|timeout)$/u);
      expect(typeof step.ms).toBe("number");
    }

    // Persisted exactly like the synchronous path.
    expect(store.entries.map((e) => e.runId)).toEqual(["run-1"]);
    expect(store.entries[0]?.matterId).toBe("matter-1");
    expect(store.entries[0]?.mode).toBe("live");
  });

  it("marks an unreachable upstream as failed with the typed kind", async () => {
    const app = createResearchRouter({
      gateway: new ScriptedGateway({}, () => ({ error: "UNAVAILABLE" })),
      ...fixedClocks(),
      newRunId: counterIds(),
      now: () => "2026-09-02T09:00:00.000Z",
    });
    const started = await post(app, "/v1/research/start", { question: QUESTION });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    const failed = await until(() => poll(app, runId), (v) => v.state !== "running");
    expect(failed.state).toBe("failed");
    expect(failed.error?.kind).toBe("UPSTREAM_UNAVAILABLE");
    expect(failed.error?.message).toMatch(/ulaşılamadı/u);
    expect(failed.progress.steps.every((s) => s.status === "failed")).toBe(true);
  });

  it("validates the body and the intake up front (400), and 502 without a gateway", async () => {
    const app = createResearchRouter({ gateway: new ScriptedGateway(happyScripts()) });
    expect((await post(app, "/v1/research/start", { question: "ab" })).status).toBe(400);
    expect((await post(app, "/v1/research/start", { question: QUESTION, evil: 1 })).status).toBe(400);
    const badDate = await post(app, "/v1/research/start", { question: QUESTION, asOf: "2099-99-99" });
    expect(badDate.status).toBe(400);
    const none = createResearchRouter({});
    const off = await post(none, "/v1/research/start", { question: QUESTION });
    expect(off.status).toBe(502);
    expect(((await off.json()) as { error: { kind: string } }).error.kind).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("answers 404 for an unknown run id", async () => {
    const app = createResearchRouter({ gateway: new ScriptedGateway(happyScripts()) });
    const res = await app.request("/v1/research/runs/yok");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("NOT_FOUND");
  });

  it("refuses with 429 when every registry slot is still running", async () => {
    const gateway = new GatedGateway(new ScriptedGateway(happyScripts()));
    const app = createResearchRouter({
      gateway,
      registry: { maxRuns: 1 },
      newRunId: counterIds(),
      today: () => "2026-09-02",
    });
    const first = await post(app, "/v1/research/start", { question: QUESTION });
    expect(first.status).toBe(202);
    const second = await post(app, "/v1/research/start", { question: QUESTION });
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("TOO_MANY_RUNS");
    expect(body.error.message).toMatch(/en fazla 1 canlı araştırma/u);
    gateway.open();
    await until(() => poll(app, "run-1"), (v) => v.state !== "running");
    // A finished slot is evicted for a new run.
    expect((await post(app, "/v1/research/start", { question: QUESTION })).status).toBe(202);
  });

  it("registry: TTL expiry and oldest-finished eviction", () => {
    let clock = 0;
    const registry = new ResearchRunRegistry({ maxRuns: 2, ttlMs: 1_000, monotonic: () => clock });
    const a = registry.create({ runId: "a", question: "q", matterId: null, startedAt: "t" });
    clock = 10;
    registry.create({ runId: "b", question: "q", matterId: null, startedAt: "t" });
    expect(() => registry.create({ runId: "c", question: "q", matterId: null, startedAt: "t" })).toThrow(
      RegistryFullError,
    );
    a.state = "done";
    registry.create({ runId: "c", question: "q", matterId: null, startedAt: "t" });
    expect(registry.view("a")).toBeUndefined();
    expect(registry.view("b")?.state).toBe("running");
    clock = 1_500;
    expect(registry.view("b")).toBeUndefined(); // TTL from start, even while running
    expect(registry.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// W12-API2: run-level warnings (matter link) and live origin
// ---------------------------------------------------------------------------

const LINK_WARNING =
  "MATTER_LINK_FAILED:Kayıt dava dosyasına bağlanamadı; kaydın kendisi oluşturuldu, dosyaya elle ekleyebilirsiniz.";

describe("GET /v1/research/runs/{id} warnings (W12-API2)", () => {
  it("the view always carries `warnings`: [] while running and when the link succeeded", async () => {
    const gateway = new GatedGateway(new ScriptedGateway(happyScripts()));
    let settled = 0;
    const store = Object.assign(new RecordingStore(), {
      settleLink: async (runId: string) => {
        settled += 1;
        expect(runId).toBe("run-1");
        return { ok: true };
      },
    });
    const app = createResearchRouter({
      gateway,
      answerStore: store,
      newRunId: counterIds(),
      today: () => "2026-09-02",
    });
    const started = await post(app, "/v1/research/start", { question: QUESTION, budgets: BIG_BUDGET, matterId: "matter-1" });
    expect(started.status).toBe(202);
    const running = await until(() => poll(app, "run-1"), (v) => v.progress.steps.length > 0);
    expect(running.warnings).toEqual([]);
    gateway.open();
    const done = await until(() => poll(app, "run-1"), (v) => v.state !== "running");
    expect(done.state).toBe("done");
    expect(done.warnings).toEqual([]);
    expect(settled).toBe(1);
  });

  it("a failed matter link is in `warnings` on the FIRST poll that reports `done`; the run is still stored", async () => {
    const store = Object.assign(new RecordingStore(), {
      settleLink: async () => ({ ok: false, warning: LINK_WARNING }),
    });
    const app = createResearchRouter({
      gateway: new ScriptedGateway(happyScripts()),
      answerStore: store,
      newRunId: counterIds(),
      today: () => "2026-09-02",
    });
    const started = await post(app, "/v1/research/start", { question: QUESTION, budgets: BIG_BUDGET, matterId: "matter-9" });
    expect(started.status).toBe(202);
    const done = await until(() => poll(app, "run-1"), (v) => v.state !== "running");
    expect(done.state).toBe("done");
    expect(done.result?.runId).toBe("run-1");
    expect(done.warnings).toEqual([LINK_WARNING]);
    expect(store.entries.map((e) => e.runId)).toEqual(["run-1"]);
    // A second poll does not duplicate it.
    expect((await poll(app, "run-1")).warnings).toEqual([LINK_WARNING]);
  });

  it("a sink whose settleLink rejects, or that has none, never fails or delays the run", async () => {
    const rejecting = Object.assign(new RecordingStore(), {
      settleLink: async () => {
        throw new Error("linker exploded");
      },
    });
    for (const store of [rejecting, new RecordingStore()]) {
      const app = createResearchRouter({
        gateway: new ScriptedGateway(happyScripts()),
        answerStore: store,
        newRunId: counterIds(),
        today: () => "2026-09-02",
      });
      expect((await post(app, "/v1/research/start", { question: QUESTION, budgets: BIG_BUDGET })).status).toBe(202);
      const done = await until(() => poll(app, "run-1"), (v) => v.state !== "running");
      expect(done.state).toBe("done");
      expect(done.warnings).toEqual([]);
      expect(store.entries).toHaveLength(1);
    }
  });

  it("registry.addWarning: unknown run is a no-op, empty and duplicate strings collapse", () => {
    const registry = new ResearchRunRegistry({ maxRuns: 2, ttlMs: 60_000, monotonic: () => 0 });
    registry.create({ runId: "a", question: "q", matterId: "m", startedAt: "t" });
    registry.addWarning("a", LINK_WARNING);
    registry.addWarning("a", LINK_WARNING);
    registry.addWarning("a", "");
    registry.addWarning("nope", LINK_WARNING);
    expect(registry.view("a")?.warnings).toEqual([LINK_WARNING]);
    expect(registry.view("nope")).toBeUndefined();
    // The view hands out a copy: mutating it never reaches the entry.
    registry.view("a")!.warnings.push("X");
    expect(registry.view("a")?.warnings).toEqual([LINK_WARNING]);
  });
});

describe("live origin (W12-B2 request, applied here)", () => {
  it("every evidence row of a live run carries origin 'live' (result, bundle, pack) and the card says so", async () => {
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway: new ScriptedGateway(happyScripts()),
      ...fixedClocks(),
    });
    expect(run.result.evidence.length).toBeGreaterThan(0);
    expect(run.result.evidence.every((e) => e.origin === "live")).toBe(true);
    expect(run.result.bundle.evidence.every((e) => e.origin === "live")).toBe(true);
    expect(run.pack.items.every((i) => i.origin === "live")).toBe(true);
    expect(run.result.markdown).toContain("Kaynak türü: canlı resmî kaynak");
    // Currentness of live text follows the ordinary yürürlük rules (the
    // fixture rulings are dated), never the upload exemption.
    expect(run.result.evidence.every((e) => e.currentness.status !== "NOT_APPLICABLE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Timeouts and classification
// ---------------------------------------------------------------------------

describe("per-call timeouts and TIMEOUT classification", () => {
  it("perCallTimeout: ceiling shortened by the remaining wall budget, never below 1 s", () => {
    expect(perCallTimeout(80_000, undefined)).toBe(80_000);
    expect(perCallTimeout(80_000, 120_000)).toBe(80_000);
    expect(perCallTimeout(80_000, 5_000)).toBe(5_000);
    expect(perCallTimeout(80_000, 20)).toBe(1_000);
    expect(perCallTimeout(80_000, -5)).toBe(1_000);
  });

  it("classifyOutcome separates TIMEOUT from upstream failures", () => {
    expect(classifyOutcome(errorOutcome("BEDESTEN", "TIMEOUT"))).toEqual({
      status: "timeout",
      errorKind: "TIMEOUT",
    });
    expect(classifyOutcome(errorOutcome("BEDESTEN", "UNAVAILABLE"))).toEqual({
      status: "failed",
      errorKind: "UNAVAILABLE",
    });
    expect(classifyOutcome({ status: "ok", data: [], provider: "BEDESTEN", observedAt: "t", warnings: [] })).toEqual({
      status: "ok",
    });
  });

  it("threads an AbortSignal bounded by the ceiling into the gateway and records a timeout", async () => {
    const seen: Array<{ tool: string; hasSignal: boolean }> = [];
    // A gateway that behaves like HttpMcpGateway: it waits until the signal
    // aborts and then answers a typed TIMEOUT outcome.
    const slowGateway: ProviderGateway = {
      async callTool(request, opts) {
        seen.push({ tool: request.toolName, hasSignal: opts?.signal instanceof AbortSignal });
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return errorOutcome("BEDESTEN", "TIMEOUT");
      },
    };
    const trace: Parameters<typeof createLiveCapabilityExecutor>[0]["trace"] = [];
    const events: string[] = [];
    const executor = createLiveCapabilityExecutor({
      gateway: slowGateway,
      docStore: new LiveDocumentStore(),
      trace,
      notes: [],
      perCallTimeoutMs: 30,
      onProgress: (event) => events.push(`${event.phase}:${event.status}:${event.label}`),
    });
    const started = Date.now();
    const outcome = await executor.execute(
      { capability: "caseLaw.search", toolName: "search_bedesten_unified", input: { phrase: "x" } },
      { authContext: { tenantId: "t", userId: "u", scopes: [] } },
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(outcome.status).toBe("error");
    expect(seen).toEqual([{ tool: "search_bedesten_unified", hasSignal: true }]);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ ok: false, status: "timeout", errorKind: "TIMEOUT" });
    expect(events).toEqual([
      "start:running:Yargıtay/Danıştay kararları aranıyor",
      "end:timeout:Yargıtay/Danıştay kararları aranıyor",
    ]);
  });

  it("a run whose fetches time out reports TIMEOUT:<n> apart from upstream failures", async () => {
    const scripts = happyScripts();
    const gateway = new ScriptedGateway({
      ...scripts,
      fetch: () => ({ error: "TIMEOUT" }),
    });
    const run = await runResearch({
      question: QUESTION,
      budgets: BIG_BUDGET,
      gateway,
      ...fixedClocks(),
    });
    const timedOut = run.result.research.toolCalls.filter((t) => t.status === "timeout");
    expect(timedOut.length).toBeGreaterThan(0);
    expect(timedOut.every((t) => t.tool === "fetch" && t.errorKind === "TIMEOUT")).toBe(true);
    expect(run.result.research.toolCalls.filter((t) => t.status === "ok").length).toBeGreaterThan(0);
    expect(run.result.warnings).toContain(`TIMEOUT:${timedOut.length}`);
    // No full text was fetched, so nothing is citable: an honest ABSTAIN
    // (or PARTIAL when the upstream is judged degraded) — never COMPLETE.
    expect(["ABSTAIN", "PARTIAL"]).toContain(run.result.status);
    expect(run.result.evidence).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Health state
// ---------------------------------------------------------------------------

describe("GET /v1/research/health state", () => {
  it("reports the launcher's off/starting/down without probing", async () => {
    for (const state of ["off", "starting", "down"] as const) {
      let probed = false;
      const app = createResearchRouter({
        probe: async () => {
          probed = true;
          return { gateway: "ok", toolCount: 54 };
        },
        mcpState: () => state,
      });
      const res = await app.request("/v1/research/health");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ gateway: "unreachable", state });
      expect(probed).toBe(false);
    }
  });

  it("probes when the launcher says ok, and downgrades to down when the probe fails", async () => {
    const ok = createResearchRouter({
      probe: async () => ({ gateway: "ok", toolCount: 54 }),
      mcpState: () => "ok",
    });
    expect(await (await ok.request("/v1/research/health")).json()).toEqual({
      gateway: "ok",
      toolCount: 54,
      state: "ok",
    });
    const dead = createResearchRouter({
      probe: async () => ({ gateway: "unreachable" }),
      mcpState: () => "ok",
    });
    const res = await dead.request("/v1/research/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ gateway: "unreachable", state: "down" });
  });

  it("derives off vs down when no launcher state is provided", async () => {
    const none = createResearchRouter({});
    expect(await (await none.request("/v1/research/health")).json()).toEqual({
      gateway: "unreachable",
      state: "off",
    });
    const configuredButDead = createResearchRouter({
      gateway: new ScriptedGateway({}, () => ({ error: "UNAVAILABLE" })),
    });
    expect(await (await configuredButDead.request("/v1/research/health")).json()).toEqual({
      gateway: "unreachable",
      state: "down",
    });
  });
});
