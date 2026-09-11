/**
 * Contrary-authority query generation + coverage reporting (Lane B4; Master
 * Build Brief 10.2 "Her önemli sonuç için contrary-authority sorgusu zorunlu"
 * and 10.5 "Contrary-authority branch zorunlu ve testli").
 *
 * Two responsibilities:
 *  1. Deterministically build the contrary-authority search LANES for an issue.
 *     Each lane is one query that a Turkish lawyer would actually run to find
 *     authority pointing the other way — not the same query with a different
 *     label (see the lane table below);
 *  2. Build the contrary-coverage report over a recorded run: per material
 *     issue, did a contrary search actually run AND come back usable, and does
 *     the issue have recorded evidence at all. Uncovered issues are named
 *     explicitly with a typed reason, and failed provider lanes are listed so a
 *     provider outage is never a silent "no result" (brief 10.2).
 *
 * Retrieval note: the Bedesten/UYAP keyword engines AND the words they are
 * given. A contrary query is therefore always `<issue search term> + ONE exact
 * flip phrase`; piling five negation phrases into a single query would return
 * nothing at all. Breadth comes from having several lanes, not from one long
 * query.
 */

import type { CapabilityName } from "../capabilities/registry.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import type { RunState, Verifier } from "../orchestration/executor.js";
import { analyzeIntake, type ResearchIntake } from "./intake.js";
import {
  EVIDENCE_SEARCH_ROLES,
  JUDICIAL_SEARCH_ROLES,
  extractFailure,
  extractHits,
  parsePlannerNote,
  type StepRole,
} from "./outcomes.js";

// ---------------------------------------------------------------------------
// Contrary query generation
// ---------------------------------------------------------------------------

/**
 * The vocabulary of Turkish contrary authority. Each entry is an exact phrase
 * that appears in the decisions we want to surface:
 *
 *  - `aksi yönde`            explicit divergence marker used by the courts;
 *  - `bozma` / `bozulmasına` the judgment below was reversed;
 *  - `reddine`               the claim/application was rejected;
 *  - `karşı oy`              the dissent — the opposing view on the record;
 *  - `direnme`               the first-instance court insisted; goes to HGK/CGK;
 *  - `içtihadı birleştirme`  the decision that settles a split of authority;
 *  - `aleyhe`                against the party in question;
 *  - `kabul edilemez`        AYM individual application declared inadmissible.
 */
export const CONTRARY_VOCABULARY: readonly string[] = Object.freeze([
  "aksi yönde",
  "bozma",
  "bozulmasına",
  "reddine",
  "karşı oy",
  "direnme",
  "içtihadı birleştirme",
  "aleyhe",
  "kabul edilemez",
]);

/**
 * Generic outcome-flipping phrases, most specific first. Kept as a named export
 * because the answer layer quotes them when explaining what was searched.
 */
export const CONTRARY_PATTERNS: readonly string[] = Object.freeze([
  "aksi yönde",
  "reddine",
  "bozma",
]);

/** AYM norm-denetimi / bireysel-başvuru flavored flip phrases. */
export const AYM_CONTRARY_PATTERNS: readonly string[] = Object.freeze([
  "iptal isteminin reddi",
  "anayasaya aykırı olmadığı",
  "kabul edilemez",
]);

/** Divergence phrases: where the split of authority is recorded procedurally. */
export const DIVERGENCE_PATTERNS: readonly string[] = Object.freeze([
  "karşı oy",
  "direnme",
  "içtihadı birleştirme",
]);

/**
 * Opposite-term table (karşıt terim): keys in normalized tr-TR lowercase form;
 * when the issue's search term contains a key, the first opposite becomes the
 * flip phrase of the outcome lane. Values are the phrasings Turkish courts and
 * regulators actually use in the operative part of a negative decision.
 * Additive-only.
 *
 * ORDER MATTERS: the first matching key wins, so the specific institution
 * ("iş kazası", "itirazen şikayet") is listed before the generic remedy
 * ("tazminat", "iptal") it would otherwise be swallowed by.
 */
