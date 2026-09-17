/**
 * Hybrid claim ↔ evidence candidate discovery (W21).
 *
 * W20 showed each claim the 8 evidence items with the highest lexical topic
 * overlap and nothing else. Evidence that supports a claim in different
 * words — "ödeme dekontu" for "kira bedeli ödendi" — was never judged, and
 * the claim was then reported as having NO support. A bounded model context
 * is fine; a bounded search universe that pretends to prove absence is not.
 *
 * This module ranks EVERY evidence item of the matter against every claim
 * with several independent signals and decides, per claim, which items the
 * weighing stage must judge:
 *
 *   reference   shared exact references ("Ek-3", "2023/145", a date, an
 *               amount, a plate number) — a reference match is ALWAYS
 *               judged, whatever the cap;
 *   lexical     overlap of significant Turkish stems;
 *   semantic    cosine of local embeddings (W20 private E5), when present;
 *   entity      a named party/organization present in both;
 *   temporal    the same or a nearby date;
 *   party       produced by / attributed to the same party;
 *   structure   the same analysis unit or the same document.
 *
 * When the matter has at most `fullSearchMaxEvidence` evidence items every
 * claim is judged against ALL of them (`candidateSetComplete`), and only
 * then may "no support" be stated as a finding. Above that, the candidate
 * set is the union of the top items by the combined score, by lexical and
 * by semantic signal, plus every reference match — recall first — and "no
 * support" can only be reported as "not found among the candidates".
 *
 * Pure and deterministic: ties are broken by item ref, so the same stored
 * items always give the same candidate lists.
 */

import { foldTurkishCase, stemTurkish, STOP_STEMS } from "../retrieval/turkishAnalyzer.js";
import { clip, isClipped } from "./intelligence.js";
import { WEIGH_CANDIDATE_QUOTE_CHARS, type CandidateSignals, type WeighCandidate } from "./stageTypes.js";

export const CANDIDATE_DISCOVERY_VERSION = "cand-v1";

/** One claim, defense or evidence item as candidate discovery sees it. */
export interface DiscoveryItem {
  /** itemRef (`kind:key`). */
  readonly ref: string;
  readonly kind: string;
  /** The normalized statement. */
  readonly title: string;
  /** The verbatim source quote it rests on (references often live here). */
  readonly quote: string;
  readonly partyRole: string | null;
  readonly occurredOn: string | null;
  readonly fileId: string | null;
  readonly unitNo: number | null;
  /** The basis span in the pinned text (absent in the bake-off). */
  readonly startChar?: number | null | undefined;
  readonly endChar?: number | null | undefined;
}

export interface DiscoveryOptions {
  readonly fullSearchMaxEvidence: number;
  readonly candidatesPerClaim: number;
  /** itemRef -> embedding. A missing entry simply lacks the semantic signal. */
  readonly embeddings?: ReadonlyMap<string, ArrayLike<number>> | undefined;
  /** Normalized names of the matter's entities (from entity items). */
  readonly entityNames?: readonly string[] | undefined;
}

export interface ClaimCandidates {
  readonly claimRef: string;
  readonly candidates: readonly WeighCandidate[];
  /** Every evidence item of the matter is a candidate of this claim. */
  readonly candidateSetComplete: boolean;
  /** Evidence items in the matter. */
  readonly universeSize: number;
  readonly semanticSignal: boolean;
  /** Universe items not weighed against this claim: their span overlaps the claim's own. */
  readonly selfOverlapExcluded: number;
}

const WEIGHTS = {
  reference: 0.3,
  lexical: 0.25,
  semantic: 0.25,
  entity: 0.1,
  temporal: 0.04,
  party: 0.02,
  structure: 0.04,
} as const;

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Significant stems of a text (no numbers, no stopwords). */
export function stemSet(text: string): Set<string> {
  const stems = new Set<string>();
  for (const raw of foldTurkishCase(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /\d/u.test(raw)) continue;
    const stem = stemTurkish(raw);
    if (stem.length < 3 || STOP_STEMS.has(stem)) continue;
    stems.add(stem);
  }
  return stems;
}

