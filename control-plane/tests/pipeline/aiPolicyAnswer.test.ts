/**
 * W21 acceptance G and H through the REAL AnswerPipeline and createApp.
 *
 *   G  a normal question (NO useLocalAi) under LOCAL_PREFERRED or LOCAL_ONLY,
 *      with a configured local model, is drafted and verified by that model;
 *   H  under LOCAL_ONLY a tripwire cloud is never touched on any path
 *      (useCloudAi=true, local model absent, local model failing), and
 *      DETERMINISTIC_ONLY calls no model at all;
 *   wiring  /v1/answer forwards useLocalAi (it used to drop it), health gains
 *      a top-level `aiPolicy` key without changing `health.ai`, and the
 *      /v1/ai/* gate obeys the EFFECTIVE boundary.
 *
 * The local "model" is a scripted OpenAI-compatible transport behind the REAL
 * LocalGenerationAdapter, and the "cloud" is a pair of ports that count every
 * touch. No real model was called; nothing here measures a real model.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/server.js";
import {
  LOCAL_AI_OFF_MACHINE_REFUSED_MESSAGE_TR,
  LOCAL_AI_REFUSED_MESSAGE_TR,
  LOCAL_AI_UNAVAILABLE_MESSAGE_TR,
  MODEL_UNAVAILABLE_OFF_MACHINE_MESSAGE_TR,
  combineAiPolicy,
  resolveEffectiveAiPolicy,
  type AiPolicy,
  type AiPolicyHealth,
} from "../../src/llm/aiPolicy.js";
import type { DataBoundary } from "../../src/llm/endpointTrust.js";
import { LocalGenerationAdapter } from "../../src/llm/localGenerationAdapter.js";
import type { DrafterPort, EntailmentPort } from "../../src/llm/ports.js";
import { localModelLabel, resolveModelRoutes } from "../../src/llm/providerFactory.js";
import { AnswerPipeline, type AnswerRun } from "../../src/pipeline/answerPipeline.js";
import { RULE_BASED_LABEL_TR } from "../../src/pipeline/answerPipeline.js";
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

/** A DNS-named endpoint behind the "local" setting: someone else's computer. */
const HOSTED = {
  ...LOOPBACK,
  baseUrl: "https://inference.example.com",
  model: "uzak-model",
  trust: "CLOUD" as const,
  authority: "inference.example.com",
};

