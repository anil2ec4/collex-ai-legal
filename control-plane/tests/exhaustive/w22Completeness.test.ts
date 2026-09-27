/**
 * W22: what the run is allowed to SAY about a finished deterministic
 * analysis, and about a file one page of which was read by OCR with low
 * confidence.
 *
 * The investigator's file: the contradictions task compared 0 of the 12
 * pairs that decided the case, and the result read "COMPLETE", "Belgeler
 * arası karşılaştırma tamamlandı", exhaustiveClaimRefusedBecause null. With
 * one low-confidence OCR page the screen said "9 belgenin 9 tanesi okundu.
 * Bu nedenle bu inceleme dosyanın tamamını kapsamıyor" (naming no reason)
 * next to "Kaynak kapsamı eksik — 5 / 5 sayfa işlendi". Every block fails on
 * the W21 code.
 */

import { describe, expect, it } from "vitest";
import {
  deriveAnalysisCompleteness,
  deriveExtractionCoverage,
  deriveIntelligenceCoverage,
} from "../../src/exhaustive/analysisCoverage.js";
import {
  coverageSentenceTr,
  deriveCoverage,
  emptyTally,
  refuseExhaustiveClaim,
  type CoverageTally,
} from "../../src/exhaustive/processingCoverage.js";

function tally(overrides: Partial<CoverageTally> = {}): CoverageTally {
  return {
    ...emptyTally(),
    filesTotal: 9,
    filesProcessed: 9,
    pagesTotal: 5,
    pagesTextLayer: 3,
    pagesOcr: 2,
    analysisUnitsTotal: 9,
    analysisUnitsProcessed: 9,
    ...overrides,
  };
}

const extraction = deriveExtractionCoverage(
  Array.from({ length: 9 }, (_unused, index) => ({
    unitNo: index + 1,
    fileId: `f${index}`,
    state: "done" as const,
    extractionState: "not_required" as const,
    generatedItems: 0,
    acceptedItems: 0,
    invalidItems: 0,
    rejectedQuotes: 0,
    ambiguousQuotes: 0,
    truncatedResponses: 0,
    continuationPasses: 0,
    repairPasses: 0,
  })),
  false,
);

function finishedIntelligence(task: "contradictions" | "chronology", compared = true) {
  return deriveIntelligenceCoverage({
    task,
    tasks: [],
    claimsTotal: 0,
    defensesTotal: 0,
    evidenceItemsTotal: 0,
    modelAvailable: false,
    finalized: true,
    ...(compared
      ? {
          valueComparison: {
            values: 45,
            valuesNeverCompared: 5,
            candidatePairs: 431,
            pairsComparedByEvent: 18,
            pairsComparedByTopic: 37,
          },
        }
      : {}),
  });
}

describe("W22 · a matched-pairs comparison never licenses 'tüm çelişkiler'", () => {
  const source = deriveCoverage(tally({ pagesTextLayer: 5, pagesOcr: 0 }));

  it("every layer finished: LIMITED, not COMPLETE, and the refusal names what was compared", () => {
    expect(source.complete).toBe(true);
    const overall = deriveAnalysisCompleteness({
      task: "contradictions",
      source,
      extraction,
      intelligence: finishedIntelligence("contradictions"),
      active: false,
    });
    expect(overall.state).toBe("LIMITED");
    expect(overall.complete).toBe(false);
    expect(overall.analysisLimited).toBe(true);
    // All three layers DID finish; only the method is limited.
    expect(overall.sourceComplete && overall.extractionComplete && overall.intelligenceComplete).toBe(true);
    expect(overall.sectionsTr.analysis).not.toContain("tamamlandı");
    expect(overall.sectionsTr.analysis).toContain("431 değer çiftinden");
    expect(overall.sectionsTr.analysis).toContain("55 çift karşılaştırıldı");
    expect(overall.sectionsTr.analysis).toContain("farklı kelimelerle anlatılan aynı olay kaçabilir");
    expect(overall.refusedBecause).toContain("\"Tüm çelişkiler\" söylenemez");
    expect(overall.headlineTr).toContain("\"tüm çelişkiler\" olarak okunamaz");
  });

  it("a run stored before W22 (no comparison count) is refused just the same", () => {
    const overall = deriveAnalysisCompleteness({
      task: "contradictions",
      source,
      extraction,
      intelligence: finishedIntelligence("contradictions", false),
      active: false,
    });
    expect(overall.state).toBe("LIMITED");
    expect(overall.refusedBecause).toContain("konu anahtarı örtüşen değer çiftleri");
  });

  it("W23: the chronology is matched-pairs-only too — LIMITED, and a run without per-kind counts names no number", () => {
    // W22 kept the chronology COMPLETE. Its date conflicts use the same pairing
    // rule, so W23 flags it; a task that is not matched-pairs-only (claim_evidence)
    // is still COMPLETE — tests/exhaustive/w23EventAnchors.test.ts.
    const overall = deriveAnalysisCompleteness({
      task: "chronology",
      source,
      extraction,
      intelligence: finishedIntelligence("chronology"),
      active: false,
    });
    expect(overall.state).toBe("LIMITED");
    expect(overall.complete).toBe(false);
    expect(overall.refusedBecause).toBe(
      "\"Tüm tarih çelişkileri\" söylenemez: Tarih çelişkileri yalnız aynı olayı anan ya da konu anahtarı örtüşen" +
        " tarihler arasında arandı; farklı kelimelerle anlatılan aynı olay kaçabilir.",
    );
  });
});

describe("W22 · a low-confidence OCR page is named, and no sentence is said twice", () => {
  const coverage = deriveCoverage(
    tally({
      gaps: [{ fileId: "dd4f95d042920bc4", fileName: "09-bordro-karma.pdf", locator: "s. 2", reason: "OCR_LOW_CONFIDENCE" }],
    }),
  );

  it("the coverage sentence names the page and never says '9 belgenin 9 tanesi'", () => {
    const sentence = coverageSentenceTr(coverage);
    expect(sentence).not.toContain("9 belgenin 9 tanesi");
    expect(sentence).toContain("1 sayfa OCR ile düşük güvenle okundu (aslıyla karşılaştırılmalı)");
    expect(refuseExhaustiveClaim(coverage)).toBe(sentence);
  });

  it("the source layer names it next to '5 / 5 sayfa işlendi', and the headline does not say 'okunmadı'", () => {
    const overall = deriveAnalysisCompleteness({
      task: "chronology",
      source: coverage,
      extraction,
      intelligence: finishedIntelligence("chronology"),
      active: false,
    });
    expect(overall.sectionsTr.source).toContain("5 / 5 sayfa işlendi");
    expect(overall.sectionsTr.source).toContain("1 sayfa OCR ile düşük güvenle okundu");
    expect(overall.headlineTr).not.toContain("okunmadı");
    const sentences = [coverageSentenceTr(coverage), overall.headlineTr, ...Object.values(overall.sectionsTr)]
      .flatMap((text) => text.split(/(?<=\.)\s+/u))
      .map((text) => text.trim())
      .filter((text) => text !== "");
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("a scope of page-less documents is not '(0 sayfa)'", () => {
    const pageless = deriveCoverage(tally({ filesTotal: 2, filesProcessed: 2, pagesTotal: 0, pagesTextLayer: 0, pagesOcr: 0, analysisUnitsTotal: 2, analysisUnitsProcessed: 2 }));
    expect(pageless.complete).toBe(true);
    expect(coverageSentenceTr(pageless)).toBe("Seçtiğiniz 2 belgenin tamamı okundu.");
  });
});
