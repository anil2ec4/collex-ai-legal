/**
 * Live capability executor (Lane F2): the CapabilityExecutor the bounded
 * research executor drives against the REAL MCP provider gateway.
 *
 * Responsibilities:
 *   - route every declared raw tool call through the injected ProviderGateway
 *     (HttpMcpGateway in live use, FakeGateway in tests) and time it;
 *   - bound every call (W12-F): an AbortSignal of
 *     min(perCallTimeoutMs, remaining wall budget) is threaded into
 *     `gateway.callTool`. The default per-call ceiling is 80 s — the Python
 *     Bedesten limiter may legitimately queue a call for up to
 *     BEDESTEN_RATE_MAX_WAIT_S = 65 s, so anything shorter would classify a
 *     queued call as a timeout — while the remaining run budget always wins;
 *   - parse each payload DEFENSIVELY through research/payloads.ts — payloads
 *     are untrusted data; a hostile or malformed body degrades one step into a
 *     typed error Outcome, never a throw and never a control-flow change;
 *   - materialize document.fetch payloads into canonical, hashed fetched
 *     documents (research/liveEvidence.ts) stored in the run's in-memory
 *     store, running the injection scan for telemetry (flags recorded; the
 *     scan NEVER alters what happens next);
 *   - record a per-call trace row {capability, tool, ok, ms, resultCount?,
 *     status, errorKind?} for the research response block — `status`
 *     separates a TIMEOUT from an upstream failure — and emit start/end
 *     progress events with Turkish labels (research/progress.ts).
 */

import { randomUUID } from "node:crypto";
import type { Outcome } from "../capabilities/types.js";
import type { ProviderGateway } from "../gateway/gateway.js";
import type {
  CapabilityExecutionContext,
  CapabilityExecutionRequest,
  CapabilityExecutor,
} from "../orchestration/executor.js";
import { scanForInjection } from "../security/untrusted.js";
import {
  canonicalizeFetchedText,
  LiveDocumentStore,
  type LiveFetchedDocument,
} from "./liveEvidence.js";
import {
  envelopeProviderForTool,
  assemblePagedDocument,
  parseFetchPayload,
  parseSearchPayload,
  parseWithinPayload,
  SEARCH_TOOL_PROVIDER,
  type ParsedFailure,
} from "./payloads.js";
import { progressLabelForTool, type ProgressListener } from "./progress.js";
import { sha256HexUtf8 } from "../verification/validator.js";

/**
 * Per-call ceiling: the Bedesten token bucket may hold a call for up to
 * BEDESTEN_RATE_MAX_WAIT_S (65 s) before it even reaches the upstream; 80 s
 * leaves that plus transport margin. The remaining wall budget of the run
 * always shortens it.
 */
export const DEFAULT_PER_CALL_TIMEOUT_MS = 80_000;

/** Never arm a signal shorter than this (a budget already spent is the executor's business). */
export const MIN_PER_CALL_TIMEOUT_MS = 1_000;

/** Machine classification of one finished gateway call. */
export type ToolCallStatus = "ok" | "failed" | "timeout";

/** One gateway tool call as reported in the research trace (contract §2). */
export interface ToolCallTraceEntry {
  capability: string;
  tool: string;
  ok: boolean;
  ms: number;
  resultCount?: number;
  /** Additive (W12-F): 'timeout' vs 'failed' vs 'ok'. */
  status?: ToolCallStatus;
  /** Additive (W12-F): typed FailureKind of a failed/timed-out call. */
  errorKind?: string;
}

export interface LiveCapabilityExecutorOptions {
  gateway: ProviderGateway;
  docStore: LiveDocumentStore;
  /** Mutated in place: one row per gateway call, in call order. */
  trace: ToolCallTraceEntry[];
  /** Mutated in place: degradation + injection telemetry notes. */
  notes: string[];
  /** Millisecond clock for per-call timing (injectable for determinism). */
  monotonic?: () => number;
  /** ISO clock for retrievedAt stamps (injectable for determinism). */
  now?: () => string;
  /** Per-call ceiling in ms (default DEFAULT_PER_CALL_TIMEOUT_MS). */
  perCallTimeoutMs?: number;
  /** Remaining wall budget of the run in ms; shortens the per-call signal. */
  remainingBudgetMs?: () => number;
  /** Progress events (start/end per call) with Turkish labels. */
  onProgress?: ProgressListener;
  /** Fetch budget of the run, for "Belge çekiliyor n/m" labels. */
  fetchBudget?: number;
}

const SEARCH_CAPABILITIES: ReadonlySet<string> = new Set([
  "caseLaw.search",
  "legislation.search",
  "regulator.search",
]);

