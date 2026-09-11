/**
 * The five v1 research templates (Master Build Brief 14.5) as declarative step
 * graphs over the 7-capability registry:
 *
 *  1. mevzuat + değişiklik + içtihat          (mevzuat_amendment_ictihat)
 *  2. Yargıtay/Danıştay karşıt yaklaşım       (yargitay_danistay_contrary)
 *  3. AYM norm denetimi + hedef mevzuat       (aym_norm_denetimi)
 *  4. regülatörler arası konu                 (cross_regulator)
 *  5. yüklenen dilekçe iddiaları + karşı      (uploaded_claims_counter_evidence,
 *     evidence                                 interface-only until upload lands)
 *
 * They are five DIFFERENT research strategies, not one query with five labels:
 *
 *  | template   | what it actually does differently                            |
 *  |------------|--------------------------------------------------------------|
 *  | 1 mevzuat  | statute-first: exact `mevzuat_no` lookup, reads the article   |
 *  |            | inside the law (`search_within_kanun`), resolves the current  |
 *  |            | version/amendment, then case law bounded by `as_of`.         |
 *  | 2 karşıt   | divergence-first: separate Yargıtay and Danıştay lanes, the   |
 *  |            | Uyuşmazlık Mahkemesi lane when the question has a jurisdiction|
 *  |            | angle, and contrary lanes aimed at direnme (HGK) and          |
 *  |            | içtihadı birleştirme.                                        |
 *  | 3 AYM      | constitutional: norm-denetimi search plus the TARGET statute  |
 *  |            | (hedef mevzuat), with contrary lanes for "iptal isteminin     |
 *  |            | reddi" and for inadmissible bireysel başvuru.                 |
 *  | 4 regülatör| regulator-first: one lane per hinted authority with each      |
 *  |            | authority's own parameters, plus the administrative judicial  |
 *  |            | review lane (Danıştay), which is where those decisions are    |
 *  |            | challenged.                                                   |
 *  | 5 dilekçe  | interface-only: needs the secure upload pipeline (brief 11).  |
 *
 * A template contributes the STATIC part of a plan: ordered capability calls
 * with deterministic query builders, including the MANDATORY contrary-authority
 * lanes per material issue. Dynamic stages (fetch of top hits, bounded cited-
 * reference follow-ups, the round-2 gap analysis) are derived from recorded
 * typed outcomes by rulePlanner.ts.
 *
 * TOOL ARGUMENTS: `PlannedCall.input` is handed to the capability executor and,
 * in the current wiring, straight on to the MCP gateway as the raw tool
 * arguments (see api/server.ts `gatewayCapabilityExecutor`). Every builder
 * below therefore emits the REAL parameter names of the declared tool
 * (`court_types`/`pageNumber` for Bedesten, `mevzuat_no` for search_mevzuat,
 * `decision_type`/`keywords` for search_anayasa_unified, ...). The registry
 * self-check at the bottom guards the tool/capability half of that contract.
 */

import { lookupCapability, type CapabilityName } from "../capabilities/registry.js";
import { buildContraryLanes, type ContraryFlavor, type ContraryLane } from "./contrary.js";
import { encodePlannerNote, type StepRole } from "./outcomes.js";
import type { IntakeAnalysis, IntakeIssue, RegulatorCode } from "./intake.js";

export type TemplateId =
  | "mevzuat_amendment_ictihat"
  | "yargitay_danistay_contrary"
  | "aym_norm_denetimi"
  | "cross_regulator"
  | "uploaded_claims_counter_evidence";

/** One planned capability call (declarative; executed by the executor). */
export interface PlannedCall {
  capability: CapabilityName;
  /** Raw tool inside the capability; absent for native capabilities. */
  toolName?: string;
  input: Record<string, unknown>;
  /** Planner note encoding template/issue/role/round (see outcomes.ts). */
  note: string;
}

export class TemplateNotImplementedError extends Error {
  constructor(readonly templateId: TemplateId) {
    super(`research template is interface-only in v1: ${templateId}`);
    this.name = "TemplateNotImplementedError";
  }
}

export interface ResearchTemplate {
  id: TemplateId;
  title: string;
  status: "active" | "interface-only";
  /**
   * Build the ordered static calls for this template. Throws
   * TemplateNotImplementedError for interface-only templates.
   */
  buildStaticCalls(analysis: IntakeAnalysis): PlannedCall[];
}

// ---------------------------------------------------------------------------
// Uploaded-claims interface (upload pipeline lands later; brief section 11)
// ---------------------------------------------------------------------------

export interface UploadedClaim {
  claimId: string;
  /** Verbatim claim text extracted from the uploaded dilekçe. */
  text: string;
}

export interface UploadedClaimsInput {
  matterId: string;
  claims: readonly UploadedClaim[];
}

// ---------------------------------------------------------------------------
// Query builders (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * Round-1 query for an issue.
 *
 * Provider token semantics differ. Keep the base query short; the Bedesten
 * primary-lane builder quotes compound concepts after the observed broad
 * unquoted results in the September workday audit:
 *  - a statute reference becomes the citation form decisions actually contain
 *    (`"5237 sayılı" 157`), not the human label ("5237 sayılı kanun madde 157"),
 *    which no decision text spells out;
 *  - a court-decision reference becomes its E./K. pair;
 *  - a concept becomes its canonical term alone (index 0 of the expansion
 *    table). The synonyms are held back for the round-2 gap query.
 */
