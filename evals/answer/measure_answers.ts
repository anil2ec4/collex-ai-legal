/**
 * ANSWER-LEVEL measurement driver for the SYNTHETIC fixture corpus (W12-B2).
 *
 * WHICH LAYER THIS MEASURES (read this before quoting any number it produces)
 * -------------------------------------------------------------------------
 * `evals/retrieval/measure_retrieval.ts` measures retrieval + evidence
 * building and runs the coverage gate over the FULL ranked set. The product
 * does more than that: it caps the pack (coverage-aware), drafts claims,
 * verifies every citation, judges entailment, applies the finalization policy
 * and decides a status. A cap-induced false abstention, a claim that fails
 * entailment, or an answer that is QUALIFIED-but-not-finalizable is invisible
 * to the retrieval report. This driver runs the SAME `AnswerPipeline` the
 * `POST /v1/answer` route runs, with the SAME server-tier limits
 * (`DEFAULT_ANSWER_LIMITS` from control-plane/src/api/answerService.ts), the
 * rule-based drafter and the lexical entailment floor (no LLM is wired), over
 * every gold query, and records what the product would have said.
 *
 *   control-plane/src/pipeline/answerPipeline.ts   AnswerPipeline.answer()
 *     -> pipeline/storeAdapters.ts (real SQL retrieval / canonical text /
 *        version facts over the ingested corpus)
 *     -> answer/evidencePack.ts, answer/coverage.ts, llm/ruleDrafter.ts,
 *        answer/verifier.ts, verification/finalize.ts, answer/renderer.ts
 *
 * WHAT THE NUMBERS ARE NOT
 * ------------------------
 * Not a legal-quality benchmark (the corpus is SENTETİK) and NOT a hard gate:
 * `scripts/run_evals.py` reports this section (`answer_level`) and applies no
 * threshold to it this wave. Claim TEXT correctness against `required_claims`
 * is still not scored — that needs lawyer adjudication.
 *
 * EVAL-SIDE ID JOIN (not part of the pipeline)
 * -------------------------------------------
 * Evidence rows carry database chunk ids, which are regenerated on every
 * ingest. The driver loads the corpus inventory once and maps each chunk id
 * to the stable unit id the gold set uses:
 *
 *     <external_id>@<version_label>#<structural_path joined by "/">
 *
 * The join is a pure post-hoc lookup for scoring; it never changes what the
 * pipeline produced.
 *
 * Usage (bundled by scripts/run_evals.py with esbuild, like the retrieval driver):
 *   node <bundled>.mjs --dsn <postgres dsn> --gold <gold.jsonl> --out <answers.json>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { DEFAULT_ANSWER_LIMITS } from "../../control-plane/src/api/answerService.js";
import {
  AnswerPipeline,
  IntakeValidationError,
  type AnswerResult,
} from "../../control-plane/src/pipeline/answerPipeline.js";
import {
  createStoreRetrievalPort,
  createStoreTextPort,
  createStoreVersionFactsPort,
} from "../../control-plane/src/pipeline/storeAdapters.js";
import { createDb } from "../../control-plane/src/store/db.js";

// --------------------------------------------------------------------------
// argv
// --------------------------------------------------------------------------

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1] as string;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`missing required argument --${name}`);
}

const dsn = arg("dsn");
const goldPath = arg("gold");
const outPath = arg("out");

// --------------------------------------------------------------------------
// gold
// --------------------------------------------------------------------------

interface GoldRecord {
  id: string;
  question: string;
  as_of: string;
  task_type: string;
  acceptable_abstention?: boolean;
  expected_documents?: string[];
}

function loadGold(path: string): GoldRecord[] {
  const out: GoldRecord[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    out.push(JSON.parse(line) as GoldRecord);
  }
  return out;
}

// --------------------------------------------------------------------------
// corpus inventory (eval-side id join)
// --------------------------------------------------------------------------

function unitIdOf(
  externalId: string,
  versionLabel: string | null,
  structuralPath: string[],
): string {
  const label = versionLabel ?? "unlabeled";
  const segment = structuralPath.length > 0 ? structuralPath.join("/") : "root";
  return `${externalId}@${label}#${segment}`;
}

async function loadUnitIds(sql: ReturnType<typeof createDb>): Promise<Map<string, string>> {
  const rows = await sql`
    select
      c.id::text            as chunk_id,
      d.external_id         as external_id,
      v.version_label       as version_label,
      c.structural_path     as structural_path
    from legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id`;
  const out = new Map<string, string>();
  for (const row of rows) {
    const versionLabel = row["version_label"] === null ? null : String(row["version_label"]);
    const structuralPath = (row["structural_path"] ?? []) as string[];
    out.set(
      String(row["chunk_id"]),
      unitIdOf(String(row["external_id"]), versionLabel, structuralPath),
    );
  }
  return out;
}

// --------------------------------------------------------------------------
// result rows
// --------------------------------------------------------------------------

interface AnswerRow {
  id: string;
  task_type: string;
  as_of: string;
  question: string;
  /** AnswerStatus, or "ERROR" when the pipeline threw (recorded, never hidden). */
  status: string;
  finalizable: boolean;
  reasons: string[];
  warnings: string[];
  claims: number;
  claim_verdicts: Record<string, number>;
  evidence: {
    chunkId: string;
    unitId: string | null;
    origin: string | null;
    currentness: string;
  }[];
  set_aside: number;
  coverage: {
    ratio: number;
    gate: string;
    setAside: number;
    missing: string[];
  } | null;
  latency_ms: number;
  error?: string;
}

