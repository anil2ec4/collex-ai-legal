/**
 * Fee calculator contract (W14 B-35): step-by-step arithmetic, no invented
 * amount, the disclaimer verbatim on every result, and a kesinlik sınırı that
 * refuses to answer with the statutory base alone without warning about it.
 */

import { describe, expect, it } from "vitest";

import { computeFees, FeeInputError, roundTl } from "../../src/fees/calc.js";
import { FEE_DISCLAIMER, FEE_TARIFFS } from "../../src/fees/tariffs.js";

const YEAR = 2026;
// Preserve the missing-data scenarios independently of the published tariff.
const unknownAmounts = { tariffs: FEE_TARIFFS.map((tariff) => ({ ...tariff,
  lines: tariff.lines.map((line) => line.kind === "maktu" ? { ...line, amount: null,
    verified: { ...line.verified, status: "dogrulanmadi" as const } } : line),
})) };

describe("computeFees — dava harcı", () => {
  it("computes the nispi karar ve ilam harcı from the statutory binde 68,31", () => {
    const result = computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 100_000 });
    const step = result.steps.find((s) => s.id === "karar-ilam-harci")!;
    expect(step.durum).toBe("hesaplandi");
    // 100.000 × 68,31 / 1000 = 6.831,00
    expect(step.amount).toBe(6831);
    expect(step.verified).toBe("dogrulandi");
    expect(step.detail).toContain("binde 68,31");
  });

  it("shows the arithmetic step by step and carries the disclaimer verbatim", () => {
    const result = computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 250_000 });
    expect(result.disclaimer).toBe(FEE_DISCLAIMER);
    expect(result.steps.map((s) => s.id)).toEqual([
      "dava-degeri",
      "basvurma-harci",
      "karar-ilam-harci",
      "karar-ilam-harci-asgari",
      "pesin-harc",
      "gider-avansi",
      "acilista-odenecek",
    ]);
    for (const step of result.steps) {
      expect(step.label.length).toBeGreaterThan(3);
      expect(step.detail.length).toBeGreaterThan(10);
    }
  });

  it("returns a null total and names the missing lines instead of guessing", () => {
    const result = computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 50_000 }, unknownAmounts);
    expect(result.toplam).toBeNull();
    expect(result.eksikKalemler).toContain("basvurma-harci-asliye");
    expect(result.eksikKalemler).toContain("gider-avansi");
    for (const id of ["basvurma-harci", "gider-avansi"]) {
      const step = result.steps.find((s) => s.id === id)!;
      expect(step.amount).toBeNull();
      expect(step.durum).toBe("TUTAR_GEREKLI");
    }
    expect(result.dogrulanmamisKalemler).toContain("basvurma-harci-asliye");
  });

  it("uses the lawyer's overrides and then produces a real total", () => {
    const result = computeFees({
      year: YEAR,
      kind: "dava-harci",
      davaDegeri: 100_000,
      overrides: {
        "basvurma-harci-asliye": 1_500,
        "gider-avansi": 4_000,
        "karar-ilam-harci-nispi-asgari": 500,
      },
    });
    const pesin = result.steps.find((s) => s.id === "pesin-harc")!;
    expect(pesin.amount).toBe(roundTl(6831 * 0.25));
    // 1.500 + 1.707,75 + 4.000
    expect(result.toplam).toBe(roundTl(1500 + 6831 * 0.25 + 4000));
    expect(result.eksikKalemler).toEqual([]);
    const basvurma = result.steps.find((s) => s.id === "basvurma-harci")!;
    expect(basvurma.kullaniciDegeri).toBe(true);
    expect(basvurma.detail).toContain("Girdiğiniz tutar");
  });

  it("applies the nispi alt sınır when the lawyer supplies it", () => {
    const result = computeFees({
      year: YEAR,
      kind: "dava-harci",
      davaDegeri: 1_000,
      overrides: { "karar-ilam-harci-nispi-asgari": 1_000 },
    });
    const asgari = result.steps.find((s) => s.id === "karar-ilam-harci-asgari")!;
    expect(asgari.durum).toBe("hesaplandi");
    expect(asgari.amount).toBe(1000);
    expect(result.steps.find((s) => s.id === "pesin-harc")!.amount).toBe(250);
  });

  it("warns when the alt sınır is unknown instead of silently skipping it", () => {
    const result = computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 1_000 }, unknownAmounts);
    expect(result.warnings.join(" ")).toContain("alt sınırı bilinmiyor");
  });

  it("honours the mahkeme choice for the başvurma harcı row", () => {
    const sulh = computeFees({
      year: YEAR,
      kind: "dava-harci",
      davaDegeri: 10_000,
      mahkeme: "sulh",
      overrides: { "basvurma-harci-sulh": 900 },
    });
    expect(sulh.steps.find((s) => s.id === "basvurma-harci")!.amount).toBe(900);
    expect(sulh.eksikKalemler).not.toContain("basvurma-harci-sulh");
  });
});

