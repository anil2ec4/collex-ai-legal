/**
 * W14 B-03 — backup and restore.
 *
 * Two layers:
 *
 *  1. PURE (always runs): the manifest, the hashing, the "incomplete folder
 *     is not a backup" rule, and verification catching a truncated or
 *     substituted file. `pg_dump` is injected as a fake, so no process is
 *     spawned and nothing touches a database.
 *  2. REAL DISASTER DRILL (needs the scratch PostgreSQL, skips cleanly
 *     otherwise): create data in a scratch database, back it up, DESTROY the
 *     scratch database, restore it, and prove the rows came back byte-equal.
 *     The destructive half NEVER points at `collex_local` — this suite owns
 *     exactly `collex_safe_test` and refuses any other name.
 *
 * The drill is the point of the item. A backup nobody has ever restored is a
 * folder, not a backup.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_CLIENT_DATA_WARNING_TR,
  BACKUP_DUMP_FILE_LEGACY,
  BACKUP_MANIFEST_FILE,
  BACKUP_MANIFEST_SCHEMA,
  BACKUP_STALE_AFTER_DAYS,
  BACKUP_UPLOADS_DIR,
  backupDumpFileName,
  backupStamp,
  listFilesRecursive,
  readLastBackup,
  runBackup,
  sha256File,
  verifyBackup,
  type PgToolRunner,
} from "../../src/backup/runner.js";

// ---------------------------------------------------------------------------
// Pure layer
// ---------------------------------------------------------------------------

/** A fake pg_dump that writes deterministic bytes, and a fake pg_restore -l. */
function fakePg(dumpBody = "PGDMP fake archive"): { run: PgToolRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: PgToolRunner = async ({ tool, args }) => {
    calls.push([path.basename(tool), ...args]);
    if (path.basename(tool).startsWith("pg_dump")) {
      const at = args.indexOf("-f");
      await writeFile(args[at + 1] as string, dumpBody, "utf8");
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "; Archive created at 2026-09-02\n", stderr: "" };
  };
  return { run, calls };
}

async function scratchDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "collex-backup-"));
}

