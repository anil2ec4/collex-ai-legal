/**
 * "Olayı anlat → ilgili kararlar" (W16, Şerit B).
 *
 * A litigator does not arrive with a query string; they arrive with an EVENT.
 * The competitors sell that as "benzer olay kurgularını ortaya çıkarır" — a
 * claim about meaning whose workings neither of them shows the lawyer. This
 * module is the honest version of the same job, and every step of it is a
 * number the lawyer can re-derive by hand:
 *
 *   1. The event text goes through the SAME concept engine the research
 *      planner uses (`planner/intake.ts :: analyzeIntake`). It is CALLED, never
 *      copied: one table, one ordering rule, one place to fix.
 *   2. From the issues it returns, up to {@link MAX_RELATED_QUERIES} DIFFERENT
 *      queries are built — exact-phrase, concept+statutory-anchor, synonym
 *      variants, and the citations the lawyer named. **Every generated query
 *      is returned to the caller**, including the ones the budget refused to
 *      run. "I searched these things on your behalf" is the transparency
 *      neither competitor offers.
 *   3. Each query runs over the selected official sources through the EXISTING
 *      `searchSources` service — no new MCP tool, no changed tool contract.
 *   4. Rows are deduplicated by DECISION IDENTITY (`sourceId` + `externalId`)
 *      and each surviving row records which queries found it.
 *   5. The list is ordered by MUTABAKAT — how many separate searches landed on
 *      the same decision — then merci weight, then decision date, then
 *      identity. Fully deterministic: same input, same order.
 *
 * ### What MUTABAKAT is and is not
 *
 * It is a count of AGREEING SEARCHES. It is **not** a relevance score, not a
 * percentage, not a confidence, and it is never rendered as one. The sentence
 * that says so ({@link RELATED_RANKING_DISCLAIMER}) travels with every
 * response and is pinned by a test. A decision found by four of our queries is
 * a decision four different phrasings of the event agree on; whether it fits
 * THIS file is a judgement only the lawyer makes.
 *
 * ### What a row is not
 *
 * A row here is a künye plus a snippet, exactly as `searchSources` produced it.
 * It carries no digest and no offsets, because **a search result is never
 * evidence** — `POST /v1/sources/fetch` is the only thing that produces a
 * citable, hash-sealed passage. A field the source did not publish is ABSENT,
 * never invented and never filled with a plausible-looking default.
 *
 * ### Budget
 *
 * A query fans out to one upstream call per selected source, so the cost is
 * queries × sources. Two ceilings bound it ({@link RELATED_MAX_UPSTREAM_CALLS},
 * {@link DEFAULT_RELATED_TIME_BUDGET_MS}); a query the budget refused is
 * REPORTED — it appears in `queries[]` with `calisti:false`, again in
 * `skippedQueries[]` with a typed reason, and once more as a note that says
 * how many did not run. Silent trimming is forbidden.
 */

import { randomUUID } from "node:crypto";
import type { ProviderGateway } from "../gateway/gateway.js";
import { analyzeIntake, type IntakeIssue } from "../planner/intake.js";
import {
  resolveEmbeddingConfig,
  type EmbeddingResolution,
} from "../retrieval/embeddingConfig.js";
import {
  createEmbeddingPort,
  DEFAULT_RERANK_DOCUMENTS,
  MAX_RERANK_DOCUMENTS,
  semanticRerank,
  type EmbeddingPort,
  type SemanticRerankReason,
  type SimilarityBand,
} from "../retrieval/semanticRerank.js";
import type { SourceDescriptor } from "./catalog.js";
import {
  DEFAULT_SOURCE_FETCH_TIMEOUT_MS,
  fetchSourceCard,
  UnknownFetchKindError,
} from "./fetchService.js";
import {
  lexemeMatches,
  MAX_SOURCE_SEARCH_LIMIT,
  resolveSources,
  searchSources,
  turkishLexemes,
  type SourceFailure,
  type SourceSearchRequest,
  type SourceSearchResult,
  type SourceSearchRow,
} from "./searchService.js";

// ---------------------------------------------------------------------------
// The one sentence that may never drift
// ---------------------------------------------------------------------------

/**
 * Printed on every response and on every screen that shows this list.
 *
 * It exists because the number next to a row (`mutabakat`) LOOKS like a score,
 * and the whole honesty contract of this project turns on the difference. The
 * text is a constant, it is returned twice (as `siralamaNotu` and as the first
 * `notes[]` entry, both read from HERE so they cannot diverge), and
 * `tests/sources/relatedSearch.test.ts` fails if a single character changes.
 */
export const RELATED_RANKING_DISCLAIMER =
  "Bu sıra, kararları kaç ayrı aramanın birden bulduğuna göre dizer." +
  " Bu bir İLGİLİLİK PUANI DEĞİLDİR; hangi kararın sizin olayınıza uyduğunu" +
  " yalnız siz belirlersiniz.";

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------

/** Hard ceiling on generated queries; `maxQueries` may only ask for FEWER. */
export const MAX_RELATED_QUERIES = 8;
/** Default when the caller names no `maxQueries`. */
export const DEFAULT_RELATED_QUERIES = 6;
/**
 * Total upstream calls one request may spend (queries × selected sources).
 * Same order of magnitude as the live research budget's 24-step clamp.
 */
export const RELATED_MAX_UPSTREAM_CALLS = 24;
/** Wall budget checked BETWEEN queries, never mid-call. */
export const DEFAULT_RELATED_TIME_BUDGET_MS = 45_000;
/** Rows asked of each source per query. */
export const DEFAULT_RELATED_PER_QUERY_LIMIT = 20;
/** Ceiling on the deduplicated result list; a cut list says so in `notes`. */
export const MAX_RELATED_RESULTS = 200;
/** Longest query string we will build out of the lawyer's own sentences. */
export const MAX_QUERY_TEXT_LENGTH = 200;
/**
 * Longest term we will send as an EXACT PHRASE.
 *
 * Every key of the concept table is a legal term of at most a handful of words.
 * Anything longer is a sentence, and quoting a sentence asks the archive for a
 * literal string no decision contains — a search that is guaranteed to answer
 * "nothing found" and to look like an absence of case law rather than a badly
 * built query. Above this, the same words go out unquoted.
 */
export const MAX_PHRASE_WORDS = 5;

// ---------------------------------------------------------------------------
// Merci weight
// ---------------------------------------------------------------------------

/**
 * Court weight for the ordering's SECOND key: high courts, then istinaf, then
 * everything else, then first instance.
 *
 * This is a table and not a heuristic on purpose — a reader can check it. It
 * is keyed by catalog source id, and `tests/sources/relatedSearch.test.ts`
 * asserts that EVERY `ictihat` source in `catalog.ts` has a row here, so a new
 * court lane cannot silently inherit the default and sort as though it were a
 * regulator.
 */
export const MERCI_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  yargitay: 0,
  danistay: 0,
  aym: 0,
  uyusmazlik: 0,
  kyb: 0,
  istinaf_hukuk: 1,
  emsal: 2,
  yerel_hukuk: 3,
});

/** Regulators and legislation sit between istinaf and first instance. */
export const DEFAULT_MERCI_WEIGHT = 2;

export function merciWeight(sourceId: string): number {
  return MERCI_WEIGHT[sourceId] ?? DEFAULT_MERCI_WEIGHT;
}

// ---------------------------------------------------------------------------
// Relevance model (W18) — a scored, EXPLAINABLE heuristic
// ---------------------------------------------------------------------------

/**
 * Marker carried by every response: the order is ColleX's OWN heuristic. It
 * is not the source's order, not a measured relevance, and the fixed
 * disclaimer ({@link RELATED_RANKING_DISCLAIMER}) still travels with it.
 */
export const RELATED_RANKING = "colleX-heuristic" as const;

/**
 * Weights of the five signals. They sum to 1 and they are CHOSEN, not
 * measured: no gold set has ever scored this ordering, which is why the
 * response says `ranking: "colleX-heuristic"` and a note says the same in
 * Turkish. Subject agreement leads because W17 measured that phrasing counts
 * reward common words; query agreement and lexeme overlap follow; the court
 * weight and the decision's age are deliberately small so that neither can,
 * on its own, beat two agreeing subjects.
 */
