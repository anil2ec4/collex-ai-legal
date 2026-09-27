/**
 * From persisted observations + persisted stage results to Matter
 * Intelligence (W21).
 *
 * Pure. The inputs are ALWAYS what the database holds — the complete
 * observation set of the run and every analytical task row — never what one
 * process happened to compute in memory, so a run finished by a different
 * process after a crash assembles exactly the same result.
 *
 * Two entry points:
 *
 *   buildAnalyticalState  observations → deterministic items and relations,
 *                         model items, claim/defense support states from the
 *                         weighing tasks, semantic relations from the
 *                         contradiction tasks. The synthesis planner reads
 *                         this (synthesis runs AFTER weighing, so it sees
 *                         every claim's support state).
 *   finalizeIntelligence  the state + the synthesis tasks → the final item
 *                         set the run stores.
 *
 * "No support" is stated only as strongly as the search behind it allows:
 *
 *   NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH   every evidence item of the matter
 *        was compared with the claim, every comparison answered, and the
 *        extraction that produced the evidence was itself complete;
 *   NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES   every candidate was compared, but
 *        the candidates were not the whole evidence universe;
 *   SEARCH_INCOMPLETE   a comparison failed, is still pending, was not
 *        answered, or its stored result can no longer be mapped to the
 *        claim or the candidate — nothing about absence may be said;
 *   NOT_WEIGHED         the claim never got a comparison at all.
 */

import { createHash } from "node:crypto";
import { foldTurkishCase } from "../retrieval/turkishAnalyzer.js";
import { partySide, sameParty } from "./candidateDiscovery.js";
import { subjectOverlap, type RelationVerdict, type ValueComparisonStats } from "./contradictions.js";
import {
  buildDeterministicIntel,
  clip,
  compareStoredValues,
  INTEL_VERSION,
  itemRef,
  type IntelItemDraft,
  type IntelLinkDraft,
  type IntelSourceRef,
  type StoredObservation,
} from "./intelligence.js";
import { SEMANTIC_DETECTOR_VERSION } from "./semanticContradictions.js";
import {
  STAGE_SCHEMA_VERSION,
  type ContradictionGroupInput,
  type ContradictionGroupResult,
  type SemanticRelationRow,
  type StageTaskRow,
  type SynthesisInput,
  type SynthesisResult,
  type WeighInput,
  type WeighResult,
  SUPPORT_UNIVERSE_KINDS,
} from "./stageTypes.js";
import { TASK_SPECS, type AnalysisTask, type IntelItemKind } from "./tasks.js";

export type SearchState =
  | "SUPPORT_FOUND"
  | "NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH"
  | "NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES"
  | "SEARCH_INCOMPLETE"
  | "NOT_WEIGHED";

export interface AnalyticalState {
  readonly relations: RelationVerdict[];
  readonly semanticRelations: SemanticRelationRow[];
  readonly items: IntelItemDraft[];
  readonly links: IntelLinkDraft[];
  readonly searchStates: Record<SearchState, number>;
  /**
   * Planned candidates and verdicts whose item ref no longer resolves
   * (should be 0; non-zero means the item keys are derived differently
   * from when weighing was planned). Every such comparison is UNRESOLVED
   * for its claim, and that claim is never "unsupported" (W21 review
   * #11/#16).
   */
  readonly unresolvedVerdictRefs: number;
  /**
   * Weighing task rows whose CLAIM ref no longer resolves to a claim or
   * defense of the run. Their comparisons are counted in
   * unresolvedVerdictRefs (a stored "supports" among them is not silently
   * dropped), and no claim is counted as weighed by them.
   */
  readonly unresolvableWeighRows: number;
  /**
   * The observation ids the run holds NOW. A stored task input or result
   * may name an observation that is gone (its file was deleted during the
   * run); such a source is never written (it would violate the foreign key
   * and discard the whole run) and is counted instead (W21 round-two review).
   */
  readonly observationIds?: ReadonlySet<string> | undefined;
  /** Relations and sources dropped because an observation they name is gone. */
  readonly danglingObservationRefs?: number | undefined;
  /** Claims whose "no support" was reached on clipped text (see WeighCandidate.quoteClipped). */
  readonly clippedComparisons?: number | undefined;
  /** How much of the value census the deterministic lane compared (contradiction-v3). */
  readonly valueComparison?: ValueComparisonStats | undefined;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
}

function basisSources(item: IntelItemDraft): IntelSourceRef[] {
  const basis = item.sources.filter((source) => source.role === "basis");
  return (basis.length > 0 ? basis : item.sources).map((source) => ({ ...source }));
}

