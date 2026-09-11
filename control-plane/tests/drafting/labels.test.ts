/**
 * Contract E regression: the "N sayılı" citation-label prefix is added at
 * ONE builder and never doubled. A değişiklik kanunu whose title already
 * begins "7999 sayılı ..." must not render as "7999 sayılı 7999 sayılı ...".
 */

import { describe, expect, it } from "vitest";

import { citeLabel, legislationLabel } from "../../src/answer/evidencePack.js";
import { draftEvidenceLabel } from "../../src/drafting/evidence.js";
import type { EvidenceRef } from "../../src/evidence/types.js";

function refWithTitle(title: string): EvidenceRef {
  return {
    evidenceId: "ev-x",
    documentId: "doc-x",
    documentVersionId: "docv-x",
    chunkId: "chunk-x",
    source: "MEVZUAT",
    sourceUrl: "",
    title,
    legislationNo: "7999",
    locator: { startChar: 0, endChar: 10, article: "1" },
    quote: "0123456789",
    quoteSha256: "0".repeat(64),
    contentSha256: "1".repeat(64),
    retrievedAt: "2026-08-28T00:00:00Z",
  };
}

describe("legislationLabel — the single 'N sayılı' builder", () => {
  it("prefixes a bare title", () => {
    expect(legislationLabel("5237", "Türk Ceza Kanunu")).toBe("5237 sayılı Türk Ceza Kanunu");
  });

  it("NEVER doubles the prefix when the title already carries it", () => {
    expect(
      legislationLabel("7999", "7999 sayılı Bazı Kanunlarda Değişiklik Yapılmasına Dair Kanun"),
    ).toBe("7999 sayılı Bazı Kanunlarda Değişiklik Yapılmasına Dair Kanun");
  });

  it("also skips the prefix for a DIFFERENT leading number (still 'N sayılı')", () => {
    // The title is authoritative about its own numbering; stacking another
    // "sayılı" in front is wrong in every case.
    expect(legislationLabel("7999", "7101 sayılı Sentetik Değişiklik Kanunu")).toBe(
      "7101 sayılı Sentetik Değişiklik Kanunu",
    );
  });
});

describe("all label surfaces inherit the fix", () => {
  const PREFIXED_TITLE = "7999 sayılı Torba Kanun (sentetik)";

  it("citeLabel (answer/tespit surface)", () => {
    const label = citeLabel(refWithTitle(PREFIXED_TITLE));
    expect(label).toContain(PREFIXED_TITLE);
    expect(label).not.toContain("7999 sayılı 7999 sayılı");
    expect(label).toContain("m. 1");
  });

  it("draftEvidenceLabel (dilekçe Dayanak / DAYANAK KAYNAKLARI surface)", () => {
    const label = draftEvidenceLabel({ title: PREFIXED_TITLE, legislationNo: "7999" });
    expect(label).toBe(PREFIXED_TITLE);
    const bare = draftEvidenceLabel({ title: "Torba Kanun (sentetik)", legislationNo: "7999" });
    expect(bare).toBe("7999 sayılı Torba Kanun (sentetik)");
  });
});
