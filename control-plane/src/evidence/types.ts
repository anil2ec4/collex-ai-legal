/**
 * Evidence and claim contracts (Master Build Brief section 9.2).
 *
 * CANONICAL OFFSET POLICY (project-wide): `locator.startChar`/`locator.endChar`
 * are UNICODE CODE POINT indices into the NFC-normalized canonical document
 * text — NOT UTF-16 code units and NOT UTF-8 bytes. Python `str` slicing and
 * the database layer agree with this convention; JavaScript code MUST slice by
 * code points (see verification/validator.ts, codePointSlice). Cross-language
 * parity is enforced by control-plane/fixtures/offset_policy.json.
 */

export interface EvidenceRef {
  evidenceId: string;
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  source: string;
  sourceUrl: string;
  title: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
  locator: {
    article?: string;
    paragraph?: string;
    page?: number;
    /** Unicode code point offset (inclusive) into the NFC canonical text. */
    startChar: number;
    /** Unicode code point offset (exclusive) into the NFC canonical text. */
    endChar: number;
  };
  quote: string;
  /** SHA-256 hex over the UTF-8 bytes of `quote`. */
  quoteSha256: string;
  /** SHA-256 hex over the UTF-8 bytes of the full NFC canonical text. */
  contentSha256: string;
  retrievedAt: string;
}

/**
 * Which cited passage carries which PART of a claim (additive, W14 B-31).
 *
 * WHY. Until W14 a `ClaimDraft` said "this sentence rests on these three
 * passages" and nothing more, so the verifier could only ask each passage
 * whether it entailed the WHOLE claim. For a consolidated provision claim —
 * the rule-based drafter's normal output, one claim per (version, article)
 * carrying every fıkra of it — that is impossible by construction: fıkra 1
 * does not contain fıkra 2's words, and `max()` over the per-passage scores
 * asks whether SOME passage carries EVERYTHING. Measured 02.09.2026 (ARCH
 * §4.3): 0,633 and 0,563 against a 0,85 threshold, i.e. nine of twenty-one
 * answerable gold rows were unfinalizable for a mechanical reason.
 *
 * With segments the honest question can be asked instead: is every part of
 * the claim carried by the passages cited FOR THAT PART.
 */
export interface ClaimSegment {
  /** The part of the claim text this attribution covers. */
  text: string;
  /** Evidence ids that carry this part; must be a subset of the claim's. */
  evidenceIds: string[];
}

export interface ClaimDraft {
  claimId: string;
  text: string;
  material: boolean;
  evidenceIds: string[];
  /**
   * Optional attribution of parts of `text` to subsets of `evidenceIds`
   * (W14 B-31). The rule-based drafter fills it (one segment per quote); a
   * cloud drafter may. A claim without segments keeps the pre-W14
   * aggregation, and the answer says so.
   */
  segments?: ReadonlyArray<ClaimSegment>;
  treatment: "supported" | "qualified" | "conflicted" | "unsupported";
  confidence: {
    retrieval: number;
    entailment: number;
    authority: number;
    currentness: number;
    coverage: number;
  };
}
