/**
 * Bounded deterministic rule planner v1 (Lane B4; Master Build Brief 10.2).
 *
 * Implements the executor's `Planner` port as a PURE state machine over the
 * selected research template's step graph:
 *
 *  - `next(state)` is a deterministic function of (intake, state, config,
 *    seed): no clocks, no randomness, no I/O. Calling it twice with the same
 *    state yields the identical decision.
 *  - Recorded step outcomes are inspected ONLY through the typed extractors in
 *    outcomes.ts. Raw document text is never treated as instructions; the one
 *    sanctioned use is running the strict exact-reference parser over fetched
 *    evidence to derive bounded E./K. follow-up searches.
 *  - The planner never emits a tool call for a model-invented ID: every
 *    document.fetch input carries an externalId read from a prior typed
 *    outcome, and every resolver/search input is built from references parsed
 *    out of the user's own question.
 *  - Budgets: before emitting, the planner checks the run's remaining step and
 *    tool-call budget and finishes early, leaving configured headroom for the
 *    verification phase. The executor's own budget assertion remains the hard
 *    stop.
 *  - Gap analysis (round 2) fires ONLY for material issues with zero recorded
 *    evidence, at most once per issue.
 */

import {
  stableStepKey,
  type Planner,
  type PlannerDecision,
  type RunState,
} from "../orchestration/executor.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import {
  analyzeIntake,
  IntakeValidationError,
  validateResearchIntake,
  type IntakeAnalysis,
  type ResearchIntake,
} from "./intake.js";
import {
  FETCHABLE_SEARCH_ROLES,
  JUDICIAL_SEARCH_ROLES,
  encodePlannerNote,
  extractDocumentText,
  extractHits,
  parsePlannerNote,
} from "./outcomes.js";
import {
  buildFetchInput,
  buildWithinInput,
  DANISTAY,
  fetchToolForProvider,
  gapQueryForIssue,
  RESEARCH_TEMPLATES,
  selectTemplate,
  withinDescriptorForKind,
  YARGITAY,
  type PlannedCall,
  type TemplateId,
} from "./templates.js";

export interface RulePlannerConfig {
  /**
   * Reserved for future deterministic tie-breaking; v1 planning is fully
   * determined by (intake, state) alone, so the seed changes nothing yet.
   */
  seed?: string;
  templateOverride?: TemplateId;
  /** Steps left unspent for the verification phase (default 2). */
  headroomSteps?: number;
  /** Tool calls left unspent for the verification phase (default 2). */
  headroomToolCalls?: number;
  /** Hard cap on cited-reference follow-up searches per run (default 3). */
  maxFollowUps?: number;
}

interface ResolvedConfig {
  seed: string;
  templateOverride?: TemplateId;
  headroomSteps: number;
  headroomToolCalls: number;
  maxFollowUps: number;
}

export const DEFAULT_HEADROOM_STEPS = 2;
export const DEFAULT_HEADROOM_TOOL_CALLS = 2;
export const DEFAULT_MAX_FOLLOW_UPS = 3;

/**
 * Upper bound on how much of a fetched document is scanned for exact E./K.
 * references. Provider documents are attacker-influenced input; parsing an
 * unbounded body is a cheap way to burn CPU (and a 5,000-char paginated page
 * is the normal case anyway). Slicing is deterministic, so the decision
 * function stays pure.
 */
export const REFERENCE_SCAN_LIMIT = 100_000;

/**
 * Bounds on the read-inside stage (W14/B-15). Reading INSIDE an instrument is
 * an enrichment, not the answer: a legislation search can return twenty rows
 * and each read costs a tool call, so only the top row of each legislation
 * search is opened and the run opens at most three distinct instruments.
 */
export const MAX_WITHIN_READS_PER_SEARCH = 1;
export const MAX_WITHIN_READS_PER_RUN = 3;

/**
 * Keyword for a read-inside call: the article number the question named, else
 * its leading concept. Mirrors the template's own `statuteRead` rule — the
 * keyword must occur in the ARTICLE TEXT, and an instrument searched for its
 * own citation returns nothing.
 */
function statuteReadKeyword(analysis: IntakeAnalysis): string | undefined {
  for (const issue of analysis.issues) {
    const articleNo = issue.reference?.articleNo;
    if (articleNo !== undefined) return `madde ${articleNo}`;
  }
  const concept = analysis.issues.find((i) => i.kind === "conceptual");
  return concept?.expandedTerms[0];
}

function resolveConfig(config?: RulePlannerConfig): ResolvedConfig {
  return {
    seed: config?.seed ?? "",
    ...(config?.templateOverride !== undefined
      ? { templateOverride: config.templateOverride }
      : {}),
    headroomSteps: config?.headroomSteps ?? DEFAULT_HEADROOM_STEPS,
    headroomToolCalls: config?.headroomToolCalls ?? DEFAULT_HEADROOM_TOOL_CALLS,
    maxFollowUps: config?.maxFollowUps ?? DEFAULT_MAX_FOLLOW_UPS,
  };
}

