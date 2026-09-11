/**
 * Regression tests for lane C2 defects 3 (API half) and 6.
 *
 * Defect 3 [P1] — when the executor threw, POST /v1/research-runs answered a
 * bare 500 with no body and no runId, so the caller could not even look the
 * run up afterwards.
 *
 * Defect 6 [P2] — client-supplied budgets had a minimum but NO maximum and
 * were merged OVER the server defaults, so any caller could raise
 * maxToolCalls / maxCostUsd arbitrarily (1e15 was accepted).
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../src/api/server.js";
import { FakeGateway } from "../src/gateway/gateway.js";
import { InMemoryRunStore, type Verifier } from "../src/orchestration/executor.js";
import { DEFAULT_DEEP_BUDGET, type ResearchBudgets } from "../src/orchestration/budgets.js";
import type { Outcome } from "../src/capabilities/types.js";

function okOutcome(): Outcome<unknown> {
  return {
    status: "ok",
    data: [],
    provider: "BEDESTEN",
    observedAt: "2026-08-26T00:00:00Z",
    warnings: [],
  };
}

function makeApp(overrides: { verifier?: Verifier; budgets?: ResearchBudgets } = {}) {
  const runStore = new InMemoryRunStore();
  const app = createApp({
    gateway: new FakeGateway(() => okOutcome()),
    runStore,
    ...(overrides.verifier !== undefined ? { verifier: overrides.verifier } : {}),
    ...(overrides.budgets !== undefined ? { budgets: overrides.budgets } : {}),
  });
  return { app, runStore };
}

async function createRun(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request("/v1/research-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("defect 3: an executor failure answers a typed 5xx carrying the runId", () => {
  it("returns 500 with runId, status and a machine failure reason", async () => {
    const verifier: Verifier = {
      finalizeOrQualify: async () => {
        throw new Error("entailment service unreachable");
      },
    };
    const { app, runStore } = makeApp({ verifier });

    const res = await createRun(app, { query: "kıdem tazminatı" });

    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      runId?: string;
      status?: string;
      error?: { kind?: string; message?: string; failure?: string };
    };
    expect(body.runId).toBeTruthy();
    expect(body.error?.kind).toBe("RUN_FAILED");
    expect(body.status).toBe("failed");

    // ...and the run really is retrievable and terminal.
    const fetched = await app.request(`/v1/research-runs/${body.runId}`);
    expect(fetched.status).toBe(200);
    const state = (await fetched.json()) as { status: string; failure?: string };
    expect(state.status).toBe("failed");
    expect(state.failure).toMatch(/^VERIFIER_FAILED:/u);
    expect(await runStore.get(body.runId as string)).toBeDefined();
  });

  it("never leaks the underlying error message to the client", async () => {
    const verifier: Verifier = {
      finalizeOrQualify: async () => {
        throw new Error("postgres://user:hunter2@10.0.0.5/collex is down");
      },
    };
    const { app } = makeApp({ verifier });
    const res = await createRun(app, { query: "x" });
    const raw = await res.text();
    expect(res.status).toBe(500);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("10.0.0.5");
  });
});

describe("defect 6: client budgets may only LOWER the server tier budget", () => {
  it("clamps an absurd client budget down to the server maximum", async () => {
    const { app } = makeApp();

    const res = await createRun(app, {
      query: "mülkiyet",
      budgets: {
        maxToolCalls: 1_000_000_000_000_000,
        maxCostUsd: 1_000_000_000_000_000,
        maxRounds: 9_999,
        maxSteps: 9_999,
        maxFetches: 9_999,
        maxModelTokens: 999_999_999,
        maxWallTimeMs: 86_400_000,
      },
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };

    const state = (await (await app.request(`/v1/research-runs/${runId}`)).json()) as {
      budgets: ResearchBudgets;
    };
    // Before the fix these were exactly the client's numbers.
    expect(state.budgets).toEqual(DEFAULT_DEEP_BUDGET);
  });

  it("honours a client budget that lowers a dimension", async () => {
    const { app } = makeApp();
    const res = await createRun(app, {
      query: "mülkiyet",
      budgets: { maxSteps: 3, maxCostUsd: 0.25, maxToolCalls: 5_000 },
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    const state = (await (await app.request(`/v1/research-runs/${runId}`)).json()) as {
      budgets: ResearchBudgets;
    };
    expect(state.budgets.maxSteps).toBe(3);
    expect(state.budgets.maxCostUsd).toBe(0.25);
    // Above the server tier -> clamped, not honoured.
    expect(state.budgets.maxToolCalls).toBe(DEFAULT_DEEP_BUDGET.maxToolCalls);
    // Untouched dimensions keep the server default.
    expect(state.budgets.maxFetches).toBe(DEFAULT_DEEP_BUDGET.maxFetches);
  });

  it("clamps against the configured server tier, not the module default", async () => {
    const tier: ResearchBudgets = { ...DEFAULT_DEEP_BUDGET, maxToolCalls: 4, maxCostUsd: 0.5 };
    const { app } = makeApp({ budgets: tier });
    const res = await createRun(app, {
      query: "mülkiyet",
      budgets: { maxToolCalls: 80, maxCostUsd: 3 },
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    const state = (await (await app.request(`/v1/research-runs/${runId}`)).json()) as {
      budgets: ResearchBudgets;
    };
    expect(state.budgets.maxToolCalls).toBe(4);
    expect(state.budgets.maxCostUsd).toBe(0.5);
  });

  it("still rejects structurally invalid budgets with 400", async () => {
    const { app } = makeApp();
    const zero = await createRun(app, { query: "x", budgets: { maxSteps: 0 } });
    expect(zero.status).toBe(400);
    const negative = await createRun(app, { query: "x", budgets: { maxCostUsd: -1 } });
    expect(negative.status).toBe(400);
    const unknown = await createRun(app, { query: "x", budgets: { maxWidgets: 3 } });
    expect(unknown.status).toBe(400);
  });
});
