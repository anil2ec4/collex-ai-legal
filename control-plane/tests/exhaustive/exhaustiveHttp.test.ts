/**
 * Exhaustive Matter analysis, end to end over HTTP against the REAL local
 * PostgreSQL: matter scope -> durable census -> contradictions -> coverage.
 *
 * This is the test that proves the feature is wired rather than merely
 * written: it goes through the mounted router, the real store, real tables
 * and real RLS-bearing SQL, and it asserts the two properties the product
 * claim rests on —
 *
 *   1. the census is DURABLE (units exist as rows before any result does);
 *   2. `processingCoverage.complete` reflects what was actually read, and an
 *      unreadable page makes it false.
 *
 * The corpus is synthetic. This proves plumbing, never Turkish legal quality.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Sql } from "../../src/store/db.js";
import { createExhaustiveRouter } from "../../src/exhaustive/routes.js";
import { PgExhaustiveStore, LOCAL_TENANT_ID } from "../../src/exhaustive/store.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

/** This lane owns its own scratch database (see testDb.ts::scratchDatabase). */
const SCRATCH = scratchDatabase("collex_exhaustive_test");

let sql: Sql;
let matters: MatterStore;
let app: ReturnType<typeof createExhaustiveRouter>;

/** Insert a tenant upload with chunks and page segments, as intake would. */
async function insertUpload(options: {
  fileId: string;
  title: string;
  paragraphs: readonly string[];
  unreadablePage?: boolean;
}): Promise<void> {
  const canonical = options.paragraphs.join("\n\n");

  // Column names match tests/store/fixtures.ts::insertFixtures, which is the
  // proven shape for these tables.
  const docRows = await sql`
    insert into legal.documents
      (scope, tenant_id, source, external_id, document_type, jurisdiction, title)
    values ('tenant'::legal.document_scope, ${LOCAL_TENANT_ID}::uuid, 'UPLOAD',
            ${options.fileId}, 'upload', 'TR', ${options.title})
    returning id`;
  const documentId = String(docRows[0]!["id"]);

  const snapRows = await sql`
    insert into legal.source_snapshots
      (source, external_id, retrieved_at, media_type, raw_sha256,
       parser_name, parser_version)
    values ('UPLOAD', ${options.fileId}, now(), 'text/plain',
            ${sha(options.fileId)}, 'test-parser', '1.0.0')
    returning id`;
  const snapshotId = String(snapRows[0]!["id"]);

  const versionRows = await sql`
    insert into legal.document_versions
      (document_id, source_snapshot_id, version_label, status,
       canonical_text, normalized_text, content_sha256)
    values (${documentId}, ${snapshotId}, 'v1', 'published',
            ${canonical}, ${canonical.toLowerCase()}, ${sha(canonical)})
    returning id`;
  const versionId = String(versionRows[0]!["id"]);

  let cursor = 0;
  for (let index = 0; index < options.paragraphs.length; index += 1) {
    const text = options.paragraphs[index] as string;
    const start = cursor;
    const end = start + [...text].length;
    await sql`
      insert into legal.chunks
        (document_version_id, ordinal, structural_path, start_char, end_char,
         original_text, search_text, normalizer_version, content_sha256)
      values (${versionId}, ${index}, ${["metin"]}, ${start}, ${end}, ${text},
              ${text.toLowerCase()}, 'trnorm-v1', ${sha(text)})`;
    cursor = end + 2; // the two-newline joiner is two code points
  }

  await sql`
    insert into legal.document_version_segments (document_version_id,
      segment_no, locator_kind, locator_label, start_char, end_char,
      extraction_method, extraction_status)
    values (${versionId}, 1, 'page', '1', 0, ${[...canonical].length},
            'pdf_text_layer', 'EXTRACTED')`;

  if (options.unreadablePage === true) {
    // A scanned page: present in the ledger, contributing no characters.
    await sql`
      insert into legal.document_version_segments (document_version_id,
        segment_no, locator_kind, locator_label, start_char, end_char,
        extraction_method, extraction_status)
      values (${versionId}, 2, 'page', '2', ${[...canonical].length},
              ${[...canonical].length}, 'none', 'UNREADABLE')`;
  }
}

function sha(text: string): string {
  // Deterministic 64-hex; the tables only require the shape here.
  let hash = 0n;
  for (const character of text) {
    hash = (hash * 31n + BigInt(character.codePointAt(0) ?? 0)) % (2n ** 128n);
  }
  return hash.toString(16).padStart(64, "0").slice(0, 64);
}

