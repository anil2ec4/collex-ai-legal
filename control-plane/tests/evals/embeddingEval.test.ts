/**
 * W21 embedding-provider evaluation harness: metric math on hand-computed
 * examples, case validation, pessimistic ties, failure accounting, memory
 * honesty and the dry-run label.
 *
 * No real model and no network: providers are scripted EmbeddingPort doubles
 * (a lookup table, or the harness's own deterministic dry-run embedder). The
 * real-model measurement is the CLI run recorded in evals/reports.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// W21 R2-44/R2-39: quality figures exist only per case group now (no pooled model-level block); these runs read groups.synthetic.
import { EmbeddingCallError, type EmbeddingPort } from "../../src/retrieval/semanticRerank.js";
import { denseLaneQueryText } from "../../src/retrieval/hybrid.js";
import { ExactCosineDenseLane } from "../../src/embeddings/denseLane.js";
import type { ChunkVectorStore } from "../../src/embeddings/chunkVectorStore.js";
import {
  HARNESS_CHECK_LABEL,
  isSemanticOnlyPassage,
  lexicalFlagWarnings,
  ndcgAtK,
  parseEmbeddingCases,
  percentile,
  rankPassages,
  recallAtK,
  reciprocalRank,
  renderEmbeddingEvalMarkdown,
  runEmbeddingEval,
  scriptedEmbeddingPort,
  sharesLexeme,
  sharesLexemeWithQuery,
  type EmbeddingCase,
  type EmbeddingProviderUnderTest,
} from "../../src/evals/embeddingEval.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const CASES_FILE = join(REPO_ROOT, "evals", "embeddings", "cases.synthetic.jsonl");
const CLI = join(REPO_ROOT, "control-plane", "scripts", "embedding_eval.mjs");
const STARTED = "2026-09-11T00:00:00.000Z";

describe("metric math (hand-computed)", () => {
  it("Recall@K is the share of relevant ids in the first K", () => {
    const ranked = ["a", "b", "c", "d"];
    const relevant = new Set(["b", "d"]);
    expect(recallAtK(ranked, relevant, 1)).toBe(0);
    expect(recallAtK(ranked, relevant, 3)).toBe(0.5);
    expect(recallAtK(ranked, relevant, 10)).toBe(1);
    expect(recallAtK(ranked, new Set(), 5)).toBeNull();
  });

  it("MRR uses the rank of the FIRST relevant id, 0 when none is ranked", () => {
    expect(reciprocalRank(["a", "b", "c"], new Set(["c"]))).toBeCloseTo(1 / 3, 10);
    expect(reciprocalRank(["a", "b", "c"], new Set(["b", "c"]))).toBe(0.5);
    expect(reciprocalRank(["a", "b"], new Set(["z"]))).toBe(0);
  });

  it("nDCG@10 is graded (gain 2^rel - 1) and equals binary nDCG for 0/1 labels", () => {
    // ranked x(0), y(3), z(1): DCG = 0/1 + 7/log2(3) + 1/log2(4); ideal y, z: 7/1 + 1/log2(3).
    const graded = ndcgAtK(["x", "y", "z"], new Map([["x", 0], ["y", 3], ["z", 1]]), 10);
    expect(graded).toBeCloseTo((7 / Math.log2(3) + 0.5) / (7 + 1 / Math.log2(3)), 10);
    expect(graded).toBeCloseTo(0.6443, 3);
    // Binary: the relevant id at rank 2 -> (1/log2(3)) / 1.
    expect(ndcgAtK(["a", "b"], new Map([["a", 0], ["b", 1]]), 10)).toBeCloseTo(1 / Math.log2(3), 10);
    expect(ndcgAtK(["a", "b"], new Map([["a", 0], ["b", 0]]), 10)).toBeNull();
  });

  it("percentiles interpolate linearly (numpy's default, as evals/retrieval/benchmark.py)", () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
    expect(percentile([4, 1, 3, 2], 95)).toBeCloseTo(3.85, 10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it("a tie goes to the LESS relevant passage, so equal scores earn nothing by order", () => {
    const ranked = rankPassages([
      { id: "relevant", score: 0.5, relevance: 3 },
      { id: "irrelevant", score: 0.5, relevance: 0 },
      { id: "top", score: 0.9, relevance: 0 },
    ]);
    expect(ranked).toEqual(["top", "irrelevant", "relevant"]);
  });
});

function caseLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: "collex.embedding.case/v1",
    id: "c",
    query: "kira bedeli",
    source: "synthetic",
    passages: [
      { id: "p1", text: "Aylık tutar ödenmedi.", relevance: 3, lexicalOverlap: false },
      { id: "p2", text: "Toplantı yapıldı.", relevance: 0, lexicalOverlap: false },
    ],
    ...overrides,
  });
}

describe("case format (collex.embedding.case/v1)", () => {
  it("accepts a valid case and rejects bad ones with the line number and the reason", () => {
    const lines = [
      caseLine(),
      "not json",
      caseLine({ id: "no-relevant", passages: [
        { id: "p1", text: "a", relevance: 0, lexicalOverlap: false },
        { id: "p2", text: "b", relevance: 0, lexicalOverlap: false },
      ] }),
      caseLine({ id: "dup-passage", passages: [
        { id: "p1", text: "a", relevance: 1, lexicalOverlap: false },
        { id: "p1", text: "b", relevance: 0, lexicalOverlap: false },
      ] }),
      caseLine({ id: "bad-relevance", passages: [
        { id: "p1", text: "a", relevance: 4, lexicalOverlap: false },
        { id: "p2", text: "b", relevance: 0, lexicalOverlap: false },
      ] }),
      caseLine({ id: "lawyer-unsigned", source: "lawyer_annotated" }),
      caseLine({ id: "extra-field", winner: "x" }),
      caseLine(), // duplicate case id "c"
    ].join("\n");
    const { cases, errors } = parseEmbeddingCases(lines);
    expect(cases.map((testCase) => testCase.id)).toEqual(["c"]);
    expect(errors).toHaveLength(7);
    expect(errors[0]).toBe("line 2: not JSON");
    expect(errors[1]).toMatch(/^line 3: .*relevance >= 1/u);
    expect(errors[2]).toMatch(/^line 4: .*duplicate passage id: p1/u);
    expect(errors[3]).toMatch(/^line 5: /u);
    expect(errors[4]).toMatch(/^line 6: .*needs annotator.*needs adjudication/u);
    expect(errors[5]).toMatch(/^line 7: /u);
    expect(errors[6]).toBe("line 8: duplicate case id: c");
  });

  it("the shipped synthetic cases validate, are all synthetic, and carry semantic-only passages", () => {
    const { cases, errors } = parseEmbeddingCases(readFileSync(CASES_FILE, "utf8"));
    expect(errors).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.every((testCase) => testCase.source === "synthetic")).toBe(true);
    const semanticOnly = cases.filter((testCase) =>
      testCase.passages.some((passage) => passage.relevance > 0 && !passage.lexicalOverlap),
    );
    expect(semanticOnly.length).toBeGreaterThanOrEqual(10);
    // Every case also has a lexical distractor or a lexically-related passage.
    expect(cases.every((testCase) => testCase.passages.some((passage) => passage.lexicalOverlap))).toBe(true);
    // The annotation flags agree with the product's own lexeme comparison.
    expect(lexicalFlagWarnings(cases)).toEqual([]);
  });

  it("checks the lexical-overlap flag instead of trusting it", () => {
    expect(sharesLexeme("kira bedeli ödenmedi", "Kira sözleşmesi noterde düzenlendi.")).toBe(true);
    expect(
      sharesLexeme("trafik kazasında maddi zarar", "Araçların çarpışması sonucu otomobilde oluşan hasarın bedeli."),
    ).toBe(false);
    // Light verbs and function words do not make two texts lexically related.
    expect(sharesLexeme("olarak tespit edilmiştir", "olarak kabul edilmiştir")).toBe(false);
    const { cases } = parseEmbeddingCases(
      caseLine({ passages: [
        { id: "p1", text: "Kira bedeli ödenmedi.", relevance: 3, lexicalOverlap: false },
        { id: "p2", text: "Toplantı yapıldı.", relevance: 0, lexicalOverlap: false },
      ] }),
    );
    expect(lexicalFlagWarnings(cases)).toEqual([
      { caseId: "c", passageId: "p1", problem: "flag_false_but_shared_lexeme" },
    ]);
  });
});

/** An embedder that returns fixed vectors per (formatted) text; records calls. */
function tablePort(
  table: Record<string, number[]>,
  behaviour: { throwOn?: string; dropOneFor?: string; error?: unknown } = {},
): EmbeddingPort & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async embed(texts) {
      calls.push([...texts]);
      if (behaviour.throwOn !== undefined && texts.includes(behaviour.throwOn)) {
        throw behaviour.error ?? new EmbeddingCallError("EMBEDDING_TIMEOUT");
      }
      const vectors = texts.map((text) => {
        const vector = table[text];
        if (vector === undefined) throw new Error(`unscripted text: ${text}`);
        return vector;
      });
      if (behaviour.dropOneFor !== undefined && texts.includes(behaviour.dropOneFor)) vectors.pop();
      return vectors;
    },
  };
}

