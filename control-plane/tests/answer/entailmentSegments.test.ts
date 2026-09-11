/**
 * W14 B-31 — entailment is judged on the unit the drafter produced.
 *
 * THE DEFECT (ARCH §4.3, reproduced 02.09.2026). `RuleBasedDrafter` emits ONE
 * claim per (documentVersionId, article) whose text is the concatenation of
 * that provision's quotes; `verifyAnswer` judged each cited passage against
 * the WHOLE claim and took `max()`. So fıkra 1 was asked to entail fıkra 2's
 * words, `max` asked whether SOME passage carried EVERYTHING, and a
 * consolidated provision claim could not pass 0.85 by construction:
 *
 *   probe 1 (two fıkra, no cross-reference)  max = 0.633  ✗
 *   probe 2 (fıkra 2 cites "158 inci madde") max = 0.563  ✗   (the 0.20 branch)
 *
 * Nine of twenty-one answerable gold rows were unfinalizable for that
 * mechanical reason. NOTHING here moves a gate: ENTAILMENT_THRESHOLD is still
 * 0.85 and is asserted below. What changed is the QUESTION asked — "is every
 * part of the claim carried by the passages cited for that part" — and the
 * tests below pin both halves: the new aggregation passes, and the old one
 * would still fail on the identical fixture (so the test cannot pass
 * vacuously).
 *
 * Nothing here is a quality improvement. The rule-based entailment axis is a
 * tautology either way (the claim text IS the quotes); this is a defect being
 * removed. `entailmentMeasured` exists so no surface can claim otherwise.
 */

import { describe, expect, it } from "vitest";

import { buildEvidencePack } from "../../src/answer/evidencePack.js";
import {
  ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM,
  verifyAnswer,
} from "../../src/answer/verifier.js";
import { ENTAILMENT_THRESHOLD } from "../../src/verification/finalize.js";
import { LexicalEntailmentPort } from "../../src/llm/lexicalEntailment.js";
import { RuleBasedDrafter } from "../../src/llm/ruleDrafter.js";
import type { ClaimDraft } from "../../src/evidence/types.js";
import type { EntailmentJudgement, EntailmentPort } from "../../src/llm/ports.js";
import { AS_OF, MapTextPort, makeCandidate, spanOf } from "./fixtures.js";

const NOW = (): string => "2026-09-02T00:00:00Z";

/* --------------------------------------------------------------------------
 * SENTETİK fixture — two fıkra of one article, in two shapes.
 * ----------------------------------------------------------------------- */

const FIKRA_1 =
  "Hileli davranışlarla bir kimseyi aldatıp, onun veya başkasının zararına " +
  "olarak kendisine veya başkasına bir yarar sağlayan kişi, üç yıldan yedi " +
  "yıla kadar hapis ve beş bin güne kadar adlî para cezası ile cezalandırılır.";

/** probe 1: a second fıkra that shares almost nothing with the first. */
const FIKRA_2_PLAIN =
  "Bu suçun soruşturulması ve kovuşturulması şikâyete bağlı değildir; " +
  "zarar görenin rızası cezayı ortadan kaldırmaz.";

/** probe 2: a second fıkra carrying a CROSS-REFERENCE number. */
const FIKRA_2_CROSSREF =
  "Bu fıkra kapsamındaki fiillerin 158 inci maddede sayılan hâllerde " +
  "işlenmesi durumunda ceza ağırlaştırılır.";

function documentText(secondFikra: string): string {
  return (
    "5237 sayılı Türk Ceza Kanunu (SENTETİK ALINTI)\n" +
    "MADDE 157 - (1) " +
    FIKRA_1 +
    "\n(2) " +
    secondFikra
  );
}

const VERSION_ID = "docv-5237-157";

