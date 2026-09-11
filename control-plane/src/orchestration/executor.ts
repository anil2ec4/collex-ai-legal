/**
 * Bounded research-run executor (Master Build Brief section 10.4), made
 * concrete with injected ports so it is fully unit-testable offline.
 *
 * Guarantees enforced here:
 *  - budget assertion happens before EVERY iteration; on exhaustion the run
 *    terminates as a typed `partial` — it never throws past the budget;
 *  - only allow-listed capabilities execute, and a declared tool must belong
 *    to its declared capability (registry cross-check);
 *  - idempotency-key replay: a previously recorded SUCCESS (or non-retryable
 *    failure) is applied without re-executing the tool call, while a RETRYABLE
 *    failure is never frozen into the replay log — retrying the same decision
 *    must be able to reach the provider again;
 *  - `authContext` is sourced exclusively from run state (the store); nothing
 *    the planner outputs can inject or override it;
 *  - the run ALWAYS reaches a terminal status: a throw from any injected port
 *    (planner, capabilities, verifier) is either converted into a typed error
 *    Outcome or persisted as `failed` with a machine reason before rethrowing.
 *
 * NOTE (production): run state must live in the database, not memory, so a
 * process restart resumes queued/running runs via lease recovery. The
 * InMemoryRunStore below is for tests and the local dev API only.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Outcome, ProviderCode } from "../capabilities/types.js";
import { lookupCapability, type CapabilityName } from "../capabilities/registry.js";
import {
  exceededBudgetDimensions,
  type BudgetSpend,
  type ResearchBudgets,
} from "./budgets.js";

export type RunStatus = "pending" | "running" | "complete" | "partial" | "failed";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "complete",
  "partial",
  "failed",
]);

/** Caller identity/tenancy. NEVER constructed from planner/model output. */
export interface AuthContext {
  tenantId: string;
  userId: string;
  scopes: readonly string[];
}

/**
 * Model/provider consumption reported by a port for ONE unit of work.
 *
 * The executor cannot observe token counts or spend on its own — the port that
 * actually called the model or the provider is the only thing that knows them,
 * so it reports them here and the executor accumulates them into
 * `BudgetSpend`. A port that reports nothing simply leaves those dimensions
 * unfed (see the note on `maxRounds`/`maxModelTokens`/`maxCostUsd` below).
 */
export interface StepUsage {
  modelTokens?: number;
  costUsd?: number;
}

export type PlannerDecision =
  | { kind: "finish"; usage?: StepUsage }
  | {
      kind: "step";
      capability: CapabilityName;
      /** Raw tool to execute; optional for natively implemented capabilities. */
      toolName?: string;
      input: Record<string, unknown>;
      note?: string;
      /**
       * Planner-declared round index. `spent.rounds` increments whenever this
       * changes, so `maxRounds` only constrains planners that declare rounds;
       * a planner that never sets it leaves `spent.rounds` at 0 and the
       * dimension cannot trip. This is deliberate and explicit: the executor
       * has no way to infer where one research round ends and the next begins.
       */
      round?: number;
      /** Planner-side model usage spent producing this decision. */
      usage?: StepUsage;
    };

export interface RecordedStep {
  idempotencyKey: string;
  decision: Extract<PlannerDecision, { kind: "step" }>;
  outcome: Outcome<unknown>;
  recordedAt: string;
  /** True when this entry was applied from a prior record instead of executed. */
  replayed?: boolean;
}

