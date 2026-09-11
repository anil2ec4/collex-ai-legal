/**
 * /v1/library router (W14 B-20, second half): the process contract of
 * `python -m ingestion.library`, the three side-by-side counts of
 * `/v1/library/status`, and the typed failure mapping. Fully offline: a fake
 * publisher runner and a temporary spool directory.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/server.js";
import type { IntakeExec, IntakeExecRequest } from "../../src/files/routes.js";
import {
  LIBRARY_EXEC_TIMEOUT_MS,
  LIBRARY_FAILED_MESSAGE_TR,
  LIBRARY_IN_PROGRESS_MESSAGE_TR,
  LIBRARY_STORE_UNAVAILABLE_MESSAGE_TR,
  LIBRARY_TIMEOUT_MESSAGE_TR,
  LIBRARY_UNAVAILABLE_MESSAGE_TR,
  PUBLISHED_SUBDIR,
  countEnvelopes,
  createLibraryRouter,
  libraryFailureDetail,
} from "../../src/library/routes.js";

const DSN = "postgres://postgres@127.0.0.1:55432/collex_fake_test";
const PYTHON = "C:\\fake\\.venv\\Scripts\\python.exe";
const REPO = "C:\\fake\\repo";

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spoolDir: "x",
    dryRun: false,
    scanned: 2,
    published: 1,
    skipped: 1,
    failed: 0,
    unchanged: 1,
    reverted: 0,
    rejected: 0,
    pipelineFailed: 0,
    moved: 1,
    chunks: 7,
    relations: 1,
    documents: [],
    rejectedEnvelopes: [],
    failures: [],
    ...over,
  };
}

interface Scripted {
  code: number;
  stdout: string;
  stderr?: string;
  timedOut?: boolean;
}

function makeRouter(options: {
  libraryDir: string;
  cli?: (request: IntakeExecRequest) => Scripted | Promise<Scripted>;
  publicDocuments?: () => Promise<number | null>;
  dsn?: string;
  noRunner?: boolean;
}) {
  const calls: IntakeExecRequest[] = [];
  const logs: string[] = [];
  const runner: IntakeExec = async (request) => {
    calls.push(request);
    const scripted: Scripted = await (options.cli ?? ((): Scripted => ({ code: 0, stdout: JSON.stringify({ library: report() }) })))(request);
    return { code: scripted.code, stdout: scripted.stdout, stderr: scripted.stderr ?? "", ...(scripted.timedOut ? { timedOut: true } : {}) };
  };
  const app = createLibraryRouter({
    libraryDir: options.libraryDir,
    ...(options.noRunner ? {} : { exec: runner }),
    ...(options.dsn !== undefined ? { dsn: options.dsn } : {}),
    pythonPath: PYTHON,
    repoRoot: REPO,
    log: (line) => logs.push(line),
    ...(options.publicDocuments !== undefined ? { publicDocuments: options.publicDocuments } : {}),
    now: () => new Date("2026-09-10T09:00:00.000Z"),
  });
  return { app, calls, logs };
}

// Test bodies are read as `any` on purpose: every field is asserted explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(res: Response): Promise<any> {
  return (await res.json()) as any;
}

let spool = "";

beforeEach(async () => {
  spool = await mkdtemp(join(tmpdir(), "collex-library-test-"));
});

afterEach(async () => {
  await rm(spool, { recursive: true, force: true });
});

async function envelope(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), "{}\n", "utf8");
}

describe("GET /v1/library/status", () => {
  it("reports queued and ingested FILE counts side by side with the database count", async () => {
    await envelope(spool, "BEDESTEN__a__0000000000000001");
    await envelope(spool, "BEDESTEN__b__0000000000000002");
    await envelope(join(spool, PUBLISHED_SUBDIR), "BEDESTEN__c__0000000000000003");
    await writeFile(join(spool, "half-written.json.123.tmp"), "", "utf8");
    const { app } = makeRouter({ libraryDir: spool, publicDocuments: async () => 42 });

    const res = await app.request("/v1/library/status");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual({
      libraryDir: resolve(spool),
      queued: 2,
      ingested: 1,
      publicDocuments: 42,
      running: false,
      lastIngest: null,
    });
  });

  it("answers 0/0 for a spool that does not exist yet and null for an unmeasured corpus", async () => {
    const { app } = makeRouter({ libraryDir: join(spool, "missing") });
    const body = await readJson(await app.request("/v1/library/status"));
    expect(body.queued).toBe(0);
    expect(body.ingested).toBe(0);
    expect(body.publicDocuments).toBeNull();
  });

  it("a database count that rejects is null, never 0", async () => {
    const { app } = makeRouter({ libraryDir: spool, publicDocuments: async () => { throw new Error("down"); } });
    const body = await readJson(await app.request("/v1/library/status"));
    expect(body.publicDocuments).toBeNull();
  });
});

describe("POST /v1/library/ingest", () => {
  it("spawns the venv publisher with the exact argument spelling and returns its report", async () => {
    const { app, calls } = makeRouter({ libraryDir: spool, dsn: DSN });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.published).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.complete).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      pythonPath: PYTHON,
      cwd: REPO,
      args: ["-X", "utf8", "-m", "ingestion.library", "--dsn", DSN, "--dir", resolve(spool), "--json"],
    });

    // The status page now remembers the run.
    const status = await readJson(await app.request("/v1/library/status"));
    expect(status.lastIngest).toEqual({
      at: "2026-09-10T09:00:00.000Z",
      dryRun: false,
      scanned: 2,
      published: 1,
      skipped: 1,
      failed: 0,
      chunks: 7,
    });
    expect(status.running).toBe(false);
  });

  it("dryRun:true adds --dry-run and nothing else", async () => {
    const { app, calls } = makeRouter({
      libraryDir: spool,
      dsn: DSN,
      cli: () => ({ code: 0, stdout: JSON.stringify({ library: report({ dryRun: true, moved: 0 }) }) }),
    });
    const res = await app.request("/v1/library/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).dryRun).toBe(true);
    expect(calls[0]?.args.at(-1)).toBe("--dry-run");
  });

  it("a partial run (exit 2 with a report) is 200 with complete:false — the counts are the truth", async () => {
    const { app } = makeRouter({
      libraryDir: spool,
      dsn: DSN,
      cli: () => ({ code: 2, stdout: JSON.stringify({ library: report({ failed: 1, rejected: 1, scanned: 3 }) }) }),
    });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.failed).toBe(1);
    expect(body.complete).toBe(false);
  });

  it("rejects an unknown body field by NAME (V-19) and never spawns", async () => {
    const { app, calls } = makeRouter({ libraryDir: spool, dsn: DSN });
    const res = await app.request("/v1/library/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true, force: true }),
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.issues).toEqual([{ path: "force", message: "Tanınmayan alan." }]);
    expect(calls).toHaveLength(0);
  });

  it("maps the publisher's typed STORE_UNAVAILABLE to 503 with the launcher remedy", async () => {
    const { app } = makeRouter({
      libraryDir: spool,
      dsn: DSN,
      cli: () => ({ code: 2, stdout: JSON.stringify({ error: { kind: "STORE_UNAVAILABLE", message: "Yerel veritabanına ulaşılamadı." } }) }),
    });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: { kind: "STORE_UNAVAILABLE", message: LIBRARY_STORE_UNAVAILABLE_MESSAGE_TR } });
  });

  it("maps the publisher's INVALID_REQUEST (a refused database name) to 400", async () => {
    const { app } = makeRouter({
      libraryDir: spool,
      dsn: "postgres://postgres@127.0.0.1:55432/collex_demo",
      cli: () => ({ code: 2, stdout: JSON.stringify({ error: { kind: "INVALID_REQUEST", message: "kütüphane yayımı collex_demo veritabanını kabul etmez" } }) }),
    });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.kind).toBe("INVALID_REQUEST");
  });

  it("a crashed publisher answers 500 with a correlation id; its stderr is in the log line, never in the body", async () => {
    const stderr = "Traceback (most recent call last):\n  psycopg.OperationalError: postgres://postgres@127.0.0.1:55432/x";
    const { app, logs } = makeRouter({
      libraryDir: spool,
      dsn: DSN,
      cli: () => ({ code: 1, stdout: "", stderr }),
    });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.error.kind).toBe("LIBRARY_INGEST_FAILED");
    expect(body.error.message).toBe(LIBRARY_FAILED_MESSAGE_TR);
    expect(body.error.detail).toBe(libraryFailureDetail(body.error.correlationId));
    expect(text).not.toContain("Traceback");
    expect(text).not.toContain("postgres://");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(`id=${body.error.correlationId}`);
    expect(logs[0]).toContain("Traceback");
  });

  it("an overrun publisher is a typed 504", async () => {
    const { app } = makeRouter({ libraryDir: spool, dsn: DSN, cli: () => ({ code: 1, stdout: "", timedOut: true }) });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(504);
    expect(await readJson(res)).toEqual({ error: { kind: "LIBRARY_INGEST_TIMEOUT", message: LIBRARY_TIMEOUT_MESSAGE_TR } });
    expect(LIBRARY_EXEC_TIMEOUT_MS).toBe(600_000);
  });

  it("runs one ingest at a time: a second POST while one runs is 409", async () => {
    let release: (value: Scripted) => void = () => {};
    const gate = new Promise<Scripted>((r) => { release = r; });
    const { app, calls } = makeRouter({ libraryDir: spool, dsn: DSN, cli: () => gate });
    const first = app.request("/v1/library/ingest", { method: "POST" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await app.request("/v1/library/ingest", { method: "POST" });
    expect(second.status).toBe(409);
    expect(await readJson(second)).toEqual({ error: { kind: "LIBRARY_INGEST_IN_PROGRESS", message: LIBRARY_IN_PROGRESS_MESSAGE_TR } });
    expect((await readJson(await app.request("/v1/library/status"))).running).toBe(true);
    release({ code: 0, stdout: JSON.stringify({ library: report() }) });
    expect((await first).status).toBe(200);
    expect(calls).toHaveLength(1);
    // Released: a third run is admitted again.
    expect((await app.request("/v1/library/ingest", { method: "POST" })).status).toBe(200);
  });

  it("without a DSN and without a runner the ingest is a typed 503 and status still answers", async () => {
    const { app } = makeRouter({ libraryDir: spool, noRunner: true });
    const res = await app.request("/v1/library/ingest", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: { kind: "LIBRARY_UNAVAILABLE", message: LIBRARY_UNAVAILABLE_MESSAGE_TR } });
    expect((await app.request("/v1/library/status")).status).toBe(200);
  });
});

describe("cross-runtime bonds", () => {
  it("PUBLISHED_SUBDIR is the Python publisher's own constant", async () => {
    const source = await readFile(fileURLToPath(new URL("../../../ingestion/library.py", import.meta.url)), "utf8");
    const match = source.match(/^PUBLISHED_SUBDIR\s*=\s*"([^"]+)"/mu);
    expect(match?.[1]).toBe(PUBLISHED_SUBDIR);
  });

  it("countEnvelopes ignores the writer's temporary files and nested directories", async () => {
    await envelope(spool, "a");
    await writeFile(join(spool, "a.json.4242.tmp"), "", "utf8");
    await envelope(join(spool, PUBLISHED_SUBDIR), "b");
    expect(await countEnvelopes(spool)).toBe(1);
  });
});

describe("createApp wiring", () => {
  it("mounts /v1/library only when a libraryDir is configured (vaporware gate)", async () => {
    const runner: IntakeExec = async () => ({ code: 0, stdout: JSON.stringify({ library: report() }), stderr: "" });
    const withLibrary = createApp({ libraryDir: spool, libraryExec: runner, serveConsole: false });
    expect((await withLibrary.request("/v1/library/status")).status).toBe(200);
    expect((await withLibrary.request("/v1/library/ingest", { method: "POST" })).status).toBe(200);

    const without = createApp({ serveConsole: false });
    expect((await without.request("/v1/library/status")).status).toBe(404);
    expect((await without.request("/v1/library/ingest", { method: "POST" })).status).toBe(404);
  });

  it("without a database the status reports publicDocuments: null", async () => {
    const runner: IntakeExec = async () => ({ code: 0, stdout: "", stderr: "" });
    const app = createApp({ libraryDir: spool, libraryExec: runner, serveConsole: false });
    const body = await readJson(await app.request("/v1/library/status"));
    expect(body.publicDocuments).toBeNull();
  });
});
