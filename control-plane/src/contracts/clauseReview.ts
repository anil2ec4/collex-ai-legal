/**
 * Sözleşme / kontrol listesi inceleme motoru — RULE BASED (W14 · B-24).
 *
 * WHAT THIS IS. A contract is split into clauses; a checklist the lawyer
 * wrote (kira: depozito · artış oranı · tahliye taahhüdü · damga vergisi) is
 * run over them; each checklist item comes back VAR / YOK / BELİRSİZ with the
 * clause that satisfied it and the contract's own sentence. That is the whole
 * mechanism.
 *
 * WHAT THIS IS NOT, and must never be sold as. There is no model here, no
 * judgement, no "AI review". W13-DEJURE's `/sozlesme` claims to analyse a
 * contract "for risk, gaps and non-compliance" and to "offer improvements per
 * clause"; W13-GLOBAL notes Spellbook's Custom Playbooks and CoCounsel's
 * Contract Policy Compliance do the same job — and that the same job is
 * buildable with zero hallucination risk if it stays rule-based. It stays
 * rule-based.
 *
 * THE HARD LINE ON THE WORD "RİSK". A line may call something a risk ONLY
 * when it is bound to a hash-verified quote from a legal source THE SERVER
 * HOLDS (an answer run in the answer store — `verifyReviewEvidence`). A quote
 * hashed against the digest the request itself supplied proves only that the
 * caller can compute SHA-256: that was the 2026-09-27 defect, where a
 * fabricated "[Kaynak: TBK m. 999]" printed as sourced. Everything else is an
 * OBSERVATION, is prefixed `⚠ KAYNAKSIZ`, and is forbidden from using the word
 * "risk" at all — the test suite asserts this.
 *
 * WHAT AN ABSENCE MEANS. `YOK` says the checklist term was not FOUND in the
 * text we were given. It never says the contract is defective, and it never
 * says a term is legally required — that is the lawyer's call, and the
 * report says so in those words.
 *
 * HOW A TERM MATCHES (2026-09-27; every rule below closed a measured false
 * YOK or false VAR on a real contract shape, see
 * tests/contracts/clauseReview.test.ts). Deterministic, documented, and NOT
 * fuzzy — there is no edit distance and no score anywhere:
 *
 *  1. Both sides are folded the same way (`foldForMatch`): NFC, invisible
 *     characters dropped, whitespace collapsed, İ/I/ı/i all → "i" (tr-TR
 *     lower-casing turned ASCII "IBAN" into "ıban" and missed "iban"),
 *     â/î/û → a/i/u ("cezaî" = "cezai"), and the izafet hyphen "ceza-i"
 *     → "cezai".
 *  2. Every term word must START a word (`(?<![\p{L}\p{N}])`, Unicode-aware;
 *     JS `\b` is ASCII-only) — "sla" is not inside "Maslak". A word of four
 *     or more letters is a PREFIX, so Turkish inflection matches ("depozitonun");
 *     a word of three letters or fewer ("sla", "icc", "ay") matches whole, or
 *     with an apostrophe suffix ("SLA'da"), because a three-letter prefix
 *     matches half the dictionary.
 *  3. A term word followed directly by the privative -siz/-sız/-suz/-süz does
 *     NOT match: "faizsiz" is the absence of faiz.
 *  4. Each term word also matches a small, closed set of VARIANTS
 *     (`termWordVariants`): final-consonant alternation p↔b, ç↔c, t↔d, k↔ğ
 *     (and nk→ng) — "temerrüt" ~ "temerrüde"; the dropped-vowel stems of a
 *     closed list (`DROPPED_VOWEL_STEMS`: fesih→fesh, akit→akd, hüküm→hükm …)
 *     — "fesih" ~ "feshedeceğini"; and, for the HEAD words of a multi-word
 *     term only (not its first word), the compound suffix is peeled once
 *     (-ması/-mesi, -sı/-si/-su/-sü, or a final -ı/-i/-u/-ü after a consonant),
 *     never leaving a stem shorter than four letters — "tahliye taahhüdü"
 *     ~ "tahliye taahhütnamesiyle", "sorumluluk sınırlaması" ~ "sorumluluğun
 *     sınırlandırılması".
 *  5. A match inside a sentence with a NEGATIVE predicate (`NEGATION`:
 *     -mamış/-memiş, -mamakta/-memekte, yok/yoktur, -mayacak/-meyecek,
 *     -madığı/-mediği) cannot make an item VAR: "depozito alınmamıştır" is a
 *     sentence ABOUT depozito that says there is none. If every strong match
 *     is negated the item is BELİRSİZ and says why. A conditional
 *     "-madığı takdirde / hâlde / sürece" and "-madığında" are conditions, not
 *     negations, and are removed before the test.
 *  6. Weak terms (`weakTerms`) make an item BELİRSİZ only when no strong term
 *     matched: a strong term anywhere wins (the editor label says exactly
 *     this).
 *
 * OFFSETS. Excerpts are cut in Unicode CODE POINTS (`Array.from`), never with
 * `.length`/`.slice` over the text (ADR-003).
 */

import { canonicalQuoteText } from "../drafting/quoteIntegrity.js";
import { draftEvidenceLabel } from "../drafting/evidence.js";
import type { DraftAnswerLookup } from "../drafting/types.js";
import { sha256HexUtf8 } from "../verification/validator.js";

export const CONTRACT_REVIEW_SCHEMA = "collex.contract-review/v1";

export const CLAUSE_STATES = ["VAR", "YOK", "BELIRSIZ"] as const;
export type ClauseState = (typeof CLAUSE_STATES)[number];

export const CLAUSE_STATE_LABEL_TR: Readonly<Record<ClauseState, string>> = Object.freeze({
  VAR: "var",
  YOK: "yok",
  BELIRSIZ: "belirsiz",
});

export const CLAUSE_STATE_MEANING_TR: Readonly<Record<ClauseState, string>> = Object.freeze({
  VAR: "Bu başlığı karşılayan bir madde bulundu (madde numarası yanında).",
  YOK:
    "Bu başlık, incelenen metinde BULUNAMADI. Bu, maddenin hukuken zorunlu olduğu" +
    " ya da sözleşmenin sakat olduğu anlamına gelmez — değerlendirme avukatındır.",
  BELIRSIZ:
    "Bir madde bu başlıkla ilişkili görünüyor ancak karşılayıp karşılamadığına" +
    " karar verilemedi; maddeyi okuyun.",
});

/** Why a BELİRSİZ row is BELİRSİZ — machine code, shown only in parentheses. */
export type FindingReasonCode = "" | "NEGATED" | "WEAK_ONLY";

