// control-plane/scripts/live-gateway-check.mjs
//
// LIVE local gateway verification over the real MCP streamable HTTP
// transport — loopback only, zero external traffic.
//
// Plain Node (>=18, global fetch). NO imports from control-plane/src, no
// package dependencies: this script must run against a checkout with nothing
// but Node installed.
//
// Usage:
//   node live-gateway-check.mjs <baseUrl> <bearerToken>
//   e.g. node live-gateway-check.mjs http://127.0.0.1:8899 local-...-token
//
// Steps (JSON-RPC over POST <baseUrl>/mcp/):
//   1. initialize            -> capture Mcp-Session-Id
//   2. notifications/initialized
//   3. tools/list            -> assert EXACTLY 54 tools (offline surface)
//   4. tools/call search_kvkk_decisions -> expect structured
//      'KVKK module disabled' content (proves the full call path works with
//      blanked provider keys and no external traffic)
//   5. POST /mcp/ without Authorization -> expect 401
//
// Exit code 0 on success, 1 on any failure.

const [baseUrl, token] = process.argv.slice(2);

if (!baseUrl || !token) {
  console.error("usage: node live-gateway-check.mjs <baseUrl> <bearerToken>");
  process.exit(1);
}

const MCP_URL = `${baseUrl.replace(/\/+$/, "")}/mcp/`;
const PROTOCOL_VERSION = "2025-06-18";

let failures = 0;
function ok(label, detail = "") {
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label, detail = "") {
  failures += 1;
  console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Parse a streamable-HTTP response body (SSE or plain JSON) into JSON-RPC
 *  messages. Returns an array of parsed message objects. */
async function parseBody(res) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  if (contentType.includes("text/event-stream")) {
    const messages = [];
    for (const rawEvent of text.split(/\r?\n\r?\n/)) {
      const dataLines = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;
      try {
        messages.push(JSON.parse(dataLines.join("\n")));
      } catch {
        // Ignore non-JSON keep-alive data.
      }
    }
    return messages;
  }
  if (!text.trim()) return [];
  try {
    return [JSON.parse(text)];
  } catch {
    return [];
  }
}

/** POST one JSON-RPC message. Returns {status, headers, messages}. */
async function post(body, { sessionId, withAuth = true } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (withAuth) headers.Authorization = `Bearer ${token}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const messages = await parseBody(res);
  return { status: res.status, headers: res.headers, messages };
}

/** Send a request and return the JSON-RPC response matching its id. */
async function rpc(id, method, params, sessionId) {
  const { status, headers, messages } = await post(
    { jsonrpc: "2.0", id, method, params },
    { sessionId },
  );
  if (status !== 200) {
    throw new Error(`${method}: HTTP ${status} (expected 200)`);
  }
  const response = messages.find((m) => m && m.id === id);
  if (!response) {
    throw new Error(
      `${method}: no JSON-RPC response with id=${id} in body ` +
        `(${messages.length} message(s) parsed)`,
    );
  }
  if (response.error) {
    throw new Error(`${method}: JSON-RPC error ${JSON.stringify(response.error)}`);
  }
  return { result: response.result, headers };
}

async function main() {
  // --- 1. initialize ------------------------------------------------------
  const init = await rpc(1, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "live-gateway-check", version: "1.0.0" },
  });
  const serverInfo = init.result?.serverInfo || {};
  const sessionId = init.headers.get("mcp-session-id") || undefined;
  ok(
    "initialize",
    `server=${serverInfo.name ?? "?"} protocol=${init.result?.protocolVersion ?? "?"} session=${sessionId ? "yes" : "no"}`,
  );

  // --- 2. notifications/initialized --------------------------------------
  const notif = await post(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { sessionId },
  );
  if (notif.status === 202 || notif.status === 200) {
    ok("notifications/initialized", `HTTP ${notif.status}`);
  } else {
    fail("notifications/initialized", `HTTP ${notif.status} (expected 202/200)`);
  }

  // --- 3. tools/list: assert exactly 54 tools -----------------------------
  const toolNames = [];
  let cursor = undefined;
  let listId = 2;
  do {
    const page = await rpc(
      listId,
      "tools/list",
      cursor ? { cursor } : {},
      sessionId,
    );
    for (const tool of page.result?.tools ?? []) toolNames.push(tool.name);
    cursor = page.result?.nextCursor;
    listId += 1;
  } while (cursor);
  if (toolNames.length === 54) {
    ok("tools/list", "exactly 54 tools (offline surface)");
  } else {
    fail("tools/list", `expected 54 tools, got ${toolNames.length}`);
  }
  for (const expected of [
    "search_bedesten_unified",
    "search_kvkk_decisions",
    "search_mevzuat",
    "check_government_servers_health",
  ]) {
    if (!toolNames.includes(expected)) {
      fail("tools/list", `missing expected tool: ${expected}`);
    }
  }

  // --- 4. tools/call search_kvkk_decisions: structured disabled error -----
  const call = await rpc(
    100,
    "tools/call",
    { name: "search_kvkk_decisions", arguments: { keywords: "test" } },
    sessionId,
  );
  const serialized = JSON.stringify(call.result ?? {});
  if (serialized.includes("KVKK module disabled")) {
    ok(
      "tools/call search_kvkk_decisions",
      "structured 'KVKK module disabled' content (call path live, zero external traffic)",
    );
  } else {
    fail(
      "tools/call search_kvkk_decisions",
      `no 'KVKK module disabled' marker in result: ${serialized.slice(0, 300)}`,
    );
  }

  // --- 5. unauthorized probe: expect 401 ----------------------------------
  const unauthorized = await post(
    { jsonrpc: "2.0", id: 999, method: "tools/list", params: {} },
    { withAuth: false },
  );
  if (unauthorized.status === 401) {
    ok("unauthorized probe", "HTTP 401 without bearer token");
  } else {
    fail("unauthorized probe", `HTTP ${unauthorized.status} (expected 401)`);
  }

  if (failures > 0) {
    console.error(`live gateway check FAILED: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log(
    "live gateway check passed: initialize, 54 tools, disabled-module call path, 401 without token",
  );
}

main().catch((error) => {
  console.error(`live gateway check ERROR: ${error?.stack || error}`);
  process.exit(1);
});
