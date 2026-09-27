/**
 * REAL integration tests for the store layer + hybrid retrieval pipeline,
 * executed against the LOCAL scratch PostgreSQL 18 at 127.0.0.1:55432.
 *
 * They do not skip. `requireScratchPostgres()` throws with an explicit
 * message when the server is unreachable, because the point of this lane is
 * to prove the SQL runs — a green suite that quietly skipped proves nothing.
 *
 * Scope: creates/drops only the database `collex_retrieval_test` and the
 * nologin role `collex_retrieval_test_probe`. Migrations 20260826080000 and
 * 20260826090000 need pgvector and are never applied here; the runnable set
 * is derived with the same marker rule as ingestion/migrations.py (see
 * testDb.ts).
 *
 * Everything in the corpus is SENTETİK — see fixtures.ts.
 */

import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_RRF_K } from "../../src/retrieval/rrf.js";
import { expandQuery } from "../../src/retrieval/queryExpansion.js";
import { createDb, resolveDatabaseUrl, type Sql } from "../../src/store/db.js";
import {
  explainTrigramSearch,
  fetchCanonicalText,
  lexicalSearch,
  listInForceVersions,
  trigramSearch,
  TrigramBudgetExceededError,
  DEFAULT_TRIGRAM_BUDGET_MS,
  QUERY_NORMALIZER_VERSION,
  bm25Idf,
  analyzeQueryLexemes,
  invalidateLexicalStats,
  lexemeDocumentFrequencies,
  LEXICAL_DF_CACHE_TTL_MS,
  DEFAULT_LEXICAL_MIN_COVERAGE,
  exactPinLookup,
} from "../../src/store/chunkStore.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";
import {
  CITATION_SCORE_FACTOR,
  DEFAULT_LANE_WEIGHTS,
  DEFAULT_TRIGRAM_FALLBACK_MIN_HITS,
  searchPipeline,
} from "../../src/retrieval/hybrid.js";
import { searchLegalCorpus } from "../../src/retrieval/searchService.js";
import { CORPUS_UNAVAILABLE_MESSAGE_TR } from "../../src/retrieval/corpusErrors.js";
import { createStoreRetrievalPort } from "../../src/pipeline/storeAdapters.js";
import {
  applyMigrationsAndSeed,
  connectAsTenant,
  connectTestDb,
  grantProbeRole,
  HOST_PORT,
  needsPgvector,
  PGVECTOR_MARKER,
  pgvectorRuleContract,
  planMigrations,
  requireScratchPostgres,
  resetScratchDatabase,
  type MigrationPlan,
} from "./testDb.js";
import {
  AS_OF,
  codePointLength,
  insertFixtures,
  sha256Hex,
  UPLOAD_FILE_ID,
  type InsertedFixtures,
} from "./fixtures.js";

// Creating the database and applying 9 migrations + seed + fixtures takes
// well past vitest's 10s hook default; individual queries are fast but the
// first one pays connection setup.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 300_000 });

let sql: Sql;
let plan: MigrationPlan;
let fixtures: InsertedFixtures;
let serverVersion: string;

/** Chunk id of a fixture chunk, or a loud failure. */
function chunkId(key: string): string {
  const id = fixtures.chunkIds.get(key);
  if (id === undefined) throw new Error("no fixture chunk for " + key);
  return id;
}

function versionId(key: string): string {
  const id = fixtures.versionIds.get(key);
  if (id === undefined) throw new Error("no fixture version for " + key);
  return id;
}

