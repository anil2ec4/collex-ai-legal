/**
 * The HTTP-facing glue around the answer pipeline: request validation, the
 * server-tier ceiling on retrieval work, the bounded run cache and the
 * evidence-bundle assembly the Python exporter consumes.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANSWER_LIMITS,
  InMemoryAnswerStore,
  MAX_STORED_TEXT_BYTES,
  boundedAnswerBundle,
  textsByteLength,
  MAX_ANSWER_LIST_LIMIT,
  answerCoversFile,
  answerRequestSchema,
  buildAnswerBundle,
  clampAnswerLimits,
  clampListLimit,
  fileScopeOf,
  summarizeStoredAnswer,
  type AnswerStore,
  type StoredAnswer,
} from "../../src/api/answerService.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import {
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  StubCorpus,
  VERSION_TCK_V1,
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  standardTexts,
} from "./fakes.js";

describe("answerRequestSchema", () => {
  it("accepts a minimal request", () => {
    const parsed = answerRequestSchema.safeParse({ question: "TCK m. 157 nedir?" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a too-short question, a bad date and unknown fields", () => {
    expect(answerRequestSchema.safeParse({ question: "ab" }).success).toBe(false);
    expect(
      answerRequestSchema.safeParse({ question: "TCK m. 157", asOf: "01.01.2026" }).success,
    ).toBe(false);
    expect(
      answerRequestSchema.safeParse({ question: "TCK m. 157", surprise: 1 }).success,
    ).toBe(false);
  });

  it("rejects filter and limit values outside the accepted ranges", () => {
    expect(
      answerRequestSchema.safeParse({
        question: "TCK m. 157",
        limits: { resultLimit: 10_000 },
      }).success,
    ).toBe(false);
    expect(
      answerRequestSchema.safeParse({
        question: "TCK m. 157",
        filters: { sources: [""] },
      }).success,
    ).toBe(false);
  });
});

describe("clampAnswerLimits — the server tier is a ceiling, not a default", () => {
  it("keeps the tier when the client asks for nothing", () => {
    expect(clampAnswerLimits(DEFAULT_ANSWER_LIMITS, undefined)).toEqual(DEFAULT_ANSWER_LIMITS);
    expect(clampAnswerLimits(DEFAULT_ANSWER_LIMITS, {})).toEqual(DEFAULT_ANSWER_LIMITS);
  });

  it("lets a client ask for LESS work", () => {
    const clamped = clampAnswerLimits(DEFAULT_ANSWER_LIMITS, {
      resultLimit: 3,
      lexicalLimit: 5,
      trigramLimit: 5,
      perDocumentCap: 1,
    });
    expect(clamped.resultLimit).toBe(3);
    expect(clamped.lexicalLimit).toBe(5);
    expect(clamped.trigramLimit).toBe(5);
    expect(clamped.perDocumentCap).toBe(1);
  });

  it("refuses to let a client ask for MORE work", () => {
    const clamped = clampAnswerLimits(DEFAULT_ANSWER_LIMITS, {
      resultLimit: 999,
      lexicalLimit: 999,
      trigramLimit: 999,
      perDocumentCap: 999,
    });
    expect(clamped).toEqual(DEFAULT_ANSWER_LIMITS);
  });

  it("clamps the trigram threshold UPWARD, because lower means more rows", () => {
    const permissive = clampAnswerLimits(DEFAULT_ANSWER_LIMITS, { trigramMinSimilarity: 0.01 });
    expect(permissive.trigramMinSimilarity).toBe(DEFAULT_ANSWER_LIMITS.trigramMinSimilarity);

    const stricter = clampAnswerLimits(DEFAULT_ANSWER_LIMITS, { trigramMinSimilarity: 0.9 });
    expect(stricter.trigramMinSimilarity).toBe(0.9);
  });

  it("ignores non-finite values instead of propagating them into SQL", () => {
    const clamped = clampAnswerLimits(DEFAULT_ANSWER_LIMITS, {
      resultLimit: Number.NaN,
      trigramMinSimilarity: Number.POSITIVE_INFINITY,
    });
    expect(clamped.resultLimit).toBe(DEFAULT_ANSWER_LIMITS.resultLimit);
    expect(clamped.trigramMinSimilarity).toBe(DEFAULT_ANSWER_LIMITS.trigramMinSimilarity);
  });
});

describe("buildAnswerBundle", () => {
  async function run() {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
    return pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
  }

  it("omits the canonical texts by default", async () => {
    const bundle = buildAnswerBundle(await run());
    expect(bundle.schema).toBe("collex.answer.evidence-bundle/v1");
    expect(bundle.texts).toBeUndefined();
    expect(bundle.evidence.length).toBeGreaterThan(0);
  });

  it("includes the canonical texts on request, enabling full-chain verification", async () => {
    const answer = await run();
    const bundle = buildAnswerBundle(answer, { includeTexts: true });
    expect(bundle.texts).toBeDefined();
    expect(Object.keys(bundle.texts!)).toContain(VERSION_TCK_V1);

    // The exporter's upgrade path: re-slice the recorded span from the text.
    const evidence = bundle.evidence[0]!;
    const canonical = bundle.texts![evidence.documentVersionId]!;
    const derived = Array.from(canonical)
      .slice(evidence.locator.startChar, evidence.locator.endChar)
      .join("");
    expect(derived).toBe(evidence.quote);
  });

  it("keeps the synthetic-corpus provenance the exporter reads", async () => {
    const bundle = buildAnswerBundle(await run(), { includeTexts: true });
    expect(bundle.synthetic).toBe(true);
    // W15: aynı ölçüm, yeni sözcük — "SENTETİK" yerine "deneme belgeleri".
    expect(bundle.syntheticNotice).toMatch(/DENEME BELGELER/i);
    expect(bundle.producer).toBeTypeOf("string");
  });
});

describe("InMemoryAnswerStore", () => {
  const entry = (runId: string): StoredAnswer => ({
    runId,
    result: { runId } as unknown as StoredAnswer["result"],
    bundle: { schema: "collex.answer.evidence-bundle/v1" } as StoredAnswer["bundle"],
    storedAt: "2026-06-01T00:00:00.000Z",
  });

  it("round-trips an entry", () => {
    const store = new InMemoryAnswerStore(4);
    store.put(entry("a"));
    expect(store.get("a")?.runId).toBe("a");
    expect(store.get("missing")).toBeUndefined();
  });

  it("is bounded: the oldest entry is evicted first", () => {
    const store = new InMemoryAnswerStore(2);
    store.put(entry("a"));
    store.put(entry("b"));
    store.put(entry("c"));

    expect(store.size).toBe(2);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")?.runId).toBe("b");
    expect(store.get("c")?.runId).toBe("c");
  });

  it("re-putting the same runId refreshes it rather than duplicating it", () => {
    const store = new InMemoryAnswerStore(2);
    store.put(entry("a"));
    store.put(entry("b"));
    store.put(entry("a"));
    store.put(entry("c"));

    expect(store.size).toBe(2);
    expect(store.get("b")).toBeUndefined();
    expect(store.get("a")?.runId).toBe("a");
  });

  it("refuses a nonsensical capacity", () => {
    expect(() => new InMemoryAnswerStore(0)).toThrow(RangeError);
    expect(() => new InMemoryAnswerStore(1.5)).toThrow(RangeError);
  });
});

describe("AnswerStore contract (W12-A) on InMemoryAnswerStore", () => {
  const full = (runId: string, storedAt: string, extra: Partial<StoredAnswer> = {}): StoredAnswer => ({
    runId,
    result: {
      runId,
      question: `Soru ${runId}`,
      status: "COMPLETE",
      finalizable: true,
      evidence: [{ evidenceId: "e1" }, { evidenceId: "e2" }, { evidenceId: "e3" }],
    } as unknown as StoredAnswer["result"],
    bundle: { schema: "collex.answer.evidence-bundle/v1" } as StoredAnswer["bundle"],
    storedAt,
    ...extra,
  });

  it("satisfies the AnswerStore interface structurally", () => {
    const store: AnswerStore = new InMemoryAnswerStore();
    expect(typeof store.warm).toBe("function");
    expect(typeof store.list).toBe("function");
    expect(typeof store.attach).toBe("function");
  });

  it("summarizes a stored answer: question falls back to the result, mode to local", () => {
    const summary = summarizeStoredAnswer(full("r1", "2026-09-02T10:00:00.000Z"));
    expect(summary).toEqual({
      runId: "r1",
      question: "Soru r1",
      status: "COMPLETE",
      mode: "local",
      matterId: null,
      createdAt: "2026-09-02T10:00:00.000Z",
      evidenceCount: 3,
      finalizable: true,
    });
    const explicit = summarizeStoredAnswer(
      full("r2", "2026-09-02T10:00:00.000Z", { question: "Kısa soru", mode: "live", matterId: "m-1" }),
    );
    expect(explicit.question).toBe("Kısa soru");
    expect(explicit.mode).toBe("live");
    expect(explicit.matterId).toBe("m-1");
    // A minimal result (old cached shape) never breaks the summary.
    const bare = summarizeStoredAnswer({
      runId: "r3",
      result: { runId: "r3" } as unknown as StoredAnswer["result"],
      bundle: { schema: "collex.answer.evidence-bundle/v1" } as StoredAnswer["bundle"],
      storedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(bare).toMatchObject({ question: "", status: "", evidenceCount: 0, finalizable: false });
  });

  it("lists newest first, filtered by matter, bounded by the clamped limit", async () => {
    const store = new InMemoryAnswerStore(8);
    store.put(full("a", "2026-09-02T09:00:00.000Z"));
    store.put(full("b", "2026-09-02T11:00:00.000Z", { matterId: "m-1" }));
    store.put(full("c", "2026-09-02T10:00:00.000Z", { matterId: "m-1" }));
    expect((await store.list()).map((s) => s.runId)).toEqual(["b", "c", "a"]);
    expect((await store.list({ matterId: "m-1" })).map((s) => s.runId)).toEqual(["b", "c"]);
    expect((await store.list({ matterId: "m-2" })).map((s) => s.runId)).toEqual([]);
    expect((await store.list({ limit: 1 })).map((s) => s.runId)).toEqual(["b"]);
    expect(clampListLimit(undefined)).toBe(50);
    expect(clampListLimit(0)).toBe(1);
    expect(clampListLimit(10_000)).toBe(MAX_ANSWER_LIST_LIMIT);
    expect(clampListLimit(Number.NaN)).toBe(50);
    expect(clampListLimit(7.9)).toBe(7);
  });

  it("attach files an answer under a matter, null detaches, unknown runId is a no-op; re-put keeps the filing", async () => {
    const store = new InMemoryAnswerStore(8);
    store.put(full("a", "2026-09-02T09:00:00.000Z"));
    await store.attach("a", "m-1");
    expect(store.get("a")?.matterId).toBe("m-1");
    expect((await store.list({ matterId: "m-1" })).map((s) => s.runId)).toEqual(["a"]);

    // The answer route re-puts without a matterId: the filing survives.
    store.put(full("a", "2026-09-02T09:30:00.000Z"));
    expect(store.get("a")?.matterId).toBe("m-1");
    expect(store.get("a")?.storedAt).toBe("2026-09-02T09:30:00.000Z");
    // An explicit null in the put IS honoured.
    store.put(full("a", "2026-09-02T09:45:00.000Z", { matterId: null }));
    expect(store.get("a")?.matterId).toBeNull();

    await store.attach("a", "m-2");
    await store.attach("a", null);
    expect(store.get("a")?.matterId).toBeNull();
    await expect(store.attach("missing", "m-1")).resolves.toBeUndefined();
    expect(store.size).toBe(1);
  });

  it("warm is a no-op: the cache IS the store", async () => {
    const store = new InMemoryAnswerStore(2);
    await expect(store.warm("nothing")).resolves.toBeUndefined();
    expect(store.get("nothing")).toBeUndefined();
  });
});

describe("file scope on summaries (W12-API2)", () => {
  const scoped = (
    runId: string,
    storedAt: string,
    fileScope: unknown,
    extra: Partial<StoredAnswer> = {},
  ): StoredAnswer => ({
    runId,
    result: {
      runId,
      question: `Soru ${runId}`,
      status: "COMPLETE",
      finalizable: true,
      evidence: [],
      ...(fileScope !== undefined ? { fileScope } : {}),
    } as unknown as StoredAnswer["result"],
    bundle: { schema: "collex.answer.evidence-bundle/v1" } as StoredAnswer["bundle"],
    storedAt,
    ...extra,
  });

  it("fileScopeOf narrows an untrusted value: string ids only, includeCorpus only when literally true", () => {
    expect(fileScopeOf({ fileIds: ["a", "b"], includeCorpus: true })).toEqual({
      fileIds: ["a", "b"],
      includeCorpus: true,
    });
    expect(fileScopeOf({ fileIds: ["a", 7, "", null], includeCorpus: "yes" })).toEqual({
      fileIds: ["a"],
      includeCorpus: false,
    });
    expect(fileScopeOf({ fileIds: [] })).toBeUndefined();
    expect(fileScopeOf({ includeCorpus: true })).toBeUndefined();
    expect(fileScopeOf(undefined)).toBeUndefined();
    expect(fileScopeOf(null)).toBeUndefined();
    expect(fileScopeOf("abc")).toBeUndefined();
    expect(fileScopeOf(["a"])).toBeUndefined();
  });

  it("summarizeStoredAnswer carries fileScope only when the stored result has one", () => {
    const summary = summarizeStoredAnswer(
      scoped("r-file", "2026-09-02T10:00:00.000Z", { fileIds: ["abc123"], includeCorpus: false }),
    );
    expect(summary.fileScope).toEqual({ fileIds: ["abc123"], includeCorpus: false });
    expect(answerCoversFile(summary, "abc123")).toBe(true);
    expect(answerCoversFile(summary, "zzz")).toBe(false);

    const plain = summarizeStoredAnswer(scoped("r-plain", "2026-09-02T10:00:00.000Z", undefined));
    expect("fileScope" in plain).toBe(false);
    expect(answerCoversFile(plain, "abc123")).toBe(false);
    // The wire row of a corpus answer is byte-identical to the pre-API2 shape.
    expect(Object.keys(plain).sort()).toEqual([
      "createdAt", "evidenceCount", "finalizable", "matterId", "mode", "question", "runId", "status",
    ]);
  });

  it("list({fileId}) keeps only the answers whose scope names the upload; combinable with matterId and limit", async () => {
    const store = new InMemoryAnswerStore(8);
    store.put(scoped("a", "2026-09-02T09:00:00.000Z", { fileIds: ["f1"], includeCorpus: false }));
    store.put(
      scoped("b", "2026-09-02T10:00:00.000Z", { fileIds: ["f1", "f2"], includeCorpus: true }, { matterId: "m-1" }),
    );
    store.put(scoped("c", "2026-09-02T11:00:00.000Z", undefined, { matterId: "m-1" }));

    expect((await store.list({ fileId: "f1" })).map((s) => s.runId)).toEqual(["b", "a"]);
    expect((await store.list({ fileId: "f2" })).map((s) => s.runId)).toEqual(["b"]);
    expect((await store.list({ fileId: "f9" })).map((s) => s.runId)).toEqual([]);
    // Whole-id match, never a substring.
    expect((await store.list({ fileId: "f" })).map((s) => s.runId)).toEqual([]);
    expect((await store.list({ fileId: "f1", matterId: "m-1" })).map((s) => s.runId)).toEqual(["b"]);
    expect((await store.list({ matterId: "m-1" })).map((s) => s.runId)).toEqual(["c", "b"]);
    expect((await store.list({ fileId: "f1", limit: 1 })).map((s) => s.runId)).toEqual(["b"]);
    // Without the filter the listing is exactly what it was.
    expect((await store.list()).map((s) => s.runId)).toEqual(["c", "b", "a"]);
  });
});

describe("boundedAnswerBundle (W12-FIX2, P1-5b) — stored texts are capped", () => {
  it("keeps texts under the cap, drops them (and says so) above it", async () => {
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
    const run = await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    const kept = boundedAnswerBundle(run);
    expect(kept.textsOmitted).toBe(false);
    expect(kept.bundle.texts).toBeDefined();
    expect(kept.textBytes).toBe(textsByteLength(run.pack.texts));
    expect(MAX_STORED_TEXT_BYTES).toBe(5 * 1024 * 1024);

    const dropped = boundedAnswerBundle(run, kept.textBytes - 1);
    expect(dropped.textsOmitted).toBe(true);
    expect(dropped.bundle.texts).toBeUndefined();
    // Quotes and hashes are untouched: hash verification still works.
    expect(dropped.bundle.evidence.map((e) => e.quoteSha256)).toEqual(kept.bundle.evidence.map((e) => e.quoteSha256));
    // UTF-8 bytes, not UTF-16 units.
    expect(textsByteLength({ a: "ş" })).toBe(2);
  });
});
