/**
 * W21 bake-off readiness for the semantic contradiction lane.
 *
 * The task must measure what production sends: the request is built by the
 * lane's OWN classificationRequest and the answer checked by its OWN
 * validateClassification (exhaustive/semanticContradictions.ts). Scripted
 * generators stand in for models; no real model is called.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// W21 R2-44: quality figures exist only per case group now (no pooled model-level block); these runs read groups.synthetic.
import {
  parseCases,
  renderBakeoffMarkdown,
  runBakeoff,
  semanticContradictionBatches,
  semanticContradictionInput,
  type BakeoffCase,
} from "../../src/evals/bakeoff.js";
import { classificationRequest, QUOTE_LABEL_TR, STATEMENT_LABEL_TR } from "../../src/exhaustive/semanticContradictions.js";
import type { JsonGenerator } from "../../src/exhaustive/modelExtractor.js";
import { LocalGenerationError, type GenerateJsonRequest } from "../../src/llm/localGenerationAdapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SEMANTIC_FILE = join(REPO_ROOT, "evals", "bakeoff", "cases.semantic.synthetic.jsonl");
const CLI = join(REPO_ROOT, "control-plane", "scripts", "bakeoff.mjs");
const STARTED = "2026-09-11T00:00:00.000Z";

const { cases, errors } = parseCases(readFileSync(SEMANTIC_FILE, "utf8"));

/** Answers each shown pair by `label(goldRelation)`; records every request. */
function scripted(
  name: string,
  label: (gold: string, index: number) => string | undefined,
  requests: GenerateJsonRequest[] = [],
): JsonGenerator {
  return {
    model: name,
    trust: "LOCAL_PROCESS",
    async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
      requests.push(request);
      const testCase = cases.find(
        (candidate) => classificationRequest(semanticContradictionInput(candidate)).untrustedText === request.untrustedText,
      );
      if (testCase === undefined) throw new Error("scripted model got an unknown case");
      const pairs = (testCase.pairs ?? []).flatMap((pair, index) => {
        const relation = label(pair.goldRelation, index);
        return relation === undefined ? [] : [{ id: `p${index + 1}`, relation, rationale: "betik", confidence: 0.5 }];
      });
      return { pairs } as T;
    },
  };
}

async function measure(generator: JsonGenerator, only: readonly BakeoffCase[] = cases) {
  const report = await runBakeoff(only, [{ name: generator.model, generator }], { kind: "measurement", startedAt: STARTED });
  return report;
}

describe("semantic contradiction cases", () => {
  it("the shipped cases validate and cover every relation of the lane, free-text only", () => {
    expect(errors).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases.every((testCase) => testCase.task === "semantic_contradiction" && testCase.source === "synthetic")).toBe(true);
    const relations = new Set(cases.flatMap((testCase) => (testCase.pairs ?? []).map((pair) => pair.goldRelation)));
    expect(relations).toEqual(new Set(["CONTRADICTION", "TENSION", "CORROBORATION", "INDEPENDENT", "INSUFFICIENT_EVIDENCE"]));
    const statements = cases.flatMap((testCase) => (testCase.pairs ?? []).flatMap((pair) => [pair.left, pair.right]));
    expect(statements.some((statement) => statement.includes("park halinde duruyordu"))).toBe(true);
    expect(statements.every((statement) => statement.length <= 400)).toBe(true);
    expect(cases.some((testCase) => (testCase.pairs ?? []).length > 1)).toBe(true);
  });

  it("rejects a case without pairs, an over-long statement, or an unknown label", () => {
    const base = { schema: "collex.bakeoff.case/v1", task: "semantic_contradiction", source: "synthetic" };
    const bad = [
      JSON.stringify({ ...base, id: "a" }),
      JSON.stringify({ ...base, id: "b", pairs: [{ left: "x".repeat(401), right: "y", goldRelation: "CONTRADICTION" }] }),
      JSON.stringify({ ...base, id: "c", pairs: [{ left: "x", right: "y", goldRelation: "ÇELİŞKİ" }] }),
    ].join("\n");
    const parsed = parseCases(bad);
    expect(parsed.cases).toEqual([]);
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0]).toContain("semantic_contradiction needs pairs");
  });
});

