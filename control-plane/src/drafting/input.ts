/**
 * Input normalization for the drafting lane (W12 lane C).
 *
 * The operator console posts multiline textareas as ONE string. Before this
 * module the composer silently dropped such values (a `liste` slot only
 * understood arrays) and printed "usul itirazı bulunmamaktadır" — an HMK
 * m.116-117 rights-loss hazard. Every list-kind input now accepts a string
 * (split on newlines, trimmed, empties dropped) OR a string array, and the
 * party/event lists accept their line forms too.
 *
 * Dates: every user-facing surface renders GG.AA.YYYY. Inputs may arrive as
 * YYYY-MM-DD (API), GG.AA.YYYY or GG/AA/YYYY (typed); anything else is kept
 * verbatim — a date is never invented or dropped because it did not parse.
 */

import { analyzeIntake } from "../planner/intake.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/u;
const TR_DATE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/u;
const LIST_BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/u;
const PARTY_PAREN = /^(.+?)\s*\(([^()]+)\)\s*$/u;
const EVENT_DATED = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})\s*[—:-]?\s*(.+)$/u;

/** Split a list-kind value into trimmed, non-empty items. */
export function splitLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/u)
      .map((line) => line.replace(LIST_BULLET, "").trim())
      .filter((line) => line !== "");
  }
  return [];
}

/** "YYYY-MM-DD" for a sortable date, or undefined when unparseable. */
export function dateSortKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim();
  const iso = raw.match(ISO_DATE);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const tr = raw.match(TR_DATE);
  if (tr !== null) {
    return `${tr[3]}-${(tr[2] as string).padStart(2, "0")}-${(tr[1] as string).padStart(2, "0")}`;
  }
  return undefined;
}