const TWO_CASES: EmbeddingCase[] = parseEmbeddingCases(
  [
    JSON.stringify({
      schema: "collex.embedding.case/v1", id: "A", query: "q1", source: "synthetic",
      passages: [
        { id: "p1", text: "t1", relevance: 3, lexicalOverlap: false },
        { id: "p2", text: "t2", relevance: 0, lexicalOverlap: false },
        { id: "p3", text: "t3", relevance: 1, lexicalOverlap: true },
      ],
    }),
    JSON.stringify({
      schema: "collex.embedding.case/v1", id: "B", query: "q2", source: "synthetic",
      passages: [
        { id: "r1", text: "u1", relevance: 2, lexicalOverlap: false },
        { id: "r2", text: "u2", relevance: 0, lexicalOverlap: true },
      ],
    }),
  ].join("\n"),
).cases;

const TABLE: Record<string, number[]> = {
  "query: q1": [1, 0],
  "passage: t1": [0.9, 0.1], // cos ~0.994 -> rank 1
  "passage: t2": [0, 1], // cos 0 -> rank 3
  "passage: t3": [0.5, 0.5], // cos ~0.707 -> rank 2
  "query: q2": [1, 0],
  "passage: u1": [0.2, 0.8], // rank 2
  "passage: u2": [0.9, 0.1], // rank 1 (an irrelevant passage wins)
};

