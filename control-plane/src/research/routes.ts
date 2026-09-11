/**
 * /v1/research hono sub-router (Lane F2; contract §2 + W12-F additions).
 *
 * Exported as `createResearchRouter(deps)` — the integration wave mounts it
 * onto the main API server. This module never touches src/api/server.ts.
 *
 * Routes:
 *   POST /v1/research               -> LiveResearchResult (AnswerResult + research)
 *                                      (synchronous; unchanged behaviour)
 *   POST /v1/research/start         -> 202 {runId}; same body plus optional
 *                                      matterId; runs in the background
 *   GET  /v1/research/runs/{runId}  -> {runId, state, startedAt, progress,
 *                                      warnings, result?, error?} (poll)
 *                                      `warnings` (W12-API2): run-level
 *                                      notices that are NOT part of the
 *                                      answer itself — today only
 *                                      `MATTER_LINK_FAILED:<Türkçe>` when the
 *                                      finished run could not be filed under
 *                                      its matter (the answer is stored and
 *                                      servable regardless).
 *   GET  /v1/research/health        -> {gateway: "ok"|"unreachable", toolCount?,
 *                                      state: "off"|"starting"|"ok"|"down"}
 *
 * Persistence (W12-F): a successful run — sync or async — is handed to
 * `deps.answerStore.put(...)` in EXACTLY the shape POST /v1/answer stores
 * (`bundle = {...result.bundle, texts}`), so "Son araştırmadan" drafting,
 * "Belgeyi tam metniyle aç" and the evidence-bundle download work for live
 * runs too. The async registry is bounded (16 runs, 30 min TTL) and purely
 * in-memory; the answer store is where a finished run lives on.
 *
 * Budgets are validated as positive integers and then CLAMPED to the contract
 * ceiling (maxToolCalls<=24, maxFetches<=10, maxWallTimeMs<=120000) — an
 * oversized budget is a clamp, not a rejection.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import type { EmbeddingPort } from "../retrieval/semanticRerank.js";
import type { ExportableEvidenceBundle } from "../pipeline/types.js";
import { validateResearchIntake } from "../planner/intake.js";
import {
  DisabledLocalLibrary,
  type LocalLibraryPort,
} from "../sources/localLibrary.js";
import { probeMcpTools } from "./mcpSession.js";
import { ProgressTracker, type ResearchProgress } from "./progress.js";
import {
  IntakeValidationError,
  runResearch,
  type LiveResearchResult,
  type LiveResearchRun,
  type ResearchRequestBudgets,
} from "./researchService.js";

export interface GatewayProbeResult {
  gateway: "ok" | "unreachable";
  toolCount?: number;
}

/** Lifecycle of the MCP gateway child as the launcher sees it (contract [H]). */
export type McpState = "off" | "starting" | "ok" | "down";

/** GET /v1/research/health body (additive `state`). */
export interface ResearchHealth extends GatewayProbeResult {
  state: McpState;
}

/**
 * What the router persists after a successful run — structurally the
 * StoredAnswer of api/answerService.ts (contract [P]), never imported: the
 * API's InMemoryAnswerStore / PgAnswerStore satisfy it as-is.
 */
export interface ResearchAnswerEntry {
  runId: string;
  result: LiveResearchResult;
  /** Bundle WITH the fetched canonical texts (the `texts=true` path). */
  bundle: ExportableEvidenceBundle & { texts: Record<string, string> };
  storedAt: string;
  mode: "live";
  question: string;
  matterId?: string | null;
}

/** Outcome of filing a stored run under its matter (api/matterLink.ts shape). */
export interface ResearchLinkOutcome {
  ok: boolean;
  /** `MATTER_LINK_FAILED:<Türkçe>` when `ok` is false. */
  warning?: string;
}

export interface ResearchAnswerSink {
  put(entry: ResearchAnswerEntry): void;
  /**
   * Additive (W12-API2): await the matter link that `put` may have started
   * for this run; `undefined` when no link is pending (no matterId, or a
   * sink that does not link). The router records a failed link's warning
   * on the run's registry entry BEFORE the run is reported `done`, so a
   * poller that stops at `done` still sees it.
   */
  settleLink?(runId: string): Promise<ResearchLinkOutcome | undefined>;
}