function provisionPack(secondFikra: string) {
  const text = documentText(secondFikra);
  const first = spanOf(text, FIKRA_1);
  const second = spanOf(text, secondFikra);
  const base = {
    documentId: "doc-5237",
    documentVersionId: VERSION_ID,
    source: "MEVZUAT",
    sourceUrl: "https://example.invalid/fixture/5237",
    title: "Türk Ceza Kanunu (SENTETİK)",
    legislationNo: "5237",
    article: "157",
    effectiveFrom: "2005-06-01",
  };
  return buildEvidencePack(
    [
      makeCandidate({ ...base, chunkId: "chunk-157-1", ...first }),
      makeCandidate({ ...base, chunkId: "chunk-157-2", ...second }),
    ],
    new MapTextPort(new Map([[VERSION_ID, text]])),
    { asOf: AS_OF, now: NOW },
  );
}

const QUESTION = "TCK m. 157 dolandırıcılık suçu nasıl düzenlenmiştir?";

/** The pre-W14 judge: no set aggregation, so the verifier must fall back to max. */
class MaxOnlyEntailmentPort implements EntailmentPort {
  private readonly inner = new LexicalEntailmentPort();
  async assess(claimText: string, evidence: Parameters<EntailmentPort["assess"]>[1]) {
    return this.inner.assess(claimText, evidence);
  }
}

/** Strip the attribution the drafter now produces — i.e. a pre-W14 claim. */
function withoutSegments(claims: readonly ClaimDraft[]): ClaimDraft[] {
  return claims.map((claim) => {
    const { segments: _segments, ...rest } = claim;
    return { ...rest };
  });
}

describe("B-31 · a consolidated provision claim is judged per segment", () => {
  for (const [label, secondFikra] of [
    ["probe 1 — two fıkra, no cross-reference", FIKRA_2_PLAIN],
    ["probe 2 — fıkra 2 carries a cross-reference number", FIKRA_2_CROSSREF],
  ] as const) {
    it(`${label}: SUPPORTED and finalizable`, async () => {
      const pack = await provisionPack(secondFikra);
      const drafts = await new RuleBasedDrafter().draftClaims({
        question: QUESTION,
        pack,
      });
      // One consolidated claim over BOTH fıkra — the shape that used to fail.
      expect(drafts).toHaveLength(1);
      const claim = drafts[0] as ClaimDraft;
      expect(claim.evidenceIds).toHaveLength(2);
      expect(claim.segments).toHaveLength(2);

      const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
        now: NOW,
      });
      const verified = doc.claims[0];
      expect(verified?.entailmentAggregation).toBe("segments");
      expect(verified?.claim.confidence.entailment).toBeGreaterThanOrEqual(
        ENTAILMENT_THRESHOLD,
      );
      expect(verified?.verdict).toBe("SUPPORTED");
      expect(doc.status).toBe("COMPLETE");
      expect(doc.finalizable).toBe(true);
      expect(doc.reasons.join(" ")).not.toContain("ENTAILMENT_BELOW_THRESHOLD");
    });

    it(`${label}: the pre-W14 aggregation still fails on the same fixture`, async () => {
      // Non-vacuity. Same pack, same claim text, attribution removed and a
      // judge with no set aggregation: this is exactly what ran before W14.
      const pack = await provisionPack(secondFikra);
      const drafts = withoutSegments(
        await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack }),
      );
      const doc = await verifyAnswer(QUESTION, pack, drafts, new MaxOnlyEntailmentPort(), {
        now: NOW,
      });
      const verified = doc.claims[0];
      expect(verified?.entailmentAggregation).toBe("max");
      expect(verified?.claim.confidence.entailment).toBeLessThan(ENTAILMENT_THRESHOLD);
      expect(doc.reasons.join(" ")).toContain("ENTAILMENT_BELOW_THRESHOLD");
    });
  }

  it("the threshold itself did not move", () => {
    expect(ENTAILMENT_THRESHOLD).toBe(0.85);
  });

  it("keeps every per-passage judgement as the reader's audit trail", async () => {
    const pack = await provisionPack(FIKRA_2_PLAIN);
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.claims[0]?.entailments).toHaveLength(2);
    for (const entry of doc.claims[0]?.entailments ?? []) {
      expect(entry.judgement.rationale).toContain("lexical-v0");
    }
  });
});

