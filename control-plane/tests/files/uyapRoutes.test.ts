/**
 * W22 — POST /v1/files/uyap-preview and /v1/files/uyap-import (offline).
 *
 * The intake CLI is a fake that records its argument vectors; the documents
 * are REAL files on disk, so the import's re-hash before ingest is the real
 * check. Readings are handed in the shape `intake/uyap.py` prints (its own
 * tests pin how they are read; the real-process suite runs both together).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MatterLinker } from "../../src/api/matterLink.js";
import { createApp } from "../../src/api/server.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import { createFilesRouter, intakeFileArgs, type IntakeExec, type IntakeExecRequest } from "../../src/files/routes.js";
import type { FileListEntry, FilesReadStore } from "../../src/files/store.js";
import type { UyapField, UyapReading, UyapScanDocument } from "../../src/files/uyapMatch.js";
import { UYAP_MESSAGES_TR, UYAP_SCAN_TIMEOUT_MS, safeRelativeUploadPath } from "../../src/files/uyapRoutes.js";

const DSN = "postgres://postgres@127.0.0.1:55432/collex_fake_test";

function sha(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function f(value: string, source: "content" | "filename" = "content"): UyapField {
  return { value, quote: value, start: 0, end: value.length, source };
}

function reading(over: Partial<UyapReading> = {}): UyapReading {
  return {
    readerVersion: "uyap-okuma-v1",
    textRead: true,
    court: null,
    esas: null,
    karar: null,
    documentType: null,
    documentDate: null,
    filename: { esas: null, documentType: null },
    esasConflict: false,
    ...over,
  };
}

const ANADOLU = "İSTANBUL ANADOLU 5. İŞ MAHKEMESİ";

/** The download: path -> [bytes, reading, error]. */
function downloadSpec(): Array<[string, string, UyapReading, UyapScanDocument["error"]]> {
  return [
    ["Tensip Zaptı.udf", "tensip", reading({ court: f(ANADOLU), esas: f("2024/123") }), null],
    ["2024-123 E. Tebligat.pdf", "tebligat", reading({ court: f(ANADOLU), esas: f("2024/123", "filename") }), null],
    [
      "2024-124 Esas Duruşma Tutanağı.udf",
      "durusma",
      reading({
        court: f(ANADOLU),
        esas: f("2024/123"),
        filename: { esas: f("2024/124", "filename"), documentType: null },
        esasConflict: true,
      }),
      null,
    ],
    ["Bilirkişi Raporu.pdf", "bilirkisi", reading({ court: f(ANADOLU), esas: f("2024/123") }), null],
    ["ekler/Bilirkişi Raporu (kopya).pdf", "bilirkisi", reading({ court: f(ANADOLU), esas: f("2024/123") }), null],
    ["Gerekçeli Karar.udf", "gerekceli", reading({ court: f("İSTANBUL 12. ASLİYE TİCARET MAHKEMESİ"), esas: f("2023/456") }), null],
    ["Cevap Dilekçesi.udf", "cevap", reading({ court: f("ANKARA 3. İŞ MAHKEMESİ"), esas: f("2025/77") }), null],
    ["Müzekkere Cevabı.pdf", "muzekkere", reading({ court: f("İZMİR 4. ASLİYE HUKUK MAHKEMESİ"), esas: f("2024/500") }), null],
    ["2024-500 E. ek belge.txt", "ek", reading({ esas: f("2024/500", "filename") }), null],
    [
      "2024-123 E. taranmış evrak.pdf",
      "tarama",
      reading({ textRead: false, esas: f("2024/123", "filename") }),
      { kind: "EXTRACTION_FAILED", message: "taranmış PDF — OCR bu modda devre dışı" },
    ],
    ["Vekaletname.pdf", "vekalet", reading(), null],
  ];
}

interface Harness {
  root: string;
  app: ReturnType<typeof createFilesRouter>;
  calls: IntakeExecRequest[];
  matters: InMemoryMatterStore;
  ids: Record<string, string>;
  shaOf: Record<string, string>;
  failFile?: string;
}

let workDirs: string[] = [];

afterEach(async () => {
  for (const dir of workDirs) await rm(dir, { recursive: true, force: true });
  workDirs = [];
});

