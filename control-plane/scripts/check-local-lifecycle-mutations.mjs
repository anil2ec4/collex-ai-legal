import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = {
  launcher: root + "ColleX-Baslat.cmd",
  stopper: root + "ColleX-Durdur.cmd",
  serve: root + "control-plane/scripts/serve.mjs",
};
const read = (name) => readFileSync(files[name], "utf8");
const assertContract = () => {
  if (!read("launcher").includes("--with-local-embeddings --local-embeddings-port 8899")) {
    throw new Error("launcher does not manage the local model");
  }
  if (!read("stopper").includes("local_embedding_server.*--collex-managed")) {
    throw new Error("stopper does not identify the local model child");
  }
  const serve = read("serve");
  if (!serve.includes("function startLocalEmbeddings(port") ||
      !serve.includes("semantic_search.local_embedding_server") ||
      !serve.includes("killLocalEmbeddings")) {
    throw new Error("serve.mjs does not own the local model lifecycle");
  }
};

const mutations = [
  ["launcher opt-in", "--with-local-embeddings --local-embeddings-port 8899", "--with-mcp"],
  ["stopper process identity", "|local_embedding_server.*--collex-managed", ""],
  ["managed child", "function startLocalEmbeddings(port", "function startLocalEmbeddingsDisabled(port"],
];
const originals = new Map(Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")]));
assertContract();
let survivors = 0;
try {
  for (const [name, from, to] of mutations) {
    const targetName = name === "launcher opt-in" ? "launcher" : name === "stopper process identity" ? "stopper" : "serve";
    const original = originals.get(targetName);
    if (original.split(from).length !== 2) throw new Error(`Mutation anchor is not unique: ${name}`);
    const changed = original.replace(from, to);
    writeFileSync(files[targetName], changed);
    let killed = false;
    try { assertContract(); } catch { killed = true; }
    if (readFileSync(files[targetName], "utf8") !== changed) throw new Error("Concurrent edit detected");
    writeFileSync(files[targetName], original);
    console.log(JSON.stringify({ mutation: name, killed }));
    if (!killed) survivors++;
  }
} finally {
  for (const [name, original] of originals) {
    const current = readFileSync(files[name], "utf8");
    if (current === original || mutations.some(([label, from, to]) => {
      const targetName = label === "launcher opt-in" ? "launcher" : label === "stopper process identity" ? "stopper" : "serve";
      return targetName === name && current === original.replace(from, to);
    })) writeFileSync(files[name], original);
  }
}
process.exitCode = survivors === 0 ? 0 : 1;
