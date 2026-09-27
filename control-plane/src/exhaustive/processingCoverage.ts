/**
 * Processing coverage: how much of the SELECTED SCOPE was actually read.
 *
 * This is NOT `answer/coverage.ts`
 * --------------------------------
 * That module measures QUESTION coverage — how much of the question the
 * evidence answers — and it gates abstention. Its meaning is locked by tests
 * and must not change. This module answers a completely different question:
 *
 *     "Of the documents, pages and units I was asked to review,
 *      how many did I actually process, and which ones did I not?"
 *
 * The two are independent. An answer can have excellent question coverage
 * over a Matter that was only half read, which is exactly the failure this
 * exists to make impossible to hide.
 *
 * `complete` is DERIVED, never asserted
 * -------------------------------------
 * No model decides that a review was complete. `complete` is a pure function
 * of counts: every selected file processed, every selected page readable or
 * explicitly excluded, every analysis unit processed, nothing failed. One
 * failed unit out of 1 846, or one unreadable page with no accepted
 * exclusion, and it is false — with the reason attached.
 *
 * The product may then say what it did, and must not say more. "Dosyanın
 * tamamını inceledim" is only permitted when `complete` is true.
 *
 * W21: this is SOURCE coverage only — pages and units read. That every
 * page was read says nothing about whether every claim was weighed or every
 * synthesis group finished; those are `ExtractionCoverage` and
 * `IntelligenceCoverage` (analysisCoverage.ts), and only
 * `deriveAnalysisCompleteness` may combine the three.
 */

/** A page (or block) that could not be read, and why. */
export interface CoverageGap {
  /** Upload id the gap belongs to. */
  readonly fileId: string;
  /** Lawyer-facing file name. */
  readonly fileName?: string | undefined;
  /** The locator, as the reader would cite it ("s. 7"). */
  readonly locator: string;
  readonly reason: CoverageGapReason;
}

export type CoverageGapReason =
  /** No text layer and no OCR available: a scan nobody transcribed. */
  | "UNREADABLE_NO_TEXT"
  /** Text so short the page was probably an image with a header. */
  | "SPARSE_TEXT"
  /** The extractor could not read the file at all. */
  | "FILE_EXTRACTION_FAILED"
  /** An analysis unit failed every attempt. */
  | "UNIT_FAILED"
  /**
   * The file is in scope and readable, but produced NO analysis unit at all
   * (it has no chunks). Without this the file would simply be absent from
   * every count except `filesTotal` — incomplete, but with nothing saying
   * which file or why.
   */
  | "NO_ANALYSIS_UNITS"
  /**
   * Canonical text that lies OUTSIDE every chunk, and therefore outside
   * every analysis unit. Chunkers do not necessarily tile the text (a
   * heading before the first article belongs to no chunk), so this is text
   * that was never read. It has to be named, or "complete" would be true
   * over a document whose opening was never looked at.
   */
  | "TEXT_OUTSIDE_UNITS"
  /** The operator excluded it on purpose (still reported, never silent). */
  | "EXCLUDED_BY_REQUEST"
  /**
   * The document has NO source map at all, so nothing can say which of its
   * pages were read. Documents ingested before the page map existed are in
   * this state. Without naming it, such a file contributes `pagesTotal: 0`
   * and sails through the page test — "0 of 0 pages unreadable" — which
   * would let a review of un-mapped documents claim complete coverage.
   */
  | "NO_SOURCE_MAP"
  /**
   * A page whose text was too short to be trusted as read (the extractor's
   * own SPARSE verdict: probably an image with a header). Counted as read
   * for throughput, but NEVER as verified.
   */
  | "SPARSE_PAGE"
  /**
   * W20: a unit that was never processed — the run was cancelled, or is
   * still running, or stopped before reaching it. Distinct from UNIT_FAILED
   * (which means it was attempted and failed every attempt): a lawyer should
   * know whether the tool tried and could not, or simply did not get there.
   */
  | "UNIT_NOT_PROCESSED"
  /**
   * W20: every unit was read, but the model-assisted evaluation step (claim
   * vs evidence weighing, red-team points) did not complete after its retry
   * budget. The deterministic findings are stored; the evaluation is not,
   * so the review is NOT complete.
   */
  | "SYNTHESIS_FAILED"
  /**
   * W20: a scanned page read by LOCAL OCR whose engine confidence was below
   * the floor (intake/ocr.py LOW_CONFIDENCE). Its text is in the canonical
   * text and citable, but nobody should rely on it unchecked.
   */
  | "OCR_LOW_CONFIDENCE";

