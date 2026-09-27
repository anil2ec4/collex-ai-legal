/**
 * "Kaynağa ulaşılamadı" is not "arandı, bulunamadı" (27.09.2026).
 *
 * An investigator ran the product with every official upstream unreachable
 * (network blocked, TLS failing) and recorded what each surface told the
 * lawyer. Every case below is one of those measured answers, driven offline
 * through the SAME payload shapes the Python gateway produced, and each
 * assertion is the honest sentence the surface must give instead:
 *
 *   #2 /v1/sources/within returned an error STRING / an `error` field as a 200
 *      result;
 *   #3 the gateway mapped every MCP `isError` to INVALID_REQUEST ("arama
 *      isteği bu kaynak için geçersiz"), and the nine typed legislation
 *      searches answered PARSER_ERROR in ~10 ms whatever the upstream did;
 *   #4 live research with 13 of 14 calls failed answered 200 PARTIAL +
 *      NO_EVIDENCE ("Bu bilgisayardaki arşivde … bulunamadı") and printed
 *      thirteen bare machine-code notes;
 *   #5 the related search drew "0 künye getirdi" for queries no source
 *      answered;
 *   #6 the Karar ara probe claimed "resmî kaynaklara bağlanabiliyor" from a
 *      reply that never left the machine;
 *   #7 /v1/sources/* 400s printed zod's English defaults.
 *
 * No network anywhere: every gateway here is a fake.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { Outcome } from "../../src/capabilities/types.js";
import { FakeGateway, HttpMcpGateway } from "../../src/gateway/gateway.js";
import { classifyFailureText } from "../../src/gateway/failureText.js";
import {
  parseFetchPayload,
  parseSearchPayload,
  parseWithinPayload,
} from "../../src/research/payloads.js";
import { runResearch, renderUpstreamNote } from "../../src/research/researchService.js";
import { createResearchRouter } from "../../src/research/routes.js";
import { relatedSearch } from "../../src/sources/relatedSearch.js";
import { createSourcesRouter, turkishSourcesZodMessage } from "../../src/sources/routes.js";
import {
  QUESTION,
  ScriptedGateway,
  fixedClocks,
  type ToolScript,
} from "../research/helpers.js";

const T0 = "2026-09-27T15:36:00.000Z";
const TLS_TEXT =
  "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain (_ssl.c:1016)";

function ok(data: unknown): Outcome<unknown> {
  return { status: "ok", data, provider: "BEDESTEN", observedAt: T0, warnings: [] };
}

function err(kind: string): Outcome<unknown> {
  return {
    status: "error",
    provider: "BEDESTEN",
    observedAt: T0,
    error: { kind: kind as never, retryable: true, correlationId: "c-1", safeMessage: "x" },
  };
}

async function postJson(app: { request: (url: string, init: RequestInit) => Response | Promise<Response> }, url: string, body: unknown) {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// #3 — the gateway reads the tool's error TEXT
// ---------------------------------------------------------------------------

describe("#3 an MCP tool error is classified by what it says", () => {
  function gatewayAnswering(text: string): HttpMcpGateway {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { isError: true, content: [{ type: "text", text }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    return new HttpMcpGateway({ baseUrl: "http://127.0.0.1:1", bearerToken: "t", fetchImpl });
  }

  it("a TLS/network failure is UNAVAILABLE (retryable), not the lawyer's invalid request", async () => {
    const outcome = await gatewayAnswering(
      `Error calling tool 'search_emsal_detailed_decisions': ${TLS_TEXT}`,
    ).callTool({ toolName: "search_emsal_detailed_decisions", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.error.kind).toBe("UNAVAILABLE");
    expect(outcome.error.retryable).toBe(true);
    // provider prose never becomes the safe message
    expect(outcome.error.safeMessage).not.toMatch(/SSL|CERTIFICATE/u);
  });

  it("the shared typed marker decides the kind and carries retry_after", async () => {
    const outcome = await gatewayAnswering(
      "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
    ).callTool({ toolName: "get_mevzuat_content", args: {} });
    expect(outcome.status === "error" && outcome.error.kind).toBe("UNAVAILABLE");
    expect(outcome.status === "error" && outcome.error.retryAfterMs).toBe(30_000);
    const timeout = await gatewayAnswering(
      "TIMEOUT retry_after=30.0: Upstream request timed out.",
    ).callTool({ toolName: "get_mevzuat_content", args: {} });
    expect(timeout.status === "error" && timeout.error.kind).toBe("TIMEOUT");
  });

  it("FastMCP's own argument validation stays INVALID_REQUEST", () => {
    expect(
      classifyFailureText(
        "1 validation error for call[search_anayasa_unified]\ndecision_type\n  Missing required argument",
      ).kind,
    ).toBe("INVALID_REQUEST");
    // a pydantic error on the UPSTREAM's model is a parse failure, not the caller's fault
    expect(classifyFailureText("1 validation error for RekabetSearchResult\ntotal_records_found").kind).toBe(
      "PARSER_ERROR",
    );
    expect(classifyFailureText("Error calling tool 'x': Server error '503 Service Unavailable'").kind).toBe(
      "UNAVAILABLE",
    );
    expect(classifyFailureText("Error calling tool 'x': ReadTimeout").kind).toBe("TIMEOUT");
  });
});

describe("#3 the nine typed legislation searches are parsed, not rejected", () => {
  it("an outage in search_kanun is UNAVAILABLE, not PARSER_ERROR", () => {
    const parsed = parseSearchPayload("search_kanun", {
      documents: [],
      total_results: 0,
      current_page: 1,
      page_size: 20,
      total_pages: 0,
      query_used: {},
      error_message: "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
    });
    expect(parsed.kind).toBe("failure");
    if (parsed.kind === "failure") expect(parsed.failure.kind).toBe("UNAVAILABLE");
  });

  it("an outage reported with raw TLS text (older gateway) is UNAVAILABLE too", () => {
    const parsed = parseSearchPayload("search_teblig", { documents: [], error_message: TLS_TEXT });
    expect(parsed.kind === "failure" && parsed.failure.kind).toBe("UNAVAILABLE");
  });

  it("a search that ran and matched nothing is an empty list, not a failure", () => {
    const parsed = parseSearchPayload("search_kanun", {
      documents: [],
      total_results: 0,
      error_message: "No legislation found matching the specified criteria.",
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind === "hits") expect(parsed.hits).toEqual([]);
  });

  it("real rows become künye hits with the Bedesten id and the within lane's type", () => {
    const parsed = parseSearchPayload("search_kanun", {
      documents: [
        {
          mevzuat_no: "6098",
          mev_adi: "TÜRK BORÇLAR KANUNU",
          mevzuat_tertip: "5",
          mevzuat_tur: 1,
          url: "bedesten:123",
          mevzuat_id: "123",
        },
        // no mevzuatId -> dropped, never backfilled
        { mevzuat_no: "1", mev_adi: "X", mevzuat_tertip: "5", mevzuat_tur: 1, url: "u" },
      ],
      total_results: 2,
      error_message: null,
    });
    expect(parsed.kind).toBe("hits");
    if (parsed.kind !== "hits") return;
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]).toMatchObject({
      externalId: "123",
      provider: "MEVZUAT",
      title: "6098 sayılı TÜRK BORÇLAR KANUNU",
      legislationNo: "6098",
      legislationKind: "Kanun",
    });
  });
});

describe("#3 a document tool's error_message is the upstream's failure, not PARSER_ERROR", () => {
  it("GİB/BTK-shaped failures read as UNAVAILABLE", () => {
    const gib = parseFetchPayload("get_gib_ozelge_document_markdown", { ozelge_id: 5 }, {
      ozelge_id: 5,
      markdown_chunk: null,
      total_pages: 0,
      error_message: `Request failed: ${TLS_TEXT}`,
    });
    expect(gib.kind === "failure" && gib.failure.kind).toBe("UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// #2 — search inside a document
// ---------------------------------------------------------------------------

describe("#2 POST /v1/sources/within never returns a failure as a result", () => {
  const within = (data: Outcome<unknown>) =>
    createSourcesRouter({ gateway: new FakeGateway(() => data), now: () => T0, newId: () => "corr-within" });

  it("an error STRING from the tool is a typed Turkish 502", async () => {
    const res = await postJson(
      within(ok({ result: `Error fetching content for mevzuatId 6098: ${TLS_TEXT}` })),
      "/v1/sources/within",
      { kind: "mevzuat", id: "6098", keyword: "kira" },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { kind: string; message: string; correlationId: string } };
    expect(body.error.kind).toBe("UNAVAILABLE");
    expect(body.error.message).toMatch(/^Belge içinde arama yapılamadı: kaynak sunucuya ulaşılamadı \(UNAVAILABLE\)/u);
    expect(body.error.message).toMatch(/eşleşme yok/u);
    expect(JSON.stringify(body)).not.toMatch(/SSL|CERTIFICATE|Error fetching/u);
  });

  it("an `error` field next to total_decisions:0 is a typed 502, not 'no decision'", async () => {
    const res = await postJson(
      within(
        ok({
          issue_number: "1",
          keyword: "hasar",
          total_decisions: 0,
          matching_decisions: 0,
          matches: [],
          error: `Failed to search within issue 1: ${TLS_TEXT}`,
        }),
      ),
      "/v1/sources/within",
      { kind: "sigorta_tahkim", id: "1", keyword: "hasar" },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/SSL|Failed to search/u);
  });

  it("a gateway-reported outage names the reason in Turkish, code in parentheses", async () => {
    const res = await postJson(within(err("TIMEOUT")), "/v1/sources/within", {
      kind: "mevzuat",
      id: "6098",
      keyword: "kira",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/süresinde yanıt vermedi \(TIMEOUT\)/u);
  });

  it("a genuine answer (including 'no match') still passes through as data", async () => {
    const res = await postJson(
      within(ok({ result: "No articles matching 'zzz' found in mevzuatId 6098" })),
      "/v1/sources/within",
      { kind: "mevzuat", id: "6098", keyword: "zzz" },
    );
    expect(res.status).toBe(200);
    expect(parseWithinPayload({ result: "Mevzuat 6098 …" }).kind).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// #4 — live research with the sources down
// ---------------------------------------------------------------------------

/**
 * The measured run: the court facade answers its structured failure, other
 * tools fail at the gateway (one of them misclassified as INVALID_REQUEST, as
 * the pre-fix gateway did), and search_within_kanun "succeeds" with an error
 * string.
 */
