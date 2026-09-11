import { describe, expect, it } from "vitest";
import { normalizeTurkishSearch, shadowFold } from "../src/retrieval/normalize.js";

describe("normalizeTurkishSearch", () => {
  it("lowercases dotted capital İ to i (Turkish locale)", () => {
    expect(normalizeTurkishSearch("İCRA VE İFLAS")).toBe("icra ve iflas");
  });

  it("lowercases ASCII capital I to dotless ı (Turkish locale)", () => {
    expect(normalizeTurkishSearch("IŞIK")).toBe("ışık");
    expect(normalizeTurkishSearch("KANUNI")).toBe("kanunı");
  });

  it("keeps lowercase ı and i unchanged", () => {
    expect(normalizeTurkishSearch("ışık iddia")).toBe("ışık iddia");
  });

  it("NFC-composes decomposed input before lowercasing", () => {
    // "I" + COMBINING DOT ABOVE composes to U+0130 (İ), then lowercases to "i".
    expect(normalizeTurkishSearch("İstanbul")).toBe("istanbul");
    // "u" + COMBINING DIAERESIS composes to "ü".
    expect(normalizeTurkishSearch("hüküm")).toBe("hüküm");
  });

  it("removes soft hyphens", () => {
    expect(normalizeTurkishSearch("kanun­name")).toBe("kanunname");
  });

  it("maps typographic dashes to ASCII hyphen", () => {
    expect(normalizeTurkishSearch("madde 5 – fıkra 2")).toBe("madde 5 - fıkra 2");
    expect(normalizeTurkishSearch("a—b‒c‐d")).toBe("a-b-c-d");
  });

  it("maps curly quotes to straight quotes", () => {
    expect(normalizeTurkishSearch("“mülkiyet”")).toBe('"mülkiyet"');
    expect(normalizeTurkishSearch("’hak‘")).toBe("'hak'");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeTurkishSearch("  tapu \t iptali \n tescil  ")).toBe("tapu iptali tescil");
  });

  it("is idempotent", () => {
    const once = normalizeTurkishSearch("  İCRA – “test”  ");
    expect(normalizeTurkishSearch(once)).toBe(once);
  });
});

describe("shadowFold (the parser's matching copy)", () => {
  it("is LENGTH-PRESERVING so parser spans stay valid", () => {
    for (const input of [
      "İSTANBUL",
      "IŞIK",
      "5237 sayılı Türk Ceza Kanunu'nun 157'nci maddesi",
      "E.2021/123 – K.2022/456",
      "“mülkiyet”",
      "MADDE 25/II",
      "İİK'NUN 89 UNCU MADDESİ",
    ]) {
      expect(shadowFold(input).length, input).toBe(input.length);
    }
  });

  it("applies Turkish dotted/dotless casing", () => {
    expect(shadowFold("İSTANBUL")).toBe("istanbul");
    expect(shadowFold("IŞIK")).toBe("ışık");
    // ASCII Roman numerals fold to DOTLESS ı — the parser's Roman class must
    // accept both, which is why "madde 25/II" works.
    expect(shadowFold("II")).toBe("ıı");
  });

  it("unifies dashes and quotes but keeps whitespace and soft hyphens", () => {
    expect(shadowFold("a–b")).toBe("a-b");
    expect(shadowFold("kanun’un")).toBe("kanun'un");
    expect(shadowFold("  a \t b  ")).toBe("  a \t b  ");
    expect(shadowFold("mad­de")).toBe("mad­de");
  });

  it("is idempotent", () => {
    const once = shadowFold("İCRA – “TEST”");
    expect(shadowFold(once)).toBe(once);
  });
});
