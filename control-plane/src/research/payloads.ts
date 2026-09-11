/**
 * Defensive typed parsing of raw MCP tool payloads (Lane F2; brief 10.2:
 * "Tool sonuçları injection riski nedeniyle typed/escaped data olarak
 * işlenir").
 *
 * The Python provider gateway returns TextContent whose text is JSON — or, for
 * several legislation tools, a formatted plain-text report. EVERYTHING in a
 * payload is UNTRUSTED DATA: this module narrows it into small typed shapes
 * (search hits with an externalId, fetched documents with a markdown body) and
 * nothing else from the payload ever influences control flow. Unknown shapes
 * degrade to "no hits + warning", never to a throw.
 *
 * Payload shapes were copied from the real tool implementations:
 *   - search_bedesten_unified -> {decisions: [...BedestenDecisionEntry],
 *     total_records, ...} (mcp_server_main.py; bedesten_mcp_module/models.py)
 *   - search (Deep Research) -> {results: [{id,title,text,url}], error_code?,
 *     failed_courts?, ...} (_deep_research_search_payload)
 *   - fetch (Deep Research)  -> {id, title, text, url, metadata}
 *   - get_bedesten_document_markdown -> {documentId, markdown_content,
 *     source_url, mime_type, ...}
 *   - search_mevzuat -> formatted text lines
 *     "- [5237] TÜRK CEZA KANUNU (Kanunlar) | mevzuatId: 345097 | RG: ..."
 *   - get_mevzuat_content -> "Mevzuat <id> | page 1/3 | page_size 12000\n\n<text>"
 *   - the remaining searches -> JSON objects scanned generically for an array
 *     of rows carrying a known id field.
 */

import type { FailureKind, ProviderCode } from "../capabilities/types.js";
import { fetchDescriptorForProvider } from "../planner/templates.js";

/** One normalized live search row. Compatible with planner/outcomes extractHits. */
export interface LiveSearchHit {
  hitId: string;
  /** Provider family; not always a ProviderCode (e.g. "UYUSMAZLIK"). */
  provider: string;
  toolName: string;
  externalId: string;
  title: string;
  /** NEVER evidence — display/trace only (brief 10.2: snippets are not citable). */
  snippet?: string;
  sourceUrl?: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  /**
   * Additive (W14/B-15): legislation TYPE as `search_mevzuat` prints it on the
   * result line — `- [5237] TÜRK CEZA KANUNU (Kanunlar) | mevzuatId: …`. It is
   * what picks the right `search_within_*` tool
   * (planner/templates.ts WITHIN_BY_TYPE); without it the planner could only
   * ever read a kanun, and yönetmelik/tebliğ/KHK/CBK hits were dead ends.
   */
  legislationKind?: string;
  /**
   * Additive (W14/B-15): the official instrument NUMBER of a legislation row
   * (`- [5237] …`). `externalId` is the mevzuatId, but every `search_within_*`
   * tool except `search_within_mevzuat` takes the NUMBER, so the planner
   * needs it as a typed field rather than re-parsing the title.
   */
  legislationNo?: string;
}

export interface ParsedFailure {
  kind: FailureKind;
  retryable: boolean;
  safeMessage: string;
}

export type SearchParse =
  | {
      kind: "hits";
      hits: LiveSearchHit[];
      warnings: string[];
      degraded?: ParsedFailure;
      /**
       * Additive (W14 M-SRV IR-2): how many records the UPSTREAM says it holds
       * for this query, when it says so at all. Bedesten returns
       * `total_records` next to its `decisions` page; most other providers
       * return nothing comparable, and for those this field is ABSENT — which
       * the API boundary turns into `null`, never into 0.
       *
       * "0 rows returned" and "the source holds no such record" are different
       * facts, and "we could not find out" is a third. Reporting an unknown
       * count as 0 would tell the lawyer the archive is empty when all we know
       * is that the provider does not publish a count.
       */
      totalRecords?: number;
    }
  | { kind: "failure"; failure: ParsedFailure };

export type FetchParse =
  | {
      kind: "doc";
      doc: { externalId: string; title: string; sourceUrl: string; text: string };
    }
  | { kind: "failure"; failure: ParsedFailure };

// ---------------------------------------------------------------------------
// Provider attribution
// ---------------------------------------------------------------------------

