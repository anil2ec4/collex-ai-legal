/**
 * Local OCR capability as the Python intake runtime sees it (W21 platform
 * lane; mission §17).
 *
 * Scanned PDF pages are read by `intake/ocr.py` — a LOCAL tesseract +
 * pdftoppm pair found on PATH — and nothing in the control plane knew
 * whether that pair existed. An operator could not tell "OCR switched off"
 * from "tesseract installed but the Turkish data missing" without running
 * Python by hand, and /v1/health said nothing at all.
 *
 * This module asks the Python side ONCE: it runs
 *
 *   <repo>/.venv/<Scripts|bin>/python -m intake.ocr --status
 *
 * and parses the single JSON object it prints into a typed `OcrStatus`.
 * The orchestrator wires the result into /v1/health; this file does not
 * touch the server.
 *
 * RULES
 * -----
 * - `execFile` with an argument ARRAY, never a shell, with a timeout.
 * - The interpreter is the repo venv's, picked per platform (Windows
 *   `.venv\Scripts\python.exe`, macOS/Linux `.venv/bin/python`) — the same
 *   rule `src/files/routes.ts` and `serve.mjs` follow. Never a bare
 *   `python`.
 * - Fail closed. A missing interpreter, a non-zero exit, a timeout, or an
 *   answer that does not match the strict schema is reported as
 *   `OCR_FAILED` with `source: "probe_failed"` — NEVER as ready. Uncertainty
 *   about OCR must not read as "your scanned pages can be read".
 * - The Python side prints tool NAMES only (no paths, no environment
 *   values); the strict schema rejects anything else it might add.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The six capability codes `intake/ocr.py` reports (OCR_STATES there). */
export const OCR_STATES = [
  "OCR_READY",
  "OCR_DISABLED",
  "OCR_EXECUTABLE_MISSING",
  "OCR_TURKISH_DATA_MISSING",
  "OCR_RASTERIZER_MISSING",
  "OCR_FAILED",
] as const;

export type OcrState = (typeof OCR_STATES)[number];

export interface OcrStatus {
  state: OcrState;
  /** Engine name found ("tesseract"), or null. */
  provider: string | null;
  /** Languages the engine reported; empty when it was not asked. */
  languages: string[];
  /** Rasterizer name found ("pdftoppm"), or null. */
  rasterizer: string | null;
  /** Plain Turkish sentence for the operator / the health card. */
  messageTr: string;
  /**
   * `probe`: the Python status CLI answered and its answer is shown as is.
   * `probe_failed`: it could not be run or its answer was not understood;
   * the state is then always OCR_FAILED.
   */
  source: "probe" | "probe_failed";
}

/** Exactly what `python -m intake.ocr --status` prints — nothing more. */
const statusSchema = z
  .object({
    state: z.enum(OCR_STATES),
    provider: z.string().min(1).max(64).nullable(),
    languages: z.array(z.string().min(1).max(64)).max(500),
    rasterizer: z.string().min(1).max(64).nullable(),
    messageTr: z.string().min(1).max(500),
  })
  .strict();

/** Wall budget for one status probe (Python start-up + `--list-langs`). */
export const OCR_STATUS_TIMEOUT_MS = 30_000;

export const OCR_STATUS_ARGS: readonly string[] = ["-m", "intake.ocr", "--status"];

export const OCR_PROBE_FAILED_MESSAGE_TR =
  "Taranmış sayfaları okuma (OCR) durumu denetlenemedi; taranmış sayfalar okunmamış sayılır.";
export const OCR_PYTHON_MISSING_MESSAGE_TR =
  "Taranmış sayfaları okuma (OCR) durumu denetlenemedi: Python çalışma ortamı bulunamadı;" +
  " taranmış sayfalar okunmamış sayılır.";

export interface OcrStatusRunRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface OcrStatusRunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

/** Process dependency, injected so tests never start Python. */
export type OcrStatusRunner = (request: OcrStatusRunRequest) => Promise<OcrStatusRunResult>;

