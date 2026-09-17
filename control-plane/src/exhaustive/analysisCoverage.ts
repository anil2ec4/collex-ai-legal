/**
 * Analytical coverage (W21): what was EXTRACTED and what was ANALYSED.
 *
 * `processingCoverage.ts` answers one question and keeps answering only it:
 * "did the system read the selected source scope?" W20 made that answer
 * honest. It is necessary and it is not sufficient — a run can read 928/928
 * pages and still have weighed 25 of 70 claims. So there are three separate
 * contracts, and none of them is allowed to stand in for another:
 *
 *   source        processingCoverage (W19/W20) — pages and units read.
 *   extraction    this file — of the units that needed structured
 *                 (model-assisted) extraction, how many produced a complete,
 *                 fully verified extraction; how many items could not be
 *                 grounded in the source; how many responses were cut.
 *   intelligence  this file — of the claims, defenses, evidence comparisons,
 *                 contradiction batches and synthesis groups the analysis
 *                 required, how many reached a terminal, successful state.
 *
 * Each `complete` is DERIVED from counts, in exactly one function, like
 * `deriveCoverage`. `sourceProcessingCoverage.complete === true` together
 * with `intelligenceCoverage.complete === false` is a valid and expected
 * state, and `deriveAnalysisCompleteness` is the only place that may combine
 * the three into the one sentence a lawyer reads.
 */

import type { ProcessingCoverage } from "./processingCoverage.js";
import type { StageKind, StageTaskRow } from "./stageTypes.js";
import { TASK_SPECS, type AnalysisTask } from "./tasks.js";

// ---------------------------------------------------------------------------
// Extraction coverage
// ---------------------------------------------------------------------------

export type UnitExtractionState = "not_required" | "succeeded" | "incomplete" | "failed";

/** What the ledger knows about one unit's extraction. */
export interface UnitExtractionRow {
  readonly unitNo: number;
  readonly fileId: string;
  readonly state: "pending" | "running" | "done" | "failed" | "skipped";
  readonly extractionState: UnitExtractionState | null;
  readonly generatedItems: number;
  readonly acceptedItems: number;
  /** Items that did not match the strict schema. */
  readonly invalidItems: number;
  /** Items whose quote does not occur in the unit text. */
  readonly rejectedQuotes: number;
  /** Items whose quote occurs more than once, so its place is unknown. */
  readonly ambiguousQuotes: number;
  /** Responses cut at the per-call item limit and not recovered. */
  readonly truncatedResponses: number;
  readonly continuationPasses: number;
  readonly repairPasses: number;
}

export interface ExtractionCoverage {
  /** The task needs structured (model-assisted) extraction at all. */
  readonly required: boolean;
  readonly unitsRequiringStructuredExtraction: number;
  readonly unitsExtractionAttempted: number;
  readonly unitsExtractionSucceeded: number;
  /** Read, but part of the extraction could not be verified or was cut. */
  readonly unitsExtractionIncomplete: number;
  readonly unitsExtractionFailed: number;
  /** Not yet attempted (the run is still reading, or stopped). */
  readonly unitsExtractionPending: number;
  readonly generatedItems: number;
  readonly acceptedGroundedItems: number;
  readonly malformedItems: number;
  readonly rejectedQuotes: number;
  readonly ambiguousQuotes: number;
  readonly truncatedResponses: number;
  readonly continuationPasses: number;
  readonly repairPasses: number;
  /** Derived. */
  readonly complete: boolean;
  /** Plain Turkish, one line per reason `complete` is false. */
  readonly gapsTr: readonly string[];
}

/**
 * Derive extraction coverage from the unit ledger.
 *
 * For a task without structured extraction (the deterministic tasks), the
 * only extraction is the rule-based value extraction every READ unit gets,
 * so extraction is complete exactly when every unit was read.
 *
 * For a model task, a unit counts as SUCCEEDED only when it was read, its
 * extraction was attempted, nothing was truncated, and every item the model
 * proposed was either grounded in the source or recovered by a repair pass.
 * An item the model saw but the application could not ground is a finding
 * that is not in the analysis, and the coverage says so.
 */
