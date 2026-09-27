/**
 * The exhaustive-analysis WORKER (W20, extended in W21): durable, resumable,
 * cancellable — for every stage, not only reading.
 *
 * W19 ran the whole map phase inside the HTTP request and persisted its
 * observations only at the end, so a process that died half-way through lost
 * everything the census said was pending. W20 replaced that with a loop over
 * small durable checkpoints for READING:
 *
 *   1. recover stale leases (units and tasks a dead worker was holding);
 *   2. finalize cancelled runs (their untouched work stays NOT processed);
 *   3. claim a small batch of pending units under a lease;
 *   4. process each unit — deterministic extraction, then model-assisted
 *      extraction when the task requires it — and verify every quote
 *      against the pinned document version;
 *   5. persist the unit's observations and mark it done in ONE transaction.
 *
 * W21 makes the stages AFTER reading just as durable:
 *
 *   6. claim a small batch of analytical TASKS (one claim against one batch
 *      of candidate evidence, one batch of free-text proposition pairs, one
 *      synthesis group at one level) under a lease, run each as ONE bounded
 *      model call, and store its result in the same statement that marks it
 *      done;
 *   7. the reduce stage became the ORCHESTRATOR: claimed only when no unit
 *      and no task of the run is pending or running, it either plans the next
 *      step (stagePlanner.ts) or finalizes: it loads the COMPLETE persisted
 *      observation and task set (not what this process produced), assembles
 *      Matter Intelligence, derives the three coverage layers and writes
 *      everything in one transaction.
 *
 * If the process dies during synthesis group 6 of 10: groups 1..5 are done
 * with their results stored; group 6 is running under an expiring lease and
 * is retried once the lease lapses; groups 7..10 are pending. A new worker —
 * a new process, a new connection pool, a new object — continues from
 * exactly there, and the unique task keys make re-planning a no-op.
 *
 * W21 round two made three more failure modes bounded:
 *
 *   - a run of another analysis version (intelligence, stage schema, model
 *     extractor or deterministic extractor) is failed at the START of a tick,
 *     before any of its units or tasks is claimed (R2-17);
 *   - an orchestrator pass that crashed the process is counted: a run whose
 *     passes keep dying is closed as failed with its coverage (R2-16);
 *   - a model TRANSPORT failure spends no attempt while it can still be an
 *     outage of the model (R2-19). An ENDPOINT failure (unreachable, HTTP
 *     429/502/503/504) pauses model work for a backoff and is waited out for
 *     the outage window. A REQUEST failure (timed out, HTTP 408/500/other
 *     5xx) pauses nothing — it may be this one prompt, slower than the
 *     time-out — and is waited out only for a short grace. Either spends
 *     attempts as soon as another model call has succeeded since the work's
 *     previous transport failure: the model answers, this request does not,
 *     and waiting for it would stall every run behind it.
 *
 * Nothing here logs document text, prompts or completions.
 */

import { randomUUID } from "node:crypto";
import { LocalGenerationError } from "../llm/localGenerationAdapter.js";
import type { EmbeddingPort } from "../retrieval/semanticRerank.js";
import {
  deriveExtractionCoverage,
  deriveIntelligenceCoverage,
  type ExtractionCoverage,
} from "./analysisCoverage.js";
import {
  LeaseLostError,
  type ClaimFilter,
  type DurableAnalysisStore,
  type NewObservation,
  type ReduceClaim,
  type RunSnapshot,
  type UnitClaim,
  type UnitExtractionStats,
} from "./durableStore.js";
import { observationKey } from "./identity.js";
import { clip, INTEL_VERSION, itemRef, type StoredObservation } from "./intelligence.js";
import { extractExhaustively, MODEL_EXTRACTOR_VERSION, type JsonGenerator } from "./modelExtractor.js";
import {
  EXTRACTOR_VERSION,
  extractPropositions,
  quoteSha256,
  type PropositionDraft,
} from "./observations.js";
import { locatorFor, runReduce, type ScopedDocument } from "./runner.js";
import { buildAnalyticalState, finalizeIntelligence } from "./stageFinalize.js";
import { STAGE_SCHEMA_VERSION, SUPPORT_UNIVERSE_KINDS } from "./stageTypes.js";
import { embeddingRequests, nextDecisions, stagesFor, type PlanningDecision } from "./stagePlanner.js";
import { processStageTask } from "./stageProcessors.js";
import { DEFAULT_STAGE_CONFIG, type StageConfig, type StageTaskClaim, type StageTaskRow } from "./stageTypes.js";
import { ANALYSIS_TASKS, TASK_SPECS, type AnalysisTask } from "./tasks.js";
import { codePointSlice, sha256Hex } from "./units.js";

/** The model routes the worker may use. Resolved per call, never cached. */
export interface WorkerModelRoutes {
  readonly extraction?: JsonGenerator | undefined;
  readonly synthesis?: JsonGenerator | undefined;
}

/**
 * Thrown from a test hook to simulate the process dying: the worker does NOT
 * catch it, so whatever the unit or task had claimed stays `running` under
 * its lease exactly as it would after a real crash.
 */
export class WorkerAbort extends Error {
  constructor(message = "simulated process death") {
    super(message);
    this.name = "WorkerAbort";
  }
}

