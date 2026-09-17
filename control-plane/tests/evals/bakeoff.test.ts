/**
 * W20 bake-off harness: scoring, case validation and honesty labels.
 *
 * Driven by SCRIPTED generators (test doubles): a "careful" one that answers
 * every case correctly with exact quotes and a "sloppy" one that re-flows
 * whitespace in its quotes and guesses labels. No real model is called; this
 * proves the harness measures what it says it measures.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// W21 R2-44: quality figures exist only per case group now (no pooled model-level block); these runs read groups.synthetic.
import {
  listServedModels,
  matchExtractionItems,
  parseCases,
  renderBakeoffMarkdown,
  runBakeoff,
  servedModelRefusal,
  type BakeoffCase,
  type ServedModelCheck,
} from "../../src/evals/bakeoff.js";
import type { JsonGenerator } from "../../src/exhaustive/modelExtractor.js";
import { entailmentRequest, LocalGenerationError, type GenerateJsonRequest } from "../../src/llm/localGenerationAdapter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const CASES_FILE = resolve(HERE, "..", "..", "..", "evals", "bakeoff", "cases.synthetic.jsonl");
const CLI = join(REPO_ROOT, "control-plane", "scripts", "bakeoff.mjs");
const STARTED = "2026-09-11T00:00:00.000Z";

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
      (testCase.passage !== undefined &&
        request.untrustedText === entailmentRequest(testCase.claim ?? "", testCase.passage).untrustedText) ||
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
          // W21 R2-28: the careful judge answered {entails: goldEntails, score: 0.9},
          // i.e. {entails:false, score:0.9} on a gold-false case, which production's
          // judge rejects as self-contradicting; a careful judge's score agrees with its verdict.
          return (sloppy
            ? { entails: true, score: 0.9, rationale: "betik" }
            : { entails: testCase.goldEntails, score: testCase.goldEntails ? 0.9 : 0.1, rationale: "betik" }) as T;
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
    expect(careful.groups.synthetic!.metrics["quoteValidity"]).toBe(1);
    expect(careful.groups.synthetic!.metrics["extractionRecall"]).toBe(1);
    expect(careful.groups.synthetic!.metrics["contradictionAccuracy"]).toBe(1);
    expect(careful.groups.synthetic!.metrics["entailmentAccuracy"]).toBe(1);
    expect(careful.groups.synthetic!.metrics["instructionFollowing"]).toBe(1);
    // Re-flowed whitespace is NOT an exact quote: every item is rejected.
    expect(sloppy.groups.synthetic!.metrics["quoteValidity"]).toBe(0);
    expect(sloppy.groups.synthetic!.metrics["extractionRecall"]).toBe(0);
    expect(sloppy.groups.synthetic!.metrics["instructionFollowing"]).toBe(0);
    expect(sloppy.groups.synthetic!.metrics["contradictionAccuracy"]).toBeLessThan(1);
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

/** A generator for extraction cases only: `answer(case)` returns the raw response or throws. */
function extractionModel(name: string, cases: readonly BakeoffCase[], answer: (testCase: BakeoffCase) => unknown): JsonGenerator {
  return {
    model: name,
    trust: "LOCAL_PROCESS",
    async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
      const testCase = cases.find((candidate) => candidate.task === "extraction" && candidate.unitText === request.untrustedText);
      if (testCase === undefined) throw new Error("scripted model got an unknown case");
      return answer(testCase) as T;
    },
  };
}

const unreadable = (): never => {
  throw new LocalGenerationError("Yerel modelin yanıtı beklenen biçimde değildi.", "MALFORMED_JSON");
};

