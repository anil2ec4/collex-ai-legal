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

/**
 * Version of these rules; stored on every row so a change invalidates reuse.
 *
 * extract-v3 (W21 R2-22). v2 looked a month name up by a spelling that kept
 * ş/ı/ğ/ü, so every date written with Şubat, Mayıs, Ağustos, Eylül, Kasım or
 * Aralık was never read; and it read an amount only as "45.000 TL" — not
 * "45.000,00.-TL", "₺45.000", "45.000 TRY" or any foreign currency. A census
 * built on it reported "no date in the whole document" for a contract full
 * of dates. v3 reads month names in any case, with or without diacritics and
 * in either Unicode normalization, ISO dates, and the amount spellings below.
 * A foreign currency is kept in the normalized value AND the predicate, so
 * 45.000 TL and 45.000 EUR are never equal and never compared. A value's own
 * words (a month name, a currency) no longer enter its topic key, so
 * observation keys changed with it. The version is part of a run's identity
 * (identity.ts), so a new run never resumes a v2 run, and runner.ts never
 * reuses a unit extracted under another version.
 *
 * extract-v4 (W21 R2-22, verifier round). v3 refused EVERY amount written
 * right after another number and a space, so a payment table's
 * "15.09.2023 45.000,00 TL" or "Taksit 3 15.000 TL" silently fell out of the
 * matter analysis. v4 refuses only a number that could JOIN the number before
 * it into one space-grouped number ("Taksit 3 500 TL": 3.500 TL or 500 TL?)
 * and leaves it unread, for unparsedValueMentions to name. For the same
 * reason a plain space groups thousands only when the group after it starts
 * with 0 ("45 000 TL"); "1 500 TL" may be an item number and an amount, so it
 * is not guessed (a no-break or thin space still groups). And a foreign
 * amount is read only when the caller asks (ExtractOptions.foreignAmounts —
 * the review grid's census): contradictions.ts compares and describes amounts
 * as TL kuruş, so "150000 EUR" fed to the matter analysis was described a
 * hundred times too large and compared without the rounding tolerance.
 *
 * extract-v5 (W21 R2-22, second verifier round). v4 still guessed in three
 * ways. A currency code before a number took ANY number, even on the next
 * line: "Ödemeler TL 12 eşit taksitte" became 12 TL, "USD/TL 2023 yılı"
 * 2.023 TL and "para birimi: TL" followed by the next article's "4." 4 TL —
 * enough for the matter analysis to report "4 TL ve 5 TL" as a
 * contradiction. A code, or a symbol set apart by a space, now takes only an
 * amount-shaped number on its own line: one with a thousands group or a
 * decimal part ("TL 45.000", "USD 1.500,00"), or one with a scale word ("USD
 * 2 milyon"). "TL 12" and "TL 2023" stay unread, and unparsedValueMentions
 * names them. A symbol written against its digits ("₺500", "£300") is money
 * notation and still takes any number. By the same rule, a bare number and a
 * currency on different lines ("Madde 45", then "TL cinsinden" on the next
 * line) are no longer one amount; an amount-shaped number still is. And v4
 * joined every plain-space group after the first, so "45 000 540 000 TL"
 * became one amount of 45.000.540.000 TL: now a later group, like the first,
 * joins over a plain space only when it starts with 0, and such a row is
 * left unread and named.
 *
 * extract-v6 (W21 R2-22, third verifier round). v5 stopped reading a bare
 * number and a currency on different lines, but unparsedValueMentions looked
 * for a digit only on the currency's own line. A wrapped amount (pypdf keeps
 * a visual line wrap as a line break: "aylık kira bedeli olarak 7500" / "TL
 * ödemeyi ...") was then neither read nor named, and the census of a
 * contract whose only amount wrapped said COMPLETE. A value word alone at the
 * start or end of its line is now checked against the number at the facing
 * edge of the neighbouring non-blank line, so such text is named and the
 * census is PARTIAL (unparsedValueMentions). Two reading changes come with
 * it. A number after a currency code needs two decimal places when it has no
 * thousands group: "TL 12,50" is read, "Kredi USD 1,5 yıl" and "Ödeme TL 2,5
 * katı" are named, not read as 1,50 USD and 2,50 TL; a number whose currency
 * is on another line needs the same shape ("Madde 12,5" / "TL cinsinden" is
 * not 12,50 TL). A currency written in two words sits on the number's line
 * when its first word does: "7500 Türk" / "Lirası" is 7.500 TL. And by the
 * same line rule a long-form date needs its day and month on one line: a
 * page number or "Madde 12" above "Kasım 2023 ..." was read as a precise
 * date (12.11.2023) that the document never states; it is named now.
 */
