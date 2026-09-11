/**
 * Persistence for the multi-document review grid (W20).
 *
 * The grid used to live in the browser: a loop over (document x question)
 * that called /v1/answer once per cell and kept every result in page memory.
 * Closing the tab lost it; a restart lost it; one failed cell could only be
 * retried by re-running everything. This store makes the SAME grid durable:
 * the definition, the pinned document versions, and one row per cell with a
 * lease and a retry budget — the pattern the exhaustive analysis ledger
 * uses — so cells are independently retryable and a restart resumes at the
 * next unfinished cell.
 */

import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID } from "../exhaustive/store.js";

export const REVIEW_TABLE_GENERATOR_VERSION = "grid-v2";

export type ColumnMode = "answer" | "extract_dates" | "extract_amounts" | "extract_ratios";
export type CellState = "pending" | "running" | "done" | "failed" | "cancelled";
export type SupportState =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "abstained"
  | "no_evidence"
  | "exhaustive_complete"
  | "exhaustive_incomplete";

export interface CellProvenance {
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly chunkId?: string | undefined;
  readonly startChar: number;
  readonly endChar: number;
  readonly quoteSha256: string;
  readonly locator?: string | undefined;
}

export interface NewReviewTable {
  readonly title: string;
  readonly matterId: string | null;
  readonly options: { asOf?: string; useLocalAi?: boolean };
  readonly columns: ReadonlyArray<{ question: string; mode: ColumnMode }>;
  readonly rows: ReadonlyArray<{ fileId: string; fileName: string; documentVersionId: string | null }>;
}

export interface ReviewTableRow {
  readonly tableId: string;
  readonly matterId: string | null;
  readonly title: string;
  readonly status: "queued" | "running" | "done" | "cancelled";
  readonly options: { asOf?: string; useLocalAi?: boolean };
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly cancelRequested: boolean;
}

export interface ReviewColumn {
  readonly columnNo: number;
  readonly question: string;
  readonly mode: ColumnMode;
}

export interface ReviewRowDoc {
  readonly rowNo: number;
  readonly fileId: string;
  readonly fileName: string | null;
  readonly documentVersionId: string | null;
}

export interface ReviewCell {
  readonly rowNo: number;
  readonly columnNo: number;
  readonly state: CellState;
  readonly attempts: number;
  readonly answerStatus: string | null;
  readonly answerText: string | null;
  readonly supportState: SupportState | null;
  readonly provenance: CellProvenance[];
  readonly processingCoverage: unknown;
  readonly answerRunId: string | null;
  readonly generatorVersion: string | null;
  readonly error: string | null;
}

export interface CellClaim {
  readonly tableId: string;
  readonly rowNo: number;
  readonly columnNo: number;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface CellResult {
  readonly answerStatus: string;
  readonly answerText: string;
  readonly supportState: SupportState;
  readonly provenance: readonly CellProvenance[];
  readonly processingCoverage?: unknown;
  readonly answerRunId?: string | undefined;
}

export interface ReviewProgress {
  readonly total: number;
  readonly pending: number;
  readonly running: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled: number;
}

function json(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(JSON.parse(JSON.stringify(value)) as never);
}

function text(row: SqlRow, column: string): string {
  return String(row[column] ?? "");
}

function textOrNull(row: SqlRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

export class PgReviewTableStore {
  constructor(
    private readonly sql: Sql,
    readonly tenantId: string = LOCAL_TENANT_ID,
  ) {}

  /** Current version of each upload, tenant-scoped (the rows' pins). */
  async currentUploads(fileIds: readonly string[]): Promise<Map<string, { versionId: string; title: string }>> {
    const out = new Map<string, { versionId: string; title: string }>();
    const ids = [...new Set(fileIds)];
    if (ids.length === 0) return out;
    const rows = await this.sql`
      select d.external_id as file_id, v.id::text as version_id,
             coalesce(d.title, d.external_id) as title
      from legal.documents d
      join legal.document_versions v on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant' and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = any(${ids}::text[])`;
    for (const row of rows) {
      out.set(text(row, "file_id"), { versionId: text(row, "version_id"), title: text(row, "title") });
    }
    return out;
  }

  /** Definition, rows, columns and every cell — one transaction. */
  async create(input: NewReviewTable): Promise<string> {
    return (await this.sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const rows = await t`
        insert into app_private.review_tables
          (tenant_id, matter_id, title, status, generator_version, scope, options)
        values (${this.tenantId}::uuid, ${input.matterId}::uuid, ${input.title}, 'queued',
                ${REVIEW_TABLE_GENERATOR_VERSION},
                ${json(t, { fileIds: input.rows.map((row) => row.fileId) })},
                ${json(t, input.options)})
        returning table_id::text as table_id`;
      const tableId = text(rows[0] as SqlRow, "table_id");
      for (let index = 0; index < input.columns.length; index += 1) {
        const column = input.columns[index]!;
        await t`
          insert into app_private.review_table_columns (table_id, column_no, tenant_id, question, mode)
          values (${tableId}::uuid, ${index + 1}, ${this.tenantId}::uuid, ${column.question}, ${column.mode})`;
      }
      for (let index = 0; index < input.rows.length; index += 1) {
        const row = input.rows[index]!;
        await t`
          insert into app_private.review_table_rows
            (table_id, row_no, tenant_id, file_id, file_name, document_version_id)
          values (${tableId}::uuid, ${index + 1}, ${this.tenantId}::uuid, ${row.fileId},
                  ${row.fileName}, ${row.documentVersionId}::uuid)`;
      }
      await t`
        insert into app_private.review_table_cells (table_id, row_no, column_no, tenant_id)
        select ${tableId}::uuid, r.row_no, c.column_no, ${this.tenantId}::uuid
        from app_private.review_table_rows r
        cross join app_private.review_table_columns c
        where r.table_id = ${tableId}::uuid and c.table_id = ${tableId}::uuid`;
      return tableId;
    })) as unknown as string;
  }