export function deriveExtractionCoverage(
  rows: readonly UnitExtractionRow[],
  required: boolean,
  /** The run ended (failed or cancelled): nothing is "not yet" done any more. */
  terminal = false,
): ExtractionCoverage {
  const sum = (pick: (row: UnitExtractionRow) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  const gapsTr: string[] = [];

  if (!required) {
    const read = rows.filter((row) => row.state === "done").length;
    const complete = rows.length > 0 && read === rows.length;
    if (!complete) {
      gapsTr.push(
        rows.length === 0
          ? "İncelenecek bölüm yok."
          : `${rows.length - read} bölümden tarih, tutar ve oran çıkarılamadı (bölüm okunmadı).`,
      );
    }
    return {
      required: false,
      unitsRequiringStructuredExtraction: 0,
      unitsExtractionAttempted: 0,
      unitsExtractionSucceeded: 0,
      unitsExtractionIncomplete: 0,
      unitsExtractionFailed: 0,
      unitsExtractionPending: 0,
      generatedItems: 0,
      acceptedGroundedItems: 0,
      malformedItems: 0,
      rejectedQuotes: 0,
      ambiguousQuotes: 0,
      truncatedResponses: 0,
      continuationPasses: 0,
      repairPasses: 0,
      complete,
      gapsTr,
    };
  }

  let succeeded = 0;
  let incomplete = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows) {
    if (row.state === "failed") failed += 1;
    else if (row.state === "done") {
      // A W20-era unit has no extraction record: it is not evidence of a
      // complete extraction, so it is counted as incomplete, never as
      // succeeded.
      if (row.extractionState === "succeeded") succeeded += 1;
      else if (row.extractionState === "failed") failed += 1;
      else incomplete += 1;
    } else if (row.state === "skipped") failed += 1;
    else pending += 1;
  }

  const coverage = {
    required: true,
    unitsRequiringStructuredExtraction: rows.length,
    unitsExtractionAttempted: succeeded + incomplete + failed,
    unitsExtractionSucceeded: succeeded,
    unitsExtractionIncomplete: incomplete,
    unitsExtractionFailed: failed,
    unitsExtractionPending: pending,
    generatedItems: sum((row) => row.generatedItems),
    acceptedGroundedItems: sum((row) => row.acceptedItems),
    malformedItems: sum((row) => row.invalidItems),
    rejectedQuotes: sum((row) => row.rejectedQuotes),
    ambiguousQuotes: sum((row) => row.ambiguousQuotes),
    truncatedResponses: sum((row) => row.truncatedResponses),
    continuationPasses: sum((row) => row.continuationPasses),
    repairPasses: sum((row) => row.repairPasses),
  };

  if (rows.length === 0) gapsTr.push("İncelenecek bölüm yok.");
  if (pending > 0) {
    gapsTr.push(
      terminal
        ? `${pending} bölümün çıkarımı yapılmadı (inceleme durduruldu ya da tamamlanamadı).`
        : `${pending} bölümün çıkarımı henüz yapılmadı.`,
    );
  }
  if (failed > 0) gapsTr.push(`${failed} bölümün çıkarımı yapılamadı.`);
  if (incomplete > 0) gapsTr.push(`${incomplete} bölümün çıkarımı yarım kaldı.`);
  if (coverage.rejectedQuotes > 0) {
    gapsTr.push(`${coverage.rejectedQuotes} tespitin alıntısı belgede bulunamadı; bu tespitler kullanılmadı.`);
  }
  if (coverage.ambiguousQuotes > 0) {
    gapsTr.push(
      `${coverage.ambiguousQuotes} tespitin alıntısı belgede birden fazla yerde geçtiği için yeri` +
        " belirlenemedi; bu tespitler kullanılmadı.",
    );
  }
  if (coverage.malformedItems > 0) {
    gapsTr.push(`${coverage.malformedItems} tespit beklenen biçimde değildi; kullanılmadı.`);
  }
  if (coverage.truncatedResponses > 0) {
    gapsTr.push(`${coverage.truncatedResponses} yanıt tek seferde okunabilecek sınırı aştı ve tamamlanamadı.`);
  }

  const complete =
    rows.length > 0 &&
    succeeded === rows.length &&
    coverage.truncatedResponses === 0 &&
    coverage.rejectedQuotes === 0 &&
    coverage.ambiguousQuotes === 0 &&
    coverage.malformedItems === 0;
  return { ...coverage, complete, gapsTr };
}