export const OPPOSITE_TERMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "işe iade": Object.freeze(["işe iade talebinin reddi", "feshin geçerli olduğu"]),
  "işçilik alacakları": Object.freeze(["alacak talebinin reddi", "ibranın geçerli olduğu"]),
  "dolandırıcılık": Object.freeze(["beraat", "unsurları oluşmadığından"]),
  "hakaret": Object.freeze(["eleştiri sınırları içinde", "suçun unsurları oluşmadığından"]),
  "iş kazası": Object.freeze(["işverenin kusuru bulunmadığı", "davanın reddine"]),
  "mobbing": Object.freeze(["mobbing iddiasının ispatlanamadığı"]),
  "tazminat": Object.freeze(["tazminat talebinin reddi", "istemin reddine"]),
  "nafaka": Object.freeze(["nafaka talebinin reddi", "nafakanın kaldırılması"]),
  "kira": Object.freeze(["tahliye talebinin reddi", "uyarlama talebinin reddi"]),
  "kamulaştırma": Object.freeze([
    "bedel tespiti talebinin reddi",
    "el atmanın önlenmesi talebinin reddi",
  ]),
  "boşanma": Object.freeze(["boşanma davasının reddine", "kusurun ispatlanamadığı"]),
  "velayet": Object.freeze(["velayetin değiştirilmesi talebinin reddi"]),
  "zamanaşımı": Object.freeze(["zamanaşımı itirazının reddi"]),
  "ihtiyati tedbir": Object.freeze(["ihtiyati tedbir talebinin reddi"]),
  "kişisel veri": Object.freeze(["ihlal bulunmadığı", "şikayetin reddine"]),
  "rekabet ihlali": Object.freeze([
    "ihlal bulunmadığı",
    "soruşturma açılmasına gerek olmadığı",
  ]),
  "itirazen şikayet": Object.freeze(["itirazen şikayet başvurusunun reddi"]),
  "iptal": Object.freeze(["iptal isteminin reddi"]),
});

/** Default outcome-flip phrase when the issue matches no authored opposite. */
export const DEFAULT_OUTCOME_FLIP = "aksi yönde";

/**
 * Outcome flip for a bare statute citation. There is no doctrinal "opposite"
 * of "5237 sayılı 157"; what a lawyer looks for is where the application of
 * that article was REVERSED, so the flip phrase is `bozma`.
 */
export const STATUTE_OUTCOME_FLIP = "bozma";

/** A base term that is a statute citation rather than a legal concept. */
function isStatuteCitation(normalizedBase: string): boolean {
  return normalizedBase.includes("sayılı");
}

export type ContraryFlavor = "general" | "divergence" | "aym";

/**
 * What a contrary lane is looking for. Different lanes retrieve genuinely
 * different documents, which is the whole point of having more than one.
 */
export type ContraryLaneKind =
  /** Decisions that went the other way on the merits. */
  | "outcome_flip"
  /** Karşı oy — the opposing reasoning recorded inside an otherwise adverse decision. */
  | "dissent"
  /** Direnme kararı — the lower court insisted; the split is on the record. */
  | "insistence"
  /** İçtihadı birleştirme — the decision that resolves a split of authority. */
  | "unification"
  /** AYM: the impugned rule was upheld (iptal isteminin reddi). */
  | "upheld"
  /** AYM bireysel başvuru: inadmissible / no violation. */
  | "inadmissible";

export interface ContraryLane {
  kind: ContraryLaneKind;
  /** The issue search term. */
  baseTerm: string;
  /** The single flip phrase this lane ANDs onto the base term. */
  flipPhrase: string;
  /** Structured terms (for tools taking a keyword array, e.g. AYM). */
  terms: readonly string[];
  /** Keyword-engine query string (flip phrase quoted when multi-word). */
  query: string;
}

