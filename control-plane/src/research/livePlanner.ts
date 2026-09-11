/**
 * Live research planner (Lane F2): the existing deterministic rule planner
 * (planner/rulePlanner planNextDecision + templates) drives every SEARCH
 * decision; this wrapper owns only the FETCH phase, where the service-level
 * fetch policy of brief §10 applies:
 *
 *   - fetch candidates are the top hits of recorded fetchable searches — every
 *     externalId comes from a prior TYPED outcome, never from free text;
 *   - the fetch list is capped by the run's `maxFetches` budget, and when the
 *     MANDATORY contrary lane returned hits, AT LEAST ONE fetch slot is
 *     reserved for the contrary lane's best candidate — opposing authority is
 *     pulled in full before the budget can be spent on friendly documents;
 *   - decisions carry the standard planner note (role "fetch"), so the rule
 *     planner's own follow-up stage (exact E./K. references parsed out of
 *     fetched text) and the coverage verifier read the run exactly as if the
 *     rule planner had planned the fetches itself.
 *
 * Determinism: `next(state)` is a pure function of (intake, state, config) —
 * the same properties the rule planner guarantees.
 */

import { CAPABILITY_NAMES, type CapabilityName } from "../capabilities/registry.js";
import {
  stableStepKey,
  type Planner,
  type PlannerDecision,
  type RunState,
} from "../orchestration/executor.js";
import {
  analyzeIntake,
  IntakeValidationError,
  validateResearchIntake,
  type ResearchIntake,
} from "../planner/intake.js";
import {
  FETCHABLE_SEARCH_ROLES,
  encodePlannerNote,
  extractHits,
  parsePlannerNote,
} from "../planner/outcomes.js";
import {
  DEFAULT_HEADROOM_STEPS,
  DEFAULT_HEADROOM_TOOL_CALLS,
  planNextDecision,
  type RulePlannerConfig,
} from "../planner/rulePlanner.js";
import { buildFetchInput, fetchToolForProvider, RESEARCH_TEMPLATES, selectTemplate } from "../planner/templates.js";
import { explicitResearchFocus } from "../retrieval/researchFocus.js";

export interface LiveResearchPlannerConfig {
  /** Hard cap on full-document fetches for the run. */
  maxFetches: number;
  /** Passed through to the rule planner (see RulePlannerConfig). */
  planner?: RulePlannerConfig;
}

/** One selected full-document fetch target (typed identity only). */
export interface FetchTarget {
  provider: string;
  externalId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Planner note for the fetch decision (role "fetch"). */
  note: string;
  /** True when every search that surfaced this hit was a contrary lane. */
  contrary: boolean;
}

/**
 * Derive the ordered fetch-target list from recorded search steps. Pure
 * function of (state, maxFetches):
 *
 *  1. hits of recorded fetchable searches, interleaved by result position
 *     (all first hits, then second hits), deduped by
 *     (provider, externalId); a hit surfaced by BOTH a contrary and a
 *     non-contrary lane counts as non-contrary;
 *  2. non-contrary targets keep their recorded order; when a contrary target
 *     exists, the contrary lane's best candidate is inserted so it lands
 *     INSIDE the first `maxFetches` slots (the reserved fetch);
 *  3. the list is truncated to `maxFetches`.
 */
export function selectFetchTargets(
  state: Readonly<RunState>,
  maxFetches: number,
  preferredIssueId?: string,
): FetchTarget[] {
  if (maxFetches <= 0) return [];

  interface Collected extends FetchTarget {
    roles: Set<string>;
  }
  const byIdentity = new Map<string, Collected>();
  const order: string[] = [];

  const candidates = state.steps.flatMap((step, stepIndex) => {
    const note = parsePlannerNote(step.decision.note);
    if (!note || !FETCHABLE_SEARCH_ROLES.has(note.role) || note.role === "fetch") return [];
    return extractHits(step.outcome).map((top, rank) => ({ note, top, rank, stepIndex,
      preferred: note.issueId === preferredIssueId && note.role === "primary" && rank < 2 }));
  }).sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.rank - b.rank || a.stepIndex - b.stepIndex);
  for (const { note, top } of candidates) {
    const toolName = fetchToolForProvider(top.provider);
    const input = buildFetchInput(top.provider, top.externalId);
    if (toolName === undefined || input === undefined) continue;
    const key = `${top.provider}|${top.externalId}`;
    const existing = byIdentity.get(key);
    if (existing !== undefined) {
      existing.roles.add(note.role);
      continue;
    }
    byIdentity.set(key, {
      provider: top.provider,
      externalId: top.externalId,
      toolName,
      input,
      note: encodePlannerNote({
        template: note.template,
        issueId: note.issueId,
        role: "fetch",
        round: note.round,
      }),
      contrary: false, // finalized below from the full role set
      roles: new Set([note.role]),
    });
    order.push(key);
  }

  const others: FetchTarget[] = [];
  const contraries: FetchTarget[] = [];
  for (const key of order) {
    const collected = byIdentity.get(key) as Collected;
    const contrary = [...collected.roles].every((role) => role === "contrary");
    const { roles: _roles, ...target } = collected;
    const finalized: FetchTarget = { ...target, contrary };
    (contrary ? contraries : others).push(finalized);
  }

  let ordered: FetchTarget[];
  if (contraries.length === 0) {
    ordered = others;
  } else {
    const reservedIndex = Math.max(0, maxFetches - 1);
    ordered = [
      ...others.slice(0, reservedIndex),
      contraries[0] as FetchTarget,
      ...others.slice(reservedIndex),
      ...contraries.slice(1),
    ];
  }
  return ordered.slice(0, maxFetches);
}

