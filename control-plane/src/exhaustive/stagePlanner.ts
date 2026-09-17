/**
 * The orchestrator's planning logic (W21). Pure.
 *
 * The reduce stage of W20 became an ORCHESTRATOR: each time it is claimed
 * (only when no unit and no analytical task of the run is pending or
 * running) it asks this module what to do next, given nothing but the rows
 * the database holds:
 *
 *   plan      insert the tasks of one step, with its marker, in one
 *             transaction (weighing and semantic contradictions first, then
 *             synthesis level 1, then each next level);
 *   wait      tasks of the current step are still open (never returned by a
 *             correct claim, kept as a safety answer);
 *   finalize  everything the task requires has reached a terminal state.
 *
 * Because every decision is a function of stored rows, a crash between two
 * planning passes changes nothing: the next orchestrator — another process,
 * another day — makes the same decision, and the unique task keys make
 * inserting a plan twice a no-op.
 */

import { discoverCandidates, type DiscoveryItem } from "./candidateDiscovery.js";
import { clip, isClipped, itemRef, type IntelItemDraft, type StoredObservation } from "./intelligence.js";
import {
  DEFAULT_PAIRING,
  planContradictionGroups,
  propositionsFrom,
  SEMANTIC_PROPOSITION_KINDS,
} from "./semanticContradictions.js";
import { buildAnalyticalState, type AnalyticalState } from "./stageFinalize.js";
import type {
  PlanMarker,
  StageConfig,
  StageTaskRow,
  StageTaskSpec,
  SynthesisMode,
  WeighInput,
} from "./stageTypes.js";
import { buildSynthesisGroups, planSynthesisLevel1, planSynthesisNextLevel } from "./synthesisPlan.js";
import { SUPPORT_UNIVERSE_KINDS, WEIGH_CLAIM_QUOTE_CHARS } from "./stageTypes.js";
import { TASK_SPECS, type AnalysisTask } from "./tasks.js";

export type PlanningDecision =
  | { readonly kind: "plan"; readonly step: string; readonly specs: StageTaskSpec[]; readonly marker: PlanMarker }
  | { readonly kind: "wait" }
  | { readonly kind: "finalize" };

export interface PlanningContext {
  readonly task: AnalysisTask;
  readonly observations: readonly StoredObservation[];
  readonly tasks: readonly StageTaskRow[];
  readonly config: StageConfig;
  readonly clientRole: string | null;
  readonly extractionComplete: boolean;
  /** Every page and unit of every file was read (source coverage complete). */
  readonly sourceComplete: boolean;
  /** itemRef -> embedding, when local embeddings exist. */
  readonly itemEmbeddings?: ReadonlyMap<string, ArrayLike<number>> | undefined;
  /** observationId -> embedding, when local embeddings exist. */
  readonly observationEmbeddings?: ReadonlyMap<string, ArrayLike<number>> | undefined;
}

export interface StagePlan {
  readonly weigh: boolean;
  readonly contradictions: boolean;
  readonly synthesis: boolean;
  readonly mode: SynthesisMode;
}

/** Which analytical stages a task has (model tasks only have any). */
export function stagesFor(task: AnalysisTask): StagePlan {
  const model = TASK_SPECS[task].requiresModel;
  const review = task === "full_review" || task === "red_team";
  return {
    weigh: model,
    contradictions: model && review,
    synthesis: model && review,
    mode: task === "red_team" ? "red_team" : "review",
  };
}

export function hasPlan(tasks: readonly StageTaskRow[], step: string): boolean {
  return tasks.some((row) => row.stage === "plan" && row.taskKey === step && row.state === "done");
}

function planDetails(tasks: readonly StageTaskRow[], step: string): Record<string, unknown> {
  const row = tasks.find((candidate) => candidate.stage === "plan" && candidate.taskKey === step);
  const details = row?.result?.["details"];
  return details !== null && typeof details === "object" ? (details as Record<string, unknown>) : {};
}

function isOpen(row: StageTaskRow): boolean {
  return row.state === "pending" || row.state === "running";
}

function entityNamesOf(items: readonly IntelItemDraft[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    if (item.kind !== "entity") continue;
    const name = typeof item.attributes["name"] === "string" ? (item.attributes["name"] as string) : item.title;
    if (name.trim().length >= 3) names.add(name.trim());
  }
  return [...names].sort();
}

function discoveryItem(item: IntelItemDraft, observations: ReadonlyMap<string, StoredObservation>): DiscoveryItem {
  const basis = item.sources.find((source) => source.role === "basis") ?? item.sources[0];
  const observation = basis === undefined ? undefined : observations.get(basis.observationId);
  return {
    ref: itemRef(item),
    kind: item.kind,
    title: item.title,
    quote: observation?.quote ?? "",
    partyRole: item.partyRole ?? null,
    occurredOn: item.occurredOn ?? observation?.occurredOn ?? null,
    fileId: observation?.fileId ?? null,
    unitNo: observation?.unitNo ?? null,
    startChar: observation?.startChar ?? null,
    endChar: observation?.endChar ?? null,
  };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < values.length; at += size) out.push(values.slice(at, at + size));
  return out;
}

