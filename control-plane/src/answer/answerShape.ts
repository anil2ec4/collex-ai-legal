/**
 * Answer shape — does the passage carry the KIND of value the question asks
 * for? (W22 follow-up, `shape-v1`.)
 *
 * WHY THIS EXISTS. Without a model the answer's passage order is lexical: a
 * passage that merely CONTAINS the question's words can lead the answer. On a
 * real iş davası file, "Davacı işe ne zaman başladı?" was answered first with
 * the heading line "TANIK BEYAN TUTANAĞI — Davacı … işe giriş" instead of the
 * sentence that states the date; the review grid already says "soruyu
 * karşıladığı denetlenmedi" for such a cell, the answer screen said nothing.
 *
 * WHAT IT DOES — and what it does not.
 *   1. `classifyWantedShape(question)` reads the ASKED part of the question
 *      (its interrogative sentences) and names the shape an answer to it
 *      must carry: "ne zaman" wants a DATE, "ne kadar ücret" an AMOUNT,
 *      "kaç gün" a DURATION, a bare "kaç / ne kadar" a QUANTITY, "kim" a
 *      PERSON, "hangi mahkeme" a COURT. Everything else is NONE — no shape is
 *      checked, and nothing is claimed.
 *   2. `assessPassageShape(question, passage)` looks for a value of that shape
 *      in a SENTENCE of the passage that also carries the question's core
 *      words (at least one of them). Dates, amounts and ratios
 *      are read with the matter analysis' own patterns
 *      (exhaustive/observations.ts `recognisedValueSpans`), and sentences are
 *      cut by its own rules (`sentenceSpanAround`), so the two surfaces never
 *      disagree about what a date is.
 *   3. `isHeadingLike(passage)` recognises a heading, a label-only line or a
 *      list of names: short, mostly capitalised, or "ETİKET : değer" lines.
 *
 * `found: true` means ONLY that such a value stands next to the question's
 * words. It is a lexical and pattern check, never a reading of the answer:
 * every surface says "biçim bulundu", never "soruyu cevaplıyor". `found:
 * false` is the useful half — the lead passage does not even carry the shape
 * the question asks for, and the reader is told so (ANSWER_SHAPE_NOT_FOUND).
 *
 * Pure, deterministic, offline. Offsets returned are Unicode CODE POINTS
 * within the passage text (ADR-003).
 */

import {
  recognisedValueSpans,
  sentenceSpanAround,
  topicWordKey,
} from "../exhaustive/observations.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { cpLength, foldTurkishCase } from "../retrieval/turkishAnalyzer.js";
import { mapPassageCoverage } from "./coverage.js";

/** Producer version of every answer-shape verdict (carried on the answer). */
export const ANSWER_SHAPE_VERSION = "shape-v1";

/** The value kinds a question can ask for. */
export type AnswerShapeKind = "DATE" | "AMOUNT" | "DURATION" | "QUANTITY" | "PERSON" | "COURT";

/** What the question wants; NONE = no shape is checked. */
export type WantedAnswerShape = AnswerShapeKind | "NONE";

/** Turkish name of each shape, as the reader sees it ("Soru bir tarih soruyor"). */
export const ANSWER_SHAPE_LABEL_TR: Readonly<Record<AnswerShapeKind, string>> = Object.freeze({
  DATE: "tarih",
  AMOUNT: "para tutarı",
  DURATION: "süre",
  QUANTITY: "sayı ya da miktar",
  PERSON: "kişi ya da taraf adı",
  COURT: "mahkeme ya da daire adı",
});

/** Warning code: the lead passage carries no value of the wanted shape. */
export const ANSWER_SHAPE_NOT_FOUND = "ANSWER_SHAPE_NOT_FOUND";

/**
 * The sentence for ANSWER_SHAPE_NOT_FOUND (Turkish first; the machine code
 * goes in parentheses after it wherever it is printed).
 */
export function answerShapeNotFoundTr(kind: AnswerShapeKind): string {
  return (
    `Soru bir ${ANSWER_SHAPE_LABEL_TR[kind]} soruyor; öne çıkan alıntıda bu biçimde bir değer ` +
    "bulunamadı — alıntının soruyu karşıladığı denetlenmedi, alıntıyı kendiniz okuyun."
  );
}

