/**
 * W21 platform lane — what /v1/files says about extraction and OCR.
 *
 *  - #29: `extraction.ocr` was a constant false on BOTH the upload response
 *    and GET /v1/files/{id}, and `pages.ocrPages` was dropped by the store,
 *    so pages local OCR had read looked unread on the file page.
 *  - CD1 (#28, server part): a 422 EXTRACTION_FAILED body carries
 *    `error.warnings: string[]` — always an array — so the console switches on
 *    SCANNED_PDF_NO_OCR / SCANNED_PDF_OCR_FAILED / SCANNED_PDF_OCR_NOT_APPLIED
 *    instead of matching Turkish prose.
 *
 * Fully offline: a fake intake-CLI runner and a fake SQL tag.
 */

import { describe, expect, it } from "vitest";
import {
  createFilesRouter,
  extractionFailureBody,
  withExtractionOcr,
  type IntakeExec,
} from "../../src/files/routes.js";
import {
  PostgresFilesStore,
  extractionUsedOcr,
  pageStatsOf,
  type FileDetail,
  type FilesReadStore,
} from "../../src/files/store.js";
import type { Sql } from "../../src/store/db.js";

const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FILE_ID = SHA.slice(0, 16);
const DSN = "postgres://postgres@127.0.0.1:55432/collex_fake_test";

const noStore: FilesReadStore = {
  listFiles: async () => [],
  showFile: async () => undefined,
  getChunks: async () => [],
};

function appWithCli(code: number, body: unknown) {
  const exec: IntakeExec = async () => ({ code, stdout: JSON.stringify(body), stderr: "" });
  return createFilesRouter({
    dsn: DSN,
    store: noStore,
    exec,
    pythonPath: "C:/fake/venv/python.exe",
    repoRoot: "C:/fake/repo",
  });
}

function uploadForm(name: string): FormData {
  const form = new FormData();
  form.append("file", new File([Buffer.from("%PDF-1.4 fake")], name), name);
  return form;
}

function cliUpload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fileId: FILE_ID,
    name: "karma.pdf",
    mime: "application/pdf",
    sha256: SHA,
    sizeBytes: 5_000,
    kind: "pdf",
    // intake/ingest.py still writes a constant false here.
    extraction: { chars: 900, chunkCount: 4, pages: 5, ocr: false },
    analysis: { parties: [], references: [], dates: [], claims: [] },
    warnings: [],
    action: "created",
    ...over,
  };
}

