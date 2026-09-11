/**
 * Full verification pass (brief 9.1 layers 8–11):
 *
 *   deterministic validateEvidence on EVERY citation
 *     -> entailment port on every (claim, valid evidence) pair
 *     -> aggregate per-claim confidence {retrieval, entailment, authority,
 *        currentness, coverage}
 *     -> conflict detection against contrary-stance evidence
 *     -> canFinalize (verification/finalize.ts), which owns the whole
 *        finalizability contract including the non-vacuity rule: a document
 *        with no material claim is never finalizable
 *     -> per-claim verdict (existing Verdict enum) + overall status
 *        COMPLETE / QUALIFIED / PARTIAL / ABSTAIN with machine reasons.
 *
 * The verifier never trusts drafter output: treatments are recomputed where
 * evidence fails, confidences are recomputed from validated evidence only,
 * and a claim with zero valid citations is always downgraded to unsupported.
 */

import type { ClaimDraft } from "../evidence/types.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import { validateEvidence } from "../verification/validator.js";
import {
  ENTAILMENT_THRESHOLD,
  canFinalize,
  claimVerdict,
  isValidConfidenceValue,
  type Verdict,
} from "../verification/finalize.js";
import {
  evidenceSurfaceOf,
  matchedClaimTokens,
  tokenize,
} from "../llm/lexicalEntailment.js";
import type { EntailmentPort, EntailmentJudgement } from "../llm/ports.js";
import type { EvidenceItem, EvidencePack } from "./evidencePack.js";
import type { QuestionCoverageReport } from "./coverage.js";

/**
 * How `confidence.entailment` was aggregated for a claim (additive, W14 B-31).
 *
 *   segments   min over the claim's own segments, each judged against the
 *              passages cited FOR that segment — the honest question;
 *   set        the claim cites several passages, carries no segments, and its
 *              text is provably the concatenation of those passages' quotes
 *              (rule-based drafter): judged over the union surface;
 *   max        the pre-W14 aggregation — the largest per-passage score. Kept
 *              for a single-passage claim (where it is exact) and for an
 *              unsegmented CLOUD claim, where a union score would be a
 *              lexical illusion over a paraphrase;
 *   none       no validated citation to judge.
 */
export type EntailmentAggregation = "segments" | "set" | "max" | "none";

/**
 * Additive (W14 B-31): a claim written by a cloud drafter that cites several
 * passages without saying which carries which part. It keeps the conservative
 * `max` aggregation and this reason makes the gap visible instead of silent.
 */
export const ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM = "ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM";

/**
 * Additive (W14 B-09): the question asked which text applied on a date and the
 * answer does not put two versions of the provision side by side. Such an
 * answer can never be COMPLETE — the reader asked a comparison question and
 * did not get a comparison.
 */
export const TEMPORAL_COMPARISON_MISSING = "TEMPORAL_COMPARISON_MISSING";

export interface CitationCheck {
  evidenceId: string;
  ok: boolean;
  /** Validator failure reason or a pack-level reason when not ok. */
  reason?: string;
}

export interface EvidenceEntailment {
  evidenceId: string;
  judgement: EntailmentJudgement;
}

export interface VerifiedClaim {
  claim: ClaimDraft;
  verdict: Verdict;
  citationChecks: CitationCheck[];
  entailments: EvidenceEntailment[];
  /** Validated contrary-stance evidence linked to this claim. */
  contraryEvidenceIds: string[];
  reasons: string[];
  /**
   * Additive (W12-B2). False when EVERY validated supporting passage of this
   * claim is an uploaded document (currentness NOT_APPLICABLE): the
   * `confidence.currentness` axis then holds the neutral score and must be
   * rendered as "yüklediğiniz belge — yürürlük değerlendirilemez", not as a
   * percentage. True for a claim resting on at least one corpus/live passage
   * (the strict yürürlük rule applied to it) and for a claim with no valid
   * supporting evidence at all (nothing to exempt).
   */
  currentnessApplicable: boolean;
  /**
   * Additive (W14 B-31): how `confidence.entailment` was aggregated. A reader
   * must be able to tell "one passage carries the whole sentence" from "each
   * part is carried by its own passage".
   */
  entailmentAggregation: EntailmentAggregation;
  /**
   * Additive (W14 B-31): false when the entailment axis measures nothing for
   * this claim because the claim text IS the quotes (rule-based generation) —
   * the axis is then a tautology and must be shown as
   * "— (kural tabanlı üretimde ölçülmez)", never as a percentage. True when a
   * cloud judge scored a paraphrase, i.e. when the number means something.
   */
  entailmentMeasured: boolean;
}

