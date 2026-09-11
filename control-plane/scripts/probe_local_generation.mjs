#!/usr/bin/env node
/**
 * Measure a local generation endpoint. Run this ON the machine that will host
 * the model, or on a machine that can reach it.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Nothing in this repository knows how fast the intended appliance (an Apple
 * M2 Mac mini, 8 GB unified memory) actually is. No number about it has been
 * measured, and none is written down anywhere in the codebase or the docs.
 * This script is how such a number gets produced — by running it — so that
 * the first performance claim in STATUS.md is a measurement rather than a
 * guess copied from a model card.
 *
 * It measures three things a small machine actually struggles with:
 *   1. time to first useful answer (cold, i.e. weights not yet resident);
 *   2. steady-state latency over repeated small structured extractions,
 *      which is the shape the exhaustive analysis lane produces;
 *   3. how often the model returns output that is NOT parseable as the
 *      requested JSON — the failure mode that silently costs coverage.
 *
 * It does NOT measure quality. A fast model that extracts the wrong amount is
 * worse than no model; legal quality needs the lawyer-labelled gold set
 * (evals/), not a stopwatch.
 *
 * Usage:
 *   node control-plane/scripts/probe_local_generation.mjs \
 *     --base-url http://127.0.0.1:11434 --model <model-name> [--runs 20]
 *
 * Nothing privileged is sent: the prompts are synthetic Turkish sentences
 * written into this file, never a document from the Matter store.
 */

import { argv, exit, stdout } from "node:process";

function arg(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
}

const baseUrl = String(arg("base-url", "http://127.0.0.1:11434")).replace(/\/+$/u, "");
const model = arg("model", undefined);
const runs = Number(arg("runs", "20"));
const timeoutMs = Number(arg("timeout-ms", "120000"));

if (model === undefined) {
  stdout.write("--model is required (any OpenAI-compatible model name)\n");
  exit(2);
}

/**
 * Synthetic probe cases. Deliberately the SHAPE the exhaustive lane emits:
 * a short Turkish passage, a fixed instruction, a small JSON answer.
 */
const CASES = [
  {
    text: "Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir.",
    expect: { field: "tutar", value: "45000" },
  },
  {
    text: "İhtarname 11 Mart 2024 tarihinde davalıya tebliğ edilmiştir.",
    expect: { field: "tarih", value: "2024-03-11" },
  },
  {
    text: "Bilirkişi raporunda kusur oranı %80 olarak belirlenmiştir.",
    expect: { field: "oran", value: "80" },
  },
];

const SYSTEM =
  "Sen bir hukuk metni çözümleyicisisin. Verilen pasajdan yalnız istenen" +
  " alanı çıkarırsın. Pasajda yazmayan hiçbir şeyi uydurma.";

function parseJsonLoosely(raw) {
  const text = String(raw).trim();
  const attempts = [text];
  const fence = text.indexOf("```");
  if (fence >= 0) {
    const open = text.indexOf("\n", fence);
    const close = text.indexOf("```", fence + 3);
    if (open >= 0 && close > open) attempts.push(text.slice(open + 1, close).trim());
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) attempts.push(text.slice(start, end + 1));
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value !== null && typeof value === "object") return value;
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

async function callOnce(probe) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Aşağıdaki pasajdan "${probe.expect.field}" alanını çıkar.\n` +
          'Yanıtı YALNIZ şu biçimde ver: {"deger": "..."}\n\n' +
          probe.text,
      },
    ],
    temperature: 0,
    max_tokens: 128,
    stream: false,
  });

  const started = performance.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, ms: performance.now() - started, reason: String(error?.name ?? "network") };
  }
  const ms = performance.now() - started;
  if (!response.ok) return { ok: false, ms, reason: `HTTP ${response.status}` };

  const payload = await response.json().catch(() => undefined);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ok: false, ms, reason: "empty" };

  const parsed = parseJsonLoosely(content);
  if (parsed === undefined) return { ok: false, ms, reason: "unparseable", chars: content.length };
  return { ok: true, ms, chars: content.length, value: String(parsed.deger ?? "") };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const results = [];
stdout.write(`probing ${baseUrl} with model "${model}" — ${runs} runs\n`);

// 1. Cold call, reported separately: the first request pays for loading the
//    weights, and averaging it into the rest hides both numbers.
const cold = await callOnce(CASES[0]);
stdout.write(`cold call: ${cold.ok ? "ok" : "FAILED " + cold.reason} ${Math.round(cold.ms)} ms\n`);
if (!cold.ok && cold.reason?.startsWith("Timeout")) {
  stdout.write("the endpoint did not answer; nothing further is measurable\n");
  exit(1);
}

for (let i = 0; i < runs; i += 1) {
  results.push(await callOnce(CASES[i % CASES.length]));
}

const ok = results.filter((r) => r.ok);
const latencies = ok.map((r) => r.ms);
const unparseable = results.filter((r) => !r.ok && r.reason === "unparseable").length;
const failed = results.length - ok.length;

stdout.write("\n--- measured (this machine, this model, right now) ---\n");
stdout.write(`runs:               ${results.length}\n`);
stdout.write(`answered:           ${ok.length}\n`);
stdout.write(`failed:             ${failed} (unparseable: ${unparseable})\n`);
stdout.write(`latency p50:        ${Math.round(percentile(latencies, 50))} ms\n`);
stdout.write(`latency p95:        ${Math.round(percentile(latencies, 95))} ms\n`);
stdout.write(`cold first call:    ${Math.round(cold.ms)} ms\n`);
stdout.write(
  "\nNOTE: this measures latency and output-shape discipline only.\n" +
    "It says NOTHING about Turkish legal quality — that needs the\n" +
    "lawyer-labelled gold set, not a stopwatch.\n",
);

exit(failed > results.length / 2 ? 1 : 0);
