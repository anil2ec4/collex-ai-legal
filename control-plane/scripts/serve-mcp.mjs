/**
 * Spawn the REAL Python MCP provider gateway for local product use (Lane F2).
 *
 *   node control-plane/scripts/serve-mcp.mjs [--port 8898] [--parent-stdin]
 *   MCP_API_TOKEN=<40+ chars> node control-plane/scripts/serve-mcp.mjs ...
 *
 * What it does:
 *   - launches `.venv/Scripts/python.exe -m uvicorn asgi_app:app` on
 *     127.0.0.1:<port> with REQUIRE_HTTP_AUTH=true and a generated (or given)
 *     MCP_API_TOKEN. The token comes from the ENVIRONMENT only (W12-FIX2,
 *     P2-15): a `--token` argument used to put the bearer secret on the
 *     child's command line, where every process on the machine can read it
 *     (Task Manager, `tasklist /v`, Get-CimInstance); the flag is refused;
 *   - provider search keys are BLANKED (Bedesten needs none; KVKK/BDDK/Sigorta
 *     report a disabled credential — that is the expected local posture);
 *   - the child environment is a CLEAN WHITELIST (PATH/TEMP/system vars plus
 *     our overrides) — this script never reads `.env` or forwards the parent
 *     environment wholesale;
 *   - COLLEX_NO_DOTENV=1 tells mcp_server_main.py to SKIP load_dotenv, so the
 *     clean whitelist really is the child's whole environment (W12-F);
 *     LOG_LEVEL=WARNING keeps the gateway quiet on the console;
 *   - waits for GET /health, then prints exactly one JSON line
 *     `{"port":...,"token":"...","pid":<uvicorn pid>}` for a consumer
 *     (serve.mjs / the live smoke) to parse, and keeps running until
 *     SIGINT/SIGTERM/parent exit.
 *
 * Loopback only. Never expose this beyond 127.0.0.1.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 90_000;

function parseArgs(argv) {
  const args = { port: 8898, token: process.env["MCP_API_TOKEN"] ?? "", parentStdin: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") args.port = Number(argv[++i]);
    else if (argv[i] === "--token" || argv[i]?.startsWith("--token=")) {
      throw new Error("--token is not accepted: pass the token in the MCP_API_TOKEN environment variable (never on the command line)");
    }
    // Set by serve.mjs: our stdin is a pipe the parent holds open; when it
    // closes (parent killed — on Windows a killed node runs no exit hooks)
    // we shut the uvicorn child down instead of orphaning it on its port.
    else if (argv[i] === "--parent-stdin") args.parentStdin = true;
    else throw new Error(`unknown flag: ${argv[i]}`);
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`invalid port: ${args.port}`);
  }
  if (args.token === "") {
    // 48 hex chars (>= 40 required by the lane contract, >= 32 by the server).
    args.token = randomBytes(24).toString("hex");
  }
  if (args.token.length < 40) {
    throw new Error("MCP token must be at least 40 characters");
  }
  return args;
}

function venvPython() {
  const candidates = [
    path.join(REPO_ROOT, ".venv", "Scripts", "python.exe"), // Windows
    path.join(REPO_ROOT, ".venv", "bin", "python"), // POSIX
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`repo venv python not found under ${path.join(REPO_ROOT, ".venv")}`);
}

/**
 * Clean environment whitelist. Only process-infrastructure variables cross
 * into the child, plus our explicit overrides. `.env` is NOT read here; the
 * blank provider keys also stop the server's own load_dotenv from overriding
 * them (dotenv never overrides variables that are already set).
 */
function childEnv(token) {
  const passthrough = [
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "HOME",
    "LANG",
    "LC_ALL",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ];
  const env = {};
  for (const name of passthrough) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    REQUIRE_HTTP_AUTH: "true",
    MCP_API_TOKEN: token,
    // Fail-closed provider posture: no key, no outbound provider search.
    OPENROUTER_API_KEY: "",
    BRAVE_API_TOKEN: "",
    TAVILY_API_KEY: "",
    MISTRAL_API_KEY: "",
    // The server must not re-read .env underneath this whitelist.
    COLLEX_NO_DOTENV: "1",
    LOG_LEVEL: "WARNING",
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`MCP server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`MCP server never became healthy on ${baseUrl}: ${lastError}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = `http://${HOST}:${args.port}`;
  const python = venvPython();

  const child = spawn(
    python,
    [
      "-m",
      // uvicorn_watchdog.py: uvicorn exits when this process's pipe closes,
      // however this process ends (a SIGKILL skips every handler below).
      "uvicorn_watchdog",
      "uvicorn",
      "asgi_app:app",
      "--host",
      HOST,
      "--port",
      String(args.port),
      "--log-level",
      "warning",
    ],
    {
      cwd: REPO_ROOT,
      env: childEnv(args.token),
      // stdin is the parent-death pipe: never written, only held open.
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  // Server logs go to stderr so stdout stays a machine-parseable channel.
  child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5000);
      killTimer.unref?.();
    }
    process.exitCode = code;
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("exit", () => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  if (args.parentStdin) {
    // Parent-death watchdog: the pipe ends when serve.mjs is gone.
    process.stdin.on("end", () => shutdown(0));
    process.stdin.on("close", () => shutdown(0));
    process.stdin.on("error", () => shutdown(0));
    process.stdin.resume();
  }
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stderr.write(`[serve-mcp] server exited with code ${code}\n`);
      process.exit(code ?? 1);
    }
  });

  await waitForHealth(baseUrl, child);
  // The ready line: exactly one JSON object on stdout (pid = the uvicorn
  // process, so a launcher can kill the actual listener, not just this wrapper).
  process.stdout.write(
    `${JSON.stringify({ port: args.port, token: args.token, pid: child.pid })}\n`,
  );
  process.stderr.write(`[serve-mcp] MCP gateway ready on ${baseUrl} (loopback only)\n`);
}

main().catch((error) => {
  process.stderr.write(`[serve-mcp] ERROR: ${error?.message ?? error}\n`);
  process.exit(1);
});