const PROVIDER_CODES: readonly ProviderCode[] = Object.freeze([
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

/** document.fetch tool -> {provider, idParam}, derived from the planner tables. */
export const FETCH_TOOL_INFO: Readonly<
  Record<string, { provider: ProviderCode; idParam: string }>
> = Object.freeze(
  Object.fromEntries(
    PROVIDER_CODES.flatMap((provider) => {
      const descriptor = fetchDescriptorForProvider(provider);
      return descriptor === undefined
        ? []
        : [[descriptor.toolName, { provider, idParam: descriptor.idParam }]];
    }),
  ),
);

const LEGISLATION_SEARCH_TOOLS = [
  "search_mevzuat",
  "search_kanun",
  "search_khk",
  "search_cbk",
  "search_cbyonetmelik",
  "search_cbbaskankarar",
  "search_cbgenelge",
  "search_kurum_yonetmelik",
  "search_teblig",
  "search_tuzuk",
] as const;

/** Search tool -> provider family used for per-row attribution. */
export const SEARCH_TOOL_PROVIDER: Readonly<Record<string, string>> = Object.freeze({
  search: "BEDESTEN",
  search_bedesten_unified: "BEDESTEN",
  search_emsal_detailed_decisions: "EMSAL",
  search_anayasa_unified: "AYM",
  // W14/B-15: Uyuşmazlık now HAS a fetch descriptor
  // (get_uyusmazlik_document_markdown_from_url, idParam document_url), so a
  // hit here can be pulled in full and become hash-sealed evidence.
  search_uyusmazlik_decisions: "UYUSMAZLIK",
  ...Object.fromEntries(LEGISLATION_SEARCH_TOOLS.map((t) => [t, "MEVZUAT"])),
  search_kvkk_decisions: "KVKK",
  search_rekabet_kurumu_decisions: "REKABET",
  search_kik_v2_decisions: "KIK",
  search_bddk_decisions: "BDDK",
  search_btk_decisions: "BTK",
  search_gib_ozelge: "GIB",
  search_sigorta_tahkim_decisions: "SIGORTA",
  search_sayistay_unified: "SAYISTAY",
});

/**
 * Envelope attribution (Outcome.provider is typed ProviderCode). Best-effort,
 * mirroring HttpMcpGateway's own caveat; per-row `provider` carries the truth.
 */
export function envelopeProviderForTool(toolName: string): ProviderCode {
  const fetchInfo = FETCH_TOOL_INFO[toolName];
  if (fetchInfo !== undefined) return fetchInfo.provider;
  const provider = SEARCH_TOOL_PROVIDER[toolName];
  if (provider !== undefined && (PROVIDER_CODES as readonly string[]).includes(provider)) {
    return provider as ProviderCode;
  }
  return "BEDESTEN";
}

// ---------------------------------------------------------------------------
// Small safe readers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const FAILURE_KINDS: ReadonlySet<string> = new Set([
  "RATE_LIMITED",
  "TIMEOUT",
  "UNAVAILABLE",
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "PARSER_ERROR",
  "NOT_FOUND",
]);

/** Map a provider `error_code` string onto the typed FailureKind taxonomy. */
export function failureKindOf(errorCode: string | undefined): FailureKind {
  if (errorCode !== undefined) {
    const upper = errorCode.toUpperCase();
    if (FAILURE_KINDS.has(upper)) return upper as FailureKind;
    if (upper.includes("RATE")) return "RATE_LIMITED";
    if (upper.includes("TIMEOUT")) return "TIMEOUT";
  }
  return "UNAVAILABLE";
}

function failureFromRecord(rec: Record<string, unknown>): ParsedFailure | undefined {
  const errorCode = asString(rec["error_code"]);
  const error = asString(rec["error"]);
  if (errorCode === undefined && error === undefined) return undefined;
  const kind = failureKindOf(errorCode ?? error);
  return {
    kind,
    retryable: rec["retryable"] === true || kind === "RATE_LIMITED" || kind === "TIMEOUT" || kind === "UNAVAILABLE",
    // Machine token only — provider prose is untrusted and is never echoed.
    safeMessage: `provider reported failure (${errorCode ?? error ?? "unknown"})`,
  };
}

