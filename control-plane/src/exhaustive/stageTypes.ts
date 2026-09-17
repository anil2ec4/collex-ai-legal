/**
 * Durable analytical STAGES after source reading (W21, ADR-040).
 *
 * W20 made READING durable: every analysis unit is a leased row, and a run
 * cannot say it read the whole file unless every unit was read. The stages
 * that came after reading were one leased step that analysed a PREFIX —
 * the first 25 claims, 8 candidates each, the first 40 findings for the
 * synthesis — and reported the cut in a note. W21 replaces that step with
 * durable tasks:
 *
 *   weigh_claim / weigh_defense
 *       one claim (or defense) against ONE bounded batch of candidate
 *       evidence. Every claim gets as many batches as its candidate set
 *       needs; none is skipped because a model call is bounded.
 *   contradiction_group
 *       one bounded batch of free-text proposition pairs for the semantic
 *       contradiction lane.
 *   synthesis_group (level 1) / synthesis_reduce (level >= 2)
 *       the hierarchical review: every finding lands in exactly one level-1
 *       batch; every level-k summary lands in exactly one level-(k+1)
 *       batch; the last level has ONE task. A finding in the last batch
 *       therefore reaches the final summary through its group summary.
 *   plan
 *       a marker that a planning step ran (and what it planned), so a
 *       re-planned run after a crash inserts nothing twice and never plans
 *       with different inputs than the first time.
 *
 * Bounds here are PER CALL (a small local model has a small context). None
 * of them removes anything from the analysis universe: a bound only changes
 * how many calls the universe takes.
 */

import type { ObservationRelation } from "./contradictions.js";
import type { AnalysisTask } from "./tasks.js";

/**
 * Version of the stage prompts, schemas and planners. Part of run identity.
 *
 * stage-v2 (W21 review #8/#9): the weighing and contradiction prompts judge
 * the VERIFIED quotes and fence the claim as data, and pairs/candidates carry
 * the quotes. A stage-v1 row was judged on the paraphrases, so a run holding
 * one is refused (worker.ts versionMismatch), never finalized by this code.
 *
 * stage-v3 (W21 round-two review): a candidate that overlaps the claim's own
 * span is not weighed against it; candidate and claim quotes are shown up to
 * WEIGH_*_QUOTE_CHARS and a clipped quote is RECORDED (quoteClipped,
 * claimQuoteClipped) so a comparison on cut text never licenses "no support
 * after a complete search"; contradiction pairs record clipped quotes; the
 * synthesis records the parts it could not see (missingParts).
 */
export const STAGE_SCHEMA_VERSION = "stage-v3";

/**
 * How much of a verified quote the weighing model is shown. The extraction
 * schema allows quotes up to 1200 characters; a longer quote is clipped and
 * the clip is recorded (WeighCandidate.quoteClipped).
 */
export const WEIGH_CANDIDATE_QUOTE_CHARS = 600;
export const WEIGH_CLAIM_QUOTE_CHARS = 800;

export type StageKind =
  | "plan"
  | "weigh_claim"
  | "weigh_defense"
  | "contradiction_group"
  | "synthesis_group"
  | "synthesis_reduce";

export type StageTaskState = "pending" | "running" | "done" | "failed" | "excluded";

/** A task the planner wants to exist. Inserting it twice is a no-op. */
export interface StageTaskSpec {
  readonly stage: StageKind;
  readonly taskKey: string;
  readonly level: number;
  readonly seq: number;
  readonly input: Record<string, unknown>;
  /** A planned task that must not run, with the reason (never silent). */
  readonly exclusionReason?: string | undefined;
  /**
   * A task that is already complete when it is planned — e.g. a claim in a
   * matter with no evidence at all: the comparison with the (empty) evidence
   * universe is complete and needs no model call. Stored as done with this
   * result, so it is counted, never skipped.
   */
  readonly doneResult?: Record<string, unknown> | undefined;
}

/** A relation found by the semantic lane, ready to be stored. */
export interface SemanticRelationRow {
  readonly leftObservationId: string;
  readonly rightObservationId: string;
  readonly relation: ObservationRelation;
  readonly rationale: string;
  readonly confidence: number | null;
  readonly detector: string;
}

