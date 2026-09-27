/**
 * W14 — L-MATTER, files half: B-26 (`?matterId=` really filters, delete drops
 * the matter records, a usage pre-flight), B-30 (`GET /v1/files/{id}/original`)
 * and B-32 (paging + the `page` block). Fully offline: a fake read store and a
 * fake intake-CLI runner; the original is read from a temp directory.
 */

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, envUploadsDir } from "../../src/api/server.js";
import {
  ORIGINAL_MISSING_MESSAGE_TR,
  attachmentDisposition,
  createFilesRouter,
  trimToWordBoundary,
  unknownQueryIssues,
  withTransferableDates,
  type IntakeExec,
} from "../../src/files/routes.js";
import {
  DEFAULT_FILE_PAGE,
  MAX_FILE_PAGE,
  type ChunkSearchHit,
  type FileListEntry,
  type FileListOptions,
  type FileListPage,
  type FilesReadStore,
} from "../../src/files/store.js";

const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FILE_ID = SHA.slice(0, 16);
const OTHER_ID = "0123456789abcdef";
const MATTER_ID = "11111111-2222-4333-8444-555555555555";
const DSN = "postgres://postgres@127.0.0.1:55432/collex_fake_test";

interface ErrorBody {
  error: { kind: string; message: string; issues?: Array<{ path: string; message: string }> };
}

function entry(over: Partial<FileListEntry> = {}): FileListEntry {
  return {
    fileId: FILE_ID,
    name: "İhtarname_Şahin.pdf",
    mime: "application/pdf",
    sha256: SHA,
    kind: "pdf",
    uploadedAt: "2026-09-02T10:00:00.000Z",
    chars: 12_000,
    chunkCount: 40,
    ...over,
  };
}

/** A W14-capable fake: paging, matter links, usage, search, original ref. */
function fullStore(options: { rows?: FileListEntry[]; links?: Record<string, string> } = {}) {
  const rows = options.rows ?? [entry(), entry({ fileId: OTHER_ID, name: "dilekce.docx", kind: "docx" })];
  const links = options.links ?? { [FILE_ID]: MATTER_ID };
  const calls: { pages: FileListOptions[]; removed: string[] } = { pages: [], removed: [] };
  const store: FilesReadStore & { calls: typeof calls } = {
    calls,
    listFiles: async () => rows,
    showFile: async () => undefined,
    getChunks: async () => [],
    listFilePage: async (opts: FileListOptions): Promise<FileListPage> => {
      calls.pages.push(opts);
      const scoped =
        opts.fileIds === undefined ? rows : rows.filter((r) => opts.fileIds!.includes(r.fileId));
      const offset = opts.offset ?? 0;
      const limit = opts.limit ?? DEFAULT_FILE_PAGE;
      return {
        files: scoped.slice(offset, offset + limit),
        page: { offset, limit, total: scoped.length },
      };
    },
    matterFileIds: async (matterId: string) =>
      Object.entries(links)
        .filter(([, m]) => m === matterId)
        .map(([fileId]) => fileId),
    fileMatterLinks: async (fileIds: readonly string[]) => {
      const out = new Map<string, { matterId: string; matterTitle: string }>();
      for (const id of fileIds) {
        const matterId = links[id];
        if (matterId !== undefined) out.set(id, { matterId, matterTitle: "Yılmaz / Kira tahliye" });
      }
      return out;
    },
    searchChunks: async (q: string): Promise<ChunkSearchHit[]> =>
      q.includes("depozito")
        ? [
            {
              fileId: FILE_ID,
              fileName: "İhtarname_Şahin.pdf",
              chunkId: "chunk-7",
              ordinal: 7,
              snippet: "Kiracı depozito bedelini ödemiştir.",
              startChar: 1200,
              endChar: 1290,
            },
          ]
        : [],
    fileUsage: async (fileId: string) => ({
      fileId,
      matterItems: [{ itemId: "item-1", matterId: MATTER_ID, matterTitle: "Yılmaz / Kira tahliye" }],
      draftIds: ["draft-1", "draft-2"],
      answerRunIds: ["run-1"],
    }),
    removeMatterItemsForFile: async (fileId: string) => {
      calls.removed.push(fileId);
      return 1;
    },
    originalRef: async (fileId: string) =>
      fileId === FILE_ID
        ? { sha256: SHA, kind: "pdf", name: "İhtarname_Şahin.pdf", mime: "application/pdf" }
        : undefined,
  };
  return store;
}