function chat(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * A scripted local inference server: drafting requests get one claim citing
 * the first evidence id shown; entailment requests a supporting judgement.
 * `down` makes EVERY request fail (drafting and judging).
 */
function scriptedServer(options: { failDrafting?: boolean; down?: boolean } = {}) {
  const calls: Array<{ url: string; system: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    const system = body.messages[0]?.content ?? "";
    const user = body.messages[1]?.content ?? "";
    calls.push({ url, system });
    if (options.down === true) return new Response("down", { status: 503 });
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

type LocalPorts = { drafter: DrafterPort; entailment: EntailmentPort; label: string; trust?: "LOCAL_PROCESS" | "TRUSTED_LOCAL_NETWORK" | "CLOUD" };

function localPorts(fetchImpl: typeof fetch, config: typeof LOOPBACK | typeof HOSTED = LOOPBACK): LocalPorts {
  const adapter = new LocalGenerationAdapter({
    config,
    boundary: config.trust === "CLOUD" ? "ALLOW_CLOUD" : "LOCAL_ONLY",
    fetchImpl,
  });
  return { drafter: adapter, entailment: adapter, label: localModelLabel(adapter), trust: adapter.trust };
}

/** Cloud ports that count every touch and fail the call. Expect 0 touches. */
function tripwireCloud() {
  let touched = 0;
  return {
    drafter: {
      async draftClaims() {
        touched += 1;
        throw new Error("cloud drafter must not be called");
      },
    } satisfies DrafterPort,
    entailment: {
      async assess() {
        touched += 1;
        throw new Error("cloud judge must not be called");
      },
    } satisfies EntailmentPort,
    label: "Bulut test",
    touched: () => touched,
  };
}

/** A cloud that answers (for the paths where consent is honoured). */
function recordingCloud() {
  let drafts = 0;
  return {
    drafter: {
      async draftClaims() {
        drafts += 1;
        return [];
      },
    } satisfies DrafterPort,
    entailment: {
      async assess() {
        return { entails: false, score: 0, rationale: "" };
      },
    } as unknown as EntailmentPort,
    label: "Bulut test",
    drafts: () => drafts,
  };
}

function pipeline(options: {
  local?: LocalPorts;
  cloud?: { drafter: DrafterPort; entailment: EntailmentPort; label: string };
  policy?: AiPolicy;
  /** The pipeline's own dataBoundary() (COLLEX_DATA_BOUNDARY), before the policy. */
  boundary?: DataBoundary;
}): AnswerPipeline {
  const boundary = options.boundary ?? "ALLOW_CLOUD";
  const policy = options.policy;
  return new AnswerPipeline({
    retrieval: new StubCorpus(() => ok([hitTck("v1")])),
    texts: standardTexts(),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
    ...(options.local !== undefined ? { local: options.local } : {}),
    ...(options.cloud !== undefined
      ? { cloud: { drafter: options.cloud.drafter, entailment: options.cloud.entailment, label: options.cloud.label } }
      : {}),
    dataBoundary: () => boundary,
    ...(policy !== undefined ? { aiPolicy: () => combineAiPolicy(policy, boundary) } : {}),
  });
}

const ask = (extra: { useLocalAi?: boolean; useCloudAi?: boolean } = {}) => ({
  question: Q_NORM_CONTENT,
  asOf: "2025-06-01",
  ...extra,
});

function draftNotes(run: AnswerRun): string[] {
  return run.result.trace.find((stage) => stage.name === "draft")?.notes ?? [];
}

const drafting = (server: ReturnType<typeof scriptedServer>) =>
  server.calls.filter((call) => call.system.includes("yanıt taslağı"));

describe("G: a configured local model drafts WITHOUT the browser flag", () => {
  for (const policy of ["LOCAL_PREFERRED", "LOCAL_ONLY"] as const) {
    it(`${policy}: no useLocalAi -> the local drafter and judge run, and the answer says so`, async () => {
      const server = scriptedServer();
      const cloud = tripwireCloud();
      const run = await pipeline({ local: localPorts(server.fetchImpl), cloud, policy }).answer(ask());

      expect(drafting(server).length).toBe(1);
      expect(server.calls.some((call) => call.system.includes("denetleyicisisin"))).toBe(true);
      expect(server.calls.every((call) => call.url === "http://127.0.0.1:11434/v1/chat/completions")).toBe(true);
      expect(run.result.aiUsed?.drafter).toBe(true);
      expect(run.result.aiUsed?.entailment).toBe(true);
      expect(run.result.aiUsed?.label).toContain("Yerel model");
      expect(draftNotes(run)).toContain("drafter=local");
      expect(draftNotes(run)).toContain(`aiPolicy=${policy}`);
      expect(run.result.claims.some((claim) => claim.text.includes("bir yıldan beş yıla"))).toBe(true);
      expect(run.result.warnings.some((warning) => warning.startsWith("LOCAL_AI_UNAVAILABLE"))).toBe(false);
      expect(cloud.touched()).toBe(0);
    });
  }

  it("the serve.mjs wiring: the route table's answer/verifier roles, trust and policy, no flag", async () => {
    const server = scriptedServer();
    const table = resolveModelRoutes(
      { COLLEX_LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434", COLLEX_LOCAL_LLM_MODEL: "yerel-sinama-modeli" },
      { fetchImpl: server.fetchImpl },
    );
    const effective = combineAiPolicy(table.policy, table.boundary);
    const answerPipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      local: {
        drafter: table.roles.answer!,
        entailment: table.roles.verifier!,
        label: localModelLabel(table.roles.answer!),
        trust: table.trust!,
      },
      dataBoundary: () => table.boundary,
      aiPolicy: () => effective,
    });
    const run = await answerPipeline.answer(ask());
    expect(drafting(server).length).toBe(1);
    expect(run.result.aiUsed?.label).toContain("Yerel model");
  });

  it("W20 compatibility: WITHOUT the aiPolicy option, no flag still means rule-based and no model call", async () => {
    const server = scriptedServer();
    const run = await pipeline({ local: localPorts(server.fetchImpl) }).answer(ask());
    expect(server.calls.length).toBe(0);
    expect(run.result.aiUsed?.drafter).toBe(false);
    expect(run.result.aiUsed?.label).toBe(RULE_BASED_LABEL_TR);
    expect(draftNotes(run)).toContain("drafter=rule-based");
    expect(draftNotes(run).some((note) => note.startsWith("aiPolicy="))).toBe(false);
  });

  it("an outside endpoint behind the local setting is NOT used by default (no consent)", async () => {
    const server = scriptedServer();
    const run = await pipeline({ local: localPorts(server.fetchImpl, HOSTED), policy: "LOCAL_PREFERRED" }).answer(ask());
    expect(server.calls.length).toBe(0);
    expect(run.result.aiUsed?.drafter).toBe(false);
  });
});

describe("H: LOCAL_ONLY never touches the cloud, on every path", () => {
  const cases: Array<{
    name: string;
    local: "ok" | "none" | "failDrafting" | "down";
    request: { useLocalAi?: boolean; useCloudAi?: boolean };
    policy: AiPolicy;
    boundary: DataBoundary;
    expectWarnings: string[];
  }> = [
    { name: "useCloudAi=true, local model configured", local: "ok", request: { useCloudAi: true }, policy: "LOCAL_ONLY", boundary: "ALLOW_CLOUD", expectWarnings: ["CLOUD_AI_REFUSED_LOCAL_ONLY:"] },
    { name: "useCloudAi=true, no local model", local: "none", request: { useCloudAi: true }, policy: "LOCAL_ONLY", boundary: "ALLOW_CLOUD", expectWarnings: ["CLOUD_AI_REFUSED_LOCAL_ONLY:", "MODEL_UNAVAILABLE:"] },
    { name: "no flag, no local model", local: "none", request: {}, policy: "LOCAL_ONLY", boundary: "ALLOW_CLOUD", expectWarnings: ["MODEL_UNAVAILABLE:"] },
    { name: "useCloudAi=true, local drafter failing", local: "failDrafting", request: { useCloudAi: true }, policy: "LOCAL_ONLY", boundary: "ALLOW_CLOUD", expectWarnings: ["LOCAL_DRAFTER_FALLBACK", "DRAFTER_FAILED:"] },
    { name: "useCloudAi=true, local endpoint entirely down", local: "down", request: { useCloudAi: true }, policy: "LOCAL_ONLY", boundary: "ALLOW_CLOUD", expectWarnings: ["LOCAL_DRAFTER_FALLBACK"] },
    { name: "useLocalAi + useCloudAi", local: "ok", request: { useLocalAi: true, useCloudAi: true }, policy: "LOCAL_ONLY", boundary: "ALLOW_CLOUD", expectWarnings: [] },
    { name: "policy CLOUD_ALLOWED narrowed by a LOCAL_ONLY data boundary", local: "none", request: { useCloudAi: true }, policy: "CLOUD_ALLOWED", boundary: "LOCAL_ONLY", expectWarnings: ["CLOUD_AI_REFUSED_LOCAL_ONLY:", "MODEL_UNAVAILABLE:"] },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const cloud = tripwireCloud();
      const server = scriptedServer({
        failDrafting: testCase.local === "failDrafting",
        down: testCase.local === "down",
      });
      const run = await pipeline({
        cloud,
        ...(testCase.local !== "none" ? { local: localPorts(server.fetchImpl) } : {}),
        policy: testCase.policy,
        boundary: testCase.boundary,
      }).answer(ask(testCase.request));

      expect(cloud.touched()).toBe(0);
      expect(run.result.aiUsed?.label).not.toBe(cloud.label);
      for (const prefix of testCase.expectWarnings) {
        expect(run.result.warnings.some((warning) => warning.startsWith(prefix)), prefix).toBe(true);
      }
      // The answer is never lost: a failed model falls back to rule-based.
      expect(run.result.claims.length).toBeGreaterThan(0);
      if (testCase.local === "none") expect(server.calls.length).toBe(0);
    });
  }
});

