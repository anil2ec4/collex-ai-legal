import { describe, expect, it } from "vitest";
import {
  CURRENTNESS_NEUTRAL_SCORE,
  assessCurrentness,
  bestQuoteWindow,
  buildEvidencePack,
  classifyAuthority,
  deterministicEvidenceId,
} from "../../src/answer/evidencePack.js";
import { CURRENTNESS_THRESHOLD } from "../../src/verification/finalize.js";
import { sha256HexUtf8, validateEvidence } from "../../src/verification/validator.js";
import {
  AS_OF,
  MapTextPort,
  QUOTE_TCK,
  TEXT_TCK,
  makeCandidate,
  spanOf,
  standardTexts,
  tckCandidate,
  yargitayCandidate,
} from "./fixtures.js";

const NOW = () => "2026-08-27T00:00:00Z";

describe("classifyAuthority", () => {
  it("orders mevzuat > AYM > içtihadı birleştirme > daire > BAM/ilk derece > kurul", () => {
    const tiers = [
      classifyAuthority({ source: "MEVZUAT" }).tier,
      classifyAuthority({ source: "AYM", court: "Anayasa Mahkemesi" }).tier,
      classifyAuthority({
        source: "BEDESTEN",
        court: "Yargıtay İçtihadı Birleştirme Genel Kurulu",
      }).tier,
      classifyAuthority({ source: "BEDESTEN", court: "Yargıtay 4. Hukuk Dairesi" }).tier,
      classifyAuthority({ source: "BEDESTEN", court: "İstanbul Bölge Adliye Mahkemesi" }).tier,
      classifyAuthority({ source: "KVKK", court: "Kişisel Verileri Koruma Kurulu" }).tier,
    ];
    expect(tiers).toEqual([1, 2, 3, 4, 5, 6]);
    // strictly increasing = strictly decreasing authority
    for (let i = 1; i < tiers.length; i += 1) expect(tiers[i]!).toBeGreaterThan(tiers[i - 1]!);
  });

  it("scores follow the tier order and unknown falls to tier 7", () => {
    const mevzuat = classifyAuthority({ source: "MEVZUAT" });
    const daire = classifyAuthority({ source: "BEDESTEN", court: "Danıştay 10. Daire" });
    const unknown = classifyAuthority({ source: "BEDESTEN", court: "Bilinmeyen Merci" });
    expect(mevzuat.score).toBeGreaterThan(daire.score);
    expect(daire.score).toBeGreaterThan(unknown.score);
    expect(unknown.tier).toBe(7);
    expect(unknown.rationale.length).toBeGreaterThan(0);
  });

  it("içtihadı birleştirme wins over the generic 'kurul' keyword", () => {
    const result = classifyAuthority({
      source: "BEDESTEN",
      court: "Danıştay İçtihatları Birleştirme Kurulu",
    });
    expect(result.tier).toBe(3);
  });
});