async function linkFiles(matterId: string, fileIds: readonly string[]): Promise<void> {
  for (const fileId of fileIds) {
    await matters.addItem(matterId, {
      kind: "file",
      refId: fileId,
      payload: { fileName: `${fileId}.pdf` },
    });
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await app.request(path);
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

const FILLER =
  "Bu paragraf dosyanın hacmini artırmak için eklenmiş olup uyuşmazlığın esasına ilişkin bilgi içermez.";

function paragraphs(planted: string, count = 12): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < count; i += 1) blocks.push(`Paragraf ${i + 1}. ${FILLER}`);
  blocks.splice(Math.floor(count / 2), 0, planted);
  return blocks;
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);

  await insertUpload({
    fileId: "aaaa1111",
    title: "Dava dilekçesi",
    paragraphs: paragraphs(
      "Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir.",
    ),
  });
  await insertUpload({
    fileId: "bbbb2222",
    title: "Bilirkişi raporu",
    paragraphs: paragraphs(
      "İnceleme sonucunda ödenen kira bedeli 32.000 TL olarak tespit edilmiştir.",
    ),
  });
  await insertUpload({
    fileId: "cccc3333",
    title: "Taranmış ek",
    paragraphs: paragraphs("Ekte sunulan belge dosyaya konulmuştur.", 4),
    unreadablePage: true,
  });

  // The REAL matter store: `matter_analysis_runs.matter_id` carries a
  // foreign key to app_private.matters, so an in-memory matter would not
  // exist as far as the database is concerned — and that FK is the thing
  // keeping a run attached to a matter that still exists.
  matters = new PgMatterStore({ sql });
  app = createExhaustiveRouter({
    store: new PgExhaustiveStore(sql),
    matters,
  });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("POST /v1/matters/{id}/analysis", () => {
  it("reviews the WHOLE matter and reports complete coverage", async () => {
    const matter = await matters.create({ title: "Kira davası" });
    await linkFiles(matter.id, ["aaaa1111", "bbbb2222"]);

    const { status, body } = await post(`/v1/matters/${matter.id}/analysis`, {
      task: "contradictions",
    });

    expect(status).toBe(201);
    const coverage = body.processingCoverage;
    expect(coverage.filesTotal).toBe(2);
    expect(coverage.filesProcessed).toBe(2);
    expect(coverage.pagesTotal).toBe(2);
    expect(coverage.pagesUnreadable).toBe(0);
    expect(coverage.analysisUnitsProcessed).toBe(coverage.analysisUnitsTotal);
    expect(coverage.analysisUnitsTotal).toBeGreaterThan(0);
    expect(coverage.complete).toBe(true);
    expect(body.coverageSummary).toContain("tamamı okundu");
    expect(body.exhaustiveClaimRefusedBecause).toBeNull();
  });

  it("finds the contradiction planted in two different documents", async () => {
    const matter = await matters.create({ title: "Kira davası 2" });
    await linkFiles(matter.id, ["aaaa1111", "bbbb2222"]);

    const { body } = await post(`/v1/matters/${matter.id}/analysis`, {
      task: "contradictions",
    });

    const contradictions = body.findings.relations.filter(
      (r: { relation: string }) => r.relation === "CONTRADICTION",
    );
    expect(contradictions.length).toBeGreaterThan(0);
    const crossDocument = contradictions.find(
      (r: { left: { fileId: string }; right: { fileId: string } }) =>
        r.left.fileId !== r.right.fileId,
    );
    expect(crossDocument).toBeDefined();
    expect(crossDocument.rationale).toContain("İkisi birden doğru olamaz");
  });

  it("writes a DURABLE census: units are rows, not just a response", async () => {
    const matter = await matters.create({ title: "Kalıcı sayım" });
    await linkFiles(matter.id, ["aaaa1111"]);
    const { body } = await post(`/v1/matters/${matter.id}/analysis`, {});

    const rows = await sql`
      select state, count(*)::int as n
      from app_private.matter_analysis_units
      where run_id = ${body.runId}::uuid
      group by state`;
    const byState = new Map(rows.map((r) => [String(r["state"]), Number(r["n"])]));
    expect(byState.get("done")).toBe(body.processingCoverage.analysisUnitsTotal);

    // And the observations kept their provenance.
    const observations = await sql`
      select quote, quote_sha256, locator, start_char, end_char, file_id
      from app_private.matter_observations
      where run_id = ${body.runId}::uuid
      limit 5`;
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(String(observation["quote_sha256"])).toMatch(/^[0-9a-f]{64}$/u);
      expect(String(observation["locator"])).toBe("s. 1");
      expect(Number(observation["end_char"])).toBeGreaterThan(
        Number(observation["start_char"]),
      );
    }
  });

  it("an unreadable page makes coverage incomplete and is itemized", async () => {
    const matter = await matters.create({ title: "Taranmış ek dosyası" });
    await linkFiles(matter.id, ["aaaa1111", "cccc3333"]);

    const { body } = await post(`/v1/matters/${matter.id}/analysis`, {});

    expect(body.processingCoverage.complete).toBe(false);
    expect(body.processingCoverage.pagesUnreadable).toBe(1);
    expect(body.processingCoverage.gaps).toContainEqual(
      expect.objectContaining({ locator: "s. 2", reason: "UNREADABLE_NO_TEXT" }),
    );
    // The product must NOT be allowed to claim it read the whole file.
    expect(body.coverageSummary).not.toContain("tamamı okundu");
    expect(body.exhaustiveClaimRefusedBecause).toContain("okunamadı");
  });

  it("a SECOND analysis of an unchanged matter returns the SAME findings", async () => {
    // The defect this locks: reuse used to span FINISHED runs, so the second
    // request skipped every unit, emitted no observations, and still
    // reported complete coverage — "I read all of it" with nothing found.
    // A new request is a new question and gets its own complete extraction.
    const matter = await matters.create({ title: "Yeniden çalıştırma" });
    await linkFiles(matter.id, ["aaaa1111", "bbbb2222"]);
    const first = await post(`/v1/matters/${matter.id}/analysis`, {});
    const second = await post(`/v1/matters/${matter.id}/analysis`, {});

    expect(second.body.runId).not.toBe(first.body.runId);
    expect(second.body.processingCoverage).toEqual(first.body.processingCoverage);
    expect(second.body.processingCoverage.complete).toBe(true);

    // The findings must NOT be empty, and must match the first run.
    expect(first.body.findings.observations).toBeGreaterThan(0);
    expect(second.body.findings.observations).toBe(first.body.findings.observations);
    expect(second.body.findings.relations.map((r: { relation: string }) => r.relation))
      .toEqual(first.body.findings.relations.map((r: { relation: string }) => r.relation));

    // And the observations really were written under the NEW run.
    const stored = await sql`
      select count(*)::int as n from app_private.matter_observations
      where run_id = ${second.body.runId}::uuid`;
    expect(Number(stored[0]!["n"])).toBe(second.body.findings.observations);
  });

  it("refuses a matter with no documents instead of reporting a clean run", async () => {
    const matter = await matters.create({ title: "Boş dosya" });
    const { status, body } = await post(`/v1/matters/${matter.id}/analysis`, {});
    expect(status).toBe(409);
    expect(body.error.kind).toBe("MATTER_EMPTY");
  });

  it("refuses a file that is not linked to the matter", async () => {
    const matter = await matters.create({ title: "Kapsam dışı" });
    await linkFiles(matter.id, ["aaaa1111"]);
    const { status, body } = await post(`/v1/matters/${matter.id}/analysis`, {
      fileIds: ["bbbb2222"],
    });
    expect(status).toBe(409);
    expect(body.error.kind).toBe("FILES_OUTSIDE_MATTER");
  });

  it("an unknown matter is 404, never an empty review", async () => {
    const { status } = await post(
      "/v1/matters/11111111-2222-3333-4444-555555555555/analysis",
      {},
    );
    expect(status).toBe(404);
  });

  it("rejects an unknown field rather than ignoring it", async () => {
    const matter = await matters.create({ title: "Katı doğrulama" });
    await linkFiles(matter.id, ["aaaa1111"]);
    const { status, body } = await post(`/v1/matters/${matter.id}/analysis`, {
      derinlik: 9,
    });
    expect(status).toBe(400);
    expect(body.error.kind).toBe("INVALID_REQUEST");
  });
});

