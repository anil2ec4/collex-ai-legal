/**
 * The exhaustive Matter analysis run: Map -> Aggregate -> Reduce.
 *
 * This is NOT `/v1/answer`
 * ------------------------
 * `/v1/answer` is targeted question answering: retrieve the best passages,
 * draft from them, verify, abstain if thin. It is fast and it is bounded by a
 * ranking, which makes it structurally incapable of answering "find every
 * contradiction in this file" — top-K is a ranking, not a census.
 *
 * This runner is the census. It walks EVERY analysis unit of the selected
 * scope, extracts structured observations from each, then compares
 * observations across the whole Matter. Nothing here consults a ranked
 * retrieval result, and that is the point: an exhaustive path that secretly
 * used top-K would be a lie told in a different module.
 *
 * Durability
 * ----------
 * Every unit is a row before any work starts, so the census exists even if
 * the process dies immediately. A unit moves pending -> running -> done and
 * carries the sha256 of its own text. On a restart, a unit whose hash AND
 * extractor version match a completed row is reused; everything else is
 * redone. Failing unit 846 of 1 200 therefore costs unit 846, not units
 * 1-845.
 *
 * Coverage is counted, never claimed
 * ----------------------------------
 * `processingCoverage` is derived from the ledger by `deriveCoverage`. The
 * runner never sets `complete`; it only records what happened. A model has no
 * way to influence it.
 */

import {
  buildAnalysisUnits,
  codePointLength,
  UNIT_BUILDER_VERSION,
  type AnalysisUnit,
  type UnitSourceSpan,
} from "./units.js";
import {
  EXTRACTOR_VERSION,
  extractPropositions,
  quoteSha256,
  type PropositionDraft,
} from "./observations.js";
import {
  detectRelations,
  type ComparableObservation,
  type RelationVerdict,
} from "./contradictions.js";
import {
  deriveCoverage,
  emptyTally,
  type CoverageGap,
  type CoverageTally,
  type ProcessingCoverage,
} from "./processingCoverage.js";

/** One file of the selected scope, as the runner needs it. */
export interface ScopedDocument {
  readonly fileId: string;
  readonly fileName: string;
  readonly documentVersionId: string;
  readonly canonicalText: string;
  readonly spans: readonly UnitSourceSpan[];
  /** Physical/structural locators, for coverage and citation. */
  readonly segments: readonly ScopedSegment[];
  /** Set when the file could not be read at all. */
  readonly extractionFailed?: boolean | undefined;
}

export interface ScopedSegment {
  readonly locatorKind: string;
  readonly locatorLabel: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly extractionMethod: string;
  readonly extractionStatus: "EXTRACTED" | "SPARSE" | "UNREADABLE";
}

/** A stored observation, ready to persist. */
export interface ObservationRow {
  readonly unitNo: number;
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly kind: "proposition";
  readonly propositionKind: PropositionDraft["kind"];
  readonly statement: string;
  readonly subject: string;
  readonly predicate: string;
  readonly normalizedValue: string;
  readonly occurredOn?: string | undefined;
  readonly datePrecision?: string | undefined;
  /** Offsets rebased onto the document version's canonical text. */
  readonly startChar: number;
  readonly endChar: number;
  readonly quote: string;
  readonly quoteSha256: string;
  readonly locator?: string | undefined;
  readonly extractorVersion: string;
}

export interface UnitLedgerRow {
  readonly unitNo: number;
  readonly fileId: string;
  readonly documentVersionId: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly sourceSha256: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  attempts: number;
  skipReason?: CoverageGap["reason"] | undefined;
  error?: string | undefined;
  extractorVersion?: string | undefined;
}

/**
 * The resumption key: position AND content.
 *
 * Exported so the store builds the map the runner reads with the same
 * function — a reuse key computed two different ways is a reuse key that
 * eventually disagrees with itself.
 */
export function reuseKey(unitNo: number, sourceSha256: string): string {
  return `${unitNo}:${sourceSha256}`;
}

export interface ExhaustiveRunResult {
  readonly units: readonly UnitLedgerRow[];
  readonly observations: readonly ObservationRow[];
  readonly relations: readonly RelationVerdict[];
  readonly coverage: ProcessingCoverage;
}

