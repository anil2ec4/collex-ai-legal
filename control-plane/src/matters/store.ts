/**
 * Matter stores (W12-A): PgMatterStore over app_private.matters /
 * app_private.matter_items, and InMemoryMatterStore for offline tests.
 *
 * Both return plain rows; `deriveMatterSummary` (types.ts) computes counts,
 * nextDeadline and lastActivityAt for both, so the list a lawyer sees
 * cannot depend on which store is wired. PgMatterStore loads the matters
 * that match and then their items in ONE second query (`= any(ids)`) — a
 * solo lawyer's volumes are hundreds of matters at most, and one derivation
 * path beats a second, SQL-side implementation of the same rules.
 *
 * Every identifier reaching SQL is validated as a UUID first
 * (`assertUuid`), so a malformed path segment is a typed 404 upstream, never
 * a cast error.
 */

import { randomUUID } from "node:crypto";
import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID, assertUuid } from "../store/answerStore.js";
import {
  TR_FILTER_SQL_FROM,
  TR_FILTER_SQL_TO,
  foldTurkishForFilter,
} from "../retrieval/normalize.js";
import {
  ISO_DATE_RE,
  deriveMatterSummary,
  isOpenDeadline,
  isPlannedHearing,
  matterMatchesQuery,
  todayIso,
  type DeadlineRow,
  type Matter,
  type MatterItem,
  type MatterItemKind,
  type MatterItemPatch,
  type MatterKind,
  type MatterPatch,
  type MatterStatus,
  type MatterStore,
  type MatterSummary,
  type NewMatter,
  type NewMatterItem,
} from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();
}

function str(row: SqlRow, column: string): string {
  const v = row[column];
  return typeof v === "string" ? v : "";
}

function rowToMatter(row: SqlRow): Matter {
  return {
    id: String(row["id"]),
    title: str(row, "title"),
    client: str(row, "client"),
    opposing: str(row, "opposing"),
    court: str(row, "court"),
    docketNo: str(row, "docket_no"),
    kind: str(row, "kind") as MatterKind,
    status: str(row, "status") as MatterStatus,
    notes: str(row, "notes"),
    createdAt: toIso(row["created_at"]),
    updatedAt: toIso(row["updated_at"]),
  };
}

function rowToItem(row: SqlRow): MatterItem {
  const payload = row["payload"];
  const ref = row["ref_id"];
  return {
    itemId: String(row["item_id"]),
    matterId: String(row["matter_id"]),
    kind: str(row, "kind") as MatterItemKind,
    refId: typeof ref === "string" ? ref : null,
    payload:
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {},
    createdAt: toIso(row["created_at"]),
    updatedAt: toIso(row["updated_at"]),
  };
}

/**
 * LIKE pattern over the Turkish filter fold, with the user's wildcard
 * characters neutralised. Compared against {@link foldedSql} of a column —
 * `ILIKE` folded case with the database locale, which reads "YILMAZ" as
 * "yilmaz" and so never met "Yılmaz" (27.09.2026).
 */
function likePattern(q: string): string {
  return "%" + foldTurkishForFilter(q).replace(/[\\%_]/g, "\\$&") + "%";
}

/** SQL twin of foldTurkishForFilter for a raw text expression. */
function foldedSql(sql: Sql, expr: ReturnType<Sql>) {
  return sql`lower(translate(${expr}, ${TR_FILTER_SQL_FROM}, ${TR_FILTER_SQL_TO}))`;
}

/**
 * SQLSTATE 23514 (check_violation) on `matter_items.kind` — the database
 * predates the `hearing` kind (W14 B-17; the ALTER is L-SAFE's migration).
 * Recognised so the route can answer one honest Turkish sentence instead of
 * a 503 that blames the whole store.
 */
export const HEARING_SCHEMA_MESSAGE_TR =
  "Duruşma kaydı için yerel veritabanı güncellenmeli: ColleX-Baslat.cmd " +
  "ile veritabanını yeniden başlatın (kayıt türü listesi eski).";

