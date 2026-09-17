/**
 * W21 platform lane — the portable restore (`runRestore`,
 * `backup.mjs --restore`) and the PostgreSQL tool lookup it shares with the
 * backup (`resolvePgBin`).
 *
 * Until W21 the only restore was `ColleX-Geri-Yukle.cmd` (robocopy,
 * pg_restore.exe, a locale-dependent `%date%` stamp), so a backup taken on
 * the production Mac could not be restored there. Two layers, like
 * tests/integration/backup.test.ts:
 *
 *  1. PURE (always runs): the PostgreSQL tools are a fake runner, so every
 *     refusal and the exact ORDER of the destructive steps is pinned without
 *     a database — verify before anything, confirmation before any tool,
 *     safety dump before the rename, rename (never drop) before the restore.
 *  2. REAL (scratch PostgreSQL + real pg_dump / pg_restore / psql; skips
 *     cleanly otherwise): back up -> change the data -> run the CLI
 *     `node backup.mjs --restore` -> prove the rows and originals came back,
 *     the old database was kept aside, the safety dump exists and nothing
 *     unrelated was deleted. This file owns exactly
 *     `collex_w21_platform_test` (plus the `_eski_*` names the restore
 *     derives from it) and refuses any other name.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_MANIFEST_FILE,
  MACOS_PG_BIN_CANDIDATES,
  RESTORE_NOT_CONFIRMED_MESSAGE_TR,
  STORED_ORIGINALS_SQL,
  resolvePgBin,
  runBackup,
  runRestore,
  sha256File,
  type PgToolRunner,
  type RestoreOptions,
} from "../../src/backup/runner.js";
import { ADMIN_URL, HOST_PORT, scratchDatabase } from "../store/testDb.js";

// ---------------------------------------------------------------------------
// Pure layer
// ---------------------------------------------------------------------------

type Step = "version" | "exists" | "safety" | "rename" | "create" | "restore";

interface ToolCall {
  tool: string;
  args: string[];
}

/** A fake pg_dump / pg_restore / psql that records every call. */
function fakePg(options: { targetExists?: boolean; fail?: Step[] } = {}): {
  run: PgToolRunner;
  calls: ToolCall[];
} {
  const calls: ToolCall[] = [];
  const failing = new Set(options.fail ?? []);
  const ok = { code: 0, stdout: "", stderr: "" };
  const run: PgToolRunner = async ({ tool, args }) => {
    const name = path.basename(tool).replace(/\.exe$/u, "");
    calls.push({ tool: name, args });
    if (args[0] === "--version") {
      return failing.has("version")
        ? { code: 1, stdout: "", stderr: "bulunamadı" }
        : { code: 0, stdout: `${name} (PostgreSQL) 18.1`, stderr: "" };
    }
    if (name === "pg_dump") {
      if (failing.has("safety")) return { code: 1, stdout: "", stderr: "pg_dump: error: connection failed" };
      await writeFile(args[args.indexOf("-f") + 1] as string, "PGDMP güvenlik yedeği", "utf8");
      return ok;
    }
    if (name === "pg_restore") {
      return failing.has("restore")
        ? { code: 1, stdout: "", stderr: "pg_restore: error: could not execute query" }
        : ok;
    }
    const statement = args[args.indexOf("-c") + 1] ?? "";
    if (statement.startsWith("select 1 from pg_database")) {
      if (failing.has("exists")) return { code: 2, stdout: "", stderr: "connection refused" };
      return { code: 0, stdout: options.targetExists === false ? "" : "1\n", stderr: "" };
    }
    if (statement.startsWith("alter database")) {
      return failing.has("rename")
        ? { code: 1, stdout: "", stderr: 'ERROR: database "x" is being accessed by other users' }
        : ok;
    }
    if (statement.startsWith("create database")) {
      return failing.has("create") ? { code: 1, stdout: "", stderr: "ERROR: permission denied" } : ok;
    }
    if (statement.startsWith("select count(*)")) return { code: 0, stdout: "7\n", stderr: "" };
    return ok;
  };
  return { run, calls };
}

