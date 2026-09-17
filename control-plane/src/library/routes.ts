/**
 * `/v1/library` — the local library's ingestion door (W14 B-20, second half;
 * ADR-027).
 *
 *   GET  /v1/library/status   what is queued, what has been published, and the
 *                             one count the health page reads
 *   POST /v1/library/ingest   publish the queued envelopes into the local
 *                             database NOW (body `{dryRun?: boolean}`, strict)
 *
 * The write operation shells to the Python publisher — identity, versioning,
 * chunking and the citator edges all live in `ingestion/**`, and the corpus
 * contract must have exactly one implementation:
 *
 *   .venv python -X utf8 -m ingestion.library --dsn <dsn> --dir <libraryDir> --json [--dry-run]
 *
 * through the SAME dependency-injected runner shape the files router uses
 * (`IntakeExec`), so tests assert the process contract with a fake and never
 * spawn anything. The default runner is `execFile` with an argument ARRAY —
 * no shell, so no directory name can inject into a command line.
 *
 * Non-negotiable (CLAUDE.md invariants):
 *  - the child's stderr NEVER reaches an HTTP body. A crash answers
 *    `500 LIBRARY_INGEST_FAILED` with a `correlationId`; the stderr goes to the
 *    server log line carrying that id (same rule as `INTAKE_FAILED`).
 *  - a count this route did not measure is `null`, never 0:
 *    `publicDocuments` is `null` whenever the database did not answer.
 *  - one ingest at a time per process: a second POST while one runs answers
 *    `409 LIBRARY_INGEST_IN_PROGRESS` rather than racing the spool.
 *
 * "queued" and "ingested" are FILE counts on this machine: envelopes waiting
 * in `<libraryDir>/*.json` and envelopes the publisher moved to
 * `<libraryDir>/yayimlandi/` after a successful publish. `publicDocuments` is
 * the DATABASE count (`legal.documents` rows with scope `public`, the very
 * expression `/v1/health.corpus.publicDocuments` evaluates). The three are
 * reported side by side and never summed into one.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { fieldIssues } from "../api/zodIssues.js";
import type { IntakeExec, IntakeExecResult } from "../files/routes.js";
import { databaseDownHintTr } from "../platform/operatorHints.js";

/**
 * Sub-directory the Python publisher MOVES a landed envelope into. Mirrors
 * `ingestion/library.py::PUBLISHED_SUBDIR` — `tests/library/routes.test.ts`
 * parses the Python line so the two cannot drift.
 */
export const PUBLISHED_SUBDIR = "yayimlandi";

/**
 * Wall budget for one publisher process. A library run may hold many
 * documents (every "tam metni getir" since the last run), and each one is a
 * full chunking + relation pass, so this is deliberately wider than the
 * 180 s upload budget. Overrun -> typed 504, never an empty 500.
 */
export const LIBRARY_EXEC_TIMEOUT_MS = 600_000;

export const LIBRARY_UNAVAILABLE_MESSAGE_TR =
  "Kütüphane yayımı bu sunucuda yapılandırılmadı (veritabanı adresi yok).";
export const LIBRARY_IN_PROGRESS_MESSAGE_TR =
  "Bir kütüphane yayımı zaten sürüyor; bitmesini bekleyin.";
export const LIBRARY_TIMEOUT_MESSAGE_TR =
  "Kütüphane yayımı süresi aşıldı (600 sn); kuyruk yerinde duruyor, işlemi yeniden başlatın.";
export const LIBRARY_FAILED_MESSAGE_TR =
  "Kütüphane yayım aracı beklenmedik biçimde sonlandı.";
/** Same remedy sentence as the files router: the fix is the launcher. */
export const LIBRARY_STORE_UNAVAILABLE_MESSAGE_TR =
  databaseDownHintTr(); // W21: names the launcher of the platform the server runs on

export function libraryFailureDetail(correlationId: string): string {
  return `Ayrıntı sunucu günlüğüne yazıldı (kayıt no: ${correlationId}).`;
}

