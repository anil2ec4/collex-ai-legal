/**
 * Proposition extraction: turning a unit of text into comparable statements.
 *
 * Why propositions and not "find the contradictions"
 * --------------------------------------------------
 * Asking a model once to "find contradictions in these 900 pages" cannot
 * work: the pages do not fit, and the answer is unauditable even when it is
 * right. So the work is split. THIS module extracts NORMALIZED PROPOSITIONS
 * — "the payment was 45 000 TL", "the notice was served on 2024-03-11" —
 * each pinned to the exact span it came from. `contradictions.ts` then
 * compares propositions that are ABOUT THE SAME THING. The comparison is a
 * table a reviewer can read, not a model's opinion.
 *
 * Deterministic first
 * -------------------
 * The extractor here uses patterns, not a model, for the three value kinds
 * that carry most factual disagreement in a Turkish litigation file: dates,
 * money amounts and ratios. That means the contradiction engine works with
 * NO model configured, is fully testable, and produces identical output on
 * every run. `intake/analysis.py` already proved these patterns on real
 * petitions; this is the same idea on the TypeScript side, kept separate
 * because it must run per analysis unit rather than per document.
 *
 * A model may ADD propositions later (see the model-assisted extractor) but
 * never replaces these, and never edits the span or the quote.
 *
 * What a "subject" is, honestly
 * -----------------------------
 * Deriving a real grammatical subject from Turkish free text is not
 * something patterns can do. So the subject here is explicitly a TOPIC KEY:
 * the significant word stems around the value. Two propositions are
 * comparable when their topic keys overlap enough. This is a heuristic and
 * is labelled as one everywhere it surfaces — it decides what gets COMPARED,
 * never what gets ASSERTED.
 */

import { createHash } from "node:crypto";
import { foldTurkishCase, stemTurkish, STOP_STEMS } from "../retrieval/turkishAnalyzer.js";

/** What kind of value a proposition carries. */
export type PropositionKind = "date" | "amount" | "ratio";

export interface PropositionDraft {
  readonly kind: PropositionKind;
  /** The sentence the value sits in, trimmed. Shown to the reader. */
  readonly statement: string;
  /** Topic key: significant stems around the value, sorted and joined. */
  readonly subject: string;
  /** The predicate this value answers, e.g. "tarih" / "tutar" / "oran". */
  readonly predicate: string;
  /** Canonical comparable form: ISO date, integer minor units, or per-mille. */
  readonly normalizedValue: string;
  /** ISO date when `kind === "date"`. */
  readonly occurredOn?: string;
  readonly datePrecision?: "exact" | "month" | "year" | "approximate";
  /** Code-point offsets of the QUOTE within the unit text. */
  readonly startChar: number;
  readonly endChar: number;
  readonly quote: string;
}

/** Version of these rules; stored on every row so a change invalidates reuse. */
export const EXTRACTOR_VERSION = "extract-v1";

/** How many characters around a value become its quote. */
const QUOTE_RADIUS = 160;

/** How many stems form a topic key. */
const SUBJECT_STEMS = 6;

const NUMERIC_DATE =
  /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/gu;

const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
};

const LONG_DATE =
  /\b(\d{1,2})\s+([A-Za-zÇĞİIÖŞÜçğıiöşü]+)\s+(\d{4})\b/gu;

/** "45.000,50 TL" / "45000 TL" / "1.200,00 Türk Lirası". */
const AMOUNT =
  /\b(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(TL|₺|Türk\s+Lirası)\b/giu;

/** "%80", "80 %", "yüzde 80" — fault ratios and shares. */
const RATIO =
  /(?:%\s*(\d{1,3}(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,]\d{1,2})?)\s*%|yüzde\s+(\d{1,3}(?:[.,]\d{1,2})?))/giu;

function codePointsBefore(text: string, utf16Index: number): number {
  let count = 0;
  for (let i = 0; i < utf16Index; ) {
    const point = text.codePointAt(i);
    if (point === undefined) break;
    i += point > 0xffff ? 2 : 1;
    count += 1;
  }
  return count;
}

