/**
 * Durable persistence for exhaustive Matter analysis (W20).
 *
 * The database is the durable truth of a run. Every state change a worker
 * makes is a small transaction whose outcome is either fully visible or not
 * visible at all:
 *
 *   createRun        run row + the WHOLE census, in one transaction. A crash
 *                    cannot leave a run with half its units.
 *   claimUnits       `for update skip locked` + a LEASE (owner + expiry). Two
 *                    workers never claim the same unit; a unit claimed by a
 *                    worker that died is recognisably stale.
 *   completeUnit     the unit's observations AND its `done` flag, in ONE
 *                    transaction, guarded by the lease. "Done" therefore
 *                    always means "its observations are stored", and a
 *                    worker that lost its lease cannot mark anything done.
 *   failUnit         retry with backoff while attempts remain, then a
 *                    TERMINAL failure (counted in coverage, never hidden).
 *   recoverStale     running units whose lease expired go back to pending
 *                    (or to failed when their attempts are spent).
 *   claimReduce      only a run with NO pending/running unit is reducible.
 *   saveReduceResult relations + intelligence + final coverage, replacing
 *                    any earlier attempt's rows, in ONE transaction.
 *
 * Reads and writes are tenant-scoped in SQL as well as by RLS (the local
 * deployment connects as the owner and bypasses RLS; see store.ts).
 */

import type { Sql, SqlRow } from "../store/db.js";
import type { RelationVerdict } from "./contradictions.js";
import { itemRef, type IntelItemDraft, type IntelLinkDraft, type StoredObservation } from "./intelligence.js";
import type { ProcessingCoverage } from "./processingCoverage.js";
import type { ScopedDocument, ScopedSegment, UnitLedgerRow } from "./runner.js";
import { LOCAL_TENANT_ID } from "./store.js";
import type { AnalysisTask } from "./tasks.js";
import { EXTRACTOR_VERSION, UNIT_BUILDER_VERSION } from "./runner.js";
import type { AnalysisUnit } from "./units.js";

export type RunStatus =
  | "queued"
  | "mapping"
  | "aggregating"
  | "reducing"
  | "done"
  | "failed"
  | "cancelled";

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["queued", "mapping", "aggregating", "reducing"];

/** A worker's claim is no longer valid (lease expired and taken over). */
export class LeaseLostError extends Error {
  constructor(message = "Çalışma kiralaması başka bir çalışana geçti.") {
    super(message);
    this.name = "LeaseLostError";
  }
}

/** What a run was created over. Stored verbatim in `snapshot`. */
export interface RunSnapshot {
  readonly versions: ReadonlyArray<readonly [string, string | null]>;
  readonly fileIds: readonly string[];
  readonly clientRole: string | null;
  /** Model the synthesis stage was created with (may differ from extraction). */
  readonly synthesisModel: string | null;
  /** The canonical identity JSON, kept for audit. */
  readonly identity: string;
}

export interface CreateRunInput {
  readonly matterId: string;
  readonly task: AnalysisTask;
  readonly identityKey: string;
  readonly snapshot: RunSnapshot;
  readonly units: readonly AnalysisUnit[];
  readonly modelId: string | null;
  readonly provider: string | null;
  readonly trust: string | null;
  readonly modelSchemaVersion: string | null;
  /** Retry budget per unit (default 3). */
  readonly maxAttempts?: number;
}

export interface NewObservation {
  readonly observationKey: string;
  readonly unitNo: number;
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly kind: string;
  readonly origin: "deterministic" | "model";
  readonly statement: string;
  readonly subject: string;
  readonly predicate: string;
  readonly occurredOn?: string | undefined;
  readonly datePrecision?: string | undefined;
  readonly startChar: number;
  readonly endChar: number;
  readonly quote: string;
  readonly quoteSha256: string;
  readonly locator?: string | undefined;
  readonly extractorVersion: string;
  readonly modelId?: string | undefined;
  readonly provider?: string | undefined;
  readonly modelSchemaVersion?: string | undefined;
  readonly confidence?: number | undefined;
  readonly metadata: Record<string, unknown>;
}

export interface UnitClaim {
  readonly runId: string;
  readonly unitNo: number;
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly sourceSha256: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly task: AnalysisTask;
  readonly matterId: string;
  readonly modelId: string | null;
}

export interface UnitCompletion {
  readonly rejectedQuotes: number;
  readonly invalidItems: number;
  readonly extractorVersion: string;
  readonly modelId?: string | undefined;
  readonly modelSchemaVersion?: string | undefined;
}

export interface ReduceClaim {
  readonly runId: string;
  readonly matterId: string;
  readonly task: AnalysisTask;
  readonly snapshot: RunSnapshot;
  readonly stageAttempts: number;
  readonly maxStageAttempts: number;
  readonly modelId: string | null;
}

export interface ReduceResult {
  readonly relations: readonly RelationVerdict[];
  readonly items: readonly IntelItemDraft[];
  readonly links: readonly IntelLinkDraft[];
  readonly coverage: ProcessingCoverage;
  readonly summary: Record<string, unknown>;
  readonly status: "done" | "failed";
  readonly error?: string | undefined;
}

