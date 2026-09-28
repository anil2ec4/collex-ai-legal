/**
 * /v1/files hono sub-router (wire contract #1 — tenant uploads).
 *
 *   POST   /v1/files            multipart upload (field "file") -> IntakeResult
 *                               (+ additive `action`, `message`, `pages`)
 *   GET    /v1/files[?q=]       {files: [...]} (direct SQL via FilesReadStore;
 *                               `q` = Turkish-insensitive name filter)
 *   GET    /v1/files/{id}[?chunks=12&offset=0]
 *                               detail incl. analysis + a WINDOW of chunk
 *                               previews (`chunkCount` = total, additive
 *                               `chunkWindow`, `pages`)
 *   DELETE /v1/files/{id}       204 (doc, versions, chunks, jobs, original gone)
 *
 * WRITE operations shell to the Python intake CLI — quarantine, extraction,
 * heuristic analysis and the ingestion pipeline all live there:
 *
 *   .venv python -X utf8 -m intake.cli --dsn <dsn> --file <tmp> --json
 *   .venv python -X utf8 -m intake.cli --dsn <dsn> --delete <fileId>
 *
 * via a dependency-injected runner (`deps.exec`), so tests assert the CLI
 * contract with a fake and never spawn a process. The default runner uses
 * `node:child_process.execFile` with an argument ARRAY — no shell is ever
 * involved, so no file name or id can inject into a command line. The CLI's
 * typed errors ({error:{kind,message}}, exit 2) map onto HTTP:
 *
 *   INVALID_REQUEST -> 400, UNSUPPORTED_TYPE -> 415,
 *   EXTRACTION_FAILED -> 422 (its body ALWAYS carries `error.warnings:
 *   string[]`, W21 CD1: a scanned PDF's cause travels there as one machine
 *   code — SCANNED_PDF_NO_OCR / SCANNED_PDF_OCR_FAILED /
 *   SCANNED_PDF_OCR_NOT_APPLIED — so the console never matches prose),
 *   NOT_FOUND -> 404,
 *   STORE_UNAVAILABLE -> 503 (contract [X]: the CLI answers it within ~6 s
 *   when the local PostgreSQL does not accept a connection).
 *
 * A CLI process that overruns its 180 s budget is killed and answered as a
 * typed 504 UPLOAD_TIMEOUT (never an empty 500).
 *
 * READ operations never shell out: they go through the injected
 * FilesReadStore (direct SQL over the same tables the pipeline wrote). A
 * connection-level failure of that store is the same typed 503.
 *
 * The upload cap is PRE-CHECKED here before any bytes hit disk; the Python
 * quarantine enforces the same cap again (defense in depth).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { foldTurkishForFilter } from "../retrieval/normalize.js";
import { invalidateLexicalStats } from "../store/chunkStore.js";
import {
  DEFAULT_CHUNK_WINDOW,
  DEFAULT_FILE_PAGE,
  MAX_CHUNK_WINDOW,
  MAX_FILE_PAGE,
  extractionUsedOcr,
  pageStatsOf,
  type FileDetail,
  type FileListEntry,
  type FilesReadStore,
} from "./store.js";
import { databaseDownHintTr } from "../platform/operatorHints.js";
import { mountUyapRoutes, type UyapMatterDeps } from "./uyapRoutes.js";
import { encodeRfc8187 } from "../drafting/routes.js";

/**
 * Upload cap in MiB. MIRRORS `intake/quarantine.py` `UPLOAD_CAP_MIB` — that
 * file is the source of truth and explains why the value is 25 (one
 * synchronous 180 s intake process, ~50-100 ms per PDF page in pypdf, no
 * progress channel). `tests/files/uploadCap.test.ts` parses the Python
 * constant and fails if the two ever differ.
 */
export const UPLOAD_CAP_MIB = 25;

/** Same cap as intake/quarantine.py MAX_FILE_BYTES. */
export const MAX_UPLOAD_BYTES = UPLOAD_CAP_MIB * 1024 * 1024;

/** Wall budget for one intake-CLI process (upload or delete). */
export const INTAKE_EXEC_TIMEOUT_MS = 180_000;

/** Fixed Turkish messages (lawyer-facing; machine kinds stay English). */
export const STORE_UNAVAILABLE_MESSAGE =
  databaseDownHintTr(); // W21: names the launcher of the platform the server runs on
export const STORE_MISSING_MESSAGE =
  "Yerel veritabanı (collex_local) veya şeması bulunamadı; " +
  "intake.cli --ensure-db ile oluşturun.";
