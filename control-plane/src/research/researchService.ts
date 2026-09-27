/**
 * Live deep-research service (Lane F2; brief §10 + §6.7).
 *
 * `runResearch` composes ONLY existing modules:
 *
 *   intake/plan     planner/intake + planner/rulePlanner templates (via the
 *                   livePlanner wrapper that owns the fetch phase and its
 *                   reserved contrary fetch)
 *   execution       orchestration/executor (bounded, budget-asserted, typed
 *                   partial on exhaustion) over the REAL provider gateway
 *                   through research/liveExecutor
 *   evidence        research/liveEvidence: quotes sliced from FETCHED FULL
 *                   TEXT at code-point offsets, hashed SHA-256 — a search
 *                   snippet is never evidence (brief 10.2)
 *   drafting        llm/ruleDrafter (deterministic, citation-first)
 *   verification    answer/verifier (deterministic validator + entailment +
 *                   finalize) — every citation re-validated against the
 *                   fetched canonical text
 *   rendering       answer/renderer + security/renderGuard
 *
 * The response body is AnswerResult-compatible (schema collex.answer.result/v1)
 * plus the ADDITIVE `research` block of contract §2.
 */

import { randomUUID } from "node:crypto";
import { CAPABILITY_NAMES } from "../capabilities/registry.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import {
  executeResearchRun,
  InMemoryRunStore,
  type RunState,
} from "../orchestration/executor.js";
import { newSpend, type ResearchBudgets } from "../orchestration/budgets.js";
import {
  analyzeIntake,
  IntakeValidationError,
  validateResearchIntake,
  type IntakeAnalysis,
  type ResearchIntake,
} from "../planner/intake.js";
import { buildContraryLanes, createCoverageVerifier, type ContraryFlavor, type ContraryLane } from "../planner/contrary.js";
import { parsePlannerNote } from "../planner/outcomes.js";
import { primaryQueryForIssue, selectTemplate, type TemplateId } from "../planner/templates.js";
import {
  buildEvidencePack,
  type AnswerCandidate,
  type EvidencePack,
  type EvidenceStance,
} from "../answer/evidencePack.js";
import { renderAnswerMarkdown, renderEvidenceBundle, escapeInline } from "../answer/renderer.js";
import { verifyAnswer, type AnswerDocument } from "../answer/verifier.js";
import { RuleBasedDrafter } from "../llm/ruleDrafter.js";
import { LexicalEntailmentPort } from "../llm/lexicalEntailment.js";
import { classifyStance } from "../pipeline/stance.js";
import { classifyQuestionIntent, extractLegalQuestion } from "../pipeline/questionIntent.js";
import { evaluateQuestionCoverage, type QuestionCoverageReport } from "../answer/coverage.js";
import {
  ANSWER_RESULT_SCHEMA,
  type AnswerResult,
  type ClaimView,
  type ContraryCoverage,
  type ContraryLaneRun,
  type EvidenceView,
  type StageTrace,
} from "../pipeline/types.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import {
  passesCourtDateFilters,
  type CourtDateFilters,
} from "../retrieval/searchService.js";
import { sanitizeAnswerMarkdown } from "../security/renderGuard.js";
import { checkFetchUrl } from "../security/urlPolicy.js";
import { codePointSlice } from "../verification/validator.js";
import {
  buildLiveCandidates,
  LiveDocumentStore,
  type LiveCandidateMetadata,
  type LiveFetchedDocument,
  type StoredLiveDocument,
} from "./liveEvidence.js";
import { createLiveCapabilityExecutor, type ToolCallTraceEntry } from "./liveExecutor.js";
import { createLiveResearchPlanner } from "./livePlanner.js";
import { progressLabelForTool, type ProgressListener } from "./progress.js";
import { failureClauseTr } from "../sources/searchService.js";
import type { EmbeddingPort } from "../retrieval/semanticRerank.js";
import { selectSemanticPassages, type PassageGroup } from "./semanticPassages.js";

// ---------------------------------------------------------------------------
// Local-mode constants and budgets
// ---------------------------------------------------------------------------

/** Single-user local tenant (see build brief: local mode, RLS bypass accepted). */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export interface ResearchRequestBudgets {
  maxToolCalls?: number;
  maxFetches?: number;
  maxWallTimeMs?: number;
}

export interface EffectiveResearchBudgets {
  maxToolCalls: number;
  maxFetches: number;
  maxWallTimeMs: number;
}

/** Contract §2 hard maxima — requests are CLAMPED to these, never trusted. */
export const RESEARCH_BUDGET_CEILING: Readonly<EffectiveResearchBudgets> = Object.freeze({
  maxToolCalls: 24,
  maxFetches: 10,
  maxWallTimeMs: 120_000,
});

export const DEFAULT_RESEARCH_BUDGETS: Readonly<EffectiveResearchBudgets> = Object.freeze({
  maxToolCalls: 16,
  maxFetches: 6,
  maxWallTimeMs: 90_000,
});

/** Clamp requested budgets into [1, ceiling]; absent dimensions use defaults. */
export function clampResearchBudgets(
  requested: ResearchRequestBudgets | undefined,
): EffectiveResearchBudgets {
  const clamp = (dimension: keyof EffectiveResearchBudgets): number => {
    const asked = requested?.[dimension];
    if (typeof asked !== "number" || !Number.isFinite(asked)) {
      return DEFAULT_RESEARCH_BUDGETS[dimension];
    }
    return Math.min(Math.max(1, Math.floor(asked)), RESEARCH_BUDGET_CEILING[dimension]);
  };
  return {
    maxToolCalls: clamp("maxToolCalls"),
    maxFetches: clamp("maxFetches"),
    maxWallTimeMs: clamp("maxWallTimeMs"),
  };
}