describe("bake-off honesty (W21 review)", () => {
  const { cases } = parseCases(readFileSync(CASES_FILE, "utf8"));
  const extraction = cases.filter((testCase) => testCase.task === "extraction");
  const exact = (testCase: BakeoffCase) => ({
    items: (testCase.goldItems ?? []).map((item) => ({ kind: item.kind, text: item.quote, quote: item.quote })),
  });

  it("an unreadable answer is scored as finding nothing, not dropped from the quality averages (#35)", async () => {
    expect(extraction).toHaveLength(6);
    const first = extraction[0]!.id;
    const model = extractionModel("yazıcı", extraction, (testCase) => (testCase.id === first ? exact(testCase) : unreadable()));
    const report = await runBakeoff(extraction, [{ name: "yazıcı", generator: model }], { kind: "measurement", startedAt: STARTED });
    const summary = report.models[0]!;
    // Before: P = R = quote validity = schema validity = 1.000 from ONE case.
    expect(summary.groups.synthetic!.metrics["extractionRecall"]).toBeCloseTo(1 / 6, 4);
    expect(summary.groups.synthetic!.metrics["extractionPrecision"]).toBeCloseTo(1 / 6, 4);
    expect(summary.groups.synthetic!.metrics["schemaValidity"]).toBeCloseTo(1 / 6, 4);
    expect(summary.groups.synthetic!.metricCases["extractionRecall"]).toBe(6);
    // Quote validity has nothing to judge in an unreadable answer: it rests on
    // one case, and the report says so next to the number.
    expect(summary.groups.synthetic!.metrics["quoteValidity"]).toBe(1);
    expect(summary.groups.synthetic!.metricCases["quoteValidity"]).toBe(1);
    expect(summary.groups.synthetic!.metricTaskCases["quoteValidity"]).toBe(6);
    expect(renderBakeoffMarkdown(report)).toContain("1.000 (1/6)");
    expect(summary.failureRate).toBe(0);
    expect(summary.unreadableRate).toBeCloseTo(5 / 6, 4);
    expect(report.results.filter((result) => result.unreadable)).toHaveLength(5);
    expect(summary.tasks.extraction).toEqual({ cases: 6, failed: 0, unreadable: 5, invalid: 5 });
    expect(report.noticesTr.join(" ")).toContain("Okunamayan yanıtlar");
  });

  it("an unreadable answer scores 0 on the one-call tasks; only a transport failure is left unscored (#35)", async () => {
    const oneCall = cases.filter((testCase) => ["contradiction", "entailment", "terminology", "instruction"].includes(testCase.task));
    const prose: JsonGenerator = { model: "düzyazı", trust: "LOCAL_PROCESS", generateJson: async () => unreadable() };
    const report = await runBakeoff(oneCall, [{ name: "düzyazı", generator: prose }], { kind: "measurement", startedAt: STARTED });
    const metrics = report.models[0]!.groups.synthetic!.metrics;
    expect(metrics["contradictionAccuracy"]).toBe(0);
    expect(metrics["entailmentAccuracy"]).toBe(0);
    expect(metrics["terminology"]).toBe(0);
    expect(metrics["instructionFollowing"]).toBe(0);
    expect(report.models[0]!.failureRate).toBe(0);

    const empty: JsonGenerator = {
      model: "boş",
      trust: "LOCAL_PROCESS",
      generateJson: async () => {
        throw new LocalGenerationError("Yerel model boş yanıt döndürdü.", "EMPTY_RESPONSE");
      },
    };
    const emptyReport = await runBakeoff(oneCall, [{ name: "boş", generator: empty }], { kind: "measurement", startedAt: STARTED });
    expect(emptyReport.models[0]!.groups.synthetic!.metrics["contradictionAccuracy"]).toBe(0);

    const down: JsonGenerator = {
      model: "kapalı",
      trust: "LOCAL_PROCESS",
      generateJson: async () => {
        throw new LocalGenerationError("Yerel modele ulaşılamadı.", "UNREACHABLE");
      },
    };
    const unreachable = await runBakeoff(oneCall, [{ name: "kapalı", generator: down }], { kind: "measurement", startedAt: STARTED });
    expect(unreachable.models[0]!.failureRate).toBe(1);
    expect(unreachable.models[0]!.groups.synthetic!.metrics["contradictionAccuracy"]).toBeNull();
    expect(unreachable.results.every((result) => result.failed && Object.keys(result.scores).length === 0)).toBe(true);
    expect(renderBakeoffMarkdown(unreachable)).toContain("— (0/5)");
    expect(unreachable.noticesTr.join(" ")).toContain("kalite ortalamalarına katılmadı");
  });

  it("a quote that swallows the whole unit does not find the gold items inside it (#36)", async () => {
    // One item per requested kind, quote = the entire unit text (unique, so it passes validation).
    const dumper = extractionModel("döküm", extraction, (testCase) => ({
      items: (testCase.kinds ?? []).map((kind) => ({ kind, text: "tüm metin", quote: testCase.unitText })),
    }));
    const report = await runBakeoff(extraction, [{ name: "döküm", generator: dumper }], { kind: "measurement", startedAt: STARTED });
    const metrics = report.models[0]!.groups.synthetic!.metrics;
    // Before: recall 1.000, precision 0.917. Only the ext-04 request quote and
    // the near-whole-unit ext-06 quote legitimately overlap a whole-unit span.
    expect(metrics["quoteValidity"]).toBe(1);
    expect(metrics["extractionRecall"]!).toBeLessThanOrEqual(0.25);
    expect(metrics["extractionPrecision"]!).toBeLessThanOrEqual(0.25);
  });

  it("extraction matching is one-to-one and needs a tight span (#36)", () => {
    const unit =
      "Birinci olay 01.02.2024 tarihinde oldu. İkinci olay 05.03.2024 tarihinde oldu. Üçüncü olay 09.04.2024 tarihinde oldu.";
    const gold = [
      { kind: "procedural_event", quote: "Birinci olay 01.02.2024 tarihinde oldu." },
      { kind: "procedural_event", quote: "İkinci olay 05.03.2024 tarihinde oldu." },
      { kind: "procedural_event", quote: "Üçüncü olay 09.04.2024 tarihinde oldu." },
    ];
    const span = (quote: string) => {
      const start = [...unit.slice(0, unit.indexOf(quote))].length;
      return { startChar: start, endChar: start + [...quote].length };
    };
    // One merged item covering all three events matches none (IoU about 1/3).
    expect(matchExtractionItems(unit, gold, [{ kind: "procedural_event", ...span(unit) }])).toBe(0);
    // Two items with the same exact span still satisfy one gold item, not two.
    const one = { kind: "procedural_event", ...span(gold[0]!.quote) };
    expect(matchExtractionItems(unit, gold, [one, one])).toBe(1);
    // A wrong kind never matches; exact quotes match one each.
    expect(matchExtractionItems(unit, gold, [{ ...one, kind: "event" }])).toBe(0);
    expect(matchExtractionItems(unit, gold, gold.map((item) => ({ kind: item.kind, ...span(item.quote) })))).toBe(3);
    // A slightly wider quote (the first event plus one more word) still matches.
    expect(
      matchExtractionItems(unit, gold, [{ kind: "procedural_event", ...span("Birinci olay 01.02.2024 tarihinde oldu. İkinci") }]),
    ).toBe(1);
  });

  it("an empty answer has no quote or schema validity to report, not a perfect 1 (#39)", async () => {
    const silent = extractionModel("sessiz", extraction, () => ({ items: [] }));
    const report = await runBakeoff(extraction, [{ name: "sessiz", generator: silent }], { kind: "measurement", startedAt: STARTED });
    const summary = report.models[0]!;
    expect(summary.groups.synthetic!.metrics["quoteValidity"]).toBeNull();
    expect(summary.groups.synthetic!.metrics["schemaValidity"]).toBeNull();
    expect(summary.groups.synthetic!.metrics["extractionRecall"]).toBe(0);
    expect(summary.groups.synthetic!.structuredValidity).toBe(1);
    expect(renderBakeoffMarkdown(report)).toContain("— (0/6)");
    // Schema-invalid items only: schema validity 0, and still no quote validity.
    const junk = extractionModel("bozuk-öğe", extraction, () => ({ items: [{ foo: 1 }] }));
    const junkReport = await runBakeoff(extraction, [{ name: "bozuk-öğe", generator: junk }], { kind: "measurement", startedAt: STARTED });
    expect(junkReport.models[0]!.groups.synthetic!.metrics["quoteValidity"]).toBeNull();
    expect(junkReport.models[0]!.groups.synthetic!.metrics["schemaValidity"]).toBe(0);
  });

  it("a lawyer case must name its annotator and adjudication (#38)", () => {
    const line = (extra: Record<string, unknown>): string =>
      JSON.stringify({
        schema: "collex.bakeoff.case/v1",
        id: "law-1",
        task: "contradiction",
        source: "lawyer_annotated",
        left: "Kira ödendi.",
        right: "Kira ödenmedi.",
        goldRelation: "CONTRADICTION",
        ...extra,
      });
    const bare = parseCases(line({}));
    expect(bare.cases).toEqual([]);
    expect(bare.errors[0]).toMatch(/needs annotator.*needs adjudication/u);
    expect(parseCases(line({ annotator: "Av. A" })).errors).toHaveLength(1);
    expect(parseCases(line({ annotator: "Av. A", adjudication: "pending" })).errors).toEqual([]);
  });

  it("lawyer cases do not turn a synthetic run into a lawyer-gold measurement (#38)", async () => {
    const lawyerLines = [
      { id: "law-p", adjudication: "pending" },
      { id: "law-d", adjudication: "disputed" },
    ].map((extra) =>
      JSON.stringify({
        schema: "collex.bakeoff.case/v1",
        task: "contradiction",
        source: "lawyer_annotated",
        annotator: "Av. A",
        left: "Kira ödendi.",
        right: "Kira ödenmedi.",
        goldRelation: "CONTRADICTION",
        ...extra,
      }),
    );
    const lawyer = parseCases(lawyerLines.join("\n")).cases;
    expect(lawyer).toHaveLength(2);
    const mixed = [...cases, ...lawyer];
    const base = scripted("dikkatli", cases, false);
    const careful: JsonGenerator = {
      model: "dikkatli",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
        if (request.untrustedText === "[1] Kira ödendi.\n[2] Kira ödenmedi.") return { relation: "CONTRADICTION" } as T;
        return base.generateJson<T>(request);
      },
    };
    const report = await runBakeoff(mixed, [{ name: "dikkatli", generator: careful }], { kind: "measurement", startedAt: STARTED });
    const notices = report.noticesTr.join(" ");
    expect(notices).not.toContain("Vakaların tamamı sentetiktir");
    expect(notices).toContain("(agreed) vaka yok");
    expect(notices).toContain(`Vakaların ${cases.length} tanesi sentetik, 2 tanesi avukat vakasıdır`);
    expect(notices).toContain("1 avukat vakası henüz karara bağlanmadı (pending)");
    expect(notices).toContain("1 avukat vakasında avukatlar aynı etikette birleşmedi (disputed)");
    expect(report.pendingCases).toBe(1);
    expect(report.disputedCases).toBe(1);
    expect(report.agreedLawyerCases).toBe(0);
    expect(report.caseGroups).toEqual({ synthetic: cases.length, lawyer_pending: 1, lawyer_disputed: 1 });
    const summary = report.models[0]!;
    expect(Object.keys(summary.groups).sort()).toEqual(["lawyer_disputed", "lawyer_pending", "synthetic"]);
    expect(summary.groups.lawyer_pending!.cases).toBe(1);
    expect(summary.groups.lawyer_pending!.metricTaskCases["contradictionAccuracy"]).toBe(1);
    expect(summary.groups.synthetic!.metricTaskCases["contradictionAccuracy"]).toBe(5);
    expect(report.results.find((result) => result.caseId === "law-d")).toMatchObject({
      source: "lawyer_annotated",
      adjudication: "disputed",
    });
    const markdown = renderBakeoffMarkdown(report);
    expect(markdown).toContain("## Kalite ölçütleri — sentetik vakalar");
    expect(markdown).toContain("## Kalite ölçütleri — avukat vakaları — henüz karara bağlanmamış (pending)");
    expect(markdown).toContain("## Kalite ölçütleri — avukat vakaları — avukatlar birleşmedi (disputed)");
    expect(markdown).not.toContain("avukat onaylı vakalar (agreed)");

    // An agreed lawyer case lifts the "no agreed gold" notice, never the mixed-source one.
    const agreed = parseCases(lawyerLines[0]!.replace('"pending"', '"agreed"')).cases;
    const withAgreed = await runBakeoff([...cases, ...agreed], [{ name: "dikkatli", generator: careful }], {
      kind: "measurement",
      startedAt: STARTED,
    });
    expect(withAgreed.noticesTr.join(" ")).not.toContain("(agreed) vaka yok");
    expect(withAgreed.noticesTr.join(" ")).toContain("ayrı gösterilir ve birlikte okunmamalıdır");
  });

  it("a row is never labelled with a model that was not called (#37)", async () => {
    const generator = scripted("qwen", cases, false);
    await expect(
      runBakeoff(cases.slice(0, 1), [{ name: "llamaA", generator }], { kind: "measurement", startedAt: STARTED }),
    ).rejects.toThrow(/does not match the called model/u);
  });

  it("the CLI ignores per-role model overrides: each row measures the --models name it carries (#37)", () => {
    const out = mkdtempSync(join(tmpdir(), "collex-bakeoff-roles-"));
    try {
      const run = spawnSync(
        process.execPath,
        [CLI, "--dry-run", "--models", "llamaA,mistralB", "--cases", "evals/bakeoff/cases.synthetic.jsonl", "--out", out],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          timeout: 120_000,
          env: { ...process.env, COLLEX_LOCAL_LLM_MODEL_EXTRACTION: "qwen-override", COLLEX_LOCAL_LLM_MODEL_SYNTHESIS: "qwen-override" },
        },
      );
      expect(run.status).toBe(0);
      // The variable NAMES are reported; their values are never printed.
      expect(run.stderr).toContain("COLLEX_LOCAL_LLM_MODEL_EXTRACTION");
      expect(run.stderr + run.stdout).not.toContain("qwen-override");
      const file = readdirSync(out).find((name) => name.endsWith("-harness-check.json"));
      const report = JSON.parse(readFileSync(join(out, file!), "utf8"));
      expect(report.models.map((model: { model: string; calledModel: string }) => [model.model, model.calledModel])).toEqual([
        ["llamaA", "llamaA"],
        ["mistralB", "mistralB"],
      ]);
      // R2-41: the scripted endpoint's model list was read before measuring.
      expect(report.servedModelCheck).toBe("listed");
      expect(report.servedModels).toEqual(["llamaA", "mistralB"]);
      expect(report.models.map((model: { servedModelListed: unknown }) => model.servedModelListed)).toEqual([true, true]);
      // The scripted endpoint serves only the --models names: a request for
      // the override model would have failed every case.
      for (const model of report.models) expect(model.failureRate).toBe(0);
      expect(report.batching).toEqual({ weighBatchSize: 8, contradictionPairsPerCall: 10 });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("bake-off honesty (W21 review, round two)", () => {
  const { cases } = parseCases(readFileSync(CASES_FILE, "utf8"));
  const run = (only: readonly BakeoffCase[], generators: readonly JsonGenerator[], extra: { servedModels?: ServedModelCheck } = {}) =>
    runBakeoff(
      only,
      generators.map((generator) => ({ name: generator.model, generator })),
      { kind: "measurement", startedAt: STARTED, ...extra },
    );

  it("R2-28/37: the entailment task sends the production judge request and scores a reply production rejects as invalid and 0", async () => {
    const entailment = cases.filter((testCase) => testCase.task === "entailment");
    expect(entailment).toHaveLength(5);
    const goldTrue = entailment.filter((testCase) => testCase.goldEntails).length;
    expect(goldTrue).toBe(2);
    const requests: GenerateJsonRequest[] = [];
    const judge = (name: string, answer: (testCase: BakeoffCase) => unknown): JsonGenerator => ({
      model: name,
      trust: "LOCAL_PROCESS",
      async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
        requests.push(request);
        const testCase = entailment.find(
          (candidate) => request.untrustedText === entailmentRequest(candidate.claim!, candidate.passage!).untrustedText,
        );
        if (testCase === undefined) throw new Error("scripted judge got an unknown case");
        return answer(testCase) as T;
      },
    });
    const quality = async (answer: (testCase: BakeoffCase) => unknown) => {
      const report = await run(entailment, [judge("hakem", answer)]);
      return { report, block: report.models[0]!.groups.synthetic! };
    };

    // The request is exactly what LocalGenerationAdapter.assess sends: the
    // claim is fenced data, never the trusted instruction.
    const consistent = await quality((testCase) => ({ entails: testCase.goldEntails, score: testCase.goldEntails ? 0.95 : 0.05 }));
    expect(requests).toEqual(entailment.map((testCase) => entailmentRequest(testCase.claim!, testCase.passage!)));
    expect(requests[0]!.instruction).not.toContain(entailment[0]!.claim!);
    expect(consistent.block.metrics["entailmentAccuracy"]).toBe(1);
    expect(consistent.block.structuredValidity).toBe(1);

    // Before: each of these scored Destek 1.000 (valid whenever `entails` was a boolean).
    const noScoreOrContradicting = await quality((testCase) =>
      testCase.goldEntails ? { entails: true } : { entails: false, score: 0.97 },
    );
    expect(noScoreOrContradicting.block.metrics["entailmentAccuracy"]).toBe(0);
    expect(noScoreOrContradicting.block.structuredValidity).toBe(0);
    expect(noScoreOrContradicting.report.results.every((result) => !result.valid && !result.failed)).toBe(true);
    expect(noScoreOrContradicting.report.results[0]!.error).toContain("LocalGenerationError");
    expect(noScoreOrContradicting.report.models[0]!.tasks.entailment).toEqual({ cases: 5, failed: 0, unreadable: 0, invalid: 5 });

    const hundredScale = await quality((testCase) => ({ entails: testCase.goldEntails, score: testCase.goldEntails ? 95 : 7 }));
    expect(hundredScale.block.metrics["entailmentAccuracy"]).toBe(0);
    expect(hundredScale.block.structuredValidity).toBe(0);

    // {entails:false, score:0.9} on the gold-false cases is rejected; the
    // consistent gold-true replies still count.
    const confidenceAsScore = await quality((testCase) => ({ entails: testCase.goldEntails, score: 0.9 }));
    expect(confidenceAsScore.block.metrics["entailmentAccuracy"]).toBeCloseTo(goldTrue / 5, 4);
    expect(confidenceAsScore.block.structuredValidity).toBeCloseTo(goldTrue / 5, 4);

    // The verdict production acts on is the score: "entails" with a score
    // below the threshold finalizes nothing, so it is not "supported".
    const lukewarm = await quality(() => ({ entails: true, score: 0.6 }));
    expect(lukewarm.block.structuredValidity).toBe(1);
    expect(lukewarm.block.metrics["entailmentAccuracy"]).toBeCloseTo((5 - goldTrue) / 5, 4);
  });

  it("R2-42: an unreadable or wrong-envelope answer on a negative control (empty gold) scores 0, not a perfect 1", async () => {
    const control = parseCases(
      JSON.stringify({
        schema: "collex.bakeoff.case/v1",
        id: "neg-01",
        task: "extraction",
        source: "lawyer_annotated",
        annotator: "Av. A",
        adjudication: "agreed",
        unitText: "Bu bölümde yalnız tarafların adresleri yazılıdır.",
        kinds: ["event"],
        goldItems: [],
      }),
    ).cases;
    expect(control).toHaveLength(1);
    const report = await run(control, [
      extractionModel("düzyazı", control, () => unreadable()),
      extractionModel("zarf", control, () => ({ sonuc: "yok" })),
      extractionModel("sessiz", control, () => ({ items: [] })),
    ]);
    const block = (name: string) => report.models.find((model) => model.model === name)!.groups.lawyer_agreed!;
    for (const name of ["düzyazı", "zarf"]) {
      expect(block(name).metrics["extractionPrecision"], name).toBe(0);
      expect(block(name).metrics["extractionRecall"], name).toBe(0);
      expect(block(name).metricCases["extractionRecall"], name).toBe(1);
    }
    // A READABLE "nothing here" is the right answer on a negative control.
    expect(block("sessiz").metrics["extractionPrecision"]).toBe(1);
    expect(block("sessiz").metrics["extractionRecall"]).toBe(1);
    // The notice and the numbers now say the same thing.
    expect(report.noticesTr.join(" ")).toContain("sıfır puanla");
    const markdown = renderBakeoffMarkdown(report);
    const cellsOf = (line: string): string[] => line.split("|").map((cell) => cell.trim());
    const header = cellsOf(markdown.split("\n").find((line) => line.startsWith("| Model | Başarısız"))!);
    const row = cellsOf(markdown.split("\n").find((line) => line.startsWith("| düzyazı |"))!);
    expect(row[header.indexOf("Çıkarım P")]).toBe("0.000 (1/1)");
    expect(row[header.indexOf("Çıkarım R")]).toBe("0.000 (1/1)");
  });

  it("R2-43: a timed-out case stays in the latency figures as a lower bound, so a model that timed out is not shown faster", async () => {
    const some = cases.slice(0, 10);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let seen = 0;
    const timesOut: JsonGenerator = {
      model: "zaman-aşımı",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        seen += 1;
        if (seen > 8) {
          await sleep(80);
          throw new LocalGenerationError("Yerel model yanıt vermedi (süre aşıldı).", "TIMEOUT");
        }
        return {} as T;
      },
    };
    const slow: JsonGenerator = {
      model: "yavaş",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        await sleep(20);
        return {} as T;
      },
    };
    let calls = 0;
    const halfDown: JsonGenerator = {
      model: "kopuk",
      trust: "LOCAL_PROCESS",
      async generateJson<T>(): Promise<T> {
        calls += 1;
        if (calls <= 2) throw new LocalGenerationError("Yerel modele ulaşılamadı.", "UNREACHABLE");
        return {} as T;
      },
    };
    const report = await run(some, [timesOut, slow, halfDown]);
    const a = report.models[0]!;
    const b = report.models[1]!;
    const c = report.models[2]!;
    expect(a.failureRate).toBe(0.2);
    expect(a.timedOutCases).toBe(2);
    expect(a.latencyCases).toBe(10);
    expect(report.results.filter((result) => result.model === "zaman-aşımı" && result.timedOut)).toHaveLength(2);
    // Before: p95 over the 8 fast answers only, far below the slow model's.
    expect(a.latencyMsP95).not.toBeNull();
    expect(a.latencyMsP95!).toBeGreaterThanOrEqual(70);
    expect(a.latencyMsP95LowerBound).toBe(true);
    expect(a.latencyMsP95!).toBeGreaterThan(b.latencyMsP95!);
    expect(a.latencyMsP50LowerBound).toBe(false);
    expect(b.latencyMsP95LowerBound).toBe(false);
    // An unreachable case has no latency to report: it stays out.
    expect(c.latencyCases).toBe(8);
    expect(c.timedOutCases).toBe(0);
    const markdown = renderBakeoffMarkdown(report);
    const operations = markdown.slice(markdown.indexOf("## İşletim")).split("\n");
    const row = operations.find((line) => line.startsWith("| zaman-aşımı | "))!;
    expect(row).toContain(`| ≥ ${a.latencyMsP95} |`);
    expect(row).toContain("| 10/10 |");
    expect(operations.find((line) => line.startsWith("| kopuk | "))!).toContain("| 8/10 |");
    expect(report.noticesTr.join(" ")).toContain("alt sınır");
  });

  it("R2-44: the model row carries no pooled quality block; quality exists only per case group", async () => {
    const lawyer = parseCases(
      ["pending", "disputed"]
        .map((adjudication) =>
          JSON.stringify({
            schema: "collex.bakeoff.case/v1",
            id: `law-${adjudication}`,
            task: "contradiction",
            source: "lawyer_annotated",
            annotator: "Av. A",
            adjudication,
            left: "Kira ödendi.",
            right: "Kira ödenmedi.",
            goldRelation: "CONTRADICTION",
          }),
        )
        .join("\n"),
    ).cases;
    const report = await run([...cases, ...lawyer], [scripted("dikkatli", cases, false)]);
    const json = JSON.parse(JSON.stringify(report)) as { models: Array<Record<string, unknown>> };
    const pooled = ["metrics", "metricCases", "metricTaskCases", "structuredValidity"];
    expect(Object.keys(json.models[0]!).filter((key) => pooled.includes(key))).toEqual([]);
    const groups = json.models[0]!["groups"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(groups).sort()).toEqual(["lawyer_disputed", "lawyer_pending", "synthetic"]);
    for (const block of Object.values(groups)) for (const key of pooled) expect(block).toHaveProperty(key);
    // The operations table no longer prints a validity pooled over the groups.
    const markdown = renderBakeoffMarkdown(report);
    expect(markdown.slice(markdown.indexOf("## İşletim"))).not.toContain("Yapı geçerli");
  });

  it("R2-41: the endpoint's model list, not the requested name, decides whether a row may carry a model name", async () => {
    // A single-model llama-server: its list names the one loaded model, and
    // it would answer a chat request for ANY name with that model.
    const seen: RequestInit[] = [];
    const singleModel = (async (url: unknown, init: RequestInit) => {
      seen.push(init);
      if (!String(url).endsWith("/v1/models")) throw new Error("only the model list is read here");
      return new Response(JSON.stringify({ object: "list", data: [{ id: "qwen-tek", object: "model" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const listed = await listServedModels({ baseUrl: "http://127.0.0.1:8080/", fetchImpl: singleModel, apiKey: "lan-key" });
    expect(listed).toEqual({ status: "listed", ids: ["qwen-tek"] });
    expect(seen[0]!.redirect).toBe("error");
    expect((seen[0]!.headers as Record<string, string>)["authorization"]).toBe("Bearer lan-key");
    expect(servedModelRefusal(["llamaA", "mistralB"], listed)).toContain("llamaA, mistralB");
    expect(servedModelRefusal(["qwen-tek", "mistralB"], listed)).toContain("mistralB");
    expect(servedModelRefusal(["qwen-tek"], listed)).toBeNull();
    const generator = scripted("llamaA", cases, false);
    await expect(run(cases.slice(0, 1), [generator], { servedModels: listed })).rejects.toThrow(/listelemiyor/u);

    // A list that cannot be read is no pass: the row says "doğrulanmadı" and a notice says why.
    const missing = await listServedModels({
      baseUrl: "http://127.0.0.1:8080",
      fetchImpl: (async () => new Response("yok", { status: 404 })) as unknown as typeof fetch,
    });
    expect(missing.status).toBe("unverified");
    expect(servedModelRefusal(["llamaA"], missing)).toBeNull();
    const unverified = await run(cases.slice(0, 1), [generator], { servedModels: missing });
    expect(unverified.servedModelCheck).toBe("unverified");
    expect(unverified.servedModels).toBeNull();
    expect(unverified.models[0]!.servedModelListed).toBeNull();
    expect(unverified.noticesTr.join(" ")).toContain("doğrulanmadı");
    expect(renderBakeoffMarkdown(unverified)).toContain("| llamaA | doğrulanmadı |");
    // Not checked at all: said so, never shown as the served model.
    const unchecked = await run(cases.slice(0, 1), [generator]);
    expect(unchecked.servedModelCheck).toBe("not_checked");
    expect(unchecked.noticesTr.join(" ")).toContain("denetlenmedi");
    expect(renderBakeoffMarkdown(unchecked)).toContain("| llamaA | denetlenmedi |");
    // Listed: the row names the model the endpoint listed.
    const ok = await run(cases.slice(0, 1), [generator], { servedModels: { status: "listed", ids: ["llamaA", "başka"] } });
    expect(ok.models[0]!.servedModelListed).toBe(true);
    expect(ok.servedModels).toEqual(["llamaA", "başka"]);
    expect(renderBakeoffMarkdown(ok)).toContain("| llamaA | llamaA |");
  });

  it("R2-41: the CLI refuses a two-model run against a single-model server before measuring (scripted, no network)", () => {
    const out = mkdtempSync(join(tmpdir(), "collex-bakeoff-served-"));
    try {
      const refused = spawnSync(
        process.execPath,
        [CLI, "--dry-run", "--dry-run-served", "qwen-tek", "--models", "llamaA,mistralB", "--cases", "evals/bakeoff/cases.synthetic.jsonl", "--out", out],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain("listelemiyor");
      expect(readdirSync(out)).toEqual([]);
      // The same single-model server, asked for the model it serves: measured (as a harness check).
      const single = spawnSync(
        process.execPath,
        [CLI, "--dry-run", "--dry-run-served", "qwen-tek", "--models", "qwen-tek", "--cases", "evals/bakeoff/cases.synthetic.jsonl", "--out", out],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(single.status).toBe(0);
      const file = readdirSync(out).find((name) => name.endsWith("-harness-check.json"));
      const report = JSON.parse(readFileSync(join(out, file!), "utf8"));
      expect(report.kind).toBe("harness_check");
      expect(report.servedModelCheck).toBe("listed");
      expect(report.servedModels).toEqual(["qwen-tek"]);
      // The dry-run judge answers through the production entailment request.
      expect(report.models[0].groups.synthetic.metricCases.entailmentAccuracy).toBe(5);
      expect(report.results.filter((result: { task: string; valid: boolean }) => result.task === "entailment" && !result.valid)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
