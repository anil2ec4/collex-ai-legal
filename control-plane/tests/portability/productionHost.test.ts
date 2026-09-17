/**
 * W21 platform lane — acceptance M: the production configuration does not
 * need the Windows PC.
 *
 * UNVALIDATED ON PHYSICAL MAC. Nothing here runs on a Mac; what a Windows
 * test run CAN hold is:
 *
 *  - the macOS entrypoints (deploy/macos) talk only to services on the same
 *    machine (127.0.0.1 / localhost) and carry no Windows host, path, tool
 *    or variable;
 *  - they keep the Windows launcher's contract: the same serve.mjs flags and
 *    ports, ensure-db before the server, stop by command line and never by
 *    port, restore verifies before it renames and never drops;
 *  - serve.mjs and backup.mjs have no code path that exists only on
 *    Windows: backup.mjs is RUN here with the Windows user-profile variables
 *    removed, and its PostgreSQL lookup is computed for darwin.
 */

import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MACOS_PG_BIN_CANDIDATES, resolvePgBin, runBackup, type PgToolRunner } from "../../src/backup/runner.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const MACOS_DIR = path.join(REPO_ROOT, "deploy", "macos");
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const SCRIPTS = ["collex-env.sh", "collex-start.sh", "collex-stop.sh", "collex-backup.sh", "collex-restore.sh"];
const PLISTS = ["com.collex.app.plist", "com.collex.postgres.plist", "com.collex.backup.plist", "com.collex.llm.plist"];
const MARKER = "UNVALIDATED ON PHYSICAL MAC";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

function allMacFiles(dir = MACOS_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...allMacFiles(full));
    else out.push(full);
  }
  return out;
}

const relMac = (full: string): string => path.relative(REPO_ROOT, full).split(path.sep).join("/");

describe("deploy/macos inventory and markers", () => {
  it("has the four scripts, the shared settings file and the four launchd templates", () => {
    const names = allMacFiles().map(relMac);
    for (const script of SCRIPTS) expect(names).toContain(`deploy/macos/${script}`);
    for (const plist of PLISTS) expect(names).toContain(`deploy/macos/launchd/${plist}`);
  });

  it(`every file opens with the '${MARKER}' comment and uses LF line endings`, () => {
    for (const full of allMacFiles()) {
      const text = readFileSync(full, "utf8");
      const rel = relMac(full);
      expect(text.includes("\r"), `${rel} has CR characters`).toBe(false);
      const lines = text.split("\n");
      if (full.endsWith(".sh")) {
        expect(lines[0], rel).toBe("#!/bin/bash");
        expect(lines[1], rel).toBe(`# ${MARKER}`);
      } else if (full.endsWith(".plist")) {
        expect(lines[0], rel).toBe('<?xml version="1.0" encoding="UTF-8"?>');
        const comment = text.indexOf("<!--");
        expect(comment, rel).toBeGreaterThan(-1);
        expect(text.slice(comment + 4).trimStart().startsWith(MARKER), rel).toBe(true);
        expect(comment, rel).toBeLessThan(text.indexOf("<plist"));
        // An XML comment may not contain "--"; launchd would reject the file.
        const body = text.slice(comment + 4, text.indexOf("-->", comment));
        expect(body.includes("--"), `${rel}: "--" inside the XML comment`).toBe(false);
      } else {
        expect(lines[0], rel).toBe(`# ${MARKER}`);
      }
    }
  });
});