// ---------------------------------------------------------------------------
// Intelligence coverage
// ---------------------------------------------------------------------------

export type IntelligenceStage =
  | "deterministic_relations"
  | "claim_weighing"
  | "defense_weighing"
  | "semantic_contradictions"
  | "synthesis";

export type SemanticLaneState = "PERFORMED" | "NOT_REQUIRED" | "NOT_AVAILABLE";

export interface IntelligenceCoverage {
  readonly requiredStages: readonly IntelligenceStage[];
  readonly claimsTotal: number;
  readonly claimsWeighed: number;
  readonly claimsFailed: number;
  readonly claimsPending: number;
  /** Every batch ran, but some candidates got no answer. */
  readonly claimsUnresolved: number;
  readonly defensesTotal: number;
  readonly defensesWeighed: number;
  readonly defensesFailed: number;
  readonly defensesPending: number;
  readonly defensesUnresolved: number;
  readonly evidenceItemsTotal: number;
  /** Claim-or-defense × candidate comparisons planned and completed. */
  readonly evidenceCandidateAnalysesPlanned: number;
  readonly evidenceCandidateAnalysesCompleted: number;
  /** Claims whose "no support" can be stated after a COMPLETE search. */
  readonly claimsWithCompleteSearch: number;
  readonly contradictionGroupsTotal: number;
  readonly contradictionGroupsProcessed: number;
  readonly contradictionPairsTotal: number;
  readonly contradictionPairsClassified: number;
  readonly semanticContradictionLane: SemanticLaneState;
  readonly synthesisGroupsTotal: number;
  readonly synthesisGroupsProcessed: number;
  readonly synthesisLevels: number;
  readonly unresolvedStages: readonly IntelligenceStage[];
  readonly failedStages: readonly IntelligenceStage[];
  readonly truncatedStages: readonly IntelligenceStage[];
  /**
   * Weighing task rows whose claim/defense ref names no current item (the
   * item keys are derived differently from when weighing was planned). They
   * count for no claim, and keep the weighing incomplete. Absent on
   * coverage stored before W21 review #11.
   */
  readonly unresolvableWeighRows?: number;
  /** The final assembly ran and its result is stored. */
  readonly finalized: boolean;
  /** The run ended without finalizing (failed or cancelled). */
  readonly terminal?: boolean | undefined;
  /** Derived. */
  readonly complete: boolean;
  readonly gapsTr: readonly string[];
}

export interface IntelligenceCoverageInput {
  readonly task: AnalysisTask;
  readonly tasks: readonly StageTaskRow[];
  readonly claimsTotal: number;
  readonly defensesTotal: number;
  readonly evidenceItemsTotal: number;
  /** A model was available to the run's analytical stages. */
  readonly modelAvailable: boolean;
  readonly finalized: boolean;
  /**
   * The run ended without finalizing (failed or cancelled). Its gaps say what
   * was NOT done, never that it is "not yet" done (W21 round-two review).
   */
  readonly terminal?: boolean | undefined;
  /**
   * Weighing comparisons whose candidate the finalizer could not resolve
   * (stageFinalize.ts). They were stored as judged but cannot be read as
   * such by this code, so the weighing is NOT complete while any exist.
   */
  readonly unresolvedVerdictRefs?: number | undefined;
  /**
   * The refs of the claims and defenses the run holds NOW (itemRef). When
   * given, a weighing row counts only for a claim it still names: a row
   * whose claimRef resolves to no current item is unresolvable, never a
   * weighed claim (W21 review #11). The live view, which has no items yet,
   * omits them and is never complete anyway (not finalized).
   */
  readonly claimRefs?: readonly string[] | undefined;
  readonly defenseRefs?: readonly string[] | undefined;
}

