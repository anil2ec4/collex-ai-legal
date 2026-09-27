/**
 * v1 API tests — fully offline via hono's app.request() with a FakeGateway,
 * the InMemoryRunStore and a database-free answer pipeline. No server socket
 * is opened and no SQL is executed.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { UNRECOGNIZED_FIELD_MESSAGE_TR, fieldIssues } from "../src/api/zodIssues.js";
import {
  API_VERSION,
  JSON_BODY_LIMIT_BYTES,
  PAYLOAD_TOO_LARGE_MESSAGE_TR,
  createApp,
} from "../src/api/server.js";
import {
  API_SECURITY_HEADERS,
  FORBIDDEN_ORIGIN_MESSAGE_TR,
  FOREIGN_HOST_MESSAGE_TR,
  hostnameOf,
  isLocalHostHeader,
  isOwnOrigin,
} from "../src/api/localGuard.js";
import {
  BACKUP_IN_PROGRESS_MESSAGE_TR,
  type BackupPort,
} from "../src/backup/routes.js";
import { FakeGateway } from "../src/gateway/gateway.js";
import { InMemoryRunStore } from "../src/orchestration/executor.js";
import type { Outcome } from "../src/capabilities/types.js";
import { AnswerPipeline } from "../src/pipeline/answerPipeline.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ANSWER_LIMITS,
  InMemoryAnswerStore,
  STORED_WITHOUT_TEXTS,
  clampAnswerLimits,
} from "../src/api/answerService.js";
import { DEFAULT_SEARCH_LIMITS } from "../src/retrieval/hybrid.js";
import {
  Q_NORM_CONTENT,
  Q_UNANSWERABLE,
  QUOTE_157_V1,
  STANDARD_FACTS,
  StubCorpus,
  deterministicOptions,
  factsPort,
  hitDecisionAgainst,
  hitDecisionFor,
  hitTck,
  ok,
  standardTexts,
} from "./pipeline/fakes.js";

function okSearchOutcome(rows: Array<{ id: string; title: string; text?: string; url?: string }>): Outcome<unknown> {
  return {
    status: "ok",
    data: rows,
    provider: "BEDESTEN",
    observedAt: "2026-08-26T00:00:00Z",
    warnings: [],
  };
}

function makeApp(gateway?: FakeGateway) {
  const gw =
    gateway ??
    new FakeGateway(() => okSearchOutcome([]));
  const runStore = new InMemoryRunStore();
  return { app: createApp({ gateway: gw, runStore }), gateway: gw, runStore };
}

/** An app whose answer pipeline runs against in-memory fakes (see tests/pipeline/fakes). */
function makeAnswerApp(
  hits = [hitTck("v1")],
  options: { answerStore?: InMemoryAnswerStore } = {},
) {
  const pipeline = new AnswerPipeline({
    retrieval: new StubCorpus(() => ok(hits)),
    texts: standardTexts(),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
  });
  const answerStore = options.answerStore ?? new InMemoryAnswerStore();
  return {
    app: createApp({ answerPipeline: pipeline, answerStore }),
    answerStore,
  };
}

async function postAnswer(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request("/v1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /v1/health", () => {
  it("reports ok with the capability inventory", async () => {
    const { app } = makeApp();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      service: string;
      capabilities: string[];
      registeredToolCount: number;
    };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("@collex/control-plane");
    expect(body.capabilities).toContain("caseLaw.search");
    expect(body.capabilities).toHaveLength(7);
    expect(body.registeredToolCount).toBe(54);
  });

  it("W12 contract [H]: db 'off' without a client, mcp/ai/corpus/counts/version present", async () => {
    const { app } = makeApp();
    const body = (await (await app.request("/v1/health")).json()) as Record<string, unknown>;
    expect(body["db"]).toBe("off");
    expect(body["dbName"]).toBeNull();
    expect(body["migrations"]).toBeNull();
    expect(body["mcp"]).toBe("off");
    expect(body["ai"]).toEqual({ configured: false, model: null, liveTested: false });
    expect(body["demoCorpus"]).toBe(false);
    expect(body["corpus"]).toBeNull();
    expect(body["templates"]).toBe(14);
    // The rule set GROWS (W14 B-11); `tests/deadlines/rules.test.ts` owns the
    // exact count. This contract test only says health reports one.
    expect(typeof body["deadlineRules"]).toBe("number");
    expect(body["deadlineRules"] as number).toBeGreaterThanOrEqual(30);
    // Additive W14 fields (B-05 rls, B-03 backup).
    expect(body).toHaveProperty("rls");
    expect(body["backup"]).toBeNull();
    // B-34: the build label is the repo-root VERSION file, not a literal
    // edited by hand in three places that disagreed (ARCH §6.1).
    expect(body["version"]).toBe(API_VERSION);
    expect(body["version"]).toMatch(/^\d+\.\d+\.\d+/u);
  });
});

describe("POST /v1/search", () => {
  it("happy path: normalizes the query, calls the gateway, returns Outcome<SearchHit[]>", async () => {
    const gateway = new FakeGateway(() =>
      okSearchOutcome([
        {
          id: "yargitay_123",
          title: "Yargıtay 1. HD E.2024/1 K.2024/2",
          text: "mülkiyet hakkına ilişkin karar özeti",
          url: "https://example.invalid/yargitay/123",
        },
      ]),
    );
    const { app } = makeApp(gateway);

    const res = await app.request("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "  MÜLKİYET   Hakkı  " }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: Array<Record<string, unknown>>;
      meta: { normalizedQuery: string };
    };
    expect(body.status).toBe("ok");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      hitId: "yargitay_123",
      externalId: "yargitay_123",
      title: "Yargıtay 1. HD E.2024/1 K.2024/2",
      snippet: "mülkiyet hakkına ilişkin karar özeti",
      sourceUrl: "https://example.invalid/yargitay/123",
      toolName: "search",
    });

    // The gateway received the TURKISH-NORMALIZED query.
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toEqual({
      toolName: "search",
      args: { query: "mülkiyet hakkı" },
    });
    expect(body.meta.normalizedQuery).toBe("mülkiyet hakkı");
  });

  it("surfaces parsed exact references in meta (additive field)", async () => {
    const { app } = makeApp();
    const res = await app.request("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "6698 sayılı Kanun m. 5 kapsamında" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { exactReferences: Array<{ kind: string }> };
    };
    const kinds = body.meta.exactReferences.map((r) => r.kind);
    expect(kinds).toContain("legislation");
    expect(kinds).toContain("article");
  });

  it("rejects an empty query with 400 and a typed error", async () => {
    const { app, gateway } = makeApp();
    const res = await app.request("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(gateway.calls).toHaveLength(0);
  });

  it("returns 502 with the typed Outcome when the provider gateway errors", async () => {
    const gateway = new FakeGateway(() => ({
      status: "error",
      provider: "BEDESTEN",
      observedAt: "2026-08-26T00:00:00Z",
      error: {
        kind: "UNAVAILABLE",
        retryable: true,
        correlationId: "corr-1",
        safeMessage: "upstream down",
      },
    }));
    const { app } = makeApp(gateway);
    const res = await app.request("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "tapu iptali" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status: string; error: { kind: string } };
    expect(body.status).toBe("error");
    expect(body.error.kind).toBe("UNAVAILABLE");
  });
});

