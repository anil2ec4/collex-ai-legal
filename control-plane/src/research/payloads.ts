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
import { classifyFailureCode, classifyFailureText } from "../gateway/failureText.js";
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
      doc: {
        externalId: string;
        title: string;
        sourceUrl: string;
        text: string;
        /**
         * Present when the tool returned ONE page of a longer text
         * (`markdown_chunk` / `markdown_content` with `total_pages` > 1):
         * the text above is then a 5 000-character slice, never the
         * document, and {@link assemblePagedDocument} must fetch the rest
         * before anything is sealed.
         */
        pagination?: { page: number; totalPages: number };
      };
    }
  | { kind: "failure"; failure: ParsedFailure };

/**
 * The most pages one document fetch may assemble (5 000 characters each, so
 * ~300 000 characters). A longer text is refused with DOCUMENT_TOO_LARGE —
 * sealing the first N pages as "the document" would be a partial text
 * presented as whole.
 */
export const MAX_DOCUMENT_PAGES = 60;

/** safeMessage prefix of the PARSER_ERROR a too-long paged document yields. */
export const DOCUMENT_TOO_LARGE_PREFIX = "DOCUMENT_TOO_LARGE:";

/**
 * Assemble a paginated document from its first page and the remaining ones.
 *
 * 27.09.2026: KVKK, BTK, GİB, Rekabet and AYM return `markdown_chunk`, which
 * the parser did not read at all (every fetch failed as PARSER_ERROR even
 * with the network up); BDDK and Sigorta Tahkim return page 1 as
 * `markdown_content`, which was sealed as if it were the whole decision.
 * The tools slice ONE markdown string into consecutive pages, so the pages
 * joined in order are that string. Any page that fails fails the fetch.
 */
export async function assemblePagedDocument(
  first: FetchParse,
  fetchPage: (page: number) => Promise<FetchParse>,
): Promise<FetchParse> {
  if (first.kind !== "doc") return first;
  const pagination = first.doc.pagination;
  if (pagination === undefined || pagination.totalPages <= 1) return first;
  if (pagination.page !== 1) {
    return {
      kind: "failure",
      failure: { kind: "PARSER_ERROR", retryable: false, safeMessage: "paged document did not start at page 1" },
    };
  }
  if (pagination.totalPages > MAX_DOCUMENT_PAGES) {
    return {
      kind: "failure",
      // FailureKind is a closed taxonomy mirrored in Python; the specific
      // reason travels in the message prefix (see DOCUMENT_TOO_LARGE_PREFIX).
      failure: {
        kind: "PARSER_ERROR",
        retryable: false,
        safeMessage: `${DOCUMENT_TOO_LARGE_PREFIX} document has ${pagination.totalPages} pages (limit ${MAX_DOCUMENT_PAGES})`,
      },
    };
  }
  const parts = [first.doc.text];
  for (let page = 2; page <= pagination.totalPages; page += 1) {
    const next = await fetchPage(page);
    if (next.kind === "failure") return next;
    if (next.doc.pagination?.page !== page || next.doc.pagination.totalPages !== pagination.totalPages) {
      return {
        kind: "failure",
        failure: { kind: "PARSER_ERROR", retryable: false, safeMessage: `page ${page} came back out of order` },
      };
    }
    parts.push(next.doc.text);
  }
  const { pagination: _whole, ...doc } = first.doc;
  return { kind: "doc", doc: { ...doc, text: parts.join("") } };
}

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

/**
 * Map a provider `error_code` string onto the typed FailureKind taxonomy.
 *
 * An exact kind wins; otherwise the code's own wording, then any free text
 * passed after it, is classified (gateway/failureText.ts). An error code no
 * rule recognises is UNAVAILABLE — never INVALID_REQUEST, which would tell
 * the lawyer to rephrase a query the source never answered.
 */
export function failureKindOf(
  errorCode: string | undefined,
  ...texts: ReadonlyArray<string | undefined>
): FailureKind {
  return classifyFailureCode(errorCode, ...texts).kind;
}

