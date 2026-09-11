/**
 * Durable answer store (W12-A, contract [P]): write-through bounded cache +
 * app_private.answers.
 *
 * Diagnosis (audit 02.09.2026): answers lived only in InMemoryAnswerStore
 * (capacity 32) — gone after a restart AND after the 33rd question, so a
 * lawyer could not re-open the evidence bundle they had just exported.
 *
 * Design:
 *   - `put()` is SYNCHRONOUS and never throws: the entry goes into the
 *     in-memory cache at once (the HTTP route answers immediately) and the
 *     row is persisted in the background; a persistence failure is logged to
 *     stderr with a machine code (ANSWER_PERSIST_FAILED) and the answer
 *     remains servable from the cache for the life of the process.
 *   - `get()` reads the cache only. `warm(runId)` loads a missing runId from
 *     the database into the cache (the API calls `await store.warm?.(id)`
 *     before `get`), which is what makes GET /v1/answers/{runId} survive a
 *     restart and cache eviction.
 *   - The bundle is stored WITH canonical texts, so the Python exporter's
 *     full-chain verification (offset re-slice) still works later.
 *   - Single-user local mode: every row carries LOCAL_TENANT_ID and the
 *     connection is the owner (RLS bypass, documented). The tenant id is
 *     still written and filtered on so the same code is correct under RLS.
 *
 * `flush()` awaits in-flight persists — for tests and for a clean shutdown.
 */

import {
  InMemoryAnswerStore,
  clampListLimit,
  fileScopeOf,
  summarizeStoredAnswer,
  type AnswerListOptions,
  type AnswerMode,
  type AnswerStore,
  type AnswerSummary,
  type StoredAnswer,
} from "../api/answerService.js";
import type { Sql, SqlRow } from "./db.js";

/** Same value as drafting/types.ts LOCAL_TENANT_ID — re-declared, not imported (lane boundary). */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Throws RangeError for anything that is not a UUID (never reaches SQL). */
export function assertUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) {
    throw new RangeError(`${label} must be a UUID`);
  }
  return value;
}

/** Turn an unknown error into one safe stderr line: code + trimmed message. */
export function describeStoreError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const message = error.message.replace(/\s+/g, " ").slice(0, 200);
    return typeof code === "string" ? `${code}: ${message}` : message;
  }
  return String(error).slice(0, 200);
}

/** ISO timestamp for a stored entry, or "now" when the entry's is unusable. */
function safeTimestamp(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return safeTimestamp(value);
  return new Date().toISOString();
}

export interface PgAnswerStoreOptions {
  sql: Sql;
  /** Tenant every row is written with / read for (default LOCAL_TENANT_ID). */
  tenantId?: string;
  /** In-memory cache capacity (default 32, like InMemoryAnswerStore). */
  capacity?: number;
  /** stderr line sink (tests inject a collector). */
  log?: (line: string) => void;
}

export class PgAnswerStore implements AnswerStore {
  private readonly sql: Sql;
  private readonly tenantId: string;
  private readonly cache: InMemoryAnswerStore;
  private readonly log: (line: string) => void;
  private readonly pending = new Set<Promise<void>>();
  /** Outcome of the LAST persist per run (W12-FIX: `persisted(runId)`). */
  private readonly lastPersist = new Map<string, Promise<boolean>>();
  private static readonly LAST_PERSIST_CAP = 64;

  constructor(options: PgAnswerStoreOptions) {
    this.sql = options.sql;
    this.tenantId = assertUuid(options.tenantId ?? LOCAL_TENANT_ID, "tenantId");
    this.cache = new InMemoryAnswerStore(options.capacity ?? 32);
    this.log = options.log ?? ((line) => process.stderr.write(line + "\n"));
  }

  put(entry: StoredAnswer): void {
    this.cache.put(entry);
    const job = this.persist(entry).then(
      () => true,
      (error: unknown) => {
        this.log(
          `[collex] ANSWER_PERSIST_FAILED runId=${entry.runId}: ${describeStoreError(error)}`,
        );
        return false;
      },
    );
    this.lastPersist.delete(entry.runId);
    this.lastPersist.set(entry.runId, job);
    while (this.lastPersist.size > PgAnswerStore.LAST_PERSIST_CAP) {
      const oldest = this.lastPersist.keys().next();
      if (oldest.done === true) break;
      this.lastPersist.delete(oldest.value);
    }
    this.track(job.then(() => undefined));
  }

  /** Did the last `put` of this run reach the database? (Awaits it.) */
  async persisted(runId: string): Promise<boolean> {
    const job = this.lastPersist.get(runId);
    return job === undefined ? true : job;
  }

  get(runId: string): StoredAnswer | undefined {
    return this.cache.get(runId);
  }

