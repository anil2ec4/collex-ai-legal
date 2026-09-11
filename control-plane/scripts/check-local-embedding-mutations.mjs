import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const run = () => spawnSync(root + ".venv/Scripts/python.exe", ["-m", "pytest", "tests/test_local_embeddings.py", "-q", "-p", "no:cacheprovider"], { cwd: root, encoding: "utf8", timeout: 30000 });
if (run().status !== 0) throw new Error("Baseline failed");
const changes = [
  ["padding exclusion", "local_embeddings.py", "weights = mask.astype(np.float32)[..., None]", "weights = np.ones_like(mask, dtype=np.float32)[..., None]"],
  ["unit vector normalization", "local_embeddings.py", "return pooled / norms", "return pooled"],
  ["empty mask fabricated vector", "local_embeddings.py", 'raise ValueError("Empty embedding token mask")', 'return np.ones((hidden.shape[0], hidden.shape[2]), dtype=np.float32)'],
  ["remote origin rejection", "local_embedding_server.py", 'if origin and urlsplit(origin).hostname not in ("localhost", "127.0.0.1"):', "if False:"],
  ["rebinding host rejection", "local_embedding_server.py", 'allowed_hosts=["127.0.0.1", "localhost"]', 'allowed_hosts=["*"]'],
  ["batch limit", "local_embedding_server.py", "Field(min_length=1, max_length=41)", "Field(min_length=1, max_length=42)"],
  ["model identity", "local_embedding_server.py", "model: Literal[MODEL_ID]", "model: StrictStr"],
];
let survivors = 0;
for (const [name, file, from, to] of changes) {
  const path = new URL("../../semantic_search/" + file, import.meta.url);
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
