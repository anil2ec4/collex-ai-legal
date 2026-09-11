/**
 * Tamper detection over a completed answer (brief 9.3, "verifiable passage").
 *
 * The competitive claim of this system is that a cited quote can be re-derived
 * from a specific document version. This module proves the negative half of
 * that claim: change ONE character of a quote and the deterministic validator
 * refuses the citation, the claim loses its support, and the answer stops
 * being finalizable.
 *
 * Nothing here is a special "tamper mode" — it re-runs the SAME
 * `verifyAnswer` the pipeline runs, over a pack whose evidence has been
 * mutated. If the pipeline could be talked into accepting a mutated quote,
 * this would report it.
 */

import type { EvidencePack } from "../answer/evidencePack.js";
import { verifyAnswer, type AnswerDocument, type AnswerStatus } from "../answer/verifier.js";
import type { ClaimDraft, EvidenceRef } from "../evidence/types.js";
import type { EntailmentPort } from "../llm/ports.js";
import { LexicalEntailmentPort } from "../llm/lexicalEntailment.js";
import {
  validateEvidence,
  type EvidenceValidationResult,
} from "../verification/validator.js";
import type { Verdict } from "../verification/finalize.js";

export type TamperMode =
  /** Flip one character of the quote, leaving offsets and hashes untouched. */
  | "quote-character"
  /** Keep the quote but claim a different span. */
  | "offset-shift"
  /** Keep the quote but publish a different quote digest. */
  | "quote-hash";

export interface TamperOptions {
  /** Which evidence row to attack; defaults to the first pack item. */
  evidenceId?: string;
  mode?: TamperMode;
  /** Zero-based code-point index inside the quote to mutate (default 0). */
  position?: number;
  /**
   * Claims to re-verify. Defaults to the claims already on the document —
   * `verifyAnswer` recomputes treatment and confidence from evidence, so
   * re-feeding its own output is deterministic, not circular.
   */
  drafts?: readonly ClaimDraft[];
  entailment?: EntailmentPort;
  now?: () => string;
}

export interface TamperClaimOutcome {
  claimId: string;
  before: { verdict: Verdict; treatment: ClaimDraft["treatment"] };
  after: { verdict: Verdict; treatment: ClaimDraft["treatment"] };
}

export interface TamperCheckResult {
  evidenceId: string;
  mode: TamperMode;
  documentVersionId: string;
  originalQuote: string;
  tamperedQuote: string;
  /** Number of code points that differ between the two quotes. */
  changedCodePoints: number;
  /** Validation of the untouched evidence (must be ok). */
  originalValidation: EvidenceValidationResult;
  /** Validation of the mutated evidence (must fail with a precise reason). */
  tamperedValidation: EvidenceValidationResult;
  /** Machine failure reason, e.g. QUOTE_OFFSET_MISMATCH. */
  rejectionReason?: string;
  statusBefore: AnswerStatus;
  statusAfter: AnswerStatus;
  finalizableBefore: boolean;
  finalizableAfter: boolean;
  claims: TamperClaimOutcome[];
  /** The re-verified document, for rendering/inspection. */
  document: AnswerDocument;
}

export class TamperCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TamperCheckError";
  }
}

/** Replace the code point at `position` with a DIFFERENT visible character. */
function flipCodePoint(text: string, position: number): string {
  const points = Array.from(text);
  if (points.length === 0) throw new TamperCheckError("quote is empty; nothing to tamper with");
  const index = Math.min(Math.max(0, position), points.length - 1);
  const original = points[index] as string;
  points[index] = original === "X" ? "Y" : "X";
  return points.join("");
}

function countChangedCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.max(left.length, right.length);
  let changed = 0;
  for (let i = 0; i < length; i += 1) {
    if (left[i] !== right[i]) changed += 1;
  }
  return changed;
}

function mutate(ref: EvidenceRef, mode: TamperMode, position: number): EvidenceRef {
  switch (mode) {
    case "quote-character":
      return { ...ref, quote: flipCodePoint(ref.quote, position) };
    case "offset-shift":
      return {
        ...ref,
        locator: {
          ...ref.locator,
          startChar: ref.locator.startChar + 1,
          endChar: ref.locator.endChar + 1,
        },
      };
    case "quote-hash":
      return {
        ...ref,
        quoteSha256:
          ref.quoteSha256.slice(0, -1) + (ref.quoteSha256.endsWith("0") ? "1" : "0"),
      };
  }
}

/**
 * Tamper with one citation of a completed answer and re-run verification.
 *
 * `document` must be the AnswerDocument the pipeline produced (it carries the
 * pack with canonical texts). Returns the before/after picture; it never
 * mutates the inputs.
 */
export async function runTamperCheck(
  document: AnswerDocument,
  options: TamperOptions = {},
): Promise<TamperCheckResult> {
  const drafts: readonly ClaimDraft[] =
    options.drafts ?? document.claims.map((claim) => claim.claim);
  const pack = document.pack;
  const target =
    options.evidenceId === undefined
      ? pack.items[0]
      : pack.items.find((item) => item.ref.evidenceId === options.evidenceId);
  if (target === undefined) {
    throw new TamperCheckError(
      options.evidenceId === undefined
        ? "answer has no evidence to tamper with"
        : `evidence ${options.evidenceId} is not in the pack`,
    );
  }

  const canonical = pack.texts[target.ref.documentVersionId];
  if (canonical === undefined) {
    throw new TamperCheckError(
      `canonical text for version ${target.ref.documentVersionId} is not in the pack`,
    );
  }

  const mode: TamperMode = options.mode ?? "quote-character";
  const tamperedRef = mutate(target.ref, mode, options.position ?? 0);

  const originalValidation = validateEvidence(target.ref, canonical);
  const tamperedValidation = validateEvidence(tamperedRef, canonical);

  const tamperedPack: EvidencePack = {
    ...pack,
    items: pack.items.map((item) =>
      item.ref.evidenceId === target.ref.evidenceId ? { ...item, ref: tamperedRef } : item,
    ),
  };

  const entailment = options.entailment ?? new LexicalEntailmentPort();
  const reverified = await verifyAnswer(document.question, tamperedPack, drafts, entailment, {
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  const before = new Map(
    document.claims.map((c) => [c.claim.claimId, { verdict: c.verdict, treatment: c.claim.treatment }]),
  );

  return {
    evidenceId: target.ref.evidenceId,
    mode,
    documentVersionId: target.ref.documentVersionId,
    originalQuote: target.ref.quote,
    tamperedQuote: tamperedRef.quote,
    changedCodePoints: countChangedCodePoints(target.ref.quote, tamperedRef.quote),
    originalValidation,
    tamperedValidation,
    ...(tamperedValidation.ok ? {} : { rejectionReason: tamperedValidation.reason }),
    statusBefore: document.status,
    statusAfter: reverified.status,
    finalizableBefore: document.finalizable,
    finalizableAfter: reverified.finalizable,
    claims: reverified.claims.map((claim) => ({
      claimId: claim.claim.claimId,
      before: before.get(claim.claim.claimId) ?? {
        verdict: claim.verdict,
        treatment: claim.claim.treatment,
      },
      after: { verdict: claim.verdict, treatment: claim.claim.treatment },
    })),
    document: reverified,
  };
}
