/**
 * Question-coverage gate (W12 lane B, contract [R]).
 *
 * WHY THIS EXISTS. The audit of 02.09.2026 reproduced, on the demo corpus,
 * the most dangerous daily behaviour a lawyer's assistant can have: the
 * question "Kira sözleşmesinde depozito iadesi ne zaman yapılır?" came back
 * ŞERHLİ and finalizable, led by TCK m.157 (dolandırıcılık). Nothing in that
 * answer was fabricated — every quote verified — and it was still wrong,
 * because the lexical lane admits a passage on a quarter of the question's
 * lexemes ("sözleşme"), and abstention only fired on an EMPTY evidence set.
 * "We found something" and "we found something that answers the question"
 * are different statements; this module is the second one.
 *
 * WHAT IT MEASURES. The question's CONTENT lexemes — after Turkish search
 * normalization, with function words, question frames, generic legal frame
 * words ("hukuk", "kanun", "madde"…), numbers and short tokens dropped, and a
 * conservative inflectional stemmer applied — against the validated evidence
 * quotes. Two numbers decide the gate:
 *
 *   ratio               weighted union coverage: which content lexemes occur
 *                       in ANY passage. A lexeme present in more than half of
 *                       the passages (when there are at least four) weighs
 *                       0.5 instead of 1: a word every retrieved passage
 *                       contains did not discriminate ("ceza" in a criminal
 *                       corpus). This is the number the reader sees as
 *                       "Soru kapsamı: %63".
 *   bestPassageCovered  the largest number of DISTINCT content lexemes a
 *                       single passage carries. Union coverage alone lets two
 *                       unrelated passages contribute one word each — exactly
 *                       the audit case ("sözleşme" from one decision, "iade"
 *                       from another) — so the gate also requires ONE passage
 *                       to anchor at least two lexemes (or all of them, for a
 *                       one-word question).
 *
 * The gate passes when ratio >= floor (default 0.4) AND a passage anchors the
 * question; it is BYPASSED when the question itself cites a provision or a
 * decision that the exact-reference lane pinned — the reader asked for that
 * text by name, and the text is what they get.
 *
 * WHAT IT IS NOT. A lexical gate is not a relevance model. Two shared
 * substantive words inside one passage pass it ("banka" + "kredi" in TCK
 * m.158 for a question about card fees) — that is a documented limit, not a
 * bug to tune away by special-casing the gold set. The gate's job is to stop
 * the answer that shares one word with the question, and to show the reader
 * which words were never found.
 *
 * Deterministic, offline, and reusable by the eval driver so the product and
 * the measurement cannot disagree about what "covered" means.
 */

import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { ParsedReference } from "../retrieval/referenceParser.js";
import {
  cpLength,
  derivationalAlternate,
  lexemesMatch,
  stemTurkish,
  STOP_STEMS,
} from "../retrieval/turkishAnalyzer.js";

/** Default ratio floor; overridable per pipeline (AnswerPipelineOptions.coverageFloor). */
export const DEFAULT_COVERAGE_FLOOR = 0.4;

export type CoverageGate = "passed" | "failed" | "bypassed-by-reference";

export interface QuestionCoverage {
  /** Weighted union coverage in [0,1]; 0 when the question has no content lexemes. */
  ratio: number;
  /** Content words (as written in the question) found in at least one passage. */
  covered: string[];
  /** Content words (as written in the question) found in no passage. */
  missing: string[];
  /** Every content word of the question, in question order, as written. */
  lexemes: string[];
  /** Number of passages assessed. */
  passages: number;
  /** Max distinct content lexemes carried by a single passage. */
  bestPassageCovered: number;
  /** Index of that passage in the input, or -1 when there are none. */
  bestPassageIndex: number;
}

export interface CoverageDecision extends QuestionCoverage {
  gate: CoverageGate;
  floor: number;
}

