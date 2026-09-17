/**
 * W21 §17: an operator hint names the launcher of the platform the server
 * RUNS on. On the Mac mini a message must never send the lawyer to a
 * Windows `.cmd` file or to `.venv/Scripts/python.exe`.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupNotConfiguredHintTr,
  databaseDownHintTr,
  databaseDownStartupTr,
  ensureDbCommandTr,
  operatorHints,
  operatorHintsPayload,
} from "../../src/platform/operatorHints.js";
import { describeDatabaseHealth } from "../../src/store/health.js";
import { STORE_UNAVAILABLE_MESSAGE } from "../../src/files/routes.js";
import { createApp } from "../../src/api/server.js";
import { createBackupRouter } from "../../src/backup/routes.js";

describe("operator hints follow the running platform", () => {
  it("Windows keeps the double-click launchers", () => {
    expect(operatorHints("win32")).toEqual({
      start: "ColleX-Baslat.cmd",
      // R2-36: the console names the stop script too.
      stop: "ColleX-Durdur.cmd",
      backup: "ColleX-Yedekle.cmd",
      restore: "ColleX-Geri-Yukle.cmd",
      python: ".venv/Scripts/python.exe",
    });
    expect(databaseDownHintTr("win32")).toContain("ColleX-Baslat.cmd");
  });

  it("macOS (and any POSIX host) gets the deploy/macos scripts and .venv/bin/python", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const hints = operatorHints(platform);
      expect(hints.start).toBe("deploy/macos/collex-start.sh");
      expect(hints.stop).toBe("deploy/macos/collex-stop.sh");
      expect(hints.backup).toBe("deploy/macos/collex-backup.sh");
      expect(hints.restore).toBe("deploy/macos/collex-restore.sh");
      expect(hints.python).toBe(".venv/bin/python");
      for (const sentence of [databaseDownHintTr(platform), backupNotConfiguredHintTr(platform), ensureDbCommandTr(platform)]) {
        expect(sentence).not.toMatch(/\.cmd\b|Scripts[\/]python/u);
      }
    }
  });

  it("the health sentence for a schema-less database uses the platform's interpreter", () => {
    const sentence = describeDatabaseHealth({ db: "missing", dbName: "collex_local" } as never);
    expect(sentence).toContain(ensureDbCommandTr());
    if (process.platform !== "win32") expect(sentence).not.toContain("Scripts/python.exe");
  });
});

describe("W21 round two R2-36: the server tells the console which platform's scripts to name", () => {
  it("serve.mjs's database-down line names the platform's launcher (Windows wording unchanged)", () => {
    expect(databaseDownStartupTr("collex_local", "win32")).toBe(
      "veritabanı: ÇALIŞMIYOR — ColleX-Baslat.cmd ile başlatın (collex_local @ yerel PostgreSQL 55432 cevap vermedi)",
    );
    const mac = databaseDownStartupTr("collex_local", "darwin");
    expect(mac).toContain("deploy/macos/collex-start.sh ile başlatın");
    expect(mac).not.toMatch(/\.cmd\b/u);
  });

  it("the deploy/macos scripts the hints name exist in the repository", () => {
    const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const hints = operatorHints("darwin");
    for (const script of [hints.start, hints.stop, hints.backup, hints.restore]) {
      expect(existsSync(join(repo, script)), script).toBe(true);
    }
    const win = operatorHints("win32");
    for (const script of [win.start, win.stop, win.backup, win.restore]) {
      expect(existsSync(join(repo, script)), script).toBe(true);
    }
  });

  it("/v1/health carries platform and operatorHints of the running process", async () => {
    const app = createApp({ serveConsole: false });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["platform"]).toBe(process.platform);
    expect(body["operatorHints"]).toEqual(operatorHints());
    expect(operatorHintsPayload("darwin")).toEqual({ platform: "darwin", operatorHints: operatorHints("darwin") });
  });

  it("GET /v1/backup carries the same names next to the last backup", async () => {
    const app = createBackupRouter({ backup: { run: () => Promise.reject(new Error("unused")), last: async () => null } });
    const res = await app.request("/v1/backup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ backup: null, platform: process.platform, operatorHints: operatorHints() });
  });
});

describe("the routers use the platform-aware hints", () => {
  it("the files router's store-down message names this platform's launcher", () => {
    expect(STORE_UNAVAILABLE_MESSAGE).toBe(databaseDownHintTr());
  });
});