function quoteIfPhrase(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

/** First authored opposite whose key occurs in the normalized base term. */
export function oppositeTermFor(baseTerm: string): string | undefined {
  const normalized = normalizeTurkishSearch(baseTerm);
  for (const [key, terms] of Object.entries(OPPOSITE_TERMS)) {
    if (normalized.includes(key) && terms.length > 0) return terms[0];
  }
  return undefined;
}

function lane(kind: ContraryLaneKind, baseTerm: string, flipPhrase: string): ContraryLane {
  const base = normalizeTurkishSearch(baseTerm);
  return {
    kind,
    baseTerm: base,
    flipPhrase,
    terms: Object.freeze([base, flipPhrase]),
    query: `${base} ${quoteIfPhrase(flipPhrase)}`,
  };
}

/**
 * Deterministically build the contrary-authority lanes for an issue search
 * term. Never empty; every lane ANDs exactly one flip phrase onto the base
 * term so the query still retrieves something.
 *
 *  - `general`    outcome flip + dissent (karşı oy);
 *  - `divergence` outcome flip + direnme + içtihadı birleştirme — used by the
 *    Yargıtay/Danıştay split template, where the question IS the divergence;
 *  - `aym`        norm control upheld + individual application inadmissible.
 */
export function buildContraryLanes(
  baseTerm: string,
  flavor: ContraryFlavor = "general",
): ContraryLane[] {
  if (flavor === "aym") {
    return [
      lane("upheld", baseTerm, "iptal isteminin reddi"),
      lane("inadmissible", baseTerm, "kabul edilemez"),
    ];
  }
  const normalizedBase = normalizeTurkishSearch(baseTerm);
  const flip =
    oppositeTermFor(baseTerm) ??
    (isStatuteCitation(normalizedBase) ? STATUTE_OUTCOME_FLIP : DEFAULT_OUTCOME_FLIP);
  const outcome = lane("outcome_flip", baseTerm, flip);
  if (flavor === "divergence") {
    return [
      outcome,
      lane("insistence", baseTerm, "direnme"),
      lane("unification", baseTerm, "içtihadı birleştirme"),
    ];
  }
  return [outcome, lane("dissent", baseTerm, "karşı oy")];
}

/**
 * The primary contrary query for a base term (the first lane). Kept as a
 * single-string convenience for callers that only want one query.
 */
export function buildContraryQuery(
  baseTerm: string,
  flavor: ContraryFlavor = "general",
): string {
  const lanes = buildContraryLanes(baseTerm, flavor);
  return (lanes[0] as ContraryLane).query;
}

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

export interface FailedLane {
  issueId: string;
  capability: CapabilityName;
  toolName?: string;
  role: StepRole;
  failureKind: string;
  safeMessage?: string;
}

/** Why a material issue is not covered. */
export type UncoveredReason =
  /** No primary-source hit was recorded for the issue at all. */
  | "NO_EVIDENCE"
  /** The mandatory contrary-authority search never ran (budget/scope). */
  | "CONTRARY_NOT_EXECUTED"
  /** Every contrary search errored — an outage, not an absence of authority. */
  | "CONTRARY_FAILED";

export type OutcomeStatus = "ok" | "partial" | "error";

export interface IssueCoverage {
  issueId: string;
  label: string;
  material: boolean;
  /** Total structured hits recorded by this issue's evidence searches. */
  evidenceCount: number;
  /** Hits from case-law/regulator searches only (a statute is not authority). */
  judicialEvidenceCount: number;
  /** At least one contrary-role step executed and its outcome recorded. */
  contraryExecuted: boolean;
  /** Number of distinct contrary lanes recorded for the issue. */
  contraryLaneCount: number;
  /** At least one contrary step came back non-error (a real look, even if empty). */
  contraryUsable: boolean;
  /** Structured hits recorded by contrary searches. */
  contraryEvidenceCount: number;
  /** Best status observed across the issue's contrary steps (ok > partial > error). */
  contraryOutcomeStatus?: OutcomeStatus;
  /** material => evidenceCount > 0 && contraryUsable. */
  covered: boolean;
  /** Present exactly when `material && !covered`. */
  uncoveredReason?: UncoveredReason;
}

export interface UncoveredIssue {
  issueId: string;
  label: string;
  reason: UncoveredReason;
}

export interface ContraryCoverageReport {
  issues: readonly IssueCoverage[];
  allMaterialIssuesCovered: boolean;
  uncoveredIssueIds: readonly string[];
  /** Material issues left uncovered, each with a typed reason (brief 10.3). */
  uncoveredIssues: readonly UncoveredIssue[];
  /** Every planner step whose recorded outcome was an error. */
  failedLanes: readonly FailedLane[];
}

const STATUS_RANK: Readonly<Record<OutcomeStatus, number>> = Object.freeze({
  ok: 3,
  partial: 2,
  error: 1,
});

function betterStatus(a: OutcomeStatus | undefined, b: OutcomeStatus): OutcomeStatus {
  if (a === undefined) return b;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

const JUDICIAL_CAPABILITIES: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
  "caseLaw.search",
  "regulator.search",
]);

interface IssueTally {
  evidence: number;
  judicial: number;
  contraryLanes: number;
  contraryHits: number;
  contraryStatus?: OutcomeStatus;
}

function emptyTally(): IssueTally {
  return { evidence: 0, judicial: 0, contraryLanes: 0, contraryHits: 0 };
}

/**
 * Build the contrary-coverage report for a run. Consumes ONLY typed structured
 * fields of recorded steps (planner notes, outcome status, hit counts); raw
 * document text plays no role here.
 */
