import { expect, it } from "vitest";
import { extractLegalQuestion } from "../../src/pipeline/questionIntent.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";

it("measures the explicit research request even in a short fact pattern", () => {
  const question = "İşçi İzmir'de çalıştı ve kıdem tazminatı istedi. Fazla çalışmanın tanıkla ispatı yönünden kararları araştır.";
  expect(extractLegalQuestion(question).legalQuestion).toBe("Fazla çalışmanın tanıkla ispatı yönünden kararları araştır.");
  expect(extractLegalQuestion(question).measuredOn).toBe("soru");
});

it("preserves explicit statutory constraints alongside the final request", () => {
  const question = "4857 sayılı Kanun m. 41 uygulanıyor. Fazla çalışmanın tanıkla ispatını araştır.";
  const result = extractLegalQuestion(question, parseReferences(question));
  expect(result.legalQuestion).toContain("4857");
  expect(result.legalQuestion).toContain("41");
});

it("does not narrow short narrative or an isolated command", () => {
  for (const question of ["İşçi İzmir'de çalıştı. Fazla çalışma ücreti istedi.", "Fazla çalışma kararlarını araştır."]) {
    expect(extractLegalQuestion(question).legalQuestion).toBe(question);
    expect(extractLegalQuestion(question).measuredOn).toBe("soru+olay");
  }
});
