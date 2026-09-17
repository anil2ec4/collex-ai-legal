/**
 * W21 — the ONE application AI policy (llm/aiPolicy.ts) and the model route
 * table it governs (llm/providerFactory.ts).
 *
 *   decision   decideProvider over every combination: LOCAL_ONLY never picks
 *              the cloud, DETERMINISTIC_ONLY never picks a model, the cloud
 *              needs this request's consent under every policy;
 *   routes     an outside address behind the "local" setting no longer fills
 *              the local roles under the default policy, and never fills the
 *              matter roles at all;
 *   L          with concurrency 1 (the default) concurrent generateJson calls
 *              against one endpoint are serialized and each caller still gets
 *              its own answer.
 *
 * Every transport here is a scripted double behind the REAL
 * LocalGenerationAdapter. No real model was called, and nothing in this file
 * measures what a real model would answer.
 */

import { describe, expect, it } from "vitest";
import {
  AI_POLICIES,
  AI_POLICY_DETERMINISTIC,
  AI_UNAVAILABLE,
  CLOUD_AI_REFUSED_LOCAL_ONLY,
  DEFAULT_AI_POLICY,
  LOCAL_AI_UNAVAILABLE,
  MODEL_UNAVAILABLE,
  combineAiPolicy,
  decideModelTasks,
  decideProvider,
  parseAiPolicy,
  policyAllowsModelTasks,
  resolveAiPolicy,
  resolveEffectiveAiPolicy,
  stricterPolicy,
  type ProviderDecisionInput,
} from "../../src/llm/aiPolicy.js";
import type { EndpointTrust } from "../../src/llm/endpointTrust.js";
import { DEFAULT_LOCAL_CONCURRENCY } from "../../src/llm/localGenerationConfig.js";
import { localModelLabel, resolveModelRoutes } from "../../src/llm/providerFactory.js";

const LOOPBACK_ENV = { COLLEX_LOCAL_LLM_BASE_URL: "http://127.0.0.1:8080", COLLEX_LOCAL_LLM_MODEL: "yerel-model" };
/** A DNS name: classified CLOUD by endpointTrust.ts (someone else's computer). */
const HOSTED_ENV = { COLLEX_LOCAL_LLM_BASE_URL: "https://inference.example.com", COLLEX_LOCAL_LLM_MODEL: "uzak-model" };

/** Resolving routes must never dial the endpoint. */
const noFetch = (async () => {
  throw new Error("no request may be made while resolving routes");
}) as unknown as typeof fetch;

function input(overrides: Partial<ProviderDecisionInput>): ProviderDecisionInput {
  return {
    policy: "LOCAL_PREFERRED",
    boundary: "ALLOW_CLOUD",
    localConfigured: false,
    localTrust: "LOCAL_PROCESS",
    cloudConfigured: false,
    requestConsentsCloud: false,
    requestAsksLocal: false,
    ...overrides,
  };
}

const codes = (decision: { warnings: readonly { code: string }[] }): string[] =>
  decision.warnings.map((warning) => warning.code);

/** Every combination of the request/config facts, for exhaustive rules. */
function everyCombination(base: Partial<ProviderDecisionInput>): ProviderDecisionInput[] {
  const out: ProviderDecisionInput[] = [];
  const flags = [false, true];
  for (const localConfigured of flags)
    for (const cloudConfigured of flags)
      for (const requestConsentsCloud of flags)
        for (const requestAsksLocal of flags)
          for (const boundary of ["ALLOW_CLOUD", "LOCAL_ONLY"] as const)
            for (const localTrust of ["LOCAL_PROCESS", "TRUSTED_LOCAL_NETWORK", "CLOUD"] as const)
              out.push(
                input({
                  ...base,
                  localConfigured,
                  cloudConfigured,
                  requestConsentsCloud,
                  requestAsksLocal,
                  boundary,
                  localTrust,
                }),
              );
  return out;
}