/**
 * The wire shape.
 *
 * Every number is a count of things in the SELECTED scope, so a reader can
 * do the subtraction themselves. Percentages are deliberately absent: "97%
 * covered" invites rounding to "covered", while "1 843 of 1 846 units, 3
 * failed" does not.
 */
export interface ProcessingCoverage {
  readonly filesTotal: number;
  readonly filesProcessed: number;
  readonly filesFailed: number;

  readonly pagesTotal: number;
  readonly pagesProcessed: number;
  /** Pages read from a born-digital text layer. */
  readonly pagesTextLayer: number;
  /** Pages read by transcription. */
  readonly pagesOcr: number;
  /** Pages with no usable text. NEVER counted as processed. */
  readonly pagesUnreadable: number;

  readonly analysisUnitsTotal: number;
  readonly analysisUnitsProcessed: number;
  readonly analysisUnitsFailed: number;

  /** Derived. True only when nothing in the selected scope was missed. */
  readonly complete: boolean;
  /** Present when `complete` is false: what is missing, itemized. */
  readonly gaps: readonly CoverageGap[];
}

/** The raw counts a run accumulates; `complete` is computed FROM these. */
export interface CoverageTally {
  filesTotal: number;
  filesProcessed: number;
  filesFailed: number;
  pagesTotal: number;
  pagesTextLayer: number;
  pagesOcr: number;
  pagesUnreadable: number;
  analysisUnitsTotal: number;
  analysisUnitsProcessed: number;
  analysisUnitsFailed: number;
  gaps: CoverageGap[];
}

export function emptyTally(): CoverageTally {
  return {
    filesTotal: 0,
    filesProcessed: 0,
    filesFailed: 0,
    pagesTotal: 0,
    pagesTextLayer: 0,
    pagesOcr: 0,
    pagesUnreadable: 0,
    analysisUnitsTotal: 0,
    analysisUnitsProcessed: 0,
    analysisUnitsFailed: 0,
    gaps: [],
  };
}

/**
 * Derive the coverage report from the tally.
 *
 * The ONLY place `complete` is produced. Every condition is a subtraction a
 * reader could redo by hand:
 *   - every selected file processed and none failed;
 *   - no page left unreadable;
 *   - every analysis unit processed and none failed;
 *   - no recorded gap.
 *
 * A scope with nothing in it is NOT complete: "I reviewed all zero of your
 * documents" is not a review, and reporting it as complete is exactly the
 * kind of vacuous truth this contract exists to prevent.
 */
export function deriveCoverage(tally: CoverageTally): ProcessingCoverage {
  const pagesProcessed = tally.pagesTextLayer + tally.pagesOcr;
  const nothingSelected = tally.filesTotal === 0 && tally.analysisUnitsTotal === 0;
  const complete =
    !nothingSelected &&
    tally.filesFailed === 0 &&
    tally.filesProcessed === tally.filesTotal &&
    tally.pagesUnreadable === 0 &&
    pagesProcessed === tally.pagesTotal &&
    tally.analysisUnitsFailed === 0 &&
    tally.analysisUnitsProcessed === tally.analysisUnitsTotal &&
    tally.gaps.length === 0;

  return {
    filesTotal: tally.filesTotal,
    filesProcessed: tally.filesProcessed,
    filesFailed: tally.filesFailed,
    pagesTotal: tally.pagesTotal,
    pagesProcessed,
    pagesTextLayer: tally.pagesTextLayer,
    pagesOcr: tally.pagesOcr,
    pagesUnreadable: tally.pagesUnreadable,
    analysisUnitsTotal: tally.analysisUnitsTotal,
    analysisUnitsProcessed: tally.analysisUnitsProcessed,
    analysisUnitsFailed: tally.analysisUnitsFailed,
    complete,
    gaps: [...tally.gaps],
  };
}

/**
 * The sentence the product is ALLOWED to say about this run.
 *
 * Deliberately the only place such a sentence is produced, so "I reviewed the
 * whole file" cannot be written anywhere else. Plain Turkish, no engineering
 * vocabulary — the reader is a lawyer, and the numbers are documents and
 * pages, not units of work.
 */
