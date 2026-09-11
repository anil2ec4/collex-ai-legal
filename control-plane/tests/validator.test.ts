import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "../src/evidence/types.js";
import {
  codePointLength,
  codePointSlice,
  sha256HexUtf8,
  validateEvidence,
} from "../src/verification/validator.js";

const TEXT = "Madde 1 - Hak arama hürriyeti 😀 engellenemez.";
const QUOTE = "Hak arama hürriyeti";
const START = 10; // code points
const END = START + codePointLength(QUOTE);

function goodEvidence(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: "ev-1",
    documentId: "doc-1",
    documentVersionId: "docv-1",
    chunkId: "chunk-1",
    source: "BEDESTEN",
    sourceUrl: "https://example.invalid/doc",
    title: "test",
    locator: { startChar: START, endChar: END },
    quote: QUOTE,
    quoteSha256: sha256HexUtf8(QUOTE),
    contentSha256: sha256HexUtf8(TEXT),
    retrievedAt: "2026-08-26T00:00:00Z",
    ...overrides,
  };
}

describe("codePoint helpers", () => {
  it("codePointLength counts code points, not UTF-16 units", () => {
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength("😀")).toBe(1);
    expect("😀".length).toBe(2); // the UTF-16 contrast
    expect(codePointLength("q̃")).toBe(2); // combining mark is its own code point
  });

  it("codePointSlice slices by code points", () => {
    expect(codePointSlice("a😀b", 1, 2)).toBe("😀");
    expect(codePointSlice("a😀b", 2, 3)).toBe("b");
    expect(codePointSlice("abc", 0, 3)).toBe("abc");
  });
});

describe("validateEvidence", () => {
  it("accepts fully consistent evidence", () => {
    expect(validateEvidence(goodEvidence(), TEXT)).toEqual({ ok: true });
  });

  it("OFFSET_OUT_OF_RANGE: negative start", () => {
    const ev = goodEvidence({ locator: { startChar: -1, endChar: END } });
    expect(validateEvidence(ev, TEXT)).toEqual({ ok: false, reason: "OFFSET_OUT_OF_RANGE" });
  });

  it("OFFSET_OUT_OF_RANGE: end <= start", () => {
    const ev = goodEvidence({ locator: { startChar: 5, endChar: 5 } });
    expect(validateEvidence(ev, TEXT)).toEqual({ ok: false, reason: "OFFSET_OUT_OF_RANGE" });
  });

  it("OFFSET_OUT_OF_RANGE: end beyond code point length (even if within UTF-16 length)", () => {
    const cpLen = codePointLength(TEXT);
    expect(TEXT.length).toBeGreaterThan(cpLen); // TEXT contains an astral emoji
    const ev = goodEvidence({ locator: { startChar: 0, endChar: cpLen + 1 } });
    expect(validateEvidence(ev, TEXT)).toEqual({ ok: false, reason: "OFFSET_OUT_OF_RANGE" });
  });

  it("OFFSET_OUT_OF_RANGE: non-integer offsets", () => {
    const ev = goodEvidence({ locator: { startChar: 1.5, endChar: END } });
    expect(validateEvidence(ev, TEXT)).toEqual({ ok: false, reason: "OFFSET_OUT_OF_RANGE" });
  });

  it("QUOTE_OFFSET_MISMATCH: quote does not match the slice", () => {
    const ev = goodEvidence({ quote: "Hak arama hürriyetX" });
    expect(validateEvidence(ev, TEXT)).toEqual({
      ok: false,
      reason: "QUOTE_OFFSET_MISMATCH",
    });
  });

  it("QUOTE_OFFSET_MISMATCH: offsets shifted by one", () => {
    const ev = goodEvidence({ locator: { startChar: START + 1, endChar: END + 1 } });
    expect(validateEvidence(ev, TEXT)).toEqual({
      ok: false,
      reason: "QUOTE_OFFSET_MISMATCH",
    });
  });

  it("QUOTE_HASH_MISMATCH: quote text right but hash wrong", () => {
    const ev = goodEvidence({ quoteSha256: "0".repeat(64) });
    expect(validateEvidence(ev, TEXT)).toEqual({ ok: false, reason: "QUOTE_HASH_MISMATCH" });
  });

  it("DOCUMENT_VERSION_MISMATCH: content hash of a different version", () => {
    const ev = goodEvidence({ contentSha256: sha256HexUtf8(TEXT + " değişti") });
    expect(validateEvidence(ev, TEXT)).toEqual({
      ok: false,
      reason: "DOCUMENT_VERSION_MISMATCH",
    });
  });

  it("check order: offset error wins over hash errors", () => {
    const ev = goodEvidence({
      locator: { startChar: -5, endChar: -1 },
      quoteSha256: "0".repeat(64),
      contentSha256: "0".repeat(64),
    });
    expect(validateEvidence(ev, TEXT)).toEqual({ ok: false, reason: "OFFSET_OUT_OF_RANGE" });
  });
});
