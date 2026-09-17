/**
 * W21 (review-pin): the retrieval VERSION PIN, lane by lane, against the
 * REAL local PostgreSQL.
 *
 * An upload is undated, so after a re-upload the store's as-of rule sees only
 * the newest version. A review-table row is pinned to the version it was
 * created from, and `filters.documentVersionIds` lets retrieval read EXACTLY
 * that version:
 *   - pinned to V1 after V2 exists: only V1 passages come back;
 *   - unpinned: only V2 (behaviour unchanged);
 *   - a pin never widens: a version outside fileIds, another tenant's
 *     version, or a pin with no file scope returns nothing from the uploads;
 *   - the dense lane ranks the pinned version's fresh vectors, or contributes
 *     nothing — never the current version's.
 *
 * The text is synthetic: this proves plumbing, never Turkish legal quality.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import {
  chunkProvenanceByIds,
  exactPinLookup,
  lexicalSearch,
  listInForceVersions,
  trigramSearch,
  type StoreSearchFilters,
} from "../../src/store/chunkStore.js";
import { searchPipeline } from "../../src/retrieval/hybrid.js";
import { searchLegalCorpus } from "../../src/retrieval/searchService.js";
import type { EmbeddingPort } from "../../src/retrieval/semanticRerank.js";
import { LOCAL_E5_PROFILE, PgChunkVectorStore } from "../../src/embeddings/chunkVectorStore.js";
import { EmbeddingWorker } from "../../src/embeddings/embeddingWorker.js";
import { ExactCosineDenseLane } from "../../src/embeddings/denseLane.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "./testDb.js";
import { insertNewVersion, insertUpload, paragraphs } from "../exhaustive/durableFixtures.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_w21_review_pin_retrieval_test");
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000bb";
const AS_OF = "2026-09-11";
const V1_TEXT = "Kira bedeli aylık 45.000 TL olarak kararlaştırılmıştır.";
const V2_TEXT = "Kira bedeli aylık 60.000 TL olarak kararlaştırılmıştır.";
const QUERY = "kira bedeli aylık kararlaştırılmıştır";
const LAW_V1 = "Bu sözleşme 9901 sayılı Kanun uyarınca otuz gün içinde feshedilebilir.";
const LAW_V2 = "Bu sözleşme 9901 sayılı Kanun uyarınca doksan gün içinde feshedilebilir.";

/** Deterministic bag-of-words test double for the local embedder. */
class BagOfWordsEmbedder implements EmbeddingPort {
  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map((text) => {
      const vector = new Array<number>(LOCAL_E5_PROFILE.dimensions).fill(0);
      vector[383] = 0.05;
      const body = text.replace(/^(query|passage): /u, "").toLocaleLowerCase("tr");
      for (const word of body.split(/[^\p{L}\p{N}]+/u)) {
        if (word === "") continue;
        let hash = 7;
        for (const character of word) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 100_003;
        const slot = hash % 380;
        vector[slot] = (vector[slot] ?? 0) + 1;
      }
      return vector;
    });
  }
}

let sql: Sql;
let vectors: PgChunkVectorStore;
let lane: ExactCosineDenseLane;
const embedder = new BagOfWordsEmbedder();
let a1: string;
let a2: string;
let b1: string;
let foreign1: string;
let law1: string;
let law2: string;

async function chunkIdsOf(versionId: string): Promise<string[]> {
  const rows = await sql`
    select id::text as id from legal.chunks
    where document_version_id = ${versionId}::uuid order by ordinal`;
  return rows.map((row) => String(row["id"]));
}

