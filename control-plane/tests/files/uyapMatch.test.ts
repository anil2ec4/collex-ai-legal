/**
 * W22 — UYAP download matching (pure). Which matter a document belongs to is
 * decided by (court, esas) with the filter fold, EXACT on the esas number;
 * anything the pair does not settle is listed, never assigned.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  courtKey,
  esasKey,
  importSummarySentence,
  matchReading,
  MATCH_REASON_TR,
  numberPossessive,
  turkishTitleCase,
  type MatterRef,
  type UyapField,
  type UyapReading,
} from "../../src/files/uyapMatch.js";
import { UYAP_MAX_FILES } from "../../src/files/uyapRoutes.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const MATTERS: MatterRef[] = [
  { id: "m1", title: "Yılmaz / Örnek Lojistik", court: "İstanbul Anadolu 5. İş Mahkemesi", docketNo: "2024/123 E." },
  { id: "m2", title: "Beta / Gama", court: "İstanbul 12. Asliye Ticaret Mahkemesi", docketNo: "2023/456 Esas" },
  { id: "m3", title: "Kara / Deniz", court: "İzmir 2. Asliye Hukuk Mahkemesi", docketNo: "2024/500 E." },
  { id: "m4", title: "SGK tespit", court: "İzmir 4. Asliye Hukuk Mahkemesi", docketNo: "E. 2024/500" },
];

function field(value: string, source: "content" | "filename" = "content"): UyapField {
  return { value, quote: value, start: 0, end: value.length, source };
}

function reading(court: string | null, esas: string | null, esasSource: "content" | "filename" = "content"): UyapReading {
  return {
    readerVersion: "uyap-okuma-v1",
    textRead: true,
    court: court === null ? null : field(court),
    esas: esas === null ? null : field(esas, esasSource),
    karar: null,
    documentType: null,
    documentDate: null,
    filename: { esas: null, documentType: null },
    esasConflict: false,
  };
}

describe("keys", () => {
  it("reads the esas number of a docket field exactly, never the karar number", () => {
    expect(esasKey("2024/123 E.")).toBe("2024/123");
    expect(esasKey("E. 2024/0123")).toBe("2024/123");
    expect(esasKey("Esas No: 2024/123")).toBe("2024/123");
    expect(esasKey("2025/45 K. — 2024/123 E.")).toBe("2024/123");
    expect(esasKey("K. 2025/45")).toBeUndefined();
    expect(esasKey("2024/123")).toBe("2024/123");
    expect(esasKey("")).toBeUndefined();
    expect(esasKey("2024/1234")).not.toBe(esasKey("2024/123"));
  });

  it("folds the court name with the filter fold (dotless ı, İ, Ş, apostrophes, T.C.)", () => {
    expect(courtKey("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ")).toBe(courtKey("İstanbul Anadolu 5. İş Mahkemesi"));
    expect(courtKey("T.C. İZMİR 4. ASLİYE HUKUK MAHKEMESİ")).toBe("izmir 4 asliye hukuk mahkemesi");
    expect(courtKey("Istanbul Anadolu 5. Is Mahkemesi")).toBe(courtKey("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ"));
    expect(courtKey("İstanbul Anadolu 5. İş Mah.")).not.toBe(courtKey("İstanbul Anadolu 5. İş Mahkemesi"));
    expect(turkishTitleCase("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ")).toBe("İstanbul Anadolu 5. İş Mahkemesi");
    expect(turkishTitleCase("IĞDIR 1. ASLİYE HUKUK MAHKEMESİ")).toBe("Iğdır 1. Asliye Hukuk Mahkemesi");
  });
});

describe("matchReading", () => {
  it("matches only when court AND esas equal exactly one matter", () => {
    const match = matchReading(reading("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123"), MATTERS);
    expect(match.status).toBe("matched");
    expect(match.matterId).toBe("m1");
    expect(match.reason).toBe(MATCH_REASON_TR.matched);
  });

  it("an esas read from the file name matches like one read from the content", () => {
    const match = matchReading(reading("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123", "filename"), MATTERS);
    expect(match.status).toBe("matched");
  });

  it("two matters with the same esas in different courts: the court decides", () => {
    const four = matchReading(reading("İZMİR 4. ASLİYE HUKUK MAHKEMESİ", "2024/500"), MATTERS);
    expect(four.status).toBe("matched");
    expect(four.matterId).toBe("m4");
    const two = matchReading(reading("İZMİR 2. ASLİYE HUKUK MAHKEMESİ", "2024/500"), MATTERS);
    expect(two.matterId).toBe("m3");
  });

  it("the same esas with no readable court is ambiguous and lists both, assigns neither", () => {
    const match = matchReading(reading(null, "2024/500", "filename"), MATTERS);
    expect(match.status).toBe("ambiguous");
    expect(match.matterId).toBeNull();
    expect(match.candidates.map((c) => c.matterId)).toEqual(["m3", "m4"]);
    expect(match.reason).toBe(MATCH_REASON_TR.courtUnread);
  });

  it("even ONE same-esas matter is not assigned when the court was not read", () => {
    const match = matchReading(reading(null, "2024/123", "filename"), MATTERS);
    expect(match.status).toBe("ambiguous");
    expect(match.candidates.map((c) => c.matterId)).toEqual(["m1"]);
  });

  it("a differently spelled court is ambiguous with the reason, never a silent match", () => {
    const match = matchReading(reading("İZMİR 7. ASLİYE HUKUK MAHKEMESİ", "2024/500"), MATTERS);
    expect(match.status).toBe("ambiguous");
    expect(match.reason).toBe(MATCH_REASON_TR.courtDiffers);
    expect(match.candidates[0]?.reason).toContain("mahkeme farklı");
  });

  it("two matters sharing court and esas are ambiguous", () => {
    const twins: MatterRef[] = [...MATTERS, { ...MATTERS[0]!, id: "m1b", title: "İkinci kayıt" }];
    const match = matchReading(reading("İSTANBUL ANADOLU 5. İŞ MAHKEMESİ", "2024/123"), twins);
    expect(match.status).toBe("ambiguous");
    expect(match.reason).toBe(MATCH_REASON_TR.sameCourtTwice);
    expect(match.candidates).toHaveLength(2);
  });

  it("no matter with this esas proposes a new matter prefilled with court and esas", () => {
    const match = matchReading(reading("ANKARA 3. İŞ MAHKEMESİ", "2025/77"), MATTERS);
    expect(match.status).toBe("unmatched");
    expect(match.newMatter).toEqual({
      title: "Ankara 3. İş Mahkemesi 2025/77 E.",
      court: "Ankara 3. İş Mahkemesi",
      docketNo: "2025/77 E.",
    });
  });

  it("no esas anywhere is no_esas with no proposal", () => {
    const match = matchReading(reading("ANKARA 3. İŞ MAHKEMESİ", null), MATTERS);
    expect(match.status).toBe("no_esas");
    expect(match.newMatter).toBeNull();
    expect(match.candidates).toEqual([]);
  });
});

describe("the closing sentence", () => {
  it("writes the Turkish possessive of every count", () => {
    const table: Array<[number, string]> = [
      [1, "1'i"], [2, "2'si"], [3, "3'ü"], [4, "4'ü"], [5, "5'i"], [6, "6'sı"], [7, "7'si"], [8, "8'i"],
      [9, "9'u"], [10, "10'u"], [12, "12'si"], [20, "20'si"], [30, "30'u"], [40, "40'ı"], [60, "60'ı"],
      [70, "70'i"], [90, "90'ı"], [100, "100'ü"], [200, "200'ü"], [1000, "1000'i"],
    ];
    for (const [n, text] of table) expect(numberPossessive(n)).toBe(text);
  });

  it("is the sentence the lawyer reads", () => {
    expect(
      importSummarySentence({ total: 12, added: 9, matters: 3, duplicates: 2, unmatched: 1, skipped: 0, failed: 0 }),
    ).toBe("12 belge: 9'u 3 dosyaya eklendi, 2'si zaten vardı, 1'i eşleşmedi.");
    expect(
      importSummarySentence({ total: 3, added: 0, matters: 0, duplicates: 0, unmatched: 0, skipped: 2, failed: 1 }),
    ).toBe("3 belge: 2'si sizin seçiminizle atlandı, 1'i işlenemedi.");
    expect(
      importSummarySentence({ total: 0, added: 0, matters: 0, duplicates: 0, unmatched: 0, skipped: 0, failed: 0 }),
    ).toBe("0 belge: hiçbiri dosyaya eklenmedi.");
  });
});

it("UYAP_MAX_FILES mirrors intake/cli.py BATCH_MAX_FILES", () => {
  const source = readFileSync(join(REPO_ROOT, "intake", "cli.py"), "utf8");
  const match = /^BATCH_MAX_FILES = (\d+)$/mu.exec(source);
  expect(match).not.toBeNull();
  expect(Number(match![1])).toBe(UYAP_MAX_FILES);
});