export function primaryQueryForIssue(issue: IntakeIssue): string {
  if (issue.kind === "exact_reference" && issue.reference) {
    const ref = issue.reference;
    if (ref.kind === "legislation" && ref.legislationNo !== undefined) {
      return (
        `"${ref.legislationNo} sayılı"` +
        (ref.articleNo !== undefined ? ` ${ref.articleNo}` : "")
      );
    }
    if (ref.kind === "court_decision") {
      return `E. ${ref.docketNo ?? ""} K. ${ref.decisionNo ?? ""}`.trim();
    }
  }
  return issue.matchedTerm ?? issue.expandedTerms[0] ?? issue.label;
}

/**
 * Round-2 gap query: a genuinely different angle rather than a narrower one.
 *
 * W14/B-15 (ARCH): the old implementation appended a constant `"emsal karar"`
 * to every round-2 query. Bedesten ANDs the tokens it is given, so that suffix
 * made round-2 STRICTLY NARROWER than round-1 — the opposite of a gap query,
 * and the reason a round-1 miss almost never recovered. Round-2 now only ever
 * substitutes or REMOVES tokens:
 *
 *  1. a concept swaps in the next term of the expansion table (a synonym or a
 *     statutory element) — a different angle, same width;
 *  2. an exact legislation reference DROPS the article number
 *     (`"6098 sayılı" 344` -> `"6098 sayılı"`) — strictly broader;
 *  3. an exact court-decision reference drops the karar number and keeps the
 *     esas number — strictly broader;
 *  4. with none of the above (a single-term fallback issue) there is no
 *     honestly broader angle, so the primary query is returned unchanged and
 *     the planner's own idempotency key suppresses the duplicate step. The
 *     lane is skipped, not silently narrowed.
 */
export function gapQueryForIssue(issue: IntakeIssue): string {
  const alternative = issue.expandedTerms[1];
  if (alternative !== undefined) return alternative;
  if (issue.kind === "exact_reference" && issue.reference) {
    const ref = issue.reference;
    if (ref.kind === "legislation" && ref.legislationNo !== undefined) {
      return `"${ref.legislationNo} sayılı"`;
    }
    if (ref.kind === "court_decision" && ref.docketNo !== undefined) {
      return `E. ${ref.docketNo}`;
    }
  }
  return primaryQueryForIssue(issue);
}

// ---------------------------------------------------------------------------
// Raw-tool argument builders (parameter names verified against the live tools)
// ---------------------------------------------------------------------------

/** Bedesten `court_types` values (BedestenCourtTypeEnum). */
export const YARGITAY = "YARGITAYKARARI";
export const DANISTAY = "DANISTAYKARAR";
const BOTH_HIGH_COURTS: readonly string[] = Object.freeze([YARGITAY, DANISTAY]);

/** Yargıtay Hukuk Genel Kurulu — where a direnme kararı is decided. */
const HGK = "HGK";

interface BedestenOptions {
  courts?: readonly string[];
  /** BirimAdiEnum chamber filter (e.g. "HGK"). */
  birimAdi?: string;
  /** Upper bound on decision date; set from the intake `as_of` anchor. */
  asOf?: string;
  /**
   * Lower bound on decision date (`kararTarihiStart`). Absent = unbounded
   * history, which is the RIGHT answer for the contrary lanes (see
   * DEFAULT_CASE_LAW_LOOKBACK_YEARS).
   */
  since?: string;
}

/**
 * How far back a PRIMARY case-law lane looks when the run is anchored at an
 * `as_of` date (W14/B-15, ARCH).
 *
 * Before this, every Bedesten lane carried `kararTarihiEnd: asOf` and NO lower
 * bound, so a provision rewritten by an omnibus act two years ago was answered
 * with decisions applying its repealed text — the most expensive retrieval
 * defect the ARCH lane listed. Fifteen years is deliberately long: it covers
 * the 6098/6100/6102 recodification wave, so a lane can still reach the
 * decisions that interpret the current codes from their first years.
 *
 * The window is applied ONLY to primary lanes. The CONTRARY lanes (direnme,
 * içtihadı birleştirme) stay unbounded on purpose: an içtihadı birleştirme
 * kararı from the 1980s is still binding, and hiding it would turn a recall
 * improvement into a correctness defect.
 */
export const DEFAULT_CASE_LAW_LOOKBACK_YEARS = 15;

/**
 * `kararTarihiStart` for a run anchored at `asOf` (an ISO `YYYY-MM-DD` day),
 * or undefined when there is no anchor or the anchor is not a parsable day.
 * Pure string arithmetic — no Date, no timezone.
 */