export function coverageSentenceTr(coverage: ProcessingCoverage): string {
  if (coverage.filesTotal === 0) {
    return "İncelenecek belge seçilmedi.";
  }
  if (coverage.complete) {
    // W22: a scope of page-less documents (text files, DOCX) has no page
    // count to print — "(0 sayfa)" read as "nothing was read".
    return (
      `Seçtiğiniz ${coverage.filesTotal} belgenin tamamı okundu` +
      (coverage.pagesTotal > 0 ? ` (${coverage.pagesTotal} sayfa).` : ".")
    );
  }
  // W22: "9 belgenin 9 tanesi okundu. Bu nedenle ... kapsamıyor" named no
  // reason at all when the gap was a low-confidence OCR page; every gap that
  // is not one of the counts below is named by qualityGapsTr.
  const parts: string[] = [
    coverage.filesProcessed === coverage.filesTotal
      ? `Seçtiğiniz ${coverage.filesTotal} belgenin tamamı işlendi`
      : `Seçtiğiniz ${coverage.filesTotal} belgenin ${coverage.filesProcessed} tanesi okundu`,
  ];
  if (coverage.pagesUnreadable > 0) {
    parts.push(`${coverage.pagesUnreadable} sayfa okunamadı`);
  }
  if (coverage.filesFailed > 0) {
    parts.push(`${coverage.filesFailed} belge açılamadı`);
  }
  if (coverage.analysisUnitsFailed > 0) {
    parts.push(`${coverage.analysisUnitsFailed} bölüm incelenemedi`);
  }
  const notProcessed =
    coverage.analysisUnitsTotal -
    coverage.analysisUnitsProcessed -
    coverage.analysisUnitsFailed;
  if (notProcessed > 0) {
    parts.push(`${notProcessed} bölüm henüz işlenmedi`);
  }
  if (coverage.gaps.some((gap) => gap.reason === "SYNTHESIS_FAILED")) {
    parts.push("değerlendirme aşaması tamamlanamadı");
  }
  parts.push(...qualityGapsTr(coverage));
  return (
    parts.join("; ") +
    ". Bu nedenle bu inceleme dosyanın tamamını kapsamıyor;" +
    " eksik kalan yerler aşağıda listelendi."
  );
}

/**
 * W22: the gaps that no count of the coverage shows — a page read by OCR with
 * low confidence, a page with almost no text, text outside every unit, a
 * document without a page map or without any unit, a place excluded on
 * request — one plain clause per reason, with how many. Without them the
 * sentence and the "Kaynak kapsamı" line said "eksik" next to "5 / 5 sayfa
 * işlendi" and never said what was missing.
 */
export function qualityGapsTr(coverage: ProcessingCoverage): string[] {
  const count = (...reasons: CoverageGapReason[]): number =>
    coverage.gaps.filter((gap) => reasons.includes(gap.reason)).length;
  const documents = (reason: CoverageGapReason): number =>
    new Set(coverage.gaps.filter((gap) => gap.reason === reason).map((gap) => gap.fileId)).size;
  const out: string[] = [];
  const lowConfidence = count("OCR_LOW_CONFIDENCE");
  if (lowConfidence > 0) out.push(`${lowConfidence} sayfa OCR ile düşük güvenle okundu (aslıyla karşılaştırılmalı)`);
  const sparse = count("SPARSE_PAGE", "SPARSE_TEXT");
  if (sparse > 0) out.push(`${sparse} sayfada çok az metin çıktı (sayfa görüntü olabilir)`);
  const outside = documents("TEXT_OUTSIDE_UNITS");
  if (outside > 0) out.push(`${outside} belgede incelenmemiş metin kaldı`);
  const unmapped = documents("NO_SOURCE_MAP");
  if (unmapped > 0) out.push(`${unmapped} belgenin sayfa eşlemesi yok`);
  const empty = documents("NO_ANALYSIS_UNITS");
  if (empty > 0) out.push(`${empty} belgede incelenecek bölüm bulunamadı`);
  const excluded = count("EXCLUDED_BY_REQUEST");
  if (excluded > 0) out.push(`${excluded} yer incelemeden çıkarıldı`);
  return out;
}

/**
 * Guard for any claim of exhaustiveness.
 *
 * Call this before rendering a sentence like "tüm çelişkiler" or "dosyanın
 * tamamı". It returns the reason the claim is not permitted, or undefined.
 */
export function refuseExhaustiveClaim(
  coverage: ProcessingCoverage,
): string | undefined {
  if (coverage.complete) return undefined;
  if (coverage.filesTotal === 0) return "Hiç belge seçilmedi.";
  return coverageSentenceTr(coverage);
}
