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
 *
 * W21 (version pin): an `answer` cell retrieves from its row's PINNED
 * version too (filters.documentVersionIds), not from whatever version is
 * current. Evidence from any other version is refused, and a pin that can no
 * longer be read fails the cell at once (PinnedVersionRefusal) — a cell never
 * answers, or abstains, from a version it was not pinned to.
 *
 * W21 (#17, #18): an answer run the pipeline could not finish (time budget
 * spent, retrieval or drafter failed) is NOT an abstention: the cell fails
 * through the retryable path with ANSWER_INCOMPLETE_TR. An abstention names
 * what was actually examined — the passages retrieved for the question —
 * and says a word occurs nowhere in the document only after the WHOLE pinned
 * version's text was read and scanned for it.
 *
 * W21 round two:
 *   R2-21  a claim whose passage support was never judged (the judge failed:
 *          ENTAILMENT_NOT_CHECKED) is not "partially verified"; the cell fails,
 *          retryably, with SUPPORT_NOT_CHECKED_TR.
 *   R2-23  an abstention from a search in which a passage lane failed (a
 *          RETRIEVAL_LANE_DEGRADED warning), or in which one query of the plan
 *          failed as a whole (RETRIEVAL_ERROR / CORPUS_UNAVAILABLE warning),
 *          is not a finished "no passage" cell; it fails, retryably, with
 *          SEARCH_LANE_DEGRADED_TR.
 *   R2-24  a spent time budget fails the cell only when the run has no claim:
 *          claims drafted and verified before the clock ran out are an answer.
 *   R2-22  a census counts what the extractor recognises and says so; value-
 *          like text it could not read makes the census PARTIAL, by example.
 */

import { randomUUID } from "node:crypto";
import { assessQuestionCoverage, contentLexemes, mapPassageCoverage } from "../answer/coverage.js";
import { ENTAILMENT_NOT_CHECKED } from "../answer/verifier.js";
import type { AnswerPort } from "../api/answerService.js";
import { formatMinorUnits } from "../exhaustive/contradictions.js";
import type { DurableAnalysisStore } from "../exhaustive/durableStore.js";
import {
  extractPropositions,
  topicWordKey,
  unparsedValueMentions,
  type PropositionKind,
} from "../exhaustive/observations.js";
import { planUnits, runMap, runReduce, type ScopedDocument } from "../exhaustive/runner.js";
import {
  ABSTAIN_IN_PASSAGES_TR,
  ANSWER_INCOMPLETE_TR,
  NO_PASSAGES_TR,
  PIN_FILE_DELETED_TR,
  PIN_UNREADABLE_TR,
  QUESTION_NOT_CHECKED_STATUS,
  SEARCH_LANE_DEGRADED_TR,
  SUPPORT_NOT_CHECKED_TR,
  absentFromDocumentTr,
  censusTextTr,
  notInRetrievedPassagesTr,
  type CellClaim,
  type CellProvenance,
  type CellResult,
  type ColumnMode,
  type PgReviewTableStore,
  type SupportState,
} from "./store.js";

