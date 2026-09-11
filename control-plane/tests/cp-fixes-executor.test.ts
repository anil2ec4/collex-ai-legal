/**
 * Regression tests for the adversarially-reviewed executor defects
 * (lane C2, defects 3, 4 and 5).
 *
 * Defect 3 [P1] — `capabilities.execute` and `verifier.finalizeOrQualify`
 * were unwrapped, so ONE thrown network error left the run pinned in the
 * non-terminal status "running" forever.
 *
 * Defect 4 [P2] — idempotency replay FROZE transient errors: a step recorded
 * with a retryable error was replayed forever, so a legitimate retry of the
 * same decision never re-executed the tool.
 *
 * Defect 5 [P2] — spent.wallTimeMs / rounds / modelTokens / costUsd were
 * never accumulated, so four of the seven budget dimensions could not trip.
 */

import { describe, expect, it } from "vitest";
import type { Outcome } from "../src/capabilities/types.js";
import type { CapabilityName } from "../src/capabilities/registry.js";
import { DEFAULT_DEEP_BUDGET, newSpend, type ResearchBudgets } from "../src/orchestration/budgets.js";
import {
  executeResearchRun,
  InMemoryRunStore,
  TERMINAL_STATUSES,
  type AuthContext,
  type CapabilityExecutionRequest,
  type CapabilityExecutor,
  type ExecutorPolicy,
  type ExecutorPorts,
  type Planner,
  type PlannerDecision,
  type RunState,
  type Verifier,
} from "../src/orchestration/executor.js";

const AUTH: AuthContext = { tenantId: "t1", userId: "u1", scopes: ["research:run"] };

function okOutcome(data: unknown): Outcome<unknown> {
  return {
    status: "ok",
    data,
    provider: "BEDESTEN",
    observedAt: "2026-08-26T00:00:00Z",
    warnings: [],
  };
}

function retryableTimeout(): Outcome<unknown> {
  return {
    status: "error",
    provider: "BEDESTEN",
    observedAt: "2026-08-26T00:00:00Z",
    error: {
      kind: "TIMEOUT",
      retryable: true,
      correlationId: "corr-timeout",
      safeMessage: "provider gateway call timed out",
    },
  };
}

function nonRetryableNotFound(): Outcome<unknown> {
  return {
    status: "error",
    provider: "BEDESTEN",
    observedAt: "2026-08-26T00:00:00Z",
    error: {
      kind: "NOT_FOUND",
      retryable: false,
      correlationId: "corr-404",
      safeMessage: "document not found",
    },
  };
}

async function newRun(
  store: InMemoryRunStore,
  budgets: ResearchBudgets = DEFAULT_DEEP_BUDGET,
): Promise<RunState> {
  const state: RunState = {
    runId: "run-1",
    status: "pending",
    query: "mülkiyet hakkı",
    dataClass: "public",
    budgets,
    spent: newSpend(),
    authContext: AUTH,
    steps: [],
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
  };
  await store.create(state);
  return state;
}

function repeatingPlanner(decision: PlannerDecision, finishAfter = Number.POSITIVE_INFINITY): Planner {
  let n = 0;
  return {
    next: async () => (n++ < finishAfter ? decision : { kind: "finish" }),
  };
}

function policyAllowingAll(budgets: ResearchBudgets = DEFAULT_DEEP_BUDGET): ExecutorPolicy {
  return {
    budgets,
    allowedCapabilities: new Set<CapabilityName>([
      "caseLaw.search",
      "legislation.search",
      "regulator.search",
      "document.fetch",
      "document.searchWithin",
      "legislation.resolveTarget",
      "source.health",
    ]),
  };
}

const completeVerifier: Verifier = { finalizeOrQualify: async () => "complete" };

const SEARCH_STEP: PlannerDecision = {
  kind: "step",
  capability: "caseLaw.search",
  toolName: "search_bedesten_unified",
  input: { phrase: "mülkiyet", pageSize: 5 },
};

function countingCapabilities(result: (req: CapabilityExecutionRequest) => Outcome<unknown>) {
  const calls: CapabilityExecutionRequest[] = [];
  const executor: CapabilityExecutor = {
    async execute(request) {
      calls.push(request);
      return result(request);
    },
  };
  return { calls, executor };
}

