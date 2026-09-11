/**
 * W14/B-15 — the accessibility test.
 *
 * FEATURE measured 28 and ARCH 29 of the 54 registered MCP tools as callable
 * from NO code path. This suite is the guard that stops that from happening
 * again: it classifies EVERY registered tool as REACHABLE or NOT_YET_WIRED,
 * demands a one-sentence Turkish reason for every unwired one, and — the part
 * that makes "REACHABLE" a claim rather than a label — actually DRIVES each
 * lane against a fake gateway and asserts the tool was called.
 *
 * If a future change unwires a lane, `reachable` drops and this suite fails.
 */

import { describe, expect, it } from "vitest";

import {
  buildToolInventory,
  summarizeToolInventory,
  type ToolReachability,
} from "../../src/capabilities/inventory.js";
import { ALL_TOOL_NAMES, lookupCapability } from "../../src/capabilities/registry.js";
import { EXPECTED_TOOL_COUNT } from "../../src/capabilities/registry.js";
import { FakeGateway, type ToolCallRequest } from "../../src/gateway/gateway.js";
import { InMemoryRunStore, type RunState } from "../../src/orchestration/executor.js";
import { executeResearchRun } from "../../src/orchestration/executor.js";
import { DEFAULT_DEEP_BUDGET, newSpend } from "../../src/orchestration/budgets.js";
import { createCoverageVerifier } from "../../src/planner/contrary.js";
import { createLiveResearchPlanner } from "../../src/research/livePlanner.js";
import { createLiveCapabilityExecutor } from "../../src/research/liveExecutor.js";
import { LiveDocumentStore } from "../../src/research/liveEvidence.js";
import { runResearch } from "../../src/research/researchService.js";
import { CAPABILITY_NAMES } from "../../src/capabilities/registry.js";
import { SOURCE_CATALOG, FETCH_KINDS, WITHIN_KINDS } from "../../src/sources/catalog.js";
import { searchSources } from "../../src/sources/searchService.js";
import { fetchSourceCard } from "../../src/sources/fetchService.js";
import { createSourcesRouter } from "../../src/sources/routes.js";
import { AUTH, T0 } from "./helpers.js";

// ---------------------------------------------------------------------------
// The inventory itself
// ---------------------------------------------------------------------------

const INVENTORY: ToolReachability[] = buildToolInventory();
const SUMMARY = summarizeToolInventory(INVENTORY);

describe("tool reachability inventory (B-15)", () => {
  it("classifies EVERY registered tool, and only registered tools", () => {
    expect(INVENTORY).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(INVENTORY.map((t) => t.tool)).toEqual([...ALL_TOOL_NAMES]);
    for (const entry of INVENTORY) {
      expect(["REACHABLE", "NOT_YET_WIRED"]).toContain(entry.state);
      expect(entry.capability).toBe(lookupCapability(entry.tool));
    }
  });

  it("keeps the offline tool surface at exactly 54", () => {
    expect(ALL_TOOL_NAMES).toHaveLength(54);
    expect(EXPECTED_TOOL_COUNT).toBe(54);
  });

  it("reaches at least 30 tools (the B-15 acceptance floor)", () => {
    expect(SUMMARY.reachable).toBeGreaterThanOrEqual(30);
    expect(SUMMARY.reachable + SUMMARY.notYetWired).toBe(EXPECTED_TOOL_COUNT);
  });

  it("gives every NOT_YET_WIRED tool a one-sentence Turkish reason", () => {
    for (const entry of INVENTORY.filter((t) => t.state === "NOT_YET_WIRED")) {
      expect(entry.via, entry.tool).toEqual([]);
      expect(entry.note.length, entry.tool).toBeGreaterThan(20);
      expect(entry.note.trim().endsWith("."), entry.tool).toBe(true);
      // A reason, never a shrug.
      expect(entry.note.toLowerCase(), entry.tool).not.toContain("bilinmiyor");
    }
  });

  it("names at least one calling lane for every REACHABLE tool", () => {
    for (const entry of INVENTORY.filter((t) => t.state === "REACHABLE")) {
      expect(entry.via.length, entry.tool).toBeGreaterThan(0);
      expect(entry.note, entry.tool).toContain("Çağıran hat:");
    }
  });

  it("reports the three lanes that used to be dead as reachable", () => {
    const state = (tool: string): string =>
      INVENTORY.find((t) => t.tool === tool)?.state ?? "MISSING";
    // G1: Uyuşmazlık — searched but never fetchable, so never evidence.
    expect(state("search_uyusmazlik_decisions")).toBe("REACHABLE");
    expect(state("get_uyusmazlik_document_markdown_from_url")).toBe("REACHABLE");
    // G2: Emsal — registered but planned by no template.
    expect(state("search_emsal_detailed_decisions")).toBe("REACHABLE");
    expect(state("get_emsal_document_markdown")).toBe("REACHABLE");
    // G3: the WITHIN_BY_TYPE family — only search_within_kanun was ever called.
    for (const tool of [
      "search_within_khk",
      "search_within_tuzuk",
      "search_within_kurum_yonetmelik",
      "search_within_teblig",
      "search_within_cbk",
      "search_within_cbyonetmelik",
      "search_within_cbbaskankarar",
      "search_within_cbgenelge",
    ]) {
      expect(state(tool), tool).toBe("REACHABLE");
    }
  });
});

