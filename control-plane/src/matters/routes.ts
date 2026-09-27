/**
 * Matters HTTP sub-router (W12-A, contract [M]) — mounted at "/" by the
 * integration lane.
 *
 *   GET    /v1/matters?status=&q=                 { matters: MatterSummary[] }
 *   GET    /v1/matters/deadlines?until=YYYY-MM-DD { deadlines: (MatterItem & {matterTitle})[], today }
 *   POST   /v1/matters                            201 Matter
 *   GET    /v1/matters/{id}                       { matter, items: { files, answers, drafts, notes, events, deadlines } }
 *   PATCH  /v1/matters/{id}                       200 Matter
 *   DELETE /v1/matters/{id}                       204 (files themselves are NOT deleted)
 *   POST   /v1/matters/{id}/items                 201 MatterItem
 *   PATCH  /v1/matters/{id}/items/{itemId}        200 MatterItem (payload: shallow merge)
 *   DELETE /v1/matters/{id}/items/{itemId}        204
 *
 * Error contract: 400 INVALID_REQUEST (Turkish message + issues[]),
 * 404 MATTER_NOT_FOUND / ITEM_NOT_FOUND, 503 STORE_UNAVAILABLE when the
 * store throws (local PostgreSQL down). Machine codes stay English
 * UPPER_SNAKE; every message is lawyer Turkish.
 *
 * Cross-store behaviour:
 *   - adding an `answer` item (refId = runId) files the answer under the
 *     matter through `answers.attach?.(runId, matterId)`; removing it, or
 *     deleting the matter, detaches (`attach(runId, null)`);
 *   - GET /v1/matters/{id} MERGES live summaries into item payloads when the
 *     answer / draft stores can provide them (stored payload first, live
 *     fields override) — the stored payload is the denormalized fallback
 *     that survives a cache miss. An answer asked over uploads also carries
 *     `fileScope` (W12-API2) so the console can label it "Belge".
 *
 * Event `source` (W12-API2): `manual`, `belge:<fileId>` (a date found by the
 * heuristic analysis of an upload, no chunk identity) or
 * `belge:<fileId>:<chunkId>` (traceable to one chunk).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { summarizeStoredAnswer, type AnswerStore } from "../api/answerService.js";
import { fieldIssues } from "../api/zodIssues.js";
import { HEARING_DEFAULT_MINUTES, buildIcs, hearingSummary, type IcsEvent } from "./ics.js";
import { encodeRfc8187 } from "../drafting/routes.js";
import { ContactService, createContactsRouter, type ContactStore } from "./contactsRoutes.js";
import { HEARING_SCHEMA_MESSAGE_TR, ItemKindUnsupportedError, isUuid } from "./store.js";
import { createRecordsRouter, type DraftAdminPort } from "./recordsRoutes.js";
import {
  HEARING_KINDS,
  HEARING_KIND_LABELS,
  HEARING_STATUSES,
  HHMM_RE,
  ISO_DATE_RE,
  MATTER_ITEM_KINDS,
  MATTER_KINDS,
  MATTER_STATUSES,
  MAX_BATCH_ITEMS,
  daysBetweenIso,
  describeItem,
  groupItems,
  todayIso,
  trimToWordBoundary,
  type ActivityEntry,
  type DeadlineRow,
  type HearingKind,
  type MatterItem,
  type MatterItemKind,
  type MatterStore,
} from "./types.js";

/** Structural slice of lane C's DraftStore.list (no import across lanes). */
export interface DraftListPort {
  /** `q` (W14 B-29/B-26) filters on the draft title; ignored by older stores. */
  list?(opts: { matterId?: string; limit?: number; q?: string }): Promise<
    Array<{
      draftId: string;
      version: number;
      template: string;
      title: string;
      unsupportedCount: number;
      createdAt: string;
      matterId?: string | null;
      /** Additive (W14 B-26): when the latest version was written. */
      updatedAt?: string;
    }>
  >;
  /**
   * W12-FIX: DELETE /v1/matters/{id} tells the draft store the matter is
   * gone, so the drafts it held become dosyasız instead of unpersistable
   * (drafts_matter_id_fkey refused every later version — data loss on
   * restart, reviewed 02.09.2026).
   */
  detachMatter?(matterId: string): Promise<void>;
}

/**
 * W14 (B-29): the document-CONTENT half of the general search. Satisfied
 * structurally by `PostgresFilesStore.searchChunks` (src/files/store.ts), so
 * the matters router never imports the files lane's classes. When it is not
 * wired the search still answers, with `documentsSearched:false` — an honest
 * "this half is not connected here", never a silently empty group.
 */
export interface DocumentSearchPort {
  searchChunks?(
    q: string,
    opts?: { limit?: number; tenantId?: string },
  ): Promise<
    Array<{
      fileId: string;
      fileName: string;
      chunkId: string;
      ordinal: number;
      snippet: string;
      startChar: number;
      endChar: number;
    }>
  >;
}

