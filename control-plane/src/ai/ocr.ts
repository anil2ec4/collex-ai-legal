/**
 * Cloud OCR (POST /v1/ai/ocr) — guards, batching and provenance.
 *
 * Guards run BEFORE any byte leaves the machine: size (32 MB), PDF magic
 * bytes, and a page-count ceiling (100) estimated locally from the PDF's
 * own structure. The Messages API `document` content block (base64 PDF)
 * carries the file; a forced `transcribe_pages` tool returns per-page text.
 *
 * Batching: a 100-page transcript does not fit one 60-second, 16k-token
 * response, so pages are requested in ranges (OCR_PAGES_PER_REQUEST) and the
 * document block carries `cache_control` so the repeated PDF is served from
 * the prompt cache. When the local page count cannot be determined (object
 * streams hide the page tree), ONE request asks for every page and the
 * result is labelled accordingly.
 *
 * Provenance: the transcript is machine output. Its first line, when it is
 * uploaded back through /v1/files, is the provenance header
 *   "AI OCR — kaynak: <fileName> — <GG.AA.YYYY> — <model>"
 * so the resulting document can never be mistaken for the original.
 *
 * No process is spawned here; PDF inspection is pure string matching.
 *
 * LIVE-UNTESTED (see anthropicAdapter.ts header).
 */

import {
  addUsage,
  emptyUsage,
  type AnthropicUsage,
  type TranscribedPage,
  type TranscribePagesInput,
  type ToolCallResult,
} from "../llm/anthropicAdapter.js";

export const OCR_SCHEMA = "collex.ai.ocr/v1" as const;
/** Anthropic request ceiling for a base64 PDF. */
export const OCR_MAX_BYTES = 32 * 1024 * 1024;
/** Conservative page ceiling (the 200k-context document limit). */
export const OCR_MAX_PAGES = 100;
/** Pages per transcribe_pages request. */
export const OCR_PAGES_PER_REQUEST = 8;
/** A page range is a long output: allow more than the 60 s default. */
export const OCR_TIMEOUT_MS = 300_000;
/** Output ceiling per page range (~8 dense pages fit comfortably). */
export const OCR_MAX_TOKENS = 24_000;

/** `%PDF-` must appear within the first 1024 bytes (PDF 1.7 §7.5.2 note). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/**
 * Estimate the page count from the PDF's page tree without a PDF library:
 *   1. the root `/Type /Pages` node (no `/Parent`) carries `/Count N` —
 *      take the largest such count;
 *   2. otherwise count `/Type /Page` leaf objects;
 *   3. otherwise (object streams, encrypted structure) return undefined —
 *      the caller must say so instead of guessing.
 */
export function estimatePdfPageCount(bytes: Uint8Array): number | undefined {
  const text = Buffer.from(bytes).toString("latin1");
  let best = 0;
  for (const found of text.matchAll(/\/Type\s*\/Pages\b/gu)) {
    const at = found.index ?? 0;
    const windowStart = Math.max(0, at - 600);
    const windowEnd = Math.min(text.length, at + 600);
    const window = text.slice(windowStart, windowEnd);
    const local = at - windowStart;
    // Clip the window to the enclosing dictionary as best we can.
    const dictStart = window.lastIndexOf("<<", local);
    const dictEnd = window.indexOf(">>", local);
    const dict = window.slice(
      dictStart === -1 ? 0 : dictStart,
      dictEnd === -1 ? window.length : dictEnd + 2,
    );
    if (/\/Parent\b/u.test(dict)) continue; // intermediate node
    const count = dict.match(/\/Count\s+(\d+)/u);
    if (count !== null) best = Math.max(best, Number(count[1]));
  }
  if (best > 0) return best;
  const leaves = text.match(/\/Type\s*\/Page(?![s\w])/gu);
  if (leaves !== null && leaves.length > 0) return leaves.length;
  return undefined;
}

/** GG.AA.YYYY on every user-facing surface (local calendar date). */
export function formatDateTr(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

export function buildProvenanceHeader(fileName: string, date: Date, model: string): string {
  return `AI OCR — kaynak: ${fileName} — ${formatDateTr(date)} — ${model}`;
}

/** `<name>.ocr.txt` — the upload name the console hands to /v1/files. */
export function ocrUploadName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/iu, "");
  return `${base === "" ? "belge" : base}.ocr.txt`;
}

