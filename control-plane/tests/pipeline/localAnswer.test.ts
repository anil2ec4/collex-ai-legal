/**
 * W20 acceptance H and I: the local model is CONSUMED by the existing answer
 * pipeline, and LOCAL_ONLY still means zero cloud calls.
 *
 * The local "model" is a scripted OpenAI-compatible transport behind the
 * REAL LocalGenerationAdapter (request building, fencing, boundary checks,
 * JSON parsing, gate) — so everything up to the socket is production code.
 * It is still a test double: no real model was called here, and nothing
 * in this file measures what a real model would answer.
 */

import { describe, expect, it } from "vitest";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import type { DrafterPort, EntailmentPort } from "../../src/llm/ports.js";
import { LocalGenerationAdapter, RequestGate } from "../../src/llm/localGenerationAdapter.js";
import { localModelLabel, resolveModelRoutes } from "../../src/llm/providerFactory.js";
import { UNTRUSTED_BLOCK_OPEN } from "../../src/security/untrusted.js";
import {
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  standardTexts,
  StubCorpus,
} from "./fakes.js";

const LOOPBACK = {
  baseUrl: "http://127.0.0.1:11434",
  model: "yerel-sinama-modeli",
  trust: "LOCAL_PROCESS" as const,
  authority: "127.0.0.1:11434",
  contextTokens: 8192,
  maxOutputTokens: 512,
  concurrency: 1,
  timeoutMs: 5_000,
  authenticated: false,
  warnings: [],
};

function chat(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

interface Recorded {
  readonly url: string;
  readonly system: string;
  readonly user: string;
}

/**
 * A scripted local inference server. Drafting requests are answered with one
 * claim citing the first evidence id the prompt showed; entailment requests
 * with a supporting judgement.
 */
function scriptedServer(options: { failDrafting?: boolean } = {}) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    const system = body.messages[0]?.content ?? "";
    const user = body.messages[1]?.content ?? "";
    calls.push({ url, system, user });
    if (system.includes("yanıt taslağı")) {
      if (options.failDrafting === true) return new Response("down", { status: 503 });
      const ids = [...user.matchAll(/\[([A-Za-z0-9:_\-.]{3,})\]/gu)].map((match) => match[1]);
      return chat({
        claims: [{ text: "Suçun cezası bir yıldan beş yıla kadar hapistir.", evidenceIds: ids.slice(0, 1) }],
      });
    }
    if (system.includes("denetleyicisisin")) {
      return chat({ entails: true, score: 0.93, rationale: "pasaj iddiayı karşılıyor" });
    }
    return chat({});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function localPorts(fetchImpl: typeof fetch) {
  const adapter = new LocalGenerationAdapter({ config: LOOPBACK, boundary: "LOCAL_ONLY", fetchImpl });
  return { drafter: adapter, entailment: adapter, label: localModelLabel(adapter) };
}

/** Cloud ports that fail the test if anything ever touches them. */
function tripwireCloud(): { drafter: DrafterPort; entailment: EntailmentPort; label: string; touched: () => number } {
  let touched = 0;
  return {
    drafter: {
      async draftClaims() {
        touched += 1;
        throw new Error("cloud drafter must not be called");
      },
    },
    entailment: {
      async assess() {
        touched += 1;
        throw new Error("cloud judge must not be called");
      },
    },
    label: "Anthropic test",
    touched: () => touched,
  };
}

function pipeline(options: {
  local?: ReturnType<typeof localPorts>;
  cloud?: ReturnType<typeof tripwireCloud>;
  boundary?: "LOCAL_ONLY" | "ALLOW_CLOUD";
}): AnswerPipeline {
  return new AnswerPipeline({
    retrieval: new StubCorpus(() => ok([hitTck("v1")])),
    texts: standardTexts(),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
    ...(options.local !== undefined ? { local: options.local } : {}),
    ...(options.cloud !== undefined
      ? { cloud: { drafter: options.cloud.drafter, entailment: options.cloud.entailment, label: options.cloud.label } }
      : {}),
    dataBoundary: () => options.boundary ?? "ALLOW_CLOUD",
  });
}

describe("H: a configured local provider is consumed by AnswerPipeline", () => {
  it("drafts with the local model, verifies with it, and says so", async () => {
    const server = scriptedServer();
    const { result } = await pipeline({ local: localPorts(server.fetchImpl), boundary: "LOCAL_ONLY" }).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useLocalAi: true,
    });

    const drafting = server.calls.filter((call) => call.system.includes("yanıt taslağı"));
    const judging = server.calls.filter((call) => call.system.includes("denetleyicisisin"));
    expect(drafting.length).toBe(1);
    expect(judging.length).toBeGreaterThan(0);
    // Every request went to the configured loopback endpoint and nowhere else.
    expect(server.calls.every((call) => call.url === "http://127.0.0.1:11434/v1/chat/completions")).toBe(true);
    // Document text reached the model only inside the untrusted fence.
    expect(drafting[0]!.user).toContain(UNTRUSTED_BLOCK_OPEN);

    expect(result.aiUsed?.drafter).toBe(true);
    expect(result.aiUsed?.entailment).toBe(true);
    expect(result.aiUsed?.label).toContain("Yerel model");
    expect(result.claims.some((claim) => claim.text.includes("bir yıldan beş yıla"))).toBe(true);
    expect(result.warnings.some((warning) => warning.startsWith("DRAFTER_FAILED"))).toBe(false);
  });

  it("a local model outage falls back to the rule-based drafter instead of losing the answer", async () => {
    const server = scriptedServer({ failDrafting: true });
    const { result } = await pipeline({ local: localPorts(server.fetchImpl) }).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useLocalAi: true,
    });
    expect(result.warnings).toContain("LOCAL_DRAFTER_FALLBACK");
    expect(result.warnings.some((warning) => warning.startsWith("DRAFTER_FAILED"))).toBe(true);
    expect(result.aiUsed?.drafter).toBe(false);
    expect(result.claims.length).toBeGreaterThan(0);
  });

  it("asking for the local model when none is configured is said, not hidden", async () => {
    const { result } = await pipeline({}).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useLocalAi: true,
    });
    expect(result.warnings.some((warning) => warning.startsWith("LOCAL_AI_UNAVAILABLE:"))).toBe(true);
    expect(result.aiUsed?.drafter).toBe(false);
  });
});