export class ItemKindUnsupportedError extends Error {
  constructor(readonly kind: string) {
    super(`matter item kind '${kind}' is not accepted by the database`);
    this.name = "ItemKindUnsupportedError";
  }
}

function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23514"
  );
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

export interface PgMatterStoreOptions {
  sql: Sql;
  tenantId?: string;
}

export class PgMatterStore implements MatterStore {
  private readonly sql: Sql;
  private readonly tenantId: string;

  constructor(options: PgMatterStoreOptions) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
  }

  async list(opts: { status?: MatterStatus; q?: string; today?: string } = {}): Promise<MatterSummary[]> {
    const sql = this.sql;
    const today = opts.today !== undefined && ISO_DATE_RE.test(opts.today) ? opts.today : todayIso();
    const q = opts.q?.trim();
    const statusClause = opts.status !== undefined ? sql`and status = ${opts.status}` : sql``;
    const pattern = q !== undefined && q !== "" ? likePattern(q) : undefined;
    const searchClause =
      pattern !== undefined
        ? sql`and (${foldedSql(sql, sql`title`)} like ${pattern}
                   or ${foldedSql(sql, sql`client`)} like ${pattern}
                   or ${foldedSql(sql, sql`opposing`)} like ${pattern}
                   or ${foldedSql(sql, sql`court`)} like ${pattern}
                   or ${foldedSql(sql, sql`docket_no`)} like ${pattern})`
        : sql``;
    const rows = await sql`
      select id, title, client, opposing, court, docket_no, kind, status, notes,
             created_at, updated_at
      from app_private.matters
      where tenant_id = ${this.tenantId} ${statusClause} ${searchClause}
      order by updated_at desc, id`;
    const matters = rows.map(rowToMatter);
    if (matters.length === 0) return [];
    const ids = matters.map((m) => m.id);
    const itemRows = await sql`
      select item_id, matter_id, kind, ref_id, payload, created_at, updated_at
      from app_private.matter_items
      where tenant_id = ${this.tenantId} and matter_id = any(${ids}::uuid[])
      order by created_at, item_id`;
    const byMatter = new Map<string, MatterItem[]>();
    for (const row of itemRows) {
      const item = rowToItem(row);
      const list = byMatter.get(item.matterId) ?? [];
      list.push(item);
      byMatter.set(item.matterId, list);
    }
    return matters
      .map((m) => deriveMatterSummary(m, byMatter.get(m.id) ?? [], today))
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0));
  }

  async create(input: NewMatter): Promise<Matter> {
    const rows = await this.sql`
      insert into app_private.matters
        (tenant_id, title, client, opposing, court, docket_no, kind, status, notes)
      values
        (${this.tenantId}, ${input.title}, ${input.client ?? ""}, ${input.opposing ?? ""},
         ${input.court ?? ""}, ${input.docketNo ?? ""}, ${input.kind ?? "dava"},
         ${input.status ?? "acik"}, ${input.notes ?? ""})
      returning id, title, client, opposing, court, docket_no, kind, status, notes,
                created_at, updated_at`;
    const row = rows[0];
    if (row === undefined) throw new Error("insert into app_private.matters returned no row");
    return rowToMatter(row);
  }

  async get(id: string): Promise<Matter | undefined> {
    if (!isUuid(id)) return undefined;
    const rows = await this.sql`
      select id, title, client, opposing, court, docket_no, kind, status, notes,
             created_at, updated_at
      from app_private.matters
      where tenant_id = ${this.tenantId} and id = ${id}`;
    const row = rows[0];
    return row === undefined ? undefined : rowToMatter(row);
  }

  async update(id: string, patch: MatterPatch): Promise<Matter | undefined> {
    if (!isUuid(id)) return undefined;
    const rows = await this.sql`
      update app_private.matters set
        title = coalesce(${patch.title ?? null}, title),
        client = coalesce(${patch.client ?? null}, client),
        opposing = coalesce(${patch.opposing ?? null}, opposing),
        court = coalesce(${patch.court ?? null}, court),
        docket_no = coalesce(${patch.docketNo ?? null}, docket_no),
        kind = coalesce(${patch.kind ?? null}, kind),
        status = coalesce(${patch.status ?? null}, status),
        notes = coalesce(${patch.notes ?? null}, notes),
        updated_at = now()
      where tenant_id = ${this.tenantId} and id = ${id}
      returning id, title, client, opposing, court, docket_no, kind, status, notes,
                created_at, updated_at`;
    const row = rows[0];
    return row === undefined ? undefined : rowToMatter(row);
  }

  async remove(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await this.sql`
      delete from app_private.matters
      where tenant_id = ${this.tenantId} and id = ${id}
      returning id`;
    return rows.length > 0;
  }

  async listItems(matterId: string): Promise<MatterItem[]> {
    if (!isUuid(matterId)) return [];
    const rows = await this.sql`
      select item_id, matter_id, kind, ref_id, payload, created_at, updated_at
      from app_private.matter_items
      where tenant_id = ${this.tenantId} and matter_id = ${matterId}
      order by created_at, item_id`;
    return rows.map(rowToItem);
  }

  async getItem(matterId: string, itemId: string): Promise<MatterItem | undefined> {
    if (!isUuid(matterId) || !isUuid(itemId)) return undefined;
    const rows = await this.sql`
      select item_id, matter_id, kind, ref_id, payload, created_at, updated_at
      from app_private.matter_items
      where tenant_id = ${this.tenantId} and matter_id = ${matterId} and item_id = ${itemId}`;
    const row = rows[0];
    return row === undefined ? undefined : rowToItem(row);
  }

  async addItem(matterId: string, input: NewMatterItem): Promise<MatterItem | undefined> {
    const created = await this.addItems(matterId, [input]);
    return created?.[0];
  }

  /**
   * W14 (B-18): file up to 50 records in ONE statement. `unnest` over three
   * parallel arrays keeps this a single round trip and one `exists` check on
   * the matter, so a 12-date timeline transfer is one HTTP request AND one
   * insert instead of twelve of each.
   */
  async addItems(
    matterId: string,
    inputs: readonly NewMatterItem[],
  ): Promise<MatterItem[] | undefined> {
    if (!isUuid(matterId)) return undefined;
    if (inputs.length === 0) {
      const exists = await this.get(matterId);
      return exists === undefined ? undefined : [];
    }
    const kinds = inputs.map((i) => i.kind);
    const refIds = inputs.map((i) => i.refId ?? null);
    const payloads = inputs.map((i) => JSON.stringify(i.payload ?? {}));
    let rows;
    try {
      rows = await this.sql`
        insert into app_private.matter_items (matter_id, tenant_id, kind, ref_id, payload)
        select ${matterId}, ${this.tenantId}, k, r, p::jsonb
        from unnest(${kinds}::text[], ${refIds}::text[], ${payloads}::text[])
             with ordinality as t(k, r, p, ord)
        where exists (
          select 1 from app_private.matters
          where tenant_id = ${this.tenantId} and id = ${matterId}
        )
        order by t.ord
        returning item_id, matter_id, kind, ref_id, payload, created_at, updated_at`;
    } catch (error) {
      if (isCheckViolation(error)) {
        const unsupported = kinds.find((k) => k === "hearing") ?? kinds[0] ?? "";
        throw new ItemKindUnsupportedError(unsupported);
      }
      throw error;
    }
    if (rows.length === 0) return undefined;
    const items = rows.map(rowToItem);
    const newest = items.reduce((acc, i) => (i.updatedAt > acc ? i.updatedAt : acc), items[0]!.updatedAt);
    await this.touch(matterId, newest);
    return items;
  }

  async updateItem(
    matterId: string,
    itemId: string,
    patch: MatterItemPatch,
  ): Promise<MatterItem | undefined> {
    if (!isUuid(matterId) || !isUuid(itemId)) return undefined;
    const keepRef = patch.refId === undefined;
    const payloadJson = patch.payload !== undefined ? this.sql.json(patch.payload as never) : null;
    const rows = await this.sql`
      update app_private.matter_items set
        payload = coalesce(${payloadJson}::jsonb, payload),
        ref_id = case when ${keepRef} then ref_id else ${patch.refId ?? null} end,
        updated_at = now()
      where tenant_id = ${this.tenantId} and matter_id = ${matterId} and item_id = ${itemId}
      returning item_id, matter_id, kind, ref_id, payload, created_at, updated_at`;
    const row = rows[0];
    if (row === undefined) return undefined;
    const item = rowToItem(row);
    await this.touch(matterId, item.updatedAt);
    return item;
  }

  async removeItem(matterId: string, itemId: string): Promise<boolean> {
    if (!isUuid(matterId) || !isUuid(itemId)) return false;
    const rows = await this.sql`
      delete from app_private.matter_items
      where tenant_id = ${this.tenantId} and matter_id = ${matterId} and item_id = ${itemId}
      returning item_id`;
    if (rows.length === 0) return false;
    await this.touch(matterId);
    return true;
  }

  async listDeadlines(opts: { until?: string; from?: string } = {}): Promise<DeadlineRow[]> {
    const sql = this.sql;
    const until = opts.until !== undefined && ISO_DATE_RE.test(opts.until) ? opts.until : undefined;
    const from = opts.from !== undefined && ISO_DATE_RE.test(opts.from) ? opts.from : undefined;
    const untilClause = until !== undefined ? sql`and (i.payload ->> 'dueDate') <= ${until}` : sql``;
    const fromClause = from !== undefined ? sql`and (i.payload ->> 'dueDate') >= ${from}` : sql``;
    const rows = await sql`
      select i.item_id, i.matter_id, i.kind, i.ref_id, i.payload, i.created_at, i.updated_at,
             m.title as matter_title
      from app_private.matter_items i
      join app_private.matters m on m.id = i.matter_id
      where i.tenant_id = ${this.tenantId}
        and i.kind = 'deadline'
        and coalesce(i.payload ->> 'status', 'acik') <> 'tamam'
        and (i.payload ->> 'dueDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        ${fromClause}
        ${untilClause}
      order by (i.payload ->> 'dueDate'), i.created_at, i.item_id`;
    return rows.map((row) => ({ ...rowToItem(row), matterTitle: str(row, "matter_title") }));
  }

  /** W14 (B-17): planned hearings across every matter, date ascending. */
  async listHearings(opts: { until?: string; from?: string } = {}): Promise<DeadlineRow[]> {
    const sql = this.sql;
    const until = opts.until !== undefined && ISO_DATE_RE.test(opts.until) ? opts.until : undefined;
    const from = opts.from !== undefined && ISO_DATE_RE.test(opts.from) ? opts.from : undefined;
    const untilClause = until !== undefined ? sql`and (i.payload ->> 'date') <= ${until}` : sql``;
    const fromClause = from !== undefined ? sql`and (i.payload ->> 'date') >= ${from}` : sql``;
    const rows = await sql`
      select i.item_id, i.matter_id, i.kind, i.ref_id, i.payload, i.created_at, i.updated_at,
             m.title as matter_title
      from app_private.matter_items i
      join app_private.matters m on m.id = i.matter_id
      where i.tenant_id = ${this.tenantId}
        and i.kind = 'hearing'
        and coalesce(i.payload ->> 'status', 'planlandi') <> 'yapildi'
        and (i.payload ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        ${fromClause}
        ${untilClause}
      order by (i.payload ->> 'date'), (i.payload ->> 'time'), i.item_id`;
    return rows.map((row) => ({ ...rowToItem(row), matterTitle: str(row, "matter_title") }));
  }

  /**
   * W14 (B-29): free-text search over the item payloads a lawyer writes —
   * note text and event / deadline / hearing titles. ILIKE over the extracted
   * text fields, wildcards neutralised; the ordering is newest first so the
   * general search box shows the most recent match of each kind.
   */
  async searchItems(opts: {
    q: string;
    kinds?: readonly MatterItemKind[];
    limit?: number;
  }): Promise<DeadlineRow[]> {
    const sql = this.sql;
    const q = opts.q.trim();
    if (q === "") return [];
    const pattern = likePattern(q);
    const kinds = [...(opts.kinds ?? (["note", "event", "deadline", "hearing"] as const))];
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 20)), 200);
    const rows = await sql`
      select i.item_id, i.matter_id, i.kind, i.ref_id, i.payload, i.created_at, i.updated_at,
             m.title as matter_title
      from app_private.matter_items i
      join app_private.matters m on m.id = i.matter_id
      where i.tenant_id = ${this.tenantId}
        and i.kind = any(${kinds}::text[])
        and (${foldedSql(sql, sql`coalesce(i.payload ->> 'text', '')`)} like ${pattern}
             or ${foldedSql(sql, sql`coalesce(i.payload ->> 'title', '')`)} like ${pattern}
             or ${foldedSql(sql, sql`coalesce(i.payload ->> 'court', '')`)} like ${pattern}
             or ${foldedSql(sql, sql`coalesce(i.payload ->> 'note', '')`)} like ${pattern})
      order by i.updated_at desc, i.item_id
      limit ${limit}`;
    return rows.map((row) => ({ ...rowToItem(row), matterTitle: str(row, "matter_title") }));
  }

  /** W14 (B-43): the newest item changes of one matter, newest first. */
  async listRecentItems(matterId: string, limit: number): Promise<MatterItem[]> {
    if (!isUuid(matterId)) return [];
    const capped = Math.min(Math.max(1, Math.floor(limit)), 200);
    const rows = await this.sql`
      select item_id, matter_id, kind, ref_id, payload, created_at, updated_at
      from app_private.matter_items
      where tenant_id = ${this.tenantId} and matter_id = ${matterId}
      order by updated_at desc, item_id
      limit ${capped}`;
    return rows.map(rowToItem);
  }

  /**
   * W14 (B-26): every matter item that references `refId` with this kind —
   * the dangling rows a DELETE /v1/files/{id} used to leave behind.
   */
  async listItemsByRef(kind: MatterItemKind, refId: string): Promise<DeadlineRow[]> {
    const rows = await this.sql`
      select i.item_id, i.matter_id, i.kind, i.ref_id, i.payload, i.created_at, i.updated_at,
             m.title as matter_title
      from app_private.matter_items i
      join app_private.matters m on m.id = i.matter_id
      where i.tenant_id = ${this.tenantId} and i.kind = ${kind} and i.ref_id = ${refId}`;
    return rows.map((row) => ({ ...rowToItem(row), matterTitle: str(row, "matter_title") }));
  }

  /** W14 (B-26): drop every item referencing `refId`; returns how many. */
  async removeItemsByRef(kind: MatterItemKind, refId: string): Promise<number> {
    const rows = await this.sql`
      delete from app_private.matter_items
      where tenant_id = ${this.tenantId} and kind = ${kind} and ref_id = ${refId}
      returning item_id`;
    return rows.length;
  }

  /**
   * Any item change is activity on the matter. The item's own timestamp is
   * carried over (not a second now()) so `lastActivityAt` derived by
   * deriveMatterSummary is the SAME instant in both stores; updated_at
   * never moves backwards.
   */
  private async touch(matterId: string, at?: string): Promise<void> {
    const stamp = at ?? new Date().toISOString();
    await this.sql`
      update app_private.matters
      set updated_at = greatest(updated_at, ${stamp}::timestamptz)
      where tenant_id = ${this.tenantId} and id = ${matterId}`;
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests, demo)
// ---------------------------------------------------------------------------