describe("W21 #29: pages local OCR read are reported as read", () => {
  it("pageStatsOf keeps ocrPages, narrowed like the other page lists", () => {
    expect(pageStatsOf({ pageCount: 5, pagesWithText: 5, emptyPages: [], ocrPages: [3, 4, "x", 0, 9, 5] })).toEqual({
      pageCount: 5,
      pagesWithText: 5,
      emptyPages: [],
      ocrPages: [3, 4, 5],
    });
    // Additive: a stats block written before W21 keeps its exact shape.
    expect(pageStatsOf({ pageCount: 3, pagesWithText: 2, emptyPages: [3] })).toEqual({
      pageCount: 3,
      pagesWithText: 2,
      emptyPages: [3],
    });
  });

  it("extractionUsedOcr decides from the recorded pages or the OCR_PAGES code, never by assumption", () => {
    expect(extractionUsedOcr({ pageCount: 5, pagesWithText: 5, emptyPages: [], ocrPages: [3] }, [])).toBe(true);
    expect(extractionUsedOcr(undefined, ["OCR_PAGES:2", "2 sayfa yerel OCR ile okundu"])).toBe(true);
    expect(extractionUsedOcr({ pageCount: 3, pagesWithText: 2, emptyPages: [3], ocrPages: [] }, [])).toBe(false);
    expect(extractionUsedOcr(undefined, ["OCR_PAGES:0", "OCR_FAILED_PAGES:2", "SCANNED_PAGES:2"])).toBe(false);
    expect(extractionUsedOcr(undefined, "OCR_PAGES:1")).toBe(false);
    expect(extractionUsedOcr(undefined, undefined)).toBe(false);
  });

  it("POST /v1/files answers extraction.ocr=true when the intake says OCR read pages", async () => {
    const app = appWithCli(
      0,
      cliUpload({
        pages: { pageCount: 5, pagesWithText: 5, emptyPages: [], ocrPages: [3, 4, 5] },
        warnings: ["OCR_PAGES:3", "3 sayfa yerel OCR ile okundu (sayfa 3, 4, 5); OCR metni hata içerebilir"],
      }),
    );
    const res = await app.request("/v1/files", { method: "POST", body: uploadForm("karma.pdf") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { extraction: { ocr: boolean; chars: number }; pages: { ocrPages: number[] } };
    // Before W21 the CLI's constant false went out unchanged.
    expect(body.extraction.ocr).toBe(true);
    expect(body.extraction.chars).toBe(900);
    expect(body.pages.ocrPages).toEqual([3, 4, 5]);
  });

  it("POST /v1/files keeps extraction.ocr=false when nothing was read by OCR", async () => {
    const app = appWithCli(
      0,
      cliUpload({
        pages: { pageCount: 3, pagesWithText: 2, emptyPages: [3] },
        warnings: ["SCANNED_PAGES:1", "1 / 3 sayfada metin katmanı yok"],
      }),
    );
    const res = await app.request("/v1/files", { method: "POST", body: uploadForm("karma.pdf") });
    const body = (await res.json()) as { extraction: { ocr: boolean } };
    expect(body.extraction.ocr).toBe(false);
    // A body without an extraction block is passed through untouched.
    expect(withExtractionOcr({ fileId: FILE_ID })).toEqual({ fileId: FILE_ID });
  });

  it("GET /v1/files/{id} (PostgresFilesStore.showFile) derives extraction.ocr and passes ocrPages", async () => {
    const metadata = (upload: Record<string, unknown>) => ({ fixture_meta: { upload } });
    const detailFor = async (upload: Record<string, unknown>): Promise<FileDetail | undefined> => {
      const fakeSql = (async (strings: TemplateStringsArray) => {
        const text = strings.join("?");
        // The preview window query; the detail query only joins chunk counts.
        if (text.includes("select id, ordinal, original_text")) return [];
        return [
          {
            external_id: FILE_ID,
            title: "karma",
            version_id: "11111111-1111-1111-1111-111111111111",
            created_at: new Date("2026-09-17T10:00:00.000Z"),
            chars: 900,
            metadata: metadata(upload),
            chunk_count: 4,
          },
        ];
      }) as unknown as Sql;
      return await new PostgresFilesStore({ db: fakeSql }).showFile(FILE_ID);
    };

    const read = await detailFor({
      name: "karma.pdf",
      kind: "pdf",
      sha256: SHA,
      pages: 5,
      page_stats: { pageCount: 5, pagesWithText: 5, emptyPages: [], ocrPages: [3, 4, 5] },
      warnings: ["OCR_PAGES:3", "3 sayfa yerel OCR ile okundu"],
    });
    // Before W21: ocr was hard-coded false and ocrPages never left the store.
    expect(read?.extraction).toEqual({ chars: 900, chunkCount: 4, pages: 5, ocr: true });
    expect(read?.pages).toEqual({ pageCount: 5, pagesWithText: 5, emptyPages: [], ocrPages: [3, 4, 5] });

    const unread = await detailFor({
      name: "tarama.pdf",
      kind: "pdf",
      sha256: SHA,
      pages: 3,
      page_stats: { pageCount: 3, pagesWithText: 2, emptyPages: [3] },
      warnings: ["SCANNED_PAGES:1"],
    });
    expect(unread?.extraction.ocr).toBe(false);
    expect(unread?.pages).toEqual({ pageCount: 3, pagesWithText: 2, emptyPages: [3] });
  });
});

describe("W21 CD1: a 422 EXTRACTION_FAILED body always carries warnings: string[]", () => {
  it("passes the fail-closed machine code and the Turkish sentence through", async () => {
    const app = appWithCli(2, {
      error: {
        kind: "EXTRACTION_FAILED",
        message: "PDF metin katmanı yok denecek kadar az (~0 karakter / 2 sayfa); taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı",
        warnings: ["taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı", "SCANNED_PDF_OCR_FAILED", "OCR_FAILED_PAGES:2"],
      },
    });
    const res = await app.request("/v1/files", { method: "POST", body: uploadForm("tarama.pdf") });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { kind: string; warnings: string[] } };
    expect(body.error.kind).toBe("EXTRACTION_FAILED");
    expect(body.error.warnings).toEqual([
      "taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı",
      "SCANNED_PDF_OCR_FAILED",
      "OCR_FAILED_PAGES:2",
    ]);
  });

  it("an EXTRACTION_FAILED without warnings still answers an array (empty), and non-strings are dropped", async () => {
    const bare = appWithCli(2, { error: { kind: "EXTRACTION_FAILED", message: "şifreli PDF desteklenmiyor" } });
    const res = await bare.request("/v1/files", { method: "POST", body: uploadForm("sifreli.pdf") });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string; warnings: unknown } };
    // Before W21 the field was simply absent here.
    expect(body.error.warnings).toEqual([]);
    expect(body.error.message).toBe("şifreli PDF desteklenmiyor");

    expect(
      extractionFailureBody({
        error: { kind: "EXTRACTION_FAILED", message: "x", warnings: ["SCANNED_PDF_NO_OCR", 7, null, "taranmış PDF — OCR bu modda devre dışı"] },
      }),
    ).toEqual({
      error: { kind: "EXTRACTION_FAILED", message: "x", warnings: ["SCANNED_PDF_NO_OCR", "taranmış PDF — OCR bu modda devre dışı"] },
    });
  });

  it("the reanalyze route shares the same mapping", async () => {
    const app = appWithCli(2, { error: { kind: "EXTRACTION_FAILED", message: "bütünlük" } });
    const res = await app.request(`/v1/files/${FILE_ID}/reanalyze`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { warnings: unknown } }).error.warnings).toEqual([]);
  });

  it("other typed errors are passed through unchanged", async () => {
    const app = appWithCli(2, { error: { kind: "UNSUPPORTED_TYPE", message: "desteklenmeyen tür" } });
    const res = await app.request("/v1/files", { method: "POST", body: uploadForm("a.pdf") });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: { kind: "UNSUPPORTED_TYPE", message: "desteklenmeyen tür" } });
  });
});