describe("runEmbeddingEval", () => {
  it("scores a scripted provider exactly, including semantic-only recall", async () => {
    const port = tablePort(TABLE);
    const report = await runEmbeddingEval(TWO_CASES, [{ name: "tablo", model: "table", promptStyle: "e5", port }], {
      kind: "measurement",
      startedAt: STARTED,
    });
    const summary = report.providers[0]!;
    // A: relevant {p1, p3}, ranking p1, p3, p2 -> R@1 0.5, R@3 1, RR 1, nDCG 1, semantic-only (p1) R@1 1.
    // B: relevant {r1}, ranking r2, r1 -> R@1 0, R@3 1, RR 0.5, semantic-only (r1) R@1 0.
    expect(summary.groups.synthetic!.metrics["recallAt1"]).toBe(0.25);
    expect(summary.groups.synthetic!.metrics["recallAt3"]).toBe(1);
    expect(summary.groups.synthetic!.metrics["mrr"]).toBe(0.75);
    expect(summary.groups.synthetic!.metrics["semanticOnlyRecallAt1"]).toBe(0.5);
    expect(summary.groups.synthetic!.metrics["semanticOnlyRecallAt3"]).toBe(1);
    const caseB = report.results.find((result) => result.caseId === "B")!;
    expect(caseB.rankedPassageIds).toEqual(["r2", "r1"]);
    expect(caseB.ndcgAt10).toBeCloseTo(3 / Math.log2(3) / 3, 10);
    expect(summary.dimension).toBe(2);
    expect(summary.failureRate).toBe(0);
    expect(summary.calls).toBe(4); // one query call + one passage batch per case
    // The product's e5 prompt style was applied to what the provider saw.
    expect(port.calls[0]).toEqual(["query: q1"]);
    expect(port.calls[1]).toEqual(["passage: t1", "passage: t2", "passage: t3"]);
    expect(summary.memory).toBeNull();
    expect(summary.memoryNoteTr).toContain("ölçülmedi");
    // Both cases have <= 10 passages: R@10 is 1 by construction, and the report says so.
    expect(summary.groups.synthetic!.metrics["recallAt10"]).toBe(1);
    expect(report.noticesTr.join(" ")).toContain("2 vakada en çok 10 pasaj var");
  });

  it("a failing call is a failure, kept out of the quality averages, with its error code", async () => {
    const report = await runEmbeddingEval(
      TWO_CASES,
      [{ name: "yarım", model: "table", promptStyle: "e5", port: tablePort(TABLE, { throwOn: "query: q2" }) }],
      { kind: "measurement", startedAt: STARTED },
    );
    const summary = report.providers[0]!;
    expect(summary.casesScored).toBe(1);
    expect(summary.failedCases).toBe(1);
    expect(summary.failureRate).toBe(0.5);
    expect(summary.errors).toEqual({ EMBEDDING_TIMEOUT: 1 });
    expect(summary.failedCalls).toBe(1);
    expect(summary.groups.synthetic!.metrics["recallAt1"]).toBe(0.5); // case A only — B is not counted as zero
    const failed = report.results.find((result) => result.caseId === "B")!;
    expect(failed.failed).toBe(true);
    expect(failed.reciprocalRank).toBeNull();
    expect(report.noticesTr.join(" ")).toContain("Başarısız vakalar");
  });

  it("a wrong vector count or a dimension change is a failure, never a silent score", async () => {
    const wrongCount = await runEmbeddingEval(
      TWO_CASES.slice(0, 1),
      [{ name: "eksik", model: "t", promptStyle: "e5", port: tablePort(TABLE, { dropOneFor: "passage: t1" }) }],
      { kind: "measurement", startedAt: STARTED },
    );
    expect(wrongCount.providers[0]!.errors).toEqual({ WRONG_COUNT: 1 });
    const mixed = await runEmbeddingEval(
      TWO_CASES.slice(0, 1),
      [{ name: "boyut", model: "t", promptStyle: "e5", port: tablePort({ ...TABLE, "passage: t2": [0, 1, 0] }) }],
      { kind: "measurement", startedAt: STARTED },
    );
    expect(mixed.providers[0]!.errors).toEqual({ DIMENSION_MISMATCH: 1 });
  });

  it("memory is recorded only when it was read, and never guessed", async () => {
    const readings = [
      { rssBytes: 100 * 1024 * 1024, peakBytes: null, method: "test" },
      { rssBytes: 130 * 1024 * 1024, peakBytes: null, method: "test" },
    ];
    const measured: EmbeddingProviderUnderTest = {
      name: "ölçülen",
      model: "t",
      promptStyle: "e5",
      port: tablePort(TABLE),
      memoryProbe: async () => readings.shift() ?? null,
      startupMs: 1234,
    };
    const unreadable: EmbeddingProviderUnderTest = {
      name: "okunamayan",
      model: "t",
      promptStyle: "e5",
      port: tablePort(TABLE),
      memoryProbe: async () => {
        throw new Error("no access");
      },
    };
    const report = await runEmbeddingEval(TWO_CASES, [measured, unreadable], { kind: "measurement", startedAt: STARTED });
    expect(report.providers[0]!.memory?.deltaBytes).toBe(30 * 1024 * 1024);
    expect(report.providers[0]!.startupMs).toBe(1234);
    expect(report.providers[1]!.memory).toBeNull();
    expect(report.providers[1]!.memoryNoteTr).toContain("ölçülemedi");
    expect(report.providers[1]!.startupMs).toBeNull();
  });

  it("a dry run is labelled a harness check, names no winner, and never prints passage text", async () => {
    const { cases } = parseEmbeddingCases(readFileSync(CASES_FILE, "utf8"));
    const report = await runEmbeddingEval(
      cases,
      [
        { name: "betikli-kelime", model: "scripted-words", promptStyle: "e5", port: scriptedEmbeddingPort("words") },
        { name: "betikli-trigram", model: "scripted-trigrams", promptStyle: "e5", port: scriptedEmbeddingPort("trigrams") },
      ],
      { kind: "harness_check", startedAt: STARTED },
    );
    expect(report.kind).toBe("harness_check");
    expect(report.label).toBe(HARNESS_CHECK_LABEL);
    expect(report.noticesTr[0]).toContain("ÖLÇÜM DEĞİLDİR");
    expect(report.noticesTr.join(" ")).toContain("sentetiktir");
    expect(report.noticesTr.join(" ")).toContain("kazanan seçmez");
    const markdown = renderEmbeddingEvalMarkdown(report);
    expect(markdown).toContain(HARNESS_CHECK_LABEL);
    expect(markdown).not.toMatch(/winner|en iyi|kazanan:/iu);
    const serialized = JSON.stringify(report) + markdown;
    for (const testCase of cases) {
      expect(serialized).not.toContain(testCase.query);
      for (const passage of testCase.passages) expect(serialized).not.toContain(passage.text);
    }
  });

  it("the scripted dry-run embedder is deterministic", async () => {
    const port = scriptedEmbeddingPort("trigrams");
    const [first] = await port.embed(["passage: kira bedeli"]);
    const [second] = await port.embed(["passage: kira bedeli"]);
    expect(first).toEqual(second);
  });
});

