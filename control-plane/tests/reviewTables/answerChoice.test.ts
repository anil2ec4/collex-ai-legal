/**
 * W22: a review-grid cell must not show a verified quote that does not
 * answer its question as "kaynağıyla doğrulandı".
 *
 * On a realistic iş davası file the column "Davacının işe giriş tarihi
 * nedir?" was answered, for a witness record, with the record's header
 * ("CELSE TARİHİ : 14.05.2024") — the FIRST claim the drafter wrote — and
 * marked COMPLETE / "kaynağıyla doğrulandı". The quote was verified; that it
 * answers the question was not. These cases fail on grid-v6.
 *
 * Pure: no database. The worker's use of it is in reviewTables.test.ts.
 */

import { describe, expect, it } from "vitest";
import { supportLabelTr } from "../../src/reviewTables/routes.js";
import {
  presentStoredCell,
  QUESTION_NOT_CHECKED_STATUS,
  QUOTE_ONLY_SUPPORT_TR,
  REVIEW_TABLE_GENERATOR_VERSION,
  supersededCensusTr,
  type ReviewCell,
} from "../../src/reviewTables/store.js";
import { chooseAnsweringClaim } from "../../src/reviewTables/worker.js";

const QUESTION = "Davacının işe giriş tarihi nedir?";
const HEADER = "T.C.\nİSTANBUL ANADOLU 7. İŞ MAHKEMESİ\nDURUŞMA TUTANAĞI\nESAS NO : 2024/128\nCELSE TARİHİ : 14.05.2024";
const ALI =
  'Tanık Ali KAYA beyanında: "Ben davalı şirkette 2016 yılından 2023 yılı sonuna kadar forklift operatörü olarak' +
  " çalıştım. Davacı Mehmet, 01.03.2018 tarihinde depoya sorumlu olarak geldi, o gün ben de oradaydım.";
const AYSE =
  'Tanık Ayşe DEMİR beyanında: "Davacı Mehmet YILMAZ 01.03.2019 tarihinde işe girdi, işe giriş evrakını ben hazırladım.';

const evidence = new Map([
  ["ev-header", { quote: HEADER }],
  ["ev-ali", { quote: ALI }],
  ["ev-ayse", { quote: AYSE }],
]);

describe("W22 · the grid answers with the claim that carries the question", () => {
  it("the testimony outranks the hearing header, and its missing core words are named", () => {
    const claims = [
      { text: `04-tanik-ali-kaya.txt: "${HEADER}"`, evidenceIds: ["ev-header"] },
      { text: `04-tanik-ali-kaya.txt: "${ALI}"`, evidenceIds: ["ev-ali"] },
    ];
    const choice = chooseAnsweringClaim(QUESTION, claims, evidence);
    expect(choice!.claim).toBe(claims[1]);
    // "Davacının" is a party role, not a core word; the witness never says "işe giriş".
    expect(choice!.missingCore).toEqual(["işe", "giriş"]);
  });

  it("a passage that carries every core word leaves nothing unchecked", () => {
    const claims = [
      { text: "başlık", evidenceIds: ["ev-header"] },
      { text: "tanık", evidenceIds: ["ev-ayse"] },
    ];
    const choice = chooseAnsweringClaim(QUESTION, claims, evidence);
    expect(choice!.claim).toBe(claims[1]);
    expect(choice!.missingCore).toEqual([]);
  });

  it("no claim, no choice", () => {
    expect(chooseAnsweringClaim(QUESTION, [], evidence)).toBeUndefined();
  });
});