describe("assessCurrentness", () => {
  it("IN_FORCE when as_of falls inside the effective period", () => {
    const r = assessCurrentness(
      { effectiveFrom: "2020-01-01", effectiveTo: "2024-06-01" },
      "2023-05-01",
    );
    expect(r.status).toBe("IN_FORCE");
    expect(r.score).toBe(1.0);
  });

  it("NOT_YET_IN_FORCE when as_of precedes effectiveFrom", () => {
    const r = assessCurrentness({ effectiveFrom: "2024-06-01" }, "2023-05-01");
    expect(r.status).toBe("NOT_YET_IN_FORCE");
    expect(r.score).toBeLessThan(0.9);
  });

  it("OUT_OF_DATE when superseded before as_of; REPEALED when mülga", () => {
    expect(
      assessCurrentness({ effectiveFrom: "2020-01-01", effectiveTo: "2022-01-01" }, "2023-05-01")
        .status,
    ).toBe("OUT_OF_DATE");
    expect(
      assessCurrentness(
        { effectiveFrom: "2020-01-01", effectiveTo: "2022-01-01", repealed: true },
        "2023-05-01",
      ).status,
    ).toBe("REPEALED");
  });

  it("court decisions without effective period stay above the currentness gate", () => {
    const r = assessCurrentness({ decisionDate: "2024-03-12" }, AS_OF);
    expect(r.status).toBe("IN_FORCE");
    expect(r.score).toBeGreaterThanOrEqual(0.9);
  });

  it("no period data at all is conservative UNKNOWN", () => {
    const r = assessCurrentness({}, AS_OF);
    expect(r.status).toBe("UNKNOWN");
    expect(r.score).toBeLessThan(0.9);
  });

  it("an uploaded document is NOT_APPLICABLE whatever dates it carries (W12-B2)", () => {
    // Dates that would be OUT_OF_DATE for legislation: an upload has no
    // yürürlük, so the dimension does not apply and does not gate.
    const r = assessCurrentness(
      { origin: "upload", effectiveFrom: "2020-01-01", effectiveTo: "2022-01-01" },
      "2023-05-01",
    );
    expect(r.status).toBe("NOT_APPLICABLE");
    expect(r.score).toBe(CURRENTNESS_NEUTRAL_SCORE);
    expect(r.score).toBeGreaterThanOrEqual(CURRENTNESS_THRESHOLD);
    expect(r.rationale).toContain("yürürlük değerlendirilemez");
    expect(r.rationale).toContain("denetlenmemiştir");
    // Nothing else changes: corpus and live keep the ordinary assessment.
    expect(
      assessCurrentness(
        { origin: "corpus", effectiveFrom: "2020-01-01", effectiveTo: "2022-01-01" },
        "2023-05-01",
      ).status,
    ).toBe("OUT_OF_DATE");
    expect(assessCurrentness({ origin: "live" }, AS_OF).status).toBe("UNKNOWN");
  });
});