/** The sentence for a lead passage in which the wanted shape WAS found. */
export function answerShapeFoundTr(kind: AnswerShapeKind, matched: string): string {
  return (
    `Öne çıkan alıntıda sorunun beklediği biçimde bir ${ANSWER_SHAPE_LABEL_TR[kind]} var: “${matched}”. ` +
    "Bu yalnız bir biçim denetimidir; alıntının soruyu cevapladığını kendiniz okuyarak doğrulayın."
  );
}

/** The sentence for an answer whose question asks for no recognised shape. */
export const ANSWER_SHAPE_NOT_CHECKED_TR =
  "Soru belirli bir cevap biçimi (tarih, tutar, süre, kişi, mahkeme) sormuyor; öne çıkan " +
  "alıntının soruyu karşıladığı ayrıca denetlenmedi.";

export interface WantedShapeAssessment {
  wanted: WantedAnswerShape;
  /** The question phrase that decided it (normalized), absent for NONE. */
  marker?: string;
}

export interface PassageShapeAssessment {
  wanted: WantedAnswerShape;
  /** A value of the wanted shape stands in a sentence with the question's core words. */
  found: boolean;
  /** The passage is a heading, a label-only line or a list of names. */
  headingLike: boolean;
  /** Code-point span of that sentence within the passage (only when found). */
  sentence?: { start: number; end: number };
  /** The value as written (only when found). */
  matched?: string;
}

// ---------------------------------------------------------------------------
// The question side
// ---------------------------------------------------------------------------

/** The interrogative sentences of a question, or the whole text when none. */
export function askedPart(question: string): string {
  const sentences = question
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
  const asked = sentences.filter((sentence) => sentence.includes("?"));
  return asked.length > 0 ? asked.join(" ") : question;
}

const MONEY_NOUNS = String.raw`(?:ücret|maaş|bedel|tutar|miktar|fiyat|harç|harc|kira|tazminat|alacak|alacağ|borç|borc|prim|masraf|avans|nafaka|faiz)`;

/**
 * Ordered rules, most specific first. Every pattern runs over the
 * normalizeTurkishSearch form (tr-TR lowercase, whitespace collapsed).
 */
const WANTED_RULES: ReadonlyArray<readonly [AnswerShapeKind, RegExp]> = [
  ["COURT", /(?<![\p{L}])hangi\s+(?:mahkeme|daire|yargı\s+yer|merci)/u],
  ["COURT", /(?<![\p{L}])(?:görevli|yetkili)\s+(?:mahkeme|daire|yargı\s+yer)\p{L}*\s+(?:hangi|nere|ne(?![\p{L}])|nedir)/u],
  ["COURT", /mahkeme\p{L}*\s+(?:hangisi|hangisidir|neresi|neresidir)/u],
  ["DATE", /(?<![\p{L}])ne\s+zaman/u],
  ["DATE", /(?<![\p{L}])hangi\s+(?:tarih|gün|yıl|ay(?![\p{L}])|sene)/u],
  ["DATE", /(?<![\p{L}])kaç\s+yılında/u],
  ["DATE", /(?<![\p{L}])tarih(?:i|leri|ini)?\s+(?:nedir|ne(?![\p{L}])|neydi|nelerdir|hangisi|hangisidir|kaçtır)/u],
  ["DURATION", /(?<![\p{L}])ne\s+kadar\s+(?:süre|zaman|gün|ay(?![\p{L}])|yıl|hapis)/u],
  ["DURATION", /(?<![\p{L}])kaç\s+(?:gün|hafta|ay(?![\p{L}])|yıl|sene|saat|dakika)/u],
  ["DURATION", /süre(?:si|leri)?\s+(?:nedir|ne\s+kadar|kaç|neydi)/u],
  ["AMOUNT", new RegExp(String.raw`(?<![\p{L}])kaç\s+(?:tl|lira|türk\s+lirası|euro|avro|dolar|usd|eur)`, "u")],
  ["AMOUNT", new RegExp(String.raw`${MONEY_NOUNS}\p{L}*\s+(?:ne\s+kadar|kaç)`, "u")],
  ["AMOUNT", /(?:ücret|maaş|bedel|tutar|miktar|fiyat|harç)\p{L}*\s+(?:nedir|neydi|nelerdir|ne(?![\p{L}]))/u],
  ["QUANTITY", /(?<![\p{L}])(?:kaç|kaçtır|kaçıncı)(?![\p{L}])/u],
  ["QUANTITY", /(?<![\p{L}])ne\s+kadar/u],
  ["QUANTITY", /(?<![\p{L}])yüzde\s+kaç/u],
  ["QUANTITY", /oran\p{L}*\s+(?:nedir|ne(?![\p{L}])|neydi)/u],
  ["QUANTITY", /ceza\p{L}*\s+(?:nedir|ne\s+kadar|kaç)/u],
  ["PERSON", /(?<![\p{L}])(?:kim|kimdir|kimdi|kimin|kime|kimi|kimler|kimlerdir|kimlere|kimlerin)(?![\p{L}])/u],
  ["PERSON", /(?<![\p{L}])hangi\s+taraf/u],
];