describe("DETERMINISTIC_ONLY never calls any model", () => {
  it("no local call and no cloud touch, whatever the request flags say", async () => {
    for (const request of [{}, { useLocalAi: true }, { useCloudAi: true }, { useLocalAi: true, useCloudAi: true }]) {
      const server = scriptedServer();
      const cloud = tripwireCloud();
      const run = await pipeline({
        local: localPorts(server.fetchImpl),
        cloud,
        policy: "DETERMINISTIC_ONLY",
      }).answer(ask(request));
      expect(server.calls.length, JSON.stringify(request)).toBe(0);
      expect(cloud.touched()).toBe(0);
      expect(run.result.aiUsed?.drafter).toBe(false);
      expect(run.result.aiUsed?.entailment).toBe(false);
      expect(run.result.warnings.some((warning) => warning.startsWith("AI_POLICY_DETERMINISTIC:"))).toBe(true);
    }
  });
});

describe("consent is still honoured where the policy permits it", () => {
  for (const policy of ["LOCAL_PREFERRED", "CLOUD_ALLOWED"] as const) {
    it(`${policy}: useCloudAi=true under ALLOW_CLOUD drafts with the cloud, never the local model`, async () => {
      const server = scriptedServer();
      const cloud = recordingCloud();
      const run = await pipeline({ local: localPorts(server.fetchImpl), cloud, policy }).answer(ask({ useCloudAi: true }));
      expect(cloud.drafts()).toBe(1);
      expect(drafting(server).length).toBe(0);
      expect(draftNotes(run)).toContain("drafter=cloud");
    });

    it(`${policy}: without consent the cloud is not touched`, async () => {
      const cloud = tripwireCloud();
      await pipeline({ cloud, policy }).answer(ask());
      expect(cloud.touched()).toBe(0);
    });
  }

  it("CLOUD_ALLOWED: an outside 'local' endpoint drafts only for a consenting request", async () => {
    const server = scriptedServer();
    const noConsent = await pipeline({ local: localPorts(server.fetchImpl, HOSTED), policy: "CLOUD_ALLOWED" }).answer(ask());
    expect(server.calls.length).toBe(0);
    expect(noConsent.result.aiUsed?.drafter).toBe(false);
    const consent = await pipeline({ local: localPorts(server.fetchImpl, HOSTED), policy: "CLOUD_ALLOWED" }).answer(
      ask({ useCloudAi: true }),
    );
    expect(drafting(server).length).toBe(1);
    expect(consent.result.aiUsed?.label).toContain("Dışarıdaki model");
  });
});