describe("B-03 backup manifest", () => {
  it("captures the database, the originals AND a hash manifest", async () => {
    const root = await scratchDir();
    try {
      const uploads = path.join(root, "uploads-src");
      await mkdir(path.join(uploads, "alt"), { recursive: true });
      await writeFile(path.join(uploads, "a.txt"), "birinci belge", "utf8");
      await writeFile(path.join(uploads, "alt", "b.pdf"), "ikinci belge", "utf8");

      const { run, calls } = fakePg();
      const result = await runBackup({
        database: "collex_local",
        uploadsDir: uploads,
        backupRoot: path.join(root, "yedek"),
        run,
        now: () => new Date("2026-09-02T14:30:00Z"),
      });

      // All three pieces are there. Restoring any two is not a restore.
      expect(existsSync(path.join(result.path, result.dumpFile))).toBe(true);
      expect(existsSync(path.join(result.path, BACKUP_UPLOADS_DIR, "a.txt"))).toBe(true);
      expect(existsSync(path.join(result.path, BACKUP_UPLOADS_DIR, "alt", "b.pdf"))).toBe(true);
      expect(existsSync(path.join(result.path, BACKUP_MANIFEST_FILE))).toBe(true);

      const manifest = JSON.parse(await readFile(path.join(result.path, BACKUP_MANIFEST_FILE), "utf8"));
      expect(manifest.schema).toBe(BACKUP_MANIFEST_SCHEMA);
      expect(manifest.database).toBe("collex_local");
      expect(manifest.files.map((f: { path: string }) => f.path)).toEqual([
        "uploads/a.txt",
        "uploads/alt/b.pdf",
      ]);
      // Every entry carries a real SHA-256 of what is actually on disk.
      for (const entry of [manifest.dump, ...manifest.files]) {
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(entry.sha256).toBe(await sha256File(path.join(result.path, ...entry.path.split("/"))));
      }

      expect(result.files).toBe(2);
      expect(result.sizeBytes).toBe(manifest.totalBytes);
      // The lawyer is told, in the response itself, what the folder holds.
      expect(result.warning).toBe(BACKUP_CLIENT_DATA_WARNING_TR);
      expect(result.warning).toContain("müvekkil verisi");

      // pg_dump ran read-only, with an ARGUMENT ARRAY, custom format.
      const dump = calls.find((c) => c[0].startsWith("pg_dump"));
      expect(dump).toContain("-Fc");
      expect(dump).toContain("collex_local");
      expect(dump?.join(" ")).not.toMatch(/drop|delete|truncate/iu);
      // …and the archive was proved READABLE, not merely present.
      expect(calls.some((c) => c[0].startsWith("pg_restore") && c.includes("-l"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("V-14: the archive is named after the DATABASE, and the manifest agrees", async () => {
    const root = await scratchDir();
    try {
      const uploads = path.join(root, "uploads-src");
      await mkdir(uploads, { recursive: true });
      const { run, calls } = fakePg();
      const result = await runBackup({
        database: "collex_srv_test",
        uploadsDir: uploads,
        backupRoot: path.join(root, "yedek"),
        run,
      });

      // The defect: EVERY backup was written as `collex_local.dump`, whatever
      // database it held, while `yedek.json` recorded the real name. Two
      // installations' backups in one folder were then two identically named
      // files with different contents, and the restore script's existence
      // check passed BY ACCIDENT.
      expect(result.dumpFile).toBe("collex_srv_test.dump");
      expect(result.dumpFile).not.toBe(BACKUP_DUMP_FILE_LEGACY);
      expect(existsSync(path.join(result.path, "collex_srv_test.dump"))).toBe(true);
      expect(existsSync(path.join(result.path, BACKUP_DUMP_FILE_LEGACY))).toBe(false);

      // pg_dump was told to write THAT file, so the name is not a rename.
      const dump = calls.find((c) => c[0].startsWith("pg_dump")) as string[];
      expect(dump[dump.indexOf("-f") + 1]).toBe(path.join(result.path, "collex_srv_test.dump"));

      // The manifest is the single source the restore reads the name from.
      const manifest = JSON.parse(
        await readFile(path.join(result.path, BACKUP_MANIFEST_FILE), "utf8"),
      );
      expect(manifest.database).toBe("collex_srv_test");
      expect(manifest.dump.path).toBe("collex_srv_test.dump");
      const report = await verifyBackup(result.path);
      expect(report.ok).toBe(true);
      expect(report.dumpFile).toBe("collex_srv_test.dump");

      // The product store still gets exactly the name it always had.
      const product = await runBackup({
        database: "collex_local",
        uploadsDir: uploads,
        backupRoot: path.join(root, "yedek2"),
        run,
      });
      expect(product.dumpFile).toBe(BACKUP_DUMP_FILE_LEGACY);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("V-14: a database name can never become a path — the file name is derived", () => {
    // The value becomes a FILE NAME; a quoted PostgreSQL identifier may hold
    // anything at all.
    expect(backupDumpFileName("collex_local")).toBe("collex_local.dump");
    expect(backupDumpFileName("../../etc/passwd")).toBe("__.._etc_passwd.dump");
    expect(backupDumpFileName("a\b/c")).toBe("a__c.dump");
    expect(backupDumpFileName("....")).toBe("_.dump");
    expect(backupDumpFileName("")).toBe("veritabani.dump");
    for (const name of ["collex_local", "../../etc/passwd", "a\b/c", "....", "", "dosya adı"]) {
      const file = backupDumpFileName(name);
      expect(file).not.toMatch(/[\/]/u);
      expect(file.startsWith(".")).toBe(false);
      expect(path.basename(file)).toBe(file);
    }
  });

  it("a dump failure aborts with a typed Turkish error and no manifest", async () => {
    const root = await scratchDir();
    try {
      const failing: PgToolRunner = async () => ({
        code: 1,
        stdout: "",
        stderr: 'FATAL: database "collex_local" does not exist',
      });
      await expect(
        runBackup({
          database: "collex_local",
          uploadsDir: path.join(root, "yok"),
          backupRoot: path.join(root, "yedek"),
          run: failing,
        }),
      ).rejects.toMatchObject({ kind: "DUMP_FAILED" });
      // An aborted backup leaves no manifest, so readLastBackup ignores it —
      // reporting a half-written folder as "your last backup" is the worst
      // lie this module could tell.
      expect(await readLastBackup(path.join(root, "yedek"))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("B-03 verification happens BEFORE anything is written", () => {
  async function makeBackup(root: string) {
    const uploads = path.join(root, "uploads-src");
    await mkdir(uploads, { recursive: true });
    await writeFile(path.join(uploads, "dilekce.pdf"), "asıl belge içeriği", "utf8");
    const { run } = fakePg();
    return await runBackup({
      database: "collex_local",
      uploadsDir: uploads,
      backupRoot: path.join(root, "yedek"),
      run,
    });
  }

  it("a complete backup verifies", async () => {
    const root = await scratchDir();
    try {
      const result = await makeBackup(root);
      const report = await verifyBackup(result.path);
      expect(report.ok).toBe(true);
      expect(report.checked).toBe(2);
      expect(report.missing).toEqual([]);
      expect(report.corrupt).toEqual([]);
      expect(report.message).toContain("Yedek doğrulandı");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a TRUNCATED original is caught by name", async () => {
    const root = await scratchDir();
    try {
      const result = await makeBackup(root);
      await writeFile(path.join(result.path, BACKUP_UPLOADS_DIR, "dilekce.pdf"), "asıl", "utf8");
      const report = await verifyBackup(result.path);
      expect(report.ok).toBe(false);
      expect(report.corrupt).toEqual(["uploads/dilekce.pdf"]);
      expect(report.message).toContain("BOZUK");
      expect(report.message).toContain("geri yükleme yapmayın");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a SUBSTITUTED file of the same length is caught (size alone is not enough)", async () => {
    const root = await scratchDir();
    try {
      const result = await makeBackup(root);
      const target = path.join(result.path, BACKUP_UPLOADS_DIR, "dilekce.pdf");
      const size = (await stat(target)).size;
      await writeFile(target, "X".repeat(size), "utf8");
      expect((await stat(target)).size).toBe(size);
      const report = await verifyBackup(target.includes("x") ? result.path : result.path);
      expect(report.ok).toBe(false);
      expect(report.corrupt).toEqual(["uploads/dilekce.pdf"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a MISSING file is caught by name, and a foreign folder is refused", async () => {
    const root = await scratchDir();
    try {
      const result = await makeBackup(root);
      await rm(path.join(result.path, result.dumpFile), { force: true });
      const report = await verifyBackup(result.path);
      expect(report.ok).toBe(false);
      expect(report.missing).toEqual([result.dumpFile]);

      const foreign = path.join(root, "rastgele");
      await mkdir(foreign, { recursive: true });
      await expect(verifyBackup(foreign)).rejects.toMatchObject({ kind: "VERIFY_FAILED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("B-03 last-backup reporting", () => {
  it("reports the NEWEST complete backup and flags a stale one", async () => {
    const root = await scratchDir();
    try {
      const uploads = path.join(root, "uploads-src");
      await mkdir(uploads, { recursive: true });
      await writeFile(path.join(uploads, "a.txt"), "belge", "utf8");
      const { run } = fakePg();
      const backupRoot = path.join(root, "yedek");
      const older = await runBackup({
        database: "collex_local", uploadsDir: uploads, backupRoot, run,
        now: () => new Date("2026-08-01T09:00:00Z"),
      });
      const newer = await runBackup({
        database: "collex_local", uploadsDir: uploads, backupRoot, run,
        now: () => new Date("2026-09-02T09:00:00Z"),
      });
      expect(newer.path).not.toBe(older.path);

      const summary = await readLastBackup(backupRoot, () => new Date("2026-09-03T09:00:00Z"));
      expect(summary?.path).toBe(newer.path);
      expect(summary?.lastAt).toBe("2026-09-02T09:00:00.000Z");
      expect(summary?.files).toBe(1);
      expect(summary?.stale).toBe(false);

      // Older than the stale threshold -> the console turns the row orange.
      const later = new Date(Date.parse("2026-09-02T09:00:00Z") + (BACKUP_STALE_AFTER_DAYS + 1) * 86_400_000);
      expect((await readLastBackup(backupRoot, () => later))?.stale).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never reports anything when no backup has ever been taken", async () => {
    expect(await readLastBackup(path.join(tmpdir(), "collex-yok-" + Date.now()))).toBeNull();
  });

  it("backupStamp sorts chronologically and listFilesRecursive is stable", async () => {
    expect(backupStamp(new Date("2026-09-02T14:30:05Z")).length).toBe(15);
    expect(backupStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
    expect(backupStamp(new Date(2026, 0, 2, 3, 4, 5)) < backupStamp(new Date(2026, 0, 2, 3, 4, 6))).toBe(true);
    expect(await listFilesRecursive(path.join(tmpdir(), "collex-yok-" + Date.now()))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real disaster drill (collex_safe_test)
// ---------------------------------------------------------------------------

const HOST_PORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
const ADMIN_URL = `postgres://postgres@${HOST_PORT}/postgres`;
/** THIS SUITE OWNS EXACTLY THIS NAME and creates/drops no other. */
const DRILL_DB = "collex_safe_test";
const DRILL_URL = `postgres://postgres@${HOST_PORT}/${DRILL_DB}`;

const PG_BIN = process.env["COLLEX_PGBIN"] ?? "";
const pgTool = (name: string): string => (PG_BIN === "" ? name : path.join(PG_BIN, name));

function runTool(tool: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(tool, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, _out, stderr) => {
      resolvePromise({ code: error === null ? 0 : 1, stderr: String(stderr ?? "") });
    });
  });
}

let drillAvailable = false;
let drillReason = "";
try {
  const admin = postgres(ADMIN_URL, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await admin`select 1`;
    const probe = await runTool(pgTool("pg_dump"), ["--version"]);
    drillAvailable = probe.code === 0;
    if (!drillAvailable) drillReason = "pg_dump is not on PATH";
  } finally {
    await admin.end({ timeout: 5 });
  }
} catch (error) {
  drillReason = error instanceof Error ? error.message : String(error);
}

describe.skipIf(!drillAvailable)("B-03 disaster drill (collex_safe_test)", () => {
  let admin: postgres.Sql;
  let workdir = "";

  const resetDrillDb = async (): Promise<void> => {
    // Guard rail: this suite is hard-limited to ONE database name. A typo
    // here must never be able to destroy the product store.
    if (DRILL_DB !== "collex_safe_test") throw new Error("refusing to drop " + DRILL_DB);
    // Separate simple queries: PostgreSQL refuses CREATE DATABASE inside an
    // implicit multi-statement transaction block.
    await admin.unsafe(`drop database if exists ${DRILL_DB} with (force)`);
    await admin.unsafe(`create database ${DRILL_DB} template template0 encoding 'UTF8' locale 'C'`);
    const exists = await admin`select 1 from pg_database where datname = ${DRILL_DB}`;
    if (exists.length !== 1) throw new Error(`${DRILL_DB} was not recreated`);
  };

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
    workdir = await scratchDir();
    await resetDrillDb();
  });

  afterAll(async () => {
    if (admin !== undefined) {
      if (DRILL_DB === "collex_safe_test") {
        await admin.unsafe(`drop database if exists ${DRILL_DB} with (force)`).catch(() => undefined);
      }
      await admin.end({ timeout: 5 });
    }
    if (workdir !== "") await rm(workdir, { recursive: true, force: true });
  });

  it("create data -> back up -> DESTROY the database -> restore -> prove equality", async () => {
    // --- 1. create data + an upload original -----------------------------
    let sql = postgres(DRILL_URL, { max: 1, onnotice: () => undefined });
    await sql.unsafe(`
      create schema drill;
      create table drill.matters (id int primary key, title text not null, sha256 text not null);
      insert into drill.matters values
        (1, 'Kira — Yılmaz / Demir', 'a'),
        (2, 'İş — Kaya / X A.Ş.', 'b');
    `);
    const before = await sql`select id, title, sha256 from drill.matters order by id`;
    await sql.end({ timeout: 5 });

    const uploads = path.join(workdir, "uploads");
    await mkdir(uploads, { recursive: true });
    const originalBytes = "Kira sözleşmesi — asıl belge\n";
    await writeFile(path.join(uploads, "dilekce.pdf"), originalBytes, "utf8");

    // --- 2. back it up with the REAL pg_dump ------------------------------
    const result = await runBackup({
      database: DRILL_DB,
      host: HOST_PORT.split(":")[0] as string,
      port: Number(HOST_PORT.split(":")[1] ?? 55432),
      uploadsDir: uploads,
      backupRoot: path.join(workdir, "yedek"),
      ...(PG_BIN !== "" ? { pgBin: PG_BIN } : {}),
    });
    expect(result.files).toBe(1);
    // V-14: the archive carries the name of the database it actually holds,
    // and the restore below opens the name the MANIFEST gives — not a
    // constant that happened to match.
    expect(result.dumpFile).toBe(`${DRILL_DB}.dump`);
    expect(result.dumpFile).not.toBe(BACKUP_DUMP_FILE_LEGACY);
    expect(existsSync(path.join(result.path, BACKUP_DUMP_FILE_LEGACY))).toBe(false);
    const verified = await verifyBackup(result.path);
    expect(verified.ok).toBe(true);
    expect(verified.database).toBe(DRILL_DB);
    expect(verified.dumpFile).toBe(result.dumpFile);

    // --- 3. DESTROY it (never collex_local) -------------------------------
    await resetDrillDb();
    const empty = postgres(DRILL_URL, { max: 1, onnotice: () => undefined });
    const gone = await empty`select to_regclass('drill.matters') as t`;
    expect(gone[0]?.["t"]).toBeNull();
    await empty.end({ timeout: 5 });

    // --- 4. restore -------------------------------------------------------
    const restore = await runTool(pgTool("pg_restore"), [
      "-h", HOST_PORT.split(":")[0] as string,
      "-p", HOST_PORT.split(":")[1] ?? "55432",
      "-U", "postgres",
      "-d", DRILL_DB,
      "--no-owner", "--no-privileges", "--exit-on-error",
      path.join(result.path, verified.dumpFile),
    ]);
    expect(restore.code, restore.stderr).toBe(0);

    // --- 5. prove equality -------------------------------------------------
    sql = postgres(DRILL_URL, { max: 1, onnotice: () => undefined });
    try {
      const after = await sql`select id, title, sha256 from drill.matters order by id`;
      expect(after.map((r) => ({ ...r }))).toEqual(before.map((r) => ({ ...r })));
      // Turkish characters survive the round trip byte-for-byte.
      expect(after[0]?.["title"]).toBe("Kira — Yılmaz / Demir");
      expect(after[1]?.["title"]).toBe("İş — Kaya / X A.Ş.");
    } finally {
      await sql.end({ timeout: 5 });
    }

    // The originals come back byte-exact too — a database-only "backup"
    // would have restored rows pointing at documents that no longer exist.
    const restoredOriginal = path.join(result.path, BACKUP_UPLOADS_DIR, "dilekce.pdf");
    expect(await readFile(restoredOriginal, "utf8")).toBe(originalBytes);
  }, 120_000);
});

describe.skipIf(drillAvailable)("B-03 disaster drill (environment unavailable)", () => {
  it("skips cleanly: the scratch PostgreSQL or pg_dump is missing", () => {
    expect(drillAvailable).toBe(false);
    expect(drillReason).not.toBe("");
  });
});
