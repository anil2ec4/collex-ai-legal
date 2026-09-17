/**
 * Embedding-provider EVALUATION harness (W21).
 *
 * The dense lane does not pick an embedding model; this harness is how one
 * gets picked. It runs the SAME labelled cases through every provider that
 * implements the product's own `EmbeddingPort` (the seam the dense lane, the
 * embedding worker and the semantic rerank all use), formats texts with the
 * SAME prompt-style functions the product uses, ranks each case's passages by
 * cosine, and reports per provider:
 *
 *   Recall@K (K = 1, 3, 5, 10)   share of relevant passages in the top K
 *   MRR                          1 / rank of the first relevant passage
 *   nDCG@10                      graded (relevance 0..3, gain 2^rel - 1)
 *   semantic-only Recall@K       Recall@K over relevant passages the case
 *                                marks as sharing NO word with the query —
 *                                what only a meaning-based lane can find
 *   latency p50/p95              per embed call (and per query call)
 *   failure rate                 per case and per call, by error code
 *   memory                       resident memory of the embedding process
 *                                before/after, ONLY when the caller can read
 *                                it; otherwise null with a reason
 *
 * Honesty rules built in:
 *   - a DRY RUN (scripted embedder) is labelled a harness check, never a
 *     measurement;
 *   - synthetic cases are labelled synthetic; a quality claim needs the
 *     lawyer-annotated cases described in evals/embeddings/CASE_FORMAT.md,
 *     and synthetic, agreed, pending and disputed cases are SEPARATE groups:
 *     the quality figures exist only per group (a pooled R@K over labels no
 *     second lawyer confirmed never reads as lawyer gold), and only agreed
 *     cases are ever called lawyer-approved;
 *   - ties are broken PESSIMISTICALLY (an irrelevant passage wins a tie), so
 *     a degenerate embedder cannot score by the order the passages were
 *     written in;
 *   - failed cases are counted as failures and kept out of the quality
 *     averages; the report says how many cases each average covers;
 *   - nothing unmeasured is filled in: an unreadable number is null;
 *   - the query is embedded in the form the DENSE LANE embeds it
 *     (denseLaneQueryText, retrieval/hybrid.ts: lower-cased, citations
 *     reduced to the legislation number), so the numbers are for the query
 *     vectors production ranks with; the semantic rerank embeds the query as
 *     written and is not what these numbers measure (the report says so);
 *   - "semantic-only" is ONE predicate (isSemanticOnlyPassage) everywhere:
 *     the scorer, the failed-case counts and the report header agree; it
 *     checks word overlap against BOTH query forms (as written, and the
 *     dense-lane form that is embedded and keyword-searched), so a statute
 *     number the canonicalization injects is never "no shared word";
 *   - the report never names a "winner" and never prints passage text.
 */

import { z } from "zod";
import { dot, l2Normalize } from "../embeddings/vectorCodec.js";
import {
  formatDocumentText,
  formatQueryText,
  PROMPT_STYLES,
  type EmbeddingPromptStyle,
} from "../retrieval/embeddingConfig.js";
import { denseLaneQueryText } from "../retrieval/hybrid.js";
import { EmbeddingCallError, type EmbeddingPort } from "../retrieval/semanticRerank.js";
import {
  cpLength,
  derivationalAlternate,
  foldTurkishCase,
  lexemesMatch,
  stemTurkish,
} from "../retrieval/turkishAnalyzer.js";
import { CASE_GROUP_TR, CASE_GROUPS, caseGroup, type CaseGroup } from "./caseGroups.js";

export const EMBEDDING_CASE_SCHEMA = "collex.embedding.case/v1";
export const EMBEDDING_REPORT_SCHEMA = "collex.embedding.report/v1";
export const RECALL_KS = [1, 3, 5, 10] as const;
export const NDCG_K = 10;
export const HARNESS_CHECK_LABEL = "harness check — not a measurement";
export const MEASUREMENT_LABEL = "measurement";
/** The query form the harness embeds: the dense lane's (denseLaneQueryText). */
export const EMBEDDING_QUERY_FORM = "dense_lane";

/** The product's local server accepts at most 41 inputs; 16 is its batch. */
export const DEFAULT_EMBED_BATCH = 16;
export const DEFAULT_EMBED_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Case format (collex.embedding.case/v1)
// ---------------------------------------------------------------------------

const passageSchema = z
  .object({
    id: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(8000),
    /** 0 unrelated · 1 marginal · 2 relevant · 3 answers the query. */
    relevance: z.number().int().min(0).max(3),
    /** True when the passage shares at least one word (lexeme) with the query. */
    lexicalOverlap: z.boolean(),
  })
  .strict();