  async recoverStale(): Promise<number> {
    const rows = await this.sql`
      update app_private.review_table_cells
      set state = case when attempts >= max_attempts then 'failed' else 'pending' end,
          error = case when attempts >= max_attempts
                       then 'Hücreyi hesaplayan süreç durdu ve deneme hakkı bitti.'
                       else error end,
          lease_owner = null, lease_expires_at = null, available_at = now(), updated_at = now()
      where tenant_id = ${this.tenantId}::uuid and state = 'running' and lease_expires_at < now()
      returning table_id`;
    return rows.length;
  }

  /** Apply cancellations: pending cells of a cancelled table never run. */
  async applyCancellations(): Promise<number> {
    const tables = await this.sql`
      update app_private.review_tables
      set status = 'cancelled', finished_at = now(), updated_at = now()
      where tenant_id = ${this.tenantId}::uuid and cancel_requested_at is not null
        and status in ('queued', 'running')
      returning table_id::text as table_id`;
    for (const row of tables) {
      await this.sql`
        update app_private.review_table_cells
        set state = 'cancelled', updated_at = now()
        where table_id = ${text(row, "table_id")}::uuid and state = 'pending'`;
    }
    return tables.length;
  }

  async claimCells(workerId: string, batch: number, leaseMs: number): Promise<CellClaim[]> {
    const rows = await this.sql`
      with candidate as (
        select c.table_id, c.row_no, c.column_no
        from app_private.review_table_cells c
        join app_private.review_tables t on t.table_id = c.table_id
        where c.tenant_id = ${this.tenantId}::uuid and t.tenant_id = ${this.tenantId}::uuid
          and c.state = 'pending' and c.available_at <= now()
          and t.status in ('queued', 'running') and t.cancel_requested_at is null
        order by t.created_at, c.row_no, c.column_no
        for update of c skip locked
        limit ${Math.max(1, Math.floor(batch))}
      )
      update app_private.review_table_cells c
      set state = 'running', attempts = c.attempts + 1, lease_owner = ${workerId},
          lease_expires_at = now() + (${Math.max(1, Math.floor(leaseMs))}::int * interval '1 millisecond'),
          started_at = now(), updated_at = now(), error = null
      from candidate k
      where c.table_id = k.table_id and c.row_no = k.row_no and c.column_no = k.column_no
      returning c.table_id::text as table_id, c.row_no, c.column_no, c.attempts, c.max_attempts`;
    const claims = rows.map((row) => ({
      tableId: text(row, "table_id"),
      rowNo: Number(row["row_no"]),
      columnNo: Number(row["column_no"]),
      attempts: Number(row["attempts"]),
      maxAttempts: Number(row["max_attempts"]),
    }));
    const tables = [...new Set(claims.map((claim) => claim.tableId))];
    if (tables.length > 0) {
      await this.sql`
        update app_private.review_tables set status = 'running', updated_at = now()
        where table_id = any(${tables}::uuid[]) and status = 'queued'`;
    }
    return claims;
  }

