#!/usr/bin/env node
/**
 * Local-model bake-off (W20). Runs the SAME cases through every model and
 * writes evals/reports/bakeoff-<date>.{json,md}.
 *
 *   node control-plane/scripts/bakeoff.mjs --models modelA,modelB
 *        [--cases evals/bakeoff/cases.synthetic.jsonl[,more.jsonl]]
 *        [--memory-probe ollama] [--dry-run] [--out evals/reports]
 *
 * The endpoint comes from COLLEX_LOCAL_LLM_BASE_URL (plus
 * COLLEX_TRUSTED_LOCAL_HOSTS / COLLEX_LOCAL_LLM_API_KEY for a LAN appliance)
 * and goes through the SAME provider factory the product uses, so the
 * boundary checks (LOCAL_ONLY, trusted-LAN allow-list, no redirects) apply
 * to the bake-off exactly as to production. Each `--models` name is set as
 * the model on that endpoint.
 *
 * `--dry-run` uses a scripted transport instead of a server: it checks the
 * harness and labels the report "harness check — not a measurement".
 *
 * Nothing here prints document text, prompts or the API key.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importControlPlane } from "./ts-loader.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = { models: [], cases: ["evals/bakeoff/cases.synthetic.jsonl"], dryRun: false, memoryProbe: null, out: "evals/reports" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--models") args.models = argv[++i].split(",").map((m) => m.trim()).filter(Boolean);
    else if (flag === "--cases") args.cases = argv[++i].split(",").map((c) => c.trim()).filter(Boolean);
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--memory-probe") args.memoryProbe = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.dryRun && args.models.length === 0) args.models = ["betikli-a", "betikli-b"];
  if (args.models.length === 0) throw new Error("--models is required (comma-separated model names)");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const { parseCases, runBakeoff, renderBakeoffMarkdown } = await importControlPlane("src/evals/bakeoff.ts");
const { resolveModelRoutes } = await importControlPlane("src/llm/providerFactory.ts");

const cases = [];
for (const file of args.cases) {
  const { cases: parsed, errors } = parseCases(readFileSync(path.resolve(REPO_ROOT, file), "utf8"));
  if (errors.length > 0) {
    console.error(`${file}: ${errors.length} geçersiz satır\n${errors.slice(0, 10).join("\n")}`);
    process.exit(2);
  }
  cases.push(...parsed);
}

/** A scripted OpenAI-compatible transport for --dry-run. */
function scriptedFetch() {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const user = String(body.messages?.[1]?.content ?? "");
    let content = "{}";
    if (user.includes("şu türdeki öğeleri çıkar")) content = JSON.stringify({ items: [] });
    else if (user.includes("CONTRADICTION")) content = JSON.stringify({ relation: "INDEPENDENT" });
    else if (user.includes("İDDİA:")) content = JSON.stringify({ entails: false, score: 0, rationale: "betikli" });
    else if (body.messages?.[0]?.content?.includes("sade Türkçe")) content = JSON.stringify({ text: "Betikli cevap." });
    else content = JSON.stringify({ sonuc: "ret" });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const models = [];
for (const name of args.models) {
  const env = { ...process.env, COLLEX_LOCAL_LLM_MODEL: name };
  if (args.dryRun) env.COLLEX_LOCAL_LLM_BASE_URL = "http://127.0.0.1:1";
  const table = resolveModelRoutes(env, args.dryRun ? { fetchImpl: scriptedFetch() } : {});
  if (table.status !== "configured") {
    console.error(`${name}: yerel model uç noktası kullanılamıyor (${table.status}): ${table.messageTr ?? ""}`);
    process.exit(2);
  }
  const adapter = table.roles.matterExtraction;
  models.push({ name, generator: adapter, tokens: () => ({ prompt: adapter.usage.promptTokens, completion: adapter.usage.completionTokens }) });
}

const startedAt = new Date().toISOString();
const report = await runBakeoff(cases, models, { kind: args.dryRun ? "harness_check" : "measurement", startedAt });

if (args.memoryProbe === "ollama" && !args.dryRun) {
  // Ollama reports loaded models and their memory at /api/ps. Best effort:
  // a failed probe is recorded as unavailable, never guessed.
  const base = (process.env.COLLEX_LOCAL_LLM_BASE_URL ?? "").replace(/\/+$/u, "");
  try {
    const response = await fetch(`${base}/api/ps`, { redirect: "error", signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    report.memory = (body.models ?? []).map((m) => ({ model: m.name, sizeBytes: m.size, vramBytes: m.size_vram }));
  } catch {
    report.memory = "unavailable";
  }
}

const outDir = path.resolve(REPO_ROOT, args.out);
mkdirSync(outDir, { recursive: true });
const stamp = startedAt.slice(0, 10);
const suffix = args.dryRun ? "-harness-check" : "";
writeFileSync(path.join(outDir, `bakeoff-${stamp}${suffix}.json`), JSON.stringify(report, null, 2), "utf8");
writeFileSync(path.join(outDir, `bakeoff-${stamp}${suffix}.md`), renderBakeoffMarkdown(report), "utf8");
console.log(renderBakeoffMarkdown(report));