const WEIGH_STAGES: readonly StageKind[] = ["weigh_claim", "weigh_defense"];

/** The analytical stages a task requires (given what the run could use). */
export function requiredIntelligenceStages(
  task: AnalysisTask,
  counts: { claimsTotal: number; defensesTotal: number },
): IntelligenceStage[] {
  const stages: IntelligenceStage[] = ["deterministic_relations"];
  if (!TASK_SPECS[task].requiresModel) return stages;
  if (counts.claimsTotal > 0) stages.push("claim_weighing");
  if (counts.defensesTotal > 0) stages.push("defense_weighing");
  if (task === "full_review" || task === "red_team") {
    stages.push("semantic_contradictions", "synthesis");
  }
  return stages;
}

function hasPlan(tasks: readonly StageTaskRow[], step: string): boolean {
  return tasks.some((row) => row.stage === "plan" && row.taskKey === step && row.state === "done");
}

/**
 * Per claim: done when EVERY batch of it is done. With `current`, only rows
 * naming a claim the run still holds count; the others are unresolvable.
 */
function weighTally(tasks: readonly StageTaskRow[], stage: StageKind, current?: readonly string[] | undefined) {
  const known = current === undefined ? undefined : new Set(current);
  const byClaim = new Map<string, StageTaskRow[]>();
  let unresolvableRows = 0;
  for (const row of tasks) {
    if (row.stage !== stage) continue;
    const claimRef = String(row.input["claimRef"] ?? row.taskKey);
    if (known !== undefined && !known.has(claimRef)) {
      unresolvableRows += 1;
      continue;
    }
    const bucket = byClaim.get(claimRef);
    if (bucket === undefined) byClaim.set(claimRef, [row]);
    else bucket.push(row);
  }
  let weighed = 0;
  let failed = 0;
  let pending = 0;
  let unresolved = 0;
  let planned = 0;
  let completed = 0;
  let completeSearch = 0;
  for (const rows of byClaim.values()) {
    let unanswered = 0;
    for (const row of rows) {
      const candidates = Array.isArray(row.input["candidates"]) ? (row.input["candidates"] as unknown[]).length : 0;
      planned += candidates;
      if (row.state === "done") {
        const skipped = Math.min(candidates, Math.max(0, Number(row.result?.["unanswered"] ?? 0)));
        unanswered += skipped;
        completed += candidates - skipped;
      }
    }
    if (rows.every((row) => row.state === "done")) {
      // Every batch finished, but a candidate the model did not answer was
      // never compared: the claim is UNRESOLVED, not weighed.
      if (unanswered > 0) unresolved += 1;
      else {
        weighed += 1;
        if (rows.every((row) => row.input["candidateSetComplete"] === true)) completeSearch += 1;
      }
    } else if (rows.some((row) => row.state === "failed" || row.state === "excluded")) failed += 1;
    else pending += 1;
  }
  return { claims: byClaim.size, weighed, failed, pending, unresolved, planned, completed, completeSearch, unresolvableRows };
}

/**
 * Derive intelligence coverage from the stored task rows.
 *
 * A claim is WEIGHED only when every one of its candidate batches finished.
 * A claim that was extracted but never got a task counts as pending, so a
 * planner that forgot a claim cannot produce a complete coverage.
 */
