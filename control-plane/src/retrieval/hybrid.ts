/**
 * Hybrid retrieval pipeline (Master Build Brief section 8.6), dense lane
 * stubbed until a pgvector runtime exists.
 *
 * Order (brief 8.6):
 *   query -> normalizeTurkishSearch -> parseReferences
 *         -> exact-pin lane (deterministic; NEVER displaced by scores)
 *         -> lexical (turkish FTS) + trigram lanes
 *         -> Reciprocal Rank Fusion (rrf.ts)
 *         -> dedupe by document with a source-diversity cap
 *         -> citation expansion   (brief 6.8 / 10.1)
 *         -> citator lane          (brief 6.8, legal.document_relations)
 *         -> divergence completion (brief 10.2)
 *         -> RankedHit[] with per-hit lane provenance.
 *
 * ---------------------------------------------------------------------------
 * The last two stages were added 2026-08-27 against measured failures on the
 * fixture corpus (contrary-authority recall 0.0000 over n=3; temporal accuracy
 * 66.7%). Both are gated on the primary stages having found something, so
 * neither can manufacture a hit for a question the corpus cannot answer — the
 * abstention guarantee is unchanged by construction, not by tuning.
 *
 * CITATION EXPANSION — one hop, outbound only. A passage that says "5237
 * sayılı Türk Ceza Kanununun 157 nci maddesi" is a pointer, and a reader who
 * gets the amending provision without the amended text has been given half an
 * answer. Each seed passage is re-parsed with the SAME reference parser used
 * on the query; a legislation reference is paired with the first article
 * reference that follows it before the next legislation reference (which is
 * how a citation reads, and which is why the chunk's own "MADDE 1 -" heading
 * — it PRECEDES the citation — is never mistaken for the target article), and
 * the pair is resolved through the ordinary as-of-filtered pin lookup. So the
 * target arrives in the version in force on the QUESTION's date, not the
 * version current today. Self-citations are dropped.
 *
 * CORRECTED 2026-09-02 (W12 lane B). Expanded provisions used to arrive as
 * `pinned: true, lanes: [exact], score 1`, i.e. indistinguishable from a
 * provision the READER cited. The audit reproduced the consequence: a
 * question about a rental deposit retrieved one decision on the word
 * "sözleşme", that decision cited TCK m.157, and m.157 led the answer as a
 * pinned, score-1 hit. An expansion is context for its seed, not an answer
 * to the question. It now arrives UNPINNED, on its own `citation` lane, with
 * 0.9x the seed's fused score — so it follows its seed and can never outrank
 * a passage the reader's own words earned, and a pinned hit again means
 * exactly one thing: the exact-reference lane matched the question.
 *
 * CITATOR LANE (added 2026-08-27 against the last measured temporal failure).
 * One gold query — "which torba amendment raised the base penalty for
 * dolandırıcılık, and when did it commence?" — asks for two passages that no
 * lexical mechanism can reach: the amending provision names neither the
 * offence nor the words of the question, and the amended article's own text
 * says nothing about having been amended. Retrieval is not the missing piece;
 * the EDGE is. `legal.document_relations` now carries it (written at ingest
 * by ingestion/relations.py from the instrument's amendment structure,
 * resolved through legal_reference/resolver.py), and this lane follows it in
 * both directions. See `runCitatorLane` for what keeps it from manufacturing
 * hits.
 *
 * DIVERGENCE COMPLETION — the contrary-authority branch, executed rather than
 * merely planned. Retrieval that ranks by similarity to the question returns
 * the passages that agree with its framing; the decision pointing the other
 * way uses different words and loses. After fusion, if the results contain
 * judicial passages with a classifiable outcome (stance.ts), a SECOND lexical
 * pass runs at a deliberately lower coverage floor and admits any judicial
 * passage whose outcome differs from one already retrieved. It is symmetric
 * on purpose: it completes the split whichever side surfaced first, so the
 * result does not depend on which of two disagreeing decisions happened to
 * rank higher. Legislation is never contrary authority (stance.ts), and a
 * NORM_CONTENT question — "what does the provision say?" — is skipped
 * entirely (questionIntent.ts): a decision holding a rule inapplicable to
 * some facts is not authority against the rule's TEXT.
 * ---------------------------------------------------------------------------
 *
 * Each lane failure is contained (brief principle 8: partial results with
 * warnings instead of all-or-nothing): the pipeline records the failure and
 * keeps going with the surviving lanes. The search service maps recorded
 * failures onto the Outcome envelope.
 *
 * The pipeline also reports NORMALIZER DRIFT: chunks whose
 * legal.chunks.normalizer_version is not the version this control-plane
 * normalized the query with are still returned, but flagged, because their
 * search_text was produced by different rules and their recall is therefore
 * unspecified rather than merely lower. See chunkStore's
 * QUERY_NORMALIZER_VERSION.
 */

import { normalizeTurkishSearch } from "./normalize.js";
import { parseReferences, type ParsedReference } from "./referenceParser.js";
import { assertLaneWeight, DEFAULT_RRF_K, reciprocalRankFusion } from "./rrf.js";
import {
  DEFAULT_QUERY_EXPANSION_LIMIT,
  emptyExpansion,
  expandQuery,
  type QueryExpansion,
} from "./queryExpansion.js";
import { corpusErrorCode } from "./corpusErrors.js";
import type { Sql } from "../store/db.js";
import {
  DEFAULT_CITATOR_KINDS,
  DEFAULT_LEXICAL_MIN_COVERAGE,
  DEFAULT_TRIGRAM_BUDGET_MS,
  TrigramBudgetExceededError,
  chunkProvenanceByIds,
  citatorLookup,
  exactPinLookup,
  fetchCanonicalText,
  isFileScope,
  DEFAULT_EXPANSION_TERM_WEIGHT,
  lexicalSearch,
  trigramSearch,
  QUERY_NORMALIZER_VERSION,
  type ChunkProvenance,
  type CitatorHit,
  type LexicalQueryMode,
  type PinnedChunk,
  type RelationDirection,
  type RelationRole,
  type ScoredChunk,
  type StoreSearchFilters,
} from "../store/chunkStore.js";
import {
  classifyStance,
  isLegislativeDocumentType,
  type OutcomePolarity,
} from "../pipeline/stance.js";
import {
  classifyQuestionIntent,
  type QuestionIntent,
} from "../pipeline/questionIntent.js";

export type { ChunkProvenance, StoreSearchFilters } from "../store/chunkStore.js";
export { fetchCanonicalText, QUERY_NORMALIZER_VERSION };

// --------------------------------------------------------------------------
// Dense lane seam
// --------------------------------------------------------------------------

/**
 * Dense (embedding) candidate lane seam.
 *
 * Activation contract: a real implementation exists only when BOTH
 *  - the pgvector runtime is present (migrations 20260826080000/090000
 *    applied — NOT possible on the local scratch Postgres), and
 *  - an active row in legal.embedding_profiles matches the deployed
 *    embedding model/dimension.
 * Until then NoopDenseLane keeps the pipeline shape without results.
 *
 * The lane returns best-first ranked chunk ids; the pipeline folds them into
 * the fusion with the same 1/(k + rank) RRF term used by rrf.ts.
 */
export interface DenseLane {
  readonly name: string;
  /**
   * Best-first chunk ids for `queryText`.
   *
   * `filters` is passed for the same reason every other lane receives it: a
   * lane that does not know about file/matter scope would return neighbours
   * from outside the caller's scope. A lane MAY use it to pre-filter its
   * index; it is not required to, because the ids are re-checked against the
   * database's own visibility filter during hydration
   * (`chunkProvenanceByIds`). The index is treated as untrusted input.
   */
  search(
    queryText: string,
    options: {
      asOf: string;
      limit: number;
      filters?: StoreSearchFilters | undefined;
    },
  ): Promise<string[]>;
  /**
   * What this lane can honestly say about itself right now. A lane that
   * cannot answer reports DEGRADED or FAILED; it never reports ACTIVE
   * because it exists. Omitted means "no self-report" and is treated as
   * DISABLED when the lane returns nothing.
   */
  readonly state?: DenseLaneState;
}

