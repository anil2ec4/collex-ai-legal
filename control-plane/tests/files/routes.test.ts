/**
 * /v1/files router (W12-F): typed 503/504 mapping, chunk-preview
 * pagination, the `q` name filter and the explicit upload action. Fully
 * offline: a fake intake-CLI runner and a fake read store.
 */

import { describe, expect, it } from "vitest";
import {
  ALREADY_EXISTED_MESSAGE,
  FILE_ID_RE,
  classifyStoreError,
  intakeFailureDetail,
  createFilesRouter,
  MAX_UPLOAD_BYTES,
  nameMatches,
  parseChunkWindow,
  STORE_MISSING_MESSAGE,
  STORE_UNAVAILABLE_MESSAGE,
  UPLOAD_TIMEOUT_MESSAGE,
  withUploadAction,
  type IntakeExec,
  type IntakeExecRequest,
} from "../../src/files/routes.js";
import {
  DEFAULT_CHUNK_WINDOW,
  PostgresFilesStore,
  normalizeChunkWindow,
  pageStatsOf,
  type ChunkWindowRequest,
  type FileChunkPreview,
  type FileDetail,
  type FileListEntry,
  type FilesReadStore,
} from "../../src/files/store.js";
import type { Sql } from "../../src/store/db.js";

const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FILE_ID = SHA.slice(0, 16);
const DSN = "postgres://postgres@127.0.0.1:55432/collex_fake_test";
const TOTAL_CHUNKS = 40;

function entry(over: Partial<FileListEntry> = {}): FileListEntry {
  return {
    fileId: FILE_ID,
    name: "İhtarname_Şahin.pdf",
    mime: "application/pdf",
    sha256: SHA,
    kind: "pdf",
    uploadedAt: "2026-09-02T10:00:00.000Z",
    chars: 12_000,
    chunkCount: TOTAL_CHUNKS,
    ...over,
  };
}

/** Fake store that honours the preview window like PostgresFilesStore. */
function fakeStore(options: { throwWith?: unknown; extra?: FileListEntry[] } = {}): FilesReadStore & {
  windows: ChunkWindowRequest[];
} {
  const all: FileChunkPreview[] = Array.from({ length: TOTAL_CHUNKS }, (_, i) => ({
    chunkId: `chunk-${i}`,
    ordinal: i,
    preview: `Paragraf ${i + 1}`,
    startChar: i * 100,
    endChar: i * 100 + 90,
  }));
  const windows: ChunkWindowRequest[] = [];
  return {
    windows,
    listFiles: async () => {
      if (options.throwWith !== undefined) throw options.throwWith;
      return [entry(), ...(options.extra ?? [])];
    },
    showFile: async (fileId: string, _tenant?: string, window?: ChunkWindowRequest) => {
      if (options.throwWith !== undefined) throw options.throwWith;
      if (fileId !== FILE_ID) return undefined;
      const w = normalizeChunkWindow(window);
      windows.push(w);
      const detail: FileDetail = {
        ...entry(),
        extraction: { chars: 12_000, chunkCount: TOTAL_CHUNKS, pages: 10, ocr: false },
        analysis: { parties: [], references: [], dates: [], claims: [] },
        warnings: ["SCANNED_PAGES:9", "9 / 10 sayfada metin katmanı yok (taranmış olabilir): sayfa 2, 3, 4, 5, 6, 7, 8, 9, 10 — bu sayfalar dizine alınmadı; OCR bu modda devre dışı"],
        chunks: all.slice(w.offset, w.offset + w.limit),
        pages: { pageCount: 10, pagesWithText: 1, emptyPages: [2, 3, 4, 5, 6, 7, 8, 9, 10], sparsePages: [3] },
        chunkWindow: { offset: w.offset, limit: w.limit, total: TOTAL_CHUNKS },
      };
      return detail;
    },
    getChunks: async () => [],
  };
}

interface ScriptedCli {
  code: number;
  stdout: string;
  timedOut?: boolean;
}

