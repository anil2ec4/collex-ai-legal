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
  auditCitations,
  extractAuditCitations,
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
  "kusur",
  "kusurlu",
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
 * Remove every assessment word (with its Turkish suffix) from a line.
 *
 * Matching is token-by-token on the Turkish-lowercased form of each token, so
 * "İ"/"ı" behave correctly and no length assumption is made about the folded
 * copy. A token whose folded form STARTS WITH one of the stems is replaced
 * whole — that is the suffix rule.
 */
export function stripEvaluativeWords(text: string): string {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    const index = match.index ?? 0;
    const folded = token.toLocaleLowerCase("tr-TR");
    if (!EVALUATIVE_WORD_STEMS.some((stem) => folded.startsWith(stem))) continue;
    out += text.slice(cursor, index) + EVALUATIVE_WORD_PLACEHOLDER;
    cursor = index + token.length;
  }
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
  const flat = sanitizeMarkdown(text).replace(/\s+/gu, " ").trim();
  if (flat === "") return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < flat.length; i += 1) {
    const ch = flat[i] as string;
    if (!TERMINATORS.has(ch)) continue;
    let end = i;
    while (end + 1 < flat.length && TERMINATORS.has(flat[end + 1] as string)) end += 1;
    i = end;
    const gap = flat[end + 1];
    if (gap === undefined) {
      out.push(flat.slice(start, end + 1).trim());
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
    out.push(flat.slice(start, end + 1).trim());
    start = end + 1;
  }
  const tail = flat.slice(start).trim();
  if (tail !== "") out.push(tail);
  return out.filter((sentence) => sentence !== "");
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
const HEADING_RULES: readonly { pattern: RegExp; kind: ClaimKind; weak?: boolean }[] =
  Object.freeze([
    {
      pattern:
        /^(sonuç ve istem|netice-?i talep|netice ve talep|talep ve sonuç|sonuç|istem|talep|talebimiz)$/u,
      kind: "TALEP",
    },
    {
      pattern: /^(hukuki sebepler|hukukî sebepler|hukuki nedenler|hukukî nedenler|yasal dayanak|yasal dayanaklar|hukuki dayanak|hukuki dayanaklar)$/u,
      kind: "HUKUKI_SEBEP",
    },
    {
      pattern:
        // W17/b — a cevap dilekçesi says AÇIKLAMALAR; a ceza savunma says
        // SAVUNMAMIZ, an istinaf says İSTİNAF SEBEPLERİMİZ, a temyiz says
        // TEMYİZ NEDENLERİMİZ. Measured: without them a savunma dilekçesi had
        // NO heading at all and every ground fell through to the unclassified
        // kind.
        /^(açıklamalar|açıklamalarımız|olaylar|olay|vakıalar|maddi olaylar|maddi vakıalar|olaylar ve açıklamalar|konu|dava konusu|cevaplarımız|itirazlarımız|beyanlarımız|savunmamız|savunmalarımız|savunma|itirazımız|itiraz sebeplerimiz|itiraz nedenlerimiz|istinaf sebeplerimiz|istinaf nedenlerimiz|istinaf gerekçelerimiz|temyiz sebeplerimiz|temyiz nedenlerimiz|temyiz gerekçelerimiz|şikayet sebeplerimiz|başvuru sebeplerimiz|gerekçelerimiz)$/u,
      kind: "VAKIA",
      weak: true,
    },
    { pattern: /^(deliller|delillerimiz|hukuki deliller|delil listesi)$/u, kind: "DIGER" },
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
const PREAMBLE_TITLES: ReadonlySet<string> = new Set([
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
]);

/** Label of an identity line ("DAVACI : …"). */
const PREAMBLE_LABELS: ReadonlySet<string> = new Set([
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
  "esas no",
  "dosya no",
  "tarih",
  "konu",
  "dava konusu",
  "dava değeri",
  "harca esas değer",
  "ekler",
  "ek",
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
]);

/**
 * The closing signature block — "Davalı Vekili" / "Av. Selin Aydın".
 *
 * MEASURED, 06.09.2026: those two lines became "iddia-12" of a twelve-claim
 * report, so a lawyer's own name was listed as one of the other side's claims
 * and searched for contrary authority. Like {@link PREAMBLE_TITLES} this is a
 * CLOSED list of forms, not a shape heuristic: a role line spelled exactly as
 * a role, a courtesy closing, or a line that is NOTHING but the "Av." title
 * and a name. A petition sentence is never only "Av. Selin Aydın".
 */
const SIGNATURE_LINE =
  /^(?:(?:davacı|davalı|müşteki|katılan|borçlu|alacaklı|sanık|şüpheli|itiraz eden|başvurucu)?\s*(?:vekili|vekilleri|müdafii|müdafi)|saygılarımla|saygılarımızla|saygıyla|imza|av\.?\s+\S[^,:;]{0,48})$/u;

/** "… MAHKEMESİNE", "… HÂKİMLİĞİNE" — the court the petition is addressed to. */
/**
 * W17/b — MEASURED. `isPreambleLine` replaces the apostrophe with a SPACE
 * before testing, so "İZMİR 5. İCRA MÜDÜRLÜĞÜ'NE" arrives as
 * "izmir 5 icra mudurlugu ne" — and only two of the offices had their
 * apostrophe-split spelling listed. The result: on an icra-itiraz shape the
 * addressee line became iddia-1, and on a savcılık başvurusu likewise. Every
 * office now carries both spellings.
 */
const COURT_ADDRESS_TAIL =
  /(mahkemesine|mahkemesi ne|hakimligine|hakimliğine|hâkimliğine|hakimligi ne|hâkimliği ne|hakimliği ne|başkanlığına|baskanligina|başkanlığı na|baskanligi na|müdürlüğüne|mudurlugune|müdürlüğü ne|mudurlugu ne|dairesine|dairesi ne|savcılığına|savciligina|savcılığı na|savciligi na|başsavcılığına|bassavciligina|başsavcılığı na|bassavciligi na|kuruluna|kurulu na|başkanlığa|kurumuna|kurumu na)$/u;

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
  if (labelled !== null) {
    const written = (labelled[1] as string).replace(/[.\s]+$/u, "");
    const label = normalizeTurkishSearch(written);
    if (PREAMBLE_LABELS.has(label)) return true;
    // "İSTİNAF EDEN (DAVALI) : …" — a parenthetical restatement of the role is
    // how an istinaf dilekçesi writes it, and it is still the same label.
    const bare = normalizeTurkishSearch(written.replace(/\([^)]*\)/gu, " "));
    if (PREAMBLE_LABELS.has(bare)) return true;
  }
  if (SIGNATURE_LINE.test(normalizeTurkishSearch(line.trim()))) return true;
  const bare = normalizeTurkishSearch(line.replace(/[:.\s]+$/u, "").replace(/['’]/gu, " "));
  if (bare === "" || bare.length > 90) return false;
  if (PREAMBLE_TITLES.has(bare)) return true;
  if (COURT_ADDRESS_TAIL.test(bare)) return true;
  return false;
}

/** Cue phrases that make a block a TALEP no matter which heading it sits under. */
const TALEP_CUES: readonly string[] = Object.freeze([
  "talep ederiz",
  "talep ediyoruz",
  "arz ve talep",
  "arz ederiz",
  "karar verilmesini",
  "hükmedilmesini",
  "istemekteyiz",
]);

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
 */
const CLAIM_MARKER =
  /^\s*(?:(?:MADDE|Madde|Md\.?)\s*)?(?:\((\d+(?:[.\-]\d+)*)\)|(\d+(?:[.\-]\d+)*)[.)\-–—:]{1,2})\s+(?=\S)/u;

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

/**
 * Every spelling an audit row stands for. `rawForms` is additive, so a row
 * from a report written before W17/b falls back to its single `raw`.
 */
function rawFormsOf(row: CitationAuditRow): string[] {
  const forms = row.rawForms;
  return Array.isArray(forms) && forms.length > 0 ? forms : [row.raw];
}

/** What a recognised heading says about the lines under it. */
interface HeadingSense {
  kind: ClaimKind;
  /** True for the generic narrative section, whose lines decide for themselves. */
  weak: boolean;
}

function headingSenseOfLabel(bare: string): HeadingSense | undefined {
  if (bare === "" || bare.length > 60) return undefined;
  for (const rule of HEADING_RULES) {
    if (rule.pattern.test(bare)) return { kind: rule.kind, weak: rule.weak === true };
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
  const bare = normalizeTurkishSearch(
    heading.replace(HEADING_LEAD, "").replace(/[:.\s]+$/u, ""),
  );
  if (bare === "") return false;
  if (LIST_HEADING.test(bare)) return true;
  const rule = HEADING_RULES.find((entry) => entry.pattern.test(bare));
  return rule !== undefined && rule.kind === "DIGER";
}

/** EKLER / EK LİSTESİ — a list that is not one of the named sections. */
const LIST_HEADING = /^(ekler|ek listesi|ekleri|ekler listesi|belgeler)$/u;

/** Is this line a section heading on a line of its own, and if so which kind? */
function headingKindOf(line: string): HeadingSense | undefined {
  return headingSenseOfLabel(
    normalizeTurkishSearch(line.replace(HEADING_LEAD, "").replace(/[:.\s]+$/u, "")),
  );
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
  const sense = headingSenseOfLabel(normalizeTurkishSearch(label.replace(/[.\s]+$/u, "")));
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
  // from the abbreviation before this test sees it.
  return pairArticlesWithTheirLaw(parseReferences(text)).some(
    (reference) =>
      reference.kind === "court_decision" ||
      reference.kind === "official_gazette" ||
      reference.legislationNo !== undefined,
  );
}

function inferKind(text: string, heading: HeadingSense | undefined): ClaimKind {
  const folded = normalizeTurkishSearch(text);
  if (TALEP_CUES.some((cue) => folded.includes(cue))) return "TALEP";
  if (heading !== undefined && !heading.weak) return heading.kind;
  // Under a generic heading the paragraph decides for itself, and a real
  // citation outranks every cue word.
  if (citesAuthority(text)) return "HUKUKI_SEBEP";
  if (heading !== undefined) return heading.kind;
  if (HUKUKI_SEBEP_CUES.some((cue) => folded.includes(cue))) return "HUKUKI_SEBEP";
  if (VAKIA_CUES.some((cue) => folded.includes(cue))) return "VAKIA";
  return "DIGER";
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
      continue;
    }
    const asHeading = headingKindOf(line);
    if (asHeading !== undefined) {
      flush();
      heading = line.trim();
      headingSense = asHeading;
      continue;
    }
    // A preamble line ends the previous block and contributes nothing: it is
    // addressing, not assertion. It never changes the current heading. This
    // runs BEFORE the inline-heading test on purpose: "KONU" is both a
    // preamble label and a narrative heading, and as a labelled field
    // ("KONU : …") it is the preamble one.
    if (isPreambleLine(line)) {
      flush();
      continue;
    }
    const inline = inlineHeadingOf(line);
    if (inline !== undefined) {
      flush();
      heading = inline.heading;
      headingSense = inline.sense;
      current = { number: "", parts: [inline.rest] };
      continue;
    }
    const marked = line.match(CLAIM_MARKER);
    if (marked !== null) {
      flush();
      // Group 1 is the parenthesised form "(3)", group 2 the bare "3." form.
      current = { number: (marked[1] ?? marked[2] ?? "") as string, parts: [line.trim()] };
      continue;
    }
    if (current === undefined) current = { number: "", parts: [] };
    current.parts.push(line.trim());
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
 * Port for running one contrary lane. INJECTED, and optional: with nothing
 * wired the lanes are still built and shown, in state ÇALIŞTIRILMADI. A
 * throw becomes ARAMA_BASARISIZ, never "aleyhe kaynak yok".
 */
export type ContrarySearchPort = (lane: ContraryLane, asOf: string) => Promise<ContraryHit[]>;

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
  const folded = normalizeTurkishSearch(text);
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
  for (const issue of analyzeIntake({ question: text, jurisdiction: "TR", dataClass: "L0" })
    .issues) {
    if (issue.kind !== "conceptual") continue;
    if (issue.concept === undefined || issue.concept !== issue.label) continue;
    candidates.add(issue.label);
  }
  for (const key of Object.keys(OPPOSITE_TERMS)) candidates.add(key);

  let best = "";
  let bestCount = 0;
  for (const term of candidates) {
    const needle = normalizeTurkishSearch(term);
    if (needle === "" || needle === folded) continue;
    const count = folded.split(needle).length - 1;
    if (count === 0) continue;
    if (count > bestCount || (count === bestCount && term.length > best.length)) {
      best = term;
      bestCount = count;
    }
  }
  return best;
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
  const folded = normalizeTurkishSearch(claimText);
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
    question: claimText,
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
    if (folded.includes(key) && key.length > widest.length) widest = key;
  }
  return widest;
}

function contraryFlavorFor(claimText: string): ContraryFlavor {
  const folded = normalizeTurkishSearch(claimText);
  if (folded.includes("anayasa mahkemesi") || folded.includes("aym")) return "aym";
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

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
  if (!ISO_DATE.test(request.asOf)) {
    throw new PetitionAnalysisError(
      "Analiz tarihi (asOf) YYYY-AA-GG biçiminde olmalı: yürürlük, bugüne göre değil" +
        " dilekçenin tarihine göre hesaplanır.",
    );
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
  const citationAudit = await auditCitations(
    {
      ...(request.text.trim() !== "" ? { text: request.text } : { citations: [] }),
      asOf: request.asOf,
      ...(request.matterId !== undefined ? { matterId: request.matterId } : {}),
      ...(request.documentTitle !== undefined ? { documentTitle: request.documentTitle } : {}),
    },
    resolver,
    { now },
  );

  // Each claim's own institution, and then the one the whole petition is
  // about — used when a claim names none of its own. Both are computed once,
  // before any search: the document's subject is a property of the document.
  const ownTerms = claims.map((claim) =>
    claim.kind === "DIGER" || claim.kind === "TALEP" ? "" : contraryBaseTerm(claim.text),
  );
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
  const contraryCache = new Map<string, Promise<ContraryHit[]>>();
  const searchOnce = (lane: ContraryLane): Promise<ContraryHit[]> => {
    const search = deps.contrarySearch;
    if (search === undefined) return Promise.resolve([]);
    const cached = contraryCache.get(lane.query);
    if (cached !== undefined) return cached;
    const pending = search(lane, request.asOf);
    contraryCache.set(lane.query, pending);
    return pending;
  };

  const analyses: PetitionClaimAnalysis[] = [];
  for (const [claimIndex, claim] of claims.entries()) {
    const folded = foldTr(claim.text);
    // W17/b — a row is this claim's when the claim's text contains ANY of the
    // spellings the document used for that authority. Matching only `row.raw`
    // (the first spelling seen anywhere in the document) lost "TTK m. 23" from
    // the HUKUKÎ SEBEPLER block, which cites it in so many words: the row had
    // been keyed under the earlier, longer "TTK m. 23/1-c", so the block's own
    // card printed "Atıf denetimi — 4 atıf" over a sentence citing five.
    const rows = citationAudit.rows.filter((row) =>
      rawFormsOf(row).some((form) => {
        const raw = foldTr(form);
        return raw !== "" && folded.includes(raw);
      }),
    );
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
    const borrowed = ownTerm === "" && !isList && claim.kind !== "TALEP" ? documentTerm : "";
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
          const hits = await searchOnce(lane);
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
          lanes.push(
            hits.length > 0
              ? laneResult(
                  lane,
                  "BULUNDU",
                  fresh,
                  repeated > 0 ? alreadyListedTR(repeated, hits.length) : "",
                )
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
    const sentences = splitPetitionSentences(claim.text);
    const unsourced: UnsourcedFinding[] = [];
    sentences.forEach((sentence, sentenceIndex) => {
      // W17 — a request and a document list assert no fact, so neither can
      // carry an unsourced one. MEASURED, 06.09.2026: the report marked
      // "davanın reddine … karar verilmesini … talep ederiz" and the whole
      // DELİLLER line KAYNAKSIZ, which is 2 of the 12 warnings a lawyer had
      // to read past. A warning that fires on something that could never be
      // sourced trains the reader to skip the ones that matter.
      if (claim.kind === "TALEP" || isList) return;
      const foldedSentence = foldTr(sentence);
      const bound = rows.some((row) =>
        rawFormsOf(row).some((form) => {
          const raw = foldTr(form);
          return raw !== "" && foldedSentence.includes(raw);
        }),
      );
      if (bound) return;
      unsourced.push({
        sentenceIndex,
        alinti: sentence,
        line: `${KAYNAKSIZ_PREFIX} — ${stripEvaluativeWords(sentence)}`,
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