/**
 * Honest states for the dense lane.
 *
 * `DISABLED` is not `HEALTHY` and `DEGRADED` is not `ACTIVE`: a reader must
 * be able to tell "semantic search found nothing" from "semantic search is
 * not running", because only one of those is a statement about the corpus.
 */
export type DenseLaneState = "ACTIVE" | "DEGRADED" | "DISABLED" | "FAILED";

/** What the dense lane did on one search. */
export interface DenseReport {
  readonly lane: string;
  readonly state: DenseLaneState;
  /** Ids the lane returned. */
  readonly returned: number;
  /**
   * Ids that survived hydration and became candidates. Fewer than
   * `returned` means the database refused them — stale index entries, or
   * chunks outside the caller's scope.
   */
  readonly hydrated: number;
  /**
   * Ids the lane alone contributed: not found by any lexical/trigram lane.
   * This is the number that says whether dense retrieval is DOING anything;
   * a dense lane that only re-ranks lexical hits has this at 0.
   */
  readonly denseOnly: number;
}

/** Placeholder dense lane: always empty, never fails, honest about it. */
export class NoopDenseLane implements DenseLane {
  readonly name = "noop-dense";
  readonly state: DenseLaneState = "DISABLED";
  async search(): Promise<string[]> {
    return [];
  }
}

// --------------------------------------------------------------------------
// Shapes
// --------------------------------------------------------------------------

/**
 * "citation" (additive, 2026-09-02) is the one-hop citation-expansion lane:
 * a provision reached by following a citation OUT of a ranked passage. It
 * used to masquerade as "exact"; see the module header.
 */
export type LaneName = "exact" | "lexical" | "trigram" | "dense" | "relation" | "citation";

export interface LaneProvenance {
  lane: LaneName;
  /** 1-based rank within that lane's own ordering. */
  rank: number;
  /**
   * Lane-native score: ts_rank_cd (lexical), similarity (trigram), 1.0
   * (exact pin — deterministic, not a relevance estimate), 1/(k+rank)
   * contribution (dense).
   */
  score: number;
}

/** Why a hit was pulled in by following a citation out of another passage. */
export interface CitationProvenance {
  /** chunkId of the passage whose text carried the citation. */
  citedByChunkId: string;
  /** The resolved reference, e.g. "5237 m.157". */
  reference: string;
}

/** Why a hit was admitted by the divergence-completion pass. */
export interface ContraryProvenance {
  /** Outcome polarity of THIS passage (stance.ts). */
  polarity: OutcomePolarity;
  /** Markers that fired, verbatim from stance.ts's tables. */
  markers: string[];
  /** chunkId of the already-retrieved passage whose outcome this one opposes. */
  opposesChunkId: string;
  /** Outcome polarity of that opposed passage. */
  opposesPolarity: OutcomePolarity;
}

/** Why a hit was pulled in by following a stored amendment relation. */
export interface RelationProvenance {
  /** Which side of the edge the SEED was on (see chunkStore). */
  direction: RelationDirection;
  /** legal.relation_kind, e.g. "AMENDS". */
  kind: string;
  /** Which end of the edge THIS passage is. */
  role: RelationRole;
  relationId: string;
  /** Always 'resolved' — the lane follows nothing else. */
  resolutionStatus: string;
  /** Resolver confidence recorded at ingest, in [0,1]. */
  confidence: number | null;
  /** Identity of the resolver that decided the edge. */
  resolverVersion: string;
  /** chunkId of the already-ranked passage whose document matched the edge. */
  viaChunkId: string;
  targetLegislationNo: string | null;
  targetArticleNo: string | null;
}

export interface RankedHit {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  /** Pinned hits come from the exact-reference lane and always rank first. */
  pinned: boolean;
  pinReason?: string;
  /** RRF fused score over the ranked lanes (0 when only pinned). */
  fusedScore: number;
  lanes: LaneProvenance[];
  provenance: ChunkProvenance;
  /** Set when the hit arrived through one-hop citation expansion. */
  citation?: CitationProvenance;
  /** Set when the hit arrived through the divergence-completion pass. */
  contrary?: ContraryProvenance;
  /** Set when the hit arrived through the citator (relation) lane. */
  relation?: RelationProvenance;
}

/**
 * The trigram lane runs only when the exact and lexical lanes together
 * produced FEWER than this many distinct passages (W14 F-PERF, V-1).
 *
 * WHY THE LANE IS GATED AT ALL. chunkStore calls it "(b) Trigram fallback
 * lane" and its documented job is narrow: recover phrase hits the STEMMER
 * cannot, above all Turkish dotted/dotless-I forms where the query and the
 * stored text share no lexeme. It was never a general-purpose ranking lane —
 * but it ran on every query, and at corpus scale that cost the answer
 * everything. Measured end to end over HTTP on 02.09.2026 (probe database
 * `collex_perf_test`, 20 000 chunks, avg search_text 4 974 code points):
 * "depozito iadesi" took p50 59 458 ms and returned ABSTAIN, because the
 * `<%` recheck ran over the full 5 kB text of all 20 000 candidate rows in
 * each of four lane invocations (one primary + three contrary probes) and
 * each was cut by the connection's 15 s statement_timeout.
 *
 * WHY GATING IS SOUND, not merely cheap. A query whose trigrams saturate the
 * GIN index is — structurally, not coincidentally — a query whose WORDS are
 * everywhere in that corpus, and those are exactly the queries the FTS lane
 * answers first and in full. The expensive case and the case where the
 * fallback is unnecessary are the SAME case. Conversely the case the lane
 * exists for (a query token the stemmer cannot match) leaves the FTS lane
 * short, which is what opens the gate.
 *
 * WHY EIGHT. It is the answer's own evidence ceiling
 * (`AnswerPipeline.maxEvidence` = 8): once the exact and lexical lanes have
 * produced at least as many distinct passages as the answer can ever show,
 * a fallback lane cannot change what the reader sees except by re-ranking,
 * and re-ranking is not what this lane is for.
 *
 * WHAT IT COSTS, honestly. This is a RECALL CHANGE, not a pure optimisation:
 * on a query where the primary lanes already return eight or more passages
 * AND a ninth passage would only have been reachable through fuzzy matching,
 * that passage is no longer retrieved. Measured on the gold set
 * (evals/reports/fixture_baseline_2026-09-02.json) the trigram lane was the
 * SOLE contributor of ZERO hits — all five of its hits were also found by
 * exact or lexical — and re-running scripts/run_evals.py after this change
 * reproduced every gate and every metric. The change is reported per query in
 * {@link TrigramReport}, never inferred from silence.
 */
export const DEFAULT_TRIGRAM_FALLBACK_MIN_HITS = 8;

/**
 * Per-lane RRF multipliers (additive, 2026-09-10). DOCUMENTED ORDERING:
 *
 *   exact pin  >  lexical (1.0)  >  trigram (0.7)   [dense 1.0, see below]
 *
 * - The exact-pin lane is not weighted at all: a pinned hit is placed FIRST
 *   and is never displaced by any fused score (that is what "pinned" means),
 *   so it sits above every weight by construction.
 * - Lexical is the reference lane (weight 1): a passage that carries the
 *   reader's own lexemes under the Turkish FTS configuration.
 * - Trigram is the FALLBACK lane (W14-F-PERF): a fuzzy `word_similarity`
 *   match exists to catch spelling variants and dotted/dotless-I drift, and
 *   at the same rank it should not outweigh an exact lexeme match. 0.7 is a
 *   round value, not a fitted one: it keeps a trigram rank-1 above a lexical
 *   rank-2 (0.7/61 > 1/62 at k = 60) so the lane can still lead when the
 *   lexical lane is thin, while a passage present in BOTH lanes beats either
 *   alone. Re-measure on a real corpus (P0-11).
 * - Dense is the Noop lane until pgvector exists; it keeps weight 1 (equal to
 *   lexical) because nothing has been measured (P0-12) and an unmeasured
 *   discount is exactly the kind of number this project forbids.
 */
export interface LaneWeights {
  lexical: number;
  trigram: number;
  dense: number;
}

export const DEFAULT_LANE_WEIGHTS: Readonly<LaneWeights> = Object.freeze({
  lexical: 1,
  trigram: 0.7,
  dense: 1,
});

