/**
 * Run one legislation-change check for a matter: resolve every distinct cited
 * law through the official legislation lane of the existing MCP gateway
 * (`search_mevzuat` → `get_mevzuat_content`, the tool surface stays 54),
 * fingerprint the text it returns, and compare against the baseline this
 * matter recorded at its first check.
 *
 * STATES (never collapsed into one another):
 *   TEMEL_KAYDEDILDI   first check of this law/article in this matter; the
 *                      baseline was recorded now, nothing was compared.
 *   DEGISMEDI          the text is identical to the baseline's.
 *   DEGISMIS_OLABILIR  the text differs from the baseline's. "olabilir": the
 *                      source may have reformatted the same text, and ColleX
 *                      does not read what changed.
 *   ULASILAMADI        a call failed; this is NEVER "değişmedi".
 *   BELIRLENEMEDI      the tools cannot resolve the law to one text (no
 *                      match, more than one match, repealed instrument).
 *   KONTROL_EDILMEDI   the run's own bound (time, calls, law count, text
 *                      length) stopped it before this law was asked; the
 *                      result is then PARTIAL (`complete: false`).
 *
 * Calls are SEQUENTIAL (court and legislation share one Bedesten quota), the
 * time budget is read BETWEEN calls, and a law's text is sealed whole or not
 * at all: every page must arrive, or the law is ULASILAMADI.
 */

import type { Outcome } from "../capabilities/types.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import { parseSearchPayload, unwrapFastMcpResult } from "../research/payloads.js";
import { foldTurkishForFilter } from "../retrieval/normalize.js";
import { lookupByNumber } from "../retrieval/referenceParser.js";
import {
  INSTRUMENT_LABEL_TR,
  type CollectedCitations,
  type UnreadSource,
  type WatchCitation,
  type WatchCitationSource,
  type WatchInstrument,
} from "./collect.js";
import {
  WATCH_FINGERPRINT_METHOD,
  articleKey,
  isoToTr,
  isolateArticles,
  latestAmendmentNoteDate,
  watchFingerprint,
  type ArticleKind,
} from "./textSignals.js";

export const LEGISLATION_WATCH_SCHEMA = "collex.legislation-watch/v1";

export const WATCH_STATES = [
  "TEMEL_KAYDEDILDI",
  "DEGISMEDI",
  "DEGISMIS_OLABILIR",
  "ULASILAMADI",
  "BELIRLENEMEDI",
  "KONTROL_EDILMEDI",
] as const;
export type WatchState = (typeof WATCH_STATES)[number];

export const WATCH_STATE_LABEL_TR: Readonly<Record<WatchState, string>> = Object.freeze({
  TEMEL_KAYDEDILDI: "İLK KONTROL — karşılaştırma noktası kaydedildi",
  DEGISMEDI: "DEĞİŞMEDİ (ilk kontrolden bu yana)",
  DEGISMIS_OLABILIR: "DEĞİŞMİŞ OLABİLİR",
  ULASILAMADI: "ULAŞILAMADI",
  BELIRLENEMEDI: "BELİRLENEMEDİ",
  KONTROL_EDILMEDI: "KONTROL EDİLMEDİ",
});

export type WatchReasonCode =
  | "UPSTREAM_FAILED"
  | "UNEXPECTED_PAYLOAD"
  | "NO_MATCH"
  | "AMBIGUOUS"
  | "MULGA"
  | "TIME_BUDGET"
  | "CALL_BUDGET"
  | "LAW_LIMIT"
  | "PAGE_LIMIT"
  | "CANCELLED";

/** Why the RUN stopped asking (a single law's PAGE_LIMIT does not stop it). */
export type WatchStopReason = "TIME_BUDGET" | "CALL_BUDGET" | "LAW_LIMIT" | "CANCELLED";

export const REBASELINED_TR =
  "Karşılaştırma noktası bu kontrolle yenilendi; sonraki kontroller bugünkü metinle karşılaştırılır.";

