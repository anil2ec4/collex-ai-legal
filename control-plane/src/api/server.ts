/**
 * ColleX control-plane v1 HTTP API (hono).
 *
 * Routes (see src/api/openapi.yaml):
 *   GET  /                                     -> operator console (static)
 *   GET  /console                              -> same page
 *   GET  /v1/health                            -> liveness + db/mcp/ai/corpus (contract [H])
 *   POST /v1/search                            -> Outcome<SearchHit[]>
 *   POST /v1/answer                            -> AnswerResult (citation-first)
 *   GET  /v1/answers?matterId=&fileId=&limit=  -> { answers: AnswerSummary[] } (W12;
 *                                                 fileId = answers whose fileScope names the upload)
 *   GET  /v1/answers/{runId}                   -> a stored AnswerResult
 *   GET  /v1/answers/{runId}/evidence-bundle   -> collex.answer.evidence-bundle/v1
 *   POST /v1/evidence-bundle                   -> answer + return only the bundle
 *   POST /v1/research-runs                     -> create + drive a bounded run
 *   GET  /v1/research-runs/{id}                -> run state
 *
 * Mounted sub-routers (each lane owns its module; this file only wires):
 *   /v1/files*                         src/files/routes.ts    (uploads via the intake CLI)
 *   /v1/research*                      src/research/routes.ts (live MCP deep research)
 *   /v1/drafts*, /v1/draft-templates   src/drafting/routes.ts
 *   /v1/matters*                       src/matters/routes.ts  (W12-A)
 *   /v1/settings                       src/settings/routes.ts (W12-A)
 *   /v1/deadlines*                     src/deadlines/routes.ts (W12-D)
 *   /v1/ai*                            src/ai/routes.ts       (W12-E, default OFF)
 *
 * Matter auto-linking (W12, src/api/matterLink.ts): a request that names a
 * matter — `matterId` on /v1/answer, /v1/research, /v1/research/start and
 * the multipart field on /v1/files, `matter.matterId` on /v1/drafts (PUT
 * inherits) — is refused with 404 MATTER_NOT_FOUND before any work when the
 * matter does not exist, and otherwise files the produced record under the
 * matter. A link that fails after the record exists never fails the request:
 * the body carries a `MATTER_LINK_FAILED:<Turkish>` warning instead.
 *
 * All collaborators are injected so tests run fully offline via
 * `app.request()` with a FakeGateway, the InMemoryRunStore and a fake answer
 * pipeline — no socket and no database.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CAPABILITY_NAMES, ALL_TOOL_NAMES } from "../capabilities/registry.js";
import type { Outcome, SearchHit } from "../capabilities/types.js";
import { normalizeTurkishSearch } from "../retrieval/normalize.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import { IntakeValidationError } from "../planner/intake.js";
import type { CorpusSearchFilters, CorpusSearchLimits } from "../pipeline/ports.js";
import {
  resolveMatterScope,
  type MatterScopeRequest,
} from "../matters/scope.js";
import {
  ANSWER_STATUSES,
  answerAiFlags,
  answerRequestSchema,
  boundedAnswerBundle,
  buildAnswerBundle,
  clampAnswerLimits,
  clampListLimit,
  DEFAULT_ANSWER_LIMITS,
  InMemoryAnswerStore,
  STORED_WITHOUT_TEXTS,
  STORED_WITHOUT_TEXTS_MESSAGE_TR,
  type AnswerPort,
  type AnswerStore,
  type StoredAnswer,
} from "./answerService.js";
import { guardAnswerForConsole } from "./consoleGuard.js";
import { fieldIssues } from "./zodIssues.js";
import { localGuard, type LocalGuardOptions } from "./localGuard.js";
import { createBackupRouter, type BackupPort } from "../backup/routes.js";
import { operatorHintsPayload } from "../platform/operatorHints.js";
import { countCorpus, reportDatabaseHealth, resolveUploadsDir } from "./healthReport.js";
import {
  MATTER_NOT_FOUND_MESSAGE_TR,
  MATTER_STORE_UNAVAILABLE_MESSAGE_TR,
  MatterLinker,
  linkedAnswerStore,
  linkedDraftStore,
  type LinkKind,
} from "./matterLink.js";
import {
  ANSWER_PERSIST_FAILED,
  ANSWER_PERSIST_FAILED_MESSAGE_TR,
  persistFailedWarning,
} from "../store/persistNotice.js";
import { CONSOLE_SECURITY_HEADERS, loadConsolePage } from "./consolePage.js";
import { DEFAULT_DEEP_BUDGET, newSpend, type ResearchBudgets } from "../orchestration/budgets.js";
import {
  executeResearchRun,
  InMemoryRunStore,
  type AuthContext,
  type CapabilityExecutor,
  type ExecutorPolicy,
  type Planner,
  type RunState,
  type Verifier,
} from "../orchestration/executor.js";
import { CAPABILITY_TOOLS } from "../capabilities/registry.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import { createFilesRouter, unknownQueryIssues, type IntakeExec } from "../files/routes.js";
import { createLibraryRouter } from "../library/routes.js";
import { PostgresFilesStore, type FilesReadStore } from "../files/store.js";
import {
  createMcpToolsProbe,
  createResearchRouter,
  type GatewayProbeResult,
  type McpState,
} from "../research/routes.js";
import { createSessionMcpGateway } from "../research/mcpSession.js";
import { createDraftingRouter, type DraftDocxExec } from "../drafting/routes.js";
import { InMemoryDraftStore, type DraftStore } from "../drafting/store.js";
import { reviseDraft, type DraftPatch as DraftRevisePatch } from "../drafting/revise.js";
import { DRAFT_TEMPLATES } from "../drafting/templates.js";
import type { Draft } from "../drafting/types.js";
import { createMattersRouter } from "../matters/routes.js";
import { createMatterPackageRouter } from "../matters/packageRoutes.js";
import { createExhaustiveRouter } from "../exhaustive/routes.js";
import { PgDurableAnalysisStore, type DurableAnalysisStore } from "../exhaustive/durableStore.js";
import { createReviewTableRouter } from "../reviewTables/routes.js";
import { PgReviewTableStore } from "../reviewTables/store.js";
import type { WorkerModelRoutes } from "../exhaustive/worker.js";
import type { ModelRouteTable } from "../llm/providerFactory.js";
import { readTrustedLocalHosts } from "../llm/localGenerationConfig.js";
import { applyDataBoundaryToEmbedding } from "../retrieval/embeddingConfig.js";
import { resolveLocalGenerationConfig } from "../llm/localGenerationConfig.js";
import {
  describeAiPolicy,
  resolveEffectiveAiPolicy,
  type AiPolicyHealth,
  type EffectiveAiPolicy,
} from "../llm/aiPolicy.js";
import type { OcrStatus } from "../ocr/ocrStatus.js";
import type { EndpointTrust } from "../llm/endpointTrust.js";
import { InMemoryMatterStore, isUuid } from "../matters/store.js";
import type { MatterStore } from "../matters/types.js";
import { createSettingsRouter } from "../settings/routes.js";
import { InMemorySettingsStore, type SettingsStore } from "../settings/store.js";
import { createDeadlinesRouter, DEADLINE_RULES } from "../deadlines/index.js";
import { createAiRouter, type ReviseFn } from "../ai/routes.js";
// W14 mounts (see the block at the end of createApp): each lane owns its
// router module; this file only wires it.
import { createSourcesRouter } from "../sources/routes.js";
import type { EmbeddingResolution } from "../retrieval/embeddingConfig.js";
import { createEmbeddingPort } from "../retrieval/semanticRerank.js";
import {
  formatDecisionDateNote,
  formatSourceKunye,
  searchSources,
} from "../sources/searchService.js";
import { checkFetchUrl } from "../security/urlPolicy.js";
import type { LocalLibraryPort } from "../sources/localLibrary.js";
import { createContractsRouter } from "../contracts/routes.js";
import { createCorpusCitationResolver } from "../contracts/corpusResolver.js";
import { PgChecklistStore } from "../contracts/checklistStore.js";
import { createFeesRouter } from "../fees/routes.js";
import { InMemoryContactStore, PgContactStore } from "../matters/contacts.js";
import type { ContactStore } from "../matters/contactsRoutes.js";
import { AI_LIVE_TESTED, type AiConfig } from "../ai/config.js";
import type { AiLedger } from "../ai/ledger.js";
import type { MaskParties } from "../ai/masking.js";
import type { Sql } from "../store/db.js";

/**
 * The ONE version number (W14 B-34; ARCH §6.1).
 *
 * Three numbers used to disagree — `pyproject.toml` 1.0.0,
 * `control-plane/package.json` 0.1.0 and a hand-edited `API_VERSION`
 * "1.0.0-w12" — and no record said which build produced it. The repo-root
 * `VERSION` file is now the source; `tests/integration/launcher.test.ts`
 * asserts it equals the `pyproject.toml` version, so the two cannot drift
 * again. (`package.json` is out of this lane's reach and is listed as an
 * integration request.)
 *
 * Read once at module load, with a fallback: a bundled build without the
 * repo root must still start rather than crash on a missing file.
 */
export const VERSION_FALLBACK = "1.0.0";

function readRepoVersion(): string {
  for (const relative of ["../../../VERSION", "../../VERSION"]) {
    try {
      const value = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").trim();
      if (value !== "") return value;
    } catch {
      // try the next candidate
    }
  }
  return VERSION_FALLBACK;
}

/** Surfaced by /v1/health so the console can show which build is running. */
export const API_VERSION = readRepoVersion();

/**
 * W14 B-26 (completed by L-FIX): what `POST /v1/answer` says when
 * `filters.fileIds` names an upload that no longer exists. Exported so the
 * console and the contract test quote the SAME sentence.
 */
export const FILE_NOT_FOUND_MESSAGE_TR = "Belge kaydı bulunamadı; silinmiş olabilir.";