/**
 * The upstream's own record count for a query, when the payload carries one
 * (W14 M-SRV IR-2).
 *
 * Bedesten answers `{"decisions": [...20 rows...], "total_records": 116090}`;
 * `total_records` is the size of the RESULT SET upstream, not the size of the
 * page. Several providers send the same idea under another name, so the known
 * spellings are read in order and the FIRST usable one wins.
 *
 * Rules that keep this honest:
 *  - a missing / non-numeric / negative / non-integer value is `undefined`
 *    ("the provider did not tell us"), never 0;
 *  - a genuine `0` from the provider IS kept — "the archive holds none" is a
 *    real answer and must not be laundered into "unknown";
 *  - a string of digits is accepted because some providers JSON-encode counts
 *    as text, but nothing else is coerced.
 */
const TOTAL_RECORD_FIELDS = [
  "total_records",
  "totalRecords",
  "total_count",
  "totalCount",
  "total",
  "recordsTotal",
] as const;

export function readTotalRecords(rec: Record<string, unknown>): number | undefined {
  for (const field of TOTAL_RECORD_FIELDS) {
    const raw = rec[field];
    let value: number | undefined;
    if (typeof raw === "number") value = raw;
    else if (typeof raw === "string" && /^[0-9]{1,15}$/u.test(raw.trim())) {
      value = Number(raw.trim());
    }
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) continue;
    return value;
  }
  return undefined;
}

/** Validate a calendar day without allowing Date's impossible-day rollover. */
function isoDay(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return undefined;
  const date = new Date(day + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : undefined;
}

const bedestenCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Prefer the provider's explicit legal day; timestamps use Turkey's calendar,
 * including historical UTC+2 winters, never the server's local timezone. */
function bedestenDecisionDay(row: Record<string, unknown>): string | undefined {
  const display = asString(row["kararTarihiStr"]);
  const match = display === undefined ? null : /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(display);
  const stated = match ? isoDay(`${match[3]}-${match[2]}-${match[1]}`) : undefined;
  if (stated !== undefined) return stated;
  const timestamp = asString(row["kararTarihi"]);
  const day = isoDay(timestamp);
  if (day === undefined || timestamp === undefined) return undefined;
  if (timestamp.length === 10) return day;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(timestamp)) return undefined;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = bedestenCalendar.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// ---------------------------------------------------------------------------
// Search payload parsers
// ---------------------------------------------------------------------------

const BEDESTEN_COURT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  YARGITAYKARARI: "Yargıtay",
  DANISTAYKARAR: "Danıştay",
  YERELHUKUK: "Yerel Hukuk Mahkemesi",
  ISTINAFHUKUK: "İstinaf Hukuk Mahkemesi",
  KYB: "Kanun Yararına Bozma",
});

function parseBedestenUnified(data: unknown): SearchParse {
  const rec = asRecord(data);
  if (rec === undefined) {
    return { kind: "failure", failure: parserFailure() };
  }
  const failure = failureFromRecord(rec);
  const decisions = Array.isArray(rec["decisions"]) ? (rec["decisions"] as unknown[]) : [];
  const hits: LiveSearchHit[] = [];
  for (const item of decisions) {
    const row = asRecord(item);
    if (row === undefined) continue;
    const documentId = asString(row["documentId"]);
    if (documentId === undefined) continue;
    const itemType = asRecord(row["itemType"]);
    const itemTypeName = asString(itemType?.["name"]);
    const courtFamily =
      (itemTypeName !== undefined ? BEDESTEN_COURT_NAMES[itemTypeName] : undefined) ??
      asString(itemType?.["description"]);
    const birimAdi = asString(row["birimAdi"]);
    const court = [courtFamily, birimAdi !== "ALL" ? birimAdi : undefined]
      .filter((v): v is string => v !== undefined)
      .join(" ");
    const esasNo = asString(row["esasNo"]);
    const kararNo = asString(row["kararNo"]);
    const decisionDate = bedestenDecisionDay(row);
    hits.push({
      hitId: `bedesten-${documentId}`,
      provider: "BEDESTEN",
      toolName: "search_bedesten_unified",
      externalId: documentId,
      title:
        [court !== "" ? court : "Bedesten kararı", esasNo !== undefined ? `E. ${esasNo}` : undefined, kararNo !== undefined ? `K. ${kararNo}` : undefined]
          .filter((v): v is string => v !== undefined)
          .join(" ") || `Bedesten kararı ${documentId}`,
      sourceUrl: `https://mevzuat.adalet.gov.tr/ictihat/${documentId}`,
      ...(court !== "" ? { court } : {}),
      ...(decisionDate !== undefined ? { decisionDate } : {}),
      ...(esasNo !== undefined ? { docketNo: esasNo } : {}),
      ...(kararNo !== undefined ? { decisionNo: kararNo } : {}),
    });
  }
  if (failure !== undefined && hits.length === 0) return { kind: "failure", failure };
  const totalRecords = readTotalRecords(rec);
  return {
    kind: "hits",
    hits,
    warnings: [],
    ...(failure !== undefined ? { degraded: failure } : {}),
    ...(totalRecords !== undefined ? { totalRecords } : {}),
  };
}

