/**
 * Persistence for exhaustive Matter analysis.
 *
 * The census has to survive a restart, so it is a table before it is a
 * result: `saveUnits` writes every unit as `pending` BEFORE any analysis
 * begins. If the process dies one second later, the run still knows exactly
 * how much work it had, which is what makes "how much did you actually read"
 * answerable after a crash rather than only after a success.
 *
 * Reads are tenant-scoped in SQL as well as by RLS. The two are deliberate
 * belt and braces: the local single-user deployment connects as the owner and
 * bypasses RLS, so the explicit `tenant_id = …` predicate is what actually
 * isolates tenants there.
 */

import type { Sql } from "../store/db.js";
import type { ScopedDocument, ScopedSegment, ObservationRow, UnitLedgerRow } from "./runner.js";
import { reuseKey } from "./runner.js";
import type { RelationVerdict } from "./contradictions.js";
import type { ProcessingCoverage } from "./processingCoverage.js";
import type { AnalysisUnit } from "./units.js";

import type { AnalysisTask } from "./tasks.js";
export type { AnalysisTask } from "./tasks.js";

export type RunStatus =
  | "queued"
  | "mapping"
  | "aggregating"
  | "reducing"
  | "done"
  | "failed"
  | "cancelled";

export interface AnalysisRunRow {
  readonly runId: string;
  readonly matterId: string;
  readonly task: AnalysisTask;
  readonly status: RunStatus;
  readonly coverage: ProcessingCoverage | undefined;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
}

export interface ExhaustiveStore {
  /** Load every scoped document with its chunk spans and source locators. */
  loadScope(fileIds: readonly string[]): Promise<ScopedDocument[]>;
  createRun(input: {
    matterId: string;
    task: AnalysisTask;
    fileIds: readonly string[];
  }): Promise<string>;
  saveUnits(runId: string, units: readonly AnalysisUnit[]): Promise<void>;
  /**
   * Completed units OF THIS RUN, for resuming it after a crash.
   *
   * Deliberately run-scoped. Reusing across FINISHED runs looks like a
   * saving and is a correctness bug: a reused unit emits no observations, so
   * a second analysis of an unchanged matter came back with complete
   * coverage and ZERO findings. Reuse is for finishing an interrupted run,
   * not for skipping work in a new one.
   */
  reusableUnits(runId: string): Promise<Map<string, { extractorVersion: string }>>;
  /**
   * An unfinished run over the same matter and the same scope, if one exists.
   *
   * This is what makes "a failure on unit 846 of 1 200 does not reprocess
   * units 1-845" real rather than theoretical: the next request picks the
   * interrupted run up instead of starting a fresh census.
   */
  findResumableRun(
    matterId: string,
    fileIds: readonly string[],
  ): Promise<string | undefined>;
  recordProgress(runId: string, ledger: readonly UnitLedgerRow[]): Promise<void>;
  saveObservations(
    runId: string,
    matterId: string,
    observations: readonly ObservationRow[],
  ): Promise<Map<string, string>>;
  saveRelations(
    runId: string,
    relations: readonly RelationVerdict[],
    observationIds: ReadonlyMap<string, string>,
  ): Promise<void>;
  finishRun(
    runId: string,
    status: RunStatus,
    coverage: ProcessingCoverage,
    error?: string,
  ): Promise<void>;
  getRun(runId: string): Promise<AnalysisRunRow | undefined>;
  listRuns(matterId: string, limit?: number): Promise<AnalysisRunRow[]>;
}