async function harness(options: {
  existing?: string[];
  storeThrows?: boolean;
  failFile?: string;
  scanOverride?: (request: IntakeExecRequest) => Record<string, unknown> | undefined;
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "uyap-test-"));
  workDirs.push(root);
  const shaOf: Record<string, string> = {};
  const documents: UyapScanDocument[] = [];
  for (const [path, body, read, error] of downloadSpec()) {
    const bytes = Buffer.from(`SENTETİK ${body}`, "utf8");
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), bytes);
    shaOf[path] = sha(bytes);
    documents.push({
      path,
      name: basename(path),
      sizeBytes: bytes.length,
      sha256: sha(bytes),
      kind: path.slice(path.lastIndexOf(".") + 1),
      error,
      warnings: [],
      reading: read,
    });
  }
  const existingShas = new Set((options.existing ?? []).map((p) => shaOf[p] as string));
  const entries: FileListEntry[] = [...existingShas].map((s) => ({
    fileId: s.slice(0, 16),
    name: "önceden-yüklenen.udf",
    mime: "application/vnd.uyap.udf",
    sha256: s,
    kind: "udf",
    uploadedAt: "2026-09-01T10:00:00.000Z",
    chars: 100,
    chunkCount: 1,
  }));
  const store: FilesReadStore = {
    listFiles: async () => {
      if (options.storeThrows === true) throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
      return entries;
    },
    showFile: async () => undefined,
    getChunks: async () => [],
    existingFileIds: async (ids) => {
      if (options.storeThrows === true) throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
      return ids.filter((id) => entries.some((e) => e.fileId === id));
    },
    originalRef: async (fileId) => {
      const e = entries.find((x) => x.fileId === fileId);
      return e === undefined ? undefined : { sha256: e.sha256, kind: e.kind, name: e.name, mime: e.mime };
    },
    fileMatterLinks: async () => new Map([[[...existingShas][0]?.slice(0, 16) ?? "", { matterId: "x", matterTitle: "Beta / Gama" }]]),
  } as FilesReadStore;

  const calls: IntakeExecRequest[] = [];
  const exec: IntakeExec = async (request) => {
    calls.push(request);
    const scanAt = request.args.indexOf("--uyap-scan");
    if (scanAt >= 0) {
      const override = options.scanOverride?.(request);
      const scan = override ?? {
        readerVersion: "uyap-okuma-v1",
        container: "dir",
        root,
        total: documents.length,
        skipped: ["index.html"],
        documents,
      };
      return { code: 0, stdout: JSON.stringify({ uyapScan: scan }), stderr: "" };
    }
    const fileAt = request.args.indexOf("--file");
    const path = request.args[fileAt + 1] as string;
    if (options.failFile !== undefined && path.endsWith(options.failFile)) {
      return {
        code: 2,
        stdout: JSON.stringify({ error: { kind: "EXTRACTION_FAILED", message: "taranmış PDF — OCR bu modda devre dışı" } }),
        stderr: "Traceback: gizli yol",
      };
    }
    const bytes = readFileSync(path);
    const digest = sha(bytes);
    return {
      code: 0,
      stdout: JSON.stringify({
        fileId: digest.slice(0, 16),
        name: basename(path),
        mime: "application/pdf",
        sha256: digest,
        sizeBytes: bytes.length,
        kind: "pdf",
        extraction: { chars: 10, chunkCount: 1, ocr: false },
        analysis: { parties: [], references: [], dates: [], claims: [] },
        warnings: [],
        action: "created",
      }),
      stderr: "",
    };
  };

  const matters = new InMemoryMatterStore();
  const ids: Record<string, string> = {};
  for (const [key, title, court, docketNo] of [
    ["M1", "Yılmaz / Örnek Lojistik", "İstanbul Anadolu 5. İş Mahkemesi", "2024/123 E."],
    ["M2", "Beta / Gama", "İstanbul 12. Asliye Ticaret Mahkemesi", "2023/456 Esas"],
    ["M3", "Kara / Deniz", "İzmir 2. Asliye Hukuk Mahkemesi", "2024/500 E."],
    ["M4", "SGK tespit", "İzmir 4. Asliye Hukuk Mahkemesi", "E. 2024/500"],
  ] as const) {
    ids[key] = (await matters.create({ title, court, docketNo, kind: "dava" })).id;
  }
  const app = createFilesRouter({
    dsn: DSN,
    store,
    exec,
    pythonPath: "/fake/venv/python",
    repoRoot: "/fake/repo",
    log: () => {},
    uyap: { matters, linker: new MatterLinker(matters, () => {}), stagingRoot: root },
  });
  return { root, app, calls, matters, ids, shaOf };
}

