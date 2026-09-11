/**
 * Property tests for the two guarantees the rest of the layer leans on:
 *
 *  1. `sanitizeMarkdown` is idempotent — a re-render, a re-sanitize on the way
 *     into a cache, or a double pass in a pipeline must never change meaning
 *     or (worse) re-expose something the first pass neutralized.
 *  2. `wrapEvidenceForModel` never emits an unescaped wrapper delimiter, for
 *     ANY input — this is the delimiter-collision guarantee.
 *
 * Inputs: every corpus payload plus a deterministic generated adversarial set
 * (single fragments, adjacent pairs, and seeded 2..5-fragment concatenations).
 */

import { describe, expect, it } from "vitest";

import {
  FIXTURES,
  generatedAdversarialStrings,
  liveOffAllowlistTargets,
  payloadText,
} from "./corpus.js";
import { sanitizeMarkdown } from "../../src/security/renderGuard.js";
import {
  UNTRUSTED_BLOCK_CLOSE,
  UNTRUSTED_BLOCK_OPEN,
  UNTRUSTED_PREAMBLE,
  wrapEvidenceForModel,
} from "../../src/security/untrusted.js";

const CORPUS_INPUTS = FIXTURES.map(payloadText);
const GENERATED_INPUTS = generatedAdversarialStrings();
const ALL_INPUTS = [...CORPUS_INPUTS, ...GENERATED_INPUTS];

/** ASCII fence plus every look-alike spelling a model could read as the fence. */
const FENCE_SHAPED = new RegExp(
  "[<\\u02c2\\u2039\\u276c\\u2770\\u2329\\u3008\\ufe64\\uff1c]\\s*/?\\s*untrusted_evidence",
  "i",
);

function evidenceBody(wrapped: string): string {
  const start = wrapped.indexOf(UNTRUSTED_BLOCK_OPEN) + UNTRUSTED_BLOCK_OPEN.length;
  return wrapped.slice(start, wrapped.lastIndexOf(UNTRUSTED_BLOCK_CLOSE));
}

describe("property: sanitizeMarkdown is idempotent", () => {
  it("holds for every corpus payload", () => {
    for (const input of CORPUS_INPUTS) {
      const once = sanitizeMarkdown(input);
      expect(sanitizeMarkdown(once), `not idempotent for: ${input.slice(0, 160)}`).toBe(once);
    }
  });

  it("holds for every generated adversarial string", () => {
    expect(GENERATED_INPUTS.length).toBeGreaterThan(300);
    for (const input of GENERATED_INPUTS) {
      const once = sanitizeMarkdown(input);
      expect(sanitizeMarkdown(once), `not idempotent for: ${JSON.stringify(input)}`).toBe(once);
    }
  });

  it("reaches the fixed point in ONE call, not merely on convergence", () => {
    // A single sanitize must already be the fixed point: three passes equal one.
    for (const input of ALL_INPUTS) {
      const once = sanitizeMarkdown(input);
      expect(sanitizeMarkdown(sanitizeMarkdown(once))).toBe(once);
    }
  });
});

describe("property: sanitized output can never issue an off-allowlist request", () => {
  it("leaves no live link, image, reference definition, bare URL or www host", () => {
    for (const input of ALL_INPUTS) {
      const sanitized = sanitizeMarkdown(input);
      expect(
        liveOffAllowlistTargets(sanitized),
        `live off-allowlist target from: ${JSON.stringify(input.slice(0, 160))}`,
      ).toEqual([]);
    }
  });

  it("never leaves a raw angle bracket, for any input", () => {
    for (const input of ALL_INPUTS) {
      const sanitized = sanitizeMarkdown(input);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
    }
  });
});

describe("property: wrapEvidenceForModel never emits an unescaped delimiter", () => {
  it("emits each fence exactly once and keeps the body free of fence shapes", () => {
    for (const input of ALL_INPUTS) {
      const wrapped = wrapEvidenceForModel(input);

      expect(wrapped.split(UNTRUSTED_BLOCK_OPEN).length - 1, JSON.stringify(input)).toBe(1);
      expect(wrapped.split(UNTRUSTED_BLOCK_CLOSE).length - 1, JSON.stringify(input)).toBe(1);

      const body = evidenceBody(wrapped);
      expect(body).not.toContain("<");
      expect(body).not.toContain(">");
      expect(FENCE_SHAPED.test(body), `fence shape survived: ${JSON.stringify(input)}`).toBe(false);
    }
  });

  it("keeps the structural contract: preamble, open fence, body, close fence", () => {
    for (const input of ALL_INPUTS) {
      const wrapped = wrapEvidenceForModel(input);
      expect(wrapped.startsWith(`${UNTRUSTED_PREAMBLE}\n${UNTRUSTED_BLOCK_OPEN}\n`)).toBe(true);
      expect(wrapped.endsWith(`\n${UNTRUSTED_BLOCK_CLOSE}`)).toBe(true);
      expect(wrapped.indexOf(UNTRUSTED_BLOCK_OPEN)).toBeLessThan(
        wrapped.indexOf(UNTRUSTED_BLOCK_CLOSE),
      );
    }
  });

  it("strips every zero-width / BiDi control from the body", () => {
    const bidiAndInvisible = new RegExp(
      "[\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]",
    );
    for (const input of ALL_INPUTS) {
      expect(bidiAndInvisible.test(evidenceBody(wrapEvidenceForModel(input)))).toBe(false);
    }
  });
});