export const embeddingCaseSchema = z
  .object({
    schema: z.literal(EMBEDDING_CASE_SCHEMA),
    id: z.string().min(1).max(100),
    query: z.string().trim().min(1).max(2000),
    passages: z.array(passageSchema).min(2).max(200),
    /** synthetic = written by this repository; lawyer_annotated = real gold. */
    source: z.enum(["synthetic", "lawyer_annotated"]),
    annotator: z.string().min(1).max(100).optional(),
    adjudication: z.enum(["pending", "agreed", "disputed"]).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const passage of value.passages) {
      if (seen.has(passage.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate passage id: ${passage.id}`, path: ["passages"] });
      }
      seen.add(passage.id);
    }
    if (!value.passages.some((passage) => passage.relevance > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one passage must have relevance >= 1",
        path: ["passages"],
      });
    }
    if (value.source === "lawyer_annotated") {
      if (value.annotator === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "lawyer_annotated needs annotator", path: ["annotator"] });
      }
      if (value.adjudication === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "lawyer_annotated needs adjudication", path: ["adjudication"] });
      }
    }
  });

export type EmbeddingCase = z.infer<typeof embeddingCaseSchema>;

/** Parse a JSONL file; every bad line is reported with its number and reason. */
export function parseEmbeddingCases(jsonl: string): { cases: EmbeddingCase[]; errors: string[] } {
  const cases: EmbeddingCase[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  jsonl.split(/\r?\n/u).forEach((line, index) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      errors.push(`line ${index + 1}: not JSON`);
      return;
    }
    const parsed = embeddingCaseSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`line ${index + 1}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      return;
    }
    if (ids.has(parsed.data.id)) {
      errors.push(`line ${index + 1}: duplicate case id: ${parsed.data.id}`);
      return;
    }
    ids.add(parsed.data.id);
    cases.push(parsed.data);
  });
  return { cases, errors };
}

// ---------------------------------------------------------------------------
// Lexical-overlap check (the annotator's flag is checked, not trusted)
// ---------------------------------------------------------------------------

/**
 * Light verbs and function words. Sharing "edilmiştir" or "olarak" does not
 * make two sentences lexically related; sharing any CONTENT word does —
 * including frame words such as "hukuk" or "madde", which a lexical search
 * would match, so they are deliberately NOT dropped here.
 */
const IGNORED_STEMS: ReadonlySet<string> = new Set([
  "et", "ed", "edil", "ol", "olma", "olan", "olarak", "olup", "bulun", "yap", "yapıl",
  "ver", "veril", "sayıl", "kıl", "gel", "gir", "al", "alın", "git", "gid", "kal",
  "dur", "bul", "bir", "ile", "için", "gibi", "daha", "sonra", "önce", "kadar",
  "üzere", "ancak", "ilgili", "ilişkin", "göre", "veya", "değil", "ise", "her",
  "hiç", "çok", "bu", "şu", "tüm", "bütün", "herhangi", "arasında", "tarafından",
  "karşı", "ayrıca", "yani", "şey",
]);

function contentLexemes(text: string): string[] {
  const out = new Set<string>();
  for (const token of foldTurkishCase(text).split(/[^\p{L}\p{N}]+/u)) {
    if (token === "") continue;
    const digits = /^\p{N}+$/u.test(token);
    if (digits ? cpLength(token) < 4 : cpLength(token) < 3) continue;
    if (IGNORED_STEMS.has(token)) continue;
    const stem = digits ? token : stemTurkish(token);
    if (IGNORED_STEMS.has(stem)) continue;
    out.add(stem);
    const alternate = digits ? undefined : derivationalAlternate(stem);
    if (alternate !== undefined) out.add(alternate);
  }
  return [...out];
}

/**
 * Do the two texts share a content word, by the product's own Turkish lexeme
 * comparison (`lexemesMatch`)? Conservative on purpose: when in doubt it says
 * "yes", so a passage is never wrongly counted as semantic-only.
 */
export function sharesLexeme(a: string, b: string): boolean {
  const left = contentLexemes(a);
  const right = contentLexemes(b);
  for (const x of left) for (const y of right) if (lexemesMatch(x, y)) return true;
  return false;
}

/**
 * Does the passage share a content word with the query in EITHER form the
 * product searches with: the query as written, or the dense-lane form
 * (denseLaneQueryText: lower-cased, a statute abbreviation or citation
 * reduced to the legislation number, e.g. "TBK" -> "6098"), which is the text
 * embedded AND the text the lexical lane searches. A passage that shares the
 * canonical statute number can be found by keyword search.
 */
export function sharesLexemeWithQuery(query: string, text: string): boolean {
  return sharesLexeme(query, text) || sharesLexeme(denseLaneQueryText(query), text);
}

export interface LexicalFlagWarning {
  readonly caseId: string;
  readonly passageId: string;
  /** flag_false_but_shared_lexeme inflates the semantic-only number; the other is informational. */
  readonly problem: "flag_false_but_shared_lexeme" | "flag_true_but_no_shared_lexeme";
}

export function lexicalFlagWarnings(cases: readonly EmbeddingCase[]): LexicalFlagWarning[] {
  const out: LexicalFlagWarning[] = [];
  for (const testCase of cases) {
    for (const passage of testCase.passages) {
      const shared = sharesLexemeWithQuery(testCase.query, passage.text);
      if (!passage.lexicalOverlap && shared) {
        out.push({ caseId: testCase.id, passageId: passage.id, problem: "flag_false_but_shared_lexeme" });
      } else if (passage.lexicalOverlap && !shared) {
        out.push({ caseId: testCase.id, passageId: passage.id, problem: "flag_true_but_no_shared_lexeme" });
      }
    }
  }
  return out;
}

