/**
 * Exhaustive Matter analysis (W19 phase G) — the census, its coverage
 * contract, and the contradiction engine built on it.
 *
 * The two scenarios that justify the whole design:
 *
 *   G — contradictions planted in documents FAR APART in the Matter, with no
 *       shared wording, are found. A top-K retrieval could not put both
 *       halves in one small result set; the census compares every comparable
 *       pair, so distance costs nothing.
 *
 *   H — a run interrupted after some units resumes without recomputing the
 *       units whose text has not changed, and an interrupted run NEVER
 *       reports complete coverage.
 *
 * The corpus here is synthetic and proves plumbing, never Turkish legal
 * quality.
 */

import { describe, expect, it } from "vitest";
import {
  buildAnalysisUnits,
  codePointLength,
  codePointSlice,
  DEFAULT_UNIT_MAX_CHARS,
  sha256Hex,
  type UnitSourceSpan,
} from "../../src/exhaustive/units.js";
import {
  coverageSentenceTr,
  deriveCoverage,
  emptyTally,
  refuseExhaustiveClaim,
} from "../../src/exhaustive/processingCoverage.js";
import {
  detectRelations,
  subjectOverlap,
} from "../../src/exhaustive/contradictions.js";
import { extractPropositions, subjectKey } from "../../src/exhaustive/observations.js";
import {
  planUnits,
  reuseKey,
  runAggregate,
  runExhaustiveAnalysis,
  runMap,
  runReduce,
  type ScopedDocument,
  type ScopedSegment,
} from "../../src/exhaustive/runner.js";

// ---------------------------------------------------------------------------
// Analysis units
// ---------------------------------------------------------------------------

function spansFor(text: string, size: number) {
  const spans = [];
  let ordinal = 0;
  for (let at = 0; at < codePointLength(text); at += size) {
    spans.push({
      chunkId: `c${ordinal}`,
      ordinal,
      startChar: at,
      endChar: Math.min(at + size, codePointLength(text)),
    });
    ordinal += 1;
  }
  return spans;
}

describe("analysis units", () => {
  const text = "A".repeat(10_000);

  it("every unit's text is an exact slice of the canonical text", () => {
    const units = buildAnalysisUnits({
      documentVersionId: "v1",
      fileId: "f1",
      canonicalText: text,
      spans: spansFor(text, 300),
    });
    expect(units.length).toBeGreaterThan(1);
    for (const unit of units) {
      expect(unit.text).toBe(codePointSlice(text, unit.startChar, unit.endChar));
      expect(unit.sourceSha256).toBe(sha256Hex(unit.text));
    }
  });

  it("units are contiguous and cover the chunked range without gaps", () => {
    const units = buildAnalysisUnits({
      documentVersionId: "v1",
      fileId: "f1",
      canonicalText: text,
      spans: spansFor(text, 300),
    });
    expect(units[0]!.startChar).toBe(0);
    for (let i = 1; i < units.length; i += 1) {
      expect(units[i]!.startChar).toBe(units[i - 1]!.endChar);
    }
    expect(units[units.length - 1]!.endChar).toBe(codePointLength(text));
  });

  it("never splits a chunk, so a unit maps onto whole citable passages", () => {
    const units = buildAnalysisUnits({
      documentVersionId: "v1",
      fileId: "f1",
      canonicalText: text,
      spans: spansFor(text, 700),
    });
    const covered = units.flatMap((u) => u.chunkIds);
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered.length).toBe(spansFor(text, 700).length);
  });

  it("a single oversized chunk still becomes exactly one unit", () => {
    const huge = "B".repeat(DEFAULT_UNIT_MAX_CHARS * 3);
    const units = buildAnalysisUnits({
      documentVersionId: "v1",
      fileId: "f1",
      canonicalText: huge,
      spans: [{ chunkId: "c0", ordinal: 0, startChar: 0, endChar: huge.length }],
    });
    expect(units).toHaveLength(1);
    expect(units[0]!.text).toBe(huge);
  });

  it("is deterministic: the same input yields identical unit identities", () => {
    const build = () =>
      buildAnalysisUnits({
        documentVersionId: "v1",
        fileId: "f1",
        canonicalText: text,
        spans: spansFor(text, 300),
      });
    expect(build().map((u) => [u.unitNo, u.sourceSha256])).toEqual(
      build().map((u) => [u.unitNo, u.sourceSha256]),
    );
  });

  it("slices by CODE POINTS, not UTF-16 units", () => {
    // An astral character is 2 UTF-16 units but 1 code point; naive slicing
    // would corrupt every offset after it.
    const astral = `abc\u{1F600}def`;
    expect(codePointLength(astral)).toBe(7);
    expect(codePointSlice(astral, 4, 7)).toBe("def");
    expect(codePointSlice(astral, 3, 4)).toBe("\u{1F600}");
  });
});

