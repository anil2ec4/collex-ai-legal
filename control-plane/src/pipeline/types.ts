/**
 * Serializable contracts for the end-to-end answer pipeline (brief 1.1, 9.x).
 *
 * `AnswerResult` is the ONE shape the HTTP API, the operator console and the
 * demo report all consume. It is deliberately free of canonical document text:
 * every claim points at evidence, and every evidence row carries the exact
 * quote plus the code-point span and the SHA-256 digests needed to re-derive
 * that quote from the stored document version. A reader can therefore verify a
 * citation without trusting this process.
 *
 * OFFSET POLICY: `startChar`/`endChar` are Unicode CODE POINT indices into the
 * NFC-normalized canonical text of `documentVersionId` (see
 * verification/validator.ts and fixtures/offset_policy.json).
 */

import type { EvidenceBundle } from "../answer/renderer.js";
import type { AnswerStatus, EntailmentAggregation } from "../answer/verifier.js";
import type { Verdict } from "../verification/finalize.js";
import type { ClaimDraft } from "../evidence/types.js";
import type {
  AuthorityAssessment,
  CurrentnessAssessment,
  EvidenceOrigin,
  EvidenceStance,
} from "../answer/evidencePack.js";
import type { CoverageGate } from "../answer/coverage.js";
import type { CoverageMeasuredOn } from "./questionIntent.js";
import type {
  CitationProvenance,
  ContraryProvenance,
  RelationProvenance,
} from "../retrieval/hybrid.js";
import type { OutcomePolarity } from "./stance.js";
import type { QuestionIntent } from "./questionIntent.js";

export type { AnswerStatus } from "../answer/verifier.js";

/**
 * Per-hit retrieval provenance, re-exported from `retrieval/hybrid.ts` rather
 * than restated here. Restating it would let the wire contract and the lane
 * that fills it drift apart silently, and these three shapes are the WHY of a
 * passage — the part a lawyer has to be able to read.
 */
export type {
  CitationProvenance,
  ContraryProvenance,
  RelationProvenance,
} from "../retrieval/hybrid.js";

/** One executed pipeline stage: what ran, how long it took, what it produced. */
export interface StageTrace {
  name: string;
  /** Wall-clock milliseconds for the stage (rounded to 0.01 ms). */
  ms: number;
  /** Stage-specific counters; always present, never null. */
  counts: Record<string, number>;
  /** Machine-readable notes (query labels, failure kinds, ...). */
  notes: string[];
}

/**
 * Where a passage came from in retrieval (audit trail for the ranking).
 *
 * `lanes` names WHICH lane produced the passage; the three optional blocks
 * below say WHY that lane produced it, and they are the answer to the only
 * question a lawyer asks about a passage they did not search for. The citator
 * lane is the clearest case: a reader who sees an amending instrument next to
 * an article needs "this edge, resolved by this resolver, at this confidence"
 * — "lane: relation" alone is not an explanation. All three are OPTIONAL and
 * additive: a hit the primary lanes found carries none of them, and a client
 * that ignores them sees exactly the previous contract.
 */
export interface RetrievalProvenance {
  /** True when the exact-reference lane pinned this chunk. */
  pinned: boolean;
  pinReason?: string;
  /** RRF fused score; 0 for pin-only hits. */
  fusedScore: number;
  /** Lane names that produced this chunk ("exact", "lexical", "trigram", ...). */
  lanes: string[];
  /** Labels of the pipeline queries that retrieved it ("primary", "contrary:..."). */
  queries: string[];
  /** Set when one-hop citation expansion pulled this passage in. */
  citation?: CitationProvenance;
  /** Set when the divergence-completion pass admitted this passage. */
  contrary?: ContraryProvenance;
  /**
   * Set when the citator lane followed a stored amendment edge to this
   * passage: the relation id, its direction and role, the resolver identity
   * and confidence recorded at ingest, and the already-ranked passage it was
   * reached from. This is what lets a reader see "bu madde şu kanunla
   * değiştirilmiş" instead of an unexplained extra source card.
   */
  relation?: RelationProvenance;
}