/**
 * The suffixes the exhibit word "ek" takes in a pleading, as the Turkish
 * suffix ORDER builds them — plural, possessive, case, "-ki", copula — each
 * slot a closed set of morphemes:
 *
 *   ek | ekler            "3 numaralı ek", "eklerde"
 *   + possessive          eki, ekimiz, ekiniz, ekleri ("dilekçemizin ekidir")
 *   + case                eke, eki, ekin, ekte, ekten, ekle; after a
 *                         possessive with the buffer "n": ekine, ekini,
 *                         ekinin, ekinde, ekinden; ekiyle
 *   + "ki"                ekteki, ekindeki, eklerindeki
 *   + copula              ekidir, ektedir
 *
 * Not `\p{L}*`: every letter after "ek" must be one of these morphemes, so
 * "eksik", "ekonomik" and "Ekim" (October — the first-person "ekim" is not
 * in the set) never become an exhibit reference (W21 review #13). The
 * lookahead after the pattern (NOT_AFTER) makes the whole word match.
 */
const EK_PLURAL = "(?:ler)?";
const EK_POSSESSIVE = "(?:imiz|ımız|iniz|ınız|i|ı)?";
const EK_CASE = "(?:n?(?:e|a|i|ı|in|ın|de|da|den|dan)|te|ta|ten|tan|y?le|y?la)?";
const EK_KI = "(?:ki)?";
const EK_COPULA = "(?:dir|dır|tir|tır)?";
const EK_SUFFIX = `(?:'?${EK_PLURAL}${EK_POSSESSIVE}${EK_CASE}${EK_KI}${EK_COPULA})`;
/** Unicode-aware word boundaries: JS `\b` is ASCII-only, so "çek-3" passed `\bek`. */
const NOT_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_AFTER = "(?![\\p{L}\\p{N}])";
const EXHIBIT_PATTERNS: readonly RegExp[] = [
  // "Ek-3", "EK 3", "Ek:3", "Ek-3'te"; never an amount ("ek 5.000 TL")
  new RegExp(`${NOT_BEFORE}ek\\s*[-.:/]?\\s*(\\d{1,3})(?!\\.\\d{3})${NOT_AFTER}`, "gu"),
  // "Ek No: 3", "EK NO:3", "Ek No.3", "Ek(3)" (W21 round-two review)
  new RegExp(`${NOT_BEFORE}ek\\s*no\\s*[.:]?\\s*\\(?(\\d{1,3})\\)?(?!\\.\\d{3})${NOT_AFTER}`, "gu"),
  new RegExp(`${NOT_BEFORE}ek\\s*\\((\\d{1,3})\\)`, "gu"),
  // "3 numaralı ekte", "3 nolu eki", "3 no'lu ek", "3 No.lu Ek", "3 sayılı ekte", "(3) numaralı ek",
  // and the spellings typed without Turkish letters ("3 numarali ekte", "3 sayili ek")
  new RegExp(
    `${NOT_BEFORE}\\(?(\\d{1,3})\\)?\\s*(?:no\\.?'?lu|no\\.?|numaral[ıi]|sayıl[ıi]|sayil[ıi])\\s*ek${EK_SUFFIX}${NOT_AFTER}`,
    "gu",
  ),
  // "3. ek", "3. ekte" (ordinal) — but not an article number ("TBK m. 315. Ek olarak"),
  // "ek olarak" or an addendum ("2. Ek sözleşme")
  new RegExp(
    `(?<!(?<![\\p{L}])(?:m|md|mad|madde)\\.?\\s*)${NOT_BEFORE}(\\d{1,3})\\.\\s*ek${EK_SUFFIX}${NOT_AFTER}` +
      `(?!\\s+(?:olarak|sözleşme|protokol|süre|ödeme|madde|ücret|bedel|karar))`,
    "gu",
  ),
];

