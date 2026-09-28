/**
 * On-machine verification (W23).
 *
 * Three things cannot be measured from the environment ColleX is developed in:
 * the official sources (the development network blocks them), a real language
 * model, and the Mac mini. This module drives the lawyer's OWN running ColleX
 * (`http://127.0.0.1:8787` by default) through the same HTTP API the console
 * uses and writes down, in Turkish, what actually happened on that machine.
 *
 * Rules it keeps:
 *  - It only READS: searches and full-text fetches with `saveToLibrary:false`.
 *    Nothing is written into the lawyer's matters, drafts or answers.
 *  - A failed source is a typed failure with its own kind, never "no result";
 *    "reached, the query matched nothing" and "could not reach" are different
 *    rows (the rule every search screen already follows).
 *  - A fetched full text is re-hashed HERE, independently of the server: the
 *    card's `contentSha256` must equal sha256(text) over UTF-8.
 *  - Sequential, one request at a time, with a pause between sources: court
 *    and legislation share one Bedesten quota.
 *  - Nothing is invented: a count the source did not publish stays null.
 */

import { createHash } from "node:crypto";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** One query per catalog source: ordinary words that source is sure to hold. */
export const VERIFY_QUERIES: Readonly<Record<string, string>> = {
  yargitay: "kira tespiti",
  danistay: "imar planı iptali",
  istinaf_hukuk: "kira tespiti",
  yerel_hukuk: "alacak",
  kyb: "kira",
  emsal: "tapu iptali",
  uyusmazlik: "görev uyuşmazlığı",
  aym: "ifade özgürlüğü",
  mevzuat: "Türk Borçlar Kanunu",
  kanun: "borçlar",
  khk: "personel",
  tuzuk: "tapu",
  kurum_yonetmelik: "yönetmelik",
  teblig: "katma değer vergisi",
  cbk: "teşkilat",
  cb_yonetmelik: "yönetmelik",
  cb_karar: "karar",
  cb_genelge: "genelge",
  kik: "ihale",
  kvkk: "kişisel veri",
  rekabet: "hakim durum",
  sayistay: "harcırah",
  bddk: "kredi",
  btk: "numara taşıma",
  gib: "katma değer vergisi",
  sigorta: "kasko",
};

export type SourceState = "ULASILDI" | "ULASILDI_SONUC_YOK" | "ULASILAMADI" | "DENENMEDI";

export interface SourceCheck {
  sourceId: string;
  label: string;
  query: string;
  state: SourceState;
  rows: number;
  /** The source's own record count; null when it did not publish one. */
  totalRecords: number | null;
  ms: number;
  errorKind?: string;
  message?: string;
  fetch?: FetchCheck;
}

export interface FetchCheck {
  state: "MUHURLENDI" | "MUHUR_TUTMADI" | "GETIRILEMEDI" | "DENENMEDI";
  kind?: string;
  title?: string;
  codePoints?: number;
  ms?: number;
  errorKind?: string;
  message?: string;
}

export interface HealthSnapshot {
  reachable: boolean;
  version?: string;
  platform?: string;
  db?: string;
  mcp?: string;
  ocr?: string;
  localModel?: string;
  cloudConfigured?: boolean;
  message?: string;
}

export interface VerifyReport {
  startedAt: string;
  finishedAt: string;
  base: string;
  health: HealthSnapshot;
  sources: SourceCheck[];
  summary: {
    reached: number;
    reachedNoRows: number;
    unreachable: number;
    notTried: number;
    fetchedSealed: number;
    fetchSealBroken: number;
    fetchFailed: number;
  };
}

export interface VerifyOptions {
  base?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Pause between sources, milliseconds (quota courtesy). */
  pauseMs?: number;
  /** Limit the run to these source ids (default: every catalog source). */
  only?: readonly string[];
  /** Fetch one full text per source that returned a row (default true). */
  fetchFullText?: boolean;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (line: string) => void;
  /**
   * How long to wait while the official-source gateway still reports
   * 'starting' (default 180 s, polled every 5 s). 28.09.2026: run right after
   * a start, every source read ULASILAMADI in a few milliseconds because the
   * gateway was not up yet — a statement about ColleX, not the sources.
   */
  mcpWaitMs?: number;
}

const MCP_POLL_MS = 5_000;

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function callJson(
  fetchImpl: FetchLike,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown>; ms: number }> {
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: asRecord(parsed), ms: Date.now() - started };
}

