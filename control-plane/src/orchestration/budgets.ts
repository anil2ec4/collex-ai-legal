/**
 * Research run budgets (Master Build Brief section 10.3).
 *
 * The numbers are product-tier starting defaults. When any hard cap is
 * reached, no further tool call is made; the run terminates as a typed
 * `partial` carrying the evidence found so far (see executor.ts).
 *
 * HOW EACH DIMENSION IS FED (executor.ts is the only writer):
 *   steps, toolCalls, fetches — counted by the executor itself.
 *   wallTimeMs               — recomputed from the run's start timestamp at
 *                              every top-of-loop budget check (resumes from
 *                              whatever a previous attempt already spent).
 *   modelTokens, costUsd     — accumulated from the optional `usage` reported
 *                              by the planner decision and by the capability
 *                              execution result (`StepUsage`). A port that
 *                              reports no usage contributes nothing; the cap
 *                              then cannot trip. Ports that call a model MUST
 *                              report usage for these caps to be meaningful.
 *   rounds                   — incremented when a planner decision declares a
 *                              NEW `round` index. The executor cannot infer
 *                              round boundaries, so `maxRounds` only binds
 *                              planners that declare them. This is a known,
 *                              explicit gap — not silent zero-accounting.
 */

export interface ResearchBudgets {
  maxRounds: number;
  maxSteps: number;
  maxToolCalls: number;
  maxFetches: number;
  maxModelTokens: number;
  maxWallTimeMs: number;
  maxCostUsd: number;
}

export const DEFAULT_DEEP_BUDGET: ResearchBudgets = Object.freeze({
  maxRounds: 4,
  maxSteps: 24,
  maxToolCalls: 80,
  maxFetches: 35,
  maxModelTokens: 120_000,
  maxWallTimeMs: 10 * 60_000,
  maxCostUsd: 3.0,
});

/** Accumulated consumption of a run, mirroring ResearchBudgets dimension by dimension. */
export interface BudgetSpend {
  rounds: number;
  steps: number;
  toolCalls: number;
  fetches: number;
  modelTokens: number;
  wallTimeMs: number;
  costUsd: number;
}

export const ZERO_SPEND: BudgetSpend = Object.freeze({
  rounds: 0,
  steps: 0,
  toolCalls: 0,
  fetches: 0,
  modelTokens: 0,
  wallTimeMs: 0,
  costUsd: 0,
});

/** Fresh mutable spend record. */
export function newSpend(): BudgetSpend {
  return { ...ZERO_SPEND };
}

/**
 * Names of budget dimensions whose cap is already reached or exceeded, i.e.
 * dimensions with no headroom for one more unit of work. Empty array means
 * the run may take another step.
 */
export function exceededBudgetDimensions(
  budgets: ResearchBudgets,
  spent: BudgetSpend,
): string[] {
  const exceeded: string[] = [];
  if (spent.rounds >= budgets.maxRounds) exceeded.push("maxRounds");
  if (spent.steps >= budgets.maxSteps) exceeded.push("maxSteps");
  if (spent.toolCalls >= budgets.maxToolCalls) exceeded.push("maxToolCalls");
  if (spent.fetches >= budgets.maxFetches) exceeded.push("maxFetches");
  if (spent.modelTokens >= budgets.maxModelTokens) exceeded.push("maxModelTokens");
  if (spent.wallTimeMs >= budgets.maxWallTimeMs) exceeded.push("maxWallTimeMs");
  if (spent.costUsd >= budgets.maxCostUsd) exceeded.push("maxCostUsd");
  return exceeded;
}

export function withinBudget(budgets: ResearchBudgets, spent: BudgetSpend): boolean {
  return exceededBudgetDimensions(budgets, spent).length === 0;
}