const LINKABLE_TO_ISSUE = new Set<IntelItemKind>(["claim", "defense", "evidence", "fact"]);

/**
 * Deterministic "concerns issue" links (the W20 rule, extended from claims
 * to defenses, evidence and facts). The synthesis planner groups findings
 * by these links, so the planner and the finalizer MUST call this same
 * function on the same items.
 */
export function issueLinks(items: readonly IntelItemDraft[]): IntelLinkDraft[] {
  const issues = items.filter((item) => item.kind === "legal_issue");
  const links: IntelLinkDraft[] = [];
  if (issues.length === 0) return links;
  for (const item of items) {
    if (!LINKABLE_TO_ISSUE.has(item.kind)) continue;
    for (const issue of issues) {
      if (subjectOverlap(foldTurkishCase(item.title), foldTurkishCase(issue.title)) >= 0.2) {
        links.push({ from: itemRef(item), to: itemRef(issue), linkKind: "concerns_issue", producer: "deterministic" });
      }
    }
  }
  return links;
}

const EMPTY_STATES = (): Record<SearchState, number> => ({
  SUPPORT_FOUND: 0,
  NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH: 0,
  NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES: 0,
  SEARCH_INCOMPLETE: 0,
  NOT_WEIGHED: 0,
});

export interface AnalyticalStateInput {
  readonly task: AnalysisTask;
  readonly observations: readonly StoredObservation[];
  readonly tasks: readonly StageTaskRow[];
  /** Extraction coverage is complete (every unit's extraction succeeded). */
  readonly extractionComplete: boolean;
  /**
   * Source coverage is complete: every page and unit of every file was read.
   * An unread exhibit may be exactly the evidence a claim needs, so without
   * it no search is "complete" and no claim is "unsupported".
   */
  readonly sourceComplete: boolean;
}

/**
 * Everything the run knows after reading, weighing and the semantic
 * contradiction lane. Deterministic given the stored rows.
 */
