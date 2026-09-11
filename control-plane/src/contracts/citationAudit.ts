/**
 * Atıf Denetim Raporu — the citation audit engine (W14 · B-13).
 *
 * WHAT THIS IS FOR. A lawyer is handed the other side's dilekçe (or reads
 * back their own before filing) and needs one question answered per citation:
 * **does this authority exist, does it say what the text claims, and was it
 * in force on the date of the petition?** W13-GLOBAL: Clearbrief sells that
 * report at USD 300/month for a solo; Charlotin's AI Hallucination Cases
 * database held 1 871 records on 11.08.2026 and the one consistent pattern in
 * the sanction records is that the lawyer who can EVIDENCE their diligence is
 * treated more leniently. W13-TRMARKET: Kızılcahamam/Ankara, 20.06.2026 — a
 * 25-year lawyer's AI-written petition carried invented Yargıtay künyes; the
 * prosecutor's office AND the Ankara Bar opened investigations.
 *
 * THE THREE BUCKETS (W13-GLOBAL, the eyecite pattern). The interface used to
 * be able to say only "found / not found". That conflates two very different
 * facts, so this engine keeps them apart:
 *
 *   bulundu     — the authority was resolved AND, when a quote was claimed,
 *                 the quote hashes to the resolved passage;
 *   bulunamadı  — the authority was looked for in the sources we actually
 *                 search and was NOT there. This is the hallucination signal;
 *   belirsiz    — we cannot answer, because the citation is outside our scope
 *                 (B-14), the source was unreachable, or the reference is too
 *                 incomplete to resolve. This is a COVERAGE statement about
 *                 us, never a statement about the authority.
 *
 * THE RULE THAT CANNOT BE BROKEN: a citation we could not resolve renders an
 * EMPTY künye cell. Never a guess, never a "probably", never a reconstructed
 * reference. `kunye` is `""` unless a resolver returned one.
 *
 * AS-OF. Every currency verdict is computed against the PETITION'S date, not
 * today — a 2019 petition citing a provision repealed in 2021 was correct
 * when it was written. `asOf` is required for that reason; the caller passes
 * the petition date.
 *
 * Rule-based throughout: no cloud, no model. The resolver is injected, so the
 * engine is testable without a database and the same engine serves an
 * uploaded opposing petition and one of our own drafts.
 */

import { parseReferences, type ParsedReference } from "../retrieval/referenceParser.js";
import { canonicalQuoteText } from "../drafting/quoteIntegrity.js";
import { sha256HexUtf8 } from "../verification/validator.js";

export const CITATION_AUDIT_SCHEMA = "collex.citation-audit/v1";

/** The three buckets, as machine codes. Turkish labels below. */
export const AUDIT_BUCKETS = ["FOUND", "NOT_FOUND", "UNCERTAIN"] as const;
export type AuditBucket = (typeof AUDIT_BUCKETS)[number];

/** Lawyer-Turkish label for each bucket — shown before the code, always. */
export const BUCKET_LABEL_TR: Readonly<Record<AuditBucket, string>> = Object.freeze({
  FOUND: "bulundu",
  NOT_FOUND: "bulunamadı",
  UNCERTAIN: "belirsiz",
});

/** One-sentence meaning of each bucket, for the report's legend. */
export const BUCKET_MEANING_TR: Readonly<Record<AuditBucket, string>> = Object.freeze({
  FOUND: "Kaynak bulundu ve künyesi doğrulandı.",
  NOT_FOUND:
    "Bu atıf, taradığımız kaynaklarda bulunamadı. Uydurulmuş bir künye olabilir;" +
    " kaynağı elle teyit edin.",
  UNCERTAIN:
    "Karar verilemedi: atıf kapsamımızın dışında, kaynak erişilemedi ya da referans" +
    " çözümlenemeyecek kadar eksik. Bu bizim kapsamımızla ilgili bir sonuçtur," +
    " kaynağın yokluğu anlamına gelmez.",
});