function sliceQuote(text: string, at: number, length: number): {
  quote: string;
  startChar: number;
  endChar: number;
} {
  const from = Math.max(0, at - QUOTE_RADIUS);
  const to = Math.min(text.length, at + length + QUOTE_RADIUS);
  // Trim to whole words so the quote reads as language, not as a cut string.
  let start = from;
  let end = to;
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at + length) end = space;
  }
  // Trim FIRST, then measure. Measuring the start before trimming and the
  // length after left the range shifted by however much leading whitespace
  // was removed, so the stored [start, end) did not slice back to the quote
  // — and a citation whose offsets do not reproduce its own text is worse
  // than no citation.
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const quote = raw.trim();
  const startChar = codePointsBefore(text, start + leading);
  return {
    quote,
    startChar,
    endChar: startChar + [...quote].length,
  };
}

/**
 * The significant stems around a value — the topic key.
 *
 * Stopword stems are dropped and numbers are excluded (the value itself must
 * not become part of what makes two propositions comparable, or two
 * different amounts would never be compared). Sorted so the key does not
 * depend on word order.
 */
export function subjectKey(context: string): string {
  const stems: string[] = [];
  for (const raw of foldTurkishCase(context).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3) continue;
    if (/\d/u.test(raw)) continue;
    const stem = stemTurkish(raw);
    if (stem.length < 3) continue;
    if (STOP_STEMS.has(stem)) continue;
    if (!stems.includes(stem)) stems.push(stem);
  }
  return stems.sort().slice(0, SUBJECT_STEMS).join(" ");
}

function isoOrUndefined(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Money to integer kuruş, so "45.000" and "45000,00" compare equal. */
function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/\./gu, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return raw;
  return String(Math.round(value * 100));
}

/** Ratio to per-mille integers, so "80" and "80,0" compare equal. */
function normalizeRatio(raw: string): string {
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) return raw;
  return String(Math.round(value * 10));
}

/**
 * Extract every deterministic proposition from one unit of text.
 *
 * Offsets are code points WITHIN `unitText`; the caller rebases them onto the
 * document version. The quote is returned verbatim so its hash can be
 * verified against canonical text like any other citation.
 */
export function extractPropositions(unitText: string): PropositionDraft[] {
  const out: PropositionDraft[] = [];
  const seen = new Set<string>();

  const push = (draft: PropositionDraft): void => {
    const key = `${draft.kind}|${draft.subject}|${draft.normalizedValue}|${draft.startChar}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(draft);
  };

  for (const match of unitText.matchAll(NUMERIC_DATE)) {
    const at = match.index ?? 0;
    const iso = isoOrUndefined(
      Number(match[3]),
      Number(match[2]),
      Number(match[1]),
    );
    if (iso === undefined) continue;
    const { quote, startChar, endChar } = sliceQuote(unitText, at, match[0].length);
    push({
      kind: "date",
      statement: quote,
      subject: subjectKey(quote),
      predicate: "tarih",
      normalizedValue: iso,
      occurredOn: iso,
      datePrecision: "exact",
      startChar,
      endChar,
      quote,
    });
  }

  for (const match of unitText.matchAll(LONG_DATE)) {
    const at = match.index ?? 0;
    const month = TR_MONTHS[foldTurkishCase(match[2] ?? "")];
    if (month === undefined) continue;
    const iso = isoOrUndefined(Number(match[3]), month, Number(match[1]));
    if (iso === undefined) continue;
    const { quote, startChar, endChar } = sliceQuote(unitText, at, match[0].length);
    push({
      kind: "date",
      statement: quote,
      subject: subjectKey(quote),
      predicate: "tarih",
      normalizedValue: iso,
      occurredOn: iso,
      datePrecision: "exact",
      startChar,
      endChar,
      quote,
    });
  }

  for (const match of unitText.matchAll(AMOUNT)) {
    const at = match.index ?? 0;
    const { quote, startChar, endChar } = sliceQuote(unitText, at, match[0].length);
    push({
      kind: "amount",
      statement: quote,
      subject: subjectKey(quote),
      predicate: "tutar",
      normalizedValue: normalizeAmount(match[1] ?? ""),
      startChar,
      endChar,
      quote,
    });
  }

  for (const match of unitText.matchAll(RATIO)) {
    const at = match.index ?? 0;
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    if (raw === "") continue;
    const { quote, startChar, endChar } = sliceQuote(unitText, at, match[0].length);
    push({
      kind: "ratio",
      statement: quote,
      subject: subjectKey(quote),
      predicate: "oran",
      normalizedValue: normalizeRatio(raw),
      startChar,
      endChar,
      quote,
    });
  }

  return out;
}

export function quoteSha256(quote: string): string {
  return createHash("sha256").update(quote, "utf8").digest("hex");
}