// ---------------------------------------------------------------------------
// Processing coverage — `complete` is derived, never asserted
// ---------------------------------------------------------------------------

describe("processing coverage", () => {
  const fullTally = () => ({
    ...emptyTally(),
    filesTotal: 2,
    filesProcessed: 2,
    pagesTotal: 10,
    pagesTextLayer: 10,
    analysisUnitsTotal: 20,
    analysisUnitsProcessed: 20,
  });

  it("is complete only when nothing at all was missed", () => {
    expect(deriveCoverage(fullTally()).complete).toBe(true);
  });

  it("ONE failed unit out of many makes it incomplete", () => {
    const tally = fullTally();
    tally.analysisUnitsProcessed = 19;
    tally.analysisUnitsFailed = 1;
    expect(deriveCoverage(tally).complete).toBe(false);
  });

  it("ONE unreadable page makes it incomplete", () => {
    const tally = fullTally();
    tally.pagesTextLayer = 9;
    tally.pagesUnreadable = 1;
    const coverage = deriveCoverage(tally);
    expect(coverage.complete).toBe(false);
    expect(coverage.pagesProcessed).toBe(9);
  });

  it("an empty scope is NOT complete: reviewing zero documents is not a review", () => {
    expect(deriveCoverage(emptyTally()).complete).toBe(false);
  });

  it("OCR pages count as processed and are reported separately", () => {
    const tally = fullTally();
    tally.pagesTextLayer = 7;
    tally.pagesOcr = 3;
    const coverage = deriveCoverage(tally);
    expect(coverage.complete).toBe(true);
    expect(coverage.pagesProcessed).toBe(10);
    expect(coverage.pagesOcr).toBe(3);
  });

  it("refuses an exhaustive claim whenever coverage is short", () => {
    expect(refuseExhaustiveClaim(deriveCoverage(fullTally()))).toBeUndefined();
    const tally = fullTally();
    tally.pagesUnreadable = 1;
    tally.pagesTextLayer = 9;
    expect(refuseExhaustiveClaim(deriveCoverage(tally))).toContain("okunamadı");
  });

  it("says 'the whole file was read' ONLY when that is true", () => {
    expect(coverageSentenceTr(deriveCoverage(fullTally()))).toContain("tamamı okundu");
    const tally = fullTally();
    tally.analysisUnitsFailed = 1;
    tally.analysisUnitsProcessed = 19;
    const sentence = coverageSentenceTr(deriveCoverage(tally));
    expect(sentence).not.toContain("tamamı okundu");
    expect(sentence).toContain("tamamını kapsamıyor");
  });

  it("reports counts, not percentages", () => {
    // "97% covered" rounds to "covered" in a reader's head; counts do not.
    expect(coverageSentenceTr(deriveCoverage(fullTally()))).not.toContain("%");
  });
});

// ---------------------------------------------------------------------------
// Proposition extraction
// ---------------------------------------------------------------------------

describe("proposition extraction", () => {
  it("extracts dates, amounts and ratios with their quotes", () => {
    const text =
      "Davacı, kira bedelini 12.03.2024 tarihinde ödediğini beyan etmiştir." +
      " Ödenen tutar 45.000 TL olarak kayıtlıdır. Kusur oranı %80 olarak" +
      " belirlenmiştir.";
    const found = extractPropositions(text);
    const kinds = found.map((p) => p.kind);
    expect(kinds).toContain("date");
    expect(kinds).toContain("amount");
    expect(kinds).toContain("ratio");
    for (const proposition of found) {
      expect(text).toContain(proposition.quote);
    }
  });

  it("normalizes so that equal values compare equal", () => {
    const a = extractPropositions("Tutar 45.000 TL ödendi.");
    const b = extractPropositions("Tutar 45000,00 TL ödendi.");
    expect(a[0]!.normalizedValue).toBe(b[0]!.normalizedValue);
  });

  it("reads Turkish long-form dates", () => {
    const found = extractPropositions("İhtar 11 Mart 2024 tarihinde tebliğ edildi.");
    expect(found.some((p) => p.occurredOn === "2024-03-11")).toBe(true);
  });

  it("rejects impossible dates instead of inventing one", () => {
    expect(extractPropositions("32.13.2024 tarihinde")).toHaveLength(0);
  });

  it("offsets delimit the quote EXACTLY, even with leading whitespace", () => {
    // The defect this locks: the start was measured before trimming and the
    // length after, so the stored range was shifted by the whitespace that
    // was removed. A citation whose offsets do not reproduce its own text is
    // worse than no citation.
    const text = "   \n\n   Odenen kira bedeli 45.000 TL olarak kayda gecmistir.   ";
    for (const proposition of extractPropositions(text)) {
      expect(
        codePointSlice(text, proposition.startChar, proposition.endChar),
      ).toBe(proposition.quote);
    }
  });

  it("the topic key excludes the value itself", () => {
    // Otherwise two DIFFERENT amounts would never be comparable, and the
    // engine could never find a disagreement.
    expect(subjectKey("Ödenen tutar 45.000 TL olarak kayıtlıdır")).not.toContain("45");
  });
});