/** Render a date as GG.AA.YYYY; unparseable input is returned unchanged. */
export function formatDateTr(value: string): string {
  const key = dateSortKey(value);
  if (key === undefined) return value.trim();
  const [year, month, day] = key.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Render an ISO timestamp as "GG.AA.YYYY HH:MM" in the server's LOCAL time
 * (the lawyer's machine — W12-FIX2, P2-5: exports used to print UTC with a
 * "(UTC)" tag, three hours off the clock on the wall). Unparseable →
 * unchanged. ISO stays available in the machine fields.
 */
export function formatTimestampTr(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${pad(parsed.getDate())}.${pad(parsed.getMonth() + 1)}.${parsed.getFullYear()}` +
    ` ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

/** Today's date (from `now`) as GG.AA.YYYY. */
export function todayTr(now: Date): string {
  return formatDateTr(now.toISOString().slice(0, 10));
}

/**
 * Turkish dative suffix for an addressee line: "…MAHKEMESİ'NE",
 * "…BAŞKANLIĞI'NA". Vowel harmony on the last vowel; the lawyer reviews.
 */
export function datifSuffix(word: string): string {
  const lower = word.toLocaleLowerCase("tr-TR");
  for (let i = lower.length - 1; i >= 0; i -= 1) {
    const ch = lower[i] as string;
    if ("aıou".includes(ch)) return "'NA";
    if ("eiöü".includes(ch)) return "'NE";
  }
  return "'NE";
}

/** "Rol : Ad" / "Rol: Ad" / "Ad (Rol)" → party; undefined when unparseable. */
export function parsePartyLine(line: string): { ad: string; rol: string } | undefined {
  const trimmed = line.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const rol = trimmed.slice(0, colon).trim();
    const ad = trimmed.slice(colon + 1).trim();
    if (rol !== "" && ad !== "") return { ad, rol };
  }
  const paren = trimmed.match(PARTY_PAREN);
  if (paren !== null) {
    const ad = (paren[1] as string).trim();
    const rol = (paren[2] as string).trim();
    if (rol !== "" && ad !== "") return { ad, rol };
  }
  return undefined;
}

/** "YYYY-MM-DD metin" / "GG.AA.YYYY — metin" / "metin" → event. */
export function parseEventLine(line: string): { tarih?: string; metin: string } {
  const trimmed = line.trim();
  const dated = trimmed.match(EVENT_DATED);
  if (dated !== null) {
    return { tarih: dated[1] as string, metin: (dated[2] as string).trim() };
  }
  return { metin: trimmed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pre-zod normalization of a POST /v1/drafts body: line-form list inputs
 * become the arrays the schema expects. Anything already in the array form
 * passes through untouched; anything unrecognizable is left for zod to
 * reject with a Turkish message.
 */
export function normalizeDraftRequestInput(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body["matter"])) return body;
  const matter: Record<string, unknown> = { ...body["matter"] };

  if (typeof matter["taraflar"] === "string") {
    const parsed = splitLines(matter["taraflar"]).map(parsePartyLine);
    // A line that does not parse stays a string so zod reports the field.
    matter["taraflar"] = parsed.every((p) => p !== undefined) ? parsed : matter["taraflar"];
  }
  if (typeof matter["olaylar"] === "string") {
    matter["olaylar"] = splitLines(matter["olaylar"]).map(parseEventLine);
  }
  if (typeof matter["talepler"] === "string") {
    matter["talepler"] = splitLines(matter["talepler"]);
  }
  if (isRecord(matter["arabuluculuk"])) {
    const ara: Record<string, unknown> = { ...matter["arabuluculuk"] };
    const yapildi = ara["yapildi"];
    if (typeof yapildi === "string") {
      const lower = yapildi.trim().toLocaleLowerCase("tr-TR");
      if (["evet", "yapıldı", "true", "1"].includes(lower)) ara["yapildi"] = true;
      else if (["hayır", "hayir", "yapılmadı", "false", "0", ""].includes(lower)) {
        ara["yapildi"] = false;
      }
    }
    matter["arabuluculuk"] = ara;
  }
  return { ...body, matter };
}

// ---------------------------------------------------------------------------
// Olay anlatısı — the lawyer's own free-text account of what happened
// ---------------------------------------------------------------------------

/**
 * `ekBilgiler` key holding the free-text narrative ("Olayı kendi
 * cümlelerinizle anlatın"). It is ONE optional field on every dilekçe
 * template; the composer turns it into beyan paragraphs and into
 * SUGGESTIONS, never into a hukukî değerlendirme (ADR-021).
 */
export const OLAY_ANLATISI_KEY = "olayAnlatisi";

/** Longest narrative sentence still worth offering as a fact suggestion. */
const NARRATIVE_SENTENCE_MAX = 400;
/** Shortest one — below this a "sentence" is a heading or a stray fragment. */
const NARRATIVE_SENTENCE_MIN = 15;

/** How many concept words the search suggestion may name. */
export const MAX_NARRATIVE_CONCEPTS = 6;

/** Shortest word that can carry a searchable legal concept ("kira", "fesih"). */
const CONCEPT_MIN_LENGTH = 4;

/**
 * Words that carry no search value in a Turkish narrative. Deliberately
 * small: this list only has to stop the words that would otherwise crowd out
 * the real concepts, and a word wrongly kept costs the lawyer nothing but a
 * glance.
 */
const CONCEPT_STOPWORDS: ReadonlySet<string> = new Set([
  "ancak", "ayrıca", "bunun", "buna", "bunu", "böyle", "şöyle", "daha", "sonra", "önce",
  "kadar", "için", "gibi", "göre", "olan", "olarak", "olduğu", "oldu", "olmuş", "olmasına",
  "üzere", "dolayı", "nedeniyle", "sebebiyle", "hakkında", "tarafından", "bulunan",
  "yapılan", "yapılmış", "şekilde", "durumda", "halde", "hâlde", "yine", "fakat", "ama",
  "benim", "bizim", "onun", "kendi", "müvekkil", "müvekkilim", "müvekkilimiz", "müvekkile",
  "müvekkilin", "davacı", "davalı", "taraf", "taraflar", "tarafın", "husus", "konusunda",
  "tarihinde", "tarihli", "tarihinden", "iken", "diye", "değil", "vardı", "yoktu",
]);

/**
 * Split a narrative into sentences. Newlines end a sentence too — a lawyer
 * typing into a textarea uses them as punctuation. Fragments shorter than
 * `NARRATIVE_SENTENCE_MIN` or longer than `NARRATIVE_SENTENCE_MAX` are
 * dropped: the first is not a fact, the second is a paragraph.
 */
export function splitNarrativeSentences(text: string): string[] {
  return text
    .split(/\r?\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+/u))
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter(
      (sentence) =>
        sentence.length >= NARRATIVE_SENTENCE_MIN && sentence.length <= NARRATIVE_SENTENCE_MAX,
    );
}