describe("buildEvidencePack", () => {
  it("extracts the REAL quote by code point offsets and hashes it", async () => {
    const pack = await buildEvidencePack(
      [tckCandidate()],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    expect(pack.rejected).toEqual([]);
    expect(pack.items).toHaveLength(1);
    const item = pack.items[0]!;
    expect(item.ref.quote).toBe(QUOTE_TCK);
    expect(item.ref.quoteSha256).toBe(sha256HexUtf8(QUOTE_TCK));
    expect(item.ref.contentSha256).toBe(sha256HexUtf8(TEXT_TCK.normalize("NFC")));
    expect(item.ref.retrievedAt).toBe(NOW());
    expect(item.authority.tier).toBe(1);
    expect(item.currentness.status).toBe("IN_FORCE");
  });

  it("uses code point offsets, not UTF-16 units (astral char before quote)", async () => {
    const text = "😀 Madde 5 - Hak arama hürriyeti engellenemez.";
    const quote = "Hak arama hürriyeti";
    const span = spanOf(text, quote);
    const candidate = makeCandidate({
      documentVersionId: "docv-emoji",
      ...span,
    });
    const pack = await buildEvidencePack(
      [candidate],
      new MapTextPort(new Map([["docv-emoji", text]])),
      { asOf: AS_OF, now: NOW },
    );
    expect(pack.items).toHaveLength(1);
    expect(pack.items[0]!.ref.quote).toBe(quote);
    // The UTF-16 slice at the same indices would be shifted by the surrogate pair.
    expect(text.slice(span.startChar, span.endChar)).not.toBe(quote);
  });

  it("rejects candidates with missing canonical text or bad offsets", async () => {
    const missing = makeCandidate({ documentVersionId: "docv-nope" });
    const badOffsets = tckCandidate({ startChar: 0, endChar: 100000 });
    const pack = await buildEvidencePack(
      [missing, badOffsets],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    expect(pack.items).toEqual([]);
    expect(pack.rejected.map((r) => r.reason)).toEqual([
      "CANONICAL_TEXT_UNAVAILABLE",
      "OFFSET_OUT_OF_RANGE",
    ]);
  });

  it("defaultOrigin fills a blank origin and never overrides an explicit one (W12-B2)", async () => {
    const pack = await buildEvidencePack(
      [tckCandidate(), yargitayCandidate({ origin: "upload" })],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW, defaultOrigin: "live" },
    );
    expect(pack.items).toHaveLength(2);
    expect(pack.items[0]!.origin).toBe("live");
    expect(pack.items[0]!.currentness.status).toBe("IN_FORCE");
    expect(pack.items[1]!.origin).toBe("upload");
    expect(pack.items[1]!.currentness.status).toBe("NOT_APPLICABLE");

    // Without a default nothing is stamped (previous contract).
    const bare = await buildEvidencePack([tckCandidate()], new MapTextPort(standardTexts()), {
      asOf: AS_OF,
      now: NOW,
    });
    expect(bare.items[0]!.origin).toBeUndefined();
  });

  it("evidence ids are deterministic for version + span", () => {
    expect(deterministicEvidenceId("docv-x", 3, 9)).toBe(deterministicEvidenceId("docv-x", 3, 9));
    expect(deterministicEvidenceId("docv-x", 3, 9)).not.toBe(
      deterministicEvidenceId("docv-x", 4, 9),
    );
  });
});

describe("quote cap (W12-FIX2, P1-5b) — the ref describes the shown window exactly", () => {
  const filler = "Genel hükümler bu maddede düzenlenir ve uygulanır. ";
  const key = "Depozito iadesi kira sözleşmesinin sona ermesinden itibaren yapılır.";
  const LONG = "Başlık satırı.\n" + filler.repeat(200) + key + " " + filler.repeat(200);

  it("keeps the window around the question's words; offsets, quote and hash move together", async () => {
    const span = spanOf(LONG, filler.repeat(200) + key + " " + filler.repeat(200));
    const candidate = makeCandidate({ documentVersionId: "v-long", chunkId: "chunk-long", ...span });
    const pack = await buildEvidencePack([candidate], new MapTextPort(new Map([["v-long", LONG]])), {
      asOf: AS_OF,
      now: NOW,
      quoteCap: { maxCodePoints: 400, focus: "Depozito iadesi ne zaman yapılır?" },
    });
    expect(pack.rejected).toEqual([]);
    const item = pack.items[0]!;
    expect(Array.from(item.ref.quote).length).toBeLessThanOrEqual(400);
    expect(item.ref.quote).toContain("Depozito iadesi");
    expect(item.quoteTruncated).toEqual({
      originalStartChar: span.startChar,
      originalEndChar: span.endChar,
      originalCodePoints: span.endChar - span.startChar,
    });
    expect(item.ref.locator.startChar).toBeGreaterThan(span.startChar);
    expect(item.ref.locator.endChar).toBeLessThan(span.endChar);
    expect(item.ref.quoteSha256).toBe(sha256HexUtf8(item.ref.quote));
    // The deterministic validator re-slices the window from the canonical text.
    expect(validateEvidence(item.ref, LONG)).toEqual({ ok: true });
    expect(item.ref.evidenceId).toBe(
      deterministicEvidenceId("v-long", item.ref.locator.startChar, item.ref.locator.endChar),
    );
    // Word boundaries on both ends, nothing trimmed from the middle.
    expect(item.ref.quote).not.toMatch(/^\s|\s$/u);
    expect(LONG).toContain(item.ref.quote);
  });

  it("is a no-op below the cap, without a cap, and deterministic", async () => {
    const short = await buildEvidencePack([tckCandidate()], new MapTextPort(standardTexts()), {
      asOf: AS_OF,
      now: NOW,
      quoteCap: { maxCodePoints: 4000, focus: "kasten öldürme" },
    });
    expect(short.items[0]?.quoteTruncated).toBeUndefined();
    expect(short.items[0]?.ref.quote).toBe(QUOTE_TCK);
    const span = spanOf(LONG, filler.repeat(200) + key);
    const candidate = makeCandidate({ documentVersionId: "v-long", ...span });
    const uncapped = await buildEvidencePack([candidate], new MapTextPort(new Map([["v-long", LONG]])), { asOf: AS_OF, now: NOW });
    expect(uncapped.items[0]?.quoteTruncated).toBeUndefined();
    expect(Array.from(uncapped.items[0]!.ref.quote).length).toBe(span.endChar - span.startChar);
    expect(bestQuoteWindow(LONG, 300, "depozito")).toEqual(bestQuoteWindow(LONG, 300, "depozito"));
    // No focus (or no match): the head of the passage.
    expect(bestQuoteWindow(LONG, 300, undefined).start).toBe(0);
    expect(bestQuoteWindow(LONG, 300, "uzay yörünge").start).toBe(0);
    expect(bestQuoteWindow("kısa", 300, "x")).toEqual({ start: 0, end: 4 });
  });
});