/** Hard ceilings; a request may only LOWER `maxLaws`, never raise anything. */
export const DEFAULT_WATCH_TIME_BUDGET_MS = 120_000;
export const DEFAULT_WATCH_MAX_CALLS = 60;
export const DEFAULT_WATCH_MAX_LAWS = 12;
export const MAX_WATCH_LAWS = 25;
/** Per call; also capped by what is left of the time budget. */
export const DEFAULT_WATCH_CALL_TIMEOUT_MS = 60_000;
/** Characters per `get_mevzuat_content` page (the tool's own maximum). */
export const WATCH_CONTENT_PAGE_SIZE = 50_000;
/** Pages one law may take (× page size = the longest text sealed whole). */
export const MAX_WATCH_LAW_PAGES = 30;
/** Rows `search_mevzuat` is asked for (legislation page_size stays 1..20). */
const SEARCH_PAGE_SIZE = 10;

/** Sentences every result carries; the console prints them, never composes them. */
export const WATCH_NOTICES: readonly string[] = Object.freeze([
  "ColleX, kaynağın döndürdüğü kanun metninin parmak izini ve metindeki değişiklik notlarının " +
    "tarihlerini bu dosyadaki ilk kontrolle karşılaştırır; neyin değiştiğini okumaz ve yorumlamaz.",
  "“Değişmiş olabilir” bir uyarıdır: kaynak aynı metni yeniden biçimlendirmiş de olabilir. " +
    "Maddenin güncel metnini resmî kaynaktan açıp karşılaştırın.",
  "“Ulaşılamadı” ve “belirlenemedi” hiçbir zaman “değişmedi” anlamına gelmez.",
]);

export const WATCH_NO_CITATIONS_TR =
  "Bu dosyadaki taslak, araştırma ve belgelerde kanun atfı bulunamadı; kontrol edilecek bir şey yok.";

const REASON_TR: Readonly<Record<WatchReasonCode, string>> = Object.freeze({
  UPSTREAM_FAILED:
    "Resmî mevzuat kaynağına ulaşılamadı; bu kanun bu kontrolde karşılaştırılamadı. Bu bir “değişmedi” sonucu değildir.",
  UNEXPECTED_PAYLOAD:
    "Kaynak beklenmedik biçimde yanıt verdi; metin bütün olarak okunamadığı için karşılaştırılmadı. Bu bir “değişmedi” sonucu değildir.",
  NO_MATCH:
    "Kaynakta bu numarayla bu türde bir mevzuat bulunamadı; atıf başka bir mevzuat türüne ait ya da numara hatalı olabilir.",
  AMBIGUOUS:
    "Bu numara kaynakta birden fazla mevzuata ait; hangisine atıf yapıldığı belirlenemedi.",
  MULGA: "Mülga (yürürlükten kaldırılmış) bir kanun; yürürlükteki bir metinle karşılaştırılamaz.",
  TIME_BUDGET: "Kontrolün süre sınırı doldu; bu kanun bu kontrolde sorgulanmadı. Kontrolü yeniden başlatın.",
  CALL_BUDGET: "Bir kontrolde yapılabilecek sorgu sayısı doldu; bu kanun bu kontrolde sorgulanmadı.",
  LAW_LIMIT:
    "Bir kontrolde sınırlı sayıda kanun sorgulanır; bu kanun sıradaki kontrole kaldı (en uzun süredir bakılmayan önce gelir).",
  PAGE_LIMIT:
    "Kanun metni tek kontrolde bütün olarak okunabilecek uzunluğu aşıyor; parça parça karşılaştırma yapılmaz.",
  CANCELLED: "Kontrol durduruldu; bu kanun sorgulanmadı.",
});

// ---------------------------------------------------------------------------
// Baselines (what the settings document stores per law)
// ---------------------------------------------------------------------------

export interface ArticleBaseline {
  /** null = the heading could not be isolated when the baseline was taken. */
  fingerprint: string | null;
  latestNoteDate: string | null;
  recordedAt: string;
}

