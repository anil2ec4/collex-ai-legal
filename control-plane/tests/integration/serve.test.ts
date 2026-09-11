/**
 * Launcher lifecycle proof for scripts/serve.mjs (W12-F), spawning the REAL
 * script as a child process:
 *
 *   1. a DSN pointing at a closed loopback port -> exit 1 within 8 s with the
 *      Turkish diagnosis ("veritabanı: ÇALIŞMIYOR — ColleX-Baslat.cmd ile
 *      başlatın") and NO HTTP socket ever opened (needs nothing but node +
 *      the repo venv, which serve.mjs resolves at startup);
 *   2. the real scratch PostgreSQL -> HTTP binds on port 8817 and /v1/health
 *      answers 200 within 15 s; the process is then killed and the port is
 *      free again;
 *   3. a port already taken -> exit 1 with the Turkish EADDRINUSE message.
 *
 * GUARDS: everything skips cleanly when the repo venv is absent; 2 and 3 skip
 * when 127.0.0.1:55432 does not accept a TCP connection. The DSN used against
 * the real server is this lane's own scratch name (collex_intake_test) — the
 * script only reads (`select 1`, to_regclass); collex_local is never touched.
 * Ports 8817/8818 belong to this lane's probes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const SERVE = join(REPO_ROOT, "control-plane", "scripts", "serve.mjs");
const VENV_PYTHON =
  process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
const PG_HOSTPORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
const REAL_DSN = `postgres://postgres@${PG_HOSTPORT}/collex_intake_test`;
const HEALTH_PORT = 8817;
const BUSY_PORT = 8818;
/** --with-mcp probe (W12-FIX2, P2-15): this lane's ports for the token test. */
const MCP_TEST_PORT = 8819;
const MCP_GATEWAY_PORT = 8919;

/**
 * Command lines of every process whose command line mentions `needle`
 * (Windows: WMI via PowerShell; POSIX: ps). What Task Manager / any other
 * user on the machine can see — the surface the token must not be on.
 */
function commandLinesMentioning(needle: string): Promise<string[]> {
  return new Promise((resolvePromise) => {
    const done = (stdout: string): void =>
      resolvePromise(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== "" && line.includes(needle)),
      );
    if (process.platform === "win32") {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { $_.CommandLine }",
        ],
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (_error, stdout) => done(stdout ?? ""),
      );
    } else {
      execFile("ps", ["-eo", "args"], { maxBuffer: 16 * 1024 * 1024 }, (_error, stdout) => done(stdout ?? ""));
    }
  });
}

function tcpListening(hostPort: string): Promise<boolean> {
  const [host, port] = hostPort.split(":");
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: host ?? "127.0.0.1", port: Number(port) });
    const done = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(1_000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function closedLoopbackPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
    server.once("error", reject);
  });
}

interface Spawned {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function spawnServe(args: string[]): Spawned {
  const child = spawn(process.execPath, [SERVE, ...args], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
  });
  const exited = new Promise<number | null>((resolvePromise) => {
    child.once("exit", (code) => resolvePromise(code));
  });
  return { child, output: () => buffer, exited };
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  stepMs = 250,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, stepMs));
  }
  return undefined;
}

async function killAndWait(spawned: Spawned): Promise<void> {
  if (spawned.child.exitCode === null) spawned.child.kill();
  await Promise.race([spawned.exited, new Promise((r) => setTimeout(r, 5_000))]);
  if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL");
}

const venvPresent = existsSync(VENV_PYTHON);
const pgReachable = venvPresent ? await tcpListening(PG_HOSTPORT) : false;

