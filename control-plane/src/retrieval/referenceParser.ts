/**
 * Exact Turkish legal reference parser (Master Build Brief section 8.4).
 *
 * This is a byte-for-byte port of `legal_reference/parser.py`. The two
 * implementations are pinned against ONE shared corpus,
 * `evals/fixtures/reference_parity.json`, which is validated by
 * `control-plane/tests/parser-parity.test.ts` and
 * `tests/contracts/test_parser_parity.py`; drift breaks CI in both languages.
 *
 * What it extracts
 * ----------------
 *  - legislation:    "5237 sayılı Türk Ceza Kanunu", "6098 s. TBK",
 *                    KHK/CBK, and BARE ABBREVIATIONS ("TCK m. 157",
 *                    "İİK'nun 89 uncu maddesi", "Anayasa'nın 36'ncı maddesi")
 *                    resolved through {@link LAW_ABBREVIATIONS};
 *  - article:        prefix ("m. 157", "md. 10/A", "m.6/1-a") and suffix
 *                    ("157. madde", "157 nci maddesi", "6/A maddesi",
 *                    "91/1. maddesi") forms, ek/geçici articles, with fıkra
 *                    (`paragraph`, incl. Roman "25/II") and bent (`clause`);
 *  - court_decision: E./K. prefix and suffix styles, Yargıtay HGK/CGK
 *                    hyphenated dockets ("2017/9-1234 E."), AYM bireysel
 *                    başvuru ("B. No: 2019/12345"), plus the deciding
 *                    COURT/CHAMBER so an E./K. pair is no longer ambiguous
 *                    across chambers;
 *  - official_gazette: "26/9/2004 tarihli ve 25611 sayılı Resmî Gazete".
 *
 * False positives it refuses (each one a real defect this port fixes)
 * ------------------------------------------------------------------
 *  - "K. 2021/5678 sayılı kararı"      -> a DECISION, never legislation 5678;
 *  - "25611 sayılı Resmî Gazete"       -> a gazette issue, never a law number;
 *  - "madde 25/II"                     -> article 25 + fıkra II (not "25/I");
 *  - "5237 sayılı Türk Ceza Kanunu"    -> the WHOLE name, not "T" (the old
 *                                         `[^,.;]` capture stopped at the
 *                                         first non-ASCII letter);
 *  - "E. 9999/1, K. 8888/2"            -> implausible year, rejected;
 *  - "100 m. yükseklikte"              -> metres, never madde;
 *  - "adam. 3", "M. Kemal", "3 madde"  -> glued token / initials / bare count.
 *
 * PORTABILITY: no `\b`, `\w` or `\d` appears in any pattern. Those classes
 * mean different things in JavaScript (ASCII-only) and Python
 * (Unicode-aware) — "ı" is a word character for one and not the other —
 * which is precisely how the two parsers drifted apart. Explicit classes
 * ({@link WORD_CHARS}) and `[0-9]` keep them identical.
 *
 * Matching strategy: the input is NFC-normalized once, then
 * {@link shadowFold} produces a LENGTH-PRESERVING lowercase shadow copy. All
 * regexes run on the shadow; captured spans index back into the NFC text, so
 * `raw`/`name`/`articleNo` keep their original casing.
 *
 * Offsets: `span` holds JavaScript string indices (UTF-16 code units). For
 * BMP-only text — which every Turkish legal citation is — these are identical
 * to the Unicode code point indices Python reports; the parity fixture
 * asserts its corpus is BMP-only so the two never disagree.
 */

import { shadowFold } from "./normalize.js";

export interface ParsedReference {
  /**
   * `short_form` (W14/B-38) is a Turkish ANAPHORIC citation — "anılan karar",
   * "aynı yönde", "agk.", "aynı Kanunun 344 üncü maddesi", or a bare article
   * number repeated later in the same text. Its identity fields carry the
   * RESOLVED target when the context supplies one, and are all absent when it
   * cannot be resolved. An unresolved short form is the "belirsiz" bucket and
   * must never be rendered as a full citation
   * ({@link isUnresolvedShortForm}).
   */
  kind: "legislation" | "article" | "court_decision" | "official_gazette" | "short_form";
  raw: string;
  legislationNo?: string;
  articleNo?: string;
  docketNo?: string;
  decisionNo?: string;
  year?: number;
  /** Legislation name exactly as written in the text. */
  name?: string;
  /** "madde" | "ek" | "geçici" */
  articleKind?: string;
  /** Fıkra: "1" or a Roman "II". */
  paragraph?: string;
  /** Bent: "a". */
  clause?: string;
  /** Canonical abbreviation key that produced `legislationNo` ("TCK"). */
  abbreviation?: string;
  /** Canonical law name for the recognized abbreviation/number. */
  canonicalName?: string;
  /** True when the referenced instrument is repealed (mülga). */
  mulga?: boolean;
  /** "YARGITAY" | "DANISTAY" | "AYM" | "BAM" | "BIM" | "UYUSMAZLIK" | "SAYISTAY" */
  court?: string;
  /** "9. HD" | "HGK" | "10. D" | "1. BOLUM" ... */
  chamber?: string;
  /** "esas" | "basvuru" */
  docketKind?: string;
  /** Decision date as written ("12.05.2022"). */
  decisionDate?: string;
  /** Official gazette date as written. */
  rgDate?: string;
  /** Official gazette issue number. */
  rgNo?: string;
  /** [start, end) into the NFC text. */
  span?: [number, number];
}

// ---------------------------------------------------------------------------
// Abbreviation table (mirror of legal_reference/abbreviations.py)
// ---------------------------------------------------------------------------

export interface LawAbbreviation {
  key: string;
  legislationNo: string;
  canonicalName: string;
  mulga: boolean;
  variants: readonly string[];
  /** Extra regex assertion appended after a variant to kill a false positive. */
  guard?: string;
}

/**
 * NOTE ON OMISSIONS: "BK" (Borçlar Kanunu) is deliberately NOT a variant —
 * "bk." is also the Turkish abbreviation for "bakınız" (= "see"), which would
 * turn every cross-reference into a bogus legislation hit. Only the explicit
 * "eBK" / "eski BK" forms are accepted.
 */
