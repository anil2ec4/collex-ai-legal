/**
 * The exhaustive-analysis WORKER (W20): durable, resumable, cancellable.
 *
 * W19 ran the whole map phase inside the HTTP request and persisted its
 * observations only at the end, so a process that died half-way through lost
 * everything the census said was pending. The worker replaces that with a
 * loop over small durable checkpoints:
 *
 *   1. recover stale leases (units a dead worker was holding);
 *   2. finalize cancelled runs (their untouched units stay NOT processed);
 *   3. claim a small batch of pending units under a lease;
 *   4. process each unit — deterministic extraction, then model-assisted
 *      extraction when the task requires it — and verify every quote
 *      against the pinned document version;
 *   5. persist the unit's observations and mark it done in ONE transaction;
 *   6. when a run has no pending/running unit left, reduce it: load the
 *      COMPLETE persisted observation set (not what this process produced),
 *      compare, build Matter Intelligence, derive coverage from the ledger,
 *      and write everything in one transaction.
 *
 * If the process dies after unit 846: units 1..845 are `done` with their
 * observations stored; unit 846 is `running` under an expiring lease and is
 * retried once the lease lapses; units 847+ are still `pending`. A new
 * worker — a new process, a new connection pool, a new object — continues
 * from exactly there.
 *
 * Nothing here logs document text, prompts or completions.
 */

import { randomUUID } from "node:crypto";
import { LocalGenerationError } from "../llm/localGenerationAdapter.js";
import {
  LeaseLostError,
  type DurableAnalysisStore,
  type NewObservation,
  type ReduceClaim,
  type UnitClaim,
} from "./durableStore.js";
import { observationKey } from "./identity.js";
import { reduceIntelligence, SynthesisError, type ReduceIntel } from "./intelligence.js";
import {
  extractWithModel,
  MODEL_EXTRACTOR_VERSION,
  type JsonGenerator,
} from "./modelExtractor.js";
import {
  EXTRACTOR_VERSION,
  extractPropositions,
  quoteSha256,
  type PropositionDraft,
} from "./observations.js";
import type { CoverageGap } from "./processingCoverage.js";
import { locatorFor, runReduce, type ScopedDocument } from "./runner.js";
import { TASK_SPECS } from "./tasks.js";
import { codePointSlice, sha256Hex } from "./units.js";

/** The model routes the worker may use. Resolved per call, never cached. */
export interface WorkerModelRoutes {
  readonly extraction?: JsonGenerator | undefined;
  readonly synthesis?: JsonGenerator | undefined;
}

/**
 * Thrown from a test hook to simulate the process dying: the worker does NOT
 * catch it, so whatever the unit had claimed stays `running` under its lease
 * exactly as it would after a real crash.
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
  /** Units claimed per tick (default 4). */
  readonly batchSize?: number;
  /** Lease per unit; must exceed the slowest model call (default 5 min). */
  readonly unitLeaseMs?: number;
  /** Lease for the reduce stage (default 15 min). */
  readonly stageLeaseMs?: number;
  /** Delay before a failed unit is retried (default 10 s). */
  readonly retryBackoffMs?: number;
  /** Delay before a failed reduce stage is retried (default 30 s). */
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
  reduced: number;
}