describe("resolving the policy", () => {
  it("defaults to LOCAL_PREFERRED and reads AUTO as LOCAL_PREFERRED", () => {
    expect(DEFAULT_AI_POLICY).toBe("LOCAL_PREFERRED");
    expect(resolveAiPolicy({})).toBe("LOCAL_PREFERRED");
    expect(resolveAiPolicy({ COLLEX_AI_POLICY: "  " })).toBe("LOCAL_PREFERRED");
    expect(resolveAiPolicy({ COLLEX_AI_POLICY: "AUTO" })).toBe("LOCAL_PREFERRED");
    expect(resolveAiPolicy({ COLLEX_AI_POLICY: "auto" })).toBe("LOCAL_PREFERRED");
  });

  it("reads every policy name, forgiving case and '-' for '_'", () => {
    for (const policy of AI_POLICIES) {
      expect(resolveAiPolicy({ COLLEX_AI_POLICY: policy })).toBe(policy);
      expect(resolveAiPolicy({ COLLEX_AI_POLICY: policy.toLowerCase().replace(/_/gu, "-") })).toBe(policy);
    }
  });

  it("an unrecognized value fails CLOSED (LOCAL_ONLY) and says so", () => {
    const parsed = parseAiPolicy("CLOUD_ALOWED");
    expect(parsed).toEqual({ policy: "LOCAL_ONLY", recognized: false, given: true });
    const effective = resolveEffectiveAiPolicy({ COLLEX_AI_POLICY: "CLOUD_ALOWED" });
    expect(effective.policy).toBe("LOCAL_ONLY");
    expect(effective.boundary).toBe("LOCAL_ONLY");
    expect(effective.warnings.length).toBeGreaterThan(0);
  });

  it("the STRICTER of policy and data boundary wins, in both directions", () => {
    // boundary LOCAL_ONLY + policy CLOUD_ALLOWED -> effective LOCAL_ONLY
    const narrowed = resolveEffectiveAiPolicy({ COLLEX_AI_POLICY: "CLOUD_ALLOWED", COLLEX_DATA_BOUNDARY: "LOCAL_ONLY" });
    expect(narrowed.policy).toBe("LOCAL_ONLY");
    expect(narrowed.configuredPolicy).toBe("CLOUD_ALLOWED");
    expect(narrowed.boundary).toBe("LOCAL_ONLY");
    expect(narrowed.warnings.length).toBe(1);
    // policy LOCAL_ONLY forces the LOCAL_ONLY boundary on an ALLOW_CLOUD setting
    const forced = resolveEffectiveAiPolicy({ COLLEX_AI_POLICY: "LOCAL_ONLY" });
    expect(forced.configuredBoundary).toBe("ALLOW_CLOUD");
    expect(forced.boundary).toBe("LOCAL_ONLY");
    // so does DETERMINISTIC_ONLY
    expect(resolveEffectiveAiPolicy({ COLLEX_AI_POLICY: "DETERMINISTIC_ONLY" }).boundary).toBe("LOCAL_ONLY");
    // the default leaves the default boundary alone
    const plain = resolveEffectiveAiPolicy({});
    expect(plain.policy).toBe("LOCAL_PREFERRED");
    expect(plain.boundary).toBe("ALLOW_CLOUD");
    expect(plain.warnings).toEqual([]);
  });

  it("no policy can loosen a LOCAL_ONLY boundary", () => {
    for (const policy of AI_POLICIES) {
      const effective = combineAiPolicy(policy, "LOCAL_ONLY");
      expect(effective.boundary, policy).toBe("LOCAL_ONLY");
      expect(["LOCAL_ONLY", "DETERMINISTIC_ONLY"], policy).toContain(effective.policy);
    }
    for (const a of AI_POLICIES) {
      for (const b of AI_POLICIES) expect(stricterPolicy(a, b)).toBe(stricterPolicy(b, a));
    }
  });
});