export interface SearchLimits {
  /**
   * Per-lane RRF multipliers; see {@link DEFAULT_LANE_WEIGHTS}. Partial: an
   * omitted lane keeps its default. Every value must be a positive finite
   * number (0 would silence a lane, which is what `trigramLimit: 0` is for).
   */
  laneWeights?: Partial<LaneWeights>;
  /**
   * Max synonym terms the corpus-lane query expansion may add
   * (queryExpansion.ts); 0 disables expansion. Default
   * DEFAULT_QUERY_EXPANSION_LIMIT. Exposed so "with expansion" and "without"
   * can be measured against each other.
   */
  expansionLimit?: number;
  lexicalLimit?: number;
  trigramLimit?: number;
  denseLimit?: number;
  /** Max non-pinned hits in the final list (pinned are never displaced). */
  resultLimit?: number;
  rrfK?: number;
  /** Minimum pg_trgm word_similarity for the trigram lane (default 0.5). */
  trigramMinSimilarity?: number;
  /**
   * FALLBACK GATE for the trigram lane (W14 F-PERF, V-1): the lane runs only
   * when the exact and lexical lanes together produced FEWER than this many
   * distinct passages. See DEFAULT_TRIGRAM_FALLBACK_MIN_HITS. 0 turns the gate
   * off, i.e. the lane always runs (the pre-W14 behaviour).
   */
  trigramFallbackMinHits?: number;
  /**
   * Per-lane wall budget in milliseconds for the trigram lane; see
   * chunkStore's DEFAULT_TRIGRAM_BUDGET_MS. 0 leaves the connection's own
   * statement_timeout as the only bound.
   */
  trigramBudgetMs?: number;
  /**
   * Source diversity: max chunks per document among the NON-PINNED hits.
   * Pinned hits are exempt — an explicit citation ("5237 sayılı Kanun") must
   * not be silently truncated to three articles — but they DO consume the
   * budget, so a document with 3 pinned chunks contributes no fused ones.
   */
  perDocumentCap?: number;
  /** Text-search config for the lexical lane ("turkish" default). */
  lexicalConfig?: string;
  /** Lexical query construction; "coverage" (default) or "strict". */
  lexicalMode?: LexicalQueryMode;
  /** Coverage floor for the lexical lane; see DEFAULT_LEXICAL_MIN_COVERAGE. */
  lexicalMinCoverage?: number;
  /**
   * Coverage floor for the divergence-completion pass. Lower than the primary
   * floor on purpose: an opposing decision argues the other way and therefore
   * shares FEWER of the question's words than a decision that agrees with it.
   * The pass is safe at this floor because it also requires a classifiable
   * opposing outcome and only runs once the primary lanes already found
   * judicial authority.
   */
  contraryMinCoverage?: number;
  /** Max hits admitted by the divergence-completion pass. 0 disables it. */
  contraryLimit?: number;
  /** How many top hits are re-parsed for outbound citations. 0 disables. */
  citationSeedCount?: number;
  /** Max hits admitted by citation expansion. 0 disables it. */
  citationExpansionLimit?: number;
  /** How many top hits seed the citator (relation) lane. 0 disables it. */
  relationSeedCount?: number;
  /** Max hits admitted by the citator lane. 0 disables it. */
  relationLimit?: number;
}

export interface ResolvedSearchLimits {
  laneWeights: LaneWeights;
  expansionLimit: number;
  lexicalLimit: number;
  trigramLimit: number;
  denseLimit: number;
  resultLimit: number;
  rrfK: number;
  trigramMinSimilarity: number;
  trigramFallbackMinHits: number;
  trigramBudgetMs: number;
  perDocumentCap: number;
  lexicalConfig: string;
  lexicalMode: LexicalQueryMode;
  lexicalMinCoverage: number;
  contraryMinCoverage: number;
  contraryLimit: number;
  citationSeedCount: number;
  citationExpansionLimit: number;
  relationSeedCount: number;
  relationLimit: number;
}

export const DEFAULT_SEARCH_LIMITS: ResolvedSearchLimits = {
  laneWeights: DEFAULT_LANE_WEIGHTS,
  expansionLimit: DEFAULT_QUERY_EXPANSION_LIMIT,
  lexicalLimit: 50,
  trigramLimit: 50,
  denseLimit: 50,
  resultLimit: 20,
  rrfK: DEFAULT_RRF_K,
  // word_similarity cutoff — see chunkStore D3. Measured separation on the
  // fixture corpus: real phrase hits 0.59-1.00, incidental overlap 0.30-0.43.
  trigramMinSimilarity: 0.5,
  trigramFallbackMinHits: DEFAULT_TRIGRAM_FALLBACK_MIN_HITS,
  trigramBudgetMs: DEFAULT_TRIGRAM_BUDGET_MS,
  perDocumentCap: 3,
  lexicalConfig: "turkish",
  lexicalMode: "coverage",
  lexicalMinCoverage: DEFAULT_LEXICAL_MIN_COVERAGE,
  contraryMinCoverage: 0.1,
  contraryLimit: 6,
  citationSeedCount: 5,
  citationExpansionLimit: 6,
  relationSeedCount: 10,
  relationLimit: 6,
};

export interface SearchPipelineOptions {
  /** ISO date (YYYY-MM-DD); defaults to today (UTC). */
  asOf?: string;
  filters?: StoreSearchFilters;
  limits?: SearchLimits;
  denseLane?: DenseLane;
}

export interface LaneFailure {
  lane: LaneName;
  message: string;
  /**
   * Additive (W12): the driver/SQLSTATE code of the failure when the error
   * carried one (ECONNREFUSED, CONNECT_TIMEOUT, 3D000, 57P03, ...). The
   * search service uses it to type connection-class failures as
   * CORPUS_UNAVAILABLE instead of echoing driver prose.
   */
  code?: string;
}

export interface SearchPipelineResult {
  hits: RankedHit[];
  normalizedQuery: string;
  /**
   * The query the RANKED lanes actually ran, i.e. normalizedQuery with every
   * resolved legislation reference rewritten to its number
   * (canonicalizeReferences). Reported so "why did these two spellings of the
   * same citation behave identically?" has a visible answer.
   */
  laneQuery: string;
  references: ParsedReference[];
  /** Lanes that were attempted for this query (exact only when refs exist). */
  lanesAttempted: LaneName[];
  /** Contained per-lane failures (empty when everything succeeded). */
  laneFailures: LaneFailure[];
  /**
   * Normalizer drift, one message per distinct legal.chunks.normalizer_version
   * seen among the hits that is NOT the version this control-plane normalized
   * the query with. Those rows' search_text was produced by different rules,
   * so their lexical/trigram recall is unspecified. They are still returned —
   * dropping them would be silent recall loss in the other direction — but
   * the caller is told (migration 20260826030000, P3).
   */
  normalizerWarnings: string[];
  asOf: string;
  /**
   * NORM_CONTENT vs APPLICATION (questionIntent.ts). Reported because it is
   * the switch that decides whether the divergence-completion pass runs at
   * all, and a narrowing that is not visible is a narrowing nobody can audit.
   */
  questionIntent: QuestionIntent;
  /**
   * Why the divergence-completion pass did or did not contribute. Never
   * silent: "found nothing" and "was never run" are different answers and a
   * reader must be able to tell them apart (brief 10.3).
   */
  divergence: DivergenceReport;
  /**
   * Why the citator (relation) lane did or did not contribute. Same rule as
   * the divergence report: "found nothing" and "was never run" are different
   * answers and a reader must be able to tell them apart.
   */
  citator: CitatorReport;
  /**
   * Why the trigram fallback lane did or did not contribute (W14 F-PERF).
   * Additive, and the SAME rule again: the lane is now gated, and a gate
   * nobody can see is a silent recall change. `SKIPPED_PRIMARY_SUFFICIENT`
   * and `EXECUTED_NONE_FOUND` are different answers.
   */
  trigram: TrigramReport;
  /**
   * What the dense (semantic) lane did. Same honesty rule as the reports
   * above, with one extra number that matters more than the rest:
   * `denseOnly` is how many passages semantic retrieval contributed that no
   * lexical lane found. A dense lane whose `denseOnly` is always 0 is
   * re-ranking, not retrieving, and this is where that shows.
   */
  dense: DenseReport;
  /**
   * Additive (2026-09-10): which synonym terms the corpus lane searched next
   * to the reader's words, and from which concept rows. Empty `terms` means
   * nothing was added — either no concept fired or expansion was disabled
   * (`limit` says which). The console can render it as
   * "şu eş anlamlılar da arandı: …".
   */
  expansion: QueryExpansion;
  /** Additive: the per-lane RRF multipliers this search fused with. */
  laneWeights: LaneWeights;
}

