/**
 * Quote verification (exact, NFC, code-point offsets) and the chunk token
 * budget guard (truncate by whole chunk, never mid-chunk, always warn).
 */

import { describe, expect, it } from "vitest";

import {
  estimateTokens,
  selectChunksWithinBudget,
  verifyAnalysis,
  verifyQuote,
} from "../../src/ai/analysis.js";
import type { AiFileChunk } from "../../src/ai/types.js";

function chunk(id: string, ordinal: number, text: string, startChar = 0): AiFileChunk {
  return {
    fileId: "file-1",
    fileName: "belge.pdf",
    chunkId: id,
    ordinal,
    text,
    startChar,
    endChar: startChar + [...text].length,
    contentSha256: "00",
  };
}

describe("verifyQuote", () => {
  it("accepts an exact substring and reports code-point offsets", () => {
    // "𝔄" is one code point but two UTF-16 units: offsets must not count it twice.
    const text = "𝔄 Davacı Ayşe Yılmaz, İstanbul'da ikamet eder.";
    const check = verifyQuote(text, "Ayşe Yılmaz");
    expect(check.verified).toBe(true);
    expect(check.startChar).toBe(9);
    expect(check.endChar).toBe(20);
    expect([...text].slice(check.startChar, check.endChar).join("")).toBe("Ayşe Yılmaz");
  });

  it("normalizes both sides to NFC before comparing", () => {
    const decomposed = "Işık"; // s + U+0327 COMBINING CEDILLA
    const composed = "Işık"; // U+015F LATIN SMALL LETTER S WITH CEDILLA
    expect(decomposed).not.toBe(composed);
    expect(decomposed.normalize("NFC")).toBe(composed);
    expect(verifyQuote(`Ad: ${decomposed} Kaya`, composed).verified).toBe(true);
    expect(verifyQuote(`Ad: ${composed} Kaya`, decomposed)).toEqual({
      verified: true,
      startChar: 4,
      endChar: 8,
    });
  });

  it("rejects paraphrases, whitespace changes and empty quotes", () => {
    const text = "Kiracı, kira bedelini her ayın beşinci günü öder.";
    expect(verifyQuote(text, "Kiracı kira bedelini her ayın beşinci günü öder.").verified).toBe(false);
    expect(verifyQuote(text, "kira  bedelini").verified).toBe(false);
    expect(verifyQuote(text, "").verified).toBe(false);
    expect(verifyQuote(text, "   ").verified).toBe(false);
  });
});

describe("selectChunksWithinBudget", () => {
  it("admits whole chunks in ordinal order until the budget is reached", () => {
    const chunks = [
      chunk("c3", 2, "ü".repeat(50)),
      chunk("c1", 0, "a".repeat(50)),
      chunk("c2", 1, "b".repeat(50)),
    ];
    expect(estimateTokens("a".repeat(50))).toBe(20);
    const selection = selectChunksWithinBudget(chunks, 45);
    expect(selection.selected.map((c) => c.chunkId)).toEqual(["c1", "c2"]);
    expect(selection.dropped.map((c) => c.chunkId)).toEqual(["c3"]);
    expect(selection.warnings).toHaveLength(1);
    expect(selection.warnings[0]).toContain("parça ortasından kesilmedi");
    expect(selection.estimatedTokens).toBe(40);
  });

  it("keeps everything (no warning) when it fits, and always keeps the first chunk", () => {
    const fits = selectChunksWithinBudget([chunk("c1", 0, "a".repeat(10))], 100);
    expect(fits.dropped).toEqual([]);
    expect(fits.warnings).toEqual([]);
    const huge = selectChunksWithinBudget(
      [chunk("c1", 0, "a".repeat(1000)), chunk("c2", 1, "b")],
      5,
    );
    expect(huge.selected.map((c) => c.chunkId)).toEqual(["c1"]);
    expect(huge.warnings.some((w) => w.includes("Tek bir parça"))).toBe(true);
  });
});

describe("verifyAnalysis", () => {
  it("marks unverifiable findings kaynakli:false, keeps them, counts them", () => {
    const chunks = [
      chunk("c1", 0, "Davacı Ayşe Yılmaz alacak talep eder.", 100),
      chunk("c2", 1, "Sözleşme 4. madde.", 200),
    ];
    const lists = verifyAnalysis(
      {
        ozet: "özet",
        taraflar: [{ text: "Davacı", evidence: [{ chunkId: "c1", quote: "Ayşe Yılmaz" }] }],
        talepler: [
          {
            text: "Alacak",
            evidence: [
              { chunkId: "c1", quote: "alacak talep eder" },
              { chunkId: "c2", quote: "yok böyle" },
            ],
          },
        ],
        dayanaklar: [{ text: "Bilinmeyen parça", evidence: [{ chunkId: "c-yok", quote: "Davacı" }] }],
        tarihler: [{ text: "Kanıtsız", evidence: [] }],
        riskler: [],
        eksikler: [],
        karsiArgumanlar: [],
        maddeler: [{ text: "madde riski", evidence: [{ chunkId: "c2", quote: "4. madde" }] }],
      },
      chunks,
      "genel",
    );
    expect(lists.taraflar[0]!.kaynakli).toBe(true);
    expect(lists.taraflar[0]!.evidence[0]).toEqual({
      chunkId: "c1",
      quote: "Ayşe Yılmaz",
      dogrulandi: true,
      startChar: 107,
      endChar: 118,
    });
    // One bad pointer poisons the finding (never partially "sourced").
    expect(lists.talepler[0]!.kaynakli).toBe(false);
    expect(lists.talepler[0]!.evidence.map((e) => e.dogrulandi)).toEqual([true, false]);
    expect(lists.dayanaklar[0]!.kaynakli).toBe(false);
    expect(lists.tarihler[0]!.kaynakli).toBe(false);
    expect(lists.kaynaksizCount).toBe(3);
    expect(lists.itemCount).toBe(4);
    // maddeler is only reported for the sözleşme focus.
    expect(lists.maddeler).toBeUndefined();
    const sozlesme = verifyAnalysis(
      {
        ozet: "",
        taraflar: [],
        talepler: [],
        dayanaklar: [],
        tarihler: [],
        riskler: [],
        eksikler: [],
        karsiArgumanlar: [],
        maddeler: [{ text: "m", evidence: [{ chunkId: "c2", quote: "4. madde" }] }],
      },
      chunks,
      "sozlesme",
    );
    expect(sozlesme.maddeler).toHaveLength(1);
    expect(sozlesme.maddeler![0]!.kaynakli).toBe(true);
    expect(sozlesme.itemCount).toBe(1);
  });
});