  /** Load a runId the cache does not hold (restart / eviction) from the DB. */
  async warm(runId: string): Promise<void> {
    if (this.cache.get(runId) !== undefined) return;
    if (typeof runId !== "string" || runId === "" || runId.length > 200) return;
    const rows = await this.sql`
      select run_id, matter_id, question, mode, result, bundle, created_at
      from app_private.answers
      where tenant_id = ${this.tenantId} and run_id = ${runId}`;
    const row = rows[0];
    if (row === undefined) return;
    this.cache.put(rowToEntry(row));
  }

  /**
   * Newest first. `matterId` filters on the column; `fileId` (W12-API2)
   * filters by jsonb containment over the stored result — an answer matches
   * when `result.fileScope.fileIds` holds the id — so no schema change was
   * needed and the summary's `fileScope` is read from the same column
   * (`result -> 'fileScope'`), never re-derived.
   */
  async list(opts: AnswerListOptions = {}): Promise<AnswerSummary[]> {
    const limit = clampListLimit(opts.limit);
    const matterId = opts.matterId === undefined ? undefined : assertUuid(opts.matterId, "matterId");
    const fileId = opts.fileId;
    if (fileId !== undefined && (typeof fileId !== "string" || fileId === "" || fileId.length > 200)) {
      throw new RangeError("fileId must be a non-empty string of at most 200 characters");
    }
    const matterClause =
      matterId === undefined ? this.sql`` : this.sql`and a.matter_id = ${matterId}`;
    // W14 (B-26): `q` and `status` were accepted on the wire and dropped on
    // the floor. ILIKE with the caller's wildcard characters neutralised.
    const q = typeof opts.q === "string" ? opts.q.trim() : "";
    const qClause =
      q === ""
        ? this.sql``
        : this.sql`and a.question ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"}`;
    const statusClause =
      typeof opts.status === "string" && opts.status !== ""
        ? this.sql`and a.status = ${opts.status}`
        : this.sql``;
    // jsonb `@>`: {"fileIds":["x"]} is contained in any fileScope object whose
    // fileIds array holds "x" (array containment is element-wise).
    //
    // THE LEFT-HAND SIDE IS `result -> 'fileScope'`, NOT `result` (W14 F-PERF,
    // V-2). Both spellings are logically equivalent, but only this one matches
    // the index expression of `answers_filescope_gin`
    // (`gin ((result -> 'fileScope') jsonb_path_ops)`, migration
    // 20260903100000). The whole-column form `result @> {"fileScope":{...}}`
    // cannot use that index and ran a `Seq Scan on answers` on every document
    // page open — measured 02.09.2026 on a 2 000-answer probe database
    // (`collex_perf_test`): 1.9 ms sequential against 0.06 ms through the
    // index, with `pg_stat_user_indexes.idx_scan = 0` for the index the
    // migration was written for. `tests/store/persistence.test.ts` now pins
    // the Bitmap Index Scan, so the shape cannot drift back.
    //
    // The needle MUST go through `sql.json(...)`: a pre-stringified value
    // under an explicit `::jsonb` cast is JSON-encoded a second time by the
    // driver's jsonb serializer and arrives as a jsonb STRING, matching
    // nothing (measured 02.09.2026 on PostgreSQL 18 / postgres.js 3.4.9).
    const fileClause =
      fileId === undefined
        ? this.sql``
        : this.sql`and a.result -> 'fileScope' @> ${this.sql.json({ fileIds: [fileId] })}::jsonb`;
    // W14 (B-26): `matterTitle` comes from ONE left join instead of the
    // console's GET /v1/matters/{id} per row.
    const rows = await this.sql`
      select a.run_id, a.question, a.status, a.mode, a.matter_id, a.created_at,
             a.evidence_count, a.finalizable, a.result -> 'fileScope' as file_scope,
             m.title as matter_title
      from app_private.answers a
      left join app_private.matters m
        on m.id = a.matter_id and m.tenant_id = a.tenant_id
      where a.tenant_id = ${this.tenantId} ${matterClause} ${fileClause} ${qClause} ${statusClause}
      order by a.created_at desc, a.run_id
      limit ${limit}`;
    return rows.map(rowToSummary);
  }

  /**
   * W14 (B-26): delete one answer, cache row and durable row. Returns false
   * when the runId names nothing — the route answers 404 on a second call.
   */
  async remove(runId: string): Promise<boolean> {
    if (typeof runId !== "string" || runId === "" || runId.length > 200) return false;
    // A persist still in flight would re-insert the row after the delete.
    await this.flush();
    const inCache = this.cache.get(runId) !== undefined;
    const rows = await this.sql`
      delete from app_private.answers
      where tenant_id = ${this.tenantId} and run_id = ${runId}
      returning run_id`;
    await this.cache.remove(runId);
    this.lastPersist.delete(runId);
    return rows.length > 0 || inCache;
  }