/**
 * A relevant passage only a meaning-based lane can find: the annotator flags
 * it as sharing no word with the query AND the product's own lexeme matcher
 * agrees, for the query as written and for the dense-lane form the harness
 * embeds (sharesLexemeWithQuery). The ONE predicate behind every
 * semantic-only number in the report (scores, failed-case counts, the header
 * count), so a mis-flagged passage never inflates any of them.
 */
export function isSemanticOnlyPassage(
  testCase: EmbeddingCase,
  passage: EmbeddingCase["passages"][number],
): boolean {
  return passage.relevance > 0 && !passage.lexicalOverlap && !sharesLexemeWithQuery(testCase.query, passage.text);
}

// ---------------------------------------------------------------------------
// Metric math (pure; unit-tested on hand-computed examples)
// ---------------------------------------------------------------------------

/** Share of `relevant` found in the first k of `ranked`; null when nothing is relevant. */
export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number | null {
  if (relevant.size === 0) return null;
  const top = new Set(ranked.slice(0, k));
  let hits = 0;
  for (const id of relevant) if (top.has(id)) hits += 1;
  return hits / relevant.size;
}

/** 1 / (1-based rank of the first relevant id), 0 when none is ranked. */
export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  for (let index = 0; index < ranked.length; index += 1) {
    if (relevant.has(ranked[index] as string)) return 1 / (index + 1);
  }
  return 0;
}

/**
 * Graded nDCG@k: gain = 2^relevance - 1, discount log2(rank + 1). With 0/1
 * relevance this equals the binary nDCG of evals/retrieval/benchmark.py.
 * Null when no passage is relevant (nothing to rank).
 */
export function ndcgAtK(ranked: readonly string[], relevance: ReadonlyMap<string, number>, k: number): number | null {
  const gain = (rel: number): number => 2 ** rel - 1;
  let dcg = 0;
  ranked.slice(0, k).forEach((id, index) => {
    dcg += gain(relevance.get(id) ?? 0) / Math.log2(index + 2);
  });
  const ideal = [...relevance.values()].filter((rel) => rel > 0).sort((a, b) => b - a).slice(0, k);
  if (ideal.length === 0) return null;
  const idcg = ideal.reduce((sum, rel, index) => sum + gain(rel) / Math.log2(index + 2), 0);
  return dcg / idcg;
}

/** Linear-interpolation percentile (numpy's default, as benchmark.py); null on empty. */
export function percentile(values: readonly number[], pct: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0] as number;
  const rank = (pct / 100) * (ordered.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = ordered[low] as number;
  if (low === high) return lowValue;
  return lowValue + ((ordered[high] as number) - lowValue) * (rank - low);
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 4): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

export interface ScoredPassage {
  readonly id: string;
  readonly score: number;
  readonly relevance: number;
}

/**
 * Rank by cosine, highest first. A TIE goes to the LESS relevant passage
 * (then the id), so equal scores never earn credit by passage order.
 */