export interface RunOptions {
  /**
   * Completed ledger rows from a previous run of the SAME scope, keyed by
   * `reuseKey(unitNo, sourceSha256)`.
   *
   * BOTH halves of that key are load-bearing. The hash alone is not enough:
   * a long file legitimately contains two units with byte-identical text
   * (a repeated boilerplate paragraph), and keying on the hash alone would
   * mark the second one done without ever emitting its observations — it
   * would be silently dropped from the census while coverage still counted
   * it as read. The unit number pins the POSITION, the hash pins the
   * CONTENT, and a unit is reused only when both match.
   */
  readonly reusable?: ReadonlyMap<string, { extractorVersion: string }>;
  /** Stop after this many units (cancellation / budget). */
  readonly maxUnits?: number;
  readonly onProgress?: (done: number, total: number) => void;
  /** Injectable so a test can make one specific unit fail. */
  readonly extract?: (unit: AnalysisUnit) => PropositionDraft[];
}

/**
 * Build the census for a scope. Pure and deterministic: same documents in,
 * same units out, in the same order.
 */
export function planUnits(documents: readonly ScopedDocument[]): AnalysisUnit[] {
  const units: AnalysisUnit[] = [];
  // Files in a stable order, so unit numbers do not depend on map iteration.
  const ordered = [...documents].sort((a, b) => a.fileId.localeCompare(b.fileId));
  for (const document of ordered) {
    if (document.extractionFailed === true) continue;
    for (const unit of buildAnalysisUnits({
      documentVersionId: document.documentVersionId,
      fileId: document.fileId,
      canonicalText: document.canonicalText,
      spans: document.spans,
    })) {
      units.push({ ...unit, unitNo: units.length + 1 });
    }
  }
  return units;
}

/** Lawyer-facing word per locator kind; mirrors ingestion/locators.py. */
const LOCATOR_WORDS: Record<string, string> = {
  page: "s.",
  paragraph: "par.",
  block: "bölüm",
  section: "kısım",
};

/** The locator a canonical range falls in, or undefined. */
export function locatorFor(
  segments: readonly ScopedSegment[],
  startChar: number,
  endChar: number,
): string | undefined {
  const touched = segments.filter(
    (segment) =>
      segment.endChar > segment.startChar &&
      segment.startChar < endChar &&
      segment.endChar > startChar,
  );
  if (touched.length === 0) return undefined;
  // The SAME vocabulary as ingestion/locators.py::format_locator. Collapsing
  // every non-page kind to "par." cited a flat text file as "paragraph 1",
  // a unit that file does not have — and made the two runtimes render the
  // same stored row differently.
  const word = LOCATOR_WORDS[touched[0]!.locatorKind] ?? "";
  const first = touched[0]!.locatorLabel;
  const last = touched[touched.length - 1]!.locatorLabel;
  return first === last ? `${word} ${first}` : `${word} ${first}-${last}`;
}

/**
 * MAP: read every unit, emit structured observations.
 *
 * A unit that throws is recorded as `failed` and the run CONTINUES — one bad
 * unit must not cost the other 1 199 — but the failure is counted, so
 * coverage cannot come out complete.
 */
