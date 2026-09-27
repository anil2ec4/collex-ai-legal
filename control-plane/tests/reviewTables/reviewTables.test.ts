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
import { EXTRACTOR_VERSION } from "../../src/exhaustive/observations.js";
import {
  CENSUS_EXTRACTOR_VERSION,
  LEGACY_CENSUS_TR,
  PgReviewTableStore,
  REVIEW_TABLE_GENERATOR_VERSION,
  legacyCensusTr,
  passageScopedAbstentionTr,
  presentStoredCell,
  supersededCensusTr,
  type ReviewCell,
} from "../../src/reviewTables/store.js";
import {
  ABSTAIN_IN_PASSAGES_TR,
  ANSWER_INCOMPLETE_TR,
  NO_PASSAGES_TR,
  ReviewTableWorker,
  SEARCH_LANE_DEGRADED_TR,
  SUPPORT_NOT_CHECKED_TR,
  absentFromDocumentTr,
  claimSupportNotChecked,
  incompleteAnswerReason,
  isIncompleteAnswer,
  notInRetrievedPassagesTr,
} from "../../src/reviewTables/worker.js";
import { CENSUS_PARTIAL_TR, createReviewTableRouter, csvField } from "../../src/reviewTables/routes.js";
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

/** One passage of the row's pinned version (the stub's evidence). */
function pinnedEvidence(fileId: string) {
  return {
    evidenceId: "ev-1",
    documentVersionId: versions.get(fileId) ?? "",
    chunkId: "chunk-1",
    startChar: 0,
    endChar: 9,
    quoteSha256: "a".repeat(64),
  };
}