export const LAW_ABBREVIATIONS: readonly LawAbbreviation[] = [
  { key: "TCK", legislationNo: "5237", canonicalName: "Türk Ceza Kanunu", mulga: false, variants: ["TCK"] },
  { key: "ETCK", legislationNo: "765", canonicalName: "Türk Ceza Kanunu (765 sayılı)", mulga: true, variants: ["ETCK", "eTCK", "eski TCK", "mülga TCK"] },
  { key: "CMK", legislationNo: "5271", canonicalName: "Ceza Muhakemesi Kanunu", mulga: false, variants: ["CMK"] },
  { key: "CMUK", legislationNo: "1412", canonicalName: "Ceza Muhakemeleri Usulü Kanunu", mulga: true, variants: ["CMUK"] },
  { key: "TBK", legislationNo: "6098", canonicalName: "Türk Borçlar Kanunu", mulga: false, variants: ["TBK"] },
  { key: "EBK", legislationNo: "818", canonicalName: "Borçlar Kanunu (818 sayılı)", mulga: true, variants: ["eBK", "eski BK", "mülga BK"] },
  { key: "TMK", legislationNo: "4721", canonicalName: "Türk Medenî Kanunu", mulga: false, variants: ["TMK", "MK"] },
  { key: "HMK", legislationNo: "6100", canonicalName: "Hukuk Muhakemeleri Kanunu", mulga: false, variants: ["HMK"] },
  { key: "HUMK", legislationNo: "1086", canonicalName: "Hukuk Usulü Muhakemeleri Kanunu", mulga: true, variants: ["HUMK"] },
  { key: "İİK", legislationNo: "2004", canonicalName: "İcra ve İflas Kanunu", mulga: false, variants: ["İİK", "IIK", "İIK", "IİK"] },
  { key: "TTK", legislationNo: "6102", canonicalName: "Türk Ticaret Kanunu", mulga: false, variants: ["TTK"] },
  { key: "ETTK", legislationNo: "6762", canonicalName: "Türk Ticaret Kanunu (6762 sayılı)", mulga: true, variants: ["ETTK", "eTTK", "eski TTK"] },
  { key: "VUK", legislationNo: "213", canonicalName: "Vergi Usul Kanunu", mulga: false, variants: ["VUK"] },
  { key: "İYUK", legislationNo: "2577", canonicalName: "İdari Yargılama Usulü Kanunu", mulga: false, variants: ["İYUK", "IYUK"] },
  { key: "KVKK", legislationNo: "6698", canonicalName: "Kişisel Verilerin Korunması Kanunu", mulga: false, variants: ["KVKK"] },
  { key: "İŞK", legislationNo: "4857", canonicalName: "İş Kanunu", mulga: false, variants: ["İş K.", "İş Kanunu", "İşK"] },
  {
    key: "ANAYASA",
    legislationNo: "2709",
    canonicalName: "Türkiye Cumhuriyeti Anayasası",
    mulga: false,
    variants: ["Anayasa"],
    guard: "(?!\\s*(?:mahkeme|mahkemesi|mahkemesinin|mahkemesince))",
  },
  { key: "AATUHK", legislationNo: "6183", canonicalName: "Amme Alacaklarının Tahsil Usulü Hakkında Kanun", mulga: false, variants: ["AATUHK"] },
  { key: "KDVK", legislationNo: "3065", canonicalName: "Katma Değer Vergisi Kanunu", mulga: false, variants: ["KDVK", "KDV Kanunu"] },
  { key: "GVK", legislationNo: "193", canonicalName: "Gelir Vergisi Kanunu", mulga: false, variants: ["GVK"] },
  { key: "KVK", legislationNo: "5520", canonicalName: "Kurumlar Vergisi Kanunu", mulga: false, variants: ["KVK"] },
  { key: "SSGSSK", legislationNo: "5510", canonicalName: "Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu", mulga: false, variants: ["SSGSSK", "SGK Kanunu"] },
  { key: "İMARK", legislationNo: "3194", canonicalName: "İmar Kanunu", mulga: false, variants: ["İmar Kanunu", "İmar K."] },
  { key: "TKHK", legislationNo: "6502", canonicalName: "Tüketicinin Korunması Hakkında Kanun", mulga: false, variants: ["TKHK"] },
  { key: "FSEK", legislationNo: "5846", canonicalName: "Fikir ve Sanat Eserleri Kanunu", mulga: false, variants: ["FSEK"] },
  { key: "SERPK", legislationNo: "6362", canonicalName: "Sermaye Piyasası Kanunu", mulga: false, variants: ["SerPK", "SPKn"] },
  { key: "KABK", legislationNo: "5326", canonicalName: "Kabahatler Kanunu", mulga: false, variants: ["Kabahatler Kanunu", "KabK"] },
  { key: "CGTİHK", legislationNo: "5275", canonicalName: "Ceza ve Güvenlik Tedbirlerinin İnfazı Hakkında Kanun", mulga: false, variants: ["CGTİHK", "CGTIHK"] },
];

/**
 * Characters that must be backslash-escaped inside a regex. Deliberately a
 * FIXED set (not a general escaper) because JavaScript's unicode-mode regexes
 * reject useless escapes, and the Python implementation must build the exact
 * same pattern.
 */
const RE_SPECIAL = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

/** Regex source matching `text` verbatim on shadow-folded input. */
export function literalPattern(text: string): string {
  let out = "";
  for (const char of shadowFold(text)) {
    if (/\s/u.test(char)) out += "\\s+";
    else if (char === "i" || char === "ı") out += "[iı]";
    else if (RE_SPECIAL.has(char)) out += "\\" + char;
    else out += char;
  }
  return out;
}

/** Alternation of literals, longest first (deterministic order). */
function alternation(items: Iterable<string>): string {
  const unique = [...new Set(items)];
  unique.sort((a, b) => (a.length !== b.length ? b.length - a.length : a < b ? -1 : a > b ? 1 : 0));
  return unique.map(literalPattern).join("|");
}

const WS_RE = /\s+/gu;

