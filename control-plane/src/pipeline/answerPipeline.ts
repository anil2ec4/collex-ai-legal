/**
 * The end-to-end citation-first answer pipeline (Master Build Brief 1.1, 9.x).
 *
 * It composes the modules that already exist — nothing here re-implements
 * retrieval, evidence building, verification or rendering:
 *
 *   intake (planner/intake)
 *     -> normalizeTurkishSearch + parseReferences (retrieval/)
 *     -> hybrid retrieval over the corpus (CorpusRetrievalPort)
 *        + mandatory contrary-authority lanes (planner/contrary)
 *     -> outcome-polarity stance classification (pipeline/stance)
 *     -> buildEvidencePack (answer/evidencePack) — REAL quotes sliced from the
 *        canonical text by code-point offset, SHA-256 over quote and document
 *     -> DrafterPort (llm/ruleDrafter by default; an LLM adapter can replace it)
 *     -> verifyAnswer (answer/verifier) — deterministic citation validation,
 *        entailment, per-dimension confidence, conflict detection, finalization
 *     -> renderAnswerMarkdown + renderEvidenceBundle (answer/renderer),
 *        passed through sanitizeMarkdown (security/renderGuard)
 *
 * THE THREE RULES THIS FILE ENFORCES
 *
 *  1. A PROVIDER SNIPPET IS NEVER EVIDENCE. Quotes are produced exclusively by
 *     `buildEvidencePack`, which slices the canonical document text at the
 *     stored code-point offsets and re-validates the result. Retrieval output
 *     supplies identity and ranking only.
 *  2. NO CLAIM FINALIZES WITHOUT VALIDATED EVIDENCE. Every citation is
 *     re-validated inside `verifyAnswer`; a claim whose citations all fail is
 *     downgraded to unsupported and the answer cannot be finalized.
 *  3. ABSTAIN INSTEAD OF GUESSING. An empty or unverifiable evidence set yields
 *     status ABSTAIN with honest Turkish text and ZERO source cards. A broken
 *     corpus is NOT an abstention — it is PARTIAL with a warning, because
 *     "we could not look" and "there is nothing to find" are different answers.
 *
 * Everything is injectable, so the whole pipeline runs offline against fakes.
 */

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  DEFAULT_MAX_QUOTE_CODE_POINTS,
  buildEvidencePack,
  type AnswerCandidate,
  type CanonicalTextPort,
  type EvidenceArrival,
  type EvidenceOrigin,
  type EvidencePack,
} from "../answer/evidencePack.js";
import {
  DEFAULT_COVERAGE_FLOOR,
  admitUnderReferenceBypass,
  admitUploadOnlyPassages,
  assessQuestionCoverage,
  evaluateQuestionCoverage,
  mapPassageCoverage,
  classifyReferenceBypass,
  type QuestionCoverageReport,
} from "../answer/coverage.js";
import {
  CORPUS_UNAVAILABLE,
  CORPUS_UNAVAILABLE_MESSAGE_TR,
  isCorpusUnavailable,
} from "../retrieval/corpusErrors.js";
import { renderAnswerMarkdown, renderEvidenceBundle, escapeInline } from "../answer/renderer.js";
import { verifyAnswer, type AnswerDocument } from "../answer/verifier.js";
import type { ClaimDraft, EvidenceRef } from "../evidence/types.js";
import { RuleBasedDrafter } from "../llm/ruleDrafter.js";
import { LexicalEntailmentPort } from "../llm/lexicalEntailment.js";
import type { DrafterPort, EntailmentJudgement, EntailmentPort } from "../llm/ports.js";
import {
  analyzeIntake,
  validateResearchIntake,
  IntakeValidationError,
  type IntakeAnalysis,
} from "../planner/intake.js";
import { buildContraryLanes, type ContraryFlavor, type ContraryLane } from "../planner/contrary.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import type { RankedHit } from "../retrieval/hybrid.js";
import { sanitizeAnswerMarkdown } from "../security/renderGuard.js";
import { checkFetchUrl } from "../security/urlPolicy.js";
import { classifyStance, isLegislativeDocumentType } from "./stance.js";
import {
  classifyQuestionIntent,
  extractLegalQuestion,
  type CoverageMeasuredOn,
  type QuestionIntentAssessment,
} from "./questionIntent.js";
import type {
  CorpusRetrievalPort,
  CorpusSearchFilters,
  CorpusSearchLimits,
  CorpusSearchResult,
  VersionFacts,
  VersionFactsPort,
} from "./ports.js";
import {
  ANSWER_RESULT_SCHEMA,
  type AiUsedView,
  type AmendingInstrumentView,
  type AnswerResult,
  type ClaimView,
  type ContraryCoverage,
  type ContraryLaneRun,
  type EvidenceView,
  type ExportableEvidenceBundle,
  type FileScopeView,
  type ObservedPassage,
  type QuestionCoverageView,
  type RejectedEvidenceView,
  type StageTrace,
  type TemporalComparisonView,
  type TemporalVersionView,
} from "./types.js";

export type { AnswerResult, ExportableEvidenceBundle } from "./types.js";

/**
 * Default corpus banner.
 *
 * It says the texts are NOT real on purpose. The only corpus this repository
 * can ingest today is `evals/fixtures/corpus`, which is synthetic Turkish
 * legal text. A deployment serving real authority MUST override this string;
 * leaving the default in place is a truthful statement about what the reader
 * is seeing.
 *
 * W15: "SENTETİK TEST VERİSİ" ve "korpus" avukatın bilmediği iki sözcüktü ve
 * bu, ürünün EN TEHLİKELİ kusuruydu: okunmayan bir uyarı, uyarı değildir.
 * Kanonik sözlük karşılığı "deneme belgeleri"dir (W15-DEĞİŞMEZLER §3). Bu
 * metin konsola olduğu gibi basılır; istemcide gizlenemez.
 */
export const DEFAULT_CORPUS_NOTICE =
  "UYARI — DENEME BELGELERİ: Bu kurulumda gerçek mevzuat yok. Cevabın dayandığı metinler " +
  "gerçek değildir; ColleX'in denemesi için üretilmiş örneklerdir. Gerçek bir Türk kanunu " +
  "ya da mahkeme kararı değildir. Hiçbir hukukî işte kullanmayın.";

/**
 * W18: banner for an answer whose EVERY admitted document was published into
 * the local library from a real source (`ingestion/library.py`,
 * `fixture_meta.synthetic: false`). The library records the fetch, not the
 * effective date, so currentness is still the lawyer's to verify.
 */
export const LIBRARY_CORPUS_NOTICE =
  "Bu cevabın dayandığı belgeler resmî kaynaklardan alınıp bu bilgisayardaki hukuk " +
  "kütüphanesine kaydedilmiştir. Kütüphane belgenin alındığı günü bilir, yürürlük tarihini " +
  "bilmez; her dayanağın güncelliğini kaynağından doğrulayın.";

/** Warning text when a request asks for cloud AI on a server that has none configured. */
export const AI_UNAVAILABLE_MESSAGE_TR =
  "Bulut yapay zekâ bu sunucuda yapılandırılmamış; kural tabanlı üretimle devam edildi.";

/** `result.aiUsed.label` when the rule-based drafter and lexical judge ran. */
export const RULE_BASED_LABEL_TR = "Kural tabanlı — yerel";

/**
 * Wall budget of one answer (W12-FIX2, review P1-5b). Checked BETWEEN stages
 * (the ports cannot be aborted mid-call): once exceeded, drafting is skipped
 * and a cloud entailment judge is replaced by the local lexical one, and the
 * answer comes back PARTIAL with reason TIME_BUDGET_EXCEEDED.
 */
export const DEFAULT_ANSWER_TIME_BUDGET_MS = 60_000;

/** Machine reason/warning code when the wall budget was exceeded. */
export const TIME_BUDGET_EXCEEDED = "TIME_BUDGET_EXCEEDED";

/** Turkish sentence for the budget warning (console dictionary mirrors it). */
export const TIME_BUDGET_EXCEEDED_MESSAGE_TR =
  "Cevap süre bütçesini aştı; tespit yazımı ve doğrulama eksik bırakıldı — bulunan pasajlar gösteriliyor, cevap KISMİ.";

/** Machine warning code when a quote was cut to the cap ("alıntı kısaltıldı"). */
export const QUOTE_TRUNCATED = "QUOTE_TRUNCATED";

export interface AnswerPipelineOptions {
  retrieval: CorpusRetrievalPort;
  texts: CanonicalTextPort;
  /** Court/chamber + effective period per version; optional but recommended. */
  versionFacts?: VersionFactsPort;
  /** Defaults to the deterministic RuleBasedDrafter (no LLM). */
  drafter?: DrafterPort;
  /** Defaults to the conservative lexical entailment floor (no LLM). */
  entailment?: EntailmentPort;
  /** Max evidence items admitted to the pack (default 8). */
  maxEvidence?: number;
  /** Max contrary-authority lanes executed per question (default 4). */
  maxContraryLanes?: number;
  /**
   * Ratio floor of the question-coverage gate (answer/coverage.ts); default
   * DEFAULT_COVERAGE_FLOOR = 0.4. A retrieved set that covers less of the
   * question's content words than this, with no passage anchoring at least
   * two of them, yields ABSTAIN with reason QUESTION_NOT_COVERED.
   */
  coverageFloor?: number;
  /**
   * Cloud AI ports (W12, contract [R]). Used ONLY for a request that says
   * `useCloudAi: true`; every other request keeps the rule-based drafter and
   * the lexical entailment floor. `label` is user-facing (result.aiUsed).
   * The citation-first invariant is enforced on the cloud drafter exactly as
   * on the rule-based one: a claim citing an id outside the pack is warned
   * about and fails deterministic validation in the verifier.
   */
  cloud?: { drafter: DrafterPort; entailment: EntailmentPort; label: string };
  /** Retrieval limits forwarded to the corpus port. */
  limits?: CorpusSearchLimits;
  /**
   * Additive (W12-FIX2): wall budget per answer in ms (default
   * DEFAULT_ANSWER_TIME_BUDGET_MS); 0 disables the check.
   */
  timeBudgetMs?: number;
  /**
   * Additive (W12-FIX2): cap on one quote in code points (default
   * DEFAULT_MAX_QUOTE_CODE_POINTS); 0 disables the cap.
   */
  maxQuoteCodePoints?: number;
  corpusNotice?: string;
  /**
   * Whether the corpus behind this pipeline is synthetic test data. Defaults to
   * TRUE, matching DEFAULT_CORPUS_NOTICE: the only corpus this repository can
   * ingest today is `evals/fixtures/corpus`. A deployment serving real
   * authority must set BOTH `corpusNotice` and `syntheticCorpus: false`.
   */
  syntheticCorpus?: boolean;
  /** Build identifier reproduced verbatim in the exported evidence bundle. */
  producer?: string;
  /** Injectable clocks/ids for deterministic tests. */
  now?: () => string;
  monotonic?: () => number;
  newRunId?: () => string;
  today?: () => string;
}