export type AnswerStatus = "COMPLETE" | "QUALIFIED" | "PARTIAL" | "ABSTAIN";

/**
 * Overall reason (additive, W12-B2): every evidenced claim of this answer
 * rests ONLY on uploaded documents. The answer may still be finalizable —
 * currentness did not gate it — but the reader must be told that it rests on
 * their own file, not on law, and that the file's accuracy and currentness
 * were not checked (renderer: UPLOAD_ONLY_EVIDENCE_TEXT).
 */
export const UPLOAD_ONLY_EVIDENCE = "UPLOAD_ONLY_EVIDENCE";

export interface AnswerDocument {
  question: string;
  asOf: string;
  status: AnswerStatus;
  finalizable: boolean;
  reasons: string[];
  claims: VerifiedClaim[];
  pack: EvidencePack;
  verifiedAt: string;
  /**
   * Additive (W12): the question-coverage gate's report — how much of the
   * question the retrieved passages covered, whether the gate passed, was
   * bypassed by an explicit reference, or set the passages aside.
   */
  coverage?: QuestionCoverageReport;
}

export interface VerifyOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => string;
  /**
   * The coverage gate's report (answer/coverage.ts). When the gate FAILED and
   * set retrieved passages aside, an empty pack means QUESTION_NOT_COVERED —
   * "we found passages that share words with your question, none of which
   * answers it" — which is a different statement from NO_EVIDENCE.
   */
  coverage?: QuestionCoverageReport;
  /**
   * Minimum normalized token overlap between a claim and a contrary passage
   * for the two to be treated as addressing the same issue.
   */
  conflictOverlapFloor?: number;
  /**
   * Which drafter produced these claims (additive, W14 B-31). "rule-based"
   * (the default, and what the pipeline runs unless the request opted into
   * the cloud lane) means an unsegmented multi-passage claim's text IS the
   * concatenation of its quotes, so the union aggregation is exact for it.
   * "cloud" means it may be a paraphrase, and the conservative pre-W14
   * aggregation is kept.
   */
  drafter?: "rule-based" | "cloud";
  /**
   * The temporal contract (additive, W14 B-09). `applicable` is true when the
   * question asked which text applied on a date (an explicit as-of, or a
   * temporal phrasing); `comparisonPresent` is true when the evidence actually
   * carries more than one version of one document. Applicable without a
   * comparison forbids COMPLETE and records TEMPORAL_COMPARISON_MISSING.
   */
  temporal?: { applicable: boolean; comparisonPresent: boolean };
}

/** Look up a pack item and deterministically validate it against its text. */
function checkCitation(pack: EvidencePack, evidenceId: string): CitationCheck {
  const item = pack.items.find((i) => i.ref.evidenceId === evidenceId);
  if (item === undefined) {
    return { evidenceId, ok: false, reason: "EVIDENCE_NOT_IN_PACK" };
  }
  const text: string | undefined = pack.texts[item.ref.documentVersionId];
  if (text === undefined) {
    return { evidenceId, ok: false, reason: "CANONICAL_TEXT_UNAVAILABLE" };
  }
  const result = validateEvidence(item.ref, text);
  return result.ok
    ? { evidenceId, ok: true }
    : { evidenceId, ok: false, reason: result.reason };
}

/**
 * LEGAL-REFERENCE tokens of a text: legislation numbers, article numbers and
 * E./K. numbers as the reference parser classifies them (W14 B-31).
 *
 * It used to be every digit run in the claim (`extractNumbers`), which linked
 * a claim to a "contrary" passage on any shared year or amount: measured
 * 02.09.2026, TCK m.168 (etkin pişmanlık) was declared to conflict with a
 * kapora decision because both mentioned the same year, and two separable
 * decisions were polarised into supporting/opposing. A shared "2019" is not a
 * shared issue; a shared m.157 is.
 */
