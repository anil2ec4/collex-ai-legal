import { expect, it } from "vitest";
import { selectFetchTargets } from "../../src/research/livePlanner.js";
import { encodePlannerNote, type StepRole } from "../../src/planner/outcomes.js";
import type { RecordedStep, RunState } from "../../src/orchestration/executor.js";

function step(ids: string[], role: StepRole, issueId: string): RecordedStep {
  return { idempotencyKey: issueId, recordedAt: "2026-09-08T00:00:00Z",
    decision: { kind: "step", capability: "caseLaw.search", input: {},
      note: encodePlannerNote({ template: "test", issueId, role, round: 1 }) },
    outcome: { status: "ok", provider: "BEDESTEN", observedAt: "2026-09-08T00:00:00Z",
      warnings: [], data: ids.map((externalId) => ({ externalId, provider: "BEDESTEN" })) } };
}

it("fills spare fetch slots with later candidates, round-robin across searches", () => {
  const state = { steps: [step(["101", "102", "103"], "primary", "i1"),
    step(["201", "202"], "primary", "i2"), step(["301"], "contrary", "i3")] } as RunState;
  expect(selectFetchTargets(state, 5).map((t) => t.externalId)).toEqual(["101", "201", "102", "202", "301"]);
  expect(selectFetchTargets(state, 2).map((t) => t.externalId)).toEqual(["101", "301"]);
});

it("deduplicates all returned identities while keeping the contrary reservation", () => {
  const state = { steps: [step(["101", "102"], "primary", "i1"),
    step(["101", "301"], "contrary", "i2")] } as RunState;
  const targets = selectFetchTargets(state, 3);
  expect(targets.map((t) => t.externalId)).toEqual(["101", "102", "301"]);
  expect(targets.map((t) => t.contrary)).toEqual([false, false, true]);
});

it("reads two candidates for the explicitly requested issue before incidental topics", () => {
  const state = { steps: [step(["401"], "legislation", "i1"), step(["501"], "legislation", "i2"),
    step(["101", "102", "103"], "primary", "i1"), step(["201"], "primary", "i2"),
    step(["301"], "contrary", "i1")] } as RunState;
  expect(selectFetchTargets(state, 5, "i1").map((t) => t.externalId)).toEqual(["101", "102", "401", "501", "301"]);
});
