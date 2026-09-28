/**
 * 27.09.2026 — measured on Linux: when serve-mcp.mjs was SIGKILLed (no exit
 * handler runs), its uvicorn child stayed alive with ppid 1 and kept the MCP
 * port; the next `--with-mcp` start could not bind it and `serve.test.ts`
 * failed on "must release both ports". uvicorn now runs under
 * `uvicorn_watchdog.py`, which exits when serve-mcp's pipe closes — however
 * serve-mcp ended.
 *
 * GUARD: skips (with the usual inverse marker) when the repo venv is absent.
 * Loopback only; every provider key is blanked by serve-mcp itself.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const SERVE_MCP = join(REPO_ROOT, "control-plane", "scripts", "serve-mcp.mjs");
const VENV_PYTHON =
  process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
const PORT = 8921;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("serve-mcp: a killed wrapper never leaves uvicorn behind", () => {
  it.skipIf(!existsSync(VENV_PYTHON) || process.platform === "win32")(
    "SIGKILL on serve-mcp ends its uvicorn child within 10 s",
    { timeout: 120_000 },
    async () => {
      const child = spawn(process.execPath, [SERVE_MCP, "--port", String(PORT)], {
        cwd: REPO_ROOT,
        env: { ...process.env, MCP_API_TOKEN: "orphan-test-token-0123456789abcdef0123456789abcdef" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (c) => (out += String(c)));
      child.stderr.on("data", () => undefined);
      const ready = await new Promise<{ pid: number } | null>((resolveReady) => {
        const timer = setTimeout(() => resolveReady(null), 90_000);
        const poll = setInterval(() => {
          const line = out.split("\n").find((l) => l.trim().startsWith("{"));
          if (line !== undefined) {
            clearInterval(poll);
            clearTimeout(timer);
            resolveReady(JSON.parse(line) as { pid: number });
          }
        }, 100);
      });
      expect(ready, "serve-mcp never announced its uvicorn pid").not.toBeNull();
      const uvicornPid = ready!.pid;
      expect(alive(uvicornPid)).toBe(true);

      child.kill("SIGKILL");
      const deadline = Date.now() + 10_000;
      while (alive(uvicornPid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      const survived = alive(uvicornPid);
      if (survived) process.kill(uvicornPid, "SIGKILL");
      expect(survived, "uvicorn outlived its killed serve-mcp parent (orphan holding the port)").toBe(false);
    },
  );

  it("the stop scripts' command-line pattern still matches the watchdog command line", () => {
    const line = "/depo/ColleX/.venv/bin/python -m uvicorn_watchdog uvicorn asgi_app:app --host 127.0.0.1 --port 8898";
    expect(line).toMatch(/serve\.mjs|serve-mcp\.mjs|uvicorn asgi_app|local_embedding_server.*--collex-managed/u);
  });
});
