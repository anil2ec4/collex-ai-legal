#!/usr/bin/env node
/**
 * Local-model bake-off (W20). Runs the SAME cases through every model and
 * writes evals/reports/bakeoff-<date>.{json,md}.
 *
 *   node control-plane/scripts/bakeoff.mjs --models modelA,modelB
 *        [--cases evals/bakeoff/cases.synthetic.jsonl[,more.jsonl]]
 *        [--memory-probe ollama] [--dry-run [--dry-run-served id]] [--out evals/reports]
 *
 * Default cases: evals/bakeoff/cases.synthetic.jsonl plus the W21 semantic
 * contradiction pairs (cases.semantic.synthetic.jsonl) and claim-weighing
 * cases (cases.weighing.synthetic.jsonl).
 *
 * The endpoint comes from COLLEX_LOCAL_LLM_BASE_URL (plus
 * COLLEX_TRUSTED_LOCAL_HOSTS / COLLEX_LOCAL_LLM_API_KEY for a LAN appliance)
 * and goes through the SAME provider factory the product uses, so the
 * boundary checks (LOCAL_ONLY, trusted-LAN allow-list, no redirects) apply
 * to the bake-off exactly as to production. Each `--models` name is set as
 * the model on that endpoint FOR EVERY ROLE: the per-role overrides
 * (COLLEX_LOCAL_LLM_MODEL_EXTRACTION, _SYNTHESIS, _ANSWER, _VERIFIER) are
 * removed from the run's environment, because a role override would win over
 * the `--models` name and every row would measure that model instead.
 *
 * The name in a request proves nothing about which model ANSWERS: a
 * single-model server (llama-server with one GGUF loaded) ignores it and
 * answers with the loaded model. So before anything is measured the
 * endpoint's model list (GET /v1/models, no redirects, the same API key) is
 * read: a `--models` name the list does not contain is refused (exit 2, no
 * report written), which also refuses two names against a server that lists
 * one model. A list that cannot be read is recorded as "not verified" in the
 * report, never as the served model.
 *
 * Weighing and semantic-contradiction cases are sent in production's batch
 * sizes (COLLEX_ANALYSIS_WEIGH_BATCH, COLLEX_ANALYSIS_CONTRADICTION_PAIRS_PER_CALL
 * via resolveStageConfig); the sizes used are recorded in the report.
 *
 * `--dry-run` uses a scripted transport instead of a server: it checks the
 * harness and labels the report "harness check — not a measurement". With
 * `--dry-run-served <id>` the scripted server behaves like a single-model
 * llama-server: it lists only that id and answers every request whatever
 * model it names (a check of the refusal above).
 *
 * Nothing here prints document text, prompts or the API key.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importControlPlane } from "./ts-loader.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = {
    models: [],
    cases: [
      "evals/bakeoff/cases.synthetic.jsonl",
      "evals/bakeoff/cases.semantic.synthetic.jsonl",
      "evals/bakeoff/cases.weighing.synthetic.jsonl",
    ],
    dryRun: false,
    dryRunServed: null,
    memoryProbe: null,
    out: "evals/reports",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--models") args.models = argv[++i].split(",").map((m) => m.trim()).filter(Boolean);
    else if (flag === "--cases") args.cases = argv[++i].split(",").map((c) => c.trim()).filter(Boolean);
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--dry-run-served") args.dryRunServed = argv[++i].split(",").map((m) => m.trim()).filter(Boolean);
    else if (flag === "--memory-probe") args.memoryProbe = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.dryRunServed !== null && !args.dryRun) throw new Error("--dry-run-served is only valid with --dry-run");
  if (args.dryRun && args.models.length === 0) args.models = ["betikli-a", "betikli-b"];
  if (args.models.length === 0) throw new Error("--models is required (comma-separated model names)");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const { parseCases, runBakeoff, renderBakeoffMarkdown, listServedModels, servedModelRefusal } = await importControlPlane(
  "src/evals/bakeoff.ts",
);
const { resolveModelRoutes, ROLE_MODEL_ENV } = await importControlPlane("src/llm/providerFactory.ts");
const { LOCAL_LLM_ENV } = await importControlPlane("src/llm/localGenerationConfig.ts");
const { resolveStageConfig } = await importControlPlane("src/exhaustive/stageTypes.ts");

const cases = [];
for (const file of args.cases) {
  const { cases: parsed, errors } = parseCases(readFileSync(path.resolve(REPO_ROOT, file), "utf8"));
  if (errors.length > 0) {
    console.error(`${file}: ${errors.length} geçersiz satır\n${errors.slice(0, 10).join("\n")}`);
    process.exit(2);
  }
  cases.push(...parsed);
}

/**
 * A scripted OpenAI-compatible transport for --dry-run. By default it serves
 * ONLY the `--models` names, lists them at /v1/models, and refuses a request
 * for any other model (e.g. one a role override slipped in) like an unknown
 * model, so the harness check fails instead of labelling one model's answers
 * with another's name. With --dry-run-served it is a single-model server:
 * it lists those ids and answers every request, whatever model it names.
 */
