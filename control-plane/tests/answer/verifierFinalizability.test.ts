/**
 * Finalizability is a POSITIVE fact, not the absence of a failure.
 *
 * "Does any claim FAIL the policy?" answers no for an empty claim set —
 * `every()` over nothing is true. That is the wrong question to put to an
 * ANSWER: an ABSTAIN document reporting `finalizable: true` next to "we could
 * not answer this" reads to an operator as "ready to rely on". The same hole
 * sits one step further in, in a document whose claims are all
 * `material: false`.
 *
 * The rule used to live HERE, in `verifyAnswer`, bolted on top of
 * `canFinalize` — so the predicate and the verifier gave different answers to
 * the same question and a caller reaching the predicate directly got the wrong
 * one. It now lives in `verification/finalize.ts :: canFinalize`, which owns
 * the whole contract; `verifyAnswer` just calls it. These tests pin that the
 * two layers AGREE, and that the answer pipeline does not patch the flag
 * afterwards.
 */

import { describe, expect, it } from "vitest";

import { CURRENTNESS_NEUTRAL_SCORE, buildEvidencePack } from "../../src/answer/evidencePack.js";
import { UPLOAD_ONLY_EVIDENCE, verifyAnswer } from "../../src/answer/verifier.js";
import {
  CURRENTNESS_THRESHOLD,
  ENTAILMENT_THRESHOLD,
  canFinalize,
} from "../../src/verification/finalize.js";
import { LexicalEntailmentPort } from "../../src/llm/lexicalEntailment.js";
import { RuleBasedDrafter } from "../../src/llm/ruleDrafter.js";
import type { ClaimDraft } from "../../src/evidence/types.js";
import {
  AS_OF,
  MapTextPort,
  QUOTE_TCK,
  contraryCandidate,
  makeCandidate,
  spanOf,
  standardTexts,
  tckCandidate,
} from "./fixtures.js";

const NOW = () => "2026-08-27T00:00:00Z";
const QUESTION = "Kasten öldürme suçunun temel cezası nedir?";

async function emptyPack() {
  return buildEvidencePack([], new MapTextPort(new Map()), { asOf: AS_OF, now: NOW });
}