  /** Everything one cell needs to be computed. */
  async cellContext(claim: CellClaim): Promise<
    | {
        question: string;
        mode: ColumnMode;
        fileId: string;
        fileName: string | null;
        documentVersionId: string | null;
        matterId: string | null;
        options: { asOf?: string; useLocalAi?: boolean };
      }
    | undefined
  > {
    const rows = await this.sql`
      select c.question, c.mode, r.file_id, r.file_name,
             r.document_version_id::text as document_version_id,
             t.matter_id::text as matter_id, t.options
      from app_private.review_tables t
      join app_private.review_table_columns c on c.table_id = t.table_id and c.column_no = ${claim.columnNo}
      join app_private.review_table_rows r on r.table_id = t.table_id and r.row_no = ${claim.rowNo}
      where t.table_id = ${claim.tableId}::uuid and t.tenant_id = ${this.tenantId}::uuid`;
    const row = rows[0];
    if (row === undefined) return undefined;
    const options = row["options"];
    return {
      question: text(row, "question"),
      mode: text(row, "mode") as ColumnMode,
      fileId: text(row, "file_id"),
      fileName: textOrNull(row, "file_name"),
      documentVersionId: textOrNull(row, "document_version_id"),
      matterId: textOrNull(row, "matter_id"),
      options: options !== null && typeof options === "object" ? (options as { asOf?: string; useLocalAi?: boolean }) : {},
    };
  }

  async completeCell(claim: CellClaim, workerId: string, result: CellResult): Promise<boolean> {
    const rows = await this.sql`
      update app_private.review_table_cells
      set state = 'done', lease_owner = null, lease_expires_at = null,
          answer_status = ${result.answerStatus},
          answer_text = ${result.answerText.slice(0, 8000)},
          support_state = ${result.supportState},
          provenance = ${json(this.sql, result.provenance)},
          processing_coverage = ${result.processingCoverage === undefined ? null : json(this.sql, result.processingCoverage)},
          answer_run_id = ${result.answerRunId ?? null},
          generator_version = ${REVIEW_TABLE_GENERATOR_VERSION},
          error = null, finished_at = now(), updated_at = now()
      where table_id = ${claim.tableId}::uuid and row_no = ${claim.rowNo}
        and column_no = ${claim.columnNo} and tenant_id = ${this.tenantId}::uuid
        and state = 'running' and lease_owner = ${workerId}
      returning row_no`;
    return rows.length > 0;
  }

  async failCell(claim: CellClaim, workerId: string, message: string, backoffMs: number): Promise<void> {
    await this.sql`
      update app_private.review_table_cells
      set state = case when attempts >= max_attempts then 'failed' else 'pending' end,
          available_at = case when attempts >= max_attempts then available_at
                              else now() + (${Math.max(0, Math.floor(backoffMs))}::int * interval '1 millisecond') end,
          error = ${message.slice(0, 500)}, lease_owner = null, lease_expires_at = null,
          finished_at = case when attempts >= max_attempts then now() else finished_at end,
          updated_at = now()
      where table_id = ${claim.tableId}::uuid and row_no = ${claim.rowNo}
        and column_no = ${claim.columnNo} and tenant_id = ${this.tenantId}::uuid
        and state = 'running' and lease_owner = ${workerId}`;
  }

  /** Close tables with nothing pending or running. */
  async finishIdleTables(): Promise<number> {
    const rows = await this.sql`
      update app_private.review_tables t
      set status = 'done', finished_at = now(), updated_at = now()
      where t.tenant_id = ${this.tenantId}::uuid and t.status in ('queued', 'running')
        and t.cancel_requested_at is null
        and not exists (select 1 from app_private.review_table_cells c
                        where c.table_id = t.table_id and c.state in ('pending', 'running'))
      returning t.table_id`;
    return rows.length;
  }

