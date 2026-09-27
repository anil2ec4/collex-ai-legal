/**
 * "Karar ara" search service (W14/B-16).
 *
 * A litigator's research is LIST SCANNING, not one free-text question: "İzmir
 * BAM, 2023–2025, `"tahliye taahhüdü"`, hariç: kira tespiti — 30 künye tara,
 * 5'ini işaretle". This service turns that form into raw MCP tool calls over
 * the selected sources and returns KÜNYE ROWS, fast.
 *
 * Three rules it does not bend:
 *
 *  1. **A search summary is never evidence** (brief 10.2). A row carries a
 *     `snippet` for the eye and an `externalId` for the next step; the only
 *     thing that produces a citable, hash-sealed passage is the separate
 *     `sources/fetchService.ts` call.
 *  2. **A failed source is NAMED** (the rule `tests/test_facade_contracts.py`
 *     exists to enforce, applied on this side too). Partial results plus a
 *     `failedSources[]` with a typed kind and a Turkish sentence — never a
 *     silent empty list.
 *  3. **No künye is invented.** Every row is narrowed out of a real payload by
 *     `research/payloads.ts`; a row with no `externalId` is dropped rather
 *     than backfilled.
 *
 * Upstream reachability: the government endpoints are NOT reachable from the
 * build machine, so this service is written against an injected
 * `ProviderGateway` and its tests drive a fake one. Live verification is
 * pending and is reported as pending — see W14-L-SOURCES.md.
 */

import { randomUUID } from "node:crypto";
import type { ProviderGateway } from "../gateway/gateway.js";
import { parseSearchPayload, type LiveSearchHit } from "../research/payloads.js";
import { progressLabelForTool } from "../research/progress.js";
import { scanForInjection } from "../security/untrusted.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import {
  DEFAULT_SOURCE_IDS,
  sourceById,
  type SourceDescriptor,
} from "./catalog.js";

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface SourceSearchRequest {
  /** Free text; the litigator's own words. */
  query: string;
  /** Catalog source ids; empty = DEFAULT_SOURCE_IDS. */
  sources?: readonly string[];
  /** Tam ifade: wrap the query in escaped quotes for the Bedesten grammar. */
  exactPhrase?: boolean;
  /** Hariç tutulacak kelimeler. */
  excludeTerms?: readonly string[];
  /** Daire (Bedesten `birimAdi`, e.g. "H3", "HGK", "D10"). */
  chamber?: string;
  /** Yıl aralığı (inclusive). Converted to a decision-date range. */
  yearFrom?: number;
  yearTo?: number;
  /** Explicit ISO decision-date range; wins over yearFrom/yearTo. */
  dateFrom?: string;
  dateTo?: string;
  /** Karar türü, for the sources whose tool has such a parameter. */
  decisionType?: string;
  /** Kanun no, for the legislation sources. */
  legislationNo?: string;
  /** 1-based page; forwarded to every source that paginates. */
  page?: number;
  /** Max rows returned overall (default 40, ceiling 200). */
  limit?: number;
}

export const DEFAULT_SOURCE_SEARCH_LIMIT = 40;
export const MAX_SOURCE_SEARCH_LIMIT = 200;

/** Per-call ceiling; same reasoning as liveExecutor's 80 s. */
export const DEFAULT_SOURCE_CALL_TIMEOUT_MS = 80_000;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** One künye row: everything the list needs and nothing citable. */
export interface SourceSearchRow {
  rowId: string;
  sourceId: string;
  sourceLabel: string;
  /** Provider family, for the fetch step. */
  provider: string;
  /** Fetch kind to pass to POST /v1/sources/fetch for this row. */
  fetchKind?: string;
  /** The id the fetch step needs; comes from a TYPED payload row only. */
  externalId: string;
  title: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
  legislationKind?: string;
  sourceUrl?: string;
  /**
   * Matching sentence for the eye ONLY — control characters stripped, length
   * capped, and explicitly NOT evidence. `POST /v1/sources/fetch` is what
   * produces a citable passage.
   */
  snippet?: string;
  /**
   * Injection heuristics fired on this row's untrusted text. TELEMETRY ONLY
   * (brief 12.4): nothing branches on it; it exists so a flagged row can be
   * shown with a warning rather than silently trusted.
   */
  injectionFlagged?: boolean;
}