/** A stored task row, as the planner and the finalizer read it back. */
export interface StageTaskRow {
  readonly taskId: string;
  readonly runId: string;
  readonly stage: StageKind;
  readonly taskKey: string;
  readonly level: number;
  readonly seq: number;
  readonly state: StageTaskState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly input: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
  readonly exclusionReason: string | null;
  readonly modelId: string | null;
  /**
   * STAGE_SCHEMA_VERSION the row was planned under. A row from another
   * version is never finalized by this code (worker.ts refuses the run):
   * its refs and payloads may not mean what this version reads into them.
   */
  readonly schemaVersion: string | null;
}

/** A task claimed by a worker under a lease. */
export interface StageTaskClaim {
  readonly taskId: string;
  readonly runId: string;
  readonly matterId: string;
  readonly task: AnalysisTask;
  readonly stage: StageKind;
  readonly taskKey: string;
  readonly level: number;
  readonly input: Record<string, unknown>;
  readonly attempts: number;
  readonly maxAttempts: number;
  /** The model the run was created with; a different one is refused. */
  readonly runModelId: string | null;
  readonly synthesisModel: string | null;
}

// ---------------------------------------------------------------------------
// Per-call bounds (configuration, not truncation)
// ---------------------------------------------------------------------------

export interface StageConfig {
  /** Candidates shown to the model per weighing call. */
  readonly weighBatchSize: number;
  /**
   * When the matter has at most this many evidence items, EVERY claim is
   * compared with EVERY evidence item, so "no support" can be a finding
   * (NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH). Above it, each claim is
   * compared with its hybrid candidate set, and "no support" can only be
   * reported as NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES.
   */
  readonly fullSearchMaxEvidence: number;
  /** Candidate-set size per claim when the full search does not apply. */
  readonly candidatesPerClaim: number;
  /** Proposition pairs classified per semantic-contradiction call. */
  readonly contradictionPairsPerCall: number;
  /** Findings (or summaries) shown per synthesis call. */
  readonly synthesisEntriesPerCall: number;
  /** Points accepted per synthesis call; more is reported as truncated. */
  readonly pointsPerCall: number;
  /**
   * Semantic contradiction lane: significant-stem overlap (overlap
   * coefficient) that makes two propositions COMPARED. Lower = more recall,
   * more model calls. Decides what is examined, never what is asserted.
   */
  readonly contradictionMinLexical: number;
  /** The same, for local-embedding cosine. */
  readonly contradictionMinCosine: number;
}

/**
 * Item kinds a claim or defense is weighed against. The model's kind label
 * must not decide what a "complete" search covered: an event (a bank
 * transfer on a date), a procedural event (a service) or a credibility issue
 * can carry exactly the support a claim needs.
 */
export const SUPPORT_UNIVERSE_KINDS: ReadonlySet<string> = new Set([
  "evidence",
  "fact",
  "event",
  "procedural_event",
  "credibility_issue",
]);

export const DEFAULT_STAGE_CONFIG: StageConfig = Object.freeze({
  weighBatchSize: 8,
  fullSearchMaxEvidence: 48,
  candidatesPerClaim: 24,
  contradictionPairsPerCall: 10,
  synthesisEntriesPerCall: 24,
  pointsPerCall: 16,
  contradictionMinLexical: 0.34,
  contradictionMinCosine: 0.86,
});

const CONFIG_ENV: Readonly<
  Record<keyof StageConfig, [name: string, min: number, max: number, kind: "int" | "ratio"]>
> = {
  weighBatchSize: ["COLLEX_ANALYSIS_WEIGH_BATCH", 1, 32, "int"],
  fullSearchMaxEvidence: ["COLLEX_ANALYSIS_FULL_SEARCH_MAX_EVIDENCE", 0, 10_000, "int"],
  candidatesPerClaim: ["COLLEX_ANALYSIS_CANDIDATES_PER_CLAIM", 1, 500, "int"],
  contradictionPairsPerCall: ["COLLEX_ANALYSIS_CONTRADICTION_PAIRS_PER_CALL", 1, 40, "int"],
  synthesisEntriesPerCall: ["COLLEX_ANALYSIS_SYNTHESIS_ENTRIES_PER_CALL", 2, 120, "int"],
  pointsPerCall: ["COLLEX_ANALYSIS_POINTS_PER_CALL", 1, 64, "int"],
  // Exclusive of 0: a threshold of 0 would pair everything with everything.
  contradictionMinLexical: ["COLLEX_ANALYSIS_CONTRADICTION_MIN_LEXICAL", 0.05, 1, "ratio"],
  contradictionMinCosine: ["COLLEX_ANALYSIS_CONTRADICTION_MIN_COSINE", 0.5, 1, "ratio"],
};