describe("research runs", () => {
  it("POST creates and drives a run to a terminal state; GET returns it", async () => {
    const { app } = makeApp();
    const created = await app.request("/v1/research-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "kıdem tazminatı faiz başlangıcı" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { runId: string; status: string };
    expect(createdBody.runId).toBeTruthy();
    // Scaffold planner finishes immediately -> verifier completes the run.
    expect(createdBody.status).toBe("complete");

    const fetched = await app.request(`/v1/research-runs/${createdBody.runId}`);
    expect(fetched.status).toBe(200);
    const state = (await fetched.json()) as {
      runId: string;
      status: string;
      query: string;
      steps: unknown[];
    };
    expect(state.runId).toBe(createdBody.runId);
    expect(state.status).toBe("complete");
    expect(state.query).toBe("kıdem tazminatı faiz başlangıcı");
    expect(state.steps).toEqual([]);
  });

  it("GET returns 404 for an unknown run id", async () => {
    const { app } = makeApp();
    const res = await app.request("/v1/research-runs/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("POST rejects an invalid body with 400", async () => {
    const { app } = makeApp();
    const res = await app.request("/v1/research-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/answer", () => {
  it("returns a typed AnswerResult with evidence, claims, trace and bundle", async () => {
    const { app } = makeAnswerApp();
    const res = await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      schema: string;
      runId: string;
      status: string;
      finalizable: boolean;
      asOf: string;
      evidence: Array<Record<string, unknown>>;
      claims: Array<{ confidence: Record<string, number>; evidenceIds: string[] }>;
      contraryCoverage: { lanes: unknown[] };
      trace: Array<{ name: string; ms: number; counts: Record<string, number> }>;
      markdown: string;
      bundle: { schema: string };
      corpusNotice: string;
      guard: { markdownWasGuarded: boolean; evidence: unknown[] };
    };

    expect(body.schema).toBe("collex.answer.result/v1");
    expect(body.status).toBe("COMPLETE");
    expect(body.finalizable).toBe(true);
    expect(body.asOf).toBe("2025-06-01");
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ quote: QUOTE_157_V1, article: "157" });
    expect(body.claims[0]!.evidenceIds.length).toBeGreaterThan(0);
    expect(Object.keys(body.claims[0]!.confidence).sort()).toEqual([
      "authority", "coverage", "currentness", "entailment", "retrieval",
    ]);
    expect(body.trace.length).toBeGreaterThan(0);
    expect(body.bundle.schema).toBe("collex.answer.evidence-bundle/v1");
    // W15: ölçülen davranış aynı — cevap, dayandığı metinlerin gerçek mevzuat
    // OLMADIĞINI söyleyen bir uyarı taşır. Değişen yalnız sözcük: "SENTETİK"
    // avukatın bilmediği bir kelimeydi, kanonik karşılığı "deneme belgeleri".
    expect(body.corpusNotice).toMatch(/DENEME BELGELER/i);
    expect(body.guard.markdownWasGuarded).toBe(true);
  });

  it("abstains with zero citation cards when the corpus cannot answer", async () => {
    const { app } = makeAnswerApp([]);
    const res = await postAnswer(app, { question: Q_UNANSWERABLE, asOf: "2026-06-01" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      finalizable: boolean;
      evidence: unknown[];
      claims: unknown[];
      markdown: string;
    };
    expect(body.status).toBe("ABSTAIN");
    expect(body.finalizable).toBe(false);
    expect(body.evidence).toEqual([]);
    expect(body.claims).toEqual([]);
    expect(body.markdown).not.toContain("## Kaynaklar");
  });

  it("surfaces conflicting authority for an application question", async () => {
    const { app } = makeAnswerApp([hitTck("v2"), hitDecisionFor(), hitDecisionAgainst()]);
    const res = await postAnswer(app, {
      question:
        "Araç satışında kapora alındıktan sonra teslim edilmemesi 5237 sayılı Kanun m. 157 " +
        "dolandırıcılık suçunu oluşturur mu?",
      asOf: "2026-06-01",
    });
    const body = (await res.json()) as {
      claims: Array<{ verdict: string }>;
      contraryCoverage: { contraryEvidenceIds: string[]; conflictedClaimIds: string[] };
    };
    expect(body.claims.some((c) => c.verdict === "CONFLICTING_AUTHORITIES")).toBe(true);
    expect(body.contraryCoverage.contraryEvidenceIds.length).toBeGreaterThan(0);
    expect(body.contraryCoverage.conflictedClaimIds.length).toBeGreaterThan(0);
  });

  it("rejects a malformed request with 400 and a typed error", async () => {
    const { app } = makeAnswerApp();
    expect((await postAnswer(app, { question: "ab" })).status).toBe(400);
    expect((await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "nope" })).status).toBe(400);
    expect((await postAnswer(app, { nope: true })).status).toBe(400);

    const res = await postAnswer(app, { question: "ab" });
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
  });

  it("answers 503 when no answer pipeline is configured", async () => {
    const { app } = makeApp();
    const res = await postAnswer(app, { question: Q_NORM_CONTENT });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("ANSWER_UNAVAILABLE");
  });

  it("plumbs additive court/date filters down to retrieval (contract D)", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const pipeline = new AnswerPipeline({
      retrieval: corpus,
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
    const app = createApp({ answerPipeline: pipeline });
    const filters = { courtTypes: ["Yargıtay"], dateFrom: "2023-01-01", dateTo: "2026-12-31" };
    const res = await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      filters,
    });
    expect(res.status).toBe(200);
    expect(corpus.calls.length).toBeGreaterThan(0);
    for (const call of corpus.calls) expect(call.filters).toEqual(filters);

    // Unset filters keep the old request shape byte-for-byte.
    corpus.calls.length = 0;
    await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    for (const call of corpus.calls) expect(call.filters).toBeUndefined();
  });

  it("never echoes an internal failure message", async () => {
    // A pipeline-level throw can carry a connection string; the route must
    // report a typed failure and nothing else.
    const app = createApp({
      answerPipeline: {
        answer: () => Promise.reject(new Error("INTERNAL-DETAIL-DO-NOT-ECHO at host:5432")),
      },
    });
    const res = await postAnswer(app, { question: Q_NORM_CONTENT });
    expect(res.status).toBe(500);
    const raw = JSON.stringify(await res.json());
    expect(raw).toContain("ANSWER_FAILED");
    expect(raw).not.toContain("INTERNAL-DETAIL-DO-NOT-ECHO");
  });

  it("clamps a client's retrieval limits to the server tier", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const app = createApp({
      answerPipeline: new AnswerPipeline({
        retrieval: corpus,
        texts: standardTexts(),
        versionFacts: factsPort(STANDARD_FACTS),
        ...deterministicOptions(),
      }),
    });
    await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      limits: { resultLimit: 100, perDocumentCap: 20, trigramMinSimilarity: 0 },
    });

    expect(corpus.calls.length).toBeGreaterThan(0);
    for (const call of corpus.calls) {
      expect(call.limits?.resultLimit).toBe(DEFAULT_ANSWER_LIMITS.resultLimit);
      expect(call.limits?.perDocumentCap).toBe(DEFAULT_ANSWER_LIMITS.perDocumentCap);
      expect(call.limits?.trigramMinSimilarity).toBe(
        DEFAULT_ANSWER_LIMITS.trigramMinSimilarity,
      );
    }
  });
});

