/**
 * W21 platform lane — the control plane's view of local OCR.
 *
 * `probeOcrStatus` runs `python -m intake.ocr --status` ONCE and parses the
 * one JSON object it prints. These tests inject the process runner, so no
 * Python starts, except the last block, which runs the REAL CLI through the
 * repo venv when that venv exists (with OCR switched off, so the answer is
 * deterministic on every machine).
 *
 * The property that matters most: anything short of a well-formed answer is
 * OCR_FAILED — never OCR_READY. Uncertainty about OCR must not read as
 * "scanned pages can be read".
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OCR_PROBE_FAILED_MESSAGE_TR,
  OCR_PYTHON_MISSING_MESSAGE_TR,
  OCR_STATES,
  OCR_STATUS_ARGS,
  createOcrStatusProbe,
  parseOcrStatusOutput,
  probeOcrStatus,
  resolveVenvPython,
  venvPythonCandidates,
  type OcrStatusRunRequest,
  type OcrStatusRunner,
} from "../../src/ocr/ocrStatus.js";

const REPO = path.join(path.sep === "\\" ? "C:\\" : "/", "depo");
const READY_LINE = JSON.stringify({
  state: "OCR_READY",
  provider: "tesseract",
  languages: ["eng", "osd", "tur"],
  rasterizer: "pdftoppm",
  messageTr: "Yerel OCR hazır (tesseract, Türkçe).",
});

function fakeRunner(answer: { code?: number; stdout?: string; timedOut?: boolean; throws?: boolean }): {
  run: OcrStatusRunner;
  calls: OcrStatusRunRequest[];
} {
  const calls: OcrStatusRunRequest[] = [];
  const run: OcrStatusRunner = async (request) => {
    calls.push(request);
    if (answer.throws === true) throw new Error("spawn EACCES");
    return {
      code: answer.code ?? 0,
      stdout: answer.stdout ?? "",
      stderr: "",
      ...(answer.timedOut === true ? { timedOut: true } : {}),
    };
  };
  return { run, calls };
}

const everyPythonExists = (): boolean => true;

describe("venv interpreter resolution is per platform", () => {
  it("darwin and linux use .venv/bin/python and never a Scripts path", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const candidates = venvPythonCandidates(REPO, platform);
      expect(candidates).toEqual([path.join(REPO, ".venv", "bin", "python")]);
      expect(candidates.join(" ")).not.toContain("Scripts");
    }
  });

  it("win32 prefers Scripts\\python.exe and falls back to bin/python", () => {
    const scripts = path.join(REPO, ".venv", "Scripts", "python.exe");
    const bin = path.join(REPO, ".venv", "bin", "python");
    expect(venvPythonCandidates(REPO, "win32")).toEqual([scripts, bin]);
    expect(resolveVenvPython(REPO, { platform: "win32", exists: (f) => f === bin })).toBe(bin);
    expect(resolveVenvPython(REPO, { platform: "win32", exists: () => true })).toBe(scripts);
  });

  it("returns null when no interpreter exists", () => {
    expect(resolveVenvPython(REPO, { platform: "darwin", exists: () => false })).toBeNull();
  });
});

describe("probeOcrStatus", () => {
  it("runs the status CLI through the venv interpreter with an argument array", async () => {
    const { run, calls } = fakeRunner({ stdout: `${READY_LINE}\n` });
    const status = await probeOcrStatus({ repoRoot: REPO, platform: "darwin", exists: everyPythonExists, run });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(path.join(REPO, ".venv", "bin", "python"));
    expect(calls[0]?.args).toEqual(["-m", "intake.ocr", "--status"]);
    expect(calls[0]?.args).toEqual([...OCR_STATUS_ARGS]);
    expect(calls[0]?.cwd).toBe(REPO);
    expect(calls[0]?.timeoutMs).toBeGreaterThan(0);
    expect(status).toEqual({
      state: "OCR_READY",
      provider: "tesseract",
      languages: ["eng", "osd", "tur"],
      rasterizer: "pdftoppm",
      messageTr: "Yerel OCR hazır (tesseract, Türkçe).",
      source: "probe",
    });
  });

  it("passes every documented state through unchanged", async () => {
    for (const state of OCR_STATES) {
      const line = JSON.stringify({ state, provider: null, languages: [], rasterizer: null, messageTr: "durum" });
      const { run } = fakeRunner({ stdout: line });
      const status = await probeOcrStatus({ repoRoot: REPO, platform: "darwin", exists: everyPythonExists, run });
      expect(status.state).toBe(state);
      expect(status.source).toBe("probe");
    }
  });

  it("reads the last line when something precedes the object", async () => {
    const { run } = fakeRunner({ stdout: `uyarı: bir şey\n${READY_LINE}\n\n` });
    const status = await probeOcrStatus({ repoRoot: REPO, platform: "linux", exists: everyPythonExists, run });
    expect(status.state).toBe("OCR_READY");
  });

  it("a missing interpreter is OCR_FAILED and starts nothing", async () => {
    const { run, calls } = fakeRunner({ stdout: READY_LINE });
    const status = await probeOcrStatus({ repoRoot: REPO, platform: "darwin", exists: () => false, run });
    expect(calls).toHaveLength(0);
    expect(status.state).toBe("OCR_FAILED");
    expect(status.source).toBe("probe_failed");
    expect(status.messageTr).toBe(OCR_PYTHON_MISSING_MESSAGE_TR);
  });

  const failures: Array<[string, Parameters<typeof fakeRunner>[0]]> = [
    ["non-zero exit, even with a READY line", { code: 1, stdout: READY_LINE }],
    ["timeout, even with a READY line", { timedOut: true, stdout: READY_LINE }],
    ["the runner throws", { throws: true }],
    ["empty stdout", { stdout: "" }],
    ["not JSON", { stdout: "OCR_READY" }],
    ["an unknown state", { stdout: JSON.stringify({ state: "OCR_MAYBE", provider: null, languages: [], rasterizer: null, messageTr: "x" }) }],
    ["an extra key (strict schema)", { stdout: JSON.stringify({ ...JSON.parse(READY_LINE), path: "/Users/avukat/bin/tesseract" }) }],
    ["a missing key", { stdout: JSON.stringify({ state: "OCR_READY", provider: "tesseract", languages: [], rasterizer: "pdftoppm" }) }],
    ["a JSON array", { stdout: "[]" }],
  ];
  for (const [label, answer] of failures) {
    it(`fails closed on ${label}`, async () => {
      const { run } = fakeRunner(answer);
      const status = await probeOcrStatus({ repoRoot: REPO, platform: "darwin", exists: everyPythonExists, run });
      expect(status.state).toBe("OCR_FAILED");
      expect(status.state).not.toBe("OCR_READY");
      expect(status.source).toBe("probe_failed");
      expect(status.provider).toBeNull();
      expect(status.messageTr).toBe(OCR_PROBE_FAILED_MESSAGE_TR);
    });
  }

  it("parseOcrStatusOutput rejects anything but the documented shape", () => {
    expect(parseOcrStatusOutput(READY_LINE)?.state).toBe("OCR_READY");
    expect(parseOcrStatusOutput("null")).toBeNull();
    expect(parseOcrStatusOutput("{}")).toBeNull();
  });
});

describe("createOcrStatusProbe runs the CLI once per process", () => {
  it("memoizes the first answer, including concurrent callers", async () => {
    const { run, calls } = fakeRunner({ stdout: READY_LINE });
    const probe = createOcrStatusProbe({ repoRoot: REPO, platform: "darwin", exists: everyPythonExists, run });
    const [a, b] = await Promise.all([probe.get(), probe.get()]);
    const c = await probe.get();
    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// Real CLI (repo venv), OCR switched off — cross-runtime contract
// ---------------------------------------------------------------------------

const REAL_REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const realPython = resolveVenvPython(REAL_REPO);

describe.skipIf(realPython === null)("real `python -m intake.ocr --status` (repo venv)", () => {
  it("answers the documented shape; COLLEX_OCR=off reads as OCR_DISABLED", async () => {
    const status = await probeOcrStatus({
      repoRoot: REAL_REPO,
      env: { ...process.env, COLLEX_OCR: "off" },
    });
    expect(status.source).toBe("probe");
    expect(status.state).toBe("OCR_DISABLED");
    expect(status.provider).toBeNull();
  }, 60_000);

  it("the machine's own detection is one of the six states, never guessed", async () => {
    const env = { ...process.env };
    delete env["COLLEX_OCR"];
    const status = await probeOcrStatus({ repoRoot: REAL_REPO, env });
    expect(status.source).toBe("probe");
    expect(OCR_STATES).toContain(status.state);
    // READY is only possible when both programs really exist on PATH.
    if (status.state === "OCR_READY") {
      expect(status.provider).toBe("tesseract");
      expect(status.rasterizer).toBe("pdftoppm");
      expect(status.languages).toContain("tur");
    }
    expect(existsSync(realPython as string)).toBe(true);
  }, 60_000);
});
