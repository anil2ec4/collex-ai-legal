/**
 * Tariff registry contract (W14 B-35).
 *
 * The rule this file exists to keep: ColleX never invents a fee. A tariff line
 * is either backed by a statute text that was pulled and compared (then it may
 * be `dogrulandi`), or its amount is `null` and it says `dogrulanmadi`. A
 * sourceless `dogrulandi` is rejected here, exactly as in the deadline rules.
 */

import { describe, expect, it } from "vitest";

import {
  FEE_AMOUNT_UNKNOWN_TEXT,
  FEE_DISCLAIMER,
  FEE_GROUP_LABELS_TR,
  FEE_LINE_GROUPS,
  FEE_TARIFFS,
  FEE_YEARS,
  findTariff,
  findTariffLine,
} from "../../src/fees/tariffs.js";

const ALL_LINES = FEE_TARIFFS.flatMap((tariff) => tariff.lines);

describe("FEE_TARIFFS registry", () => {
  it("carries the mandatory disclaimer, names ColleX and never promises a number", () => {
    expect(FEE_DISCLAIMER).toBe(
      "Harç, gider ve vekâlet ücreti hesabı bilgi amaçlıdır; tarifeler her yıl Resmî Gazete'de yenilenir ve tutarlar avukatça kontrol edilmelidir — eksik veya yanlış yatırılan harçtan ColleX sorumlu değildir.",
    );
    expect(FEE_DISCLAIMER).toContain("ColleX sorumlu değildir");
    expect(FEE_AMOUNT_UNKNOWN_TEXT.length).toBeGreaterThan(40);
  });

  it("exposes at least one year and a stable group vocabulary", () => {
    expect(FEE_YEARS.length).toBeGreaterThanOrEqual(1);
    expect(FEE_YEARS).toContain(2026);
    expect(findTariff(2026)).toBeDefined();
    expect(findTariff(1999)).toBeUndefined();
    for (const group of FEE_LINE_GROUPS) {
      expect(FEE_GROUP_LABELS_TR[group].length).toBeGreaterThan(3);
    }
  });

  it("every line is well formed: unique id, reference, verification, Turkish notes", () => {
    for (const tariff of FEE_TARIFFS) {
      const ids = new Set<string>();
      expect(tariff.lines.length).toBeGreaterThanOrEqual(10);
      for (const line of tariff.lines) {
        expect(line.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
        expect(ids.has(line.id), `duplicate ${line.id}`).toBe(false);
        ids.add(line.id);
        expect(line.title.length).toBeGreaterThan(8);
        expect(FEE_LINE_GROUPS).toContain(line.group);
        expect(["maktu", "nispi", "oran", "sinir"]).toContain(line.kind);
        expect(line.reference.label.length).toBeGreaterThan(3);
        expect(["dogrulandi", "dogrulanmadi"]).toContain(line.verified.status);
        expect(line.verified.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        expect(line.nasilDogrulanir.length).toBeGreaterThan(40);
        expect(line.notes.length).toBeGreaterThanOrEqual(1);
        for (const note of line.notes) {
          expect(note.length).toBeGreaterThan(20);
          expect(note).not.toContain("TODO");
        }
        // A rate belongs to nispi/oran lines only, an amount to maktu/sinir.
        if (line.kind === "nispi" || line.kind === "oran") {
          expect(line.amount, line.id).toBeNull();
        } else {
          expect(line.rate, line.id).toBeNull();
        }
        if (line.kind === "oran" && line.rate !== null) {
          expect(line.rate).toBeGreaterThan(0);
          expect(line.rate).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("REJECTS a sourceless 'dogrulandi': the source names the text and the access date", () => {
    const verified = ALL_LINES.filter((line) => line.verified.status === "dogrulandi");
    expect(verified.length).toBeGreaterThan(0);
    for (const line of verified) {
      const source = line.verified.source;
      expect(source, line.id).toMatch(/\d{2}\.\d{2}\.\d{4}/u);
      if (line.verified.sourceUrl !== undefined) {
        expect(new URL(line.verified.sourceUrl).hostname).toBe("cdn.gib.gov.tr");
        expect(source).toContain(line.verified.sourceUrl);
        expect(line.verified.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(source).toContain("98 Seri No.lu");
      } else {
        expect(source, line.id).toContain("mevzuat.gov.tr");
      }
      expect(source, line.id).not.toContain("elde edilemedi");
      // The citation itself must be in the source line.
      expect(source, line.id).toContain(line.reference.label.split(" (")[0]!.slice(0, 8));
    }
  });

  it("a yearly monetary amount is NEVER invented: unverified maktu lines carry amount null", () => {
    for (const line of ALL_LINES) {
      if (line.kind !== "maktu") continue;
      if (line.verified.status === "dogrulanmadi") {
        expect(line.amount, `${line.id} invents a yearly amount`).toBeNull();
      }
    }
  });

  it("a verified 'sinir' amount is the STATUTORY BASE and says so", () => {
    for (const line of ALL_LINES) {
      if (line.kind !== "sinir" || line.amount === null) continue;
      expect(line.yenidenDegerlemeyeTabi, line.id).toBe(true);
      expect(line.verified.source, line.id).toContain("TABAN TUTAR");
      expect(line.nasilDogrulanir, line.id).toMatch(/yeniden değerleme|GÜNCEL/u);
    }
  });

  it("the statutory rates that were pulled are exactly the article text", () => {
    // 492 s.K. (1) sayılı tarife A/III-1-a: "(Binde 68,31)".
    const nispi = findTariffLine(2026, "karar-ilam-harci-nispi-orani")!;
    expect(nispi.rate).toBe(68.31);
    expect(nispi.verified.status).toBe("dogrulandi");
    expect(nispi.notes.join(" ")).toContain("binde 68,31");

    // Av.K. m.164/2: "Yüzde yirmibeşi aşmamak üzere … belli bir yüzdesi".
    const tavan = findTariffLine(2026, "avukatlik-nispi-ucret-tavani")!;
    expect(tavan.rate).toBe(0.25);
    expect(tavan.verified.status).toBe("dogrulandi");
    expect(tavan.notes.join(" ")).toContain("NİSPİ");
    expect(tavan.notes.join(" ")).toContain("maktu ücret bu sınıra tabi değildir");

    // HMK m.341/2 = 3.000 TL taban, m.362/1-a = 40.000 TL taban, İİK m.363/1 = 7.000 TL.
    expect(findTariffLine(2026, "hmk-istinaf-kesinlik")!.amount).toBe(3000);
    expect(findTariffLine(2026, "hmk-temyiz-kesinlik")!.amount).toBe(40000);
    expect(findTariffLine(2026, "iik-istinaf-kesinlik")!.amount).toBe(7000);
  });

  it("the peşin harç ratio is NOT claimed as verified (492 m.28 was not pulled)", () => {
    const pesin = findTariffLine(2026, "pesin-harc-orani")!;
    expect(pesin.verified.status).toBe("dogrulanmadi");
    expect(pesin.nasilDogrulanir).toContain("m.28/1-a");
  });

  it("findTariffLine returns undefined for unknown ids and years", () => {
    expect(findTariffLine(2026, "yok-boyle-kalem")).toBeUndefined();
    expect(findTariffLine(1999, "basvurma-harci-asliye")).toBeUndefined();
  });
});