// ---------------------------------------------------------------------------
// Every REACHABLE claim is DEMONSTRATED against a fake gateway
// ---------------------------------------------------------------------------

/** Payload shapes per tool, close enough to the real ones to parse. */
function fakePayloadFor(request: ToolCallRequest): unknown {
  const tool = request.toolName;
  if (tool === "search_bedesten_unified") {
    return {
      decisions: [
        {
          documentId: "doc-1",
          itemType: { name: "YARGITAYKARARI" },
          birimAdi: "3. Hukuk Dairesi",
          esasNo: "2023/45",
          kararNo: "2024/12",
          kararTarihi: "2024-03-04T00:00:00.000Z",
        },
      ],
      total_records: 1,
    };
  }
  if (tool === "search") {
    return { results: [{ id: "deep-1", title: "Karar", text: "özet", url: "https://x.invalid/1" }] };
  }
  if (tool.startsWith("search_within_")) {
    return { result: "Madde metni: aranan ifade" };
  }
  if (tool === "search_mevzuat") {
    return {
      result: "- [6098] TÜRK BORÇLAR KANUNU (Kanunlar) | mevzuatId: 345098 | RG: 2011-02-04",
    };
  }
  if (tool.startsWith("search_")) {
    // Every remaining search tool goes through parseGenericSearch, which needs
    // an array of rows carrying one of the tool's known id fields.
    return {
      results: [
        {
          id: "row-1",
          document_url: "https://x.invalid/row-1",
          documentId: "row-1",
          gundemMaddesiId: "row-1",
          decision_url: "https://x.invalid/row-1",
          karar_id: "row-1",
          decision_id: "row-1",
          document_id: "row-1",
          pdf_url: "https://x.invalid/row-1.pdf",
          ozelge_id: "row-1",
          issue_number: "64",
          title: "Örnek kayıt",
        },
      ],
    };
  }
  if (tool === "fetch") {
    return { id: "doc-1", title: "Karar", text: "Bir paragraf.\n\nİkinci paragraf metni burada.", url: "https://x.invalid/doc-1" };
  }
  if (tool === "get_bedesten_document_markdown") {
    return {
      documentId: "doc-1",
      markdown_content: "Bir paragraf.\n\nİkinci paragraf metni burada yer alır.",
      source_url: "https://x.invalid/doc-1",
    };
  }
  if (tool === "check_government_servers_health") {
    return { result: "ok" };
  }
  if (tool.startsWith("get_")) {
    return { result: "Bir paragraf.\n\nİkinci paragraf metni burada yer alır ve yeterince uzundur." };
  }
  /* c8 ignore next */
  return { result: "ok" };
}

function recordingGateway(): { gateway: FakeGateway; called: Set<string> } {
  const called = new Set<string>();
  const gateway = new FakeGateway((request) => {
    called.add(request.toolName);
    return {
      status: "ok",
      data: fakePayloadFor(request),
      provider: "BEDESTEN",
      observedAt: T0,
      warnings: [],
    };
  });
  return { gateway, called };
}

