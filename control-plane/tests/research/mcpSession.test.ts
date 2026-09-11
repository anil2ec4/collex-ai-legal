/**
 * Offline tests for the MCP streamable-HTTP session layer: a fake FastMCP
 * server implemented as an injected fetch. Verifies the REAL transport rules
 * the live gateway enforces: initialize -> Mcp-Session-Id -> header on every
 * later call; 404 for an unknown session; paginated tools/list.
 */

import { describe, expect, it } from "vitest";
import {
  createSessionMcpGateway,
  probeMcpTools,
} from "../../src/research/mcpSession.js";

interface FakeServerOptions {
  toolPages?: string[][];
  /** When true, the first established session dies after the first tools/call. */
  dropSessionOnce?: boolean;
}

interface RpcBody {
  jsonrpc: string;
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

class FakeFastMcpServer {
  readonly log: string[] = [];
  private readonly sessions = new Set<string>();
  private nextSession = 1;
  private dropArmed: boolean;
  private readonly toolPages: string[][];

  constructor(options: FakeServerOptions = {}) {
    this.toolPages = options.toolPages ?? [["search_bedesten_unified", "fetch"]];
    this.dropArmed = options.dropSessionOnce === true;
  }

  fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer secret-token-0123456789-0123456789-xx") {
      this.log.push("unauthorized");
      return new Response("unauthorized", { status: 401 });
    }
    const body = JSON.parse(String(init?.body)) as RpcBody;
    const sessionId = headers.get("mcp-session-id") ?? undefined;

    if (body.method === "initialize") {
      const id = `session-${this.nextSession++}`;
      this.sessions.add(id);
      this.log.push(`initialize:${id}`);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } },
        }),
        { status: 200, headers: { "content-type": "application/json", "mcp-session-id": id } },
      );
    }
    if (body.method === "notifications/initialized") {
      this.log.push(`initialized:${sessionId}`);
      return new Response(null, { status: 202 });
    }
    if (sessionId === undefined || !this.sessions.has(sessionId)) {
      this.log.push(`no-session:${body.method}`);
      return new Response("session not found", { status: 404 });
    }
    if (body.method === "tools/list") {
      const cursor = Number(body.params?.["cursor"] ?? 0);
      const page = this.toolPages[cursor] ?? [];
      const nextCursor = cursor + 1 < this.toolPages.length ? String(cursor + 1) : undefined;
      this.log.push(`tools/list:${cursor}`);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: page.map((name) => ({ name })),
            ...(nextCursor !== undefined ? { nextCursor } : {}),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (body.method === "tools/call") {
      this.log.push(`tools/call:${String((body.params as { name?: string })?.name)}:${sessionId}`);
      if (this.dropArmed) {
        this.dropArmed = false;
        this.sessions.delete(sessionId);
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ okFrom: sessionId }) }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("bad request", { status: 400 });
  };
}

const OPTIONS = {
  baseUrl: "http://127.0.0.1:9",
  bearerToken: "secret-token-0123456789-0123456789-xx",
};

describe("createSessionMcpGateway", () => {
  it("initializes once and sends the session header on every tools/call", async () => {
    const server = new FakeFastMcpServer();
    const gateway = createSessionMcpGateway({ ...OPTIONS, fetchImpl: server.fetchImpl });

    const first = await gateway.callTool({ toolName: "fetch", args: { id: "1" } });
    const second = await gateway.callTool({ toolName: "fetch", args: { id: "2" } });
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    // Exactly ONE handshake for the whole gateway lifetime.
    expect(server.log.filter((l) => l.startsWith("initialize:"))).toHaveLength(1);
    expect(server.log).toContain("initialized:session-1");
    expect(server.log.filter((l) => l.startsWith("tools/call:"))).toEqual([
      "tools/call:fetch:session-1",
      "tools/call:fetch:session-1",
    ]);
  });

  it("re-initializes exactly once when the server reports the session gone", async () => {
    const server = new FakeFastMcpServer({ dropSessionOnce: true });
    const gateway = createSessionMcpGateway({ ...OPTIONS, fetchImpl: server.fetchImpl });

    const first = await gateway.callTool({ toolName: "fetch", args: { id: "1" } });
    expect(first.status).toBe("ok");
    // Session was dropped after the first call: the next call sees 404 and
    // transparently re-establishes a session, then succeeds.
    const second = await gateway.callTool({ toolName: "fetch", args: { id: "2" } });
    expect(second.status).toBe("ok");
    expect(server.log.filter((l) => l.startsWith("initialize:"))).toHaveLength(2);
    expect(server.log).toContain("tools/call:fetch:session-2");
  });

  it("degrades to a typed error Outcome when the handshake itself fails", async () => {
    const gateway = createSessionMcpGateway({
      ...OPTIONS,
      bearerToken: "wrong-token-0123456789-0123456789-xxxx",
      fetchImpl: new FakeFastMcpServer().fetchImpl,
    });
    const outcome = await gateway.callTool({ toolName: "fetch", args: { id: "1" } });
    expect(outcome.status).toBe("error");
  });
});

describe("probeMcpTools", () => {
  it("counts tools across paginated tools/list", async () => {
    const server = new FakeFastMcpServer({
      toolPages: [["a", "b"], ["c"], ["d", "e", "f"]],
    });
    const result = await probeMcpTools({ ...OPTIONS, fetchImpl: server.fetchImpl });
    expect(result).toEqual({ gateway: "ok", toolCount: 6 });
  });

  it("reports unreachable on any transport failure", async () => {
    const result = await probeMcpTools({
      ...OPTIONS,
      bearerToken: "wrong-token-0123456789-0123456789-xxxx",
      fetchImpl: new FakeFastMcpServer().fetchImpl,
    });
    expect(result).toEqual({ gateway: "unreachable" });
  });
});
