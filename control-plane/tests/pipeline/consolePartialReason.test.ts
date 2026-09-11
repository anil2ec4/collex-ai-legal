import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
function parts(data: object): string[] {
  const start = html.indexOf("  var STATUS_TR =");
  const end = html.indexOf("  /* W15 adım 25", start);
  return runInNewContext(html.slice(start, end) +
    '; typeof answerStatusParts === "function" ? answerStatusParts(data) : STATUS_TR[data.status]', { data });
}
it("does not invent unbound claims when no claims exist", () => {
  const text = parts({ status: "PARTIAL", claims: [] }).slice(3).join(" ");
  expect(text).not.toContain("Bazı tespitler");
  expect(text).toContain("cevap üretilemedi");
});
it("explains a budget limit without saying supported claims lack quotations", () => {
  const text = parts({ status: "PARTIAL", claims: [{ verdict: "SUPPORTED" }], reasons: ["BUDGET_EXHAUSTED:maxFetches"] }).slice(3).join(" ");
  expect(text).toContain("araştırma sınırına");
  expect(text).not.toContain("bağlanamadı");
});
it("still warns when a claim really lacks support", () => {
  expect(parts({ status: "PARTIAL", claims: [{ verdict: "INSUFFICIENT_EVIDENCE" }] })[3]).toContain("bağlanamadı");
});