/** Real runner: execFile + argument array — shell-free by construction. */
export const execFileOcrStatusRunner: OcrStatusRunner = ({ command, args, cwd, timeoutMs, env }) =>
  new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      {
        cwd,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        ...(env !== undefined ? { env } : {}),
      },
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
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          ...(timedOut ? { timedOut: true } : {}),
        });
      },
    );
  });

/** Repo root, derived from this module's location (control-plane/src/ocr). */
export function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Venv interpreter candidates, in probe order. Windows venvs keep the
 * interpreter in `Scripts\python.exe`; an MSYS-built venv on Windows may use
 * `bin/`, so it is probed second there. macOS and Linux only ever use
 * `bin/python` — a `Scripts` path is never tried on them.
 */
export function venvPythonCandidates(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const posix = path.join(repoRoot, ".venv", "bin", "python");
  return platform === "win32"
    ? [path.join(repoRoot, ".venv", "Scripts", "python.exe"), posix]
    : [posix];
}

export function resolveVenvPython(
  repoRoot: string,
  options: { platform?: NodeJS.Platform; exists?: (file: string) => boolean } = {},
): string | null {
  const exists = options.exists ?? existsSync;
  for (const candidate of venvPythonCandidates(repoRoot, options.platform ?? process.platform)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function failed(messageTr: string): OcrStatus {
  return {
    state: "OCR_FAILED",
    provider: null,
    languages: [],
    rasterizer: null,
    messageTr,
    source: "probe_failed",
  };
}

/**
 * Parse the status CLI's stdout. The LAST non-empty line is the object (a
 * Python start-up warning, should one ever reach stdout, comes before it).
 * Returns null for anything that is not exactly the documented shape.
 */
export function parseOcrStatusOutput(stdout: string): Omit<OcrStatus, "source"> | null {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(last);
  } catch {
    return null;
  }
  const parsed = statusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface OcrStatusOptions {
  repoRoot?: string;
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
  run?: OcrStatusRunner;
  timeoutMs?: number;
  /** Child environment; defaults to the parent's (execFile default). */
  env?: NodeJS.ProcessEnv;
}

/** Run the status CLI once. Never throws; never reports READY on doubt. */
export async function probeOcrStatus(options: OcrStatusOptions = {}): Promise<OcrStatus> {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const python = resolveVenvPython(repoRoot, {
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.exists !== undefined ? { exists: options.exists } : {}),
  });
  if (python === null) return failed(OCR_PYTHON_MISSING_MESSAGE_TR);
  const runner = options.run ?? execFileOcrStatusRunner;
  let result: OcrStatusRunResult;
  try {
    result = await runner({
      command: python,
      args: [...OCR_STATUS_ARGS],
      cwd: repoRoot,
      timeoutMs: options.timeoutMs ?? OCR_STATUS_TIMEOUT_MS,
      ...(options.env !== undefined ? { env: options.env } : {}),
    });
  } catch {
    return failed(OCR_PROBE_FAILED_MESSAGE_TR);
  }
  if (result.timedOut === true || result.code !== 0) return failed(OCR_PROBE_FAILED_MESSAGE_TR);
  const status = parseOcrStatusOutput(result.stdout);
  if (status === null) return failed(OCR_PROBE_FAILED_MESSAGE_TR);
  return { ...status, source: "probe" };
}

export interface OcrStatusProbe {
  /** The status, probed on the first call and remembered afterwards. */
  get(): Promise<OcrStatus>;
}

/**
 * One probe per process: the first `get()` starts the Python CLI, every
 * later call (and every concurrent one) shares that same answer. Installing
 * tesseract therefore shows up after a restart, not mid-flight.
 */
export function createOcrStatusProbe(options: OcrStatusOptions = {}): OcrStatusProbe {
  let pending: Promise<OcrStatus> | null = null;
  return {
    get() {
      pending ??= probeOcrStatus(options);
      return pending;
    },
  };
}