// ---------------------------------------------------------------------------
// Scenario G — contradictions far apart, with no shared wording
// ---------------------------------------------------------------------------

const PAGE_FILLER =
  " Bu paragraf dosyanın hacmini artırmak için eklenmiş olup uyuşmazlığın" +
  " esasına ilişkin bir bilgi içermemektedir.";

function bulkDocument(fileId: string, planted: string, paragraphs: number): ScopedDocument {
  const blocks: string[] = [];
  for (let i = 0; i < paragraphs; i += 1) {
    blocks.push(`Paragraf ${i + 1}.${PAGE_FILLER}`);
  }
  // The planted statement sits deep inside, not at the head.
  blocks.splice(Math.floor(paragraphs / 2), 0, planted);
  const canonicalText = blocks.join("\n\n");

  const spans: UnitSourceSpan[] = [];
  let cursor = 0;
  blocks.forEach((block, index) => {
    const length = codePointLength(block);
    spans.push({
      chunkId: `${fileId}-c${index}`,
      ordinal: index,
      startChar: cursor,
      endChar: cursor + length,
    });
    cursor += length + 2;
  });

  const segments: ScopedSegment[] = [
    {
      locatorKind: "page",
      locatorLabel: "1",
      startChar: 0,
      endChar: codePointLength(canonicalText),
      extractionMethod: "pdf_text_layer",
      extractionStatus: "EXTRACTED",
    },
  ];
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    documentVersionId: `${fileId}-v1`,
    canonicalText,
    spans,
    segments,
  };
}