export const UPLOAD_TIMEOUT_MESSAGE =
  "Belge işleme süresi aşıldı (180 sn): dosya çok büyük ya da sayfa sayısı " +
  "çok fazla; daha küçük bir dosya deneyin.";
export const ALREADY_EXISTED_MESSAGE = "Bu belge zaten yüklüydü";

/**
 * Upload ids are the first 16 hex characters of the file's SHA-256
 * (intake/ingest.py). Anything else never reaches the intake CLI
 * (W12-FIX2, P2-14): the id is validated BEFORE a process is spawned.
 */
export const FILE_ID_RE = /^[0-9a-f]{16}$/u;

/** Matter ids are UUIDs (app_private.matters.id). */
export const MATTER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The stored original is `var/uploads/<sha256><ext>` (intake/ingest.py). */
export const ORIGINAL_EXTENSIONS = [".pdf", ".docx", ".txt", ".udf"] as const;
export const SHA256_RE = /^[0-9a-f]{64}$/u;

/**
 * W14 phase C (N-2): the sentence used to name `var/uploads` outright. On an
 * installation that sets `COLLEX_DATA_DIR` — exactly what the backup card
 * advises — the originals live under `<COLLEX_DATA_DIR>/uploads` and
 * `var/uploads` was empty, so the message sent the lawyer to the wrong folder
 * (measured W14-F-VERIFY §6, N-2). It now names the DATA FOLDER, which is the
 * true answer on every installation, and gives the default in parentheses
 * instead of asserting it. The same wording lives in
 * `matters/packageRoutes.ts` and in `api/openapi.yaml`: the three change
 * together or none of them does.
 */
export const ORIGINAL_MISSING_MESSAGE_TR =
  "Bu belgenin aslı bilgisayarda bulunamadı — veri klasörünüzdeki uploads " +
  "klasöründe yok (varsayılan: var/uploads); yalnız çıkarılan metin ve " +
  "alıntılar elinizde.";

/**
 * W14 (B-26): a filter this build cannot apply is a 400 with the reason —
 * never a full list that looks filtered.
 */
export const FILTER_UNSUPPORTED_MESSAGE_TR =
  "Bu süzgeç bu sunucuda uygulanamıyor: belge deposu dava dosyası bağlarını okuyamıyor.";

export function unknownQueryIssues(
  url: string,
  allowed: readonly string[],
): Array<{ path: string; message: string }> {
  const params = new URL(url, "http://127.0.0.1").searchParams;
  const issues: Array<{ path: string; message: string }> = [];
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (allowed.includes(key) || seen.has(key)) continue;
    seen.add(key);
    issues.push({
      path: key,
      message: `Tanınmayan sorgu parametresi. Kullanılabilir: ${allowed.join(", ")}.`,
    });
  }
  return issues;
}

/**
 * W14 (B-18): make the heuristic date list directly transferable to the
 * matter timeline.
 *
 * `intake/analysis.py` emits `{date, context, count}`; the timeline event is
 * `{date, title, source, verified}`. The two never lined up, so a lawyer
 * moving 13 dates had to retype every title AND send 13 POSTs. Here each
 * entry gains `title` (the context, cut at a WORD boundary — UXAUDIT P1-18
 * measured all seven snippets cut mid-word) and `source` (`belge:<fileId>`),
 * so the console can post the array to `/v1/matters/{id}/items:batch`
 * unchanged. `context` and `count` stay: this is additive.
 */
export const DATE_TITLE_MAX_CODE_POINTS = 120;

export function trimToWordBoundary(text: string, maxCodePoints: number): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const points = [...collapsed];
  if (points.length <= maxCodePoints) return collapsed;
  const window = points.slice(0, maxCodePoints).join("");
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(maxCodePoints / 2) ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s.,;:!?…]+$/u, "")}…`;
}

export function withTransferableDates(
  analysis: Record<string, unknown>,
  fileId: string,
): Record<string, unknown> {
  const dates = analysis["dates"];
  if (!Array.isArray(dates)) return analysis;
  const enriched = dates.map((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const row = raw as Record<string, unknown>;
    if (typeof row["title"] === "string" && row["title"] !== "") return row;
    const context = typeof row["context"] === "string" ? row["context"] : "";
    const date = typeof row["date"] === "string" ? row["date"] : "";
    const title = trimToWordBoundary(context, DATE_TITLE_MAX_CODE_POINTS) || date;
    return { ...row, title, source: `belge:${fileId}`, verified: false };
  });
  return { ...analysis, dates: enriched };
}

/** Content-Disposition value for a download, ASCII fallback + UTF-8 form. */
export function attachmentDisposition(fileName: string): string {
  const safe = fileName.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeRfc8187(fileName)}`;
}

