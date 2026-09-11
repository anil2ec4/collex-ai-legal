import { importControlPlane } from "./ts-loader.mjs";
const { EmbeddingConfig } = await importControlPlane("src/retrieval/embeddingConfig.ts");
const { createEmbeddingPort } = await importControlPlane("src/retrieval/semanticRerank.ts");
const config = new EmbeddingConfig({
  provider: "local", model: "intfloat/multilingual-e5-small:onnx-qint8",
  baseUrl: "http://127.0.0.1:8898/v1", dimension: 384, promptStyle: "e5",
});
const start = performance.now();
// Synthetic plumbing check, not a legal-quality measurement.
const vectors = await createEmbeddingPort(config).embed([
  "query: Fazla çalışma ücretinin tanıkla ispatı",
  "passage: Fazla mesai alacağına ilişkin tanık beyanları ve işyeri kayıtları incelendi.",
  "passage: Tapu iptali ve tescil davasında taşınmazın sınırları incelendi.",
], { signal: AbortSignal.timeout(10000) });
if (vectors.length !== 3 || vectors.some(v => v.length !== 384 || v.some(n => !Number.isFinite(n)))) {
  throw new Error("Local embedding contract failed");
}
const similarities = vectors.slice(1).map(v => v.reduce((s, n, i) => s + n * vectors[0][i], 0));
if (similarities[0] <= similarities[1]) throw new Error("Synthetic related passage did not outrank unrelated passage");
console.log(JSON.stringify({ status: "PASS", model: config.model, vectors: vectors.length, dimension: 384, similarities, latencyMs: Math.round(performance.now() - start) }));
