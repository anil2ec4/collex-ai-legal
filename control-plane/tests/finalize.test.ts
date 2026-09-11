import { describe, expect, it } from "vitest";
import type { ClaimDraft } from "../src/evidence/types.js";
import {
  canFinalize,
  claimVerdict,
  COVERAGE_THRESHOLD,
  CURRENTNESS_THRESHOLD,
  ENTAILMENT_THRESHOLD,
  VERDICTS,
} from "../src/verification/finalize.js";

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

function withConfidence(partial: Partial<ClaimDraft["confidence"]>): ClaimDraft {
  const base = claim();
  return { ...base, confidence: { ...base.confidence, ...partial } };
}

describe("canFinalize (brief 9.4 thresholds)", () => {
  it("finalizes when every material claim is supported and confident", () => {
    expect(canFinalize([claim(), claim({ claimId: "c2" })])).toBe(true);
  });

  it("refuses an EMPTY claim set — finalizability is a positive fact", () => {
    // `every()` over an empty set is true, so "does anything fail the policy?"
    // answers no. That is the wrong question: an answer with nothing in it is
    // not something a lawyer may rely on, and `finalizable: true` next to "we
    // could not answer this" reads as "ready to rely on". The rule lives in
    // the predicate so every layer gives the same answer.
    expect(canFinalize([])).toBe(false);
  });

  it("refuses a set in which every claim is immaterial", () => {
    expect(
      canFinalize([claim({ material: false, treatment: "unsupported", evidenceIds: [] })]),
    ).toBe(false);
  });

  it("ignores non-material claims when a material one carries the answer", () => {
    expect(
      canFinalize([
        claim(),
        claim({ claimId: "c2", material: false, treatment: "unsupported", evidenceIds: [] }),
      ]),
    ).toBe(true);
  });

  it("rejects an unsupported material claim", () => {
    expect(canFinalize([claim({ treatment: "unsupported" })])).toBe(false);
  });

  it("rejects a material claim with no evidence", () => {
    expect(canFinalize([claim({ evidenceIds: [] })])).toBe(false);
  });

  it("entailment threshold is exactly 0.85 (boundary passes, below fails)", () => {
    expect(ENTAILMENT_THRESHOLD).toBe(0.85);
    expect(canFinalize([withConfidence({ entailment: 0.85 })])).toBe(true);
    expect(canFinalize([withConfidence({ entailment: 0.8499 })])).toBe(false);
  });

  it("currentness threshold is exactly 0.90 (boundary passes, below fails)", () => {
    expect(CURRENTNESS_THRESHOLD).toBe(0.9);
    expect(canFinalize([withConfidence({ currentness: 0.9 })])).toBe(true);
    expect(canFinalize([withConfidence({ currentness: 0.8999 })])).toBe(false);
  });

  it("coverage threshold is exactly 0.90 (boundary passes, below fails)", () => {
    expect(COVERAGE_THRESHOLD).toBe(0.9);
    expect(canFinalize([withConfidence({ coverage: 0.9 })])).toBe(true);
    expect(canFinalize([withConfidence({ coverage: 0.8999 })])).toBe(false);
  });

  it("agrees with claimVerdict: a PARTIAL_SOURCE_COVERAGE claim never finalizes", () => {
    // The reachable case: a CONSOLIDATED claim citing several passages loses
    // one to the validator, so coverage drops below the floor. claimVerdict
    // reported PARTIAL_SOURCE_COVERAGE while canFinalize still said yes, and
    // the answer advertised `finalizable: true` under an overall QUALIFIED.
    const partial = withConfidence({ coverage: 0.5 });
    expect(claimVerdict(partial)).toBe("PARTIAL_SOURCE_COVERAGE");
    expect(canFinalize([partial])).toBe(false);
  });

  it("one failing material claim blocks finalization of the whole set", () => {
    expect(canFinalize([claim(), claim({ claimId: "bad", treatment: "unsupported" })])).toBe(
      false,
    );
  });
});

describe("claimVerdict", () => {
  it("covers the six verifier verdicts", () => {
    expect(VERDICTS).toEqual([
      "SUPPORTED",
      "QUALIFIED",
      "CONFLICTING_AUTHORITIES",
      "INSUFFICIENT_EVIDENCE",
      "OUT_OF_DATE_SOURCE",
      "PARTIAL_SOURCE_COVERAGE",
    ]);
  });

  it("SUPPORTED for a confident supported claim", () => {
    expect(claimVerdict(claim())).toBe("SUPPORTED");
  });

  it("INSUFFICIENT_EVIDENCE for unsupported treatment or missing evidence", () => {
    expect(claimVerdict(claim({ treatment: "unsupported" }))).toBe("INSUFFICIENT_EVIDENCE");
    expect(claimVerdict(claim({ evidenceIds: [] }))).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("CONFLICTING_AUTHORITIES for conflicted treatment", () => {
    expect(claimVerdict(claim({ treatment: "conflicted" }))).toBe("CONFLICTING_AUTHORITIES");
  });

  it("OUT_OF_DATE_SOURCE below the currentness threshold", () => {
    expect(claimVerdict(withConfidence({ currentness: 0.5 }))).toBe("OUT_OF_DATE_SOURCE");
  });

  it("PARTIAL_SOURCE_COVERAGE below the coverage threshold", () => {
    expect(claimVerdict(withConfidence({ coverage: 0.5 }))).toBe("PARTIAL_SOURCE_COVERAGE");
  });

  it("QUALIFIED for qualified treatment or weak entailment", () => {
    expect(claimVerdict(claim({ treatment: "qualified" }))).toBe("QUALIFIED");
    expect(claimVerdict(withConfidence({ entailment: 0.5 }))).toBe("QUALIFIED");
  });

  it("severity precedence: conflicted + stale source reports CONFLICTING_AUTHORITIES", () => {
    const c = claim({ treatment: "conflicted" });
    c.confidence.currentness = 0.1;
    expect(claimVerdict(c)).toBe("CONFLICTING_AUTHORITIES");
  });
});
