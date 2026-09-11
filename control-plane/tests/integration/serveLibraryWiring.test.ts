/**
 * `serve.mjs` must hand the local library to `createApp` (W14 B-20 second
 * half, ADR-027). `tests/library/routes.test.ts` proves the router mounts
 * when `createApp` receives `libraryDir` + `filesDsn`; this file pins the
 * OTHER half of the bond — that the real launcher actually passes them.
 *
 * Why a source parse and not a process: the launcher opens a database, binds
 * a port and may spawn the MCP gateway; the guarded `serve.test.ts` covers
 * that path. What went wrong on 10.09.2026 was cheaper than that — a server
 * built BEFORE the routes existed kept answering 404 on `/v1/library/status`,
 * and the first question was "does serve.mjs even wire the routes?". The
 * answer must stay checkable without a database, the same way
 * `launcher.test.ts` parses the `.cmd` files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const serve = readFileSync(resolve(REPO_ROOT, "control-plane", "scripts", "serve.mjs"), "utf8");

/** The single `createApp({ ... })` call in serve.mjs. */
function createAppCall(): string {
  const start = serve.indexOf("const app = createApp({");
  expect(start).toBeGreaterThan(-1);
  const end = serve.indexOf("\n});", start);
  expect(end).toBeGreaterThan(start);
  return serve.slice(start, end);
}

describe("serve.mjs wires the local library into createApp", () => {
  it("accepts --library-dir and COLLEX_LIBRARY_DIR, defaulting under the data directory", () => {
    expect(serve).toContain('argv[i] === "--library-dir"');
    expect(serve).toContain('process.env["COLLEX_LIBRARY_DIR"] ?? path.join(VAR_DIR, "library")');
    expect(serve).toContain('throw new Error("invalid --library-dir")');
  });

  it("passes libraryDir AND filesDsn — the two deps createApp needs before it mounts /v1/library", () => {
    const call = createAppCall();
    expect(call).toContain("libraryDir: args.libraryDir,");
    expect(call).toContain("filesDsn: args.dsn,");
    // Neither may be conditional: the routes are the vaporware gate for the
    // console's "Kütüphaneye al" card, and a server without them draws it
    // disabled with "GET /v1/library/status → 404".
    expect(call).not.toMatch(/\?\s*\{\s*libraryDir/u);
    expect(call).not.toMatch(/\?\s*\{\s*filesDsn/u);
  });

  it("hands the SAME directory to the spool writer, so what a fetch queues is what the publisher reads", () => {
    const call = createAppCall();
    expect(call).toContain("sourcesLibrary: new FileLocalLibrary(args.libraryDir),");
  });

  it("--ingest-library goes through the mounted route rather than a second code path", () => {
    expect(serve).toContain('argv[i] === "--ingest-library"');
    expect(serve).toContain("/v1/library/ingest`, { method: \"POST\" }");
  });
});