describe("embedding_eval.mjs CLI", () => {
  it("--dry-run writes a harness-check report and says it is not a measurement", () => {
    const out = mkdtempSync(join(tmpdir(), "collex-embedding-eval-"));
    try {
      const run = spawnSync(process.execPath, [CLI, "--dry-run", "--out", out], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(run.status).toBe(0);
      const files = readdirSync(out).sort();
      expect(files.length).toBe(2);
      expect(files.every((file) => /^embedding-eval-\d{4}-\d{2}-\d{2}-harness-check\.(json|md)$/u.test(file))).toBe(true);
      const report = JSON.parse(readFileSync(join(out, files.find((file) => file.endsWith(".json"))!), "utf8"));
      expect(report.kind).toBe("harness_check");
      expect(report.label).toBe(HARNESS_CHECK_LABEL);
      expect(report.providers).toHaveLength(2);
      expect(readFileSync(join(out, files.find((file) => file.endsWith(".md"))!), "utf8")).toContain(HARNESS_CHECK_LABEL);
      expect(run.stdout).not.toContain("Araçların çarpışması");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses an unknown provider instead of running without one", () => {
    const run = spawnSync(process.execPath, [CLI, "--providers", "bilinmeyen"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("unknown provider");
  });
});

describe("query form and semantic-only counting (W21 review)", () => {
  it("embeds the query exactly as the dense lane embeds it, not as the case wrote it (#42)", async () => {
    const query = "6098 sayılı TBK m. 344 uyarınca Kira Artışı";
    const { cases, errors } = parseEmbeddingCases(
      caseLine({
        id: "atıf",
        query,
        passages: [
          { id: "p1", text: "Kira bedelinin artırılması hakkında.", relevance: 3, lexicalOverlap: true },
          { id: "p2", text: "Toplantı yapıldı.", relevance: 0, lexicalOverlap: false },
        ],
      }),
    );
    expect(errors).toEqual([]);
    const evalSaw: string[][] = [];
    const recording: EmbeddingPort = {
      async embed(texts) {
        evalSaw.push([...texts]);
        return texts.map((_, index) => [1, index]);
      },
    };
    const report = await runEmbeddingEval(cases, [{ name: "kayıt", model: "t", promptStyle: "e5", port: recording }], {
      kind: "measurement",
      startedAt: STARTED,
    });

    // What the product's dense lane sends its embedder for the same query:
    // searchPipeline hands it denseLaneQueryText(query) (tests/retrieval/denseLaneQueryText.test.ts).
    const laneSaw: string[] = [];
    const lane = new ExactCosineDenseLane({
      store: { scopedVectors: async () => [], stats: async () => ({}) } as unknown as ChunkVectorStore,
      embedder: {
        async embed(texts) {
          laneSaw.push(...texts);
          return texts.map(() => [1, 0]);
        },
      },
      profile: { key: "test", model: "t", dimensions: 2, promptStyle: "e5" },
    });
    await lane.search(denseLaneQueryText(query), { asOf: "2026-09-11", limit: 5, filters: { fileIds: ["f1"] } });

    expect(laneSaw).toHaveLength(1);
    expect(evalSaw[0]).toEqual([laneSaw[0]]);
    expect(evalSaw[0]![0]).toBe("query: 6098 m. 344 uyarınca kira artışı");
    // Before: the case's own casing and citation spelling were embedded.
    expect(evalSaw[0]![0]).not.toBe(`query: ${query}`);
    expect(report.queryForm).toBe("dense_lane");
    expect(renderEmbeddingEvalMarkdown(report)).toContain("Sorgu biçimi: ürünün anlam (yoğun) şeridinin gömdüğü biçim");
  });

  it("a passage flagged 'no shared word' that shares one is not counted as semantic-only anywhere (#43)", async () => {
    const { cases } = parseEmbeddingCases(
      caseLine({
        id: "yanlış-işaret",
        query: "kira bedeli",
        passages: [
          { id: "p1", text: "Kira bedeli ödenmedi.", relevance: 3, lexicalOverlap: false },
          { id: "p2", text: "Toplantı yapıldı.", relevance: 0, lexicalOverlap: false },
        ],
      }),
    );
    expect(lexicalFlagWarnings(cases)).toEqual([
      { caseId: "yanlış-işaret", passageId: "p1", problem: "flag_false_but_shared_lexeme" },
    ]);
    const table: Record<string, number[]> = {
      "query: kira bedeli": [1, 0],
      "passage: Kira bedeli ödenmedi.": [0.9, 0.1],
      "passage: Toplantı yapıldı.": [0, 1],
    };
    const scored = await runEmbeddingEval(cases, [{ name: "tablo", model: "t", promptStyle: "e5", port: tablePort(table) }], {
      kind: "measurement",
      startedAt: STARTED,
    });
    // Before: the header counted this case from the flag alone (1) while the
    // semantic-only table below it scored 0 cases.
    expect(scored.casesWithSemanticOnlyPassages).toBe(0);
    expect(scored.providers[0]!.groups.synthetic!.semanticOnlyCasesScored).toBe(0);
    expect(scored.results[0]!.semanticOnlyPassages).toBe(0);
    expect(renderEmbeddingEvalMarkdown(scored)).toContain("ortak kelimesi olmayan ilgili pasaj içeren vaka: 0");
    expect(scored.noticesTr.join(" ")).toContain("'yalnız anlamla bulunan' ölçütüne sayılmadı");

    // A failed case reports its semantic-only passages by the same rule.
    const failed = await runEmbeddingEval(
      cases,
      [{ name: "kopuk", model: "t", promptStyle: "e5", port: tablePort(table, { throwOn: "query: kira bedeli" }) }],
      { kind: "measurement", startedAt: STARTED },
    );
    expect(failed.results[0]!.failed).toBe(true);
    expect(failed.results[0]!.semanticOnlyPassages).toBe(0);
    expect(failed.casesWithSemanticOnlyPassages).toBe(0);
  });
});

describe("case groups and the lane query form (W21 review, round two)", () => {
  const lawyerLine = (id: string, adjudication: string, like: "A" | "B"): string =>
    JSON.stringify({
      schema: "collex.embedding.case/v1",
      id,
      query: like === "A" ? "q1" : "q2",
      source: "lawyer_annotated",
      annotator: "Av. A",
      adjudication,
      passages:
        like === "A"
          ? [
              { id: "p1", text: "t1", relevance: 3, lexicalOverlap: false },
              { id: "p2", text: "t2", relevance: 0, lexicalOverlap: false },
              { id: "p3", text: "t3", relevance: 1, lexicalOverlap: true },
            ]
          : [
              { id: "r1", text: "u1", relevance: 2, lexicalOverlap: false },
              { id: "r2", text: "u2", relevance: 0, lexicalOverlap: true },
            ],
    });
  const evaluate = (cases: readonly EmbeddingCase[]) =>
    runEmbeddingEval(cases, [{ name: "tablo", model: "table", promptStyle: "e5", port: tablePort(TABLE) }], {
      kind: "measurement",
      startedAt: STARTED,
    });

  it("R2-39: an all-pending run is never presented as lawyer gold", async () => {
    const { cases, errors } = parseEmbeddingCases([lawyerLine("P1", "pending", "A"), lawyerLine("P2", "pending", "B")].join("\n"));
    expect(errors).toEqual([]);
    const report = await evaluate(cases);
    const notices = report.noticesTr.join(" ");
    // Before: no source or adjudication notice at all for this run.
    expect(notices).toContain("(agreed) vaka yok; bu sayılar avukat onaylı bir ölçüm değildir");
    expect(notices).toContain("2 avukat vakası henüz karara bağlanmadı (pending)");
    expect(notices).not.toContain("avukat onaylıdır");
    expect(report.pendingCases).toBe(2);
    expect(report.agreedLawyerCases).toBe(0);
    expect(report.caseGroups).toEqual({ lawyer_pending: 2 });
    const summary = report.providers[0]!;
    expect(Object.keys(summary.groups)).toEqual(["lawyer_pending"]);
    expect(summary).not.toHaveProperty("metrics");
    expect(summary.groups.lawyer_pending!.metrics["recallAt1"]).toBe(0.25);
    expect(report.results.map((result) => [result.source, result.adjudication])).toEqual([
      ["lawyer_annotated", "pending"],
      ["lawyer_annotated", "pending"],
    ]);
    const markdown = renderEmbeddingEvalMarkdown(report);
    expect(markdown).toContain("## Arama kalitesi — avukat vakaları — henüz karara bağlanmamış (pending)");
    expect(markdown).not.toContain("avukat onaylı vakalar (agreed)");
  });

  it("R2-39: synthetic, pending and disputed cases are measured apart; only agreed cases are called lawyer-approved", async () => {
    const mixed = [...TWO_CASES, ...parseEmbeddingCases([lawyerLine("P1", "pending", "A"), lawyerLine("D1", "disputed", "B")].join("\n")).cases];
    expect(mixed).toHaveLength(4);
    const report = await evaluate(mixed);
    const notices = report.noticesTr.join(" ");
    // Before: "Vakaların 2 tanesi sentetik, 2 tanesi avukat onaylıdır" although none was agreed.
    expect(notices).toContain("Vakaların 2 tanesi sentetik, 2 tanesi avukat vakasıdır (0 tanesi avukat onaylı)");
    expect(notices).not.toContain("avukat onaylıdır");
    expect(notices).toContain("1 avukat vakası henüz karara bağlanmadı (pending)");
    expect(notices).toContain("1 vaka için avukatlar aynı etikette birleşmedi (disputed); ayrı gösterilir");
    const groups = report.providers[0]!.groups;
    expect(Object.keys(groups).sort()).toEqual(["lawyer_disputed", "lawyer_pending", "synthetic"]);
    // Each group is its own measurement: pending (like A: R@1 0.5) and disputed
    // (like B: R@1 0) are not averaged into the synthetic 0.25.
    expect(groups.synthetic!.metrics["recallAt1"]).toBe(0.25);
    expect(groups.synthetic!.cases).toBe(2);
    expect(groups.lawyer_pending!.metrics["recallAt1"]).toBe(0.5);
    expect(groups.lawyer_disputed!.metrics["recallAt1"]).toBe(0);
    const markdown = renderEmbeddingEvalMarkdown(report);
    expect(markdown).toContain("## Arama kalitesi — sentetik vakalar");
    expect(markdown).toContain("## Yalnız anlamla bulunabilen pasajlar — avukat vakaları — avukatlar birleşmedi (disputed)");

    const withAgreed = await evaluate([...TWO_CASES, ...parseEmbeddingCases(lawyerLine("G1", "agreed", "A")).cases]);
    expect(withAgreed.noticesTr.join(" ")).not.toContain("(agreed) vaka yok");
    expect(withAgreed.noticesTr.join(" ")).toContain("(1 tanesi avukat onaylı)");
    expect(withAgreed.agreedLawyerCases).toBe(1);
  });

  it("R2-40: a passage sharing the statute number the lane query carries is not semantic-only", async () => {
    const query = "TCK dolandırıcılık";
    const cited = "5237 sayılı Kanunun 157. maddesi uyarınca hileli davranışla bir kimseyi aldatan kişi cezalandırılır.";
    expect(denseLaneQueryText(query)).toContain("5237");
    expect(sharesLexeme(query, cited)).toBe(false);
    expect(sharesLexeme(denseLaneQueryText(query), cited)).toBe(true);
    expect(sharesLexemeWithQuery(query, cited)).toBe(true);
    const unrelated = [
      "Maden ruhsatı iptal edildi.",
      "Toplantı ertelendi.",
      "Kira sözleşmesi feshedildi.",
      "Tapu kaydı düzeltildi.",
      "İşçinin kıdem tazminatı hesaplandı.",
      "Vergi ziyaı cezası kesildi.",
      "Nafaka miktarı artırıldı.",
      "Veraset ilamı alındı.",
      "Araç trafikten çekildi.",
      "Bilirkişi raporu sunuldu.",
      "Duruşma günü belirlendi.",
    ];
    const { cases, errors } = parseEmbeddingCases(
      caseLine({
        id: "kanun-no",
        query,
        passages: [
          { id: "p1", text: cited, relevance: 3, lexicalOverlap: false },
          ...unrelated.map((text, index) => ({ id: `u${index + 1}`, text, relevance: 0, lexicalOverlap: false })),
        ],
      }),
    );
    expect(errors).toEqual([]);
    const testCase = cases[0]!;
    // Before: counted as semantic-only (the raw query shares no word with it).
    expect(isSemanticOnlyPassage(testCase, testCase.passages[0]!)).toBe(false);
    expect(lexicalFlagWarnings(cases)).toEqual([{ caseId: "kanun-no", passageId: "p1", problem: "flag_false_but_shared_lexeme" }]);
    // A bag-of-words embedder that knows no meaning gets no "semantic-only" score from the injected number.
    const report = await runEmbeddingEval(
      cases,
      [{ name: "kelime", model: "scripted-words", promptStyle: "e5", port: scriptedEmbeddingPort("words") }],
      { kind: "measurement", startedAt: STARTED },
    );
    expect(report.casesWithSemanticOnlyPassages).toBe(0);
    expect(report.providers[0]!.groups.synthetic!.semanticOnlyCasesScored).toBe(0);
    expect(report.providers[0]!.groups.synthetic!.metrics["semanticOnlyRecallAt1"]).toBeNull();
    expect(report.noticesTr.join(" ")).toContain("'yalnız anlamla bulunan' ölçütüne sayılmadı");
  });
});
