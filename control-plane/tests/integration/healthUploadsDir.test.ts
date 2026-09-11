/**
 * W14 M-SRV · IR-1 — `/v1/health.uploadsDir` names the folder the download
 * route actually reads.
 *
 * WHAT WENT WRONG BEFORE. Settings › "Verilerim nerede?" could not name the
 * originals folder; it could only tell the lawyer WHERE the name is written
 * (a launcher line). The reason the field did not exist is the same reason
 * L-VERIFY V-4 happened: the path was computed inside each router, so there
 * was no single value anything else could report. C-UI raised it as IR-1 and
 * C-FINAL refused to write it into `openapi.yaml` while the server did not
 * send it (§4, "yazmadıklarım").
 *
 * WHAT THESE TESTS PIN. Not "a string is present" — that would pass with a
 * hardcoded constant. They pin the COUPLING: in the SAME app instance, the
 * path `/v1/health` reports is the path `GET /v1/files/{id}/original` serves
 * the bytes from. Point the app at a folder that holds the original and both
 * agree and the download succeeds; point it at one that does not and both
 * agree and the download 404s. A decorative field cannot pass both halves.
 *
 * Fully offline: a fake read store and a temp directory, no database, no
 * intake process.
 */

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../src/api/server.js";
import { resolveUploadsDir } from "../../src/api/healthReport.js";
import type { IntakeExec } from "../../src/files/routes.js";
import type {
  FileListEntry,
  FileListOptions,
  FileListPage,
  FilesReadStore,
} from "../../src/files/store.js";

const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FILE_ID = SHA.slice(0, 16);

const entry: FileListEntry = {
  fileId: FILE_ID,
  name: "İhtarname_Şahin.pdf",
  mime: "application/pdf",
  sha256: SHA,
  kind: "pdf",
  uploadedAt: "2026-09-02T10:00:00.000Z",
  chars: 12_000,
  chunkCount: 40,
};

/** Minimal read store: enough for the list page and the original reference. */
function store(): FilesReadStore {
  return {
    listFiles: async () => [entry],
    showFile: async () => undefined,
    getChunks: async () => [],
    listFilePage: async (opts: FileListOptions): Promise<FileListPage> => ({
      files: [entry],
      page: { offset: opts.offset ?? 0, limit: opts.limit ?? 12, total: 1 },
    }),
    originalRef: async (fileId: string) =>
      fileId === FILE_ID
        ? { sha256: SHA, kind: "pdf", name: entry.name, mime: "application/pdf" }
        : undefined,
  };
}

/** The intake CLI is never spawned by these tests; a call would be a defect. */
const refuseExec: IntakeExec = async () => {
  throw new Error("the intake CLI must not be spawned by a health/original test");
};

async function withDataDir<T>(dir: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env["COLLEX_DATA_DIR"];
  if (dir === undefined) delete process.env["COLLEX_DATA_DIR"];
  else process.env["COLLEX_DATA_DIR"] = dir;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env["COLLEX_DATA_DIR"];
    else process.env["COLLEX_DATA_DIR"] = previous;
  }
}

interface HealthBody {
  uploadsDir?: unknown;
  status: string;
}

async function health(app: {
  request: (path: string) => Response | Promise<Response>;
}): Promise<HealthBody> {
  const res = await app.request("/v1/health");
  expect(res.status).toBe(200);
  return (await res.json()) as HealthBody;
}

describe("IR-1 · /v1/health reports the resolved originals directory", () => {
  it("names the COLLEX_DATA_DIR folder the original is downloaded from", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "collex-msrv-data-"));
    try {
      const uploads = join(dataDir, "uploads");
      await mkdir(uploads, { recursive: true });
      const bytes = Buffer.from("%PDF-1.7\nAslı bu klasörde\n", "utf8");
      await writeFile(join(uploads, `${SHA}.pdf`), bytes);

      const app = await withDataDir(dataDir, async () =>
        createApp({ filesStore: store(), filesExec: refuseExec, serveConsole: false }),
      );

      const body = await health(app);
      expect(body.uploadsDir).toBe(resolve(uploads));

      // THE COUPLING: the very folder health named is the one the bytes came
      // from. If the field were a decoration, this half would still pass but
      // the next test's half could not.
      const original = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(original.status).toBe(200);
      expect(Buffer.from(await original.arrayBuffer()).equals(bytes)).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("tracks the folder: a data dir WITHOUT the original is reported and 404s", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "collex-msrv-empty-"));
    try {
      const uploads = join(emptyDir, "uploads");
      await mkdir(uploads, { recursive: true });

      const app = await withDataDir(emptyDir, async () =>
        createApp({ filesStore: store(), filesExec: refuseExec, serveConsole: false }),
      );

      const body = await health(app);
      expect(body.uploadsDir).toBe(resolve(uploads));

      const original = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(original.status).toBe(404);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("an explicit uploadsDir wins over the environment, and health says so", async () => {
    const explicitDir = await mkdtemp(join(tmpdir(), "collex-msrv-explicit-"));
    const envDir = await mkdtemp(join(tmpdir(), "collex-msrv-env-"));
    try {
      const bytes = Buffer.from("aslı, açıkça verilen klasörde", "utf8");
      await writeFile(join(explicitDir, `${SHA}.pdf`), bytes);
      await mkdir(join(envDir, "uploads"), { recursive: true });

      const app = await withDataDir(envDir, async () =>
        createApp({
          filesStore: store(),
          filesExec: refuseExec,
          uploadsDir: explicitDir,
          serveConsole: false,
        }),
      );

      const body = await health(app);
      expect(body.uploadsDir).toBe(resolve(explicitDir));
      expect(body.uploadsDir).not.toBe(resolve(join(envDir, "uploads")));

      const original = await app.request(`/v1/files/${FILE_ID}/original`);
      expect(original.status).toBe(200);
    } finally {
      await rm(explicitDir, { recursive: true, force: true });
      await rm(envDir, { recursive: true, force: true });
    }
  });

  it("without COLLEX_DATA_DIR it reports the real default, not nothing", async () => {
    const app = await withDataDir(undefined, async () =>
      createApp({
        filesStore: store(),
        filesExec: refuseExec,
        python: { repoRoot: join("D:", "ColleX-Depo") },
        serveConsole: false,
      }),
    );
    const body = await health(app);
    // The `<repoRoot>/var/uploads` fallback each router used to apply on its
    // own is now applied ONCE, in createApp, so health can report it.
    expect(body.uploadsDir).toBe(resolve(join("D:", "ColleX-Depo", "var", "uploads")));
  });

  it("resolveUploadsDir: absolute, data-dir first, repo fallback second", () => {
    expect(
      resolveUploadsDir({
        uploadsDir: join("D:", "ColleX-Veri", "uploads"),
        repoRoot: join("C:", "repo"),
      }),
    ).toBe(resolve(join("D:", "ColleX-Veri", "uploads")));
    expect(resolveUploadsDir({ uploadsDir: "   ", repoRoot: join("C:", "repo") })).toBe(
      resolve(join("C:", "repo", "var", "uploads")),
    );
    expect(resolveUploadsDir({ repoRoot: join("C:", "repo") })).toBe(
      resolve(join("C:", "repo", "var", "uploads")),
    );
  });
});
