/**
 * Contract D — additive court/date filters.
 *
 *  1. `passesCourtDateFilters` semantics: rulings are filtered, norm texts
 *     never are, undated rulings survive a date filter.
 *  2. Plumbing: a `filters` object given to POST /v1/answer reaches the
 *     retrieval port verbatim; absent filters leave the request unchanged
 *     (old behavior byte-for-byte).
 */

import { describe, expect, it } from "vitest";

import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import { passesCourtDateFilters } from "../../src/retrieval/searchService.js";
import { answerRequestSchema } from "../../src/api/answerService.js";
import {
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  StubCorpus,
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  standardTexts,
} from "./fakes.js";

const RULING = {
  documentType: "yargitay_karari",
  title: "Yargıtay 3. HD E. 2023/100 K. 2024/50 (sentetik)",
  court: "Yargıtay 3. Hukuk Dairesi",
  decisionDate: "2023-05-11",
  docketNo: "2023/100",
  decisionNo: "2024/50",
};

const NORM = {
  documentType: "kanun",
  title: "Türk Ceza Kanunu (SENTETİK)",
  decisionDate: null,
  docketNo: null,
  decisionNo: null,
};

describe("passesCourtDateFilters — semantics", () => {
  it("no filters -> everything passes", () => {
    expect(passesCourtDateFilters(RULING, undefined)).toBe(true);
    expect(passesCourtDateFilters(NORM, undefined)).toBe(true);
  });

  it("a norm text is NEVER dropped by a court/date filter", () => {
    expect(
      passesCourtDateFilters(NORM, {
        courtTypes: ["Danıştay"],
        dateFrom: "2030-01-01",
        dateTo: "2030-12-31",
      }),
    ).toBe(true);
  });

  it("courtTypes: Turkish-normalized substring over court/type/title", () => {
    expect(passesCourtDateFilters(RULING, { courtTypes: ["Yargıtay"] })).toBe(true);
    expect(passesCourtDateFilters(RULING, { courtTypes: ["YARGITAY"] })).toBe(true);
    expect(passesCourtDateFilters(RULING, { courtTypes: ["Danıştay"] })).toBe(false);
    expect(passesCourtDateFilters(RULING, { courtTypes: ["Danıştay", "Yargıtay"] })).toBe(true);
    // Matching on the document type alone works too (no court column).
    expect(
      passesCourtDateFilters({ ...RULING, court: null, title: "başlıksız" }, {
        courtTypes: ["yargitay"],
      }),
    ).toBe(true);
  });

  it("dateFrom/dateTo bound the decision date inclusively", () => {
    expect(passesCourtDateFilters(RULING, { dateFrom: "2023-05-11" })).toBe(true);
    expect(passesCourtDateFilters(RULING, { dateFrom: "2023-05-12" })).toBe(false);
    expect(passesCourtDateFilters(RULING, { dateTo: "2023-05-11" })).toBe(true);
    expect(passesCourtDateFilters(RULING, { dateTo: "2023-05-10" })).toBe(false);
    expect(
      passesCourtDateFilters(RULING, { dateFrom: "2023-01-01", dateTo: "2023-12-31" }),
    ).toBe(true);
  });

  it("an undated ruling survives a date filter (never silently hidden)", () => {
    const undated = { ...RULING, decisionDate: null };
    expect(passesCourtDateFilters(undated, { dateFrom: "2030-01-01" })).toBe(true);
    // ... but a court filter still applies to it.
    expect(passesCourtDateFilters(undated, { courtTypes: ["Danıştay"] })).toBe(false);
  });
});

describe("plumbing — filters reach the retrieval port (contract D)", () => {
  function pipelineWith(corpus: StubCorpus): AnswerPipeline {
    return new AnswerPipeline({
      retrieval: corpus,
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
  }

  it("passes courtTypes/dateFrom/dateTo verbatim into every retrieval call", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const pipeline = pipelineWith(corpus);
    const filters = {
      courtTypes: ["Yargıtay"],
      dateFrom: "2023-01-01",
      dateTo: "2024-12-31",
    };
    await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01", filters });

    expect(corpus.calls.length).toBeGreaterThan(0);
    for (const call of corpus.calls) {
      expect(call.filters).toEqual(filters);
    }
  });

  it("without filters the retrieval request carries none (old behavior)", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const pipeline = pipelineWith(corpus);
    await pipeline.answer({ question: Q_NORM_CONTENT, asOf: "2025-06-01" });

    expect(corpus.calls.length).toBeGreaterThan(0);
    for (const call of corpus.calls) {
      expect(call.filters).toBeUndefined();
    }
  });
});

describe("wire schema — POST /v1/answer accepts the additive filters", () => {
  it("accepts courtTypes/dateFrom/dateTo and rejects a malformed date", () => {
    const good = answerRequestSchema.safeParse({
      question: "TCK m. 157 dolandırıcılık suçunun cezası nedir?",
      filters: { courtTypes: ["Yargıtay"], dateFrom: "2023-01-01", dateTo: "2024-12-31" },
    });
    expect(good.success).toBe(true);

    const bad = answerRequestSchema.safeParse({
      question: "TCK m. 157 dolandırıcılık suçunun cezası nedir?",
      filters: { dateFrom: "01.01.2023" },
    });
    expect(bad.success).toBe(false);
  });
});