export function caseLawWindowStart(
  asOf: string | undefined,
  lookbackYears: number = DEFAULT_CASE_LAW_LOOKBACK_YEARS,
): string | undefined {
  if (asOf === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(asOf);
  if (match === null) return undefined;
  const year = Number.parseInt(match[1] as string, 10) - Math.max(0, Math.floor(lookbackYears));
  if (!Number.isFinite(year) || year < 1900) return undefined;
  return `${String(year).padStart(4, "0")}-${match[2] as string}-${match[3] as string}`;
}

function bedestenInput(phrase: string, options: BedestenOptions = {}): Record<string, unknown> {
  return {
    phrase,
    court_types: [...(options.courts ?? BOTH_HIGH_COURTS)],
    pageNumber: 1,
    ...(options.birimAdi !== undefined ? { birimAdi: options.birimAdi } : {}),
    // A run anchored at `as_of` must not rely on decisions published later.
    ...(options.asOf !== undefined ? { kararTarihiEnd: options.asOf } : {}),
    ...(options.since !== undefined ? { kararTarihiStart: options.since } : {}),
  };
}

/** Raw arguments for `search_emsal_detailed_decisions` (UYAP Emsal). */
function emsalInput(keyword: string): Record<string, unknown> {
  return { keyword, page_number: 1 };
}

/**
 * Exact legislation lookup by official number (search_mevzuat `mevzuat_no`).
 * Deliberately NOT filtered by `mevzuat_tur`: a numbered reference is not
 * necessarily a kanun ("375 sayılı KHK", "703 sayılı KHK", a CB kararnamesi),
 * and the number alone is already precise.
 */
function mevzuatByNumberInput(legislationNo: string): Record<string, unknown> {
  return { mevzuat_no: legislationNo, page: 1, page_size: 5 };
}

/** Full-text legislation lookup for a concept (search_mevzuat `phrase`). */
function mevzuatByPhraseInput(phrase: string): Record<string, unknown> {
  return { phrase, mevzuat_tur: "KANUN", page: 1, page_size: 5 };
}

export type AnayasaDecisionType = "norm_denetimi" | "bireysel_basvuru";

function anayasaInput(
  keywords: readonly string[],
  decisionType: AnayasaDecisionType,
): Record<string, unknown> {
  return {
    decision_type: decisionType,
    keywords: [...keywords],
    page_to_fetch: 1,
    results_per_page: 10,
  };
}

function uyusmazlikInput(phrase: string): Record<string, unknown> {
  return { icerik: phrase, search_scope: "All", page_number: 1 };
}

// ---------------------------------------------------------------------------
// Provider/tool maps (every entry cross-checked against the registry in tests)
// ---------------------------------------------------------------------------

/**
 * How to fetch one hit of a provider in full. `idParam` is the real parameter
 * name of the tool — the id families differ per provider (Bedesten document
 * ids, AYM/KVKK/BTK document URLs, GİB özelge ids, ...), and the value always
 * comes from a prior TYPED hit (`SearchHit.externalId`), never from free text.
 */
export interface FetchDescriptor {
  toolName: string;
  idParam: string;
  /** Constant extra arguments the tool requires. */
  extraInput?: Readonly<Record<string, unknown>>;
}

const FETCH_BY_PROVIDER: Readonly<Record<string, FetchDescriptor>> = Object.freeze({
  // Canonical Bedesten fetch façade (brief 6.7).
  BEDESTEN: Object.freeze({ toolName: "fetch", idParam: "id" }),
  EMSAL: Object.freeze({ toolName: "get_emsal_document_markdown", idParam: "id" }),
  // W14/B-15: `search_uyusmazlik_decisions` was planned but had NO fetch
  // descriptor, so a Uyuşmazlık hit could never become evidence (a search
  // summary is not citable — the correct rule) and the whole court was dead
  // weight in the budget. The tool takes the decision's full URL.
  UYUSMAZLIK: Object.freeze({
    toolName: "get_uyusmazlik_document_markdown_from_url",
    idParam: "document_url",
  }),
  AYM: Object.freeze({
    toolName: "get_anayasa_document_unified",
    idParam: "document_url",
  }),
  MEVZUAT: Object.freeze({
    toolName: "get_mevzuat_content",
    idParam: "mevzuat_id",
    extraInput: Object.freeze({ page_number: 1 }),
  }),
  KIK: Object.freeze({
    toolName: "get_kik_v2_document_markdown",
    idParam: "gundemMaddesiId",
  }),
  KVKK: Object.freeze({
    toolName: "get_kvkk_document_markdown",
    idParam: "decision_url",
  }),
  REKABET: Object.freeze({
    toolName: "get_rekabet_kurumu_document",
    idParam: "karar_id",
  }),
  SAYISTAY: Object.freeze({
    toolName: "get_sayistay_document_unified",
    idParam: "decision_id",
    // Mirrors the decision_type the planner searched with (see below).
    extraInput: Object.freeze({ decision_type: "daire" }),
  }),
  BDDK: Object.freeze({
    toolName: "get_bddk_document_markdown",
    idParam: "document_id",
  }),
  BTK: Object.freeze({ toolName: "get_btk_document_markdown", idParam: "pdf_url" }),
  GIB: Object.freeze({
    toolName: "get_gib_ozelge_document_markdown",
    idParam: "ozelge_id",
  }),
  SIGORTA: Object.freeze({
    toolName: "get_sigorta_tahkim_document_markdown",
    idParam: "issue_number",
  }),
});

export function fetchDescriptorForProvider(provider: string): FetchDescriptor | undefined {
  return FETCH_BY_PROVIDER[provider];
}

/** document.fetch tool for a provider, or undefined for an unknown provider. */
export function fetchToolForProvider(provider: string): string | undefined {
  return FETCH_BY_PROVIDER[provider]?.toolName;
}

/**
 * Raw arguments to fetch `externalId` from `provider`, or undefined when the
 * provider is unknown — the planner never guesses a tool or a parameter name.
 */
export function buildFetchInput(
  provider: string,
  externalId: string,
): Record<string, unknown> | undefined {
  const descriptor = FETCH_BY_PROVIDER[provider];
  if (!descriptor) return undefined;
  return { [descriptor.idParam]: externalId, ...(descriptor.extraInput ?? {}) };
}

// ---------------------------------------------------------------------------
// Read-inside-the-instrument map (W14/B-15, gap G3)
// ---------------------------------------------------------------------------

/**
 * `search_within_*` tool per legislation KIND, the exact parallel of
 * FETCH_BY_PROVIDER for the document.searchWithin capability.
 *
 * Before this table the planner only ever called `search_within_kanun`, so a
 * yönetmelik, tebliğ, KHK, tüzük or CB kararnamesi could be FOUND by
 * `search_mevzuat` and then never read: nine of the eleven searchWithin tools
 * were unreachable from any code path.
 *
 * The keys are the Turkish type labels `search_mevzuat` prints in parentheses
 * on each result line (`- [5237] TÜRK CEZA KANUNU (Kanunlar) | mevzuatId: …`),
 * normalized by {@link normalizeLegislationKind}; the Bedesten enum names
 * (`KANUN`, `KKY`, `CB_KARARNAME`, …) are accepted too, because that is what a
 * caller who already knows the type will send.
 */
export interface WithinDescriptor {
  toolName: string;
  /** Real parameter name carrying the instrument number. */
  idParam: string;
}

const WITHIN_KANUN: WithinDescriptor = Object.freeze({
  toolName: "search_within_kanun",
  idParam: "mevzuat_no",
});

const WITHIN_BY_TYPE: Readonly<Record<string, WithinDescriptor>> = Object.freeze({
  kanun: WITHIN_KANUN,
  kanunlar: WITHIN_KANUN,
  khk: Object.freeze({ toolName: "search_within_khk", idParam: "mevzuat_no" }),
  "kanun hukmunde kararname": Object.freeze({
    toolName: "search_within_khk",
    idParam: "mevzuat_no",
  }),
  "kanun hukmunde kararnameler": Object.freeze({
    toolName: "search_within_khk",
    idParam: "mevzuat_no",
  }),
  tuzuk: Object.freeze({ toolName: "search_within_tuzuk", idParam: "mevzuat_no" }),
  tuzukler: Object.freeze({ toolName: "search_within_tuzuk", idParam: "mevzuat_no" }),
  kky: Object.freeze({ toolName: "search_within_kurum_yonetmelik", idParam: "mevzuat_no" }),
  yonetmelik: Object.freeze({
    toolName: "search_within_kurum_yonetmelik",
    idParam: "mevzuat_no",
  }),
  yonetmelikler: Object.freeze({
    toolName: "search_within_kurum_yonetmelik",
    idParam: "mevzuat_no",
  }),
  "kurum yonetmeligi": Object.freeze({
    toolName: "search_within_kurum_yonetmelik",
    idParam: "mevzuat_no",
  }),
  tebligler: Object.freeze({ toolName: "search_within_teblig", idParam: "mevzuat_no" }),
  teblig: Object.freeze({ toolName: "search_within_teblig", idParam: "mevzuat_no" }),
  cb_kararname: Object.freeze({ toolName: "search_within_cbk", idParam: "mevzuat_no" }),
  "cumhurbaskanligi kararnamesi": Object.freeze({
    toolName: "search_within_cbk",
    idParam: "mevzuat_no",
  }),
  cb_yonetmelik: Object.freeze({
    toolName: "search_within_cbyonetmelik",
    idParam: "mevzuat_no",
  }),
  "cb yonetmeligi": Object.freeze({
    toolName: "search_within_cbyonetmelik",
    idParam: "mevzuat_no",
  }),
  cb_karar: Object.freeze({
    toolName: "search_within_cbbaskankarar",
    idParam: "mevzuat_no",
  }),
  "cumhurbaskani karari": Object.freeze({
    toolName: "search_within_cbbaskankarar",
    idParam: "mevzuat_no",
  }),
  cb_genelge: Object.freeze({
    toolName: "search_within_cbgenelge",
    idParam: "mevzuat_no",
  }),
  "cb genelgesi": Object.freeze({
    toolName: "search_within_cbgenelge",
    idParam: "mevzuat_no",
  }),
});

/**
 * Fold a legislation-type label onto a WITHIN_BY_TYPE key: casefold with the
 * Turkish letters mapped onto ASCII, punctuation to spaces, runs collapsed.
 * Deterministic and locale-free (no toLocaleLowerCase — the planner must
 * behave the same on every machine).
 */
export function normalizeLegislationKind(kind: string): string {
  const folded = kind
    .replace(/[İI]/gu, "i")
    .replace(/[Iı]/gu, "i")
    .replace(/[Ğğ]/gu, "g")
    .replace(/[Üü]/gu, "u")
    .replace(/[Şş]/gu, "s")
    .replace(/[Öö]/gu, "o")
    .replace(/[Çç]/gu, "c")
    .toLowerCase();
  return folded.replace(/[^a-z0-9_]+/gu, " ").trim().replace(/\s+/gu, " ");
}

/**
 * `search_within_*` descriptor for a legislation kind. Unknown/absent kinds
 * fall back to `search_within_kanun` ONLY when the caller says so; otherwise
 * undefined, so the planner never guesses a tool.
 */
export function withinDescriptorForKind(kind: string | undefined): WithinDescriptor | undefined {
  if (kind === undefined || kind.trim() === "") return undefined;
  return WITHIN_BY_TYPE[normalizeLegislationKind(kind)];
}

/** `search_within_*` tool name for a legislation kind, or undefined. */
export function withinToolForKind(kind: string | undefined): string | undefined {
  return withinDescriptorForKind(kind)?.toolName;
}

/** Every distinct `search_within_*` tool this table can reach (sorted). */
export const WITHIN_TOOL_NAMES: readonly string[] = Object.freeze(
  [...new Set(Object.values(WITHIN_BY_TYPE).map((d) => d.toolName))].sort(),
);

/** Raw arguments for the `search_within_*` tool of `kind`, or undefined. */
export function buildWithinInput(
  kind: string | undefined,
  legislationNo: string,
  keyword: string,
  maxResults = 10,
): Record<string, unknown> | undefined {
  const descriptor = withinDescriptorForKind(kind);
  if (descriptor === undefined) return undefined;
  return { [descriptor.idParam]: legislationNo, keyword, max_results: maxResults };
}

/** Per-regulator search tool + its own free-text parameter and constants. */
interface RegulatorSearchSpec {
  toolName: string;
  queryParam: string;
  extraInput?: Readonly<Record<string, unknown>>;
}

const REGULATOR_SEARCH: Readonly<Record<RegulatorCode, RegulatorSearchSpec>> =
  Object.freeze({
    KVKK: Object.freeze({
      toolName: "search_kvkk_decisions",
      queryParam: "keywords",
      extraInput: Object.freeze({ page: 1 }),
    }),
    REKABET: Object.freeze({
      // PdfText searches the decision body; sayfaAdi only the title.
      toolName: "search_rekabet_kurumu_decisions",
      queryParam: "PdfText",
      extraInput: Object.freeze({ page: 1 }),
    }),
    KIK: Object.freeze({
      toolName: "search_kik_v2_decisions",
      queryParam: "karar_metni",
      extraInput: Object.freeze({ decision_type: "uyusmazlik" }),
    }),
    BDDK: Object.freeze({
      toolName: "search_bddk_decisions",
      queryParam: "keywords",
      extraInput: Object.freeze({ page: 1 }),
    }),
    BTK: Object.freeze({
      toolName: "search_btk_decisions",
      queryParam: "keywords",
      extraInput: Object.freeze({ page: 1 }),
    }),
    GIB: Object.freeze({
      toolName: "search_gib_ozelge",
      queryParam: "keywords",
      extraInput: Object.freeze({ page: 1 }),
    }),
    SIGORTA: Object.freeze({
      toolName: "search_sigorta_tahkim_decisions",
      queryParam: "keywords",
      extraInput: Object.freeze({ page: 1 }),
    }),
    SAYISTAY: Object.freeze({
      // web_karar_metni is the full-text field of the `daire` lane; the fetch
      // descriptor above uses the same decision_type.
      toolName: "search_sayistay_unified",
      queryParam: "web_karar_metni",
      extraInput: Object.freeze({ decision_type: "daire", start: 0, length: 10 }),
    }),
  });

/** Regulator -> search tool name (kept as a flat map for cross-checks). */
export const REGULATOR_SEARCH_TOOLS: Readonly<Record<RegulatorCode, string>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(REGULATOR_SEARCH) as RegulatorCode[]).map((code) => [
        code,
        REGULATOR_SEARCH[code].toolName,
      ]),
    ) as Record<RegulatorCode, string>,
  );

