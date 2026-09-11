import { describe, expect, it } from "vitest";
import type { Outcome } from "../src/capabilities/types.js";
import type { CapabilityName } from "../src/capabilities/registry.js";
import { DEFAULT_DEEP_BUDGET, newSpend } from "../src/orchestration/budgets.js";
import {
  CapabilityNotAllowedError,
  executeResearchRun,
  InMemoryRunStore,
  stableStepKey,
  ToolCapabilityMismatchError,
  type AuthContext,
  type CapabilityExecutionContext,
  type CapabilityExecutionRequest,
  type ExecutorPolicy,
  type ExecutorPorts,
  type Planner,
  type PlannerDecision,
  type RunState,
} from "../src/orchestration/executor.js";

const AUTH: AuthContext = {
  tenantId: "tenant-1",
  userId: "user-1",
  scopes: ["research:run"],
};

function okOutcome(data: unknown): Outcome<unknown> {
  return {
    status: "ok",
    data,
    provider: "BEDESTEN",
    observedAt: "2026-08-26T00:00:00Z",
    warnings: [],
  };
}

function newRun(store: InMemoryRunStore, budgets = DEFAULT_DEEP_BUDGET): Promise<RunState> {
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
  return store.create(state).then(() => state);
}

function scriptedPlanner(decisions: PlannerDecision[]): Planner {
  let index = 0;
  return {
    next: async () => decisions[Math.min(index++, decisions.length - 1)] as PlannerDecision,
  };
}

interface Recorded {
  request: CapabilityExecutionRequest;
  ctx: CapabilityExecutionContext;
}

function recordingCapabilities(result: (req: CapabilityExecutionRequest) => Outcome<unknown>) {
  const calls: Recorded[] = [];
  return {
    calls,
    executor: {
      async execute(request: CapabilityExecutionRequest, ctx: CapabilityExecutionContext) {
        calls.push({ request, ctx });
        return result(request);
      },
    },
  };
}

const completeVerifier = { finalizeOrQualify: async () => "complete" as const };

function policyAllowingAll(budgets = DEFAULT_DEEP_BUDGET): ExecutorPolicy {
  const allowed = new Set<CapabilityName>([
    "caseLaw.search",
    "legislation.search",
    "regulator.search",
    "document.fetch",
    "document.searchWithin",
    "legislation.resolveTarget",
    "source.health",
  ]);
  return { budgets, allowedCapabilities: allowed };
}

const searchStep: PlannerDecision = {
  kind: "step",
  capability: "caseLaw.search",
  toolName: "search_bedesten_unified",
  input: { phrase: "mülkiyet", pageSize: 5 },
};

describe("executeResearchRun: budget enforcement", () => {
  it("stops as typed partial when the step budget is exhausted (never throws)", async () => {
    const store = new InMemoryRunStore();
    await newRun(store, { ...DEFAULT_DEEP_BUDGET, maxSteps: 2 });
    // A pathological planner that would run forever with unique inputs.
    let n = 0;
    const planner: Planner = {
      next: async () => ({
        kind: "step",
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        input: { phrase: `q-${n++}` },
      }),
    };
    const { calls, executor } = recordingCapabilities(() => okOutcome([]));
    const ports: ExecutorPorts = {
      runs: store,
      planner,
      capabilities: executor,
      verifier: completeVerifier,
    };

    const final = await executeResearchRun(
      "run-1",
      ports,
      policyAllowingAll({ ...DEFAULT_DEEP_BUDGET, maxSteps: 2 }),
    );

    expect(final.status).toBe("partial");
    expect(final.partialReason).toBe("BUDGET_EXHAUSTED:maxSteps");
    expect(calls).toHaveLength(2); // no tool call past the cap
    expect(final.spent.steps).toBe(2);
    expect(final.spent.toolCalls).toBe(2);
  });

  it("a run created over budget takes zero tool calls", async () => {
    const store = new InMemoryRunStore();
    const state = await newRun(store, { ...DEFAULT_DEEP_BUDGET, maxToolCalls: 1 });
    state.spent.toolCalls = 1; // already at the cap
    const { calls, executor } = recordingCapabilities(() => okOutcome([]));
    const final = await executeResearchRun(
      "run-1",
      {
        runs: store,
        planner: scriptedPlanner([searchStep]),
        capabilities: executor,
        verifier: completeVerifier,
      },
      policyAllowingAll({ ...DEFAULT_DEEP_BUDGET, maxToolCalls: 1 }),
    );
    expect(final.status).toBe("partial");
    expect(final.partialReason).toBe("BUDGET_EXHAUSTED:maxToolCalls");
    expect(calls).toHaveLength(0);
  });
});