class StubAnswers implements AnswerPort {
  readonly calls = new Map<string, number>();
  failing = true;
  /** W21 (#17): SÜRE / ARAMA / YARIM come back as runs the pipeline could not finish. */
  degraded = true;
  /** W21 R2-23: ŞERİT-TRIGRAM comes back from a search whose trigram lane failed. */
  laneDegraded = true;

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
    // W21 (#18): abstentions whose coverage gate names words the RETRIEVED
    // passages lack; the worker decides what may be said about the document.
    const abstain = (missing: string[]) =>
      ({
        result: {
          runId: `run-abstain-${fileId}`,
          status: "ABSTAIN",
          reasons: ["QUESTION_NOT_COVERED"],
          claims: [],
          evidence: [pinnedEvidence(fileId)],
          coverage: { missing },
        },
      }) as never;
    if (request.question === "DEPOZİTO") return abstain(["depozito"]);
    if (request.question === "KARMA") return abstain(["depozito", "ipotek"]);
    if (request.question === "ÇEKİNCE") return abstain([]);
    // Retrieval brought no passage at all and the gate named no word.
    if (request.question === "PASAJSIZ") {
      return {
        result: { runId: "run-pasajsiz", status: "ABSTAIN", claims: [], evidence: [], coverage: { missing: [] } },
      } as never;
    }
    // A "missing" word the coverage gate yields no lexeme for (a stopword):
    // it cannot be checked against the text, so it is never called absent.
    if (request.question === "DURAK") return abstain(["nedir"]);
    // W21 re-check: the local drafter failed and the rule-based fallback
    // answered; the lexical judge verified its claim. That is an answer.
    if (request.question === "YEDEK") {
      return {
        result: {
          runId: `run-yedek-${fileId}`,
          status: "PARTIAL",
          reasons: ["DRAFTER_DEGRADED"],
          warnings: ["LOCAL_DRAFTER_FALLBACK"],
          claims: [{ text: "Yedek cevap", verdict: "SUPPORTED", evidenceIds: ["ev-1"] }],
          evidence: [pinnedEvidence(fileId)],
        },
      } as never;
    }
    // W21 R2-21: the drafter wrote a claim, but every judge call failed, so
    // its passage support was never judged (verifier.ts ENTAILMENT_NOT_CHECKED;
    // finalize.ts still calls such a claim QUALIFIED). On the claim itself
    // (DENETİMSİZ) or only in the run's reasons (DENETİMSİZ-KOŞU).
    if (request.question === "DENETİMSİZ" || request.question === "DENETİMSİZ-KOŞU") {
      return {
        result: {
          runId: `run-denetimsiz-${fileId}`,
          status: "PARTIAL",
          reasons: ["NOT_FINALIZABLE", "ENTAILMENT_NOT_CHECKED:c1"],
          warnings: ["ENTAILMENT_PORT_FAILED:yerel doğrulama modeli zaman aşımına uğradı"],
          claims: [
            {
              claimId: "c1",
              text: "Denetlenmemiş model cümlesi",
              verdict: "QUALIFIED",
              evidenceIds: ["ev-1"],
              ...(request.question === "DENETİMSİZ" ? { reasons: ["ENTAILMENT_NOT_CHECKED:c1"] } : {}),
            },
          ],
          evidence: [pinnedEvidence(fileId)],
        },
      } as never;
    }
    // W21 R2-24: a slow local model drafted past the 60 s budget; the claim was
    // still verified (the budget is checked before and after drafting).
    if (request.question === "YAVAŞ") {
      return {
        result: {
          runId: `run-yavas-${fileId}`,
          status: "PARTIAL",
          reasons: ["NOT_FINALIZABLE", "TIME_BUDGET_EXCEEDED"],
          warnings: ["TIME_BUDGET_EXCEEDED:70000ms>60000ms"],
          claims: [{ claimId: "c1", text: "Yavaş modelin doğrulanmış cevabı", verdict: "SUPPORTED", evidenceIds: ["ev-1"], reasons: [] }],
          evidence: [pinnedEvidence(fileId)],
        },
      } as never;
    }
    // W21 R2-23: one lane searching the document failed, the others survived
    // and the run abstained; only a warning says the search was partial.
    const laneAbstain = (warning: string, withPassage: boolean) =>
      ({
        result: {
          runId: `run-serit-${fileId}`,
          status: "ABSTAIN",
          reasons: ["QUESTION_NOT_COVERED"],
          warnings: [warning],
          claims: [],
          evidence: withPassage ? [pinnedEvidence(fileId)] : [],
          coverage: { missing: withPassage ? ["depozito"] : [] },
        },
      }) as never;
    if (request.question === "ŞERİT-TRIGRAM" && this.laneDegraded) {
      return laneAbstain("RETRIEVAL_LANE_DEGRADED:primary:lane trigram failed: trigram fallback exceeded its 2500 ms budget", false);
    }
    if (request.question === "ŞERİT-SÖZCÜK") {
      return laneAbstain(
        "RETRIEVAL_LANE_DEGRADED:primary:soru:lane lexical failed: canceling statement due to statement timeout",
        true,
      );
    }
    if (request.question === "ŞERİT-YOĞUN") {
      return laneAbstain("RETRIEVAL_LANE_DEGRADED:contrary:i1:istisna:lane dense failed: hydration failed", false);
    }
    // W21 R2-23 (second verifier round): one CONTRARY query of the plan failed
    // as a whole (every lane of it, or the corpus dropped). The pipeline adds
    // only a warning, no reason (answerPipeline.ts retrieve).
    if (request.question === "SORGU-HATASI" && this.laneDegraded) {
      return laneAbstain(
        "RETRIEVAL_ERROR:contrary:i1:istisna:all retrieval lanes failed: lane exact failed: timeout; lane lexical failed: canceling statement due to statement timeout; lane trigram failed: budget",
        false,
      );
    }
    if (request.question === "SORGU-DEPO" && this.laneDegraded) {
      return laneAbstain("CORPUS_UNAVAILABLE:contrary:i1:istisna:Bu bilgisayardaki hukuk kütüphanesi açılamadı.", true);
    }
    // Not a lane that searches the document's passages: an honest abstention.
    if (request.question === "ŞERİT-İLİŞKİ") {
      return laneAbstain("RETRIEVAL_LANE_DEGRADED:primary:lane relation failed: citator lane failed: timeout", false);
    }
    if (request.question === "ŞERİT-TRIGRAM") {
      return laneAbstain("CONTRARY_LANES_CAPPED:1", false);
    }
    // W22: a witness record. The drafter's FIRST claim is the hearing header;
    // the testimony comes second and never says "işe giriş".
    if (request.question === "Davacının işe giriş tarihi nedir?") {
      const passage = (evidenceId: string, quote: string) => ({ ...pinnedEvidence(fileId), evidenceId, quote });
      return {
        result: {
          runId: `run-giris-${fileId}`,
          status: "COMPLETE",
          claims: [
            { text: "CELSE TARİHİ : 14.05.2024", verdict: "SUPPORTED", evidenceIds: ["ev-baslik"] },
            { text: "Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi.", verdict: "SUPPORTED", evidenceIds: ["ev-tanik"] },
          ],
          evidence: [
            passage("ev-baslik", "DURUŞMA TUTANAĞI\nESAS NO : 2024/128\nCELSE TARİHİ : 14.05.2024"),
            passage("ev-tanik", "Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi, o gün ben de oradaydım."),
          ],
        },
      } as never;
    }
    if (this.degraded) {
      // The answer pipeline's degraded shapes (answerPipeline.ts: budget
      // spent before drafting; every core lane failed; drafter failed).
      if (request.question === "SÜRE") {
        return {
          result: {
            runId: "run-sure",
            status: "PARTIAL",
            reasons: ["TIME_BUDGET_EXCEEDED"],
            claims: [],
            evidence: [pinnedEvidence(fileId)],
            coverage: { missing: ["depozito"] },
          },
        } as never;
      }
      if (request.question === "ARAMA") {
        return {
          result: {
            runId: "run-arama",
            status: "PARTIAL",
            reasons: ["RETRIEVAL_DEGRADED"],
            claims: [],
            evidence: [],
          },
        } as never;
      }
      if (request.question === "YARIM") {
        return {
          result: {
            runId: "run-yarim",
            status: "PARTIAL",
            reasons: ["DRAFTER_DEGRADED"],
            // W21 re-check: a drafter failure WITH claims is the rule-based
            // fallback's answer (see YEDEK); without claims it is incomplete.
            claims: [],
            evidence: [pinnedEvidence(fileId)],
          },
        } as never;
      }
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
            // W22: the verified passage carries the question's words, as an
            // answering passage does (worker.ts chooseAnsweringClaim).
            quote: `${request.question} — cevap pasajı`,
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
  // W21 (#18): "depozito" occurs in this document, in a paragraph the stub's
  // retrieved passage does not carry; "ipotek" occurs nowhere in it.
  const depo = await insertUpload(sql, {
    fileId: "grid-depo",
    title: "Belge grid-depo",
    blocks: paragraphs([planted[0]!, "Depozito olarak 90.000 TL alınmıştır."], 10),
  });
  versions.set("grid-depo", depo.versionId);
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

describe("W21 #17: a run the answer pipeline could not finish is never stored as 'not found'", () => {
  it("budget spent, retrieval failed or drafter failed: the cell FAILS (retryable), with no answer text", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a"], questions: ["SÜRE", "ARAMA", "YARIM"] });
    await newWorker(answers).drain();
    let table = await get(app, `/v1/review-tables/${tableId}`);
    for (const cell of table.body.cells) {
      expect(cell.state).toBe("failed");
      // Retryable: the normal backoff path spent the whole budget (a terminal
      // refusal would stop at attempt 1).
      expect(cell.attempts).toBe(3);
      expect(cell.error).toBe(ANSWER_INCOMPLETE_TR);
      expect(cell.answerText).toBeNull();
      expect(cell.supportState).toBeNull();
      expect(cell.provenance).toEqual([]);
    }
    for (const question of ["SÜRE", "ARAMA", "YARIM"]) expect(answers.calls.get(`grid-a|${question}`)).toBe(3);

    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).toContain(ANSWER_INCOMPLETE_TR);
    expect(csv).toContain(`"hesaplanamadı"`);
    expect(csv).not.toContain("karşılık bulunamadı");
    expect(csv).not.toContain("kaynak bulunamadı");
    expect(csv).not.toContain("Yarım cevap");

    // Once the pipeline can finish, the same cell is retried and answered.
    answers.degraded = false;
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(answers).drain();
    table = await get(app, `/v1/review-tables/${tableId}`);
    const first = table.body.cells.find((cell: any) => cell.columnNo === 1);
    expect(first.state).toBe("done");
    expect(first.supportState).toBe("verified");
  });

  it("a recompute that fails drops the previous answer: neither GET nor the CSV shows it as current", async () => {
    const answers = new StubAnswers();
    answers.degraded = false;
    const tableId = await create({ fileIds: ["grid-b"], questions: ["SÜRE"] });
    await newWorker(answers).drain();
    let cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("done");
    expect(cell.answerText).toBe("Cevap (grid-b)");

    answers.degraded = true;
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(answers).drain();
    cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("failed");
    expect(cell.error).toBe(ANSWER_INCOMPLETE_TR);
    expect(cell.answerText).toBeNull();
    expect(cell.supportState).toBeNull();
    expect(cell.answerStatus).toBeNull();
    expect(cell.provenance).toEqual([]);
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).toContain(ANSWER_INCOMPLETE_TR);
    expect(csv).not.toContain("Cevap (grid-b)");
    expect(csv).not.toContain("kaynağıyla doğrulandı");
  });

  it("isIncompleteAnswer: only the pipeline's own ABSTAIN is an abstention", () => {
    expect(isIncompleteAnswer({ status: "ABSTAIN", claims: [] })).toBe(false);
    expect(isIncompleteAnswer({ status: "ABSTAIN", claims: [], reasons: ["QUESTION_NOT_COVERED"] })).toBe(false);
    expect(isIncompleteAnswer({ status: "PARTIAL", claims: [] })).toBe(true);
    expect(isIncompleteAnswer({ status: "PARTIAL", claims: [{}], reasons: ["CORPUS_UNAVAILABLE"] })).toBe(true);
    // W21 R2-24: this line used to expect true — a claim drafted and verified before the budget ran out was thrown away.
    expect(isIncompleteAnswer({ status: "PARTIAL", claims: [{}], reasons: ["TIME_BUDGET_EXCEEDED:61000ms>60000ms"] })).toBe(false);
    expect(isIncompleteAnswer({ status: "PARTIAL", claims: [], reasons: ["TIME_BUDGET_EXCEEDED"] })).toBe(true);
    expect(isIncompleteAnswer({ status: "QUALIFIED", claims: [{}], reasons: ["PARTIAL_SOURCE_COVERAGE"] })).toBe(false);
    expect(isIncompleteAnswer({ status: "COMPLETE", claims: [{}] })).toBe(false);
  });
});