/**
 * Read the per-call bounds from the environment. An unparseable or
 * out-of-range value keeps the default: a typo must not silently turn the
 * analysis off (e.g. a batch size of 0).
 */
export function resolveStageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StageConfig {
  const out: Record<string, number> = { ...DEFAULT_STAGE_CONFIG };
  for (const key of Object.keys(CONFIG_ENV) as Array<keyof StageConfig>) {
    const [name, min, max, kind] = CONFIG_ENV[key];
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    const shaped = kind === "int" ? Number.isInteger(value) : Number.isFinite(value);
    if (shaped && value >= min && value <= max) out[key] = value;
  }
  return out as unknown as StageConfig;
}

// ---------------------------------------------------------------------------
// Task payloads (stored in matter_analysis_tasks.input / .result)
// ---------------------------------------------------------------------------

/** Which relatedness signals a candidate matched on. */
export interface CandidateSignals {
  readonly reference: number;
  readonly lexical: number;
  readonly semantic: number | null;
  readonly entity: number;
  readonly temporal: number;
  readonly party: number;
  readonly structure: number;
}

export interface WeighCandidate {
  /** itemRef of the evidence/fact item (`kind:key`). */
  readonly ref: string;
  /** The model's normalized statement (a paraphrase; NOT verified text). */
  readonly title: string;
  /**
   * The VERIFIED source quote the item rests on (clipped). This, not the
   * title, is what the weighing model judges; absent only on rows planned
   * before it was recorded (and in the bake-off), where the title stands in.
   */
  readonly quote?: string | undefined;
  /**
   * The verified quote was longer than WEIGH_CANDIDATE_QUOTE_CHARS and the
   * model saw only its beginning. A "no support" verdict on such a candidate
   * was reached on incomplete text (W21 round-two review).
   */
  readonly quoteClipped?: boolean | undefined;
  readonly score: number;
  readonly signals: CandidateSignals;
}

export interface WeighInput {
  readonly claimRef: string;
  readonly claimKind: "claim" | "defense";
  /** The model's normalized claim statement (a paraphrase; NOT verified). */
  readonly claimTitle: string;
  /** The VERIFIED source quote of the claim (clipped); see WeighCandidate.quote. */
  readonly claimQuote?: string | undefined;
  readonly claimPartyRole: string | null;
  readonly batchNo: number;
  readonly batchCount: number;
  readonly candidates: readonly WeighCandidate[];
  /** Every evidence item of the matter is in SOME batch of this claim. */
  readonly candidateSetComplete: boolean;
  /** Evidence items in the matter (the search universe). */
  readonly universeSize: number;
  readonly semanticSignal: boolean;
  /** The claim's verified quote was longer than WEIGH_CLAIM_QUOTE_CHARS and was shown clipped. */
  readonly claimQuoteClipped?: boolean | undefined;
  /**
   * Universe items NOT weighed against this claim because their source span
   * overlaps the claim's own span (the claim's sentence restated, e.g. a
   * date window around it). They cannot support the claim they restate.
   */
  readonly selfOverlapExcluded?: number | undefined;
}

export type WeighStance = "supports" | "opposes" | "ambiguous" | "unrelated";

export interface WeighResult {
  readonly verdicts: ReadonlyArray<{ ref: string; stance: WeighStance; rationale?: string | undefined }>;
  /** Verdicts naming a candidate that was not shown. */
  readonly rejected: number;
  /** Candidates the model gave no verdict for (treated as not judged). */
  readonly unanswered: number;
}

