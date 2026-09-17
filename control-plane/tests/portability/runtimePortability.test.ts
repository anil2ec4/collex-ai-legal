/**
 * W21 platform lane — acceptance K: no Windows-only assumption in RUNTIME code.
 *
 * The production host is an Apple Silicon Mac; development happens on
 * Windows. This test reads the runtime sources —
 *
 *   control-plane/src/**\/*.ts, control-plane/scripts/*.mjs,
 *   intake/*.py, ingestion/*.py, semantic_search/*.py, export/*.py
 *
 * — with comments and docstrings removed, and flags every line that assumes
 * Windows:
 *
 *   DRIVE_LETTER_PATH   a string literal that starts with `C:\` / `C:/`
 *   WINDOWS_SHELL       "cmd" / "cmd.exe" / "powershell" / "pwsh" as a
 *                       program, or `shell: true` / `shell=True`
 *   WINDOWS_ONLY_TOOL   robocopy, taskkill, tasklist, where.exe, wmic,
 *                       icacls, schtasks, reg.exe — or `"where"` as a program
 *   VENV_SCRIPTS        the Windows venv layout (`.venv/Scripts`, "Scripts")
 *   BACKSLASH_PATH_JOIN a path built with "\\" (`a + "\\" + b`,
 *                       `.join("\\")`, "var\\uploads")
 *   EXE_SUFFIX          a hard-coded "<name>.exe" program
 *   WINDOWS_ONLY_API    winreg / msvcrt / windll / _winapi / os.startfile
 *
 * A finding is acceptable only when it is ALLOW-LISTED below with a reason
 * and an exact count. Where the reason is "a platform branch", the entry
 * also names the portable counterpart the file must contain (`requires`),
 * so deleting the macOS half of a branch fails here. A stale allowance
 * (fewer findings than listed) fails too: the list cannot quietly outlive
 * the code it excuses.
 *
 * The scanner itself is tested against known-bad and known-harmless text
 * at the bottom, so a regex that silently matches nothing cannot pass.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

// ---------------------------------------------------------------------------
// Comment / docstring removal (line-preserving)
// ---------------------------------------------------------------------------

type Lang = "js" | "py";

interface CodeLine {
  line: number;
  code: string;
}

/** Could a `/` at this point start a regex literal (rather than divide)? */
function regexCanStart(before: string): boolean {
  const t = before.trimEnd();
  if (t === "") return true;
  return /[(,=:[!&|?{};+\-*%<>~^]$/u.test(t) || /\b(?:return|typeof|case|in|of|delete|void|throw|new)$/u.test(t);
}

/** JS/TS: drop // and /* *\/ comments; keep strings, templates and regexes. */
function jsCodeLines(text: string): CodeLine[] {
  const out: CodeLine[] = [];
  let state: "code" | "block" | "tpl" = "code";
  text.split(/\r?\n/u).forEach((raw, index) => {
    let code = "";
    let quote: "'" | '"' | null = null;
    let i = 0;
    while (i < raw.length) {
      const ch = raw[i] as string;
      const next = raw[i + 1];
      if (state === "block") {
        if (ch === "*" && next === "/") {
          state = "code";
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (state === "tpl" || quote !== null) {
        code += ch;
        if (ch === "\\") {
          code += next ?? "";
          i += 2;
          continue;
        }
        if (state === "tpl" && ch === "`") state = "code";
        else if (quote !== null && ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        code += ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        state = "tpl";
        code += ch;
        i += 1;
        continue;
      }
      if (ch === "/" && regexCanStart(code)) {
        let j = i + 1;
        let inClass = false;
        let body = "/";
        while (j < raw.length) {
          const c = raw[j] as string;
          body += c;
          if (c === "\\") {
            body += raw[j + 1] ?? "";
            j += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) {
            j += 1;
            break;
          }
          j += 1;
        }
        code += body;
        i = j;
        continue;
      }
      code += ch;
      i += 1;
    }
    out.push({ line: index + 1, code });
  });
  return out;
}

/** Python: drop # comments and docstrings (a string that is a statement by itself). */
function pyCodeLines(text: string): CodeLine[] {
  const out: CodeLine[] = [];
  let docQuote: string | null = null;
  text.split(/\r?\n/u).forEach((raw, index) => {
    if (docQuote !== null) {
      if (raw.includes(docQuote)) docQuote = null;
      out.push({ line: index + 1, code: "" });
      return;
    }
    const opener = /^\s*[rRbBuUfF]{0,2}("""|''')/u.exec(raw);
    if (opener !== null) {
      const q = opener[1] as string;
      if (!raw.slice(opener[0].length).includes(q)) docQuote = q;
      out.push({ line: index + 1, code: "" });
      return;
    }
    let code = "";
    let quote: string | null = null;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i] as string;
      if (quote !== null) {
        code += ch;
        if (ch === "\\") {
          code += raw[i + 1] ?? "";
          i += 1;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === "#") break;
      if (ch === "'" || ch === '"') quote = ch;
      code += ch;
    }
    out.push({ line: index + 1, code });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rules — first match wins, one finding per line
// ---------------------------------------------------------------------------

const RULES = [
  { id: "VENV_SCRIPTS", re: /["'`]Scripts["'`]|\.venv[\\/]+Scripts/u },
  { id: "DRIVE_LETTER_PATH", re: /["'`][A-Za-z]:(?:\\|\/)/u },
  {
    id: "WINDOWS_SHELL",
    re: /["'`](?:cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe)["'`]|\bshell\s*[:=]\s*(?:true|True)\b/iu,
  },
  {
    id: "WINDOWS_ONLY_TOOL",
    re: /\b(?:robocopy|taskkill|tasklist|where\.exe|wmic|icacls|schtasks|reg\.exe)\b|["'`]where["'`]/iu,
  },
  {
    id: "BACKSLASH_PATH_JOIN",
    re: /\+\s*["'`]\\\\["'`]|["'`]\\\\["'`]\s*\+|\.join\(\s*["'`]\\\\["'`]\s*\)|["'`][A-Za-z0-9_.%-]+\\\\[A-Za-z0-9_.%-]+["'`]/u,
  },
  { id: "EXE_SUFFIX", re: /["'`][\w.-]+\.exe["'`]/u },
  { id: "WINDOWS_ONLY_API", re: /\b(?:winreg|msvcrt|windll|_winapi|startfile)\b/u },
] as const;

type RuleId = (typeof RULES)[number]["id"];

interface Finding {
  file: string;
  line: number;
  rule: RuleId;
  code: string;
}

function scanText(file: string, text: string, lang: Lang): Finding[] {
  const lines = lang === "py" ? pyCodeLines(text) : jsCodeLines(text);
  const findings: Finding[] = [];
  for (const { line, code } of lines) {
    for (const rule of RULES) {
      if (rule.re.test(code)) {
        findings.push({ file, line, rule: rule.id, code: code.trim().slice(0, 160) });
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The runtime sources
// ---------------------------------------------------------------------------

const SCAN_ROOTS: Array<{ dir: string; recursive: boolean; ext: string; lang: Lang }> = [
  { dir: "control-plane/src", recursive: true, ext: ".ts", lang: "js" },
  { dir: "control-plane/scripts", recursive: false, ext: ".mjs", lang: "js" },
  { dir: "intake", recursive: false, ext: ".py", lang: "py" },
  { dir: "ingestion", recursive: false, ext: ".py", lang: "py" },
  { dir: "semantic_search", recursive: false, ext: ".py", lang: "py" },
  { dir: "export", recursive: false, ext: ".py", lang: "py" },
];

function listFiles(dir: string, recursive: boolean, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (recursive) out.push(...listFiles(full, recursive, ext));
    } else if (name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

function scanRuntime(): { files: number; findings: Finding[] } {
  let files = 0;
  const findings: Finding[] = [];
  for (const root of SCAN_ROOTS) {
    for (const full of listFiles(path.join(REPO_ROOT, root.dir), root.recursive, root.ext)) {
      files += 1;
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
      findings.push(...scanText(rel, readFileSync(full, "utf8"), root.lang));
    }
  }
  return { files, findings };
}

// ---------------------------------------------------------------------------
// Allow-list — every entry says WHY, and how many
// ---------------------------------------------------------------------------

interface Allowance {
  file: string;
  rule: RuleId;
  count: number;
  reason: string;
  /** The portable counterpart the file must also contain. */
  requires?: RegExp;
}

const POSIX_VENV = /["']\.venv["'],\s*["']bin["'],\s*["']python["']/u;
const WIN32_TERNARY =
  'platform branch: `process.platform === "win32"` picks .venv\\Scripts\\python.exe, every other platform .venv/bin/python';

const ALLOWANCES: Allowance[] = [
  { file: "control-plane/src/contracts/routes.ts", rule: "VENV_SCRIPTS", count: 1, reason: WIN32_TERNARY, requires: POSIX_VENV },
  { file: "control-plane/src/drafting/routes.ts", rule: "VENV_SCRIPTS", count: 1, reason: WIN32_TERNARY, requires: POSIX_VENV },
  { file: "control-plane/src/files/routes.ts", rule: "VENV_SCRIPTS", count: 1, reason: WIN32_TERNARY, requires: POSIX_VENV },
  { file: "control-plane/src/library/routes.ts", rule: "VENV_SCRIPTS", count: 1, reason: WIN32_TERNARY, requires: POSIX_VENV },
  { file: "control-plane/src/matters/packageRoutes.ts", rule: "VENV_SCRIPTS", count: 1, reason: WIN32_TERNARY, requires: POSIX_VENV },
  {
    file: "control-plane/src/ocr/ocrStatus.ts",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason:
      "platform branch: venvPythonCandidates tries Scripts\\python.exe only when platform is win32; darwin/linux get .venv/bin/python only",
    requires: /path\.join\(repoRoot,\s*"\.venv",\s*"bin",\s*"python"\)/u,
  },
  {
    file: "control-plane/scripts/serve.mjs",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason:
      "venvPython() probes Scripts\\python.exe AND .venv/bin/python with existsSync (portable); the schema hint text " +
      "is worded from operatorHints now, so only the probe is left (W21 closing re-check)",
    requires: POSIX_VENV,
  },
  {
    file: "control-plane/scripts/serve-mcp.mjs",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason: "candidate list probes Scripts\\python.exe and .venv/bin/python with existsSync (portable)",
    requires: POSIX_VENV,
  },
  {
    file: "control-plane/scripts/demo.mjs",
    rule: "VENV_SCRIPTS",
    count: 3,
    reason:
      "developer demo (not the product runtime): defaultPython() falls back to .venv/bin/python; two hint strings name the " +
      "Windows path — reported",
    requires: POSIX_VENV,
  },
  {
    // W21: the Windows-worded hint that lived in src/store/health.ts moved here
    // behind a platform table (the old health.ts allowance went stale).
    file: "control-plane/src/platform/operatorHints.ts",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason:
      "platform branch: operatorHints() returns the WINDOWS table (.venv/Scripts/python.exe) only when platform is " +
      "win32; darwin/linux get the POSIX table (.venv/bin/python) — hint text only, nothing executes it",
    requires: /python:\s*"\.venv\/bin\/python"/u,
  },
  {
    file: "control-plane/scripts/check-intake-heading-mutations.mjs",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason:
      "DEV TOOL, not runtime: a mutation-check script that hard-codes the Windows venv (breaks on macOS) — reported, " +
      "not owned by this lane",
  },
  {
    file: "control-plane/scripts/check-local-embedding-mutations.mjs",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason:
      "DEV TOOL, not runtime: a mutation-check script that hard-codes the Windows venv (breaks on macOS) — reported, " +
      "not owned by this lane",
  },
  {
    file: "control-plane/scripts/embedding_eval.mjs",
    rule: "VENV_SCRIPTS",
    count: 1,
    reason: "eval tool (W21, another lane): `process.platform === \"win32\" ? \"Scripts\" : \"bin\"` platform branch",
    requires: /process\.platform === "win32" \? "Scripts" : "bin"/u,
  },
  {
    file: "control-plane/scripts/embedding_eval.mjs",
    rule: "EXE_SUFFIX",
    count: 1,
    reason: "eval tool (W21, another lane): `process.platform === \"win32\" ? \"python.exe\" : \"python\"` platform branch",
    requires: /process\.platform === "win32" \? "python\.exe" : "python"/u,
  },
  {
    file: "control-plane/scripts/embedding_eval.mjs",
    rule: "WINDOWS_ONLY_TOOL",
    count: 2,
    reason:
      "eval tool (W21, another lane): tasklist memory reading (call + its label) only inside the win32 branch; darwin " +
      "reads `ps -o rss=`, linux /proc",
    requires: /process\.platform === "darwin"\) \{\s*const out = await captureStdout\("ps"/u,
  },
  {
    file: "control-plane/src/retrieval/referenceParser.ts",
    rule: "BACKSLASH_PATH_JOIN",
    count: 1,
    reason: "false positive: `out += \"\\\\\" + char` escapes a regex metacharacter (RE_SPECIAL) — no path is built",
    requires: /RE_SPECIAL\.has\(char\)\) out \+= "\\\\" \+ char/u,
  },
];

function key(file: string, rule: string): string {
  return `${file} :: ${rule}`;
}

describe("acceptance K: runtime sources carry no unexplained Windows-only assumption", () => {
  const { files, findings } = scanRuntime();

  it("scans a real tree (not an empty glob)", () => {
    expect(files).toBeGreaterThan(100);
  });

  it("every finding is allow-listed with its exact count, and no allowance is stale", () => {
    const counts = new Map<string, Finding[]>();
    for (const finding of findings) {
      const k = key(finding.file, finding.rule);
      counts.set(k, [...(counts.get(k) ?? []), finding]);
    }
    const problems: string[] = [];
    for (const [k, list] of counts) {
      const allowance = ALLOWANCES.find((a) => key(a.file, a.rule) === k);
      if (allowance === undefined) {
        problems.push(`NOT ALLOWED ${k}\n${list.map((f) => `    ${f.file}:${f.line}  ${f.code}`).join("\n")}`);
      } else if (allowance.count !== list.length) {
        problems.push(
          `COUNT ${k}: allow-listed ${allowance.count}, found ${list.length}\n` +
            list.map((f) => `    ${f.file}:${f.line}  ${f.code}`).join("\n"),
        );
      }
    }
    for (const allowance of ALLOWANCES) {
      if (!counts.has(key(allowance.file, allowance.rule))) {
        problems.push(`STALE allowance ${key(allowance.file, allowance.rule)} (no finding left — remove it)`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every platform-branch allowance still carries its portable counterpart", () => {
    for (const allowance of ALLOWANCES) {
      expect(allowance.reason.length, allowance.file).toBeGreaterThan(20);
      if (allowance.requires === undefined) continue;
      const text = readFileSync(path.join(REPO_ROOT, allowance.file), "utf8");
      expect(allowance.requires.test(text), `${allowance.file} lost its portable branch`).toBe(true);
    }
  });
});

describe("the scanner catches what it must and ignores what it should", () => {
  const js = (text: string): RuleId[] => scanText("x.ts", text, "js").map((f) => f.rule);
  const py = (text: string): RuleId[] => scanText("x.py", text, "py").map((f) => f.rule);

  it("flags Windows-only runtime code", () => {
    expect(js('spawnSync("cmd.exe", ["/c", "dir"]);')).toEqual(["WINDOWS_SHELL"]);
    expect(js('spawn("powershell", ["-Command", "x"]);')).toEqual(["WINDOWS_SHELL"]);
    expect(js("spawn(program, args, { shell: true });")).toEqual(["WINDOWS_SHELL"]);
    expect(js('const root = "C:\\\\Users\\\\avukat";')).toEqual(["DRIVE_LETTER_PATH"]);
    expect(js("const root = 'D:/ColleX';")).toEqual(["DRIVE_LETTER_PATH"]);
    expect(js('spawn("robocopy", [src, dst, "/E"]);')).toEqual(["WINDOWS_ONLY_TOOL"]);
    expect(js('spawn("where", ["node"]);')).toEqual(["WINDOWS_ONLY_TOOL"]);
    expect(js('const py = join(root, ".venv", "Scripts", "python.exe");')).toEqual(["VENV_SCRIPTS"]);
    expect(js('const p = dir + "\\\\" + name;')).toEqual(["BACKSLASH_PATH_JOIN"]);
    expect(js('const p = parts.join("\\\\");')).toEqual(["BACKSLASH_PATH_JOIN"]);
    expect(js('const p = "var\\\\uploads";')).toEqual(["BACKSLASH_PATH_JOIN"]);
    expect(js('spawn("pg_dump.exe", args);')).toEqual(["EXE_SUFFIX"]);
    expect(py('subprocess.run(["taskkill", "/F", "/PID", pid])')).toEqual(["WINDOWS_ONLY_TOOL"]);
    expect(py("subprocess.run(args, shell=True)")).toEqual(["WINDOWS_SHELL"]);
    expect(py('python = REPO / ".venv" / "Scripts" / "python.exe"')).toEqual(["VENV_SCRIPTS"]);
    expect(py("import winreg")).toEqual(["WINDOWS_ONLY_API"]);
    expect(py("os.startfile(path)")).toEqual(["WINDOWS_ONLY_API"]);
  });

  it("ignores comments, docstrings and harmless backslash handling", () => {
    expect(js("// robocopy /E merges originals")).toEqual([]);
    expect(js("/* C:\\\\Users\\\\x */ const a = 1;")).toEqual([]);
    expect(js("/**\n * taskkill /F terminates the process\n */\nconst ok = 1;")).toEqual([]);
    expect(js("/**\n * `.venv/Scripts/python.exe -m x`\n */\nconst ok = 1;")).toEqual([]);
    expect(js('if (name.includes("/") || name.includes("\\\\")) throw new Error("x");')).toEqual([]);
    expect(js('const safe = value.replace(/[\\\\/]/gu, "_");')).toEqual([]);
    expect(js('const url = "http://127.0.0.1:8787/v1/health";')).toEqual([]);
    expect(js("const ratio = total / count; const other = a / b;")).toEqual([]);
    expect(py("# taskkill is a Windows tool")).toEqual([]);
    expect(py('"""Usage:\n    .venv/Scripts/python.exe -m intake.cli\n"""\nx = 1')).toEqual([]);
    expect(py('def f():\n    """C:\\\\x docstring."""\n    return 1')).toEqual([]);
    expect(py("if PureWindowsPath(name).drive:  # 'C:evil'")).toEqual([]);
  });
});
