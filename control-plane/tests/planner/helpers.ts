/**
 * Offline test fakes for the planner lane: a scripted capability executor, a
 * run-state factory, and outcome builders. No network, no clocks beyond fixed
 * ISO literals.
 */

import type { Outcome, ProviderCode } from "../../src/capabilities/types.js";
import type { CapabilityName } from "../../src/capabilities/registry.js";
import {
  DEFAULT_DEEP_BUDGET,
  newSpend,
  type ResearchBudgets,
} from "../../src/orchestration/budgets.js";
import {
  InMemoryRunStore,
  type AuthContext,
  type CapabilityExecutionContext,
  type CapabilityExecutionRequest,
  type CapabilityExecutor,
  type ExecutorPolicy,
  type RunState,
} from "../../src/orchestration/executor.js";
import type { ResearchIntake } from "../../src/planner/intake.js";

export const AUTH: AuthContext = {
  tenantId: "tenant-1",
  userId: "user-1",
  scopes: ["research:run"],
};

export const T0 = "2026-08-27T00:00:00Z";

export function makeIntake(question: string, extra?: Partial<ResearchIntake>): ResearchIntake {
  return { question, jurisdiction: "TR", dataClass: "L0", ...extra };
}

export function freshRunState(
  runId: string,
  question: string,
  budgets: ResearchBudgets = DEFAULT_DEEP_BUDGET,
): RunState {
  return {
    runId,
    status: "pending",
    query: question,
    dataClass: "L0",
    budgets,
    spent: newSpend(),
    authContext: AUTH,
    steps: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

export async function createRun(
  store: InMemoryRunStore,
  runId: string,
  question: string,
  budgets: ResearchBudgets = DEFAULT_DEEP_BUDGET,
): Promise<RunState> {
  const state = freshRunState(runId, question, budgets);
  await store.create(state);
  return state;
}

export function policyAllowingAll(
  budgets: ResearchBudgets = DEFAULT_DEEP_BUDGET,
): ExecutorPolicy {
  return {
    budgets,
    allowedCapabilities: new Set<CapabilityName>([
      "caseLaw.search",
      "legislation.search",
      "regulator.search",
      "document.fetch",
      "document.searchWithin",
      "legislation.resolveTarget",
      "source.health",
    ]),
  };
}

// ---------------------------------------------------------------------------
// Outcome builders
// ---------------------------------------------------------------------------

export function hitsOutcome(
  provider: ProviderCode,
  hits: Array<{ externalId: string; provider?: string; title?: string }>,
): Outcome<unknown> {
  return {
    status: "ok",
    data: hits.map((h) => ({
      hitId: `hit-${h.externalId}`,
      provider: h.provider ?? provider,
      toolName: "fake",
      externalId: h.externalId,
      title: h.title ?? `Karar ${h.externalId}`,
    })),
    provider,
    observedAt: T0,
    warnings: [],
  };
}

export function docOutcome(
  provider: ProviderCode,
  externalId: string,
  text: string,
): Outcome<unknown> {
  return {
    status: "ok",
    data: {
      source: provider,
      externalId,
      sourceUrl: `https://example.invalid/${externalId}`,
      retrievedAt: T0,
      mediaType: "text/markdown",
      text,
      contentSha256: "0".repeat(64),
    },
    provider,
    observedAt: T0,
    warnings: [],
  };
}

export function errorOutcome(provider: ProviderCode, kind: string): Outcome<unknown> {
  return {
    status: "error",
    provider,
    observedAt: T0,
    error: {
      kind: kind as never,
      retryable: true,
      correlationId: "corr-1",
      safeMessage: `upstream failure (${kind})`,
    },
  };
}

export function okOutcome(provider: ProviderCode, data: unknown): Outcome<unknown> {
  return { status: "ok", data, provider, observedAt: T0, warnings: [] };
}

// ---------------------------------------------------------------------------
// Fake capability executor (the test gateway)
// ---------------------------------------------------------------------------

export type CapabilityHandler = (
  request: CapabilityExecutionRequest,
  callIndex: number,
) => Outcome<unknown>;

export class FakeCapabilityExecutor implements CapabilityExecutor {
  readonly calls: CapabilityExecutionRequest[] = [];

  constructor(
    private readonly handlers: Partial<Record<CapabilityName, CapabilityHandler>>,
  ) {}

  async execute(
    request: CapabilityExecutionRequest,
    _ctx: CapabilityExecutionContext,
  ): Promise<Outcome<unknown>> {
    const index = this.calls.length;
    this.calls.push(request);
    const handler = this.handlers[request.capability];
    if (!handler) {
      throw new Error(`no fake handler for capability: ${request.capability}`);
    }
    return handler(request, index);
  }
}

/**
 * Which provider a document.fetch tool belongs to, and the id parameter it
 * reads. Mirrors the planner's fetch descriptors from the OUTSIDE, so a change
 * to the planner's raw arguments shows up as a test failure rather than as a
 * silently mis-shaped call.
 */
export const FETCH_TOOL_CONTRACT: Readonly<
  Record<string, { provider: ProviderCode; idParam: string }>
> = Object.freeze({
  fetch: { provider: "BEDESTEN", idParam: "id" },
  get_emsal_document_markdown: { provider: "EMSAL", idParam: "id" },
  get_anayasa_document_unified: { provider: "AYM", idParam: "document_url" },
  get_mevzuat_content: { provider: "MEVZUAT", idParam: "mevzuat_id" },
  get_kik_v2_document_markdown: { provider: "KIK", idParam: "gundemMaddesiId" },
  get_kvkk_document_markdown: { provider: "KVKK", idParam: "decision_url" },
  get_rekabet_kurumu_document: { provider: "REKABET", idParam: "karar_id" },
  get_sayistay_document_unified: { provider: "SAYISTAY", idParam: "decision_id" },
  get_bddk_document_markdown: { provider: "BDDK", idParam: "document_id" },
  get_btk_document_markdown: { provider: "BTK", idParam: "pdf_url" },
  get_gib_ozelge_document_markdown: { provider: "GIB", idParam: "ozelge_id" },
  get_sigorta_tahkim_document_markdown: { provider: "SIGORTA", idParam: "issue_number" },
});

/** The identifier a fetch call carries, resolved through the tool's contract. */
export function fetchedIdOf(request: {
  toolName?: string;
  input: Record<string, unknown>;
}): string | undefined {
  const contract = request.toolName ? FETCH_TOOL_CONTRACT[request.toolName] : undefined;
  if (!contract) return undefined;
  const value = request.input[contract.idParam];
  return typeof value === "string" ? value : undefined;
}

/**
 * Standard happy-path handlers: legislation search returns one mevzuat hit,
 * case-law/regulator searches return one hit each (unique external ids), the
 * within-law read returns article text (a string, i.e. no fetchable hits), the
 * resolver resolves, and document fetches return `caseLawText` for judicial
 * documents / `mevzuatText` for legislation documents.
 */
export function standardHandlers(options?: {
  caseLawText?: string;
  mevzuatText?: string;
  caseLawOutcome?: CapabilityHandler;
}): Partial<Record<CapabilityName, CapabilityHandler>> {
  const caseLawText =
    options?.caseLawText ??
    "Sanığın üzerine atılı suçun unsurları oluşmadığından kurulan hüküm incelendi.";
  const mevzuatText =
    options?.mevzuatText ?? "Bu Kanunun amacı ve kapsamı bu maddede düzenlenmiştir.";
  return {
    "legislation.search": (req, i) =>
      hitsOutcome("MEVZUAT", [
        { externalId: `mevzuat-${String(req.input["mevzuat_no"] ?? i)}` },
      ]),
    "caseLaw.search":
      options?.caseLawOutcome ??
      ((_req, i) => hitsOutcome("BEDESTEN", [{ externalId: `bedesten-${i}` }])),
    "regulator.search": (_req, i) => hitsOutcome("KVKK", [{ externalId: `kvkk-${i}` }]),
    "document.searchWithin": (req) =>
      okOutcome("MEVZUAT", `Madde metni: ${String(req.input["keyword"] ?? "")}`),
    "legislation.resolveTarget": (req) =>
      okOutcome("MEVZUAT", {
        logicalDocumentId: `ld-${String(req.input["targetLegislationNo"])}`,
        currentVersionId: "v-1",
        legislationNo: String(req.input["targetLegislationNo"]),
        asOf: "2026-08-27",
      }),
    "document.fetch": (req) => {
      const contract = req.toolName ? FETCH_TOOL_CONTRACT[req.toolName] : undefined;
      if (!contract) throw new Error(`unknown fetch tool: ${String(req.toolName)}`);
      const externalId = fetchedIdOf(req);
      if (externalId === undefined) {
        throw new Error(
          `fetch call for ${String(req.toolName)} is missing its ${contract.idParam} argument`,
        );
      }
      const text = contract.provider === "MEVZUAT" ? mevzuatText : caseLawText;
      return docOutcome(contract.provider, externalId, text);
    },
  };
}
