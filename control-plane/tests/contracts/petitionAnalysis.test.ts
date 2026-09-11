/**
 * W16 · Şerit D — Karşı Dilekçe Analizi.
 *
 * The five rules these tests exist to keep. Each one is a place where the
 * product could quietly turn into the thing it refuses to be:
 *
 *  D-1  Claim extraction is DETERMINISTIC and rule-based. Same text in, the
 *       same claim list out — ids, kinds, headings, numbering. A claim list a
 *       lawyer cannot re-derive by reading the document is worse than none.
 *  D-2  A `⚠ KAYNAKSIZ` line may not carry an assessment word ("risk",
 *       "zayıf", "hatalı" …) in any Turkish inflection — even when the
 *       petition's own sentence does. The document's sentence survives
 *       verbatim in `alinti`; the scrubbing is on ColleX's own line only.
 *  D-3  An unresolvable citation is UNCERTAIN, never NOT_FOUND — including
 *       when the resolver THROWS. "We did not find it" is a statement about
 *       our coverage, and NOT_FOUND accuses the drafter of inventing it.
 *  D-4  A contrary lane that never ran (ÇALIŞTIRILMADI) is never drawn as
 *       "aleyhe kaynak yok" (ARANDI_BULUNAMADI). Two different answers.
 *  D-5  The report carries the CONSTANT summary sentence verbatim and no
 *       score, percentage, ranking or "chance of success" anywhere.
 *
 * All content is SENTETİK.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  CONTRARY_BUDGET_TR,
  CONTRARY_FAILED_TR,
  CONTRARY_UNWIRED_TR,
  EVALUATIVE_WORD_PLACEHOLDER,
  EVALUATIVE_WORD_STEMS,
  MAX_CLAIMS,
  NO_CONTRARY_BASE_TERM_TR,
  PETITION_ANALYSIS_SCHEMA,
  PETITION_ANALYSIS_SUMMARY_TR,
  analyzeDraftAsPetition,
  analyzePetition,
  contraryBaseTerm,
  extractClaims,
  isPreambleLine,
  petitionTextFromDraft,
  splitPetitionSentences,
  stripEvaluativeWords,
  type ContrarySearchPort,
} from "../../src/contracts/petitionAnalysis.js";
import {
  PETITION_FILE_UNWIRED_TR,
  createContractsRouter,
} from "../../src/contracts/routes.js";
import { KAYNAKSIZ_PREFIX } from "../../src/contracts/clauseReview.js";
import { auditDraftCitations } from "../../src/contracts/draftAudit.js";
import type { CitationResolver } from "../../src/contracts/citationAudit.js";
import { composeDraft } from "../../src/drafting/composer.js";
import { davaRequest, tckPack, tckEvidence } from "../drafting/fixtures.js";

const NOW = () => new Date("2026-09-04T11:00:00.000Z");
const AS_OF = "2026-09-04";

/**
 * A SENTETİK cevap dilekçesi: a preamble, three headed sections, numbered
 * claims, two legislation citations, one decision, and — deliberately — a
 * sentence stuffed with assessment words so D-2 has something to bite on.
 */
const PETITION = [
  "İZMİR 3. ASLİYE HUKUK MAHKEMESİ'NE",
  "",
  "CEVAP DİLEKÇESİ",
  "",
  "DAVALI : Veli Kaya",
  "VEKİLİ : Av. Ayşe Yılmaz",
  "",
  "AÇIKLAMALAR",
  "",
  "1. Müvekkil ile davacı arasında 01.02.2023 tarihinde kira sözleşmesi",
  "kurulmuştur. Davacı, kira bedelinin ödenmediğini iddia etmektedir.",
  "",
  "2. 6098 sayılı Türk Borçlar Kanunu m. 344 uyarınca kira bedelinin",
  "uyarlanması gerekmektedir. Davacının bu yöndeki beyanı hatalıdır, zayıftır",
  "ve dayanaksızdır.",
  "",
  "HUKUKİ SEBEPLER",
  "",
  "3. 6100 sayılı Hukuk Muhakemeleri Kanunu m. 119 ile Yargıtay 3. Hukuk",
  "Dairesi E. 2023/4521, K. 2024/1188 sayılı kararı.",
  "",
  "SONUÇ VE İSTEM",
  "",
  "4. Yukarıda açıklanan nedenlerle davanın reddine karar verilmesini",
  "saygıyla talep ederiz.",
].join("\n");