export function buildAnalyticalState(input: AnalyticalStateInput): AnalyticalState {
  const compared = compareStoredValues(input.observations);
  const relations = compared.verdicts;
  const base = buildDeterministicIntel(input.task, input.observations, relations);
  const items = base.items.map((item) => ({ ...item, attributes: { ...item.attributes }, sources: [...item.sources] }));
  const links: IntelLinkDraft[] = [...base.links];
  const byRef = new Map(items.map((item) => [itemRef(item), item]));
  const searchStates = EMPTY_STATES();
  let unresolvedVerdictRefs = 0;
  let unresolvableWeighRows = 0;
  let danglingObservationRefs = 0;
  let clippedComparisons = 0;
  const observationIds = new Set(input.observations.map((observation) => observation.observationId));

  // The deterministic lane's contradictions say which lane they came from.
  for (const item of items) {
    if (item.kind === "contradiction" && item.producer === "deterministic") item.attributes["lane"] = "deterministic";
  }

  links.push(...issueLinks(items));

  // ---- claim / defense weighing ------------------------------------------
  if (TASK_SPECS[input.task].requiresModel) {
    const rowsByClaim = new Map<string, StageTaskRow[]>();
    for (const row of input.tasks) {
      if (row.stage !== "weigh_claim" && row.stage !== "weigh_defense") continue;
      const claimRef = String(row.input["claimRef"] ?? "");
      const bucket = rowsByClaim.get(claimRef);
      if (bucket === undefined) rowsByClaim.set(claimRef, [row]);
      else bucket.push(row);
    }

    const weighable = items.filter((item) => item.kind === "claim" || item.kind === "defense");
    // The support universe as THIS code builds it from the stored rows. A
    // weighing planned over a different universe (the kinds widened, or the
    // extraction changed without a version bump) did not search everything
    // there is now, so it can never license "no support after a complete
    // search" (W21 review #16 leftover).
    const currentUniverse = items.filter((item) => SUPPORT_UNIVERSE_KINDS.has(item.kind)).length;
    // Rows whose claim ref names no current claim/defense (the keys are
    // derived differently from when weighing was planned). Every comparison
    // in them is unresolved — a stored "supports" there must not vanish
    // without a count — and the stage they belong to has a claim whose
    // result cannot be read back (W21 review #11).
    const weighableRefs = new Set(weighable.map(itemRef));
    const orphanedStages = new Set<string>();
    for (const [claimRef, rows] of rowsByClaim) {
      if (weighableRefs.has(claimRef)) continue;
      for (const row of rows) {
        unresolvableWeighRows += 1;
        orphanedStages.add(row.stage);
        const candidates = (row.input as unknown as WeighInput).candidates;
        unresolvedVerdictRefs += Array.isArray(candidates) ? candidates.length : 0;
      }
    }
    for (const claim of weighable) {
      const ref = itemRef(claim);
      const rows = (rowsByClaim.get(ref) ?? []).sort((a, b) => a.seq - b.seq);
      let state: SearchState;
      let supports = 0;
      let opposes = 0;
      let ambiguous = 0;
      let unanswered = 0;
      let unresolved = 0;
      let judged = 0;
      let planned = 0;
      let universe = 0;
      let candidatesClipped = 0;
      let claimQuoteClipped = false;
      let selfOverlapExcluded = 0;
      let judgedQuote: string | undefined;
      const allDone = rows.length > 0 && rows.every((row) => row.state === "done");
      const candidateSetComplete = rows.length > 0 && rows.every((row) => row.input["candidateSetComplete"] === true);

      for (const row of rows) {
        const weighInput = row.input as unknown as WeighInput;
        planned += weighInput.candidates.length;
        universe = Math.max(universe, weighInput.universeSize);
        if (weighInput.claimQuoteClipped === true) claimQuoteClipped = true;
        selfOverlapExcluded = Math.max(selfOverlapExcluded, weighInput.selfOverlapExcluded ?? 0);
        if (judgedQuote === undefined && typeof weighInput.claimQuote === "string" && weighInput.claimQuote.trim() !== "") {
          judgedQuote = weighInput.claimQuote;
        }
        for (const candidate of weighInput.candidates) if (candidate.quoteClipped === true) candidatesClipped += 1;
        if (row.state !== "done" || row.result === null) continue;
        const result = row.result as unknown as WeighResult;
        // A finished comparison whose candidate this code can no longer
        // name (its ref does not resolve) was NOT judged as far as this
        // finalizer can tell: it is unresolved, never silently dropped — a
        // dropped "supports" must not become "unsupported".
        const candidateRefs = new Set(weighInput.candidates.map((candidate) => candidate.ref));
        let unresolvedHere = 0;
        for (const candidateRef of candidateRefs) if (!byRef.has(candidateRef)) unresolvedHere += 1;
        unanswered += result.unanswered;
        for (const verdict of result.verdicts) {
          const target = byRef.get(verdict.ref);
          if (target === undefined) {
            if (!candidateRefs.has(verdict.ref)) unresolvedHere += 1;
            continue;
          }
          if (verdict.stance === "unrelated") continue;
          if (verdict.stance === "supports") supports += 1;
          else if (verdict.stance === "opposes") opposes += 1;
          else ambiguous += 1;
          links.push({
            from: itemRef(target),
            to: ref,
            linkKind: verdict.stance,
            rationale: verdict.rationale === undefined ? undefined : clip(verdict.rationale, 600),
            producer: "model",
          });
          for (const source of basisSources(target)) {
            claim.sources.push({
              observationId: source.observationId,
              role: verdict.stance === "supports" ? "support" : verdict.stance === "opposes" ? "oppose" : "ambiguous",
            });
          }
        }
        unresolved += unresolvedHere;
        judged += Math.max(0, weighInput.candidates.length - result.unanswered - unresolvedHere);
      }
      unresolvedVerdictRefs += unresolved;

      if (rows.length === 0) {
        // No row names this claim; if rows of its stage name a claim that no
        // longer exists, this claim may well be the one they compared — its
        // search is unreadable, not absent.
        state = orphanedStages.has(claim.kind === "defense" ? "weigh_defense" : "weigh_claim")
          ? "SEARCH_INCOMPLETE"
          : "NOT_WEIGHED";
      } else if (!allDone || unanswered > 0 || unresolved > 0) {
        // W21 round-two review: support found in the comparisons that DID
        // run is not "supported" while others never ran — an opposing item
        // may sit in a failed batch. The found support stays as sources and
        // links; the status says the comparison is unfinished.
        state = "SEARCH_INCOMPLETE";
      }
      else if (supports > 0) state = "SUPPORT_FOUND";
      else if (
        candidateSetComplete &&
        universe > 0 &&
        universe === currentUniverse &&
        input.extractionComplete &&
        input.sourceComplete &&
        // A comparison on CLIPPED text (the claim's quote, or a candidate's)
        // did not read what was cut: absence is not established.
        !claimQuoteClipped &&
        candidatesClipped === 0
      ) {
        // Absence is a finding ONLY when every extracted support-bearing item
        // of a fully read, fully extracted file was compared and answered.
        // An empty universe (nothing extracted to compare with) proves nothing.
        state = "NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH";
      } else state = "NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES";
      searchStates[state] += 1;

      const clippedAbsence =
        state === "NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES" &&
        candidateSetComplete &&
        universe > 0 &&
        universe === currentUniverse &&
        input.extractionComplete &&
        input.sourceComplete &&
        (claimQuoteClipped || candidatesClipped > 0);
      if (clippedAbsence) clippedComparisons += 1;
      claim.supportStatus =
        supports > 0 && opposes > 0
          ? "disputed"
          : state === "NOT_WEIGHED"
            ? "not_weighed"
            : state === "SEARCH_INCOMPLETE"
              ? "search_incomplete"
              : supports > 0
                ? "supported"
                : opposes > 0
                  ? "opposed"
                  : ambiguous > 0
                    ? "ambiguous"
                    : state === "NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH"
                      ? "unsupported"
                      : "no_support_in_candidates";
      // W21 round-two review: the status was reached on the VERIFIED quote,
      // while the item's title is the extraction model's paraphrase (which
      // can negate it). The compared text travels with the item.
      if (judgedQuote !== undefined) {
        claim.attributes["judgedText"] = "quote";
        claim.attributes["judgedQuote"] = clip(judgedQuote, 400);
        if (claim.body === undefined) {
          claim.body = `Delillerle karşılaştırılan metin (belgeden birebir): "${clip(judgedQuote, 400)}"`;
        }
      }
      claim.attributes = {
        ...claim.attributes,
        searchState: state,
        candidatesPlanned: planned,
        candidatesJudged: judged,
        candidatesUnanswered: unanswered,
        candidatesUnresolved: unresolved,
        evidenceUniverse: universe,
        candidateSetComplete,
        sourceComplete: input.sourceComplete,
        ...(supports > 0 ? { supportsFound: supports } : {}),
        ...(opposes > 0 ? { opposesFound: opposes } : {}),
        ...(ambiguous > 0 ? { ambiguousFound: ambiguous } : {}),
        ...(candidatesClipped > 0 ? { candidatesClipped } : {}),
        ...(claimQuoteClipped ? { claimQuoteClipped: true } : {}),
        ...(selfOverlapExcluded > 0 ? { selfOverlapExcluded } : {}),
      };

      // A missing-support finding only for a claim whose OWN final status is
      // "no support", and with that same status: an ambiguous or opposing
      // verdict is never restated as "destek bulunamadı".
      if (claim.supportStatus === "unsupported" || claim.supportStatus === "no_support_in_candidates") {
        const complete = claim.supportStatus === "unsupported";
        const readPartly = candidateSetComplete && universe > 0 && input.extractionComplete && !input.sourceComplete;
        // The text that was compared (the verified quote), never the paraphrase.
        const searched = judgedQuote !== undefined ? `"${clip(judgedQuote, 300)}"` : claim.title;
        const kinds = supportUniverseKindsTr(input.task);
        const title = complete
          ? `Dosyadan çıkarılan bütün öğelerle (${kinds}) karşılaştırıldı; destek bulunamadı: ${searched}`
          : universe === 0
            ? `Dosyadan ${kinds} niteliğinde bir öğe çıkarılamadı; iddia hiçbir delille` +
              ` karşılaştırılamadı: ${searched}`
            : readPartly
              ? `Okunan belgelerden çıkarılan bütün öğelerle (${kinds}) karşılaştırıldı ve destek bulunamadı; ancak` +
                ` dosyanın okunamayan kısımları var, bu yüzden "desteksiz" denemez: ${searched}`
              : clippedAbsence
                ? `Dosyadan çıkarılan bütün öğelerle (${kinds}) karşılaştırıldı ve destek bulunamadı; ancak` +
                  ` bazı metinler modele kısaltılarak gösterildi, bu yüzden "desteksiz" denemez: ${searched}`
                : `Karşılaştırılan aday deliller arasında destek bulunamadı (dosyadaki bütün deliller` +
                  ` karşılaştırılmadı): ${searched}`;
        items.push({
          kind: "missing_support",
          key: `ms:${shortHash(ref)}`,
          title: clip(title, 480),
          hypothetical: false,
          producer: "deterministic",
          producerVersion: `${INTEL_VERSION}/${STAGE_SCHEMA_VERSION}`,
          partyRole: claim.partyRole,
          supportStatus: claim.supportStatus,
          attributes: {
            claimKey: claim.key,
            searchState: state,
            candidatesJudged: judged,
            evidenceUniverse: universe,
            ...(universe === 0 ? { emptyUniverse: true } : {}),
            ...(readPartly ? { sourceIncomplete: true } : {}),
            ...(clippedAbsence ? { judgedOnClippedText: true } : {}),
          },
          sources: basisSources(claim),
        });
      }
    }
  }

  // ---- semantic contradiction lane ---------------------------------------
  const semanticRelations: SemanticRelationRow[] = [];
  const seenPairs = new Set<string>();
  for (const row of input.tasks) {
    if (row.stage !== "contradiction_group" || row.state !== "done" || row.result === null) continue;
    const groupInput = row.input as unknown as ContradictionGroupInput;
    const result = row.result as unknown as ContradictionGroupResult;
    const pairs = new Map(groupInput.pairs.map((pair) => [pair.pairId, pair]));
    for (const verdict of result.verdicts) {
      const pair = pairs.get(verdict.pairId);
      if (pair === undefined || seenPairs.has(pair.pairId)) continue;
      seenPairs.add(pair.pairId);
      if (!observationIds.has(pair.leftObservationId) || !observationIds.has(pair.rightObservationId)) {
        danglingObservationRefs += 1;
        continue;
      }
      // A CONTRADICTION judged on a clipped quote did not read what was cut
      // (a reconciling clause may be there): it is at most a TENSION.
      const clippedPair = pair.leftQuoteClipped === true || pair.rightQuoteClipped === true;
      const relation: typeof verdict.relation =
        clippedPair && verdict.relation === "CONTRADICTION" ? "TENSION" : verdict.relation;
      semanticRelations.push({
        leftObservationId: pair.leftObservationId,
        rightObservationId: pair.rightObservationId,
        relation,
        rationale: clip(verdict.rationale, 2000),
        confidence: typeof verdict.confidence === "number" ? verdict.confidence : null,
        detector: SEMANTIC_DETECTOR_VERSION,
      });
      if (relation !== "CONTRADICTION" && relation !== "TENSION") continue;
      const sources: IntelSourceRef[] = [
        { observationId: pair.leftObservationId, role: "basis" },
        { observationId: pair.rightObservationId, role: "basis" },
      ];
      // The item body repeats what the classifier judged and what the
      // sources verify: the quotes. The paraphrases are shown only when a
      // pair predates recorded quotes, and the item says so.
      const judgedQuotes = quoteOrNull(pair.leftQuote) !== null && quoteOrNull(pair.rightQuote) !== null;
      const contradiction: IntelItemDraft = {
        kind: "contradiction",
        key: `sc:${shortHash(pair.pairId)}`,
        title: clip(
          `${relation === "CONTRADICTION" ? "Bağdaşmayan ifadeler" : "Gerilim"}: ${verdict.rationale}`,
          480,
        ),
        body:
          `1) ${clip(quoteOrNull(pair.leftQuote) ?? pair.leftStatement, 400)}\n` +
          `2) ${clip(quoteOrNull(pair.rightQuote) ?? pair.rightStatement, 400)}`,
        hypothetical: false,
        producer: "model",
        producerVersion: `${INTEL_VERSION}/${STAGE_SCHEMA_VERSION}`,
        modelId: row.modelId ?? undefined,
        confidence: typeof verdict.confidence === "number" ? verdict.confidence : undefined,
        attributes: {
          relation,
          lane: "semantic",
          detector: SEMANTIC_DETECTOR_VERSION,
          judgedText: judgedQuotes ? "quote" : "statement",
          ...(clippedPair ? { judgedOnClippedQuote: true, modelRelation: verdict.relation } : {}),
        },
        sources,
      };
      items.push(contradiction);
      if (relation === "CONTRADICTION") {
        const question: IntelItemDraft = {
          kind: "question",
          key: `sq:${shortHash(pair.pairId)}`,
          title:
            "Hangi ifade doğru? Belgelerde birbiriyle bağdaşmayan iki ifade var; aynı olaya" +
            " ilişkinse asıl kaynaklardan netleştirilmeli.",
          body: clip(verdict.rationale, 1000),
          hypothetical: false,
          producer: "model",
          producerVersion: `${INTEL_VERSION}/${STAGE_SCHEMA_VERSION}`,
          modelId: row.modelId ?? undefined,
          attributes: { origin: "contradiction", lane: "semantic" },
          sources: sources.map((source) => ({ ...source })),
        };
        items.push(question);
        links.push({ from: itemRef(question), to: itemRef(contradiction), linkKind: "answers", producer: "model" });
      }
    }
  }

  return {
    relations,
    semanticRelations,
    items,
    links,
    searchStates,
    unresolvedVerdictRefs,
    unresolvableWeighRows,
    observationIds,
    danglingObservationRefs,
    clippedComparisons,
    valueComparison: compared.stats,
  };
}