/**
 * Error codes a provider uses to say "no error". KİK answers every SUCCESSFUL
 * search with `error_code: "0"` and `error_message: ""`; read as a code, "0"
 * classified as the unknown UNAVAILABLE, so an honestly empty KİK search was
 * drawn as a dead archive and a KİK result with rows was marked degraded.
 */
const NO_ERROR_CODES: ReadonlySet<string> = new Set(["0"]);

function failureFromRecord(rec: Record<string, unknown>): ParsedFailure | undefined {
  const errorCode = asString(rec["error_code"]);
  const error = asString(rec["error"]);
  if (errorCode === undefined && error === undefined) return undefined;
  const message = asString(rec["message"]);
  const errorMessage = asString(rec["error_message"]);
  if (
    error === undefined &&
    message === undefined &&
    (errorMessage === undefined || errorMessage.trim() === "") &&
    errorCode !== undefined &&
    NO_ERROR_CODES.has(errorCode.trim())
  ) {
    return undefined;
  }
  // `message` carries the shared "<KIND> retry_after=N.N: …" marker on every
  // Python facade; `error` is a code on some (service_unavailable) and a
  // sentence on others ("KVKK module disabled: set BRAVE_API_TOKEN …").
  const kind = failureKindOf(errorCode, message, error, errorMessage);
  return {
    kind,
    // The gateway's typed fields carry an explicit `retryable` (false for the
    // unknown answer, "UNAVAILABLE retry_after=0.0"); only a payload without
    // one falls back to the kind's default.
    retryable:
      typeof rec["retryable"] === "boolean"
        ? rec["retryable"]
        : kind === "RATE_LIMITED" || kind === "TIMEOUT" || kind === "UNAVAILABLE",
    // Machine token only — provider prose is untrusted and is never echoed.
    safeMessage: `provider reported failure (${errorCode ?? kind})`,
  };
}

/**
 * A payload that carries NO result and only an `error_message` — the shape
 * the document tools (BTK/GİB/KVKK/Rekabet/KİK) and the typed legislation
 * lookups answer an upstream failure with. Consulted only when the payload
 * produced no rows/text, so an informational message next to real content
 * never turns a result into a failure.
 */
function failureFromErrorMessage(rec: Record<string, unknown>): ParsedFailure | undefined {
  const message = asString(rec["error_message"]);
  if (message === undefined || message.trim() === "") return undefined;
  const classified = classifyFailureText(message);
  return {
    kind: classified.kind,
    retryable: classified.retryable || classified.kind === "UNAVAILABLE",
    safeMessage: `provider reported failure (${classified.kind})`,
  };
}