export const RELEVANCE_WEIGHTS = Object.freeze({
  subjectAgreement: 0.4,
  queryAgreement: 0.2,
  snippetOverlap: 0.25,
  merciWeight: 0.1,
  recency: 0.05,
});

/** Decimal places the score is rounded to BEFORE it orders anything. */
export const RELEVANCE_PRECISION = 4;

/**
 * Age BANDS (years) for the recency signal. Bands, not a linear age: W17
 * measured that a calendar must not reorder a tie group the source itself
 * ranked, and inside one band it cannot. Unknown date = 0, never guessed.
 */
export const RECENCY_BANDS: readonly { readonly maxAgeYears: number; readonly value: number }[] =
  Object.freeze([
    { maxAgeYears: 10, value: 1 },
    { maxAgeYears: 20, value: 0.5 },
  ]);
/** Older than the last band. */
export const RECENCY_OLDER_VALUE = 0.25;

export interface RelatedRelevanceSignals {
  /** `konuMutabakati` / distinct subjects among the queries that RAN. */
  subjectAgreement: number;
  /** `mutabakat` / queries that ran. */
  queryAgreement: number;
  /**
   * Share of the run queries' lexemes found in the row's title + snippet
   * after Turkish lowercasing (`searchService.ts :: turkishLexemes`). 0 when
   * the source published neither; a snippet is for the eye, never evidence.
   */
  snippetOverlap: number;
  /** 1 for the highest courts, falling with {@link MERCI_WEIGHT}. */
  merciWeight: number;
  /** Banded age of the decision ({@link RECENCY_BANDS}); 0 when unknown. */
  recency: number;
}

export interface RelatedRelevance {
  /**
   * Weighted sum of the signals in [0, 1], rounded to
   * {@link RELEVANCE_PRECISION} places. A HEURISTIC — not a verified
   * relevance, not a probability, and never rendered as a percentage.
   */
  score: number;
  signals: RelatedRelevanceSignals;
  /** The query lexemes actually found in the title/snippet — the overlap, shown. */
  matchedLexemes: readonly string[];
}

/** What the score needs from the whole run; the same for every row. */
export interface RelevanceContext {
  /** Distinct issue ids among the queries that ran; at least 1. */
  subjectCount: number;
  /** Queries that ran; at least 1. */
  queryCount: number;
  /** Union of the run queries' lexemes, in first-seen order. */
  queryLexemes: readonly string[];
  /** Year of `now()`, for the age bands. */
  currentYear: number;
}

const MAX_MERCI_WEIGHT = Math.max(...Object.values(MERCI_WEIGHT), DEFAULT_MERCI_WEIGHT);

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function recencySignal(siralamaTarihi: string, currentYear: number): number {
  if (siralamaTarihi === "") return 0;
  const year = Number.parseInt(siralamaTarihi.slice(0, 4), 10);
  if (!Number.isFinite(year)) return 0;
  const age = Math.max(0, currentYear - year);
  for (const band of RECENCY_BANDS) if (age <= band.maxAgeYears) return band.value;
  return RECENCY_OLDER_VALUE;
}

/**
 * The score of ONE row. Every input is a property of the data or of the run
 * (which queries ran, what they contained), never of the process: same rows,
 * same context, same score, on any machine.
 */