export interface LawBaseline {
  lawKey: string;
  method: string;
  mevzuatId: string;
  title: string;
  rgDate: string | null;
  fingerprint: string;
  latestNoteDate: string | null;
  recordedAt: string;
  articles: Record<string, ArticleBaseline>;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface LawCheck {
  lawKey: string;
  instrument: WatchInstrument;
  lawNo: string;
  /** Title as the source returned it; the citation label until resolved. */
  title: string;
  state: WatchState;
  stateLabel: string;
  reasonCode: WatchReasonCode | null;
  reason: string;
  /** Machine failure kind of the call that failed (ULASILAMADI only). */
  failureKind: string | null;
  mevzuatId: string | null;
  /** Resmî Gazete date of the law's ORIGINAL publication, as the tool prints it. */
  rgDate: string | null;
  latestNoteDate: string | null;
  baselineRecordedAt: string | null;
  baselineLatestNoteDate: string | null;
  /** True when the baseline was (re)written by this check. */
  baselineWritten: boolean;
  calls: number;
  pages: number;
}

export interface WatchRow {
  key: string;
  lawKey: string;
  instrument: WatchInstrument;
  lawNo: string;
  article: string | null;
  articleKind: ArticleKind;
  label: string;
  sources: WatchCitationSource[];
  sourcesTotal: number;
  state: WatchState;
  stateLabel: string;
  /** What was compared: the isolated article, or the whole law. */
  granularity: "madde" | "kanun";
  /** The one Turkish sentence the console prints for this row. */
  message: string;
  latestNoteDate: string | null;
  baselineRecordedAt: string | null;
  reasonCode: WatchReasonCode | null;
}

export interface WatchResult {
  schema: typeof LEGISLATION_WATCH_SCHEMA;
  matterId: string;
  checkedAt: string;
  /** false when any law was KONTROL_EDILMEDI or a source was unread. */
  complete: boolean;
  stopReason: WatchStopReason | null;
  lawsTotal: number;
  lawsAsked: number;
  counts: Record<WatchState, number>;
  laws: LawCheck[];
  rows: WatchRow[];
  unreadSources: UnreadSource[];
  citationsTruncated: boolean;
  budget: {
    timeBudgetMs: number;
    maxCalls: number;
    maxLaws: number;
    callsUsed: number;
    elapsedMs: number;
  };
  notices: string[];
}

export interface WatchRunOptions {
  matterId: string;
  collected: CollectedCitations;
  baselines: Readonly<Record<string, LawBaseline>>;
  /** lawKey → when it was last asked (drives the rotation under `maxLaws`). */
  lastAsked?: Readonly<Record<string, string>>;
  gateway: ProviderGateway;
  /** Replace the baseline of every law read successfully in this run. */
  rebaseline?: boolean;
  maxLaws?: number;
  maxCalls?: number;
  timeBudgetMs?: number;
  callTimeoutMs?: number;
  now?: () => Date;
  /** Wall clock for the budget (ms); injectable so a test can advance it. */
  clock?: () => number;
  signal?: AbortSignal;
}

export interface WatchRunOutput {
  result: WatchResult;
  /** The baselines to persist (the input's, updated). */
  baselines: Record<string, LawBaseline>;
  lastAsked: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------

const RG_BY_ID_RE = /mevzuatId:\s*(\S+)(?:[^\n]*?\|\s*RG:\s*(\d{4}-\d{2}-\d{2}))?/gu;

interface SearchRow {
  mevzuatId: string;
  lawNo: string;
  title: string;
  rgDate: string | null;
}

function readSearch(raw: unknown): { ok: true; rows: SearchRow[] } | { ok: false } {
  const parsed = parseSearchPayload("search_mevzuat", raw);
  if (parsed.kind !== "hits") return { ok: false };
  const text = unwrapFastMcpResult(raw);
  const rgById = new Map<string, string>();
  if (typeof text === "string") {
    for (const match of text.matchAll(RG_BY_ID_RE)) {
      if (match[1] !== undefined && match[2] !== undefined) rgById.set(match[1], match[2]);
    }
  }
  return {
    ok: true,
    rows: parsed.hits.map((hit) => ({
      mevzuatId: hit.externalId,
      lawNo: hit.legislationNo ?? "",
      title: hit.title,
      rgDate: rgById.get(hit.externalId) ?? null,
    })),
  };
}

const CONTENT_HEADER_RE = /^\s*Mevzuat\s+(\S+)\s*\|\s*page\s+(\d+)\/(\d+)\s*\|\s*page_size\s+(\d+)\r?\n\r?\n/u;

interface ContentPage {
  page: number;
  totalPages: number;
  text: string;
}

/** One `get_mevzuat_content` page; the payload cannot rename the document. */
function readContentPage(raw: unknown, mevzuatId: string): ContentPage | undefined {
  const data = unwrapFastMcpResult(raw);
  if (typeof data !== "string") return undefined;
  const match = CONTENT_HEADER_RE.exec(data);
  if (match === null || match[1] !== mevzuatId) return undefined;
  const page = Number(match[2]);
  const totalPages = Number(match[3]);
  if (!Number.isInteger(page) || !Number.isInteger(totalPages) || page < 1 || totalPages < page) return undefined;
  return { page, totalPages, text: data.slice(match[0].length) };
}

/** Choose the one search row that IS the cited instrument. */
function chooseRow(
  rows: readonly SearchRow[],
  instrument: WatchInstrument,
  lawNo: string,
): { row: SearchRow } | { code: "NO_MATCH" | "AMBIGUOUS" } {
  const exact = rows.filter((row) => row.lawNo === lawNo);
  if (exact.length === 0) return { code: "NO_MATCH" };
  const distinct = new Map(exact.map((row) => [row.mevzuatId, row]));
  if (distinct.size === 1) return { row: exact[0] as SearchRow };
  // Numbers restarted in 1960, so a KANUN number can name two laws. The
  // abbreviation table's canonical name decides only when exactly one
  // title carries it; otherwise the honest answer is "belirlenemedi".
  const canonical = instrument === "KANUN" ? lookupByNumber(lawNo)?.canonicalName : undefined;
  if (canonical !== undefined) {
    const want = foldTurkishForFilter(canonical);
    const named = [...distinct.values()].filter((row) => foldTurkishForFilter(row.title).includes(want));
    if (named.length === 1) return { row: named[0] as SearchRow };
  }
  return { code: "AMBIGUOUS" };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface LawGroup {
  lawKey: string;
  instrument: WatchInstrument;
  lawNo: string;
  label: string;
  mulga: boolean;
  citations: WatchCitation[];
}

function groupByLaw(citations: readonly WatchCitation[]): LawGroup[] {
  const groups = new Map<string, LawGroup>();
  for (const citation of citations) {
    let group = groups.get(citation.lawKey);
    if (group === undefined) {
      const lawLabel = citation.article === null
        ? citation.label
        : citation.label.replace(/\s+(?:ek |geçici |mükerrer )?m\.\s+\S+$/u, "");
      group = {
        lawKey: citation.lawKey,
        instrument: citation.instrument,
        lawNo: citation.lawNo,
        label: lawLabel,
        mulga: citation.mulga,
        citations: [],
      };
      groups.set(citation.lawKey, group);
    }
    group.citations.push(citation);
  }
  return [...groups.values()];
}

function emptyCounts(): Record<WatchState, number> {
  return Object.fromEntries(WATCH_STATES.map((state) => [state, 0])) as Record<WatchState, number>;
}

interface ReadLaw {
  mevzuatId: string;
  title: string;
  rgDate: string | null;
  text: string;
  pages: number;
}

interface Identity {
  title: string;
  mevzuatId: string;
  rgDate: string | null;
}

type LawOutcome =
  | { kind: "read"; law: ReadLaw; calls: number }
  | {
      kind: "state";
      state: WatchState;
      code: WatchReasonCode;
      failureKind?: string;
      calls: number;
      pages: number;
      title?: string;
      mevzuatId?: string;
      rgDate?: string | null;
      /** Set when the RUN must stop asking after this law. */
      stop?: WatchStopReason;
    };

type CallOutcome =
  | { ok: true; data: unknown }
  | { ok: false; failureKind: string; budget?: WatchStopReason };

export async function runLegislationWatch(options: WatchRunOptions): Promise<WatchRunOutput> {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => Date.now());
  const started = clock();
  const checkedAt = now().toISOString();
  const timeBudgetMs = Math.min(options.timeBudgetMs ?? DEFAULT_WATCH_TIME_BUDGET_MS, DEFAULT_WATCH_TIME_BUDGET_MS);
  const maxCalls = Math.min(options.maxCalls ?? DEFAULT_WATCH_MAX_CALLS, DEFAULT_WATCH_MAX_CALLS);
  const maxLaws = Math.max(1, Math.min(options.maxLaws ?? DEFAULT_WATCH_MAX_LAWS, MAX_WATCH_LAWS));
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_WATCH_CALL_TIMEOUT_MS;
  const baselines: Record<string, LawBaseline> = { ...options.baselines };
  const lastAsked: Record<string, string> = { ...(options.lastAsked ?? {}) };

  let callsUsed = 0;
  let stopReason: WatchStopReason | null = null;

  const remaining = (): number => timeBudgetMs - (clock() - started);
  /** Why the next `needed` calls may not start, or undefined when they may. */
  const blocked = (needed: number): WatchStopReason | undefined => {
    if (options.signal?.aborted === true) return "CANCELLED";
    if (remaining() <= 0) return "TIME_BUDGET";
    if (callsUsed + needed > maxCalls) return "CALL_BUDGET";
    return undefined;
  };

  const call = async (toolName: string, args: Record<string, unknown>): Promise<CallOutcome> => {
    callsUsed += 1;
    const signals: AbortSignal[] = [AbortSignal.timeout(Math.max(1, Math.min(callTimeoutMs, remaining())))];
    if (options.signal !== undefined) signals.push(options.signal);
    let outcome: Outcome<unknown>;
    try {
      outcome = await options.gateway.callTool({ toolName, args }, { signal: AbortSignal.any(signals) });
    } catch {
      // A throwing gateway is an unreachable source, never an empty answer.
      return { ok: false, failureKind: "UNAVAILABLE", ...budgetCut() };
    }
    if (outcome.status === "ok" || outcome.status === "partial") return { ok: true, data: outcome.data };
    return {
      ok: false,
      failureKind: outcome.status === "error" ? outcome.error.kind : "UNAVAILABLE",
      ...budgetCut(),
    };
  };

  /**
   * A call our own deadline (or the lawyer's cancel) cut is the RUN's bound,
   * not the source's failure: the law was not checked, and saying
   * "ulaşılamadı" would blame the archive for our clock.
   */
  const budgetCut = (): { budget?: WatchStopReason } => {
    if (options.signal?.aborted === true) return { budget: "CANCELLED" };
    if (remaining() <= 0) return { budget: "TIME_BUDGET" };
    return {};
  };

  const readLaw = async (group: LawGroup): Promise<LawOutcome> => {
    let calls = 0;
    const halted = (code: WatchStopReason, pages: number, identity?: Identity): LawOutcome => ({
      kind: "state",
      state: "KONTROL_EDILMEDI",
      code,
      stop: code,
      calls,
      pages,
      ...(identity ?? {}),
    });

    const before = blocked(1);
    if (before !== undefined) return halted(before, 0);
    calls += 1;
    const search = await call("search_mevzuat", {
      mevzuat_no: group.lawNo,
      mevzuat_tur: group.instrument,
      page_size: SEARCH_PAGE_SIZE,
    });
    if (!search.ok) {
      if (search.budget !== undefined) return halted(search.budget, 0);
      return { kind: "state", state: "ULASILAMADI", code: "UPSTREAM_FAILED", failureKind: search.failureKind, calls, pages: 0 };
    }
    const rows = readSearch(search.data);
    if (!rows.ok) {
      return { kind: "state", state: "ULASILAMADI", code: "UNEXPECTED_PAYLOAD", failureKind: "PARSER_ERROR", calls, pages: 0 };
    }
    const chosen = chooseRow(rows.rows, group.instrument, group.lawNo);
    if ("code" in chosen) return { kind: "state", state: "BELIRLENEMEDI", code: chosen.code, calls, pages: 0 };
    const identity: Identity = { title: chosen.row.title, mevzuatId: chosen.row.mevzuatId, rgDate: chosen.row.rgDate };

    const parts: string[] = [];
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page += 1) {
      // Before page 2 the whole remainder must fit: a law is sealed whole or
      // not at all, so starting a text we cannot finish would waste calls.
      const stop = blocked(page === 1 ? 1 : totalPages - page + 1);
      if (stop !== undefined) return halted(stop, page - 1, identity);
      calls += 1;
      const content = await call("get_mevzuat_content", {
        mevzuat_id: chosen.row.mevzuatId,
        page_number: page,
        page_size: WATCH_CONTENT_PAGE_SIZE,
      });
      if (!content.ok) {
        if (content.budget !== undefined) return halted(content.budget, page - 1, identity);
        return { kind: "state", state: "ULASILAMADI", code: "UPSTREAM_FAILED", failureKind: content.failureKind, calls, pages: page - 1, ...identity };
      }
      const parsed = readContentPage(content.data, chosen.row.mevzuatId);
      // `_paginate_text` CLAMPS an out-of-range page to the last one, so a
      // page that answers with another number is never accepted as this one.
      if (parsed === undefined || parsed.page !== page || (page > 1 && parsed.totalPages !== totalPages)) {
        return { kind: "state", state: "ULASILAMADI", code: "UNEXPECTED_PAYLOAD", failureKind: "PARSER_ERROR", calls, pages: page - 1, ...identity };
      }
      if (page === 1) {
        totalPages = parsed.totalPages;
        if (totalPages > MAX_WATCH_LAW_PAGES) {
          return { kind: "state", state: "KONTROL_EDILMEDI", code: "PAGE_LIMIT", calls, pages: 1, ...identity };
        }
      }
      parts.push(parsed.text);
    }
    return { kind: "read", law: { ...identity, text: parts.join(""), pages: totalPages }, calls };
  };