// ---------------------------------------------------------------------------
// Candidate derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Derive the full ordered candidate list for the current state:
 *   static template calls -> fetch stage -> follow-up stage -> gap stage.
 * Later stages are derived exclusively from typed fields of recorded steps,
 * so the list is a deterministic function of (analysis, state).
 */
function buildCandidates(
  analysis: IntakeAnalysis,
  templateId: TemplateId,
  state: Readonly<RunState>,
  config: ResolvedConfig,
): PlannedCall[] {
  const template = RESEARCH_TEMPLATES[templateId];
  const candidates: PlannedCall[] = template.buildStaticCalls(analysis);

  // --- Fetch stage: top hit of every recorded fetchable search (1 per search).
  // Contrary searches are included: a snippet may not be cited (brief 10.2),
  // so opposing authority has to be pulled in full before it can be relied on.
  for (const step of state.steps) {
    const note = parsePlannerNote(step.decision.note);
    if (!note || !FETCHABLE_SEARCH_ROLES.has(note.role)) continue;
    const top = extractHits(step.outcome)[0];
    if (!top) continue;
    const toolName = fetchToolForProvider(top.provider);
    // externalId + the tool's own id parameter come from a prior TYPED
    // outcome — never from document text and never guessed for an unknown
    // provider.
    const input = buildFetchInput(top.provider, top.externalId);
    if (toolName === undefined || input === undefined) continue;
    candidates.push({
      capability: "document.fetch",
      toolName,
      input,
      note: encodePlannerNote({
        template: templateId,
        issueId: note.issueId,
        role: "fetch",
        round: note.round,
      }),
    });
  }

  // --- Read-inside stage (W14/B-15, gap G3): a legislation hit whose TYPE is
  // not a kanun is opened with ITS OWN `search_within_*` tool. Before this the
  // planner only ever called `search_within_kanun` from the template, so a
  // yönetmelik / tebliğ / KHK / tüzük / CB kararnamesi could be found and then
  // never read. `legislationKind` is a closed label the tool itself printed;
  // it only selects a tool NAME from WITHIN_BY_TYPE.
  const withinKeyword = statuteReadKeyword(analysis);
  if (withinKeyword !== undefined) {
    const readInstruments = new Set<string>();
    for (const step of state.steps) {
      const note = parsePlannerNote(step.decision.note);
      if (!note || note.role !== "legislation") continue;
      for (const hit of extractHits(step.outcome).slice(0, MAX_WITHIN_READS_PER_SEARCH)) {
        if (hit.provider !== "MEVZUAT") continue;
        const legislationNo = hit.legislationNo;
        if (legislationNo === undefined) continue;
        const descriptor = withinDescriptorForKind(hit.legislationKind);
        if (descriptor === undefined) continue;
        const key = `${descriptor.toolName}|${legislationNo}`;
        if (readInstruments.has(key)) continue;
        readInstruments.add(key);
        if (readInstruments.size > MAX_WITHIN_READS_PER_RUN) break;
        const input = buildWithinInput(hit.legislationKind, legislationNo, withinKeyword);
        /* c8 ignore next */
        if (input === undefined) continue;
        candidates.push({
          capability: "document.searchWithin",
          toolName: descriptor.toolName,
          input,
          note: encodePlannerNote({
            template: templateId,
            issueId: note.issueId,
            role: "statute",
            round: note.round,
          }),
        });
      }
    }
  }

  // --- Follow-up stage: exact E./K. references cited inside fetched evidence.
  // The ONLY use of document text: the strict deterministic parser extracts
  // structured court-decision references; nothing else in the text can
  // influence the plan (injection-safe by construction).
  const seenRefs = new Set<string>();
  let followUps = 0;
  for (const step of state.steps) {
    const note = parsePlannerNote(step.decision.note);
    if (!note || note.role !== "fetch") continue;
    const text = extractDocumentText(step.outcome);
    if (text === undefined) continue;
    for (const ref of parseReferences(text.slice(0, REFERENCE_SCAN_LIMIT))) {
      if (ref.kind !== "court_decision") continue;
      if (ref.docketNo === undefined || ref.decisionNo === undefined) continue;
      const refKey = `${ref.docketNo}|${ref.decisionNo}`;
      if (seenRefs.has(refKey)) continue;
      seenRefs.add(refKey);
      if (followUps >= config.maxFollowUps) continue;
      followUps += 1;
      candidates.push({
        capability: "caseLaw.search",
        toolName: "search_bedesten_unified",
        input: {
          phrase: `E. ${ref.docketNo} K. ${ref.decisionNo}`,
          court_types: [YARGITAY, DANISTAY],
          pageNumber: 1,
        },
        note: encodePlannerNote({
          template: templateId,
          issueId: note.issueId,
          role: "followUp",
          round: note.round,
        }),
      });
    }
  }

  // --- Gap stage (round 2): ONLY for material issues whose round-1 judicial
  // search produced nothing. Measured on case-law/regulator hits, because the
  // gap query is itself a case-law query: a statute hit does not tell us how
  // the rule is applied, so it must not suppress the retry.
  for (const issue of analysis.issues) {
    if (!issue.material) continue;
    let primaryAttempted = false;
    let gapAttempted = false;
    let hasJudicialEvidence = false;
    for (const step of state.steps) {
      const note = parsePlannerNote(step.decision.note);
      if (!note || note.issueId !== issue.issueId) continue;
      if (note.role === "primary") primaryAttempted = true;
      if (note.role === "gap") gapAttempted = true;
      const judicialCapability =
        step.decision.capability === "caseLaw.search" ||
        step.decision.capability === "regulator.search";
      if (
        judicialCapability &&
        JUDICIAL_SEARCH_ROLES.has(note.role) &&
        extractHits(step.outcome).length > 0
      ) {
        hasJudicialEvidence = true;
      }
    }
    if (!primaryAttempted || gapAttempted || hasJudicialEvidence) continue;
    candidates.push({
      capability: "caseLaw.search",
      toolName: "search_bedesten_unified",
      input: {
        phrase: gapQueryForIssue(issue),
        court_types: [YARGITAY, DANISTAY],
        pageNumber: 1,
      },
      note: encodePlannerNote({
        template: templateId,
        issueId: issue.issueId,
        role: "gap",
        round: 2,
      }),
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Decision function (pure)
// ---------------------------------------------------------------------------

/**
 * Pure next-decision function. Exported for direct testing; `createRulePlanner`
 * wraps it into the executor's Planner port.
 */
export function planNextDecision(
  intake: ResearchIntake,
  state: Readonly<RunState>,
  config?: RulePlannerConfig,
): PlannerDecision {
  const resolved = resolveConfig(config);
  const analysis = analyzeIntake(intake);
  const templateId = selectTemplate(analysis, resolved.templateOverride);

  let candidates = buildCandidates(analysis, templateId, state, resolved);

  const scope = intake.sourceScope;
  if (scope !== undefined) {
    candidates = candidates.filter((c) => scope.includes(c.capability));
  }

  const recordedKeys = new Set(state.steps.map((s) => s.idempotencyKey));
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    const decision: Extract<PlannerDecision, { kind: "step" }> = {
      kind: "step",
      capability: candidate.capability,
      ...(candidate.toolName !== undefined ? { toolName: candidate.toolName } : {}),
      input: candidate.input,
      note: candidate.note,
    };
    const key = stableStepKey(state.runId, decision);
    if (seenKeys.has(key)) continue; // intra-plan duplicate: first wins
    seenKeys.add(key);
    if (recordedKeys.has(key)) continue; // already executed: never re-emit

    // Fetch-budget check: skip fetch candidates once the fetch budget is
    // spent; searches later in the ordering may still be affordable.
    if (
      candidate.capability === "document.fetch" &&
      state.spent.fetches >= state.budgets.maxFetches
    ) {
      continue;
    }

    // Global headroom: stop planning while verification still has budget.
    if (state.budgets.maxSteps - state.spent.steps <= resolved.headroomSteps) {
      return { kind: "finish" };
    }
    if (
      state.budgets.maxToolCalls - state.spent.toolCalls <=
      resolved.headroomToolCalls
    ) {
      return { kind: "finish" };
    }

    return decision;
  }

  return { kind: "finish" };
}

// ---------------------------------------------------------------------------
// Planner port factory
// ---------------------------------------------------------------------------

/**
 * Create the executor-facing Planner. Validates the intake up front (throws
 * IntakeValidationError) and fails fast when the selected template is
 * interface-only (TemplateNotImplementedError).
 */
export function createRulePlanner(
  intake: ResearchIntake,
  config?: RulePlannerConfig,
): Planner {
  const validation = validateResearchIntake(intake);
  if (!validation.ok) throw new IntakeValidationError(validation.errors);
  const validated = validation.intake;
  const resolved = resolveConfig(config);

  // Fail fast: building the static plan surfaces interface-only templates and
  // query-builder defects at construction time instead of mid-run.
  const analysis = analyzeIntake(validated);
  const templateId = selectTemplate(analysis, resolved.templateOverride);
  RESEARCH_TEMPLATES[templateId].buildStaticCalls(analysis);

  return {
    async next(state: Readonly<RunState>): Promise<PlannerDecision> {
      return planNextDecision(validated, state, resolved);
    },
  };
}