export interface AnalysisWorkerOptions {
  readonly store: DurableAnalysisStore;
  readonly workerId?: string;
  readonly models?: () => WorkerModelRoutes;
  /**
   * Local embeddings for candidate discovery and the semantic contradiction
   * lane (W21). Absent or failing: those signals are simply not used, and
   * the plan records that — nothing else changes.
   */
  readonly embedder?: (() => EmbeddingPort | undefined) | undefined;
  /** Prefix for symmetric statement embeddings (E5: "query: "). */
  readonly embeddingPrefix?: string;
  /** Per-call bounds of the analytical stages (never a global cap). */
  readonly stageConfig?: StageConfig;
  /** Units claimed per tick (default 4). */
  readonly batchSize?: number;
  /** Analytical tasks claimed per tick (default 4). */
  readonly taskBatchSize?: number;
  /** Lease per unit; must exceed the slowest model call (default 5 min). */
  readonly unitLeaseMs?: number;
  /** Lease per analytical task (default 5 min). */
  readonly taskLeaseMs?: number;
  /** Lease for the orchestrator stage (default 15 min). */
  readonly stageLeaseMs?: number;
  /** Delay before a failed unit or task is retried (default 10 s). */
  readonly retryBackoffMs?: number;
  /**
   * W21 round two (R2-19): the backoff steps of a model TRANSPORT failure
   * that is waited out without spending an attempt (default 10 s, 30 s,
   * 2 min, 5 min). After an ENDPOINT failure (unreachable, HTTP
   * 429/502/503/504) the step is shared: model work stops for the rest of
   * the tick and none is claimed again until the step has passed. After a
   * REQUEST failure (timed out, HTTP 408/500/other 5xx) the step is the
   * work's own: only that unit or task waits, every other model call goes on.
   */
  readonly modelOutageBackoffMs?: readonly number[];
  /**
   * How long a CONTINUOUS endpoint outage is waited out (default 30 min, from
   * the first endpoint failure after the last successful model call). After
   * it, endpoint failures spend attempts again, so a model that is really
   * gone still ends its runs — as honestly incomplete.
   */
  readonly modelOutageWindowMs?: number;
  /**
   * How long one unit's or task's REQUEST failures are waited out (default
   * 5 min, from its first request failure in this process). A time-out can
   * be this one prompt rather than the model, so the grace is short; after
   * it, and at once when another model call has succeeded meanwhile, the
   * work spends attempts like any other failure.
   */
  readonly requestFailureGraceMs?: number;
  /** Clock for the outage window and backoff (tests). */
  readonly now?: () => number;
  /** Delay before a failed orchestrator pass is retried (default 30 s). */
  readonly stageBackoffMs?: number;
  /** Idle poll interval of the background loop (default 1 s). */
  readonly pollIntervalMs?: number;
  /**
   * Keep the Node process alive while the loop is idle. Off inside the
   * control plane (the HTTP server keeps it alive, and a stopped server must
   * be able to exit); ON for the standalone worker process, whose loop is
   * the only thing it has to do.
   */
  readonly keepProcessAlive?: boolean;
  /** Injectable deterministic extractor (tests count calls through it). */
  readonly extractDeterministic?: (unitText: string) => PropositionDraft[];
  readonly hooks?: {
    readonly beforeUnit?: (claim: UnitClaim) => void | Promise<void>;
    readonly afterUnit?: (claim: UnitClaim) => void | Promise<void>;
    readonly beforeTask?: (claim: StageTaskClaim) => void | Promise<void>;
    readonly afterTask?: (claim: StageTaskClaim) => void | Promise<void>;
  };
  /** Structured events only — never document text. */
  readonly log?: (event: Record<string, unknown>) => void;
}

export interface TickReport {
  recovered: number;
  cancelled: number;
  claimed: number;
  completed: number;
  failed: number;
  tasksClaimed: number;
  tasksCompleted: number;
  tasksFailed: number;
  /** Units and tasks handed back without spending an attempt (model unreachable). */
  deferred: number;
  planned: number;
  reduced: number;
}

function emptyReport(): TickReport {
  return {
    recovered: 0,
    cancelled: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    tasksClaimed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    deferred: 0,
    planned: 0,
    reduced: 0,
  };
}

function safeMessage(error: unknown): string {
  if (error instanceof LocalGenerationError) return `${error.code}: ${error.message}`;
  const message = error instanceof Error ? error.message : String(error);
  return clip(message, 300);
}

/** The run was planned under another analysis version and cannot be continued. */
export const ANALYSIS_VERSION_CHANGED_TR =
  "Bu inceleme, analiz aşamalarının farklı bir sürümüyle başlatılmış; o sürümün ara sonuçları" +
  " bu sürümle birleştirilemez. İnceleme tamamlanmadı; yeni bir inceleme başlatın.";

/** Planning kept failing; the run is closed as failed with its coverage. */
export const PLANNING_FAILED_TR =
  "Analiz aşamaları planlanamadı ve deneme hakkı bitti; inceleme tamamlanmadı.";

/** Assembling the result kept failing; the run is closed as failed with its coverage. */
export const FINALIZE_FAILED_TR =
  "İncelemenin sonuçları bir araya getirilemedi ve deneme hakkı bitti; inceleme tamamlanmadı.";

/**
 * The orchestrator stage kept dying without returning (the process crashed
 * or was killed during it) and its budget is spent (W21 round two, R2-16).
 */
export const STAGE_CRASHED_TR =
  "İncelemenin analiz aşaması art arda yarıda kaldı (işi yürüten süreç yanıt vermeden durdu) ve" +
  " deneme hakkı bitti; inceleme tamamlanmadı.";

/** Default backoff steps while the local model cannot be reached (R2-19). */
export const DEFAULT_MODEL_OUTAGE_BACKOFF_MS: readonly number[] = Object.freeze([10_000, 30_000, 120_000, 300_000]);
/** Default bound of a continuous endpoint outage before attempts are spent again (R2-19). */
export const DEFAULT_MODEL_OUTAGE_WINDOW_MS = 30 * 60_000;
/** Default grace of one unit's or task's request failures before attempts are spent (R2-19). */
export const DEFAULT_REQUEST_FAILURE_GRACE_MS = 5 * 60_000;

/** HTTP statuses that say the model server cannot serve ANY request right now. */
const ENDPOINT_FAILURE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/**
 * Where a model TRANSPORT failure most likely lies (R2-19):
 *
 *   endpoint  the model server could not be reached (connection refused or
 *             dropped) or said it serves nobody right now (429, 502, 503
 *             while it loads its weights, 504). Other requests would fail
 *             the same way, so model work pauses.
 *   request   the server was reached, but THIS request timed out or was
 *             answered 408/500/another 5xx. That can be this one request —
 *             a prompt slower than the time-out — so nothing else pauses.
 *
 * Neither class is proof: a request can crash the server (endpoint), and a
 * hung server times out every request (request). The worker therefore also
 * watches whether other model calls succeed (AnalysisWorker.transportDecision).
 */
export type TransportFailureScope = "endpoint" | "request";

/** The scope of a model transport failure, or null for any other failure. */
export function transportFailureScope(error: unknown): TransportFailureScope | null {
  if (!(error instanceof LocalGenerationError)) return null;
  if (error.code === "UNREACHABLE") return "endpoint";
  if (error.code === "TIMEOUT") return "request";
  if (error.code !== "HTTP" || error.status === undefined) return null;
  if (ENDPOINT_FAILURE_STATUSES.has(error.status)) return "endpoint";
  if (error.status === 408 || error.status >= 500) return "request";
  return null;
}

/**
 * A failure of the model TRANSPORT, not of the model's answer: retrying
 * later can succeed, so it does not spend an attempt at once (R2-19). A
 * malformed or empty answer, a refused boundary, a 4xx or a changed model is
 * NOT transient.
 */
export function isTransientModelFailure(error: unknown): boolean {
  return transportFailureScope(error) !== null;
}

/** What one unit's or task's failure costs (R2-19). */
type TransportDecision =
  | { readonly defer: true; readonly backoffMs: number; readonly pauseModel: boolean }
  | { readonly defer: false; readonly pauseModel: boolean };