/** One citable passage, fully materialized and independently verifiable. */
export interface EvidenceView {
  evidenceId: string;
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  source: string;
  sourceUrl: string;
  /**
   * True only when `sourceUrl` is https on the source host allowlist
   * (security/urlPolicy). Renderers MUST NOT emit a live link when false.
   */
  sourceUrlAllowed: boolean;
  title: string;
  documentType: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
  article?: string;
  paragraph?: string;
  /** Unicode code point offset (inclusive) into the NFC canonical text. */
  startChar: number;
  /** Unicode code point offset (exclusive) into the NFC canonical text. */
  endChar: number;
  /** Exact canonical text of the span — never a provider snippet. */
  quote: string;
  /** SHA-256 hex over the UTF-8 bytes of `quote`. */
  quoteSha256: string;
  /** SHA-256 hex over the UTF-8 bytes of the whole canonical version text. */
  contentSha256: string;
  retrievedAt: string;
  authority: AuthorityAssessment;
  currentness: CurrentnessAssessment;
  stance: EvidenceStance;
  polarity: OutcomePolarity;
  /** Outcome-polarity markers that fired, verbatim (auditable). */
  polarityMarkers: string[];
  retrievalScore: number;
  retrieval: RetrievalProvenance;
  /**
   * Additive (W12): "upload" for a document the lawyer uploaded (rendered as
   * "yüklediğiniz belge"), "corpus" for the local corpus, "live" reserved
   * for the research lane. Always set by the answer pipeline.
   */
  origin?: EvidenceOrigin;
  /**
   * Additive (W12-FIX2): the passage was longer than the quote cap and the
   * quote is the best window of it ("alıntı kısaltıldı"); `startChar` /
   * `endChar` / `quoteSha256` describe the window, never the whole passage.
   */
  quoteTruncated?: boolean;
}

/**
 * Additive (W12, contract [R]): the question-coverage gate's result.
 * `ratio` is the weighted share of the question's content lexemes found in
 * the retrieved passages; `gate` says whether that was enough, or whether the
 * question's own citation made the check moot. `setAside` counts validated
 * passages the gate refused (they are listed in `contraryCoverage.observed`
 * with reason QUESTION_NOT_COVERED, by identity only).
 */
export interface QuestionCoverageView {
  /**
   * Additive (W14 B-08): which text the gate measured.
   *   "soru+olay"  the question as written (short questions, unchanged);
   *   "soru"       the legal question extracted from a long fact pattern —
   *                the narrative still went to retrieval as a ranking signal,
   *                but the coverage ratio is measured on the legal question.
   * Turkish label for the console: "Ölçüm: soru metni" / "soru + olay metni".
   */
  measuredOn?: CoverageMeasuredOn;
  ratio: number;
  covered: string[];
  missing: string[];
  gate: CoverageGate;
  floor: number;
  lexemes: string[];
  passages: number;
  bestPassageCovered: number;
  setAside: number;
  /**
   * Additive (W12-FIX): the gate was bypassed by an explicit reference but
   * the admitted passages still cover less than the floor of the question's
   * content words — the cited text is shown, the question is not answered
   * (verifier reason QUESTION_PARTIALLY_COVERED, never finalizable).
   */
  partiallyCovered?: boolean;
}

/** Additive (W12, contract [R]): which ports produced this answer. */
export interface AiUsedView {
  /** True when the cloud drafter produced the claims of this run. */
  drafter: boolean;
  /** True when the cloud entailment judge scored this run's claims. */
  entailment: boolean;
  /** User-facing label of the ports used (cloud label, or the rule-based one). */
  label: string;
}

/**
 * Additive (W14 B-09): the version comparison a temporal question is owed.
 *
 * Present on the answer ONLY when the question was temporal (an explicit
 * `asOf`, or a temporal phrasing). `present: false` means the answer rests on
 * a single version of the provision — the state that may never be COMPLETE.
 */
export interface TemporalVersionView {
  evidenceId: string;
  documentId: string;
  documentVersionId: string;
  title: string;
  legislationNo?: string;
  article?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  /** Where this version sits relative to the asked date. */
  role: "sorulan-tarihte" | "sonraki" | "onceki" | "belirsiz";
}

