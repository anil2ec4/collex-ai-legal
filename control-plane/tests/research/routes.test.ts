/**
 * Route tests for the /v1/research hono sub-router (Lane F2, contract §2).
 * Fully offline: app.request() with a ScriptedGateway.
 */

import { describe, expect, it } from "vitest";
import { createResearchRouter } from "../../src/research/routes.js";
import { QUESTION, ScriptedGateway, fixedClocks, happyScripts } from "./helpers.js";

function happyRouter() {
  return createResearchRouter({
    gateway: new ScriptedGateway(happyScripts()),
    ...fixedClocks(),
  });
}

async function postResearch(app: ReturnType<typeof createResearchRouter>, body: unknown) {
  return app.request("/v1/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /v1/research", () => {
  it("returns an AnswerResult-compatible body plus the research block", async () => {
    const response = await postResearch(happyRouter(), {
      question: QUESTION,
      budgets: { maxToolCalls: 24, maxFetches: 6, maxWallTimeMs: 120_000 },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["schema"]).toBe("collex.answer.result/v1");
    expect(body["status"]).toBe("QUALIFIED");
    expect((body["claims"] as Array<{ verdict: string }>).some((claim) => claim.verdict === "CONFLICTING_AUTHORITIES")).toBe(true);
    expect(Array.isArray(body["claims"])).toBe(true);
    expect(Array.isArray(body["evidence"])).toBe(true);
    const research = body["research"] as Record<string, unknown>;
    expect(research["mode"]).toBe("live");
    expect(Array.isArray(research["toolCalls"])).toBe(true);
    expect(Array.isArray(research["fetchedDocuments"])).toBe(true);
    const spent = research["budgetSpent"] as Record<string, number>;
    expect(spent["toolCalls"]).toBeGreaterThan(0);
    expect((research["upstream"] as Record<string, unknown>)["healthy"]).toBe(true);
  });

  it("rejects a non-JSON body with 400", async () => {
    const response = await postResearch(happyRouter(), "not json{");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
  });

  it("rejects a missing/short question and unknown fields with 400", async () => {
    const app = happyRouter();
    const missing = await postResearch(app, {});
    expect(missing.status).toBe(400);
    const short = await postResearch(app, { question: "ab" });
    expect(short.status).toBe(400);
    const unknown = await postResearch(app, { question: QUESTION, evil: true });
    expect(unknown.status).toBe(400);
    const badAsOf = await postResearch(app, { question: QUESTION, asOf: "27.08.2026" });
    expect(badAsOf.status).toBe(400);
  });

  it("accepts additive court/date filters and enforces them on evidence (contract D)", async () => {
    // Every fixture decision is dated 2023-05-11; a dateTo before that must
    // keep ALL of them out of the citable evidence — counted, never silent.
    const response = await postResearch(happyRouter(), {
      question: QUESTION,
      budgets: { maxToolCalls: 24, maxFetches: 6, maxWallTimeMs: 120_000 },
      filters: { dateTo: "2020-01-01" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      evidence: unknown[];
      warnings: string[];
    };
    expect(body.evidence).toEqual([]);
    expect(body.warnings.some((w) => w.startsWith("EVIDENCE_FILTERED:"))).toBe(true);

    // A malformed filter date is a 400, and an unknown filter key too.
    const bad = await postResearch(happyRouter(), {
      question: QUESTION,
      filters: { dateTo: "01.01.2020" },
    });
    expect(bad.status).toBe(400);
    const unknown = await postResearch(happyRouter(), {
      question: QUESTION,
      filters: { court: "Yargıtay" },
    });
    expect(unknown.status).toBe(400);
  });

  it("clamps huge budgets to the contract ceiling instead of rejecting", async () => {
    const gateway = new ScriptedGateway(happyScripts());
    const app = createResearchRouter({ gateway, ...fixedClocks() });
    const response = await postResearch(app, {
      question: QUESTION,
      budgets: { maxToolCalls: 999_999, maxFetches: 88_888, maxWallTimeMs: 10 ** 9 },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      research: { budgetSpent: { toolCalls: number; fetches: number } };
    };
    expect(body.research.budgetSpent.toolCalls).toBeLessThanOrEqual(24);
    expect(body.research.budgetSpent.fetches).toBeLessThanOrEqual(10);
    expect(gateway.calls.length).toBeLessThanOrEqual(24);
  });

  it("answers a typed 502 when the gateway is unreachable for every call", async () => {
    const gateway = new ScriptedGateway({}, () => ({ error: "UNAVAILABLE" }));
    const app = createResearchRouter({ gateway, ...fixedClocks() });
    const response = await postResearch(app, { question: QUESTION });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("answers a typed 502 when no gateway is configured", async () => {
    const app = createResearchRouter({});
    const response = await postResearch(app, { question: QUESTION });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("GET /v1/research/health", () => {
  it("reports ok + toolCount through the injected probe", async () => {
    const app = createResearchRouter({
      probe: async () => ({ gateway: "ok", toolCount: 54 }),
    });
    const response = await app.request("/v1/research/health");
    expect(response.status).toBe(200);
    // `state` is the additive W12-F field (contract [H]).
    expect(await response.json()).toEqual({ gateway: "ok", toolCount: 54, state: "ok" });
  });

  it("reports unreachable as 503", async () => {
    const app = createResearchRouter({
      probe: async () => ({ gateway: "unreachable" }),
    });
    const response = await app.request("/v1/research/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ gateway: "unreachable", state: "down" });
  });

  it("defaults to a gateway round-trip when no probe is injected", async () => {
    const gateway = new ScriptedGateway({
      check_government_servers_health: () => ({ ok: { status: "ok" } }),
    });
    const app = createResearchRouter({ gateway });
    const response = await app.request("/v1/research/health");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { gateway: string }).gateway).toBe("ok");
    expect(gateway.calls[0]?.toolName).toBe("check_government_servers_health");
  });
});