export interface SourceFailure {
  sourceId: string;
  sourceLabel: string;
  /** Typed machine kind (English UPPER_SNAKE). */
  kind: string;
  /** Lawyer Turkish, no driver prose, no provider text. */
  message: string;
  correlationId: string;
}

export interface SourceSearchResult {
  searchId: string;
  query: string;
  /** The query string actually sent to Bedesten (audit + repeatability). */
  effectiveQuery: string;
  requestedSources: readonly string[];
  rows: SourceSearchRow[];
  failedSources: SourceFailure[];
  /** Sources that answered without error (may still have zero rows). */
  okSources: readonly string[];
  /** True when at least one selected source failed or degraded. */
  partial: boolean;
  /** Wall time in ms. */
  tookMs: number;
  /**
   * Additive (W14 M-SRV IR-2): how many records the SOURCES themselves say
   * they hold for this query, summed over the sources that published a count.
   * `null` means NO selected source published one — never 0, which would read
   * as "the archives hold nothing".
   *
   * Measured on the live upstreams (W14-C-FINAL §7): the same phrase answered
   * `total_records` **116 090** unquoted and **758** as an exact phrase, while
   * the lawyer was shown 20 rows either way. Without this number the list
   * cannot say whether it is the whole answer or the tip of an iceberg, and
   * the honest screen sentence ("sıralamayı kaynak sunucu belirler") is only
   * half the story.
   */
  totalRecords: number | null;
  /**
   * Per-call trace, same shape as the research trace rows.
   *
   * `totalRecords` is per source and follows the same rule: the provider's own
   * count, or `null` when that provider publishes none. A failed source is
   * always `null` — it told us nothing.
   */
  trace: Array<{
    sourceId: string;
    tool: string;
    label: string;
    ok: boolean;
    ms: number;
    rows: number;
    errorKind?: string;
    totalRecords: number | null;
  }>;
  generatedAt: string;
}

export class NoSourcesSelectedError extends Error {
  constructor(readonly unknownSources: readonly string[]) {
    super(`no known source selected (unknown: ${unknownSources.join(", ")})`);
    this.name = "NoSourcesSelectedError";
  }
}

// ---------------------------------------------------------------------------
// Query grammar
// ---------------------------------------------------------------------------

/**
 * Build the phrase Bedesten actually understands:
 *  - `exactPhrase` wraps the whole query in quotes — the form
 *    `search_bedesten_unified` documents;
 *  - every exclude term becomes a leading-minus token (`-kira`).
 * Terms are trimmed and de-duplicated; an empty term is dropped, never turned
 * into a bare "-".
 */
export function buildBedestenPhrase(request: {
  query: string;
  exactPhrase?: boolean;
  excludeTerms?: readonly string[];
}): string {
  const base = request.query.trim();
  const head = request.exactPhrase === true && base !== "" ? `"${base}"` : base;
  const excluded = [
    ...new Set((request.excludeTerms ?? []).map((t) => t.trim()).filter((t) => t !== "")),
  ];
  return [head, ...excluded.map((t) => `-${t}`)].filter((p) => p !== "").join(" ");
}

/**
 * Plain query for the sources whose tool has no exclusion grammar. The
 * exclusion is then applied CLIENT-SIDE over the returned rows and the fact is
 * reported, so "hariç tutulacak kelimeler" never silently does nothing.
 */
export function buildPlainQuery(request: { query: string }): string {
  return request.query.trim();
}

/** ISO day range from a year range (inclusive), or an empty object. */
export function yearRangeToDates(
  yearFrom: number | undefined,
  yearTo: number | undefined,
): { dateFrom?: string; dateTo?: string } {
  const out: { dateFrom?: string; dateTo?: string } = {};
  if (yearFrom !== undefined && Number.isInteger(yearFrom)) {
    out.dateFrom = `${String(yearFrom).padStart(4, "0")}-01-01`;
  }
  if (yearTo !== undefined && Number.isInteger(yearTo)) {
    out.dateTo = `${String(yearTo).padStart(4, "0")}-12-31`;
  }
  return out;
}

const ISO_DAY_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u;