describe("computeFees — vekâlet ücreti", () => {
  it("computes the Av.K. m.164/2 ceiling and refuses to guess the AAÜT ladder", () => {
    const result = computeFees({ year: YEAR, kind: "vekalet-ucreti", davaDegeri: 400_000 });
    const tavan = result.steps.find((s) => s.id === "nispi-ucret-tavani")!;
    expect(tavan.amount).toBe(100_000);
    expect(tavan.verified).toBe("dogrulandi");
    expect(tavan.detail).toContain("maktu ücret bu sınıra tabi değildir");

    const aaut = result.steps.find((s) => s.id === "aaut-nispi")!;
    expect(aaut.amount).toBeNull();
    expect(aaut.durum).toBe("TUTAR_GEREKLI");
    expect(result.eksikKalemler).toContain("aaut-nispi-kademeler");
    expect(result.toplam).toBeNull();
    expect(result.warnings.join(" ")).toContain("m.163/2");
  });
});

describe("computeFees — kesinlik sınırı", () => {
  it("compares against the lawyer's current limit and answers açık/kesin", () => {
    const acik = computeFees({
      year: YEAR,
      kind: "kesinlik-siniri",
      davaDegeri: 120_000,
      yol: "hmk-istinaf",
      overrides: { "hmk-istinaf-kesinlik": 100_000 },
    });
    expect(acik.sinirSonucu?.kanunYoluAcik).toBe(true);
    expect(acik.sinirSonucu?.kullaniciDegeri).toBe(true);
    expect(acik.warnings.join(" ")).not.toContain("TABAN");

    const kesin = computeFees({
      year: YEAR,
      kind: "kesinlik-siniri",
      davaDegeri: 80_000,
      yol: "hmk-istinaf",
      overrides: { "hmk-istinaf-kesinlik": 100_000 },
    });
    expect(kesin.sinirSonucu?.kanunYoluAcik).toBe(false);
    expect(kesin.steps.find((s) => s.id === "kesinlik-sonucu")!.detail).toContain("KESİNDİR");
  });

  it("treats the boundary as inclusive: equal to the limit is KESİN", () => {
    const result = computeFees({
      year: YEAR,
      kind: "kesinlik-siniri",
      davaDegeri: 100_000,
      yol: "hmk-temyiz",
      overrides: { "hmk-temyiz-kesinlik": 100_000 },
    });
    expect(result.sinirSonucu?.kanunYoluAcik).toBe(false);
  });

  it("WARNS loudly when it falls back to the statutory base instead of this year's limit", () => {
    const result = computeFees({
      year: YEAR,
      kind: "kesinlik-siniri",
      davaDegeri: 50_000,
      yol: "hmk-temyiz",
    });
    expect(result.sinirSonucu?.sinir).toBe(40_000);
    expect(result.sinirSonucu?.kullaniciDegeri).toBe(false);
    expect(result.warnings.join(" ")).toContain("KANUNDAKİ TABAN");
    expect(result.warnings.join(" ")).toContain("yeniden değerleme");
  });

  it("answers 'belirlenemedi' when even the base is unknown (İYUK)", () => {
    const result = computeFees({
      year: YEAR,
      kind: "kesinlik-siniri",
      davaDegeri: 50_000,
      yol: "iyuk-istinaf",
    });
    expect(result.sinirSonucu?.kanunYoluAcik).toBeNull();
    expect(result.sinirSonucu?.sinir).toBeNull();
    expect(result.eksikKalemler).toContain("iyuk-istinaf-kesinlik");
  });
});

describe("computeFees — input discipline", () => {
  it("refuses an unknown year, a missing dava değeri, a missing yol and a negative override", () => {
    expect(() => computeFees({ year: 1999, kind: "dava-harci", davaDegeri: 1 })).toThrow(FeeInputError);
    expect(() => computeFees({ year: YEAR, kind: "dava-harci" })).toThrow(/Dava değeri/u);
    expect(() => computeFees({ year: YEAR, kind: "kesinlik-siniri", davaDegeri: 1 })).toThrow(
      /kanun yolunun/u,
    );
    expect(() =>
      computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 1, overrides: { "gider-avansi": -5 } }),
    ).toThrow(FeeInputError);
    expect(() =>
      computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 1, overrides: { "yok-boyle": 5 } }),
    ).toThrow(/bulunamadı/u);
  });

  it("rounds TL to two decimals", () => {
    expect(roundTl(1.005)).toBe(1.01);
    expect(roundTl(6830.999)).toBe(6831);
    const result = computeFees({ year: YEAR, kind: "dava-harci", davaDegeri: 12_345.67 });
    const step = result.steps.find((s) => s.id === "karar-ilam-harci")!;
    expect(step.amount).toBe(roundTl((12_345.67 * 68.31) / 1000));
    expect(String(step.amount).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