export function deriveIntelligenceCoverage(input: IntelligenceCoverageInput): IntelligenceCoverage {
  const { tasks } = input;
  const required = requiredIntelligenceStages(input.task, input);
  const unresolved = new Set<IntelligenceStage>();
  const failedStages = new Set<IntelligenceStage>();
  const truncated = new Set<IntelligenceStage>();
  const gapsTr: string[] = [];

  const claims = weighTally(tasks, "weigh_claim", input.claimRefs);
  const defenses = weighTally(tasks, "weigh_defense", input.defenseRefs);
  // Claims the planner never gave a task are not weighed.
  const claimsWeighed = claims.weighed;
  const claimsFailed = claims.failed;
  const claimsPending = Math.max(0, input.claimsTotal - claims.weighed - claims.failed - claims.unresolved);
  const defensesWeighed = defenses.weighed;
  const defensesFailed = defenses.failed;
  const defensesPending = Math.max(0, input.defensesTotal - defenses.weighed - defenses.failed - defenses.unresolved);

  if (required.includes("claim_weighing")) {
    if (claimsFailed > 0) failedStages.add("claim_weighing");
    if (claimsPending > 0 || !hasPlan(tasks, "weigh")) unresolved.add("claim_weighing");
    if (claimsWeighed < input.claimsTotal) {
      gapsTr.push(`${input.claimsTotal} iddianın ${claimsWeighed} tanesi delillerle karşılaştırıldı.`);
    }
  }
  if (required.includes("defense_weighing")) {
    if (defensesFailed > 0) failedStages.add("defense_weighing");
    if (defensesPending > 0 || !hasPlan(tasks, "weigh")) unresolved.add("defense_weighing");
    if (defensesWeighed < input.defensesTotal) {
      gapsTr.push(`${input.defensesTotal} savunmanın ${defensesWeighed} tanesi delillerle karşılaştırıldı.`);
    }
  }

  const contradictionRows = tasks.filter((row) => row.stage === "contradiction_group");
  const pairsOf = (row: StageTaskRow): number =>
    Array.isArray(row.input["pairs"]) ? (row.input["pairs"] as unknown[]).length : 0;
  const contradictionPairsTotal = contradictionRows.reduce((total, row) => total + pairsOf(row), 0);
  const contradictionPairsClassified = contradictionRows
    .filter((row) => row.state === "done")
    .reduce((total, row) => total + pairsOf(row), 0);
  const contradictionDone = contradictionRows.filter((row) => row.state === "done").length;
  let semanticLane: SemanticLaneState = "NOT_REQUIRED";
  if (required.includes("semantic_contradictions")) {
    semanticLane = input.modelAvailable ? "PERFORMED" : "NOT_AVAILABLE";
    if (!hasPlan(tasks, "contradictions")) unresolved.add("semantic_contradictions");
    if (contradictionRows.some((row) => row.state === "failed" || row.state === "excluded")) {
      failedStages.add("semantic_contradictions");
    }
    if (contradictionRows.some((row) => row.state === "pending" || row.state === "running")) {
      unresolved.add("semantic_contradictions");
    }
    if (contradictionRows.some((row) => Number(row.result?.["unanswered"] ?? 0) > 0)) {
      truncated.add("semantic_contradictions");
      const sum = (field: string): number =>
        contradictionRows.reduce((total, row) => total + Math.max(0, Number(row.result?.[field] ?? 0)), 0);
      const withoutQuote = sum("withoutQuote");
      if (sum("unanswered") > withoutQuote) {
        gapsTr.push("Serbest metin çelişki karşılaştırmalarının bir kısmına yanıt alınamadı.");
      }
      if (withoutQuote > 0) {
        gapsTr.push(
          `${withoutQuote} serbest metin karşılaştırmasında doğrulanmış alıntı bulunmadığı için` +
            " ifadeler karşılaştırılmadı.",
        );
      }
    }
    if (contradictionDone < contradictionRows.length) {
      gapsTr.push(
        `${contradictionRows.length} serbest metin karşılaştırma grubunun ${contradictionDone} tanesi tamamlandı.`,
      );
    }
  }

  const synthesisRows = tasks.filter(
    (row) => row.stage === "synthesis_group" || row.stage === "synthesis_reduce",
  );
  const synthesisDone = synthesisRows.filter((row) => row.state === "done").length;
  const synthesisLevels = synthesisRows.reduce((max, row) => Math.max(max, row.level), 0);
  if (required.includes("synthesis")) {
    // A run with no finding to synthesize has nothing to summarize: its plan
    // marker records that, and it is not an unfinished synthesis.
    const nothingToSynthesize = tasks.some(
      (row) =>
        row.stage === "plan" &&
        row.taskKey === "synthesis:1" &&
        row.state === "done" &&
        (row.result?.["details"] as Record<string, unknown> | undefined)?.["empty"] === true,
    );
    const finalDone =
      nothingToSynthesize || synthesisRows.some((row) => row.input["final"] === true && row.state === "done");
    if (!finalDone) unresolved.add("synthesis");
    if (synthesisRows.some((row) => row.state === "failed" || row.state === "excluded")) {
      failedStages.add("synthesis");
    }
    if (synthesisRows.some((row) => row.result?.["truncated"] === true)) {
      truncated.add("synthesis");
      gapsTr.push("Sentez aşamasında bir yanıt tek seferde kabul edilen sınırı aştı.");
    }
    if (synthesisDone < synthesisRows.length || !finalDone) {
      gapsTr.push(
        `${synthesisRows.length} sentez grubunun ${synthesisDone} tanesi tamamlandı` +
          (finalDone ? "." : input.terminal === true ? "; genel değerlendirme yapılmadı." : "; genel değerlendirme henüz yapılmadı."),
      );
    }
  }
  if (claims.unresolved + defenses.unresolved > 0) {
    if (claims.unresolved > 0) truncated.add("claim_weighing");
    if (defenses.unresolved > 0) truncated.add("defense_weighing");
    gapsTr.push(
      `${claims.unresolved + defenses.unresolved} iddia/savunmanın bazı aday delillerine yanıt alınamadı;` +
        " karşılaştırması eksik kaldı.",
    );
  }
  if (claims.failed + defenses.failed > 0) {
    gapsTr.push(`${claims.failed + defenses.failed} iddia/savunmanın karşılaştırması başarısız oldu.`);
  }
  const unresolvableWeighRows = claims.unresolvableRows + defenses.unresolvableRows;
  if (unresolvableWeighRows > 0) {
    if (claims.unresolvableRows > 0) truncated.add("claim_weighing");
    if (defenses.unresolvableRows > 0) truncated.add("defense_weighing");
    gapsTr.push(
      `${unresolvableWeighRows} delil karşılaştırma görevinin ait olduğu iddia/savunma artık dosyadaki` +
        " bir bulguya eşlenemiyor; bu karşılaştırmalar hiçbir iddia için sayılmadı.",
    );
  }
  const unresolvedRefs = input.unresolvedVerdictRefs ?? 0;
  if (unresolvedRefs > 0) {
    if (required.includes("claim_weighing")) truncated.add("claim_weighing");
    if (required.includes("defense_weighing")) truncated.add("defense_weighing");
    gapsTr.push(
      `${unresolvedRefs} delil karşılaştırmasının sonucu artık dosyadaki bir bulguya eşlenemiyor;` +
        " ilgili iddia/savunmaların karşılaştırması eksik sayıldı.",
    );
  }

  if (!input.finalized) {
    unresolved.add("deterministic_relations");
    gapsTr.push(
      input.terminal === true
        ? "Analiz aşamaları tamamlanmadı (inceleme durduruldu ya da tamamlanamadı)."
        : "Analiz aşamaları henüz bitmedi.",
    );
  }

  const everyWeighed =
    claimsWeighed === input.claimsTotal && defensesWeighed === input.defensesTotal;
  const complete =
    input.finalized &&
    unresolved.size === 0 &&
    failedStages.size === 0 &&
    truncated.size === 0 &&
    (!required.includes("claim_weighing") && !required.includes("defense_weighing") ? true : everyWeighed) &&
    (!required.includes("semantic_contradictions") || contradictionDone === contradictionRows.length) &&
    (!required.includes("synthesis") || synthesisDone === synthesisRows.length);

  return {
    requiredStages: required,
    claimsTotal: input.claimsTotal,
    claimsWeighed,
    claimsFailed,
    claimsPending,
    claimsUnresolved: claims.unresolved,
    defensesTotal: input.defensesTotal,
    defensesWeighed,
    defensesFailed,
    defensesPending,
    defensesUnresolved: defenses.unresolved,
    evidenceItemsTotal: input.evidenceItemsTotal,
    evidenceCandidateAnalysesPlanned: claims.planned + defenses.planned,
    evidenceCandidateAnalysesCompleted: claims.completed + defenses.completed,
    claimsWithCompleteSearch: claims.completeSearch + defenses.completeSearch,
    contradictionGroupsTotal: contradictionRows.length,
    contradictionGroupsProcessed: contradictionDone,
    contradictionPairsTotal,
    contradictionPairsClassified,
    semanticContradictionLane: semanticLane,
    synthesisGroupsTotal: synthesisRows.length,
    synthesisGroupsProcessed: synthesisDone,
    synthesisLevels,
    unresolvedStages: [...unresolved],
    failedStages: [...failedStages],
    truncatedStages: [...truncated],
    unresolvableWeighRows,
    finalized: input.finalized,
    ...(input.terminal === true ? { terminal: true } : {}),
    complete,
    gapsTr,
  };
}

