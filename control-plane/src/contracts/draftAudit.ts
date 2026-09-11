/**
 * The Atıf Denetim Raporu of one of OUR OWN drafts (W14 · B-13).
 *
 * The opposing side's petition goes through `POST /v1/citation-audit` with an
 * injected resolver. Our own draft needs no resolver at all: every citation
 * in it is already an evidence entry with a quote, a `quoteSha256` and a
 * `contentSha256`, so the audit is a re-verification rather than a lookup —
 * and it is exactly the artifact W13-GLOBAL describes as the real value of a
 * cite-check report: "who handled which problem, how, with what note",
 * kept in the file. B-36's review record is what fills those columns.
 *
 * Discipline, unchanged: a quote that does not hash to its own digest is
 * NOT reported as found, and no künye is ever synthesized.
 */

import {
  AUDIT_NOTICES,
  BUCKET_LABEL_TR,
  CITATION_AUDIT_SCHEMA,
  CURRENCY_LABEL_TR,
  type AuditBucket,
  type CitationAuditReport,
  type CitationAuditRow,
  type CurrencyState,
} from "./citationAudit.js";
import { isReviewComplete } from "../drafting/exportMode.js";
import { paragraphContainsQuote } from "../drafting/quoteIntegrity.js";
import { sha256HexUtf8 } from "../verification/validator.js";
import type { Draft, DraftEvidence } from "../drafting/types.js";

/** How many paragraphs of the document cite each evidence entry. */
function citationCounts(draft: Draft): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of draft.sections) {
    for (const paragraph of section.paragraphs) {
      for (const id of new Set(paragraph.evidenceIds)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** True when at least one citing paragraph still contains the quote (B-01). */
function quoteStillInBody(draft: Draft, entry: DraftEvidence): boolean {
  for (const section of draft.sections) {
    for (const paragraph of section.paragraphs) {
      if (!paragraph.evidenceIds.includes(entry.evidenceId)) continue;
      if (paragraphContainsQuote(paragraph.text, entry.quote)) return true;
    }
  }
  return false;
}

export interface DraftAuditOptions {
  /**
   * The petition's own date (YYYY-MM-DD). Currency is judged against THIS,
   * never against today. Defaults to the draft's creation date.
   */
  asOf?: string;
  now?: () => Date;
  matterTitle?: string;
}

/** Build the audit report for a draft. Pure; no I/O, no lookups. */
export function auditDraftCitations(
  draft: Draft,
  options: DraftAuditOptions = {},
): CitationAuditReport {
  const counts = citationCounts(draft);
  const asOf = options.asOf ?? (draft.createdAt.slice(0, 10) || "");
  const rows: CitationAuditRow[] = draft.evidence.map((entry, index) => {
    const count = counts.get(entry.evidenceId) ?? 0;
    const hashHolds = sha256HexUtf8(entry.quote) === entry.quoteSha256;
    const inBody = count > 0 && quoteStillInBody(draft, entry);

    let bucket: AuditBucket;
    let reason = "";
    let quoteVerified: CitationAuditRow["quoteVerified"];
    if (!hashHolds) {
      bucket = "UNCERTAIN";
      quoteVerified = "DOGRULANMADI";
      reason =
        "Kayıtlı alıntı, kendi SHA-256 özetiyle doğrulanamadı; bu kaynak dışa" +
        " aktarımda da reddedilir.";
    } else if (count === 0) {
      bucket = "UNCERTAIN";
      quoteVerified = "DOGRULANDI";
      reason = "Bu kaynak dilekçe gövdesinde hiçbir paragraf tarafından kullanılmıyor.";
    } else if (!inBody) {
      bucket = "UNCERTAIN";
      quoteVerified = "DOGRULANMADI";
      reason =
        "Atıf yapan paragraf, kaynağın alıntısını artık birebir içermiyor" +
        " (alıntı değiştirildi — kanıt bağı koptu).";
    } else {
      bucket = "FOUND";
      quoteVerified = "DOGRULANDI";
    }

    // A draft's own evidence is a local passage, not a legislation currency
    // lookup: we do not know its as-of status and we do not pretend to.
    const currency: CurrencyState = entry.source === "UPLOAD" ? "NOT_APPLICABLE" : "UNKNOWN";
    const review = draft.evidenceReview?.[entry.evidenceId];
    return {
      raw: entry.label,
      // Our own draft names each source once, by its evidence label; there is
      // no second spelling for the W17/b merge to record.
      rawForms: [entry.label],
      count,
      bucket,
      bucketLabel: BUCKET_LABEL_TR[bucket],
      kunye: entry.label,
      documentVersionId: entry.contentSha256,
      currency,
      currencyLabel: CURRENCY_LABEL_TR[currency],
      quoteVerified,
      quoteVerifiedLabel:
        quoteVerified === "DOGRULANDI" ? "alıntı hash ile doğrulandı" : "alıntı doğrulanamadı",
      contrary:
        entry.direction === "karşıt"
          ? [{ kunye: entry.label, note: "Bu kaynak talebin AKSİ yönündedir." }]
          : [],
      reason,
      href: `#kanit-${index + 1}`,
      review: {
        reviewed: review?.checked === true,
        by: review?.by ?? "",
        at: review?.at ?? "",
        note: review?.note ?? "",
      },
    };
  });

  const totals: Record<AuditBucket, number> = { FOUND: 0, NOT_FOUND: 0, UNCERTAIN: 0 };
  for (const row of rows) totals[row.bucket] += 1;

  const now = (options.now ?? (() => new Date()))();
  return {
    schema: CITATION_AUDIT_SCHEMA,
    asOf,
    matterId: draft.matterId ?? "",
    documentTitle:
      options.matterTitle !== undefined && options.matterTitle !== ""
        ? `${draft.title} — ${options.matterTitle}`
        : draft.title,
    generatedAt: now.toISOString(),
    rows,
    totals,
    reviewComplete: isReviewComplete(draft.reviewChecklist),
    notices: [...AUDIT_NOTICES],
  };
}
