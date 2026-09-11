/**
 * W20 phase E: the private dense lane and the embedding-job consumer,
 * against the REAL local PostgreSQL (no pgvector) with a deterministic
 * CONCEPT embedder.
 *
 * The concept embedder is a test double: words that mean the same thing
 * ("kaza" / "çarpışma", "zarar" / "hasar") map to the same dimension, so a
 * passage can be semantically related to a query while sharing NO word with
 * it. That isolates the plumbing — job consumption, hash-aware staleness,
 * float32 storage, scope pre-filtering, hydration, state reporting — from
 * any claim about a real model. The real model is exercised in
 * realE5.test.ts.
 *
 *   F (plumbing)  a semantic-only passage enters retrieval via the dense lane
 *                 and health says ACTIVE;
 *   G             an embedder outage leaves the product answering lexically
 *                 and the lane honestly DEGRADED (never ACTIVE).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { EmbeddingCallError, type EmbeddingPort } from "../../src/retrieval/semanticRerank.js";
import { searchPipeline } from "../../src/retrieval/hybrid.js";
import { LOCAL_E5_PROFILE, PgChunkVectorStore } from "../../src/embeddings/chunkVectorStore.js";
import { EmbeddingWorker } from "../../src/embeddings/embeddingWorker.js";
import { ExactCosineDenseLane } from "../../src/embeddings/denseLane.js";
import { decodeVector, encodeVector, l2Normalize } from "../../src/embeddings/vectorCodec.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { insertUpload, paragraphs } from "../exhaustive/durableFixtures.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_dense_private_test");
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000aa";
const TARGET = "Araçların çarpışması sonucu otomobilde oluşan hasarın bedeli ödenmelidir.";
const QUERY = "trafik kazasında maddi zarar";

const CONCEPTS: Record<string, number> = {
  trafik: 1, kazasında: 1, kaza: 1, çarpışması: 1, çarpışma: 1,
  araçların: 2, araç: 2, otomobilde: 2, otomobil: 2,
  maddi: 3, zarar: 3, hasarın: 3, hasar: 3, bedeli: 3,
};

function wordHash(word: string): number {
  let hash = 7;
  for (const character of word) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 100_003;
  return hash;
}

class ConceptEmbedder implements EmbeddingPort {
  calls = 0;
  failing = false;
  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.calls += 1;
    if (this.failing) throw new EmbeddingCallError("EMBEDDING_FAILED");
    return texts.map((text) => {
      const vector = new Array<number>(LOCAL_E5_PROFILE.dimensions).fill(0);
      vector[383] = 0.05;
      const body = text.replace(/^(query|passage): /u, "").toLocaleLowerCase("tr");
      for (const word of body.split(/[^\p{L}]+/u)) {
        if (word === "") continue;
        const concept = CONCEPTS[word];
        if (concept !== undefined) vector[concept] = (vector[concept] ?? 0) + 1;
        else vector[10 + (wordHash(word) % 370)] = (vector[10 + (wordHash(word) % 370)] ?? 0) + 0.3;
      }
      return vector;
    });
  }
}

let sql: Sql;
let store: PgChunkVectorStore;
let embedder: ConceptEmbedder;
let lane: ExactCosineDenseLane;
let targetChunkId: string;

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await insertUpload(sql, { fileId: "dense-a", title: "Kaza raporu", blocks: paragraphs([TARGET], 12) });
  await insertUpload(sql, { fileId: "dense-b", title: "Başka dosya", blocks: paragraphs([TARGET.replace("ödenmelidir", "istenmiştir")], 6) });
  await insertUpload(sql, {
    fileId: "dense-foreign",
    title: "Başka bürounun belgesi",
    blocks: paragraphs([TARGET], 4),
    tenantId: OTHER_TENANT,
  });
  const rows = await sql`
    select c.id::text as id from legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id
    where d.external_id = 'dense-a' and c.original_text = ${TARGET}`;
  targetChunkId = String(rows[0]!["id"]);
  store = new PgChunkVectorStore(sql);
  embedder = new ConceptEmbedder();
  lane = new ExactCosineDenseLane({ store, embedder, profile: LOCAL_E5_PROFILE });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("vector codec", () => {
  it("round-trips float32 little-endian and normalizes to unit length", () => {
    const unit = l2Normalize([3, 4])!;
    expect(Array.from(unit)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)]);
    const bytes = encodeVector(unit);
    expect(bytes.byteLength).toBe(8);
    expect(Array.from(decodeVector(bytes, 2)!)).toEqual(Array.from(unit));
    expect(decodeVector(bytes, 3)).toBeUndefined();
    expect(l2Normalize([0, 0])).toBeUndefined();
    expect(l2Normalize([Number.NaN])).toBeUndefined();
  });
});

describe("the embedding-job consumer", () => {
  it("embeds every chunk of this tenant once, and a second pass embeds nothing", async () => {
    // A job queued for a cloud profile must be left alone, not failed.
    await sql`
      insert into app_private.jobs (queue, idempotency_key, payload)
      values ('embedding', 'embed:foreign:voyage-4-1024-v1',
              ${sql.json({ document_version_id: "00000000-0000-0000-0000-000000000000", profile_key: "voyage-4-1024-v1" })})`;
    const worker = new EmbeddingWorker({ store, embedder, profile: LOCAL_E5_PROFILE });
    const first = await worker.drain();
    const tenantChunks = await sql`
      select count(*)::int as n from legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      where d.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid`;
    expect(first.embedded).toBe(Number(tenantChunks[0]!["n"]));
    expect(first.failed).toBe(0);

    const second = await worker.drain();
    expect(second.embedded).toBe(0);
    const stats = await store.stats(LOCAL_E5_PROFILE.key);
    expect(stats.vectors).toBe(Number(tenantChunks[0]!["n"]));
    expect(stats.chunksWithoutVector).toBe(0);
    expect(stats.staleVectors).toBe(0);
    // Another tenant's chunks were never embedded under this tenant.
    const foreign = await sql`
      select count(*)::int as n from app_private.chunk_vectors cv
      join legal.chunks c on c.id = cv.chunk_id
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      where d.external_id = 'dense-foreign'`;
    expect(Number(foreign[0]!["n"])).toBe(0);
    const voyage = await sql`
      select status from app_private.jobs where idempotency_key = 'embed:foreign:voyage-4-1024-v1'`;
    expect(voyage[0]!["status"]).toBe("queued");
  });

  it("never claims another tenant's job: the shared queue has no tenant column", async () => {
    const versions = await sql`
      select v.id::text as id from legal.document_versions v
      join legal.documents d on d.id = v.document_id
      where d.external_id = 'dense-foreign'`;
    const foreignVersion = String(versions[0]!["id"]);
    const key = `embed:${foreignVersion}:${LOCAL_E5_PROFILE.key}`;
    await sql`
      insert into app_private.jobs (queue, idempotency_key, payload)
      values ('embedding', ${key},
              ${sql.json({ document_version_id: foreignVersion, profile_key: LOCAL_E5_PROFILE.key })})`;
    const worker = new EmbeddingWorker({ store, embedder, profile: LOCAL_E5_PROFILE });
    await worker.drain();
    const job = await sql`select status from app_private.jobs where idempotency_key = ${key}`;
    // Left for its own tenant's worker, NOT completed with nothing embedded.
    expect(job[0]!["status"]).toBe("queued");
    // And this tenant's health does not count it as its own backlog.
    expect((await store.stats(LOCAL_E5_PROFILE.key)).pendingJobs).toBe(0);
    await sql`delete from app_private.jobs where idempotency_key = ${key}`;
  });

  it("a changed chunk makes its vector STALE: never served, then re-embedded", async () => {
    const worker = new EmbeddingWorker({ store, embedder, profile: LOCAL_E5_PROFILE });
    await worker.drain();
    await sql`
      update legal.chunks set content_sha256 = ${"f".repeat(64)}
      where id = ${targetChunkId}::uuid`;
    const served = await store.scopedVectors(LOCAL_E5_PROFILE, ["dense-a"]);
    expect(served.some((vector) => vector.chunkId === targetChunkId)).toBe(false);
    expect((await store.stats(LOCAL_E5_PROFILE.key)).staleVectors).toBe(1);

    const again = await worker.drain();
    expect(again.embedded).toBe(1);
    const reserved = await store.scopedVectors(LOCAL_E5_PROFILE, ["dense-a"]);
    expect(reserved.some((vector) => vector.chunkId === targetChunkId)).toBe(true);
    expect((await store.stats(LOCAL_E5_PROFILE.key)).staleVectors).toBe(0);
  });
});

describe("F (plumbing): a semantic-only passage enters retrieval", () => {
  it("is found ONLY by the dense lane, which reports ACTIVE", async () => {
    await new EmbeddingWorker({ store, embedder, profile: LOCAL_E5_PROFILE }).drain();
    const withDense = await searchPipeline(sql, QUERY, {
      asOf: "2026-09-11",
      filters: { fileIds: ["dense-a"] },
      denseLane: lane,
    });
    const hit = withDense.hits.find((candidate) => candidate.chunkId === targetChunkId);
    expect(hit).toBeDefined();
    expect(hit!.lanes.map((entry) => entry.lane)).toEqual(["dense"]);
    expect(withDense.dense.state).toBe("ACTIVE");
    expect(withDense.dense.denseOnly).toBeGreaterThanOrEqual(1);

    // Without the dense lane the same query cannot reach it: the lexical
    // lanes share no word with it.
    const lexicalOnly = await searchPipeline(sql, QUERY, {
      asOf: "2026-09-11",
      filters: { fileIds: ["dense-a"] },
    });
    expect(lexicalOnly.hits.some((candidate) => candidate.chunkId === targetChunkId)).toBe(false);
    expect(lexicalOnly.dense.state).toBe("DISABLED");

    const health = await lane.health();
    expect(health.state).toBe("ACTIVE");
    expect(health.scope).toBe("private_uploads_only");
    expect(health.dimensions).toBe(384);
  });

  it("never returns a chunk outside the caller's file scope", async () => {
    const ids = await lane.search(QUERY, { asOf: "2026-09-11", limit: 50, filters: { fileIds: ["dense-b"] } });
    expect(ids).not.toContain(targetChunkId);
    expect(ids.length).toBeGreaterThan(0);
    const unscoped = await lane.search(QUERY, { asOf: "2026-09-11", limit: 50, filters: {} });
    expect(unscoped).toEqual([]);
  });
});

describe("G: an embedder outage is DEGRADED, never ACTIVE", () => {
  it("keeps answering lexically and says the semantic lane is down", async () => {
    embedder.failing = true;
    try {
      const result = await searchPipeline(sql, "paragraf dosyanın hacmini", {
        asOf: "2026-09-11",
        filters: { fileIds: ["dense-a"] },
        denseLane: lane,
      });
      expect(result.dense.state).toBe("DEGRADED");
      expect(result.dense.returned).toBe(0);
      expect(result.hits.length).toBeGreaterThan(0);
      const health = await lane.health();
      expect(health.state).toBe("DEGRADED");
      expect(health.probe.ok).toBe(false);
      expect(health.reasonTr).toContain("kelime eşleşmesiyle");
    } finally {
      embedder.failing = false;
    }
    expect((await lane.health()).state).toBe("ACTIVE");
  });
});
