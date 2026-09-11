/**
 * Retrieval + evidence measurement driver for the SYNTHETIC fixture corpus.
 *
 * WHICH LAYER THIS MEASURES (read this before quoting any number it produces)
 * -------------------------------------------------------------------------
 * This driver calls the SAME control-plane functions the product uses to serve
 * a corpus search and to turn ranked hits into citable evidence:
 *
 *   control-plane/src/retrieval/searchService.ts  searchLegalCorpus()
 *     -> retrieval/hybrid.ts       searchPipeline()   (normalize -> parse
 *        references -> exact-pin lane -> lexical 'turkish' FTS lane ->
 *        pg_trgm lane -> RRF fusion -> per-document diversity cap)
 *     -> store/chunkStore.ts       exactPinLookup / lexicalSearch /
 *        trigramSearch  (real SQL against the ingested corpus)
 *   control-plane/src/answer/evidencePack.ts      buildEvidencePack()
 *     -> verification/validator.ts (code-point slicing + SHA-256 over UTF-8)
 *
 * It is NOT the HTTP `POST /v1/search` route. That route is still a scaffold
 * that proxies the Deep-Research `search` MCP tool at an upstream provider; it
 * does not read the local corpus at all, so measuring it would measure
 * something other than the corpus retrieval under test. Everything below runs
 * against the local scratch Postgres over loopback and makes no other network
 * call whatsoever.
 *
 * The DENSE lane is a NoopDenseLane here: pgvector is absent from the scratch
 * Postgres, so migrations 080000/090000 are never applied and no embedding
 * lane exists. Every number produced is therefore a LEXICAL + EXACT-PIN
 * baseline, not the full hybrid the brief specifies.
 *
 * EVAL-SIDE ID JOIN (not part of retrieval)
 * -----------------------------------------
 * Retrieval returns database UUIDs, which are regenerated on every ingest and
 * cannot appear in a checked-in gold file. The driver therefore loads a corpus
 * inventory once and maps every chunk id to a stable, human-readable unit id:
 *
 *     <external_id>@<version_label>#<structural_path joined by "/">
 *     e.g. kanun-5237@v2-20260115-7999#madde-157/fikra-1
 *
 * This mapping is a pure post-hoc join for scoring. It never reorders, filters
 * or augments what retrieval returned.
 *
 * Usage:
 *   node <bundled>.mjs --dsn <postgres dsn> --gold <gold.jsonl>
 *                      --out <results.json> [--result-limit 20]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { createDb } from "../../control-plane/src/store/db.js";
import { fetchCanonicalText } from "../../control-plane/src/store/chunkStore.js";
import { searchLegalCorpus } from "../../control-plane/src/retrieval/searchService.js";
import type { RankedHit } from "../../control-plane/src/retrieval/hybrid.js";
import { normalizeTurkishSearch } from "../../control-plane/src/retrieval/normalize.js";
import { parseReferences } from "../../control-plane/src/retrieval/referenceParser.js";
import {
  buildEvidencePack,
  type AnswerCandidate,
  type CanonicalTextPort,
} from "../../control-plane/src/answer/evidencePack.js";
import {
  evaluateQuestionCoverage,
  referenceBypass,
} from "../../control-plane/src/answer/coverage.js";

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
const resultLimit = Number(arg("result-limit", "20"));

if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 100) {
  throw new Error(`--result-limit must be an integer in [1,100], got ${resultLimit}`);
}

// --------------------------------------------------------------------------
// gold
// --------------------------------------------------------------------------

interface GoldRecord {
  id: string;
  question: string;
  as_of: string;
  task_type: string;
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
// corpus inventory (eval-side id join + fabrication/leak ground truth)
// --------------------------------------------------------------------------

interface InventoryRow {
  chunkId: string;
  documentId: string;
  versionId: string;
  unitId: string;
  externalId: string;
  versionLabel: string;
  scope: string;
  tenantId: string | null;
  status: string;
  /**
   * The content hash INGESTION stored for this version. The evidence pack
   * recomputes its own contentSha256 from the text it fetched, so comparing
   * the two is the only check that can catch canonical text drifting away
   * from what was recorded at ingest time.
   */
  storedVersionSha256: string;
}

