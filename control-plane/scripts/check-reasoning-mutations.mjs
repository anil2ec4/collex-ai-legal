import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const run = () => spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/research/decisionReasoning.test.ts", "tests/retrieval/semanticRerank.test.ts"], { cwd: root, encoding: "utf8", timeout: 30000 });
if (run().status !== 0) throw new Error("Baseline failed");
const changes = [
  ["research reasoning wiring", "src/research/researchService.ts", 'preferReasoning: liveDocumentType(stored.doc.source) === "karar",', 'preferReasoning: false,'],
  ["stock affirmance exclusion", "src/research/liveEvidence.ts", "if (isOnlyStockAffirmance(text) &&", "if (false &&"],
  ["actual question exception", "src/research/liveEvidence.ts", "options.questionText ?? options.queryText", "options.queryText"],
  ["additional reasoning protection", "src/research/liveEvidence.ts", 'return withoutTopic === reversal + " " + affirmance;', 'return withoutTopic.startsWith(reversal + " " + affirmance);'],
  ["reasoning boundary", "src/research/liveEvidence.ts", "if (options.preferReasoning) {", "if (false) {"],
  ["canonical offsets", "src/research/liveEvidence.ts", "startChar: span.startChar + offset, endChar: span.endChar + offset", "startChar: span.startChar, endChar: span.endChar"],
  ["uncalibrated label suppression", "src/retrieval/semanticRerank.ts", "...(!uncalibratedLocal ? { benzerlik: entry.band } : {}),", "...({ benzerlik: entry.band }),"],
];
let survivors = 0;
for (const [name, file, from, to] of changes) {
  const path = root + file;
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
