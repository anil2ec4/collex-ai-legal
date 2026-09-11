/**
 * Source catalog for the "Karar ara" lane (W14/B-16).
 *
 * ONE entry per thing a Turkish litigator can tick in a search form, mapped
 * onto the raw MCP tool that answers it and the REAL argument names that tool
 * takes. The catalog is data, not behaviour: `sources/searchService.ts` walks
 * it, `capabilities/inventory.ts` reads it to decide which of the 54 tools are
 * reachable, and `sources/manifest.ts` renders it as the coverage page.
 *
 * INVARIANT: this file adds NO tool. Every `toolName` below already exists in
 * `capabilities/registry.ts` (asserted at module load at the bottom) and the
 * offline surface stays exactly 54.
 *
 * Why a second search path next to the research planner: the planner answers a
 * QUESTION and returns an answer. A litigator's real workflow is list
 * scanning — "İzmir BAM, 2023–2025, tahliye taahhüdü, scan 30 decisions, mark
 * 5" — which needs künye rows fast and a separate, explicit "tam metni getir".
 * A search summary is NEVER evidence (brief 10.2); only the fetch step
 * produces a hash-sealed card.
 */

import { lookupCapability, type CapabilityName } from "../capabilities/registry.js";

// ---------------------------------------------------------------------------
// Source identities
// ---------------------------------------------------------------------------

/** Which shelf a source sits on, for grouping in the UI and the manifest. */
export type SourceFamily = "ictihat" | "mevzuat" | "kurul";

export interface SourceDescriptor {
  id: string;
  /** Lawyer Turkish; this is what the console prints. */
  label: string;
  family: SourceFamily;
  /** Raw MCP search tool answering this source. */
  toolName: string;
  capability: CapabilityName;
  /**
   * Bedesten `court_types` value when this source is one lane of the unified
   * court search; absent for sources with their own tool.
   */
  courtType?: string;
  /** True when the source accepts a `birimAdi` chamber filter. */
  supportsChamber?: boolean;
  /** True when the source accepts a decision-date range. */
  supportsDateRange?: boolean;
  /** Allowed `decisionType` values, when the tool has such a parameter. */
  decisionTypes?: readonly string[];
  /**
   * One Turkish sentence naming what this source does NOT contain. Printed on
   * the coverage page; never a marketing line.
   */
  gap?: string;
}

const BEDESTEN_COURT_SOURCES: readonly SourceDescriptor[] = Object.freeze([
  Object.freeze({
    id: "yargitay",
    label: "Yargıtay",
    family: "ictihat" as const,
    toolName: "search_bedesten_unified",
    capability: "caseLaw.search" as const,
    courtType: "YARGITAYKARARI",
    supportsChamber: true,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "danistay",
    label: "Danıştay",
    family: "ictihat" as const,
    toolName: "search_bedesten_unified",
    capability: "caseLaw.search" as const,
    courtType: "DANISTAYKARAR",
    supportsChamber: true,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "istinaf_hukuk",
    label: "İstinaf (BAM) hukuk daireleri",
    family: "ictihat" as const,
    toolName: "search_bedesten_unified",
    capability: "caseLaw.search" as const,
    courtType: "ISTINAFHUKUK",
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "yerel_hukuk",
    label: "Yerel hukuk mahkemeleri",
    family: "ictihat" as const,
    toolName: "search_bedesten_unified",
    capability: "caseLaw.search" as const,
    courtType: "YERELHUKUK",
    supportsDateRange: true,
    gap: "İlk derece kapsamı ölçülmemiştir; eksiksiz olduğu iddia edilmez.",
  }),
  Object.freeze({
    id: "kyb",
    label: "Kanun yararına bozma",
    family: "ictihat" as const,
    toolName: "search_bedesten_unified",
    capability: "caseLaw.search" as const,
    courtType: "KYB",
    supportsDateRange: true,
  }),
]);

const OTHER_CASE_LAW_SOURCES: readonly SourceDescriptor[] = Object.freeze([
  Object.freeze({
    id: "emsal",
    label: "Emsal (UYAP) kararları",
    family: "ictihat" as const,
    toolName: "search_emsal_detailed_decisions",
    capability: "caseLaw.search" as const,
    supportsDateRange: true,
    gap: "Emsal yalnız UYAP'ın yayımladığı kararları içerir; kapsamı ölçülmemiştir.",
  }),
  Object.freeze({
    id: "uyusmazlik",
    label: "Uyuşmazlık Mahkemesi",
    family: "ictihat" as const,
    toolName: "search_uyusmazlik_decisions",
    capability: "caseLaw.search" as const,
  }),
  Object.freeze({
    id: "aym",
    label: "Anayasa Mahkemesi",
    family: "ictihat" as const,
    toolName: "search_anayasa_unified",
    capability: "caseLaw.search" as const,
    decisionTypes: Object.freeze(["norm_denetimi", "bireysel_basvuru"]),
  }),
]);

