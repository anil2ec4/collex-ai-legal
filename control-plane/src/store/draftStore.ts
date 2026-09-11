/**
 * Durable draft store (W12-A, contract [P]): write-through bounded cache +
 * app_private.drafts, one row per (draft_id, version_no).
 *
 * Diagnosis (audit 02.09.2026): drafts lived only in InMemoryDraftStore
 * (capacity 64) and vanished on restart. Every `put()` here APPENDS a
 * version row (`version_no = draft.version ?? 1`, ON CONFLICT DO UPDATE so
 * a re-put of the same version is idempotent); `get()` serves the highest
 * version from the cache, `warm()` loads it from the database.
 *
 * Lane boundary: this file does NOT import the drafting lane's `Draft`
 * (lane C is adding fields to it in the same wave). It works against the
 * STRUCTURAL `StorableDraft` below; the integration instantiates
 * `new PgDraftStore<Draft>({ sql })`, which satisfies lane C's `DraftStore`
 * interface (`put(Draft)`, `get(): Draft | undefined`, `warm`, `list`,
 * `versions`) because `Draft` carries every field `StorableDraft` names.
 */

import type { Sql, SqlRow } from "./db.js";
import { LOCAL_TENANT_ID, assertUuid, describeStoreError } from "./answerStore.js";

/** The fields a draft must carry to be stored; everything else rides in `body`. */
export interface StorableDraft {
  draftId: string;
  /** 1 for new drafts; PUT /v1/drafts/{id} increments (lane C). Absent = 1. */
  version?: number;
  matterId?: string | null;
  kind: string;
  template: string;
  title: string;
  createdAt: string;
  unsupportedCount: number;
}

/** Same shape as lane C's `DraftSummary` (control-plane/src/drafting/store.ts). */
export interface DraftSummaryRow {
  draftId: string;
  version: number;
  kind: string;
  template: string;
  title: string;
  matterId: string | null;
  createdAt: string;
  unsupportedCount: number;
  /**
   * Additive (W14 B-26): when THIS version was written. `GET /v1/drafts` had
   * no time column at all, and the version list repeated the draft's original
   * creation time for every version (UXAUDIT P1-4).
   */
  updatedAt?: string;
}

export interface PgDraftStoreOptions {
  sql: Sql;
  tenantId?: string;
  /** In-memory cache capacity (default 64, like InMemoryDraftStore). */
  capacity?: number;
  log?: (line: string) => void;
}

export const MAX_DRAFT_LIST_LIMIT = 200;
export const DEFAULT_DRAFT_LIST_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_DRAFT_LIST_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_DRAFT_LIST_LIMIT);
}

/** `draft.version` normalized to a positive integer (absent -> 1). */
export function draftVersionOf(draft: { version?: number }): number {
  const v = draft.version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : 1;
}

export class PgDraftStore<D extends StorableDraft = StorableDraft> {
  private readonly sql: Sql;
  private readonly tenantId: string;
  private readonly capacity: number;
  private readonly log: (line: string) => void;
  private readonly cache = new Map<string, D>();
  private readonly pending = new Set<Promise<void>>();
  /** Outcome of the LAST persist per draft (W12-FIX: `persisted(draftId)`). */
  private readonly lastPersist = new Map<string, Promise<boolean>>();
  /** In-flight ordering survives cache eviction; unrelated drafts remain parallel. */
  private readonly writes = new Map<string, Promise<boolean>>();