export interface MattersRouterDeps {
  store: MatterStore;
  answers?: AnswerStore;
  drafts?: DraftListPort & DraftAdminPort;
  /** W14 (B-42): contact cards; absent = the /v1/contacts lane is not mounted. */
  contacts?: ContactStore;
  /** W14 (B-29): document body search (the files store satisfies it). */
  documents?: DocumentSearchPort;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Validation (zod, Turkish messages)
// ---------------------------------------------------------------------------

const REQ = { required_error: "Bu alan zorunludur.", invalid_type_error: "Geçersiz değer." };

const isoDate = z
  .string(REQ)
  .regex(ISO_DATE_RE, "Tarih ISO biçiminde olmalı (YYYY-AA-GG, örn. 2026-09-16).");

const shortText = (max: number) => z.string(REQ).max(max, `En fazla ${max} karakter.`);

const kindEnum = z.enum(MATTER_KINDS, {
  errorMap: () => ({ message: "Tür: dava, danismanlik, sozlesme, icra veya diger olmalı." }),
});
const statusEnum = z.enum(MATTER_STATUSES, {
  errorMap: () => ({ message: "Durum: acik, beklemede veya kapali olmalı." }),
});

export const newMatterSchema = z
  .object({
    title: z.string(REQ).trim().min(1, "Başlık boş bırakılamaz.").max(300, "En fazla 300 karakter."),
    client: shortText(300).optional(),
    opposing: shortText(300).optional(),
    court: shortText(300).optional(),
    docketNo: shortText(100).optional(),
    kind: kindEnum.optional(),
    status: statusEnum.optional(),
    notes: shortText(20_000).optional(),
  })
  .strict("Tanınmayan alan.");

export const matterPatchSchema = newMatterSchema.partial().strict("Tanınmayan alan.");

const refIdSchema = z.string(REQ).min(1, "Referans boş olamaz.").max(200, "En fazla 200 karakter.");

/** Per-kind payload conventions (contract [M]); unknown keys are kept. */
const payloadSchemas: Record<MatterItemKind, z.ZodTypeAny> = {
  file: z.object({ fileName: shortText(300).default("") }).passthrough(),
  answer: z
    .object({
      question: shortText(2000).default(""),
      status: shortText(50).default(""),
      mode: z.enum(["local", "live"]).default("local"),
    })
    .passthrough(),
  draft: z
    .object({
      title: shortText(300).default(""),
      template: shortText(100).default(""),
      version: z.number(REQ).int().min(1).default(1),
    })
    .passthrough(),
  note: z
    .object({
      text: z.string(REQ).min(1, "Not metni boş bırakılamaz.").max(20_000, "En fazla 20.000 karakter."),
      source: z
        .string(REQ)
        .regex(/^(manual|ai|belge:[^\s:]{1,200})$/u, "Kaynak: manual, ai veya belge:<dosya kimliği> olmalı.")
        .default("manual"),
    })
    .passthrough(),
  event: z
    .object({
      date: isoDate,
      title: z.string(REQ).min(1, "Olay başlığı boş bırakılamaz.").max(500, "En fazla 500 karakter."),
      // Three accepted forms (W12-API2 widened the second): `manual`;
      // `belge:<fileId>` — a date the intake's heuristic analysis found in
      // an uploaded document, with no chunk identity (the console writes
      // this from the Belge page); `belge:<fileId>:<chunkId>` — a date
      // traceable to one chunk. Any other segment count is refused.
      source: z
        .string(REQ)
        .regex(
          /^(manual|belge:[^\s:]{1,200}(?::[^\s:]{1,200})?)$/u,
          "Kaynak: manual, belge:<dosya kimliği> veya belge:<dosya kimliği>:<parça kimliği> olmalı.",
        )
        .default("manual"),
      verified: z.boolean(REQ).default(false),
    })
    .passthrough(),
  deadline: z
    .object({
      title: z.string(REQ).min(1, "Süre başlığı boş bırakılamaz.").max(500, "En fazla 500 karakter."),
      dueDate: isoDate,
      ruleId: shortText(100).optional(),
      startDate: isoDate.optional(),
      computed: z.record(z.unknown()).optional(),
      status: z
        .enum(["acik", "tamam"], { errorMap: () => ({ message: "Durum: acik veya tamam olmalı." }) })
        .default("acik"),
      source: z
        .enum(["manual", "hesap"], { errorMap: () => ({ message: "Kaynak: manual veya hesap olmalı." }) })
        .default("manual"),
    })
    .passthrough(),
  // W14 (B-17): the litigator's most critical calendar object. Same shape
  // discipline as `deadline`: an ISO date on the wire, a Turkish label in the
  // console, and a status that decides whether it is still "next".
  hearing: z
    .object({
      date: isoDate,
      time: z
        .string(REQ)
        .regex(HHMM_RE, "Saat SS:DD biçiminde olmalı (örn. 09:30).")
        .default("09:00"),
      court: shortText(300).default(""),
      salon: shortText(100).default(""),
      kind: z
        .enum(HEARING_KINDS, {
          errorMap: () => ({ message: "Duruşma türü: durusma, kesif veya e-durusma olmalı." }),
        })
        .default("durusma"),
      title: shortText(300).optional(),
      note: shortText(5000).default(""),
      status: z
        .enum(HEARING_STATUSES, {
          errorMap: () => ({ message: "Durum: planlandi, yapildi veya ertelendi olmalı." }),
        })
        .default("planlandi"),
    })
    .passthrough(),
};

const newItemEnvelope = z
  .object({
    kind: z.enum(MATTER_ITEM_KINDS, {
      errorMap: () => ({ message: "Kayıt türü: file, answer, draft, note, event veya deadline olmalı." }),
    }),
    refId: refIdSchema.nullable().optional(),
    payload: z.record(z.unknown()).optional(),
  })
  .strict("Tanınmayan alan.");

const itemPatchEnvelope = z
  .object({
    refId: refIdSchema.nullable().optional(),
    payload: z.record(z.unknown()).optional(),
  })
  .strict("Tanınmayan alan.");

/** W14 (B-18): the batch body — at most 50 records in one approval. */
const batchEnvelope = z
  .object({
    items: z
      .array(newItemEnvelope)
      .min(1, "En az bir kayıt gönderilmeli.")
      .max(MAX_BATCH_ITEMS, `Tek istekte en fazla ${MAX_BATCH_ITEMS} kayıt gönderilebilir.`),
  })
  .strict("Tanınmayan alan.");

/**
 * Identity of a record for duplicate suppression (W14 B-18): the reference
 * when there is one, otherwise the kind plus the fields that make a timeline
 * entry the same entry (date + title / text). Pressing "transfer every date"
 * twice must not double the chronology.
 */
export function dedupeKey(item: {
  kind: MatterItemKind;
  refId?: string | null;
  payload: Record<string, unknown>;
}): string {
  if (item.refId !== undefined && item.refId !== null && item.refId !== "") {
    return `${item.kind} ref ${item.refId}`;
  }
  const value = (key: string): string =>
    typeof item.payload[key] === "string" ? String(item.payload[key]).trim() : "";
  const parts = [
    value("date") || value("dueDate"),
    value("title") || value("text"),
    value("time"),
  ];
  return `${item.kind} ${parts.join(" ")}`;
}

/** Fallback for a store without `addItems`: one call per record, in order. */
async function sequentialAdd(
  store: MatterStore,
  matterId: string,
  inputs: readonly NewMatterItemInput[],
): Promise<MatterItem[] | undefined> {
  const created: MatterItem[] = [];
  for (const input of inputs) {
    const item = await store.addItem(matterId, input);
    if (item === undefined) return undefined;
    created.push(item);
  }
  return created;
}

type NewMatterItemInput = {
  kind: MatterItemKind;
  refId?: string | null;
  payload: Record<string, unknown>;
};

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  q: z.string().max(200, "Arama en fazla 200 karakter.").optional(),
});