function outageScripts(): Record<string, ToolScript> {
  return {
    search_bedesten_unified: () => ({
      ok: {
        decisions: [],
        total_records: 0,
        requested_page: 1,
        page_size: 10,
        searched_courts: ["YARGITAYKARARI"],
        error: "service_unavailable",
        error_code: "UNAVAILABLE",
        status_code: 503,
        retry_after: "30.0",
        retryable: true,
        message: "UNAVAILABLE retry_after=30.0: Could not reach the upstream service.",
      },
    }),
    search_emsal_detailed_decisions: () => ({ error: "INVALID_REQUEST" }),
    search_mevzuat: () => ({ error: "UNAVAILABLE" }),
    search_within_kanun: () => ({ ok: `Error fetching legislation content: ${TLS_TEXT}` }),
  };
}

const outageFallback: ToolScript = () => ({ error: "UNAVAILABLE" });
const BUDGET = { maxToolCalls: 24, maxFetches: 6, maxWallTimeMs: 120_000 };

describe("#4 a research run in which no search was answered is not 'nothing found'", () => {
  it("runResearch reports unreachable, drops NO_EVIDENCE and says ALL failed", async () => {
    const gateway = new ScriptedGateway(outageScripts(), outageFallback);
    const run = await runResearch({ question: QUESTION, budgets: BUDGET, gateway, ...fixedClocks() });
    // non-vacuous: the error-string search-within really was called
    expect(gateway.calls.some((c) => c.toolName === "search_within_kanun")).toBe(true);
    expect(run.result.research.toolCalls.find((t) => t.tool === "search_within_kanun")?.ok).toBe(false);
    expect(run.unreachable).toBe(true);
    expect(run.result.reasons).not.toContain("NO_EVIDENCE");
    expect(run.result.reasons).toContain("UPSTREAM_DEGRADED:ALL");
    expect(run.result.markdown).not.toMatch(/hukuk kütüphanenizde bulunamadı/u);
  });

  it("the markdown explains every reason and note in Turkish, code in parentheses", async () => {
    const gateway = new ScriptedGateway(outageScripts(), outageFallback);
    const run = await runResearch({ question: QUESTION, budgets: BUDGET, gateway, ...fixedClocks() });
    const md = run.result.markdown;
    // no list line that is a bare machine code
    expect(md).not.toMatch(/^- (?:Not: )?[A-Z][A-Z_]+(?::[^\s]*)?$/mu);
    expect(md).not.toMatch(/^- Not: [A-Z_]+:/mu);
    expect(md).toMatch(/Canlı araştırma planlanan tüm kaynakları tarayamadı \(RESEARCH_COVERAGE_INCOMPLETE\)/u);
    expect(md).toMatch(/Resmî kaynakların hiçbiri cevap vermedi.*\(UPSTREAM_DEGRADED:ALL\)/u);
    // a repeated note is one line with a count, not a wall of identical lines
    const notes = md.split("\n").filter((line) => line.startsWith("- Not: "));
    expect(new Set(notes).size).toBe(notes.length);
  });

  it("renders each note kind as a Turkish sentence", () => {
    expect(renderUpstreamNote("SEARCH_DEGRADED:search_bedesten_unified:UNAVAILABLE")).toBe(
      "Arama sonuç vermedi — Yargıtay/Danıştay kararları aranıyor: kaynak sunucuya ulaşılamadı " +
        "(SEARCH_DEGRADED:search_bedesten_unified:UNAVAILABLE)",
    );
    expect(renderUpstreamNote("UPSTREAM_DEGRADED:13/14 tool calls failed")).toMatch(
      /^Resmî kaynaklara yapılan 14 çağrıdan 13 tanesi cevap vermedi/u,
    );
    expect(renderUpstreamNote("UPSTREAM_DEGRADED:14/14 tool calls failed")).toMatch(/HİÇBİRİ/u);
  });

  it("POST /v1/research answers the typed 502, not 200 PARTIAL", async () => {
    const app = createResearchRouter({
      gateway: new ScriptedGateway(outageScripts(), outageFallback),
      ...fixedClocks(),
    });
    const res = await postJson(app, "/v1/research", { question: QUESTION });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
    expect(body.error.message).toMatch(/“bulunamadı” sonucu DEĞİLDİR/u);
  });

  it("POST /v1/research/start behaves the same (the run fails with the typed kind)", async () => {
    let n = 0;
    const app = createResearchRouter({
      gateway: new ScriptedGateway(outageScripts(), outageFallback),
      ...fixedClocks(),
      newRunId: () => `run-${++n}`,
    });
    const started = await postJson(app, "/v1/research/start", { question: QUESTION });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    let view: { state: string; error?: { kind: string } } = { state: "running" };
    for (let i = 0; i < 200 && view.state === "running"; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      view = (await (await app.request(`/v1/research/runs/${runId}`)).json()) as typeof view;
    }
    expect(view.state).toBe("failed");
    expect(view.error?.kind).toBe("UPSTREAM_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// #5 — related search: a query no source answered has NO count
// ---------------------------------------------------------------------------

describe("#5 a related query that no source answered is not '0 künye getirdi'", () => {
  it("bulunanSatir is null (unknown), never 0, when every source failed", async () => {
    const olay =
      "Müvekkilim kiracı olarak oturduğu dairede kira sözleşmesi imzalandıktan sonra" +
      " ev sahibine tahliye taahhüdü verdi. Ev sahibi şimdi bu taahhüde dayanarak" +
      " icra takibi başlattı; biz taahhüdün geçersiz olduğunu ileri sürüyoruz.";
    let t = 0;
    let id = 0;
    const result = await relatedSearch(
      { olay, sources: ["yargitay"], maxQueries: 3 },
      {
        gateway: new FakeGateway(() => err("UNAVAILABLE")),
        now: () => T0,
        monotonic: () => (t += 5),
        newId: () => `id-${++id}`,
      },
    );
    expect(result.okSources).toEqual([]);
    const ran = result.queries.filter((q) => q.calisti);
    expect(ran.length).toBeGreaterThan(0);
    for (const q of ran) expect(q.bulunanSatir).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #7 — Turkish validation messages on /v1/sources/*
// ---------------------------------------------------------------------------

describe("#7 a /v1/sources/* 400 speaks Turkish", () => {
  it("enum, bound and stray-key issues carry no zod English", async () => {
    const app = createSourcesRouter({ gateway: new FakeGateway(() => ok({})) });
    const res = await postJson(app, "/v1/sources/search", {
      query: "kira tespit",
      sources: ["olmayan_kaynak"],
      limit: 500,
      legislationNo: "abc",
      bogus: 1,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: Array<{ path: string; message: string }> } };
    const byPath = new Map(body.error.issues.map((i) => [i.path, i.message]));
    expect(byPath.get("sources.0")).toBe("Geçersiz seçim — bu değer tanınmıyor.");
    expect(byPath.get("limit")).toBe("En çok 200 olabilir.");
    expect(byPath.get("legislationNo")).toBe("Geçersiz biçim.");
    expect(byPath.get("bogus")).toBe("Tanınmayan alan.");
    for (const issue of body.error.issues) {
      expect(issue.message).not.toMatch(/Invalid|Expected|Number must|String must|Array must|Unrecognized|Required/u);
    }
  });

  it("the translator keeps the schema's own Turkish messages", () => {
    expect(turkishSourcesZodMessage("Arama en az 2 karakter olmalı.")).toBe("Arama en az 2 karakter olmalı.");
    expect(turkishSourcesZodMessage("Array must contain at most 30 element(s)")).toBe("En çok 30 öğe seçilebilir.");
    expect(turkishSourcesZodMessage("String must contain at most 500 character(s)")).toBe(
      "En çok 500 karakter olabilir.",
    );
  });
});

// ---------------------------------------------------------------------------
// #4 / #5 / #6 — what the console draws
// ---------------------------------------------------------------------------

describe("the console draws an outage as an outage", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(resolve(here, "../../public/console.html"), "utf8");

  it("#6 the Karar ara probe no longer claims the official sources are reachable", () => {
    expect(html.includes("resmî kaynaklara bağlanabiliyor")).toBe(false);
    expect(html.includes("Resmî kaynak bağlantısı açık")).toBe(false);
    expect(html).toContain("Resmî kaynak arama bileşeni çalışıyor");
    expect(html).toContain("ulaşılabilir olup olmadığı ilk aramada belli olur");
  });

  it("#5 a query with bulunanSatir null is drawn 'kaynak cevap vermedi', not green", () => {
    expect(html).toContain("var noAnswer = q.calisti !== false && q.bulunanSatir === null;");
    expect(html).toContain('"kaynak cevap vermedi"');
  });

  it("#4 'none answered' has its own sentence, ahead of 'some answered'", () => {
    const all = html.indexOf("[/^UPSTREAM_DEGRADED:ALL$/,");
    const some = html.indexOf("[/^UPSTREAM_DEGRADED/,");
    expect(all).toBeGreaterThan(0);
    expect(some).toBeGreaterThan(all);
    expect(html).toContain("Resmî kaynakların HİÇBİRİ cevap vermedi");
  });
});