/** The transport-failure history of one unit or task, in this process. */
interface TransportRecord {
  /** Successful model calls counted when this work's last transport failure happened. */
  successesAtFailure: number;
  /** When this work's first REQUEST failure happened (start of its grace). */
  firstRequestFailureAt: number | undefined;
  /** Request-failure deferrals of this work (picks its own backoff step). */
  requestDeferrals: number;
  /** The model answered other calls while this work's requests kept failing. */
  requestSpecific: boolean;
  /** The scope of this work's previous transport failure. */
  lastScope: TransportFailureScope | undefined;
  /**
   * This work made the ENDPOINT fail again after other calls had answered
   * around its previous endpoint failure: it brings the server down.
   */
  endpointSpecific: boolean;
}

/** Bound of the in-memory transport history (oldest entries are dropped). */
const TRANSPORT_HISTORY_LIMIT = 10_000;

function unitWorkKey(claim: UnitClaim): string {
  return `unit:${claim.runId}:${claim.unitNo}`;
}

function taskWorkKey(claim: StageTaskClaim): string {
  return `task:${claim.taskId}`;
}

/** Whether a unit of this task calls the extraction model. */
function needsModel(task: AnalysisTask): boolean {
  const spec = TASK_SPECS[task];
  return spec.requiresModel && spec.modelKinds.length > 0;
}

/** Tasks whose units are read without any model (claimed while the model backs off). */
const NO_MODEL_TASKS: readonly AnalysisTask[] = ANALYSIS_TASKS.filter((task) => !needsModel(task));

/** The current intelligence + stage version, as routes.ts pins it in the identity. */
export const CURRENT_INTEL_VERSION = `${INTEL_VERSION}+${STAGE_SCHEMA_VERSION}`;

/**
 * Why a run may not be continued by this code, or null. A run created
 * under another intelligence/stage version, or holding task rows planned
 * under another stage schema, would have its stored results read with
 * item-key and payload rules they were not written with — a stored
 * "supports" could then resolve to nothing and read as "unsupported" (W21
 * review #16). Such a run is failed with the reason, never finalized.
 */
export function versionMismatch(
  run: { readonly snapshot: Pick<RunSnapshot, "identity"> },
  tasks: ReadonlyArray<Pick<StageTaskRow, "schemaVersion">>,
): string | null {
  if (run.snapshot.identity !== "") {
    try {
      const identity = JSON.parse(run.snapshot.identity) as {
        intelVersion?: unknown;
        modelSchemaVersion?: unknown;
        extractorVersion?: unknown;
      };
      if (typeof identity.intelVersion === "string" && identity.intelVersion !== CURRENT_INTEL_VERSION) {
        return `${ANALYSIS_VERSION_CHANGED_TR} (${identity.intelVersion} → ${CURRENT_INTEL_VERSION})`;
      }
      // Units extracted under another acceptance rule (mx-v2 bound repairs
      // by word overlap, W21 review #10) must not be mixed into one result
      // with units extracted under this one.
      if (
        typeof identity.modelSchemaVersion === "string" &&
        identity.modelSchemaVersion !== MODEL_EXTRACTOR_VERSION
      ) {
        return `${ANALYSIS_VERSION_CHANGED_TR} (${identity.modelSchemaVersion} → ${MODEL_EXTRACTOR_VERSION})`;
      }
      // The same for the DETERMINISTIC extractor: units read under another
      // rule set (extract-v3 party/exhibit rules) must not be finished under
      // this one and mixed into one result.
      if (typeof identity.extractorVersion === "string" && identity.extractorVersion !== EXTRACTOR_VERSION) {
        return `${ANALYSIS_VERSION_CHANGED_TR} (${identity.extractorVersion} → ${EXTRACTOR_VERSION})`;
      }
    } catch {
      // An unreadable identity is not a version mismatch; the task rows decide.
    }
  }
  const foreign = tasks.find((row) => row.schemaVersion !== null && row.schemaVersion !== STAGE_SCHEMA_VERSION);
  if (foreign !== undefined) {
    return `${ANALYSIS_VERSION_CHANGED_TR} (${foreign.schemaVersion} → ${STAGE_SCHEMA_VERSION})`;
  }
  return null;
}

/** A unit whose text no longer hashes to its census value. */
class SourceMismatchError extends Error {
  constructor() {
    super("Bölümün metni sayımdaki özet değeriyle eşleşmiyor; kaynak değişmiş.");
    this.name = "SourceMismatchError";
  }
}

/** Orchestrator passes per tick; a safety bound, each pass makes progress. */
const MAX_ORCHESTRATIONS_PER_TICK = 64;
const EMBED_BATCH = 32;

export class AnalysisWorker {
  readonly workerId: string;
  private readonly store: DurableAnalysisStore;
  private readonly options: AnalysisWorkerOptions;
  private readonly stageConfig: StageConfig;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private kicked = false;
  private readonly idle: Array<() => void> = [];
  /** Successful model calls of this process: the evidence that the model answers (R2-19). */
  private modelSuccesses = 0;
  /** First ENDPOINT failure since the last successful model call (R2-19). */
  private modelOutageSince: number | undefined;
  /** No model work is claimed before this time. */
  private modelRetryAt = 0;
  /** Endpoint deferrals in the current outage (picks the shared backoff step). */
  private outageDeferrals = 0;
  /** Units and tasks whose model requests failed at the transport (R2-19). */
  private readonly transportHistory = new Map<string, TransportRecord>();