export class InMemoryMatterStore implements MatterStore {
  private readonly matters = new Map<string, Matter>();
  private readonly items = new Map<string, MatterItem>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private stamp(): string {
    return this.now().toISOString();
  }

  async list(opts: { status?: MatterStatus; q?: string; today?: string } = {}): Promise<MatterSummary[]> {
    const q = opts.q?.trim();
    const today =
      opts.today !== undefined && ISO_DATE_RE.test(opts.today) ? opts.today : todayIso(this.now());
    return [...this.matters.values()]
      .filter((m) => opts.status === undefined || m.status === opts.status)
      .filter((m) => q === undefined || q === "" || matterMatchesQuery(m, q))
      .map((m) => deriveMatterSummary(m, this.itemsOf(m.id), today))
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0));
  }

  async create(input: NewMatter): Promise<Matter> {
    const at = this.stamp();
    const matter: Matter = {
      id: randomUUID(),
      title: input.title,
      client: input.client ?? "",
      opposing: input.opposing ?? "",
      court: input.court ?? "",
      docketNo: input.docketNo ?? "",
      kind: input.kind ?? "dava",
      status: input.status ?? "acik",
      notes: input.notes ?? "",
      createdAt: at,
      updatedAt: at,
    };
    this.matters.set(matter.id, matter);
    return matter;
  }

  async get(id: string): Promise<Matter | undefined> {
    return this.matters.get(id);
  }

  async update(id: string, patch: MatterPatch): Promise<Matter | undefined> {
    const current = this.matters.get(id);
    if (current === undefined) return undefined;
    const next: Matter = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.client !== undefined ? { client: patch.client } : {}),
      ...(patch.opposing !== undefined ? { opposing: patch.opposing } : {}),
      ...(patch.court !== undefined ? { court: patch.court } : {}),
      ...(patch.docketNo !== undefined ? { docketNo: patch.docketNo } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updatedAt: this.stamp(),
    };
    this.matters.set(id, next);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.matters.delete(id)) return false;
    for (const item of this.itemsOf(id)) this.items.delete(item.itemId);
    return true;
  }

  async listItems(matterId: string): Promise<MatterItem[]> {
    return this.itemsOf(matterId);
  }

  async getItem(matterId: string, itemId: string): Promise<MatterItem | undefined> {
    const item = this.items.get(itemId);
    return item !== undefined && item.matterId === matterId ? item : undefined;
  }

  async addItem(matterId: string, input: NewMatterItem): Promise<MatterItem | undefined> {
    const created = await this.addItems(matterId, [input]);
    return created?.[0];
  }

  async addItems(
    matterId: string,
    inputs: readonly NewMatterItem[],
  ): Promise<MatterItem[] | undefined> {
    if (!this.matters.has(matterId)) return undefined;
    const created: MatterItem[] = [];
    let last = "";
    for (const input of inputs) {
      const at = this.stamp();
      const item: MatterItem = {
        itemId: randomUUID(),
        matterId,
        kind: input.kind,
        refId: input.refId ?? null,
        payload: { ...(input.payload ?? {}) },
        createdAt: at,
        updatedAt: at,
      };
      this.items.set(item.itemId, item);
      created.push(item);
      last = at;
    }
    if (last !== "") this.touch(matterId, last);
    return created;
  }

  async updateItem(
    matterId: string,
    itemId: string,
    patch: MatterItemPatch,
  ): Promise<MatterItem | undefined> {
    const current = await this.getItem(matterId, itemId);
    if (current === undefined) return undefined;
    const at = this.stamp();
    const next: MatterItem = {
      ...current,
      payload: patch.payload !== undefined ? { ...patch.payload } : current.payload,
      refId: patch.refId !== undefined ? patch.refId : current.refId,
      updatedAt: at,
    };
    this.items.set(itemId, next);
    this.touch(matterId, at);
    return next;
  }

  async removeItem(matterId: string, itemId: string): Promise<boolean> {
    const current = await this.getItem(matterId, itemId);
    if (current === undefined) return false;
    this.items.delete(itemId);
    this.touch(matterId, this.stamp());
    return true;
  }

  async listDeadlines(opts: { until?: string; from?: string } = {}): Promise<DeadlineRow[]> {
    return this.listDated(opts, isOpenDeadline, "dueDate");
  }

  async listHearings(opts: { until?: string; from?: string } = {}): Promise<DeadlineRow[]> {
    return this.listDated(opts, isPlannedHearing, "date");
  }

  private listDated(
    opts: { until?: string; from?: string },
    accept: (item: MatterItem) => boolean,
    dateKey: string,
  ): DeadlineRow[] {
    const until = opts.until !== undefined && ISO_DATE_RE.test(opts.until) ? opts.until : undefined;
    const from = opts.from !== undefined && ISO_DATE_RE.test(opts.from) ? opts.from : undefined;
    const rows: DeadlineRow[] = [];
    for (const item of this.items.values()) {
      if (!accept(item)) continue;
      const when = String(item.payload[dateKey]);
      if (until !== undefined && when > until) continue;
      if (from !== undefined && when < from) continue;
      const matter = this.matters.get(item.matterId);
      if (matter === undefined) continue;
      rows.push({ ...item, matterTitle: matter.title });
    }
    return rows.sort((a, b) => {
      const da = String(a.payload[dateKey]);
      const db = String(b.payload[dateKey]);
      if (da !== db) return da < db ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
  }

  async searchItems(opts: {
    q: string;
    kinds?: readonly MatterItemKind[];
    limit?: number;
  }): Promise<DeadlineRow[]> {
    const q = foldTurkishForFilter(opts.q.trim());
    if (q === "") return [];
    const kinds = new Set<MatterItemKind>(opts.kinds ?? ["note", "event", "deadline", "hearing"]);
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 20)), 200);
    const rows: DeadlineRow[] = [];
    for (const item of this.items.values()) {
      if (!kinds.has(item.kind)) continue;
      const haystack = foldTurkishForFilter(
        ["text", "title", "court", "note"]
          .map((k) => (typeof item.payload[k] === "string" ? String(item.payload[k]) : ""))
          .join(" "),
      );
      if (!haystack.includes(q)) continue;
      const matter = this.matters.get(item.matterId);
      if (matter === undefined) continue;
      rows.push({ ...item, matterTitle: matter.title });
    }
    return rows
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, limit);
  }

  async listRecentItems(matterId: string, limit: number): Promise<MatterItem[]> {
    const capped = Math.min(Math.max(1, Math.floor(limit)), 200);
    return this.itemsOf(matterId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, capped);
  }

  async listItemsByRef(kind: MatterItemKind, refId: string): Promise<DeadlineRow[]> {
    const rows: DeadlineRow[] = [];
    for (const item of this.items.values()) {
      if (item.kind !== kind || item.refId !== refId) continue;
      const matter = this.matters.get(item.matterId);
      if (matter === undefined) continue;
      rows.push({ ...item, matterTitle: matter.title });
    }
    return rows;
  }

  async removeItemsByRef(kind: MatterItemKind, refId: string): Promise<number> {
    let removed = 0;
    for (const item of [...this.items.values()]) {
      if (item.kind !== kind || item.refId !== refId) continue;
      this.items.delete(item.itemId);
      this.touch(item.matterId, this.stamp());
      removed += 1;
    }
    return removed;
  }

  private itemsOf(matterId: string): MatterItem[] {
    return [...this.items.values()]
      .filter((i) => i.matterId === matterId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  private touch(matterId: string, at: string): void {
    const matter = this.matters.get(matterId);
    if (matter !== undefined) this.matters.set(matterId, { ...matter, updatedAt: at });
  }
}