/** Local single-user tenant (mirrors intake/ingest.py::LOCAL_TENANT_ID). */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export class PgExhaustiveStore implements ExhaustiveStore {
  constructor(
    private readonly sql: Sql,
    private readonly tenantId: string = LOCAL_TENANT_ID,
  ) {}

  async loadScope(fileIds: readonly string[]): Promise<ScopedDocument[]> {
    if (fileIds.length === 0) return [];
    const ids = [...new Set(fileIds)];

    // Current version of each named upload, owned by this tenant. The
    // `upper_inf(system_period)` test is the same "current version" rule the
    // files lane uses, so an exhaustive review reads exactly the text the
    // lawyer sees on screen.
    const documents = await this.sql`
      select d.external_id as file_id,
             coalesce(d.title, d.external_id) as file_name,
             v.id::text as version_id,
             v.canonical_text as canonical_text
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = any(${ids}::text[])
      order by d.external_id`;

    const out: ScopedDocument[] = [];
    for (const row of documents) {
      const versionId = String(row["version_id"]);
      const spans = await this.sql`
        select id::text as chunk_id, ordinal, start_char, end_char
        from legal.chunks
        where document_version_id = ${versionId}::uuid
        order by start_char, ordinal`;
      const segments = await this.sql`
        select locator_kind, locator_label, start_char, end_char,
               extraction_method, extraction_status
        from legal.document_version_segments
        where document_version_id = ${versionId}::uuid
        order by segment_no`;

      out.push({
        fileId: String(row["file_id"]),
        fileName: String(row["file_name"]),
        documentVersionId: versionId,
        canonicalText: String(row["canonical_text"] ?? ""),
        spans: spans.map((span) => ({
          chunkId: String(span["chunk_id"]),
          ordinal: Number(span["ordinal"]),
          startChar: Number(span["start_char"]),
          endChar: Number(span["end_char"]),
        })),
        segments: segments.map(
          (segment): ScopedSegment => ({
            locatorKind: String(segment["locator_kind"]),
            locatorLabel: String(segment["locator_label"]),
            startChar: Number(segment["start_char"]),
            endChar: Number(segment["end_char"]),
            extractionMethod: String(segment["extraction_method"]),
            extractionStatus: String(
              segment["extraction_status"],
            ) as ScopedSegment["extractionStatus"],
          }),
        ),
      });
    }

    // A named file that produced no row is REPORTED as failed rather than
    // dropped: silently reviewing 36 of 37 documents is the failure mode this
    // whole subsystem exists to prevent.
    const found = new Set(out.map((document) => document.fileId));
    for (const missing of ids.filter((id) => !found.has(id))) {
      out.push({
        fileId: missing,
        fileName: missing,
        documentVersionId: "00000000-0000-0000-0000-000000000000",
        canonicalText: "",
        spans: [],
        segments: [],
        extractionFailed: true,
      });
    }
    return out;
  }

  async createRun(input: {
    matterId: string;
    task: AnalysisTask;
    fileIds: readonly string[];
  }): Promise<string> {
    const rows = await this.sql`
      insert into app_private.matter_analysis_runs
        (tenant_id, matter_id, task, status, scope, started_at)
      values (${this.tenantId}::uuid, ${input.matterId}::uuid, ${input.task},
              'mapping', ${this.sql.json({ fileIds: [...input.fileIds] })}, now())
      returning run_id::text as run_id`;
    return String(rows[0]?.["run_id"]);
  }

  async saveUnits(runId: string, units: readonly AnalysisUnit[]): Promise<void> {
    if (units.length === 0) return;
    // The census exists before the work does.
    const rows = units.map((unit) => ({
      run_id: runId,
      unit_no: unit.unitNo,
      tenant_id: this.tenantId,
      file_id: unit.fileId,
      document_version_id: unit.documentVersionId,
      start_char: unit.startChar,
      end_char: unit.endChar,
      source_sha256: unit.sourceSha256,
      state: "pending",
    }));
    for (let at = 0; at < rows.length; at += 500) {
      const batch = rows.slice(at, at + 500);
      await this.sql`
        insert into app_private.matter_analysis_units ${this.sql(batch)}
        on conflict (run_id, unit_no) do nothing`;
    }
  }

  async reusableUnits(
    runId: string,
  ): Promise<Map<string, { extractorVersion: string }>> {
    const rows = await this.sql`
      select unit_no, source_sha256, extractor_version
      from app_private.matter_analysis_units
      where run_id = ${runId}::uuid
        and tenant_id = ${this.tenantId}::uuid
        and state = 'done'
        and extractor_version is not null`;
    const out = new Map<string, { extractorVersion: string }>();
    for (const row of rows) {
      out.set(reuseKey(Number(row["unit_no"]), String(row["source_sha256"])), {
        extractorVersion: String(row["extractor_version"]),
      });
    }
    return out;
  }

  async findResumableRun(
    matterId: string,
    fileIds: readonly string[],
  ): Promise<string | undefined> {
    // Same matter, same scope, and not finished. The scope comparison is on
    // the stored id list so a run over a DIFFERENT selection is never
    // mistaken for this one.
    const rows = await this.sql`
      select run_id::text as run_id, scope
      from app_private.matter_analysis_runs
      where tenant_id = ${this.tenantId}::uuid
        and matter_id = ${matterId}::uuid
        and status in ('queued', 'mapping', 'aggregating', 'reducing')
      order by created_at desc
      limit 10`;
    const wanted = [...fileIds].sort();
    for (const row of rows) {
      const scope = row["scope"];
      const ids =
        scope !== null && typeof scope === "object" && Array.isArray((scope as { fileIds?: unknown }).fileIds)
          ? ((scope as { fileIds: unknown[] }).fileIds.filter(
              (id): id is string => typeof id === "string",
            ))
          : [];
      const got = [...ids].sort();
      if (got.length === wanted.length && got.every((id, at) => id === wanted[at])) {
        return String(row["run_id"]);
      }
    }
    return undefined;
  }

  async recordProgress(runId: string, ledger: readonly UnitLedgerRow[]): Promise<void> {
    for (const row of ledger) {
      await this.sql`
        update app_private.matter_analysis_units
        set state = ${row.state},
            attempts = ${row.attempts},
            error = ${row.error ?? null},
            skip_reason = ${row.skipReason ?? null},
            extractor_version = ${row.extractorVersion ?? null},
            finished_at = case when ${row.state} in ('done','failed','skipped')
                               then now() else finished_at end
        where run_id = ${runId}::uuid and unit_no = ${row.unitNo}
          and tenant_id = ${this.tenantId}::uuid`;
    }
  }

  async saveObservations(
    runId: string,
    matterId: string,
    observations: readonly ObservationRow[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index] as ObservationRow;
      const rows = await this.sql`
        insert into app_private.matter_observations
          (run_id, tenant_id, matter_id, unit_no, kind, statement, subject,
           predicate, occurred_on, date_precision, document_version_id,
           file_id, start_char, end_char, quote, quote_sha256, locator,
           extractor_version, metadata)
        values (${runId}::uuid, ${this.tenantId}::uuid, ${matterId}::uuid,
                ${observation.unitNo}, 'proposition',
                ${observation.statement.slice(0, 4000)},
                ${observation.subject}, ${observation.predicate},
                ${observation.occurredOn ?? null},
                ${observation.datePrecision ?? null},
                ${observation.documentVersionId}::uuid, ${observation.fileId},
                ${observation.startChar}, ${observation.endChar},
                ${observation.quote}, ${observation.quoteSha256},
                ${observation.locator ?? null}, ${observation.extractorVersion},
                ${this.sql.json({ valueKind: observation.propositionKind })})
        returning observation_id::text as observation_id`;
      // The key mirrors runAggregate's synthetic id so relations can be
      // resolved to the rows that were actually stored.
      ids.set(
        `${observation.fileId}#${observation.unitNo}#${index}`,
        String(rows[0]?.["observation_id"]),
      );
    }
    return ids;
  }

  async saveRelations(
    runId: string,
    relations: readonly RelationVerdict[],
    observationIds: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const relation of relations) {
      const left = observationIds.get(relation.left.observationId);
      const right = observationIds.get(relation.right.observationId);
      if (left === undefined || right === undefined) continue;
      await this.sql`
        insert into app_private.matter_observation_relations
          (run_id, tenant_id, left_observation_id, right_observation_id,
           relation, rationale, detector, confidence)
        values (${runId}::uuid, ${this.tenantId}::uuid, ${left}::uuid,
                ${right}::uuid, ${relation.relation},
                ${relation.rationale.slice(0, 2000)}, ${relation.detector},
                ${relation.subjectOverlap})
        on conflict (run_id, left_observation_id, right_observation_id)
        do update set relation = excluded.relation,
                      rationale = excluded.rationale`;
    }
  }

  async finishRun(
    runId: string,
    status: RunStatus,
    coverage: ProcessingCoverage,
    error?: string,
  ): Promise<void> {
    await this.sql`
      update app_private.matter_analysis_runs
      set status = ${status},
          coverage = ${this.sql.json(JSON.parse(JSON.stringify(coverage)))},
          error = ${error ?? null},
          finished_at = now(),
          updated_at = now()
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid`;
  }

  async getRun(runId: string): Promise<AnalysisRunRow | undefined> {
    const rows = await this.sql`
      select run_id::text as run_id, matter_id::text as matter_id, task, status,
             coverage, created_at, finished_at, error
      from app_private.matter_analysis_runs
      where run_id = ${runId}::uuid and tenant_id = ${this.tenantId}::uuid`;
    const row = rows[0];
    return row === undefined ? undefined : mapRun(row);
  }

  async listRuns(matterId: string, limit = 20): Promise<AnalysisRunRow[]> {
    const rows = await this.sql`
      select run_id::text as run_id, matter_id::text as matter_id, task, status,
             coverage, created_at, finished_at, error
      from app_private.matter_analysis_runs
      where matter_id = ${matterId}::uuid and tenant_id = ${this.tenantId}::uuid
      order by created_at desc
      limit ${Math.max(1, Math.min(100, limit))}`;
    return rows.map(mapRun);
  }
}

function mapRun(row: Record<string, unknown>): AnalysisRunRow {
  const coverage = row["coverage"];
  return {
    runId: String(row["run_id"]),
    matterId: String(row["matter_id"]),
    task: String(row["task"]) as AnalysisTask,
    status: String(row["status"]) as RunStatus,
    coverage:
      coverage !== null && typeof coverage === "object" && "complete" in coverage
        ? (coverage as unknown as ProcessingCoverage)
        : undefined,
    createdAt: new Date(String(row["created_at"])).toISOString(),
    finishedAt:
      row["finished_at"] === null || row["finished_at"] === undefined
        ? null
        : new Date(String(row["finished_at"])).toISOString(),
    error: row["error"] === null || row["error"] === undefined ? null : String(row["error"]),
  };
}