export async function readHealth(base: string, fetchImpl: FetchLike): Promise<HealthSnapshot> {
  try {
    const { status, body } = await callJson(fetchImpl, `${base}/v1/health`);
    if (status !== 200) {
      return { reachable: false, message: `ColleX sağlık bilgisi alınamadı (HTTP ${status}).` };
    }
    const ocr = asRecord(body["ocr"]);
    const localAi = asRecord(body["localAi"]);
    const ai = asRecord(body["ai"]);
    return {
      reachable: true,
      ...(typeof body["version"] === "string" ? { version: body["version"] } : {}),
      ...(typeof body["platform"] === "string" ? { platform: body["platform"] } : {}),
      ...(typeof body["db"] === "string" ? { db: body["db"] } : {}),
      ...(typeof body["mcp"] === "string" ? { mcp: body["mcp"] } : {}),
      ...(typeof ocr["state"] === "string" ? { ocr: ocr["state"] } : {}),
      ...(typeof localAi["state"] === "string" ? { localModel: localAi["state"] } : {}),
      cloudConfigured: ai["configured"] === true,
    };
  } catch {
    return {
      reachable: false,
      message:
        "ColleX'e bağlanılamadı. Önce ColleX'i başlatın (masaüstündeki ColleX simgesi), sonra bu denetimi yeniden çalıştırın.",
    };
  }
}

interface CatalogSource {
  id: string;
  ad: string;
}

export async function readCatalog(base: string, fetchImpl: FetchLike): Promise<CatalogSource[]> {
  const { status, body } = await callJson(fetchImpl, `${base}/v1/sources/catalog`);
  if (status !== 200 || !Array.isArray(body["kaynaklar"])) return [];
  return (body["kaynaklar"] as unknown[])
    .map(asRecord)
    .filter((s) => typeof s["id"] === "string")
    .map((s) => ({ id: String(s["id"]), ad: typeof s["ad"] === "string" ? String(s["ad"]) : String(s["id"]) }));
}

export async function checkFullText(
  base: string,
  fetchImpl: FetchLike,
  row: Record<string, unknown>,
): Promise<FetchCheck> {
  const kind = typeof row["fetchKind"] === "string" ? row["fetchKind"] : undefined;
  const externalId = typeof row["externalId"] === "string" ? row["externalId"] : "";
  if (kind === undefined || externalId === "") {
    return { state: "DENENMEDI", message: "Bu satır tam metin getirmeye uygun değil (kaynak kimliği yok)." };
  }
  try {
    const { status, body, ms } = await callJson(fetchImpl, `${base}/v1/sources/fetch`, {
      kind,
      externalId,
      saveToLibrary: false,
    });
    if (status !== 200) {
      const error = asRecord(body["error"]);
      return {
        state: "GETIRILEMEDI",
        kind,
        ms,
        ...(typeof error["kind"] === "string" ? { errorKind: error["kind"] } : {}),
        ...(typeof error["message"] === "string" ? { message: error["message"] } : {}),
      };
    }
    const card = asRecord(body["card"]);
    const text = typeof body["text"] === "string" ? body["text"] : "";
    const sealed = typeof card["contentSha256"] === "string" && card["contentSha256"] === sha256Utf8(text);
    return {
      state: sealed && text.length > 0 ? "MUHURLENDI" : "MUHUR_TUTMADI",
      kind,
      ms,
      codePoints: codePoints(text),
      ...(typeof card["title"] === "string" ? { title: card["title"].slice(0, 160) } : {}),
      ...(sealed ? {} : { message: "Getirilen metnin parmak izi kartın parmak iziyle uyuşmadı." }),
    };
  } catch {
    return { state: "GETIRILEMEDI", kind, message: "ColleX bu isteğe cevap vermedi." };
  }
}