describe("B-31 · a single-passage claim is unchanged", () => {
  it("still scores 1.000 through the unchanged max path", async () => {
    const text = documentText(FIKRA_2_PLAIN);
    const span = spanOf(text, FIKRA_1);
    const pack = await buildEvidencePack(
      [
        makeCandidate({
          documentId: "doc-5237",
          documentVersionId: VERSION_ID,
          chunkId: "chunk-157-1",
          source: "MEVZUAT",
          sourceUrl: "https://example.invalid/fixture/5237",
          title: "Türk Ceza Kanunu (SENTETİK)",
          legislationNo: "5237",
          article: "157",
          effectiveFrom: "2005-06-01",
          ...span,
        }),
      ],
      new MapTextPort(new Map([[VERSION_ID, text]])),
      { asOf: AS_OF, now: NOW },
    );
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.claims[0]?.entailmentAggregation).toBe("max");
    expect(doc.claims[0]?.claim.confidence.entailment).toBe(1);
    expect(doc.claims[0]?.verdict).toBe("SUPPORTED");
  });
});

describe("B-31 · unsegmented claims", () => {
  async function twoPassagePack() {
    return provisionPack(FIKRA_2_PLAIN);
  }

  it("a rule-based unsegmented claim is judged over the union of its passages", async () => {
    const pack = await twoPassagePack();
    const drafts = withoutSegments(
      await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack }),
    );
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
      drafter: "rule-based",
    });
    expect(doc.claims[0]?.entailmentAggregation).toBe("set");
    expect(doc.claims[0]?.claim.confidence.entailment).toBeGreaterThanOrEqual(
      ENTAILMENT_THRESHOLD,
    );
  });

  it("a CLOUD unsegmented claim keeps max and says so", async () => {
    const pack = await twoPassagePack();
    const drafts = withoutSegments(
      await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack }),
    );
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
      drafter: "cloud",
    });
    expect(doc.claims[0]?.entailmentAggregation).toBe("max");
    expect(doc.reasons.join(" ")).toContain(ENTAILMENT_UNSEGMENTED_CLOUD_CLAIM);
  });

  it("reports a citation that carries nothing the others do not (anti-padding)", async () => {
    // A third passage of the same provision whose words are a strict subset of
    // fıkra 1's: adding it to the citation list must not buy the claim
    // anything, and the answer says which citation was padding.
    const text = documentText(FIKRA_2_PLAIN);
    const padding = "kendisine veya başkasına bir yarar sağlayan kişi";
    const base = {
      documentId: "doc-5237",
      documentVersionId: VERSION_ID,
      source: "MEVZUAT",
      sourceUrl: "https://example.invalid/fixture/5237",
      title: "Türk Ceza Kanunu (SENTETİK)",
      legislationNo: "5237",
      article: "157",
      effectiveFrom: "2005-06-01",
    };
    const pack = await buildEvidencePack(
      [
        makeCandidate({ ...base, chunkId: "chunk-157-1", ...spanOf(text, FIKRA_1) }),
        makeCandidate({ ...base, chunkId: "chunk-157-2", ...spanOf(text, FIKRA_2_PLAIN) }),
        makeCandidate({ ...base, chunkId: "chunk-157-pad", ...spanOf(text, padding) }),
      ],
      new MapTextPort(new Map([[VERSION_ID, text]])),
      { asOf: AS_OF, now: NOW },
    );
    const drafts = withoutSegments(
      await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack }),
    );
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
      drafter: "rule-based",
    });
    const padId = pack.items[2]?.ref.evidenceId as string;
    expect(doc.reasons.join(" ")).toContain(`UNUSED_CITATION:${doc.claims[0]?.claim.claimId}:${padId}`);
  });
});

