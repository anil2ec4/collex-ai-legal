/**
 * W21 #22 (residual) — a judgement that never happened is not a measured
 * shortfall.
 *
 * THE DEFECT. When the entailment judge failed (a local model that is down,
 * timing out, answering HTTP 500 or unreadable JSON), the pipeline's safe
 * wrapper scored the pair 0 and recorded ENTAILMENT_PORT_FAILED on the answer.
 * The verifier then read that 0 like any other score and gave the claim
 * ENTAILMENT_BELOW_THRESHOLD, which the console renders as "Bir tespitte pasaj
 * desteği eşiğin altında kaldı" and the exported markdown lists as the reason.
 * A lawyer read "the passages were checked and fell short" for a check that
 * never ran.
 *
 * THE RULE pinned here. A judgement marked `markEntailmentNotChecked` gives
 * the claim ENTAILMENT_NOT_CHECKED instead. ENTAILMENT_BELOW_THRESHOLD stays
 * only where a judgement that DID happen already measured the shortfall on
 * its own. Nothing finalizes either way: the gate (0.85) does not move, and a
 * not-checked claim is never finalizable.
 */

import { describe, expect, it } from "vitest";

import { buildEvidencePack } from "../../src/answer/evidencePack.js";
import {
  ENTAILMENT_NOT_CHECKED,
  isEntailmentNotChecked,
  markEntailmentNotChecked,
  verifyAnswer,
} from "../../src/answer/verifier.js";
import type { ClaimDraft } from "../../src/evidence/types.js";
import type { EntailmentJudgement, EntailmentPort } from "../../src/llm/ports.js";
import { ENTAILMENT_THRESHOLD } from "../../src/verification/finalize.js";
import {
  AS_OF,
  MapTextPort,
  standardTexts,
  tckCandidate,
  yargitayCandidate,
} from "./fixtures.js";

const NOW = (): string => "2026-09-17T00:00:00Z";
const QUESTION = "Kasten öldürme suçunun temel cezası nedir?";
const CLAIM_TEXT = "Kasten öldürmenin temel cezası müebbet hapistir.";

/** What the judge does for one call: a score it measured, or a failure. */
type Outcome = number | "fail";
type Script = (claimText: string, evidenceIds: readonly string[]) => Outcome;

/**
 * A judge driven by a script. A failure is returned the way the pipeline's
 * safe wrapper returns it: score 0, marked as not checked.
 */
function scriptedJudge(script: Script, options: { set?: boolean } = {}): EntailmentPort {
  const judge = (claimText: string, evidenceIds: readonly string[]): EntailmentJudgement => {
    const outcome = script(claimText, evidenceIds);
    return outcome === "fail"
      ? markEntailmentNotChecked({ entails: false, score: 0, rationale: "denetlenemedi (arıza)" })
      : { entails: outcome >= ENTAILMENT_THRESHOLD, score: outcome, rationale: "ölçüldü" };
  };
  return {
    async assess(claimText, evidence) {
      return judge(claimText, [evidence.evidenceId]);
    },
    ...(options.set === true
      ? {
          async assessSet(claimText: string, evidence: readonly { evidenceId: string }[]) {
            return judge(
              claimText,
              evidence.map((ref) => ref.evidenceId),
            );
          },
        }
      : {}),
  } as EntailmentPort;
}

async function twoPassagePack() {
  const pack = await buildEvidencePack(
    [tckCandidate(), yargitayCandidate()],
    new MapTextPort(standardTexts()),
    { asOf: AS_OF, now: NOW },
  );
  const [first, second] = pack.items.map((item) => item.ref.evidenceId);
  if (first === undefined || second === undefined) throw new Error("fixture pack lost a passage");
  return { pack, first, second };
}

function claim(overrides: Partial<ClaimDraft> & Pick<ClaimDraft, "evidenceIds">): ClaimDraft {
  return {
    claimId: "c1",
    text: CLAIM_TEXT,
    material: true,
    treatment: "supported",
    confidence: { retrieval: 0, entailment: 0, authority: 0, currentness: 0, coverage: 0 },
    ...overrides,
  };
}

/** Only the two entailment reasons this file is about, in recorded order. */
const entailmentReasons = (reasons: readonly string[]): string[] =>
  reasons.filter(
    (reason) =>
      reason.startsWith("ENTAILMENT_BELOW_THRESHOLD:") || reason.startsWith(`${ENTAILMENT_NOT_CHECKED}:`),
  );

const NOT_CHECKED = `${ENTAILMENT_NOT_CHECKED}:c1`;
const BELOW = "ENTAILMENT_BELOW_THRESHOLD:c1";