export interface RunProgress {
  readonly total: number;
  readonly pending: number;
  readonly running: number;
  readonly done: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface DurableRunRow {
  readonly runId: string;
  readonly matterId: string;
  readonly task: AnalysisTask;
  readonly status: RunStatus;
  readonly coverage: ProcessingCoverage | undefined;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly snapshot: RunSnapshot | undefined;
  readonly summary: Record<string, unknown>;
  readonly cancelRequested: boolean;
  readonly modelId: string | null;
  readonly identityKey: string | null;
}

export interface FindingSource {
  readonly role: string;
  readonly observationId: string;
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly quote: string;
  readonly quoteSha256: string;
  readonly locator: string | null;
  readonly origin: string;
  /** The chunk the quote starts in, so the console can open that passage. */
  readonly chunkId: string | null;
}

export interface FindingItem {
  readonly itemId: string;
  readonly kind: string;
  readonly key: string;
  readonly title: string;
  readonly body: string | null;
  readonly occurredOn: string | null;
  readonly datePrecision: string | null;
  readonly partyRole: string | null;
  readonly stance: string | null;
  readonly supportStatus: string | null;
  readonly hypothetical: boolean;
  readonly confidence: number | null;
  readonly producer: string;
  readonly producerVersion: string;
  readonly modelId: string | null;
  readonly attributes: Record<string, unknown>;
  readonly sources: FindingSource[];
}

export interface FindingLink {
  readonly fromItemId: string;
  readonly toItemId: string;
  readonly linkKind: string;
  readonly rationale: string | null;
  readonly producer: string;
}

export interface FindingRelation {
  readonly relation: string;
  readonly rationale: string;
  readonly subjectOverlap: number | null;
  readonly left: { observationId: string; fileId: string; statement: string; locator: string | null };
  readonly right: { observationId: string; fileId: string; statement: string; locator: string | null };
}

export interface RunFindings {
  readonly items: FindingItem[];
  readonly links: FindingLink[];
  readonly relations: FindingRelation[];
  readonly fileNames: Record<string, string>;
}

export interface DurableAnalysisStore {
  readonly tenantId: string;
  currentVersions(fileIds: readonly string[]): Promise<Map<string, string>>;
  loadVersionDocuments(
    versions: ReadonlyArray<readonly [string, string | null]>,
    options: { withText: boolean },
  ): Promise<ScopedDocument[]>;
  findActiveRun(identityKey: string): Promise<string | undefined>;
  createRun(input: CreateRunInput): Promise<{ runId: string; resumed: boolean }>;
  recoverStale(): Promise<number>;
  claimCancellations(): Promise<string[]>;
  claimUnits(workerId: string, batch: number, leaseMs: number): Promise<UnitClaim[]>;
  releaseUnits(claims: readonly UnitClaim[], workerId: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  completeUnit(
    claim: UnitClaim,
    workerId: string,
    observations: readonly NewObservation[],
    completion: UnitCompletion,
  ): Promise<void>;
  failUnit(claim: UnitClaim, workerId: string, message: string, backoffMs: number): Promise<void>;
  claimReduce(workerId: string, leaseMs: number): Promise<ReduceClaim | undefined>;
  loadObservations(runId: string): Promise<StoredObservation[]>;
  loadLedger(runId: string): Promise<UnitLedgerRow[]>;
  saveReduceResult(runId: string, workerId: string, result: ReduceResult): Promise<void>;
  releaseReduce(runId: string, workerId: string, message: string, backoffMs: number): Promise<void>;
  finishCancelled(runId: string, coverage: ProcessingCoverage): Promise<void>;
  requestCancel(runId: string): Promise<"requested" | "not_active" | "not_found">;
  getRun(runId: string): Promise<DurableRunRow | undefined>;
  listRuns(matterId: string, limit?: number): Promise<DurableRunRow[]>;
  progress(runId: string): Promise<RunProgress>;
  loadFindings(runId: string): Promise<RunFindings>;
  latestFinishedRuns(matterId: string): Promise<DurableRunRow[]>;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

function jsonValue(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(JSON.parse(JSON.stringify(value)) as never);
}

function text(row: SqlRow, column: string): string {
  return String(row[column] ?? "");
}

function textOrNull(row: SqlRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

function numberOrNull(row: SqlRow, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(row: SqlRow, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : new Date(String(value)).toISOString();
}

function asSnapshot(value: unknown): RunSnapshot | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw["versions"])) return undefined;
  const versions = (raw["versions"] as unknown[])
    .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length === 2)
    .map(([fileId, versionId]) => [String(fileId), versionId === null ? null : String(versionId)] as const);
  return {
    versions,
    fileIds: Array.isArray(raw["fileIds"]) ? (raw["fileIds"] as unknown[]).map(String) : versions.map((v) => v[0]),
    clientRole: typeof raw["clientRole"] === "string" ? raw["clientRole"] : null,
    synthesisModel: typeof raw["synthesisModel"] === "string" ? raw["synthesisModel"] : null,
    identity: typeof raw["identity"] === "string" ? raw["identity"] : "",
  };
}

function asCoverage(value: unknown): ProcessingCoverage | undefined {
  return value !== null && typeof value === "object" && "complete" in value
    ? (value as ProcessingCoverage)
    : undefined;
}

const RUN_COLUMNS = `run_id::text as run_id, matter_id::text as matter_id, task, status, coverage,
  created_at, finished_at, error, snapshot, result_summary, cancel_requested_at, model_id, identity_key`;

function mapRun(row: SqlRow): DurableRunRow {
  const summary = row["result_summary"];
  return {
    runId: text(row, "run_id"),
    matterId: text(row, "matter_id"),
    task: text(row, "task") as AnalysisTask,
    status: text(row, "status") as RunStatus,
    coverage: asCoverage(row["coverage"]),
    createdAt: new Date(String(row["created_at"])).toISOString(),
    finishedAt: isoOrNull(row, "finished_at"),
    error: textOrNull(row, "error"),
    snapshot: asSnapshot(row["snapshot"]),
    summary: summary !== null && typeof summary === "object" ? (summary as Record<string, unknown>) : {},
    cancelRequested: row["cancel_requested_at"] !== null && row["cancel_requested_at"] !== undefined,
    modelId: textOrNull(row, "model_id"),
    identityKey: textOrNull(row, "identity_key"),
  };
}

export class PgDurableAnalysisStore implements DurableAnalysisStore {
  constructor(
    private readonly sql: Sql,
    readonly tenantId: string = LOCAL_TENANT_ID,
  ) {}

