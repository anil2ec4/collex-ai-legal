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
 * - `robocopy /E` MERGES originals; it never deletes. An incomplete backup
 *   must not be able to remove files that are still on disk.
 *
 * WHAT IS DELIBERATELY NOT BUILT (ENGRISK §3.5): PITR / WAL archiving,
 * `pg_basebackup`, an automatic scheduled task, and encryption. The folder
 * carries client data and both the script and the UI say so: it belongs on
 * an encrypted disk.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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

/** Shown next to every backup, in the console and in the .cmd output. */
export const BACKUP_CLIENT_DATA_WARNING_TR =
  "Bu klasör müvekkil verisi içerir — şifreli bir diske veya BitLocker'lı bir klasöre koyun.";

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
}

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
}

export interface BackupSummary {
  path: string;
  lastAt: string;
  sizeBytes: number;
  files: number;
  /** True when the newest backup is older than BACKUP_STALE_AFTER_DAYS. */
  stale: boolean;
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
  /** Turkish one-liner for the console / the .cmd. */
  message: string;
}

export type BackupErrorKind = "PG_TOOLS_MISSING" | "DUMP_FAILED" | "COPY_FAILED" | "VERIFY_FAILED";

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
  const names = await listFilesRecursive(options.uploadsDir);
  const files: BackupFileEntry[] = [];
  for (const rel of names) {
    const src = path.join(options.uploadsDir, ...rel.split("/"));
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
  };
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
  return {
    ok,
    at: manifest.at,
    database: manifest.database,
    dumpFile: manifest.dump.path,
    checked: entries.length,
    missing,
    corrupt,
    message: ok
      ? `Yedek doğrulandı: ${entries.length} dosyanın tamamı eksiksiz.`
      : `Yedek BOZUK — eksik: ${missing.length}, bozulmuş: ${corrupt.length}.` +
        " Bu yedekle geri yükleme yapmayın.",
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
      return {
        path: dir,
        lastAt: manifest.at,
        sizeBytes: manifest.totalBytes,
        files: manifest.files.length,
        stale: Number.isFinite(ageMs) && ageMs > BACKUP_STALE_AFTER_DAYS * 24 * 3600 * 1000,
      };
    } catch {
      // An incomplete or foreign folder is skipped, not reported as the last
      // backup: telling the lawyer "backed up" about a folder with no
      // manifest is the worst possible lie in this module.
    }
  }
  return null;
}