/** Page separator of the `text` field (contract: form feed). */
export const PAGE_SEPARATOR = "\f";

/**
 * Upload-safe rendering: no control characters (the intake quarantine
 * sniffs text uploads), one visible page marker per page.
 */
export function renderUploadText(header: string, pages: readonly TranscribedPage[]): string {
  const body = pages
    .map((page) => `[Sayfa ${page.page}]\n${page.text.replace(/\f/gu, "\n")}`)
    .join("\n\n");
  return `${header}\n\n${body}\n`;
}

export interface OcrAdapter {
  transcribePages(input: TranscribePagesInput): Promise<ToolCallResult<TranscribedPage[]>>;
}

export interface TranscribePdfInput {
  bytes: Uint8Array;
  fileName: string;
  /** Local estimate; undefined = unknown (single all-pages request). */
  pageCount: number | undefined;
  batchSize?: number;
}

export interface OcrRunResult {
  pages: TranscribedPage[];
  /** Known page count, or the number of pages the model returned. */
  pageCount: number;
  warnings: string[];
  usage: AnthropicUsage;
  requests: number;
}

/**
 * Drive the page-range loop. Pages outside the requested range are ignored
 * (with a warning); pages the model did not return are filled with "" (with
 * a warning) so page numbering in the transcript stays honest.
 */
export async function transcribePdf(
  adapter: OcrAdapter,
  input: TranscribePdfInput,
): Promise<OcrRunResult> {
  const pdfBase64 = Buffer.from(input.bytes).toString("base64");
  const warnings: string[] = [];
  let usage = emptyUsage();
  let requests = 0;

  if (input.pageCount === undefined) {
    warnings.push(
      "Sayfa sayısı yerel olarak belirlenemedi (sıkıştırılmış PDF yapısı); 100 sayfa sınırı " +
        "yerelde uygulanamadı ve tüm sayfalar tek istekte istendi.",
    );
    const result = await adapter.transcribePages({
      pdfBase64,
      fileName: input.fileName,
      timeoutMs: OCR_TIMEOUT_MS,
      maxTokens: OCR_MAX_TOKENS,
    });
    requests += 1;
    usage = addUsage(usage, result.usage);
    const pages = dedupePages(result.value, warnings);
    return { pages, pageCount: pages.length, warnings, usage, requests };
  }

  const batchSize = Math.max(1, input.batchSize ?? OCR_PAGES_PER_REQUEST);
  const byPage = new Map<number, string>();
  for (let first = 1; first <= input.pageCount; first += batchSize) {
    const last = Math.min(input.pageCount, first + batchSize - 1);
    const result = await adapter.transcribePages({
      pdfBase64,
      fileName: input.fileName,
      firstPage: first,
      lastPage: last,
      timeoutMs: OCR_TIMEOUT_MS,
      maxTokens: OCR_MAX_TOKENS,
    });
    requests += 1;
    usage = addUsage(usage, result.usage);
    for (const page of result.value) {
      if (page.page < first || page.page > last) {
        warnings.push(`Model istenen aralık dışında bir sayfa döndürdü (sayfa ${page.page}); yok sayıldı.`);
        continue;
      }
      if (byPage.has(page.page)) {
        warnings.push(`Sayfa ${page.page} birden fazla kez döndürüldü; ilk metin korundu.`);
        continue;
      }
      byPage.set(page.page, page.text);
    }
    for (let page = first; page <= last; page += 1) {
      if (!byPage.has(page)) {
        byPage.set(page, "");
        warnings.push(`Sayfa ${page} için metin döndürülmedi; boş bırakıldı.`);
      }
    }
  }
  const pages: TranscribedPage[] = [];
  for (let page = 1; page <= input.pageCount; page += 1) {
    pages.push({ page, text: byPage.get(page) ?? "" });
  }
  return { pages, pageCount: input.pageCount, warnings, usage, requests };
}

function dedupePages(raw: readonly TranscribedPage[], warnings: string[]): TranscribedPage[] {
  const byPage = new Map<number, string>();
  for (const page of raw) {
    if (byPage.has(page.page)) {
      warnings.push(`Sayfa ${page.page} birden fazla kez döndürüldü; ilk metin korundu.`);
      continue;
    }
    byPage.set(page.page, page.text);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, text]) => ({ page, text }));
}