/** An instrument the relation lane says AMENDS a shown provision. */
export interface AmendingInstrumentView {
  chunkId: string;
  documentVersionId: string;
  title: string;
  legislationNo?: string;
  /** legal.relation_kind, e.g. "AMENDS". */
  kind: string;
}

export interface TemporalComparisonView {
  /** The question asked which text applied on a date. */
  applicable: boolean;
  /** Two or more versions of one document are actually in the evidence. */
  present: boolean;
  /** The date the answer was resolved against (YYYY-MM-DD). */
  asOf: string;
  versions: TemporalVersionView[];
  amendedBy: AmendingInstrumentView[];
  /** One Turkish sentence for the answer card. */
  note: string;
}

/** Additive (W12): the file scope the answer was restricted to, when any. */
export interface FileScopeView {
  fileIds: string[];
  includeCorpus: boolean;
}

/** A passage that was retrieved but refused entry to the evidence pack. */
export interface RejectedEvidenceView {
  chunkId: string;
  documentVersionId: string;
  title: string;
  /** Machine reason, e.g. OFFSET_OUT_OF_RANGE, SELF_CHECK_FAILED:QUOTE_HASH_MISMATCH. */
  reason: string;
}

export interface CitationCheckView {
  evidenceId: string;
  ok: boolean;
  reason?: string;
}

export interface EntailmentView {
  evidenceId: string;
  entails: boolean;
  score: number;
  rationale: string;
}

/** One verified claim with its five-dimension confidence vector. */
export interface ClaimView {
  claimId: string;
  text: string;
  material: boolean;
  treatment: ClaimDraft["treatment"];
  verdict: Verdict;
  /** Evidence ids that passed deterministic validation. */
  evidenceIds: string[];
  /** Evidence ids the drafter asked for (may include rejected ones). */
  draftedEvidenceIds: string[];
  contraryEvidenceIds: string[];
  confidence: ClaimDraft["confidence"];
  citationChecks: CitationCheckView[];
  entailments: EntailmentView[];
  reasons: string[];
  /**
   * Additive (W12-B2). False when every validated supporting passage of the
   * claim is an uploaded document: `confidence.currentness` then holds the
   * neutral score (currentness did not gate the claim) and MUST be rendered
   * as "yüklediğiniz belge — yürürlük değerlendirilemez", never as a
   * percentage. Absent/true: the strict yürürlük rule applied.
   */
  currentnessApplicable?: boolean;
  /**
   * Additive (W14 B-31): how `confidence.entailment` was aggregated —
   * "segments" (each part judged against the passages cited for it), "set"
   * (union of the cited passages, for an unsegmented rule-based claim), "max"
   * (the pre-W14 largest per-passage score) or "none".
   */
  entailmentAggregation?: EntailmentAggregation;
  /**
   * Additive (W14 B-31). False for a rule-based claim, whose text IS the
   * quotes: the entailment axis is then a tautology and the console must show
   * "— (kural tabanlı üretimde ölçülmez)" instead of a percentage. True when a
   * cloud drafter wrote the sentence, i.e. when the score means something.
   */
  entailmentMeasured?: boolean;
}

/** One executed contrary-authority search lane. */
export interface ContraryLaneRun {
  issueId: string;
  issueLabel: string;
  kind: string;
  baseTerm: string;
  flipPhrase: string;
  query: string;
  status: "ok" | "partial" | "error" | "skipped";
  /** Passages the lane returned. */
  hits: number;
  /** Passages the lane contributed that the primary query had not found. */
  newPassages: number;
  error?: string;
}

/**
 * A passage that was retrieved but deliberately NOT admitted as evidence for
 * this question. Identity only — never a quote: an unadmitted passage has not
 * been through the citation validator, so quoting it here would present
 * unverified text as if it were evidence.
 */
export interface ObservedPassage {
  chunkId: string;
  documentVersionId: string;
  title: string;
  documentType: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  polarity: OutcomePolarity;
  polarityMarkers: string[];
  /** Machine reason, e.g. SCOPED_OUT_NORM_CONTENT. */
  reason: string;
}

