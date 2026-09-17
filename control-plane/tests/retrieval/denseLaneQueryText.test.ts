/**
 * W21 review #42: the embedding evaluation and the dense lane must embed the
 * SAME query string. hybrid.ts exports that string once (rankedLaneQuery /
 * denseLaneQueryText); these tests pin that
 *
 *   - the helper is exactly the normalization -> reference parse -> citation
 *     canonicalization the pipeline always ran (no ranking change), and
 *   - searchPipeline hands that string, and nothing else, to the dense lane.
 *
 * No database: the SQL lanes are given a connection that refuses every query,
 * which searchPipeline records as lane failures; the dense lane still runs.
 */

import { describe, expect, it } from "vitest";
import { normalizeTurkishSearch } from "../../src/retrieval/normalize.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";
import {
  canonicalizeReferences,
  denseLaneQueryText,
  rankedLaneQuery,
  searchPipeline,
  type DenseLane,
  type DenseLaneState,
} from "../../src/retrieval/hybrid.js";
import type { Sql } from "../../src/store/db.js";

const QUERIES = [
  "6098 sayılı TBK m. 344 uyarınca kira artışı",
  "TCK m. 160 kapsamında İhmal",
  "İşe İADE – “geçerli” neden",
  "  Kira   bedeli\tödenmedi  ",
  "kooperatif genel kurulunda oy hakkı devri",
];

/** A connection that refuses every query (and every helper reached through it). */
function refusingSql(): Sql {
  const refuse = (): never => {
    throw new Error("no database in this test");
  };
  const proxy: unknown = new Proxy(refuse, {
    apply: refuse,
    get: (_target, property) => (property === "then" ? undefined : proxy),
  });
  return proxy as Sql;
}

class RecordingDenseLane implements DenseLane {
  readonly name = "recording-dense";
  readonly state: DenseLaneState = "ACTIVE";
  readonly queries: string[] = [];
  async search(queryText: string): Promise<string[]> {
    this.queries.push(queryText);
    return [];
  }
}

describe("denseLaneQueryText (W21 review #42)", () => {
  it("is exactly the pipeline's normalization, reference parse and citation canonicalization", () => {
    for (const query of QUERIES) {
      const normalized = normalizeTurkishSearch(query);
      const inline = canonicalizeReferences(normalized, parseReferences(normalized));
      const shared = rankedLaneQuery(query);
      expect(shared.normalizedQuery).toBe(normalized);
      expect(shared.references).toEqual(parseReferences(normalized));
      expect(shared.laneQuery).toBe(inline);
      expect(denseLaneQueryText(query)).toBe(inline);
    }
  });

  it("lower-cases and reduces a citation to the legislation number (what the dense lane embeds)", () => {
    expect(denseLaneQueryText("6098 sayılı TBK m. 344 uyarınca kira artışı")).toBe("6098 m. 344 uyarınca kira artışı");
    expect(denseLaneQueryText("TCK m. 160 kapsamında İhmal")).toBe("5237 m. 160 kapsamında ihmal");
  });

  it("searchPipeline hands the dense lane exactly denseLaneQueryText(query), and reports the same lane query", async () => {
    for (const query of QUERIES) {
      const lane = new RecordingDenseLane();
      const result = await searchPipeline(refusingSql(), query, { asOf: "2026-09-11", denseLane: lane });
      expect(lane.queries).toEqual([denseLaneQueryText(query)]);
      expect(result.laneQuery).toBe(denseLaneQueryText(query));
      expect(result.normalizedQuery).toBe(normalizeTurkishSearch(query));
      // The refused SQL lanes are reported as failures, never as "nothing found".
      expect(result.laneFailures.map((failure) => failure.lane)).toContain("lexical");
    }
  });
});
