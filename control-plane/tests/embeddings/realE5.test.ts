/**
 * W20 acceptance F with the REAL local embedding model.
 *
 * Starts the product's own local embedding server
 * (`python -m semantic_search.local_embedding_server`, multilingual-e5-small,
 * ONNX int8, CPU) on a free loopback port, lets the real EmbeddingWorker embed
 * a real upload's chunks into PostgreSQL, and asks a question that shares NO
 * word with the passage that answers it. The passage must enter retrieval
 * through the dense lane, and health must say ACTIVE.
 *
 * Measured, not assumed: the test logs the query-passage cosine it observed
 * so the number in the report is a measurement. The pair was chosen by
 * measuring (scratch script, 2026-09-11): query "trafik kazasında maddi
 * zarar" vs the collision passage 0.8930, next-best unrelated passage 0.8242.
 *
 * When the model assets are missing this suite is SKIPPED with an explicit
 * reason — an environment blocker, never reported as a pass.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { createEmbeddingPort } from "../../src/retrieval/semanticRerank.js";
import { localEmbeddingResolution } from "../../src/retrieval/localEmbeddingConfig.js";
import { searchPipeline } from "../../src/retrieval/hybrid.js";
import { LOCAL_E5_PROFILE, PgChunkVectorStore } from "../../src/embeddings/chunkVectorStore.js";
import { EmbeddingWorker } from "../../src/embeddings/embeddingWorker.js";
import { ExactCosineDenseLane } from "../../src/embeddings/denseLane.js";
import { decodeVector, dot, l2Normalize } from "../../src/embeddings/vectorCodec.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { insertUpload, paragraphs, sleep } from "../exhaustive/durableFixtures.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MODEL_FILE = path.join(REPO_ROOT, "var", "models", "multilingual-e5-small", "model_qint8_avx512_vnni.onnx");
const PYTHON = path.join(
  REPO_ROOT,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const AVAILABLE = existsSync(MODEL_FILE) && existsSync(PYTHON);
if (!AVAILABLE) {
  console.warn(
    "ENVIRONMENT BLOCKER: local E5 model assets or the project venv are missing;" +
      " the real-embedding acceptance test is skipped, not passed.",
  );
}

const SCRATCH = scratchDatabase("collex_dense_real_test");
const QUERY = "trafik kazasında maddi zarar";
const TARGET = "Araçların çarpışması sonucu otomobilde oluşan hasarın bedeli.";
const DISTRACTORS = [
  "Toplantı gündemi okundu ve oylama yapıldı.",
  "Belediye park alanında yeni ağaçlar dikildi.",
  "Faturanın vadesi geçtiği için gecikme cezası uygulandı.",
];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let sql: Sql;
let child: ChildProcess | undefined;
let port = 0;

describe.skipIf(!AVAILABLE)("F: the real local E5 model puts a semantic-only passage into retrieval", () => {
  beforeAll(async () => {
    await requireScratchPostgres();
    await resetScratchDatabase(SCRATCH);
    await applyMigrationsAndSeed(SCRATCH);
    sql = connectTestDb(SCRATCH);
    await insertUpload(sql, {
      fileId: "real-e5",
      title: "Kaza dosyası",
      blocks: paragraphs([TARGET, ...DISTRACTORS], 8),
    });

    port = await freePort();
    child = spawn(PYTHON, ["-m", "semantic_search.local_embedding_server", "--port", String(port)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`embedding server exited (${child.exitCode})`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error("embedding server did not become ready");
      await sleep(250);
    }
  });

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) child.kill();
    if (sql !== undefined) await sql.end({ timeout: 5 });
  });

  it("embeds the upload, reports ACTIVE, and retrieves the passage by meaning alone", async () => {
    const resolution = localEmbeddingResolution(port);
    if (!resolution.enabled) throw new Error("local embedding resolution disabled");
    const embedder = createEmbeddingPort(resolution.config);
    const store = new PgChunkVectorStore(sql);

    const started = performance.now();
    const drained = await new EmbeddingWorker({ store, embedder, profile: LOCAL_E5_PROFILE }).drain();
    const embedMs = Math.round(performance.now() - started);
    expect(drained.failed).toBe(0);
    expect(drained.embedded).toBeGreaterThan(0);

    const lane = new ExactCosineDenseLane({ store, embedder, profile: LOCAL_E5_PROFILE });
    const health = await lane.health();
    expect(health.state).toBe("ACTIVE");
    expect(health.chunksWithoutVector).toBe(0);

    const searchStarted = performance.now();
    const result = await searchPipeline(sql, QUERY, {
      asOf: "2026-09-11",
      filters: { fileIds: ["real-e5"] },
      denseLane: lane,
    });
    const searchMs = Math.round(performance.now() - searchStarted);

    const target = await sql`
      select c.id::text as id, cv.embedding from legal.chunks c
      join app_private.chunk_vectors cv on cv.chunk_id = c.id
      where c.original_text = ${TARGET}`;
    const targetId = String(target[0]!["id"]);
    const hit = result.hits.find((candidate) => candidate.chunkId === targetId);
    expect(hit).toBeDefined();
    expect(hit!.lanes.map((entry) => entry.lane)).toEqual(["dense"]);
    expect(result.dense.state).toBe("ACTIVE");
    expect(result.dense.denseOnly).toBeGreaterThanOrEqual(1);

    // Record what was measured on THIS machine.
    const [queryVector] = await embedder.embed([`query: ${QUERY}`]);
    const cosine = dot(
      l2Normalize(queryVector as number[])!,
      decodeVector(target[0]!["embedding"] as Uint8Array, 384)!,
    );
    console.log(
      `W20 real E5 measurement: chunks=${drained.embedded} embedMs=${embedMs}` +
        ` searchMs=${searchMs} cosine(query,target)=${cosine.toFixed(4)}` +
        ` denseRank=${(hit!.lanes[0] as { rank: number }).rank}`,
    );
  });
});