/** Turkish `DD.MM.YYYY` for the Emsal / legislation tools, from an ISO day. */
function isoToDotted(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const m = ISO_DAY_RE.exec(iso);
  return m === null ? undefined : `${m[3] as string}.${m[2] as string}.${m[1] as string}`;
}

// ---------------------------------------------------------------------------
// Per-source tool arguments
// ---------------------------------------------------------------------------

interface ResolvedRange {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Raw tool arguments for one source. Every parameter name below is the REAL
 * one (verified against mcp_server_main.py / mevzuat_mcp_server.py); an
 * unsupported filter is simply not sent, never renamed.
 */
export function buildSourceInput(
  source: SourceDescriptor,
  request: SourceSearchRequest,
  range: ResolvedRange,
): Record<string, unknown> {
  const page = Math.max(1, Math.floor(request.page ?? 1));
  const plain = buildPlainQuery(request);

  if (source.toolName === "search_bedesten_unified") {
    return {
      phrase: buildBedestenPhrase(request),
      court_types: [source.courtType as string],
      pageNumber: page,
      ...(source.supportsChamber === true && request.chamber !== undefined
        ? { birimAdi: request.chamber }
        : {}),
      ...(range.dateFrom !== undefined ? { kararTarihiStart: range.dateFrom } : {}),
      ...(range.dateTo !== undefined ? { kararTarihiEnd: range.dateTo } : {}),
    };
  }

  if (source.toolName === "search_emsal_detailed_decisions") {
    const start = isoToDotted(range.dateFrom);
    const end = isoToDotted(range.dateTo);
    return {
      keyword: plain,
      page_number: page,
      ...(start !== undefined ? { start_date: start } : {}),
      ...(end !== undefined ? { end_date: end } : {}),
    };
  }

  if (source.toolName === "search_uyusmazlik_decisions") {
    return { icerik: plain, search_scope: "All", page_number: page };
  }

  if (source.toolName === "search_anayasa_unified") {
    const decisionType =
      request.decisionType !== undefined &&
      (source.decisionTypes ?? []).includes(request.decisionType)
        ? request.decisionType
        : "norm_denetimi";
    return {
      decision_type: decisionType,
      keywords: [plain],
      page_to_fetch: page,
      results_per_page: 10,
    };
  }

  if (source.toolName === "search_mevzuat") {
    return {
      ...(request.legislationNo !== undefined
        ? { mevzuat_no: request.legislationNo }
        : { phrase: plain }),
      page,
      page_size: 10,
    };
  }

  // The nine type-specific legislation searches share one signature.
  if (source.family === "mevzuat") {
    const start = isoToDotted(range.dateFrom);
    const end = isoToDotted(range.dateTo);
    return {
      aranacak_ifade: plain,
      tam_cumle: request.exactPhrase === true,
      page_number: page,
      // 3 = title AND content; the litigator is looking for a phrase in the text.
      aranacak_yer: 3,
      page_size: 10,
      ...(start !== undefined ? { baslangic_tarihi: start } : {}),
      ...(end !== undefined ? { bitis_tarihi: end } : {}),
    };
  }

  // Regulators: one free-text parameter each, plus their own constants.
  switch (source.toolName) {
    case "search_rekabet_kurumu_decisions":
      return { PdfText: plain, page };
    case "search_kik_v2_decisions":
      return {
        karar_metni: plain,
        decision_type:
          request.decisionType !== undefined &&
          (source.decisionTypes ?? []).includes(request.decisionType)
            ? request.decisionType
            : "uyusmazlik",
      };
    case "search_sayistay_unified":
      return {
        web_karar_metni: plain,
        decision_type:
          request.decisionType !== undefined &&
          (source.decisionTypes ?? []).includes(request.decisionType)
            ? request.decisionType
            : "daire",
        start: (page - 1) * 10,
        length: 10,
      };
    default:
      // KVKK, BDDK, BTK, GİB, Sigorta Tahkim all take `keywords` + `page`.
      return { keywords: plain, page };
  }
}

/** Fetch kind for a row of this source (what "Tam metni getir" must send). */
export function fetchKindForSource(source: SourceDescriptor): string | undefined {
  switch (source.toolName) {
    case "search_bedesten_unified":
      return "karar";
    case "search_emsal_detailed_decisions":
      return "emsal";
    case "search_uyusmazlik_decisions":
      return "uyusmazlik";
    case "search_anayasa_unified":
      return "aym";
    case "search_kik_v2_decisions":
      return "kik";
    case "search_kvkk_decisions":
      return "kvkk";
    case "search_rekabet_kurumu_decisions":
      return "rekabet";
    case "search_sayistay_unified":
      return "sayistay";
    case "search_bddk_decisions":
      return "bddk";
    case "search_btk_decisions":
      return "btk";
    case "search_gib_ozelge":
      return "gib";
    case "search_sigorta_tahkim_decisions":
      return "sigorta";
    default:
      return source.family === "mevzuat" ? "mevzuat" : undefined;
  }
}

// ---------------------------------------------------------------------------
// Turkish failure sentences (machine code first, explained)
// ---------------------------------------------------------------------------

/** [Turkish clause, trailing advice] per failure kind; the code goes between. */
const FAILURE_CLAUSES: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  RATE_LIMITED: ["kaynak sunucu istek sınırına takıldı", "; biraz sonra tekrar deneyin"],
  TIMEOUT: ["kaynak sunucu süresinde yanıt vermedi", ""],
  UNAVAILABLE: ["kaynak sunucuya ulaşılamadı", ""],
  UNAUTHORIZED: ["bu kaynak için gerekli kimlik tanımlı değil", ""],
  INVALID_REQUEST: ["arama isteği bu kaynak için geçersiz", ""],
  PARSER_ERROR: ["kaynak beklenmedik biçimde yanıt verdi", ""],
  NOT_FOUND: ["kaynakta bu sorguya karşılık kayıt bulunamadı", ""],
});

