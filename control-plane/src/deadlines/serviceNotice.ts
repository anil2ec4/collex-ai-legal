/**
 * "Tebligattan süreye" — a deterministic, rule-based reader for a served
 * document (tebligat) that turns it into a deadline PROPOSAL.
 *
 * Input: the extracted text of an e-tebligat (UETS) receipt, a physical
 * tebligat mazbatası (OCR'd upstream by intake/ocr.py, fail-closed), or the
 * served document itself (gerekçeli karar, dava dilekçesi, ödeme emri,
 * bilirkişi raporu …).
 *
 * Output — every fact carries the exact quoted span (Unicode code-point
 * offsets over the NFC text it was read from):
 *   - `dateCandidates`: the delivery date(s). An e-tebligat "ulaşma" date is
 *     turned into the deemed tebliğ date by adding FIVE calendar days (7201
 *     sayılı Tebligat Kanunu m.7/a: tebliğ, muhatabın elektronik adresine
 *     ulaştığı tarihi izleyen beşinci günün sonunda yapılmış sayılır). The
 *     fifth day is NOT rolled over a weekend or holiday — that would move the
 *     start later, i.e. the unsafe direction; a warning says so.
 *   - `ignoredDates`: every other date, with the reason it is NOT a tebliğ
 *     date (karar tarihi, kesinleşme şerhi, okunma tarihi, a tebliğ narrated
 *     inside the served document …). A decision date is never a start date.
 *   - `facts`: court/office, esas/karar numbers, what was served, the periods
 *     the document itself states, and legal notes (TK m.21, tefhim …).
 *   - `proposals`: the deadline rule(s) that start from the tebliğ, each with
 *     WHY (the matched quotes) and — only when ONE start date is settled —
 *     the verbatim `computeDeadline` result plus a ready-to-file matter item.
 *
 * It NEVER guesses: an unreadable date answers `OKUNAMADI`, two different
 * dates answer `SECIM_GEREKLI` and nothing is computed until the lawyer
 * picks one (`candidateId`) or types one (`tebligDate`). Nothing is written
 * anywhere by this module; filing is the lawyer's explicit confirm through
 * the existing matter-items API.
 *
 * Pure: no clock, no I/O. Machine codes are English UPPER_SNAKE; every
 * sentence the lawyer reads is Turkish.
 */

import { createHash } from "node:crypto";
import { computeDeadline, type DeadlineComputation } from "./calc.js";
import { addDays, isValidCivilDate, isWeekend, toIsoDate, toTrDate, formatTrLong, parseIsoDate, type CivilDate } from "./dates.js";
import { isHoliday } from "./holidays.js";
import { DEADLINE_DISCLAIMER, DEADLINE_RULES, findDeadlineRule, type DeadlineRule, type DeadlineUnit } from "./rules.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Producer version: bump it whenever the reading behaviour changes. */
export const NOTICE_READER_VERSION = "tebligat-okuyucu-v1";

/** Upper bound on the text one request may ask us to read (code points). */
export const MAX_NOTICE_TEXT_CODE_POINTS = 400_000;

/** 7201 sayılı Tebligat Kanunu m.7/a: the deemed-delivery offset in days. */
export const E_TEBLIGAT_DEEMED_DAYS = 5;

/** Only this much of the document is read for its heading (what it is). */
export const HEADING_ZONE_CODE_POINTS = 2_500;

/** Basis sentence for the fifth-day rule — never claims a verification. */
export const E_TEBLIGAT_BASIS_TR =
  "7201 sayılı Tebligat Kanunu m.7/a: elektronik tebligat, muhatabın elektronik adresine ulaştığı tarihi izleyen beşinci günün sonunda yapılmış sayılır.";

/** The fifth-day rule was not compared with the article text in ColleX. */
export const E_TEBLIGAT_BASIS_CHECK_TR =
  "Bu kural ColleX'te madde metniyle doğrulanmadı; mevzuat.gov.tr'de 7201 sayılı Tebligat Kanunu m.7/a'yı açıp “beşinci günün sonunda” ibaresini karşılaştırın.";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QuotedSpan {
  /** Code-point offset (inclusive) over the analysed NFC text. */
  start: number;
  /** Code-point offset (exclusive). */
  end: number;
  /** Exactly `text[start, end)` in code points. */
  quote: string;
}

export type NoticeDateKind = "FIZIKI_TEBLIG" | "ETEBLIGAT_ULASMA" | "ETEBLIGAT_TEBLIG";

export const NOTICE_DATE_KIND_TR: Readonly<Record<NoticeDateKind, string>> = {
  FIZIKI_TEBLIG: "Tebliğ tarihi (kâğıt tebligat)",
  ETEBLIGAT_ULASMA: "E-tebligat — elektronik adrese ulaşma tarihi (+5 gün)",
  ETEBLIGAT_TEBLIG: "E-tebligat — belgede yazan tebliğ tarihi",
};

export interface DateEvidence extends QuotedSpan {
  /** Which reading produced it (Turkish label). */
  label: string;
  /** The date as printed, YYYY-MM-DD. */
  date: string;
  kind: NoticeDateKind;
}

export interface DateCandidate {
  /** Stable within one reading: t1, t2 … in document order. */
  id: string;
  kind: NoticeDateKind;
  kindLabel: string;
  /** The tebliğ date the deadline starts from (YYYY-MM-DD). */
  tebligDate: string;
  tebligDateTr: string;
  /** The date as printed on the document (for ULASMA: the ulaşma date). */
  printedDate: string;
  printedDateTr: string;
  basis: string;
  /** "dogrulanmadi" for the fifth-day rule; null when nothing is derived. */
  basisStatus: "dogrulanmadi" | null;
  steps: string[];
  warnings: string[];
  evidence: DateEvidence[];
}

export type IgnoredDateReason =
  | "KARAR_TARIHI"
  | "YAZIM_TARIHI"
  | "KESINLESME"
  | "DAVA_TARIHI"
  | "RAPOR_TARIHI"
  | "OKUNMA_TARIHI"
  | "GONDERIM_TARIHI"
  | "DUZENLEME_TARIHI"
  | "DURUSMA_TARIHI"
  | "TEFHIM_TARIHI"
  | "SENET_TARIHI"
  | "DOGUM_TARIHI"
  | "KARAR_KUNYESI"
  | "BELGE_TARIHI"
  | "TESLIM_BELIRSIZ"
  | "ULASMA_E_IBARESI_YOK"
  | "ANLATILAN_TEBLIG"
  | "ETIKETSIZ";

export const IGNORED_REASON_TR: Readonly<Record<IgnoredDateReason, string>> = {
  KARAR_TARIHI: "Karar tarihi — tebliğ tarihi değildir; süre kararın tebliğinden başlar.",
  YAZIM_TARIHI: "Gerekçeli kararın yazıldığı tarih — tebliğ tarihi değildir.",
  KESINLESME: "Kesinleşme şerhi — kesinleşme tarihi süreyi başlatmaz ve şerhteki tarihler başka taraflara yapılan tebliğlere ait olabilir.",
  DAVA_TARIHI: "Dava / başvuru tarihi — tebliğ tarihi değildir.",
  RAPOR_TARIHI: "Rapor tarihi — tebliğ tarihi değildir; itiraz süresi raporun tebliğinden başlar.",
  OKUNMA_TARIHI: "E-tebligatın açıldığı / okunduğu tarih — tebliğ, ulaşma tarihini izleyen beşinci günün sonunda sayılır; okunma tarihi süreyi başlatmaz.",
  GONDERIM_TARIHI: "Gönderim / çıkış tarihi — tebliğ tarihi değildir.",
  DUZENLEME_TARIHI: "Belgenin düzenlendiği tarih — tebliğ tarihi değildir.",
  DURUSMA_TARIHI: "Duruşma tarihi — tebliğ tarihi değildir.",
  TEFHIM_TARIHI: "Tefhim tarihi — bazı süreler (ör. CMK m.273, m.291) tefhimden başlar; bu tarihi kullanmak isterseniz kendiniz girin.",
  SENET_TARIHI: "Senet / vade tarihi — tebliğ tarihi değildir.",
  DOGUM_TARIHI: "Doğum tarihi — tebliğ tarihi değildir.",
  KARAR_KUNYESI: "Bir mahkeme kararının künyesindeki tarih — karar tarihidir, tebliğ tarihi değildir.",
  BELGE_TARIHI: "“… tarihli” belge tarihi — tebliğ tarihi değildir.",
  TESLIM_BELIRSIZ: "E-tebligatta “teslim” tarihi: ulaşma mı tebliğ mi olduğu belgeden anlaşılmıyor — tarihi kendiniz seçin.",
  ULASMA_E_IBARESI_YOK: "“Ulaşma” tarihi var ama belgede elektronik tebligat ibaresi yok; beş gün kuralı uygulanmadı — tebliğ türünü ve tarihini kendiniz girin.",
  ANLATILAN_TEBLIG: "Belgenin içinde anlatılan başka bir tebliğ — bu belgenin size tebliğ edildiği tarih olarak alınmadı.",
  ETIKETSIZ: "Yanında tebliğ ibaresi yok — neyin tarihi olduğu belgeden anlaşılmıyor.",
};

export interface IgnoredDate extends QuotedSpan {
  date: string;
  dateTr: string;
  reason: IgnoredDateReason;
  reasonTr: string;
}

export type CourtClass =
  | "HUKUK_ILK"
  | "BAM_HUKUK"
  | "BAM"
  | "ICRA_HUKUK"
  | "ICRA_CEZA"
  | "CEZA_ILK"
  | "SULH_CEZA"
  | "BAM_CEZA"
  | "IDARI_ILK"
  | "BAM_IDARI"
  | "SAVCILIK"
  | "THH"
  | "ICRA_DAIRESI"
  | "VERGI_DAIRESI"
  | "YUKSEK";

export const COURT_CLASS_TR: Readonly<Record<CourtClass, string>> = {
  HUKUK_ILK: "hukuk ilk derece mahkemesi",
  BAM_HUKUK: "bölge adliye mahkemesi hukuk dairesi",
  BAM: "bölge adliye mahkemesi (hukuk / ceza dairesi okunamadı)",
  ICRA_HUKUK: "icra hukuk mahkemesi",
  ICRA_CEZA: "icra ceza mahkemesi",
  CEZA_ILK: "ceza ilk derece mahkemesi",
  SULH_CEZA: "sulh ceza hâkimliği",
  BAM_CEZA: "bölge adliye mahkemesi ceza dairesi",
  IDARI_ILK: "idare / vergi mahkemesi",
  BAM_IDARI: "bölge idare mahkemesi",
  SAVCILIK: "Cumhuriyet başsavcılığı",
  THH: "tüketici hakem heyeti",
  ICRA_DAIRESI: "icra dairesi",
  VERGI_DAIRESI: "vergi dairesi",
  YUKSEK: "Yargıtay / Danıştay",
};