export const FINDING_REASON_TR: Readonly<Record<Exclude<FindingReasonCode, "">, string>> =
  Object.freeze({
    NEGATED: "Madde bulundu ama olumsuz ifade içeriyor — okuyup karar verin.",
    WEAK_ONLY:
      "Yalnızca şüpheli ifade bulundu; kesin ifadelerden hiçbiri geçmiyor — okuyup karar verin.",
  });

/** The unsupported marker, identical to the drafting surface. */
export const KAYNAKSIZ_PREFIX = "⚠ KAYNAKSIZ";

/** Verbatim notices the report always carries. */
export const REVIEW_NOTICES: readonly string[] = Object.freeze([
  "Bu inceleme, sözleşme metnini sizin kontrol listenizle satır satır" +
    " karşılaştırmaktan ibarettir. Hukukî değerlendirme yapmaz, yorum üretmez" +
    " ve yapay zekâ kullanmaz.",
  '"yok" satırı, aranan başlığın metinde bulunamadığını söyler; maddenin gerekli' +
    " olup olmadığına avukat karar verir.",
  "Kaynağa bağlanamayan hiçbir gözlem 'risk' olarak adlandırılmaz;" +
    ` ${KAYNAKSIZ_PREFIX} etiketiyle ve gözlem olarak yazılır.`,
]);

/** Excerpt ceiling, in code points (ellipses included). */
export const EXCERPT_MAX_CODE_POINTS = 300;

/** How many matched sentences one finding carries (the first is the primary). */
export const MAX_MATCHES_PER_FINDING = 5;

/** One clause of the reviewed document. */
export interface ReviewClause {
  /** "5" / "5.2" as the document numbers it; "" when unnumbered. */
  number: string;
  /** The clause text, verbatim (after character hygiene: NFC, no controls). */
  text: string;
  /** 0-based order in the document. */
  index: number;
  /** A heading-only line that titles this clause ("ÜCRET"); "" when none. */
  title: string;
  /**
   * The section heading the clause sits under ("ÖZEL ŞARTLAR"); "" when none.
   * A heading is a SECTION only when the numbering (re)starts at 1 below it.
   */
  section: string;
}

/** One item of the lawyer's own checklist. */
export interface ChecklistItem {
  id: string;
  /** What the lawyer calls it ("Depozito"). */
  label: string;
  /**
   * Words/phrases whose presence satisfies the item. Matching is described in
   * the module header — folded, word-start, closed variant set, never fuzzy.
   */
  terms: string[];
  /**
   * Terms that make the item BELİRSİZ rather than VAR when they are the only
   * thing found. A strong term anywhere in the contract wins.
   */
  weakTerms?: string[];
  /** The lawyer's own note, printed with the row. */
  note?: string;
}

/** A saved checklist ("Kira sözleşmesi kontrol listesi"). */
export interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

/** A hash-bound legal source a risk line may lean on, as the REQUEST offers it. */
export interface ReviewEvidence {
  evidenceId: string;
  label: string;
  quote: string;
  quoteSha256: string;
  /**
   * The answer run that holds this quote. Without it (or without an answer
   * store behind the router) the entry cannot be verified and sources nothing.
   */
  runId?: string;
}

/** A source the SERVER vouched for (`verifyReviewEvidence`). */
export interface VerifiedReviewEvidence {
  evidenceId: string;
  /** The server-held label; the request's own label is never printed. */
  label: string;
  quoteSha256: string;
}

/** One sentence of the contract that matched a checklist term. */
export interface ReviewMatch {
  clauseIndex: number;
  /** Same form as `ChecklistFinding.clauseNumbers` ("5", "#1"). */
  clauseNumber: string;
  /** Display label ("Özel Şartlar 1", "Madde 5", "Giriş"). */
  clauseLabel: string;
  /** The lawyer's term, as written in the checklist. */
  term: string;
  strength: "strong" | "weak";
  /** True when the matched sentence carries a negative predicate. */
  negated: boolean;
  /** The contract's own sentence, whitespace-collapsed, ≤ 300 code points. */
  excerpt: string;
}

export interface ChecklistFinding {
  itemId: string;
  label: string;
  state: ClauseState;
  stateLabel: string;
  /** Clause numbers that matched; empty for YOK. */
  clauseNumbers: string[];
  /** The matched term, so the lawyer can see WHY it matched. */
  matchedTerm: string;
  note: string;
  /** Additive: the clause indexes behind `clauseNumbers`, same order. */
  clauseIndexes: number[];
  /** Additive: display labels behind `clauseNumbers` ("Özel Şartlar 1"). */
  clauseLabels: string[];
  /** Additive: why a BELİRSİZ row is BELİRSİZ; "" otherwise. */
  reasonCode: FindingReasonCode;
  /** Additive: the Turkish sentence for `reasonCode`; "" otherwise. */
  reason: string;
  /** Additive: the primary matched sentence; "" for YOK. */
  excerpt: string;
  /** Additive: the clause index of `excerpt`; null for YOK. */
  excerptClauseIndex: number | null;
  /** Additive: every matched sentence the state rests on (≤ 5, primary first). */
  matches: ReviewMatch[];
}

export interface ClauseObservation {
  text: string;
  sourced: boolean;
  evidenceId: string;
  evidenceLabel: string;
}

/** An observation whose `clauseIndex` names no clause of this text. */
export interface UnattachedObservation extends ClauseObservation {
  clauseIndex: number;
  /** Turkish: why it is not under a clause. */
  note: string;
}

/** A per-clause line of the report. */
export interface ClauseLine {
  clauseNumber: string;
  index: number;
  /** Additive: display label ("Özel Şartlar 1", "Madde 5", "Giriş"). */
  label: string;
  /** Checklist items this clause satisfied. */
  itemIds: string[];
  observations: ClauseObservation[];
}

export interface ContractReviewReport {
  schema: typeof CONTRACT_REVIEW_SCHEMA;
  documentTitle: string;
  checklistId: string;
  checklistTitle: string;
  generatedAt: string;
  clauseCount: number;
  findings: ChecklistFinding[];
  clauses: ClauseLine[];
  /** Additive: observations that could not be attached, never dropped. */
  unattachedObservations: UnattachedObservation[];
  totals: Record<ClauseState, number>;
  notices: string[];
}

export class ContractReviewError extends Error {}

// ---------------------------------------------------------------------------
// Character hygiene
// ---------------------------------------------------------------------------

/** C0/C1 controls a DOCX cannot carry (tab and newline are handled apart). */
const DISALLOWED_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u0084\u0086-\u009f]/gu;
/** Zero-width / BiDi controls and the soft hyphen: invisible, so they decide nothing. */
const INVISIBLE_CHARS = /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;
/** With the `u` flag this matches only an UNPAIRED surrogate. */
const LONE_SURROGATE = /[\ud800-\udfff]/gu;