function makeApp(options: {
  cli?: (request: IntakeExecRequest) => ScriptedCli;
  store?: FilesReadStore;
} = {}) {
  const calls: IntakeExecRequest[] = [];
  const defaultCli = (): ScriptedCli => ({ code: 0, stdout: JSON.stringify(cannedUpload()) });
  const exec: IntakeExec = async (request) => {
    calls.push(request);
    const scripted = (options.cli ?? defaultCli)(request);
    return {
      code: scripted.code,
      stdout: scripted.stdout,
      stderr: "",
      ...(scripted.timedOut === true ? { timedOut: true } : {}),
    };
  };
  const app = createFilesRouter({
    dsn: DSN,
    store: options.store ?? fakeStore(),
    exec,
    pythonPath: "C:/fake/venv/python.exe",
    repoRoot: "C:/fake/repo",
  });
  return { app, calls };
}

function cannedUpload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fileId: FILE_ID,
    name: "sozlesme.pdf",
    mime: "application/pdf",
    sha256: SHA,
    sizeBytes: 5_000,
    kind: "pdf",
    extraction: { chars: 900, chunkCount: 4, pages: 10, ocr: false },
    analysis: { parties: [], references: [], dates: [], claims: [] },
    warnings: [],
    ...over,
  };
}

describe("POST /v1/files/:id/reanalyze", () => {
  it("reprocesses the server-owned original without accepting a path", async () => {
    const { app, calls } = makeApp();
    const res = await app.request(`/v1/files/${FILE_ID}/reanalyze`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls[0]?.args).toContain("--reanalyze");
    expect(calls[0]?.args).toContain(FILE_ID);
    expect(calls[0]?.args).not.toContain("--file");
    expect(await res.json()).toEqual({ fileId: FILE_ID, reanalyzed: true });
  });
  it("rejects invalid identities before starting the CLI", async () => {
    const { app, calls } = makeApp();
    expect((await app.request("/v1/files/not-a-file/reanalyze", { method: "POST" })).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
  it("surfaces integrity failure and timeouts without reporting success", async () => {
    const broken = makeApp({ cli: () => ({ code: 2, stdout: JSON.stringify({ error: { kind: "EXTRACTION_FAILED", message: "bütünlük" } }) }) });
    expect((await broken.app.request(`/v1/files/${FILE_ID}/reanalyze`, { method: "POST" })).status).toBe(422);
    const stalled = makeApp({ cli: () => ({ code: 0, stdout: "{}", timedOut: true }) });
    expect((await stalled.app.request(`/v1/files/${FILE_ID}/reanalyze`, { method: "POST" })).status).toBe(504);
  });
});

function uploadForm(name: string): FormData {
  const form = new FormData();
  form.append("file", new File([Buffer.from("%PDF-1.4 fake")], name), name);
  return form;
}

// ---------------------------------------------------------------------------
// GET /v1/files/{id}: paginated previews + page statistics
// ---------------------------------------------------------------------------

describe("GET /v1/files/{id} pagination", () => {
  it("returns the default window of 12 previews and the TOTAL chunkCount", async () => {
    const store = fakeStore();
    const { app } = makeApp({ store });
    const res = await app.request(`/v1/files/${FILE_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileDetail;
    expect(body.chunkCount).toBe(TOTAL_CHUNKS);
    expect(body.chunks).toHaveLength(DEFAULT_CHUNK_WINDOW);
    expect(body.chunks[0]?.ordinal).toBe(0);
    expect(body.chunkWindow).toEqual({ offset: 0, limit: 12, total: TOTAL_CHUNKS });
    expect(store.windows).toEqual([{ offset: 0, limit: 12 }]);
    // Additive page statistics + the SCANNED_PAGES machine code travel through.
    expect(body.pages).toEqual({ pageCount: 10, pagesWithText: 1, emptyPages: [2, 3, 4, 5, 6, 7, 8, 9, 10], sparsePages: [3] });
    expect(body.warnings).toContain("SCANNED_PAGES:9");
  });

  it("honours ?chunks= and ?offset= and clamps the tail", async () => {
    const { app } = makeApp();
    const res = await app.request(`/v1/files/${FILE_ID}?chunks=5&offset=37`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileDetail;
    expect(body.chunks.map((c) => c.ordinal)).toEqual([37, 38, 39]);
    expect(body.chunkWindow).toEqual({ offset: 37, limit: 5, total: TOTAL_CHUNKS });
    expect(body.chunkCount).toBe(TOTAL_CHUNKS);
  });

  it("rejects unusable window parameters with a Turkish 400", async () => {
    const { app } = makeApp();
    for (const query of ["chunks=0", "chunks=abc", "chunks=201", "offset=-1", "offset=x"]) {
      const res = await app.request(`/v1/files/${FILE_ID}?${query}`);
      expect(res.status, query).toBe(400);
      const body = (await res.json()) as { error: { kind: string; message: string } };
      expect(body.error.kind).toBe("INVALID_REQUEST");
      expect(body.error.message).toMatch(/tam sayı/u);
    }
  });

  it("fills chunkWindow for a store that does not report one", async () => {
    const legacy: FilesReadStore = {
      listFiles: async () => [entry({ chunkCount: 3 })],
      showFile: async () => ({
        ...entry({ chunkCount: 3 }),
        extraction: { chars: 1, chunkCount: 3, ocr: false },
        analysis: {},
        warnings: [],
        chunks: [],
      }),
      getChunks: async () => [],
    };
    const { app } = makeApp({ store: legacy });
    const res = await app.request(`/v1/files/${FILE_ID}?chunks=7&offset=2`);
    const body = (await res.json()) as FileDetail;
    expect(body.chunkWindow).toEqual({ offset: 2, limit: 7, total: 3 });
  });

  it("parseChunkWindow / normalizeChunkWindow agree on defaults and caps", () => {
    expect(parseChunkWindow(undefined, undefined)).toEqual({
      ok: true,
      window: { limit: 12, offset: 0 },
    });
    expect(parseChunkWindow("200", "5")).toEqual({ ok: true, window: { limit: 200, offset: 5 } });
    expect(normalizeChunkWindow({ limit: 9_999, offset: -4 })).toEqual({ limit: 200, offset: 0 });
    expect(normalizeChunkWindow(undefined)).toEqual({ limit: 12, offset: 0 });
  });

  it("pageStatsOf narrows untrusted metadata", () => {
    expect(pageStatsOf({ pageCount: 3, pagesWithText: 2, emptyPages: [3, "x"], sparsePages: [2, "x"] })).toEqual({
      pageCount: 3,
      pagesWithText: 2,
      emptyPages: [3],
      sparsePages: [2],
    });
    expect(pageStatsOf(null)).toBeUndefined();
    expect(pageStatsOf({ pageCount: "3" })).toBeUndefined();
    expect(pageStatsOf({ pageCount: Number.NaN, pagesWithText: 1, emptyPages: [0, 1.5, 2] })).toBeUndefined();
    expect(pageStatsOf({ pageCount: 3, pagesWithText: 2, emptyPages: [0, 1.5, 2, 4], sparsePages: [-1, 3, 4] })).toEqual({
      pageCount: 3,
      pagesWithText: 2,
      emptyPages: [2],
      sparsePages: [3],
    });
  });
});

// ---------------------------------------------------------------------------
// GET /v1/files: page statistics on the list row (W12-API2)
// ---------------------------------------------------------------------------

describe("GET /v1/files pages (W12-API2)", () => {
  const SCAN = { pageCount: 10, pagesWithText: 1, emptyPages: [2, 3, 4, 5, 6, 7, 8, 9, 10], sparsePages: [3, 4] };

  it("passes a list row's `pages` through and leaves rows without statistics untouched", async () => {
    const store = fakeStore({
      extra: [entry({ fileId: "ffff000000000000", name: "taranmis.pdf", pages: SCAN })],
    });
    const { app } = makeApp({ store });
    const body = (await (await app.request("/v1/files")).json()) as { files: FileListEntry[] };
    const byId = new Map(body.files.map((f) => [f.fileId, f]));
    expect(byId.get("ffff000000000000")?.pages).toEqual(SCAN);
    expect("pages" in byId.get(FILE_ID)!).toBe(false);
  });

  it("PostgresFilesStore.listFiles reads page_stats from the SAME metadata block showFile uses, in ONE grouped query", async () => {
    const queries: string[] = [];
    const rows = [
      {
        external_id: FILE_ID,
        title: "İhtarname",
        created_at: new Date("2026-09-02T10:00:00.000Z"),
        chars: 12_000,
        chunk_count: 40,
        metadata: {
          fixture_meta: {
            upload: {
              name: "İhtarname_Şahin.pdf",
              mime: "application/pdf",
              sha256: SHA,
              kind: "pdf",
              size_bytes: 123_456,
              page_stats: { ...SCAN, emptyPages: [...SCAN.emptyPages, "x"], sparsePages: [...SCAN.sparsePages, "x"] }, // untrusted: narrowed
              warnings: ["SCANNED_PAGES:9"],
            },
          },
        },
      },
      {
        external_id: "ffff000000000000",
        title: "dilekce",
        created_at: "2026-09-01T10:00:00.000Z",
        chars: 5,
        chunk_count: 1,
        metadata: { fixture_meta: { upload: { name: "dilekce_ornek.docx", mime: "application/msword", sha256: SHA, kind: "docx", size_bytes: "bad" } } },
      },
    ];
    const fakeSql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const text = strings.join("?");
      queries.push(text);
      // W14 (B-32): the page read is now count-then-page.
      return text.includes("count(*)::int as total") ? [{ total: 2 }] : rows;
    }) as unknown as Sql;

    const store = new PostgresFilesStore({ db: fakeSql });
    const files = await store.listFiles();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ fileId: FILE_ID, name: "İhtarname_Şahin.pdf", kind: "pdf", chunkCount: 40, sizeBytes: 123_456 });
    expect(files[0]!.pages).toEqual(SCAN);
    expect("pages" in files[1]!).toBe(false);
    expect("sizeBytes" in files[1]!).toBe(false);
    // W14 (B-32) — the two measured defects of the old list query are pinned
    // here so they cannot come back:
    //  * `chars` no longer detoasts every canonical text unconditionally: it
    //    reads the intake's metadata first and only falls back to length();
    //  * the chunk count is a LATERAL bound to the page's rows, never a
    //    `group by` over the whole legal.chunks table.
    // `sql``` fragments (the optional id filter) reach the fake as empty
    // template calls; only the real statements are counted.
    const statements = queries.filter((text) => text.trim() !== "");
    expect(statements).toHaveLength(2); // count + page, nothing per row
    const page = statements[1]!;
    expect(page).toContain("v.metadata");
    expect(page).toContain("'upload' ->> 'chars'");
    expect(page).toContain("left join lateral");
    expect(page).not.toContain("group by document_version_id");
    await store.end(); // a shared client is never closed by the store
  });
});

// ---------------------------------------------------------------------------
// GET /v1/files?q=
// ---------------------------------------------------------------------------

describe("GET /v1/files?q=", () => {
  it("filters by name, Turkish case-insensitively", async () => {
    const store = fakeStore({
      extra: [entry({ fileId: "ffff000000000000", name: "dilekce_ornek.docx", kind: "docx" })],
    });
    const { app } = makeApp({ store });
    const all = (await (await app.request("/v1/files")).json()) as { files: FileListEntry[] };
    expect(all.files).toHaveLength(2);

    const hit = (await (await app.request("/v1/files?q=%C4%B0HTARNAME")).json()) as {
      files: FileListEntry[];
    };
    expect(hit.files.map((f) => f.name)).toEqual(["İhtarname_Şahin.pdf"]);

    const docx = (await (await app.request("/v1/files?q=dilek")).json()) as { files: FileListEntry[] };
    expect(docx.files.map((f) => f.fileId)).toEqual(["ffff000000000000"]);

    const none = (await (await app.request("/v1/files?q=yok")).json()) as { files: FileListEntry[] };
    expect(none.files).toEqual([]);
  });

  it("nameMatches folds İ/ı/Ş and ignores a blank query", () => {
    expect(nameMatches("İhtarname_Şahin.pdf", "ihtarname")).toBe(true);
    expect(nameMatches("İhtarname_Şahin.pdf", "ŞAHİN")).toBe(true);
    expect(nameMatches("İhtarname_Şahin.pdf", "   ")).toBe(true);
    expect(nameMatches("İhtarname_Şahin.pdf", "sözleşme")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 503 STORE_UNAVAILABLE (CLI + read store) and 504 UPLOAD_TIMEOUT
// ---------------------------------------------------------------------------

describe("STORE_UNAVAILABLE mapping", () => {
  it("maps the CLI's STORE_UNAVAILABLE (exit 2) to 503 with the remedy message", async () => {
    const { app } = makeApp({
      cli: () => ({
        code: 2,
        stdout: JSON.stringify({
          error: { kind: "STORE_UNAVAILABLE", message: "Yerel veritabanına ulaşılamadı." },
        }),
      }),
    });
    const upload = await app.request("/v1/files", { method: "POST", body: uploadForm("a.pdf") });
    expect(upload.status).toBe(503);
    const body = (await upload.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("STORE_UNAVAILABLE");
    expect(body.error.message).toBe(STORE_UNAVAILABLE_MESSAGE);

    const del = await app.request(`/v1/files/${FILE_ID}`, { method: "DELETE" });
    expect(del.status).toBe(503);
    expect(((await del.json()) as { error: { message: string } }).error.message).toBe(
      STORE_UNAVAILABLE_MESSAGE,
    );
  });

  it("maps a read-store connection error to 503 with the same message", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:55432"), {
      code: "ECONNREFUSED",
    });
    const { app } = makeApp({ store: fakeStore({ throwWith: refused }) });
    for (const url of ["/v1/files", `/v1/files/${FILE_ID}`]) {
      const res = await app.request(url);
      expect(res.status, url).toBe(503);
      const body = (await res.json()) as { error: { kind: string; message: string } };
      expect(body.error.kind).toBe("STORE_UNAVAILABLE");
      expect(body.error.message).toBe(STORE_UNAVAILABLE_MESSAGE);
      // Driver text never leaks.
      expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    }
  });

  it("maps a missing database/schema to 503 with the --ensure-db hint", async () => {
    const missing = Object.assign(new Error('database "collex_local" does not exist'), {
      code: "3D000",
    });
    const { app } = makeApp({ store: fakeStore({ throwWith: missing }) });
    const res = await app.request("/v1/files");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      STORE_MISSING_MESSAGE,
    );
  });

  it("classifyStoreError walks the cause chain", () => {
    expect(classifyStoreError({ code: "CONNECT_TIMEOUT" })).toBe("connection");
    expect(classifyStoreError({ cause: { code: "ETIMEDOUT" } })).toBe("connection");
    expect(classifyStoreError({ name: "TimeoutError" })).toBe("connection");
    expect(classifyStoreError({ code: "42P01" })).toBe("missing");
    expect(classifyStoreError(new Error("boom"))).toBe("other");
  });

  it("answers a typed 504 UPLOAD_TIMEOUT when the runner killed the CLI", async () => {
    const { app } = makeApp({ cli: () => ({ code: 1, stdout: "", timedOut: true }) });
    const res = await app.request("/v1/files", { method: "POST", body: uploadForm("buyuk.pdf") });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("UPLOAD_TIMEOUT");
    expect(body.error.message).toBe(UPLOAD_TIMEOUT_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Upload action
// ---------------------------------------------------------------------------

describe("POST /v1/files action", () => {
  it("passes the CLI's created / already-existed action and adds the Turkish message", async () => {
    const created = makeApp({ cli: () => ({ code: 0, stdout: JSON.stringify(cannedUpload({ action: "created" })) }) });
    const first = await created.app.request("/v1/files", { method: "POST", body: uploadForm("a.pdf") });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody["action"]).toBe("created");
    expect(firstBody["message"]).toBeUndefined();

    const existed = makeApp({
      cli: () => ({
        code: 0,
        stdout: JSON.stringify(
          cannedUpload({
            action: "already-existed",
            message: ALREADY_EXISTED_MESSAGE,
            warnings: ["aynı içerik daha önce yüklenmiş — mevcut belge döndürüldü, yeni sürüm oluşturulmadı"],
          }),
        ),
      }),
    });
    const again = await existed.app.request("/v1/files", { method: "POST", body: uploadForm("a.pdf") });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as Record<string, unknown>;
    expect(againBody["action"]).toBe("already-existed");
    expect(againBody["message"]).toBe("Bu belge zaten yüklüydü");
  });

  it("derives the action for an older CLI that emits only the warning", () => {
    expect(withUploadAction(cannedUpload())["action"]).toBe("created");
    const derived = withUploadAction(
      cannedUpload({ warnings: ["aynı içerik daha önce yüklenmiş — mevcut belge döndürüldü"] }),
    );
    expect(derived["action"]).toBe("already-existed");
    expect(derived["message"]).toBe(ALREADY_EXISTED_MESSAGE);
  });

  it("still pre-checks the shared upload cap before touching the CLI", async () => {
    const { app, calls } = makeApp();
    const form = new FormData();
    form.append("file", new File([Buffer.alloc(MAX_UPLOAD_BYTES + 1)], "buyuk.txt"));
    const res = await app.request("/v1/files", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("W12-FIX2 (P2-14): no stderr echo, fileId shape before the process", () => {
  it("INTAKE_FAILED carries a correlation id; the child's stderr goes to the server log only", async () => {
    const logged: string[] = [];
    const calls: IntakeExecRequest[] = [];
    const app = createFilesRouter({
      dsn: DSN,
      store: fakeStore(),
      exec: async (request) => {
        calls.push(request);
        return {
          code: 1,
          stdout: "",
          stderr: "Traceback (most recent call last):\n  File C:\\gizli\\yol.py\n  dsn=postgres://postgres@127.0.0.1:55432/collex_local",
        };
      },
      pythonPath: "C:/fake/venv/python.exe",
      repoRoot: "C:/fake/repo",
      log: (line) => logged.push(line),
    });
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", { type: "application/pdf" }));
    const res = await app.request("/v1/files", { method: "POST", body: form });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { kind: string; detail: string; correlationId: string } };
    expect(body.error.kind).toBe("INTAKE_FAILED");
    expect(body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(body.error.detail).toBe(intakeFailureDetail(body.error.correlationId));
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("Traceback");
    expect(raw).not.toContain("collex_local");
    expect(raw).not.toContain("gizli");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`INTAKE_FAILED id=${body.error.correlationId}`);
    expect(logged[0]).toContain("Traceback");

    // A malformed id never reaches the CLI.
    expect(FILE_ID_RE.test(FILE_ID)).toBe(true);
    const before = calls.length;
    for (const bad of ["yok", "..%2Fetc%2Fpasswd", "ABCDEF0123456789", "0123456789abcdef0", "--delete"]) {
      const del = await app.request(`/v1/files/${bad}`, { method: "DELETE" });
      expect(del.status, bad).toBe(404);
    }
    expect(calls.length).toBe(before);
  });
});