describe("W22 · such a cell is never labelled 'kaynağıyla doğrulandı'", () => {
  const cell: ReviewCell = {
    rowNo: 1,
    columnNo: 1,
    state: "done",
    attempts: 1,
    answerStatus: QUESTION_NOT_CHECKED_STATUS,
    answerText: ALI,
    supportState: "verified",
    provenance: [],
    processingCoverage: null,
    answerRunId: "run-1",
    generatorVersion: REVIEW_TABLE_GENERATOR_VERSION,
    error: null,
  };

  it("its label says the quote is verified and the answer is not", () => {
    expect(supportLabelTr(cell)).toBe(QUOTE_ONLY_SUPPORT_TR);
    expect(supportLabelTr(cell)).toBe("alıntı doğrulandı; soruyu karşıladığı denetlenmedi");
    expect(supportLabelTr({ ...cell, answerStatus: "COMPLETE" })).toBe("kaynağıyla doğrulandı");
  });

  it("a verified cell stored before grid-v7 was never so checked, and says so", () => {
    const old: ReviewCell = { ...cell, answerStatus: "COMPLETE", answerText: HEADER, generatorVersion: "grid-v6" };
    const shown = presentStoredCell(old);
    expect(shown.answerStatus).toBe(QUESTION_NOT_CHECKED_STATUS);
    expect(supportLabelTr(shown)).toBe(QUOTE_ONLY_SUPPORT_TR);
    // A current verified cell whose passage carried the question is kept.
    const current: ReviewCell = { ...cell, answerStatus: "COMPLETE" };
    expect(presentStoredCell(current)).toBe(current);
  });
});

describe("W23 · grid-v8 and grid-v9 moved only because extract-v9 / -v10 re-tag events", () => {
  it("grid-v7 and grid-v8 censuses and verified answers are still current, shown as stored", () => {
    // extract-v9 changed which event a date is tagged with, extract-v10 which wage an amount
    // is tagged with — not which values are read.
    const census: ReviewCell = {
      rowNo: 1,
      columnNo: 2,
      state: "done",
      attempts: 1,
      answerStatus: "COMPLETE",
      answerText: "2 ayrı tarih: 01.03.2018 (s. 1); 15.01.2024 (s. 1).",
      supportState: "exhaustive_complete",
      provenance: [],
      processingCoverage: { complete: true },
      answerRunId: null,
      generatorVersion: "grid-v7",
      error: null,
    };
    expect(REVIEW_TABLE_GENERATOR_VERSION).toBe("grid-v9");
    for (const generatorVersion of ["grid-v7", "grid-v8"]) {
      const stored: ReviewCell = { ...census, generatorVersion };
      expect(presentStoredCell(stored), generatorVersion).toBe(stored);
      const answered: ReviewCell = { ...census, columnNo: 1, answerText: ALI, supportState: "verified", generatorVersion };
      expect(presentStoredCell(answered), generatorVersion).toBe(answered);
    }
    const verified: ReviewCell = { ...census, columnNo: 1, answerText: ALI, supportState: "verified", generatorVersion: "grid-v7" };
    // A cell of the version before still is not.
    expect(presentStoredCell({ ...verified, generatorVersion: "grid-v6" }).answerStatus).toBe(QUESTION_NOT_CHECKED_STATUS);
  });
});

describe("W22 · a grid-v6 amount census could miss a header-currency table", () => {
  it("its amount census is re-stated; its date and ratio censuses are kept", () => {
    expect(supersededCensusTr("3 ayrı tutar: 45.000 TL (s. 1); 32.000 TL (s. 2).", "grid-v6")).toContain("204.962,34");
    expect(supersededCensusTr("2 ayrı tarih: 01.03.2018 (s. 1); 15.01.2024 (s. 1).", "grid-v6")).toBeUndefined();
    expect(supersededCensusTr("1 ayrı oran: %15 (s. 2).", "grid-v6")).toBeUndefined();
    const census: ReviewCell = {
      rowNo: 1,
      columnNo: 2,
      state: "done",
      attempts: 1,
      answerStatus: "COMPLETE",
      answerText: "3 ayrı tutar: 45.000 TL (s. 1); 61.842,11 TL (s. 1); 99.284,5 TL (s. 2).",
      supportState: "exhaustive_complete",
      provenance: [],
      processingCoverage: { complete: true },
      answerRunId: null,
      generatorVersion: "grid-v6",
      error: null,
    };
    const shown = presentStoredCell(census);
    expect(shown.answerStatus).toBe("PARTIAL");
    expect(supportLabelTr(shown)).toBe("belgenin tamamı okundu; sayım eksik olabilir");
  });
});