function referenceTokens(text: string): Set<string> {
  const out = new Set<string>();
  const parsed = parseReferences(text);
  parsed.forEach((reference, index) => {
    if (reference.legislationNo !== undefined && reference.articleNo !== undefined) {
      out.add(`k:${reference.legislationNo}/m:${reference.articleNo}`);
    }
    if (reference.docketNo !== undefined && reference.decisionNo !== undefined) {
      out.add(`e:${reference.docketNo}/k:${reference.decisionNo}`);
    }
    // The parser emits "TCK m. 157" as a legislation reference IMMEDIATELY
    // followed by an article reference; pair only that adjacency. Pairing
    // every law with every article number found anywhere in the passage would
    // invent a citation the text never made — measured: it linked four
    // unrelated live-research claims to the same three contrary passages.
    if (reference.kind !== "legislation" || reference.legislationNo === undefined) return;
    for (let next = index + 1; next < parsed.length; next += 1) {
      const candidate = parsed[next] as (typeof parsed)[number];
      if (candidate.kind !== "article" || candidate.articleNo === undefined) break;
      out.add(`k:${reference.legislationNo}/m:${candidate.articleNo}`);
    }
  });
  return out;
}

/**
 * The same tokens for a contrary passage: the references its QUOTE makes,
 * plus the provision it IS (legislation + article from metadata).
 *
 * Deliberately NOT its own E./K.: that identifies the DOCUMENT, not the issue,
 * and every other chunk of the same decision would then "conflict" with a
 * claim built from it. Measured 02.09.2026: adding it linked four live-research
 * claims to three passages of the very decision they were drafted from. A
 * decision number cited INSIDE the quote still counts — that is the passage
 * talking about another decision, which is a real issue link.
 */
function evidenceReferenceTokens(item: EvidenceItem): Set<string> {
  const out = referenceTokens(item.ref.quote);
  if (item.ref.legislationNo !== undefined && item.ref.locator.article !== undefined) {
    out.add(`k:${item.ref.legislationNo}/m:${item.ref.locator.article}`);
  }
  return out;
}

/**
 * Deterministic "same issue" heuristic for conflict linking: a shared LEGAL
 * REFERENCE, or sufficient lexical overlap with the claim text.
 */
function addressesSameIssue(
  claimText: string,
  contrary: EvidenceItem,
  overlapFloor: number,
): boolean {
  const claimReferences = referenceTokens(claimText);
  const contraryReferences = evidenceReferenceTokens(contrary);
  for (const token of claimReferences) {
    if (contraryReferences.has(token)) return true;
  }
  const claimTokens = new Set(tokenize(claimText));
  if (claimTokens.size === 0) return false;
  const contraryTokens = new Set(tokenize(contrary.ref.quote));
  let shared = 0;
  for (const t of claimTokens) if (contraryTokens.has(t)) shared += 1;
  return shared / claimTokens.size >= overlapFloor;
}

/**
 * Aggregate `confidence.entailment` for one claim (W14 B-31, ARCH §4.3).
 *
 * `max()` over per-passage scores asks "does SOME passage carry EVERYTHING",
 * which for a conjunctive claim is strictly harder than the honest question
 * and, for a consolidated provision claim, impossible by construction. The
 * honest question is asked here instead — and no gate value moves:
 * ENTAILMENT_THRESHOLD stays 0.85.
 */
