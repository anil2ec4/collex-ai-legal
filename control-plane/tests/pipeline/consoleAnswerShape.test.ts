import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { answerShapeNotFoundTr } from "../../src/answer/answerShape.js";

/**
 * W23: the console turns ANSWER_SHAPE_NOT_FOUND:<KIND> into the SAME sentence
 * the server writes, so the raw code never stands alone and the markdown and
 * the screen agree word for word.
 */
const html = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");

it("draws the server's own sentence for every answer-shape kind", () => {
  const start = html.indexOf("  var ANSWER_SHAPE_TR = {");
  const end = html.indexOf("  /* HTTP hata gövdelerindeki kind alanı");
  const ctx: Record<string, unknown> = { String, WARN_PATTERNS: [], TIME_BUDGET_AFTER_DRAFT_TEXT: "", out: null };
  runInNewContext(
    html.slice(start, end) +
      '\nout = ["DATE","AMOUNT","DURATION","QUANTITY","PERSON","COURT"].map(function (k) { return warnTR("ANSWER_SHAPE_NOT_FOUND:" + k); });',
    ctx,
  );
  const out = (ctx["out"] ?? []) as Array<{ text: string; raw: string }>;
  const kinds = ["DATE", "AMOUNT", "DURATION", "QUANTITY", "PERSON", "COURT"] as const;
  expect(start).toBeGreaterThan(-1);
  kinds.forEach((k, i) => {
    expect(out[i]?.text).toBe(answerShapeNotFoundTr(k));
    expect(out[i]?.raw).toBe(`ANSWER_SHAPE_NOT_FOUND:${k}`);
  });
});
