import { expect, it } from "vitest";
import { selectSemanticPassages, type PassageGroup } from "../../src/research/semanticPassages.js";
import type { AnswerCandidate } from "../../src/answer/evidencePack.js";

const vector = (x: number, y: number) => [x, y, ...Array<number>(382).fill(0)];
const candidate = (n: number): AnswerCandidate => ({
  hitId: String(n), documentId: "d", documentVersionId: "v", chunkId: String(n),
  source: "BEDESTEN", sourceUrl: "", title: "", startChar: n * 10, endChar: n * 10 + 10,
  score: 0.6, stance: "contrary",
});
const candidates = [0, 1, 2, 3].map(candidate);
const group: PassageGroup = { text: "😀".repeat(40), candidates, fallback: candidates.slice(0, 2) };

it("selects later source spans without rewriting scores, stance or code-point offsets", async () => {
  const result = await selectSemanticPassages([group], "tanık", { async embed(texts) {
    expect(texts).toEqual(["query: tanık", ...Array(4).fill("passage: " + "😀".repeat(10))]);
    return [vector(1, 0), vector(0, 1), vector(0.2, 1), vector(1, 0.1), vector(1, 0)];
  } }, 1000);
  expect(result.applied).toBe(true);
  expect(result.candidates).toEqual(candidates.slice(2));
  expect(result.candidates[0]).toBe(candidates[2]);
});

it("keeps every document's quota including contrary evidence", async () => {
  const result = await selectSemanticPassages([group, { ...group, candidates: [candidate(4)], fallback: [candidate(4)] }], "q", {
    async embed(texts) { return texts.map(() => vector(1, 0)); },
  }, 1000);
  expect(result.candidates.map(c => c.chunkId)).toEqual(["0", "1", "4"]);
});

it.each([[], [vector(1, 0)], Array(5).fill([1]), Array(5).fill(vector(0, 0)), Array(5).fill(vector(NaN, 1))])(
  "preserves the exact lexical fallback on invalid vectors", async vectors => {
    const result = await selectSemanticPassages([group], "q", { async embed() { return vectors; } }, 1000);
    expect(result).toEqual({ candidates: group.fallback, applied: false, reason: "SEMANTIC_PASSAGES_UNAVAILABLE" });
  },
);

it("times out even when a provider ignores cancellation", async () => {
  const result = await selectSemanticPassages([group], "q", { embed: () => new Promise(() => {}) }, 5);
  expect(result.applied).toBe(false);
  expect(result.candidates).toEqual(group.fallback);
});

it("does not call a model after the budget is spent", async () => {
  let calls = 0;
  const result = await selectSemanticPassages([group], "q", { async embed() { calls++; return []; } }, 0);
  expect(calls).toBe(0);
  expect(result.candidates).toEqual(group.fallback);
});
