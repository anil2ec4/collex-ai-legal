import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * 27.09.2026: the calendar's empty state told the lawyer to add a hearing
 * "from the matter page's Süreler tab" — a form that did not exist, although
 * the API has accepted kind "hearing" since W14 B-17. The instruction and
 * the form must exist together.
 */
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");

it("the Süreler tab carries a hearing form that POSTs kind 'hearing' and a status control", () => {
  expect(html).toContain("function renderMatterHearings(panel)");
  expect(html).toContain("  function renderMatterDeadlines(panel) {\n    renderMatterHearings(panel);");
  expect(html).toContain('postMatterItem(d.matter.id, { kind: "hearing", payload: payload }');
  expect(html).toContain('[["planlandi", "Planlandı"], ["yapildi", "Yapıldı"], ["ertelendi", "Ertelendi"]]');
});

it("the calendar's instruction still points at a place that has the form", () => {
  expect(html).toContain("duruşma eklemek için dosya sayfasındaki Süreler sekmesini kullanın");
  expect(html).toContain('ghostBtn("Duruşma ekle"');
});