describe("executeResearchRun: idempotency replay", () => {
  it("replays a previously recorded step without re-executing the tool", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    // Planner asks for the SAME step twice, then finishes.
    const planner = scriptedPlanner([searchStep, searchStep, { kind: "finish" }]);
    const { calls, executor } = recordingCapabilities(() => okOutcome(["hit"]));

    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );

    expect(final.status).toBe("complete");
    expect(calls).toHaveLength(1); // executed once, replayed once
    expect(final.steps).toHaveLength(2);
    expect(final.steps[0]?.replayed).toBeUndefined();
    expect(final.steps[1]?.replayed).toBe(true);
    // Replay applied the recorded outcome verbatim.
    expect(final.steps[1]?.outcome).toEqual(final.steps[0]?.outcome);
    expect(final.spent.toolCalls).toBe(1);
    expect(final.spent.steps).toBe(2);
  });

  it("stableStepKey is stable under object key order and differs per input", () => {
    const a = stableStepKey("run-1", {
      kind: "step",
      capability: "caseLaw.search",
      toolName: "search_bedesten_unified",
      input: { phrase: "x", pageSize: 5 },
    });
    const b = stableStepKey("run-1", {
      kind: "step",
      capability: "caseLaw.search",
      toolName: "search_bedesten_unified",
      input: { pageSize: 5, phrase: "x" }, // reordered keys
    });
    const c = stableStepKey("run-1", {
      kind: "step",
      capability: "caseLaw.search",
      toolName: "search_bedesten_unified",
      input: { phrase: "y", pageSize: 5 },
    });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("executeResearchRun: capability policy", () => {
  it("rejects a capability outside the allow-list and fails the run", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const planner = scriptedPlanner([
      { kind: "step", capability: "document.fetch", toolName: "fetch", input: { id: "1" } },
    ]);
    const { calls, executor } = recordingCapabilities(() => okOutcome(null));
    const policy: ExecutorPolicy = {
      budgets: DEFAULT_DEEP_BUDGET,
      allowedCapabilities: new Set<CapabilityName>(["caseLaw.search"]),
    };

    await expect(
      executeResearchRun(
        "run-1",
        { runs: store, planner, capabilities: executor, verifier: completeVerifier },
        policy,
      ),
    ).rejects.toThrow(CapabilityNotAllowedError);

    const state = await store.load("run-1");
    expect(state.status).toBe("failed");
    expect(state.failure).toBe("CAPABILITY_NOT_ALLOWED:document.fetch");
    expect(calls).toHaveLength(0);
  });

  it("rejects a tool that does not belong to its declared capability", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const planner = scriptedPlanner([
      {
        kind: "step",
        capability: "caseLaw.search",
        toolName: "get_bedesten_document_markdown", // actually document.fetch
        input: {},
      },
    ]);
    const { calls, executor } = recordingCapabilities(() => okOutcome(null));

    await expect(
      executeResearchRun(
        "run-1",
        { runs: store, planner, capabilities: executor, verifier: completeVerifier },
        policyAllowingAll(),
      ),
    ).rejects.toThrow(ToolCapabilityMismatchError);
    expect(calls).toHaveLength(0);
    expect((await store.load("run-1")).status).toBe("failed");
  });
});

describe("executeResearchRun: authContext isolation", () => {
  it("authContext always comes from run state; planner-smuggled auth is stripped", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const evilAuth = { tenantId: "attacker", userId: "attacker", scopes: ["admin"] };
    const planner = scriptedPlanner([
      {
        kind: "step",
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        // Planner (untrusted model output) tries to inject auth material.
        input: { phrase: "x", authContext: evilAuth, bearerToken: "stolen" },
      },
      { kind: "finish" },
    ]);
    const { calls, executor } = recordingCapabilities(() => okOutcome([]));

    await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );

    expect(calls).toHaveLength(1);
    // Context auth is exactly the run-state auth, not the planner's.
    expect(calls[0]?.ctx.authContext).toEqual(AUTH);
    // Auth-shaped keys never reach the tool input.
    expect(calls[0]?.request.input).toEqual({ phrase: "x" });
  });

  it("counts document.fetch steps against the fetch budget", async () => {
    const store = new InMemoryRunStore();
    await newRun(store);
    const planner = scriptedPlanner([
      { kind: "step", capability: "document.fetch", toolName: "fetch", input: { id: "1" } },
      { kind: "finish" },
    ]);
    const { executor } = recordingCapabilities(() => okOutcome(null));
    const final = await executeResearchRun(
      "run-1",
      { runs: store, planner, capabilities: executor, verifier: completeVerifier },
      policyAllowingAll(),
    );
    expect(final.spent.fetches).toBe(1);
  });
});