export type TrigramOutcome =
  /** Skipped by configuration (trigramLimit = 0). */
  | "DISABLED"
  /** Skipped: exact + lexical already produced `fallbackMinHits` passages. */
  | "SKIPPED_PRIMARY_SUFFICIENT"
  /** Ran; matched nothing above the similarity cutoff. */
  | "EXECUTED_NONE_FOUND"
  /** Ran; passages found and fused. */
  | "EXECUTED_FOUND"
  /** Ran and was cut by its own wall budget; recorded as a lane failure too. */
  | "BUDGET_EXCEEDED"
  /** Ran and failed inside the store; recorded as a lane failure too. */
  | "FAILED";

export interface TrigramReport {
  outcome: TrigramOutcome;
  /** Distinct passages exact + lexical produced, i.e. what the gate read. */
  primaryHits: number;
  /** The gate's threshold for this query (0 = gate off, lane always runs). */
  fallbackMinHits: number;
  /** Passages the lane returned. */
  admitted: number;
  /** Wall budget the lane was given, in ms (0 = no lane budget). */
  budgetMs: number;
}

export type CitatorOutcome =
  /** Skipped by configuration (relationLimit or relationSeedCount = 0). */
  | "DISABLED"
  /** Skipped: nothing was retrieved, so there is no document to follow from. */
  | "SKIPPED_NO_PRIMARY_HITS"
  /** Skipped: file scope (uploaded documents carry no amendment edges). */
  | "SKIPPED_FILE_SCOPE"
  /** Ran; no resolved amendment edge touches anything retrieved. */
  | "EXECUTED_NONE_FOUND"
  /** Ran; edges found and their passages added. */
  | "EXECUTED_FOUND"
  /** Ran and failed inside the store; recorded as a lane failure too. */
  | "FAILED";

export interface CitatorReport {
  outcome: CitatorOutcome;
  /** Distinct documents whose edges were looked up. */
  seedDocuments: number;
  /** Relation kinds followed. */
  kinds: string[];
  /** Passages admitted by the lane. */
  admitted: number;
}

export type DivergenceOutcome =
  /** Skipped: the question asks what a provision SAYS. */
  | "SKIPPED_NORM_CONTENT"
  /** Skipped: nothing was retrieved, so there is no position to oppose. */
  | "SKIPPED_NO_PRIMARY_HITS"
  /** Skipped: the primary hits contain no judicial passage with an outcome. */
  | "SKIPPED_NO_CLASSIFIED_AUTHORITY"
  /** Skipped by configuration (contraryLimit = 0). */
  | "DISABLED"
  /** Ran; no opposing authority found in the corpus. */
  | "EXECUTED_NONE_FOUND"
  /** Ran; opposing authority found and added. */
  | "EXECUTED_FOUND"
  /** Ran and failed inside the store; recorded as a lane failure too. */
  | "FAILED";

export interface DivergenceReport {
  outcome: DivergenceOutcome;
  /** Outcome polarities observed among the primary judicial passages. */
  primaryPolarities: OutcomePolarity[];
  /** Hits admitted by the pass. */
  admitted: number;
}

// --------------------------------------------------------------------------
// Pipeline
// --------------------------------------------------------------------------

/**
 * Steps 1-2b of the pipeline as one function: Turkish search-side
 * normalization, the exact reference parse, and the citation
 * canonicalization every RANKED lane (lexical, trigram, dense) searches with.
 * Exported so the embedding evaluation embeds exactly the query form the
 * dense lane embeds (denseLaneQueryText): one definition, not two copies.
 */
export function rankedLaneQuery(query: string): {
  readonly normalizedQuery: string;
  readonly references: ParsedReference[];
  readonly laneQuery: string;
} {
  // 1. Turkish search-side normalization (canonical text is never touched).
  const normalizedQuery = normalizeTurkishSearch(query);

  // 2. Exact reference parse (deterministic, never throws).
  const references = parseReferences(normalizedQuery);

  // 2b. Citation canonicalization for the RANKED lanes. See
  //     canonicalizeReferences below for why the ranked lanes must not see the
  //     citation the way the reader happened to spell it.
  const laneQuery = canonicalizeReferences(normalizedQuery, references);
  return { normalizedQuery, references, laneQuery };
}

/**
 * The text the dense lane embeds for `query` (before the model's prompt-style
 * prefix): lower-cased, punctuation-unified, citations reduced to the
 * legislation number. searchPipeline hands exactly this to denseLane.search.
 */
export function denseLaneQueryText(query: string): string {
  return rankedLaneQuery(query).laneQuery;
}