function canonicalKey(written: string): string {
  const folded = shadowFold(written).split("'")[0] ?? "";
  return folded.replace(WS_RE, " ").trim().replace(/ı/gu, "i");
}

const BY_KEY = new Map<string, LawAbbreviation>();
for (const entry of LAW_ABBREVIATIONS) {
  for (const variant of entry.variants) {
    const key = canonicalKey(variant);
    if (!BY_KEY.has(key)) BY_KEY.set(key, entry);
  }
  const key = canonicalKey(entry.key);
  if (!BY_KEY.has(key)) BY_KEY.set(key, entry);
}

const BY_NUMBER = new Map<string, LawAbbreviation>(
  LAW_ABBREVIATIONS.map((entry) => [entry.legislationNo, entry] as const),
);

/** Look up the entry for a written abbreviation ("TCK'nın" -> TCK). */
export function lookupAbbreviation(written: string): LawAbbreviation | undefined {
  if (!written) return undefined;
  return BY_KEY.get(canonicalKey(written));
}

/** Look up the entry for an explicit legislation number. */
export function lookupByNumber(legislationNo: string | undefined): LawAbbreviation | undefined {
  if (!legislationNo) return undefined;
  const normalized = legislationNo.trim().replace(/^0+/u, "") || "0";
  return BY_NUMBER.get(normalized);
}

function abbreviationAlternation(): string {
  const items: Array<{ pattern: string; folded: string }> = [];
  for (const entry of LAW_ABBREVIATIONS) {
    for (const variant of entry.variants) {
      items.push({ pattern: literalPattern(variant) + (entry.guard ?? ""), folded: shadowFold(variant) });
    }
  }
  items.sort((a, b) =>
    a.folded.length !== b.folded.length
      ? b.folded.length - a.folded.length
      : a.folded < b.folded
        ? -1
        : a.folded > b.folded
          ? 1
          : 0,
  );
  return items.map((item) => item.pattern).join("|");
}

// ---------------------------------------------------------------------------
// Portable character classes
// ---------------------------------------------------------------------------

/** Word characters for Turkish legal text; used instead of `\w`/`\b`. */
export const WORD_CHARS = "0-9A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû_";
const NB = `(?<![${WORD_CHARS}])`;
const NA = `(?![${WORD_CHARS}])`;

const ORDINALS = "(?:ıncı|inci|uncu|üncü|ncı|nci|ncu|ncü)";

