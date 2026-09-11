/**
 * End-to-end offline pipeline tests (brief section 9, no live LLM):
 * buildEvidencePack -> RuleBasedDrafter -> verifyAnswer(LexicalEntailmentPort)
 * -> renderAnswerMarkdown.
 */

import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../../src/answer/evidencePack.js";
import { verifyAnswer } from "../../src/answer/verifier.js";
import { renderAnswerMarkdown } from "../../src/answer/renderer.js";
import { RuleBasedDrafter } from "../../src/llm/ruleDrafter.js";
import { LexicalEntailmentPort } from "../../src/llm/lexicalEntailment.js";
import {
  AS_OF,
  MapTextPort,
  QUOTE_CONTRARY,
  QUOTE_TCK,
  QUOTE_YARGITAY,
  contraryCandidate,
  makeCandidate,
  spanOf,
  standardTexts,
  tckCandidate,
  yargitayCandidate,
} from "./fixtures.js";

const NOW = () => "2026-08-27T00:00:00Z";
const QUESTION = "Kasten öldürme suçunun temel cezası nedir?";

async function runPipeline(candidates: Parameters<typeof buildEvidencePack>[0], texts?: Map<string, string>) {
  const pack = await buildEvidencePack(candidates, new MapTextPort(texts ?? standardTexts()), {
    asOf: AS_OF,
    now: NOW,
  });
  const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
  const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
    now: NOW,
  });
  return { pack, drafts, doc };
}

describe("(a) happy path — two supported claims", () => {
  it("is COMPLETE and renders both source cards with quotes and hash prefixes", async () => {
    const { pack, doc } = await runPipeline([tckCandidate(), yargitayCandidate()]);

    expect(doc.status).toBe("COMPLETE");
    expect(doc.finalizable).toBe(true);
    expect(doc.claims).toHaveLength(2);
    for (const claim of doc.claims) {
      expect(claim.verdict).toBe("SUPPORTED");
      expect(claim.claim.confidence.entailment).toBeGreaterThanOrEqual(0.85);
      expect(claim.claim.confidence.currentness).toBeGreaterThanOrEqual(0.9);
      expect(claim.claim.confidence.coverage).toBe(1);
    }

    const md = renderAnswerMarkdown(doc);
    expect(md).toContain("> " + QUOTE_TCK);
    expect(md).toContain("> " + QUOTE_YARGITAY);
    expect(md).toContain("### [1]");
    expect(md).toContain("### [2]");
    // Hash kısaltması of each quote appears on its card.
    for (const item of pack.items) {
      expect(md).toContain(item.ref.quoteSha256.slice(0, 12));
    }
    // Kaynak metadata on the decision card.
    expect(md).toContain("E. 2023/45");
    expect(md).toContain("K. 2024/12");
    expect(md).toContain("Yargıtay 1. Ceza Dairesi");
  });
});

describe("(b) tampered offsets", () => {
  it("validator rejects, claim unsupported, overall PARTIAL with machine reason", async () => {
    const pack = await buildEvidencePack(
      [tckCandidate(), yargitayCandidate()],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });

    // Tamper AFTER drafting: shift the mevzuat evidence offsets by one
    // (backward, so the span stays in range and the QUOTE check is what fails).
    const tampered = pack.items.find((i) => i.ref.documentVersionId === "docv-tck-1")!;
    tampered.ref.locator.startChar -= 1;
    tampered.ref.locator.endChar -= 1;

    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });

    expect(doc.finalizable).toBe(false);
    expect(doc.status).toBe("PARTIAL");

    const bad = doc.claims.find((c) =>
      c.claim.evidenceIds.includes(tampered.ref.evidenceId),
    )!;
    expect(bad.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(bad.claim.treatment).toBe("unsupported");
    expect(
      bad.reasons.some((r) => r.includes("CITATION_INVALID") && r.includes("QUOTE_OFFSET_MISMATCH")),
    ).toBe(true);
    expect(doc.reasons.some((r) => r.startsWith("CLAIM_UNSUPPORTED:"))).toBe(true);
    expect(doc.reasons).toContain("NOT_FINALIZABLE");

    // The intact claim survives.
    const good = doc.claims.find((c) => c !== bad)!;
    expect(good.verdict).toBe("SUPPORTED");
  });

  it("falls to ABSTAIN when the only claim is tampered", async () => {
    const pack = await buildEvidencePack([tckCandidate()], new MapTextPort(standardTexts()), {
      asOf: AS_OF,
      now: NOW,
    });
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    pack.items[0]!.ref.locator.startChar += 1;
    pack.items[0]!.ref.locator.endChar += 1;

    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.status).toBe("ABSTAIN");
    expect(doc.reasons).toContain("NO_VERIFIABLE_CLAIMS");
  });
});

