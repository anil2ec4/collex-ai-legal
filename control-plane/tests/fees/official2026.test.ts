import { expect, it } from "vitest";
import { findTariffLine } from "../../src/fees/tariffs.js";
import { computeFees } from "../../src/fees/calc.js";

// Read from GİB's 98-series communiqué, tariff 1, PDF pages 2–3.
it.each([
  ["basvurma-harci-sulh", 335.2],
  ["basvurma-harci-asliye", 732],
  ["basvurma-harci-kanun-yolu", 1124.5],
  ["basvurma-harci-aym", 6024.1],
  ["karar-ilam-harci-nispi-asgari", 732],
  ["karar-ilam-harci-maktu", 732],
  ["vekalet-suret-harci", 104],
])("uses the published 2026 amount for %s without carrying it to other years", (id, amount) => {
  const line = findTariffLine(2026, String(id))!;
  expect(line.amount).toBe(amount);
  expect(line.verified.status).toBe("dogrulandi");
  expect(line.verified.source).toContain("492_Teblig98.pdf");
  expect(line.verified.date).toBe("2026-09-08");
  expect(findTariffLine(2027, String(id))).toBeUndefined();
});

it("uses the published application fee and minimum while keeping unknown expenses explicit", () => {
  const result = computeFees({ year: 2026, kind: "dava-harci", davaDegeri: 1000 });
  expect(result.steps.find((s) => s.id === "basvurma-harci")?.amount).toBe(732);
  expect(result.steps.find((s) => s.id === "karar-ilam-harci-asgari")?.amount).toBe(732);
  // A quarter of the floored karar harcı (183 TL) under-collects: the peşin
  // harç is a nispi harç and cannot go below the 732 TL floor either.
  expect(result.steps.find((s) => s.id === "pesin-harc")?.amount).toBe(732);
  expect(result.steps.find((s) => s.id === "pesin-harc")?.detail).toContain("alt sınır esas alındı");
  expect(result.toplam).toBeNull();
  expect(result.eksikKalemler).toEqual(["gider-avansi"]);
});

it("locates the advocate-certified copy fee in tariff D/I-c, not appeal fees A/IV", () => {
  expect(findTariffLine(2026, "vekalet-suret-harci")?.reference.article).toBe("(1) sayılı tarife D/I-c");
});

it("takes a quarter of the nispi harç once that quarter clears the floor", () => {
  // 1.000.000 TL × binde 68,31 = 68.310 TL; a quarter is 17.077,50 TL.
  const result = computeFees({ year: 2026, kind: "dava-harci", davaDegeri: 1_000_000 });
  expect(result.steps.find((s) => s.id === "karar-ilam-harci")?.amount).toBe(68310);
  expect(result.steps.find((s) => s.id === "pesin-harc")?.amount).toBe(17077.5);
});