// ---------------------------------------------------------------------------
// The one combined statement
// ---------------------------------------------------------------------------

export type AnalysisState = "COMPLETE" | "INCOMPLETE" | "IN_PROGRESS";

export interface AnalysisCompleteness {
  readonly state: AnalysisState;
  readonly sourceComplete: boolean;
  readonly extractionComplete: boolean;
  readonly intelligenceComplete: boolean;
  /** All three. The ONLY flag that may license "the analysis is complete". */
  readonly complete: boolean;
  readonly headlineTr: string;
  readonly sectionsTr: { readonly source: string; readonly extraction: string; readonly analysis: string };
  /** Why a whole-analysis-complete claim is not permitted; null when it is. */
  readonly refusedBecause: string | null;
}

function sourceLine(coverage: ProcessingCoverage): string {
  const pages =
    coverage.pagesTotal > 0 ? `${coverage.pagesProcessed} / ${coverage.pagesTotal} sayfa işlendi` : "sayfa bilgisi yok";
  const units = `${coverage.analysisUnitsProcessed} / ${coverage.analysisUnitsTotal} bölüm okundu`;
  const unreadable = coverage.pagesUnreadable > 0 ? `; ${coverage.pagesUnreadable} sayfa okunamadı` : "";
  return `${pages}; ${units}${unreadable}.`;
}

