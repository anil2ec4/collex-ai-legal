/**
 * Shared Turkish analyzer for the TypeScript control-plane (retrieval item 4,
 * 2026-09-10).
 *
 * WHY ONE FILE. Two modules used to carry their own ad-hoc Turkish morphology:
 * `answer/coverage.ts` (the question-coverage stemmer) and `planner/intake.ts`
 * (concept matching, which imported the stemmer from coverage.ts and grew its
 * own final-consonant softening next to it). A stemmer that lives inside the
 * coverage gate is a dependency in the wrong direction — the planner is not
 * an answer concern — and two copies of "undo consonant softening" are two
 * places for the rule to drift. This module owns:
 *
 *   - dotted/dotless-I folding (`foldTurkishCase`): İ -> i, I -> ı, then a
 *     plain lowercase, applied EXPLICITLY so the result never depends on a
 *     locale-sensitive `toLocaleLowerCase` (same reasoning as
 *     `retrieval/normalize.ts::shadowFold`, whose punctuation folding is
 *     deliberately NOT repeated here);
 *   - the conservative inflectional stemmer (`stemTurkish`), its suffix
 *     tables, the derivational alternate and the prefix-tolerant lexeme
 *     comparison (`lexemesMatch`), moved here VERBATIM from coverage.ts;
 *   - final-consonant softening in both directions (`foldFinalConsonant`
 *     undoes it, `softenFinalConsonant` applies it) so "araç" == "aracı"
 *     and "temerrüt" matches "temerrüde" through one table.
 *
 * NO PYTHON MIRROR. Unlike the reference parser and the search normalizer,
 * nothing in this file is pinned by a cross-runtime parity fixture: the
 * Python side has no stemmer (verified by grep on 2026-09-10). Behaviour is
 * therefore unchanged by the move — coverage.ts re-exports the same
 * functions — and `tests/answer/coverage.test.ts` keeps pinning them.
 */

/** Unicode code-point length (the project measures text in code points). */
export function cpLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/**
 * Dotted/dotless-I folding + lowercase, locale-independent. Turkish has two
 * distinct i's; a plain `toLowerCase()` maps U+0130 (İ) to "i" + U+0307 and
 * U+0049 (I) to "i", which is wrong for "ISPARTA" (-> "ısparta"). Folding the
 * two capitals FIRST keeps every character one code point and makes the
 * result identical to what `normalizeTurkishSearch` produces for letters.
 */
