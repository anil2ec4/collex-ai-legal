/**
 * The review-grid worker (W20): one durable cell at a time.
 *
 * A cell is (document x question). Its MODE decides how it is answered:
 *
 *   answer            targeted retrieval through the EXISTING answer
 *                     pipeline, scoped to that one document — the same call
 *                     the browser grid made, now durable. A top-K answer; it
 *                     is labelled with the verifier's verdict, never called
 *                     exhaustive.
 *   extract_dates     EVERY analysis unit of the document's pinned version
 *   extract_amounts   is read by the deterministic extractor and every value
 *   extract_ratios    is listed with its page, together with the processing
 *                     coverage of that document. "All dates in this document"
 *                     is therefore never answered from a ranking, and a
 *                     document with an unreadable page says so.
 *
 * Cells are claimed under a lease, completed with a lease guard, retried with
 * backoff, and failed terminally after their budget, so a restart resumes at
 * the next unfinished cell and one bad cell can be retried alone.
 */

import { randomUUID } from "node:crypto";
import type { AnswerPort } from "../api/answerService.js";
import type { DurableAnalysisStore } from "../exhaustive/durableStore.js";
import { extractPropositions, type PropositionKind } from "../exhaustive/observations.js";
import { planUnits, runMap, runReduce } from "../exhaustive/runner.js";
import type {
  CellClaim,
  CellProvenance,
  CellResult,
  ColumnMode,
  PgReviewTableStore,
  SupportState,
} from "./store.js";

export interface ReviewTableWorkerOptions {
  readonly store: PgReviewTableStore;
  /** Required for `answer` columns. */
  readonly answer?: AnswerPort | undefined;
  /** Reads pinned document versions for the `extract_*` columns. */
  readonly documents: Pick<DurableAnalysisStore, "loadVersionDocuments">;
  readonly workerId?: string;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly retryBackoffMs?: number;
  readonly pollIntervalMs?: number;
  readonly keepProcessAlive?: boolean;
  readonly today?: () => string;
}

export interface ReviewTick {
  recovered: number;
  cancelled: number;
  claimed: number;
  completed: number;
  failed: number;
  finished: number;
}

const EXTRACT_KIND: Readonly<Record<Exclude<ColumnMode, "answer">, PropositionKind>> = {
  extract_dates: "date",
  extract_amounts: "amount",
  extract_ratios: "ratio",
};

const KIND_WORD_TR: Readonly<Record<PropositionKind, string>> = {
  date: "tarih",
  amount: "tutar",
  ratio: "oran",
};

/** Values listed in a cell's text; the rest are counted, and all stay in provenance. */
const MAX_VALUES_SHOWN = 25;
/** Provenance entries kept per extract cell. */
const MAX_PROVENANCE = 200;

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function displayValue(kind: PropositionKind, normalized: string): string {
  if (kind === "date") {
    const [year, month, day] = normalized.split("-");
    return `${day}.${month}.${year}`;
  }
  if (kind === "amount") {
    const kurus = Number(normalized);
    return Number.isFinite(kurus) ? `${(kurus / 100).toLocaleString("tr-TR")} TL` : normalized;
  }
  const perMille = Number(normalized);
  return Number.isFinite(perMille) ? `%${perMille / 10}` : normalized;
}

function supportFromVerdict(verdict: string | undefined): SupportState {
  if (verdict === "SUPPORTED") return "verified";
  if (verdict === "INSUFFICIENT_EVIDENCE" || verdict === undefined) return "unverified";
  // QUALIFIED, CONFLICTING_AUTHORITIES, OUT_OF_DATE_SOURCE, PARTIAL_SOURCE_COVERAGE
  return "partially_verified";
}

interface AnswerLike {
  result: {
    runId?: string;
    status: string;
    claims: Array<{ text: string; verdict?: string; evidenceIds: string[] }>;
    evidence: Array<{
      evidenceId: string;
      documentVersionId: string;
      chunkId: string;
      startChar: number;
      endChar: number;
      quoteSha256: string;
    }>;
    coverage?: { missing?: string[] } | undefined;
  };
}

export class ReviewTableWorker {
  readonly workerId: string;
  private readonly options: ReviewTableWorkerOptions;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private kicked = false;
  private readonly idle: Array<() => void> = [];