  async currentVersions(fileIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(fileIds)];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const rows = await this.sql`
      select d.external_id as file_id, v.id::text as version_id
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = any(${ids}::text[])`;
    for (const row of rows) out.set(text(row, "file_id"), text(row, "version_id"));
    return out;
  }

  async loadVersionDocuments(
    versions: ReadonlyArray<readonly [string, string | null]>,
    options: { withText: boolean },
  ): Promise<ScopedDocument[]> {
    const pinned = versions.filter((entry): entry is readonly [string, string] => entry[1] !== null);
    const byVersion = new Map<string, SqlRow>();
    if (pinned.length > 0) {
      const rows = await this.sql`
        select d.external_id as file_id,
               coalesce(d.title, d.external_id) as file_name,
               v.id::text as version_id,
               ${options.withText ? this.sql`v.canonical_text` : this.sql`null::text`} as canonical_text,
               char_length(v.canonical_text) as canonical_length
        from legal.document_versions v
        join legal.documents d on d.id = v.document_id
        where v.id = any(${pinned.map((entry) => entry[1])}::uuid[])
          and d.scope = 'tenant'
          and d.tenant_id = ${this.tenantId}::uuid`;
      for (const row of rows) byVersion.set(text(row, "version_id"), row);
    }

    const out: ScopedDocument[] = [];
    for (const [fileId, versionId] of versions) {
      const row = versionId === null ? undefined : byVersion.get(versionId);
      // A pinned version must belong to the file it is pinned for: an id
      // swapped between files would otherwise be read under the wrong name.
      if (row === undefined || text(row, "file_id") !== fileId || versionId === null) {
        out.push({
          fileId,
          fileName: fileId,
          documentVersionId: "00000000-0000-0000-0000-000000000000",
          canonicalText: "",
          canonicalLength: 0,
          spans: [],
          segments: [],
          extractionFailed: true,
        });
        continue;
      }
      const spans = options.withText
        ? await this.sql`
            select id::text as chunk_id, ordinal, start_char, end_char
            from legal.chunks
            where document_version_id = ${versionId}::uuid
            order by start_char, ordinal`
        : [];
      const segments = await this.sql`
        select locator_kind, locator_label, start_char, end_char,
               extraction_method, extraction_status
        from legal.document_version_segments
        where document_version_id = ${versionId}::uuid
        order by segment_no`;
      out.push({
        fileId,
        fileName: text(row, "file_name"),
        documentVersionId: versionId,
        canonicalText: options.withText ? text(row, "canonical_text") : "",
        canonicalLength: Number(row["canonical_length"] ?? 0),
        spans: spans.map((span) => ({
          chunkId: text(span, "chunk_id"),
          ordinal: Number(span["ordinal"]),
          startChar: Number(span["start_char"]),
          endChar: Number(span["end_char"]),
        })),
        segments: segments.map(
          (segment): ScopedSegment => ({
            locatorKind: text(segment, "locator_kind"),
            locatorLabel: text(segment, "locator_label"),
            startChar: Number(segment["start_char"]),
            endChar: Number(segment["end_char"]),
            extractionMethod: text(segment, "extraction_method"),
            extractionStatus: text(segment, "extraction_status") as ScopedSegment["extractionStatus"],
          }),
        ),
      });
    }
    return out;
  }

  async findActiveRun(identityKey: string): Promise<string | undefined> {
    const rows = await this.sql`
      select run_id::text as run_id
      from app_private.matter_analysis_runs
      where tenant_id = ${this.tenantId}::uuid
        and identity_key = ${identityKey}
        and status in ('queued', 'mapping', 'aggregating', 'reducing')
      limit 1`;
    return rows[0] === undefined ? undefined : text(rows[0], "run_id");
  }