async function hitsOf(filters: Record<string, unknown>, query = QUERY) {
  const outcome = await searchLegalCorpus(sql, { query, asOf: AS_OF, filters });
  if (outcome.status === "error") throw new Error(`search failed: ${outcome.error.safeMessage}`);
  return outcome.data;
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  const a = await insertUpload(sql, { fileId: "pin-a", title: "Kira sözleşmesi", blocks: paragraphs([V1_TEXT], 8) });
  a1 = a.versionId;
  b1 = (
    await insertUpload(sql, {
      fileId: "pin-b",
      title: "Başka belge",
      blocks: paragraphs(["Kira bedeli aylık 45.000 TL olarak kararlaştırılmıştır ve ödenmiştir."], 6),
    })
  ).versionId;
  // Another tenant's upload under the SAME fileId: a pin to its version must
  // never reach it, not even when the fileId matches.
  foreign1 = (
    await insertUpload(sql, {
      fileId: "pin-a",
      title: "Başka bürounun belgesi",
      blocks: paragraphs([V1_TEXT], 4),
      tenantId: OTHER_TENANT,
    })
  ).versionId;
  const law = await insertUpload(sql, { fileId: "pin-law", title: "Sözleşme", blocks: paragraphs([LAW_V1], 4) });
  law1 = law.versionId;
  await sql`update legal.document_versions set legislation_no = '9901' where id = ${law1}::uuid`;

  // V1 is embedded while it is current (as the background worker would).
  vectors = new PgChunkVectorStore(sql);
  lane = new ExactCosineDenseLane({ store: vectors, embedder, profile: LOCAL_E5_PROFILE });
  const embedded = await new EmbeddingWorker({ store: vectors, embedder, profile: LOCAL_E5_PROFILE }).drain();
  expect(embedded.failed).toBe(0);

  // The re-uploads: contradictory V2s become current, V1s are closed.
  a2 = await insertNewVersion(sql, a.documentId, "pin-a", "v2", paragraphs([V2_TEXT], 8));
  law2 = await insertNewVersion(sql, law.documentId, "pin-law", "v2", paragraphs([LAW_V2], 4));
  await sql`update legal.document_versions set legislation_no = '9901' where id = ${law2}::uuid`;
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("the version pin through the validated search service", () => {
  it("unpinned file scope reads only the CURRENT version — behaviour unchanged", async () => {
    const hits = await hitsOf({ fileIds: ["pin-a"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((hit) => hit.documentVersionId))).toEqual(new Set([a2]));
    expect(hits.some((hit) => hit.provenance.originalText.includes("60.000"))).toBe(true);
    expect(hits.some((hit) => hit.provenance.originalText.includes("45.000"))).toBe(false);
  });

  it("pinned to V1, it reads V1 after V2 exists", async () => {
    const hits = await hitsOf({ fileIds: ["pin-a"], documentVersionIds: [a1] });
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((hit) => hit.documentVersionId))).toEqual(new Set([a1]));
    expect(hits.some((hit) => hit.provenance.originalText.includes("45.000"))).toBe(true);
    expect(hits.some((hit) => hit.provenance.originalText.includes("60.000"))).toBe(false);
  });

  it("pinned to the current version, it returns exactly the unpinned result", async () => {
    const unpinned = await hitsOf({ fileIds: ["pin-a"] });
    const pinned = await hitsOf({ fileIds: ["pin-a"], documentVersionIds: [a2.toUpperCase()] });
    expect(pinned.map((hit) => hit.chunkId)).toEqual(unpinned.map((hit) => hit.chunkId));
  });

  it("a pin never widens: other file, other tenant, no file scope, empty pin", async () => {
    // A version of another file of the same tenant, outside fileIds.
    expect(await hitsOf({ fileIds: ["pin-a"], documentVersionIds: [b1] })).toEqual([]);
    expect(await hitsOf({ fileIds: ["pin-b"], documentVersionIds: [a1] })).toEqual([]);
    // Another tenant's version, even under the same fileId.
    expect(await hitsOf({ fileIds: ["pin-a"], documentVersionIds: [foreign1] })).toEqual([]);
    // An empty pin list matches no uploaded row (fail closed).
    expect(await hitsOf({ fileIds: ["pin-a"], documentVersionIds: [] })).toEqual([]);
    // Two files in scope, one pinned: the unpinned file's rows are excluded.
    const narrowed = await hitsOf({ fileIds: ["pin-a", "pin-b"], documentVersionIds: [a1] });
    expect(narrowed.length).toBeGreaterThan(0);
    expect(new Set(narrowed.map((hit) => hit.documentVersionId))).toEqual(new Set([a1]));
    // No file scope: the pin cannot reach an upload the default scope hides.
    const unscoped = await hitsOf({ documentVersionIds: [a1] });
    expect(unscoped.filter((hit) => hit.provenance.scope !== "public")).toEqual([]);
    // With the corpus unioned in, every uploaded hit is still the pinned one.
    const withCorpus = await hitsOf({ fileIds: ["pin-a"], documentVersionIds: [a1], includeCorpus: true });
    const uploaded = withCorpus.filter((hit) => hit.provenance.scope !== "public");
    expect(uploaded.length).toBeGreaterThan(0);
    expect(uploaded.every((hit) => hit.documentVersionId === a1)).toBe(true);
  });

  it("rejects a malformed or oversized pin at the service boundary", async () => {
    const malformed = await searchLegalCorpus(sql, {
      query: QUERY,
      asOf: AS_OF,
      filters: { fileIds: ["pin-a"], documentVersionIds: ["not-a-uuid"] },
    });
    expect(malformed.status).toBe("error");
    if (malformed.status === "error") expect(malformed.error.kind).toBe("INVALID_REQUEST");
    const oversized = await searchLegalCorpus(sql, {
      query: QUERY,
      asOf: AS_OF,
      filters: { fileIds: ["pin-a"], documentVersionIds: Array.from({ length: 51 }, () => a1) },
    });
    expect(oversized.status).toBe("error");
  });
});

