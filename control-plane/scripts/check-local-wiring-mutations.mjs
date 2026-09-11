import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const tests = ["tests/retrieval/localEmbeddingConfig.test.ts", "tests/sources/relatedSearch.test.ts", "tests/integration/w16Wiring.test.ts"];
const run = () => spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...tests], { cwd: root, encoding: "utf8", timeout: 60000 });
if (run().status !== 0) throw new Error("Baseline failed");
const changes = [
  ["router injection", "src/sources/routes.ts", "...(deps.embedding !== undefined ? { embedding: deps.embedding } : {}),", ""],
  ["app injection", "src/api/server.ts", "...(deps.sourcesEmbedding !== undefined ? { embedding: deps.sourcesEmbedding } : {}),", ""],
  ["model dimension", "src/retrieval/localEmbeddingConfig.ts", "dimension: 384,", "dimension: 768,"],
  ["environment isolation", "src/retrieval/localEmbeddingConfig.ts", "  return {", '  process.env["EMBEDDING_PROVIDER"] = "local";\n  return {'],
];
let survivors = 0;
for (const [name, file, from, to] of changes) {
  const path = root + file;
  const original = readFileSync(path, "utf8");
  if (original.split(from).length !== 2) throw new Error("Non-unique anchor: " + name);
  const changed = original.replace(from, to);
  try {
    writeFileSync(path, changed);
    const result = run();
    const killed = result.status === 1 && /\d+ failed/.test(result.stdout);
    console.log(JSON.stringify({ name, killed }));
    if (!killed) survivors++;
  } finally {
    if (readFileSync(path, "utf8") !== changed) throw new Error("Concurrent edit; refusing overwrite");
    writeFileSync(path, original);
  }
}
process.exitCode = survivors ? 1 : 0;
