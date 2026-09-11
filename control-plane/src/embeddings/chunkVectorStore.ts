/**
 * Private chunk vectors and the embedding job queue, in PostgreSQL (W20 E).
 *
 * Jobs: `app_private.jobs`, queue `embedding`, idempotency key
 * `embed:<version>:<profile>` — the SAME convention ingestion/jobs.py writes
 * on every publish. Ingestion has always enqueued these jobs; until W20
 * nothing consumed them. This store claims only jobs for the profile the
 * local lane serves (payload->>'profile_key'), so jobs queued for 1024-wide
 * cloud profiles are left untouched rather than failed.
 *
 * Staleness is hash-based: a vector is FRESH only when its `chunk_sha256`
 * equals the chunk's current `content_sha256`. Search joins on that equality,
 * so a stale vector can never surface a chunk, and the backfill scan
 * re-embeds it.
 *
 * Everything is tenant-scoped in SQL (the local deployment connects as the
 * owner and bypasses RLS; see exhaustive/store.ts).
 */

import type { Sql, SqlRow } from "../store/db.js";
import { LOCAL_TENANT_ID } from "../exhaustive/store.js";

export const EMBEDDING_QUEUE = "embedding";

export interface EmbeddingProfile {
  readonly key: string;
  readonly model: string;
  readonly dimensions: number;
  readonly promptStyle: string;
}

/** The profile the local E5 lane serves (migration 20260912100000). */
export const LOCAL_E5_PROFILE: EmbeddingProfile = Object.freeze({
  key: "e5-small-384-v1",
  model: "intfloat/multilingual-e5-small:onnx-qint8",
  dimensions: 384,
  promptStyle: "e5",
});

export interface EmbeddingJob {
  readonly id: number;
  readonly documentVersionId: string;
  readonly attempts: number;
}

export interface ChunkToEmbed {
  readonly chunkId: string;
  readonly documentVersionId: string;
  readonly text: string;
  readonly contentSha256: string;
}

export interface VectorRow {
  readonly chunkId: string;
  readonly documentVersionId: string;
  readonly embedding: Buffer;
  readonly inputSha256: string;
  readonly chunkSha256: string;
}

export interface ScopedVector {
  readonly chunkId: string;
  readonly embedding: Uint8Array;
}

export interface VectorStats {
  readonly vectors: number;
  readonly staleVectors: number;
  readonly chunksWithoutVector: number;
  readonly pendingJobs: number;
  readonly failedJobs: number;
}

export interface ChunkVectorStore {
  readonly tenantId: string;
  versionsNeedingVectors(profileKey: string, limit: number): Promise<string[]>;
  enqueueVersions(versionIds: readonly string[], profileKey: string): Promise<number>;
  claimJobs(profileKey: string, workerId: string, batch: number): Promise<EmbeddingJob[]>;
  chunksNeedingVectors(documentVersionId: string, profileKey: string): Promise<ChunkToEmbed[]>;
  upsertVectors(profile: EmbeddingProfile, rows: readonly VectorRow[]): Promise<void>;
  completeJob(id: number): Promise<void>;
  failJob(id: number, message: string, backoffSeconds: number): Promise<void>;
  requeueStuckJobs(olderThanSeconds: number): Promise<number>;
  scopedVectors(profile: EmbeddingProfile, fileIds: readonly string[]): Promise<ScopedVector[]>;
  stats(profileKey: string): Promise<VectorStats>;
}

export class PgChunkVectorStore implements ChunkVectorStore {
  constructor(
    private readonly sql: Sql,
    readonly tenantId: string = LOCAL_TENANT_ID,
  ) {}

  /**
   * The BACKFILL scan: current tenant versions with at least one chunk that
   * has no fresh vector for the profile. Documents ingested before W20 (or
   * whose job died) are found here, so nothing depends on a job having been
   * enqueued at ingest.
   */
  async versionsNeedingVectors(profileKey: string, limit: number): Promise<string[]> {
    const rows = await this.sql`
      select v.id::text as version_id
      from legal.documents d
      join legal.document_versions v
        on v.document_id = d.id and upper_inf(v.system_period)
      where d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and exists (
          select 1 from legal.chunks c
          left join app_private.chunk_vectors cv
            on cv.chunk_id = c.id and cv.profile_key = ${profileKey}
          where c.document_version_id = v.id
            and (cv.chunk_id is null or cv.chunk_sha256 <> c.content_sha256))
      order by v.id
      limit ${Math.max(1, Math.floor(limit))}`;
    return rows.map((row) => String(row["version_id"]));
  }

