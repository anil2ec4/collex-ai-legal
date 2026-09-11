import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = new URL("../src/files/store.ts", import.meta.url);
const test = ["node_modules/vitest/vitest.mjs", "run", "tests/files/routes.test.ts", "--reporter=json"];
const run = () => spawnSync(process.execPath, test, {
  cwd: root,
  encoding: "utf8",
  timeout: 60000,
});

const mutations = [
  ["drop sparse pages", "const sparsePages = rec[\"sparsePages\"];", "const sparsePages = undefined;"],
  ["drop sparse forwarding", "? { sparsePages: sparsePages.filter(isPage) }\n      : {}),", "? { sparsePages: [] }\n      : {}),"],
  ["drop original size forwarding", "...(sizeBytes !== undefined ? { sizeBytes } : {}),", "...(false ? { sizeBytes } : {}),"],
];
const original = readFileSync(target, "utf8");
const clean = run();
if (clean.status !== 0) throw new Error("Baseline failed: " + clean.stdout + clean.stderr);
let survived = 0;
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
  const current = readFileSync(target, "utf8");
  if (current === original || mutations.some(([, from, to]) => current === original.replace(from, to))) {
    writeFileSync(target, original);
  }
}
process.exitCode = survived === 0 ? 0 : 1;