export function runMap(
  units: readonly AnalysisUnit[],
  documents: readonly ScopedDocument[],
  options: RunOptions = {},
): { ledger: UnitLedgerRow[]; observations: ObservationRow[] } {
  const segmentsByFile = new Map<string, readonly ScopedSegment[]>();
  for (const document of documents) segmentsByFile.set(document.fileId, document.segments);

  const extract = options.extract ?? ((unit: AnalysisUnit) => extractPropositions(unit.text));
  const ledger: UnitLedgerRow[] = [];
  const observations: ObservationRow[] = [];
  let processed = 0;

  for (const unit of units) {
    const row: UnitLedgerRow = {
      unitNo: unit.unitNo,
      fileId: unit.fileId,
      documentVersionId: unit.documentVersionId,
      startChar: unit.startChar,
      endChar: unit.endChar,
      sourceSha256: unit.sourceSha256,
      state: "pending",
      attempts: 0,
    };
    ledger.push(row);

    if (options.maxUnits !== undefined && processed >= options.maxUnits) {
      // Deliberately left `pending`: an interrupted run must look
      // interrupted, not finished.
      continue;
    }

    // Resumption: the SAME unit, with the same text, analysed by the same
    // extractor, is not re-read. A changed document has a different hash and
    // IS re-read.
    const reusable = options.reusable?.get(reuseKey(unit.unitNo, unit.sourceSha256));
    if (reusable !== undefined && reusable.extractorVersion === EXTRACTOR_VERSION) {
      row.state = "done";
      row.extractorVersion = EXTRACTOR_VERSION;
      processed += 1;
      options.onProgress?.(processed, units.length);
      continue;
    }

    row.state = "running";
    row.attempts += 1;
    try {
      const segments = segmentsByFile.get(unit.fileId) ?? [];
      for (const draft of extract(unit)) {
        // Rebase unit-local offsets onto the document version.
        const startChar = unit.startChar + draft.startChar;
        const endChar = unit.startChar + draft.endChar;
        observations.push({
          unitNo: unit.unitNo,
          fileId: unit.fileId,
          documentVersionId: unit.documentVersionId,
          kind: "proposition",
          propositionKind: draft.kind,
          statement: draft.statement,
          subject: draft.subject,
          predicate: draft.predicate,
          normalizedValue: draft.normalizedValue,
          occurredOn: draft.occurredOn,
          datePrecision: draft.datePrecision,
          startChar,
          endChar,
          quote: draft.quote,
          quoteSha256: quoteSha256(draft.quote),
          locator: locatorFor(segments, startChar, endChar),
          extractorVersion: EXTRACTOR_VERSION,
        });
      }
      row.state = "done";
      row.extractorVersion = EXTRACTOR_VERSION;
    } catch (error) {
      row.state = "failed";
      row.error = error instanceof Error ? error.message : "bilinmeyen hata";
    }
    processed += 1;
    options.onProgress?.(processed, units.length);
  }

  return { ledger, observations };
}

/**
 * AGGREGATE: compare observations across the WHOLE census.
 *
 * Deliberately takes persisted observations rather than model output: the
 * reduce stage must be reproducible from the ledger alone.
 */
export function runAggregate(
  observations: readonly ObservationRow[],
): RelationVerdict[] {
  const comparable: ComparableObservation[] = observations.map((row, index) => ({
    observationId: `${row.fileId}#${row.unitNo}#${index}`,
    kind: row.propositionKind,
    subject: row.subject,
    predicate: row.predicate,
    normalizedValue: row.normalizedValue,
    fileId: row.fileId,
    unitNo: row.unitNo,
    statement: row.statement,
    datePrecision: row.datePrecision,
  }));
  return detectRelations(comparable);
}

/**
 * REDUCE: count what happened. `complete` is derived here and nowhere else.
 */