describe("semantic contradiction scoring", () => {
  it("sends the PRODUCTION request for every case", async () => {
    const requests: GenerateJsonRequest[] = [];
    await measure(scripted("kayıt", (gold) => gold, requests));
    expect(requests).toHaveLength(cases.length);
    cases.forEach((testCase, index) => {
      expect(requests[index]).toEqual(classificationRequest(semanticContradictionInput(testCase)));
    });
    expect(requests[0]!.instruction).toContain("Farklı kelimeler kullanmak çelişki demek değildir");
  });

  it("measures a careful model as careful", async () => {
    const report = await measure(scripted("dikkatli", (gold) => gold));
    const metrics = report.models[0]!.groups.synthetic!.metrics;
    expect(metrics["semanticRelationAccuracy"]).toBe(1);
    expect(metrics["semanticContradictionRecall"]).toBe(1);
    expect(metrics["semanticFalseContradictionRate"]).toBe(0);
    expect(metrics["semanticAnswered"]).toBe(1);
    expect(report.models[0]!.groups.synthetic!.structuredValidity).toBe(1);
    expect(renderBakeoffMarkdown(report)).toContain("Anlamsal çelişki etiketi");
  });

  it("a model that calls everything a contradiction is caught by the false-contradiction rate", async () => {
    const metrics = (await measure(scripted("alarmcı", () => "CONTRADICTION"))).models[0]!.groups.synthetic!.metrics;
    expect(metrics["semanticContradictionRecall"]).toBe(1);
    expect(metrics["semanticFalseContradictionRate"]).toBe(1);
    expect(metrics["semanticRelationAccuracy"]).toBeLessThan(0.5);
  });

  it("a model that always abstains asserts nothing false and finds nothing", async () => {
    const metrics = (await measure(scripted("çekingen", () => "INSUFFICIENT_EVIDENCE"))).models[0]!.groups.synthetic!.metrics;
    expect(metrics["semanticFalseContradictionRate"]).toBe(0);
    expect(metrics["semanticContradictionRecall"]).toBe(0);
  });

  it("an unanswered pair is neither right nor an assertion; an unreadable answer is invalid, not a failure", async () => {
    const batch = cases.filter((testCase) => (testCase.pairs ?? []).length === 3);
    expect(batch).toHaveLength(1);
    const partial = await measure(scripted("yarım", (gold, index) => (index === 0 ? gold : undefined)), batch);
    expect(partial.models[0]!.groups.synthetic!.metrics["semanticAnswered"]).toBeCloseTo(1 / 3, 4);
    expect(partial.models[0]!.groups.synthetic!.metrics["semanticRelationAccuracy"]).toBeCloseTo(1 / 3, 4);

    const unreadable: JsonGenerator = {
      model: "bozuk-yanıt",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        return { pairs: [{ id: "p1", relation: "CONTRADICTION" }] } as T; // no rationale
      },
    };
    const report = await measure(unreadable, cases.slice(0, 1));
    expect(report.results[0]!.valid).toBe(false);
    expect(report.results[0]!.failed).toBe(false);
    expect(report.results[0]!.error).toContain("ClassificationError");
    expect(report.models[0]!.groups.synthetic!.metrics["semanticRelationAccuracy"]).toBe(0);
    expect(report.models[0]!.failureRate).toBe(0);
  });

  it("the CLI dry run drives the semantic cases through the real adapter and labels it a harness check", () => {
    const out = mkdtempSync(join(tmpdir(), "collex-bakeoff-semantic-"));
    try {
      const run = spawnSync(
        process.execPath,
        [CLI, "--dry-run", "--cases", "evals/bakeoff/cases.semantic.synthetic.jsonl", "--out", out],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(run.status).toBe(0);
      const file = readdirSync(out).find((name) => name.endsWith("-harness-check.json"));
      expect(file).toBeDefined();
      const report = JSON.parse(readFileSync(join(out, file!), "utf8"));
      expect(report.kind).toBe("harness_check");
      for (const model of report.models) {
        expect(model.failureRate).toBe(0);
        expect(model.groups.synthetic!.structuredValidity).toBe(1);
        // The scripted transport answered every pair it was shown: the pair
        // labels survived the adapter's evidence fencing.
        expect(model.groups.synthetic!.metrics.semanticAnswered).toBe(1);
        expect(model.groups.synthetic!.metrics.semanticFalseContradictionRate).toBe(0);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("semantic contradiction honesty (W21 review)", () => {
  const unreadableAnswer = (): never => {
    throw new LocalGenerationError("Yerel modelin yanıtı beklenen biçimde değildi.", "MALFORMED_JSON");
  };

  // R2-45 added sem-10 to the shipped cases: 9 of 10 cases unanswered now (was 8 of 9).
  it("prose instead of JSON on 9 of 10 cases scores those cases as finding nothing (#35)", async () => {
    const answered = cases.find((testCase) => testCase.id === "sem-08")!;
    const answeredText = classificationRequest(semanticContradictionInput(answered)).untrustedText;
    const mostlyProse = scripted("düzyazı", (gold) => gold);
    const generator: JsonGenerator = {
      model: "düzyazı",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
        if (request.untrustedText !== answeredText) unreadableAnswer();
        return mostlyProse.generateJson<T>(request);
      },
    };
    const report = await measure(generator);
    const summary = report.models[0]!;
    // Before: accuracy 1, recall 1, false-contradiction rate 0, answered 1.
    expect(summary.groups.synthetic!.metrics["semanticRelationAccuracy"]).toBeCloseTo(1 / 10, 4);
    expect(summary.groups.synthetic!.metrics["semanticAnswered"]).toBeCloseTo(1 / 10, 4);
    expect(summary.groups.synthetic!.metrics["semanticContradictionRecall"]).toBeCloseTo(1 / 4, 4);
    expect(summary.groups.synthetic!.metricCases["semanticRelationAccuracy"]).toBe(10);
    expect(summary.failureRate).toBe(0);
    expect(report.results.filter((result) => result.unreadable)).toHaveLength(9);
    expect(report.results.filter((result) => result.unreadable).every((result) => !result.failed && !result.valid)).toBe(true);
    // The false-contradiction rate rests on the one answered case, and says so.
    expect(summary.groups.synthetic!.metricCases["semanticFalseContradictionRate"]).toBe(1);
    expect(renderBakeoffMarkdown(report)).toContain("0.000 (1/10)");
  });

  it("an empty answer is not a clean false-contradiction record; the answered share is in the table (#40)", async () => {
    const silent: JsonGenerator = {
      model: "sessiz",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        return { pairs: [] } as T;
      },
    };
    const report = await measure(silent);
    const metrics = report.models[0]!.groups.synthetic!.metrics;
    expect(metrics["semanticAnswered"]).toBe(0);
    expect(metrics["semanticFalseContradictionRate"]).toBeNull();
    const markdown = renderBakeoffMarkdown(report);
    expect(markdown).toContain("Cevaplanan çift");
    expect(markdown).toContain("Yanlış çelişki (cevaplananlarda)");
    const cellsOf = (line: string): string[] => line.split("|").map((cell) => cell.trim());
    const header = cellsOf(markdown.split("\n").find((line) => line.startsWith("| Model | Başarısız"))!);
    const row = cellsOf(markdown.split("\n").find((line) => line.startsWith("| sessiz |"))!);
    expect(row[header.indexOf("Yanlış çelişki (cevaplananlarda)")]).toBe("— (0/10)");
    expect(row[header.indexOf("Cevaplanan çift")]).toBe("0.000 (10/10)");

    // One wrong answer out of one answered non-contradiction is a rate of 1, not 1/N.
    const batch = cases.filter((testCase) => testCase.id === "sem-08");
    const onlyOne = scripted("tek", (_gold, index) => (index === 1 ? "CONTRADICTION" : undefined));
    const one = (await measure(onlyOne, batch)).models[0]!.groups.synthetic!.metrics;
    expect(one["semanticFalseContradictionRate"]).toBe(1);
    expect(one["semanticAnswered"]).toBeCloseTo(1 / 3, 4);
  });

  it("R2-45: a case can carry the paraphrase production shows under each quote; the report says where it is missing", async () => {
    const misleading = cases.find((testCase) => testCase.id === "sem-10")!;
    const pair = misleading.pairs![0]!;
    expect(pair.leftSummary).toBeDefined();
    const input = semanticContradictionInput(misleading);
    // Built as production builds a pair: the verified quote, and the paraphrase beside it.
    expect(input.pairs[0]).toMatchObject({
      leftQuote: pair.left,
      leftStatement: pair.leftSummary,
      rightQuote: pair.right,
      rightStatement: pair.rightSummary,
    });
    const request = classificationRequest(input);
    // Before: the summary line never appeared in any bake-off request.
    expect(request.untrustedText).toContain(`A (${QUOTE_LABEL_TR}): "${pair.left}"`);
    expect(request.untrustedText).toContain(`A (${STATEMENT_LABEL_TR}): ${pair.leftSummary}`);
    expect(request.untrustedText).toContain(`B (${STATEMENT_LABEL_TR}): ${pair.rightSummary}`);

    // A model swayed by the negated paraphrase is caught on this pair.
    const swayed = await measure(scripted("özete-kanan", () => "CONTRADICTION"), [misleading]);
    expect(swayed.models[0]!.groups.synthetic!.metrics["semanticRelationAccuracy"]).toBe(0);
    expect(swayed.models[0]!.groups.synthetic!.metrics["semanticFalseContradictionRate"]).toBe(1);
    expect(swayed.noticesTr.join(" ")).not.toContain("model özeti yok");

    // Pairs without a summary measure a request production rarely sends; the report says how many.
    const report = await measure(scripted("dikkatli", (gold) => gold));
    const withoutSummary = cases.flatMap((testCase) => testCase.pairs ?? []).filter((entry) => entry.leftSummary === undefined).length;
    expect(withoutSummary).toBe(11);
    expect(report.noticesTr.join(" ")).toContain(`${withoutSummary} anlamsal çelişki çiftinin en az bir tarafında model özeti yok`);
    // A summary longer than production shows is refused like an over-long quote.
    const tooLong = parseCases(
      JSON.stringify({
        schema: "collex.bakeoff.case/v1",
        id: "sem-x",
        task: "semantic_contradiction",
        source: "synthetic",
        pairs: [{ left: "a", right: "b", leftSummary: "x".repeat(401), goldRelation: "INDEPENDENT" }],
      }),
    );
    expect(tooLong.cases).toEqual([]);
  });

  const bigCase = parseCases(
    JSON.stringify({
      schema: "collex.bakeoff.case/v1",
      id: "sem-big",
      task: "semantic_contradiction",
      source: "synthetic",
      pairs: Array.from({ length: 25 }, (_, index) => ({
        left: `Araç ${index + 1}. günde park halinde duruyordu.`,
        right: `Araç ${index + 1}. günde hareket halindeydi.`,
        goldRelation: index % 2 === 0 ? "CONTRADICTION" : "INDEPENDENT",
      })),
    }),
  ).cases;

  /** Answers every shown pair by its gold label, found by the pair text; records the requests. */
  function goldByText(name: string, requests: GenerateJsonRequest[], unreadableCall?: number): JsonGenerator {
    return {
      model: name,
      trust: "LOCAL_PROCESS",
      async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
        requests.push(request);
        if (unreadableCall !== undefined && requests.length === unreadableCall) unreadableAnswer();
        const shown = (request.untrustedText ?? "").split(/\[p\d+\]/u).slice(1);
        return {
          pairs: shown.map((block, index) => {
            const day = Number(block.match(/Araç (\d+)\. günde/u)?.[1]);
            return { id: `p${index + 1}`, relation: day % 2 === 1 ? "CONTRADICTION" : "INDEPENDENT", rationale: "betik" };
          }),
        } as T;
      },
    };
  }

  it("a 25-pair case is sent as production sends it: calls of 10, 10 and 5 (#41)", async () => {
    expect(bigCase).toHaveLength(1);
    const requests: GenerateJsonRequest[] = [];
    const report = await measure(goldByText("parçalı", requests), bigCase);
    const batches = semanticContradictionBatches(bigCase[0]!, 10);
    expect(batches.map((batch) => [batch.batchNo, batch.batchCount, batch.pairs.length])).toEqual([
      [1, 3, 10],
      [2, 3, 10],
      [3, 3, 5],
    ]);
    expect(requests).toEqual(batches.map((batch) => classificationRequest(batch)));
    expect(report.results[0]!.calls).toBe(3);
    expect(report.batching).toEqual({ weighBatchSize: 8, contradictionPairsPerCall: 10 });
    expect(report.models[0]!.groups.synthetic!.metrics["semanticRelationAccuracy"]).toBe(1);
    expect(report.models[0]!.groups.synthetic!.metrics["semanticAnswered"]).toBe(1);
    expect(renderBakeoffMarkdown(report)).toContain("anlamsal çelişki çağrısı başına en çok 10 çift");

    // An unreadable SECOND call leaves only its ten pairs unanswered.
    const partial = await measure(goldByText("yarım-parça", [], 2), bigCase);
    expect(partial.results[0]!).toMatchObject({ valid: false, failed: false, unreadable: true, calls: 3 });
    expect(partial.models[0]!.groups.synthetic!.metrics["semanticAnswered"]).toBeCloseTo(15 / 25, 4);

    // The configured size is honoured, and an out-of-range size is refused.
    const small: GenerateJsonRequest[] = [];
    const custom = await runBakeoff(bigCase, [{ name: "küçük", generator: goldByText("küçük", small) }], {
      kind: "measurement",
      startedAt: STARTED,
      batching: { contradictionPairsPerCall: 7 },
    });
    expect(small).toHaveLength(4);
    expect(custom.batching.contradictionPairsPerCall).toBe(7);
    await expect(
      runBakeoff(bigCase, [{ name: "küçük", generator: goldByText("küçük", []) }], {
        kind: "measurement",
        startedAt: STARTED,
        batching: { contradictionPairsPerCall: 41 },
      }),
    ).rejects.toThrow(/out of production range/u);
  });
});
