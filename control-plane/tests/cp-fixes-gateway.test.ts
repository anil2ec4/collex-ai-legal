/**
 * Regression tests for the two adversarially-reviewed gateway defects
 * (lane C2, defects 1 and 2). OFFLINE ONLY: every server here binds to
 * 127.0.0.1 on an ephemeral port.
 *
 * Defect 1 [P1] — `await response.text()` sat OUTSIDE the try/catch, so a
 * timeout while the body streamed, or a mid-body connection reset, made
 * `callTool` THROW instead of returning a typed Outcome. Every consumer
 * (executor, api/server) assumes it never throws.
 *
 * Defect 2 [P2] — `parseJsonRpcHttpBody` parsed each `data:` line as a
 * standalone JSON document (breaking spec-legal multi-line events) and always
 * took the LAST frame without matching the JSON-RPC id (so a trailing
 * notification frame turned a successful call into PARSER_ERROR).
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HttpMcpGateway, parseJsonRpcHttpBody } from "../src/gateway/gateway.js";

let activeServer: Server | undefined;

async function startMock(respond: (res: ServerResponse) => void): Promise<string> {
  const server = createServer((req, res) => {
    req.resume(); // drain the request body; we answer from headers alone
    req.on("end", () => respond(res));
  });
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  const server = activeServer;
  activeServer = undefined;
  if (!server) return;
  // Half-open/stalled sockets are expected in these tests; force them shut so
  // close() can actually resolve.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Headers + a truncated JSON body, flushed but never completed. */
function writeStalledBody(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "application/json",
    "content-length": "512",
  });
  res.write('{"jsonrpc":"2.0","id":1,"result":');
}

describe("defect 1: body-read failures are typed Outcomes, never throws", () => {
  it("timeout while the response body streams -> TIMEOUT outcome (retryable)", async () => {
    const baseUrl = await startMock((res) => {
      writeStalledBody(res);
      // ...and never finishes the body.
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t", timeoutMs: 80 });

    // Before the fix this REJECTED (TimeoutError escaping response.text()).
    const outcome = await gateway.callTool({ toolName: "search", args: {} });

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.kind).toBe("TIMEOUT");
      expect(outcome.error.retryable).toBe(true);
      expect(outcome.error.correlationId).toBeTruthy();
      expect(outcome.error.safeMessage).toMatch(/timed out/u);
    }
  });

  it("connection reset mid-body -> UNAVAILABLE outcome (retryable)", async () => {
    const baseUrl = await startMock((res) => {
      writeStalledBody(res);
      setTimeout(() => res.socket?.destroy(), 25);
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t", timeoutMs: 5_000 });

    // Before the fix this REJECTED (TypeError: terminated).
    const outcome = await gateway.callTool({ toolName: "search", args: {} });

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.kind).toBe("UNAVAILABLE");
      expect(outcome.error.retryable).toBe(true);
      expect(outcome.error.correlationId).toBeTruthy();
    }
  });

  it("caller-supplied abort mid-body -> TIMEOUT outcome, still not a throw", async () => {
    const baseUrl = await startMock((res) => {
      writeStalledBody(res);
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t", timeoutMs: 10_000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    const outcome = await gateway.callTool(
      { toolName: "search", args: {} },
      { signal: controller.signal },
    );

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.kind).toBe("TIMEOUT");
  });
});

describe("defect 2: SSE event framing and JSON-RPC id matching", () => {
  it("a single event whose data spans several data: lines is one JSON document", async () => {
    const baseUrl = await startMock((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        "event: message\n" +
          'data: {"jsonrpc":"2.0","id":1,\n' +
          'data: "result":{"structuredContent":{"total":7}}}\n\n',
      );
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });

    // Before the fix each data: line was parsed alone -> PARSER_ERROR.
    const outcome = await gateway.callTool({ toolName: "search", args: {} });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.data).toEqual({ total: 7 });
  });

  it("a trailing notification frame does not shadow the response frame", async () => {
    const baseUrl = await startMock((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        "event: message\n" +
          'data: {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"total":3}}}\n\n' +
          "event: message\n" +
          'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"done"}}\n\n',
      );
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });

    // Before the fix the LAST frame (the notification) was selected -> the
    // response had no `result` -> PARSER_ERROR on a successful tool call.
    const outcome = await gateway.callTool({ toolName: "search", args: {} });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.data).toEqual({ total: 3 });
  });

  it("a trailing progress notification before an error frame still maps the error", async () => {
    const baseUrl = await startMock((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n' +
          'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid params"}}\n\n' +
          'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"data":"bye"}}\n\n',
      );
    });
    const gateway = new HttpMcpGateway({ baseUrl, bearerToken: "t" });
    const outcome = await gateway.callTool({ toolName: "search", args: {} });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.kind).toBe("INVALID_REQUEST");
  });
});

describe("parseJsonRpcHttpBody: event framing unit tests", () => {
  it("joins multi-line data fields with a newline (SSE spec)", () => {
    const body = 'data: {"id":9,\ndata: "result":{"ok":true}}\n\n';
    expect(parseJsonRpcHttpBody(body)).toMatchObject({ id: 9, result: { ok: true } });
  });

  it("selects the frame whose id matches the request id", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"b":2}}\n\n';
    expect(parseJsonRpcHttpBody(body, 1)).toMatchObject({ id: 1, result: { a: 1 } });
    expect(parseJsonRpcHttpBody(body, 2)).toMatchObject({ id: 2, result: { b: 2 } });
  });

  it("ignores id-less notification frames when an id is requested", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":4,"result":{"a":1}}\n\n' +
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n';
    expect(parseJsonRpcHttpBody(body, 4)).toMatchObject({ id: 4 });
  });

  it("falls back to the last frame carrying result/error when no id matches", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":7,"result":{"a":1}}\n\n' +
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n';
    expect(parseJsonRpcHttpBody(body, 999)).toMatchObject({ id: 7 });
  });

  it("handles CRLF line endings and `data:` without a space", () => {
    const body = 'event: message\r\ndata:{"id":1,"result":{"ok":1}}\r\n\r\n';
    expect(parseJsonRpcHttpBody(body, 1)).toMatchObject({ id: 1 });
  });

  it("still throws when no frame carries a JSON payload", () => {
    expect(() => parseJsonRpcHttpBody("event: ping\n\n")).toThrow();
    expect(() => parseJsonRpcHttpBody("data: not json at all\n\n")).toThrow();
  });

  it("still accepts a plain (non-SSE) JSON body", () => {
    expect(parseJsonRpcHttpBody('{"jsonrpc":"2.0","id":3,"result":{}}', 3)).toMatchObject({
      id: 3,
    });
  });
});