describe("W21 #18: an abstention names what was examined, and 'nowhere in the document' is checked", () => {
  it("a word only the retrieved passages lack is never called absent from the document", async () => {
    const tableId = await create({
      fileIds: ["grid-depo"],
      questions: ["DEPOZİTO", "KARMA", "ÇEKİNCE", "BOŞ", "PASAJSIZ", "DURAK"],
    });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);

    // "depozito" IS in the document (outside the retrieved passage).
    expect(cell(1).state).toBe("done");
    expect(cell(1).supportState).toBe("abstained");
    expect(cell(1).answerText).toBe(
      "Bu soru için getirilen pasajlarda karşılığı bulunamadı — bu pasajlarda şu sözcükler geçmiyor: depozito; belgenin tamamı taranmadı.",
    );
    expect(cell(1).answerText).not.toContain("geçtiği bir yer yok");

    // Mixed: "ipotek" was checked against the whole pinned text and is absent;
    // "depozito" is only missing from the retrieved passages.
    expect(cell(2).answerText).toBe(
      "Bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: ipotek. " +
        "Bu soru için getirilen pasajlarda karşılığı bulunamadı — bu pasajlarda şu sözcükler geçmiyor: depozito; belgenin tamamı taranmadı.",
    );
    expect(cell(2).answerText).toBe(`${absentFromDocumentTr(["ipotek"])}. ${notInRetrievedPassagesTr(["depozito"])}`);

    // No missing word: the abstention is about the passages, not the document.
    expect(cell(3).answerText).toBe(ABSTAIN_IN_PASSAGES_TR);
    expect(cell(3).answerText).not.toContain("Bu belgede");

    // Verified absent from the whole, fully read version: the absolute sentence.
    expect(cell(4).supportState).toBe("no_evidence");
    expect(cell(4).answerText).toBe("Bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: ipotek");

    // No passage and no named word: the sentence is about the search, not
    // the document.
    expect(cell(5).supportState).toBe("no_evidence");
    expect(cell(5).answerText).toBe(NO_PASSAGES_TR);
    expect(cell(5).answerText).not.toContain("Bu belgede");

    // A word the gate yields no lexeme for cannot be checked against the
    // text, so it is only ever "not in the retrieved passages".
    expect(cell(6).answerText).toBe(notInRetrievedPassagesTr(["nedir"]));
    expect(cell(6).answerText).not.toContain("geçtiği bir yer yok");

    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).toContain("bu pasajlarda şu sözcükler geçmiyor: depozito; belgenin tamamı taranmadı.");
    expect(csv).not.toContain("şu sözcüklerin geçtiği bir yer yok: depozito");
    // The "Destek" label names what was examined, never the whole document
    // (the old scope-less labels are gone).
    expect(csv).toContain('"getirilen pasajlarda karşılık bulunamadı"');
    expect(csv).toContain('"bu soru için pasaj getirilemedi"');
    expect(csv).not.toContain('"karşılık bulunamadı"');
    expect(csv).not.toContain('"kaynak bulunamadı"');
  });

  it("a document that was not read completely never gets the absolute sentence", async () => {
    // grid-scan has an unreadable page: "ipotek" is not in its text, but the
    // unread page could hold it.
    const tableId = await create({ fileIds: ["grid-scan"], questions: ["BOŞ"] });
    await newWorker(new StubAnswers()).drain();
    const cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("done");
    expect(cell.answerText).toBe(notInRetrievedPassagesTr(["ipotek"]));
    expect(cell.answerText).not.toContain("geçtiği bir yer yok");
  });
});