function extractionLine(extraction: ExtractionCoverage): string {
  if (!extraction.required) {
    // Scoped: the rules read the formats they recognise; a value written
    // another way is neither read nor compared (W21 closing re-check).
    return "Model destekli çıkarım gerekmiyor; tanınan biçimlerde yazılmış tarih, tutar ve oranlar kurallı olarak çıkarıldı.";
  }
  const unverifiable = extraction.rejectedQuotes + extraction.ambiguousQuotes;
  return (
    `${extraction.unitsExtractionSucceeded} / ${extraction.unitsRequiringStructuredExtraction}` +
    ` bölümün çıkarımı eksiksiz tamamlandı; ${unverifiable} doğrulanamayan kaynak alıntısı.`
  );
}

function analysisLine(intelligence: IntelligenceCoverage): string {
  const parts: string[] = [];
  if (intelligence.requiredStages.includes("claim_weighing") || intelligence.claimsTotal > 0) {
    parts.push(`${intelligence.claimsWeighed} / ${intelligence.claimsTotal} iddia değerlendirildi`);
  }
  if (intelligence.requiredStages.includes("defense_weighing") || intelligence.defensesTotal > 0) {
    parts.push(`${intelligence.defensesWeighed} / ${intelligence.defensesTotal} savunma değerlendirildi`);
  }
  if (intelligence.evidenceCandidateAnalysesPlanned > 0) {
    parts.push(
      `${intelligence.evidenceCandidateAnalysesCompleted} / ${intelligence.evidenceCandidateAnalysesPlanned}` +
        " planlanan delil karşılaştırması tamamlandı",
    );
  }
  if (intelligence.requiredStages.includes("semantic_contradictions")) {
    parts.push(
      `${intelligence.contradictionGroupsProcessed} / ${intelligence.contradictionGroupsTotal}` +
        " serbest metin çelişki grubu incelendi",
    );
  }
  if (intelligence.requiredStages.includes("synthesis")) {
    parts.push(`${intelligence.synthesisGroupsProcessed} / ${intelligence.synthesisGroupsTotal} sentez grubu tamamlandı`);
  }
  if (parts.length === 0) {
    return intelligence.finalized
      ? "Belgeler arası karşılaştırma tamamlandı."
      : intelligence.terminal === true
        ? "Belgeler arası karşılaştırma tamamlanmadı."
        : "Belgeler arası karşılaştırma henüz bitmedi.";
  }
  return `${parts.join("; ")}.`;
}