describe("every REACHABLE tool is actually called by its lane", () => {
  it("the sources search lane calls the search tool of every catalog source", async () => {
    const { gateway, called } = recordingGateway();
    for (const source of SOURCE_CATALOG) {
      await searchSources({ query: "tahliye taahhüdü", sources: [source.id] }, { gateway });
    }
    for (const source of SOURCE_CATALOG) {
      expect(called.has(source.toolName), source.toolName).toBe(true);
    }
  });

  it("the sources fetch lane calls the fetch tool of every catalog kind", async () => {
    const { gateway, called } = recordingGateway();
    for (const kind of FETCH_KINDS) {
      const outcome = await fetchSourceCard(
        { kind: kind.kind, externalId: "doc-1" },
        { gateway },
      );
      expect(outcome.ok, kind.kind).toBe(true);
    }
    for (const kind of FETCH_KINDS) {
      expect(called.has(kind.toolName), kind.toolName).toBe(true);
    }
  });

  it("the within lane calls both of its tools", async () => {
    const { gateway, called } = recordingGateway();
    const app = createSourcesRouter({ gateway });
    for (const within of WITHIN_KINDS) {
      const response = await app.request("/v1/sources/within", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: within.kind, id: "1", keyword: "tazminat" }),
      });
      expect(response.status, within.kind).toBe(200);
    }
    for (const within of WITHIN_KINDS) {
      expect(called.has(within.toolName), within.toolName).toBe(true);
    }
  });

  it("no lane calls a tool outside the 54-tool registry", async () => {
    const { gateway, called } = recordingGateway();
    for (const source of SOURCE_CATALOG) {
      await searchSources({ query: "kira", sources: [source.id] }, { gateway });
    }
    for (const kind of FETCH_KINDS) {
      await fetchSourceCard({ kind: kind.kind, externalId: "doc-1" }, { gateway });
    }
    for (const tool of called) {
      expect(ALL_TOOL_NAMES, tool).toContain(tool);
    }
  });
});

// ---------------------------------------------------------------------------
// G1: a Uyuşmazlık hit becomes EVIDENCE (it could not, before)
// ---------------------------------------------------------------------------

const UYUSMAZLIK_URL = "https://kararlar.uyusmazlik.gov.tr/Karar/Content/abc-123";
const UYUSMAZLIK_TEXT =
  "Davanın görüm ve çözümünde idari yargı yerinin görevli olduğuna karar verilmiştir.\n\n" +
  "Uyuşmazlık Mahkemesi, adli ve idari yargı arasındaki görev uyuşmazlığını çözer.";

function jurisdictionGateway(): FakeGateway {
  return new FakeGateway((request) => {
    const ok = (data: unknown) => ({
      status: "ok" as const,
      data,
      provider: "BEDESTEN" as const,
      observedAt: T0,
      warnings: [],
    });
    if (request.toolName === "search_uyusmazlik_decisions") {
      return ok({
        decisions: [{ document_url: UYUSMAZLIK_URL, title: "Uyuşmazlık Mahkemesi kararı" }],
      });
    }
    if (request.toolName === "get_uyusmazlik_document_markdown_from_url") {
      return ok({ markdown_content: UYUSMAZLIK_TEXT, source_url: UYUSMAZLIK_URL });
    }
    if (request.toolName === "search_bedesten_unified") {
      return ok({ decisions: [] });
    }
    if (request.toolName === "search_emsal_detailed_decisions") {
      return ok({ results: [] });
    }
    if (request.toolName === "search_mevzuat") {
      return ok({ result: "Sonuç bulunamadı." });
    }
    return ok({ result: "" });
  });
}

describe("G1: a Uyuşmazlık Mahkemesi hit can become hash-sealed evidence", () => {
  it("plans the search, fetches the document, and quotes it", async () => {
    const gateway = jurisdictionGateway();
    const run = await runResearch({
      question:
        "Kamulaştırmasız el atma davasında görev hangi yargı yolundadır; " +
        "yargı yolu uyuşmazlığı nasıl çözülür?",
      gateway,
      now: () => T0,
      monotonic: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
      newRunId: () => "run-uyusmazlik",
      today: () => "2026-09-02",
    });

    const tools = gateway.calls.map((c) => c.toolName);
    expect(tools).toContain("search_uyusmazlik_decisions");
    // The point of the fix: the hit is FETCHED, not just found.
    expect(tools).toContain("get_uyusmazlik_document_markdown_from_url");
    const fetchCall = gateway.calls.find(
      (c) => c.toolName === "get_uyusmazlik_document_markdown_from_url",
    );
    expect(fetchCall?.args["document_url"]).toBe(UYUSMAZLIK_URL);

    // ...and the fetched text is what the evidence quotes come from.
    const fetched = run.fetched.find((d) => d.source === "UYUSMAZLIK");
    expect(fetched).toBeDefined();
    expect(fetched?.text).toContain("idari yargı yerinin görevli");
    expect(fetched?.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
    const evidence = run.result.evidence.filter((e) => e.source === "UYUSMAZLIK");
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]?.quote.length).toBeGreaterThan(0);
    expect(evidence[0]?.contentSha256).toBe(fetched?.contentSha256);
  });
});