/**
 * Plan the weighing of EVERY claim and defense: each against its whole
 * candidate set, in bounded batches. A claim in a matter without evidence
 * gets one task that is complete at planning time — it is counted, not
 * skipped.
 */
export function planWeighing(ctx: PlanningContext, state: AnalyticalState): { specs: StageTaskSpec[]; marker: PlanMarker } {
  const observations = new Map(ctx.observations.map((observation) => [observation.observationId, observation]));
  const claims = state.items
    .filter((item) => item.kind === "claim" || item.kind === "defense")
    .sort((a, b) => (itemRef(a) < itemRef(b) ? -1 : 1));
  // Every support-bearing kind, not only what the model labelled
  // "evidence"/"fact": the label must not decide what a search covered.
  const evidence = state.items.filter((item) => SUPPORT_UNIVERSE_KINDS.has(item.kind));
  const discovered = discoverCandidates(
    claims.map((item) => discoveryItem(item, observations)),
    evidence.map((item) => discoveryItem(item, observations)),
    {
      fullSearchMaxEvidence: ctx.config.fullSearchMaxEvidence,
      candidatesPerClaim: ctx.config.candidatesPerClaim,
      embeddings: ctx.itemEmbeddings,
      entityNames: entityNamesOf(state.items),
    },
  );
  const byRef = new Map(discovered.map((entry) => [entry.claimRef, entry]));
  const specs: StageTaskSpec[] = [];
  let seq = 0;
  let pairs = 0;
  let completeSets = 0;
  let semanticSignal = false;
  for (const claim of claims) {
    const ref = itemRef(claim);
    const found = byRef.get(ref);
    if (found === undefined) continue;
    semanticSignal ||= found.semanticSignal;
    if (found.candidateSetComplete) completeSets += 1;
    pairs += found.candidates.length;
    const kind = claim.kind === "defense" ? "defense" : "claim";
    const batches = found.candidates.length === 0 ? [[]] : chunk(found.candidates, Math.max(1, ctx.config.weighBatchSize));
    // The verified quote is what the weighing model judges; the title is
    // the extraction model's paraphrase (W21 review #8).
    const fullClaimQuote = discoveryItem(claim, observations).quote;
    const claimQuote = clip(fullClaimQuote, WEIGH_CLAIM_QUOTE_CHARS);
    const claimQuoteClipped = isClipped(fullClaimQuote, WEIGH_CLAIM_QUOTE_CHARS);
    batches.forEach((candidates, index) => {
      const input: WeighInput = {
        claimRef: ref,
        claimKind: kind,
        claimTitle: claim.title,
        ...(claimQuote !== "" ? { claimQuote } : {}),
        claimPartyRole: claim.partyRole ?? null,
        batchNo: index + 1,
        batchCount: batches.length,
        candidates,
        candidateSetComplete: found.candidateSetComplete,
        universeSize: found.universeSize,
        semanticSignal: found.semanticSignal,
        ...(claimQuoteClipped ? { claimQuoteClipped: true } : {}),
        ...(found.selfOverlapExcluded > 0 ? { selfOverlapExcluded: found.selfOverlapExcluded } : {}),
      };
      specs.push({
        stage: kind === "defense" ? "weigh_defense" : "weigh_claim",
        taskKey: `weigh:${ref}:${index + 1}`,
        level: 0,
        seq: seq++,
        input: input as unknown as Record<string, unknown>,
        ...(candidates.length === 0 ? { doneResult: { verdicts: [], rejected: 0, unanswered: 0 } } : {}),
      });
    });
  }
  return {
    specs,
    marker: {
      step: "weigh",
      planned: specs.length,
      details: {
        claims: claims.filter((item) => item.kind === "claim").length,
        defenses: claims.filter((item) => item.kind === "defense").length,
        evidenceUniverse: evidence.length,
        fullSearch: evidence.length <= ctx.config.fullSearchMaxEvidence,
        claimsWithCompleteCandidateSet: completeSets,
        candidateComparisons: pairs,
        semanticSignal,
      },
    },
  };
}

/** Plan the semantic contradiction lane over every verified proposition. */
export function planContradictions(ctx: PlanningContext, state: AnalyticalState): { specs: StageTaskSpec[]; marker: PlanMarker } {
  const entityNames = entityNamesOf(state.items);
  const propositions = propositionsFrom(ctx.observations, {
    embeddings: ctx.observationEmbeddings,
    entityNames,
  });
  const plan = planContradictionGroups(propositions, {
    ...DEFAULT_PAIRING,
    minLexical: ctx.config.contradictionMinLexical,
    minCosine: ctx.config.contradictionMinCosine,
    pairsPerCall: ctx.config.contradictionPairsPerCall,
    embeddings: ctx.observationEmbeddings,
    entityNames,
  });
  return {
    specs: plan.tasks,
    marker: {
      step: "contradictions",
      planned: plan.tasks.length,
      details: {
        propositions: plan.propositions,
        pairs: plan.pairsTotal,
        groups: plan.groups,
        semanticSignal: plan.semanticSignal,
      },
    },
  };
}