/**
 * What a client is told when the intake CLI died unexpectedly: a Turkish
 * sentence plus a correlation id; the child's stderr goes to the server log
 * under that id and never into a response (P2-14).
 */
export function intakeFailureDetail(correlationId: string): string {
  return `Ayrıntı sunucu günlüğüne yazıldı (kayıt no: ${correlationId}).`;
}

// ---------------------------------------------------------------------------
// Intake-CLI process dependency
// ---------------------------------------------------------------------------

export interface IntakeExecRequest {
  pythonPath: string;
  args: string[];
  cwd: string;
  /**
   * Additive (W22): wall budget for THIS process. Absent = the upload budget
   * `INTAKE_EXEC_TIMEOUT_MS`. Only the UYAP folder preview asks for more —
   * it reads every document of a download in one process.
   */
  timeoutMs?: number;
}

/**
 * THE argument vector of a single-document intake (W22). `POST /v1/files`
 * and the UYAP import (`uyapRoutes.ts`) both build it here, so the import
 * cannot drift into a second intake path: same module, same flags, same
 * `process_file`.
 */
export function intakeFileArgs(dsn: string, path: string): string[] {
  return ["-X", "utf8", "-m", "intake.cli", "--dsn", dsn, "--file", path, "--json"];
}

export interface IntakeExecResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Additive: the runner killed the process because it overran its budget. */
  timedOut?: boolean;
}

export type IntakeExec = (request: IntakeExecRequest) => Promise<IntakeExecResult>;

/** Repo root, derived from this module's location (control-plane/src/files). */
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
const execFileRunner: IntakeExec = ({ pythonPath, args, cwd, timeoutMs }) =>
  new Promise((resolvePromise) => {
    execFile(
      pythonPath,
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        timeout: timeoutMs ?? INTAKE_EXEC_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as unknown as { code: number }).code
              : 1;
        // execFile's timeout kills the child (killed=true, signal=SIGTERM).
        const timedOut =
          error !== null && (error as { killed?: unknown }).killed === true;
        resolvePromise({
          code,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          ...(timedOut ? { timedOut: true } : {}),
        });
      },
    );
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** kind -> HTTP status for the intake CLI's typed error taxonomy. */
const STATUS_BY_KIND: Record<string, 400 | 404 | 415 | 422 | 503> = {
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  UNSUPPORTED_TYPE: 415,
  EXTRACTION_FAILED: 422,
  STORE_UNAVAILABLE: 503,
};

interface CliError {
  error: { kind: string; message: string; warnings?: string[] };
}

export function parseCliJson(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim();
  if (!text.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function isCliError(
  body: Record<string, unknown> | undefined,
): body is CliError & Record<string, unknown> {
  if (body === undefined) return false;
  const error = body["error"];
  return (
    error !== null &&
    typeof error === "object" &&
    typeof (error as Record<string, unknown>)["kind"] === "string"
  );
}

/**
 * Keep only a safe base name for the temp copy: strip directories (path
 * traversal), replace characters Windows cannot store, preserve the SUFFIX
 * (the extension is part of the intake contract — quarantine cross-checks it
 * against the sniffed content, so the tail of the name must survive).
 */
export function safeUploadName(raw: string): string {
  const base =
    raw.replace(/\\/gu, "/").split("/").filter((part) => part !== "").pop() ?? "";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/gu, "_").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "yukleme.bin";
  return cleaned.length > 160 ? cleaned.slice(-160) : cleaned;
}

/** postgres.js / driver error codes that mean "the store is not there". */
const CONNECTION_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08000",
  "08001",
  "08003",
  "08006",
]);

/** PostgreSQL SQLSTATEs that mean "the database or its schema is missing". */
const MISSING_STORE_CODES: ReadonlySet<string> = new Set([
  "3D000", // invalid_catalog_name: database does not exist
  "3F000", // invalid_schema_name
  "42P01", // undefined_table
]);

export type StoreFailureKind = "connection" | "missing" | "other";

/** Classify a thrown read-store error without echoing its text. */
export function classifyStoreError(error: unknown): StoreFailureKind {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const rec = current as { code?: unknown; errno?: unknown; cause?: unknown; name?: unknown };
    const code = typeof rec.code === "string" ? rec.code : undefined;
    if (code !== undefined) {
      if (MISSING_STORE_CODES.has(code)) return "missing";
      if (CONNECTION_ERROR_CODES.has(code)) return "connection";
    }
    if (rec.name === "TimeoutError" || rec.name === "AbortError") return "connection";
    current = rec.cause;
  }
  return "other";
}