function toRow(
  record: GoldRecord,
  result: AnswerResult,
  unitByChunk: ReadonlyMap<string, string>,
  latencyMs: number,
): AnswerRow {
  const verdicts: Record<string, number> = {};
  for (const claim of result.claims) {
    verdicts[claim.verdict] = (verdicts[claim.verdict] ?? 0) + 1;
  }
  return {
    id: record.id,
    task_type: record.task_type,
    as_of: record.as_of,
    question: record.question,
    status: result.status,
    finalizable: result.finalizable,
    reasons: [...result.reasons],
    warnings: [...result.warnings],
    claims: result.claims.length,
    claim_verdicts: verdicts,
    evidence: result.evidence.map((item) => ({
      chunkId: item.chunkId,
      unitId: unitByChunk.get(item.chunkId) ?? null,
      origin: item.origin ?? null,
      currentness: item.currentness.status,
    })),
    set_aside: result.contraryCoverage.observed.length,
    coverage:
      result.coverage === undefined
        ? null
        : {
            ratio: result.coverage.ratio,
            gate: result.coverage.gate,
            setAside: result.coverage.setAside,
            missing: [...result.coverage.missing],
          },
    latency_ms: latencyMs,
  };
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const gold = loadGold(goldPath);
  const sql = createDb({ url: dsn, applicationName: "collex-eval-answers" });

  const inventoryStart = performance.now();
  const unitByChunk = await loadUnitIds(sql);
  const inventoryMs = performance.now() - inventoryStart;

  // EXACTLY the answer route's construction (scripts/serve.mjs, demo.mjs):
  // real store adapters, rule-based drafter, lexical entailment, server-tier
  // limits. The producer string only labels the exported bundle.
  const pipeline = new AnswerPipeline({
    retrieval: createStoreRetrievalPort(sql),
    texts: createStoreTextPort(sql),
    versionFacts: createStoreVersionFactsPort(sql),
    limits: DEFAULT_ANSWER_LIMITS,
    producer: "collex.evals/answer/measure_answers.ts",
  });

  const results: AnswerRow[] = [];
  for (const record of gold) {
    const started = performance.now();
    try {
      const run = await pipeline.answer({ question: record.question, asOf: record.as_of });
      results.push(toRow(record, run.result, unitByChunk, performance.now() - started));
    } catch (error) {
      // A thrown error is a finding, not a reason to drop the row: the report
      // lists it under status ERROR so it can never hide inside an average.
      const message =
        error instanceof IntakeValidationError
          ? `IntakeValidationError: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      results.push({
        id: record.id,
        task_type: record.task_type,
        as_of: record.as_of,
        question: record.question,
        status: "ERROR",
        finalizable: false,
        reasons: [],
        warnings: [],
        claims: 0,
        claim_verdicts: {},
        evidence: [],
        set_aside: 0,
        coverage: null,
        latency_ms: performance.now() - started,
        error: message.slice(0, 300),
      });
    }
  }

  const payload = {
    measured_layer:
      "control-plane AnswerPipeline (DEFAULT_ANSWER_LIMITS; rule-based drafter; lexical entailment; " +
      "store adapters over the ingested corpus)",
    limits: { ...DEFAULT_ANSWER_LIMITS },
    drafter: "rule-based (llm/ruleDrafter.ts)",
    entailment: "lexical (llm/lexicalEntailment.ts)",
    node_version: process.version,
    stage_ms: { inventory: inventoryMs },
    results,
  };

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await sql.end({ timeout: 5 });
  process.stdout.write(`answered ${results.length} gold queries -> ${outPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`measure_answers failed: ${String(error)}\n`);
  process.exitCode = 1;
});
