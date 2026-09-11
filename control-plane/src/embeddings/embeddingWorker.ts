/**
 * The embedding-job CONSUMER and backfill (W20 phase E).
 *
 * ingestion/jobs.py has enqueued `embedding` jobs on every publish since the
 * first migration, and nothing ever consumed them: the dense lane stayed a
 * stub because no vector was ever written. This worker closes that loop for
 * the local E5 profile:
 *
 *   1. requeue jobs stuck `running` past their lease (a dead worker);
 *   2. BACKFILL: find current tenant versions with chunks lacking a fresh
 *      vector (hash-aware — a changed chunk has a stale vector) and enqueue
 *      a job for each, idempotently (the in-flight unique index);
 *   3. claim this profile's jobs (`for update skip locked`);
 *   4. embed the version's chunks that still need a vector, in batches, with
 *      the E5 passage prefix; L2-normalize; store float32 bytes plus the
 *      sha256 of the exact input and the chunk's content hash;
 *   5. mark the job succeeded, or fail it with backoff (the queue's own
 *      fail_job dead-letters after max_attempts).
 *
 * Resumable and idempotent by construction: every step reads what is still
 * missing from the database, so a restart re-derives the remaining work and a
 * repeated job embeds nothing it already has.
 *
 * Observable: `status()` reports what it did and the last failure (a fixed
 * safe message — never document text, never a provider body).
 */

import { createHash, randomUUID } from "node:crypto";
import { formatDocumentText, type EmbeddingPromptStyle } from "../retrieval/embeddingConfig.js";
import type { EmbeddingPort } from "../retrieval/semanticRerank.js";
import type { ChunkVectorStore, EmbeddingProfile } from "./chunkVectorStore.js";
import { encodeVector, l2Normalize } from "./vectorCodec.js";

export interface EmbeddingWorkerOptions {
  readonly store: ChunkVectorStore;
  readonly embedder: EmbeddingPort;
  readonly profile: EmbeddingProfile;
  readonly workerId?: string;
  /** Texts per embedding request (the local server accepts at most 41). */
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  /** Jobs stuck running longer than this are requeued (default 10 min). */
  readonly stuckAfterSeconds?: number;
  readonly retryBackoffSeconds?: number;
  readonly keepProcessAlive?: boolean;
  readonly log?: (event: Record<string, unknown>) => void;
}

export interface EmbeddingTick {
  requeued: number;
  enqueued: number;
  claimed: number;
  embedded: number;
  failed: number;
}

export interface EmbeddingWorkerStatus {
  readonly profile: string;
  readonly embeddedTotal: number;
  readonly jobsDone: number;
  readonly jobsFailed: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastFailure: string | null;
}

/** Longest chunk text sent to the embedder, in code points. */
export const MAX_EMBED_INPUT_CODE_POINTS = 8_000;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function clipCodePoints(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join("");
}

export class EmbeddingWorker {
  readonly workerId: string;
  private readonly options: EmbeddingWorkerOptions;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private readonly idle: Array<() => void> = [];
  private counters = { embeddedTotal: 0, jobsDone: 0, jobsFailed: 0 };
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastFailure: string | null = null;

  constructor(options: EmbeddingWorkerOptions) {
    this.options = options;
    this.workerId = options.workerId ?? `embedding-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  status(): EmbeddingWorkerStatus {
    return {
      profile: this.options.profile.key,
      ...this.counters,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastFailure: this.lastFailure,
    };
  }

  async tick(): Promise<EmbeddingTick> {
    const { store, profile } = this.options;
    const report: EmbeddingTick = { requeued: 0, enqueued: 0, claimed: 0, embedded: 0, failed: 0 };
    report.requeued = await store.requeueStuckJobs(this.options.stuckAfterSeconds ?? 600);
    report.enqueued = await store.enqueueVersions(
      await store.versionsNeedingVectors(profile.key, 50),
      profile.key,
    );
    const jobs = await store.claimJobs(profile.key, this.workerId, 2);
    report.claimed = jobs.length;
    for (const job of jobs) {
      try {
        report.embedded += await this.embedVersion(job.documentVersionId);
        await store.completeJob(job.id);
        this.counters.jobsDone += 1;
        this.lastSuccessAt = new Date().toISOString();
      } catch (error) {
        report.failed += 1;
        this.counters.jobsFailed += 1;
        this.lastFailureAt = new Date().toISOString();
        // A fixed message: never a provider body, never document text.
        this.lastFailure =
          error instanceof Error && error.name === "EmbeddingCallError"
            ? "Yerel metin karşılaştırma hizmeti yanıt vermedi."
            : "Gömme işi tamamlanamadı.";
        await store.failJob(job.id, this.lastFailure, this.options.retryBackoffSeconds ?? 30);
        this.options.log?.({ worker: this.workerId, event: "embedding-job-failed", jobId: job.id });
      }
    }
    this.counters.embeddedTotal += report.embedded;
    return report;
  }

  private async embedVersion(documentVersionId: string): Promise<number> {
    const { store, profile, embedder } = this.options;
    const chunks = await store.chunksNeedingVectors(documentVersionId, profile.key);
    const batchSize = Math.min(32, Math.max(1, this.options.batchSize ?? 16));
    let embedded = 0;
    for (let at = 0; at < chunks.length; at += batchSize) {
      const batch = chunks.slice(at, at + batchSize).filter((chunk) => chunk.text.trim() !== "");
      if (batch.length === 0) continue;
      const inputs = batch.map((chunk) =>
        formatDocumentText(
          profile.promptStyle as EmbeddingPromptStyle,
          clipCodePoints(chunk.text, MAX_EMBED_INPUT_CODE_POINTS),
        ),
      );
      const vectors = await embedder.embed(inputs);
      if (vectors.length !== batch.length) throw new Error("embedding count mismatch");
      const rows = batch.map((chunk, index) => {
        const vector = vectors[index] as readonly number[];
        if (vector.length !== profile.dimensions) throw new Error("embedding dimension mismatch");
        const unit = l2Normalize(vector);
        if (unit === undefined) throw new Error("embedding is not a usable vector");
        return {
          chunkId: chunk.chunkId,
          documentVersionId: chunk.documentVersionId,
          embedding: encodeVector(unit),
          inputSha256: sha256(inputs[index] as string),
          chunkSha256: chunk.contentSha256,
        };
      });
      await store.upsertVectors(profile, rows);
      embedded += rows.length;
    }
    return embedded;
  }

  async drain(maxTicks = 1_000): Promise<EmbeddingTick> {
    const total: EmbeddingTick = { requeued: 0, enqueued: 0, claimed: 0, embedded: 0, failed: 0 };
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const report = await this.tick();
      for (const key of Object.keys(total) as Array<keyof EmbeddingTick>) total[key] += report[key];
      if (report.claimed === 0 && report.enqueued === 0) break;
    }
    return total;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
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
      busy = report.claimed > 0 && report.failed === 0;
    } catch {
      this.lastFailureAt = new Date().toISOString();
      this.lastFailure = "Gömme çalışanı bir turu tamamlayamadı.";
    } finally {
      this.running = false;
      for (const resolve of this.idle.splice(0)) resolve();
    }
    if (this.stopped) return;
    this.schedule(busy ? 0 : this.options.pollIntervalMs ?? 5_000);
  }
}