/**
 * The Turkish clause for one failure kind WITHOUT the machine code
 * ("kaynak sunucuya ulaşılamadı"), for a line that prints the code once at
 * its own end.
 */
export function failureClauseTr(kind: string): string {
  const clause = FAILURE_CLAUSES[kind];
  return clause === undefined ? "kaynak bir hata bildirdi" : `${clause[0]}${clause[1]}`;
}

/**
 * The Turkish clause for one failure kind, machine code in parentheses
 * ("kaynak sunucuya ulaşılamadı (UNAVAILABLE)"). Shared by every surface that
 * must say WHY a source gave nothing, so the same outage reads the same way
 * on the list, the within search and the research trace.
 */
export function failureReasonTr(kind: string): string {
  const clause = FAILURE_CLAUSES[kind];
  return clause === undefined
    ? `kaynak bir hata bildirdi (${kind})`
    : `${clause[0]} (${kind})${clause[1]}`;
}

export function failureMessageTr(sourceLabel: string, kind: string): string {
  return `${sourceLabel}: ${failureReasonTr(kind)}. Bu kaynağın sonuçları listede YOK.`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SourceSearchDeps {
  gateway: ProviderGateway;
  now?: () => string;
  monotonic?: () => number;
  newId?: () => string;
  perCallTimeoutMs?: number;
}

/** Resolve the requested source ids into catalog entries (order preserved). */
export function resolveSources(ids: readonly string[] | undefined): {
  sources: SourceDescriptor[];
  unknown: string[];
} {
  const requested = ids !== undefined && ids.length > 0 ? ids : DEFAULT_SOURCE_IDS;
  const sources: SourceDescriptor[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const id of requested) {
    const source = sourceById(id);
    if (source === undefined) {
      if (!unknown.includes(id)) unknown.push(id);
      continue;
    }
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    sources.push(source);
  }
  return { sources, unknown };
}

/**
 * Does a row survive the client-side exclusion? Only applied to sources whose
 * own grammar cannot exclude (everything but Bedesten); the row's TITLE and
 * SNIPPET are matched case-insensitively.
 */
function passesExclusion(row: SourceSearchRow, excludeTerms: readonly string[]): boolean {
  if (excludeTerms.length === 0) return true;
  const haystack = `${row.title} ${row.snippet ?? ""}`.toLocaleLowerCase("tr-TR");
  return !excludeTerms.some((term) =>
    haystack.includes(term.trim().toLocaleLowerCase("tr-TR")),
  );
}

/** Shortest token that counts as a lexeme; "m" in "TBK m.299" is not one. */
export const MIN_LEXEME_CODE_POINTS = 2;

/**
 * The LEXEMES of a Turkish text: Turkish-lowercased (`İ` -> `i`, `I` -> `ı`),
 * split on anything that is not a letter or digit, deduplicated, insertion
 * order kept. Quotes, `+`/`-` operators and dots are separators, so an exact
 * phrase and its plain form yield the SAME lexemes — that is what lets the
 * related-search dedupe see them as one query.
 *
 * Deliberately NOT a stemmer: a stemmer would be a linguistic claim nobody
 * here has measured. It is a lowercase split, and a reader can re-derive it.
 */
export function turkishLexemes(text: string): string[] {
  const seen = new Set<string>();
  for (const token of normalizeTurkishSearch(text).split(/[^\p{L}\p{N}]+/u)) {
    if ([...token].length < MIN_LEXEME_CODE_POINTS) continue;
    seen.add(token);
  }
  return [...seen];
}

/**
 * Does a query lexeme occur in a haystack of lexemes? Exact, or — because
 * Turkish is agglutinative ("tahliye" / "tahliyesi") — one is a prefix of the
 * other when both are at least four code points long. A prefix rule, not a
 * morphology: it is stated here so the reader knows exactly how loose it is.
 */
export function lexemeMatches(lexeme: string, haystack: readonly string[]): boolean {
  const lexLen = [...lexeme].length;
  return haystack.some((h) => {
    if (h === lexeme) return true;
    if (lexLen < 4 || [...h].length < 4) return false;
    return h.startsWith(lexeme) || lexeme.startsWith(h);
  });
}

export async function searchSources(
  request: SourceSearchRequest,
  deps: SourceSearchDeps,
): Promise<SourceSearchResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const monotonic = deps.monotonic ?? (() => Date.now());
  const newId = deps.newId ?? (() => randomUUID());
  const timeoutMs = deps.perCallTimeoutMs ?? DEFAULT_SOURCE_CALL_TIMEOUT_MS;
  const startedAt = monotonic();

  const { sources, unknown } = resolveSources(request.sources);
  if (sources.length === 0) throw new NoSourcesSelectedError(unknown);

  const yearRange = yearRangeToDates(request.yearFrom, request.yearTo);
  const dateFrom = request.dateFrom ?? yearRange.dateFrom;
  const dateTo = request.dateTo ?? yearRange.dateTo;
  const range: ResolvedRange = {
    ...(dateFrom !== undefined ? { dateFrom } : {}),
    ...(dateTo !== undefined ? { dateTo } : {}),
  };

  const excludeTerms = [
    ...new Set((request.excludeTerms ?? []).map((t) => t.trim()).filter((t) => t !== "")),
  ];
  const limit = Math.min(
    MAX_SOURCE_SEARCH_LIMIT,
    Math.max(1, Math.floor(request.limit ?? DEFAULT_SOURCE_SEARCH_LIMIT)),
  );

  const rows: SourceSearchRow[] = [];
  const failedSources: SourceFailure[] = [];
  const okSources: string[] = [];
  const trace: SourceSearchResult["trace"] = [];
  // Only the sources that ACTUALLY published a count contribute to the total;
  // an empty list stays `null` rather than summing to 0.
  const reportedTotals: number[] = [];

  for (const source of sources) {
    const input = buildSourceInput(source, request, range);
    const label = progressLabelForTool(source.toolName, source.capability);
    const callStarted = monotonic();
    let ms = 0;
    const fail = (kind: string): void => {
      failedSources.push({
        sourceId: source.id,
        sourceLabel: source.label,
        kind,
        message: failureMessageTr(source.label, kind),
        correlationId: newId(),
      });
      trace.push({
        sourceId: source.id,
        tool: source.toolName,
        label,
        ok: false,
        ms,
        rows: 0,
        errorKind: kind,
        // A source that failed published no count. Not 0 — unknown.
        totalRecords: null,
      });
    };

    let outcome;
    try {
      outcome = await deps.gateway.callTool(
        { toolName: source.toolName, args: input },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
    } catch {
      ms = Math.max(0, Math.round(monotonic() - callStarted));
      // A thrown gateway is a transport failure; the source is NAMED and the
      // remaining sources still run. Never a silent empty list.
      fail("UNAVAILABLE");
      continue;
    }
    ms = Math.max(0, Math.round(monotonic() - callStarted));

    if (outcome.status === "error") {
      fail(outcome.error.kind);
      continue;
    }

    const parsed = parseSearchPayload(source.toolName, outcome.data);
    if (parsed.kind === "failure") {
      fail(parsed.failure.kind);
      continue;
    }

    const beforeCount = rows.length;
    for (const hit of parsed.hits) {
      const row = toRow(source, hit, newId);
      // Bedesten excludes server-side; no other grammar can, so the exclusion
      // is applied here rather than silently ignored.
      if (
        source.toolName !== "search_bedesten_unified" &&
        !passesExclusion(row, excludeTerms)
      ) {
        continue;
      }
      rows.push(row);
    }
    okSources.push(source.id);
    if (parsed.totalRecords !== undefined) {
      reportedTotals.push(parsed.totalRecords);
    }
    trace.push({
      sourceId: source.id,
      tool: source.toolName,
      label,
      ok: true,
      ms,
      rows: rows.length - beforeCount,
      ...(parsed.degraded !== undefined ? { errorKind: parsed.degraded.kind } : {}),
      totalRecords: parsed.totalRecords ?? null,
    });
    if (parsed.degraded !== undefined) {
      // A payload that carried rows AND a provider failure is a partial
      // result: the rows are kept and the gap is named.
      failedSources.push({
        sourceId: source.id,
        sourceLabel: source.label,
        kind: parsed.degraded.kind,
        message:
          `${source.label}: kaynak kısmî sonuç bildirdi (${parsed.degraded.kind});` +
          " bu kaynağın listesi eksik olabilir.",
        correlationId: newId(),
      });
    }
  }

  return {
    searchId: newId(),
    query: request.query,
    effectiveQuery: buildBedestenPhrase(request),
    requestedSources: Object.freeze(sources.map((s) => s.id)),
    rows: rows.slice(0, limit),
    failedSources,
    okSources: Object.freeze(okSources),
    partial: failedSources.length > 0,
    tookMs: Math.max(0, Math.round(monotonic() - startedAt)),
    totalRecords:
      reportedTotals.length === 0
        ? null
        : reportedTotals.reduce((sum, n) => sum + n, 0),
    trace,
    generatedAt: now(),
  };
}

/** C0/C1 control characters, minus the whitespace the collapse below handles. */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

/**
 * Display-safe form of untrusted provider text: NFC, no C0/C1 control
 * characters (a lone CR or an ANSI escape has no business on a screen or in a
 * log line), whitespace collapsed, then truncated by CODE POINTS — never by
 * UTF-16 units, which would be able to split a surrogate pair.
 */
export function safeDisplayText(raw: string, maxCodePoints: number): string {
  const cleaned = raw
    .normalize("NFC")
    .replace(CONTROL_CHARS_RE, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const points = [...cleaned];
  return points.length <= maxCodePoints
    ? cleaned
    : `${points.slice(0, maxCodePoints).join("")}\u2026`;
}

function toRow(
  source: SourceDescriptor,
  hit: LiveSearchHit,
  newId: () => string,
): SourceSearchRow {
  const kind = fetchKindForSource(source);
  // The snippet is UNTRUSTED provider text shown to a human. It is never
  // evidence, and the injection scan below is telemetry, not a gate.
  const snippet =
    hit.snippet !== undefined ? safeDisplayText(hit.snippet, 400) : undefined;
  const injection = scanForInjection(`${hit.title} ${hit.snippet ?? ""}`);
  return {
    rowId: newId(),
    sourceId: source.id,
    sourceLabel: source.label,
    provider: hit.provider,
    ...(kind !== undefined ? { fetchKind: kind } : {}),
    externalId: hit.externalId,
    title: safeDisplayText(hit.title, 300),
    ...(hit.court !== undefined ? { court: hit.court } : {}),
    ...(hit.decisionDate !== undefined ? { decisionDate: hit.decisionDate } : {}),
    ...(hit.docketNo !== undefined ? { docketNo: hit.docketNo } : {}),
    ...(hit.decisionNo !== undefined ? { decisionNo: hit.decisionNo } : {}),
    ...(hit.legislationNo !== undefined ? { legislationNo: hit.legislationNo } : {}),
    ...(hit.legislationKind !== undefined ? { legislationKind: hit.legislationKind } : {}),
    ...(hit.sourceUrl !== undefined ? { sourceUrl: hit.sourceUrl } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(injection.flagged ? { injectionFlagged: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Printing a row as a künye (W17)
// ---------------------------------------------------------------------------

/**
 * Turn a search row into the ONE line a lawyer reads.
 *
 * MEASURED DEFECT, 06.09.2026. The petition-analysis lane built its künye as
 * `[court, title, docketNo, decisionNo].join(" · ")`, and for a Yargıtay row
 * the provider's `title` ALREADY reads "Yargıtay 11. Hukuk Dairesi
 * E. 2026/5892 K. 2026/4208". The lawyer got
 *
 *   Yargıtay 11. Hukuk Dairesi · Yargıtay 11. Hukuk Dairesi E. 2026/5892
 *   K. 2026/4208 · 2026/5892 · 2026/4208
 *
 * — the chamber twice and the file numbers twice more, ten times down the
 * page. Every part is therefore added only when the line does not already
 * carry it, compared on folded text so "E. 2026/5892" and "2026/5892" count
 * as the same thing.
 */
export function formatSourceKunye(row: {
  court?: string;
  title?: string;
  docketNo?: string;
  decisionNo?: string;
}): string {
  const parts: string[] = [];
  const has = (needle: string): boolean => {
    const folded = normalizeTurkishSearch(needle);
    if (folded === "") return true;
    return parts.some((part) => normalizeTurkishSearch(part).includes(folded));
  };
  /**
   * Add a part, keeping the MOST INFORMATIVE form of each fact.
   *
   * Containment runs both ways on purpose. `court` arrives first and `title`
   * usually repeats it ("Yargıtay 11. Hukuk Dairesi" then "Yargıtay 11. Hukuk
   * Dairesi E. 2026/5892 K. 2026/4208"), so a new part that SUBSUMES what is
   * already on the line replaces it instead of being appended after it.
   */
  const add = (value: string | undefined): void => {
    const text = (value ?? "").trim();
    if (text === "" || has(text)) return;
    const folded = normalizeTurkishSearch(text);
    const kept = parts.filter((part) => !folded.includes(normalizeTurkishSearch(part)));
    parts.length = 0;
    parts.push(...kept, text);
  };
  add(row.court);
  add(row.title);
  const docket = (row.docketNo ?? "").trim();
  const decision = (row.decisionNo ?? "").trim();
  // The file numbers are added as ONE part in the form a lawyer writes them,
  // and only when neither is already on the line.
  if (docket !== "" && decision !== "" && !has(docket) && !has(decision)) {
    parts.push(`E. ${docket} K. ${decision}`);
  } else {
    if (docket !== "" && !has(docket)) parts.push(`E. ${docket}`);
    if (decision !== "" && !has(decision)) parts.push(`K. ${decision}`);
  }
  return parts.join(" · ");
}

/**
 * The earliest and latest year a decision date may plausibly carry.
 *
 * MEASURED, 06.09.2026: a demo-corpus row came back with `decisionDate`
 * "6006-09-20". Printing that verbatim next to a künye tells a lawyer the
 * decision is from the year 6006; saying the source's date was unreadable
 * tells them the truth. The bound is a CONSTANT, not a clock, so the same
 * input always prints the same line.
 */
export const KUNYE_YEAR_MIN = 1920;
export const KUNYE_YEAR_MAX = 2100;

export const UNREADABLE_DATE_TR = "Kaynak okunabilir bir karar tarihi bildirmedi";

/**
 * The date line under a künye — labelled, in Turkish order, and never a bare
 * ISO string. An unreadable date says so instead of being printed.
 */
export function formatDecisionDateNote(decisionDate: string | undefined): string {
  const raw = (decisionDate ?? "").trim();
  if (raw === "") return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (match === null) return UNREADABLE_DATE_TR;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < KUNYE_YEAR_MIN ||
    year > KUNYE_YEAR_MAX ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return UNREADABLE_DATE_TR;
  }
  return `Karar tarihi: ${match[3]}.${match[2]}.${match[1] as string}`;
}
