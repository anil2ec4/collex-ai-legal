/**
 * Karşı Dilekçe Analizi — rule-based, model-free, cloud-free (W16 · Şerit D).
 *
 * WHAT THIS IS FOR. The other side files a dilekçe. The lawyer has to answer
 * three questions before the duruşma, and only three:
 *
 *   1. Hangi iddiaları ileri sürüyor?        (iddia çıkarımı)
 *   2. Bu iddiaların dayandığı atıflar var mı, doğru mu? (atıf denetimi)
 *   3. Aksi yönde kaynak var mı?             (aleyhe kaynak)
 *
 * De Jure's "Dilekçe Analizi" advertises that it "detects weak points and
 * suggests alternative arguments". Neither half is bound to a source, and
 * their pages carry no lawyer-review warning. This module deliberately does
 * something smaller and checkable: **every finding is either bound to a
 * source, or it is explicitly marked KAYNAKSIZ and written as an
 * OBSERVATION.** There is no third category, no score, no "strength", no
 * "chance of success". The fixed summary sentence
 * ({@link PETITION_ANALYSIS_SUMMARY_TR}) says exactly that, and it is printed
 * on every report.
 *
 * ---------------------------------------------------------------------------
 * WHY RULE-BASED. Claim extraction here is sentence splitting + heading
 * recognition + a cue table. Nothing more. That is the same discipline
 * `clauseReview.ts` follows for contracts, for the same reason: a claim list
 * a lawyer cannot re-derive by reading the document is worse than no claim
 * list, and a model that "summarises the claims" is a hallucination surface
 * pointed straight at the opposing party's own words.
 *
 * WHAT THE ENGINE DOES NOT DO, and may never be extended to do:
 *   - it does not rank claims, score them, or call one weak;
 *   - it does not say a petition is likely to win or lose;
 *   - it does not invent a künye (that rule lives in `citationAudit.ts` and
 *     this module reuses that engine unchanged rather than re-implementing
 *     it);
 *   - it does not turn a search snippet into evidence: an "aleyhe kaynak"
 *     row is a künye plus the query that produced it, and the report says so.
 *
 * THE THREE BUCKETS PER CLAIM.
 *
 *   ATIF DENETİMİ  — the claim's citations, audited by `auditCitations` with
 *                    the SAME injected resolver the Atıf Denetim Raporu uses,
 *                    so FOUND / NOT_FOUND / UNCERTAIN mean exactly what they
 *                    mean there. An unresolved citation is UNCERTAIN, never
 *                    NOT_FOUND: "we did not find it" is a statement about our
 *                    coverage.
 *   ALEYHE KAYNAK  — contrary-authority lanes built by the existing
 *                    `buildContraryLanes` (planner/contrary.ts). When no
 *                    search port is wired, the lanes are still SHOWN with the
 *                    state ÇALIŞTIRILMADI: the lawyer sees which query would
 *                    run, and is told plainly that it did not. A query that
 *                    was never run is never drawn as "aleyhe kaynak yok".
 *   KAYNAKSIZ      — a claim sentence that is bound to no citation. It is an
 *                    OBSERVATION, prefixed `⚠ KAYNAKSIZ`, and the observation
 *                    line may not carry an assessment word ("risk", "zayıf",
 *                    "hatalı" …) in any Turkish inflection — the same rule
 *                    `clauseReview.ts` enforces. The document's own sentence
 *                    is preserved VERBATIM in `alinti`; only ColleX's own
 *                    line is scrubbed, because a scrubbed line is ColleX
 *                    speaking and the quote is the other side speaking.
 * ---------------------------------------------------------------------------
 */

import { sanitizeMarkdown } from "../security/renderGuard.js";
import { canonicalQuoteText } from "../drafting/quoteIntegrity.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import { analyzeIntake } from "../planner/intake.js";
import {
  OPPOSITE_TERMS,
  buildContraryLanes,
  type ContraryFlavor,
  type ContraryLane,
  type ContraryLaneKind,
} from "../planner/contrary.js";
import {
  AS_OF_INVALID_TR,
  auditCitations,
  auditProse,
  citationKey,
  citationOccurrences,
  extractAuditCitations,
  isCalendarDate,
  pairArticlesWithTheirLaw,
  type AuditBucket,
  type CitationAuditReport,
  type CitationAuditRow,
  type CitationResolver,
} from "./citationAudit.js";
import { KAYNAKSIZ_PREFIX } from "./clauseReview.js";
import type { Draft } from "../drafting/types.js";

export const PETITION_ANALYSIS_SCHEMA = "collex.petition-analysis/v1";

/**
 * The report's fixed summary sentence. It is a CONSTANT, printed verbatim on
 * every report, and it states the two things the report refuses to do. Do not
 * soften it, do not make it conditional, and do not add a number to it.
 */
export const PETITION_ANALYSIS_SUMMARY_TR =
  "Bu rapor, dilekçedeki iddiaları ATIFLARINA ve aleyhe kaynaklara göre denetler." +
  " İddianın hukuki değerini ölçmez ve dilekçenin kazanma şansı hakkında hiçbir şey söylemez.";

// ---------------------------------------------------------------------------
// Claim kinds
// ---------------------------------------------------------------------------

export const CLAIM_KINDS = ["TALEP", "VAKIA", "HUKUKI_SEBEP", "DIGER"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_KIND_LABEL_TR: Readonly<Record<ClaimKind, string>> = Object.freeze({
  TALEP: "talep",
  VAKIA: "vakıa",
  HUKUKI_SEBEP: "hukuki sebep",
  DIGER: "diğer",
});

export const CLAIM_KIND_MEANING_TR: Readonly<Record<ClaimKind, string>> = Object.freeze({
  TALEP: "Mahkemeden ne istendiğini söyleyen cümle (sonuç ve istem).",
  VAKIA: "Olayın nasıl geçtiğini anlatan cümle. Vakıa cümlesinin atfı olmaması olağandır.",
  HUKUKI_SEBEP: "Bir mevzuat hükmüne ya da karara dayanan cümle.",
  DIGER: "Yukarıdaki üç başlıktan birine yerleştirilemeyen bölüm (deliller listesi gibi).",
});

// ---------------------------------------------------------------------------
// Contrary lane states
// ---------------------------------------------------------------------------

export const CONTRARY_LANE_STATES = [
  "BULUNDU",
  "ARANDI_BULUNAMADI",
  "CALISTIRILMADI",
  "ARAMA_BASARISIZ",
] as const;
export type ContraryLaneState = (typeof CONTRARY_LANE_STATES)[number];

export const CONTRARY_LANE_LABEL_TR: Readonly<Record<ContraryLaneState, string>> = Object.freeze({
  // W17/b — the label used to read "aleyhe kaynak bulundu" and the meaning
  // sentence said the query "iddianın AKSİ yönünde en az bir künye getirdi".
  // NOTHING measures that. The lane sends the claim's institution paired with
  // an outcome-flip phrase to an archive and counts the rows that come back;
  // whether a returned decision actually runs against the claim is a lawyer's
  // reading of the full text. Measured 06.09.2026 on a real eser sözleşmesi
  // petition: the badge said "aleyhe kaynak bulundu" over five Yargıtay 11. HD
  // (ticaret dairesi) decisions, and one of them was asserted as authority
  // against BOTH "eser sözleşmesi" and "manevi tazminat".
  //
  // Verifying the direction was considered and cannot be done here: a
  // `ContraryHit` carries only künye/date/link, and the Bedesten path publishes
  // no snippet at all, so a direction test would make this state unreachable —
  // which is its own dishonesty. So the state now says only what was measured,
  // in the same idiom the coverage manifest and the fee tariffs use for a cell
  // they could not fill.
  BULUNDU: "sorgu sonuç getirdi",
  ARANDI_BULUNAMADI: "arandı, bulunamadı",
  CALISTIRILMADI: "çalıştırılmadı",
  ARAMA_BASARISIZ: "arama tamamlanamadı",
});

export const CONTRARY_LANE_MEANING_TR: Readonly<Record<ContraryLaneState, string>> = Object.freeze({
  BULUNDU:
    "Bu sorgu çalıştı ve aşağıdaki künyeleri getirdi. Bu kararların iddianın" +
    " AKSİ yönünde olup olmadığı ÖLÇÜLMEDİ: sorgu, iddianın kavramını bir" +
    " sonuç ifadesiyle birlikte aratır, kararın ne dediğini okumaz. Künye bir" +
    " arama satırıdır, kanıt değildir — tam metni açıp kendiniz doğrulayın.",
  ARANDI_BULUNAMADI:
    "Bu sorgu çalıştı ve sonuç getirmedi. Bu, aksi yönde karar OLMADIĞI anlamına" +
    " gelmez; yalnız bu sorgunun bu kaynakta sonuç bulamadığını söyler.",
  CALISTIRILMADI:
    "Sorgu hazırlandı ancak çalıştırılmadı. Aleyhe kaynak konusunda bu satırdan" +
    " hiçbir sonuç çıkarılamaz.",
  ARAMA_BASARISIZ:
    "Arama tamamlanamadı (kaynağa erişilemedi). Bu bir sonuç değildir; sorguyu" +
    " yeniden çalıştırın.",
});

// ---------------------------------------------------------------------------
// The assessment vocabulary an unsourced line may not use
// ---------------------------------------------------------------------------

/**
 * Word STEMS an unsourced observation may not contain. Turkish attaches
 * suffixes, so the whole word (stem + suffix) is removed, exactly as
 * `clauseReview.stripRiskWords` does for "risk".
 *
 * These are ASSESSMENT words. An unsourced line that says a claim is "zayıf"
 * or "hatalı" is precisely the sentence this product exists not to write: it
 * is a legal opinion with nothing behind it.
 */
export const EVALUATIVE_WORD_STEMS: readonly string[] = Object.freeze([
  "risk",
  "riskli",
  "zayıf",
  "güçsüz",
  "hata",
  "hatalı",
  "yanlış",
  // W17/c — "kusur" / "kusurlu" are NOT here any more. MEASURED: "Davalı
  // kusurlu değildir" became "Davalı […] değildir" and "kusursuz sorumluluk"
  // became "[…] sorumluluk". Fault is an ELEMENT the petition pleads (TBK
  // m. 49, the ceza kast/taksir line), not ColleX grading the claim; erasing
  // it erased the claim.
  "sakat",
  "yetersiz",
  "isabetsiz",
  "isabetli",
  "haksız",
  "dayanaksız",
  "temelsiz",
  "geçersiz",
  "çelişki",
  "çelişkili",
  "tehlike",
  "tehlikeli",
  "başarısız",
  "sorunlu",
  "zafiyet",
]);

/** What replaces a removed assessment word on a KAYNAKSIZ line. */
export const EVALUATIVE_WORD_PLACEHOLDER = "[…]";

/**
 * Words that START like an assessment word and are not one (W17/c, a CLOSED
 * list). MEASURED: "Hatay" was stripped as "hata".
 */
const NOT_EVALUATIVE_TOKENS: ReadonlySet<string> = new Set(["hatay"]);

/**
 * Legal INSTITUTIONS that contain an assessment word (W17/c, a CLOSED list):
 * `word` is the assessment token's stem, `next` / `prev` the neighbouring
 * token's start. MEASURED: "haksız fiil" — the tort itself — was printed
 * "[…] fiil".
 */
const PROTECTED_PHRASES: readonly { word: string; next?: readonly string[]; prev?: readonly string[] }[] = [
  {
    word: "haksız",
    next: ["fiil", "rekabet", "fesih", "feshi", "tahrik", "zenginleş", "işgal", "azil", "azl", "el", "şart", "haciz", "hacz"],
  },
  { word: "geçersiz", next: ["fesih", "feshi"], prev: ["feshin"] },
  { word: "sakat", prev: ["irade"] },
  { word: "hata", next: ["düş"], prev: ["esaslı", "saikte", "beyanda", "hesap", "yazım", "maddi", "iletimde"] },
  { word: "tehlike", next: ["sorumlulu"], prev: ["somut", "soyut"] },
  { word: "tehlikeli", next: ["madde", "iş", "faaliyet", "işletme"] },
];

function protectedPhrase(stem: string, prev: string, next: string): boolean {
  for (const phrase of PROTECTED_PHRASES) {
    if (phrase.word !== stem) continue;
    if ((phrase.next ?? []).some((start) => next.startsWith(start))) return true;
    if ((phrase.prev ?? []).some((start) => prev === start || prev.startsWith(start))) return true;
  }
  return false;
}

/**
 * Remove every assessment word (with its Turkish suffix) from a line.
 *
 * Matching is token-by-token on the Turkish-lowercased form of each token, so
 * "İ"/"ı" behave correctly and no length assumption is made about the folded
 * copy. A token whose folded form STARTS WITH one of the stems is replaced
 * whole — that is the suffix rule — unless it is one of the closed-list
 * exceptions: a different word that shares the letters ("Hatay"), or a legal
 * institution that contains the word ("haksız fiil", "irade sakatlığı").
 */
export function stripEvaluativeWords(text: string): string {
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    token: match[0],
    index: match.index ?? 0,
    folded: match[0].toLocaleLowerCase("tr-TR"),
  }));
  let out = "";
  let cursor = 0;
  tokens.forEach(({ token, index, folded }, position) => {
    if (NOT_EVALUATIVE_TOKENS.has(folded)) return;
    // The LONGEST stem the token starts with decides ("tehlikeli" over "tehlike").
    let stem = "";
    for (const candidate of EVALUATIVE_WORD_STEMS) {
      if (folded.startsWith(candidate) && candidate.length > stem.length) stem = candidate;
    }
    if (stem === "") return;
    const prev = tokens[position - 1]?.folded ?? "";
    const next = tokens[position + 1]?.folded ?? "";
    if (protectedPhrase(stem, prev, next)) return;
    out += text.slice(cursor, index) + EVALUATIVE_WORD_PLACEHOLDER;
    cursor = index + token.length;
  });
  out += text.slice(cursor);
  return out.replace(/\s{2,}/gu, " ").trim();
}

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/**
 * Turkish legal abbreviations whose trailing dot does NOT end a sentence.
 * Kept lowercase (tr-TR folded) and deliberately short: an over-long list
 * starts swallowing real sentence ends.
 */
