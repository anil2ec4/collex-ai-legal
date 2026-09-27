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
import { cpLength, foldTurkishCase, stemTurkish, STOP_STEMS } from "../retrieval/turkishAnalyzer.js";

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
 *
 * extract-v8 (W22, a real iş davası file). The values read are unchanged;
 * what they are ABOUT changed, and so did which of them are compared:
 *
 *   - Sentence and clause ends. "Yargıtay 9. Hukuk Dairesi" ended a sentence
 *     at "9." and "2019/1234 E., 2020/5678 K. sayılı" at "K."; an ordinal, a
 *     one-letter abbreviation and a closed list of abbreviations ("Av.",
 *     "No.") no longer end one. A single PDF line wrap (a line ending in a
 *     lower-case letter, the next starting with one) no longer ends a
 *     sentence either: "esas\nalınırsa hizmet süresi ..." was shown as the
 *     finding "alınırsa hizmet süresi ... (alternatif".
 *   - Topic keys (topicStem). The stemmer turned one word into several keys
 *     ("ihtarname" → ihtarnam, "ihtarnamesi" → ihtarname; "müvekkil" /
 *     "müvekkile", "davalı" / "davalıya"), an apostrophe suffix became a word
 *     ("Dairesi'nin" → "nin"), and "tarih", "olarak" and the party roles
 *     filled the four slots of most keys. A key word is now the first five
 *     letters of its ASCII-folded stem, generic words are dropped, and
 *     "maaş" is read as "ücret".
 *   - Event anchors. A date written as the date OF a named event — işe giriş,
 *     işten çıkış / fesih, tebliğ, the date of an ihtarname — carries that
 *     event in its predicate ("tarih#olay:teblig"), and two dates of the
 *     same event are compared whatever their other words (contradictions.ts).
 *   - Never compared. The date of a cited court decision ("Yargıtay 9. HD'nin
 *     12.03.2020 tarihli, 2019/1234 E. ... sayılı kararı") is "tarih#karar":
 *     two precedents' dates are not a contradiction and not an event of the
 *     case. An amount claimed "şimdilik" / with "fazlaya ilişkin haklar
 *     saklı" (a partial claim, HMK m. 107) is "tutar#kismi_talep": it is not
 *     a statement of what is owed and is not compared with a calculation.
 *   - unparsedValueMentions names every money-shaped number ("204.962,34")
 *     that was not read as an amount — a table whose currency sits only in
 *     the column header ("Brüt (TL)") is no longer a COMPLETE census.
 *
 * extract-v9 (W23, the same iş davası file). The values read, and so every
 * census, are those of v8; which EVENT a date is the date of changed. v8
 * found 9 of the 12 cross-document işe giriş pairs: the three it missed were
 * all one witness sentence, "Davacı Mehmet, 01.03.2018 tarihinde depoya
 * sorumlu olarak geldi" — no "işe", no "çalış", and no topic word shared
 * with "İşe Giriş Tarihi : 01.03.2019" or "01.03.2019 tarihinde işe girdi".
 * v9 reads a start of work told without "işe": a job title from a CLOSED
 * list followed by "olarak geldi / başladı / alındı / girdi / istihdam
 * edildi" (JOB_START_AFTER); "D'den / D tarihinden beri … orada /
 * şirketteydi" (AT_WORKPLACE_SINCE, a closed list of workplace words that
 * must be the clause's predicate); "istihdam edildi", "kadroya alındı",
 * "sigorta girişi". And it drops one false anchor: a WITNESS who tells an
 * işe giriş or işten çıkış in the first person singular ("… tarihinde işe
 * başladım") tells the witness's own date, never the case's (a party's own
 * first-person statement still is).
 *
 * extract-v10 (W23, the same file). The values read are those of v8/v9;
 * what an AMOUNT is the amount of changed. v9 compared net ücret 45.000 /
 * 32.000 in 9 of the 12 cross-document pairs once the bordro was counted:
 * "Davacının 2023 Aralık ayı bordrosunda net ücret 32.000,00 TL olarak
 * gösterilmiştir" shares only "net" and "ücret" with "son aylık net ücreti
 * 45.000 TL" (topic overlap 2 of 6). An amount whose own label is the net
 * or the gross wage ("net ücret", "aylık net maaşı", "Net Ödenen :", "Brüt
 * Ücret :") now carries that wage as its event ("tutar#olay:net_ucret",
 * AmountEvent), so two net wages are compared whatever their other words,
 * and a net and a gross wage never are. "net fazla çalışma ücreti alacağı"
 * and "net kıdem tazminatı" are claims, not the wage, and carry no label.
 */
export const EXTRACTOR_VERSION = "extract-v10";

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

/** How many letters of a folded stem form one topic word (extract-v8). */
export const TOPIC_PREFIX = 5;

/** Every line break character (LINE_BREAK). */
const LINE_BREAK_CHARS = "\n\r\v\f\u0085\u2028\u2029";

function isLineBreakAt(text: string, index: number): boolean {
  const c = text[index];
  return c !== undefined && LINE_BREAK_CHARS.includes(c);
}

/**
 * Abbreviations after which a dot does not end a sentence (case-folded).
 * A CLOSED list: "Av. Zeynep ARSLAN", "No. 12", "Yargıtay 9. HD." — anything
 * else ending in a dot and a space still ends its sentence. One-letter
 * abbreviations ("E.", "K.", "T.", "m.", "A.Ş.") are recognised by shape.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "av", "no", "dr", "vb", "vs", "md", "prof", "doç", "sn", "bkz", "örn",
  "mah", "cad", "sok", "apt", "ltd", "şti", "tic", "hd", "cd", "hgk", "cgk",
  "ibk", "sy", "yy",
]);

/** A numeric date at the start of a line: a date column, never a wrapped sentence. */
const DATE_AT_START = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?!\d)/u;

