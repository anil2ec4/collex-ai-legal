/**
 * "Atıf yaptığım mevzuat değişti mi?" — the text signals a law check compares.
 *
 * WHAT THE TOOLS ACTUALLY EXPOSE (read from the Python implementation, not
 * assumed): `search_mevzuat` prints, per row, the law NUMBER, its title, its
 * type, the Bedesten `mevzuatId`, the Resmî Gazete date of the law's ORIGINAL
 * publication (`| RG: YYYY-MM-DD`) and an optional `gerekceId`
 * (mevzuat_mcp_server.py, search_mevzuat's line builder). None of those
 * changes when a law is amended: there is NO "last amendment date" or
 * "version" field anywhere on the legislation surface
 * (mevzuat_bedesten_models.py `BedMevzuatDocument`). The only thing that does
 * change is the consolidated TEXT `get_mevzuat_content` returns — and that
 * text carries the Resmî Gazete's own amendment notes, e.g.
 * "(Değişik: 26/6/2012-6352/99 md.)".
 *
 * So a check compares two things and invents neither:
 *   1. a fingerprint of the text as the source returned it (whole law, and
 *      the cited article when its heading can be isolated exactly once);
 *   2. the newest date written in the text's own amendment notes, when one
 *      is written in a recognised form — reported as "metindeki son
 *      değişiklik notu", never as an official version date.
 *
 * It never reads WHAT changed. A different fingerprint says "değişmiş
 * olabilir": the source may also have reformatted the same text.
 */

import { sha256HexUtf8 } from "../verification/validator.js";

/**
 * Identity of the fingerprinting method. A baseline recorded by another
 * method is not comparable and is re-recorded, never compared (bump this
 * whenever `canonicalWatchText` or the article split changes behaviour).
 */
export const WATCH_FINGERPRINT_METHOD = "lw-fp-1";

/** Invisible and bidirectional-control characters dropped before hashing. */
const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;

/**
 * The canonical form a fingerprint is taken over: NFC, invisible characters
 * dropped, every whitespace run collapsed to one space, trimmed. Page
 * boundaries and line wrapping therefore cannot change a fingerprint.
 */
export function canonicalWatchText(text: string): string {
  return text.normalize("NFC").replace(INVISIBLE_RE, "").replace(/\s+/gu, " ").trim();
}

/** SHA-256 over the UTF-8 bytes of the canonical text. */
export function watchFingerprint(text: string): string {
  return sha256HexUtf8(canonicalWatchText(text));
}

// ---------------------------------------------------------------------------
// Article isolation
// ---------------------------------------------------------------------------

export type ArticleKind = "madde" | "ek" | "gecici" | "mukerrer";

/**
 * An article HEADING as the consolidated text writes it: "MADDE 474 –",
 * "Madde 61. -", "EK MADDE 2-", "GEÇİCİ MADDE 3 –", "MADDE 68/A-".
 *
 * Unlike `article_search.split_plain_text_into_articles` the DASH is required:
 * that splitter (used for keyword search, where a stray split only moves a
 * boundary) also accepts "Madde 5" inside a sentence, and a fingerprint of a
 * mis-cut article would report a change nobody made. Not requiring a line
 * start is deliberate and matches that splitter: `_strip_html` only turns
 * `<br>` into a newline, so two paragraphs can share one line. A MÜKERRER
 * heading is its own kind, so "MÜKERRER MADDE 5" never collides with "MADDE 5".
 */
const ARTICLE_HEADING_RE =
  /(?<![\p{L}\p{N}])(?:(EK|Ek|GEÇİCİ|Geçici|GEÇICI|GECICI|MÜKERRER|Mükerrer)\s+)?(?:MADDE|Madde)\s+(\d{1,4}(?:\/[A-Za-zÇĞİÖŞÜçğıöşü])?)\s*[.\u00AD]?\s*[-–—\u00AD]/gu;