describe("decideProvider — who drafts an answer", () => {
  it("G: a configured on-machine model drafts WITHOUT any request flag under LOCAL_PREFERRED and LOCAL_ONLY", () => {
    for (const policy of ["LOCAL_PREFERRED", "LOCAL_ONLY"] as const) {
      for (const localTrust of ["LOCAL_PROCESS", "TRUSTED_LOCAL_NETWORK"] as const) {
        const decision = decideProvider(
          input({ policy, boundary: policy === "LOCAL_ONLY" ? "LOCAL_ONLY" : "ALLOW_CLOUD", localConfigured: true, localTrust }),
        );
        expect(decision.drafter, `${policy}/${localTrust}`).toBe("local");
        expect(decision.warnings).toEqual([]);
      }
    }
  });

  it("LOCAL_ONLY with no local model is rule-based with an honest MODEL_UNAVAILABLE warning", () => {
    const decision = decideProvider(input({ policy: "LOCAL_ONLY", boundary: "LOCAL_ONLY" }));
    expect(decision.drafter).toBe("rule-based");
    expect(codes(decision)).toEqual([MODEL_UNAVAILABLE]);
    expect(decision.warnings[0]!.messageTr).toMatch(/yerel model hazır değil/u);
  });

  it("H: LOCAL_ONLY never picks the cloud, whatever the request and configuration say", () => {
    for (const decisionInput of everyCombination({ policy: "LOCAL_ONLY" })) {
      const decision = decideProvider(decisionInput);
      expect(decision.drafter, JSON.stringify(decisionInput)).not.toBe("cloud");
      // An outside service behind the local setting is not "local" either.
      if (decisionInput.localTrust === "CLOUD") expect(decision.drafter).toBe("rule-based");
    }
  });

  it("H: under a LOCAL_ONLY boundary no policy picks the cloud or an outside endpoint", () => {
    for (const policy of AI_POLICIES) {
      for (const decisionInput of everyCombination({ policy })) {
        if (decisionInput.boundary !== "LOCAL_ONLY") continue;
        const decision = decideProvider(decisionInput);
        expect(decision.drafter, `${policy} ${JSON.stringify(decisionInput)}`).not.toBe("cloud");
        if (decisionInput.localTrust === "CLOUD") expect(decision.drafter).not.toBe("local");
      }
    }
  });

  it("DETERMINISTIC_ONLY is rule-based on every path, with its warning", () => {
    for (const decisionInput of everyCombination({ policy: "DETERMINISTIC_ONLY" })) {
      const decision = decideProvider(decisionInput);
      expect(decision.drafter).toBe("rule-based");
      expect(codes(decision)).toEqual([AI_POLICY_DETERMINISTIC]);
    }
  });

  it("the cloud needs THIS request's consent under every policy", () => {
    for (const policy of AI_POLICIES) {
      for (const decisionInput of everyCombination({ policy })) {
        const decision = decideProvider(decisionInput);
        if (!decisionInput.requestConsentsCloud) {
          expect(decision.drafter, `${policy} ${JSON.stringify(decisionInput)}`).not.toBe("cloud");
          // An outside endpoint behind the local setting needs consent too.
          if (decisionInput.localTrust === "CLOUD") expect(decision.drafter).not.toBe("local");
        }
      }
    }
  });

  it("LOCAL_PREFERRED: consent + allowed boundary + configured cloud -> cloud; otherwise said and local/rule-based", () => {
    expect(decideProvider(input({ requestConsentsCloud: true, cloudConfigured: true })).drafter).toBe("cloud");

    const refused = decideProvider(
      input({ boundary: "LOCAL_ONLY", requestConsentsCloud: true, cloudConfigured: true, localConfigured: true }),
    );
    expect(refused.drafter).toBe("local");
    expect(codes(refused)).toEqual([CLOUD_AI_REFUSED_LOCAL_ONLY]);

    const noCloud = decideProvider(input({ requestConsentsCloud: true, localConfigured: true }));
    expect(noCloud.drafter).toBe("local");
    expect(codes(noCloud)).toEqual([AI_UNAVAILABLE]);

    const nothing = decideProvider(input({ requestConsentsCloud: true }));
    expect(nothing.drafter).toBe("rule-based");
    expect(codes(nothing)).toEqual([AI_UNAVAILABLE]);

    // No local, no consent: rule-based and nothing to warn about (not a fault).
    const plain = decideProvider(input({}));
    expect(plain.drafter).toBe("rule-based");
    expect(plain.warnings).toEqual([]);
  });

  it("CLOUD_ALLOWED: cloud with consent, else the local model, else rule-based", () => {
    const base = { policy: "CLOUD_ALLOWED" as const, cloudConfigured: true, localConfigured: true };
    expect(decideProvider(input({ ...base, requestConsentsCloud: true })).drafter).toBe("cloud");
    expect(decideProvider(input({ ...base })).drafter).toBe("local");
    expect(decideProvider(input({ policy: "CLOUD_ALLOWED", cloudConfigured: true })).drafter).toBe("rule-based");
  });

  it("an explicit useLocalAi keeps the W20 precedence: never the cloud, an absent model is said", () => {
    for (const policy of ["LOCAL_PREFERRED", "CLOUD_ALLOWED", "LOCAL_ONLY"] as const) {
      const both = decideProvider(
        input({ policy, requestAsksLocal: true, requestConsentsCloud: true, cloudConfigured: true, localConfigured: true }),
      );
      expect(both.drafter, policy).toBe("local");
      const none = decideProvider(
        input({ policy, requestAsksLocal: true, requestConsentsCloud: true, cloudConfigured: true }),
      );
      expect(none.drafter, policy).toBe("rule-based");
      // W21 verifier fix: under LOCAL_ONLY a model was promised, so the same
      // MODEL_UNAVAILABLE code as the default path is carried too.
      expect(codes(none), policy).toEqual(
        policy === "LOCAL_ONLY" ? [LOCAL_AI_UNAVAILABLE, "MODEL_UNAVAILABLE"] : [LOCAL_AI_UNAVAILABLE],
      );
    }
  });

  it("an outside endpoint behind the local setting is refused for useLocalAi without consent, and says why", () => {
    const decision = decideProvider(
      input({ policy: "CLOUD_ALLOWED", localConfigured: true, localTrust: "CLOUD", requestAsksLocal: true }),
    );
    expect(decision.drafter).toBe("rule-based");
    expect(codes(decision)).toEqual([LOCAL_AI_UNAVAILABLE]);
    expect(decision.warnings[0]!.messageTr).toMatch(/onayınız olmadan/u);
  });
});