const SENTENCE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "m",
  "md",
  "mad",
  "e",
  "k",
  "s",
  "f",
  "b",
  "c",
  "t",
  "no",
  "nu",
  "bkz",
  "vb",
  "vs",
  "sn",
  "av",
  "dr",
  "prof",
  "doç",
  "yrd",
  "krş",
  "örn",
  "age",
  "agk",
  "hd",
  "cd",
  "hgk",
  "cgk",
  "rg",
  "tar",
  "bkn",
  // W17/c — MEASURED: an address inside a claim ("Bahçelievler Mah. 7. Cad.
  // No: 22/3") was cut into three "sentences", each printed ⚠ KAYNAKSIZ, and
  // "Y.9.HD." / "Dn. 10. D." split a decision's künye in two.
  "mah",
  "cad",
  "sok",
  "sk",
  "blv",
  "bulv",
  "apt",
  "vd",
  "san",
  "tic",
  "ltd",
  "şti",
  "d",
  "y",
  "dn",
]);

/** A character that may legitimately open a new sentence. */
const SENTENCE_START = /[A-ZÇĞİÖŞÜ0-9"'([]/u;

const TERMINATORS = new Set([".", "!", "?", "…"]);

/**
 * Split a claim into sentences. Deterministic and explainable: a terminator
 * ends a sentence only when it is followed by a space and a plausible opening
 * character, and only when the token before it is neither a known
 * abbreviation nor a bare number ("m. 344. maddesi" is one sentence).
 */
export function splitPetitionSentences(text: string): string[] {
  return petitionSentenceSpans(text).sentences.map((sentence) => sentence.text);
}

/** One sentence of a claim, with its `[start, end)` position in `flat`. */
export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * The sentences of a claim WITH their positions (W17/c), in the one string a
 * citation's position is also measured on: the render-guarded text, NFC, every
 * run of whitespace one space. A sentence is "bound" to a citation when the
 * two OVERLAP — never because the sentence happens to contain a spelling.
 */
export function petitionSentenceSpans(text: string): { flat: string; sentences: SentenceSpan[] } {
  const flat = auditProse(sanitizeMarkdown(text)).trim();
  if (flat === "") return { flat, sentences: [] };
  const sentences: SentenceSpan[] = [];
  const push = (from: number, to: number): void => {
    let s = from;
    let e = to;
    while (s < e && flat[s] === " ") s += 1;
    while (e > s && flat[e - 1] === " ") e -= 1;
    if (e > s) sentences.push({ text: flat.slice(s, e), start: s, end: e });
  };
  let start = 0;
  for (let i = 0; i < flat.length; i += 1) {
    const ch = flat[i] as string;
    if (!TERMINATORS.has(ch)) continue;
    let end = i;
    while (end + 1 < flat.length && TERMINATORS.has(flat[end + 1] as string)) end += 1;
    i = end;
    const gap = flat[end + 1];
    if (gap === undefined) {
      push(start, end + 1);
      start = end + 1;
      continue;
    }
    if (gap !== " ") continue;
    const after = flat[end + 2];
    if (after === undefined || !SENTENCE_START.test(after)) continue;
    const token = (flat.slice(start, i).match(/([\p{L}\p{N}]+)$/u)?.[1] ?? "").toLocaleLowerCase(
      "tr-TR",
    );
    if (ch === "." && SENTENCE_ABBREVIATIONS.has(token)) continue;
    if (ch === "." && /^\d+$/u.test(token)) continue;
    push(start, end + 1);
    start = end + 1;
  }
  push(start, flat.length);
  return { flat, sentences };
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

export interface PetitionClaim {
  /** Stable, positional id: "iddia-1". */
  claimId: string;
  index: number;
  kind: ClaimKind;
  kindLabel: string;
  /** The section heading this block fell under, verbatim; "" when none. */
  heading: string;
  /** Numbering as the document wrote it ("2", "2.1"); "" when unnumbered. */
  number: string;
  /** The claim text, verbatim (whitespace-normalised, nothing removed). */
  text: string;
}

/**
 * Section headings a Turkish petition actually uses, and what they mean.
 *
 * `weak` marks the GENERIC narrative section. "HUKUKÎ SEBEPLER" tells you what
 * every line under it is; "AÇIKLAMALAR" tells you nothing — it is where the
 * whole argument lives, fact paragraphs and legal paragraphs side by side.
 * Measured 06.09.2026: a real cevap dilekçesi put all seven of its numbered
 * paragraphs under AÇIKLAMALAR and the report labelled all seven "vakıa",
 * including the three that rest on TBK m. 474, TTK m. 23/1-c and HMK m. 119.
 * That label is not decoration — {@link CLAIM_KIND_HELP_TR} tells the lawyer a
 * vakıa sentence normally has no citation, so a mislabelled legal claim reads
 * as one that was never supposed to cite anything.
 */
/**
 * The form a heading or a preamble label is COMPARED in (W17/c): Turkish
 * lower case, hyphens/slashes as spaces, and every Turkish letter folded to
 * its ASCII base (ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u, â→a, î→i, û→u).
 *
 * MEASURED: a petition typed without Turkish characters writes "HUKUKI
 * SEBEPLER", "DELILLER", "VEKILI" — `normalizeTurkishSearch` turns the ASCII
 * capital I into a dotless ı ("hukukı"), so none of them was recognised and
 * each became a claim or vanished into the previous section. The lists below
 * are still CLOSED; folding only stops one spelling of a listed word from
 * being a different word.
 */
export function labelKey(value: string): string {
  return normalizeTurkishSearch(value)
    .replace(/[-/‐‑‒–—]+/gu, " ")
    .replace(/[ıîİ]/gu, "i")
    .replace(/ş/gu, "s")
    .replace(/ç/gu, "c")
    .replace(/ğ/gu, "g")
    .replace(/ö/gu, "o")
    .replace(/[üû]/gu, "u")
    .replace(/â/gu, "a")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Build a closed, folded lookup table. */
function foldedSet(entries: readonly string[]): ReadonlySet<string> {
  return new Set(entries.map(labelKey));
}

/**
 * The headings, as CLOSED lists per kind. W17/c extended every list with the
 * forms a realistic set of nine petitions actually used and the old table
 * missed ("SONUÇ VE TALEP", "HUKUKİ DEĞERLENDİRME", "HUKUKİ SEBEP",
 * "USULE İLİŞKİN İTİRAZLAR", "İSTİNAF NEDENLERİ", "EKLER" …): each miss sent
 * a whole section into the one above it, so a SONUÇ VE TALEP line was
 * filed — and searched — as a piece of the DELİLLER list.
 */
const HEADING_TALEP = foldedSet([
  "sonuç ve istem",
  "sonuç ve istemlerimiz",
  "sonuç ve istek",
  "sonuç ve talep",
  "sonuç ve talebimiz",
  "sonuç ve taleplerimiz",
  "netice-i talep",
  "neticei talep",
  "netice ve talep",
  "talep ve sonuç",
  "talep sonucu",
  "sonuç",
  "istem",
  "istemlerimiz",
  "talep",
  "talebimiz",
  "taleplerimiz",
]);

const HEADING_HUKUKI_SEBEP = foldedSet([
  "hukuki sebepler",
  "hukuki sebep",
  "hukuki nedenler",
  "hukuki neden",
  "yasal dayanak",
  "yasal dayanaklar",
  "yasal nedenler",
  "yasal sebepler",
  "kanuni dayanak",
  "kanuni dayanaklar",
  "hukuki dayanak",
  "hukuki dayanaklar",
  "hukuki değerlendirme",
  "hukuki değerlendirmeler",
  "hukuki değerlendirmelerimiz",
]);

/**
 * The GENERIC narrative sections: a cevap dilekçesi says AÇIKLAMALAR; a ceza
 * savunma says SAVUNMAMIZ, an istinaf İSTİNAF SEBEPLERİMİZ, a temyiz TEMYİZ
 * NEDENLERİMİZ (W17/b). Measured: without them a savunma dilekçesi had NO
 * heading at all and every ground fell through to the unclassified kind.
 */
const HEADING_WEAK_VAKIA = foldedSet([
  "açıklamalar",
  "açıklamalarımız",
  "açıklamalar ve hukuki değerlendirme",
  "açıklamalar ve hukuki nedenler",
  "olaylar",
  "olay",
  "olayın özeti",
  "olayların özeti",
  "olaylar ve açıklamalar",
  "olaylar ve hukuki nedenler",
  "olaylar ve hukuki sebepler",
  "vakıalar",
  "maddi olay",
  "maddi olaylar",
  "maddi vakıalar",
  "konu",
  "dava konusu",
  "davanın özeti",
  "cevaplarımız",
  "esasa ilişkin cevaplarımız",
  "esasa ilişkin itirazlarımız",
  "esasa ilişkin açıklamalarımız",
  "esasa ilişkin savunmalarımız",
  "esas yönünden",
  "esas yönünden cevaplarımız",
  "usule ilişkin itirazlar",
  "usule ilişkin itirazlarımız",
  "usule ilişkin cevaplarımız",
  "usule ilişkin açıklamalarımız",
  "usul yönünden",
  "usul yönünden itirazlarımız",
  "ön itirazlarımız",
  "ilk itirazlarımız",
  "itirazlarımız",
  "beyanlarımız",
  "savunmamız",
  "savunmalarımız",
  "savunma",
  "esas hakkındaki mütalaaya karşı savunmalarımız",
  "esas hakkında savunmalarımız",
  "mütalaaya karşı savunmalarımız",
  "itirazımız",
  "itiraz sebeplerimiz",
  "itiraz nedenlerimiz",
  "itiraz sebepleri",
  "itiraz nedenleri",
  "istinaf sebeplerimiz",
  "istinaf nedenlerimiz",
  "istinaf gerekçelerimiz",
  "istinaf sebepleri",
  "istinaf nedenleri",
  "istinaf gerekçeleri",
  "temyiz sebeplerimiz",
  "temyiz nedenlerimiz",
  "temyiz gerekçelerimiz",
  "temyiz sebepleri",
  "temyiz nedenleri",
  "temyiz gerekçeleri",
  "şikayet sebeplerimiz",
  "başvuru sebeplerimiz",
  "başvuru nedenlerimiz",
  "başvuru sebepleri",
  "başvuru nedenleri",
  "gerekçelerimiz",
  // An interim-measure section argues for the measure and then asks for it:
  // its paragraphs decide for themselves (the closing request sentence makes
  // the last one a talep).
  "yürütmeyi durdurma talebimiz",
  "yürütmenin durdurulması talebimiz",
  "ihtiyati tedbir talebimiz",
  "ihtiyati haciz talebimiz",
]);

/** DELİLLER / EKLER — a LIST of documents, never an assertion. */
const HEADING_LIST = foldedSet([
  "deliller",
  "delillerimiz",
  "hukuki deliller",
  "delil listesi",
  "deliller ve hukuki deliller",
  "ek",
  "ekler",
  "ek listesi",
  "ekleri",
  "ekler listesi",
  "belgeler",
  "ekler ve deliller",
]);

const HEADING_RULES: readonly { labels: ReadonlySet<string>; kind: ClaimKind; weak?: boolean }[] =
  Object.freeze([
    { labels: HEADING_TALEP, kind: "TALEP" },
    { labels: HEADING_HUKUKI_SEBEP, kind: "HUKUKI_SEBEP" },
    { labels: HEADING_WEAK_VAKIA, kind: "VAKIA", weak: true },
    { labels: HEADING_LIST, kind: "DIGER" },
  ]);

/**
 * Preamble lines a Turkish petition opens with. They are addressing and
 * identity lines, not assertions, so they are NOT claims: making "DAVA
 * DİLEKÇESİ" or "DAVACI : …" an iddia and then marking it KAYNAKSIZ would
 * bury the real claims under noise the lawyer has to skip past.
 *
 * Deliberately a CLOSED list of forms, never a shape heuristic: an all-caps
 * short line is also how a lawyer emphasises a real assertion.
 */
const PREAMBLE_TITLES: ReadonlySet<string> = foldedSet([
  "dava dilekçesi",
  "cevap dilekçesi",
  "cevaba cevap dilekçesi",
  "ikinci cevap dilekçesi",
  "replik dilekçesi",
  "düplik dilekçesi",
  "beyan dilekçesi",
  "istinaf dilekçesi",
  "istinaf başvuru dilekçesi",
  "temyiz dilekçesi",
  "itiraz dilekçesi",
  "şikayet dilekçesi",
  "ihtarname",
  // W17/c — MEASURED title and routing lines that became claims: an idari
  // dava opened with "YÜRÜTMENİN DURDURULMASI TALEPLİDİR" as iddia-1, and an
  // istinaf's "Gönderilmek Üzere" routing line was searched for contrary
  // authority. Still a CLOSED list.
  "yürütmenin durdurulması taleplidir",
  "yürütmeyi durdurma taleplidir",
  "yürütmenin durdurulması talepli",
  "duruşma taleplidir",
  "duruşmalı",
  "ihtiyati tedbir taleplidir",
  "ihtiyati haciz taleplidir",
  "tedbir taleplidir",
  "gönderilmek üzere",
  "t.c.",
  "t.c",
  "acele",
  "ivedi",
]);

/** Label of an identity line ("DAVACI : …"). */
const PREAMBLE_LABELS: ReadonlySet<string> = foldedSet([
  "davacı",
  "davalı",
  "davacılar",
  "davalılar",
  "vekili",
  "vekilleri",
  "müvekkil",
  "müvekkilim",
  "karşı taraf",
  "karşı taraf vekili",
  "borçlu",
  "alacaklı",
  "sanık",
  "müşteki",
  "katılan",
  "şüpheli",
  "adres",
  "adresi",
  "tc kimlik no",
  "t.c. kimlik no",
  "t.c kimlik no",
  "kimlik no",
  "tckn",
  "esas no",
  "dosya no",
  "tarih",
  "konu",
  "dava konusu",
  "dava değeri",
  "harca esas değer",
  // W17/c — "EKLER" / "EK" are NOT labels any more: they are a document-list
  // HEADING. MEASURED: as a label, "EKLER : 1- Vekâletname" was dropped and
  // the next line "2- Kira sözleşmesi" became a claim filed under the
  // previous heading — on a cevap dilekçesi, as a TALEP.
  //
  // W17/b — MEASURED on real petition shapes other than a cevap dilekçesi.
  // A compound role label is how an istinaf, a ceza savunma and an icra
  // itirazı name their parties, and each of these became a claim of its own:
  // "MÜDAFİ : Av. Ahmet Yılmaz" listed the defence lawyer's own name among
  // the claims to be checked — the very defect the signature rule fixed for
  // "Davalı Vekili / Av. Selin Aydın". Still a CLOSED list of labels.
  "davalı vekili",
  "davacı vekili",
  "davalılar vekili",
  "davacılar vekili",
  "müdafi",
  "müdafii",
  "sanık müdafii",
  "sanık müdafi",
  "şüpheli müdafii",
  "katılan vekili",
  "müşteki vekili",
  "mağdur",
  "mağdur vekili",
  "başvurucu",
  "başvuran",
  "başvurucu vekili",
  "itiraz eden",
  "itiraz eden vekili",
  "istinaf eden",
  "istinaf eden vekili",
  "temyiz eden",
  "temyiz eden vekili",
  "borçlu vekili",
  "alacaklı vekili",
  "tebliğ tarihi",
  "tebellüğ tarihi",
  "icra dosya no",
  "takip dosya no",
  "merci",
  "talep eden",
  "talep eden vekili",
  // W17/c — MEASURED on nine realistic petitions: each of these labels
  // became a claim of its own (and was then marked KAYNAKSIZ).
  "arabuluculuk",
  "arabuluculuk dosya no",
  "arabuluculuk bürosu dosya no",
  "suç",
  "suç tarihi",
  "suç yeri",
  "hüküm tarihi",
  "hüküm",
  "karar tarihi",
  "karar no",
  "istinaf edilen karar",
  "temyiz edilen karar",
  "itiraz edilen karar",
  "cevap veren",
  "cevap veren davalı",
  "cevap veren davacı",
  "davanın özeti",
  "istemin özeti",
  "talebin özeti",
  "karşı davacı",
  "karşı davalı",
  "davalı-karşı davacı",
  "davacı-karşı davalı",
  "müşteki-katılan",
  "katılan-müşteki",
  "şikayetçi",
  "şikayet eden",
  "davalı idare",
  "vergi no",
  "vergi kimlik no",
  "vkn",
  "mersis no",
  "uyap dosya no",
  "dava tarihi",
  "harç",
  "harç tutarı",
]);

/**
 * The closing signature block — "Davalı Vekili" / "Av. Selin Aydın".
 *
 * MEASURED, 06.09.2026: those two lines became "iddia-12" of a twelve-claim
 * report, so a lawyer's own name was listed as one of the other side's claims
 * and searched for contrary authority. Like {@link PREAMBLE_TITLES} this is a
 * CLOSED list of forms, not a shape heuristic: a role line spelled exactly as
 * a role, a courtesy closing, an e-signature marker, or a line that is
 * NOTHING but the "Av." title and a name. A petition sentence is never only
 * "Av. Selin Aydın".
 *
 * W17/c — MEASURED: "(e-imzalıdır)", "e-imza" and "Saygılarımızla," (with
 * its trailing comma) each became a claim. Matched on the folded line with
 * surrounding brackets and trailing punctuation removed.
 */
const SIGNATURE_LINE =
  /^(?:(?:(?:davaci|davali|musteki|katilan|borclu|alacakli|sanik|supheli|itiraz eden|basvurucu)?\s*(?:vekili|vekilleri|mudafii|mudafi))(?:\s+av\.?\s+\S[^,:;]{0,48})?|saygilarimla|saygilarimizla|saygiyla|imza|e imza|e imzali|e imzalidir|imzalidir|av\.?\s+\S[^,:;]{0,48})$/u;

/**
 * A line that is NOTHING but a date ("20.02.2025", "Tarih 20.02.2025") — the
 * petition's own date under its closing, never an assertion. W17/c, measured:
 * it became a claim of its own and was marked KAYNAKSIZ.
 */
const DATE_ONLY_LINE = /^(?:tarih\s*)?[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}$/u;

/**
 * "… MAHKEMESİNE", "… HÂKİMLİĞİNE" — the court the petition is addressed to.
 *
 * W17/b — MEASURED. `isPreambleLine` replaces the apostrophe with a SPACE
 * before testing, so "İZMİR 5. İCRA MÜDÜRLÜĞÜ'NE" arrives as
 * "izmir 5 icra mudurlugu ne" — and only two of the offices had their
 * apostrophe-split spelling listed. Every office carries both spellings; the
 * list is folded (W17/c) so an ASCII-typed "MAHKEMESINE" is the same word.
 */
const COURT_ADDRESS_TAILS: readonly string[] = [
  "mahkemesine",
  "mahkemesi ne",
  "hakimliğine",
  "hakimliği ne",
  "başkanlığına",
  "başkanlığı na",
  "müdürlüğüne",
  "müdürlüğü ne",
  "dairesine",
  "dairesi ne",
  "savcılığına",
  "savcılığı na",
  "başsavcılığına",
  "başsavcılığı na",
  "kuruluna",
  "kurulu na",
  "başkanlığa",
  "kurumuna",
  "kurumu na",
];
const COURT_ADDRESS_TAIL = new RegExp(
  `(?:${[...new Set(COURT_ADDRESS_TAILS.map(labelKey))].join("|")})$`,
  "u",
);

/**
 * The same offices in the NOMINATIVE ("İSTANBUL BÖLGE ADLİYE MAHKEMESİ"),
 * which a petition writes as the first line of a two-line addressee block
 * ("… MAHKEMESİ / İLGİLİ CEZA DAİRESİ BAŞKANLIĞI'NA"). W17/c — MEASURED: that
 * line became iddia-1 of an istinaf report, marked KAYNAKSIZ and searched for
 * contrary authority. A nominative office name is only preamble ABOVE the
 * first heading and the first claim — below them it can be the tail of an
 * assertion — and only when the line does not end a sentence.
 */
const COURT_HEADER_TAIL = new RegExp(
  `(?:${[
    "mahkemesi",
    "mahkemeleri",
    "başkanlığı",
    "hakimliği",
    "savcılığı",
    "başsavcılığı",
    "müdürlüğü",
    "dairesi",
    "kurulu",
    "kurumu",
    "bakanlığı",
  ]
    .map(labelKey)
    .join("|")})$`,
  "u",
);

function isCourtHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || /[.!?;,…]$/u.test(trimmed)) return false;
  const bare = labelKey(trimmed.replace(/[:\s]+$/u, "").replace(/['’]/gu, " "));
  return bare !== "" && bare.length <= 90 && COURT_HEADER_TAIL.test(bare);
}

/** Is `written` (the text before a colon) one of the preamble labels? */
function isPreambleLabel(written: string): boolean {
  const trimmed = written.replace(/[.\s]+$/u, "");
  if (PREAMBLE_LABELS.has(labelKey(trimmed))) return true;
  // "İSTİNAF EDEN (DAVALI) : …" — a parenthetical restatement of the role is
  // how an istinaf dilekçesi writes it, and it is still the same label.
  return PREAMBLE_LABELS.has(labelKey(trimmed.replace(/\([^)]*\)/gu, " ")));
}

/**
 * Is this line part of the petition's preamble (title, addressee, identity
 * block) rather than an assertion?
 */
export function isPreambleLine(line: string): boolean {
  // MEASURED, 06.09.2026 — a real cevap dilekçesi writes the subject field and
  // its content on ONE line: "KONU : Davacının 12.02.2026 tarihli dava
  // dilekçesine karşı cevaplarımızın sunulmasından ibarettir." (97 characters).
  // The 90-character guard below used to run FIRST, so that line never reached
  // the label test and became "iddia-1" — the report opened with a structural
  // field dressed as the other side's first assertion, and then found an
  // unsourced statement in it. The guard bounds the TITLE and COURT-ADDRESS
  // tests, which read the whole line as a shape; the label test reads only the
  // ≤30-character prefix before the colon, so length past the colon is none of
  // its business. Checking the label first is what fixes it.
  const labelled = line.match(/^\s*([^:]{1,40}):/u);
  if (labelled !== null && isPreambleLabel(labelled[1] as string)) return true;
  const signature = labelKey(
    line
      .trim()
      .replace(/^[([{]+|[)\]}]+$/gu, "")
      .replace(/[,;:!.…]+$/u, "")
      .trim(),
  );
  if (SIGNATURE_LINE.test(signature)) return true;
  if (DATE_ONLY_LINE.test(signature)) return true;
  const bare = labelKey(line.replace(/[:.\s]+$/u, "").replace(/['’]/gu, " "));
  if (bare === "" || bare.length > 90) return false;
  if (PREAMBLE_TITLES.has(bare) || PREAMBLE_TITLES.has(labelKey(line.trim()))) return true;
  if (COURT_ADDRESS_TAIL.test(bare)) return true;
  return false;
}

/**
 * Is this line a PREAMBLE LABEL whose content may continue on the lines
 * below it (an address under "DAVACI : …")?
 */
function isPreambleLabelLine(line: string): boolean {
  const labelled = line.match(/^\s*([^:]{1,40}):/u);
  return labelled !== null && isPreambleLabel(labelled[1] as string);
}

/**
 * A continuation of a preamble field: the address a petition writes on the
 * INDENTED line(s) under "DAVACI : Mehmet KARACA". W17/c — MEASURED: every
 * such address line ("Atatürk Mah. Gül Sok. No: 5/3 Ümraniye/İSTANBUL")
 * became a claim and was marked KAYNAKSIZ. Only an INDENTED line directly
 * under a label (no blank line between) continues it; an unindented line is
 * the document speaking again.
 */
function isIndented(line: string): boolean {
  return /^(?:\t|\s{2,})\S/u.test(line);
}

/**
 * A paragraph is a TALEP only when the petition ITSELF asks for something in
 * its closing words (W17/c).
 *
 * MEASURED: one request cue ANYWHERE in a paragraph used to make the whole
 * paragraph a talep. A ceza savunma ground reading "Cumhuriyet savcısı …
 * cezalandırılmasına karar verilmesini istemiştir. Oysa olay günü sanık …
 * işyerinden hiç ayrılmamıştır." — a REPORTED request of the other side,
 * followed by the defence's own factual assertion — became "talep", which
 * switched off both the unsourced scan and the contrary search on the very
 * ground the lawyer has to answer. The rule now reads the paragraph's FINAL
 * sentence, whose main verb (Turkish is verb-final) must be a first-person
 * request formula; a reported request ("istemiştir", "talep etmektedir") is
 * never one.
 */
const REQUEST_FORMULA_END =
  /(?:(?:talep|arz|rica)\s+(?:ederiz|ederim|ediyoruz|ediyorum|olunur)|istemekteyiz|istemekteyim|isteriz|isterim|istiyoruz|istiyorum)[\s.!…)"'”’]*$/u;

function endsWithOwnRequest(text: string): boolean {
  const sentences = splitPetitionSentences(text).filter((sentence) => /\p{L}/u.test(sentence));
  const last = sentences[sentences.length - 1];
  if (last === undefined) return false;
  return REQUEST_FORMULA_END.test(normalizeTurkishSearch(last));
}

const HUKUKI_SEBEP_CUES: readonly string[] = Object.freeze([
  "uyarınca",
  "gereğince",
  "hükmü",
  "hükümleri",
  "maddesi",
  "sayılı kanun",
  "içtihat",
  "emsal karar",
]);

const VAKIA_CUES: readonly string[] = Object.freeze([
  "tarihinde",
  "müvekkil",
  "davalı",
  "davacı",
  "taraflar arasında",
]);

/**
 * Leading numbering of a block ("2.", "2.1)", "MADDE 3 -", "1-)", "(1)").
 *
 * W17/b — MEASURED. The old pattern required whitespace directly after ONE
 * separator, so **"1-)" — the form most Turkish lawyers actually type** — was
 * not a marker at all: an icra-itiraz dilekçesi whose three grounds were
 * numbered "1-)", "2-)", "3-)" collapsed into a SINGLE claim containing all
 * three, and on a full itiraz shape the whole body (grounds, statute list and
 * istem together) came back as one claim labelled "talep". "(1)" failed on
 * its leading parenthesis for the same reason.
 *
 * The two forms are ALTERNATIVES, never one permissive pattern: a bare number
 * followed by one or two separators, or a parenthesised number. Making the
 * separator optional was tried and reverted the same hour — it read
 * "14.03.2024 tarihli sözleşme" as claim number "14.03.2024", because a date
 * is a number followed by whitespace.
 *
 * W17/c — a THIRD alternative, again with its separator REQUIRED: a lettered
 * ground "a)" / "(a)". MEASURED: an itirazın iptali petition's "a) … b) …
 * c) …" grounds under HUKUKİ DEĞERLENDİRME collapsed into one claim. A bare
 * "a." is not accepted — it is how an initial is written ("A. Yılmaz").
 * Every alternative is further gated by {@link LINE_ENDS_BLOCK}.
 */
const CLAIM_MARKER =
  /^\s*(?:(?:MADDE|Madde|Md\.?)\s*)?(?:\((\d+(?:[.\-]\d+)*)\)|(\d+(?:[.\-]\d+)*)[.)\-–—:]{1,2}|\(?([A-Za-zÇĞİÖŞÜçğıöşü])\))\s+(?=\S)/u;

/**
 * May a claim marker START a new claim after this line? (W17/c)
 *
 * MEASURED: a petition's hard line wraps made numbers at the start of a line
 * look like claim numbers — "Nitekim Yargıtay\n3. Hukuk Dairesi'nin …" and
 * "6098 sayılı Kanun'un\n344. maddesi" became claims "3" and "344", cutting a
 * ground in two and orphaning its citation. A marker now opens a claim only
 * where a claim can begin: at the start, after a blank line, a heading or a
 * preamble line, or after a line that ENDS a sentence or an enumeration item
 * (".", ":", ";", "!", "?", ")", ","). Under a document-list heading (DELİLLER,
 * EKLER) every marker opens an item: a list line has no sentence to end.
 */
const LINE_ENDS_BLOCK = /[.:;!?),…]["'”’)\]]*\s*$/u;

/**
 * What a heading may carry in front of its own words: digits, Roman numerals
 * or a single letter, with their punctuation.
 *
 * W17/b — MEASURED: "I. AÇIKLAMALAR" and "II. HUKUKÎ SEBEPLER : TBK m. 474"
 * were not recognised as headings, because the strip understood only Arabic
 * digits. Turkish petitions number their sections in Roman numerals as often
 * as not. Anchored and bounded so it cannot eat a real first word: at most
 * four Roman characters or one letter, and only when punctuation follows.
 */
const HEADING_LEAD = /^[\s\d.)\-–—]*(?:(?:[IVXLivxl]{1,4}|[A-Za-zÇĞİÖŞÜçğıöşü])[.)\-–—]\s*)?/u;

/** How many claims one report may carry. Beyond this the report says so. */
export const MAX_CLAIMS = 300;

function foldTr(value: string): string {
  return canonicalQuoteText(value).toLocaleLowerCase("tr-TR");
}

/** What a recognised heading says about the lines under it. */
interface HeadingSense {
  kind: ClaimKind;
  /** True for the generic narrative section, whose lines decide for themselves. */
  weak: boolean;
}

function headingSenseOfLabel(written: string): HeadingSense | undefined {
  const bare = labelKey(written);
  if (bare === "" || bare.length > 60) return undefined;
  for (const rule of HEADING_RULES) {
    if (rule.labels.has(bare)) return { kind: rule.kind, weak: rule.weak === true };
  }
  return undefined;
}

/**
 * Is this block a LIST of documents (DELİLLER, EKLER) rather than an assertion?
 *
 * W17/b — MEASURED DEFECT OF THE W17 FIX ITSELF. The list test was
 * `claim.kind === "DIGER"`, but `DIGER` is also `inferKind`'s catch-all for
 * "could not be classified". Run against an ordinary ceza savunma dilekçesi,
 * four of five claims came back DIGER — including the two real defence grounds
 * "Sanığın eylemi suç oluşturmamaktadır" and "Şikayet süresi geçmiştir" — and
 * each was printed with "Bu blok bir iddia değil, bir liste (deliller/ekler)
 * olduğu için…", searched for nothing and excluded from the unsourced pass.
 * A savunma dilekçesi produced a report that found nothing and called the
 * defence grounds an evidence list.
 *
 * So the question is asked of the HEADING, which is the only thing that
 * actually says "what follows is a list", and never of the fallback kind.
 */
export function isDocumentListHeading(heading: string): boolean {
  const bare = labelKey(heading.replace(HEADING_LEAD, "").replace(/[:.\s]+$/u, ""));
  if (bare === "") return false;
  return HEADING_LIST.has(bare);
}

/** Is this line a section heading on a line of its own, and if so which kind? */
function headingKindOf(line: string): HeadingSense | undefined {
  return headingSenseOfLabel(line.replace(HEADING_LEAD, "").replace(/[:.\s]+$/u, ""));
}

/**
 * A heading written on the SAME line as its content — "HUKUKÎ SEBEPLER : TBK
 * m. 474, TBK m. 475, …".
 *
 * MEASURED, 06.09.2026: this is how a real petition writes its closing
 * sections, and {@link headingKindOf} could not see them — it folds the whole
 * line and gives up past 60 characters. So HUKUKÎ SEBEPLER, DELİLLER and
 * SONUÇ VE İSTEM all arrived as ordinary paragraphs still filed under
 * "AÇIKLAMALAR", the heading the document had left three sections earlier.
 *
 * The content is KEPT as a claim under the right heading rather than dropped:
 * the HUKUKÎ SEBEPLER line is where a Turkish petition lists its statutes, and
 * a report that threw it away would leave those citations attached to nothing.
 */
function inlineHeadingOf(
  line: string,
): { heading: string; sense: HeadingSense; rest: string } | undefined {
  const split = line.match(/^\s*([^:]{1,40}?)\s*:\s*(\S.*)$/u);
  if (split === null) return undefined;
  const label = (split[1] as string).replace(HEADING_LEAD, "");
  const sense = headingSenseOfLabel(label.replace(/[.\s]+$/u, ""));
  if (sense === undefined) return undefined;
  return { heading: label.trim(), sense, rest: (split[2] as string).trim() };
}

/**
 * Does this text cite an actual statute, article or decision?
 *
 * This is the one signal that separates a legal claim from a narrative one
 * without guessing at words: {@link HUKUKI_SEBEP_CUES} fires on "sözleşme
 * uyarınca", which is a contract, not a legal ground. A parsed reference is a
 * fact about the sentence.
 */
function citesAuthority(text: string): boolean {
  // W17/b — a bare article with no statute is NOT an authority. Measured
  // 06.09.2026 on an icra-itiraz text: "taraflar arasındaki sözleşmenin
  // 5. maddesi uyarınca" parses as an `article` with no `legislationNo`, and
  // it promoted the paragraph to "hukuki sebep". It is a clause of the
  // parties' OWN contract; there is no mevzuat behind it to look up. Pairing
  // runs first so "TBK m. 475" still counts — the article gets its statute
  // from the abbreviation before this test sees it. W17/c: the pairing is the
  // BOUNDED one the audit uses, so "sözleşmenin 5. maddesi" can no longer
  // borrow a statute named in an earlier sentence.
  const prose = auditProse(text);
  return pairArticlesWithTheirLaw(parseReferences(prose), prose).some(
    (reference) =>
      reference.kind === "court_decision" ||
      reference.kind === "official_gazette" ||
      reference.legislationNo !== undefined,
  );
}

function inferKind(text: string, heading: HeadingSense | undefined): ClaimKind {
  // W17/c — a request is the petition's OWN closing words, never a request
  // it merely reports (see {@link endsWithOwnRequest}).
  if (endsWithOwnRequest(text)) return "TALEP";
  if (heading !== undefined && !heading.weak) return heading.kind;
  // Under a generic heading the paragraph decides for itself, and a real
  // citation outranks every cue word.
  if (citesAuthority(text)) return "HUKUKI_SEBEP";
  if (heading !== undefined) return heading.kind;
  const folded = normalizeTurkishSearch(text);
  if (HUKUKI_SEBEP_CUES.some((cue) => folded.includes(cue))) return "HUKUKI_SEBEP";
  if (VAKIA_CUES.some((cue) => folded.includes(cue))) return "VAKIA";
  return "DIGER";
}

/** The claim number a marker carries ("3", "2.1", "a"), or undefined. */
function markerNumber(line: string): string | undefined {
  const marked = line.match(CLAIM_MARKER);
  if (marked === null) return undefined;
  // Group 1 is the parenthesised form "(3)", group 2 the bare "3." form,
  // group 3 the lettered "a)" / "(a)" form.
  return (marked[1] ?? marked[2] ?? marked[3] ?? "") as string;
}

/**
 * Split a petition into claims. A claim is a numbered item, or a
 * blank-line-separated paragraph, under the last section heading seen.
 * Headings themselves never become claims — they are the label, not the
 * assertion.
 *
 * Deterministic: same text in, same list out, no clock, no I/O, no model.
 */
export function extractClaims(text: string): PetitionClaim[] {
  const lines = sanitizeMarkdown(text).split("\n");
  const blocks: {
    heading: string;
    headingSense: HeadingSense | undefined;
    number: string;
    parts: string[];
  }[] = [];
  let heading = "";
  let headingSense: HeadingSense | undefined;
  let current: { number: string; parts: string[] } | undefined;
  /** May a marker on the next line open a new claim? */
  let atBoundary = true;
  /** Is the previous line a preamble label whose content may continue below? */
  let inPreambleField = false;
  /** Has the document passed its preamble (a heading or a claim was seen)? */
  let pastPreamble = false;

  const flush = (): void => {
    if (current === undefined) return;
    const body = current.parts.join(" ").replace(/\s+/gu, " ").trim();
    if (body !== "") {
      blocks.push({ heading, headingSense, number: current.number, parts: [body] });
    }
    current = undefined;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      atBoundary = true;
      inPreambleField = false;
      continue;
    }
    const asHeading = headingKindOf(line);
    if (asHeading !== undefined) {
      flush();
      heading = line.trim().replace(/\s+/gu, " ");
      headingSense = asHeading;
      atBoundary = true;
      inPreambleField = false;
      pastPreamble = true;
      continue;
    }
    if (!pastPreamble && current === undefined && isCourtHeaderLine(line)) {
      atBoundary = true;
      inPreambleField = false;
      continue;
    }
    const number = markerNumber(line);
    // W17/c — the address a petition writes on the indented line(s) under a
    // party label is part of that label's field, not an assertion.
    if (inPreambleField && isIndented(line) && number === undefined) {
      atBoundary = true;
      continue;
    }
    // A preamble line ends the previous block and contributes nothing: it is
    // addressing, not assertion. It never changes the current heading. This
    // runs BEFORE the inline-heading test on purpose: "KONU" is both a
    // preamble label and a narrative heading, and as a labelled field
    // ("KONU : …") it is the preamble one.
    if (isPreambleLine(line)) {
      flush();
      atBoundary = true;
      inPreambleField = isPreambleLabelLine(line);
      continue;
    }
    inPreambleField = false;
    const inline = inlineHeadingOf(line);
    if (inline !== undefined) {
      flush();
      heading = inline.heading;
      headingSense = inline.sense;
      current = { number: markerNumber(inline.rest) ?? "", parts: [inline.rest] };
      atBoundary = LINE_ENDS_BLOCK.test(line);
      pastPreamble = true;
      continue;
    }
    const listSection = isDocumentListHeading(heading);
    if (number !== undefined && (atBoundary || listSection)) {
      flush();
      current = { number, parts: [line.trim()] };
      atBoundary = LINE_ENDS_BLOCK.test(line);
      pastPreamble = true;
      continue;
    }
    if (current === undefined) current = { number: "", parts: [] };
    current.parts.push(line.trim());
    atBoundary = LINE_ENDS_BLOCK.test(line);
    pastPreamble = true;
  }
  flush();

  return blocks.slice(0, MAX_CLAIMS).map((block, index) => {
    const body = block.parts[0] as string;
    const kind = inferKind(body, block.headingSense);
    return {
      claimId: `iddia-${index + 1}`,
      index,
      kind,
      kindLabel: CLAIM_KIND_LABEL_TR[kind],
      heading: block.heading,
      number: block.number,
      text: body,
    };
  });
}

// ---------------------------------------------------------------------------
// The contrary-authority bucket
// ---------------------------------------------------------------------------

/** One row an injected contrary search may return. A künye, never a quote. */
export interface ContraryHit {
  kunye: string;
  note?: string;
  href?: string;
}

/**
 * What a contrary search may report besides its rows (W17/c, additive): the
 * sources it asked that did NOT answer. A port that returns a bare array is
 * read as "every source answered".
 */
export interface ContrarySearchResult {
  hits: ContraryHit[];
  /** Human names of the sources that failed ("Yargıtay"), in Turkish. */
  failedSources: string[];
}

/**
 * Port for running one contrary lane. INJECTED, and optional: with nothing
 * wired the lanes are still built and shown, in state ÇALIŞTIRILMADI. A
 * throw becomes ARAMA_BASARISIZ, never "aleyhe kaynak yok".
 *
 * W17/c — a port may also resolve with {@link ContrarySearchResult}. MEASURED:
 * with the Yargıtay archive down and Danıştay answering empty, a TCK claim's
 * lane was drawn "arandı, bulunamadı" — the one archive that could have held
 * the answer never answered, and the report said the search had run. When
 * ANY source failed and no row came back, the lane is ARAMA_BASARISIZ and
 * names the failed sources; when rows came back from the others, the lane
 * keeps them and still names what it could not reach.
 */
export type ContrarySearchPort = (
  lane: ContraryLane,
  asOf: string,
) => Promise<ContraryHit[] | ContrarySearchResult>;

function asContraryResult(value: ContraryHit[] | ContrarySearchResult): ContrarySearchResult {
  return Array.isArray(value)
    ? { hits: value, failedSources: [] }
    : { hits: value.hits ?? [], failedSources: [...(value.failedSources ?? [])] };
}

/** Why a lane is ARAMA_BASARISIZ although some sources answered. */
export function contraryPartialFailureTR(failed: readonly string[]): string {
  return (
    `Arama tamamlanamadı: şu kaynaklara erişilemedi — ${failed.join(", ")}.` +
    " Erişilebilen kaynaklar sonuç getirmedi; erişilemeyen kaynaklarda aleyhe" +
    " karar olup olmadığı bilinmiyor. Bu bir sonuç değildir; sorguyu yeniden" +
    " çalıştırın."
  );
}

/** What a lane that DID bring rows back says about the sources it missed. */
export function contraryMissingSourcesTR(failed: readonly string[]): string {
  return (
    `Şu kaynaklara erişilemedi: ${failed.join(", ")}. Bu kaynaklardaki kararlar` +
    " aşağıdaki listede yer almıyor."
  );
}

/**
 * Why a TALEP block gets no contrary search (W17/c).
 *
 * MEASURED: every talep card carried {@link NO_CONTRARY_BASE_TERM_TR}, which
 * says no legal concept could be recognised — on a SONUÇ VE İSTEM that names
 * "kıdem tazminatı" and "ihbar tazminatı" in so many words. The search is not
 * run because a request asserts no fact or legal view to find authority
 * against; that is a design decision and the card says so.
 */
export const CONTRARY_NOT_FOR_REQUEST_TR =
  "Bu blok mahkemeden istenen sonucu (talebi) yazar; bir olgu ya da hukuki" +
  " görüş ileri sürmediği için aleyhe kaynak araması tasarım gereği yapılmaz." +
  " Talebin dayandığı iddialar kendi kartlarında ele alınır.";

export interface ContraryLaneResult {
  kind: ContraryLaneKind;
  /** The exact query that was (or would be) run. Shown to the lawyer. */
  query: string;
  flipPhrase: string;
  state: ContraryLaneState;
  stateLabel: string;
  hits: { kunye: string; note: string; href: string }[];
  /** Why the lane is in this state, in Turkish. Empty when self-evident. */
  reason: string;
}

export interface ClaimContrary {
  /** The concept or provision the lanes were built around; "" when none. */
  baseTerm: string;
  flavor: ContraryFlavor;
  lanes: ContraryLaneResult[];
  /**
   * Contrary authorities the CITATION RESOLVER attached to this claim's own
   * citations. These are source-bound, unlike a search row.
   */
  sourceBound: { kunye: string; note: string }[];
  /** Present when no lane could be built at all. */
  note: string;
}

/**
 * W17/b — this sentence used to end "…tanınan bir hukuki kavram ya da mevzuat
 * atfı bulunamadı", and the report DISPROVED it on the same card. Measured
 * 06.09.2026: it stood on iddia-2 (which cites TBK m. 474 and TTK m. 23/1-c),
 * on iddia-7 (HMK m. 119) and on the HUKUKÎ SEBEPLER block (four statutes),
 * each with its Atıf denetimi bucket listing those very citations two lines
 * above. The statute fallback was deliberately removed in W17 — a query built
 * from a law NUMBER matched five unrelated decisions — so a statute citation
 * can no longer produce a base term, and the sentence must stop blaming its
 * absence. It now says the one true thing: no recognised INSTITUTION, and a
 * bare statute reference is not searched as a contrary query.
 */
export const NO_CONTRARY_BASE_TERM_TR =
  "Bu iddia için aleyhe kaynak sorgusu kurulamadı: iddiada, arama yapılabilecek" +
  " bir hukuki kavram tanınamadı (“kira”, “eser sözleşmesi”, “manevi tazminat”" +
  " gibi). Bir madde numarası tek başına aleyhe sorgu olarak aranmaz —" +
  " kararlar o biçimde yazılmaz. Aleyhe kaynak konusunda bu iddia için hiçbir" +
  " sonuç çıkarılamaz.";

/**
 * Why a DELİLLER block gets no contrary search (W17).
 *
 * MEASURED, 06.09.2026: the real petition's evidence list — "14.03.2024
 * tarihli eser sözleşmesi, 20.09.2024 tarihli teslim tutanağı, bilirkişi
 * incelemesi, tanık beyanları" — fired the "eser sözleşmesi" concept and got
 * a full set of contrary lanes. There is nothing there to contradict: a list
 * of documents is not an assertion, and the rows that came back were noise
 * charged against the report's time budget.
 */
export const CONTRARY_NOT_AN_ASSERTION_TR =
  "Bu blok bir iddia değil, bir liste (deliller/ekler) olduğu için aleyhe" +
  " kaynak araması yapılmadı. Listedeki belgeler hakkında bu rapordan bir" +
  " sonuç çıkarılamaz.";

/**
 * The one institution a whole petition is about.
 *
 * MEASURED DEFECT, 06.09.2026. The first attempt simply ran
 * {@link contraryBaseTerm} over the entire document, and on a real eser
 * sözleşmesi / ayıp dispute it answered **"ihbar tazminatı"** — an employment
 * institution that appears nowhere in the file. A whole petition contains
 * enough tokens to spell almost any concept: "bildirim" in one paragraph and
 * "tazminat" in another are enough for a token-matched concept key to fire,
 * and six claims then searched `ihbar tazminatı "tazminat talebinin reddi"`
 * for a construction-defect case.
 *
 * So the document-level term has a stricter test than a claim-level one, and
 * it is a test about the document rather than about the concept table: the
 * term must appear VERBATIM in the petition, and among those the one the
 * document actually repeats most often wins (ties to the longer, more specific
 * term). A subject the document never writes down is not its subject.
 */
export function documentContraryTerm(
  text: string,
  claimTerms: readonly string[] = [],
): string {
  const statuteFree = withoutStatuteNames(text);
  const folded = normalizeTurkishSearch(statuteFree);
  if (folded === "") return "";
  const candidates = new Set<string>();
  // The claims' OWN terms come first, and they are the reason this function
  // works. Running the concept engine over a whole petition is a different
  // question from running it over a paragraph — the document fires broad,
  // generic keys ("tazminat") while its paragraphs fire the specific ones
  // ("eser sözleşmesi", "manevi tazminat"). MEASURED, 06.09.2026: without this
  // the real petition's subject came out "tazminat" although two of its
  // paragraphs had already recognised "eser sözleşmesi" by name.
  for (const term of claimTerms) if (term !== "") candidates.add(term);
  // W17/c — MEASURED: the whole-document concept pass is the most expensive
  // step of the report (a 441 KB petition spent ~13 s in it, with the event
  // loop blocked for every other request on the server), and when the claims
  // already named their institutions it only adds the broad, generic keys the
  // comment above warns about. It runs only when no claim named one.
  if (candidates.size === 0) {
    for (const issue of analyzeIntake({
      question: statuteFree,
      jurisdiction: "TR",
      dataClass: "L0",
    }).issues) {
      if (issue.kind !== "conceptual") continue;
      if (issue.concept === undefined || issue.concept !== issue.label) continue;
      candidates.add(issue.label);
    }
  }
  for (const key of Object.keys(OPPOSITE_TERMS)) candidates.add(key);

  // W17/c — MEASURED: occurrences were counted as SUBSTRINGS, so every
  // "kıdem tazminatı" also counted as a "tazminat", and the generic key
  // outvoted the specific institution the petition was about. The most
  // specific term now claims its text first: candidates are counted longest
  // first, an occurrence already inside a longer candidate's occurrence is
  // not counted again, and a candidate must start at a word boundary.
  const needles = [...candidates]
    .map((term) => ({ term, needle: normalizeTurkishSearch(term) }))
    .filter((entry) => entry.needle !== "" && entry.needle !== folded)
    .sort((a, b) => b.needle.length - a.needle.length || (a.term < b.term ? -1 : 1));
  const covered = new Uint8Array(folded.length);
  let best = "";
  let bestCount = 0;
  for (const { term, needle } of needles) {
    let count = 0;
    for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
      if (at > 0 && /[\p{L}\p{N}]/u.test(folded[at - 1] as string)) continue;
      let free = true;
      for (let i = at; i < at + needle.length; i += 1) {
        if (covered[i] === 1) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      covered.fill(1, at, at + needle.length);
      count += 1;
    }
    if (count === 0) continue;
    if (count > bestCount || (count === bestCount && term.length > best.length)) {
      best = term;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The text with every STATUTE NAME blanked out (same length, spaces), so the
 * concept engine cannot read an institution out of a law's title (W17/c).
 *
 * MEASURED: "2004 sayılı İcra ve İflas Kanunu'nun 269 vd. maddeleri gereğince
 * icra yoluyla tahliye …" produced the base term "iflas" — a tahliye paragraph
 * searched for bankruptcy decisions because the statute that governs
 * enforcement happens to be called "İcra ve İflas Kanunu". A statute's name is
 * not an institution the paragraph argues about.
 */
export function withoutStatuteNames(text: string): string {
  const nfc = text.normalize("NFC");
  const references = parseReferences(nfc).filter((reference) => reference.kind === "legislation");
  if (references.length === 0) return nfc;
  let out = "";
  let cursor = 0;
  for (const reference of references) {
    const span = reference.span;
    if (span === undefined || span[0] < cursor) continue;
    out += nfc.slice(cursor, span[0]) + " ".repeat(span[1] - span[0]);
    cursor = span[1];
  }
  return out + nfc.slice(cursor);
}

/**
 * Said when the search subject came from the DOCUMENT, not from the claim.
 *
 * The distinction is the whole point: a decision found this way is about the
 * dispute, not necessarily about this paragraph, and the lawyer has to be told
 * which of the two they are reading.
 */
export function borrowedTermTR(term: string): string {
  return (
    `Bu iddianın kendi cümlelerinde tanınan bir hukuki kavram yok. Sorgular,` +
    ` dilekçenin tamamından çıkan "${term}" kavramı üzerine kuruldu:` +
    ` çıkan kararlar uyuşmazlığın konusuyla ilgilidir, bu iddiaya birebir` +
    " cevap verdikleri anlamına gelmez."
  );
}

/** Why a lane that really found decisions lists none of its own. */
export function alreadyListedTR(repeated: number, total: number): string {
  return (
    `Bu sorgunun bulduğu ${total} karardan ${repeated} tanesi bu iddianın` +
    " önceki sorgusunda zaten listelendi; aynı karar iki kez yazılmadı."
  );
}

export const CONTRARY_UNWIRED_TR =
  "Bu kurulumda aleyhe kaynak araması bağlı değil. Sorgu hazırlandı, çalıştırılmadı.";

export const CONTRARY_BUDGET_TR =
  "Sorgu bütçesi dolduğu için bu sorgu çalıştırılmadı; kalan iddialar için" +
  " aramayı ayrıca çalıştırın.";

export const CONTRARY_FAILED_TR =
  "Aleyhe kaynak araması tamamlanamadı (kaynağa erişilemedi). Bu bir sonuç" +
  " değildir.";

/** How many contrary lanes one report may actually execute. */
export const MAX_CONTRARY_LANE_RUNS = 40;

/**
 * Wall-clock the whole contrary phase may spend (W17).
 *
 * MEASURED, 06.09.2026: a real twelve-claim cevap dilekçesi spent **2 minutes
 * 4 seconds**, all of it in sequential upstream calls, and there was no clock
 * anywhere — only a lane COUNT, which says nothing about how slow a source is
 * that day. A report a lawyer will not wait for is a report they will not run.
 *
 * The cut is reported, never silent: every lane past the budget is
 * ÇALIŞTIRILMADI with {@link CONTRARY_TIME_BUDGET_TR}, so the report says what
 * it did not do.
 */
export const CONTRARY_TIME_BUDGET_MS = 30_000;

export const CONTRARY_TIME_BUDGET_TR =
  "Aleyhe kaynak araması için ayrılan süre (30 saniye) dolduğu için bu sorgu" +
  " çalıştırılmadı. Bu sorgunun bulabileceği kararlar raporda YOK; aramayı" +
  " ayrıca çalıştırabilirsiniz.";

/**
 * The base term the contrary lanes are built around, chosen deterministically:
 *
 *  1. the first authored `OPPOSITE_TERMS` concept the claim mentions (keys are
 *     scanned in the table's own order, which puts the specific institution
 *     before the generic remedy — that ordering is contrary.ts's contract);
 *  2. otherwise the claim's first legislation citation, as a query string
 *     ("6098 sayılı m. 344"), which `buildContraryLanes` flips with "bozma";
 *  3. otherwise nothing, and the report says so.
 *
 * A query string is NOT a künye. It is never rendered as one.
 */
export function contraryBaseTerm(claimText: string): string {
  // W17/c — a statute's NAME is not an institution ("İcra ve İflas Kanunu"
  // made a tahliye paragraph search for "iflas"); see withoutStatuteNames.
  const statuteFree = withoutStatuteNames(claimText);
  const folded = normalizeTurkishSearch(statuteFree);
  // W17 — the concept engine goes FIRST, because its table is ordered
  // most-specific-first and {@link OPPOSITE_TERMS} is not ordered at all.
  // MEASURED, 06.09.2026: on "Davacı ayrıca manevi tazminat talep etmektedir.
  // Ancak eser sözleşmesinden kaynaklanan uyuşmazlıklarda manevi tazminat
  // koşulları oluşmamıştır" both fire, and the OPPOSITE_TERMS scan answered
  // the bare key "tazminat" — the widest word in Turkish civil practice —
  // where the concept engine answers "manevi tazminat", which is what the
  // paragraph is actually about. The outcome-flip phrase is looked up
  // separately (`contraryFlavorFor`), so a more specific base term keeps the
  // same flip: the query became `manevi tazminat "tazminat talebinin reddi"`.
  // The fallback used to be the statute NUMBER, and it
  // produced queries like "6098 sayılı m. 475 bozma". No decision is written
  // that way, so the archive matched loosely and answered with five unrelated
  // decisions — which the report then printed as **aleyhe kaynak BULUNDU**.
  // On a real cevap dilekçesi (06.09.2026) that happened on five of twelve
  // claims: fifty hits, none of them about the claim. In a rebuttal report a
  // false "there IS authority against you" is the most expensive error there
  // is: the lawyer either wastes an afternoon or concedes a point for nothing.
  //
  // The base term is now the INSTITUTION, which is what a decision actually
  // says: the concept engine reads it out of the claim's own words. When no
  // institution is recognised the term stays EMPTY and the lane reports
  // ÇALIŞTIRILMADI with its reason — an honest "no query could be built" beats
  // five wrong answers.
  const issues = analyzeIntake({
    question: statuteFree,
    jurisdiction: "TR",
    dataClass: "L0",
  }).issues;
  for (const issue of issues) {
    if (issue.kind !== "conceptual") continue;
    // The fallback issue analyzeIntake emits when nothing is recognised is the
    // raw question itself; it is not an institution and must not become one.
    if (issue.concept === undefined || issue.concept !== issue.label) continue;
    if (normalizeTurkishSearch(issue.label) === folded) continue;
    return issue.label;
  }
  // Last resort: an authored opposite whose key the claim contains. The
  // LONGEST such key wins — "işçilik alacakları" is a better base term than
  // "tazminat", and object key order says nothing about which is better.
  let widest = "";
  for (const key of Object.keys(OPPOSITE_TERMS)) {
    if (startsAtWord(folded, key) && key.length > widest.length) widest = key;
  }
  return widest;
}

/** Does `folded` contain `term` STARTING at a word boundary? */
function startsAtWord(folded: string, term: string): boolean {
  if (term === "") return false;
  for (let at = folded.indexOf(term); at >= 0; at = folded.indexOf(term, at + 1)) {
    if (at > 0 && /[\p{L}\p{N}]/u.test(folded[at - 1] as string)) continue;
    // A Turkish word takes suffixes ("kira" still names the institution in
    // "kiranın"), so only the START must be a boundary.
    return true;
  }
  return false;
}

/** The standalone abbreviation "AYM" ("AYM'nin" counts: "'" is a boundary). */
const AYM_WORD = /(?<![\p{L}\p{N}])aym(?![\p{L}\p{N}])/u;

/**
 * The contrary lanes' flavour. W17/c — MEASURED: "aym" was matched as a
 * SUBSTRING, so "haklı saymak" and "Kadıköy Kaymakamlığı" switched a claim to
 * the Anayasa Mahkemesi lanes ("iptal isteminin reddi", "kabul edilemez") in
 * a rent dispute and a criminal defence.
 */
export function contraryFlavorFor(claimText: string): ContraryFlavor {
  const folded = normalizeTurkishSearch(claimText);
  if (startsAtWord(folded, "anayasa mahkemesi") || AYM_WORD.test(folded)) return "aym";
  if (
    folded.includes("içtihadı birleştirme") ||
    folded.includes("direnme") ||
    folded.includes("içtihat aykırılığı")
  ) {
    return "divergence";
  }
  return "general";
}

function laneResult(
  lane: ContraryLane,
  state: ContraryLaneState,
  hits: ContraryHit[],
  reason: string,
): ContraryLaneResult {
  return {
    kind: lane.kind,
    query: lane.query,
    flipPhrase: lane.flipPhrase,
    state,
    stateLabel: CONTRARY_LANE_LABEL_TR[state],
    hits: hits.map((hit) => ({
      kunye: hit.kunye,
      note: hit.note ?? "",
      href: hit.href ?? "",
    })),
    reason,
  };
}

// ---------------------------------------------------------------------------
// The unsourced bucket
// ---------------------------------------------------------------------------

export interface UnsourcedFinding {
  /** 0-based index of the sentence inside its claim. */
  sentenceIndex: number;
  /**
   * The document's OWN sentence, as the untrusted-content render guard
   * (`sanitizeMarkdown`) leaves it — nothing of this engine's own is removed
   * from it. This is the other side speaking.
   */
  alinti: string;
  /**
   * ColleX's observation line. Prefixed `⚠ KAYNAKSIZ`, and stripped of every
   * assessment word — this line is ColleX speaking, and ColleX may not call
   * an unsourced sentence weak, risky or wrong.
   */
  line: string;
}

export const UNSOURCED_MEANING_TR =
  `${KAYNAKSIZ_PREFIX} işareti, cümlenin hiçbir atfa bağlanmadığını söyler.` +
  " Bir kusur bildirimi DEĞİLDİR: vakıa cümlelerinin atfı olmaması olağandır.";

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface PetitionClaimAnalysis {
  claim: PetitionClaim;
  sentenceCount: number;
  /** ATIF DENETİMİ — rows produced by the shared citation-audit engine. */
  citations: CitationAuditRow[];
  citationTotals: Record<AuditBucket, number>;
  /** ALEYHE KAYNAK. */
  contrary: ClaimContrary;
  /** DAYANAKSIZ İFADE. */
  unsourced: UnsourcedFinding[];
}

export interface PetitionAnalysisTotals {
  claims: number;
  sentences: number;
  byKind: Record<ClaimKind, number>;
  /** Distinct authorities in the document, by bucket. */
  citations: Record<AuditBucket, number>;
  unsourcedSentences: number;
  contraryLanesBuilt: number;
  contraryLanesRun: number;
  contraryHits: number;
  /** Claims for which no contrary query could be built at all. */
  claimsWithoutContraryQuery: number;
}

export interface PetitionAnalysisReport {
  schema: typeof PETITION_ANALYSIS_SCHEMA;
  asOf: string;
  matterId: string;
  documentTitle: string;
  /** true when the analysed document is one of OUR OWN drafts. */
  own: boolean;
  generatedAt: string;
  /** Verbatim {@link PETITION_ANALYSIS_SUMMARY_TR}. Always present. */
  summary: string;
  claims: PetitionClaimAnalysis[];
  /** The document-level Atıf Denetim Raporu, unchanged and reused. */
  citationAudit: CitationAuditReport;
  totals: PetitionAnalysisTotals;
  notices: string[];
}

export interface PetitionAnalysisRequest {
  text: string;
  /** The PETITION'S date (YYYY-MM-DD); currency is judged against it. */
  asOf: string;
  matterId?: string;
  documentTitle?: string;
  /** Set when auditing our own draft rather than the other side's. */
  own?: boolean;
}

export interface PetitionAnalysisDeps {
  /** Same port the Atıf Denetim Raporu uses. Absent = every row UNCERTAIN. */
  resolveCitation?: CitationResolver;
  /** Absent = lanes are built and shown, never run. */
  contrarySearch?: ContrarySearchPort;
  now?: () => Date;
  maxContraryLaneRuns?: number;
  /** Wall-clock ceiling for the whole contrary phase. 0 disables the clock. */
  contraryTimeBudgetMs?: number;
  /** Elapsed-milliseconds source, injectable so the budget is testable. */
  monotonic?: () => number;
}

export class PetitionAnalysisError extends Error {}

/**
 * W17/c — MEASURED: one long petition kept the server's event loop to itself
 * for the whole analysis (`/v1/health` answered after 48.9 s). The work is
 * now far smaller, and it also gives the loop back every few claims so other
 * requests are served while a long report is being built. Nothing about the
 * result depends on it.
 */
const YIELD_EVERY_CLAIMS = 16;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Verbatim notices every report carries, in order. The first is the summary. */
export function petitionAnalysisNotices(own: boolean): string[] {
  return [
    PETITION_ANALYSIS_SUMMARY_TR,
    "Bu rapor makine üretimidir ve kural tabanlıdır: yapay zekâ kullanmaz," +
      " yorum üretmez, iddiaları puanlamaz. Her satırı avukat incelemesi gerektirir.",
    own
      ? "Bu rapor KENDİ dilekçenizi denetlemektedir."
      : "Bu rapor karşı tarafın dilekçesini denetlemektedir; cümleler karşı tarafa aittir.",
    "İddia listesi, dilekçenin başlıklarından ve numaralı yapısından çıkarılmıştır." +
      " Dilekçe numarasız yazılmışsa iddialar paragraf paragraf ayrılır.",
    UNSOURCED_MEANING_TR,
    // W17/b: this used to end '…cümlenin birebir hâli "alinti" alanındadır.'
    // There is no field called "alinti" on any screen — it is the JSON key —
    // and "alan" is a data-structure word, not lawyer Turkish. The console
    // already prints the verbatim sentence in quotation marks directly under
    // the scrubbed line, so the notice now points at what the lawyer can see.
    `${KAYNAKSIZ_PREFIX} satırında değerlendirme sözcükleri` +
      ` ${EVALUATIVE_WORD_PLACEHOLDER} ile değiştirilmiştir; cümlenin birebir hâli` +
      " hemen altında tırnak içinde durur.",
    "Aleyhe kaynak satırı bir arama künyesidir, kanıt değildir: tam metni açıp" +
      " alıntıyı kendiniz doğrulayın.",
    "Çalıştırılmamış bir sorgu, aleyhe kaynak bulunmadığı anlamına gelmez.",
  ];
}

/**
 * Run the analysis. Deterministic apart from the injected clock and the
 * injected ports; the claim list, the sentence list and the queries are pure
 * functions of the text.
 */
export async function analyzePetition(
  request: PetitionAnalysisRequest,
  deps: PetitionAnalysisDeps = {},
): Promise<PetitionAnalysisReport> {
  if (!isCalendarDate(request.asOf)) {
    throw new PetitionAnalysisError(AS_OF_INVALID_TR);
  }
  const now = deps.now ?? (() => new Date());
  const own = request.own === true;
  const claims = extractClaims(request.text);

  // ATIF DENETİMİ: ONE document-level audit, by the engine that owns the
  // three buckets and the empty-künye rule. We attribute its rows to claims;
  // we never re-implement its verdicts.
  const resolver: CitationResolver =
    deps.resolveCitation ??
    (async () => ({
      uncertainReason:
        "Kaynak sorgusu bu kurulumda bağlı değil; atıf denetlenemedi." +
        " Bu, atıfın bulunmadığı anlamına GELMEZ.",
    }));
  // The document's citations are extracted ONCE; the audit builds one row per
  // entry, in this order, so row i stands for `extracted[i]` and its key.
  const extracted = request.text.trim() !== "" ? extractAuditCitations(request.text) : [];
  const citationAudit = await auditCitations(
    {
      ...(request.text.trim() !== "" ? { text: request.text } : { citations: [] }),
      asOf: request.asOf,
      ...(request.matterId !== undefined ? { matterId: request.matterId } : {}),
      ...(request.documentTitle !== undefined ? { documentTitle: request.documentTitle } : {}),
    },
    resolver,
    { now, extracted },
  );
  const rowKeys: string[] = citationAudit.rows.map((_, index) => {
    const parsed = extracted[index]?.parsed;
    return parsed !== undefined ? citationKey(parsed) : "";
  });
  const knownKeys = new Set(rowKeys.filter((key) => key !== ""));

  // Each claim's own institution, and then the one the whole petition is
  // about — used when a claim names none of its own. Both are computed once,
  // before any search: the document's subject is a property of the document.
  // A document LIST (DELİLLER, EKLER) and a TALEP carry no proposition to
  // search against; an unclassified paragraph still does (W17/b rule (c)).
  const ownTerms: string[] = [];
  for (const [claimIndex, claim] of claims.entries()) {
    if (claimIndex % YIELD_EVERY_CLAIMS === 0) await yieldToEventLoop();
    ownTerms.push(
      isDocumentListHeading(claim.heading) || claim.kind === "TALEP"
        ? ""
        : contraryBaseTerm(claim.text),
    );
  }
  await yieldToEventLoop();
  const documentTerm = documentContraryTerm(request.text, ownTerms);

  const runs = deps.maxContraryLaneRuns ?? MAX_CONTRARY_LANE_RUNS;
  const timeBudgetMs = deps.contraryTimeBudgetMs ?? CONTRARY_TIME_BUDGET_MS;
  const monotonic = deps.monotonic ?? (() => Date.now());
  const contraryStartedAt = monotonic();
  let laneRuns = 0;

  /**
   * One upstream call per DISTINCT query, however many claims ask for it.
   *
   * MEASURED, 06.09.2026: once claims without an institution of their own
   * borrowed the document's, six claims built the identical lane and the
   * report issued `ihbar tazminatı "tazminat talebinin reddi"` six separate
   * times. Sixteen lanes at roughly ten seconds each meant the thirty-second
   * budget ran three of them and reported thirteen ÇALIŞTIRILMADI — coverage
   * on paper, nothing on screen. The answer for one query is the answer for
   * every claim that asked it; a rejection is cached as a rejection so a dead
   * source is not retried sixteen times either.
   */
  const contraryCache = new Map<string, Promise<ContrarySearchResult>>();
  const searchOnce = (lane: ContraryLane): Promise<ContrarySearchResult> => {
    const search = deps.contrarySearch;
    if (search === undefined) return Promise.resolve({ hits: [], failedSources: [] });
    const cached = contraryCache.get(lane.query);
    if (cached !== undefined) return cached;
    const pending = search(lane, request.asOf).then(asContraryResult);
    contraryCache.set(lane.query, pending);
    return pending;
  };

  const analyses: PetitionClaimAnalysis[] = [];
  for (const [claimIndex, claim] of claims.entries()) {
    if (claimIndex % YIELD_EVERY_CLAIMS === 0) await yieldToEventLoop();
    // W17/c — a row is this claim's when the PARSER finds that authority
    // INSIDE the claim, and a sentence is bound to it when the citation's
    // position OVERLAPS the sentence's. MEASURED: attribution used to search
    // the claim's text for the row's spelling, and the most common statute
    // form a Turkish petition writes — "6098 sayılı Türk Borçlar Kanunu'nun
    // 315. maddesi", "5237 sayılı TCK'nın 158/1-f maddesinde" — was spelled
    // in the row as a join of two parser fragments that never occurs in any
    // document. The claim got no citation and its own citing sentence was
    // printed ⚠ KAYNAKSIZ. The same substring search attached "TBK m. 34" to
    // a claim citing "TBK m. 344" and "HMK m. 11" to one citing "HMK m. 119".
    const { flat, sentences } = petitionSentenceSpans(claim.text);
    const occurrences = citationOccurrences(flat).occurrences.filter((occurrence) =>
      knownKeys.has(occurrence.key),
    );
    const claimKeys = new Set(occurrences.map((occurrence) => occurrence.key));
    const rows = citationAudit.rows.filter((_, index) => claimKeys.has(rowKeys[index] ?? ""));
    const citationTotals: Record<AuditBucket, number> = {
      FOUND: 0,
      NOT_FOUND: 0,
      UNCERTAIN: 0,
    };
    for (const row of rows) citationTotals[row.bucket] += 1;

    // ---- ALEYHE KAYNAK ---------------------------------------------------
    // A DELİLLER / EKLER block lists documents; there is no proposition in it
    // to find authority against, so no lane is built and the report says why.
    const isList = isDocumentListHeading(claim.heading);
    const isRequest = claim.kind === "TALEP";
    const ownTerm = ownTerms[claimIndex] ?? "";
    // W17 — MEASURED, 06.09.2026: on a real cevap dilekçesi only 2 of 10
    // claims named an institution in their own words, so 8 claims produced no
    // contrary query at all. That is honest but nearly useless: a paragraph
    // reading "davacı ilk bildirimini ancak 30.01.2026 tarihinde yapmıştır"
    // is still a paragraph in an ESER SÖZLEŞMESİ dispute, and that is exactly
    // the term a lawyer would search. The petition as a whole is therefore the
    // fallback subject — and the report SAYS the term came from the document
    // rather than from the claim, because the two are not the same claim about
    // the search.
    const borrowed = ownTerm === "" && !isList && !isRequest ? documentTerm : "";
    const baseTerm = ownTerm !== "" ? ownTerm : borrowed;
    /** Decisions already listed under an earlier lane of THIS claim. */
    const seenContrary = new Set<string>();
    const flavor = contraryFlavorFor(claim.text);
    const lanes: ContraryLaneResult[] = [];
    if (baseTerm !== "") {
      for (const lane of buildContraryLanes(baseTerm, flavor)) {
        if (deps.contrarySearch === undefined) {
          lanes.push(laneResult(lane, "CALISTIRILMADI", [], CONTRARY_UNWIRED_TR));
          continue;
        }
        // A query this report has already sent costs nothing and is never
        // charged against the lane or time budget.
        const repeatOfEarlierQuery = contraryCache.has(lane.query);
        if (!repeatOfEarlierQuery && laneRuns >= runs) {
          lanes.push(laneResult(lane, "CALISTIRILMADI", [], CONTRARY_BUDGET_TR));
          continue;
        }
        // The clock is read only BETWEEN lanes, and only once one lane has
        // actually run: a report that searched nothing because the very first
        // check was already late would be worse than a slow one.
        if (
          !repeatOfEarlierQuery &&
          laneRuns > 0 &&
          timeBudgetMs > 0 &&
          monotonic() - contraryStartedAt >= timeBudgetMs
        ) {
          lanes.push(laneResult(lane, "CALISTIRILMADI", [], CONTRARY_TIME_BUDGET_TR));
          continue;
        }
        if (!repeatOfEarlierQuery) laneRuns += 1;
        try {
          const { hits, failedSources } = await searchOnce(lane);
          // W17/c — a source that did not answer is not an absence of
          // authority. No row and a failed source is a search that did not
          // complete, whatever the other sources said.
          if (hits.length === 0 && failedSources.length > 0) {
            lanes.push(
              laneResult(lane, "ARAMA_BASARISIZ", [], contraryPartialFailureTR(failedSources)),
            );
            continue;
          }
          // W17 — one claim's lanes differ only in their outcome-flip phrase,
          // so they routinely land on the SAME decisions. MEASURED, 06.09.2026:
          // `eser sözleşmesi "aksi yönde"` and `eser sözleşmesi "karşı oy"`
          // both returned the identical five künye, and the report printed ten
          // rows for five decisions. A decision is listed under the FIRST lane
          // that found it; the next lane says how many of its results were
          // already above rather than repeating them, and it keeps its BULUNDU
          // state — it really did find them.
          const fresh = hits.filter((hit) => {
            const key = foldTr(hit.kunye);
            if (key === "" || seenContrary.has(key)) return false;
            seenContrary.add(key);
            return true;
          });
          const repeated = hits.length - fresh.length;
          const reasons = [
            ...(repeated > 0 ? [alreadyListedTR(repeated, hits.length)] : []),
            ...(failedSources.length > 0 ? [contraryMissingSourcesTR(failedSources)] : []),
          ];
          lanes.push(
            hits.length > 0
              ? laneResult(lane, "BULUNDU", fresh, reasons.join(" "))
              : laneResult(lane, "ARANDI_BULUNAMADI", [], ""),
          );
        } catch {
          // An outage is not an absence of authority.
          lanes.push(laneResult(lane, "ARAMA_BASARISIZ", [], CONTRARY_FAILED_TR));
        }
      }
    }
    const sourceBound = rows.flatMap((row) =>
      row.contrary.map((entry) => ({ kunye: entry.kunye, note: entry.note })),
    );

    // ---- DAYANAKSIZ İFADE ------------------------------------------------
    const unsourced: UnsourcedFinding[] = [];
    sentences.forEach((sentence, sentenceIndex) => {
      // W17 — a request and a document list assert no fact, so neither can
      // carry an unsourced one. MEASURED, 06.09.2026: the report marked
      // "davanın reddine … karar verilmesini … talep ederiz" and the whole
      // DELİLLER line KAYNAKSIZ, which is 2 of the 12 warnings a lawyer had
      // to read past. A warning that fires on something that could never be
      // sourced trains the reader to skip the ones that matter.
      if (isRequest || isList) return;
      const bound = occurrences.some(
        (occurrence) => occurrence.span[0] < sentence.end && occurrence.span[1] > sentence.start,
      );
      if (bound) return;
      unsourced.push({
        sentenceIndex,
        alinti: sentence.text,
        line: `${KAYNAKSIZ_PREFIX} — ${stripEvaluativeWords(sentence.text)}`,
      });
    });

    analyses.push({
      claim,
      sentenceCount: sentences.length,
      citations: rows,
      citationTotals,
      contrary: {
        baseTerm,
        flavor,
        lanes,
        sourceBound,
        note: isList
          ? CONTRARY_NOT_AN_ASSERTION_TR
          : isRequest
            ? CONTRARY_NOT_FOR_REQUEST_TR
            : baseTerm === ""
              ? NO_CONTRARY_BASE_TERM_TR
              : borrowed !== ""
                ? borrowedTermTR(borrowed)
                : "",
      },
      unsourced,
    });
  }

  const byKind: Record<ClaimKind, number> = { TALEP: 0, VAKIA: 0, HUKUKI_SEBEP: 0, DIGER: 0 };
  for (const analysis of analyses) byKind[analysis.claim.kind] += 1;

  const totals: PetitionAnalysisTotals = {
    claims: analyses.length,
    sentences: analyses.reduce((sum, a) => sum + a.sentenceCount, 0),
    byKind,
    citations: { ...citationAudit.totals },
    unsourcedSentences: analyses.reduce((sum, a) => sum + a.unsourced.length, 0),
    contraryLanesBuilt: analyses.reduce((sum, a) => sum + a.contrary.lanes.length, 0),
    contraryLanesRun: analyses.reduce(
      (sum, a) =>
        sum +
        a.contrary.lanes.filter(
          (lane) => lane.state === "BULUNDU" || lane.state === "ARANDI_BULUNAMADI",
        ).length,
      0,
    ),
    contraryHits: analyses.reduce(
      (sum, a) => sum + a.contrary.lanes.reduce((n, lane) => n + lane.hits.length, 0),
      0,
    ),
    claimsWithoutContraryQuery: analyses.filter((a) => a.contrary.baseTerm === "").length,
  };

  const notices = petitionAnalysisNotices(own);
  if (analyses.length === 0) {
    notices.push(
      "Bu metinde iddia bulunamadı. Metin boş olabilir ya da dilekçe biçiminde" +
        " değildir; denetlenecek bir cümle çıkarılamadı.",
    );
  }
  if (analyses.length === MAX_CLAIMS) {
    notices.push(
      `Bu dilekçede ${MAX_CLAIMS} iddiadan fazlası var; rapor ilk ${MAX_CLAIMS}` +
        " iddiayı taşır. Dilekçeyi bölerek yeniden çalıştırın.",
    );
  }

  return {
    schema: PETITION_ANALYSIS_SCHEMA,
    asOf: request.asOf,
    matterId: request.matterId ?? "",
    documentTitle: request.documentTitle ?? "",
    own,
    generatedAt: now().toISOString(),
    summary: PETITION_ANALYSIS_SUMMARY_TR,
    claims: analyses,
    citationAudit,
    totals,
    notices,
  };
}

// ---------------------------------------------------------------------------
// Our own draft, through the same engine
// ---------------------------------------------------------------------------

/**
 * Flatten one of our drafts into petition text so the SAME analysis can run
 * over it. `draftAudit.ts` (which re-verifies the draft's hashed evidence) is
 * untouched and still the right tool for that job; this is the other half —
 * what a reader of our petition would find in it.
 */
export function petitionTextFromDraft(draft: Draft): string {
  const blocks: string[] = [];
  for (const section of draft.sections) {
    if (section.title.trim() !== "") blocks.push(section.title.trim());
    for (const paragraph of section.paragraphs) {
      const text = paragraph.text.trim();
      if (text !== "") blocks.push(text);
    }
  }
  return blocks.join("\n\n");
}

/** Run the petition analysis over one of our own drafts. */
export async function analyzeDraftAsPetition(
  draft: Draft,
  deps: PetitionAnalysisDeps = {},
  options: { asOf?: string; documentTitle?: string } = {},
): Promise<PetitionAnalysisReport> {
  return analyzePetition(
    {
      text: petitionTextFromDraft(draft),
      asOf: options.asOf ?? draft.createdAt.slice(0, 10),
      ...(draft.matterId !== undefined && draft.matterId !== null
        ? { matterId: draft.matterId }
        : {}),
      documentTitle: options.documentTitle ?? draft.title,
      own: true,
    },
    deps,
  );
}