describe("acceptance M: the macOS entrypoints use only this machine", () => {
  const texts = allMacFiles().map((full) => ({ rel: relMac(full), text: readFileSync(full, "utf8") }));

  it("every URL and DSN host is loopback", () => {
    const seen: string[] = [];
    for (const { rel, text } of texts) {
      // The DOCTYPE's DTD identifier is never fetched by launchd.
      const scanned = text.replace(/<!DOCTYPE[^>]*>/gu, "");
      for (const match of scanned.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^/\s"'<>:]+)/giu)) {
        const host = (match[1] as string).split("@").pop() as string;
        seen.push(host);
        expect(LOCAL_HOSTS.has(host), `${rel}: ${match[0]}`).toBe(true);
      }
    }
    expect(seen.length).toBeGreaterThan(3);
  });

  it("no IP address other than 127.0.0.1, no LAN name, no wildcard bind", () => {
    for (const { rel, text } of texts) {
      for (const match of text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/gu)) {
        expect(match[0], rel).toBe("127.0.0.1");
      }
      expect(text, rel).not.toMatch(/\b[\w-]+\.local\b/u);
      expect(text, rel).not.toMatch(/\b0\.0\.0\.0\b|listen_addresses=\*/u);
    }
  });

  it("every host argument in the scripts is loopback", () => {
    for (const { rel, text } of texts.filter((t) => t.rel.endsWith(".sh"))) {
      for (const match of text.matchAll(/(?:^|\s)(?:-h|--host)\s+("?)([^\s"]+)\1/gmu)) {
        expect(LOCAL_HOSTS.has(match[2] as string), `${rel}: ${match[0].trim()}`).toBe(true);
      }
      for (const match of text.matchAll(/listen_addresses=([^\s"]+)/gu)) {
        expect(match[1], rel).toBe("127.0.0.1");
      }
    }
  });

  it("no Windows path, tool, variable or wording", () => {
    const markers = [
      /[A-Za-z]:\\/u,
      /\\\\/u,
      /%[A-Za-z_]+%/u,
      /\.exe\b/iu,
      /\bcmd(?:\.exe)?\s+\/[ck]\b/iu,
      /\bpowershell\b/iu,
      /\btaskkill\b/iu,
      /\brobocopy\b/iu,
      /\bscoop\b/iu,
      /\bUSERPROFILE\b/u,
      /\bLOCALAPPDATA\b/u,
      /\.venv\/Scripts/u,
      /\bBitLocker\b/u,
    ];
    for (const { rel, text } of texts) {
      for (const marker of markers) expect(text, `${rel} ${marker}`).not.toMatch(marker);
    }
  });
});

describe("the macOS scripts keep the Windows launcher's contract", () => {
  const env = read("deploy/macos/collex-env.sh");
  const start = read("deploy/macos/collex-start.sh");
  const stop = read("deploy/macos/collex-stop.sh");
  const backupSh = read("deploy/macos/collex-backup.sh");
  const restoreSh = read("deploy/macos/collex-restore.sh");
  const launcherCmd = read("ColleX-Baslat.cmd");
  const stopperCmd = read("ColleX-Durdur.cmd");

  it("starts serve.mjs with exactly the flags and ports ColleX-Baslat.cmd uses", () => {
    const cmdLine = launcherCmd.split(/\r?\n/u).find((line) => line.includes("serve.mjs --port")) ?? "";
    const cmdFlags = cmdLine.match(/--[a-z-]+/gu) ?? [];
    expect(cmdFlags).toEqual(["--port", "--with-mcp", "--with-local-embeddings", "--local-embeddings-port"]);
    const shLine = start.split("\n").find((line) => line.startsWith('set -- "$COLLEX_SERVE"')) ?? "";
    expect(shLine.match(/--[a-z-]+/gu) ?? []).toEqual(cmdFlags);
    // Same default ports as the Windows launcher.
    expect(launcherCmd).toContain('set "APPPORT=8787"');
    expect(cmdLine).toContain("--local-embeddings-port 8899");
    expect(env).toContain('COLLEX_APP_PORT="${COLLEX_APP_PORT:-8787}"');
    expect(env).toContain('COLLEX_EMBED_PORT="${COLLEX_EMBED_PORT:-8899}"');
    expect(env).toContain('COLLEX_PGPORT="${COLLEX_PGPORT:-55432}"');
  });

  it("prepares the database (ensure-db, never drop) BEFORE the server and stops on failure", () => {
    const ensureAt = start.indexOf("-m intake.cli --dsn");
    const serveAt = start.indexOf('set -- "$COLLEX_SERVE"');
    expect(ensureAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(serveAt);
    expect(start).toContain("--ensure-db --list");
    expect(start).toContain('"$COLLEX_PY" -m intake.cli');
    expect(env).toContain('COLLEX_PY="$COLLEX_HOME/.venv/bin/python"');
    const block = start.slice(ensureAt, start.indexOf("Veritabanı şeması hazır."));
    expect(block).toContain("STORE_UNAVAILABLE");
    expect(block).toContain("Sunucu başlatılmadı");
    expect(block).toContain("exit 1");
    expect(start).toContain("--publish-library");
    expect(start).toContain("collex_health_ok");
    expect(env).toContain('COLLEX_HEALTH_URL="http://127.0.0.1:${COLLEX_APP_PORT}/v1/health"');
    for (const text of [start, stop, backupSh, restoreSh, env]) {
      expect(text).not.toMatch(/drop\s+database|dropdb/iu);
    }
  });

  it("stops by command line (the same four ColleX names), never by port", () => {
    const cmdPattern = /set "COLLEX_CMDLINE=([^"]+)"/u.exec(stopperCmd)?.[1] ?? "";
    expect(cmdPattern).toBe("serve\\.mjs|serve-mcp\\.mjs|uvicorn asgi_app|local_embedding_server.*--collex-managed");
    expect(env).toContain("*control-plane/scripts/serve.mjs*|*control-plane/scripts/serve-mcp.mjs*");
    expect(env).toContain('*"uvicorn asgi_app"*');
    expect(env).toContain("*local_embedding_server*--collex-managed*");
    expect(env).toContain('ps -o command= -p "$pid"');
    expect(stop).toContain("collex.stop");
    expect(stop).toContain("kill -TERM");
    expect(stop.indexOf("collex.stop")).toBeLessThan(stop.indexOf("kill -TERM"));
    expect(stop).not.toMatch(/\bkillall\b|\bpkill\b|\blsof\b|\bnetstat\b/u);
    expect(stop).toContain("--keep-db");
  });

  it("the restore wrapper verifies, then asks, then restores — and never deletes", () => {
    const verifyAt = restoreSh.indexOf("--verify");
    const askAt = restoreSh.indexOf("read -r ONAY");
    const restoreAt = restoreSh.indexOf('"$COLLEX_BACKUP_MJS" --restore');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(askAt);
    expect(askAt).toBeLessThan(restoreAt);
    expect(restoreSh.slice(restoreAt)).toContain("--yes");
    // Non-interactive runs never restore silently.
    expect(restoreSh).toContain("if [ ! -t 0 ]; then");
    for (const text of [backupSh, restoreSh]) expect(text).not.toMatch(/(?:^|\s)rm\s/mu);
  });

  it("the shell lookup of PostgreSQL tools is the same list as runner.ts", () => {
    const list = /COLLEX_MACOS_PG_CANDIDATES="([^"]+)"/u.exec(env)?.[1] ?? "";
    expect(list.split(/\s+/u)).toEqual([...MACOS_PG_BIN_CANDIDATES]);
  });

  it("launchd templates: foreground app, daily backup, loopback-only model server and database", () => {
    const app = read("deploy/macos/launchd/com.collex.app.plist");
    expect(app).toContain("<string>__COLLEX_HOME__/deploy/macos/collex-start.sh</string>");
    expect(app).toMatch(/<key>COLLEX_FOREGROUND<\/key>\s*<string>1<\/string>/u);
    for (const name of ["COLLEX_DATA_DIR", "COLLEX_PGBIN", "COLLEX_DB_URL", "PATH"]) {
      expect(app).toContain(`<key>${name}</key>`);
    }
    expect(app).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/u);
    const backupPlist = read("deploy/macos/launchd/com.collex.backup.plist");
    expect(backupPlist).toContain("<string>__COLLEX_HOME__/deploy/macos/collex-backup.sh</string>");
    expect(backupPlist).toContain("<key>StartCalendarInterval</key>");
    const llm = read("deploy/macos/launchd/com.collex.llm.plist");
    expect(llm).toMatch(/<string>--host<\/string>\s*<string>127\.0\.0\.1<\/string>/u);
    expect(llm).toContain("<string>__MODEL_PATH__</string>");
    const pg = read("deploy/macos/launchd/com.collex.postgres.plist");
    expect(pg).toContain("<string>listen_addresses=127.0.0.1</string>");
  });
});