export async function searchPipeline(
  sql: Sql,
  query: string,
  options: SearchPipelineOptions = {},
): Promise<SearchPipelineResult> {
  const asOf = options.asOf ?? todayIsoDate();
  const { laneWeights: requestedWeights, ...flatLimits } = options.limits ?? {};
  const laneWeights: LaneWeights = {
    ...DEFAULT_LANE_WEIGHTS,
    ...stripUndefined(requestedWeights ?? {}),
  };
  assertLaneWeight(laneWeights.lexical, "lexical");
  assertLaneWeight(laneWeights.trigram, "trigram");
  assertLaneWeight(laneWeights.dense, "dense");
  const limits: ResolvedSearchLimits = {
    ...DEFAULT_SEARCH_LIMITS,
    ...stripUndefined(flatLimits),
    laneWeights,
  };
  const filters = options.filters;
  const denseLane = options.denseLane ?? new NoopDenseLane();

  // 1-2b. Normalization, exact reference parse and citation canonicalization
  //       (rankedLaneQuery). The dense lane embeds `laneQuery`; the embedding
  //       evaluation embeds the same string through denseLaneQueryText.
  const { normalizedQuery, references, laneQuery } = rankedLaneQuery(query);

  // 2c. Query expansion for the corpus lane (queryExpansion.ts): synonym
  //     terms from the planner's concept table, searched as discounted
  //     OR-alternatives next to the reader's words. Reported in the result;
  //     never able to admit a passage on its own (see the lexical lane).
  const expansionLimit = Math.max(0, Math.trunc(limits.expansionLimit));
  const expansion: QueryExpansion =
    expansionLimit > 0 && limits.lexicalMode !== "strict"
      ? expandQuery(laneQuery, { limit: expansionLimit })
      : emptyExpansion(expansionLimit, DEFAULT_EXPANSION_TERM_WEIGHT);

  const lanesAttempted: LaneName[] = [];
  const laneFailures: LaneFailure[] = [];

  // 3. Exact-pin lane (only when the query actually contains references).
  let pinnedRows: PinnedChunk[] = [];
  if (references.length > 0) {
    lanesAttempted.push("exact");
    try {
      pinnedRows = await exactPinLookup(sql, references, {
        asOf,
        limit: limits.resultLimit,
        ...(filters !== undefined ? { filters } : {}),
      });
    } catch (error) {
      laneFailures.push(laneFailure("exact", error));
    }
  }

  // 4. Lexical (turkish FTS) lane.
  lanesAttempted.push("lexical");
  let lexicalRows: ScoredChunk[] = [];
  try {
    lexicalRows = await lexicalSearch(sql, laneQuery, {
      asOf,
      limit: limits.lexicalLimit,
      config: limits.lexicalConfig,
      mode: limits.lexicalMode,
      minCoverage: limits.lexicalMinCoverage,
      ...(expansion.terms.length > 0
        ? { expansionTerms: expansion.terms, expansionWeight: expansion.weight }
        : {}),
      ...(filters !== undefined ? { filters } : {}),
    });
  } catch (error) {
    laneFailures.push(laneFailure("lexical", error));
  }

  // 5. Trigram FALLBACK lane — see DEFAULT_TRIGRAM_FALLBACK_MIN_HITS.
  //
  // The gate reads the DISTINCT passages the exact and lexical lanes produced,
  // not the sum of their row counts: the two lanes overlap heavily (on the
  // fixture corpus a pinned article is usually also the top lexical hit), and
  // counting an overlap twice would close the gate on a query that actually
  // found one passage.
  const primaryIds = new Set<string>();
  for (const row of pinnedRows) primaryIds.add(row.provenance.chunkId);
  for (const row of lexicalRows) primaryIds.add(row.provenance.chunkId);
  const primaryHits = primaryIds.size;
  const fallbackMinHits = Math.max(0, Math.trunc(limits.trigramFallbackMinHits));
  const trigramGateOpen =
    limits.trigramLimit > 0 &&
    (fallbackMinHits === 0 || primaryHits < fallbackMinHits);

  let trigramRows: ScoredChunk[] = [];
  const trigram: TrigramReport = {
    outcome:
      limits.trigramLimit <= 0
        ? "DISABLED"
        : trigramGateOpen
          ? "EXECUTED_NONE_FOUND"
          : "SKIPPED_PRIMARY_SUFFICIENT",
    primaryHits,
    fallbackMinHits,
    admitted: 0,
    budgetMs: Math.max(0, Math.trunc(limits.trigramBudgetMs)),
  };
  if (trigramGateOpen) {
    lanesAttempted.push("trigram");
    try {
      trigramRows = await trigramSearch(sql, laneQuery, {
        asOf,
        limit: limits.trigramLimit,
        minSimilarity: limits.trigramMinSimilarity,
        budgetMs: trigram.budgetMs,
        ...(filters !== undefined ? { filters } : {}),
      });
      trigram.admitted = trigramRows.length;
      trigram.outcome = trigramRows.length > 0 ? "EXECUTED_FOUND" : "EXECUTED_NONE_FOUND";
    } catch (error) {
      // A budget cut is still a lane failure — the answer must carry
      // RETRIEVAL_LANE_DEGRADED — but the report says WHICH kind it was.
      trigram.outcome =
        error instanceof TrigramBudgetExceededError ? "BUDGET_EXCEEDED" : "FAILED";
      laneFailures.push(laneFailure("trigram", error));
    }
  }

  // 6. Dense lane. Attempted only when a real lane is wired: reporting a
  //    noop as "attempted" made every result claim semantic search had run.
  let denseIds: string[] = [];
  // A lane that does not declare `state` is treated as ACTIVE, not DISABLED.
  // Defaulting to DISABLED meant a real lane written against the older
  // interface would silently never be called — a retrieval regression that
  // looks exactly like "semantic search found nothing". NoopDenseLane
  // declares DISABLED explicitly, which is the only way to opt out.
  let denseState: DenseLaneState = denseLane.state ?? "ACTIVE";
  const denseWired = denseState !== "DISABLED";
  if (denseWired) {
    lanesAttempted.push("dense");
    try {
      // Deduplicated on arrival: the index is untrusted input, and a
      // repeated id would otherwise be scored twice in the fusion and
      // counted twice in the report.
      const raw = await denseLane.search(laneQuery, {
        asOf,
        limit: limits.denseLimit,
        filters,
      });
      denseIds = [...new Set(raw.filter((id) => typeof id === "string" && id !== ""))];
      // W20: a real lane updates its own state DURING the call (an
      // embedder outage degrades it without throwing); report what it
      // says now, not what it said before the query.
      if (denseLane.state !== undefined) denseState = denseLane.state;
    } catch (error) {
      denseState = "FAILED";
      laneFailures.push(laneFailure("dense", error));
    }
  }

  // 7. RRF fusion: rrf.ts fuses the two ranked SQL lanes with their lane
  //    weights (DEFAULT_LANE_WEIGHTS); dense contributions are folded in with
  //    the identical w/(k+rank) term so a future non-noop dense lane
  //    participates without changing the fusion semantics.
  const lexicalIds = lexicalRows.map((r) => r.provenance.chunkId);
  const trigramIds = trigramRows.map((r) => r.provenance.chunkId);
  const fused = reciprocalRankFusion(lexicalIds, trigramIds, limits.rrfK, {
    lexical: limits.laneWeights.lexical,
    semantic: limits.laneWeights.trigram,
  });
  const fusedScores = new Map<string, number>(
    fused.map((f) => [f.id, f.score]),
  );
  denseIds.forEach((id, index) => {
    fusedScores.set(
      id,
      (fusedScores.get(id) ?? 0) + limits.laneWeights.dense / (limits.rrfK + index + 1),
    );
  });

  // Per-chunk lane provenance + provenance rows.
  const laneInfo = new Map<string, LaneProvenance[]>();
  const provenanceById = new Map<string, ChunkProvenance>();
  lexicalRows.forEach((row, index) => {
    pushLane(laneInfo, row.provenance.chunkId, {
      lane: "lexical",
      rank: index + 1,
      score: row.score,
    });
    provenanceById.set(row.provenance.chunkId, row.provenance);
  });
  trigramRows.forEach((row, index) => {
    pushLane(laneInfo, row.provenance.chunkId, {
      lane: "trigram",
      rank: index + 1,
      score: row.score,
    });
    provenanceById.set(row.provenance.chunkId, row.provenance);
  });
  denseIds.forEach((id, index) => {
    pushLane(laneInfo, id, {
      lane: "dense",
      rank: index + 1,
      score: limits.laneWeights.dense / (limits.rrfK + index + 1),
    });
  });

  // 7b. HYDRATE DENSE-ONLY CANDIDATES (W19 phase D).
  //
  // Every other lane returns rows, so its provenance is already in
  // `provenanceById`. The dense lane returns only ids — a vector index knows
  // which vectors are near the query, not which document they belong to.
  // Without this step a chunk that ONLY the dense lane found was scored,
  // ranked, given lane provenance, and then dropped at assembly for want of
  // a provenance row: semantic retrieval could never contribute a passage
  // the lexical lanes had missed, which is the only thing it is for.
  //
  // The hydration query re-applies the database's own visibility filter, so
  // a stale or out-of-scope index entry yields no row and simply never
  // becomes a hit. A failure here is contained like any lane failure: the
  // dense contribution is lost, the answer is not.
  const denseOnlyIds = denseIds.filter((id) => !provenanceById.has(id));
  let denseHydrated = 0;
  if (denseOnlyIds.length > 0) {
    try {
      const rows = await chunkProvenanceByIds(sql, denseOnlyIds, {
        asOf,
        filters,
      });
      for (const provenance of rows) {
        provenanceById.set(provenance.chunkId, provenance);
      }
      denseHydrated = rows.length;
    } catch (error) {
      denseState = "DEGRADED";
      laneFailures.push(laneFailure("dense", error));
    }
  }
  const denseReport: DenseReport = {
    lane: denseLane.name,
    state: denseState,
    returned: denseIds.length,
    hydrated: denseIds.length - denseOnlyIds.length + denseHydrated,
    denseOnly: denseHydrated,
  };

  // 8. Assembly: pinned hits first (never displaced), then fused hits in
  //    RRF order, deduped by document with the diversity cap.
  const hits: RankedHit[] = [];
  const perDocumentCount = new Map<string, number>();
  const pinnedIds = new Set<string>();

  pinnedRows.forEach((pin, index) => {
    const id = pin.provenance.chunkId;
    pinnedIds.add(id);
    const lanes: LaneProvenance[] = [
      { lane: "exact", rank: index + 1, score: 1 },
      ...(laneInfo.get(id) ?? []),
    ];
    hits.push({
      chunkId: id,
      documentId: pin.provenance.documentId,
      documentVersionId: pin.provenance.documentVersionId,
      pinned: true,
      pinReason: pin.pinReason,
      fusedScore: fusedScores.get(id) ?? 0,
      lanes,
      provenance: pin.provenance,
    });
    bump(perDocumentCount, pin.provenance.documentId);
  });

  // Fused ordering. Ties are broken on STABLE corpus identity, not on the
  // chunk's UUID: the uuid is minted at ingest, so a uuid tie-break made the
  // ranking — and, through the per-document cap and the result limit, the
  // result SET — differ between two ingests of the same corpus. See
  // chunkStore's stableTieBreak for the measurement that found this.
  const fusedOrdered = [...fusedScores.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      compare(stableKey(provenanceById, a[0]), stableKey(provenanceById, b[0])),
  );

  let nonPinnedCount = 0;
  for (const [id, score] of fusedOrdered) {
    if (pinnedIds.has(id)) continue; // already present, exact lane wins
    if (nonPinnedCount >= limits.resultLimit) break;
    const provenance = provenanceById.get(id);
    // Dense-only ids have no provenance row loaded; until the dense lane is
    // real (pgvector) there is nothing to fetch here, so skip defensively.
    if (provenance === undefined) continue;
    const documentCount = perDocumentCount.get(provenance.documentId) ?? 0;
    if (documentCount >= limits.perDocumentCap) continue; // diversity cap
    hits.push({
      chunkId: id,
      documentId: provenance.documentId,
      documentVersionId: provenance.documentVersionId,
      pinned: false,
      fusedScore: score,
      lanes: laneInfo.get(id) ?? [],
      provenance,
    });
    bump(perDocumentCount, provenance.documentId);
    nonPinnedCount += 1;
  }

  let present = new Set(hits.map((hit) => hit.chunkId));
  let ranked = hits;

  // 9. Citation expansion (one hop, outbound). Seeded from the hits that are
  //    already ranked, so a question the corpus cannot answer produces no
  //    seeds and therefore no expansion.
  //
  //    Each resolved provision is placed IMMEDIATELY AFTER the passage that
  //    cited it, not appended to the tail. A decision and the article it
  //    applies, or an amending provision and the text it rewrites, are one
  //    unit of reading; splitting them across twelve ranks is how the amended
  //    text ended up outside every top-10 measurement. The primary ranking is
  //    otherwise untouched — nothing is reordered, only interleaved.
  if (limits.citationSeedCount > 0 && limits.citationExpansionLimit > 0) {
    lanesAttempted.push("citation");
    try {
      const expanded = await expandCitations(sql, ranked, present, {
        asOf,
        seedCount: limits.citationSeedCount,
        limit: limits.citationExpansionLimit,
        ...(filters !== undefined ? { filters } : {}),
      });
      if (expanded.size > 0) {
        const merged: RankedHit[] = [];
        for (const hit of ranked) {
          merged.push(hit);
          for (const extra of expanded.get(hit.chunkId) ?? []) {
            merged.push(extra);
            present.add(extra.chunkId);
            bump(perDocumentCount, extra.documentId);
          }
        }
        ranked = merged;
      }
    } catch (error) {
      // Contained exactly like a lane failure: expansion is an enrichment,
      // and losing it must never lose the primary results.
      laneFailures.push(laneFailure("citation", error));
    }
  }
  present = new Set(ranked.map((hit) => hit.chunkId));

  // 9b. Citator lane (inbound + outbound amendment relations).
  //
  //     APPENDED, never interleaved. Every passage the primary lanes ranked
  //     keeps the rank it earned, so this lane can only ADD recall — it can
  //     never push an expected passage out of a top-k window. That is a
  //     deliberate difference from citation expansion: expansion resolves a
  //     citation the SEED TEXT makes, so the two belong together in reading
  //     order, while a citator edge is an answer to a different question
  //     ("what changed this?") and earns its place at the end of the list.
  lanesAttempted.push("relation");
  const citator = await runCitatorLane(sql, ranked, present, {
    asOf,
    seedCount: limits.relationSeedCount,
    limit: limits.relationLimit,
    ...(filters !== undefined ? { filters } : {}),
  });
  if (citator.failure !== undefined) {
    laneFailures.push({ lane: "relation", message: citator.failure });
  }
  for (const hit of citator.hits) {
    ranked.push(hit);
    present.add(hit.chunkId);
  }

  // 10. Divergence completion (contrary-authority branch, brief 10.2).
  const intent = classifyQuestionIntent(normalizedQuery, references);
  const divergence = await completeDivergence(sql, laneQuery, ranked, present, {
    asOf,
    intent: intent.intent,
    limit: limits.contraryLimit,
    minCoverage: limits.contraryMinCoverage,
    config: limits.lexicalConfig,
    lexicalLimit: limits.lexicalLimit,
    ...(filters !== undefined ? { filters } : {}),
  });
  if (divergence.failure !== undefined) {
    laneFailures.push({ lane: "lexical", message: divergence.failure });
  }
  for (const hit of divergence.hits) {
    ranked.push(hit);
    present.add(hit.chunkId);
  }

  return {
    hits: ranked,
    normalizedQuery,
    laneQuery,
    references,
    lanesAttempted,
    laneFailures,
    normalizerWarnings: normalizerDrift(ranked),
    asOf,
    questionIntent: intent.intent,
    divergence: divergence.report,
    citator: citator.report,
    trigram,
    dense: denseReport,
    expansion,
    laneWeights: limits.laneWeights,
  };
}