export const EXTRACTOR_VERSION = "extract-v7";

/** How many characters around a value become its quote. */
const QUOTE_RADIUS = 160;

/** How many stems form a topic key. */
const SUBJECT_STEMS = 6;

const NUMERIC_DATE =
  /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/gu;

/** "2023-09-15", as system footers and e-signature blocks print a date. */
const ISO_DATE =
  /(?<![\p{L}\p{N}./-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\p{L}\p{N}]|[./-]\d)/gu;

/** Month numbers keyed by the ASCII fold of the month name (see asciiFold). */
const TR_MONTHS: ReadonlyMap<string, number> = new Map([
  ["ocak", 1], ["subat", 2], ["mart", 3], ["nisan", 4], ["mayis", 5], ["haziran", 6],
  ["temmuz", 7], ["agustos", 8], ["eylul", 9], ["ekim", 10], ["kasim", 11], ["aralik", 12],
]);

/** Whitespace that stays on its line: any space, never a line break. */
const INLINE_SPACE = String.raw`[^\S\n\r\v\f\u0085\u2028\u2029]`;

/** A line break of any kind. */
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;

/**
 * "15 Eylül 2023". The month is any run of letters AND combining marks, so a
 * decomposed (NFD) "Eylül" is captured whole; which month it is, is decided
 * by its ASCII fold, never by one spelling of it.
 *
 * The day and the month share a line (W21 R2-22, third verifier round), by
 * the rule a bare number and a currency follow: "Madde 12" or a page number
 * "3" above a line starting "Kasım 2023" is not 12 or 3 Kasım 2023. Such text
 * is left unread and named by unparsedValueMentions ("Kasım 2023 ...").
 * The year may still follow on the next line ("15 Eylül" / "2023").
 */
const LONG_DATE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(\d{1,2})${INLINE_SPACE}+([\p{L}\p{M}]+)\s+(\d{4})(?![\p{L}\p{N}])`,
  "gu",
);

/** A space that only ever separates thousands: no-break, narrow no-break, thin. */
const GROUP_SPACE = String.raw`[\u00A0\u202F\u2009]`;

/** Any one space that may stand between two thousands groups. */
const ANY_GROUP_SPACE = String.raw`[ \u00A0\u202F\u2009]`;

/** "45.000", "1.050.000,50". */
const DOT_GROUPED = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?`;

/**
 * "45 000", "1 050 000", "45 000,00", or any group after a no-break or thin
 * space. EVERY group after a plain space must start with 0, not only the
 * first (W21 R2-22, second verifier round): "1 500", "1 050 500" and
 * "45 000 540 000" may be numbers side by side (an item number and an
 * amount, two columns of a flattened table row), so none of them is read as
 * one number; see JOINS_PREVIOUS_NUMBER.
 */
const SPACE_GROUPED = String.raw`\d{1,3}(?:${GROUP_SPACE}\d{3}| 0\d{2})+(?:,\d{1,2})?`;

/**
 * The number of an amount: "45.000,50", "45 000", "45000", "45000,5". A
 * thousands group may be separated by a dot, a no-break or thin space, or a
 * plain space when the group after it starts with 0 ("45 000",
 * "1 050 000"). "1 500" with a plain space is NOT one number here: it may be
 * an item number and an amount (see JOINS_PREVIOUS_NUMBER).
 */
const AMOUNT_NUMBER = String.raw`${DOT_GROUPED}|${SPACE_GROUPED}|\d+(?:,\d{1,2})?`;

/**
 * An amount-SHAPED number: one with a thousands group, or with two decimal
 * places ("12,50"). A bare "12" or "2023" is not: it may be a count, a year or
 * an article number. Nor is "1,5" (W21 R2-22, third verifier round): after a
 * currency code it is as often a term or a multiple ("USD 1,5 yıl vadeli",
 * "TL 2,5 katı") as money.
 */
const SHAPED_NUMBER = String.raw`${DOT_GROUPED}|${SPACE_GROUPED}|\d+,\d{2}`;

const SHAPED_WHOLE = new RegExp(String.raw`^(?:${SHAPED_NUMBER})$`, "u");

/** True for a matched number (AMOUNT_NUMBER) that is amount-shaped (SHAPED_NUMBER). */
function isAmountShaped(rawNumber: string): boolean {
  return SHAPED_WHOLE.test(rawNumber);
}