describe("I: LOCAL_ONLY produces zero cloud calls", () => {
  it("a useCloudAi request under LOCAL_ONLY never touches the cloud ports", async () => {
    const cloud = tripwireCloud();
    const { result } = await pipeline({ cloud, boundary: "LOCAL_ONLY" }).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useCloudAi: true,
    });
    expect(cloud.touched()).toBe(0);
    expect(result.warnings.some((warning) => warning.startsWith("CLOUD_AI_REFUSED_LOCAL_ONLY:"))).toBe(true);
    expect(result.aiUsed?.drafter).toBe(false);
    expect(result.aiUsed?.entailment).toBe(false);
  });

  it("with both configured, useLocalAi uses the local model and never the cloud", async () => {
    const cloud = tripwireCloud();
    const server = scriptedServer();
    const { result } = await pipeline({ cloud, local: localPorts(server.fetchImpl) }).answer({
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      useLocalAi: true,
      useCloudAi: true,
    });
    expect(cloud.touched()).toBe(0);
    expect(server.calls.length).toBeGreaterThan(0);
    expect(result.aiUsed?.label).toContain("Yerel model");
  });
});

describe("the central provider factory", () => {
  const noFetch = (async () => {
    throw new Error("no request may be made while resolving routes");
  }) as unknown as typeof fetch;

  it("fills every role from one endpoint, with per-role model overrides", () => {
    const table = resolveModelRoutes(
      {
        COLLEX_LOCAL_LLM_BASE_URL: "http://127.0.0.1:8080",
        COLLEX_LOCAL_LLM_MODEL: "genel-model",
        COLLEX_LOCAL_LLM_MODEL_EXTRACTION: "cikarim-modeli",
        COLLEX_DATA_BOUNDARY: "LOCAL_ONLY",
      },
      { fetchImpl: noFetch },
    );
    expect(table.status).toBe("configured");
    expect(table.models).toEqual({
      answer: "genel-model",
      verifier: "genel-model",
      matterExtraction: "cikarim-modeli",
      matterSynthesis: "genel-model",
    });
    expect(table.roles.answer).toBe(table.roles.verifier);
    expect(table.roles.matterExtraction).not.toBe(table.roles.answer);
  });

  it("LOCAL_ONLY refuses a cloud endpoint and leaves EVERY role empty (no fallback)", () => {
    const table = resolveModelRoutes(
      {
        COLLEX_LOCAL_LLM_BASE_URL: "https://inference.example.com",
        COLLEX_LOCAL_LLM_MODEL: "herhangi",
        COLLEX_DATA_BOUNDARY: "LOCAL_ONLY",
      },
      { fetchImpl: noFetch },
    );
    expect(table.status).toBe("refused");
    expect(table.roles).toEqual({});
    expect(table.messageTr).not.toBeNull();
  });

  it("a LAN endpoint needs the explicit allow-list", () => {
    const refused = resolveModelRoutes(
      { COLLEX_LOCAL_LLM_BASE_URL: "http://192.168.1.50:8080", COLLEX_LOCAL_LLM_MODEL: "m" },
      { fetchImpl: noFetch },
    );
    expect(refused.status).toBe("refused");
    const allowed = resolveModelRoutes(
      {
        COLLEX_LOCAL_LLM_BASE_URL: "http://192.168.1.50:8080",
        COLLEX_LOCAL_LLM_MODEL: "m",
        COLLEX_TRUSTED_LOCAL_HOSTS: "192.168.1.50:8080",
      },
      { fetchImpl: noFetch },
    );
    expect(allowed.status).toBe("configured");
    expect(allowed.trust).toBe("TRUSTED_LOCAL_NETWORK");
  });

  it("adapters of one endpoint share ONE request gate (concurrency holds across roles)", async () => {
    let concurrent = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent -= 1;
      return chat({ items: [] });
    }) as unknown as typeof fetch;
    const table = resolveModelRoutes(
      {
        COLLEX_LOCAL_LLM_BASE_URL: "http://127.0.0.1:8080",
        COLLEX_LOCAL_LLM_MODEL: "a",
        COLLEX_LOCAL_LLM_MODEL_SYNTHESIS: "b",
      },
      { fetchImpl },
    );
    const request = { system: "s", instruction: "i", shapeHint: "{}" };
    await Promise.all([
      table.roles.answer!.generateJson(request),
      table.roles.matterSynthesis!.generateJson(request),
      table.roles.matterExtraction!.generateJson(request),
      table.roles.verifier!.generateJson(request),
    ]);
    expect(peak).toBe(1);
  });

  it("RequestGate with concurrency 2 never exceeds two in flight", async () => {
    const gate = new RequestGate(2);
    let concurrent = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        gate.run(async () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 5));
          concurrent -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});
