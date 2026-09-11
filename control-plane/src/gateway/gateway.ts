/**
 * Provider gateway: the only place the control-plane talks to the Python
 * FastMCP provider gateway (Master Build Brief sections 6.3A/6.3B).
 *
 * - `FakeGateway` is the offline test double.
 * - `HttpMcpGateway` speaks JSON-RPC 2.0 `tools/call` over HTTP to the
 *   FastMCP endpoint (`POST {baseUrl}/mcp/` with a Bearer token) exactly the
 *   way asgi_app.py serves it.
 *
 * STATUS: HttpMcpGateway is unit-tested against a local mock HTTP server
 * only. It has NOT yet been exercised against the real Python server
 * (`.venv/Scripts/python.exe -m uvicorn asgi_app:app`); treat the wire
 * mapping as provisional until a live integration check runs.
 */

import { randomUUID } from "node:crypto";
import type {
  FailureKind,
  Outcome,
  ProviderCode,
  ProviderFailure,
} from "../capabilities/types.js";

export interface ToolCallRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ProviderGateway {
  callTool(
    request: ToolCallRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<Outcome<unknown>>;
}

/** Offline test double; records every call it receives. */
export class FakeGateway implements ProviderGateway {
  readonly calls: ToolCallRequest[] = [];

  constructor(
    private readonly handler: (
      request: ToolCallRequest,
    ) => Outcome<unknown> | Promise<Outcome<unknown>>,
  ) {}

  async callTool(request: ToolCallRequest): Promise<Outcome<unknown>> {
    this.calls.push(request);
    return this.handler(request);
  }
}

export interface HttpMcpGatewayOptions {
  /** Origin of the FastMCP HTTP server, e.g. "http://127.0.0.1:8000". */
  baseUrl: string;
  /** Bearer token (MCP_API_TOKEN). Never logged. */
  bearerToken: string;
  /** Per-call timeout; default 30s. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Provider attribution for Outcome envelopes. The MCP wire protocol does
   * not carry a provider code, so attribution here is best-effort; callers
   * that know the true provider should re-attribute downstream.
   */
  provider?: ProviderCode;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code?: number; message?: string; data?: unknown };
}

export class HttpMcpGateway implements ProviderGateway {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly provider: ProviderCode;
  private nextId = 1;

  constructor(options: HttpMcpGatewayOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.bearerToken = options.bearerToken;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.provider = options.provider ?? "BEDESTEN";
  }