function unitIdOf(
  externalId: string,
  versionLabel: string | null,
  structuralPath: string[],
): string {
  const label = versionLabel ?? "unlabeled";
  const segment = structuralPath.length > 0 ? structuralPath.join("/") : "root";
  return `${externalId}@${label}#${segment}`;
}

async function loadInventory(sql: ReturnType<typeof createDb>): Promise<InventoryRow[]> {
  const rows = await sql`
    select
      c.id::text            as chunk_id,
      d.id::text            as document_id,
      v.id::text            as version_id,
      d.external_id         as external_id,
      v.version_label       as version_label,
      d.scope               as scope,
      d.tenant_id::text     as tenant_id,
      v.status              as status,
      v.content_sha256      as stored_version_sha256,
      c.structural_path     as structural_path
    from legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id
    order by d.external_id, v.version_label, c.ordinal`;
  return rows.map((row) => {
    const externalId = String(row["external_id"]);
    const versionLabel =
      row["version_label"] === null ? null : String(row["version_label"]);
    const structuralPath = (row["structural_path"] ?? []) as string[];
    return {
      chunkId: String(row["chunk_id"]),
      documentId: String(row["document_id"]),
      versionId: String(row["version_id"]),
      unitId: unitIdOf(externalId, versionLabel, structuralPath),
      externalId,
      versionLabel: versionLabel ?? "unlabeled",
      scope: String(row["scope"]),
      tenantId: row["tenant_id"] === null ? null : String(row["tenant_id"]),
      status: String(row["status"]),
      storedVersionSha256: String(row["stored_version_sha256"]),
    };
  });
}

// --------------------------------------------------------------------------
// hit -> AnswerCandidate (real evidence pack input)
// --------------------------------------------------------------------------