function errorOutcome(
  toolName: string,
  observedAt: string,
  failure: ParsedFailure,
): Outcome<never> {
  return {
    status: "error",
    provider: envelopeProviderForTool(toolName),
    observedAt,
    error: {
      kind: failure.kind,
      retryable: failure.retryable,
      correlationId: randomUUID(),
      safeMessage: failure.safeMessage,
    },
  };
}

/** Effective signal duration for one call: ceiling, shortened by the budget left. */
export function perCallTimeout(
  perCallTimeoutMs: number,
  remainingBudgetMs: number | undefined,
): number {
  let timeout = Math.max(MIN_PER_CALL_TIMEOUT_MS, Math.floor(perCallTimeoutMs));
  if (remainingBudgetMs !== undefined && Number.isFinite(remainingBudgetMs)) {
    timeout = Math.min(timeout, Math.max(MIN_PER_CALL_TIMEOUT_MS, Math.floor(remainingBudgetMs)));
  }
  return timeout;
}

/** 'timeout' for a TIMEOUT failure, 'failed' for any other error, else 'ok'. */
export function classifyOutcome(outcome: Outcome<unknown>): {
  status: ToolCallStatus;
  errorKind?: string;
} {
  if (outcome.status === "error") {
    return {
      status: outcome.error.kind === "TIMEOUT" ? "timeout" : "failed",
      errorKind: outcome.error.kind,
    };
  }
  if (outcome.status === "partial" && "error" in outcome && outcome.error !== undefined) {
    return { status: "ok", errorKind: outcome.error.kind };
  }
  return { status: "ok" };
}