export function rankPassages(scored: readonly ScoredPassage[]): string[] {
  return [...scored]
    .sort((a, b) => b.score - a.score || a.relevance - b.relevance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => entry.id);
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface MemoryReading {
  /** Resident memory of the embedding process (tree), bytes. */
  readonly rssBytes: number;
  /** Peak resident memory, when the platform reports it. */
  readonly peakBytes: number | null;
  /** How it was read, e.g. "ps rss" or "Windows working set". */
  readonly method: string;
}

export interface EmbeddingProviderUnderTest {
  readonly name: string;
  /** Model identity as configured (never guessed). */
  readonly model: string;
  readonly promptStyle: EmbeddingPromptStyle;
  readonly port: EmbeddingPort;
  /** Reads the embedding process's memory; null or a throw = unmeasurable. */
  readonly memoryProbe?: (() => Promise<MemoryReading | null>) | undefined;
  /** Why memory cannot be read, when there is no probe. */
  readonly memoryUnavailableTr?: string | undefined;
  /** Measured start-up time (process start to ready), when the caller started it. */
  readonly startupMs?: number | null | undefined;
}

type EmbedErrorCode =
  | "EMBEDDING_TIMEOUT"
  | "EMBEDDING_FAILED"
  | "WRONG_COUNT"
  | "INVALID_VECTOR"
  | "DIMENSION_MISMATCH"
  | "UNEXPECTED_ERROR";

class EvalEmbedError extends Error {
  constructor(readonly code: EmbedErrorCode) {
    super(code);
    this.name = "EvalEmbedError";
  }
}

interface CallTiming {
  readonly ms: number;
  readonly texts: number;
  readonly query: boolean;
  readonly failed: boolean;
}

export interface EmbeddingCaseResult {
  readonly caseId: string;
  readonly provider: string;
  /** Where the case's gold comes from: results are summarised per group, never pooled. */
  readonly source: EmbeddingCase["source"];
  readonly adjudication: NonNullable<EmbeddingCase["adjudication"]> | null;
  readonly failed: boolean;
  readonly errorCode?: string | undefined;
  /** Top-10 passage ids (ids only; passage text is never copied into a report). */
  readonly rankedPassageIds: string[];
  readonly recallAt: Record<string, number | null>;
  readonly reciprocalRank: number | null;
  readonly ndcgAt10: number | null;
  /** Null when the case has no relevant passage marked semantic-only. */
  readonly semanticOnlyRecallAt: Record<string, number | null> | null;
  readonly relevantPassages: number;
  readonly semanticOnlyPassages: number;
}

/** Search quality over ONE case group (synthetic / agreed / pending / disputed). */
export interface EmbeddingQualityBlock {
  readonly cases: number;
  readonly casesScored: number;
  readonly failedCases: number;
  readonly metrics: Record<string, number | null>;
  readonly semanticOnlyCasesScored: number;
}

export interface EmbeddingProviderSummary {
  readonly provider: string;
  readonly model: string;
  readonly promptStyle: EmbeddingPromptStyle;
  readonly dimension: number | null;
  /** Operational counts over every case. */
  readonly cases: number;
  readonly casesScored: number;
  readonly failedCases: number;
  readonly failureRate: number;
  readonly calls: number;
  readonly failedCalls: number;
  readonly callFailureRate: number;
  readonly errors: Record<string, number>;
  /**
   * The quality figures, per case group present. No pooled quality figure
   * exists: a mean over synthetic, pending and disputed labels is not a
   * lawyer-gold measurement.
   */
  readonly groups: Partial<Record<CaseGroup, EmbeddingQualityBlock>>;
  readonly latencyMsP50: number | null;
  readonly latencyMsP95: number | null;
  readonly queryLatencyMsP50: number | null;
  readonly queryLatencyMsP95: number | null;
  readonly startupMs: number | null;
  readonly memory: {
    readonly before: MemoryReading;
    readonly after: MemoryReading;
    readonly deltaBytes: number;
  } | null;
  readonly memoryNoteTr: string | null;
}

export interface EmbeddingEvalReport {
  readonly schema: typeof EMBEDDING_REPORT_SCHEMA;
  readonly kind: "measurement" | "harness_check";
  readonly label: typeof MEASUREMENT_LABEL | typeof HARNESS_CHECK_LABEL;
  readonly startedAt: string;
  readonly caseSources: Record<string, number>;
  readonly caseGroups: Partial<Record<CaseGroup, number>>;
  readonly casesTotal: number;
  /** Which query form was embedded (the dense lane's). */
  readonly queryForm: typeof EMBEDDING_QUERY_FORM;
  readonly casesWithSemanticOnlyPassages: number;
  /** Lawyer cases two lawyers agreed on: the only ones ever called lawyer-approved. */
  readonly agreedLawyerCases: number;
  readonly pendingCases: number;
  readonly disputedCases: number;
  readonly environment: Record<string, string> | null;
  readonly providers: EmbeddingProviderSummary[];
  readonly results: EmbeddingCaseResult[];
  readonly lexicalFlagWarnings: LexicalFlagWarning[];
  readonly noticesTr: string[];
}

export interface EmbeddingEvalOptions {
  readonly kind: "measurement" | "harness_check";
  readonly startedAt: string;
  readonly batchSize?: number | undefined;
  readonly timeoutMs?: number | undefined;
  /** Facts about the machine (platform, cpu, runtime); recorded as given. */
  readonly environment?: Record<string, string> | undefined;
}

function errorCode(error: unknown): EmbedErrorCode {
  if (error instanceof EvalEmbedError) return error.code;
  if (error instanceof EmbeddingCallError) return error.reason;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "EMBEDDING_TIMEOUT";
  }
  return "UNEXPECTED_ERROR";
}

class ProviderSession {
  dimension: number | null = null;
  readonly calls: CallTiming[] = [];

  constructor(
    private readonly provider: EmbeddingProviderUnderTest,
    private readonly timeoutMs: number,
  ) {}