export function buildRegulatorSearchInput(
  regulator: RegulatorCode,
  phrase: string,
): Record<string, unknown> {
  const spec = REGULATOR_SEARCH[regulator];
  return { [spec.queryParam]: phrase, ...(spec.extraInput ?? {}) };
}

// ---------------------------------------------------------------------------
// Template construction helpers
// ---------------------------------------------------------------------------

function mkCall(
  template: TemplateId,
  issue: IntakeIssue,
  role: StepRole,
  capability: CapabilityName,
  toolName: string | undefined,
  input: Record<string, unknown>,
  round = 1,
): PlannedCall {
  return {
    capability,
    ...(toolName !== undefined ? { toolName } : {}),
    input,
    note: encodePlannerNote({ template, issueId: issue.issueId, role, round }),
  };
}

/** The legislation number an issue is anchored to, when it names one. */
function legislationNoOf(issue: IntakeIssue): string | undefined {
  const ref = issue.reference;
  if (!ref || ref.kind !== "legislation") return undefined;
  return ref.legislationNo;
}

/**
 * Legislation KIND written into the citation itself ("375 sayılı Kanun
 * Hükmünde Kararname", "1 sayılı Cumhurbaşkanlığı Kararnamesi"). The parser
 * keeps the instrument's name verbatim, and the name is the only type signal a
 * question carries — `search_mevzuat` hits carry the authoritative one
 * (`LiveSearchHit.legislationKind`, used by the rule planner).
 *
 * Returns a WITHIN_BY_TYPE key, or undefined when the name says nothing.
 */