/** Human label for one recorded call, so the ORDER can be compared. */
function label(call: ToolCall): string {
  if (call.args[0] === "--version") return `${call.tool} --version`;
  if (call.tool === "psql") {
    const statement = call.args[call.args.indexOf("-c") + 1] ?? "";
    return `psql ${statement.split(" ").slice(0, 2).join(" ")}`;
  }
  if (call.tool === "pg_dump") return "pg_dump -Fc";
  return call.tool;
}

async function scratchDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "collex-restore-"));
}

/** A real, verifiable backup folder made with a fake pg_dump. */
async function makeBackup(root: string, originals: Record<string, string>): Promise<string> {
  const uploads = path.join(root, "kaynak-uploads");
  await mkdir(uploads, { recursive: true });
  for (const [rel, body] of Object.entries(originals)) {
    const file = path.join(uploads, ...rel.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
  }
  const run: PgToolRunner = async ({ tool, args }) => {
    if (path.basename(tool).startsWith("pg_dump")) {
      await writeFile(args[args.indexOf("-f") + 1] as string, "PGDMP arşiv", "utf8");
    }
    return { code: 0, stdout: "; arşiv içeriği", stderr: "" };
  };
  const result = await runBackup({
    database: "collex_local",
    uploadsDir: uploads,
    backupRoot: path.join(root, "yedek"),
    run,
    now: () => new Date("2026-09-02T14:30:00Z"),
  });
  return result.path;
}

/** Local-time instant, so the derived stamp is the same in every time zone. */
const NOW = (): Date => new Date(2026, 8, 11, 17, 45, 30);
const STAMP = "20260911_174530";
const TARGET = "collex_w21_fake";

function options(root: string, source: string, run: PgToolRunner, extra: Partial<RestoreOptions> = {}): RestoreOptions {
  return {
    source,
    database: TARGET,
    uploadsDir: path.join(root, "veri", "uploads"),
    safetyDir: path.join(root, "guvenlik"),
    // W21 #24: these scratch roots have no uploads folder yet; creating one is now an explicit choice.
    createUploadsDir: true,
    confirmed: true,
    run,
    now: NOW,
    ...extra,
  };
}

describe("W21 restore refuses before it touches anything", () => {
  it("a corrupt backup starts no tool and creates nothing", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      await writeFile(path.join(source, "collex_local.dump"), "PG", "utf8");
      const { run, calls } = fakePg();
      await expect(runRestore(options(root, source, run))).rejects.toMatchObject({ kind: "VERIFY_FAILED" });
      expect(calls).toHaveLength(0);
      expect(existsSync(path.join(root, "guvenlik"))).toBe(false);
      expect(existsSync(path.join(root, "veri"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("without explicit confirmation it verifies, then refuses and starts no tool", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      const { run, calls } = fakePg();
      const refused = runRestore(options(root, source, run, { confirmed: false }));
      await expect(refused).rejects.toMatchObject({
        kind: "RESTORE_NOT_CONFIRMED",
        message: RESTORE_NOT_CONFIRMED_MESSAGE_TR,
      });
      expect(RESTORE_NOT_CONFIRMED_MESSAGE_TR).toContain("--yes");
      expect(calls).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a target that is not a plain lower-case identifier is refused", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      for (const database of ["Collex", "collex-x", 'x"; drop database collex_local; --', "", "1abc", "a".repeat(41)]) {
        const { run, calls } = fakePg();
        await expect(runRestore(options(root, source, run, { database }))).rejects.toMatchObject({
          kind: "RESTORE_REFUSED",
        });
        expect(calls).toHaveLength(0);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a missing PostgreSQL tool is PG_TOOLS_MISSING before any database call", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      const { run, calls } = fakePg({ fail: ["version"] });
      await expect(runRestore(options(root, source, run))).rejects.toMatchObject({ kind: "PG_TOOLS_MISSING" });
      expect(calls.map(label)).toEqual(["pg_restore --version"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("W21 restore: the destructive steps, in order", () => {
  it("probe -> safety dump -> rename aside -> create -> pg_restore; never a drop", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A", "alt/b.pdf": "asıl B" });
      const { run, calls } = fakePg();
      const result = await runRestore(options(root, source, run));

      expect(calls.map(label)).toEqual([
        "pg_restore --version",
        "pg_dump --version",
        "psql --version",
        "psql select 1",
        "pg_dump -Fc",
        "psql alter database",
        "psql create database",
        "pg_restore",
        "psql select count(*)",
        // W21 #24: the RESTORED database is then asked which originals it names.
        "psql select distinct",
      ]);
      const asked = calls.find((call) => call.args.includes(STORED_ORIGINALS_SQL));
      expect(asked?.args).toEqual(expect.arrayContaining(["-d", TARGET, "-w"]));
      expect(result.originals).toEqual({ inDatabase: 0, notFound: 0 });
      expect(result.originalsState).toBe("COMPLETE");
      // Rename, never drop — in any argument of any call.
      for (const call of calls) expect(call.args.join(" ")).not.toMatch(/\bdrop\b/iu);

      const work = calls.filter((call) => call.args[0] !== "--version");
      for (const call of work) {
        expect(call.args).toEqual(expect.arrayContaining(["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "-w"]));
      }
      for (const call of work.filter((c) => c.tool === "psql")) {
        expect(call.args).toContain("ON_ERROR_STOP=1");
      }

      const statements = work.filter((c) => c.tool === "psql").map((c) => c.args[c.args.indexOf("-c") + 1]);
      expect(statements).toContain(`alter database "${TARGET}" rename to "${TARGET}_eski_${STAMP}"`);
      expect(statements).toContain(`create database "${TARGET}" template template0 encoding 'UTF8' locale 'C'`);

      const restore = work.find((c) => c.tool === "pg_restore");
      expect(restore?.args).toEqual(expect.arrayContaining(["--no-owner", "--no-privileges", "--exit-on-error"]));
      // V-14: the archive the MANIFEST names, not a constant.
      expect(restore?.args.at(-1)).toBe(path.join(source, "collex_local.dump"));

      expect(result.asideDatabase).toBe(`${TARGET}_eski_${STAMP}`);
      expect(result.safetyDump).toBe(path.join(root, "guvenlik", `${TARGET}_geri_yukleme_oncesi_${STAMP}.dump`));
      expect(existsSync(result.safetyDump as string)).toBe(true);
      expect(result.dumpFile).toBe("collex_local.dump");
      expect(result.tables).toBe(7);
      expect(result.uploads).toMatchObject({ copied: 2, alreadyPresent: 0, setAside: [], missing: [], corrupt: [] });
      expect(result.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a failed safety dump stops the restore before the rename", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      const { run, calls } = fakePg({ fail: ["safety"] });
      await expect(runRestore(options(root, source, run))).rejects.toMatchObject({ kind: "DUMP_FAILED" });
      expect(calls.map(label)).not.toContain("psql alter database");
      expect(calls.map(label)).not.toContain("psql create database");
      expect(calls.map(label)).not.toContain("pg_restore");
      expect(existsSync(path.join(root, "veri"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("with no existing target there is nothing to save or rename", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      const { run, calls } = fakePg({ targetExists: false });
      const result = await runRestore(options(root, source, run));
      expect(calls.map(label)).not.toContain("pg_dump -Fc");
      expect(calls.map(label)).not.toContain("psql alter database");
      expect(calls.map(label)).toContain("psql create database");
      expect(result.asideDatabase).toBeNull();
      expect(result.safetyDump).toBeNull();
      expect(result.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a rename refused by an open connection keeps everything and names the safety dump", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      const { run, calls } = fakePg({ fail: ["rename"] });
      const failure = await runRestore(options(root, source, run)).catch((error: unknown) => error);
      expect(failure).toMatchObject({ kind: "RESTORE_FAILED" });
      const message = (failure as Error).message;
      expect(message).toContain("Hiçbir veri silinmedi");
      expect(message).toContain(`${TARGET}_geri_yukleme_oncesi_${STAMP}.dump`);
      expect(calls.map(label)).not.toContain("psql create database");
      expect(calls.map(label)).not.toContain("pg_restore");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a failed pg_restore names the database kept aside and drops nothing", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      const { run, calls } = fakePg({ fail: ["restore"] });
      const failure = await runRestore(options(root, source, run)).catch((error: unknown) => error);
      expect(failure).toMatchObject({ kind: "RESTORE_FAILED" });
      expect((failure as Error).message).toContain(`${TARGET}_eski_${STAMP}`);
      expect((failure as Error).message).toContain("veri kaybı yok");
      for (const call of calls) expect(call.args.join(" ")).not.toMatch(/\bdrop\b/iu);
      // The originals are not merged over a database that did not come back.
      expect(existsSync(path.join(root, "veri", "uploads"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("W21 restore: originals merge, never delete, and are re-verified", () => {
  it("same bytes stay, different bytes are set aside, unrelated files are untouched", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A", "alt/b.pdf": "asıl B" });
      const uploads = path.join(root, "veri", "uploads");
      await mkdir(path.join(uploads, "alt"), { recursive: true });
      await writeFile(path.join(uploads, "a.pdf"), "asıl A", "utf8");
      await writeFile(path.join(uploads, "alt", "b.pdf"), "DEĞİŞMİŞ", "utf8");
      await writeFile(path.join(uploads, "c.pdf"), "yalnız yerelde", "utf8");

      const { run } = fakePg();
      const result = await runRestore(options(root, source, run));

      expect(result.uploads).toMatchObject({ copied: 1, alreadyPresent: 1, setAside: ["alt/b.pdf"], missing: [], corrupt: [] });
      expect(result.ok).toBe(true);
      expect(await readFile(path.join(uploads, "alt", "b.pdf"), "utf8")).toBe("asıl B");
      // The different local file is kept under another name — not deleted.
      expect(await readFile(path.join(uploads, "alt", `b.pdf.eski-${STAMP}`), "utf8")).toBe("DEĞİŞMİŞ");
      expect(await readFile(path.join(uploads, "c.pdf"), "utf8")).toBe("yalnız yerelde");
      expect(await readFile(path.join(uploads, "a.pdf"), "utf8")).toBe("asıl A");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a manifest entry that would leave the uploads folder is refused and reported", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A" });
      // A hand-edited manifest whose entry verifies (the file exists and
      // hashes right) but points outside uploads/.
      await writeFile(path.join(source, "disari.txt"), "dışarı", "utf8");
      const manifestFile = path.join(source, BACKUP_MANIFEST_FILE);
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      const info = await stat(path.join(source, "disari.txt"));
      manifest.files.push({
        path: "uploads/../disari.txt",
        sizeBytes: info.size,
        sha256: await sha256File(path.join(source, "disari.txt")),
      });
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");

      const { run } = fakePg();
      const result = await runRestore(options(root, source, run));
      expect(result.ok).toBe(false);
      expect(result.uploads.corrupt).toContain("uploads/../disari.txt");
      expect(result.message).toContain("doğrulanamadı");
      expect(existsSync(path.join(root, "veri", "disari.txt"))).toBe(false);
      expect(await readFile(path.join(root, "veri", "uploads", "a.pdf"), "utf8")).toBe("asıl A");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a filesystem error while merging (a file where a folder must be) is reported, never thrown", async () => {
    const root = await scratchDir();
    try {
      const source = await makeBackup(root, { "a.pdf": "asıl A", "alt/b.pdf": "asıl B" });
      const uploads = path.join(root, "veri", "uploads");
      await mkdir(uploads, { recursive: true });
      // "alt" is a FILE here, so the folder for alt/b.pdf cannot be created.
      await writeFile(path.join(uploads, "alt"), "klasör değil", "utf8");

      const { run } = fakePg();
      const result = await runRestore(options(root, source, run));
      expect(result.ok).toBe(false);
      expect(result.uploads.corrupt).toContain("alt/b.pdf");
      expect(result.uploads.copied).toBe(1);
      expect(result.message).toContain("doğrulanamadı");
      expect(await readFile(path.join(uploads, "a.pdf"), "utf8")).toBe("asıl A");
      // Nothing local was removed to make room.
      expect(await readFile(path.join(uploads, "alt"), "utf8")).toBe("klasör değil");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolvePgBin: COLLEX_PGBIN, then PATH, then macOS guesses", () => {
  it("COLLEX_PGBIN wins over everything", () => {
    expect(
      resolvePgBin({ platform: "darwin", env: { COLLEX_PGBIN: "/opt/pg/bin", PATH: "/usr/bin" }, exists: () => true }),
    ).toEqual({ dir: "/opt/pg/bin", source: "COLLEX_PGBIN", inferred: false });
  });

  it("a tool on PATH runs by bare name", () => {
    const hit = "/opt/pg/bin/pg_dump";
    expect(
      resolvePgBin({ platform: "darwin", env: { PATH: "/usr/bin:/opt/pg/bin" }, exists: (f) => f === hit }),
    ).toEqual({ dir: "", source: "PATH", inferred: false });
  });

  it("on darwin, Homebrew and Postgres.app folders are a GUESS and say so", () => {
    const brew = "/opt/homebrew/opt/postgresql@18/bin";
    expect(
      resolvePgBin({ platform: "darwin", env: { PATH: "/usr/bin:/bin" }, exists: (f) => f === `${brew}/pg_dump` }),
    ).toEqual({ dir: brew, source: "inferred", inferred: true });
    const app = "/Applications/Postgres.app/Contents/Versions/latest/bin";
    expect(
      resolvePgBin({ platform: "darwin", tool: "pg_restore", env: {}, exists: (f) => f === `${app}/pg_restore` }),
    ).toEqual({ dir: app, source: "inferred", inferred: true });
    for (const dir of MACOS_PG_BIN_CANDIDATES) {
      expect(dir.startsWith("/")).toBe(true);
      expect(dir).not.toMatch(/\\|^[A-Za-z]:/u);
    }
  });

  it("linux gets no macOS guess; nothing found is 'unresolved'", () => {
    expect(resolvePgBin({ platform: "linux", env: { PATH: "/usr/bin" }, exists: () => false })).toEqual({
      dir: "",
      source: "unresolved",
      inferred: false,
    });
    expect(
      resolvePgBin({ platform: "linux", env: {}, exists: (f) => f.startsWith("/opt/homebrew/") }).source,
    ).toBe("unresolved");
  });

  it("win32 reads a case-insensitive Path, finds pg_dump.exe and never probes Homebrew", () => {
    const probed: string[] = [];
    const resolution = resolvePgBin({
      platform: "win32",
      env: { Path: "C:\\pg\\bin;C:\\Windows" },
      exists: (f) => {
        probed.push(f);
        return f === "C:\\pg\\bin\\pg_dump.exe";
      },
    });
    expect(resolution).toEqual({ dir: "", source: "PATH", inferred: false });
    const missing = resolvePgBin({ platform: "win32", env: { Path: "C:\\Windows" }, exists: (f) => (probed.push(f), false) });
    expect(missing.source).toBe("unresolved");
    expect(probed.some((f) => f.startsWith("/opt/homebrew"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real restore through the CLI (scratch PostgreSQL + real PostgreSQL tools)
// ---------------------------------------------------------------------------

const SCRATCH = scratchDatabase("collex_w21_platform_test");
const DB = SCRATCH.database;
const ASIDE_PREFIX = `${DB}_eski_`;
const [HOST = "127.0.0.1", PORT_TEXT = "55432"] = HOST_PORT.split(":");
const PORT = Number(PORT_TEXT);
const PG = resolvePgBin({ tool: "pg_restore" });
const pgTool = (name: string): string => (PG.dir === "" ? name : path.join(PG.dir, name));
const BACKUP_MJS = fileURLToPath(new URL("../../scripts/backup.mjs", import.meta.url));

function assertOwned(name: string): void {
  // Guard rail: this file creates, renames and drops ONLY its own names.
  if (name === "collex_local" || !(name === DB || name.startsWith(ASIDE_PREFIX)) || !/^[a-z0-9_]+$/u.test(name)) {
    throw new Error(`refusing to touch database ${name}`);
  }
}

function runFile(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 180_000, ...(env !== undefined ? { env } : {}) },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as unknown as { code: number }).code : 1;
        resolvePromise({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

/**
 * The CLI's environment: the data folder and HOME point into the scratch
 * directory, and the Windows user-profile variables are REMOVED — the
 * restore must not need them (acceptance M; nothing here proves macOS).
 */
function cliEnv(dataDir: string, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, COLLEX_DATA_DIR: dataDir, HOME: home };
  for (const name of ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "COLLEX_BACKUP_DIR"]) {
    delete env[name];
  }
  if (PG.dir !== "") env["COLLEX_PGBIN"] = PG.dir;
  else delete env["COLLEX_PGBIN"];
  return env;
}

let realAvailable = false;
let realReason = "";
try {
  const admin = postgres(ADMIN_URL, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await admin`select 1`;
    const missing: string[] = [];
    for (const name of ["pg_dump", "pg_restore", "psql"]) {
      if ((await runFile(pgTool(name), ["--version"])).code !== 0) missing.push(name);
    }
    realAvailable = missing.length === 0;
    if (!realAvailable) realReason = `PostgreSQL tools not runnable: ${missing.join(", ")}`;
  } finally {
    await admin.end({ timeout: 5 });
  }
} catch (error) {
  realReason = error instanceof Error ? error.message : String(error);
}

describe.skipIf(!realAvailable)("W21 restore, for real (collex_w21_platform_test)", () => {
  let admin: postgres.Sql;
  let workdir = "";

  const dropOwned = async (): Promise<void> => {
    const rows = await admin`select datname from pg_database where starts_with(datname, ${DB})`;
    for (const row of rows) {
      const name = String(row["datname"]);
      if (name !== DB && !name.startsWith(ASIDE_PREFIX)) continue;
      assertOwned(name);
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
    }
  };
  const asideNames = async (): Promise<string[]> =>
    (await admin`select datname from pg_database where starts_with(datname, ${ASIDE_PREFIX}) order by datname`).map(
      (row) => String(row["datname"]),
    );

  beforeAll(async () => {
    assertOwned(DB);
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
    workdir = await scratchDir();
    await dropOwned();
    await admin.unsafe(`create database "${DB}" template template0 encoding 'UTF8' locale 'C'`);
  });

  afterAll(async () => {
    if (admin !== undefined) {
      await dropOwned().catch(() => undefined);
      await admin.end({ timeout: 5 });
    }
    if (workdir !== "") await rm(workdir, { recursive: true, force: true });
  });

  it("backup -> change -> refuse without --yes -> restore -> rows, originals, aside copy and safety dump", async () => {
    // --- 1. data + an upload original ------------------------------------
    // W21 #24: a minimal copy of the two product tables the originals query
    // reads, so the REAL psql answers "which originals does this database
    // name" before the backup and again after the restore.
    const namedBody = "İhtarname — asıl belge (sha adıyla)\n";
    const namedSha = createHash("sha256").update(namedBody, "utf8").digest("hex");
    let sql = postgres(SCRATCH.url, { max: 1, onnotice: () => undefined });
    await sql.unsafe(`
      create schema w21;
      create table w21.matters (id int primary key, title text not null);
      insert into w21.matters values (1, 'Kira — Yılmaz / Demir'), (2, 'İş — Kaya / X A.Ş.');
      create schema legal;
      create table legal.documents (id int primary key, scope text not null, source text not null);
      create table legal.document_versions (document_id int not null, system_period tstzrange not null, metadata jsonb not null);
      insert into legal.documents values (1, 'tenant', 'UPLOAD');
      insert into legal.document_versions values
        (1, tstzrange(now(), null), '{"fixture_meta":{"upload":{"sha256":"${namedSha}"}}}');
    `);
    const before = (await sql`select id, title from w21.matters order by id`).map((r) => ({ ...r }));
    await sql.end({ timeout: 5 });

    const dataDir = path.join(workdir, "veri");
    const uploads = path.join(dataDir, "uploads");
    await mkdir(uploads, { recursive: true });
    const originalBytes = "Kira sözleşmesi — asıl belge\n";
    await writeFile(path.join(uploads, "dilekce.pdf"), originalBytes, "utf8");
    await writeFile(path.join(uploads, `${namedSha}.pdf`), namedBody, "utf8");

    // --- 2. a REAL backup -------------------------------------------------
    const backupResult = await runBackup({
      database: DB,
      host: HOST,
      port: PORT,
      uploadsDir: uploads,
      backupRoot: path.join(workdir, "yedek"),
      ...(PG.dir !== "" ? { pgBin: PG.dir } : {}),
    });
    expect(backupResult.originals).toMatchObject({ uploadsDirFound: true, inDatabase: 1, notFound: 0 });
    expect(backupResult.originalsState).toBe("COMPLETE");

    // --- 3. life goes on after the backup ---------------------------------
    sql = postgres(SCRATCH.url, { max: 1, onnotice: () => undefined });
    await sql`insert into w21.matters values (3, 'Sonradan eklenen dosya')`;
    await sql`update w21.matters set title = 'Değiştirilmiş başlık' where id = 1`;
    await sql.end({ timeout: 5 });
    await writeFile(path.join(uploads, "dilekce.pdf"), "yedekten sonra değişti\n", "utf8");
    await writeFile(path.join(uploads, "sonradan.pdf"), "yalnız yerelde\n", "utf8");

    const cliArgs = [
      BACKUP_MJS,
      "--restore", backupResult.path,
      "--database", DB,
      "--host", HOST,
      "--port", String(PORT),
      "--out", path.join(workdir, "yedek-kok"),
    ];
    const env = cliEnv(dataDir, path.join(workdir, "ev"));

    // --- 4. without --yes: verified, refused, nothing changed -------------
    const refused = await runFile(process.execPath, cliArgs, env);
    expect(refused.code, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stderr).toContain("--yes");
    expect(await asideNames()).toEqual([]);
    sql = postgres(SCRATCH.url, { max: 1, onnotice: () => undefined });
    expect((await sql`select count(*)::int as n from w21.matters`)[0]?.["n"]).toBe(3);
    await sql.end({ timeout: 5 });

    // --- 5. with --yes ----------------------------------------------------
    const done = await runFile(process.execPath, [...cliArgs, "--yes"], env);
    expect(done.code, done.stdout + done.stderr).toBe(0);
    expect(done.stdout).toContain("Geri yükleme tamam");
    // W21 #24: "tamam" only after the restored database was asked and its
    // original was found in the uploads folder.
    expect(done.stdout).toContain("veritabanının andığı belge aslı: 1 (klasörde olmayan: 0)");
    expect(done.stdout).toContain("andığı 1 belge aslının hepsi orada");

    // --- 6. the rows came back byte-for-byte ------------------------------
    sql = postgres(SCRATCH.url, { max: 1, onnotice: () => undefined });
    try {
      const after = (await sql`select id, title from w21.matters order by id`).map((r) => ({ ...r }));
      expect(after).toEqual(before);
      expect(after[1]?.["title"]).toBe("İş — Kaya / X A.Ş.");
    } finally {
      await sql.end({ timeout: 5 });
    }

    // --- 7. the replaced database was KEPT, not dropped -------------------
    const aside = await asideNames();
    expect(aside).toHaveLength(1);
    assertOwned(aside[0] as string);
    expect(aside[0]).toMatch(new RegExp(`^${ASIDE_PREFIX}\\d{8}_\\d{6}$`, "u"));
    const old = postgres(`postgres://postgres@${HOST_PORT}/${aside[0]}`, { max: 1, onnotice: () => undefined });
    try {
      const kept = await old`select id, title from w21.matters order by id`;
      expect(kept).toHaveLength(3);
      expect(kept[0]?.["title"]).toBe("Değiştirilmiş başlık");
    } finally {
      await old.end({ timeout: 5 });
    }

    // --- 8. the safety dump exists and is not empty -----------------------
    const safetyDir = path.join(workdir, "yedek-kok", "geri-yukleme-oncesi");
    const safety = (await readdir(safetyDir)).filter((name) => name.endsWith(".dump"));
    expect(safety).toHaveLength(1);
    expect(safety[0]).toMatch(new RegExp(`^${DB}_geri_yukleme_oncesi_\\d{8}_\\d{6}\\.dump$`, "u"));
    expect((await stat(path.join(safetyDir, safety[0] as string))).size).toBeGreaterThan(0);

    // --- 9. originals: restored, the changed copy kept aside, nothing deleted
    expect(await readFile(path.join(uploads, "dilekce.pdf"), "utf8")).toBe(originalBytes);
    const setAside = (await readdir(uploads)).filter((name) => name.startsWith("dilekce.pdf.eski-"));
    expect(setAside).toHaveLength(1);
    expect(await readFile(path.join(uploads, setAside[0] as string), "utf8")).toBe("yedekten sonra değişti\n");
    expect(await readFile(path.join(uploads, "sonradan.pdf"), "utf8")).toBe("yalnız yerelde\n");
  }, 240_000);
});

describe.skipIf(realAvailable)("W21 restore, for real (environment unavailable)", () => {
  it("ENVIRONMENT BLOCKER: the scratch PostgreSQL or the PostgreSQL tools are missing", () => {
    expect(realAvailable).toBe(false);
    expect(realReason).not.toBe("");
  });
});