/** Resolves the TBK reference and nothing else; decides nothing negative. */
const partialResolver: CitationResolver = async (citation) => {
  if (citation.parsed?.legislationNo === "6098") {
    return { kunye: "6098 sayılı Türk Borçlar Kanunu m. 344 (SENTETİK)", currency: "IN_FORCE" };
  }
  return {};
};

// ---------------------------------------------------------------------------
// D-1 — deterministic, rule-based claim extraction
// ---------------------------------------------------------------------------

describe("D-1: claim extraction is deterministic and rule-based", () => {
  it("returns the identical claim list on every run", () => {
    const first = extractClaims(PETITION);
    const second = extractClaims(PETITION);
    const third = extractClaims(PETITION);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("pins the claims of the fixture: id, kind, heading and numbering", () => {
    expect(
      extractClaims(PETITION).map((claim) => ({
        claimId: claim.claimId,
        kind: claim.kind,
        heading: claim.heading,
        number: claim.number,
      })),
    ).toEqual([
      { claimId: "iddia-1", kind: "VAKIA", heading: "AÇIKLAMALAR", number: "1" },
      // W17: claim 2 cites TBK m. 344 and its whole point is that the article
      // requires an adjustment — a legal ground, not a narrative of events.
      // "AÇIKLAMALAR" is the generic section, so under it the paragraph's own
      // citation decides; claim 1 has none and stays a vakıa. Before this the
      // heading alone decided and BOTH were "vakıa", whose help text tells the
      // lawyer a missing citation is normal.
      { claimId: "iddia-2", kind: "HUKUKI_SEBEP", heading: "AÇIKLAMALAR", number: "2" },
      { claimId: "iddia-3", kind: "HUKUKI_SEBEP", heading: "HUKUKİ SEBEPLER", number: "3" },
      { claimId: "iddia-4", kind: "TALEP", heading: "SONUÇ VE İSTEM", number: "4" },
    ]);
  });

  it("keeps the petition's own words in the claim text", () => {
    const claims = extractClaims(PETITION);
    expect(claims[1]?.text).toContain("6098 sayılı Türk Borçlar Kanunu m. 344");
    // Wrapped lines are rejoined, not lost.
    expect(claims[1]?.text).toContain("uyarlanması gerekmektedir");
  });

  it("drops the preamble: the addressee, the title and the identity lines", () => {
    expect(isPreambleLine("İZMİR 3. ASLİYE HUKUK MAHKEMESİ'NE")).toBe(true);
    expect(isPreambleLine("CEVAP DİLEKÇESİ")).toBe(true);
    expect(isPreambleLine("DAVALI : Veli Kaya")).toBe(true);
    // A real assertion is NOT a preamble line, even a short one.
    expect(isPreambleLine("Davacı kira bedelini ödememiştir.")).toBe(false);
    const texts = extractClaims(PETITION).map((claim) => claim.text);
    expect(texts.some((text) => text.includes("MAHKEMESİ"))).toBe(false);
    expect(texts.some((text) => text.includes("CEVAP DİLEKÇESİ"))).toBe(false);
    expect(texts.some((text) => text.startsWith("DAVALI"))).toBe(false);
  });

  it("splits sentences without breaking Turkish legal abbreviations", () => {
    expect(
      splitPetitionSentences("6098 sayılı Kanun m. 344 uygulanır. Davacı haklı değildir."),
    ).toEqual(["6098 sayılı Kanun m. 344 uygulanır.", "Davacı haklı değildir."]);
    // "344." is a numbered article, not a sentence end.
    expect(splitPetitionSentences("Anılan Kanunun 344. maddesi uygulanır.")).toEqual([
      "Anılan Kanunun 344. maddesi uygulanır.",
    ]);
    expect(splitPetitionSentences("   ")).toEqual([]);
  });

  it("falls back to paragraphs when the petition carries no numbering", async () => {
    const plain = [
      "Müvekkil davayı kabul etmemektedir.",
      "",
      "Davacının talebi zamanaşımına uğramıştır.",
    ].join("\n");
    const claims = extractClaims(plain);
    expect(claims).toHaveLength(2);
    expect(claims.every((claim) => claim.number === "")).toBe(true);
    expect(claims.every((claim) => claim.heading === "")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-2 — the KAYNAKSIZ line may not assess
// ---------------------------------------------------------------------------

describe("D-2: an unsourced line is an observation, never an assessment", () => {
  it("removes every assessment word, in every Turkish inflection", () => {
    expect(stripEvaluativeWords("Bu beyan hatalıdır, zayıftır ve dayanaksızdır.")).toBe(
      `Bu beyan ${EVALUATIVE_WORD_PLACEHOLDER}, ${EVALUATIVE_WORD_PLACEHOLDER} ve ${EVALUATIVE_WORD_PLACEHOLDER}.`,
    );
    expect(stripEvaluativeWords("Riskli bir yorumdur.")).toBe(
      `${EVALUATIVE_WORD_PLACEHOLDER} bir yorumdur.`,
    );
    // Turkish dotted/dotless I must not defeat the match.
    expect(stripEvaluativeWords("ZAYIFTIR")).toBe(EVALUATIVE_WORD_PLACEHOLDER);
    // A word that merely starts with the same letters is untouched.
    expect(stripEvaluativeWords("Hatırlatmak isteriz.")).toBe("Hatırlatmak isteriz.");
  });

  it("scrubs the KAYNAKSIZ line while keeping the petition's sentence verbatim", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    const lines = report.claims.flatMap((claim) => claim.unsourced);
    expect(lines.length).toBeGreaterThan(0);

    // Every observation line carries the marker and NO assessment word.
    for (const finding of lines) {
      expect(finding.line.startsWith(`${KAYNAKSIZ_PREFIX} — `)).toBe(true);
      for (const stem of EVALUATIVE_WORD_STEMS) {
        expect(finding.line.toLocaleLowerCase("tr-TR")).not.toContain(stem);
      }
    }

    // …and the document's own sentence is preserved, assessment words included.
    const loaded = lines.find((finding) => finding.alinti.includes("hatalıdır"));
    expect(loaded).toBeDefined();
    expect(loaded?.alinti).toContain("zayıftır");
    expect(loaded?.line).not.toContain("zayıftır");
    expect(loaded?.line).toContain(EVALUATIVE_WORD_PLACEHOLDER);
  });

  it("does not mark a sentence that carries its own citation", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    const legal = report.claims[1];
    expect(legal?.citations.length).toBeGreaterThan(0);
    expect(legal?.unsourced.every((finding) => !finding.alinti.includes("m. 344"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-3 — an unresolvable citation is UNCERTAIN, never NOT_FOUND
// ---------------------------------------------------------------------------

describe("D-3: unresolved is belirsiz, not bulunamadı", () => {
  it("puts a citation the resolver cannot resolve in UNCERTAIN", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    const rows = report.citationAudit.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(report.totals.citations.NOT_FOUND).toBe(0);
    expect(report.totals.citations.UNCERTAIN).toBeGreaterThan(0);
    // …and an unresolved row's künye cell stays EMPTY. Never a guess.
    for (const row of rows.filter((entry) => entry.bucket === "UNCERTAIN")) {
      expect(row.kunye).toBe("");
    }
  });

  it("puts a citation whose lookup THROWS in UNCERTAIN, not NOT_FOUND", async () => {
    const exploding: CitationResolver = async () => {
      throw new Error("veritabanı kapalı");
    };
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: exploding, now: NOW },
    );
    expect(report.totals.citations.NOT_FOUND).toBe(0);
    expect(report.totals.citations.FOUND).toBe(0);
    expect(report.citationAudit.rows.every((row) => row.bucket === "UNCERTAIN")).toBe(true);
    expect(report.citationAudit.rows.every((row) => row.kunye === "")).toBe(true);
  });

  it("attributes a resolved citation to the claim that made it", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    const claim = report.claims[1];
    expect(claim?.claim.number).toBe("2");
    expect(claim?.citations.some((row) => row.kunye.includes("6098 sayılı"))).toBe(true);
    expect(claim?.citationTotals.FOUND).toBeGreaterThan(0);
    expect(claim?.citationTotals.NOT_FOUND).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D-4 — a lane that never ran is not a lane that found nothing
// ---------------------------------------------------------------------------

describe("D-4: contrary lanes", () => {
  it("builds the lanes and marks them ÇALIŞTIRILMADI when nothing is wired", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    const lanes = report.claims.flatMap((claim) => claim.contrary.lanes);
    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes.every((lane) => lane.state === "CALISTIRILMADI")).toBe(true);
    expect(lanes.every((lane) => lane.reason === CONTRARY_UNWIRED_TR)).toBe(true);
    // The query is SHOWN even though it did not run.
    expect(lanes.every((lane) => lane.query.trim() !== "")).toBe(true);
    expect(report.totals.contraryLanesRun).toBe(0);
    expect(report.totals.contraryLanesBuilt).toBe(lanes.length);
    // "did not run" is never counted as "searched and found nothing".
    expect(lanes.some((lane) => lane.state === "ARANDI_BULUNAMADI")).toBe(false);
  });

  it("separates BULUNDU, ARANDI_BULUNAMADI and ARAMA_BASARISIZ", async () => {
    const search: ContrarySearchPort = async (lane) => {
      if (lane.kind === "outcome_flip") {
        return [{ kunye: "Yargıtay 6. HD E. 2022/9001, K. 2023/4402 (SENTETİK)" }];
      }
      if (lane.kind === "dissent") throw new Error("kaynak erişilemedi");
      return [];
    };
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, contrarySearch: search, now: NOW },
    );
    const lanes = report.claims.flatMap((claim) => claim.contrary.lanes);
    const states = new Set(lanes.map((lane) => lane.state));
    expect(states.has("BULUNDU")).toBe(true);
    expect(states.has("ARAMA_BASARISIZ")).toBe(true);
    expect(states.has("CALISTIRILMADI")).toBe(false);
    expect(
      lanes.find((lane) => lane.state === "ARAMA_BASARISIZ")?.reason,
    ).toBe(CONTRARY_FAILED_TR);
    expect(report.totals.contraryHits).toBeGreaterThan(0);
    expect(report.totals.contraryLanesRun).toBeGreaterThan(0);
  });

  it("says so plainly when no contrary query could be built at all", async () => {
    const report = await analyzePetition(
      { text: "Müvekkil beyanlarına katılmamaktadır.", asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    expect(report.claims[0]?.contrary.baseTerm).toBe("");
    expect(report.claims[0]?.contrary.lanes).toEqual([]);
    expect(report.claims[0]?.contrary.note).toBe(NO_CONTRARY_BASE_TERM_TR);
    expect(report.totals.claimsWithoutContraryQuery).toBe(1);
  });

  // W17: the base term is the INSTITUTION, never the statute number. Measured
  // on a real cevap dilekçesi (06.09.2026): the old statute fallback produced
  // "6098 sayılı m. 475 bozma", a string no decision is written with, and the
  // archive answered five unrelated decisions per claim — which the report
  // then printed as "aleyhe kaynak BULUNDU". An empty term is the honest
  // answer: the lane is shown, ÇALIŞTIRILMADI, with its reason.
  it("derives the base term from the institution, and stays EMPTY otherwise", () => {
    expect(contraryBaseTerm("Kira bedelinin uyarlanması talep edilmektedir.")).toBe("kira");
    // A claim that names only a provision names no institution to search for.
    expect(contraryBaseTerm("6100 sayılı Kanun m. 119 uygulanır.")).toBe("");
    expect(contraryBaseTerm("Müvekkil bu hususa katılmamaktadır.")).toBe("");
  });

  it("never builds a query out of a statute number", () => {
    // The exact shape that produced fifty wrong hits.
    for (const text of [
      "Davacı TBK m. 475 uyarınca bedelden indirim talep etmektedir.",
      "Dava değeri HMK m. 119 unsurlarını taşımamaktadır.",
    ]) {
      expect(contraryBaseTerm(text)).not.toMatch(/sayılı/u);
      expect(contraryBaseTerm(text)).not.toMatch(/^\d/u);
    }
  });

  it("marks lanes beyond the run budget ÇALIŞTIRILMADI with the budget reason", async () => {
    const search: ContrarySearchPort = async () => [];
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      {
        resolveCitation: partialResolver,
        contrarySearch: search,
        maxContraryLaneRuns: 1,
        now: NOW,
      },
    );
    const lanes = report.claims.flatMap((claim) => claim.contrary.lanes);
    // W17: the budget counts UPSTREAM CALLS, not lanes. A lane whose query an
    // earlier lane already sent is answered from that answer and costs
    // nothing, so several lanes may legitimately report the one search this
    // budget paid for. What the budget guarantees is the number of DISTINCT
    // queries that reached a source.
    const answered = lanes.filter((lane) => lane.state !== "CALISTIRILMADI");
    expect(answered.length).toBeGreaterThan(0);
    expect(new Set(answered.map((lane) => lane.query)).size).toBe(1);
    expect(answered.every((lane) => lane.state === "ARANDI_BULUNAMADI")).toBe(true);
    const skipped = lanes.filter((lane) => lane.state === "CALISTIRILMADI");
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((lane) => lane.reason === CONTRARY_BUDGET_TR)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-5 — the report says what it is, and never what it is not
// ---------------------------------------------------------------------------

describe("D-5: the honesty surface", () => {
  it("prints the constant summary sentence verbatim, in the report and the notices", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    expect(report.summary).toBe(PETITION_ANALYSIS_SUMMARY_TR);
    expect(report.notices[0]).toBe(PETITION_ANALYSIS_SUMMARY_TR);
    expect(report.schema).toBe(PETITION_ANALYSIS_SCHEMA);
    expect(report.summary).toContain("hukuki değerini ölçmez");
    expect(report.summary).toContain("kazanma şansı hakkında hiçbir şey söylemez");
  });

  it("carries no score, percentage, ranking or strength anywhere in the body", async () => {
    const report = await analyzePetition(
      { text: PETITION, asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    const body = JSON.stringify(report).toLocaleLowerCase("tr-TR");
    for (const forbidden of [
      '"score"',
      '"puan"',
      '"skor"',
      '"strength"',
      '"guclu"',
      '"confidence"',
      '"ilgililik"',
      "%",
      "kazanma olasılığı",
      "başarı şansı",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("answers an empty petition with an empty, well-formed report", async () => {
    const report = await analyzePetition(
      { text: "   \n\n  ", asOf: AS_OF },
      { resolveCitation: partialResolver, now: NOW },
    );
    expect(report.claims).toEqual([]);
    expect(report.citationAudit.rows).toEqual([]);
    expect(report.totals).toEqual({
      claims: 0,
      sentences: 0,
      byKind: { TALEP: 0, VAKIA: 0, HUKUKI_SEBEP: 0, DIGER: 0 },
      citations: { FOUND: 0, NOT_FOUND: 0, UNCERTAIN: 0 },
      unsourcedSentences: 0,
      contraryLanesBuilt: 0,
      contraryLanesRun: 0,
      contraryHits: 0,
      claimsWithoutContraryQuery: 0,
    });
    // The summary is unconditional; an empty report still says what it is.
    expect(report.summary).toBe(PETITION_ANALYSIS_SUMMARY_TR);
    expect(report.notices.some((line) => line.includes("iddia bulunamadı"))).toBe(true);
  });

  it("refuses a date that is not the petition's own ISO date", async () => {
    await expect(
      analyzePetition({ text: PETITION, asOf: "04.09.2026" }, { now: NOW }),
    ).rejects.toThrow(/YYYY-AA-GG/u);
  });

  it("caps the claim list and says so rather than truncating silently", async () => {
    const many = Array.from({ length: MAX_CLAIMS + 5 }, (_, i) => `${i + 1}. Beyan ${i + 1}.`).join(
      "\n\n",
    );
    const report = await analyzePetition({ text: many, asOf: AS_OF }, { now: NOW });
    expect(report.claims).toHaveLength(MAX_CLAIMS);
    expect(report.notices.some((line) => line.includes(String(MAX_CLAIMS)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Our own draft goes through the same engine — and draftAudit is untouched
// ---------------------------------------------------------------------------

describe("the same analysis runs over one of our own drafts", () => {
  const draft = () =>
    composeDraft(
      davaRequest(),
      tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }] }),
      { now: NOW },
    );

  it("flattens a draft into petition text and analyses it as ours", async () => {
    const text = petitionTextFromDraft(draft());
    expect(text.trim()).not.toBe("");
    const report = await analyzeDraftAsPetition(draft(), { now: NOW }, { asOf: AS_OF });
    expect(report.own).toBe(true);
    expect(report.claims.length).toBeGreaterThan(0);
    expect(report.summary).toBe(PETITION_ANALYSIS_SUMMARY_TR);
    expect(report.notices.some((line) => line.includes("KENDİ dilekçenizi"))).toBe(true);
  });

  it("leaves draftAudit's own report alone — the two live side by side", () => {
    const report = auditDraftCitations(draft(), { asOf: AS_OF, now: NOW });
    expect(report.schema).toBe("collex.citation-audit/v1");
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.bucket).toBe("FOUND");
  });
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

describe("POST /v1/contracts/petition-analysis", () => {
  const mount = (deps: Parameters<typeof createContractsRouter>[0] = {}): Hono => {
    const app = new Hono();
    app.route("/", createContractsRouter({ now: NOW, ...deps }));
    return app;
  };

  const post = async (body: unknown, deps?: Parameters<typeof createContractsRouter>[0]) =>
    mount(deps).request("/v1/contracts/petition-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("analyses pasted text", async () => {
    const response = await post(
      { text: PETITION, asOf: AS_OF, documentTitle: "Cevap dilekçesi (SENTETİK)" },
      { resolveCitation: partialResolver },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      schema: string;
      summary: string;
      documentTitle: string;
      claims: unknown[];
    };
    expect(body.schema).toBe(PETITION_ANALYSIS_SCHEMA);
    expect(body.summary).toBe(PETITION_ANALYSIS_SUMMARY_TR);
    expect(body.documentTitle).toBe("Cevap dilekçesi (SENTETİK)");
    expect(body.claims).toHaveLength(4);
  });

  it("refuses a request with neither text nor fileId", async () => {
    const response = await post({ asOf: AS_OF });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("belge kimliği verilmedi");
  });

  it("refuses text and fileId in the same request", async () => {
    const response = await post({ text: PETITION, fileId: "0123456789abcdef", asOf: AS_OF });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("birini seçin");
  });

  it("names the unrecognized field rather than rejecting the whole body namelessly", async () => {
    const response = await post({ text: PETITION, asOf: AS_OF, tahmin: true });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { issues?: { path: string[]; label?: string }[] };
    };
    expect(body.error.issues?.some((issue) => issue.path.includes("tahmin"))).toBe(true);
  });

  it("answers a typed 503 for fileId when uploads are not wired into this lane", async () => {
    const response = await post({ fileId: "0123456789abcdef", asOf: AS_OF });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("STORE_UNAVAILABLE");
    expect(body.error.message).toBe(PETITION_FILE_UNWIRED_TR);
  });

  it("reads an uploaded document through the drafting file port, in passage order", async () => {
    const chunk = (ordinal: number, text: string, startChar: number) => ({
      fileId: "0123456789abcdef",
      fileName: "cevap.pdf",
      chunkId: `c${ordinal}`,
      ordinal,
      text,
      startChar,
      endChar: startChar + text.length,
      contentSha256: "0".repeat(64),
    });
    const response = await post(
      { fileId: "0123456789abcdef", asOf: AS_OF },
      {
        resolveCitation: partialResolver,
        files: {
          // Deliberately out of order: the route must sort, not trust.
          getChunks: async () => [
            chunk(2, "2. 6098 sayılı Türk Borçlar Kanunu m. 344 uyarınca itiraz ediyoruz.", 100),
            chunk(1, "1. Müvekkil kira bedelini ödemiştir.", 0),
          ],
        },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      claims: { claim: { number: string } }[];
      notices: string[];
    };
    expect(body.claims.map((entry) => entry.claim.number)).toEqual(["1", "2"]);
    expect(body.notices.some((line) => line.includes("pasaj sınırı paragraf sınırı"))).toBe(true);
  });

  it("answers 404 when the named document yields no text", async () => {
    const response = await post(
      { fileId: "0123456789abcdef", asOf: AS_OF },
      { files: { getChunks: async () => [] } },
    );
    expect(response.status).toBe(404);
  });

  it("answers 503, not 500, when the upload store throws", async () => {
    const response = await post(
      { fileId: "0123456789abcdef", asOf: AS_OF },
      {
        files: {
          getChunks: async () => {
            throw new Error("bağlantı yok");
          },
        },
      },
    );
    expect(response.status).toBe(503);
  });

  it("rejects a malformed asOf before doing any work", async () => {
    const response = await post({ text: PETITION, asOf: "04.09.2026" });
    expect(response.status).toBe(400);
  });
});