// --------------------------------------------------------------------------
// Citator lane (stored amendment relations)
// --------------------------------------------------------------------------

interface CitatorLaneOptions {
  asOf: string;
  seedCount: number;
  limit: number;
  filters?: StoreSearchFilters;
}

interface CitatorLaneResult {
  hits: RankedHit[];
  report: CitatorReport;
  failure?: string;
}

/**
 * Reach the instruments that amend a retrieved provision — and the provisions
 * a retrieved instrument amends.
 *
 * This is the lane that closes the one gap the lexical machinery structurally
 * cannot. An amending provision and the text it amends share almost no
 * vocabulary: "…157 nci maddesinin birinci fıkrasında yer alan '…' ibaresi
 * '…' şeklinde değiştirilmiştir" names neither the subject matter of the
 * article nor the words a reader would use to ask about it, so no amount of
 * stemming, coverage tuning or fuzzy matching connects them. The connection
 * is not in the text; it is an EDGE, written at ingest by
 * ingestion/relations.py from the instrument's own amendment structure and
 * resolved against a real target document.
 *
 * WHAT KEEPS IT HONEST:
 *  - it is seeded ONLY from passages the primary lanes already ranked, so a
 *    question the corpus cannot answer produces no seeds and therefore no
 *    hits — the abstention guarantee is unchanged by construction;
 *  - it follows only edges whose `resolution_status` is 'resolved'; an
 *    ambiguous target is one nobody confirmed, and a citator that cited it
 *    would be inventing an authority chain;
 *  - both ends of an edge come back as REAL passages under the ordinary
 *    as-of visibility filter, so an instrument that is not yet in force on
 *    the question's date does not appear at all;
 *  - every admitted hit carries the edge that produced it (relation id,
 *    direction, resolver version and confidence), so "why is this here?" has
 *    a stored answer.
 */
