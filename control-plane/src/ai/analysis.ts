/**
 * Document analysis (POST /v1/ai/analyze-document) — the verification half.
 *
 * The model returns, for every finding, one or more {chunkId, quote}
 * pointers. NOTHING the model says is trusted as sourced until the server
 * has checked that the quote is an EXACT substring of that chunk's text:
 *
 *  - both sides are NFC-normalized (ADR-003 canonical form);
 *  - the match is exact — no whitespace folding, no fuzzy matching — because
 *    a quote that is not literally in the document is not a citation;
 *  - offsets are reported in Unicode CODE POINTS (never .length/.slice code
 *    units), relative to the chunk and, via chunk.startChar, to the file;
 *  - an unverifiable finding is NEVER dropped: it stays in its list with
 *    `kaynakli:false` and is counted in `kaynaksizCount`, so the lawyer sees
 *    exactly what the model asserted without backing.
 *
 * Token budget guard: chunks are admitted in ordinal order until the
 * estimated input budget is reached; a chunk is never cut in the middle, and
 * the drop is reported as a warning.
 */

import { codePointLength } from "../verification/validator.js";
import type {
  AnalyzeFocus,
  AnthropicUsage,
  RawAnalysisItem,
  RawDocumentAnalysis,
} from "../llm/anthropicAdapter.js";
import type { AiFileChunk } from "./types.js";

export const DOCUMENT_ANALYSIS_SCHEMA = "collex.ai.document-analysis/v1" as const;

export const ANALYSIS_DISCLAIMER =
  "Bu analiz bulut yapay zekâ (Anthropic) çıktısıdır; yalnızca belge metniyle birebir " +
  "doğrulanan alıntılar kaynaklı sayılır, doğrulanamayan tespitler 'kaynaksız' işaretlenir. " +
  "Avukat incelemesi zorunludur; hukukî işlem için tek başına kullanılamaz.";

/**
 * Conservative estimate: Turkish legal text tokenizes at roughly 2.5–3
 * characters per token; dividing by 2.5 over-estimates, which is the safe
 * direction for a budget guard.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 2.5;

/** Input budget left for document chunks (well under the model context). */
export const ANALYSIS_TOKEN_BUDGET = 120_000;

export function estimateTokens(text: string): number {
  return Math.ceil(codePointLength(text) / CHARS_PER_TOKEN_ESTIMATE);
}

export interface ChunkSelection<T> {
  selected: T[];
  dropped: T[];
  warnings: string[];
  estimatedTokens: number;
}

/**
 * Admit chunks (in ordinal order) while the running estimate stays within
 * the budget. The first chunk is always admitted so a single oversized
 * chunk still produces an analysis (with a warning) rather than nothing.
 */
export function selectChunksWithinBudget<T extends { text: string; ordinal: number }>(
  chunks: readonly T[],
  budget: number = ANALYSIS_TOKEN_BUDGET,
): ChunkSelection<T> {
  const ordered = [...chunks].sort((a, b) => a.ordinal - b.ordinal);
  const selected: T[] = [];
  const dropped: T[] = [];
  let total = 0;
  for (const chunk of ordered) {
    const cost = estimateTokens(chunk.text);
    if (selected.length > 0 && total + cost > budget) {
      dropped.push(chunk);
      continue;
    }
    selected.push(chunk);
    total += cost;
  }
  const warnings: string[] = [];
  if (dropped.length > 0) {
    warnings.push(
      `Belge token bütçesini aşıyor: ${ordered.length} parçadan ${selected.length} tanesi ` +
        `analiz edildi; ${dropped.length} parça analize dahil EDİLMEDİ (parça sınırında kesildi, ` +
        "parça ortasından kesilmedi). Analiz belgenin tamamını kapsamaz.",
    );
  }
  if (selected.length === 1 && total > budget) {
    warnings.push(
      "Tek bir parça bile token bütçesini aşıyor; analiz denendi ama model girdisi kesilmiş olabilir.",
    );
  }
  return { selected, dropped, warnings, estimatedTokens: total };
}

export interface QuoteCheck {
  verified: boolean;
  /** Code-point offsets INSIDE the chunk's NFC text (inclusive/exclusive). */
  startChar?: number;
  endChar?: number;
}

/**
 * Exact, code-point-aware substring check of `quote` inside `chunkText`.
 * Both are NFC-normalized first. Returns code-point offsets of the first
 * occurrence. An empty or whitespace-only quote never verifies.
 */
export function verifyQuote(chunkText: string, quote: string): QuoteCheck {
  const haystack = chunkText.normalize("NFC");
  const needle = quote.normalize("NFC");
  if (needle.trim() === "") return { verified: false };
  const unitIndex = haystack.indexOf(needle);
  if (unitIndex === -1) return { verified: false };
  // Convert the UTF-16 unit index to a code-point index: count the code
  // points of the prefix (never `.length` on canonical text — ADR-003).
  const startChar = codePointLength(haystack.slice(0, unitIndex));
  const endChar = startChar + codePointLength(needle);
  return { verified: true, startChar, endChar };
}