export interface AnswerRequest {
  question: string;
  /** ISO date (YYYY-MM-DD); defaults to today (UTC). */
  asOf?: string;
  /**
   * Retrieval filters. `filters.fileIds` restricts the answer to the named
   * uploaded documents (file scope; `includeCorpus` unions the public corpus
   * back in, default false).
   */
  filters?: CorpusSearchFilters;
  limits?: CorpusSearchLimits;
  /**
   * Per-request consent to use the configured cloud AI ports for THIS
   * answer. Ignored (with warning AI_UNAVAILABLE) when the pipeline has no
   * cloud ports. Default false: nothing leaves the machine unless asked.
   */
  useCloudAi?: boolean;
}

/**
 * The full run. `result` is the serializable contract; `document` carries the
 * verifier's AnswerDocument, including the evidence pack WITH canonical texts,
 * which the tamper checker needs and the HTTP API deliberately never returns.
 */
export interface AnswerRun {
  result: AnswerResult;
  document: AnswerDocument;
  pack: EvidencePack;
}

export { IntakeValidationError } from "../planner/intake.js";

// ---------------------------------------------------------------------------
// Trace recorder
// ---------------------------------------------------------------------------

interface StageContext {
  counts: Record<string, number>;
  notes: string[];
}

class TraceRecorder {
  private readonly stages: StageTrace[] = [];

  constructor(private readonly monotonic: () => number) {}

  async run<T>(name: string, body: (ctx: StageContext) => Promise<T> | T): Promise<T> {
    const ctx: StageContext = { counts: {}, notes: [] };
    const started = this.monotonic();
    try {
      return await body(ctx);
    } finally {
      this.stages.push({
        name,
        ms: Math.round((this.monotonic() - started) * 100) / 100,
        counts: ctx.counts,
        notes: ctx.notes,
      });
    }
  }

  snapshot(): StageTrace[] {
    return this.stages.map((stage) => ({ ...stage, counts: { ...stage.counts }, notes: [...stage.notes] }));
  }
}

// ---------------------------------------------------------------------------
// Fail-soft port wrappers
// ---------------------------------------------------------------------------

/** A text port that turns any throw into "unavailable" (a recorded rejection). */
function safeTextPort(port: CanonicalTextPort, warnings: string[]): CanonicalTextPort {
  return {
    async getCanonicalText(documentVersionId: string): Promise<string | undefined> {
      try {
        return await port.getCanonicalText(documentVersionId);
      } catch (error) {
        warnings.push(`CANONICAL_TEXT_PORT_FAILED:${safeMessage(error)}`);
        return undefined;
      }
    },
  };
}

/**
 * An entailment port that cannot break the run. A failed judgement scores 0,
 * which fails the finalization threshold — the safe direction.
 */