// The cell texts live next to the stored cells (store.ts), where cells stored
// before grid-v3 are re-stated with them; re-exported for existing importers.
export {
  ABSTAIN_IN_PASSAGES_TR,
  ANSWER_INCOMPLETE_TR,
  NO_PASSAGES_TR,
  SEARCH_LANE_DEGRADED_TR,
  SUPPORT_NOT_CHECKED_TR,
  absentFromDocumentTr,
  censusTextTr,
  notInRetrievedPassagesTr,
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

/** Values listed in a cell's text; the rest are counted, and all stay in provenance. */
const MAX_VALUES_SHOWN = 25;
/** Provenance entries kept per extract cell. */
const MAX_PROVENANCE = 200;
/** Examples of unread value-like text kept per extract cell. */
const MAX_UNPARSED_KEPT = 3;

/** Shown when an answer drew on a version other than the pinned one (W21). */
export const PIN_MISMATCH_TR =
  "Cevap, tabloya sabitlenen belge sürümü dışındaki bir metne dayandığı için gösterilmedi.";

/**
 * Reasons with which the answer pipeline marks a run it could not finish,
 * whatever it drafted (answerPipeline.ts: every core retrieval lane failed,
 * the corpus could not be searched).
 */
const INCOMPLETE_ANSWER_REASONS = [
  "RETRIEVAL_DEGRADED",
  "CORPUS_UNAVAILABLE",
  // DRAFTER_DEGRADED is deliberately NOT here (W21 re-check): when the local
  // drafter fails, the rule-based fallback still drafts claims that the
  // lexical judge verifies — an honest answer /v1/answer returns too. A
  // drafter failure with NO claim is caught by the no-claim rule below.
] as const;

/**
 * W21 R2-24: reasons that make a run incomplete only when it left NO claim.
 * The pipeline checks its wall budget before drafting (over budget: it
 * drafts nothing) and again after drafting — a run whose budget ran out
 * AFTER its claims were drafted still has them verified, so those claims are
 * an answer, exactly as /v1/answer shows them. Treating every budget overrun
 * as incomplete threw away verified answers of a slow local model on every
 * retry.
 */
const NO_CLAIM_INCOMPLETE_REASONS = ["TIME_BUDGET_EXCEEDED"] as const;

/**
 * W21 R2-23: a failed lane that searches the document's own passages —
 * exact, lexical and trigram (retrieval/searchService.ts CORE_LANES) and the
 * dense lane — under any query of the plan. The pipeline reports it as
 * `RETRIEVAL_LANE_DEGRADED:<query label>:lane <lane> failed: ...` and, while
 * one core lane survives, only as a warning. Relation and citation lanes add
 * related authorities, not the question's passages, and are not counted.
 */
const PASSAGE_LANE_FAILED = /^RETRIEVAL_LANE_DEGRADED:(?:[^:]+:)*lane (?:exact|lexical|trigram|dense) failed/u;

/**
 * W21 R2-23 (second verifier round): a query of the plan whose search failed
 * AS A WHOLE — every lane of it, the port threw, or the corpus dropped. The
 * pipeline (answerPipeline.ts retrieve) reports it as
 * `RETRIEVAL_ERROR:<query label>:...` or `CORPUS_UNAVAILABLE:<query label>:...`.
 * For the primary query it also sets a reason (RETRIEVAL_DEGRADED,
 * CORPUS_UNAVAILABLE); for a contrary query it sets NONE, although that
 * query's passages go into the same pool the answer is drafted from. So the
 * warning alone must count: it is a worse failure than one lane of a query.
 */
const PLAN_QUERY_FAILED = /^(?:RETRIEVAL_ERROR|CORPUS_UNAVAILABLE):/u;

function hasReason(reasons: readonly unknown[], codes: readonly string[]): boolean {
  return reasons.some(
    (reason) => typeof reason === "string" && codes.some((code) => reason === code || reason.startsWith(`${code}:`)),
  );
}

/**
 * Why an answer run must not be stored as a finished cell, or undefined:
 *
 *   - a degradation reason (every core lane failed, the corpus unavailable);
 *   - no claim, and a spent time budget (R2-24: with claims it is an answer);
 *   - no claim that the pipeline did not itself decide was an abstention
 *     (PARTIAL after a skipped drafter or a failed retrieval) — only status
 *     ABSTAIN is an abstention;
 *   - an abstention (or no claim) from a search in which a passage lane
 *     failed, or one query of the plan failed as a whole (R2-23): "no
 *     passage" from a partly failed search says nothing about the document.
 */
export function incompleteAnswerReason(result: {
  readonly status: string;
  readonly claims: readonly unknown[];
  readonly reasons?: readonly unknown[] | undefined;
  readonly warnings?: readonly unknown[] | undefined;
}): string | undefined {
  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  const noClaim = result.claims.length === 0;
  if (hasReason(reasons, INCOMPLETE_ANSWER_REASONS)) return ANSWER_INCOMPLETE_TR;
  if (noClaim && hasReason(reasons, NO_CLAIM_INCOMPLETE_REASONS)) return ANSWER_INCOMPLETE_TR;
  if (noClaim && result.status !== "ABSTAIN") return ANSWER_INCOMPLETE_TR;
  if (noClaim || result.status === "ABSTAIN") {
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const searchFailed = (warning: unknown): boolean =>
      typeof warning === "string" && (PASSAGE_LANE_FAILED.test(warning) || PLAN_QUERY_FAILED.test(warning));
    if (warnings.some(searchFailed)) return SEARCH_LANE_DEGRADED_TR;
  }
  return undefined;
}

/** True for an answer run that must not be stored as a finished cell (see incompleteAnswerReason). */
export function isIncompleteAnswer(result: Parameters<typeof incompleteAnswerReason>[0]): boolean {
  return incompleteAnswerReason(result) !== undefined;
}

/**
 * W21 R2-21: true when the passage support of `claim` was never judged — the
 * judge failed on it, so its entailment score is the safe default 0, not a
 * measurement (verifier.ts ENTAILMENT_NOT_CHECKED). Read from the claim's own
 * reasons, or from the run's reasons naming the claim.
 */
export function claimSupportNotChecked(
  claim: { readonly claimId?: string | undefined; readonly reasons?: readonly unknown[] | undefined },
  runReasons: readonly unknown[] | undefined,
): boolean {
  const own = Array.isArray(claim.reasons) ? claim.reasons : [];
  if (hasReason(own, [ENTAILMENT_NOT_CHECKED])) return true;
  if (claim.claimId === undefined || !Array.isArray(runReasons)) return false;
  return runReasons.includes(`${ENTAILMENT_NOT_CHECKED}:${claim.claimId}`);
}

/**
 * True when the whole version was read: the same processing-coverage test the
 * extract_* cells use (no unread page, no text outside the units, a source
 * map present). Only then can a word be called absent from the document.
 */
function wholeVersionRead(document: ScopedDocument): boolean {
  if (document.extractionFailed === true) return false;
  const units = planUnits([document]);
  const { ledger, observations } = runMap(units, [document], { extract: () => [] });
  return runReduce([document], ledger, observations, []).coverage.complete;
}

/**
 * W21: a cell that must not be computed from anything but its row's pinned
 * document version. Failing with this is TERMINAL (no retry budget spent):
 * retrying cannot make another version the pinned one.
 */
export class PinnedVersionRefusal extends Error {
  constructor(
    message: string,
    readonly kind: "ROW_VERSION_STALE" | "EVIDENCE_VERSION_MISMATCH" = "ROW_VERSION_STALE",
  ) {
    super(message);
    this.name = "PinnedVersionRefusal";
  }
}

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
    // extract-v3 and later: "4500000" is kuruş; "150000 EUR" is cents of that currency.
    // W22: kuruş are shown with two digits ("99.284,50 TL", never "99.284,5 TL").
    const [minor, currency] = normalized.split(" ");
    const units = Number(minor);
    return Number.isFinite(units) ? `${formatMinorUnits(units)} ${currency ?? "TL"}` : normalized;
  }
  const perMille = Number(normalized);
  return Number.isFinite(perMille) ? `%${perMille / 10}` : normalized;
}