/**
 * True when the line break at `index` ends a sentence (extract-v8).
 *
 * pypdf keeps every visual line wrap as a line break, and a report's
 * sentences wrap wherever the margin falls ("esas\nalınırsa hizmet süresi").
 * A SINGLE break between a line ending in a lower-case letter (or a comma)
 * and a line starting with a lower-case letter is such a wrap, and so is one
 * followed by a number that is not a date column ("alacağı\n147.905,20 TL",
 * "(binde\n7,59)"). A blank line, a line ending in punctuation, a digit or an
 * upper-case letter, and a next line starting with an upper-case letter
 * (a heading, a table row, a label line: "İşten Çıkış Tarihi : ...") still
 * end the sentence.
 */
function isHardLineBreak(text: string, index: number): boolean {
  // "\r\n" is one break: the "\r" defers to the "\n" after it.
  if (text[index] === "\r" && text[index + 1] === "\n") return false;
  let previous = index - 1;
  while (previous >= 0 && /[ \t\r]/u.test(text[previous] ?? "")) previous -= 1;
  let next = index + 1;
  while (next < text.length && /[ \t]/u.test(text[next] ?? "")) next += 1;
  if (previous < 0 || next >= text.length || isLineBreakAt(text, next)) return true;
  const before = text[previous] ?? "";
  const after = text[next] ?? "";
  if (!/\p{Ll}/u.test(before) && before !== ",") return true;
  if (/\p{Ll}/u.test(after)) return false;
  if (/\p{Nd}/u.test(after) && !DATE_AT_START.test(text.slice(next, next + 11))) return false;
  return true;
}

/**
 * True when the ".", "!", "?" or ";" at `index` ends a sentence.
 *
 * A mark followed by anything but whitespace is inside a value ("01.02.2023",
 * "45.000"). A dot followed by a space (on the same line) does not end one
 * after an ordinal ("9. Hukuk Dairesi", "7. İş Mahkemesi"), a one-letter
 * abbreviation ("2019/1234 E., 2020/5678 K. sayılı", "A.Ş.") or a listed
 * abbreviation ("Av. Zeynep").
 */
function isSentenceMarkEnd(text: string, index: number): boolean {
  const next = text[index + 1];
  if (next !== undefined && !/\s/u.test(next)) return false;
  if (text[index] !== "." || next === undefined || isLineBreakAt(text, index + 1)) return true;
  let start = index;
  while (start > 0 && /[\p{L}\p{M}\p{N}]/u.test(text[start - 1] ?? "")) start -= 1;
  const word = text.slice(start, index);
  if (word === "") return true;
  const before = start > 0 ? (text[start - 1] ?? "") : "";
  if (/^\p{Nd}{1,3}$/u.test(word) && !/[\p{Nd}.,]/u.test(before)) {
    // An ordinal only when a word follows: "9. Hukuk", not "... 1775. \n".
    let after = index + 1;
    while (after < text.length && /[ \t]/u.test(text[after] ?? "")) after += 1;
    return !/\p{L}/u.test(text[after] ?? "");
  }
  if (/^\p{L}$/u.test(word) && !/\p{L}/u.test(before)) return false;
  return !ABBREVIATIONS.has(foldTurkishCase(word));
}

/** A sentence ends at `index` (see isSentenceMarkEnd and isHardLineBreak). */
function isSentenceEnd(text: string, index: number): boolean {
  if (isLineBreakAt(text, index)) return isHardLineBreak(text, index);
  const c = text[index];
  if (c === "." || c === "!" || c === "?" || c === ";") return isSentenceMarkEnd(text, index);
  return false;
}

/** A clause ends at `index`: a sentence end, or a comma that is not inside a number ("1.549,67"). */
function isClauseEnd(text: string, index: number): boolean {
  if (text[index] === ",") {
    return !(/\p{Nd}/u.test(text[index - 1] ?? "") && /\p{Nd}/u.test(text[index + 1] ?? ""));
  }
  return isSentenceEnd(text, index);
}

/** [start, end) of the clause (or sentence) around a value, never past `limit` characters each way. */
function spanAround(
  text: string,
  at: number,
  length: number,
  isEnd: (text: string, index: number) => boolean,
  limit = Number.POSITIVE_INFINITY,
): { start: number; end: number; endMark: number } {
  let start = Math.max(0, at - limit);
  for (let i = at - 1; i >= Math.max(0, at - limit); i -= 1) {
    if (isEnd(text, i)) {
      start = i + 1;
      break;
    }
  }
  let end = Math.min(text.length, at + length + limit);
  let endMark = end;
  for (let i = at + length; i < Math.min(text.length, at + length + limit); i += 1) {
    if (isEnd(text, i)) {
      end = i;
      endMark = isLineBreakAt(text, i) ? i : i + 1;
      break;
    }
  }
  return { start, end, endMark };
}

