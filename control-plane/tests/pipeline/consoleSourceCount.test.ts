import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
function summary(evidence: object[]): string {
  const start = html.indexOf("  function answerEvidenceSummary(");
  const end = html.indexOf("  /* W15 adım 25", start);
  if (start < 0) return evidence.length + " kaynak";
  return runInNewContext(html.slice(start, end) + "; answerEvidenceSummary(evidence)", { evidence });
}
it("counts passages from the same document once even across versions", () => {
  expect(summary([
    { documentId: "decision-a", documentVersionId: "v1" },
    { documentId: "decision-a", documentVersionId: "v2" },
    { documentId: "decision-b" },
  ])).toBe("2 belge · 3 alıntı");
  expect(html).toContain("answerEvidenceSummary(data.evidence || [])");
});
it("does not invent a document count for legacy passages without identity", () => {
  expect(summary([{ documentId: "decision-a" }, { documentId: "" }]))
    .toBe("2 alıntı · belge sayısı belirlenemedi");
});
it("keeps empty evidence distinct from unidentified evidence", () => {
  expect(summary([])).toBe("0 belge · 0 alıntı");
});
