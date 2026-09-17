/**
 * W21 (review-pin, acceptance F): a review-table row reads EXACTLY the
 * document version it was pinned to — through the REAL retrieval stack.
 *
 * The answer column here is computed by the REAL AnswerPipeline over the
 * REAL store ports (createStoreRetrievalPort -> searchLegalCorpus ->
 * searchPipeline -> PgChunkStore lanes), with the deterministic rule-based
 * drafter. The scenario is the one a lawyer lives through: a table is built
 * from V1 of a lease, a contradictory V2 is uploaded afterwards, and the V1
 * cell is recomputed. It must still be grounded ONLY in V1, and the table
 * must say that a newer upload exists instead of silently switching.
 *
 * The text is synthetic: this proves plumbing and provenance, never Turkish
 * legal quality.
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "../../src/store/db.js";
import type { AnswerPort } from "../../src/api/answerService.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import {
  createStoreRetrievalPort,
  createStoreTextPort,
  createStoreVersionFactsPort,
} from "../../src/pipeline/storeAdapters.js";
import { PgDurableAnalysisStore } from "../../src/exhaustive/durableStore.js";
import {
  PIN_FILE_DELETED_TR,
  PIN_UNREADABLE_TR,
  PgReviewTableStore,
  staleReasonOf,
} from "../../src/reviewTables/store.js";
import { ANSWER_INCOMPLETE_TR, PIN_MISMATCH_TR, ReviewTableWorker } from "../../src/reviewTables/worker.js";
import { createReviewTableRouter } from "../../src/reviewTables/routes.js";
import { PgMatterStore } from "../../src/matters/store.js";
import {
  applyMigrationsAndSeed,
  connectTestDb,
  requireScratchPostgres,
  resetScratchDatabase,
  scratchDatabase,
} from "../store/testDb.js";
import { get, insertNewVersion, insertUpload, paragraphs, post } from "../exhaustive/durableFixtures.js";
import { deterministicOptions } from "../pipeline/fakes.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 300_000 });

const SCRATCH = scratchDatabase("collex_w21_review_pin_test");
const AS_OF = "2026-09-11";
const V1_TEXT = "Kira bedeli aylık 45.000 TL olarak kararlaştırılmıştır.";
const V2_TEXT = "Kira bedeli aylık 60.000 TL olarak kararlaştırılmıştır.";
const QUESTION = "Kira bedeli aylık ne kadar olarak kararlaştırılmıştır?";

let sql: Sql;
let store: PgReviewTableStore;
let app: ReturnType<typeof createReviewTableRouter>;
let pipeline: AnswerPipeline;

type AnswerRequest = Parameters<AnswerPort["answer"]>[0];

/** The real pipeline, with every request it receives recorded. */
class RecordingPort implements AnswerPort {
  readonly requests: AnswerRequest[] = [];
  constructor(private readonly inner: AnswerPort) {}
  async answer(request: AnswerRequest): ReturnType<AnswerPort["answer"]> {
    this.requests.push(request);
    return this.inner.answer(request);
  }
}

/** A port whose evidence names a version other than the pinned one. */
class ForeignVersionAnswers implements AnswerPort {
  calls = 0;
  constructor(private readonly status: "COMPLETE" | "ABSTAIN") {}
  async answer(): ReturnType<AnswerPort["answer"]> {
    this.calls += 1;
    return {
      result: {
        runId: "run-foreign",
        status: this.status,
        claims:
          this.status === "ABSTAIN"
            ? []
            : [{ text: "Kira bedeli 60.000 TL.", verdict: "SUPPORTED", evidenceIds: ["ev-x"] }],
        evidence: [
          {
            evidenceId: "ev-x",
            documentVersionId: "00000000-0000-0000-0000-00000000dead",
            chunkId: "00000000-0000-0000-0000-00000000beef",
            startChar: 0,
            endChar: 5,
            quoteSha256: "b".repeat(64),
          },
        ],
      },
    } as never;
  }
}