export interface ContraryCoverage {
  /** At least one contrary lane was executed. */
  executed: boolean;
  /**
   * ADDITIVE (W14 phase C, V-21). The contrary lanes were PLANNED and then
   * deliberately not run, because the primary lanes brought back nothing that
   * can anchor the question: the coverage gate is certain to set every
   * passage aside, so the answer has no evidence for a contrary lane to
   * contradict. `executed:false` alone could not tell that apart from "no
   * contrary query could be built for this question", and the rendered
   * sentence has to say which of the two happened.
   */
  skipped: boolean;
  /** At least one executed lane returned without a provider error. */
  usable: boolean;
  lanes: ContraryLaneRun[];
  /** Evidence classified as opposing authority (validated only). */
  contraryEvidenceIds: string[];
  /** Claims the verifier marked CONFLICTING_AUTHORITIES. */
  conflictedClaimIds: string[];
  /** Retrieved but not admitted as evidence, with the reason. */
  observed: ObservedPassage[];
  /** How the evidence set was scoped for this question. */
  scope: {
    intent: QuestionIntent;
    rationale: string;
    /** Passages set aside by the scoping rule. */
    scopedOut: number;
  };
  /** Turkish, human-readable summary of what was searched and found. */
  note: string;
}

/**
 * `collex.answer.evidence-bundle/v1` plus the ADDITIVE optional fields the
 * Python exporter (`export/bundle.py`) already understands. The schema id is
 * unchanged, so an exporter that ignores these fields still reads the bundle:
 *
 *  - `texts`          canonical NFC text per documentVersionId. With it the
 *                     exporter can re-derive every quote from its offsets
 *                     instead of only re-hashing the recorded quote.
 *  - `synthetic` /    provenance of the corpus. NEVER omitted by this pipeline:
 *    `syntheticNotice` a reader must be told when the "authority" is test data.
 *  - `producer`       free-text build identifier reproduced in the export.
 */
export interface ExportableEvidenceBundle extends EvidenceBundle {
  texts?: Record<string, string>;
  synthetic?: boolean;
  syntheticNotice?: string;
  producer?: string;
}

export const ANSWER_RESULT_SCHEMA = "collex.answer.result/v1" as const;

export interface AnswerResult {
  schema: typeof ANSWER_RESULT_SCHEMA;
  runId: string;
  question: string;
  normalizedQuestion: string;
  /** ISO date (YYYY-MM-DD) the question was answered "as of". */
  asOf: string;
  status: AnswerStatus;
  finalizable: boolean;
  /** Machine reasons from the verifier + the pipeline. */
  reasons: string[];
  /** Degradation notices (lane failures, caps applied, rejected evidence). */
  warnings: string[];
  claims: ClaimView[];
  evidence: EvidenceView[];
  rejectedEvidence: RejectedEvidenceView[];
  contraryCoverage: ContraryCoverage;
  trace: StageTrace[];
  /** Turkish user-facing Markdown, already render-guarded. */
  markdown: string;
  /** Structured audit export (answer/renderer.ts contract, additively widened). */
  bundle: ExportableEvidenceBundle;
  /**
   * Provenance banner for the corpus behind this answer. NEVER blank: a reader
   * must always be told whether they are looking at real authority or a
   * synthetic test corpus.
   */
  corpusNotice: string;
  /**
   * Additive (W18): how many admitted evidence documents came from the real
   * local library (`fixture_meta.synthetic: false`), from the synthetic
   * fixture corpus, or from a version whose provenance the store did not
   * report. The banner is chosen from this: only an answer whose EVERY
   * admitted document is real drops the "deneme belgeleri" warning.
   */
  corpusProvenance?: { real: number; synthetic: number; unknown: number; upload?: number };
  generatedAt: string;
  /** Additive (W12): question-coverage gate result. Always set by the pipeline. */
  coverage?: QuestionCoverageView;
  /** Additive (W12): which drafter/entailment ports produced this run. */
  aiUsed?: AiUsedView;
  /**
   * Additive (W14 B-09): present ONLY for a temporal question. Says whether
   * the answer put two versions of the provision side by side, and which
   * instrument amended it when the relation lane found one.
   */
  temporal?: TemporalComparisonView;
  /** Additive (W12): present only when the request restricted retrieval to uploads. */
  fileScope?: FileScopeView;
}