const ORDINAL_WORDS: Record<string, string> = {
  birinci: "1",
  ikinci: "2",
  üçüncü: "3",
  dördüncü: "4",
  beşinci: "5",
  altıncı: "6",
  yedinci: "7",
  sekizinci: "8",
  dokuzuncu: "9",
  onuncu: "10",
};
const ORDINAL_WORD_ALT = Object.keys(ORDINAL_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");

// ---------------------------------------------------------------------------
// Court / chamber vocabulary
// ---------------------------------------------------------------------------

const INSTITUTIONS: Record<string, string> = {
  yargıtay: "YARGITAY",
  danıştay: "DANISTAY",
  "anayasa mahkemesi": "AYM",
  aym: "AYM",
  "uyuşmazlık mahkemesi": "UYUSMAZLIK",
  sayıştay: "SAYISTAY",
  "bölge adliye mahkemesi": "BAM",
  "bölge idare mahkemesi": "BIM",
  bam: "BAM",
  bim: "BIM",
};

/**
 * Chamber words -> canonical code. Inflected forms are listed explicitly
 * rather than matched with a trailing `\w*` so that the generic "d" (Danıştay
 * "10. D") can never swallow the start of an unrelated word.
 */
const CHAMBER_WORDS: Record<string, string> = {
  "hukuk genel kurulunun": "HGK",
  "hukuk genel kurulu": "HGK",
  "ceza genel kurulunun": "CGK",
  "ceza genel kurulu": "CGK",
  "idari dava daireleri kurulunun": "IDDK",
  "idari dava daireleri kurulu": "IDDK",
  "vergi dava daireleri kurulunun": "VDDK",
  "vergi dava daireleri kurulu": "VDDK",
  "idari dava dairesinin": "IDD",
  "idari dava dairesi": "IDD",
  "hukuk dairesinin": "HD",
  "hukuk dairesi": "HD",
  "ceza dairesinin": "CD",
  "ceza dairesi": "CD",
  "genel kurulunun": "GENEL KURUL",
  "genel kurulu": "GENEL KURUL",
  "genel kurul": "GENEL KURUL",
  bölümünün: "BOLUM",
  bölümü: "BOLUM",
  bölüm: "BOLUM",
  hgk: "HGK",
  cgk: "CGK",
  iddk: "IDDK",
  vddk: "VDDK",
  hd: "HD",
  cd: "CD",
  idd: "IDD",
  dairesinin: "D",
  dairesince: "D",
  dairesi: "D",
  daire: "D",
  d: "D",
};

const CHAMBER_STANDALONE = [
  "hukuk genel kurulunun",
  "hukuk genel kurulu",
  "ceza genel kurulunun",
  "ceza genel kurulu",
  "idari dava daireleri kurulunun",
  "idari dava daireleri kurulu",
  "vergi dava daireleri kurulunun",
  "vergi dava daireleri kurulu",
  "hgk",
  "cgk",
  "iddk",
  "vddk",
];

const CHAMBER_NUMBERED = [
  "hukuk dairesinin",
  "hukuk dairesi",
  "ceza dairesinin",
  "ceza dairesi",
  "idari dava dairesinin",
  "idari dava dairesi",
  "hd",
  "cd",
  "idd",
];

const CHAMBER_IMPLIES: Record<string, string> = {
  HGK: "YARGITAY",
  CGK: "YARGITAY",
  IDDK: "DANISTAY",
  VDDK: "DANISTAY",
};

const CH_ORDINAL = `(?:(?<chno>[0-9]{1,2})\\s*\\.\\s*|(?<chord>${ORDINAL_WORD_ALT})\\s+)?`;

const COURT_RE = new RegExp(
  NB +
    "(?:" +
    `(?<inst>${alternation(Object.keys(INSTITUTIONS))})(?:'[a-zçğıöşü]{1,8})?` +
    `(?:\\s*,?\\s*${CH_ORDINAL}(?<chword>${alternation(Object.keys(CHAMBER_WORDS))})(?:'[a-zçğıöşü]{1,8})?)?` +
    `|(?<chword2>${alternation(CHAMBER_STANDALONE)})(?:'[a-zçğıöşü]{1,8})?` +
    `|(?<chno3>[0-9]{1,2})\\s*\\.\\s*(?<chword3>${alternation(CHAMBER_NUMBERED)})(?:'[a-zçğıöşü]{1,8})?` +
    ")" +
    NA,
  "gdu",
);

/** Text tolerated between a court mention and the docket it belongs to. */
const COURT_GAP_RE = new RegExp(
  "^(?:" +
    "[\\s,;:.'\"\\-]*" +
    "(?:(?:kararı|kararında|kararının|kararıyla|karar|ilamı|ilamında|ilam" +
    "|sayılı|tarihli|n[iıuü]n|[iıuü]n)[\\s,;:.'\"\\-]*){0,3}" +
    ")$",
  "u",
);

// ---------------------------------------------------------------------------
// Patterns (run on the lowered shadow text)
// ---------------------------------------------------------------------------

/** "26/9/2004 tarihli ve 25611 sayılı Resmî Gazete". */
export const RG_RE = new RegExp(
  "(?<date>[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4})\\s+tarihl[iı]\\s+ve\\s+" +
    "(?<no>[0-9]{4,6})\\s+(?:mükerrer\\s+)?sayılı\\s+(?:mükerrer\\s+)?" +
    "resm[iî]\\s+gazete",
  "gdu",
);

/**
 * Docket/decision payload. The optional "-NNN" tail is the Yargıtay HGK/CGK
 * form "2017/9-1234" (year / chamber - sequence).
 */
const DOCKET = "[0-9]{4}\\s*/\\s*[0-9]{1,6}(?:\\s*-\\s*[0-9]{1,6})?";

/** Optional "T. 12.05.2022" decision-date tail. */
const TDATE =
  `(?:\\s*[,;]?\\s*t(?:ar[iı]h[${WORD_CHARS}]*)?\\s*[.:]?\\s*` +
  "(?<tdate>[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}))?";

/** "E. 2021/123, K. 2022/456" and its spelled-out / compact variants. */
export const EK_RE = new RegExp(
  NB +
    `e(?:sas[${WORD_CHARS}]*)?(?:\\s*no)?\\s*[.:]?\\s*(?<docket>${DOCKET})` +
    "\\s*[,;-]?\\s*(?:ve\\s+)?" +
    `k(?:arar[${WORD_CHARS}]*)?(?:\\s*no)?\\s*[.:]?\\s*(?<decision>${DOCKET})` +
    TDATE,
  "gdu",
);

/** Suffix style: "2021/123 E., 2022/456 K.". */
export const EK_SUFFIX_RE = new RegExp(
  `(?<![0-9/.])(?<docket>${DOCKET})\\s*e(?:sas[${WORD_CHARS}]*)?\\.?` +
    "\\s*[,;-]?\\s*(?:ve\\s+)?" +
    `(?<decision>${DOCKET})\\s*k(?:arar[${WORD_CHARS}]*)?\\.?` +
    NA +
    TDATE,
  "gdu",
);

/** Yargıtay HGK/CGK style docket standing alone: "2017/9-1234 E.". */
const DOCKET_ONLY_RE = new RegExp(
  "(?<![0-9/.])(?<docket>[0-9]{4}\\s*/\\s*[0-9]{1,6}\\s*-\\s*[0-9]{1,6})" +
    `\\s*e(?:sas[${WORD_CHARS}]*)?\\.?` +
    NA,
  "gdu",
);

/** AYM bireysel başvuru: "B. No: 2019/12345". */
const BASVURU_RE = new RegExp(
  NB +
    "(?:b\\s*\\.\\s*|başvuru\\s+)(?:no|numarası|numaralı)\\s*[.:]?\\s*" +
    "(?<docket>[0-9]{4}\\s*/\\s*[0-9]{1,6})" +
    NA,
  "gdu",
);

const ABBREV_ALT = abbreviationAlternation();

/**
 * "<no> sayılı <name ending in a law-type word or a known abbreviation>".
 * The trailing law-type requirement is what keeps "2 sayılı liste",
 * "25611 sayılı Resmî Gazete" and "5678 sayılı kararı" out of the results.
 */
export const LAW_RE = new RegExp(
  "(?<![0-9/.])(?<no>[0-9]{1,5})\\s+(?:sayılı|s\\.)\\s+" +
    "(?!resm[iî]\\s+gazete)" +
    "(?<name>[^,.;:'\"\\n]*?" +
    `(?:kanun\\s+hükmünde\\s+kararname[${WORD_CHARS}]*` +
    `|cumhurbaşkanlığı\\s+kararnamesi[${WORD_CHARS}]*` +
    `|khk|kanun[${WORD_CHARS}]*` +
    `|(?:${ABBREV_ALT})))` +
    NA,
  "gdu",
);

const ABBREV_HEAD = NB + `(?<abbr>${ABBREV_ALT})(?<suffix>'[a-zçğıöşü]{1,8})?` + NA;

/** "ek madde 5", "geçici madde 2", "geçici 11 inci maddesi". */
const EK_GECICI_RE = new RegExp(
  NB +
    "(?<akind>ek|geçici)\\s+" +
    `(?:madde\\s*(?<n1>[0-9]{1,4})${NA}` +
    `|(?<n2>[0-9]{1,4})\\s*'?\\s*${ORDINALS}\\s+madde[${WORD_CHARS}]*)`,
  "gdu",
);

/**
 * The article payload shared by the suffix and prefix forms:
 *   157   -> art
 *   6/A   -> art + sub (letter)  => articleNo "6/A"
 *   91/1  -> art + sub (digits)  => articleNo "91", paragraph "1"
 *   25/II -> art + sub (roman)   => articleNo "25", paragraph "II"
 *   6/1-a -> art + sub + clause  => articleNo "6", paragraph "1", clause "a"
 *
 * NOTE: "II" folds to "ıı" (I -> dotless ı), so the Roman-numeral class must
 * accept BOTH dotted and dotless i.
 */
function articleToken(prefix: string): string {
  return (
    `(?<${prefix}art>[0-9]{1,4})` +
    `(?:\\s*/\\s*(?<${prefix}sub>[0-9]{1,3}|[iıvx]{1,4}|[a-zçğıöşü]))?` +
    `(?:\\s*-\\s*(?<${prefix}clause>[a-zçğıöşü]))?`
  );
}

/** Optional trailing fıkra: "... maddesinin birinci fıkrası", "... 1. fıkrası". */
function fikraTail(prefix: string): string {
  return (
    `(?:\\s*,?\\s*(?:(?<${prefix}fno>[0-9]{1,2})\\s*(?:\\.\\s*|'?\\s*${ORDINALS}\\s+)?` +
    `|(?<${prefix}fword>${ORDINAL_WORD_ALT})\\s+)fıkra[${WORD_CHARS}]*)?`
  );
}

/** "157. madde", "157 nci maddesi", "6/A maddesi", "91/1. maddesi". */
export const ARTICLE_SUFFIX_RE = new RegExp(
  `(?<![0-9/.])(?<![${WORD_CHARS}])` +
    articleToken("s") +
    `(?<ssep>\\s*\\.\\s*|\\s*'?\\s*${ORDINALS}\\s+|\\s+)` +
    `madde[${WORD_CHARS}]*` +
    fikraTail("s"),
  "gdu",
);

/**
 * "madde 157", "md. 157", "m. 157", "m. 6/A", "m.6/1-a".
 * Bare "m." must not be preceded by a number ("100 m." is a measurement) and
 * always requires a digit after it.
 */
export const ARTICLE_RE = new RegExp(
  `(?:${NB}madde|${NB}md\\.?|(?<![0-9])(?<![0-9]\\s)${NB}m\\.)\\s*` +
    articleToken("p") +
    NA +
    fikraTail("p"),
  "gdu",
);

/**
 * Bare abbreviation, optionally followed by a KEYWORD-LESS article number —
 * the shorthand lawyers actually type: "TBK 49", "İİK 89", "HMK 177",
 * "CMK 100", "TMK 706", "TTK 5/A", "VUK 359". The negative lookahead hands
 * "İİK 89 uncu maddesi" / "İYUK 7. madde" back to the article passes, which
 * know how to read the ordinal/fıkra tail.
 */
export const ABBREV_RE = new RegExp(
  ABBREV_HEAD +
    "(?:\\s+" +
    articleToken("a") +
    NA +
    `(?!\\s*(?:\\.\\s*|'?\\s*${ORDINALS}\\s+)?madde)` +
    fikraTail("a") +
    ")?",
  "gdu",
);

// ---------------------------------------------------------------------------
// Turkish short-form (anaphoric) citations — W14/B-38
// ---------------------------------------------------------------------------
//
// eyecite recognizes English short forms ("supra", "id.", "ibid.") as their own
// citation class. The Turkish equivalents are "anılan karar", "aynı yönde",
// "yukarıda anılan", "mezkûr", "söz konusu" and the abbreviation "agk."
// (anılan geçen karar), plus the plain repetition of an article number after
// the owning instrument was named once.
//
// A parser that ignores them makes the opposing-party citation audit SILENTLY
// incomplete, which is the worst failure mode this product has. They are
// therefore recognized as `short_form` references, resolved from context when
// the context supplies a target and left EXPLICITLY unresolved ("belirsiz")
// when it does not — never promoted to a full citation.
//
// This block mirrors the same block in legal_reference/parser.py;
// evals/fixtures/reference_parity.json pins the two together.

/** The additive reference kind for a Turkish anaphoric citation. */
export const SHORT_FORM_KIND = "short_form";

/**
 * "anılan karar", "aynı yöndeki karar", "mezkûr ilam", "agk." … The marker
 * itself is the reference: there is no number in the text to hang it on.
 */
const SHORTFORM_DECISION_RE = new RegExp(
  NB +
    "(?:" +
    "a\\s*\\.?\\s*g\\s*\\.?\\s*k\\s*\\." +
    `|(?:yukarıda\\s+)?anılan\\s+(?:karar|ilam|içtiha[td]|hüküm|hükm)[${WORD_CHARS}]*` +
    `|(?:mezkûr|mezkur|söz\\s+konusu)\\s+(?:karar|ilam|içtiha[td])[${WORD_CHARS}]*` +
    "|aynı\\s+(?:yönde|doğrultuda)(?:ki)?" +
    ")",
  "gdu",
);

/**
 * The anaphoric head that OWNS a following article number: "aynı Kanunun",
 * "anılan Kanun'un", "mezkûr Yönetmeliğin", "söz konusu Tebliğin". Anchored at
 * the END of the window immediately before the article reference.
 */
const SHORTFORM_ARTICLE_HEAD_RE = new RegExp(
  "(?:yukarıda\\s+anılan|anılan|aynı|mezkûr|mezkur|söz\\s+konusu)\\s+" +
    `(?:kanun|yasa|mevzuat|yönetmeli[kğ]|tüzü[kğ]|kararname|tebli[gğ]|genelge)[${WORD_CHARS}]*` +
    `['’]?[${WORD_CHARS}]*\\s*$`,
  "u",
);

/** How far back the anaphoric head is looked for, in code units. */
const SHORTFORM_WINDOW = 80;

/**
 * An article whose OWN instrument is restated right next to it is a FULL
 * citation, not a short form: "TCK m. 157" repeated fifty times is fifty
 * complete citations, however often it occurs. Only a possessive suffix,
 * punctuation and whitespace count as "restated next to it".
 */
const OWNED_GAP_RE = new RegExp(`^['\u2019]?[${WORD_CHARS}]*[\\s,;:.()\\-]*$`, "u");

/** Longest gap that still counts as ownership, in code units. */
const OWNED_GAP_MAX = 16;

/** Fields copied onto a short form that resolves to a LEGISLATION target. */
const LEGISLATION_CARRY = [
  "legislationNo",
  "name",
  "abbreviation",
  "canonicalName",
  "mulga",
] as const;

/** Fields copied onto a short form that resolves to a DECISION target. */
const DECISION_CARRY = [
  "docketNo",
  "decisionNo",
  "year",
  "court",
  "chamber",
  "docketKind",
] as const;

/**
 * True for a short form whose target could not be resolved ("belirsiz").
 * Such a reference must never be rendered as a full citation: it says a
 * citation is THERE, not which one.
 */
export function isUnresolvedShortForm(ref: ParsedReference): boolean {
  return (
    ref.kind === SHORT_FORM_KIND &&
    ref.legislationNo === undefined &&
    ref.docketNo === undefined
  );
}

const YEAR_MIN = 1900;
const YEAR_MAX = 2099;
/**
 * A "TCK 2005"-shaped number is a YEAR, not an article: bare article numbers
 * in that range are rejected (real article numbers reach at most ~1030, e.g.
 * TMK 1030).
 */
const ARTICLE_YEAR_MIN = 1900;
const ARTICLE_YEAR_MAX = 2099;
const ROMAN_RE = /^(?:I{1,3}|IV|V|VI{1,3}|IX|X|XI{1,2})$/u;

function squash(value: string): string {
  return value.replace(/\s+/gu, "");
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function validDocket(value: string): boolean {
  const year = Number.parseInt(value.split("/")[0] ?? "", 10);
  return Number.isFinite(year) && year >= YEAR_MIN && year <= YEAR_MAX;
}

function chamberCode(word: string): string | undefined {
  return CHAMBER_WORDS[collapse(word).replace(/ı/gu, "i")];
}

function institutionCode(word: string): string | undefined {
  const key = collapse(word).replace(/ı/gu, "i");
  for (const [name, code] of Object.entries(INSTITUTIONS)) {
    if (name.replace(/ı/gu, "i") === key) return code;
  }
  return undefined;
}

type MatchLike = RegExpMatchArray | RegExpExecArray;

function groupText(m: MatchLike, name: string): string | undefined {
  return m.groups?.[name];
}

function groupSpan(m: MatchLike, name: string): [number, number] | undefined {
  const span = m.indices?.groups?.[name];
  return span === undefined ? undefined : [span[0], span[1]];
}

/** Original-cased slice of a named group (the shadow copy is lowercased). */
function groupRaw(nfc: string, m: MatchLike, name: string): string | undefined {
  const span = groupSpan(m, name);
  return span === undefined ? undefined : nfc.slice(span[0], span[1]);
}

interface CourtMention {
  start: number;
  end: number;
  court?: string;
  chamber?: string;
}

/**
 * Parse exact legislation/article/court-decision references out of free text.
 * Pure and deterministic; never throws on arbitrary input.
 *
 * The exported regexes are only ever consumed through `matchAll`, which clones
 * them internally, so `lastIndex` never leaks between calls (re-entrant).
 */
export function parseReferences(text: string): ParsedReference[] {
  if (!text) return [];

  const nfc = text.normalize("NFC");
  let low = shadowFold(nfc);
  /* c8 ignore next */
  if (low.length !== nfc.length) low = nfc.toLocaleLowerCase("tr-TR");

  const refs: ParsedReference[] = [];
  const taken: Array<[number, number]> = [];

  const isFree = (start: number, end: number): boolean =>
    taken.every(([s, e]) => end <= s || start >= e);
  const claim = (start: number, end: number): void => {
    taken.push([start, end]);
  };

  // ---- court / chamber mentions (attached to dockets, never emitted alone)
  const courts: CourtMention[] = [];
  for (const m of low.matchAll(COURT_RE)) {
    const inst = groupText(m, "inst");
    const chword = groupText(m, "chword") ?? groupText(m, "chword2") ?? groupText(m, "chword3");
    const chno = groupText(m, "chno") ?? groupText(m, "chno3");
    const chord = groupText(m, "chord");
    let code = inst === undefined ? undefined : institutionCode(inst);
    const chCode = chword === undefined ? undefined : chamberCode(chword);
    if (code === undefined && chCode === undefined) continue;
    if (code === undefined && chCode !== undefined) code = CHAMBER_IMPLIES[chCode];
    let chamber: string | undefined;
    if (chCode !== undefined) {
      const number = chno ?? (chord === undefined ? undefined : ORDINAL_WORDS[chord]);
      chamber = number === undefined ? chCode : `${Number.parseInt(number, 10)}. ${chCode}`;
    }
    const start = m.index ?? 0;
    courts.push({ start, end: start + m[0].length, court: code, chamber });
  }

  const courtFor = (start: number): CourtMention | undefined => {
    let best: CourtMention | undefined;
    for (const mention of courts) {
      if (mention.end > start) continue;
      if (!COURT_GAP_RE.test(low.slice(mention.end, start))) continue;
      if (!isFree(mention.start, mention.end)) continue;
      if (best === undefined || mention.end > best.end) best = mention;
    }
    return best;
  };

  const pushDecision = (
    m: MatchLike,
    options: {
      docket: string;
      decision?: string;
      docketKind: string;
      defaultCourt?: string;
    },
  ): void => {
    let start = m.index ?? 0;
    const end = start + m[0].length;
    const attached = courtFor(start);
    let court = options.defaultCourt;
    let chamber: string | undefined;
    if (attached !== undefined) {
      start = attached.start;
      court = attached.court ?? options.defaultCourt;
      chamber = attached.chamber;
    }
    if (!isFree(start, end)) return;
    claim(start, end);
    const decisionDate = groupRaw(nfc, m, "tdate");
    refs.push({
      kind: "court_decision",
      raw: nfc.slice(start, end),
      docketNo: options.docket,
      ...(options.decision !== undefined ? { decisionNo: options.decision } : {}),
      year: Number.parseInt(options.docket.split("/")[0] ?? "", 10),
      ...(court !== undefined ? { court } : {}),
      ...(chamber !== undefined ? { chamber } : {}),
      docketKind: options.docketKind,
      ...(decisionDate !== undefined ? { decisionDate } : {}),
      span: [start, end],
    });
  };

  // Pass 1: official gazette (before legislation, shares "sayılı").
  for (const m of low.matchAll(RG_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!isFree(start, end)) continue;
    claim(start, end);
    const date = groupText(m, "date") ?? "";
    refs.push({
      kind: "official_gazette",
      raw: nfc.slice(start, end),
      rgDate: groupRaw(nfc, m, "date") ?? date,
      rgNo: groupText(m, "no") ?? "",
      year: Number.parseInt(date.slice(-4), 10),
      span: [start, end],
    });
  }

  // Pass 2: court decisions (prefix then suffix style).
  for (const pattern of [EK_RE, EK_SUFFIX_RE]) {
    for (const m of low.matchAll(pattern)) {
      const docket = squash(groupText(m, "docket") ?? "");
      const decision = squash(groupText(m, "decision") ?? "");
      if (!validDocket(docket) || !validDocket(decision)) continue;
      pushDecision(m, { docket, decision, docketKind: "esas" });
    }
  }

  // Pass 2b: HGK/CGK hyphenated docket without a paired karar number.
  for (const m of low.matchAll(DOCKET_ONLY_RE)) {
    const docket = squash(groupText(m, "docket") ?? "");
    if (!validDocket(docket)) continue;
    pushDecision(m, { docket, docketKind: "esas" });
  }

  // Pass 2c: AYM bireysel başvuru ("B. No: 2019/12345").
  for (const m of low.matchAll(BASVURU_RE)) {
    const docket = squash(groupText(m, "docket") ?? "");
    if (!validDocket(docket)) continue;
    pushDecision(m, { docket, docketKind: "basvuru", defaultCourt: "AYM" });
  }

  // Pass 3: legislation with an explicit number.
  for (const m of low.matchAll(LAW_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!isFree(start, end)) continue;
    claim(start, end);
    const name = (groupRaw(nfc, m, "name") ?? "").trim();
    const no = groupText(m, "no") ?? "";
    const byName = lookupAbbreviation(name);
    const byNumber = lookupByNumber(no);
    const entry = byNumber ?? byName;
    refs.push({
      kind: "legislation",
      raw: nfc.slice(start, end),
      legislationNo: no,
      ...(name !== "" ? { name } : {}),
      ...(byName !== undefined ? { abbreviation: byName.key } : {}),
      ...(entry !== undefined ? { canonicalName: entry.canonicalName } : {}),
      mulga: entry !== undefined && entry.mulga,
      span: [start, end],
    });
  }

  // Pass 3b: BARE abbreviations ("TCK m. 157", "İİK'nun 89 uncu maddesi",
  // "TBK 49").
  for (const m of low.matchAll(ABBREV_RE)) {
    const start = m.index ?? 0;
    const matchEnd = start + m[0].length;
    const suffixSpan = groupSpan(m, "suffix");
    const abbrSpan = groupSpan(m, "abbr");
    const headEnd = suffixSpan?.[1] ?? abbrSpan?.[1] ?? matchEnd;
    if (!isFree(start, headEnd)) continue;
    const written = groupRaw(nfc, m, "abbr") ?? "";
    const entry = lookupAbbreviation(written);
    /* c8 ignore next */
    if (entry === undefined) continue;

    const aart = groupText(m, "aart");
    let artStart = aart === undefined ? undefined : groupSpan(m, "aart")?.[0];
    if (artStart !== undefined && aart !== undefined) {
      const value = Number.parseInt(aart, 10);
      // A year, not an article number.
      if (value >= ARTICLE_YEAR_MIN && value <= ARTICLE_YEAR_MAX) artStart = undefined;
    }
    if (artStart !== undefined && !isFree(artStart, matchEnd)) artStart = undefined;

    claim(start, artStart !== undefined ? matchEnd : headEnd);
    refs.push({
      kind: "legislation",
      raw: nfc.slice(start, headEnd),
      legislationNo: entry.legislationNo,
      name: written,
      abbreviation: entry.key,
      canonicalName: entry.canonicalName,
      mulga: entry.mulga,
      span: [start, headEnd],
    });
    if (artStart !== undefined) {
      refs.push(articleRef(nfc, m, "a", artStart, matchEnd));
    }
  }

  // Pass 4: ek / geçici articles (before the generic article passes so that
  // "ek madde 5" is not also captured as a plain "madde 5").
  for (const m of low.matchAll(EK_GECICI_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!isFree(start, end)) continue;
    claim(start, end);
    refs.push({
      kind: "article",
      raw: nfc.slice(start, end),
      articleNo: groupText(m, "n1") ?? groupText(m, "n2") ?? "",
      articleKind: groupText(m, "akind") ?? "",
      span: [start, end],
    });
  }

  // Pass 5: suffix articles ("157 nci maddesi", "157. madde", "6/A maddesi").
  for (const m of low.matchAll(ARTICLE_SUFFIX_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const sep = groupText(m, "ssep") ?? "";
    const hasMarker = sep.includes(".") || sep.trim() !== "";
    // Bare "3 madde eklenmiştir" is a COUNT, not a reference.
    if (!hasMarker && groupText(m, "ssub") === undefined) continue;
    if (!isFree(start, end)) continue;
    claim(start, end);
    refs.push(articleRef(nfc, m, "s", start, end));
  }

  // Pass 6: prefix articles ("madde 157", "md. 157", "m. 157").
  for (const m of low.matchAll(ARTICLE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!isFree(start, end)) continue;
    claim(start, end);
    refs.push(articleRef(nfc, m, "p", start, end));
  }

  refs.sort((a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0));

  // Pass 7: Turkish short forms (W14/B-38). Runs LAST, over the references the
  // earlier passes produced, so it can resolve an anaphor against them.
  const resolved = resolveShortForms(nfc, low, refs, isFree, claim);
  resolved.sort((a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0));
  return resolved;
}

/**
 * Recognize and resolve Turkish anaphoric citations.
 *
 * Two mechanisms, both deterministic and both left-to-right:
 *
 *  1. a DECISION marker ("anılan karar", "aynı yönde", "agk.") becomes a short
 *     form carrying the identity of the nearest PRECEDING court decision; with
 *     no preceding decision it stays unresolved;
 *  2. an ARTICLE reference is re-kinded to a short form when it is either
 *     introduced by an anaphoric head ("aynı Kanunun 344 üncü maddesi") or a
 *     REPEAT of an article number already cited in this text ("… m. 352 …
 *     m. 352"). It then carries the nearest preceding legislation.
 *
 * An unresolved short form keeps every identity field absent — the "belirsiz"
 * bucket. Nothing is ever invented.
 */
function resolveShortForms(
  nfc: string,
  low: string,
  refs: readonly ParsedReference[],
  isFree: (start: number, end: number) => boolean,
  claim: (start: number, end: number) => void,
): ParsedReference[] {
  const out: ParsedReference[] = [];
  const seenArticles = new Set<string>();
  let lastLegislation: ParsedReference | undefined;

  for (const ref of refs) {
    if (ref.kind === "legislation") {
      lastLegislation = ref;
      out.push(ref);
      continue;
    }
    if (ref.kind !== "article") {
      out.push(ref);
      continue;
    }

    const key = `${ref.articleKind ?? ""}|${ref.articleNo ?? ""}`;
    const repeat = seenArticles.has(key);
    seenArticles.add(key);
    if (ownedByAdjacentLegislation(low, lastLegislation, ref)) {
      // The instrument is written right next to the article: a full citation,
      // not an anaphor. This is also what keeps a blockwise parse equal to a
      // whole-text parse (intake/analysis.py on the Python side).
      out.push(ref);
      continue;
    }
    const start = ref.span?.[0] ?? 0;
    const window = low.slice(Math.max(0, start - SHORTFORM_WINDOW), start);
    const anaphoric = SHORTFORM_ARTICLE_HEAD_RE.test(window);
    if (!repeat && !anaphoric) {
      out.push(ref);
      continue;
    }

    const carried: Record<string, unknown> = { mulga: false };
    if (lastLegislation !== undefined) {
      for (const field of LEGISLATION_CARRY) {
        const value = lastLegislation[field];
        if (value !== undefined) carried[field] = value;
      }
    }
    out.push({ ...ref, kind: SHORT_FORM_KIND, ...carried } as ParsedReference);
  }

  for (const m of low.matchAll(SHORTFORM_DECISION_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!isFree(start, end)) continue;
    claim(start, end);
    let target: ParsedReference | undefined;
    for (const candidate of out) {
      if (candidate.kind === "court_decision" && (candidate.span?.[1] ?? 0) <= start) {
        target = candidate;
      }
    }
    const carried: Record<string, unknown> = {};
    if (target !== undefined) {
      for (const field of DECISION_CARRY) {
        const value = target[field];
        if (value !== undefined) carried[field] = value;
      }
    }
    out.push({
      kind: SHORT_FORM_KIND,
      raw: nfc.slice(start, end),
      ...carried,
      span: [start, end],
    } as ParsedReference);
  }

  return out;
}

/**
 * Is `article` written immediately after the instrument it belongs to?
 *
 * "TCK m. 157", "TCK'nın 157. maddesi" and "5237 sayılı Kanun m. 157" all
 * restate the law next to the article, so the article is a FULL citation no
 * matter how many times the pair repeats. Only whitespace, punctuation and a
 * possessive suffix may sit in the gap, and the gap is bounded, so the answer
 * depends on a LOCAL window.
 */
function ownedByAdjacentLegislation(
  low: string,
  legislation: ParsedReference | undefined,
  article: ParsedReference,
): boolean {
  if (legislation === undefined) return false;
  const gapStart = legislation.span?.[1] ?? 0;
  const gapEnd = article.span?.[0] ?? 0;
  if (gapStart > gapEnd || gapEnd - gapStart > OWNED_GAP_MAX) return false;
  return OWNED_GAP_RE.test(low.slice(gapStart, gapEnd));
}

function articleRef(
  nfc: string,
  m: MatchLike,
  prefix: string,
  start: number,
  end: number,
): ParsedReference {
  let articleNo = squash(groupRaw(nfc, m, `${prefix}art`) ?? "");
  let paragraph: string | undefined;
  let clause: string | undefined;

  const sub = groupRaw(nfc, m, `${prefix}sub`);
  if (sub !== undefined) {
    const subRaw = squash(sub);
    if (/^[0-9]+$/u.test(subRaw)) {
      paragraph = String(Number.parseInt(subRaw, 10));
    } else {
      // A Roman numeral after the slash is a FIKRA ("25/II"), not a lettered
      // article suffix. Multi-character Roman numerals are recognized
      // CASE-INSENSITIVELY and with dotless-i folding, because hybrid search
      // parses the lowercased query form where "II" has already become "ıı".
      const folded = shadowFold(subRaw).replace(/ı/gu, "i").toUpperCase();
      const isUpper = subRaw === subRaw.toUpperCase() && subRaw !== subRaw.toLowerCase();
      if (subRaw.length >= 2 && ROMAN_RE.test(folded)) {
        paragraph = folded;
      } else if (isUpper && ROMAN_RE.test(subRaw)) {
        // Single letters stay case-sensitive: "5/I" is fıkra I but "5/i" is a
        // bent letter and "5/A" a lettered article.
        paragraph = subRaw;
      } else {
        // A lettered article suffix ("6/A", "10/A") is part of the article
        // identifier itself.
        articleNo = `${articleNo}/${subRaw}`;
      }
    }
  }

  const clauseRaw = groupRaw(nfc, m, `${prefix}clause`);
  if (clauseRaw !== undefined) clause = squash(clauseRaw);

  const fno = groupText(m, `${prefix}fno`);
  const fword = groupText(m, `${prefix}fword`);
  if (fno !== undefined) paragraph = String(Number.parseInt(fno, 10));
  else if (fword !== undefined) paragraph = ORDINAL_WORDS[fword];

  return {
    kind: "article",
    raw: nfc.slice(start, end),
    articleNo,
    articleKind: "madde",
    ...(paragraph !== undefined ? { paragraph } : {}),
    ...(clause !== undefined ? { clause } : {}),
    span: [start, end],
  };
}