/** A pre-W14 store: only the two original methods. */
function legacyStore(rows: FileListEntry[]): FilesReadStore {
  return {
    listFiles: async () => rows,
    showFile: async () => undefined,
    getChunks: async () => [],
  };
}

const okExec: IntakeExec = async () => ({ code: 0, stdout: "{}", stderr: "" });

function makeApp(
  store: FilesReadStore,
  over: { exec?: IntakeExec; uploadsDir?: string } = {},
) {
  const app = createFilesRouter({
    dsn: DSN,
    store,
    exec: over.exec ?? okExec,
    ...(over.uploadsDir !== undefined ? { uploadsDir: over.uploadsDir } : {}),
    log: () => undefined,
  });
  const json = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  return { app, json };
}

describe("B-26: GET /v1/files filters instead of pretending to", () => {
  it("?matterId= returns ONLY that matter's documents", async () => {
    const store = fullStore();
    const { json } = makeApp(store);
    const all = (await json("/v1/files")).body as { files: FileListEntry[] };
    expect(all.files).toHaveLength(2);

    const scoped = (await json(`/v1/files?matterId=${MATTER_ID}`)).body as {
      files: FileListEntry[];
      page: { total: number };
    };
    expect(scoped.files.map((f) => f.fileId)).toEqual([FILE_ID]);
    expect(scoped.page.total).toBe(1);
    expect(store.calls.pages.at(-1)?.fileIds).toEqual([FILE_ID]);

    const empty = (await json("/v1/files?matterId=99999999-9999-4999-8999-999999999999")).body as {
      files: unknown[];
      page: { total: number };
    };
    expect(empty.files).toEqual([]);
    expect(empty.page.total).toBe(0);
  });

  it("adds matterId + matterTitle to the rows (no GET per row)", async () => {
    const { json } = makeApp(fullStore());
    const body = (await json("/v1/files")).body as { files: FileListEntry[] };
    const byId = new Map(body.files.map((f) => [f.fileId, f]));
    expect(byId.get(FILE_ID)).toMatchObject({ matterId: MATTER_ID, matterTitle: "Yılmaz / Kira tahliye" });
    expect("matterId" in byId.get(OTHER_ID)!).toBe(false);
  });

  it("refuses an unknown parameter and a malformed matterId", async () => {
    const { json } = makeApp(fullStore());
    const unknown = await json("/v1/files?sirala=ad");
    expect(unknown.status).toBe(400);
    expect((unknown.body as ErrorBody).error.issues?.[0]?.message).toContain("Tanınmayan sorgu parametresi");
    const bad = await json("/v1/files?matterId=abc");
    expect(bad.status).toBe(400);
    expect((bad.body as ErrorBody).error.issues?.[0]?.path).toBe("matterId");
  });

  it("says the filter is unsupported instead of returning everything", async () => {
    const { json } = makeApp(legacyStore([entry()]));
    // A pre-W14 store has no matterFileIds -> the request is refused, and the
    // console cannot mistake a full list for a filtered one.
    const res = await json(`/v1/files?matterId=${MATTER_ID}`);
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.issues?.[0]?.message).toContain("dava dosyası bağlarını okuyamıyor");
  });

  it("unknownQueryIssues lists the allowed set", () => {
    expect(unknownQueryIssues("/v1/files?q=a&limit=3", ["q", "limit"])).toEqual([]);
    expect(unknownQueryIssues("/v1/files?x=1", ["q"])[0]?.message).toContain("Kullanılabilir: q.");
  });
});

