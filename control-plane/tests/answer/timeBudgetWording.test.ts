/**
 * W21 · a time budget that ran out AFTER drafting is not "drafting and
 * verification left incomplete".
 *
 * THE DEFECT. The answer pipeline checks its wall budget before drafting (the
 * drafter is skipped, no claim exists) and again after drafting (the claims
 * are kept and still go through verification). Both runs carry the same
 * reason code, TIME_BUDGET_EXCEEDED, and the markdown rendered it as "Cevap
 * süre bütçesini aştı; tespit yazımı ve doğrulama eksik bırakıldı" either way.
 * For the second run that sentence is untrue: the claims were written and
 * verified, each with its own verdict on the page.
 *
 * THE RULE pinned here. The reason code stays TIME_BUDGET_EXCEEDED (the
 * review-table worker reads it and keeps a drafted, verified answer). The
 * sentence follows what happened: TIME_BUDGET_AFTER_DRAFT_TR when the answer
 * carries a drafted claim, TIME_BUDGET_BEFORE_DRAFT_TR when it does not.
 * Runs the real AnswerPipeline, with a clock the drafter itself advances.
 */

import { describe, expect, it } from "vitest";

import {
  TIME_BUDGET_AFTER_DRAFT_TR,
  TIME_BUDGET_BEFORE_DRAFT_TR,
  renderReason,
} from "../../src/answer/renderer.js";
import type { DrafterInput, DrafterPort } from "../../src/llm/ports.js";
import { RuleBasedDrafter } from "../../src/llm/ruleDrafter.js";
import {
  AnswerPipeline,
  DEFAULT_ANSWER_TIME_BUDGET_MS,
  TIME_BUDGET_EXCEEDED_AFTER_DRAFT_MESSAGE_TR,
  TIME_BUDGET_EXCEEDED_MESSAGE_TR,
} from "../../src/pipeline/answerPipeline.js";
import { isIncompleteAnswer } from "../../src/reviewTables/worker.js";
import {
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  StubCorpus,
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  standardTexts,
} from "../pipeline/fakes.js";

const INCOMPLETE = "tespit yazımı ve doğrulama eksik bırakıldı";

/** A clock only the test moves; every stage reads the same instant. */
function manualClock() {
  const clock = { now: 0 };
  return { clock, monotonic: () => clock.now };
}

/** The rule-based drafter, slowed down: drafting itself eats the budget. */
function slowDrafter(clock: { now: number }): DrafterPort {
  const inner = new RuleBasedDrafter();
  return {
    draftClaims: async (input: DrafterInput) => {
      const claims = await inner.draftClaims(input);
      clock.now += DEFAULT_ANSWER_TIME_BUDGET_MS + 10_000;
      return claims;
    },
  } as DrafterPort;
}

describe("W21 · TIME_BUDGET_EXCEEDED wording follows whether the claims were drafted", () => {
  it("the budget ran out after drafting: claims kept and verified, the markdown never says drafting was left incomplete", async () => {
    const { clock, monotonic } = manualClock();
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      monotonic,
      drafter: slowDrafter(clock),
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    // The run the defect was about: the post-draft budget check fired.
    expect(result.reasons).toContain("TIME_BUDGET_EXCEEDED");
    expect(result.warnings.some((w) => w.startsWith("TIME_BUDGET_EXCEEDED:"))).toBe(true);
    expect(result.trace.some((s) => s.notes.includes("SKIPPED_TIME_BUDGET_EXCEEDED"))).toBe(false);
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.status).toBe("PARTIAL");
    expect(result.finalizable).toBe(false);

    // The sentence says what happened; the machine code is still printed.
    expect(result.markdown).toContain(`${TIME_BUDGET_AFTER_DRAFT_TR} (TIME_BUDGET_EXCEEDED)`);
    expect(result.markdown).not.toContain(INCOMPLETE);
    // The code the review-table worker reads is unchanged, and it keeps this answer.
    expect(isIncompleteAnswer(result)).toBe(false);
  });

  it("non-vacuity: the budget ran out before drafting: no claim, and the 'left incomplete' sentence stays", async () => {
    const { clock, monotonic } = manualClock();
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => {
        clock.now += DEFAULT_ANSWER_TIME_BUDGET_MS + 10_000;
        return ok([hitTck("v1")]);
      }),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      monotonic,
    });
    const { result } = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(result.reasons).toContain("TIME_BUDGET_EXCEEDED");
    expect(result.trace.some((s) => s.notes.includes("SKIPPED_TIME_BUDGET_EXCEEDED"))).toBe(true);
    expect(result.claims).toEqual([]);
    expect(result.markdown).toContain(`${TIME_BUDGET_BEFORE_DRAFT_TR} (TIME_BUDGET_EXCEEDED)`);
    expect(result.markdown).not.toContain(TIME_BUDGET_AFTER_DRAFT_TR);
    expect(isIncompleteAnswer(result)).toBe(true);
  });

  it("renderReason: only TIME_BUDGET_EXCEEDED (bare or with a subject) reads the context", () => {
    expect(renderReason("TIME_BUDGET_EXCEEDED")).toBe(`${TIME_BUDGET_BEFORE_DRAFT_TR} (TIME_BUDGET_EXCEEDED)`);
    expect(renderReason("TIME_BUDGET_EXCEEDED", { claimsWritten: false })).toContain(INCOMPLETE);
    expect(renderReason("TIME_BUDGET_EXCEEDED", { claimsWritten: true })).toBe(
      `${TIME_BUDGET_AFTER_DRAFT_TR} (TIME_BUDGET_EXCEEDED)`,
    );
    // (the subject's ">" is escaped by escapeInline, so compare the leading part)
    expect(
      renderReason("TIME_BUDGET_EXCEEDED:61000ms>60000ms", { claimsWritten: true }).startsWith(
        `${TIME_BUDGET_AFTER_DRAFT_TR} (TIME_BUDGET_EXCEEDED:61000ms`,
      ),
    ).toBe(true);
    for (const other of ["RETRIEVAL_DEGRADED", "DRAFTER_DEGRADED", "ENTAILMENT_NOT_CHECKED:claim-1"]) {
      expect(renderReason(other, { claimsWritten: true })).toBe(renderReason(other));
    }
    expect(TIME_BUDGET_AFTER_DRAFT_TR).not.toContain("eksik bırakıldı");
    expect(TIME_BUDGET_AFTER_DRAFT_TR).toContain("KISMİ");
  });

  it("the pipeline's budget messages say the same as the markdown reasons", () => {
    expect(TIME_BUDGET_EXCEEDED_MESSAGE_TR.startsWith(`${TIME_BUDGET_BEFORE_DRAFT_TR} — `)).toBe(true);
    expect(TIME_BUDGET_EXCEEDED_AFTER_DRAFT_MESSAGE_TR).toBe(`${TIME_BUDGET_AFTER_DRAFT_TR}.`);
  });
});