/**
 * At the start of a number: it is a group of three digits that could JOIN a
 * lone 1-3 digit number just before it (one space between) into one
 * space-grouped number. "Taksit 3 500 TL" is 3.500 TL or 500 TL, and the
 * patterns do not guess. A 4-digit year, the end of a date or time
 * ("2023-09-15 500 TL", "14:30 500 TL"), a dotted amount, or a dot-grouped
 * tail ("12 540.000 TL", "15.09.2023 45.000 TL") cannot join, so they do
 * not block the amount after them.
 */
const JOINS_PREVIOUS_NUMBER =
  String.raw`(?<=(?<![\p{L}\p{N}.,:/-])\d{1,3}${ANY_GROUP_SPACE})\d{3}(?![\p{N}]|\.\p{N})`;

/**
 * At the end of a number: it is a lone 1-3 digit number that a group of
 * three digits after it could join ("TL 3 500": 3 TL or 3.500 TL?).
 */
const JOINED_BY_NEXT_NUMBER =
  String.raw`(?<=(?<![\p{L}\p{N}.,:/-])\d{1,3})${ANY_GROUP_SPACE}\d{3}(?![\p{N}]|\.\p{N})`;

/** "45 bin TL", "1,5 milyon TL", "2 milyar TL". */
const AMOUNT_SCALE = String.raw`(?:\s+(b[iİ]n|m[iİ]lyon|m[iİ]lyar))?`;

/** A scale word as a whole word ("bin", never the start of "bina"). */
const SCALE_WORD = String.raw`(?:b[iİ]n|m[iİ]lyon|m[iİ]lyar)(?![\p{L}\p{N}])`;

/** Currency words and codes (case-insensitive, whole words only). */
const CURRENCY_WORDS =
  String.raw`t[üu]rk\s+l[iİı]ra(?:s[ıiİ])?|ytl|try|tl|euro?|avro|usd|(?:abd|amerikan)\s+dolar[ıiİ]?|dolar[ıiİ]?|gbp|(?:[iİ]ngiliz\s+)?sterl[iİ]n[iİ]?|chf`;

/** Currency symbols. A symbol needs no word boundary ("US$1.500"). */
const CURRENCY_SYMBOLS = String.raw`₺|€|\$|£`;

/**
 * An amount whose currency follows the number: "45.000 TL", "45.000,00.-TL",
 * "45.000-TL", "45.000,- TL", "45.000 TRY", "1.200,00 Türk Lirası",
 * "1,5 milyon TL", "1.500 EUR", "1.500 Avro", "2.000 ABD Doları", "45.000 ₺".
 * The number may not start inside another number, nor where it could join
 * the number before it ("Taksit 3 500 TL"), nor right after a scale word:
 * "45 bin 500 TL" is not read as 500 TL. Such text is left unread, and
 * unparsedValueMentions reports it. An amount after a date, a year or an
 * item number it cannot join ("15.09.2023 45.000,00 TL", "Taksit 3 15.000
 * TL") is read. A number and a currency on different lines are one amount
 * only when the number is amount-shaped or scaled (amountMatches): "Madde 45"
 * above a line starting "TL cinsinden" is not 45 TL. Such text is not
 * silently dropped: unparsedValueMentions names it.
 */
const AMOUNT_AFTER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,])(?!${JOINS_PREVIOUS_NUMBER})(?<!\d\s+(?:b[iİ]n|m[iİ]lyon|m[iİ]lyar)\s+)(${AMOUNT_NUMBER})${AMOUNT_SCALE}\s*(?:[.,]?-\s*)?((?:${CURRENCY_WORDS})(?![\p{L}\p{N}])|${CURRENCY_SYMBOLS})`,
  "giu",
);

/**
 * The number after a currency written before it, on the same line (W21
 * R2-22, second verifier round): an amount-shaped number, optionally scaled
 * ("TL 45.000", "USD 1.500,00", "TL 12,50"), or a number WITH a scale word
 * ("USD 2 milyon", "EUR 1,5 milyon"). Never a bare "12" or "2023":
 * "Ödemeler TL 12 eşit taksitte", "USD/TL 2023 yılı" and "Döviz: USD 12 ay
 * vadeli" name a count, a year and a term; nor, since the third verifier
 * round, "USD 1,5 yıl" or "TL 2,5 katı". Nor a number a group after it could
 * join ("TL 3 500"). Groups: number, scale.
 */
const SHAPED_AFTER_CURRENCY = String.raw`(${SHAPED_NUMBER}|\d+(?:,\d{1,2})?(?=${INLINE_SPACE}+${SCALE_WORD}))(?:${INLINE_SPACE}+(${SCALE_WORD}))?(?![\p{N}]|[.,]\d|${JOINED_BY_NEXT_NUMBER})`;

/** The codes a currency may be written as (also the left side of a pair). */
const CURRENCY_CODES = String.raw`ytl|try|tl|eur|usd|gbp|chf`;

/**
 * An amount whose currency CODE precedes the number: "USD 1.500", "TL 45 000".
 * A code that is the RIGHT side of a currency pair is an exchange rate, not
 * an amount ("Kur EUR/TL 35,12" is the price of one euro, and two rates on
 * two dates are not a contradiction): it is left unread, and
 * unparsedValueMentions names it (W21 closing re-check).
 * Groups: code, number, scale.
 */
const AMOUNT_BEFORE_CODE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?<!(?:${CURRENCY_CODES})${INLINE_SPACE}*[/\-]${INLINE_SPACE}*)(${CURRENCY_CODES})${INLINE_SPACE}*${SHAPED_AFTER_CURRENCY}`,
  "giu",
);