describe("acceptance M: serve.mjs and backup.mjs need nothing Windows-only on darwin", () => {
  const serve = read("control-plane/scripts/serve.mjs");
  const backupMjs = read("control-plane/scripts/backup.mjs");

  it("serve.mjs: a POSIX venv interpreter, SIGTERM shutdown, loopback bind", () => {
    expect(serve).toContain('path.join(REPO_ROOT, ".venv", "bin", "python")');
    expect(serve).toContain('process.on("SIGTERM", shutdown)');
    expect(serve).toContain('hostname: "127.0.0.1"');
  });

  it("backup.mjs: no win32 branch, a HOME default, the portable PostgreSQL lookup", () => {
    expect(backupMjs).not.toMatch(/win32/u);
    expect(backupMjs).toContain('process.env["HOME"]');
    expect(backupMjs).toContain("backup.resolvePgBin(");
  });

  it("the darwin PostgreSQL lookup lands on a Homebrew folder with no Windows location involved", () => {
    const brew = "/opt/homebrew/opt/postgresql@18/bin";
    const probed: string[] = [];
    const resolution = resolvePgBin({
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      exists: (file) => {
        probed.push(file);
        return file === `${brew}/pg_dump`;
      },
    });
    expect(resolution).toEqual({ dir: brew, source: "inferred", inferred: true });
    for (const file of probed) expect(file).not.toMatch(/\\|^[A-Za-z]:|\.exe$/u);
  });

  it("backup.mjs --verify / --dump-name run with the Windows profile variables removed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "collex-prodhost-"));
    try {
      const uploads = path.join(root, "uploads");
      await mkdir(uploads, { recursive: true });
      await writeFile(path.join(uploads, "a.pdf"), "asıl", "utf8");
      const fake: PgToolRunner = async ({ tool, args }) => {
        if (path.basename(tool).startsWith("pg_dump")) {
          await writeFile(args[args.indexOf("-f") + 1] as string, "PGDMP", "utf8");
        }
        return { code: 0, stdout: "", stderr: "" };
      };
      const backup = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: root, run: fake });

      const env: NodeJS.ProcessEnv = { ...process.env, HOME: root };
      for (const name of ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COLLEX_BACKUP_DIR"]) {
        delete env[name];
      }
      const script = path.join(REPO_ROOT, "control-plane", "scripts", "backup.mjs");
      const runCli = (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
        new Promise((resolvePromise) => {
          execFile(process.execPath, [script, ...args], { env, windowsHide: true, timeout: 120_000 }, (error, stdout, stderr) => {
            const code =
              error === null
                ? 0
                : typeof (error as { code?: unknown }).code === "number"
                  ? (error as unknown as { code: number }).code
                  : 1;
            resolvePromise({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
          });
        });

      const verified = await runCli(["--verify", backup.path]);
      expect(verified.code, verified.stderr).toBe(0);
      expect(verified.stdout).toContain("Yedek doğrulandı");
      const named = await runCli(["--dump-name", backup.path]);
      expect(named.code, named.stderr).toBe(0);
      // Exactly the bare name on stdout: a wrapper reads this line verbatim.
      expect(named.stdout).toBe("collex_local.dump\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 150_000);
});