  async createRun(input: CreateRunInput): Promise<{ runId: string; resumed: boolean }> {
    try {
      const runId = (await this.sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        const rows = await t`
          insert into app_private.matter_analysis_runs
            (tenant_id, matter_id, task, status, scope, identity_key, snapshot,
             unit_builder_version, extractor_version, model_schema_version,
             model_id, provider, provider_trust)
          values (${this.tenantId}::uuid, ${input.matterId}::uuid, ${input.task}, 'queued',
                  ${jsonValue(t, { fileIds: input.snapshot.fileIds })}, ${input.identityKey},
                  ${jsonValue(t, input.snapshot)}, ${UNIT_BUILDER_VERSION}, ${EXTRACTOR_VERSION},
                  ${input.modelSchemaVersion}, ${input.modelId}, ${input.provider}, ${input.trust})
          returning run_id::text as run_id`;
        const id = text(rows[0] as SqlRow, "run_id");
        // The census exists before any work, in the SAME transaction as the
        // run: a run is never visible with half its units.
        const unitRows = input.units.map((unit) => ({
          run_id: id,
          unit_no: unit.unitNo,
          tenant_id: this.tenantId,
          file_id: unit.fileId,
          document_version_id: unit.documentVersionId,
          start_char: unit.startChar,
          end_char: unit.endChar,
          source_sha256: unit.sourceSha256,
          state: "pending",
          max_attempts: input.maxAttempts ?? 3,
        }));
        for (let at = 0; at < unitRows.length; at += 500) {
          await t`insert into app_private.matter_analysis_units ${t(unitRows.slice(at, at + 500))}`;
        }
        return id;
      })) as unknown as string;
      return { runId, resumed: false };
    } catch (error) {
      // Two requests for the same work raced: the unique index let exactly
      // one census exist. The loser joins the winner's run.
      if (isUniqueViolation(error)) {
        const existing = await this.findActiveRun(input.identityKey);
        if (existing !== undefined) return { runId: existing, resumed: true };
      }
      throw error;
    }
  }

  async recoverStale(): Promise<number> {
    const rows = await this.sql`
      update app_private.matter_analysis_units
      set state = case when attempts >= max_attempts then 'failed' else 'pending' end,
          error = case when attempts >= max_attempts
                       then 'Bu bölümü işleyen süreç yanıt vermeden durdu ve deneme hakkı bitti.'
                       else 'Önceki deneme yarıda kaldı; yeniden denenecek.' end,
          lease_owner = null,
          lease_expires_at = null,
          available_at = now(),
          finished_at = case when attempts >= max_attempts then now() else finished_at end
      where tenant_id = ${this.tenantId}::uuid
        and state = 'running'
        and lease_expires_at < now()
      returning unit_no`;
    return rows.length;
  }

  async claimCancellations(): Promise<string[]> {
    const rows = await this.sql`
      update app_private.matter_analysis_runs
      set status = 'cancelled', finished_at = now(), updated_at = now(),
          lease_owner = null, lease_expires_at = null
      where tenant_id = ${this.tenantId}::uuid
        and cancel_requested_at is not null
        and status in ('queued', 'mapping', 'aggregating', 'reducing')
      returning run_id::text as run_id`;
    return rows.map((row) => text(row, "run_id"));
  }

  async claimUnits(workerId: string, batch: number, leaseMs: number): Promise<UnitClaim[]> {
    const rows = await this.sql`
      with candidate as (
        select u.run_id, u.unit_no
        from app_private.matter_analysis_units u
        join app_private.matter_analysis_runs r on r.run_id = u.run_id
        where u.tenant_id = ${this.tenantId}::uuid
          and r.tenant_id = ${this.tenantId}::uuid
          and u.state = 'pending'
          and u.available_at <= now()
          and r.status in ('queued', 'mapping')
          and r.cancel_requested_at is null
        order by r.created_at, u.run_id, u.unit_no
        for update of u skip locked
        limit ${Math.max(1, Math.floor(batch))}
      )
      update app_private.matter_analysis_units u
      set state = 'running',
          attempts = u.attempts + 1,
          lease_owner = ${workerId},
          lease_expires_at = now() + (${Math.max(1, Math.floor(leaseMs))}::int * interval '1 millisecond'),
          started_at = now(),
          error = null
      from candidate c, app_private.matter_analysis_runs r
      where u.run_id = c.run_id and u.unit_no = c.unit_no and r.run_id = u.run_id
      returning u.run_id::text as run_id, u.unit_no, u.file_id,
                u.document_version_id::text as version_id, u.start_char, u.end_char,
                u.source_sha256, u.attempts, u.max_attempts,
                r.task, r.matter_id::text as matter_id, r.model_id`;
    const claims = rows
      .map(
        (row): UnitClaim => ({
          runId: text(row, "run_id"),
          unitNo: Number(row["unit_no"]),
          fileId: text(row, "file_id"),
          documentVersionId: text(row, "version_id"),
          startChar: Number(row["start_char"]),
          endChar: Number(row["end_char"]),
          sourceSha256: text(row, "source_sha256"),
          attempts: Number(row["attempts"]),
          maxAttempts: Number(row["max_attempts"]),
          task: text(row, "task") as AnalysisTask,
          matterId: text(row, "matter_id"),
          modelId: textOrNull(row, "model_id"),
        }),
      )
      .sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : a.unitNo - b.unitNo));
    const runIds = [...new Set(claims.map((claim) => claim.runId))];
    if (runIds.length > 0) {
      await this.sql`
        update app_private.matter_analysis_runs
        set status = 'mapping', started_at = coalesce(started_at, now()), updated_at = now()
        where run_id = any(${runIds}::uuid[]) and status = 'queued'`;
    }
    return claims;
  }

  async releaseUnits(claims: readonly UnitClaim[], workerId: string): Promise<void> {
    for (const claim of claims) {
      await this.sql`
        update app_private.matter_analysis_units
        set state = 'pending', attempts = greatest(attempts - 1, 0),
            lease_owner = null, lease_expires_at = null
        where run_id = ${claim.runId}::uuid and unit_no = ${claim.unitNo}
          and tenant_id = ${this.tenantId}::uuid
          and state = 'running' and lease_owner = ${workerId}`;
    }
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    const rows = await this.sql`
      select (cancel_requested_at is not null
              or status not in ('queued', 'mapping', 'aggregating', 'reducing')) as stop
      from app_private.matter_analysis_runs
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    return rows[0] === undefined ? true : rows[0]["stop"] === true;
  }

  async completeUnit(
    claim: UnitClaim,
    workerId: string,
    observations: readonly NewObservation[],
    completion: UnitCompletion,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      // The lease guard comes FIRST and locks the unit row: a worker whose
      // lease expired and was taken over cannot write "done" — its whole
      // transaction rolls back and the new owner's result stands.
      const own = await t`
        select 1 from app_private.matter_analysis_units
        where run_id = ${claim.runId}::uuid and unit_no = ${claim.unitNo}
          and tenant_id = ${this.tenantId}::uuid
          and state = 'running' and lease_owner = ${workerId}
        for update`;
      if (own.length === 0) throw new LeaseLostError();
      for (const observation of observations) {
        await t`
          insert into app_private.matter_observations
            (run_id, tenant_id, matter_id, unit_no, kind, statement, subject,
             predicate, occurred_on, date_precision, document_version_id,
             file_id, start_char, end_char, quote, quote_sha256, locator,
             extractor_version, model_id, confidence, metadata,
             observation_key, origin, provider, model_schema_version)
          values (${claim.runId}::uuid, ${this.tenantId}::uuid, ${claim.matterId}::uuid,
                  ${observation.unitNo}, ${observation.kind},
                  ${observation.statement.slice(0, 4000) || observation.quote.slice(0, 4000)},
                  ${observation.subject}, ${observation.predicate},
                  ${observation.occurredOn ?? null}::date, ${observation.datePrecision ?? null},
                  ${observation.documentVersionId}::uuid, ${observation.fileId},
                  ${observation.startChar}, ${observation.endChar},
                  ${observation.quote}, ${observation.quoteSha256},
                  ${observation.locator ?? null}, ${observation.extractorVersion},
                  ${observation.modelId ?? null}, ${observation.confidence ?? null},
                  ${jsonValue(t, observation.metadata)}, ${observation.observationKey},
                  ${observation.origin}, ${observation.provider ?? null},
                  ${observation.modelSchemaVersion ?? null})
          on conflict (run_id, observation_key) do nothing`;
      }
      await t`
        update app_private.matter_analysis_units
        set state = 'done',
            lease_owner = null,
            lease_expires_at = null,
            finished_at = now(),
            error = null,
            extractor_version = ${completion.extractorVersion},
            model_id = ${completion.modelId ?? null},
            model_schema_version = ${completion.modelSchemaVersion ?? null},
            rejected_quotes = ${completion.rejectedQuotes},
            invalid_items = ${completion.invalidItems},
            observation_count = ${observations.length}
        where run_id = ${claim.runId}::uuid and unit_no = ${claim.unitNo}
          and tenant_id = ${this.tenantId}::uuid`;
    });
  }

  async failUnit(claim: UnitClaim, workerId: string, message: string, backoffMs: number): Promise<void> {
    await this.sql`
      update app_private.matter_analysis_units
      set state = case when attempts >= max_attempts then 'failed' else 'pending' end,
          available_at = case when attempts >= max_attempts then available_at
                              else now() + (${Math.max(0, Math.floor(backoffMs))}::int * interval '1 millisecond') end,
          finished_at = case when attempts >= max_attempts then now() else finished_at end,
          error = ${message.slice(0, 500)},
          lease_owner = null,
          lease_expires_at = null
      where run_id = ${claim.runId}::uuid and unit_no = ${claim.unitNo}
        and tenant_id = ${this.tenantId}::uuid
        and state = 'running' and lease_owner = ${workerId}`;
  }

  async claimReduce(workerId: string, leaseMs: number): Promise<ReduceClaim | undefined> {
    const rows = await this.sql`
      with candidate as (
        select r.run_id
        from app_private.matter_analysis_runs r
        where r.tenant_id = ${this.tenantId}::uuid
          and r.status in ('queued', 'mapping', 'aggregating', 'reducing')
          and r.cancel_requested_at is null
          and (r.lease_expires_at is null or r.lease_expires_at < now())
          and not exists (
            select 1 from app_private.matter_analysis_units u
            where u.run_id = r.run_id and u.state in ('pending', 'running'))
        order by r.created_at
        for update of r skip locked
        limit 1
      )
      update app_private.matter_analysis_runs r
      set status = 'reducing',
          lease_owner = ${workerId},
          lease_expires_at = now() + (${Math.max(1, Math.floor(leaseMs))}::int * interval '1 millisecond'),
          stage_attempts = r.stage_attempts + 1,
          updated_at = now()
      from candidate c
      where r.run_id = c.run_id
      returning r.run_id::text as run_id, r.matter_id::text as matter_id, r.task,
                r.snapshot, r.stage_attempts, r.max_stage_attempts, r.model_id`;
    const row = rows[0];
    if (row === undefined) return undefined;
    const snapshot = asSnapshot(row["snapshot"]) ?? {
      versions: [],
      fileIds: [],
      clientRole: null,
      synthesisModel: null,
      identity: "",
    };
    return {
      runId: text(row, "run_id"),
      matterId: text(row, "matter_id"),
      task: text(row, "task") as AnalysisTask,
      snapshot,
      stageAttempts: Number(row["stage_attempts"]),
      maxStageAttempts: Number(row["max_stage_attempts"]),
      modelId: textOrNull(row, "model_id"),
    };
  }

  async loadObservations(runId: string): Promise<StoredObservation[]> {
    const rows = await this.sql`
      select observation_id::text as observation_id, observation_key, unit_no, file_id,
             document_version_id::text as document_version_id, kind, origin, statement,
             subject, predicate, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on,
             date_precision, start_char, end_char, quote, quote_sha256, locator,
             extractor_version, model_id, provider, confidence, metadata
      from app_private.matter_observations
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
      order by file_id, unit_no, start_char, observation_key nulls last, observation_id`;
    return rows.map((row): StoredObservation => {
      const metadata = (row["metadata"] ?? {}) as Record<string, unknown>;
      const valueKind = metadata["valueKind"];
      const str = (key: string): string | undefined =>
        typeof metadata[key] === "string" ? (metadata[key] as string) : undefined;
      return {
        observationId: text(row, "observation_id"),
        observationKey: textOrNull(row, "observation_key"),
        unitNo: Number(row["unit_no"]),
        fileId: text(row, "file_id"),
        documentVersionId: text(row, "document_version_id"),
        kind: text(row, "kind"),
        origin: text(row, "origin") === "model" ? "model" : "deterministic",
        statement: text(row, "statement"),
        subject: text(row, "subject"),
        predicate: text(row, "predicate"),
        normalizedValue: str("normalizedValue") ?? "",
        ...(valueKind === "date" || valueKind === "amount" || valueKind === "ratio" ? { valueKind } : {}),
        ...(textOrNull(row, "occurred_on") !== null ? { occurredOn: text(row, "occurred_on") } : {}),
        ...(textOrNull(row, "date_precision") !== null ? { datePrecision: text(row, "date_precision") } : {}),
        startChar: Number(row["start_char"]),
        endChar: Number(row["end_char"]),
        quote: text(row, "quote"),
        quoteSha256: text(row, "quote_sha256"),
        ...(textOrNull(row, "locator") !== null ? { locator: text(row, "locator") } : {}),
        extractorVersion: text(row, "extractor_version"),
        ...(textOrNull(row, "model_id") !== null ? { modelId: text(row, "model_id") } : {}),
        ...(textOrNull(row, "provider") !== null ? { provider: text(row, "provider") } : {}),
        ...(numberOrNull(row, "confidence") !== null ? { confidence: numberOrNull(row, "confidence") as number } : {}),
        ...(str("party") !== undefined ? { party: str("party") } : {}),
        ...(str("role") !== undefined ? { role: str("role") } : {}),
        ...(str("entityType") !== undefined ? { entityType: str("entityType") } : {}),
      };
    });
  }

  async loadLedger(runId: string): Promise<UnitLedgerRow[]> {
    const rows = await this.sql`
      select unit_no, file_id, document_version_id::text as document_version_id,
             start_char, end_char, source_sha256, state, attempts, skip_reason,
             error, extractor_version
      from app_private.matter_analysis_units
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
      order by unit_no`;
    return rows.map((row): UnitLedgerRow => ({
      unitNo: Number(row["unit_no"]),
      fileId: text(row, "file_id"),
      documentVersionId: text(row, "document_version_id"),
      startChar: Number(row["start_char"]),
      endChar: Number(row["end_char"]),
      sourceSha256: text(row, "source_sha256"),
      state: text(row, "state") as UnitLedgerRow["state"],
      attempts: Number(row["attempts"]),
      ...(textOrNull(row, "skip_reason") !== null
        ? { skipReason: text(row, "skip_reason") as UnitLedgerRow["skipReason"] }
        : {}),
      ...(textOrNull(row, "error") !== null ? { error: text(row, "error") } : {}),
      ...(textOrNull(row, "extractor_version") !== null
        ? { extractorVersion: text(row, "extractor_version") }
        : {}),
    }));
  }

  async saveReduceResult(runId: string, workerId: string, result: ReduceResult): Promise<void> {
    await this.sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const own = await t`
        select matter_id::text as matter_id
        from app_private.matter_analysis_runs
        where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
          and status = 'reducing' and lease_owner = ${workerId}
        for update`;
      if (own[0] === undefined) throw new LeaseLostError();
      const matterId = text(own[0], "matter_id");

      // Replace whatever an earlier, interrupted attempt wrote: a re-run of
      // the reduce stage upserts the run's derived layer, never doubles it.
      await t`delete from app_private.matter_observation_relations where run_id = ${runId}::uuid`;
      await t`delete from app_private.matter_intel_items where run_id = ${runId}::uuid`;

      for (const relation of result.relations) {
        await t`
          insert into app_private.matter_observation_relations
            (run_id, tenant_id, left_observation_id, right_observation_id,
             relation, rationale, detector, confidence)
          values (${runId}::uuid, ${this.tenantId}::uuid,
                  ${relation.left.observationId}::uuid, ${relation.right.observationId}::uuid,
                  ${relation.relation}, ${relation.rationale.slice(0, 2000)},
                  ${relation.detector}, ${relation.subjectOverlap})
          on conflict (run_id, left_observation_id, right_observation_id) do nothing`;
      }

      const ids = new Map<string, string>();
      for (const item of result.items) {
        if (item.sources.length === 0) continue;
        const confidence =
          item.confidence === undefined || !Number.isFinite(item.confidence)
            ? null
            : Math.min(1, Math.max(0, item.confidence));
        const rows = await t`
          insert into app_private.matter_intel_items
            (run_id, tenant_id, matter_id, item_kind, item_key, title, body,
             occurred_on, date_precision, party_role, stance, support_status,
             hypothetical, confidence, producer, producer_version, model_id,
             provider, attributes)
          values (${runId}::uuid, ${this.tenantId}::uuid, ${matterId}::uuid,
                  ${item.kind}, ${item.key.slice(0, 200)}, ${item.title.slice(0, 500)},
                  ${item.body === undefined ? null : item.body.slice(0, 4000)},
                  ${item.occurredOn ?? null}::date, ${item.datePrecision ?? null},
                  ${item.partyRole === undefined ? null : item.partyRole.slice(0, 100)},
                  ${item.stance ?? null}, ${item.supportStatus ?? null},
                  ${item.hypothetical}, ${confidence}, ${item.producer},
                  ${item.producerVersion}, ${item.modelId ?? null}, ${item.provider ?? null},
                  ${jsonValue(t, item.attributes)})
          on conflict (run_id, item_kind, item_key) do nothing
          returning item_id::text as item_id`;
        const itemId = rows[0] === undefined ? undefined : text(rows[0], "item_id");
        if (itemId === undefined) continue;
        ids.set(itemRef(item), itemId);
        for (const source of item.sources) {
          await t`
            insert into app_private.matter_intel_sources (item_id, observation_id, tenant_id, role)
            values (${itemId}::uuid, ${source.observationId}::uuid, ${this.tenantId}::uuid, ${source.role})
            on conflict do nothing`;
        }
      }

      for (const link of result.links) {
        const from = ids.get(link.from);
        const to = ids.get(link.to);
        if (from === undefined || to === undefined || from === to) continue;
        await t`
          insert into app_private.matter_intel_links
            (from_item_id, to_item_id, tenant_id, link_kind, rationale, confidence, producer)
          values (${from}::uuid, ${to}::uuid, ${this.tenantId}::uuid, ${link.linkKind},
                  ${link.rationale === undefined ? null : link.rationale.slice(0, 2000)},
                  ${link.confidence ?? null}, ${link.producer})
          on conflict do nothing`;
      }

      await t`
        update app_private.matter_analysis_runs
        set status = ${result.status},
            coverage = ${jsonValue(t, result.coverage)},
            result_summary = ${jsonValue(t, result.summary)},
            error = ${result.error ?? null},
            finished_at = now(),
            updated_at = now(),
            lease_owner = null,
            lease_expires_at = null
        where run_id = ${runId}::uuid`;
    });
  }

  async releaseReduce(runId: string, workerId: string, message: string, backoffMs: number): Promise<void> {
    await this.sql`
      update app_private.matter_analysis_runs
      set lease_owner = null,
          lease_expires_at = now() + (${Math.max(0, Math.floor(backoffMs))}::int * interval '1 millisecond'),
          error = ${message.slice(0, 500)},
          updated_at = now()
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
        and lease_owner = ${workerId}`;
  }

  async finishCancelled(runId: string, coverage: ProcessingCoverage): Promise<void> {
    await this.sql`
      update app_private.matter_analysis_runs
      set coverage = ${jsonValue(this.sql, coverage)}, updated_at = now()
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
        and status = 'cancelled'`;
  }

  async requestCancel(runId: string): Promise<"requested" | "not_active" | "not_found"> {
    const rows = await this.sql`
      update app_private.matter_analysis_runs
      set cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
        and status in ('queued', 'mapping', 'aggregating', 'reducing')
      returning run_id`;
    if (rows.length > 0) return "requested";
    const exists = await this.sql`
      select 1 from app_private.matter_analysis_runs
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    return exists.length > 0 ? "not_active" : "not_found";
  }

  async getRun(runId: string): Promise<DurableRunRow | undefined> {
    const rows = await this.sql.unsafe(
      `select ${RUN_COLUMNS} from app_private.matter_analysis_runs
       where run_id = $1::uuid and tenant_id = $2::uuid`,
      [runId, this.tenantId],
    );
    const row = rows[0] as SqlRow | undefined;
    return row === undefined ? undefined : mapRun(row);
  }

  async listRuns(matterId: string, limit = 20): Promise<DurableRunRow[]> {
    const rows = await this.sql.unsafe(
      `select ${RUN_COLUMNS} from app_private.matter_analysis_runs
       where matter_id = $1::uuid and tenant_id = $2::uuid
       order by created_at desc limit $3`,
      [matterId, this.tenantId, Math.max(1, Math.min(100, Math.floor(limit)))],
    );
    return (rows as unknown as SqlRow[]).map(mapRun);
  }

  async latestFinishedRuns(matterId: string): Promise<DurableRunRow[]> {
    const rows = await this.sql.unsafe(
      `select distinct on (task) ${RUN_COLUMNS} from app_private.matter_analysis_runs
       where matter_id = $1::uuid and tenant_id = $2::uuid and status = 'done'
       order by task, created_at desc`,
      [matterId, this.tenantId],
    );
    return (rows as unknown as SqlRow[]).map(mapRun);
  }

  async progress(runId: string): Promise<RunProgress> {
    const rows = await this.sql`
      select state, count(*)::int as n
      from app_private.matter_analysis_units
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
      group by state`;
    const counts = new Map(rows.map((row) => [text(row, "state"), Number(row["n"])]));
    const get = (state: string): number => counts.get(state) ?? 0;
    return {
      total: [...counts.values()].reduce((sum, n) => sum + n, 0),
      pending: get("pending"),
      running: get("running"),
      done: get("done"),
      failed: get("failed"),
      skipped: get("skipped"),
    };
  }

  async loadFindings(runId: string): Promise<RunFindings> {
    const itemRows = await this.sql`
      select item_id::text as item_id, item_kind, item_key, title, body,
             to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, date_precision,
             party_role, stance, support_status, hypothetical, confidence,
             producer, producer_version, model_id, attributes
      from app_private.matter_intel_items
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid
      order by item_kind, occurred_on nulls last, item_key`;
    const sourceRows = await this.sql`
      select s.item_id::text as item_id, s.role, o.observation_id::text as observation_id,
             o.file_id, o.document_version_id::text as document_version_id,
             o.start_char, o.end_char, o.quote, o.quote_sha256, o.locator, o.origin,
             (select c.id::text from legal.chunks c
               where c.document_version_id = o.document_version_id
                 and c.start_char <= o.start_char and c.end_char > o.start_char
               order by c.start_char limit 1) as chunk_id
      from app_private.matter_intel_sources s
      join app_private.matter_intel_items i on i.item_id = s.item_id
      join app_private.matter_observations o on o.observation_id = s.observation_id
      where i.run_id = ${runId}::uuid and i.tenant_id = ${this.tenantId}::uuid
        and s.tenant_id = ${this.tenantId}::uuid and o.tenant_id = ${this.tenantId}::uuid
      order by s.item_id, case s.role when 'basis' then 0 else 1 end, o.file_id, o.start_char`;
    const bySource = new Map<string, FindingSource[]>();
    for (const row of sourceRows) {
      const itemId = text(row, "item_id");
      const bucket = bySource.get(itemId) ?? [];
      bucket.push({
        role: text(row, "role"),
        observationId: text(row, "observation_id"),
        fileId: text(row, "file_id"),
        documentVersionId: text(row, "document_version_id"),
        startChar: Number(row["start_char"]),
        endChar: Number(row["end_char"]),
        quote: text(row, "quote"),
        quoteSha256: text(row, "quote_sha256"),
        locator: textOrNull(row, "locator"),
        origin: text(row, "origin"),
        chunkId: textOrNull(row, "chunk_id"),
      });
      bySource.set(itemId, bucket);
    }
    const items = itemRows.map((row): FindingItem => {
      const attributes = row["attributes"];
      const itemId = text(row, "item_id");
      return {
        itemId,
        kind: text(row, "item_kind"),
        key: text(row, "item_key"),
        title: text(row, "title"),
        body: textOrNull(row, "body"),
        occurredOn: textOrNull(row, "occurred_on"),
        datePrecision: textOrNull(row, "date_precision"),
        partyRole: textOrNull(row, "party_role"),
        stance: textOrNull(row, "stance"),
        supportStatus: textOrNull(row, "support_status"),
        hypothetical: row["hypothetical"] === true,
        confidence: numberOrNull(row, "confidence"),
        producer: text(row, "producer"),
        producerVersion: text(row, "producer_version"),
        modelId: textOrNull(row, "model_id"),
        attributes:
          attributes !== null && typeof attributes === "object" ? (attributes as Record<string, unknown>) : {},
        sources: bySource.get(itemId) ?? [],
      };
    });
    const linkRows = await this.sql`
      select l.from_item_id::text as from_item_id, l.to_item_id::text as to_item_id,
             l.link_kind, l.rationale, l.producer
      from app_private.matter_intel_links l
      join app_private.matter_intel_items i on i.item_id = l.from_item_id
      where i.run_id = ${runId}::uuid and i.tenant_id = ${this.tenantId}::uuid
        and l.tenant_id = ${this.tenantId}::uuid`;
    const relationRows = await this.sql`
      select r.relation, r.rationale, r.confidence,
             lo.observation_id::text as left_id, lo.file_id as left_file,
             lo.statement as left_statement, lo.locator as left_locator,
             ro.observation_id::text as right_id, ro.file_id as right_file,
             ro.statement as right_statement, ro.locator as right_locator
      from app_private.matter_observation_relations r
      join app_private.matter_observations lo on lo.observation_id = r.left_observation_id
      join app_private.matter_observations ro on ro.observation_id = r.right_observation_id
      where r.run_id = ${runId}::uuid and r.tenant_id = ${this.tenantId}::uuid
      order by case r.relation when 'CONTRADICTION' then 0 when 'TENSION' then 1
                               when 'INSUFFICIENT_EVIDENCE' then 2 when 'CORROBORATION' then 3
                               else 4 end,
               r.confidence desc nulls last, lo.file_id, lo.start_char`;
    const run = await this.getRun(runId);
    const fileIds = run?.snapshot?.fileIds ?? [];
    const names = fileIds.length === 0
      ? []
      : await this.sql`
          select external_id, coalesce(title, external_id) as title
          from legal.documents
          where scope = 'tenant' and tenant_id = ${this.tenantId}::uuid
            and external_id = any(${[...fileIds]}::text[])`;
    const fileNames: Record<string, string> = {};
    for (const row of names) fileNames[text(row, "external_id")] = text(row, "title");
    return {
      items,
      links: linkRows.map((row) => ({
        fromItemId: text(row, "from_item_id"),
        toItemId: text(row, "to_item_id"),
        linkKind: text(row, "link_kind"),
        rationale: textOrNull(row, "rationale"),
        producer: text(row, "producer"),
      })),
      relations: relationRows.map((row) => ({
        relation: text(row, "relation"),
        rationale: text(row, "rationale"),
        subjectOverlap: numberOrNull(row, "confidence"),
        left: {
          observationId: text(row, "left_id"),
          fileId: text(row, "left_file"),
          statement: text(row, "left_statement"),
          locator: textOrNull(row, "left_locator"),
        },
        right: {
          observationId: text(row, "right_id"),
          fileId: text(row, "right_file"),
          statement: text(row, "right_statement"),
          locator: textOrNull(row, "right_locator"),
        },
      })),
      fileNames,
    };
  }
}