export async function checkSource(
  base: string,
  fetchImpl: FetchLike,
  source: CatalogSource,
  fetchFullText: boolean,
): Promise<SourceCheck> {
  const query = VERIFY_QUERIES[source.id] ?? "karar";
  const base0: SourceCheck = {
    sourceId: source.id,
    label: source.ad,
    query,
    state: "DENENMEDI",
    rows: 0,
    totalRecords: null,
    ms: 0,
  };
  let result;
  try {
    result = await callJson(fetchImpl, `${base}/v1/sources/search`, {
      query,
      sources: [source.id],
      limit: 3,
    });
  } catch {
    return { ...base0, state: "ULASILAMADI", message: "ColleX bu isteğe cevap vermedi." };
  }
  const { status, body, ms } = result;
  const trace = Array.isArray(body["trace"]) ? (body["trace"] as unknown[]).map(asRecord) : [];
  const traceRow = trace.find((t) => t["sourceId"] === source.id) ?? {};
  const total = typeof traceRow["totalRecords"] === "number" ? (traceRow["totalRecords"] as number) : null;
  if (status !== 200) {
    const error = asRecord(body["error"]);
    const failed = Array.isArray(error["failedSources"]) ? (error["failedSources"] as unknown[]).map(asRecord) : [];
    const mine = failed.find((f) => f["sourceId"] === source.id) ?? {};
    const errorKind =
      typeof mine["kind"] === "string" ? mine["kind"] : typeof error["kind"] === "string" ? error["kind"] : undefined;
    const message =
      typeof mine["message"] === "string"
        ? mine["message"]
        : typeof error["message"] === "string"
          ? error["message"]
          : undefined;
    return {
      ...base0,
      state: "ULASILAMADI",
      ms,
      totalRecords: null,
      ...(errorKind !== undefined ? { errorKind: String(errorKind) } : {}),
      ...(message !== undefined ? { message: String(message) } : {}),
    };
  }
  const rows = Array.isArray(body["rows"]) ? (body["rows"] as unknown[]).map(asRecord) : [];
  const failedSources = Array.isArray(body["failedSources"]) ? (body["failedSources"] as unknown[]).map(asRecord) : [];
  const failedMine = failedSources.find((f) => f["sourceId"] === source.id);
  if (failedMine !== undefined) {
    return {
      ...base0,
      state: "ULASILAMADI",
      ms,
      ...(typeof failedMine["kind"] === "string" ? { errorKind: failedMine["kind"] } : {}),
      ...(typeof failedMine["message"] === "string" ? { message: failedMine["message"] } : {}),
    };
  }
  const check: SourceCheck = {
    ...base0,
    state: rows.length > 0 ? "ULASILDI" : "ULASILDI_SONUC_YOK",
    rows: rows.length,
    totalRecords: total,
    ms,
  };
  if (fetchFullText && rows.length > 0) {
    const fetchable = rows.find((r) => typeof r["fetchKind"] === "string") ?? rows[0]!;
    check.fetch = await checkFullText(base, fetchImpl, fetchable);
  }
  return check;
}

export async function runVerification(options: VerifyOptions = {}): Promise<VerifyReport> {
  const base = (options.base ?? "http://127.0.0.1:8787").replace(/\/+$/u, "");
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pauseMs = options.pauseMs ?? 1500;
  const say = options.onProgress ?? (() => undefined);
  const startedAt = now().toISOString();

  let health = await readHealth(base, fetchImpl);
  const polls = Math.ceil((options.mcpWaitMs ?? 180_000) / MCP_POLL_MS);
  for (let i = 0; health.reachable && health.mcp === "starting" && i < polls; i += 1) {
    if (i === 0) say("Resmî kaynak bağlantı bileşeni hâlâ açılıyor; hazır olması bekleniyor (en fazla 3 dakika)…");
    await sleep(MCP_POLL_MS);
    health = await readHealth(base, fetchImpl);
  }
  const sources: SourceCheck[] = [];
  if (health.reachable) {
    const catalog = await readCatalog(base, fetchImpl);
    const wanted = options.only !== undefined ? new Set(options.only) : null;
    const list = wanted === null ? catalog : catalog.filter((s) => wanted.has(s.id));
    for (let i = 0; i < list.length; i += 1) {
      const source = list[i]!;
      say(`(${i + 1}/${list.length}) ${source.ad} deneniyor…`);
      sources.push(await checkSource(base, fetchImpl, source, options.fetchFullText !== false));
      if (i + 1 < list.length && pauseMs > 0) await sleep(pauseMs);
    }
  }
  const summary = {
    reached: sources.filter((s) => s.state === "ULASILDI").length,
    reachedNoRows: sources.filter((s) => s.state === "ULASILDI_SONUC_YOK").length,
    unreachable: sources.filter((s) => s.state === "ULASILAMADI").length,
    notTried: sources.filter((s) => s.state === "DENENMEDI").length,
    fetchedSealed: sources.filter((s) => s.fetch?.state === "MUHURLENDI").length,
    fetchSealBroken: sources.filter((s) => s.fetch?.state === "MUHUR_TUTMADI").length,
    fetchFailed: sources.filter((s) => s.fetch?.state === "GETIRILEMEDI").length,
  };
  return { startedAt, finishedAt: now().toISOString(), base, health, sources, summary };
}

const STATE_TR: Record<SourceState, string> = {
  ULASILDI: "ulaşıldı, sonuç geldi",
  ULASILDI_SONUC_YOK: "ulaşıldı, bu sorguya sonuç yok",
  ULASILAMADI: "ULAŞILAMADI",
  DENENMEDI: "denenmedi",
};

const FETCH_TR: Record<FetchCheck["state"], string> = {
  MUHURLENDI: "tam metin getirildi ve parmak izi doğrulandı",
  MUHUR_TUTMADI: "tam metin getirildi ama parmak izi TUTMADI",
  GETIRILEMEDI: "tam metin GETİRİLEMEDİ",
  DENENMEDI: "tam metin denenmedi",
};