const LEGISLATION_SOURCES: readonly SourceDescriptor[] = Object.freeze([
  Object.freeze({
    id: "mevzuat",
    label: "Mevzuat (tüm türler)",
    family: "mevzuat" as const,
    toolName: "search_mevzuat",
    capability: "legislation.search" as const,
  }),
  Object.freeze({
    id: "kanun",
    label: "Kanunlar",
    family: "mevzuat" as const,
    toolName: "search_kanun",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "khk",
    label: "Kanun hükmünde kararnameler",
    family: "mevzuat" as const,
    toolName: "search_khk",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "tuzuk",
    label: "Tüzükler",
    family: "mevzuat" as const,
    toolName: "search_tuzuk",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "kurum_yonetmelik",
    label: "Kurum yönetmelikleri",
    family: "mevzuat" as const,
    toolName: "search_kurum_yonetmelik",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "teblig",
    label: "Tebliğler",
    family: "mevzuat" as const,
    toolName: "search_teblig",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "cbk",
    label: "Cumhurbaşkanlığı kararnameleri",
    family: "mevzuat" as const,
    toolName: "search_cbk",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "cb_yonetmelik",
    label: "Cumhurbaşkanlığı yönetmelikleri",
    family: "mevzuat" as const,
    toolName: "search_cbyonetmelik",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "cb_karar",
    label: "Cumhurbaşkanı kararları",
    family: "mevzuat" as const,
    toolName: "search_cbbaskankarar",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
  Object.freeze({
    id: "cb_genelge",
    label: "Cumhurbaşkanlığı genelgeleri",
    family: "mevzuat" as const,
    toolName: "search_cbgenelge",
    capability: "legislation.search" as const,
    supportsDateRange: true,
  }),
]);

const REGULATOR_SOURCES: readonly SourceDescriptor[] = Object.freeze([
  Object.freeze({
    id: "kik",
    label: "Kamu İhale Kurulu",
    family: "kurul" as const,
    toolName: "search_kik_v2_decisions",
    capability: "regulator.search" as const,
    decisionTypes: Object.freeze(["uyusmazlik", "duzenleyici", "mahkeme"]),
  }),
  Object.freeze({
    id: "kvkk",
    label: "Kişisel Verileri Koruma Kurulu",
    family: "kurul" as const,
    toolName: "search_kvkk_decisions",
    capability: "regulator.search" as const,
    gap: "KVKK araması dış arama sağlayıcısına bağlıdır; kimlik yoksa hat kapalıdır.",
  }),
  Object.freeze({
    id: "rekabet",
    label: "Rekabet Kurumu",
    family: "kurul" as const,
    toolName: "search_rekabet_kurumu_decisions",
    capability: "regulator.search" as const,
  }),
  Object.freeze({
    id: "sayistay",
    label: "Sayıştay",
    family: "kurul" as const,
    toolName: "search_sayistay_unified",
    capability: "regulator.search" as const,
    decisionTypes: Object.freeze(["daire", "genel_kurul", "temyiz_kurulu"]),
  }),
  Object.freeze({
    id: "bddk",
    label: "BDDK",
    family: "kurul" as const,
    toolName: "search_bddk_decisions",
    capability: "regulator.search" as const,
    gap: "BDDK araması dış arama sağlayıcısına bağlıdır; kimlik yoksa hat kapalıdır.",
  }),
  Object.freeze({
    id: "btk",
    label: "BTK",
    family: "kurul" as const,
    toolName: "search_btk_decisions",
    capability: "regulator.search" as const,
  }),
  Object.freeze({
    id: "gib",
    label: "GİB özelgeleri",
    family: "kurul" as const,
    toolName: "search_gib_ozelge",
    capability: "regulator.search" as const,
  }),
  Object.freeze({
    id: "sigorta",
    label: "Sigorta Tahkim Komisyonu",
    family: "kurul" as const,
    toolName: "search_sigorta_tahkim_decisions",
    capability: "regulator.search" as const,
    gap: "Sigorta Tahkim araması dış arama sağlayıcısına bağlıdır; kimlik yoksa hat kapalıdır.",
  }),
]);

/** Every selectable source, in display order. */
export const SOURCE_CATALOG: readonly SourceDescriptor[] = Object.freeze([
  ...BEDESTEN_COURT_SOURCES,
  ...OTHER_CASE_LAW_SOURCES,
  ...LEGISLATION_SOURCES,
  ...REGULATOR_SOURCES,
]);

const BY_ID = new Map(SOURCE_CATALOG.map((s) => [s.id, s] as const));

export function sourceById(id: string): SourceDescriptor | undefined {
  return BY_ID.get(id);
}

/** All source ids, sorted — the closed vocabulary the request schema accepts. */
export const SOURCE_IDS: readonly string[] = Object.freeze(
  [...BY_ID.keys()].sort(),
);

/** Default selection when the caller ticks nothing: the two high courts. */
export const DEFAULT_SOURCE_IDS: readonly string[] = Object.freeze([
  "yargitay",
  "danistay",
]);

// ---------------------------------------------------------------------------
// Full-text fetch catalog ("Tam metni getir")
// ---------------------------------------------------------------------------

/**
 * How to pull ONE record of a source in full. Deliberately separate from
 * `planner/templates.ts FETCH_BY_PROVIDER`, which is keyed by provider family:
 * this table is keyed by the FETCH KIND the console offers, and it reaches the
 * legislation-content tools (tebliğ / CB kararı / CB genelgesi content,
 * gerekçe, madde ağacı) that the research planner has no reason to plan.
 */
export interface FetchKindDescriptor {
  kind: string;
  label: string;
  toolName: string;
  capability: CapabilityName;
  /** Real parameter name carrying the record id. */
  idParam: string;
  extraInput?: Readonly<Record<string, unknown>>;
  /** Provider family stamped on the produced evidence card. */
  provider: string;
}

export const FETCH_KINDS: readonly FetchKindDescriptor[] = Object.freeze([
  Object.freeze({
    kind: "karar",
    label: "Mahkeme kararı (Bedesten)",
    toolName: "fetch",
    capability: "document.fetch" as const,
    idParam: "id",
    provider: "BEDESTEN",
  }),
  Object.freeze({
    kind: "karar_markdown",
    label: "Mahkeme kararı (ham Markdown)",
    toolName: "get_bedesten_document_markdown",
    capability: "document.fetch" as const,
    idParam: "documentId",
    provider: "BEDESTEN",
  }),
  Object.freeze({
    kind: "emsal",
    label: "Emsal kararı",
    toolName: "get_emsal_document_markdown",
    capability: "document.fetch" as const,
    idParam: "id",
    provider: "EMSAL",
  }),
  Object.freeze({
    kind: "uyusmazlik",
    label: "Uyuşmazlık Mahkemesi kararı",
    toolName: "get_uyusmazlik_document_markdown_from_url",
    capability: "document.fetch" as const,
    idParam: "document_url",
    provider: "UYUSMAZLIK",
  }),
  Object.freeze({
    kind: "aym",
    label: "Anayasa Mahkemesi kararı",
    toolName: "get_anayasa_document_unified",
    capability: "document.fetch" as const,
    idParam: "document_url",
    provider: "AYM",
  }),
  Object.freeze({
    kind: "mevzuat",
    label: "Mevzuat metni",
    toolName: "get_mevzuat_content",
    capability: "document.fetch" as const,
    idParam: "mevzuat_id",
    extraInput: Object.freeze({ page_number: 1 }),
    provider: "MEVZUAT",
  }),
  Object.freeze({
    kind: "mevzuat_gerekce",
    label: "Madde gerekçesi",
    toolName: "get_mevzuat_gerekce",
    capability: "document.fetch" as const,
    idParam: "gerekce_id",
    extraInput: Object.freeze({ page_number: 1 }),
    provider: "MEVZUAT",
  }),
  Object.freeze({
    kind: "mevzuat_madde_agaci",
    label: "Madde ağacı",
    toolName: "get_mevzuat_madde_tree",
    capability: "document.fetch" as const,
    idParam: "mevzuat_id",
    provider: "MEVZUAT",
  }),
  Object.freeze({
    kind: "teblig",
    label: "Tebliğ metni",
    toolName: "get_teblig_content",
    capability: "document.fetch" as const,
    idParam: "mevzuat_no",
    provider: "MEVZUAT",
  }),
  Object.freeze({
    kind: "cb_karar",
    label: "Cumhurbaşkanı kararı metni",
    toolName: "get_cbbaskankarar_content",
    capability: "document.fetch" as const,
    idParam: "mevzuat_no",
    provider: "MEVZUAT",
  }),
  Object.freeze({
    kind: "cb_genelge",
    label: "Cumhurbaşkanlığı genelgesi metni",
    toolName: "get_cbgenelge_content",
    capability: "document.fetch" as const,
    idParam: "mevzuat_no",
    provider: "MEVZUAT",
  }),
  Object.freeze({
    kind: "kik",
    label: "Kamu İhale Kurulu kararı",
    toolName: "get_kik_v2_document_markdown",
    capability: "document.fetch" as const,
    idParam: "gundemMaddesiId",
    provider: "KIK",
  }),
  Object.freeze({
    kind: "kvkk",
    label: "KVKK kararı",
    toolName: "get_kvkk_document_markdown",
    capability: "document.fetch" as const,
    idParam: "decision_url",
    provider: "KVKK",
  }),
  Object.freeze({
    kind: "rekabet",
    label: "Rekabet Kurumu kararı",
    toolName: "get_rekabet_kurumu_document",
    capability: "document.fetch" as const,
    idParam: "karar_id",
    provider: "REKABET",
  }),
  Object.freeze({
    kind: "sayistay",
    label: "Sayıştay kararı",
    toolName: "get_sayistay_document_unified",
    capability: "document.fetch" as const,
    idParam: "decision_id",
    extraInput: Object.freeze({ decision_type: "daire" }),
    provider: "SAYISTAY",
  }),
  Object.freeze({
    kind: "bddk",
    label: "BDDK kararı",
    toolName: "get_bddk_document_markdown",
    capability: "document.fetch" as const,
    idParam: "document_id",
    provider: "BDDK",
  }),
  Object.freeze({
    kind: "btk",
    label: "BTK kararı",
    toolName: "get_btk_document_markdown",
    capability: "document.fetch" as const,
    idParam: "pdf_url",
    provider: "BTK",
  }),
  Object.freeze({
    kind: "gib",
    label: "GİB özelgesi",
    toolName: "get_gib_ozelge_document_markdown",
    capability: "document.fetch" as const,
    idParam: "ozelge_id",
    provider: "GIB",
  }),
  Object.freeze({
    kind: "sigorta",
    label: "Sigorta Tahkim kararı",
    toolName: "get_sigorta_tahkim_document_markdown",
    capability: "document.fetch" as const,
    idParam: "issue_number",
    provider: "SIGORTA",
  }),
]);

const FETCH_BY_KIND = new Map(FETCH_KINDS.map((f) => [f.kind, f] as const));

export function fetchKind(kind: string): FetchKindDescriptor | undefined {
  return FETCH_BY_KIND.get(kind);
}

/** All fetch kinds, sorted — the closed vocabulary the request schema accepts. */
export const FETCH_KIND_IDS: readonly string[] = Object.freeze(
  [...FETCH_BY_KIND.keys()].sort(),
);

// ---------------------------------------------------------------------------
// Read-inside catalog (search_within_* reached directly, not via the planner)
// ---------------------------------------------------------------------------

/**
 * "Bu metnin içinde ara" lanes the console can call directly. The nine
 * type-specific `search_within_*` tools are already reachable through the rule
 * planner (WITHIN_BY_TYPE); the two here are NOT, because the planner has no
 * mevzuatId-keyed or Sigorta-Tahkim-issue-keyed step.
 */
export interface WithinKindDescriptor {
  kind: string;
  label: string;
  toolName: string;
  capability: CapabilityName;
  idParam: string;
}

export const WITHIN_KINDS: readonly WithinKindDescriptor[] = Object.freeze([
  Object.freeze({
    kind: "mevzuat",
    label: "Mevzuat metni içinde ara",
    toolName: "search_within_mevzuat",
    capability: "document.searchWithin" as const,
    idParam: "mevzuat_id",
  }),
  Object.freeze({
    kind: "sigorta_tahkim",
    label: "Sigorta Tahkim sayısı içinde ara",
    toolName: "search_within_sigorta_tahkim_issue",
    capability: "document.searchWithin" as const,
    idParam: "issue_number",
  }),
]);

const WITHIN_BY_KIND = new Map(WITHIN_KINDS.map((w) => [w.kind, w] as const));

export function withinKind(kind: string): WithinKindDescriptor | undefined {
  return WITHIN_BY_KIND.get(kind);
}

export const WITHIN_KIND_IDS: readonly string[] = Object.freeze(
  [...WITHIN_BY_KIND.keys()].sort(),
);

// ---------------------------------------------------------------------------
// Tool names this lane reaches (consumed by capabilities/inventory.ts)
// ---------------------------------------------------------------------------

export const SOURCE_LANE_TOOLS: readonly string[] = Object.freeze(
  [
    ...new Set([
      ...SOURCE_CATALOG.map((s) => s.toolName),
      ...FETCH_KINDS.map((f) => f.toolName),
      ...WITHIN_KINDS.map((w) => w.toolName),
    ]),
  ].sort(),
);

// ---------------------------------------------------------------------------
// Registry conformance self-check (fail fast on drift at module load)
// ---------------------------------------------------------------------------

for (const entry of [...SOURCE_CATALOG, ...FETCH_KINDS, ...WITHIN_KINDS]) {
  const actual = lookupCapability(entry.toolName);
  if (actual === undefined) {
    throw new Error(
      `source catalog names a tool outside the 54-tool registry: ${entry.toolName}`,
    );
  }
  if (actual !== entry.capability) {
    throw new Error(
      `source catalog capability drift: ${entry.toolName} is ${actual}, declared ${entry.capability}`,
    );
  }
}
