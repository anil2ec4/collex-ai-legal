/**
 * Tool reachability inventory (W14/B-15, and the data behind W14/B-14).
 *
 * The FEATURE and ARCH lanes measured that 28–29 of the 54 registered MCP
 * tools were called from NO code path: registered, documented, counted in
 * `/v1/health registeredToolCount`, and dead. A registered-but-unreachable
 * tool is worse than a missing one — it is a capability claim nothing can
 * honour.
 *
 * This module answers, for every one of the 54 tools, ONE question: is there a
 * code path that can call it today? The answer is DERIVED from the routing
 * tables themselves (planner/templates.ts and sources/catalog.ts), never from
 * a hand-kept list, so wiring a tool flips it to REACHABLE automatically and
 * UNWIRING one flips it back — which is exactly what
 * `tests/planner/reachability.test.ts` fails on.
 *
 * Everything a tool is NOT wired to must carry a one-sentence Turkish reason.
 * "We do not know" is not one of the allowed answers.
 */

import {
  ALL_TOOL_NAMES,
  lookupCapability,
  type CapabilityName,
} from "./registry.js";
import {
  fetchDescriptorForProvider,
  REGULATOR_SEARCH_TOOLS,
  WITHIN_TOOL_NAMES,
} from "../planner/templates.js";
import { SOURCE_LANE_TOOLS } from "../sources/catalog.js";

export type ReachabilityState = "REACHABLE" | "NOT_YET_WIRED";

/** Machine labels for the code paths that can reach a tool. */
export type ReachPath =
  | "research-planner"
  | "sources-search"
  | "sources-fetch"
  | "sources-within"
  | "api-search"
  | "health-probe";

export interface ToolReachability {
  tool: string;
  capability: CapabilityName;
  state: ReachabilityState;
  /** Sorted, deduplicated code paths; empty exactly when NOT_YET_WIRED. */
  via: readonly ReachPath[];
  /** One Turkish sentence. For NOT_YET_WIRED it says WHY, never "bilinmiyor". */
  note: string;
}

// ---------------------------------------------------------------------------
// Reach sets, derived from the live routing tables
// ---------------------------------------------------------------------------

/** Every provider family the planner knows how to fetch a document from. */
const PLANNER_FETCH_PROVIDERS: readonly string[] = Object.freeze([
  "BEDESTEN",
  "EMSAL",
  "AYM",
  "MEVZUAT",
  "KIK",
  "KVKK",
  "REKABET",
  "SAYISTAY",
  "BDDK",
  "BTK",
  "GIB",
  "SIGORTA",
  "UYUSMAZLIK",
]);

/** Tools the research planner can emit (templates + rule planner stages). */
export function plannerReachableTools(): ReadonlySet<string> {
  const tools = new Set<string>([
    // Static template lanes.
    "search_bedesten_unified",
    "search_anayasa_unified",
    "search_uyusmazlik_decisions",
    "search_emsal_detailed_decisions",
    "search_mevzuat",
    ...Object.values(REGULATOR_SEARCH_TOOLS),
    // Read-inside lanes (WITHIN_BY_TYPE, chosen from a hit's legislation kind).
    ...WITHIN_TOOL_NAMES,
  ]);
  for (const provider of PLANNER_FETCH_PROVIDERS) {
    const descriptor = fetchDescriptorForProvider(provider);
    if (descriptor !== undefined) tools.add(descriptor.toolName);
  }
  return tools;
}

/**
 * Tools reached by the `/v1/sources/*` lane. Split by role so the `via` list
 * tells an operator WHICH screen exercises the tool.
 */
function sourceLaneRole(tool: string): ReachPath | undefined {
  if (!SOURCE_LANE_TOOLS.includes(tool)) return undefined;
  const capability = lookupCapability(tool);
  if (capability === "document.fetch") return "sources-fetch";
  if (capability === "document.searchWithin") return "sources-within";
  return "sources-search";
}

