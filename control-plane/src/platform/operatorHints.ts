/**
 * Operator hints that name a launcher or an interpreter path — chosen by the
 * platform the server RUNS on, never hard-coded to Windows.
 *
 * W21 (§17 cross-platform): the application runtime must not depend on the
 * Windows helper scripts, and a message that tells a lawyer on the Mac mini
 * to "run ColleX-Baslat.cmd" or ".venv/Scripts/python.exe" points at files
 * that do not exist there. Every user-facing sentence that names such a
 * thing goes through this module, so the two platforms differ in ONE place.
 * The messages themselves stay where they are; only the names come from here.
 *
 * W21 round two (R2-36): the console is served by the same server, so
 * /v1/health and GET /v1/backup send `platform` and these hints; the console
 * builds its operator lines from them instead of hard-coding the Windows
 * names, and serve.mjs's start-up lines use them too.
 */

export interface OperatorHints {
  /** Starts PostgreSQL and the app (Windows: the double-click launcher). */
  readonly start: string;
  /** Stops the app gracefully. */
  readonly stop: string;
  /** Takes a backup by hand. */
  readonly backup: string;
  /** Restores a backup by hand. */
  readonly restore: string;
  /** The repository venv's Python, relative to the repo root. */
  readonly python: string;
}

const WINDOWS: OperatorHints = Object.freeze({
  start: "ColleX-Baslat.cmd",
  stop: "ColleX-Durdur.cmd",
  backup: "ColleX-Yedekle.cmd",
  restore: "ColleX-Geri-Yukle.cmd",
  python: ".venv/Scripts/python.exe",
});

const POSIX: OperatorHints = Object.freeze({
  start: "deploy/macos/collex-start.sh",
  stop: "deploy/macos/collex-stop.sh",
  backup: "deploy/macos/collex-backup.sh",
  restore: "deploy/macos/collex-restore.sh",
  python: ".venv/bin/python",
});

/** The hints for `platform` (default: the running process's platform). */
export function operatorHints(platform: NodeJS.Platform = process.platform): OperatorHints {
  return platform === "win32" ? WINDOWS : POSIX;
}

/** "PostgreSQL is not reachable; start it with <launcher>." */
export function databaseDownHintTr(platform: NodeJS.Platform = process.platform): string {
  return `Yerel veritabanına ulaşılamadı; ${operatorHints(platform).start} ile veritabanını başlatın.`;
}

/** "Backup is not configured on this server; use <script>." */
export function backupNotConfiguredHintTr(platform: NodeJS.Platform = process.platform): string {
  return `Yedekleme bu sunucuda yapılandırılmadı — ${operatorHints(platform).backup} dosyasını kullanın.`;
}

/** serve.mjs start-up line when PostgreSQL does not answer (R2-36). */
export function databaseDownStartupTr(dbName: string, platform: NodeJS.Platform = process.platform): string {
  return `veritabanı: ÇALIŞMIYOR — ${operatorHints(platform).start} ile başlatın (${dbName} @ yerel PostgreSQL 55432 cevap vermedi)`;
}

/** The launcher lines the console shows, as the server sends them (R2-36). */
export function operatorHintsPayload(platform: NodeJS.Platform = process.platform): {
  platform: NodeJS.Platform;
  operatorHints: OperatorHints;
} {
  return { platform, operatorHints: operatorHints(platform) };
}

/** The `--ensure-db` command line for this platform. */
export function ensureDbCommandTr(platform: NodeJS.Platform = process.platform): string {
  return `${operatorHints(platform).python} -m intake.cli --dsn <dsn> --ensure-db`;
}