function parseDeepResearchSearch(data: unknown): SearchParse {
  const rec = asRecord(data);
  if (rec === undefined) return { kind: "failure", failure: parserFailure() };
  const failure = failureFromRecord(rec);
  const results = Array.isArray(rec["results"]) ? (rec["results"] as unknown[]) : [];
  const hits: LiveSearchHit[] = [];
  for (const item of results) {
    const row = asRecord(item);
    if (row === undefined) continue;
    const id = asString(row["id"]);
    if (id === undefined) continue;
    const snippet = asString(row["text"]);
    const url = asString(row["url"]);
    hits.push({
      hitId: `deep-${id}`,
      provider: "BEDESTEN",
      toolName: "search",
      externalId: id,
      title: asString(row["title"]) ?? `Bedesten kararı ${id}`,
      ...(snippet !== undefined ? { snippet } : {}),
      ...(url !== undefined ? { sourceUrl: url } : {}),
    });
  }
  if (failure !== undefined && hits.length === 0) return { kind: "failure", failure };
  const totalRecords = readTotalRecords(rec);
  return {
    kind: "hits",
    hits,
    warnings: [],
    ...(failure !== undefined ? { degraded: failure } : {}),
    ...(totalRecords !== undefined ? { totalRecords } : {}),
  };
}

/**
 * One `search_mevzuat` result line. The optional trailing "(Kanunlar)" group
 * is the legislation TYPE the tool prints
 * (`line += f" ({tur_name})"` in mevzuat_mcp_server.py); it is captured
 * separately and stripped from the title so the planner can choose the right
 * `search_within_*` lane (W14/B-15).
 */
const MEVZUAT_LINE_RE =
  /^-\s*\[(?<no>[^\]]*)\]\s*(?<title>[^|]*?)(?:\s*\((?<kind>[^()|]*)\))?\s*\|\s*mevzuatId:\s*(?<id>\S+)/u;

const TEXT_FAILURE_RE = /^(?:search error|error|an unexpected error|invalid\s)/iu;

function parseMevzuatSearchText(data: unknown): SearchParse {
  if (typeof data !== "string") return { kind: "failure", failure: parserFailure() };
  const text = data.trim();
  if (TEXT_FAILURE_RE.test(text)) {
    return {
      kind: "failure",
      failure: {
        kind: text.toLowerCase().includes("rate limit") ? "RATE_LIMITED" : "UNAVAILABLE",
        retryable: true,
        safeMessage: "legislation search reported an error",
      },
    };
  }
  const hits: LiveSearchHit[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(MEVZUAT_LINE_RE);
    const groups = match?.groups;
    if (!groups) continue;
    const id = groups["id"];
    if (id === undefined || id === "") continue;
    const no = (groups["no"] ?? "").trim();
    const title = (groups["title"] ?? "").trim();
    const kind = (groups["kind"] ?? "").trim();
    hits.push({
      hitId: `mevzuat-${id}`,
      provider: "MEVZUAT",
      toolName: "search_mevzuat",
      externalId: id,
      title: title !== "" ? (no !== "" ? `${no} sayılı ${title}` : title) : `Mevzuat ${id}`,
      ...(kind !== "" ? { legislationKind: kind } : {}),
      ...(/^[0-9]{1,12}$/u.test(no) ? { legislationNo: no } : {}),
    });
  }
  return { kind: "hits", hits, warnings: [] };
}

/** Generic id-field priority per JSON search tool (matches each fetch idParam). */
const GENERIC_ID_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  search_anayasa_unified: ["document_url", "documentUrl", "url_path", "url", "id"],
  search_uyusmazlik_decisions: ["document_url", "documentUrl", "pdf_url", "url", "id"],
  search_emsal_detailed_decisions: ["id", "documentId"],
  search_kik_v2_decisions: ["gundemMaddesiId", "id"],
  search_kvkk_decisions: ["decision_url", "url", "id"],
  search_rekabet_kurumu_decisions: ["karar_id", "id"],
  search_sayistay_unified: ["decision_id", "id"],
  search_bddk_decisions: ["document_id", "documentId", "id"],
  search_btk_decisions: ["pdf_url", "url", "id"],
  search_gib_ozelge: ["ozelge_id", "id"],
  search_sigorta_tahkim_decisions: ["issue_number", "id"],
});