/**
 * Words that say nothing about WHAT a value is (extract-v8), as topic words:
 * the date words around every date, connectives, and the party roles that
 * stand in almost every sentence of a petition ("davacı", "davalı",
 * "müvekkil", "vekil") and the words that say who reported a fact ("tanık",
 * "beyan", "bilirkişi", "esas alınarak"). Filling the four slots of a key
 * with them made unrelated sentences comparable and the same fact told by
 * two sources incomparable. A heuristic, named as one.
 */
const GENERIC_TOPIC_WORDS: readonly string[] = [
  "tarih", "tarihli", "tarihinde", "tarihinden", "tarihleri", "yıl", "yılında", "gün", "günü",
  "olup", "olan", "idi", "ile", "ise", "için", "gibi", "kadar", "ancak", "fakat",
  "ayrıca", "üzere", "göre", "itibaren", "yana", "beri", "sonra", "önce", "arasında", "arası",
  "bir", "iki", "her", "hiç", "tüm", "bütün", "diğer", "ilgili", "sayın", "esas",
  "etti", "etmiş", "edildi", "oldu", "olduğu", "olmuş", "yapıldı",
  "davacı", "davalı", "müvekkil", "vekil", "tanık", "beyan", "bilirkişi",
];

/** Words read as one topic word (extract-v8): "maaş" and "ücret" name the same thing. */
const TOPIC_SYNONYM_WORDS: ReadonlyArray<readonly [string, string]> = [["maaş", "ücret"]];

/**
 * The first `TOPIC_PREFIX` letters of a word's ASCII-folded stem, or
 * undefined for no content — before the generic words and synonyms of
 * topicStem are applied (the review grid matches party roles with it).
 */
export function topicWordKey(word: string): string | undefined {
  const raw = foldTurkishCase(word.normalize("NFC"));
  if (cpLength(raw) < 3 || /\d/u.test(raw)) return undefined;
  const stem = stemTurkish(raw);
  if (cpLength(stem) < 3 || STOP_STEMS.has(stem)) return undefined;
  return [...asciiFold(stem)].slice(0, TOPIC_PREFIX).join("");
}

const GENERIC_TOPIC_KEYS: ReadonlySet<string> = new Set(
  GENERIC_TOPIC_WORDS.map(topicWordKey).filter((key): key is string => key !== undefined),
);

const TOPIC_SYNONYMS: ReadonlyMap<string, string> = new Map(
  TOPIC_SYNONYM_WORDS.map(([word, canonical]) => [topicWordKey(word) ?? word, topicWordKey(canonical) ?? canonical]),
);

/**
 * One word as it enters a topic key, or undefined when it carries no topic
 * (extract-v8). The stemmer strips one word's inflections differently
 * ("ihtarname" → ihtarnam, "ihtarnamesi" → ihtarname; "müvekkil" → müvekk,
 * "müvekkile" → müvekki; "davalı" → daval, "davalıya" → davalı), so the key
 * word is the first TOPIC_PREFIX letters of the ASCII-folded stem: every
 * inflection of a word, and its spelling without Turkish letters ("teblig",
 * "ihtari"), gives the same key word. Prefix truncation is the classic
 * fixed-length stemmer for Turkish; it may merge two words sharing their
 * first five letters, which is why it only decides what is COMPARED.
 */
export function topicStem(word: string): string | undefined {
  const key = topicWordKey(word);
  if (key === undefined) return undefined;
  const canonical = TOPIC_SYNONYMS.get(key) ?? key;
  return GENERIC_TOPIC_KEYS.has(canonical) ? undefined : canonical;
}

/**
 * A word, with an apostrophe suffix kept attached: "Dairesi'nin",
 * "Mehmet'in", "TL'dir". Only the part before the apostrophe is a word; the
 * suffix ("nin") is never a topic word of its own (extract-v8).
 */
const TOPIC_WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;

/**
 * The topic key of a value: the TOPIC_STEMS topic words NEAREST to it inside
 * its own clause (bounded by . ! ? ; , or a line break that ends a sentence),
 * sorted.
 *
 * W20 replaced the W19 key (stems of the ±160-character quote window,
 * alphabetically first six). Measured on 11 labeled synthetic value pairs at
 * the unchanged 0.4 overlap threshold, the W19 key decided 6/11 correctly —
 * every "different subject" pair was compared, because the window was
 * dominated by neighbouring text ("amaç artırmak bilgi …") — and this key
 * decides 10/11 (the miss: "ihtar" vs "ihtarname" stem differently). That is
 * a synthetic measurement, not a claim about real case files; the key still
 * only decides what is COMPARED, never what is asserted.
 *
 * extract-v8 (W22): the words are topicStem forms, so the W20 miss above is
 * compared now; the measurement on the real iş davası file is in the
 * contradiction tests.
 */
