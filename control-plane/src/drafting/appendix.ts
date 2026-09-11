/**
 * Shared text builders for the evidence-facing parts of a draft (W12 lane C).
 *
 * The composer (first version) and `reviseDraft` (every later version) must
 * produce IDENTICAL wording for the same evidence entry, otherwise the
 * lexical binding rule (`evidenceOverlaps`) would accept a paragraph on
 * creation and reject the very same paragraph on the next save. Everything
 * that turns an evidence entry into document text therefore lives here.
 *
 * Hashes and evidence UUIDs never enter the court text: body citations use
 * the short reference "K-n" (1-based index into `draft.evidence`), and the
 * machine-owned final section `ek-dogrulama` carries the verification
 * summary (label, short quote, first 8 hex of the quote hash, date,
 * verification status). Full hashes stay in the DAYANAK KAYNAKLARI appendix
 * the renderers print after the document.
 */

import { sanitizeMarkdown } from "../security/renderGuard.js";
import { formatDateTr } from "./input.js";
import {
  EK_DOGRULAMA_SECTION_ID,
  EK_DOGRULAMA_SECTION_TITLE,
  NOTE_DOGRULAMA,
  type DraftEvidence,
  type DraftEvidenceDirection,
  type DraftParagraph,
  type DraftSection,
  type DraftUploadInfo,
} from "./types.js";

/** First 8 hex characters of a digest — enough to spot a swap, never a UUID. */
export function shortHash8(digest: string): string {
  return digest.slice(0, 8);
}

/**
 * Turkish name of an evidence source code (W15 · belge-ciktilari P1/157).
 *
 * The appendix used to print the raw machine code ("YARGITAY_BEDESTEN",
 * "MEVZUAT_GOV") straight into the petition. A code we do not know is
 * returned UNCHANGED — a source name is never invented, only translated.
 */
const SOURCE_LABEL_TR: Readonly<Record<string, string>> = Object.freeze({
  UPLOAD: "Dosyaya eklediğiniz belge",
  MEVZUAT: "Resmî mevzuat metni (mevzuat.gov.tr)",
  MEVZUAT_GOV: "Resmî mevzuat metni (mevzuat.gov.tr)",
  YARGITAY: "Yargıtay karar bankası",
  YARGITAY_BEDESTEN: "Yargıtay karar bankası",
  DANISTAY: "Danıştay karar bankası",
  DANISTAY_BEDESTEN: "Danıştay karar bankası",
  ISTINAF_HUKUK: "Bölge adliye mahkemesi (istinaf) kararları",
  YEREL_HUKUK: "Yerel hukuk mahkemesi kararları",
  KYB: "Kanun yararına bozma kararları",
  EMSAL: "UYAP emsal karar arama",
  UYUSMAZLIK: "Uyuşmazlık Mahkemesi kararları",
  AYM: "Anayasa Mahkemesi kararları",
  KIK: "Kamu İhale Kurulu kararları",
  KVKK: "Kişisel Verileri Koruma Kurulu kararları",
  REKABET: "Rekabet Kurumu kararları",
  SAYISTAY: "Sayıştay kararları",
  BDDK: "BDDK kararları",
  BTK: "BTK kararları",
  GIB: "Gelir İdaresi Başkanlığı özelgeleri",
  SIGORTA: "Sigorta Tahkim Komisyonu kararları",
});

/** Turkish name of a source code; an unknown code is returned unchanged. */
export function sourceLabelTr(source: string): string {
  return SOURCE_LABEL_TR[source] ?? source;
}

/** Sanitize a user/evidence string for a single-line context. */
export function inlineText(value: string): string {
  return sanitizeMarkdown(value).replace(/\s*\n+\s*/g, " ").trim();
}

/** "K-n" reference numbers: 1-based position in the draft's evidence list. */
export function evidenceNumbering(evidence: readonly DraftEvidence[]): Map<string, number> {
  const out = new Map<string, number>();
  evidence.forEach((entry, index) => {
    if (!out.has(entry.evidenceId)) out.set(entry.evidenceId, index + 1);
  });
  return out;
}

/** Body citation reference for an evidence id ("K-3"); id itself when unnumbered. */
export function evidenceRef(numbering: ReadonlyMap<string, number>, evidenceId: string): string {
  const n = numbering.get(evidenceId);
  return n === undefined ? evidenceId : `K-${n}`;
}

/** Dictionary wording of an evidence direction for the verification lines. */
export function directionWording(direction: DraftEvidenceDirection | undefined): string {
  if (direction === "destekleyen") return "talebi destekliyor";
  if (direction === "karşıt") return "talebin aksine (karşı içtihat)";
  return "yön belirtmez";
}

/** HUKUKÎ SEBEPLER line for one entry: label + verbatim quote, no hash. */
export function sebeplerParagraphText(entry: DraftEvidence): string {
  return `Dayanak: ${sanitizeMarkdown(entry.label)} — "${sanitizeMarkdown(entry.quote)}"`;
}

/** Karşı içtihat line for one entry: label + verbatim quote, no hash. */
export function karsiIctihatParagraphText(entry: DraftEvidence): string {
  return `${sanitizeMarkdown(entry.label)} — "${sanitizeMarkdown(entry.quote)}"`;
}