/**
 * Concept words of a narrative, most frequent first, ties broken by first
 * appearance. The surface form the lawyer typed is kept (this is a SEARCH
 * SUGGESTION shown on screen, not a normalized index token). Nothing is
 * searched automatically — the composer only names the words.
 */
export function narrativeConcepts(text: string): string[] {
  const counts = new Map<string, { surface: string; count: number; first: number }>();
  let index = 0;
  for (const match of text.matchAll(/\p{L}+/gu)) {
    const surface = match[0];
    index += 1;
    if (surface.length < CONCEPT_MIN_LENGTH) continue;
    const key = surface.toLocaleLowerCase("tr-TR");
    if (CONCEPT_STOPWORDS.has(key)) continue;
    const existing = counts.get(key);
    if (existing === undefined) counts.set(key, { surface, count: 1, first: index });
    else existing.count += 1;
  }
  return [...counts.values()]
    .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : a.first - b.first))
    .slice(0, MAX_NARRATIVE_CONCEPTS)
    .map((entry) => entry.surface);
}

/**
 * The lawyer-facing search SUGGESTION derived from a free-text account
 * (W16 şerit E, step 1b).
 *
 * `concepts` are the şerit A concept engine's own labels — `analyzeIntake`
 * runs the SAME table, the same specificity ordering and the same issue cap
 * the research planner runs, so the words offered here are the words a
 * research run would actually use. `terms` are that engine's expansions and
 * `anchors` its statutory hooks, in citation form.
 *
 * Three things this is NOT, and the composer's wording says so on screen:
 * it is not a search (nothing is queried here), it is not evidence, and an
 * anchor is not verified law — the table wrote it down, nobody re-read the
 * article. When the concept table matches nothing, the engine's fallback
 * issue is the normalized question itself; that is not a concept, so the
 * frequency words of `narrativeConcepts` are offered instead.
 */
export interface NarrativeSearchSuggestion {
  concepts: string[];
  terms: string[];
  anchors: string[];
}

export function narrativeSearchSuggestion(text: string): NarrativeSearchSuggestion {
  const trimmed = text.trim();
  if (trimmed === "") return { concepts: [], terms: [], anchors: [] };
  const analysis = analyzeIntake({ question: trimmed, jurisdiction: "TR", dataClass: "L0" });
  const concepts: string[] = [];
  const terms: string[] = [];
  const anchors: string[] = [];
  for (const issue of analysis.issues) {
    if (issue.kind !== "conceptual") continue;
    // The engine's no-match fallback carries the whole normalized question as
    // its "concept". That is not a concept and must never be offered as one.
    if (issue.concept === analysis.normalizedQuestion) continue;
    if (!concepts.includes(issue.label)) concepts.push(issue.label);
    for (const term of issue.expandedTerms) if (!terms.includes(term)) terms.push(term);
    for (const anchor of issue.anchors ?? []) if (!anchors.includes(anchor)) anchors.push(anchor);
  }
  if (concepts.length === 0) {
    // Nothing in the concept table matched: fall back to the account's own
    // frequent words. They are offered as WORDS, never as legal concepts.
    for (const word of narrativeConcepts(trimmed)) {
      concepts.push(word);
      terms.push(word);
    }
  }
  return { concepts, terms, anchors };
}
