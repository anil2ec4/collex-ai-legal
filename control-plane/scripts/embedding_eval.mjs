#!/usr/bin/env node
/**
 * Embedding-provider evaluation (W21). Runs the SAME labelled cases through
 * every provider and writes evals/reports/embedding-eval-<date>.{json,md}.
 *
 *   node control-plane/scripts/embedding_eval.mjs --providers local-e5[,env]
 *        [--cases evals/embeddings/cases.synthetic.jsonl[,more.jsonl]]
 *        [--dry-run] [--out evals/reports] [--batch 16] [--timeout-ms 60000]
 *
 * Providers:
 *   local-e5  the product's own local embedding server
 *             (`python -m semantic_search.local_embedding_server`,
 *             multilingual-e5-small, ONNX int8, CPU). This script starts it
 *             on a free loopback port, measures its start-up time and — where
 *             the platform lets a plain process read it — its resident
 *             memory, and STOPS it afterwards. Missing model assets are an
 *             ENVIRONMENT BLOCKER (exit 3), never a pass.
 *   env       the embedding endpoint configured in the environment
 *             (EMBEDDING_PROVIDER, LOCAL_EMBEDDING_*, OPENROUTER_*), through
 *             the SAME data-boundary check the product applies: under
 *             LOCAL_ONLY an endpoint off this machine is refused.
 *
 * `--dry-run` uses deterministic scripted embedders instead of any server: it
 * checks the harness and labels the report "harness check — not a
 * measurement".
 *
 * Nothing here prints passage text, queries, or an API key. No shell is
 * used: every child process is spawned with an argument vector.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importControlPlane } from "./ts-loader.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_FILE = path.join(REPO_ROOT, "var", "models", "multilingual-e5-small", "model_qint8_avx512_vnni.onnx");
const PYTHON = path.join(
  REPO_ROOT,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const KNOWN_PROVIDERS = ["local-e5", "env"];

function parseArgs(argv) {
  const args = {
    providers: [],
    cases: ["evals/embeddings/cases.synthetic.jsonl"],
    dryRun: false,
    out: "evals/reports",
    batch: undefined,
    timeoutMs: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--providers") args.providers = value().split(",").map((p) => p.trim()).filter(Boolean);
    else if (flag === "--cases") args.cases = value().split(",").map((c) => c.trim()).filter(Boolean);
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--out") args.out = value();
    else if (flag === "--batch") args.batch = Number(value());
    else if (flag === "--timeout-ms") args.timeoutMs = Number(value());
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.dryRun && args.providers.length === 0) args.providers = ["betikli-kelime", "betikli-trigram"];
  if (args.providers.length === 0) throw new Error("--providers is required (e.g. local-e5)");
  if (!args.dryRun) {
    for (const name of args.providers) {
      if (!KNOWN_PROVIDERS.includes(name)) throw new Error(`unknown provider: ${name} (known: ${KNOWN_PROVIDERS.join(", ")})`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const evalModule = await importControlPlane("src/evals/embeddingEval.ts");
const { parseEmbeddingCases, runEmbeddingEval, renderEmbeddingEvalMarkdown, scriptedEmbeddingPort } = evalModule;

const cases = [];
for (const file of args.cases) {
  const { cases: parsed, errors } = parseEmbeddingCases(readFileSync(path.resolve(REPO_ROOT, file), "utf8"));
  if (errors.length > 0) {
    console.error(`${file}: ${errors.length} geçersiz satır\n${errors.slice(0, 10).join("\n")}`);
    process.exit(2);
  }
  cases.push(...parsed);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run a program with an argument vector (no shell); stdout, or null on failure. */
function captureStdout(file, argv) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let child;
    try {
      child = spawn(file, argv, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      finish(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? out : null);
    });
  });
}

/**
 * Resident memory of one process, read the way each platform allows without a
 * shell. Returns null when it cannot be read; the harness then records
 * "not measured" instead of a guess.
 */
async function readProcessMemory(pid) {
  if (process.platform === "linux") {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const kb = (name) => {
        const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, "mu").exec(status);
        return match ? Number(match[1]) * 1024 : null;
      };
      const rss = kb("VmRSS");
      return rss === null ? null : { rssBytes: rss, peakBytes: kb("VmHWM"), method: "/proc VmRSS (en yüksek: VmHWM)" };
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    const out = await captureStdout("ps", ["-o", "rss=", "-p", String(pid)]);
    const kb = out === null ? NaN : Number(out.trim());
    return Number.isFinite(kb) && kb > 0 ? { rssBytes: kb * 1024, peakBytes: null, method: "ps rss" } : null;
  }
  if (process.platform === "win32") {
    const out = await captureStdout("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    if (out === null) return null;
    const fields = out.trim().split(/","/u);
    if (fields.length < 5) return null;
    const digits = (fields[fields.length - 1] ?? "").replace(/[^0-9]/gu, "");
    const kb = digits === "" ? NaN : Number(digits);
    return Number.isFinite(kb) && kb > 0
      ? { rssBytes: kb * 1024, peakBytes: null, method: "Windows çalışma kümesi (tasklist)" }
      : null;
  }
  return null;
}

/**
 * Start the product's local embedding server on a free loopback port. The
 * Python process reports its OWN pid (on Windows the venv launcher is a
 * separate process), and `--parent-stdin` makes it exit when this script's
 * pipe closes — even if this script is killed.
 */