function safeEntailmentPort(port: EntailmentPort, warnings: string[]): EntailmentPort {
  const failed = (error: unknown): EntailmentJudgement => {
    warnings.push(`ENTAILMENT_PORT_FAILED:${safeMessage(error)}`);
    return {
      entails: false,
      score: 0,
      // W15: "Entailment portu" tamamen yazılım terimiydi ve doğrudan cevaba
      // düşüyordu; "iddia" da burada teknik anlamda kullanılmıştı.
      rationale:
        "Pasajın bu tespiti destekleyip desteklemediği denetlenemedi (arıza); " +
        "güvenli tarafta kalmak için tespit desteksiz sayıldı.",
    };
  };
  return {
    async assess(claimText, evidence): Promise<EntailmentJudgement> {
      try {
        return await port.assess(claimText, evidence);
      } catch (error) {
        return failed(error);
      }
    },
    // Forwarded ONLY when the wrapped port has it: the verifier reads
    // `assessSet === undefined` as "this judge cannot score a set", and a
    // wrapper that invented the capability would change the aggregation.
    ...(port.assessSet !== undefined
      ? {
          async assessSet(
            claimText: string,
            evidence: readonly EvidenceRef[],
          ): Promise<EntailmentJudgement> {
            try {
              return await (port.assessSet as NonNullable<EntailmentPort["assessSet"]>)(
                claimText,
                evidence,
              );
            } catch (error) {
              return failed(error);
            }
          },
        }
      : {}),
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

// ---------------------------------------------------------------------------
// Retrieval planning
// ---------------------------------------------------------------------------

interface PlannedQuery {
  label: string;
  query: string;
  lane: "primary" | "contrary";
  contrary?: { issueId: string; issueLabel: string; lane: ContraryLane };
}

function contraryFlavorFor(analysis: IntakeAnalysis): ContraryFlavor {
  if (analysis.aymMarkers.length > 0) return "aym";
  if (analysis.contraryMarkers.length > 0) return "divergence";
  return "general";
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class AnswerPipeline {
  private readonly retrieval: CorpusRetrievalPort;
  private readonly texts: CanonicalTextPort;
  private readonly versionFacts: VersionFactsPort | undefined;
  private readonly drafter: DrafterPort;
  private readonly entailment: EntailmentPort;
  private readonly maxEvidence: number;
  private readonly maxContraryLanes: number;
  private readonly coverageFloor: number;
  private readonly cloud: AnswerPipelineOptions["cloud"];
  private readonly limits: CorpusSearchLimits | undefined;
  private readonly timeBudgetMs: number;
  private readonly maxQuoteCodePoints: number;
  private readonly corpusNotice: string;
  private readonly syntheticCorpus: boolean;
  private readonly producer: string;
  private readonly now: () => string;
  private readonly monotonic: () => number;
  private readonly newRunId: () => string;
  private readonly today: () => string;

  constructor(options: AnswerPipelineOptions) {
    this.retrieval = options.retrieval;
    this.texts = options.texts;
    this.versionFacts = options.versionFacts;
    this.drafter = options.drafter ?? new RuleBasedDrafter();
    this.entailment = options.entailment ?? new LexicalEntailmentPort();
    this.maxEvidence = options.maxEvidence ?? 8;
    this.maxContraryLanes = options.maxContraryLanes ?? 4;
    this.coverageFloor = options.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;
    this.cloud = options.cloud;
    this.limits = options.limits;
    this.timeBudgetMs = options.timeBudgetMs ?? DEFAULT_ANSWER_TIME_BUDGET_MS;
    this.maxQuoteCodePoints = options.maxQuoteCodePoints ?? DEFAULT_MAX_QUOTE_CODE_POINTS;
    this.corpusNotice = options.corpusNotice ?? DEFAULT_CORPUS_NOTICE;
    this.syntheticCorpus = options.syntheticCorpus ?? true;
    this.producer = options.producer ?? "collex.control-plane/answerPipeline v1";
    this.now = options.now ?? (() => new Date().toISOString());
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.newRunId = options.newRunId ?? (() => randomUUID());
    this.today = options.today ?? (() => new Date().toISOString().slice(0, 10));
  }

  /**
   * Answer one question end to end.
   *
   * Throws only for an INVALID REQUEST (IntakeValidationError). Every runtime
   * failure downstream of intake is contained and reported as a warning plus a
   * degraded status.
   */
  async answer(request: AnswerRequest): Promise<AnswerRun> {
    const trace = new TraceRecorder(this.monotonic);
    const warnings: string[] = [];
    const runId = this.newRunId();
    const generatedAt = this.now();
    // Wall budget (W12-FIX2): measured on the same monotonic clock as the
    // trace, checked between stages.
    const startedAt = this.monotonic();
    const elapsedMs = (): number => this.monotonic() - startedAt;
    const overBudget = (): boolean => this.timeBudgetMs > 0 && elapsedMs() > this.timeBudgetMs;
    let budgetExceeded = false;
    const noteBudget = (): void => {
      if (budgetExceeded) return;
      budgetExceeded = true;
      warnings.push(`${TIME_BUDGET_EXCEEDED}:${Math.round(elapsedMs())}ms>${this.timeBudgetMs}ms`);
    };

    // ---- stage: intake -----------------------------------------------------
    const { analysis, asOf } = await trace.run("intake", (ctx) => {
      const validated = validateResearchIntake({
        question: request.question,
        jurisdiction: "TR",
        dataClass: "L0",
        ...(request.asOf !== undefined ? { asOf: request.asOf } : {}),
      });
      if (!validated.ok) throw new IntakeValidationError(validated.errors);
      const resolvedAsOf = validated.intake.asOf ?? this.today();
      const intakeAnalysis = analyzeIntake(validated.intake);
      ctx.counts["issues"] = intakeAnalysis.issues.length;
      ctx.counts["questionChars"] = validated.intake.question.length;
      ctx.notes.push(`asOf=${resolvedAsOf}`);
      for (const issue of intakeAnalysis.issues) ctx.notes.push(`issue:${issue.kind}:${issue.label}`);
      return { analysis: intakeAnalysis, asOf: resolvedAsOf };
    });

    // ---- stage: normalize --------------------------------------------------
    const normalizedQuestion = await trace.run("normalize", (ctx) => {
      const normalized = normalizeTurkishSearch(request.question);
      ctx.counts["chars"] = normalized.length;
      return normalized;
    });

    // ---- stage: references -------------------------------------------------
    // Parsed exact references drive the deterministic pin lane inside
    // retrieval, and decide whether the question can be a norm-content one.
    const references = await trace.run("parseReferences", (ctx) => {
      const parsed = parseReferences(request.question);
      ctx.counts["references"] = parsed.length;
      for (const ref of parsed) {
        ctx.notes.push(
          `${ref.kind}:${ref.legislationNo ?? ref.articleNo ?? ref.docketNo ?? ref.raw}`,
        );
      }
      return parsed;
    });

    // ---- stage: intent -----------------------------------------------------
    const intent = await trace.run("intent", (ctx) => {
      // B-09: temporality is decided by the QUESTION's wording, not by the
      // presence of an `asOf` — see classifyTemporalQuestion for the
      // measurement behind that choice.
      const assessment = classifyQuestionIntent(request.question, references);
      ctx.counts["markers"] = assessment.markers.length;
      ctx.notes.push(`intent=${assessment.intent}`);
      ctx.notes.push(`temporal=${assessment.temporal.isTemporal}`);
      // W14 B-08, in this stage rather than a new one so the trace stage list
      // — a published contract the console renders — stays exactly as it was.
      // A lawyer types the FACTS and then the question. The coverage gate is
      // lexical, so ~80 narrative lexemes (names, dates, amounts, places) that
      // no legal passage can contain used to sink the ratio and set every
      // passage aside: measured 02.09.2026, the same question lost 8 pieces of
      // evidence and both decisions when it was asked as a 1 178-character
      // account. Retrieval still receives the WHOLE text; only the gate's unit
      // changes.
      const extraction = extractLegalQuestion(request.question, references);
      ctx.counts["questionCodePoints"] = extraction.codePoints;
      ctx.notes.push(`measuredOn=${extraction.measuredOn}`);
      return { ...assessment, legalQuestion: extraction };
    });
    const legalQuestion = intent.legalQuestion;


    // ---- stage: plan -------------------------------------------------------
    const planned = await trace.run("plan", (ctx) => {
      const flavor = contraryFlavorFor(analysis);
      const queries: PlannedQuery[] = [
        { label: "primary", query: request.question, lane: "primary" },
      ];
      // W14 B-08, the retrieval half. The FTS lane admits a chunk only when it
      // carries at least DEFAULT_LEXICAL_MIN_COVERAGE (0.25) of the QUERY's
      // lexemes; a 1 000-character fact pattern has ~120 of them, so no legal
      // passage can ever reach the floor and the lane returns nothing —
      // measured here on the quality corpus: four of six long forms retrieved
      // ZERO passages while their short cores retrieved 1–4. The narrative
      // still goes to retrieval (it is what ranks the right decision first);
      // the extracted legal question is added as a SECOND primary query so
      // the lane that dilution silenced can answer as well.
      if (legalQuestion.measuredOn === "soru") {
        queries.push({
          label: "primary:soru",
          query: legalQuestion.legalQuestion,
          lane: "primary",
        });
      }
      for (const issue of analysis.issues) {
        const baseTerm = issue.expandedTerms[0] ?? issue.label;
        for (const lane of buildContraryLanes(baseTerm, flavor)) {
          queries.push({
            label: `contrary:${issue.issueId}:${lane.kind}`,
            query: lane.query,
            lane: "contrary",
            contrary: { issueId: issue.issueId, issueLabel: issue.label, lane },
          });
        }
      }
      const contraryQueries = queries.filter((q) => q.lane === "contrary");
      const kept = [
        ...queries.filter((q) => q.lane === "primary"),
        ...contraryQueries.slice(0, this.maxContraryLanes),
      ];
      const dropped = contraryQueries.length - Math.min(contraryQueries.length, this.maxContraryLanes);
      if (dropped > 0) warnings.push(`CONTRARY_LANES_CAPPED:${dropped}`);
      ctx.counts["queries"] = kept.length;
      ctx.counts["contraryLanes"] = kept.length - 1;
      ctx.notes.push(`flavor=${flavor}`);
      return kept;
    });

    // ---- stage: retrieve ---------------------------------------------------
    const retrieval = await trace.run("retrieve", async (ctx) => {
      const merged = new Map<string, { hit: RankedHit; queries: string[] }>();
      const laneRuns: ContraryLaneRun[] = [];
      let primaryFailed = false;
      let corpusUnavailable = false;
      let totalHits = 0;

      const runPlanItem = async (planItem: PlannedQuery): Promise<void> => {
        // The port contract says a corpus failure is a typed `status: "error"`,
        // never an exception — but "the adapter promised" is not a guarantee,
        // and a throw here would turn a database hiccup into a 500 for a
        // lawyer mid-answer. Contain it and degrade honestly instead.
        let outcome: CorpusSearchResult;
        try {
          outcome = await this.retrieval.search({
            query: planItem.query,
            asOf,
            ...(request.filters !== undefined ? { filters: request.filters } : {}),
            ...(request.limits ?? this.limits ? { limits: request.limits ?? this.limits } : {}),
          });
        } catch (error) {
          // A connection-class throw (refused socket, missing database, pool
          // torn down) is typed here too, so an adapter that forgot to
          // classify it still cannot leak driver prose into a warning.
          outcome = isCorpusUnavailable(error)
            ? {
                status: "error",
                hits: [],
                warnings: [],
                error: CORPUS_UNAVAILABLE_MESSAGE_TR,
                errorCode: CORPUS_UNAVAILABLE,
              }
            : {
                status: "error",
                hits: [],
                warnings: [],
                error: `RETRIEVAL_PORT_THREW:${safeMessage(error)}`,
              };
        }
        totalHits += outcome.hits.length;
        for (const warning of outcome.warnings) {
          warnings.push(`RETRIEVAL_LANE_DEGRADED:${planItem.label}:${warning}`);
        }
        if (outcome.status === "error") {
          if (outcome.errorCode === CORPUS_UNAVAILABLE) {
            // Typed: the code, the lane, and the ONE Turkish sentence — never
            // the driver's text (contract [R] item 4).
            warnings.push(`${CORPUS_UNAVAILABLE}:${planItem.label}:${CORPUS_UNAVAILABLE_MESSAGE_TR}`);
            if (planItem.lane === "primary") corpusUnavailable = true;
          } else {
            warnings.push(`RETRIEVAL_ERROR:${planItem.label}:${outcome.error ?? "unknown"}`);
          }
          if (planItem.lane === "primary") primaryFailed = true;
        }

        let newPassages = 0;
        for (const hit of outcome.hits) {
          const existing = merged.get(hit.chunkId);
          if (existing === undefined) {
            merged.set(hit.chunkId, { hit, queries: [planItem.label] });
            newPassages += 1;
          } else {
            if (!existing.queries.includes(planItem.label)) existing.queries.push(planItem.label);
            // Keep the strongest observation of the same chunk.
            if (hit.pinned && !existing.hit.pinned) existing.hit = hit;
            else if (hit.fusedScore > existing.hit.fusedScore) existing.hit = hit;
          }
        }

        if (planItem.contrary !== undefined) {
          laneRuns.push({
            issueId: planItem.contrary.issueId,
            issueLabel: planItem.contrary.issueLabel,
            kind: planItem.contrary.lane.kind,
            baseTerm: planItem.contrary.lane.baseTerm,
            flipPhrase: planItem.contrary.lane.flipPhrase,
            query: planItem.query,
            status: outcome.status,
            hits: outcome.hits.length,
            newPassages,
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          });
        }
      };

      const primaryPlan = planned.filter((item) => item.lane === "primary");
      const contraryPlan = planned.filter((item) => item.lane === "contrary");
      for (const planItem of primaryPlan) await runPlanItem(planItem);

      // ---- V-21: a contrary scan the answer cannot use is not run --------
      //
      // The contrary lanes used to run on EVERY question, including one the
      // corpus has nothing to do with ("en iyi balik restorani hangisi"), and
      // the answer then said "2 karşıt otorite sorgusu çalıştırıldı; karşıt
      // otorite pasajı bulunamadı" — two lane queries the lawyer did not need
      // (each of them a full retrieval, trigram budget included) and a
      // sentence that reads as though a real scan had come back empty.
      //
      // The skip is decided by the coverage gate's OWN measure, applied to
      // what the primary lanes brought back, and it is deliberately the
      // narrowest sound test:
      //
      //   nothing pinned  — a pinned passage means the reader cited a text by
      //                     name, and the gate is BYPASSED for it; and
      //   bestPassageCovered === 0 — not one retrieved passage shares a
      //                     single content lexeme with the legal question.
      //
      // `decideCoverageGate` fails whenever `bestPassageCovered` cannot
      // anchor the question (>= 2, or all of a one-word question), and the
      // pack's quotes are SLICES of these passages, so their lexeme sets can
      // only be smaller. The gate is therefore certain to fail, every passage
      // is set aside, and the answer abstains with no admitted evidence —
      // whatever a contrary lane might have added would be set aside with it.
      //
      // The moment ONE passage anchors the question (or anything is pinned),
      // every contrary lane runs exactly as before: this narrows nothing for
      // an answer that has evidence, which is what the contrary guarantee is
      // about (run_evals contrary gate n=3 stays 1.0000).
      const primaryRows = [...merged.values()];
      const contrarySkipped =
        contraryPlan.length > 0 &&
        !primaryRows.some((row) => row.hit.pinned) &&
        assessQuestionCoverage(
          legalQuestion.legalQuestion,
          primaryRows.map((row) => row.hit.provenance.originalText),
        ).bestPassageCovered === 0;
      if (!contrarySkipped) {
        for (const planItem of contraryPlan) await runPlanItem(planItem);
      } else {
        ctx.counts["contrarySkipped"] = contraryPlan.length;
        ctx.notes.push(CONTRARY_SKIPPED_NO_ANCHOR);
      }

      ctx.counts["queries"] = primaryPlan.length + (contrarySkipped ? 0 : contraryPlan.length);
      ctx.counts["hits"] = totalHits;
      ctx.counts["distinctPassages"] = merged.size;
      ctx.counts["contraryLanes"] = laneRuns.length;
      if (primaryFailed) ctx.notes.push("PRIMARY_RETRIEVAL_FAILED");
      if (corpusUnavailable) ctx.notes.push(CORPUS_UNAVAILABLE);
      return { merged, laneRuns, primaryFailed, corpusUnavailable, contrarySkipped };
    });

    // ---- stage: rank + scope + cap -----------------------------------------
    const { ranked, observed } = await trace.run("rank", (ctx) => {
      const rows = [...retrieval.merged.values()];
      rows.sort((a, b) => {
        if (a.hit.pinned !== b.hit.pinned) return a.hit.pinned ? -1 : 1;
        if (b.hit.fusedScore !== a.hit.fusedScore) return b.hit.fusedScore - a.hit.fusedScore;
        return compareStable(stablePassageKey(a.hit), stablePassageKey(b.hit));
      });

      // Scoping (see questionIntent.ts): a norm-content question is answered
      // from the norm. Case law retrieved alongside is set aside BY IDENTITY,
      // never silently dropped.
      const observedPassages: ObservedPassage[] = [];
      let eligible = rows;
      if (intent.intent === "NORM_CONTENT") {
        const legislative = rows.filter((r) =>
          isLegislativeDocumentType(r.hit.provenance.documentType),
        );
        if (legislative.length > 0) {
          for (const row of rows) {
            if (legislative.includes(row)) continue;
            observedPassages.push(toObservedPassage(row.hit, "SCOPED_OUT_NORM_CONTENT"));
          }
          eligible = legislative;
        }
      }
      if (observedPassages.length > 0) {
        warnings.push(`EVIDENCE_SCOPED:NORM_CONTENT:${observedPassages.length}`);
      }

      // The cap is COVERAGE-AWARE (2026-09-02): see coverageAwareCap. A
      // passage carrying a question word the kept set lacks is not dropped
      // in favour of one that only repeats what is already there.
      // W14 B-08: measured against the LEGAL question, not the narrative —
      // otherwise the cap keeps the passage that happens to repeat a client
      // name over the one that carries the legal term.
      const capped = coverageAwareCap(eligible, this.maxEvidence, legalQuestion.legalQuestion);
      const kept = capped.kept;
      for (const swap of capped.swaps) {
        ctx.notes.push(`COVERAGE_SWAP:${swap.kept}:${swap.dropped}`);
      }
      if (capped.dropped.length > 0) {
        for (const row of capped.dropped) {
          observedPassages.push(toObservedPassage(row.hit, "EVIDENCE_CAP_APPLIED"));
        }
        warnings.push(`EVIDENCE_CAP_APPLIED:${capped.dropped.length}`);
      }

      ctx.counts["candidates"] = rows.length;
      ctx.counts["eligible"] = eligible.length;
      ctx.counts["kept"] = kept.length;
      ctx.counts["scopedOut"] = observedPassages.length;
      ctx.counts["pinned"] = kept.filter((r) => r.hit.pinned).length;
      ctx.counts["coverageSwaps"] = capped.swaps.length;
      ctx.notes.push(`scope=${intent.intent}`);
      return { ranked: kept, observed: observedPassages };
    });

    // ---- stage: version facts ---------------------------------------------
    const facts = await trace.run("versionFacts", async (ctx) => {
      const ids = ranked.map((r) => r.hit.documentVersionId);
      if (this.versionFacts === undefined || ids.length === 0) {
        ctx.counts["resolved"] = 0;
        return new Map<string, VersionFacts>();
      }
      try {
        const resolved = await this.versionFacts.fetch(ids);
        ctx.counts["resolved"] = resolved.size;
        if (resolved.size < new Set(ids).size) {
          ctx.notes.push("PARTIAL_VERSION_FACTS");
        }
        return resolved;
      } catch (error) {
        warnings.push(`VERSION_FACTS_FAILED:${safeMessage(error)}`);
        ctx.counts["resolved"] = 0;
        return new Map<string, VersionFacts>();
      }
    });

    // ---- stage: evidence ---------------------------------------------------
    const { pack, candidates } = await trace.run("evidence", async (ctx) => {
      const built: AnswerCandidate[] = ranked.map(({ hit }) => {
        const p = hit.provenance;
        const fact = facts.get(hit.documentVersionId);
        // An uploaded document has no OUTCOME to classify: it is the
        // lawyer's own file, quoted as an exhibit. Running the marker table
        // over it turned a cevap dilekçesi's own "davanın REDDİNE" paragraph
        // into contrary authority against the same document (reviewed
        // 02.09.2026). Its stance is neutral by construction.
        const stance =
          originOf(hit) === "upload"
            ? classifyStance("yuklenen_belge", "")
            : classifyStance(p.documentType, p.originalText);
        return {
          hitId: hit.chunkId,
          documentId: hit.documentId,
          documentVersionId: hit.documentVersionId,
          chunkId: hit.chunkId,
          source: p.source,
          sourceUrl: p.canonicalSourceUrl ?? "",
          title: p.title ?? p.externalId,
          ...(fact?.court !== undefined ? { court: fact.court } : {}),
          ...(p.decisionDate !== null ? { decisionDate: p.decisionDate } : {}),
          ...(p.docketNo !== null ? { docketNo: p.docketNo } : {}),
          ...(p.decisionNo !== null ? { decisionNo: p.decisionNo } : {}),
          ...(p.legislationNo !== null ? { legislationNo: p.legislationNo } : {}),
          ...(p.articleNo !== null ? { article: p.articleNo } : {}),
          ...(p.paragraphNo !== null ? { paragraph: p.paragraphNo } : {}),
          startChar: p.startChar,
          endChar: p.endChar,
          score: normalizeRetrievalScore(hit),
          ...(fact?.effectiveFrom !== undefined ? { effectiveFrom: fact.effectiveFrom } : {}),
          ...(fact?.effectiveTo !== undefined ? { effectiveTo: fact.effectiveTo } : {}),
          stance: stance.stance,
          origin: originOf(hit),
          arrival: arrivalOf(hit),
        } satisfies AnswerCandidate;
      });

      const builtPack = await buildEvidencePack(built, safeTextPort(this.texts, warnings), {
        asOf,
        now: this.now,
        ...(this.maxQuoteCodePoints > 0
          ? { quoteCap: { maxCodePoints: this.maxQuoteCodePoints, focus: request.question } }
          : {}),
      });
      for (const rejected of builtPack.rejected) {
        warnings.push(`EVIDENCE_REJECTED:${rejected.candidate.chunkId}:${rejected.reason}`);
      }
      let truncated = 0;
      for (const item of builtPack.items) {
        if (item.quoteTruncated === undefined) continue;
        truncated += 1;
        warnings.push(
          `${QUOTE_TRUNCATED}:${item.ref.chunkId}:${item.quoteTruncated.originalCodePoints}>${this.maxQuoteCodePoints}`,
        );
      }
      ctx.counts["quotesTruncated"] = truncated;
      ctx.counts["candidates"] = built.length;
      ctx.counts["accepted"] = builtPack.items.length;
      ctx.counts["rejected"] = builtPack.rejected.length;
      ctx.counts["contrary"] = builtPack.items.filter((i) => i.stance === "contrary").length;
      return { pack: builtPack, candidates: built };
    });

    // ---- stage: coverage ---------------------------------------------------
    // THE FOURTH RULE (added 2026-09-02, W12 lane B): "we found something" is
    // not "we found something that answers the question". The validated
    // quotes are measured against the question's own content words
    // (answer/coverage.ts); a set that shares only a word or two with the
    // question is set aside BY IDENTITY — listed under contraryCoverage.
    // observed with reason QUESTION_NOT_COVERED, never quoted as evidence —
    // and the answer abstains. A question that cites a provision or a
    // decision the exact lane pinned bypasses the gate: the reader asked for
    // that text by name.
    const uploadOnlyScope =
      request.filters?.fileIds !== undefined &&
      request.filters.fileIds.length > 0 &&
      request.filters.includeCorpus !== true;
    const coverage = await trace.run("coverage", (ctx) => {
      const quotes = pack.items.map((item) => item.ref.quote);
      // W14 B-07: how specific the reader's own citation is. An ARTICLE-level
      // citation ("TBK m. 49") keeps the full bypass; a BARE law name
      // ("TBK'ya göre") pins the whole statute and must not exempt it.
      const bypassKind = classifyReferenceBypass(
        references,
        ranked.map((row) => row.hit),
      );
      ctx.notes.push(`referenceBypass=${bypassKind}`);
      const decision = evaluateQuestionCoverage(legalQuestion.legalQuestion, quotes, {
        floor: this.coverageFloor,
        referenceMatched: bypassKind !== "none",
      });
      ctx.counts["lexemes"] = decision.lexemes.length;
      ctx.counts["covered"] = decision.covered.length;
      ctx.counts["passages"] = decision.passages;
      ctx.counts["ratioPct"] = Math.round(decision.ratio * 100);
      ctx.counts["bestPassageCovered"] = decision.bestPassageCovered;
      ctx.notes.push(`gate=${decision.gate}`);
      if (decision.missing.length > 0) ctx.notes.push(`missing=${decision.missing.join(",")}`);

      // PER-PASSAGE admission (W12-FIX, 02.09.2026). The union gate decides
      // whether the answer stands at all; these two rules decide WHICH
      // passages may carry it:
      //   - under a reference bypass, only the pinned text is admitted by
      //     right; every other passage must anchor the question on its own
      //     (the bypass used to admit the whole pack — see coverage.ts);
      //   - over the reader's own uploads (no corpus), a passage sharing no
      //     content word with the question is set aside.
      const setAsideIds = new Set<string>();
      if (decision.gate === "bypassed-by-reference") {
        const pinnedChunks = new Set(ranked.filter((row) => row.hit.pinned).map((row) => row.hit.chunkId));
        const admission = admitUnderReferenceBypass(
          legalQuestion.legalQuestion,
          pack.items.map((item) => ({
            quote: item.ref.quote,
            // Admitted BY RIGHT only under an article-level citation. Under a
            // bare law name every chunk of the statute is pinned, so "pinned"
            // would mean "everything" (B-07); such a passage goes through the
            // gate with the one-word anchor instead.
            pinned: bypassKind === "article" && pinnedChunks.has(item.ref.chunkId),
            pinnedByLaw:
              bypassKind === "bare-law" && pinnedChunks.has(item.ref.chunkId),
          })),
          { floor: this.coverageFloor },
        );
        // STRUCTURAL admission: a passage reached from an admitted passage by
        // a stored edge — the instrument that AMENDS the cited provision
        // (relation lane), a provision the admitted text CITES (citation
        // lane), or the decision that OPPOSES an admitted one (divergence)
        // — is there because of that passage, not because of a shared word;
        // such a passage shares no word with the question by construction.
        // Closure from the admitted set only: an edge from a set-aside
        // passage admits nothing.
        const admittedChunks = new Set<string>();
        for (const index of admission.admitted) {
          const item = pack.items[index];
          if (item !== undefined) admittedChunks.add(item.ref.chunkId);
        }
        const pending = admission.setAside
          .map((index) => pack.items[index])
          .filter((item): item is EvidencePack["items"][number] => item !== undefined);
        let grew = true;
        while (grew) {
          grew = false;
          for (let i = pending.length - 1; i >= 0; i -= 1) {
            const item = pending[i] as EvidencePack["items"][number];
            const hit = retrieval.merged.get(item.ref.chunkId)?.hit;
            const anchor =
              hit?.relation?.viaChunkId ?? hit?.citation?.citedByChunkId ?? hit?.contrary?.opposesChunkId;
            if (anchor !== undefined && admittedChunks.has(anchor)) {
              admittedChunks.add(item.ref.chunkId);
              pending.splice(i, 1);
              grew = true;
            }
          }
        }
        for (const item of pending) setAsideIds.add(item.ref.evidenceId);
        ctx.counts["bypassSetAside"] = pending.length;
        // W14 B-07: a bare law name that admitted NOTHING is an abstention,
        // not an empty answer — "TBK'ya göre" plus a question the corpus does
        // not cover must come back with the same QUESTION_NOT_COVERED as the
        // same question without those three words did.
        if (
          bypassKind === "bare-law" &&
          pack.items.length > 0 &&
          setAsideIds.size === pack.items.length
        ) {
          ctx.notes.push("gate=failed (bare-law bypass admitted nothing)");
          return { decision: { ...decision, gate: "failed" as const }, setAsideIds };
        }
      } else if (decision.gate === "passed" && uploadOnlyScope) {
        const admission = admitUploadOnlyPassages(legalQuestion.legalQuestion, quotes);
        for (const index of admission.setAside) {
          const item = pack.items[index];
          if (item !== undefined) setAsideIds.add(item.ref.evidenceId);
        }
        ctx.counts["uploadSetAside"] = admission.setAside.length;
      }
      return { decision, setAsideIds };
    });

    const gateBlocked = coverage.decision.gate === "failed" && pack.items.length > 0;
    const setAsideItems = gateBlocked
      ? pack.items
      : pack.items.filter((item) => coverage.setAsideIds.has(item.ref.evidenceId));
    if (setAsideItems.length > 0) {
      for (const item of setAsideItems) {
        const entry = retrieval.merged.get(item.ref.chunkId);
        if (entry !== undefined) observed.push(toObservedPassage(entry.hit, "QUESTION_NOT_COVERED"));
      }
      warnings.push(`QUESTION_NOT_COVERED:${setAsideItems.length}`);
    }
    /** The pack the drafter and verifier see: empty when the gate refused it. */
    const admitted: EvidencePack = gateBlocked
      ? { ...pack, items: [] }
      : setAsideItems.length === 0
        ? pack
        : { ...pack, items: pack.items.filter((item) => !coverage.setAsideIds.has(item.ref.evidenceId)) };
    // Under a bypass the report describes the passages the reader GETS: the
    // union figure is re-measured over the admitted set, and a bypass whose
    // admitted text still misses most of the question is marked partial —
    // the provision was shown, the question was not answered.
    let coverageReport: QuestionCoverageReport = {
      ...coverage.decision,
      setAside: setAsideItems.length,
    };
    if (coverage.decision.gate === "bypassed-by-reference") {
      const remeasured =
        setAsideItems.length > 0
          ? assessQuestionCoverage(
              legalQuestion.legalQuestion,
              admitted.items.map((item) => item.ref.quote),
            )
          : coverage.decision;
      // A NORM_CONTENT question ("m.157'nin cezası nedir?") is answered BY
      // the cited text whatever words it shares with the question — the
      // offence's name is in the heading, not in the article. Only an
      // APPLICATION question can be left unanswered by the text it cites.
      const partiallyCovered =
        intent.intent !== "NORM_CONTENT" &&
        remeasured.lexemes.length > 0 &&
        remeasured.ratio + 1e-9 < this.coverageFloor;
      coverageReport = {
        ...coverageReport,
        ratio: remeasured.ratio,
        covered: [...remeasured.covered],
        missing: [...remeasured.missing],
        passages: remeasured.passages,
        bestPassageCovered: remeasured.bestPassageCovered,
        bestPassageIndex: remeasured.bestPassageIndex,
        partiallyCovered,
      };
      if (partiallyCovered) warnings.push("QUESTION_PARTIALLY_COVERED");
    }

    // ---- port selection (cloud AI is per-request consent) -----------------
    const wantsCloud = request.useCloudAi === true;
    const cloud = wantsCloud ? this.cloud : undefined;
    if (wantsCloud && cloud === undefined) {
      warnings.push(`AI_UNAVAILABLE:${AI_UNAVAILABLE_MESSAGE_TR}`);
    }
    const drafter: DrafterPort = cloud?.drafter ?? this.drafter;
    // Over budget before drafting: no drafter call at all, and a cloud judge
    // (slow, paid) gives way to the local lexical one for what remains.
    if (overBudget()) noteBudget();
    const entailment: EntailmentPort = budgetExceeded ? this.entailment : (cloud?.entailment ?? this.entailment);

    // ---- stage: draft ------------------------------------------------------
    let drafterFailed = false;
    const drafts = await trace.run("draft", async (ctx) => {
      let produced: ClaimDraft[] = [];
      if (gateBlocked) {
        ctx.notes.push("SKIPPED_QUESTION_NOT_COVERED");
      } else if (budgetExceeded) {
        ctx.notes.push("SKIPPED_TIME_BUDGET_EXCEEDED");
      } else {
        try {
          produced = await drafter.draftClaims({ question: request.question, pack: admitted });
        } catch (error) {
          drafterFailed = true;
          warnings.push(`DRAFTER_FAILED:${safeMessage(error)}`);
        }
      }
      ctx.notes.push(`drafter=${cloud !== undefined ? "cloud" : "rule-based"}`);
      // Citation-first invariant: a drafter may only cite evidence in the pack.
      const known = new Set(admitted.items.map((item) => item.ref.evidenceId));
      const cleaned = produced.map((claim) => {
        const unknown = claim.evidenceIds.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          warnings.push(`DRAFTER_CITED_UNKNOWN_EVIDENCE:${claim.claimId}:${unknown.join("+")}`);
        }
        return claim;
      });
      ctx.counts["claims"] = cleaned.length;
      ctx.counts["packItems"] = admitted.items.length;
      return cleaned;
    });

    const aiUsed: AiUsedView = {
      drafter: cloud !== undefined && !drafterFailed && !budgetExceeded,
      entailment: cloud !== undefined && !budgetExceeded,
      label: cloud !== undefined && !budgetExceeded ? cloud.label : RULE_BASED_LABEL_TR,
    };

    // A drafter that ate the budget still hands its claims to the (local)
    // verifier; the answer is marked PARTIAL below either way.
    if (overBudget()) noteBudget();

    // ---- the temporal contract (W14 B-09) ----------------------------------
    // A comparison EXISTS when the admitted evidence carries more than one
    // version of one document — the two texts the reader must weigh. The
    // amending instrument, when the relation lane found it, is reported
    // alongside so the answer card can name it ("7999 sayılı Kanun ile
    // değiştirilmiştir"); it is not a substitute for the two texts.
    const temporalComparison = buildTemporalComparison(
      admitted,
      retrieval.merged,
      asOf,
      intent.temporal.isTemporal,
    );

    // ---- stage: verify -----------------------------------------------------
    const document = await trace.run("verify", async (ctx) => {
      const doc = await verifyAnswer(
        request.question,
        admitted,
        drafts,
        safeEntailmentPort(entailment, warnings),
        {
          now: this.now,
          coverage: coverageReport,
          // W14 B-31: the aggregation depends on WHO wrote the claim, because
          // only the rule-based drafter's claim text is provably the quotes.
          drafter: aiUsed.drafter ? "cloud" : "rule-based",
          temporal: {
            applicable: temporalComparison.applicable,
            comparisonPresent: temporalComparison.present,
          },
        },
      );
      ctx.counts["claims"] = doc.claims.length;
      ctx.counts["validCitations"] = doc.claims.reduce(
        (sum, c) => sum + c.citationChecks.filter((x) => x.ok).length,
        0,
      );
      ctx.counts["invalidCitations"] = doc.claims.reduce(
        (sum, c) => sum + c.citationChecks.filter((x) => !x.ok).length,
        0,
      );
      ctx.counts["conflicted"] = doc.claims.filter(
        (c) => c.verdict === "CONFLICTING_AUTHORITIES",
      ).length;
      ctx.notes.push(`status=${doc.status}`);
      return doc;
    });

    // A corpus we could not fully search is NOT an abstention: downgrade to
    // PARTIAL so the reader knows the difference between "nothing found" and
    // "we could not look".
    // (An abstention's `finalizable: false` is decided at the source, in
    // answer/verifier.ts: a document with no material claim is not
    // finalizable, and it carries ABSTENTION_NOT_FINALIZABLE itself. This
    // file used to patch the flag here.)
    // Likewise an answer whose wall budget ran out (W12-FIX2): the passages
    // found are shown, the missing drafting/verification is named, and an
    // abstention caused only by the skipped drafter is not reported as one.
    const degraded = retrieval.primaryFailed || drafterFailed || budgetExceeded;
    const finalDocument: AnswerDocument = degraded
      ? {
          ...document,
          status: "PARTIAL",
          finalizable: false,
          reasons: [
            ...document.reasons.filter(
              (reason) =>
                !(budgetExceeded && drafts.length === 0 && (reason === "NO_CLAIMS_DRAFTED" || reason === "ABSTENTION_NOT_FINALIZABLE")),
            ),
            ...(retrieval.primaryFailed || drafterFailed
              ? [retrieval.primaryFailed ? "RETRIEVAL_DEGRADED" : "DRAFTER_DEGRADED"]
              : []),
            // The typed cause, alongside the degradation it caused: a reader
            // (and a health check) can tell "could not look" from "looked,
            // and the store misbehaved".
            ...(retrieval.corpusUnavailable ? [CORPUS_UNAVAILABLE] : []),
            ...(budgetExceeded ? [TIME_BUDGET_EXCEEDED] : []),
          ],
        }
      : document;

    const fileScope = fileScopeOf(request.filters);

    // ---- stage: render -----------------------------------------------------
    const contraryCoverage = buildContraryCoverage(
      retrieval.laneRuns,
      admitted,
      finalDocument,
      observed,
      intent,
      retrieval.contrarySkipped,
    );

    // ---- corpus provenance (W18) ---------------------------------------
    // The banner belongs to the ANSWER, not the process: the same server can
    // hold the synthetic fixture corpus and documents the library published
    // from a real source. Only when every admitted document is real does the
    // "deneme belgeleri" warning give way to the library notice; one unknown
    // or synthetic document keeps the warning.
    const corpusProvenance = { real: 0, synthetic: 0, unknown: 0 };
    for (const id of new Set(admitted.items.map((item) => item.ref.documentVersionId))) {
      const flag = facts.get(id)?.synthetic;
      if (flag === false) corpusProvenance.real += 1;
      else if (flag === true) corpusProvenance.synthetic += 1;
      else corpusProvenance.unknown += 1;
    }
    const allReal =
      corpusProvenance.real > 0 && corpusProvenance.synthetic === 0 && corpusProvenance.unknown === 0;
    const corpusNotice = allReal ? LIBRARY_CORPUS_NOTICE : this.corpusNotice;
    const syntheticCorpus = allReal ? false : this.syntheticCorpus;

    const rendered = await trace.run("render", (ctx) => {
      const body = [
        renderCorpusBanner(corpusNotice),
        ...(fileScope !== undefined ? [renderScopeBanner(fileScope)] : []),
        renderAnswerMarkdown(finalDocument),
        renderContrarySection(contraryCoverage),
      ].join("\n\n");
      const markdown = guardAnswerMarkdown(body);
      const bundle: ExportableEvidenceBundle = {
        ...renderEvidenceBundle(finalDocument),
        synthetic: syntheticCorpus,
        syntheticNotice: corpusNotice,
        producer: this.producer,
      };
      ctx.counts["markdownChars"] = markdown.length;
      ctx.counts["bundleEvidence"] = bundle.evidence.length;
      ctx.counts["bundleClaims"] = bundle.claims.length;
      return { markdown, bundle };
    });

    const result: AnswerResult = {
      schema: ANSWER_RESULT_SCHEMA,
      runId,
      question: request.question,
      normalizedQuestion,
      asOf,
      status: finalDocument.status,
      finalizable: finalDocument.finalizable,
      reasons: [...finalDocument.reasons],
      warnings,
      claims: finalDocument.claims.map(toClaimView),
      evidence: admitted.items.map((item) =>
        toEvidenceView(item, retrieval.merged, candidates),
      ),
      rejectedEvidence: pack.rejected.map(
        (rejected): RejectedEvidenceView => ({
          chunkId: rejected.candidate.chunkId,
          documentVersionId: rejected.candidate.documentVersionId,
          title: rejected.candidate.title,
          reason: rejected.reason,
        }),
      ),
      contraryCoverage,
      trace: trace.snapshot(),
      markdown: rendered.markdown,
      bundle: rendered.bundle,
      corpusNotice,
      corpusProvenance,
      generatedAt,
      coverage: toCoverageView(coverageReport, legalQuestion.measuredOn),
      aiUsed,
      ...(temporalComparison.applicable ? { temporal: temporalComparison } : {}),
      ...(fileScope !== undefined ? { fileScope } : {}),
    };

    return { result, document: finalDocument, pack: admitted };
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * Retrieval confidence in [0,1].
 *
 * A pinned exact-reference hit is a DETERMINISTIC match on the citation the
 * user typed, not a relevance estimate, so it scores 1. RRF fused scores are
 * small by construction (1/(k+rank) sums); mapping them through a saturating
 * curve keeps the axis honest — a fused score never claims certainty.
 */
function normalizeRetrievalScore(hit: RankedHit): number {
  if (hit.pinned) return 1;
  const fused = Number.isFinite(hit.fusedScore) ? Math.max(0, hit.fusedScore) : 0;
  return Math.min(1, fused / (fused + 0.02));
}

interface RankedRow {
  hit: RankedHit;
  queries: string[];
}

interface CapResult {
  kept: RankedRow[];
  dropped: RankedRow[];
  /** chunkIds: the passage admitted in place of the one it displaced. */
  swaps: { kept: string; dropped: string }[];
}

/**
 * Field separator inside `stablePassageKey`. U+0000 sorts below every character
 * a source or external id can carry, so ("a", "bc") and ("ab", "c") can never
 * collapse onto one key. Same constant, same reason, as `retrieval/hybrid.ts`
 * — and written as an ESCAPE, never as a raw NUL byte (W14 L-FIX;
 * `tests/test_repo_hygiene.py` fails on a literal 0x00 in a source file).
 */
const PASSAGE_KEY_SEP = "\u0000";

/**
 * CORPUS identity of a ranked passage, for breaking a rank tie.
 *
 * WHY THIS EXISTS (W14 N-7, measured 03.09.2026). The rank stage used to break
 * a score tie on `hit.chunkId`, which is a `gen_random_uuid()` minted at
 * INGEST. Every passage reached by the citation, citator (relation) or
 * contrary lane carries `fusedScore: 0` — those lanes append rather than fuse —
 * so on a question that pulls in several of them the tie group is large, and
 * the uuid alone decided their order. The coverage-aware cap then kept a
 * DIFFERENT top-8 after every re-ingest of the identical corpus.
 *
 * Measured on the fixture corpus with `fx-amend-002`
 * ("7999 sayılı Kanun ile 6098 sayılı Türk Borçlar Kanununda hangi değişiklik
 * yapılmıştır?"): two ingests of byte-identical content produced two different
 * `EVIDENCE_CAP_APPLIED` / `QUESTION_NOT_COVERED` sets — one dropped
 * `kanun-7999#madde-3/fikra-1` and `kanun-6098#madde-12/fikra-1`, the other
 * dropped `kanun-7999#madde-4/fikra-1` and `kanun-6098#madde-51/fikra-1` — with
 * every retrieval lane returning the SAME ordered list in both. Retrieval was
 * never the variable; the CAP was. After this change six consecutive
 * `run_evals.py` runs and a `--repeats 4` band agreed on every answer-layer
 * number (`W14-N7.md` §4).
 *
 * `(source, external_id, ordinal)` is the corpus identity the ingest does not
 * mint; it is the same key `chunkStore.stableTieBreak` and
 * `hybrid.stableKey` already use, so the three layers order ties the same way.
 * `chunkId` stays LAST so the ordering is still total if two passages ever
 * share all three (they cannot under the one-version-per-document visibility
 * rule, but a total order must not depend on that).
 */
function stablePassageKey(hit: RankedHit): string {
  const p = hit.provenance;
  return [
    p.source,
    p.externalId,
    String(p.ordinal).padStart(9, "0"),
    hit.chunkId,
  ].join(PASSAGE_KEY_SEP);
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The evidence cap, made aware of the question.
 *
 * `rows` arrive ranked (pinned first, then fused score). The plain top-N cut
 * is blind to what the question ASKS: measured on the fixture corpus with the
 * answer route's limits, "Dolandırıcılık suçunun temel cezasını artıran torba
 * kanun değişikliği hangisidir ve yürürlük tarihi nedir?" retrieved the
 * amending law's passages — the only ones carrying "torba", "değişiklik",
 * "yürürlük", "tarih" — and the cap cut them in favour of TCK articles that
 * all repeat "dolandırıcılık". The coverage gate then, correctly, saw a pack
 * that did not address the question and abstained: a FALSE abstention
 * manufactured by the cap, on a question the corpus answers.
 *
 * Rule: while some cut passage covers a question word that no kept passage
 * covers, it displaces the LOWEST-ranked non-pinned kept passage whose every
 * question word is also covered by the other kept passages (so nothing is
 * lost). Pinned passages are never displaced — the reader cited them. Each
 * swap strictly grows the kept set's coverage, so the loop terminates. Rank
 * order inside the kept set is preserved; swaps are recorded in the trace.
 */
function coverageAwareCap(
  rows: readonly RankedRow[],
  cap: number,
  question: string,
): CapResult {
  if (rows.length <= cap) return { kept: [...rows], dropped: [], swaps: [] };
  const map = mapPassageCoverage(
    question,
    rows.map((row) => row.hit.provenance.originalText),
  );
  const coveredBy = (index: number): number[] => map.covered[index] ?? [];
  const unionOf = (indices: readonly number[]): Set<number> => {
    const out = new Set<number>();
    for (const index of indices) for (const lexeme of coveredBy(index)) out.add(lexeme);
    return out;
  };

  const keptIdx = rows.map((_, index) => index).slice(0, cap);
  const droppedIdx = rows.map((_, index) => index).slice(cap);
  const swaps: CapResult["swaps"] = [];

  let progress = true;
  while (progress) {
    progress = false;
    const union = unionOf(keptIdx);
    for (let d = 0; d < droppedIdx.length && !progress; d += 1) {
      const candidate = droppedIdx[d] as number;
      const novel = coveredBy(candidate).filter((lexeme) => !union.has(lexeme));
      if (novel.length === 0) continue;
      for (let k = keptIdx.length - 1; k >= 0; k -= 1) {
        const victim = keptIdx[k] as number;
        if ((rows[victim] as RankedRow).hit.pinned) continue;
        const others = unionOf(keptIdx.filter((_, position) => position !== k));
        if (!coveredBy(victim).every((lexeme) => others.has(lexeme))) continue;
        keptIdx[k] = candidate;
        droppedIdx[d] = victim;
        swaps.push({
          kept: (rows[candidate] as RankedRow).hit.chunkId,
          dropped: (rows[victim] as RankedRow).hit.chunkId,
        });
        progress = true;
        break;
      }
    }
  }

  keptIdx.sort((a, b) => a - b);
  droppedIdx.sort((a, b) => a - b);
  return {
    kept: keptIdx.map((index) => rows[index] as RankedRow),
    dropped: droppedIdx.map((index) => rows[index] as RankedRow),
    swaps,
  };
}

/** A tenant-scoped document is one the lawyer uploaded. */
function originOf(hit: RankedHit): EvidenceOrigin {
  return hit.provenance.scope === "tenant" ? "upload" : "corpus";
}

/** How retrieval reached the passage (drives the drafter's enrichment tier). */
function arrivalOf(hit: RankedHit): EvidenceArrival {
  if (hit.citation !== undefined) return "citation";
  if (hit.relation !== undefined) return "relation";
  if (hit.contrary !== undefined) return "contrary";
  return "direct";
}

function fileScopeOf(filters: CorpusSearchFilters | undefined): FileScopeView | undefined {
  if (filters?.fileIds === undefined || filters.fileIds.length === 0) return undefined;
  return { fileIds: [...filters.fileIds], includeCorpus: filters.includeCorpus === true };
}

function toCoverageView(
  report: QuestionCoverageReport,
  measuredOn: CoverageMeasuredOn,
): QuestionCoverageView {
  return {
    measuredOn,
    ratio: report.ratio,
    covered: [...report.covered],
    missing: [...report.missing],
    gate: report.gate,
    floor: report.floor,
    lexemes: [...report.lexemes],
    passages: report.passages,
    bestPassageCovered: report.bestPassageCovered,
    setAside: report.setAside,
    ...(report.partiallyCovered !== undefined ? { partiallyCovered: report.partiallyCovered } : {}),
  };
}

function toClaimView(claim: AnswerDocument["claims"][number]): ClaimView {
  return {
    claimId: claim.claim.claimId,
    text: claim.claim.text,
    material: claim.claim.material,
    treatment: claim.claim.treatment,
    verdict: claim.verdict,
    evidenceIds: claim.citationChecks.filter((c) => c.ok).map((c) => c.evidenceId),
    draftedEvidenceIds: [...claim.claim.evidenceIds],
    contraryEvidenceIds: [...claim.contraryEvidenceIds],
    confidence: { ...claim.claim.confidence },
    citationChecks: claim.citationChecks.map((c) => ({
      evidenceId: c.evidenceId,
      ok: c.ok,
      ...(c.reason !== undefined ? { reason: c.reason } : {}),
    })),
    entailments: claim.entailments.map((e) => ({
      evidenceId: e.evidenceId,
      entails: e.judgement.entails,
      score: e.judgement.score,
      rationale: e.judgement.rationale,
    })),
    reasons: [...claim.reasons],
    currentnessApplicable: claim.currentnessApplicable,
    entailmentAggregation: claim.entailmentAggregation,
    entailmentMeasured: claim.entailmentMeasured,
  };
}

/**
 * The version comparison a temporal question is owed (W14 B-09).
 *
 * "Comparison present" means the admitted evidence carries MORE THAN ONE
 * version of the SAME document: those are the two texts the reader has to
 * weigh, and nothing else substitutes for them. The amending instrument found
 * on the relation lane is reported next to them (by identity and title) so the
 * answer card can name it, but an amending law on its own is not a comparison.
 */
function buildTemporalComparison(
  pack: EvidencePack,
  merged: Map<string, { hit: RankedHit; queries: string[] }>,
  asOf: string,
  applicable: boolean,
): TemporalComparisonView {
  const byDocument = new Map<string, Set<string>>();
  for (const item of pack.items) {
    const versions = byDocument.get(item.ref.documentId) ?? new Set<string>();
    versions.add(item.ref.documentVersionId);
    byDocument.set(item.ref.documentId, versions);
  }
  const comparedDocuments = new Set(
    [...byDocument.entries()].filter(([, versions]) => versions.size > 1).map(([id]) => id),
  );

  const versions: TemporalVersionView[] = pack.items
    .filter((item) => comparedDocuments.has(item.ref.documentId))
    .map((item) => {
      const hit = merged.get(item.ref.chunkId)?.hit;
      const from = hit?.provenance.publicationDate ?? undefined;
      const role = temporalRole(item.currentness.status);
      return {
        evidenceId: item.ref.evidenceId,
        documentId: item.ref.documentId,
        documentVersionId: item.ref.documentVersionId,
        title: item.ref.title,
        ...(item.ref.legislationNo !== undefined
          ? { legislationNo: item.ref.legislationNo }
          : {}),
        ...(item.ref.locator.article !== undefined
          ? { article: item.ref.locator.article }
          : {}),
        ...(from !== undefined ? { effectiveFrom: from } : {}),
        role,
      } satisfies TemporalVersionView;
    });

  const amendedBy: AmendingInstrumentView[] = [];
  const seen = new Set<string>();
  for (const item of pack.items) {
    const hit = merged.get(item.ref.chunkId)?.hit;
    const relation = hit?.relation;
    if (relation === undefined) continue;
    if (!/AMEND|DEGIS|DEĞİŞ/iu.test(relation.kind)) continue;
    if (seen.has(item.ref.chunkId)) continue;
    seen.add(item.ref.chunkId);
    amendedBy.push({
      chunkId: item.ref.chunkId,
      documentVersionId: item.ref.documentVersionId,
      title: item.ref.title,
      ...(item.ref.legislationNo !== undefined
        ? { legislationNo: item.ref.legislationNo }
        : {}),
      kind: relation.kind,
    });
  }

  const present = comparedDocuments.size > 0;
  return {
    applicable,
    present,
    asOf,
    versions,
    amendedBy,
    note: present
      ? "Sorulan tarihte yürürlükte olan metin ile diğer sürüm yan yana gösterildi."
      : "Sorulan tarih için hangi metnin uygulanacağı karşılaştırılmadı; " +
        "cevapta hükmün tek bir sürümü var.",
  };
}

function temporalRole(
  status: EvidencePack["items"][number]["currentness"]["status"],
): TemporalVersionView["role"] {
  if (status === "IN_FORCE") return "sorulan-tarihte";
  if (status === "NOT_YET_IN_FORCE") return "sonraki";
  if (status === "OUT_OF_DATE" || status === "REPEALED") return "onceki";
  return "belirsiz";
}

function toEvidenceView(
  item: EvidencePack["items"][number],
  merged: Map<string, { hit: RankedHit; queries: string[] }>,
  candidates: readonly AnswerCandidate[],
): EvidenceView {
  const ref = item.ref;
  const entry = merged.get(ref.chunkId);
  const candidate = candidates.find((c) => c.chunkId === ref.chunkId);
  const documentType = entry?.hit.provenance.documentType ?? "";
  const stance = classifyStance(documentType, entry?.hit.provenance.originalText ?? ref.quote);
  const urlCheck = checkFetchUrl(ref.sourceUrl);
  return {
    evidenceId: ref.evidenceId,
    documentId: ref.documentId,
    documentVersionId: ref.documentVersionId,
    chunkId: ref.chunkId,
    source: ref.source,
    sourceUrl: ref.sourceUrl,
    sourceUrlAllowed: urlCheck.ok,
    title: ref.title,
    documentType,
    ...(ref.court !== undefined ? { court: ref.court } : {}),
    ...(ref.decisionDate !== undefined ? { decisionDate: ref.decisionDate } : {}),
    ...(ref.docketNo !== undefined ? { docketNo: ref.docketNo } : {}),
    ...(ref.decisionNo !== undefined ? { decisionNo: ref.decisionNo } : {}),
    ...(ref.legislationNo !== undefined ? { legislationNo: ref.legislationNo } : {}),
    ...(ref.locator.article !== undefined ? { article: ref.locator.article } : {}),
    ...(ref.locator.paragraph !== undefined ? { paragraph: ref.locator.paragraph } : {}),
    startChar: ref.locator.startChar,
    endChar: ref.locator.endChar,
    quote: ref.quote,
    quoteSha256: ref.quoteSha256,
    contentSha256: ref.contentSha256,
    retrievedAt: ref.retrievedAt,
    authority: item.authority,
    currentness: item.currentness,
    stance: item.stance,
    polarity: stance.polarity,
    polarityMarkers: stance.markers,
    retrievalScore: candidate?.score ?? item.retrievalScore,
    origin: item.origin ?? "corpus",
    ...(item.quoteTruncated !== undefined ? { quoteTruncated: true } : {}),
    retrieval: {
      pinned: entry?.hit.pinned ?? false,
      ...(entry?.hit.pinReason !== undefined ? { pinReason: entry.hit.pinReason } : {}),
      fusedScore: entry?.hit.fusedScore ?? 0,
      lanes: entry?.hit.lanes.map((l) => l.lane) ?? [],
      queries: entry?.queries ?? [],
      // WHY this passage is here, not just which lane produced it. Carried
      // verbatim from the RankedHit so the answer contract and the lane that
      // decided it cannot disagree; each is absent unless that lane fired.
      ...(entry?.hit.citation !== undefined ? { citation: { ...entry.hit.citation } } : {}),
      ...(entry?.hit.contrary !== undefined
        ? { contrary: { ...entry.hit.contrary, markers: [...entry.hit.contrary.markers] } }
        : {}),
      ...(entry?.hit.relation !== undefined ? { relation: { ...entry.hit.relation } } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Contrary coverage
// ---------------------------------------------------------------------------

/**
 * Trace note (V-21): the planned contrary lanes were not run because not one
 * primary passage anchors the question, so the coverage gate will set the
 * whole pack aside and the answer will carry no evidence at all.
 */
export const CONTRARY_SKIPPED_NO_ANCHOR = "CONTRARY_SKIPPED_NO_ANCHOR";

/**
 * One clause of the coverage summary; says nothing was searched.
 *
 * W15: "karşıt otorite" kanonik sözlükte "aleyhe kaynak"tır.
 */
export const CONTRARY_SKIPPED_NOTE_TR =
  "Bu soruda dayanak olabilecek pasaj bulunamadığı için aleyhe kaynak taraması gerekmedi ve yapılmadı";

/** The section body under "## Aleyhe kaynaklar" when nothing ran. */
export const CONTRARY_SKIPPED_DETAIL_TR =
  "Aleyhe kaynak taraması yapılmadı. Bu soruda dayanak olarak kullanılabilecek " +
  "hiçbir pasaj bulunamadı; çürütülecek bir dayanak olmadığı için tarama " +
  "gerekmedi. Dayanağı olan her cevapta aleyhe kaynak taraması çalışır.";

function toObservedPassage(hit: RankedHit, reason: string): ObservedPassage {
  const p = hit.provenance;
  const stance = classifyStance(p.documentType, p.originalText);
  return {
    chunkId: hit.chunkId,
    documentVersionId: hit.documentVersionId,
    title: p.title ?? p.externalId,
    documentType: p.documentType,
    ...(p.decisionDate !== null ? { decisionDate: p.decisionDate } : {}),
    ...(p.docketNo !== null ? { docketNo: p.docketNo } : {}),
    ...(p.decisionNo !== null ? { decisionNo: p.decisionNo } : {}),
    polarity: stance.polarity,
    polarityMarkers: stance.markers,
    reason,
  };
}

function buildContraryCoverage(
  lanes: ContraryLaneRun[],
  pack: EvidencePack,
  document: AnswerDocument,
  observed: ObservedPassage[],
  intent: QuestionIntentAssessment,
  skipped: boolean,
): ContraryCoverage {
  const contraryEvidenceIds = pack.items
    .filter((item) => item.stance === "contrary")
    .map((item) => item.ref.evidenceId);
  const conflictedClaimIds = document.claims
    .filter((c) => c.verdict === "CONFLICTING_AUTHORITIES")
    .map((c) => c.claim.claimId);
  const executed = lanes.length > 0;
  const usable = lanes.some((lane) => lane.status === "ok" || lane.status === "partial");

  const parts: string[] = [];
  // V-21: when the scan was skipped the sentence must not read like an empty
  // result. "karşıt otorite pasajı bulunamadı" after a scan that never ran
  // tells the lawyer a search came back empty; nothing was searched.
  if (skipped) {
    parts.push(CONTRARY_SKIPPED_NOTE_TR);
  } else {
    parts.push(
      executed
        ? `${lanes.length} ayrı aleyhe kaynak araması yapıldı` +
          (usable ? "" : " (hepsi hata verdi)")
        : "Aleyhe kaynak araması yapılmadı",
    );
    parts.push(
      contraryEvidenceIds.length > 0
        ? `${contraryEvidenceIds.length} pasaj aleyhe kaynak sayıldı`
        : "aleyhe kaynak bulunamadı — bu, aleyhinize karar olmadığı anlamına gelmez; " +
          "yalnızca burada taranan kaynaklarda bulunmadığı anlamına gelir",
    );
  }
  parts.push(
    conflictedClaimIds.length > 0
      ? `${conflictedClaimIds.length} tespitte kaynaklar çelişiyor`
      : "hiçbir tespitte çelişki bulunmadı",
  );
  const scopedOutOpposing = observed.filter(
    (p) => p.reason === "SCOPED_OUT_NORM_CONTENT" && p.polarity === "NEGATIVE",
  ).length;
  if (observed.length > 0) {
    parts.push(
      `${observed.length} pasaj taramada göründü ama dayanak sayılmadı` +
        (scopedOutOpposing > 0
          ? ` (bunlardan ${scopedOutOpposing} tanesi aleyhe sonuçlanmış karardır)`
          : ""),
    );
  }

  return {
    executed,
    skipped,
    usable,
    lanes,
    contraryEvidenceIds,
    conflictedClaimIds,
    observed,
    scope: {
      intent: intent.intent,
      rationale: intent.rationale,
      scopedOut: observed.filter((p) => p.reason === "SCOPED_OUT_NORM_CONTENT").length,
    },
    note: `${parts.join("; ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Markdown fragments produced by the pipeline (escaped, then render-guarded)
// ---------------------------------------------------------------------------

/**
 * The answer's markdown render guard.
 *
 * The whole guard — escaping, link/definition neutralization, URL defanging
 * AND the one structural blockquote marker the renderer emits per line — now
 * lives in `security/renderGuard.ts :: sanitizeAnswerMarkdown`. It used to be
 * "sanitize, then un-escape `^&gt; ` again" right here, which meant the guard
 * classified a line and then this file changed what that line was; a restored
 * `> [ref]: https&#58;//evil` is a link reference definition inside a
 * blockquote, and the guard had already decided it was not one. Structure is
 * the guard's business, so the guard owns it.
 *
 * Kept as a named export because it is the API's re-guard entry point
 * (api/consoleGuard.ts) and is idempotent: `guard(guard(x)) === guard(x)`.
 */
export function guardAnswerMarkdown(markdown: string): string {
  return sanitizeAnswerMarkdown(markdown);
}

// W15: kutu başlığı "KORPUS UYARISI" idi; "korpus" ekrandan kalkar.
function renderCorpusBanner(notice: string): string {
  return [
    "> **HUKUK KÜTÜPHANESİ UYARISI**",
    ...escapeInline(notice)
      .split(/\r?\n/)
      .map((line) => `> ${line}`),
  ].join("\n");
}

/**
 * Under file scope the reader must see that the answer came from THEIR files.
 *
 * W15: başlık "KAPSAM" idi ve "kapsam" bu üründe üç ayrı şey demek (soru
 * kapsamı, kanıt kapsamı, dosya kapsamı) — avukat hangisi olduğunu ayırt
 * edemiyordu. Başlık artık soruyu cevaplıyor; "yerel korpus" da kanonik
 * karşılığı olan "hukuk kütüphaneniz" oldu.
 */
function renderScopeBanner(scope: FileScopeView): string {
  const count = scope.fileIds.length;
  return [
    "> **BU CEVAP NEREDE ARANDI**",
    `> Yalnız yüklediğiniz ${count} belgede` +
      (scope.includeCorpus
        ? " ve hukuk kütüphanenizde arandı."
        : " arandı; hukuk kütüphaneniz taranmadı."),
  ].join("\n");
}

/**
 * Why a retrieved passage was NOT admitted as evidence — in Turkish first,
 * machine code in parentheses (shared dictionary rule).
 */
const OBSERVED_REASON_TR: Readonly<Record<string, string>> = {
  SCOPED_OUT_NORM_CONTENT: "soru hükmün metnini soruyor; mahkeme kararları bu soruda kapsam dışı",
  EVIDENCE_CAP_APPLIED: "bir cevapta gösterilebilecek dayanak sayısı doldu",
  QUESTION_NOT_COVERED: "sorunuzla yalnız aynı sözcükleri paylaşıyor; dayanak sayılmadı",
};

function observedReason(reason: string): string {
  const explained = OBSERVED_REASON_TR[reason];
  return explained === undefined
    ? escapeInline(reason)
    : `${explained} (${escapeInline(reason)})`;
}

function renderContrarySection(coverage: ContraryCoverage): string {
  // W15: bölüm adı her yerde "Aleyhe kaynaklar"a çevrildi; tablo başlığındaki
  // "Şerit" (lane) uydurulmuş bir sözcüktü, "Sorgu" da teknikti.
  const out: string[] = [
    "## Aleyhe kaynaklar",
    "",
    "Aleyhinize olan kaynağı gizlemiyoruz. Aşağıda, bu cevabın tersi yönde karar ya da " +
      "hüküm bulmak için ne arandığı ve ne bulunduğu yazıyor.",
    "",
    escapeInline(coverage.note),
    "",
    `Nerede arandı: **${escapeInline(coverage.scope.intent)}** — ${escapeInline(coverage.scope.rationale)}`,
  ];

  if (coverage.skipped) {
    out.push("", CONTRARY_SKIPPED_DETAIL_TR);
  } else if (coverage.lanes.length === 0) {
    out.push("", "Bu soru için aleyhe kaynak araması üretilemedi.");
  } else {
    out.push(
      "",
      "| Konu | Nerede arandı | Aranan kelimeler | Durum | Bulunan |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const lane of coverage.lanes) {
      out.push(
        `| ${escapeInline(lane.issueLabel)} | ${escapeInline(lane.kind)} | ` +
          `${escapeInline(lane.query)} | ${escapeInline(lane.status)} | ${lane.hits} |`,
      );
    }
  }

  if (coverage.observed.length > 0) {
    out.push(
      "",
      // W15: "kanıt kümesi" + "pasaj" tek başlıkta iki jargondu ve başlık,
      // avukata bu bölümün neden orada olduğunu söylemiyordu.
      "### Bulunan ama dayanak sayılmayan belgeler",
      "",
      "Bu pasajlar aramada çıktı, ancak cevaba dayanak yapılmadı. Metinlerini burada " +
        "göstermiyoruz: doğrulamadan geçmemiş bir metni alıntı gibi sunmak yanıltıcı olur. " +
        "İlginizi çeken bir satır varsa künyesinden belgeyi açıp kendiniz okuyabilirsiniz.",
      "",
      "| Belge | Tür | E./K. | Sonuç yönü | Neden dayanak sayılmadı |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const passage of coverage.observed) {
      const ek = [passage.docketNo, passage.decisionNo].filter((v) => v !== undefined).join(" / ");
      out.push(
        `| ${escapeInline(passage.title)} | ${escapeInline(passage.documentType)} | ` +
          `${escapeInline(ek === "" ? "-" : ek)} | ${escapeInline(passage.polarity)} | ` +
          `${observedReason(passage.reason)} |`,
      );
    }
  }

  return out.join("\n");
}
