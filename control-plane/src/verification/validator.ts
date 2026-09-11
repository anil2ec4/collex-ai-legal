/**
 * Deterministic citation validator (Master Build Brief section 9.3), with the
 * project's canonical offset policy applied:
 *
 *   Offsets are UNICODE CODE POINT indices into the NFC-normalized canonical
 *   text — NOT UTF-16 code units (which `String.prototype.slice` would use)
 *   and NOT UTF-8 bytes. This matches Python `str` slicing over the same NFC
 *   text, so identical fixtures must validate in both languages
 *   (see control-plane/fixtures/offset_policy.json and
 *   tests/contracts/test_offset_policy.py).
 *
 * Hashes are SHA-256 hex digests over UTF-8 bytes.
 */

import { createHash } from "node:crypto";
import type { EvidenceRef } from "../evidence/types.js";

/** SHA-256 hex over the UTF-8 encoding of a string. */
export function sha256HexUtf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Number of Unicode code points in a string. O(n), allocation-free. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * Slice a string by Unicode CODE POINT indices (start inclusive, end
 * exclusive). Uses a single `Array.from(text)` pass, so it is O(n) in the
 * total length of `text` regardless of the slice bounds — do not call it in a
 * tight per-character loop; slice once per evidence check.
 */
export function codePointSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

export type EvidenceValidationFailure =
  | "OFFSET_OUT_OF_RANGE"
  | "QUOTE_OFFSET_MISMATCH"
  | "QUOTE_HASH_MISMATCH"
  | "DOCUMENT_VERSION_MISMATCH";

export type EvidenceValidationResult =
  | { ok: true }
  | { ok: false; reason: EvidenceValidationFailure };

/**
 * The document-wide work of validation, done ONCE.
 *
 * NFC normalization, the code-point materialization and the SHA-256 of the
 * whole canonical text are all O(document length) and identical for every
 * evidence ref pointing at that document. Court decisions and consolidated
 * statutes run to millions of characters, so doing this per ref made a
 * 50-citation answer ~50x more expensive than it needs to be
 * (see validateEvidenceBatch).
 */
export interface PreparedDocument {
  /** NFC-normalized canonical text. */
  readonly text: string;
  /** `text` materialized as code points (index === canonical offset). */
  readonly codePoints: readonly string[];
  readonly totalCodePoints: number;
  /** SHA-256 hex over the UTF-8 bytes of `text`. */
  readonly contentSha256: string;
}

/** Normalize + index + hash a canonical document once for repeated validation. */
export function prepareDocument(canonicalText: string): PreparedDocument {
  const text = canonicalText.normalize("NFC");
  const codePoints = Array.from(text);
  return {
    text,
    codePoints,
    totalCodePoints: codePoints.length,
    contentSha256: sha256HexUtf8(text),
  };
}

/**
 * Validate one evidence reference against an already-prepared document.
 *
 * Semantics are identical to `validateEvidence`; only the shared per-document
 * work is hoisted out. Check order follows the brief:
 * offsets -> quote -> quote hash -> content hash.
 */
export function validateEvidenceAgainst(
  evidence: EvidenceRef,
  document: PreparedDocument,
): EvidenceValidationResult {
  const { startChar, endChar } = evidence.locator;

  if (
    !Number.isInteger(startChar) ||
    !Number.isInteger(endChar) ||
    startChar < 0 ||
    endChar <= startChar ||
    endChar > document.totalCodePoints
  ) {
    return { ok: false, reason: "OFFSET_OUT_OF_RANGE" };
  }

  const exact = document.codePoints.slice(startChar, endChar).join("");
  if (exact !== evidence.quote) {
    return { ok: false, reason: "QUOTE_OFFSET_MISMATCH" };
  }

  if (sha256HexUtf8(exact) !== evidence.quoteSha256) {
    return { ok: false, reason: "QUOTE_HASH_MISMATCH" };
  }

  if (document.contentSha256 !== evidence.contentSha256) {
    return { ok: false, reason: "DOCUMENT_VERSION_MISMATCH" };
  }

  return { ok: true };
}

/**
 * Validate many evidence references against ONE canonical document, paying the
 * O(document length) normalization/indexing/hashing cost a single time.
 *
 * Results are positional: `result[i]` belongs to `refs[i]`.
 */
export function validateEvidenceBatch(
  refs: readonly EvidenceRef[],
  canonicalText: string,
): EvidenceValidationResult[] {
  if (refs.length === 0) return [];
  const document = prepareDocument(canonicalText);
  return refs.map((ref) => validateEvidenceAgainst(ref, document));
}

/**
 * Validate one evidence reference against the canonical document text.
 *
 * The canonical stored form is NFC; the validator normalizes its input so the
 * policy holds even if a caller hands over a decomposed (NFD) copy of the same
 * canonical text. Offsets/hashes computed against anything other than the NFC
 * form will (correctly) fail.
 *
 * Thin wrapper over `prepareDocument` + `validateEvidenceAgainst`: identical
 * semantics, but it re-does the whole-document work on every call. Prefer
 * `validateEvidenceBatch` (or a hoisted `prepareDocument`) whenever more than
 * one ref points at the same document.
 */
export function validateEvidence(
  evidence: EvidenceRef,
  canonicalText: string,
): EvidenceValidationResult {
  return validateEvidenceAgainst(evidence, prepareDocument(canonicalText));
}
