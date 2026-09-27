/**
 * Backup and restore verification for the lawyer's ONE copy of everything
 * (W14 B-03; ENGRISK E1, ARCH S1/F3, FEATURE F2).
 *
 * The measured starting point: `pg_dump`, `yedek` and `backup` appeared ZERO
 * times in product code. Matters, every draft version, deadlines and the
 * uploaded originals live on one disk, in one cluster, with `var/uploads/`
 * INSIDE the repository. A disk failure, a wrong `scoop uninstall -p
 * postgresql`, ransomware or simply moving the folder took all of it. "Your
 * data stays on this computer" is half a promise without a way back, and
 * protecting the client file is a duty of care, not a feature.
 *
 * WHAT A BACKUP IS HERE
 * ---------------------
 * One timestamped folder holding three things, because restoring any two of
 * them is not a restore:
 *
 *   <veritabanı>.dump   `pg_dump -Fc` of the product database (custom format:
 *                       compressed, selectively restorable, and more tolerant
 *                       of version drift than plain SQL). Named after the
 *                       database it holds — `collex_local.dump` for the
 *                       product store — and the manifest is what the restore
 *                       reads the name from (V-14)
 *   uploads/            a byte copy of the upload originals
 *   yedek.json          the manifest: schema id, taken-at, database size and
 *                       SHA-256, and per upload file its relative path, size
 *                       and SHA-256
 *
 * The manifest is what makes the restore VERIFIABLE rather than hopeful.
 * `verifyBackup` re-hashes everything the manifest names and reports each
 * mismatch by name, and the restore script runs it BEFORE it touches the
 * live database.
 *
 * A manifest only proves the folder matches ITSELF. W21 (#24): a backup run
 * against the wrong uploads folder (on the Mac, a hand-run script without
 * COLLEX_DATA_DIR falls back to `<repo>/var/uploads`, which the service never
 * uses) used to write, verify and list a backup with ZERO originals as the
 * newest good one. `runBackup` therefore refuses a missing uploads folder
 * (UPLOADS_MISSING) and a folder holding none of the originals the database
 * names (UPLOADS_INCOMPLETE), unless the database names no originals at all
 * (a fresh install) or the operator passes `allowEmptyUploads` explicitly.
 * Originals the database names but the folder lacks are counted in the
 * manifest (`originals.notFound`), never silently dropped. `runRestore`
 * likewise refuses to create an uploads folder that does not exist unless
 * `createUploadsDir` says so, and names the folder it verified.
 *
 * W21 (#24, second pass): "not known to be missing" is not "complete".
 * Every surface that reports a backup — the CLI headline, `yedek.json`,
 * `readLastBackup`, `verifyBackup` and the restore — carries ONE of three
 * states (`backupOriginalsState`): COMPLETE (the database was asked and every
 * original it names is in the backup), INCOMPLETE (some are known to be
 * absent) or UNVERIFIED (the database could not be asked, or the manifest
 * predates the check). Only COMPLETE is ever worded as complete. After a
 * restore the RESTORED database is asked which originals it names and each
 * is looked for in the uploads folder; a restore is `ok` only when that
 * check passed.
 *
 * DESIGN DECISIONS THAT ARE NOT NEGOTIABLE
 * ----------------------------------------
 * - The backup is READ-ONLY against the product database. `pg_dump` opens one
 *   repeatable-read snapshot; nothing is written to `collex_local`.
 * - `node:child_process.execFile` with an argument ARRAY, never a shell (the
 *   same rule as `src/files/routes.ts` and `src/drafting/routes.ts`). The
 *   dump path and the database name reach `pg_dump` as argv entries, so a
 *   folder name containing a quote or an ampersand cannot become a command.
 * - The restore NEVER starts with `drop database`. It renames the live
 *   database aside and restores into a fresh one, so a failed restore leaves
 *   the old data intact under `collex_local_eski_*`.
 * - The restore MERGES originals and never deletes (`ColleX-Geri-Yukle.cmd`:
 *   `robocopy /E`; the portable `runRestore` below: node:fs, a differing
 *   local file is renamed aside). An incomplete backup must not be able to
 *   remove files that are still on disk.
 *
 * WHAT IS DELIBERATELY NOT BUILT (ENGRISK §3.5): PITR / WAL archiving,
 * `pg_basebackup`, an automatic scheduled task, and encryption. The folder
 * carries client data and both the script and the UI say so: it belongs on
 * an encrypted disk.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Manifest schema id — bumped only on a breaking manifest change. */
export const BACKUP_MANIFEST_SCHEMA = "collex.backup.manifest/v1";
export const BACKUP_MANIFEST_FILE = "yedek.json";
export const BACKUP_UPLOADS_DIR = "uploads";

/**
 * The archive name every backup carried before W14 phase C, whatever database
 * it actually held. Kept ONLY so an old folder is still readable: its
 * `yedek.json` names this file, and `verifyBackup` / the restore script read
 * the name FROM the manifest, never from a constant.
 */
export const BACKUP_DUMP_FILE_LEGACY = "collex_local.dump";

/**
 * The archive is named after the database it actually holds (V-14).
 *
 * THE DEFECT. `runBackup` wrote `collex_local.dump` for every database, while
 * `yedek.json` (`"database"`) and `icindekiler.txt` (`dbname:`) recorded the
 * real one — measured on `--database collex_final_test` (W14-F-VERIFY §4.6).
 * Two installations' backups side by side in one folder were then two
 * identically named files whose contents differ, and
 * `ColleX-Geri-Yukle.cmd`'s `if not exist "%SRC%\collex_local.dump"` check
 * passed BY ACCIDENT — it was testing the constant it also restored from, so
 * it could never have caught a mismatch.
 *
 * The name is derived, not trusted: a PostgreSQL identifier may hold anything
 * a quoted name allows, and this value becomes a FILE NAME. Everything
 * outside `[A-Za-z0-9_.-]` becomes `_`, and a leading dot cannot survive, so
 * no database name can produce a path separator, a parent reference or a
 * hidden file.
 */
export function backupDumpFileName(database: string): string {
  const safe = database.replace(/[^A-Za-z0-9_.-]/gu, "_").replace(/^\.+/u, "_");
  return `${safe === "" ? "veritabani" : safe}.dump`;
}

/**
 * Shown next to every backup, in the console and in the .cmd / .sh output.
 * 27.09.2026: it named only BitLocker, a Windows feature, and the
 * production host is a Mac mini (FileVault).
 */
export const BACKUP_CLIENT_DATA_WARNING_TR =
  "Bu klasör müvekkil verisi içerir — şifreli bir diske koyun (Windows'ta BitLocker, Mac'te FileVault ile şifrelenmiş bir disk).";

/** A backup older than this reads as stale in the console (B-03). */
export const BACKUP_STALE_AFTER_DAYS = 7;

/** Wall budget for one pg_dump / pg_restore process. */
export const BACKUP_TOOL_TIMEOUT_MS = 300_000;