function scriptedFetch() {
  const listed = args.dryRunServed ?? args.models;
  return async (url, init) => {
    if (String(url).endsWith("/v1/models")) {
      return new Response(JSON.stringify({ object: "list", data: listed.map((id) => ({ id, object: "model" })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init.body));
    if (args.dryRunServed === null && !args.models.includes(body.model)) {
      return new Response(JSON.stringify({ error: "model not found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const user = String(body.messages?.[1]?.content ?? "");
    let content = "{}";
    if (user.includes("şu türdeki öğeleri çıkar")) content = JSON.stringify({ items: [] });
    else if (user.includes("INSUFFICIENT_EVIDENCE")) {
      // The semantic lane's batch prompt: one verdict per shown pair.
      const shown = (user.match(/\[p\d+\]/gu) ?? []).length;
      content = JSON.stringify({
        pairs: Array.from({ length: shown }, (_, i) => ({ id: `p${i + 1}`, relation: "INSUFFICIENT_EVIDENCE", rationale: "betikli" })),
      });
    } else if (user.includes("CONTRADICTION")) content = JSON.stringify({ relation: "INDEPENDENT" });
    else if (user.includes("(unrelated)")) {
      // The claim-weighing prompt (checked before the entailment one, whose
      // data block also carries labelled parts): one verdict per shown candidate.
      const shown = (user.match(/\[e\d+\]/gu) ?? []).length;
      content = JSON.stringify({
        links: Array.from({ length: shown }, (_, i) => ({ ref: `e${i + 1}`, stance: "ambiguous", rationale: "betikli" })),
      });
    } else if (user.includes("[PASAJ]")) {
      // The production judge request (entailmentRequest): claim and passage
      // fenced under [İDDİA] / [PASAJ]. A consistent "not supported" reply.
      content = JSON.stringify({ entails: false, score: 0, rationale: "betikli" });
    } else if (body.messages?.[0]?.content?.includes("sade Türkçe")) content = JSON.stringify({ text: "Betikli cevap." });
    else content = JSON.stringify({ sonuc: "ret" });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const roleOverrides = Object.values(ROLE_MODEL_ENV).filter((variable) => (process.env[variable] ?? "").trim() !== "");
if (roleOverrides.length > 0) {
  // Names only, never values.
  console.error(
    `Not: ${roleOverrides.join(", ")} bu karşılaştırmada dikkate alınmadı; her rol --models ile verilen modelle çalıştırılır.`,
  );
}

const transport = args.dryRun ? scriptedFetch() : undefined;
const models = [];
let endpoint = null;
for (const name of args.models) {
  const env = { ...process.env, COLLEX_LOCAL_LLM_MODEL: name };
  // A per-role override wins over COLLEX_LOCAL_LLM_MODEL in resolveModelRoutes:
  // left in place, the row labelled `name` would measure the override model.
  for (const variable of Object.values(ROLE_MODEL_ENV)) delete env[variable];
  if (args.dryRun) env.COLLEX_LOCAL_LLM_BASE_URL = "http://127.0.0.1:1";
  const table = resolveModelRoutes(env, transport !== undefined ? { fetchImpl: transport } : {});
  if (table.status !== "configured") {
    console.error(`${name}: yerel model uç noktası kullanılamıyor (${table.status}): ${table.messageTr ?? ""}`);
    process.exit(2);
  }
  const adapter = table.roles.matterExtraction;
  if (adapter === undefined) {
    // An endpoint outside this machine / network never reads matter text.
    console.error(`${name}: uç nokta bu makinede ya da kendi ağınızda değil; dosya metni dışarı gönderilmediği için dosya analizi ölçülemez, ölçüm yapılmadı.`);
    process.exit(2);
  }
  // Every row goes to the same endpoint (one environment): its admitted base URL.
  endpoint = adapter.baseUrl;
  models.push({ name, generator: adapter, tokens: () => ({ prompt: adapter.usage.promptTokens, completion: adapter.usage.completionTokens }) });
}

// Which models the endpoint serves, BEFORE anything is measured. The endpoint
// is the one resolveModelRoutes admitted (boundary, trusted LAN, on premises).
const servedModels = await listServedModels({
  baseUrl: endpoint,
  fetchImpl: transport ?? globalThis.fetch,
  apiKey: (process.env[LOCAL_LLM_ENV.apiKey] ?? "").trim(),
  timeoutMs: 10_000,
});
const refusal = servedModelRefusal(args.models, servedModels);
if (refusal !== null) {
  console.error(refusal);
  process.exit(2);
}
if (servedModels.status === "unverified") {
  console.error(`Not: ${servedModels.reasonTr} Rapor satırlarındaki model adları doğrulanmadı.`);
}

const stageConfig = resolveStageConfig(process.env);
const startedAt = new Date().toISOString();
const report = await runBakeoff(cases, models, {
  kind: args.dryRun ? "harness_check" : "measurement",
  startedAt,
  batching: { weighBatchSize: stageConfig.weighBatchSize, contradictionPairsPerCall: stageConfig.contradictionPairsPerCall },
  servedModels,
});

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