export function topicKeyAround(text: string, at: number, length: number): string {
  const { start, end } = spanAround(text, at, length, isClauseEnd);
  const words: Array<{ stem: string; distance: number }> = [];
  // Combining marks belong to their word: a decomposed (NFD) "Şubat" is one
  // word, folded in its composed form (W21 R2-22).
  for (const match of text.slice(start, end).matchAll(TOPIC_WORD)) {
    const index = start + (match.index ?? 0);
    // W21 R2-22: a word INSIDE the value's own span (a month name, a
    // currency, "milyon") is part of the value, like its digits — never
    // what makes two values comparable.
    if (index >= at && index < at + length) continue;
    const word = match[0].split(/['’]/u)[0] ?? "";
    const stem = topicStem(word);
    if (stem === undefined) continue;
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
 *
 * extract-v8: a sentence ends where isSentenceEnd says so — not at "9." in
 * "9. Hukuk Dairesi", not at "K." in "2020/5678 K. sayılı", not at a single
 * line wrap.
 */
function sentenceOf(text: string, at: number, length: number, fallback: string): string {
  const { start, endMark } = spanAround(text, at, length, isSentenceEnd);
  const sentence = text.slice(start, endMark).trim();
  return sentence === "" || sentence.length > MAX_STATEMENT_CHARS ? fallback : sentence;
}

// ---------------------------------------------------------------------------
// What a value is the value OF (extract-v8)
// ---------------------------------------------------------------------------

/**
 * Events a date can be anchored to. Two dates of the SAME event are compared
 * whatever the rest of their wording (contradictions.ts): "01.03.2018
 * tarihinde işe başlamış" and "İşe Giriş Tarihi : 01.03.2019" share no topic
 * word worth the name, and that pair is the decisive conflict of a labour
 * case. A CLOSED list; a date not matched stays a plain "tarih".
 */
export type DateEvent = "ise_giris" | "isten_cikis" | "teblig" | "ihtarname";

/** The event's name on screen. */
export const DATE_EVENT_TR: Readonly<Record<DateEvent, string>> = {
  ise_giris: "işe giriş",
  isten_cikis: "işten çıkış / fesih",
  teblig: "tebliğ",
  ihtarname: "ihtarname tarihi",
};

/**
 * What an amount is the amount OF, when its own label says so (extract-v10):
 * the net or the gross wage. "son aylık net ücreti 45.000 TL", "aylık net
 * maaşı 32.000 TL" and a payroll line "net ücret 32.000,00 TL" / "Net Ödenen :
 * 32.000,00 TL" answer ONE question whatever their other words, and a gross
 * wage ("Brüt Ücret : 43.529,41 TL") never answers it. A CLOSED list, like
 * DateEvent; an amount not matched stays a plain "tutar" and is compared by
 * its topic key as before.
 */
export type AmountEvent = "net_ucret" | "brut_ucret";

/** Every named event a value can be the value of: a date's or an amount's. */
export type ValueEvent = DateEvent | AmountEvent;

/** The event's name on screen, for dates and amounts. */
export const VALUE_EVENT_TR: Readonly<Record<ValueEvent, string>> = {
  ...DATE_EVENT_TR,
  net_ucret: "net ücret",
  brut_ucret: "brüt ücret",
};

/**
 * A predicate's tag after "#": an event ("olay:teblig", "olay:net_ucret"), or
 * a value that is never compared ("karar" — the date of a cited court
 * decision; "kismi_talep" — an amount claimed as a partial claim).
 */
export const DECISION_DATE_TAG = "karar";
export const PARTIAL_CLAIM_TAG = "kismi_talep";
const EVENT_TAG_PREFIX = "olay:";

export interface PredicateParts {
  /** What is compared for equality: "tarih", "tutar", "tutar:EUR", "oran". */
  readonly base: string;
  /** The event a date (or, extract-v10, an amount) is the value of, when one was recognised. */
  readonly event?: ValueEvent | undefined;
  /** True for a value that is never compared (a decision date, a partial claim). */
  readonly neverCompared: boolean;
  readonly tag?: string | undefined;
}

const DATE_EVENTS: ReadonlySet<string> = new Set(Object.keys(VALUE_EVENT_TR));

/** Split a stored predicate into its comparable base and its tag. */
export function parsePredicate(predicate: string): PredicateParts {
  const hash = predicate.indexOf("#");
  if (hash < 0) return { base: predicate, neverCompared: false };
  const base = predicate.slice(0, hash);
  const tag = predicate.slice(hash + 1);
  if (tag.startsWith(EVENT_TAG_PREFIX)) {
    const event = tag.slice(EVENT_TAG_PREFIX.length);
    return DATE_EVENTS.has(event)
      ? { base, event: event as ValueEvent, neverCompared: false, tag }
      : { base, neverCompared: false, tag };
  }
  return { base, neverCompared: tag === DECISION_DATE_TAG || tag === PARTIAL_CLAIM_TAG, tag };
}

function tagged(base: string, tag: string | undefined): string {
  return tag === undefined ? base : `${base}#${tag}`;
}

/** How far around a value its event or decision wording is looked for (UTF-16 units). */
const EVENT_AFTER_WINDOW = 90;
const EVENT_BEFORE_WINDOW = 60;

/**
 * Job titles a witness uses when telling how someone STARTED work without
 * the word "işe" (extract-v9): "01.03.2018 tarihinde depoya sorumlu olarak
 * geldi", "şoför olarak başladı", "forklift operatörü olarak alındı". A
 * CLOSED list of ASCII-folded stems; a title outside it ("tanık olarak
 * geldi", "müşteri olarak geldi", "bilirkişi olarak atandı") never makes a
 * date an employment start. Litigation roles (tanık, bilirkişi, vekil,
 * memur, temsilci) are left out on purpose: in a case file they arrive at a
 * hearing, not at a job.
 */
const JOB_TITLE =
  String.raw`(?:sorumlu|operator|sofor|surucu|isci|eleman|personel|calisan|mudur|sef(?:i|lig)?|ustabasi|usta|cirak|kalfa|amir|yonetici|muhasebe|sekreter|garson|asci|kasiyer|satis|pazarlamaci|muhendis|teknisyen|tekniker|guvenlik|bekci|temizlik|depocu|kurye|asistan|stajyer|hemsire|ogretmen|kaynakci|montajci|tezgahtar|resepsiyonist|komi|bulasikci|forklift)`;

/**
 * "<job title> olarak (işe) geldi / başladı / alındı / girdi / istihdam
 * edildi" (extract-v9). At most one word may stand between the title and
 * "olarak" ("forklift operatörü", "satış temsilcisi"). "çalıştı" / "çalışıyordu"
 * is not here: "on that date he worked as ..." does not say he started then.
 */
const JOB_START_AFTER = new RegExp(
  String.raw`\b${JOB_TITLE}\w*(?:\s+[a-z]+)?\s+olarak\s+(?:ise\s+|gorev(?:e|ine)\s+)?` +
    String.raw`(?:gel(?:d|m|ig|ec)|basla|alin(?:d|m|ig)|gir(?:d|m|ig)|istihdam\s+edil)`,
  "u",
);

/**
 * "D'den / D tarihinden beri (bu yana) orada / şirketteydi" (extract-v9): a
 * witness saying someone has been AT THE WORKPLACE since a date. The place
 * is a CLOSED list of workplace words or "orada/burada", and it must be the
 * clause's predicate — a bare locative ("… beri şirkette hiçbir denetim
 * yapılmadı") or a first-person copula ("oradayım") is not.
 */
const AT_WORKPLACE_SINCE = new RegExp(
  String.raw`^\s*(?:tarihinden|['’]?[dt][ae]n)\s+(?:bu\s+yana|beri)\s+(?:[a-z]+\s+){0,2}?` +
    String.raw`(?:orada|burada|(?:sirket|isyer|fabrika|depo|magaza|sube|bunye|isletme|santiye|atolye|ofis|buro|firma)[a-z]*?(?:de|da|te|ta))` +
    String.raw`(?:y?d[iu]r?|y?m[iu]s(?:t[iu]r)?|d[iu]r)?\s*$`,
  "u",
);

/** Event wording AFTER a date, in ASCII-folded lower case: the verb that follows it. */
const EVENT_AFTER: ReadonlyArray<readonly [DateEvent, RegExp]> = [
  ["ihtarname", /^\s*tarihli\s+ihtar/u],
  ["ise_giris", /\bise\s+(?:basla|gir|alin)|\bise\s+giris|\bcalismaya\s+basla|\bisbasi/u],
  ["ise_giris", /^\s*(?:tarihinden|['’]?[dt][ae]n)\s+(?:bu\s+yana|beri|itibaren)\b[^.;]{0,70}?\bcalis/u],
  ["ise_giris", JOB_START_AFTER],
  ["ise_giris", AT_WORKPLACE_SINCE],
  ["ise_giris", /\bistihdam\s+edil|\bkadroya\s+alin|\b(?:sigorta|sgk)\w*\s+giris/u],
  ["isten_cikis", /\bfesh|\bfesih|\bisten\s+(?:ayril|cikar|cikis)|\bistifa|\bis\s+akd\w*\s+(?:sona|feshed)|\bsozlesme\w*\s+sona\s+er/u],
  ["teblig", /\bteblig|\btebellug/u],
];

/**
 * Events that belong to ONE PERSON's employment (extract-v9). A WITNESS
 * telling them in the first person singular ("işe başladım", "operatör
 * olarak geldim", "işten ayrıldım") tells the witness's own dates, never the
 * case's işe giriş, and comparing them with the claimant's date would report
 * a contradiction that does not exist. A party telling them in the first
 * person ("Davacı asil beyanında: … işe başladım") tells the case's, and so
 * does a witness who received a tebliğ or an ihtarname, so tebliğ and
 * ihtarname are not in this set.
 */
const PERSONAL_EVENTS: ReadonlySet<DateEvent> = new Set<DateEvent>(["ise_giris", "isten_cikis"]);

/** A first-person singular verb ending (ASCII-folded): -dım, -mışım, -mıştım, -ıyorum, -dığım, -yım. */
const FIRST_PERSON_VERB = /(?:[dt][iu]m|m[iu]s[iu]m|m[iu]st[iu]m|[iu]yorum|[gk][iu]m|y[iu]m)$/u;

/**
 * True when the event wording that starts at `index` in `after` is told in
 * the first person singular: the word the match ends in, or the word after
 * it ("istifa ettim"), carries a first-person ending.
 */
function toldInFirstPerson(after: string, index: number, length: number): boolean {
  const rest = after.slice(index + length);
  const words = rest.match(/^[a-z]*(?:\s+[a-z]+)?/u)?.[0] ?? "";
  const matchedWord =
    (after.slice(index, index + length).match(/[a-z]+$/u)?.[0] ?? "") + (words.match(/^[a-z]*/u)?.[0] ?? "");
  const nextWord = words.replace(/^[a-z]*\s*/u, "");
  return FIRST_PERSON_VERB.test(matchedWord) || (nextWord !== "" && FIRST_PERSON_VERB.test(nextWord));
}

/** How far back the speaker of a statement is looked for (UTF-16 units). */
const SPEAKER_WINDOW = 1500;
/** "Tanık Ali KAYA beyanında:", "Davacı tanığı … ifadesinde" (ASCII-folded). */
const WITNESS_SPEAKER = /\btanig?\w*\b[^.\n]{0,60}?\b(?:beyan|ifade|anlatim)\w*/gu;
/** "Davacı asil beyanında:", "Davalı vekili beyanında" — a party speaking. */
const PARTY_SPEAKER = /\b(?:davaci|davali|asil|musteki|sanik)\b(?:(?!tanig?)[^.\n]){0,40}?\b(?:beyan|ifade|isticvap|anlatim)\w*/gu;

/** The last speaker label before `at`: a witness, a party, or none found. */
function speakerBefore(text: string, at: number): "witness" | "party" | undefined {
  const before = asciiFold(text.slice(Math.max(0, at - SPEAKER_WINDOW), at));
  let witness = -1;
  for (const match of before.matchAll(WITNESS_SPEAKER)) witness = match.index ?? witness;
  let party = -1;
  for (const match of before.matchAll(PARTY_SPEAKER)) party = match.index ?? party;
  if (witness < 0 && party < 0) return undefined;
  return witness > party ? "witness" : "party";
}

/** A label ending right before a date: "İşe Giriş Tarihi : 01.03.2019". */
const EVENT_BEFORE: ReadonlyArray<readonly [DateEvent, RegExp]> = [
  ["ise_giris", /\bise\s+giris\s+tarihi\s*:?\s*$/u],
  ["isten_cikis", /\b(?:isten\s+cikis|fesih|ayrilis)\s+tarihi\s*:?\s*$/u],
  ["teblig", /\b(?:teblig|tebellug)\s+tarihi\s*:?\s*$/u],
  ["ihtarname", /\bihtarname\s+tarihi\s*:?\s*$/u],
];

/** A court before a date that it decided: "Yargıtay 9. Hukuk Dairesi'nin 12.03.2020 tarihli ...". */
const COURT_BEFORE =
  /(?:\bdaire(?:si)?|\bh\.?\s?d\.?|\bc\.?\s?d\.?|\bhgk\b|\bcgk\b|\bibk\b|\bgenel\s+kurulu|\bdanistay|\byargitay|\banayasa\s+mahkemesi|\bbolge\s+adliye)[^.;:]{0,30}$/u;
/** A decision's own date words after its date: "tarihli", "T.", "günlü". */
const DECISION_DATE_WORD = /^\s*(?:tarihli|t\.|gunlu)/u;
/** A decision's number or name within a few words after its date. */
const DECISION_AFTER =
  /^\s*(?:tarihli|t\.|gunlu|tarih\s+ve)\s*,?[^.;]{0,50}?(?:\d{4}\s*\/\s*\d+\s*[ek]\.|sayili\s+karar|\bilam)/u;
/** A künye written number first: "E. 2019/1234, K. 2020/5678, T. 12.03.2020". */
const DECISION_BEFORE_KUNYE = /\b[ek]\.?\s*\d{4}\s*\/\s*\d+\s*,?\s*(?:[ek]\.?\s*\d{4}\s*\/\s*\d+\s*,?\s*)?t\.?\s*:?\s*$/u;

/** A partial claim's wording (ASCII-folded): "şimdilik", "fazlaya ilişkin haklarımız saklı". */
const PARTIAL_CLAIM =
  /\bsimdilik\b|\bfazlaya\s+iliskin\s+(?:hak|talep|alacak|dava)\w*[^.;]{0,30}?\bsakli|\bkismi\s+(?:dava|talep|alacak)|\bbelirsiz\s+alacak/u;

/** A range "D1 - D2" of a period of work, and the words that make it one. */
const RANGE_END_AFTER = /^\s*[-–]\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}/u;
const RANGE_START_BEFORE = /\d{1,2}[./-]\d{1,2}[./-]\d{4}\s*[-–]\s*$/u;
const RANGE_IS_SERVICE = /\bcalis|\bhizmet\s+sure|\bis\s+iliskisi/u;
const RANGE_BETWEEN = /^\s*(?:tarihleri\s+)?aras/u;

interface DateContext {
  readonly event?: DateEvent | undefined;
  readonly decision: boolean;
}

/**
 * What a date is the date of: a cited decision (never compared, never an
 * event), one of the DateEvents, or nothing recognised. Looked for only
 * inside the date's own clause (and, for a decision, its sentence), and
 * never across another date: in "20.12.2023 tarihli ihtarnamesi müvekkile
 * 26.12.2023 tarihinde tebliğ edilmiş", the first date is the ihtarname's
 * and the second the tebliğ's.
 */
function dateContext(text: string, date: DateMatch, dates: readonly DateMatch[]): DateContext {
  const previousEnd = dates.reduce(
    (edge, other) => (other.at + other.length <= date.at ? Math.max(edge, other.at + other.length) : edge),
    0,
  );
  const nextStart = dates.reduce(
    (edge, other) => (other.at >= date.at + date.length ? Math.min(edge, other.at) : edge),
    text.length,
  );
  const sentence = spanAround(text, date.at, date.length, isSentenceEnd, 400);
  const clause = spanAround(text, date.at, date.length, isClauseEnd, 400);
  const dateEnd = date.at + date.length;

  // A cited decision: its sentence carries the court or the decision number.
  const decisionBefore = asciiFold(text.slice(Math.max(sentence.start, date.at - EVENT_BEFORE_WINDOW), date.at));
  const decisionAfter = asciiFold(text.slice(dateEnd, Math.min(sentence.endMark, dateEnd + EVENT_AFTER_WINDOW)));
  if (
    (COURT_BEFORE.test(decisionBefore) && DECISION_DATE_WORD.test(decisionAfter)) ||
    DECISION_AFTER.test(decisionAfter) ||
    DECISION_BEFORE_KUNYE.test(decisionBefore)
  ) {
    return { decision: true };
  }

  const clauseText = asciiFold(text.slice(clause.start, clause.end));
  const rawAfter = text.slice(dateEnd, Math.min(clause.end, dateEnd + EVENT_AFTER_WINDOW));
  // A period of service "D1 - D2 tarihleri arasında ... çalıştığı": D1 is the
  // start of the work and D2 its end.
  if (RANGE_IS_SERVICE.test(clauseText)) {
    const rangeEnd = rawAfter.match(RANGE_END_AFTER);
    if (rangeEnd !== null && RANGE_BETWEEN.test(asciiFold(rawAfter.slice(rangeEnd[0].length)))) {
      return { event: "ise_giris", decision: false };
    }
    const rawBefore = text.slice(Math.max(clause.start, date.at - 20), date.at);
    if (RANGE_START_BEFORE.test(rawBefore) && RANGE_BETWEEN.test(asciiFold(rawAfter))) {
      return { event: "isten_cikis", decision: false };
    }
  }

  // The event verb after the date, up to the next date: the first one wins.
  const after = asciiFold(text.slice(dateEnd, Math.min(clause.end, nextStart, dateEnd + EVENT_AFTER_WINDOW)));
  let best: { event: DateEvent; index: number; length: number } | undefined;
  for (const [event, pattern] of EVENT_AFTER) {
    const found = after.match(pattern);
    if (found?.index !== undefined && (best === undefined || found.index < best.index)) {
      best = { event, index: found.index, length: found[0].length };
    }
  }
  if (best !== undefined) {
    // extract-v9: a witness's "işe başladım" is the witness's own start, not the case's.
    if (
      PERSONAL_EVENTS.has(best.event) &&
      toldInFirstPerson(after, best.index, best.length) &&
      speakerBefore(text, date.at) === "witness"
    ) {
      return { decision: false };
    }
    return { event: best.event, decision: false };
  }

  // A label right before the date ("İşe Giriş Tarihi : ").
  const before = asciiFold(text.slice(Math.max(clause.start, previousEnd, date.at - EVENT_BEFORE_WINDOW), date.at));
  for (const [event, pattern] of EVENT_BEFORE) {
    if (pattern.test(before)) return { event, decision: false };
  }
  return { decision: false };
}

/**
 * An amount claimed as a partial claim: its clause, or its sentence before
 * it, says "şimdilik", "fazlaya ilişkin haklarımız saklı kalmak kaydıyla",
 * "kısmi dava" or "belirsiz alacak". "Şimdilik 5.000 TL ihbar tazminatı" and
 * a bilirkişi's 99.284,50 TL are not two answers to one question.
 */
function isPartialClaim(text: string, at: number, length: number): boolean {
  const clause = spanAround(text, at, length, isClauseEnd, 400);
  if (PARTIAL_CLAIM.test(asciiFold(text.slice(clause.start, clause.end)))) return true;
  const sentence = spanAround(text, at, length, isSentenceEnd, 1500);
  return PARTIAL_CLAIM.test(asciiFold(text.slice(sentence.start, at)));
}

/**
 * How far before an amount its label is looked for (UTF-16 units), and the
 * label itself (extract-v10), ASCII-folded: "net" or "brüt", at most one of
 * "aylık / son / toplam" between it and the wage noun (ücret, maaş, ödenen,
 * ele geçen), then the amount — right after the noun, or after a label's
 * ":" / "=". "son aylık net ücreti 45.000 TL", "aylık net maaşı 32.000 TL",
 * "Net Ücret : 32.000,00 TL", "NET ÖDENEN 32.000,00 TL".
 *
 * The noun must be the LAST word before the amount, so "net fazla çalışma
 * ücreti alacağı 147.905,20 TL" (a claim, not a wage), "net kıdem tazminatı
 * 203.412,67 TL" and "prime esas kazanç" carry no label. And a word naming
 * another kind of pay between "net" and the noun ("net fazla mesai ücreti",
 * "net ikramiye") is not the wage either.
 */
const WAGE_LABEL_WINDOW = 60;
const WAGE_LABEL = new RegExp(
  String.raw`\b(net|brut)\s+(?:(?:aylik|son|toplam)\s+){0,2}` +
    String.raw`(?:ucret(?:i|in)?|maas(?:i|in)?|odenen|ele\s+gecen)\s*(?:[:=]\s*)?$`,
  "u",
);

/** The wage an amount is labelled as, or undefined (see WAGE_LABEL). */
function wageLabelOf(text: string, at: number, length: number): AmountEvent | undefined {
  const clause = spanAround(text, at, length, isClauseEnd, 400);
  // A label line ("Net Ücret : 32.000,00") ends its clause at the colon's
  // line; the amount's own line is enough.
  const before = asciiFold(text.slice(Math.max(clause.start, at - WAGE_LABEL_WINDOW), at)).replace(/\s+/gu, " ");
  const found = before.match(WAGE_LABEL);
  if (found === null) return undefined;
  return found[1] === "net" ? "net_ucret" : "brut_ucret";
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

  const dates = dateMatches(unitText);
  for (const date of dates) {
    const { quote, startChar, endChar } = sliceQuote(unitText, date.at, date.length);
    // extract-v8: the date of a cited decision is never compared and never
    // an event; the date of a named event is compared with that event's
    // other dates (contradictions.ts).
    const context = dateContext(unitText, date, dates);
    const tag = context.decision
      ? DECISION_DATE_TAG
      : context.event !== undefined
        ? `${EVENT_TAG_PREFIX}${context.event}`
        : undefined;
    push({
      kind: "date",
      statement: sentenceOf(unitText, date.at, date.length, quote),
      subject: topicKeyAround(unitText, date.at, date.length),
      predicate: tagged("tarih", tag),
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
    // extract-v8: an amount claimed "şimdilik" is a partial claim, never a
    // statement of what is owed, and is never compared.
    const partial = isPartialClaim(unitText, amount.at, amount.length);
    // extract-v10: an amount labelled as the net or gross wage is the value
    // of that wage (a partial claim is never compared, so it keeps its tag).
    const wage = partial ? undefined : wageLabelOf(unitText, amount.at, amount.length);
    const tag = partial ? PARTIAL_CLAIM_TAG : wage !== undefined ? `${EVENT_TAG_PREFIX}${wage}` : undefined;
    push({
      kind: "amount",
      statement: sentenceOf(unitText, amount.at, amount.length, quote),
      subject: topicKeyAround(unitText, amount.at, amount.length),
      // A foreign amount is compared only with amounts in the same currency.
      predicate: tagged(domestic ? "tutar" : `tutar:${amount.currency}`, tag),
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

/**
 * A value the deterministic patterns read, as a bare span (UTF-16 index and
 * length within `text`). Added for the answer-shape check
 * (answer/answerShape.ts): it asks "does this passage carry a date / an
 * amount / a ratio?" with the SAME patterns the matter analysis reads, so a
 * value the census would not recognise is not recognised there either.
 * Reading only — the extractor's own output is unchanged (EXTRACTOR_VERSION
 * stays), and every amount is returned whatever its currency.
 */
export interface RecognisedValueSpan {
  readonly kind: PropositionKind;
  readonly at: number;
  readonly length: number;
  /** A date is the date of a cited decision (see dateContext). */
  readonly decisionDate?: boolean;
}

/** Every date, amount and ratio the extractor's patterns read in `text`, in text order. */
export function recognisedValueSpans(text: string): RecognisedValueSpan[] {
  const out: RecognisedValueSpan[] = [];
  const dates = dateMatches(text);
  for (const date of dates) {
    out.push({ kind: "date", at: date.at, length: date.length, decisionDate: dateContext(text, date, dates).decision });
  }
  for (const amount of amountMatches(text)) out.push({ kind: "amount", at: amount.at, length: amount.length });
  for (const match of text.matchAll(RATIO)) {
    out.push({ kind: "ratio", at: match.index ?? 0, length: match[0].length });
  }
  return out.sort((left, right) => left.at - right.at || left.length - right.length);
}

/**
 * [start, end) (UTF-16) of the sentence holding the span at `at`, by the
 * extractor's own sentence rules (isSentenceEnd: wrapped PDF lines stay one
 * sentence, a label line "İşe Giriş Tarihi : …" is its own, "9. Hukuk
 * Dairesi" and "Av. Zeynep" do not end one), never more than 400 characters
 * each way.
 */
export function sentenceSpanAround(text: string, at: number, length: number): { start: number; end: number } {
  const span = spanAround(text, at, length, isSentenceEnd, 400);
  return { start: span.start, end: span.endMark };
}

/** How far around a value-like word a digit is looked for (UTF-16 units). */
const MENTION_WINDOW: Readonly<Record<"date" | "amount", { before: number; after: number }>> = {
  date: { before: 12, after: 12 },
  amount: { before: 20, after: 4 },
};

/** Longest example returned per mention. */
const MAX_MENTION_CHARS = 60;

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

/**
 * A number written the way Turkish writes money and little else: dot-grouped
 * thousands and exactly two decimals ("204.962,34", "1.549,67"). A date
 * ("01.03.2018") has no comma, a ratio ("7,59") no thousands group.
 */
const MONEY_SHAPED = /(?<![\p{L}\p{N}.,])\d{1,3}(?:\.\d{3})+,\d{2}(?![\p{N}]|[.,]\d)/gu;

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
  // The text each named mention already shows (W22): a money-shaped number
  // inside it ("Tutar TL" / "45.000,00") is not named a second time.
  const shown: Array<readonly [number, number]> = [];
  const push = (at: number, from: number, to: number, floor: number, ceiling: number): void => {
    const snippet = mentionSnippet(unitText, from, to, floor, ceiling);
    shown.push([from, to]);
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
    // extract-v8: a money-shaped number the amount patterns did not read. A
    // calculation table carries its currency in the column header ("Brüt
    // (TL)"), not next to "204.962,34", so every figure of such a table was
    // neither read nor named and the census said COMPLETE.
    for (const match of unitText.matchAll(MONEY_SHAPED)) {
      const at = match.index ?? 0;
      if (covered(at)) continue;
      if (shown.some(([from, to]) => at >= from && at < to)) continue;
      const lineStart = lines.startOf(at);
      const lineEnd = lines.endOf(at + match[0].length);
      push(at, Math.max(lineStart, at - window.before), Math.min(lineEnd, at + match[0].length + window.after), lineStart, lineEnd);
    }
  }
  return found.sort((left, right) => left.at - right.at).map((entry) => entry.snippet);
}

export function quoteSha256(quote: string): string {
  return createHash("sha256").update(quote, "utf8").digest("hex");
}