/**
 * Party roles. In a grid question ("Davacının işe giriş tarihi nedir?") they
 * say WHOSE fact is asked, not what the fact is; a passage need not repeat
 * them to answer, so they are not core words.
 */
const ROLE_WORD_KEYS: ReadonlySet<string> = new Set(
  ["davacı", "davalı", "müvekkil", "vekil", "sanık", "şüpheli", "katılan", "alacaklı", "borçlu"]
    .map(topicWordKey)
    .filter((key): key is string => key !== undefined),
);

/**
 * W22: which drafted claim answers a grid question, and which of the
 * question's core words its passage does NOT carry.
 *
 * The grid used to take the first claim. The rule-based drafter orders
 * claims by passage rank, and a hearing record's header ("CELSE TARİHİ :
 * 14.05.2024") outranked the testimony, so "Davacının işe giriş tarihi
 * nedir?" was answered with the hearing date and marked "kaynağıyla
 * doğrulandı". Now the claim whose verified passage covers the most of the
 * question's core words is chosen (more words of any kind, then the
 * drafter's order, break a tie); the words its passage still lacks are
 * returned, and a cell with any is never called verified (answerCell).
 * Matching is the coverage gate's own (mapPassageCoverage): lexical, not a
 * reading of the answer.
 */
export function chooseAnsweringClaim<C extends { readonly text: string; readonly evidenceIds: readonly string[] }>(
  question: string,
  claims: readonly C[],
  evidenceById: ReadonlyMap<string, { readonly quote?: string | undefined }>,
): { claim: C; missingCore: string[] } | undefined {
  if (claims.length === 0) return undefined;
  const passages = claims.map((claim) => {
    const quotes = claim.evidenceIds
      .map((id) => evidenceById.get(id)?.quote)
      .filter((quote): quote is string => typeof quote === "string" && quote.trim() !== "");
    return quotes.length > 0 ? quotes.join("\n") : claim.text;
  });
  const map = mapPassageCoverage(question, passages);
  const core = map.lexemes
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => {
      const key = topicWordKey(word);
      return key === undefined || !ROLE_WORD_KEYS.has(key);
    });
  const coreCount = (at: number): number => {
    const covered = new Set(map.covered[at] ?? []);
    return core.filter(({ index }) => covered.has(index)).length;
  };
  let best = 0;
  for (let at = 1; at < claims.length; at += 1) {
    const better =
      coreCount(at) > coreCount(best) ||
      (coreCount(at) === coreCount(best) && (map.covered[at]?.length ?? 0) > (map.covered[best]?.length ?? 0));
    if (better) best = at;
  }
  const covered = new Set(map.covered[best] ?? []);
  return {
    claim: claims[best] as C,
    missingCore: core.filter(({ index }) => !covered.has(index)).map(({ word }) => word),
  };
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
    /** Machine reasons from the verifier and the pipeline (degradations included). */
    reasons?: string[];
    /** Pipeline warnings; RETRIEVAL_LANE_DEGRADED lives here (R2-23). */
    warnings?: string[];
    claims: Array<{
      claimId?: string;
      text: string;
      verdict?: string;
      evidenceIds: string[];
      /** The verifier's reasons for this claim (ENTAILMENT_NOT_CHECKED, R2-21). */
      reasons?: string[];
    }>;
    evidence: Array<{
      evidenceId: string;
      documentVersionId: string;
      chunkId: string;
      startChar: number;
      endChar: number;
      quoteSha256: string;
      /** The verified passage text (W22: which claim answers the question). */
      quote?: string;
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
        await store.failCell(
          claim,
          this.workerId,
          safeMessage(error),
          this.options.retryBackoffMs ?? 10_000,
          error instanceof PinnedVersionRefusal,
        );
        report.failed += 1;
      }
    }
    report.finished = await store.finishIdleTables();
    return report;
  }

  private async compute(claim: CellClaim): Promise<CellResult> {
    const context = await this.options.store.cellContext(claim);
    if (context === undefined) throw new Error("Hücre tanımı bulunamadı.");
    // W21: every mode reads EXACTLY the pinned version. A pin that can no
    // longer be read is refused here, never replaced by the current version.
    if (context.documentVersionId === null || !context.pinReadable) {
      // W21 (#19): a deleted file is not offered "build a new table".
      throw new PinnedVersionRefusal(context.fileExists ? PIN_UNREADABLE_TR : PIN_FILE_DELETED_TR);
    }
    const result =
      context.mode === "answer"
        ? await this.answerCell(context, context.documentVersionId)
        : await this.extractCell(context, EXTRACT_KIND[context.mode]);
    // The pin could have been withdrawn while the cell was computed (the
    // pinned search then finds nothing and would look like an honest
    // abstention). Check again and refuse rather than store that.
    const after = await this.options.store.cellContext(claim);
    if (after === undefined || after.documentVersionId !== context.documentVersionId || !after.pinReadable) {
      throw new PinnedVersionRefusal(after === undefined || after.fileExists ? PIN_UNREADABLE_TR : PIN_FILE_DELETED_TR);
    }
    return result;
  }

  private async answerCell(
    context: {
      question: string;
      fileId: string;
      options: { asOf?: string; useLocalAi?: boolean };
    },
    pinnedVersionId: string,
  ): Promise<CellResult> {
    const port = this.options.answer;
    if (port === undefined) throw new Error("Cevap hattı bu sunucuda yapılandırılmamış.");
    const today = this.options.today ?? (() => new Date().toISOString().slice(0, 10));
    const run = (await port.answer({
      question: context.question,
      asOf: context.options.asOf ?? today(),
      // The row's file, and within it ONLY the pinned version (W21): a later
      // re-upload does not change what this cell reads.
      filters: { fileIds: [context.fileId], documentVersionIds: [pinnedVersionId], includeCorpus: false },
      ...(context.options.useLocalAi === true ? { useLocalAi: true } : {}),
    })) as unknown as AnswerLike;
    const result = run.result;
    // Retrieval was pinned, so every passage must come from the pinned
    // version. One that does not is refused: the cell never reports an answer
    // (or an abstention) grounded in another version of the document.
    if (result.evidence.some((evidence) => evidence.documentVersionId !== pinnedVersionId)) {
      throw new PinnedVersionRefusal(PIN_MISMATCH_TR, "EVIDENCE_VERSION_MISMATCH");
    }
    // W21 (#17, R2-23, R2-24): a run the pipeline could not finish is not an
    // abstention and not an answer. Fail the cell through the normal,
    // retryable path, saying why.
    const incomplete = incompleteAnswerReason(result);
    if (incomplete !== undefined) throw new Error(incomplete);
    const byId = new Map(result.evidence.map((evidence) => [evidence.evidenceId, evidence]));
    // W22: the claim whose passage carries the most of the question's words,
    // not the first one ("CELSE TARİHİ : 14.05.2024" was the answer to "işe
    // giriş tarihi" because the tutanak header ranked first).
    const choice = chooseAnsweringClaim(context.question, result.claims, byId);
    const claim = choice?.claim;
    if (claim === undefined || result.status === "ABSTAIN") {
      return {
        answerStatus: result.status,
        answerText: await this.abstentionText(
          context.fileId,
          pinnedVersionId,
          result.coverage?.missing ?? [],
          result.evidence.length > 0,
        ),
        supportState: result.evidence.length > 0 ? "abstained" : "no_evidence",
        provenance: [],
        answerRunId: result.runId,
      };
    }
    // W21 R2-21: a support check that never happened is not partial support.
    // The model-written sentence is not stored as an answer; the cell fails
    // retryably (the judge is usually down or timing out).
    if (claimSupportNotChecked(claim, result.reasons)) throw new Error(SUPPORT_NOT_CHECKED_TR);
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
    const supportState = supportFromVerdict(claim.verdict);
    return {
      // W22: the quote verifies the sentence; whether the sentence answers the
      // question was not checked when the passage lacks the question's core
      // words. Such a cell is never labelled "kaynağıyla doğrulandı".
      answerStatus:
        supportState === "verified" && choice !== undefined && choice.missingCore.length > 0
          ? QUESTION_NOT_CHECKED_STATUS
          : result.status,
      answerText: claim.text.slice(0, 1500),
      supportState,
      provenance,
      answerRunId: result.runId,
    };
  }

  /**
   * W21 (#18): the text of an abstention. `missing` are the question words no
   * RETRIEVED passage carries (the coverage gate measures only the admitted
   * passages, at most a few per document). A word is called absent from the
   * document only when the whole pinned version was read and its full text,
   * matched with the coverage gate's own stemmer, does not contain it.
   */
  private async abstentionText(
    fileId: string,
    pinnedVersionId: string,
    missing: readonly string[],
    hadPassages: boolean,
  ): Promise<string> {
    const words = missing.filter((word) => typeof word === "string" && word.trim() !== "");
    if (words.length === 0) return hadPassages ? ABSTAIN_IN_PASSAGES_TR : NO_PASSAGES_TR;
    const absent = await this.absentFromWholeText(fileId, pinnedVersionId, words);
    const notReached = words.filter((word) => !absent.includes(word));
    if (absent.length === 0) return notInRetrievedPassagesTr(notReached);
    if (notReached.length === 0) return absentFromDocumentTr(absent);
    return `${absentFromDocumentTr(absent)}. ${notInRetrievedPassagesTr(notReached)}`;
  }

  /**
   * The subset of `words` that occurs NOWHERE in the pinned version's whole
   * text. Empty whenever that cannot be established: the version cannot be
   * loaded, is not the pinned one, or was not read completely.
   */
  private async absentFromWholeText(
    fileId: string,
    pinnedVersionId: string,
    words: readonly string[],
  ): Promise<string[]> {
    let document: ScopedDocument | undefined;
    try {
      [document] = await this.options.documents.loadVersionDocuments([[fileId, pinnedVersionId]], { withText: true });
    } catch {
      return [];
    }
    if (document === undefined || document.documentVersionId !== pinnedVersionId) return [];
    if (!wholeVersionRead(document)) return [];
    // Each word as the coverage gate matches it (the same lexeme it was
    // reported missing as); a word that yields no lexeme is left unverified.
    const keys = words.map((word) => contentLexemes(word)[0]);
    const known = keys.filter((key): key is string => key !== undefined);
    if (known.length === 0) return [];
    const report = assessQuestionCoverage(known.join(" "), [document.canonicalText]);
    const absentKeys = new Set(report.missing);
    return words.filter((_word, index) => {
      const key = keys[index];
      return key !== undefined && absentKeys.has(key);
    });
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
      // The census lists foreign-currency amounts too (displayValue shows
      // "<minor> <CODE>"); the matter analysis leaves them out (observations.ts
      // ExtractOptions), so its unparsed check below counts them as read.
      extract: (unit) => extractPropositions(unit.text, { foreignAmounts: true }).filter((draft) => draft.kind === kind),
    });
    const coverage = runReduce([document], ledger, observations, []).coverage;
    const seen = new Map<string, string | undefined>();
    for (const observation of observations) {
      if (!seen.has(observation.normalizedValue)) seen.set(observation.normalizedValue, observation.locator);
    }
    const values = [...seen.entries()];
    // W21 R2-22: the census reads only the formats the extractor recognises.
    // Text that looks like a value of this kind but was not read is named, so
    // a list (or an empty list) is never presented as everything the
    // document says.
    const unparsed: string[] = [];
    for (const unit of units) {
      if (unparsed.length >= MAX_UNPARSED_KEPT) break;
      for (const mention of unparsedValueMentions(unit.text, kind)) {
        if (unparsed.length < MAX_UNPARSED_KEPT && !unparsed.includes(mention)) unparsed.push(mention);
      }
    }
    const answerText = censusTextTr({
      kind,
      shown: values
        .slice(0, MAX_VALUES_SHOWN)
        .map(([value, locator]) => `${displayValue(kind, value)}${locator ? ` (${locator})` : ""}`),
      total: values.length,
      complete: coverage.complete,
      unparsed,
    });
    return {
      answerStatus: coverage.complete && unparsed.length === 0 ? "COMPLETE" : "PARTIAL",
      answerText,
      // The reading coverage: whether every page of the version was read.
      // A census that met unread value-like text is PARTIAL above, never
      // "exhaustive_incomplete" (the document itself was read).
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
