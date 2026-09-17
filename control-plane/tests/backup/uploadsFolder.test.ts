/**
 * W21 platform lane, finding #24 — a backup or restore against the WRONG
 * uploads folder must never read as a good one.
 *
 * The defect: on the Mac, a hand-run backup without COLLEX_DATA_DIR fell back
 * to `<repo>/var/uploads`, which did not exist. `listFilesRecursive` read the
 * missing folder as "no originals", so a complete, verifiable backup with
 * ZERO originals was written, printed as "yedek tamam" and listed as the
 * newest backup; a hand-run restore likewise created that folder, merged the
 * originals into it and reported "tamamı yerinde doğrulandı" while the
 * service served 404 for every original.
 *
 * Fully offline: pg_dump / pg_restore / psql are a fake runner; the "database"
 * answers the originals query with whatever the test says.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BACKUP_MANIFEST_FILE,
  STORED_ORIGINALS_SQL,
  backupHeadlineTr,
  backupOriginalsState,
  backupOriginalsWarningTr,
  listUploadOriginals,
  readLastBackup,
  runBackup,
  runRestore,
  verifyBackup,
  type PgToolRunner,
} from "../../src/backup/runner.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const BACKUP_MJS = fileURLToPath(new URL("../../scripts/backup.mjs", import.meta.url));

interface Call {
  tool: string;
  args: string[];
}

/**
 * Fake PostgreSQL tools. `originals` is what the database names: a list of
 * sha256 values, or "unknown" for a psql that cannot answer.
 */