/** All capabilities except document.fetch (the wrapper owns the fetch phase). */
const SEARCH_PHASE_SCOPE: readonly CapabilityName[] = Object.freeze(
  CAPABILITY_NAMES.filter((name) => name !== "document.fetch"),
);

/**
 * Create the live research planner: rule-planner searches first, then the
 * reserved-contrary fetch phase, then (via the rule planner again) bounded
 * follow-up searches over fetched text, until nothing is left or the budgets
 * leave no headroom.
 */
export function createLiveResearchPlanner(
  intake: ResearchIntake,
  config: LiveResearchPlannerConfig,
): Planner {
  const validation = validateResearchIntake(intake);
  if (!validation.ok) throw new IntakeValidationError(validation.errors);
  const validated = validation.intake;

  const requestedScope = validated.sourceScope;
  const searchScope = Object.freeze(
    SEARCH_PHASE_SCOPE.filter(
      (name) => requestedScope === undefined || requestedScope.includes(name),
    ),
  );
  const searchIntake: ResearchIntake = Object.freeze({
    ...validated,
    sourceScope: searchScope,
  });

  // Fail fast exactly like createRulePlanner: an interface-only template or a
  // broken query builder surfaces at construction time, not mid-run.
  const analysis = analyzeIntake(validated);
  const preferredIssueId = explicitResearchFocus(validated.question) === undefined
    ? undefined : analysis.issues[0]?.issueId;
  const templateId = selectTemplate(analysis, config.planner?.templateOverride);
  RESEARCH_TEMPLATES[templateId].buildStaticCalls(analysis);

  const headroomSteps = config.planner?.headroomSteps ?? DEFAULT_HEADROOM_STEPS;
  const headroomToolCalls = config.planner?.headroomToolCalls ?? DEFAULT_HEADROOM_TOOL_CALLS;
  const maxFetches = Math.max(0, Math.floor(config.maxFetches));

  /**
   * Tool calls phase 1 must leave behind for the selected full documents.
   * Reserving only one lets legislation consume the last slot while every
   * primary and contrary decision remains unread. Zero when the run may not fetch at all, when the
   * fetch budget is already spent, or when nothing fetchable was found — in
   * those cases holding budget back would only shorten the search for nothing.
   */
  function fetchReservation(
    state: Readonly<RunState>,
    fetchCap: number,
    headroom: number,
  ): number {
    const budget = Math.min(fetchCap, state.budgets.maxFetches);
    if (budget <= 0 || state.spent.fetches >= budget) return 0;
    const recorded = new Set(state.steps.map((step) => step.idempotencyKey));
    const remaining = selectFetchTargets(state, budget, preferredIssueId).filter((target) => !recorded.has(
      stableStepKey(state.runId, {
        kind: "step", capability: "document.fetch", toolName: target.toolName,
        input: target.input, note: target.note,
      }),
    )).length;
    if (remaining === 0) return 0;
    return headroom + Math.min(budget - state.spent.fetches, remaining);
  }

  return {
    async next(state: Readonly<RunState>): Promise<PlannerDecision> {
      // Phase 1 — searches (planned by the existing rule planner).
      //
      // W17 — MEASURED REGRESSION AND ITS FIX. Searching and fetching share
      // ONE tool-call budget, and phase 1 used to be allowed to spend all of
      // it. That was invisible while a question produced few issues; the
      // moment the concept engine started recognising the issues a lawyer's
      // account actually contains, an extra search displaced the FETCH and
      // the run finished with hits it never pulled in full. A hit that is
      // never fetched is not evidence — the answer then abstains for a purely
      // budgetary reason and says nothing about why.
      //
      // So the search phase now stops while there is still room to fetch. The
      // reservation covers the selected, unattempted full texts within the
      // fetch cap, so one legislation fetch cannot displace every decision.
      const reserved = fetchReservation(state, maxFetches, headroomToolCalls);
      const searchDecision =
        reserved > 0 && state.budgets.maxToolCalls - state.spent.toolCalls <= reserved
          ? ({ kind: "finish" } as const)
          : planNextDecision(searchIntake, state, config.planner);
      if (searchDecision.kind === "step") return searchDecision;

      // Phase 2 — bounded fetches with the contrary reservation.
      const fetchBudget = Math.min(maxFetches, state.budgets.maxFetches);
      if (state.spent.fetches >= fetchBudget) return { kind: "finish" };
      if (state.budgets.maxSteps - state.spent.steps <= headroomSteps) {
        return { kind: "finish" };
      }
      if (state.budgets.maxToolCalls - state.spent.toolCalls <= headroomToolCalls) {
        return { kind: "finish" };
      }

      const recorded = new Set(state.steps.map((step) => step.idempotencyKey));
      for (const target of selectFetchTargets(state, fetchBudget, preferredIssueId)) {
        const decision: Extract<PlannerDecision, { kind: "step" }> = {
          kind: "step",
          capability: "document.fetch",
          toolName: target.toolName,
          input: target.input,
          note: target.note,
        };
        // Already attempted (success OR failure): never re-emit — bounded
        // progress beats retrying a transient failure inside one run.
        if (recorded.has(stableStepKey(state.runId, decision))) continue;
        return decision;
      }
      return { kind: "finish" };
    },
  };
}