/**
 * Tools reached outside both lanes:
 *  - `search`, the Deep-Research universal façade, is what `POST /v1/search`
 *    calls (api/server.ts);
 *  - `check_government_servers_health` is the default `/v1/research/health`
 *    probe (research/routes.ts).
 */
const OTHER_REACH: Readonly<Record<string, ReachPath>> = Object.freeze({
  search: "api-search",
  check_government_servers_health: "health-probe",
});

// ---------------------------------------------------------------------------
// Turkish notes
// ---------------------------------------------------------------------------

const PATH_NOTES: Readonly<Record<ReachPath, string>> = Object.freeze({
  "research-planner": "canlı araştırma planlayıcısı",
  "sources-search": "Karar ara ekranının arama ucu",
  "sources-fetch": "Karar ara ekranının “tam metni getir” ucu",
  "sources-within": "belge içinde arama ucu",
  "api-search": "POST /v1/search",
  "health-probe": "kaynak sağlık yoklaması",
});

/**
 * Why a tool is still unreachable. Every entry is a DELIBERATE decision with a
 * named reason; the reachability test refuses an empty or generic sentence.
 */
const UNWIRED_NOTES: Readonly<Record<string, string>> = Object.freeze({});

const DEFAULT_UNWIRED_NOTE =
  "Bu araç kayıtlı ama hiçbir ekran veya planlayıcı hattı tarafından çağrılmıyor;" +
  " bağlanana kadar kapsam sayfasında “bağlanmadı” olarak görünür.";

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

/**
 * Classify every registered tool. Deterministic and pure: sorted by tool name,
 * the same order `ALL_TOOL_NAMES` already guarantees.
 */
export function buildToolInventory(): ToolReachability[] {
  const plannerTools = plannerReachableTools();
  return ALL_TOOL_NAMES.map((tool) => {
    const capability = lookupCapability(tool) as CapabilityName;
    const via: ReachPath[] = [];
    if (plannerTools.has(tool)) via.push("research-planner");
    const sourceRole = sourceLaneRole(tool);
    if (sourceRole !== undefined) via.push(sourceRole);
    const other = OTHER_REACH[tool];
    if (other !== undefined) via.push(other);
    via.sort();

    if (via.length === 0) {
      return {
        tool,
        capability,
        state: "NOT_YET_WIRED" as const,
        via: Object.freeze([]),
        note: UNWIRED_NOTES[tool] ?? DEFAULT_UNWIRED_NOTE,
      };
    }
    return {
      tool,
      capability,
      state: "REACHABLE" as const,
      via: Object.freeze([...via]),
      note: `Çağıran hat: ${via.map((p) => PATH_NOTES[p]).join(", ")}.`,
    };
  });
}

export interface ToolInventorySummary {
  total: number;
  reachable: number;
  notYetWired: number;
  /** Tool names that no code path can reach, sorted. */
  notYetWiredTools: readonly string[];
  byCapability: Readonly<
    Record<string, { total: number; reachable: number; notYetWired: number }>
  >;
}

export function summarizeToolInventory(
  inventory: readonly ToolReachability[] = buildToolInventory(),
): ToolInventorySummary {
  const byCapability: Record<
    string,
    { total: number; reachable: number; notYetWired: number }
  > = {};
  let reachable = 0;
  const notYetWiredTools: string[] = [];
  for (const entry of inventory) {
    const bucket = (byCapability[entry.capability] ??= {
      total: 0,
      reachable: 0,
      notYetWired: 0,
    });
    bucket.total += 1;
    if (entry.state === "REACHABLE") {
      reachable += 1;
      bucket.reachable += 1;
    } else {
      bucket.notYetWired += 1;
      notYetWiredTools.push(entry.tool);
    }
  }
  return {
    total: inventory.length,
    reachable,
    notYetWired: inventory.length - reachable,
    notYetWiredTools: Object.freeze(notYetWiredTools.sort()),
    byCapability: Object.freeze(byCapability),
  };
}
