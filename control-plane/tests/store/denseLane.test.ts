/**
 * Dense lane candidate correctness (W19 phase D) — REAL integration against
 * the local scratch PostgreSQL, same contract as tests/store/retrieval.test.ts.
 *
 * What was broken: the dense lane returns chunk IDS, but provenance was only
 * ever hydrated from the lexical and trigram ROWS. A chunk that only the
 * dense lane found was scored, ranked, given lane provenance — and then
 * silently dropped at assembly because no provenance row existed for it.
 * Semantic retrieval could therefore only ever re-rank what the lexical lanes
 * had already found, which is the opposite of what it is for.
 *
 * Scenario F is the test that would have failed before the fix and cannot be
 * satisfied by a lexical lane: the query and the passage are chosen to share
 * NO stemmed lexemes, so the passage can only arrive through the dense lane.
 *
 * The corpus is SENTETİK (see fixtures.ts) — this proves plumbing, never
 * Turkish legal quality.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import {
  chunkProvenanceByIds,
  lexicalSearch,
  trigramSearch,
} from "../../src/store/chunkStore.js";
import {
  NoopDenseLane,
  searchPipeline,
  type DenseLane,
  type DenseLaneState,
} from "../../src/retrieval/hybrid.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  grantProbeRole,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "./testDb.js";
import { AS_OF, insertFixtures, type InsertedFixtures } from "./fixtures.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 300_000 });

/**
 * This lane owns its OWN scratch database.
 *
 * vitest runs test files in parallel, and `tests/store/retrieval.test.ts`
 * drops and recreates `collex_retrieval_test` in its own `beforeAll`. Sharing
 * that name meant whichever suite reset second pulled the database out from
 * under the other. One name per lane is the repo's scratch-database rule.
 */
const SCRATCH = scratchDatabase("collex_dense_test");

let sql: Sql;
let fixtures: InsertedFixtures;

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  await grantProbeRole(sql, SCRATCH);
  fixtures = await insertFixtures(sql);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

function chunkId(key: string): string {
  const id = fixtures.chunkIds.get(key);
  if (id === undefined) {
    throw new Error(
      "no fixture chunk for " + key + "; have: " +
        [...fixtures.chunkIds.keys()].join(", "),
    );
  }
  return id;
}

/** A dense lane that returns exactly the ids it was told to, in order. */
class StubDenseLane implements DenseLane {
  readonly name = "stub-dense";
  calls: Array<{ query: string; limit: number; filters: unknown }> = [];
  constructor(
    private readonly ids: readonly string[],
    readonly state: DenseLaneState = "ACTIVE",
  ) {}
  async search(
    queryText: string,
    options: { asOf: string; limit: number; filters?: unknown },
  ): Promise<string[]> {
    this.calls.push({
      query: queryText,
      limit: options.limit,
      filters: options.filters,
    });
    return [...this.ids];
  }
}

class ThrowingDenseLane implements DenseLane {
  readonly name = "throwing-dense";
  readonly state: DenseLaneState = "ACTIVE";
  async search(): Promise<string[]> {
    throw new Error("index unreachable");
  }
}

// ---------------------------------------------------------------------------
// chunkProvenanceByIds — the hydration primitive
// ---------------------------------------------------------------------------