  /** One embed call: timed, count/finite/dimension-checked, L2-normalized. */
  async embed(texts: readonly string[], query: boolean): Promise<Float32Array[]> {
    const started = performance.now();
    try {
      const vectors = await this.provider.port.embed(texts, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new EvalEmbedError("WRONG_COUNT");
      const out: Float32Array[] = [];
      for (const vector of vectors) {
        const normalized = Array.isArray(vector) ? l2Normalize(vector as number[]) : undefined;
        if (normalized === undefined) throw new EvalEmbedError("INVALID_VECTOR");
        if (this.dimension === null) this.dimension = normalized.length;
        else if (normalized.length !== this.dimension) throw new EvalEmbedError("DIMENSION_MISMATCH");
        out.push(normalized);
      }
      this.calls.push({ ms: performance.now() - started, texts: texts.length, query, failed: false });
      return out;
    } catch (error) {
      this.calls.push({ ms: performance.now() - started, texts: texts.length, query, failed: true });
      throw error;
    }
  }
}

function scoreRanking(
  testCase: EmbeddingCase,
  ranked: readonly string[],
): Omit<EmbeddingCaseResult, "caseId" | "provider" | "source" | "adjudication" | "failed"> {
  const relevant = new Set(testCase.passages.filter((p) => p.relevance > 0).map((p) => p.id));
  // Semantic-only needs BOTH the annotator's flag and the product's own
  // lexeme matcher: a mis-flagged passage never inflates the number.
  const semanticOnly = new Set(testCase.passages.filter((p) => isSemanticOnlyPassage(testCase, p)).map((p) => p.id));
  const relevance = new Map(testCase.passages.map((p) => [p.id, p.relevance]));
  const recallAt: Record<string, number | null> = {};
  for (const k of RECALL_KS) recallAt[String(k)] = recallAtK(ranked, relevant, k);
  let semanticOnlyRecallAt: Record<string, number | null> | null = null;
  if (semanticOnly.size > 0) {
    semanticOnlyRecallAt = {};
    for (const k of RECALL_KS) semanticOnlyRecallAt[String(k)] = recallAtK(ranked, semanticOnly, k);
  }
  return {
    rankedPassageIds: ranked.slice(0, 10),
    recallAt,
    reciprocalRank: reciprocalRank(ranked, relevant),
    ndcgAt10: ndcgAtK(ranked, relevance, NDCG_K),
    semanticOnlyRecallAt,
    relevantPassages: relevant.size,
    semanticOnlyPassages: semanticOnly.size,
  };
}

async function runCase(
  session: ProviderSession,
  provider: EmbeddingProviderUnderTest,
  testCase: EmbeddingCase,
  batchSize: number,
): Promise<EmbeddingCaseResult> {
  const base = {
    caseId: testCase.id,
    provider: provider.name,
    source: testCase.source,
    adjudication: testCase.adjudication ?? null,
  };
  try {
    // The dense lane embeds the normalized, citation-canonicalized query
    // (searchPipeline -> denseLane.search(laneQuery)); so does the eval.
    const [queryVector] = await session.embed(
      [formatQueryText(provider.promptStyle, denseLaneQueryText(testCase.query))],
      true,
    );
    const passageVectors: Float32Array[] = [];
    for (let start = 0; start < testCase.passages.length; start += batchSize) {
      const batch = testCase.passages.slice(start, start + batchSize);
      passageVectors.push(
        ...(await session.embed(batch.map((p) => formatDocumentText(provider.promptStyle, p.text)), false)),
      );
    }
    const scored = testCase.passages.map((passage, index) => ({
      id: passage.id,
      relevance: passage.relevance,
      score: dot(queryVector as Float32Array, passageVectors[index] as Float32Array),
    }));
    return { ...base, failed: false, ...scoreRanking(testCase, rankPassages(scored)) };
  } catch (error) {
    const empty: Record<string, number | null> = {};
    for (const k of RECALL_KS) empty[String(k)] = null;
    return {
      ...base,
      failed: true,
      errorCode: errorCode(error),
      rankedPassageIds: [],
      recallAt: empty,
      reciprocalRank: null,
      ndcgAt10: null,
      semanticOnlyRecallAt: null,
      relevantPassages: testCase.passages.filter((p) => p.relevance > 0).length,
      semanticOnlyPassages: testCase.passages.filter((p) => isSemanticOnlyPassage(testCase, p)).length,
    };
  }
}

async function readMemory(provider: EmbeddingProviderUnderTest): Promise<MemoryReading | null> {
  if (provider.memoryProbe === undefined) return null;
  try {
    const reading = await provider.memoryProbe();
    if (reading === null || !Number.isFinite(reading.rssBytes) || reading.rssBytes <= 0) return null;
    return reading;
  } catch {
    return null;
  }
}

/** R@K, MRR, nDCG and semantic-only R@K over the answered cases of ONE group. */
function qualityBlock(results: readonly EmbeddingCaseResult[]): EmbeddingQualityBlock {
  const scored = results.filter((result) => !result.failed);
  const withSemantic = scored.filter((result) => result.semanticOnlyRecallAt !== null);
  const metrics: Record<string, number | null> = {};
  for (const k of RECALL_KS) {
    metrics[`recallAt${k}`] = round(mean(scored.map((r) => r.recallAt[String(k)] as number)));
  }
  metrics["mrr"] = round(mean(scored.map((r) => r.reciprocalRank as number)));
  metrics["ndcgAt10"] = round(mean(scored.map((r) => r.ndcgAt10 as number)));
  for (const k of RECALL_KS) {
    metrics[`semanticOnlyRecallAt${k}`] = round(
      mean(withSemantic.map((r) => (r.semanticOnlyRecallAt as Record<string, number>)[String(k)] as number)),
    );
  }
  return {
    cases: results.length,
    casesScored: scored.length,
    failedCases: results.length - scored.length,
    metrics,
    semanticOnlyCasesScored: withSemantic.length,
  };
}

function summarize(
  provider: EmbeddingProviderUnderTest,
  session: ProviderSession,
  mine: readonly EmbeddingCaseResult[],
  memory: EmbeddingProviderSummary["memory"],
  memoryNoteTr: string | null,
): EmbeddingProviderSummary {
  const scored = mine.filter((result) => !result.failed);
  const groups: Partial<Record<CaseGroup, EmbeddingQualityBlock>> = {};
  for (const group of CASE_GROUPS) {
    const inGroup = mine.filter((result) => caseGroup(result) === group);
    if (inGroup.length > 0) groups[group] = qualityBlock(inGroup);
  }
  const errors: Record<string, number> = {};
  for (const result of mine) {
    if (result.errorCode !== undefined) errors[result.errorCode] = (errors[result.errorCode] ?? 0) + 1;
  }
  const okCalls = session.calls.filter((call) => !call.failed);
  const failedCalls = session.calls.length - okCalls.length;
  const ms = (calls: readonly CallTiming[], pct: number): number | null =>
    round(percentile(calls.map((call) => call.ms), pct), 1);
  return {
    provider: provider.name,
    model: provider.model,
    promptStyle: provider.promptStyle,
    dimension: session.dimension,
    cases: mine.length,
    casesScored: scored.length,
    failedCases: mine.length - scored.length,
    failureRate: round((mine.length - scored.length) / Math.max(1, mine.length)) as number,
    calls: session.calls.length,
    failedCalls,
    callFailureRate: round(failedCalls / Math.max(1, session.calls.length)) as number,
    errors,
    groups,
    latencyMsP50: ms(okCalls, 50),
    latencyMsP95: ms(okCalls, 95),
    queryLatencyMsP50: ms(okCalls.filter((call) => call.query), 50),
    queryLatencyMsP95: ms(okCalls.filter((call) => call.query), 95),
    startupMs: provider.startupMs ?? null,
    memory,
    memoryNoteTr,
  };
}

/**
 * Run every case through every provider, one provider and one call at a
 * time: the product's local server serves one request at a time (it answers
 * 429 when busy), and concurrency would measure queueing, not the model.
 */
export async function runEmbeddingEval(
  cases: readonly EmbeddingCase[],
  providers: readonly EmbeddingProviderUnderTest[],
  options: EmbeddingEvalOptions,
): Promise<EmbeddingEvalReport> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_EMBED_BATCH, 41));
  const timeoutMs = options.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const results: EmbeddingCaseResult[] = [];
  const summaries: EmbeddingProviderSummary[] = [];
  for (const provider of providers) {
    if (!PROMPT_STYLES.includes(provider.promptStyle)) throw new Error(`unknown prompt style: ${provider.promptStyle}`);
    const session = new ProviderSession(provider, timeoutMs);
    const before = await readMemory(provider);
    const mine: EmbeddingCaseResult[] = [];
    for (const testCase of cases) mine.push(await runCase(session, provider, testCase, batchSize));
    const after = before === null ? null : await readMemory(provider);
    results.push(...mine);
    let memory: EmbeddingProviderSummary["memory"] = null;
    let memoryNoteTr: string | null = null;
    if (before !== null && after !== null) {
      memory = { before, after, deltaBytes: after.rssBytes - before.rssBytes };
    } else {
      memoryNoteTr =
        provider.memoryUnavailableTr ??
        (provider.memoryProbe === undefined
          ? "Bellek ölçülmedi: gömme işlemini yapan süreç bu düzenekten okunamıyor."
          : "Bellek ölçülemedi: süreç belleği okunamadı; tahmin yazılmadı.");
    }
    summaries.push(summarize(provider, session, mine, memory, memoryNoteTr));
  }

  const caseSources: Record<string, number> = {};
  const caseGroups: Partial<Record<CaseGroup, number>> = {};
  for (const testCase of cases) {
    caseSources[testCase.source] = (caseSources[testCase.source] ?? 0) + 1;
    const group = caseGroup(testCase);
    caseGroups[group] = (caseGroups[group] ?? 0) + 1;
  }
  const warnings = lexicalFlagWarnings(cases);
  const synthetic = caseSources["synthetic"] ?? 0;
  const lawyer = caseSources["lawyer_annotated"] ?? 0;
  const agreed = caseGroups["lawyer_agreed"] ?? 0;
  const pending = caseGroups["lawyer_pending"] ?? 0;
  const disputed = caseGroups["lawyer_disputed"] ?? 0;
  const semanticCases = cases.filter((testCase) =>
    testCase.passages.some((p) => isSemanticOnlyPassage(testCase, p)),
  ).length;

  const noticesTr: string[] = [];
  if (options.kind === "harness_check") {
    noticesTr.push(
      `Bu bir ÖLÇÜM DEĞİLDİR (${HARNESS_CHECK_LABEL}): sağlayıcılar betikli, deterministik bir sahte gömücüyle` +
        " çalıştırıldı; yalnız düzeneğin çalıştığını gösterir.",
    );
  }
  if (lawyer === 0) {
    noticesTr.push(
      "Vakaların tamamı sentetiktir; arama kalitesi hakkında hüküm için avukat onaylı vakalar gerekir" +
        " (evals/embeddings/CASE_FORMAT.md).",
    );
  } else if (agreed === 0) {
    noticesTr.push(
      "Avukatların üzerinde birleştiği (agreed) vaka yok; bu sayılar avukat onaylı bir ölçüm değildir. Arama" +
        " kalitesi hakkında hüküm için iki avukatın aynı etikette birleştiği vakalar gerekir" +
        " (evals/embeddings/CASE_FORMAT.md).",
    );
  }
  if (synthetic > 0 && lawyer > 0) {
    noticesTr.push(
      `Vakaların ${synthetic} tanesi sentetik, ${lawyer} tanesi avukat vakasıdır (${agreed} tanesi avukat onaylı);` +
        " ölçütler her grup için ayrı gösterilir ve birlikte okunmamalıdır.",
    );
  }
  if (pending > 0) {
    noticesTr.push(`${pending} avukat vakası henüz karara bağlanmadı (pending); ayrı gösterilir, avukat onaylı ölçütlere katılmadı.`);
  }
  if (disputed > 0) {
    noticesTr.push(
      `${disputed} vaka için avukatlar aynı etikette birleşmedi (disputed); ayrı gösterilir, avukat onaylı` +
        " ölçütlere katılmadı.",
    );
  }
  // A case with <= K passages puts every passage in the top K: its R@K is 1
  // whatever the model does. Say so instead of letting it look like quality.
  const shortCases = cases.filter((testCase) => testCase.passages.length <= NDCG_K).length;
  if (shortCases > 0) {
    noticesTr.push(
      `${shortCases} vakada en çok ${NDCG_K} pasaj var: bu vakalarda R@10 kendiliğinden 1 olur (pasaj sayısı K'yı` +
        " geçmeyen her R@K için de aynısı geçerlidir); sıralama kalitesi için R@1, R@3, MRR ve nDCG@10'a bakın.",
    );
  }
  if (warnings.some((warning) => warning.problem === "flag_false_but_shared_lexeme")) {
    noticesTr.push(
      "Bazı pasajlar 'ortak kelime yok' diye işaretlenmiş ama sorguyla ortak kelime taşıyor;" +
        " bu pasajlar 'yalnız anlamla bulunan' ölçütüne sayılmadı; işaretleri düzeltin (lexicalFlagWarnings).",
    );
  }
  if (summaries.some((summary) => summary.failedCases > 0)) {
    noticesTr.push(
      "Başarısız vakalar kalite ortalamalarına katılmadı; her sağlayıcının kaç vaka üzerinden ölçüldüğü" +
        " ayrıca yazılıdır.",
    );
  }
  noticesTr.push("Rapor kazanan seçmez; her ölçüt ayrı gösterilir ve karar bu ölçümlere bakan kişinindir.");

  return {
    schema: EMBEDDING_REPORT_SCHEMA,
    kind: options.kind,
    label: options.kind === "harness_check" ? HARNESS_CHECK_LABEL : MEASUREMENT_LABEL,
    startedAt: options.startedAt,
    caseSources,
    caseGroups,
    casesTotal: cases.length,
    queryForm: EMBEDDING_QUERY_FORM,
    casesWithSemanticOnlyPassages: semanticCases,
    agreedLawyerCases: agreed,
    pendingCases: pending,
    disputedCases: disputed,
    environment: options.environment ?? null,
    providers: summaries,
    results,
    lexicalFlagWarnings: warnings,
    noticesTr,
  };
}