  async enqueueVersions(versionIds: readonly string[], profileKey: string): Promise<number> {
    let added = 0;
    for (const versionId of versionIds) {
      // The ON CONFLICT predicate must repeat the partial unique index's
      // predicate (jobs_inflight_key_uq), exactly as ingestion/jobs.py does.
      const rows = await this.sql`
        insert into app_private.jobs (queue, idempotency_key, payload)
        values (${EMBEDDING_QUEUE}, ${`embed:${versionId}:${profileKey}`},
                ${this.sql.json({ document_version_id: versionId, profile_key: profileKey, reason: "backfill" })})
        on conflict (queue, idempotency_key) where status in ('queued', 'running') do nothing
        returning id`;
      added += rows.length;
    }
    return added;
  }

  async claimJobs(profileKey: string, workerId: string, batch: number): Promise<EmbeddingJob[]> {
    const rows = await this.sql`
      with candidate as (
        select j.id
        from app_private.jobs j
        where j.queue = ${EMBEDDING_QUEUE}
          and j.status = 'queued'
          and j.available_at <= now()
          and j.attempts < j.max_attempts
          and j.payload->>'profile_key' = ${profileKey}
          -- Only THIS tenant's jobs: the queue is shared and has no tenant
          -- column. Claiming a foreign job would complete it with nothing
          -- embedded, and that tenant's vectors would never be built.
          and exists (
            select 1 from legal.document_versions v
            join legal.documents d on d.id = v.document_id
            where v.id::text = j.payload->>'document_version_id'
              and d.scope = 'tenant'
              and d.tenant_id = ${this.tenantId}::uuid)
        order by j.available_at, j.id
        for update skip locked
        limit ${Math.max(1, Math.floor(batch))}
      )
      update app_private.jobs j
      set status = 'running', attempts = j.attempts + 1, locked_at = now(),
          locked_by = ${workerId}, updated_at = now()
      from candidate c
      where j.id = c.id
      returning j.id, j.payload->>'document_version_id' as version_id, j.attempts`;
    return rows
      .filter((row) => typeof row["version_id"] === "string")
      .map((row) => ({
        id: Number(row["id"]),
        documentVersionId: String(row["version_id"]),
        attempts: Number(row["attempts"]),
      }));
  }

  async chunksNeedingVectors(documentVersionId: string, profileKey: string): Promise<ChunkToEmbed[]> {
    // Tenant-checked: a job naming another tenant's (or a public) version
    // yields nothing to embed.
    const rows = await this.sql`
      select c.id::text as chunk_id, c.document_version_id::text as version_id,
             c.original_text, c.content_sha256
      from legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      left join app_private.chunk_vectors cv
        on cv.chunk_id = c.id and cv.profile_key = ${profileKey}
      where c.document_version_id = ${documentVersionId}::uuid
        and d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and (cv.chunk_id is null or cv.chunk_sha256 <> c.content_sha256)
      order by c.start_char, c.ordinal`;
    return rows.map((row: SqlRow) => ({
      chunkId: String(row["chunk_id"]),
      documentVersionId: String(row["version_id"]),
      text: String(row["original_text"] ?? ""),
      contentSha256: String(row["content_sha256"]),
    }));
  }

  async upsertVectors(profile: EmbeddingProfile, rows: readonly VectorRow[]): Promise<void> {
    for (const row of rows) {
      await this.sql`
        insert into app_private.chunk_vectors
          (profile_key, chunk_id, tenant_id, document_version_id, dimensions,
           embedding, input_sha256, chunk_sha256)
        values (${profile.key}, ${row.chunkId}::uuid, ${this.tenantId}::uuid,
                ${row.documentVersionId}::uuid, ${profile.dimensions}, ${row.embedding},
                ${row.inputSha256}, ${row.chunkSha256})
        on conflict (profile_key, chunk_id) do update
          set embedding = excluded.embedding,
              input_sha256 = excluded.input_sha256,
              chunk_sha256 = excluded.chunk_sha256,
              dimensions = excluded.dimensions,
              document_version_id = excluded.document_version_id,
              embedded_at = now()`;
    }
  }

  async completeJob(id: number): Promise<void> {
    await this.sql`
      update app_private.jobs
      set status = 'succeeded', locked_at = null, locked_by = null, updated_at = now()
      where id = ${id} and status = 'running'`;
  }

