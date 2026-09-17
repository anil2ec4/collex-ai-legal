/**
 * `/v1/backup` — the console's "Yedek al" button (W14 B-03).
 *
 * Two operations and nothing else:
 *
 *   POST /v1/backup           take a backup now (measured < 1 s on this
 *                             machine, so no progress channel is needed)
 *   GET  /v1/backup           what the last backup was, or null
 *
 * The route is mounted only when serve.mjs configured a backup port; without
 * one it is absent and the console renders its honest "yedek yapılandırılmadı"
 * card instead of a button that cannot work. Everything sits behind the B-04
 * loopback guard, so `POST /v1/backup` cannot be triggered by a foreign page.
 *
 * Concurrency: one backup at a time per process. A second POST while one is
 * running answers `409 BACKUP_IN_PROGRESS` rather than starting a second
 * `pg_dump` into a second folder.
 */

import { Hono } from "hono";
import type { BackupResult, BackupSummary } from "./runner.js";
import { backupNotConfiguredHintTr, operatorHintsPayload } from "../platform/operatorHints.js";

export interface BackupPort {
  /** Take a backup now. Rejects with a BackupError-shaped error on failure. */
  run(): Promise<BackupResult>;
  /** Newest complete backup, or null. Must never throw. */
  last(): Promise<BackupSummary | null>;
}

export const BACKUP_IN_PROGRESS_MESSAGE_TR =
  "Bir yedekleme zaten sürüyor; bitmesini bekleyin.";
export const BACKUP_UNAVAILABLE_MESSAGE_TR =
  backupNotConfiguredHintTr(); // W21: names the platform's own backup script

/** Turkish label for "no backup has ever been taken" (console + health). */
export const BACKUP_NEVER_MESSAGE_TR =
  "Henüz hiç yedek alınmadı — verileriniz tek bir diskte.";

export function createBackupRouter(deps: { backup: BackupPort }): Hono {
  const app = new Hono();
  let running: Promise<BackupResult> | null = null;

  app.get("/v1/backup", async (c) => {
    const last = await deps.backup.last().catch(() => null);
    // W21 round two (R2-36): the backup and restore scripts of the platform
    // this server runs on, so the card never names a Windows file on a Mac.
    return c.json({ backup: last, ...operatorHintsPayload() });
  });

  app.post("/v1/backup", async (c) => {
    if (running !== null) {
      return c.json(
        { error: { kind: "BACKUP_IN_PROGRESS", message: BACKUP_IN_PROGRESS_MESSAGE_TR } },
        409,
      );
    }
    running = deps.backup.run();
    try {
      const result = await running;
      return c.json(result, 200);
    } catch (err) {
      const kind =
        err !== null && typeof err === "object" && typeof (err as { kind?: unknown }).kind === "string"
          ? (err as { kind: string }).kind
          : "BACKUP_FAILED";
      const message = err instanceof Error ? err.message : "Yedekleme başarısız oldu.";
      return c.json({ error: { kind, message } }, 500);
    } finally {
      running = null;
    }
  });

  return app;
}