async function aggregateEntailment(
  draft: ClaimDraft,
  validItems: readonly EvidenceItem[],
  perItem: readonly EvidenceEntailment[],
  port: EntailmentPort,
  drafter: "rule-based" | "cloud",
): Promise<{
  score: number;
  aggregation: EntailmentAggregation;
  reasons: string[];
  unusedEvidenceIds: string[];
}> {
  const reasons: string[] = [];
  const byId = new Map(validItems.map((item) => [item.ref.evidenceId, item]));
  const max = (values: number[]): number =>
    values.length === 0 ? 0 : Math.max(...values);
  const maxScore = max(perItem.map((entry) => entry.judgement.score));

  if (validItems.length === 0) {
    return { score: 0, aggregation: "none", reasons, unusedEvidenceIds: [] };
  }
  if (validItems.length === 1) {
    return { score: maxScore, aggregation: "max", reasons, unusedEvidenceIds: [] };
  }

  // --- segments: every part judged against the passages cited for it -------
  const segments = draft.segments ?? [];
  const usable =
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment.evidenceIds.length > 0 &&
        segment.evidenceIds.every((id) => byId.has(id)),
    );
  if (usable) {
    const scores: number[] = [];
    for (const segment of segments) {
      const refs = segment.evidenceIds.map(
        (id) => (byId.get(id) as EvidenceItem).ref,
      );
      if (refs.length === 1) {
        const judgement = await port.assess(segment.text, refs[0] as (typeof refs)[number]);
        scores.push(judgement.score);
      } else if (port.assessSet !== undefined) {
        const judgement = await port.assessSet(segment.text, refs);
        scores.push(judgement.score);
      } else {
        const partial: number[] = [];
        for (const ref of refs) partial.push((await port.assess(segment.text, ref)).score);
        scores.push(max(partial));
      }
    }
    // ANTI-PADDING: a validated citation no segment claims carries nothing.
    const cited = new Set(segments.flatMap((segment) => segment.evidenceIds));
    const unusedEvidenceIds = validItems
      .map((item) => item.ref.evidenceId)
      .filter((id) => !cited.has(id));
    for (const id of unusedEvidenceIds) {
      reasons.push(`UNUSED_CITATION:${draft.claimId}:${id}`);
    }
    return {
      score: scores.length === 0 ? 0 : Math.min(...scores),
      aggregation: "segments",
      reasons,
      unusedEvidenceIds,
    };
  }

  // --- unsegmented, several passages --------------------------------------
  if (drafter === "cloud" || port.assessSet === undefined) {
    if (drafter === "cloud") {
      reasons.push(`${ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM}:${draft.claimId}`);
    }
    return { score: maxScore, aggregation: "max", reasons, unusedEvidenceIds: [] };
  }

  const judgement = await port.assessSet(
    draft.text,
    validItems.map((item) => item.ref),
  );
  // ANTI-PADDING over the union: a citation whose matched tokens are all
  // already matched by the others contributed nothing but its own presence.
  const matchedByItem = validItems.map((item) => ({
    id: item.ref.evidenceId,
    tokens: matchedClaimTokens(draft.text, evidenceSurfaceOf(item.ref)),
  }));
  const unusedEvidenceIds: string[] = [];
  for (const entry of matchedByItem) {
    const others = new Set<string>();
    for (const other of matchedByItem) {
      if (other.id === entry.id) continue;
      for (const token of other.tokens) others.add(token);
    }
    const contributes = [...entry.tokens].some((token) => !others.has(token));
    if (!contributes) {
      unusedEvidenceIds.push(entry.id);
      reasons.push(`UNUSED_CITATION:${draft.claimId}:${entry.id}`);
    }
  }
  return { score: judgement.score, aggregation: "set", reasons, unusedEvidenceIds };
}