describe("B-32: GET /v1/files pages", () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    entry({ fileId: String(i).padStart(16, "0"), name: `belge-${i}.pdf` }),
  );

  it("returns a bounded page plus the total", async () => {
    const { json } = makeApp(fullStore({ rows: many, links: {} }));
    const first = (await json("/v1/files")).body as {
      files: FileListEntry[];
      page: { offset: number; limit: number; total: number };
    };
    expect(first.files).toHaveLength(DEFAULT_FILE_PAGE);
    expect(first.page).toEqual({ offset: 0, limit: DEFAULT_FILE_PAGE, total: 120 });

    const second = (await json("/v1/files?limit=10&offset=115")).body as {
      files: FileListEntry[];
      page: { offset: number; total: number };
    };
    expect(second.files).toHaveLength(5);
    expect(second.page).toEqual({ offset: 115, limit: 10, total: 120 });
  });

  it("clamps the page size and refuses a non-numeric one", async () => {
    const store = fullStore({ rows: many, links: {} });
    const { json } = makeApp(store);
    await json("/v1/files?limit=9999");
    expect(store.calls.pages.at(-1)?.limit).toBe(MAX_FILE_PAGE);
    const bad = await json("/v1/files?limit=çok");
    expect(bad.status).toBe(400);
  });

  it("a pre-W14 store is paged in memory, with the same wire shape", async () => {
    const { json } = makeApp(legacyStore(many));
    const body = (await json("/v1/files?limit=5&offset=2")).body as {
      files: FileListEntry[];
      page: { total: number };
    };
    expect(body.files).toHaveLength(5);
    expect(body.page.total).toBe(120);
  });
});

describe("B-29 (files half): GET /v1/files/search", () => {
  it("returns document-body hits with their code-point offsets", async () => {
    const { json } = makeApp(fullStore());
    const res = await json("/v1/files/search?q=depozito");
    expect(res.status).toBe(200);
    const body = res.body as { q: string; hits: ChunkSearchHit[] };
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({ fileId: FILE_ID, chunkId: "chunk-7", startChar: 1200 });
    const short = await json("/v1/files/search?q=a");
    expect(short.status).toBe(400);
  });
});