describe("W21 #17/#18: cells stored before grid-v3 are never repeated as stored", () => {
  /** Overwrite a finished cell (row 1) with what the W20 worker stored. */
  async function storeLegacy(
    tableId: string,
    columnNo: number,
    cell: { answerStatus: string; supportState: string; answerText: string },
  ): Promise<void> {
    await sql`
      update app_private.review_table_cells
      set state = 'done', answer_status = ${cell.answerStatus}, support_state = ${cell.supportState},
          answer_text = ${cell.answerText}, provenance = '[]'::jsonb, processing_coverage = null,
          answer_run_id = ${`run-w20-${columnNo}`}, generator_version = 'grid-v2', error = null
      where table_id = ${tableId}::uuid and row_no = 1 and column_no = ${columnNo}`;
  }

  it("the answer semantics changed, so the generator version did", () => {
    // W21 round two moved it again (grid-v3 → grid-v4: R2-21..R2-24); grid-v3 cells keep their CB3 sentences.
    // Third verifier round: grid-v4 → grid-v5, because the census extractor changed (extract-v6); grid-v4 answers keep theirs.
    // Closing re-check: grid-v5 → grid-v6 with extract-v7 (an exchange rate is no longer an amount).
    // W22: grid-v6 → grid-v7 (the answering claim is chosen; extract-v8 names money-shaped numbers).
    // W23: grid-v7 → grid-v8 with extract-v9 (event tags only; the values a census counts are unchanged,
    // so grid-v7 cells stay current — tests/exhaustive/w23EventAnchors.test.ts).
    // W23: grid-v8 → grid-v9 with extract-v10 (wage labels on amounts only; grid-v7/-v8 cells stay current).
    expect(REVIEW_TABLE_GENERATOR_VERSION).toBe("grid-v9");
    // A census is tied to the extractor it counts with: bumping one without the other fails here.
    expect(CENSUS_EXTRACTOR_VERSION).toBe(EXTRACTOR_VERSION);
  });

  it("#17: a W20 'not found' whose run did not end in ABSTAIN is the failed, retryable cell it was — in GET, progress and CSV", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a"], questions: ["Birinci soru?", "İkinci soru?", "Üçüncü soru?"] });
    await newWorker(answers).drain();
    await sql`update app_private.review_tables set generator_version = 'grid-v2' where table_id = ${tableId}::uuid`;
    // What the W20 worker stored for a run whose time budget ran out before
    // drafting (passages, no claim) ...
    await storeLegacy(tableId, 1, {
      answerStatus: "PARTIAL",
      supportState: "abstained",
      answerText: "Bu belgede bu soruya karşılık bulunamadı.",
    });
    // ... and for a run whose retrieval failed while the gate named a word.
    await storeLegacy(tableId, 2, {
      answerStatus: "PARTIAL",
      supportState: "no_evidence",
      answerText: "Bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: depozito",
    });
    // Column 3 stays a finished, verified answer.

    const table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);
    for (const column of [1, 2]) {
      expect(cell(column).state).toBe("failed");
      expect(cell(column).error).toBe(ANSWER_INCOMPLETE_TR);
      expect(cell(column).answerText).toBeNull();
      expect(cell(column).supportState).toBeNull();
      expect(cell(column).answerStatus).toBeNull();
      expect(cell(column).generatorVersion).toBe("grid-v2");
    }
    expect(cell(3).state).toBe("done");
    expect(cell(3).supportState).toBe("verified");
    expect(table.body.progress).toEqual(expect.objectContaining({ total: 3, done: 1, failed: 2 }));

    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv.split(ANSWER_INCOMPLETE_TR).length - 1).toBe(2);
    expect(csv).toContain(`"hesaplanamadı"`);
    expect(csv).not.toContain("karşılık bulunamadı");
    expect(csv).not.toContain("geçtiği bir yer yok");
    expect(csv).not.toContain(`"PARTIAL"`);
    expect(csv).not.toContain("pasaj");

    // Read-time only: the stored row is untouched ...
    const stored = await sql`
      select state, answer_text from app_private.review_table_cells
      where table_id = ${tableId}::uuid and row_no = 1 and column_no = 1`;
    expect(stored[0]!["state"]).toBe("done");
    expect(stored[0]!["answer_text"]).toBe("Bu belgede bu soruya karşılık bulunamadı.");
    // ... and the cell is retried like any failed cell, then recomputed under grid-v3.
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(answers).drain();
    const retried = (await get(app, `/v1/review-tables/${tableId}`)).body.cells.find(
      (entry: any) => entry.columnNo === 1,
    );
    expect(retried.state).toBe("done");
    expect(retried.supportState).toBe("verified");
    expect(retried.generatorVersion).toBe(REVIEW_TABLE_GENERATOR_VERSION);
  });

  it("#18: a W20 whole-document abstention is re-stated passage-scoped; only a grid-v3 cell keeps the absolute sentence", async () => {
    const tableId = await create({
      fileIds: ["grid-depo"],
      questions: ["DEPOZİTO", "ÇEKİNCE", "PASAJSIZ", "KARMA", "BOŞ", "DURAK"],
    });
    await newWorker(new StubAnswers()).drain();
    // The W20 worker checked only the retrieved passages and then wrote the
    // whole-document sentence. "depozito" IS in grid-depo, outside the passage.
    await storeLegacy(tableId, 1, {
      answerStatus: "ABSTAIN",
      supportState: "abstained",
      answerText: "Bu belgede karşılığı bulunamadı — şu sözcüklerin geçtiği bir yer yok: depozito",
    });
    await storeLegacy(tableId, 2, {
      answerStatus: "ABSTAIN",
      supportState: "abstained",
      answerText: "Bu belgede bu soruya karşılık bulunamadı.",
    });
    await storeLegacy(tableId, 3, {
      answerStatus: "ABSTAIN",
      supportState: "no_evidence",
      answerText: "Bu belgede bu soruya karşılık bulunamadı.",
    });
    // The joined sentence under grid-v2: nothing vouches that "ipotek" was checked.
    await storeLegacy(tableId, 4, {
      answerStatus: "ABSTAIN",
      supportState: "abstained",
      answerText: `${absentFromDocumentTr(["ipotek"])}. ${notInRetrievedPassagesTr(["depozito"])}`,
    });
    // Column 5 (BOŞ) is the grid-v3 cell whose "ipotek" WAS checked against the whole pinned text.
    // An already passage-scoped grid-v2 sentence is repeated as it is.
    await storeLegacy(tableId, 6, {
      answerStatus: "ABSTAIN",
      supportState: "abstained",
      answerText: notInRetrievedPassagesTr(["nedir"]),
    });

    const table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);
    expect(cell(1).state).toBe("done");
    expect(cell(1).supportState).toBe("abstained");
    expect(cell(1).answerText).toBe(notInRetrievedPassagesTr(["depozito"]));
    expect(cell(2).answerText).toBe(ABSTAIN_IN_PASSAGES_TR);
    expect(cell(3).answerText).toBe(NO_PASSAGES_TR);
    expect(cell(4).answerText).toBe(notInRetrievedPassagesTr(["ipotek", "depozito"]));
    expect(cell(5).generatorVersion).toBe(REVIEW_TABLE_GENERATOR_VERSION);
    expect(cell(5).answerText).toBe(absentFromDocumentTr(["ipotek"]));
    expect(cell(6).answerText).toBe(notInRetrievedPassagesTr(["nedir"]));
    for (const column of [1, 2, 3, 4, 6]) {
      expect(cell(column).answerText).not.toContain("Bu belgede");
      expect(cell(column).generatorVersion).toBe("grid-v2");
    }
    expect(table.body.progress).toEqual(expect.objectContaining({ total: 6, done: 6, failed: 0 }));

    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).toContain(notInRetrievedPassagesTr(["depozito"]));
    expect(csv).not.toContain("geçtiği bir yer yok: depozito");
    expect(csv).not.toContain("Bu belgede bu soruya karşılık bulunamadı.");
    // The absolute sentence appears once: the grid-v3 cell that checked the whole text.
    expect(csv.split("geçtiği bir yer yok").length - 1).toBe(1);
  });

  it("presentStoredCell leaves answers, current census cells and unfinished cells as stored", () => {
    const base = {
      rowNo: 1,
      columnNo: 1,
      attempts: 1,
      provenance: [],
      processingCoverage: null,
      answerRunId: "run-w20",
      generatorVersion: "grid-v2",
      error: null,
    };
    const answered: ReviewCell = { ...base, state: "done", answerStatus: "PARTIAL", answerText: "Cevap", supportState: "partially_verified" };
    expect(presentStoredCell(answered)).toBe(answered);
    const extract: ReviewCell = {
      ...base,
      state: "done",
      answerStatus: "PARTIAL",
      answerText: "Belgenin okunabilen kısmında tarih bulunmadı; belge tam okunamadı.",
      supportState: "exhaustive_incomplete",
    };
    // W21 R2-22: this used to expect the grid-v2 census back as stored; its extractor could not read
    // many month names, so it is re-stated (see the R2-22 tests below). A grid-v4 census is kept.
    expect(presentStoredCell(extract).answerText).toBe(legacyCensusTr(extract.answerText));
    const current: ReviewCell = { ...extract, generatorVersion: REVIEW_TABLE_GENERATOR_VERSION };
    expect(presentStoredCell(current)).toBe(current);
    const failed: ReviewCell = { ...base, state: "failed", answerStatus: null, answerText: null, supportState: null, error: "x" };
    expect(presentStoredCell(failed)).toBe(failed);
    // An unrecognised old abstention sentence is replaced, never repeated.
    expect(passageScopedAbstentionTr("Bu belgede hiçbir şey yok.", "abstained")).toBe(ABSTAIN_IN_PASSAGES_TR);
    expect(passageScopedAbstentionTr(null, "no_evidence")).toBe(NO_PASSAGES_TR);
  });

  it("export.csv keeps the W20 columns in place; 'Belge durumu' is appended last", async () => {
    const tableId = await create({ fileIds: ["grid-a"], questions: ["Kira bedeli nedir?"] });
    await newWorker(new StubAnswers()).drain();
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      [
        "Belge", "Belge kimliği", "Belge sürümü", "Soru", "Yöntem", "Durum", "Cevap",
        "Destek", "Kaynak konumları", "Alıntı parmak izleri", "Kapsam", "Araştırma no",
        "Belge durumu",
      ]
        .map(csvField)
        .join(";"),
    );
    expect(row).toBeDefined();
    expect(
      row!.startsWith(
        ["Belge grid-a", "grid-a", versions.get("grid-a"), "Kira bedeli nedir?", "hedefli cevap", "COMPLETE", "Cevap (grid-a)", "kaynağıyla doğrulandı"]
          .map(csvField)
          .join(";"),
      ),
    ).toBe(true);
    expect(row!.endsWith(`;"güncel sürüm"`)).toBe(true);
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

describe("W21 re-check: a drafter fallback that answered is an answer, not an incomplete cell", () => {
  it("DRAFTER_DEGRADED with the rule-based fallback's verified claim is stored as done, first time", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a"], questions: ["YEDEK"] });
    await newWorker(answers).drain();
    const cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("done");
    expect(cell.answerText).toContain("Yedek cevap");
    expect(answers.calls.get("grid-a|YEDEK")).toBe(1);
    expect(isIncompleteAnswer({ status: "PARTIAL", reasons: ["DRAFTER_DEGRADED"], claims: [] })).toBe(true);
    expect(isIncompleteAnswer({ status: "PARTIAL", reasons: ["DRAFTER_DEGRADED"], claims: [{}] })).toBe(false);
  });
});

