/**
 * Capability registry: maps the raw MCP tool surface (exactly 54 tools in the
 * offline configuration — the invariant asserted by scripts/smoke_check.py)
 * onto the 7 stable capabilities of Master Build Brief section 6.5.
 *
 * The planner only ever sees capability names; raw tool names stay inside the
 * gateway/adapters. The tool list below was enumerated from the live FastMCP
 * app (`mcp_server_main.app.get_tools()`) with provider env vars blanked, on
 * 2026-08-26. `search_bedesten_semantic` (the conditional 55th tool, present
 * only when OPENROUTER_API_KEY is set) is intentionally NOT part of the
 * offline registry invariant.
 */

export const CAPABILITY_NAMES = [
  "caseLaw.search",
  "legislation.search",
  "regulator.search",
  "document.fetch",
  "document.searchWithin",
  "legislation.resolveTarget",
  "source.health",
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** Offline MCP tool-count invariant (see scripts/smoke_check.py). */
export const EXPECTED_TOOL_COUNT = 54;

const frozen = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

export const CAPABILITY_TOOLS: Readonly<Record<CapabilityName, readonly string[]>> =
  Object.freeze({
    // Bedesten unified (Yargıtay/Danıştay/Yerel/İstinaf/KYB) + Emsal + AYM +
    // Uyuşmazlık searches, plus the Deep-Research universal `search` façade.
    "caseLaw.search": frozen([
      "search",
      "search_anayasa_unified",
      "search_bedesten_unified",
      "search_emsal_detailed_decisions",
      "search_uyusmazlik_decisions",
    ]),
    // `search_mevzuat` plus the nine type-specific legislation searches.
    "legislation.search": frozen([
      "search_cbbaskankarar",
      "search_cbgenelge",
      "search_cbk",
      "search_cbyonetmelik",
      "search_kanun",
      "search_khk",
      "search_kurum_yonetmelik",
      "search_mevzuat",
      "search_teblig",
      "search_tuzuk",
    ]),
    // KİK, KVKK, Rekabet, Sayıştay, BDDK, BTK, GİB, Sigorta Tahkim.
    "regulator.search": frozen([
      "search_bddk_decisions",
      "search_btk_decisions",
      "search_gib_ozelge",
      "search_kik_v2_decisions",
      "search_kvkk_decisions",
      "search_rekabet_kurumu_decisions",
      "search_sayistay_unified",
      "search_sigorta_tahkim_decisions",
    ]),
    // All get_*_document* tools plus the canonical Bedesten `fetch` façade
    // (brief 6.7: `fetch` and `get_bedesten_document_markdown` are two
    // presentation wrappers over the same adapter) and the mevzuat content/
    // gerekçe/madde-tree retrieval tools.
    "document.fetch": frozen([
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
    ]),
    // The search_within_* family (the nine legislation kinds + mevzuat +
    // sigorta tahkim issue lane).
    "document.searchWithin": frozen([
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
    ]),
    // Amendment/current-version resolver (brief 6.8). Implemented natively in
    // the control-plane on top of document.fetch + the data plane; it is NOT
    // backed by a raw MCP tool yet, hence the empty tool list.
    "legislation.resolveTarget": frozen([]),
    "source.health": frozen(["check_government_servers_health"]),
  });

function buildToolIndex(): ReadonlyMap<string, CapabilityName> {
  const index = new Map<string, CapabilityName>();
  for (const capability of CAPABILITY_NAMES) {
    for (const tool of CAPABILITY_TOOLS[capability]) {
      if (index.has(tool)) {
        throw new Error(`tool mapped to more than one capability: ${tool}`);
      }
      index.set(tool, capability);
    }
  }
  return index;
}

const TOOL_TO_CAPABILITY = buildToolIndex();

/** All raw MCP tool names known to the registry, sorted, frozen. */
export const ALL_TOOL_NAMES: readonly string[] = frozen(
  [...TOOL_TO_CAPABILITY.keys()].sort(),
);

/** Capability a raw MCP tool belongs to, or undefined for unknown tools. */
export function lookupCapability(toolName: string): CapabilityName | undefined {
  return TOOL_TO_CAPABILITY.get(toolName);
}

/** Raw MCP tools backing a capability (frozen; may be empty for native capabilities). */
export function toolsForCapability(capability: CapabilityName): readonly string[] {
  return CAPABILITY_TOOLS[capability];
}