/** The report the Python publisher prints under `{"library": ...}`. */
export interface LibraryIngestReport {
  spoolDir: string;
  dryRun: boolean;
  scanned: number;
  published: number;
  skipped: number;
  failed: number;
  unchanged: number;
  reverted: number;
  rejected: number;
  pipelineFailed: number;
  moved: number;
  chunks: number;
  relations: number;
  documents: Array<Record<string, unknown>>;
  rejectedEnvelopes: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
}

/** What `/v1/library/status` remembers about the newest run in this process. */
export interface LibraryLastIngest {
  at: string;
  dryRun: boolean;
  scanned: number;
  published: number;
  skipped: number;
  failed: number;
  chunks: number;
}

export interface LibraryStatus {
  libraryDir: string;
  /** Envelope files waiting in `<libraryDir>/*.json`. */
  queued: number;
  /** Envelope files the publisher moved to `<libraryDir>/yayimlandi/`. */
  ingested: number;
  /** `legal.documents` rows with scope 'public'; null when not measured. */
  publicDocuments: number | null;
  running: boolean;
  lastIngest: LibraryLastIngest | null;
}

export interface LibraryRouterDeps {
  /** The spool `serve.mjs --library-dir` writes to. Required. */
  libraryDir: string;
  /** DSN handed to the publisher; without it (and without `exec`) POST answers 503. */
  dsn?: string;
  /** Publisher-process runner; injected as a fake in tests. */
  exec?: IntakeExec;
  pythonPath?: string;
  repoRoot?: string;
  /** Server-log sink for child stderr (default process.stderr); tests inject. */
  log?: (line: string) => void;
  /**
   * Bounded public-document count — `countCorpus` over the SAME `sql` the
   * health page uses. Absent or rejecting -> `publicDocuments: null`.
   */
  publicDocuments?: () => Promise<number | null>;
  now?: () => Date;
}

const ingestBodySchema = z.object({ dryRun: z.boolean().optional() }).strict();

function turkishZodMessage(message: string): string {
  if (message.startsWith("Unrecognized key")) return "Tanınmayan alan.";
  if (message.startsWith("Expected boolean")) return "Doğru/yanlış değeri bekleniyor.";
  return message;
}

/** Repo root, derived from this module's location (control-plane/src/library). */
function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** ALWAYS the repo venv interpreter — never a bare `python` (CLAUDE.md). */
function defaultPythonPath(repoRoot: string): string {
  return process.platform === "win32"
    ? join(repoRoot, ".venv", "Scripts", "python.exe")
    : join(repoRoot, ".venv", "bin", "python");
}

/** Real runner: execFile + argument array — shell-free by construction. */
const execFileRunner: IntakeExec = ({ pythonPath, args, cwd }) =>
  new Promise((resolvePromise) => {
    execFile(
      pythonPath,
      args,
      { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: LIBRARY_EXEC_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as unknown as { code: number }).code
              : 1;
        const timedOut = error !== null && (error as { killed?: unknown }).killed === true;
        resolvePromise({
          code,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          ...(timedOut ? { timedOut: true } : {}),
        });
      },
    );
  });