/**
 * Request-body limits (W12-FIX2, review P2-13). Every non-multipart body
 * (JSON routes) is capped at 1 MiB; a multipart body (uploads, OCR) at
 * 40 MiB — the upload cap (25 MiB, intake/quarantine.py) and the OCR cap
 * (32 MiB, ai/ocr.ts) both sit under it with room for the envelope, and
 * each route still applies its own exact per-file cap. Over the limit the
 * answer is a typed 413 in Turkish; the body is never parsed.
 */
export const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
export const MULTIPART_BODY_LIMIT_BYTES = 40 * 1024 * 1024;
export const PAYLOAD_TOO_LARGE_MESSAGE_TR =
  "İstek gövdesi çok büyük: JSON istekleri en fazla 1 MB, belge yüklemeleri en fazla 40 MB olabilir.";

/**
 * `?fileId=` on GET /v1/answers: an upload id is the first 16 hex chars of
 * the file's SHA-256 today, but the file-scope filter accepts any id the
 * files lane may hand out — so only whitespace and length are refused.
 */
const FILE_ID_QUERY_RE = /^\S{1,200}$/u;

/**
 * Every query parameter `GET /v1/answers` understands (W14 L-VERIFY V-6).
 * Anything else is a typed 400 — the same contract `/v1/files` already keeps,
 * so a misspelled filter is refused instead of silently dropped.
 */
export const ANSWER_LIST_QUERY_PARAMS = ["matterId", "fileId", "q", "status", "limit"] as const;

/** Ceiling on the `?q=` needle; the console never sends more. */
export const MAX_ANSWER_QUERY_CODE_POINTS = 200;

export interface ApiDependencies {
  /**
   * Upstream MCP provider gateway. Optional: a corpus-only deployment (the
   * demo, the offline console) serves answers from the local store and has no
   * upstream at all. Without it `/v1/search` answers a typed 503 instead of
   * pretending the providers returned nothing.
   */
  gateway?: ProviderGateway;
  /** Research-run store; defaults to a fresh in-memory one. */
  runStore?: InMemoryRunStore;
  /** Defaults to a planner that immediately finishes (scaffold behaviour). */
  planner?: Planner;
  verifier?: Verifier;
  capabilities?: CapabilityExecutor;
  budgets?: ResearchBudgets;
  /**
   * Citation-first answer pipeline. Optional because it needs the local corpus
   * database: without it the answer routes return a typed 503 rather than
   * pretending the corpus is merely empty.
   */
  answerPipeline?: AnswerPort;
  /**
   * Answer persistence (contract [P]) backing GET /v1/answers*; defaults to a
   * bounded in-memory cache. serve.mjs passes PgAnswerStore.
   */
  answerStore?: AnswerStore;
  /** Server ceiling on retrieval work per answer. */
  answerLimits?: Required<CorpusSearchLimits>;
  /** Serve the static operator console at / and /console (default true). */
  serveConsole?: boolean;
  now?: () => Date;

  // ---- integration wave (all additive; absent = the old behavior) ---------

  /**
   * DSN of the local product database backing /v1/files (tenant uploads).
   * Without it (and without filesStore/filesExec) the files routes are not
   * mounted at all: the console renders its honest "henüz bağlanmadı" card.
   */
  filesDsn?: string;
  /** Injectable read store for /v1/files GET routes (tests use a fake). */
  filesStore?: FilesReadStore;
  /** Injectable intake-CLI runner for upload/delete (tests use a fake). */
  filesExec?: IntakeExec;
  /**
   * W14 B-20 second half (ADR-027): the spool `serve.mjs --library-dir`
   * writes to. When given, `/v1/library/status` and `POST /v1/library/ingest`
   * are mounted; the ingest spawns `python -m ingestion.library` with
   * `filesDsn` (or `libraryExec`, the fake tests inject). Absent = the routes
   * are absent, and the console draws nothing for them (vaporware gate).
   */
  libraryDir?: string;
  /** Injectable publisher-process runner for /v1/library/ingest (tests use a fake). */
  libraryExec?: IntakeExec;
  /**
   * Coordinates of the live MCP provider gateway (scripts/serve-mcp.mjs).
   * When present, /v1/research runs live via createSessionMcpGateway and
   * /v1/research/health probes tools/list over the real transport. Absent:
   * POST /v1/research answers the typed 502 UPSTREAM_UNAVAILABLE.
   */
  mcp?: { baseUrl: string; token: string };
  /** Fake research gateway for tests (takes precedence over `mcp`). */
  researchGateway?: ProviderGateway;
  /** Fake research health probe for tests (takes precedence over `mcp`). */
  researchProbe?: () => Promise<GatewayProbeResult>;
  /** Python interpreter + repo root for the intake CLI and DOCX exporter. */
  python?: { path?: string; repoRoot?: string };
  /** Injectable DOCX exporter-process runner (tests use a fake). */
  draftingExec?: DraftDocxExec;
  /** Draft persistence; defaults to the router's bounded in-memory store. */
  draftStore?: DraftStore;

  // ---- W12 (all additive; absent = in-memory / off) -----------------------

  /** Matter workspace store (contract [M]); defaults to InMemoryMatterStore. */
  matterStore?: MatterStore;
  /** Lawyer profile + preferences; defaults to InMemorySettingsStore. */
  settingsStore?: SettingsStore;
  /** postgres.js client for /v1/health (db state, migrations, corpus counts). */
  sql?: Sql;
  /** Launcher-reported MCP child lifecycle (serve.mjs --with-mcp). */
  mcpState?: () => McpState;
  /** Cloud-AI configuration (null / absent = OFF; /v1/ai/* answer 503). */
  ai?: AiConfig | null;
  /** Database name for /v1/health (serve.mjs derives it from the DSN). */
  dbName?: string;
  /** True when the corpus is the demo fixture load (default: dbName === 'collex_demo'). */
  demoCorpus?: boolean;

  // ---- W14 ----------------------------------------------------------------

  /** Options for the B-04 loopback guard (tests pass an `onRefused` probe). */
  localGuard?: LocalGuardOptions;
  /**
   * Cloud-AI audit ledger + ceiling source (B-23). serve.mjs passes the
   * Pg-backed one; without it the router falls back to a bounded in-memory
   * ledger so the ceiling applies even with no database — a limit that
   * disappears when the store is missing is not a limit.
   */
  aiLedger?: AiLedger;
  /** Backup runner backing POST /v1/backup + /v1/health.backup (B-03). */
  backup?: BackupPort;
  /**
   * W14 B-42 (L-FIX): contact cards. Defaults to a Pg store when `sql` is
   * given and to an in-memory one otherwise, so /v1/contacts is always
   * mounted and always says the truth about what it can keep.
   */
  contacts?: ContactStore;
  /**
   * W14 B-20 (L-SOURCES IR-4, wired by L-FIX): the local library the
   * "tam metni getir" card files fetched documents into. Absent = the
   * `DisabledLocalLibrary`, which reports `action: "disabled"` instead of
   * pretending to have saved anything.
   */
  sourcesLibrary?: LocalLibraryPort;
  sourcesEmbedding?: EmbeddingResolution;
  /**
   * W14 B-34/B-30 (L-VERIFY V-4): where `intake/ingest.py` wrote the ORIGINAL
   * uploaded bytes. `intake`, `backup/runner.ts` and `ColleX-Geri-Yukle.cmd`
   * all resolve it as `<COLLEX_DATA_DIR>/uploads` (default `<repo>/var/
   * uploads`), but this factory used to pass NOTHING, so the files router and
   * the matter packager fell back to `<repo>/var/uploads` unconditionally and
   * a lawyer who followed the backup card's own advice (put the data on an
   * encrypted disk = set COLLEX_DATA_DIR) got 404 ORIGINAL_NOT_FOUND for
   * every "Aslını indir" and an originals-less matter package.
   *
   * serve.mjs passes the resolved path explicitly; when it is absent this
   * factory still honours `COLLEX_DATA_DIR` itself (see `envUploadsDir`), so
   * an in-process createApp cannot disagree with the process that wrote the
   * files.
   */
  uploadsDir?: string;

  // ---- W20 ----------------------------------------------------------------

  /**
   * Model routes resolved once at startup (llm/providerFactory.ts). Absent
   * means no local model: health reads it, the exhaustive worker and the
   * answer pipeline use its roles.
   */
  modelRoutes?: ModelRouteTable;
  /**
   * W21: the effective AI policy (llm/aiPolicy.ts), resolved ONCE by
   * serve.mjs. Absent -> read from the environment per call, the way the
   * data boundary always was. Health reports it as `aiPolicy`; the /v1/ai/*
   * gate and the embedding gate use its (effective) boundary.
   */
  aiPolicy?: () => EffectiveAiPolicy;
  /** Durable exhaustive analysis: store + worker (serve.mjs starts it). */
  exhaustive?: { store?: DurableAnalysisStore; worker?: { kick(): void } };
  /** Dense lane health (W20 phase E), when a local embedding lane is wired. */
  denseHealth?: () => Promise<Record<string, unknown>>;
  /**
   * W21: the local OCR capability (`python -m intake.ocr --status`), probed
   * once per process. Health never waits for the first probe.
   */
  ocrStatus?: () => Promise<OcrStatus>;
  /** The persisted review grid: store + worker (serve.mjs starts it). */
  reviewTables?: { store?: PgReviewTableStore; worker?: { kick(): void } };
}

/**
 * `<COLLEX_DATA_DIR>/uploads`, or undefined when the variable is unset — in
 * which case each router keeps its own `<repoRoot>/var/uploads` fallback.
 * Mirrors `scripts/serve.mjs::resolveDataDir` and `intake/ingest.py`.
 */
export function envUploadsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = (env["COLLEX_DATA_DIR"] ?? "").trim();
  return configured === "" ? undefined : join(configured, "uploads");
}

/**
 * `<repoRoot>` as the files router and the matter packager derive it — the
 * same `../../..` walk from this module's own URL. Kept here so `createApp`
 * can resolve the originals directory ONCE (see `resolveUploadsDir`) instead
 * of letting each router apply its own fallback.
 */
function defaultRepoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

const searchFiltersSchema = z
  .object({
    sourceFamilies: z.array(z.string()).optional(),
    courtTypes: z.array(z.string()).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    asOf: z.string().optional(),
    documentTypes: z.array(z.string()).optional(),
  })
  .strict();