/** `${kind}:${number}` — "madde:474", "gecici:3", "madde:68/A". */
export function articleKey(kind: ArticleKind, number: string): string {
  return `${kind}:${number.toLocaleUpperCase("tr-TR")}`;
}

function prefixKind(prefix: string | undefined): ArticleKind {
  if (prefix === undefined) return "madde";
  if (/^e/iu.test(prefix)) return "ek";
  if (/^m/iu.test(prefix)) return "mukerrer";
  return "gecici";
}

export interface IsolatedArticle {
  key: string;
  /** Present only when the heading occurs EXACTLY once in the text. */
  text?: string;
  /** How many headings carried this key (2+ = ambiguous, no text). */
  occurrences: number;
}

/**
 * Split a law's text at its article headings. An article whose heading
 * occurs more than once (a quoted amendment, a duplicated heading) is
 * AMBIGUOUS and carries no text: a fingerprint over the wrong slice is worse
 * than none, and the caller then falls back to the whole law.
 */
export function isolateArticles(text: string): Map<string, IsolatedArticle> {
  const heads: Array<{ key: string; start: number }> = [];
  for (const match of text.matchAll(ARTICLE_HEADING_RE)) {
    const number = match[2];
    if (number === undefined || match.index === undefined) continue;
    heads.push({ key: articleKey(prefixKind(match[1]), number), start: match.index });
  }
  const out = new Map<string, IsolatedArticle>();
  heads.forEach((head, i) => {
    const end = i + 1 < heads.length ? (heads[i + 1] as { start: number }).start : text.length;
    const existing = out.get(head.key);
    if (existing !== undefined) {
      out.set(head.key, { key: head.key, occurrences: existing.occurrences + 1 });
      return;
    }
    // `start`/`end` are indices returned by the regex engine over this very
    // string; the slice is never compared by length, only fingerprinted.
    out.set(head.key, { key: head.key, text: text.slice(head.start, end), occurrences: 1 });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Amendment notes
// ---------------------------------------------------------------------------

/**
 * One amendment note of the consolidated text: "(Değişik: 26/6/2012-6352/99
 * md.)", "(Ek fıkra: 12/7/2013-6495/95 md.)", "(Mülga: 3/10/2016-KHK-676/…)",
 * "(İptal: Anayasa Mahkemesinin 22/7/2020 tarihli …)". The date is the first
 * one after the colon (the amending act's date), within 60 characters.
 */
const AMENDMENT_NOTE_RE =
  /\((?:Değişik|DEĞİŞİK|Ek|EK|Mülga|MÜLGA|İptal|İPTAL|Yeniden düzenleme|Değiştirilen|Eklenen)[^():]{0,120}:\s*[^()]{0,60}?(\d{1,2})[./](\d{1,2})[./](\d{4})/gu;

function isoDate(day: number, month: number, year: number): string | undefined {
  if (year < 1920 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The newest date written in the text's amendment notes, as ISO
 * `YYYY-MM-DD`, or `null` when no note in a recognised form is present.
 * `null` means "not written in a form we read", never "never amended".
 */
export function latestAmendmentNoteDate(text: string): string | null {
  let latest: string | null = null;
  for (const match of text.matchAll(AMENDMENT_NOTE_RE)) {
    const iso = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (iso !== undefined && (latest === null || iso > latest)) latest = iso;
  }
  return latest;
}

const ISTANBUL_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * ISO date or timestamp → "GG.AA.YYYY" for a Turkish sentence. A timestamp
 * is read on the Istanbul calendar day (a check at 01:00 local time is
 * 22:00 UTC the day before; the lawyer's "ilk kontrol" is the local day). A
 * bare date (an amendment note) is printed as written.
 */
export function isoToTr(iso: string | null | undefined): string {
  const value = iso ?? "";
  let day = value;
  if (/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) day = ISTANBUL_DAY.format(at);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(day);
  return match === null ? "" : `${match[3]}.${match[2]}.${match[1]}`;
}