describe("W21 #22 · one passage", () => {
  it("a judge that failed: the claim is 'not checked', never 'below threshold', and nothing finalizes", async () => {
    const { pack, first } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first] })],
      scriptedJudge(() => "fail"),
      { now: NOW, drafter: "local" },
    );
    const verified = doc.claims[0];
    expect(verified).toBeDefined();
    expect(entailmentReasons(verified?.reasons ?? [])).toEqual([NOT_CHECKED]);
    expect(entailmentReasons(doc.reasons)).toEqual([NOT_CHECKED]);
    expect(doc.reasons.join(" ")).not.toContain("ENTAILMENT_BELOW_THRESHOLD");
    // The safe score stays 0 and still blocks finalization.
    expect(verified?.claim.confidence.entailment).toBe(0);
    // A number nobody measured is not reported as measured.
    expect(verified?.entailmentMeasured).toBe(false);
    expect(doc.finalizable).toBe(false);
    expect(doc.status).not.toBe("COMPLETE");
  });

  it("non-vacuity: the same claim with a judge that answered short is a measured shortfall", async () => {
    const { pack, first } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first] })],
      scriptedJudge(() => 0.2),
      { now: NOW, drafter: "local" },
    );
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([BELOW]);
    expect(doc.claims[0]?.entailmentMeasured).toBe(true);
    expect(doc.finalizable).toBe(false);
  });

  it("a judge that really answered 0 is measured; the mark is identity, not a value", async () => {
    const { pack, first } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first] })],
      scriptedJudge(() => 0),
      { now: NOW, drafter: "local" },
    );
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([BELOW]);

    const marked = markEntailmentNotChecked({ entails: false, score: 0, rationale: "x" });
    expect(isEntailmentNotChecked(marked)).toBe(true);
    // A copy with the same fields (e.g. a reply that imitates the failure) is not marked.
    expect(isEntailmentNotChecked({ ...marked })).toBe(false);
  });
});

describe("W21 #22 · several passages, no segments (largest score)", () => {
  it("one failed, the other measured short: 'not checked' only — the missing one might have carried it", async () => {
    const { pack, first, second } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first, second] })],
      scriptedJudge((_text, ids) => (ids[0] === first ? "fail" : 0.3)),
      { now: NOW, drafter: "local" },
    );
    expect(doc.claims[0]?.entailmentAggregation).toBe("max");
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([NOT_CHECKED]);
    expect(doc.finalizable).toBe(false);
  });

  it("one failed, the other measured above the threshold: the measured one settles it", async () => {
    const { pack, first, second } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first, second] })],
      scriptedJudge((_text, ids) => (ids[0] === first ? "fail" : 0.95)),
      { now: NOW, drafter: "local" },
    );
    expect(doc.claims[0]?.claim.confidence.entailment).toBe(0.95);
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([]);
  });

  it("both measured short: a measured shortfall", async () => {
    const { pack, first, second } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first, second] })],
      scriptedJudge((_text, ids) => (ids[0] === first ? 0.3 : 0.4)),
      { now: NOW, drafter: "local" },
    );
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([BELOW]);
  });
});

describe("W21 #22 · segments (smallest part)", () => {
  const segmented = (first: string, second: string) =>
    claim({
      evidenceIds: [first, second],
      text: "Kasten öldürme müebbet hapisle cezalandırılır. Temel ceza müebbettir.",
      segments: [
        { text: "Kasten öldürme müebbet hapisle cezalandırılır.", evidenceIds: [first] },
        { text: "Temel ceza müebbettir.", evidenceIds: [second] },
      ],
    });

  it("one part not checked, the other measured short: both facts are reported", async () => {
    const { pack, first, second } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [segmented(first, second)],
      scriptedJudge((text) => (text.startsWith("Kasten öldürme müebbet") ? "fail" : text.startsWith("Temel") ? 0.3 : 0.5)),
      { now: NOW, drafter: "local" },
    );
    expect(doc.claims[0]?.entailmentAggregation).toBe("segments");
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([NOT_CHECKED, BELOW]);
  });

  it("one part not checked, the other measured above the threshold: 'not checked' only", async () => {
    const { pack, first, second } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [segmented(first, second)],
      scriptedJudge((text) => (text.startsWith("Kasten öldürme müebbet") ? "fail" : text.startsWith("Temel") ? 0.95 : 0.5)),
      { now: NOW, drafter: "local" },
    );
    expect(doc.claims[0]?.claim.confidence.entailment).toBe(0);
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([NOT_CHECKED]);
    expect(doc.finalizable).toBe(false);
  });
});

describe("W21 #22 · rule-based claim judged over the set of its passages", () => {
  it("the set judgement failed: 'not checked', even though every single-passage judgement answered", async () => {
    const { pack, first, second } = await twoPassagePack();
    const doc = await verifyAnswer(
      QUESTION,
      pack,
      [claim({ evidenceIds: [first, second] })],
      scriptedJudge((_text, ids) => (ids.length > 1 ? "fail" : 0.5), { set: true }),
      { now: NOW, drafter: "rule-based" },
    );
    expect(doc.claims[0]?.entailmentAggregation).toBe("set");
    expect(entailmentReasons(doc.claims[0]?.reasons ?? [])).toEqual([NOT_CHECKED]);
  });

  it("the threshold did not move", () => {
    expect(ENTAILMENT_THRESHOLD).toBe(0.85);
  });
});