describe("defect 3: a thrown port never leaves the run in a non-terminal state", () => {
  it("a capability throw becomes a typed error step; the run still terminates", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    let attempts = 0;
    const executor: CapabilityExecutor = {
      async execute() {
        attempts += 1;
        throw new TypeError("fetch failed");
      },
    };
    const planner = repeatingPlanner(SEARCH_STEP, 1); // one step, then finish

    // Before the fix this REJECTED with TypeError.
    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );

    expect(attempts).toBe(1);
    expect(TERMINAL_STATUSES.has(final.status)).toBe(true);
    expect(final.steps).toHaveLength(1);
    const outcome = final.steps[0]?.outcome;
    expect(outcome?.status).toBe("error");
    if (outcome?.status === "error") {
      expect(outcome.error.kind).toBe("UNAVAILABLE");
      expect(outcome.error.retryable).toBe(true);
      expect(outcome.error.correlationId).toBeTruthy();
    }
    // The attempt is still charged against the tool-call budget.
    expect(final.spent.toolCalls).toBe(1);
  });

  it("an abort/timeout throw from the capability maps to TIMEOUT", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const executor: CapabilityExecutor = {
      async execute() {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      },
    };
    const final = await executeResearchRun(
      "run-1",
      {
        runs: store,
        planner: repeatingPlanner(SEARCH_STEP, 1),
        capabilities: executor,
        verifier: completeVerifier,
      },
      policyAllowingAll(),
    );
    const outcome = final.steps[0]?.outcome;
    expect(outcome?.status).toBe("error");
    if (outcome?.status === "error") expect(outcome.error.kind).toBe("TIMEOUT");
  });

  it("a verifier throw fails the run with a machine reason before rethrowing", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const verifier: Verifier = {
      finalizeOrQualify: async () => {
        throw new Error("entailment service unreachable");
      },
    };
    const { executor } = countingCapabilities(() => okOutcome([]));

    await expect(
      executeResearchRun(
        "run-1",
        { runs: store, planner: repeatingPlanner({ kind: "finish" }), capabilities: executor, verifier },
        policyAllowingAll(),
      ),
    ).rejects.toThrow("entailment service unreachable");

    // Before the fix the run stayed "running" forever.
    const persisted = await store.load("run-1");
    expect(persisted.status).toBe("failed");
    expect(TERMINAL_STATUSES.has(persisted.status)).toBe(true);
    expect(persisted.failure).toMatch(/^VERIFIER_FAILED:/u);
  });

  it("a planner throw fails the run with a machine reason before rethrowing", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const planner: Planner = {
      next: async () => {
        throw new Error("planner model call failed");
      },
    };
    const { executor } = countingCapabilities(() => okOutcome([]));

    await expect(
      executeResearchRun(
        "run-1",
        { runs: store, planner, capabilities: executor, verifier: completeVerifier },
        policyAllowingAll(),
      ),
    ).rejects.toThrow("planner model call failed");

    const persisted = await store.load("run-1");
    expect(persisted.status).toBe("failed");
    expect(persisted.failure).toMatch(/^PLANNER_FAILED:/u);
  });
});

describe("defect 4: replay must not freeze transient errors", () => {
  it("the same decision re-executes while the outcome is a retryable error", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const { calls, executor } = countingCapabilities(() => retryableTimeout());
    const planner = repeatingPlanner(SEARCH_STEP, 3); // same decision 3x, then finish

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );

    // Before the fix: 1 execution + 2 frozen replays of the TIMEOUT.
    expect(calls).toHaveLength(3);
    expect(final.spent.toolCalls).toBe(3);
    expect(final.steps.every((s) => s.replayed !== true)).toBe(true);
  });

  it("a success is still replayed exactly once (strict idempotency preserved)", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const { calls, executor } = countingCapabilities(() => okOutcome(["hit"]));
    const planner = repeatingPlanner(SEARCH_STEP, 3);

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );

    expect(calls).toHaveLength(1);
    expect(final.spent.toolCalls).toBe(1);
    expect(final.steps).toHaveLength(3);
    expect(final.steps[1]?.replayed).toBe(true);
    expect(final.steps[2]?.replayed).toBe(true);
  });

  it("a NON-retryable failure is still replayed (no pointless re-execution)", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const { calls, executor } = countingCapabilities(() => nonRetryableNotFound());
    const planner = repeatingPlanner(SEARCH_STEP, 3);

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );

    expect(calls).toHaveLength(1);
    expect(final.steps[2]?.replayed).toBe(true);
  });
});