export interface BackupFileEntry {
  /** Path relative to the backup folder, POSIX separators. */
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface BackupManifest {
  schema: typeof BACKUP_MANIFEST_SCHEMA;
  /** ISO-8601 instant the backup finished. */
  at: string;
  database: string;
  /** The dump file, hashed. */
  dump: BackupFileEntry;
  /** Upload originals, hashed, sorted by path. */
  files: BackupFileEntry[];
  /** Sum of dump + originals. */
  totalBytes: number;
  /** W21 (#24), additive: what the database said about the originals. */
  originals?: BackupOriginalsCheck;
}

/**
 * W21 (#24): the originals the product database names, checked against the
 * uploads folder the backup read. `inDatabase` is null when the database
 * could not be asked (then nothing is concluded from it).
 */
export interface BackupOriginalsCheck {
  /** Absolute uploads folder the originals were read from. */
  uploadsDir: string;
  /** False only when the folder did not exist (fresh install or allowEmptyUploads). */
  uploadsDirFound: boolean;
  /** Distinct originals the current upload versions name; null = unknown. */
  inDatabase: number | null;
  /** Of those, how many are NOT in the uploads folder; null = unknown. */
  notFound: number | null;
}

/**
 * W21 (#24): how far a backup's originals are KNOWN to be complete.
 *
 *   COMPLETE    the database was asked; every original it names is here
 *   INCOMPLETE  the database was asked; some originals it names are not here
 *   UNVERIFIED  the database could not be asked, or the manifest predates
 *               the check — nothing is concluded, and nothing is called complete
 */
export type BackupOriginalsState = "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";

export interface BackupResult {
  /** Absolute path of the backup folder. */
  path: string;
  /** Archive file name inside the folder (V-14: `<database>.dump`). */
  dumpFile: string;
  /** Total bytes written (dump + originals). */
  sizeBytes: number;
  /** Number of upload originals copied. */
  files: number;
  at: string;
  database: string;
  warning: string;
  /**
   * W21 (#24): which uploads folder was read and what the database expected.
   * Always set by `runBackup`; optional in the type so a port that predates
   * it still satisfies the interface.
   */
  originals?: BackupOriginalsCheck;
  /** W21 (#24), additive: `backupOriginalsState(originals)`. */
  originalsState?: BackupOriginalsState;
  /** W21 (#24), additive: the Turkish warning, or null only when COMPLETE. */
  originalsWarning?: string | null;
}

export interface BackupSummary {
  path: string;
  lastAt: string;
  sizeBytes: number;
  files: number;
  /** True when the newest backup is older than BACKUP_STALE_AFTER_DAYS. */
  stale: boolean;
  /**
   * W21 (#24), additive: originals the database named that this backup does
   * NOT contain. Present only when that number is known and above zero.
   */
  originalsNotFound?: number;
  /**
   * W21 (#24), additive: present only when the newest backup is NOT known to
   * hold every original — INCOMPLETE, or UNVERIFIED (the database could not
   * be asked, or the backup predates the check). Absent means COMPLETE.
   */
  originalsState?: "INCOMPLETE" | "UNVERIFIED";
  /** W21 (#24), additive: the Turkish sentence for that state. */
  originalsWarning?: string;
}

export interface VerifyReport {
  ok: boolean;
  at: string;
  database: string;
  /** Archive file name the MANIFEST names — what a restore must open (V-14). */
  dumpFile: string;
  checked: number;
  /** Files the manifest names that are absent. */
  missing: string[];
  /** Files whose SHA-256 or size does not match the manifest. */
  corrupt: string[];
  /**
   * W21 (#24): whether the backup is known to hold every original the
   * database named. `ok` only says the folder matches its OWN manifest.
   */
  originalsState: BackupOriginalsState;
  /** W21 (#24): Turkish warning, or null when `originalsState` is COMPLETE. */
  originalsWarning: string | null;
  /** Turkish one-liner for the console / the .cmd. */
  message: string;
}

export type BackupErrorKind =
  | "PG_TOOLS_MISSING"
  | "DUMP_FAILED"
  | "COPY_FAILED"
  | "UPLOADS_MISSING"
  | "UPLOADS_INCOMPLETE"
  | "VERIFY_FAILED"
  | "RESTORE_NOT_CONFIRMED"
  | "RESTORE_REFUSED"
  | "RESTORE_FAILED";

export class BackupError extends Error {
  readonly kind: BackupErrorKind;
  constructor(kind: BackupErrorKind, message: string) {
    super(message);
    this.name = "BackupError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL tool process dependency (injected so tests never spawn anything)
// ---------------------------------------------------------------------------

export interface PgToolRequest {
  /** Absolute path (or bare name resolved through PATH) of the tool. */
  tool: string;
  args: string[];
}

export interface PgToolResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type PgToolRunner = (request: PgToolRequest) => Promise<PgToolResult>;

/** Real runner: execFile + argument array — shell-free by construction. */
export const execFilePgToolRunner: PgToolRunner = ({ tool, args }) =>
  new Promise((resolvePromise) => {
    execFile(
      tool,
      args,
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: BACKUP_TOOL_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as unknown as { code: number }).code
              : 1;
        resolvePromise({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

export interface BackupOptions {
  /** Product database name. */
  database: string;
  host?: string;
  port?: number;
  user?: string;
  /** Directory holding the upload originals (var/uploads or COLLEX_DATA_DIR). */
  uploadsDir: string;
  /** Root the timestamped folders are created under. */
  backupRoot: string;
  /** Directory holding pg_dump/pg_restore; "" = rely on PATH. */
  pgBin?: string;
  /**
   * W21 (#24): take the backup even when the uploads folder does not exist
   * or holds none of the originals the database names — an explicit choice
   * (`backup.mjs --allow-empty-uploads`), never a default.
   */
  allowEmptyUploads?: boolean;
  run?: PgToolRunner;
  now?: () => Date;
}

/** `20260902-143005` — sorts lexicographically, readable in Explorer. */
export function backupStamp(at: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${p(at.getFullYear(), 4)}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  );
}

export async function sha256File(file: string): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

/** Every file under `dir`, relative POSIX paths, sorted. */
export async function listFilesRecursive(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(path.join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

function pgTool(pgBin: string | undefined, name: string): string {
  return pgBin === undefined || pgBin === "" ? name : path.join(pgBin, name);
}

function errorCode(err: unknown): string {
  return err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : "";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * W21 (#24): the upload originals under `dir`, STRICTLY. Unlike the lenient
 * `listFilesRecursive` (which reads an unreadable or missing folder as "no
 * files"), a missing top folder is reported as `exists: false`, a top path
 * that is not a folder is UPLOADS_MISSING, and any other read error — at the
 * top or in a subfolder — is COPY_FAILED naming the folder. "Could not read"
 * is never turned into "there is nothing to back up".
 */
export async function listUploadOriginals(dir: string): Promise<{ exists: boolean; files: string[] }> {
  let info;
  try {
    info = await stat(dir);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { exists: false, files: [] };
    throw new BackupError("COPY_FAILED", `Belge asıllarının klasörü okunamadı (${dir}): ${errorText(err)}`);
  }
  if (!info.isDirectory()) {
    throw new BackupError(
      "UPLOADS_MISSING",
      `Belge asıllarının klasörü bir klasör değil: ${dir}. Veri klasörünü (COLLEX_DATA_DIR) denetleyin. Yedek alınmadı.`,
    );
  }
  const walk = async (folder: string, prefix: string): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (err) {
      throw new BackupError("COPY_FAILED", `Belge asıllarının klasörü okunamadı (${folder}): ${errorText(err)}`);
    }
    const out: string[] = [];
    for (const entry of entries) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await walk(path.join(folder, entry.name), rel)));
      else if (entry.isFile()) out.push(rel);
    }
    return out;
  };
  return { exists: true, files: (await walk(dir, "")).sort() };
}

/**
 * W21 (#24): the originals the product database names — the sha256 of every
 * CURRENT upload version, i.e. exactly the files "Aslını indir" serves
 * (`files/store.ts` originalRef). Read-only: one `select`.
 */
export const STORED_ORIGINALS_SQL =
  "select distinct v.metadata #>> '{fixture_meta,upload,sha256}'" +
  " from legal.documents d" +
  " join legal.document_versions v on v.document_id = d.id and upper_inf(v.system_period)" +
  " where d.scope = 'tenant' and d.source = 'UPLOAD'" +
  " and v.metadata #>> '{fixture_meta,upload,sha256}' ~ '^[0-9a-f]{64}$'";

const SHA256_LINE_RE = /^[0-9a-f]{64}$/u;

/**
 * Ask the database which originals it names. Null when it cannot be asked
 * (no psql, no schema, unexpected output): unknown is never read as zero.
 */
export async function storedOriginals(options: {
  run: PgToolRunner;
  pgBin?: string;
  host: string;
  port: number;
  user: string;
  database: string;
}): Promise<string[] | null> {
  let result: PgToolResult;
  try {
    result = await options.run({
      tool: pgTool(options.pgBin, "psql"),
      args: [
        "-h", options.host, "-p", String(options.port), "-U", options.user, "-w",
        "-d", options.database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-c", STORED_ORIGINALS_SQL,
      ],
    });
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  const lines = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
  return lines.every((line) => SHA256_LINE_RE.test(line)) ? [...new Set(lines)] : null;
}

/** sha256 values that have a `<sha256><ext>` original at the top of the uploads folder. */
function presentOriginals(files: readonly string[]): Set<string> {
  const present = new Set<string>();
  for (const rel of files) {
    if (rel.includes("/")) continue;
    const head = rel.slice(0, 64);
    const rest = rel.slice(64);
    if (SHA256_LINE_RE.test(head) && (rest === "" || /^\.[A-Za-z0-9]+$/u.test(rest))) present.add(head);
  }
  return present;
}

const ALLOW_EMPTY_HINT_TR =
  " Hizmetin kullandığı veri klasörünü COLLEX_DATA_DIR ile verin (Mac'te ~/.collex/collex.env);" +
  " belge aslı olmadan yedek almayı bilerek istiyorsanız --allow-empty-uploads ekleyin." +
  " Yedek alınmadı ve yedek listesinde görünmez.";

/**
 * W21 (#24): the refusal (or null) for one look at the uploads folder and
 * one answer from the database. `expected` null = the database could not be
 * asked: a MISSING folder is then refused (unknown is never zero), an
 * existing one is not (the backup is taken and labelled UNVERIFIED).
 */
function uploadsRefusal(
  uploadsDir: string,
  exists: boolean,
  files: readonly string[],
  expected: readonly string[] | null,
  allowEmpty: boolean,
): BackupError | null {
  if (allowEmpty) return null;
  if (!exists && !(expected !== null && expected.length === 0)) {
    return new BackupError(
      "UPLOADS_MISSING",
      `Belge asıllarının klasörü bulunamadı: ${uploadsDir}.` +
        (expected === null
          ? " Veritabanının kaç belge aslı andığı da öğrenilemedi, bu yüzden bu klasörsüz bir yedeğin eksiksiz olduğu söylenemez."
          : ` Veritabanı ${expected.length} belge aslı anıyor; bu klasörle alınan yedek hiçbirini içermezdi.`) +
        ALLOW_EMPTY_HINT_TR,
    );
  }
  if (exists && expected !== null && expected.length > 0) {
    const present = presentOriginals(files);
    if (expected.every((sha) => !present.has(sha))) {
      return new BackupError(
        "UPLOADS_INCOMPLETE",
        `Belge asıllarının klasöründe (${uploadsDir}) veritabanının andığı ${expected.length} belge aslının` +
          " hiçbiri yok — büyük olasılıkla yanlış klasör." +
          ALLOW_EMPTY_HINT_TR,
      );
    }
  }
  return null;
}

/**
 * Remove what THIS run wrote before a refusal: its dump file and, when they
 * are empty, its `uploads/` subfolder and its timestamped folder. Never
 * recursive — a folder holding anything else is left exactly as it is.
 */
async function discardRefusedBackup(dir: string, dumpPath: string): Promise<void> {
  await rm(dumpPath, { force: true }).catch(() => undefined);
  await rmdir(path.join(dir, BACKUP_UPLOADS_DIR)).catch(() => undefined);
  await rmdir(dir).catch(() => undefined);
}

/**
 * Take one backup. Never writes to the product database.
 *
 * Order matters: dump first (the expensive, failure-prone step), then the
 * originals, then verify the dump is readable (`pg_restore -l`), then write
 * the manifest LAST — a folder without `yedek.json` is by construction an
 * incomplete backup and `readLastBackup` ignores it rather than reporting a
 * half-written folder as "your last backup".
 */
export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const run = options.run ?? execFilePgToolRunner;
  const now = options.now ?? (() => new Date());
  const at = now();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 55432;
  const user = options.user ?? "postgres";
  const dir = path.join(options.backupRoot, backupStamp(at));
  const uploadsDir = path.resolve(options.uploadsDir);
  const allowEmpty = options.allowEmptyUploads === true;
  const askDatabase = (): Promise<string[] | null> =>
    storedOriginals({
      run,
      host,
      port,
      user,
      database: options.database,
      ...(options.pgBin !== undefined ? { pgBin: options.pgBin } : {}),
    });

  // W21 (#24): when the database CAN be asked and its answer already refuses
  // this uploads folder, refuse BEFORE anything is written — a refused run
  // must not leave a folder holding a full client-data dump behind. The
  // authoritative check still runs after the dump (below).
  if (!allowEmpty) {
    const early = await askDatabase();
    if (early !== null && early.length > 0) {
      const listing = await listUploadOriginals(uploadsDir);
      const refusal = uploadsRefusal(uploadsDir, listing.exists, listing.files, early, allowEmpty);
      if (refusal !== null) throw refusal;
    }
  }

  await mkdir(path.join(dir, BACKUP_UPLOADS_DIR), { recursive: true });

  // V-14: named after the database this archive actually holds, so a folder
  // of backups from two installations cannot hold two files with one name.
  const dumpFile = backupDumpFileName(options.database);
  const dumpPath = path.join(dir, dumpFile);
  const dumped = await run({
    tool: pgTool(options.pgBin, "pg_dump"),
    args: [
      "-h", host,
      "-p", String(port),
      "-U", user,
      "-d", options.database,
      "-Fc",
      "-f", dumpPath,
    ],
  });
  if (dumped.code !== 0) {
    throw new BackupError(
      "DUMP_FAILED",
      `Veritabanı yedeği alınamadı (${options.database}): ${dumped.stderr.trim().slice(0, 300)}`,
    );
  }

  // Originals: a plain byte copy, so the backup folder is inspectable with
  // Explorer and restorable by hand if every tool here disappears.
  //
  // W21 (#24): first make sure THIS is the folder holding them. A missing
  // folder used to read as "no originals" and produced a complete-looking
  // backup of nothing; the database is asked what it expects instead. Asked
  // AFTER the dump, so every original the dump can name is in the answer.
  let uploadsListing: { exists: boolean; files: string[] };
  let expected: string[] | null;
  try {
    uploadsListing = await listUploadOriginals(uploadsDir);
    expected = await askDatabase();
  } catch (err) {
    await discardRefusedBackup(dir, dumpPath);
    throw err;
  }
  const names = uploadsListing.files;
  const refusal = uploadsRefusal(uploadsDir, uploadsListing.exists, names, expected, allowEmpty);
  if (refusal !== null) {
    await discardRefusedBackup(dir, dumpPath);
    throw refusal;
  }
  const present = presentOriginals(names);
  const notFound = expected === null ? null : expected.filter((sha) => !present.has(sha)).length;
  const originals: BackupOriginalsCheck = {
    uploadsDir,
    uploadsDirFound: uploadsListing.exists,
    inDatabase: expected === null ? null : expected.length,
    notFound,
  };
  const files: BackupFileEntry[] = [];
  for (const rel of names) {
    const src = path.join(uploadsDir, ...rel.split("/"));
    const dst = path.join(dir, BACKUP_UPLOADS_DIR, ...rel.split("/"));
    await mkdir(path.dirname(dst), { recursive: true });
    try {
      await copyFile(src, dst);
    } catch (err) {
      throw new BackupError(
        "COPY_FAILED",
        `Belge aslı kopyalanamadı (${rel}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const info = await stat(dst);
    files.push({
      path: `${BACKUP_UPLOADS_DIR}/${rel}`,
      sizeBytes: info.size,
      sha256: await sha256File(dst),
    });
  }

  // The dump must be READABLE, not merely present. `pg_restore -l` parses the
  // archive's table of contents and touches no database at all.
  const listing = await run({ tool: pgTool(options.pgBin, "pg_restore"), args: ["-l", dumpPath] });
  if (listing.code !== 0) {
    throw new BackupError(
      "VERIFY_FAILED",
      `Yedek doğrulanamadı — dosya okunamıyor: ${listing.stderr.trim().slice(0, 300)}`,
    );
  }
  await writeFile(path.join(dir, "icindekiler.txt"), listing.stdout, "utf8");

  const dumpInfo = await stat(dumpPath);
  const manifest: BackupManifest = {
    schema: BACKUP_MANIFEST_SCHEMA,
    at: at.toISOString(),
    database: options.database,
    dump: {
      path: dumpFile,
      sizeBytes: dumpInfo.size,
      sha256: await sha256File(dumpPath),
    },
    files,
    totalBytes: dumpInfo.size + files.reduce((sum, f) => sum + f.sizeBytes, 0),
    originals,
  };
  await writeFile(path.join(dir, BACKUP_MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");

  return {
    path: dir,
    dumpFile,
    sizeBytes: manifest.totalBytes,
    files: files.length,
    at: manifest.at,
    database: options.database,
    warning: BACKUP_CLIENT_DATA_WARNING_TR,
    originals,
    originalsState: backupOriginalsState(originals),
    originalsWarning: backupOriginalsWarningTr(originals, files.length),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * W21 (#24): COMPLETE only when the database was asked and nothing it named
 * was missing. A manifest without the block (taken before the check existed)
 * or with a malformed one is UNVERIFIED — never read as complete.
 */
export function backupOriginalsState(originals: BackupOriginalsCheck | undefined | null): BackupOriginalsState {
  if (originals === undefined || originals === null || typeof originals !== "object") return "UNVERIFIED";
  if (isCount(originals.notFound) && originals.notFound > 0) return "INCOMPLETE";
  if (!isCount(originals.inDatabase) || !isCount(originals.notFound)) return "UNVERIFIED";
  return "COMPLETE";
}

/** W21 (#24): the CLI headline for a finished backup — "tamam" only when COMPLETE. */
export function backupHeadlineTr(result: Pick<BackupResult, "path" | "originals">): string {
  const state = backupOriginalsState(result.originals);
  const label =
    state === "COMPLETE" ? "yedek tamam" : state === "INCOMPLETE" ? "yedek alındı (EKSİK)" : "yedek alındı (DENETLENMEDİ)";
  return `${label}: ${result.path}`;
}

/**
 * W21 (#24): the Turkish line to show next to a backup whose originals are
 * not KNOWN to be complete, or null only when `backupOriginalsState` is
 * COMPLETE. Never says "complete" about an incomplete or unverified backup.
 * `files` is the number of files the backup holds, when known.
 */
export function backupOriginalsWarningTr(
  originals: BackupOriginalsCheck | undefined | null,
  files?: number,
): string | null {
  const state = backupOriginalsState(originals);
  if (state === "COMPLETE") return null;
  if (originals === undefined || originals === null || typeof originals !== "object") {
    return (
      "Bu yedek, belge asıllarının veritabanına karşı denetlenmesinden önce alınmış;" +
      " veritabanının andığı bütün belge asıllarını içerdiği DENETLENMEDİ."
    );
  }
  const dir = typeof originals.uploadsDir === "string" ? originals.uploadsDir : "?";
  const inDatabase = isCount(originals.inDatabase) ? originals.inDatabase : null;
  if (originals.uploadsDirFound === false) {
    return (
      `Belge asıllarının klasörü yoktu (${dir}); bu yedek hiçbir belge aslı İÇERMİYOR` +
      (inDatabase === null
        ? " ve veritabanının kaç belge aslı andığı öğrenilemedi — yedeğin eksiksiz olduğu DENETLENMEDİ."
        : ` — veritabanı ${inDatabase} belge aslı anıyor.`)
    );
  }
  if (state === "INCOMPLETE") {
    return (
      `Veritabanının andığı ${inDatabase ?? "?"} belge aslından ${originals.notFound} tanesi` +
      ` klasörde yok (${dir}); bu yedek o belgelerin aslını İÇERMİYOR.`
    );
  }
  if (files === 0) {
    return (
      `Belge asıllarının klasörü (${dir}) boştu; bu yedek hiçbir belge aslı İÇERMİYOR ve veritabanının` +
      " kaç belge aslı andığı öğrenilemedi — yedeğin eksiksiz olduğu DENETLENMEDİ."
    );
  }
  return (
    `Bu yedekteki ${files === undefined ? "" : `${files} `}dosya (${dir}) veritabanına karşı DENETLENMEDİ:` +
    " veritabanının kaç belge aslı andığı öğrenilemedi, bu yüzden yedeğin bütün belge asıllarını içerdiği söylenemez."
  );
}

/** Parse + shape-check a manifest file. Throws BackupError on anything odd. */
export async function readManifest(dir: string): Promise<BackupManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(dir, BACKUP_MANIFEST_FILE), "utf8"));
  } catch (err) {
    throw new BackupError(
      "VERIFY_FAILED",
      `Yedek bilgisi okunamadı (${BACKUP_MANIFEST_FILE}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const m = parsed as Partial<BackupManifest> | null;
  if (m === null || typeof m !== "object" || m.schema !== BACKUP_MANIFEST_SCHEMA || !Array.isArray(m.files)) {
    throw new BackupError("VERIFY_FAILED", "Yedek bilgisi tanınmadı — bu klasör bir ColleX yedeği değil.");
  }
  return m as BackupManifest;
}

/**
 * Re-hash everything the manifest names. The restore script calls this BEFORE
 * it renames the live database: verifying after the fact is not verification.
 */
export async function verifyBackup(dir: string): Promise<VerifyReport> {
  const manifest = await readManifest(dir);
  const missing: string[] = [];
  const corrupt: string[] = [];
  const entries = [manifest.dump, ...manifest.files];
  for (const entry of entries) {
    const file = path.join(dir, ...entry.path.split("/"));
    let info;
    try {
      info = await stat(file);
    } catch {
      missing.push(entry.path);
      continue;
    }
    if (info.size !== entry.sizeBytes || (await sha256File(file)) !== entry.sha256) {
      corrupt.push(entry.path);
    }
  }
  const ok = missing.length === 0 && corrupt.length === 0;
  // W21 (#24): a folder that matches its own manifest is not thereby a
  // backup of every original — say which, never "tamamı eksiksiz" unless the
  // database was asked when it was taken and nothing was missing.
  const originalsState = backupOriginalsState(manifest.originals);
  const originalsWarning = backupOriginalsWarningTr(manifest.originals, manifest.files.length);
  return {
    ok,
    at: manifest.at,
    database: manifest.database,
    dumpFile: manifest.dump.path,
    checked: entries.length,
    missing,
    corrupt,
    originalsState,
    originalsWarning,
    message: !ok
      ? `Yedek BOZUK — eksik: ${missing.length}, bozulmuş: ${corrupt.length}.` +
        " Bu yedekle geri yükleme yapmayın."
      : originalsState === "COMPLETE"
        ? `Yedek doğrulandı: ${entries.length} dosyanın tamamı eksiksiz.`
        : `Yedek doğrulandı: ${entries.length} dosya yedek listesiyle birebir eşleşiyor — ama yedek` +
          ` eksiksiz sayılamaz (${originalsState === "INCOMPLETE" ? "EKSİK" : "DENETLENMEDİ"}): ${originalsWarning}`,
  };
}

/** Newest COMPLETE backup under `backupRoot`, or null. Never throws. */
export async function readLastBackup(
  backupRoot: string,
  now: () => Date = () => new Date(),
): Promise<BackupSummary | null> {
  let entries;
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of dirs) {
    const dir = path.join(backupRoot, name);
    try {
      const manifest = await readManifest(dir);
      const ageMs = now().getTime() - Date.parse(manifest.at);
      const notFound = manifest.originals?.notFound;
      const originalsState = backupOriginalsState(manifest.originals);
      const originalsWarning = backupOriginalsWarningTr(manifest.originals, manifest.files.length);
      return {
        path: dir,
        lastAt: manifest.at,
        sizeBytes: manifest.totalBytes,
        files: manifest.files.length,
        stale: Number.isFinite(ageMs) && ageMs > BACKUP_STALE_AFTER_DAYS * 24 * 3600 * 1000,
        ...(typeof notFound === "number" && Number.isInteger(notFound) && notFound > 0
          ? { originalsNotFound: notFound }
          : {}),
        // W21 (#24): the newest backup is never reported plainly when its
        // originals are not known to be complete.
        ...(originalsState !== "COMPLETE" && originalsWarning !== null
          ? { originalsState, originalsWarning }
          : {}),
      };
    } catch {
      // An incomplete or foreign folder is skipped, not reported as the last
      // backup: telling the lawyer "backed up" about a folder with no
      // manifest is the worst possible lie in this module.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PostgreSQL tool location (W21: portable, macOS-aware)
// ---------------------------------------------------------------------------

/**
 * Where a Mac most likely keeps the PostgreSQL client tools when neither
 * COLLEX_PGBIN nor PATH names them — a launchd-started process usually has
 * no /opt/homebrew/bin on its PATH. A hit here is a GUESS and is reported as
 * `inferred`, never as configured. Only consulted when platform is darwin.
 * UNVALIDATED ON PHYSICAL MAC. `deploy/macos/collex-env.sh` probes the same
 * list in the same order (tests/portability pins the two together).
 */
export const MACOS_PG_BIN_CANDIDATES: readonly string[] = [
  "/opt/homebrew/opt/postgresql@18/bin",
  "/opt/homebrew/opt/postgresql@17/bin",
  "/opt/homebrew/opt/postgresql/bin",
  "/opt/homebrew/bin",
  "/usr/local/opt/postgresql@18/bin",
  "/usr/local/opt/postgresql@17/bin",
  "/usr/local/bin",
  "/Applications/Postgres.app/Contents/Versions/latest/bin",
];

export type PgBinSource = "COLLEX_PGBIN" | "PATH" | "inferred" | "unresolved";

export interface PgBinResolution {
  /** Directory holding the tools; "" = bare names resolved through PATH. */
  dir: string;
  source: PgBinSource;
  /** True only for a macOS install-location guess. */
  inferred: boolean;
}

export interface PgBinOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
  /** The tool whose presence decides a directory (default pg_dump). */
  tool?: string;
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name];
  // Windows environment names are case-insensitive ("Path").
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * COLLEX_PGBIN first, then PATH, then — on macOS only — the common Homebrew
 * and Postgres.app folders. Pure: the filesystem probe is injectable and the
 * path rules are the TARGET platform's, so a darwin answer can be computed
 * (and tested) on any host.
 */
export function resolvePgBin(options: PgBinOptions = {}): PgBinResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const tool = options.tool ?? "pg_dump";
  const p = platform === "win32" ? path.win32 : path.posix;

  const configured = (envValue(env, "COLLEX_PGBIN", platform) ?? "").trim();
  if (configured !== "") return { dir: configured, source: "COLLEX_PGBIN", inferred: false };

  const names = platform === "win32" ? [`${tool}.exe`, tool] : [tool];
  for (const dir of (envValue(env, "PATH", platform) ?? "").split(p.delimiter)) {
    if (dir.trim() === "") continue;
    if (names.some((name) => exists(p.join(dir, name)))) {
      return { dir: "", source: "PATH", inferred: false };
    }
  }
  if (platform === "darwin") {
    for (const dir of MACOS_PG_BIN_CANDIDATES) {
      if (exists(p.join(dir, tool))) return { dir, source: "inferred", inferred: true };
    }
  }
  return { dir: "", source: "unresolved", inferred: false };
}

// ---------------------------------------------------------------------------
// Portable restore (W21) — the destructive half, off the Windows .cmd
// ---------------------------------------------------------------------------
//
// Until W21 the only restore was `ColleX-Geri-Yukle.cmd` (robocopy,
// pg_restore.exe, locale-dependent `%date%` stamps), so a backup taken on the
// production Mac could not be restored there at all. `runRestore` is the
// same procedure in portable code, with the .cmd's non-negotiables kept and
// two of its gaps closed:
//
//   1. VERIFY FIRST — `verifyBackup` re-hashes the folder before any tool
//      runs; a corrupt backup starts nothing.
//   2. EXPLICIT CONFIRMATION — `confirmed` must be literally true (the CLI
//      sets it only for `--yes`); nothing is ever asked on a terminal here,
//      so a scheduled or piped run cannot hang or restore by accident.
//   3. SAFETY NET — a `pg_dump` of the database about to be replaced. The
//      .cmd ignored that dump's exit code (`2>nul`); here a failed safety
//      dump STOPS the restore before anything is renamed.
//   4. RENAME ASIDE, NEVER DROP — `<db>_eski_<stamp>` keeps the old data; a
//      failed restore leaves it intact and says how to roll back by hand.
//   5. `pg_restore --no-owner --no-privileges --exit-on-error`.
//   6. ORIGINALS MERGE, NEVER DELETE — and (new) every original the manifest
//      names is re-hashed in place afterwards. The .cmd never re-checked.
//
// Stamps come from `backupStamp` (local clock, fixed format), not from a
// locale-formatted date string.

export const RESTORE_NOT_CONFIRMED_MESSAGE_TR =
  "Yedek doğrulandı ama geri yükleme YAPILMADI: mevcut veritabanı kenara alınıp yerine bu yedek" +
  " konacak. Onaylamak için komutu --yes ile yeniden çalıştırın. Hiçbir şey değişmedi.";

/**
 * Restorable target names: a plain lower-case identifier, short enough that
 * `<name>_eski_YYYYMMDD_HHMMSS` still fits PostgreSQL's 63-byte limit.
 */
const RESTORE_DB_NAME_RE = /^[a-z_][a-z0-9_]{0,39}$/u;

export interface RestoreOptions {
  /** The backup folder (the one holding yedek.json). */
  source: string;
  /** Target database. When it exists it is renamed aside, never dropped. */
  database: string;
  host?: string;
  port?: number;
  user?: string;
  /** Directory the upload originals are merged into (<data>/uploads). */
  uploadsDir: string;
  /** Where the pre-restore safety dump is written. */
  safetyDir: string;
  /** Directory holding pg_dump/pg_restore/psql; "" = rely on PATH. */
  pgBin?: string;
  /**
   * W21 (#24): create `uploadsDir` when it does not exist. Without it a
   * restore into a missing folder is refused BEFORE anything changes: a
   * missing folder usually means the wrong data folder (on the Mac, a
   * hand-run script without COLLEX_DATA_DIR), and originals verified there
   * are originals the service never serves.
   */
  createUploadsDir?: boolean;
  /** Must be literally true — the CLI sets it only for an explicit --yes. */
  confirmed: boolean;
  run?: PgToolRunner;
  now?: () => Date;
}

export interface RestoreUploadsReport {
  /** Originals copied into the uploads folder. */
  copied: number;
  /** Originals that were already there with the same bytes. */
  alreadyPresent: number;
  /** Paths (relative to uploads/) whose different local file was renamed aside. */
  setAside: string[];
  /** After the merge: named by the manifest, absent from the uploads folder. */
  missing: string[];
  /** After the merge: present but not matching the manifest (or refused). */
  corrupt: string[];
  ok: boolean;
}

/**
 * W21 (#24): after a restore, the RESTORED database is asked which originals
 * it names and each is looked for in the uploads folder. A backup can be
 * perfectly intact and still lack originals its own dump names.
 */
export interface RestoreOriginalsCheck {
  /** Distinct originals the restored database names; null = could not be asked. */
  inDatabase: number | null;
  /** Of those, how many are not in the uploads folder after the merge; null = unknown. */
  notFound: number | null;
}

export interface RestoreResult {
  database: string;
  /** W21 (#24): the folder the originals were merged into and verified in. */
  uploadsDir: string;
  /** Archive file the MANIFEST names (V-14). */
  dumpFile: string;
  /** When the backup was taken (from the manifest). */
  backupAt: string;
  /** Name the previous database now carries, or null when there was none. */
  asideDatabase: string | null;
  /** Pre-restore safety dump, or null when there was nothing to save. */
  safetyDump: string | null;
  /** Tables in the restored database (best effort; null when not counted). */
  tables: number | null;
  uploads: RestoreUploadsReport;
  /** W21 (#24): what the restored database names, checked in the uploads folder. */
  originals: RestoreOriginalsCheck;
  /**
   * W21 (#24): COMPLETE — every original the restored database names is in
   * the uploads folder; INCOMPLETE — some are known to be absent (or the
   * merge could not verify every original of the backup); UNVERIFIED — the
   * restored database could not be asked or the folder could not be read.
   */
  originalsState: BackupOriginalsState;
  /**
   * Database restored, every original of the backup re-verified in place AND
   * `originalsState` is COMPLETE. Never true on an unverified restore.
   */
  ok: boolean;
  message: string;
}

function restoreStamp(at: Date): string {
  return backupStamp(at).replace("-", "_");
}

function stderrLine(result: PgToolResult): string {
  return result.stderr.trim().slice(0, 300);
}

async function fileState(file: string, entry: BackupFileEntry): Promise<"missing" | "match" | "differs"> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return "missing";
  }
  if (!info.isFile()) return "differs";
  return info.size === entry.sizeBytes && (await sha256File(file)) === entry.sha256 ? "match" : "differs";
}

/** `uploads/<rel>` as path segments, or null for anything that could leave the uploads folder. */
function uploadSegments(entryPath: string): string[] | null {
  const prefix = `${BACKUP_UPLOADS_DIR}/`;
  if (!entryPath.startsWith(prefix)) return null;
  const segments = entryPath.slice(prefix.length).split("/");
  const unsafe = segments.some(
    (segment) =>
      segment === "" || segment === "." || segment === ".." || segment.includes("\\") || segment.includes(":"),
  );
  return unsafe ? null : segments;
}

/**
 * Merge the backed-up originals into `uploadsDir`. A file already there with
 * the same bytes is left alone; a DIFFERENT file under the same name is
 * renamed aside (`<name>.eski-<stamp>`) — never overwritten, never deleted;
 * files the backup does not name are not touched at all. Then every original
 * the manifest names is re-hashed IN PLACE: a merge nobody re-checked is not
 * a restore.
 */
export async function mergeUploads(
  source: string,
  files: readonly BackupFileEntry[],
  uploadsDir: string,
  stamp: string,
): Promise<RestoreUploadsReport> {
  let copied = 0;
  let alreadyPresent = 0;
  const setAside: string[] = [];
  const refused: string[] = [];
  const placed: Array<{ entry: BackupFileEntry; dst: string; rel: string }> = [];
  const unplaceable: string[] = [];
  for (const entry of files) {
    const segments = uploadSegments(entry.path);
    if (segments === null) {
      refused.push(entry.path);
      continue;
    }
    const rel = segments.join("/");
    const dst = path.join(uploadsDir, ...segments);
    placed.push({ entry, dst, rel });
    // The database is ALREADY restored when this runs: an fs error here (a
    // file where a folder should be, a permission) must become a reported
    // problem with this one original, never an exception that hides what
    // was and was not put back.
    let state: Awaited<ReturnType<typeof fileState>>;
    try {
      await mkdir(path.dirname(dst), { recursive: true });
      state = await fileState(dst, entry);
      if (state === "match") {
        alreadyPresent += 1;
        continue;
      }
      if (state === "differs") {
        let aside = `${dst}.eski-${stamp}`;
        for (let n = 2; existsSync(aside); n += 1) aside = `${dst}.eski-${stamp}-${n}`;
        await rename(dst, aside);
        setAside.push(rel);
      }
    } catch {
      unplaceable.push(rel);
      continue;
    }
    try {
      // COPYFILE_EXCL: a file that appeared in the meantime is never overwritten.
      await copyFile(path.join(source, BACKUP_UPLOADS_DIR, ...segments), dst, fsConstants.COPYFILE_EXCL);
      copied += 1;
    } catch {
      // Reported by the re-verification below as missing or corrupt.
    }
  }
  const missing: string[] = [];
  const corrupt: string[] = [...refused, ...unplaceable];
  for (const { entry, dst, rel } of placed) {
    if (unplaceable.includes(rel)) continue;
    let state: Awaited<ReturnType<typeof fileState>>;
    try {
      state = await fileState(dst, entry);
    } catch {
      corrupt.push(rel);
      continue;
    }
    if (state === "missing") missing.push(rel);
    else if (state === "differs") corrupt.push(rel);
  }
  return {
    copied,
    alreadyPresent,
    setAside,
    missing,
    corrupt,
    ok: missing.length === 0 && corrupt.length === 0,
  };
}

/**
 * Restore one verified backup into `options.database`. Throws a BackupError
 * for every refusal or failure up to and including `pg_restore`; after that
 * the database IS restored and the result reports whether the originals were
 * re-verified (`ok`).
 */
export async function runRestore(options: RestoreOptions): Promise<RestoreResult> {
  const run = options.run ?? execFilePgToolRunner;
  const now = options.now ?? (() => new Date());
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 55432;
  const user = options.user ?? "postgres";
  const database = options.database;

  // 1. Verify BEFORE anything else: nothing below runs against a folder
  //    that does not re-hash to its own manifest.
  const report = await verifyBackup(options.source);
  if (!report.ok) {
    const detail = [
      ...report.missing.map((name) => `eksik: ${name}`),
      ...report.corrupt.map((name) => `bozulmuş: ${name}`),
    ]
      .slice(0, 10)
      .join("; ");
    throw new BackupError("VERIFY_FAILED", `${report.message}${detail !== "" ? ` (${detail})` : ""}`);
  }
  const manifest = await readManifest(options.source);
  const dumpFile = report.dumpFile;
  if (dumpFile === "" || dumpFile === "." || dumpFile === ".." || /[\\/]/u.test(dumpFile)) {
    throw new BackupError("VERIFY_FAILED", "Yedek bilgisindeki arşiv adı tanınmadı (yedek.json).");
  }

  // 2. Explicit confirmation — checked AFTER verification so a run without
  //    --yes still tells the lawyer whether the backup is sound.
  if (options.confirmed !== true) {
    throw new BackupError("RESTORE_NOT_CONFIRMED", RESTORE_NOT_CONFIRMED_MESSAGE_TR);
  }

  // 3. The target name reaches SQL; only a plain identifier is accepted.
  if (!RESTORE_DB_NAME_RE.test(database)) {
    throw new BackupError(
      "RESTORE_REFUSED",
      `Geri yükleme hedefi geçerli bir veritabanı adı değil: "${database.slice(0, 80)}"` +
        " (yalnız küçük harf, rakam ve alt çizgi). Hiçbir şey değişmedi.",
    );
  }

  // 3b. W21 (#24): the originals go into a folder that already exists, or
  //     the operator said to create it. Checked before any tool runs.
  const uploadsDir = path.resolve(options.uploadsDir);
  if (manifest.files.length > 0 && options.createUploadsDir !== true) {
    let isFolder = false;
    try {
      isFolder = (await stat(uploadsDir)).isDirectory();
    } catch {
      isFolder = false;
    }
    if (!isFolder) {
      throw new BackupError(
        "RESTORE_REFUSED",
        `Belge asıllarının konacağı klasör yok: ${uploadsDir}. Bu genellikle yanlış veri klasörü demektir` +
          " (COLLEX_DATA_DIR ayarlı değil ya da hizmetinkinden farklı). Hizmetin veri klasörünü verin" +
          " (Mac'te ~/.collex/collex.env); klasörü bilerek oluşturmak için --create-uploads-dir ekleyin." +
          " Hiçbir şey değişmedi.",
      );
    }
  }

  // 4. Every tool must exist before anything is touched.
  const pgDump = pgTool(options.pgBin, "pg_dump");
  const pgRestore = pgTool(options.pgBin, "pg_restore");
  const psql = pgTool(options.pgBin, "psql");
  for (const tool of [pgRestore, pgDump, psql]) {
    const probe = await run({ tool, args: ["--version"] });
    if (probe.code !== 0) {
      throw new BackupError(
        "PG_TOOLS_MISSING",
        `PostgreSQL aracı çalıştırılamadı (${path.basename(tool)}). Araçların klasörünü COLLEX_PGBIN` +
          " ile belirtin. Hiçbir şey değişmedi.",
      );
    }
  }

  // -w: never wait on a password prompt; a missing credential fails fast.
  const conn = ["-h", host, "-p", String(port), "-U", user, "-w"];
  const psqlArgs = (db: string, statement: string): string[] => [
    ...conn, "-d", db, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement,
  ];

  // 5. Is there a database to keep?
  const probe = await run({
    tool: psql,
    args: psqlArgs("postgres", `select 1 from pg_database where datname = '${database}'`),
  });
  if (probe.code !== 0) {
    throw new BackupError(
      "RESTORE_FAILED",
      `Veritabanı sunucusuna bağlanılamadı (${host}:${port}); PostgreSQL çalışıyor mu?` +
        ` Hiçbir şey değişmedi. ${stderrLine(probe)}`,
    );
  }
  const targetExists = probe.stdout.trim() === "1";

  const stamp = restoreStamp(now());
  let asideDatabase: string | null = null;
  let safetyDump: string | null = null;
  if (targetExists) {
    // 6. Safety net first: a restore is itself a risk.
    await mkdir(options.safetyDir, { recursive: true });
    safetyDump = path.join(options.safetyDir, `${database}_geri_yukleme_oncesi_${stamp}.dump`);
    const dumped = await run({ tool: pgDump, args: [...conn, "-d", database, "-Fc", "-f", safetyDump] });
    if (dumped.code !== 0) {
      throw new BackupError(
        "DUMP_FAILED",
        "Geri yükleme öncesi güvenlik yedeği alınamadı; geri yükleme YAPILMADI ve mevcut verinize" +
          ` dokunulmadı: ${stderrLine(dumped)}`,
      );
    }
    // 7. Keep the old database under another name. NEVER drop.
    asideDatabase = `${database}_eski_${stamp}`;
    const renamed = await run({
      tool: psql,
      args: psqlArgs("postgres", `alter database "${database}" rename to "${asideDatabase}"`),
    });
    if (renamed.code !== 0) {
      throw new BackupError(
        "RESTORE_FAILED",
        "Mevcut veritabanı kenara alınamadı (ColleX hâlâ açık olabilir; önce durdurun)." +
          ` Hiçbir veri silinmedi. Güvenlik yedeği: ${safetyDump}. ${stderrLine(renamed)}`,
      );
    }
  }

  const rollbackHint =
    asideDatabase !== null
      ? ` Eski veritabanınız ${asideDatabase} adıyla DURUYOR — veri kaybı yok. Geri almak için yarım` +
        ` kalan ${database} veritabanını elle kaldırıp ${asideDatabase} adını ${database} yapın.`
      : ` Yarım kalan ${database} veritabanını elle kaldırın.`;

  const created = await run({
    tool: psql,
    args: psqlArgs("postgres", `create database "${database}" template template0 encoding 'UTF8' locale 'C'`),
  });
  if (created.code !== 0) {
    throw new BackupError(
      "RESTORE_FAILED",
      `Boş veritabanı açılamadı: ${stderrLine(created)}.` +
        (asideDatabase !== null
          ? ` Eski veritabanınız ${asideDatabase} adıyla DURUYOR; geri almak için adını ${database} yapın.`
          : ""),
    );
  }

  // 8. All-or-nothing: a half-restored ledger is exactly the lie ENGRISK E3 names.
  const restored = await run({
    tool: pgRestore,
    args: [
      ...conn,
      "-d", database,
      "--no-owner", "--no-privileges", "--exit-on-error",
      path.join(options.source, dumpFile),
    ],
  });
  if (restored.code !== 0) {
    throw new BackupError("RESTORE_FAILED", `GERİ YÜKLEME BAŞARISIZ: ${stderrLine(restored)}.${rollbackHint}`);
  }

  // 9. Originals: merge, then re-verify in place.
  const uploads = await mergeUploads(options.source, manifest.files, uploadsDir, stamp);

  // 10. What came back (best effort; never fails the restore).
  const counted = await run({
    tool: psql,
    args: psqlArgs(
      database,
      "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema')",
    ),
  });
  const countText = counted.stdout.trim();
  const tables = counted.code === 0 && /^\d+$/u.test(countText) ? Number(countText) : null;

  // 11. W21 (#24): ask the RESTORED database which originals it names and
  //     look for each in the uploads folder. The manifest only proves what
  //     the backup held; "Aslını indir" serves what the database names.
  let named: string[] | null = null;
  let present: Set<string> | null = null;
  try {
    named = await storedOriginals({
      run,
      host,
      port,
      user,
      database,
      ...(options.pgBin !== undefined ? { pgBin: options.pgBin } : {}),
    });
    present = presentOriginals((await listUploadOriginals(uploadsDir)).files);
  } catch {
    // The database IS restored: an unreadable folder is reported, not thrown.
    present = null;
  }
  const originals: RestoreOriginalsCheck = {
    inDatabase: named === null ? null : named.length,
    notFound: named === null || present === null ? null : named.filter((sha) => !present!.has(sha)).length,
  };
  const originalsState: BackupOriginalsState = !uploads.ok
    ? "INCOMPLETE"
    : originals.notFound !== null && originals.notFound > 0
      ? "INCOMPLETE"
      : originals.inDatabase === null || originals.notFound === null
        ? "UNVERIFIED"
        : "COMPLETE";

  // W21 (#24): the message names the folder the originals were verified IN,
  // a backup with no originals never reads as "all originals verified", and
  // nothing but COMPLETE starts with "Geri yükleme tamam".
  const asideNote = asideDatabase !== null ? ` Eski veritabanı ${asideDatabase} adıyla duruyor.` : "";
  const fileCount = manifest.files.length;
  const atBackupTime = backupOriginalsWarningTr(manifest.originals, fileCount);
  let message: string;
  if (!uploads.ok) {
    message =
      `Veritabanı geri yüklendi AMA belge asıllarının bir kısmı doğrulanamadı (eksik: ${uploads.missing.length},` +
      ` uyuşmayan: ${uploads.corrupt.length}; klasör: ${uploadsDir}). Bu dosyaları yedek klasöründen elle kontrol edin.` +
      asideNote;
  } else if (originalsState === "INCOMPLETE") {
    message =
      `Veritabanı geri yüklendi AMA belge asılları EKSİK: geri yüklenen veritabanının andığı ${originals.inDatabase}` +
      ` belge aslından ${originals.notFound} tanesi ${uploadsDir} içinde yok — bu yedek onları içermiyor.` +
      ` Bu belgelerde "Aslını indir" çalışmaz; eksik asılları başka bir yedekten geri koyun.` +
      (fileCount > 0 ? ` Yedekteki ${fileCount} belge aslı yerinde doğrulandı.` : "") +
      asideNote;
  } else if (originalsState === "UNVERIFIED") {
    message =
      `Veritabanı geri yüklendi` +
      (fileCount > 0
        ? `; yedekteki ${fileCount} belge aslı ${uploadsDir} içinde yerinde doğrulandı`
        : `; bu yedek hiçbir belge aslı içermiyordu`) +
      `. AMA geri yüklenen veritabanının andığı belge asıllarının hepsinin ${uploadsDir} içinde olduğu` +
      " DENETLENEMEDİ (veritabanına sorulamadı ya da klasör okunamadı); geri yükleme eksiksiz sayılamaz." +
      (atBackupTime !== null ? ` Yedek alınırken: ${atBackupTime}` : "") +
      asideNote;
  } else if (fileCount === 0) {
    message =
      `Geri yükleme tamam: ${database} yedekten geri yüklendi. Bu yedek hiçbir belge aslı içermiyordu;` +
      (originals.inDatabase === 0
        ? ` geri yüklenen veritabanı da hiçbir belge aslı anmıyor (${uploadsDir} klasörüne belge aslı konmadı).`
        : ` geri yüklenen veritabanının andığı ${originals.inDatabase} belge aslı ${uploadsDir} içinde zaten bulunuyor.`);
  } else {
    message =
      `Geri yükleme tamam: ${database} yedekten geri yüklendi; ${fileCount} belge aslının` +
      ` tamamı ${uploadsDir} içinde yerinde doğrulandı` +
      (originals.inDatabase !== null && originals.inDatabase > 0
        ? ` ve geri yüklenen veritabanının andığı ${originals.inDatabase} belge aslının hepsi orada.`
        : ".");
  }

  return {
    database,
    uploadsDir,
    dumpFile,
    backupAt: manifest.at,
    asideDatabase,
    safetyDump,
    tables,
    uploads,
    originals,
    originalsState,
    ok: uploads.ok && originalsState === "COMPLETE",
    message,
  };
}