  constructor(options: AnalysisWorkerOptions) {
    this.options = options;
    this.store = options.store;
    this.stageConfig = options.stageConfig ?? DEFAULT_STAGE_CONFIG;
    this.workerId = options.workerId ?? `analysis-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  private get models(): WorkerModelRoutes {
    return this.options.models?.() ?? {};
  }

  private log(event: Record<string, unknown>): void {
    this.options.log?.({ worker: this.workerId, ...event });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** `generator`, with every successful call ending a model outage. */
  private tracked(generator: JsonGenerator | undefined): JsonGenerator | undefined {
    if (generator === undefined) return undefined;
    return {
      model: generator.model,
      trust: generator.trust,
      generateJson: async <T = unknown>(request: Parameters<JsonGenerator["generateJson"]>[0]): Promise<T> => {
        const result = await generator.generateJson<T>(request);
        this.modelSuccesses += 1;
        this.modelOutageSince = undefined;
        this.outageDeferrals = 0;
        this.modelRetryAt = 0;
        return result;
      },
    };
  }

  /**
   * What the failure of one unit or task costs (R2-19). Not a transport
   * failure: an attempt. A transport failure: no attempt while it can still
   * be an outage of the model — but an attempt as soon as a model call has
   * succeeded since this work's previous transport failure, and on every
   * later transport failure of this work. Then the model answers and THIS
   * work's requests do not (a prompt slower than the time-out, a request that
   * brings the server down); waiting for it would only repeat a failing call
   * ahead of every other run.
   *
   *   endpoint failure  pauses model work for the shared backoff step (the
   *                     server refused, others would fail the same way) and
   *                     is waited out until the outage window is spent;
   *   request failure   pauses nothing; the work waits its own backoff step
   *                     and is waited out only for the request grace.
   */
  private transportDecision(workKey: string, error: unknown): TransportDecision {
    const scope = transportFailureScope(error);
    if (scope === null) return { defer: false, pauseModel: false };
    const now = this.now();
    let record = this.transportHistory.get(workKey);
    const answeredMeanwhile = record !== undefined && this.modelSuccesses > record.successesAtFailure;
    if (record === undefined) {
      if (this.transportHistory.size >= TRANSPORT_HISTORY_LIMIT) {
        const oldest = this.transportHistory.keys().next();
        if (oldest.done !== true) this.transportHistory.delete(oldest.value);
      }
      record = {
        successesAtFailure: this.modelSuccesses,
        firstRequestFailureAt: undefined,
        requestDeferrals: 0,
        requestSpecific: false,
        lastScope: undefined,
        endpointSpecific: false,
      };
      this.transportHistory.set(workKey, record);
    }
    record.successesAtFailure = this.modelSuccesses;
    if (answeredMeanwhile) record.requestSpecific = true;
    // Only an endpoint failure repeated around other answers says THIS work
    // brings the server down; a slow request earlier (a time-out) says
    // nothing about a later restart (W21 closing re-check).
    if (scope === "endpoint" && answeredMeanwhile && record.lastScope === "endpoint") record.endpointSpecific = true;
    record.lastScope = scope;
    const steps = this.options.modelOutageBackoffMs ?? DEFAULT_MODEL_OUTAGE_BACKOFF_MS;

    if (scope === "endpoint") {
      if (this.modelOutageSince === undefined) this.modelOutageSince = now;
      const window = this.options.modelOutageWindowMs ?? DEFAULT_MODEL_OUTAGE_WINDOW_MS;
      if (now - this.modelOutageSince >= window) {
        this.log({ event: "model-outage-window-spent", outageMs: now - this.modelOutageSince });
        return { defer: false, pauseModel: false };
      }
      // The server refused: other model calls would fail the same way now,
      // whatever this work's own fate is.
      const delay = Math.max(0, steps[Math.min(this.outageDeferrals, steps.length - 1)] ?? 0);
      this.outageDeferrals += 1;
      this.modelRetryAt = now + delay;
      // An endpoint failure spends an attempt only when this work has made
      // the endpoint fail around other answers before. A request that merely
      // timed out once, followed by a real restart, is waited out like any
      // outage instead of failing for good (W21 closing re-check).
      if (record.endpointSpecific) {
        this.log({ event: "transport-failure-after-model-answered", scope });
        return { defer: false, pauseModel: true };
      }
      return { defer: true, backoffMs: delay, pauseModel: true };
    }

    if (record.firstRequestFailureAt === undefined) record.firstRequestFailureAt = now;
    if (record.requestSpecific) {
      this.log({ event: "transport-failure-after-model-answered", scope });
      return { defer: false, pauseModel: false };
    }
    const grace = this.options.requestFailureGraceMs ?? DEFAULT_REQUEST_FAILURE_GRACE_MS;
    if (now - record.firstRequestFailureAt >= grace) {
      this.log({ event: "request-failure-grace-spent", failingMs: now - record.firstRequestFailureAt });
      return { defer: false, pauseModel: false };
    }
    const delay = Math.max(0, steps[Math.min(record.requestDeferrals, steps.length - 1)] ?? 0);
    record.requestDeferrals += 1;
    return { defer: true, backoffMs: delay, pauseModel: false };
  }

  /**
   * The batch with every unit or task whose last model request failed at the
   * transport moved behind the rest (R2-19). The rest then shows whether the
   * model answers before the suspect is called again: if it does, the
   * suspect's next failure spends an attempt; if the server is really down,
   * the first of the rest fails and the suspect goes back untouched. A
   * suspect first in claim order would otherwise fail first in every batch
   * and hold back the evidence that it alone is failing.
   */
  private suspectsLast<T>(claims: readonly T[], key: (claim: T) => string): T[] {
    const suspect = (claim: T): boolean => this.transportHistory.has(key(claim));
    return [...claims.filter((claim) => !suspect(claim)), ...claims.filter(suspect)];
  }

  /**
   * Fail every active run this code may not continue (versionMismatch)
   * BEFORE any of its work is claimed (W21 round two, R2-17): reading such a
   * run only spends hours on a result that can never be finalized, ahead of
   * the run that replaces it. Returns every such run: nothing of theirs is
   * claimed in this tick — whether it was failed now, could not be leased
   * (another worker holds its stage lease) or its failure could not be
   * written (then it was handed back for a later tick to fail).
   */
  private async failForeignVersionRuns(report: TickReport): Promise<string[]> {
    const blocked: string[] = [];
    for (const row of await this.store.activeRunVersions()) {
      const mismatch = versionMismatch(
        { snapshot: { identity: row.identity } },
        row.foreignSchemaVersion === null ? [] : [{ schemaVersion: row.foreignSchemaVersion }],
      );
      if (mismatch === null) continue;
      blocked.push(row.runId);
      const run = await this.store.claimRunForFailure(row.runId, this.workerId, this.options.stageLeaseMs ?? 15 * 60_000);
      if (run === undefined) continue;
      await this.failRun(run, mismatch, { versionMismatch: true, notes: [mismatch] });
      report.reduced += 1;
    }
    return blocked;
  }

  /** One pass over everything that can be done right now. */
  async tick(): Promise<TickReport> {
    const report = emptyReport();
    report.recovered = (await this.store.recoverStale()) + (await this.store.recoverStaleStageTasks());

    for (const runId of await this.store.claimCancellations()) {
      await this.finalizeCancelled(runId);
      report.cancelled += 1;
    }

    // ---- version sweep: before anything is claimed (R2-17) ------------------
    const blocked = await this.failForeignVersionRuns(report);

    // While the model backs off after an endpoint failure, only work that
    // needs no model is claimed (R2-19).
    const modelOpen = this.now() >= this.modelRetryAt;
    let modelDown = false;

    // ---- reading ---------------------------------------------------------
    const unitFilter: ClaimFilter = {
      ...(blocked.length > 0 ? { excludeRunIds: blocked } : {}),
      ...(modelOpen ? {} : { tasks: NO_MODEL_TASKS }),
    };
    const claims = this.suspectsLast(
      await this.store.claimUnits(
        this.workerId,
        this.options.batchSize ?? 4,
        this.options.unitLeaseMs ?? 5 * 60_000,
        unitFilter,
      ),
      unitWorkKey,
    );
    report.claimed = claims.length;
    const documents = new Map<string, ScopedDocument>();

    for (let index = 0; index < claims.length; index += 1) {
      const claim = claims[index] as UnitClaim;
      // A cancel request that arrived mid-batch: hand the rest back untouched.
      if (await this.store.isCancelRequested(claim.runId)) {
        await this.store.releaseUnits(
          claims.slice(index).filter((other) => other.runId === claim.runId),
          this.workerId,
        );
        continue;
      }
      // The model server refused earlier in this batch: its other model
      // units go back untouched (no model call, no attempt spent).
      if (modelDown && needsModel(claim.task)) {
        await this.store.releaseUnits([claim], this.workerId);
        continue;
      }
      try {
        await this.options.hooks?.beforeUnit?.(claim);
        const { observations, completion } = await this.processUnit(claim, documents);
        await this.store.completeUnit(claim, this.workerId, observations, completion);
        this.transportHistory.delete(unitWorkKey(claim));
        report.completed += 1;
        await this.options.hooks?.afterUnit?.(claim);
      } catch (error) {
        if (error instanceof WorkerAbort) throw error;
        if (error instanceof LeaseLostError) {
          this.log({ event: "unit-lease-lost", runId: claim.runId, unitNo: claim.unitNo });
          continue;
        }
        const transport = this.transportDecision(unitWorkKey(claim), error);
        // Only an ENDPOINT failure holds back the batch's other model units;
        // one request's time-out does not (R2-19).
        if (transport.pauseModel) modelDown = true;
        if (transport.defer) {
          await this.store.deferUnit(claim, this.workerId, safeMessage(error), transport.backoffMs);
          report.deferred += 1;
          this.log({ event: "unit-deferred", runId: claim.runId, unitNo: claim.unitNo, retryInMs: transport.backoffMs });
          continue;
        }
        await this.store.failUnit(
          claim,
          this.workerId,
          safeMessage(error),
          this.options.retryBackoffMs ?? 10_000,
        );
        report.failed += 1;
        this.log({ event: "unit-failed", runId: claim.runId, unitNo: claim.unitNo, attempt: claim.attempts });
      }
    }

    // ---- analytical tasks ----------------------------------------------------
    // Every analytical task is a model call: none is claimed while the model
    // backs off or its server refused during this tick (R2-19).
    const tasks =
      modelOpen && !modelDown
        ? this.suspectsLast(
            await this.store.claimStageTasks(
              this.workerId,
              this.options.taskBatchSize ?? 4,
              this.options.taskLeaseMs ?? 5 * 60_000,
              blocked.length > 0 ? { excludeRunIds: blocked } : undefined,
            ),
            taskWorkKey,
          )
        : [];
    report.tasksClaimed = tasks.length;
    for (let index = 0; index < tasks.length; index += 1) {
      const claim = tasks[index] as StageTaskClaim;
      // A cancel request that arrived mid-batch: hand the rest back untouched,
      // exactly as the unit loop does — a cancelled run gets no more model
      // calls and stores no more results.
      if (await this.store.isCancelRequested(claim.runId)) {
        await this.store.releaseStageTasks(
          tasks.slice(index).filter((other) => other.runId === claim.runId),
          this.workerId,
        );
        continue;
      }
      try {
        await this.options.hooks?.beforeTask?.(claim);
        const generator = this.tracked(this.models.synthesis);
        if (generator === undefined) {
          throw new Error("Yerel dil modeli yapılandırılmamış; bu analiz görevi model gerektiriyor.");
        }
        const result = await processStageTask(claim, generator, this.stageConfig);
        await this.store.completeStageTask(claim, this.workerId, result, generator.model);
        this.transportHistory.delete(taskWorkKey(claim));
        report.tasksCompleted += 1;
        await this.options.hooks?.afterTask?.(claim);
      } catch (error) {
        if (error instanceof WorkerAbort) throw error;
        if (error instanceof LeaseLostError) {
          this.log({ event: "task-lease-lost", runId: claim.runId, stage: claim.stage });
          continue;
        }
        const transport = this.transportDecision(taskWorkKey(claim), error);
        if (transport.defer) {
          await this.store.deferStageTask(claim, this.workerId, safeMessage(error), transport.backoffMs);
          report.deferred += 1;
          this.log({ event: "task-deferred", runId: claim.runId, stage: claim.stage, retryInMs: transport.backoffMs });
        } else {
          await this.store.failStageTask(
            claim,
            this.workerId,
            safeMessage(error),
            this.options.retryBackoffMs ?? 10_000,
          );
          report.tasksFailed += 1;
          this.log({ event: "task-failed", runId: claim.runId, stage: claim.stage, attempt: claim.attempts });
        }
        if (transport.pauseModel) {
          // The model server refused: the rest of the batch needs the same
          // server, so it goes back untouched. One request's time-out does
          // not stop the batch (R2-19).
          await this.store.releaseStageTasks(tasks.slice(index + 1), this.workerId);
          break;
        }
      }
    }

    // ---- orchestration: plan the next step, or finalize --------------------
    for (let pass = 0; pass < MAX_ORCHESTRATIONS_PER_TICK; pass += 1) {
      const run = await this.store.claimReduce(this.workerId, this.options.stageLeaseMs ?? 15 * 60_000);
      if (run === undefined) break;
      const outcome = await this.orchestrate(run);
      if (outcome === "planned") report.planned += 1;
      else report.reduced += 1;
    }
    return report;
  }

  /**
   * Tick until a pass finds nothing to do. For tests and one-shot CLI runs;
   * work waiting out a retry backoff is NOT waited for.
   */
  async drain(maxTicks = 10_000): Promise<TickReport> {
    const total = emptyReport();
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const report = await this.tick();
      for (const key of Object.keys(total) as Array<keyof TickReport>) total[key] += report[key];
      if (
        report.claimed === 0 &&
        report.tasksClaimed === 0 &&
        report.planned === 0 &&
        report.reduced === 0 &&
        report.cancelled === 0
      ) {
        break;
      }
    }
    return total;
  }

  /** Start the background loop (idempotent). */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  /** Wake the loop now (a run was just created or cancelled). */
  kick(): void {
    if (this.stopped) return;
    if (this.running) {
      this.kicked = true;
      return;
    }
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) return;
    await new Promise<void>((resolve) => this.idle.push(resolve));
  }

  private schedule(delayMs: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), delayMs);
    if (this.options.keepProcessAlive !== true) this.timer.unref?.();
  }

  private async loop(): Promise<void> {
    this.timer = undefined;
    if (this.stopped || this.running) return;
    this.running = true;
    let busy = false;
    try {
      const report = await this.tick();
      busy =
        report.claimed + report.tasksClaimed + report.planned + report.reduced + report.cancelled + report.recovered > 0;
    } catch (error) {
      this.log({ event: "tick-failed", error: safeMessage(error) });
    } finally {
      this.running = false;
      for (const resolve of this.idle.splice(0)) resolve();
    }
    if (this.stopped) return;
    const again = busy || this.kicked;
    this.kicked = false;
    this.schedule(again ? 0 : this.options.pollIntervalMs ?? 1_000);
  }

  private async documentFor(
    claim: UnitClaim,
    cache: Map<string, ScopedDocument>,
  ): Promise<ScopedDocument> {
    const cached = cache.get(claim.documentVersionId);
    if (cached !== undefined) return cached;
    const [document] = await this.store.loadVersionDocuments(
      [[claim.fileId, claim.documentVersionId]],
      { withText: true },
    );
    if (document === undefined || document.extractionFailed === true) {
      throw new Error("Bu bölümün belge sürümü okunamadı.");
    }
    cache.set(claim.documentVersionId, document);
    return document;
  }

  private async processUnit(
    claim: UnitClaim,
    cache: Map<string, ScopedDocument>,
  ): Promise<{
    observations: NewObservation[];
    completion: {
      rejectedQuotes: number;
      invalidItems: number;
      extractorVersion: string;
      modelId?: string;
      modelSchemaVersion?: string;
      extraction: UnitExtractionStats;
    };
  }> {
    const document = await this.documentFor(claim, cache);
    const canonical = document.canonicalText;
    const unitText = codePointSlice(canonical, claim.startChar, claim.endChar);
    // The pinned version is immutable, so this can only fail if the store
    // was edited under us — and then nothing read from it may be trusted.
    if (sha256Hex(unitText) !== claim.sourceSha256) throw new SourceMismatchError();

    const observations: NewObservation[] = [];
    let rejectedQuotes = 0;
    let invalidItems = 0;
    let admitRejected = 0;

    /**
     * The provenance gate. An observation is written only when its offsets
     * slice the pinned canonical text back to exactly its quote and the
     * UTF-8 sha256 of that slice equals the stored quote hash.
     */
    const admit = (observation: NewObservation): void => {
      const slice = codePointSlice(canonical, observation.startChar, observation.endChar);
      if (slice !== observation.quote || quoteSha256(slice) !== observation.quoteSha256) {
        rejectedQuotes += 1;
        admitRejected += 1;
        return;
      }
      observations.push(observation);
    };

    const deterministic = this.options.extractDeterministic ?? extractPropositions;
    for (const draft of deterministic(unitText)) {
      const startChar = claim.startChar + draft.startChar;
      const endChar = claim.startChar + draft.endChar;
      admit({
        observationKey: observationKey({
          runId: claim.runId,
          unitNo: claim.unitNo,
          origin: "deterministic",
          producerVersion: EXTRACTOR_VERSION,
          kind: `proposition:${draft.kind}`,
          startChar,
          endChar,
          value: draft.normalizedValue,
        }),
        unitNo: claim.unitNo,
        fileId: claim.fileId,
        documentVersionId: claim.documentVersionId,
        kind: "proposition",
        origin: "deterministic",
        statement: draft.statement,
        subject: draft.subject,
        predicate: draft.predicate,
        occurredOn: draft.occurredOn,
        datePrecision: draft.datePrecision,
        startChar,
        endChar,
        quote: draft.quote,
        quoteSha256: quoteSha256(draft.quote),
        locator: locatorFor(document.segments, startChar, endChar),
        extractorVersion: EXTRACTOR_VERSION,
        metadata: { valueKind: draft.kind, normalizedValue: draft.normalizedValue },
      });
    }

    const spec = TASK_SPECS[claim.task];
    let modelId: string | undefined;
    let extraction: UnitExtractionStats = {
      state: "not_required",
      generatedItems: 0,
      acceptedItems: 0,
      ambiguousQuotes: 0,
      truncatedResponses: 0,
      continuationPasses: 0,
      repairPasses: 0,
    };
    if (spec.requiresModel && spec.modelKinds.length > 0) {
      const generator = this.tracked(this.models.extraction);
      if (generator === undefined) {
        throw new Error("Yerel dil modeli yapılandırılmamış; bu bölüm model gerektiriyor.");
      }
      // A run is frozen to the model it was created with. Mixing two models'
      // output under one ledger would make the run's results incomparable.
      if (claim.modelId !== null && !claim.modelId.split("+").includes(generator.model)) {
        throw new Error(
          "Yapılandırılmış model, incelemenin başlatıldığı modelden farklı; bu" +
            " inceleme karışık modelle sürdürülmez. Yeni bir inceleme başlatın.",
        );
      }
      const result = await extractExhaustively(generator, unitText, spec.modelKinds);
      rejectedQuotes += result.notFoundQuotes;
      invalidItems += result.invalidItems;
      const before = observations.length;
      for (const item of result.items) {
        const startChar = claim.startChar + item.startChar;
        const endChar = claim.startChar + item.endChar;
        admit({
          observationKey: observationKey({
            runId: claim.runId,
            unitNo: claim.unitNo,
            origin: "model",
            producerVersion: `${MODEL_EXTRACTOR_VERSION}:${generator.model}`,
            kind: item.kind,
            startChar,
            endChar,
            value: item.normalizedValue,
          }),
          unitNo: claim.unitNo,
          fileId: claim.fileId,
          documentVersionId: claim.documentVersionId,
          kind: item.kind,
          origin: "model",
          statement: item.statement,
          subject: item.subject,
          predicate: item.predicate,
          occurredOn: item.occurredOn,
          datePrecision: item.datePrecision,
          startChar,
          endChar,
          quote: item.quote,
          quoteSha256: quoteSha256(item.quote),
          locator: locatorFor(document.segments, startChar, endChar),
          extractorVersion: MODEL_EXTRACTOR_VERSION,
          modelId: generator.model,
          provider: generator.trust,
          modelSchemaVersion: MODEL_EXTRACTOR_VERSION,
          confidence: item.confidence,
          metadata: {
            normalizedValue: item.normalizedValue,
            occurrences: item.occurrences,
            ...(item.party !== undefined ? { party: item.party } : {}),
            ...(item.role !== undefined ? { role: item.role } : {}),
            ...(item.entityType !== undefined ? { entityType: item.entityType } : {}),
          },
        });
      }
      modelId = generator.model;
      extraction = {
        // Failed extraction is never hidden inside a done unit: anything lost
        // on the way (cut responses, unplaceable or malformed items, a quote
        // the provenance gate refused) makes this unit's extraction incomplete.
        state: result.complete && admitRejected === 0 ? "succeeded" : "incomplete",
        generatedItems: result.generated,
        acceptedItems: observations.length - before,
        ambiguousQuotes: result.ambiguousQuotes,
        truncatedResponses: result.truncatedResponses,
        continuationPasses: result.continuationPasses,
        repairPasses: result.repairPasses,
      };
    }

    return {
      observations,
      completion: {
        rejectedQuotes,
        invalidItems,
        extractorVersion: EXTRACTOR_VERSION,
        extraction,
        ...(modelId !== undefined ? { modelId, modelSchemaVersion: MODEL_EXTRACTOR_VERSION } : {}),
      },
    };
  }

  private async coverageFor(runId: string, versions: ReadonlyArray<readonly [string, string | null]>) {
    const ledger = await this.store.loadLedger(runId);
    const documents = await this.store.loadVersionDocuments(versions, { withText: false });
    return runReduce(documents, ledger, [], []).coverage;
  }

  private async finalizeCancelled(runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (run?.snapshot === undefined) return;
    await this.store.finishCancelled(runId, await this.coverageFor(runId, run.snapshot.versions));
    this.log({ event: "run-cancelled", runId });
  }

  /** Embed statements for the next planning step; failure means no signal. */
  private async embeddingsFor(
    runId: string,
    requests: ReturnType<typeof embeddingRequests>,
  ): Promise<{
    itemEmbeddings?: Map<string, readonly number[]>;
    observationEmbeddings?: Map<string, readonly number[]>;
  }> {
    const embedder = this.options.embedder?.();
    if (embedder === undefined || requests.items.length + requests.observations.length === 0) return {};
    const prefix = this.options.embeddingPrefix ?? "query: ";
    const embedAll = async (entries: ReadonlyArray<{ key: string; text: string }>) => {
      const out = new Map<string, readonly number[]>();
      for (let at = 0; at < entries.length; at += EMBED_BATCH) {
        const batch = entries.slice(at, at + EMBED_BATCH);
        const vectors = await embedder.embed(batch.map((entry) => `${prefix}${entry.text.slice(0, 1000)}`));
        if (vectors.length !== batch.length) throw new Error("embedding count mismatch");
        batch.forEach((entry, index) => out.set(entry.key, vectors[index] as readonly number[]));
      }
      return out;
    };
    try {
      return {
        itemEmbeddings: await embedAll(requests.items),
        observationEmbeddings: await embedAll(requests.observations),
      };
    } catch (error) {
      this.log({ event: "embeddings-unavailable", runId, error: safeMessage(error) });
      return {};
    }
  }

  /**
   * Close a run as FAILED with its source coverage and the reason, so it
   * reaches a terminal state that reports its incompleteness instead of
   * staying "reducing" forever. Nothing derived is stored.
   */
  private async failRun(run: ReduceClaim, reason: string, summary: Record<string, unknown>): Promise<void> {
    let coverage;
    try {
      coverage = await this.coverageFor(run.runId, run.snapshot.versions);
    } catch {
      coverage = runReduce([], [], [], []).coverage;
    }
    try {
      await this.store.saveReduceResult(run.runId, this.workerId, {
        relations: [],
        semanticRelations: [],
        items: [],
        links: [],
        coverage,
        summary: { ...summary, limitsTr: TASK_SPECS[run.task].limitsTr },
        status: "failed",
        error: reason,
      });
      this.log({ event: "run-failed", runId: run.runId, reason });
    } catch (error) {
      if (error instanceof LeaseLostError) return;
      await this.store.releaseReduce(run.runId, this.workerId, safeMessage(error), this.options.stageBackoffMs ?? 30_000);
    }
  }

  /** The planning retry budget is spent (the same bound the finalize path uses). */
  private budgetSpent(run: ReduceClaim): boolean {
    return run.stageAttempts >= run.maxStageAttempts + 2;
  }

  /** Plan the next analytical step, or finalize the run. */
  private async orchestrate(run: ReduceClaim): Promise<"planned" | "finalized"> {
    // W21 round two (R2-16): a pass that crashed the process (out of memory
    // while planning, a kill) never reaches a catch below, so its attempt was
    // never held against the budget and the run was re-claimed — and crashed
    // the server again — forever. The count is checked HERE, before any
    // heavy work. A planning pass that returns gives its attempt back
    // (releaseAfterPlanning) and a pass that errors is closed by its catch at
    // the budget itself, so only passes that never returned can bring a run
    // past it. Closing stays cheap: source coverage and one write.
    if (run.stageAttempts > run.maxStageAttempts + 2) {
      await this.failRun(run, STAGE_CRASHED_TR, { stageCrashed: true, notes: [STAGE_CRASHED_TR] });
      return "finalized";
    }
    const spec = TASK_SPECS[run.task];
    const synthesis = spec.requiresModel ? this.models.synthesis : undefined;
    let decisions: PlanningDecision[];
    let observations: StoredObservation[];
    let tasks: StageTaskRow[];
    let extraction: ExtractionCoverage;
    try {
      observations = await this.store.loadObservations(run.runId);
      tasks = await this.store.loadTasks(run.runId);
      // Before planning or finalizing: this code continues only a run of
      // its own version. Anything else is failed with the reason.
      const mismatch = versionMismatch(run, tasks);
      if (mismatch !== null) {
        await this.failRun(run, mismatch, { versionMismatch: true, notes: [mismatch] });
        return "finalized";
      }
      extraction = deriveExtractionCoverage(
        await this.store.loadExtractionLedger(run.runId),
        spec.requiresModel && spec.modelKinds.length > 0,
      );
      // Source coverage: an unread file or page keeps every search partial.
      const source = await this.coverageFor(run.runId, run.snapshot.versions);
      const base = {
        task: run.task,
        observations,
        tasks,
        config: this.stageConfig,
        clientRole: run.snapshot.clientRole,
        extractionComplete: extraction.complete,
        sourceComplete: source.complete,
      };
      const embeddings = await this.embeddingsFor(run.runId, embeddingRequests(base));
      decisions = nextDecisions({ ...base, ...embeddings });
    } catch (error) {
      if (error instanceof LeaseLostError) return "planned";
      // A planning pass that keeps failing must not retry forever: after
      // the stage budget (plus grace) the run is closed as failed, with its
      // coverage and the reason — the same bound the finalize path applies.
      if (this.budgetSpent(run)) {
        await this.failRun(run, `${PLANNING_FAILED_TR} ${safeMessage(error)}`, {
          planningFailed: true,
          notes: [PLANNING_FAILED_TR],
        });
        return "finalized";
      }
      await this.store.releaseReduce(run.runId, this.workerId, safeMessage(error), this.options.stageBackoffMs ?? 30_000);
      this.log({ event: "orchestration-retry", runId: run.runId, attempt: run.stageAttempts });
      return "planned";
    }

    const plans = decisions.filter(
      (decision): decision is Extract<PlanningDecision, { kind: "plan" }> => decision.kind === "plan",
    );
    if (plans.length > 0 || decisions.some((decision) => decision.kind === "wait")) {
      try {
        for (const plan of plans) {
          await this.store.insertStageTasks(
            run.runId,
            this.workerId,
            plan.specs,
            { step: plan.step, result: plan.marker },
            synthesis?.model ?? run.modelId,
          );
        }
      } catch (error) {
        if (error instanceof LeaseLostError) return "planned";
        if (this.budgetSpent(run)) {
          await this.failRun(run, `${PLANNING_FAILED_TR} ${safeMessage(error)}`, {
            planningFailed: true,
            notes: [PLANNING_FAILED_TR],
          });
          return "finalized";
        }
        await this.store.releaseReduce(run.runId, this.workerId, safeMessage(error), this.options.stageBackoffMs ?? 30_000);
        this.log({ event: "orchestration-retry", runId: run.runId, attempt: run.stageAttempts });
        return "planned";
      }
      await this.store.releaseAfterPlanning(run.runId, this.workerId);
      if (plans.length > 0) {
        this.log({
          event: "run-planned",
          runId: run.runId,
          steps: plans.map((plan) => plan.step),
          tasks: plans.reduce((total, plan) => total + plan.specs.length, 0),
        });
      }
      return "planned";
    }

    try {
      await this.finalize(run, observations, tasks, extraction, synthesis !== undefined);
    } catch (error) {
      // Anything that fails while the result is assembled (a store read, a
      // stored row the finalizer cannot read) is bounded by the same budget
      // as planning: retried, then the run is closed as failed with its
      // coverage — never left "reducing" to be re-claimed forever.
      if (error instanceof WorkerAbort) throw error;
      if (error instanceof LeaseLostError) return "planned";
      if (this.budgetSpent(run)) {
        await this.failRun(run, `${FINALIZE_FAILED_TR} ${safeMessage(error)}`, {
          finalizeFailed: true,
          notes: [FINALIZE_FAILED_TR],
        });
        return "finalized";
      }
      await this.store.releaseReduce(run.runId, this.workerId, safeMessage(error), this.options.stageBackoffMs ?? 30_000);
      this.log({ event: "finalize-retry", runId: run.runId, attempt: run.stageAttempts });
      return "planned";
    }
    return "finalized";
  }

  private async finalize(
    run: ReduceClaim,
    observations: StoredObservation[],
    tasks: StageTaskRow[],
    extraction: ExtractionCoverage,
    modelAvailable: boolean,
  ): Promise<void> {
    const spec = TASK_SPECS[run.task];
    // Source coverage FIRST: "no support after a complete search" also needs
    // every part of the file to have been read (an unread exhibit may be the
    // very evidence the claim needs).
    const coverage = await this.coverageFor(run.runId, run.snapshot.versions);
    const state = buildAnalyticalState({
      task: run.task,
      observations,
      tasks,
      extractionComplete: extraction.complete,
      sourceComplete: coverage.complete,
    });
    const final = finalizeIntelligence({ task: run.task, state, tasks, clientRole: run.snapshot.clientRole });
    const intelligence = deriveIntelligenceCoverage({
      task: run.task,
      tasks,
      claimsTotal: state.items.filter((item) => item.kind === "claim").length,
      defensesTotal: state.items.filter((item) => item.kind === "defense").length,
      evidenceItemsTotal: state.items.filter((item) => SUPPORT_UNIVERSE_KINDS.has(item.kind)).length,
      modelAvailable,
      finalized: true,
      unresolvedVerdictRefs: final.unresolvedVerdictRefs,
      // A weighing row counts only for a claim the run still holds.
      claimRefs: state.items.filter((item) => item.kind === "claim").map(itemRef),
      defenseRefs: state.items.filter((item) => item.kind === "defense").map(itemRef),
      // W22: what the value comparison compared, so the result can say it.
      valueComparison: state.valueComparison,
    });
    const ledger = await this.store.loadLedger(run.runId);

    const itemCounts: Record<string, number> = {};
    for (const item of final.items) itemCounts[item.kind] = (itemCounts[item.kind] ?? 0) + 1;
    const relationCounts: Record<string, number> = {};
    for (const relation of final.relations) {
      relationCounts[relation.relation] = (relationCounts[relation.relation] ?? 0) + 1;
    }
    const semanticCounts: Record<string, number> = {};
    for (const relation of final.semanticRelations) {
      semanticCounts[relation.relation] = (semanticCounts[relation.relation] ?? 0) + 1;
    }
    const stages = stagesFor(run.task);
    const synthesisRejected = tasks
      .filter((row) => (row.stage === "synthesis_group" || row.stage === "synthesis_reduce") && row.state === "done")
      .reduce((total, row) => total + Number(row.result?.["rejected"] ?? 0), 0);
    const summary = {
      observations: observations.length,
      modelObservations: observations.filter((observation) => observation.origin === "model").length,
      relations: relationCounts,
      semanticRelations: semanticCounts,
      items: itemCounts,
      droppedWithoutSource: final.droppedWithoutSource,
      searchStates: final.searchStates,
      // Comparisons whose candidate no longer resolves (0 unless the item
      // keys changed under the run); their claims are SEARCH_INCOMPLETE.
      unresolvedVerdictRefs: final.unresolvedVerdictRefs,
      // Weighing rows whose claim no longer resolves; counted for no claim.
      unresolvableWeighRows: final.unresolvableWeighRows,
      // Kept under the W20 key so existing readers still find the notes.
      synthesis: {
        performed: stages.synthesis && intelligence.synthesisGroupsProcessed > 0,
        failed: intelligence.failedStages.includes("synthesis"),
        truncated: intelligence.truncatedStages.length > 0,
        // Points rejected for citing nothing they were shown.
        rejected: synthesisRejected,
        notes: [...final.notes, ...intelligence.gapsTr],
        perspective: run.snapshot.clientRole,
        ...(run.task === "red_team"
          ? {
              contraryAuthority: {
                performed: false,
                reasonTr:
                  "Bu inceleme dosyadaki belgeleri okur; karşı yöndeki içtihat taraması" +
                  " bu incelemenin parçası değildir ve ayrıca araştırılmalıdır.",
              },
            }
          : {}),
      },
      limitsTr: spec.limitsTr,
      unitsWithErrors: ledger.filter((row) => row.state === "failed").length,
    };

    const result = {
      relations: final.relations,
      semanticRelations: final.semanticRelations,
      items: final.items,
      links: final.links,
      coverage,
      extractionCoverage: extraction,
      intelligenceCoverage: intelligence,
      summary,
    };
    try {
      await this.store.saveReduceResult(run.runId, this.workerId, { ...result, status: "done" });
      this.log({
        event: "run-reduced",
        runId: run.runId,
        sourceComplete: coverage.complete,
        extractionComplete: extraction.complete,
        intelligenceComplete: intelligence.complete,
      });
    } catch (error) {
      if (error instanceof LeaseLostError) return;
      // A write that keeps failing must not loop forever: after the stage
      // budget is spent (plus grace) the run is closed as failed, with its
      // coverage, rather than left "reducing" indefinitely.
      if (this.budgetSpent(run)) {
        await this.store.saveReduceResult(run.runId, this.workerId, {
          ...result,
          relations: [],
          semanticRelations: [],
          items: [],
          links: [],
          summary: { ...summary, saveFailed: true },
          status: "failed",
          error: safeMessage(error),
        });
        return;
      }
      await this.store.releaseReduce(
        run.runId,
        this.workerId,
        safeMessage(error),
        this.options.stageBackoffMs ?? 30_000,
      );
    }
  }
}