async function startLocalE5() {
  if (!existsSync(MODEL_FILE) || !existsSync(PYTHON)) {
    console.error(
      "ENVIRONMENT BLOCKER: yerel E5 model dosyaları ya da proje sanal ortamı (.venv) yok;" +
        " ölçüm yapılmadı. Hazırlık: scripts/prepare_local_embeddings.py",
    );
    process.exit(3);
  }
  const port = await freePort();
  const boot =
    "import os,runpy,sys;sys.stderr.write('COLLEX_EVAL_PID=%d\\n'%os.getpid());sys.stderr.flush();" +
    "sys.argv=['local_embedding_server','--port',sys.argv[1],'--parent-stdin'];" +
    "runpy.run_module('semantic_search.local_embedding_server',run_name='__main__',alter_sys=True)";
  const started = performance.now();
  const child = spawn(PYTHON, ["-c", boot, String(port)], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  let pid = null;
  const tail = [];
  let buffered = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      const match = /^COLLEX_EVAL_PID=(\d+)$/u.exec(line);
      if (match) pid = Number(match[1]);
      else if (line !== "") {
        tail.push(line);
        if (tail.length > 20) tail.shift();
      }
    }
  });
  const stop = async () => {
    if (child.exitCode === null) {
      child.stdin.end();
      for (let i = 0; i < 50 && child.exitCode === null; i += 1) await sleep(100);
    }
    for (const target of [pid, child.pid]) {
      if (target === null || target === undefined) continue;
      try {
        process.kill(target);
      } catch {
        // already gone
      }
    }
    await sleep(300);
    let stillAlive = false;
    if (pid !== null) {
      try {
        process.kill(pid, 0);
        stillAlive = true;
      } catch {
        stillAlive = false;
      }
    }
    return { stillAlive };
  };
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (child.exitCode !== null) {
      console.error(`yerel gömme sunucusu kapandı (çıkış ${child.exitCode}):\n${tail.join("\n")}`);
      process.exit(3);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ready") break;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop();
      console.error("yerel gömme sunucusu hazır olmadı (240 sn).");
      process.exit(3);
    }
    await sleep(250);
  }
  const startupMs = performance.now() - started;
  return { port, startupMs, pid: () => pid, stop };
}

const providers = [];
const cleanups = [];
const started = new Date();

if (args.dryRun) {
  args.providers.forEach((name, index) => {
    const kind = index % 2 === 0 ? "words" : "trigrams";
    providers.push({
      name,
      model: `scripted-${kind}`,
      promptStyle: "e5",
      port: scriptedEmbeddingPort(kind),
      memoryUnavailableTr: "Bellek ölçülmedi: betikli sahte gömücü ayrı bir süreç değildir.",
    });
  });
} else {
  const { createEmbeddingPort } = await importControlPlane("src/retrieval/semanticRerank.ts");
  for (const name of args.providers) {
    if (name === "local-e5") {
      const { localEmbeddingResolution } = await importControlPlane("src/retrieval/localEmbeddingConfig.ts");
      const server = await startLocalE5();
      cleanups.push(server.stop);
      const config = localEmbeddingResolution(server.port).config;
      providers.push({
        name,
        model: config.model,
        promptStyle: config.promptStyle,
        port: createEmbeddingPort(config),
        startupMs: server.startupMs,
        memoryProbe: async () => {
          const pid = server.pid();
          return pid === null ? null : readProcessMemory(pid);
        },
        memoryUnavailableTr: `Bellek ölçülemedi: ${process.platform} üzerinde süreç belleği okunamadı; tahmin yazılmadı.`,
      });
    } else {
      const { resolveEmbeddingConfig, applyDataBoundaryToEmbedding } = await importControlPlane(
        "src/retrieval/embeddingConfig.ts",
      );
      const { resolveDataBoundary, readTrustedLocalHosts } = await importControlPlane("src/llm/localGenerationConfig.ts");
      const resolution = applyDataBoundaryToEmbedding(
        resolveEmbeddingConfig(process.env),
        resolveDataBoundary(process.env),
        readTrustedLocalHosts(process.env),
      );
      if (!resolution.enabled) {
        console.error(`${name}: ${resolution.message}`);
        process.exit(2);
      }
      providers.push({
        name,
        model: resolution.config.model,
        promptStyle: resolution.config.promptStyle,
        port: createEmbeddingPort(resolution.config),
        memoryUnavailableTr: "Bellek ölçülmedi: bu sağlayıcının süreci bu düzenek tarafından başlatılmadı; tahmin yazılmadı.",
      });
    }
  }
}

let report;
const stopped = [];
try {
  report = await runEmbeddingEval(cases, providers, {
    kind: args.dryRun ? "harness_check" : "measurement",
    startedAt: started.toISOString(),
    ...(Number.isInteger(args.batch) ? { batchSize: args.batch } : {}),
    ...(Number.isFinite(args.timeoutMs) ? { timeoutMs: args.timeoutMs } : {}),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model?.trim() ?? "unknown",
      logicalCpus: String(os.cpus().length),
      totalMemoryGiB: (os.totalmem() / 1024 ** 3).toFixed(1),
    },
  });
} finally {
  for (const cleanup of cleanups) stopped.push(await cleanup());
}
if (stopped.some((result) => result.stillAlive)) {
  console.error("UYARI: yerel gömme sunucusu durdurulamadı; süreç elle kapatılmalı.");
}

const outDir = path.resolve(REPO_ROOT, args.out);
mkdirSync(outDir, { recursive: true });
const stamp = report.startedAt.slice(0, 10);
const suffix = args.dryRun ? "-harness-check" : "";
writeFileSync(path.join(outDir, `embedding-eval-${stamp}${suffix}.json`), JSON.stringify(report, null, 2), "utf8");
writeFileSync(path.join(outDir, `embedding-eval-${stamp}${suffix}.md`), renderEmbeddingEvalMarkdown(report), "utf8");
console.log(renderEmbeddingEvalMarkdown(report));