function toExecutorBudgets(effective: EffectiveResearchBudgets): ResearchBudgets {
  return {
    maxRounds: 4,
    // Replayed steps consume steps without tool calls; small margin only.
    maxSteps: effective.maxToolCalls + 4,
    maxToolCalls: effective.maxToolCalls,
    maxFetches: effective.maxFetches,
    // No LLM is wired in live research v1; these dimensions cannot bind.
    maxModelTokens: 1_000_000,
    maxWallTimeMs: effective.maxWallTimeMs,
    maxCostUsd: 1_000,
  };
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface ResearchToolCall extends ToolCallTraceEntry {}

export interface ResearchFetchedDocument {
  title: string;
  source: string;
  externalId: string;
  sha256: string;
  /** Additive: injection heuristics fired on this document's text. */
  injectionFlagged?: boolean;
}

export interface ResearchBlock {
  mode: "live";
  toolCalls: ResearchToolCall[];
  fetchedDocuments: ResearchFetchedDocument[];
  budgetSpent: { toolCalls: number; fetches: number; wallTimeMs: number };
  upstream: { healthy: boolean; notes: string[] };
}

/** AnswerResult (collex.answer.result/v1) plus the additive research block. */
export interface LiveResearchResult extends AnswerResult {
  research: ResearchBlock;
}

export interface RunResearchOptions {
  localPassageEmbedder?: EmbeddingPort;
  question: string;
  asOf?: string;
  budgets?: ResearchRequestBudgets;
  /** Accepted per contract; the uploaded-claims template is interface-only in v1. */
  fileIds?: readonly string[];
  /**
   * Additive court/date narrowing (contract D). Applied deterministically at
   * the evidence boundary: a fetched RULING outside the requested courts or
   * date range never becomes citable evidence (norm texts pass untouched).
   * Exclusions are counted in a EVIDENCE_FILTERED warning, never silent.
   */
  filters?: CourtDateFilters;
  gateway: ProviderGateway;
  /** Injectable clocks/ids for deterministic tests. */
  now?: () => string;
  monotonic?: () => number;
  newRunId?: () => string;
  today?: () => string;
  /**
   * Additive (W12-F): start/end event per gateway call with a Turkish label
   * (research/progress.ts) — the async run endpoint's progress feed.
   */
  onProgress?: ProgressListener;
  /** Additive (W12-F): per-call ceiling for the gateway AbortSignal. */
  perCallTimeoutMs?: number;
}

export interface LiveResearchRun {
  result: LiveResearchResult;
  document: AnswerDocument;
  pack: EvidencePack;
  state: RunState;
  /** documentVersionId -> canonical fetched text (bundle texts=true path). */
  texts: Record<string, string>;
  /**
   * Additive (W14/B-20): every FULL document this run fetched, canonicalized
   * and hashed, with its provenance (source, externalId, sourceUrl, tool,
   * retrievedAt). The router spools these into the lawyer's local library;
   * the run itself keeps no opinion about whether that happens.
   */
  fetched: readonly LiveFetchedDocument[];
  /**
   * True when the run searched NOTHING: no search call was answered and no
   * document was fetched (or, with no search planned at all, every gateway
   * call failed at the transport level). The routes turn it into the typed
   * 502 UPSTREAM_UNAVAILABLE — never an ABSTAIN that reads "not found".
   */
  unreachable: boolean;
}

export { IntakeValidationError } from "../planner/intake.js";

export const LIVE_CORPUS_NOTICE =
  "CANLI ARAŞTIRMA — bu cevaptaki alıntılar, çalışma anında resmî kaynaklardan " +
  "(Bedesten/UYAP ve ilgili kurum servisleri) çekilen TAM BELGE metinlerinden alınmış ve " +
  "SHA-256 ile mühürlenmiştir; arama özeti asla kanıt olarak kullanılmaz. Sonuçlar " +
  "resmî kaynak sunucularının erişilebilirliğine bağlıdır ve eksik olabilir; hukukî işlem " +
  "öncesi avukat incelemesi gereklidir.";

// ---------------------------------------------------------------------------
// Step-derived helpers (typed fields only; document text never steers these)
// ---------------------------------------------------------------------------

const SEARCH_CAPABILITIES: ReadonlySet<string> = new Set([
  "caseLaw.search",
  "legislation.search",
  "regulator.search",
]);

interface IdentityInfo {
  roles: Set<string>;
  metadata: LiveCandidateMetadata & { title?: string };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Roles + citation metadata per (provider|externalId), from typed hit rows. */
function collectIdentityInfo(state: Readonly<RunState>): Map<string, IdentityInfo> {
  const info = new Map<string, IdentityInfo>();
  for (const step of state.steps) {
    const note = parsePlannerNote(step.decision.note);
    if (!note || !SEARCH_CAPABILITIES.has(step.decision.capability)) continue;
    if (step.outcome.status === "error") continue;
    const data: unknown = step.outcome.data;
    if (!Array.isArray(data)) continue;
    for (const item of data) {
      if (item === null || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const externalId = asString(row["externalId"]);
      if (externalId === undefined) continue;
      const provider = asString(row["provider"]) ?? step.outcome.provider;
      const key = `${provider}|${externalId}`;
      let entry = info.get(key);
      if (entry === undefined) {
        const title = asString(row["title"]);
        const legislationNo =
          provider === "MEVZUAT" && title !== undefined
            ? title.match(/^(\d+)\s+sayılı/u)?.[1]
            : undefined;
        entry = {
          roles: new Set<string>(),
          metadata: {
            ...(asString(row["court"]) !== undefined ? { court: asString(row["court"]) as string } : {}),
            ...(asString(row["decisionDate"]) !== undefined
              ? { decisionDate: asString(row["decisionDate"]) as string }
              : {}),
            ...(asString(row["docketNo"]) !== undefined
              ? { docketNo: asString(row["docketNo"]) as string }
              : {}),
            ...(asString(row["decisionNo"]) !== undefined
              ? { decisionNo: asString(row["decisionNo"]) as string }
              : {}),
            ...(legislationNo !== undefined ? { legislationNo } : {}),
            ...(title !== undefined ? { title } : {}),
          },
        };
        info.set(key, entry);
      }
      entry.roles.add(note.role);
    }
  }
  return info;
}

function contraryFlavorForTemplate(templateId: TemplateId): ContraryFlavor {
  if (templateId === "aym_norm_denetimi") return "aym";
  if (templateId === "yargitay_danistay_contrary") return "divergence";
  return "general";
}

function laneQueryOf(input: Record<string, unknown>): string {
  const phrase = asString(input["phrase"]) ?? asString(input["icerik"]);
  if (phrase !== undefined) return phrase;
  const keywords = input["keywords"];
  if (Array.isArray(keywords)) return keywords.filter((k) => typeof k === "string").join(" ");
  return "";
}

function buildContraryLaneRuns(
  analysis: IntakeAnalysis,
  templateId: TemplateId,
  state: Readonly<RunState>,
): ContraryLaneRun[] {
  const flavor = contraryFlavorForTemplate(templateId);
  const expectedByIssue = new Map<string, ContraryLane[]>();
  const labelByIssue = new Map<string, string>();
  for (const issue of analysis.issues) {
    expectedByIssue.set(issue.issueId, buildContraryLanes(primaryQueryForIssue(issue), flavor));
    labelByIssue.set(issue.issueId, issue.label);
  }

  const laneIndexByIssue = new Map<string, number>();
  const seenIdentities = new Set<string>();
  const runs: ContraryLaneRun[] = [];

  for (const step of state.steps) {
    const note = parsePlannerNote(step.decision.note);
    if (!note) continue;
    // Track identities seen by ALL evidence searches (for newPassages).
    const rows: unknown = step.outcome.status === "error" ? [] : step.outcome.data;
    const identities: string[] = [];
    if (Array.isArray(rows)) {
      for (const item of rows) {
        if (item === null || typeof item !== "object") continue;
        const externalId = asString((item as Record<string, unknown>)["externalId"]);
        if (externalId !== undefined) identities.push(externalId);
      }
    }
    if (note.role !== "contrary") {
      for (const id of identities) seenIdentities.add(id);
      continue;
    }

    const index = laneIndexByIssue.get(note.issueId) ?? 0;
    laneIndexByIssue.set(note.issueId, index + 1);
    const expected = expectedByIssue.get(note.issueId)?.[index];
    const newPassages = identities.filter((id) => !seenIdentities.has(id)).length;
    for (const id of identities) seenIdentities.add(id);

    runs.push({
      issueId: note.issueId,
      issueLabel: labelByIssue.get(note.issueId) ?? note.issueId,
      kind: expected?.kind ?? "contrary",
      baseTerm: expected?.baseTerm ?? "",
      flipPhrase: expected?.flipPhrase ?? "",
      query: laneQueryOf(step.decision.input),
      status: step.outcome.status,
      hits: identities.length,
      newPassages,
      ...(step.outcome.status !== "ok" && "error" in step.outcome
        ? { error: step.outcome.error.kind }
        : {}),
    });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Views (local mirrors of the answer pipeline's converters)
// ---------------------------------------------------------------------------

function toClaimView(claim: AnswerDocument["claims"][number]): ClaimView {
  return {
    claimId: claim.claim.claimId,
    text: claim.claim.text,
    material: claim.claim.material,
    treatment: claim.claim.treatment,
    verdict: claim.verdict,
    evidenceIds: claim.citationChecks.filter((c) => c.ok).map((c) => c.evidenceId),
    draftedEvidenceIds: [...claim.claim.evidenceIds],
    contraryEvidenceIds: [...claim.contraryEvidenceIds],
    confidence: { ...claim.claim.confidence },
    citationChecks: claim.citationChecks.map((c) => ({
      evidenceId: c.evidenceId,
      ok: c.ok,
      ...(c.reason !== undefined ? { reason: c.reason } : {}),
    })),
    entailments: claim.entailments.map((e) => ({
      evidenceId: e.evidenceId,
      entails: e.judgement.entails,
      score: e.judgement.score,
      rationale: e.judgement.rationale,
    })),
    reasons: [...claim.reasons],
  };
}

function liveDocumentType(source: string): string {
  return source === "MEVZUAT" ? "mevzuat" : "karar";
}

/** Bound article identities, never a cross-product of law and article numbers. */
function liveReferenceKeys(text: string): Set<string> {
  const keys = new Set<string>();
  let law: string | undefined;
  for (const ref of parseReferences(text)) {
    if (ref.kind === "legislation") law = ref.legislationNo;
    if (ref.kind === "article" && law !== undefined && ref.articleNo !== undefined) {
      keys.add(`law:${law}:${ref.articleKind ?? "madde"}:${ref.articleNo}`);
    }
    if (ref.kind === "court_decision" && ref.docketNo && ref.decisionNo) {
      keys.add(`decision:${ref.docketNo}:${ref.decisionNo}`);
      law = undefined;
    }
  }
  return keys;
}

function toLiveEvidenceView(
  item: EvidencePack["items"][number],
  rolesByVersionId: Map<string, readonly string[]>,
): EvidenceView {
  const ref = item.ref;
  const documentType = liveDocumentType(ref.source);
  const stance = classifyStance(documentType, ref.quote);
  const urlCheck = checkFetchUrl(ref.sourceUrl);
  return {
    // W12-B2/API2: a live passage was fetched from an official source at run
    // time — say so on every surface ("canlı resmî kaynak"), exactly as the
    // answer pipeline stamps `item.origin ?? "corpus"`.
    origin: item.origin ?? "live",
    evidenceId: ref.evidenceId,
    documentId: ref.documentId,
    documentVersionId: ref.documentVersionId,
    chunkId: ref.chunkId,
    source: ref.source,
    sourceUrl: ref.sourceUrl,
    sourceUrlAllowed: urlCheck.ok,
    title: ref.title,
    documentType,
    ...(ref.court !== undefined ? { court: ref.court } : {}),
    ...(ref.decisionDate !== undefined ? { decisionDate: ref.decisionDate } : {}),
    ...(ref.docketNo !== undefined ? { docketNo: ref.docketNo } : {}),
    ...(ref.decisionNo !== undefined ? { decisionNo: ref.decisionNo } : {}),
    ...(ref.legislationNo !== undefined ? { legislationNo: ref.legislationNo } : {}),
    ...(ref.locator.article !== undefined ? { article: ref.locator.article } : {}),
    ...(ref.locator.paragraph !== undefined ? { paragraph: ref.locator.paragraph } : {}),
    startChar: ref.locator.startChar,
    endChar: ref.locator.endChar,
    quote: ref.quote,
    quoteSha256: ref.quoteSha256,
    contentSha256: ref.contentSha256,
    retrievedAt: ref.retrievedAt,
    authority: item.authority,
    currentness: item.currentness,
    stance: item.stance,
    polarity: stance.polarity,
    polarityMarkers: stance.markers,
    retrievalScore: item.retrievalScore,
    retrieval: {
      pinned: false,
      fusedScore: item.retrievalScore,
      lanes: ["live-fetch"],
      queries: [...(rolesByVersionId.get(ref.documentVersionId) ?? [])],
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown fragments
// ---------------------------------------------------------------------------

function renderLiveBanner(notice: string): string {
  return [
    "> **CANLI ARAŞTIRMA UYARISI**",
    ...escapeInline(notice)
      .split(/\r?\n/u)
      .map((line) => `> ${line}`),
  ].join("\n");
}

function renderResearchSection(
  trace: readonly ToolCallTraceEntry[],
  docs: readonly StoredLiveDocument[],
  budgetSpent: ResearchBlock["budgetSpent"],
  upstream: ResearchBlock["upstream"],
): string {
  const out: string[] = [
    "## Canlı Araştırma İzi",
    "",
    `Araç çağrısı: ${trace.length} (başarısız: ${trace.filter((t) => !t.ok).length}); ` +
      `tam belge getirme: ${budgetSpent.fetches}; resmî kaynak sunucuları: ${upstream.healthy ? "sağlıklı" : "SORUNLU"}.`,
  ];
  if (trace.length > 0) {
    out.push("", "| Yetenek | Araç | Durum | Sonuç |", "| --- | --- | --- | --- |");
    for (const call of trace) {
      out.push(
        `| ${escapeInline(call.capability)} | ${escapeInline(call.tool)} | ` +
          `${call.ok ? "ok" : "HATA"} | ${call.resultCount ?? "-"} |`,
      );
    }
  }
  if (docs.length > 0) {
    out.push("", "### Tam metni çekilen belgeler", "");
    for (const stored of docs) {
      out.push(
        `- ${escapeInline(stored.doc.title)} — ${escapeInline(stored.doc.source)}/` +
          `${escapeInline(stored.doc.externalId)} (SHA-256 ${stored.doc.contentSha256.slice(0, 12)}…)`,
      );
    }
  }
  // One line per DISTINCT note, Turkish first, the machine note in
  // parentheses (27.09.2026: an outage printed thirteen bare
  // "Not: SEARCH_DEGRADED:…:UNAVAILABLE" lines — a machine code standing
  // alone in front of the lawyer, thirteen times).
  const counts = new Map<string, number>();
  for (const note of upstream.notes) counts.set(note, (counts.get(note) ?? 0) + 1);
  for (const [note, count] of counts) {
    out.push(`- Not: ${renderUpstreamNote(note)}${count > 1 ? ` — ${count} kez` : ""}`);
  }
  return out.join("\n");
}

/**
 * One upstream note as a Turkish sentence with the machine note kept in
 * parentheses at its end. An unknown note keeps its old (escaped) form.
 */
export function renderUpstreamNote(note: string): string {
  const code = `(${escapeInline(note)})`;
  const [head, tool, kind] = note.split(":");
  const subject = (): string =>
    escapeInline(progressLabelForTool(tool, head === "FETCH_DEGRADED" ? "document.fetch" : ""));
  switch (head) {
    case "SEARCH_DEGRADED":
      return `Arama sonuç vermedi — ${subject()}: ${failureClauseTr(kind ?? "")} ${code}`;
    case "SEARCH_PARTIAL":
      return `Arama kısmî sonuç verdi, liste eksik olabilir — ${subject()}: ${failureClauseTr(kind ?? "")} ${code}`;
    case "FETCH_DEGRADED":
      return `Tam metin alınamadı — ${subject()}: ${failureClauseTr(kind ?? "")} ${code}`;
    case "WITHIN_DEGRADED":
      return `Belge içinde arama yapılamadı — ${subject()}: ${failureClauseTr(kind ?? "")} ${code}`;
    case "INJECTION_FLAGGED":
      return (
        "Çekilen bir belgede programa iş yaptırmaya çalışan gizli bir yazı olabilir; " +
        `içindeki yönergelere uyulmadı, metni kaynağından doğrulayın ${code}`
      );
    case "UPSTREAM_DEGRADED": {
      const match = /^(\d+)\/(\d+)/u.exec(tool ?? "");
      if (match === null) return `Resmî kaynakların bir kısmı cevap vermedi ${code}`;
      const failed = Number(match[1]);
      const total = Number(match[2]);
      return failed >= total
        ? `Resmî kaynaklara yapılan ${total} çağrının HİÇBİRİ cevap vermedi; ` +
            `bu bir “bulunamadı” sonucu değildir ${code}`
        : `Resmî kaynaklara yapılan ${total} çağrıdan ${failed} tanesi cevap vermedi; ` +
            `sonuç eksik olabilir ${code}`;
    }
    default:
      return escapeInline(note);
  }
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export async function runResearch(options: RunResearchOptions): Promise<LiveResearchRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const monotonic = options.monotonic ?? (() => Date.now());
  const newRunId = options.newRunId ?? (() => randomUUID());
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10));

  const stages: StageTrace[] = [];
  const stage = async <T>(
    name: string,
    body: (counts: Record<string, number>, notes: string[]) => Promise<T> | T,
  ): Promise<T> => {
    const counts: Record<string, number> = {};
    const stageNotes: string[] = [];
    const started = monotonic();
    try {
      return await body(counts, stageNotes);
    } finally {
      stages.push({
        name,
        ms: Math.max(0, Math.round((monotonic() - started) * 100) / 100),
        counts,
        notes: stageNotes,
      });
    }
  };

  const warnings: string[] = [];
  const upstreamNotes: string[] = [];
  const trace: ToolCallTraceEntry[] = [];
  const runId = newRunId();
  const generatedAt = now();

  // ---- intake --------------------------------------------------------------
  const { intake, analysis, asOf, templateId } = await stage("intake", (counts, stageNotes) => {
    const validated = validateResearchIntake({
      question: options.question,
      jurisdiction: "TR",
      dataClass: "L0",
      ...(options.asOf !== undefined ? { asOf: options.asOf } : {}),
    });
    if (!validated.ok) throw new IntakeValidationError(validated.errors);
    const resolvedAsOf = validated.intake.asOf ?? today();
    const intakeAnalysis = analyzeIntake(validated.intake);
    const template = selectTemplate(intakeAnalysis);
    counts["issues"] = intakeAnalysis.issues.length;
    stageNotes.push(`asOf=${resolvedAsOf}`, `template=${template}`);
    return {
      intake: validated.intake,
      analysis: intakeAnalysis,
      asOf: resolvedAsOf,
      templateId: template,
    };
  });

  if (options.fileIds !== undefined && options.fileIds.length > 0) {
    // Contract carries fileIds; the uploaded-claims research template is
    // interface-only in v1 (brief §11), so this is recorded, never silent.
    warnings.push(`FILE_IDS_IGNORED:uploaded_claims_counter_evidence is interface-only in v1`);
  }

  const effectiveBudgets = clampResearchBudgets(options.budgets);
  const researchStartedAt = monotonic();
  const executorBudgets = toExecutorBudgets(effectiveBudgets);

  // ---- plan + execute (bounded) -------------------------------------------
  const docStore = new LiveDocumentStore();
  const runStore = new InMemoryRunStore();
  const finalState = await stage("execute", async (counts, stageNotes) => {
    const planner = createLiveResearchPlanner(intake, {
      maxFetches: effectiveBudgets.maxFetches,
    });
    // Every gateway call is bounded by min(per-call ceiling, wall budget
    // left) so one hung upstream cannot outlive the run's own budget.
    const executeStartedAt = monotonic();
    const capabilities = createLiveCapabilityExecutor({
      gateway: options.gateway,
      docStore,
      trace,
      notes: upstreamNotes,
      monotonic,
      now,
      remainingBudgetMs: () =>
        effectiveBudgets.maxWallTimeMs - Math.max(0, monotonic() - executeStartedAt),
      fetchBudget: effectiveBudgets.maxFetches,
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      ...(options.perCallTimeoutMs !== undefined
        ? { perCallTimeoutMs: options.perCallTimeoutMs }
        : {}),
    });
    const verifier = createCoverageVerifier(intake);
    const state: RunState = {
      runId,
      status: "pending",
      query: intake.question,
      dataClass: intake.dataClass,
      budgets: executorBudgets,
      spent: newSpend(),
      authContext: {
        tenantId: LOCAL_TENANT_ID,
        userId: "local",
        scopes: ["research:run"],
      },
      steps: [],
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };
    await runStore.create(state);
    const result = await executeResearchRun(
      runId,
      { runs: runStore, planner, capabilities, verifier, now: monotonic },
      { budgets: executorBudgets, allowedCapabilities: new Set(CAPABILITY_NAMES) },
    );
    counts["steps"] = result.steps.length;
    counts["toolCalls"] = result.spent.toolCalls;
    counts["fetches"] = result.spent.fetches;
    stageNotes.push(`status=${result.status}`);
    if (result.partialReason !== undefined) stageNotes.push(result.partialReason);
    return result;
  });

  // ---- evidence from fetched full texts ------------------------------------
  const identityInfo = collectIdentityInfo(finalState);
  const queryText = [
    intake.question,
    ...analysis.issues.flatMap((issue) => issue.expandedTerms),
  ].join(" ");

  const rolesByVersionId = new Map<string, readonly string[]>();
  const { pack: retrievedPack } = await stage("evidence", async (counts) => {
    let candidates: AnswerCandidate[] = [];
    const passageGroups: PassageGroup[] = [];
    const stockAffirmanceExcluded = new Set<string>();
    let filteredOut = 0;
    for (const stored of docStore.list()) {
      const key = `${stored.doc.source}|${stored.doc.externalId}`;
      const info = identityInfo.get(key);
      const roles = info !== undefined ? [...info.roles].sort() : [];
      rolesByVersionId.set(stored.documentVersionId, roles);
      // Contract D: the user's court/date filter is enforced at the evidence
      // boundary — an out-of-scope ruling is excluded and COUNTED, not
      // silently dropped. Norm texts always pass (see passesCourtDateFilters).
      const futureDecision = liveDocumentType(stored.doc.source) === "karar" &&
        info?.metadata.decisionDate !== undefined && info.metadata.decisionDate > asOf;
      if (
        futureDecision ||
        !passesCourtDateFilters(
          {
            documentType: liveDocumentType(stored.doc.source),
            title: info?.metadata.title ?? stored.doc.title,
            court: info?.metadata.court ?? null,
            decisionDate: info?.metadata.decisionDate ?? null,
            docketNo: info?.metadata.docketNo ?? null,
            decisionNo: info?.metadata.decisionNo ?? null,
          },
          options.filters,
        )
      ) {
        filteredOut += 1;
        continue;
      }
      const contraryOnly = roles.length > 0 && roles.every((role) => role === "contrary");
      const metadata: LiveCandidateMetadata = { ...(info?.metadata ?? {}) };
      const title = info?.metadata.title;
      const docForCandidates: StoredLiveDocument =
        title !== undefined
          ? { ...stored, doc: { ...stored.doc, title } }
          : stored;
      const candidateOptions = {
        queryText,
        questionText: extractLegalQuestion(intake.question).legalQuestion,
        onStockAffirmanceExcluded: () => { stockAffirmanceExcluded.add(stored.documentVersionId); },
        preferReasoning: liveDocumentType(stored.doc.source) === "karar",
        stance: "neutral" as const,
        metadata,
      };
      const fallback = buildLiveCandidates(docForCandidates, candidateOptions);
      const base = options.localPassageEmbedder === undefined ? fallback :
        buildLiveCandidates(docForCandidates, { ...candidateOptions, quotes: { maxSpans: 4 } });
      const withStance = (candidate: AnswerCandidate): AnswerCandidate => {
        const stance: EvidenceStance = contraryOnly
          ? "contrary"
          : classifyStance(
              liveDocumentType(stored.doc.source),
              codePointSlice(stored.doc.text, candidate.startChar, candidate.endChar),
            ).stance;
        return { ...candidate, stance };
      };
      candidates.push(...fallback.map(withStance));
      passageGroups.push({ text: stored.doc.text, candidates: base.map(withStance), fallback: fallback.map(withStance) });
    }
    if (options.localPassageEmbedder !== undefined) {
      const selection = await selectSemanticPassages(passageGroups, extractLegalQuestion(intake.question).legalQuestion,
        options.localPassageEmbedder, effectiveBudgets.maxWallTimeMs - Math.max(0, monotonic() - researchStartedAt));
      candidates = selection.candidates;
      counts["semanticPassageSelectionApplied"] = selection.applied ? 1 : 0;
      if (selection.reason !== undefined) warnings.push(selection.reason);
    }
    // `defaultOrigin: "live"` (W12-B2 request) stamps every fetched passage:
    // the source card, the evidence bundle and the stored answer then carry
    // origin "live"; currentness is assessed like corpus text (ordinary
    // yürürlük rules), never the upload exemption.
    const built = await buildEvidencePack(candidates, docStore.textPort(), {
      asOf,
      now,
      defaultOrigin: "live",
    });
    for (const rejected of built.rejected) {
      warnings.push(`EVIDENCE_REJECTED:${rejected.candidate.chunkId}:${rejected.reason}`);
    }
    if (filteredOut > 0) warnings.push(`EVIDENCE_FILTERED:${filteredOut}`);
    counts["documents"] = docStore.list().length;
    counts["candidates"] = candidates.length;
    if (stockAffirmanceExcluded.size > 0) counts["stockAffirmanceDocumentsExcluded"] = stockAffirmanceExcluded.size;
    counts["accepted"] = built.items.length;
    counts["rejected"] = built.rejected.length;
    counts["filteredOut"] = filteredOut;
    return { pack: built };
  });

  // Apply the same question gate as local research. A verified quotation is
  // not itself proof that the retrieved document answers this question.
  const legalQuestion = extractLegalQuestion(intake.question);
  const requestedRefs = liveReferenceKeys(intake.question);
  const matchesReference = (quote: string) =>
    [...liveReferenceKeys(quote)].some((key) => requestedRefs.has(key));
  // A relevant passage must not admit every unrelated neighbour. The same
  // floor and reference exception apply independently to each candidate.
  const admitted = retrievedPack.items.filter((item) => evaluateQuestionCoverage(
    legalQuestion.legalQuestion, [item.ref.quote],
    { referenceMatched: matchesReference(item.ref.quote) },
  ).gate !== "failed");
  const referenceMatched = admitted.some((item) => matchesReference(item.ref.quote));
  const coverageDecision = evaluateQuestionCoverage(
    legalQuestion.legalQuestion, admitted.map((item) => item.ref.quote),
    { referenceMatched },
  );
  const accepted = coverageDecision.gate === "failed" ? [] : admitted;
  const setAside = retrievedPack.items.filter((item) => !accepted.includes(item));
  const coverage: QuestionCoverageReport = { ...coverageDecision, setAside: setAside.length };
  const pack: EvidencePack = { ...retrievedPack, items: accepted };
  if (setAside.length > 0) warnings.push(`QUESTION_NOT_COVERED:${setAside.length}`);

  // ---- draft ---------------------------------------------------------------
  let drafterFailed = false;
  const drafts = await stage("draft", async (counts) => {
    try {
      const produced = await new RuleBasedDrafter().draftClaims({
        question: intake.question,
        pack,
      });
      counts["claims"] = produced.length;
      return produced;
    } catch {
      drafterFailed = true;
      warnings.push("DRAFTER_FAILED");
      counts["claims"] = 0;
      return [];
    }
  });

  // ---- verify --------------------------------------------------------------
  const document = await stage("verify", async (counts, stageNotes) => {
    const doc = await verifyAnswer(
      intake.question,
      pack,
      drafts,
      new LexicalEntailmentPort(),
      { now, coverage },
    );
    counts["claims"] = doc.claims.length;
    stageNotes.push(`status=${doc.status}`);
    return doc;
  });

  // ---- degradation + status mapping ---------------------------------------
  const failedCalls = trace.filter((t) => !t.ok).length;
  const timedOutCalls = trace.filter((t) => t.status === "timeout").length;
  const upstreamHealthy = trace.length === 0 ? true : failedCalls * 2 <= trace.length;
  const everyCallFailed = trace.length > 0 && failedCalls === trace.length;
  if (!upstreamHealthy) {
    upstreamNotes.push(`UPSTREAM_DEGRADED:${failedCalls}/${trace.length} tool calls failed`);
  }
  // A timed-out call is reported apart from an upstream error (W12-F): the
  // remedy differs (wait/retry vs. the source being down).
  if (timedOutCalls > 0) warnings.push(`TIMEOUT:${timedOutCalls}`);
  const gatewaySteps = finalState.steps.filter((s) => s.decision.toolName !== undefined);
  // MEASURED DEFECT, 27.09.2026: `unreachable` required EVERY step to be
  // UNAVAILABLE/TIMEOUT, so with 13 of 14 calls failed — the 14th a
  // search-within whose "result" was an error string — the run answered 200
  // PARTIAL with NO_EVIDENCE, which the console reads as "Bu bilgisayardaki
  // arşivde … bulunamadı": a false negative the lawyer would rely on. The
  // question is not what KIND each failure had but whether ANY search was
  // answered: evidence only ever comes from a search hit that was fetched, so
  // a run in which no search answered and nothing was fetched searched
  // nothing.
  const searchSteps = gatewaySteps.filter((s) => SEARCH_CAPABILITIES.has(s.decision.capability));
  const searchAnswered = searchSteps.some((s) => s.outcome.status !== "error");
  const noSearchAnswered = searchSteps.length > 0 && !searchAnswered && docStore.list().length === 0;
  const unreachable =
    gatewaySteps.length > 0 &&
    (noSearchAnswered ||
      gatewaySteps.every(
        (s) =>
          s.outcome.status === "error" &&
          (s.outcome.error.kind === "UNAVAILABLE" || s.outcome.error.kind === "TIMEOUT"),
      ));

  const degradedReasons: string[] = [];
  if (finalState.status === "partial" || finalState.status === "failed") {
    degradedReasons.push(finalState.partialReason ?? "RESEARCH_COVERAGE_INCOMPLETE");
  }
  // "Some sources did not answer" and "none did" are different sentences.
  if (!upstreamHealthy) degradedReasons.push(everyCallFailed ? "UPSTREAM_DEGRADED:ALL" : "UPSTREAM_DEGRADED");
  if (drafterFailed) degradedReasons.push("DRAFTER_DEGRADED");

  // NO_EVIDENCE means "we looked and found nothing". With no answered search
  // nobody looked, so that sentence may not be shown.
  const baseReasons = noSearchAnswered
    ? document.reasons.filter((reason) => reason !== "NO_EVIDENCE")
    : document.reasons;
  const finalDocument: AnswerDocument =
    degradedReasons.length > 0 || baseReasons !== document.reasons
      ? {
          ...document,
          status: "PARTIAL",
          finalizable: false,
          reasons: [...baseReasons, ...degradedReasons],
        }
      : document;

  // ---- render --------------------------------------------------------------
  const contraryLaneRuns = buildContraryLaneRuns(analysis, templateId, finalState);
  const contraryEvidenceIds = pack.items
    .filter((item) => item.stance === "contrary")
    .map((item) => item.ref.evidenceId);
  const conflictedClaimIds = finalDocument.claims
    .filter((c) => c.verdict === "CONFLICTING_AUTHORITIES")
    .map((c) => c.claim.claimId);
  const intent = classifyQuestionIntent(intake.question, parseReferences(intake.question));
  const laneNote = [
    contraryLaneRuns.length > 0
      ? `${contraryLaneRuns.length} karşıt otorite sorgusu çalıştırıldı`
      : "Karşıt otorite sorgusu çalıştırılmadı",
    contraryEvidenceIds.length > 0
      ? `${contraryEvidenceIds.length} pasaj karşıt otorite olarak sınıflandırıldı`
      : "karşıt otorite pasajı bulunamadı",
    conflictedClaimIds.length > 0
      ? `${conflictedClaimIds.length} tespit ÇELİŞEN OTORİTELER olarak işaretlendi`
      : "hiçbir tespitte çelişki tespit edilmedi",
  ].join("; ");
  const contraryCoverage: ContraryCoverage = {
    executed: contraryLaneRuns.length > 0,
    // The live research lane never skips a planned contrary lane (V-21 is a
    // local-corpus economy): the planner's lanes are the run.
    skipped: false,
    usable: contraryLaneRuns.some((lane) => lane.status === "ok" || lane.status === "partial"),
    lanes: contraryLaneRuns,
    contraryEvidenceIds,
    conflictedClaimIds,
    observed: setAside.map((item) => {
      const documentType = liveDocumentType(item.ref.source);
      const stance = classifyStance(documentType, item.ref.quote);
      return {
        chunkId: item.ref.chunkId, documentVersionId: item.ref.documentVersionId,
        title: item.ref.title, documentType, polarity: stance.polarity,
        polarityMarkers: stance.markers, reason: "QUESTION_NOT_COVERED",
      };
    }),
    scope: { intent: intent.intent, rationale: intent.rationale, scopedOut: setAside.length },
    note: `${laneNote}.`,
  };

  const budgetSpent: ResearchBlock["budgetSpent"] = {
    toolCalls: finalState.spent.toolCalls,
    fetches: finalState.spent.fetches,
    wallTimeMs: finalState.spent.wallTimeMs,
  };
  const upstream: ResearchBlock["upstream"] = {
    healthy: upstreamHealthy,
    notes: upstreamNotes,
  };

  const markdown = await stage("render", (counts) => {
    const body = [
      renderLiveBanner(LIVE_CORPUS_NOTICE),
      renderAnswerMarkdown(finalDocument),
      renderResearchSection(trace, docStore.list(), budgetSpent, upstream),
    ].join("\n\n");
    const guarded = sanitizeAnswerMarkdown(body);
    counts["markdownChars"] = guarded.length;
    return guarded;
  });

  const result: LiveResearchResult = {
    schema: ANSWER_RESULT_SCHEMA,
    runId,
    question: intake.question,
    normalizedQuestion: normalizeTurkishSearch(intake.question),
    asOf,
    status: finalDocument.status,
    finalizable: finalDocument.finalizable,
    reasons: [...finalDocument.reasons],
    warnings,
    claims: finalDocument.claims.map(toClaimView),
    evidence: pack.items.map((item) => toLiveEvidenceView(item, rolesByVersionId)),
    rejectedEvidence: pack.rejected.map((rejected) => ({
      chunkId: rejected.candidate.chunkId,
      documentVersionId: rejected.candidate.documentVersionId,
      title: rejected.candidate.title,
      reason: rejected.reason,
    })),
    contraryCoverage,
    trace: stages.map((s) => ({ ...s, counts: { ...s.counts }, notes: [...s.notes] })),
    markdown,
    bundle: {
      ...renderEvidenceBundle(finalDocument),
      synthetic: false,
      syntheticNotice: LIVE_CORPUS_NOTICE,
      producer: "collex.control-plane/researchService v1 (live)",
    },
    corpusNotice: LIVE_CORPUS_NOTICE,
    generatedAt,
    coverage: { ...coverage, measuredOn: legalQuestion.measuredOn },
    research: {
      mode: "live",
      toolCalls: trace.map((t) => ({ ...t })),
      fetchedDocuments: docStore.list().map((stored) => ({
        title: stored.doc.title,
        source: stored.doc.source,
        externalId: stored.doc.externalId,
        sha256: stored.doc.contentSha256,
        ...(stored.injection.flagged ? { injectionFlagged: true } : {}),
      })),
      budgetSpent,
      upstream,
    },
  };

  return {
    result,
    document: finalDocument,
    pack,
    state: finalState,
    texts: docStore.texts(),
    fetched: Object.freeze(docStore.list().map((stored) => stored.doc)),
    unreachable,
  };
}
