#!/usr/bin/env node
/**
 * ColleX exhaustive-analysis worker as its own process (W20).
 *
 *   node control-plane/scripts/analysis_worker.mjs --dsn <postgres-url>
 *        [--once] [--batch 4] [--lease-ms 300000] [--poll-ms 1000]
 *        [--pause-ms 0] [--worker-id <name>]
 *
 * serve.mjs already runs the same worker inside the control plane; this entry
 * point exists so the work can also run (or be resumed) in a SEPARATE
 * process — and so the crash-resume guarantee can be tested against a real
 * process that is killed, not an object that is abandoned.
 *
 * It holds no state of its own: everything it knows is in the database. Kill
 * it at any moment and start another one; the new one recovers the dead
 * one's expired leases and continues from the next unfinished unit.
 *
 * Models come from the same environment variables as the control plane
 * (COLLEX_LOCAL_LLM_*, COLLEX_DATA_BOUNDARY), resolved through the same
 * provider factory. `--pause-ms` waits between units (to keep a small
 * machine cool, or to make a test's kill land mid-run). Nothing is logged
 * except structured progress events; never document text.
 */

import { importControlPlane } from "./ts-loader.mjs";

function parseArgs(argv) {
  const args = {
    dsn: process.env["COLLEX_DB_URL"] ?? null,
    once: false,
    batch: 4,
    leaseMs: 5 * 60_000,
    pollMs: 1_000,
    pauseMs: 0,
    workerId: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === "--dsn") args.dsn = next();
    else if (flag === "--once") args.once = true;
    else if (flag === "--batch") args.batch = Number(next());
    else if (flag === "--lease-ms") args.leaseMs = Number(next());
    else if (flag === "--poll-ms") args.pollMs = Number(next());
    else if (flag === "--pause-ms") args.pauseMs = Number(next());
    else if (flag === "--worker-id") args.workerId = next();
    else throw new Error(`unknown argument: ${flag}`);
  }
  for (const [name, value] of Object.entries({ batch: args.batch, leaseMs: args.leaseMs, pollMs: args.pollMs, pauseMs: args.pauseMs })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid --${name}`);
  }
  if (!args.dsn) throw new Error("--dsn (or COLLEX_DB_URL) is required");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const { createDb } = await importControlPlane("src/store/db.ts");
const { PgDurableAnalysisStore } = await importControlPlane("src/exhaustive/durableStore.ts");
const { AnalysisWorker } = await importControlPlane("src/exhaustive/worker.ts");
const { resolveModelRoutes } = await importControlPlane("src/llm/providerFactory.ts");

const sql = createDb({ url: args.dsn, max: 2, applicationName: "collex-analysis-worker" });
const routes = resolveModelRoutes(process.env);
const log = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const worker = new AnalysisWorker({
  store: new PgDurableAnalysisStore(sql),
  ...(args.workerId !== undefined ? { workerId: args.workerId } : {}),
  batchSize: args.batch,
  unitLeaseMs: args.leaseMs,
  pollIntervalMs: args.pollMs,
  // The loop is this process's only job; an unref'd idle timer would let
  // Node exit the moment the queue is empty.
  keepProcessAlive: true,
  models: () => ({
    extraction: routes.roles.matterExtraction,
    synthesis: routes.roles.matterSynthesis,
  }),
  hooks: {
    afterUnit: async (claim) => {
      log({ event: "unit-done", runId: claim.runId, unitNo: claim.unitNo });
      if (args.pauseMs > 0) await pause(args.pauseMs);
    },
  },
  log,
});

log({ event: "worker-started", workerId: worker.workerId, models: routes.status });

let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

if (args.once) {
  const report = await worker.drain();
  log({ event: "worker-drained", ...report });
  await shutdown(0);
} else {
  worker.start();
}