/**
 * An amount whose currency SYMBOL precedes the number. Written against its
 * digits ("₺45.000", "€1.500,50", "£300") a symbol is money notation, and
 * any number is read; set apart by a space ("₺ 12") it reads like a code.
 * Groups: symbol, attached number, attached scale, spaced number, spaced scale.
 */
const AMOUNT_BEFORE_SYMBOL = new RegExp(
  String.raw`(${CURRENCY_SYMBOLS})(?:(${AMOUNT_NUMBER})(?:${INLINE_SPACE}+(${SCALE_WORD}))?(?![\p{N}]|[.,]\d|${JOINED_BY_NEXT_NUMBER})|${INLINE_SPACE}+${SHAPED_AFTER_CURRENCY})`,
  "giu",
);

/** "%80", "80 %", "yüzde 80" — fault ratios and shares. */
const RATIO =
  /(?:%\s*(\d{1,3}(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,]\d{1,2})?)\s*%|yüzde\s+(\d{1,3}(?:[.,]\d{1,2})?))/giu;

/**
 * A word as an ASCII key: NFC, Turkish case folding (İ→i, I→ı), dotless ı→i,
 * then every combining mark dropped (ş→s, ğ→g, ü→u, ö→o, ç→c). "EYLÜL",
 * "Eylül", "eylul" and a decomposed "Eylu\u0308l" all fold to "eylul".
 */
