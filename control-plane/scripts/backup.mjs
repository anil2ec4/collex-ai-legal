#!/usr/bin/env node
/**
 * ColleX backup / verify CLI (W14 B-03).
 *
 *   node control-plane/scripts/backup.mjs --database collex_local --out <root>
 *   node control-plane/scripts/backup.mjs --verify <backup folder>
 *   node control-plane/scripts/backup.mjs --dump-name <backup folder>
 *
 * The two `.cmd` files (`ColleX-Yedekle.cmd`, `ColleX-Geri-Yukle.cmd`) are
 * thin wrappers over this script, so the manifest format and the hashing
 * live in ONE place — the same module `serve.mjs` mounts behind
 * `POST /v1/backup`, and the same module the tests exercise.
 *
 * Exit codes: 0 success, 1 failure (message in Turkish on stderr).
 *
 * Safety: this script never drops or writes to any database. It runs
 * `pg_dump` (read-only, one snapshot) and `pg_restore -l` (reads the archive
 * file only). The destructive half of a restore is in
 * `ColleX-Geri-Yukle.cmd`, where the user has to type EVET.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { importControlPlane, CONTROL_PLANE_ROOT } from "./ts-loader.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(CONTROL_PLANE_ROOT), "..");

function parseArgs(argv) {
  const args = {
    database: "collex_local",
    out: path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? REPO_ROOT, "ColleX-Yedek"),
    port: 55432,
    host: "127.0.0.1",
    user: "postgres",
    verify: null,
    dumpName: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--database") args.database = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--port") args.port = Number(argv[++i]);
    else if (argv[i] === "--host") args.host = argv[++i];
    else if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i] === "--verify") args.verify = argv[++i];
    else if (argv[i] === "--dump-name") args.dumpName = argv[++i];
    else throw new Error(`bilinmeyen seçenek: ${argv[i]}`);
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`geçersiz port: ${args.port}`);
  }
  return args;
}

const log = (line) => console.log(`[ColleX] ${line}`);
const fail = (line) => process.stderr.write(`[ColleX] ${line}\n`);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const args = parseArgs(process.argv.slice(2));
const backup = await importControlPlane("src/backup/runner.ts");

// Windows: the PostgreSQL binaries scoop installs are on PATH for the .cmd
// wrappers; an explicit directory can still be given through COLLEX_PGBIN.
const pgBin = process.env["COLLEX_PGBIN"] ?? "";
const uploadsDir = path.join(
  (process.env["COLLEX_DATA_DIR"] ?? "").trim() || path.join(REPO_ROOT, "var"),
  "uploads",
);

// V-14: the ONE place that answers "which file in this folder is the
// database?". `ColleX-Geri-Yukle.cmd` asks here instead of assuming
// `collex_local.dump`, so a backup of any database restores, and a folder
// whose manifest is unreadable fails LOUDLY instead of failing an existence
// check on a name it was going to restore from anyway.
// Prints the bare file name on stdout (no `[ColleX]` prefix — a .cmd `for /f`
// reads this line verbatim); every diagnostic goes to stderr.
if (args.dumpName !== null) {
  try {
    const manifest = await backup.readManifest(path.resolve(args.dumpName));
    const name = manifest?.dump?.path ?? "";
    if (typeof name !== "string" || name === "" || name.includes("/") || name.includes("\\")) {
      throw new Error("Yedek bilgisindeki arşiv adı tanınmadı (yedek.json).");
    }
    process.stdout.write(`${name}\n`);
    process.exit(0);
  } catch (error) {
    fail(error?.message ?? String(error));
    process.exit(1);
  }
}

if (args.verify !== null) {
  try {
    const report = await backup.verifyBackup(path.resolve(args.verify));
    log(report.message);
    if (!report.ok) {
      for (const name of report.missing) fail(`  eksik   : ${name}`);
      for (const name of report.corrupt) fail(`  bozulmuş: ${name}`);
      process.exit(1);
    }
    log(`yedek tarihi: ${new Date(report.at).toLocaleString("tr-TR")}`);
    log(`veritabanı  : ${report.database}`);
    log(`arşiv dosyası: ${report.dumpFile}`);
    process.exit(0);
  } catch (error) {
    fail(error?.message ?? String(error));
    process.exit(1);
  }
}

try {
  const result = await backup.runBackup({
    database: args.database,
    host: args.host,
    port: args.port,
    user: args.user,
    uploadsDir,
    backupRoot: path.resolve(args.out),
    ...(pgBin !== "" ? { pgBin } : {}),
  });
  log(`yedek tamam : ${result.path}`);
  log(`arşiv dosyası: ${result.dumpFile}`);
  log(`boyut       : ${formatBytes(result.sizeBytes)}`);
  log(`belge aslı  : ${result.files} dosya`);
  log(`uyarı       : ${result.warning}`);
  process.exit(0);
} catch (error) {
  fail(error?.message ?? String(error));
  process.exit(1);
}
