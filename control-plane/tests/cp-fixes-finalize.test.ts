/**
 * Regression tests for lane C2 defect 7 [P2]: the finalization thresholds
 * FAILED OPEN on non-finite confidences.
 *
 * `NaN < 0.85` is false, so a claim carrying NaN entailment slipped through
 * `canFinalize` and was reported SUPPORTED. For a system whose entire purpose
 * is refusing to finalize unverified legal claims, a corrupt confidence must
 * fail CLOSED.
 */

import { describe, expect, it } from "vitest";
import type { ClaimDraft } from "../src/evidence/types.js";
import {
  canFinalize,
  claimVerdict,
  isValidConfidenceValue,
  type Verdict,
} from "../src/verification/finalize.js";

const CONFIDENCE_DIMENSIONS = [
  "retrieval",
  "entailment",
  "authority",
  "currentness",
  "coverage",
] as const;

/** Every value that must be treated as "below threshold", not "passes". */
const POISON_VALUES: Array<[string, number]> = [
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["-1", -1],
  ["1.5", 1.5],
];

function claim(overrides: Partial<ClaimDraft> = {}): ClaimDraft {
  return {
    claimId: "c1",
    text: "Test claim",
    material: true,
    evidenceIds: ["ev1"],
    treatment: "supported",
    confidence: {
      retrieval: 0.95,
      entailment: 0.95,
      authority: 0.9,
      currentness: 0.95,
      coverage: 0.95,
    },
    ...overrides,
  };
}

function poisoned(dimension: (typeof CONFIDENCE_DIMENSIONS)[number], value: number): ClaimDraft {
  const base = claim();
  return { ...base, confidence: { ...base.confidence, [dimension]: value } };
}

describe("defect 7: canFinalize fails closed on corrupt confidences", () => {
  for (const dimension of CONFIDENCE_DIMENSIONS) {
    for (const [label, value] of POISON_VALUES) {
      it(`refuses to finalize when confidence.${dimension} is ${label}`, () => {
        // Before the fix, NaN/Infinity on entailment or currentness passed the
        // `<` comparison and the claim was finalized.
        expect(canFinalize([poisoned(dimension, value)])).toBe(false);
      });
    }
  }

  it("a non-material claim with corrupt confidence is still ignored", () => {
    // Paired with a healthy MATERIAL claim on purpose: finalizability also
    // requires at least one material claim (verification/finalize.ts contract),
    // so a set holding nothing but this immaterial claim is refused for that
    // reason and would not test what this case is about.
    const c = poisoned("entailment", Number.NaN);
    expect(canFinalize([claim(), { ...c, claimId: "c2", material: false }])).toBe(true);
  });

  it("one poisoned claim blocks the whole set", () => {
    expect(canFinalize([claim(), poisoned("currentness", Number.NaN)])).toBe(false);
  });

  it("valid boundary values still finalize (0 <= x <= 1 with thresholds met)", () => {
    expect(canFinalize([claim()])).toBe(true);
    const base = claim();
    expect(
      canFinalize([
        {
          ...base,
          confidence: {
            // retrieval and authority are NOT thresholded — they rank and
            // label evidence, they do not decide whether a claim is carried —
            // so a valid 0 in those dimensions must not fail closed. The three
            // that ARE thresholded sit exactly on their floors.
            retrieval: 0,
            entailment: 0.85,
            authority: 0,
            currentness: 0.9,
            coverage: 0.9,
          },
        },
      ]),
    ).toBe(true);
    expect(
      canFinalize([
        {
          ...base,
          confidence: {
            retrieval: 1,
            entailment: 1,
            authority: 1,
            currentness: 1,
            coverage: 1,
          },
        },
      ]),
    ).toBe(true);
  });
});

describe("defect 7: claimVerdict never reports SUPPORTED on corrupt confidences", () => {
  const NON_FINALIZABLE: readonly Verdict[] = [
    "INSUFFICIENT_EVIDENCE",
    "CONFLICTING_AUTHORITIES",
    "OUT_OF_DATE_SOURCE",
    "PARTIAL_SOURCE_COVERAGE",
    "QUALIFIED",
  ];

  for (const dimension of CONFIDENCE_DIMENSIONS) {
    for (const [label, value] of POISON_VALUES) {
      it(`downgrades the verdict when confidence.${dimension} is ${label}`, () => {
        const verdict = claimVerdict(poisoned(dimension, value));
        expect(verdict).not.toBe("SUPPORTED");
        expect(NON_FINALIZABLE).toContain(verdict);
      });
    }
  }

  it("a fully valid confident claim is still SUPPORTED", () => {
    expect(claimVerdict(claim())).toBe("SUPPORTED");
  });
});

describe("isValidConfidenceValue", () => {
  it("accepts finite numbers in [0, 1]", () => {
    for (const v of [0, 0.5, 1]) expect(isValidConfidenceValue(v)).toBe(true);
  });

  it("rejects non-finite and out-of-range values", () => {
    for (const [, v] of POISON_VALUES) expect(isValidConfidenceValue(v)).toBe(false);
  });

  it("rejects non-numbers arriving from untyped JSON", () => {
    expect(isValidConfidenceValue("0.9" as unknown as number)).toBe(false);
    expect(isValidConfidenceValue(null as unknown as number)).toBe(false);
    expect(isValidConfidenceValue(undefined as unknown as number)).toBe(false);
  });
});