/** Currency verdict AS OF the petition date. */
export const CURRENCY_STATES = [
  "IN_FORCE",
  "REPEALED",
  "NOT_YET_IN_FORCE",
  "NOT_APPLICABLE",
  "UNKNOWN",
] as const;
export type CurrencyState = (typeof CURRENCY_STATES)[number];

export const CURRENCY_LABEL_TR: Readonly<Record<CurrencyState, string>> = Object.freeze({
  IN_FORCE: "yürürlükte",
  REPEALED: "mülga",
  NOT_YET_IN_FORCE: "henüz yürürlükte değil",
  NOT_APPLICABLE: "yürürlük değerlendirilemez",
  UNKNOWN: "bilinmiyor",
});

/** Where the audited citations came from. */
export interface CitationAuditRequest {
  /** Free text to extract citations from (an uploaded petition, say). */
  text?: string;
  /** Pre-extracted citations, when the caller already has them. */
  citations?: { raw: string; count?: number }[];
  /**
   * The PETITION'S date (YYYY-MM-DD). Every currency verdict is computed
   * against this, never against today.
   */
  asOf: string;
  /** Optional: the matter this petition belongs to (for the report header). */
  matterId?: string;
  /** Optional: what the document is called in the report header. */
  documentTitle?: string;
}

/** What a resolver may say about one citation. */
export interface CitationResolution {
  /**
   * The authority's künye AS THE SOURCE HAS IT. Leave empty when nothing was
   * resolved — the report then prints an EMPTY cell. Never synthesize this.
   */
  kunye?: string;
  /** Resolved document version, when there is one. */
  documentVersionId?: string;
  /** SHA-256 of the resolved passage, when a passage was resolved. */
  quoteSha256?: string;
  /** Currency AS OF the requested date. */
  currency?: CurrencyState;
  /** Machine reason the resolver could not decide (drives UNCERTAIN). */
  uncertainReason?: string;
  /** True when the resolver positively established the authority is absent. */
  absent?: boolean;
  /** Contrary authorities the resolver found against this citation. */
  contrary?: { kunye: string; note?: string }[];
  /** A link/id the console can open ("tam metne git"). */
  href?: string;
}

export type CitationResolver = (
  citation: AuditCitation,
  asOf: string,
) => Promise<CitationResolution | undefined>;

/** One citation as the auditor sees it before resolution. */
export interface AuditCitation {
  /** The reference exactly as it appears in the document. */
  raw: string;
  /**
   * EVERY distinct spelling the document used for this one authority, in the
   * order it used them (W17/b). Additive.
   *
   * MEASURED DEFECT: `citationKey` keys an article on its number alone, so
   * "TTK m. 23/1-c" (paragraph 2) and "TTK m. 23" (HUKUKÎ SEBEPLER) merge into
   * one row — correctly, it IS one article — but the row kept only the FIRST
   * spelling and the count of BOTH. The report then read
   * "TTK m. 23/1-c — metinde 2 kez geçiyor", a statement about the other
   * side's pleading the document does not support: whether they pinned the
   * bent twice or the article once is exactly what a lawyer checks before
   * answering it. The same collapse hid the citation from its own claim, whose
   * text says "TTK m. 23" and never the longer form.
   */
  rawForms?: string[];
  /** How many times the document makes it. */
  count: number;
  /** Parser output, when the reference parser recognized it. */
  parsed?: ParsedReference;
  /** A quote the document attributes to this citation, when there is one. */
  claimedQuote?: string;
}