export async function verifyAnswer(
  question: string,
  pack: EvidencePack,
  drafts: readonly ClaimDraft[],
  entailmentPort: EntailmentPort,
  options: VerifyOptions = {},
): Promise<AnswerDocument> {
  const now = options.now ?? (() => new Date().toISOString());
  const overlapFloor = options.conflictOverlapFloor ?? 0.25;
  const drafterKind = options.drafter ?? "rule-based";

  // Contrary evidence must itself survive deterministic validation before it
  // may qualify anything (an unverifiable "conflict" is not a conflict).
  const validContrary = pack.items.filter(
    (item) =>
      item.stance === "contrary" && checkCitation(pack, item.ref.evidenceId).ok,
  );

  const verified: VerifiedClaim[] = [];
  const overallReasons: string[] = [];
  // Claims with >= 1 validated supporting passage, and how many of those rest
  // only on uploads — the pair that decides UPLOAD_ONLY_EVIDENCE below.
  let evidencedClaims = 0;
  let uploadOnlyClaims = 0;

  for (const draft of drafts) {
    const reasons: string[] = [];
    const citationChecks = draft.evidenceIds.map((id) => checkCitation(pack, id));
    for (const check of citationChecks) {
      if (!check.ok) {
        reasons.push(
          `CITATION_INVALID:${draft.claimId}:${check.evidenceId}:${check.reason ?? "UNKNOWN"}`,
        );
      }
    }

    const validItems: EvidenceItem[] = [];
    for (const check of citationChecks) {
      if (!check.ok) continue;
      const item = pack.items.find((i) => i.ref.evidenceId === check.evidenceId);
      if (item !== undefined) validItems.push(item);
    }

    // Entailment on every (claim, valid evidence) pair.
    const entailments: EvidenceEntailment[] = [];
    for (const item of validItems) {
      const judgement = await entailmentPort.assess(draft.text, item.ref);
      entailments.push({ evidenceId: item.ref.evidenceId, judgement });
    }

    // Conflict detection: validated contrary evidence addressing this issue.
    const contraryEvidenceIds = validContrary
      .filter((item) => addressesSameIssue(draft.text, item, overlapFloor))
      .map((item) => item.ref.evidenceId);

    const supportingValid = validItems.filter((item) => item.stance !== "contrary");
    const max = (values: number[]): number => (values.length === 0 ? 0 : Math.max(...values));

    // Entailment aggregation (W14 B-31). Per-passage judgements above stay
    // exactly as they were — they are the reader's audit trail — and only the
    // single number the finalization threshold reads is computed honestly.
    const aggregate = await aggregateEntailment(
      draft,
      validItems,
      entailments,
      entailmentPort,
      drafterKind,
    );
    reasons.push(...aggregate.reasons);

    // Currentness (W12-B2): an uploaded passage is NOT_APPLICABLE and carries
    // the neutral score. It must never MASK a stale corpus passage cited by
    // the same claim, so the axis is measured over the passages that have a
    // yürürlük to assess whenever there are any (the strict rule for the
    // corpus part of a mixed answer), and falls back to the neutral score
    // only for a claim resting on uploads alone.
    const currentnessBearing = supportingValid.filter(
      (item) => item.currentness.status !== "NOT_APPLICABLE",
    );
    const currentnessApplicable = supportingValid.length === 0 || currentnessBearing.length > 0;
    if (supportingValid.length > 0) {
      evidencedClaims += 1;
      if (!currentnessApplicable) uploadOnlyClaims += 1;
    }

    const confidence = {
      retrieval: max(supportingValid.map((i) => i.retrievalScore)),
      entailment: aggregate.score,
      authority: max(supportingValid.map((i) => i.authority.score)),
      currentness: max(
        (currentnessBearing.length > 0 ? currentnessBearing : supportingValid).map(
          (i) => i.currentness.score,
        ),
      ),
      coverage:
        draft.evidenceIds.length === 0
          ? 0
          : validItems.length / draft.evidenceIds.length,
    };

    let treatment: ClaimDraft["treatment"];
    if (supportingValid.length === 0) {
      treatment = "unsupported";
      reasons.push(`CLAIM_UNSUPPORTED:${draft.claimId}`);
    } else if (contraryEvidenceIds.length > 0) {
      treatment = "conflicted";
      reasons.push(
        `CONFLICTING_AUTHORITIES:${draft.claimId}:${contraryEvidenceIds.join("+")}`,
      );
    } else {
      treatment = draft.treatment === "conflicted" ? "qualified" : draft.treatment;
    }

    const finalClaim: ClaimDraft = { ...draft, treatment, confidence };
    const verdict = claimVerdict(finalClaim);
    if (verdict === "OUT_OF_DATE_SOURCE") reasons.push(`OUT_OF_DATE_SOURCE:${draft.claimId}`);
    if (verdict === "PARTIAL_SOURCE_COVERAGE") {
      reasons.push(`PARTIAL_SOURCE_COVERAGE:${draft.claimId}`);
    }
    // The entailment reason follows the FINALIZATION rule, not the verdict
    // (W12-B2). It used to be recorded only on a QUALIFIED verdict; a
    // conflicted claim whose passages also failed entailment reported
    // CONFLICTING_AUTHORITIES alone, and the answer came back
    // KESİNLEŞTİRİLEMEZ with no reason naming the threshold that blocked it
    // (measured: 4 of the 9 PARTIAL rows of the answer-level eval). A reader
    // told to "read the reasons before relying on this" must find one.
    if (
      supportingValid.length > 0 &&
      !(
        isValidConfidenceValue(confidence.entailment) &&
        confidence.entailment >= ENTAILMENT_THRESHOLD
      )
    ) {
      reasons.push(`ENTAILMENT_BELOW_THRESHOLD:${draft.claimId}`);
    }

    verified.push({
      claim: finalClaim,
      verdict,
      citationChecks,
      entailments,
      contraryEvidenceIds,
      reasons,
      currentnessApplicable,
      entailmentAggregation: aggregate.aggregation,
      // The rule-based drafter's claim text IS the quotes, so the axis is a
      // tautology in the default mode (ARCH W2, measured: a single-passage
      // claim scores exactly 1.000). Only a cloud judge measures anything.
      entailmentMeasured: drafterKind === "cloud",
    });
    overallReasons.push(...reasons);
  }

  const finalClaims = verified.map((v) => v.claim);
  // ONE definition of finalizability, and it is not here.
  //
  // `canFinalize` owns the whole contract: at least one MATERIAL claim (a
  // positive fact — "nothing failed" and "there is something you may rely on"
  // are different statements, and an empty or all-immaterial claim set
  // satisfies the first while failing the second), plus the brief 9.4 policy
  // on every material claim. This function used to bolt the non-vacuity half
  // on top of the predicate, which meant a caller that reached the predicate
  // directly got a different answer than the verifier did. Nothing is added
  // here any more, and the answer pipeline does not patch the flag afterwards
  // either.
  //
  // ONE addition (W12-FIX, 02.09.2026), and it is a COVERAGE fact, not a
  // claim fact: when the gate was bypassed by an explicit reference and the
  // admitted passages still cover less than the floor of the question's
  // content words, the cited provision was shown but the question was not
  // answered. Such a document is never finalizable, whatever its claims
  // verify to, and it says why (QUESTION_PARTIALLY_COVERED).
  const coverage = options.coverage;
  const partiallyCovered =
    coverage !== undefined &&
    coverage.gate === "bypassed-by-reference" &&
    coverage.partiallyCovered === true;
  const finalizable = canFinalize(finalClaims) && !partiallyCovered;

  const usable = verified.filter((v) => v.verdict !== "INSUFFICIENT_EVIDENCE");
  const gateSetAside =
    coverage !== undefined && coverage.gate === "failed" && coverage.setAside > 0;
  // W14 B-09. A temporal question that got one version is not a complete
  // answer, whatever its claims verify to. It stays QUALIFIED (the passages
  // shown are real and finalizable on their own terms) and carries the reason
  // that says which half is missing.
  const temporalGap =
    options.temporal !== undefined &&
    options.temporal.applicable &&
    !options.temporal.comparisonPresent;
  let status: AnswerStatus;
  if (drafts.length === 0) {
    status = "ABSTAIN";
    overallReasons.push(
      pack.items.length === 0
        ? gateSetAside
          ? "QUESTION_NOT_COVERED"
          : "NO_EVIDENCE"
        : "NO_CLAIMS_DRAFTED",
    );
  } else if (usable.length === 0) {
    status = "ABSTAIN";
    overallReasons.push("NO_VERIFIABLE_CLAIMS");
  } else if (finalizable && verified.every((v) => v.verdict === "SUPPORTED") && !temporalGap) {
    status = "COMPLETE";
  } else if (finalizable) {
    status = "QUALIFIED";
  } else {
    status = "PARTIAL";
    overallReasons.push("NOT_FINALIZABLE");
  }

  // An abstention carries the reason for its own unfinalizability, so the
  // flag and the machine reasons can never disagree.
  if (status === "ABSTAIN") overallReasons.push("ABSTENTION_NOT_FINALIZABLE");
  // Likewise a partially covered bypass names the coverage fact that blocked it.
  if (partiallyCovered && status !== "ABSTAIN") overallReasons.push("QUESTION_PARTIALLY_COVERED");
  // ...and a temporal question answered from a single version says so.
  if (temporalGap && status !== "ABSTAIN") overallReasons.push(TEMPORAL_COMPARISON_MISSING);

  // Every evidenced claim rests on the reader's own files: say so, next to
  // the finalizability decision, so "finalizable" is never read as "the law
  // says so". A mixed answer (any corpus/live passage carrying a claim) is
  // NOT marked — its corpus part was held to the strict rule.
  if (status !== "ABSTAIN" && evidencedClaims > 0 && uploadOnlyClaims === evidencedClaims) {
    overallReasons.push(UPLOAD_ONLY_EVIDENCE);
  }

  return {
    question,
    asOf: pack.asOf,
    status,
    finalizable,
    reasons: overallReasons,
    claims: verified,
    pack,
    verifiedAt: now(),
    ...(coverage !== undefined ? { coverage } : {}),
  };
}