export function createLiveCapabilityExecutor(
  options: LiveCapabilityExecutorOptions,
): CapabilityExecutor {
  const monotonic = options.monotonic ?? (() => Date.now());
  const now = options.now ?? (() => new Date().toISOString());
  const { gateway, docStore, trace, notes } = options;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS;
  const fetchBudget = options.fetchBudget ?? 0;
  let fetchIndex = 0;

  return {
    async execute(
      request: CapabilityExecutionRequest,
      _ctx: CapabilityExecutionContext,
    ): Promise<Outcome<unknown>> {
      const observedAt = now();

      // Native capabilities have no live implementation in research v1: a
      // typed, non-retryable error the planner records and moves past.
      if (request.toolName === undefined) {
        return {
          status: "error",
          provider: "MEVZUAT",
          observedAt,
          error: {
            kind: "INVALID_REQUEST",
            retryable: false,
            correlationId: randomUUID(),
            safeMessage: `capability ${request.capability} has no live implementation in research v1`,
          },
        };
      }

      const toolName = request.toolName;
      const isFetch = request.capability === "document.fetch";
      if (isFetch) fetchIndex += 1;
      const label = progressLabelForTool(
        toolName,
        request.capability,
        isFetch ? { index: fetchIndex, total: fetchBudget } : undefined,
      );
      options.onProgress?.({
        phase: "start",
        at: observedAt,
        tool: toolName,
        capability: request.capability,
        label,
        status: "running",
      });

      // Trace row + end event share one exit path so a thrown gateway (which
      // the orchestration executor degrades into a typed Outcome) still ends
      // its progress step honestly.
      const record = (
        entry: Omit<ToolCallTraceEntry, "capability" | "tool" | "status"> & {
          status: ToolCallStatus;
        },
      ): void => {
        trace.push({ capability: request.capability, tool: toolName, ...entry });
        options.onProgress?.({
          phase: "end",
          at: now(),
          tool: toolName,
          capability: request.capability,
          label,
          status: entry.status,
          ...(entry.resultCount !== undefined ? { count: entry.resultCount } : {}),
          ms: entry.ms,
          ...(entry.errorKind !== undefined ? { errorKind: entry.errorKind } : {}),
        });
      };

      const timeoutMs = perCallTimeout(perCallTimeoutMs, options.remainingBudgetMs?.());
      const signal = AbortSignal.timeout(timeoutMs);
      const startedAt = monotonic();
      let outcome: Outcome<unknown>;
      try {
        outcome = await gateway.callTool({ toolName, args: request.input }, { signal });
      } catch (cause) {
        const ms = Math.max(0, Math.round(monotonic() - startedAt));
        const timedOut = signal.aborted;
        record({
          ok: false,
          ms,
          status: timedOut ? "timeout" : "failed",
          errorKind: timedOut ? "TIMEOUT" : "UNAVAILABLE",
        });
        throw cause;
      }
      const ms = Math.max(0, Math.round(monotonic() - startedAt));

      if (outcome.status === "error") {
        const classified = classifyOutcome(outcome);
        record({
          ok: false,
          ms,
          status: classified.status,
          ...(classified.errorKind !== undefined ? { errorKind: classified.errorKind } : {}),
        });
        return outcome;
      }

      // --- document.fetch: canonicalize, hash, scan, store -----------------
      if (isFetch) {
        // Paged tools return 5 000 characters at a time; live evidence is
        // quoted from the WHOLE text or the fetch fails (never page 1 sealed
        // as the document).
        const parsed = await assemblePagedDocument(
          parseFetchPayload(toolName, request.input, outcome.data),
          async (page) => {
            const args = { ...request.input, page_number: page };
            try {
              const next = await gateway.callTool({ toolName, args }, { signal });
              if (next.status === "error") {
                return {
                  kind: "failure" as const,
                  failure: { kind: next.error.kind, retryable: false, safeMessage: "page fetch failed" },
                };
              }
              return parseFetchPayload(toolName, args, next.data);
            } catch {
              return {
                kind: "failure" as const,
                failure: { kind: "UNAVAILABLE" as const, retryable: true, safeMessage: "page fetch failed" },
              };
            }
          },
        );
        if (parsed.kind === "failure") {
          record({ ok: false, ms, status: "failed", errorKind: parsed.failure.kind });
          notes.push(`FETCH_DEGRADED:${toolName}:${parsed.failure.kind}`);
          return errorOutcome(toolName, observedAt, parsed.failure);
        }
        const text = canonicalizeFetchedText(parsed.doc.text);
        if (text.trim() === "") {
          record({ ok: false, ms, status: "failed", errorKind: "PARSER_ERROR" });
          return errorOutcome(toolName, observedAt, {
            kind: "PARSER_ERROR",
            retryable: false,
            safeMessage: "fetched document was empty after canonicalization",
          });
        }
        const provider = envelopeProviderForTool(toolName);
        const doc: LiveFetchedDocument = {
          source: provider,
          externalId: parsed.doc.externalId,
          sourceUrl: parsed.doc.sourceUrl,
          title: parsed.doc.title,
          toolName,
          retrievedAt: observedAt,
          mediaType: "text/markdown",
          text,
          contentSha256: sha256HexUtf8(text),
        };
        // Injection scan is TELEMETRY ONLY (brief 12.4): the flags are
        // recorded for the guard report; nothing branches on them.
        const injection = scanForInjection(text);
        if (injection.flagged) {
          notes.push(
            `INJECTION_FLAGGED:${provider}:${doc.externalId}:${injection.signals
              .map((s) => s.id)
              .join("+")}`,
          );
        }
        docStore.put(doc, injection);
        record({ ok: true, ms, resultCount: 1, status: "ok" });
        return {
          status: "ok",
          data: doc,
          provider,
          observedAt,
          warnings: [...outcome.warnings],
        };
      }

      // --- search capabilities: typed hits ---------------------------------
      if (SEARCH_CAPABILITIES.has(request.capability)) {
        const parsed = parseSearchPayload(toolName, outcome.data);
        if (parsed.kind === "failure") {
          record({ ok: false, ms, status: "failed", errorKind: parsed.failure.kind });
          notes.push(`SEARCH_DEGRADED:${toolName}:${parsed.failure.kind}`);
          return errorOutcome(toolName, observedAt, parsed.failure);
        }
        record({
          ok: true,
          ms,
          resultCount: parsed.hits.length,
          status: "ok",
          ...(parsed.degraded !== undefined ? { errorKind: parsed.degraded.kind } : {}),
        });
        const provider =
          SEARCH_TOOL_PROVIDER[toolName] !== undefined
            ? envelopeProviderForTool(toolName)
            : outcome.provider;
        if (parsed.degraded !== undefined) {
          // Partial provider failure never becomes a silent empty result.
          notes.push(`SEARCH_PARTIAL:${toolName}:${parsed.degraded.kind}`);
          return {
            status: "partial",
            data: parsed.hits,
            provider,
            observedAt,
            warnings: [...outcome.warnings, ...parsed.warnings],
            error: {
              kind: parsed.degraded.kind,
              retryable: parsed.degraded.retryable,
              correlationId: randomUUID(),
              safeMessage: parsed.degraded.safeMessage,
            },
          };
        }
        return {
          status: "ok",
          data: parsed.hits,
          provider,
          observedAt,
          warnings: [...outcome.warnings, ...parsed.warnings],
        };
      }

      // --- document.searchWithin: an error dressed as a result is a failure --
      // (27.09.2026: "Error fetching legislation content: [SSL: …]" was
      // counted as an "ok" call, so a run with 13 of 14 calls failed was not
      // recognised as unreachable.)
      if (request.capability === "document.searchWithin") {
        const within = parseWithinPayload(outcome.data);
        if (within.kind === "failure") {
          record({ ok: false, ms, status: "failed", errorKind: within.failure.kind });
          notes.push(`WITHIN_DEGRADED:${toolName}:${within.failure.kind}`);
          return errorOutcome(toolName, observedAt, within.failure);
        }
      }

      // --- document.searchWithin / source.health: opaque pass-through ------
      record({ ok: true, ms, status: "ok" });
      return outcome;
    },
  };
}
