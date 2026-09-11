/**
 * REAL exporter round-trip: a draft composed by the TS composer (with a
 * bound source, a contrary decision and the ek-dogrulama section) is handed
 * to the repo venv's `python -m export.cli` for BOTH `dilekce-docx` and
 * `dilekce-udf`, exactly as the route does. Skips cleanly when the venv
 * interpreter is absent (never a silent pass — the skip is visible).
 *
 * Also proves the refusal path end to end: a tampered quote hash makes the
 * CLI exit 2 and leaves no file behind.
 */

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { composeDraft } from "../../src/drafting/composer.js";
import { createContractsRouter } from "../../src/contracts/routes.js";
import { EK_DOGRULAMA_SECTION_ID } from "../../src/drafting/types.js";
import { davaRequest, karsitEvidence, tckEvidence, tckPack } from "./fixtures.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PYTHON =
  process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
const HAVE_PYTHON = existsSync(PYTHON);

function runCli(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      PYTHON,
      ["-X", "utf8", "-m", "export.cli", ...args],
      { cwd: REPO_ROOT, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as unknown as { code: number }).code : 1;
        resolvePromise({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

describe("real export.cli round-trip (venv Python)", () => {
  it.skipIf(!HAVE_PYTHON)("exports a contract review through the real HTTP handler and Python process", async () => {
    const app = createContractsRouter({ repoRoot: REPO_ROOT, pythonPath: PYTHON });
    const response = await app.request("/v1/contracts/review/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentTitle: "Deneme sözleşmesi",
        text: "MADDE 1 - Kira bedeli aylık 100 TL'dir.\nMADDE 2 - Depozito alınır.",
        checklist: { id: "deneme", title: "Deneme kontrolü", items: [
          { id: "bedel", label: "Bedel", terms: ["kira bedeli"] },
          { id: "kefil", label: "Kefil", terms: ["kefil"] },
        ] },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("Inceleme Raporu.docx");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([80, 75, 3, 4]));
    expect(bytes.length).toBeGreaterThan(10_000);
  }, 60_000);
  it.skipIf(!HAVE_PYTHON)("writes DOCX and UDF for a composed draft, refuses a tampered one", async () => {
    const draft = composeDraft(
      davaRequest(),
      tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }, karsitEvidence()] }),
      { now: () => new Date("2026-09-02T09:00:00.000Z") },
    );
    expect(draft.sections[draft.sections.length - 1]?.id).toBe(EK_DOGRULAMA_SECTION_ID);

    const workDir = await mkdtemp(join(tmpdir(), "collex-real-export-"));
    try {
      const jsonPath = join(workDir, "taslak.json");
      await writeFile(jsonPath, JSON.stringify(draft), "utf8");

      const docxPath = join(workDir, "taslak.docx");
      const docx = await runCli(["--draft", jsonPath, "--out", docxPath, "--format", "dilekce-docx", "--quiet"]);
      expect(docx.code, docx.stderr).toBe(0);
      const docxBytes = await readFile(docxPath);
      expect(docxBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      expect((await stat(docxPath)).size).toBeGreaterThan(10_000);

      const udfPath = join(workDir, "taslak.udf");
      const udf = await runCli(["--draft", jsonPath, "--out", udfPath, "--format", "dilekce-udf"]);
      expect(udf.code, udf.stderr).toBe(0);
      expect(udf.stdout).toContain("DILEKCE-UDF yazıldı");
      expect(udf.stdout).toContain("deneysel");
      const udfBytes = await readFile(udfPath);
      expect(udfBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      // Tamper: the quote no longer hashes to its recorded digest -> exit 2, no file.
      const tampered = JSON.parse(JSON.stringify(draft)) as typeof draft;
      tampered.evidence[0]!.quote = `${tampered.evidence[0]!.quote} (değiştirildi)`;
      const badPath = join(workDir, "bozuk.json");
      await writeFile(badPath, JSON.stringify(tampered), "utf8");
      const refusedOut = join(workDir, "bozuk.udf");
      const refused = await runCli(["--draft", badPath, "--out", refusedOut, "--format", "dilekce-udf", "--quiet"]);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain("ALINTI_OZET_UYUSMAZLIGI");
      expect(existsSync(refusedOut)).toBe(false);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 180_000);

  it.skipIf(HAVE_PYTHON)("SKIPPED: repo venv interpreter not found — real export not exercised", () => {
    expect(HAVE_PYTHON).toBe(false);
  });
});