describe("an empty claim set is not finalizable", () => {
  it("abstains with finalizable:false and says why", async () => {
    const doc = await verifyAnswer(
      QUESTION,
      await emptyPack(),
      [],
      new LexicalEntailmentPort(),
      { now: NOW },
    );

    expect(doc.status).toBe("ABSTAIN");
    expect(doc.finalizable).toBe(false);
    expect(doc.reasons).toContain("NO_EVIDENCE");
    expect(doc.reasons).toContain("ABSTENTION_NOT_FINALIZABLE");
  });

  it("is the same decision at both layers", async () => {
    // The predicate says no too. Two layers answering "may this be finalized?"
    // differently is the defect, not the design: whichever one a caller
    // reaches, it must give the answer the operator sees.
    expect(canFinalize([])).toBe(false);
  });

  it("stays non-finalizable when evidence exists but nothing was drafted", async () => {
    const pack = await buildEvidencePack(
      [tckCandidate()],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    const doc = await verifyAnswer(QUESTION, pack, [], new LexicalEntailmentPort(), {
      now: NOW,
    });

    expect(doc.status).toBe("ABSTAIN");
    expect(doc.finalizable).toBe(false);
    expect(doc.reasons).toContain("NO_CLAIMS_DRAFTED");
    expect(doc.reasons).toContain("ABSTENTION_NOT_FINALIZABLE");
  });
});

describe("a document made only of immaterial claims is not finalizable either", () => {
  it("refuses to finalize when every claim is material:false", async () => {
    const pack = await buildEvidencePack(
      [tckCandidate()],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    const drafted = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const immaterial: ClaimDraft[] = drafted.map((claim) => ({ ...claim, material: false }));

    // canFinalize skips immaterial claims for the POLICY check, but a set
    // made only of them carries nothing, so the non-vacuity half refuses...
    expect(canFinalize(immaterial)).toBe(false);
    // ...and the verifier reports exactly that, because it asks the same
    // predicate rather than adding a rule of its own.
    const doc = await verifyAnswer(QUESTION, pack, immaterial, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.finalizable).toBe(false);
  });
});

describe("uploaded documents: currentness is not applicable, and never masks stale law (W12-B2)", () => {
  const UPLOAD_TEXT =
    "Kira sözleşmesi taslağı.\n" +
    "Madde 7 - Depozito, anahtar teslimini izleyen on beş gün içinde iade edilir.";
  const UPLOAD_QUOTE = "Depozito, anahtar teslimini izleyen on beş gün içinde iade edilir.";
  const Q = "Depozito ne zaman iade edilir?";

  function uploadCandidate() {
    return makeCandidate({
      documentId: "doc-upload",
      documentVersionId: "docv-upload-1",
      source: "UPLOAD",
      sourceUrl: "",
      title: "kira_sozlesmesi.docx",
      origin: "upload",
      ...spanOf(UPLOAD_TEXT, UPLOAD_QUOTE),
    });
  }
  const texts = () => new MapTextPort(new Map([...standardTexts(), ["docv-upload-1", UPLOAD_TEXT]]));

  it("an upload-only answer is finalizable and says it rests on the reader's own document", async () => {
    const pack = await buildEvidencePack([uploadCandidate()], texts(), { asOf: AS_OF, now: NOW });
    expect(pack.items[0]!.currentness.status).toBe("NOT_APPLICABLE");
    expect(pack.items[0]!.currentness.score).toBe(CURRENTNESS_NEUTRAL_SCORE);

    const drafts = await new RuleBasedDrafter().draftClaims({ question: Q, pack });
    const doc = await verifyAnswer(Q, pack, drafts, new LexicalEntailmentPort(), { now: NOW });

    expect(doc.status).toBe("COMPLETE");
    expect(doc.finalizable).toBe(true);
    expect(doc.claims[0]!.verdict).toBe("SUPPORTED");
    expect(doc.claims[0]!.currentnessApplicable).toBe(false);
    expect(doc.claims[0]!.claim.confidence.currentness).toBe(CURRENTNESS_NEUTRAL_SCORE);
    expect(doc.reasons).toContain(UPLOAD_ONLY_EVIDENCE);
    expect(doc.reasons.some((r) => r.startsWith("OUT_OF_DATE_SOURCE"))).toBe(false);
    // Both layers agree, as always.
    expect(canFinalize(doc.claims.map((c) => c.claim))).toBe(true);
  });

  it("one claim citing the upload AND a stale statute is measured over the statute alone", async () => {
    // effectiveTo before AS_OF (2025-01-15): OUT_OF_DATE for the law.
    const stale = tckCandidate({ effectiveFrom: "2005-06-01", effectiveTo: "2024-01-01" });
    const pack = await buildEvidencePack([uploadCandidate(), stale], texts(), { asOf: AS_OF, now: NOW });
    expect(pack.items.map((i) => i.currentness.status)).toEqual(["NOT_APPLICABLE", "OUT_OF_DATE"]);

    const mixedClaim: ClaimDraft = {
      claimId: "c-mixed",
      text: `${UPLOAD_QUOTE} ${QUOTE_TCK}`,
      material: true,
      evidenceIds: pack.items.map((i) => i.ref.evidenceId),
      treatment: "supported",
      confidence: { retrieval: 1, entailment: 0, authority: 1, currentness: 1, coverage: 1 },
    };
    const doc = await verifyAnswer(Q, pack, [mixedClaim], new LexicalEntailmentPort(), { now: NOW });

    const verified = doc.claims[0]!;
    // The neutral upload score must not hide the stale statute under max().
    expect(verified.currentnessApplicable).toBe(true);
    expect(verified.claim.confidence.currentness).toBeLessThan(CURRENTNESS_THRESHOLD);
    expect(verified.verdict).toBe("OUT_OF_DATE_SOURCE");
    expect(doc.finalizable).toBe(false);
    expect(doc.reasons).not.toContain(UPLOAD_ONLY_EVIDENCE);
    expect(doc.reasons).toContain("OUT_OF_DATE_SOURCE:c-mixed");
  });

  it("a claim with no validated supporting evidence is not exempted", async () => {
    const pack = await buildEvidencePack([uploadCandidate()], texts(), { asOf: AS_OF, now: NOW });
    const orphan: ClaimDraft = {
      claimId: "c-orphan",
      text: "Dayanaksız tespit.",
      material: true,
      evidenceIds: ["ev-yok-0000"],
      treatment: "supported",
      confidence: { retrieval: 1, entailment: 1, authority: 1, currentness: 1, coverage: 1 },
    };
    const doc = await verifyAnswer(Q, pack, [orphan], new LexicalEntailmentPort(), { now: NOW });
    expect(doc.claims[0]!.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(doc.claims[0]!.currentnessApplicable).toBe(true);
    expect(doc.claims[0]!.claim.confidence.currentness).toBe(0);
    expect(doc.finalizable).toBe(false);
    // Nothing was evidenced, so nothing "rests on the upload".
    expect(doc.reasons).not.toContain(UPLOAD_ONLY_EVIDENCE);
  });
});

describe("a non-finalizable claim always names the threshold that blocked it (W12-B2)", () => {
  it("records ENTAILMENT_BELOW_THRESHOLD on a CONFLICTED claim too, not only on a QUALIFIED one", async () => {
    // The verdict precedence puts CONFLICTING_AUTHORITIES above QUALIFIED,
    // which used to swallow the entailment reason: the answer was
    // KESİNLEŞTİRİLEMEZ and the reader could not see why.
    const pack = await buildEvidencePack(
      [tckCandidate(), contraryCandidate()],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    const supporting = pack.items.find((i) => i.stance !== "contrary")!;
    const claim: ClaimDraft = {
      claimId: "c-conflicted",
      // Shares the numbers (5237, 81) with the contrary passage so the
      // conflict links, and almost no words with the supporting quote so
      // the lexical judge scores it below the threshold.
      text: "5237 sayılı Kanun m. 81 uyarınca verilecek yaptırım ağırlaştırılmış olabilir.",
      material: true,
      evidenceIds: [supporting.ref.evidenceId],
      treatment: "supported",
      confidence: { retrieval: 1, entailment: 0, authority: 1, currentness: 1, coverage: 1 },
    };
    const doc = await verifyAnswer(QUESTION, pack, [claim], new LexicalEntailmentPort(), {
      now: NOW,
    });

    const verified = doc.claims[0]!;
    expect(verified.verdict).toBe("CONFLICTING_AUTHORITIES");
    expect(verified.claim.confidence.entailment).toBeLessThan(ENTAILMENT_THRESHOLD);
    expect(doc.finalizable).toBe(false);
    expect(doc.status).toBe("PARTIAL");
    expect(verified.reasons).toContain("ENTAILMENT_BELOW_THRESHOLD:c-conflicted");
    expect(verified.reasons.some((r) => r.startsWith("CONFLICTING_AUTHORITIES:c-conflicted"))).toBe(true);
    expect(doc.reasons).toContain("ENTAILMENT_BELOW_THRESHOLD:c-conflicted");
    expect(doc.reasons).toContain("NOT_FINALIZABLE");
  });

  it("does not record it when the claim clears the threshold", async () => {
    const pack = await buildEvidencePack([tckCandidate()], new MapTextPort(standardTexts()), {
      asOf: AS_OF,
      now: NOW,
    });
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.claims[0]!.claim.confidence.entailment).toBeGreaterThanOrEqual(ENTAILMENT_THRESHOLD);
    expect(doc.reasons.some((r) => r.startsWith("ENTAILMENT_BELOW_THRESHOLD"))).toBe(false);
  });
});

describe("a genuinely supported answer is still finalizable", () => {
  it("does not become collateral damage of the non-vacuity rule", async () => {
    const pack = await buildEvidencePack(
      [tckCandidate()],
      new MapTextPort(standardTexts()),
      { asOf: AS_OF, now: NOW },
    );
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });

    expect(doc.status).toBe("COMPLETE");
    expect(doc.finalizable).toBe(true);
    expect(doc.reasons).not.toContain("ABSTENTION_NOT_FINALIZABLE");
  });
});
