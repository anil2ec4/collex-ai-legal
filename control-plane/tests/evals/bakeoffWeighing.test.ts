/**
 * W21 bake-off readiness for claim-evidence weighing: the cases go through
 * the PRODUCTION weighing request builder and validator, and the report
 * measures false support (a non-supporting item called "supports") on its own.
 * Scripted models only: this proves the harness, never a model's quality.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// W21 R2-44: quality figures exist only per case group now (no pooled model-level block); these runs read groups.synthetic.
import {
  claimWeighingBatches,
  claimWeighingInput,
  parseCases,
  renderBakeoffMarkdown,
  runBakeoff,
  type BakeoffCase,
} from "../../src/evals/bakeoff.js";
import { weighRequest } from "../../src/exhaustive/stageProcessors.js";
import type { JsonGenerator } from "../../src/exhaustive/modelExtractor.js";
import { LocalGenerationError, type GenerateJsonRequest } from "../../src/llm/localGenerationAdapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const WEIGHING_FILE = join(REPO_ROOT, "evals", "bakeoff", "cases.weighing.synthetic.jsonl");
const CLI = join(REPO_ROOT, "control-plane", "scripts", "bakeoff.mjs");
const STARTED = "2026-09-11T00:00:00.000Z";

const { cases, errors } = parseCases(readFileSync(WEIGHING_FILE, "utf8"));

/** Answers each shown candidate with `stanceOf(goldStance)`; records every request. */
function scripted(
  name: string,
  stanceOf: (gold: string, index: number) => string | undefined,
  requests: GenerateJsonRequest[] = [],
): JsonGenerator {
  return {
    model: name,
    trust: "LOCAL_PROCESS",
    async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
      requests.push(request);
      const testCase = cases.find((candidate) => {
        const production = weighRequest(claimWeighingInput(candidate));
        return production.instruction === request.instruction && production.untrustedText === request.untrustedText;
      });
      if (testCase === undefined) throw new Error("scripted model got an unknown case");
      const links = (testCase.candidates ?? []).flatMap((candidate, index) => {
        const stance = stanceOf(candidate.goldStance, index);
        return stance === undefined ? [] : [{ ref: `e${index + 1}`, stance, rationale: "betik" }];
      });
      return { links } as T;
    },
  };
}

async function measure(generator: JsonGenerator, only: readonly BakeoffCase[] = cases) {
  return runBakeoff(only, [{ name: generator.model, generator }], { kind: "measurement", startedAt: STARTED });
}

describe("claim-weighing cases", () => {
  it("the shipped cases validate, are synthetic, and cover every stance and a defense", () => {
    expect(errors).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases.every((testCase) => testCase.task === "claim_weighing" && testCase.source === "synthetic")).toBe(true);
    const stances = new Set(cases.flatMap((testCase) => (testCase.candidates ?? []).map((candidate) => candidate.goldStance)));
    expect([...stances].sort()).toEqual(["ambiguous", "opposes", "supports", "unrelated"]);
    expect(cases.some((testCase) => testCase.claimKind === "defense")).toBe(true);
    // A case where nothing supports the claim: false support is measurable.
    expect(cases.some((testCase) => (testCase.candidates ?? []).every((candidate) => candidate.goldStance !== "supports"))).toBe(true);
  });

  it("rejects a case without candidates, an over-long claim or candidate, or an unknown stance", () => {
    const line = (extra: Record<string, unknown>): string =>
      JSON.stringify({
        schema: "collex.bakeoff.case/v1",
        id: "x",
        task: "claim_weighing",
        source: "synthetic",
        claim: "İddia.",
        candidates: [{ text: "Delil.", goldStance: "supports" }],
        ...extra,
      });
    expect(parseCases(line({})).errors).toEqual([]);
    expect(parseCases(line({ candidates: undefined })).errors.length).toBe(1);
    expect(parseCases(line({ claim: "a".repeat(401) })).errors.length).toBe(1);
    expect(parseCases(line({ candidates: [{ text: "b".repeat(261), goldStance: "supports" }] })).errors.length).toBe(1);
    expect(parseCases(line({ candidates: [{ text: "Delil.", goldStance: "proves" }] })).errors.length).toBe(1);
  });
});