function cell(text: string): string {
  return text.replace(/\|/gu, "/").replace(/\s+/gu, " ").trim();
}

/** The Turkish report the lawyer keeps (and may send back). */
export function renderReportTr(report: VerifyReport, extras: readonly string[] = []): string {
  const lines: string[] = [];
  lines.push("# ColleX — bu bilgisayarda doğrulama raporu", "");
  lines.push(`Başladı: ${report.startedAt} · Bitti: ${report.finishedAt} · Adres: ${report.base}`, "");
  const h = report.health;
  if (!h.reachable) {
    lines.push("**ColleX çalışmıyor.** " + (h.message ?? ""), "");
  } else {
    lines.push("## Sistem", "");
    lines.push(`- Sürüm: ${h.version ?? "bilinmiyor"} · işletim sistemi: ${h.platform ?? "bilinmiyor"}`);
    lines.push(`- Kendi kayıtlarım (veritabanı): ${h.db ?? "bilinmiyor"}`);
    lines.push(`- Resmî kaynak bağlantı bileşeni: ${h.mcp ?? "bilinmiyor"}`);
    lines.push(`- Taranmış belge okuma (OCR): ${h.ocr ?? "bilinmiyor"}`);
    lines.push(`- Yerel yapay zekâ modeli: ${h.localModel ?? "bilinmiyor"}`);
    lines.push(`- Bulut yapay zekâ anahtarı: ${h.cloudConfigured === true ? "ayarlı" : "ayarlı değil"}`, "");
    if (h.mcp !== undefined && h.mcp !== "ok") {
      lines.push(
        `**Resmî kaynak bağlantı bileşeni açık değildi (${h.mcp}).** Aşağıdaki ULAŞILAMADI satırları bu yüzdendir: ` +
          "kaynakların değil, ColleX'in bağlantı bileşeninin durumunu gösterir. \"ColleX Sunucu\" penceresindeki " +
          "[serve-mcp] satırlarına bakın; ColleX'i yeniden başlatıp bu denetimi tekrar çalıştırın.",
        "",
      );
    }
    const s = report.summary;
    lines.push("## Resmî kaynaklar — özet", "");
    lines.push(
      `${report.sources.length} kaynak denendi: ${s.reached} kaynağa ulaşıldı ve sonuç geldi, ` +
        `${s.reachedNoRows} kaynağa ulaşıldı ama bu sorguya sonuç yoktu, ${s.unreachable} kaynağa ULAŞILAMADI.`,
    );
    lines.push(
      `Tam metin: ${s.fetchedSealed} belge getirildi ve parmak izi bu raporda yeniden hesaplanıp doğrulandı; ` +
        `${s.fetchSealBroken} belgede parmak izi tutmadı; ${s.fetchFailed} belge getirilemedi.`,
      "",
    );
    lines.push(
      "Bu rapor ERİŞİMİ ölçer: kaynağa ulaşılıp ulaşılmadığını ve getirilen metnin bozulmadan geldiğini. " +
        "Sonuçların isabetini ölçmez.",
      "",
    );
    lines.push("## Kaynak kaynak", "");
    lines.push("| Kaynak | Sorgu | Durum | Satır | Kaynağın bildirdiği toplam | Tam metin | Süre |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const c of report.sources) {
      const total = c.totalRecords === null ? "bildirmedi" : String(c.totalRecords);
      const fetch =
        c.fetch === undefined
          ? "—"
          : `${FETCH_TR[c.fetch.state]}${c.fetch.codePoints !== undefined ? ` (${c.fetch.codePoints} karakter)` : ""}` +
            `${c.fetch.errorKind !== undefined ? ` (${c.fetch.errorKind})` : ""}`;
      const state = `${STATE_TR[c.state]}${c.errorKind !== undefined ? ` (${c.errorKind})` : ""}`;
      lines.push(`| ${cell(c.label)} | ${cell(c.query)} | ${cell(state)} | ${c.rows} | ${total} | ${cell(fetch)} | ${c.ms} ms |`);
    }
    lines.push("");
    const failures = report.sources.filter((c) => c.message !== undefined || c.fetch?.message !== undefined);
    if (failures.length > 0) {
      lines.push("## Kaynakların kendi hata cümleleri", "");
      for (const c of failures) {
        if (c.message !== undefined) lines.push(`- ${c.label}: ${cell(c.message)}`);
        if (c.fetch?.message !== undefined) lines.push(`- ${c.label} (tam metin): ${cell(c.fetch.message)}`);
      }
      lines.push("");
    }
  }
  for (const block of extras) lines.push(block, "");
  return lines.join("\n");
}