/**
 * The support-bearing kinds a task's weighing universe can hold, in words
 * (the extraction it asks for, plus the deterministic dated events of the
 * tasks that build them). "Compared with every item" names exactly these.
 */
export function supportUniverseKindsTr(task: AnalysisTask): string {
  const spec = TASK_SPECS[task];
  const kinds = new Set<string>(spec.modelKinds.filter((kind) => SUPPORT_UNIVERSE_KINDS.has(kind)));
  if (task === "chronology" || task === "full_review") kinds.add("event");
  const words: Array<[string, string]> = [
    ["evidence", "delil"],
    ["fact", "olgu"],
    ["event", "olay"],
    ["procedural_event", "usul işlemi"],
    ["credibility_issue", "güvenilirlik sorunu"],
  ];
  return words
    .filter(([kind]) => kinds.has(kind))
    .map(([, word]) => word)
    .join(", ");
}

/** A recorded verified quote, or null when the pair predates them. */
function quoteOrNull(quote: string | undefined): string | null {
  return quote !== undefined && quote.trim() !== "" ? quote : null;
}

// ---------------------------------------------------------------------------
// Final assembly
// ---------------------------------------------------------------------------

/**
 * The client's own claims that stayed unsupported after a COMPLETE search.
 * A claim is listed only when its party resolves to the SAME side as the
 * client's role (candidateDiscovery.sameParty: principal designation, never
 * a substring — "davalı-karşı davacı" is not "davacı"). Without a client
 * role no claim can be called "ours", so none is listed: the claims keep
 * their own "unsupported" status, and the notes say why the list is empty.
 * A claim whose side cannot be decided — its party is unknown, or the
 * client's role names no recognised side ("müvekkil", "kiracı") while the
 * claim's does — is never presented as the client's, and never silently
 * left out either: it is counted, and the run's notes say so.
 */