describe("B-31 · the rule-based entailment axis is declared unmeasured", () => {
  it("marks a rule-based claim entailmentMeasured:false", async () => {
    const pack = await provisionPack(FIKRA_2_PLAIN);
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.claims[0]?.entailmentMeasured).toBe(false);
  });

  it("marks a cloud-drafted claim entailmentMeasured:true", async () => {
    const pack = await provisionPack(FIKRA_2_PLAIN);
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
      drafter: "cloud",
    });
    expect(doc.claims[0]?.entailmentMeasured).toBe(true);
  });
});

describe("B-31 · assessSet keeps the number rule a hard failure", () => {
  it("a claim naming a number no cited passage carries still fails", async () => {
    const pack = await provisionPack(FIKRA_2_PLAIN);
    const port = new LexicalEntailmentPort();
    const judgement: EntailmentJudgement = await (
      port.assessSet as NonNullable<EntailmentPort["assessSet"]>
    )(
      "5237 sayılı Kanun m. 157: bu suçun cezası 9999 sayılı Kanunla artırılmıştır.",
      pack.items.map((item) => item.ref),
    );
    expect(judgement.entails).toBe(false);
    expect(judgement.score).toBeLessThanOrEqual(0.2);
    expect(judgement.rationale).toContain("9999");
  });
});