export function runReduce(
  documents: readonly ScopedDocument[],
  ledger: readonly UnitLedgerRow[],
  observations: readonly ObservationRow[],
  relations: readonly RelationVerdict[],
): ExhaustiveRunResult {
  const tally: CoverageTally = emptyTally();
  const filesWithDoneUnits = new Set<string>();
  const filesWithProblems = new Set<string>();
  const unitsByFile = new Map<string, UnitLedgerRow[]>();
  for (const row of ledger) {
    const bucket = unitsByFile.get(row.fileId);
    if (bucket === undefined) unitsByFile.set(row.fileId, [row]);
    else bucket.push(row);
  }

  for (const row of ledger) {
    tally.analysisUnitsTotal += 1;
    if (row.state === "done") {
      tally.analysisUnitsProcessed += 1;
      filesWithDoneUnits.add(row.fileId);
    } else if (row.state === "failed") {
      tally.analysisUnitsFailed += 1;
      filesWithProblems.add(row.fileId);
      tally.gaps.push({
        fileId: row.fileId,
        locator: `bölüm ${row.unitNo}`,
        reason: "UNIT_FAILED",
      });
    } else if (row.state === "skipped") {
      filesWithProblems.add(row.fileId);
      tally.gaps.push({
        fileId: row.fileId,
        locator: `bölüm ${row.unitNo}`,
        reason: row.skipReason ?? "EXCLUDED_BY_REQUEST",
      });
    } else {
      // pending/running when the run stopped: NOT processed.
      filesWithProblems.add(row.fileId);
      tally.gaps.push({
        fileId: row.fileId,
        locator: `bölüm ${row.unitNo}`,
        reason: "UNIT_FAILED",
      });
    }
  }

  for (const document of documents) {
    tally.filesTotal += 1;
    if (document.extractionFailed === true) {
      tally.filesFailed += 1;
      tally.gaps.push({
        fileId: document.fileId,
        fileName: document.fileName,
        locator: "belge",
        reason: "FILE_EXTRACTION_FAILED",
      });
      continue;
    }
    // A file in scope that produced NO unit at all (no chunks) is not
    // "read" — and without naming it, coverage would be incomplete with
    // nothing saying which file or why.
    const units = unitsByFile.get(document.fileId) ?? [];
    if (units.length === 0) {
      tally.gaps.push({
        fileId: document.fileId,
        fileName: document.fileName,
        locator: "belge",
        reason: "NO_ANALYSIS_UNITS",
      });
    } else if (
      filesWithDoneUnits.has(document.fileId) &&
      !filesWithProblems.has(document.fileId)
    ) {
      tally.filesProcessed += 1;
    }

    // Canonical text that lies OUTSIDE every unit was never read. Chunkers
    // do not necessarily tile the text — a heading before the first article
    // belongs to no chunk — so without this check `complete` could be true
    // over a document whose opening nobody looked at.
    const uncovered = uncoveredCodePoints(document, units);
    if (uncovered > UNCOVERED_TEXT_TOLERANCE) {
      tally.gaps.push({
        fileId: document.fileId,
        fileName: document.fileName,
        locator: `${uncovered} karakter`,
        reason: "TEXT_OUTSIDE_UNITS",
      });
    }
    // A document with NO source map cannot say which of its pages were read.
    // Documents ingested before the map existed are in this state, and
    // saying nothing would let them contribute "0 of 0 pages unreadable" and
    // sail through the page test — a review of un-mapped files claiming
    // complete coverage is exactly the lie this module exists to prevent.
    if (document.segments.length === 0) {
      tally.gaps.push({
        fileId: document.fileId,
        fileName: document.fileName,
        locator: "belge",
        reason: "NO_SOURCE_MAP",
      });
    }

    for (const segment of document.segments) {
      if (segment.locatorKind !== "page") continue;
      tally.pagesTotal += 1;
      if (segment.extractionStatus === "UNREADABLE") {
        tally.pagesUnreadable += 1;
        tally.gaps.push({
          fileId: document.fileId,
          fileName: document.fileName,
          locator: `s. ${segment.locatorLabel}`,
          reason: "UNREADABLE_NO_TEXT",
        });
      } else if (segment.extractionMethod === "ocr") {
        tally.pagesOcr += 1;
      } else {
        tally.pagesTextLayer += 1;
        // SPARSE is the extractor's own verdict that the page carried so
        // little text it was probably an image with a header. It is counted
        // as read (its text IS in the canonical text) but never as
        // VERIFIED, so it blocks an exhaustive claim.
        if (segment.extractionStatus === "SPARSE") {
          tally.gaps.push({
            fileId: document.fileId,
            fileName: document.fileName,
            locator: `s. ${segment.locatorLabel}`,
            reason: "SPARSE_PAGE",
          });
        }
      }
    }
  }

  return {
    units: ledger,
    observations,
    relations,
    coverage: deriveCoverage(tally),
  };
}

/**
 * Code points of a document that no analysis unit covers.
 *
 * Counted as (canonical length) minus (the union of unit spans). Units are
 * ordered and non-overlapping by construction, so the union is a simple sum.
 */
function uncoveredCodePoints(
  document: ScopedDocument,
  units: readonly UnitLedgerRow[],
): number {
  const total = codePointLength(document.canonicalText);
  if (total === 0) return 0;
  let covered = 0;
  for (const unit of units) covered += Math.max(0, unit.endChar - unit.startChar);
  return Math.max(0, total - covered);
}

/**
 * How much uncovered text is ignorable.
 *
 * Chunkers trim whitespace at block boundaries, so a handful of code points
 * outside every chunk is an artefact of trimming rather than unread content.
 * Anything larger is real text nobody looked at and is reported. The number
 * is a chosen tolerance, not a measured optimum.
 */
export const UNCOVERED_TEXT_TOLERANCE = 200;

/** Convenience: the whole pipeline in one call. */
export function runExhaustiveAnalysis(
  documents: readonly ScopedDocument[],
  options: RunOptions = {},
): ExhaustiveRunResult {
  const units = planUnits(documents);
  const { ledger, observations } = runMap(units, documents, options);
  const relations = runAggregate(observations);
  return runReduce(documents, ledger, observations, relations);
}

export { UNIT_BUILDER_VERSION, EXTRACTOR_VERSION };