/**
 * Exact references a text names, normalized so the same reference written
 * two ways matches: exhibits, docket numbers, dates, amounts, plates.
 *
 * Exhibit references accept the inflected Turkish forms ("3 numaralı ekte
 * sunulan dekont", "3 nolu eki", "3. ek") and the typographic apostrophe:
 * a claim citing "Ek-3" must find the exhibit however the exhibit list
 * spells it, or the "a reference match is ALWAYS judged" guarantee above
 * fails silently in a large matter (W21 review #13).
 */
export function extractReferences(text: string): Set<string> {
  // Dashes and hyphens of every width read as "-" ("Ek—3", a non-breaking hyphen).
  const folded = foldTurkishCase(text)
    .replace(/[\u2019\u02bc\u2018`´]/gu, "'")
    .replace(/[\u2010-\u2015\u2212]/gu, "-");
  const refs = new Set<string>();
  for (const pattern of EXHIBIT_PATTERNS) {
    for (const match of folded.matchAll(pattern)) refs.add(`ek:${Number(match[1])}`);
  }
  for (const match of folded.matchAll(/\b((?:19|20)\d{2})\s*\/\s*(\d{1,6})\b/gu)) {
    refs.add(`dosya:${match[1]}/${Number(match[2])}`);
  }
  for (const match of folded.matchAll(/\b(\d{1,2})[./](\d{1,2})[./]((?:19|20)\d{2})\b/gu)) {
    const day = match[1]!.padStart(2, "0");
    const month = match[2]!.padStart(2, "0");
    refs.add(`tarih:${match[3]}-${month}-${day}`);
  }
  for (const match of folded.matchAll(/\b(\d{1,3}(?:\.\d{3})+|\d{4,})(?:,\d{1,2})?\s*(?:tl|try|₺|türk lirası)/gu)) {
    refs.add(`tutar:${match[1]!.replace(/\./gu, "")}`);
  }
  for (const match of folded.matchAll(/\b(\d{2})\s?([a-zçğıöşü]{1,3})\s?(\d{2,4})\b/gu)) {
    // Turkish plates: 34 ABC 123. Only when the letters are a plate shape.
    if (/^[a-zçğıöşü]{1,3}$/u.test(match[2]!)) refs.add(`plaka:${match[1]}${match[2]}${match[3]}`);
  }
  return refs;
}

function overlapCoefficient(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) shared += 1;
  return shared / small.size;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}

function daysBetween(a: string, b: string): number | null {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Party sides
// ---------------------------------------------------------------------------

/** The procedural side a party label resolves to. */
export type PartySide = "davacı" | "davalı" | "müdahil" | "unknown";

/** The side word a token is, if any ("davacısı", "davalılar", "müdahile" included). */
function sideWord(token: string): PartySide | null {
  if (token.startsWith("davacı")) return "davacı";
  if (token.startsWith("davalı")) return "davalı";
  if (token.startsWith("müdahil")) return "müdahil";
  return null;
}

/** "dava", "davada", "davanın", "davası", "davadaki" — the word "case", not a side. */
function isCaseWord(token: string): boolean {
  return token.startsWith("dava") && sideWord(token) === null;
}

/** Joined/separated-case qualifiers: the side in THAT case says nothing about the principal side. */
const OTHER_CASE_QUALIFIERS = ["birleşen", "birleştirilen", "ayrılan", "tefrik"];

/** Words that make the NEXT side word the counterclaim's side ("mukabil davacı" is the defendant). */
const COUNTER_WORDS: ReadonlySet<string> = new Set(["karşı", "mukabil", "karşılık"]);

/**
 * The PRINCIPAL side of a free-text party label. Labels are written by the
 * extraction model and typed by the lawyer, and counterclaim pleadings say
 * it many ways: "davalı-karşı davacı", "karşı davacı", "karşı dava
 * davacısı", "karşı davada davalı". A substring test — or a test that looks
 * only at the word right before "davacı" — put the opponent's counterclaims
 * under "our claims" (W21 review #12).
 *
 * Reading: the FIRST side word of the label is the principal designation.
 * Walking back from it over "dava"-words ("dava", "davada", "davanın"):
 *
 *   "karşı", "k.", "mukabil", "karşılık"
 *                           the counterclaim — the OTHER side
 *                           ("karşı davacı" is the defendant);
 *   "asıl" / nothing        that side itself;
 *   "birleşen", "ayrılan"…  a side in another case — undecidable, `unknown`
 *                           when it is the first designation, ignored after.
 *
 * Every later side word must designate the same side ("davalı-karşı
 * davacı"); a label naming both sides ("davacılar ve davalı") is `unknown`.
 * A side word followed by "yanında"/"tarafında" ("davacı yanında müdahil")
 * qualifies the NEXT designation and is skipped. A label that names no
 * recognised side is `unknown`, never a match.
 */
export function partySide(role: string | null | undefined): PartySide {
  if (role === null || role === undefined) return "unknown";
  const tokens = foldTurkishCase(role)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0);
  // W21 re-check: EVERY side word is read, not only the first. A label that
  // designates the principal side twice consistently ("davalı-karşı davacı":
  // the defendant who counterclaims) keeps it; a label naming BOTH sides
  // ("davacılar ve davalı") cannot say whose claim it is and is `unknown` —
  // counted, never listed under one side.
  let principal: PartySide | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const reading = sideAt(tokens, index);
    if (reading === null || reading === "qualifier") continue;
    if (principal === null) {
      if (reading === "other_case" || reading === "unknown") return "unknown";
      principal = reading;
      continue;
    }
    // A side in a joined/separated case says nothing about this one.
    if (reading === "other_case") continue;
    if (reading !== principal) return "unknown";
  }
  return principal ?? "unknown";
}

/**
 * What the token at `index` designates: a side (after the counterclaim
 * flip), `qualifier` for "davacı yanında …", `other_case` for a side in a
 * joined/separated case, `unknown` when it cannot be decided, or null when
 * the token is no side word.
 */
function sideAt(tokens: readonly string[], index: number): PartySide | "qualifier" | "other_case" | null {
  const token = tokens[index] as string;
  // "karşıdavacı" written as one word.
  const joined = token.startsWith("karşı") ? sideWord(token.slice("karşı".length)) : null;
  const side = joined ?? sideWord(token);
  if (side === null) return null;
  const next = tokens[index + 1];
  if (joined === null && (next === "yanında" || next === "tarafında")) return "qualifier";
  let counter = joined !== null;
  if (!counter) {
    // A joined/separated-case qualifier ANYWHERE since the previous side word
    // makes this designation another case's: "birleşen dosya davacısı",
    // "Birleşen 2023/45 E. sayılı dosya davacısı" (W21 round-two review).
    for (let before = index - 1; before >= 0; before -= 1) {
      const token = tokens[before] as string;
      if (sideWord(token) !== null) break;
      if (OTHER_CASE_QUALIFIERS.some((word) => token.startsWith(word))) return "other_case";
    }
    let back = index - 1;
    while (back >= 0 && (isCaseWord(tokens[back] as string) || (tokens[back] as string).startsWith("dosya"))) back -= 1;
    const qualifier = back >= 0 ? (tokens[back] as string) : "";
    // "karşıdava davacısı": the counterclaim written as one word.
    if (qualifier.startsWith("karşı") && qualifier.slice("karşı".length).startsWith("dava")) {
      counter = true;
    } else if (COUNTER_WORDS.has(qualifier)) {
      counter = true;
    } else if (qualifier === "k") {
      // "K.Davacı", "K. Davalı vekili", "Davalı-K.Davacı": the pleading
      // abbreviation of "karşı". A lone "K" after a name ("Mehmet K.
      // davacı") is an initial, so it counts as "karşı" only at the start
      // of the label or right after another side word; otherwise the side
      // cannot be decided and is never guessed.
      const before = back - 1 >= 0 ? (tokens[back - 1] as string) : null;
      if (before !== null && sideWord(before) === null) return "unknown";
      counter = true;
    }
  }
  if (!counter) return side;
  // "karşı davacı" is the defendant who counterclaimed; "karşı davalı"
  // the plaintiff who is sued back.
  if (side === "davacı") return "davalı";
  if (side === "davalı") return "davacı";
  return side;
}

/**
 * Two party labels denote the SAME side. Recognised sides compare by their
 * principal designation; two labels outside the closed set ("kiracı") match
 * only when they are the same label. Never a substring test.
 */
export function sameParty(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = partySide(a);
  const right = partySide(b);
  if (left !== "unknown" || right !== "unknown") return left === right;
  const x = foldTurkishCase(a).replace(/\s+/gu, " ").trim();
  const y = foldTurkishCase(b).replace(/\s+/gu, " ").trim();
  return x !== "" && x === y;
}

interface Prepared {
  readonly item: DiscoveryItem;
  readonly stems: Set<string>;
  readonly refs: Set<string>;
  readonly entities: Set<string>;
  readonly vector: ArrayLike<number> | undefined;
}

function prepare(item: DiscoveryItem, options: DiscoveryOptions): Prepared {
  const text = `${item.title}\n${item.quote}`;
  const folded = foldTurkishCase(text);
  const entities = new Set<string>();
  for (const name of options.entityNames ?? []) {
    const needle = foldTurkishCase(name).trim();
    if (needle.length >= 3 && folded.includes(needle)) entities.add(needle);
  }
  return {
    item,
    stems: stemSet(text),
    refs: extractReferences(text),
    entities,
    vector: options.embeddings?.get(item.ref),
  };
}

function signalsFor(claim: Prepared, evidence: Prepared): CandidateSignals {
  let reference = 0;
  for (const ref of claim.refs) {
    if (evidence.refs.has(ref)) {
      reference = 1;
      break;
    }
  }
  let entity = 0;
  for (const name of claim.entities) {
    if (evidence.entities.has(name)) {
      entity = 1;
      break;
    }
  }
  let temporal = 0;
  if (claim.item.occurredOn !== null && evidence.item.occurredOn !== null) {
    const days = daysBetween(claim.item.occurredOn, evidence.item.occurredOn);
    temporal = days === null ? 0 : days === 0 ? 1 : days <= 31 ? 0.5 : 0;
  }
  const structure =
    claim.item.fileId !== null && claim.item.fileId === evidence.item.fileId
      ? claim.item.unitNo !== null && claim.item.unitNo === evidence.item.unitNo
        ? 1
        : 0.5
      : 0;
  const semantic =
    claim.vector !== undefined && evidence.vector !== undefined ? cosine(claim.vector, evidence.vector) : null;
  return {
    reference,
    lexical: Number(overlapCoefficient(claim.stems, evidence.stems).toFixed(4)),
    semantic: semantic === null ? null : Number(semantic.toFixed(4)),
    entity,
    temporal,
    party: sameParty(claim.item.partyRole, evidence.item.partyRole) ? 1 : 0,
    structure,
  };
}

/**
 * Combined score. The semantic weight is redistributed when no embedding is
 * available, so a matter without embeddings is ranked on the other signals
 * rather than scored as if every item were semantically unrelated.
 */
function combine(signals: CandidateSignals, semanticNormalized: number | null): number {
  let total = 0;
  let weight = 0;
  const add = (value: number, w: number): void => {
    total += value * w;
    weight += w;
  };
  add(signals.reference, WEIGHTS.reference);
  add(signals.lexical, WEIGHTS.lexical);
  if (semanticNormalized !== null) add(semanticNormalized, WEIGHTS.semantic);
  add(signals.entity, WEIGHTS.entity);
  add(signals.temporal, WEIGHTS.temporal);
  add(signals.party, WEIGHTS.party);
  add(signals.structure, WEIGHTS.structure);
  return weight === 0 ? 0 : Number((total / weight).toFixed(6));
}

function byScoreThenRef(a: WeighCandidate, b: WeighCandidate): number {
  return b.score - a.score || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
}

/**
 * Candidate evidence for every claim.
 *
 * Every claim gets an entry, including a claim for which the matter holds
 * no evidence at all (an empty, COMPLETE candidate set: the universe is
 * empty, so nothing was left unsearched).
 */
export function discoverCandidates(
  claims: readonly DiscoveryItem[],
  evidence: readonly DiscoveryItem[],
  options: DiscoveryOptions,
): ClaimCandidates[] {
  const preparedEvidence = [...evidence]
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .map((item) => prepare(item, options));
  const universeSize = preparedEvidence.length;
  const fullSearch = universeSize <= options.fullSearchMaxEvidence;
  const cap = Math.max(1, options.candidatesPerClaim);

  return claims.map((claimItem) => {
    const claim = prepare(claimItem, options);
    // An item whose source span overlaps the claim's own span restates the
    // claim (a date window around the claim sentence, the same sentence
    // extracted twice): it cannot support the claim, and it would crowd the
    // capped candidate slots (W21 round-two review). It is counted, not
    // silently dropped.
    const independent = preparedEvidence.filter((entry) => !spansOverlap(claimItem, entry.item));
    const selfOverlapExcluded = preparedEvidence.length - independent.length;
    const raw = independent.map((entry) => ({ entry, signals: signalsFor(claim, entry) }));
    const cosines = raw.map((row) => row.signals.semantic).filter((value): value is number => value !== null);
    const semanticSignal = cosines.length > 0;
    const low = semanticSignal ? Math.min(...cosines) : 0;
    const high = semanticSignal ? Math.max(...cosines) : 0;
    const normalize = (value: number | null): number | null =>
      value === null ? null : high > low ? (value - low) / (high - low) : 1;

    const scored: WeighCandidate[] = raw.map((row) => ({
      ref: row.entry.item.ref,
      title: row.entry.item.title,
      // The verified quote is what the weighing model is shown (the title
      // is a paraphrase); a long quote is clipped where the prompt clips,
      // and the clip is recorded.
      quote: clip(row.entry.item.quote, WEIGH_CANDIDATE_QUOTE_CHARS),
      ...(isClipped(row.entry.item.quote, WEIGH_CANDIDATE_QUOTE_CHARS) ? { quoteClipped: true } : {}),
      score: combine(row.signals, normalize(row.signals.semantic)),
      signals: row.signals,
    }));
    scored.sort(byScoreThenRef);

    if (fullSearch) {
      return {
        claimRef: claimItem.ref,
        candidates: scored,
        candidateSetComplete: true,
        universeSize,
        semanticSignal,
        selfOverlapExcluded,
      };
    }

    // Recall first: the union of several rankings, and every reference
    // match whatever its rank. The union may exceed `cap`; that is intended.
    const chosen = new Set<string>();
    for (const candidate of scored.slice(0, cap)) chosen.add(candidate.ref);
    const quarter = Math.max(1, Math.ceil(cap / 4));
    const byLexical = [...scored].sort(
      (a, b) => b.signals.lexical - a.signals.lexical || byScoreThenRef(a, b),
    );
    for (const candidate of byLexical.slice(0, quarter)) if (candidate.signals.lexical > 0) chosen.add(candidate.ref);
    if (semanticSignal) {
      const bySemantic = [...scored].sort(
        (a, b) => (b.signals.semantic ?? -1) - (a.signals.semantic ?? -1) || byScoreThenRef(a, b),
      );
      for (const candidate of bySemantic.slice(0, quarter)) chosen.add(candidate.ref);
    }
    for (const candidate of scored) if (candidate.signals.reference > 0) chosen.add(candidate.ref);

    const candidates = scored.filter((candidate) => chosen.has(candidate.ref));
    return {
      claimRef: claimItem.ref,
      candidates,
      candidateSetComplete: candidates.length === independent.length,
      universeSize,
      semanticSignal,
      selfOverlapExcluded,
    };
  });
}

/** Two items rest on overlapping spans of the same file. */
function spansOverlap(a: DiscoveryItem, b: DiscoveryItem): boolean {
  if (a.fileId === null || b.fileId === null || a.fileId !== b.fileId) return false;
  const aStart = a.startChar;
  const aEnd = a.endChar;
  const bStart = b.startChar;
  const bEnd = b.endChar;
  if (typeof aStart !== "number" || typeof aEnd !== "number" || typeof bStart !== "number" || typeof bEnd !== "number") {
    return false;
  }
  return aStart < bEnd && bStart < aEnd;
}