export interface ContradictionPair {
  readonly pairId: string;
  readonly leftObservationId: string;
  readonly rightObservationId: string;
  /** The extraction model's paraphrase (NOT verified against the source). */
  readonly leftStatement: string;
  readonly rightStatement: string;
  /**
   * The VERIFIED quotes (clipped): the text the application located exactly
   * in the pinned source. The classifier judges these; the statements are
   * shown only as non-binding labels.
   *
   * Every pair the planner makes carries both. The prompt builder
   * (classificationRequest) takes a pair WITHOUT a quote as one whose
   * statement already is the verbatim text: that is how the bake-off passes
   * its case passages, so it measures the production prompt. Production
   * never relies on that: processStageTask shows the model no pair lacking
   * a quote (it is counted as unclassified), and stage-v1 rows, which had
   * no quotes, are refused by the schema-version check.
   */
  readonly leftQuote?: string | undefined;
  readonly rightQuote?: string | undefined;
  /** A side's verified quote was longer than STATEMENT_CLIP_CHARS and was shown clipped. */
  readonly leftQuoteClipped?: boolean | undefined;
  readonly rightQuoteClipped?: boolean | undefined;
  readonly leftFileId: string;
  readonly rightFileId: string;
  readonly score: number;
}

export interface ContradictionGroupInput {
  readonly groupKey: string;
  readonly batchNo: number;
  readonly batchCount: number;
  readonly pairs: readonly ContradictionPair[];
}

export interface ContradictionGroupResult {
  readonly verdicts: ReadonlyArray<{
    pairId: string;
    relation: ObservationRelation;
    rationale: string;
    confidence?: number | undefined;
  }>;
  readonly rejected: number;
  /** Pairs with no verdict: not answered, or not shown (see `withoutQuote`). */
  readonly unanswered: number;
  /** Pairs not shown to the model because a side had no verified quote (included in `unanswered`). */
  readonly withoutQuote?: number | undefined;
}

/** One line a synthesis call sees: a finding or a lower-level summary. */
export interface SynthesisEntry {
  readonly ref: string;
  readonly kind: string;
  readonly title: string;
  readonly partyRole: string | null;
  readonly supportStatus: string | null;
  /** Provenance carried upward through every level. */
  readonly sourceObservationIds: readonly string[];
  /**
   * W21 review: the finding's verified basis quote (level-1 entries only).
   * The title is the extraction model's summary; the quote is what the
   * document says, so the synthesis model can check one against the other.
   */
  readonly quote?: string | undefined;
  /**
   * The verified quotes of a finding with SEVERAL basis sources (a
   * contradiction, its question): the sides, none of which is established.
   */
  readonly quotes?: readonly string[] | undefined;
}

export type SynthesisMode = "review" | "red_team";

/** Lower-level parts a synthesis task was NOT shown (failed or produced no summary). */
export interface SynthesisMissingParts {
  readonly count: number;
  /** Their group labels (document-derived: shown only inside the data block). */
  readonly labels: readonly string[];
}

export interface SynthesisInput {
  readonly level: number;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly batchNo: number;
  readonly batchCount: number;
  readonly entries: readonly SynthesisEntry[];
  readonly perspective: string | null;
  readonly mode: SynthesisMode;
  /** The single task of the top level: its summary is the review summary. */
  readonly final: boolean;
  /**
   * W21 round-two review: parts of the file this task summarizes WITHOUT
   * (a lower-level group or reduction that failed). A final evaluation with
   * missing parts is never presented as the evaluation of the whole file.
   */
  readonly missingParts?: SynthesisMissingParts | undefined;
}

export interface SynthesisPoint {
  readonly kind: string;
  readonly title: string;
  readonly body?: string | undefined;
  readonly sourceObservationIds: readonly string[];
  readonly hypothetical: boolean;
}

export interface SynthesisResult {
  readonly summary: { title: string; body: string; sourceObservationIds: readonly string[] } | null;
  readonly points: readonly SynthesisPoint[];
  /** Points rejected for citing nothing that was shown. */
  readonly rejected: number;
  /** The model returned more points than one call accepts. */
  readonly truncated: boolean;
}

/** What a `plan` marker records about the planning step it stands for. */
export interface PlanMarker {
  readonly step: string;
  readonly planned: number;
  readonly notes?: readonly string[] | undefined;
  readonly details?: Record<string, unknown> | undefined;
}
