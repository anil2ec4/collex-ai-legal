/**
 * "UYAP'tan indirdiğim klasörü dosyalarıma dağıt" — matching (W22). Pure: no
 * I/O, no clock.
 *
 * The Python reader (`intake/uyap.py`) says, per document, which court and
 * which esas number the document names, each with the exact text it was read
 * from. This module decides which of the lawyer's matters that is — and,
 * just as important, when it must NOT decide:
 *
 *   matched     exactly one matter carries the same esas number AND the same
 *               court. The only state that proposes an assignment.
 *   ambiguous   matters carry the same esas number but the court does not
 *               settle it (two matters share court and esas, the court could
 *               not be read, a matter has no court written, or the court is
 *               spelled differently). Candidates are listed with the reason;
 *               nothing is assigned.
 *   unmatched   no matter carries this esas number. A "yeni dosya aç"
 *               proposal is prefilled with the court and the esas number.
 *   no_esas     neither the document nor its name carries an esas number.
 *
 * Esas numbers are compared EXACTLY as numbers (year and sequence; "2024/0123"
 * is "2024/123" because the two are the same number). Court names are
 * compared with THE fold every filter in ColleX uses (`foldTurkishForFilter`,
 * CLAUDE.md W22 "Filters fold Turkish") plus punctuation-to-space, so
 * "İSTANBUL ANADOLU 5. İŞ MAHKEMESİ" and "İstanbul Anadolu 5. İş Mahkemesi"
 * are one court. Nothing looser: an abbreviation ("5. İş Mah.") is a
 * DIFFERENT spelling, which lands the row in `ambiguous` with that reason —
 * the lawyer picks, the product never guesses.
 */

import { foldTurkishForFilter } from "../retrieval/normalize.js";

// ---------------------------------------------------------------------------
// Wire shapes of the Python scan (intake/uyap.py, READER_VERSION uyap-okuma-v1)
// ---------------------------------------------------------------------------

export type UyapSource = "content" | "filename";

export interface UyapField {
  value: string;
  /** The text the value was read from, verbatim. */
  quote: string;
  /** Code points over the NFC canonical text (content) or the file name. */
  start: number;
  end: number;
  source: UyapSource;
}

export interface UyapTypeField {
  code: string;
  label: string;
  quote: string;
  start: number;
  end: number;
  source: UyapSource;
}

export interface UyapReading {
  readerVersion: string;
  textRead: boolean;
  court: UyapField | null;
  esas: UyapField | null;
  karar: UyapField | null;
  documentType: UyapTypeField | null;
  documentDate: UyapField | null;
  filename: { esas: UyapField | null; documentType: UyapTypeField | null };
  esasConflict: boolean;
}

export interface UyapScanDocument {
  path: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  kind: string | null;
  error: { kind: string; message: string } | null;
  warnings: string[];
  reading: UyapReading;
}