describe("chunkProvenanceByIds", () => {
  it("hydrates a chunk id into full provenance", async () => {
    const id = chunkId("TCK-5237-EXCERPT#v2:158");
    const rows = await chunkProvenanceByIds(sql, [id], { asOf: AS_OF });

    expect(rows).toHaveLength(1);
    const provenance = rows[0]!;
    expect(provenance.chunkId).toBe(id);
    // Everything assembly needs, not just the id.
    expect(provenance.originalText.length).toBeGreaterThan(0);
    expect(provenance.chunkSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.documentVersionId).not.toBe("");
    expect(provenance.source).not.toBe("");
    expect(provenance.startChar).toBeGreaterThanOrEqual(0);
    expect(provenance.endChar).toBeGreaterThan(provenance.startChar);
  });

  it("returns nothing for ids that do not exist, without throwing", async () => {
    const rows = await chunkProvenanceByIds(
      sql,
      ["11111111-2222-3333-4444-555555555555"],
      { asOf: AS_OF },
    );
    expect(rows).toEqual([]);
  });

  it("applies the SAME visibility filter as the ranked lanes", async () => {
    // A chunk that exists but is outside the caller's file scope must not
    // hydrate. The vector index is untrusted input: the database decides.
    const id = chunkId("TCK-5237-EXCERPT#v2:158");
    const rows = await chunkProvenanceByIds(sql, [id], {
      asOf: AS_OF,
      filters: { fileIds: ["not-this-document"], includeCorpus: false },
    });
    expect(rows).toEqual([]);
  });

  it("deduplicates repeated ids", async () => {
    const id = chunkId("TCK-5237-EXCERPT#v2:158");
    const rows = await chunkProvenanceByIds(sql, [id, id, id], { asOf: AS_OF });
    expect(rows).toHaveLength(1);
  });

  it("is empty for an empty id list without touching the database", async () => {
    expect(await chunkProvenanceByIds(sql, [], { asOf: AS_OF })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scenario F — the semantic-only passage
// ---------------------------------------------------------------------------

/**
 * A query deliberately unrelated, lexically, to the fixture corpus:
 * different domain, no shared stems. If any lexical/trigram lane can find
 * the target passage the scenario is void — so that is asserted first.
 */
const UNRELATED_QUERY = "kooperatif genel kurulunda oy hakkı devri";

describe("scenario F: a dense-only passage reaches the final ranking", () => {

  it("the lexical lanes really cannot find the target passage", async () => {
    const target = chunkId("TCK-5237-EXCERPT#v2:158");

    const lexical = await lexicalSearch(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      limit: 40,
    });
    const trigram = await trigramSearch(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      limit: 40,
      minSimilarity: 0.35,
    });

    const found = [...lexical, ...trigram].map((r) => r.provenance.chunkId);
    expect(found).not.toContain(target);
  });

  it("with a dense lane, that passage becomes a real ranked hit", async () => {
    const target = chunkId("TCK-5237-EXCERPT#v2:158");
    const lane = new StubDenseLane([target]);

    const result = await searchPipeline(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      denseLane: lane,
    });

    const hit = result.hits.find((h) => h.provenance.chunkId === target);
    expect(hit).toBeDefined();
    // It is a COMPLETE hit, not a bare id: assembly needs the text and the
    // hash, and this is exactly what used to be missing.
    expect(hit!.provenance.originalText.length).toBeGreaterThan(0);
    expect(hit!.provenance.chunkSha256).toMatch(/^[0-9a-f]{64}$/u);
    // And it is attributed to the lane that actually found it.
    expect(hit!.lanes.map((l) => l.lane)).toContain("dense");
  });

  it("reports honestly that the dense lane contributed something new", async () => {
    const target = chunkId("TCK-5237-EXCERPT#v2:158");
    const result = await searchPipeline(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      denseLane: new StubDenseLane([target]),
    });

    expect(result.dense.state).toBe("ACTIVE");
    expect(result.dense.returned).toBe(1);
    expect(result.dense.hydrated).toBe(1);
    // The number that says semantic retrieval is retrieving, not re-ranking.
    expect(result.dense.denseOnly).toBe(1);
    expect(result.lanesAttempted).toContain("dense");
  });

  it("passes the caller's filters down to the lane", async () => {
    const lane = new StubDenseLane([]);
    await searchPipeline(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      denseLane: lane,
      filters: { sources: ["fixture-mevzuat"] },
    });
    expect(lane.calls).toHaveLength(1);
    expect(lane.calls[0]!.filters).toEqual({ sources: ["fixture-mevzuat"] });
  });
});

// ---------------------------------------------------------------------------
// The index is untrusted input
// ---------------------------------------------------------------------------

describe("dense results are re-checked against the database", () => {
  it("an out-of-scope dense id never becomes a hit", async () => {
    const target = chunkId("TCK-5237-EXCERPT#v2:158");
    // The lane offers a corpus chunk while the caller is scoped to an
    // upload. A vector index has no idea about file scope; hydration does.
    const result = await searchPipeline(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      denseLane: new StubDenseLane([target]),
      filters: { fileIds: ["a1b2c3d4e5f60718"], includeCorpus: false },
    });

    expect(result.hits.map((h) => h.provenance.chunkId)).not.toContain(target);
    expect(result.dense.returned).toBe(1);
    expect(result.dense.denseOnly).toBe(0);
  });

  it("a stale index entry is dropped, not reported as an error", async () => {
    const result = await searchPipeline(sql, UNRELATED_QUERY, {
      asOf: AS_OF,
      denseLane: new StubDenseLane(["11111111-2222-3333-4444-555555555555"]),
    });
    expect(result.dense.returned).toBe(1);
    expect(result.dense.hydrated).toBe(0);
    expect(result.laneFailures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Honest states
// ---------------------------------------------------------------------------

describe("dense lane state reporting", () => {
  it("DISABLED is not ACTIVE: the noop lane is not reported as attempted", async () => {
    const result = await searchPipeline(sql, "dolandırıcılık cezası", {
      asOf: AS_OF,
      denseLane: new NoopDenseLane(),
    });
    expect(result.dense.state).toBe("DISABLED");
    expect(result.dense.returned).toBe(0);
    // The lane did not run, so the result must not claim it did.
    expect(result.lanesAttempted).not.toContain("dense");
  });

  it("defaults to DISABLED when no lane is wired at all", async () => {
    const result = await searchPipeline(sql, "dolandırıcılık cezası", {
      asOf: AS_OF,
    });
    expect(result.dense.state).toBe("DISABLED");
    expect(result.lanesAttempted).not.toContain("dense");
  });

  it("a throwing lane is FAILED and does not take the search down", async () => {
    const result = await searchPipeline(sql, "dolandırıcılık cezası", {
      asOf: AS_OF,
      denseLane: new ThrowingDenseLane(),
    });
    expect(result.dense.state).toBe("FAILED");
    expect(result.laneFailures.map((f) => f.lane)).toContain("dense");
    // The lexical lanes still answered.
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