function fakePg(originals: string[] | "unknown"): { run: PgToolRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: PgToolRunner = async ({ tool, args }) => {
    const name = path.basename(tool).replace(/\.exe$/u, "");
    calls.push({ tool: name, args });
    if (args[0] === "--version") return { code: 0, stdout: `${name} 18.1`, stderr: "" };
    if (name === "pg_dump") {
      await writeFile(args[args.indexOf("-f") + 1] as string, "PGDMP arşiv", "utf8");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (name === "pg_restore") return { code: 0, stdout: "; arşiv içeriği\n", stderr: "" };
    const statement = args[args.indexOf("-c") + 1] ?? "";
    if (statement === STORED_ORIGINALS_SQL) {
      return originals === "unknown"
        ? { code: 2, stdout: "", stderr: 'ERROR: relation "legal.documents" does not exist' }
        : { code: 0, stdout: originals.map((sha) => `${sha}\n`).join(""), stderr: "" };
    }
    if (statement.startsWith("select 1 from pg_database")) return { code: 0, stdout: "1\n", stderr: "" };
    if (statement.startsWith("select count(*)")) return { code: 0, stdout: "3\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

async function scratch(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "collex-w21-uploads-"));
}

async function uploadsWith(root: string, names: string[]): Promise<string> {
  const uploads = path.join(root, "veri", "uploads");
  await mkdir(uploads, { recursive: true });
  for (const name of names) await writeFile(path.join(uploads, name), `asıl ${name}`, "utf8");
  return uploads;
}

describe("W21 #24: the backup refuses a missing or wrong uploads folder", () => {
  it("a missing uploads folder is refused, naming the folder, when the database names originals", async () => {
    const root = await scratch();
    try {
      const missing = path.join(root, "depo", "var", "uploads");
      const { run } = fakePg([SHA_A, SHA_B]);
      const attempt = runBackup({ database: "collex_local", uploadsDir: missing, backupRoot: path.join(root, "yedek"), run });
      // Before W21 this resolved with files: 0 and a valid, verifiable manifest.
      await expect(attempt).rejects.toMatchObject({ kind: "UPLOADS_MISSING" });
      const error = await attempt.catch((err: Error) => err);
      expect((error as Error).message).toContain(missing);
      expect((error as Error).message).toContain("2 belge aslı");
      expect((error as Error).message).toContain("--allow-empty-uploads");
      // No manifest: the console's "last backup" card cannot list it.
      expect(await readLastBackup(path.join(root, "yedek"))).toBeNull();
      // Nothing was created where the originals were expected.
      expect(existsSync(missing)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a refusal the database can already decide is made BEFORE pg_dump — no client-data dump is left behind", async () => {
    const root = await scratch();
    try {
      const backupRoot = path.join(root, "yedek");
      const missing = fakePg([SHA_A]);
      await expect(
        runBackup({ database: "collex_local", uploadsDir: path.join(root, "yok"), backupRoot, run: missing.run }),
      ).rejects.toMatchObject({ kind: "UPLOADS_MISSING" });
      expect(missing.calls.some((call) => call.tool === "pg_dump")).toBe(false);

      const wrong = fakePg([SHA_A]);
      const uploads = await uploadsWith(root, ["c".repeat(64) + ".pdf"]);
      await expect(runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot, run: wrong.run })).rejects.toMatchObject({
        kind: "UPLOADS_INCOMPLETE",
      });
      expect(wrong.calls.some((call) => call.tool === "pg_dump")).toBe(false);
      // Before: a timestamped folder holding a full dump stayed in the backup root.
      expect(existsSync(backupRoot)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a refusal only decidable after the dump discards the dump it wrote", async () => {
    const root = await scratch();
    try {
      const backupRoot = path.join(root, "yedek");
      const { run, calls } = fakePg("unknown");
      await expect(
        runBackup({ database: "collex_local", uploadsDir: path.join(root, "yok"), backupRoot, run }),
      ).rejects.toMatchObject({ kind: "UPLOADS_MISSING" });
      expect(calls.some((call) => call.tool === "pg_dump")).toBe(true);
      const left = existsSync(backupRoot) ? await readdir(backupRoot, { recursive: true }) : [];
      expect(left.filter((name) => String(name).endsWith(".dump"))).toEqual([]);
      expect(await readLastBackup(backupRoot)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a missing folder is refused too when the database cannot be asked — unknown is never zero", async () => {
    const root = await scratch();
    try {
      const { run } = fakePg("unknown");
      await expect(
        runBackup({ database: "collex_local", uploadsDir: path.join(root, "yok"), backupRoot: path.join(root, "yedek"), run }),
      ).rejects.toMatchObject({ kind: "UPLOADS_MISSING", message: expect.stringContaining("öğrenilemedi") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a fresh install (no folder, and the database names no original) still backs up — the console button works", async () => {
    const root = await scratch();
    try {
      const uploads = path.join(root, "veri", "uploads");
      const { run, calls } = fakePg([]);
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run });
      expect(result.files).toBe(0);
      expect(result.originals).toEqual({ uploadsDir: path.resolve(uploads), uploadsDirFound: false, inDatabase: 0, notFound: 0 });
      expect(backupOriginalsWarningTr(result.originals!)).toBeNull();
      expect((await verifyBackup(result.path)).ok).toBe(true);
      // The database question is ONE read-only select, never a password prompt.
      const asked = calls.find((call) => call.args.includes(STORED_ORIGINALS_SQL));
      expect(asked?.tool).toBe("psql");
      expect(asked?.args).toEqual(expect.arrayContaining(["-w", "-d", "collex_local", "-h", "127.0.0.1"]));
      expect(STORED_ORIGINALS_SQL).toMatch(/^select /u);
      expect(STORED_ORIGINALS_SQL).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate)\b/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("--allow-empty-uploads takes the backup anyway and it is never called complete", async () => {
    const root = await scratch();
    try {
      const { run } = fakePg([SHA_A]);
      const result = await runBackup({
        database: "collex_local",
        uploadsDir: path.join(root, "yok"),
        backupRoot: path.join(root, "yedek"),
        run,
        allowEmptyUploads: true,
      });
      expect(result.files).toBe(0);
      expect(result.originals).toMatchObject({ uploadsDirFound: false, inDatabase: 1, notFound: 1 });
      const warning = backupOriginalsWarningTr(result.originals!);
      expect(warning).toContain("İÇERMİYOR");
      expect(warning).toContain(path.resolve(root, "yok"));
      expect((await readLastBackup(path.join(root, "yedek")))?.originalsNotFound).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a folder that holds NONE of the originals the database names is the wrong folder", async () => {
    const root = await scratch();
    try {
      // e.g. <repo>/var/uploads left behind by an old hand-run restore.
      const uploads = await uploadsWith(root, ["c".repeat(64) + ".pdf"]);
      const { run } = fakePg([SHA_A, SHA_B]);
      await expect(
        runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run }),
      ).rejects.toMatchObject({ kind: "UPLOADS_INCOMPLETE", message: expect.stringContaining(uploads) });
      expect(await readLastBackup(path.join(root, "yedek"))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("originals missing from the right folder are counted in the manifest and the last-backup summary", async () => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(root, [`${SHA_A}.pdf`, `${SHA_B}.1234.abcd.part`]);
      const { run } = fakePg([SHA_A, SHA_B]);
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run });
      // A half-written `.part` file is not the original.
      expect(result.originals).toMatchObject({ uploadsDirFound: true, inDatabase: 2, notFound: 1 });
      expect(backupOriginalsWarningTr(result.originals!)).toContain("2 belge aslından 1 tanesi");
      const manifest = JSON.parse(await readFile(path.join(result.path, BACKUP_MANIFEST_FILE), "utf8"));
      expect(manifest.originals).toMatchObject({ inDatabase: 2, notFound: 1, uploadsDirFound: true });
      const last = await readLastBackup(path.join(root, "yedek"));
      expect(last?.originalsNotFound).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a complete backup carries no warning and no originalsNotFound", async () => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(root, [`${SHA_A}.pdf`, `${SHA_B}.udf`]);
      const { run } = fakePg([SHA_A, SHA_B]);
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run });
      expect(result.files).toBe(2);
      expect(result.originals).toMatchObject({ inDatabase: 2, notFound: 0 });
      expect(backupOriginalsWarningTr(result.originals!)).toBeNull();
      expect("originalsNotFound" in ((await readLastBackup(path.join(root, "yedek"))) ?? {})).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("listUploadOriginals never turns 'cannot read' into 'nothing there'", async () => {
    const root = await scratch();
    try {
      expect(await listUploadOriginals(path.join(root, "yok"))).toEqual({ exists: false, files: [] });
      const file = path.join(root, "dosya");
      await writeFile(file, "klasör değil", "utf8");
      await expect(listUploadOriginals(file)).rejects.toMatchObject({ kind: "UPLOADS_MISSING" });
      const uploads = await uploadsWith(root, ["b.pdf", "a.pdf"]);
      await mkdir(path.join(uploads, "alt"), { recursive: true });
      await writeFile(path.join(uploads, "alt", "c.pdf"), "c", "utf8");
      expect(await listUploadOriginals(uploads)).toEqual({ exists: true, files: ["a.pdf", "alt/c.pdf", "b.pdf"] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function backupWith(root: string, names: string[]): Promise<string> {
  const uploads = await uploadsWith(path.join(root, "kaynak"), names);
  const { run } = fakePg("unknown");
  return (await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run })).path;
}

describe("W21 #24 (second pass): 'not known to be missing' is never reported as complete", () => {
  it.each([
    ["an empty folder", [] as string[]],
    ["a folder of unrelated originals", ["c".repeat(64) + ".pdf", "dilekce.pdf"]],
  ])("the database cannot be asked and the uploads folder is %s: UNVERIFIED everywhere", async (_label, names) => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(root, names);
      const backupRoot = path.join(root, "yedek");
      const { run } = fakePg("unknown");
      // Before the fix this was a plain backup: no warning, a plain summary,
      // "N dosyanın tamamı eksiksiz" and the CLI headline "yedek tamam".
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot, run });
      expect(result.originals).toMatchObject({ uploadsDirFound: true, inDatabase: null, notFound: null });
      expect(result.originalsState).toBe("UNVERIFIED");
      expect(result.originalsWarning).toContain("DENETLENMEDİ");
      expect(result.originalsWarning).toContain(path.resolve(uploads));
      if (names.length === 0) expect(result.originalsWarning).toContain("hiçbir belge aslı İÇERMİYOR");
      expect(backupHeadlineTr(result)).toBe(`yedek alındı (DENETLENMEDİ): ${result.path}`);
      expect(backupHeadlineTr(result)).not.toContain("tamam");

      const manifest = JSON.parse(await readFile(path.join(result.path, BACKUP_MANIFEST_FILE), "utf8"));
      expect(backupOriginalsState(manifest.originals)).toBe("UNVERIFIED");

      const last = await readLastBackup(backupRoot);
      expect(last?.originalsState).toBe("UNVERIFIED");
      expect(last?.originalsWarning).toContain("DENETLENMEDİ");

      const verified = await verifyBackup(result.path);
      expect(verified.ok).toBe(true);
      expect(verified.originalsState).toBe("UNVERIFIED");
      expect(verified.message).toContain("Yedek doğrulandı");
      expect(verified.message).not.toContain("tamamı eksiksiz");
      expect(verified.message).toContain("DENETLENMEDİ");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a backup taken before the check existed (no originals block) is UNVERIFIED, not complete", async () => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(root, [`${SHA_A}.pdf`]);
      const backupRoot = path.join(root, "yedek");
      const { run } = fakePg([SHA_A]);
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot, run });
      const manifestPath = path.join(result.path, BACKUP_MANIFEST_FILE);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      delete manifest.originals;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

      expect((await readLastBackup(backupRoot))?.originalsState).toBe("UNVERIFIED");
      const verified = await verifyBackup(result.path);
      expect(verified.originalsState).toBe("UNVERIFIED");
      expect(verified.message).not.toContain("tamamı eksiksiz");
      expect(backupOriginalsState({ uploadsDir: "x", uploadsDirFound: true, inDatabase: "2" as never, notFound: 0 })).toBe(
        "UNVERIFIED",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a partial backup verifies as intact but never as complete", async () => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(root, [`${SHA_A}.pdf`]);
      const { run } = fakePg([SHA_A, SHA_B]);
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run });
      expect(result.originalsState).toBe("INCOMPLETE");
      expect(backupHeadlineTr(result)).toBe(`yedek alındı (EKSİK): ${result.path}`);
      const verified = await verifyBackup(result.path);
      // Before: "Yedek doğrulandı: 2 dosyanın tamamı eksiksiz."
      expect(verified.ok).toBe(true);
      expect(verified.originalsState).toBe("INCOMPLETE");
      expect(verified.message).not.toContain("tamamı eksiksiz");
      expect(verified.message).toContain("EKSİK");
      expect(verified.message).toContain("2 belge aslından 1 tanesi");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a complete backup keeps its plain wording", async () => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(root, [`${SHA_A}.pdf`]);
      const { run } = fakePg([SHA_A]);
      const result = await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run });
      expect(result.originalsState).toBe("COMPLETE");
      expect(result.originalsWarning).toBeNull();
      expect(backupHeadlineTr(result)).toBe(`yedek tamam: ${result.path}`);
      expect((await verifyBackup(result.path)).message).toBe("Yedek doğrulandı: 2 dosyanın tamamı eksiksiz.");
      const last = await readLastBackup(path.join(root, "yedek"));
      expect(last !== null && "originalsState" in last).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("W21 #24 (second pass): the restore checks what the RESTORED database names", () => {
  async function partialBackup(root: string): Promise<string> {
    const uploads = await uploadsWith(path.join(root, "kaynak"), [`${SHA_A}.pdf`]);
    const { run } = fakePg([SHA_A, SHA_B]);
    return (await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run })).path;
  }

  it("a partial backup restores the database but is reported EKSİK, never 'tamam'", async () => {
    const root = await scratch();
    try {
      const source = await partialBackup(root);
      const target = await uploadsWith(path.join(root, "hedef"), []);
      const { run } = fakePg([SHA_A, SHA_B]);
      const result = await runRestore({
        source, database: "collex_w21_fake", uploadsDir: target, safetyDir: path.join(root, "guvenlik"), confirmed: true, run,
      });
      // Before: ok=true, "Geri yükleme tamam: … 1 belge aslının tamamı … doğrulandı."
      expect(result.uploads.ok).toBe(true);
      expect(result.originals).toEqual({ inDatabase: 2, notFound: 1 });
      expect(result.originalsState).toBe("INCOMPLETE");
      expect(result.ok).toBe(false);
      expect(result.message).not.toContain("Geri yükleme tamam");
      expect(result.message).toContain("EKSİK");
      expect(result.message).toContain("2 belge aslından 1 tanesi");
      expect(result.message).toContain(path.resolve(target));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("an original the folder already holds counts — the check is what 'Aslını indir' will find", async () => {
    const root = await scratch();
    try {
      const source = await partialBackup(root);
      const target = await uploadsWith(path.join(root, "hedef"), [`${SHA_B}.pdf`]);
      const { run } = fakePg([SHA_A, SHA_B]);
      const result = await runRestore({
        source, database: "collex_w21_fake", uploadsDir: target, safetyDir: path.join(root, "guvenlik"), confirmed: true, run,
      });
      expect(result.originals).toEqual({ inDatabase: 2, notFound: 0 });
      expect(result.originalsState).toBe("COMPLETE");
      expect(result.ok).toBe(true);
      expect(result.message).toContain("Geri yükleme tamam");
      expect(result.message).toContain("andığı 2 belge aslının hepsi orada");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a restored database that cannot be asked is UNVERIFIED: not ok, never 'tamam'", async () => {
    const root = await scratch();
    try {
      const source = await backupWith(root, [`${SHA_A}.pdf`]);
      const target = await uploadsWith(path.join(root, "hedef"), []);
      const { run } = fakePg("unknown");
      const result = await runRestore({
        source, database: "collex_w21_fake", uploadsDir: target, safetyDir: path.join(root, "guvenlik"), confirmed: true, run,
      });
      expect(result.uploads.ok).toBe(true);
      expect(result.originals).toEqual({ inDatabase: null, notFound: null });
      expect(result.originalsState).toBe("UNVERIFIED");
      expect(result.ok).toBe(false);
      expect(result.message).not.toContain("Geri yükleme tamam");
      expect(result.message).toContain("DENETLENEMEDİ");
      // What was known when the backup was taken is carried along.
      expect(result.message).toContain("Yedek alınırken:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("W21 #24: the restore never creates the wrong uploads folder silently", () => {
  it("a missing uploads folder is refused before any tool runs, naming the folder", async () => {
    const root = await scratch();
    try {
      const source = await backupWith(root, [`${SHA_A}.pdf`]);
      const target = path.join(root, "depo", "var", "uploads");
      const { run, calls } = fakePg([]);
      const attempt = runRestore({
        source,
        database: "collex_w21_fake",
        uploadsDir: target,
        safetyDir: path.join(root, "guvenlik"),
        confirmed: true,
        run,
      });
      await expect(attempt).rejects.toMatchObject({ kind: "RESTORE_REFUSED" });
      const error = await attempt.catch((err: Error) => err);
      expect((error as Error).message).toContain(target);
      expect((error as Error).message).toContain("--create-uploads-dir");
      expect((error as Error).message).toContain("Hiçbir şey değişmedi");
      expect(calls).toHaveLength(0);
      expect(existsSync(target)).toBe(false);
      expect(existsSync(path.join(root, "guvenlik"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("with --create-uploads-dir it restores and names the folder it verified the originals in", async () => {
    const root = await scratch();
    try {
      const source = await backupWith(root, [`${SHA_A}.pdf`]);
      const target = path.join(root, "veri-yeni", "uploads");
      const { run } = fakePg([]);
      const result = await runRestore({
        source,
        database: "collex_w21_fake",
        uploadsDir: target,
        safetyDir: path.join(root, "guvenlik"),
        createUploadsDir: true,
        confirmed: true,
        run,
      });
      expect(result.ok).toBe(true);
      expect(result.uploadsDir).toBe(path.resolve(target));
      expect(result.message).toContain(`tamamı ${path.resolve(target)} içinde yerinde doğrulandı`);
      expect(existsSync(path.join(target, `${SHA_A}.pdf`))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a backup without originals never reads as 'all originals verified'", async () => {
    const root = await scratch();
    try {
      const uploads = await uploadsWith(path.join(root, "kaynak"), []);
      const { run: backupRun } = fakePg([]);
      const source = (
        await runBackup({ database: "collex_local", uploadsDir: uploads, backupRoot: path.join(root, "yedek"), run: backupRun })
      ).path;
      const { run } = fakePg([]);
      const result = await runRestore({
        source,
        database: "collex_w21_fake",
        uploadsDir: path.join(root, "hic-yok", "uploads"),
        safetyDir: path.join(root, "guvenlik"),
        confirmed: true,
        run,
      });
      // Before W21: "0 belge aslının tamamı yerinde doğrulandı."
      expect(result.message).not.toContain("tamamı");
      expect(result.message).toContain("hiçbir belge aslı içermiyordu");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(process.execPath, [BACKUP_MJS, ...args], { env, windowsHide: true, timeout: 120_000 }, (error, stdout, stderr) => {
      const code =
        error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as unknown as { code: number }).code : 1;
      resolvePromise({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

describe("W21 #24 (second pass): backup.mjs --verify never prints 'tamamı eksiksiz' over an unverified backup", () => {
  it("the folder verifies (exit 0) but the line and an UYARI say it is not known to be complete", async () => {
    const root = await scratch();
    try {
      const source = await backupWith(root, []);
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: root };
      delete env["COLLEX_BACKUP_DIR"];
      const verified = await runCli(["--verify", source], env);
      expect(verified.code, verified.stderr).toBe(0);
      // Before: "[ColleX] Yedek doğrulandı: 1 dosyanın tamamı eksiksiz." and nothing else.
      expect(verified.stdout).toContain("Yedek doğrulandı");
      expect(verified.stdout).not.toContain("tamamı eksiksiz");
      expect(verified.stdout).toContain("eksiksiz sayılamaz (DENETLENMEDİ)");
      expect(verified.stderr).toContain("UYARI:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("W21 #24: backup.mjs says which uploads folder it uses and where that came from", () => {
  it("without COLLEX_DATA_DIR it prints the <repo>/var fallback and warns; with it, it names the variable", async () => {
    const root = await scratch();
    try {
      const source = await backupWith(root, [`${SHA_A}.pdf`]);
      const base: NodeJS.ProcessEnv = { ...process.env, HOME: root };
      for (const name of ["COLLEX_DATA_DIR", "COLLEX_BACKUP_DIR"]) delete base[name];

      // No --yes: the CLI verifies and refuses before any PostgreSQL tool or
      // folder is touched — only the announcement is under test here.
      const fallback = await runCli(["--restore", source, "--database", "collex_w21_fake", "--out", root], base);
      expect(fallback.code).toBe(1);
      const repoUploads = path.resolve(fileURLToPath(new URL("../../../var/uploads", import.meta.url)));
      expect(fallback.stdout).toContain(`belge asılları klasörü: ${repoUploads}`);
      expect(fallback.stderr).toContain("COLLEX_DATA_DIR ayarlı değil");
      expect(fallback.stderr).toContain("--yes");

      const dataDir = path.join(root, "veri");
      const configured = await runCli(
        ["--restore", source, "--database", "collex_w21_fake", "--out", root, "--create-uploads-dir"],
        { ...base, COLLEX_DATA_DIR: dataDir },
      );
      expect(configured.code).toBe(1);
      expect(configured.stdout).toContain(`belge asılları klasörü: ${path.join(dataDir, "uploads")} (COLLEX_DATA_DIR)`);
      expect(configured.stdout + configured.stderr).not.toContain("COLLEX_DATA_DIR ayarlı değil");
      expect(configured.stderr).not.toContain("bilinmeyen seçenek");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