export function foldTurkishCase(input: string): string {
  return input.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

/** Final-consonant softening as Turkish applies it before a vowel suffix. */
const SOFTEN: Readonly<Record<string, string>> = { p: "b", ç: "c", t: "d", k: "ğ" };

/**
 * "temerrüt" -> "temerrüd", "araç" -> "arac": the form a word takes before a
 * vowel-initial suffix. Returns the input unchanged when the last letter is
 * not one of p/ç/t/k.
 */
export function softenFinalConsonant(word: string): string {
  const points = Array.from(word);
  const last = points[points.length - 1];
  if (last === undefined) return word;
  const soft = SOFTEN[last];
  if (soft === undefined) return word;
  points[points.length - 1] = soft;
  return points.join("");
}

/** The inverse of {@link softenFinalConsonant}; see FINAL_FOLD below. */
export function foldFinalConsonant(word: string): string {
  const points = Array.from(word);
  const last = points[points.length - 1];
  if (last !== undefined && FINAL_FOLD[last] !== undefined) {
    points[points.length - 1] = FINAL_FOLD[last] as string;
  }
  return points.join("");
}

/**
 * Stems that survive inflectional stripping and still carry no content:
 * light verbs and the legal frame nouns in whatever case they were written
 * ("hukukunda" -> "hukuk").
 */
export const STOP_STEMS: ReadonlySet<string> = new Set([
  "et", "ed", "edil", "ol", "olma", "bulun", "yap", "yapıl", "ver", "veril",
  "sayıl", "kıl", "gel", "gir", "al", "alın", "git", "gid", "kal", "dur", "bul",
  "hukuk", "kanun", "yasa", "madde", "fıkra", "bent", "hüküm", "hükm", "mevzuat",
  "düzenle", "düzenlen", "türk", "hâl", "hal", "durum", "şekil", "şekl",
]);

/**
 * INFLECTIONAL suffixes stripped from the END of a token, longest first, up
 * to three rounds: case, possessive, plural, and the most common participle,
 * passive and copula endings. Deliberately absent: derivational endings
 * (-lık, -cı, -ma) and the short verbal endings (-ar/-er/-ır/-ir/-an/-en) —
 * stripping those turns "dolandırıcılık" into "dolandır" and "karar" into
 * "kar". Derivation is handled by `derivationalAlternate` for matching only,
 * and the prefix tolerance in `lexemesMatch` covers the verbal forms.
 */
export const SUFFIXES: readonly string[] = [
  // plural + case/possessive chains
  "larından", "lerinden", "larına", "lerine", "larında", "lerinde", "ların",
  "lerin", "lardan", "lerden", "larda", "lerde", "larla", "lerle", "ları", "leri",
  "lara", "lere", "lar", "ler",
  // possessive (3rd person) + case
  "sından", "sinden", "sundan", "sünden", "sında", "sinde", "sunda", "sünde",
  "sının", "sinin", "sunun", "sünün", "sıyla", "siyle", "suyla", "süyle", "sına",
  "sine", "suna", "süne", "sını", "sini", "sunu", "sünü",
  "ından", "inden", "undan", "ünden", "ında", "inde", "unda", "ünde", "ının",
  "inin", "unun", "ünün", "ıyla", "iyle", "uyla", "üyle", "ına", "ine", "una",
  "üne", "ını", "ini", "unu", "ünü",
  // case
  "ndan", "nden", "nda", "nde", "nın", "nin", "nun", "nün", "dan", "den", "tan",
  "ten", "yla", "yle", "ya", "ye", "yı", "yi", "yu", "yü", "da", "de", "ta", "te",
  "la", "le", "ın", "in", "un", "ün", "sı", "si", "su", "sü", "ım", "im", "um",
  "üm",
  // participles / passives / copula
  "mış", "miş", "muş", "müş", "dığında", "diğinde", "dığı", "diği", "duğu",
  "düğü", "tığı", "tiği", "tuğu", "tüğü", "dıkça", "dikçe", "dıktan", "dikten",
  "dık", "dik", "duk", "dük", "tık", "tik", "tuk", "tük", "ılmış", "ilmiş",
  "ulmuş", "ülmüş", "ılmaz", "ilmez", "ılır", "ilir", "ulur", "ülür", "ılan",
  "ilen", "ulan", "ülen", "ecağı", "acağı", "ecek", "acak", "yor", "dır", "dir",
  "dur", "dür", "tır", "tir", "tur", "tür", "arak", "erek", "ıl", "il", "ul", "ül",
  // bare vowel endings (accusative/possessive); stem must stay >= 4
  "ı", "i", "u", "ü", "a", "e",
].slice().sort((a, b) => b.length - a.length);

/** Derivational endings tried ONCE, for matching only (never displayed). */
export const DERIVATIONAL: readonly string[] = ["lık", "lik", "luk", "lük", "cı", "ci", "cu", "cü", "çı", "çi", "çu", "çü", "ma", "me"];

const VOWEL_ONLY: ReadonlySet<string> = new Set(["ı", "i", "u", "ü", "a", "e"]);

/** Final-consonant softening undone (ç/c, k/ğ, p/b, t/d) so "araç" == "aracı". */
const FINAL_FOLD: Readonly<Record<string, string>> = { ğ: "k", c: "ç", b: "p", d: "t" };

function sharedPrefixLength(a: string, b: string): number {
  const pa = Array.from(a);
  const pb = Array.from(b);
  const max = Math.min(pa.length, pb.length);
  let n = 0;
  while (n < max && pa[n] === pb[n]) n += 1;
  return n;
}

/**
 * Conservative Turkish stemmer: strip up to three inflectional suffixes, never
 * below three code points (four for a bare-vowel suffix, so "kira" stays
 * "kira"), then undo final-consonant softening. Exported for the unit tests.
 */
export function stemTurkish(token: string): string {
  let stem = token;
  for (let round = 0; round < 3; round += 1) {
    // A frame/light-verb stem is a stopping point: "maddesinin" must end at
    // "madde" (which lexemesOf then drops), never continue to "mad".
    if (STOP_STEMS.has(stem)) break;
    let stripped = false;
    for (const suffix of SUFFIXES) {
      if (!stem.endsWith(suffix)) continue;
      const bareVowel = VOWEL_ONLY.has(suffix);
      // A bare vowel is only an inflection on the ORIGINAL token ("aracı",
      // "kararı"); after a chain has already been removed the trailing vowel
      // belongs to the stem ("sözleşmesinde" -> "sözleşme", not "sözleşm").
      if (bareVowel && round > 0) continue;
      const remaining = cpLength(stem) - cpLength(suffix);
      const floor = bareVowel ? 4 : 3;
      if (remaining < floor) continue;
      stem = stem.slice(0, stem.length - suffix.length);
      stripped = true;
      break;
    }
    if (!stripped) break;
  }
  return foldFinalConsonant(stem);
}

/**
 * The stem minus ONE derivational ending, when that leaves at least five code
 * points; used as an extra matching form so "değişiklik" (stem) can meet
 * "değiştirilmiştir" (stem "değiştir") through "değişik". Undefined when no
 * ending applies.
 */
export function derivationalAlternate(stem: string): string | undefined {
  for (const suffix of DERIVATIONAL) {
    if (!stem.endsWith(suffix)) continue;
    if (cpLength(stem) - cpLength(suffix) < 5) continue;
    return stem.slice(0, stem.length - suffix.length);
  }
  return undefined;
}

/**
 * Two stems name the same lexeme when equal, or when both are at least four
 * code points long and share a prefix of at least max(4, 70% of the shorter).
 * This is what lets "dolandırıcılık" meet "dolandırıcılığın" and "belirlenir"
 * meet "belirler" without a full morphological analyser.
 */
export function lexemesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(cpLength(a), cpLength(b));
  if (min < 4) return false;
  return sharedPrefixLength(a, b) >= Math.max(4, Math.ceil(0.7 * min));
}
