/**
 * MANUAL live deep-research smoke (Lane F2). NOT part of any test suite or CI.
 *
 *   node control-plane/scripts/live-research-smoke.mjs
 *
 * What it does — ONE bounded run, sequential calls only (the bounded executor
 * makes one tool call at a time; court and legislation share one Bedesten
 * quota):
 *   1. spawns scripts/serve-mcp.mjs (real uvicorn MCP gateway on loopback,
 *      generated token, provider keys blank);
 *   2. builds an HttpMcpGateway against it and probes tools/list;
 *   3. runs ONE research question with budgets
 *      {maxToolCalls: 8, maxFetches: 2, maxWallTimeMs: 90000};
 *   4. prints the tool-call table, fetched document titles + sha256, claim
 *      count, terminal status, and whether every citation passes the
 *      deterministic validator against the fetched canonical text.
 *
 * EXIT CODE: 0 for ANY typed terminal state (COMPLETE / QUALIFIED / PARTIAL /
 * ABSTAIN — upstream may be down; a typed partial still proves the wiring),
 * and 0 for a typed UPSTREAM_UNAVAILABLE condition. Only a raw throw exits 1.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { importControlPlane } from "./ts-loader.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const QUESTION =
  "mülkiyet hakkına dayalı tapu iptali ve tescil davasında görevli mahkeme";
const BUDGETS = { maxToolCalls: 8, maxFetches: 2, maxWallTimeMs: 90_000 };
const PORT = 8897;

function startServeMcp() {
  const child = spawn(
    process.execPath,
    [path.join(SCRIPT_DIR, "serve-mcp.mjs"), "--port", String(PORT)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const ready = new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("serve-mcp did not become ready within 120s")),
      120_000,
    );
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const line = buffer.split("\n").find((l) => l.trim().startsWith("{"));
      if (line !== undefined) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`serve-mcp exited early with code ${code}`));
    });
  });
  return { child, ready };
}

function fmtTable(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
  );
  const line = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

async function main() {
  const { child, ready } = startServeMcp();
  try {
    const { port, token } = await ready;
    console.log(`[smoke] MCP gateway ready on 127.0.0.1:${port}`);

    const { createSessionMcpGateway, probeMcpTools } = await importControlPlane(
      "src/research/mcpSession.ts",
    );
    const { runResearch } = await importControlPlane("src/research/researchService.ts");
    const { validateEvidence } = await importControlPlane("src/verification/validator.ts");

    const baseUrl = `http://127.0.0.1:${port}`;
    const probed = await probeMcpTools({ baseUrl, bearerToken: token });
    console.log(
      `[smoke] MCP handshake + tools/list: gateway=${probed.gateway}` +
        (probed.toolCount !== undefined ? ` toolCount=${probed.toolCount}` : ""),
    );

    const gateway = createSessionMcpGateway({ baseUrl, bearerToken: token, timeoutMs: 30_000 });
    console.log(`[smoke] question: ${QUESTION}`);
    console.log(`[smoke] budgets: ${JSON.stringify(BUDGETS)}`);
    const started = Date.now();
    const run = await runResearch({ question: QUESTION, budgets: BUDGETS, gateway });
    const { result } = run;

    console.log("\n=== TOOL CALLS ===");
    console.log(
      fmtTable(
        result.research.toolCalls.map((t) => [
          t.capability,
          t.tool,
          t.ok ? "ok" : "FAIL",
          `${t.ms}ms`,
          t.resultCount ?? "-",
        ]),
        ["capability", "tool", "ok", "ms", "results"],
      ),
    );

    console.log("\n=== FETCHED DOCUMENTS ===");
    if (result.research.fetchedDocuments.length === 0) console.log("(none)");
    for (const doc of result.research.fetchedDocuments) {
      console.log(`- [${doc.source}/${doc.externalId}] ${doc.title}`);
      console.log(`  sha256=${doc.sha256}${doc.injectionFlagged ? "  INJECTION-FLAGGED" : ""}`);
    }

    // Re-run the deterministic validator over every citation.
    let citations = 0;
    let citationsValid = 0;
    for (const item of run.pack.items) {
      citations += 1;
      const text = run.pack.texts[item.ref.documentVersionId];
      if (text !== undefined && validateEvidence(item.ref, text).ok) citationsValid += 1;
    }

    console.log("\n=== RESULT ===");
    console.log(`status:            ${result.status}`);
    console.log(`finalizable:       ${result.finalizable}`);
    console.log(`claims:            ${result.claims.length}`);
    console.log(`evidence items:    ${result.evidence.length}`);
    console.log(`citations valid:   ${citationsValid}/${citations}`);
    console.log(`upstream healthy:  ${result.research.upstream.healthy}`);
    console.log(`unreachable:       ${run.unreachable}`);
    console.log(
      `budget spent:      toolCalls=${result.research.budgetSpent.toolCalls} ` +
        `fetches=${result.research.budgetSpent.fetches} ` +
        `wallTimeMs=${result.research.budgetSpent.wallTimeMs}`,
    );
    console.log(`wall time (smoke): ${Date.now() - started}ms`);
    for (const note of result.research.upstream.notes) console.log(`note: ${note}`);
    for (const reason of result.reasons) console.log(`reason: ${reason}`);

    const typedTerminal = ["COMPLETE", "QUALIFIED", "PARTIAL", "ABSTAIN"].includes(result.status);
    const allCitationsValid = citationsValid === citations;
    console.log(
      `\n[smoke] typed terminal state: ${typedTerminal ? "YES" : "NO"}; ` +
        `all citations validator-passing: ${allCitationsValid ? "YES" : "NO (or none)"}`,
    );
    if (!typedTerminal || (citations > 0 && !allCitationsValid)) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5000).unref?.();
  }
}

main().catch((error) => {
  console.error(`[smoke] RAW FAILURE: ${error?.stack ?? error}`);
  process.exit(1);
});