  // Rotation: laws never asked first, then the longest-unasked, then the
  // most-cited; law number and key last so the order is total and stable.
  const groups = groupByLaw(options.collected.citations).sort((a, b) => {
    const la = lastAsked[a.lawKey] ?? "";
    const lb = lastAsked[b.lawKey] ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
    const ca = a.citations.reduce((n, c) => n + c.sourcesTotal, 0);
    const cb = b.citations.reduce((n, c) => n + c.sourcesTotal, 0);
    if (ca !== cb) return cb - ca;
    return Number(a.lawNo) - Number(b.lawNo) || compareKeys(a.lawKey, b.lawKey);
  });

  const laws: LawCheck[] = [];
  const rows: WatchRow[] = [];
  let lawsAsked = 0;

  for (const group of groups) {
    const stored = baselines[group.lawKey];
    const comparable = stored !== undefined && stored.method === WATCH_FINGERPRINT_METHOD ? stored : undefined;
    const lawCheck: LawCheck = {
      lawKey: group.lawKey,
      instrument: group.instrument,
      lawNo: group.lawNo,
      title: group.label,
      state: "KONTROL_EDILMEDI",
      stateLabel: WATCH_STATE_LABEL_TR.KONTROL_EDILMEDI,
      reasonCode: null,
      reason: "",
      failureKind: null,
      mevzuatId: null,
      rgDate: null,
      latestNoteDate: null,
      baselineRecordedAt: comparable?.recordedAt ?? null,
      baselineLatestNoteDate: comparable?.latestNoteDate ?? null,
      baselineWritten: false,
      calls: 0,
      pages: 0,
    };

    let outcome: LawOutcome;
    if (group.mulga) {
      outcome = { kind: "state", state: "BELIRLENEMEDI", code: "MULGA", calls: 0, pages: 0 };
    } else if (stopReason !== null) {
      outcome = { kind: "state", state: "KONTROL_EDILMEDI", code: stopReason, calls: 0, pages: 0 };
    } else if (lawsAsked >= maxLaws) {
      stopReason = "LAW_LIMIT";
      outcome = { kind: "state", state: "KONTROL_EDILMEDI", code: "LAW_LIMIT", calls: 0, pages: 0 };
    } else {
      lawsAsked += 1;
      outcome = await readLaw(group);
      if (outcome.kind === "state" && outcome.stop !== undefined) stopReason = outcome.stop;
      // Asked means asked: an unresolvable or unreachable law moves to the
      // back of the rotation too, or it would take the first slot forever.
      if (!(outcome.kind === "state" && outcome.state === "KONTROL_EDILMEDI")) lastAsked[group.lawKey] = checkedAt;
    }
    lawCheck.calls = outcome.calls;

    if (outcome.kind === "state") {
      lawCheck.state = outcome.state;
      lawCheck.stateLabel = WATCH_STATE_LABEL_TR[outcome.state];
      lawCheck.reasonCode = outcome.code;
      lawCheck.reason = REASON_TR[outcome.code];
      lawCheck.failureKind = outcome.failureKind ?? null;
      lawCheck.pages = outcome.pages;
      if (outcome.title !== undefined) lawCheck.title = outcome.title;
      if (outcome.mevzuatId !== undefined) lawCheck.mevzuatId = outcome.mevzuatId;
      if (outcome.rgDate !== undefined) lawCheck.rgDate = outcome.rgDate;
      const message = `${WATCH_STATE_LABEL_TR[outcome.state]}: ${REASON_TR[outcome.code]}`;
      for (const citation of group.citations) {
        rows.push(rowFor(citation, outcome.state, "kanun", message, null, comparable?.recordedAt ?? null, outcome.code));
      }
      laws.push(lawCheck);
      continue;
    }

    // ---- the law's text is in hand: compare ------------------------------
    const law = outcome.law;
    const lawFingerprint = watchFingerprint(law.text);
    const lawNote = latestAmendmentNoteDate(law.text);
    const articles = isolateArticles(law.text);
    lawCheck.title = law.title;
    lawCheck.mevzuatId = law.mevzuatId;
    lawCheck.rgDate = law.rgDate;
    lawCheck.latestNoteDate = lawNote;
    lawCheck.pages = law.pages;

    const writeBaseline = comparable === undefined || options.rebaseline === true;
    // A rebaseline keeps no stale article entry: every cited article is
    // re-recorded from the text read now.
    const nextArticles: Record<string, ArticleBaseline> = writeBaseline ? {} : { ...comparable.articles };
    let articlesAdded = 0;
    const lawChanged = comparable !== undefined && comparable.fingerprint !== lawFingerprint;
    lawCheck.state = comparable === undefined ? "TEMEL_KAYDEDILDI" : lawChanged ? "DEGISMIS_OLABILIR" : "DEGISMEDI";

    for (const citation of group.citations) {
      const artKey = citation.article === null ? undefined : articleKey(citation.articleKind, citation.article);
      const isolated = artKey === undefined ? undefined : articles.get(artKey);
      const articleText = isolated?.text;
      const articleFp = articleText !== undefined ? watchFingerprint(articleText) : null;
      const articleNote = articleText !== undefined ? latestAmendmentNoteDate(articleText) : null;
      const priorArticle = artKey !== undefined ? comparable?.articles[artKey] : undefined;

      let state: WatchState;
      let granularity: "madde" | "kanun";
      let priorNote: string | null = null;
      if (comparable === undefined || (artKey !== undefined && priorArticle === undefined)) {
        // First check of this law — or a newly cited article of a law this
        // matter already watches: record, compare nothing.
        state = "TEMEL_KAYDEDILDI";
        granularity = articleFp !== null ? "madde" : "kanun";
      } else if (articleFp !== null && priorArticle !== undefined && priorArticle.fingerprint !== null) {
        state = priorArticle.fingerprint === articleFp ? "DEGISMEDI" : "DEGISMIS_OLABILIR";
        granularity = "madde";
        priorNote = priorArticle.latestNoteDate;
      } else {
        // The article cannot be isolated on one side: the whole law decides,
        // and the row says so.
        state = lawChanged ? "DEGISMIS_OLABILIR" : "DEGISMEDI";
        granularity = "kanun";
        priorNote = comparable.latestNoteDate;
      }
      const noteDate = granularity === "madde" ? articleNote : lawNote;
      if (artKey !== undefined && (writeBaseline || priorArticle === undefined)) {
        nextArticles[artKey] = { fingerprint: articleFp, latestNoteDate: articleNote, recordedAt: checkedAt };
        if (!writeBaseline) articlesAdded += 1;
      }
      const since = comparable?.recordedAt ?? null;
      const ambiguousHeading = isolated !== undefined && isolated.text === undefined;
      let message = comparedMessage(state, granularity, noteDate, priorNote, since, checkedAt, ambiguousHeading);
      if (options.rebaseline === true && comparable !== undefined) message += ` ${REBASELINED_TR}`;
      rows.push(
        rowFor(citation, state, granularity, message, noteDate, state === "TEMEL_KAYDEDILDI" ? checkedAt : since, null),
      );
    }

    if (writeBaseline) {
      baselines[group.lawKey] = {
        lawKey: group.lawKey,
        method: WATCH_FINGERPRINT_METHOD,
        mevzuatId: law.mevzuatId,
        title: law.title,
        rgDate: law.rgDate,
        fingerprint: lawFingerprint,
        latestNoteDate: lawNote,
        recordedAt: checkedAt,
        articles: nextArticles,
      };
      lawCheck.baselineWritten = true;
      if (comparable !== undefined) lawCheck.reason = REBASELINED_TR;
    } else if (articlesAdded > 0) {
      baselines[group.lawKey] = { ...comparable, articles: nextArticles };
      lawCheck.baselineWritten = true;
    }
    lawCheck.stateLabel = WATCH_STATE_LABEL_TR[lawCheck.state];
    laws.push(lawCheck);
  }