export interface CourtFact extends QuotedSpan {
  courtClass: CourtClass;
  classLabel: string;
  /** True for the court the proposal was based on. */
  primary: boolean;
}

export type ReferenceKind = "ESAS" | "KARAR" | "DOSYA" | "SORUSTURMA" | "TAKIP";

export interface ReferenceFact extends QuotedSpan {
  kind: ReferenceKind;
  /** "2025/345" (spaces removed). */
  value: string;
}

export type ServedDocumentType =
  | "GEREKCELI_KARAR"
  | "ARA_KARAR"
  | "DAVA_DILEKCESI"
  | "CEVAP_DILEKCESI"
  | "CEVABA_CEVAP"
  | "ISTINAF_DILEKCESI"
  | "TEMYIZ_DILEKCESI"
  | "BILIRKISI_RAPORU"
  | "ODEME_EMRI"
  | "KYOK"
  | "THH_KARARI"
  | "VERGI_IHBARNAMESI"
  | "KIYMET_TAKDIRI"
  | "ON_INCELEME_DAVETIYESI"
  | "KIRA_IHTARNAMESI"
  | "FESIH_BILDIRIMI";

export const SERVED_DOCUMENT_TR: Readonly<Record<ServedDocumentType, string>> = {
  GEREKCELI_KARAR: "gerekçeli karar",
  ARA_KARAR: "ara karar",
  DAVA_DILEKCESI: "dava dilekçesi",
  CEVAP_DILEKCESI: "cevap dilekçesi",
  CEVABA_CEVAP: "cevaba cevap dilekçesi",
  ISTINAF_DILEKCESI: "istinaf dilekçesi",
  TEMYIZ_DILEKCESI: "temyiz dilekçesi",
  BILIRKISI_RAPORU: "bilirkişi raporu",
  ODEME_EMRI: "ödeme emri",
  KYOK: "kovuşturmaya yer olmadığına dair karar",
  THH_KARARI: "tüketici hakem heyeti kararı",
  VERGI_IHBARNAMESI: "vergi / ceza ihbarnamesi",
  KIYMET_TAKDIRI: "kıymet takdiri raporu",
  ON_INCELEME_DAVETIYESI: "ön inceleme davetiyesi",
  KIRA_IHTARNAMESI: "kira ödeme ihtarnamesi",
  FESIH_BILDIRIMI: "iş sözleşmesinin feshi bildirimi",
};

export type OdemeEmriKind = "GENEL" | "KAMBIYO" | "KIRA" | "AMME";

export interface DocumentTypeFact {
  type: ServedDocumentType;
  label: string;
  /** EVRAK_ALANI: the receipt's "tebliğ edilen evrak" field; BASLIK: the document's own heading. */
  foundIn: "EVRAK_ALANI" | "BASLIK";
  evidence: QuotedSpan[];
  /** Ödeme emri only: which form (örnek) it is, when readable. */
  odemeEmriKind?: OdemeEmriKind | null;
}

export interface StatedPeriodFact extends QuotedSpan {
  value: number;
  unit: DeadlineUnit;
}

export type NoticeNoteCode = "TK_21" | "TK_35" | "TEFHIM" | "KESIN_SURE" | "E_TEBLIGAT";

export interface NoticeNote {
  code: NoticeNoteCode;
  text: string;
  evidence: QuotedSpan | null;
}

export interface NoticeFacts {
  eTebligat: boolean;
  tebligatDocument: boolean;
  courts: CourtFact[];
  references: ReferenceFact[];
  documentTypes: DocumentTypeFact[];
  statedPeriods: StatedPeriodFact[];
  notes: NoticeNote[];
}

export interface ProposalWhy extends QuotedSpan {
  label: string;
}

export interface NoticeMatterItem {
  kind: "deadline";
  payload: {
    title: string;
    dueDate: string;
    ruleId: string;
    startDate: string;
    computed: DeadlineComputation;
    status: "acik";
    source: "hesap";
    teblig: {
      reader: string;
      dateSource: "BELGE" | "AVUKAT";
      kind: NoticeDateKind | null;
      candidateId: string | null;
      printedDate: string | null;
      fileId: string | null;
      quote: string | null;
      start: number | null;
      end: number | null;
      documentType: ServedDocumentType | null;
    };
  };
}

export interface DeadlineProposal {
  ruleId: string;
  rule: DeadlineRule;
  /** Turkish sentence: why this rule. */
  reasonTr: string;
  /** "AVUKAT" when the lawyer chose the rule; "BELGE" when the document suggested it. */
  origin: "BELGE" | "AVUKAT";
  why: ProposalWhy[];
  warnings: string[];
  computation: DeadlineComputation | null;
  matterItem: NoticeMatterItem | null;
}

export type NoticeDateStatus = "OKUNDU" | "SECIM_GEREKLI" | "OKUNAMADI" | "AVUKAT_SECTI" | "AVUKAT_GIRDI";
export type NoticeDocumentStatus = "OKUNDU" | "OKUNAMADI" | "AVUKAT_SECTI";

export interface NoticeTextInfo {
  source: "text" | "file";
  fileId: string | null;
  fileName: string | null;
  codePoints: number;
  /** sha256 over the UTF-8 bytes of the analysed NFC text. */
  sha256: string;
  /** File source: code points between chunks that were filled with line breaks. */
  gapCodePoints: number;
}

export interface NoticeReading {
  reader: string;
  text: NoticeTextInfo;
  dateStatus: NoticeDateStatus;
  documentStatus: NoticeDocumentStatus;
  /** The start date every computation used (null when none is settled). */
  tebligDate: string | null;
  tebligDateTr: string | null;
  readyToConfirm: boolean;
  dateCandidates: DateCandidate[];
  ignoredDates: IgnoredDate[];
  facts: NoticeFacts;
  proposals: DeadlineProposal[];
  /** Turkish sentences: what the lawyer must do next. */
  messages: string[];
  disclaimer: string;
}

export interface NoticeChoice {
  /** A candidate id from the same reading. */
  candidateId?: string;
  /** A date the lawyer typed (YYYY-MM-DD). */
  tebligDate?: string;
  /** A rule the lawyer chose instead of (or among) the proposals. */
  ruleId?: string;
}

export interface NoticeSource {
  source: "text" | "file";
  fileId?: string | null;
  fileName?: string | null;
  gapCodePoints?: number;
}

export type NoticeErrorKind = "INVALID_REQUEST" | "RULE_NOT_COMPUTABLE";