/**
 * The text the review reads and quotes: newlines normalized, controls and
 * invisible characters dropped, NFC. Deliberately NOT the markdown render
 * guard: nothing here is rendered as markup (the console assigns
 * `textContent`, the DOCX writes runs), and the guard's entity escapes would
 * print "&lt;" into a verbatim excerpt.
 */
function hygiene(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u2028\u2029\u0085]/gu, "\n")
    .replace(DISALLOWED_CONTROLS, "")
    .replace(INVISIBLE_CHARS, "")
    .replace(LONE_SURROGATE, "")
    .normalize("NFC");
}

/** Plain, single-line text for an observation (no markup, no escapes). */
function plainLine(text: string): string {
  return canonicalQuoteText(hygiene(text).replace(/\t/gu, " "));
}

// ---------------------------------------------------------------------------
// Clause splitting
// ---------------------------------------------------------------------------

/** "Madde 5", "MADDE 5-ÜCRET", "Md. 6 –", "Madde 7:" — keyword markers. */
const KEYWORD_MARKER =
  /^\s*(?:MADDE|Madde|Md\.?)(?![\p{L}])\s*(\d{1,3}(?:\.\d{1,3})*)(?![\d'’\p{L}])\s*(?:[.)\-–—:]\s*)?(.*)$/u;
/** "5." / "5.2." — a dotted number with a trailing dot. */
const DOTTED_MARKER = /^\s*(\d{1,3}(?:\.\d{1,3})*)\.(?=\s|$|[\p{L}"“'‘(])\s*(.*)$/u;
/** "5-" / "5–" / "5)" — a number with a dash or a closing parenthesis. */
const DASH_MARKER = /^\s*(\d{1,3}(?:\.\d{1,3})*)\s*[)\-–—](?=\s|$|[\p{L}"“'‘(])\s*(.*)$/u;
/** "5.2 Başlık" — a multi-level number, no trailing dot, capitalised text after. */
const MULTILEVEL_MARKER = /^\s*(\d{1,3}(?:\.\d{1,3})+)\s+(?=[\p{Lu}"“(])(.*)$/u;
/** dd.mm.yyyy at the start of a line is a date, never a clause number. */
const LEADING_DATE = /^\s*\d{1,2}[./]\d{1,2}[./]\d{2,4}/u;
/** A unit word right after the number makes it a quantity, not a clause. */
const UNIT_AFTER_NUMBER =
  /^(?:gün|ay|yil|saat|hafta|dakika|tl|try|usd|eur|euro|adet|kat|m2|m²|metrekare|%)(?![\p{L}\p{N}])/u;

interface MarkerHit {
  number: string;
  /** What follows the marker on the same line (heading or first sentence). */
  rest: string;
}

/**
 * Recognise a clause marker at the start of a line. A bare number needs a
 * separator ("5.", "5-", "5)") — "30 gün içinde" on a wrapped line is text —
 * and is never a date or a quantity ("12. ay", "2.500 TL").
 */
export function parseClauseMarker(line: string): MarkerHit | undefined {
  const keyword = line.match(KEYWORD_MARKER);
  if (keyword !== null) return { number: keyword[1] as string, rest: (keyword[2] ?? "").trim() };
  if (LEADING_DATE.test(line)) return undefined;
  const hit = line.match(DOTTED_MARKER) ?? line.match(DASH_MARKER) ?? line.match(MULTILEVEL_MARKER);
  if (hit === null) return undefined;
  const number = hit[1] as string;
  // "2.500" is an amount: a sub-number never has three digits.
  if (number.split(".").slice(1).some((part) => part.length >= 3)) return undefined;
  const rest = (hit[2] ?? "").trim();
  if (UNIT_AFTER_NUMBER.test(foldForMatch(rest))) return undefined;
  return { number, rest };
}

/** All letters upper-case, at least two of them: a heading, not a sentence. */
function isHeadingLike(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  const letters = trimmed.match(/\p{L}/gu);
  if (letters === null || letters.length < 2) return false;
  return !/\p{Ll}/u.test(trimmed);
}

/** A stand-alone heading line (short, capitals) that is not a marker. */
function isHeadingOnlyLine(line: string): boolean {
  return isHeadingLike(line) && Array.from(line.trim()).length <= 100;
}

/**
 * The previous line closed a sentence (or a blank line / the start of the
 * document came first): a heading may start here. Without this, the wrapped
 * lines of a contract written entirely in capitals would read as headings.
 */
function closesSentence(line: string | undefined): boolean {
  if (line === undefined) return true;
  return /[.!?:;…)"”]\s*$/u.test(line) || isHeadingLike(line);
}

interface ClauseDraft {
  number: string;
  parts: string[];
  title: string;
  section: string;
  /** Only the marker line so far (a bare "MADDE 3" waiting for its title). */
  markerOnly: boolean;
}

/**
 * Split a contract into clauses. Explainable on purpose:
 *
 *  - a clause starts at a marker line (`parseClauseMarker`);
 *  - text before the first marker becomes an unnumbered leading clause
 *    ("Giriş"), so nothing is silently dropped;
 *  - a heading-only line (capitals, no sentence) belongs to the FOLLOWING
 *    clause as its title — "SÖZLEŞMENİN FESHİ" above "Madde 5" is Madde 5's
 *    title, not the tail of Madde 4. Directly under a bare "MADDE 3" it is
 *    Madde 3's title;
 *  - a heading directly above a numbering that (re)starts at 1 is a SECTION
 *    ("GENEL ŞARTLAR", "ÖZEL ŞARTLAR") and names every clause below it until
 *    the next section.
 */
export function splitClauses(text: string): ReviewClause[] {
  const lines = hygiene(text).split("\n");
  const clauses: ReviewClause[] = [];
  let current: ClauseDraft | undefined;
  let pending: string[] = [];
  let section = "";
  let lastTop = 0;
  let previousContent: string | undefined;

  const flush = (): void => {
    if (current === undefined) return;
    const body = current.parts.join("\n").trim();
    if (body !== "") {
      clauses.push({
        number: current.number,
        text: body,
        index: clauses.length,
        title: current.title,
        section: current.section,
      });
    }
    current = undefined;
  };

  for (const line of lines) {
    const marker = parseClauseMarker(line);
    if (marker !== undefined) {
      const top = Number.parseInt(marker.number.split(".")[0] as string, 10);
      const topLevel = !marker.number.includes(".");
      let title = "";
      // The held-back heading lines travel INTO the new clause (nothing is
      // dropped), except before the first clause, where they are the
      // document's own title and stay in the leading block.
      let parts = [...pending, line];
      if (pending.length > 0) {
        const heading = pending.join(" ").replace(/\s+/gu, " ").trim();
        if (current === undefined) {
          current = { number: "", parts: [...pending], title: "", section: "", markerOnly: false };
          parts = [line];
        } else if (topLevel && (top === 1 || top <= lastTop)) {
          section = heading;
        } else {
          title = heading;
        }
      }
      flush();
      if (title === "" && isHeadingLike(marker.rest)) title = marker.rest;
      current = { number: marker.number, parts, title, section, markerOnly: marker.rest === "" };
      pending = [];
      if (topLevel) lastTop = top;
      // A marker line that carries only a title ("Md. 6 – GİZLİLİK") closes
      // like a heading, whatever the case of its keyword.
      previousContent = marker.rest === "" || isHeadingLike(marker.rest) ? undefined : line;
      continue;
    }

    if (line.trim() === "") {
      if (pending.length === 0 && current !== undefined) current.parts.push(line);
      previousContent = undefined;
      continue;
    }

    if (isHeadingOnlyLine(line) && closesSentence(previousContent)) {
      if (current !== undefined && current.markerOnly && current.title === "") {
        current.parts.push(line);
        current.title = line.trim();
        current.markerOnly = false;
      } else {
        pending.push(line);
      }
      previousContent = line;
      continue;
    }

    // Ordinary content: a heading held back and followed by text (not by a
    // marker) heads the block it is in, exactly as before.
    if (current === undefined) {
      current = { number: "", parts: [], title: "", section: "", markerOnly: false };
    }
    if (pending.length > 0) {
      current.parts.push(...pending);
      pending = [];
    }
    current.parts.push(line);
    current.markerOnly = false;
    previousContent = line;
  }
  if (pending.length > 0) {
    if (current === undefined) {
      current = { number: "", parts: [], title: "", section: "", markerOnly: false };
    }
    current.parts.push(...pending);
  }
  flush();
  return clauses;
}

/** Display number of a clause: its own, or a positional "#n". */
export function clauseLabel(clause: ReviewClause): string {
  return clause.number === "" ? `#${clause.index + 1}` : clause.number;
}

/** "ÖZEL ŞARTLAR" → "Özel Şartlar" (Turkish casing). */
function titleCaseTr(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => {
      const cps = Array.from(word.toLocaleLowerCase("tr-TR"));
      if (cps.length === 0) return word;
      return (cps[0] as string).toLocaleUpperCase("tr-TR") + cps.slice(1).join("");
    })
    .join(" ");
}

/**
 * Human labels for every clause: "Giriş" for the unnumbered leading block,
 * "Madde 5" normally, and "Özel Şartlar 1" when the numbering restarts under
 * section headings — so "1" is never ambiguous on screen or on paper.
 */
export function clauseDisplayLabels(clauses: readonly ReviewClause[]): string[] {
  const counts = new Map<string, number>();
  for (const clause of clauses) {
    if (clause.number !== "") counts.set(clause.number, (counts.get(clause.number) ?? 0) + 1);
  }
  const restarted = [...counts.values()].some((n) => n > 1);
  const labels = clauses.map((clause) => {
    if (clause.number === "") {
      return clause.index === 0 ? "Giriş" : `Numarasız bölüm ${clause.index + 1}`;
    }
    if (restarted && clause.section !== "") {
      return `${titleCaseTr(clause.section)} ${clause.number}`;
    }
    return `Madde ${clause.number}`;
  });
  // Two sections with the same heading (or a restart with no heading at all)
  // would still collide: the position disambiguates, it is never guessed.
  const seen = new Map<string, number>();
  for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);
  return labels.map((label, index) =>
    (seen.get(label) ?? 0) > 1 ? `${label} (metindeki ${index + 1}. bölüm)` : label,
  );
}

// ---------------------------------------------------------------------------
// Folding and term matching
// ---------------------------------------------------------------------------

interface FoldedText {
  /** The folded comparison string. */
  text: string;
  /** For every UTF-16 unit of `text`, the CODE POINT index in the source. */
  origin: number[];
}

const WHITESPACE = /\s/u;
const LETTER = /\p{L}/u;

function foldChar(ch: string): string {
  if (ch === "İ" || ch === "I" || ch === "ı") return "i";
  const lower = ch.toLowerCase();
  if (lower === "â") return "a";
  if (lower === "î") return "i";
  if (lower === "û") return "u";
  return lower;
}

/**
 * Fold a text for matching and keep, per folded unit, the code-point index it
 * came from — so a match can be quoted from the ORIGINAL text without any
 * code-unit arithmetic on it.
 */
function foldWithOrigin(source: string): FoldedText {
  const cps = Array.from(source);
  // Built as an array and joined once: reading back a string that is still
  // being concatenated (`endsWith`) flattens it every time — quadratic on a
  // long clause.
  const out: string[] = [];
  const origin: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < cps.length; i += 1) {
    const ch = cps[i] as string;
    if (WHITESPACE.test(ch)) {
      if (!lastWasSpace) {
        out.push(" ");
        origin.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    // Izafet hyphen: "ceza-i" / "cezâ-î" reads as "cezai".
    if (ch === "-" && i > 0 && LETTER.test(cps[i - 1] as string)) {
      const next = cps[i + 1];
      const after = cps[i + 2];
      if (next !== undefined && foldChar(next) === "i" && (after === undefined || !LETTER.test(after))) {
        continue;
      }
    }
    const folded = foldChar(ch);
    out.push(folded);
    lastWasSpace = false;
    for (let unit = 0; unit < folded.length; unit += 1) origin.push(i);
  }
  return { text: out.join(""), origin };
}

/** The folded comparison form of a short string (a term, a sentence). */
export function foldForMatch(value: string): string {
  return foldWithOrigin(canonicalQuoteText(hygiene(value))).text.trim();
}

/**
 * Closed list of dropped-vowel stems (folded form). "fesih" inflects as
 * "feshi", so no prefix of "fesih" reaches "feshedeceğini". Deliberately a
 * list, not a rule: "zarar" → "zararı" keeps its vowel.
 */
const DROPPED_VOWEL_STEMS: Readonly<Record<string, string>> = Object.freeze({
  fesih: "fesh",
  akit: "akd",
  "hüküm": "hükm",
  "şehir": "şehr",
  isim: "ism",
  "ağiz": "ağz",
  kayit: "kayd",
  nakil: "nakl",
  "keşif": "keşf",
  vakit: "vakt",
  hapis: "haps",
});

const FINAL_ALTERNATION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  p: ["b"],
  b: ["p"],
  "ç": ["c"],
  c: ["ç"],
  t: ["d"],
  d: ["t"],
  k: ["ğ"],
  "ğ": ["k"],
  g: ["k"],
});

/** The shortest stem a peeled head word may leave. */
const MIN_STEM_CODE_POINTS = 4;

function peelCompoundSuffix(word: string): string | undefined {
  const cps = Array.from(word);
  const tail = (n: number): string => cps.slice(cps.length - n).join("");
  const keep = (n: number): string | undefined =>
    cps.length - n >= MIN_STEM_CODE_POINTS ? cps.slice(0, cps.length - n).join("") : undefined;
  if (tail(4) === "masi" || tail(4) === "mesi") {
    const stem = keep(4);
    if (stem !== undefined) return stem;
  }
  if (/s[iuü]$/u.test(word)) {
    const stem = keep(2);
    if (stem !== undefined) return stem;
  }
  if (/[^aeiouöü][iuü]$/u.test(word)) return keep(1);
  return undefined;
}

/**
 * The closed variant set of one folded term word. `head` is true for every
 * word of a multi-word term except its first (the compound's head noun,
 * which carries the -(s)I suffix).
 */
export function termWordVariants(word: string, head: boolean): string[] {
  const stems = new Set<string>([word]);
  if (head) {
    const peeled = peelCompoundSuffix(word);
    if (peeled !== undefined) stems.add(peeled);
  }
  const variants = new Set<string>(stems);
  // A dropped-vowel stem is already the form a vowel suffix attaches to
  // ("akd-i"): it takes no further alternation ("akt" would reach "aktif").
  const dropped = DROPPED_VOWEL_STEMS[word];
  if (dropped !== undefined) variants.add(dropped);
  for (const stem of stems) {
    const cps = Array.from(stem);
    if (cps.length < 3) continue;
    const last = cps[cps.length - 1] as string;
    const base = cps.slice(0, -1).join("");
    for (const alt of FINAL_ALTERNATION[last] ?? []) variants.add(base + alt);
    if (last === "k" && cps[cps.length - 2] === "n") variants.add(`${base}g`);
  }
  // Longest first, so the regex tries the most specific spelling first.
  return [...variants].sort((a, b) => Array.from(b).length - Array.from(a).length || (a < b ? -1 : 1));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/-]/gu, "\\$&");
}

const PRIVATIVE = /^(?:siz|suz|süz)/u;
/** A word of this many code points or fewer never matches as a prefix. */
const SHORT_WORD_CODE_POINTS = 3;

interface CompiledTerm {
  term: string;
  pattern: RegExp;
  wordCount: number;
  /**
   * The longest prefix every variant of the FIRST word shares: a clause whose
   * folded text does not contain it cannot match, and is skipped with one
   * `includes` instead of a regex scan.
   */
  anchor: string;
}

function commonPrefix(values: readonly string[]): string {
  const first = Array.from(values[0] ?? "");
  let length = first.length;
  for (const value of values.slice(1)) {
    const cps = Array.from(value);
    let k = 0;
    while (k < length && k < cps.length && cps[k] === first[k]) k += 1;
    length = k;
  }
  return first.slice(0, length).join("");
}

function compileTerm(term: string): CompiledTerm | undefined {
  const words = foldForMatch(term).split(" ").filter((w) => w !== "");
  if (words.length === 0) return undefined;
  const variantsByWord = words.map((word, i) => termWordVariants(word, i > 0));
  const parts = words.map((word, i) => {
    const alternatives = (variantsByWord[i] as string[]).map(escapeRegex).join("|");
    if (Array.from(word).length <= SHORT_WORD_CODE_POINTS) {
      return `(${alternatives})((?:['’][\\p{L}\\p{N}]*)?)(?![\\p{L}\\p{N}])`;
    }
    return `(${alternatives})([\\p{L}\\p{N}'’]*)`;
  });
  return {
    term,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${parts.join(" ")}`, "gu"),
    wordCount: words.length,
    anchor: commonPrefix(variantsByWord[0] as string[]),
  };
}

/**
 * Folded-text ranges [start, end) (UTF-16 units of the FOLDED text, mapped to
 * code points through `FoldedText.origin`) of every match, lazily.
 */
function* findTermMatches(folded: string, compiled: CompiledTerm): Generator<[number, number]> {
  compiled.pattern.lastIndex = 0;
  for (const hit of folded.matchAll(compiled.pattern)) {
    // Group 2k is the rest of word k: a privative suffix there is an absence.
    let privative = false;
    for (let w = 0; w < compiled.wordCount; w += 1) {
      if (PRIVATIVE.test(hit[2 * w + 2] ?? "")) privative = true;
    }
    if (privative) continue;
    const start = hit.index ?? 0;
    yield [start, start + hit[0].length];
  }
}

// ---------------------------------------------------------------------------
// Sentences, negation, excerpts
// ---------------------------------------------------------------------------

/**
 * Negative predicates, on FOLDED text (ı→i, so "alınmamıştır" reads
 * "alinmamiştir"). The list is closed: -mamış/-memiş, -mamakta/-memekte,
 * yok/yoktur, -mayacak/-meyecek (and -mayacağ-), -madığ-/-mediğ-.
 */
const NEGATION =
  /m[ae]miş|mamakta|memekte|(?<![\p{L}])yok(?:tur)?(?![\p{L}])|mayaca[kğ]|meyece[kğ]|m[ae]diğ/u;
/** Conditions, not negations: removed before `NEGATION` is tested. */
const CONDITIONAL = /m[ae]diği?\s+(?:takdirde|halde|sürece)|m[ae]diğinde/gu;

function isNegated(foldedSentence: string): boolean {
  return NEGATION.test(foldedSentence.replace(CONDITIONAL, " "));
}

const SENTENCE_END = /[.!?…]/u;
const SENTENCE_START = /[\p{Lu}\p{N}"“'‘(«]/u;

interface MarkerSpan {
  /** Where the marker's own text ("1- ", "MADDE 5-") ends. */
  restStart: number;
  /** End of the marker line. */
  lineEnd: number;
  /** The rest of the marker line is a title ("MADDE 5 – ÜCRET"). */
  restIsHeading: boolean;
}

/**
 * Locate the clause's own marker line in CODE POINTS, so an excerpt quotes
 * the sentence and not the numbering the label already shows, and a title on
 * the marker line ("Md. 6 – GİZLİLİK") is a sentence of its own.
 */
function markerSpan(cps: readonly string[], number: string): MarkerSpan | undefined {
  if (number === "") return undefined;
  let lineStart = 0;
  for (let i = 0; i <= cps.length; i += 1) {
    if (i === cps.length || cps[i] === "\n") {
      const line = cps.slice(lineStart, i).join("");
      const hit = parseClauseMarker(line);
      if (hit !== undefined && hit.number === number) {
        return {
          restStart: lineStart + Array.from(line.trimEnd()).length - Array.from(hit.rest).length,
          lineEnd: i,
          restIsHeading: isHeadingLike(hit.rest),
        };
      }
      lineStart = i + 1;
    }
  }
  return undefined;
}

/** One sentence of a clause, in CODE POINTS. */
interface SentenceRange {
  start: number;
  end: number;
  /** A title line (capitals, no closing punctuation), not an assertion. */
  heading: boolean;
}

/** Sentence ranges of one clause's text. */
function sentenceRanges(cps: readonly string[], marker: MarkerSpan | undefined): SentenceRange[] {
  const cuts = new Set<number>([0, cps.length]);
  if (marker !== undefined) {
    cuts.add(marker.restStart);
    if (marker.restIsHeading) cuts.add(marker.lineEnd);
  }
  let lineStart = 0;
  for (let i = 0; i <= cps.length; i += 1) {
    if (i === cps.length || cps[i] === "\n") {
      const line = cps.slice(lineStart, i).join("");
      if (isHeadingLike(line) || line.trim() === "") {
        cuts.add(lineStart);
        cuts.add(i);
      }
      if (/^\s*(?:\p{Ll}\)|[-•–]\s)/u.test(line)) cuts.add(lineStart);
      lineStart = i + 1;
    }
  }
  for (let i = 0; i < cps.length; i += 1) {
    const ch = cps[i] as string;
    const semicolon = ch === ";";
    if (!semicolon && !SENTENCE_END.test(ch)) continue;
    let j = i + 1;
    if (j >= cps.length || !WHITESPACE.test(cps[j] as string)) continue;
    while (j < cps.length && WHITESPACE.test(cps[j] as string)) j += 1;
    if (j >= cps.length) continue;
    if (semicolon || SENTENCE_START.test(cps[j] as string)) cuts.add(j);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const ranges: SentenceRange[] = [];
  for (let k = 0; k + 1 < sorted.length; k += 1) {
    const start = sorted[k] as number;
    const end = sorted[k + 1] as number;
    const text = cps.slice(start, end).join("").trim();
    if (text === "") continue;
    ranges.push({ start, end, heading: isHeadingLike(text) && !/[.!?;:]$/u.test(text) });
  }
  return ranges;
}

function collapse(cps: readonly string[]): string {
  return cps.join("").replace(/\s+/gu, " ").trim();
}

/**
 * A verbatim excerpt of `[start, end)` around the match `[matchStart,
 * matchEnd)`, all in code points: the whole sentence when it fits, otherwise a
 * window cut at word boundaries and marked with "…". Never longer than
 * `EXCERPT_MAX_CODE_POINTS`.
 */
function buildExcerpt(
  cps: readonly string[],
  range: [number, number],
  match: [number, number],
): string {
  const [start, end] = range;
  const whole = collapse(cps.slice(start, end));
  if (Array.from(whole).length <= EXCERPT_MAX_CODE_POINTS) return whole;
  const budget = EXCERPT_MAX_CODE_POINTS - 2;
  const [matchStart, matchEnd] = match;
  const around = Math.max(0, Math.floor((budget - (matchEnd - matchStart)) / 2));
  let from = Math.max(start, matchStart - around);
  let to = Math.min(end, from + budget);
  from = Math.max(start, to - budget);
  if (from > start && !WHITESPACE.test(cps[from - 1] as string)) {
    while (from < matchStart && !WHITESPACE.test(cps[from] as string)) from += 1;
  }
  if (to < end && !WHITESPACE.test(cps[to] as string)) {
    while (to > matchEnd && !WHITESPACE.test(cps[to - 1] as string)) to -= 1;
  }
  let excerpt = collapse(cps.slice(from, to));
  if (from > start) excerpt = `…${excerpt}`;
  if (to < end) excerpt = `${excerpt}…`;
  const out = Array.from(excerpt);
  return out.length <= EXCERPT_MAX_CODE_POINTS
    ? excerpt
    : `${out.slice(0, EXCERPT_MAX_CODE_POINTS - 1).join("")}…`;
}

interface PreparedClause {
  clause: ReviewClause;
  label: string;
  cps: string[];
  folded: FoldedText;
  sentences: SentenceRange[];
}

function prepareClauses(clauses: readonly ReviewClause[]): PreparedClause[] {
  const labels = clauseDisplayLabels(clauses);
  return clauses.map((clause, i) => {
    const cps = Array.from(clause.text);
    return {
      clause,
      label: labels[i] as string,
      cps,
      folded: foldWithOrigin(clause.text),
      sentences: sentenceRanges(cps, markerSpan(cps, clause.number)),
    };
  });
}

interface TermHit {
  clauseIndex: number;
  term: string;
  termOrder: number;
  negated: boolean;
  excerpt: string;
}

/** One clause's verdict for one term (independent of the item it serves). */
interface ClauseTermHit {
  clauseIndex: number;
  negated: boolean;
  excerpt: string;
}

/**
 * Every clause's verdict for one term, from the sentences the term occurs
 * in. A sentence of the clause's BODY speaks before its title: a clean body
 * sentence makes the clause a positive hit, a negated one ("Kiracıdan
 * depozito alınmamıştır" under the title "DEPOZİTO") makes it negated even
 * though the title matched. Only a clause whose body never mentions the term
 * is decided by its title — and then the excerpt carries the title AND the
 * sentence after it, because a bare "GİZLİLİK" tells the lawyer nothing.
 *
 * Cost: a clause is skipped unless it contains the term's literal anchor;
 * a sentence is folded for the negation test at most once; the excerpt is
 * built only for the hit that is kept; the scan stops at the first clean
 * body sentence (nothing can outrank it). No step re-reads a whole sentence
 * per match — a 1,8 MB clause with 150 000 matches used to be quadratic.
 */
function clauseTermHits(prepared: readonly PreparedClause[], term: string): ClauseTermHit[] {
  const compiled = compileTerm(term);
  if (compiled === undefined) return [];
  const hits: ClauseTermHit[] = [];
  for (const entry of prepared) {
    if (!entry.folded.text.includes(compiled.anchor)) continue;
    const negatedByRange = new Map<string, boolean>();
    let best:
      | { rank: number; range: [number, number]; shown: [number, number]; match: [number, number]; negated: boolean }
      | undefined;
    let si = 0;
    for (const [foldedStart, foldedEnd] of findTermMatches(entry.folded.text, compiled)) {
      const matchStart = entry.folded.origin[foldedStart] as number;
      const matchEnd = (entry.folded.origin[foldedEnd - 1] as number) + 1;
      // Matches arrive in document order, so the covering sentences are
      // found with a pointer that only moves forward.
      while (si < entry.sentences.length && (entry.sentences[si] as SentenceRange).end <= matchStart) si += 1;
      let last = si;
      while (last + 1 < entry.sentences.length && (entry.sentences[last + 1] as SentenceRange).start < matchEnd) {
        last += 1;
      }
      const first = entry.sentences[si];
      const tail = entry.sentences[last];
      const covered = first !== undefined && tail !== undefined && first.start < matchEnd;
      const range: [number, number] = covered ? [first.start, tail.end] : [0, entry.cps.length];
      let heading = covered;
      for (let k = si; covered && k <= last; k += 1) {
        if (!(entry.sentences[k] as SentenceRange).heading) heading = false;
      }
      const key = `${range[0]}:${range[1]}`;
      let negated = negatedByRange.get(key);
      if (negated === undefined) {
        negated = isNegated(foldForMatch(entry.cps.slice(range[0], range[1]).join("")));
        negatedByRange.set(key, negated);
      }
      const rank = (heading ? 2 : 0) + (negated ? 1 : 0);
      if (best === undefined || rank < best.rank) {
        let shown = range;
        if (heading && tail !== undefined) {
          const next = entry.sentences.find((s) => s.start >= tail.end && !s.heading);
          if (next !== undefined) shown = [range[0], next.end];
        }
        best = { rank, range, shown, match: [matchStart, matchEnd], negated };
      }
      if (rank === 0) break;
    }
    if (best !== undefined) {
      hits.push({
        clauseIndex: entry.clause.index,
        negated: best.negated,
        excerpt: buildExcerpt(entry.cps, best.shown, best.match),
      });
    }
  }
  return hits;
}

/** Every term's clause verdicts, in the item's term order (cached per review). */
function collectHits(
  prepared: readonly PreparedClause[],
  terms: readonly string[],
  cache: Map<string, ClauseTermHit[]>,
): TermHit[] {
  const hits: TermHit[] = [];
  terms.forEach((term, termOrder) => {
    let perTerm = cache.get(term);
    if (perTerm === undefined) {
      perTerm = clauseTermHits(prepared, term);
      cache.set(term, perTerm);
    }
    for (const hit of perTerm) hits.push({ ...hit, term, termOrder });
  });
  return hits;
}

/** One hit per clause (document order), the lowest term order first. */
function perClause(hits: readonly TermHit[]): TermHit[] {
  const byClause = new Map<number, TermHit>();
  for (const hit of hits) {
    const seen = byClause.get(hit.clauseIndex);
    if (seen === undefined || hit.termOrder < seen.termOrder) byClause.set(hit.clauseIndex, hit);
  }
  return [...byClause.values()].sort((a, b) => a.clauseIndex - b.clauseIndex);
}

/** Run one checklist over a set of clauses. Pure, deterministic, no I/O. */
export function runChecklist(
  clauses: readonly ReviewClause[],
  checklist: Checklist,
): ChecklistFinding[] {
  const prepared = prepareClauses(clauses);
  const cache = new Map<string, ClauseTermHit[]>();
  return checklist.items.map((item) => {
    const strong = collectHits(prepared, item.terms, cache);
    const positive = perClause(strong.filter((hit) => !hit.negated));
    if (positive.length > 0) {
      return finding(item, "VAR", positive, "strong", firstTerm(positive), "", prepared);
    }
    if (strong.length > 0) {
      const negated = perClause(strong);
      return finding(item, "BELIRSIZ", negated, "strong", firstTerm(negated), "NEGATED", prepared);
    }
    const weak = perClause(collectHits(prepared, item.weakTerms ?? [], cache));
    if (weak.length > 0) {
      return finding(item, "BELIRSIZ", weak, "weak", firstTerm(weak), "WEAK_ONLY", prepared);
    }
    return finding(item, "YOK", [], "strong", "", "", prepared);
  });
}

function firstTerm(hits: readonly TermHit[]): string {
  return [...hits].sort((a, b) => a.termOrder - b.termOrder)[0]?.term ?? "";
}

function finding(
  item: ChecklistItem,
  state: ClauseState,
  hits: readonly TermHit[],
  strength: "strong" | "weak",
  matchedTerm: string,
  reasonCode: FindingReasonCode,
  prepared: readonly PreparedClause[],
): ChecklistFinding {
  const entryOf = (index: number): PreparedClause => prepared[index] as PreparedClause;
  const matches: ReviewMatch[] = hits.slice(0, MAX_MATCHES_PER_FINDING).map((hit) => ({
    clauseIndex: hit.clauseIndex,
    clauseNumber: clauseLabel(entryOf(hit.clauseIndex).clause),
    clauseLabel: entryOf(hit.clauseIndex).label,
    term: hit.term,
    strength,
    negated: hit.negated,
    excerpt: hit.excerpt,
  }));
  let reason = "";
  if (reasonCode !== "") {
    reason = FINDING_REASON_TR[reasonCode];
    if (reasonCode === "WEAK_ONLY" && hits.every((hit) => hit.negated)) {
      reason += " Bulunan cümle olumsuz ifade de içeriyor.";
    }
  }
  const primary = matches[0];
  return {
    itemId: item.id,
    label: item.label,
    state,
    stateLabel: CLAUSE_STATE_LABEL_TR[state],
    clauseNumbers: hits.map((hit) => clauseLabel(entryOf(hit.clauseIndex).clause)),
    matchedTerm,
    note: item.note ?? "",
    clauseIndexes: hits.map((hit) => hit.clauseIndex),
    clauseLabels: hits.map((hit) => entryOf(hit.clauseIndex).label),
    reasonCode,
    reason,
    excerpt: primary?.excerpt ?? "",
    excerptClauseIndex: primary?.clauseIndex ?? null,
    matches,
  };
}

// ---------------------------------------------------------------------------
// Evidence and observations
// ---------------------------------------------------------------------------

/**
 * Verify request-carried evidence against what the SERVER holds. An entry is
 * vouched for only when all of these hold:
 *
 *  - it names a `runId` the answer store knows, and that run carries an
 *    evidence item with the same `evidenceId`;
 *  - the stored item's quote hashes to its stored digest, the request's
 *    digest equals it, and the request's quote hashes to it too;
 *  - the stored item is not an UPLOAD (an uploaded document is an exhibit,
 *    never a legal source — ADR-021).
 *
 * The label printed is built from the STORED item; the request's own label
 * ("TBK m. 999") is never trusted. No lookup = nothing is verified.
 */
export async function verifyReviewEvidence(
  entries: readonly ReviewEvidence[],
  answers: DraftAnswerLookup | undefined,
): Promise<Map<string, VerifiedReviewEvidence>> {
  const verified = new Map<string, VerifiedReviewEvidence>();
  if (answers === undefined) return verified;
  const warmed = new Set<string>();
  for (const entry of entries) {
    if (entry.runId === undefined || entry.runId === "" || verified.has(entry.evidenceId)) continue;
    if (sha256HexUtf8(entry.quote) !== entry.quoteSha256) continue;
    if (!warmed.has(entry.runId)) {
      warmed.add(entry.runId);
      try {
        await answers.warm?.(entry.runId);
      } catch {
        continue;
      }
    }
    const held = answers
      .get(entry.runId)
      ?.result.evidence.find((item) => item.evidenceId === entry.evidenceId);
    if (held === undefined || held.source === "UPLOAD") continue;
    if (held.quoteSha256 !== entry.quoteSha256) continue;
    if (sha256HexUtf8(held.quote) !== held.quoteSha256) continue;
    verified.set(entry.evidenceId, {
      evidenceId: entry.evidenceId,
      label: draftEvidenceLabel(held),
      quoteSha256: held.quoteSha256,
    });
  }
  return verified;
}

export interface ContractReviewRequest {
  text: string;
  checklist: Checklist;
  documentTitle?: string;
  /** Hash-bound legal sources any "risk" line must point at. */
  evidence?: ReviewEvidence[];
  /**
   * Observations to print against a clause. Each one is classified here — an
   * observation whose `evidenceId` does not resolve to a SERVER-VERIFIED
   * entry is demoted to KAYNAKSIZ and stripped of the word "risk". Callers
   * cannot opt out of this.
   */
  observations?: { clauseIndex: number; text: string; evidenceId?: string }[];
}

export interface ReviewOptions {
  now?: () => Date;
  /**
   * The output of `verifyReviewEvidence` for this request's evidence. Absent =
   * no entry is verified, and every observation is KAYNAKSIZ.
   */
  verifiedEvidence?: ReadonlyMap<string, VerifiedReviewEvidence>;
}

export function reviewContract(
  request: ContractReviewRequest,
  options: ReviewOptions = {},
): ContractReviewReport {
  if (request.text.trim() === "") {
    throw new ContractReviewError("İncelenecek sözleşme metni boş.");
  }
  if (request.checklist.items.length === 0) {
    throw new ContractReviewError(
      "Kontrol listesi boş: en az bir başlık ekleyin (ör. depozito, artış oranı).",
    );
  }
  const clauses = splitClauses(request.text);
  if (clauses.length === 0) {
    throw new ContractReviewError("Metinde madde bulunamadı; sözleşme metnini kontrol edin.");
  }
  const labels = clauseDisplayLabels(clauses);
  const findings = runChecklist(clauses, request.checklist);

  // A source stands only when the server vouched for it AND the entry the
  // request carried still hashes to the digest the server holds.
  const offered = new Map<string, ReviewEvidence>();
  for (const entry of request.evidence ?? []) {
    if (!offered.has(entry.evidenceId)) offered.set(entry.evidenceId, entry);
  }
  const sourceOf = (evidenceId: string | undefined): VerifiedReviewEvidence | undefined => {
    if (evidenceId === undefined || evidenceId === "") return undefined;
    const vouched = options.verifiedEvidence?.get(evidenceId);
    const entry = offered.get(evidenceId);
    if (vouched === undefined || entry === undefined) return undefined;
    if (entry.quoteSha256 !== vouched.quoteSha256) return undefined;
    if (sha256HexUtf8(entry.quote) !== entry.quoteSha256) return undefined;
    return vouched;
  };

  const byClause = new Map<number, ClauseObservation[]>();
  const unattached: UnattachedObservation[] = [];
  for (const observation of request.observations ?? []) {
    const clean = plainLine(observation.text);
    if (clean === "") continue;
    const source = sourceOf(observation.evidenceId);
    // The word "risk" is REMOVED, not merely flagged: an unsourced line must
    // not read as a risk assessment even when quoted out of context.
    const line: ClauseObservation =
      source === undefined
        ? {
            text: `${KAYNAKSIZ_PREFIX} — ${stripRiskWords(clean)}`,
            sourced: false,
            evidenceId: "",
            evidenceLabel: "",
          }
        : { text: clean, sourced: true, evidenceId: source.evidenceId, evidenceLabel: source.label };
    if (observation.clauseIndex < 0 || observation.clauseIndex >= clauses.length) {
      unattached.push({
        ...line,
        clauseIndex: observation.clauseIndex,
        note:
          `Bu gözlem, metinde bulunmayan bir madde sırasına (${observation.clauseIndex}) bağlanmıştı —` +
          ` metinde ${clauses.length} madde var; gözlem hiçbir maddeye eklenmedi.`,
      });
      continue;
    }
    const list = byClause.get(observation.clauseIndex) ?? [];
    list.push(line);
    byClause.set(observation.clauseIndex, list);
  }

  // Keyed by clause INDEX: "1" names Genel Şart 1 and Özel Şart 1 alike.
  const itemsByClause = new Map<number, string[]>();
  for (const found of findings) {
    for (const index of found.clauseIndexes) {
      itemsByClause.set(index, [...(itemsByClause.get(index) ?? []), found.itemId]);
    }
  }

  const totals: Record<ClauseState, number> = { VAR: 0, YOK: 0, BELIRSIZ: 0 };
  for (const found of findings) totals[found.state] += 1;

  const now = (options.now ?? (() => new Date()))();
  return {
    schema: CONTRACT_REVIEW_SCHEMA,
    documentTitle: request.documentTitle ?? "",
    checklistId: request.checklist.id,
    checklistTitle: request.checklist.title,
    generatedAt: now.toISOString(),
    clauseCount: clauses.length,
    findings,
    clauses: clauses.map((clause, i) => ({
      clauseNumber: clauseLabel(clause),
      index: clause.index,
      label: labels[i] as string,
      itemIds: itemsByClause.get(clause.index) ?? [],
      observations: byClause.get(clause.index) ?? [],
    })),
    unattachedObservations: unattached,
    totals,
    notices: [...REVIEW_NOTICES],
  };
}

/** The "risk" stem, any case, at the start of a word (Unicode-aware). */
const RISK_STEM = /(?<![\p{L}\p{N}])[Rr][İiIı][Ss][Kk]/gu;

/**
 * Replace the stem "risk" of every inflected form in an unsourced observation
 * with "gözlem" and KEEP the suffix, in the stem's own case: "riskli" →
 * "gözlemli", "Riskin" → "Gözlemin", "RİSKLİ" → "GÖZLEMLİ". Both stems take
 * front-vowel suffixes, so the result still reads as Turkish.
 */
export function stripRiskWords(text: string): string {
  return text
    .replace(RISK_STEM, (stem) => {
      const letters = Array.from(stem);
      if (letters.every((ch) => /\p{Lu}/u.test(ch))) return "GÖZLEM";
      return /\p{Lu}/u.test(letters[0] as string) ? "Gözlem" : "gözlem";
    })
    .replace(/\s{2,}/gu, " ")
    .trim();
}
