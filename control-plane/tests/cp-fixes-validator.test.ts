/**
 * Regression tests for lane C2 defect 8 [P2]: `validateEvidence` re-normalized
 * (NFC), re-counted code points, re-materialized `Array.from` and re-hashed the
 * WHOLE canonical text on EVERY call. Court decisions and consolidated statutes
 * reach millions of characters, so a 50-citation answer paid that cost 50 times.
 *
 * The fix adds `prepareDocument` + `validateEvidenceBatch`, which do the
 * document-wide work ONCE. `validateEvidence` stays a thin wrapper with
 * identical semantics — proven here fixture-by-fixture.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "../src/evidence/types.js";
import {
  prepareDocument,
  sha256HexUtf8,
  validateEvidence,
  validateEvidenceAgainst,
  validateEvidenceBatch,
} from "../src/verification/validator.js";

interface FixtureCase {
  name: string;
  canonical_text: string;
  start: number;
  end: number;
  expected_quote: string;
  expected_quote_sha256: string;
  expected_content_sha256: string;
  nfd_source_text?: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "offset_policy.json"),
    "utf8",
  ),
) as { cases: FixtureCase[] };

function evidenceFor(c: FixtureCase, overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: `ev-${c.name}`,
    documentId: "doc-1",
    documentVersionId: "docv-1",
    chunkId: "chunk-1",
    source: "FIXTURE",
    sourceUrl: "https://example.invalid/fixture",
    title: c.name,
    locator: { startChar: c.start, endChar: c.end },
    quote: c.expected_quote,
    quoteSha256: c.expected_quote_sha256,
    contentSha256: c.expected_content_sha256,
    retrievedAt: "2026-08-26T00:00:00Z",
    ...overrides,
  };
}

describe("defect 8: batch validation is semantically identical to single validation", () => {
  it.each(fixture.cases)("$name: batch == single for the canonical evidence", (c) => {
    const ref = evidenceFor(c);
    expect(validateEvidenceBatch([ref], c.canonical_text)).toEqual([
      validateEvidence(ref, c.canonical_text),
    ]);
  });

  it.each(fixture.cases)("$name: batch == single for every failure mode", (c) => {
    const mutations: Array<Partial<EvidenceRef>> = [
      { locator: { startChar: -1, endChar: c.end } },
      { locator: { startChar: c.start, endChar: c.start } },
      { locator: { startChar: c.start, endChar: c.end + 10_000 } },
      { locator: { startChar: 0.5, endChar: c.end } },
      { quote: `${c.expected_quote}X` },
      { quoteSha256: "0".repeat(64) },
      { contentSha256: "0".repeat(64) },
    ];
    const refs = mutations.map((m) => evidenceFor(c, m));
    const batch = validateEvidenceBatch(refs, c.canonical_text);
    const single = refs.map((r) => validateEvidence(r, c.canonical_text));
    expect(batch).toEqual(single);
    // Every mutation must actually be rejected (the fixtures are not vacuous).
    expect(batch.every((r) => r.ok === false)).toBe(true);
  });

  it("batch normalizes NFD input exactly like the single path", () => {
    const nfdCases = fixture.cases.filter((c) => c.nfd_source_text !== undefined);
    expect(nfdCases.length).toBeGreaterThan(0);
    for (const c of nfdCases) {
      const nfd = c.nfd_source_text as string;
      const ref = evidenceFor(c);
      expect(validateEvidenceBatch([ref], nfd)).toEqual([{ ok: true }]);
      expect(validateEvidenceBatch([ref], nfd)).toEqual([validateEvidence(ref, nfd)]);
    }
  });

  it("preserves per-ref ordering and returns one result per ref", () => {
    const c = fixture.cases[0] as FixtureCase;
    const good = evidenceFor(c);
    const bad = evidenceFor(c, { quoteSha256: "0".repeat(64) });
    expect(validateEvidenceBatch([good, bad, good], c.canonical_text)).toEqual([
      { ok: true },
      { ok: false, reason: "QUOTE_HASH_MISMATCH" },
      { ok: true },
    ]);
    expect(validateEvidenceBatch([], c.canonical_text)).toEqual([]);
  });

  it("prepareDocument exposes the document-wide work as a reusable handle", () => {
    const c = fixture.cases[0] as FixtureCase;
    const doc = prepareDocument(c.canonical_text);
    expect(doc.contentSha256).toBe(c.expected_content_sha256);
    expect(doc.totalCodePoints).toBe(Array.from(c.canonical_text.normalize("NFC")).length);
    expect(doc.text).toBe(c.canonical_text.normalize("NFC"));
    expect(validateEvidenceAgainst(evidenceFor(c), doc)).toEqual({ ok: true });
  });
});

describe("defect 8: batch validation over a large document", () => {
  // ~1M code points, mirroring a consolidated statute / long court decision.
  const PARAGRAPH =
    "Madde 12 - Herkes, kişiliğine bağlı, dokunulmaz, devredilmez, vazgeçilmez temel hak ve hürriyetlere sahiptir. ";
  const BIG = `${PARAGRAPH.repeat(9_000)}😀 son.`.normalize("NFC");
  const BIG_CODE_POINTS = Array.from(BIG);
  const BIG_HASH = sha256HexUtf8(BIG);
  const REF_COUNT = 25;

  function bigRefs(): EvidenceRef[] {
    const refs: EvidenceRef[] = [];
    const stride = Math.floor(BIG_CODE_POINTS.length / (REF_COUNT + 1));
    for (let i = 0; i < REF_COUNT; i += 1) {
      const start = stride * (i + 1);
      const end = start + 40;
      const quote = BIG_CODE_POINTS.slice(start, end).join("");
      refs.push({
        evidenceId: `ev-${i}`,
        documentId: "doc-big",
        documentVersionId: "docv-big",
        chunkId: `chunk-${i}`,
        source: "MEVZUAT",
        sourceUrl: "https://example.invalid/big",
        title: "big",
        locator: { startChar: start, endChar: end },
        quote,
        quoteSha256: sha256HexUtf8(quote),
        contentSha256: BIG_HASH,
        retrievedAt: "2026-08-26T00:00:00Z",
      });
    }
    return refs;
  }

  it("validates every ref and agrees with the single-call path", () => {
    const refs = bigRefs();
    const batch = validateEvidenceBatch(refs, BIG);
    expect(batch).toHaveLength(REF_COUNT);
    expect(batch.every((r) => r.ok)).toBe(true);
    expect(batch).toEqual(refs.map((r) => validateEvidence(r, BIG)));
  });

  it("is at least 5x faster than N individual calls on a ~1M char document", () => {
    const refs = bigRefs();

    // Warm up both paths so JIT/alloc noise is not attributed to either.
    validateEvidence(refs[0] as EvidenceRef, BIG);
    validateEvidenceBatch(refs.slice(0, 1), BIG);

    const singleStart = performance.now();
    const singleResults = refs.map((r) => validateEvidence(r, BIG));
    const singleMs = performance.now() - singleStart;

    const batchStart = performance.now();
    const batchResults = validateEvidenceBatch(refs, BIG);
    const batchMs = performance.now() - batchStart;

    expect(singleResults.every((r) => r.ok)).toBe(true);
    expect(batchResults).toEqual(singleResults);

    // Generous margin: the real ratio is ~N (25x here); 5x keeps this stable
    // on slow/noisy CI machines while still failing the O(N * docLength) code.
    const speedup = singleMs / Math.max(batchMs, 0.001);
    console.log(
      `[perf] ${REF_COUNT} refs / ${BIG_CODE_POINTS.length} code points: ` +
        `single=${singleMs.toFixed(1)}ms batch=${batchMs.toFixed(1)}ms speedup=${speedup.toFixed(1)}x`,
    );
    expect(speedup).toBeGreaterThan(5);
  });
});