/**
 * The shape an answer to `question` must carry. Deterministic; NONE when no
 * rule fires (definitional and application questions: "nedir", "mümkün mü").
 */
export function classifyWantedShape(question: string): WantedShapeAssessment {
  const asked = normalizeTurkishSearch(askedPart(question));
  for (const [kind, pattern] of WANTED_RULES) {
    const match = asked.match(pattern);
    if (match !== null) return { wanted: kind, marker: match[0] };
  }
  return { wanted: "NONE" };
}

// ---------------------------------------------------------------------------
// The passage side
// ---------------------------------------------------------------------------

/** One value of some shape, as a UTF-16 span of the passage. */
interface ShapeSpan {
  at: number;
  length: number;
}

const NUMBER_WORD = String.raw`(?:bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan|yüz|bin|milyon)`;
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?|${NUMBER_WORD}+)`;
const TIME_UNIT = String.raw`(?:(?:gün|hafta|yıl|sene|saat|dakika)\p{L}*|ay(?:lık|dan|da|a|ı|ın|ını|lar\p{L}*)?(?![\p{L}]))`;

/** "iki yıl", "7 gün", "on beş günlük", "altı ay"; also "müebbet". Folded text. */
const DURATION_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?!(?:19|20)\d{2}\s+yıl)${NUMBER}(?:\s+${NUMBER_WORD}+)*\s+${TIME_UNIT}|(?:ağırlaştırılmış\s+)?müebbet)`,
  "gu",
);

/** A count with a counting noun: "3 adet", "iki kez", "12 işçi". Folded text. */
const COUNT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${NUMBER}\s+(?:adet|kişi|kez|defa|tane|kat|parsel|işçi|kalem|sayfa)(?![\p{L}])|(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?\s*(?:m2|m²|metrekare|km|kg|ton)(?![\p{L}])`,
  "gu",
);

/** "2018 yılında", "2018'de", "2018 tarihinde". Folded text. */
const YEAR_RE = /(?<![\p{N}./-])(?:19|20)\d{2}(?:\s+yıl\p{L}*|['’][dt][ae]\p{L}*|\s+tarihinde)/gu;

/** "Mart 2019". Folded text (LONG_DATE in observations needs a day). */
const MONTH_YEAR_RE =
  /(?<![\p{L}])(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\p{L}*\s+(?:19|20)\d{2}(?![\p{N}])/gu;

/**
 * A time given relative to an event: "tebliğden itibaren iki hafta içinde",
 * "ayın sonunda". A norm answers "ne zaman" in these words, not with a date.
 */
const RELATIVE_TIME_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${NUMBER}(?:\s+${NUMBER_WORD}+)*\s+${TIME_UNIT}\s+(?:içinde|içerisinde|zarfında|önce|sonra|itibaren|geçmekle|dolmadan|sonunda)|(?:ayın|yılın|haftanın)\s+(?:başında|sonunda|ilk|son|\d+)|(?:tarihinden|tarihten|gününden|günden|tebliğinden|tebliğden|tefhiminden)\s+itibaren`,
  "gu",
);

