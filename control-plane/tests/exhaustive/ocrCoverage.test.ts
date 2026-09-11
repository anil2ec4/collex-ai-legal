/**
 * W20 acceptance K (control-plane side): OCR pages in processing coverage.
 *
 * A page read by local OCR counts as processed (`pagesOcr`), keeps its
 * physical page locator, and — below the confidence floor, which intake
 * records as SPARSE — blocks an exhaustive claim with OCR_LOW_CONFIDENCE.
 * A scanned page with NO OCR stays UNREADABLE (W19 behaviour, unchanged).
 */

import { describe, expect, it } from "vitest";
import { planUnits, runMap, runReduce, type ScopedDocument } from "../../src/exhaustive/runner.js";

const TEXT_PAGE = "Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır ve aylık bedel 10.000 TL olarak belirlenmiştir.";
const OCR_PAGE = "Taranmış sayfa 2: tahliye ihtarı 11.03.2024 tarihinde tebliğ edilmiştir.";

function scanned(status: "EXTRACTED" | "SPARSE" | "UNREADABLE", method: string): ScopedDocument {
  const second = status === "UNREADABLE" ? "" : OCR_PAGE;
  const canonical = second === "" ? TEXT_PAGE : `${TEXT_PAGE}\n\n${second}`;
  const firstEnd = [...TEXT_PAGE].length;
  const secondStart = second === "" ? firstEnd : firstEnd + 2;
  const secondEnd = second === "" ? firstEnd : secondStart + [...second].length;
  return {
    fileId: "ocr-file",
    fileName: "Taranmış dilekçe",
    documentVersionId: "11111111-1111-1111-1111-111111111111",
    canonicalText: canonical,
    spans: [
      { chunkId: "c1", ordinal: 0, startChar: 0, endChar: firstEnd },
      ...(second === "" ? [] : [{ chunkId: "c2", ordinal: 1, startChar: secondStart, endChar: secondEnd }]),
    ],
    segments: [
      { locatorKind: "page", locatorLabel: "1", startChar: 0, endChar: firstEnd, extractionMethod: "pdf_text_layer", extractionStatus: "EXTRACTED" },
      { locatorKind: "page", locatorLabel: "2", startChar: secondStart, endChar: secondEnd, extractionMethod: method, extractionStatus: status },
    ],
  };
}

function coverageOf(document: ScopedDocument) {
  const units = planUnits([document]);
  const { ledger, observations } = runMap(units, [document]);
  return { coverage: runReduce([document], ledger, observations, []).coverage, observations };
}

describe("K: OCR pages in processing coverage", () => {
  it("a confidently OCR'd page is processed, counted as OCR, and cited by its page", () => {
    const { coverage, observations } = coverageOf(scanned("EXTRACTED", "ocr"));
    expect(coverage.pagesTotal).toBe(2);
    expect(coverage.pagesOcr).toBe(1);
    expect(coverage.pagesTextLayer).toBe(1);
    expect(coverage.pagesUnreadable).toBe(0);
    expect(coverage.complete).toBe(true);
    const fromScan = observations.find((observation) => observation.quote.includes("11.03.2024"));
    // The quote window (±160 code points) reaches back into page 1, so the
    // span honestly cites both pages; page 2 is always part of it.
    expect(fromScan?.locator).toMatch(/^s\. (1-)?2$/u);
  });

  it("a low-confidence OCR page blocks the exhaustive claim", () => {
    const { coverage } = coverageOf(scanned("SPARSE", "ocr"));
    expect(coverage.pagesOcr).toBe(1);
    expect(coverage.complete).toBe(false);
    expect(coverage.gaps).toContainEqual(
      expect.objectContaining({ locator: "s. 2", reason: "OCR_LOW_CONFIDENCE" }),
    );
  });

  it("without OCR the scanned page stays UNREADABLE and coverage incomplete", () => {
    const { coverage } = coverageOf(scanned("UNREADABLE", "none"));
    expect(coverage.pagesUnreadable).toBe(1);
    expect(coverage.pagesOcr).toBe(0);
    expect(coverage.complete).toBe(false);
    expect(coverage.gaps).toContainEqual(
      expect.objectContaining({ locator: "s. 2", reason: "UNREADABLE_NO_TEXT" }),
    );
  });
});