describe("scenario G: exhaustive contradictions", () => {
  // The two halves use the SAME subject words but sit in different documents,
  // dozens of paragraphs deep — the shape no top-K result set would contain.
  const petition = bulkDocument(
    "01-dilekce",
    "Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir.",
    40,
  );
  const expertReport = bulkDocument(
    "02-bilirkisi",
    "İnceleme sonucunda ödenen kira bedeli 32.000 TL olarak tespit edilmiştir.",
    40,
  );
  const hearing = bulkDocument(
    "03-durusma",
    "Tanık, kazanın 12.03.2024 tarihinde meydana geldiğini beyan etti.",
    40,
  );
  const police = bulkDocument(
    "04-tutanak",
    "Tutanakta kazanın 19.07.2024 tarihinde meydana geldiği yazılıdır.",
    40,
  );

  const documents = [petition, expertReport, hearing, police];

  it("finds the seeded amount contradiction across two documents", () => {
    const result = runExhaustiveAnalysis(documents);
    const contradictions = result.relations.filter((r) => r.relation === "CONTRADICTION");

    const amountConflict = contradictions.find(
      (r) =>
        r.left.kind === "amount" &&
        new Set([r.left.fileId, r.right.fileId]).size === 2,
    );
    expect(amountConflict).toBeDefined();
    expect(amountConflict!.rationale).toContain("İkisi birden doğru olamaz");
  });

  it("finds the seeded date contradiction across two other documents", () => {
    const result = runExhaustiveAnalysis(documents);
    const dateConflict = result.relations.find(
      (r) =>
        r.relation === "CONTRADICTION" &&
        r.left.kind === "date" &&
        new Set([r.left.fileId, r.right.fileId]).size === 2,
    );
    expect(dateConflict).toBeDefined();
    expect(
      [dateConflict!.left.normalizedValue, dateConflict!.right.normalizedValue].sort(),
    ).toEqual(["2024-03-12", "2024-07-19"]);
  });

  it("the halves really are far apart — many units, not one", () => {
    const units = planUnits(documents);
    // If the whole matter fitted in a handful of units the scenario would be
    // trivial; it is the distance that makes it a census problem.
    expect(units.length).toBeGreaterThan(8);
    const files = new Set(units.map((u) => u.fileId));
    expect(files.size).toBe(4);
  });

  it("reports complete coverage for a clean run", () => {
    const result = runExhaustiveAnalysis(documents);
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.filesTotal).toBe(4);
    expect(result.coverage.analysisUnitsProcessed).toBe(
      result.coverage.analysisUnitsTotal,
    );
  });

  it("does not report every difference as a contradiction", () => {
    // A fifth document AGREES with the petition. If the engine reported
    // every comparable pair as a conflict, this pair would be a conflict
    // too — so the vocabulary is exercised, not merely declared.
    const receipt = bulkDocument(
      "05-makbuz",
      "Makbuzda ödenen kira bedeli 45.000 TL olarak görünmektedir.",
      40,
    );
    const relations = runExhaustiveAnalysis([...documents, receipt]).relations;
    const verdicts = new Set(relations.map((r) => r.relation));
    expect(verdicts.has("CONTRADICTION")).toBe(true);
    expect(verdicts.has("CORROBORATION")).toBe(true);
    expect(relations.every((r) => r.relation === "CONTRADICTION")).toBe(false);
  });

  it("agreeing documents corroborate rather than conflict", () => {
    const a = bulkDocument("a", "Ödenen kira bedeli 45.000 TL olarak kayda geçmiştir.", 4);
    const b = bulkDocument("b", "Ödenen kira bedeli 45.000 TL olarak tespit edilmiştir.", 4);
    const relations = runExhaustiveAnalysis([a, b]).relations;
    expect(relations.some((r) => r.relation === "CORROBORATION")).toBe(true);
    expect(relations.some((r) => r.relation === "CONTRADICTION")).toBe(false);
  });

  it("near-equal amounts are TENSION, not CONTRADICTION", () => {
    const a = bulkDocument("a", "Ödenen kira bedeli 45.000 TL olarak kayda geçmiştir.", 3);
    const b = bulkDocument("b", "Ödenen kira bedeli 45.100 TL olarak tespit edilmiştir.", 3);
    const relations = runExhaustiveAnalysis([a, b]).relations;
    const verdicts = new Set(relations.map((r) => r.relation));
    expect(verdicts.has("CONTRADICTION")).toBe(false);
    expect(verdicts.has("TENSION")).toBe(true);
  });

  it("every relation carries both source spans for the reader to check", () => {
    const result = runExhaustiveAnalysis(documents);
    for (const relation of result.relations) {
      expect(relation.left.statement.length).toBeGreaterThan(0);
      expect(relation.right.statement.length).toBeGreaterThan(0);
      expect(relation.rationale.length).toBeGreaterThan(0);
    }
  });

  it("observations keep a verifiable quote and a page locator", () => {
    const result = runExhaustiveAnalysis(documents);
    expect(result.observations.length).toBeGreaterThan(0);
    for (const observation of result.observations.slice(0, 20)) {
      expect(observation.quoteSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(observation.locator).toBe("s. 1");
      const source = documents.find((d) => d.fileId === observation.fileId)!;
      expect(
        codePointSlice(source.canonicalText, observation.startChar, observation.endChar),
      ).toBe(observation.quote);
    }
  });

  it("is deterministic across runs", () => {
    const first = runExhaustiveAnalysis(documents).relations.map((r) => [
      r.relation,
      r.left.observationId,
      r.right.observationId,
    ]);
    const second = runExhaustiveAnalysis(documents).relations.map((r) => [
      r.relation,
      r.left.observationId,
      r.right.observationId,
    ]);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Scenario H — interruption and resumption
// ---------------------------------------------------------------------------

describe("scenario H: interruption and resumption", () => {
  const documents = [
    bulkDocument("01", "Ödenen tutar 45.000 TL olarak kayda geçmiştir.", 30),
    bulkDocument("02", "Ödenen tutar 32.000 TL olarak tespit edilmiştir.", 30),
  ];

  it("an interrupted run NEVER reports complete coverage", () => {
    const units = planUnits(documents);
    const stopAfter = Math.floor(units.length / 2);
    const { ledger, observations } = runMap(units, documents, { maxUnits: stopAfter });
    const result = runReduce(documents, ledger, observations, runAggregate(observations));

    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.analysisUnitsProcessed).toBe(stopAfter);
    expect(result.coverage.analysisUnitsTotal).toBe(units.length);
    expect(result.coverage.gaps.length).toBeGreaterThan(0);
  });

  it("resuming does not recompute units whose text is unchanged", () => {
    const units = planUnits(documents);
    const stopAfter = Math.floor(units.length / 2);
    const first = runMap(units, documents, { maxUnits: stopAfter });

    // What a restart would load from the ledger.
    const reusable = new Map(
      first.ledger
        .filter((row) => row.state === "done")
        .map((row) => [
          reuseKey(row.unitNo, row.sourceSha256),
          { extractorVersion: row.extractorVersion! },
        ]),
    );

    let recomputed = 0;
    const second = runMap(units, documents, {
      reusable,
      extract: (unit) => {
        recomputed += 1;
        return extractPropositions(unit.text);
      },
    });

    expect(second.ledger.every((row) => row.state === "done")).toBe(true);
    // Only the units that were NOT finished the first time are re-read.
    expect(recomputed).toBe(units.length - stopAfter);

    const result = runReduce(documents, second.ledger, second.observations, []);
    expect(result.coverage.complete).toBe(true);
  });

  it("a changed document is re-read even though the unit number is the same", () => {
    const units = planUnits(documents);
    const done = runMap(units, documents);
    const reusable = new Map(
      done.ledger.map((row) => [
        reuseKey(row.unitNo, row.sourceSha256),
        { extractorVersion: row.extractorVersion! },
      ]),
    );

    // The file is replaced; its text hashes differently.
    const edited = [
      bulkDocument("01", "Ödenen tutar 99.000 TL olarak kayda geçmiştir.", 30),
      documents[1]!,
    ];
    let recomputed = 0;
    runMap(planUnits(edited), edited, {
      reusable,
      extract: (unit) => {
        recomputed += 1;
        return extractPropositions(unit.text);
      },
    });

    // Stale results cannot survive a document being replaced.
    expect(recomputed).toBeGreaterThan(0);
  });

  it("a stale extractor version forces recomputation", () => {
    const units = planUnits(documents);
    const done = runMap(units, documents);
    const reusable = new Map(
      done.ledger.map((row) => [
        reuseKey(row.unitNo, row.sourceSha256),
        { extractorVersion: "extract-v0" },
      ]),
    );
    let recomputed = 0;
    runMap(units, documents, {
      reusable,
      extract: (unit) => {
        recomputed += 1;
        return extractPropositions(unit.text);
      },
    });
    expect(recomputed).toBe(units.length);
  });

  it("one failing unit does not stop the run, and is counted", () => {
    const units = planUnits(documents);
    const victim = units[3]!.unitNo;
    const { ledger, observations } = runMap(units, documents, {
      extract: (unit) => {
        if (unit.unitNo === victim) throw new Error("bu bölüm okunamadı");
        return extractPropositions(unit.text);
      },
    });
    const result = runReduce(documents, ledger, observations, []);

    expect(result.coverage.analysisUnitsFailed).toBe(1);
    expect(result.coverage.complete).toBe(false);
    // Everything else still ran.
    expect(result.coverage.analysisUnitsProcessed).toBe(units.length - 1);
    expect(result.coverage.gaps.some((g) => g.reason === "UNIT_FAILED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coverage over unreadable pages (scenario B at the run level)
// ---------------------------------------------------------------------------

describe("scenario B at run level: an unreadable page blocks completeness", () => {
  it("a scanned page with no text keeps the run incomplete", () => {
    const document = bulkDocument("01", "Tutar 45.000 TL.", 4);
    const withScan: ScopedDocument = {
      ...document,
      segments: [
        ...document.segments,
        {
          locatorKind: "page",
          locatorLabel: "2",
          startChar: document.canonicalText.length,
          endChar: document.canonicalText.length,
          extractionMethod: "none",
          extractionStatus: "UNREADABLE",
        },
      ],
    };
    const result = runExhaustiveAnalysis([withScan]);

    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.pagesUnreadable).toBe(1);
    expect(result.coverage.gaps).toContainEqual(
      expect.objectContaining({ locator: "s. 2", reason: "UNREADABLE_NO_TEXT" }),
    );
    expect(refuseExhaustiveClaim(result.coverage)).toContain("okunamadı");
  });

  it("a file with NO chunks is named, not silently absent from the counts", () => {
    // Without this the file would appear only in `filesTotal`: coverage
    // would be incomplete with nothing saying which file or why.
    const empty: ScopedDocument = {
      fileId: "77",
      fileName: "parcasiz.pdf",
      documentVersionId: "v",
      canonicalText: "Bu belgenin hiç parçası yok.",
      spans: [],
      segments: [],
    };
    const result = runExhaustiveAnalysis([empty]);

    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.filesProcessed).toBe(0);
    expect(result.coverage.gaps).toContainEqual(
      expect.objectContaining({ fileId: "77", reason: "NO_ANALYSIS_UNITS" }),
    );
  });

  it("canonical text outside every unit is reported as unread", () => {
    // A chunker need not tile the text: a heading before the first article
    // belongs to no chunk. That text was never read, and `complete` must
    // not be true over a document whose opening nobody looked at.
    const head = "A".repeat(1500);
    const body = "B".repeat(1500);
    const document: ScopedDocument = {
      fileId: "88",
      fileName: "basliksiz.pdf",
      documentVersionId: "v",
      // Only the SECOND half is chunked.
      canonicalText: head + body,
      spans: [
        {
          chunkId: "c0",
          ordinal: 0,
          startChar: head.length,
          endChar: head.length + body.length,
        },
      ],
      segments: [],
    };
    const result = runExhaustiveAnalysis([document]);

    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.gaps).toContainEqual(
      expect.objectContaining({ fileId: "88", reason: "TEXT_OUTSIDE_UNITS" }),
    );
  });

  it("whitespace trimmed at block boundaries is NOT reported as unread", () => {
    // The tolerance exists so a handful of trimmed code points does not
    // produce a gap on every well-formed document.
    const block = "C".repeat(1000);
    const document: ScopedDocument = {
      fileId: "89",
      fileName: "duzgun.pdf",
      canonicalText: block + "\n\n" + block,
      documentVersionId: "v",
      spans: [
        { chunkId: "c0", ordinal: 0, startChar: 0, endChar: block.length },
        {
          chunkId: "c1",
          ordinal: 1,
          startChar: block.length + 2,
          endChar: block.length + 2 + block.length,
        },
      ],
      segments: [],
    };
    const result = runExhaustiveAnalysis([document]);
    expect(
      result.coverage.gaps.some((g) => g.reason === "TEXT_OUTSIDE_UNITS"),
    ).toBe(false);
  });

  it("a file that could not be opened is counted as failed, not absent", () => {
    const broken: ScopedDocument = {
      fileId: "99",
      fileName: "bozuk.pdf",
      documentVersionId: "v",
      canonicalText: "",
      spans: [],
      segments: [],
      extractionFailed: true,
    };
    const result = runExhaustiveAnalysis([broken]);
    expect(result.coverage.filesFailed).toBe(1);
    expect(result.coverage.complete).toBe(false);
  });
});

describe("subjectOverlap", () => {
  it("is 1 for identical keys and 0 for disjoint ones", () => {
    expect(subjectOverlap("a b c", "a b c")).toBe(1);
    expect(subjectOverlap("a b", "c d")).toBe(0);
    expect(subjectOverlap("", "a")).toBe(0);
  });
});

describe("detectRelations", () => {
  it("ignores pairs whose topics do not overlap enough", () => {
    const relations = detectRelations([
      {
        observationId: "1", kind: "amount", subject: "kira bedel", predicate: "tutar",
        normalizedValue: "100", fileId: "a", unitNo: 1, statement: "s1",
      },
      {
        observationId: "2", kind: "amount", subject: "vekalet ucret", predicate: "tutar",
        normalizedValue: "200", fileId: "b", unitNo: 1, statement: "s2",
      },
    ]);
    expect(relations).toHaveLength(0);
  });

  it("does not compare two figures inside the same unit by default", () => {
    // "45 000 TL of which 5 000 TL interest" is arithmetic, not disagreement.
    const same = {
      kind: "amount" as const, subject: "kira bedel odenen", predicate: "tutar",
      fileId: "a", unitNo: 1, statement: "s",
    };
    expect(
      detectRelations([
        { ...same, observationId: "1", normalizedValue: "100" },
        { ...same, observationId: "2", normalizedValue: "200" },
      ]),
    ).toHaveLength(0);
  });
});