describe("matter analysis (no per-request consent) — policyAllowsModelTasks", () => {
  const onMachine = { trust: "LOCAL_PROCESS" as EndpointTrust };
  const ownNetwork = { trust: "TRUSTED_LOCAL_NETWORK" as EndpointTrust };
  const outside = { trust: "CLOUD" as EndpointTrust };

  it("DETERMINISTIC_ONLY refuses model tasks even with an on-machine model", () => {
    const decision = decideModelTasks("DETERMINISTIC_ONLY", { extraction: onMachine, synthesis: onMachine });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("AI_POLICY_DETERMINISTIC");
  });

  it("every other policy allows them only on this computer or the lawyer's own network", () => {
    for (const policy of ["LOCAL_ONLY", "LOCAL_PREFERRED", "CLOUD_ALLOWED"] as const) {
      expect(policyAllowsModelTasks(policy, { extraction: onMachine, synthesis: ownNetwork }), policy).toBe(true);
      expect(policyAllowsModelTasks(policy, { extraction: onMachine, synthesis: outside }), policy).toBe(false);
      expect(policyAllowsModelTasks(policy, { extraction: outside, synthesis: onMachine }), policy).toBe(false);
      expect(decideModelTasks(policy, { extraction: outside, synthesis: outside }).code).toBe("MODEL_OFF_MACHINE");
      expect(decideModelTasks(policy, {}).code).toBe("MODEL_UNAVAILABLE");
      expect(decideModelTasks(policy, { extraction: onMachine }).allowed).toBe(false);
    }
  });
});