/** One row of the report. */
export interface CitationAuditRow {
  raw: string;
  /** Every distinct spelling the document used for this authority (W17/b). */
  rawForms: string[];
  count: number;
  bucket: AuditBucket;
  bucketLabel: string;
  /** EMPTY when nothing was resolved. Never a fabricated künye. */
  kunye: string;
  documentVersionId: string;
  currency: CurrencyState;
  currencyLabel: string;
  /** Whether the quote the document attributes to this citation verified. */
  quoteVerified: "DOGRULANDI" | "DOGRULANMADI" | "ALINTI_YOK";
  quoteVerifiedLabel: string;
  contrary: { kunye: string; note: string }[];
  /** Why the row is UNCERTAIN, in Turkish. Empty otherwise. */
  reason: string;
  href: string;
  /** B-36: who reviewed this citation, when, with what note. */
  review: { reviewed: boolean; by: string; at: string; note: string };
}

export interface CitationAuditReport {
  schema: typeof CITATION_AUDIT_SCHEMA;
  asOf: string;
  matterId: string;
  documentTitle: string;
  generatedAt: string;
  rows: CitationAuditRow[];
  totals: Record<AuditBucket, number>;
  /** The review checklist state at the time of the audit (B-36). */
  reviewComplete: boolean;
  /** Verbatim honesty sentences the renderer must print. */
  notices: string[];
}

const QUOTE_LABEL_TR = {
  DOGRULANDI: "alıntı kaynağıyla birebir uyuşuyor",
  DOGRULANMADI: "alıntı doğrulanamadı",
  ALINTI_YOK: "alıntı yok",
} as const;