describe("claim-weighing scoring", () => {
  it("sends the PRODUCTION weighing request for every case", async () => {
    const requests: GenerateJsonRequest[] = [];
    await measure(scripted("kayıt", (gold) => gold, requests));
    expect(requests.length).toBe(cases.length);
    cases.forEach((testCase, index) => expect(requests[index]).toEqual(weighRequest(claimWeighingInput(testCase))));
  });

  it("measures a careful model as careful", async () => {
    const metrics = (await measure(scripted("özenli", (gold) => gold))).models[0]!.groups.synthetic!.metrics;
    expect(metrics["weighStanceAccuracy"]).toBe(1);
    expect(metrics["weighSupportRecall"]).toBe(1);
    expect(metrics["weighFalseSupportRate"]).toBe(0);
    expect(metrics["weighAnswered"]).toBe(1);
  });

  it("a model that says 'supports' to everything is caught by the false-support rate", async () => {
    const metrics = (await measure(scripted("hep-destek", () => "supports"))).models[0]!.groups.synthetic!.metrics;
    expect(metrics["weighSupportRecall"]).toBe(1);
    expect(metrics["weighFalseSupportRate"]!).toBeGreaterThan(0.5);
  });

  it("an unanswered candidate is neither right nor an assertion; an unreadable answer is invalid, not a failure", async () => {
    const half = (await measure(scripted("yarım", (gold, index) => (index === 0 ? undefined : gold)))).models[0]!.groups.synthetic!.metrics;
    expect(half["weighAnswered"]!).toBeLessThan(1);
    expect(half["weighFalseSupportRate"]).toBe(0);
    const broken: JsonGenerator = {
      model: "bozuk",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        return { verdict: "?" } as T;
      },
    };
    const report = await measure(broken);
    expect(report.models[0]!.groups.synthetic!.structuredValidity).toBe(0);
    expect(report.models[0]!.failureRate).toBe(0);
    expect(report.models[0]!.groups.synthetic!.metrics["weighStanceAccuracy"]).toBe(0);
    expect(renderBakeoffMarkdown(report)).toContain("Yanlış destek");
  });

  it("the CLI dry run drives the weighing cases through the real adapter and labels it a harness check", () => {
    const out = mkdtempSync(join(tmpdir(), "collex-bakeoff-weighing-"));
    try {
      const run = spawnSync(
        process.execPath,
        [CLI, "--dry-run", "--cases", "evals/bakeoff/cases.weighing.synthetic.jsonl", "--out", out],
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
        // The scripted transport answered every candidate it was shown: the
        // [eN] labels survived the adapter's evidence fencing.
        expect(model.groups.synthetic!.metrics.weighAnswered).toBe(1);
        expect(model.groups.synthetic!.metrics.weighFalseSupportRate).toBe(0);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("claim-weighing honesty (W21 review)", () => {
  const unreadableAnswer = (): never => {
    throw new LocalGenerationError("Yerel modelin yanıtı beklenen biçimde değildi.", "MALFORMED_JSON");
  };

  it("prose instead of JSON scores the claim as supported by nothing, not as a dropped case (#35)", async () => {
    const answered = cases.find((testCase) => testCase.id === "w-06")!;
    const answeredText = weighRequest(claimWeighingInput(answered)).untrustedText;
    const careful = scripted("düzyazı", (gold) => gold);
    const generator: JsonGenerator = {
      model: "düzyazı",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
        if (request.untrustedText !== answeredText) unreadableAnswer();
        return careful.generateJson<T>(request);
      },
    };
    const report = await measure(generator);
    const summary = report.models[0]!;
    // Before: stance accuracy 1, support recall 1, answered 1 from one case of six.
    expect(summary.groups.synthetic!.metrics["weighStanceAccuracy"]).toBeCloseTo(1 / 6, 4);
    expect(summary.groups.synthetic!.metrics["weighAnswered"]).toBeCloseTo(1 / 6, 4);
    expect(summary.groups.synthetic!.metrics["weighSupportRecall"]).toBeCloseTo(1 / 5, 4);
    expect(summary.groups.synthetic!.metricCases["weighStanceAccuracy"]).toBe(6);
    expect(summary.failureRate).toBe(0);
    expect(summary.tasks.claim_weighing).toEqual({ cases: 6, failed: 0, unreadable: 5, invalid: 5 });
  });

  it("an empty answer shows no false-support rate and a 0 answered share; one wrong answer of one is a rate of 1 (#40)", async () => {
    const silent: JsonGenerator = {
      model: "sessiz",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        return { links: [] } as T;
      },
    };
    const report = await measure(silent);
    expect(report.models[0]!.groups.synthetic!.metrics["weighFalseSupportRate"]).toBeNull();
    expect(report.models[0]!.groups.synthetic!.metrics["weighAnswered"]).toBe(0);
    const markdown = renderBakeoffMarkdown(report);
    const cellsOf = (line: string): string[] => line.split("|").map((cell) => cell.trim());
    const header = cellsOf(markdown.split("\n").find((line) => line.startsWith("| Model | Başarısız"))!);
    const row = cellsOf(markdown.split("\n").find((line) => line.startsWith("| sessiz |"))!);
    // Before: "Yanlış destek" read a bare 0.000 and no column showed the silence.
    expect(row[header.indexOf("Yanlış destek (cevaplananlarda)")]).toBe("— (0/6)");
    expect(row[header.indexOf("Cevaplanan aday")]).toBe("0.000 (6/6)");

    // w-01: candidates 0 opposes, 1 supports, 2-3 unrelated. Only candidate 2
    // is answered, wrongly "supports": 1 of 1 answered, not 1 of 3.
    const w01 = cases.filter((testCase) => testCase.id === "w-01");
    const oneWrong = scripted("tek-yanlış", (_gold, index) => (index === 2 ? "supports" : undefined));
    const metrics = (await measure(oneWrong, w01)).models[0]!.groups.synthetic!.metrics;
    expect(metrics["weighFalseSupportRate"]).toBe(1);
    expect(metrics["weighAnswered"]).toBe(0.25);
  });

  const bigClaim = parseCases(
    JSON.stringify({
      schema: "collex.bakeoff.case/v1",
      id: "w-big",
      task: "claim_weighing",
      source: "synthetic",
      claim: "Davalı kira bedellerini ödememiştir.",
      candidates: Array.from({ length: 20 }, (_, index) => ({
        text: `Delil ${index + 1}: ${index + 1}. ay kira dekontu.`,
        goldStance: index % 4 === 0 ? "supports" : "unrelated",
      })),
    }),
  ).cases;

  /** Answers every shown candidate by its gold stance, found by the candidate text; records the requests. */
  function goldByText(name: string, requests: GenerateJsonRequest[], unreadableCall?: number): JsonGenerator {
    return {
      model: name,
      trust: "LOCAL_PROCESS",
      async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
        requests.push(request);
        if (unreadableCall !== undefined && requests.length === unreadableCall) unreadableAnswer();
        const shown = [...(request.untrustedText ?? "").matchAll(/\[e(\d+)\] Delil (\d+):/gu)];
        return {
          links: shown.map((match) => ({
            ref: `e${match[1]}`,
            stance: (Number(match[2]) - 1) % 4 === 0 ? "supports" : "unrelated",
            rationale: "betik",
          })),
        } as T;
      },
    };
  }

  it("a 20-candidate claim is sent as production sends it: calls of 8, 8 and 4 (#41)", async () => {
    expect(bigClaim).toHaveLength(1);
    const requests: GenerateJsonRequest[] = [];
    const report = await measure(goldByText("parçalı", requests), bigClaim);
    const batches = claimWeighingBatches(bigClaim[0]!, 8);
    expect(batches.map((batch) => [batch.batchNo, batch.batchCount, batch.candidates.length])).toEqual([
      [1, 3, 8],
      [2, 3, 8],
      [3, 3, 4],
    ]);
    expect(requests).toEqual(batches.map((batch) => weighRequest(batch)));
    expect(report.results[0]!.calls).toBe(3);
    expect(report.batching.weighBatchSize).toBe(8);
    expect(report.models[0]!.groups.synthetic!.metrics["weighStanceAccuracy"]).toBe(1);
    expect(report.models[0]!.groups.synthetic!.metrics["weighAnswered"]).toBe(1);
    expect(renderBakeoffMarkdown(report)).toContain("iddia-delil çağrısı başına en çok 8 aday");

    // An unreadable THIRD call leaves only its four candidates unanswered.
    const partial = await measure(goldByText("yarım-parça", [], 3), bigClaim);
    expect(partial.results[0]!).toMatchObject({ valid: false, failed: false, unreadable: true, calls: 3 });
    expect(partial.models[0]!.groups.synthetic!.metrics["weighAnswered"]).toBeCloseTo(16 / 20, 4);

    const five: GenerateJsonRequest[] = [];
    await runBakeoff(bigClaim, [{ name: "beşli", generator: goldByText("beşli", five) }], {
      kind: "measurement",
      startedAt: STARTED,
      batching: { weighBatchSize: 5 },
    });
    expect(five).toHaveLength(4);
    await expect(
      runBakeoff(bigClaim, [{ name: "beşli", generator: goldByText("beşli", []) }], {
        kind: "measurement",
        startedAt: STARTED,
        batching: { weighBatchSize: 0 },
      }),
    ).rejects.toThrow(/out of production range/u);
  });
});