describe("the model route table under the policy", () => {
  it("the verified W20 gap: a hosted 'local' address under the DEFAULT settings fills no role at all", () => {
    const table = resolveModelRoutes(HOSTED_ENV, { fetchImpl: noFetch });
    expect(table.policy).toBe("LOCAL_PREFERRED");
    expect(table.boundary).toBe("ALLOW_CLOUD");
    expect(table.status).toBe("refused");
    expect(table.roles).toEqual({});
    expect(table.matterAnalysisAllowed).toBe(false);
    expect(table.messageTr).toMatch(/kendi ağınızda değil/u);
  });

  it("LOCAL_ONLY and DETERMINISTIC_ONLY refuse a hosted address too", () => {
    for (const policy of ["LOCAL_ONLY", "DETERMINISTIC_ONLY"] as const) {
      const table = resolveModelRoutes({ ...HOSTED_ENV, COLLEX_AI_POLICY: policy }, { fetchImpl: noFetch });
      expect(table.status, policy).toBe("refused");
      expect(table.roles).toEqual({});
    }
  });

  it("CLOUD_ALLOWED admits a hosted address for the ANSWER roles only; matter analysis refuses it", () => {
    const table = resolveModelRoutes({ ...HOSTED_ENV, COLLEX_AI_POLICY: "CLOUD_ALLOWED" }, { fetchImpl: noFetch });
    expect(table.status).toBe("configured");
    expect(table.trust).toBe("CLOUD");
    expect(Object.keys(table.roles).sort()).toEqual(["answer", "verifier"]);
    expect(table.roles.matterExtraction).toBeUndefined();
    expect(table.roles.matterSynthesis).toBeUndefined();
    expect(table.matterAnalysisAllowed).toBe(false);
    // Even if a caller wired the answer adapter into the matter lane, the
    // model-task gate would still refuse it.
    const answer = table.roles.answer!;
    expect(policyAllowsModelTasks("CLOUD_ALLOWED", { extraction: answer, synthesis: answer })).toBe(false);
    expect(
      policyAllowsModelTasks("CLOUD_ALLOWED", {
        extraction: table.roles.matterExtraction,
        synthesis: table.roles.matterSynthesis,
      }),
    ).toBe(false);
    expect(table.warnings.some((warning) => /dosya incelemesinde kullanılmaz/u.test(warning))).toBe(true);
    // An outside service is never labelled "yerel".
    expect(localModelLabel(answer)).not.toMatch(/Yerel/u);
  });

  it("DETERMINISTIC_ONLY leaves every role empty even for a loopback model", () => {
    const table = resolveModelRoutes({ ...LOOPBACK_ENV, COLLEX_AI_POLICY: "DETERMINISTIC_ONLY" }, { fetchImpl: noFetch });
    expect(table.status).toBe("refused");
    expect(table.roles).toEqual({});
    expect(table.policy).toBe("DETERMINISTIC_ONLY");
  });

  it("a loopback model fills all four roles under the default policy and may run matter tasks", () => {
    const table = resolveModelRoutes(LOOPBACK_ENV, { fetchImpl: noFetch });
    expect(table.status).toBe("configured");
    expect(Object.keys(table.roles).sort()).toEqual(["answer", "matterExtraction", "matterSynthesis", "verifier"]);
    expect(table.matterAnalysisAllowed).toBe(true);
    expect(
      policyAllowsModelTasks(table.policy, {
        extraction: table.roles.matterExtraction,
        synthesis: table.roles.matterSynthesis,
      }),
    ).toBe(true);
  });

  it("the policy object handed in by the caller wins over the environment (resolved ONCE)", () => {
    const once = resolveEffectiveAiPolicy({ COLLEX_AI_POLICY: "DETERMINISTIC_ONLY" });
    const table = resolveModelRoutes({ ...LOOPBACK_ENV, COLLEX_AI_POLICY: "CLOUD_ALLOWED" }, { fetchImpl: noFetch, policy: once });
    expect(table.status).toBe("refused");
    expect(table.policy).toBe("DETERMINISTIC_ONLY");
    expect(table.boundary).toBe("LOCAL_ONLY");
  });

  it("every adapter is built under the EFFECTIVE boundary (the policy can only narrow it)", () => {
    const table = resolveModelRoutes({ ...LOOPBACK_ENV, COLLEX_AI_POLICY: "LOCAL_ONLY" }, { fetchImpl: noFetch });
    expect(table.status).toBe("configured");
    expect(table.boundary).toBe("LOCAL_ONLY");
  });
});

