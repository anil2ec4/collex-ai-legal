/**
 * Masking client identifiers BEFORE anything leaves the machine (W14 B-23).
 *
 * Why this is not optional, and not a nicety
 * ------------------------------------------
 * TRMARKET read the Ankara Barosu HUBİTEM guide v1.0 word for word:
 * "müvekkillere ilişkin her türlü kişisel bilgi anonim hale getirilmeli ve
 * müvekkillerin kimliğinin saptanmasında kullanılabilecek veriler yapay zekâ
 * girdisinde yer almamalıdır." The TBB published its own AI guidance on
 * 28.08.2026 (four risk tiers; no foreign server without adequate
 * safeguards; final responsibility stays with the lawyer). And under KVKK
 * m.9 as amended by law 7499, explicit consent is now the EXCEPTION, not the
 * general rule, for a transfer abroad — the routine instrument is a standard
 * contract plus a five-working-day notification, and **the data controller
 * is the lawyer**, not ColleX.
 *
 * Until this module existed, the cloud lane had a per-request consent
 * checkbox and nothing else: the document went out as written, names and
 * identity numbers included.
 *
 * What it is, deliberately
 * ------------------------
 * PURE, RULE-BASED, LOCAL. No model, no network, no heuristics that need a
 * cloud round trip — masking that needed the cloud to decide what to hide
 * would be self-defeating. That also means it is BOUNDED, not perfect, and
 * the API says so: `maskDocumentText` reports what it replaced so the lawyer
 * can read the preview and decide. The product's answer to "is this
 * complete?" is the preview, not a promise.
 *
 * Turkish identifier shapes
 * -------------------------
 *   TCKN  11 digits, first digit non-zero (the checksum is NOT verified —
 *         a near-miss identity number is exactly as sensitive as a valid one)
 *   VKN   10 digits
 *   IBAN  TR + 24 digits, optionally in groups of four
 *   phone +90/0 followed by 10 digits, spaces/dashes/parentheses allowed
 *
 * Party names come from the matter (client / opposing party) and are
 * replaced with role placeholders, so the model still sees WHO IS WHO
 * without learning their names.
 */

/** Placeholders. Uppercase Turkish role words, stable and greppable. */
export const MASK_CLIENT = "[MÜVEKKİL]";
export const MASK_OPPOSING = "[KARŞI TARAF]";
export const MASK_TCKN = "[TCKN]";
export const MASK_VKN = "[VKN]";
export const MASK_IBAN = "[IBAN]";
export const MASK_PHONE = "[TELEFON]";

export type MaskKind = "tckn" | "vkn" | "iban" | "phone" | "client" | "opposing";

export interface MaskCount {
  kind: MaskKind;
  /** Human label for the preview panel. */
  label: string;
  count: number;
}

export interface MaskResult {
  /** The text as it would be sent. */
  text: string;
  /** What was replaced, in a stable order, with counts. */
  masked: MaskCount[];
  /** True when nothing matched — the preview says so rather than looking broken. */
  clean: boolean;
}

export interface MaskParties {
  /** Client name(s) from the matter. */
  client?: readonly string[];
  /** Opposing party name(s) from the matter. */
  opposing?: readonly string[];
}

const LABELS: Record<MaskKind, string> = {
  tckn: "T.C. kimlik numarası",
  vkn: "vergi kimlik numarası",
  iban: "IBAN",
  phone: "telefon numarası",
  client: "müvekkil adı",
  opposing: "karşı taraf adı",
};

/**
 * IBAN first (it contains 24 digits and would otherwise be eaten by the
 * numeric rules), then phone (its +90 prefix makes it unambiguous), then the
 * bare 11- and 10-digit runs. Order matters and is asserted by the tests.
 */
const IBAN_RE = /\bTR\s?\d{2}(?:[ -]?\d{4}){5}[ -]?\d{2}\b/giu;
const PHONE_RE = /(?:\+90|0)[ ()\-.]?\d{3}[ ()\-.]?\d{3}[ .\-]?\d{2}[ .\-]?\d{2}\b/gu;
/** 11 digits, first non-zero. Not preceded/followed by another digit. */
const TCKN_RE = /(?<![\d.,])[1-9]\d{10}(?![\d.,])/gu;
/** 10 digits. */
const VKN_RE = /(?<![\d.,])\d{10}(?![\d.,])/gu;

/** Escape a party name for use inside a RegExp. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Case-insensitive pattern for a Turkish name, built letter by letter.
 *
 * The `i` RegExp flag is NOT enough here and getting this wrong would be a
 * silent leak. Unicode default case folding pairs `i`↔`I` and `ı` has no
 * ASCII partner, so "Ali Yılmaz" written as "ALİ YILMAZ" — the ordinary way
 * a party is named in a Turkish petition header — does not match under `/i`
 * at all, and the name would have gone to the model unmasked.
 *
 * So every letter becomes an explicit class of its Turkish case pair, and no
 * `i` flag is used.
 */