/** What the verifier/renderer receive: the decision plus what the gate set aside. */
export interface QuestionCoverageReport extends CoverageDecision {
  /** Retrieved, validated passages the gate refused to admit as evidence. */
  setAside: number;
  /**
   * Additive (W12-FIX, 02.09.2026). True when the gate was bypassed by an
   * explicit reference but the passages actually ADMITTED still cover less
   * than the floor of the question's content words: the reader asked for a
   * provision by name AND asked something else ("TCK m.157 uyarınca kira
   * depozitosu ne zaman iade edilir?"). The provision text is shown; the
   * question is not answered, and the verifier refuses to finalize
   * (reason QUESTION_PARTIALLY_COVERED).
   */
  partiallyCovered?: boolean;
}

export interface CoverageGateOptions {
  floor?: number;
  /** True when a reference parsed from the question matched a pinned hit. */
  referenceMatched?: boolean;
}

// ---------------------------------------------------------------------------
// Lexeme extraction
// ---------------------------------------------------------------------------

/**
 * Words that carry no question-specific content: connectives, question
 * frames, auxiliaries, and the legal frame vocabulary that appears in almost
 * every legal question AND almost every legal passage. Substantive legal
 * nouns (suç, ceza, tazminat, sorumluluk, karar, dava…) are deliberately NOT
 * here — their generic-ness is handled by the pack-frequency weight instead.
 * All entries are in normalizeTurkishSearch form (tr-TR lowercase).
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // connectives / determiners / pronouns
  "ve", "veya", "ya", "yahut", "ile", "ila", "ilâ", "da", "de", "ta", "te", "ki",
  "mi", "mı", "mu", "mü", "midir", "mıdır", "mudur", "müdür", "değil", "değildir",
  "bir", "bu", "şu", "o", "bunlar", "şunlar", "onlar", "bunun", "şunun", "onun",
  "buna", "şuna", "ona", "bunu", "şunu", "onu", "bunda", "bundan", "için", "gibi",
  "göre", "kadar", "sonra", "önce", "ise", "ancak", "fakat", "ama", "lakin", "yani",
  "hem", "aynı", "ayrı", "tüm", "bütün", "her", "hiç", "hiçbir", "herhangi", "bazı",
  "birçok", "daha", "en", "çok", "az", "pek", "yine", "artık", "hâlâ", "hala",
  "şimdi", "bugün", "yarın", "dün", "şey", "şeyler", "şekilde", "şekli", "biçimde",
  // case suffixes split off by an apostrophe ("157'nin", "TCK'daki")
  "nin", "nın", "nun", "nün", "nde", "nda", "dan", "den", "ten", "tan", "yle",
  "yla", "ndan", "nden", "deki", "daki", "teki", "taki", "ndeki", "ndaki",
  // statute abbreviations are LOCATORS (the reference parser owns them)
  "tck", "tbk", "tmk", "hmk", "cmk", "iik", "ttk", "kvkk", "vuk", "gvk", "kvk",
  "türk", "türkiye", "cumhuriyeti",
  "suretiyle", "üzere", "üzerine", "üzerinde", "arasında", "altında", "içinde",
  "dışında", "yerine", "yer", "dahil", "hariç", "kendisi", "kendi", "kendisine",
  // question frames
  "ne", "nedir", "nelerdir", "neler", "neyi", "neye", "neden", "niçin", "niye",
  "nasıl", "hangi", "hangisi", "hangisidir", "hangileri", "kim", "kimdir", "kime",
  "kimin", "kimler", "kaç", "kaçtır", "nerede", "nereye", "nereden", "zaman",
  "hâlinde", "halinde", "hâlde", "halde", "hâl", "hal", "durum", "durumunda",
  "durumda", "takdirde", "koşulunda", "somut", "olayda", "olayımızda", "olayımız",
  "müvekkil", "müvekkilim", "müvekkilimiz", "müvekkilin", "müvekkilimin",
  // auxiliaries and light verbs (surface forms)
  "olan", "olarak", "olur", "olmaz", "olabilir", "olamaz", "olmayan", "olmaksızın",
  "olması", "olmaması", "olup", "oldu", "olduğu", "olmadığı", "olacak", "olsa",
  "olsun", "olmak", "olma", "var", "vardır", "yok", "yoktur", "mümkün", "mümkündür",
  "gerekir", "gerekli", "gereken", "gerekmektedir", "gerek", "lazım", "lazımdır",
  "zorunlu", "zorunludur", "uygulanır", "uygulanabilir", "uygulanmaz",
  "uygulanması", "uygulanan", "yapılır", "yapılabilir", "yapılmalı", "yapılmalıdır",
  "yapılması", "yapılan", "yapılmış", "yapılmıştır", "yapar", "yapan", "yapmak",
  "yapma", "edilir", "edilebilir", "edilmez", "edilmesi", "edilmemesi", "edilen",
  "eden", "etmek", "etme", "etmesi", "edilmiş", "edilmiştir", "verilir",
  "verilebilir", "verilmesi", "verilen", "verilmez", "veren", "vermek", "verme",
  "sayılır", "sayılmaz", "sayılan", "sayılması", "kabul", "bulunur", "bulunan",
  "bulunması", "bulunmak", "bulunma", "bulunmaz", "alır", "alınır", "alınan",
  "alınması", "alındıktan", "alındığında", "almak", "alma", "alması",
  // legal frame vocabulary
  "hukuk", "hukuki", "hukukî", "hukuken", "hukuka", "hukukun", "hukukta", "kanun",
  "kanunu", "kanunun", "kanuna", "kanunda", "kanunen", "kanuni", "kanunî", "yasa",
  "yasal", "yasanın", "mevzuat", "mevzuatı", "mevzuata", "madde", "maddesi",
  "maddesinde", "maddesine", "maddenin", "maddede", "md", "fıkra", "fıkrası",
  "fıkrasında", "bent", "bendi", "hüküm", "hükmü", "hükmüne", "hükmünde",
  "hükümleri", "hükümlerine", "hükümler", "düzenleme", "düzenlemesi",
  "düzenlenmiştir", "düzenlenir", "düzenlenen", "düzenlenmesi", "sayılı",
  "tarihli", "numaralı", "nolu", "gereği", "gereğidir", "hakkında", "ilişkin",
  "ilgili", "dair", "uyarınca", "gereğince", "kapsamında", "çerçevesinde",
  "açısından", "bakımından", "konusunda", "yönünden", "tarafından", "itibarıyla",
  "itibariyle", "itibaren",
]);


/**
 * The Turkish stemmer and its companions moved to
 * `retrieval/turkishAnalyzer.ts` (2026-09-10) so the planner no longer
 * imports morphology from the answer layer. Re-exported unchanged: the unit
 * tests and every existing import path keep working.
 */