export function asciiFold(word: string): string {
  return foldTurkishCase(word.normalize("NFC"))
    .replace(/ı/gu, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

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

/** How many stems form a clause-scoped topic key (measured, see below). */
export const TOPIC_STEMS = 4;

function isBoundary(text: string, index: number): boolean {
  const c = text[index];
  if (c === "\n" || c === ",") return true;
  if (c === "." || c === "!" || c === "?" || c === ";") {
    // A dot inside "01.02.2023" or "45.000" is followed by a digit, never by
    // whitespace, so dates and amounts never split a clause.
    const next = text[index + 1];
    return next === undefined || /\s/u.test(next);
  }
  return false;
}

/**
 * The topic key of a value: the TOPIC_STEMS significant stems NEAREST to it
 * inside its own clause (bounded by . ! ? ; , or a newline), sorted.
 *
 * W20 replaced the W19 key (stems of the ±160-character quote window,
 * alphabetically first six). Measured on 11 labeled synthetic value pairs at
 * the unchanged 0.4 overlap threshold, the W19 key decided 6/11 correctly —
 * every "different subject" pair was compared, because the window was
 * dominated by neighbouring text ("amaç artırmak bilgi …") — and this key
 * decides 10/11 (the miss: "ihtar" vs "ihtarname" stem differently). That is
 * a synthetic measurement, not a claim about real case files; the key still
 * only decides what is COMPARED, never what is asserted.
 */
export function topicKeyAround(text: string, at: number, length: number): string {
  let start = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (isBoundary(text, i)) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = at + length; i < text.length; i += 1) {
    if (isBoundary(text, i)) {
      end = i;
      break;
    }
  }
  const words: Array<{ stem: string; distance: number }> = [];
  // Combining marks belong to their word: a decomposed (NFD) "Şubat" is one
  // word, folded in its composed form (W21 R2-22).
  for (const match of text.slice(start, end).matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const index = start + (match.index ?? 0);
    // W21 R2-22: a word INSIDE the value's own span (a month name, a
    // currency, "milyon") is part of the value, like its digits — never
    // what makes two values comparable.
    if (index >= at && index < at + length) continue;
    const raw = foldTurkishCase(match[0].normalize("NFC"));
    if (raw.length < 3 || /\d/u.test(raw)) continue;
    const stem = stemTurkish(raw);
    if (stem.length < 3 || STOP_STEMS.has(stem)) continue;
    const distance = index < at ? at - (index + match[0].length) : index - (at + length);
    words.push({ stem, distance });
  }
  words.sort((a, b) => a.distance - b.distance);
  const out: string[] = [];
  for (const word of words) {
    if (!out.includes(word.stem)) out.push(word.stem);
    if (out.length >= TOPIC_STEMS) break;
  }
  return out.sort().join(" ");
}

/** Longest sentence used as a statement; a longer one falls back to the quote. */
const MAX_STATEMENT_CHARS = 400;

/**
 * The sentence a value sits in, as shown to the reader (W20).
 *
 * The QUOTE stays the ±160-character window, because that is what a lawyer
 * checks against the page. The STATEMENT is what a list shows: a window that
 * starts in the previous paragraph ("… belgesidir ve …  11.03.2024") read as
 * noise in the chronology. Both are exact substrings of the unit text.
 */
function sentenceOf(text: string, at: number, length: number, fallback: string): string {
  const boundary = (index: number): boolean => {
    const c = text[index];
    if (c === "\n") return true;
    if (c === "." || c === "!" || c === "?" || c === ";") {
      const next = text[index + 1];
      return next === undefined || /\s/u.test(next);
    }
    return false;
  };
  let start = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (boundary(i)) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = at + length; i < text.length; i += 1) {
    if (boundary(i)) {
      end = text[i] === "\n" ? i : i + 1;
      break;
    }
  }
  const sentence = text.slice(start, end).trim();
  return sentence === "" || sentence.length > MAX_STATEMENT_CHARS ? fallback : sentence;
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

type CurrencyCode = "TRY" | "EUR" | "USD" | "GBP" | "CHF";

/** The currency a matched currency word, code or symbol names. */
function currencyOf(token: string): CurrencyCode | undefined {
  const folded = asciiFold(token).replace(/\s+/gu, " ");
  if (folded === "₺" || folded === "tl" || folded === "try" || folded === "ytl" || folded.startsWith("turk ")) {
    return "TRY";
  }
  if (folded === "€" || folded === "eur" || folded === "euro" || folded === "avro") return "EUR";
  if (folded === "$" || folded === "usd" || folded.includes("dolar")) return "USD";
  if (folded === "£" || folded === "gbp" || folded.includes("sterlin")) return "GBP";
  if (folded === "chf") return "CHF";
  return undefined;
}

const AMOUNT_SCALES: ReadonlyMap<string, number> = new Map([
  ["bin", 1_000],
  ["milyon", 1_000_000],
  ["milyar", 1_000_000_000],
]);

interface ValueSpan {
  /** UTF-16 index of the match within the unit text. */
  readonly at: number;
  readonly length: number;
}

interface AmountMatch extends ValueSpan {
  /** Integer minor units (kuruş, cent), so "45.000" and "45000,00" compare equal. */
  readonly minorUnits: number;
  readonly currency: CurrencyCode;
}

interface DateMatch extends ValueSpan {
  readonly iso: string;
}

/** Every amount the patterns read, in text order, never two over one span. */
function amountMatches(text: string): AmountMatch[] {
  const found: AmountMatch[] = [];
  const add = (at: number, length: number, rawNumber: string, rawScale: string | undefined, rawCurrency: string): void => {
    const currency = currencyOf(rawCurrency);
    if (currency === undefined) return;
    const value = Number(rawNumber.replace(/[.\s]/gu, "").replace(",", "."));
    const scale = rawScale === undefined ? 1 : AMOUNT_SCALES.get(asciiFold(rawScale));
    if (!Number.isFinite(value) || scale === undefined) return;
    if (found.some((other) => at < other.at + other.length && other.at < at + length)) return;
    found.push({ at, length, minorUnits: Math.round(value * scale * 100), currency });
  };
  for (const match of text.matchAll(AMOUNT_AFTER)) {
    const rawNumber = match[1] ?? "";
    const rawCurrency = match[3] ?? "";
    // W21 R2-22 (second verifier round): a bare number and a currency on
    // different lines ("Madde 45", then "TL cinsinden ...") are not one
    // amount. An amount-shaped or scaled number is: a table cell split from
    // its currency ("45.000,00" above "TL"). Only a break BETWEEN the number
    // and the currency counts (third verifier round): "7500 Türk" above
    // "Lirası" is written on the number's line. A skipped candidate is named
    // by unparsedValueMentions, never dropped silently.
    const between = match[0].slice(rawNumber.length, match[0].length - rawCurrency.length);
    if (match[2] === undefined && LINE_BREAK.test(between) && !isAmountShaped(rawNumber)) continue;
    add(match.index ?? 0, match[0].length, rawNumber, match[2], rawCurrency);
  }
  for (const match of text.matchAll(AMOUNT_BEFORE_CODE)) {
    add(match.index ?? 0, match[0].length, match[2] ?? "", match[3], match[1] ?? "");
  }
  for (const match of text.matchAll(AMOUNT_BEFORE_SYMBOL)) {
    add(match.index ?? 0, match[0].length, match[2] ?? match[4] ?? "", match[3] ?? match[5], match[1] ?? "");
  }
  return found.sort((left, right) => left.at - right.at);
}

/** Every valid date the patterns read: numeric, long-form, then ISO. */
function dateMatches(text: string): DateMatch[] {
  const found: DateMatch[] = [];
  for (const match of text.matchAll(NUMERIC_DATE)) {
    const iso = isoOrUndefined(Number(match[3]), Number(match[2]), Number(match[1]));
    if (iso !== undefined) found.push({ at: match.index ?? 0, length: match[0].length, iso });
  }
  for (const match of text.matchAll(LONG_DATE)) {
    const month = TR_MONTHS.get(asciiFold(match[2] ?? ""));
    if (month === undefined) continue;
    const iso = isoOrUndefined(Number(match[3]), month, Number(match[1]));
    if (iso !== undefined) found.push({ at: match.index ?? 0, length: match[0].length, iso });
  }
  for (const match of text.matchAll(ISO_DATE)) {
    const iso = isoOrUndefined(Number(match[1]), Number(match[2]), Number(match[3]));
    if (iso !== undefined) found.push({ at: match.index ?? 0, length: match[0].length, iso });
  }
  return found;
}

/** Ratio to per-mille integers, so "80" and "80,0" compare equal. */
function normalizeRatio(raw: string): string {
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) return raw;
  return String(Math.round(value * 10));
}