/** Upload cap in bytes as the Python side computes it (kept for parity tests). */
export function uploadCapBytes(): number {
  return MAX_UPLOAD_BYTES;
}

/** Turkish-insensitive substring test for the `q` name filter. */
export function nameMatches(name: string, q: string): boolean {
  const needle = foldTurkishForFilter(q).trim();
  if (needle === "") return true;
  return foldTurkishForFilter(name).includes(needle);
}

/**
 * Parse `?chunks=&offset=` into a preview window. Returns a Turkish error
 * message for an unusable value (non-integer, chunks < 1 or > MAX, offset < 0).
 */
export function parseChunkWindow(
  chunks: string | undefined,
  offset: string | undefined,
): { ok: true; window: { limit: number; offset: number } } | { ok: false; message: string } {
  const parseInt10 = (raw: string | undefined, fallback: number): number | undefined => {
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d{1,9}$/u.test(raw)) return undefined;
    return Number(raw);
  };
  const limit = parseInt10(chunks, DEFAULT_CHUNK_WINDOW);
  const start = parseInt10(offset, 0);
  if (limit === undefined || limit < 1 || limit > MAX_CHUNK_WINDOW) {
    return {
      ok: false,
      message: `'chunks' 1 ile ${MAX_CHUNK_WINDOW} arasında bir tam sayı olmalı.`,
    };
  }
  if (start === undefined) {
    return { ok: false, message: "'offset' 0 veya daha büyük bir tam sayı olmalı." };
  }
  return { ok: true, window: { limit, offset: start } };
}

/**
 * Make the upload result's `action` explicit even for an older CLI that
 * did not emit it: `created` unless the CLI (or its warning) says the
 * document already existed. Adds the Turkish `message` for that case.
 */
export function withUploadAction(body: Record<string, unknown>): Record<string, unknown> {
  const declared = body["action"];
  const warnings = Array.isArray(body["warnings"]) ? body["warnings"] : [];
  const existed =
    declared === "already-existed" ||
    (declared === undefined &&
      warnings.some((w) => typeof w === "string" && w.includes("daha önce yüklen")));
  const action = existed ? "already-existed" : "created";
  return {
    ...body,
    action,
    ...(existed && typeof body["message"] !== "string"
      ? { message: ALREADY_EXISTED_MESSAGE }
      : {}),
  };
}

/**
 * W21 (#29): the upload response's `extraction.ocr` says whether local OCR
 * read any page, from what the intake itself reported (`pages.ocrPages` or
 * an `OCR_PAGES:<n>` warning). The CLI still writes a constant `false`
 * there (intake/ingest.py); a `true` it reports is kept.
 */
export function withExtractionOcr(body: Record<string, unknown>): Record<string, unknown> {
  const extraction = body["extraction"];
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) return body;
  const record = extraction as Record<string, unknown>;
  const ocr = record["ocr"] === true || extractionUsedOcr(pageStatsOf(body["pages"]), body["warnings"]);
  return { ...body, extraction: { ...record, ocr } };
}

/**
 * W21 (CD1): a 422 EXTRACTION_FAILED body always carries `warnings` as an
 * array of strings — empty when the intake had nothing to add — so a client
 * can switch on a machine code without first checking that the field exists.
 */