describe.skipIf(!venvPresent)("scripts/serve.mjs lifecycle", () => {
  const running: Spawned[] = [];
  it.each(["0", "65536", "8898", "8787"])("rejects invalid or colliding local embedding port %s", async (port) => {
    const spawned = spawnServe(["--port", "8787", "--with-mcp", "--mcp-port", "8898", "--local-embeddings-port", port]);
    running.push(spawned);
    expect(await spawned.exited).toBe(1);
    expect(spawned.output()).toContain("invalid or conflicting --local-embeddings-port");
  });
  afterEach(async () => {
    for (const spawned of running.splice(0)) await killAndWait(spawned);
  });

  it(
    "exits 1 with the Turkish diagnosis within 8 s when the database is down",
    { timeout: 30_000 },
    async () => {
      const port = await closedLoopbackPort();
      const spawned = spawnServe([
        "--port",
        String(HEALTH_PORT),
        "--dsn",
        `postgres://postgres@127.0.0.1:${port}/collex_intake_test`,
      ]);
      running.push(spawned);
      const started = Date.now();
      const code = await Promise.race([
        spawned.exited,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 8_000)),
      ]);
      const elapsed = Date.now() - started;
      expect(code, spawned.output()).toBe(1);
      expect(elapsed).toBeLessThan(8_000);
      expect(spawned.output()).toContain("veritabanı: ÇALIŞMIYOR — ColleX-Baslat.cmd ile başlatın");
      // The HTTP port was never bound.
      expect(await tcpListening(`127.0.0.1:${HEALTH_PORT}`)).toBe(false);
    },
  );

  it.skipIf(!pgReachable)(
    "binds HTTP and answers /v1/health 200 within 15 s against the real scratch PostgreSQL",
    { timeout: 40_000 },
    async () => {
      const spawned = spawnServe(["--port", String(HEALTH_PORT), "--dsn", REAL_DSN]);
      running.push(spawned);
      const health = await waitFor(async () => {
        if (spawned.child.exitCode !== null) return { status: -1 };
        try {
          const res = await fetch(`http://127.0.0.1:${HEALTH_PORT}/v1/health`, {
            signal: AbortSignal.timeout(1_000),
          });
          return { status: res.status, body: (await res.json()) as Record<string, unknown> };
        } catch {
          return undefined;
        }
      }, 15_000);
      expect(health, spawned.output()).toBeDefined();
      expect(health?.status, spawned.output()).toBe(200);
      expect(health?.body?.["service"]).toBe("@collex/control-plane");
      expect(spawned.output()).toContain("[collex] konsol : http://127.0.0.1:8817/");
      expect(spawned.output()).toContain("mcp    : kapalı");
      // Research is honest without --with-mcp: typed 502 / 503, no fake data.
      const research = await fetch(`http://127.0.0.1:${HEALTH_PORT}/v1/research/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      expect(research.status).toBe(503);

      await killAndWait(spawned);
      // Nothing of ours keeps the port.
      const freed = await waitFor(
        async () => ((await tcpListening(`127.0.0.1:${HEALTH_PORT}`)) ? undefined : true),
        5_000,
      );
      expect(freed).toBe(true);
    },
  );

  it.skipIf(!pgReachable)(
    "--with-mcp: the gateway comes up with a token that is NOT on any command line (W12-FIX2, P2-15)",
    { timeout: 120_000 },
    async () => {
      const spawned = spawnServe([
        "--port",
        String(MCP_TEST_PORT),
        "--dsn",
        REAL_DSN,
        "--with-mcp",
        "--mcp-port",
        String(MCP_GATEWAY_PORT),
      ]);
      running.push(spawned);
      // The MCP child announces itself through /v1/health `mcp: "ok"`, which
      // proves the token reached uvicorn (serve-mcp waits for /health with it).
      const ready = await waitFor(async () => {
        if (spawned.child.exitCode !== null) return { mcp: "exited" };
        try {
          const res = await fetch(`http://127.0.0.1:${MCP_TEST_PORT}/v1/health`, { signal: AbortSignal.timeout(1_000) });
          const body = (await res.json()) as { mcp?: string };
          return body.mcp === "ok" ? { mcp: "ok" } : undefined;
        } catch {
          return undefined;
        }
      }, 90_000);
      expect(ready, spawned.output()).toEqual({ mcp: "ok" });
      expect(spawned.output()).toContain("mcp    : açık");

      const lines = await commandLinesMentioning("serve-mcp");
      expect(lines.length, "the serve-mcp child must be visible to the process listing").toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toMatch(/--token/u);
        // The token is 48 hex chars; nothing of that shape may appear.
        expect(line).not.toMatch(/\b[0-9a-f]{48}\b/u);
      }
      const uvicorn = await commandLinesMentioning("asgi_app");
      for (const line of uvicorn) expect(line).not.toMatch(/\b[0-9a-f]{48}\b/u);

      await killAndWait(spawned);
      const freed = await waitFor(
        async () =>
          (await tcpListening(`127.0.0.1:${MCP_TEST_PORT}`)) || (await tcpListening(`127.0.0.1:${MCP_GATEWAY_PORT}`))
            ? undefined
            : true,
        15_000,
      );
      expect(freed, "serve.mjs and its uvicorn child must release both ports").toBe(true);
    },
  );

  it.skipIf(!pgReachable)(
    "exits 1 with the Turkish EADDRINUSE message when the port is taken",
    { timeout: 40_000 },
    async () => {
      const blocker = createServer((_req, res) => res.end("busy"));
      await new Promise<void>((resolvePromise) => blocker.listen(BUSY_PORT, "127.0.0.1", resolvePromise));
      try {
        const spawned = spawnServe(["--port", String(BUSY_PORT), "--dsn", REAL_DSN]);
        running.push(spawned);
        const code = await Promise.race([
          spawned.exited,
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 20_000)),
        ]);
        expect(code, spawned.output()).toBe(1);
        expect(spawned.output()).toContain(`${BUSY_PORT} portu kullanımda`);
        expect(spawned.output()).toContain("ColleX-Durdur.cmd");
      } finally {
        await new Promise<void>((resolvePromise) => blocker.close(() => resolvePromise()));
      }
    },
  );
});

describe.skipIf(venvPresent)("scripts/serve.mjs lifecycle (environment unavailable)", () => {
  it("skips cleanly: the repo venv is missing", () => {
    expect(venvPresent).toBe(false);
  });
});

/**
 * W14 L-VERIFY V-4 — the launcher half of the originals seam, checked by
 * reading the script (no process, no database, never skipped).
 *
 * `serve.mjs` already resolves ONE data directory (`VAR_DIR`, which honours
 * `COLLEX_DATA_DIR`) and hands `<VAR_DIR>/uploads` to the backup runner. It
 * did NOT hand it to `createApp`, so the files router and the matter packager
 * read `<repo>/var/uploads` instead and every "Aslını indir" on a moved data
 * directory answered 404 ORIGINAL_NOT_FOUND (measured on port 8972).
 */
describe("scripts/serve.mjs: the originals directory reaches createApp (V-4)", () => {
  it("passes uploadsDir built from the SAME VAR_DIR the backup runner uses", async () => {
    const source = await readFile(SERVE, "utf8");
    const createAppCall = source.slice(source.indexOf("const app = createApp({"));
    expect(createAppCall).toContain('uploadsDir: path.join(VAR_DIR, "uploads")');
    // The backup runner reads the same expression — one directory, not two.
    expect(source).toContain('uploadsDir: path.join(VAR_DIR, "uploads")');
    // VAR_DIR is the COLLEX_DATA_DIR-aware resolver, not a repo-root constant.
    expect(source).toContain("const VAR_DIR = resolveDataDir();");
    expect(source).toContain('env["COLLEX_DATA_DIR"]');
  });
});