describe("GET /v1/matters/{id}/analysis", () => {
  it("lists runs and replays the stored coverage verbatim", async () => {
    const matter = await matters.create({ title: "Geçmiş" });
    await linkFiles(matter.id, ["aaaa1111"]);
    const created = await post(`/v1/matters/${matter.id}/analysis`, {});

    const list = await get(`/v1/matters/${matter.id}/analysis`);
    expect(list.status).toBe(200);
    expect(list.body.runs.some((r: { runId: string }) => r.runId === created.body.runId))
      .toBe(true);

    const one = await get(`/v1/matters/${matter.id}/analysis/${created.body.runId}`);
    expect(one.status).toBe(200);
    expect(one.body.status).toBe("done");
    // Coverage survives the round trip through the database unchanged.
    expect(one.body.processingCoverage).toEqual(created.body.processingCoverage);
    expect(one.body.coverageSummary).toBe(created.body.coverageSummary);
  });

  it("a run id from another matter is not readable through this matter", async () => {
    const a = await matters.create({ title: "A" });
    const b = await matters.create({ title: "B" });
    await linkFiles(a.id, ["aaaa1111"]);
    const created = await post(`/v1/matters/${a.id}/analysis`, {});

    const wrong = await get(`/v1/matters/${b.id}/analysis/${created.body.runId}`);
    expect(wrong.status).toBe(404);
  });
});