/** Count `*.json` envelopes in one directory (non-recursive); 0 when absent. */
export async function countEnvelopes(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function parseCliJson(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim();
  if (text === "") return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function isCliError(
  parsed: Record<string, unknown> | undefined,
): parsed is { error: { kind: string; message: string } } {
  if (parsed === undefined) return false;
  const error = parsed["error"];
  return (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { kind?: unknown }).kind === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isReport(value: unknown): value is LibraryIngestReport {
  if (value === null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r["scanned"] === "number" &&
    typeof r["published"] === "number" &&
    typeof r["skipped"] === "number" &&
    typeof r["failed"] === "number" &&
    typeof r["dryRun"] === "boolean"
  );
}

export function createLibraryRouter(deps: LibraryRouterDeps): Hono {
  if (typeof deps.libraryDir !== "string" || deps.libraryDir === "") {
    throw new Error("createLibraryRouter needs a libraryDir");
  }
  const app = new Hono();
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const pythonPath = deps.pythonPath ?? defaultPythonPath(repoRoot);
  const libraryDir = resolve(deps.libraryDir);
  const run = deps.exec ?? execFileRunner;
  const dsn = deps.dsn ?? "";
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = deps.now ?? (() => new Date());
  const configured = dsn !== "" || deps.exec !== undefined;

  let running: Promise<Response> | null = null;
  let lastIngest: LibraryLastIngest | null = null;

  const status = async (): Promise<LibraryStatus> => {
    const [queued, ingested, publicDocuments] = await Promise.all([
      countEnvelopes(libraryDir),
      countEnvelopes(join(libraryDir, PUBLISHED_SUBDIR)),
      deps.publicDocuments === undefined
        ? Promise.resolve<number | null>(null)
        : deps.publicDocuments().catch((): number | null => null),
    ]);
    return {
      libraryDir,
      queued,
      ingested,
      publicDocuments: typeof publicDocuments === "number" ? publicDocuments : null,
      running: running !== null,
      lastIngest,
    };
  };

  app.get("/v1/library/status", async (c) => c.json(await status()));

  /** Map a finished publisher process onto the typed error responses. */
  const failure = (c: Context, result: IntakeExecResult, parsed: Record<string, unknown> | undefined): Response => {
    if (result.timedOut === true) {
      return c.json({ error: { kind: "LIBRARY_INGEST_TIMEOUT", message: LIBRARY_TIMEOUT_MESSAGE_TR } }, 504);
    }
    if (result.code === 2 && isCliError(parsed)) {
      if (parsed.error.kind === "STORE_UNAVAILABLE") {
        return c.json(
          { error: { kind: "STORE_UNAVAILABLE", message: LIBRARY_STORE_UNAVAILABLE_MESSAGE_TR } },
          503,
        );
      }
      if (parsed.error.kind === "INVALID_REQUEST") {
        return c.json({ error: parsed.error }, 400);
      }
    }
    // stderr can carry paths, the DSN or a Python traceback: logged under a
    // correlation id, and the client gets the id.
    const correlationId = randomUUID();
    log(
      `[collex] LIBRARY_INGEST_FAILED id=${correlationId} code=${result.code} stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
    );
    return c.json(
      {
        error: {
          kind: "LIBRARY_INGEST_FAILED",
          message: LIBRARY_FAILED_MESSAGE_TR,
          detail: libraryFailureDetail(correlationId),
          correlationId,
        },
      },
      500,
    );
  };

  app.post("/v1/library/ingest", async (c) => {
    if (!configured) {
      return c.json({ error: { kind: "LIBRARY_UNAVAILABLE", message: LIBRARY_UNAVAILABLE_MESSAGE_TR } }, 503);
    }
    let body: unknown = {};
    const raw = await c.req.text();
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        return c.json({ error: { kind: "INVALID_REQUEST", message: "Gövde geçerli JSON değil.", issues: [] } }, 400);
      }
    }
    const parsedBody = ingestBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "İstek gövdesi geçersiz.",
            issues: fieldIssues(parsedBody.error, turkishZodMessage),
          },
        },
        400,
      );
    }
    if (running !== null) {
      return c.json({ error: { kind: "LIBRARY_INGEST_IN_PROGRESS", message: LIBRARY_IN_PROGRESS_MESSAGE_TR } }, 409);
    }
    const dryRun = parsedBody.data.dryRun === true;

    running = (async (): Promise<Response> => {
      const result = await run({
        pythonPath,
        args: [
          "-X", "utf8", "-m", "ingestion.library",
          "--dsn", dsn, "--dir", libraryDir, "--json",
          ...(dryRun ? ["--dry-run"] : []),
        ],
        cwd: repoRoot,
      });
      const parsed = parseCliJson(result.stdout);
      const report = parsed?.["library"];
      if (result.timedOut === true || !isReport(report)) {
        return failure(c, result, parsed);
      }
      // Exit 2 with a report = a PARTIAL run: the counts are the truth and
      // `failed > 0` says so. It is answered as 200 with `complete: false`.
      lastIngest = {
        at: now().toISOString(),
        dryRun: report.dryRun,
        scanned: report.scanned,
        published: report.published,
        skipped: report.skipped,
        failed: report.failed,
        chunks: report.chunks,
      };
      return c.json({ ...report, complete: report.failed === 0 }, 200);
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  });

  return app;
}
