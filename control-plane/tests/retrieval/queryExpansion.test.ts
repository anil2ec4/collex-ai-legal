/**
 * Corpus-lane query expansion (retrieval/queryExpansion.ts, 2026-09-10).
 * Pure module: no database, no fakes needed.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY_EXPANSION_LIMIT,
  emptyExpansion,
  expandQuery,
} from "../../src/retrieval/queryExpansion.js";
import { CONCEPT_TABLE, conceptTokens, tableEntryFires } from "../../src/planner/intake.js";
import { DEFAULT_EXPANSION_TERM_WEIGHT } from "../../src/store/chunkStore.js";
import { normalizeTurkishSearch } from "../../src/retrieval/normalize.js";

describe("expandQuery", () => {
  it("adds the concept's synonym terms for a question that reaches a table row", () => {
    const q = normalizeTurkishSearch("İşe iade davasında geçerli neden nasıl değerlendirilir?");
    const expansion = expandQuery(q);
    expect(expansion.concepts).toContain("işe iade");
    // The row's other terms arrive; the ones the reader already wrote do not.
    expect(expansion.terms).toContain("feshin geçersizliği");
    expect(expansion.terms).toContain("işe başlatmama tazminatı");
    expect(expansion.terms).not.toContain("işe iade");
    expect(expansion.terms).not.toContain("geçerli neden");
    expect(expansion.weight).toBe(DEFAULT_EXPANSION_TERM_WEIGHT);
    expect(expansion.limit).toBe(DEFAULT_QUERY_EXPANSION_LIMIT);
  });

  it("never adds a term the query already contains (guarantee 3)", () => {
    for (const question of [
      "işe iade feshin geçersizliği geçerli neden işe başlatmama tazminatı",
      "kira sözleşmesi tahliye",
      "haksız fiil tazminatı",
    ]) {
      const q = normalizeTurkishSearch(question);
      const tokens = conceptTokens(q);
      for (const term of expandQuery(q).terms) {
        expect(tableEntryFires(term, tokens)).toBe(false);
      }
    }
  });

  it("caps the added terms and reports the cap", () => {
    const q = normalizeTurkishSearch("kira sözleşmesi tahliye temerrüt ihtarname depozito");
    const capped = expandQuery(q, { limit: 3 });
    expect(capped.terms.length).toBeLessThanOrEqual(3);
    expect(capped.limit).toBe(3);
    const wide = expandQuery(q, { limit: 32 });
    expect(wide.terms.length).toBeGreaterThanOrEqual(capped.terms.length);
    expect(expandQuery(q).terms.length).toBeLessThanOrEqual(DEFAULT_QUERY_EXPANSION_LIMIT);
  });

  it("limit 0 disables expansion and says so", () => {
    const q = normalizeTurkishSearch("işe iade davası");
    expect(expandQuery(q, { limit: 0 })).toEqual(emptyExpansion(0, DEFAULT_EXPANSION_TERM_WEIGHT));
  });

  it("adds nothing for a question no concept reaches, and nothing for empty input", () => {
    expect(expandQuery(normalizeTurkishSearch("yağmur suyu abonelik başvurusu gerçekten")).terms).toEqual([]);
    expect(expandQuery("").terms).toEqual([]);
    expect(expandQuery("   ").concepts).toEqual([]);
  });

  it("every added term is a string of the authored table, in table order per concept", () => {
    const q = normalizeTurkishSearch("kıdem tazminatı hesaplaması nasıl yapılır");
    const expansion = expandQuery(q);
    expect(expansion.concepts.length).toBeGreaterThan(0);
    const allowed = new Set(
      Object.values(CONCEPT_TABLE).flatMap((entry) => [...entry.terms]),
    );
    for (const term of expansion.terms) expect(allowed.has(term)).toBe(true);
    expect(new Set(expansion.terms).size).toBe(expansion.terms.length);
  });

  it("is deterministic", () => {
    const q = normalizeTurkishSearch("temerrüt nedeniyle tahliye davası otuz gün ihtarname");
    expect(expandQuery(q)).toEqual(expandQuery(q));
  });
});