export interface ExtractOptions {
  /**
   * Also return amounts in a foreign currency (EUR, USD, GBP, CHF), as
   * normalizedValue "<minor units> <CODE>" and predicate "tutar:<CODE>".
   *
   * Only the review grid's census asks (it displays that form itself). The
   * matter analysis does not (W21 R2-22, verifier round): contradictions.ts
   * compares amounts as numbers and describes them as TL kuruş, so a foreign
   * amount there was described a hundred times too large ("150000 EUR") and
   * compared without the rounding tolerance a TL amount gets. Until it reads
   * "<minor> <CODE>", a foreign amount stays out of the matter analysis
   * rather than being reported at the wrong magnitude. Either way its span
   * is consumed, so it is never misread as a TL amount.
   */
  readonly foreignAmounts?: boolean;
}

/**
 * Extract every deterministic proposition from one unit of text.
 *
 * Offsets are code points WITHIN `unitText`; the caller rebases them onto the
 * document version. The quote is returned verbatim so its hash can be
 * verified against canonical text like any other citation.
 */
export function extractPropositions(unitText: string, options: ExtractOptions = {}): PropositionDraft[] {
  const out: PropositionDraft[] = [];
  const seen = new Set<string>();

  const push = (draft: PropositionDraft): void => {
    const key = `${draft.kind}|${draft.subject}|${draft.normalizedValue}|${draft.startChar}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(draft);
  };

  for (const date of dateMatches(unitText)) {
    const { quote, startChar, endChar } = sliceQuote(unitText, date.at, date.length);
    push({
      kind: "date",
      statement: sentenceOf(unitText, date.at, date.length, quote),
      subject: topicKeyAround(unitText, date.at, date.length),
      predicate: "tarih",
      normalizedValue: date.iso,
      occurredOn: date.iso,
      datePrecision: "exact",
      startChar,
      endChar,
      quote,
    });
  }

  for (const amount of amountMatches(unitText)) {
    const domestic = amount.currency === "TRY";
    if (!domestic && options.foreignAmounts !== true) continue;
    const { quote, startChar, endChar } = sliceQuote(unitText, amount.at, amount.length);
    push({
      kind: "amount",
      statement: sentenceOf(unitText, amount.at, amount.length, quote),
      subject: topicKeyAround(unitText, amount.at, amount.length),
      // A foreign amount is compared only with amounts in the same currency.
      predicate: domestic ? "tutar" : `tutar:${amount.currency}`,
      normalizedValue: domestic ? String(amount.minorUnits) : `${amount.minorUnits} ${amount.currency}`,
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
      statement: sentenceOf(unitText, at, match[0].length, quote),
      subject: topicKeyAround(unitText, at, match[0].length),
      predicate: "oran",
      normalizedValue: normalizeRatio(raw),
      startChar,
      endChar,
      quote,
    });
  }

  return out;
}

/** How far around a value-like word a digit is looked for (UTF-16 units). */
const MENTION_WINDOW: Readonly<Record<"date" | "amount", { before: number; after: number }>> = {
  date: { before: 12, after: 12 },
  amount: { before: 20, after: 4 },
};

/** Longest example returned per mention. */
const MAX_MENTION_CHARS = 60;

/** Every line break character (LINE_BREAK). */
const LINE_BREAK_CHARS = "\n\r\v\f\u0085\u2028\u2029";

function isLineBreakAt(text: string, index: number): boolean {
  const c = text[index];
  return c !== undefined && LINE_BREAK_CHARS.includes(c);
}

interface LineIndex {
  /** Index of the first character of the line holding `index`. */
  readonly startOf: (index: number) => number;
  /** Index of the line break ending the line holding `index`, or the text's length. */
  readonly endOf: (index: number) => number;
}

/**
 * The lines of `text`, found once, so that looking a line up costs a binary
 * search rather than a walk along a line that may be the whole unit.
 */
function lineIndex(text: string): LineIndex {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (isLineBreakAt(text, index)) starts.push(index + 1);
  }
  const lineAt = (index: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= index) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  return {
    startOf: (index) => starts[lineAt(index)]!,
    endOf: (index) => {
      const next = lineAt(index) + 1;
      return next < starts.length ? starts[next]! - 1 : text.length;
    },
  };
}

/**
 * What may stand between a value word and the edge of its line, or between
 * the edge of a line and the number that faces it across a wrap: spaces,
 * blank lines and the punctuation an amount or a table cell carries
 * ("7500.-" / "TL", "Tutar (TL)" / "45.000,00", "Madde 45." / "TL").
 */
const EDGE_FILLER = /[\s\u0085.,:;()[\]\-\u2013\u2014]/u;

/**
 * True when text[from, to) is only EDGE_FILLER. Scanned outward from the
 * value word (`towardsFrom`: from `to` back to `from`), so a word that is not
 * at the edge of its line costs a step or two, however long the line is.
 */
function onlyEdgeFiller(text: string, from: number, to: number, towardsFrom: boolean): boolean {
  for (let step = 0; step < to - from; step += 1) {
    const index = towardsFrom ? to - 1 - step : from + step;
    if (!EDGE_FILLER.test(text[index] ?? "")) return false;
  }
  return true;
}

/** A numeric date the patterns could not read ("31.02.2023", "15.09.23"). */
const DATE_LIKE = /(?<![\p{L}\p{N}])\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?![\p{L}\p{N}])/gu;

const LETTER_RUN = /[\p{L}\p{M}]+/gu;

const CURRENCY_TOKEN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${CURRENCY_WORDS})(?![\p{L}\p{N}])|${CURRENCY_SYMBOLS}`,
  "giu",
);

/**
 * A word character, or a "." / "," / space between two digits ("1,500.00",
 * "45 000 540 000"), so an example shows a whole run of numbers.
 */
function inWord(text: string, index: number): boolean {
  const c = text[index] ?? "";
  if (/[\p{L}\p{N}\p{M}]/u.test(c)) return true;
  return /[.,\u0020\u00A0\u202F\u2009]/u.test(c) && /\p{Nd}/u.test(text[index - 1] ?? "") && /\p{Nd}/u.test(text[index + 1] ?? "");
}

/** The text around a mention, widened to whole words and whole numbers, never before `floor` nor past `ceiling`. */
function mentionSnippet(text: string, from: number, to: number, floor: number, ceiling: number): string {
  let start = Math.max(floor, from);
  let end = Math.min(ceiling, to);
  while (start > floor && inWord(text, start - 1)) start -= 1;
  while (end < ceiling && inWord(text, end)) end += 1;
  const snippet = [...text.slice(start, end).replace(/\s+/gu, " ").trim()];
  return snippet.length > MAX_MENTION_CHARS ? `${snippet.slice(0, MAX_MENTION_CHARS).join("")}…` : snippet.join("");
}

/**
 * W21 R2-22: text in `unitText` that LOOKS like a date (a month name or a
 * numeric date next to a number) or an amount (a currency word, code or
 * symbol next to a number) but that extractPropositions did NOT read — one
 * short example per mention, in text order, without repeats. Amounts are
 * judged as the census reads them: foreign-currency amounts count as read.
 *
 * The patterns above are a recall limit, not a fact about the document. A
 * census that met such text must not present its list (or its empty list)
 * as everything the document says; this is how it knows. A mention is only
 * a hint — "Kasım" may be a name — so it may make a census more cautious,
 * never less. Ratios have no such check and return [].
 *
 * A digit next to a value word is looked for on the word's own line, and,
 * when the word stands alone at the start or end of its line, at the facing
 * edge of the neighbouring non-blank line (a wrapped line: "7500" / "TL",
 * "Tutar TL" / "45.000,00"). Whatever the amount patterns refuse to read
 * across a line is therefore named, never dropped in silence.
 */
export function unparsedValueMentions(unitText: string, kind: PropositionKind): string[] {
  if (kind === "ratio") return [];
  const spans: readonly ValueSpan[] = kind === "date" ? dateMatches(unitText) : amountMatches(unitText);
  const covered = (index: number): boolean =>
    spans.some((span) => index >= span.at && index < span.at + span.length);
  const window = MENTION_WINDOW[kind];
  const digitBetween = (from: number, to: number): boolean => {
    for (let index = Math.max(0, from); index < Math.min(unitText.length, to); index += 1) {
      if (/\p{Nd}/u.test(unitText[index] ?? "") && !covered(index)) return true;
    }
    return false;
  };
  const found: Array<{ at: number; snippet: string }> = [];
  const lines = lineIndex(unitText);
  const uncoveredDigitAt = (index: number): boolean =>
    index >= 0 && index < unitText.length && /\p{Nd}/u.test(unitText[index] ?? "") && !covered(index);
  const push = (at: number, from: number, to: number, floor: number, ceiling: number): void => {
    const snippet = mentionSnippet(unitText, from, to, floor, ceiling);
    if (snippet !== "" && !found.some((entry) => entry.snippet === snippet)) found.push({ at, snippet });
  };
  const note = (at: number, length: number, needsDigit: boolean): void => {
    if (covered(at)) return;
    // The digit is looked for on the value word's own line first: a number
    // further along a paragraph is not "next to" it.
    const lineStart = lines.startOf(at);
    const lineEnd = lines.endOf(at + length);
    const from = Math.max(lineStart, at - window.before);
    const to = Math.min(lineEnd, at + length + window.after);
    if (!needsDigit || digitBetween(from, at) || digitBetween(at + length, to)) {
      push(at, from, to, lineStart, lineEnd);
      return;
    }
    // W21 R2-22 (third verifier round): a wrapped line. A value word alone at
    // the START of its line faces the number ending the previous non-blank
    // line ("... olarak 7500" / "TL ödemeyi"); one alone at the END faces
    // the number starting the next ("Tutar TL" / "45.000,00", "₺" / "7500").
    // The patterns do not read such a pair as one value unless the number is
    // amount-shaped (amountMatches), so it is named here. A heading's number
    // above a line starting with a currency ("Madde 45" / "TL cinsinden") is
    // named too: it only makes the census more cautious.
    if (onlyEdgeFiller(unitText, lineStart, at, true)) {
      let edge = lineStart - 1;
      while (edge >= 0 && EDGE_FILLER.test(unitText[edge] ?? "")) edge -= 1;
      if (edge >= 0 && edge < lineStart - 1 && uncoveredDigitAt(edge)) {
        const previousStart = lines.startOf(edge);
        push(at, Math.max(previousStart, edge + 1 - window.before), to, previousStart, lineEnd);
        return;
      }
    }
    if (onlyEdgeFiller(unitText, at + length, lineEnd, false)) {
      let edge = lineEnd;
      while (edge < unitText.length && EDGE_FILLER.test(unitText[edge] ?? "")) edge += 1;
      if (edge > lineEnd && uncoveredDigitAt(edge)) {
        const nextEnd = lines.endOf(edge);
        push(at, from, Math.min(nextEnd, edge + window.after), lineStart, nextEnd);
      }
    }
  };
  if (kind === "date") {
    for (const match of unitText.matchAll(DATE_LIKE)) note(match.index ?? 0, match[0].length, false);
    for (const match of unitText.matchAll(LETTER_RUN)) {
      if (TR_MONTHS.has(asciiFold(match[0]))) note(match.index ?? 0, match[0].length, true);
    }
  } else {
    for (const match of unitText.matchAll(CURRENCY_TOKEN)) note(match.index ?? 0, match[0].length, true);
  }
  return found.sort((left, right) => left.at - right.at).map((entry) => entry.snippet);
}

export function quoteSha256(quote: string): string {
  return createHash("sha256").update(quote, "utf8").digest("hex");
}
