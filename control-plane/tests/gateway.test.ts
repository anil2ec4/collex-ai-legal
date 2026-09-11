/**
 * HttpMcpGateway unit tests against a local in-process node:http mock.
 *
 * OFFLINE ONLY: the mock binds to 127.0.0.1 on an ephemeral port. The gateway
 * has NOT been exercised against the real Python FastMCP server yet; these
 * tests pin the JSON-RPC wire shape and the typed failure mapping.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HttpMcpGateway, parseJsonRpcHttpBody } from "../src/gateway/gateway.js";

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: unknown;
}

type Responder = (req: CapturedRequest, res: ServerResponse) => void;

let activeServer: Server | undefined;

async function startMock(respond: Responder): Promise<{ baseUrl: string; captured: CapturedRequest[] }> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep raw */
      }
      const cap: CapturedRequest = { method: req.method, url: req.url, headers: req.headers, body };
      captured.push(cap);
      respond(cap, res);
    });
  });
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, captured };
}

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer?.close(() => resolve()));
    activeServer = undefined;
  }
});

function jsonRpcResult(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: payload,
    }),
  );
}

describe("HttpMcpGateway wire shape", () => {
  it("POSTs a JSON-RPC 2.0 tools/call with Bearer auth to {baseUrl}/mcp/", async () => {
    const { baseUrl, captured } = await startMock((_req, res) =>
      jsonRpcResult(res, {
        content: [{ type: "text", text: JSON.stringify({ decisions: [] }) }],
      }),
    );
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "test-token-40-chars-aaaaaaaaaaaaaaaaaaaa" });

    const outcome = await gateway.callTool({
      toolName: "search_bedesten_unified",
      args: { phrase: "mülkiyet", pageSize: 5 },
    });

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/mcp/");
    expect(req.headers["authorization"]).toBe(
      "Bearer test-token-40-chars-aaaaaaaaaaaaaaaaaaaa",
    );
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["accept"]).toContain("application/json");
    expect(req.body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "search_bedesten_unified",
        arguments: { phrase: "mülkiyet", pageSize: 5 },
      },
    });
    expect((req.body as { id: unknown }).id).toBeDefined();

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.data).toEqual({ decisions: [] });
      expect(outcome.warnings).toEqual([]);
      expect(typeof outcome.observedAt).toBe("string");
    }
  });

  it("prefers structuredContent over content text", async () => {
    const { baseUrl } = await startMock((_req, res) =>
      jsonRpcResult(res, {
        structuredContent: { total: 3 },
        content: [{ type: "text", text: "{\"total\": 999}" }],
      }),
    );
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: { query: "x" } });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.data).toEqual({ total: 3 });
  });

  it("parses SSE-framed JSON-RPC bodies (streamable HTTP transport)", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}}\n\n',
      );
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: { query: "x" } });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.data).toEqual({ ok: true });
  });
});

describe("HttpMcpGateway failure mapping", () => {
  it("maps HTTP 429 with Retry-After to RATE_LIMITED with retryAfterMs", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      res.writeHead(429, { "retry-after": "30" });
      res.end("rate limited");
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.kind).toBe("RATE_LIMITED");
      expect(outcome.error.retryable).toBe(true);
      expect(outcome.error.retryAfterMs).toBe(30_000);
      expect(outcome.error.upstreamStatus).toBe(429);
      expect(outcome.error.correlationId).toBeTruthy();
    }
  });

  it("maps HTTP 401 to UNAUTHORIZED (not retryable)", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "wrong" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.kind).toBe("UNAUTHORIZED");
      expect(outcome.error.retryable).toBe(false);
    }
  });

  it("maps HTTP 503 to UNAVAILABLE (retryable)", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.kind).toBe("UNAVAILABLE");
      expect(outcome.error.retryable).toBe(true);
    }
  });

  it("maps a JSON-RPC error object to a typed failure", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32602, message: "Invalid params" },
        }),
      );
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.kind).toBe("INVALID_REQUEST");
  });

  it("maps a tool-level isError result to INVALID_REQUEST", async () => {
    const { baseUrl } = await startMock((_req, res) =>
      jsonRpcResult(res, {
        isError: true,
        content: [{ type: "text", text: "tool blew up" }],
      }),
    );
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.kind).toBe("INVALID_REQUEST");
  });

  it("maps an unparseable body to PARSER_ERROR", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("this is not json");
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.kind).toBe("PARSER_ERROR");
  });

  it("maps a timeout to TIMEOUT (retryable)", async () => {
    const { baseUrl } = await startMock((_req, res) => {
      // Never respond within the gateway timeout.
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }, 200);
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t", timeoutMs: 20 });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.kind).toBe("TIMEOUT");
      expect(outcome.error.retryable).toBe(true);
    }
  });
});

describe("parseJsonRpcHttpBody", () => {
  it("accepts plain JSON", () => {
    expect(parseJsonRpcHttpBody('{"jsonrpc":"2.0","id":1}')).toMatchObject({ id: 1 });
  });

  it("accepts SSE frames and takes the last data line", () => {
    const body = 'data: {"id":1}\n\ndata: {"id":2}\n\n';
    expect(parseJsonRpcHttpBody(body)).toMatchObject({ id: 2 });
  });

  it("throws on bodies with no JSON payload", () => {
    expect(() => parseJsonRpcHttpBody("event: ping\n\n")).toThrow();
  });
});