  constructor(options: PgDraftStoreOptions) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
    this.capacity = options.capacity ?? 64;
    if (!Number.isInteger(this.capacity) || this.capacity < 1) {
      throw new RangeError("draft store capacity must be a positive integer");
    }
    this.log = options.log ?? ((line) => process.stderr.write(line + "\n"));
  }

  /** Cache the draft as its latest version and append the version row. */
  put(draft: D): void {
    const previous = this.writes.get(draft.draftId);
    const snapshot = structuredClone(draft);
    const write = previous === undefined
      ? this.persist(snapshot)
      : previous.then(() => this.persist(snapshot));
    const job = write.then(
      () => true,
      (error: unknown) => {
        this.log(
          `[collex] DRAFT_PERSIST_FAILED draftId=${draft.draftId} version=${draftVersionOf(draft)}: ` +
            describeStoreError(error),
        );
        return false;
      },
    );
    this.writes.set(draft.draftId, job);
    this.lastPersist.set(draft.draftId, job);
    this.cacheDraft(draft.draftId, draft);
    this.track(job.then(() => {
      if (this.writes.get(draft.draftId) === job) {
        this.writes.delete(draft.draftId);
        if (!this.cache.has(draft.draftId)) this.lastPersist.delete(draft.draftId);
      }
    }));
  }

  /** Did the last `put` of this draft reach the database? (Awaits it.) */
  async persisted(draftId: string): Promise<boolean> {
    const job = this.lastPersist.get(draftId);
    return job === undefined ? true : job;
  }

  /**
   * The matter is gone (DELETE /v1/matters/{id}): null the matter on every
   * stored version and on the cached entry, in the column AND inside the
   * body, so the next version row does not trip drafts_matter_id_fkey.
   */
  async detachMatter(matterId: string): Promise<void> {
    const target = assertUuid(matterId, "matterId");
    await this.flush();
    await this.sql`
      update app_private.drafts
      set matter_id = null, body = body || '{"matterId":null}'::jsonb
      where tenant_id = ${this.tenantId} and matter_id = ${target}`;
    for (const cached of this.cache.values()) {
      if (cached.matterId === target) cached.matterId = null;
    }
  }

  /** Highest version the cache holds (call `warm` first after a restart). */
  get(draftId: string): D | undefined {
    return this.cache.get(draftId);
  }

  async warm(draftId: string): Promise<void> {
    if (this.cache.has(draftId)) return;
    if (typeof draftId !== "string" || draftId === "" || draftId.length > 200) return;
    const rows = await this.sql`
      select body
      from app_private.drafts
      where tenant_id = ${this.tenantId} and draft_id = ${draftId}
      order by version_no desc
      limit 1`;
    const body = rows[0]?.["body"];
    if (body === undefined || body === null || typeof body !== "object") return;
    // A concurrent save may have populated the cache while SELECT was pending.
    if (!this.cache.has(draftId)) this.cacheDraft(draftId, body as D);
  }

  /**
   * Latest version of every draft, newest first; optionally one matter's and
   * (W14 B-26/B-29) optionally filtered by a substring of the TITLE — the
   * `?q=` that `/v1/drafts` accepted and silently ignored.
   *
   * `updated_at` is read out of the stored body (`body ->> 'updatedAt'`) and
   * falls back to `created_at`: the table has no updated_at column, and every
   * version row carried the draft's ORIGINAL creation time, so a version list
   * showed the same timestamp for v1 and v2 (UXAUDIT P1-4).
   */
  async list(opts: { matterId?: string; limit?: number; q?: string } = {}): Promise<DraftSummaryRow[]> {
    const sql = this.sql;
    const limit = clampLimit(opts.limit);
    const matterId = opts.matterId === undefined ? undefined : assertUuid(opts.matterId, "matterId");
    const matterClause = matterId === undefined ? sql`` : sql`and matter_id = ${matterId}`;
    const q = typeof opts.q === "string" ? opts.q.trim() : "";
    const qClause =
      q === "" ? sql`` : sql`and title ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"}`;
    const rows = await sql`
      select * from (
        select distinct on (draft_id)
          draft_id, version_no, kind, template, title, matter_id,
          created_at, unsupported_count,
          coalesce(body ->> 'updatedAt', to_char(created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as updated_at
        from app_private.drafts
        where tenant_id = ${this.tenantId} ${matterClause} ${qClause}
        order by draft_id, version_no desc
      ) latest
      order by created_at desc, draft_id
      limit ${limit}`;
    return rows.map(rowToSummary);
  }

  /** Every stored version of one draft, highest first. */
  async versions(draftId: string): Promise<DraftSummaryRow[]> {
    const rows = await this.sql`
      select draft_id, version_no, kind, template, title, matter_id,
             created_at, unsupported_count,
             coalesce(body ->> 'updatedAt', to_char(created_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as updated_at
      from app_private.drafts
      where tenant_id = ${this.tenantId} and draft_id = ${draftId}
      order by version_no desc`;
    return rows.map(rowToSummary);
  }

  /**
   * W14 (B-26): the BODY of one stored version — "sürüm var, geri dönüş yok"
   * ends here. Undefined when the draft or that version does not exist.
   */
  async getVersionBody(draftId: string, version: number): Promise<Record<string, unknown> | undefined> {
    if (typeof draftId !== "string" || draftId === "" || draftId.length > 200) return undefined;
    if (!Number.isInteger(version) || version < 1) return undefined;
    await this.flush();
    const rows = await this.sql`
      select body
      from app_private.drafts
      where tenant_id = ${this.tenantId} and draft_id = ${draftId} and version_no = ${version}`;
    const body = rows[0]?.["body"];
    if (body === null || body === undefined || typeof body !== "object") return undefined;
    return body as Record<string, unknown>;
  }

  /**
   * W14 (B-26): delete EVERY version of a draft plus the cached entry.
   * Returns false when the id names nothing (second DELETE answers 404).
   */
  async remove(draftId: string): Promise<boolean> {
    if (typeof draftId !== "string" || draftId === "" || draftId.length > 200) return false;
    await this.flush();
    const inCache = this.cache.has(draftId);
    const rows = await this.sql`
      delete from app_private.drafts
      where tenant_id = ${this.tenantId} and draft_id = ${draftId}
      returning draft_id`;
    this.cache.delete(draftId);
    this.lastPersist.delete(draftId);
    return rows.length > 0 || inCache;
  }

  /** Await every background persist (tests, shutdown). Never rejects. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  get size(): number {
    return this.cache.size;
  }

  private cacheDraft(draftId: string, draft: D): void {
    this.cache.delete(draftId);
    this.cache.set(draftId, draft);
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) break;
      this.cache.delete(oldest.value);
      if (!this.writes.has(oldest.value)) this.lastPersist.delete(oldest.value);
    }
  }

  private track(job: Promise<void>): void {
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  private async persist(draft: D): Promise<void> {
    const version = draftVersionOf(draft);
    const matterId =
      draft.matterId === undefined || draft.matterId === null
        ? null
        : assertUuid(draft.matterId, "matterId");
    const createdMs = Date.parse(draft.createdAt);
    const createdAt = Number.isFinite(createdMs)
      ? new Date(createdMs).toISOString()
      : new Date().toISOString();
    const unsupported =
      Number.isInteger(draft.unsupportedCount) && draft.unsupportedCount >= 0
        ? draft.unsupportedCount
        : 0;
    try {
      await this.insertVersion(draft, version, matterId, unsupported, createdAt);
    } catch (error) {
      // W12-FIX (02.09.2026): the draft still names a matter that no longer
      // exists (deleted while the draft lived in the cache, or by another
      // process). The FK refused the row and EVERY later version was lost
      // on restart while the route answered 200. The version is written
      // without the matter and the cached entry forgets it too.
      if (!isForeignKeyViolation(error) || matterId === null) throw error;
      this.log(
        `[collex] DRAFT_MATTER_GONE draftId=${draft.draftId} version=${version} matterId=${matterId}: ` +
          "sürüm dosyasız kaydedildi",
      );
      const cached = this.cache.get(draft.draftId);
      if (cached !== undefined && cached.matterId === matterId) cached.matterId = null;
      if (draft.matterId === matterId) draft.matterId = null;
      await this.insertVersion(draft, version, null, unsupported, createdAt);
    }
  }

  private async insertVersion(
    draft: D,
    version: number,
    matterId: string | null,
    unsupported: number,
    createdAt: string,
  ): Promise<void> {
    await this.sql`
      insert into app_private.drafts
        (draft_id, version_no, tenant_id, matter_id, kind, template, title,
         unsupported_count, body, created_at)
      values
        (${draft.draftId}, ${version}, ${this.tenantId}, ${matterId},
         ${draft.kind}, ${draft.template}, ${draft.title}, ${unsupported},
         ${this.sql.json(draft as never)}, ${createdAt}::timestamptz)
      on conflict (draft_id, version_no) do update set
        matter_id = excluded.matter_id,
        kind = excluded.kind,
        template = excluded.template,
        title = excluded.title,
        unsupported_count = excluded.unsupported_count,
        body = excluded.body`;
  }
}

/** SQLSTATE 23503 — the row names a parent that does not exist. */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23503"
  );
}

function rowToSummary(row: SqlRow): DraftSummaryRow {
  const matter = row["matter_id"];
  const created = row["created_at"];
  const version = row["version_no"];
  const unsupported = row["unsupported_count"];
  const updated = row["updated_at"];
  return {
    ...(typeof updated === "string" && updated !== ""
      ? { updatedAt: updated }
      : updated instanceof Date
        ? { updatedAt: updated.toISOString() }
        : {}),
    draftId: String(row["draft_id"]),
    version: typeof version === "number" ? version : Number(version ?? 1),
    kind: typeof row["kind"] === "string" ? row["kind"] : "",
    template: typeof row["template"] === "string" ? row["template"] : "",
    title: typeof row["title"] === "string" ? row["title"] : "",
    matterId: typeof matter === "string" ? matter : null,
    createdAt: created instanceof Date ? created.toISOString() : String(created ?? ""),
    unsupportedCount: typeof unsupported === "number" ? unsupported : Number(unsupported ?? 0),
  };
}