export interface ResearchRouterDeps {
  localPassageEmbedder?: EmbeddingPort;
  /** Upstream MCP provider gateway; absent = typed UPSTREAM_UNAVAILABLE. */
  gateway?: ProviderGateway;
  /** Health probe; defaults to a lightweight gateway round-trip. */
  probe?: () => Promise<GatewayProbeResult>;
  /** Injectable clocks/ids for deterministic tests. */
  now?: () => string;
  monotonic?: () => number;
  newRunId?: () => string;
  today?: () => string;
  /** Where a successful run is persisted (the API's answer store). */
  answerStore?: ResearchAnswerSink;
  /** Launcher-reported gateway child state (serve.mjs); absent = derived. */
  mcpState?: () => McpState;
  /** Async run registry bounds (defaults: 16 runs, 30 minutes). */
  registry?: { maxRuns?: number; ttlMs?: number };
  /** Per-call ceiling for the gateway AbortSignal (default 80 s). */
  perCallTimeoutMs?: number;
  /**
   * Yerel kütüphane (W14/B-20): every FULL document a run fetched is spooled
   * here with its provenance, so the lawyer's own library grows with each run
   * instead of the documents being thrown away when the run ends. Absent =
   * `DisabledLocalLibrary`, i.e. exactly today's behaviour.
   *
   * Spooling NEVER fails a run: the answer is already correct and hash-sealed;
   * the library is an accumulation, and a failed write becomes a
   * `LIBRARY_WRITE_FAILED:<n>` warning on the run's registry entry.
   */
  library?: LocalLibraryPort;
}

const budgetsSchema = z
  .object({
    maxToolCalls: z.number().int().min(1).optional(),
    maxFetches: z.number().int().min(1).optional(),
    maxWallTimeMs: z.number().int().min(1).optional(),
  })
  .strict();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "ISO tarih bekleniyor (YYYY-AA-GG).");

/** Additive court/date narrowing (contract D); sent only when the user sets it. */
const researchFiltersSchema = z
  .object({
    courtTypes: z.array(z.string().min(1).max(200)).max(20).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    /** Additive (W14/B-16): daire, yıl aralığı, hariç tutulacak kelimeler. */
    chambers: z.array(z.string().min(1).max(40)).max(20).optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    excludeTerms: z.array(z.string().min(1).max(80)).max(10).optional(),
  })
  .strict();

const researchRequestSchema = z
  .object({
    question: z.string().min(3, "Soru en az 3 karakter olmalı.").max(2000),
    asOf: isoDate.optional(),
    budgets: budgetsSchema.optional(),
    fileIds: z.array(z.string().min(1)).max(50).optional(),
    filters: researchFiltersSchema.optional(),
    /** Additive (W12-F): the matter the run is filed under (persisted only). */
    matterId: z.string().min(1).max(200).optional(),
  })
  .strict();

type ResearchRequest = z.infer<typeof researchRequestSchema>;

/**
 * MCP handshake + tools/list probe against a FastMCP HTTP endpoint (the real
 * streamable-HTTP transport, session and all). Exported for the integration
 * wave and the live smoke: it is how `toolCount` (the 54-tool invariant) is
 * measured over the wire. Delegates to research/mcpSession.ts.
 */