describe("(c) conflicting authorities", () => {
  it("marks the claim CONFLICTED and renders both sides", async () => {
    const { doc } = await runPipeline([tckCandidate(), contraryCandidate()]);

    // Contrary evidence never becomes an affirmative claim.
    const conflicted = doc.claims.find((c) => c.verdict === "CONFLICTING_AUTHORITIES");
    expect(conflicted).toBeDefined();
    expect(conflicted!.claim.treatment).toBe("conflicted");
    expect(conflicted!.contraryEvidenceIds).toHaveLength(1);
    expect(doc.status).toBe("QUALIFIED"); // finalizable, but conflict is surfaced
    expect(doc.finalizable).toBe(true);
    expect(doc.reasons.some((r) => r.startsWith("CONFLICTING_AUTHORITIES:"))).toBe(true);

    const md = renderAnswerMarkdown(doc);
    // W15: bölüm adı avukat diline çevrildi ("otorite" -> "kaynak");
    // ölçülen davranış aynı — iki taraf da gösterilir.
    expect(md).toContain("## Kaynakları çelişen tespitler");
    // Both sides rendered: supporting quote AND contrary quote as source cards.
    expect(md).toContain("> " + QUOTE_TCK);
    expect(md).toContain("> " + QUOTE_CONTRARY);
    expect(md).toContain("Aleyhe kaynak: VAR");
  });
});

describe("(e) currentness against as_of", () => {
  it("selects the version in force at as_of; the later amendment is flagged, the old one is not", async () => {
    const OLD_TEXT =
      "Eski metin: kira artışı üretici fiyat endeksi oranını geçemez. Bu hüküm 2024 öncesi geçerlidir.";
    const NEW_TEXT =
      "Yeni metin: kira artışı tüketici fiyat endeksi oranını geçemez. Bu hüküm 2024 sonrası geçerlidir.";
    const texts = new Map([
      ["docv-kira-old", OLD_TEXT],
      ["docv-kira-new", NEW_TEXT],
    ]);
    const asOf = "2023-05-01"; // BEFORE the amendment
    const oldCandidate = makeCandidate({
      documentId: "doc-kira",
      documentVersionId: "docv-kira-old",
      title: "Kira Kanunu (eski sürüm)",
      legislationNo: "6098",
      article: "344",
      effectiveFrom: "2020-01-01",
      effectiveTo: "2024-06-01",
      ...spanOf(OLD_TEXT, "kira artışı üretici fiyat endeksi oranını geçemez"),
    });
    const newCandidate = makeCandidate({
      documentId: "doc-kira",
      documentVersionId: "docv-kira-new",
      title: "Kira Kanunu (yeni sürüm)",
      legislationNo: "6098",
      article: "344",
      effectiveFrom: "2024-06-01",
      ...spanOf(NEW_TEXT, "kira artışı tüketici fiyat endeksi oranını geçemez"),
    });

    const pack = await buildEvidencePack(
      [oldCandidate, newCandidate],
      new MapTextPort(texts),
      { asOf, now: NOW },
    );
    const byVersion = (v: string) => pack.items.find((i) => i.ref.documentVersionId === v)!;
    // The old version WAS in force at as_of: no OUT_OF_DATE marker on it.
    expect(byVersion("docv-kira-old").currentness.status).toBe("IN_FORCE");
    expect(byVersion("docv-kira-old").currentness.score).toBe(1.0);
    // The amendment was not yet in force at as_of.
    expect(byVersion("docv-kira-new").currentness.status).toBe("NOT_YET_IN_FORCE");

    const drafts = await new RuleBasedDrafter().draftClaims({ question: "Kira artışı sınırı nedir?", pack });
    const doc = await verifyAnswer("Kira artışı sınırı nedir?", pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });

    const oldClaim = doc.claims.find((c) =>
      c.claim.evidenceIds.includes(byVersion("docv-kira-old").ref.evidenceId),
    )!;
    const newClaim = doc.claims.find((c) =>
      c.claim.evidenceIds.includes(byVersion("docv-kira-new").ref.evidenceId),
    )!;
    // Correct temporal behaviour: old-version claim is clean...
    expect(oldClaim.verdict).toBe("SUPPORTED");
    expect(oldClaim.claim.confidence.currentness).toBe(1.0);
    // ...the not-yet-in-force version is flagged and blocks finalization.
    expect(newClaim.verdict).toBe("OUT_OF_DATE_SOURCE");
    expect(doc.finalizable).toBe(false);
    expect(doc.reasons.some((r) => r.startsWith("OUT_OF_DATE_SOURCE:"))).toBe(true);
  });
});