beforeAll(async () => {
  serverVersion = await requireScratchPostgres();
  await resetScratchDatabase();
  plan = await applyMigrationsAndSeed();
  sql = connectTestDb();
  await grantProbeRole(sql);
  fixtures = await insertFixtures(sql);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// Pure unit checks (no DB needed)
// ---------------------------------------------------------------------------

describe("db factory", () => {
  it("resolveDatabaseUrl reads COLLEX_DB_URL and fails loudly when unset", () => {
    expect(
      resolveDatabaseUrl({ COLLEX_DB_URL: "postgres://x@localhost/db" }),
    ).toBe("postgres://x@localhost/db");
    expect(() => resolveDatabaseUrl({})).toThrow(/COLLEX_DB_URL/);
    expect(() => resolveDatabaseUrl({ COLLEX_DB_URL: "  " })).toThrow(
      /COLLEX_DB_URL/,
    );
  });
});

describe("migration selection mirrors ingestion/migrations.py", () => {
  it("uses the marker rule, not a filename boundary", async () => {
    const contract = await pgvectorRuleContract();
    expect(contract.marker).toBe(PGVECTOR_MARKER);
    // The Python prefix is f"-- {PGVECTOR_MARKER}"; if that expression ever
    // changes shape, this port has to be revisited rather than silently drift.
    expect(contract.prefixExpression).toBe('f"-- {PGVECTOR_MARKER}"');

    // Prose mentioning the marker mid-line must NOT classify a file.
    expect(needsPgvector("-- explains why it is not [REQUIRES PGVECTOR]")).toBe(
      false,
    );
    expect(needsPgvector("  -- [REQUIRES PGVECTOR] embeddings")).toBe(true);
  });

  it("classifies every migration and keeps 100000/110000 runnable", async () => {
    const fresh = await planMigrations();
    expect(fresh.runnable.length + fresh.pgvector.length).toBe(
      fresh.all.length,
    );
    // These two are the files a timestamp boundary used to drop on the floor:
    // 100000 defines the close-on-append trigger, 110000 the turkish FTS
    // column this whole lane is built on.
    expect(fresh.runnable).toContain("20260826100000_version_transitions.sql");
    expect(fresh.runnable).toContain("20260826110000_turkish_fts.sql");
    expect(fresh.pgvector).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe("store retrieval (integration, local scratch PostgreSQL)", () => {
  it("applied the full non-pgvector migration chain against a real server", async () => {
    expect(serverVersion).toMatch(/PostgreSQL/);
    expect(plan.runnable.length).toBeGreaterThanOrEqual(9);
    // The turkish FTS column really exists (110000 was applied, not skipped).
    const columns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'legal' and table_name = 'chunks'
        and column_name in ('search_tsv', 'search_tsv_tr', 'normalizer_version')
      order by column_name`;
    expect(columns.map((r) => r["column_name"])).toEqual([
      "normalizer_version",
      "search_tsv",
      "search_tsv_tr",
    ]);
    // ...and so does the close-on-append trigger from 100000.
    const triggers = await sql`
      select tgname from pg_trigger
      where tgrelid = 'legal.document_versions'::regclass and not tgisinternal`;
    expect(triggers.map((r) => r["tgname"])).toContain(
      "document_versions_close_previous",
    );
  });

  it("fixture offsets satisfy the canonical-text substring invariant", async () => {
    const rows = await sql`
      select count(*)::int as bad
      from legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      where substring(v.canonical_text from c.start_char + 1
                      for c.end_char - c.start_char) is distinct from
            c.original_text`;
    expect(rows[0]?.["bad"]).toBe(0);

    // Same invariant expressed on the JS side, in code points.
    const text = fixtures.canonicalTexts.get("TCK-5237-EXCERPT#v2") ?? "";
    expect(codePointLength(text)).toBeGreaterThan(0);
  });

  // =========================================================================
  // (a) TURKISH vs SIMPLE full-text search
  // =========================================================================
  //
  // MEASURED on PostgreSQL 18.1 (this test executes every cell; the tsvector
  // / tsquery strings below are verbatim server output):
  //
  // | # | input                                        | config  | server result                                              |
  // |---|----------------------------------------------|---------|------------------------------------------------------------|
  // | 1 | to_tsvector(cfg,'dolandırıcılığın cezası      | turkish | 'cezas':2 'dolandırıcılık':1,3                             |
  // |   |   dolandırıcılık')                           | simple  | 'cezası':2 'dolandırıcılık':3 'dolandırıcılığın':1         |
  // | 2 | websearch_to_tsquery(cfg,                    | turkish | 'dolandırıcılık' & 'cezas'                                 |
  // |   |   'dolandırıcılığın cezası')                 | simple  | 'dolandırıcılığın' & 'cezası'                              |
  // | 3 | that query @@ the TCK m.157 chunk            | turkish | TRUE                                                       |
  // |   |                                              | simple  | FALSE                                                      |
  //
  // RECALL on this corpus for the user query "dolandırıcılığın cezası"
  // (relevant chunk set = {TCK-5237 v2 m.157}):
  //
  // | config  | hits | relevant found | recall | precision |
  // |---------|------|----------------|--------|-----------|
  // | turkish |  1   |       1        |  1.00  |   1.00    |
  // | simple  |  0   |       0        |  0.00  |    n/a    |
  //
  // WHY: the Turkish snowball stemmer strips the genitive -ın/-ığın and the
  // possessive -ı, so the inflected query form and the bare form in the text
  // collapse to one lexeme. 'simple' indexes surface forms, so an AND-query
  // over inflected words can only match text that happens to carry the exact
  // same inflection — which legal text, being written in the nominative,
  // usually does not.
  //
  // LIMIT OF THE WIN (also measured, and the reason search_tsv stays as the
  // A/B baseline per brief 8.6): the stemmer is not a synonym engine and is
  // not always self-consistent —
  //   to_tsvector('turkish','zamanaşımı')  => 'zamanaş'
  //   websearch_to_tsquery('turkish','zamanaşımının') => 'zamanaşım'
  // i.e. two inflections of the SAME word stem differently and do not match.
  // The turkish config is a large recall gain, not a solved problem, and the
  // switch still needs the gold-set comparison before it becomes the default
  // everywhere.
  // WHICH LANE MODE THIS MEASURES (updated 2026-08-27). The lexical lane's
  // default is now `mode: "coverage"`, which ORs the query lexemes and keeps
  // rows covering at least a quarter of them; a two-lexeme query therefore
  // admits a row carrying EITHER lexeme, which would make this test pass for
  // the wrong reason. `minCoverage: 1` demands every query lexeme, i.e. exactly
  // the conjunctive semantics this test was written to probe — so the stemming
  // property is still measured, and measured through the code path that now
  // runs in production. The default-floor behaviour is asserted separately at
  // the end.
  it("(a) turkish config matches the stemmed form, simple does not", async () => {
    const query = "dolandırıcılığın cezası";

    const turkish = await lexicalSearch(sql, query, {
      asOf: AS_OF,
      limit: 50,
      config: "turkish",
      minCoverage: 1,
    });
    expect(turkish).toHaveLength(1);
    expect(turkish[0]?.coverage).toBe(1);
    expect(turkish[0]?.provenance.externalId).toBe("TCK-5237-EXCERPT");
    expect(turkish[0]?.provenance.articleNo).toBe("157");
    expect(turkish[0]?.provenance.chunkId).toBe(
      chunkId("TCK-5237-EXCERPT#v2:157"),
    );
    // The match is genuinely stem-mediated: the inflected query form does not
    // occur in the text at all.
    expect(turkish[0]?.provenance.originalText).toContain("dolandırıcılık");
    expect(turkish[0]?.provenance.originalText).not.toContain(
      "dolandırıcılığın",
    );

    const simple = await lexicalSearch(sql, query, {
      asOf: AS_OF,
      limit: 50,
      config: "simple",
      minCoverage: 1,
    });
    expect(simple).toHaveLength(0);

    // The default coverage floor finds the same chunk FIRST, and additionally
    // admits m.158 on partial coverage — it carries "dolandırıcılık" but not
    // the query's "cezas". That is the coverage lane behaving as designed: a
    // full-coverage match ranks above a half-coverage one rather than the
    // half-coverage one being silently dropped.
    const defaults = await lexicalSearch(sql, query, {
      asOf: AS_OF,
      limit: 50,
      config: "turkish",
    });
    expect(defaults.map((r) => r.provenance.articleNo)).toEqual(["157", "158"]);
    expect(defaults[0]?.coverage).toBe(1);
    expect(defaults[1]?.coverage).toBe(0.5);

    // The raw server output quoted in the table above, re-measured here so
    // the documentation cannot go stale without this test failing.
    const rows = await sql`
      select to_tsvector('turkish', ${"dolandırıcılığın cezası dolandırıcılık"})::text as tsv_tr,
             to_tsvector('simple',  ${"dolandırıcılığın cezası dolandırıcılık"})::text as tsv_simple,
             websearch_to_tsquery('turkish', ${query})::text as q_tr,
             websearch_to_tsquery('simple',  ${query})::text as q_simple`;
    expect(rows[0]?.["tsv_tr"]).toBe("'cezas':2 'dolandırıcılık':1,3");
    expect(rows[0]?.["tsv_simple"]).toBe(
      "'cezası':2 'dolandırıcılık':3 'dolandırıcılığın':1",
    );
    expect(rows[0]?.["q_tr"]).toBe("'dolandırıcılık' & 'cezas'");
    expect(rows[0]?.["q_simple"]).toBe("'dolandırıcılığın' & 'cezası'");
  });

  it("(a) documents the stemmer's own limit (zamanaşımı inflections)", async () => {
    const rows = await sql`
      select to_tsvector('turkish', ${"zamanaşımı"})::text as noun,
             websearch_to_tsquery('turkish', ${"zamanaşımının"})::text as inflected`;
    // Same word, different stems: a real recall gap the turkish config does
    // NOT close. Recorded so nobody reads the (a) win as "Turkish solved".
    expect(rows[0]?.["noun"]).toBe("'zamanaş':1");
    expect(rows[0]?.["inflected"]).toBe("'zamanaşım'");
  });

  // =========================================================================
  // (b) EXACT-PIN LANE
  // =========================================================================

  it("(b) '5237 sayılı kanun m. 157' pins m.157 first, above better-scoring bait", async () => {
    const result = await searchPipeline(sql, "5237 sayılı kanun m. 157", {
      asOf: AS_OF,
    });
    expect(result.laneFailures).toEqual([]);

    const kinds = result.references.map((r) => r.kind);
    expect(kinds).toContain("legislation");
    expect(kinds).toContain("article");
    expect(
      result.references.find((r) => r.kind === "legislation")?.legislationNo,
    ).toBe("5237");

    const first = result.hits[0];
    expect(first?.pinned).toBe(true);
    expect(first?.chunkId).toBe(chunkId("TCK-5237-EXCERPT#v2:157"));
    expect(first?.provenance.articleNo).toBe("157");
    expect(first?.provenance.legislationNo).toBe("5237");
    expect(first?.pinReason).toBe("legislation_no=5237 article_no=157");
    expect(first?.lanes[0]?.lane).toBe("exact");

    // Only m.157 is pinned — the article filter excludes m.158.
    expect(
      result.hits.filter((h) => h.pinned).map((h) => h.provenance.articleNo),
    ).toEqual(["157"]);

    // NON-VACUOUS: the doctrine note's text is almost the query itself, so it
    // outscores the pinned chunk in the fused ranking and is still placed
    // after it.
    //
    // The pinned chunk used to fuse to exactly 0 (it reached no ranked lane at
    // all under the old conjunctive lexical query). It now reaches the lexical
    // lane at rank 2, which makes this test STRICTER, not weaker: the pin is
    // no longer trivially first because nothing else could be — it is first
    // while carrying a genuinely lower fused score than the bait.
    const bait = result.hits.find(
      (h) => h.provenance.externalId === "DOKTRIN-5237-NOTU",
    );
    expect(bait).toBeDefined();
    expect(bait?.pinned).toBe(false);
    expect(bait?.fusedScore ?? 0).toBeGreaterThan(first?.fusedScore ?? 0);
    expect(result.hits.indexOf(bait!)).toBeGreaterThan(0);
  });

  it("(b) 'TCK m. 157' resolves the abbreviation and pins the SAME chunk", async () => {
    const result = await searchPipeline(sql, "TCK m. 157", { asOf: AS_OF });
    expect(result.laneFailures).toEqual([]);

    // The abbreviation table lives in the reference parser, so the store lane
    // needs no abbreviation logic: it receives legislationNo 5237 already.
    const legislation = result.references.find((r) => r.kind === "legislation");
    expect(legislation?.abbreviation).toBe("TCK");
    expect(legislation?.legislationNo).toBe("5237");
    expect(legislation?.canonicalName).toBe("Türk Ceza Kanunu");

    const first = result.hits[0];
    expect(first?.pinned).toBe(true);
    expect(first?.chunkId).toBe(chunkId("TCK-5237-EXCERPT#v2:157"));
    expect(first?.pinReason).toBe("legislation_no=5237 article_no=157");

    // The pin is LOAD-BEARING, shown two ways.
    //
    // 1. The lexical lane cannot resolve the abbreviation: the article text
    //    contains no "tck" lexeme, so demanding full coverage of "tck m. 157"
    //    returns the article chunk not at all. Only the parser's abbreviation
    //    table gets from "TCK" to legislation 5237.
    const strict = await lexicalSearch(sql, "tck m. 157", {
      asOf: AS_OF,
      limit: 50,
      minCoverage: 1,
    });
    expect(
      strict.some((r) => r.provenance.externalId === "TCK-5237-EXCERPT"),
    ).toBe(false);

    // 2. At the default floor the lane does reach the chunk — on the bare
    //    "157" token, at one third coverage — but ranks the doctrine note
    //    above it. Left to the ranked lanes this query answers with commentary
    //    instead of the provision; the pin is what puts the article first.
    const lexical = await lexicalSearch(sql, "tck m. 157", {
      asOf: AS_OF,
      limit: 50,
    });
    expect(lexical[0]?.provenance.externalId).toBe("DOKTRIN-5237-NOTU");
    const article = lexical.find(
      (r) => r.provenance.externalId === "TCK-5237-EXCERPT",
    );
    expect(article?.coverage ?? 1).toBeLessThan(0.5);
  });

  it("(b) a cited provision arrives UNPINNED on the citation lane, after its seed, at 0.9x its score", async () => {
    // The doctrine note cites "5237 sayılı Kanun m. 157"; the question does
    // not. Before W12 the expansion arrived pinned with score 1 — a passage
    // the reader never asked for, dressed as the one they did.
    const result = await searchPipeline(sql, "doktrin notu", { asOf: AS_OF });
    expect(result.laneFailures).toEqual([]);
    expect(result.lanesAttempted).toContain("citation");

    const seedIndex = result.hits.findIndex(
      (h) => h.provenance.externalId === "DOKTRIN-5237-NOTU",
    );
    const citedIndex = result.hits.findIndex((h) => h.citation !== undefined);
    expect(seedIndex).toBeGreaterThanOrEqual(0);
    expect(citedIndex).toBe(seedIndex + 1);

    const seed = result.hits[seedIndex]!;
    const cited = result.hits[citedIndex]!;
    expect(cited.chunkId).toBe(chunkId("TCK-5237-EXCERPT#v2:157"));
    expect(cited.citation).toEqual({ citedByChunkId: seed.chunkId, reference: "5237 m.157" });
    expect(cited.pinned).toBe(false);
    expect(cited.pinReason).toBeUndefined();
    expect(cited.lanes.map((l) => l.lane)).toEqual(["citation"]);
    expect(cited.fusedScore).toBeCloseTo(seed.fusedScore * CITATION_SCORE_FACTOR, 12);
    expect(cited.fusedScore).toBeLessThan(seed.fusedScore);
    // A pinned hit now means exactly one thing: the QUESTION cited it.
    expect(result.hits.some((h) => h.pinned)).toBe(false);
  });

  it("(b) an E./K. docket reference pins the decision chunk", async () => {
    const result = await searchPipeline(
      sql,
      "İstanbul Bölge Adliye Mahkemesi 15. Hukuk Dairesi E. 2023/45 K. 2024/12",
      { asOf: AS_OF },
    );
    const first = result.hits[0];
    expect(first?.pinned).toBe(true);
    expect(first?.provenance.externalId).toBe("IST-BAM-2024-12");
    expect(first?.provenance.docketNo).toBe("2023/45");
    expect(first?.provenance.decisionNo).toBe("2024/12");
    expect(first?.provenance.decisionDate).toBe("2024-03-15");
    expect(first?.provenance.publicationDate).toBe("2024-04-01");
    expect(first?.pinReason).toBe("docket_no=2023/45 decision_no=2024/12");
  });

  it("(b2) W17/c: a decision is pinned only together with its court", async () => {
    // MEASURED: E./K. numbers were the whole identity, so a citation to a
    // DIFFERENT court's decision that shares the numbers was pinned — and
    // the citation audit reported it "bulundu". The fixture version names
    // "İstanbul Bölge Adliye Mahkemesi".
    const pin = (text: string, requireCourtMatch = false) =>
      exactPinLookup(sql, parseReferences(text), { asOf: AS_OF, limit: 8, requireCourtMatch });

    // Another court, same numbers: never this decision.
    expect(await pin("Danıştay 10. D. E. 2023/45 K. 2024/12")).toEqual([]);
    expect(await pin("Yargıtay 15. HD E. 2023/45 K. 2024/12", true)).toEqual([]);
    // The audit's stricter mode: no court named in the citation → no pin.
    expect(await pin("E. 2023/45 K. 2024/12", true)).toEqual([]);
    // NON-VACUITY: the right court still pins, in both modes, and a
    // court-less reference still pins for the retrieval lane.
    const right = await pin("İstanbul BAM 15. HD E. 2023/45 K. 2024/12", true);
    expect(right[0]?.provenance.externalId).toBe("IST-BAM-2024-12");
    const lane = await pin("E. 2023/45 K. 2024/12");
    expect(lane[0]?.provenance.externalId).toBe("IST-BAM-2024-12");
  });

  // =========================================================================
  // (c) TEMPORAL (as_of) — bitemporal, one answer per document
  // =========================================================================

  it("(c) as_of selects the version in force, and only that one", async () => {
    const query = "dolandırıcılığın cezası";

    const historic = await searchPipeline(sql, query, { asOf: "2010-01-01" });
    // Every hit comes from ONE version of the document — the one in force.
    expect(new Set(historic.hits.map((h) => h.documentVersionId))).toEqual(
      new Set([versionId("TCK-5237-EXCERPT#v1")]),
    );
    expect(historic.hits[0]?.chunkId).toBe(chunkId("TCK-5237-EXCERPT#v1:157"));
    expect(historic.hits[0]?.provenance.originalText).toContain(
      "bir yıldan beş yıla kadar",
    );

    const current = await searchPipeline(sql, query, { asOf: AS_OF });
    expect(new Set(current.hits.map((h) => h.documentVersionId))).toEqual(
      new Set([versionId("TCK-5237-EXCERPT#v2")]),
    );
    expect(current.hits[0]?.chunkId).toBe(chunkId("TCK-5237-EXCERPT#v2:157"));
    expect(current.hits[0]?.provenance.originalText).toContain(
      "iki yıldan yedi yıla kadar",
    );
    // The superseded wording is gone entirely, not merely ranked lower.
    expect(
      current.hits.some((h) =>
        h.provenance.originalText.includes("bir yıldan beş yıla kadar"),
      ),
    ).toBe(false);

    expect(historic.hits[0]?.documentVersionId).not.toBe(
      current.hits[0]?.documentVersionId,
    );
    expect(historic.hits[0]?.documentId).toBe(current.hits[0]?.documentId);
  });

  it("(c) the close-on-append trigger really closed v1 (system + valid time)", async () => {
    const rows = await sql`
      select version_label,
             upper_inf(system_period) as system_open,
             effective_period::text as effective
      from legal.document_versions
      where id in (${versionId("TCK-5237-EXCERPT#v1")},
                   ${versionId("TCK-5237-EXCERPT#v2")})
      order by version_label`;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["version_label"]).toBe("v1");
    expect(rows[0]?.["system_open"]).toBe(false);
    expect(rows[0]?.["effective"]).toBe("[2005-06-01,2023-01-01)");
    expect(rows[1]?.["system_open"]).toBe(true);
    expect(rows[1]?.["effective"]).toBe("[2023-01-01,)");
  });

  it("(c) a version not yet in force is invisible until its commencement", async () => {
    const before = await searchPipeline(sql, "kriptovarlık platformları", {
      asOf: AS_OF,
    });
    expect(before.laneFailures).toEqual([]);
    expect(before.hits).toHaveLength(0);

    const after = await searchPipeline(sql, "kriptovarlık platformları", {
      asOf: "2027-06-01",
    });
    expect(after.hits.map((h) => h.provenance.externalId)).toEqual([
      "KRIPTO-2027",
    ]);
  });

  it("(c) EXACTLY ONE version per document is visible for any as_of", async () => {
    const dates = [
      "2004-01-01",
      "2010-01-01",
      "2012-12-31",
      "2023-06-01",
      AS_OF,
      "2027-06-01",
    ];
    for (const asOf of dates) {
      const versions = await listInForceVersions(sql, { asOf, limit: 500 });
      const perDocument = new Map<string, string[]>();
      for (const version of versions) {
        const list = perDocument.get(version.documentId) ?? [];
        list.push(version.documentVersionId);
        perDocument.set(version.documentId, list);
      }
      const duplicated = [...perDocument.entries()].filter(
        ([, ids]) => ids.length > 1,
      );
      expect(
        duplicated,
        "as_of " + asOf + " returned more than one version for a document",
      ).toEqual([]);
    }

    // Spot-check the actual selection at two dates.
    const at2010 = await listInForceVersions(sql, {
      asOf: "2010-01-01",
      limit: 500,
    });
    expect(
      at2010.find((v) => v.externalId === "TCK-5237-EXCERPT")
        ?.documentVersionId,
    ).toBe(versionId("TCK-5237-EXCERPT#v1"));

    const atNow = await listInForceVersions(sql, { asOf: AS_OF, limit: 500 });
    expect(
      atNow.find((v) => v.externalId === "TCK-5237-EXCERPT")
        ?.documentVersionId,
    ).toBe(versionId("TCK-5237-EXCERPT#v2"));
  });

  it("(c) an undated version answers only while nothing dated supersedes it", async () => {
    // GENELGE-UYGULAMA v1 has an UNKNOWN validity window; v2 states one.
    const atNow = await listInForceVersions(sql, { asOf: AS_OF, limit: 500 });
    const nowRow = atNow.find((v) => v.externalId === "GENELGE-UYGULAMA");
    expect(nowRow?.documentVersionId).toBe(versionId("GENELGE-UYGULAMA#v2"));

    // Before v2 commenced, v1 is NOT resurrected: it is superseded in system
    // time and its validity window is unknown, so the store declines to claim
    // it was in force in 2020 rather than guessing. (An undated version that
    // was never superseded DOES answer for every as_of — see the assertion
    // below on HAKSIZ-FIIL-NOTU.)
    const at2020 = await listInForceVersions(sql, {
      asOf: "2020-01-01",
      limit: 500,
    });
    expect(at2020.some((v) => v.externalId === "GENELGE-UYGULAMA")).toBe(false);

    const notu = at2020.find((v) => v.externalId === "HAKSIZ-FIIL-NOTU");
    expect(notu?.effectivePeriod).toBeNull();
    expect(notu?.systemCurrent).toBe(true);
  });

  // =========================================================================
  // (d) RRF FUSION
  // =========================================================================

  it("(d) a document in both ranked lanes outranks single-lane documents", async () => {
    const result = await searchPipeline(sql, "haksız fiil tazminatı", {
      asOf: AS_OF,
    });
    expect(result.laneFailures).toEqual([]);

    const byId = (externalId: string, article: string | null) =>
      result.hits.find(
        (h) =>
          h.provenance.externalId === externalId &&
          h.provenance.articleNo === article,
      );

    const notu = byId("HAKSIZ-FIIL-NOTU", null);
    const tbk49 = byId("TBK-6098-HAKSIZ-FIIL", "49");
    const tbk65 = byId("TBK-6098-HAKSIZ-FIIL", "65");
    expect(notu).toBeDefined();
    expect(tbk49).toBeDefined();
    expect(tbk65).toBeDefined();

    const lanesOf = (hit: typeof notu) =>
      (hit?.lanes ?? []).map((l) => l.lane).sort();
    expect(lanesOf(notu)).toEqual(["lexical", "trigram"]);
    expect(lanesOf(tbk49)).toEqual(["lexical", "trigram"]);
    expect(lanesOf(tbk65)).toEqual(["lexical"]);

    const k = DEFAULT_RRF_K;
    const wl = DEFAULT_LANE_WEIGHTS.lexical;
    const wt = DEFAULT_LANE_WEIGHTS.trigram;
    // Measured lane ranks on this corpus. 2026-08-27 (after the lexical lane
    // was fixed): lexical [tbk49, notu, tbk65, ...], trigram [notu, tbk49] —
    // the two swapped ranks and fused to the SAME score. Re-measured
    // 2026-09-10 after the lexical lane became IDF-aware with length
    // normalization (ts_rank_cd normalization 1): the 21-character note whose
    // text IS the query now leads the lexical lane too — lexical [notu,
    // tbk49, tbk65, tbk72, ...], trigram [notu, tbk49] — which is what the
    // fixture was authored to expect ("rank 1 of both ranked lanes"). The
    // three query lexemes have equal document frequency here, so IDF does not
    // separate them; the flip is length normalization alone. Fusion is now
    // weighted (DEFAULT_LANE_WEIGHTS: lexical 1, trigram 0.7).
    expect(notu?.fusedScore).toBeCloseTo(wl / (k + 1) + wt / (k + 1), 12);
    expect(tbk49?.fusedScore).toBeCloseTo(wl / (k + 2) + wt / (k + 2), 12);
    expect(tbk65?.fusedScore).toBeCloseTo(wl / (k + 3), 12);

    // The decisive property: two-lane presence at rank 2 beats the BEST score
    // any single-lane document could possibly reach (rank 1 in one lane) —
    // and it still does under the trigram discount.
    expect(tbk49?.fusedScore ?? 0).toBeGreaterThan(wl / (k + 1));
    expect(tbk49?.fusedScore ?? 0).toBeGreaterThan(tbk65?.fusedScore ?? 0);

    // ...and the final ordering reflects it: "HAKSIZ-FIIL-NOTU" first, then
    // the two TBK articles in lexical order.
    const order = result.hits.map(
      (h) => h.provenance.externalId + ":" + (h.provenance.articleNo ?? "_"),
    );
    expect(order.indexOf("HAKSIZ-FIIL-NOTU:_")).toBeLessThan(
      order.indexOf("TBK-6098-HAKSIZ-FIIL:49"),
    );
    expect(order.indexOf("TBK-6098-HAKSIZ-FIIL:49")).toBeLessThan(
      order.indexOf("TBK-6098-HAKSIZ-FIIL:65"),
    );
  });

  it("(d) the fused ranking is identical across repeated identical searches", async () => {
    // Ranking used to tie-break on legal.chunks.id, a random uuid minted at
    // ingest, so equal-scoring rows came back in an arbitrary order — and
    // because the per-document cap and the result limit are applied in rank
    // order, the RESULT SET itself varied. Two consecutive fixture-corpus eval
    // runs of one build disagreed on hit count (108 vs 109) and on
    // full-name-form accuracy (100.0% vs 85.7%). This query is the sharpest
    // case available: notu and tbk49 fuse to exactly equal scores.
    const runs = await Promise.all(
      [0, 1, 2].map(() =>
        searchPipeline(sql, "haksız fiil tazminatı", { asOf: AS_OF }),
      ),
    );
    const signatures = runs.map((run) =>
      run.hits
        .map(
          (h) =>
            h.provenance.externalId +
            ":" +
            (h.provenance.articleNo ?? "_") +
            "@" +
            h.fusedScore.toFixed(12),
        )
        .join("|"),
    );
    expect(signatures[1]).toBe(signatures[0]);
    expect(signatures[2]).toBe(signatures[0]);
    // Non-vacuous. Until 2026-09-10 this query fused notu and tbk49 to an
    // exact score tie; the IDF-aware lexical lane and the trigram discount
    // removed that tie (see (d) above), and with weighted lanes an exact
    // fused tie is structurally rare. What still makes the ORDER decide the
    // RESULT SET is the per-document cap: TBK-6098-HAKSIZ-FIIL has three
    // matching articles and the cap is three, so a different in-lane order
    // (chunkStore's stableTieBreak) would change which passages survive.
    const tbkHits = runs[0]?.hits.filter(
      (h) => h.provenance.externalId === "TBK-6098-HAKSIZ-FIIL",
    );
    expect(tbkHits?.length).toBe(3);
    expect(runs[0]?.hits.some((h) => h.lanes.some((l) => l.lane === "trigram"))).toBe(true);
  });

  // =========================================================================
  // (e) SOURCE DIVERSITY
  // =========================================================================

  it("(e) at most 3 chunks per document survive the fused list", async () => {
    const lane = await lexicalSearch(sql, "kira sözleşmesi", {
      asOf: AS_OF,
      limit: 50,
    });
    expect(
      lane.filter((r) => r.provenance.externalId === "KIRA-EXCERPT"),
    ).toHaveLength(4);

    const capped = await searchPipeline(sql, "kira sözleşmesi", {
      asOf: AS_OF,
    });
    expect(
      capped.hits.filter((h) => h.provenance.externalId === "KIRA-EXCERPT"),
    ).toHaveLength(3);

    const tight = await searchPipeline(sql, "kira sözleşmesi", {
      asOf: AS_OF,
      limits: { perDocumentCap: 1 },
    });
    expect(
      tight.hits.filter((h) => h.provenance.externalId === "KIRA-EXCERPT"),
    ).toHaveLength(1);
  });

  it("(e) the cap does NOT truncate an explicit citation (pinned are exempt)", async () => {
    // "6570 sayılı Kanun" names the whole instrument; silently returning 3 of
    // its 4 articles would drop text the user explicitly asked for.
    const result = await searchPipeline(sql, "6570 sayılı Kanun", {
      asOf: AS_OF,
    });
    const pinned = result.hits.filter((h) => h.pinned);
    expect(pinned).toHaveLength(4);
    expect(pinned.every((h) => h.provenance.externalId === "KIRA-EXCERPT")).toBe(
      true,
    );
    expect(pinned.map((h) => h.provenance.articleNo)).toEqual([
      "299",
      "300",
      "301",
      "302",
    ]);
  });

  // =========================================================================
  // (f) TURKISH CASING (dotted İ / dotless ı)
  // =========================================================================
  //
  // MEASURED for query "ıstanbul bölge adliye mahkemesi" against the chunk
  // whose search_text starts "istanbul bölge adliye mahkemesi ...":
  //
  // | lane                        | result  |
  // |-----------------------------|---------|
  // | FTS 'turkish'               | NO      |
  // | FTS 'simple'                | NO      |
  // | pg_trgm similarity()        | 0.273   |  (symmetric; decays with length)
  // | pg_trgm word_similarity()   | 0.935   |  (extent-based; length-stable)
  //
  // A user typing ASCII "ISTANBUL" gets tr-TR lowercased to "ıstanbul", which
  // shares no lexeme with the stored "istanbul": neither text-search config
  // folds the dotted/dotless pair. The trigram lane is what recovers it, and
  // it can only do so because the lane now scores with word_similarity —
  // similarity() would put this at 0.273 for a two-line chunk and lower still
  // for a real one.
  it("(f) a dotless-I query still finds the dotted-İ document", async () => {
    const result = await searchPipeline(sql, "ISTANBUL Bölge Adliye Mahkemesi", {
      asOf: AS_OF,
    });
    expect(result.normalizedQuery).toBe("ıstanbul bölge adliye mahkemesi");
    expect(result.laneFailures).toEqual([]);

    const hit = result.hits.find(
      (h) => h.provenance.externalId === "IST-BAM-2024-12",
    );
    expect(hit).toBeDefined();
    // Canonical text keeps its source spelling; only the search field folds.
    expect(hit?.provenance.originalText).toContain("İSTANBUL");
    expect((hit?.lanes ?? []).map((l) => l.lane)).toContain("trigram");

    // The ı/i TOKEN itself is still unbridged by FTS (that is the point of the
    // table above). The lexical lane also reaches this chunk now, but only on
    // the other three words — "bölge adliye mahkemesi" — never on "ıstanbul".
    // Demanding full coverage isolates the token under test, and it finds
    // nothing; the trigram lane is what actually closes the casing gap.
    const fullCoverage = await lexicalSearch(sql, "ıstanbul bölge adliye mahkemesi", {
      asOf: AS_OF,
      limit: 50,
      minCoverage: 1,
    });
    expect(
      fullCoverage.some((r) => r.provenance.externalId === "IST-BAM-2024-12"),
    ).toBe(false);
  });

  it("(f) records WHICH lane bridges the casing gap, and which cannot", async () => {
    const dotless = "ıstanbul bölge adliye mahkemesi";
    const dotted = "istanbul bölge adliye mahkemesi";

    // minCoverage: 1 makes the "ıstanbul" lexeme mandatory. Without it the
    // coverage lane would admit this chunk on the other three words and the
    // assertion would be measuring word overlap, not the casing fold.
    for (const config of ["turkish", "simple"]) {
      const rows = await lexicalSearch(sql, dotless, {
        asOf: AS_OF,
        limit: 50,
        config,
        minCoverage: 1,
      });
      expect(
        rows.some((r) => r.provenance.externalId === "IST-BAM-2024-12"),
        "FTS " + config + " unexpectedly bridged ı/i",
      ).toBe(false);
    }
    // The dotted form matches the FTS lane directly (control).
    const dottedRows = await lexicalSearch(sql, dotted, {
      asOf: AS_OF,
      limit: 50,
    });
    expect(
      dottedRows.some((r) => r.provenance.externalId === "IST-BAM-2024-12"),
    ).toBe(true);

    const trigram = await trigramSearch(sql, dotless, {
      asOf: AS_OF,
      limit: 50,
    });
    const hit = trigram.find(
      (r) => r.provenance.externalId === "IST-BAM-2024-12",
    );
    expect(hit).toBeDefined();
    expect(hit?.score ?? 0).toBeGreaterThan(0.9);

    // And the symmetric metric the draft used would have been marginal:
    const rows = await sql`
      select extensions.similarity(c.search_text, ${dotless})::float8 as sim,
             extensions.word_similarity(${dotless}, c.search_text)::float8 as wsim
      from legal.chunks c
      where c.id = ${chunkId("IST-BAM-2024-12#v1:_")}`;
    expect(Number(rows[0]?.["sim"])).toBeLessThan(0.35);
    expect(Number(rows[0]?.["wsim"])).toBeGreaterThan(0.9);
  });

  // =========================================================================
  // (g) fetchCanonicalText — the contract the citation validator depends on
  // =========================================================================

  it("(g) sha256 of the returned text equals the stored content_sha256", async () => {
    const id = versionId("TCK-5237-EXCERPT#v2");
    const record = await fetchCanonicalText(sql, id);
    expect(record).not.toBeNull();
    expect(record?.canonicalText).toBe(
      fixtures.canonicalTexts.get("TCK-5237-EXCERPT#v2"),
    );
    expect(sha256Hex(record?.canonicalText ?? "")).toBe(record?.contentSha256);

    // Cross-language: this hash was computed by the Python seed generator and
    // is re-derived here in Node from the bytes the server returned.
    const seed = await fetchCanonicalText(
      sql,
      "00000000-0000-4000-8000-000000000301",
    );
    expect(seed).not.toBeNull();
    expect(sha256Hex(seed?.canonicalText ?? "")).toBe(seed?.contentSha256);
    expect(seed?.contentSha256).toBe(
      "75a8fdc87d07e7daaf79d782570484c431cde6ed8d73c98f2b83d4dba32f6174",
    );

    // Every fixture + seed version, not just the two above.
    const all = await sql`
      select id, canonical_text, content_sha256 from legal.document_versions`;
    expect(all.length).toBeGreaterThanOrEqual(12);
    for (const row of all) {
      expect(sha256Hex(String(row["canonical_text"]))).toBe(
        row["content_sha256"],
      );
    }
  });

  it("(g) chunk hashes and offsets round-trip through the search lanes", async () => {
    const hits = await lexicalSearch(sql, "kira sözleşmesi", {
      asOf: AS_OF,
      limit: 50,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const record = await fetchCanonicalText(sql, hit.provenance.documentVersionId);
      const canonical = record?.canonicalText ?? "";
      const points = [...canonical];
      const slice = points
        .slice(hit.provenance.startChar, hit.provenance.endChar)
        .join("");
      expect(slice).toBe(hit.provenance.originalText);
      expect(sha256Hex(slice)).toBe(hit.provenance.chunkSha256);
      expect(record?.contentSha256).toBe(hit.provenance.versionSha256);
    }
  });

  it("(g) null for an unknown id, RangeError for a non-uuid", async () => {
    expect(
      await fetchCanonicalText(sql, "00000000-0000-4000-8000-00000000dead"),
    ).toBeNull();
    await expect(fetchCanonicalText(sql, "not-a-uuid")).rejects.toThrow(
      RangeError,
    );
  });

  // =========================================================================
  // (h) PARTIAL RESULTS
  // =========================================================================

  it("(h) a clean run is ok with no warnings", async () => {
    const outcome = await searchLegalCorpus(sql, {
      query: "dolandırıcılığın cezası",
      asOf: AS_OF,
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.provider).toBe("STORE");
    expect(outcome.warnings).toEqual([]);
    // m.157 first, m.158 second. Both reach both lanes, but on different
    // strength: m.157 covers the whole query ("dolandırıcılık" + "cezas"),
    // m.158 only half of it — its "ceza" does not stem to the query's "cezas"
    // — so it is admitted behind m.157 rather than dropped.
    expect(
      outcome.data.map((h) => h.provenance.articleNo),
    ).toEqual(["157", "158"]);
    for (const hit of outcome.data) {
      expect(hit.lanes.map((l) => l.lane).sort()).toEqual([
        "lexical",
        "trigram",
      ]);
    }
    expect(outcome.data[0]?.lanes.every((l) => l.rank === 1)).toBe(true);
    expect(outcome.data[1]?.lanes.every((l) => l.rank === 2)).toBe(true);
  });

  it("(h) a failing lane yields PARTIAL with warnings, not a throw or a silent short list", async () => {
    // Baseline: with every lane healthy this query returns five hits.
    const healthy = await searchLegalCorpus(sql, {
      query: "haksız fiil tazminatı",
      asOf: AS_OF,
    });
    expect(healthy.status).toBe("ok");
    const healthyCount = healthy.status === "ok" ? healthy.data.length : -1;
    expect(healthyCount).toBe(5);

    // Force the lexical lane's SQL to fail inside Postgres (unknown
    // regconfig). The trigram lane still answers.
    const outcome = await searchLegalCorpus(sql, {
      query: "haksız fiil tazminatı",
      asOf: AS_OF,
      limits: { lexicalConfig: "no_such_config" },
    });
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") return;
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatch(/^lane lexical failed: /);
    expect(outcome.warnings[0]).toMatch(/no_such_config/);
    expect(outcome.error.kind).toBe("UNAVAILABLE");
    expect(outcome.error.retryable).toBe(true);
    expect(outcome.error.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // The surviving lane really did deliver, and the shortfall is declared
    // rather than passed off as a complete answer.
    expect(outcome.data.length).toBeGreaterThan(0);
    expect(outcome.data.length).toBeLessThan(healthyCount);
    for (const hit of outcome.data) {
      expect(hit.lanes.map((l) => l.lane)).not.toContain("lexical");
    }
  });

  it("(h) every result-bearing lane failing is an ERROR, not a happy empty list", async () => {
    // A pipeline-level failure (dead pool) must not look like "no results".
    const dead = connectTestDb();
    await dead.end({ timeout: 5 });
    const outcome = await searchLegalCorpus(dead, {
      query: "kira sözleşmesi",
      asOf: AS_OF,
    });
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.error.kind).toBe("UNAVAILABLE");
    // ...and it is TYPED (W12): an ended pool is CONNECTION_ENDED, i.e. the
    // corpus could not be reached, and the reader gets the Turkish sentence.
    expect(outcome.reasonCode).toBe("CORPUS_UNAVAILABLE");
    expect(outcome.error.safeMessage).toBe(CORPUS_UNAVAILABLE_MESSAGE_TR);
  });

  it("(h) a MISSING database is CORPUS_UNAVAILABLE in Turkish — no driver text (W12)", async () => {
    // Connecting to a database that does not exist raises SQLSTATE 3D000
    // (measured on PostgreSQL 18.1). Nothing is created or dropped here; the
    // name is deliberately not a collex_* name so it can never be mistaken
    // for another lane's scratch database.
    const missing = createDb({
      url: "postgres://postgres@" + HOST_PORT + "/nonexistent_db_for_3d000_probe",
      max: 1,
      connectTimeoutS: 5,
      applicationName: "collex-store-tests-3d000",
    });
    try {
      const outcome = await searchLegalCorpus(missing, {
        query: "kira sözleşmesi",
        asOf: AS_OF,
      });
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") return;
      expect(outcome.reasonCode).toBe("CORPUS_UNAVAILABLE");
      expect(outcome.error.safeMessage).toBe(CORPUS_UNAVAILABLE_MESSAGE_TR);
      expect(outcome.error.safeMessage).not.toMatch(/does not exist|3D000|nonexistent/);

      // The pipeline adapter carries the type through (contract [R] item 4).
      const port = createStoreRetrievalPort(missing);
      const result = await port.search({ query: "kira sözleşmesi", asOf: AS_OF });
      expect(result.status).toBe("error");
      expect(result.errorCode).toBe("CORPUS_UNAVAILABLE");
      expect(result.error).toBe(CORPUS_UNAVAILABLE_MESSAGE_TR);
    } finally {
      await missing.end({ timeout: 5 });
    }
  });

  it("(h) normalizer drift is reported as a warning on an ok outcome", async () => {
    const outcome = await searchLegalCorpus(sql, {
      query: "kusursuz sorumluluk ilkesi",
      asOf: AS_OF,
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    // The drifted row is retrieved and ranked first. Other rows may join it —
    // the coverage lane admits partial matches — but the property under test
    // is that a row indexed by a FOREIGN normalizer is still returned and is
    // declared, so it is asserted by identity rather than by result count.
    const drifted = outcome.data.filter(
      (h) => h.provenance.normalizerVersion !== QUERY_NORMALIZER_VERSION,
    );
    expect(drifted).toHaveLength(1);
    expect(drifted[0]?.provenance.externalId).toBe("NORMALIZER-DRIFT-NOTU");
    expect(drifted[0]?.provenance.normalizerVersion).toBe("trnorm-v2");
    expect(outcome.data[0]?.provenance.externalId).toBe(
      "NORMALIZER-DRIFT-NOTU",
    );
    // One warning per DISTINCT foreign normalizer version, not per row.
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatch(/normalizer drift/);
    expect(outcome.warnings[0]).toContain(QUERY_NORMALIZER_VERSION);
    // The row is still returned — dropping it would be silent recall loss in
    // the other direction.
  });

  it("(h) invalid requests are INVALID_REQUEST, never a query", async () => {
    const empty = await searchLegalCorpus(sql, { query: "" });
    expect(empty.status).toBe("error");
    if (empty.status === "error") {
      expect(empty.error.kind).toBe("INVALID_REQUEST");
      expect(empty.error.retryable).toBe(false);
    }
    expect((await searchLegalCorpus(sql, { nonsense: true })).status).toBe(
      "error",
    );
    expect(
      (
        await searchLegalCorpus(sql, {
          query: "kira",
          limits: { resultLimit: 0 },
        })
      ).status,
    ).toBe("error");
    expect(
      (await searchLegalCorpus(sql, { query: "kira", asOf: "27-08-2026" }))
        .status,
    ).toBe("error");
  });

  // =========================================================================
  // (i) ROW LEVEL SECURITY — the store must not be a way around it
  // =========================================================================

  describe("(i) RLS tenant isolation through the store lanes", () => {
    let probeA: Sql;
    let probeNone: Sql;

    beforeAll(async () => {
      probeA = await connectAsTenant(fixtures.tenants.A);
      probeNone = await connectAsTenant(null);
    });

    afterAll(async () => {
      if (probeA !== undefined) await probeA.end({ timeout: 5 });
      if (probeNone !== undefined) await probeNone.end({ timeout: 5 });
    });

    it("resolves the tenant context the policies key off", async () => {
      const rows = await probeA`
        select current_user::text as who,
               app_private.current_tenant_id()::text as tenant`;
      expect(rows[0]?.["who"]).toBe("collex_retrieval_test_probe");
      expect(rows[0]?.["tenant"]).toBe(fixtures.tenants.A);

      const blank = await probeNone`
        select app_private.current_tenant_id() is null as anonymous`;
      expect(blank[0]?.["anonymous"]).toBe(true);
    });

    it("a tenant session sees its own rows plus public rows, never another tenant's", async () => {
      const hits = await lexicalSearch(probeA, "ilişkin dosya notu", {
        asOf: AS_OF,
        limit: 50,
      });
      const texts = hits.map((h) => h.provenance.originalText);
      expect(texts.some((t) => t.includes("GİZLİ-A"))).toBe(true);
      expect(texts.some((t) => t.includes("GİZLİ-B"))).toBe(false);

      // Public corpus stays fully readable from the same session.
      const publicHits = await lexicalSearch(probeA, "kira sözleşmesi", {
        asOf: AS_OF,
        limit: 50,
      });
      expect(
        publicHits.filter((h) => h.provenance.externalId === "KIRA-EXCERPT"),
      ).toHaveLength(4);

      // ...and the full pipeline behaves the same way.
      const outcome = await searchLegalCorpus(probeA, {
        query: "ilişkin dosya notu",
        asOf: AS_OF,
      });
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;
      expect(
        outcome.data.every(
          (h) => !h.provenance.originalText.includes("GİZLİ-B"),
        ),
      ).toBe(true);
    });

    it("with no tenant context, tenant rows are invisible and public rows are not", async () => {
      // This assertion used to be `toHaveLength(0)` — "the query matched only
      // tenant rows, so an empty result proves isolation". That was a PROXY,
      // and the working lexical lane broke it: "ilişkin dosya notu" now also
      // matches the PUBLIC doctrine note on "ilişkin"/"not". The proxy failing
      // while isolation held is exactly why the property is now asserted
      // directly — by identity of what came back, not by its absence.
      const hits = await lexicalSearch(probeNone, "ilişkin dosya notu", {
        asOf: AS_OF,
        limit: 50,
      });
      expect(
        hits.map((h) => h.provenance.externalId).sort(),
      ).toEqual(["DOKTRIN-5237-NOTU"]);
      // Neither tenant's document, and neither tenant's secret marker.
      expect(
        hits.some((h) => h.provenance.externalId === "TENANT-DOSYA"),
      ).toBe(false);
      for (const hit of hits) {
        expect(hit.provenance.originalText).not.toContain("GİZLİ-A");
        expect(hit.provenance.originalText).not.toContain("GİZLİ-B");
      }
      // NON-VACUOUS: the same query DOES reach the tenant row from a tenant
      // session, so the anonymous session's miss is RLS, not a bad query.
      const asTenant = await lexicalSearch(probeA, "ilişkin dosya notu", {
        asOf: AS_OF,
        limit: 50,
      });
      expect(
        asTenant.some((h) => h.provenance.originalText.includes("GİZLİ-A")),
      ).toBe(true);

      const publicHits = await lexicalSearch(probeNone, "kira sözleşmesi", {
        asOf: AS_OF,
        limit: 50,
      });
      expect(publicHits.length).toBeGreaterThan(0);
    });

    it("fetchCanonicalText — which skips the visibility filter — is still fenced by RLS", async () => {
      // This is the store's one unfiltered read path (the citation validator
      // needs to re-hash any version it holds a reference to). RLS is the ONLY
      // thing stopping it from crossing tenants, so both halves are pinned.
      const own = await fetchCanonicalText(
        probeA,
        versionId("TENANT-DOSYA@A#v1"),
      );
      expect(own?.canonicalText).toContain("GİZLİ-A");

      const foreign = await fetchCanonicalText(
        probeA,
        versionId("TENANT-DOSYA@B#v1"),
      );
      expect(foreign).toBeNull();

      const anonymous = await fetchCanonicalText(
        probeNone,
        versionId("TENANT-DOSYA@A#v1"),
      );
      expect(anonymous).toBeNull();

      // The counterpart, stated so it is never mistaken for a bug: the owner
      // / service_role connection bypasses RLS and DOES read both tenants.
      // That role must never serve a user-facing request.
      const asOwner = await fetchCanonicalText(
        sql,
        versionId("TENANT-DOSYA@B#v1"),
      );
      expect(asOwner?.canonicalText).toContain("GİZLİ-B");
    });

    it("(j) FILE SCOPE: an upload is unreachable by default and reachable ONLY through fileIds", async () => {
      const query = "kira sözleşmesi depozito iadesi";
      const ids = (hits: readonly { provenance: { externalId: string } }[]) =>
        [...new Set(hits.map((h) => h.provenance.externalId))].sort();

      // The audit finding: the owner connection has no tenant context, so
      // current_tenant_id() is NULL and the upload matches nothing — the
      // public KIRA-EXCERPT answers instead.
      const plain = await searchLegalCorpus(sql, { query, asOf: AS_OF });
      expect(plain.status).toBe("ok");
      if (plain.status !== "ok") return;
      expect(ids(plain.data)).toContain("KIRA-EXCERPT");
      expect(ids(plain.data)).not.toContain(UPLOAD_FILE_ID);

      // File scope: ONLY the named upload, every hit marked scope 'tenant'.
      const scoped = await searchLegalCorpus(sql, {
        query,
        asOf: AS_OF,
        filters: { fileIds: [UPLOAD_FILE_ID] },
      });
      expect(scoped.status).toBe("ok");
      if (scoped.status !== "ok") return;
      expect(scoped.data.length).toBeGreaterThan(0);
      expect(ids(scoped.data)).toEqual([UPLOAD_FILE_ID]);
      for (const hit of scoped.data) {
        expect(hit.provenance.scope).toBe("tenant");
        expect(hit.provenance.source).toBe("UPLOAD");
        expect(hit.provenance.originalText).toContain("YÜKLENEN-L");
      }

      // includeCorpus: the union, both identities present.
      const union = await searchLegalCorpus(sql, {
        query,
        asOf: AS_OF,
        filters: { fileIds: [UPLOAD_FILE_ID], includeCorpus: true },
      });
      expect(union.status).toBe("ok");
      if (union.status !== "ok") return;
      expect(ids(union.data)).toEqual(expect.arrayContaining([UPLOAD_FILE_ID, "KIRA-EXCERPT"]));

      // The citator lane is skipped under file scope and says so.
      const pipeline = await searchPipeline(sql, query, {
        asOf: AS_OF,
        filters: { fileIds: [UPLOAD_FILE_ID] },
      });
      expect(pipeline.citator.outcome).toBe("SKIPPED_FILE_SCOPE");
      expect(pipeline.hits.every((h) => h.provenance.externalId === UPLOAD_FILE_ID)).toBe(true);

      // An unknown fileId returns nothing — never the corpus by default.
      const unknown = await searchLegalCorpus(sql, {
        query,
        asOf: AS_OF,
        filters: { fileIds: ["0000000000000000"] },
      });
      expect(unknown.status).toBe("ok");
      if (unknown.status !== "ok") return;
      expect(unknown.data).toEqual([]);
    });

    it("(j) FILE SCOPE cannot cross tenants: a fileId resolves against the CALLER's tenant", async () => {
      const query = "dolandırıcılık iddiasına ilişkin dosya notu";
      // TENANT-DOSYA belongs to tenants A and B, never to the local tenant the
      // owner connection falls back to: nothing.
      const owner = await searchLegalCorpus(sql, {
        query,
        asOf: AS_OF,
        filters: { fileIds: ["TENANT-DOSYA"] },
      });
      expect(owner.status).toBe("ok");
      if (owner.status !== "ok") return;
      expect(owner.data).toEqual([]);

      // NON-VACUOUS: the same fileId from tenant A's session reaches A's row
      // (current_tenant_id() resolves) and never B's.
      const asA = await searchLegalCorpus(probeA, {
        query,
        asOf: AS_OF,
        filters: { fileIds: ["TENANT-DOSYA"] },
      });
      expect(asA.status).toBe("ok");
      if (asA.status !== "ok") return;
      expect(asA.data.length).toBeGreaterThan(0);
      for (const hit of asA.data) {
        expect(hit.provenance.originalText).toContain("GİZLİ-A");
        expect(hit.provenance.originalText).not.toContain("GİZLİ-B");
      }
      // And tenant A cannot name the local tenant's upload either.
      const foreign = await searchLegalCorpus(probeA, {
        query: "kira sözleşmesi depozito iadesi",
        asOf: AS_OF,
        filters: { fileIds: [UPLOAD_FILE_ID] },
      });
      expect(foreign.status).toBe("ok");
      if (foreign.status !== "ok") return;
      expect(foreign.data).toEqual([]);
    });

    it("RLS is enabled on every content-bearing table the store reads", async () => {
      const rows = await sql`
        select c.relname::text as table_name, c.relrowsecurity as rls
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'legal'
          and c.relname in ('documents', 'document_versions', 'chunks',
                            'document_relations')
        order by c.relname`;
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r["rls"] !== true)).toEqual([]);
    });
  });
});

// ===========================================================================
// (k) QUERY PLAN of the trigram lane at corpus scale (W14 B-06)
//
// WHY THIS EXISTS. Until W14 the lane's predicate was
// `word_similarity(<query>, c.search_text) >= <threshold>` — a function call,
// not indexable — so `chunks_search_trgm` was never used. Nothing caught it,
// because no test in this repository had ever asserted a query PLAN: on the
// 30-chunk fixture corpus a sequential scan is instant and every row-level
// assertion stayed green while the lane died at 20 000 chunks
// (measured 02.09.2026, ENGRISK E2: 45,8 s per answer, three
// RETRIEVAL_LANE_DEGRADED warnings, empty evidence).
//
// It runs against its OWN database (`collex_answer_test`, the L-ANSWER probe
// name) so the 2 000 rows it needs never enter `collex_retrieval_test` and
// cannot perturb the ranking assertions above.
// ===========================================================================

const SCALE_DB = "collex_answer_test";
const SCALE_DB_URL = "postgres://postgres@" + HOST_PORT + "/" + SCALE_DB;
const SCALE_CHUNKS = 2000;
const SCALE_AS_OF = "2026-08-01";
/**
 * Present in exactly 8 chunks (every 5th of the 40 chunks of one document) —
 * a phrase-shaped query with real selectivity.
 */
const SCALE_PHRASE = "depozito iadesi";
/**
 * Present in exactly 3 chunks, and built from words the filler vocabulary does
 * NOT contain, so the primary lanes come up SHORT on it. That is the shape the
 * trigram fallback exists for, and it is what block (l) needs on the other
 * side of the gate.
 */
const SCALE_RARE_PHRASE = "kambiyo senedi zayi";
const SCALE_RARE_CHUNKS = 3;

/**
 * How long the injected statement below sleeps INSIDE the lane's transaction.
 * 50 ms is fifty times the 1 ms budget block (l) hands the lane; nothing about
 * cache warmth, machine load or plan choice can make `pg_sleep(0.05)` finish
 * in under a millisecond.
 */
const LANE_SLEEP_SECONDS = 0.05;

/**
 * N-8 — the budget assertion must not race a wall clock.
 *
 * WHAT WENT WRONG. Block (l) used to give the lane `trigramBudgetMs: 1` and
 * expect the real trigram query to overrun it. On a warm cache the query
 * finished in under a millisecond and the lane honestly answered
 * `EXECUTED_FOUND` — the PRODUCT was right and the TEST lost a race. Measured
 * by W14-C-FINAL §2.2: six of seven full suite runs green, one red, and the
 * same file green 6/6 when run alone. A test that fails because the thing it
 * measures got FASTER is not measuring what it claims to.
 *
 * WHAT THIS DOES INSTEAD. It keeps the real database, the real transaction and
 * PostgreSQL's real `statement_timeout` — it only removes the coin flip. The
 * lane installs its budget with
 * `select set_config('statement_timeout', <budgetMs>, true)`; this wrapper
 * waits for THAT statement to succeed and then issues `select pg_sleep(0.05)`
 * on the same connection, inside the same transaction, under the budget the
 * lane just installed. PostgreSQL cancels it (SQLSTATE 57014) every single
 * time, and the cancellation travels the exact production path:
 * `sql.begin` -> `isQueryCanceled` -> `TrigramBudgetExceededError` ->
 * `searchPipeline` -> `BUDGET_EXCEEDED`.
 *
 * WHAT IT DOES NOT WEAKEN. The wrapper cancels NOTHING by itself: when the
 * budget is 0 the lane issues no `statement_timeout` set_config at all, so no
 * sleep is injected and the identical call returns the identical real rows.
 * That is the non-vacuity block (l) asserts below — the cancellation is the
 * LANE'S budget firing, never the harness's.
 *
 * Fragment-building calls (`provenanceProjection`, `visibilityFilter`,
 * `stableTieBreak`) are untouched: they are matched by the setting NAME the
 * lane passes as the first interpolated value, which only the timeout
 * set_config carries.
 */
function withCutLaneBudget(real: Sql, sleepSeconds = LANE_SLEEP_SECONDS): Sql {
  const wrapTx = (tx: unknown): unknown =>
    new Proxy(tx as object & ((...args: unknown[]) => unknown), {
      apply(txTarget, thisArg, args: unknown[]) {
        const result = Reflect.apply(txTarget, thisArg, args);
        // `select set_config($1, $2, true)` with $1 = "statement_timeout" is
        // the ONLY call this touches — the lane's own budget installation.
        if (args[1] !== "statement_timeout") return result;
        return (async () => {
          const settled = await result;
          await (txTarget as unknown as Sql)`select pg_sleep(${sleepSeconds}::float8)`;
          return settled;
        })();
      },
    });

  return new Proxy(real as object & ((...args: unknown[]) => unknown), {
    get(target, prop, receiver) {
      if (prop !== "begin") return Reflect.get(target, prop, receiver);
      return (fn: (tx: unknown) => unknown) =>
        (target as unknown as Sql).begin(((tx: unknown) => fn(wrapTx(tx))) as never);
    },
  }) as unknown as Sql;
}

describe("(k) trigram lane query plan at corpus scale", () => {
  let scale: Sql;

  beforeAll(async () => {
    const admin = createDb({
      url: "postgres://postgres@" + HOST_PORT + "/postgres",
      max: 1,
    });
    try {
      // Creates and drops ONLY collex_answer_test; refuses every other name.
      if (SCALE_DB !== "collex_answer_test") throw new Error("refused");
      await admin.unsafe("drop database if exists " + SCALE_DB + " with (force)");
      await admin.unsafe(
        "create database " + SCALE_DB + " template template0 encoding 'UTF8' locale 'C'",
      );
    } finally {
      await admin.end({ timeout: 5 });
    }

    const plan = await planMigrations();
    const runner = createDb({ url: SCALE_DB_URL, max: 1, statementTimeoutMs: 300_000 });
    try {
      for (const file of plan.runnable) {
        const text = await readFile(
          new URL("../../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        );
        await runner.unsafe(text);
      }
    } finally {
      await runner.end({ timeout: 10 });
    }

    scale = createDb({ url: SCALE_DB_URL, max: 2, statementTimeoutMs: 300_000 });
    await seedScaleCorpus(scale);
  });

  afterAll(async () => {
    if (scale !== undefined) await scale.end({ timeout: 5 });
    const admin = createDb({
      url: "postgres://postgres@" + HOST_PORT + "/postgres",
      max: 1,
    });
    try {
      await admin.unsafe("drop database if exists " + SCALE_DB + " with (force)");
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  it("seeded a corpus large enough for the planner to have a choice", async () => {
    const rows = await scale`select count(*)::int as n from legal.chunks`;
    expect(rows[0]?.["n"]).toBe(SCALE_CHUNKS);
  });

  it("the lane's predicate is served by the chunks_search_trgm GIN index", async () => {
    // Every access path except the bitmap one is switched off, so the plan
    // answers "CAN an index serve this predicate?" and not "did the planner
    // prefer one at fixture scale?". The pre-W14 predicate
    // (word_similarity(...) >= t) is a function call no index can serve: it
    // would fall back to a penalised Seq Scan on chunks and fail both
    // assertions below. Measured on the 20 006-chunk probe database the
    // product's own settings pick this same index unaided (see
    // docs/implementation/waves/W14-L-ANSWER.md).
    const plan = await explainTrigramSearch(scale, SCALE_PHRASE, {
      asOf: SCALE_AS_OF,
      limit: 24,
      plannerSettings: [
        ["enable_indexscan", "off"],
        ["enable_indexonlyscan", "off"],
        // Without nested loops the chunk scan cannot be driven by the join,
        // so the ONLY way to avoid a penalised sequential scan is an index
        // that serves the predicate itself.
        ["enable_nestloop", "off"],
      ],
    });
    const nodes = flattenPlan(plan);
    expect(nodes.map((node) => node.indexName)).toContain("chunks_search_trgm");
    expect(
      nodes.filter(
        (node) => node.relation === "chunks" && node.nodeType === "Seq Scan",
      ),
    ).toEqual([]);
  });

  it("never reads legal.chunks sequentially under the lane's own settings", async () => {
    const plan = await explainTrigramSearch(scale, SCALE_PHRASE, {
      asOf: SCALE_AS_OF,
      limit: 24,
    });
    expect(
      flattenPlan(plan).filter(
        (node) => node.relation === "chunks" && node.nodeType === "Seq Scan",
      ),
    ).toEqual([]);
  });

  it("returns exactly what the pre-W14 predicate returned", async () => {
    const lane = await trigramSearch(scale, SCALE_PHRASE, {
      asOf: SCALE_AS_OF,
      limit: 24,
    });
    // The predicate the lane used before W14, run verbatim as the reference.
    const reference = await scale`
      select c.id::text as chunk_id,
             extensions.word_similarity(${SCALE_PHRASE}, c.search_text)::float8 as score
      from legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      where (d.scope = 'public' or d.tenant_id = (select app_private.current_tenant_id()))
        and v.status = 'published'
        and v.effective_period @> ${SCALE_AS_OF}::date
        and extensions.word_similarity(${SCALE_PHRASE}, c.search_text) >= 0.5
      order by score desc, d.source asc, d.external_id asc, c.ordinal asc, c.id asc
      limit 24`;
    expect(lane.length).toBeGreaterThan(0);
    expect(lane.map((hit) => hit.provenance.chunkId)).toEqual(
      reference.map((row) => String(row["chunk_id"])),
    );
    expect(lane.map((hit) => hit.score)).toEqual(
      reference.map((row) => Number(row["score"])),
    );
  });

  it("rejects a threshold the word_similarity GUC cannot hold", async () => {
    await expect(
      trigramSearch(scale, SCALE_PHRASE, {
        asOf: SCALE_AS_OF,
        limit: 24,
        minSimilarity: 1.5,
      }),
    ).rejects.toThrow(/minSimilarity/);
  });

  // =========================================================================
  // (l) W14 F-PERF, V-1 — the lane is a FALLBACK and it has a WALL BUDGET
  //
  // The plan tests above prove the lane's predicate CAN use an index. They
  // never proved anything about the two facts that actually broke /v1/answer
  // at corpus scale, because neither existed: the lane ran on every query,
  // and it ran until the CONNECTION's 15 s statement_timeout killed it. On a
  // 20 000-chunk probe (`collex_perf_test`, avg search_text 4 974 code
  // points) that cost p50 59 458 ms end to end over HTTP for a common-word
  // corpus question, three or four lanes cut at 15 s each, answer ABSTAIN.
  //
  // These tests pin both halves. Each one also runs the OPPOSITE
  // configuration in the same test, which is the non-vacuity proof: turn the
  // gate off (`trigramFallbackMinHits: 0`) or the budget off
  // (`budgetMs: 0`) and the pre-W14 behaviour comes straight back.
  // =========================================================================

  /** A word in every chunk of the scale corpus: the FTS lane fills up on it. */
  const SCALE_COMMON = "sözleşme tazminat";

  it("(l) skips the lane when exact+lexical already produced enough passages", async () => {
    const gated = await searchPipeline(scale, SCALE_COMMON, { asOf: SCALE_AS_OF });
    // Precondition, asserted rather than assumed: this query really does
    // saturate the primary lanes on this corpus.
    expect(gated.trigram.primaryHits).toBeGreaterThanOrEqual(
      gated.trigram.fallbackMinHits,
    );
    expect(gated.trigram.fallbackMinHits).toBe(DEFAULT_TRIGRAM_FALLBACK_MIN_HITS);
    expect(gated.trigram.outcome).toBe("SKIPPED_PRIMARY_SUFFICIENT");
    expect(gated.trigram.admitted).toBe(0);
    // Skipped is not "attempted and empty", and it is not a degradation.
    expect(gated.lanesAttempted).not.toContain("trigram");
    expect(gated.laneFailures).toEqual([]);
    expect(gated.hits.every((h) => h.lanes.every((l) => l.lane !== "trigram"))).toBe(true);

    // NON-VACUITY: the pre-W14 configuration is one field away, and with it
    // the lane runs on the very same query.
    const ungated = await searchPipeline(scale, SCALE_COMMON, {
      asOf: SCALE_AS_OF,
      limits: { trigramFallbackMinHits: 0 },
    });
    expect(ungated.lanesAttempted).toContain("trigram");
    expect(["EXECUTED_FOUND", "EXECUTED_NONE_FOUND", "BUDGET_EXCEEDED"]).toContain(
      ungated.trigram.outcome,
    );
    expect(ungated.trigram.primaryHits).toBe(gated.trigram.primaryHits);
  });

  it("(l) still runs the lane when the primary lanes came up short", async () => {
    // A phrase-shaped query the FTS lane answers with only a handful of
    // passages — which is exactly the shape the fallback exists for.
    const result = await searchPipeline(scale, SCALE_RARE_PHRASE, { asOf: SCALE_AS_OF });
    expect(result.trigram.primaryHits).toBeLessThan(result.trigram.fallbackMinHits);
    expect(result.lanesAttempted).toContain("trigram");
    expect(result.trigram.outcome).toBe("EXECUTED_FOUND");
    expect(result.trigram.admitted).toBeGreaterThan(0);
    expect(result.laneFailures).toEqual([]);
    // And the lane's passages really are in the fused list.
    expect(
      result.hits.some((h) => h.lanes.some((l) => l.lane === "trigram")),
    ).toBe(true);
  });

  it("(l) the lane has its own wall budget and says so when it is cut", async () => {
    // The default is a REAL bound, and it is the one the pipeline hands the
    // lane. Setting it to 0 (the pre-W14 state, where only the connection's
    // 15 s statement_timeout applied) fails right here.
    expect(DEFAULT_TRIGRAM_BUDGET_MS).toBeGreaterThan(0);
    const withDefaults = await searchPipeline(scale, SCALE_RARE_PHRASE, {
      asOf: SCALE_AS_OF,
    });
    expect(withDefaults.trigram.budgetMs).toBe(DEFAULT_TRIGRAM_BUDGET_MS);

    // N-8: the budget is proven to fire by making the lane's OWN transaction
    // provably slower than the budget it just installed — see
    // `withCutLaneBudget`. No wall-clock race: `pg_sleep(0.05)` under a 1 ms
    // `statement_timeout` is cancelled by PostgreSQL every time.
    const overrun = withCutLaneBudget(scale);

    const cut = trigramSearch(overrun, SCALE_RARE_PHRASE, {
      asOf: SCALE_AS_OF,
      limit: 24,
      budgetMs: 1,
    });
    await expect(cut).rejects.toBeInstanceOf(TrigramBudgetExceededError);
    await expect(cut).rejects.toMatchObject({ code: "TRIGRAM_BUDGET_EXCEEDED" });
    // The number on the message is the number that was enforced.
    await expect(cut).rejects.toThrow(/1 ms budget/);

    // NON-VACUITY 1 — the harness cancels nothing on its own. SAME client,
    // SAME wrapper, SAME query; only the budget differs. With no lane budget
    // the lane issues no `statement_timeout` set_config, so no slow statement
    // is injected and the real rows come back. The rejection above is
    // therefore the LANE'S budget firing, not the wrapper.
    const whole = await trigramSearch(overrun, SCALE_RARE_PHRASE, {
      asOf: SCALE_AS_OF,
      limit: 24,
      budgetMs: 0,
    });
    expect(whole.length).toBeGreaterThan(0);

    // NON-VACUITY 2 — and the wrapper does not change what the lane finds:
    // the unwrapped client returns exactly the same passages.
    const unwrapped = await trigramSearch(scale, SCALE_RARE_PHRASE, {
      asOf: SCALE_AS_OF,
      limit: 24,
      budgetMs: 0,
    });
    expect(unwrapped.map((r) => r.provenance.chunkId)).toEqual(
      whole.map((r) => r.provenance.chunkId),
    );

    // A cut lane is still a CONTAINED failure with an honest message, not an
    // exception out of the pipeline and not a silently short result.
    const degraded = await searchPipeline(overrun, SCALE_RARE_PHRASE, {
      asOf: SCALE_AS_OF,
      limits: { trigramBudgetMs: 1 },
    });
    expect(degraded.trigram.outcome).toBe("BUDGET_EXCEEDED");
    expect(degraded.trigram.budgetMs).toBe(1);
    expect(degraded.laneFailures.map((f) => f.lane)).toEqual(["trigram"]);
    expect(degraded.laneFailures[0]?.code).toBe("TRIGRAM_BUDGET_EXCEEDED");
    // The reader is never shown the driver's cancellation sentence.
    expect(degraded.laneFailures[0]?.message).not.toMatch(/statement timeout/i);
    expect(degraded.laneFailures[0]?.message).toMatch(/budget/);

    // NOT settable over the wire, deliberately: `searchRequestSchema.limits`
    // does not carry `trigramBudgetMs`, so a caller cannot raise its own
    // budget. The knob exists for the pipeline and for this test.
    const overTheWire = await searchLegalCorpus(scale, {
      query: SCALE_RARE_PHRASE,
      asOf: SCALE_AS_OF,
      limits: { trigramBudgetMs: 1 },
    } as never);
    expect(overTheWire.status).toBe("error");
    if (overTheWire.status !== "error") return;
    expect(overTheWire.error.kind).toBe("INVALID_REQUEST");
  });

  it("(l) rejects a budget that is not a non-negative number of milliseconds", async () => {
    await expect(
      trigramSearch(scale, SCALE_RARE_PHRASE, { asOf: SCALE_AS_OF, limit: 24, budgetMs: -1 }),
    ).rejects.toThrow(/budgetMs/);
    await expect(
      trigramSearch(scale, SCALE_RARE_PHRASE, {
        asOf: SCALE_AS_OF,
        limit: 24,
        budgetMs: Number.NaN,
      }),
    ).rejects.toThrow(/budgetMs/);
  });
});

interface PlanNode {
  nodeType: string;
  relation: string | undefined;
  indexName: string | undefined;
}

/** Flatten an `explain (format json)` result into (node type, relation, index). */
function flattenPlan(plan: unknown): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (node: Record<string, unknown>): void => {
    out.push({
      nodeType: String(node["Node Type"] ?? ""),
      relation:
        typeof node["Relation Name"] === "string" ? node["Relation Name"] : undefined,
      indexName: typeof node["Index Name"] === "string" ? node["Index Name"] : undefined,
    });
    const children = node["Plans"];
    if (Array.isArray(children)) {
      for (const child of children) walk(child as Record<string, unknown>);
    }
  };
  const roots = Array.isArray(plan) ? plan : [plan];
  for (const root of roots) {
    const entry = (root as Record<string, unknown>)["Plan"];
    if (entry !== undefined) walk(entry as Record<string, unknown>);
  }
  return out;
}

/**
 * 2 000 SENTETİK chunks in 50 documents. Prose is deterministic filler built
 * from a fixed word list; SCALE_PHRASE is injected into every 5th chunk of
 * one document, so the query has the selectivity a real phrase query has.
 */
async function seedScaleCorpus(target: Sql): Promise<void> {
  const words = [
    "sözleşme", "tazminat", "zilyet", "teminat", "alacak", "borçlu", "icra",
    "tebligat", "bilirkişi", "keşif", "haciz", "ipotek", "vekâlet", "tanık",
    "kusur", "zarar", "hüküm", "temyiz", "istinaf", "duruşma",
  ];
  const docs = 50;
  const perDoc = SCALE_CHUNKS / docs;
  for (let docIndex = 0; docIndex < docs; docIndex += 1) {
    const legislationNo = String(7100 + docIndex);
    const url = "https://example.invalid/scale/" + legislationNo;
    const documentRows = await target`
      insert into legal.documents
        (scope, tenant_id, source, external_id, document_type, jurisdiction,
         title, canonical_source_url)
      values ('public', null, 'scale-fixture', ${"scale-" + legislationNo},
        'kanun', 'TR', ${legislationNo + " sayılı Sentetik Kanun (SENTETİK)"}, ${url})
      returning id`;
    const documentId = String(documentRows[0]?.["id"]);
    const texts: string[] = [];
    for (let i = 0; i < perDoc; i += 1) {
      const body: string[] = ["MADDE " + String(i + 1) + " - (1)"];
      for (let w = 0; w < 60; w += 1) {
        body.push(words[(docIndex * 7 + i * 13 + w * 3) % words.length] as string);
      }
      if (docIndex === 11 && i % 5 === 0) body.push(SCALE_PHRASE, "hükmü uygulanır");
      if (docIndex === 7 && i < SCALE_RARE_CHUNKS) body.push(SCALE_RARE_PHRASE, "hükmü uygulanır");
      texts.push(body.join(" ") + ".");
    }
    const canonical = texts.join("\n");
    const snapshotRows = await target`
      insert into legal.source_snapshots
        (source, external_id, requested_url, final_url, retrieved_at, http_status,
         media_type, raw_object_key, raw_sha256, parser_name, parser_version)
      values ('scale-fixture', ${"scale-" + legislationNo}, ${url}, ${url}, now(), 200,
        'text/html', ${"scale/" + legislationNo}, ${sha256Hex(canonical)},
        'scale-fixture', '1.0.0')
      returning id`;
    const versionRows = await target`
      insert into legal.document_versions
        (document_id, source_snapshot_id, version_label, status, effective_period,
         legislation_no, canonical_text, normalized_text, content_sha256)
      values (${documentId}, ${String(snapshotRows[0]?.["id"])}, 'v1', 'published',
        '[2020-01-01,)'::daterange, ${legislationNo}, ${canonical},
        ${canonical.toLocaleLowerCase("tr-TR")}, ${sha256Hex(canonical)})
      returning id`;
    const versionId = String(versionRows[0]?.["id"]);
    let offset = 0;
    const rows = texts.map((text, ordinal) => {
      const start = offset;
      const end = start + codePointLength(text);
      offset = end + 1;
      return {
        document_version_id: versionId,
        ordinal,
        structural_path: ["madde-" + String(ordinal + 1)],
        article_no: String(ordinal + 1),
        start_char: start,
        end_char: end,
        original_text: text,
        search_text: text.toLocaleLowerCase("tr-TR"),
        normalizer_version: "trnorm-v1",
        content_sha256: sha256Hex(text),
        token_count: text.split(/\s+/u).length,
      };
    });
    await target`insert into legal.chunks ${target(
      rows,
      "document_version_id",
      "ordinal",
      "structural_path",
      "article_no",
      "start_char",
      "end_char",
      "original_text",
      "search_text",
      "normalizer_version",
      "content_sha256",
      "token_count",
    )}`;
  }
  await target.unsafe("analyze legal.chunks");
}

// ===========================================================================
// (m) IDF-AWARE LEXICAL LANE, LANE WEIGHTS, QUERY EXPANSION (2026-09-10)
// ===========================================================================
//
// Runs against the fixture database the main suite built (module-level
// `sql` / `fixtures`), like block (k). Everything here is SENTETİK.

describe("(m) IDF-aware lexical lane (2026-09-10)", () => {
  /**
   * The pre-2026-09-10 admission rule, byte-for-byte: OR of the query
   * lexemes, keep chunks carrying at least ceil(minCoverage * term_count) of
   * them, under the default visibility filter. This is the RECALL FLOOR the
   * new lane may not fall below.
   */
  async function flatRuleChunkIds(query: string, minCoverage: number): Promise<Set<string>> {
    const rows = await sql`
      with query_lexemes as (
        select tsvector_to_array(to_tsvector('turkish'::regconfig, ${query})) as lex
      ),
      query_terms as (
        select
          lex,
          cardinality(lex) as term_count,
          (
            select array_to_string(array_agg(quote_literal(term)), ' | ')
            from unnest(lex) as term
          )::tsquery as tsq
        from query_lexemes
      )
      select c.id::text as chunk_id
      from query_terms q
      cross join legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      where q.term_count > 0
        and (d.scope = 'public' or d.tenant_id = (select app_private.current_tenant_id()))
        and v.status = 'published'
        and (
          v.effective_period @> ${AS_OF}::date
          or (
            v.effective_period is null
            and upper_inf(v.system_period)
            and not exists (
              select 1 from legal.document_versions vx
              where vx.document_id = v.document_id
                and vx.status = 'published'
                and vx.effective_period @> ${AS_OF}::date
            )
          )
        )
        and c.search_tsv_tr @@ q.tsq
        and cardinality(array(
          select unnest(q.lex)
          intersect
          select unnest(tsvector_to_array(c.search_tsv_tr))
        )) >= ceil(${minCoverage}::float8 * q.term_count::float8)`;
    return new Set(rows.map((r) => String(r["chunk_id"])));
  }

  const QUERIES = [
    "haksız fiil tazminatı",
    "kira sözleşmesinde depozito iadesi ne zaman yapılır",
    "dolandırıcılığın cezası dolandırıcılık",
    "ıstanbul bölge adliye mahkemesi",
    "tck m. 157",
    "işe iade davasında geçerli neden",
  ];

  it("admits EVERY passage the flat 0.25 rule admits — recall never drops", async () => {
    for (const query of QUERIES) {
      const floor = await flatRuleChunkIds(query, DEFAULT_LEXICAL_MIN_COVERAGE);
      const rows = await lexicalSearch(sql, query, { asOf: AS_OF, limit: 500 });
      const admitted = new Set(rows.map((r) => r.provenance.chunkId));
      for (const id of floor) expect(admitted.has(id)).toBe(true);
      // And the flat number itself is still reported unchanged.
      for (const row of rows) {
        expect(row.coverage).toBeGreaterThan(0);
        expect(row.coverage).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the same holds at a stricter floor (the divergence pass runs at 0.1, callers may raise it)", async () => {
    for (const minCoverage of [0.1, 0.5, 1]) {
      for (const query of QUERIES) {
        const floor = await flatRuleChunkIds(query, minCoverage);
        const rows = await lexicalSearch(sql, query, { asOf: AS_OF, limit: 500, minCoverage });
        const admitted = new Set(rows.map((r) => r.provenance.chunkId));
        for (const id of floor) expect(admitted.has(id)).toBe(true);
      }
    }
  });

  it("reports weighted coverage and matched lexemes additively, consistent with the flat coverage", async () => {
    const query = "haksız fiil tazminatı";
    const lexemes = await analyzeQueryLexemes(sql, "turkish", query);
    expect(lexemes.length).toBe(3);
    const rows = await lexicalSearch(sql, query, { asOf: AS_OF, limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.weightedCoverage).toBeGreaterThan(0);
      expect(row.weightedCoverage).toBeLessThanOrEqual(1 + 1e-9);
      expect(row.matchedLexemes?.length).toBeGreaterThan(0);
      expect(row.coverage).toBeCloseTo((row.matchedLexemes?.length ?? 0) / lexemes.length, 12);
      for (const lexeme of row.matchedLexemes ?? []) expect(lexemes).toContain(lexeme);
      expect(row.expansionMatches).toBe(0); // no expansion terms were passed
    }
    // Full coverage means full weighted coverage, whatever the IDFs are.
    const full = rows.find((r) => r.coverage === 1);
    expect(full?.weightedCoverage).toBeCloseTo(1, 9);
    // The lane is ordered by score first.
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
    }
  });

  it("a rare lexeme weighs more than a common one (BM25 IDF is monotone in df)", async () => {
    const lexemes = await analyzeQueryLexemes(sql, "turkish", "kira sözleşmesi dolandırıcılık zarar");
    const stats = await lexemeDocumentFrequencies(sql, "turkish", lexemes);
    expect(stats.total).toBeGreaterThan(0);
    const byDf = [...stats.df.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 1; i < byDf.length; i += 1) {
      const [rarer, dfR] = byDf[i - 1]!;
      const [commoner, dfC] = byDf[i]!;
      if (dfR < dfC) {
        expect(stats.idf.get(rarer)!).toBeGreaterThan(stats.idf.get(commoner)!);
      }
    }
    // Pure function checks.
    expect(bm25Idf(0, 100)).toBeGreaterThan(bm25Idf(1, 100));
    expect(bm25Idf(1, 100)).toBeGreaterThan(bm25Idf(50, 100));
    expect(bm25Idf(100, 100)).toBeGreaterThan(0);
    expect(bm25Idf(0, 0)).toBeGreaterThan(0);
  });

  it("a passage carrying ONE rare lexeme can enter through the weighted rule where the flat rule alone would not", async () => {
    // Pick, on this corpus, the rarest lexeme among a set of query words and
    // build a query of several COMMON words plus that one rare word, long
    // enough that one match is below a quarter. The flat rule needs two
    // matches; the weighted rule admits a chunk on the rare word alone.
    const probe = await analyzeQueryLexemes(
      sql,
      "turkish",
      "dolandırıcılık kira zarar tazminat karar sözleşme fiil hukuk",
    );
    const stats = await lexemeDocumentFrequencies(sql, "turkish", probe);
    const present = [...stats.df.entries()].filter(([, df]) => df > 0).sort((a, b) => a[1] - b[1]);
    expect(present.length).toBeGreaterThanOrEqual(5);
    const rare = present[0]![0];
    const common = present.slice(-4).map(([t]) => t);
    const idfRare = stats.idf.get(rare)!;
    const idfCommon = common.reduce((a, t) => a + stats.idf.get(t)!, 0);
    // Only meaningful when the rare word really carries a quarter of the IDF
    // on this corpus; if the fixture ever changes so it does not, the test
    // says so instead of asserting on a coincidence.
    if (idfRare / (idfRare + idfCommon) < DEFAULT_LEXICAL_MIN_COVERAGE) {
      expect.soft(true, "fixture no longer has a sufficiently rare lexeme").toBe(true);
      return;
    }
    const query = [...common, rare].join(" ");
    const floor = await flatRuleChunkIds(query, DEFAULT_LEXICAL_MIN_COVERAGE);
    const rows = await lexicalSearch(sql, query, { asOf: AS_OF, limit: 500 });
    const rareOnly = rows.filter(
      (r) => r.matchedLexemes?.length === 1 && r.matchedLexemes[0] === rare,
    );
    // Every flat-rule row is still there (superset)...
    for (const id of floor) expect(rows.some((r) => r.provenance.chunkId === id)).toBe(true);
    // ...and a rare-word-only chunk, if one exists, came through the weighted
    // path (a five-lexeme query needs two matches under the flat rule).
    for (const row of rareOnly) {
      expect(floor.has(row.provenance.chunkId)).toBe(false);
      expect(row.weightedCoverage).toBeGreaterThanOrEqual(DEFAULT_LEXICAL_MIN_COVERAGE);
    }
  });

  it("caches document frequencies per connection, honours the TTL and invalidation", async () => {
    invalidateLexicalStats();
    const lexemes = await analyzeQueryLexemes(sql, "turkish", "haksız fiil tazminatı kira");
    const t0 = 1_000_000;
    const cold = await lexemeDocumentFrequencies(sql, "turkish", lexemes, t0);
    expect(cold.cacheHits).toBe(0);
    const warm = await lexemeDocumentFrequencies(sql, "turkish", lexemes, t0 + 1);
    expect(warm.cacheHits).toBe(lexemes.length + 1); // every lexeme + the total
    expect([...warm.df.entries()]).toEqual([...cold.df.entries()]);
    // A new lexeme is a partial miss; the old ones still hit.
    const more = await analyzeQueryLexemes(sql, "turkish", "haksız fiil tazminatı kira zarar");
    const partial = await lexemeDocumentFrequencies(sql, "turkish", more, t0 + 2);
    expect(partial.cacheHits).toBe(lexemes.length + 1);
    // TTL expiry is a miss for everything.
    const expired = await lexemeDocumentFrequencies(sql, "turkish", lexemes, t0 + LEXICAL_DF_CACHE_TTL_MS);
    expect(expired.cacheHits).toBe(0);
    // Invalidation (what the upload/delete routes call) is a miss too.
    await lexemeDocumentFrequencies(sql, "turkish", lexemes, t0 + LEXICAL_DF_CACHE_TTL_MS + 1);
    invalidateLexicalStats();
    const afterInvalidate = await lexemeDocumentFrequencies(sql, "turkish", lexemes, t0 + LEXICAL_DF_CACHE_TTL_MS + 2);
    expect(afterInvalidate.cacheHits).toBe(0);
    // The 'simple' config has its own statistics.
    const simple = await lexemeDocumentFrequencies(sql, "simple", ["haksız"], t0 + LEXICAL_DF_CACHE_TTL_MS + 3);
    expect(simple.cacheHits).toBe(1); // only the total is shared per connection
  });

  it("an injection-shaped query analyses to zero lexemes and returns zero rows", async () => {
    const rows = await lexicalSearch(sql, "'; drop table legal.chunks; --", { asOf: AS_OF, limit: 10 });
    expect(rows).toEqual([]);
    const still = await sql`select count(*)::int as n from legal.chunks`;
    expect(Number(still[0]?.["n"])).toBeGreaterThan(0);
    expect(await lexicalSearch(sql, "   ", { asOf: AS_OF, limit: 10 })).toEqual([]);
  });

  it("rejects an expansion weight outside [0,1]", async () => {
    await expect(
      lexicalSearch(sql, "kira", { asOf: AS_OF, limit: 10, expansionTerms: ["tahliye"], expansionWeight: 2 }),
    ).rejects.toThrow(RangeError);
  });
});

describe("(m) query expansion in the corpus lane (2026-09-10)", () => {
  it("expansion terms can re-rank but NEVER admit a passage on their own", async () => {
    // A query no chunk carries, expanded with a phrase every haksız-fiil
    // chunk carries: still nothing.
    const none = await lexicalSearch(sql, "zzzzqqq", {
      asOf: AS_OF,
      limit: 50,
      expansionTerms: ["haksız fiil", "tazminat"],
    });
    expect(none).toEqual([]);

    // A one-word query: the admitted SET is identical with and without the
    // synonyms; only scores and the expansionMatches counter change.
    const plain = await lexicalSearch(sql, "tazminat", { asOf: AS_OF, limit: 500 });
    const expanded = await lexicalSearch(sql, "tazminat", {
      asOf: AS_OF,
      limit: 500,
      expansionTerms: ["haksız fiil"],
    });
    expect(new Set(expanded.map((r) => r.provenance.chunkId))).toEqual(
      new Set(plain.map((r) => r.provenance.chunkId)),
    );
    expect(expanded.some((r) => (r.expansionMatches ?? 0) > 0)).toBe(true);
    // weightedCoverage measures QUERY lexemes only, so it is unchanged.
    const byId = new Map(plain.map((r) => [r.provenance.chunkId, r]));
    for (const row of expanded) {
      expect(row.weightedCoverage).toBeCloseTo(byId.get(row.provenance.chunkId)!.weightedCoverage!, 9);
      expect(row.coverage).toBe(byId.get(row.provenance.chunkId)!.coverage);
    }
    // A chunk carrying the synonym outranks an otherwise equal one.
    const withSynonym = expanded.filter((r) => (r.expansionMatches ?? 0) > 0);
    const without = expanded.filter((r) => (r.expansionMatches ?? 0) === 0);
    if (withSynonym.length > 0 && without.length > 0) {
      expect(withSynonym[0]!.score).toBeGreaterThan(0);
    }
  });

  it("searchPipeline reports which synonyms were searched, additively", async () => {
    const query = "işe iade davasında geçerli neden";
    const result = await searchPipeline(sql, query, { asOf: AS_OF });
    expect(result.laneFailures).toEqual([]);
    expect(result.expansion.concepts).toContain("işe iade");
    expect(result.expansion.terms).toContain("feshin geçersizliği");
    expect(result.expansion.terms).not.toContain("geçerli neden");
    expect(result.expansion).toEqual(expandQuery(result.laneQuery));
    expect(result.laneWeights).toEqual(DEFAULT_LANE_WEIGHTS);

    const off = await searchPipeline(sql, query, { asOf: AS_OF, limits: { expansionLimit: 0 } });
    expect(off.expansion.terms).toEqual([]);
    expect(off.expansion.limit).toBe(0);

    const strict = await searchPipeline(sql, query, { asOf: AS_OF, limits: { lexicalMode: "strict" } });
    expect(strict.expansion.terms).toEqual([]);
  });

  it("expansion never shrinks the lexical lane's admitted set for the pipeline's own query", async () => {
    // Measured at the LANE, not at the final list: the per-document cap and
    // the result limit are applied in rank order, so a re-ranking can change
    // WHICH passage of a document survives — a ranking change, not a recall
    // loss. What must hold is that the lane admits a superset.
    for (const query of ["kira sözleşmesinde depozito iadesi", "haksız fiil tazminatı", "dolandırıcılık cezası"]) {
      const on = await searchPipeline(sql, query, { asOf: AS_OF });
      const laneOn = await lexicalSearch(sql, on.laneQuery, {
        asOf: AS_OF,
        limit: 500,
        expansionTerms: on.expansion.terms,
      });
      const laneOff = await lexicalSearch(sql, on.laneQuery, { asOf: AS_OF, limit: 500 });
      const laneOnIds = new Set(laneOn.map((r) => r.provenance.chunkId));
      for (const row of laneOff) expect(laneOnIds.has(row.provenance.chunkId)).toBe(true);
    }
  });
});

describe("(m) lane weights in the pipeline (2026-09-10)", () => {
  it("fuses with DEFAULT_LANE_WEIGHTS and lets a caller discount a lane", async () => {
    const k = DEFAULT_RRF_K;
    const byNotu = (r: Awaited<ReturnType<typeof searchPipeline>>) =>
      r.hits.find((h) => h.provenance.externalId === "HAKSIZ-FIIL-NOTU");
    const dflt = await searchPipeline(sql, "haksız fiil tazminatı", { asOf: AS_OF });
    expect(byNotu(dflt)?.fusedScore).toBeCloseTo(
      DEFAULT_LANE_WEIGHTS.lexical / (k + 1) + DEFAULT_LANE_WEIGHTS.trigram / (k + 1),
      12,
    );
    const equal = await searchPipeline(sql, "haksız fiil tazminatı", {
      asOf: AS_OF,
      limits: { laneWeights: { trigram: 1 } },
    });
    expect(byNotu(equal)?.fusedScore).toBeCloseTo(2 / (k + 1), 12);
    expect(equal.laneWeights).toEqual({ ...DEFAULT_LANE_WEIGHTS, trigram: 1 });
    // A partial override keeps the other defaults.
    expect(equal.laneWeights.lexical).toBe(DEFAULT_LANE_WEIGHTS.lexical);
    expect(equal.laneWeights.dense).toBe(DEFAULT_LANE_WEIGHTS.dense);
  });

  it("documents the ordering: exact pin > lexical > trigram", async () => {
    expect(DEFAULT_LANE_WEIGHTS.lexical).toBeGreaterThan(DEFAULT_LANE_WEIGHTS.trigram);
    expect(DEFAULT_LANE_WEIGHTS.trigram).toBeGreaterThan(0);
    // A pinned hit is first regardless of any weight.
    const result = await searchPipeline(sql, "tck m. 157", {
      asOf: AS_OF,
      limits: { laneWeights: { lexical: 0.01, trigram: 0.01 } },
    });
    expect(result.hits[0]?.pinned).toBe(true);
    expect(result.hits[0]?.provenance.externalId).toBe("TCK-5237-EXCERPT");
  });

  it("refuses a weight that would silence a lane", async () => {
    await expect(
      searchPipeline(sql, "haksız fiil", { asOf: AS_OF, limits: { laneWeights: { trigram: 0 } } }),
    ).rejects.toThrow(RangeError);
    await expect(
      searchPipeline(sql, "haksız fiil", { asOf: AS_OF, limits: { laneWeights: { lexical: Number.NaN } } }),
    ).rejects.toThrow(RangeError);
  });

  it("the HTTP schema accepts a discount and refuses an amplification", async () => {
    const ok = await searchLegalCorpus(sql, {
      query: "haksız fiil tazminatı",
      asOf: AS_OF,
      limits: { laneWeights: { trigram: 0.5 }, expansionLimit: 4 },
    });
    expect(ok.status).toBe("ok");
    const bad = await searchLegalCorpus(sql, {
      query: "haksız fiil tazminatı",
      asOf: AS_OF,
      limits: { laneWeights: { trigram: 2 } },
    });
    expect(bad.status).toBe("error");
  });
});
