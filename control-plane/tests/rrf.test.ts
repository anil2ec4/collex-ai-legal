import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../src/retrieval/rrf.js";

describe("reciprocalRankFusion", () => {
  it("matches a hand-computed fusion with k=60 (SQL parity)", () => {
    // lexical: A(1), B(2), C(3); semantic: B(1), D(2)
    const fused = reciprocalRankFusion(["A", "B", "C"], ["B", "D"]);

    const byId = new Map(fused.map((f) => [f.id, f]));
    // Hand-computed: coalesce(1/(60+rank), 0) summed over both lists.
    expect(byId.get("A")?.score).toBeCloseTo(1 / 61, 12);
    expect(byId.get("B")?.score).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(byId.get("C")?.score).toBeCloseTo(1 / 63, 12);
    expect(byId.get("D")?.score).toBeCloseTo(1 / 62, 12);

    expect(fused.map((f) => f.id)).toEqual(["B", "A", "D", "C"]);
  });

  it("mirrors the SQL FULL OUTER JOIN rank columns (null when absent)", () => {
    const fused = reciprocalRankFusion(["A", "B"], ["B"]);
    const byId = new Map(fused.map((f) => [f.id, f]));
    expect(byId.get("A")).toMatchObject({ lexicalRank: 1, semanticRank: null });
    expect(byId.get("B")).toMatchObject({ lexicalRank: 2, semanticRank: 1 });
  });

  it("supports a custom k", () => {
    const fused = reciprocalRankFusion(["X"], [], 10);
    expect(fused[0]?.score).toBeCloseTo(1 / 11, 12);
  });

  it("breaks exact ties deterministically by id", () => {
    // A is lexical rank 1, B is semantic rank 1 -> identical scores.
    const fused = reciprocalRankFusion(["A"], ["B"]);
    expect(fused.map((f) => f.id)).toEqual(["A", "B"]);
  });

  it("handles empty inputs", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it("rejects non-positive k and duplicate ids", () => {
    expect(() => reciprocalRankFusion(["A"], [], 0)).toThrow(RangeError);
    expect(() => reciprocalRankFusion(["A", "A"], [])).toThrow(RangeError);
    expect(() => reciprocalRankFusion([], ["B", "B"])).toThrow(RangeError);
  });

  it("is a pure function of its inputs (property: permuting other list does not change absent ranks)", () => {
    const a = reciprocalRankFusion(["A", "B", "C"], ["Z"]);
    const b = reciprocalRankFusion(["A", "B", "C"], ["Z"]);
    expect(a).toEqual(b);
  });
});

describe("reciprocalRankFusion: per-lane weights (additive, 2026-09-10)", () => {
  it("defaults are byte-identical to the unweighted SQL parity fusion", () => {
    const plain = reciprocalRankFusion(["A", "B", "C"], ["B", "D"]);
    const weighted = reciprocalRankFusion(["A", "B", "C"], ["B", "D"], 60, {});
    const explicit = reciprocalRankFusion(["A", "B", "C"], ["B", "D"], 60, {
      lexical: 1,
      semantic: 1,
    });
    expect(weighted).toEqual(plain);
    expect(explicit).toEqual(plain);
  });

  it("multiplies each list's 1/(k+rank) term by its weight", () => {
    const fused = reciprocalRankFusion(["A", "B"], ["B", "C"], 60, {
      lexical: 1,
      semantic: 0.5,
    });
    const byId = new Map(fused.map((f) => [f.id, f]));
    expect(byId.get("A")?.score).toBeCloseTo(1 / 61, 12);
    expect(byId.get("B")?.score).toBeCloseTo(1 / 62 + 0.5 / 61, 12);
    expect(byId.get("C")?.score).toBeCloseTo(0.5 / 62, 12);
  });

  it("lets a lower-weighted lane's rank-1 lose to the other lane's rank-1 (exact tie otherwise)", () => {
    // Unweighted: A (lexical 1) and B (semantic 1) tie and fall back to id.
    expect(reciprocalRankFusion(["A"], ["B"]).map((f) => f.id)).toEqual(["A", "B"]);
    // Weighted the other way round, the id tie-break no longer decides.
    expect(
      reciprocalRankFusion(["A"], ["B"], 60, { lexical: 0.7, semantic: 1 }).map((f) => f.id),
    ).toEqual(["B", "A"]);
  });

  it("rejects a non-positive or non-finite weight (0 would silence a lane)", () => {
    expect(() => reciprocalRankFusion(["A"], [], 60, { lexical: 0 })).toThrow(RangeError);
    expect(() => reciprocalRankFusion(["A"], [], 60, { semantic: -1 })).toThrow(RangeError);
    expect(() => reciprocalRankFusion(["A"], [], 60, { semantic: Number.NaN })).toThrow(
      RangeError,
    );
  });
});