function newWorker(answer: AnswerPort): ReviewTableWorker {
  return new ReviewTableWorker({
    store,
    answer,
    documents: new PgDurableAnalysisStore(sql),
    retryBackoffMs: 0,
    batchSize: 1,
    today: () => AS_OF,
  });
}

async function create(body: Record<string, unknown>): Promise<string> {
  const response = await post(app, "/v1/review-tables", body);
  expect(response.status).toBe(202);
  return response.body.tableId as string;
}

function cellOf(table: any, row: number, column: number): any {
  return table.cells.find((cell: any) => cell.rowNo === row && cell.columnNo === column);
}

/** The canonical-text slice a provenance entry points at, and its hash check. */
async function sliceOf(entry: {
  documentVersionId: string;
  startChar: number;
  endChar: number;
  quoteSha256: string;
}): Promise<string> {
  const rows = await sql`
    select substring(canonical_text from ${entry.startChar + 1}::int for ${entry.endChar - entry.startChar}::int) as slice
    from legal.document_versions where id = ${entry.documentVersionId}::uuid`;
  const slice = String(rows[0]!["slice"]);
  expect(createHash("sha256").update(slice, "utf8").digest("hex")).toBe(entry.quoteSha256);
  return slice;
}

beforeAll(async () => {
  await requireScratchPostgres();
  await resetScratchDatabase(SCRATCH);
  await applyMigrationsAndSeed(SCRATCH);
  sql = connectTestDb(SCRATCH);
  store = new PgReviewTableStore(sql);
  app = createReviewTableRouter({ store, matters: new PgMatterStore({ sql }) });
  pipeline = new AnswerPipeline({
    retrieval: createStoreRetrievalPort(sql),
    texts: createStoreTextPort(sql),
    versionFacts: createStoreVersionFactsPort(sql),
    ...deterministicOptions(),
  });
});

afterAll(async () => {
  if (sql !== undefined) await sql.end({ timeout: 5 });
});