describe("W21 R2-21: a claim whose passage support was never judged is not 'partially verified'", () => {
  it("the cell FAILS (retryable) with the reason — never done, never 'kısmen doğrulandı' in GET or the CSV", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a"], questions: ["DENETİMSİZ", "DENETİMSİZ-KOŞU"] });
    await newWorker(answers).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    for (const cell of table.body.cells) {
      expect(cell.state).toBe("failed");
      expect(cell.attempts).toBe(3);
      expect(cell.error).toBe(SUPPORT_NOT_CHECKED_TR);
      expect(cell.supportState).toBeNull();
      expect(cell.answerText).toBeNull();
    }
    expect(table.body.progress).toEqual(expect.objectContaining({ total: 2, done: 0, failed: 2 }));
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).toContain(SUPPORT_NOT_CHECKED_TR);
    expect(csv).not.toContain("kısmen doğrulandı");
    expect(csv).not.toContain("Denetlenmemiş model cümlesi");
  });

  it("claimSupportNotChecked reads the claim's own reasons, or the run's reasons naming THAT claim", () => {
    expect(claimSupportNotChecked({ claimId: "c1", reasons: ["ENTAILMENT_NOT_CHECKED:c1"] }, [])).toBe(true);
    expect(claimSupportNotChecked({ claimId: "c1" }, ["NOT_FINALIZABLE", "ENTAILMENT_NOT_CHECKED:c1"])).toBe(true);
    // Another claim's unchecked support says nothing about this one.
    expect(claimSupportNotChecked({ claimId: "c1", reasons: [] }, ["ENTAILMENT_NOT_CHECKED:c2"])).toBe(false);
    // A measured shortfall is a judgement that happened.
    expect(claimSupportNotChecked({ claimId: "c1", reasons: ["ENTAILMENT_BELOW_THRESHOLD:c1"] }, [])).toBe(false);
    expect(claimSupportNotChecked({}, ["ENTAILMENT_NOT_CHECKED:c1"])).toBe(false);
  });
});

describe("W21 R2-23: an abstention from a search with a failed passage lane is not a finished cell", () => {
  it("trigram, lexical or dense lane failed: the cell FAILS (retryable) and says why; a relation-lane failure does not", async () => {
    const answers = new StubAnswers();
    const tableId = await create({
      fileIds: ["grid-depo"],
      questions: ["ŞERİT-TRIGRAM", "ŞERİT-SÖZCÜK", "ŞERİT-YOĞUN", "ŞERİT-İLİŞKİ"],
    });
    await newWorker(answers).drain();
    let table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);
    for (const column of [1, 2, 3]) {
      expect(cell(column).state).toBe("failed");
      expect(cell(column).attempts).toBe(3);
      expect(cell(column).error).toBe(SEARCH_LANE_DEGRADED_TR);
      expect(cell(column).answerText).toBeNull();
      expect(cell(column).supportState).toBeNull();
    }
    expect(cell(4).state).toBe("done");
    expect(cell(4).supportState).toBe("no_evidence");
    expect(cell(4).answerText).toBe(NO_PASSAGES_TR);
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv.split(SEARCH_LANE_DEGRADED_TR).length - 1).toBe(3);

    // Once the lane answers again, the retried cell is the honest abstention it is.
    answers.laneDegraded = false;
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(answers).drain();
    table = await get(app, `/v1/review-tables/${tableId}`);
    expect(cell(1).state).toBe("done");
    expect(cell(1).supportState).toBe("no_evidence");
  });

  it("second verifier round: a contrary query that failed as a whole (RETRIEVAL_ERROR, CORPUS_UNAVAILABLE) FAILS the cell too", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-depo"], questions: ["SORGU-HATASI", "SORGU-DEPO"] });
    await newWorker(answers).drain();
    let table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);
    for (const column of [1, 2]) {
      expect(cell(column).state).toBe("failed");
      expect(cell(column).attempts).toBe(3);
      expect(cell(column).error).toBe(SEARCH_LANE_DEGRADED_TR);
      expect(cell(column).answerText).toBeNull();
      expect(cell(column).supportState).toBeNull();
    }
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv.split(SEARCH_LANE_DEGRADED_TR).length - 1).toBe(2);
    expect(csv).not.toContain(NO_PASSAGES_TR);

    // Once the search works again, a retry computes the cell afresh.
    answers.laneDegraded = false;
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(answers).drain();
    table = await get(app, `/v1/review-tables/${tableId}`);
    expect(cell(1).state).toBe("done");
    expect(cell(1).answerText).toBe("Cevap (grid-depo)");
  });

  it("incompleteAnswerReason: only a lane that searches the document's passages, and only for a run with no answer", () => {
    const lane = "RETRIEVAL_LANE_DEGRADED:primary:lane trigram failed: budget";
    expect(incompleteAnswerReason({ status: "ABSTAIN", claims: [], warnings: [lane] })).toBe(SEARCH_LANE_DEGRADED_TR);
    expect(
      incompleteAnswerReason({ status: "ABSTAIN", claims: [], warnings: ["RETRIEVAL_LANE_DEGRADED:contrary:i-1:istisna:lane exact failed: x"] }),
    ).toBe(SEARCH_LANE_DEGRADED_TR);
    expect(
      incompleteAnswerReason({ status: "ABSTAIN", claims: [], warnings: ["RETRIEVAL_LANE_DEGRADED:primary:lane citation failed: x"] }),
    ).toBeUndefined();
    expect(
      incompleteAnswerReason({ status: "ABSTAIN", claims: [], warnings: ["RETRIEVAL_LANE_DEGRADED:primary:normalizer drift: reindex"] }),
    ).toBeUndefined();
    // Second verifier round: a whole query of the plan failed (no reason is set for a contrary query).
    const queryFailed = "RETRIEVAL_ERROR:contrary:i1:istisna:all retrieval lanes failed: lane exact failed: x";
    const corpusDropped = "CORPUS_UNAVAILABLE:contrary:i1:istisna:Bu bilgisayardaki hukuk kütüphanesi açılamadı.";
    const portThrew = "RETRIEVAL_ERROR:contrary:i1:istisna:RETRIEVAL_PORT_THREW:boom";
    for (const warning of [queryFailed, corpusDropped, portThrew]) {
      expect(incompleteAnswerReason({ status: "ABSTAIN", claims: [], warnings: [warning] }), warning).toBe(SEARCH_LANE_DEGRADED_TR);
      expect(incompleteAnswerReason({ status: "COMPLETE", claims: [{}], warnings: [warning] }), warning).toBeUndefined();
    }
    // Other warnings are not a failed search.
    expect(incompleteAnswerReason({ status: "ABSTAIN", claims: [], warnings: ["CONTRARY_LANES_CAPPED:2"] })).toBeUndefined();
    // A claim verified from the lanes that survived is still an answer.
    expect(incompleteAnswerReason({ status: "COMPLETE", claims: [{}], warnings: [lane] })).toBeUndefined();
    // The #17 reasons keep their own message.
    expect(incompleteAnswerReason({ status: "PARTIAL", claims: [], reasons: ["RETRIEVAL_DEGRADED"], warnings: [lane] })).toBe(
      ANSWER_INCOMPLETE_TR,
    );
  });
});