/**
 * W14 (B-26) — "sessizce yok sayma" biter.
 *
 * A query parameter this route does not implement is a 400, never a silent
 * pass-through: the worst failure mode measured by DAILYFLOW was `?q=` and
 * `?status=` being ignored while the console believed it had filtered. The
 * lawyer sees which parameter was refused and which ones exist.
 */
export const UNKNOWN_QUERY_MESSAGE_TR = "Tanınmayan sorgu parametresi.";

export function unknownQueryIssues(
  url: string,
  allowed: readonly string[],
): Array<{ path: string; message: string }> {
  const params = new URL(url, "http://127.0.0.1").searchParams;
  const issues: Array<{ path: string; message: string }> = [];
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (allowed.includes(key) || seen.has(key)) continue;
    seen.add(key);
    issues.push({
      path: key,
      message: `${UNKNOWN_QUERY_MESSAGE_TR} Kullanılabilir: ${allowed.join(", ")}.`,
    });
  }
  return issues;
}

/** Default window of GET /v1/matters/deadlines when `until` is not given. */
export const DEADLINE_WINDOW_DAYS = 30;

/** Add whole days to an ISO date (UTC civil arithmetic, no clock). */
export function addIsoDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Drop the `computed` block from a deadline payload (W14 B-26): four
 * deadlines shipped 9 965 bytes of computation detail the panel never shows.
 * `?include=computed` puts it back for the screen that does show it.
 */
export function withoutComputed(row: DeadlineRow): DeadlineRow {
  if (row.payload["computed"] === undefined) return row;
  const { computed: _dropped, ...rest } = row.payload;
  return { ...row, payload: rest };
}

/** Residual zod default messages, translated (dictionary rule: lawyer Turkish). */
function turkishZodMessage(message: string): string {
  if (message === "Required") return "Bu alan zorunludur.";
  if (message === "Invalid input") return "Geçersiz değer.";
  if (message.startsWith("Invalid enum value")) return "Geçersiz seçim.";
  if (message.startsWith("Expected ")) return "Geçersiz değer türü.";
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  return message;
}

/**
 * V-19: an unrecognized key used to arrive with an EMPTY path, because zod
 * reports it at the parent object. `fieldIssues` names the key itself.
 */
function issuesOf(error: z.ZodError, prefix = ""): Array<{ path: string; message: string }> {
  return fieldIssues(error, turkishZodMessage, prefix);
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const invalid = (c: Context, message: string, issues: Array<{ path: string; message: string }> = []) =>
  c.json({ error: { kind: "INVALID_REQUEST", message, issues } }, 400);

/**
 * Cap on one item payload as stored (jsonb), in UTF-8 bytes (W12-FIX2,
 * P2-13). Notes, events and deadlines are short by nature; a 64 KiB payload
 * is not a matter record, it is a document — which belongs in /v1/files.
 */
export const MAX_ITEM_PAYLOAD_BYTES = 64 * 1024;
export const ITEM_PAYLOAD_TOO_LARGE_MESSAGE_TR =
  "Dosya kaydı çok büyük: bir kaydın içeriği en fazla 64 KB olabilir; uzun metinleri belge olarak yükleyin.";

const payloadTooLarge = (c: Context) =>
  c.json({ error: { kind: "PAYLOAD_TOO_LARGE", message: ITEM_PAYLOAD_TOO_LARGE_MESSAGE_TR } }, 413);

function payloadOversized(payload: Record<string, unknown>): boolean {
  return Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_ITEM_PAYLOAD_BYTES;
}

/**
 * W12-FIX2 (P2-19): the reference of a file / answer / draft item IS the
 * record's identity (the answer store is attached by it); changing it in
 * place would leave the old answer filed and the new one not. The safer
 * contract: refuse, and let the lawyer remove and re-add the record.
 */
export const REF_ID_IMMUTABLE_MESSAGE_TR =
  "Belge, cevap ve taslak kayıtlarının referansı değiştirilemez; kaydı çıkarıp yeniden ekleyin.";

const matterNotFound = (c: Context) =>
  c.json({ error: { kind: "MATTER_NOT_FOUND", message: "Dava dosyası bulunamadı." } }, 404);

const itemNotFound = (c: Context) =>
  c.json({ error: { kind: "ITEM_NOT_FOUND", message: "Dosya kaydı bulunamadı." } }, 404);

const storeUnavailable = (c: Context) =>
  c.json(
    {
      error: {
        kind: "STORE_UNAVAILABLE",
        message: "Yerel veritabanına ulaşılamadı; dava dosyaları şu an açılamıyor.",
      },
    },
    503,
  );

async function readJson(c: Context): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false, response: invalid(c, "İstek gövdesi JSON olmalı.") };
  }
}