// ---------------------------------------------------------------------------
// Deterministic scripted embedders (dry run / tests only)
// ---------------------------------------------------------------------------

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A deterministic, NETWORK-FREE embedder for the harness check: hashed bag of
 * folded words ("words") or of character trigrams ("trigrams"). It knows no
 * meaning, so its semantic-only recall is expected to be poor — which is the
 * point of labelling a dry run "not a measurement".
 */
export function scriptedEmbeddingPort(kind: "words" | "trigrams", dimension = 64): EmbeddingPort {
  return {
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dimension).fill(0);
        vector[dimension - 1] = 0.01; // never a zero vector
        const body = foldTurkishCase(text.replace(/^(query|passage):\s*/u, ""));
        const features: string[] = [];
        if (kind === "words") {
          for (const token of body.split(/[^\p{L}\p{N}]+/u)) if (token !== "") features.push(token);
        } else {
          const compact = ` ${body.replace(/\s+/gu, " ").trim()} `;
          for (let i = 0; i + 3 <= compact.length; i += 1) features.push(compact.slice(i, i + 3));
        }
        for (const feature of features) vector[fnv1a(feature) % (dimension - 1)] += 1;
        return vector;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function fmt(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function mib(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "—" : (bytes / (1024 * 1024)).toFixed(1);
}

export function renderEmbeddingEvalMarkdown(report: EmbeddingEvalReport): string {
  const title =
    report.kind === "measurement" ? "ölçüm" : `düzenek denetimi — ölçüm değil / ${HARNESS_CHECK_LABEL}`;
  const groupsPresent = CASE_GROUPS.filter((group) => (report.caseGroups[group] ?? 0) > 0);
  const qualityTables = groupsPresent.flatMap((group) => {
    const rows = report.providers.flatMap((p) => {
      const block = p.groups[group];
      return block === undefined ? [] : [{ p, block }];
    });
    return [
      `## Arama kalitesi — ${CASE_GROUP_TR[group]} (cevaplanan vakalar üzerinden)`,
      "",
      "| Sağlayıcı | Model | Biçim | Boyut | Ölçülen vaka | R@1 | R@3 | R@5 | R@10 | MRR | nDCG@10 |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      ...rows.map(
        ({ p, block }) =>
          `| ${p.provider} | ${p.model} | ${p.promptStyle} | ${p.dimension ?? "—"} | ${block.casesScored}/${block.cases}` +
          ` | ${fmt(block.metrics["recallAt1"])} | ${fmt(block.metrics["recallAt3"])} | ${fmt(block.metrics["recallAt5"])}` +
          ` | ${fmt(block.metrics["recallAt10"])} | ${fmt(block.metrics["mrr"])} | ${fmt(block.metrics["ndcgAt10"])} |`,
      ),
      "",
      `## Yalnız anlamla bulunabilen pasajlar — ${CASE_GROUP_TR[group]} (sorguyla ortak kelimesi yok)`,
      "",
      "| Sağlayıcı | Ölçülen vaka | R@1 | R@3 | R@5 | R@10 |",
      "|---|---|---|---|---|---|",
      ...rows.map(
        ({ p, block }) =>
          `| ${p.provider} | ${block.semanticOnlyCasesScored} | ${fmt(block.metrics["semanticOnlyRecallAt1"])}` +
          ` | ${fmt(block.metrics["semanticOnlyRecallAt3"])} | ${fmt(block.metrics["semanticOnlyRecallAt5"])}` +
          ` | ${fmt(block.metrics["semanticOnlyRecallAt10"])} |`,
      ),
      "",
    ];
  });
  const lines = [
    `# Gömme (embedding) sağlayıcı karşılaştırması (${title})`,
    "",
    `Başlangıç: ${report.startedAt} · vakalar: ${Object.entries(report.caseSources).map(([k, v]) => `${k} ${v}`).join(", ")}` +
      ` · gruplar: ${groupsPresent.map((group) => `${CASE_GROUP_TR[group]} ${report.caseGroups[group]}`).join(", ")}` +
      ` · ortak kelimesi olmayan ilgili pasaj içeren vaka: ${report.casesWithSemanticOnlyPassages}`,
    "",
    "Sorgu biçimi: ürünün anlam (yoğun) şeridinin gömdüğü biçim — küçük harfe çevrilmiş, mevzuat atfı kanun" +
      " numarasına indirgenmiş. Anlamsal yeniden sıralama sorguyu yazıldığı gibi gömer; bu sayılar onu ölçmez.",
    ...(report.environment === null
      ? []
      : ["", `Ortam: ${Object.entries(report.environment).map(([k, v]) => `${k}=${v}`).join(" · ")}`]),
    "",
    ...report.noticesTr.map((notice) => `> ${notice}`),
    "",
    ...qualityTables,
    "## İşletim",
    "",
    "| Sağlayıcı | Başarısız vaka | Başarısız çağrı | Çağrı | p50 ms | p95 ms | Sorgu p50 ms | Sorgu p95 ms | Açılış ms | Bellek önce MiB | Bellek sonra MiB | Fark MiB | En yüksek MiB |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...report.providers.map(
      (p) =>
        `| ${p.provider} | ${fmt(p.failureRate)} | ${fmt(p.callFailureRate)} | ${p.calls} | ${fmt(p.latencyMsP50, 1)}` +
        ` | ${fmt(p.latencyMsP95, 1)} | ${fmt(p.queryLatencyMsP50, 1)} | ${fmt(p.queryLatencyMsP95, 1)}` +
        ` | ${p.startupMs === null ? "—" : Math.round(p.startupMs)} | ${mib(p.memory?.before.rssBytes)}` +
        ` | ${mib(p.memory?.after.rssBytes)} | ${p.memory === null ? "—" : mib(p.memory.deltaBytes)}` +
        ` | ${mib(p.memory?.after.peakBytes)} |`,
    ),
    "",
    ...report.providers
      .filter((p) => p.memoryNoteTr !== null || Object.keys(p.errors).length > 0)
      .map(
        (p) =>
          `- ${p.provider}: ${p.memoryNoteTr ?? ""}` +
          (Object.keys(p.errors).length > 0
            ? ` Hata kodları: ${Object.entries(p.errors).map(([code, n]) => `${code} ${n}`).join(", ")}.`
            : ""),
      ),
    "",
  ];
  return lines.join("\n");
}