function unsupportedPropositions(
  items: readonly IntelItemDraft[],
  clientRole: string | null,
): { items: IntelItemDraft[]; partyUnknown: number; withoutClientRole: number } {
  const out: IntelItemDraft[] = [];
  let partyUnknown = 0;
  let withoutClientRole = 0;
  for (const claim of items) {
    // Only a claim whose search was COMPLETE may be called unsupported.
    if (claim.kind !== "claim" || claim.supportStatus !== "unsupported") continue;
    if (clientRole === null) {
      withoutClientRole += 1;
      continue;
    }
    if (!sameParty(claim.partyRole, clientRole)) {
      // Not the client's side as far as the labels show. Only when BOTH
      // labels resolve to a recognised side is that a decision ("the
      // opponent's claim"); otherwise it is undecided and counted.
      const decided =
        claim.partyRole !== undefined && partySide(claim.partyRole) !== "unknown" && partySide(clientRole) !== "unknown";
      if (!decided) partyUnknown += 1;
      continue;
    }
    out.push({
      kind: "unsupported_proposition",
      key: `u:${shortHash(itemRef(claim))}`,
      title: clip(
        `Dosyada dayanağı bulunamayan iddia: ${
          typeof claim.attributes["judgedQuote"] === "string" ? `"${claim.attributes["judgedQuote"]}"` : claim.title
        }`,
        480,
      ),
      hypothetical: false,
      producer: "deterministic",
      producerVersion: `${INTEL_VERSION}/${STAGE_SCHEMA_VERSION}`,
      partyRole: claim.partyRole,
      supportStatus: "unsupported",
      attributes: { claimKey: claim.key, searchState: "NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH" },
      sources: basisSources(claim),
    });
  }
  return { items: out, partyUnknown, withoutClientRole };
}