export function computeRelevance(
  row: Pick<RelatedResultRow, "konuMutabakati" | "mutabakat" | "merciAgirligi" | "title" | "snippet">,
  siralamaTarihi: string,
  ctx: RelevanceContext,
): RelatedRelevance {
  const haystack = turkishLexemes(`${row.title} ${row.snippet ?? ""}`);
  const matched = ctx.queryLexemes.filter((lexeme) => lexemeMatches(lexeme, haystack));
  const signals: RelatedRelevanceSignals = {
    subjectAgreement: clamp01(row.konuMutabakati / Math.max(1, ctx.subjectCount)),
    queryAgreement: clamp01(row.mutabakat / Math.max(1, ctx.queryCount)),
    snippetOverlap:
      ctx.queryLexemes.length === 0 ? 0 : clamp01(matched.length / ctx.queryLexemes.length),
    merciWeight: clamp01(1 - row.merciAgirligi / MAX_MERCI_WEIGHT),
    recency: recencySignal(siralamaTarihi, ctx.currentYear),
  };
  const raw =
    RELEVANCE_WEIGHTS.subjectAgreement * signals.subjectAgreement +
    RELEVANCE_WEIGHTS.queryAgreement * signals.queryAgreement +
    RELEVANCE_WEIGHTS.snippetOverlap * signals.snippetOverlap +
    RELEVANCE_WEIGHTS.merciWeight * signals.merciWeight +
    RELEVANCE_WEIGHTS.recency * signals.recency;
  const factor = 10 ** RELEVANCE_PRECISION;
  return {
    score: Math.round(clamp01(raw) * factor) / factor,
    signals,
    matchedLexemes: Object.freeze(matched),
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** Filters forwarded verbatim to every generated query. */
export interface RelatedSearchFilters {
  chamber?: string;
  yearFrom?: number;
  yearTo?: number;
  dateFrom?: string;
  dateTo?: string;
  decisionType?: string;
  legislationNo?: string;
  page?: number;
  /** Rows asked of each source per query. */
  limit?: number;
}

export interface RelatedSearchRequest {
  /** The event, in the lawyer's own words. */
  olay: string;
  /** Catalog source ids; empty = the catalog default (Yargıtay + Danıştay). */
  sources?: readonly string[];
  filters?: RelatedSearchFilters;
  /** At most {@link MAX_RELATED_QUERIES}; a larger number is clamped DOWN. */
  maxQueries?: number;
  /**
   * OPT-IN semantic reordering of the head of the list (W16, Şerit C).
   *
   * Default `false`, and `true` alone is not enough: the stage runs only when
   * an embedding provider is configured AND the full texts of the head rows
   * can be fetched. When it does not run, the list comes back COMPLETE in its
   * mutabakat order and `semantikSiralama` says why — see
   * {@link RelatedSemanticRanking}.
   */
  rerank?: boolean;
  /**
   * How many head rows the semantic stage may compare when `rerank:true`.
   * Clamped to 1..{@link MAX_RERANK_DOCUMENTS}; default
   * {@link DEFAULT_RERANK_DOCUMENTS}. Additive (W18).
   */
  rerankDocuments?: number;
}

// ---------------------------------------------------------------------------
// Generated queries
// ---------------------------------------------------------------------------

export type RelatedQueryKind = "atif" | "tam-ifade" | "kavram-capa" | "es-anlamli";

const QUERY_KIND_LABEL: Readonly<Record<RelatedQueryKind, string>> = Object.freeze({
  atif: "Adını verdiğiniz mevzuat/karar",
  "tam-ifade": "Kavramın tam ifadesi",
  "kavram-capa": "Kavram + kanun maddesi",
  "es-anlamli": "Aynı kavramın başka söylenişi",
});

export interface RelatedQuery {
  /** Stable within one response: `s1`, `s2`, … in generation order. */
  queryId: string;
  kind: RelatedQueryKind;
  /** Lawyer Turkish name of the query kind. */
  kindLabel: string;
  /** Exactly what was sent upstream. */
  text: string;
  exactPhrase: boolean;
  /** Which extracted issue produced it (`analyzeIntake` issue id). */
  issueId: string;
  /** The matched concept, when this query came from one. */
  concept?: string;
  /** One Turkish sentence: why this search was made on the lawyer's behalf. */
  aciklama: string;
  /** False when the budget refused to run it — see `skippedQueries[]`. */
  calisti: boolean;
  /**
   * Rows this query contributed, before deduplication. `null` when not run,
   * AND when it ran but none of the selected sources answered — an unknown
   * count is never 0 (the console reads that pair as "kaynak cevap vermedi").
   */
  bulunanSatir: number | null;
  /** Wall time of this query, ms. `null` when not run. */
  sureMs: number | null;
  /**
   * What the SOURCES said they hold for this query, summed over the sources
   * that published a count. `null` = nobody published one (never 0), and
   * always `null` for a query that did not run.
   */
  totalRecords: number | null;
}

export type CollapseReason = "AYNI_SOZCUKLER" | "KAPSANIYOR" | "NEREDEYSE_AYNI";

/**
 * A candidate query that was NOT generated because a query already chosen
 * would search (nearly) the same thing (W18). Reported, never silent: the
 * lawyer sees what was folded into what, and the cap was not spent on it.
 */
export interface CollapsedQuery {
  kind: RelatedQueryKind;
  text: string;
  exactPhrase: boolean;
  issueId: string;
  concept?: string;
  /** The text of the query it was folded into. */
  collapsedInto: string;
  reason: CollapseReason;
  /** Lawyer Turkish. */
  message: string;
}

/** Jaccard overlap of lexeme sets at or above which two queries are "nearly the same". */
export const NEAR_DUPLICATE_JACCARD = 0.8;

export type SkipReason = "CALL_BUDGET_EXCEEDED" | "TIME_BUDGET_EXCEEDED";

export interface SkippedQuery {
  queryId: string;
  text: string;
  reason: SkipReason;
  /** Lawyer Turkish; says plainly that this search did NOT run. */
  message: string;
}

// ---------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------

/**
 * One decision, as several searches found it.
 *
 * Künye fields are ABSENT when the source did not publish them. Nothing here
 * is derived, guessed or defaulted: `daire`, `kararTarihi`, `esasNo` and
 * `kararNo` are exactly what came back, or they are not there at all.
 */
export interface RelatedResultRow {
  /** Decision identity: `<sourceId>::<externalId>`. The dedupe key. */
  kararId: string;
  sourceId: string;
  /** Merci — the source's own lawyer-Turkish label. */
  merci: string;
  provider: string;
  /** What `POST /v1/sources/fetch` needs for "Tam metni getir". */
  fetchKind?: string;
  externalId: string;
  title: string;
  /**
   * The court line EXACTLY as the source published it — the court family, plus
   * the chamber when the source gave one ("Yargıtay 3. Hukuk Dairesi"). It is
   * deliberately not split into merci + daire: Bedesten publishes one string
   * and a split would be our guess, not the archive's record. `merci` above is
   * OUR label for the source that was searched; this is the source's own.
   */
  mahkeme?: string;
  kararTarihi?: string;
  esasNo?: string;
  kararNo?: string;
  sourceUrl?: string;
  /** For the eye only. A snippet is never evidence. */
  snippet?: string;
  /** Injection heuristics fired on this row's untrusted text. Telemetry only. */
  injectionFlagged?: boolean;
  /** Query ids that found this decision, in generation order. */
  bulanSorgular: readonly string[];
  /**
   * MUTABAKAT: how many DIFFERENT searches found this decision. A count of
   * agreeing searches — NOT a relevance score. See
   * {@link RELATED_RANKING_DISCLAIMER}.
   */
  mutabakat: number;
  /**
   * How many different LEGAL SUBJECTS (issues) found this decision — W17.
   *
   * MEASURED DEFECT. `mutabakat` alone counts queries, and three phrasings of
   * ONE concept are three queries. On 05.09.2026 a kira tahliye account put
   * Danıştay VERGİ decisions at the top of the list with "mutabakat 3", and
   * all three of those searches were the same subject ("kira", "kira TBK
   * m.299", "tahliye"). A generic word is in every archive, so counting
   * phrasings measures how COMMON a word is, not how related a decision is.
   *
   * Two different subjects agreeing is a genuinely different signal, so it is
   * now the FIRST ordering key. It is still a count, not a score, and the
   * screen still says so.
   */
  konuMutabakati: number;
  /** Issue ids that found this decision, in generation order. */
  bulanKonular: readonly string[];
  /**
   * The best (lowest) position the SOURCE itself gave this decision, 1-based,
   * across the queries that found it. It is the provider's own ordering, not
   * ours; we never re-score inside a source's list.
   */
  kaynakSirasi: number;
  /** The ordering's second key. Lower = higher court. See {@link MERCI_WEIGHT}. */
  merciAgirligi: number;
  /**
   * W18 — the scored relevance model, ADDITIVE. Present on every row the
   * service returns; absent only on rows built by hand (tests). When present
   * on both rows, `compareRelatedRows` orders by `score` first and the
   * agreement/merci/rank/date/identity keys break ties. See
   * {@link RELATED_RANKING}: a heuristic, never a verified relevance.
   */
  relevance?: RelatedRelevance;
  /**
   * Three-step VERBAL band from the semantic stage (`yakın` / `orta` / `uzak`).
   *
   * Present ONLY on rows whose full text was actually fetched and compared.
   * There is no number here on purpose: a similarity figure would be read as a
   * relevance score, and it is not one — see
   * `retrieval/semanticRerank.ts :: SEMANTIC_RERANK_DISCLAIMER`.
   */
  benzerlik?: SimilarityBand;
}

/**
 * What the optional semantic stage did, or why it did nothing.
 *
 * Present only when the caller asked for it (`rerank:true`). `uygulandi:false`
 * is a NORMAL answer, not an error: the list is complete either way, and the
 * order is then the mutabakat order the response already documents.
 */
export interface RelatedSemanticRanking {
  uygulandi: boolean;
  /** Typed reason when it did not run. */
  neden?: SemanticRerankReason;
  /** Lawyer Turkish, always saying plainly that the order did not change. */
  mesaj: string;
  /** The fixed disclaimer, only when the stage really ran. */
  aciklama?: string;
  /** How many head rows were compared by their FULL TEXT. */
  karsilastirilanBelge: number;
  /** How many head rows could not be fetched in full and stayed in place. */
  getirilemeyenBelge: number;
}

export interface RelatedNote {
  kind: string;
  message: string;
}

export interface RelatedSearchResult {
  relatedId: string;
  /** The event text as given. */
  olay: string;
  /** Concepts `analyzeIntake` recognised, in its own specificity order. */
  kavramlar: readonly string[];
  requestedSources: readonly string[];
  /** EVERY generated query, run or not. */
  queries: readonly RelatedQuery[];
  /** Deduplicated decisions, ordered by mutabakat → merci → tarih → kimlik. */
  results: readonly RelatedResultRow[];
  /** Queries the budget refused, each with a typed reason. Never silent. */
  skippedQueries: readonly SkippedQuery[];
  /** Candidate queries folded into an already chosen one (W18). Additive. */
  collapsedQueries: readonly CollapsedQuery[];
  /** {@link RELATED_RANKING}: the order is ColleX's own heuristic. Additive. */
  ranking: typeof RELATED_RANKING;
  /** Sources that failed at least once, NAMED. */
  failedSources: readonly SourceFailure[];
  /** Sources that answered at least one query without error. */
  okSources: readonly string[];
  /** True when a query was skipped or a source failed. */
  partial: boolean;
  /**
   * The LARGEST count any single one of our queries was told about — never a
   * sum, because the queries overlap and adding them would double-count the
   * same decisions. The real union is at least this large. `null` when no
   * query got a count from any source; never 0.
   */
  totalRecords: number | null;
  /** {@link RELATED_RANKING_DISCLAIMER}, verbatim. */
  siralamaNotu: string;
  /** Present only when `rerank:true` was asked. Additive (W16, Şerit C). */
  semantikSiralama?: RelatedSemanticRanking;
  notes: readonly RelatedNote[];
  tookMs: number;
  generatedAt: string;
}

export class NoQueriesBuiltError extends Error {
  constructor() {
    super("no query could be built from the event text");
    this.name = "NoQueriesBuiltError";
  }
}

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

/** Trim, collapse whitespace, cap by CODE POINTS (never UTF-16 units). */
function clampQueryText(raw: string): string {
  const collapsed = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  const points = [...collapsed];
  return points.length <= MAX_QUERY_TEXT_LENGTH
    ? collapsed
    : points.slice(0, MAX_QUERY_TEXT_LENGTH).join("").trim();
}

/**
 * Why a candidate collapses into an already chosen query, or `undefined` when
 * it is a genuinely different search (W18). Lexeme sets, Turkish-lowercased:
 *   - the same lexemes (an exact phrase and its plain form; "kira TBK m.299"
 *     built twice by two passes) -> AYNI_SOZCUKLER;
 *   - every lexeme of the candidate is already in the kept query -> KAPSANIYOR
 *     (the kept query is the narrower or equal search; the broader candidate
 *     would only widen the same net);
 *   - Jaccard >= {@link NEAR_DUPLICATE_JACCARD} -> NEREDEYSE_AYNI.
 * A candidate that ADDS lexemes to a kept query is kept: it is a narrower,
 * different search.
 */
function collapseReason(
  candidate: readonly string[],
  kept: readonly string[],
): CollapseReason | undefined {
  if (candidate.length === 0 || kept.length === 0) return undefined;
  const keptSet = new Set(kept);
  const shared = candidate.filter((lexeme) => keptSet.has(lexeme)).length;
  if (shared === candidate.length && shared === kept.length) return "AYNI_SOZCUKLER";
  if (shared === candidate.length) return "KAPSANIYOR";
  const union = candidate.length + kept.length - shared;
  if (union > 0 && shared / union >= NEAR_DUPLICATE_JACCARD) return "NEREDEYSE_AYNI";
  return undefined;
}

const COLLAPSE_MESSAGE_TR: Readonly<Record<CollapseReason, string>> = Object.freeze({
  AYNI_SOZCUKLER: "aynı sözcükleri arıyordu",
  KAPSANIYOR: "bütün sözcükleri o aramada zaten vardı",
  NEREDEYSE_AYNI: "neredeyse aynı sözcükleri arıyordu",
});

/**
 * May this text go out in quotes? Only a real multi-word TERM may — see
 * {@link MAX_PHRASE_WORDS} for why a quoted sentence is a trap.
 */
export function isQuotableTerm(text: string): boolean {
  const words = text.split(" ").filter((w) => w !== "");
  return words.length > 1 && words.length <= MAX_PHRASE_WORDS;
}

export interface RelatedQueryCandidate {
  kind: RelatedQueryKind;
  text: string;
  exactPhrase: boolean;
  issueId: string;
  concept?: string;
  aciklama: string;
}

/**
 * Build the candidate queries for ONE issue, in the order they should be tried.
 *
 * The passes below are deliberately in decreasing confidence: the lawyer's own
 * citation first, then the concept as an exact phrase, then the concept tied to
 * its statutory anchor, then the synonyms the concept table records. The
 * caller interleaves the passes across issues so that a small `maxQueries`
 * still touches EVERY issue rather than spending itself on the first one.
 */
/**
 * What a ONE-WORD concept is tied to before it may become a query (W17).
 *
 * Order of preference, and the reason for it:
 *   1. the statutory anchor the concept table wrote down ("TBK m.350") — it
 *      is the most narrowing thing we know about the concept and it is
 *      recorded, never guessed;
 *   2. the multi-word term of the same concept ("kira alacağı") — still the
 *      lawyer's institution, just said with two words.
 *
 * Undefined means "nothing to tie it to", and the caller then emits NO query
 * for that concept rather than a bare generic word. Losing a query is cheap;
 * a query that matches the whole archive is not, because it also inflates the
 * agreement count of everything it touches.
 */
function oneWordNarrowing(issue: IntakeIssue): string | undefined {
  const anchor = issue.anchors?.[0];
  if (anchor !== undefined && anchor.trim() !== "") return anchor.trim();
  for (const term of issue.expandedTerms) {
    const text = clampQueryText(term);
    if (text !== "" && text !== issue.label && isQuotableTerm(text)) return text;
  }
  return undefined;
}

function candidatesForIssue(issue: IntakeIssue): RelatedQueryCandidate[] {
  const out: RelatedQueryCandidate[] = [];
  const label = clampQueryText(issue.label);
  if (label.length < 2) return out;

  if (issue.kind === "exact_reference") {
    out.push({
      kind: "atif",
      text: label,
      exactPhrase: false,
      issueId: issue.issueId,
      aciklama: `Olayınızda adını verdiğiniz "${label}" için arama yapıldı.`,
    });
    return out;
  }

  const concept = issue.concept;
  const multiWord = isQuotableTerm(label);
  // W17 — MEASURED DEFECT. A one-word query is not a search, it is a census.
  // On 05.09.2026 the queries "kira" and "tahliye" went out on their own and
  // the archive answered with tax and criminal decisions, because every
  // archive contains those words. A one-word concept therefore never leaves
  // this function ALONE: it goes out tied to its statutory anchor, or tied to
  // a second word of the account, or not at all.
  const narrowing = oneWordNarrowing(issue);
  if (!multiWord && narrowing === undefined) {
    // Nothing to tie it to. A bare generic word is worse than no query: it
    // fills the list with everything and inflates the agreement count.
    return out;
  }
  const pass1Text = multiWord ? label : clampQueryText(`${label} ${narrowing}`);
  // Pass 1 — the concept as a phrase. Quoting is only meaningful for a term
  // with more than one word; a single quoted word is the same search.
  out.push({
    kind: "tam-ifade",
    text: pass1Text,
    exactPhrase: multiWord,
    issueId: issue.issueId,
    ...(concept !== undefined ? { concept } : {}),
    aciklama: multiWord
      ? `Olay metninizde geçen "${label}" kavramı tam ifade olarak arandı.`
      : `"${label}" tek başına aranmadı — tek sözcüklü bir arama arşivdeki her` +
        ` şeyi getirir. "${narrowing}" ile birlikte arandı.`,
  });

  // Pass 2 — concept + the statutory hook the concept table wrote down. A
  // missing anchor means "not written down here", never "no statutory basis",
  // so its absence produces no query rather than an invented article number.
  const anchor = issue.anchors?.[0];
  if (anchor !== undefined) {
    out.push({
      kind: "kavram-capa",
      text: clampQueryText(`${label} ${anchor}`),
      exactPhrase: false,
      issueId: issue.issueId,
      ...(concept !== undefined ? { concept } : {}),
      aciklama: `"${label}" kavramı, kayıtlı kanun maddesi ${anchor} ile birlikte arandı.`,
    });
  }

  // Pass 3+ — the synonyms. Index 0 is the concept key itself (already used).
  for (const term of issue.expandedTerms.slice(1)) {
    const text = clampQueryText(term);
    if (text.length < 2) continue;
    // W17: same rule as pass 1 — a one-word synonym is a census, not a search.
    if (!isQuotableTerm(text)) continue;
    out.push({
      kind: "es-anlamli",
      text,
      exactPhrase: isQuotableTerm(text),
      issueId: issue.issueId,
      ...(concept !== undefined ? { concept } : {}),
      aciklama: `"${label}" kavramının başka söylenişi olan "${text}" ile arandı.`,
    });
  }
  return out;
}

/**
 * All queries the event text produces, capped and deduplicated.
 *
 * Round-robin over the issues: every issue contributes its first candidate
 * before any issue contributes its second. That is what keeps a cap of three
 * from turning a four-issue event into "three phrasings of the first issue".
 *
 * W18 — de-duplication and diversity: a candidate whose lexemes are the same
 * as, or fully contained in, or nearly the same as an already chosen query is
 * NOT generated ({@link collapseReason}); it is reported in `collapsed` with
 * the query it folded into, and it does not consume the cap. The cap is thus
 * spent only on DISTINCT searches.
 */
export function buildRelatedQueries(
  olay: string,
  maxQueries: number,
): {
  queries: RelatedQueryCandidate[];
  kavramlar: string[];
  fallback: boolean;
  issues: readonly IntakeIssue[];
  collapsed: CollapsedQuery[];
} {
  const analysis = analyzeIntake({ question: olay, jurisdiction: "TR", dataClass: "L0" });
  const issues = analysis.issues;
  const kavramlar = issues
    .filter((i) => i.kind === "conceptual" && i.concept !== undefined)
    .map((i) => i.concept as string);

  // `analyzeIntake` never returns an empty issue list: when nothing matched it
  // returns ONE issue whose concept is the whole normalized question. That is
  // the fallback, and it is reported as one — the lawyer must be told that no
  // legal concept was recognised in their text.
  const fallback =
    issues.length === 1 &&
    issues[0]?.kind === "conceptual" &&
    issues[0]?.concept === analysis.normalizedQuestion;

  const perIssue = issues.map((issue) => candidatesForIssue(issue));
  const cap = Math.max(1, Math.min(MAX_RELATED_QUERIES, Math.floor(maxQueries)));
  const keptLexemes: string[][] = [];
  const queries: RelatedQueryCandidate[] = [];
  const collapsed: CollapsedQuery[] = [];
  const depth = perIssue.reduce((max, list) => Math.max(max, list.length), 0);

  for (let pass = 0; pass < depth && queries.length < cap; pass += 1) {
    for (const list of perIssue) {
      if (queries.length >= cap) break;
      const candidate = list[pass];
      if (candidate === undefined) continue;
      const lexemes = turkishLexemes(candidate.text);
      let folded = false;
      for (const [index, kept] of keptLexemes.entries()) {
        const reason = collapseReason(lexemes, kept);
        if (reason === undefined) continue;
        const into = queries[index] as RelatedQueryCandidate;
        collapsed.push({
          kind: candidate.kind,
          text: candidate.text,
          exactPhrase: candidate.exactPhrase,
          issueId: candidate.issueId,
          ...(candidate.concept !== undefined ? { concept: candidate.concept } : {}),
          collapsedInto: into.text,
          reason,
          message:
            `"${candidate.text}" araması ÜRETİLMEDİ: "${into.text}" araması` +
            ` ${COLLAPSE_MESSAGE_TR[reason]}. Arama kotası buna harcanmadı.`,
        });
        folded = true;
        break;
      }
      if (folded) continue;
      keptLexemes.push(lexemes);
      queries.push(candidate);
    }
  }

  if (fallback) {
    // The fallback "concept" is the lawyer's own sentence, not a legal term.
    // Calling it a kavram on screen would be a small lie, so the concept list
    // stays EMPTY and the query says what it really is.
    return {
      queries: queries.map((q) => ({
        kind: q.kind,
        text: q.text,
        exactPhrase: false,
        issueId: q.issueId,
        aciklama:
          `Tanınan bir hukuk kavramı bulunamadığı için olayı anlattığınız` +
          ` sözcüklerle arandı: "${q.text}".`,
      })),
      kavramlar: [],
      issues: [],
      fallback,
      collapsed,
    };
  }

  return { queries, kavramlar: [...new Set(kavramlar)], fallback, issues, collapsed };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

const ISO_DAY_PREFIX_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/u;
const DOTTED_DAY_RE = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})/u;

/**
 * Sortable `YYYY-MM-DD` from whatever shape the source published, or `""` when
 * it published nothing usable. `""` sorts LAST under "newest first", which is
 * the honest place for a decision whose date we do not know — it is never
 * promoted by a guessed date and never silently dropped.
 */
export function sortableDate(raw: string | undefined): string {
  if (raw === undefined) return "";
  const iso = raw.match(ISO_DAY_PREFIX_RE);
  if (iso !== null) return `${iso[1] as string}-${iso[2] as string}-${iso[3] as string}`;
  const dotted = raw.match(DOTTED_DAY_RE);
  if (dotted !== null) {
    return (
      `${dotted[3] as string}-${(dotted[2] as string).padStart(2, "0")}` +
      `-${(dotted[1] as string).padStart(2, "0")}`
    );
  }
  return "";
}

/** A row plus the sort-only date projection; the date shown stays the raw one. */
export type OrderableRow = RelatedResultRow & { readonly siralamaTarihi: string };

/**
 * Court family a statutory anchor points at (W17).
 *
 * MEASURED DEFECT. The default source set is `["yargitay", "danistay"]`, so a
 * kira tahliye account was searched in the administrative archive too, and on
 * 05.09.2026 the top rows of a rental dispute were Danıştay VERGİ decisions.
 * The concept table already records which statute the concept lives under; the
 * statute names the court family, so nothing has to be guessed.
 *
 * The table is deliberately short and only maps what it is SURE of. An anchor
 * it does not recognise yields `undefined`, and one unrecognised anchor is
 * enough to stop the narrowing entirely — searching too widely is a nuisance,
 * searching the wrong archive and calling it complete is a lie.
 */
const ANCHOR_FAMILY: readonly (readonly [RegExp, "adli" | "idari"])[] = Object.freeze([
  [/^(TBK|TMK|HMK|İİK|TTK|TKHK|MK|BK)(?![0-9A-Za-zÇĞİÖŞÜçğıöşü])/iu, "adli"],
  [/^(TCK|CMK|KabahatlerK)(?![0-9A-Za-zÇĞİÖŞÜçğıöşü])/iu, "adli"],
  [/^(4857|6098|4721|6100|2004|6102|6502|1136|6325|5237|5271|5326|3568)(?![0-9])/u, "adli"],
  [/^(İYUK|VUK|AATUHK|İmarK)(?![0-9A-Za-zÇĞİÖŞÜçğıöşü])/iu, "idari"],
  [/^(2577|213|6183|2942|3194|657|5393|5216)(?![0-9])/u, "idari"],
]);

/** Sources that belong to each family, in the catalog's own ids. */
const FAMILY_SOURCES: Readonly<Record<"adli" | "idari", readonly string[]>> = Object.freeze({
  adli: Object.freeze(["yargitay"]),
  idari: Object.freeze(["danistay"]),
});

function anchorFamily(anchor: string): "adli" | "idari" | undefined {
  const head = anchor.trim();
  for (const [pattern, family] of ANCHOR_FAMILY) {
    if (pattern.test(head)) return family;
  }
  return undefined;
}

/**
 * The source ids to search when the CALLER did not choose any, narrowed to the
 * court family every fired anchor agrees on. Returns undefined when nothing
 * may be narrowed — no anchors, a disagreement, or an anchor we do not know.
 */
export function narrowSourcesByAnchors(
  issues: readonly IntakeIssue[],
): { sources: readonly string[]; family: "adli" | "idari"; dropped: readonly string[] } | undefined {
  const anchors = issues.flatMap((issue) => issue.anchors ?? []);
  if (anchors.length === 0) return undefined;
  const families = new Set<"adli" | "idari">();
  for (const anchor of anchors) {
    const family = anchorFamily(anchor);
    if (family === undefined) return undefined; // unknown statute: do not narrow
    families.add(family);
  }
  if (families.size !== 1) return undefined;
  const [family] = [...families];
  if (family === undefined) return undefined;
  const keep = FAMILY_SOURCES[family];
  // The lawyer reads the SOURCE'S NAME, never its machine id.
  const dropped = resolveSources(undefined)
    .sources.filter((s: { id: string }) => !keep.includes(s.id))
    .map((s: { label: string }) => s.label);
  if (dropped.length === 0) return undefined;
  return { sources: keep, family, dropped };
}

/**
 * The ordering, as one comparator, so the rule sits in ONE place a test can
 * read: SUBJECT agreement (desc) → query agreement (desc) → merci weight
 * (asc) → the SOURCE's own rank (asc) → decision date (desc, unknown last) →
 * decision identity (asc, code-unit order, locale-free).
 *
 * Every key is a property of the DATA, never of this process: no random id, no
 * insertion order, no clock. Same input, same order, on any machine.
 */
export function compareRelatedRows(a: OrderableRow, b: OrderableRow): number {
  // W18: the scored model first, when BOTH rows carry one (the service always
  // attaches it; hand-built rows may not). Everything below is its tie-break,
  // so a row without a score is ordered exactly as before.
  if (
    a.relevance !== undefined &&
    b.relevance !== undefined &&
    a.relevance.score !== b.relevance.score
  ) {
    return b.relevance.score - a.relevance.score;
  }
  // W17: SUBJECT agreement first, phrasing count second. See `konuMutabakati`.
  if (a.konuMutabakati !== b.konuMutabakati) return b.konuMutabakati - a.konuMutabakati;
  if (a.mutabakat !== b.mutabakat) return b.mutabakat - a.mutabakat;
  if (a.merciAgirligi !== b.merciAgirligi) return a.merciAgirligi - b.merciAgirligi;
  // W17: the SOURCE's own position, before the date. Measured on 05.09.2026:
  // with date as the first tie-break, a kira tahliye search led with the
  // newest decisions of unrelated chambers while Yargıtay 3. HD — the chamber
  // whose list the source itself opened with — sat far below. The provider
  // put a decision first for a reason; discarding that and sorting the whole
  // tie group by date replaces its judgement with a calendar.
  if (a.kaynakSirasi !== b.kaynakSirasi) return a.kaynakSirasi - b.kaynakSirasi;
  if (a.siralamaTarihi !== b.siralamaTarihi) {
    // Unknown date ("") is last under "newest first".
    if (a.siralamaTarihi === "") return 1;
    if (b.siralamaTarihi === "") return -1;
    return a.siralamaTarihi < b.siralamaTarihi ? 1 : -1;
  }
  if (a.kararId === b.kararId) return 0;
  return a.kararId < b.kararId ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface RelatedSearchDeps {
  gateway: ProviderGateway;
  now?: () => string;
  monotonic?: () => number;
  newId?: () => string;
  perCallTimeoutMs?: number;
  /** Wall budget across all queries; 0 disables the check. */
  timeBudgetMs?: number;
  /** Total upstream calls; the default is {@link RELATED_MAX_UPSTREAM_CALLS}. */
  maxUpstreamCalls?: number;

  // -- W16 Şerit C: the optional semantic stage. All of it injectable. -------
  /**
   * Embedding resolution. Default: read from the process environment, which is
   * DISABLED unless the lawyer configured a provider. Tests inject it, so no
   * test ever depends on the machine's environment.
   */
  embedding?: EmbeddingResolution;
  /** The network port. Default: built from the resolved config. TESTS INJECT. */
  embedder?: EmbeddingPort;
  /**
   * How the full text of a head row is obtained. Default: `POST`-equivalent
   * `fetchSourceCard` over the SAME gateway — no new tool, no changed
   * contract. A row whose source publishes no fetch kind cannot be fetched and
   * therefore is never reranked.
   */
  fullText?: RelatedFullTextPort;
  /** Head rows to compare; clamped to {@link MAX_RERANK_DOCUMENTS}. */
  rerankDocuments?: number;
  /** Wall budget of the embedding call; 0 disables it. */
  rerankTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// W16 Şerit C — full text for the semantic stage
// ---------------------------------------------------------------------------

/** A fetched full text plus the fingerprint that proves it is not a snippet. */
export interface RelatedFullText {
  fullText: string;
  /** SHA-256 over the UTF-8 bytes of `fullText`. */
  contentSha256: string;
  title?: string;
}

export interface RelatedFullTextPort {
  fetch(row: RelatedResultRow): Promise<RelatedFullText | null>;
}

/**
 * The default full-text port: the existing `fetchSourceCard`, which already
 * canonicalizes the text and seals it with `contentSha256`.
 *
 * `null` means "no full text for this row" — an absent fetch kind, an unknown
 * kind, or a typed upstream failure. It is never an exception and never an
 * empty string pretending to be a document.
 */
export function createSourceCardFullTextPort(deps: {
  gateway: ProviderGateway;
  now?: () => string;
  newId?: () => string;
  perCallTimeoutMs?: number;
}): RelatedFullTextPort {
  return {
    async fetch(row) {
      if (row.fetchKind === undefined) return null;
      let outcome;
      try {
        outcome = await fetchSourceCard(
          { kind: row.fetchKind, externalId: row.externalId },
          {
            gateway: deps.gateway,
            ...(deps.now !== undefined ? { now: deps.now } : {}),
            ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
            perCallTimeoutMs: deps.perCallTimeoutMs ?? DEFAULT_SOURCE_FETCH_TIMEOUT_MS,
          },
        );
      } catch (error) {
        // An unknown fetch kind is a catalog problem, not a reason to fail the
        // whole search: the row simply keeps its place.
        if (error instanceof UnknownFetchKindError) return null;
        throw error;
      }
      if (!outcome.ok) return null;
      return {
        fullText: outcome.card.text,
        contentSha256: outcome.card.contentSha256,
        ...(outcome.card.title !== "" ? { title: outcome.card.title } : {}),
      };
    },
  };
}

interface Accumulated {
  row: RelatedResultRow;
  siralamaTarihi: string;
}

function identity(row: SourceSearchRow): string {
  return `${row.sourceId}::${row.externalId}`;
}

/** Failure list, deduplicated by (source, kind); the first sentence wins. */
function mergeFailures(into: SourceFailure[], incoming: readonly SourceFailure[]): void {
  for (const failure of incoming) {
    if (into.some((f) => f.sourceId === failure.sourceId && f.kind === failure.kind)) {
      continue;
    }
    into.push(failure);
  }
}

/**
 * The optional semantic stage (W16, Şerit C).
 *
 * It touches ONLY the order, and only the positions of the head rows whose
 * FULL TEXT was fetched. A row that could not be fetched stays exactly where
 * mutabakat put it — the permutation is written back into the same indices —
 * so a source that refuses to serve full texts can never push its decisions
 * down the page. Nothing is added to or removed from the list.
 */
async function applySemanticStage(
  request: RelatedSearchRequest,
  deps: RelatedSearchDeps,
  results: readonly RelatedResultRow[],
): Promise<{
  results: readonly RelatedResultRow[];
  semantik?: RelatedSemanticRanking;
}> {
  if (request.rerank !== true) return { results };

  const resolution = deps.embedding ?? resolveEmbeddingConfig();
  if (!resolution.enabled) {
    return {
      results,
      semantik: {
        uygulandi: false,
        neden: resolution.reason,
        mesaj: resolution.message,
        karsilastirilanBelge: 0,
        getirilemeyenBelge: 0,
      },
    };
  }

  // W18: the CALLER may ask for a wider head (`rerankDocuments`), clamped to
  // the module ceiling; the deps value remains the test/operator override.
  const askedWindow =
    request.rerankDocuments !== undefined && Number.isFinite(request.rerankDocuments)
      ? Math.max(1, Math.floor(request.rerankDocuments))
      : undefined;
  const windowSize = Math.max(
    0,
    Math.min(
      MAX_RERANK_DOCUMENTS,
      Math.floor(askedWindow ?? deps.rerankDocuments ?? DEFAULT_RERANK_DOCUMENTS),
      results.length,
    ),
  );
  const port =
    deps.fullText ??
    createSourceCardFullTextPort({
      gateway: deps.gateway,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.newId !== undefined ? { newId: deps.newId } : {}),
      ...(deps.perCallTimeoutMs !== undefined
        ? { perCallTimeoutMs: deps.perCallTimeoutMs }
        : {}),
    });

  const fetched: { index: number; row: RelatedResultRow; text: RelatedFullText }[] = [];
  let unfetched = 0;
  for (let i = 0; i < windowSize; i += 1) {
    const row = results[i] as RelatedResultRow;
    let text: RelatedFullText | null = null;
    try {
      text = await port.fetch(row);
    } catch {
      // Fail-closed: an exception on one document costs that document its
      // place in the comparison, never the whole list.
      text = null;
    }
    if (text === null || text.fullText.trim() === "") {
      unfetched += 1;
      continue;
    }
    fetched.push({ index: i, row, text });
  }

  const noFullText = (): {
    results: readonly RelatedResultRow[];
    semantik: RelatedSemanticRanking;
  } => ({
    results,
    semantik: {
      uygulandi: false,
      neden: "NO_FULL_TEXT",
      mesaj:
        "Anlam benzerliğine göre sıralama YAPILAMADI: karşılaştırma yalnız tam" +
        " metni getirilmiş belgeler arasında yapılır; bu listenin başındaki" +
        " kararların tam metni getirilemedi. Sıra değiştirilmedi.",
      karsilastirilanBelge: 0,
      getirilemeyenBelge: unfetched,
    },
  });

  // One document cannot be reordered against itself; two is the smallest set
  // where a comparison can change anything.
  if (fetched.length < 2) return noFullText();

  const outcome = await semanticRerank({
    query: request.olay,
    items: fetched,
    toDocument: (entry) => ({
      sourceId: entry.row.sourceId,
      externalId: entry.row.externalId,
      fullText: entry.text.fullText,
      contentSha256: entry.text.contentSha256,
      ...(entry.text.title !== undefined ? { title: entry.text.title } : {}),
    }),
    config: resolution.config,
    port: deps.embedder ?? createEmbeddingPort(resolution.config),
    ...(deps.rerankTimeoutMs !== undefined ? { timeoutMs: deps.rerankTimeoutMs } : {}),
  });

  if (!outcome.applied) {
    return {
      results,
      semantik: {
        uygulandi: false,
        ...(outcome.warning !== undefined ? { neden: outcome.warning.reason } : {}),
        mesaj:
          outcome.warning?.message ??
          "Anlam benzerliğine göre sıralama YAPILAMADI. Sıra değiştirilmedi.",
        karsilastirilanBelge: 0,
        getirilemeyenBelge: unfetched,
      },
    };
  }

  // Write the permutation back into the SAME indices the fetched rows held.
  const slots = fetched.map((entry) => entry.index);
  const next = [...results];
  outcome.items.forEach((ranked, position) => {
    const slot = slots[position] as number;
    next[slot] = {
      ...ranked.item.row,
      ...(ranked.benzerlik !== undefined ? { benzerlik: ranked.benzerlik } : {}),
    };
  });

  return {
    results: next,
    semantik: {
      uygulandi: true,
      mesaj:
        `Listenin başındaki ${fetched.length} kararın TAM METNİ getirildi ve` +
        " olay anlatımınıza metin olarak benzerliğine göre kendi aralarında" +
        " yeniden sıralandı." +
        (unfetched > 0
          ? ` Tam metni getirilemeyen ${unfetched} karar yerinde bırakıldı.`
          : ""),
      ...(outcome.aciklama !== undefined ? { aciklama: outcome.aciklama } : {}),
      karsilastirilanBelge: fetched.length,
      getirilemeyenBelge: unfetched,
    },
  };
}

export async function relatedSearch(
  request: RelatedSearchRequest,
  deps: RelatedSearchDeps,
): Promise<RelatedSearchResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const monotonic = deps.monotonic ?? (() => Date.now());
  const newId = deps.newId ?? (() => randomUUID());
  const timeBudgetMs = deps.timeBudgetMs ?? DEFAULT_RELATED_TIME_BUDGET_MS;
  const maxCalls = deps.maxUpstreamCalls ?? RELATED_MAX_UPSTREAM_CALLS;
  const startedAt = monotonic();

  // Resolve the sources FIRST so the fan-out cost is known before anything is
  // spent. A selection with no known id throws out of `searchSources` as
  // NoSourcesSelectedError, which the route turns into a field-level 400.
  const built = buildRelatedQueries(
    request.olay,
    request.maxQueries ?? DEFAULT_RELATED_QUERIES,
  );
  if (built.queries.length === 0) throw new NoQueriesBuiltError();

  // W17: when the caller chose nothing, the fired anchors may narrow the
  // archive to the court family they all point at. The caller's own choice is
  // never touched, and an unknown or mixed statute narrows nothing.
  const narrowed =
    request.sources === undefined || request.sources.length === 0
      ? narrowSourcesByAnchors(built.issues)
      : undefined;
  const { sources } = resolveSources(narrowed?.sources ?? request.sources);
  const sourceCount = sources.length;

  const filters = request.filters ?? {};
  const perQueryLimit = Math.min(
    MAX_SOURCE_SEARCH_LIMIT,
    Math.max(1, Math.floor(filters.limit ?? DEFAULT_RELATED_PER_QUERY_LIMIT)),
  );

  const queries: RelatedQuery[] = [];
  const skipped: SkippedQuery[] = [];
  const failedSources: SourceFailure[] = [];
  const okSources: string[] = [];
  const byIdentity = new Map<string, Accumulated>();
  const reportedTotals: number[] = [];
  let callsUsed = 0;
  let ranCount = 0;

  for (const [index, candidate] of built.queries.entries()) {
    const queryId = `s${index + 1}`;
    const base: Omit<RelatedQuery, "calisti" | "bulunanSatir" | "sureMs" | "totalRecords"> = {
      queryId,
      kind: candidate.kind,
      kindLabel: QUERY_KIND_LABEL[candidate.kind],
      text: candidate.text,
      exactPhrase: candidate.exactPhrase,
      issueId: candidate.issueId,
      ...(candidate.concept !== undefined ? { concept: candidate.concept } : {}),
      aciklama: candidate.aciklama,
    };

    const skip = (reason: SkipReason, message: string): void => {
      skipped.push({ queryId, text: candidate.text, reason, message });
      queries.push({
        ...base,
        calisti: false,
        bulunanSatir: null,
        sureMs: null,
        totalRecords: null,
      });
    };

    // The FIRST query always runs: a budget that refuses everything would turn
    // a search into an empty page with no account of what was searched.
    if (ranCount > 0 && callsUsed + sourceCount > maxCalls) {
      skip(
        "CALL_BUDGET_EXCEEDED",
        `"${candidate.text}" araması YAPILMADI: bu istek için ayrılan kaynak sorgusu` +
          ` bütçesi (${maxCalls} işlem) doldu.`,
      );
      continue;
    }
    if (ranCount > 0 && timeBudgetMs > 0 && monotonic() - startedAt >= timeBudgetMs) {
      skip(
        "TIME_BUDGET_EXCEEDED",
        `"${candidate.text}" araması YAPILMADI: bu istek için ayrılan süre` +
          ` (${Math.round(timeBudgetMs / 1000)} saniye) doldu.`,
      );
      continue;
    }

    const searchRequest: SourceSearchRequest = {
      query: candidate.text,
      sources: sources.map((s: SourceDescriptor) => s.id),
      exactPhrase: candidate.exactPhrase,
      limit: perQueryLimit,
      ...(filters.chamber !== undefined ? { chamber: filters.chamber } : {}),
      ...(filters.yearFrom !== undefined ? { yearFrom: filters.yearFrom } : {}),
      ...(filters.yearTo !== undefined ? { yearTo: filters.yearTo } : {}),
      ...(filters.dateFrom !== undefined ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo !== undefined ? { dateTo: filters.dateTo } : {}),
      ...(filters.decisionType !== undefined ? { decisionType: filters.decisionType } : {}),
      ...(filters.legislationNo !== undefined
        ? { legislationNo: filters.legislationNo }
        : {}),
      ...(filters.page !== undefined ? { page: filters.page } : {}),
    };

    const queryStarted = monotonic();
    const result: SourceSearchResult = await searchSources(searchRequest, {
      gateway: deps.gateway,
      now,
      monotonic,
      newId,
      ...(deps.perCallTimeoutMs !== undefined
        ? { perCallTimeoutMs: deps.perCallTimeoutMs }
        : {}),
    });
    callsUsed += sourceCount;
    ranCount += 1;

    mergeFailures(failedSources, result.failedSources);
    for (const id of result.okSources) if (!okSources.includes(id)) okSources.push(id);
    if (result.totalRecords !== null) reportedTotals.push(result.totalRecords);

    // Rank = the position the SOURCE gave the row inside its own list for this
    // query. `searchSources` appends per source in provider order, so counting
    // per sourceId reproduces it exactly. We never re-score inside that list.
    const rankBySource = new Map<string, number>();
    for (const row of result.rows) {
      const rank = (rankBySource.get(row.sourceId) ?? 0) + 1;
      rankBySource.set(row.sourceId, rank);
      const key = identity(row);
      const existing = byIdentity.get(key);
      if (existing === undefined) {
        byIdentity.set(key, {
          siralamaTarihi: sortableDate(row.decisionDate),
          row: {
            kararId: key,
            sourceId: row.sourceId,
            merci: row.sourceLabel,
            provider: row.provider,
            ...(row.fetchKind !== undefined ? { fetchKind: row.fetchKind } : {}),
            externalId: row.externalId,
            title: row.title,
            ...(row.court !== undefined ? { mahkeme: row.court } : {}),
            ...(row.decisionDate !== undefined ? { kararTarihi: row.decisionDate } : {}),
            ...(row.docketNo !== undefined ? { esasNo: row.docketNo } : {}),
            ...(row.decisionNo !== undefined ? { kararNo: row.decisionNo } : {}),
            ...(row.sourceUrl !== undefined ? { sourceUrl: row.sourceUrl } : {}),
            ...(row.snippet !== undefined ? { snippet: row.snippet } : {}),
            ...(row.injectionFlagged === true ? { injectionFlagged: true } : {}),
            bulanSorgular: [queryId],
            mutabakat: 1,
            bulanKonular: [candidate.issueId],
            konuMutabakati: 1,
            kaynakSirasi: rank,
            merciAgirligi: merciWeight(row.sourceId),
          },
        });
        continue;
      }
      // A source may repeat a row inside ONE query's payload; mutabakat counts
      // DISTINCT queries, so a repeat inside the same query adds nothing.
      const alreadyCounted = existing.row.bulanSorgular.includes(queryId);
      // W17: the SUBJECT is counted separately. Three phrasings of one concept
      // are three queries but ONE subject, and the ordering leads on subjects.
      const newSubject =
        candidate.issueId !== "" && !existing.row.bulanKonular.includes(candidate.issueId);
      existing.row = {
        ...existing.row,
        ...(alreadyCounted
          ? {}
          : {
              bulanSorgular: [...existing.row.bulanSorgular, queryId],
              mutabakat: existing.row.mutabakat + 1,
            }),
        ...(newSubject
          ? {
              bulanKonular: [...existing.row.bulanKonular, candidate.issueId],
              konuMutabakati: existing.row.konuMutabakati + 1,
            }
          : {}),
        kaynakSirasi: Math.min(existing.row.kaynakSirasi, rank),
      };
    }

    queries.push({
      ...base,
      calisti: true,
      // 27.09.2026: with every selected source down this was `0`, and the
      // ALL_SOURCES_FAILED card drew each query with a green "çalıştırıldı"
      // chip and "0 künye getirdi" — a count nobody measured. No source
      // answered means the count is UNKNOWN (`null`), never 0.
      bulunanSatir: result.okSources.length === 0 ? null : result.rows.length,
      sureMs: Math.max(0, Math.round(monotonic() - queryStarted)),
      totalRecords: result.totalRecords,
    });
  }

  // W18: the relevance context is a property of THIS run — which queries ran
  // and what they contained — so the score is re-derivable from the response.
  const ranQueries = queries.filter((q) => q.calisti);
  const relevanceContext: RelevanceContext = {
    subjectCount: Math.max(1, new Set(ranQueries.map((q) => q.issueId)).size),
    queryCount: Math.max(1, ranQueries.length),
    queryLexemes: [...new Set(ranQueries.flatMap((q) => turkishLexemes(q.text)))],
    currentYear: Number.parseInt(now().slice(0, 4), 10) || new Date().getUTCFullYear(),
  };
  const ordered = [...byIdentity.values()]
    .map(
      (a): OrderableRow => ({
        ...a.row,
        relevance: computeRelevance(a.row, a.siralamaTarihi, relevanceContext),
        siralamaTarihi: a.siralamaTarihi,
      }),
    )
    .sort(compareRelatedRows);
  const cut = ordered.length > MAX_RELATED_RESULTS;
  const mutabakatOrder = ordered
    .slice(0, MAX_RELATED_RESULTS)
    .map((row): RelatedResultRow => {
      const { siralamaTarihi: _sortKey, ...rest } = row;
      return rest;
    });

  // W16 Şerit C — OPTIONAL, OFF by default, and it may only reorder.
  const semantic = await applySemanticStage(request, deps, mutabakatOrder);
  const results = semantic.results;

  const notes: RelatedNote[] = [
    { kind: "SIRALAMA_ACIKLAMASI", message: RELATED_RANKING_DISCLAIMER },
    // W17: a narrowing the lawyer did not ask for is only acceptable while it
    // is VISIBLE and reversible, so it says which archive was left out, why,
    // and how to get it back.
    ...(narrowed !== undefined
      ? [
          {
            kind: "MERCI_DARALTILDI",
            message:
              `Bu olayın kanunları ${narrowed.family === "adli" ? "adlî" : "idarî"} yargıya` +
              ` işaret ettiği için ${narrowed.dropped.join(", ")} kaynağında arama YAPILMADI.` +
              " O kaynaktaki kararlar bu listede yok. Aramak isterseniz yukarıdaki" +
              " merci listesinden kendiniz seçin.",
          },
        ]
      : []),
    {
      kind: "SORGU_SEFFAFLIGI",
      message:
        `Olayınızdan ${built.queries.length} ayrı arama üretildi ve bunlardan` +
        ` ${ranCount} tanesi çalıştırıldı. Hepsi aşağıda tek tek yazılıdır.`,
    },
    {
      kind: "ILGILILIK_MODELI",
      message:
        "Sıra, ColleX'in kendi sezgisel sıralama modeliyle kuruldu" +
        " (ranking: colleX-heuristic): konu mutabakatı, sorgu mutabakatı," +
        " başlık ve özetteki sözcük örtüşmesi, merci ve karar yaşı sabit" +
        " ağırlıklarla toplanır; her satırda bu beş sinyal ayrı ayrı yazılıdır." +
        " Bu bir ilgililik puanı DEĞİLDİR: model hiçbir gerçek karar kümesinde" +
        " ÖLÇÜLMEDİ ve isabet doğrulanmış değildir.",
    },
  ];
  if (built.collapsed.length > 0) {
    notes.push({
      kind: "SORGU_BIRLESTIRILDI",
      message:
        `${built.collapsed.length} aday arama, seçilmiş bir aramanın aynısı ya da` +
        " kapsamı olduğu için ÜRETİLMEDİ; hangileri olduğu ve hangi aramaya" +
        " katlandığı ayrıca yazılıdır. Arama kotası bunlara harcanmadı.",
    });
  }
  if (built.fallback) {
    notes.push({
      kind: "KAVRAM_BULUNAMADI",
      message:
        "Olay metninizde tanınan bir hukuk kavramı bulunamadı; arama, olayı" +
        " anlattığınız sözcüklerle yapıldı. Olayı hukukî terimlerle yeniden" +
        " yazarsanız daha çok arama üretilir.",
    });
  }
  if (skipped.length > 0) {
    notes.push({
      kind: "BUTCE_ASILDI",
      message:
        `${skipped.length} arama bütçe nedeniyle YAPILMADI; hangileri olduğu` +
        " aşağıda tek tek yazılıdır. Bu aramaların bulabileceği kararlar bu" +
        " listede YOK.",
    });
  }
  if (failedSources.length > 0) {
    notes.push({
      kind: "KAYNAK_HATASI",
      message:
        `${failedSources.length} kaynak en az bir aramada yanıt veremedi;` +
        " bu kaynakların sonuçları listede eksik olabilir.",
    });
  }
  notes.push({
    kind: "KAYIT_SAYISI",
    message:
      reportedTotals.length === 0
        ? "Kaynaklar bu aramalar için toplam kayıt sayısı bildirmedi; sayı" +
          " bilinmiyor (sıfır değil)."
        : "Kayıt sayısı, tek bir aramanın aldığı EN BÜYÜK sayıdır; aramalar" +
          " birbiriyle örtüştüğü için sayılar toplanmaz.",
  });
  if (semantic.semantik !== undefined) {
    const s = semantic.semantik;
    notes.push(
      s.uygulandi
        ? { kind: "SEMANTIK_SIRALAMA", message: s.mesaj }
        : {
            kind: "SEMANTIK_SIRALAMA_KAPALI",
            message: `Anlam benzerliğine göre sıralama kapalı — nedeni: ${s.mesaj}`,
          },
    );
    if (s.uygulandi && s.aciklama !== undefined) {
      notes.push({ kind: "SEMANTIK_SIRALAMA_ACIKLAMASI", message: s.aciklama });
    }
  }
  if (cut) {
    notes.push({
      kind: "LISTE_KIRPILDI",
      message:
        `Bulunan karar sayısı ${ordered.length}; listede ilk ${MAX_RELATED_RESULTS}` +
        " tanesi gösteriliyor. Aramayı daraltmak için tarih ya da merci süzgeci ekleyin.",
    });
  }

  return {
    relatedId: newId(),
    olay: request.olay,
    kavramlar: Object.freeze(built.kavramlar),
    requestedSources: Object.freeze(sources.map((s: SourceDescriptor) => s.id)),
    queries: Object.freeze(queries),
    results: Object.freeze(results),
    skippedQueries: Object.freeze(skipped),
    collapsedQueries: Object.freeze(built.collapsed),
    ranking: RELATED_RANKING,
    failedSources: Object.freeze(failedSources),
    okSources: Object.freeze(okSources),
    partial: skipped.length > 0 || failedSources.length > 0,
    totalRecords: reportedTotals.length === 0 ? null : Math.max(...reportedTotals),
    siralamaNotu: RELATED_RANKING_DISCLAIMER,
    ...(semantic.semantik !== undefined
      ? { semantikSiralama: Object.freeze(semantic.semantik) }
      : {}),
    notes: Object.freeze(notes),
    tookMs: Math.max(0, Math.round(monotonic() - startedAt)),
    generatedAt: now(),
  };
}
