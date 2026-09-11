/**
 * LLM ports for the citation-first answer pipeline (brief section 9).
 *
 * Both ports are pure interfaces so the pipeline can run with:
 *  - deterministic offline implementations (ruleDrafter.ts,
 *    lexicalEntailment.ts) in tests and degraded mode; and
 *  - the live Anthropic adapter (anthropicAdapter.ts) in production.
 *
 * The drafter NEVER sees raw retrieval output — only the validated
 * EvidencePack — and may only reference evidence ids that exist in it
 * (citation-first structured generation, brief 9.1 layer 7).
 */

import type { ClaimDraft, EvidenceRef } from "../evidence/types.js";
import type { EvidencePack } from "../answer/evidencePack.js";

export interface DrafterInput {
  /** The user's legal question (already contract-clarified upstream). */
  question: string;
  /** Validated evidence; the ONLY material claims may be built from. */
  pack: EvidencePack;
}

/** Evidence -> ClaimDraft[] (citation-first: evidence ids chosen first). */
export interface DrafterPort {
  draftClaims(input: DrafterInput): Promise<ClaimDraft[]>;
}

export interface EntailmentJudgement {
  /** Does the passage actually support the claim (not merely relate to it)? */
  entails: boolean;
  /** Support score in [0,1]; compared against the finalization threshold. */
  score: number;
  /** Short machine/human-readable justification of the judgement. */
  rationale: string;
}

/** (claim, evidence) -> entailment judgement (brief 9.1 layer 9). */
export interface EntailmentPort {
  assess(claimText: string, evidence: EvidenceRef): Promise<EntailmentJudgement>;
  /**
   * Optional (W14 B-31): judge a claim against a SET of passages taken
   * together, i.e. "is every part of this claim carried by at least one of
   * these?" rather than "does any single one carry all of it".
   *
   * The verifier uses it for a claim that cites several passages and carries
   * no segment attribution, and ONLY when the claim text is known to be the
   * concatenation of those passages' quotes (the rule-based drafter). A
   * paraphrase judged over a union surface would be a lexical illusion, so a
   * cloud-drafted unsegmented claim keeps the conservative per-passage
   * aggregation instead. A port that does not implement it is judged exactly
   * as before.
   */
  assessSet?(
    claimText: string,
    evidence: readonly EvidenceRef[],
  ): Promise<EntailmentJudgement>;
}