describe("B-30: GET /v1/files/{id}/original", () => {
  it("returns the uploaded bytes byte-for-byte, as an attachment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "collex-orig-"));
    try {
      const bytes = Buffer.from("%PDF-1.7\nİhtarname içeriği\n", "utf8");
      await writeFile(join(dir, `${SHA}.pdf`), bytes);
      const { app } = makeApp(fullStore(), { uploadsDir: dir });
      const res = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-length")).toBe(String(bytes.length));
      const disposition = res.headers.get("content-disposition") ?? "";
      expect(disposition).toContain("attachment;");
      expect(disposition).toContain(encodeURIComponent("İhtarname_Şahin.pdf"));
      const back = Buffer.from(await res.arrayBuffer());
      expect(back.equals(bytes)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("says plainly when the original is not on disk, and 404s an unknown id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "collex-orig-"));
    try {
      const { json } = makeApp(fullStore(), { uploadsDir: dir });
      const missing = await json(`/v1/files/${FILE_ID}/original`);
      expect(missing.status).toBe(404);
      expect((missing.body as ErrorBody).error.kind).toBe("ORIGINAL_NOT_FOUND");
      expect((missing.body as ErrorBody).error.message).toBe(ORIGINAL_MISSING_MESSAGE_TR);

      const unknown = await json(`/v1/files/${OTHER_ID}/original`);
      expect(unknown.status).toBe(404);
      expect((unknown.body as ErrorBody).error.kind).toBe("NOT_FOUND");

      const malformed = await json("/v1/files/ZZZZ/original");
      expect(malformed.status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("attachmentDisposition keeps an ASCII fallback and the UTF-8 form", () => {
    const value = attachmentDisposition("İhtar — Şahin.pdf");
    expect(value.startsWith('attachment; filename="')).toBe(true);
    expect(value).toContain("filename*=UTF-8''");
    expect(/filename="[\x20-\x7e]*"/u.test(value)).toBe(true);
  });

  it("attachmentDisposition percent-encodes ( ) ' * in filename* (RFC 8187 attr-char)", () => {
    const value = attachmentDisposition("Bilirkişi Raporu (Ek-3) 'son'.pdf");
    const star = value.split("filename*=UTF-8''")[1] as string;
    expect(star).not.toMatch(/[()'*]/u);
    expect(star).toContain("%28Ek-3%29");
  });
});

describe("B-18 (files half): analysis.dates[] is transferable as-is", () => {
  it("adds a word-boundary title, the source and verified:false to every date", () => {
    const analysis = {
      parties: [],
      dates: [
        {
          date: "2025-03-12",
          count: 2,
          context:
            "Kiracı 12.03.2025 tarihinde kira bedelini ödememiş ve bu nedenle ihtarname keşide edilmiştir; ödeme yapılmadığı takdirde tahliye talep edilecektir",
        },
        { date: "2025-04-01", count: 1, context: "kısa bağlam" },
      ],
    };
    const out = withTransferableDates(analysis, "0123456789abcdef");
    const dates = out["dates"] as Array<Record<string, unknown>>;
    expect(dates[0]!["source"]).toBe("belge:0123456789abcdef");
    expect(dates[0]!["verified"]).toBe(false);
    expect(dates[0]!["count"]).toBe(2); // additive: nothing is dropped
    const title = String(dates[0]!["title"]);
    expect(title.endsWith("…")).toBe(true);
    // Never cut mid-word: every retained token is a whole token of the source.
    const source = String(analysis.dates[0]!.context).split(" ");
    for (const token of title.slice(0, -1).trim().split(" ")) expect(source).toContain(token);
    expect(dates[1]!["title"]).toBe("kısa bağlam");
  });

  it("leaves an analysis without a dates array untouched", () => {
    const analysis = { parties: ["Ayşe"], dates: "yok" };
    expect(withTransferableDates(analysis, "x")).toBe(analysis);
  });

  it("trimToWordBoundary counts CODE POINTS, not code units", () => {
    // Two astral characters are two code points, not four code units.
    expect(trimToWordBoundary("𝔄𝔅", 2)).toBe("𝔄𝔅");
    expect([...trimToWordBoundary("𝔄𝔅ℭ", 2)]).toHaveLength(3); // 2 + the ellipsis
  });
});

describe("B-26: deleting a document does not leave dangling records", () => {
  it("GET /v1/files/{id}/usage warns about matters, drafts and answers", async () => {
    const { json } = makeApp(fullStore());
    const res = await json(`/v1/files/${FILE_ID}/usage`);
    expect(res.status).toBe(200);
    const body = res.body as { warnings: string[]; draftIds: string[] };
    expect(body.draftIds).toEqual(["draft-1", "draft-2"]);
    expect(body.warnings).toHaveLength(3);
    expect(body.warnings[0]).toContain("1 dava dosyasında kayıtlı");
    expect(body.warnings[1]).toContain("2 taslak");
  });

  it("GET /v1/files/{unknownId}/usage is 404 like every other file route (27.09.2026)", async () => {
    // It used to be 200 with empty lists — which the delete dialog reads as
    // "nothing depends on this document".
    const { json } = makeApp(fullStore());
    const res = await json(`/v1/files/${"f".repeat(16)}/usage`);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.kind).toBe("NOT_FOUND");
  });

  it("DELETE drops the matter records that referenced the file", async () => {
    const store = fullStore();
    const { app } = makeApp(store);
    const res = await app.request(`/v1/files/${FILE_ID}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(store.calls.removed).toEqual([FILE_ID]);
  });

  it("a bookkeeping failure never turns a successful delete into an error", async () => {
    const store = fullStore();
    store.removeMatterItemsForFile = async () => {
      throw new Error("matters table missing");
    };
    const { app } = makeApp(store);
    const res = await app.request(`/v1/files/${FILE_ID}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});

/**
 * W14 L-VERIFY V-4 — the `COLLEX_DATA_DIR` seam.
 *
 * Measured before the fix on a real server (port 8972, `collex_api_test`,
 * `COLLEX_DATA_DIR=<scratch>`): the upload landed at
 * `<COLLEX_DATA_DIR>/uploads/<sha256>.txt` (verified on disk) and
 * `GET /v1/files/{id}/original` answered **404 ORIGINAL_NOT_FOUND**, because
 * `createApp` passed no `uploadsDir` and the router fell back to
 * `<repo>/var/uploads`. `intake`, `backup/runner.ts` and the restore script
 * all use the data directory, so a lawyer who followed the backup card's own
 * advice lost "Aslını indir" and the matter package's originals.
 *
 * These tests drive `createApp` (the seam), not the router.
 */
describe("W14 L-VERIFY V-4: createApp resolves the originals directory", () => {
  const withDataDir = async <T>(dir: string, run: () => Promise<T>): Promise<T> => {
    const previous = process.env["COLLEX_DATA_DIR"];
    process.env["COLLEX_DATA_DIR"] = dir;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env["COLLEX_DATA_DIR"];
      else process.env["COLLEX_DATA_DIR"] = previous;
    }
  };

  it("envUploadsDir mirrors serve.mjs/intake: <COLLEX_DATA_DIR>/uploads, else nothing", () => {
    expect(envUploadsDir({ COLLEX_DATA_DIR: join("D:", "ColleX-Veri") })).toBe(
      join("D:", "ColleX-Veri", "uploads"),
    );
    expect(envUploadsDir({ COLLEX_DATA_DIR: "   " })).toBeUndefined();
    expect(envUploadsDir({})).toBeUndefined();
  });

  it("downloads the original when COLLEX_DATA_DIR holds it (the V-4 repro)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "collex-datadir-"));
    try {
      const uploads = join(dataDir, "uploads");
      await mkdir(uploads, { recursive: true });
      const bytes = Buffer.from("%PDF-1.7\nAslı bu dosyadadır\n", "utf8");
      await writeFile(join(uploads, `${SHA}.pdf`), bytes);

      const app = await withDataDir(dataDir, async () =>
        createApp({ filesStore: fullStore(), filesExec: okExec, serveConsole: false }),
      );
      const res = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("an explicit uploadsDir wins over the environment", async () => {
    const explicitDir = await mkdtemp(join(tmpdir(), "collex-explicit-"));
    const envDir = await mkdtemp(join(tmpdir(), "collex-env-"));
    try {
      const bytes = Buffer.from("aslı, açıkça verilen klasörde", "utf8");
      await writeFile(join(explicitDir, `${SHA}.pdf`), bytes);
      await mkdir(join(envDir, "uploads"), { recursive: true });

      const app = await withDataDir(envDir, async () =>
        createApp({
          filesStore: fullStore(),
          filesExec: okExec,
          uploadsDir: explicitDir,
          serveConsole: false,
        }),
      );
      const res = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    } finally {
      await rm(explicitDir, { recursive: true, force: true });
      await rm(envDir, { recursive: true, force: true });
    }
  });

  it("still 404s honestly when the bytes really are gone", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "collex-empty-"));
    try {
      await mkdir(join(dataDir, "uploads"), { recursive: true });
      const app = await withDataDir(dataDir, async () =>
        createApp({ filesStore: fullStore(), filesExec: okExec, serveConsole: false }),
      );
      const res = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.kind).toBe("ORIGINAL_NOT_FOUND");
      expect(body.error.message).toBe(ORIGINAL_MISSING_MESSAGE_TR);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