describe("defect 5: wall time / rounds / tokens / cost actually accumulate", () => {
  it("maxWallTimeMs trips into a typed partial", async () => {
    const store = new InMemoryRunStore();
    const budgets: ResearchBudgets = {
      ...DEFAULT_DEEP_BUDGET,
      maxWallTimeMs: 25,
      maxSteps: 50,
      maxRounds: 1_000,
    };
    await newRun(store, budgets);
    let clock = 1_000;
    const executor: CapabilityExecutor = {
      async execute() {
        clock += 10;
        return okOutcome([]);
      },
    };
    // Unique inputs so replay can never short-circuit the loop.
    let n = 0;
    const planner: Planner = {
      next: async () => ({
        kind: "step",
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        input: { phrase: `q-${n++}` },
      }),
    };

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier, now: () => clock },
      { ...policyAllowingAll(budgets) },
    );

    // Before the fix wallTimeMs stayed 0 and maxSteps (50) tripped instead.
    expect(final.status).toBe("partial");
    expect(final.partialReason).toBe("BUDGET_EXHAUSTED:maxWallTimeMs");
    expect(final.spent.wallTimeMs).toBeGreaterThanOrEqual(25);
    expect(final.spent.steps).toBeLessThan(50);
  });

  it("maxCostUsd trips on capability-reported usage", async () => {
    const store = new InMemoryRunStore();
    const budgets: ResearchBudgets = { ...DEFAULT_DEEP_BUDGET, maxCostUsd: 1, maxSteps: 50 };
    await newRun(store, budgets);
    const executor: CapabilityExecutor = {
      async execute() {
        return { ...okOutcome([]), usage: { costUsd: 0.4, modelTokens: 100 } };
      },
    };
    let n = 0;
    const planner: Planner = {
      next: async () => ({
        kind: "step",
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        input: { phrase: `q-${n++}` },
      }),
    };

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(budgets),
    );

    expect(final.status).toBe("partial");
    expect(final.partialReason).toBe("BUDGET_EXHAUSTED:maxCostUsd");
    expect(final.spent.costUsd).toBeGreaterThanOrEqual(1);
    expect(final.spent.modelTokens).toBe(300);
  });

  it("maxModelTokens trips on planner-reported usage", async () => {
    const store = new InMemoryRunStore();
    const budgets: ResearchBudgets = {
      ...DEFAULT_DEEP_BUDGET,
      maxModelTokens: 1_000,
      maxSteps: 50,
    };
    await newRun(store, budgets);
    const { executor } = countingCapabilities(() => okOutcome([]));
    let n = 0;
    const planner: Planner = {
      next: async () => ({
        kind: "step",
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        input: { phrase: `q-${n++}` },
        usage: { modelTokens: 400 },
      }),
    };

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(budgets),
    );

    expect(final.status).toBe("partial");
    expect(final.partialReason).toBe("BUDGET_EXHAUSTED:maxModelTokens");
    expect(final.spent.modelTokens).toBeGreaterThanOrEqual(1_000);
  });

  it("maxRounds trips once the planner declares rounds", async () => {
    const store = new InMemoryRunStore();
    const budgets: ResearchBudgets = { ...DEFAULT_DEEP_BUDGET, maxRounds: 2, maxSteps: 50 };
    await newRun(store, budgets);
    const { executor } = countingCapabilities(() => okOutcome([]));
    let n = 0;
    const planner: Planner = {
      next: async () => {
        const i = n++;
        return {
          kind: "step",
          capability: "caseLaw.search",
          toolName: "search_bedesten_unified",
          input: { phrase: `q-${i}` },
          round: i + 1, // a fresh round per decision
        };
      },
    };

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(budgets),
    );

    expect(final.status).toBe("partial");
    expect(final.partialReason).toBe("BUDGET_EXHAUSTED:maxRounds");
    expect(final.spent.rounds).toBe(2);
  });

  it("repeated decisions inside one declared round consume one round", async () => {
    const store = new InMemoryRunStore();
    const budgets: ResearchBudgets = { ...DEFAULT_DEEP_BUDGET, maxRounds: 4, maxSteps: 6 };
    await newRun(store, budgets);
    const { executor } = countingCapabilities(() => okOutcome([]));
    let n = 0;
    const planner: Planner = {
      next: async () =>
        n++ < 3
          ? {
              kind: "step",
              capability: "caseLaw.search",
              toolName: "search_bedesten_unified",
              input: { phrase: `q-${n}` },
              round: 1,
            }
          : { kind: "finish" },
    };

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(budgets),
    );

    expect(final.status).toBe("complete");
    expect(final.spent.rounds).toBe(1);
    expect(final.spent.steps).toBe(3);
  });
});

describe("defect 5: ports.now is optional and defaults to the real clock", () => {
  it("a run with no injected clock still accumulates non-negative wall time", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const { executor } = countingCapabilities(() => okOutcome([]));
    const ports: ExecutorPorts = {
      runs: store,
      planner: repeatingPlanner(SEARCH_STEP, 1),
      capabilities: executor,
      verifier: completeVerifier,
    };
    const final = await executeResearchRun("run-1", ports, policyAllowingAll());
    expect(final.status).toBe("complete");
    expect(final.spent.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(final.spent.wallTimeMs)).toBe(true);
  });
});