async function runCitatorLane(
  sql: Sql,
  hits: readonly RankedHit[],
  present: ReadonlySet<string>,
  options: CitatorLaneOptions,
): Promise<CitatorLaneResult> {
  const kinds = [...DEFAULT_CITATOR_KINDS];
  const empty = (outcome: CitatorOutcome, seedDocuments = 0) => ({
    hits: [] as RankedHit[],
    report: { outcome, seedDocuments, kinds, admitted: 0 },
  });

  if (options.limit <= 0 || options.seedCount <= 0) return empty("DISABLED");
  // File scope: an uploaded document has no amendment edges, and following
  // edges OUT of the public corpus would re-admit corpus passages the caller
  // explicitly scoped out.
  if (isFileScope(options.filters)) return empty("SKIPPED_FILE_SCOPE");
  if (hits.length === 0) return empty("SKIPPED_NO_PRIMARY_HITS");

  const seeds = hits.slice(0, options.seedCount);
  const documentIds = [...new Set(seeds.map((hit) => hit.documentId))];
  const chunkIds = [...new Set(seeds.map((hit) => hit.chunkId))];
  // First ranked passage per seed identity — the "you asked about this" anchor
  // an admitted hit names. Inbound edges are seeded by document, outbound ones
  // by the exact chunk.
  const viaBySeed = new Map<string, string>();
  for (const hit of seeds) {
    if (!viaBySeed.has(hit.documentId)) viaBySeed.set(hit.documentId, hit.chunkId);
    if (!viaBySeed.has(hit.chunkId)) viaBySeed.set(hit.chunkId, hit.chunkId);
  }

  let found: CitatorHit[];
  try {
    found = await citatorLookup(sql, {
      asOf: options.asOf,
      limit: options.limit,
      documentIds,
      chunkIds,
      kinds,
      ...(options.filters !== undefined ? { filters: options.filters } : {}),
    });
  } catch (error) {
    return {
      ...empty("FAILED", documentIds.length),
      failure: `citator lane failed: ${errorMessage(error)}`,
    };
  }

  const out: RankedHit[] = [];
  const admitted = new Set<string>();
  for (const hit of found) {
    if (out.length >= options.limit) break;
    const id = hit.provenance.chunkId;
    if (present.has(id) || admitted.has(id)) continue;
    admitted.add(id);
    const via = viaBySeed.get(hit.edge.seedId);
    out.push({
      chunkId: id,
      documentId: hit.provenance.documentId,
      documentVersionId: hit.provenance.documentVersionId,
      // Not pinned: a citator hit is an enrichment, and pinning would place
      // it ahead of the passages the reader's own words earned.
      pinned: false,
      fusedScore: 0,
      lanes: [{ lane: "relation", rank: out.length + 1, score: 1 }],
      provenance: hit.provenance,
      relation: {
        direction: hit.edge.direction,
        kind: hit.edge.kind,
        role: hit.role,
        relationId: hit.edge.relationId,
        resolutionStatus: hit.edge.resolutionStatus,
        confidence: hit.edge.confidence,
        resolverVersion: hit.edge.resolverVersion,
        viaChunkId: via ?? hit.edge.seedId,
        targetLegislationNo: hit.edge.targetLegislationNo,
        targetArticleNo: hit.edge.targetArticleNo,
      },
    });
  }

  return {
    hits: out,
    report: {
      outcome: out.length > 0 ? "EXECUTED_FOUND" : "EXECUTED_NONE_FOUND",
      seedDocuments: documentIds.length,
      kinds,
      admitted: out.length,
    },
  };
}

// --------------------------------------------------------------------------
// Citation canonicalization
// --------------------------------------------------------------------------

/**
 * Rewrite every RESOLVED legislation reference in the query to its
 * legislation number, leaving the rest of the text byte-identical.
 *
 *   "5237 sayılı türk ceza kanunu m. 157 uyarınca dolandırıcılık ..."
 *   "tck m. 157 uyarınca dolandırıcılık ..."
 *     -> both become "5237 m. 157 uyarınca dolandırıcılık ..."
 *
 * WHY. The exact-pin lane already resolves "TCK" and "5237 sayılı Türk Ceza
 * Kanunu" to the same statute; the ranked lanes did not, and the fixture-corpus
 * run measured the consequence — full-name-form accuracy 71.4% against
 * abbreviation-form 100%. Spelling the citation out adds four generic tokens
 * ("sayılı", "türk", "ceza", "kanunu") that occur all over a legal corpus:
 * they dilute the coverage of the words the question is actually about and
 * they pull in whatever else happens to say "ceza kanunu". The citation is a
 * LOCATOR, and it is handled by a lane built for locators.
 *
 * Rewriting to the number rather than deleting the span is deliberate: the
 * number is how Turkish legal texts cite each other ("5237 sayılı TCK'nın 157
 * nci maddesi"), so it stays a useful retrieval token, and it keeps the two
 * spellings of one citation from producing two different queries — the
 * abbreviation-form parity property, made structural instead of coincidental.
 *
 * KNOWN TRADEOFF: a passage that names a statute in words but never by number
 * loses this token. That is the right trade for a corpus whose canonical key
 * IS the number, and it should be re-measured on a real corpus.
 *
 * Only references carrying a resolved `legislationNo` and a span are
 * rewritten; overlapping spans are skipped so the rewrite is total and
 * order-independent. Exported for direct testing.
 */
export function canonicalizeReferences(
  normalizedQuery: string,
  references: readonly ParsedReference[],
): string {
  const spans = references
    .filter(
      (reference) =>
        reference.kind === "legislation" &&
        reference.legislationNo !== undefined &&
        reference.span !== undefined,
    )
    .sort((a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0));
  if (spans.length === 0) return normalizedQuery;

  let out = "";
  let cursor = 0;
  for (const reference of spans) {
    const [start, end] = reference.span as [number, number];
    if (start < cursor) continue; // overlapping match; first one wins
    out += normalizedQuery.slice(cursor, start) + (reference.legislationNo as string);
    cursor = end;
  }
  out += normalizedQuery.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

// --------------------------------------------------------------------------
// Citation expansion
// --------------------------------------------------------------------------

/** One outbound statutory citation resolved out of a passage's own text. */
export interface OutboundCitation {
  legislationNo: string;
  articleNo?: string;
}

/**
 * Outbound statutory citations of a passage, in reading order.
 *
 * A legislation reference is paired with the FIRST article reference that
 * follows it and precedes the next legislation reference — which is how a
 * Turkish citation is written ("5237 sayılı Türk Ceza Kanununun 157 nci
 * maddesinin birinci fıkrası"). Because the pairing only ever looks FORWARD,
 * a chunk that opens with its own "MADDE 1 -" heading cannot have that
 * heading mistaken for the cited article: the heading precedes every
 * legislation reference in the passage and is therefore never paired.
 *
 * Exported for direct testing — this rule is the whole correctness of the
 * expansion, and it should be pinned without a database.
 */
export function outboundCitations(passage: string): OutboundCitation[] {
  const references = [...parseReferences(normalizeTurkishSearch(passage))].sort(
    (a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0),
  );
  const out: OutboundCitation[] = [];
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index] as ParsedReference;
    if (reference.kind !== "legislation" || reference.legislationNo === undefined) {
      continue;
    }
    let articleNo: string | undefined;
    for (let next = index + 1; next < references.length; next += 1) {
      const candidate = references[next] as ParsedReference;
      if (candidate.kind === "legislation") break;
      if (candidate.kind === "article" && candidate.articleNo !== undefined) {
        articleNo = candidate.articleNo;
        break;
      }
    }
    out.push({
      legislationNo: reference.legislationNo,
      ...(articleNo !== undefined ? { articleNo } : {}),
    });
  }
  return out;
}

interface ExpandOptions {
  asOf: string;
  seedCount: number;
  limit: number;
  filters?: StoreSearchFilters;
}

/** An expanded provision inherits this fraction of its seed's fused score. */
export const CITATION_SCORE_FACTOR = 0.9;

/**
 * Resolve the outbound citations of the top hits through the ordinary pin
 * lookup, so the cited provision arrives in the version in force on the
 * QUESTION's as_of date. Self-citations (a law citing itself) are dropped —
 * they add nothing and would let a long statute crowd out its own results.
 *
 * Returns the resolved hits KEYED BY THE SEED that cited them, so the caller
 * can place each provision next to the passage it belongs to.
 */