const GENERIC_ARRAY_KEYS = [
  "decisions",
  "results",
  "items",
  "documents",
  "kararlar",
] as const;

const GENERIC_TITLE_FIELDS = [
  "title",
  "baslik",
  "mevzuat_adi",
  "karar_no",
  "kararNo",
  "name",
  "subject",
] as const;

function firstStringField(
  row: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = asString(row[field]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseGenericSearch(toolName: string, data: unknown): SearchParse {
  let payload: unknown = data;
  // Several tools return their JSON as a string (json.dumps of a model).
  if (typeof payload === "string") {
    const text = payload.trim();
    if (TEXT_FAILURE_RE.test(text)) {
      return {
        kind: "failure",
        failure: { kind: "UNAVAILABLE", retryable: true, safeMessage: "search reported an error" },
      };
    }
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      // Formatted plain text with no known row grammar: no structured hits.
      return { kind: "hits", hits: [], warnings: [`UNPARSED_TEXT_PAYLOAD:${toolName}`] };
    }
  }

  const rec = asRecord(payload);
  let rows: unknown[] = [];
  let failure: ParsedFailure | undefined;
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (rec !== undefined) {
    failure = failureFromRecord(rec);
    for (const key of GENERIC_ARRAY_KEYS) {
      if (Array.isArray(rec[key])) {
        rows = rec[key] as unknown[];
        break;
      }
    }
  } else {
    return { kind: "failure", failure: parserFailure() };
  }

  const idFields = GENERIC_ID_FIELDS[toolName] ?? ["id", "documentId", "url"];
  const provider = SEARCH_TOOL_PROVIDER[toolName] ?? "BEDESTEN";
  const hits: LiveSearchHit[] = [];
  for (const item of rows) {
    const row = asRecord(item);
    if (row === undefined) continue;
    const externalId = firstStringField(row, idFields);
    if (externalId === undefined) continue;
    hits.push({
      hitId: `${provider.toLowerCase()}-${hits.length}-${externalId.slice(0, 40)}`,
      provider,
      toolName,
      externalId,
      title: firstStringField(row, GENERIC_TITLE_FIELDS) ?? externalId,
    });
  }
  if (failure !== undefined && hits.length === 0) return { kind: "failure", failure };
  // Only an OBJECT payload can carry a count; a bare JSON array says nothing
  // about how many records the source holds, so it stays unknown.
  const totalRecords = rec !== undefined ? readTotalRecords(rec) : undefined;
  return {
    kind: "hits",
    hits,
    warnings: [],
    ...(failure !== undefined ? { degraded: failure } : {}),
    ...(totalRecords !== undefined ? { totalRecords } : {}),
  };
}

function parserFailure(): ParsedFailure {
  return {
    kind: "PARSER_ERROR",
    retryable: false,
    safeMessage: "tool payload had an unexpected shape",
  };
}

/**
 * FastMCP wraps every NON-OBJECT tool result as `{"result": <value>}` in
 * `structuredContent` (fastmcp/tools/tool.py: `{"result": result} if
 * wrap_result`), and HttpMcpGateway prefers structuredContent. So the
 * string-returning tools (search_mevzuat, get_mevzuat_content,
 * search_anayasa_unified, ...) arrive over the wire as that one-key envelope.
 * Unwrap it before shape-specific parsing.
 */
export function unwrapFastMcpResult(data: unknown): unknown {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 1 && keys[0] === "result") return rec["result"];
  }
  return data;
}

/** Parse one search-capability tool payload into typed hits (never throws). */
export function parseSearchPayload(toolName: string, rawData: unknown): SearchParse {
  const data = unwrapFastMcpResult(rawData);
  try {
    if (toolName === "search_bedesten_unified") return parseBedestenUnified(data);
    if (toolName === "search") return parseDeepResearchSearch(data);
    if ((LEGISLATION_SEARCH_TOOLS as readonly string[]).includes(toolName)) {
      return parseMevzuatSearchText(data);
    }
    return parseGenericSearch(toolName, data);
  } catch {
    return { kind: "failure", failure: parserFailure() };
  }
}

// ---------------------------------------------------------------------------
// Fetch payload parsers
// ---------------------------------------------------------------------------