async function preview(h: Harness): Promise<{ status: number; body: Record<string, any> }> {
  const res = await h.app.request("/v1/files/uyap-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dir: h.root }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function importRows(h: Harness, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const res = await h.app.request("/v1/files/uyap-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** The confirmation the console sends when the lawyer accepts every proposal. */
function acceptProposals(rows: Array<Record<string, any>>): Array<Record<string, unknown>> {
  return rows.map((row) =>
    row.proposedAction === "assign"
      ? { path: row.path, action: "assign", matterId: row.match.matterId }
      : row.proposedAction === "new"
        ? { path: row.path, action: "new", newMatter: row.match.newMatter }
        : { path: row.path, action: "skip" },
  );
}

describe("POST /v1/files/uyap-preview", () => {
  it("reads the folder, matches every document and ingests nothing", async () => {
    const h = await harness({ existing: ["Gerekçeli Karar.udf"] });
    const { status, body } = await preview(h);
    expect(status).toBe(200);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.args).toEqual(["-X", "utf8", "-m", "intake.cli", "--dsn", DSN, "--uyap-scan", h.root, "--json"]);
    expect(h.calls[0]!.timeoutMs).toBe(UYAP_SCAN_TIMEOUT_MS);
    expect(h.calls.some((c) => c.args.includes("--file"))).toBe(false);

    const rows = Object.fromEntries((body.rows as Array<Record<string, any>>).map((r) => [r.path, r]));
    const status_ = (p: string) => [rows[p].match.status, rows[p].proposedAction, rows[p].match.matterId];
    expect(status_("Tensip Zaptı.udf")).toEqual(["matched", "assign", h.ids.M1]);
    expect(status_("2024-123 E. Tebligat.pdf")).toEqual(["matched", "assign", h.ids.M1]);
    expect(status_("2024-124 Esas Duruşma Tutanağı.udf")).toEqual(["matched", "assign", h.ids.M1]);
    expect(status_("Bilirkişi Raporu.pdf")).toEqual(["matched", "assign", h.ids.M1]);
    expect(status_("ekler/Bilirkişi Raporu (kopya).pdf")).toEqual(["matched", "skip", h.ids.M1]);
    expect(status_("Gerekçeli Karar.udf")).toEqual(["matched", "skip", h.ids.M2]);
    expect(status_("Cevap Dilekçesi.udf")).toEqual(["unmatched", "new", null]);
    expect(status_("Müzekkere Cevabı.pdf")).toEqual(["matched", "assign", h.ids.M4]);
    expect(status_("2024-500 E. ek belge.txt")).toEqual(["ambiguous", "skip", null]);
    expect(status_("2024-123 E. taranmış evrak.pdf")).toEqual(["ambiguous", "skip", null]);
    expect(status_("Vekaletname.pdf")).toEqual(["no_esas", "skip", null]);

    // The two same-esas matters are both listed for the name-only row.
    expect(rows["2024-500 E. ek belge.txt"].match.candidates.map((c: any) => c.matterId)).toEqual([h.ids.M3, h.ids.M4]);
    // Conflict: content wins, both shown.
    expect(rows["2024-124 Esas Duruşma Tutanağı.udf"].notes[0]).toBe(
      "Dosya adındaki esas numarası (2024/124) ile belgenin içindeki (2024/123) farklı; belgenin içindeki esas numarası kullanıldı.",
    );
    expect(rows["2024-123 E. Tebligat.pdf"].notes).toContain("Esas numarası belgenin içinde bulunamadı; dosya adından okundu.");
    // Duplicates: by sha256, with the reason.
    expect(rows["Gerekçeli Karar.udf"].duplicate).toEqual({
      fileId: h.shaOf["Gerekçeli Karar.udf"]!.slice(0, 16),
      name: "önceden-yüklenen.udf",
      matterId: "x",
      matterTitle: "Beta / Gama",
    });
    expect(rows["ekler/Bilirkişi Raporu (kopya).pdf"].duplicateInBatchOf).toBe("Bilirkişi Raporu.pdf");
    expect(rows["2024-123 E. taranmış evrak.pdf"].importable).toBe(true);
    expect(rows["2024-123 E. taranmış evrak.pdf"].notes).toContain(UYAP_MESSAGES_TR.scanFailedFor);
    expect(rows["Cevap Dilekçesi.udf"].match.newMatter).toEqual({
      title: "Ankara 3. İş Mahkemesi 2025/77 E.",
      court: "Ankara 3. İş Mahkemesi",
      docketNo: "2025/77 E.",
    });
    expect(body.skipped).toEqual(["index.html"]);
    expect(body.summary).toEqual({
      total: 11, matched: 7, ambiguous: 2, unmatched: 1, noEsas: 1, duplicates: 2, unreadable: 1, esasConflicts: 1,
    });
  });

  it("refuses a relative folder, a stray field and an empty body with typed 400s", async () => {
    const h = await harness();
    const rel = await h.app.request("/v1/files/uyap-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: "UYAP/indirilen" }),
    });
    expect(rel.status).toBe(400);
    expect(((await rel.json()) as any).error.issues[0].path).toBe("dir");
    const stray = await h.app.request("/v1/files/uyap-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: h.root, bogus: 1 }),
    });
    expect(stray.status).toBe(400);
    expect(((await stray.json()) as any).error.issues.map((i: any) => i.path)).toEqual(["bogus"]);
    const empty = await h.app.request("/v1/files/uyap-preview", { method: "POST", body: new FormData() });
    expect(empty.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("does not claim 'no duplicates' when the upload store cannot answer", async () => {
    const h = await harness({ storeThrows: true });
    const { status, body } = await preview(h);
    expect(status).toBe(503);
    expect(body.error.message).toBe(UYAP_MESSAGES_TR.duplicatesUnknown);
  });

  it("a .zip is staged and handed to the scan with its own staging folder", async () => {
    let staged: string[] = [];
    const h = await harness({
      scanOverride: (request) => {
        const target = request.args[request.args.indexOf("--uyap-scan") + 1] as string;
        staged = [target, request.args[request.args.indexOf("--stage-dir") + 1] as string];
        expect(existsSync(target)).toBe(true);
        return undefined;
      },
    });
    const form = new FormData();
    form.append("file", new File([Buffer.from("PK\u0003\u0004 sahte")], "UYAP Dosyası.zip"), "UYAP Dosyası.zip");
    const res = await h.app.request("/v1/files/uyap-preview", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(basename(staged[0]!)).toBe("UYAP Dosyası.zip");
    expect(basename(staged[1]!)).toBe("belgeler");
    expect(((await res.json()) as any).source).toEqual({ kind: "zip", label: "UYAP Dosyası.zip" });
  });

  it("a .zip must travel alone", async () => {
    const h = await harness();
    const form = new FormData();
    form.append("file", new File(["a"], "a.zip"), "a.zip");
    form.append("file", new File(["b"], "b.pdf"), "b.pdf");
    const res = await h.app.request("/v1/files/uyap-preview", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toBe(UYAP_MESSAGES_TR.zipAlone);
    expect(h.calls).toHaveLength(0);
  });

  it("a folder's files keep their relative paths and can never climb out of staging", async () => {
    let listing: string[] = [];
    const h = await harness({
      scanOverride: (request) => {
        const target = request.args[request.args.indexOf("--uyap-scan") + 1] as string;
        const walk = (dir: string, prefix = ""): string[] =>
          readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
            d.isDirectory() ? walk(join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`],
          );
        listing = walk(target);
        return undefined;
      },
    });
    const form = new FormData();
    form.append("file", new File(["1"], "x"), "UYAP/ekler/rapor.pdf");
    form.append("file", new File(["2"], "x"), "../../../etc/passwd.pdf");
    form.append("file", new File(["3"], "x"), "UYAP/ekler/rapor.pdf");
    const res = await h.app.request("/v1/files/uyap-preview", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(listing.sort()).toEqual(["003/UYAP/ekler/rapor.pdf", "UYAP/ekler/rapor.pdf", "etc/passwd.pdf"].sort());
    expect(safeRelativeUploadPath("..\\..\\a:b.pdf")).toBe("a_b.pdf");
    expect(await readdir(h.root)).toContain("Tensip Zaptı.udf");
  });
});

describe("POST /v1/files/uyap-import", () => {
  it("ingests only confirmed rows through the single intake path and files them", async () => {
    const h = await harness({ existing: ["Gerekçeli Karar.udf"] });
    const { body: pv } = await preview(h);
    const rows = acceptProposals(pv.rows);
    // The lawyer resolves the ambiguous name-only row by hand.
    const ek = rows.find((r) => r.path === "2024-500 E. ek belge.txt")!;
    Object.assign(ek, { action: "assign", matterId: h.ids.M4 });
    const { status, body } = await importRows(h, { previewId: pv.previewId, rows });
    expect(status).toBe(200);
    expect(body.sentence).toBe("11 belge: 7'si 3 dosyaya eklendi, 2'si zaten vardı, 2'si eşleşmedi.");
    expect(body.summary).toEqual({ total: 11, added: 7, matters: 3, duplicates: 2, unmatched: 2, skipped: 0, failed: 0 });

    // Exactly the seven confirmed, non-duplicate documents met the intake —
    // in preview order, with the SAME argv POST /v1/files builds.
    const fileCalls = h.calls.filter((c) => c.args.includes("--file"));
    expect(fileCalls.map((c) => c.args)).toEqual(
      [
        "Tensip Zaptı.udf",
        "2024-123 E. Tebligat.pdf",
        "2024-124 Esas Duruşma Tutanağı.udf",
        "Bilirkişi Raporu.pdf",
        "Cevap Dilekçesi.udf",
        "Müzekkere Cevabı.pdf",
        "2024-500 E. ek belge.txt",
      ]
        .map((p) => intakeFileArgs(DSN, join(h.root, p))),
    );
    for (const call of fileCalls) expect(call.timeoutMs).toBeUndefined();

    const filed = async (id: string) =>
      (await h.matters.listItems(id)).filter((i) => i.kind === "file").map((i) => i.payload["fileName"]).sort();
    expect(await filed(h.ids.M1!)).toEqual(
      ["2024-123 E. Tebligat.pdf", "2024-124 Esas Duruşma Tutanağı.udf", "Bilirkişi Raporu.pdf", "Tensip Zaptı.udf"].sort(),
    );
    expect(await filed(h.ids.M4!)).toEqual(["2024-500 E. ek belge.txt", "Müzekkere Cevabı.pdf"]);
    expect(await filed(h.ids.M3!)).toEqual([]);
    expect(await filed(h.ids.M2!)).toEqual([]); // skipped duplicate: nothing linked
    expect(body.createdMatters).toHaveLength(1);
    const created = body.createdMatters[0];
    expect(created).toMatchObject({ title: "Ankara 3. İş Mahkemesi 2025/77 E.", court: "Ankara 3. İş Mahkemesi", docketNo: "2025/77 E." });
    expect(await filed(created.matterId)).toEqual(["Cevap Dilekçesi.udf"]);

    const out = Object.fromEntries((body.rows as Array<Record<string, any>>).map((r) => [r.path, r]));
    expect(out["ekler/Bilirkişi Raporu (kopya).pdf"]).toMatchObject({ outcome: "duplicate", reason: UYAP_MESSAGES_TR.duplicateSkipped });
    expect(out["Gerekçeli Karar.udf"]).toMatchObject({ outcome: "duplicate" });
    expect(out["Vekaletname.pdf"]).toMatchObject({ outcome: "unmatched", reason: UYAP_MESSAGES_TR.unmatchedSkipped });
    expect(out["Tensip Zaptı.udf"]).toMatchObject({ outcome: "added", matterId: h.ids.M1, reason: "“Yılmaz / Örnek Lojistik” dosyasına eklendi." });
  });

  it("a duplicate assigned by the lawyer is linked, never ingested again", async () => {
    const h = await harness({ existing: ["Gerekçeli Karar.udf"] });
    const { body: pv } = await preview(h);
    const { body } = await importRows(h, {
      previewId: pv.previewId,
      rows: [{ path: "Gerekçeli Karar.udf", action: "assign", matterId: h.ids.M2 }],
    });
    expect(h.calls.filter((c) => c.args.includes("--file"))).toHaveLength(0);
    expect(body.rows.find((r: any) => r.path === "Gerekçeli Karar.udf")).toMatchObject({
      outcome: "duplicate",
      reason: "Bu belge zaten yüklüydü; yeniden yüklenmedi, “Beta / Gama” dosyasına bağlandı.",
    });
    expect((await h.matters.listItems(h.ids.M2!)).map((i) => i.refId)).toEqual([h.shaOf["Gerekçeli Karar.udf"]!.slice(0, 16)]);
    // Rows the request did not name are skipped, never assigned.
    expect(body.summary.added).toBe(0);
  });

  it("an ambiguous row is never filed unless the lawyer names the matter", async () => {
    const h = await harness();
    const { body: pv } = await preview(h);
    const { body } = await importRows(h, { previewId: pv.previewId, rows: acceptProposals(pv.rows) });
    expect(body.rows.find((r: any) => r.path === "2024-500 E. ek belge.txt").outcome).toBe("unmatched");
    expect((await h.matters.listItems(h.ids.M3!))).toEqual([]);
  });

  it("a document changed after the preview is refused and never ingested", async () => {
    const h = await harness();
    const { body: pv } = await preview(h);
    await writeFile(join(h.root, "Tensip Zaptı.udf"), "başka bayt");
    const { body } = await importRows(h, {
      previewId: pv.previewId,
      rows: [{ path: "Tensip Zaptı.udf", action: "assign", matterId: h.ids.M1 }],
    });
    expect(body.rows.find((r: any) => r.path === "Tensip Zaptı.udf")).toMatchObject({
      outcome: "failed",
      error: { kind: "CHANGED_SINCE_PREVIEW" },
    });
    expect(h.calls.filter((c) => c.args.includes("--file"))).toHaveLength(0);
    expect(await h.matters.listItems(h.ids.M1!)).toEqual([]);
  });

  it("a typed intake failure fails that row only; stderr stays out of the body", async () => {
    const h = await harness({ failFile: "taranmış evrak.pdf" });
    const { body: pv } = await preview(h);
    const { body } = await importRows(h, {
      previewId: pv.previewId,
      rows: [
        { path: "2024-123 E. taranmış evrak.pdf", action: "assign", matterId: h.ids.M1 },
        { path: "Tensip Zaptı.udf", action: "assign", matterId: h.ids.M1 },
      ],
    });
    expect(body.sentence).toBe("11 belge: 1'i 1 dosyaya eklendi, 1'i zaten vardı, 3'ü eşleşmedi, 5'i sizin seçiminizle atlandı, 1'i işlenemedi.");
    const failed = body.rows.find((r: any) => r.path === "2024-123 E. taranmış evrak.pdf");
    expect(failed.error).toEqual({ kind: "EXTRACTION_FAILED", message: "taranmış PDF — OCR bu modda devre dışı" });
    expect(JSON.stringify(body)).not.toContain("Traceback");
  });

  it("validates the request before any work: fields, preview, paths, matters", async () => {
    const h = await harness();
    const { body: pv } = await preview(h);
    const bad = await importRows(h, { previewId: pv.previewId, rows: [{ path: "Tensip Zaptı.udf", action: "assign" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues.map((i: any) => i.path)).toEqual(["rows.0.matterId"]);
    const stray = await importRows(h, { previewId: pv.previewId, rows: [{ path: "a", action: "skip", x: 1 }] });
    expect(stray.status).toBe(400);
    expect(stray.body.error.issues.map((i: any) => i.path)).toEqual(["rows.0.x"]);
    const gone = await importRows(h, {
      previewId: "00000000-0000-4000-8000-000000000000",
      rows: [{ path: "Tensip Zaptı.udf", action: "skip" }],
    });
    expect(gone.status).toBe(404);
    expect(gone.body.error.kind).toBe("UYAP_PREVIEW_NOT_FOUND");
    const unknown = await importRows(h, { previewId: pv.previewId, rows: [{ path: "../../etc/passwd", action: "skip" }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.issues).toEqual([{ path: "rows.0.path", message: UYAP_MESSAGES_TR.unknownRow }]);
    const missing = await importRows(h, {
      previewId: pv.previewId,
      rows: [{ path: "Tensip Zaptı.udf", action: "assign", matterId: "11111111-2222-4333-8444-555555555555" }],
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.kind).toBe("MATTER_NOT_FOUND");
    expect(h.calls.filter((c) => c.args.includes("--file"))).toHaveLength(0);
  });
});

describe("mounted in the app", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "uyap-app-"));
    workDirs.push(dir);
  });

  it("answers under /v1/files next to the upload route", async () => {
    const calls: IntakeExecRequest[] = [];
    const app = createApp({
      filesExec: async (request) => {
        calls.push(request);
        return {
          code: 0,
          stdout: JSON.stringify({ uyapScan: { readerVersion: "uyap-okuma-v1", container: "dir", root: dir, total: 0, skipped: [], documents: [] } }),
          stderr: "",
        };
      },
      filesStore: { listFiles: async () => [], showFile: async () => undefined, getChunks: async () => [] } as FilesReadStore,
    });
    const res = await app.request("/v1/files/uyap-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).rows).toEqual([]);
    expect(calls[0]!.args).toContain("--uyap-scan");
  });
});
