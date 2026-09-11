import { describe, expect, it } from "vitest";
import {
  ALL_TOOL_NAMES,
  CAPABILITY_NAMES,
  CAPABILITY_TOOLS,
  EXPECTED_TOOL_COUNT,
  lookupCapability,
  toolsForCapability,
} from "../src/capabilities/registry.js";

/**
 * Authoritative offline tool inventory, enumerated from the live FastMCP app
 * (`mcp_server_main.app.get_tools()`) with provider env vars blanked —
 * the same 54-tool invariant scripts/smoke_check.py asserts.
 */
const EXPECTED_54_TOOLS = [
  "check_government_servers_health",
  "fetch",
  "get_anayasa_document_unified",
  "get_bddk_document_markdown",
  "get_bedesten_document_markdown",
  "get_btk_document_markdown",
  "get_cbbaskankarar_content",
  "get_cbgenelge_content",
  "get_emsal_document_markdown",
  "get_gib_ozelge_document_markdown",
  "get_kik_v2_document_markdown",
  "get_kvkk_document_markdown",
  "get_mevzuat_content",
  "get_mevzuat_gerekce",
  "get_mevzuat_madde_tree",
  "get_rekabet_kurumu_document",
  "get_sayistay_document_unified",
  "get_sigorta_tahkim_document_markdown",
  "get_teblig_content",
  "get_uyusmazlik_document_markdown_from_url",
  "search",
  "search_anayasa_unified",
  "search_bddk_decisions",
  "search_bedesten_unified",
  "search_btk_decisions",
  "search_cbbaskankarar",
  "search_cbgenelge",
  "search_cbk",
  "search_cbyonetmelik",
  "search_emsal_detailed_decisions",
  "search_gib_ozelge",
  "search_kanun",
  "search_khk",
  "search_kik_v2_decisions",
  "search_kurum_yonetmelik",
  "search_kvkk_decisions",
  "search_mevzuat",
  "search_rekabet_kurumu_decisions",
  "search_sayistay_unified",
  "search_sigorta_tahkim_decisions",
  "search_teblig",
  "search_tuzuk",
  "search_uyusmazlik_decisions",
  "search_within_cbbaskankarar",
  "search_within_cbgenelge",
  "search_within_cbk",
  "search_within_cbyonetmelik",
  "search_within_kanun",
  "search_within_khk",
  "search_within_kurum_yonetmelik",
  "search_within_mevzuat",
  "search_within_sigorta_tahkim_issue",
  "search_within_teblig",
  "search_within_tuzuk",
] as const;

describe("capability registry", () => {
  it("declares exactly the 7 brief-6.5 capabilities", () => {
    expect([...CAPABILITY_NAMES]).toEqual([
      "caseLaw.search",
      "legislation.search",
      "regulator.search",
      "document.fetch",
      "document.searchWithin",
      "legislation.resolveTarget",
      "source.health",
    ]);
  });

  it("maps all 54 offline tools with no orphans and no extras", () => {
    expect(EXPECTED_54_TOOLS).toHaveLength(EXPECTED_TOOL_COUNT);
    expect([...ALL_TOOL_NAMES]).toEqual([...EXPECTED_54_TOOLS]);
    for (const tool of EXPECTED_54_TOOLS) {
      expect(lookupCapability(tool), `orphan tool: ${tool}`).toBeDefined();
    }
  });

  it("maps every tool to exactly one capability (no duplicates)", () => {
    const all = CAPABILITY_NAMES.flatMap((cap) => [...toolsForCapability(cap)]);
    expect(all).toHaveLength(new Set(all).size);
    expect(all).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("routes representative tools to the expected capabilities", () => {
    expect(lookupCapability("search_bedesten_unified")).toBe("caseLaw.search");
    expect(lookupCapability("search_anayasa_unified")).toBe("caseLaw.search");
    expect(lookupCapability("search_kanun")).toBe("legislation.search");
    expect(lookupCapability("search_mevzuat")).toBe("legislation.search");
    expect(lookupCapability("search_kvkk_decisions")).toBe("regulator.search");
    expect(lookupCapability("search_sayistay_unified")).toBe("regulator.search");
    expect(lookupCapability("fetch")).toBe("document.fetch");
    expect(lookupCapability("get_bedesten_document_markdown")).toBe("document.fetch");
    expect(lookupCapability("search_within_kanun")).toBe("document.searchWithin");
    expect(lookupCapability("check_government_servers_health")).toBe("source.health");
  });

  it("legislation.search holds search_mevzuat plus the nine type-specific searches", () => {
    expect(toolsForCapability("legislation.search")).toHaveLength(10);
    expect(toolsForCapability("legislation.search")).toContain("search_mevzuat");
  });

  it("legislation.resolveTarget is a native capability with no raw tool (yet)", () => {
    expect(toolsForCapability("legislation.resolveTarget")).toEqual([]);
  });

  it("returns undefined for unknown tools (incl. the conditional 55th tool)", () => {
    expect(lookupCapability("does_not_exist")).toBeUndefined();
    // search_bedesten_semantic only exists when OPENROUTER_API_KEY is set and
    // is deliberately outside the 54-tool offline invariant.
    expect(lookupCapability("search_bedesten_semantic")).toBeUndefined();
  });

  it("is immutable (frozen registry and frozen tool lists)", () => {
    expect(Object.isFrozen(CAPABILITY_TOOLS)).toBe(true);
    for (const cap of CAPABILITY_NAMES) {
      expect(Object.isFrozen(toolsForCapability(cap))).toBe(true);
    }
    expect(Object.isFrozen(ALL_TOOL_NAMES)).toBe(true);
    // Mutation attempts throw in strict (ESM) mode.
    expect(() => {
      (toolsForCapability("source.health") as string[]).push("evil_tool");
    }).toThrow(TypeError);
  });
});