export function legislationKindFromName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const folded = normalizeLegislationKind(name);
  if (folded.includes("kanun hukmunde kararname") || /(?:^| )khk(?:$| )/u.test(folded)) {
    return "khk";
  }
  if (folded.includes("cumhurbaskanligi kararnamesi")) return "cb_kararname";
  if (folded.includes("cumhurbaskani karari")) return "cb_karar";
  if (folded.includes("cb genelgesi") || folded.includes("cumhurbaskanligi genelgesi")) {
    return "cb_genelge";
  }
  if (folded.includes("cumhurbaskanligi yonetmeligi") || folded.includes("cb yonetmeligi")) {
    return "cb_yonetmelik";
  }
  if (folded.includes("yonetmelik")) return "yonetmelik";
  if (folded.includes("teblig")) return "tebligler";
  if (folded.includes("tuzuk")) return "tuzuk";
  if (folded.includes("kanun")) return "kanun";
  return undefined;
}

function caseLawSearch(
  template: TemplateId,
  issue: IntakeIssue,
  role: StepRole,
  phrase: string,
  options: BedestenOptions = {},
): PlannedCall {
  // Live samples returned unrelated decisions for unquoted compound concepts.
  // Only the primary Bedesten lane uses a literal phrase. Contrary, Emsal and
  // round-2 queries retain their independent broader search paths.
  const exactConcept = role === "primary" && issue.kind === "conceptual" &&
    phrase.trim().includes(" ") && !phrase.includes('"');
  return mkCall(
    template,
    issue,
    role,
    "caseLaw.search",
    "search_bedesten_unified",
    bedestenInput(exactConcept ? `"${phrase}"` : phrase, options),
  );
}