/** Sentences the report always carries — honesty is the product here. */
export const AUDIT_NOTICES: readonly string[] = Object.freeze([
  "Bu rapor makine üretimidir; her satırı avukat incelemesi gerektirir.",
  'Yürürlük durumu, bugüne göre değil DİLEKÇENİN TARİHİNE göre hesaplanmıştır.',
  "Çözümlenemeyen bir atıfın künye hücresi BOŞ bırakılır; sistem künye uydurmaz.",
  '"bulunamadı" taradığımız kaynaklarda yok demektir; "belirsiz" kapsamımızın' +
    " dışında ya da kaynağa erişilemedi demektir — ikisi aynı şey değildir.",
  "Bu rapor bir doğrulama değildir: sistem doğrulamaz, avukatın doğruladığını kaydeder.",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export class CitationAuditError extends Error {}

/**
 * Extract the citations of a document, deduplicated, with occurrence counts.
 * Exported so the console can preview what will be audited before spending
 * the work.
 */
/**
 * A court reference with no docket and no decision number is not something an
 * audit can check (W17).
 *
 * Measured on a real cevap dilekçesi (06.09.2026): the sentence "Anılan
 * kararda … belirtilmiştir" produced its own citation row, which then said
 * "belirsiz" forever. The row carries no number to look anything up with, so
 * it can only ever repeat the coverage sentence — noise in a report whose
 * value is that every row means something. The sentence itself stays in the
 * report as the claim's text, so nothing is hidden.
 */
function isCheckableCourtReference(parsed: ParsedReference): boolean {
  // A back-reference ("anılan kararda", "aynı kararda") points at something
  // named EARLIER in the document. It has nothing of its own to look up.
  if (parsed.kind === "short_form") return false;
  // W17/b — an article that no statute claimed is not a citation this report
  // can check. MEASURED on an icra-itiraz text: "taraflar arasındaki
  // sözleşmenin 5. maddesi uyarınca zaten ödenmiştir" produced the audit row
  // "5. maddesi — belirsiz", under a legend telling the lawyer the reference
  // was out of scope or unreachable. It is a clause of the parties' OWN
  // contract: there is no mevzuat behind it, so there is nothing to be
  // uncertain ABOUT, and sending a lawyer to verify it wastes the one kind of
  // attention this report exists to direct. This runs AFTER
  // `pairArticlesWithTheirLaw`, so "TBK m. 475" has already been given its
  // 6098 and is unaffected; only a genuinely orphan article is dropped, and
  // its sentence still stands in the claim text.
  if (parsed.kind === "article" && (parsed.legislationNo ?? "") === "") return false;
  if (parsed.kind !== "court_decision") return true;
  const docket = parsed.docketNo ?? "";
  const decision = parsed.decisionNo ?? "";
  return docket.trim() !== "" || decision.trim() !== "";
}

export function extractAuditCitations(text: string): AuditCitation[] {
  const byKey = new Map<string, AuditCitation>();
  // W17/b — the document is read as PROSE, not as lines. A petition wraps its
  // lines wherever the margin falls, and a citation is never meant to be cut
  // by that. Measured 06.09.2026: "2004 sayılı İcra ve\nİflas Kanunu m. 269"
  // produced NO legislation reference at all — the law name was broken across
  // the wrap — so the statute the document plainly names was lost and only a
  // bare "m. 269" survived. The two decisions in the same paragraph fared no
  // better: their `raw` carried a literal newline
  // ("Yargıtay 3. Hukuk Dairesi\nE. 2023/4521, K. 2024/1188") straight onto
  // the screen. Nothing downstream of here reads a reference's `span`, so
  // collapsing whitespace before parsing costs nothing and fixes both.
  const prose = text.replace(/\s+/gu, " ");
  for (const parsed of pairArticlesWithTheirLaw(parseReferences(prose))) {
    if (!isCheckableCourtReference(parsed)) continue;
    const key = citationKey(parsed);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      const forms = existing.rawForms as string[];
      if (!forms.includes(parsed.raw)) forms.push(parsed.raw);
      continue;
    }
    byKey.set(key, { raw: parsed.raw, rawForms: [parsed.raw], count: 1, parsed });
  }
  return [...byKey.values()];
}

/**
 * Give every bare article reference the law it belongs to (W14 L-FIX).
 *
 * `parseReferences` emits "6098 sayılı Kanun m. 299" as TWO references — a
 * legislation reference and a bare `article` one — because that is what the
 * retrieval lanes want. The audit consumed them as two separate CITATIONS,
 * so the most common form a Turkish petition uses arrived at the resolver as
 * an article with no law, which nothing can look up: measured 02.09.2026
 * against the demo corpus, every such row came back "belirsiz — bu atıf
 * çözümlenemedi" no matter what the resolver could see. A cite-check that
 * cannot read the ordinary form of a citation checks nothing.
 *
 * The pairing rule is the one `retrieval/hybrid.ts` already uses for citation
 * expansion, deliberately: an article belongs to the nearest PRECEDING
 * legislation reference, and a new legislation reference ends the run. Same
 * rule in both places, so a reader who learns it once knows it everywhere.
 *
 * A merged reference keeps the article's own `raw` text — the report shows
 * the citation as the document wrote it — and gains `legislationNo` so the
 * resolver can act. An article with no preceding law is left exactly as it
 * was, and stays honestly unresolvable.
 */
export function pairArticlesWithTheirLaw(
  references: readonly ParsedReference[],
): ParsedReference[] {
  const out: ParsedReference[] = [];
  let currentLaw: ParsedReference | undefined;
  // W17: laws an article later claimed. "TBK m. 475" is ONE citation and the
  // lawyer looks for ONE row. Measured on a real cevap dilekçesi (06.09.2026):
  // the bare "TBK" half survived as a second citation, the resolver answered
  // it with the statute's FIRST article, and the report printed
  // "bulundu — 6098 sayılı Türk Borçlar Kanunu … m. 1" for a citation that
  // said m. 475. A cite-check whose green row names a different article than
  // the document is worse than no cite-check at all.
  const claimed = new Set<ParsedReference>();
  for (const reference of references) {
    if (reference.kind === "legislation" && reference.legislationNo !== undefined) {
      currentLaw = reference;
      out.push(reference);
      continue;
    }
    if (
      reference.kind === "article" &&
      reference.articleNo !== undefined &&
      reference.legislationNo === undefined &&
      currentLaw !== undefined
    ) {
      claimed.add(currentLaw);
      out.push({
        ...reference,
        // W17: the row now stands for the WHOLE citation, so it must read the
        // way the document wrote it. Showing "m. 475" alone — after the "TBK"
        // row was folded into this one — would leave the lawyer looking for an
        // article with no statute.
        raw: `${currentLaw.raw} ${reference.raw}`.replace(/\s+/gu, " ").trim(),
        legislationNo: currentLaw.legislationNo as string,
        ...(currentLaw.canonicalName !== undefined
          ? { canonicalName: currentLaw.canonicalName }
          : {}),
      });
      continue;
    }
    // A court decision (or anything else) ends the legislation run: the next
    // bare article belongs to whatever the document names after it.
    if (reference.kind !== "article") currentLaw = undefined;
    out.push(reference);
  }
  // A law an article claimed is not a citation of its own. A law cited with NO
  // article ("HMK uyarınca dava şartı…") is, and stays.
  return out.filter((reference) => !claimed.has(reference));
}

/** Identity of a citation: the same authority written twice is one row. */
export function citationKey(parsed: ParsedReference): string {
  const parts = [
    parsed.kind,
    parsed.legislationNo ?? parsed.canonicalName ?? parsed.name ?? "",
    parsed.articleNo ?? "",
    parsed.court ?? "",
    parsed.chamber ?? "",
    parsed.docketNo ?? "",
    parsed.decisionNo ?? "",
  ];
  const key = parts.join("|");
  // A reference the parser could not pin down at all falls back to its raw
  // text, folded — two spellings of nothing must not merge into one row.
  return key === `${parsed.kind}||||||` ? `${parsed.kind}|raw:${canonicalQuoteText(parsed.raw)}` : key;
}

/**
 * Run the audit. Every row is produced by the resolver or explicitly marked
 * UNCERTAIN; no row is ever invented, and no künye is ever guessed.
 */
export async function auditCitations(
  request: CitationAuditRequest,
  resolver: CitationResolver,
  options: { now?: () => Date; reviewComplete?: boolean } = {},
): Promise<CitationAuditReport> {
  if (!ISO_DATE.test(request.asOf)) {
    throw new CitationAuditError(
      "Denetim tarihi (asOf) YYYY-AA-GG biçiminde olmalı: yürürlük, bugüne göre değil" +
        " dilekçenin tarihine göre hesaplanır.",
    );
  }
  const citations: AuditCitation[] = [
    ...(request.text !== undefined ? extractAuditCitations(request.text) : []),
  ];
  for (const given of request.citations ?? []) {
    const raw = given.raw.trim();
    if (raw === "") continue;
    const parsed = parseReferences(raw)[0];
    const citation: AuditCitation = {
      raw,
      count: given.count ?? 1,
      ...(parsed !== undefined ? { parsed } : {}),
    };
    const key = parsed !== undefined ? citationKey(parsed) : `raw:${canonicalQuoteText(raw)}`;
    const existing = citations.find((c) =>
      c.parsed !== undefined ? citationKey(c.parsed) === key : `raw:${canonicalQuoteText(c.raw)}` === key,
    );
    if (existing !== undefined) existing.count += citation.count;
    else citations.push(citation);
  }

  const rows: CitationAuditRow[] = [];
  for (const citation of citations) {
    rows.push(await auditOne(citation, request.asOf, resolver));
  }

  const totals: Record<AuditBucket, number> = { FOUND: 0, NOT_FOUND: 0, UNCERTAIN: 0 };
  for (const row of rows) totals[row.bucket] += 1;

  const now = (options.now ?? (() => new Date()))();
  return {
    schema: CITATION_AUDIT_SCHEMA,
    asOf: request.asOf,
    matterId: request.matterId ?? "",
    documentTitle: request.documentTitle ?? "",
    generatedAt: now.toISOString(),
    rows,
    totals,
    reviewComplete: options.reviewComplete ?? false,
    notices: [...AUDIT_NOTICES],
  };
}

async function auditOne(
  citation: AuditCitation,
  asOf: string,
  resolver: CitationResolver,
): Promise<CitationAuditRow> {
  let resolution: CitationResolution | undefined;
  let failure = "";
  try {
    resolution = await resolver(citation, asOf);
  } catch (error) {
    // A resolver that throws makes the row UNCERTAIN — never NOT_FOUND. We do
    // not accuse a citation of being invented because our own lookup broke.
    failure =
      "Kaynak sorgusu tamamlanamadı (yerel kaynağa erişilemedi);" +
      " bu satır elle kontrol edilmelidir.";
    void error;
  }

  const kunye = resolution?.kunye?.trim() ?? "";
  const quoteVerified = verifyQuote(citation, resolution);

  let bucket: AuditBucket;
  let reason = "";
  if (failure !== "") {
    bucket = "UNCERTAIN";
    reason = failure;
  } else if (resolution?.absent === true) {
    bucket = "NOT_FOUND";
    // W14 L-FIX: carry the resolver's explanation when it supplies one. A
    // "bulunamadı" row accuses the drafter, so the reader is entitled to the
    // grounds — the corpus resolver, for instance, says WHICH law's in-force
    // text it read and did not find the article in. Still empty when the
    // resolver offers nothing: an invented sentence would be worse.
    reason = resolution.uncertainReason?.trim() ?? "";
  } else if (kunye === "") {
    bucket = "UNCERTAIN";
    reason =
      resolution?.uncertainReason?.trim() ??
      "Bu atıf çözümlenemedi: kapsam dışında olabilir ya da referans eksik.";
  } else if (quoteVerified === "DOGRULANMADI") {
    // The authority exists but the passage the document attributes to it does
    // not: that is not "found", and it is exactly the case a cite-check is for.
    bucket = "UNCERTAIN";
    reason =
      "Kaynak bulundu ancak dilekçenin bu kaynağa atfettiği alıntı, kaynağın" +
      " metniyle doğrulanamadı.";
  } else {
    bucket = "FOUND";
  }

  const currency: CurrencyState = resolution?.currency ?? "UNKNOWN";
  return {
    raw: citation.raw,
    rawForms: citation.rawForms ?? [citation.raw],
    count: citation.count,
    bucket,
    bucketLabel: BUCKET_LABEL_TR[bucket],
    // THE RULE: no resolution, no künye. An empty cell, never a guess.
    kunye,
    documentVersionId: resolution?.documentVersionId ?? "",
    currency,
    currencyLabel: CURRENCY_LABEL_TR[currency],
    quoteVerified,
    quoteVerifiedLabel: QUOTE_LABEL_TR[quoteVerified],
    contrary: (resolution?.contrary ?? []).map((c) => ({
      kunye: c.kunye,
      note: c.note ?? "",
    })),
    reason,
    href: resolution?.href ?? "",
    review: { reviewed: false, by: "", at: "", note: "" },
  };
}

/**
 * The quote check is a HASH comparison, not a similarity score: sha256 over
 * the UTF-8 bytes of the claimed passage against the digest of the resolved
 * passage (ADR-003). Anything that is not an exact match is `DOGRULANMADI` —
 * the same discipline the export gate applies (B-01).
 */
function verifyQuote(
  citation: AuditCitation,
  resolution: CitationResolution | undefined,
): CitationAuditRow["quoteVerified"] {
  const claimed = citation.claimedQuote ?? "";
  if (claimed.trim() === "") return "ALINTI_YOK";
  const sha = resolution?.quoteSha256?.trim() ?? "";
  if (sha === "") return "DOGRULANMADI";
  return sha256HexUtf8(claimed) === sha ? "DOGRULANDI" : "DOGRULANMADI";
}