export function createMcpToolsProbe(options: {
  baseUrl: string;
  bearerToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): () => Promise<GatewayProbeResult> {
  return async (): Promise<GatewayProbeResult> => probeMcpTools(options);
}

// ---------------------------------------------------------------------------
// Bounded in-memory registry of background runs
// ---------------------------------------------------------------------------

export type ResearchRunState = "running" | "done" | "failed";

export interface ResearchRunView {
  runId: string;
  state: ResearchRunState;
  startedAt: string;
  finishedAt?: string;
  matterId: string | null;
  question: string;
  progress: ResearchProgress;
  /**
   * Additive (W12-API2): run-level notices outside the answer — always
   * present, empty when nothing went wrong around the run. Codes are
   * `CODE:<Türkçe>`; today only `MATTER_LINK_FAILED:…`.
   */
  warnings: string[];
  result?: LiveResearchResult;
  error?: { kind: string; message: string };
}

interface RegistryEntry {
  runId: string;
  state: ResearchRunState;
  startedAt: string;
  startedAtMs: number;
  finishedAt?: string;
  matterId: string | null;
  question: string;
  tracker: ProgressTracker;
  warnings: string[];
  result?: LiveResearchResult;
  error?: { kind: string; message: string };
}

export const DEFAULT_REGISTRY_MAX_RUNS = 16;
export const DEFAULT_REGISTRY_TTL_MS = 30 * 60_000;

export class RegistryFullError extends Error {
  constructor(readonly maxRuns: number) {
    super(`research run registry is full (${maxRuns} running)`);
    this.name = "RegistryFullError";
  }
}

/**
 * Keeps at most `maxRuns` entries for `ttlMs` after they started. When the
 * registry is full, the OLDEST FINISHED entry is evicted; when every entry is
 * still running, `create` refuses (typed 429 upstairs) — a run in flight is
 * never dropped from under its poller.
 */
export class ResearchRunRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly maxRuns: number;
  private readonly ttlMs: number;
  private readonly monotonic: () => number;

  constructor(options: { maxRuns?: number; ttlMs?: number; monotonic?: () => number } = {}) {
    this.maxRuns = Math.max(1, Math.floor(options.maxRuns ?? DEFAULT_REGISTRY_MAX_RUNS));
    this.ttlMs = Math.max(1_000, Math.floor(options.ttlMs ?? DEFAULT_REGISTRY_TTL_MS));
    this.monotonic = options.monotonic ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drop entries older than the TTL (running or not — a run cannot outlive it). */
  prune(): void {
    const nowMs = this.monotonic();
    for (const [runId, entry] of this.entries) {
      if (nowMs - entry.startedAtMs >= this.ttlMs) this.entries.delete(runId);
    }
  }

  create(input: { runId: string; question: string; matterId: string | null; startedAt: string }): RegistryEntry {
    this.prune();
    if (this.entries.size >= this.maxRuns) {
      let oldestFinished: RegistryEntry | undefined;
      for (const entry of this.entries.values()) {
        if (entry.state === "running") continue;
        if (oldestFinished === undefined || entry.startedAtMs < oldestFinished.startedAtMs) {
          oldestFinished = entry;
        }
      }
      if (oldestFinished === undefined) throw new RegistryFullError(this.maxRuns);
      this.entries.delete(oldestFinished.runId);
    }
    const entry: RegistryEntry = {
      runId: input.runId,
      state: "running",
      startedAt: input.startedAt,
      startedAtMs: this.monotonic(),
      matterId: input.matterId,
      question: input.question,
      tracker: new ProgressTracker(),
      warnings: [],
    };
    this.entries.set(input.runId, entry);
    return entry;
  }

  get(runId: string): RegistryEntry | undefined {
    this.prune();
    return this.entries.get(runId);
  }

  /**
   * Record a run-level warning (`CODE:<Türkçe>`) on a live entry; a run
   * that already left the registry is a no-op (its answer, if any, is in
   * the store). Duplicates are kept out so a retry cannot stutter the list.
   */
  addWarning(runId: string, warning: string): void {
    const entry = this.entries.get(runId);
    if (entry === undefined || warning === "" || entry.warnings.includes(warning)) return;
    entry.warnings.push(warning);
  }

  view(runId: string): ResearchRunView | undefined {
    const entry = this.get(runId);
    if (entry === undefined) return undefined;
    return {
      runId: entry.runId,
      state: entry.state,
      startedAt: entry.startedAt,
      ...(entry.finishedAt !== undefined ? { finishedAt: entry.finishedAt } : {}),
      matterId: entry.matterId,
      question: entry.question,
      progress: entry.tracker.snapshot(),
      warnings: [...entry.warnings],
      ...(entry.result !== undefined ? { result: entry.result } : {}),
      ...(entry.error !== undefined ? { error: { ...entry.error } } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const UNREACHABLE_MESSAGE =
  "Resmî kaynak geçidine hiçbir araç çağrısında ulaşılamadı;" +
  " canlı araştırma yürütülemedi.";

const NOT_CONFIGURED_MESSAGE =
  "Canlı derin araştırma bu sunucuda yapılandırılmamış" +
  " (sunucuyu --with-mcp ile başlatın).";

function invalidBody(issues: Array<{ path: string; message: string }>): {
  error: { kind: string; message: string; issues: Array<{ path: string; message: string }> };
} {
  return {
    error: {
      kind: "INVALID_REQUEST",
      message: "Canlı araştırma isteği doğrulanamadı — eksik veya hatalı alanlar var.",
      issues,
    },
  };
}

/** The stored entry for a finished run, in the /v1/answer store shape. */
export function toAnswerEntry(run: LiveResearchRun, matterId: string | null): ResearchAnswerEntry {
  return {
    runId: run.result.runId,
    result: run.result,
    bundle: { ...run.result.bundle, texts: { ...run.texts } },
    storedAt: new Date(run.result.generatedAt).toISOString(),
    mode: "live",
    question: run.result.question,
    matterId,
  };
}

export function createResearchRouter(deps: ResearchRouterDeps = {}): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date().toISOString());
  const newRunId = deps.newRunId ?? (() => randomUUID());
  const registry = new ResearchRunRegistry({
    ...(deps.registry?.maxRuns !== undefined ? { maxRuns: deps.registry.maxRuns } : {}),
    ...(deps.registry?.ttlMs !== undefined ? { ttlMs: deps.registry.ttlMs } : {}),
    ...(deps.monotonic !== undefined ? { monotonic: deps.monotonic } : {}),
  });

  const library = deps.library ?? new DisabledLocalLibrary();

  /**
   * Spool every FULL document the run fetched into the lawyer's local library
   * (W14/B-20). Returns the warnings a caller should surface; it NEVER throws
   * and never changes the answer — a library that cannot be written is a
   * smaller library, not a wrong answer.
   */
  const fileIntoLibrary = async (run: LiveResearchRun): Promise<string[]> => {
    if (library instanceof DisabledLocalLibrary || run.fetched.length === 0) return [];
    let failed = 0;
    for (const doc of run.fetched) {
      const outcome = await library.put({
        source: doc.source,
        externalId: doc.externalId,
        title: doc.title,
        sourceUrl: doc.sourceUrl,
        toolName: doc.toolName,
        fetchedAt: doc.retrievedAt,
        text: doc.text,
        contentSha256: doc.contentSha256,
        runId: run.result.runId,
      });
      if (outcome.action === "failed") failed += 1;
    }
    return failed === 0
      ? []
      : [
          `LIBRARY_WRITE_FAILED:${failed} belge yerel kütüphaneye yazılamadı;` +
            " cevabın kendisi ve alıntıları bundan etkilenmez.",
        ];
  };

  const persist = (run: LiveResearchRun, matterId: string | null): void => {
    if (deps.answerStore === undefined) return;
    try {
      deps.answerStore.put(toAnswerEntry(run, matterId));
    } catch (error) {
      // Persistence never fails the response; the code is greppable.
      const name = error instanceof Error ? error.name : typeof error;
      process.stderr.write(`[collex] ANSWER_STORE_PUT_FAILED research ${run.result.runId} ${name}\n`);
    }
  };

  /**
   * The warning of a matter link that failed after `persist` (W12-API2), or
   * undefined when the link succeeded / none was started. Never throws: a
   * sink whose settle rejects is treated like a sink that does not link —
   * the matterLink layer already wrote its stderr line.
   */
  const settleLinkWarning = async (runId: string): Promise<string | undefined> => {
    if (deps.answerStore?.settleLink === undefined) return undefined;
    try {
      const outcome = await deps.answerStore.settleLink(runId);
      return outcome !== undefined && !outcome.ok ? outcome.warning : undefined;
    } catch {
      return undefined;
    }
  };

  const runOptions = (
    request: ResearchRequest,
    gateway: ProviderGateway,
    extra: { runId?: string; onProgress?: ProgressTracker["listener"] } = {},
  ): Parameters<typeof runResearch>[0] => ({
    question: request.question,
    ...(deps.localPassageEmbedder !== undefined ? { localPassageEmbedder: deps.localPassageEmbedder } : {}),
    ...(request.asOf !== undefined ? { asOf: request.asOf } : {}),
    ...(request.budgets !== undefined
      ? { budgets: request.budgets as ResearchRequestBudgets }
      : {}),
    ...(request.fileIds !== undefined ? { fileIds: request.fileIds } : {}),
    ...(request.filters !== undefined ? { filters: request.filters } : {}),
    gateway,
    now,
    ...(deps.monotonic !== undefined ? { monotonic: deps.monotonic } : {}),
    newRunId: extra.runId !== undefined ? () => extra.runId as string : newRunId,
    ...(deps.today !== undefined ? { today: deps.today } : {}),
    ...(extra.onProgress !== undefined ? { onProgress: extra.onProgress } : {}),
    ...(deps.perCallTimeoutMs !== undefined ? { perCallTimeoutMs: deps.perCallTimeoutMs } : {}),
  });

  const parseRequest = async (
    raw: Promise<unknown>,
  ): Promise<{ ok: true; request: ResearchRequest } | { ok: false; body: unknown }> => {
    let body: unknown;
    try {
      body = await raw;
    } catch {
      return {
        ok: false,
        body: { error: { kind: "INVALID_REQUEST", message: "İstek gövdesi JSON olmalı." } },
      };
    }
    const parsed = researchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        body: invalidBody(
          fieldIssues(parsed.error),
        ),
      };
    }
    return { ok: true, request: parsed.data };
  };

  // ---- synchronous run (unchanged contract + persistence) -----------------
  app.post("/v1/research", async (c) => {
    const parsed = await parseRequest(c.req.json());
    if (!parsed.ok) return c.json(parsed.body as Record<string, unknown>, 400);
    const request = parsed.request;

    if (deps.gateway === undefined) {
      return c.json(
        { error: { kind: "UPSTREAM_UNAVAILABLE", message: NOT_CONFIGURED_MESSAGE } },
        502,
      );
    }

    let run: LiveResearchRun;
    try {
      run = await runResearch(runOptions(request, deps.gateway));
    } catch (error) {
      if (error instanceof IntakeValidationError) {
        return c.json(
          {
            error: {
              kind: "INVALID_REQUEST",
              message: "Araştırma girdisi doğrulanamadı.",
              issues: error.errors.map((message) => ({ path: "question", message })),
            },
          },
          400,
        );
      }
      // Never echo internal error text (it can carry connection details).
      return c.json(
        {
          error: {
            kind: "RESEARCH_FAILED",
            message: "Canlı araştırma beklenmedik biçimde sonlandı.",
          },
        },
        500,
      );
    }

    // Every gateway call failed at the transport level: the upstream is not
    // reachable from this instance at all — a typed 502, not a fake ABSTAIN.
    if (run.unreachable) {
      return c.json(
        {
          error: {
            kind: "UPSTREAM_UNAVAILABLE",
            message: UNREACHABLE_MESSAGE,
            runId: run.result.runId,
          },
        },
        502,
      );
    }

    persist(run, request.matterId ?? null);
    // Yerel kütüphane (W14/B-20): the documents this run pulled are kept, so
    // the same decision does not have to be fetched from the network again.
    const libraryWarnings = await fileIntoLibrary(run);
    return c.json(
      libraryWarnings.length === 0
        ? run.result
        : { ...run.result, warnings: [...run.result.warnings, ...libraryWarnings] },
      200,
    );
  });

  // ---- background run: start ----------------------------------------------
  app.post("/v1/research/start", async (c) => {
    const parsed = await parseRequest(c.req.json());
    if (!parsed.ok) return c.json(parsed.body as Record<string, unknown>, 400);
    const request = parsed.request;

    if (deps.gateway === undefined) {
      return c.json(
        { error: { kind: "UPSTREAM_UNAVAILABLE", message: NOT_CONFIGURED_MESSAGE } },
        502,
      );
    }

    // Intake validation happens up front so a bad question is a 400 now,
    // not a "failed" run discovered on the first poll.
    const intake = validateResearchIntake({
      question: request.question,
      jurisdiction: "TR",
      dataClass: "L0",
      ...(request.asOf !== undefined ? { asOf: request.asOf } : {}),
    });
    if (!intake.ok) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Araştırma girdisi doğrulanamadı.",
            issues: intake.errors.map((message) => ({ path: "question", message })),
          },
        },
        400,
      );
    }

    const runId = newRunId();
    const matterId = request.matterId ?? null;
    let entry: RegistryEntry;
    try {
      entry = registry.create({ runId, question: request.question, matterId, startedAt: now() });
    } catch (error) {
      if (error instanceof RegistryFullError) {
        return c.json(
          {
            error: {
              kind: "TOO_MANY_RUNS",
              message:
                `Aynı anda en fazla ${error.maxRuns} canlı araştırma yürütülebilir;` +
                " bir çalışmanın bitmesini bekleyin.",
            },
          },
          429,
        );
      }
      throw error;
    }

    const gateway = deps.gateway;
    void (async () => {
      try {
        const run = await runResearch(
          runOptions(request, gateway, { runId, onProgress: entry.tracker.listener }),
        );
        if (run.unreachable) {
          entry.state = "failed";
          entry.error = { kind: "UPSTREAM_UNAVAILABLE", message: UNREACHABLE_MESSAGE };
        } else {
          // Persist, then wait for the matter link BEFORE reporting `done`:
          // a poller that stops at `done` must already see a failed link.
          persist(run, matterId);
          for (const warning of await fileIntoLibrary(run)) {
            registry.addWarning(runId, warning);
          }
          const linkWarning = await settleLinkWarning(runId);
          if (linkWarning !== undefined) registry.addWarning(runId, linkWarning);
          entry.result = run.result;
          entry.state = "done";
        }
      } catch (error) {
        entry.state = "failed";
        entry.error =
          error instanceof IntakeValidationError
            ? { kind: "INVALID_REQUEST", message: "Araştırma girdisi doğrulanamadı." }
            : { kind: "RESEARCH_FAILED", message: "Canlı araştırma beklenmedik biçimde sonlandı." };
      } finally {
        entry.finishedAt = now();
      }
    })();

    return c.json({ runId }, 202);
  });

  // ---- background run: poll -----------------------------------------------
  app.get("/v1/research/runs/:runId", (c) => {
    const view = registry.view(c.req.param("runId"));
    if (view === undefined) {
      return c.json(
        {
          error: {
            kind: "NOT_FOUND",
            message:
              "Bu araştırma no ile süren veya yeni bitmiş bir çalışma yok" +
              " (bitmiş çalışmalar 30 dakika sonra bu listeden düşer; sonuç cevap deposundadır).",
          },
        },
        404,
      );
    }
    return c.json(view, 200);
  });

  // ---- health ---------------------------------------------------------------
  app.get("/v1/research/health", async (c) => {
    const declared = deps.mcpState?.();
    // A child that is not up yet (or is known gone) is not probed: the
    // answer is already certain and a refused connect would only add noise.
    if (declared === "off" || declared === "starting" || declared === "down") {
      const body: ResearchHealth = { gateway: "unreachable", state: declared };
      return c.json(body, 503);
    }
    const probe =
      deps.probe ??
      (async (): Promise<GatewayProbeResult> => {
        if (deps.gateway === undefined) return { gateway: "unreachable" };
        // Lightweight round-trip through the registered health tool.
        const outcome = await deps.gateway.callTool({
          toolName: "check_government_servers_health",
          args: {},
        });
        return { gateway: outcome.status === "error" ? "unreachable" : "ok" };
      });
    const result = await probe();
    const configured = deps.gateway !== undefined || deps.probe !== undefined;
    const state: McpState =
      result.gateway === "ok" ? "ok" : declared === "ok" || configured ? "down" : "off";
    const body: ResearchHealth = { ...result, state };
    return c.json(body, result.gateway === "ok" ? 200 : 503);
  });

  return app;
}
