/**
 * OCR guards and batching: PDF magic bytes, local page-count estimate,
 * GG.AA.YYYY provenance header, upload name, and the page-range loop with
 * honest gaps.
 */

import { describe, expect, it } from "vitest";

import {
  OCR_MAX_TOKENS,
  OCR_PAGES_PER_REQUEST,
  OCR_TIMEOUT_MS,
  buildProvenanceHeader,
  estimatePdfPageCount,
  formatDateTr,
  looksLikePdf,
  ocrUploadName,
  renderUploadText,
  transcribePdf,
} from "../../src/ai/ocr.js";
import type { TranscribePagesInput } from "../../src/llm/anthropicAdapter.js";
import { syntheticPdf } from "./fixtures.js";

describe("PDF guards", () => {
  it("recognizes the %PDF- magic within the first KB and nothing else", () => {
    expect(looksLikePdf(syntheticPdf(1))).toBe(true);
    expect(looksLikePdf(Buffer.from("\u0000".repeat(10) + "%PDF-1.7 junk", "latin1"))).toBe(true);
    expect(looksLikePdf(Buffer.from("merhaba dünya"))).toBe(false);
    expect(looksLikePdf(Buffer.from("PK\u0003\u0004docx"))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(2000, 0x20))).toBe(false);
  });

  it("estimates pages from the root /Count, falls back to /Type /Page leaves, else undefined", () => {
    expect(estimatePdfPageCount(syntheticPdf(7))).toBe(7);
    expect(estimatePdfPageCount(syntheticPdf(3, { countInRoot: false }))).toBe(3);
    expect(estimatePdfPageCount(syntheticPdf(101))).toBe(101);
    // Intermediate nodes carry /Parent and must not win over the root count.
    const nested = Buffer.from(
      "%PDF-1.4\n2 0 obj\n<< /Type /Pages /Kids [5 0 R] /Count 12 >>\nendobj\n" +
        "5 0 obj\n<< /Type /Pages /Parent 2 0 R /Kids [] /Count 40 >>\nendobj\n",
      "latin1",
    );
    expect(estimatePdfPageCount(nested)).toBe(12);
    // Object streams: no visible page tree.
    expect(estimatePdfPageCount(Buffer.from("%PDF-1.5\n9 0 obj\n<< /Type /ObjStm >>\nstream\n...", "latin1"))).toBeUndefined();
  });
});

describe("provenance", () => {
  it("formats GG.AA.YYYY and builds the exact header", () => {
    const date = new Date(2026, 8, 2, 10, 30);
    expect(formatDateTr(date)).toBe("02.09.2026");
    expect(buildProvenanceHeader("tarama.pdf", date, "claude-sonnet-5")).toBe(
      "AI OCR — kaynak: tarama.pdf — 02.09.2026 — claude-sonnet-5",
    );
  });

  it("derives the upload name and an upload-safe text", () => {
    expect(ocrUploadName("Dava Dosyası.PDF")).toBe("Dava Dosyası.ocr.txt");
    expect(ocrUploadName("notlar")).toBe("notlar.ocr.txt");
    expect(ocrUploadName(".pdf")).toBe("belge.ocr.txt");
    const text = renderUploadText("BAŞLIK", [
      { page: 1, text: "bir\fiki" },
      { page: 2, text: "üç" },
    ]);
    expect(text.split("\n")[0]).toBe("BAŞLIK");
    expect(text).toContain("[Sayfa 1]\nbir\niki");
    expect(text).toContain("[Sayfa 2]\nüç");
    expect(text).not.toContain("\f");
  });
});

describe("transcribePdf batching", () => {
  function fakeAdapter(reply: (input: TranscribePagesInput) => Array<{ page: number; text: string }>) {
    const inputs: TranscribePagesInput[] = [];
    return {
      inputs,
      adapter: {
        transcribePages: async (input: TranscribePagesInput) => {
          inputs.push(input);
          return {
            value: reply(input),
            usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
          };
        },
      },
    };
  }

  it("requests page ranges, fills gaps honestly and ignores out-of-range pages", async () => {
    const { adapter, inputs } = fakeAdapter((input) => {
      const first = input.firstPage!;
      const last = input.lastPage!;
      const pages: Array<{ page: number; text: string }> = [];
      for (let p = first; p <= last; p += 1) {
        if (p === 5) continue; // model skipped a page
        pages.push({ page: p, text: `sayfa ${p}` });
      }
      if (first === 1) pages.push({ page: 99, text: "aralık dışı" });
      return pages;
    });
    const run = await transcribePdf(adapter, {
      bytes: syntheticPdf(10),
      fileName: "t.pdf",
      pageCount: 10,
      batchSize: 4,
    });
    expect(inputs.map((i) => [i.firstPage, i.lastPage])).toEqual([
      [1, 4],
      [5, 8],
      [9, 10],
    ]);
    expect(inputs[0]!.timeoutMs).toBe(OCR_TIMEOUT_MS);
    expect(inputs[0]!.maxTokens).toBe(OCR_MAX_TOKENS);
    expect(inputs[0]!.pdfBase64).toBe(syntheticPdf(10).toString("base64"));
    expect(run.pageCount).toBe(10);
    expect(run.pages).toHaveLength(10);
    expect(run.pages[4]).toEqual({ page: 5, text: "" });
    expect(run.pages[9]).toEqual({ page: 10, text: "sayfa 10" });
    expect(run.requests).toBe(3);
    expect(run.usage.inputTokens).toBe(30);
    expect(run.warnings.some((w) => w.includes("Sayfa 5"))).toBe(true);
    expect(run.warnings.some((w) => w.includes("sayfa 99"))).toBe(true);
    expect(OCR_PAGES_PER_REQUEST).toBe(8);
  });

  it("asks for every page in one request when the count is unknown, and says so", async () => {
    const { adapter, inputs } = fakeAdapter(() => [
      { page: 2, text: "iki" },
      { page: 1, text: "bir" },
      { page: 2, text: "tekrar" },
    ]);
    const run = await transcribePdf(adapter, { bytes: Buffer.from("%PDF-"), fileName: "u.pdf", pageCount: undefined });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.firstPage).toBeUndefined();
    expect(run.pageCount).toBe(2);
    expect(run.pages).toEqual([
      { page: 1, text: "bir" },
      { page: 2, text: "iki" },
    ]);
    expect(run.warnings[0]).toContain("belirlenemedi");
    expect(run.warnings.some((w) => w.includes("birden fazla"))).toBe(true);
  });
});