export interface FinalIntelligence {
  readonly relations: RelationVerdict[];
  readonly semanticRelations: SemanticRelationRow[];
  readonly items: IntelItemDraft[];
  readonly links: IntelLinkDraft[];
  readonly droppedWithoutSource: number;
  readonly notes: string[];
  readonly searchStates: Record<SearchState, number>;
  /** See AnalyticalState.unresolvedVerdictRefs; surfaced in the run summary. */
  readonly unresolvedVerdictRefs: number;
  /** See AnalyticalState.unresolvableWeighRows; surfaced in the run summary. */
  readonly unresolvableWeighRows: number;
}

/**
 * The state plus every finished synthesis task → what the run stores.
 * Items the task does not report are dropped (a red-team run reads facts to
 * reason with; it does not list them); an item without a source is dropped
 * and counted — the database would refuse it anyway.
 */
export function finalizeIntelligence(input: {
  readonly task: AnalysisTask;
  readonly state: AnalyticalState;
  readonly tasks: readonly StageTaskRow[];
  readonly clientRole: string | null;
}): FinalIntelligence {
  const items: IntelItemDraft[] = [...input.state.items];
  const links: IntelLinkDraft[] = [...input.state.links];
  const notes: string[] = [];

  if (input.task === "red_team") {
    const unsupported = unsupportedPropositions(items, input.clientRole);
    items.push(...unsupported.items);
    if (unsupported.partyUnknown > 0) {
      notes.push(
        `${unsupported.partyUnknown} dayanaksız iddianın hangi tarafa ait olduğu belirlenemediği için` +
          " \"dayanağı bulunamayan iddialarımız\" listesine alınmadı.",
      );
    }
    if (unsupported.withoutClientRole > 0) {
      notes.push(
        `Müvekkilin sıfatı belirtilmediği için dayanağı bulunamayan ${unsupported.withoutClientRole} iddianın` +
          " hangisinin müvekkile ait olduğu bilinemiyor; bunlar \"dayanağı bulunamayan iddialarımız\"" +
          " listesine alınmadı, iddiaların kendi değerlendirmesinde gösterildi.",
      );
    }
  }
  if (input.state.unresolvableWeighRows > 0) {
    notes.push(
      `${input.state.unresolvableWeighRows} delil karşılaştırma görevinin ait olduğu iddia/savunma artık` +
        " dosyadaki bir bulguya eşlenemiyor (inceleme sürümü değişmiş olabilir); bu görevlerin sonuçları" +
        " hiçbir iddia için kullanılmadı ve karşılaştırma eksik sayıldı.",
    );
  }
  if (input.state.unresolvedVerdictRefs > 0) {
    notes.push(
      `${input.state.unresolvedVerdictRefs} delil karşılaştırmasının sonucu artık dosyadaki bir bulguya` +
        " eşlenemiyor (inceleme sürümü değişmiş olabilir); ilgili iddia/savunmaların karşılaştırması" +
        " eksik sayıldı ve hiçbiri \"desteksiz\" diye nitelenmedi.",
    );
  }
  if (input.state.searchStates.NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES > 0) {
    notes.push(
      `${input.state.searchStates.NO_SUPPORT_FOUND_IN_CURRENT_CANDIDATES} iddia/savunma için aday deliller` +
        " arasında destek bulunamadı; bunlar dosyadan çıkarılan bütün delillerle karşılaştırılmadığı" +
        " ya da dosyanın bir kısmı okunamadığı için \"desteksiz\" diye nitelenmedi.",
    );
  }
  if (input.task === "full_review" && input.clientRole === null) {
    notes.push("Müvekkilin sıfatı belirtilmediği için lehe/aleyhe ayrımı yapılmadı; genel değerlendirme yapıldı.");
  }
  if ((input.state.clippedComparisons ?? 0) > 0) {
    notes.push(
      `${input.state.clippedComparisons} iddia/savunmanın karşılaştırmasında metinlerin bir kısmı modele kısaltılarak` +
        " gösterildi; bunlar için \"destek bulunamadı\" tam arama sonucu sayılmadı.",
    );
  }
  const known = input.state.observationIds;
  let dangling = input.state.danglingObservationRefs ?? 0;
  /** Sources naming an observation the run no longer holds are not written (counted). */
  const liveIds = (ids: readonly string[]): string[] => {
    if (known === undefined) return [...ids];
    const kept = ids.filter((id) => known.has(id));
    dangling += ids.length - kept.length;
    return kept;
  };

  const pointIndex = new Map<string, IntelItemDraft>();
  const synthesisRows = input.tasks
    .filter((row) => (row.stage === "synthesis_group" || row.stage === "synthesis_reduce") && row.state === "done")
    .sort((a, b) => a.level - b.level || a.seq - b.seq || (a.taskKey < b.taskKey ? -1 : 1));
  for (const row of synthesisRows) {
    if (row.result === null) continue;
    const synthesisInput = row.input as unknown as SynthesisInput;
    const result = row.result as unknown as SynthesisResult;
    // A synthesis task that was not shown every lower part (one failed) is
    // PARTIAL: its summary and points never read as covering the whole file.
    const missing = synthesisInput.missingParts;
    const partial =
      missing !== undefined && missing.count > 0
        ? { partial: true, missingParts: missing.count, missingGroups: [...missing.labels] }
        : {};
    if (synthesisInput.final === true && missing !== undefined && missing.count > 0) {
      notes.push(
        `Genel değerlendirme dosyanın ${missing.count} kısmı olmadan yapıldı (o kısımların özeti çıkarılamadı)` +
          (missing.labels.length > 0 ? `: ${missing.labels.join("; ")}` : "") +
          ". Bu kısımlar hakkında sonuç çıkarılmadı.",
      );
    }
    const summaryIds = result.summary === null ? [] : liveIds(result.summary.sourceObservationIds);
    if (result.summary !== null && summaryIds.length > 0) {
      const final = synthesisInput.final === true;
      items.push({
        kind: final ? "review_summary" : "issue_summary",
        key: `${final ? "rs" : "is"}:${shortHash(row.taskKey)}`,
        title: clip(final ? result.summary.title : `${synthesisInput.groupLabel}: ${result.summary.title}`, 480),
        body: result.summary.body === "" ? undefined : clip(result.summary.body, 4000),
        hypothetical: false,
        producer: "model",
        producerVersion: `${INTEL_VERSION}/${STAGE_SCHEMA_VERSION}`,
        modelId: row.modelId ?? undefined,
        attributes: {
          level: synthesisInput.level,
          groupKey: synthesisInput.groupKey,
          batchNo: synthesisInput.batchNo,
          batchCount: synthesisInput.batchCount,
          entries: synthesisInput.entries.length,
          ...partial,
        },
        sources: summaryIds.map((observationId) => ({ observationId, role: "basis" as const })),
      });
    }
    for (const point of result.points) {
      const kind = point.kind as IntelItemKind;
      const key = `p:${shortHash(`${kind}|${point.title}`)}`;
      const existing = pointIndex.get(`${kind}:${key}`);
      const pointIds = liveIds(point.sourceObservationIds);
      if (existing !== undefined) {
        for (const id of pointIds) {
          if (!existing.sources.some((source) => source.observationId === id)) {
            existing.sources.push({ observationId: id, role: "basis" });
          }
        }
        continue;
      }
      const draft: IntelItemDraft = {
        kind,
        key,
        title: clip(point.title, 480),
        body: point.body === undefined ? undefined : clip(point.body, 1500),
        hypothetical: kind === "hypothetical_argument",
        stance: kind === "favorable_point" ? "favorable" : kind === "unfavorable_point" ? "unfavorable" : undefined,
        producer: "model",
        producerVersion: `${INTEL_VERSION}/${STAGE_SCHEMA_VERSION}`,
        modelId: row.modelId ?? undefined,
        attributes: { level: synthesisInput.level, perspective: synthesisInput.perspective, ...partial },
        sources: pointIds.map((observationId) => ({ observationId, role: "basis" as const })),
      };
      pointIndex.set(`${kind}:${key}`, draft);
      items.push(draft);
    }
  }

  const produces = new Set<IntelItemKind>(TASK_SPECS[input.task].produces);
  let droppedWithoutSource = 0;
  const kept: IntelItemDraft[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!produces.has(item.kind)) continue;
    const ref = itemRef(item);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const unique: IntelSourceRef[] = [];
    for (const source of item.sources) {
      if (known !== undefined && !known.has(source.observationId)) {
        dangling += 1;
        continue;
      }
      if (!unique.some((known) => known.observationId === source.observationId && known.role === source.role)) {
        unique.push(source);
      }
    }
    item.sources = unique;
    if (item.sources.length === 0) {
      droppedWithoutSource += 1;
      continue;
    }
    kept.push(item);
  }
  if (dangling > 0) {
    notes.push(
      `${dangling} bulgu kaynağı, inceleme sürerken dosyadan kaldırılan bir belgeye ait olduğu için kullanılmadı;` +
        " o belge bu incelemede eksik sayıldı.",
    );
  }
  const keptRefs = new Set(kept.map(itemRef));
  const keptLinks = links.filter((link) => keptRefs.has(link.from) && keptRefs.has(link.to) && link.from !== link.to);

  return {
    relations: input.state.relations,
    semanticRelations: input.state.semanticRelations,
    items: kept,
    links: keptLinks,
    droppedWithoutSource,
    notes,
    searchStates: input.state.searchStates,
    unresolvedVerdictRefs: input.state.unresolvedVerdictRefs,
    unresolvableWeighRows: input.state.unresolvableWeighRows,
  };
}
