/**
 * W20: the review grid, persisted and resumable — against the REAL local
 * PostgreSQL.
 *
 * The answer port here is a STUB (it records every call and returns a fixed,
 * well-formed answer). It proves the grid's durability, per-cell retry,
 * scope and provenance plumbing — not answer quality, which the answer
 * pipeline's own suites cover. The `extract_*` columns run the REAL
 * deterministic extractor over every unit of the pinned version.
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import type { AnswerPort } from "../../src/api/answerService.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import { PgReviewTableStore } from "../../src/reviewTables/store.js";
import { ReviewTableWorker } from "../../src/reviewTables/worker.js";
import { createReviewTableRouter, csvField } from "../../src/reviewTables/routes.js";
import { PgMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { get, insertUpload, linkFiles, paragraphs, post, sleep } from "../exhaustive/durableFixtures.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_review_tables_test");

let sql: Sql;
let matters: MatterStore;
let store: PgReviewTableStore;
let documents: PgDurableAnalysisStore;
let app: ReturnType<typeof createReviewTableRouter>;
const versions = new Map<string, string>();

class StubAnswers implements AnswerPort {
  readonly calls = new Map<string, number>();
  failing = true;

  async answer(request: Parameters<AnswerPort["answer"]>[0]): ReturnType<AnswerPort["answer"]> {
    const fileId = request.filters?.fileIds?.[0] ?? "?";
    const key = `${fileId}|${request.question}`;
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
    if (request.question === "HATA" && this.failing) throw new Error("cevap hattı yanıt vermedi");
    if (request.question === "BOŞ") {
      return {
        result: { runId: "run-bos", status: "ABSTAIN", claims: [], evidence: [], coverage: { missing: ["ipotek"] } },
      } as never;
    }
    return {
      result: {
        runId: `run-${fileId}`,
        status: "COMPLETE",
        claims: [{ text: `Cevap (${fileId})`, verdict: "SUPPORTED", evidenceIds: ["ev-1"] }],
        evidence: [
          {
            evidenceId: "ev-1",
            documentVersionId: versions.get(fileId) ?? "",
            chunkId: "chunk-1",
            startChar: 0,
            endChar: 9,
            quoteSha256: "a".repeat(64),
          },
        ],
      },
    } as never;
  }
}

function newWorker(answers: StubAnswers, sqlClient: Sql = sql): ReviewTableWorker {
  return new ReviewTableWorker({
    store: new PgReviewTableStore(sqlClient),
    answer: answers,
    documents: new PgDurableAnalysisStore(sqlClient),
    retryBackoffMs: 0,
    batchSize: 1,
  });
}

async function create(body: Record<string, unknown>): Promise<string> {
  const response = await post(app, "/v1/review-tables", body);
  expect(response.status).toBe(202);
  return response.body.tableId as string;
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  const planted = [
    "Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır.",
    "İhtarname 11.03.2024 tarihinde tebliğ edilmiştir.",
    "Kira bedeli 45.000 TL olarak ödenmiştir.",
  ];
  for (const [fileId, extra] of [["grid-a", false], ["grid-b", false], ["grid-scan", true]] as const) {
    const inserted = await insertUpload(sql, {
      fileId,
      title: `Belge ${fileId}`,
      blocks: paragraphs(planted, 10),
      unreadablePage: extra,
    });
    versions.set(fileId, inserted.versionId);
  }
  matters = new PgMatterStore({ sql });
  store = new PgReviewTableStore(sql);
  documents = new PgDurableAnalysisStore(sql);
  app = createReviewTableRouter({ store, matters });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("the persisted review grid", () => {
  it("stores every cell, answers each MODE honestly, and keeps provenance", async () => {
    const answers = new StubAnswers();
    const tableId = await create({
      fileIds: ["grid-a", "grid-b"],
      questions: ["Kira bedeli nedir?", { text: "Belgedeki bütün tarihler", mode: "extract_dates" }],
    });
    const queued = await get(app, `/v1/review-tables/${tableId}`);
    expect(queued.body.progress).toEqual(expect.objectContaining({ total: 4, pending: 4 }));

    await newWorker(answers).drain();
    const done = await get(app, `/v1/review-tables/${tableId}`);
    expect(done.body.table.status).toBe("done");
    expect(done.body.progress.done).toBe(4);

    const answerCell = done.body.cells.find((cell: any) => cell.rowNo === 1 && cell.columnNo === 1);
    expect(answerCell.supportState).toBe("verified");
    expect(answerCell.provenance[0]).toEqual(
      expect.objectContaining({ fileId: "grid-a", documentVersionId: versions.get("grid-a") }),
    );

    const datesCell = done.body.cells.find((cell: any) => cell.rowNo === 1 && cell.columnNo === 2);
    expect(datesCell.supportState).toBe("exhaustive_complete");
    expect(datesCell.answerText).toContain("01.02.2023");
    expect(datesCell.answerText).toContain("11.03.2024");
    expect(datesCell.answerText).toContain("(s. 1)");
    expect(datesCell.processingCoverage.complete).toBe(true);
    // Every listed value slices the pinned canonical text to its quote hash.
    for (const entry of datesCell.provenance) {
      const rows = await sql`
        select substring(canonical_text from ${entry.startChar + 1}::int for ${entry.endChar - entry.startChar}::int) as slice
        from legal.document_versions where id = ${entry.documentVersionId}::uuid`;
      const hash = createHash("sha256").update(String(rows[0]!["slice"]), "utf8").digest("hex");
      expect(hash).toBe(entry.quoteSha256);
    }
  });

  it("an exhaustive column over a document with an unreadable page is marked incomplete", async () => {
    const tableId = await create({
      fileIds: ["grid-scan"],
      questions: [{ text: "Tutarlar", mode: "extract_amounts" }],
    });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = table.body.cells[0];
    expect(cell.supportState).toBe("exhaustive_incomplete");
    expect(cell.answerText).toContain("45.000");
    expect(cell.answerText).toContain("eksik olabilir");
    expect(cell.processingCoverage.complete).toBe(false);
  });

  it("resumes after a restart and never recomputes a finished cell", async () => {
    const answers = new StubAnswers();
    const tableId = await create({
      fileIds: ["grid-a", "grid-b"],
      questions: ["Birinci soru?", "İkinci soru?"],
    });
    // The first worker finishes two cells...
    const first = newWorker(answers);
    await first.tick();
    await first.tick();
    // ...and a worker that then dies holds a third one under a lease.
    const deadClaims = await store.claimCells("dead-worker", 1, 200);
    expect(deadClaims.length).toBe(1);
    await sleep(350);

    // A fresh process: a new connection pool and a new worker.
    const freshSql = connectTestDb(SCRATCH);
    try {
      await newWorker(answers, freshSql).drain();
    } finally {
      await freshSql.end({ timeout: 5 });
    }
    const table = await get(app, `/v1/review-tables/${tableId}`);
    expect(table.body.progress.done).toBe(4);
    for (const count of [...answers.calls.values()]) expect(count).toBe(1);
    expect(answers.calls.size).toBe(4);
  });

  it("a failed cell is retried ALONE; nothing else is recomputed", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a", "grid-b"], questions: ["Kira bedeli nedir?", "HATA"] });
    await newWorker(answers).drain();
    let table = await get(app, `/v1/review-tables/${tableId}`);
    const failed = table.body.cells.filter((cell: any) => cell.state === "failed");
    expect(failed.length).toBe(2);
    expect(failed.every((cell: any) => cell.attempts === 3)).toBe(true);
    expect(table.body.table.status).toBe("done");

    answers.failing = false;
    const retry = await post(app, `/v1/review-tables/${tableId}/cells/1/2/retry`);
    expect(retry.status).toBe(202);
    await newWorker(answers).drain();

    table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (row: number, column: number) =>
      table.body.cells.find((entry: any) => entry.rowNo === row && entry.columnNo === column);
    expect(cell(1, 2).state).toBe("done");
    expect(cell(2, 2).state).toBe("failed"); // not retried: nobody asked
    expect(answers.calls.get("grid-a|Kira bedeli nedir?")).toBe(1);
    expect(answers.calls.get("grid-b|Kira bedeli nedir?")).toBe(1);
    expect(answers.calls.get("grid-a|HATA")).toBe(4); // 3 failed attempts + 1 retry
    expect(answers.calls.get("grid-b|HATA")).toBe(3);
  });

  it("an abstaining cell says so instead of inventing an answer", async () => {
    const tableId = await create({ fileIds: ["grid-a"], questions: ["BOŞ"] });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    expect(table.body.cells[0].supportState).toBe("no_evidence");
    expect(table.body.cells[0].answerText).toContain("ipotek");
    expect(table.body.cells[0].provenance).toEqual([]);
  });

  it("cancel stops every cell that has not started", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a", "grid-b"], questions: ["Soru?"] });
    const cancel = await post(app, `/v1/review-tables/${tableId}/cancel`);
    expect(cancel.status).toBe(202);
    await newWorker(answers).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    expect(table.body.table.status).toBe("cancelled");
    expect(table.body.progress.cancelled).toBe(2);
    expect(answers.calls.size).toBe(0);
  });
});

describe("scope, refusal and export", () => {
  it("a matter-scoped table never widens beyond the matter's files", async () => {
    const matter = await matters.create({ title: "Izgara dosyası" });
    await linkFiles(matters, matter.id, ["grid-a"]);
    const response = await post(app, "/v1/review-tables", {
      matterId: matter.id,
      fileIds: ["grid-a", "grid-b"],
      questions: ["Soru?"],
    });
    expect(response.status).toBe(409);
    expect(response.body.error.kind).toBe("FILES_OUTSIDE_MATTER");
  });

  it("unknown files are refused, never silently dropped", async () => {
    const response = await post(app, "/v1/review-tables", { fileIds: ["grid-a", "yok-boyle-belge"], questions: ["Soru?"] });
    expect(response.status).toBe(409);
    expect(response.body.error.kind).toBe("FILES_NOT_FOUND");
  });

  it("the CSV export keeps provenance and cannot become a spreadsheet formula", async () => {
    const tableId = await create({ fileIds: ["grid-a"], questions: ['=HYPERLINK("http://x")', "Kira bedeli nedir?"] });
    await newWorker(new StubAnswers()).drain();
    const response = await app.request(`/v1/review-tables/${tableId}/export.csv`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    // UTF-8 BOM so Excel opens Turkish characters correctly (text() strips it).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    expect(body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(body).toContain("a".repeat(64));
    expect(csvField("+1")).toBe(`"'+1"`);
    expect(csvField("-2")).toBe(`"'-2"`);
    expect(csvField("@x")).toBe(`"'@x"`);
    expect(csvField("normal")).toBe(`"normal"`);
  });
});