/** What follows the date that names a law: "… tarihli ve 5237 sayılı". Original text. */
const LAW_NAMING_DATE_AFTER = /^\s*tarihli\s+ve\s+\d+\s+sayılı/iu;

/** Court and chamber names. Folded text. */
const COURT_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:yargıtay|danıştay|sayıştay|anayasa\s+mahkeme\p{L}*|uyuşmazlık\s+mahkeme\p{L}*|(?:bölge\s+adliye|bölge\s+idare|iş|asliye\s+hukuk|asliye\s+ceza|asliye\s+ticaret|asliye|sulh\s+hukuk|sulh\s+ceza|ağır\s+ceza|ticaret|tüketici|aile|icra\s+hukuk|icra\s+ceza|icra|idare|vergi|kadastro|çocuk|fikri\s+ve\s+sınai\s+haklar(?:\s+hukuk|\s+ceza)?)\s+mahkeme\p{L}*|(?:hukuk|ceza)\s+genel\s+kurul\p{L}*|\d+\s*\.\s*(?:hukuk|ceza|idari\s+dava)?\s*daire\p{L}*|hakem\s+heyet\p{L}*)`,
  "gu",
);

/** Party and role nouns: a "kim" question may be answered by one. Folded text. */
const ROLE_NOUNS: readonly string[] = [
  "davacı", "davalı", "sanık", "şüpheli", "müşteki", "mağdur", "katılan", "tanık",
  "bilirkişi", "işçi", "işveren", "kiracı", "kiraya veren", "alacaklı", "borçlu",
  "vekil", "avukat", "hâkim", "hakim", "savcı", "yüklenici", "iş sahibi", "satıcı",
  "alıcı", "sigortacı", "sigortalı", "kefil", "mirasçı", "varis", "vasi", "veli",
  "arabulucu", "noter", "icra müdürü",
];

/**
 * Words that start with a capital letter in a legal text without being a
 * person's name: institutions, headings, labels, months. Compared in
 * foldTurkishCase form. A CLOSED list.
 */
const NOT_A_NAME: ReadonlySet<string> = new Set([
  "kanun", "kanunu", "kanunun", "türk", "türkiye", "cumhuriyeti", "ceza", "hukuk", "borçlar",
  "medeni", "ticaret", "iş", "işe", "sosyal", "güvenlik", "kurumu", "kurum", "bakanlığı",
  "başkanlığı", "müdürlüğü", "mahkeme", "mahkemesi", "mahkemeleri", "yargıtay", "danıştay",
  "daire", "dairesi", "genel", "kurul", "kurulu", "anayasa", "bölge", "adliye", "idare",
  "asliye", "sulh", "icra", "iflas", "noter", "noterliği", "esas", "karar", "kararı", "madde",
  "maddesi", "sayılı", "tutanak", "tutanağı", "beyan", "rapor", "raporu", "bilirkişi",
  "dilekçe", "dilekçesi", "dava", "davası", "davacı", "davalı", "vekili", "vekil", "tanık",
  "tanığı", "tanıklar", "konu", "konusu", "tarih", "tarihi", "sgk", "tl", "sayın", "ek",
  "ekler", "açıklamalar", "sonuç", "istem", "hüküm", "gerekçe", "özet", "celse", "duruşma",
  "taraflar", "deliller", "hukuki", "hukukî", "sebepler", "giriş", "çıkış", "net", "brüt",
  "ücret", "ücreti", "adres", "adresi", "kimlik", "no", "dosya", "hizmet", "döküm", "dökümü",
  "sözleşme", "sözleşmesi", "kira", "ocak", "şubat", "mart", "nisan", "mayıs", "haziran",
  "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık", "ve", "ile", "a.ş", "ltd", "şti",
  "anonim", "limited", "şirketi", "şirket", "banka", "bankası", "belediye", "belediyesi",
  "valiliği", "savcılığı", "cumhuriyet", "başsavcılığı", "fakültesi", "üniversitesi",
  "hastanesi", "tapu", "müdürü", "sanık", "müşteki", "mağdur", "katılan", "şüpheli",
  "işçi", "işveren", "kiracı", "alacaklı", "borçlu", "bedel", "bedeli", "tutarı", "miktar",
  "miktarı", "süre", "süresi", "gün", "yıl", "ay", "hafta",
]);

const TITLE_WORD = String.raw`\p{Lu}[\p{Ll}\p{M}]+`;
const CAPS_WORD = String.raw`\p{Lu}[\p{Lu}\p{M}]+`;
const NAME_WORD = String.raw`(?:${TITLE_WORD}|${CAPS_WORD})`;
/**
 * Two name-like words on one line, or an honorific and one. Original text.
 * The second word sits in a lookahead so the pairs overlap: "Davacı Ahmet
 * Yılmaz" yields "Davacı Ahmet" (refused: a role) AND "Ahmet Yılmaz".
 */
const NAME_PAIR_RE = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(${NAME_WORD})(?=([ \t]+)(${NAME_WORD})(?![\p{L}\p{M}]))`,
  "gu",
);
const HONORIFIC_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:Av|Dr|Prof|Doç|Sn|Sayın|Bay|Bayan)\.?[ \t]+(${NAME_WORD})(?![\p{L}\p{M}])`,
  "gu",
);

function allMatches(re: RegExp, text: string): ShapeSpan[] {
  const out: ShapeSpan[] = [];
  for (const match of text.matchAll(re)) out.push({ at: match.index ?? 0, length: match[0].length });
  return out;
}

/**
 * The passage in lower case with every index kept: foldTurkishCase maps
 * İ→i and I→ı first, so the Turkish letters fold correctly. A text whose
 * fold changes length (a rare special casing) is matched as written.
 */
function foldedView(text: string): string {
  const folded = foldTurkishCase(text);
  return folded.length === text.length ? folded : text;
}

function personSpans(text: string, question: string): ShapeSpan[] {
  const out: ShapeSpan[] = [];
  for (const match of text.matchAll(NAME_PAIR_RE)) {
    const first = foldTurkishCase(match[1] ?? "");
    const second = foldTurkishCase(match[3] ?? "");
    if (NOT_A_NAME.has(first) || NOT_A_NAME.has(second)) continue;
    const length = (match[1] ?? "").length + (match[2] ?? "").length + (match[3] ?? "").length;
    out.push({ at: match.index ?? 0, length });
  }
  for (const match of text.matchAll(HONORIFIC_RE)) {
    if (NOT_A_NAME.has(foldTurkishCase(match[1] ?? ""))) continue;
    out.push({ at: match.index ?? 0, length: match[0].length });
  }
  // A role noun answers "kim" only when the question names no role itself:
  // "Kim sorumludur?" may be answered by "işveren", but "Davacı vekili
  // kimdir?" asks for the NAME of someone the question already identified,
  // and no role word (not even "tanık") answers it.
  const asked = foldTurkishCase(askedPart(question));
  if (ROLE_NOUNS.some((role) => new RegExp(String.raw`(?<![\p{L}])${role}`, "u").test(asked))) return out;
  const folded = foldedView(text);
  for (const role of ROLE_NOUNS) {
    const re = new RegExp(String.raw`(?<![\p{L}])${role.replace(/\s+/gu, String.raw`\s+`)}\p{L}*`, "gu");
    out.push(...allMatches(re, folded));
  }
  return out;
}

/** Every span of `kind` in the passage, in text order. */
function shapeSpans(kind: AnswerShapeKind, text: string, question: string): ShapeSpan[] {
  const folded = foldedView(text);
  const values = recognisedValueSpans(text);
  const normalizedQuestion = normalizeTurkishSearch(question);
  const asksDecision = /(?<![\p{L}])(?:karar|hüküm|hükm)/u.test(normalizedQuestion);
  const asksLawDate = /(?<![\p{L}])sayılı/u.test(normalizedQuestion);
  let spans: ShapeSpan[];
  switch (kind) {
    case "DATE":
      spans = [
        // A date beside a court or a decision number is that decision's date
        // (the matter analysis' own rule): it answers "when was it decided",
        // never "when did the davacı start work". Likewise "26/9/2004
        // tarihli ve 5237 sayılı" is the date that NAMES a law, not the date
        // anything in the question happened or entered into force.
        ...values.filter(
          (v) =>
            v.kind === "date" &&
            (asksDecision || v.decisionDate !== true) &&
            (asksLawDate || !LAW_NAMING_DATE_AFTER.test(text.slice(v.at + v.length, v.at + v.length + 40))),
        ),
        ...allMatches(YEAR_RE, folded),
        ...allMatches(MONTH_YEAR_RE, folded),
        ...allMatches(RELATIVE_TIME_RE, folded),
      ];
      break;
    case "AMOUNT":
      spans = values.filter((v) => v.kind === "amount");
      break;
    case "DURATION":
      spans = allMatches(DURATION_RE, folded);
      break;
    case "QUANTITY":
      spans = [
        ...values.filter((v) => v.kind === "amount" || v.kind === "ratio"),
        ...allMatches(DURATION_RE, folded),
        ...allMatches(COUNT_RE, folded),
      ];
      break;
    case "PERSON":
      spans = personSpans(text, question);
      break;
    case "COURT":
      spans = allMatches(COURT_RE, folded);
      break;
  }
  return spans
    .map((span) => ({ at: span.at, length: span.length }))
    .sort((a, b) => a.at - b.at || b.length - a.length);
}

/**
 * Party roles (the review grid's list): they say WHOSE fact is asked, and a
 * passage need not repeat them to answer — they are not core words.
 */
const ROLE_WORD_KEYS: ReadonlySet<string> = keysOf([
  "davacı", "davalı", "müvekkil", "vekil", "sanık", "şüpheli", "katılan", "alacaklı", "borçlu",
]);

/** Words that NAME the shape asked for ("işe giriş TARİHİ nedir?"): not core words. */
const FRAME_WORD_KEYS: Readonly<Record<AnswerShapeKind, ReadonlySet<string>>> = {
  DATE: keysOf(["tarih", "tarihi", "zaman", "gün", "yıl", "yılında", "sene"]),
  AMOUNT: keysOf(["tutar", "tutarı", "miktar", "miktarı", "meblağ", "para", "lira", "kadardı", "kadardır"]),
  DURATION: keysOf(["süre", "süresi", "gün", "hafta", "yıl", "sene", "saat", "kadardı", "kadardır"]),
  QUANTITY: keysOf(["tutar", "tutarı", "miktar", "miktarı", "oran", "oranı", "sayı", "sayısı", "adet", "kadardı", "kadardır"]),
  PERSON: keysOf(["kişi", "kişiler", "isim", "ismi", "adı", "taraf", "tarafı"]),
  COURT: keysOf(["mahkeme", "mahkemesi", "daire", "dairesi", "yargı", "merci"]),
};

function keysOf(words: readonly string[]): ReadonlySet<string> {
  return new Set(words.map(topicWordKey).filter((key): key is string => key !== undefined));
}

/**
 * Heading, label-only line or list of names: the passage names its subject
 * without saying anything about it.
 *
 *  - short (≤ 60 code points) and not ending a sentence;
 *  - at most 300 code points and at least 60 % of its words in CAPITALS
 *    ("TANIK BEYAN TUTANAĞI — DAVACI … İŞE GİRİŞ");
 *  - at most 300 code points and at least 70 % of its words starting with a
 *    capital (a list of names: "Tanıklar: Ahmet Yılmaz, Mehmet Kaya");
 *  - at most 200 code points and every line an "ETİKET : kısa değer" pair.
 *
 * A normal Turkish sentence — even one that opens with a capitalised name —
 * fails every test. Deterministic; the thresholds are documented constants,
 * not tuned on any gold row.
 */
export function isHeadingLike(passage: string): boolean {
  const text = passage.trim();
  const length = cpLength(text);
  if (length === 0) return true;
  if (length > 300) return false;
  const words = text.match(/[\p{L}\p{M}]+/gu) ?? [];
  if (words.length === 0) return true;
  if (length <= 60 && !/[.!?…;]["”’)]?$/u.test(text)) return true;
  const letters = words.filter((word) => cpLength(word) >= 2);
  const caps = letters.filter((word) => word === word.toLocaleUpperCase("tr-TR") && word !== word.toLocaleLowerCase("tr-TR"));
  if (letters.length >= 2 && caps.length / letters.length >= 0.6) return true;
  const capitalised = words.filter((word) => /^\p{Lu}/u.test(word));
  if (words.length >= 3 && capitalised.length / words.length >= 0.7) return true;
  if (length <= 200) {
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
    if (lines.length > 0 && lines.every((line) => /^[^:\n]{1,40}:\s*\S.{0,59}$/u.test(line) && !/[.!?]$/u.test(line))) {
      return true;
    }
  }
  return false;
}

function codePointOffset(text: string, utf16Index: number): number {
  return cpLength(text.slice(0, utf16Index));
}

/** A value of the wanted shape and the sentence (UTF-16) it stands in. */
interface AnsweringValue {
  span: ShapeSpan;
  sentence: { start: number; end: number };
}

/**
 * Every value of the wanted shape that stands in a sentence carrying the
 * question's core words — one per sentence, in text order.
 */
function answeringValues(question: string, passage: string, wanted: AnswerShapeKind): AnsweringValue[] {
  const spans = shapeSpans(wanted, passage, question);
  if (spans.length === 0) return [];

  // One sentence per distinct span, measured once.
  const sentences: Array<{ start: number; end: number; span: ShapeSpan }> = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const sentence = sentenceSpanAround(passage, span.at, span.length);
    const key = `${sentence.start}:${sentence.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sentences.push({ ...sentence, span });
  }

  const asked = askedPart(question);
  const map = mapPassageCoverage(
    asked,
    sentences.map((sentence) => passage.slice(sentence.start, sentence.end)),
  );
  const frame = FRAME_WORD_KEYS[wanted];
  const core = map.lexemes
    .map((word, index) => ({ key: topicWordKey(word), index }))
    .filter(({ key }) => key === undefined || (!ROLE_WORD_KEYS.has(key) && !frame.has(key)))
    .map(({ index }) => index);
  // At least ONE core word. Half of them was tried and rejected: a statute's
  // fıkra does not repeat the offence named in its heading ("Hileli
  // davranışlarla … bir yıldan beş yıla kadar hapis" never says
  // "dolandırıcılık"), so the very article asked about lost its place to a
  // neighbouring article that happened to repeat more of the question. A
  // question made only of role and frame words ("Davacı vekili kimdir?") has
  // no core: then every one of its words must stand in the sentence.
  const pool = core.length > 0 ? core : map.lexemes.map((_, index) => index);
  const needed = core.length > 0 ? 1 : pool.length;

  const out: AnsweringValue[] = [];
  sentences.forEach((sentence, at) => {
    const covered = new Set(map.covered[at] ?? []);
    const hits = pool.filter((index) => covered.has(index)).length;
    if (hits >= needed) out.push({ span: sentence.span, sentence: { start: sentence.start, end: sentence.end } });
  });
  return out;
}