/**
 * UYAP Emsal lane (W14/B-15, gap G2).
 *
 * Emsal is where an İzmir solo litigator finds LOCAL first-instance and
 * istinaf (BAM) case law: Bedesten's unified lane is dominated by the two high
 * courts. `search_emsal_detailed_decisions` and its fetch tool were registered
 * but planned by NO template, so the whole layer produced nothing.
 */
function emsalSearch(
  template: TemplateId,
  issue: IntakeIssue,
  role: StepRole,
  keyword: string,
): PlannedCall {
  return mkCall(
    template,
    issue,
    role,
    "caseLaw.search",
    "search_emsal_detailed_decisions",
    emsalInput(keyword),
  );
}

/** Exact statute lookup (`mevzuat_no`) or concept lookup (`phrase`). */
function legislationLookup(
  template: TemplateId,
  issue: IntakeIssue,
): PlannedCall | undefined {
  const legislationNo = legislationNoOf(issue);
  if (legislationNo !== undefined) {
    return mkCall(
      template,
      issue,
      "legislation",
      "legislation.search",
      "search_mevzuat",
      mevzuatByNumberInput(legislationNo),
    );
  }
  if (issue.kind !== "conceptual") return undefined; // an E./K. issue has no statute
  return mkCall(
    template,
    issue,
    "legislation",
    "legislation.search",
    "search_mevzuat",
    mevzuatByPhraseInput(primaryQueryForIssue(issue)),
  );
}

/**
 * Amendment / current-version resolver (brief 6.8) — a native capability, so
 * no raw toolName; the input follows ResolveTargetInput.
 */
function amendmentResolver(
  template: TemplateId,
  analysis: IntakeAnalysis,
  issue: IntakeIssue,
): PlannedCall | undefined {
  const legislationNo = legislationNoOf(issue);
  if (legislationNo === undefined) return undefined;
  const articleNo = issue.reference?.articleNo;
  const asOf = analysis.intake.asOf;
  return mkCall(template, issue, "amendment", "legislation.resolveTarget", undefined, {
    targetLegislationNo: legislationNo,
    ...(articleNo !== undefined ? { articleNo } : {}),
    ...(asOf !== undefined ? { asOf } : {}),
  });
}

/**
 * Read the referenced article inside the instrument itself (the
 * `search_within_*` family).
 *
 * The keyword must be something that occurs in the ARTICLE TEXT: the article
 * number when the user gave one, otherwise the question's leading concept.
 * With neither, the lane is skipped — searching a law for its own citation
 * ("6098 sayılı kanun") would return nothing.
 *
 * W14/B-15: the tool is now chosen from the instrument's KIND (WITHIN_BY_TYPE)
 * instead of always being `search_within_kanun`, so a KHK, tüzük, yönetmelik,
 * tebliğ or CB kararnamesi is actually readable. A citation with no type
 * signal keeps the historical default (kanun).
 */
function statuteRead(
  template: TemplateId,
  analysis: IntakeAnalysis,
  issue: IntakeIssue,
): PlannedCall | undefined {
  const legislationNo = legislationNoOf(issue);
  if (legislationNo === undefined) return undefined;
  const articleNo = issue.reference?.articleNo;
  const concept = analysis.issues.find((i) => i.kind === "conceptual")?.expandedTerms[0];
  const keyword = articleNo !== undefined ? `madde ${articleNo}` : concept;
  if (keyword === undefined) return undefined;
  const kind = legislationKindFromName(issue.reference?.name) ?? "kanun";
  const descriptor = withinDescriptorForKind(kind);
  if (descriptor === undefined) return undefined;
  const input = buildWithinInput(kind, legislationNo, keyword);
  /* c8 ignore next */
  if (input === undefined) return undefined;
  return mkCall(
    template,
    issue,
    "statute",
    "document.searchWithin",
    descriptor.toolName,
    input,
  );
}

function contraryLanesFor(issue: IntakeIssue, flavor: ContraryFlavor): ContraryLane[] {
  return buildContraryLanes(primaryQueryForIssue(issue), flavor);
}

/**
 * Assemble the phases of a template into one ordered list. The MANDATORY
 * contrary lanes are emitted right after the round-1 primary searches and
 * before the enrichment phase, so a budget-constrained run still records a
 * contrary search for every material issue (brief 10.2/10.5).
 */
function orderPhases(phases: {
  anchor: PlannedCall[];
  primary: PlannedCall[];
  contrary: PlannedCall[];
  enrichment: PlannedCall[];
}): PlannedCall[] {
  return [...phases.anchor, ...phases.primary, ...phases.contrary, ...phases.enrichment];
}

/** Does the question raise a judicial-order (görev/yargı yolu) question? */
const JURISDICTION_MARKERS: readonly string[] = Object.freeze([
  "görev",
  "yargı yolu",
  "idari yargı",
  "adli yargı",
  "uyuşmazlık mahkemesi",
]);

function hasJurisdictionAngle(analysis: IntakeAnalysis): boolean {
  return JURISDICTION_MARKERS.some((m) => analysis.normalizedQuestion.includes(m));
}

// ---------------------------------------------------------------------------
// The five templates
// ---------------------------------------------------------------------------