async function expandCitations(
  sql: Sql,
  seeds: readonly RankedHit[],
  present: ReadonlySet<string>,
  options: ExpandOptions,
): Promise<Map<string, RankedHit[]>> {
  const bySeed = new Map<string, RankedHit[]>();
  const admitted = new Set<string>();
  let total = 0;
  for (const seed of seeds.slice(0, options.seedCount)) {
    if (total >= options.limit) break;
    for (const citation of outboundCitations(seed.provenance.originalText)) {
      if (total >= options.limit) break;
      if (citation.legislationNo === seed.provenance.legislationNo) continue;
      const references: ParsedReference[] = [
        { kind: "legislation", raw: citation.legislationNo, legislationNo: citation.legislationNo },
        ...(citation.articleNo !== undefined
          ? [
              {
                kind: "article" as const,
                raw: citation.articleNo,
                articleNo: citation.articleNo,
              },
            ]
          : []),
      ];
      const rows = await exactPinLookup(sql, references, {
        asOf: options.asOf,
        limit: options.limit,
        ...(options.filters !== undefined ? { filters: options.filters } : {}),
      });
      const label =
        citation.articleNo !== undefined
          ? `${citation.legislationNo} m.${citation.articleNo}`
          : citation.legislationNo;
      for (const row of rows) {
        if (total >= options.limit) break;
        const id = row.provenance.chunkId;
        if (present.has(id) || admitted.has(id)) continue;
        admitted.add(id);
        total += 1;
        const group = bySeed.get(seed.chunkId);
        // NOT pinned, and never above its seed: the provision was reached by
        // following the SEED's citation, so it inherits 0.9x the seed's fused
        // score and its own lane. A reader who wants this article first can
        // cite it — the exact lane will pin it (see the module header).
        const inherited = Math.max(0, seed.fusedScore) * CITATION_SCORE_FACTOR;
        const hit: RankedHit = {
          chunkId: id,
          documentId: row.provenance.documentId,
          documentVersionId: row.provenance.documentVersionId,
          pinned: false,
          fusedScore: inherited,
          lanes: [{ lane: "citation", rank: total, score: inherited }],
          provenance: row.provenance,
          citation: { citedByChunkId: seed.chunkId, reference: label },
        };
        if (group === undefined) bySeed.set(seed.chunkId, [hit]);
        else group.push(hit);
      }
    }
  }
  return bySeed;
}

// --------------------------------------------------------------------------
// Divergence completion (contrary-authority branch)
// --------------------------------------------------------------------------

interface DivergenceOptions {
  asOf: string;
  intent: QuestionIntent;
  limit: number;
  minCoverage: number;
  config: string;
  lexicalLimit: number;
  filters?: StoreSearchFilters;
}

interface DivergenceResult {
  hits: RankedHit[];
  report: DivergenceReport;
  failure?: string;
}

/** Outcome polarity of a hit, or undefined when it is not judicial authority. */
function judicialPolarity(hit: RankedHit): OutcomePolarity | undefined {
  if (isLegislativeDocumentType(hit.provenance.documentType)) return undefined;
  const stance = classifyStance(
    hit.provenance.documentType,
    hit.provenance.originalText,
  );
  return stance.polarity === "NEUTRAL" ? undefined : stance.polarity;
}

/**
 * Surface the authority that points the other way.
 *
 * Symmetric by design: it admits any judicial passage whose outcome differs
 * from the outcome of a passage ALREADY retrieved, rather than picking one
 * "primary" side and hunting for its opposite. Which of two disagreeing
 * decisions happens to rank higher is an artifact of wording; whether the
 * split gets reported to the reader must not be.
 */
async function completeDivergence(
  sql: Sql,
  normalizedQuery: string,
  hits: readonly RankedHit[],
  present: ReadonlySet<string>,
  options: DivergenceOptions,
): Promise<DivergenceResult> {
  const empty = (outcome: DivergenceOutcome, polarities: OutcomePolarity[] = []) => ({
    hits: [] as RankedHit[],
    report: { outcome, primaryPolarities: polarities, admitted: 0 },
  });

  if (options.limit <= 0) return empty("DISABLED");
  if (options.intent === "NORM_CONTENT") return empty("SKIPPED_NORM_CONTENT");
  if (hits.length === 0) return empty("SKIPPED_NO_PRIMARY_HITS");

  // Polarity of each already-retrieved judicial passage, keyed by chunk id so
  // an admitted hit can name the exact passage it contradicts.
  const primary: { chunkId: string; polarity: OutcomePolarity }[] = [];
  for (const hit of hits) {
    const polarity = judicialPolarity(hit);
    if (polarity !== undefined) primary.push({ chunkId: hit.chunkId, polarity });
  }
  const polarities = [...new Set(primary.map((p) => p.polarity))].sort();
  if (primary.length === 0) {
    return empty("SKIPPED_NO_CLASSIFIED_AUTHORITY");
  }

  let candidates: ScoredChunk[];
  try {
    candidates = await lexicalSearch(sql, normalizedQuery, {
      asOf: options.asOf,
      limit: options.lexicalLimit,
      config: options.config,
      mode: "coverage",
      minCoverage: options.minCoverage,
      ...(options.filters !== undefined ? { filters: options.filters } : {}),
    });
  } catch (error) {
    return {
      ...empty("FAILED", polarities),
      failure: `divergence completion failed: ${errorMessage(error)}`,
    };
  }

  const out: RankedHit[] = [];
  for (const candidate of candidates) {
    if (out.length >= options.limit) break;
    const id = candidate.provenance.chunkId;
    if (present.has(id)) continue;
    if (isLegislativeDocumentType(candidate.provenance.documentType)) continue;
    const stance = classifyStance(
      candidate.provenance.documentType,
      candidate.provenance.originalText,
    );
    if (stance.polarity === "NEUTRAL") continue;
    const opposed = primary.find((p) => p.polarity !== stance.polarity);
    if (opposed === undefined) continue;
    out.push({
      chunkId: id,
      documentId: candidate.provenance.documentId,
      documentVersionId: candidate.provenance.documentVersionId,
      pinned: false,
      fusedScore: 0,
      lanes: [{ lane: "lexical", rank: out.length + 1, score: candidate.score }],
      provenance: candidate.provenance,
      contrary: {
        polarity: stance.polarity,
        markers: stance.markers,
        opposesChunkId: opposed.chunkId,
        opposesPolarity: opposed.polarity,
      },
    });
  }

  return {
    hits: out,
    report: {
      outcome: out.length > 0 ? "EXECUTED_FOUND" : "EXECUTED_NONE_FOUND",
      primaryPolarities: polarities,
      admitted: out.length,
    },
  };
}

/**
 * One warning per distinct foreign normalizer_version among the hits. Sorted
 * so the message set is deterministic for a given result set.
 */
function normalizerDrift(hits: readonly RankedHit[]): string[] {
  const foreign = new Set<string>();
  for (const hit of hits) {
    const version = hit.provenance.normalizerVersion;
    if (version !== QUERY_NORMALIZER_VERSION) foreign.add(version);
  }
  return [...foreign]
    .sort()
    .map(
      (version) =>
        `normalizer drift: chunks indexed with normalizer_version ` +
        `"${version}" were matched against a query normalized with ` +
        `"${QUERY_NORMALIZER_VERSION}"; recall for those rows is not ` +
        `guaranteed until they are reindexed`,
    );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function pushLane(
  map: Map<string, LaneProvenance[]>,
  id: string,
  entry: LaneProvenance,
): void {
  const existing = map.get(id);
  if (existing === undefined) {
    map.set(id, [entry]);
  } else {
    existing.push(entry);
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Field separator inside `stableKey`. U+0000 sorts below every character a
 * source or external id can carry, so ("a", "bc") and ("ab", "c") can never
 * collapse to the same key.
 *
 * Written as an escape, never as a raw NUL byte in this file (W14 L-FIX):
 * a literal 0x00 makes grep, most diff viewers and several editors treat the
 * whole source as binary, which is how it survived unnoticed since W3
 * (ARCH S11). `tests/test_repo_hygiene.py` now fails on any raw NUL here.
 */
const SEP = "\u0000";

/**
 * Ingest-stable sort key for a chunk id: (source, external_id, ordinal). The
 * ordinal is zero-padded so it compares numerically under a string compare.
 * Ids with no loaded provenance (dense-only, until pgvector exists) sort last
 * under a prefix no real source can produce.
 */
function stableKey(
  provenanceById: ReadonlyMap<string, ChunkProvenance>,
  chunkId: string,
): string {
  const provenance = provenanceById.get(chunkId);
  if (provenance === undefined) return `￿${chunkId}`;
  return [
    provenance.source,
    provenance.externalId,
    String(provenance.ordinal).padStart(9, "0"),
  ].join(SEP);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

/** A contained lane failure carrying the driver/SQLSTATE code when there is one. */
function laneFailure(lane: LaneName, error: unknown): LaneFailure {
  const code = corpusErrorCode(error);
  return { lane, message: errorMessage(error), ...(code !== undefined ? { code } : {}) };
}

/** Drop undefined entries so spreads never clobber defaults. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      (out as Record<string, unknown>)[key] = entry;
    }
  }
  return out;
}