describe("every lane honours the pin", () => {
  const pinnedA = (): StoreSearchFilters => ({ fileIds: ["pin-a"], documentVersionIds: [a1] });

  it("lexical (coverage and strict), trigram, dense hydration and the in-force listing", async () => {
    for (const mode of ["coverage", "strict"] as const) {
      const pinned = await lexicalSearch(sql, QUERY, { asOf: AS_OF, limit: 50, mode, filters: pinnedA() });
      expect(pinned.length).toBeGreaterThan(0);
      expect(pinned.every((row) => row.provenance.documentVersionId === a1)).toBe(true);
      const current = await lexicalSearch(sql, QUERY, { asOf: AS_OF, limit: 50, mode, filters: { fileIds: ["pin-a"] } });
      expect(current.length).toBeGreaterThan(0);
      expect(current.every((row) => row.provenance.documentVersionId === a2)).toBe(true);
    }

    const trigramQuery = "kira bedeli aylık 45.000 tl";
    const pinnedTrigram = await trigramSearch(sql, trigramQuery, {
      asOf: AS_OF,
      limit: 20,
      minSimilarity: 0.3,
      budgetMs: 0,
      filters: pinnedA(),
    });
    expect(pinnedTrigram.length).toBeGreaterThan(0);
    expect(pinnedTrigram.every((row) => row.provenance.documentVersionId === a1)).toBe(true);
    const currentTrigram = await trigramSearch(sql, trigramQuery, {
      asOf: AS_OF,
      limit: 20,
      minSimilarity: 0.3,
      budgetMs: 0,
      filters: { fileIds: ["pin-a"] },
    });
    expect(currentTrigram.every((row) => row.provenance.documentVersionId === a2)).toBe(true);

    // Dense hydration: ids of BOTH versions go in; only the pinned ones come out.
    const v1Ids = await chunkIdsOf(a1);
    const v2Ids = await chunkIdsOf(a2);
    const hydrated = await chunkProvenanceByIds(sql, [...v1Ids, ...v2Ids], { asOf: AS_OF, filters: pinnedA() });
    expect(hydrated.map((row) => row.chunkId).sort()).toEqual([...v1Ids].sort());
    const hydratedCurrent = await chunkProvenanceByIds(sql, [...v1Ids, ...v2Ids], {
      asOf: AS_OF,
      filters: { fileIds: ["pin-a"] },
    });
    expect(hydratedCurrent.map((row) => row.chunkId).sort()).toEqual([...v2Ids].sort());

    const listed = await listInForceVersions(sql, { asOf: AS_OF, limit: 10, filters: pinnedA() });
    expect(listed.map((row) => [row.documentVersionId, row.systemCurrent])).toEqual([[a1, false]]);
    const listedCurrent = await listInForceVersions(sql, { asOf: AS_OF, limit: 10, filters: { fileIds: ["pin-a"] } });
    expect(listedCurrent.map((row) => [row.documentVersionId, row.systemCurrent])).toEqual([[a2, true]]);
  });

  it("the exact-reference lane (and so citation expansion) reads the pinned version", async () => {
    const references = [{ kind: "legislation", raw: "9901", legislationNo: "9901" }] as Parameters<
      typeof exactPinLookup
    >[1];
    const pinned = await exactPinLookup(sql, references, {
      asOf: AS_OF,
      limit: 20,
      filters: { fileIds: ["pin-law"], documentVersionIds: [law1] },
    });
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.every((row) => row.provenance.documentVersionId === law1)).toBe(true);
    const current = await exactPinLookup(sql, references, {
      asOf: AS_OF,
      limit: 20,
      filters: { fileIds: ["pin-law"] },
    });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((row) => row.provenance.documentVersionId === law2)).toBe(true);
    expect(
      await exactPinLookup(sql, references, {
        asOf: AS_OF,
        limit: 20,
        filters: { fileIds: ["pin-law"], documentVersionIds: [a1] },
      }),
    ).toEqual([]);

    // End to end: the full pipeline (exact pin, lexical, trigram, citation
    // expansion, divergence) returns only the pinned version.
    const result = await searchPipeline(sql, "9901 sayılı Kanun fesih süresi", {
      asOf: AS_OF,
      filters: { fileIds: ["pin-law"], documentVersionIds: [law1] },
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((hit) => hit.documentVersionId === law1)).toBe(true);
    expect(result.hits.some((hit) => hit.provenance.originalText.includes("otuz gün"))).toBe(true);
    expect(result.hits.some((hit) => hit.provenance.originalText.includes("doksan gün"))).toBe(false);
  });
});

