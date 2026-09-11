/**
 * Local dev entrypoint: `npm run dev` (builds, then runs this from dist/).
 *
 * Environment:
 *   PORT           - control-plane port (default 8787)
 *   MCP_BASE_URL   - FastMCP HTTP server origin (default http://127.0.0.1:8000)
 *   MCP_API_TOKEN  - bearer token for the FastMCP server (never logged)
 */

import { serve } from "@hono/node-server";
import { createApp } from "./server.js";
import { HttpMcpGateway } from "../gateway/gateway.js";
import { InMemoryRunStore } from "../orchestration/executor.js";

const port = Number(process.env["PORT"] ?? 8787);
const mcpBaseUrl = process.env["MCP_BASE_URL"] ?? "http://127.0.0.1:8000";
const bearerToken = process.env["MCP_API_TOKEN"] ?? "";

const gateway = new HttpMcpGateway({ baseUrl: mcpBaseUrl, bearerToken });
const app = createApp({ gateway, runStore: new InMemoryRunStore() });

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  // Deliberately do NOT log the token or any env values.
  console.log(
    `[control-plane] listening on http://127.0.0.1:${info.port} (MCP upstream: ${mcpBaseUrl})`,
  );
});