export { stemTurkish, derivationalAlternate, lexemesMatch };

/** One content word of the question: what the reader wrote, and how it is matched. */
interface Lexeme {
  /** The word as written in the question (what the reader is shown). */
  surface: string;
  /** Inflection-stripped, softening-folded matching form. */
  stem: string;
  /** Optional derivational alternate (matching only). */
  alt: string | undefined;
}

function tokensOf(text: string): string[] {
  return normalizeTurkishSearch(text)
    .split(/[^\p{L}\p{M}]+/u)
    .filter((token) => token !== "");
}

function lexemesOf(text: string): Lexeme[] {
  const out: Lexeme[] = [];
  const seen = new Set<string>();
  for (const token of tokensOf(text)) {
    if (cpLength(token) < 3) continue;
    if (STOPWORDS.has(token)) continue;
    const stem = stemTurkish(token);
    if (cpLength(stem) < 3) continue;
    if (STOP_STEMS.has(stem)) continue;
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push({ surface: token, stem, alt: derivationalAlternate(stem) });
  }
  return out;
}

/**
 * Content words of the question in SURFACE form (normalized, deduplicated by
 * stem, question order) — the list a reader sees as covered/missing.
 * Exported for tests.
 */
export function contentLexemes(text: string): string[] {
  return lexemesOf(text).map((lexeme) => lexeme.surface);
}

/** Every matching form of a passage (stem + derivational alternate). */
function passageStems(text: string): string[] {
  const out = new Set<string>();
  for (const token of tokensOf(text)) {
    if (cpLength(token) < 3) continue;
    const stem = stemTurkish(token);
    out.add(stem);
    const alt = derivationalAlternate(stem);
    if (alt !== undefined) out.add(alt);
  }
  return [...out];
}