describe("the dense lane under a pin", () => {
  it("ranks the pinned version's fresh vectors, and never the current version's", async () => {
    const v1Ids = new Set(await chunkIdsOf(a1));
    const pinned = await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"], documentVersionIds: [a1] } });
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.every((id) => v1Ids.has(id))).toBe(true);
    // V2 was never embedded: unpinned and pinned-to-V2 contribute NOTHING
    // (not V1's vectors, which belong to a superseded version).
    expect(await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"] } })).toEqual([]);
    expect(
      await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"], documentVersionIds: [a2] } }),
    ).toEqual([]);
    // Outside the file scope, and an empty or malformed pin: nothing.
    expect(
      await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"], documentVersionIds: [b1] } }),
    ).toEqual([]);
    expect(
      await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"], documentVersionIds: [] } }),
    ).toEqual([]);
    expect(await vectors.scopedVectors(LOCAL_E5_PROFILE, ["pin-a"], ["not-a-uuid"])).toEqual([]);

    const result = await searchPipeline(sql, QUERY, {
      asOf: AS_OF,
      filters: { fileIds: ["pin-a"], documentVersionIds: [a1] },
      denseLane: lane,
    });
    expect(result.dense.state).toBe("ACTIVE");
    expect(result.dense.returned).toBeGreaterThan(0);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((hit) => hit.documentVersionId === a1)).toBe(true);
  });

  it("once V2 is embedded, unpinned ranks V2 and the V1 pin still ranks V1", async () => {
    await new EmbeddingWorker({ store: vectors, embedder, profile: LOCAL_E5_PROFILE }).drain();
    const v1Ids = new Set(await chunkIdsOf(a1));
    const v2Ids = new Set(await chunkIdsOf(a2));
    const current = await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"] } });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((id) => v2Ids.has(id))).toBe(true);
    const pinned = await lane.search(QUERY, { asOf: AS_OF, limit: 50, filters: { fileIds: ["pin-a"], documentVersionIds: [a1] } });
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.every((id) => v1Ids.has(id))).toBe(true);
  });
});
