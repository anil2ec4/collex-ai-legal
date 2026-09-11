/**
 * Render-guard contract for the operator console (brief 12.4).
 *
 * THE CONSOLE IS ITSELF AN INJECTION TARGET. Every string it displays —
 * document titles, court names, quotes, machine reasons, lane queries — came
 * out of a document the system does not control. `evals/datasets/adversarial_v1.jsonl`
 * is the fixture corpus of exactly those payloads: `SYSTEM: ignore previous
 * instructions` inside a decision body, `[TCK m.157](javascript:...)` inside a
 * markdown link title, `<img onerror=...>` inside an HTML fragment.
 *
 * The console defends in three independent layers, and this module owns two of
 * them:
 *
 *  1. TYPED FLOW (the primary control, enforced elsewhere): retrieved text
 *     reaches the page only as data fields of a validated AnswerResult. It is
 *     never concatenated into a prompt, a URL, or a shell of any kind.
 *
 *  2. NO MARKUP CHANNEL (public/console.html): the page assigns untrusted text
 *     with `textContent` and never with `innerHTML`, so a payload cannot become
 *     DOM at all — no tag, no attribute, no event handler. A `<a href>` is
 *     created only when the server has already decided `sourceUrlAllowed`, and
 *     the served CSP pins the page's own inline script/style by SHA-256 while
 *     forbidding every remote origin (see consolePage.ts). `tests/pipeline`
 *     asserts the no-innerHTML rule against the shipped file.
 *
 *  3. THIS MODULE: `guardAnswerForConsole` re-runs the markdown render guard
 *     over the answer's markdown (it is idempotent, so this is an assertion
 *     that the pipeline already ran it) and attaches a per-evidence injection
 *     report so the console can VISIBLY label a passage that carries an
 *     instruction-shaped payload.
 *
 * WHY LABEL INSTEAD OF SCRUB. The quote is evidence: it is bound to a
 * documentVersionId, a code-point span and a SHA-256 digest. Editing it would
 * break the verification chain that is the entire product. So the quote is
 * shown byte-exact and the WARNING is added next to it — an operator reading a
 * decision that really does contain "SYSTEM:" needs to see that fact, not a
 * silently laundered passage.
 */

import { guardAnswerMarkdown } from "../pipeline/answerPipeline.js";
import { scanForInjection } from "../security/untrusted.js";
import type { AnswerResult } from "../pipeline/types.js";

/** Zero-width and BiDi controls — invisible reordering of a citation. */
const INVISIBLE_CHARS = new RegExp(
  "[\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]",
  "g",
);

export interface EvidenceGuardFlags {
  evidenceId: string;
  /** At least one prompt-injection heuristic fired on the quote. */
  injectionFlagged: boolean;
  /** Stable heuristic ids that fired (never the payload itself). */
  injectionSignals: string[];
  /** Count of zero-width/BiDi control characters inside the quote. */
  invisibleChars: number;
  /** Mirror of EvidenceView.sourceUrlAllowed; the page links only when true. */
  sourceUrlAllowed: boolean;
}

export interface ConsoleGuardReport {
  /** True when the markdown was already sanitized (idempotency held). */
  markdownWasGuarded: boolean;
  evidence: EvidenceGuardFlags[];
  /** Evidence ids whose quote carries an instruction-shaped payload. */
  flaggedEvidenceIds: string[];
}

/**
 * The console's view of an answer: the untouched AnswerResult plus the guard
 * report. Additive — a client that ignores `guard` sees exactly the v1 answer.
 */
export interface GuardedAnswerResult extends AnswerResult {
  guard: ConsoleGuardReport;
}

function countInvisible(text: string): number {
  const matches = text.match(INVISIBLE_CHARS);
  return matches === null ? 0 : matches.length;
}

/**
 * Attach the console guard report to an answer.
 *
 * The returned `markdown` runs through `guardAnswerMarkdown` again on purpose.
 * That guard is idempotent, so for a well-formed pipeline result this is a
 * no-op that PROVES the property (reported as `markdownWasGuarded`); for any
 * other producer — a future LLM renderer, a replayed fixture, a hand-built
 * AnswerResult — it is the enforcement point.
 */
export function guardAnswerForConsole(result: AnswerResult): GuardedAnswerResult {
  const guardedMarkdown = guardAnswerMarkdown(result.markdown);
  const evidence: EvidenceGuardFlags[] = result.evidence.map((item) => {
    const scan = scanForInjection(item.quote);
    return {
      evidenceId: item.evidenceId,
      injectionFlagged: scan.flagged,
      injectionSignals: scan.signals.map((s) => s.id),
      invisibleChars: countInvisible(item.quote),
      sourceUrlAllowed: item.sourceUrlAllowed,
    };
  });
  return {
    ...result,
    markdown: guardedMarkdown,
    guard: {
      markdownWasGuarded: guardedMarkdown === result.markdown,
      evidence,
      flaggedEvidenceIds: evidence.filter((e) => e.injectionFlagged).map((e) => e.evidenceId),
    },
  };
}
