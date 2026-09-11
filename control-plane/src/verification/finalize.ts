/**
 * Finalization policy (Master Build Brief section 9.4).
 *
 * The thresholds are the brief's starting policy; they must be calibrated
 * against the gold set before release and are exported as named constants so
 * eval tooling can reference the exact values in force.
 */

import type { ClaimDraft } from "../evidence/types.js";

export const ENTAILMENT_THRESHOLD = 0.85;
export const CURRENTNESS_THRESHOLD = 0.9;
/** Initial coverage floor below which a claim is reported as partial-coverage. */
export const COVERAGE_THRESHOLD = 0.9;

export const VERDICTS = [
  "SUPPORTED",
  "QUALIFIED",
  "CONFLICTING_AUTHORITIES",
  "INSUFFICIENT_EVIDENCE",
  "OUT_OF_DATE_SOURCE",
  "PARTIAL_SOURCE_COVERAGE",
] as const;

export type Verdict = (typeof VERDICTS)[number];

/**
 * THRESHOLDS FAIL CLOSED.
 *
 * A raw `value < THRESHOLD` comparison silently passes NaN (`NaN < 0.85` is
 * false), and nothing stops a corrupt or hostile upstream from handing us
 * Infinity or 1.5. For a system whose purpose is REFUSING to finalize
 * unverified legal claims, an unusable confidence must behave exactly like a
 * confidence below the threshold — never like one above it.
 *
 * A usable confidence is a finite number in [0, 1].
 */
export function isValidConfidenceValue(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** True only when the value is usable AND at or above the threshold. */
function meetsThreshold(value: number, threshold: number): boolean {
  return isValidConfidenceValue(value) && value >= threshold;
}

/** Every confidence dimension of the claim is a usable probability. */
export function hasUsableConfidence(claim: ClaimDraft): boolean {
  const c = claim.confidence;
  return (
    isValidConfidenceValue(c.retrieval) &&
    isValidConfidenceValue(c.entailment) &&
    isValidConfidenceValue(c.authority) &&
    isValidConfidenceValue(c.currentness) &&
    isValidConfidenceValue(c.coverage)
  );
}

/**
 * THE FINALIZABILITY CONTRACT (one definition, for every layer).
 *
 * `canFinalize(claims)` answers ONE question about a whole answer: "is there
 * something here a lawyer may rely on as it stands?" It is true when BOTH
 * halves hold.
 *
 *  1. NON-VACUITY (positive fact). At least one claim is `material: true`.
 *     An empty claim set, and a set in which every claim is immaterial, are
 *     NOT finalizable — even though nothing in them fails a threshold.
 *     `every()` over an empty set is true, and that is the correct reading of
 *     "does anything fail?" and the wrong reading of "may this be relied on":
 *     `finalizable: true` printed next to "we could not answer this" reads to
 *     an operator as "ready to rely on". This rule used to live one layer up
 *     in answer/verifier.ts, which meant the two layers gave different answers
 *     to the same question and a caller reaching the predicate directly got
 *     the wrong one. It lives here now; the verifier just calls this.
 *
 *  2. POLICY (brief 9.4), applied to every MATERIAL claim — immaterial claims
 *     are skipped entirely, they carry no weight either way:
 *       - it is not `unsupported` and cites at least one evidence ref;
 *       - every confidence dimension is a usable probability (fail closed —
 *         see isValidConfidenceValue);
 *       - entailment  >= ENTAILMENT_THRESHOLD;
 *       - currentness >= CURRENTNESS_THRESHOLD;
 *       - coverage    >= COVERAGE_THRESHOLD.
 *
 * Coverage is checked here for the same reason `claimVerdict` checks it: a
 * claim that lost a citation to validation is reported PARTIAL_SOURCE_COVERAGE,
 * which is not a verdict anyone may finalize on. Leaving it out let an answer
 * whose overall status was QUALIFIED still advertise `finalizable: true`.
 * `retrieval` and `authority` are deliberately NOT thresholded: they rank and
 * label evidence, they do not decide whether a claim is carried.
 *
 * Currentness of a claim that rests ONLY on uploaded documents is the
 * NEUTRAL score (answer/evidencePack.ts :: CURRENTNESS_NEUTRAL_SCORE): the
 * lawyer's own file has no yürürlük to assess, so this threshold is never
 * the reason such a claim fails — the verifier marks the claim
 * `currentnessApplicable: false` and the answer UPLOAD_ONLY_EVIDENCE instead.
 * A claim citing any corpus passage is measured over the corpus passages
 * alone, so the strict rule still applies to the law in a mixed answer.
 *
 * A `false` here does not discard the answer: the run may still return a typed
 * `partial` report separating supported and unsupported/conflicted parts.
 */
export function canFinalize(claims: ClaimDraft[]): boolean {
  if (!claims.some((claim) => claim.material)) return false;
  return claims.every((claim) => {
    if (!claim.material) return true;
    if (claim.treatment === "unsupported") return false;
    if (claim.evidenceIds.length === 0) return false;
    // A corrupt score anywhere means the claim's confidence cannot be trusted.
    if (!hasUsableConfidence(claim)) return false;
    if (!meetsThreshold(claim.confidence.entailment, ENTAILMENT_THRESHOLD)) return false;
    if (!meetsThreshold(claim.confidence.currentness, CURRENTNESS_THRESHOLD)) return false;
    if (!meetsThreshold(claim.confidence.coverage, COVERAGE_THRESHOLD)) return false;
    return true;
  });
}

/**
 * Per-claim verifier verdict. Precedence (most severe wins):
 * INSUFFICIENT_EVIDENCE > CONFLICTING_AUTHORITIES > OUT_OF_DATE_SOURCE >
 * PARTIAL_SOURCE_COVERAGE > QUALIFIED > SUPPORTED.
 *
 * A claim whose confidence vector is not usable is reported as
 * INSUFFICIENT_EVIDENCE: we cannot vouch for evidence we cannot score.
 */
export function claimVerdict(claim: ClaimDraft): Verdict {
  if (
    claim.treatment === "unsupported" ||
    claim.evidenceIds.length === 0 ||
    !hasUsableConfidence(claim)
  ) {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (claim.treatment === "conflicted") {
    return "CONFLICTING_AUTHORITIES";
  }
  if (!meetsThreshold(claim.confidence.currentness, CURRENTNESS_THRESHOLD)) {
    return "OUT_OF_DATE_SOURCE";
  }
  if (!meetsThreshold(claim.confidence.coverage, COVERAGE_THRESHOLD)) {
    return "PARTIAL_SOURCE_COVERAGE";
  }
  if (
    claim.treatment === "qualified" ||
    !meetsThreshold(claim.confidence.entailment, ENTAILMENT_THRESHOLD)
  ) {
    return "QUALIFIED";
  }
  return "SUPPORTED";
}