function passageCovers(lexeme: Lexeme, stems: readonly string[]): boolean {
  for (const stem of stems) {
    if (lexemesMatch(lexeme.stem, stem)) return true;
    if (lexeme.alt !== undefined && lexemesMatch(lexeme.alt, stem)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-passage coverage map (used by the pipeline's coverage-aware evidence cap)
// ---------------------------------------------------------------------------

export interface PassageCoverageMap {
  /** Content words of the question, as written, question order. */
  lexemes: string[];
  /** For each passage, the indices (into `lexemes`) it covers. */
  covered: number[][];
}

/**
 * Which of the question's content words each passage carries. The answer
 * pipeline uses this BEFORE the evidence cap: a passage that would be cut by
 * the cap while carrying a question word no kept passage has must not lose
 * its place to one that repeats what the kept set already says — that is how
 * an answerable question ("which torba law raised the penalty, and when?")
 * turned into a false abstention on the top-8 pack while the driver, which
 * sees every ranked hit, passed it.
 */
export function mapPassageCoverage(
  question: string,
  passages: readonly string[],
): PassageCoverageMap {
  const entries = lexemesOf(question);
  return {
    lexemes: entries.map((entry) => entry.surface),
    covered: passages.map((passage) => {
      const stems = passageStems(passage);
      const out: number[] = [];
      entries.forEach((entry, index) => {
        if (passageCovers(entry, stems)) out.push(index);
      });
      return out;
    }),
  };
}

// ---------------------------------------------------------------------------
// Assessment + gate
// ---------------------------------------------------------------------------

/**
 * Coverage of the question's content lexemes by the given passages.
 * Contract [R]: `ratio = covered lexemes / content lexemes` (weighted as
 * described in the module header), `covered`, `missing`.
 */
export function assessQuestionCoverage(
  question: string,
  quotes: readonly string[],
): QuestionCoverage {
  const entries = lexemesOf(question);
  const lexemes = entries.map((entry) => entry.surface);
  const passages = quotes.map(passageStems);

  const presence: boolean[][] = entries.map((entry) =>
    passages.map((stems) => passageCovers(entry, stems)),
  );

  const covered: string[] = [];
  const missing: string[] = [];
  let weightTotal = 0;
  let weightCovered = 0;
  entries.forEach((entry, index) => {
    const row = presence[index] as boolean[];
    const count = row.filter(Boolean).length;
    const generic = passages.length >= 4 && count > passages.length / 2;
    const weight = generic ? 0.5 : 1;
    weightTotal += weight;
    if (count > 0) {
      weightCovered += weight;
      covered.push(entry.surface);
    } else {
      missing.push(entry.surface);
    }
  });

  let bestPassageCovered = 0;
  let bestPassageIndex = -1;
  passages.forEach((_stems, passageIndex) => {
    let hits = 0;
    for (const row of presence) if (row[passageIndex] === true) hits += 1;
    if (hits > bestPassageCovered) {
      bestPassageCovered = hits;
      bestPassageIndex = passageIndex;
    }
  });

  return {
    ratio: weightTotal === 0 ? 0 : weightCovered / weightTotal,
    covered,
    missing,
    lexemes,
    passages: passages.length,
    bestPassageCovered,
    bestPassageIndex,
  };
}

/** The gate decision, separated from the measurement so both are testable. */
export function decideCoverageGate(
  coverage: QuestionCoverage,
  options: CoverageGateOptions = {},
): CoverageGate {
  if (options.referenceMatched === true) return "bypassed-by-reference";
  if (coverage.lexemes.length === 0 || coverage.passages === 0) return "failed";
  const floor = options.floor ?? DEFAULT_COVERAGE_FLOOR;
  const anchored =
    coverage.bestPassageCovered >= 2 ||
    coverage.bestPassageCovered === coverage.lexemes.length;
  return coverage.ratio + 1e-9 >= floor && anchored ? "passed" : "failed";
}

/** Measurement + decision in one call (what the pipeline and the eval driver use). */
export function evaluateQuestionCoverage(
  question: string,
  quotes: readonly string[],
  options: CoverageGateOptions = {},
): CoverageDecision {
  const coverage = assessQuestionCoverage(question, quotes);
  return {
    ...coverage,
    gate: decideCoverageGate(coverage, options),
    floor: options.floor ?? DEFAULT_COVERAGE_FLOOR,
  };
}

/**
 * How specific the question's own citation is (W14 B-07).
 *
 *   "none"      no resolved citation, or nothing pinned;
 *   "article"   an ARTICLE-LEVEL request: a legislation number plus an article
 *               ("TBK m. 49"), or a decision by E. + K. The reader named ONE
 *               text; the pinned text is the answer and is admitted by right;
 *   "bare-law"  the law was named without an article ("TBK'ya göre",
 *               "TCK bakımından"). `exactPinLookup` then pins EVERY chunk of
 *               that law, so admitting pinned passages by right would admit
 *               the whole statute.
 */
export type ReferenceBypassKind = "none" | "article" | "bare-law";

/**
 * WHY "bare-law" exists (measured 02.09.2026, DAILYFLOW §2).
 *
 * "kira sozlesmesinde depozito iadesi ne zaman yapilir" abstained — correctly,
 * the corpus has nothing on it. Adding the four words a Turkish lawyer writes
 * in every sentence — "tbk ya gore" — turned it into KISMİ with 8 pieces of
 * evidence and 6 findings (TBK m. 2, 12, 49, 50, 51: haksız fiil and tazminat
 * articles), `coverage.ratio 0`, missing words "kira, sozlesmesinde, depozito,
 * iadesi". Same for "TCK bakımından işyerinde mobbing suç mudur?": seven
 * findings about yağma, hırsızlık and dolandırıcılık, nothing about mobbing.
 *
 * The mechanism: a bare law reference pins every chunk of that law, the gate
 * is bypassed, and the per-passage admission (W12-FIX) admits every pinned
 * passage BY RIGHT — and under a bare-law pin every passage is pinned. So the
 * product's strongest safeguard switched itself off in the single most common
 * Turkish legal phrasing.
 *
 * The rule: a bare law name still PINS (the reader did ask about that law and
 * ranking should reflect it), but it buys no passage an exemption from the
 * question-coverage test. Each pinned passage must anchor the question on its
 * own; if none does, the answer abstains with QUESTION_NOT_COVERED. No gate
 * value changes — what changes is which passage may skip the gate.
 */
export function classifyReferenceBypass(
  references: readonly ParsedReference[],
  hits: readonly { pinned: boolean }[],
): ReferenceBypassKind {
  if (!hits.some((hit) => hit.pinned)) return "none";
  const legislation = references.some(
    (reference) =>
      reference.kind === "legislation" && reference.legislationNo !== undefined,
  );
  // The parser emits the article as its own `kind: "article"` reference, and
  // exactPinLookup pins on (legislation_no, article_no) only when both are
  // present — so an article without a law is not article-level here either.
  const article =
    legislation &&
    references.some(
      (reference) => reference.kind === "article" && reference.articleNo !== undefined,
    );
  const decision = references.some(
    (reference) =>
      reference.kind === "court_decision" &&
      reference.docketNo !== undefined &&
      reference.decisionNo !== undefined,
  );
  if (article || decision) return "article";
  return legislation ? "bare-law" : "none";
}

/**
 * The bypass condition: the question names a provision (legislation with a
 * resolved number) or a decision (E. + K.), AND the exact-reference lane
 * pinned a hit for it. Since citation expansion no longer pins (hybrid.ts),
 * a pinned hit is by construction a match on the QUESTION's own reference.
 */
export function referenceBypass(
  references: readonly ParsedReference[],
  hits: readonly { pinned: boolean }[],
): boolean {
  return classifyReferenceBypass(references, hits) !== "none";
}

// ---------------------------------------------------------------------------
// Per-passage admission (W12-FIX, 02.09.2026)
// ---------------------------------------------------------------------------

export interface PassageAdmission {
  /** Indices (into the input) admitted as evidence. */
  admitted: number[];
  /** Indices set aside — reported by identity, never quoted. */
  setAside: number[];
}

/**
 * What the reference bypass admits, passage by passage.
 *
 * WHY. The bypass used to admit the WHOLE pack: a question that named a
 * provision the exact lane pinned skipped the gate for every passage the
 * lexical and trigram lanes had dragged in on one shared word. Reviewed
 * 02.09.2026: "TCK m.157 uyarınca kira sözleşmesinde depozito iadesi ne
 * zaman yapılır?" came back QUALIFIED and finalizable with SEVEN unpinned
 * dolandırıcılık passages, while the same question without the citation
 * abstained. The citation is a request for THAT text, not a licence for
 * everything retrieved next to it.
 *
 * RULE. A pinned passage is admitted unconditionally (it is the text the
 * reader asked for by name). A non-pinned passage must pass the normal
 * gate ON ITS OWN: it anchors the question (at least two distinct content
 * lexemes, or all of them for a one-word question) AND its share of the
 * question's content lexemes reaches the floor. A question with no content
 * lexemes at all ("TCK m.157 nedir?") admits only the pinned text.
 *
 * W14 B-07: "pinned" here means ARTICLE-LEVEL pinned. Under a bare law name
 * the caller passes `pinned: false` for every passage — see
 * classifyReferenceBypass — so a statute pinned whole earns no exemption.
 */
export function admitUnderReferenceBypass(
  question: string,
  passages: readonly {
    quote: string;
    /** Pinned by an ARTICLE-level citation: admitted by right. */
    pinned: boolean;
    /**
     * Pinned only because the question named the LAW (W14 B-07). Not admitted
     * by right, but the pin is still evidence that the reader asked about this
     * instrument, so the anchor is one content word instead of two — the
     * coverage floor itself is unchanged and still applies.
     *
     * Why one and not two (measured 02.09.2026, run_evals): with the two-word
     * anchor, "7999 sayılı Kanun ile 6098 sayılı Türk Borçlar Kanununda hangi
     * değişiklik yapılmıştır?" abstained — the amending article carries
     * "değişiklik" but not "borçlar", so a question the corpus answers came
     * back empty. With one word, that row answers again AND the audited
     * failure still abstains, because its passages share ZERO content words
     * with the question.
     */
    pinnedByLaw?: boolean;
  }[],
  options: { floor?: number } = {},
): PassageAdmission {
  const floor = options.floor ?? DEFAULT_COVERAGE_FLOOR;
  const map = mapPassageCoverage(
    question,
    passages.map((passage) => passage.quote),
  );
  const total = map.lexemes.length;
  const admitted: number[] = [];
  const setAside: number[] = [];
  passages.forEach((passage, index) => {
    if (passage.pinned) {
      admitted.push(index);
      return;
    }
    const hits = (map.covered[index] ?? []).length;
    const minimum = passage.pinnedByLaw === true ? 1 : 2;
    const anchored = total > 0 && (hits >= minimum || hits === total);
    const share = total === 0 ? 0 : hits / total;
    if (anchored && share + 1e-9 >= floor) admitted.push(index);
    else setAside.push(index);
  });
  return { admitted, setAside };
}

/**
 * Admission over the reader's OWN uploaded documents (file scope without the
 * corpus). The union gate still applies to the answer, but a passage of the
 * lawyer's own dilekçe that shares NO content word with the question is not
 * "the document answering the question" — it is the document being quoted
 * because it was searched. Reviewed 02.09.2026: a nafaka question over a
 * kira cevap dilekçesi returned the DOSYA NO header and the yetki itirazı
 * paragraph as "DESTEKLENİYOR". Zero-overlap passages are set aside; a
 * question with no content lexemes keeps every passage (nothing to test).
 */
export function admitUploadOnlyPassages(
  question: string,
  passages: readonly string[],
): PassageAdmission {
  const map = mapPassageCoverage(question, passages);
  const admitted: number[] = [];
  const setAside: number[] = [];
  passages.forEach((_passage, index) => {
    if (map.lexemes.length === 0 || (map.covered[index] ?? []).length > 0) admitted.push(index);
    else setAside.push(index);
  });
  return { admitted, setAside };
}