  /** Put ONE cell back in the queue (its own retry; nothing else reruns). */
  async retryCell(tableId: string, rowNo: number, columnNo: number): Promise<"queued" | "not_found" | "busy"> {
    const rows = await this.sql`
      update app_private.review_table_cells
      set state = 'pending', attempts = 0, available_at = now(), error = null,
          lease_owner = null, lease_expires_at = null, updated_at = now()
      where table_id = ${tableId}::uuid and row_no = ${rowNo} and column_no = ${columnNo}
        and tenant_id = ${this.tenantId}::uuid and state in ('done', 'failed', 'cancelled')
      returning row_no`;
    if (rows.length === 0) {
      const exists = await this.sql`
        select state from app_private.review_table_cells
        where table_id = ${tableId}::uuid and row_no = ${rowNo} and column_no = ${columnNo}
          and tenant_id = ${this.tenantId}::uuid`;
      return exists.length === 0 ? "not_found" : "busy";
    }
    await this.sql`
      update app_private.review_tables
      set status = 'running', finished_at = null, cancel_requested_at = null, updated_at = now()
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    return "queued";
  }

  async requestCancel(tableId: string): Promise<boolean> {
    const rows = await this.sql`
      update app_private.review_tables
      set cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid
        and status in ('queued', 'running')
      returning table_id`;
    return rows.length > 0;
  }

  async getTable(tableId: string): Promise<
    | { table: ReviewTableRow; columns: ReviewColumn[]; rows: ReviewRowDoc[]; cells: ReviewCell[] }
    | undefined
  > {
    const tables = await this.sql`
      select table_id::text as table_id, matter_id::text as matter_id, title, status,
             options, created_at, finished_at, cancel_requested_at
      from app_private.review_tables
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    const row = tables[0];
    if (row === undefined) return undefined;
    const columns = await this.sql`
      select column_no, question, mode from app_private.review_table_columns
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid order by column_no`;
    const docs = await this.sql`
      select row_no, file_id, file_name, document_version_id::text as document_version_id
      from app_private.review_table_rows
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid order by row_no`;
    const cells = await this.sql`
      select row_no, column_no, state, attempts, answer_status, answer_text, support_state,
             provenance, processing_coverage, answer_run_id, generator_version, error
      from app_private.review_table_cells
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid
      order by row_no, column_no`;
    return {
      table: mapTable(row),
      columns: columns.map((column) => ({
        columnNo: Number(column["column_no"]),
        question: text(column, "question"),
        mode: text(column, "mode") as ColumnMode,
      })),
      rows: docs.map((doc) => ({
        rowNo: Number(doc["row_no"]),
        fileId: text(doc, "file_id"),
        fileName: textOrNull(doc, "file_name"),
        documentVersionId: textOrNull(doc, "document_version_id"),
      })),
      cells: cells.map((cell) => ({
        rowNo: Number(cell["row_no"]),
        columnNo: Number(cell["column_no"]),
        state: text(cell, "state") as CellState,
        attempts: Number(cell["attempts"]),
        answerStatus: textOrNull(cell, "answer_status"),
        answerText: textOrNull(cell, "answer_text"),
        supportState: textOrNull(cell, "support_state") as SupportState | null,
        provenance: Array.isArray(cell["provenance"]) ? (cell["provenance"] as CellProvenance[]) : [],
        processingCoverage: cell["processing_coverage"] ?? null,
        answerRunId: textOrNull(cell, "answer_run_id"),
        generatorVersion: textOrNull(cell, "generator_version"),
        error: textOrNull(cell, "error"),
      })),
    };
  }

  async listTables(matterId: string | null, limit = 20): Promise<ReviewTableRow[]> {
    const rows =
      matterId === null
        ? await this.sql`
            select table_id::text as table_id, matter_id::text as matter_id, title, status,
                   options, created_at, finished_at, cancel_requested_at
            from app_private.review_tables where tenant_id = ${this.tenantId}::uuid
            order by created_at desc limit ${Math.max(1, Math.min(100, limit))}`
        : await this.sql`
            select table_id::text as table_id, matter_id::text as matter_id, title, status,
                   options, created_at, finished_at, cancel_requested_at
            from app_private.review_tables
            where tenant_id = ${this.tenantId}::uuid and matter_id = ${matterId}::uuid
            order by created_at desc limit ${Math.max(1, Math.min(100, limit))}`;
    return rows.map(mapTable);
  }

  async progress(tableId: string): Promise<ReviewProgress> {
    const rows = await this.sql`
      select state, count(*)::int as n from app_private.review_table_cells
      where table_id = ${tableId}::uuid and tenant_id = ${this.tenantId}::uuid group by state`;
    const counts = new Map(rows.map((row) => [text(row, "state"), Number(row["n"])]));
    const get = (state: string): number => counts.get(state) ?? 0;
    return {
      total: [...counts.values()].reduce((sum, n) => sum + n, 0),
      pending: get("pending"),
      running: get("running"),
      done: get("done"),
      failed: get("failed"),
      cancelled: get("cancelled"),
    };
  }
}

function mapTable(row: SqlRow): ReviewTableRow {
  const options = row["options"];
  return {
    tableId: text(row, "table_id"),
    matterId: textOrNull(row, "matter_id"),
    title: text(row, "title"),
    status: text(row, "status") as ReviewTableRow["status"],
    options: options !== null && typeof options === "object" ? (options as ReviewTableRow["options"]) : {},
    createdAt: new Date(String(row["created_at"])).toISOString(),
    finishedAt:
      row["finished_at"] === null || row["finished_at"] === undefined
        ? null
        : new Date(String(row["finished_at"])).toISOString(),
    cancelRequested: row["cancel_requested_at"] !== null && row["cancel_requested_at"] !== undefined,
  };
}