function toCandidate(hit: RankedHit, index: number): AnswerCandidate {
  const p = hit.provenance;
  return {
    hitId: `hit-${index + 1}`,
    documentId: p.documentId,
    documentVersionId: p.documentVersionId,
    chunkId: p.chunkId,
    source: p.source,
    sourceUrl: p.canonicalSourceUrl ?? "",
    title: p.title ?? p.externalId,
    ...(p.decisionDate !== null ? { decisionDate: p.decisionDate } : {}),
    ...(p.docketNo !== null ? { docketNo: p.docketNo } : {}),
    ...(p.decisionNo !== null ? { decisionNo: p.decisionNo } : {}),
    ...(p.legislationNo !== null ? { legislationNo: p.legislationNo } : {}),
    ...(p.articleNo !== null ? { article: p.articleNo } : {}),
    ...(p.paragraphNo !== null ? { paragraph: p.paragraphNo } : {}),
    startChar: p.startChar,
    endChar: p.endChar,
    score: hit.fusedScore,
  };
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const gold = loadGold(goldPath);
  const sql = createDb({ url: dsn, applicationName: "collex-eval-harness" });

  const inventoryStart = performance.now();
  const inventory = await loadInventory(sql);
  const inventoryMs = performance.now() - inventoryStart;

  const byChunk = new Map(inventory.map((row) => [row.chunkId, row]));

  // Canonical texts for every version, used both as the evidence port and as
  // the docstore the Python citation checker re-verifies against.
  const versionIds = [...new Set(inventory.map((row) => row.versionId))];
  const canonicalTexts: Record<string, string> = {};
  const canonicalStart = performance.now();
  for (const versionId of versionIds) {
    const record = await fetchCanonicalText(sql, versionId);
    if (record === null) throw new Error(`canonical text missing for ${versionId}`);
    canonicalTexts[versionId] = record.canonicalText;
  }
  const canonicalMs = performance.now() - canonicalStart;

  const texts: CanonicalTextPort = {
    async getCanonicalText(documentVersionId: string) {
      return canonicalTexts[documentVersionId];
    },
  };

  const results: unknown[] = [];

  for (const record of gold) {
    const searchStart = performance.now();
    const outcome = await searchLegalCorpus(sql, {
      query: record.question,
      asOf: record.as_of,
      limits: { resultLimit },
    });
    const searchMs = performance.now() - searchStart;

    const hits: RankedHit[] = outcome.status === "error" ? [] : outcome.data;
    const warnings = outcome.status === "error" ? [] : outcome.warnings;

    const packStart = performance.now();
    const pack = await buildEvidencePack(hits.map(toCandidate), texts, {
      asOf: record.as_of,
    });
    const evidenceMs = performance.now() - packStart;

    // ANSWER-LAYER ABSTENTION (W12 lane B). The product abstains not only on
    // an empty retrieval but also when the question-coverage gate
    // (control-plane/src/answer/coverage.ts) refuses the validated passages.
    // The SAME function and the SAME bypass rule the pipeline uses are run
    // here, over the SAME validated quotes, so the report can say what the
    // product would have done with this retrieval. One documented
    // difference: the driver measures over every ranked hit (up to
    // --result-limit), the product over its top-8 evidence pack; more
    // passages can only raise union coverage, so the product is at least as
    // strict as what is reported here.
    const references = parseReferences(normalizeTurkishSearch(record.question));
    const coverage = evaluateQuestionCoverage(
      record.question,
      pack.items.map((item) => item.ref.quote),
      { referenceMatched: referenceBypass(references, hits) },
    );
    const answerAbstained = pack.items.length === 0 || coverage.gate === "failed";

    const ranked = hits.map((hit, index) => {
      const row = byChunk.get(hit.chunkId);
      return {
        rank: index + 1,
        chunkId: hit.chunkId,
        documentId: hit.documentId,
        documentVersionId: hit.documentVersionId,
        // null when retrieval returned a chunk id that is not in the corpus
        // inventory at all -> a fabricated id (gated to zero).
        unitId: row?.unitId ?? null,
        scope: row?.scope ?? null,
        tenantId: row?.tenantId ?? null,
        pinned: hit.pinned,
        ...(hit.pinReason !== undefined ? { pinReason: hit.pinReason } : {}),
        fusedScore: hit.fusedScore,
        lanes: hit.lanes,
      };
    });

    results.push({
      id: record.id,
      task_type: record.task_type,
      as_of: record.as_of,
      question: record.question,
      status: outcome.status,
      warnings,
      abstained: hits.length === 0,
      answer_abstained: answerAbstained,
      coverage: {
        ratio: coverage.ratio,
        gate: coverage.gate,
        floor: coverage.floor,
        lexemes: coverage.lexemes,
        covered: coverage.covered,
        missing: coverage.missing,
        passages: coverage.passages,
        bestPassageCovered: coverage.bestPassageCovered,
      },
      latency_ms: searchMs,
      stage_ms: { search: searchMs, evidence: evidenceMs },
      ranked,
      evidence: pack.items.map((item) => ({
        evidenceId: item.ref.evidenceId,
        chunkId: item.ref.chunkId,
        documentId: item.ref.documentId,
        documentVersionId: item.ref.documentVersionId,
        locator: item.ref.locator,
        quote: item.ref.quote,
        quoteSha256: item.ref.quoteSha256,
        contentSha256: item.ref.contentSha256,
        authorityTier: item.authority.tier,
        currentness: item.currentness.status,
      })),
      rejected_evidence: pack.rejected.map((entry) => ({
        chunkId: entry.candidate.chunkId,
        documentVersionId: entry.candidate.documentVersionId,
        reason: entry.reason,
      })),
    });
  }

  const payload = {
    measured_layer: "control-plane searchLegalCorpus (exact-pin + turkish FTS + pg_trgm + RRF); dense lane = NoopDenseLane (pgvector absent)",
    dense_lane: "noop",
    result_limit: resultLimit,
    node_version: process.version,
    stage_ms: { inventory: inventoryMs, canonical_text: canonicalMs },
    inventory: inventory.map((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      versionId: row.versionId,
      unitId: row.unitId,
      externalId: row.externalId,
      versionLabel: row.versionLabel,
      scope: row.scope,
      tenantId: row.tenantId,
      status: row.status,
      storedVersionSha256: row.storedVersionSha256,
    })),
    canonical_texts: canonicalTexts,
    results,
  };

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await sql.end({ timeout: 5 });
  process.stdout.write(
    `measured ${results.length} queries over ${inventory.length} chunks -> ${outPath}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`measure_retrieval failed: ${String(error)}\n`);
  process.exitCode = 1;
});