describe("acceptance F: a row answers from its pinned version after a re-upload", () => {
  it("V1 table, contradictory V2 upload, recompute: grounded ONLY in V1, and reported stale", async () => {
    const v1 = await insertUpload(sql, {
      fileId: "pin-lease",
      title: "Kira sözleşmesi",
      blocks: paragraphs([V1_TEXT], 6),
    });
    const answers = new RecordingPort(pipeline);
    const tableId = await create({
      fileIds: ["pin-lease"],
      questions: [QUESTION, { text: "Belgedeki tutarlar", mode: "extract_amounts" }],
      asOf: AS_OF,
    });

    await newWorker(answers).drain();
    let table = (await get(app, `/v1/review-tables/${tableId}`)).body;
    const first = cellOf(table, 1, 1);
    expect(first.state).toBe("done");
    expect(first.provenance.length).toBeGreaterThan(0);
    expect(new Set(first.provenance.map((entry: any) => entry.documentVersionId))).toEqual(new Set([v1.versionId]));
    // The cell's retrieval was pinned, not merely checked afterwards.
    expect(answers.requests[0]?.filters).toEqual({
      fileIds: ["pin-lease"],
      documentVersionIds: [v1.versionId],
      includeCorpus: false,
    });
    expect(table.rows[0]).toEqual(
      expect.objectContaining({
        documentVersionId: v1.versionId,
        currentDocumentVersionId: v1.versionId,
        stale: false,
        staleReason: null,
      }),
    );
    expect(table.stale).toBe(false);
    expect(table.sourceChanged).toEqual([]);
    expect(await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text()).toContain('"güncel sürüm"');

    // The re-upload: V2 contradicts V1 and becomes the current version.
    const v2 = await insertNewVersion(sql, v1.documentId, "pin-lease", "v2", paragraphs([V2_TEXT], 6));

    // Control: WITHOUT the pin the same stack now reads V2 — so what follows
    // proves the pin, not an accident of the corpus.
    const unpinned = await pipeline.answer({
      question: QUESTION,
      asOf: AS_OF,
      filters: { fileIds: ["pin-lease"], includeCorpus: false },
    });
    expect(unpinned.result.evidence.length).toBeGreaterThan(0);
    expect(new Set(unpinned.result.evidence.map((evidence) => evidence.documentVersionId))).toEqual(new Set([v2]));

    // The table reports the newer upload instead of silently switching.
    table = (await get(app, `/v1/review-tables/${tableId}`)).body;
    expect(table.rows[0]).toEqual(
      expect.objectContaining({
        documentVersionId: v1.versionId,
        currentDocumentVersionId: v2,
        stale: true,
        staleReason: "newer_version",
      }),
    );
    expect(table.stale).toBe(true);
    expect(table.sourceChanged).toEqual(["pin-lease"]);
    // The export says so per row (W21 #19), in words.
    const staleCsv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(staleCsv).toContain('"daha yeni bir sürümü yüklendi; hücreler sabitlenen sürümden"');
    expect(staleCsv).not.toContain('"güncel sürüm"');

    // Recompute BOTH cells of the V1 row.
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/2/retry`)).status).toBe(202);
    await newWorker(answers).drain();

    table = (await get(app, `/v1/review-tables/${tableId}`)).body;
    const recomputed = cellOf(table, 1, 1);
    expect(recomputed.state).toBe("done");
    expect(recomputed.attempts).toBe(1);
    expect(recomputed.provenance.length).toBeGreaterThan(0);
    expect(new Set(recomputed.provenance.map((entry: any) => entry.documentVersionId))).toEqual(
      new Set([v1.versionId]),
    );
    const quotes: string[] = [];
    for (const entry of recomputed.provenance) quotes.push(await sliceOf(entry));
    expect(quotes.some((quote) => quote.includes("45.000"))).toBe(true);
    expect(quotes.some((quote) => quote.includes("60.000"))).toBe(false);
    expect(recomputed.answerText).not.toContain("60.000");
    expect(answers.requests.at(-1)?.filters?.documentVersionIds).toEqual([v1.versionId]);

    const amounts = cellOf(table, 1, 2);
    expect(amounts.state).toBe("done");
    expect(amounts.answerText).toContain("45.000");
    expect(amounts.answerText).not.toContain("60.000");
    expect(amounts.provenance.every((entry: any) => entry.documentVersionId === v1.versionId)).toBe(true);

    // A table built now pins V2, is current, and answers from V2.
    const later = await create({ fileIds: ["pin-lease"], questions: [QUESTION] });
    await newWorker(answers).drain();
    const laterTable = (await get(app, `/v1/review-tables/${later}`)).body;
    expect(laterTable.rows[0]).toEqual(
      expect.objectContaining({ documentVersionId: v2, currentDocumentVersionId: v2, stale: false, staleReason: null }),
    );
    const laterCell = cellOf(laterTable, 1, 1);
    expect(laterCell.state).toBe("done");
    expect(laterCell.provenance.length).toBeGreaterThan(0);
    expect(laterCell.provenance.every((entry: any) => entry.documentVersionId === v2)).toBe(true);
    const laterQuotes: string[] = [];
    for (const entry of laterCell.provenance) laterQuotes.push(await sliceOf(entry));
    expect(laterQuotes.some((quote) => quote.includes("60.000"))).toBe(true);
    expect(laterQuotes.some((quote) => quote.includes("45.000"))).toBe(false);
  });
});

describe("a pin that cannot be read exactly is refused, never replaced", () => {
  it("a cleared pin or another file's version fails the cell at once; the retry is 409 ROW_VERSION_STALE", async () => {
    const gone = await insertUpload(sql, { fileId: "pin-gone", title: "Silinen", blocks: paragraphs([V1_TEXT], 4) });
    const other = await insertUpload(sql, { fileId: "pin-other", title: "Başka", blocks: paragraphs([V2_TEXT], 4) });
    expect(gone.versionId).not.toBe(other.versionId);
    const answers = new RecordingPort(pipeline);
    const tableId = await create({ fileIds: ["pin-gone", "pin-other"], questions: [QUESTION] });
    // Row 1: the version was deleted (the column is ON DELETE SET NULL).
    // Row 2: the pin names a version of ANOTHER file.
    await sql`update app_private.review_table_rows set document_version_id = null
              where table_id = ${tableId}::uuid and row_no = 1`;
    await sql`update app_private.review_table_rows set document_version_id = ${gone.versionId}::uuid
              where table_id = ${tableId}::uuid and row_no = 2`;

    await newWorker(answers).drain();
    const table = (await get(app, `/v1/review-tables/${tableId}`)).body;
    for (const row of [1, 2]) {
      const cell = cellOf(table, row, 1);
      expect(cell.state).toBe("failed");
      expect(cell.attempts).toBe(1); // terminal: no retry budget spent
      expect(cell.error).toBe(PIN_UNREADABLE_TR);
      expect(cell.answerText).toBeNull();
    }
    expect(answers.requests.length).toBe(0); // nothing was answered from any version
    expect(table.rows[0]).toEqual(expect.objectContaining({ documentVersionId: null, stale: true }));
    // W21 (#19): the files still exist; what is gone is the pinned version.
    expect(table.rows[0].staleReason).toBe("pin_gone");
    expect(table.rows[1]).toEqual(expect.objectContaining({ stale: true, staleReason: "pin_gone" }));
    expect(table.table.status).toBe("done");
    // The export names the pin, not a newer upload that does not exist.
    const pinGoneCsv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(pinGoneCsv).toContain('"sabitlenen sürüm artık okunamıyor; hücreler yeniden hesaplanamaz"');
    expect(pinGoneCsv).not.toContain("daha yeni bir sürümü yüklendi");

    const retry = await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toEqual({ kind: "ROW_VERSION_STALE", message: PIN_UNREADABLE_TR });
    expect((await post(app, `/v1/review-tables/${tableId}/cells/9/9/retry`)).status).toBe(404);
  });

  it("an answer or abstention grounded in another version is refused", async () => {
    await insertUpload(sql, { fileId: "pin-foreign", title: "Yabancı", blocks: paragraphs([V1_TEXT], 4) });
    for (const status of ["COMPLETE", "ABSTAIN"] as const) {
      const answers = new ForeignVersionAnswers(status);
      const tableId = await create({ fileIds: ["pin-foreign"], questions: [QUESTION] });
      await newWorker(answers).drain();
      const cell = cellOf((await get(app, `/v1/review-tables/${tableId}`)).body, 1, 1);
      expect(cell.state).toBe("failed");
      expect(cell.attempts).toBe(1);
      expect(cell.error).toBe(PIN_MISMATCH_TR);
      expect(cell.answerText).toBeNull();
      expect(cell.provenance).toEqual([]);
      expect(answers.calls).toBe(1);
    }
  });
});

describe("W21 #19: staleReasonOf tells the stale cases apart", () => {
  it("null exactly when the pin is the current published version; a deleted file is never 'pin gone' or 'newer'", () => {
    const v1 = "00000000-0000-0000-0000-000000000001";
    const v2 = "00000000-0000-0000-0000-000000000002";
    const reason = (
      documentVersionId: string | null,
      currentDocumentVersionId: string | null,
      fileExists: boolean,
      pinReadable: boolean,
    ) => staleReasonOf({ documentVersionId, currentDocumentVersionId, fileExists, pinReadable });
    expect(reason(v1, v1, true, true)).toBeNull();
    expect(reason(v1, v2, true, true)).toBe("newer_version");
    expect(reason(v1, null, true, true)).toBe("no_readable_current");
    // The pin was cleared (ON DELETE SET NULL) or withdrawn; the file exists.
    expect(reason(null, v2, true, false)).toBe("pin_gone");
    expect(reason(v1, v2, true, false)).toBe("pin_gone");
    expect(reason(v1, null, true, false)).toBe("pin_gone");
    // The file itself was deleted: the pin is null too, but the reason is
    // the file, and no newer upload is ever implied.
    expect(reason(null, null, false, false)).toBe("file_deleted");
    expect(reason(v1, null, false, false)).toBe("file_deleted");
  });
});

describe("W21 verifier fixes · busy before pin, published-only current, pin re-checked after the answer", () => {
  it("retrying a cell that is being computed is CELL_BUSY even when its pin is unreadable", async () => {
    await insertUpload(sql, { fileId: "pin-busy", title: "Meşgul", blocks: paragraphs([V1_TEXT], 4) });
    const tableId = await create({ fileIds: ["pin-busy"], questions: [QUESTION] });
    await sql`update app_private.review_table_cells
              set state = 'running', lease_owner = 'test-worker', lease_expires_at = now() + interval '5 minutes'
              where table_id = ${tableId}::uuid and row_no = 1 and column_no = 1`;
    await sql`update app_private.review_table_rows set document_version_id = null
              where table_id = ${tableId}::uuid and row_no = 1`;
    const retry = await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.error.kind).toBe("CELL_BUSY");
  });

  it("'current' names only a PUBLISHED version: a failed newer upload never becomes current", async () => {
    const first = await insertUpload(sql, { fileId: "pin-pub", title: "Yayımlı", blocks: paragraphs([V1_TEXT], 4) });
    const tableId = await create({ fileIds: ["pin-pub"], questions: [QUESTION] });
    const failed = await insertNewVersion(sql, first.documentId, "pin-pub", "v2", paragraphs([V2_TEXT], 4));
    await sql`update legal.document_versions set status = 'failed' where id = ${failed}::uuid`;
    const table = (await get(app, `/v1/review-tables/${tableId}`)).body;
    expect(table.rows[0].documentVersionId).toBe(first.versionId);
    expect(table.rows[0].currentDocumentVersionId).not.toBe(failed);
    // The newer upload closed V1's system period, and it is not readable
    // itself: there is no readable current version to offer, so none is named.
    expect(table.rows[0].currentDocumentVersionId).toBeNull();
    expect(table.rows[0].stale).toBe(true);
    // W21 (#19): not "a newer version was uploaded" — there is no readable one.
    expect(table.rows[0].staleReason).toBe("no_readable_current");
    const noCurrentCsv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(noCurrentCsv).toContain('"daha yeni bir yükleme var ama okunabilir değil; hücreler sabitlenen sürümden"');
    expect(noCurrentCsv).not.toContain("daha yeni bir sürümü yüklendi");
    // The pin itself is still exactly readable: the cell computes from V1.
    await newWorker(new RecordingPort(pipeline)).drain();
    const cell = cellOf((await get(app, `/v1/review-tables/${tableId}`)).body, 1, 1);
    expect(cell.state).toBe("done");
  });

  it("W21 #19: a DELETED file is reported as deleted, never as a newer upload, and gets no 'new table' advice", async () => {
    const upload = await insertUpload(sql, { fileId: "pin-deleted", title: "Silinecek", blocks: paragraphs([V1_TEXT], 4) });
    const answers = new RecordingPort(pipeline);
    const finished = await create({ fileIds: ["pin-deleted"], questions: [QUESTION] });
    await newWorker(answers).drain();
    expect(cellOf((await get(app, `/v1/review-tables/${finished}`)).body, 1, 1).state).toBe("done");
    const pending = await create({ fileIds: ["pin-deleted"], questions: [QUESTION] });

    // DELETE /v1/files/{id} as intake/ingest.py::delete_file does it: the
    // document (versions cascade; the row pin is ON DELETE SET NULL), then
    // the upload's snapshots.
    await sql`delete from legal.documents where id = ${upload.documentId}::uuid`;
    await sql`delete from legal.source_snapshots where source = 'UPLOAD' and external_id = 'pin-deleted'`;

    const table = (await get(app, `/v1/review-tables/${finished}`)).body;
    expect(table.rows[0]).toEqual(
      expect.objectContaining({
        documentVersionId: null,
        currentDocumentVersionId: null,
        stale: true,
        staleReason: "file_deleted",
      }),
    );
    expect(table.stale).toBe(true);
    expect(table.sourceChanged).toEqual(["pin-deleted"]);
    // The export says "deleted" — never "a newer version was uploaded".
    const deletedCsv = await (await app.request(`/v1/review-tables/${finished}/export.csv`)).text();
    expect(deletedCsv).toContain('"belge silindi; hücreler sabitlenen sürümden, yeniden hesaplanamaz"');
    expect(deletedCsv).not.toContain("daha yeni bir sürümü yüklendi");
    expect(deletedCsv).not.toContain("yeni bir tablo");
    // The finished cell stays what it was; it cannot be recomputed.
    expect(cellOf(table, 1, 1).state).toBe("done");
    const retry = await post(app, `/v1/review-tables/${finished}/cells/1/1/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toEqual({ kind: "ROW_VERSION_STALE", message: PIN_FILE_DELETED_TR });
    expect(retry.body.error.message).not.toContain("yeni bir tablo");

    // A cell still waiting is refused with the same, deleted-file message.
    const before = answers.requests.length;
    await newWorker(answers).drain();
    const waiting = cellOf((await get(app, `/v1/review-tables/${pending}`)).body, 1, 1);
    expect(waiting.state).toBe("failed");
    expect(waiting.attempts).toBe(1);
    expect(waiting.error).toBe(PIN_FILE_DELETED_TR);
    expect(answers.requests.length).toBe(before);

    // Why the old "build a new table" advice was wrong: the file is refused.
    const again = await post(app, "/v1/review-tables", { fileIds: ["pin-deleted"], questions: [QUESTION] });
    expect(again.status).toBe(409);
    expect(again.body.error.kind).toBe("FILES_NOT_FOUND");
  });

  it("W21 #17: the REAL pipeline out of time is a failed, retryable cell — never 'not found in this document'", async () => {
    await insertUpload(sql, { fileId: "pin-budget", title: "Süre", blocks: paragraphs([V1_TEXT], 4) });
    // A 1 ms budget on the deterministic clock (+1 per reading): the answer
    // runs out of time before drafting, exactly as a slow machine would.
    const outOfTime = new AnswerPipeline({
      retrieval: createStoreRetrievalPort(sql),
      texts: createStoreTextPort(sql),
      versionFacts: createStoreVersionFactsPort(sql),
      ...deterministicOptions(),
      timeBudgetMs: 1,
    });
    const answers = new RecordingPort(outOfTime);
    const tableId = await create({ fileIds: ["pin-budget"], questions: [QUESTION] });
    await newWorker(answers).drain();
    const cell = cellOf((await get(app, `/v1/review-tables/${tableId}`)).body, 1, 1);
    // The run the worker got: PARTIAL, TIME_BUDGET_EXCEEDED, no claim.
    const probe = await outOfTime.answer(answers.requests[0]!);
    expect(probe.result.status).toBe("PARTIAL");
    expect(probe.result.reasons).toContain("TIME_BUDGET_EXCEEDED");
    expect(probe.result.claims).toEqual([]);

    expect(cell.state).toBe("failed");
    expect(cell.attempts).toBe(3);
    expect(cell.error).toBe(ANSWER_INCOMPLETE_TR);
    expect(cell.answerText).toBeNull();
    expect(cell.supportState).toBeNull();
    expect(answers.requests.length).toBe(3);
  });

  it("a pin withdrawn while the cell is being answered is refused, never stored", async () => {
    const upload = await insertUpload(sql, { fileId: "pin-mid", title: "Arada geri çekilen", blocks: paragraphs([V1_TEXT], 4) });
    const tableId = await create({ fileIds: ["pin-mid"], questions: [QUESTION] });
    class WithdrawDuringAnswer implements AnswerPort {
      calls = 0;
      async answer(request: AnswerRequest): ReturnType<AnswerPort["answer"]> {
        this.calls += 1;
        const result = await pipeline.answer(request);
        await sql`update legal.document_versions set status = 'withdrawn' where id = ${upload.versionId}::uuid`;
        return result;
      }
    }
    const answers = new WithdrawDuringAnswer();
    await newWorker(answers).drain();
    const cell = cellOf((await get(app, `/v1/review-tables/${tableId}`)).body, 1, 1);
    expect(answers.calls).toBe(1);
    expect(cell.state).toBe("failed");
    expect(cell.error).toBe(PIN_UNREADABLE_TR);
    expect(cell.answerText).toBeNull();
  });
});