/** Validate an item payload for its kind; returns the normalized payload. */
export function validateItemPayload(
  kind: MatterItemKind,
  payload: Record<string, unknown>,
): { ok: true; payload: Record<string, unknown> } | { ok: false; issues: Array<{ path: string; message: string }> } {
  const parsed = payloadSchemas[kind].safeParse(payload);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error, "payload.") };
  return { ok: true, payload: parsed.data as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createMattersRouter(deps: MattersRouterDeps): Hono {
  const app = new Hono();
  const { store, answers, drafts } = deps;
  const now = deps.now ?? (() => new Date());

  /** Run a store call; a throwing store is a typed 503, never a stack trace. */
  const guarded = async <T>(
    c: Context,
    work: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; response: Response }> => {
    try {
      return { ok: true, value: await work() };
    } catch {
      return { ok: false, response: storeUnavailable(c) };
    }
  };

  const detachAnswer = async (item: MatterItem): Promise<void> => {
    if (item.kind !== "answer" || item.refId === null || answers?.attach === undefined) return;
    try {
      await answers.attach(item.refId, null);
    } catch {
      // Detaching is best-effort bookkeeping on another store; the item
      // itself is already gone.
    }
  };

  /** Stored payload + live summary from the answer/draft stores (live wins). */
  const enrich = async (matterId: string, items: MatterItem[]): Promise<MatterItem[]> => {
    let draftIndex = new Map<string, Record<string, unknown>>();
    if (drafts?.list !== undefined && items.some((i) => i.kind === "draft")) {
      try {
        const rows = await drafts.list({ matterId, limit: 200 });
        draftIndex = new Map(
          rows.map((d) => [
            d.draftId,
            {
              title: d.title,
              template: d.template,
              version: d.version,
              unsupportedCount: d.unsupportedCount,
              createdAt: d.createdAt,
            },
          ]),
        );
      } catch {
        draftIndex = new Map();
      }
    }
    const out: MatterItem[] = [];
    for (const item of items) {
      if (item.kind === "answer" && item.refId !== null && answers !== undefined) {
        try {
          await answers.warm?.(item.refId);
        } catch {
          // A cold store is not an error for the matter page.
        }
        const stored = answers.get(item.refId);
        if (stored !== undefined) {
          const s = summarizeStoredAnswer(stored);
          out.push({
            ...item,
            payload: {
              ...item.payload,
              question: s.question,
              status: s.status,
              mode: s.mode,
              evidenceCount: s.evidenceCount,
              finalizable: s.finalizable,
              answeredAt: s.createdAt,
              // W12-API2: lets the console label a file-scoped answer
              // "Belge" instead of "Yerel" on the matter page.
              ...(s.fileScope !== undefined ? { fileScope: s.fileScope } : {}),
            },
          });
          continue;
        }
      }
      if (item.kind === "draft" && item.refId !== null) {
        const live = draftIndex.get(item.refId);
        if (live !== undefined) {
          out.push({ ...item, payload: { ...item.payload, ...live } });
          continue;
        }
      }
      out.push(item);
    }
    return out;
  };

  const today = (): string => todayIso(now());

  app.get("/v1/matters", async (c) => {
    const unknown = unknownQueryIssues(c.req.url, ["status", "q"]);
    if (unknown.length > 0) return invalid(c, "Liste filtresi doğrulanamadı.", unknown);
    const query = listQuerySchema.safeParse({
      ...(c.req.query("status") !== undefined ? { status: c.req.query("status") } : {}),
      ...(c.req.query("q") !== undefined ? { q: c.req.query("q") } : {}),
    });
    if (!query.success) return invalid(c, "Liste filtresi doğrulanamadı.", issuesOf(query.error));
    const result = await guarded(c, () => store.list({ ...query.data, today: today() }));
    if (!result.ok) return result.response;
    return c.json({ matters: result.value }, 200);
  });

  /**
   * Load the calendar window (deadlines + hearings) shared by the JSON panel,
   * the calendar view and the .ics feed.
   */
  const loadCalendar = async (
    range: { from?: string; until?: string },
    matterId?: string,
  ): Promise<{ deadlines: DeadlineRow[]; hearings: DeadlineRow[] }> => {
    const [deadlines, hearings] = await Promise.all([
      store.listDeadlines(range),
      store.listHearings === undefined ? Promise.resolve([]) : store.listHearings(range),
    ]);
    const mine = (rows: DeadlineRow[]): DeadlineRow[] =>
      matterId === undefined ? rows : rows.filter((r) => r.matterId === matterId);
    return { deadlines: mine(deadlines), hearings: mine(hearings) };
  };

  /** One .ics response for a deadline+hearing window. */
  const icsResponse = (
    c: Context,
    rows: { deadlines: DeadlineRow[]; hearings: DeadlineRow[] },
    calendarName: string,
    fileName: string,
  ): Response => {
    const events: IcsEvent[] = [];
    for (const row of rows.deadlines) {
      const title = typeof row.payload["title"] === "string" ? row.payload["title"] : "Süre";
      events.push({
        uid: `${row.itemId}@collex.local`,
        kind: "deadline",
        date: String(row.payload["dueDate"]),
        summary: `Süre: ${title} — ${row.matterTitle}`,
        description: `Dosya: ${row.matterTitle}`,
        alarmDaysBefore: 7,
      });
    }
    for (const row of rows.hearings) {
      const kindRaw = typeof row.payload["kind"] === "string" ? row.payload["kind"] : "durusma";
      const kind: HearingKind = (HEARING_KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as HearingKind)
        : "durusma";
      const court = typeof row.payload["court"] === "string" ? row.payload["court"] : "";
      const salon = typeof row.payload["salon"] === "string" ? row.payload["salon"] : "";
      const note = typeof row.payload["note"] === "string" ? row.payload["note"] : "";
      const title = typeof row.payload["title"] === "string" ? row.payload["title"] : "";
      // 27.09.2026: a postponed hearing used to be emitted STATUS:CONFIRMED
      // on its old date. It is now CANCELLED there, and says so.
      const postponed = row.payload["status"] === "ertelendi";
      events.push({
        uid: `${row.itemId}@collex.local`,
        kind: "hearing",
        date: String(row.payload["date"]),
        time: typeof row.payload["time"] === "string" ? row.payload["time"] : "09:00",
        summary: hearingSummary(row.matterTitle, kind, court, { title, postponed }),
        ...(postponed ? { status: "CANCELLED" as const } : {}),
        description: [`Dosya: ${row.matterTitle}`, salon === "" ? "" : `Salon: ${salon}`, note]
          .filter((p) => p !== "")
          .join("\n"),
        location: [court, salon].filter((p) => p !== "").join(" / "),
        alarmDaysBefore: 1,
      });
    }
    const body = buildIcs(events, { calendarName, dtstamp: now() });
    return c.body(body, 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeRfc8187(fileName)}`,
      "cache-control": "no-store",
    });
  };

  // Registered BEFORE /v1/matters/:id so the literal segment wins.
  app.get("/v1/matters/deadlines", async (c) => {
    const unknown = unknownQueryIssues(c.req.url, ["until", "from", "include", "format"]);
    if (unknown.length > 0) return invalid(c, "Süre filtresi doğrulanamadı.", unknown);
    const until = c.req.query("until");
    const from = c.req.query("from");
    const include = c.req.query("include");
    const format = c.req.query("format");
    const issues: Array<{ path: string; message: string }> = [];
    const dateMessage = "Tarih ISO biçiminde olmalı (YYYY-AA-GG, örn. 2026-09-16).";
    if (until !== undefined && !ISO_DATE_RE.test(until)) issues.push({ path: "until", message: dateMessage });
    if (from !== undefined && !ISO_DATE_RE.test(from)) issues.push({ path: "from", message: dateMessage });
    if (include !== undefined && include !== "computed") {
      issues.push({ path: "include", message: "include yalnız 'computed' olabilir." });
    }
    if (format !== undefined && format !== "ics" && format !== "json") {
      issues.push({ path: "format", message: "format 'json' veya 'ics' olmalı." });
    }
    if (issues.length > 0) return invalid(c, "Süre filtresi doğrulanamadı.", issues);

    const day = today();
    // W14 (B-26): the panel shows the next month. Without a default `until`
    // every deadline the practice ever recorded was serialized on every page
    // load — with its `computed` block.
    const range = {
      from: from ?? day,
      until: until ?? addIsoDays(day, DEADLINE_WINDOW_DAYS),
    };
    const result = await guarded(c, () => loadCalendar(range));
    if (!result.ok) return result.response;
    const keepComputed = include === "computed";
    const deadlines = keepComputed ? result.value.deadlines : result.value.deadlines.map(withoutComputed);
    if (format === "ics") {
      return icsResponse(c, result.value, "ColleX — Süreler ve duruşmalar", "collex-takvim.ics");
    }
    return c.json(
      {
        deadlines,
        // Additive (W14 B-17): the same window's hearings, so the panel and
        // the calendar read one response.
        hearings: result.value.hearings,
        today: day,
        window: range,
        includedComputed: keepComputed,
      },
      200,
    );
  });

  // W14 (B-17): the subscribable feed. Registered before /v1/matters/:id.
  app.get("/v1/matters/calendar.ics", async (c) => {
    const unknown = unknownQueryIssues(c.req.url, ["from", "until"]);
    if (unknown.length > 0) return invalid(c, "Takvim filtresi doğrulanamadı.", unknown);
    const day = today();
    const result = await guarded(c, () =>
      loadCalendar({ from: c.req.query("from") ?? addIsoDays(day, -365), until: c.req.query("until") ?? addIsoDays(day, 365) }),
    );
    if (!result.ok) return result.response;
    return icsResponse(c, result.value, "ColleX — Süreler ve duruşmalar", "collex-takvim.ics");
  });

  /**
   * W14 (B-29): general search — "şu ibare hangi dosyamdaydı?". One query
   * over matters, document bodies, notes, events, deadlines, hearings, saved
   * answers and drafts, grouped by `kind` so the console can anchor each row
   * into the screen that owns it.
   */
  const runSearch = async (c: Context, q: string, limit: number) => {
    const started = Date.now();
    const groups: Record<string, unknown[]> = {
      matters: [],
      documents: [],
      notes: [],
      events: [],
      deadlines: [],
      hearings: [],
      answers: [],
      drafts: [],
    };
    const matters = await store.list({ q, today: today() });
    groups["matters"] = matters.slice(0, limit).map((m) => ({
      id: m.id,
      title: m.title,
      client: m.client,
      opposing: m.opposing,
      docketNo: m.docketNo,
      status: m.status,
      href: `#dosya/${m.id}`,
    }));

    if (store.searchItems !== undefined) {
      const rows = await store.searchItems({ q, limit });
      for (const row of rows) {
        const target =
          row.kind === "note"
            ? "notes"
            : row.kind === "event"
              ? "events"
              : row.kind === "deadline"
                ? "deadlines"
                : row.kind === "hearing"
                  ? "hearings"
                  : undefined;
        if (target === undefined) continue;
        const text =
          typeof row.payload["text"] === "string"
            ? row.payload["text"]
            : typeof row.payload["title"] === "string"
              ? row.payload["title"]
              : typeof row.payload["court"] === "string"
                ? row.payload["court"]
                : "";
        groups[target]!.push({
          itemId: row.itemId,
          matterId: row.matterId,
          matterTitle: row.matterTitle,
          snippet: trimToWordBoundary(text, 200),
          at: row.updatedAt,
          href: `#dosya/${row.matterId}?kayit=${row.itemId}`,
        });
      }
    }

    let documentsSearched = false;
    if (deps.documents?.searchChunks !== undefined) {
      documentsSearched = true;
      try {
        const hits = await deps.documents.searchChunks(q, { limit });
        groups["documents"] = hits.map((hit) => ({
          fileId: hit.fileId,
          fileName: hit.fileName,
          chunkId: hit.chunkId,
          ordinal: hit.ordinal,
          snippet: trimToWordBoundary(hit.snippet, 240),
          // The console scrolls the document page to this code-point offset
          // (ADR-003: offsets are Unicode code points over NFC text).
          startChar: hit.startChar,
          endChar: hit.endChar,
          href: `#belge/${hit.fileId}?parca=${hit.chunkId}&offset=${hit.startChar}`,
        }));
      } catch {
        documentsSearched = false;
      }
    }

    if (answers?.list !== undefined) {
      try {
        const rows = await answers.list({ q, limit });
        groups["answers"] = rows.map((a) => ({
          runId: a.runId,
          question: trimToWordBoundary(a.question, 200),
          status: a.status,
          matterId: a.matterId,
          at: a.createdAt,
          href: `#arastir?run=${a.runId}`,
        }));
      } catch {
        // A cold answer store never fails the whole search.
      }
    }

    if (drafts?.list !== undefined) {
      try {
        const rows = await drafts.list({ q, limit });
        groups["drafts"] = rows.map((d) => ({
          draftId: d.draftId,
          title: d.title,
          template: d.template,
          version: d.version,
          matterId: d.matterId ?? null,
          at: d.createdAt,
          href: `#taslak/${d.draftId}`,
        }));
      } catch {
        // As above.
      }
    }

    const total = Object.values(groups).reduce((sum, rows) => sum + rows.length, 0);
    return c.json(
      {
        q,
        total,
        groups,
        documentsSearched,
        tookMs: Date.now() - started,
      },
      200,
    );
  };

  const searchHandler = async (c: Context): Promise<Response> => {
    const unknown = unknownQueryIssues(c.req.url, ["q", "limit"]);
    if (unknown.length > 0) return invalid(c, "Arama isteği doğrulanamadı.", unknown);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) {
      return invalid(c, "Arama isteği doğrulanamadı.", [
        { path: "q", message: "Arama en az 2 karakter olmalı." },
      ]);
    }
    if (q.length > 200) {
      return invalid(c, "Arama isteği doğrulanamadı.", [
        { path: "q", message: "Arama en fazla 200 karakter." },
      ]);
    }
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined && !/^\d{1,3}$/u.test(limitRaw)) {
      return invalid(c, "Arama isteği doğrulanamadı.", [
        { path: "limit", message: "limit 1 ile 100 arasında bir tam sayı olmalı." },
      ]);
    }
    const limit = Math.min(Math.max(1, Number(limitRaw ?? 20)), 100);
    const result = await guarded(c, () => runSearch(c, q, limit));
    return result.ok ? result.value : result.response;
  };

  app.get("/v1/matters/search", searchHandler);
  // The console's single top-bar box calls this one; same handler, the name
  // the backlog uses (B-29).
  app.get("/v1/search/all", searchHandler);

  app.post("/v1/matters", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return read.response;
    const parsed = newMatterSchema.safeParse(read.body);
    if (!parsed.success) {
      return invalid(c, "Dava dosyası doğrulanamadı — eksik veya hatalı alanlar var.", issuesOf(parsed.error));
    }
    const result = await guarded(c, () => store.create(parsed.data));
    if (!result.ok) return result.response;
    return c.json(result.value, 201);
  });

  app.get("/v1/matters/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const result = await guarded(c, async () => {
      const matter = await store.get(id);
      if (matter === undefined) return undefined;
      const items = await store.listItems(id);
      return { matter, items };
    });
    if (!result.ok) return result.response;
    if (result.value === undefined) return matterNotFound(c);
    const items = await enrich(id, result.value.items);
    return c.json({ matter: result.value.matter, items: groupItems(items) }, 200);
  });

  app.patch("/v1/matters/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const read = await readJson(c);
    if (!read.ok) return read.response;
    const parsed = matterPatchSchema.safeParse(read.body);
    if (!parsed.success) {
      return invalid(c, "Dava dosyası güncellemesi doğrulanamadı.", issuesOf(parsed.error));
    }
    const result = await guarded(c, () => store.update(id, parsed.data));
    if (!result.ok) return result.response;
    if (result.value === undefined) return matterNotFound(c);
    return c.json(result.value, 200);
  });

  app.delete("/v1/matters/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const result = await guarded(c, async () => {
      const items = await store.listItems(id);
      const removed = await store.remove(id);
      return { items, removed };
    });
    if (!result.ok) return result.response;
    if (!result.value.removed) return matterNotFound(c);
    for (const item of result.value.items) await detachAnswer(item);
    // Drafts are detached by MATTER (every draft that named it), not by
    // item: a draft linked before the item was filed must not stay pinned
    // to a matter row that no longer exists.
    if (drafts?.detachMatter !== undefined) {
      try {
        await drafts.detachMatter(id);
      } catch {
        // Best-effort bookkeeping on another store; the FK retry in the
        // draft store still saves later versions without the matter.
      }
    }
    return c.body(null, 204);
  });

  // W14 (B-17): one matter's calendar as .ics.
  app.get("/v1/matters/:id/calendar.ics", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const day = today();
    const result = await guarded(c, async () => {
      const matter = await store.get(id);
      if (matter === undefined) return undefined;
      const rows = await loadCalendar(
        { from: addIsoDays(day, -365), until: addIsoDays(day, 365) },
        id,
      );
      return { matter, rows };
    });
    if (!result.ok) return result.response;
    if (result.value === undefined) return matterNotFound(c);
    return icsResponse(
      c,
      result.value.rows,
      `ColleX — ${result.value.matter.title}`,
      "collex-dosya-takvimi.ics",
    );
  });

  /**
   * W14 (B-43): "nerede kalmıştım" — the newest changes of ONE matter in one
   * list, so a lawyer coming back after a week does not walk four tabs.
   */
  app.get("/v1/matters/:id/activity", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const unknown = unknownQueryIssues(c.req.url, ["since", "limit"]);
    if (unknown.length > 0) return invalid(c, "Hareket listesi doğrulanamadı.", unknown);
    const since = c.req.query("since");
    if (since !== undefined && !Number.isFinite(Date.parse(since))) {
      return invalid(c, "Hareket listesi doğrulanamadı.", [
        { path: "since", message: "since ISO zaman damgası olmalı (örn. 2026-09-01T00:00:00Z)." },
      ]);
    }
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined && !/^\d{1,3}$/u.test(limitRaw)) {
      return invalid(c, "Hareket listesi doğrulanamadı.", [
        { path: "limit", message: "limit 1 ile 200 arasında bir tam sayı olmalı." },
      ]);
    }
    const limit = Math.min(Math.max(1, Number(limitRaw ?? 10)), 200);
    const result = await guarded(c, async () => {
      const matter = await store.get(id);
      if (matter === undefined) return undefined;
      const items = await store.listItems(id);
      return { matter, items };
    });
    if (!result.ok) return result.response;
    if (result.value === undefined) return matterNotFound(c);
    const cutoff = since === undefined ? undefined : new Date(Date.parse(since)).toISOString();
    const activity: ActivityEntry[] = result.value.items
      .filter((item) => cutoff === undefined || item.updatedAt > cutoff)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, limit)
      .map(describeItem);
    return c.json(
      {
        matterId: id,
        matterTitle: result.value.matter.title,
        activity,
        lastActivityAt: activity[0]?.at ?? result.value.matter.updatedAt,
      },
      200,
    );
  });

  /**
   * W14 (B-17): the hearing preparation card. One read gives the console the
   * open deadlines of the matter, its last three documents and the newest
   * slice of its chronology — the three things a lawyer wants the evening
   * before a duruşma.
   */
  app.get("/v1/matters/:id/hearings/:itemId/prep", async (c) => {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    if (!isUuid(id)) return matterNotFound(c);
    if (!isUuid(itemId)) return itemNotFound(c);
    const result = await guarded(c, async () => {
      const matter = await store.get(id);
      if (matter === undefined) return undefined;
      const items = await store.listItems(id);
      return { matter, items };
    });
    if (!result.ok) return result.response;
    if (result.value === undefined) return matterNotFound(c);
    const hearing = result.value.items.find((i) => i.itemId === itemId && i.kind === "hearing");
    if (hearing === undefined) return itemNotFound(c);
    const day = today();
    const grouped = groupItems(result.value.items);
    const openDeadlines = grouped.deadlines
      .filter((d) => d.payload["status"] !== "tamam")
      .map((d) => ({
        itemId: d.itemId,
        title: typeof d.payload["title"] === "string" ? d.payload["title"] : "",
        dueDate: String(d.payload["dueDate"] ?? ""),
        daysLeft: daysBetweenIso(day, String(d.payload["dueDate"] ?? day)),
        overdue: String(d.payload["dueDate"] ?? "") < day,
      }))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    const recentFiles = [...grouped.files]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, 3)
      .map((f) => ({
        itemId: f.itemId,
        fileId: f.refId,
        fileName: typeof f.payload["fileName"] === "string" ? f.payload["fileName"] : "",
        at: f.updatedAt,
      }));
    const chronology = [...grouped.events]
      .map((e) => ({
        itemId: e.itemId,
        date: String(e.payload["date"] ?? ""),
        title: typeof e.payload["title"] === "string" ? e.payload["title"] : "",
        source: typeof e.payload["source"] === "string" ? e.payload["source"] : "manual",
        verified: e.payload["verified"] === true,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const kindRaw = typeof hearing.payload["kind"] === "string" ? hearing.payload["kind"] : "durusma";
    return c.json(
      {
        matterId: id,
        matterTitle: result.value.matter.title,
        hearing: {
          itemId: hearing.itemId,
          date: String(hearing.payload["date"] ?? ""),
          time: typeof hearing.payload["time"] === "string" ? hearing.payload["time"] : "",
          court: typeof hearing.payload["court"] === "string" ? hearing.payload["court"] : "",
          salon: typeof hearing.payload["salon"] === "string" ? hearing.payload["salon"] : "",
          kind: kindRaw,
          kindLabel:
            HEARING_KIND_LABELS[
              ((HEARING_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "durusma") as HearingKind
            ],
          note: typeof hearing.payload["note"] === "string" ? hearing.payload["note"] : "",
          status: typeof hearing.payload["status"] === "string" ? hearing.payload["status"] : "planlandi",
          daysLeft: daysBetweenIso(day, String(hearing.payload["date"] ?? day)),
          durationMinutes: HEARING_DEFAULT_MINUTES,
        },
        openDeadlines,
        recentFiles,
        chronology,
        today: day,
      },
      200,
    );
  });

  /**
   * W14 (B-18): file up to 50 records in ONE request and ONE approval.
   * Transferring the 13 dates a document analysis found used to be 13 POSTs.
   * Duplicates are rejected on (kind, date, title) against what the matter
   * already holds, so pressing the button twice does not double the
   * chronology; `MAX_ITEM_PAYLOAD_BYTES` still applies to EACH record.
   */
  const batchHandler = async (c: Context): Promise<Response> => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const read = await readJson(c);
    if (!read.ok) return read.response;
    const envelope = batchEnvelope.safeParse(read.body);
    if (!envelope.success) {
      return invalid(c, "Toplu kayıt doğrulanamadı — eksik veya hatalı alanlar var.", issuesOf(envelope.error));
    }
    const existing = await guarded(c, () => store.listItems(id));
    if (!existing.ok) return existing.response;
    const matterExists = await guarded(c, () => store.get(id));
    if (!matterExists.ok) return matterExists.response;
    if (matterExists.value === undefined) return matterNotFound(c);

    const seen = new Set(existing.value.map(dedupeKey));
    const accepted: Array<{ kind: MatterItemKind; refId?: string | null; payload: Record<string, unknown> }> = [];
    const skipped: Array<{ index: number; reason: string; message: string }> = [];
    const issues: Array<{ path: string; message: string }> = [];
    envelope.data.items.forEach((entry, index) => {
      const validated = validateItemPayload(entry.kind, entry.payload ?? {});
      if (!validated.ok) {
        for (const issue of validated.issues) {
          issues.push({ path: `items.${index}.${issue.path}`, message: issue.message });
        }
        return;
      }
      if (payloadOversized(validated.payload)) {
        issues.push({ path: `items.${index}.payload`, message: ITEM_PAYLOAD_TOO_LARGE_MESSAGE_TR });
        return;
      }
      const key = dedupeKey({
        kind: entry.kind,
        refId: entry.refId ?? null,
        payload: validated.payload,
      });
      if (seen.has(key)) {
        skipped.push({
          index,
          reason: "DUPLICATE",
          message: "Bu kayıt dosyada zaten var; yeniden eklenmedi.",
        });
        return;
      }
      seen.add(key);
      accepted.push({
        kind: entry.kind,
        ...(entry.refId !== undefined ? { refId: entry.refId } : {}),
        payload: validated.payload,
      });
    });
    if (issues.length > 0) {
      return invalid(c, "Toplu kayıt doğrulanamadı — eksik veya hatalı alanlar var.", issues);
    }

    let created: MatterItem[] = [];
    if (accepted.length > 0) {
      try {
        const inserted =
          store.addItems !== undefined
            ? await store.addItems(id, accepted)
            : await sequentialAdd(store, id, accepted);
        if (inserted === undefined) return matterNotFound(c);
        created = inserted;
      } catch (error) {
        if (error instanceof ItemKindUnsupportedError) {
          return c.json(
            { error: { kind: "ITEM_KIND_UNSUPPORTED", message: HEARING_SCHEMA_MESSAGE_TR } },
            503,
          );
        }
        return storeUnavailable(c);
      }
    }
    return c.json({ created, createdCount: created.length, skipped }, 201);
  };
  app.post("/v1/matters/:id/items:batch", batchHandler);
  // Same handler under a colon-free path: some HTTP clients and proxies
  // mangle a ':' inside a path segment.
  app.post("/v1/matters/:id/items/batch", batchHandler);

  app.post("/v1/matters/:id/items", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return matterNotFound(c);
    const read = await readJson(c);
    if (!read.ok) return read.response;
    const envelope = newItemEnvelope.safeParse(read.body);
    if (!envelope.success) {
      return invalid(c, "Dosya kaydı doğrulanamadı — eksik veya hatalı alanlar var.", issuesOf(envelope.error));
    }
    const { kind, refId } = envelope.data;
    let payload = envelope.data.payload ?? {};

    // An answer item can be filed with just its runId: the stored answer
    // supplies question/status/mode so the payload survives a cache miss.
    if (kind === "answer" && refId !== undefined && refId !== null && answers !== undefined) {
      try {
        await answers.warm?.(refId);
      } catch {
        // Fall through: the caller's payload (if any) still applies.
      }
      const stored = answers.get(refId);
      if (stored !== undefined) {
        const s = summarizeStoredAnswer(stored);
        payload = {
          question: s.question,
          status: s.status,
          mode: s.mode,
          ...(s.fileScope !== undefined ? { fileScope: s.fileScope } : {}),
          ...payload,
        };
      }
    }

    const validated = validateItemPayload(kind, payload);
    if (!validated.ok) {
      return invalid(c, "Dosya kaydı doğrulanamadı — eksik veya hatalı alanlar var.", validated.issues);
    }
    if (payloadOversized(validated.payload)) return payloadTooLarge(c);
    // W12-FIX: a record (file / answer / draft) is filed under a matter ONCE.
    // Filing the same (kind, refId) again is idempotent — the existing item
    // comes back with 200 — instead of a second card on the matter page
    // ("Belgeler 3 → 5, same DOCX listed twice", reviewed 02.09.2026).
    if (refId !== undefined && refId !== null && (kind === "file" || kind === "answer" || kind === "draft")) {
      const existing = await guarded(c, () => store.listItems(id));
      if (!existing.ok) return existing.response;
      const same = existing.value.find((item) => item.kind === kind && item.refId === refId);
      if (same !== undefined) {
        const merged = await guarded(c, () =>
          store.updateItem(id, same.itemId, { payload: { ...same.payload, ...validated.payload } }),
        );
        if (!merged.ok) return merged.response;
        return c.json(merged.value ?? same, 200);
      }
    }
    let added: MatterItem | undefined;
    try {
      added = await store.addItem(id, {
        kind,
        ...(refId !== undefined ? { refId } : {}),
        payload: validated.payload,
      });
    } catch (error) {
      if (error instanceof ItemKindUnsupportedError) {
        return c.json(
          { error: { kind: "ITEM_KIND_UNSUPPORTED", message: HEARING_SCHEMA_MESSAGE_TR } },
          503,
        );
      }
      return storeUnavailable(c);
    }
    const result = { ok: true as const, value: added };
    if (result.value === undefined) return matterNotFound(c);

    if (kind === "answer" && refId !== undefined && refId !== null && answers?.attach !== undefined) {
      try {
        await answers.attach(refId, id);
      } catch {
        // The item exists; the answer store's filing is best-effort here and
        // is re-derivable from the item itself.
      }
    }
    return c.json(result.value, 201);
  });

  app.patch("/v1/matters/:id/items/:itemId", async (c) => {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    if (!isUuid(id)) return matterNotFound(c);
    if (!isUuid(itemId)) return itemNotFound(c);
    const read = await readJson(c);
    if (!read.ok) return read.response;
    const envelope = itemPatchEnvelope.safeParse(read.body);
    if (!envelope.success) {
      return invalid(c, "Dosya kaydı güncellemesi doğrulanamadı.", issuesOf(envelope.error));
    }
    const existing = await guarded(c, () => store.getItem(id, itemId));
    if (!existing.ok) return existing.response;
    if (existing.value === undefined) {
      const matter = await guarded(c, () => store.get(id));
      if (!matter.ok) return matter.response;
      return matter.value === undefined ? matterNotFound(c) : itemNotFound(c);
    }
    const item = existing.value;
    if (
      envelope.data.refId !== undefined &&
      envelope.data.refId !== item.refId &&
      (item.kind === "file" || item.kind === "answer" || item.kind === "draft")
    ) {
      return invalid(c, "Dosya kaydı güncellemesi doğrulanamadı.", [
        { path: "refId", message: REF_ID_IMMUTABLE_MESSAGE_TR },
      ]);
    }
    let payload: Record<string, unknown> | undefined;
    if (envelope.data.payload !== undefined) {
      const merged = { ...item.payload, ...envelope.data.payload };
      const validated = validateItemPayload(item.kind, merged);
      if (!validated.ok) return invalid(c, "Dosya kaydı güncellemesi doğrulanamadı.", validated.issues);
      if (payloadOversized(validated.payload)) return payloadTooLarge(c);
      payload = validated.payload;
    }
    const result = await guarded(c, () =>
      store.updateItem(id, itemId, {
        ...(payload !== undefined ? { payload } : {}),
        ...(envelope.data.refId !== undefined ? { refId: envelope.data.refId } : {}),
      }),
    );
    if (!result.ok) return result.response;
    if (result.value === undefined) return itemNotFound(c);
    return c.json(result.value, 200);
  });

  app.delete("/v1/matters/:id/items/:itemId", async (c) => {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    if (!isUuid(id)) return matterNotFound(c);
    if (!isUuid(itemId)) return itemNotFound(c);
    const result = await guarded(c, async () => {
      const item = await store.getItem(id, itemId);
      if (item === undefined) return { item: undefined, removed: false };
      const removed = await store.removeItem(id, itemId);
      return { item, removed };
    });
    if (!result.ok) return result.response;
    if (!result.value.removed || result.value.item === undefined) {
      const matter = await guarded(c, () => store.get(id));
      if (!matter.ok) return matter.response;
      return matter.value === undefined ? matterNotFound(c) : itemNotFound(c);
    }
    await detachAnswer(result.value.item);
    return c.body(null, 204);
  });

  // W14 (B-26): DELETE /v1/answers/{runId}, DELETE /v1/drafts/{draftId} and
  // GET /v1/drafts/{id}/versions/{n}. They live in their own file but are
  // mounted from here, because this router already carries the answer and
  // draft ports and `src/api/server.ts` belongs to another lane this wave
  // (W13-BACKLOG §G.1 contract 1). Neither path is claimed by an existing
  // handler, so mounting order cannot shadow them.
  app.route(
    "/",
    createRecordsRouter({
      ...(answers !== undefined ? { answers } : {}),
      ...(drafts !== undefined ? { drafts } : {}),
      store,
    }),
  );

  // W14 (B-42): contact cards + conflict scan, mounted only when a contact
  // store is configured (nothing half-built appears in the API otherwise —
  // the vapourware gate, W13-BACKLOG §G.3).
  if (deps.contacts !== undefined) {
    app.route(
      "/",
      createContactsRouter({
        service: new ContactService({ store: deps.contacts, matters: store, now }),
      }),
    );
  }

  return app;
}