// ---------------------------------------------------------------------------
// createApp wiring
// ---------------------------------------------------------------------------

async function postAnswer(app: ReturnType<typeof createApp>, body: Record<string, unknown>): Promise<Response> {
  return app.request("/v1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/v1/answer forwards useLocalAi (it used to be dropped)", () => {
  it("W20-mode pipeline: useLocalAi=true on the wire reaches the local drafter", async () => {
    const server = scriptedServer();
    const app = createApp({ answerPipeline: pipeline({ local: localPorts(server.fetchImpl) }) });
    const res = await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01", useLocalAi: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aiUsed: { drafter: boolean; label: string }; warnings: string[] };
    expect(drafting(server).length).toBe(1);
    expect(body.aiUsed.drafter).toBe(true);
    expect(body.aiUsed.label).toContain("Yerel model");
  });

  it("a flag the client did not send is not invented (no flag, W20 mode -> rule-based)", async () => {
    const server = scriptedServer();
    const app = createApp({ answerPipeline: pipeline({ local: localPorts(server.fetchImpl) }) });
    const res = await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    expect(res.status).toBe(200);
    expect(server.calls.length).toBe(0);
  });

  it("with the policy wired, a plain request (no flag) is drafted by the local model", async () => {
    const server = scriptedServer();
    const app = createApp({
      answerPipeline: pipeline({ local: localPorts(server.fetchImpl), policy: "LOCAL_PREFERRED" }),
      aiPolicy: () => combineAiPolicy("LOCAL_PREFERRED", "ALLOW_CLOUD"),
    });
    const res = await postAnswer(app, { question: Q_NORM_CONTENT, asOf: "2025-06-01" });
    const body = (await res.json()) as { aiUsed: { drafter: boolean; label: string } };
    expect(drafting(server).length).toBe(1);
    expect(body.aiUsed.label).toContain("Yerel model");
  });
});

describe("health: a NEW top-level aiPolicy key; health.ai unchanged", () => {
  async function health(app: ReturnType<typeof createApp>): Promise<Record<string, unknown>> {
    return (await (await app.request("/v1/health")).json()) as Record<string, unknown>;
  }

  it("reports the effective policy and boundary; `ai` keeps its pinned shape", async () => {
    const app = createApp({ aiPolicy: () => combineAiPolicy("LOCAL_ONLY", "ALLOW_CLOUD") });
    const body = await health(app);
    expect(body["ai"]).toEqual({ configured: false, model: null, liveTested: false });
    expect(body["dataBoundary"]).toBe("LOCAL_ONLY");
    const aiPolicy = body["aiPolicy"] as AiPolicyHealth;
    expect(aiPolicy.policy).toBe("LOCAL_ONLY");
    expect(aiPolicy.configuredPolicy).toBe("LOCAL_ONLY");
    expect(aiPolicy.effectiveBoundary).toBe("LOCAL_ONLY");
    expect(aiPolicy.localModel.state).toBe("not_configured");
    expect(aiPolicy.localModel.liveTested).toBe(false);
    expect(aiPolicy.localModel.usableForAnswers).toBe(false);
    expect(aiPolicy.modelTasks.allowed).toBe(false);
    expect(aiPolicy.cloud).toEqual({ configured: false, allowed: false, consent: "per-request" });
    expect(typeof aiPolicy.reasonTr).toBe("string");
    expect(aiPolicy.reasonTr.length).toBeGreaterThan(0);
  });

  it("a loopback route table: usable for answers AND matter analysis, and says where it runs", async () => {
    const effective = combineAiPolicy("LOCAL_PREFERRED", "ALLOW_CLOUD");
    const modelRoutes = resolveModelRoutes(
      { COLLEX_LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434", COLLEX_LOCAL_LLM_MODEL: "yerel-sinama-modeli" },
      { policy: effective },
    );
    const body = await health(createApp({ modelRoutes, aiPolicy: () => effective }));
    const aiPolicy = body["aiPolicy"] as AiPolicyHealth;
    expect(aiPolicy.localModel.state).toBe("configured");
    expect(aiPolicy.localModel.trust).toBe("LOCAL_PROCESS");
    expect(aiPolicy.localModel.where).toBe("bu bilgisayarda");
    expect(aiPolicy.localModel.usableForAnswers).toBe(true);
    expect(aiPolicy.localModel.usableForMatterAnalysis).toBe(true);
    expect(aiPolicy.modelTasks.code).toBe("OK");
  });

  it("a hosted address under CLOUD_ALLOWED: answers only with consent, never matter analysis", async () => {
    const effective = combineAiPolicy("CLOUD_ALLOWED", "ALLOW_CLOUD");
    const modelRoutes = resolveModelRoutes(
      { COLLEX_LOCAL_LLM_BASE_URL: "https://inference.example.com", COLLEX_LOCAL_LLM_MODEL: "uzak-model" },
      { policy: effective },
    );
    const aiPolicy = (await health(createApp({ modelRoutes, aiPolicy: () => effective })))["aiPolicy"] as AiPolicyHealth;
    expect(aiPolicy.localModel.state).toBe("configured");
    expect(aiPolicy.localModel.trust).toBe("CLOUD");
    expect(aiPolicy.localModel.usableForMatterAnalysis).toBe(false);
    // W21 verifier fix: the roles were dropped BECAUSE the endpoint is outside;
    // that is named as such, not reported as "no model".
    expect(aiPolicy.modelTasks.code).toBe("MODEL_OFF_MACHINE");
  });

  it("DETERMINISTIC_ONLY: the /v1/ai/* gate refuses every POST (the effective boundary is LOCAL_ONLY)", async () => {
    const app = createApp({ aiPolicy: () => combineAiPolicy("DETERMINISTIC_ONLY", "ALLOW_CLOUD") });
    const res = await app.request("/v1/ai/paragraph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useCloudAi: true }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("DATA_BOUNDARY_LOCAL_ONLY");
    expect((await health(app))["dataBoundary"]).toBe("LOCAL_ONLY");
  });
});

// ---------------------------------------------------------------------------
// W21 lane C: a local model that is refused or fails is SAID, the way health
// says it — never "not configured", never a measured score nobody measured.
// ---------------------------------------------------------------------------

const noRouteFetch = (async () => {
  throw new Error("no request may be made while resolving routes");
}) as unknown as typeof fetch;

/** The serve.mjs wiring, verbatim in shape: ports for filled answer roles, else the refusal facts. */
function servedPipeline(env: Record<string, string>) {
  const effective = resolveEffectiveAiPolicy(env);
  const table = resolveModelRoutes(env, { policy: effective, fetchImpl: noRouteFetch });
  const local =
    table.roles.answer !== undefined && table.roles.verifier !== undefined
      ? {
          drafter: table.roles.answer,
          entailment: table.roles.verifier,
          label: localModelLabel(table.roles.answer),
          ...(table.trust !== null ? { trust: table.trust } : {}),
        }
      : undefined;
  const localRefusal =
    local === undefined && table.status === "refused" && table.policy !== "DETERMINISTIC_ONLY"
      ? { trust: table.trust }
      : undefined;
  const answerPipeline = new AnswerPipeline({
    retrieval: new StubCorpus(() => ok([hitTck("v1")])),
    texts: standardTexts(),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
    ...(local !== undefined ? { local } : {}),
    ...(localRefusal !== undefined ? { localRefusal } : {}),
    dataBoundary: () => table.boundary,
    aiPolicy: () => effective,
  });
  return { table, effective, answerPipeline };
}

const localAiWarning = (run: AnswerRun): string | undefined =>
  run.result.warnings.find((warning) => warning.startsWith("LOCAL_AI_UNAVAILABLE:"));

describe("#21 a useLocalAi answer names the reason health names for the same setup", () => {
  const HOSTED_ENV = {
    COLLEX_LOCAL_LLM_BASE_URL: "https://inference.example.com",
    COLLEX_LOCAL_LLM_MODEL: "uzak-model",
  };

  it("LOCAL_PREFERRED (the default) + a hosted address: 'outside, the policy refused it', not 'not configured'", async () => {
    const { table, effective, answerPipeline } = servedPipeline(HOSTED_ENV);
    expect(table.status).toBe("refused");
    expect(table.trust).toBe("CLOUD");
    const run = await answerPipeline.answer(ask({ useLocalAi: true }));
    expect(localAiWarning(run)).toBe(`LOCAL_AI_UNAVAILABLE:${LOCAL_AI_OFF_MACHINE_REFUSED_MESSAGE_TR}`);
    expect(localAiWarning(run)).not.toContain("yapılandırılmadığı");
    expect(run.result.aiUsed?.drafter).toBe(false);
    // Health, over the SAME table, says the same thing.
    const body = (await (await createApp({ modelRoutes: table, aiPolicy: () => effective }).request("/v1/health")).json()) as {
      aiPolicy: AiPolicyHealth;
    };
    expect(body.aiPolicy.modelTasks.code).toBe("MODEL_OFF_MACHINE");
  });

  it("LOCAL_ONLY + a hosted address: the same sentence, and MODEL_UNAVAILABLE says the model is outside", async () => {
    const { table, answerPipeline } = servedPipeline({ ...HOSTED_ENV, COLLEX_AI_POLICY: "LOCAL_ONLY" });
    expect(table.trust).toBe("CLOUD");
    const run = await answerPipeline.answer(ask({ useLocalAi: true }));
    expect(localAiWarning(run)).toBe(`LOCAL_AI_UNAVAILABLE:${LOCAL_AI_OFF_MACHINE_REFUSED_MESSAGE_TR}`);
    expect(run.result.warnings).toContain(`MODEL_UNAVAILABLE:${MODEL_UNAVAILABLE_OFF_MACHINE_MESSAGE_TR}`);
  });

  it("an unlisted LAN address: 'the address failed the trust rules'", async () => {
    const { answerPipeline } = servedPipeline({
      COLLEX_LOCAL_LLM_BASE_URL: "http://192.168.1.20:11434",
      COLLEX_LOCAL_LLM_MODEL: "m",
    });
    const run = await answerPipeline.answer(ask({ useLocalAi: true }));
    expect(localAiWarning(run)).toBe(`LOCAL_AI_UNAVAILABLE:${LOCAL_AI_REFUSED_MESSAGE_TR}`);
  });

  it("nothing configured keeps the W20 'not configured' sentence", async () => {
    const { answerPipeline } = servedPipeline({});
    const run = await answerPipeline.answer(ask({ useLocalAi: true }));
    expect(localAiWarning(run)).toBe(`LOCAL_AI_UNAVAILABLE:${LOCAL_AI_UNAVAILABLE_MESSAGE_TR}`);
  });

  it("W20 flag mode (no aiPolicy wired) uses the same sentence for a refused outside address", async () => {
    const answerPipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
      localRefusal: { trust: "CLOUD" },
    });
    const run = await answerPipeline.answer(ask({ useLocalAi: true }));
    expect(localAiWarning(run)).toBe(`LOCAL_AI_UNAVAILABLE:${LOCAL_AI_OFF_MACHINE_REFUSED_MESSAGE_TR}`);
  });
});

describe("#22 a local judge that fails is a failure on the answer, never a measured score", () => {
  /**
   * Drafting answers. Judging: "dead" gets HTTP 500 on every call, "short"
   * answers every call with a real low score, "flaky" answers the first
   * judge call and fails the rest. `claims` sets how many claims are drafted
   * (each cites the first evidence id, so each costs one judge call).
   */
  function deadJudgeServer(judge: "dead" | "short" | "flaky" = "dead", claims = 1) {
    const calls: string[] = [];
    let judged = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const system = body.messages[0]?.content ?? "";
      const user = body.messages[1]?.content ?? "";
      calls.push(system);
      if (system.includes("yanıt taslağı")) {
        const ids = [...user.matchAll(/\[([A-Za-z0-9:_\-.]{3,})\]/gu)].map((match) => match[1]);
        const texts = [
          "Suçun cezası bir yıldan beş yıla kadar hapistir.",
          "Bu suç için adli para cezası da verilir.",
        ];
        return chat({
          claims: texts.slice(0, claims).map((text) => ({ text, evidenceIds: ids.slice(0, 1) })),
        });
      }
      judged += 1;
      if (judge === "short" || (judge === "flaky" && judged === 1)) {
        return chat({ entails: false, score: 0.2, rationale: "pasaj bunu tam söylemiyor" });
      }
      return new Response("sunucu hatası", { status: 500 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const entailmentReasons = (reasons: readonly string[]): string[] =>
    reasons.filter(
      (reason) => reason.startsWith("ENTAILMENT_BELOW_THRESHOLD:") || reason.startsWith("ENTAILMENT_NOT_CHECKED:"),
    );

  it("drafting works, the judge is down: ENTAILMENT_PORT_FAILED is on the answer (once) and nothing finalizes", async () => {
    const server = deadJudgeServer();
    const run = await pipeline({ local: localPorts(server.fetchImpl), policy: "LOCAL_PREFERRED" }).answer(ask());
    expect(server.calls.some((system) => system.includes("denetleyicisisin"))).toBe(true);
    expect(run.result.aiUsed?.drafter).toBe(true);
    const failures = run.result.warnings.filter((warning) => warning.startsWith("ENTAILMENT_PORT_FAILED:"));
    // One line however many claim/passage pairs failed.
    expect(failures.length).toBe(1);
    expect(run.result.status).not.toBe("COMPLETE");
    expect(run.result.claims.length).toBeGreaterThan(0);
    for (const claim of run.result.claims) expect(claim.confidence.entailment).toBe(0);
    // W21 #22 residual: that 0 is not a measurement. No claim, no answer
    // reason and no exported line may read "pasaj desteği eşiğin altında
    // kaldı"; each claim says its support was not checked.
    for (const claim of run.result.claims) {
      expect(entailmentReasons(claim.reasons)).toEqual([`ENTAILMENT_NOT_CHECKED:${claim.claimId}`]);
      expect(claim.entailmentMeasured).toBe(false);
    }
    expect(run.result.reasons.some((reason) => reason.startsWith("ENTAILMENT_BELOW_THRESHOLD"))).toBe(false);
    expect(run.result.reasons.some((reason) => reason.startsWith("ENTAILMENT_NOT_CHECKED:"))).toBe(true);
    expect(run.result.markdown).not.toContain("ENTAILMENT_BELOW_THRESHOLD");
    expect(run.result.markdown).toContain("ENTAILMENT_NOT_CHECKED");
    // The model drafted but judged nothing: the answer does not say it judged.
    expect(run.result.aiUsed?.entailment).toBe(false);
  });

  it("non-vacuity: the same run with a judge that answers short is a measured shortfall, judged by the model", async () => {
    const server = deadJudgeServer("short");
    const run = await pipeline({ local: localPorts(server.fetchImpl), policy: "LOCAL_PREFERRED" }).answer(ask());
    expect(run.result.warnings.some((warning) => warning.startsWith("ENTAILMENT_PORT_FAILED:"))).toBe(false);
    expect(run.result.claims.length).toBeGreaterThan(0);
    for (const claim of run.result.claims) {
      expect(entailmentReasons(claim.reasons)).toEqual([`ENTAILMENT_BELOW_THRESHOLD:${claim.claimId}`]);
      expect(claim.entailmentMeasured).toBe(true);
    }
    expect(run.result.aiUsed?.entailment).toBe(true);
    expect(run.result.status).not.toBe("COMPLETE");
  });

  it("a judge that answered one claim and failed the other: each claim says what happened to it", async () => {
    const server = deadJudgeServer("flaky", 2);
    const run = await pipeline({ local: localPorts(server.fetchImpl), policy: "LOCAL_PREFERRED" }).answer(ask());
    expect(run.result.claims.length).toBe(2);
    const [answered, failed] = run.result.claims;
    expect(entailmentReasons(answered?.reasons ?? [])).toEqual([`ENTAILMENT_BELOW_THRESHOLD:${answered?.claimId}`]);
    expect(entailmentReasons(failed?.reasons ?? [])).toEqual([`ENTAILMENT_NOT_CHECKED:${failed?.claimId}`]);
    expect(run.result.warnings.filter((warning) => warning.startsWith("ENTAILMENT_PORT_FAILED:")).length).toBe(1);
    // One judgement did happen, so the model did judge part of this answer.
    expect(run.result.aiUsed?.entailment).toBe(true);
    expect(run.result.status).not.toBe("COMPLETE");
  });

  it("a failed local drafter's fallback claims are judged lexically, not by the model that just failed", async () => {
    const server = scriptedServer({ down: true });
    const run = await pipeline({ local: localPorts(server.fetchImpl), policy: "LOCAL_PREFERRED" }).answer(ask());
    expect(run.result.warnings).toContain("LOCAL_DRAFTER_FALLBACK");
    expect(drafting(server).length).toBe(1);
    // The dead model is not asked again to judge.
    expect(server.calls.filter((call) => call.system.includes("denetleyicisisin")).length).toBe(0);
    expect(run.result.warnings.some((warning) => warning.startsWith("ENTAILMENT_PORT_FAILED:"))).toBe(false);
    // No model contributed, and the answer says so.
    expect(run.result.aiUsed?.drafter).toBe(false);
    expect(run.result.aiUsed?.entailment).toBe(false);
    expect(run.result.aiUsed?.label).toBe(RULE_BASED_LABEL_TR);
    expect(run.result.claims.length).toBeGreaterThan(0);
  });
});