export class NoticeInputError extends Error {
  readonly kind: NoticeErrorKind;
  readonly path: string;
  constructor(kind: NoticeErrorKind, message: string, path: string) {
    super(message);
    this.name = "NoticeInputError";
    this.kind = kind;
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Text model: NFC code points + a one-to-one folded copy for matching
// ---------------------------------------------------------------------------

const FOLD_MAP: Readonly<Record<string, string>> = {
  İ: "i",
  I: "i",
  ı: "i",
  i: "i",
  Ğ: "g",
  ğ: "g",
  Ü: "u",
  ü: "u",
  Ş: "s",
  ş: "s",
  Ö: "o",
  ö: "o",
  Ç: "c",
  ç: "c",
  Â: "a",
  â: "a",
  Î: "i",
  î: "i",
  Û: "u",
  û: "u",
  Ê: "e",
  ê: "e",
  "’": "'",
  "‘": "'",
  "ʼ": "'",
  "´": "'",
  "`": "'",
  " ": " ",
  "\t": " ",
  "\r": " ",
  "–": "-",
  "—": "-",
};

/**
 * One code point in, exactly ONE UTF-16 unit out — so an index into the
 * folded string IS a code-point offset into the original. This folding is
 * for recognition only; every quote is sliced from the original text.
 */
function foldCodePoint(cp: string): string {
  const mapped = FOLD_MAP[cp];
  if (mapped !== undefined) return mapped;
  if (cp.length !== 1) return "�";
  const lower = cp.toLowerCase();
  return lower.length === 1 ? lower : "�";
}

class NoticeText {
  readonly cps: readonly string[];
  readonly folded: string;
  constructor(readonly nfc: string) {
    this.cps = Array.from(nfc);
    this.folded = this.cps.map(foldCodePoint).join("");
  }
  get length(): number {
    return this.cps.length;
  }
  slice(start: number, end: number): string {
    return this.cps.slice(Math.max(0, start), Math.min(this.cps.length, end)).join("");
  }
  span(start: number, end: number): QuotedSpan {
    const s = Math.max(0, start);
    const e = Math.min(this.cps.length, end);
    return { start: s, end: e, quote: this.slice(s, e) };
  }
  /** Trimmed span: leading/trailing whitespace dropped, offsets kept exact. */
  trimmedSpan(start: number, end: number): QuotedSpan {
    let s = Math.max(0, start);
    let e = Math.min(this.cps.length, end);
    while (s < e && /\s/u.test(this.folded[s] ?? "")) s += 1;
    while (e > s && /\s/u.test(this.folded[e - 1] ?? "")) e -= 1;
    return this.span(s, e);
  }
  lineStart(offset: number): number {
    const i = this.folded.lastIndexOf("\n", Math.max(0, offset - 1));
    return i < 0 ? 0 : i + 1;
  }
  lineEnd(offset: number): number {
    const i = this.folded.indexOf("\n", offset);
    return i < 0 ? this.folded.length : i;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS_FOLDED = [
  "ocak",
  "subat",
  "mart",
  "nisan",
  "mayis",
  "haziran",
  "temmuz",
  "agustos",
  "eylul",
  "ekim",
  "kasim",
  "aralik",
] as const;

interface FoundDate {
  date: CivilDate;
  start: number;
  end: number;
}

const NUMERIC_DATE_RE = /(?<![\d./-])(\d{1,2}) ?([./-]) ?(\d{1,2}) ?\2 ?(\d{4})(?!\d)/gu;
const ISO_DATE_RE = /(?<![\d./-])(\d{4})-(\d{2})-(\d{2})(?![\d])/gu;
const TEXT_DATE_RE = new RegExp(
  `(?<![\\d])(\\d{1,2})\\s+(${MONTHS_FOLDED.join("|")})\\s+(\\d{4})(?!\\d)`,
  "gu",
);

function civil(year: number, month: number, day: number): CivilDate | undefined {
  if (year < 1950 || year > 2200) return undefined;
  return isValidCivilDate(year, month, day) ? { year, month, day } : undefined;
}

function findDates(text: NoticeText): FoundDate[] {
  const out: FoundDate[] = [];
  const f = text.folded;
  for (const m of f.matchAll(NUMERIC_DATE_RE)) {
    const d = civil(Number(m[4]), Number(m[3]), Number(m[1]));
    if (d !== undefined) out.push({ date: d, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of f.matchAll(ISO_DATE_RE)) {
    const d = civil(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d !== undefined) out.push({ date: d, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of f.matchAll(TEXT_DATE_RE)) {
    const month = MONTHS_FOLDED.indexOf(m[2] as (typeof MONTHS_FOLDED)[number]) + 1;
    const d = civil(Number(m[3]), month, Number(m[1]));
    if (d !== undefined) out.push({ date: d, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  out.sort((a, b) => a.start - b.start);
  // Overlapping matches (never expected) keep the first.
  const kept: FoundDate[] = [];
  for (const d of out) {
    const last = kept[kept.length - 1];
    if (last !== undefined && d.start < last.end) continue;
    kept.push(d);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Context detection
// ---------------------------------------------------------------------------

const E_CONTEXT_RE =
  /e-?tebligat|elektronik\s+tebligat|\buets\b|ulusal\s+elektronik\s+tebligat|elektronik\s+adres|\bkep\s+adres|kayitli\s+elektronik\s+posta/u;
const TEBLIGAT_CONTEXT_RE =
  /teblig\s+mazbatas|tebligat\s+mazbatas|\bmazbata|\bptt\b|barkod|tebligat\s+kanunu|tebellug|e-?tebligat|elektronik\s+tebligat|\buets\b/u;

// ---------------------------------------------------------------------------
// Date labels (anchored: the label must END right before the date)
// ---------------------------------------------------------------------------

type PositiveLabel = "ULASMA" | "TEBLIG_SAYILMA" | "TEBLIG" | "TESLIM";

interface LabelSpec {
  re: string;
  positive?: PositiveLabel;
  negative?: IgnoredDateReason;
}

/** Order matters only for readability; each is anchored at the date. */
const LABELS: readonly LabelSpec[] = [
  { re: "(?:ulastirildigi|ulastirilma|ulastigi|ulasma|ulastirilan)\\s+(?:tarih\\w*|gun\\w*)", positive: "ULASMA" },
  { re: "teblig\\s+(?:edilmis\\s+)?say\\w+\\s+tarih\\w*", positive: "TEBLIG_SAYILMA" },
  {
    re: "(?:teblig\\s+(?:edildigi|olundugu|yapildigi|edilme)\\s+tarih\\w*|teblig\\s+tarih\\w*|tebellug\\s+(?:ettigi\\s+)?tarih\\w*)",
    positive: "TEBLIG",
  },
  { re: "teslim\\s+(?:edildigi\\s+|edilme\\s+|alma\\s+|alindigi\\s+)?tarih\\w*", positive: "TESLIM" },
  { re: "(?:gerekceli\\s+karar\\w*\\s+)?yazim\\s+tarih\\w*", negative: "YAZIM_TARIHI" },
  { re: "(?:hukum|karar|ilam)\\s+tarih\\w*", negative: "KARAR_TARIHI" },
  { re: "kesinles\\w*\\s+tarih\\w*", negative: "KESINLESME" },
  { re: "(?:dava|basvuru|talep|takip)\\s+tarih\\w*", negative: "DAVA_TARIHI" },
  { re: "rapor\\s+tarih\\w*", negative: "RAPOR_TARIHI" },
  {
    re: "(?:okunma|okundugu|acilma|acildigi|acilis|goruntulenme|goruntulendigi|okuma)\\s+tarih\\w*",
    negative: "OKUNMA_TARIHI",
  },
  {
    re: "(?:gonderilme|gonderim|gonderildigi|gonderme|gonderi|cikis|postaya\\s+verilis|postalama|sevk)\\s+tarih\\w*",
    negative: "GONDERIM_TARIHI",
  },
  { re: "(?:duzenleme|duzenlendigi|tanzim|olusturma|olusturulma|belge)\\s+tarih\\w*", negative: "DUZENLEME_TARIHI" },
  { re: "(?:durusma|celse|kesif)\\s+(?:gunu\\s+ve\\s+)?(?:tarih\\w*|gun\\w*)", negative: "DURUSMA_TARIHI" },
  { re: "tefhim\\s+tarih\\w*", negative: "TEFHIM_TARIHI" },
  { re: "(?:vade|keside|senet)\\s+tarih\\w*", negative: "SENET_TARIHI" },
  { re: "dogum\\s+tarih\\w*", negative: "DOGUM_TARIHI" },
];

// Between a label and its value: column padding and a colon on the same line
// (forms align their values), or one line break for a two-row table.
const LABEL_TAIL =
  "(?:\\s+ve\\s+saat\\w*)?(?:\\s*\\([^()\\n]{0,20}\\))?[ :=|\\-]{0,30}(?:\\n[ :=|\\-]{0,10})?$";
const COMPILED_LABELS = LABELS.map((spec) => ({ spec, re: new RegExp(`(?:${spec.re})${LABEL_TAIL}`, "u") }));

const LABEL_WINDOW = 120;

const DELIVERY_PHRASE_RE =
  /teblig\s+(?:edildi|olundu|edilmistir|olunmustur|edilmis\s+sayil)|tebellug\s+(?:etti|edildi|eylemistir|etmistir)|imzasina\s+teblig|teslim\s+(?:edildi|edilmistir|alindi)/u;
const MAZBATA_MARKER_RE =
  /bizzat|imzasina|imzasi\s+alinarak|kendisine|tebellug|muhtar|kapisina|yapistir|ayni\s+(?:konutta|adreste)|daimi\s+calisan|birlikte\s+oturan/u;
const DECISION_CITATION_RE =
  /(?:yargitay|danistay|anayasa\s+mahkemesi|(?:hukuk|ceza)\s+dairesi|\b\d{1,2}\s*\.\s*(?:hd|cd)\b|\bhgk\b|\bcgk\b|\bibk\b|\be\s*\.\s*\d{4}|\bk\s*\.\s*\d{4}|esas\s*,?\s*\d{4})/u;

/** Previous sentence boundary before `offset` (bounded look-back). */
function sentenceStart(text: NoticeText, offset: number, max = 220): number {
  const from = Math.max(0, offset - max);
  const window = text.folded.slice(from, offset);
  let cut = -1;
  for (const m of window.matchAll(/(?<!\d)[.!?](?=\s)|\n\s*\n|;/gu)) cut = (m.index ?? 0) + m[0].length;
  // A line that starts with a capital letter starts a new sentence (form
  // rows and headings); a wrapped line of prose continues in lower case.
  for (let i = window.length - 1; i > cut; i -= 1) {
    if (window[i] === "\n" && startsUpper(text, from + i + 1)) {
      cut = i + 1;
      break;
    }
  }
  return cut < 0 ? from : from + cut;
}

/** Next sentence boundary after `offset` (bounded look-ahead). */
function sentenceEnd(text: NoticeText, offset: number, max = 220): number {
  const to = Math.min(text.length, offset + max);
  const window = text.folded.slice(offset, to);
  const m = /(?<!\d)[.!?](?=\s|$)|\n\s*\n|;/u.exec(window);
  let end = m === null ? to : offset + (m.index ?? 0) + m[0].length;
  for (let i = 0; i < window.length && offset + i < end; i += 1) {
    if (window[i] === "\n" && startsUpper(text, offset + i + 1)) {
      end = offset + i;
      break;
    }
  }
  return end;
}

/** True when the first non-blank code point at/after `offset` on its line is a capital letter. */
function startsUpper(text: NoticeText, offset: number): boolean {
  let i = offset;
  while (i < text.length && (text.cps[i] === " " || text.cps[i] === "\t")) i += 1;
  const ch = text.cps[i];
  if (ch === undefined || !/\p{L}/u.test(ch)) return false;
  return ch === ch.toLocaleUpperCase("tr") && ch !== ch.toLocaleLowerCase("tr");
}

interface DateReading {
  found: FoundDate;
  candidate?: { kind: NoticeDateKind; label: string; span: QuotedSpan };
  ignored?: { reason: IgnoredDateReason; span: QuotedSpan };
}

function fieldSpan(text: NoticeText, labelStart: number, dateEnd: number): QuotedSpan {
  const ls = text.lineStart(labelStart);
  const start = ls >= labelStart - 80 ? ls : labelStart;
  return text.trimmedSpan(start, dateEnd);
}

function contextSpan(text: NoticeText, d: FoundDate): QuotedSpan {
  let ls = Math.max(text.lineStart(d.start), d.start - 60);
  let le = Math.min(text.lineEnd(d.end), d.end + 40);
  // Whole words only: never start or end a quote in the middle of a word.
  if (ls > text.lineStart(d.start)) while (ls < d.start && !/\s/u.test(text.folded[ls - 1] ?? " ")) ls += 1;
  if (le < text.lineEnd(d.end)) while (le > d.end && !/\s/u.test(text.folded[le] ?? " ")) le -= 1;
  return text.trimmedSpan(ls, le);
}

function readDate(text: NoticeText, d: FoundDate, eContext: boolean, tebligatContext: boolean): DateReading {
  const f = text.folded;
  const beforeFrom = Math.max(0, d.start - LABEL_WINDOW);
  const before = f.slice(beforeFrom, d.start);
  const sStart = sentenceStart(text, d.start);
  const sEnd = sentenceEnd(text, d.end);
  const sentence = f.slice(sStart, sEnd);

  // 1. A kesinleşme şerhi wins over everything: its dates belong to other
  //    events (kesinleşme, tebliğ to OTHER parties). The şerh heading is
  //    looked for above the date; the word itself on the date's own line
  //    (a form field) or in its sentence (running text).
  const serhBefore = f.slice(Math.max(0, d.start - 400), d.start);
  const ownLine = f.slice(text.lineStart(d.start), text.lineEnd(d.end));
  const kesinlesmeHere = /kesinles/u.test(ownLine) || (!/\n/u.test(f.slice(sStart, sEnd)) && /kesinles/u.test(sentence));
  const kesinlesmeProse = /kesinles/u.test(sentence) && /\btarihinde\b[^\n]{0,80}kesinles|kesinles\w*\s+(?:olup|oldugu|tarih)/u.test(sentence);
  if (kesinlesmeHere || kesinlesmeProse || /kesinlesme\s+serh/u.test(serhBefore)) {
    return { found: d, ignored: { reason: "KESINLESME", span: text.trimmedSpan(sStart, sEnd) } };
  }

  // 2. A label that ends right before the date.
  for (const { spec, re } of COMPILED_LABELS) {
    const m = re.exec(before);
    if (m === null) continue;
    const labelStart = beforeFrom + (m.index ?? 0);
    const span = fieldSpan(text, labelStart, d.end);
    if (spec.negative !== undefined) return { found: d, ignored: { reason: spec.negative, span } };
    switch (spec.positive) {
      case "ULASMA":
        if (!eContext) return { found: d, ignored: { reason: "ULASMA_E_IBARESI_YOK", span } };
        return { found: d, candidate: { kind: "ETEBLIGAT_ULASMA", label: "Elektronik adrese ulaşma tarihi", span } };
      case "TEBLIG_SAYILMA":
      case "TEBLIG":
        return {
          found: d,
          candidate: eContext
            ? { kind: "ETEBLIGAT_TEBLIG", label: "Belgede yazan tebliğ tarihi (e-tebligat)", span }
            : { kind: "FIZIKI_TEBLIG", label: "Belgede yazan tebliğ tarihi", span },
        };
      case "TESLIM":
        if (eContext) return { found: d, ignored: { reason: "TESLIM_BELIRSIZ", span } };
        if (!tebligatContext) return { found: d, ignored: { reason: "ETIKETSIZ", span } };
        return { found: d, candidate: { kind: "FIZIKI_TEBLIG", label: "Tebligatın teslim tarihi", span } };
      default:
        break;
    }
  }

  // 3. "<date> tarihinde … bizzat imzasına tebliğ edildi" — a mazbata sentence.
  const after = f.slice(d.end, sEnd);
  const tarihinde = /^\s*(?:tarihinde|tarihi\s+itibariyle|gunu)\b/u.test(after);
  if (tarihinde && /teblig|tebellug/u.test(after)) {
    const span = text.trimmedSpan(sStart, sEnd);
    // Only a tebligat document's own delivery sentence is a start date; a
    // decision or petition narrating an EARLIER tebliğ ("dava dilekçesi
    // davalıya … tarihinde tebliğ edilmiş") is not.
    if (tebligatContext && DELIVERY_PHRASE_RE.test(after) && MAZBATA_MARKER_RE.test(sentence)) {
      return { found: d, candidate: { kind: "FIZIKI_TEBLIG", label: "Mazbatadaki tebliğ cümlesi", span } };
    }
    return { found: d, ignored: { reason: "ANLATILAN_TEBLIG", span } };
  }

  // 4. Unlabelled dates: say what they most likely are, never a start date.
  if (/^\s*tarihli\s+(?:karar|ilam|hukum|ara\s+karar)/u.test(after)) {
    return { found: d, ignored: { reason: "KARAR_TARIHI", span: contextSpan(text, d) } };
  }
  if (/^\s*tarihli/u.test(after)) {
    return { found: d, ignored: { reason: "BELGE_TARIHI", span: contextSpan(text, d) } };
  }
  const near = f.slice(Math.max(sStart, d.start - 80), Math.min(sEnd, d.end + 60));
  if (DECISION_CITATION_RE.test(near)) {
    return { found: d, ignored: { reason: "KARAR_KUNYESI", span: contextSpan(text, d) } };
  }
  return { found: d, ignored: { reason: "ETIKETSIZ", span: contextSpan(text, d) } };
}

// ---------------------------------------------------------------------------
// Candidates (merge by effective tebliğ date)
// ---------------------------------------------------------------------------

const KIND_PRIORITY: Readonly<Record<NoticeDateKind, number>> = {
  ETEBLIGAT_ULASMA: 0,
  ETEBLIGAT_TEBLIG: 1,
  FIZIKI_TEBLIG: 2,
};

function effectiveTebligDate(kind: NoticeDateKind, printed: CivilDate): CivilDate {
  return kind === "ETEBLIGAT_ULASMA" ? addDays(printed, E_TEBLIGAT_DEEMED_DAYS) : printed;
}

function fifthDayWarnings(ulasma: CivilDate, teblig: CivilDate): string[] {
  const out: string[] = [];
  const holiday = isHoliday(teblig);
  if (holiday !== undefined || isWeekend(teblig)) {
    const what = holiday !== undefined ? holiday.name : "hafta sonu";
    out.push(
      `Beşinci gün (${formatTrLong(teblig)}) ${what} gününe denk geliyor. Tebliğ karinesi bu yüzden ertelenmedi: ColleX erken (güvenli) tarihi kullanır. Uygulamanın bu noktada farklı olup olmadığını avukat olarak kontrol edin.`,
    );
  }
  if (teblig.month !== ulasma.month || teblig.year !== ulasma.year) {
    out.push(
      `Beş gün ay sonunu aşıyor: ulaşma ${toTrDate(ulasma)}, tebliğ ${toTrDate(teblig)} — günler takvim günü olarak sayıldı.`,
    );
  }
  return out;
}

function buildCandidates(readings: readonly DateReading[]): DateCandidate[] {
  const groups = new Map<string, DateEvidence[]>();
  for (const r of readings) {
    if (r.candidate === undefined) continue;
    const effective = toIsoDate(effectiveTebligDate(r.candidate.kind, r.found.date));
    const list = groups.get(effective) ?? [];
    list.push({
      ...r.candidate.span,
      label: r.candidate.label,
      date: toIsoDate(r.found.date),
      kind: r.candidate.kind,
    });
    groups.set(effective, list);
  }
  const candidates: Array<Omit<DateCandidate, "id">> = [];
  for (const [effective, evidence] of groups) {
    evidence.sort((a, b) => a.start - b.start);
    const primary = [...evidence].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.start - b.start)[0]!;
    const teblig = parseIsoDate(effective)!;
    const printed = parseIsoDate(primary.date)!;
    const steps: string[] = [];
    const warnings: string[] = [];
    let basis: string;
    let basisStatus: DateCandidate["basisStatus"] = null;
    if (primary.kind === "ETEBLIGAT_ULASMA") {
      basis = E_TEBLIGAT_BASIS_TR;
      basisStatus = "dogrulanmadi";
      steps.push(`Elektronik adrese ulaşma: ${formatTrLong(printed)}.`);
      steps.push(E_TEBLIGAT_BASIS_TR);
      steps.push(
        `${toTrDate(printed)} + ${E_TEBLIGAT_DEEMED_DAYS} gün = ${formatTrLong(teblig)} — tebliğ bu günün sonunda yapılmış sayılır.`,
      );
      steps.push("Süre, tebliğ tarihini izleyen günden işlemeye başlar.");
      warnings.push(...fifthDayWarnings(printed, teblig));
      warnings.push(E_TEBLIGAT_BASIS_CHECK_TR);
      if (evidence.some((e) => e.kind !== "ETEBLIGAT_ULASMA")) {
        steps.push("Belgede ayrıca yazan tebliğ tarihi, ulaşma tarihine beş gün eklenerek bulunan tarihle aynı.");
      }
    } else if (primary.kind === "ETEBLIGAT_TEBLIG") {
      basis = "Belgede tebliğ tarihi olarak yazan tarih (e-tebligat).";
      steps.push(`Belgede yazan tebliğ tarihi: ${formatTrLong(printed)}.`);
      steps.push("Süre, tebliğ tarihini izleyen günden işlemeye başlar.");
      warnings.push(
        "Belgede ulaşma tarihi okunamadı; yazan tarihin ulaşma tarihi mi yoksa beşinci gün sonundaki tebliğ tarihi mi olduğunu belgeden kontrol edin.",
      );
    } else {
      basis = "Tebligat belgesinde tebliğ tarihi olarak yazan tarih.";
      steps.push(`Tebliğ tarihi: ${formatTrLong(printed)}.`);
      steps.push("Süre, tebliğ tarihini izleyen günden işlemeye başlar.");
    }
    candidates.push({
      kind: primary.kind,
      kindLabel: NOTICE_DATE_KIND_TR[primary.kind],
      tebligDate: effective,
      tebligDateTr: toTrDate(teblig),
      printedDate: primary.date,
      printedDateTr: toTrDate(printed),
      basis,
      basisStatus,
      steps,
      warnings,
      evidence,
    });
  }
  candidates.sort((a, b) => (a.evidence[0]?.start ?? 0) - (b.evidence[0]?.start ?? 0));
  return candidates.map((c, index) => ({ id: `t${index + 1}`, ...c }));
}

// ---------------------------------------------------------------------------
// Courts, references, periods, document types, notes
// ---------------------------------------------------------------------------

interface CourtPattern {
  re: RegExp;
  classify: (m: RegExpExecArray) => CourtClass;
}

const CITY_PREFIX = "(?:(?:[a-z]{3,}\\s+){0,2})(?:\\d{1,3}\\s*\\.\\s*)?";
const COURT_PATTERNS: readonly CourtPattern[] = [
  {
    re: new RegExp(
      `${CITY_PREFIX}bolge\\s+adliye\\s+mahkemesi(?:\\s*,?\\s*(?:\\d{1,3}\\s*\\.\\s*)?(hukuk|ceza)\\s+dairesi)?`,
      "gu",
    ),
    classify: (m) => (m[1] === "hukuk" ? "BAM_HUKUK" : m[1] === "ceza" ? "BAM_CEZA" : "BAM"),
  },
  {
    re: new RegExp(`${CITY_PREFIX}bolge\\s+idare\\s+mahkemesi(?:\\s*,?\\s*(?:\\d{1,3}\\s*\\.\\s*)?[a-z ]{0,20}dairesi)?`, "gu"),
    classify: () => "BAM_IDARI",
  },
  { re: /(?:yargitay|danistay)(?:\s+\d{1,2}\s*\.\s*(?:hukuk|ceza|idari\s+dava|vergi\s+dava)?\s*dairesi)?/gu, classify: () => "YUKSEK" },
  { re: new RegExp(`${CITY_PREFIX}icra\\s+hukuk\\s+mahkemesi`, "gu"), classify: () => "ICRA_HUKUK" },
  { re: new RegExp(`${CITY_PREFIX}icra\\s+ceza\\s+mahkemesi`, "gu"), classify: () => "ICRA_CEZA" },
  {
    re: new RegExp(
      `${CITY_PREFIX}(?:asliye\\s+ceza|agir\\s+ceza|cocuk\\s+agir\\s+ceza|cocuk|fikri\\s+ve\\s+sinai\\s+haklar\\s+ceza)\\s+mahkemesi`,
      "gu",
    ),
    classify: () => "CEZA_ILK",
  },
  { re: new RegExp(`${CITY_PREFIX}sulh\\s+ceza\\s+hakimligi`, "gu"), classify: () => "SULH_CEZA" },
  {
    re: new RegExp(
      `${CITY_PREFIX}(?:asliye\\s+hukuk|asliye\\s+ticaret|sulh\\s+hukuk|is|aile|tuketici|kadastro|fikri\\s+ve\\s+sinai\\s+haklar\\s+hukuk)\\s+mahkemesi`,
      "gu",
    ),
    classify: () => "HUKUK_ILK",
  },
  { re: new RegExp(`${CITY_PREFIX}(?:idare|vergi)\\s+mahkemesi`, "gu"), classify: () => "IDARI_ILK" },
  { re: new RegExp(`${CITY_PREFIX}cumhuriyet\\s+bassavciligi`, "gu"), classify: () => "SAVCILIK" },
  { re: new RegExp(`${CITY_PREFIX}(?:tuketici\\s+)?hakem\\s+heyeti`, "gu"), classify: () => "THH" },
  { re: new RegExp(`${CITY_PREFIX}icra\\s+(?:dairesi|mudurlugu)`, "gu"), classify: () => "ICRA_DAIRESI" },
  { re: new RegExp(`${CITY_PREFIX}vergi\\s+dairesi(?:\\s+mudurlugu)?`, "gu"), classify: () => "VERGI_DAIRESI" },
];

/** Words that are never part of a court's name even when they precede it. */
const COURT_PREFIX_STOP = new Set([
  "ve",
  "ile",
  "olan",
  "sayin",
  "iste",
  "bu",
  "icin",
  "gore",
  "karar",
  "veren",
  "dava",
  "tarafindan",
  "nezdinde",
  "birim",
  "birimi",
  "mahkeme",
  "gonderen",
  "gonderici",
  "kurum",
]);

function findCourts(text: NoticeText): Array<Omit<CourtFact, "primary">> {
  const hits: Array<Omit<CourtFact, "primary">> = [];
  for (const pattern of COURT_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (const m of text.folded.matchAll(pattern.re)) {
      let start = m.index ?? 0;
      const end = start + m[0].length;
      // A place name is written with a capital: drop leading words that are
      // not ("içinde icra dairesi", "veren asliye hukuk mahkemesi").
      for (let guard = 0; guard < 2; guard += 1) {
        const first = /^([a-z]+)\s+/u.exec(text.folded.slice(start, end));
        if (first === null) break;
        if (!COURT_PREFIX_STOP.has(first[1]!) && startsUpper(text, start)) break;
        start += first[0].length;
      }
      // "… itirazınızı icra dairesine bildirin" names no particular office.
      if (!startsUpper(text, start) && !/\d/u.test(text.folded[start] ?? "")) continue;
      const exec = m as unknown as RegExpExecArray;
      const courtClass = pattern.classify(exec);
      hits.push({ ...text.trimmedSpan(start, end), courtClass, classLabel: COURT_CLASS_TR[courtClass] });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  // Drop a hit contained in an earlier (longer) one.
  const kept: Array<Omit<CourtFact, "primary">> = [];
  for (const h of hits) {
    if (kept.some((k) => h.start >= k.start && h.end <= k.end)) continue;
    kept.push(h);
  }
  return kept;
}

const SENDER_LABEL_RE =
  /(?:gonderici|gonderen|gonderen\s+kurum|gonderici\s+birim|gonderen\s+birim|birim\s+adi|kurum\s+adi|(?:teblig\s+eden\s+|tebligati\s+cikaran\s+)?merci\w*)\s*[:=]/u;

function pickPrimaryCourt(text: NoticeText, courts: Array<Omit<CourtFact, "primary">>): number {
  if (courts.length === 0) return -1;
  // A court on a "Gönderici Birim:" line of a receipt names the sender.
  for (let i = 0; i < courts.length; i += 1) {
    const c = courts[i]!;
    const line = text.folded.slice(text.lineStart(c.start), c.start);
    if (SENDER_LABEL_RE.test(line) && c.courtClass !== "YUKSEK") return i;
  }
  const idx = courts.findIndex((c) => c.courtClass !== "YUKSEK");
  return idx;
}

const REF_LABEL_RE =
  /(esas|karar|dosya|sorusturma|takip)\s*(?:no|numarasi|sayisi|nosu)?\s*[:.]?\s*(\d{4}\s*\/\s*\d{1,7})(?!\d)/gu;
const REF_TRAIL_RE = /(?<![\d/])(\d{4} ?\/ ?\d{1,7})[ ]*(esas|e\.|karar|k\.|sorusturma|takip)/gu;

const REF_KIND: Readonly<Record<string, ReferenceKind>> = {
  esas: "ESAS",
  "e.": "ESAS",
  karar: "KARAR",
  "k.": "KARAR",
  dosya: "DOSYA",
  sorusturma: "SORUSTURMA",
  takip: "TAKIP",
};

function findReferences(text: NoticeText): ReferenceFact[] {
  const out: ReferenceFact[] = [];
  const seen = new Set<string>();
  const push = (kindRaw: string, valueRaw: string, start: number, end: number): void => {
    const kind = REF_KIND[kindRaw];
    if (kind === undefined) return;
    const value = valueRaw.replace(/\s+/gu, "");
    const key = `${kind} ${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...text.trimmedSpan(start, end), kind, value });
  };
  for (const m of text.folded.matchAll(REF_LABEL_RE)) {
    push(m[1]!, m[2]!, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  for (const m of text.folded.matchAll(REF_TRAIL_RE)) {
    push(m[2]!, m[1]!, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  "on bes": 15,
  onbes: 15,
  yirmi: 20,
  otuz: 30,
  altmis: 60,
};

const PERIOD_RE =
  /(?<![\d.])(\d{1,3}|on\s+bes|onbes|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yirmi|otuz|altmis)\s*(?:\(\s*[a-z0-9 ]{1,15}\s*\)\s*)?(gun|hafta|ay|yil)\w*\s+(?:[a-z]+\s+){0,2}?(?:icinde|icerisinde|zarfinda)/gu;

function findStatedPeriods(text: NoticeText): StatedPeriodFact[] {
  const out: StatedPeriodFact[] = [];
  for (const m of text.folded.matchAll(PERIOD_RE)) {
    const raw = m[1]!.replace(/\s+/gu, " ");
    const value = /^\d+$/u.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (value === undefined || value < 1) continue;
    const unit = m[2] as DeadlineUnit;
    out.push({ ...text.trimmedSpan(m.index ?? 0, (m.index ?? 0) + m[0].length), value, unit });
  }
  return out;
}

function periodDays(value: number, unit: DeadlineUnit): number | null {
  if (unit === "gun") return value;
  if (unit === "hafta") return value * 7;
  return null;
}

function samePeriod(a: { value: number; unit: DeadlineUnit }, b: { value: number; unit: DeadlineUnit }): boolean {
  const da = periodDays(a.value, a.unit);
  const db = periodDays(b.value, b.unit);
  if (da !== null && db !== null) return da === db;
  return a.value === b.value && a.unit === b.unit;
}

interface TypeSpec {
  type: ServedDocumentType;
  re: RegExp;
  /** Only in the receipt's evrak field (a bare "karar" is too generic for a heading). */
  fieldOnly?: boolean;
  /** Extra condition over the whole folded text. */
  requires?: RegExp[];
}

/** Most specific first: a generic "karar" is dropped when a specific type matched. */
const TYPE_SPECS: readonly TypeSpec[] = [
  { type: "KYOK", re: /kovusturmaya\s+yer\s+olmadig/u },
  { type: "THH_KARARI", re: /hakem\s+heyeti\s+karar/u },
  { type: "ARA_KARAR", re: /\bara\s+karar/u },
  { type: "CEVABA_CEVAP", re: /cevaba\s+cevap|ikinci\s+cevap\s+dilekces/u },
  { type: "CEVAP_DILEKCESI", re: /(?<!cevaba\s)(?<!ikinci\s)cevap\s+dilekces/u },
  { type: "ISTINAF_DILEKCESI", re: /istinaf\s+(?:basvuru\s+|talep\s+|kanun\s+yolu\s+)?dilekces/u },
  { type: "TEMYIZ_DILEKCESI", re: /temyiz\s+(?:basvuru\s+|talep\s+)?dilekces/u },
  { type: "DAVA_DILEKCESI", re: /dava\s+dilekces/u },
  { type: "BILIRKISI_RAPORU", re: /bilirkisi\s+(?:heyeti\s+|kurulu\s+)?(?:ek\s+)?rapor/u },
  { type: "ODEME_EMRI", re: /odeme\s+emri/u },
  { type: "VERGI_IHBARNAMESI", re: /(?:vergi|ceza)\s*(?:\/|ve)?\s*(?:ceza\s+)?ihbarname/u },
  { type: "KIYMET_TAKDIRI", re: /kiymet\s+takdir/u },
  { type: "ON_INCELEME_DAVETIYESI", re: /on\s+inceleme/u, requires: [/davetiye|durusma\s+(?:gun|tarih)|durusmaya\s+davet/u] },
  {
    type: "KIRA_IHTARNAMESI",
    re: /ihtarname/u,
    requires: [/kira/u, /(?:30|otuz)\s+gun|\b315\b/u],
  },
  {
    type: "FESIH_BILDIRIMI",
    re: /fesih\s+bildirim|(?:is|hizmet)\s+sozlesme\w*\s+(?:[a-z0-9.]+\s+){0,6}feshedil/u,
  },
  { type: "GEREKCELI_KARAR", re: /gerekceli\s+(?:karar|hukum)|\bilam\b/u },
  { type: "GEREKCELI_KARAR", re: /\bkarar\b|\bhukum\b/u, fieldOnly: true },
];

const EVRAK_FIELD_RE =
  /(?:teblig\s+(?:olunan|edilen|olunacak|edilecek)\s+evrak\w*(?:\s+(?:turu|cinsi|niteligi|adi))?|evrak\w*\s+(?:turu|cinsi|niteligi|adi|konusu|ozeti)|gonderilen\s+evrak\w*|tebligat\s+(?:konusu|icerigi|turu)|evrak)\s*[:=]/gu;

interface Zone {
  foundIn: DocumentTypeFact["foundIn"];
  start: number;
  end: number;
}

function evrakZones(text: NoticeText): Zone[] {
  const zones: Zone[] = [];
  for (const m of text.folded.matchAll(EVRAK_FIELD_RE)) {
    const valueStart = (m.index ?? 0) + m[0].length;
    let end = text.lineEnd(valueStart);
    if (text.folded.slice(valueStart, end).trim() === "") end = text.lineEnd(Math.min(text.length, end + 1));
    zones.push({ foundIn: "EVRAK_ALANI", start: m.index ?? 0, end: Math.min(end, valueStart + 240) });
  }
  return zones;
}

function odemeEmriKind(f: string): OdemeEmriKind | null {
  if (/\b6183\b|amme\s+alacag|vergi\s+dairesi|tahsil\s+dairesi/u.test(f)) return "AMME";
  if (/ornek\s*(?:no\s*)?[:.]?\s*13\b|kira\s+alacag|kiralanan|tahliye/u.test(f)) return "KIRA";
  if (/ornek\s*(?:no\s*)?[:.]?\s*(?:10|11|12)\b|kambiyo/u.test(f)) return "KAMBIYO";
  if (/ornek\s*(?:no\s*)?[:.]?\s*7\b|genel\s+haciz/u.test(f)) return "GENEL";
  return null;
}

function findDocumentTypes(text: NoticeText): DocumentTypeFact[] {
  const f = text.folded;
  const fromZones = (zones: Zone[]): DocumentTypeFact[] => {
    const facts = new Map<ServedDocumentType, DocumentTypeFact>();
    for (const zone of zones) {
      const slice = f.slice(zone.start, zone.end);
      let specificInZone = false;
      for (const spec of TYPE_SPECS) {
        if (spec.fieldOnly === true && (zone.foundIn !== "EVRAK_ALANI" || specificInZone)) continue;
        const m = firstMatch(spec.re, slice, (at) => zone.foundIn === "EVRAK_ALANI" || isTitleLine(text, zone.start + at));
        if (m === null) continue;
        if (spec.requires !== undefined && !spec.requires.every((re) => re.test(f))) continue;
        if (spec.type !== "GEREKCELI_KARAR") specificInZone = true;
        const matchStart = zone.start + (m.index ?? 0);
        const evidenceSpan =
          zone.foundIn === "EVRAK_ALANI"
            ? text.trimmedSpan(zone.start, zone.end)
            : text.trimmedSpan(text.lineStart(matchStart), text.lineEnd(matchStart));
        const existing = facts.get(spec.type);
        if (existing !== undefined) {
          if (!existing.evidence.some((e) => e.start === evidenceSpan.start)) existing.evidence.push(evidenceSpan);
          continue;
        }
        facts.set(spec.type, {
          type: spec.type,
          label: SERVED_DOCUMENT_TR[spec.type],
          foundIn: zone.foundIn,
          evidence: [evidenceSpan],
          ...(spec.type === "ODEME_EMRI" ? { odemeEmriKind: odemeEmriKind(f) } : {}),
        });
      }
    }
    // A specific kind of "karar" (KYÖK, hakem heyeti, ara karar) is not also a gerekçeli karar.
    if (facts.has("GEREKCELI_KARAR") && (facts.has("KYOK") || facts.has("THH_KARARI") || facts.has("ARA_KARAR"))) {
      const g = facts.get("GEREKCELI_KARAR")!;
      if (!/gerekceli/u.test(g.evidence.map((e) => foldText(e.quote)).join(" "))) facts.delete("GEREKCELI_KARAR");
    }
    return [...facts.values()];
  };

  const evrak = evrakZones(text);
  const DECISIONS: ServedDocumentType[] = ["GEREKCELI_KARAR", "KYOK", "THH_KARARI", "ARA_KARAR"];
  const PETITIONS: ServedDocumentType[] = ["CEVAP_DILEKCESI", "CEVABA_CEVAP", "ISTINAF_DILEKCESI", "TEMYIZ_DILEKCESI", "DAVA_DILEKCESI"];
  if (evrak.length > 0) {
    const types = fromZones(evrak);
    if (types.length > 0) return types;
  }
  const headingEnd = Math.min(text.length, HEADING_ZONE_CODE_POINTS);
  let heading = fromZones([{ foundIn: "BASLIK", start: 0, end: headingEnd }]);
  const head = f.slice(0, headingEnd);
  const has = (t: ServedDocumentType): boolean => heading.some((x) => x.type === t);
  // A decision narrates the petitions, reports and payment orders of the
  // case; a petition names the decision or order it attacks. Once the
  // document's OWN kind is known, the kinds it merely mentions are dropped.
  const addressee = /(?:mahkemesi|hakimligi|baskanligi|mudurlugu)\s*'?\s*n[ea]\b/u.exec(head);
  const isPetition = addressee !== null && /\bdavaci\b/u.test(head) && /\bdavali\b/u.test(head);
  if (heading.some((x) => DECISIONS.includes(x.type))) {
    heading = heading.filter((x) => DECISIONS.includes(x.type));
  } else if (isPetition) {
    heading = heading.filter((x) => PETITIONS.includes(x.type));
  }
  // A first page with ESAS NO + KARAR NO + KARAR TARİHİ is a decision.
  if (!has("GEREKCELI_KARAR") && !has("KYOK") && !has("THH_KARARI") && !has("ARA_KARAR")) {
    const kararNo = /karar\s+no\s*[:.]/u.exec(head);
    if (/esas\s+no\s*[:.]/u.test(head) && kararNo !== null && /karar\s+tarihi/u.test(head)) {
      const at = kararNo.index ?? 0;
      heading.push({
        type: "GEREKCELI_KARAR",
        label: SERVED_DOCUMENT_TR.GEREKCELI_KARAR,
        foundIn: "BASLIK",
        evidence: [text.trimmedSpan(text.lineStart(at), text.lineEnd(at))],
      });
    }
  }
  // A petition addressed to a court ("… MAHKEMESİ'NE") with DAVACI and DAVALI
  // labels and no other petition kind is a dava dilekçesi.
  if (!PETITIONS.some(has) && !DECISIONS.some(has)) {
    if (isPetition && addressee !== null) {
      const at = addressee.index ?? 0;
      heading.push({
        type: "DAVA_DILEKCESI",
        label: SERVED_DOCUMENT_TR.DAVA_DILEKCESI,
        foundIn: "BASLIK",
        evidence: [text.trimmedSpan(text.lineStart(at), text.lineEnd(at))],
      });
    }
  }
  return heading;
}

/** First match of `re` in `slice` whose offset passes `accept`. */
function firstMatch(re: RegExp, slice: string, accept: (at: number) => boolean): RegExpExecArray | null {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of slice.matchAll(global)) {
    if (accept(m.index ?? 0)) return m as unknown as RegExpExecArray;
  }
  return null;
}

/**
 * A heading, not running prose: a short line, or a line written mostly in
 * capitals. "Davacı vekili dava dilekçesinde özetle …" is prose and must not
 * make a decision look like a petition.
 */
function isTitleLine(text: NoticeText, offset: number): boolean {
  const line = text.slice(text.lineStart(offset), text.lineEnd(offset)).trim();
  if (Array.from(line).length <= 60) return true;
  const letters = Array.from(line).filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return false;
  const upper = letters.filter((ch) => ch === ch.toLocaleUpperCase("tr") && ch !== ch.toLocaleLowerCase("tr")).length;
  return upper / letters.length >= 0.7;
}

function foldText(s: string): string {
  return Array.from(s.normalize("NFC")).map(foldCodePoint).join("");
}

function findNotes(text: NoticeText, eContext: boolean): NoticeNote[] {
  const f = text.folded;
  const notes: NoticeNote[] = [];
  const spanOf = (re: RegExp): QuotedSpan | null => {
    const m = re.exec(f);
    if (m === null) return null;
    const at = m.index ?? 0;
    return text.trimmedSpan(Math.max(text.lineStart(at), at - 60), Math.min(text.lineEnd(at), at + m[0].length + 60));
  };
  if (eContext) {
    notes.push({
      code: "E_TEBLIGAT",
      text: "Belge bir elektronik tebligat kaydı gibi görünüyor: süre ulaşma tarihinden değil, ulaşma tarihini izleyen beşinci günün sonundaki tebliğ tarihinden başlar.",
      evidence: spanOf(E_CONTEXT_RE),
    });
  }
  const tk21 = spanOf(/(?:tebligat\s+kanunu\w*\s+)?21\s*(?:\.\s*madde|\/\s*[12]\b)|\bm\s*\.\s*21\b/u);
  if (tk21 !== null && /kapi\w*\s+(?:\w+\s+){0,2}yapistir|muhtar/u.test(f)) {
    notes.push({
      code: "TK_21",
      text: "Tebligat Kanunu m.21 ibaresi var (muhtara bırakma / kapıya yapıştırma): tebliğ, ihbarnamenin kapıya yapıştırıldığı tarihte yapılmış sayılır. Mazbatadaki tarihin bu tarih olduğunu kontrol edin.",
      evidence: tk21,
    });
  }
  const tk35 = spanOf(/(?:tebligat\s+kanunu\w*\s+)?35\s*\.\s*madde|\bm\s*\.\s*35\b/u);
  if (tk35 !== null && /tebligat/u.test(f)) {
    notes.push({
      code: "TK_35",
      text: "Tebligat Kanunu m.35 ibaresi var (adres değişikliği): tebliğ, tebliğ evrakının bir nüshasının eski adrese yapıştırıldığı tarihte yapılmış sayılır. Mazbatadaki tarihi bu yönden kontrol edin.",
      evidence: tk35,
    });
  }
  const tefhim = spanOf(/yuzune\s+karsi|tefhim\s+(?:olundu|edildi|olunmustur)|acikca\s+okunup/u);
  if (tefhim !== null) {
    notes.push({
      code: "TEFHIM",
      text: "Kararın yüze karşı okunduğu (tefhim) yazıyor: bazı süreler (ör. CMK m.273, m.291) tefhimden başlar. Tefhim tarihini kullanmak isterseniz kendiniz girin; ColleX karar tarihini başlangıç olarak almaz.",
      evidence: tefhim,
    });
  }
  const kesin = spanOf(/kesin\s+sure/u);
  if (kesin !== null) {
    notes.push({
      code: "KESIN_SURE",
      text: "Belgede “kesin süre” ibaresi var (HMK m.94): süreyi ara kararın kendisi belirler; ColleX bu süreyi kurallardan önermez — kararda yazan süreyi elle girin.",
      evidence: kesin,
    });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Rule proposals
// ---------------------------------------------------------------------------

interface RuleSuggestion {
  ruleId: string;
  reasonTr: string;
}

const GEREKCELI_BY_COURT: Readonly<Partial<Record<CourtClass, RuleSuggestion>>> = {
  HUKUK_ILK: { ruleId: "hmk-istinaf", reasonTr: "Hukuk ilk derece mahkemesinin gerekçeli kararı tebliğ edilmiş: istinaf süresi tebliğden başlar." },
  BAM_HUKUK: { ruleId: "hmk-temyiz", reasonTr: "Bölge adliye mahkemesi hukuk dairesinin kararı tebliğ edilmiş: temyiz süresi tebliğden başlar." },
  ICRA_HUKUK: { ruleId: "iik-icra-mahkemesi-istinaf", reasonTr: "İcra hukuk mahkemesinin kararı tebliğ edilmiş: istinaf süresi tebliğden başlar." },
  CEZA_ILK: { ruleId: "cmk-istinaf", reasonTr: "Ceza mahkemesinin kararı tebliğ edilmiş: istinaf süresi (hüküm yokluğunda verildiyse) tebliğden başlar." },
  SULH_CEZA: { ruleId: "cmk-itiraz", reasonTr: "Sulh ceza hâkimliğinin kararı tebliğ edilmiş: itiraz süresi öğrenmeden (tebliğden) başlar." },
  BAM_CEZA: { ruleId: "cmk-temyiz", reasonTr: "Bölge adliye mahkemesi ceza dairesinin kararı tebliğ edilmiş: temyiz süresi (yokluğunda verildiyse) tebliğden başlar." },
  IDARI_ILK: { ruleId: "iyuk-istinaf", reasonTr: "İdare / vergi mahkemesinin kararı tebliğ edilmiş: istinaf süresi tebliğden başlar (kararın doğrudan temyize tabi olup olmadığını kontrol edin)." },
  BAM_IDARI: { ruleId: "iyuk-temyiz", reasonTr: "Bölge idare mahkemesinin kararı tebliğ edilmiş: temyiz süresi tebliğden başlar." },
  THH: { ruleId: "thh-itiraz", reasonTr: "Tüketici hakem heyeti kararı tebliğ edilmiş: itiraz süresi tebliğden başlar." },
};

const ODEME_EMRI_RULES: Readonly<Record<OdemeEmriKind, RuleSuggestion>> = {
  GENEL: { ruleId: "iik-odeme-emri-itiraz", reasonTr: "Genel haciz yoluyla takipte ödeme emri tebliğ edilmiş: itiraz süresi tebliğden başlar." },
  KAMBIYO: { ruleId: "iik-kambiyo-itiraz", reasonTr: "Kambiyo senetlerine özgü haciz yolunda ödeme emri tebliğ edilmiş: itiraz süresi tebliğden başlar." },
  KIRA: { ruleId: "iik-kira-odeme-emri-itiraz", reasonTr: "Kira alacağı için ödeme emri tebliğ edilmiş: itiraz süresi tebliğden başlar." },
  AMME: { ruleId: "amme-odeme-emri-dava", reasonTr: "6183 sayılı Kanun uyarınca ödeme emri tebliğ edilmiş: dava açma süresi tebliğden başlar." },
};

const HUKUK_LIKE: ReadonlySet<CourtClass | null> = new Set<CourtClass | null>([null, "HUKUK_ILK", "BAM_HUKUK", "BAM", "ICRA_HUKUK"]);
const IDARI: ReadonlySet<CourtClass | null> = new Set<CourtClass | null>(["IDARI_ILK", "BAM_IDARI"]);

function suggestionsFor(doc: DocumentTypeFact, court: CourtClass | null): RuleSuggestion[] {
  switch (doc.type) {
    case "GEREKCELI_KARAR": {
      const s = court === null ? undefined : GEREKCELI_BY_COURT[court];
      return s === undefined ? [] : [s];
    }
    case "DAVA_DILEKCESI":
      if (IDARI.has(court)) return [{ ruleId: "iyuk-cevap", reasonTr: "İdari yargıda dava dilekçesi tebliğ edilmiş: savunma süresi tebliğden başlar." }];
      if (HUKUK_LIKE.has(court)) return [{ ruleId: "hmk-cevap", reasonTr: "Dava dilekçesi tebliğ edilmiş: cevap dilekçesi süresi tebliğden başlar." }];
      return [];
    case "CEVAP_DILEKCESI":
      if (IDARI.has(court)) return [{ ruleId: "iyuk-cevap", reasonTr: "İdari yargıda savunma / cevap dilekçesi tebliğ edilmiş: cevap süresi tebliğden başlar." }];
      if (HUKUK_LIKE.has(court)) return [{ ruleId: "hmk-cevaba-cevap", reasonTr: "Cevap dilekçesi tebliğ edilmiş: cevaba cevap (replik) süresi tebliğden başlar." }];
      return [];
    case "CEVABA_CEVAP":
      if (HUKUK_LIKE.has(court)) return [{ ruleId: "hmk-cevaba-cevap", reasonTr: "Cevaba cevap dilekçesi tebliğ edilmiş: ikinci cevap (düplik) süresi tebliğden başlar." }];
      return [];
    case "ISTINAF_DILEKCESI":
      if (HUKUK_LIKE.has(court)) return [{ ruleId: "hmk-istinafa-cevap", reasonTr: "İstinaf dilekçesi tebliğ edilmiş: cevap süresi tebliğden başlar." }];
      return [];
    case "TEMYIZ_DILEKCESI":
      if (HUKUK_LIKE.has(court)) return [{ ruleId: "hmk-temyize-cevap", reasonTr: "Temyiz dilekçesi tebliğ edilmiş: cevap süresi tebliğden başlar." }];
      return [];
    case "BILIRKISI_RAPORU":
      if (HUKUK_LIKE.has(court)) return [{ ruleId: "hmk-bilirkisi-rapor-itiraz", reasonTr: "Bilirkişi raporu tebliğ edilmiş: rapora itiraz süresi tebliğden başlar." }];
      return [];
    case "ODEME_EMRI": {
      const kind = doc.odemeEmriKind ?? null;
      if (kind !== null) return [ODEME_EMRI_RULES[kind]];
      return [
        { ...ODEME_EMRI_RULES.GENEL, reasonTr: "Ödeme emri tebliğ edilmiş; örnek numarası okunamadı — genel haciz yolu ise bu süre." },
        { ...ODEME_EMRI_RULES.KAMBIYO, reasonTr: "Ödeme emri tebliğ edilmiş; örnek numarası okunamadı — kambiyo senedine dayanıyorsa bu (daha kısa) süre." },
      ];
    }
    case "KYOK":
      return [{ ruleId: "cmk-kyok-itiraz", reasonTr: "Kovuşturmaya yer olmadığına dair karar tebliğ edilmiş: itiraz süresi tebliğden başlar." }];
    case "THH_KARARI":
      return [{ ruleId: "thh-itiraz", reasonTr: "Tüketici hakem heyeti kararı tebliğ edilmiş: itiraz süresi tebliğden başlar." }];
    case "VERGI_IHBARNAMESI":
      return [{ ruleId: "iyuk-dava-vergi", reasonTr: "Vergi / ceza ihbarnamesi tebliğ edilmiş: vergi mahkemesinde dava açma süresi tebliğden başlar." }];
    case "KIYMET_TAKDIRI":
      return [{ ruleId: "iik-kiymet-takdiri-sikayet", reasonTr: "Kıymet takdiri raporu tebliğ edilmiş: şikâyet süresi tebliğden başlar." }];
    case "ON_INCELEME_DAVETIYESI":
      return [{ ruleId: "hmk-on-inceleme-belge", reasonTr: "Ön inceleme davetiyesi tebliğ edilmiş: belge sunma kesin süresi tebliğden başlar." }];
    case "KIRA_IHTARNAMESI":
      return [{ ruleId: "tbk-kira-odeme-suresi", reasonTr: "Kira bedelinin ödenmesi için ihtarname tebliğ edilmiş: verilen ödeme süresi tebliğden başlar." }];
    case "FESIH_BILDIRIMI":
      return [{ ruleId: "is-ise-iade-arabulucu-basvuru", reasonTr: "İş sözleşmesinin feshi bildirilmiş: işe iade için arabulucuya başvuru süresi fesih bildiriminin tebliğinden başlar." }];
    case "ARA_KARAR":
      return [];
    default:
      return [];
  }
}

/** Every rule id this module can suggest — validated at module load. */
export const NOTICE_RULE_IDS: readonly string[] = (() => {
  const ids = new Set<string>();
  for (const s of Object.values(GEREKCELI_BY_COURT)) if (s !== undefined) ids.add(s.ruleId);
  for (const s of Object.values(ODEME_EMRI_RULES)) ids.add(s.ruleId);
  for (const t of Object.keys(SERVED_DOCUMENT_TR) as ServedDocumentType[]) {
    for (const court of [null, "HUKUK_ILK", "IDARI_ILK"] as Array<CourtClass | null>) {
      for (const s of suggestionsFor({ type: t, label: "", foundIn: "BASLIK", evidence: [], odemeEmriKind: null }, court)) {
        ids.add(s.ruleId);
      }
    }
  }
  for (const id of ids) {
    const rule = findDeadlineRule(id, DEADLINE_RULES);
    if (rule === undefined || !rule.computable) {
      throw new Error(`serviceNotice: suggested rule '${id}' is missing or not computable`);
    }
  }
  return [...ids].sort();
})();

const START_KIND_TR: Readonly<Record<string, string>> = {
  teblig: "tebliğ",
  tefhim: "tefhim (kararın yüze karşı okunması)",
  ogrenme: "öğrenme",
  karar: "karar / işlem tarihi",
};

function proposalWarnings(rule: DeadlineRule, stated: readonly StatedPeriodFact[]): { warnings: string[]; why: ProposalWhy[] } {
  const warnings: string[] = [];
  const why: ProposalWhy[] = [];
  if (rule.startKind !== "teblig") {
    warnings.push(
      `Bu sürenin başlangıcı kuralda “${START_KIND_TR[rule.startKind] ?? rule.startKind}” olarak geçiyor; ColleX tebliğ tarihinden hesapladı. Sürenin sizin durumunuzda tebliğden başlayıp başlamadığını kontrol edin.`,
    );
  }
  if (stated.length > 0) {
    const match = stated.find((p) => samePeriod(p, rule.period));
    if (match !== undefined) {
      why.push({ ...match, label: "Belgede yazan süre kuralla aynı" });
    } else {
      const first = stated[0]!;
      warnings.push(
        `Belgede “${first.quote}” yazıyor; önerilen kuralın süresi ${rule.periodLabel}. Belgedeki sürenin hangi işlem için yazıldığını kontrol edin.`,
      );
    }
  }
  return { warnings, why };
}

function matterItemFor(
  rule: DeadlineRule,
  computation: DeadlineComputation,
  tebligDate: string,
  candidate: DateCandidate | null,
  source: NoticeSource,
  documentType: ServedDocumentType | null,
): NoticeMatterItem {
  const first = candidate?.evidence[0] ?? null;
  return {
    kind: "deadline",
    payload: {
      // Title + dueDate make the matter-items dedupe key: the same
      // confirmation pressed twice is recognised and not filed again.
      title: `${rule.title} — tebliğ ${toTrDate(parseIsoDate(tebligDate)!)}`,
      dueDate: computation.dueDate,
      ruleId: rule.id,
      startDate: tebligDate,
      computed: computation,
      status: "acik",
      source: "hesap",
      teblig: {
        reader: NOTICE_READER_VERSION,
        dateSource: candidate === null ? "AVUKAT" : "BELGE",
        kind: candidate?.kind ?? null,
        candidateId: candidate?.id ?? null,
        printedDate: candidate?.printedDate ?? null,
        fileId: source.fileId ?? null,
        quote: first?.quote ?? null,
        start: first?.start ?? null,
        end: first?.end ?? null,
        documentType,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ReadNoticeOptions {
  rules?: readonly DeadlineRule[];
}

/**
 * Read a served document and propose deadlines. Throws `NoticeInputError`
 * only for a bad CHOICE (unknown candidate / rule); an unreadable document
 * is a normal answer with `OKUNAMADI` statuses.
 */
export function readServiceNotice(
  rawText: string,
  source: NoticeSource,
  choice: NoticeChoice = {},
  options: ReadNoticeOptions = {},
): NoticeReading {
  const rules = options.rules ?? DEADLINE_RULES;
  const text = new NoticeText(rawText.normalize("NFC"));
  const f = text.folded;
  const eContext = E_CONTEXT_RE.test(f);
  const tebligatContext = TEBLIGAT_CONTEXT_RE.test(f);

  // ---- dates ----
  const readings = findDates(text).map((d) => readDate(text, d, eContext, tebligatContext));
  const dateCandidates = buildCandidates(readings);
  const ignoredDates: IgnoredDate[] = readings
    .filter((r) => r.ignored !== undefined)
    .map((r) => ({
      ...r.ignored!.span,
      date: toIsoDate(r.found.date),
      dateTr: toTrDate(r.found.date),
      reason: r.ignored!.reason,
      reasonTr: IGNORED_REASON_TR[r.ignored!.reason],
    }));

  // ---- facts ----
  const rawCourts = findCourts(text);
  const primaryIndex = pickPrimaryCourt(text, rawCourts);
  const courts: CourtFact[] = rawCourts.map((c, i) => ({ ...c, primary: i === primaryIndex }));
  const primaryCourt = primaryIndex >= 0 ? courts[primaryIndex]! : null;
  const documentTypes = findDocumentTypes(text);
  const statedPeriods = findStatedPeriods(text);
  const facts: NoticeFacts = {
    eTebligat: eContext,
    tebligatDocument: tebligatContext,
    courts,
    references: findReferences(text),
    documentTypes,
    statedPeriods,
    notes: findNotes(text, eContext),
  };

  const messages: string[] = [];

  // ---- the start date ----
  if (choice.candidateId !== undefined && choice.tebligDate !== undefined) {
    throw new NoticeInputError(
      "INVALID_REQUEST",
      "Belgedeki bir tarihi seçin ya da tarihi elle girin — ikisi birlikte gönderilemez.",
      "tebligDate",
    );
  }
  let dateStatus: NoticeDateStatus;
  let chosen: DateCandidate | null = null;
  let tebligDate: string | null = null;
  if (choice.candidateId !== undefined) {
    chosen = dateCandidates.find((c) => c.id === choice.candidateId) ?? null;
    if (chosen === null) {
      throw new NoticeInputError(
        "INVALID_REQUEST",
        "Seçilen tarih bu belgenin okumasında yok; belgeyi yeniden okutup listeden seçin.",
        "candidateId",
      );
    }
    dateStatus = "AVUKAT_SECTI";
    tebligDate = chosen.tebligDate;
  } else if (choice.tebligDate !== undefined) {
    if (parseIsoDate(choice.tebligDate) === undefined) {
      throw new NoticeInputError(
        "INVALID_REQUEST",
        "Tebliğ tarihi geçersiz; YYYY-AA-GG biçiminde gerçek bir takvim günü girin (ör. 2026-10-14).",
        "tebligDate",
      );
    }
    dateStatus = "AVUKAT_GIRDI";
    tebligDate = choice.tebligDate;
  } else if (dateCandidates.length === 1) {
    dateStatus = "OKUNDU";
    chosen = dateCandidates[0]!;
    tebligDate = chosen.tebligDate;
  } else if (dateCandidates.length > 1) {
    dateStatus = "SECIM_GEREKLI";
    messages.push(
      `Belgede birbirinden farklı ${dateCandidates.length} tebliğ tarihi okundu. Alıntılara bakıp hangisinin doğru olduğunu seçin; seçmeden süre hesaplanmaz.`,
    );
  } else {
    dateStatus = "OKUNAMADI";
    messages.push(
      "Belgede tebliğ tarihi okunamadı. Tebliğ tarihini (e-tebligatta ulaşma tarihine beş gün ekleyerek) kendiniz girin; ColleX tarih tahmin etmez.",
    );
  }

  // ---- the rules ----
  let documentStatus: NoticeDocumentStatus;
  const suggestions: Array<RuleSuggestion & { origin: "BELGE" | "AVUKAT"; doc: DocumentTypeFact | null }> = [];
  if (choice.ruleId !== undefined) {
    const rule = findDeadlineRule(choice.ruleId, rules);
    if (rule === undefined) {
      throw new NoticeInputError("INVALID_REQUEST", "Bilinmeyen süre kuralı; listeden bir kural seçin.", "ruleId");
    }
    if (!rule.computable) {
      throw new NoticeInputError(
        "RULE_NOT_COMPUTABLE",
        `“${rule.title}” sabit bir süre değil; ColleX bu kural için son gün hesaplamaz.`,
        "ruleId",
      );
    }
    documentStatus = "AVUKAT_SECTI";
    suggestions.push({ ruleId: rule.id, reasonTr: "Kuralı avukat seçti.", origin: "AVUKAT", doc: documentTypes[0] ?? null });
  } else {
    const courtClass = primaryCourt?.courtClass ?? null;
    for (const doc of documentTypes) {
      for (const s of suggestionsFor(doc, courtClass)) {
        if (suggestions.some((x) => x.ruleId === s.ruleId)) continue;
        suggestions.push({ ...s, origin: "BELGE", doc });
      }
    }
    documentStatus = documentTypes.length > 0 ? "OKUNDU" : "OKUNAMADI";
    if (documentTypes.length === 0) {
      messages.push("Tebliğ edilen belgenin türü okunamadı. Süre kuralını listeden kendiniz seçin.");
    } else if (suggestions.length === 0) {
      const names = documentTypes.map((d) => d.label).join(", ");
      messages.push(
        documentTypes.some((d) => d.type === "GEREKCELI_KARAR") && primaryCourt === null
          ? `Tebliğ edilen belge: ${names}. Kararı veren mahkeme okunamadığı için kanun yolu süresi önerilmedi; süre kuralını listeden kendiniz seçin.`
          : `Tebliğ edilen belge: ${names}. Bu belge için ColleX'in kurallarında tebliğden başlayan bir süre yok; gerekiyorsa kuralı listeden kendiniz seçin.`,
      );
    }
  }

  const proposals: DeadlineProposal[] = suggestions.map((s) => {
    const rule = findDeadlineRule(s.ruleId, rules)!;
    const why: ProposalWhy[] = [];
    if (s.doc !== null && s.origin === "BELGE") {
      for (const e of s.doc.evidence) why.push({ ...e, label: `Tebliğ edilen belge: ${s.doc.label}` });
      if (s.doc.type === "ODEME_EMRI" && (s.doc.odemeEmriKind ?? null) === null) {
        // nothing more to quote: the örnek number was not readable
      }
    }
    if (primaryCourt !== null && s.origin === "BELGE") {
      why.push({ start: primaryCourt.start, end: primaryCourt.end, quote: primaryCourt.quote, label: `Mahkeme / merci: ${primaryCourt.classLabel}` });
    }
    const pw = proposalWarnings(rule, statedPeriods);
    why.push(...pw.why);
    let computation: DeadlineComputation | null = null;
    let matterItem: NoticeMatterItem | null = null;
    if (tebligDate !== null) {
      computation = computeDeadline({ ruleId: rule.id, startDate: tebligDate }, { rules });
      matterItem = matterItemFor(rule, computation, tebligDate, chosen, source, s.doc?.type ?? null);
    }
    return {
      ruleId: rule.id,
      rule,
      reasonTr: s.reasonTr,
      origin: s.origin,
      why,
      warnings: pw.warnings,
      computation,
      matterItem,
    };
  });

  if (tebligDate !== null && proposals.length > 1) {
    messages.push(
      `Belge ${proposals.length} ayrı süre kuralına uyuyor; yalnızca durumunuza uyanı dosyaya kaydedin.`,
    );
  }
  if (proposals.length > 0 && tebligDate !== null) {
    messages.push("Hiçbir şey kendiliğinden kaydedilmedi: süreyi dosyaya eklemek için onaylayın.");
  }

  const parsedTeblig = tebligDate === null ? undefined : parseIsoDate(tebligDate);
  return {
    reader: NOTICE_READER_VERSION,
    text: {
      source: source.source,
      fileId: source.fileId ?? null,
      fileName: source.fileName ?? null,
      codePoints: text.length,
      sha256: sha256(text.nfc),
      gapCodePoints: source.gapCodePoints ?? 0,
    },
    dateStatus,
    documentStatus,
    tebligDate,
    tebligDateTr: parsedTeblig === undefined ? null : toTrDate(parsedTeblig),
    readyToConfirm: tebligDate !== null && proposals.some((p) => p.matterItem !== null),
    dateCandidates,
    ignoredDates,
    facts,
    proposals,
    messages,
    disclaimer: DEADLINE_DISCLAIMER,
  };
}

/**
 * Rebuild one document's canonical text from its chunks: each chunk's text
 * is placed at its own code-point offsets, and any gap between chunks (text
 * the chunker did not keep) is filled with line breaks so every offset still
 * points at the same place in the stored document.
 */
export function textFromChunks(
  chunks: ReadonlyArray<{ text: string; startChar: number; endChar: number; ordinal: number }>,
): { text: string; gapCodePoints: number } {
  const sorted = [...chunks].sort((a, b) => a.startChar - b.startChar || a.ordinal - b.ordinal);
  const out: string[] = [];
  let cursor = 0;
  let gaps = 0;
  for (const chunk of sorted) {
    const cps = Array.from(chunk.text);
    const consistent = chunk.endChar - chunk.startChar === cps.length && chunk.startChar >= cursor;
    if (!consistent) {
      // Offsets we cannot trust: append after a separator (offsets become
      // relative to the rebuilt text, which is what every quote is sliced from).
      if (out.length > 0) {
        out.push("\n");
        gaps += 1;
        cursor += 1;
      }
      out.push(...cps);
      cursor += cps.length;
      continue;
    }
    while (cursor < chunk.startChar) {
      out.push("\n");
      gaps += 1;
      cursor += 1;
    }
    out.push(...cps);
    cursor += cps.length;
  }
  return { text: out.join(""), gapCodePoints: gaps };
}