export function extractionFailureBody(
  parsed: { error: { kind: string; message: string; warnings?: unknown } } & Record<string, unknown>,
): Record<string, unknown> {
  const raw = parsed.error.warnings;
  const warnings = Array.isArray(raw) ? raw.filter((w): w is string => typeof w === "string") : [];
  return { ...parsed, error: { ...parsed.error, warnings } };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface FilesRouterDeps {
  /** Local product DSN, handed VERBATIM to the intake CLI (--dsn). */
  dsn?: string;
  /** Read store; required unless a dsn is given (then built from it). */
  store?: FilesReadStore;
  /** Intake-CLI runner; injected as a fake in tests. */
  exec?: IntakeExec;
  pythonPath?: string;
  repoRoot?: string;
  /** Server-log sink for child stderr (default process.stderr); tests inject. */
  log?: (line: string) => void;
  /**
   * W14 (B-30): where `intake/ingest.py` stored the original bytes. Defaults
   * to `<repoRoot>/var/uploads`, the ONE location that module writes to.
   */
  uploadsDir?: string;
  /**
   * W22: the matter side of "UYAP'tan indirdiğim klasörü dosyalarıma
   * dağıt" (`POST /v1/files/uyap-preview`, `POST /v1/files/uyap-import`).
   * Mounted only when given — the routes need the matters and the linker.
   */
  uyap?: UyapMatterDeps;
}

export function createFilesRouter(deps: FilesRouterDeps): Hono {
  if (deps.store === undefined && (deps.dsn === undefined || deps.dsn === "")) {
    throw new Error("createFilesRouter needs a store or a dsn");
  }
  const app = new Hono();
  const repoRoot = deps.repoRoot ?? defaultRepoRoot();
  const pythonPath = deps.pythonPath ?? defaultPythonPath(repoRoot);
  const runIntake = deps.exec ?? execFileRunner;
  const dsn = deps.dsn ?? "";
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const uploadsDir = deps.uploadsDir ?? join(repoRoot, "var", "uploads");

  // postgres.js connects lazily (on first query), so building the store here
  // costs nothing until a read route is actually hit.
  let store = deps.store;
  const getStore = async (): Promise<FilesReadStore> => {
    if (store === undefined) {
      const { PostgresFilesStore } = await import("./store.js");
      store = new PostgresFilesStore({ dsn });
    }
    return store;
  };

  const cliUnavailable = (c: Context): Response =>
    c.json(
      {
        error: {
          kind: "STORE_UNAVAILABLE",
          message: "Belge deposu bu sunucuda yapılandırılmamış.",
        },
      },
      503,
    );

  /** Read-store failure -> typed 503; the message tells the lawyer what to do. */
  const storeFailure = (c: Context, error: unknown): Response => {
    const kind = classifyStoreError(error);
    return c.json(
      {
        error: {
          kind: "STORE_UNAVAILABLE",
          message: kind === "missing" ? STORE_MISSING_MESSAGE : STORE_UNAVAILABLE_MESSAGE,
          ...(kind === "other" ? { detail: "dosya deposu sorgusu başarısız oldu" } : {}),
        },
      },
      503,
    );
  };

  /** Map a finished CLI process onto the typed error responses (shared). */
  const cliFailure = (
    c: Context,
    result: IntakeExecResult,
    parsed: Record<string, unknown> | undefined,
  ): Response => {
    if (result.timedOut === true) {
      return c.json(
        { error: { kind: "UPLOAD_TIMEOUT", message: UPLOAD_TIMEOUT_MESSAGE } },
        504,
      );
    }
    if (result.code === 2 && isCliError(parsed)) {
      const status = STATUS_BY_KIND[parsed.error.kind] ?? 400;
      if (parsed.error.kind === "STORE_UNAVAILABLE") {
        // Fixed Turkish message with the remedy; the CLI's own text is
        // already fixed too, but the hint belongs to this surface.
        return c.json(
          { error: { ...parsed.error, message: STORE_UNAVAILABLE_MESSAGE } },
          503,
        );
      }
      if (parsed.error.kind === "EXTRACTION_FAILED") {
        return c.json(extractionFailureBody(parsed), status);
      }
      return c.json(parsed, status);
    }
    // P2-14: stderr can carry paths, the DSN or a Python traceback; it is
    // logged under a correlation id, and the client gets the id.
    const correlationId = randomUUID();
    log(
      `[collex] INTAKE_FAILED id=${correlationId} code=${result.code} stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
    );
    return c.json(
      {
        error: {
          kind: "INTAKE_FAILED",
          message: "Belge işleme aracı beklenmedik biçimde sonlandı.",
          detail: intakeFailureDetail(correlationId),
          correlationId,
        },
      },
      500,
    );
  };

  if (deps.uyap !== undefined) {
    mountUyapRoutes(app, {
      ...deps.uyap,
      dsn,
      runIntake,
      pythonPath,
      repoRoot,
      log,
      getStore,
      cliFailure,
      configured: dsn !== "" || deps.exec !== undefined,
    });
  }

  app.post("/v1/files/:id/reanalyze", async (c) => {
    if (dsn === "" && deps.exec === undefined) return cliUnavailable(c);
    const fileId = c.req.param("id");
    if (!FILE_ID_RE.test(fileId)) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
    }
    const result = await runIntake({
      pythonPath,
      args: ["-X", "utf8", "-m", "intake.cli", "--dsn", dsn,
        "--reanalyze", fileId, "--store-dir", uploadsDir],
      cwd: repoRoot,
    });
    const parsed = parseCliJson(result.stdout);
    if (result.code !== 0 || result.timedOut === true || parsed === undefined || parsed["fileId"] !== fileId) {
      return cliFailure(c, result, parsed);
    }
    return c.json({ fileId, reanalyzed: true }, 200);
  });

  app.post("/v1/files", async (c) => {
    if (dsn === "" && deps.exec === undefined) return cliUnavailable(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Yükleme isteği bir belge dosyası taşımalı ('file' alanı, multipart/form-data).",
          },
        },
        400,
      );
    }
    const upload = body["file"];
    if (
      upload === null ||
      upload === undefined ||
      typeof upload === "string" ||
      typeof (upload as File).arrayBuffer !== "function"
    ) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "'file' alanında bir dosya bekleniyor",
          },
        },
        400,
      );
    }
    const file = upload as File;
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: `Belge boyutu sınırı aşıldı: ${(file.size / 1_048_576).toFixed(1)} MB > ${UPLOAD_CAP_MIB} MB.`,
          },
        },
        400,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "collex-upload-"));
    try {
      const tempPath = join(workDir, safeUploadName(file.name ?? ""));
      await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
      const result = await runIntake({
        pythonPath,
        args: intakeFileArgs(dsn, tempPath),
        cwd: repoRoot,
      });
      const parsed = parseCliJson(result.stdout);
      if (result.code === 0 && result.timedOut !== true && parsed !== undefined) {
        // New chunks exist: the lexical lane's document-frequency cache is
        // stale (it would also expire on its own TTL; this makes it immediate).
        invalidateLexicalStats();
        const body = withExtractionOcr(withUploadAction(parsed));
        const analysis = body["analysis"];
        const fileId = body["fileId"];
        if (
          analysis !== null &&
          typeof analysis === "object" &&
          !Array.isArray(analysis) &&
          typeof fileId === "string"
        ) {
          // Same B-18 enrichment as the detail read, on the response the
          // console shows immediately after an upload.
          body["analysis"] = withTransferableDates(analysis as Record<string, unknown>, fileId);
        }
        return c.json(body, 200);
      }
      return cliFailure(c, result, parsed);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  const invalidQuery = (c: Context, issues: Array<{ path: string; message: string }>): Response =>
    c.json(
      {
        error: {
          kind: "INVALID_REQUEST",
          message: "Belge listesi filtresi doğrulanamadı.",
          issues,
        },
      },
      400,
    );

  app.get("/v1/files", async (c) => {
    const unknown = unknownQueryIssues(c.req.url, ["q", "matterId", "limit", "offset"]);
    if (unknown.length > 0) return invalidQuery(c, unknown);
    const q = c.req.query("q");
    const matterId = c.req.query("matterId");
    const limitRaw = c.req.query("limit");
    const offsetRaw = c.req.query("offset");
    const issues: Array<{ path: string; message: string }> = [];
    if (matterId !== undefined && matterId !== "" && !MATTER_ID_RE.test(matterId)) {
      issues.push({ path: "matterId", message: "Dava dosyası kimliği UUID biçiminde olmalı." });
    }
    if (limitRaw !== undefined && !/^\d{1,4}$/u.test(limitRaw)) {
      issues.push({ path: "limit", message: `limit 1 ile ${MAX_FILE_PAGE} arasında bir tam sayı olmalı.` });
    }
    if (offsetRaw !== undefined && !/^\d{1,9}$/u.test(offsetRaw)) {
      issues.push({ path: "offset", message: "offset 0 veya daha büyük bir tam sayı olmalı." });
    }
    if (issues.length > 0) return invalidQuery(c, issues);
    const limit = Math.min(MAX_FILE_PAGE, Math.max(1, Number(limitRaw ?? DEFAULT_FILE_PAGE)));
    const offset = Math.max(0, Number(offsetRaw ?? 0));

    try {
      const store = await getStore();
      // W14 (B-26): `matterId` used to be ignored and every document came
      // back. It now really filters — or the request is refused.
      let scoped: readonly string[] | undefined;
      if (matterId !== undefined && matterId !== "") {
        if (store.matterFileIds === undefined) {
          return invalidQuery(c, [{ path: "matterId", message: FILTER_UNSUPPORTED_MESSAGE_TR }]);
        }
        scoped = await store.matterFileIds(matterId);
        if (scoped.length === 0) {
          return c.json({ files: [], page: { offset, limit, total: 0 } }, 200);
        }
      }

      let files: FileListEntry[];
      let page: { offset: number; limit: number; total: number };
      if (store.listFilePage !== undefined) {
        const result = await store.listFilePage({
          limit,
          offset,
          ...(scoped !== undefined ? { fileIds: scoped } : {}),
        });
        files = result.files;
        page = result.page;
      } else {
        // A store from before W14 (or a test fake): page in memory so the
        // wire shape is the same either way.
        const all = await store.listFiles();
        const inScope =
          scoped === undefined ? all : all.filter((f) => scoped.includes(f.fileId));
        files = inScope.slice(offset, offset + limit);
        page = { offset, limit, total: inScope.length };
      }

      // `q` is a NAME filter and is applied to the page (documented): the
      // console uses it as a type-ahead over what is on screen.
      const filtered =
        q !== undefined && q.trim() !== "" ? files.filter((f) => nameMatches(f.name, q)) : files;

      // Additive matter link for the rows of this page (one query, not N).
      let withLinks = filtered;
      if (store.fileMatterLinks !== undefined && filtered.length > 0) {
        try {
          const links = await store.fileMatterLinks(filtered.map((f) => f.fileId));
          withLinks = filtered.map((f) => {
            const link = links.get(f.fileId);
            return link === undefined
              ? f
              : { ...f, matterId: link.matterId, matterTitle: link.matterTitle };
          });
        } catch {
          // A database without the matters tables still lists documents.
          withLinks = filtered;
        }
      }
      return c.json({ files: withLinks, page }, 200);
    } catch (error) {
      return storeFailure(c, error);
    }
  });

  /**
   * W14 (B-29): the document-CONTENT half of the general search. Kept on the
   * files router because this is where the chunk reader lives; the matters
   * router unions it into `GET /v1/matters/search` when it is wired.
   */
  app.get("/v1/files/search", async (c) => {
    const unknown = unknownQueryIssues(c.req.url, ["q", "limit"]);
    if (unknown.length > 0) return invalidQuery(c, unknown);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2 || q.length > 200) {
      return invalidQuery(c, [{ path: "q", message: "Arama 2 ile 200 karakter arasında olmalı." }]);
    }
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined && !/^\d{1,3}$/u.test(limitRaw)) {
      return invalidQuery(c, [{ path: "limit", message: "limit 1 ile 50 arasında bir tam sayı olmalı." }]);
    }
    const limit = Math.min(50, Math.max(1, Number(limitRaw ?? 20)));
    try {
      const store = await getStore();
      if (store.searchChunks === undefined) {
        return invalidQuery(c, [{ path: "q", message: FILTER_UNSUPPORTED_MESSAGE_TR }]);
      }
      const hits = await store.searchChunks(q, { limit });
      return c.json({ q, hits }, 200);
    } catch (error) {
      return storeFailure(c, error);
    }
  });

  app.get("/v1/files/:id", async (c) => {
    const window = parseChunkWindow(c.req.query("chunks"), c.req.query("offset"));
    if (!window.ok) {
      return c.json({ error: { kind: "INVALID_REQUEST", message: window.message } }, 400);
    }
    let detail: FileDetail | undefined;
    try {
      detail = await (await getStore()).showFile(c.req.param("id"), undefined, window.window);
    } catch (error) {
      return storeFailure(c, error);
    }
    if (detail === undefined) {
      return c.json(
        { error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } },
        404,
      );
    }
    // A store that predates windows (a test fake) still answers with one.
    const chunkWindow = detail.chunkWindow ?? {
      offset: window.window.offset,
      limit: window.window.limit,
      total: detail.chunkCount,
    };
    return c.json(
      {
        ...detail,
        // W14 (B-18): `analysis.dates[]` now carries `title` / `source` /
        // `verified`, so the "transfer every date" button can post the array
        // straight to /v1/matters/{id}/items:batch.
        analysis: withTransferableDates(detail.analysis, detail.fileId),
        chunkWindow,
      },
      200,
    );
  });

  /**
   * W14 (B-30): download the ORIGINAL uploaded bytes.
   *
   * ENGRISK measured that nothing in the codebase ever read `var/uploads/`:
   * the lawyer could not get their own PDF back out of ColleX. The file is
   * named `<sha256><ext>` by `intake/ingest.py`; the sha256 comes from the
   * database (and is shape-checked) so no request can name a path.
   */
  app.get("/v1/files/:id/original", async (c) => {
    const fileId = c.req.param("id");
    if (!FILE_ID_RE.test(fileId)) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
    }
    let ref: { sha256: string; kind: string; name: string; mime: string } | undefined;
    try {
      const store = await getStore();
      if (store.originalRef === undefined) {
        return c.json(
          { error: { kind: "NOT_SUPPORTED", message: FILTER_UNSUPPORTED_MESSAGE_TR } },
          501,
        );
      }
      ref = await store.originalRef(fileId);
    } catch (error) {
      return storeFailure(c, error);
    }
    if (ref === undefined) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
    }
    if (!SHA256_RE.test(ref.sha256)) {
      return c.json(
        { error: { kind: "ORIGINAL_NOT_FOUND", message: ORIGINAL_MISSING_MESSAGE_TR } },
        404,
      );
    }
    const candidates = [
      ...(ref.kind !== "" ? [`.${ref.kind.toLowerCase()}`] : []),
      ...ORIGINAL_EXTENSIONS,
    ];
    for (const ext of candidates) {
      if (!ORIGINAL_EXTENSIONS.includes(ext as (typeof ORIGINAL_EXTENSIONS)[number])) continue;
      const path = join(uploadsDir, `${ref.sha256}${ext}`);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        const name = ref.name !== "" ? ref.name : `${fileId}${ext}`;
        return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
          "content-type": ref.mime !== "" ? ref.mime : "application/octet-stream",
          "content-length": String(info.size),
          "content-disposition": attachmentDisposition(name),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
      } catch {
        // Try the next extension; a missing file is not an error yet.
      }
    }
    return c.json(
      { error: { kind: "ORIGINAL_NOT_FOUND", message: ORIGINAL_MISSING_MESSAGE_TR } },
      404,
    );
  });

  /**
   * W14 (B-26): what deleting this document would orphan. The console shows
   * it in the confirmation dialog, so "belge silinince taslağın Ek-n satırı
   * öksüz kalıyor, uyarı yok" stops being true.
   */
  app.get("/v1/files/:id/usage", async (c) => {
    const fileId = c.req.param("id");
    if (!FILE_ID_RE.test(fileId)) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
    }
    try {
      const store = await getStore();
      if (store.fileUsage === undefined) {
        return c.json(
          { error: { kind: "NOT_SUPPORTED", message: FILTER_UNSUPPORTED_MESSAGE_TR } },
          501,
        );
      }
      // 27.09.2026: an id with no document behind it is 404 like on every
      // other file route. It used to answer 200 with empty lists — which the
      // delete dialog reads as "nothing depends on this document".
      const exists =
        store.originalRef !== undefined
          ? (await store.originalRef(fileId)) !== undefined
          : (await store.showFile(fileId, undefined, { offset: 0, limit: 1 })) !== undefined;
      if (!exists) {
        return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
      }
      const usage = await store.fileUsage(fileId);
      const warnings: string[] = [];
      if (usage.matterItems.length > 0) {
        warnings.push(
          `Bu belge ${usage.matterItems.length} dava dosyasında kayıtlı; silinince o kayıtlar da düşer.`,
        );
      }
      if (usage.draftIds.length > 0) {
        warnings.push(
          `${usage.draftIds.length} taslak bu belgeyi ek olarak kullanıyor; silerseniz o ekler dayanaksız kalır.`,
        );
      }
      if (usage.answerRunIds.length > 0) {
        warnings.push(
          `${usage.answerRunIds.length} kayıtlı araştırma bu belge üzerinden soruldu; sorular kayıtta kalır, belge kalmaz.`,
        );
      }
      return c.json({ ...usage, warnings }, 200);
    } catch (error) {
      return storeFailure(c, error);
    }
  });

  app.delete("/v1/files/:id", async (c) => {
    if (dsn === "" && deps.exec === undefined) return cliUnavailable(c);
    const fileId = c.req.param("id");
    // Shape check BEFORE the process: a malformed id cannot name a record.
    if (!FILE_ID_RE.test(fileId)) {
      return c.json({ error: { kind: "NOT_FOUND", message: "Belge kaydı bulunamadı." } }, 404);
    }
    const result = await runIntake({
      pythonPath,
      args: ["-X", "utf8", "-m", "intake.cli", "--dsn", dsn, "--delete", fileId],
      cwd: repoRoot,
    });
    if (result.code === 0 && result.timedOut !== true) {
      invalidateLexicalStats(); // its chunks are gone; see the upload route
      // W14 (B-26): the document is gone, so the matter records that pointed
      // at it must go too — they used to stay as cards referencing nothing.
      try {
        const store = await getStore();
        const removed = await store.removeMatterItemsForFile?.(fileId);
        if (removed !== undefined && removed > 0) {
          log(`[collex] FILE_DELETED fileId=${fileId} matterItemsRemoved=${removed}`);
        }
      } catch {
        // The document is already deleted; bookkeeping failure must not turn
        // a successful delete into an error the console retries.
      }
      return c.body(null, 204);
    }
    return cliFailure(c, result, parseCliJson(result.stdout));
  });

  return app;
}
