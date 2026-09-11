import { describe, expect, it } from "vitest";
import { analyzeIntake } from "../../src/planner/intake.js";

const concepts = (question: string) => analyzeIntake({ question, jurisdiction: "TR", dataClass: "L0" }).issues.map((i) => i.concept);

describe("workday fact-pattern concepts", () => {
  it("prioritises the explicit research request while retaining the factual issues", () => {
    const found = concepts("İşçi kıdem tazminatı ve fazla çalışma ücreti istiyor. Fazla çalışmanın tanıkla ispatı yönünden Yargıtay kararlarını araştır.");
    expect(found[0]).toBe("fazla mesai");
    expect(found).toContain("kıdem tazminatı");
  });
  it("does not read an entitlement to compensation as an occupational accident", () => {
    expect(concepts("İş sözleşmesi feshedilen işçinin kıdem tazminatına hak kazandığını ileri sürüyoruz.")).not.toContain("iş kazası");
  });
  it("recognises the ordinary legal name fazla çalışma as overtime", () => {
    expect(concepts("Fazla çalışmanın tanıkla ispatı ve ücretlerinin ödenmesi nasıl olur?")).toContain("fazla mesai");
  });
  it.each(["iş kazasında", "iş kazaları", "iş kazası"])("keeps real accident inflections: %s", (term) => {
    expect(concepts(`${term} işverenin sorumluluğu nedir?`)).toContain("iş kazası");
  });
});
