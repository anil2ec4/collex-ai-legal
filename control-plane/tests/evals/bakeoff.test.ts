/**
 * W20 bake-off harness: scoring, case validation and honesty labels.
 *
 * Driven by SCRIPTED generators (test doubles): a "careful" one that answers
 * every case correctly with exact quotes and a "sloppy" one that re-flows
 * whitespace in its quotes and guesses labels. No real model is called; this
 * proves the harness measures what it says it measures.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCases, renderBakeoffMarkdown, runBakeoff, type BakeoffCase } from "../../src/evals/bakeoff.js";
import type { JsonGenerator } from "../../src/exhaustive/modelExtractor.js";
import type { GenerateJsonRequest } from "../../src/llm/localGenerationAdapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_FILE = resolve(HERE, "..", "..", "..", "evals", "bakeoff", "cases.synthetic.jsonl");

function byId(cases: readonly BakeoffCase[]): Map<string, BakeoffCase> {
  return new Map(cases.map((testCase) => [testCase.id, testCase]));
}

/** Answers from the gold labels; `sloppy` breaks quotes and flips labels. */
function scripted(name: string, cases: readonly BakeoffCase[], sloppy: boolean): JsonGenerator {
  const index = byId(cases);
  const current = (request: GenerateJsonRequest): BakeoffCase | undefined =>
    [...index.values()].find((testCase) =>
      (testCase.unitText !== undefined && request.untrustedText === testCase.unitText) ||
      (testCase.left !== undefined && request.untrustedText === `[1] ${testCase.left}
[2] ${testCase.right}`) ||
      (testCase.passage !== undefined && request.untrustedText === testCase.passage) ||
      (testCase.prompt !== undefined && request.instruction === testCase.prompt),
    );
  return {
    model: name,
    trust: "LOCAL_PROCESS",
    async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
      const testCase = current(request);
      if (testCase === undefined) throw new Error("scripted model got an unknown case");
      switch (testCase.task) {
        case "extraction":
          return {
            items: (testCase.goldItems ?? []).map((item) => ({
              kind: item.kind,
              text: item.quote,
              quote: sloppy ? item.quote.replace(/ /gu, "  ") : item.quote,
            })),
          } as T;
        case "contradiction":
          return { relation: sloppy ? "INDEPENDENT" : testCase.goldRelation } as T;
        case "entailment":
          return { entails: sloppy ? true : testCase.goldEntails, score: 0.9, rationale: "betik" } as T;
        case "terminology":
          return { text: sloppy ? "Kısa bir cevap." : (testCase.requiredTerms ?? []).join(" ") } as T;
        default:
          return (sloppy
            ? { ...Object.fromEntries((testCase.expectKeys ?? []).map((key) => [key, "x"])), fazla: 1 }
            : Object.fromEntries((testCase.expectKeys ?? []).map((key) => [key, "x"]))) as T;
      }
    },
  };
}

describe("bake-off cases", () => {
  it("the shipped synthetic cases all validate, and every gold quote is in its text", () => {
    const { cases, errors } = parseCases(readFileSync(CASES_FILE, "utf8"));
    expect(errors).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((testCase) => testCase.task))).toEqual(
      new Set(["extraction", "contradiction", "entailment", "terminology", "instruction"]),
    );
    expect(cases.every((testCase) => testCase.source === "synthetic")).toBe(true);
  });

  it("rejects a gold quote that is not in the unit text, and a case missing its fields", () => {
    const bad = [
      JSON.stringify({
        schema: "collex.bakeoff.case/v1", id: "x", task: "extraction", source: "synthetic",
        unitText: "Metin burada.", kinds: ["claim"], goldItems: [{ kind: "claim", quote: "başka metin" }],
      }),
      JSON.stringify({ schema: "collex.bakeoff.case/v1", id: "y", task: "entailment", source: "synthetic", claim: "a" }),
      "not json",
    ].join("\n");
    const { cases, errors } = parseCases(bad);
    expect(cases).toEqual([]);
    expect(errors.length).toBe(3);
  });
});

describe("bake-off scoring", () => {
  const { cases } = parseCases(readFileSync(CASES_FILE, "utf8"));

  it("measures a careful model as careful and a sloppy one as sloppy", async () => {
    const report = await runBakeoff(
      cases,
      [
        { name: "dikkatli", generator: scripted("dikkatli", cases, false) },
        { name: "özensiz", generator: scripted("özensiz", cases, true) },
      ],
      { kind: "measurement", startedAt: "2026-09-11T00:00:00.000Z" },
    );
    const careful = report.models.find((model) => model.model === "dikkatli")!;
    const sloppy = report.models.find((model) => model.model === "özensiz")!;
    expect(careful.metrics["quoteValidity"]).toBe(1);
    expect(careful.metrics["extractionRecall"]).toBe(1);
    expect(careful.metrics["contradictionAccuracy"]).toBe(1);
    expect(careful.metrics["entailmentAccuracy"]).toBe(1);
    expect(careful.metrics["instructionFollowing"]).toBe(1);
    // Re-flowed whitespace is NOT an exact quote: every item is rejected.
    expect(sloppy.metrics["quoteValidity"]).toBe(0);
    expect(sloppy.metrics["extractionRecall"]).toBe(0);
    expect(sloppy.metrics["instructionFollowing"]).toBe(0);
    expect(sloppy.metrics["contradictionAccuracy"]).toBeLessThan(1);
    expect(careful.failureRate).toBe(0);
    expect(report.noticesTr.join(" ")).toContain("sentetiktir");
    expect(report.noticesTr.join(" ")).toContain("kazanan seçmez");
  });

  it("a harness check says it is not a measurement, in the report and the table", async () => {
    const report = await runBakeoff(cases.slice(0, 3), [{ name: "b", generator: scripted("b", cases, false) }], {
      kind: "harness_check",
      startedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(report.kind).toBe("harness_check");
    expect(report.noticesTr[0]).toContain("ÖLÇÜM DEĞİLDİR");
    expect(renderBakeoffMarkdown(report)).toContain("düzenek denetimi — ölçüm değil");
  });

  it("a model that errors is counted as a failure, not as a wrong answer", async () => {
    const broken: JsonGenerator = {
      model: "bozuk",
      trust: "LOCAL_PROCESS",
      async generateJson() {
        throw new Error("uç noktaya ulaşılamadı");
      },
    };
    const report = await runBakeoff(cases.slice(0, 4), [{ name: "bozuk", generator: broken }], {
      kind: "measurement",
      startedAt: "2026-09-11T00:00:00.000Z",
    });
    expect(report.models[0]!.failureRate).toBe(1);
    expect(report.models[0]!.latencyMsP50).toBeNull();
  });
});