function safeMessage(error: unknown): string {
  if (error instanceof LocalGenerationError) return `${error.code}: ${error.message}`;
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

/** A unit whose text no longer hashes to its census value. */
class SourceMismatchError extends Error {
  constructor() {
    super("Bölümün metni sayımdaki özet değeriyle eşleşmiyor; kaynak değişmiş.");
    this.name = "SourceMismatchError";
  }
}

export class AnalysisWorker {
  readonly workerId: string;
  private readonly store: DurableAnalysisStore;
  private readonly options: AnalysisWorkerOptions;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private kicked = false;
  private readonly idle: Array<() => void> = [];

  constructor(options: AnalysisWorkerOptions) {
    this.options = options;
    this.store = options.store;
    this.workerId = options.workerId ?? `analysis-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  private get models(): WorkerModelRoutes {
    return this.options.models?.() ?? {};
  }

  private log(event: Record<string, unknown>): void {
    this.options.log?.({ worker: this.workerId, ...event });
  }

  /** One pass over everything that can be done right now. */
  async tick(): Promise<TickReport> {
    const report: TickReport = { recovered: 0, cancelled: 0, claimed: 0, completed: 0, failed: 0, reduced: 0 };
    report.recovered = await this.store.recoverStale();

    for (const runId of await this.store.claimCancellations()) {
      await this.finalizeCancelled(runId);
      report.cancelled += 1;
    }

    const claims = await this.store.claimUnits(
      this.workerId,
      this.options.batchSize ?? 4,
      this.options.unitLeaseMs ?? 5 * 60_000,
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
      try {
        await this.options.hooks?.beforeUnit?.(claim);
        const { observations, completion } = await this.processUnit(claim, documents);
        await this.store.completeUnit(claim, this.workerId, observations, completion);
        report.completed += 1;
        await this.options.hooks?.afterUnit?.(claim);
      } catch (error) {
        if (error instanceof WorkerAbort) throw error;
        if (error instanceof LeaseLostError) {
          this.log({ event: "unit-lease-lost", runId: claim.runId, unitNo: claim.unitNo });
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

    for (;;) {
      const run = await this.store.claimReduce(this.workerId, this.options.stageLeaseMs ?? 15 * 60_000);
      if (run === undefined) break;
      await this.reduce(run);
      report.reduced += 1;
    }
    return report;
  }

  /**
   * Tick until a pass finds nothing to do. For tests and one-shot CLI runs;
   * units waiting out a retry backoff are NOT waited for.
   */
  async drain(maxTicks = 10_000): Promise<TickReport> {
    const total: TickReport = { recovered: 0, cancelled: 0, claimed: 0, completed: 0, failed: 0, reduced: 0 };
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const report = await this.tick();
      for (const key of Object.keys(total) as Array<keyof TickReport>) total[key] += report[key];
      if (report.claimed === 0 && report.reduced === 0 && report.cancelled === 0) break;
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
      busy = report.claimed + report.reduced + report.cancelled + report.recovered > 0;
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

    /**
     * The provenance gate. An observation is written only when its offsets
     * slice the pinned canonical text back to exactly its quote and the
     * UTF-8 sha256 of that slice equals the stored quote hash.
     */
    const admit = (observation: NewObservation): void => {
      const slice = codePointSlice(canonical, observation.startChar, observation.endChar);
      if (slice !== observation.quote || quoteSha256(slice) !== observation.quoteSha256) {
        rejectedQuotes += 1;
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
    if (spec.requiresModel && spec.modelKinds.length > 0) {
      const generator = this.models.extraction;
      if (generator === undefined) {
        throw new Error("Yerel dil modeli yapılandırılmamış; bu bölüm model gerektiriyor.");
      }
      // A run is frozen to the model it was created with. Mixing two models'
      // output under one ledger would make the run's results incomparable.
      if (claim.modelId !== null && generator.model !== claim.modelId) {
        throw new Error(
          "Yapılandırılmış model, incelemenin başlatıldığı modelden farklı; bu" +
            " inceleme karışık modelle sürdürülmez. Yeni bir inceleme başlatın.",
        );
      }
      const result = await extractWithModel(generator, unitText, spec.modelKinds);
      rejectedQuotes += result.rejectedQuotes;
      invalidItems += result.invalidItems + result.truncatedItems;
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
    }

    return {
      observations,
      completion: {
        rejectedQuotes,
        invalidItems,
        extractorVersion: EXTRACTOR_VERSION,
        ...(modelId !== undefined ? { modelId, modelSchemaVersion: MODEL_EXTRACTOR_VERSION } : {}),
      },
    };
  }

  private async coverageFor(runId: string, versions: ReadonlyArray<readonly [string, string | null]>, extraGaps: readonly CoverageGap[] = []) {
    const ledger = await this.store.loadLedger(runId);
    const documents = await this.store.loadVersionDocuments(versions, { withText: false });
    return runReduce(documents, ledger, [], [], extraGaps).coverage;
  }

  private async finalizeCancelled(runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (run?.snapshot === undefined) return;
    await this.store.finishCancelled(runId, await this.coverageFor(runId, run.snapshot.versions));
    this.log({ event: "run-cancelled", runId });
  }

  private async reduce(run: ReduceClaim): Promise<void> {
    const spec = TASK_SPECS[run.task];
    const observations = await this.store.loadObservations(run.runId);
    const synthesis = spec.requiresModel ? this.models.synthesis : undefined;
    const modelSwapped =
      spec.requiresModel &&
      synthesis !== undefined &&
      run.snapshot.synthesisModel !== null &&
      synthesis.model !== run.snapshot.synthesisModel;
    const allowSynthesis = run.stageAttempts <= run.maxStageAttempts && !modelSwapped;

    let intel: ReduceIntel;
    try {
      intel = await reduceIntelligence({
        task: run.task,
        observations,
        generator: synthesis,
        clientRole: run.snapshot.clientRole,
        skipSynthesis: !allowSynthesis,
      });
    } catch (error) {
      const retryable = error instanceof SynthesisError || error instanceof LocalGenerationError;
      if (retryable && run.stageAttempts < run.maxStageAttempts) {
        await this.store.releaseReduce(
          run.runId,
          this.workerId,
          safeMessage(error),
          this.options.stageBackoffMs ?? 30_000,
        );
        this.log({ event: "reduce-retry", runId: run.runId, attempt: run.stageAttempts });
        return;
      }
      intel = await reduceIntelligence({
        task: run.task,
        observations,
        clientRole: run.snapshot.clientRole,
        skipSynthesis: true,
      });
    }

    const extraGaps: CoverageGap[] = intel.synthesis.failed
      ? [{ fileId: "*", locator: "değerlendirme aşaması", reason: "SYNTHESIS_FAILED" }]
      : [];
    const coverage = await this.coverageFor(run.runId, run.snapshot.versions, extraGaps);
    const ledger = await this.store.loadLedger(run.runId);

    const itemCounts: Record<string, number> = {};
    for (const item of intel.items) itemCounts[item.kind] = (itemCounts[item.kind] ?? 0) + 1;
    const relationCounts: Record<string, number> = {};
    for (const relation of intel.relations) {
      relationCounts[relation.relation] = (relationCounts[relation.relation] ?? 0) + 1;
    }
    const summary = {
      observations: observations.length,
      modelObservations: observations.filter((observation) => observation.origin === "model").length,
      relations: relationCounts,
      items: itemCounts,
      droppedWithoutSource: intel.droppedWithoutSource,
      synthesis: intel.synthesis,
      limitsTr: spec.limitsTr,
      unitsWithErrors: ledger.filter((row) => row.state === "failed").length,
    };

    try {
      await this.store.saveReduceResult(run.runId, this.workerId, {
        relations: intel.relations,
        items: intel.items,
        links: intel.links,
        coverage,
        summary,
        status: "done",
      });
      this.log({ event: "run-reduced", runId: run.runId, complete: coverage.complete });
    } catch (error) {
      if (error instanceof LeaseLostError) return;
      // A write that keeps failing must not loop forever: after the stage
      // budget is spent (plus grace) the run is closed as failed, with its
      // coverage, rather than left "reducing" indefinitely.
      if (run.stageAttempts >= run.maxStageAttempts + 2) {
        await this.store.saveReduceResult(run.runId, this.workerId, {
          relations: [],
          items: [],
          links: [],
          coverage,
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