  /** File an answer under a matter (null detaches). Unknown runId = no-op. */
  async attach(runId: string, matterId: string | null): Promise<void> {
    const target = matterId === null ? null : assertUuid(matterId, "matterId");
    // Make sure any in-flight insert for this run has landed first, or the
    // update would race the insert and silently attach nothing.
    await this.flush();
    await this.sql`
      update app_private.answers
      set matter_id = ${target}, updated_at = now()
      where tenant_id = ${this.tenantId} and run_id = ${runId}`;
    await this.cache.attach(runId, target);
  }

  /** Await every background persist (tests, shutdown). Never rejects. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  get size(): number {
    return this.cache.size;
  }

  private track(job: Promise<void>): void {
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  private async persist(entry: StoredAnswer): Promise<void> {
    const summary = summarizeStoredAnswer(entry);
    const keepMatter = entry.matterId === undefined;
    const matterId =
      entry.matterId === undefined || entry.matterId === null
        ? null
        : assertUuid(entry.matterId, "matterId");
    const asOfRaw = (entry.result as { asOf?: unknown } | undefined)?.asOf;
    const asOf = typeof asOfRaw === "string" && ISO_DATE_RE.test(asOfRaw) ? asOfRaw : null;
    const createdAt = safeTimestamp(entry.storedAt);
    try {
      await this.upsertRow(entry, summary, keepMatter, matterId, asOf, createdAt);
    } catch (error) {
      // W12-FIX: the matter was deleted while the run was in flight (the
      // pre-check passed, the insert hit answers_matter_id_fkey). The answer
      // is stored without the matter rather than lost.
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "23503" || matterId === null) throw error;
      this.log(`[collex] ANSWER_MATTER_GONE runId=${entry.runId} matterId=${matterId}: cevap dosyasız kaydedildi`);
      await this.upsertRow(entry, summary, false, null, asOf, createdAt);
      await this.cache.attach(entry.runId, null);
    }
  }

  private async upsertRow(
    entry: StoredAnswer,
    summary: ReturnType<typeof summarizeStoredAnswer>,
    keepMatter: boolean,
    matterId: string | null,
    asOf: string | null,
    createdAt: string,
  ): Promise<void> {
    await this.sql`
      insert into app_private.answers
        (run_id, tenant_id, matter_id, question, status, mode, finalizable,
         evidence_count, as_of, result, bundle, created_at, updated_at)
      values
        (${entry.runId}, ${this.tenantId}, ${matterId}, ${summary.question},
         ${summary.status}, ${summary.mode}, ${summary.finalizable},
         ${summary.evidenceCount}, ${asOf}, ${this.sql.json(entry.result as never)},
         ${this.sql.json(entry.bundle as never)}, ${createdAt}::timestamptz, now())
      on conflict (run_id) do update set
        matter_id = case when ${keepMatter} then app_private.answers.matter_id
                         else excluded.matter_id end,
        question = excluded.question,
        status = excluded.status,
        mode = excluded.mode,
        finalizable = excluded.finalizable,
        evidence_count = excluded.evidence_count,
        as_of = excluded.as_of,
        result = excluded.result,
        bundle = excluded.bundle,
        updated_at = now()`;
  }
}

function rowToEntry(row: SqlRow): StoredAnswer {
  const mode = row["mode"] === "live" ? "live" : "local";
  const matter = row["matter_id"];
  return {
    runId: String(row["run_id"]),
    result: row["result"] as StoredAnswer["result"],
    bundle: row["bundle"] as StoredAnswer["bundle"],
    storedAt: toIso(row["created_at"]),
    mode,
    question: typeof row["question"] === "string" ? row["question"] : "",
    matterId: typeof matter === "string" ? matter : null,
  };
}

function rowToSummary(row: SqlRow): AnswerSummary {
  const mode: AnswerMode = row["mode"] === "live" ? "live" : "local";
  const matter = row["matter_id"];
  const count = row["evidence_count"];
  const fileScope = fileScopeOf(row["file_scope"]);
  const matterTitle = row["matter_title"];
  return {
    runId: String(row["run_id"]),
    question: typeof row["question"] === "string" ? row["question"] : "",
    status: typeof row["status"] === "string" ? row["status"] : "",
    mode,
    matterId: typeof matter === "string" ? matter : null,
    createdAt: toIso(row["created_at"]),
    evidenceCount: typeof count === "number" ? count : Number(count ?? 0),
    finalizable: row["finalizable"] === true,
    ...(fileScope !== undefined ? { fileScope } : {}),
    ...(typeof matterTitle === "string" ? { matterTitle } : {}),
  };
}