describe("W21 R2-24: a claim drafted and verified before the time budget ran out is an answer", () => {
  it("PARTIAL + TIME_BUDGET_EXCEEDED with a verified claim is stored as done, first time, with its text", async () => {
    const answers = new StubAnswers();
    const tableId = await create({ fileIds: ["grid-a"], questions: ["YAVAŞ"] });
    await newWorker(answers).drain();
    const cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("done");
    expect(cell.attempts).toBe(1);
    expect(cell.answerStatus).toBe("PARTIAL");
    expect(cell.answerText).toBe("Yavaş modelin doğrulanmış cevabı");
    expect(cell.supportState).toBe("verified");
    expect(answers.calls.get("grid-a|YAVAŞ")).toBe(1);
  });
});

describe("W21 R2-22: a census counts the recognised formats and never claims a whole-document absence", () => {
  beforeAll(async () => {
    const contract = await insertUpload(sql, {
      fileId: "grid-eylul",
      title: "Belge grid-eylul",
      blocks: paragraphs(
        [
          "Kira sözleşmesi 15 Eylül 2023 tarihinde imzalanmıştır.",
          "Kira bedeli aylık 45.000,00.-TL olarak belirlenmiştir; teminat 1.500 EUR olarak yatırılmıştır.",
          "Tahliye tarihi 31 Ağustos 2025'tir.",
        ],
        10,
      ),
    });
    versions.set("grid-eylul", contract.versionId);
    const none = await insertUpload(sql, {
      fileId: "grid-degersiz",
      title: "Belge grid-degersiz",
      blocks: paragraphs(["Taraflar arasında bir kira ilişkisi bulunmaktadır."], 10),
    });
    versions.set("grid-degersiz", none.versionId);
    const unread = await insertUpload(sql, {
      fileId: "grid-okunamayan",
      title: "Belge grid-okunamayan",
      blocks: paragraphs(["Ödeme Eylül 2023 ayında yapılmıştır.", "Bedel 45 bin 500 TL olarak ödenmiştir."], 10),
    });
    versions.set("grid-okunamayan", unread.versionId);
    const payments = await insertUpload(sql, {
      fileId: "grid-odeme",
      title: "Belge grid-odeme",
      blocks: paragraphs(["15.09.2023 45.000,00 TL kira ödemesi", "Taksit 3 15.000 TL", "Taksit 4 500 TL"], 10),
    });
    versions.set("grid-odeme", payments.versionId);
    // Third verifier round: pypdf keeps a visual line wrap as "\n" inside a paragraph.
    const wrapped = await insertUpload(sql, {
      fileId: "grid-sarma",
      title: "Belge grid-sarma",
      blocks: paragraphs(
        [
          "Kiracı, aylık kira bedeli olarak 7500\nTL ödemeyi kabul ve taahhüt eder.",
          "Kredi USD 1,5 yıl vadelidir.",
          "Sözleşme süresi Eylül\n2023 ayında başlar.",
        ],
        10,
      ),
    });
    versions.set("grid-sarma", wrapped.versionId);
  });

  const DATES = { text: "Belgedeki bütün tarihler", mode: "extract_dates" };
  const AMOUNTS = { text: "Belgedeki bütün tutarlar", mode: "extract_amounts" };

  it("the finding's contract: '15 Eylül 2023', '31 Ağustos 2025', '45.000,00.-TL' and '1.500 EUR' are all listed", async () => {
    const tableId = await create({ fileIds: ["grid-eylul"], questions: [DATES, AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const [dates, amounts] = [1, 2].map((column) => table.body.cells.find((entry: any) => entry.columnNo === column));
    expect(dates.answerStatus).toBe("COMPLETE");
    expect(dates.supportState).toBe("exhaustive_complete");
    expect(dates.answerText).toContain("2 ayrı tarih");
    expect(dates.answerText).toContain("15.09.2023");
    expect(dates.answerText).toContain("31.08.2025");
    expect(dates.answerText).toContain("Yalnız tanınan biçimlerde yazılmış tarihler listelendi");
    expect(amounts.answerText).toContain("45.000 TL");
    expect(amounts.answerText).toContain("1.500 EUR");
    expect(amounts.answerText).not.toContain("1.500 TL");
  });

  it("nothing found: 'no date in a recognised format', with the formats — never 'Belgenin tamamında tarih bulunmadı'", async () => {
    const tableId = await create({ fileIds: ["grid-degersiz"], questions: [DATES, AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const [dates, amounts] = [1, 2].map((column) => table.body.cells.find((entry: any) => entry.columnNo === column));
    expect(dates.answerStatus).toBe("COMPLETE");
    expect(dates.supportState).toBe("exhaustive_complete");
    expect(dates.answerText).toMatch(/^Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir tarih bulunmadı \(tanınan biçimler: /u);
    expect(dates.answerText).toContain("15 Eylül 2023");
    expect(amounts.answerText).toMatch(/^Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir tutar bulunmadı /u);
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).not.toContain("Belgenin tamamında");
    expect(csv).toContain('"belgenin tamamı okundu"');
  });

  it("value-like text the extractor could not read makes the census PARTIAL and is named, in GET and the CSV", async () => {
    const tableId = await create({ fileIds: ["grid-okunamayan"], questions: [DATES, AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const [dates, amounts] = [1, 2].map((column) => table.body.cells.find((entry: any) => entry.columnNo === column));
    for (const cell of [dates, amounts]) {
      expect(cell.state).toBe("done");
      expect(cell.answerStatus).toBe("PARTIAL");
      // Every page was read: the reading coverage stays complete.
      expect(cell.supportState).toBe("exhaustive_complete");
      expect(cell.processingCoverage.complete).toBe(true);
      expect(cell.answerText).toContain("sayım eksik olabilir");
    }
    expect(dates.answerText).toContain("bir tarih bulunmadı");
    expect(dates.answerText).toContain("“Ödeme Eylül 2023 ayında”");
    expect(amounts.answerText).toContain("45 bin 500 TL");
    expect(amounts.answerText).not.toContain("500 TL (");
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv.split(`"${CENSUS_PARTIAL_TR}"`).length - 1).toBe(2);
    expect(csv).not.toContain('"belgenin tamamı okundu"');
  });

  it("verifier round: a payment table's amounts are listed; 'Taksit 4 500 TL' is named, never guessed as 4.500 or 500 TL", async () => {
    const tableId = await create({ fileIds: ["grid-odeme"], questions: [AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const amounts = table.body.cells.find((entry: any) => entry.columnNo === 1);
    expect(amounts.state).toBe("done");
    expect(amounts.answerText).toContain("2 ayrı tutar");
    expect(amounts.answerText).toContain("45.000 TL");
    expect(amounts.answerText).toContain("15.000 TL");
    expect(amounts.answerText).not.toContain("4.500 TL");
    expect(amounts.answerText).not.toMatch(/(^|[^.\d])500 TL \(/u);
    expect(amounts.answerText).toContain("“Taksit 4 500 TL”");
    expect(amounts.answerStatus).toBe("PARTIAL");
  });

  it("second verifier round: a count, a year or a flattened row next to a currency is named, never listed as an amount", async () => {
    const odd = await insertUpload(sql, {
      fileId: "grid-sayi",
      title: "Belge grid-sayi",
      blocks: paragraphs(
        [
          "Ödemeler TL 12 eşit taksitte yapılır.",
          "Kur farkı USD/TL 2023 yılı ortalamasına göre hesaplanır.",
          "Kiracı teminat bedeli 45 000 540 000 TL olarak yatırmıştır.",
          "Kira bedeli TL 45.000 olarak belirlenmiştir.",
        ],
        10,
      ),
    });
    versions.set("grid-sayi", odd.versionId);
    const tableId = await create({ fileIds: ["grid-sayi"], questions: [AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const amounts = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(amounts.state).toBe("done");
    expect(amounts.answerText).toContain("1 ayrı tutar: 45.000 TL");
    for (const fabricated of ["12 TL", "2.023 TL", "45.000.540.000 TL", "540.000 TL ("]) {
      expect(amounts.answerText).not.toContain(fabricated);
    }
    expect(amounts.answerText).toContain("“Ödemeler TL 12 eşit”");
    expect(amounts.answerText).toContain("“Kur farkı USD/TL 2023”");
    expect(amounts.answerText).toContain("“bedeli 45 000 540 000 TL olarak”");
    expect(amounts.answerStatus).toBe("PARTIAL");
    expect(amounts.supportState).toBe("exhaustive_complete");
  });

  it("a census stored before grid-v4 is re-stated PARTIAL, its absolute sentence dropped; a retry recounts it", async () => {
    const tableId = await create({ fileIds: ["grid-eylul"], questions: [DATES, DATES, AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const legacy = async (columnNo: number, answerStatus: string, answerText: string): Promise<void> => {
      await sql`
        update app_private.review_table_cells
        set answer_status = ${answerStatus}, answer_text = ${answerText}, generator_version = 'grid-v3'
        where table_id = ${tableId}::uuid and row_no = 1 and column_no = ${columnNo}`;
    };
    // What the grid-v3 worker stored for this very contract (it could not read "Eylül"/"Ağustos").
    await legacy(1, "COMPLETE", "Belgenin tamamında tarih bulunmadı.");
    await legacy(2, "PARTIAL", "Belgenin okunabilen kısmında tarih bulunmadı; belge tam okunamadı.");
    await legacy(3, "COMPLETE", "1 ayrı tutar: 45 TL (s. 1).");

    let table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);
    for (const column of [1, 2, 3]) {
      expect(cell(column).state).toBe("done");
      expect(cell(column).answerStatus).toBe("PARTIAL");
      expect(cell(column).answerText.startsWith(LEGACY_CENSUS_TR)).toBe(true);
      expect(cell(column).answerText).not.toContain("Belgenin tamamında");
    }
    expect(cell(1).answerText).toContain("Eylül");
    expect(cell(1).answerText).toContain("belgede tarih olmadığı anlamına gelmez");
    expect(cell(3).answerText).toContain("Eski sayımın listesi: 1 ayrı tutar: 45 TL (s. 1).");
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).not.toContain("Belgenin tamamında tarih bulunmadı");
    expect(csv.split(`"${CENSUS_PARTIAL_TR}"`).length - 1).toBe(3);

    // Read-time only; a retry recounts the cell with the current extractor.
    const stored = await sql`
      select answer_text from app_private.review_table_cells
      where table_id = ${tableId}::uuid and row_no = 1 and column_no = 1`;
    expect(stored[0]!["answer_text"]).toBe("Belgenin tamamında tarih bulunmadı.");
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(new StubAnswers()).drain();
    table = await get(app, `/v1/review-tables/${tableId}`);
    expect(cell(1).answerStatus).toBe("COMPLETE");
    expect(cell(1).generatorVersion).toBe(REVIEW_TABLE_GENERATOR_VERSION);
    expect(cell(1).answerText).toContain("15.09.2023");
  });

  it("third verifier round: a value split by a line wrap is named, so the census is PARTIAL — never an empty COMPLETE", async () => {
    const tableId = await create({ fileIds: ["grid-sarma"], questions: [DATES, AMOUNTS] });
    await newWorker(new StubAnswers()).drain();
    const table = await get(app, `/v1/review-tables/${tableId}`);
    const [dates, amounts] = [1, 2].map((column) => table.body.cells.find((entry: any) => entry.columnNo === column));
    for (const cell of [dates, amounts]) {
      expect(cell.state).toBe("done");
      expect(cell.answerStatus).toBe("PARTIAL");
      expect(cell.supportState).toBe("exhaustive_complete");
      expect(cell.answerText).toContain("sayım eksik olabilir");
    }
    // extract-v5 said COMPLETE here: "Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir tutar bulunmadı" and nothing more.
    expect(amounts.answerText).toMatch(/^Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir tutar bulunmadı /u);
    expect(amounts.answerText).toContain("“kira bedeli olarak 7500 TL ödemeyi”");
    // "USD 1,5 yıl" is a term, not 1,5 USD: named, not listed.
    expect(amounts.answerText).toContain("“Kredi USD 1,5”");
    expect(amounts.answerText).not.toContain("1,5 USD");
    expect(dates.answerText).toContain("“Sözleşme süresi Eylül 2023 ayında başlar”");
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv.split(`"${CENSUS_PARTIAL_TR}"`).length - 1).toBe(2);
    expect(csv).not.toContain('"belgenin tamamı okundu"');
  });

  it("third verifier round: a census counted by grid-v4 is re-stated PARTIAL in GET and the CSV; a retry recounts it", async () => {
    const tableId = await create({ fileIds: ["grid-eylul"], questions: [AMOUNTS, DATES] });
    await newWorker(new StubAnswers()).drain();
    const storeGridV4 = async (columnNo: number, answerText: string): Promise<void> => {
      await sql`
        update app_private.review_table_cells
        set answer_status = 'COMPLETE', answer_text = ${answerText}, generator_version = 'grid-v4'
        where table_id = ${tableId}::uuid and row_no = 1 and column_no = ${columnNo}`;
    };
    // What a grid-v4 worker on extract-v4 could store: "TL 12 eşit taksit" listed as 12 TL.
    const oldList = "2 ayrı tutar: 12 TL (s. 1); 45.000 TL (s. 1). Yalnız tanınan biçimlerde yazılmış tutarlar listelendi (…).";
    await storeGridV4(1, oldList);
    await storeGridV4(2, "Belgenin tamamı okundu; tanınan biçimlerde yazılmış bir tarih bulunmadı (tanınan biçimler: …). Başka biçimde yazılmış tarihler bu sayıma girmez.");

    let table = await get(app, `/v1/review-tables/${tableId}`);
    const cell = (column: number) => table.body.cells.find((entry: any) => entry.columnNo === column);
    for (const column of [1, 2]) {
      expect(cell(column).state).toBe("done");
      expect(cell(column).answerStatus).toBe("PARTIAL");
      expect(cell(column).generatorVersion).toBe("grid-v4");
      expect(cell(column).answerText.startsWith(LEGACY_CENSUS_TR)).toBe(true);
    }
    expect(cell(1).answerText).toContain("listedeki bir tutar yanlış da olabilir");
    expect(cell(1).answerText).toContain(`Eski sayımın listesi: ${oldList}`);
    expect(cell(2).answerText).not.toContain("Belgenin tamamı okundu");
    expect(cell(2).answerText).toContain("listedeki bir tarih yanlış da olabilir");
    expect(cell(2).answerText).toContain("belgede tarih olmadığı anlamına gelmez");
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv.split(`"${CENSUS_PARTIAL_TR}"`).length - 1).toBe(2);

    // A retry recounts the cell under the current version and rules.
    expect((await post(app, `/v1/review-tables/${tableId}/cells/1/1/retry`)).status).toBe(202);
    await newWorker(new StubAnswers()).drain();
    table = await get(app, `/v1/review-tables/${tableId}`);
    expect(cell(1).generatorVersion).toBe(REVIEW_TABLE_GENERATOR_VERSION);
    expect(cell(1).answerStatus).toBe("COMPLETE");
    expect(cell(1).answerText).toContain("45.000 TL");
    expect(cell(1).answerText).not.toContain("12 TL");
  });

  it("supersededCensusTr: grid-v4 date and amount censuses are re-stated; a grid-v4 ratio census, grid-v4 answers and current cells are kept", () => {
    const base: ReviewCell = {
      rowNo: 1,
      columnNo: 1,
      state: "done",
      attempts: 1,
      answerStatus: "COMPLETE",
      answerText: null,
      supportState: "exhaustive_complete",
      provenance: [],
      processingCoverage: { complete: true },
      answerRunId: null,
      generatorVersion: "grid-v4",
      error: null,
    };
    const readable: ReviewCell = {
      ...base,
      answerStatus: "PARTIAL",
      supportState: "exhaustive_incomplete",
      answerText: "Belge tam okunamadı; okunabilen kısımda tanınan biçimlerde yazılmış bir tutar bulunmadı (tanınan biçimler: …).",
    };
    const shown = presentStoredCell(readable);
    expect(shown.answerStatus).toBe("PARTIAL");
    expect(shown.answerText!.startsWith(LEGACY_CENSUS_TR)).toBe(true);
    expect(shown.answerText).toContain("Belge tam okunamamıştı");
    expect(shown.answerText).not.toContain("Belge tam okunamadı; okunabilen");
    // Ratios were read the same way by every extractor behind grid-v4.
    const ratio: ReviewCell = { ...base, answerText: "1 ayrı oran: %80 (s. 1). Yalnız tanınan biçimlerde yazılmış oranlar listelendi (…)." };
    expect(presentStoredCell(ratio)).toBe(ratio);
    expect(supersededCensusTr(ratio.answerText)).toBeUndefined();
    // An unrecognised text is never repeated.
    expect(presentStoredCell({ ...base, answerText: "Belgede hiç tutar yok." }).answerText).toBe(LEGACY_CENSUS_TR);
    // A census of the current version, and a grid-v4 answer cell, are shown as stored.
    const current: ReviewCell = { ...base, generatorVersion: REVIEW_TABLE_GENERATOR_VERSION, answerText: "1 ayrı tutar: 45.000 TL (s. 1)." };
    expect(presentStoredCell(current)).toBe(current);
    const absent: ReviewCell = {
      ...base,
      answerStatus: "ABSTAIN",
      supportState: "abstained",
      answerText: absentFromDocumentTr(["ipotek"]),
    };
    expect(presentStoredCell(absent)).toBe(absent);
  });

  it("legacyCensusTr never repeats an unrecognised old sentence", () => {
    expect(legacyCensusTr("Belgede hiç tarih yok.")).toBe(LEGACY_CENSUS_TR);
    expect(legacyCensusTr(null)).toBe(LEGACY_CENSUS_TR);
    expect(legacyCensusTr("Belgenin tamamında oran bulunmadı.")).not.toContain("Belgenin tamamında");
  });
});

/**
 * W22 (a realistic iş davası file): the grid answered "Davacının işe giriş
 * tarihi nedir?" for a witness record with the record's header, marked
 * "kaynağıyla doğrulandı"; its amount census of a bilirkişi report said
 * "tam" while the calculation table (currency only in the header) was never
 * read; and a bad body was answered in zod's English. Each fails on grid-v6.
 */
describe("W22 · the grid on a real file", () => {
  beforeAll(async () => {
    const report = await insertUpload(sql, {
      fileId: "grid-bilirkisi",
      title: "Bilirkişi raporu",
      blocks: [
        "IV. HESAPLAMA :\nKalem Dönem Brüt (TL) Kesinti (TL) Net (TL)\n" +
          "Kıdem tazminatı 01.03.2018 - 15.01.2024 204.962,34 1.549,67 203.412,67\n" +
          "İhbar tazminatı 8 hafta 115.428,00 16.143,50 99.284,50",
        "VI. SONUÇ : Davacının net kıdem tazminatı alacağı 203.412,67 TL, net\n" +
          "ihbar tazminatı alacağı 99.284,50 TL olarak hesaplanmıştır.",
      ],
    });
    versions.set("grid-bilirkisi", report.versionId);
  });

  it("the testimony answers, not the hearing header, and it is never 'kaynağıyla doğrulandı'", async () => {
    const tableId = await create({ fileIds: ["grid-a"], questions: ["Davacının işe giriş tarihi nedir?"] });
    await newWorker(new StubAnswers()).drain();
    const cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("done");
    expect(cell.answerText).toBe("Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi.");
    expect(cell.supportState).toBe("verified");
    expect(cell.answerStatus).toBe("QUESTION_NOT_CHECKED");
    expect(cell.generatorVersion).toBe(REVIEW_TABLE_GENERATOR_VERSION);
    const csv = await (await app.request(`/v1/review-tables/${tableId}/export.csv`)).text();
    expect(csv).toContain('"alıntı doğrulandı; soruyu karşıladığı denetlenmedi"');
    expect(csv).not.toContain("kaynağıyla doğrulandı");
    expect(csv).not.toContain("CELSE TARİHİ");
  });

  it("a table whose currency is only in its header makes the amount census PARTIAL, by example; kuruş keep two digits", async () => {
    const tableId = await create({
      fileIds: ["grid-bilirkisi"],
      questions: [{ text: "Belgedeki bütün tutarlar", mode: "extract_amounts" }],
    });
    await newWorker(new StubAnswers()).drain();
    const cell = (await get(app, `/v1/review-tables/${tableId}`)).body.cells[0];
    expect(cell.state).toBe("done");
    expect(cell.supportState).toBe("exhaustive_complete");
    expect(cell.answerStatus).toBe("PARTIAL");
    expect(cell.answerText).toContain("204.962,34");
    expect(cell.answerText).toContain("99.284,50 TL");
    expect(cell.answerText).not.toContain("99.284,5 TL");
    expect(cell.answerText).toContain("sayım eksik olabilir");
  });

  it("a bad table request is answered in Turkish, the field named by its path", async () => {
    const response = await post(app, "/v1/review-tables", {
      fileIds: ["grid-a"],
      questions: [{ text: "Tutarlar", mode: "extract_everything" }],
    });
    expect(response.status).toBe(400);
    for (const issue of response.body.error.issues as Array<{ path: string; message: string }>) {
      expect(issue.path).not.toBe("");
      expect(issue.message).not.toMatch(/Invalid|Expected|Required/u);
    }
    // A question is a string or {text, mode}: zod reports the union at the question itself.
    expect(response.body.error.issues).toEqual([{ path: "questions.0", message: "Geçersiz değer." }]);
    const empty = await post(app, "/v1/review-tables", { fileIds: [], questions: ["Soru?"] });
    expect(empty.body.error.issues).toEqual([{ path: "fileIds", message: "Liste en az bir öğe içermeli." }]);
  });
});