const mevzuatAmendmentIctihat: ResearchTemplate = {
  id: "mevzuat_amendment_ictihat",
  title: "Mevzuat + değişiklik + içtihat",
  status: "active",
  buildStaticCalls(analysis) {
    const asOf = analysis.intake.asOf;
    const since = caseLawWindowStart(asOf);
    const anchor: PlannedCall[] = [];
    const primary: PlannedCall[] = [];
    const emsal: PlannedCall[] = [];
    const contrary: PlannedCall[] = [];
    const enrichment: PlannedCall[] = [];

    for (const issue of analysis.issues) {
      const lookup = legislationLookup(this.id, issue);
      if (lookup) anchor.push(lookup);

      primary.push(
        caseLawSearch(this.id, issue, "primary", primaryQueryForIssue(issue), {
          ...(asOf !== undefined ? { asOf } : {}),
          ...(since !== undefined ? { since } : {}),
        }),
      );
      // Local courts + istinaf, which the high-court lane above does not see.
      // ONE lane per run, on the leading issue: Emsal is a BREADTH lane, and a
      // per-issue copy would spend a quarter of the 24-call ceiling on it.
      if (emsal.length === 0) {
        emsal.push(emsalSearch(this.id, issue, "primary", primaryQueryForIssue(issue)));
      }

      for (const contraryLane of contraryLanesFor(issue, "general")) {
        contrary.push(
          caseLawSearch(this.id, issue, "contrary", contraryLane.query, {
            ...(asOf !== undefined ? { asOf } : {}),
          }),
        );
      }

      const read = statuteRead(this.id, analysis, issue);
      if (read) enrichment.push(read);
      const resolver = amendmentResolver(this.id, analysis, issue);
      if (resolver) enrichment.push(resolver);
    }

    return orderPhases({ anchor, primary: [...primary, ...emsal], contrary, enrichment });
  },
};

const yargitayDanistayContrary: ResearchTemplate = {
  id: "yargitay_danistay_contrary",
  title: "Yargıtay/Danıştay karşıt yaklaşım",
  status: "active",
  buildStaticCalls(analysis) {
    const asOf = analysis.intake.asOf;
    const since = caseLawWindowStart(asOf);
    const jurisdictionAngle = hasJurisdictionAngle(analysis);
    const anchor: PlannedCall[] = [];
    const primary: PlannedCall[] = [];
    const emsal: PlannedCall[] = [];
    const contrary: PlannedCall[] = [];
    const enrichment: PlannedCall[] = [];

    for (const issue of analysis.issues) {
      const phrase = primaryQueryForIssue(issue);
      const legislationNo = legislationNoOf(issue);
      if (legislationNo !== undefined) {
        const lookup = legislationLookup(this.id, issue);
        if (lookup) anchor.push(lookup);
      }

      // The two judicial orders are searched separately: a single combined
      // search hides the split this template exists to find.
      primary.push(
        caseLawSearch(this.id, issue, "primary", phrase, {
          courts: [YARGITAY],
          ...(asOf !== undefined ? { asOf } : {}),
          ...(since !== undefined ? { since } : {}),
        }),
        caseLawSearch(this.id, issue, "primary", phrase, {
          courts: [DANISTAY],
          ...(asOf !== undefined ? { asOf } : {}),
          ...(since !== undefined ? { since } : {}),
        }),
      );
      // The divergence this template hunts also shows up BELOW the high
      // courts: istinaf chambers split long before an içtihadı birleştirme.
      // ONE Emsal lane per run (see mevzuat_amendment_ictihat).
      if (emsal.length === 0) {
        emsal.push(emsalSearch(this.id, issue, "primary", phrase));
      }
      // The Uyuşmazlık Mahkemesi settles conflicts BETWEEN the orders — only
      // relevant when the question actually raises a jurisdiction issue.
      if (jurisdictionAngle) {
        primary.push(
          mkCall(
            this.id,
            issue,
            "primary",
            "caseLaw.search",
            "search_uyusmazlik_decisions",
            uyusmazlikInput(phrase),
          ),
        );
      }

      for (const contraryLane of contraryLanesFor(issue, "divergence")) {
        // A direnme kararı is decided by the Hukuk Genel Kurulu; an içtihadı
        // birleştirme decision may come from either order, so it stays unfiltered.
        const options: BedestenOptions =
          contraryLane.kind === "insistence"
            ? { courts: [YARGITAY], birimAdi: HGK }
            : {};
        contrary.push(
          caseLawSearch(this.id, issue, "contrary", contraryLane.query, {
            ...options,
            ...(asOf !== undefined ? { asOf } : {}),
          }),
        );
      }

      const resolver = amendmentResolver(this.id, analysis, issue);
      if (resolver) enrichment.push(resolver);
    }

    return orderPhases({ anchor, primary: [...primary, ...emsal], contrary, enrichment });
  },
};

const aymNormDenetimi: ResearchTemplate = {
  id: "aym_norm_denetimi",
  title: "AYM norm denetimi + hedef mevzuat",
  status: "active",
  buildStaticCalls(analysis) {
    const anchor: PlannedCall[] = [];
    const primary: PlannedCall[] = [];
    const contrary: PlannedCall[] = [];
    const enrichment: PlannedCall[] = [];

    for (const issue of analysis.issues) {
      const phrase = primaryQueryForIssue(issue);

      // Hedef mevzuat: the rule whose constitutionality is in question.
      const lookup = legislationLookup(this.id, issue);
      if (lookup) anchor.push(lookup);

      primary.push(
        mkCall(
          this.id,
          issue,
          "primary",
          "caseLaw.search",
          "search_anayasa_unified",
          // `decision_type` already restricts the lane to norm control; adding
          // "norm denetimi" as a keyword would only AND-narrow the full text.
          anayasaInput([phrase], "norm_denetimi"),
        ),
      );

      for (const contraryLane of contraryLanesFor(issue, "aym")) {
        contrary.push(
          mkCall(
            this.id,
            issue,
            "contrary",
            "caseLaw.search",
            "search_anayasa_unified",
            anayasaInput(
              contraryLane.terms,
              contraryLane.kind === "inadmissible" ? "bireysel_basvuru" : "norm_denetimi",
            ),
          ),
        );
      }

      const resolver = amendmentResolver(this.id, analysis, issue);
      if (resolver) enrichment.push(resolver);
      const read = statuteRead(this.id, analysis, issue);
      if (read) enrichment.push(read);
    }

    return orderPhases({ anchor, primary, contrary, enrichment });
  },
};