/** Acceptance L: one local model, one request at a time. */
describe("L: concurrency 1 serializes every call against the endpoint", () => {
  /**
   * A scripted endpoint that answers each request with the tag it was sent,
   * after a delay that SHRINKS with arrival order — so if two requests were
   * ever in flight together, the later one would finish first and the peak
   * counter would see it.
   */
  function probeEndpoint(options: { failTag?: number } = {}) {
    let inFlight = 0;
    let peak = 0;
    const arrivals: number[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const found = (body.messages[1]?.content ?? "").match(/TAG:(\d+)/u);
      const tag = found !== null ? Number(found[1]) : -1;
      arrivals.push(tag);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, 12 - arrivals.length)));
        if (tag === options.failTag) return new Response("down", { status: 503 });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tag }) } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      } finally {
        inFlight -= 1;
      }
    }) as unknown as typeof fetch;
    return { fetchImpl, arrivals, peak: () => peak };
  }

  const request = (tag: number) => ({ system: "s", instruction: `TAG:${tag}`, shapeHint: '{"tag":0}' });

  it("the default concurrency is 1", () => {
    expect(DEFAULT_LOCAL_CONCURRENCY).toBe(1);
  });

  for (const env of [
    { name: "default (setting absent)", extra: {} },
    { name: "COLLEX_LOCAL_LLM_CONCURRENCY=1", extra: { COLLEX_LOCAL_LLM_CONCURRENCY: "1" } },
  ]) {
    it(`${env.name}: never two in flight across all four roles, FIFO, results stay correct`, async () => {
      const probe = probeEndpoint();
      const table = resolveModelRoutes(
        { ...LOOPBACK_ENV, COLLEX_LOCAL_LLM_MODEL_EXTRACTION: "cikarim", ...env.extra },
        { fetchImpl: probe.fetchImpl },
      );
      const roles = [table.roles.answer!, table.roles.verifier!, table.roles.matterExtraction!, table.roles.matterSynthesis!];
      const tags = Array.from({ length: 12 }, (_, index) => index);
      const results = await Promise.all(
        tags.map((tag) => roles[tag % roles.length]!.generateJson<{ tag: number }>(request(tag))),
      );
      expect(probe.peak()).toBe(1);
      expect(results.map((result) => result.tag)).toEqual(tags);
      expect(probe.arrivals).toEqual(tags);
    });
  }

  it("a failing call does not wedge the queue and does not let two through", async () => {
    const probe = probeEndpoint({ failTag: 3 });
    const table = resolveModelRoutes(LOOPBACK_ENV, { fetchImpl: probe.fetchImpl });
    const settled = await Promise.allSettled(
      Array.from({ length: 7 }, (_, tag) => table.roles.answer!.generateJson<{ tag: number }>(request(tag))),
    );
    expect(probe.peak()).toBe(1);
    expect(settled.map((entry) => entry.status)).toEqual([
      "fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled",
    ]);
    settled.forEach((entry, tag) => {
      if (entry.status === "fulfilled") expect(entry.value.tag).toBe(tag);
    });
  });

  it("the probe really detects overlap: concurrency 2 lets two in (so peak 1 above is not vacuous)", async () => {
    const probe = probeEndpoint();
    const table = resolveModelRoutes({ ...LOOPBACK_ENV, COLLEX_LOCAL_LLM_CONCURRENCY: "2" }, { fetchImpl: probe.fetchImpl });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, tag) => table.roles.answer!.generateJson<{ tag: number }>(request(tag))),
    );
    expect(probe.peak()).toBe(2);
    expect(results.map((result) => result.tag)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("the gate is per route table: a second table (a separate worker process) has its own", async () => {
    // Documented limitation, not a feature: two tables against one endpoint
    // can put two requests in flight. The Mac profile therefore runs the
    // analysis worker in-process, sharing serve.mjs' one table.
    const probe = probeEndpoint();
    const first = resolveModelRoutes(LOOPBACK_ENV, { fetchImpl: probe.fetchImpl });
    const second = resolveModelRoutes(LOOPBACK_ENV, { fetchImpl: probe.fetchImpl });
    await Promise.all([
      first.roles.answer!.generateJson(request(0)),
      second.roles.matterExtraction!.generateJson(request(1)),
    ]);
    expect(probe.peak()).toBe(2);
  });
});