  constructor(options: ReviewTableWorkerOptions) {
    this.options = options;
    this.workerId = options.workerId ?? `grid-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  async tick(): Promise<ReviewTick> {
    const { store } = this.options;
    const report: ReviewTick = { recovered: 0, cancelled: 0, claimed: 0, completed: 0, failed: 0, finished: 0 };
    report.recovered = await store.recoverStale();
    report.cancelled = await store.applyCancellations();
    const claims = await store.claimCells(this.workerId, this.options.batchSize ?? 2, this.options.leaseMs ?? 5 * 60_000);
    report.claimed = claims.length;
    for (const claim of claims) {
      try {
        const result = await this.compute(claim);
        if (await store.completeCell(claim, this.workerId, result)) report.completed += 1;
      } catch (error) {
        await store.failCell(claim, this.workerId, safeMessage(error), this.options.retryBackoffMs ?? 10_000);
        report.failed += 1;
      }
    }
    report.finished = await store.finishIdleTables();
    return report;
  }

  private async compute(claim: CellClaim): Promise<CellResult> {
    const context = await this.options.store.cellContext(claim);
    if (context === undefined) throw new Error("Hücre tanımı bulunamadı.");
    if (context.mode === "answer") return this.answerCell(context);
    return this.extractCell(context, EXTRACT_KIND[context.mode]);
  }

  private async answerCell(context: {
    question: string;
    fileId: string;
    documentVersionId: string | null;
    options: { asOf?: string; useLocalAi?: boolean };
  }): Promise<CellResult> {
    const port = this.options.answer;
    if (port === undefined) throw new Error("Cevap hattı bu sunucuda yapılandırılmamış.");
    const today = this.options.today ?? (() => new Date().toISOString().slice(0, 10));
    const run = (await port.answer({
      question: context.question,
      asOf: context.options.asOf ?? today(),
      filters: { fileIds: [context.fileId], includeCorpus: false },
      ...(context.options.useLocalAi === true ? { useLocalAi: true } : {}),
    })) as unknown as AnswerLike;
    const result = run.result;
    const byId = new Map(result.evidence.map((evidence) => [evidence.evidenceId, evidence]));
    const claim = result.claims[0];
    if (claim === undefined || result.status === "ABSTAIN") {
      const missing = result.coverage?.missing ?? [];
      return {
        answerStatus: result.status,
        answerText:
          missing.length > 0
            ? `Bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: ${missing.slice(0, 4).join(", ")}`
            : "Bu belgede bu soruya karşılık bulunamadı.",
        supportState: result.evidence.length > 0 ? "abstained" : "no_evidence",
        provenance: [],
        answerRunId: result.runId,
      };
    }
    const provenance: CellProvenance[] = claim.evidenceIds
      .map((id) => byId.get(id))
      .filter((evidence): evidence is NonNullable<typeof evidence> => evidence !== undefined)
      .map((evidence) => ({
        fileId: context.fileId,
        documentVersionId: evidence.documentVersionId,
        chunkId: evidence.chunkId,
        startChar: evidence.startChar,
        endChar: evidence.endChar,
        quoteSha256: evidence.quoteSha256,
      }));
    const newer =
      context.documentVersionId !== null &&
      provenance.some((entry) => entry.documentVersionId !== context.documentVersionId);
    return {
      answerStatus: result.status,
      answerText:
        claim.text.slice(0, 1500) +
        (newer ? " (Not: bu cevap belgenin tablo oluşturulduktan sonra yüklenen sürümünden.)" : ""),
      supportState: supportFromVerdict(claim.verdict),
      provenance,
      answerRunId: result.runId,
    };
  }

  private async extractCell(
    context: { fileId: string; documentVersionId: string | null },
    kind: PropositionKind,
  ): Promise<CellResult> {
    const [document] = await this.options.documents.loadVersionDocuments(
      [[context.fileId, context.documentVersionId]],
      { withText: true },
    );
    if (document === undefined || document.extractionFailed === true) {
      throw new Error("Belgenin bu sürümü okunamadı.");
    }
    // The whole document, unit by unit — a census, not a ranking.
    const units = planUnits([document]);
    const { ledger, observations } = runMap(units, [document], {
      extract: (unit) => extractPropositions(unit.text).filter((draft) => draft.kind === kind),
    });
    const coverage = runReduce([document], ledger, observations, []).coverage;
    const seen = new Map<string, string | undefined>();
    for (const observation of observations) {
      if (!seen.has(observation.normalizedValue)) seen.set(observation.normalizedValue, observation.locator);
    }
    const values = [...seen.entries()];
    const word = KIND_WORD_TR[kind];
    let answerText: string;
    if (values.length === 0) {
      answerText = coverage.complete
        ? `Belgenin tamamında ${word} bulunmadı.`
        : `Belgenin okunabilen kısmında ${word} bulunmadı; belge tam okunamadı.`;
    } else {
      const shown = values
        .slice(0, MAX_VALUES_SHOWN)
        .map(([value, locator]) => `${displayValue(kind, value)}${locator ? ` (${locator})` : ""}`);
      const more = values.length > MAX_VALUES_SHOWN ? ` ve ${values.length - MAX_VALUES_SHOWN} tane daha` : "";
      answerText = `${values.length} ayrı ${word}: ${shown.join("; ")}${more}.`;
      if (!coverage.complete) answerText += " Belge tam okunamadığı için liste eksik olabilir.";
    }
    return {
      answerStatus: coverage.complete ? "COMPLETE" : "PARTIAL",
      answerText,
      supportState: coverage.complete ? "exhaustive_complete" : "exhaustive_incomplete",
      provenance: observations.slice(0, MAX_PROVENANCE).map((observation) => ({
        fileId: context.fileId,
        documentVersionId: observation.documentVersionId,
        startChar: observation.startChar,
        endChar: observation.endChar,
        quoteSha256: observation.quoteSha256,
        locator: observation.locator,
      })),
      processingCoverage: coverage,
    };
  }

  async drain(maxTicks = 5_000): Promise<ReviewTick> {
    const total: ReviewTick = { recovered: 0, cancelled: 0, claimed: 0, completed: 0, failed: 0, finished: 0 };
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const report = await this.tick();
      for (const key of Object.keys(total) as Array<keyof ReviewTick>) total[key] += report[key];
      if (report.claimed === 0 && report.cancelled === 0) break;
    }
    return total;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

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
      busy = report.claimed + report.cancelled + report.recovered > 0;
    } catch {
      busy = false;
    } finally {
      this.running = false;
      for (const resolve of this.idle.splice(0)) resolve();
    }
    if (this.stopped) return;
    const again = busy || this.kicked;
    this.kicked = false;
    this.schedule(again ? 0 : this.options.pollIntervalMs ?? 1_000);
  }
}