/**
 * Does `passage` carry a value of the wanted shape in a sentence with the
 * question's core words? `wanted` defaults to classifyWantedShape(question).
 */
export function assessPassageShape(
  question: string,
  passage: string,
  wanted: WantedAnswerShape = classifyWantedShape(question).wanted,
): PassageShapeAssessment {
  const headingLike = isHeadingLike(passage);
  if (wanted === "NONE") return { wanted, found: false, headingLike };
  const first = answeringValues(question, passage, wanted)[0];
  if (first === undefined) return { wanted, found: false, headingLike };
  return {
    wanted,
    found: true,
    headingLike,
    sentence: {
      start: codePointOffset(passage, first.sentence.start),
      end: codePointOffset(passage, first.sentence.end),
    },
    matched: passage.slice(first.span.at, first.span.at + first.span.length).trim(),
  };
}

/**
 * Code-point positions (within `text`) of the values that would make
 * assessPassageShape say `found` — a value of the wanted shape in a sentence
 * with the question's core words. The quote-window chooser keeps one inside
 * a long passage's window. Empty for NONE.
 */
export function answerShapeAnchors(question: string, text: string): number[] {
  const wanted = classifyWantedShape(question).wanted;
  if (wanted === "NONE") return [];
  return answeringValues(question, text, wanted).map((value) => codePointOffset(text, value.span.at));
}
