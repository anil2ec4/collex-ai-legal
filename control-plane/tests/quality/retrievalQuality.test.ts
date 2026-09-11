/**
 * Regression tests for the four retrieval-quality defects the fixture-corpus
 * eval measured on 2026-08-27:
 *
 *   Hits by lane:              exact=36, lexical=0, trigram=5, dense=0
 *   Contrary-authority recall: 0.0000  (n=3)
 *   Full-name-form accuracy:   71.4%   vs abbreviation form 100%
 *   Temporal accuracy:         66.7%
 *   Abstention precision:      57.1%
 *
 * Each `it` below pins ONE mechanism against a purpose-built synthetic corpus
 * (qualityCorpus.ts), not against the eval gold set: these must fail when the
 * mechanism regresses, and they must not be satisfiable by memorising an
 * answer. Where a test asserts an absence ("returns nothing", "does not
 * bridge"), it also asserts the corresponding presence, so no assertion can
 * pass because the corpus was empty or the query was malformed.
 *
 * Everything in the corpus is SENTETİK — see qualityCorpus.ts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LEXICAL_MIN_COVERAGE,
  lexicalSearch,
  listInForceVersions,
  type ScoredChunk,
} from "../../src/store/chunkStore.js";
import {
  CITATION_SCORE_FACTOR,
  canonicalizeReferences,
  outboundCitations,
  searchPipeline,
  type RankedHit,
} from "../../src/retrieval/hybrid.js";
import { searchLegalCorpus } from "../../src/retrieval/searchService.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";
import { normalizeTurkishSearch } from "../../src/retrieval/normalize.js";
import { classifyStance } from "../../src/pipeline/stance.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import { LONG_QUESTION_CODE_POINTS } from "../../src/pipeline/questionIntent.js";
import {
  createStoreRetrievalPort,
  createStoreTextPort,
  createStoreVersionFactsPort,
} from "../../src/pipeline/storeAdapters.js";
import type { Sql } from "../../src/store/db.js";
import {
  connectQualityDb,
  requireScratchPostgres,
  resetQualityDatabase,
} from "./qualityDb.js";
import {
  BEFORE_ANY_VERSION,
  DURING_V1,
  DURING_V2,
  insertQualityCorpus,
  TORBA_BEFORE_V2,
  V2_FROM,
  LONG_FORM_PAIRS,
  type InsertedQualityCorpus,
} from "./qualityCorpus.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 300_000 });

let sql: Sql;
let corpus: InsertedQualityCorpus;

beforeAll(async () => {
  await requireScratchPostgres();
  await resetQualityDatabase();
  sql = connectQualityDb();
  corpus = await insertQualityCorpus(sql);
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

/** Stable unit ids ("<externalId>#<version>:<slot>") for a ranked result. */
function units(hits: readonly RankedHit[]): string[] {
  return hits.map((hit) => corpus.unitOf.get(hit.chunkId) ?? hit.chunkId);
}

function lexicalUnits(rows: readonly ScoredChunk[]): string[] {
  return rows.map(
    (row) => corpus.unitOf.get(row.provenance.chunkId) ?? row.provenance.chunkId,
  );
}