export interface RunState {
  runId: string;
  status: RunStatus;
  query: string;
  dataClass: string;
  budgets: ResearchBudgets;
  spent: BudgetSpend;
  authContext: AuthContext;
  steps: RecordedStep[];
  /** Set when status === "partial" (e.g. "BUDGET_EXHAUSTED:maxSteps"). */
  partialReason?: string;
  /** Set when status === "failed". */
  failure?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunStore {
  load(runId: string): Promise<RunState>;
  save(state: RunState): Promise<void>;
  findStepByIdempotencyKey(runId: string, key: string): Promise<RecordedStep | undefined>;
  recordStep(runId: string, step: RecordedStep): Promise<void>;
}

export interface Planner {
  next(state: Readonly<RunState>): Promise<PlannerDecision>;
}

export interface CapabilityExecutionRequest {
  capability: CapabilityName;
  toolName?: string;
  input: Record<string, unknown>;
}

export interface CapabilityExecutionContext {
  /** Always the run state's authContext — never planner-supplied. */
  authContext: AuthContext;
  signal?: AbortSignal;
}

/**
 * An Outcome that may additionally report what the call consumed. Plain
 * `Outcome<unknown>` values remain valid results (usage is optional).
 */
export type CapabilityExecutionResult = Outcome<unknown> & { usage?: StepUsage };

export interface CapabilityExecutor {
  execute(
    request: CapabilityExecutionRequest,
    ctx: CapabilityExecutionContext,
  ): Promise<CapabilityExecutionResult>;
}

export interface Verifier {
  /** Decide the terminal status of a run the planner declared finished. */
  finalizeOrQualify(state: Readonly<RunState>): Promise<"complete" | "partial">;
}

export interface ExecutorPorts {
  runs: RunStore;
  planner: Planner;
  capabilities: CapabilityExecutor;
  verifier: Verifier;
  /**
   * Millisecond clock used for the wall-time budget. Injectable so tests can
   * drive `maxWallTimeMs` deterministically. Defaults to `Date.now`.
   */
  now?: () => number;
}

export interface ExecutorPolicy {
  budgets: ResearchBudgets;
  allowedCapabilities: ReadonlySet<CapabilityName>;
  /** Optional data-routing gate (brief 10.4 assertDataRouteAllowed). */
  isDataRouteAllowed?: (dataClass: string, request: CapabilityExecutionRequest) => boolean;
}

export class CapabilityNotAllowedError extends Error {
  constructor(readonly capability: string) {
    super(`capability not allowed by run policy: ${capability}`);
    this.name = "CapabilityNotAllowedError";
  }
}

export class ToolCapabilityMismatchError extends Error {
  constructor(readonly toolName: string, readonly capability: string) {
    super(`tool ${toolName} does not belong to capability ${capability}`);
    this.name = "ToolCapabilityMismatchError";
  }
}

export class DataRouteNotAllowedError extends Error {
  constructor(readonly dataClass: string, readonly capability: string) {
    super(`data class ${dataClass} may not be routed through ${capability}`);
    this.name = "DataRouteNotAllowedError";
  }
}

/** Canonical JSON (recursively sorted object keys) for stable hashing. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortValue(v);
    return out;
  }
  return value;
}

/** Stable idempotency key: same run + same canonical decision => same key. */
export function stableStepKey(
  runId: string,
  decision: Extract<PlannerDecision, { kind: "step" }>,
): string {
  const payload = canonicalJson({
    runId,
    capability: decision.capability,
    toolName: decision.toolName ?? null,
    input: decision.input,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Planner output is untrusted model output. Strip any attempt to smuggle an
 * auth context (or auth-shaped fields) through the tool input.
 */
function sanitizePlannerInput(input: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "authContext" || key === "authorization" || key === "bearerToken") continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Provider attribution placeholder for a capability that THREW instead of
 * returning an Outcome: nothing in the throw tells us which upstream was being
 * called. Mirrors the placeholder api/server.ts already uses for the same
 * "no provider known yet" situation.
 */
const UNATTRIBUTED_PROVIDER: ProviderCode = "MEVZUAT";

/** Stable, log-safe machine token derived from a thrown value. */
function machineErrorCode(cause: unknown): string {
  const raw =
    cause !== null && typeof cause === "object" && typeof (cause as { name?: unknown }).name === "string"
      ? (cause as { name: string }).name
      : typeof cause;
  const token = raw.replace(/[^A-Za-z0-9]+/gu, "_").toUpperCase().slice(0, 64);
  return token.length > 0 ? token : "UNKNOWN";
}

function isAbortLike(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const name = (current as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Turn a thrown capability error into a typed error Outcome so one network
 * blip degrades a single step instead of stranding the whole run.
 * Never carries the raw message (it may contain connection strings).
 */
function outcomeFromThrownCapabilityError(cause: unknown): Outcome<never> {
  const timedOut = isAbortLike(cause);
  return {
    status: "error",
    provider: UNATTRIBUTED_PROVIDER,
    observedAt: new Date().toISOString(),
    error: {
      kind: timedOut ? "TIMEOUT" : "UNAVAILABLE",
      // Both kinds are transport-level: worth another attempt under budget.
      retryable: true,
      correlationId: randomUUID(),
      safeMessage: timedOut
        ? "capability execution timed out"
        : "capability execution failed before returning an outcome",
    },
  };
}

/**
 * Whether a step may be served from the replay log on a later identical
 * decision. Successes and NON-retryable failures are stable answers. A
 * retryable failure is a transient condition: freezing it would make every
 * later retry of the same decision replay the failure forever without ever
 * touching the provider again.
 */
export function isReplayableOutcome(outcome: Outcome<unknown>): boolean {
  return !(outcome.status === "error" && outcome.error.retryable);
}

/** The recorded step stores the pure Outcome; usage is budget bookkeeping. */
function stripUsage(result: CapabilityExecutionResult): Outcome<unknown> {
  if ((result as { usage?: StepUsage }).usage === undefined) return result;
  const { usage: _usage, ...rest } = result as Outcome<unknown> & { usage?: StepUsage };
  return rest as unknown as Outcome<unknown>;
}

function accumulateUsage(spent: BudgetSpend, usage: StepUsage | undefined): void {
  if (usage === undefined) return;
  if (typeof usage.modelTokens === "number" && Number.isFinite(usage.modelTokens)) {
    spent.modelTokens += Math.max(0, usage.modelTokens);
  }
  if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)) {
    spent.costUsd += Math.max(0, usage.costUsd);
  }
}

/**
 * Drive one research run to a terminal state. Returns the final state.
 *
 * Never throws on budget exhaustion (typed `partial` instead); throws typed
 * errors on policy violations after persisting the run as `failed`. Any other
 * thrown value from an injected port is also persisted as `failed` (with a
 * machine reason) before it propagates, so a run can never be left `running`.
 */
export async function executeResearchRun(
  runId: string,
  ports: ExecutorPorts,
  policy: ExecutorPolicy,
): Promise<RunState> {
  const now = ports.now ?? (() => Date.now());
  const state = await ports.runs.load(runId);
  if (TERMINAL_STATUSES.has(state.status)) return state;

  state.status = "running";
  state.updatedAt = new Date().toISOString();
  await ports.runs.save(state);

  // Wall-time accounting resumes from whatever a previous attempt spent.
  const wallTimeBaseMs = state.spent.wallTimeMs;
  const startedAtMs = now();
  let declaredRound: number | undefined;

  try {
    for (;;) {
      // 1. Budget assertion on every iteration — hard stop, typed partial.
      state.spent.wallTimeMs = wallTimeBaseMs + Math.max(0, now() - startedAtMs);
      const exhausted = exceededBudgetDimensions(policy.budgets, state.spent);
      if (exhausted.length > 0) {
        state.status = "partial";
        state.partialReason = `BUDGET_EXHAUSTED:${exhausted.join(",")}`;
        state.updatedAt = new Date().toISOString();
        await ports.runs.save(state);
        return state;
      }

      let decision: PlannerDecision;
      try {
        decision = await ports.planner.next(state);
      } catch (cause) {
        await failRun(ports, state, `PLANNER_FAILED:${machineErrorCode(cause)}`);
        throw cause;
      }
      accumulateUsage(state.spent, decision.usage);

      if (decision.kind === "finish") {
        let terminal: "complete" | "partial";
        try {
          terminal = await ports.verifier.finalizeOrQualify(state);
        } catch (cause) {
          await failRun(ports, state, `VERIFIER_FAILED:${machineErrorCode(cause)}`);
          throw cause;
        }
        state.status = terminal;
        state.updatedAt = new Date().toISOString();
        await ports.runs.save(state);
        return state;
      }

      // A planner that declares round boundaries feeds the `maxRounds` budget.
      if (decision.round !== undefined && decision.round !== declaredRound) {
        declaredRound = decision.round;
        state.spent.rounds += 1;
      }

      // 2. Capability allow-list + registry cross-check.
      if (!policy.allowedCapabilities.has(decision.capability)) {
        await failRun(ports, state, `CAPABILITY_NOT_ALLOWED:${decision.capability}`);
        throw new CapabilityNotAllowedError(decision.capability);
      }
      if (decision.toolName !== undefined) {
        const registered = lookupCapability(decision.toolName);
        if (registered !== decision.capability) {
          await failRun(
            ports,
            state,
            `TOOL_CAPABILITY_MISMATCH:${decision.toolName}:${decision.capability}`,
          );
          throw new ToolCapabilityMismatchError(decision.toolName, decision.capability);
        }
      }
      const request: CapabilityExecutionRequest = {
        capability: decision.capability,
        input: sanitizePlannerInput(decision.input),
        ...(decision.toolName !== undefined ? { toolName: decision.toolName } : {}),
      };
      if (policy.isDataRouteAllowed && !policy.isDataRouteAllowed(state.dataClass, request)) {
        await failRun(ports, state, `DATA_ROUTE_NOT_ALLOWED:${decision.capability}`);
        throw new DataRouteNotAllowedError(state.dataClass, decision.capability);
      }

      // 3. Idempotency replay: apply the recorded step, never re-execute —
      //    but only for outcomes that are stable answers (see
      //    isReplayableOutcome; a retryable failure must be retried).
      const sanitizedDecision: Extract<PlannerDecision, { kind: "step" }> = {
        ...decision,
        input: request.input,
      };
      const idempotencyKey = stableStepKey(runId, sanitizedDecision);
      const prior = await ports.runs.findStepByIdempotencyKey(runId, idempotencyKey);
      if (prior && isReplayableOutcome(prior.outcome)) {
        state.steps.push({ ...prior, replayed: true });
        // The planner iteration still consumes a step so a planner stuck on a
        // repeated decision cannot loop unbounded; it does NOT consume a tool
        // call because nothing was re-executed.
        state.spent.steps += 1;
        state.updatedAt = new Date().toISOString();
        await ports.runs.save(state);
        continue;
      }

      // 4. Execute. authContext comes from run state only (never the planner).
      //    A throw here is degraded into a typed error Outcome: the run keeps
      //    its terminal-state guarantee and continues under budget.
      let result: CapabilityExecutionResult;
      try {
        result = await ports.capabilities.execute(request, {
          authContext: state.authContext,
        });
      } catch (cause) {
        result = outcomeFromThrownCapabilityError(cause);
      }
      const usage: StepUsage | undefined = (result as { usage?: StepUsage }).usage;

      const step: RecordedStep = {
        idempotencyKey,
        decision: sanitizedDecision,
        outcome: stripUsage(result),
        recordedAt: new Date().toISOString(),
      };
      // The step always joins the run's audit trail (state.steps, persisted by
      // save below); only the idempotency INDEX skips transient failures, so a
      // later identical decision re-reaches the provider instead of replaying
      // a frozen TIMEOUT forever.
      if (isReplayableOutcome(step.outcome)) await ports.runs.recordStep(runId, step);
      state.steps.push(step);
      state.spent.steps += 1;
      state.spent.toolCalls += 1;
      accumulateUsage(state.spent, usage);
      if (decision.capability === "document.fetch") state.spent.fetches += 1;
      state.updatedAt = new Date().toISOString();
      await ports.runs.save(state);
    }
  } catch (cause) {
    // Last-resort terminality guarantee (store hiccup, unexpected throw):
    // never leave the run pinned in the non-terminal "running" status.
    if (!TERMINAL_STATUSES.has(state.status)) {
      try {
        await failRun(ports, state, `RUN_ABORTED:${machineErrorCode(cause)}`);
      } catch {
        // The store itself is unavailable; nothing more can be persisted.
      }
    }
    throw cause;
  }
}

async function failRun(ports: ExecutorPorts, state: RunState, failure: string): Promise<void> {
  state.status = "failed";
  state.failure = failure;
  state.updatedAt = new Date().toISOString();
  await ports.runs.save(state);
}

/** Test/dev-only store. Production requires a durable database-backed store. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunState>();
  private readonly stepsByKey = new Map<string, Map<string, RecordedStep>>();

  async create(state: RunState): Promise<void> {
    this.runs.set(state.runId, state);
    if (!this.stepsByKey.has(state.runId)) this.stepsByKey.set(state.runId, new Map());
  }

  async load(runId: string): Promise<RunState> {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`run not found: ${runId}`);
    return state;
  }

  async get(runId: string): Promise<RunState | undefined> {
    return this.runs.get(runId);
  }

  async save(state: RunState): Promise<void> {
    this.runs.set(state.runId, state);
  }

  async findStepByIdempotencyKey(
    runId: string,
    key: string,
  ): Promise<RecordedStep | undefined> {
    return this.stepsByKey.get(runId)?.get(key);
  }

  async recordStep(runId: string, step: RecordedStep): Promise<void> {
    let steps = this.stepsByKey.get(runId);
    if (!steps) {
      steps = new Map();
      this.stepsByKey.set(runId, steps);
    }
    steps.set(step.idempotencyKey, step);
  }
}
