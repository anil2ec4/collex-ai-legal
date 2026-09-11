import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const run = () => spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/research/semanticPassages.test.ts", "tests/research/researchService.test.ts"], { cwd: root, encoding: "utf8", timeout: 30000 });
if (run().status !== 0) throw new Error("Baseline failed");
const path = root + "src/research/semanticPassages.ts";
const mutations = [
  ["ranking direction", "b.score - a.score", "a.score - b.score"],
  ["document quota", ".slice(0, g.fallback.length)", ".slice(0, 1)"],
  ["evidence score preservation", ".map(r => r.candidate)", ".map(r => ({ ...r.candidate, score: 1 }))"],
  ["spent budget", "timeoutMs <= 0 ||", ""],
];
let survivors = 0;
for (const [name, from, to] of mutations) {
  const original = readFileSync(path, "utf8");
  if (original.split(from).length !== 2) throw new Error("Non-unique anchor");
  const changed = original.replace(from, to);
  try {
    writeFileSync(path, changed);
    const result = run();
    const killed = result.status === 1 && /\d+ failed/.test(result.stdout);
    console.log(JSON.stringify({ name, killed }));
    if (!killed) survivors++;
  } finally {
    if (readFileSync(path, "utf8") !== changed) throw new Error("Concurrent edit");
    writeFileSync(path, original);
  }
}
process.exitCode = survivors ? 1 : 0;