export interface UyapScan {
  readerVersion: string;
  container: "dir" | "zip";
  root: string;
  total: number;
  skipped: string[];
  documents: UyapScanDocument[];
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const NUMBER_RE = /(\d{4})\s*\/\s*(\d{1,7})/gu;

function canonicalNumber(year: string, seq: string): string | undefined {
  const y = Number(year);
  const n = Number(seq);
  if (!Number.isInteger(y) || y < 1950 || y > 2100 || !Number.isInteger(n) || n <= 0) return undefined;
  return `${y}/${n}`;
}

/**
 * The esas number a matter's `docketNo` names, canonical ("2024/123"), or
 * undefined. "2024/123 E.", "E. 2024/123", "2024/123 Esas - 2025/45 K." and a
 * bare "2024/123" all work; a number marked as a KARAR number is never the
 * esas.
 */
export function esasKey(text: string): string | undefined {
  const folded = foldTurkishForFilter(text);
  let firstUnmarked: string | undefined;
  for (const match of folded.matchAll(NUMBER_RE)) {
    const value = canonicalNumber(match[1] ?? "", match[2] ?? "");
    if (value === undefined) continue;
    const at = match.index ?? 0;
    const before = folded.slice(Math.max(0, at - 12), at);
    const after = folded.slice(at + match[0].length, at + match[0].length + 8);
    const markedEsas = /(?:^|[^a-z])(?:e\s*\.?|esas(?:\s*no)?\s*:?)\s*$/u.test(before) ||
      /^\s*(?:e(?:[^a-z]|$)|esas)/u.test(after);
    const markedKarar = /(?:^|[^a-z])(?:k\s*\.?|karar(?:\s*no)?\s*:?)\s*$/u.test(before) ||
      /^\s*(?:k(?:[^a-z]|$)|karar)/u.test(after);
    if (markedEsas) return value;
    if (!markedKarar && firstUnmarked === undefined) firstUnmarked = value;
  }
  return firstUnmarked;
}

/** Court comparison key: the filter fold, "T.C." dropped, punctuation → space. */
export function courtKey(text: string): string {
  return foldTurkishForFilter(text)
    .replace(/^\s*t\s*\.\s*c\s*\.?\s*/u, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/** "İSTANBUL ANADOLU 5. İŞ MAHKEMESİ" → "İstanbul Anadolu 5. İş Mahkemesi". */
export function turkishTitleCase(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => {
      const first = word.charAt(0);
      return first === "" ? word : first.toLocaleUpperCase("tr-TR") + word.slice(1);
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatterRef {
  id: string;
  title: string;
  court: string;
  docketNo: string;
}

export type UyapMatchStatus = "matched" | "ambiguous" | "unmatched" | "no_esas";

export interface UyapCandidate {
  matterId: string;
  title: string;
  court: string;
  docketNo: string;
  /** Turkish: why this matter is listed and why it was not chosen for you. */
  reason: string;
}

export interface NewMatterProposal {
  title: string;
  court: string;
  docketNo: string;
}

export interface UyapMatch {
  status: UyapMatchStatus;
  /** Set only for `matched`. */
  matterId: string | null;
  candidates: UyapCandidate[];
  /** Turkish sentence shown on the row. */
  reason: string;
  /** Prefilled "yeni dosya aç" (every state that has an esas number). */
  newMatter: NewMatterProposal | null;
}

export const MATCH_REASON_TR = {
  matched: "Mahkeme ve esas numarası bu dosyanızla aynı.",
  sameCourtTwice:
    "Aynı mahkeme ve aynı esas numarasıyla birden fazla dosyanız var; hangisine ekleneceğini siz seçin.",
  courtUnread:
    "Belgede mahkeme adı okunamadı; bu esas numarası birden fazla dosyada ya da mahkemesi doğrulanamayan bir dosyada var — dosyayı siz seçin.",
  courtDiffers:
    "Bu esas numarası dosyalarınızda var ama mahkeme adı farklı yazılmış; aynı dava olup olmadığına siz karar verin.",
  unmatched: "Bu esas numarasıyla kayıtlı dosyanız yok. İsterseniz yeni dosya açılır.",
  noEsas: "Belgede de dosya adında da esas numarası okunamadı; dosyayı siz seçin ya da atlayın.",
} as const;

function candidate(matter: MatterRef, reason: string): UyapCandidate {
  return {
    matterId: matter.id,
    title: matter.title,
    court: matter.court,
    docketNo: matter.docketNo,
    reason,
  };
}

function proposal(reading: UyapReading, esas: string): NewMatterProposal {
  const court = reading.court !== null ? turkishTitleCase(reading.court.value) : "";
  const docketNo = `${esas} E.`;
  return { title: court !== "" ? `${court} ${docketNo}` : docketNo, court, docketNo };
}

export function matchReading(reading: UyapReading, matters: readonly MatterRef[]): UyapMatch {
  const esas = reading.esas?.value;
  if (esas === undefined) {
    return { status: "no_esas", matterId: null, candidates: [], reason: MATCH_REASON_TR.noEsas, newMatter: null };
  }
  const newMatter = proposal(reading, esas);
  const sameEsas = matters.filter((m) => esasKey(m.docketNo) === esas);
  if (sameEsas.length === 0) {
    return { status: "unmatched", matterId: null, candidates: [], reason: MATCH_REASON_TR.unmatched, newMatter };
  }
  const docCourt = reading.court !== null ? courtKey(reading.court.value) : "";
  const exact = docCourt === "" ? [] : sameEsas.filter((m) => courtKey(m.court) === docCourt);
  if (exact.length === 1) {
    const only = exact[0] as MatterRef;
    return {
      status: "matched",
      matterId: only.id,
      candidates: [candidate(only, MATCH_REASON_TR.matched)],
      reason: MATCH_REASON_TR.matched,
      newMatter,
    };
  }
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      matterId: null,
      candidates: exact.map((m) => candidate(m, "Mahkeme ve esas numarası aynı.")),
      reason: MATCH_REASON_TR.sameCourtTwice,
      newMatter,
    };
  }
  const listed = sameEsas.map((m) =>
    candidate(
      m,
      docCourt === ""
        ? "Esas numarası aynı; belgede mahkeme okunamadı."
        : m.court.trim() === ""
          ? "Esas numarası aynı; bu dosyada mahkeme adı yazılı değil."
          : `Esas numarası aynı; mahkeme farklı (dosyada: ${m.court}).`,
    ),
  );
  return {
    status: "ambiguous",
    matterId: null,
    candidates: listed,
    reason: docCourt === "" ? MATCH_REASON_TR.courtUnread : MATCH_REASON_TR.courtDiffers,
    newMatter,
  };
}

// ---------------------------------------------------------------------------
// The closing sentence
// ---------------------------------------------------------------------------

const UNITS: Record<number, string> = { 1: "i", 2: "si", 3: "ü", 4: "ü", 5: "i", 6: "sı", 7: "si", 8: "i", 9: "u" };
const TENS: Record<number, string> = { 1: "u", 2: "si", 3: "u", 4: "ı", 5: "si", 6: "ı", 7: "i", 8: "i", 9: "ı" };

/** "9'u", "2'si", "1'i", "12'si", "40'ı", "100'ü" — the possessive of a numeral. */
export function numberPossessive(n: number): string {
  let suffix: string;
  if (n === 0) suffix = "ı";
  else if (n % 10 !== 0) suffix = UNITS[n % 10] ?? "i";
  else if (n % 100 !== 0) suffix = TENS[(n % 100) / 10] ?? "u";
  else if (n % 1000 !== 0) suffix = "ü";
  else suffix = "i";
  return `${n}'${suffix}`;
}

export interface UyapImportCounts {
  total: number;
  added: number;
  matters: number;
  duplicates: number;
  unmatched: number;
  skipped: number;
  failed: number;
}

/**
 * "12 belge: 9'u 3 dosyaya eklendi, 2'si zaten vardı, 1'i eşleşmedi." Every
 * part is a count the import measured; a zero part is left out.
 */
export function importSummarySentence(counts: UyapImportCounts): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${numberPossessive(counts.added)} ${counts.matters} dosyaya eklendi`);
  if (counts.duplicates > 0) parts.push(`${numberPossessive(counts.duplicates)} zaten vardı`);
  if (counts.unmatched > 0) parts.push(`${numberPossessive(counts.unmatched)} eşleşmedi`);
  if (counts.skipped > 0) parts.push(`${numberPossessive(counts.skipped)} sizin seçiminizle atlandı`);
  if (counts.failed > 0) parts.push(`${numberPossessive(counts.failed)} işlenemedi`);
  if (parts.length === 0) return `${counts.total} belge: hiçbiri dosyaya eklenmedi.`;
  return `${counts.total} belge: ${parts.join(", ")}.`;
}