const searchRequestSchema = z
  .object({
    query: z.string().min(1, "query must not be empty"),
    filters: searchFiltersSchema.optional(),
    asOf: z.string().optional(),
    candidateLimit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const researchRunRequestSchema = z
  .object({
    query: z.string().min(1),
    dataClass: z.enum(["public", "client"]).optional(),
    budgets: z
      .object({
        maxRounds: z.number().int().min(1).optional(),
        maxSteps: z.number().int().min(1).optional(),
        maxToolCalls: z.number().int().min(1).optional(),
        maxFetches: z.number().int().min(1).optional(),
        maxModelTokens: z.number().int().min(1).optional(),
        maxWallTimeMs: z.number().int().min(1).optional(),
        maxCostUsd: z.number().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Client budgets may only LOWER the effective budget.
 *
 * The request schema bounds each dimension from below, but a floor alone lets
 * any caller raise maxToolCalls/maxCostUsd to arbitrary values and merge them
 * OVER the server tier. Clamping per dimension makes the server tier a hard
 * ceiling: `min(requested, tier)`, with untouched dimensions left at the tier.
 */
export function clampRequestedBudgets(
  tier: ResearchBudgets,
  requested: Partial<ResearchBudgets> | undefined,
): ResearchBudgets {
  const clamp = (dimension: keyof ResearchBudgets): number => {
    const asked = requested?.[dimension];
    if (typeof asked !== "number" || !Number.isFinite(asked)) return tier[dimension];
    return Math.min(asked, tier[dimension]);
  };
  return {
    maxRounds: clamp("maxRounds"),
    maxSteps: clamp("maxSteps"),
    maxToolCalls: clamp("maxToolCalls"),
    maxFetches: clamp("maxFetches"),
    maxModelTokens: clamp("maxModelTokens"),
    maxWallTimeMs: clamp("maxWallTimeMs"),
    maxCostUsd: clamp("maxCostUsd"),
  };
}

/** Scaffold planner: no LLM yet — declares the run finished immediately. */
const noopPlanner: Planner = {
  next: async () => ({ kind: "finish" }),
};

/** Scaffold verifier: a run with no unsupported material claims completes. */
const passVerifier: Verifier = {
  finalizeOrQualify: async () => "complete",
};

/**
 * W16 şerit G: rows one aleyhe (contrary) lane may bring back. Small on
 * purpose — the lane is a POINTER ("bak, aksi yönde de karar var"), not a
 * research run, and a petition analysis builds one lane per claim.
 */
const CONTRARY_LANE_ROW_LIMIT = 5;

function gatewayCapabilityExecutor(gateway: ProviderGateway): CapabilityExecutor {
  return {
    async execute(request, _ctx) {
      if (!request.toolName) {
        return {
          status: "error",
          provider: "MEVZUAT",
          observedAt: new Date().toISOString(),
          error: {
            kind: "INVALID_REQUEST",
            retryable: false,
            correlationId: randomUUID(),
            safeMessage: `${request.capability} yeteneğinin bu sunucuda yerel bir uygulaması yok (henüz araç eşlenmedi)`,
          },
        };
      }
      return gateway.callTool({ toolName: request.toolName, args: request.input });
    },
  };
}

/** No upstream configured: every capability call is a typed, non-retryable error. */
function unavailableCapabilityExecutor(): CapabilityExecutor {
  return {
    async execute(request, _ctx) {
      return {
        status: "error",
        provider: "MEVZUAT",
        observedAt: new Date().toISOString(),
        error: {
          kind: "UNAVAILABLE",
          retryable: false,
          correlationId: randomUUID(),
          safeMessage:
            `${request.capability} yeteneği için upstream sağlayıcı geçidi gerekir; ` +
            "bu sunucuda yapılandırılmamış.",
        },
      };
    },
  };
}

interface UniversalSearchRow {
  id?: string;
  title?: string;
  text?: string;
  url?: string;
}

function toSearchHits(data: unknown): SearchHit[] {
  const rows: UniversalSearchRow[] = Array.isArray(data)
    ? (data as UniversalSearchRow[])
    : Array.isArray((data as { results?: unknown[] } | null)?.results)
      ? ((data as { results: UniversalSearchRow[] }).results)
      : [];
  return rows.map((row, index) => ({
    hitId: row.id ?? `hit-${index}`,
    provider: "BEDESTEN",
    toolName: "search",
    externalId: row.id ?? "",
    title: row.title ?? "",
    ...(row.text !== undefined ? { snippet: row.text } : {}),
    ...(row.url !== undefined ? { sourceUrl: row.url } : {}),
  }));
}

/** The two exhaustive-analysis roles of a resolved model route table. */
/** How long health waits for the OCR probe before saying "not known yet" (null). */
const OCR_HEALTH_WAIT_MS = 250;

function workerRoutes(table: ModelRouteTable | undefined): WorkerModelRoutes {
  if (table === undefined) return {};
  return {
    extraction: table.roles.matterExtraction,
    synthesis: table.roles.matterSynthesis,
  };
}

export function createApp(deps: ApiDependencies): Hono {
  const app = new Hono();
  // W21: the ONE AI policy. serve.mjs resolves it once; an in-process app
  // that was not given one reads the environment per call.
  const aiPolicyState = (): EffectiveAiPolicy => deps.aiPolicy?.() ?? resolveEffectiveAiPolicy();

  // ---- B-04: loopback guard, BEFORE every other middleware and route -------
  // Host allow-list (DNS rebinding -> read), Origin/Sec-Fetch-Site check on
  // state-changing methods (CSRF -> write, cloud spend), and the /v1/*
  // security headers. See src/api/localGuard.ts for the measured repro.
  // Installed first on purpose: a refused request must not reach the body
  // limiter, the pipeline, the intake process or the model.
  app.use("*", localGuard(deps.localGuard ?? {}));

  const planner = deps.planner ?? noopPlanner;
  const verifier = deps.verifier ?? passVerifier;
  const gateway = deps.gateway;
  const runStore = deps.runStore ?? new InMemoryRunStore();
  const capabilities =
    deps.capabilities ??
    (gateway === undefined ? unavailableCapabilityExecutor() : gatewayCapabilityExecutor(gateway));
  const budgets = deps.budgets ?? DEFAULT_DEEP_BUDGET;
  const answerLimits = deps.answerLimits ?? DEFAULT_ANSWER_LIMITS;
  const now = deps.now ?? (() => new Date());

  // ---- W12 stores + matter linking -----------------------------------------
  // ONE draft store and ONE answer store instance serve every router (the
  // drafting router, the AI paragraph writer, the matters page and the
  // research sink), wrapped so a put that names a matter files the record.
  const matterStore = deps.matterStore ?? new InMemoryMatterStore(now);
  const settingsStore = deps.settingsStore ?? new InMemorySettingsStore();
  const linker = new MatterLinker(matterStore);
  const answerStore = linkedAnswerStore(deps.answerStore ?? new InMemoryAnswerStore(), linker);
  const draftStore = linkedDraftStore(deps.draftStore ?? new InMemoryDraftStore(), linker);
  const mcpState = (): McpState =>
    deps.mcpState?.() ??
    (deps.mcp !== undefined || deps.researchGateway !== undefined ? "ok" : "off");

  // W14 L-VERIFY V-4: ONE resolved originals directory for every router that
  // reads the uploaded bytes (the files router's "Aslını indir" and the
  // matter packager).
  //
  // W14 M-SRV IR-1 finishes the job: the `<repoRoot>/var/uploads` fallback
  // that each router used to apply on its own is applied HERE instead, so the
  // value is resolved exactly once and `/v1/health.uploadsDir` reports the
  // very string the routers read. It is always defined now — a router can no
  // longer disagree with the health page about where the originals live.
  const uploadsDir = resolveUploadsDir({
    uploadsDir: deps.uploadsDir ?? envUploadsDir(),
    repoRoot: deps.python?.repoRoot ?? defaultRepoRoot(),
  });

  // Files read store. Declared HERE, above the answer path, because W14 L-FIX
  // made `POST /v1/answer` pre-check `filters.fileIds` against it (B-26); the
  // /v1/files router mount below uses the same instance.
  const filesStore =
    deps.filesStore ??
    (deps.filesDsn !== undefined && deps.filesDsn !== ""
      ? new PostgresFilesStore({ dsn: deps.filesDsn })
      : undefined);

  const matterNotFound = (c: Context): Response =>
    c.json({ error: { kind: "MATTER_NOT_FOUND", message: MATTER_NOT_FOUND_MESSAGE_TR } }, 404);
  const matterStoreUnavailable = (c: Context): Response =>
    c.json({ error: { kind: "STORE_UNAVAILABLE", message: MATTER_STORE_UNAVAILABLE_MESSAGE_TR } }, 503);

  /**
   * Pre-check of a request-carried matter id: undefined when the request
   * may proceed, else the typed 404/503 to send. Absent / null / "" = no
   * matter named.
   */
  /**
   * W19 phase C: turn `scope` into the `filters` retrieval already
   * understands.
   *
   * `scope.matterId` is expanded to the matter's uploads HERE, on the
   * server, because the browser cannot know (and `filters.fileIds` cannot
   * carry) the membership of a matter holding a hundred documents. The
   * expansion result is written back into `filters.fileIds`, which is the
   * field `chunkStore` already scopes on — so retrieval semantics are
   * unchanged and only the way the list is obtained is new.
   *
   * Every refusal is typed and names what went wrong, because an empty
   * evidence set reads on screen as "your documents do not answer this",
   * which is a statement about the documents rather than about the request.
   */
  const resolveAnswerScope = async (
    c: Context,
    data: { scope?: MatterScopeRequest; filters?: CorpusSearchFilters },
  ): Promise<
    | { ok: true; filters: CorpusSearchFilters | undefined }
    | { ok: false; response: Response }
  > => {
    const scope = data.scope;
    if (scope === undefined) return { ok: true, filters: data.filters };

    const outcome = await resolveMatterScope(matterStore, scope);
    switch (outcome.kind) {
      case "MATTER_NOT_FOUND":
        return { ok: false, response: matterNotFound(c) };
      case "STORE_UNAVAILABLE":
        return { ok: false, response: matterStoreUnavailable(c) };
      case "MATTER_EMPTY":
        return {
          ok: false,
          response: c.json(
            {
              error: {
                kind: "MATTER_EMPTY",
                message:
                  "Bu dosyada henüz belge yok. Önce dosyaya belge ekleyin," +
                  " sonra dosyanın tamamına soru sorun.",
              },
            },
            409,
          ),
        };
      case "MATTER_TOO_LARGE":
        return {
          ok: false,
          response: c.json(
            {
              error: {
                kind: "MATTER_TOO_LARGE",
                message:
                  `Bu dosyada ${outcome.fileCount} belge var; tek soruda en çok` +
                  ` ${outcome.limit} belge taranabilir. Soruyu belirli belgelerle` +
                  " sınırlayın.",
              },
            },
            413,
          ),
        };
      case "FILES_OUTSIDE_MATTER":
        return {
          ok: false,
          response: c.json(
            {
              error: {
                kind: "FILES_OUTSIDE_MATTER",
                message:
                  "Seçilen belgelerden bazıları bu dosyaya bağlı değil:" +
                  ` ${outcome.outside.join(", ")}. Önce belgeleri dosyaya ekleyin.`,
              },
            },
            409,
          ),
        };
      default: {
        // RESOLVED. An empty id list means "no scope was asked for" and the
        // request keeps whatever `filters` already said.
        if (outcome.fileIds.length === 0) return { ok: true, filters: data.filters };
        return {
          ok: true,
          filters: {
            ...(data.filters ?? {}),
            fileIds: [...outcome.fileIds],
            includeCorpus: outcome.includeCorpus,
          },
        };
      }
    }
  };

  const refuseUnlessMatterExists = async (c: Context, matterId: unknown): Promise<Response | undefined> => {
    if (matterId === undefined || matterId === null || matterId === "") return undefined;
    if (typeof matterId !== "string") return matterNotFound(c);
    const existence = await linker.exists(matterId);
    if (existence === "ok") return undefined;
    return existence === "missing" ? matterNotFound(c) : matterStoreUnavailable(c);
  };

  /**
   * W14 B-26 (the piece L-MATTER filed as integration request 6, landed by
   * L-FIX): a question asked over a DELETED upload.
   *
   * Before this, `filters.fileIds` naming a document that no longer exists
   * narrowed retrieval to an empty set, every lane came back with nothing,
   * and the pipeline abstained. On screen that reads "bu belge sorunuzu
   * desteklemiyor" — a statement about the document — when the truth is
   * "that document is gone". Same class of defect as the silent filters
   * B-26 removed, and the same fix: refuse, in Turkish, before any work.
   *
   * Returns the ids that are missing, or `undefined` when the request may
   * proceed. A store that cannot answer the question (no `existingFileIds`,
   * or a throwing connection) lets the request through: this check exists to
   * turn a wrong answer into an honest one, and it must never become a new
   * way for a healthy question to fail.
   */
  const refuseUnlessFilesExist = async (
    fileIds: readonly string[] | undefined,
  ): Promise<string[] | undefined> => {
    if (fileIds === undefined || fileIds.length === 0) return undefined;
    if (filesStore?.existingFileIds === undefined) return undefined;
    let present: string[];
    try {
      present = await filesStore.existingFileIds(fileIds);
    } catch {
      return undefined;
    }
    const known = new Set(present);
    const missing = [...new Set(fileIds)].filter((id) => !known.has(id));
    return missing.length === 0 ? undefined : missing;
  };

  const fileNotFound = (c: Context, missing: readonly string[]): Response =>
    c.json(
      {
        error: {
          kind: "FILE_NOT_FOUND",
          message: FILE_NOT_FOUND_MESSAGE_TR,
          missingFileIds: [...missing],
        },
      },
      404,
    );

  /** Body of a finalized JSON response, or undefined when it is not JSON. */
  const responseJson = async (res: Response): Promise<Record<string, unknown> | undefined> => {
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return undefined;
    try {
      const body: unknown = await res.clone().json();
      return body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };

  /** Append a failed-link warning to a JSON response body's `warnings`. */
  const appendLinkWarning = async (
    c: Context,
    kind: LinkKind,
    refId: string,
    extra: (body: Record<string, unknown>, warning: string) => Record<string, unknown>,
  ): Promise<void> => {
    const outcome = await linker.settle(kind, refId);
    if (outcome === undefined || outcome.ok || outcome.warning === undefined) return;
    const body = await responseJson(c.res);
    if (body === undefined) return;
    c.res = c.json(extra(body, outcome.warning), c.res.status as 200);
  };

  const withWarning = (body: Record<string, unknown>, warning: string): Record<string, unknown> => ({
    ...body,
    warnings: [...(Array.isArray(body["warnings"]) ? (body["warnings"] as unknown[]) : []), warning],
  });

  // ---- request-body limits (P2-13): before every route ----------------------
  const payloadTooLarge = (c: Context): Response =>
    c.json({ error: { kind: "PAYLOAD_TOO_LARGE", message: PAYLOAD_TOO_LARGE_MESSAGE_TR } }, 413);
  const jsonLimit = bodyLimit({ maxSize: JSON_BODY_LIMIT_BYTES, onError: payloadTooLarge });
  const multipartLimit = bodyLimit({ maxSize: MULTIPART_BODY_LIMIT_BYTES, onError: payloadTooLarge });
  app.use("*", async (c, next) => {
    if (c.req.raw.body === null) return next();
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();
    return contentType.includes("multipart/form-data") ? multipartLimit(c, next) : jsonLimit(c, next);
  });

  // ---- operator console (static, self-contained, CSP-pinned) --------------
  if (deps.serveConsole !== false) {
    const serveConsole = (c: Context): Response => {
      try {
        const page = loadConsolePage();
        return c.body(page.html, 200, {
          ...CONSOLE_SECURITY_HEADERS,
          "content-security-policy": page.csp,
        });
      } catch {
        return c.json(
          {
            error: {
              kind: "CONSOLE_UNAVAILABLE",
              message: "Operatör konsolu bu derlemede bulunmuyor.",
            },
          },
          503,
        );
      }
    };
    app.get("/", serveConsole);
    app.get("/console", serveConsole);
  }

  // Contract [H]: the existing fields never change; everything below them is
  // additive. Bounded (one 3 s budget shared by the db probe and the corpus
  // count) and never throws.
  app.get("/v1/health", async (c) => {
    const [database, backup] = await Promise.all([
      reportDatabaseHealth(deps.sql, {
        ...(deps.dbName !== undefined ? { dbName: deps.dbName } : {}),
      }),
      // B-03: never throws and never blocks the banner — a missing backup
      // root just means "no backup yet", which is exactly what we report.
      deps.backup === undefined ? Promise.resolve(null) : deps.backup.last().catch(() => null),
    ]);
    const dbName = database.dbName ?? deps.dbName ?? null;
    return c.json({
      status: "ok",
      service: "@collex/control-plane",
      time: now().toISOString(),
      capabilities: CAPABILITY_NAMES,
      registeredToolCount: ALL_TOOL_NAMES.length,
      db: database.db,
      dbName,
      migrations: database.migrations,
      // Additive (B-05): policies present vs expected. `present < expected`
      // means a migration ran only half-way and client rows are unprotected.
      rls: database.rls,
      // Additive (B-03): null = never backed up. The console turns that red.
      backup: backup,
      mcp: mcpState(),
      ai: {
        configured: deps.ai !== undefined && deps.ai !== null,
        model: deps.ai?.model ?? null,
        liveTested: AI_LIVE_TESTED,
      },
      // Additive (W19 phase F): the local generation lane, reported HONESTLY.
      //
      // `DISABLED` is not `HEALTHY` and `CONFIGURED` is not `REACHABLE`: this
      // block says what is set up, never that it works. Reachability is a
      // separate probe (`scripts/probe_local_generation.mjs`) because a
      // health endpoint that dials a model on every poll would make the
      // console's own refresh a load generator.
      localAi: localGenerationHealth(),
      // W20 phase E: the dense lane says ACTIVE only when it can embed a
      // query right now; otherwise DEGRADED/DISABLED/FAILED, never a guess.
      dense:
        deps.denseHealth !== undefined
          ? await deps.denseHealth()
          : { state: "DISABLED", reasonTr: "Anlamsal arama şeridi yapılandırılmadı." },
      // The data boundary in force. LOCAL_ONLY means a cloud provider is
      // refused even when one is configured — the console shows this so a
      // lawyer can see where their file is allowed to go. W21: the EFFECTIVE
      // boundary (an AI policy of LOCAL_ONLY or DETERMINISTIC_ONLY forces it).
      dataBoundary: aiPolicyState().boundary,
      // Additive (W21): the application AI policy and what it lets each lane
      // do. A NEW key on purpose: `ai` above is a pinned contract shape.
      aiPolicy: aiPolicyHealth(),
      // Additive (W21): can THIS computer read scanned pages (tesseract +
      // Turkish data + a rasterizer)? null = not probed yet or no probe
      // wired. Only OCR_READY means a scanned page can be read at all.
      ocr: await ocrHealth(),
      demoCorpus: deps.demoCorpus ?? dbName === "collex_demo",
      corpus: database.corpus,
      // Additive (W14 M-SRV IR-1, raised by C-UI): the ABSOLUTE folder the
      // uploaded originals live in — the same string `createApp` gives the
      // files router and the matter packager, never a second computation.
      // Settings › "Verilerim nerede?" can now name the folder instead of
      // telling the lawyer which launcher line to read. It is a location, not
      // a machine token; the screen is expected to show it as a path.
      uploadsDir,
      templates: DRAFT_TEMPLATES.length,
      deadlineRules: DEADLINE_RULES.length,
      version: API_VERSION,
      // Additive (W21 round two, R2-36): the platform this server RUNS on
      // and its launcher/backup/restore names, so the console's operator
      // lines name the Mac scripts on the Mac mini, never a Windows .cmd.
      ...operatorHintsPayload(),
    });
  });

  /**
   * What the local generation lane can honestly say about itself.
   *
   * Four states, none of which overstates:
   *   not_configured  nothing set up (the product still works on its
   *                   deterministic ports — this is NOT a fault);
   *   refused         an address was set but the trust rules rejected it
   *                   (an untrusted LAN host, a bad scheme);
   *   configured      set up and allowed. NOT a claim that it answers.
   */
  function localGenerationHealth(): {
    state: "not_configured" | "refused" | "configured";
    model: string | null;
    trust: string | null;
    reason: string | null;
    liveTested: false;
    roles?: Record<string, string>;
  } {
    // W20: when serve.mjs resolved the model routes, health reports THAT
    // table (what the product actually uses), roles included.
    if (deps.modelRoutes !== undefined) {
      const table = deps.modelRoutes;
      return {
        state: table.status,
        model: table.models.answer ?? null,
        trust: table.trust,
        reason: table.messageTr ?? table.warnings[0] ?? null,
        liveTested: false,
        roles: { ...table.models } as Record<string, string>,
      };
    }
    const resolved = resolveLocalGenerationConfig();
    if (resolved.kind === "NOT_CONFIGURED") {
      return { state: "not_configured", model: null, trust: null, reason: null, liveTested: false };
    }
    if (resolved.kind === "REFUSED") {
      return {
        state: "refused",
        model: null,
        trust: null,
        reason: resolved.refusal.message,
        liveTested: false,
      };
    }
    return {
      state: "configured",
      model: resolved.config.model,
      trust: resolved.config.trust,
      reason: resolved.config.warnings[0] ?? null,
      // Never measured from here. A number nobody measured is not a number.
      liveTested: false,
    };
  }

  /** W21: the OCR probe's answer, or null while the first probe runs (health never blocks on it). */
  async function ocrHealth(): Promise<OcrStatus | null> {
    if (deps.ocrStatus === undefined) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), OCR_HEALTH_WAIT_MS);
    });
    try {
      return await Promise.race([deps.ocrStatus().catch(() => null), late]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** W21: health's view of the AI policy (the top-level `aiPolicy` key). */
  function aiPolicyHealth(): AiPolicyHealth {
    const local = localGenerationHealth();
    return describeAiPolicy(
      aiPolicyState(),
      {
        status: local.state,
        model: local.model,
        trust: local.trust as EndpointTrust | null,
        reason: local.reason,
        routes: workerRoutes(deps.modelRoutes),
      },
      deps.ai !== undefined && deps.ai !== null,
    );
  }

  app.post("/v1/search", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } }, 400);
    }
    const parsed = searchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Arama isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }

    if (gateway === undefined) {
      return c.json(
        {
          error: {
            kind: "SEARCH_UNAVAILABLE",
            // W15: eski metin "upstream sağlayıcı geçidi" diyor ve avukata
            // "POST /v1/answer kullanın" diye programcı talimatı veriyordu.
            // Ekranda basabileceği bir yer yok; yerine yapabileceği şey yazıldı.
            message:
              "Resmî kaynaklara canlı bağlantı bu kurulumda kapalı, bu yüzden " +
              "resmî kaynaklarda arama yapılamadı. Bu bilgisayardaki hukuk " +
              "kütüphanesinde aramak için sorunuzu Araştır ekranından sorun.",
          },
        },
        503,
      );
    }

    const { query, filters, asOf } = parsed.data;
    const normalizedQuery = normalizeTurkishSearch(query);
    const exactReferences = parseReferences(query);

    // Scaffold retrieval path: route through the Deep-Research universal
    // `search` tool. Capability-fanout across caseLaw/legislation/regulator
    // search comes later; the response envelope will not change shape.
    const outcome = await gateway.callTool({
      toolName: "search",
      args: { query: normalizedQuery },
    });

    const meta = {
      normalizedQuery,
      exactReferences,
      ...(filters !== undefined ? { filters } : {}),
      ...(asOf !== undefined ? { asOf } : {}),
    };

    if (outcome.status === "error") {
      return c.json({ ...outcome, meta }, 502);
    }
    const mapped: Outcome<SearchHit[]> = {
      ...outcome,
      data: toSearchHits(outcome.data),
    };
    return c.json({ ...mapped, meta }, 200);
  });

  // ------------------------------------------------------------------------
  // Citation-first answers
  // ------------------------------------------------------------------------

  /**
   * Run one question through the answer pipeline.
   *
   * Returns the parsed request plus the completed run, or a Response that is
   * already the error to send. Shared by POST /v1/answer and
   * POST /v1/evidence-bundle so the two cannot drift.
   */
  const runAnswer = async (
    c: Context,
  ): Promise<
    | {
        ok: true;
        run: Awaited<ReturnType<AnswerPort["answer"]>>;
        includeTexts: boolean;
        question: string;
        matterId: string | undefined;
      }
    | { ok: false; response: Response }
  > => {
    if (deps.answerPipeline === undefined) {
      return {
        ok: false,
        response: c.json(
          {
            error: {
              kind: "ANSWER_UNAVAILABLE",
              // W15: "boru hattı / sunucu / korpus / veritabanı" tek cümlede
              // dört bilinmeyen sözcüktü. Ne olduğu ve ne yapılacağı yazıldı.
              message:
                "Araştırma şu an çalışmıyor: bu bilgisayardaki hukuk kütüphanesi " +
                "açık değil. ColleX'i kapatıp masaüstündeki ColleX simgesine " +
                "yeniden çift tıklayın, sonra sorunuzu yeniden sorun.",
            },
          },
          503,
        ),
      };
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return {
        ok: false,
        response: c.json(
          { error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } },
          400,
        ),
      };
    }

    const parsed = answerRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        response: c.json(
          {
            error: {
              kind: "INVALID_REQUEST",
              message: "Cevap isteği doğrulanamadı — eksik veya hatalı alanlar var.",
              issues: fieldIssues(parsed.error),
            },
          },
          400,
        ),
      };
    }

    // A named matter must exist BEFORE any retrieval work (contract [M]).
    const refused = await refuseUnlessMatterExists(c, parsed.data.matterId);
    if (refused !== undefined) return { ok: false, response: refused };

    // W19 phase C: resolve the query SCOPE before anything reads a document.
    // `scope.matterId` becomes the matter's own uploads, server-side, so a
    // question asked about a matter searches that matter's evidence instead
    // of the whole corpus. Every refusal is typed and named.
    const scoped = await resolveAnswerScope(c, parsed.data);
    if (!scoped.ok) return { ok: false, response: scoped.response };

    // Same discipline for the FILE scope (W14 B-26, completed by L-FIX).
    const missingFiles = await refuseUnlessFilesExist(scoped.filters?.fileIds);
    if (missingFiles !== undefined) return { ok: false, response: fileNotFound(c, missingFiles) };

    // A client may only LOWER the retrieval work, never raise it.
    const limits = clampAnswerLimits(answerLimits, parsed.data.limits);

    try {
      const run = await deps.answerPipeline.answer({
        question: parsed.data.question,
        ...(parsed.data.asOf !== undefined ? { asOf: parsed.data.asOf } : {}),
        ...(scoped.filters !== undefined ? { filters: scoped.filters } : {}),
        // W21: BOTH flags, as sent (useLocalAi used to be dropped here).
        ...answerAiFlags(parsed.data),
        limits,
      });
      return {
        ok: true,
        run,
        includeTexts: parsed.data.includeTexts === true,
        question: parsed.data.question,
        matterId: parsed.data.matterId,
      };
    } catch (error) {
      // Intake rejection is the caller's fault and is safe to echo: the
      // messages are produced by our own validator, never by a provider.
      if (error instanceof IntakeValidationError) {
        return {
          ok: false,
          response: c.json(
            {
              error: {
                kind: "INVALID_REQUEST",
                message: "Araştırma girdisi doğrulanamadı.",
                issues: error.errors.map((message) => ({ path: "question", message })),
              },
            },
            400,
          ),
        };
      }
      // Anything else is ours. The pipeline contains every downstream failure
      // as a warning, so reaching here means the pipeline itself broke; never
      // echo the message (it can carry a connection string).
      return {
        ok: false,
        response: c.json(
          {
            error: {
              kind: "ANSWER_FAILED",
              message: "Cevap üretimi beklenmedik biçimde sonlandı; sistemi başlatan kişiye bildirin.",
            },
          },
          500,
        ),
      };
    }
  };

  /**
   * The stored entry of a completed local run (contract [P]: mode, question,
   * matter). W12-FIX2: canonical texts above MAX_STORED_TEXT_BYTES are not
   * stored; the result carries STORED_WITHOUT_TEXTS so the reader (and the
   * exporter) know the stored bundle verifies by hash only.
   */
  const storedEntry = (outcome: Extract<Awaited<ReturnType<typeof runAnswer>>, { ok: true }>): StoredAnswer => {
    const bounded = boundedAnswerBundle(outcome.run);
    if (bounded.textsOmitted && !outcome.run.result.warnings.includes(`${STORED_WITHOUT_TEXTS}:${STORED_WITHOUT_TEXTS_MESSAGE_TR}`)) {
      outcome.run.result.warnings.push(`${STORED_WITHOUT_TEXTS}:${STORED_WITHOUT_TEXTS_MESSAGE_TR}`);
    }
    return {
      runId: outcome.run.result.runId,
      result: outcome.run.result,
      bundle: bounded.bundle,
      storedAt: new Date(outcome.run.result.generatedAt).toISOString(),
      mode: "local",
      question: outcome.question,
      ...(outcome.matterId !== undefined ? { matterId: outcome.matterId } : {}),
    };
  };

  app.post("/v1/answer", async (c) => {
    const outcome = await runAnswer(c);
    if (!outcome.ok) return outcome.response;
    const { run, includeTexts } = outcome;

    answerStore.put(storedEntry(outcome));
    const link = outcome.matterId !== undefined ? await linker.settle("answer", run.result.runId) : undefined;
    // W12-FIX: the durable write is awaited (ms-level on a local PostgreSQL)
    // and a failure is said in the body, not only on stderr.
    const persisted =
      answerStore.persisted === undefined ? true : await answerStore.persisted(run.result.runId);

    // The console is the primary reader of this route, and it is an injection
    // target; the guard report travels with the answer so every client (not
    // just ours) can label a passage carrying an instruction-shaped payload.
    const guarded = guardAnswerForConsole(run.result);
    let body: Record<string, unknown> = includeTexts
      ? { ...guarded, bundle: buildAnswerBundle(run, { includeTexts: true }), persisted }
      : { ...guarded, persisted };
    if (link !== undefined && !link.ok && link.warning !== undefined) body = withWarning(body, link.warning);
    if (!persisted) {
      body = withWarning(body, persistFailedWarning(ANSWER_PERSIST_FAILED, ANSWER_PERSIST_FAILED_MESSAGE_TR));
    }
    return c.json(body, 200);
  });

  app.post("/v1/evidence-bundle", async (c) => {
    const outcome = await runAnswer(c);
    if (!outcome.ok) return outcome.response;
    const { run, includeTexts } = outcome;
    answerStore.put(storedEntry(outcome));
    if (outcome.matterId !== undefined) await linker.settle("answer", run.result.runId);
    return c.json(buildAnswerBundle(run, { includeTexts }), 200);
  });

  // W12: listing (newest first), optionally one matter's answers and/or
  // (W12-API2) the answers asked over one uploaded document (`fileId`).
  //
  // W14 L-VERIFY V-6 (the open half of B-26 / DAILYFLOW P1-5): `q` and
  // `status` were accepted on the wire, implemented by BOTH stores, and never
  // read here — so `?q=zzz` returned every row and `?status=COMPLETE` returned
  // ABSTAIN rows. A screen that looks filtered and is not is worse than one
  // that refuses. Both filters are now passed through, and an unrecognised
  // parameter is refused with the SAME typed 400 `/v1/files` already answers,
  // so a misspelled filter can never masquerade as an unfiltered list.
  app.get("/v1/answers", async (c) => {
    const unknown = unknownQueryIssues(c.req.url, ANSWER_LIST_QUERY_PARAMS);
    const matterId = c.req.query("matterId");
    const fileId = c.req.query("fileId");
    const limitRaw = c.req.query("limit");
    const qRaw = c.req.query("q");
    const statusRaw = c.req.query("status");
    const issues: Array<{ path: string; message: string }> = [...unknown];
    if (matterId !== undefined && matterId !== "" && !isUuid(matterId)) {
      issues.push({ path: "matterId", message: "Dava dosyası kimliği UUID biçiminde olmalı." });
    }
    if (fileId !== undefined && fileId !== "" && !FILE_ID_QUERY_RE.test(fileId)) {
      issues.push({ path: "fileId", message: "Belge kimliği boşluk içermeyen, en fazla 200 karakterlik bir metin olmalı." });
    }
    if (limitRaw !== undefined && limitRaw !== "" && !/^\d{1,6}$/u.test(limitRaw)) {
      issues.push({ path: "limit", message: "limit pozitif bir tam sayı olmalı (en fazla 200)." });
    }
    if (qRaw !== undefined && [...qRaw].length > MAX_ANSWER_QUERY_CODE_POINTS) {
      issues.push({
        path: "q",
        message: `Arama metni en fazla ${MAX_ANSWER_QUERY_CODE_POINTS} karakter olabilir.`,
      });
    }
    if (
      statusRaw !== undefined &&
      statusRaw !== "" &&
      !(ANSWER_STATUSES as readonly string[]).includes(statusRaw)
    ) {
      issues.push({
        path: "status",
        message: `Durum süzgeci şunlardan biri olmalı: ${ANSWER_STATUSES.join(", ")}.`,
      });
    }
    if (issues.length > 0) {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "Liste filtresi doğrulanamadı.", issues } }, 400);
    }
    const limit = clampListLimit(limitRaw !== undefined && limitRaw !== "" ? Number(limitRaw) : undefined);
    // An all-whitespace `q` is not a filter; it must not narrow the list.
    const q = qRaw !== undefined && qRaw.trim() !== "" ? qRaw.trim() : undefined;
    try {
      const answers =
        answerStore.list === undefined
          ? []
          : await answerStore.list({
              ...(matterId !== undefined && matterId !== "" ? { matterId } : {}),
              ...(fileId !== undefined && fileId !== "" ? { fileId } : {}),
              ...(q !== undefined ? { q } : {}),
              ...(statusRaw !== undefined && statusRaw !== "" ? { status: statusRaw } : {}),
              limit,
            });
      return c.json({ answers }, 200);
    } catch {
      return c.json(
        {
          error: {
            kind: "STORE_UNAVAILABLE",
            message: "Yerel veritabanına ulaşılamadı; kayıtlı cevaplar listelenemiyor.",
          },
        },
        503,
      );
    }
  });

  app.get("/v1/answers/:runId", async (c) => {
    const runId = c.req.param("runId");
    try {
      await answerStore.warm?.(runId);
    } catch {
      // A cold store only means the cache decides; the 404 below is honest.
    }
    const stored = answerStore.get(runId);
    if (stored === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Bu araştırma no ile kayıtlı cevap bulunamadı." } }, 404);
    }
    return c.json(guardAnswerForConsole(stored.result), 200);
  });

  app.get("/v1/answers/:runId/evidence-bundle", async (c) => {
    const runId = c.req.param("runId");
    try {
      await answerStore.warm?.(runId);
    } catch {
      // As above.
    }
    const stored = answerStore.get(runId);
    if (stored === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Bu araştırma no ile kayıtlı cevap bulunamadı." } }, 404);
    }
    const includeTexts = c.req.query("texts") === "true";
    if (includeTexts) return c.json(stored.bundle, 200);
    const { texts: _omitted, ...withoutTexts } = stored.bundle;
    return c.json(withoutTexts, 200);
  });

  app.post("/v1/research-runs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } }, 400);
    }
    const parsed = researchRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Araştırma çalıştırma isteği doğrulanamadı — eksik veya hatalı alanlar var.",
            issues: fieldIssues(parsed.error),
          },
        },
        400,
      );
    }

    const runBudgets: ResearchBudgets = clampRequestedBudgets(budgets, parsed.data.budgets);

    // Scaffold auth context. In production this MUST come from the
    // authentication middleware (validated token), never from the body —
    // and never from planner/model output (see executor.ts).
    const authContext: AuthContext = {
      tenantId: "local-dev",
      userId: "local-dev",
      scopes: ["research:run"],
    };

    const state: RunState = {
      runId: randomUUID(),
      status: "pending",
      query: parsed.data.query,
      dataClass: parsed.data.dataClass ?? "public",
      budgets: runBudgets,
      spent: newSpend(),
      authContext,
      steps: [],
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    await runStore.create(state);

    const policy: ExecutorPolicy = {
      budgets: runBudgets,
      allowedCapabilities: new Set(
        Object.keys(CAPABILITY_TOOLS) as (keyof typeof CAPABILITY_TOOLS)[],
      ),
    };

    let finalState: RunState;
    try {
      finalState = await executeResearchRun(
        state.runId,
        { runs: runStore, planner, capabilities, verifier },
        policy,
      );
    } catch {
      // The executor persists a terminal `failed` state before rethrowing, so
      // the run is still retrievable. Answer a TYPED 5xx that carries the
      // runId (a bare 500 left the caller with no handle at all) and never
      // echo the underlying error message — it may carry connection strings.
      const persisted = await runStore.get(state.runId);
      return c.json(
        {
          runId: state.runId,
          status: persisted?.status ?? "failed",
          ...(persisted?.failure !== undefined ? { failure: persisted.failure } : {}),
          error: {
            kind: "RUN_FAILED",
            message: "Araştırma çalışması beklenmedik biçimde sonlandı.",
            runId: state.runId,
          },
        },
        500,
      );
    }

    return c.json(
      {
        runId: finalState.runId,
        status: finalState.status,
        ...(finalState.partialReason !== undefined
          ? { partialReason: finalState.partialReason }
          : {}),
      },
      201,
    );
  });

  app.get("/v1/research-runs/:id", async (c) => {
    const runId = c.req.param("id");
    const state = await runStore.get(runId);
    if (!state) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Bu araştırma no ile kayıt bulunamadı." } }, 404);
    }
    return c.json(state, 200);
  });

  // ------------------------------------------------------------------------
  // Integration wave: files / live research / drafting sub-routers
  // ------------------------------------------------------------------------

  // ---- matter pre-checks + post-link warnings (registered BEFORE the
  // routers they wrap, so hono runs them around the lane handlers) ----------

  // POST /v1/files: the optional multipart field `matterId`. hono caches the
  // parsed form, so the files router's own parseBody() sees the same body.
  app.use("/v1/files", async (c, next) => {
    if (c.req.method !== "POST") return next();
    let matterId: unknown;
    try {
      matterId = (await c.req.parseBody())["matterId"];
    } catch {
      return next(); // the router answers its own typed 400
    }
    const refused = await refuseUnlessMatterExists(c, matterId);
    if (refused !== undefined) return refused;
    await next();
    if (typeof matterId !== "string" || matterId === "" || c.res.status !== 200) return;
    const body = await responseJson(c.res);
    const fileId = body?.["fileId"];
    if (body === undefined || typeof fileId !== "string" || fileId === "") return;
    const fileName = typeof body["name"] === "string" ? body["name"] : "";
    const outcome = await linker.link(matterId, "file", fileId, { fileName });
    if (!outcome.ok && outcome.warning !== undefined) {
      c.res = c.json(withWarning(body, outcome.warning), 200);
    }
  });

  // POST /v1/research and /v1/research/start: body.matterId (lane F passes
  // it to the answer sink; the sink wrapper links). The sync route's response
  // gets the link warning; the async route's link is background work.
  const researchMatterGuard = async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (c.req.method !== "POST") return next();
    let matterId: unknown;
    try {
      matterId = ((await c.req.json()) as { matterId?: unknown } | null)?.matterId;
    } catch {
      return next();
    }
    const refused = await refuseUnlessMatterExists(c, matterId);
    if (refused !== undefined) return refused;
    await next();
    if (typeof matterId !== "string" || c.res.status !== 200) return;
    const body = await responseJson(c.res);
    const runId = body?.["runId"];
    if (typeof runId === "string") await appendLinkWarning(c, "answer", runId, withWarning);
  };
  app.use("/v1/research", researchMatterGuard);
  app.use("/v1/research/start", researchMatterGuard);

  // Drafts: POST names matter.matterId; PUT /v1/drafts/{id} and the AI
  // paragraph writer inherit the stored draft's matterId (the draft store
  // wrapper links on every put). The response carries a failed link.
  const draftLinkWarning = (body: Record<string, unknown>, warning: string): Record<string, unknown> => ({
    ...withWarning(body, warning.slice(warning.indexOf(":") + 1)),
    machineWarnings: [
      ...(Array.isArray(body["machineWarnings"]) ? (body["machineWarnings"] as unknown[]) : []),
      warning,
    ],
  });
  app.use("/v1/drafts", async (c, next) => {
    if (c.req.method !== "POST") return next();
    let matterId: unknown;
    try {
      const body = (await c.req.json()) as { matter?: { matterId?: unknown } } | null;
      matterId = body?.matter?.matterId;
    } catch {
      return next();
    }
    const refused = await refuseUnlessMatterExists(c, matterId);
    if (refused !== undefined) return refused;
    await next();
    if (typeof matterId !== "string" || c.res.status !== 200) return;
    const body = await responseJson(c.res);
    const draftId = body?.["draftId"];
    if (typeof draftId === "string") await appendLinkWarning(c, "draft", draftId, draftLinkWarning);
  });
  app.use("/v1/drafts/:id", async (c, next) => {
    await next();
    if (c.req.method !== "PUT" || c.res.status !== 200) return;
    const body = await responseJson(c.res);
    const draftId = body?.["draftId"];
    if (typeof body?.["matterId"] === "string" && typeof draftId === "string") {
      await appendLinkWarning(c, "draft", draftId, draftLinkWarning);
    }
  });
  app.use("/v1/ai/draft-paragraph", async (c, next) => {
    await next();
    if (c.req.method !== "POST" || c.res.status !== 200) return;
    const body = await responseJson(c.res);
    const draft = body?.["draft"] as { draftId?: unknown; matterId?: unknown } | undefined;
    if (typeof draft?.matterId === "string" && typeof draft.draftId === "string") {
      await appendLinkWarning(c, "draft", draft.draftId, withWarning);
    }
  });

  // Files (/v1/files*): mounted only when a backing store or CLI runner is
  // configured — an unconfigured instance keeps answering 404 and the console
  // renders its typed "henüz bağlanmadı" notice instead of a fake empty list.
  // (`filesStore` itself is resolved near the top of this factory; the answer
  // path needs it before this point.)
  if (filesStore !== undefined || deps.filesExec !== undefined) {
    app.route(
      "/",
      createFilesRouter({
        ...(deps.filesDsn !== undefined ? { dsn: deps.filesDsn } : {}),
        ...(filesStore !== undefined ? { store: filesStore } : {}),
        ...(deps.filesExec !== undefined ? { exec: deps.filesExec } : {}),
        ...(deps.python?.path !== undefined ? { pythonPath: deps.python.path } : {}),
        ...(deps.python?.repoRoot !== undefined ? { repoRoot: deps.python.repoRoot } : {}),
        // L-VERIFY V-4: without this line "Aslını indir" answered 404
        // ORIGINAL_NOT_FOUND on every COLLEX_DATA_DIR installation.
        uploadsDir,
      }),
    );
  }

  // Local library (/v1/library*): mounted only when a spool directory AND a
  // way to run the publisher (a DSN or an injected runner) are configured.
  // `publicDocuments` is `countCorpus` over the SAME `sql` /v1/health reads,
  // so the two pages can never disagree about the corpus size; without `sql`
  // it is null — a count nobody measured is never 0.
  if (deps.libraryDir !== undefined && (deps.filesDsn !== undefined || deps.libraryExec !== undefined)) {
    const sqlForCount = deps.sql;
    app.route(
      "/",
      createLibraryRouter({
        libraryDir: deps.libraryDir,
        ...(deps.filesDsn !== undefined ? { dsn: deps.filesDsn } : {}),
        ...(deps.libraryExec !== undefined ? { exec: deps.libraryExec } : {}),
        ...(deps.python?.path !== undefined ? { pythonPath: deps.python.path } : {}),
        ...(deps.python?.repoRoot !== undefined ? { repoRoot: deps.python.repoRoot } : {}),
        ...(sqlForCount !== undefined
          ? {
              publicDocuments: async () => {
                const counts = await countCorpus(sqlForCount);
                return counts === undefined ? null : counts.publicDocuments;
              },
            }
          : {}),
        now,
      }),
    );
  }

  // Live research (/v1/research*): always mounted; without a gateway the
  // POST answers the typed 502 UPSTREAM_UNAVAILABLE and health reports 503.
  const researchGateway =
    deps.researchGateway ??
    (deps.mcp !== undefined
      ? createSessionMcpGateway({ baseUrl: deps.mcp.baseUrl, bearerToken: deps.mcp.token })
      : undefined);
  const researchProbe =
    deps.researchProbe ??
    (deps.mcp !== undefined
      ? createMcpToolsProbe({ baseUrl: deps.mcp.baseUrl, bearerToken: deps.mcp.token })
      : undefined);
  app.route(
    "/",
    createResearchRouter({
      ...(deps.sourcesEmbedding?.enabled && deps.sourcesEmbedding.config.provider === "local" &&
          deps.sourcesEmbedding.config.model === "intfloat/multilingual-e5-small:onnx-qint8" &&
          deps.sourcesEmbedding.config.baseUrl.startsWith("http://127.0.0.1:")
        ? { localPassageEmbedder: createEmbeddingPort(deps.sourcesEmbedding.config) } : {}),
      ...(researchGateway !== undefined ? { gateway: researchGateway } : {}),
      ...(researchProbe !== undefined ? { probe: researchProbe } : {}),
      // A finished live run lands in the SAME answer store as /v1/answer
      // (and links to its matter through the wrapper). `settleLink` lets the
      // background run (/v1/research/start) learn whether that link failed,
      // so GET /v1/research/runs/{id} can carry MATTER_LINK_FAILED in its
      // `warnings` instead of only a stderr line (W12-API2).
      answerStore: {
        put: (entry) => answerStore.put(entry),
        settleLink: (runId) => linker.settle("answer", runId),
      },
      ...(deps.mcpState !== undefined ? { mcpState: deps.mcpState } : {}),
    }),
  );

  // Drafting (/v1/drafts*, /v1/draft-templates): always mounted. The API's
  // own answer store satisfies DraftAnswerLookup structurally, so a draft can
  // bind `evidence.runId` to any answer this process produced; uploaded-file
  // evidence flows through the files store when one is configured.
  app.route(
    "/",
    createDraftingRouter({
      answers: answerStore,
      ...(filesStore !== undefined ? { files: filesStore } : {}),
      store: draftStore,
      ...(deps.draftingExec !== undefined ? { exec: deps.draftingExec } : {}),
      ...(deps.python?.path !== undefined ? { pythonPath: deps.python.path } : {}),
      ...(deps.python?.repoRoot !== undefined ? { repoRoot: deps.python.repoRoot } : {}),
      now,
      // W12-FIX2: human export names / "Dosya: <başlık>" come from the matter store.
      matterTitle: async (matterId) => (isUuid(matterId) ? (await matterStore.get(matterId))?.title : undefined),
    }),
  );

  // Matters (/v1/matters*) + settings (/v1/settings): the workspace layer.
  // W14 L-FIX wiring (L-MATTER integration request 4):
  //  - `documents` is the DOCUMENT-BODY half of /v1/matters/search (B-29).
  //    Without it the search answered `documentsSearched:false` forever, which
  //    is honest but half a feature; the files store satisfies the port
  //    structurally (searchChunks), so no lane imports another lane's class.
  //  - `contacts` mounts /v1/contacts (B-42). Absent = the lane is NOT
  //    mounted at all, which is the vaporware gate: a drawn tab with no store
  //    behind it is worse than no tab.
  const contactStore = deps.contacts ?? (deps.sql !== undefined ? new PgContactStore({ sql: deps.sql }) : new InMemoryContactStore());
  app.route(
    "/",
    createMattersRouter({
      store: matterStore,
      answers: answerStore,
      drafts: draftStore,
      now,
      ...(filesStore !== undefined ? { documents: filesStore } : {}),
      contacts: contactStore,
    }),
  );
  // W14 B-30 (L-EVID integration request 9.4, landed by L-FIX):
  // POST /v1/matters/{id}/package. Mounted HERE rather than inside the
  // matters router because the plan joins three lanes — the matter's items,
  // the uploaded bytes + their recorded sha256, and the shared answer/draft
  // stores — and this file is the one place that holds all three.
  app.route(
    "/",
    createMatterPackageRouter({
      store: matterStore,
      ...(filesStore !== undefined ? { files: filesStore } : {}),
      answers: answerStore,
      drafts: draftStore,
      ...(deps.draftingExec !== undefined ? { exec: deps.draftingExec } : {}),
      ...(deps.python?.path !== undefined ? { pythonPath: deps.python.path } : {}),
      ...(deps.python?.repoRoot !== undefined ? { repoRoot: deps.python.repoRoot } : {}),
      // L-VERIFY V-4: the package's `ekler/` copies of the originals read the
      // SAME directory intake wrote them to, not `<repo>/var/uploads`.
      uploadsDir,
      now,
    }),
  );
  // Exhaustive Matter analysis (W19 phase G): "review the WHOLE file".
  //
  // Mounted only with a database, because the feature IS the durable census
  // — an in-memory version could not answer "how much did you read" after a
  // restart, which is the only question it exists to answer. Without a
  // database the routes are simply absent rather than present and lying.
  if (deps.sql !== undefined) {
    app.route(
      "/",
      createExhaustiveRouter({
        // W20: the durable store; the worker that drains it is started by
        // serve.mjs. Without a worker a run is created and stays queued,
        // which is visible in its progress rather than faked.
        store: deps.exhaustive?.store ?? new PgDurableAnalysisStore(deps.sql),
        matters: matterStore,
        worker: deps.exhaustive?.worker,
        models: () => workerRoutes(deps.modelRoutes),
        // W21: the ONE AI policy decides whether the model tasks may run,
        // and an outside endpoint is named as such (not "no model").
        aiPolicy: () => aiPolicyState().policy,
        localTrust: () => localGenerationHealth().trust as EndpointTrust | null,
        // The refusal reason of the SAME resolved route table health reports
        // (an unlisted LAN host is named, not reported as "no model").
        localRefusedReason: () => {
          const local = localGenerationHealth();
          return local.state === "refused" ? local.reason : null;
        },
      }),
    );
  }

  // W20: the review grid, persisted (review_tables). Like the exhaustive
  // routes it needs the database; the worker that fills the cells runs in
  // serve.mjs, so a closed tab or a restart never loses a finished cell.
  if (deps.sql !== undefined) {
    app.route(
      "/",
      createReviewTableRouter({
        store: deps.reviewTables?.store ?? new PgReviewTableStore(deps.sql),
        matters: matterStore,
        worker: deps.reviewTables?.worker,
      }),
    );
  }

  app.route("/", createSettingsRouter({ store: settingsStore }));

  // Deadlines (/v1/deadlines*): pure, no dependencies.
  app.route("/", createDeadlinesRouter());

  // Backup (/v1/backup): mounted only when serve.mjs configured a runner.
  if (deps.backup !== undefined) {
    app.route("/", createBackupRouter({ backup: deps.backup }));
  }

  // Cloud AI (/v1/ai*): default OFF; the paragraph writer revises the SAME
  // draft store instance the drafting router serves, through lane C's
  // reviseDraft with the trusted entailment flag.
  const revise: ReviseFn = (draft, patch, opts) =>
    reviseDraft(draft as Draft, patch as DraftRevisePatch, opts);
  app.route(
    "/",
    createAiRouter({
      config: deps.ai ?? null,
      // W21: the EFFECTIVE boundary (the AI policy can only narrow it).
      dataBoundary: () => aiPolicyState().boundary,
      ...(filesStore !== undefined ? { files: filesStore } : {}),
      drafts: draftStore,
      revise,
      now,
      ...(deps.aiLedger !== undefined ? { aiLedger: deps.aiLedger } : {}),
      // B-23: party names for masking come from the matter the request
      // names. A lookup failure never disables masking of the identifiers
      // (they need no lookup at all).
      matterParties: async (matterId: string): Promise<MaskParties | undefined> => {
        if (!isUuid(matterId)) return undefined;
        const matter = await matterStore.get(matterId);
        if (matter === undefined) return undefined;
        const client = typeof matter.client === "string" && matter.client !== "" ? [matter.client] : [];
        const opposing =
          typeof matter.opposing === "string" && matter.opposing !== "" ? [matter.opposing] : [];
        return { client, opposing };
      },
    }),
  );

  // ---- W14 lane routers ----------------------------------------------
  // server.ts belongs to L-SAFE and collects every lane's mount line in one
  // place, exactly as the wave contract requires. All three routers take
  // fully optional dependencies and answer typed errors when the collaborator
  // they would need is absent, so mounting them unconditionally is correct:
  // an unconfigured route says WHY in Turkish instead of 404-ing, which is
  // the honest half of the vaporware gate (B-22).
  //
  //   /v1/sources/*      L-SOURCES  (B-14 manifest, B-15/B-16 search, B-20)
  //   /v1/citation-audit,
  //   /v1/contracts/*    L-EVID     (B-13 citation audit, B-24 checklists)
  //   /v1/fees/*         L-LEGAL    (B-35 harç / AAÜT)
  //
  // W14 L-FIX completed the dependencies phase A could not pass across lane
  // boundaries. Each is still optional and each absence is still an honest
  // typed answer, so nothing here can 404 a route that used to work.
  // W14 L-VERIFY V-3 (a vaporware-gate violation in effect): "Karar ara"
  // answered 502 UPSTREAM_UNAVAILABLE on a server started WITH --with-mcp,
  // whose /v1/research/health reported {gateway:ok, toolCount:54} at the same
  // moment. The live gateway was built from `deps.mcp` and handed ONLY to the
  // research router, while this mount read `deps.gateway` — which serve.mjs
  // never passes. Both routers call the same 54 MCP tools over the same
  // session transport, so they get the SAME gateway: an explicit
  // `deps.gateway` (tests, a corpus-only deployment with its own provider)
  // wins, otherwise the live MCP child that --with-mcp already started.
  const sourcesGateway = gateway ?? researchGateway;
  app.route(
    "/",
    createSourcesRouter({
      ...(sourcesGateway !== undefined ? { gateway: sourcesGateway } : {}),
      // L-SOURCES IR-3: the manifest's "durum" column reads the SAME health
      // the /v1/health page reads. A probe that throws must never keep the
      // coverage page shut, so the router already treats a rejection as {}.
      health: async () => ({
        mcp: mcpState(),
        ...(deps.sql !== undefined ? { db: (await reportDatabaseHealth(deps.sql)).db } : {}),
      }),
      ...(deps.sourcesLibrary !== undefined ? { library: deps.sourcesLibrary } : {}),
      // W20: a cloud embedding endpoint is refused under LOCAL_ONLY.
      ...(deps.sourcesEmbedding !== undefined
        ? {
            embedding: applyDataBoundaryToEmbedding(
              deps.sourcesEmbedding,
              aiPolicyState().boundary,
              readTrustedLocalHosts(),
            ),
          }
        : {}),
    }),
  );
  app.route(
    "/",
    createContractsRouter({
      now,
      ...(deps.draftingExec !== undefined ? { exportExec: deps.draftingExec } : {}),
      ...(deps.python?.path !== undefined ? { pythonPath: deps.python.path } : {}),
      ...(deps.python?.repoRoot !== undefined ? { repoRoot: deps.python.repoRoot } : {}),
      // L-EVID open item 6: B-13's resolver. Until this line every row of the
      // Atıf Denetim Raporu said "belirsiz", which made the report a coverage
      // statement rather than a cite-check. `createCorpusCitationResolver`
      // documents the ONE case in which it is allowed to say "bulunamadı".
      ...(deps.sql !== undefined
        ? {
            resolveCitation: createCorpusCitationResolver({ sql: deps.sql }),
            // L-EVID 9.3: saved checklists, in app_private.settings, no DDL.
            checklists: new PgChecklistStore({ sql: deps.sql }),
          }
        : {}),
      // W16 şerit G: the karşı dilekçe analizi (B-D) reads an uploaded
      // petition through the SAME file port the drafting lane uses. Without
      // it every `{fileId}` request answered a typed 503 and the lawyer could
      // only paste text. The port stays OPTIONAL: on an installation with no
      // upload store the analysis still runs on pasted text and says why the
      // file path is closed.
      ...(filesStore !== undefined ? { files: filesStore } : {}),
      // W16 şerit G: the aleyhe (contrary) lanes. Wired ONLY when a provider
      // gateway exists; with no gateway every lane stays ÇALIŞTIRILMADI and
      // says so, which is the honest state — never "aleyhe kaynak yok".
      // A rejection here becomes ARAMA_BASARISIZ inside the analysis, so the
      // port deliberately does NOT swallow its own errors.
      ...(sourcesGateway !== undefined
        ? {
            contrarySearch: async (lane, asOf) => {
              const found = await searchSources(
                {
                  query: lane.query,
                  // The flip phrase is the whole point of the lane; an exact
                  // match on it is what separates "aksi yönde karar" from
                  // "aynı konuda herhangi bir karar".
                  exactPhrase: false,
                  limit: CONTRARY_LANE_ROW_LIMIT,
                  dateTo: asOf,
                },
                { gateway: sourcesGateway },
              );
              // W17/b — MEASURED HONESTY DEFECT. `searchSources` never rejects
              // on an outage: every gateway throw and every provider error is
              // caught, pushed into `failedSources`, and the call RESOLVES with
              // `rows: []`. This port ignored those fields, so an unreachable
              // archive arrived at the analysis as an empty result and the lane
              // was drawn "arandı, bulunamadı — bu sorgu çalıştı ve sonuç
              // getirmedi". ARAMA_BASARISIZ was therefore unreachable through
              // the only production port: the fourth state existed in the type
              // and never in a report, and the collapse fell on the most
              // expensive side — the lawyer reads "no contrary authority came
              // back" for a search that never completed. Throwing here is what
              // the analysis turns into ARAMA_BASARISIZ, and the port's own
              // contract already says it must not swallow its errors.
              if (found.okSources.length === 0 && found.failedSources.length > 0) {
                throw new Error(
                  `contrary search reached no source (${found.failedSources.length} failed)`,
                );
              }
              return found.rows.map((row) => {
                const note = formatDecisionDateNote(row.decisionDate);
                const checked =
                  row.sourceUrl !== undefined && row.sourceUrl !== ""
                    ? checkFetchUrl(row.sourceUrl)
                    : undefined;
                const safeHref = checked !== undefined && checked.ok ? checked.url.href : "";
                return {
                  kunye: formatSourceKunye(row),
                  ...(note !== "" ? { note } : {}),
                  // W17: the report tells the lawyer to open the full text and
                  // check the quote themselves. Every hit came back with an
                  // empty href, so there was nothing to open — a notice the
                  // report could not keep. The row's own source URL is the
                  // link; a source that publishes none still gets no link, and
                  // that is the honest state rather than a fabricated one.
                  //
                  // The URL is UNTRUSTED provider text and the console assigns
                  // it straight to an anchor's href, so it goes through the
                  // SAME allowlist the fetch layer uses (`checkFetchUrl`:
                  // https only, no userinfo, no IP literal, exact host match).
                  // A rejected URL yields NO link rather than a link the
                  // lawyer must not click.
                  ...(safeHref !== "" ? { href: safeHref } : {}),
                };
              });
            },
          }
        : {}),
    }),
  );
  app.route("/", createFeesRouter({}));

  return app;
}
