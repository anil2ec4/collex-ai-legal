/**
 * W22 — "UYAP'tan indirdiğim klasörü dosyalarıma dağıt", REAL processes
 * (local only, guarded like real-exec.test.ts):
 *
 *   the SENTETİK download of tests/intake/uyap_fixtures.py is written to a
 *   temp folder → POST /v1/files/uyap-preview runs the REAL `intake.cli
 *   --uyap-scan` → the lawyer's confirmation goes to POST
 *   /v1/files/uyap-import → every confirmed document goes through the REAL
 *   `intake.cli --file` into `collex_intake_test` and is filed under its
 *   matter; the same download previewed again as ONE .zip says every
 *   document is already there.
 *
 * Originals go to a temp COLLEX_DATA_DIR, never into the repository. Every
 * document this suite creates is deleted at the end (and before the start,
 * in case an earlier run was interrupted). collex_local is never touched.
 * GUARD: without the venv or the scratch PostgreSQL the suite SKIPS.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../../src/api/server.js";
import { PostgresFilesStore } from "../../src/files/store.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DSN = "postgres://postgres@127.0.0.1:55432/collex_intake_test";

function venvPython(): string {
  return process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
}

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      venvPython(),
      ["-X", "utf8", ...args],
      { cwd: REPO_ROOT, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as unknown as { code: number }).code : 1;
        resolvePromise({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

let available = false;
if (existsSync(venvPython())) {
  const probe = await run(["-m", "intake.cli", "--dsn", DSN, "--ensure-db", "--list"]);
  available = probe.code === 0;
}

describe.skipIf(!available)("UYAP download → matters, real processes (collex_intake_test)", () => {
  let work = "";
  let download = "";
  let shas: Record<string, string> = {};
  const previousDataDir = process.env["COLLEX_DATA_DIR"];
  const store = available ? new PostgresFilesStore({ dsn: DSN }) : undefined;
  const matters = new InMemoryMatterStore();
  const ids: Record<string, string> = {};
  const app = available
    ? createApp({
        filesDsn: DSN,
        filesStore: store,
        matterStore: matters,
        python: { path: venvPython(), repoRoot: REPO_ROOT },
      })
    : undefined;

  const deleteAll = async (): Promise<void> => {
    for (const sha of new Set(Object.values(shas))) {
      await app!.request(`/v1/files/${sha.slice(0, 16)}`, { method: "DELETE" });
    }
  };

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "collex-uyap-real-"));
    process.env["COLLEX_DATA_DIR"] = join(work, "veri");
    download = join(work, "UYAP-indirilen");
    const generated = await run(["-m", "tests.intake.uyap_fixtures", download]);
    expect(generated.code).toBe(0);
    shas = (JSON.parse(generated.stdout) as { files: Record<string, string> }).files;
    await deleteAll();
    for (const [key, title, court, docketNo] of [
      ["M1", "Yılmaz / Örnek Lojistik — işçilik alacağı", "İstanbul Anadolu 5. İş Mahkemesi", "2024/123 E."],
      ["M2", "Beta Yapı / Gama İnşaat — alacak", "İstanbul 12. Asliye Ticaret Mahkemesi", "2023/456 Esas"],
      ["M3", "Kara / Deniz — tapu iptali", "İzmir 2. Asliye Hukuk Mahkemesi", "2024/500 E."],
      ["M4", "SGK tespit davası", "İzmir 4. Asliye Hukuk Mahkemesi", "E. 2024/500"],
    ] as const) {
      ids[key] = (await matters.create({ title, court, docketNo, kind: "dava" })).id;
    }
  }, 180_000);

  afterAll(async () => {
    await deleteAll();
    await store?.end();
    if (previousDataDir === undefined) delete process.env["COLLEX_DATA_DIR"];
    else process.env["COLLEX_DATA_DIR"] = previousDataDir;
    await rm(work, { recursive: true, force: true });
  });

  it(
    "reads the download, files the confirmed documents and says what it did",
    { timeout: 300_000 },
    async () => {
      // One document was already uploaded before the download arrived.
      const form = new FormData();
      const karar = await readFile(join(download, "Gerekçeli Karar.udf"));
      form.append("file", new File([karar], "Gerekçeli Karar.udf"), "Gerekçeli Karar.udf");
      expect((await app!.request("/v1/files", { method: "POST", body: form })).status).toBe(200);

      const previewRes = await app!.request("/v1/files/uyap-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: download }),
      });
      expect(previewRes.status).toBe(200);
      const preview = (await previewRes.json()) as {
        previewId: string;
        skipped: string[];
        rows: Array<Record<string, any>>;
        summary: Record<string, number>;
      };
      expect(preview.skipped).toEqual(["index.html"]);
      const rows = Object.fromEntries(preview.rows.map((r) => [r.path, r]));
      const decided = (p: string) => [rows[p]!.match.status, rows[p]!.proposedAction, rows[p]!.match.matterId];
      expect(decided("Tensip Zaptı.udf")).toEqual(["matched", "assign", ids.M1]);
      expect(decided("2024-123 E. Tebligat.pdf")).toEqual(["matched", "assign", ids.M1]);
      expect(decided("2024-124 Esas Duruşma Tutanağı.udf")).toEqual(["matched", "assign", ids.M1]);
      expect(decided("Bilirkişi Raporu.pdf")).toEqual(["matched", "assign", ids.M1]);
      expect(decided("ekler/Bilirkişi Raporu (kopya).pdf")).toEqual(["matched", "skip", ids.M1]);
      expect(decided("Gerekçeli Karar.udf")).toEqual(["matched", "skip", ids.M2]);
      expect(decided("Cevap Dilekçesi.udf")).toEqual(["unmatched", "new", null]);
      expect(decided("Müzekkere Cevabı.pdf")).toEqual(["matched", "assign", ids.M4]);
      expect(decided("2024-500 E. ek belge.txt")).toEqual(["ambiguous", "skip", null]);
      expect(decided("2024-123 E. taranmış evrak.pdf")).toEqual(["ambiguous", "skip", null]);
      expect(decided("Vekaletname.pdf")).toEqual(["no_esas", "skip", null]);
      expect(rows["Gerekçeli Karar.udf"]!.duplicate.fileId).toBe(shas["Gerekçeli Karar.udf"]!.slice(0, 16));
      expect(rows["Gerekçeli Karar.udf"]!.reading.karar.value).toBe("2025/88");
      expect(rows["2024-124 Esas Duruşma Tutanağı.udf"]!.reading.esasConflict).toBe(true);

      const confirm = preview.rows.map((row) =>
        row.path === "2024-500 E. ek belge.txt"
          ? { path: row.path, action: "assign", matterId: ids.M4 }
          : row.proposedAction === "assign"
            ? { path: row.path, action: "assign", matterId: row.match.matterId }
            : row.proposedAction === "new"
              ? { path: row.path, action: "new", newMatter: row.match.newMatter }
              : { path: row.path, action: "skip" },
      );
      const importRes = await app!.request("/v1/files/uyap-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewId: preview.previewId, rows: confirm }),
      });
      expect(importRes.status).toBe(200);
      const result = (await importRes.json()) as { sentence: string; rows: Array<Record<string, any>>; createdMatters: any[] };
      expect(result.sentence).toBe("11 belge: 7'si 3 dosyaya eklendi, 2'si zaten vardı, 2'si eşleşmedi.");

      // The documents really exist in the store, under the intake's own ids.
      const added = result.rows.filter((r) => r.outcome === "added");
      expect(added).toHaveLength(7);
      for (const row of added) expect(row.fileId).toBe(shas[row.path]!.slice(0, 16));
      const present = await store!.existingFileIds(added.map((r) => r.fileId));
      expect(present.sort()).toEqual(added.map((r) => r.fileId).sort());
      const filed = async (id: string) => (await matters.listItems(id)).filter((i) => i.kind === "file").length;
      expect(await filed(ids.M1!)).toBe(4);
      expect(await filed(ids.M4!)).toBe(2);
      expect(await filed(ids.M2!)).toBe(0);
      expect(await filed(result.createdMatters[0].matterId)).toBe(1);

      // The same download as ONE .zip: every document is now already there.
      const zipPath = join(work, "UYAP.zip");
      const zipped = await run([
        "-c",
        "import sys; from tests.intake.uyap_fixtures import zip_download; open(sys.argv[1], 'wb').write(zip_download())",
        zipPath,
      ]);
      expect(zipped.code).toBe(0);
      const zipBytes = await readFile(zipPath);
      const zipForm = new FormData();
      zipForm.append("file", new File([zipBytes], "UYAP.zip"), "UYAP.zip");
      const again = await app!.request("/v1/files/uyap-preview", { method: "POST", body: zipForm });
      expect(again.status).toBe(200);
      const againBody = (await again.json()) as { rows: Array<Record<string, any>>; source: { kind: string } };
      expect(againBody.source.kind).toBe("zip");
      const duplicated = againBody.rows.filter((r) => r.duplicate !== null).map((r) => r.path).sort();
      // (the copy carries the report's bytes, so it is already there too)
      expect(duplicated).toEqual(
        [...added.map((r) => r.path), "Gerekçeli Karar.udf", "ekler/Bilirkişi Raporu (kopya).pdf"].sort(),
      );
      expect(againBody.rows.every((r) => r.proposedAction === "skip")).toBe(true);
    },
  );
});