describe("evidence bundle routes", () => {
  it("GET returns the stored bundle, without canonical texts by default", async () => {
    const { app } = makeAnswerApp();
    const created = (await (await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    })).json()) as { runId: string };

    const res = await app.request(`/v1/answers/${created.runId}/evidence-bundle`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as Record<string, unknown>;
    expect(bundle["schema"]).toBe("collex.answer.evidence-bundle/v1");
    expect(bundle["texts"]).toBeUndefined();
    expect(bundle["synthetic"]).toBe(true);
  });

  it("GET ?texts=true carries the canonical texts for full-chain verification", async () => {
    const { app } = makeAnswerApp();
    const created = (await (await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    })).json()) as { runId: string };

    const res = await app.request(`/v1/answers/${created.runId}/evidence-bundle?texts=true`);
    const bundle = (await res.json()) as {
      texts: Record<string, string>;
      evidence: Array<{
        documentVersionId: string;
        quote: string;
        locator: { startChar: number; endChar: number };
      }>;
    };
    const first = bundle.evidence[0]!;
    const canonical = bundle.texts[first.documentVersionId]!;
    const derived = Array.from(canonical)
      .slice(first.locator.startChar, first.locator.endChar)
      .join("");
    expect(derived).toBe(first.quote);
  });

  it("GET returns the cached answer itself", async () => {
    const { app } = makeAnswerApp();
    const created = (await (await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    })).json()) as { runId: string };

    const res = await app.request(`/v1/answers/${created.runId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; guard: { markdownWasGuarded: boolean } };
    expect(body.runId).toBe(created.runId);
    expect(body.guard.markdownWasGuarded).toBe(true);
  });

  it("POST computes an answer and returns ONLY the bundle", async () => {
    const { app, answerStore } = makeAnswerApp();
    const res = await app.request("/v1/evidence-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: Q_NORM_CONTENT, asOf: "2025-06-01" }),
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as Record<string, unknown>;
    expect(bundle["schema"]).toBe("collex.answer.evidence-bundle/v1");
    expect(bundle["trace"]).toBeUndefined();
    expect(bundle["markdown"]).toBeUndefined();
    // The run is still cached, so the GET routes work afterwards.
    expect(answerStore.size).toBe(1);
  });

  it("returns 404 for an unknown run id", async () => {
    const { app } = makeAnswerApp();
    expect((await app.request("/v1/answers/nope")).status).toBe(404);
    expect((await app.request("/v1/answers/nope/evidence-bundle")).status).toBe(404);
  });
});

describe("W12: GET /v1/answers listing + matter filing on POST /v1/answer", () => {
  it("lists stored answers newest first with mode/question/matterId, clamps limit, validates filters", async () => {
    const { app, answerStore } = makeAnswerApp();
    const first = (await (await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" })).json()) as { runId: string };
    const second = (await (await postAnswer(app, { question: Q_UNANSWERABLE, asOf: "2026-06-01" })).json()) as { runId: string };
    // The stored entries carry the W12 fields (contract [P]).
    expect(answerStore.get(first.runId)).toMatchObject({ mode: "local", question: Q_NORM_CONTENT });

    const res = await app.request("/v1/answers");
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as {
      answers: Array<{ runId: string; question: string; status: string; mode: string; matterId: string | null; evidenceCount: number; finalizable: boolean }>;
    }).answers;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.runId).sort()).toEqual([first.runId, second.runId].sort());
    const abstained = rows.find((r) => r.runId === second.runId)!;
    expect(abstained).toMatchObject({ question: Q_UNANSWERABLE, status: "ABSTAIN", mode: "local", matterId: null, evidenceCount: 0, finalizable: false });

    const limited = await app.request("/v1/answers?limit=1");
    expect(((await limited.json()) as { answers: unknown[] }).answers).toHaveLength(1);
    expect((await app.request("/v1/answers?limit=abc")).status).toBe(400);
    expect((await app.request("/v1/answers?matterId=not-a-uuid")).status).toBe(400);
    const empty = await app.request("/v1/answers?matterId=00000000-0000-4000-8000-000000000001");
    expect(((await empty.json()) as { answers: unknown[] }).answers).toEqual([]);
  });

  it("files an answer under an existing matter and refuses an unknown one with 404 before retrieval", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const answerStore = new InMemoryAnswerStore();
    const app = createApp({
      answerPipeline: new AnswerPipeline({
        retrieval: corpus,
        texts: standardTexts(),
        versionFacts: factsPort(STANDARD_FACTS),
        ...deterministicOptions(),
      }),
      answerStore,
    });
    const created = await app.request("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Kaya / Alacak" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const answered = await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01", matterId: id });
    expect(answered.status).toBe(200);
    const { runId } = (await answered.json()) as { runId: string };
    expect(answerStore.get(runId)?.matterId).toBe(id);

    const page = (await (await app.request(`/v1/matters/${id}`)).json()) as {
      items: { answers: Array<{ refId: string | null; payload: Record<string, unknown> }> };
    };
    expect(page.items.answers).toHaveLength(1);
    expect(page.items.answers[0]!.refId).toBe(runId);
    expect(page.items.answers[0]!.payload).toMatchObject({ question: Q_NORM_CONTENT, status: "COMPLETE", mode: "local" });

    const calls = corpus.calls.length;
    const refused = await postAnswer(app, { question: Q_NORM_CONTENT, matterId: "00000000-0000-4000-8000-00000000dead" });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { error: { kind: string; message: string } }).error).toMatchObject({ kind: "MATTER_NOT_FOUND" });
    expect(corpus.calls).toHaveLength(calls);
    expect(answerStore.size).toBe(1);
  });

  it("W12-API2: ?fileId lists the answers asked over one upload; summaries and matter items carry fileScope", async () => {
    const { app } = makeAnswerApp();
    const created = await app.request("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Şahin / Kira" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const scopedRes = await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      matterId: id,
      filters: { fileIds: ["abc123def4567890"], includeCorpus: false },
    });
    expect(scopedRes.status).toBe(200);
    const scoped = (await scopedRes.json()) as { runId: string; fileScope?: { fileIds: string[]; includeCorpus: boolean } };
    expect(scoped.fileScope).toEqual({ fileIds: ["abc123def4567890"], includeCorpus: false });
    const plain = (await (await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" })).json()) as { runId: string };

    type Row = { runId: string; mode: string; fileScope?: { fileIds: string[]; includeCorpus: boolean } };
    const rowsOf = async (url: string): Promise<Row[]> => {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
      return ((await res.json()) as { answers: Row[] }).answers;
    };

    const byFile = await rowsOf("/v1/answers?fileId=abc123def4567890");
    expect(byFile.map((r) => r.runId)).toEqual([scoped.runId]);
    expect(byFile[0]).toMatchObject({ mode: "local", fileScope: { fileIds: ["abc123def4567890"], includeCorpus: false } });

    const all = await rowsOf("/v1/answers");
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.runId === plain.runId)?.fileScope).toBeUndefined();
    expect(all.find((r) => r.runId === scoped.runId)?.fileScope).toEqual({ fileIds: ["abc123def4567890"], includeCorpus: false });

    expect(await rowsOf("/v1/answers?fileId=0000000000000000")).toEqual([]);
    expect((await rowsOf(`/v1/answers?fileId=abc123def4567890&matterId=${id}`)).map((r) => r.runId)).toEqual([scoped.runId]);
    // An empty fileId means "no filter", like an empty matterId.
    expect(await rowsOf("/v1/answers?fileId=")).toHaveLength(2);

    for (const bad of ["/v1/answers?fileId=bo%C5%9Fluk%20var", `/v1/answers?fileId=${"x".repeat(201)}`]) {
      const res = await app.request(bad);
      expect(res.status, bad).toBe(400);
      const body = (await res.json()) as { error: { kind: string; issues: Array<{ path: string; message: string }> } };
      expect(body.error.kind).toBe("INVALID_REQUEST");
      expect(body.error.issues[0]).toMatchObject({ path: "fileId" });
      expect(body.error.issues[0]!.message).toMatch(/Belge kimliği/u);
    }

    // The matter page's answer item (auto-linked) carries the scope, so the
    // console can label it "Belge" rather than "Yerel".
    const page = (await (await app.request(`/v1/matters/${id}`)).json()) as {
      items: { answers: Array<{ refId: string | null; payload: Record<string, unknown> }> };
    };
    expect(page.items.answers).toHaveLength(1);
    expect(page.items.answers[0]!.refId).toBe(scoped.runId);
    expect(page.items.answers[0]!.payload).toMatchObject({
      mode: "local",
      fileScope: { fileIds: ["abc123def4567890"], includeCorpus: false },
    });
  });

  it("passes useCloudAi/file-scope fields through the schema (rule-based fallback warns AI_UNAVAILABLE)", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const app = createApp({
      answerPipeline: new AnswerPipeline({
        retrieval: corpus,
        texts: standardTexts(),
        versionFacts: factsPort(STANDARD_FACTS),
        ...deterministicOptions(),
      }),
    });
    const res = await postAnswer(app, {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useCloudAi: true,
      filters: { fileIds: ["abc123"], includeCorpus: true },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[]; aiUsed: { drafter: boolean }; fileScope?: { fileIds: string[] } };
    expect(body.warnings.some((w) => w.startsWith("AI_UNAVAILABLE:"))).toBe(true);
    expect(body.aiUsed.drafter).toBe(false);
    expect(corpus.calls[0]?.filters).toEqual({ fileIds: ["abc123"], includeCorpus: true });
  });
});

/**
 * W14 L-VERIFY V-6 — `GET /v1/answers` used to accept `q` and `status` on the
 * wire and drop them on the floor: `?q=zzzzunlikely` returned every row and
 * `?status=COMPLETE` returned ABSTAIN rows, while BOTH stores implemented the
 * clauses. `?bogus=1` answered 200 where `/v1/files?bogusparam=1` answered a
 * typed 400. Measured on a real server (collex_api_test, port 8972) before the
 * fix; these tests fail without the server.ts pass-through.
 */
describe("W14 L-VERIFY V-6: GET /v1/answers really applies q and status", () => {
  /** Two answers with DIFFERENT questions and DIFFERENT statuses. */
  async function seeded(): Promise<{ app: ReturnType<typeof createApp>; complete: string; abstain: string }> {
    const { app } = makeAnswerApp();
    const complete = (await (
      await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" })
    ).json()) as { runId: string };
    const abstain = (await (
      await postAnswer(app, { question: Q_UNANSWERABLE, asOf: "2026-06-01" })
    ).json()) as { runId: string };
    return { app, complete: complete.runId, abstain: abstain.runId };
  }

  type Row = { runId: string; question: string; status: string };
  const rowsOf = async (app: ReturnType<typeof createApp>, url: string): Promise<Row[]> => {
    const res = await app.request(url);
    expect(res.status, url).toBe(200);
    return ((await res.json()) as { answers: Row[] }).answers;
  };

  it("?q= filters by question text instead of returning the unfiltered list", async () => {
    const { app, complete } = await seeded();
    expect(await rowsOf(app, "/v1/answers")).toHaveLength(2);

    // The exact repro from the report: a needle that matches nothing.
    expect(await rowsOf(app, "/v1/answers?q=zzzzunlikely&limit=5")).toEqual([]);

    // A needle that matches exactly one question, case-insensitively.
    const needle = Q_NORM_CONTENT.slice(0, 12);
    const hit = await rowsOf(app, `/v1/answers?q=${encodeURIComponent(needle.toLocaleUpperCase("tr-TR"))}`);
    expect(hit.map((r) => r.runId)).toEqual([complete]);

    // Whitespace is not a filter.
    expect(await rowsOf(app, "/v1/answers?q=%20%20")).toHaveLength(2);
    expect(await rowsOf(app, "/v1/answers?q=")).toHaveLength(2);
  });

  it("?status= returns only that status — never an ABSTAIN row under COMPLETE", async () => {
    const { app, complete, abstain } = await seeded();
    const completes = await rowsOf(app, "/v1/answers?status=COMPLETE&limit=10");
    expect(completes.map((r) => r.runId)).toEqual([complete]);
    expect(completes.every((r) => r.status === "COMPLETE")).toBe(true);

    const abstains = await rowsOf(app, "/v1/answers?status=ABSTAIN");
    expect(abstains.map((r) => r.runId)).toEqual([abstain]);

    // q and status compose.
    expect(await rowsOf(app, `/v1/answers?status=ABSTAIN&q=${encodeURIComponent(Q_NORM_CONTENT.slice(0, 12))}`)).toEqual([]);
  });

  it("refuses an unknown query parameter and an unknown status with the /v1/files 400", async () => {
    const { app } = await seeded();
    for (const [url, path] of [
      ["/v1/answers?bogus=1", "bogus"],
      ["/v1/answers?statuss=COMPLETE", "statuss"],
    ] as const) {
      const res = await app.request(url);
      expect(res.status, url).toBe(400);
      const body = (await res.json()) as { error: { kind: string; issues: Array<{ path: string; message: string }> } };
      expect(body.error.kind).toBe("INVALID_REQUEST");
      expect(body.error.issues.map((i) => i.path)).toContain(path);
      // Machine code never stands alone: the sentence names the parameters.
      expect(body.error.issues[0]!.message).toMatch(/Tanınmayan sorgu parametresi/u);
    }

    const badStatus = await app.request("/v1/answers?status=TAMAMLANDI");
    expect(badStatus.status).toBe(400);
    const statusBody = (await badStatus.json()) as { error: { issues: Array<{ path: string; message: string }> } };
    expect(statusBody.error.issues[0]).toMatchObject({ path: "status" });
    expect(statusBody.error.issues[0]!.message).toContain("ABSTAIN");

    const longQ = await app.request(`/v1/answers?q=${"a".repeat(201)}`);
    expect(longQ.status).toBe(400);
    expect(((await longQ.json()) as { error: { issues: Array<{ path: string }> } }).error.issues[0]).toMatchObject({ path: "q" });

    // The parameters that always worked still work.
    expect((await app.request("/v1/answers?matterId=&fileId=&q=&status=&limit=2")).status).toBe(200);
  });
});

/**
 * W14 L-VERIFY V-3 — `POST /v1/sources/search` answered 502
 * UPSTREAM_UNAVAILABLE on a server started WITH `--with-mcp`, whose
 * `/v1/research/health` reported `{gateway:"ok", toolCount:54}` at the same
 * moment (measured on port 8972 before the fix). `createApp` built the live
 * gateway for the research router only; the sources mount read `deps.gateway`,
 * which `serve.mjs` never passes.
 */
describe("W14 L-VERIFY V-3: the live MCP gateway also reaches /v1/sources/*", () => {
  const searchBody = JSON.stringify({ query: "tahliye taahhüdü", sources: ["yargitay"], limit: 5 });
  const post = (app: ReturnType<typeof createApp>, path: string, body: string) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body });

  /** One Bedesten row, in the shape `research/payloads.ts` narrows. */
  const bedestenRows = (): Outcome<unknown> => ({
    status: "ok",
    data: {
      decisions: [
        {
          documentId: "yg-2023-1234",
          itemType: { name: "YARGITAYKARARI" },
          birimAdi: "3. Hukuk Dairesi",
          esasNo: "2023/1234",
          kararNo: "2023/5678",
          kararTarihiStr: "2023-05-04",
        },
      ],
      total: 1,
    },
    provider: "BEDESTEN",
    observedAt: "2026-09-02T00:00:00Z",
    warnings: [],
  });

  it("returns real künye rows when the gateway arrives as `researchGateway` (the --with-mcp shape)", async () => {
    const gateway = new FakeGateway(() => bedestenRows());
    // NOTE: `gateway` is NOT passed — this is exactly what serve.mjs --with-mcp
    // produces, where the live session gateway is built from `deps.mcp`.
    const app = createApp({ researchGateway: gateway });
    const res = await post(app, "/v1/sources/search", searchBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ externalId: string; sourceId: string; fetchKind?: string }>;
      failedSources: unknown[];
      okSources: string[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ externalId: "yg-2023-1234", sourceId: "yargitay", fetchKind: "karar" });
    expect(body.failedSources).toEqual([]);
    expect(body.okSources).toEqual(["yargitay"]);
    expect(gateway.calls[0]?.toolName).toBe("search_bedesten_unified");
  });

  it("an explicit deps.gateway still wins, and /v1/sources/fetch is wired the same way", async () => {
    const explicit = new FakeGateway(() => bedestenRows());
    const live = new FakeGateway(() => bedestenRows());
    const app = createApp({ gateway: explicit, researchGateway: live });
    expect((await post(app, "/v1/sources/search", searchBody)).status).toBe(200);
    expect(explicit.calls).toHaveLength(1);
    expect(live.calls).toHaveLength(0);

    const fetched = await post(
      createApp({ researchGateway: new FakeGateway(() => bedestenRows()) }),
      "/v1/sources/fetch",
      JSON.stringify({ kind: "karar", externalId: "yg-2023-1234" }),
    );
    // Reached the gateway: the answer is about the DOCUMENT, not about a
    // missing gateway. (The fake returns a search payload, so the card fails
    // to build — a per-document failure, which is the honest outcome.)
    const body = (await fetched.json()) as { error?: { kind: string; message: string } };
    expect(body.error?.kind).not.toBe("UPSTREAM_UNAVAILABLE");
  });

  it("without any gateway it still refuses — honestly, and without telling the lawyer to redo what they did", async () => {
    const app = createApp({});
    const res = await post(app, "/v1/sources/search", searchBody);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
    // Lawyer Turkish leads; the operator flag is a trailing clause, not the
    // instruction the reader meets first (L-VERIFY V-3, B-27).
    expect(body.error.message).toMatch(/^Resmî kaynak geçidi bu sunucuda açık değil/u);
    expect(body.error.message).toContain("başlatıcıyla");
    expect(body.error.message.indexOf("--with-mcp")).toBeGreaterThan(
      body.error.message.indexOf("başlatıcıyla"),
    );
  });
});

describe("operator console route", () => {
  it("serves the self-contained page with a hash-pinned CSP", async () => {
    const { app } = makeAnswerApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'sha256-");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-inline");

    const html = await res.text();
    // W15 şerit D: the seal now says what it does. "Ara ve doğrula" read as a
    // promise of a "verified answer"; what is verified is that each quote is
    // character-for-character the one in the stored document.
    expect(html).toContain("Ara ve dayanağıyla getir");
    // The honesty banner is a mechanism, not a wording: the page must carry the
    // element the renderer fills with the server's corpusNotice on every answer.
    expect(html).toContain('id="corpus-notice"');
  });

  it("serves the same page at /console", async () => {
    const { app } = makeAnswerApp();
    const res = await app.request("/console");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ColleX");
    expect(html).toContain('id="corpus-notice"');
  });

  it("can be turned off for an API-only deployment", async () => {
    const app = createApp({ serveConsole: false });
    expect((await app.request("/")).status).toBe(404);
  });
});

describe("corpus-only deployment", () => {
  it("answers 503 on /v1/search when no provider gateway is configured", async () => {
    const { app } = makeAnswerApp();
    const res = await app.request("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "dolandırıcılık" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("SEARCH_UNAVAILABLE");
  });

  it("still serves /v1/health", async () => {
    const { app } = makeAnswerApp();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { registeredToolCount: number }).registeredToolCount).toBe(54);
  });

  it("still drives a research run with a default in-memory store", async () => {
    const app = createApp({});
    const res = await app.request("/v1/research-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "kıdem tazminatı" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /v1/answer stores texts only up to MAX_STORED_TEXT_BYTES (W12-FIX2, P1-5b)", () => {
  it("a run whose canonical texts exceed the cap is stored without them and warns STORED_WITHOUT_TEXTS", async () => {
    const bigText = "Kira sözleşmesi hükümleri. ".repeat(220_000); // ~5.9 MB of UTF-8
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(new Map([["v-big", bigText]])),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
    const answerStore = new InMemoryAnswerStore();
    const app = createApp({
      answerPipeline: {
        answer: async (request) => {
          const run = await pipeline.answer(request);
          return { ...run, pack: { ...run.pack, texts: { ...run.pack.texts, "v-big": bigText } } };
        },
      },
      answerStore,
    });
    const res = await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; warnings: string[] };
    expect(body.warnings.some((w) => w.startsWith(`${STORED_WITHOUT_TEXTS}:`))).toBe(true);
    const stored = answerStore.get(body.runId)!;
    expect(stored.bundle.texts).toBeUndefined();
    expect(stored.result.warnings.some((w) => w.startsWith(`${STORED_WITHOUT_TEXTS}:`))).toBe(true);
    const bundle = await app.request(`/v1/answers/${body.runId}/evidence-bundle?texts=true`);
    expect(bundle.status).toBe(200);
    expect((await bundle.json() as { texts?: unknown }).texts).toBeUndefined();

    // A normal run keeps its texts and carries no such warning.
    const small = await postAnswer(createApp({ answerPipeline: pipeline, answerStore }), { question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    const smallBody = (await small.json()) as { runId: string; warnings: string[] };
    expect(smallBody.warnings.some((w) => w.startsWith(`${STORED_WITHOUT_TEXTS}:`))).toBe(false);
    expect(answerStore.get(smallBody.runId)?.bundle.texts).toBeDefined();
  });
});

describe("request-body limits (W12-FIX2, P2-13)", () => {
  it("refuses a JSON body over 1 MiB with a typed 413 before any route work; small bodies pass", async () => {
    expect(JSON_BODY_LIMIT_BYTES).toBe(1024 * 1024);
    let pipelineCalls = 0;
    const app = createApp({
      answerPipeline: {
        answer: async () => {
          pipelineCalls += 1;
          throw new Error("must not be reached");
        },
      },
    });
    const oversized = JSON.stringify({ question: "x".repeat(JSON_BODY_LIMIT_BYTES + 10) });
    const res = await app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { kind: "PAYLOAD_TOO_LARGE", message: PAYLOAD_TOO_LARGE_MESSAGE_TR } });
    expect(pipelineCalls).toBe(0);
    // With an explicit content-length the stream is never read either.
    const declared = await app.request("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(JSON_BODY_LIMIT_BYTES + 1) },
      body: JSON.stringify({ title: "x" }),
    });
    expect(declared.status).toBe(413);
    // Every JSON router is behind the same limit (drafts, matters, settings).
    for (const [path, method] of [["/v1/drafts", "POST"], ["/v1/settings", "PUT"], ["/v1/matters", "POST"]] as const) {
      const r = await app.request(path, { method, headers: { "content-type": "application/json" }, body: oversized });
      expect(r.status, path).toBe(413);
    }
    // A normal-sized body still reaches validation (400, not 413).
    const small = await app.request("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(small.status).toBe(400);
  });
});


// ---------------------------------------------------------------------------
// W14 B-04 — localGuard: DNS rebinding (read) + CSRF (write) + /v1/* headers
// ---------------------------------------------------------------------------

describe("B-04 localGuard", () => {
  /**
   * ENGRISK proved all three of these against a running instance on port
   * 8934: a foreign Origin POST created a matter (201), a foreign Origin
   * multipart upload put a document in the corpus (200), and a foreign Host
   * answered 200 — which with DNS rebinding is full READ access to
   * /v1/answers?texts=true and /v1/settings.
   */
  function guardedApp() {
    let pipelineCalls = 0;
    const app = createApp({
      answerPipeline: {
        answer: async () => {
          pipelineCalls += 1;
          throw new Error("pipeline must not be reached for a refused request");
        },
      },
    });
    return { app, calls: () => pipelineCalls };
  }

  it("a foreign Host is 421 and never reaches a route (DNS rebinding, E5)", async () => {
    const { app, calls } = guardedApp();
    for (const host of ["evil.example", "evil.example:8787", "192.168.1.9:8787", "collex.local"]) {
      const res = await app.request("/v1/answers", { headers: { host } });
      expect(res.status, host).toBe(421);
      expect(((await res.json()) as { error: { kind: string; message: string } }).error).toEqual({
        kind: "FOREIGN_HOST",
        message: FOREIGN_HOST_MESSAGE_TR,
      });
    }
    // Reads are what matters here: the settings and the stored answers are
    // client data and a rebound page could read both.
    expect((await app.request("/v1/settings", { headers: { host: "evil.example" } })).status).toBe(421);
    expect((await app.request("/v1/health", { headers: { host: "evil.example" } })).status).toBe(421);
    expect(calls()).toBe(0);
  });

  it("loopback Host names still pass, on every port and in IPv6 form", async () => {
    const { app } = guardedApp();
    for (const host of ["127.0.0.1:8787", "localhost", "localhost:8898", "[::1]:8787"]) {
      expect((await app.request("/v1/health", { headers: { host } })).status, host).toBe(200);
    }
  });

  it("a foreign Origin on a state-changing method is 403 and the pipeline is NOT called (CSRF, E4)", async () => {
    const { app, calls } = guardedApp();
    // text/plain is CORS-safelisted: the browser sends it with no preflight,
    // which is exactly how the measured 201 happened.
    const res = await app.request("/v1/matters", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      body: JSON.stringify({ title: "saldırgan" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { kind: string; message: string } }).error).toEqual({
      kind: "FORBIDDEN_ORIGIN",
      message: FORBIDDEN_ORIGIN_MESSAGE_TR,
    });

    const answer = await app.request("/v1/answer", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ question: "kira" }),
    });
    expect(answer.status).toBe(403);
    expect(calls()).toBe(0);

    // ADR-018's per-request consent is a body field the attacker writes
    // themselves, so /v1/ai/* must be refused by the SAME gate.
    const ai = await app.request("/v1/ai/analyze-document", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ fileId: "0123456789abcdef", useCloudAi: true }),
    });
    expect(ai.status).toBe(403);

    // Sec-Fetch-Site is the second signal: a cross-site request that omits
    // Origin (a form post) still carries it.
    const site = await app.request("/v1/matters", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(site.status).toBe(403);
  });

  it("a POST without Origin (curl, demo.mjs, the CLI probes) is untouched", async () => {
    const { app } = guardedApp();
    const res = await app.request("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    // 400 = the route ran and validated; the guard did not interfere.
    expect(res.status).toBe(400);

    // The console is same-origin and keeps working.
    const sameOriginHeaders: Record<string, string>[] = [
      { origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787", "content-type": "application/json" },
      { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      { "sec-fetch-site": "none", "content-type": "application/json" },
    ];
    for (const headers of sameOriginHeaders) {
      const r = await app.request("/v1/matters", { method: "POST", headers, body: JSON.stringify({ title: "" }) });
      expect(r.status).toBe(400);
    }
  });

  it("/v1/* responses carry no-store + nosniff + no-referrer (E14)", async () => {
    const { app: answerApp } = makeAnswerApp();
    const created = await postAnswer(answerApp, { question: Q_NORM_CONTENT });
    const runId = ((await created.json()) as { runId: string }).runId;

    // The evidence bundle returns the full text of client documents; without
    // no-store it lands in the browser's disk cache.
    const bundle = await answerApp.request(`/v1/answers/${runId}/evidence-bundle?texts=true`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("cache-control")).toBe("no-store");
    expect(bundle.headers.get("x-content-type-options")).toBe("nosniff");
    expect(bundle.headers.get("referrer-policy")).toBe("no-referrer");

    const health = await answerApp.request("/v1/health");
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(health.headers.get(name), name).toBe(value);
    }
  });

  it("the console page keeps its own CSP headers and is not given the /v1 set", async () => {
    const { app } = makeApp();
    const res = await app.request("/");
    // Whether the page loads depends on the build; when it does, its own
    // hash-pinned CSP must still be the one served (localGuard only adds
    // headers under /v1/).
    if (res.status === 200) {
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  });

  it("pure helpers: hostnameOf / isLocalHostHeader / isOwnOrigin", () => {
    expect(hostnameOf("127.0.0.1:8787")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:8787")).toBe("::1");
    expect(hostnameOf("http://localhost:8787")).toBe("localhost");
    expect(hostnameOf(undefined)).toBe("");
    expect(isLocalHostHeader(undefined)).toBe(true);
    expect(isLocalHostHeader("localhost:8787")).toBe(true);
    expect(isLocalHostHeader("evil.example")).toBe(false);
    expect(isOwnOrigin("http://127.0.0.1:8787", "127.0.0.1:8787")).toBe(true);
    expect(isOwnOrigin("https://evil.example", "127.0.0.1:8787")).toBe(false);
    // A sandboxed iframe / data: document sends Origin: null.
    expect(isOwnOrigin("null", "127.0.0.1:8787")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// W14 B-03 — /v1/backup + /v1/health.backup
// ---------------------------------------------------------------------------

describe("B-03 backup route", () => {
  const summary = {
    path: "C:\\Users\\x\\ColleX-Yedek\\20260902-140000",
    lastAt: "2026-09-02T14:00:00.000Z",
    sizeBytes: 120_385,
    files: 3,
    stale: false,
  };

  function backupApp(port: Partial<BackupPort> = {}) {
    const calls = { run: 0, last: 0 };
    const backup: BackupPort = {
      run: async () => {
        calls.run += 1;
        return {
          path: summary.path,
          dumpFile: "collex_local.dump",
          sizeBytes: summary.sizeBytes,
          files: summary.files,
          at: summary.lastAt,
          database: "collex_local",
          warning: "Bu klasör müvekkil verisi içerir — şifreli bir diske koyun (Windows'ta BitLocker, Mac'te FileVault ile şifrelenmiş bir disk).",
        };
      },
      last: async () => {
        calls.last += 1;
        return summary;
      },
      ...port,
    };
    return { app: createApp({ backup }), calls };
  }

  it("POST /v1/backup returns path/sizeBytes/files/at and the client-data warning", async () => {
    const { app, calls } = backupApp();
    const res = await app.request("/v1/backup", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["path"]).toBe(summary.path);
    expect(body["sizeBytes"]).toBe(summary.sizeBytes);
    expect(body["files"]).toBe(summary.files);
    expect(body["database"]).toBe("collex_local");
    expect(String(body["warning"])).toContain("şifreli bir diske");
    expect(calls.run).toBe(1);
  });

  it("a second concurrent backup is refused with 409, not started", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const app = createApp({
      backup: {
        run: async () => {
          runs += 1;
          await gate;
          return {
            path: "p",
            dumpFile: "collex_local.dump",
            sizeBytes: 1,
            files: 0,
            at: "2026-09-02T00:00:00.000Z",
            database: "collex_local",
            warning: "w",
          };
        },
        last: async () => null,
      },
    });
    const first = app.request("/v1/backup", { method: "POST" });
    const second = await app.request("/v1/backup", { method: "POST" });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { kind: string; message: string } }).error).toEqual({
      kind: "BACKUP_IN_PROGRESS",
      message: BACKUP_IN_PROGRESS_MESSAGE_TR,
    });
    release?.();
    expect((await first).status).toBe(200);
    expect(runs).toBe(1);
  });

  it("a failed backup answers a typed 500 with the runner's Turkish message", async () => {
    const { app } = backupApp({
      run: async () => {
        const err = Object.assign(new Error("Veritabanı yedeği alınamadı (collex_local): bağlantı yok"), {
          kind: "DUMP_FAILED",
        });
        throw err;
      },
    });
    const res = await app.request("/v1/backup", { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("DUMP_FAILED");
    expect(body.error.message).toContain("Veritabanı yedeği alınamadı");
  });

  it("/v1/health carries `backup` additively; null without a runner", async () => {
    const { app } = backupApp();
    const withBackup = (await (await app.request("/v1/health")).json()) as Record<string, unknown>;
    expect(withBackup["backup"]).toEqual(summary);

    const { app: plain } = makeApp();
    const without = (await (await plain.request("/v1/health")).json()) as Record<string, unknown>;
    expect(without["backup"]).toBeNull();
    // /v1/backup is not mounted at all when no runner is configured.
    expect((await plain.request("/v1/backup", { method: "POST" })).status).toBe(404);
  });

  it("/v1/health carries `rls` additively (B-05); null without a database", async () => {
    const { app } = makeApp();
    const body = (await (await app.request("/v1/health")).json()) as Record<string, unknown>;
    expect(body["rls"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// W14 phase C · V-19 — a rejected field is NAMED
// ---------------------------------------------------------------------------
//
// MEASURED (W14-F-VERIFY §3, V-19): every `.strict()` route answered a stray
// field with `{"path":"","label":"","message":"Tanınmayan alan."}`. zod
// reports an `unrecognized_keys` issue at the PARENT object, so for a
// top-level body `issue.path` is the empty array — and an issue whose `path`
// is "" is an issue no interface can point at. The lawyer was told a field is
// unrecognized and never told which one.

describe("V-19 · unrecognized keys name the offending field", () => {
  it("fieldIssues emits ONE issue per stray key, at the key's own path", () => {
    const schema = z
      .object({ a: z.string(), nested: z.object({ b: z.string() }).strict("Tanınmayan alan.") })
      .strict("Tanınmayan alan.");
    const parsed = schema.safeParse({ a: "x", bogus: 1, other: 2, nested: { b: "y", ic: 3 } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = fieldIssues(parsed.error);
    const paths = issues.map((i) => i.path).sort();
    // Two stray top-level fields are TWO issues, not one dotted path "a.b".
    expect(paths).toEqual(["bogus", "nested.ic", "other"]);
    for (const issue of issues) {
      expect(issue.path).not.toBe("");
      expect(issue.message).toBe(UNRECOGNIZED_FIELD_MESSAGE_TR);
    }
  });

  it("a prefix is applied, and non-strict issues keep zod's own path", () => {
    const schema = z.object({ text: z.string({ required_error: "Bu alan zorunludur." }) });
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldIssues(parsed.error, undefined, "payload.")).toEqual([
      { path: "payload.text", message: "Bu alan zorunludur." },
    ]);
  });

  it("POST /v1/drafts names the stray field AND gives it a Turkish label", async () => {
    const { app } = makeApp();
    const res = await app.request("/v1/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template: "dava-dilekcesi", bogusAlan: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { issues: Array<{ path: string; label: string; message: string }> };
    };
    const stray = body.error.issues.find((i) => i.message === UNRECOGNIZED_FIELD_MESSAGE_TR);
    expect(stray).toBeDefined();
    expect(stray?.path).toBe("bogusAlan");
    // Not "" — and not the bare key echoed back as a "human label" either.
    expect(stray?.label).toBe("Fazladan alan (bogusAlan)");
    // Every other issue in the same response still carries its own path.
    for (const issue of body.error.issues) expect(issue.path).not.toBe("");
  });

  it("POST /v1/answer names the stray field too", async () => {
    const { app } = makeAnswerApp();
    const res = await app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Depozito ne zaman iade edilir?", bilinmeyen: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { issues: Array<{ path: string; message: string }> };
    };
    expect(body.error.issues.map((i) => i.path)).toContain("bilinmeyen");
    for (const issue of body.error.issues) expect(issue.path).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// W14 phase C · N-1 — the two trigram thresholds, and which one /v1/answer uses
// ---------------------------------------------------------------------------
//
// W14-F-VERIFY §2.3 proved that the selective-trigram figures quoted in
// W14-L-VERIFY §2.2 and W14-F-PERF §2 were measured at
// `pg_trgm.word_similarity_threshold = 0.5`, while `/v1/answer` runs the lane
// at DEFAULT_ANSWER_LIMITS.trigramMinSimilarity = 0.35. This test pins the two
// values AND pins that `chunkStore.ts` still SAYS which threshold its numbers
// belong to — a comment nobody can check is the thing that rotted.
//
// Phase C measured raising the answer path to 0.5 (probe `collex_srv_test`,
// 20 000 chunks / avg 5 749 code points; and `run_evals --run-date
// 2026-09-03`): no measured time saved, and `fx-amend-003` lost its
// CONFLICTING_AUTHORITIES qualification. 0.35 stays, on purpose.

describe("N-1 · trigram threshold provenance", () => {
  it("the answer tier is 0.35, the retrieval default is 0.5, and a client may only raise", () => {
    expect(DEFAULT_ANSWER_LIMITS.trigramMinSimilarity).toBe(0.35);
    expect(DEFAULT_SEARCH_LIMITS.trigramMinSimilarity).toBe(0.5);
    // A request can ask for LESS work (a higher threshold) and never for more.
    expect(clampAnswerLimits(DEFAULT_ANSWER_LIMITS, { trigramMinSimilarity: 0.9 }).trigramMinSimilarity).toBe(0.9);
    expect(clampAnswerLimits(DEFAULT_ANSWER_LIMITS, { trigramMinSimilarity: 0.1 }).trigramMinSimilarity).toBe(0.35);
  });

  it("chunkStore.ts states which threshold its measurements were taken at", async () => {
    const raw = await readFile(
      fileURLToPath(new URL("../src/store/chunkStore.ts", import.meta.url)),
      "utf8",
    );
    // The block comment wraps, so it is read with its whitespace collapsed.
    const source = raw.replace(/\n\s*\*/gu, " ").replace(/\s+/gu, " ");
    // Both defaults are named, so a reader knows the two are different.
    expect(source).toContain("DEFAULT_ANSWER_LIMITS.trigramMinSimilarity = 0.35");
    expect(source).toContain("DEFAULT_SEARCH_LIMITS.trigramMinSimilarity = 0.5");
    // …and the old numbers are labelled with the threshold they belong to.
    expect(source).toContain("was taken at **0.5**");
    expect(source).toContain("runs this lane at **0.35 and never at 0.5**");
  });
});