const crossRegulator: ResearchTemplate = {
  id: "cross_regulator",
  title: "Regülatörler arası konu",
  status: "active",
  buildStaticCalls(analysis) {
    const asOf = analysis.intake.asOf;
    const primary: PlannedCall[] = [];
    const contrary: PlannedCall[] = [];

    for (const issue of analysis.issues) {
      const phrase = primaryQueryForIssue(issue);

      for (const hint of analysis.regulatorHints) {
        primary.push(
          mkCall(
            this.id,
            issue,
            "primary",
            "regulator.search",
            REGULATOR_SEARCH_TOOLS[hint.regulator],
            buildRegulatorSearchInput(hint.regulator, phrase),
          ),
        );
      }

      // Judicial backstop: regulator decisions are annulled or upheld by the
      // ADMINISTRATIVE courts, so the review lane is Danıştay, not Yargıtay.
      primary.push(
        caseLawSearch(this.id, issue, "primary", phrase, {
          courts: [DANISTAY],
          ...(asOf !== undefined ? { asOf } : {}),
        }),
      );

      for (const contraryLane of contraryLanesFor(issue, "general")) {
        contrary.push(
          caseLawSearch(this.id, issue, "contrary", contraryLane.query, {
            courts: [DANISTAY],
            ...(asOf !== undefined ? { asOf } : {}),
          }),
        );
      }
    }

    return orderPhases({ anchor: [], primary, contrary, enrichment: [] });
  },
};

const uploadedClaimsCounterEvidence: ResearchTemplate = {
  id: "uploaded_claims_counter_evidence",
  title: "Yüklenen dilekçe iddiaları + karşı evidence",
  status: "interface-only",
  buildStaticCalls() {
    // Interface only until the secure upload pipeline (brief section 11)
    // exists: the claims come from uploaded documents, which v1 cannot ingest.
    throw new TemplateNotImplementedError("uploaded_claims_counter_evidence");
  },
};

export const RESEARCH_TEMPLATES: Readonly<Record<TemplateId, ResearchTemplate>> =
  Object.freeze({
    mevzuat_amendment_ictihat: mevzuatAmendmentIctihat,
    yargitay_danistay_contrary: yargitayDanistayContrary,
    aym_norm_denetimi: aymNormDenetimi,
    cross_regulator: crossRegulator,
    uploaded_claims_counter_evidence: uploadedClaimsCounterEvidence,
  });

// ---------------------------------------------------------------------------
// Template selection (deterministic)
// ---------------------------------------------------------------------------

/**
 * Deterministic template selection:
 *  1. explicit override wins (validated by the planner factory);
 *  2. AYM norm-denetimi markers -> aym_norm_denetimi;
 *  3. hints for >= 2 distinct regulators -> cross_regulator;
 *  4. contrary/karşıt-yaklaşım markers -> yargitay_danistay_contrary;
 *  5. a görev / yargı yolu angle -> yargitay_danistay_contrary (W14/B-15);
 *  6. default -> mevzuat_amendment_ictihat.
 *
 * Rule 5 is what finally connects the Uyuşmazlık Mahkemesi. That court settles
 * conflicts BETWEEN the two judicial orders, and its lane lives only in
 * `yargitay_danistay_contrary`. Before this rule the lane needed a contrary
 * marker AND a jurisdiction angle in the same sentence, so a plain "bu davada
 * görevli yargı yolu hangisidir?" — the exact question the court exists for —
 * never reached it.
 */
export function selectTemplate(
  analysis: IntakeAnalysis,
  override?: TemplateId,
): TemplateId {
  if (override !== undefined) return override;
  if (analysis.aymMarkers.length > 0) return "aym_norm_denetimi";
  if (analysis.regulatorHints.length >= 2) return "cross_regulator";
  if (analysis.contraryMarkers.length > 0) return "yargitay_danistay_contrary";
  if (hasJurisdictionAngle(analysis)) return "yargitay_danistay_contrary";
  return "mevzuat_amendment_ictihat";
}

// ---------------------------------------------------------------------------
// Registry conformance self-check (fail fast on drift at module load)
// ---------------------------------------------------------------------------

function assertToolBelongsTo(tool: string, capability: CapabilityName): void {
  if (lookupCapability(tool) !== capability) {
    throw new Error(`template tool/capability drift: ${tool} is not in ${capability}`);
  }
}

for (const descriptor of Object.values(FETCH_BY_PROVIDER)) {
  assertToolBelongsTo(descriptor.toolName, "document.fetch");
}
for (const tool of Object.values(REGULATOR_SEARCH_TOOLS)) {
  assertToolBelongsTo(tool, "regulator.search");
}
for (const tool of WITHIN_TOOL_NAMES) {
  assertToolBelongsTo(tool, "document.searchWithin");
}
assertToolBelongsTo("search_bedesten_unified", "caseLaw.search");
assertToolBelongsTo("search_anayasa_unified", "caseLaw.search");
assertToolBelongsTo("search_uyusmazlik_decisions", "caseLaw.search");
assertToolBelongsTo("search_emsal_detailed_decisions", "caseLaw.search");
assertToolBelongsTo("search_mevzuat", "legislation.search");
assertToolBelongsTo("search_within_kanun", "document.searchWithin");
