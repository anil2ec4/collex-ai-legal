/**
 * (g) Deterministic lexical entailment: paraphrase with a changed statute
 * number MUST fail (5237 vs 5271), while the number-correct variant passes.
 * Documented as a conservative floor — never a semantic judgement.
 */

import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../../src/answer/evidencePack.js";
import { LexicalEntailmentPort, extractNumbers, tokenize } from "../../src/llm/lexicalEntailment.js";
import { AS_OF, MapTextPort, standardTexts, tckCandidate } from "./fixtures.js";

async function tckEvidence() {
  const pack = await buildEvidencePack([tckCandidate()], new MapTextPort(standardTexts()), {
    asOf: AS_OF,
  });
  return pack.items[0]!.ref;
}

describe("LexicalEntailmentPort", () => {
  it("FAILS a paraphrase whose statute number was changed (5237 -> 5271)", async () => {
    const evidence = await tckEvidence();
    const port = new LexicalEntailmentPort();

    const wrongNumber = await port.assess(
      '5271 sayılı Türk Ceza Kanunu m. 81: kasten öldüren kişi müebbet hapis cezası ile cezalandırılır',
      evidence,
    );
    expect(wrongNumber.entails).toBe(false);
    expect(wrongNumber.score).toBeLessThanOrEqual(0.2);
    expect(wrongNumber.rationale).toContain("5271");

    const rightNumber = await port.assess(
      '5237 sayılı Türk Ceza Kanunu m. 81: kasten öldüren kişi müebbet hapis cezası ile cezalandırılır',
      evidence,
    );
    expect(rightNumber.entails).toBe(true);
    expect(rightNumber.score).toBeGreaterThanOrEqual(0.85);
    expect(rightNumber.score).toBeGreaterThan(wrongNumber.score);
  });

  it("scores low for claims whose content tokens are absent from the evidence", async () => {
    const evidence = await tckEvidence();
    const port = new LexicalEntailmentPort();
    const unrelated = await port.assess(
      "Kira sözleşmesinin feshi tazminat gerektirir",
      evidence,
    );
    expect(unrelated.entails).toBe(false);
    expect(unrelated.score).toBeLessThan(0.5);
  });

  it("empty/stopword-only claims never entail", async () => {
    const evidence = await tckEvidence();
    const port = new LexicalEntailmentPort();
    const empty = await port.assess("ve veya için", evidence);
    expect(empty.entails).toBe(false);
    expect(empty.score).toBe(0);
  });

  it("is documented and reported as a lexical floor, not semantics", async () => {
    const evidence = await tckEvidence();
    const judgement = await new LexicalEntailmentPort().assess("kasten öldüren kişi", evidence);
    expect(judgement.rationale).toContain("lexical-v0");
  });

  it("helper: extractNumbers normalizes leading zeros and compound refs", () => {
    const numbers = extractNumbers("E. 2023/45 tarih 2024-03-12");
    expect(numbers.has("2023/45")).toBe(true);
    expect(numbers.has("2023")).toBe(true);
    expect(numbers.has("45")).toBe(true);
    expect(numbers.has("3")).toBe(true); // "03" canonicalized
  });

  it("helper: tokenize lowercases with tr-TR and keeps docket tokens whole", () => {
    expect(tokenize("Kasten ÖLDÜRME")).toEqual(["kasten", "öldürme"]);
    expect(tokenize("E. 2023/45")).toContain("2023/45");
  });
});
