import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = new URL("../src/store/draftStore.ts", import.meta.url);
const original = readFileSync(target, "utf8");
const mutations = [
  ["write ordering", "const previous = this.writes.get(draft.draftId);", "const previous = undefined;"],
  ["pending outcome", "if (!this.writes.has(oldest.value))", "if (true)"],
  ["archive capacity", "this.cacheDraft(draftId, body as D);", "this.cache.set(draftId, body as D);"],
  ["submitted snapshot", "const snapshot = structuredClone(draft);", "const snapshot = draft;"],
  ["archive read race", "if (!this.cache.has(draftId)) this.cacheDraft", "this.cacheDraft"],
];
let survived = 0;
const run = () => spawnSync(process.execPath, [
  "node_modules/vitest/vitest.mjs", "run", "tests/store/draftOrdering.test.ts", "--reporter=json",
], { cwd: root, encoding: "utf8", timeout: 60000 });
const clean = run();
if (clean.status !== 0) throw new Error("Baseline must pass before mutation: " + clean.stdout + clean.stderr);
try {
  for (const [name, from, to] of mutations) {
    if (original.split(from).length !== 2) throw new Error("Mutation anchor is not unique: " + name);
    const changed = original.replace(from, to);
    writeFileSync(target, changed);
    const result = run();
    if (readFileSync(target, "utf8") !== changed) throw new Error("Concurrent edit detected; stop mutation check");
    writeFileSync(target, original);
    let report;
    try { report = JSON.parse(result.stdout); } catch { throw new Error("Runner failed without test results: " + result.stderr); }
    const killed = result.status !== 0 && report.numFailedTests > 0;
    console.log(JSON.stringify({ mutation: name, killed, failedTests: report.numFailedTests }));
    if (!killed) survived++;
  }
} finally {
  // Restore only our own mutation, never an unrelated concurrent edit.
  const current = readFileSync(target, "utf8");
  if (current === original || mutations.some(([, from, to]) => current === original.replace(from, to))) {
    writeFileSync(target, original);
  }
}
process.exitCode = survived === 0 ? 0 : 1;