const TR_CASE_PAIRS: Record<string, string> = {
  i: "iİ", "İ": "iİ",
  "ı": "ıI", I: "ıI",
  "ş": "şŞ", "Ş": "şŞ",
  "ğ": "ğĞ", "Ğ": "ğĞ",
  "ü": "üÜ", "Ü": "üÜ",
  "ö": "öÖ", "Ö": "öÖ",
  "ç": "çÇ", "Ç": "çÇ",
};

function turkishNamePattern(name: string): string {
  let out = "";
  for (const ch of name) {
    const pair = TR_CASE_PAIRS[ch];
    if (pair !== undefined) {
      out += `[${pair}]`;
      continue;
    }
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower !== upper && lower.length === 1 && upper.length === 1) {
      out += `[${escapeRe(lower)}${escapeRe(upper)}]`;
      continue;
    }
    out += escapeRe(ch);
  }
  return out;
}

/**
 * Turkish-safe casefold for name matching. `toLowerCase()` maps 'İ' to
 * 'i̇' (i + combining dot) and 'I' to 'i', so a name written in capitals in
 * one document and mixed case in another would not match; upper-casing the
 * Turkish way and comparing that is the reliable direction here.
 */
function foldTr(value: string): string {
  return value
    .replace(/i/gu, "İ")
    .replace(/ı/gu, "I")
    .toUpperCase();
}

/**
 * Build a name matcher that also catches the name written in a different
 * case. Only names of 3+ characters are used: a two-letter "name" would
 * match inside ordinary words and shred the document.
 */
function nameMatchers(names: readonly string[]): { re: RegExp; source: string }[] {
  const out: { re: RegExp; source: string }[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 3) continue;
    const key = foldTr(name);
    if (seen.has(key)) continue;
    seen.add(key);
    // Match the whole name, and each of its words of 3+ characters, so
    // "Ali Yılmaz" also masks a later bare "Yılmaz".
    const parts = [name, ...name.split(/\s+/u).filter((w) => w.length >= 3)];
    for (const part of parts) {
      const partKey = foldTr(part);
      if (out.some((m) => m.source === partKey)) continue;
      out.push({ re: new RegExp(turkishNamePattern(part), "gu"), source: partKey });
    }
  }
  // Longest first: "Ali Yılmaz" must be replaced before a bare "Yılmaz".
  return out.sort((a, b) => b.source.length - a.source.length);
}

/**
 * Mask identifiers and party names in `text`.
 *
 * Never throws, never calls out. The result is what the console shows the
 * lawyer as a PREVIEW: they see exactly what would be sent, and choose
 * "Maskele ve gönder" or "Maskelemeden gönder". There is no third option
 * where something is sent without being shown.
 */
export function maskDocumentText(text: string, parties: MaskParties = {}): MaskResult {
  const counts = new Map<MaskKind, number>();
  const bump = (kind: MaskKind): void => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  };

  let out = text;
  // Party names FIRST: a name is the strongest identifier and must not be
  // left behind because a number replacement changed the offsets.
  for (const matcher of nameMatchers(parties.client ?? [])) {
    out = out.replace(matcher.re, () => {
      bump("client");
      return MASK_CLIENT;
    });
  }
  for (const matcher of nameMatchers(parties.opposing ?? [])) {
    out = out.replace(matcher.re, () => {
      bump("opposing");
      return MASK_OPPOSING;
    });
  }
  out = out.replace(IBAN_RE, () => {
    bump("iban");
    return MASK_IBAN;
  });
  out = out.replace(PHONE_RE, () => {
    bump("phone");
    return MASK_PHONE;
  });
  out = out.replace(TCKN_RE, () => {
    bump("tckn");
    return MASK_TCKN;
  });
  out = out.replace(VKN_RE, () => {
    bump("vkn");
    return MASK_VKN;
  });

  const order: MaskKind[] = ["client", "opposing", "tckn", "vkn", "iban", "phone"];
  const masked = order
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => ({ kind, label: LABELS[kind], count: counts.get(kind) ?? 0 }));
  return { text: out, masked, clean: masked.length === 0 };
}

/** One Turkish sentence summarising a mask preview, for the console header. */
export function describeMask(result: MaskResult): string {
  if (result.clean) {
    return "Maskelenecek kişisel veri bulunamadı — metni yine de okuyun; maskeleme kural tabanlıdır ve eksik kalabilir.";
  }
  const parts = result.masked.map((m) => `${m.count} ${m.label}`);
  return `Gönderilmeden önce ${parts.join(", ")} gizlendi. Metni okuyun: maskeleme kural tabanlıdır ve eksik kalabilir.`;
}
