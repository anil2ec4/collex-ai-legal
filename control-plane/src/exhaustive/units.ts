/**
 * Analysis units: the ledger an exhaustive review is accounted against.
 *
 * Why not just reuse retrieval chunks
 * -----------------------------------
 * A retrieval chunk is sized to be FOUND: one paragraph, so a match is
 * precise and a citation is tight. An analysis unit is sized to be
 * UNDERSTOOD: enough surrounding text that "the witness says the vehicle was
 * stationary" can be read with the sentence that qualifies it. The two are
 * different jobs and forcing one shape to do both makes both worse.
 *
 * So a unit is a contiguous RUN of chunks, packed up to a character budget.
 * It never splits a chunk, which keeps three things true for free:
 *   - a unit's span is still an exact slice of the canonical text;
 *   - a unit maps onto whole chunks, so an observation can cite the chunk
 *     (and therefore the quote hash) it came from;
 *   - a unit maps onto source segments, so it maps onto physical pages.
 *
 * Determinism and resumption
 * --------------------------
 * Unit construction is a pure function of (chunk spans, budget), so the same
 * version always yields the same units in the same order — which is what
 * makes `unitNo` a stable identity across restarts.
 *
 * Each unit carries `sourceSha256`, the hash of its own canonical text. That
 * is the resumption key: on a re-run, a unit whose hash and analysis version
 * both match a completed row is not recomputed. If the document changed, the
 * hash changes and the work is redone — no stale result can survive a file
 * being replaced.
 */

import { createHash } from "node:crypto";

/** A chunk's position, the only thing unit packing needs from it. */
export interface UnitSourceSpan {
  readonly chunkId: string;
  readonly ordinal: number;
  readonly startChar: number;
  readonly endChar: number;
}

export interface AnalysisUnit {
  /** 1-based, stable for a given (version, budget). */
  readonly unitNo: number;
  readonly documentVersionId: string;
  /** Upload id, so a unit can be reported per file. */
  readonly fileId: string;
  readonly startChar: number;
  readonly endChar: number;
  /** The unit's exact canonical text. */
  readonly text: string;
  /** sha256 hex over the UTF-8 bytes of `text` — the resumption key. */
  readonly sourceSha256: string;
  /** The chunks this unit covers, in order. */
  readonly chunkIds: readonly string[];
}

/**
 * Target size of a unit in code points.
 *
 * Chosen to hold a few paragraphs of a Turkish legal document — enough for a
 * statement and its qualifier — while staying far inside the context a small
 * local model can handle alongside its instructions. It is a SETTING, not a
 * tuned optimum, and no quality claim is attached to the number.
 */
export const DEFAULT_UNIT_TARGET_CHARS = 2400;

/**
 * Hard ceiling. A single chunk longer than this is still one unit (chunks are
 * never split), but packing never adds to a unit past it.
 */
export const DEFAULT_UNIT_MAX_CHARS = 4000;

export interface BuildUnitsOptions {
  readonly targetChars?: number;
  readonly maxChars?: number;
}

/**
 * Version of the unit-construction rules.
 *
 * Stored on every unit row. Changing how units are cut changes what "unit 846"
 * means, so a row built by an older builder must not be silently reused —
 * the version mismatch forces recomputation instead.
 */
export const UNIT_BUILDER_VERSION = "units-v1";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Pack chunk spans into analysis units.
 *
 * `canonicalText` must be the version's canonical text; every unit's `text`
 * is sliced from it, so the exact-slice invariant is preserved by
 * construction rather than asserted afterwards.
 *
 * A unit spans from the first chunk's `startChar` to the last chunk's
 * `endChar`, INCLUDING whatever lies between them (headings the chunker did
 * not emit). That is deliberate: an exhaustive review must not skip text
 * merely because the chunker had no use for it.
 */
export function buildAnalysisUnits(
  options: {
    readonly documentVersionId: string;
    readonly fileId: string;
    readonly canonicalText: string;
    readonly spans: readonly UnitSourceSpan[];
  } & BuildUnitsOptions,
): AnalysisUnit[] {
  const target = options.targetChars ?? DEFAULT_UNIT_TARGET_CHARS;
  const max = Math.max(target, options.maxChars ?? DEFAULT_UNIT_MAX_CHARS);
  const text = options.canonicalText;

  // Order is part of the identity, so it is imposed here rather than trusted.
  const spans = [...options.spans].sort(
    (a, b) => a.startChar - b.startChar || a.ordinal - b.ordinal,
  );

  const units: AnalysisUnit[] = [];
  let bucket: UnitSourceSpan[] = [];

  const flush = (): void => {
    if (bucket.length === 0) return;
    const first = bucket[0] as UnitSourceSpan;
    const last = bucket[bucket.length - 1] as UnitSourceSpan;
    const startChar = first.startChar;
    const endChar = last.endChar;
    const slice = codePointSlice(text, startChar, endChar);
    units.push({
      unitNo: units.length + 1,
      documentVersionId: options.documentVersionId,
      fileId: options.fileId,
      startChar,
      endChar,
      text: slice,
      sourceSha256: sha256Hex(slice),
      chunkIds: bucket.map((span) => span.chunkId),
    });
    bucket = [];
  };

  for (const span of spans) {
    if (bucket.length === 0) {
      bucket.push(span);
      continue;
    }
    const first = bucket[0] as UnitSourceSpan;
    const wouldEnd = span.endChar;
    if (wouldEnd - first.startChar > max) {
      flush();
      bucket.push(span);
      continue;
    }
    bucket.push(span);
    if (wouldEnd - first.startChar >= target) flush();
  }
  flush();
  return units;
}

/**
 * Slice by Unicode CODE POINTS, not UTF-16 code units (ADR-003).
 *
 * JavaScript string indexing is UTF-16, so `text.slice(a, b)` would be wrong
 * for any document containing an astral character — and would corrupt every
 * offset after it. This is the same reason chunk offsets are counted in code
 * points on both runtimes.
 */
export function codePointSlice(text: string, start: number, end: number): string {
  if (end <= start) return "";
  // FAST PATH. Without a surrogate anywhere, code-point indexes and UTF-16
  // indexes coincide and the native slice is exact. This is what keeps unit
  // building LINEAR: the previous version rebuilt the prefix character by
  // character on every call, so a document with N units cost O(N * length)
  // — seconds of synchronous work inside the HTTP handler on a large file.
  // Turkish legal text is entirely inside the BMP, so this is the path that
  // runs; the scan below exists for correctness when it is not.
  if (!hasSurrogate(text)) return text.slice(start, end);

  let index = 0;
  let from = -1;
  for (let at = 0; at < text.length; ) {
    if (index === start) from = at;
    if (index === end) return text.slice(from < 0 ? 0 : from, at);
    const point = text.codePointAt(at);
    at += point !== undefined && point > 0xffff ? 2 : 1;
    index += 1;
  }
  return from < 0 ? "" : text.slice(from);
}

/** Code-point length (NOT `String.length`). */
export function codePointLength(text: string): number {
  if (!hasSurrogate(text)) return text.length;
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

/**
 * Does the string contain any UTF-16 surrogate?
 *
 * The only case where code-point indexing differs from `String.length`
 * indexing. Written as a code-unit scan rather than a regexp so the source
 * file itself never has to contain a surrogate literal.
 */
function hasSurrogate(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const unit = text.charCodeAt(at);
    if (unit >= 0xd800 && unit <= 0xdfff) return true;
  }
  return false;
}