/**
 * What to do next for a run whose units are all read and whose planned tasks
 * are all terminal. Several independent plans (weighing and contradictions)
 * can be returned together.
 */
export function nextDecisions(ctx: PlanningContext): PlanningDecision[] {
  const stages = stagesFor(ctx.task);
  if (!stages.weigh && !stages.contradictions && !stages.synthesis) return [{ kind: "finalize" }];
  const state = buildAnalyticalState({
    task: ctx.task,
    observations: ctx.observations,
    tasks: ctx.tasks,
    extractionComplete: ctx.extractionComplete,
    sourceComplete: ctx.sourceComplete,
  });

  const firstPhase: PlanningDecision[] = [];
  if (stages.weigh && !hasPlan(ctx.tasks, "weigh")) {
    const { specs, marker } = planWeighing(ctx, state);
    firstPhase.push({ kind: "plan", step: "weigh", specs, marker });
  }
  if (stages.contradictions && !hasPlan(ctx.tasks, "contradictions")) {
    const { specs, marker } = planContradictions(ctx, state);
    firstPhase.push({ kind: "plan", step: "contradictions", specs, marker });
  }
  if (firstPhase.length > 0) return firstPhase;

  const phaseA = ctx.tasks.filter(
    (row) =>
      row.stage === "weigh_claim" || row.stage === "weigh_defense" || row.stage === "contradiction_group",
  );
  if (phaseA.some(isOpen)) return [{ kind: "wait" }];
  if (!stages.synthesis) return [{ kind: "finalize" }];

  // Synthesis runs AFTER weighing, so every claim enters it with its support
  // state, and after the semantic lane, so its contradictions are findings.
  if (!hasPlan(ctx.tasks, "synthesis:1")) {
    const groups = buildSynthesisGroups(
      state.items,
      state.links,
      new Map(ctx.observations.map((observation) => [observation.observationId, observation.quote])),
    );
    const specs = planSynthesisLevel1(groups, ctx.config, ctx.clientRole, stages.mode);
    return [
      {
        kind: "plan",
        step: "synthesis:1",
        specs,
        marker: {
          step: "synthesis:1",
          planned: specs.length,
          details:
            specs.length === 0
              ? { empty: true }
              : { groups: groups.length, findings: groups.reduce((total, group) => total + group.entries.length, 0) },
        },
      },
    ];
  }

  let level = 1;
  while (hasPlan(ctx.tasks, `synthesis:${level + 1}`)) level += 1;
  const details = planDetails(ctx.tasks, `synthesis:${level}`);
  if (details["empty"] === true || details["noEntries"] === true) return [{ kind: "finalize" }];
  const levelRows = ctx.tasks.filter(
    (row) => (row.stage === "synthesis_group" || row.stage === "synthesis_reduce") && row.level === level,
  );
  if (levelRows.some(isOpen)) return [{ kind: "wait" }];
  if (levelRows.some((row) => row.input["final"] === true)) return [{ kind: "finalize" }];

  const specs = planSynthesisNextLevel(level, levelRows, ctx.config, ctx.clientRole, stages.mode);
  return [
    {
      kind: "plan",
      step: `synthesis:${level + 1}`,
      specs,
      marker: {
        step: `synthesis:${level + 1}`,
        planned: specs.length,
        details:
          specs.length === 0
            ? { noEntries: true }
            : { final: specs.length === 1 && specs[0]?.input["final"] === true, entries: levelRows.length },
      },
    },
  ];
}

/**
 * Texts the next planning step would like embeddings for (so the worker can
 * embed them BEFORE planning, outside any pure function). Empty when the
 * steps that use embeddings are already planned.
 */
export function embeddingRequests(ctx: Omit<PlanningContext, "itemEmbeddings" | "observationEmbeddings">): {
  items: Array<{ key: string; text: string }>;
  observations: Array<{ key: string; text: string }>;
} {
  const stages = stagesFor(ctx.task);
  const out = { items: [] as Array<{ key: string; text: string }>, observations: [] as Array<{ key: string; text: string }> };
  if (stages.weigh && !hasPlan(ctx.tasks, "weigh")) {
    const state = buildAnalyticalState({
      task: ctx.task,
      observations: ctx.observations,
      tasks: ctx.tasks,
      extractionComplete: ctx.extractionComplete,
      sourceComplete: ctx.sourceComplete,
    });
    for (const item of state.items) {
      if (item.kind === "claim" || item.kind === "defense" || SUPPORT_UNIVERSE_KINDS.has(item.kind)) {
        out.items.push({ key: itemRef(item), text: item.title });
      }
    }
  }
  if (stages.contradictions && !hasPlan(ctx.tasks, "contradictions")) {
    const kinds = new Set(SEMANTIC_PROPOSITION_KINDS);
    for (const observation of ctx.observations) {
      if (observation.origin === "model" && kinds.has(observation.kind)) {
        out.observations.push({ key: observation.observationId, text: observation.statement });
      }
    }
  }
  return out;
}