  async callTool(
    request: ToolCallRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<Outcome<unknown>> {
    const observedAt = new Date().toISOString();
    const correlationId = randomUUID();
    const id = this.nextId++;

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: request.toolName, arguments: request.args },
    });

    const signals: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
    if (opts?.signal) signals.push(opts.signal);
    const signal = AbortSignal.any(signals);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/mcp/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${this.bearerToken}`,
        },
        body,
        signal,
      });
    } catch (cause) {
      const timedOut = isAbortLike(cause);
      return this.errorOutcome(observedAt, {
        kind: timedOut ? "TIMEOUT" : "UNAVAILABLE",
        retryable: true,
        correlationId,
        safeMessage: timedOut
          ? "provider gateway call timed out"
          : "provider gateway unreachable",
      });
    }

    if (!response.ok) {
      return this.errorOutcome(observedAt, {
        ...this.mapHttpFailure(response),
        correlationId,
      });
    }

    // The body is a SECOND failure surface: headers can arrive fine and the
    // stream still time out or be reset mid-flight. `callTool` must return a
    // typed Outcome in that case — every consumer (executor, api/server)
    // relies on it never throwing.
    let rawText: string;
    try {
      rawText = await response.text();
    } catch (cause) {
      const timedOut = isAbortLike(cause);
      return this.errorOutcome(observedAt, {
        kind: timedOut ? "TIMEOUT" : "UNAVAILABLE",
        retryable: true,
        correlationId,
        safeMessage: timedOut
          ? "provider gateway call timed out while reading the response body"
          : "provider gateway connection failed while reading the response body",
      });
    }

    let parsed: JsonRpcResponse;
    try {
      parsed = parseJsonRpcHttpBody(rawText, id);
    } catch {
      return this.errorOutcome(observedAt, {
        kind: "PARSER_ERROR",
        retryable: false,
        correlationId,
        safeMessage: "provider gateway returned an unparseable response",
      });
    }

    if (parsed.error) {
      return this.errorOutcome(observedAt, {
        kind: mapJsonRpcErrorKind(parsed.error.code),
        retryable: false,
        correlationId,
        safeMessage: "provider gateway rejected the tool call",
      });
    }

    const result = parsed.result;
    if (!result) {
      return this.errorOutcome(observedAt, {
        kind: "PARSER_ERROR",
        retryable: false,
        correlationId,
        safeMessage: "provider gateway response had no result",
      });
    }

    if (result.isError) {
      return this.errorOutcome(observedAt, {
        kind: "INVALID_REQUEST",
        retryable: false,
        correlationId,
        safeMessage: "tool reported an execution error",
      });
    }

    return {
      status: "ok",
      data: extractToolData(result),
      provider: this.provider,
      observedAt,
      warnings: [],
    };
  }

  private mapHttpFailure(response: Response): Omit<ProviderFailure, "correlationId"> {
    const status = response.status;
    if (status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
      return {
        kind: "RATE_LIMITED",
        retryable: true,
        upstreamStatus: status,
        safeMessage: "provider gateway rate limited the call",
        ...(Number.isFinite(retryAfterSeconds)
          ? { retryAfterMs: Math.max(0, Math.round(retryAfterSeconds * 1000)) }
          : {}),
      };
    }
    if (status === 401 || status === 403) {
      return {
        kind: "UNAUTHORIZED",
        retryable: false,
        upstreamStatus: status,
        safeMessage: "provider gateway rejected the credentials",
      };
    }
    if (status === 404) {
      return {
        kind: "NOT_FOUND",
        retryable: false,
        upstreamStatus: status,
        safeMessage: "provider gateway endpoint not found",
      };
    }
    if (status >= 500) {
      return {
        kind: "UNAVAILABLE",
        retryable: true,
        upstreamStatus: status,
        safeMessage: "provider gateway unavailable",
      };
    }
    return {
      kind: "INVALID_REQUEST",
      retryable: false,
      upstreamStatus: status,
      safeMessage: "provider gateway rejected the request",
    };
  }

  private errorOutcome(
    observedAt: string,
    failure: ProviderFailure | (Omit<ProviderFailure, "correlationId"> & { correlationId: string }),
  ): Outcome<never> {
    return {
      status: "error",
      provider: this.provider,
      observedAt,
      error: failure,
    };
  }
}

/**
 * True when an error (or any error in its `cause` chain) is an abort/timeout.
 *
 * `fetch` and the body stream surface aborts differently across Node
 * versions: sometimes a bare `DOMException [TimeoutError]`, sometimes a
 * `TypeError: terminated` whose `cause` is the AbortError. Duck-type on
 * `name` rather than `instanceof` so DOMException is covered too.
 */
function isAbortLike(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const name = (current as { name?: unknown }).name;
    if (name === "TimeoutError" || name === "AbortError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Split an SSE body into events (blank-line separated) and return the JSON
 * payload of each event, per the EventSource spec: an event's `data:` lines
 * are JOINED WITH "\n" and form ONE document — a single frame legitimately
 * spans several `data:` lines. Unparseable frames are skipped (a stray log
 * frame must not poison a well-formed response frame).
 */
function parseSseFrames(trimmed: string): JsonRpcResponse[] {
  const frames: JsonRpcResponse[] = [];
  for (const event of trimmed.split(/\r?\n\r?\n/u)) {
    const dataLines: string[] = [];
    for (const line of event.split(/\r?\n/u)) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice("data:".length);
      // SSE strips exactly one optional leading space from a field value.
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (payload.length === 0) continue;
    try {
      frames.push(JSON.parse(payload) as JsonRpcResponse);
    } catch {
      // Not a JSON frame (comment/keep-alive/log noise) — ignore it.
    }
  }
  return frames;
}

function carriesResponse(frame: JsonRpcResponse): boolean {
  return frame.result !== undefined || frame.error !== undefined;
}

/**
 * FastMCP's streamable-HTTP transport may answer a plain JSON body or an SSE
 * stream. Accept both.
 *
 * For SSE the stream can carry progress/log NOTIFICATIONS around the actual
 * response, so the frame is selected by JSON-RPC id when `expectedId` is
 * given; otherwise (and when no frame matches) the last frame carrying
 * `result`/`error` wins, falling back to the last frame parsed.
 */
export function parseJsonRpcHttpBody(
  rawText: string,
  expectedId?: number | string | null,
): JsonRpcResponse {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }

  const frames = parseSseFrames(trimmed);
  if (frames.length === 0) throw new Error("no JSON payload in response body");

  if (expectedId !== undefined && expectedId !== null) {
    const matched = frames.filter(
      (frame) =>
        frame.id !== undefined &&
        frame.id !== null &&
        (frame.id === expectedId || String(frame.id) === String(expectedId)),
    );
    const responseFrame = matched.filter(carriesResponse).pop() ?? matched.pop();
    if (responseFrame !== undefined) return responseFrame;
  }

  return frames.filter(carriesResponse).pop() ?? (frames[frames.length - 1] as JsonRpcResponse);
}

function mapJsonRpcErrorKind(code: number | undefined): FailureKind {
  switch (code) {
    case -32601: // method not found
      return "NOT_FOUND";
    case -32600: // invalid request
    case -32602: // invalid params
      return "INVALID_REQUEST";
    case -32700: // parse error (our payload was rejected as unparseable)
      return "PARSER_ERROR";
    default:
      return "UNAVAILABLE";
  }
}

/**
 * FastMCP tool results carry `structuredContent` and/or `content` text blocks
 * whose text is usually JSON. Prefer structuredContent; fall back to parsed
 * text; fall back to the raw text.
 */
function extractToolData(result: NonNullable<JsonRpcResponse["result"]>): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text" && typeof c.text === "string")
    ?.text;
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