export function buildCoverageReport(
  intake: ResearchIntake,
  state: Readonly<Pick<RunState, "steps">>,
): ContraryCoverageReport {
  const analysis = analyzeIntake(intake);

  const failedLanes: FailedLane[] = [];
  const tallies = new Map<string, IssueTally>();
  const tallyFor = (issueId: string): IssueTally => {
    let tally = tallies.get(issueId);
    if (!tally) {
      tally = emptyTally();
      tallies.set(issueId, tally);
    }
    return tally;
  };

  for (const step of state.steps) {
    const note = parsePlannerNote(step.decision.note);
    if (!note) continue; // foreign / non-planner step

    const failure = extractFailure(step.outcome);
    if (failure && step.outcome.status === "error") {
      failedLanes.push({
        issueId: note.issueId,
        capability: step.decision.capability,
        ...(step.decision.toolName !== undefined
          ? { toolName: step.decision.toolName }
          : {}),
        role: note.role,
        failureKind: failure.kind,
        ...(failure.safeMessage !== undefined ? { safeMessage: failure.safeMessage } : {}),
      });
    }

    const tally = tallyFor(note.issueId);
    const hits = extractHits(step.outcome).length;

    if (EVIDENCE_SEARCH_ROLES.has(note.role)) {
      tally.evidence += hits;
      if (JUDICIAL_SEARCH_ROLES.has(note.role) &&
          JUDICIAL_CAPABILITIES.has(step.decision.capability)) {
        tally.judicial += hits;
      }
    }

    if (note.role === "contrary") {
      tally.contraryLanes += 1;
      tally.contraryHits += hits;
      // Contrary hits are evidence too: an opposing decision is a source.
      tally.evidence += hits;
      if (JUDICIAL_CAPABILITIES.has(step.decision.capability)) tally.judicial += hits;
      tally.contraryStatus = betterStatus(tally.contraryStatus, step.outcome.status);
    }
  }

  const issues: IssueCoverage[] = analysis.issues.map((issue) => {
    const tally = tallies.get(issue.issueId) ?? emptyTally();
    const contraryExecuted = tally.contraryLanes > 0;
    // A contrary search that ERRORED is not coverage: the provider was down,
    // which is not the same as "there is no authority the other way".
    const contraryUsable =
      tally.contraryStatus !== undefined && tally.contraryStatus !== "error";
    const covered = !issue.material || (tally.evidence > 0 && contraryUsable);
    const reason: UncoveredReason | undefined = covered
      ? undefined
      : tally.evidence === 0
        ? "NO_EVIDENCE"
        : contraryExecuted
          ? "CONTRARY_FAILED"
          : "CONTRARY_NOT_EXECUTED";
    return {
      issueId: issue.issueId,
      label: issue.label,
      material: issue.material,
      evidenceCount: tally.evidence,
      judicialEvidenceCount: tally.judicial,
      contraryExecuted,
      contraryLaneCount: tally.contraryLanes,
      contraryUsable,
      contraryEvidenceCount: tally.contraryHits,
      ...(tally.contraryStatus !== undefined
        ? { contraryOutcomeStatus: tally.contraryStatus }
        : {}),
      covered,
      ...(reason !== undefined ? { uncoveredReason: reason } : {}),
    };
  });

  const uncoveredIssues: UncoveredIssue[] = issues
    .filter((i) => i.material && !i.covered)
    .map((i) => ({
      issueId: i.issueId,
      label: i.label,
      reason: i.uncoveredReason ?? "NO_EVIDENCE",
    }));

  return {
    issues: Object.freeze(issues),
    allMaterialIssuesCovered: uncoveredIssues.length === 0,
    uncoveredIssueIds: Object.freeze(uncoveredIssues.map((i) => i.issueId)),
    uncoveredIssues: Object.freeze(uncoveredIssues),
    failedLanes: Object.freeze(failedLanes),
  };
}

export class ContraryCoverageError extends Error {
  constructor(readonly report: ContraryCoverageReport) {
    super(
      `contrary-authority coverage incomplete for issues: ${report.uncoveredIssues
        .map((i) => `${i.issueId}(${i.reason})`)
        .join(", ")}`,
    );
    this.name = "ContraryCoverageError";
  }
}

/** Assert full material-issue coverage; throws ContraryCoverageError otherwise. */
export function assertContraryCoverage(report: ContraryCoverageReport): void {
  if (!report.allMaterialIssuesCovered) throw new ContraryCoverageError(report);
}

/**
 * Verifier port implementation for the executor: a run the planner declared
 * finished is `complete` only when every material issue has recorded evidence
 * AND a contrary-authority search that actually came back; otherwise a typed
 * `partial`.
 */
export function createCoverageVerifier(intake: ResearchIntake): Verifier {
  return {
    async finalizeOrQualify(state: Readonly<RunState>): Promise<"complete" | "partial"> {
      const report = buildCoverageReport(intake, state);
      return report.allMaterialIssuesCovered ? "complete" : "partial";
    },
  };
}