const MEVZUAT_CONTENT_HEADER_RE = /^Mevzuat\s+\S+\s*\|\s*page\s+\d+\/\d+\s*\|\s*page_size\s+\d+\s*\n+/u;

function fetchFailure(kind: FailureKind, message: string): FetchParse {
  return {
    kind: "failure",
    failure: { kind, retryable: kind !== "INVALID_REQUEST", safeMessage: message },
  };
}

/**
 * Parse one document.fetch tool payload into a typed document (never throws).
 * `input` supplies the externalId (the id the PLANNER sent, read from a prior
 * typed hit) — the payload cannot rename the document it claims to be.
 */
export function parseFetchPayload(
  toolName: string,
  input: Record<string, unknown>,
  rawData: unknown,
): FetchParse {
  const data = unwrapFastMcpResult(rawData);
  try {
    const info = FETCH_TOOL_INFO[toolName];
    const requestedId = info !== undefined ? asString(input[info.idParam]) : undefined;

    if (toolName === "fetch") {
      const rec = asRecord(data);
      if (rec === undefined) return fetchFailure("PARSER_ERROR", "fetch payload not an object");
      const metadata = asRecord(rec["metadata"]);
      const text = asString(rec["text"]);
      const errorCode = asString(metadata?.["error_code"]);
      if (errorCode !== undefined) {
        return fetchFailure(failureKindOf(errorCode), `document fetch failed (${errorCode})`);
      }
      if (text === undefined) return fetchFailure("UNAVAILABLE", "document fetch returned no text");
      const id = requestedId ?? asString(rec["id"]) ?? "";
      return {
        kind: "doc",
        doc: {
          externalId: id,
          title: asString(rec["title"]) ?? `Belge ${id}`,
          sourceUrl: asString(rec["url"]) ?? `https://mevzuat.adalet.gov.tr/ictihat/${id}`,
          text,
        },
      };
    }

    if (toolName === "get_bedesten_document_markdown") {
      const rec = asRecord(data);
      if (rec === undefined) return fetchFailure("PARSER_ERROR", "document payload not an object");
      const text = asString(rec["markdown_content"]);
      if (text === undefined || text.startsWith("ERROR (")) {
        return fetchFailure("UNAVAILABLE", "document fetch reported an upstream error");
      }
      const id = requestedId ?? asString(rec["documentId"]) ?? "";
      return {
        kind: "doc",
        doc: {
          externalId: id,
          title: `Bedesten belgesi ${id}`,
          sourceUrl: asString(rec["source_url"]) ?? `https://mevzuat.adalet.gov.tr/ictihat/${id}`,
          text,
        },
      };
    }

    // String-bodied tools (get_mevzuat_content, get_anayasa_document_unified, ...).
    if (typeof data === "string") {
      const raw = data.trim();
      if (raw.length === 0) return fetchFailure("UNAVAILABLE", "document fetch returned empty text");
      if (TEXT_FAILURE_RE.test(raw)) {
        return fetchFailure("UNAVAILABLE", "document fetch reported an error");
      }
      const text = raw.replace(MEVZUAT_CONTENT_HEADER_RE, "");
      return {
        kind: "doc",
        doc: {
          externalId: requestedId ?? "",
          title:
            info?.provider === "MEVZUAT" && requestedId !== undefined
              ? `Mevzuat ${requestedId}`
              : `Belge ${requestedId ?? ""}`.trim(),
          sourceUrl: "",
          text,
        },
      };
    }

    // Generic JSON document shapes.
    const rec = asRecord(data);
    if (rec !== undefined) {
      const failure = failureFromRecord(rec);
      const text =
        asString(rec["markdown_content"]) ?? asString(rec["text"]) ?? asString(rec["content"]);
      if (text === undefined) {
        return failure !== undefined
          ? { kind: "failure", failure }
          : fetchFailure("PARSER_ERROR", "document payload carried no text field");
      }
      const id = requestedId ?? asString(rec["documentId"]) ?? asString(rec["id"]) ?? "";
      return {
        kind: "doc",
        doc: {
          externalId: id,
          title: asString(rec["title"]) ?? `Belge ${id}`,
          sourceUrl: asString(rec["source_url"]) ?? asString(rec["url"]) ?? "",
          text,
        },
      };
    }
    return fetchFailure("PARSER_ERROR", "document payload had an unexpected shape");
  } catch {
    return fetchFailure("PARSER_ERROR", "document payload could not be parsed");
  }
}
