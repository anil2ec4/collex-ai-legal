/**
 * MCP streamable-HTTP session layer (Lane F2).
 *
 * The real FastMCP transport (asgi_app.py) requires the MCP handshake before
 * any tools/call:
 *
 *   initialize  ->  capture the `Mcp-Session-Id` response header
 *   notifications/initialized (with that header)
 *   tools/call ... (with that header on every request)
 *
 * `HttpMcpGateway` (src/gateway) speaks correct JSON-RPC but knows nothing
 * about sessions — its `fetchImpl` is injectable precisely so a caller can
 * add transport concerns. `createSessionMcpGateway` wraps it with a fetch
 * that lazily initializes ONE session per gateway instance, attaches the
 * session header to every call, and re-initializes once when the server
 * reports the session gone (HTTP 404 per the MCP spec).
 *
 * `probeMcpTools` performs the same handshake and a paginated tools/list —
 * the transport-level measurement of the 54-tool invariant.
 */

import {
  HttpMcpGateway,
  parseJsonRpcHttpBody,
  type HttpMcpGatewayOptions,
  type ProviderGateway,
} from "../gateway/gateway.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpSessionOptions {
  /** Origin of the FastMCP HTTP server, e.g. "http://127.0.0.1:8898". */
  baseUrl: string;
  /** Bearer token (MCP_API_TOKEN). Never logged. */
  bearerToken: string;
  /** Per-request timeout; default 30s. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

interface SessionState {
  sessionId: string | undefined;
}

function mcpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/mcp/`;
}

function baseHeaders(bearerToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${bearerToken}`,
  };
}

/**
 * Run the MCP initialize handshake; returns the session id (absent when the
 * server runs sessionless). Throws on transport/protocol failure — callers
 * convert that into their own typed failure.
 */
async function initializeSession(options: McpSessionOptions): Promise<SessionState> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const url = mcpUrl(options.baseUrl);
  const headers = baseHeaders(options.bearerToken);

  const initResponse = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "collex-research", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!initResponse.ok) {
    throw new Error(`MCP initialize failed: HTTP ${initResponse.status}`);
  }
  const parsed = parseJsonRpcHttpBody(await initResponse.text(), 1);
  if (parsed.error !== undefined) {
    throw new Error(`MCP initialize rejected: JSON-RPC ${parsed.error.code ?? "?"}`);
  }
  const sessionId = initResponse.headers.get("mcp-session-id") ?? undefined;

  // notifications/initialized completes the handshake (202/200 expected).
  await fetchImpl(url, {
    method: "POST",
    headers: {
      ...headers,
      ...(sessionId !== undefined ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  return { sessionId };
}

/**
 * Per tools/call timeout of the session gateway. The handshake keeps the
 * short `timeoutMs` (30 s); a tool call may sit in the Python Bedesten
 * limiter for up to 65 s before touching the upstream, so the call ceiling
 * is 85 s (>= the executor's 80 s per-call signal + margin). The research
 * executor shortens each call further to the run's remaining wall budget
 * through its own AbortSignal (research/liveExecutor.ts).
 */
export const DEFAULT_CALL_TIMEOUT_MS = 85_000;

export interface SessionMcpGatewayOptions
  extends McpSessionOptions,
    Pick<HttpMcpGatewayOptions, "provider"> {
  /** Per tools/call timeout (default DEFAULT_CALL_TIMEOUT_MS). */
  callTimeoutMs?: number;
}

/**
 * A ProviderGateway over the real FastMCP streamable-HTTP transport: the
 * inner HttpMcpGateway does the JSON-RPC/Outcome mapping; the wrapping fetch
 * owns the session. Session initialization is lazy and shared; a failed
 * initialization is retried on the next call; a 404 (session expired /
 * terminated) triggers exactly one transparent re-initialization.
 */
export function createSessionMcpGateway(options: SessionMcpGatewayOptions): ProviderGateway {
  const realFetch = options.fetchImpl ?? fetch;
  let sessionPromise: Promise<SessionState> | undefined;

  const ensureSession = (): Promise<SessionState> => {
    if (sessionPromise === undefined) {
      sessionPromise = initializeSession({ ...options, fetchImpl: realFetch }).catch(
        (error: unknown) => {
          // Do not cache a failed handshake; the next call retries it.
          sessionPromise = undefined;
          throw error;
        },
      );
    }
    return sessionPromise;
  };

  const withSessionHeader = (
    init: Parameters<typeof fetch>[1],
    sessionId: string | undefined,
  ): Parameters<typeof fetch>[1] => {
    if (sessionId === undefined) return init;
    const headers = new Headers(init?.headers);
    headers.set("mcp-session-id", sessionId);
    return { ...init, headers };
  };

  const sessionFetch: typeof fetch = async (input, init) => {
    const session = await ensureSession();
    const response = await realFetch(input, withSessionHeader(init, session.sessionId));
    if (response.status !== 404) return response;
    // Session gone (MCP spec: 404 for an expired/unknown session): start a
    // fresh one and retry the SAME request exactly once.
    sessionPromise = undefined;
    const renewed = await ensureSession();
    return realFetch(input, withSessionHeader(init, renewed.sessionId));
  };

  return new HttpMcpGateway({
    baseUrl: options.baseUrl,
    bearerToken: options.bearerToken,
    // Tool calls get the long ceiling; the handshake above keeps timeoutMs.
    timeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    fetchImpl: sessionFetch,
  });
}

export interface McpToolsProbeResult {
  gateway: "ok" | "unreachable";
  toolCount?: number;
}

/**
 * Handshake + paginated tools/list over the real transport. Never throws:
 * any failure is reported as {gateway: "unreachable"}.
 */
export async function probeMcpTools(options: McpSessionOptions): Promise<McpToolsProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const url = mcpUrl(options.baseUrl);
  try {
    const session = await initializeSession({ ...options, fetchImpl, timeoutMs });
    const headers = {
      ...baseHeaders(options.bearerToken),
      ...(session.sessionId !== undefined ? { "mcp-session-id": session.sessionId } : {}),
    };
    let toolCount = 0;
    let cursor: string | undefined;
    let id = 2;
    do {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/list",
          params: cursor !== undefined ? { cursor } : {},
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { gateway: "unreachable" };
      const parsed = parseJsonRpcHttpBody(await response.text(), id);
      const result = parsed.result as
        | { tools?: unknown[]; nextCursor?: string }
        | undefined;
      if (parsed.error !== undefined || !Array.isArray(result?.tools)) {
        return { gateway: "unreachable" };
      }
      toolCount += result.tools.length;
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      id += 1;
    } while (cursor !== undefined);
    return { gateway: "ok", toolCount };
  } catch {
    return { gateway: "unreachable" };
  }
}