/* ------------------------------ wire shape ------------------------------ */

export interface AnalysisEvidence {
  chunkId: string;
  quote: string;
  /** true only when the quote is an exact substring of the chunk's text. */
  dogrulandi: boolean;
  /** Code-point offsets into the FILE's canonical text (chunk.startChar + local). */
  startChar?: number;
  endChar?: number;
}

export interface AnalysisItem {
  text: string;
  evidence: AnalysisEvidence[];
  /** true iff at least one pointer exists AND every pointer verified. */
  kaynakli: boolean;
}

export interface VerifiedAnalysisLists {
  ozet: string;
  taraflar: AnalysisItem[];
  talepler: AnalysisItem[];
  dayanaklar: AnalysisItem[];
  tarihler: AnalysisItem[];
  riskler: AnalysisItem[];
  eksikler: AnalysisItem[];
  karsiArgumanlar: AnalysisItem[];
  /** Present only for the sözleşme focus (clause-level risk). */
  maddeler?: AnalysisItem[];
  kaynaksizCount: number;
  /** Total number of findings across every list. */
  itemCount: number;
}

export interface DocumentAnalysisBody extends VerifiedAnalysisLists {
  schema: typeof DOCUMENT_ANALYSIS_SCHEMA;
  fileId: string;
  fileName: string;
  focus: AnalyzeFocus;
  model: string;
  /** Chunks sent to the model / chunks the file has. */
  chunksAnalyzed: number;
  chunksTotal: number;
  warnings: string[];
  disclaimer: string;
  usage: AnthropicUsage;
  /** Honesty marker mirrored from /v1/ai/status. */
  liveTested: false;
  /**
   * Additive (W14 B-23). Which masking choice produced this analysis:
   * `mask` = client identifiers and party names were replaced before the
   * text left the machine; `as-is` = the lawyer explicitly chose
   * "Maskelemeden gönder" and the document went out as written. (`preview`
   * never reaches this body — it returns without sending anything.)
   */
  maskMode?: "mask" | "as-is";
  /** Additive (W14 B-23): counts of what masking replaced, for the header. */
  masked?: { kind: string; label: string; count: number }[];
}

const LIST_KEYS = [
  "taraflar",
  "talepler",
  "dayanaklar",
  "tarihler",
  "riskler",
  "eksikler",
  "karsiArgumanlar",
] as const;

function verifyItem(item: RawAnalysisItem, chunksById: ReadonlyMap<string, AiFileChunk>): AnalysisItem {
  const evidence: AnalysisEvidence[] = item.evidence.map((pointer) => {
    const chunk = chunksById.get(pointer.chunkId);
    if (chunk === undefined) {
      return { chunkId: pointer.chunkId, quote: pointer.quote, dogrulandi: false };
    }
    const check = verifyQuote(chunk.text, pointer.quote);
    if (!check.verified || check.startChar === undefined || check.endChar === undefined) {
      return { chunkId: pointer.chunkId, quote: pointer.quote, dogrulandi: false };
    }
    return {
      chunkId: pointer.chunkId,
      quote: pointer.quote,
      dogrulandi: true,
      startChar: chunk.startChar + check.startChar,
      endChar: chunk.startChar + check.endChar,
    };
  });
  const kaynakli = evidence.length > 0 && evidence.every((pointer) => pointer.dogrulandi);
  return { text: item.text, evidence, kaynakli };
}

/**
 * Verify every pointer of every finding against the chunks that were sent
 * to the model. Findings are kept in place; `kaynakli` and
 * `kaynaksizCount` carry the verdict.
 */
export function verifyAnalysis(
  raw: RawDocumentAnalysis,
  chunks: readonly AiFileChunk[],
  focus: AnalyzeFocus,
): VerifiedAnalysisLists {
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  let kaynaksizCount = 0;
  let itemCount = 0;
  const verifyList = (items: RawAnalysisItem[]): AnalysisItem[] =>
    items.map((item) => {
      const verified = verifyItem(item, chunksById);
      itemCount += 1;
      if (!verified.kaynakli) kaynaksizCount += 1;
      return verified;
    });

  const lists = {
    taraflar: [] as AnalysisItem[],
    talepler: [] as AnalysisItem[],
    dayanaklar: [] as AnalysisItem[],
    tarihler: [] as AnalysisItem[],
    riskler: [] as AnalysisItem[],
    eksikler: [] as AnalysisItem[],
    karsiArgumanlar: [] as AnalysisItem[],
  };
  for (const key of LIST_KEYS) lists[key] = verifyList(raw[key]);

  const maddeler = focus === "sozlesme" ? verifyList(raw.maddeler) : undefined;

  return {
    ozet: raw.ozet,
    ...lists,
    ...(maddeler !== undefined ? { maddeler } : {}),
    kaynaksizCount,
    itemCount,
  };
}