describe("B-31 · a shared YEAR is not a shared issue (addressesSameIssue)", () => {
  const CONTRARY_TEXT_YEAR =
    "Sentetik Bölge Adliye Mahkemesi kararı (SENTETİK).\n" +
    "Taraflar arasındaki kira ilişkisi 2019 yılında kurulmuş olup, tahliye " +
    "talebinin reddine karar verilmiştir.";
  const CONTRARY_TEXT_SAME_ISSUE =
    "Sentetik Bölge Adliye Mahkemesi kararı (SENTETİK).\n" +
    "Somut olayda TCK m. 157 uygulanamaz; hileli davranış unsuru " +
    "gerçekleşmemiştir.";

  async function packWithContrary(contraryText: string, contraryQuote: string) {
    const text = documentText(FIKRA_2_PLAIN);
    const provision = {
      documentId: "doc-5237",
      documentVersionId: VERSION_ID,
      source: "MEVZUAT",
      sourceUrl: "https://example.invalid/fixture/5237",
      title: "Türk Ceza Kanunu (SENTETİK)",
      legislationNo: "5237",
      article: "157",
      effectiveFrom: "2005-06-01",
    };
    const contraryVersion = "docv-bam-1";
    return buildEvidencePack(
      [
        makeCandidate({ ...provision, chunkId: "chunk-157-1", ...spanOf(text, FIKRA_1) }),
        makeCandidate({
          documentId: "doc-bam",
          documentVersionId: contraryVersion,
          chunkId: "chunk-bam-1",
          source: "BEDESTEN",
          sourceUrl: "https://example.invalid/fixture/bam",
          title: "BAM kararı (SENTETİK)",
          court: "Sentetik Bölge Adliye Mahkemesi",
          docketNo: "2024/7",
          decisionNo: "2024/9",
          decisionDate: "2024-05-01",
          stance: "contrary",
          ...spanOf(contraryText, contraryQuote),
        }),
      ],
      new MapTextPort(
        new Map([
          [VERSION_ID, text],
          [contraryVersion, contraryText],
        ]),
      ),
      { asOf: AS_OF, now: NOW },
    );
  }

  it("does NOT conflict a TCK m.157 claim with a passage that only shares a year", async () => {
    // Measured 02.09.2026 (ARCH W3 / DAILYFLOW): `extractNumbers` returned every
    // digit run, so any shared year or amount linked a claim to a "contrary"
    // passage — TCK m.168 (etkin pişmanlık) was declared to conflict with a
    // kapora decision on nothing more than that.
    const quote = CONTRARY_TEXT_YEAR.split("\n").slice(1).join("\n");
    const pack = await packWithContrary(CONTRARY_TEXT_YEAR, quote);
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.claims[0]?.contraryEvidenceIds).toEqual([]);
    expect(doc.reasons.join(" ")).not.toContain("CONFLICTING_AUTHORITIES");
  });

  it("DOES conflict it with a passage that cites the same provision", async () => {
    // Non-vacuity: the mechanism still links a real conflict.
    const quote = CONTRARY_TEXT_SAME_ISSUE.split("\n").slice(1).join("\n");
    const pack = await packWithContrary(CONTRARY_TEXT_SAME_ISSUE, quote);
    const drafts = await new RuleBasedDrafter().draftClaims({ question: QUESTION, pack });
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
    });
    expect(doc.claims[0]?.contraryEvidenceIds.length).toBe(1);
    expect(doc.reasons.join(" ")).toContain("CONFLICTING_AUTHORITIES");
  });

  it("a passage does NOT conflict with a claim drafted FROM that same decision", async () => {
    // W14 L-FIX, regression for the live-research contract break.
    //
    // History (W14-L-SOURCES.md 11.1, W14-L-ANSWER.md 8.6): B-31's first
    // version added the contrary passage's OWN E./K. to its issue tokens.
    // A decision number identifies the DOCUMENT, not the issue, so a claim
    // that CITES a decision — which is what a research answer does — was
    // linked as "conflicting" with every other chunk of that same decision.
    // Measured 02.09.2026: four live-research claims against three passages
    // of the decision they were drafted from, turning the happy path of
    // tests/research/{researchService,routes}.test.ts from COMPLETE into
    // QUALIFIED / CONFLICTING_AUTHORITIES.
    //
    // The claim is built by hand rather than by the drafter, because the
    // mechanism needs exactly this shape: a claim whose TEXT carries the
    // künye of the decision the contrary passage IS. NON-VACUITY was
    // verified by re-adding the metadata E./K. to `evidenceReferenceTokens`
    // and watching this test go red (02.09.2026).
    // The contrary passage shares NO provision with the claim — only the
    // decision it IS. That isolates the rule under test: a legislation token
    // in common would link the two for a real and different reason (the test
    // above covers that case).
    const quote = CONTRARY_TEXT_YEAR.split("\n").slice(1).join("\n");
    const pack = await packWithContrary(CONTRARY_TEXT_YEAR, quote);
    const provision = pack.items.find((item) => item.stance !== "contrary");
    const contrary = pack.items.find((item) => item.stance === "contrary");
    // Precondition: the passage carries its own E./K. in METADATA, and the
    // quoted text itself does not repeat it.
    expect(contrary?.ref.docketNo).toBe("2024/7");
    expect(contrary?.ref.decisionNo).toBe("2024/9");
    expect(contrary?.ref.quote).not.toContain("2024/9");

    // The claim cites that decision, exactly as a research answer would.
    const drafts = [
      {
        claimId: "c-own-kunye",
        text:
          "Sentetik Bölge Adliye Mahkemesi E. 2024/7, K. 2024/9 kararında" +
          " tahliye talebi bakımından değerlendirme yapılmıştır.",
        material: true,
        evidenceIds: [provision!.ref.evidenceId],
        treatment: "supported" as const,
        confidence: {
          retrieval: 1,
          entailment: 1,
          authority: 1,
          currentness: 1,
          coverage: 1,
        },
      },
    ];
    const doc = await verifyAnswer(QUESTION, pack, drafts, new LexicalEntailmentPort(), {
      now: NOW,
      // Only the reference rule may link here; the lexical fallback would
      // link on shared words and hide what is being measured.
      conflictOverlapFloor: 1.01,
    });
    expect(doc.claims[0]?.contraryEvidenceIds).toEqual([]);
    expect(doc.reasons.join(" ")).not.toContain("CONFLICTING_AUTHORITIES");
  });
});