// ---------------------------------------------------------------------------
// G2: an Emsal search is planned
// ---------------------------------------------------------------------------

describe("G2: the UYAP Emsal lane is planned", () => {
  it("emits exactly one Emsal search with the tool's real arguments", async () => {
    const gateway = new FakeGateway(() => ({
      status: "ok" as const,
      data: { decisions: [] },
      provider: "BEDESTEN" as const,
      observedAt: T0,
      warnings: [],
    }));
    await runResearch({
      question: "6098 sayılı TBK m. 344 kira artış oranı uyuşmazlığı",
      gateway,
      now: () => T0,
      monotonic: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
      newRunId: () => "run-emsal",
      today: () => "2026-09-02",
    });
    const emsalCalls = gateway.calls.filter(
      (c) => c.toolName === "search_emsal_detailed_decisions",
    );
    expect(emsalCalls).toHaveLength(1);
    expect(emsalCalls[0]?.args["page_number"]).toBe(1);
    expect(typeof emsalCalls[0]?.args["keyword"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// G3: mevzuat_tur = yönetmelik -> search_within_kurum_yonetmelik
// ---------------------------------------------------------------------------

describe("G3: a yönetmelik hit is read with its OWN search_within tool", () => {
  it("calls search_within_kurum_yonetmelik, never search_within_kanun", async () => {
    const gateway = new FakeGateway((request) => {
      const ok = (data: unknown) => ({
        status: "ok" as const,
        data,
        provider: "MEVZUAT" as const,
        observedAt: T0,
        warnings: [],
      });
      if (request.toolName === "search_mevzuat") {
        return ok({
          result:
            "- [42641] İŞ SAĞLIĞI VE GÜVENLİĞİ YÖNETMELİĞİ (Yönetmelikler) | mevzuatId: 900001",
        });
      }
      return ok({ decisions: [] });
    });

    const state: RunState = {
      runId: "run-yonetmelik",
      status: "pending",
      query: "iş sağlığı ve güvenliği yönetmeliği risk değerlendirmesi",
      dataClass: "L0",
      budgets: DEFAULT_DEEP_BUDGET,
      spent: newSpend(),
      authContext: AUTH,
      steps: [],
      createdAt: T0,
      updatedAt: T0,
    };
    const store = new InMemoryRunStore();
    await store.create(state);
    const docStore = new LiveDocumentStore();
    const planner = createLiveResearchPlanner(
      { question: state.query, jurisdiction: "TR", dataClass: "L0" },
      { maxFetches: 2 },
    );
    const capabilities = createLiveCapabilityExecutor({
      gateway,
      docStore,
      trace: [],
      notes: [],
      now: () => T0,
      monotonic: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
    });
    await executeResearchRun(
      state.runId,
      {
        runs: store,
        planner,
        capabilities,
        verifier: createCoverageVerifier({
          question: state.query,
          jurisdiction: "TR",
          dataClass: "L0",
        }),
        now: () => Date.now(),
      },
      { budgets: DEFAULT_DEEP_BUDGET, allowedCapabilities: new Set(CAPABILITY_NAMES) },
    );

    const withinCalls = gateway.calls.filter((c) => c.toolName.startsWith("search_within_"));
    expect(withinCalls.map((c) => c.toolName)).toContain("search_within_kurum_yonetmelik");
    expect(withinCalls.map((c) => c.toolName)).not.toContain("search_within_kanun");
    // The instrument NUMBER, not the mevzuatId, is what the tool takes.
    const call = withinCalls.find((c) => c.toolName === "search_within_kurum_yonetmelik");
    expect(call?.args["mevzuat_no"]).toBe("42641");
    expect(typeof call?.args["keyword"]).toBe("string");
  });
});