describe("retrieval quality (integration, local scratch PostgreSQL)", () => {
  // =======================================================================
  // 1. THE LEXICAL LANE IS ALIVE
  // =======================================================================
  //
  // The measured defect was not a broken index, a missing column or a wrong
  // text-search configuration — all of those were healthy. It was the QUERY
  // OPERATOR: websearch_to_tsquery ANDs every token it is given, and a legal
  // question carries 7-20 of them, so no one- or two-sentence passage could
  // ever satisfy the conjunction. All 25 gold questions produced zero rows.

  it("a natural-language question retrieves passages (the AND-of-everything defect)", async () => {
    const question =
      "5237 sayılı Sentetik Ceza Kanunu m. 160 uyarınca dolandırıcılığın " +
      "cezası nedir?";
    const normalized = normalizeTurkishSearch(question);

    // The historical behaviour, kept reachable as `mode: "strict"`: every
    // lexeme required, therefore nothing matches.
    const strict = await lexicalSearch(sql, normalized, {
      asOf: DURING_V2,
      limit: 50,
      mode: "strict",
    });
    expect(strict).toHaveLength(0);

    // The same question through the coverage lane finds the provision.
    const coverage = await lexicalSearch(sql, normalized, {
      asOf: DURING_V2,
      limit: 50,
    });
    expect(coverage.length).toBeGreaterThan(0);
    expect(lexicalUnits(coverage)).toContain("SENTETIK-CEZA-KANUNU#v2:160");

    // ...and it is a genuine partial match, not an accidental full one: the
    // question carries far more lexemes than any single passage does.
    const article = coverage.find(
      (row) => corpus.unitOf.get(row.provenance.chunkId) ===
        "SENTETIK-CEZA-KANUNU#v2:160",
    );
    expect(article?.coverage ?? 0).toBeGreaterThanOrEqual(
      DEFAULT_LEXICAL_MIN_COVERAGE,
    );
    expect(article?.coverage ?? 1).toBeLessThan(1);
  });

  it("matches an inflected query form through the Turkish stemmer", async () => {
    // "dolandırıcılığın" (genitive) never appears in the corpus; only the
    // stemmer collapses it onto the bare "dolandırıcılık" the text uses. This
    // is the property migration 20260826110000 exists for.
    const rows = await lexicalSearch(sql, "dolandırıcılığın cezası", {
      asOf: DURING_V2,
      limit: 50,
      minCoverage: 1,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.provenance.originalText).not.toContain("dolandırıcılığın");
    }
    expect(lexicalUnits(rows)).toContain("SENTETIK-CEZA-KANUNU#v2:160");

    // Control: the 'simple' configuration indexes surface forms, so the same
    // inflected query finds nothing. Without this the test above could pass on
    // a literal match rather than on stemming.
    const simple = await lexicalSearch(sql, "dolandırıcılığın cezası", {
      asOf: DURING_V2,
      limit: 50,
      config: "simple",
      minCoverage: 1,
    });
    expect(simple).toHaveLength(0);
  });

  it("still returns nothing for a question the corpus cannot answer", async () => {
    // The coverage floor is what keeps "retrieval found nothing" meaningful.
    // If it ever drops low enough to admit incidental word overlap, the
    // system stops being able to abstain — the failure mode that showed up as
    // abstention precision 57.1% in the other direction.
    const outcome = await searchPipeline(
      sql,
      "kadastro parselinin ifraz ve tevhit şerhi nasıl terkin edilir?",
      { asOf: DURING_V2 },
    );
    expect(outcome.laneFailures).toEqual([]);
    expect(outcome.hits).toEqual([]);
    expect(outcome.divergence.outcome).toBe("SKIPPED_NO_PRIMARY_HITS");

    // Non-vacuous: the corpus DOES contain a land-registry passage, and a
    // question actually about it is answered. The abstention above is about
    // this question, not about an empty corpus.
    const answerable = await searchPipeline(
      sql,
      "tapu sicilindeki tescilin taşınmaz mülkiyetinin devrindeki etkisi nedir?",
      { asOf: DURING_V2 },
    );
    expect(units(answerable.hits)).toContain("SENTETIK-TAPU-NOTU#v1:metin");
  });

  // =======================================================================
  // 2. CONTRARY AUTHORITY IS RETRIEVED **AND** CLASSIFIED OPPOSING
  // =======================================================================

  it("surfaces the decision that went the other way, and says why", async () => {
    // Phrased the way the AFFIRMATIVE decision reads, so similarity ranking
    // alone would return only that side.
    const result = await searchPipeline(
      sql,
      "Ödeme kabiliyeti olmadan peşin tahsilat yapan kişinin eylemi " +
        "dolandırıcılık suçunu oluşturur mu?",
      { asOf: DURING_V2 },
    );
    expect(result.laneFailures).toEqual([]);
    expect(result.questionIntent).toBe("APPLICATION");
    expect(result.divergence.outcome).toBe("EXECUTED_FOUND");

    const retrieved = units(result.hits);
    expect(retrieved).toContain("SENTETIK-KARAR-ONAMA#v1:gerekce");
    // The opposing decision is present at all — this is the number that was
    // 0.0000.
    expect(retrieved).toContain("SENTETIK-KARAR-BOZMA#v1:gerekce");

    // ...and it is present BECAUSE it was classified as opposing, not by
    // lexical luck: the hit carries the stance verdict and the markers.
    const opposing = result.hits.find(
      (hit) =>
        corpus.unitOf.get(hit.chunkId) === "SENTETIK-KARAR-BOZMA#v1:gerekce",
    );
    expect(opposing?.contrary).toBeDefined();
    expect(opposing?.contrary?.polarity).toBe("NEGATIVE");
    expect(opposing?.contrary?.opposesPolarity).toBe("AFFIRMATIVE");
    expect(opposing?.contrary?.markers.length ?? 0).toBeGreaterThan(0);
    // The passage it contradicts is one that was actually retrieved.
    expect(
      result.hits.some(
        (hit) => hit.chunkId === opposing?.contrary?.opposesChunkId,
      ),
    ).toBe(true);
  });

  it("completes the split from either side (the pass is symmetric)", async () => {
    // Same issue, phrased the way the NEGATIVE decision reads. A pass that
    // hunted for "the opposite of the top hit" would be sensitive to which of
    // two disagreeing decisions happened to rank first; this one is not.
    const result = await searchPipeline(
      sql,
      "Edimin sonradan yerine getirilmemesi hâlinde uyuşmazlık hukuki " +
        "nitelikte midir?",
      { asOf: DURING_V2 },
    );
    expect(result.divergence.outcome).toBe("EXECUTED_FOUND");
    const retrieved = units(result.hits);
    expect(retrieved).toContain("SENTETIK-KARAR-BOZMA#v1:gerekce");
    expect(retrieved).toContain("SENTETIK-KARAR-ONAMA#v1:gerekce");

    const opposing = result.hits.find((hit) => hit.contrary !== undefined);
    expect(opposing?.contrary?.polarity).toBe("AFFIRMATIVE");
    expect(opposing?.contrary?.opposesPolarity).toBe("NEGATIVE");
  });

  it("classifies the two decisions as opposing outcomes at all", async () => {
    // The retrieval tests above depend on this; asserted directly so a stance
    // regression is reported as a stance regression rather than as a mystery
    // retrieval miss.
    const onama = classifyStance(
      "yargitay_karari",
      "GEREKÇE: ... dolandırıcılık suçunun unsurlarının oluştuğu kabul edilmelidir.",
    );
    const bozma = classifyStance(
      "yargitay_karari",
      "GEREKÇE: ... dolandırıcılık suçunun unsurları oluşmadığından yerel " +
        "mahkeme hükmünün bozulmasına karar verilmiştir.",
    );
    expect(onama.polarity).toBe("AFFIRMATIVE");
    expect(bozma.polarity).toBe("NEGATIVE");
    expect(onama.stance).toBe("supporting");
    expect(bozma.stance).toBe("contrary");
    // Legislation states a norm; it never "comes out" either way.
    expect(classifyStance("kanun", "... bozulmasına ...").stance).toBe(
      "neutral",
    );
  });

  it("does not manufacture a conflict for a question about a provision's text", async () => {
    // "What does the article say?" is answered from the statute. A decision
    // holding the rule inapplicable to some facts is not authority against the
    // rule's WORDING, and surfacing it as such would be a false conflict.
    const result = await searchPipeline(
      sql,
      "5237 sayılı Sentetik Ceza Kanunu m. 160 hükmü nedir?",
      { asOf: DURING_V2 },
    );
    expect(result.questionIntent).toBe("NORM_CONTENT");
    expect(result.divergence.outcome).toBe("SKIPPED_NORM_CONTENT");
    expect(result.hits.every((hit) => hit.contrary === undefined)).toBe(true);
  });

  // =======================================================================
  // 3. AS-OF VERSION SELECTION
  // =======================================================================

  it("selects the right version at three dates, and exactly one of them", async () => {
    const statute = "SENTETIK-CEZA-KANUNU";
    const labelsAt = async (asOf: string) => {
      const versions = await listInForceVersions(sql, { asOf, limit: 50 });
      return versions
        .filter((version) => version.externalId === statute)
        .map((version) => version.documentVersionId);
    };

    // (a) before ANY commencement: the statute did not exist yet. Not "the
    //     oldest version by default" — nothing.
    expect(await labelsAt(BEFORE_ANY_VERSION)).toHaveLength(0);

    // (b) between v1 and v2: v1, and only v1.
    const duringV1 = await labelsAt(DURING_V1);
    expect(duringV1).toEqual([corpus.versionIds.get(statute + "#v1")]);

    // (c) after v2 commences: v2, and only v2 — even though v1's system_period
    //     was closed by the append trigger, which must not make v1 the answer
    //     for a date inside v2's range.
    const duringV2 = await labelsAt(DURING_V2);
    expect(duringV2).toEqual([corpus.versionIds.get(statute + "#v2")]);

    // The commencement date itself belongs to v2 (ranges are [from, to)).
    expect(await labelsAt(V2_FROM)).toEqual([
      corpus.versionIds.get(statute + "#v2"),
    ]);

    // (d) an UNDATED version (a decision has no validity period) answers at
    //     every date, including one before the statute existed.
    for (const asOf of [BEFORE_ANY_VERSION, DURING_V1, DURING_V2]) {
      const versions = await listInForceVersions(sql, { asOf, limit: 50 });
      expect(
        versions.filter((v) => v.externalId === "SENTETIK-KARAR-BOZMA"),
      ).toHaveLength(1);
    }

    // At no date does any document have two visible versions.
    for (const asOf of [BEFORE_ANY_VERSION, DURING_V1, V2_FROM, DURING_V2]) {
      const versions = await listInForceVersions(sql, { asOf, limit: 100 });
      const perDocument = new Map<string, number>();
      for (const version of versions) {
        perDocument.set(
          version.documentId,
          (perDocument.get(version.documentId) ?? 0) + 1,
        );
      }
      expect([...perDocument.values()].every((n) => n === 1)).toBe(true);
    }
  });

  it("answers the same question with the text in force on the asked date", async () => {
    const question = "TCK m. 160 dolandırıcılık cezası nedir?";
    const older = await searchPipeline(sql, question, { asOf: DURING_V1 });
    const newer = await searchPipeline(sql, question, { asOf: DURING_V2 });

    expect(units(older.hits)).toContain("SENTETIK-CEZA-KANUNU#v1:160");
    expect(units(older.hits)).not.toContain("SENTETIK-CEZA-KANUNU#v2:160");
    expect(units(newer.hits)).toContain("SENTETIK-CEZA-KANUNU#v2:160");
    expect(units(newer.hits)).not.toContain("SENTETIK-CEZA-KANUNU#v1:160");

    // The penalties really differ, so "the right version" is a claim with
    // consequences rather than a label comparison.
    const textOf = (result: Awaited<ReturnType<typeof searchPipeline>>) =>
      result.hits[0]?.provenance.originalText ?? "";
    expect(textOf(older)).toContain("iki yıldan altı yıla kadar");
    expect(textOf(newer)).toContain("dört yıldan sekiz yıla kadar");
  });

  // =======================================================================
  // 4. CITATION FORM: "TCK m. 160" == "5237 sayılı ... m. 160"
  // =======================================================================

  it("retrieves identically whether the law is named or abbreviated", async () => {
    const abbreviated = "TCK m. 160 uyarınca dolandırıcılığın cezası nedir?";
    const spelledOut =
      "5237 sayılı Türk Ceza Kanunu m. 160 uyarınca dolandırıcılığın " +
      "cezası nedir?";

    const a = await searchPipeline(sql, abbreviated, { asOf: DURING_V2 });
    const b = await searchPipeline(sql, spelledOut, { asOf: DURING_V2 });

    // Non-vacuous: the two questions are genuinely different strings, and stay
    // different after Turkish normalization.
    expect(a.normalizedQuery).not.toBe(b.normalizedQuery);
    // They converge only because the resolved citation is canonicalized.
    expect(a.laneQuery).toBe(b.laneQuery);
    expect(a.laneQuery).toContain("5237 m. 160");
    expect(a.laneQuery).not.toContain("tck");
    expect(a.laneQuery).not.toContain("kanunu");

    // Same units, same order, same lane provenance.
    expect(units(b.hits)).toEqual(units(a.hits));
    expect(units(a.hits)).toContain("SENTETIK-CEZA-KANUNU#v2:160");
    expect(a.hits.map((h) => h.fusedScore)).toEqual(
      b.hits.map((h) => h.fusedScore),
    );
  });

  it("canonicalizes only resolved legislation references", () => {
    const normalized = normalizeTurkishSearch(
      "TCK m. 160 ve 9999 sayılı bilinmeyen kanun ile ilgisi nedir?",
    );
    const canonical = canonicalizeReferences(
      normalized,
      parseReferences(normalized),
    );
    // The known abbreviation resolves...
    expect(canonical).toContain("5237 m. 160");
    // ...the article locator and the surrounding question survive untouched.
    expect(canonical).toContain("ilgisi nedir?");
    // A query with no legislation reference is returned unchanged.
    const plain = normalizeTurkishSearch("dolandırıcılığın cezası nedir?");
    expect(canonicalizeReferences(plain, parseReferences(plain))).toBe(plain);
  });

  // =======================================================================
  // 5. CITATION EXPANSION (one hop, outbound, as-of aware)
  // =======================================================================

  it("pairs a citation with the article it names, not with its own heading", () => {
    // Pure unit test: this pairing rule is the entire correctness of the
    // expansion, and the trap it has to avoid is a chunk that opens with its
    // own "MADDE 1 -" heading before citing article 160 of another law.
    const passage =
      "MADDE 1 - (1) 5237 sayılı Sentetik Ceza Kanununun 160 ıncı " +
      "maddesinin birinci fıkrasında yer alan ibare değiştirilmiştir.";
    expect(outboundCitations(passage)).toEqual([
      { legislationNo: "5237", articleNo: "160" },
    ]);

    // A passage that cites nothing expands to nothing.
    expect(
      outboundCitations("MADDE 2 - (1) Bu Kanun yayımı tarihinde yürürlüğe girer."),
    ).toEqual([]);
  });

  it("delivers the cited article next to the citing passage, in the as-of version", async () => {
    const question =
      "7101 sayılı Sentetik Değişiklik Kanununun 1 inci maddesi hangi " +
      "maddeyi değiştirmiştir?";
    // Silence the RANKED lanes. Without this the lexical lane happens to find
    // the target article on its own and the assertion would pass whether or
    // not expansion works at all; with it, the pin and the expansion are the
    // only things that can put anything in the result.
    const isolate = { lexicalMinCoverage: 1, trigramMinSimilarity: 1 };

    const current = await searchPipeline(sql, question, {
      asOf: DURING_V2,
      limits: isolate,
    });
    expect(units(current.hits)).toEqual([
      "SENTETIK-TORBA-KANUNU#v1:1",
      "SENTETIK-CEZA-KANUNU#v2:160",
    ]);
    const cited = current.hits[1];
    expect(cited?.citation?.reference).toBe("5237 m.160");
    expect(cited?.citation?.citedByChunkId).toBe(current.hits[0]?.chunkId);
    expect(cited?.provenance.originalText).toContain(
      "dört yıldan sekiz yıla kadar",
    );
    // W12: the expansion is context for its seed, not a pinned answer. Here
    // the seed is a pure pin (fused 0), so the expansion inherits 0.9 x 0.
    expect(cited?.pinned).toBe(false);
    expect(cited?.lanes.map((l) => l.lane)).toEqual(["citation"]);
    expect(cited?.fusedScore).toBeCloseTo(
      (current.hits[0]?.fusedScore ?? 0) * CITATION_SCORE_FACTOR,
      12,
    );
    expect(current.lanesAttempted).toContain("citation");

    // The SAME citation, asked as of a date when the amending law is in force
    // but its amendment is not yet: following it must land on the text that
    // was in force then, not on today's text.
    const historical = await searchPipeline(sql, question, {
      asOf: TORBA_BEFORE_V2,
      limits: isolate,
    });
    expect(units(historical.hits)).toEqual([
      "SENTETIK-TORBA-KANUNU#v1:1",
      "SENTETIK-CEZA-KANUNU#v1:160",
    ]);
    expect(historical.hits[1]?.provenance.originalText).toContain(
      "iki yıldan altı yıla kadar",
    );
  });

  it("an expanded provision never outranks the passage that cited it (W12 regression)", async () => {
    // The audited defect: a passage retrieved on the question's own words
    // cited an article, and the article — pinned, score 1 — led the answer.
    // This question reaches the amending provision LEXICALLY (its words are
    // "ibare" and "değiştirilmiştir"; it cites nothing, so nothing is
    // pinned) and never reaches article 160 on its own, so the article can
    // only arrive by expansion — and it must arrive BEHIND its seed, unpinned,
    // at 0.9x the seed's genuinely non-zero fused score.
    const result = await searchPipeline(sql, "Hangi ibare değiştirilmiştir?", {
      asOf: DURING_V2,
    });
    expect(result.laneFailures).toEqual([]);
    expect(result.hits.some((hit) => hit.pinned)).toBe(false);

    const seedIndex = result.hits.findIndex(
      (hit) => corpus.unitOf.get(hit.chunkId) === "SENTETIK-TORBA-KANUNU#v1:1",
    );
    expect(seedIndex).toBeGreaterThanOrEqual(0);
    const seed = result.hits[seedIndex] as RankedHit;
    expect(seed.fusedScore).toBeGreaterThan(0);

    const expanded = result.hits.filter((hit) => hit.citation !== undefined);
    // Non-vacuous: article 160 is NOT reachable by the question's words.
    expect(expanded.map((hit) => corpus.unitOf.get(hit.chunkId))).toEqual([
      "SENTETIK-CEZA-KANUNU#v2:160",
    ]);
    const article = expanded[0] as RankedHit;
    expect(article.citation?.citedByChunkId).toBe(seed.chunkId);
    expect(result.hits.indexOf(article)).toBe(seedIndex + 1);
    expect(article.pinned).toBe(false);
    expect(article.pinReason).toBeUndefined();
    expect(article.lanes.map((l) => l.lane)).toEqual(["citation"]);
    expect(article.fusedScore).toBeCloseTo(seed.fusedScore * CITATION_SCORE_FACTOR, 12);
    expect(article.fusedScore).toBeLessThan(seed.fusedScore);
  });

  it("does not duplicate a cited article the ranked lanes already returned", async () => {
    // Expansion is an enrichment, not a second copy: when the lexical lane has
    // already delivered the cited passage, the citation must not add it again.
    const result = await searchPipeline(
      sql,
      "7101 sayılı Sentetik Değişiklik Kanununun 1 inci maddesi hangi " +
        "maddeyi değiştirmiştir?",
      { asOf: DURING_V2 },
    );
    const ranked = units(result.hits);
    expect(ranked).toContain("SENTETIK-CEZA-KANUNU#v2:160");
    expect(new Set(ranked).size).toBe(ranked.length);
  });

  // =======================================================================
  // 6. DETERMINISM
  // =======================================================================

  it("returns byte-identical rankings for repeated identical searches", async () => {
    // Ranking used to tie-break on legal.chunks.id, a uuid minted at ingest,
    // so equal-scoring rows came back in an arbitrary order and — through the
    // per-document cap and the result limit — the RESULT SET varied between
    // runs of one build.
    const question =
      "Peşin tahsilat sonrası edimin yerine getirilmemesi dolandırıcılık " +
      "suçunu oluşturur mu?";
    const runs = await Promise.all(
      [0, 1, 2].map(() => searchPipeline(sql, question, { asOf: DURING_V2 })),
    );
    const signature = (result: (typeof runs)[number]) =>
      units(result.hits)
        .map((unit, index) => unit + "@" + result.hits[index]?.fusedScore)
        .join("|");
    expect(signature(runs[1]!)).toBe(signature(runs[0]!));
    expect(signature(runs[2]!)).toBe(signature(runs[0]!));
    expect(runs[0]!.hits.length).toBeGreaterThan(1);
  });
});