  async failJob(id: number, message: string, backoffSeconds: number): Promise<void> {
    await this.sql`
      select app_private.fail_job(
        ${id}::bigint,
        ${JSON.stringify({ message: message.slice(0, 300) })}::jsonb,
        (${Math.max(0, Math.floor(backoffSeconds))}::int * interval '1 second'))`;
  }

  async requeueStuckJobs(olderThanSeconds: number): Promise<number> {
    const rows = await this.sql`
      update app_private.jobs
      set status = 'queued', locked_at = null, locked_by = null, updated_at = now()
      where queue = ${EMBEDDING_QUEUE}
        and status = 'running'
        and locked_at < now() - (${Math.max(1, Math.floor(olderThanSeconds))}::int * interval '1 second')
      returning id`;
    return rows.length;
  }

  /**
   * Fresh vectors of the CURRENT versions of the given uploads. This is the
   * pre-filter; hydration re-applies the store's visibility filter anyway
   * (hybrid.ts treats the index as untrusted input).
   */
  async scopedVectors(profile: EmbeddingProfile, fileIds: readonly string[]): Promise<ScopedVector[]> {
    const ids = [...new Set(fileIds)];
    if (ids.length === 0) return [];
    const rows = await this.sql`
      select cv.chunk_id::text as chunk_id, cv.embedding
      from app_private.chunk_vectors cv
      join legal.chunks c on c.id = cv.chunk_id and c.content_sha256 = cv.chunk_sha256
      join legal.document_versions v
        on v.id = c.document_version_id and upper_inf(v.system_period)
      join legal.documents d on d.id = v.document_id
      where cv.profile_key = ${profile.key}
        and cv.tenant_id = ${this.tenantId}::uuid
        and cv.dimensions = ${profile.dimensions}
        and d.scope = 'tenant'
        and d.tenant_id = ${this.tenantId}::uuid
        and d.external_id = any(${ids}::text[])`;
    return rows.map((row) => ({
      chunkId: String(row["chunk_id"]),
      embedding: row["embedding"] as Uint8Array,
    }));
  }

  async stats(profileKey: string): Promise<VectorStats> {
    const rows = await this.sql`
      select
        (select count(*)::int from app_private.chunk_vectors cv
          join legal.chunks c on c.id = cv.chunk_id
          where cv.profile_key = ${profileKey} and cv.tenant_id = ${this.tenantId}::uuid
            and c.content_sha256 = cv.chunk_sha256) as vectors,
        (select count(*)::int from app_private.chunk_vectors cv
          join legal.chunks c on c.id = cv.chunk_id
          where cv.profile_key = ${profileKey} and cv.tenant_id = ${this.tenantId}::uuid
            and c.content_sha256 <> cv.chunk_sha256) as stale_vectors,
        (select count(*)::int from legal.chunks c
          join legal.document_versions v on v.id = c.document_version_id and upper_inf(v.system_period)
          join legal.documents d on d.id = v.document_id
          left join app_private.chunk_vectors cv on cv.chunk_id = c.id and cv.profile_key = ${profileKey}
          where d.scope = 'tenant' and d.tenant_id = ${this.tenantId}::uuid
            and cv.chunk_id is null) as chunks_without_vector,
        (select count(*)::int from app_private.jobs
          where queue = ${EMBEDDING_QUEUE} and status in ('queued', 'running')
            and payload->>'profile_key' = ${profileKey}
            and exists (
              select 1 from legal.document_versions v
              join legal.documents d on d.id = v.document_id
              where v.id::text = jobs.payload->>'document_version_id'
                and d.scope = 'tenant'
                and d.tenant_id = ${this.tenantId}::uuid)) as pending_jobs,
        (select count(*)::int from app_private.jobs
          where queue = ${EMBEDDING_QUEUE} and status = 'dead'
            and payload->>'profile_key' = ${profileKey}
            and exists (
              select 1 from legal.document_versions v
              join legal.documents d on d.id = v.document_id
              where v.id::text = jobs.payload->>'document_version_id'
                and d.scope = 'tenant'
                and d.tenant_id = ${this.tenantId}::uuid)) as failed_jobs`;
    const row = rows[0] ?? {};
    return {
      vectors: Number(row["vectors"] ?? 0),
      staleVectors: Number(row["stale_vectors"] ?? 0),
      chunksWithoutVector: Number(row["chunks_without_vector"] ?? 0),
      pendingJobs: Number(row["pending_jobs"] ?? 0),
      failedJobs: Number(row["failed_jobs"] ?? 0),
    };
  }
}