  rows.sort((a, b) => Number(a.lawNo) - Number(b.lawNo) || compareKeys(a.key, b.key));
  laws.sort((a, b) => Number(a.lawNo) - Number(b.lawNo) || compareKeys(a.lawKey, b.lawKey));

  const counts = emptyCounts();
  for (const row of rows) counts[row.state] += 1;
  const partial =
    counts.KONTROL_EDILMEDI > 0 || options.collected.unreadSources.length > 0 || options.collected.truncated;

  return {
    result: {
      schema: LEGISLATION_WATCH_SCHEMA,
      matterId: options.matterId,
      checkedAt,
      complete: !partial,
      stopReason,
      lawsTotal: groups.length,
      lawsAsked,
      counts,
      laws,
      rows,
      unreadSources: options.collected.unreadSources,
      citationsTruncated: options.collected.truncated,
      budget: { timeBudgetMs, maxCalls, maxLaws, callsUsed, elapsedMs: Math.max(0, clock() - started) },
      notices: rows.length === 0 ? [WATCH_NO_CITATIONS_TR, ...WATCH_NOTICES] : [...WATCH_NOTICES],
    },
    baselines,
    lastAsked,
  };
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rowFor(
  citation: WatchCitation,
  state: WatchState,
  granularity: "madde" | "kanun",
  message: string,
  latestNoteDate: string | null,
  baselineRecordedAt: string | null,
  reasonCode: WatchReasonCode | null,
): WatchRow {
  return {
    key: citation.key,
    lawKey: citation.lawKey,
    instrument: citation.instrument,
    lawNo: citation.lawNo,
    article: citation.article,
    articleKind: citation.articleKind,
    label: citation.label,
    sources: citation.sources,
    sourcesTotal: citation.sourcesTotal,
    state,
    stateLabel: WATCH_STATE_LABEL_TR[state],
    granularity,
    message,
    latestNoteDate,
    baselineRecordedAt,
    reasonCode,
  };
}

/** The one sentence a compared row carries. Dates only when really read. */
export function comparedMessage(
  state: WatchState,
  granularity: "madde" | "kanun",
  noteDate: string | null,
  priorNote: string | null,
  since: string | null,
  checkedAt: string,
  ambiguousHeading = false,
): string {
  const scope =
    granularity === "madde"
      ? "madde metni"
      : ambiguousHeading
        ? "kanun metni (madde başlığı metinde birden fazla geçtiği için kanunun tamamı karşılaştırıldı)"
        : "kanun metni";
  const note = noteDate !== null ? ` Metindeki en yeni değişiklik notu: ${isoToTr(noteDate)}.` : "";
  const first = isoToTr(since);
  switch (state) {
    case "TEMEL_KAYDEDILDI":
      return (
        `İlk kontrol: kaynaktaki ${scope} ${isoToTr(checkedAt)} tarihinde kaydedildi; ` +
        `sonraki kontroller bununla karşılaştırılır.${note}`
      );
    case "DEGISMEDI":
      return `Değişmedi: ${scope}, bu dosyadaki ilk kontrolden (${first}) bu yana aynı.`;
    case "DEGISMIS_OLABILIR":
      if (noteDate !== null && (priorNote === null || noteDate > priorNote)) {
        return (
          `Değişmiş olabilir: son değişiklik notu tarihi ${isoToTr(noteDate)}, ` +
          `sizin dosyanızdaki ilk kontrol ${first}.`
        );
      }
      return (
        `Değişmiş olabilir: kaynaktaki ${scope}, bu dosyadaki ilk kontrolden (${first}) bu yana farklı; ` +
        `metinde bundan yeni tarihli bir değişiklik notu okunamadı.`
      );
    default:
      return "";
  }
}

export function instrumentLabel(instrument: WatchInstrument): string {
  return INSTRUMENT_LABEL_TR[instrument];
}