/**
 * The single place the three layers are combined into what a lawyer reads.
 *
 * "Tamamlandı" for the whole task appears ONLY when source, extraction and
 * analysis are all complete. Every page read with the analysis unfinished
 * is said as exactly that: the pages were read, the analysis was not
 * finished.
 */
export function deriveAnalysisCompleteness(input: {
  readonly task: AnalysisTask;
  readonly source: ProcessingCoverage;
  readonly extraction: ExtractionCoverage;
  readonly intelligence: IntelligenceCoverage;
  readonly active: boolean;
}): AnalysisCompleteness {
  const title = TASK_SPECS[input.task].titleTr;
  const complete = input.source.complete && input.extraction.complete && input.intelligence.complete;
  const state: AnalysisState = complete ? "COMPLETE" : input.active ? "IN_PROGRESS" : "INCOMPLETE";
  let headlineTr: string;
  if (complete) {
    headlineTr =
      `"${title}" tamamlandı: seçilen belgelerin tamamı okundu, çıkarım ve analiz` +
      " aşamalarının hepsi bitti.";
  } else if (input.active) {
    headlineTr = `"${title}" sürüyor; sonuçlar tamamlanmadan dosyanın tamamı için bir şey söylenemez.`;
  } else if (input.source.complete) {
    headlineTr =
      "Dosyanın bütün sayfaları okundu, ancak inceleme tamamlanmadı; eksik kalan aşamalar aşağıda yazıyor.";
  } else {
    headlineTr = "Dosyanın tamamı okunmadı; bu sonuç bütün dosya için söylenemez.";
  }
  const reasons = [
    ...(input.source.complete ? [] : ["kaynakların tamamı okunmadı"]),
    ...(input.extraction.complete ? [] : ["çıkarım eksik kaldı"]),
    ...(input.intelligence.complete ? [] : ["analiz aşamaları tamamlanmadı"]),
  ];
  return {
    state,
    sourceComplete: input.source.complete,
    extractionComplete: input.extraction.complete,
    intelligenceComplete: input.intelligence.complete,
    complete,
    headlineTr,
    sectionsTr: {
      source: sourceLine(input.source),
      extraction: extractionLine(input.extraction),
      analysis: analysisLine(input.intelligence),
    },
    refusedBecause: complete ? null : `Tam inceleme söylenemez: ${reasons.join(", ")}.`,
  };
}

/** Stages whose tasks are weighing tasks (used by the planner and views). */
export function isWeighStage(stage: StageKind): boolean {
  return WEIGH_STAGES.includes(stage);
}
