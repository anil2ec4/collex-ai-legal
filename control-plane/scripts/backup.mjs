#!/usr/bin/env node
/**
 * ColleX backup / verify CLI (W14 B-03).
 *
 *   node control-plane/scripts/backup.mjs --database collex_local --out <root> [--allow-empty-uploads]
 *   node control-plane/scripts/backup.mjs --verify <backup folder>
 *   node control-plane/scripts/backup.mjs --dump-name <backup folder>
 *   node control-plane/scripts/backup.mjs --restore <backup folder> [--database collex_local]
 *        [--safety-dir <dir>] [--create-uploads-dir] --yes
 *
 * The `.cmd` files (`ColleX-Yedekle.cmd`, `ColleX-Geri-Yukle.cmd`) and the
 * macOS scripts (`deploy/macos/collex-backup.sh`, `collex-restore.sh`) are
 * thin wrappers over this script, so the manifest format and the hashing
 * live in ONE place — the same module `serve.mjs` mounts behind
 * `POST /v1/backup`, and the same module the tests exercise.
 *
 * Exit codes: 0 success, 1 failure (message in Turkish on stderr).
 * W21 (#24): a backup whose originals are not KNOWN to be complete still
 * exits 0 (the folder is the best copy there is) but its headline says
 * `yedek alındı (EKSİK)` or `yedek alındı (DENETLENMEDİ)`, never
 * `yedek tamam`. `--restore` exits 3 when the database was restored but the
 * originals the restored database names could not be checked, and 1 when
 * some are known to be missing.
 *
 * Safety: backup, --verify and --dump-name never drop or write to any
 * database: `pg_dump` (read-only, one snapshot) and `pg_restore -l` (reads
 * the archive file only). --restore (W21) is the portable destructive half
 * (`runRestore` in src/backup/runner.ts): it verifies the folder FIRST,
 * refuses without an explicit `--yes` (it never prompts, so a scheduled or
 * piped run cannot restore by accident), takes a safety `pg_dump`, renames
 * the existing database aside (never drops it), restores with
 * `--exit-on-error`, merges the originals without deleting anything and
 * re-verifies them against the manifest. The EVET prompt lives in the
 * wrappers (`ColleX-Geri-Yukle.cmd`, `deploy/macos/collex-restore.sh`).
 *
 * PostgreSQL tools: COLLEX_PGBIN, then PATH, then (macOS only) the common
 * Homebrew / Postgres.app folders — a guess that is announced as one.
 *
 * Upload originals (W21 #24): `<COLLEX_DATA_DIR>/uploads`, or `<repo>/var/uploads`
 * when COLLEX_DATA_DIR is not set. Backup and restore PRINT the folder and
 * where it came from, because the fallback is the wrong folder on a Mac whose
 * service keeps its data elsewhere. A backup refuses a missing folder
 * (UPLOADS_MISSING) or one holding none of the originals the database names
 * (UPLOADS_INCOMPLETE) unless `--allow-empty-uploads` is given; a restore
 * refuses to create a missing folder unless `--create-uploads-dir` is given.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { importControlPlane, CONTROL_PLANE_ROOT } from "./ts-loader.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(CONTROL_PLANE_ROOT), "..");

function parseArgs(argv) {
  const args = {
    database: "collex_local",
    out:
      (process.env["COLLEX_BACKUP_DIR"] ?? "").trim() ||
      // The SAME order as serve.mjs (the console's backup button and its
      // "last backup" card): USERPROFILE on Windows, HOME on macOS.
      path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? REPO_ROOT, "ColleX-Yedek"),
    port: 55432,
    host: "127.0.0.1",
    user: "postgres",
    verify: null,
    dumpName: null,
    restore: null,
    safetyDir: null,
    yes: false,
    allowEmptyUploads: false,
    createUploadsDir: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--database") args.database = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--port") args.port = Number(argv[++i]);
    else if (argv[i] === "--host") args.host = argv[++i];
    else if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i] === "--verify") args.verify = argv[++i];
    else if (argv[i] === "--dump-name") args.dumpName = argv[++i];
    else if (argv[i] === "--restore") args.restore = argv[++i];
    else if (argv[i] === "--safety-dir") args.safetyDir = argv[++i];
    else if (argv[i] === "--yes") args.yes = true;
    else if (argv[i] === "--allow-empty-uploads") args.allowEmptyUploads = true;
    else if (argv[i] === "--create-uploads-dir") args.createUploadsDir = true;
    else throw new Error(`bilinmeyen seçenek: ${argv[i]}`);
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`geçersiz port: ${args.port}`);
  }
  for (const [flag, value] of [["--restore", args.restore], ["--safety-dir", args.safetyDir],
    ["--verify", args.verify], ["--dump-name", args.dumpName], ["--out", args.out],
    ["--database", args.database]]) {
    if (value === undefined) throw new Error(`${flag} bir değer ister`);
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

// PostgreSQL tools (W21): COLLEX_PGBIN, then PATH (where scoop puts them on
// Windows), then — on macOS only — the common Homebrew / Postgres.app
// folders. A guessed folder is announced on stderr, never silently used:
// --dump-name prints its answer on stdout for a .cmd `for /f`.
function pgBinFor(tool) {
  const resolved = backup.resolvePgBin({ tool });
  if (resolved.inferred) {
    fail(`PostgreSQL araçları: ${resolved.dir} (tahmin edildi — kalıcı olması için COLLEX_PGBIN ile belirtin)`);
  }
  return resolved.dir;
}
const configuredDataDir = (process.env["COLLEX_DATA_DIR"] ?? "").trim();
const uploadsDir = path.resolve(path.join(configuredDataDir || path.join(REPO_ROOT, "var"), "uploads"));

// W21 (#24): say WHICH originals folder this run reads or writes, and where
// that answer came from. A silent fallback is how a Mac backup of the wrong
// folder looked complete.
function logUploadsDir() {
  if (configuredDataDir !== "") {
    log(`belge asılları klasörü: ${uploadsDir} (COLLEX_DATA_DIR)`);
    return;
  }
  log(`belge asılları klasörü: ${uploadsDir}`);
  // One wording on every platform (no platform branch in this script): on the
  // Windows launcher <repo>/var IS the data folder; on the Mac the launchd
  // service carries COLLEX_DATA_DIR in its plist and a hand-run terminal does
  // not, which is exactly the wrong-folder case.
  fail(
    "not: COLLEX_DATA_DIR ayarlı değil — ColleX klasöründeki var/ varsayıldı. Sunucu verisini başka bir" +
      " klasörde tutuyorsa (Mac'te launchd hizmeti) bu işlem YANLIŞ klasörle yapılır; değerleri" +
      " ~/.collex/collex.env dosyasına yazın.",
  );
}

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
    // W21 (#24): the folder is intact, but not known to hold every original.
    if (report.ok && report.originalsWarning) fail(`UYARI: ${report.originalsWarning}`);
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

if (args.restore !== null) {
  const source = path.resolve(args.restore);
  const safetyDir = path.resolve(args.safetyDir ?? path.join(args.out, "geri-yukleme-oncesi"));
  const pgBin = pgBinFor("pg_restore");
  log(`geri yükleme kaynağı: ${source}`);
  log(`hedef veritabanı    : ${args.database}`);
  logUploadsDir();
  try {
    const result = await backup.runRestore({
      source,
      database: args.database,
      host: args.host,
      port: args.port,
      user: args.user,
      uploadsDir,
      safetyDir,
      createUploadsDir: args.createUploadsDir === true,
      confirmed: args.yes === true,
      ...(pgBin !== "" ? { pgBin } : {}),
    });
    log(`yedek tarihi        : ${new Date(result.backupAt).toLocaleString("tr-TR")}`);
    if (result.safetyDump !== null) log(`güvenlik yedeği     : ${result.safetyDump}`);
    if (result.asideDatabase !== null) {
      log(`eski veritabanı     : ${result.asideDatabase} (her şey yolundaysa elle silin)`);
    }
    log(`belge aslı          : ${result.uploads.copied} kopyalandı, ${result.uploads.alreadyPresent} zaten yerindeydi`);
    for (const name of result.uploads.setAside) log(`  farklı içerikli yerel dosya kenara alındı: ${name}`);
    if (result.tables !== null) log(`tablo sayısı        : ${result.tables}`);
    if (result.originals && result.originals.inDatabase !== null) {
      log(`veritabanının andığı belge aslı: ${result.originals.inDatabase}` +
        (result.originals.notFound !== null ? ` (klasörde olmayan: ${result.originals.notFound})` : ""));
    }
    if (!result.uploads.ok || result.originalsState === "INCOMPLETE") {
      fail(result.message);
      for (const name of result.uploads.missing) fail(`  eksik   : ${name}`);
      for (const name of result.uploads.corrupt) fail(`  uyuşmuyor: ${name}`);
      process.exit(1);
    }
    if (!result.ok) {
      // W21 (#24): restored, but the originals it names were NOT checked —
      // a distinct exit code so no wrapper can print "tamam" over it.
      fail(`UYARI: ${result.message}`);
      process.exit(3);
    }
    log(result.message);
    process.exit(0);
  } catch (error) {
    fail(error?.message ?? String(error));
    process.exit(1);
  }
}

const pgBin = pgBinFor("pg_dump");
logUploadsDir();
try {
  const result = await backup.runBackup({
    database: args.database,
    host: args.host,
    port: args.port,
    user: args.user,
    uploadsDir,
    backupRoot: path.resolve(args.out),
    allowEmptyUploads: args.allowEmptyUploads === true,
    ...(pgBin !== "" ? { pgBin } : {}),
  });
  // W21 (#24): a backup that lacks originals the database names, or that
  // could not be checked against the database at all, is written (it is
  // still the best copy there is) but never announced as complete.
  const warning = backup.backupOriginalsWarningTr(result.originals, result.files);
  log(backup.backupHeadlineTr(result));
  log(`arşiv dosyası: ${result.dumpFile}`);
  log(`boyut       : ${formatBytes(result.sizeBytes)}`);
  log(`belge aslı  : ${result.files} dosya`);
  if (result.originals && result.originals.inDatabase !== null) {
    log(`veritabanının andığı belge aslı: ${result.originals.inDatabase}`);
  } else {
    fail("UYARI: veritabanının kaç belge aslı andığı öğrenilemedi (psql çalışmadı ya da sorgu yanıt vermedi).");
  }
  if (warning !== null) fail(`UYARI: ${warning}`);
  log(`uyarı       : ${result.warning}`);
  process.exit(0);
} catch (error) {
  fail(error?.message ?? String(error));
  process.exit(1);
}
