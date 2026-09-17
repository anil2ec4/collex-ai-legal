/**
 * W21 lane C, round two: the cloud judge, the data-boundary setting and the
 * loopback test tell no more than they know. Every test here failed on the
 * code before the fix.
 *
 *   R2-27  a cloud judge score outside 0..1 (a 0-10 "7", a 0-100 "95") is no
 *          answer, exactly as on the local judge; it used to be clamped to 1
 *          and finalize a claim the judge scored 70%;
 *   R2-30  COLLEX_DATA_BOUNDARY is read the way COLLEX_AI_POLICY is: spelling
 *          forgiven ("LOCAL-ONLY", "local only"), an unrecognized value fails
 *          closed to LOCAL_ONLY with a warning health shows. It used to
 *          become ALLOW_CLOUD silently;
 *   R2-31  only 127/8 and the exact 0.0.0.0 are loopback. The rest of 0/8
 *          ("this network", routable on Linux) used to be LOCAL_PROCESS.
 *
 * (R2-29, the draft-paragraph route, is in tests/ai/routes.test.ts.)
 * No real model is called: every transport is scripted.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/server.js";
import {
  UNRECOGNIZED_BOUNDARY_TR,
  decideProvider,
  resolveEffectiveAiPolicy,
  type AiPolicyHealth,
} from "../../src/llm/aiPolicy.js";
import { AnthropicAnswerAdapter, AnthropicApiError } from "../../src/llm/anthropicAdapter.js";
import { boundaryAllows, classifyEndpoint } from "../../src/llm/endpointTrust.js";
import { LocalGenerationAdapter } from "../../src/llm/localGenerationAdapter.js";
import {
  parseDataBoundary,
  resolveDataBoundary,
  resolveLocalGenerationConfig,
} from "../../src/llm/localGenerationConfig.js";
import { resolveModelRoutes } from "../../src/llm/providerFactory.js";
import { AnswerPipeline, type AnswerRun } from "../../src/pipeline/answerPipeline.js";
import { applyDataBoundaryToEmbedding, resolveEmbeddingConfig } from "../../src/retrieval/embeddingConfig.js";
import type { EvidenceRef } from "../../src/evidence/types.js";
import { fakeAnthropic, type ReplyFn } from "../ai/fakeAnthropic.js";
import {
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  standardTexts,
  StubCorpus,
} from "../pipeline/fakes.js";

const KEY = "sk-ant-TEST-anahtar-ikinci-tur-asla-loglanmaz";

const noFetch = (async () => {
  throw new Error("no request may be made while resolving routes");
}) as unknown as typeof fetch;

function evidence(id: string, quote: string): EvidenceRef {
  return {
    evidenceId: id,
    documentId: "doc-1",
    documentVersionId: "ver-1",
    chunkId: "chunk-1",
    source: "MEVZUAT",
    sourceUrl: "",
    title: "Sentetik Kanun",
    locator: { article: "157", startChar: 0, endChar: 10 },
    quote,
    quoteSha256: "00",
    contentSha256: "00",
    retrievedAt: "2026-09-02T00:00:00.000Z",
  };
}

function cloudAdapter(reply: ReplyFn) {
  const fake = fakeAnthropic(reply);
  const adapter = new AnthropicAnswerAdapter({
    apiKey: KEY,
    fetchImpl: fake.fetchImpl,
    retryBaseDelayMs: 0,
    sleep: async () => {},
  });
  return { adapter, calls: fake.calls };
}

const judgeReplying =
  (toolInput: unknown): ReplyFn =>
  () => ({ toolInput });

// ---------------------------------------------------------------------------
// R2-27
// ---------------------------------------------------------------------------

describe("R2-27 the cloud judge rejects a score outside 0..1 exactly like the local judge", () => {
  it("a 0-10 or 0-100 score, or a negative one, is MALFORMED, never clamped to a finalizing 1", async () => {
    for (const score of [7, 95, 1.0001, -0.2]) {
      const { adapter } = cloudAdapter(judgeReplying({ entails: true, score, rationale: "uyuyor" }));
      const outcome = adapter.assess("iddia", evidence("ev-1", "pasaj"));
      await expect(outcome, String(score)).rejects.toBeInstanceOf(AnthropicApiError);
      await expect(outcome, String(score)).rejects.toMatchObject({ code: "MALFORMED" });
    }
  });

  it("the same reply from the local judge is also no answer (parity)", async () => {
    const local = new LocalGenerationAdapter({
      config: {
        baseUrl: "http://127.0.0.1:11434",
        model: "yerel-sinama-modeli",
        trust: "LOCAL_PROCESS",
        authority: "127.0.0.1:11434",
        contextTokens: 8192,
        maxOutputTokens: 512,
        concurrency: 1,
        timeoutMs: 5_000,
        authenticated: false,
        warnings: [],
      },
      boundary: "LOCAL_ONLY",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ entails: true, score: 7, rationale: "uyuyor" }) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
    });
    await expect(local.assess("iddia", evidence("ev-1", "pasaj"))).rejects.toMatchObject({ code: "MALFORMED_JSON" });
  });

  it("non-vacuity: the bounds themselves and an in-range score pass through unchanged", async () => {
    for (const score of [0, 0.42, 0.9, 1]) {
      const { adapter } = cloudAdapter(judgeReplying({ entails: score >= 0.5, score, rationale: "r" }));
      await expect(adapter.assess("iddia", evidence("ev-1", "pasaj"))).resolves.toEqual({
        entails: score >= 0.5,
        score,
        rationale: "r",
      });
    }
  });

  it("the request states the scale in words; no unenforced numeric bound is relied on", async () => {
    const { adapter, calls } = cloudAdapter(judgeReplying({ entails: true, score: 0.9, rationale: "r" }));
    await adapter.assess("iddia", evidence("ev-1", "pasaj"));
    const schema = calls[0]!.body.tools[0]!.input_schema as {
      properties: { score: Record<string, unknown> };
    };
    expect(schema.properties.score["type"]).toBe("number");
    expect(schema.properties.score["minimum"]).toBeUndefined();
    expect(schema.properties.score["maximum"]).toBeUndefined();
    expect(String(schema.properties.score["description"])).toContain("0 ile 1 arasında");
    expect(calls[0]!.body.system).toContain("0 ile 1 arasında bir olasılık");
  });

  describe("through the real answer pipeline (useCloudAi)", () => {
    /** A cloud that drafts one claim citing the first evidence id and judges with `judge`. */
    function scriptedCloud(judge: unknown) {
      const ids = /<untrusted_evidence id="([^"]+)">/gu;
      return cloudAdapter((body) => {
        const tool = body.tools[0]!.name;
        if (tool === "draft_claims") {
          const content = String(body.messages[0]!.content);
          const first = [...content.matchAll(ids)][0]?.[1];
          return {
            toolInput: {
              claims: [
                {
                  claimId: "c1",
                  text: "Suçun cezası bir yıldan beş yıla kadar hapistir.",
                  material: true,
                  evidenceIds: first !== undefined ? [first] : [],
                  treatment: "supported",
                },
              ],
            },
          };
        }
        if (tool === "assess_entailment") return { toolInput: judge };
        return { toolInput: {} };
      });
    }

    function run(judge: unknown): Promise<AnswerRun> {
      const { adapter } = scriptedCloud(judge);
      return new AnswerPipeline({
        retrieval: new StubCorpus(() => ok([hitTck("v1")])),
        texts: standardTexts(),
        versionFacts: factsPort(STANDARD_FACTS),
        ...deterministicOptions(),
        cloud: { drafter: adapter, entailment: adapter, label: "Bulut test" },
        dataBoundary: () => "ALLOW_CLOUD",
        aiPolicy: () => resolveEffectiveAiPolicy({ COLLEX_AI_POLICY: "CLOUD_ALLOWED" }),
      }).answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01", useCloudAi: true });
    }

    const entailmentReasons = (reasons: readonly string[]): string[] =>
      reasons.filter(
        (reason) => reason.startsWith("ENTAILMENT_BELOW_THRESHOLD:") || reason.startsWith("ENTAILMENT_NOT_CHECKED:"),
      );

    it("a 7 out of 10 is ENTAILMENT_PORT_FAILED and the claim reads 'not checked', never finalized", async () => {
      const answer = await run({ entails: true, score: 7, rationale: "10 üzerinden 7" });
      const claim = answer.result.claims.find((c) => c.text.includes("bir yıldan beş yıla"));
      expect(claim).toBeDefined();
      expect(answer.result.warnings.some((w) => w.startsWith("ENTAILMENT_PORT_FAILED:"))).toBe(true);
      expect(claim!.confidence.entailment).toBe(0);
      expect(claim!.entailmentMeasured).toBe(false);
      expect(entailmentReasons(claim!.reasons)).toEqual([`ENTAILMENT_NOT_CHECKED:${claim!.claimId}`]);
      expect(answer.result.status).not.toBe("COMPLETE");
    });

    it("non-vacuity: an in-range supporting score is a measured judgement by the cloud judge", async () => {
      const answer = await run({ entails: true, score: 0.93, rationale: "pasaj iddiayı karşılıyor" });
      const claim = answer.result.claims.find((c) => c.text.includes("bir yıldan beş yıla"));
      expect(claim).toBeDefined();
      expect(answer.result.warnings.some((w) => w.startsWith("ENTAILMENT_PORT_FAILED:"))).toBe(false);
      expect(claim!.entailmentMeasured).toBe(true);
      expect(claim!.confidence.entailment).toBeGreaterThan(0);
      expect(entailmentReasons(claim!.reasons)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// R2-30
// ---------------------------------------------------------------------------

describe("R2-30 COLLEX_DATA_BOUNDARY fails closed like COLLEX_AI_POLICY", () => {
  it("forgives case, space and '-' for the two real values", () => {
    for (const raw of ["LOCAL_ONLY", "local_only", "LOCAL-ONLY", "local only", " Local  Only ", "local-only"]) {
      expect(parseDataBoundary(raw), raw).toEqual({ boundary: "LOCAL_ONLY", recognized: true, given: true });
      expect(resolveDataBoundary({ COLLEX_DATA_BOUNDARY: raw }), raw).toBe("LOCAL_ONLY");
    }
    for (const raw of ["ALLOW_CLOUD", "allow-cloud", "Allow Cloud"]) {
      expect(parseDataBoundary(raw), raw).toEqual({ boundary: "ALLOW_CLOUD", recognized: true, given: true });
    }
  });

  it("unset or blank keeps the documented ALLOW_CLOUD default, with no warning", () => {
    for (const env of [{}, { COLLEX_DATA_BOUNDARY: "" }, { COLLEX_DATA_BOUNDARY: "   " }]) {
      expect(resolveDataBoundary(env), JSON.stringify(env)).toBe("ALLOW_CLOUD");
      const effective = resolveEffectiveAiPolicy(env);
      expect(effective.boundary).toBe("ALLOW_CLOUD");
      expect(effective.warnings).toEqual([]);
    }
  });

  it("a spelling of LOCAL_ONLY narrows the policy and carries no 'unrecognized' warning", () => {
    for (const raw of ["LOCAL-ONLY", "local only"]) {
      const effective = resolveEffectiveAiPolicy({ COLLEX_DATA_BOUNDARY: raw });
      expect(effective.policy, raw).toBe("LOCAL_ONLY");
      expect(effective.boundary, raw).toBe("LOCAL_ONLY");
      expect(effective.warnings, raw).not.toContain(UNRECOGNIZED_BOUNDARY_TR);
    }
  });

  it("an unrecognized value is LOCAL_ONLY with the warning, and the cloud stays shut even with consent", () => {
    for (const raw of ["LOCALONLY", "yes", "LOCAL_ONLY_PLEASE", "yalnız yerel"]) {
      expect(parseDataBoundary(raw), raw).toEqual({ boundary: "LOCAL_ONLY", recognized: false, given: true });
      const effective = resolveEffectiveAiPolicy({ COLLEX_DATA_BOUNDARY: raw });
      expect(effective.boundary, raw).toBe("LOCAL_ONLY");
      expect(effective.policy, raw).toBe("LOCAL_ONLY");
      expect(effective.configuredBoundary, raw).toBe("LOCAL_ONLY");
      expect(effective.warnings, raw).toContain(UNRECOGNIZED_BOUNDARY_TR);
      const decision = decideProvider({
        policy: effective.policy,
        boundary: effective.boundary,
        localConfigured: false,
        cloudConfigured: true,
        requestConsentsCloud: true,
        requestAsksLocal: false,
      });
      expect(decision.drafter, raw).not.toBe("cloud");
    }
  });

  it("health shows the warning, and /v1/ai/* POSTs are refused at the boundary", async () => {
    const env = { COLLEX_DATA_BOUNDARY: "LOCALONLY" };
    const effective = resolveEffectiveAiPolicy(env);
    const app = createApp({
      modelRoutes: resolveModelRoutes(env, { fetchImpl: noFetch }),
      aiPolicy: () => effective,
    });
    const health = (await (await app.request("/v1/health")).json()) as { aiPolicy: AiPolicyHealth };
    expect(health.aiPolicy.effectiveBoundary).toBe("LOCAL_ONLY");
    expect(health.aiPolicy.warnings).toContain(UNRECOGNIZED_BOUNDARY_TR);
    expect(health.aiPolicy.cloud.allowed).toBe(false);
    const post = await app.request("/v1/ai/draft-paragraph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: "d", sectionId: "s", instructions: "x", evidenceIds: [], useCloudAi: true }),
    });
    // Refused by the boundary gate before any handler: nothing can reach the cloud.
    expect(post.status).toBe(403);
    expect(((await post.json()) as { error: { kind: string } }).error.kind).toBe("DATA_BOUNDARY_LOCAL_ONLY");
  });
});

// ---------------------------------------------------------------------------
// R2-31
// ---------------------------------------------------------------------------

describe("R2-31 only 127/8 and the exact 0.0.0.0 are this computer", () => {
  const OTHER_ZERO_NET = ["http://0.1.2.3:11434", "http://[::ffff:0.8.8.8]:11434", "http://0.0.0.1:11434"];

  it("the rest of 0.0.0.0/8, dotted or IPv4-mapped, is not LOCAL_PROCESS and LOCAL_ONLY refuses it", () => {
    for (const url of OTHER_ZERO_NET) {
      const decision = classifyEndpoint(url);
      expect(decision.ok, url).toBe(true);
      if (!decision.ok) continue;
      expect(decision.trust, url).not.toBe("LOCAL_PROCESS");
      expect(decision.trust, url).toBe("CLOUD");
      expect(boundaryAllows("LOCAL_ONLY", decision.trust), url).toMatchObject({ reason: "BOUNDARY_FORBIDS_CLOUD" });
      // A trusted-hosts entry for a private range does not apply to it either.
      const listed = classifyEndpoint(url, { trustedLocalHosts: [`${decision.authority}`] });
      expect(listed.ok && listed.trust, url).toBe("CLOUD");
    }
  });

  it("non-vacuity: 0.0.0.0 itself, its short spellings, 127/8 and ::1 stay LOCAL_PROCESS", () => {
    for (const url of [
      "http://0.0.0.0:11434",
      "http://0:11434",
      "http://[::ffff:0.0.0.0]:11434",
      "http://127.0.0.1:11434",
      "http://127.8.9.10:11434",
      "http://[::ffff:127.0.0.1]:11434",
      "http://[::1]:11434",
      "http://localhost:11434",
    ]) {
      expect(classifyEndpoint(url), url).toMatchObject({ ok: true, trust: "LOCAL_PROCESS" });
    }
  });

  it("the generation config, the route table, the adapter and the embedding gate all refuse it under LOCAL_ONLY", async () => {
    for (const url of OTHER_ZERO_NET) {
      const env = { COLLEX_LOCAL_LLM_BASE_URL: url, COLLEX_LOCAL_LLM_MODEL: "m", COLLEX_AI_POLICY: "LOCAL_ONLY" };
      const resolved = resolveLocalGenerationConfig(env);
      expect(resolved.kind, url).toBe("CONFIGURED");
      if (resolved.kind !== "CONFIGURED") continue;
      expect(resolved.config.trust, url).toBe("CLOUD");

      const table = resolveModelRoutes(env, { fetchImpl: noFetch });
      expect(table.status, url).toBe("refused");
      expect(table.roles, url).toEqual({});
      expect(table.matterAnalysisAllowed, url).toBe(false);

      let requests = 0;
      const adapter = new LocalGenerationAdapter({
        config: resolved.config,
        boundary: "LOCAL_ONLY",
        fetchImpl: (async () => {
          requests += 1;
          return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch,
      });
      await expect(
        adapter.generateJson({ system: "s", instruction: "i", shapeHint: "{}" }),
        url,
      ).rejects.toMatchObject({ code: "BOUNDARY" });
      expect(requests, url).toBe(0);

      const embedding = resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "local", LOCAL_EMBEDDING_BASE_URL: url });
      expect(embedding.enabled, url).toBe(true);
      expect(applyDataBoundaryToEmbedding(embedding, "LOCAL_ONLY"), url).toMatchObject({
        enabled: false,
        reason: "EMBEDDING_REFUSED_LOCAL_ONLY",
      });
    }
    // Non-vacuity: 0.0.0.0 itself is admitted by the same gates.
    const loop = resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "local", LOCAL_EMBEDDING_BASE_URL: "http://0.0.0.0:11434" });
    expect(applyDataBoundaryToEmbedding(loop, "LOCAL_ONLY").enabled).toBe(true);
  });
});