/** A failure the provider reported as plain TEXT ("Search error: …"). */
function textFailure(text: string, safeMessage: string): ParsedFailure {
  const classified = classifyFailureText(text);
  return {
    kind: classified.kind,
    retryable: classified.retryable || classified.kind === "UNAVAILABLE",
    safeMessage,
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

/**
 * A plain-text tool result that is really a failure: the legacy English
 * prefixes, plus the shared typed marker ("UNAVAILABLE retry_after=30.0: …")
 * a text body may carry when an older gateway returns it as a result instead
 * of raising it.
 */
const TEXT_FAILURE_RE =
  /^(?:search error|error|an unexpected error|invalid\s|(?:RATE_LIMITED|TIMEOUT|UNAVAILABLE|INVALID_REQUEST|UNAUTHORIZED|PARSER_ERROR|NOT_FOUND) retry_after=)/iu;

/**
 * The legislation TYPE each typed search tool is scoped to, spelled so that
 * `planner/templates.ts normalizeLegislationKind` lands on a WITHIN_BY_TYPE
 * key (the row must still pick the right `search_within_*` lane).
 */
const TYPED_LEGISLATION_KIND: Readonly<Record<string, string>> = Object.freeze({
  search_kanun: "Kanun",
  search_khk: "KHK",
  search_tuzuk: "Tüzük",
  search_kurum_yonetmelik: "Kurum Yönetmeliği",
  search_teblig: "Tebliğ",
  search_cbk: "Cumhurbaşkanlığı Kararnamesi",
  search_cbyonetmelik: "CB Yönetmeliği",
  search_cbbaskankarar: "Cumhurbaşkanı Kararı",
  search_cbgenelge: "CB Genelgesi",
});

/**
 * The ONE sentence the nine typed legislation tools write into
 * `error_message` for a search that ran and matched nothing
 * (mevzuat_mcp_server.py: `result.error_message = "No legislation found
 * matching the specified criteria."`). Every other `error_message` next to
 * an empty `documents` list is a failure.
 */
const TYPED_LEGISLATION_EMPTY_MESSAGE = "No legislation found matching the specified criteria.";

/**
 * The nine typed legislation searches (`search_kanun`, `search_khk`, …)
 * return a `MevzuatSearchResultNew` OBJECT, not `search_mevzuat`'s text.
 *
 * MEASURED DEFECT, 27.09.2026: this module handed that object to the text
 * parser, which answered PARSER_ERROR for ANY non-string — so every one of
 * the nine sources failed in ~10 ms whether the upstream was up or down, and
 * an outage was reported as "kaynak beklenmedik biçimde yanıt verdi" instead
 * of "ulaşılamadı".
 */
function parseTypedLegislationSearch(toolName: string, rec: Record<string, unknown>): SearchParse {
  const documents = Array.isArray(rec["documents"]) ? (rec["documents"] as unknown[]) : [];
  const legislationKind = TYPED_LEGISLATION_KIND[toolName];
  const hits: LiveSearchHit[] = [];
  for (const item of documents) {
    const row = asRecord(item);
    if (row === undefined) continue;
    // The fetch step (get_mevzuat_content) needs the Bedesten mevzuatId; a row
    // without one is dropped, never backfilled from its number.
    const id =
      asString(row["mevzuat_id"]) ??
      (typeof row["mevzuat_id"] === "number" ? String(row["mevzuat_id"]) : undefined);
    if (id === undefined) continue;
    const no = asString(row["mevzuat_no"])?.trim() ?? "";
    const name = asString(row["mev_adi"])?.trim() ?? "";
    hits.push({
      hitId: `mevzuat-${id}`,
      provider: "MEVZUAT",
      toolName,
      externalId: id,
      title: name !== "" ? (no !== "" ? `${no} sayılı ${name}` : name) : `Mevzuat ${id}`,
      ...(legislationKind !== undefined ? { legislationKind } : {}),
      ...(/^[0-9]{1,12}$/u.test(no) ? { legislationNo: no } : {}),
    });
  }
  const message = asString(rec["error_message"])?.trim();
  const reportsFailure = message !== undefined && message !== TYPED_LEGISLATION_EMPTY_MESSAGE;
  if (reportsFailure && hits.length === 0) {
    return { kind: "failure", failure: textFailure(message, "legislation search reported an error") };
  }
  const totalRecords = hits.length > 0 || !reportsFailure ? readTotalRecords(rec) : undefined;
  return {
    kind: "hits",
    hits,
    warnings: [],
    ...(reportsFailure
      ? { degraded: textFailure(message, "legislation search reported an error") }
      : {}),
    ...(totalRecords !== undefined ? { totalRecords } : {}),
  };
}

function parseMevzuatSearchText(toolName: string, data: unknown): SearchParse {
  if (typeof data !== "string") {
    const rec = asRecord(data);
    return rec !== undefined && Array.isArray(rec["documents"])
      ? parseTypedLegislationSearch(toolName, rec)
      : { kind: "failure", failure: parserFailure() };
  }
  const text = data.trim();
  if (TEXT_FAILURE_RE.test(text)) {
    return {
      kind: "failure",
      failure: textFailure(text, "legislation search reported an error"),
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
      return { kind: "failure", failure: textFailure(text, "search reported an error") };
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
  // KİK's client answers an outage with `error_message` and an empty list;
  // an empty list plus a failure sentence is not "no decision matches".
  if (failure === undefined && hits.length === 0 && rec !== undefined) {
    const reported = failureFromErrorMessage(rec);
    if (reported !== undefined) return { kind: "failure", failure: reported };
  }
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

export type WithinParse =
  | { kind: "ok"; data: unknown }
  | { kind: "failure"; failure: ParsedFailure };

/**
 * "Search inside ONE instrument / journal issue" payloads (the
 * `search_within_*` tools). The result is opaque DATA shown to the lawyer, so
 * only one question is asked of it: is this an answer, or a failure dressed
 * as one?
 *
 * MEASURED DEFECT, 27.09.2026: `search_within_mevzuat` answered
 * "Error fetching content for mevzuatId 6098: [SSL: CERTIFICATE_VERIFY_FAILED]
 * …" as a normal STRING result and `search_within_sigorta_tahkim_issue`
 * answered `{total_decisions: 0, matches: [], error: "Failed to search …"}`.
 * Both went to the screen as a 200 result, and the live research trace
 * counted the first as an "ok" call. The Python tools now raise / carry typed
 * fields; this check also covers a gateway that still returns the old shapes.
 */
export function parseWithinPayload(rawData: unknown): WithinParse {
  const data = unwrapFastMcpResult(rawData);
  try {
    if (typeof data === "string") {
      const text = data.trim();
      if (text === "" || TEXT_FAILURE_RE.test(text)) {
        return {
          kind: "failure",
          failure:
            text === ""
              ? { kind: "PARSER_ERROR", retryable: false, safeMessage: "search-within returned empty text" }
              : textFailure(text, "search-within reported an error"),
        };
      }
      return { kind: "ok", data: rawData };
    }
    const rec = asRecord(data);
    if (rec !== undefined) {
      const failure = failureFromRecord(rec);
      if (failure !== undefined) return { kind: "failure", failure };
    }
    return { kind: "ok", data: rawData };
  } catch {
    return { kind: "failure", failure: parserFailure() };
  }
}

/** Parse one search-capability tool payload into typed hits (never throws). */
export function parseSearchPayload(toolName: string, rawData: unknown): SearchParse {
  const data = unwrapFastMcpResult(rawData);
  try {
    if (toolName === "search_bedesten_unified") return parseBedestenUnified(data);
    if (toolName === "search") return parseDeepResearchSearch(data);
    if ((LEGISLATION_SEARCH_TOOLS as readonly string[]).includes(toolName)) {
      return parseMevzuatSearchText(toolName, data);
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

    // String-bodied tools (get_mevzuat_content, get_mevzuat_gerekce, ...).
    if (typeof data === "string") {
      const raw = data.trim();
      if (raw.length === 0) return fetchFailure("UNAVAILABLE", "document fetch returned empty text");
      if (TEXT_FAILURE_RE.test(raw)) {
        return { kind: "failure", failure: textFailure(raw, "document fetch reported an error") };
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
        asString(rec["markdown_content"]) ??
        asString(rec["markdown_chunk"]) ??
        asString(rec["text"]) ??
        asString(rec["content"]);
      if (text === undefined) {
        // The document tools answer an outage with `error_message` and no
        // text; that is the upstream's failure, not an unreadable payload
        // (measured 27.09.2026: GİB/KVKK/Rekabet showed PARSER_ERROR while
        // the network was down).
        const reported = failure ?? failureFromErrorMessage(rec);
        return reported !== undefined
          ? { kind: "failure", failure: reported }
          : fetchFailure("PARSER_ERROR", "document payload carried no text field");
      }
      const id = requestedId ?? asString(rec["documentId"]) ?? asString(rec["id"]) ?? "";
      const totalPages = rec["total_pages"];
      const page = rec["current_page"] ?? rec["page_number"];
      const paged =
        typeof totalPages === "number" && Number.isInteger(totalPages) && totalPages > 1
          ? { page: typeof page === "number" && Number.isInteger(page) ? page : 1, totalPages }
          : undefined;
      return {
        kind: "doc",
        doc: {
          externalId: id,
          title: asString(rec["title"]) ?? `Belge ${id}`,
          sourceUrl:
            asString(rec["source_url"]) ?? asString(rec["url"]) ?? asString(rec["document_url"]) ?? "",
          text,
          ...(paged !== undefined ? { pagination: paged } : {}),
        },
      };
    }
    return fetchFailure("PARSER_ERROR", "document payload had an unexpected shape");
  } catch {
    return fetchFailure("PARSER_ERROR", "document payload could not be parsed");
  }
}