// ===========================================================================
// 7. THE CITATOR LANE — the edge no lexical mechanism can find
// ===========================================================================
//
// An amending provision and the text it amends deliberately share almost no
// vocabulary: "…160 ıncı maddesinin birinci fıkrasında yer alan '…' ibaresi
// '…' şeklinde değiştirilmiştir" names neither the offence nor the words a
// reader would use to ask about it, and the amended article's own text says
// nothing about having been amended. On the fixture corpus that cost one
// whole gold query (temporal accuracy 83.3%, n=6), and no amount of stemming
// or coverage tuning could have recovered it — the connection is not in the
// text, it is an EDGE in legal.document_relations.
//
// These tests insert that edge directly rather than through the Python
// ingestion pipeline, so they pin the RETRIEVAL contract on its own: which
// edges are followed, what each admitted passage carries, and what the lane
// refuses to do.

describe("citator lane (legal.document_relations)", () => {
  const CEZA = "SENTETIK-CEZA-KANUNU";
  const TORBA_ARTICLE_1 = "SENTETIK-TORBA-KANUNU#v1:1";
  /** Reaches article 161 of the ceza kanunu and nothing of the torba. */
  const QUESTION =
    "Bilişim sistemleri araç olarak kullanılarak işlenen fiil ağırlaştırıcı " +
    "sebep sayılır mı?";

  let relationId: string;

  beforeAll(async () => {
    const rows = await sql`
      insert into legal.document_relations
        (from_document_version_id, to_document_id, kind, source_chunk_id,
         target_locator, resolution_status, confidence, resolver_version,
         evidence)
      values (
        ${corpus.versionIds.get("SENTETIK-TORBA-KANUNU#v1") as string},
        ${corpus.documentIds.get(CEZA) as string},
        'AMENDS',
        ${corpus.chunkIds.get(TORBA_ARTICLE_1) as string},
        ${sql.json({ legislation_no: "5237", article: "160" })},
        'resolved', 0.99, 'quality-fixture-v1',
        ${sql.json({ note: "SENTETIK" })}
      )
      returning id`;
    relationId = String(rows[0]?.["id"]);
  });

  afterAll(async () => {
    await sql`delete from legal.document_relations`;
  });

  it("reaches the amending instrument from a question that never names it", async () => {
    const withEdge = await searchPipeline(sql, QUESTION, { asOf: DURING_V2 });
    const ranked = units(withEdge.hits);

    // The question's own words cannot reach the torba...
    const lexical = await lexicalSearch(sql, normalizeTurkishSearch(QUESTION), {
      asOf: DURING_V2,
      limit: 50,
    });
    expect(lexicalUnits(lexical)).not.toContain(TORBA_ARTICLE_1);
    // ...and the stored edge does.
    expect(ranked).toContain(TORBA_ARTICLE_1);
    expect(withEdge.citator.outcome).toBe("EXECUTED_FOUND");
    expect(withEdge.citator.admitted).toBeGreaterThan(0);
    expect(withEdge.laneFailures).toEqual([]);
  });

  it("brings the amended provision with it, in the version in force", async () => {
    const result = await searchPipeline(sql, QUESTION, { asOf: DURING_V2 });
    const amended = result.hits.find((hit) => hit.relation?.role === "amended");
    expect(amended).toBeDefined();
    expect(units([amended as RankedHit])).toEqual(["SENTETIK-CEZA-KANUNU#v2:160"]);
    expect(amended?.provenance.originalText).toContain("dört yıldan sekiz yıla kadar");
  });

  it("carries the edge that produced it, so why-is-this-here has an answer", async () => {
    const result = await searchPipeline(sql, QUESTION, { asOf: DURING_V2 });
    const admitted = result.hits.filter((hit) => hit.relation !== undefined);
    expect(admitted.length).toBeGreaterThan(0);
    for (const hit of admitted) {
      expect(hit.relation?.relationId).toBe(relationId);
      expect(hit.relation?.kind).toBe("AMENDS");
      expect(hit.relation?.direction).toBe("inbound");
      // Only confirmed edges are followed — never an ambiguous target.
      expect(hit.relation?.resolutionStatus).toBe("resolved");
      expect(hit.relation?.resolverVersion).toBe("quality-fixture-v1");
      expect(hit.relation?.confidence).toBeCloseTo(0.99, 4);
      expect(hit.relation?.targetArticleNo).toBe("160");
      // The anchor names a passage that is actually in the ranking.
      expect(units(result.hits)).toContain(
        corpus.unitOf.get(hit.relation?.viaChunkId ?? "") ?? "",
      );
      expect(hit.lanes.map((lane) => lane.lane)).toEqual(["relation"]);
      expect(hit.pinned).toBe(false);
    }
  });

  it("APPENDS: every passage the primary lanes ranked keeps the rank it earned", async () => {
    // The lane can only add recall. It must never push an expected passage
    // out of a top-k window, which is why it is not interleaved.
    const withEdge = await searchPipeline(sql, QUESTION, { asOf: DURING_V2 });
    const disabled = await searchPipeline(sql, QUESTION, {
      asOf: DURING_V2,
      limits: { relationLimit: 0 },
    });

    expect(disabled.citator.outcome).toBe("DISABLED");
    expect(disabled.hits.some((hit) => hit.relation !== undefined)).toBe(false);
    const primary = units(disabled.hits);
    expect(units(withEdge.hits).slice(0, primary.length)).toEqual(primary);
    expect(withEdge.hits.length).toBeGreaterThan(disabled.hits.length);
  });

  it("is tunable through the REQUEST schema, not only through the internal call", async () => {
    // searchLegalCorpus is the validated entry point an HTTP caller reaches,
    // and its `limits` object is `.strict()`. Until relationSeedCount /
    // relationLimit were listed there, a caller could not disable or tune the
    // citator lane at all: the request was rejected as INVALID_REQUEST. A lane
    // that only the library can configure is not a lane an operator can
    // measure "with" against "without".
    const enabled = await searchLegalCorpus(sql, {
      query: QUESTION,
      asOf: DURING_V2,
      limits: { relationSeedCount: 10, relationLimit: 6 },
    });
    expect(enabled.status).toBe("ok");
    if (enabled.status !== "ok") return;
    expect(enabled.data.some((hit) => hit.relation !== undefined)).toBe(true);

    const disabled = await searchLegalCorpus(sql, {
      query: QUESTION,
      asOf: DURING_V2,
      limits: { relationLimit: 0 },
    });
    expect(disabled.status).toBe("ok");
    if (disabled.status !== "ok") return;
    expect(disabled.data.some((hit) => hit.relation !== undefined)).toBe(false);

    // Seeding zero disables it just as `relationLimit: 0` does.
    const unseeded = await searchLegalCorpus(sql, {
      query: QUESTION,
      asOf: DURING_V2,
      limits: { relationSeedCount: 0 },
    });
    expect(unseeded.status).toBe("ok");
    if (unseeded.status !== "ok") return;
    expect(unseeded.data.some((hit) => hit.relation !== undefined)).toBe(false);

    // `.strict()` still holds: the schema gained exactly two fields, it did
    // not stop rejecting unknown ones.
    const typo = await searchLegalCorpus(sql, {
      query: QUESTION,
      asOf: DURING_V2,
      limits: { relationLimitt: 3 },
    });
    expect(typo.status).toBe("error");
    if (typo.status !== "error") return;
    expect(typo.error.kind).toBe("INVALID_REQUEST");
  });

  it("does not report a change that has not commenced on the question's date", async () => {
    // The amending instrument commences 2023-01-01; asked as of 2021 there is
    // no such amendment yet, and saying otherwise would be a statement about
    // a different date than the one the reader asked about.
    const early = await searchPipeline(sql, QUESTION, { asOf: DURING_V1 });
    expect(early.hits.length).toBeGreaterThan(0);
    expect(early.hits.some((hit) => hit.relation !== undefined)).toBe(false);
    expect(early.citator.outcome).toBe("EXECUTED_NONE_FOUND");
  });

  it("follows only CONFIRMED edges: an ambiguous target is never cited", async () => {
    await sql`
      update legal.document_relations
      set resolution_status = 'ambiguous'
      where id = ${relationId}`;
    try {
      const result = await searchPipeline(sql, QUESTION, { asOf: DURING_V2 });
      expect(result.citator.outcome).toBe("EXECUTED_NONE_FOUND");
      expect(result.hits.some((hit) => hit.relation !== undefined)).toBe(false);
      expect(units(result.hits)).not.toContain(TORBA_ARTICLE_1);
    } finally {
      await sql`
        update legal.document_relations
        set resolution_status = 'resolved'
        where id = ${relationId}`;
    }
  });

  it("cannot manufacture a hit for a question the corpus cannot answer", async () => {
    // The abstention guarantee, unchanged by construction: no primary hit
    // means no seed, and no seed means no edge is ever looked up.
    const result = await searchPipeline(
      sql,
      "Yörünge çarpışma sigortasında tahkim usulü nedir?",
      { asOf: DURING_V2 },
    );
    expect(result.hits).toEqual([]);
    expect(result.citator.outcome).toBe("SKIPPED_NO_PRIMARY_HITS");
  });

  it("follows the edge in the other direction too, from the amending passage", async () => {
    // Outbound is seeded by the exact PASSAGE, not by the whole instrument:
    // an omnibus law amends several unrelated statutes, and reaching its
    // first article is not a question about its second article's target.
    const result = await searchPipeline(
      sql,
      "7101 sayılı Sentetik Değişiklik Kanununun 1 inci maddesi neyi " +
        "değiştirmiştir?",
      { asOf: DURING_V2, limits: { citationExpansionLimit: 0 } },
    );
    const ranked = units(result.hits);
    expect(ranked).toContain(TORBA_ARTICLE_1);
    expect(ranked).toContain("SENTETIK-CEZA-KANUNU#v2:160");
    const outbound = result.hits.filter(
      (hit) => hit.relation?.direction === "outbound",
    );
    expect(outbound.length).toBeGreaterThan(0);
    for (const hit of outbound) {
      expect(hit.relation?.viaChunkId).toBe(
        corpus.chunkIds.get(TORBA_ARTICLE_1) as string,
      );
    }
  });

  it("never returns the same passage twice", async () => {
    const result = await searchPipeline(sql, QUESTION, { asOf: DURING_V2 });
    const ids = result.hits.map((hit) => hit.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ===========================================================================
// W14 B-08 — a fact pattern must not be punished for being a fact pattern
//
// Measured 02.09.2026 (DAILYFLOW §2, question 7): the same legal question
// returned 8 pieces of evidence and two Yargıtay decisions in its two-sentence
// form and — as a 1 178-character account of what actually happened, which is
// exactly how a lawyer types — 1 piece of evidence, 0 case law,
// QUESTION_NOT_COVERED:7, coverage.ratio 0,07.
//
// This runs the REAL AnswerPipeline over the REAL quality corpus for six
// short/long pairs and prints the before/after table the wave report carries.
// The corpus is SENTETİK: this measures the coverage gate's UNIT, and is not
// a statement about legal quality.
// ===========================================================================


describe("B-08 · a long fact pattern retrieves at least as well as its short core", () => {
  let pipeline: AnswerPipeline;

  beforeAll(() => {
    pipeline = new AnswerPipeline({
      retrieval: createStoreRetrievalPort(sql),
      texts: createStoreTextPort(sql),
      versionFacts: createStoreVersionFactsPort(sql),
    });
  });

  it("every long form is over 1 000 code points and its short core is not", () => {
    console.log(
      "B-08 uzunluklar: " +
        LONG_FORM_PAIRS.map(
          (pair) => pair.id + "=" + String(Array.from(pair.long).length),
        ).join(", "),
    );
    for (const pair of LONG_FORM_PAIRS) {
      expect(Array.from(pair.long).length).toBeGreaterThan(1000);
      expect(Array.from(pair.short).length).toBeLessThan(LONG_QUESTION_CODE_POINTS);
    }
  });

  it("keeps >= 70% of the short form's evidence on every pair, and the same status class", async () => {
    const rows: string[] = [];
    const failures: string[] = [];
    for (const pair of LONG_FORM_PAIRS) {
      const short = await pipeline.answer({ question: pair.short, asOf: DURING_V2 });
      const long = await pipeline.answer({ question: pair.long, asOf: DURING_V2 });
      const shortCount = short.result.evidence.length;
      const longCount = long.result.evidence.length;
      const ratio = shortCount === 0 ? 1 : longCount / shortCount;
      rows.push(
        [
          pair.id,
          "kisa " + String(shortCount).padStart(2) + " kanit / " + short.result.status,
          "uzun " + String(longCount).padStart(2) + " kanit / " + long.result.status,
          "oran " + (ratio * 100).toFixed(0) + "%",
          "measuredOn=" + (long.result.coverage?.measuredOn ?? "-"),
          "kapsam kisa " +
            (short.result.coverage?.ratio ?? 0).toFixed(2) +
            " / uzun " +
            (long.result.coverage?.ratio ?? 0).toFixed(2),
        ].join(" | "),
      );
      if (ratio < 0.7) failures.push(pair.id + ": " + String(longCount) + "/" + String(shortCount));
      if (long.result.coverage?.measuredOn !== "soru") {
        failures.push(pair.id + ": measuredOn=" + String(long.result.coverage?.measuredOn));
      }
      // Same status CLASS: an answerable short form may not become an
      // abstention just because the reader supplied the facts.
      if (short.result.status !== "ABSTAIN" && long.result.status === "ABSTAIN") {
        failures.push(pair.id + ": " + short.result.status + " -> ABSTAIN");
      }
    }
    console.log("\nB-08 kisa/uzun bicim olcumu (SENTETIK korpus):\n" + rows.join("\n"));
    expect(failures).toEqual([]);
  });

  it("leaves the SHORT form's code path untouched (measuredOn = soru+olay)", async () => {
    for (const pair of LONG_FORM_PAIRS) {
      const short = await pipeline.answer({ question: pair.short, asOf: DURING_V2 });
      expect(short.result.coverage?.measuredOn).toBe("soru+olay");
    }
  });
});
