/**
 * REAL-exec integration proof (local only, guarded):
 *
 *   1. the real fixture evals/fixtures/uploads/dilekce_ornek.docx goes
 *      through app.request() -> the REAL venv Python intake CLI -> the local
 *      scratch database `collex_intake_test` (created via --ensure-db;
 *      collex_local is NEVER touched by tests), list/detail read back over
 *      real SQL, then DELETE removes everything (204);
 *   2. a matter-only dava dilekçesi exports to DOCX through the REAL Python
 *      exporter (export.cli) and the bytes are a genuine ZIP container (PK).
 *
 * GUARD: when the scratch PostgreSQL (127.0.0.1:55432) or the repo venv is
 * unavailable, the whole suite SKIPS cleanly (it never fails a machine that
 * cannot run it). Everything here is loopback-local: no network beyond
 * 127.0.0.1, no provider call, no `.env`.
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../../src/api/server.js";
import { PostgresFilesStore } from "../../src/files/store.js";
import type { Draft } from "../../src/drafting/types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DSN = "postgres://postgres@127.0.0.1:55432/collex_intake_test";
const FIXTURE = join(REPO_ROOT, "evals", "fixtures", "uploads", "dilekce_ornek.docx");

function venvPython(): string {
  return process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
}

/** Run the intake CLI once; the probe that decides whether this suite runs. */
function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      venvPython(),
      ["-X", "utf8", "-m", "intake.cli", ...args],
      { cwd: REPO_ROOT, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
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
}

// Availability probe at collection time: venv python present AND the scratch
// database reachable (--ensure-db also creates collex_intake_test + applies
// the non-pgvector migrations when absent — create-only, never drops).
let available = false;
if (existsSync(venvPython()) && existsSync(FIXTURE)) {
  const probe = await runCli(["--dsn", DSN, "--ensure-db", "--list"]);
  available = probe.code === 0;
}

describe.skipIf(!available)("real-exec integration (collex_intake_test)", () => {
  const store = available ? new PostgresFilesStore({ dsn: DSN }) : undefined;
  const app = available
    ? createApp({
        filesDsn: DSN,
        filesStore: store,
        python: { path: venvPython(), repoRoot: REPO_ROOT },
      })
    : undefined;

  afterAll(async () => {
    await store?.end();
  });

  it(
    "uploads the real DOCX fixture end-to-end, reads it back, deletes it",
    { timeout: 120_000 },
    async () => {
      const bytes = await readFile(FIXTURE);
      const form = new FormData();
      form.append("file", new File([bytes], "dilekce_ornek.docx"), "dilekce_ornek.docx");

      const uploaded = await app!.request("/v1/files", { method: "POST", body: form });
      expect(uploaded.status).toBe(200);
      const body = (await uploaded.json()) as {
        fileId: string;
        kind: string;
        sha256: string;
        extraction: { chars: number; chunkCount: number; ocr: boolean };
        analysis: { parties: Array<{ name: string }> };
      };
      expect(body.kind).toBe("docx");
      expect(body.fileId).toBe(body.sha256.slice(0, 16));
      expect(body.extraction.chars).toBeGreaterThan(0);
      expect(body.extraction.chunkCount).toBeGreaterThan(0);
      expect(body.analysis.parties.map((p) => p.name)).toContain("Ayşe Yılmaz");

      try {
        // Real SQL reads through the mounted store.
        const listed = await app!.request("/v1/files");
        expect(listed.status).toBe(200);
        const files = ((await listed.json()) as { files: Array<{ fileId: string }> }).files;
        expect(files.some((f) => f.fileId === body.fileId)).toBe(true);

        const detail = await app!.request(`/v1/files/${body.fileId}`);
        expect(detail.status).toBe(200);
        const detailBody = (await detail.json()) as {
          analysis: { parties: Array<{ name: string }> };
          chunks: Array<{ preview: string }>;
        };
        expect(detailBody.analysis.parties.map((p) => p.name)).toContain("Ayşe Yılmaz");
        expect(detailBody.chunks.length).toBeGreaterThan(0);
      } finally {
        // DELETE must remove the document even when an assertion failed —
        // the scratch database stays reusable across runs either way.
        const deleted = await app!.request(`/v1/files/${body.fileId}`, { method: "DELETE" });
        expect(deleted.status).toBe(204);
      }

      const gone = await app!.request(`/v1/files/${body.fileId}`);
      expect(gone.status).toBe(404);
    },
  );

  it(
    "exports a draft DOCX through the REAL Python exporter (PK container)",
    { timeout: 120_000 },
    async () => {
      const created = await app!.request("/v1/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "dilekce",
          template: "dava-dilekcesi",
          matter: {
            baslik: "İSTANBUL NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE",
            taraflar: [
              { ad: "Ayşe Yılmaz", rol: "Davacı" },
              { ad: "Veli Kaya", rol: "Davalı" },
            ],
            olaylar: [{ tarih: "2025-03-10", metin: "Sentetik bir görüşme yapılmıştır." }],
            talepler: ["Sentetik alacağın tahsiline karar verilmesi"],
          },
        }),
      });
      expect(created.status).toBe(200);
      const draft = (await created.json()) as Draft;

      const exported = await app!.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
      expect(exported.status).toBe(200);
      expect(exported.headers.get("content-type")).toContain("wordprocessingml");
      const bytes = Buffer.from(await exported.arrayBuffer());
      // A real DOCX is a ZIP container: PK\x03\x04 magic, non-trivial size.
      expect(bytes.length).toBeGreaterThan(1000);
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    },
  );
});

// When the environment cannot run the suite, prove the guard is honest: one
// always-running assertion that documents WHY it was skipped.
describe.skipIf(available)("real-exec integration (environment unavailable)", () => {
  it("skips cleanly: venv python or scratch PostgreSQL missing", () => {
    expect(available).toBe(false);
  });
});