/** DELİLLER line for one uploaded file (contract: 'Ek-n: <dosya> (dosyaya eklediğiniz belge)'). */
export function uploadDelillerLine(index: number, upload: DraftUploadInfo): string {
  return `Ek-${index}: ${inlineText(upload.fileName)} (dosyaya eklediğiniz belge)`;
}

/** Group UPLOAD evidence entries into one summary per file (chunk order kept). */
export function groupUploads(evidence: readonly DraftEvidence[]): DraftUploadInfo[] {
  const byKey = new Map<string, DraftUploadInfo>();
  for (const entry of evidence) {
    if (entry.source !== "UPLOAD") continue;
    const key = entry.fileId ?? entry.contentSha256;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      existing.chunkCount += 1;
      continue;
    }
    byKey.set(key, {
      fileId: entry.fileId ?? key,
      fileName: entry.title,
      contentSha256: entry.contentSha256,
      chunkCount: 1,
    });
  }
  return [...byKey.values()];
}

/** Short, single-line excerpt of a quote for the verification section. */
export function shortQuote(quote: string, max = 90): string {
  const flat = inlineText(quote);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > max / 2 ? cut.slice(0, boundary) : cut}…`;
}

/** Evidence ids cited by at least one paragraph of the document. */
export function citedEvidenceIds(sections: readonly DraftSection[]): Set<string> {
  const out = new Set<string>();
  for (const section of sections) {
    if (section.id === EK_DOGRULAMA_SECTION_ID) continue;
    for (const paragraph of section.paragraphs) {
      for (const id of paragraph.evidenceIds) out.add(id);
    }
  }
  return out;
}

/**
 * Build the machine-owned final section `ek-dogrulama` from the draft's
 * evidence list and body sections. Returns undefined when there is nothing
 * to verify (no cited evidence and no uploaded exhibit) — the section is
 * never rendered empty.
 */
export function buildEkDogrulamaSection(
  evidence: readonly DraftEvidence[],
  sections: readonly DraftSection[],
): DraftSection | undefined {
  const numbering = evidenceNumbering(evidence);
  const cited = citedEvidenceIds(sections);
  const paragraphs: DraftParagraph[] = [];
  let counter = 0;
  const add = (text: string): void => {
    counter += 1;
    paragraphs.push({
      id: `p-${EK_DOGRULAMA_SECTION_ID}-${counter}`,
      text,
      evidenceIds: [],
      supported: true,
      note: NOTE_DOGRULAMA,
      role: "ekDogrulama",
    });
  };

  const legal = evidence.filter((e) => e.source !== "UPLOAD" && cited.has(e.evidenceId));
  const uploads = groupUploads(evidence);
  if (legal.length === 0 && uploads.length === 0) return undefined;

  add(
    "Bu bölüm dilekçe metnine dahil değildir; mahkemeye verirken çıkarabilirsiniz." +
      " Gövdedeki 'Dayanak [K-n]' atıflarının hangi kaynağa dayandığını ve alıntının" +
      " kaynağıyla uyuşup uyuşmadığını gösterir. Kaynakların tam künyesi ve tam" +
      " alıntı metinleri DAYANAK KAYNAKLARI ekindedir.",
  );
  for (const entry of legal) {
    const date =
      entry.decisionDate !== undefined && entry.decisionDate !== ""
        ? formatDateTr(entry.decisionDate)
        : "—";
    // W15: teknik bilgi SİLİNMEZ, bir katman aşağı iner. Bu bölüm zaten
    // "mahkemeye verirken çıkarabilirsiniz" diyen denetim katmanıdır; alıntının
    // parmak izi tam da buraya aittir. Önceki tur onu tümüyle kaldırmıştı ve
    // "birebir uyuştu" cümlesi denetlenemez bir iddiaya dönüşmüştü — okuyan
    // kişinin karşılaştırabileceği tek şey bu değerdir.
    add(
      `${evidenceRef(numbering, entry.evidenceId)} — ${inlineText(entry.label)} — Kısa alıntı:` +
        ` "${shortQuote(entry.quote)}" — Alıntı denetimi: kaynağıyla birebir uyuştu` +
        ` (parmak izi: ${entry.quoteSha256.slice(0, 8)})` +
        ` — Tarih: ${date} — Doğrulama: doğrulanmış kaynak; ${directionWording(entry.direction)}`,
    );
  }
  uploads.forEach((upload, index) => {
    add(
      // W15: dosyanın kimliği DİLEKÇE GÖVDESİNDEN çıktı (mahkemeye giden
      // DELİLLER satırında makine dizgesinin işi yok) ama denetim katmanından
      // ÇIKMADI — hangi nüshanın eklendiği yalnız buradan doğrulanabilir.
      `Ek-${index + 1} — ${inlineText(upload.fileName)} — dosyaya eklediğiniz belge` +
        ` (belge parmak izi: ${upload.contentSha256.slice(0, 8)})` +
        // W14 · B-02 (W13-COPY M1, W13-DAILYFLOW #7): "tenant" is a DATABASE
        // word. Translated as "kiracı" it reads, in a kira dosyası, as the
        // OPPOSING PARTY — and in a ticari alacak ihtarnamesi there is no
        // kiracı at all. The document says whose upload it is in plain words.
        " — Doğrulama: yüklediğiniz belge; hukukî dayanak değildir",
    );
  });

  return { id: EK_DOGRULAMA_SECTION_ID, title: EK_DOGRULAMA_SECTION_TITLE, paragraphs };
}
