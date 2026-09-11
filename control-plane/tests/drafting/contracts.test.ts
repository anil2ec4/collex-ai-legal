/**
 * W14 · B-13 (Atıf Denetim Raporu) and B-24 (rule-based sözleşme incelemesi).
 *
 * The two rules these tests exist to keep:
 *
 *  B-13 — a citation that cannot be resolved renders an EMPTY künye. Never a
 *         guess. And "bulunamadı" (we looked, it is not there — the
 *         hallucination signal) is never conflated with "belirsiz" (we could
 *         not look, or it is outside our scope).
 *  B-24 — a line may use the word "risk" ONLY when it is bound to a
 *         hash-verified quote. Everything else is an observation, marked
 *         ⚠ KAYNAKSIZ, with the word removed.
 *
 * All content is SENTETİK.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { writeFile } from "node:fs/promises";

import {
  AUDIT_NOTICES,
  auditCitations,
  extractAuditCitations,
  type CitationResolver,
} from "../../src/contracts/citationAudit.js";
import {
  KAYNAKSIZ_PREFIX,
  reviewContract,
  runChecklist,
  splitClauses,
  stripRiskWords,
  type Checklist,
} from "../../src/contracts/clauseReview.js";
import { auditDraftCitations } from "../../src/contracts/draftAudit.js";
import {
  UNWIRED_RESOLVER,
  createContractsRouter,
  InMemoryChecklistStore,
} from "../../src/contracts/routes.js";
import { composeDraft } from "../../src/drafting/composer.js";
import { reviseDraft } from "../../src/drafting/revise.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";
import { davaRequest, tckPack, tckEvidence } from "./fixtures.js";

const NOW = () => new Date("2026-09-02T11:00:00.000Z");

/** A SENTETİK petition with five distinct citations. */
const PETITION = [
  "Sayın Mahkemenize sunulan dilekçemizde 6098 sayılı Türk Borçlar Kanunu m. 344",
  "hükmüne dayanılmaktadır. Ayrıca 6100 sayılı Hukuk Muhakemeleri Kanunu m. 119",
  "uyarınca dava şartları yerine getirilmiştir. Yargıtay 3. Hukuk Dairesi",
  "E. 2023/4521, K. 2024/1188 sayılı kararı ile Yargıtay 6. Hukuk Dairesi",
  "E. 2022/9001, K. 2023/4402 sayılı kararı bu yöndedir. 2004 sayılı İcra ve",
  "İflas Kanunu m. 269 da uygulanacaktır.",
].join("\n");

describe("B-13: citation extraction", () => {
  it("finds at least five distinct citations, one row per authority", () => {
    const once = extractAuditCitations(PETITION);
    expect(once.length).toBeGreaterThanOrEqual(5);
    expect(once.every((c) => c.count === 1)).toBe(true);
    // Two legislation references and two decisions, each identified.
    expect(once.some((c) => c.parsed?.legislationNo === "6098")).toBe(true);
    expect(once.some((c) => c.parsed?.docketNo === "2023/4521")).toBe(true);

    // The same authority written twice collapses into ONE row with count 2 —
    // the report is per authority, not per occurrence. (A bare "m. 344" whose
    // owning law the parser resolves from context can key differently in a
    // different context; that is the parser's behaviour, not the auditor's,
    // so the assertion is on the fully identified references.)
    const twice = extractAuditCitations(`${PETITION}\n${PETITION}`);
    expect(twice.find((c) => c.parsed?.legislationNo === "6098")?.count).toBe(2);
    expect(twice.find((c) => c.parsed?.docketNo === "2023/4521")?.count).toBe(2);
  });
});

describe("B-13: the three buckets", () => {
  const resolver: CitationResolver = async (citation) => {
    if (citation.raw.includes("344")) {
      return { kunye: "6098 sayılı TBK m. 344 (SENTETİK)", currency: "IN_FORCE" };
    }
    if (citation.raw.includes("2023/4521")) {
      return { absent: true };
    }
    if (citation.raw.includes("269")) {
      return { uncertainReason: "Bu kaynak kapsamımızın dışında (B-14)." };
    }
    return undefined;
  };

  it("keeps bulunamadı and belirsiz apart, and never invents a künye", async () => {
    const report = await auditCitations({ text: PETITION, asOf: "2026-06-01" }, resolver, {
      now: NOW,
    });
    expect(report.asOf).toBe("2026-06-01");

    const found = report.rows.filter((r) => r.bucket === "FOUND");
    const notFound = report.rows.filter((r) => r.bucket === "NOT_FOUND");
    const uncertain = report.rows.filter((r) => r.bucket === "UNCERTAIN");
    expect(found.length).toBe(1);
    expect(notFound.length).toBe(1);
    expect(uncertain.length).toBeGreaterThanOrEqual(2);

    // THE RULE: nothing resolved -> empty cell.
    for (const row of [...notFound, ...uncertain]) {
      expect(row.kunye, row.raw).toBe("");
    }
    expect(found[0]?.kunye).toBe("6098 sayılı TBK m. 344 (SENTETİK)");
    expect(found[0]?.currencyLabel).toBe("yürürlükte");
    expect(notFound[0]?.bucketLabel).toBe("bulunamadı");
    expect(uncertain[0]?.bucketLabel).toBe("belirsiz");
    expect(uncertain.some((r) => r.reason.includes("kapsamımızın dışında"))).toBe(true);
    expect(report.totals.FOUND + report.totals.NOT_FOUND + report.totals.UNCERTAIN).toBe(
      report.rows.length,
    );
    for (const notice of AUDIT_NOTICES) expect(report.notices).toContain(notice);
  });

  it("a resolver that throws yields belirsiz, never bulunamadı", async () => {
    const report = await auditCitations(
      { citations: [{ raw: "6098 sayılı TBK m. 344" }], asOf: "2026-06-01" },
      async () => {
        throw new Error("veritabanına erişilemedi");
      },
      { now: NOW },
    );
    expect(report.rows[0]?.bucket).toBe("UNCERTAIN");
    expect(report.rows[0]?.reason).toContain("elle kontrol");
  });

  it("an authority that exists but does not say what was claimed is belirsiz", async () => {
    const quote = "Sentetik kira artış oranı tüketici fiyat endeksini aşamaz.";
    const report = await auditCitations(
      { citations: [{ raw: "6098 sayılı TBK m. 344" }], asOf: "2026-06-01" },
      async () => ({ kunye: "6098 sayılı TBK m. 344", quoteSha256: sha256HexUtf8("başka bir metin") }),
      { now: NOW },
    );
    // No claimed quote -> nothing to disprove.
    expect(report.rows[0]?.quoteVerified).toBe("ALINTI_YOK");

    const withQuote = await auditCitations(
      { citations: [{ raw: "6098 sayılı TBK m. 344" }], asOf: "2026-06-01" },
      async (citation) => {
        citation.claimedQuote = quote;
        return { kunye: "6098 sayılı TBK m. 344", quoteSha256: sha256HexUtf8("başka bir metin") };
      },
      { now: NOW },
    );
    expect(withQuote.rows[0]?.quoteVerified).toBe("DOGRULANMADI");
    expect(withQuote.rows[0]?.bucket).toBe("UNCERTAIN");
  });

  it("refuses an asOf that is not a date — currency is never 'as of today'", async () => {
    await expect(
      auditCitations({ text: PETITION, asOf: "bugün" }, UNWIRED_RESOLVER),
    ).rejects.toThrow(/YYYY-AA-GG/u);
  });

  it("an unwired deployment says belirsiz for everything, never bulunamadı", async () => {
    const report = await auditCitations({ text: PETITION, asOf: "2026-06-01" }, UNWIRED_RESOLVER, {
      now: NOW,
    });
    expect(report.totals.NOT_FOUND).toBe(0);
    expect(report.totals.UNCERTAIN).toBe(report.rows.length);
    expect(report.rows.every((r) => r.kunye === "")).toBe(true);
  });
});

describe("B-13: the audit of our own draft", () => {
  const draft = () =>
    composeDraft(davaRequest(), tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }] }), {
      now: NOW,
    });

  it("reports a used, hash-holding citation as bulundu with its künye", () => {
    const report = auditDraftCitations(draft(), { asOf: "2026-09-02", now: NOW });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.bucket).toBe("FOUND");
    expect(report.rows[0]?.kunye).toBe(tckEvidence().label);
    expect(report.rows[0]?.count).toBeGreaterThan(0);
    expect(report.reviewComplete).toBe(false);
  });

  it("reports a broken quote binding as belirsiz with the B-01 reason", () => {
    const base = draft();
    const tampered = {
      ...base,
      sections: base.sections.map((s) => ({
        ...s,
        paragraphs: s.paragraphs.map((p) =>
          p.evidenceIds.length > 0 ? { ...p, text: "Alıntı silindi." } : p,
        ),
      })),
    };
    const report = auditDraftCitations(tampered, { asOf: "2026-09-02", now: NOW });
    expect(report.rows[0]?.bucket).toBe("UNCERTAIN");
    expect(report.rows[0]?.reason).toContain("alıntı değiştirildi");
  });

  it("carries B-36's review record into the report columns", () => {
    const base = draft();
    const sections = base.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({
        id: s.id,
        paragraphs: s.paragraphs.map((p) => ({
          id: p.id,
          text: p.text,
          evidenceIds: [...p.evidenceIds],
          role: p.role,
        })),
      }));
    const { draft: v2 } = reviseDraft(
      base,
      {
        sections,
        evidenceReview: {
          "ev-tck157": { checked: true, by: "Av. Ayşe Yılmaz", note: "Resmî metinle karşılaştırıldı." },
        },
        reviewChecklist: {
          citationsOpened: { checked: true },
          unsupportedReviewed: { checked: true },
          contraryRead: { checked: true },
        },
      },
      { trustEntailment: false, now: NOW },
    );
    const report = auditDraftCitations(v2, { asOf: "2026-09-02", now: NOW });
    expect(report.reviewComplete).toBe(true);
    expect(report.rows[0]?.review).toEqual({
      reviewed: true,
      by: "Av. Ayşe Yılmaz",
      at: "2026-09-02T11:00:00.000Z",
      note: "Resmî metinle karşılaştırıldı.",
    });
  });
});

// ---------------------------------------------------------------------------
// B-24
// ---------------------------------------------------------------------------

const KIRA = [
  "KİRA SÖZLEŞMESİ (SENTETİK)",
  "MADDE 1 - Taraflar: Kiraya veren Ayşe Yılmaz, kiracı Veli Kaya.",
  "MADDE 2 - Mecur: İzmir ili Konak ilçesinde bulunan sentetik daire.",
  "MADDE 3 - Kira bedeli aylık 20.000 TL olarak kararlaştırılmıştır.",
  "MADDE 4 - Depozito olarak iki aylık kira bedeli peşin alınmıştır.",
  "MADDE 5 - Kira bedeli her yıl artış oranı olarak TÜFE oranında güncellenir.",
  "MADDE 6 - Ödeme her ayın beşinci günü yapılır.",
  "MADDE 7 - Kiralanan konut amaçlı kullanılacaktır.",
  "MADDE 8 - Tadilat kiraya verenin yazılı iznine bağlıdır.",
  "MADDE 9 - Uyuşmazlıklarda İzmir mahkemeleri yetkilidir.",
  "MADDE 10 - Sözleşme iki nüsha düzenlenmiştir.",
].join("\n");

const KIRA_CHECKLIST: Checklist = {
  id: "kira-v1",
  title: "Kira sözleşmesi kontrol listesi",
  items: [
    { id: "depozito", label: "Depozito", terms: ["depozito", "güvence bedeli"] },
    { id: "artis", label: "Artış oranı", terms: ["artış oranı", "güncelleme oranı"] },
    { id: "tahliye", label: "Tahliye taahhüdü", terms: ["tahliye taahhüdü"] },
    { id: "damga", label: "Damga vergisi", terms: ["damga vergisi"] },
    { id: "yetki", label: "Yetkili mahkeme", terms: ["yetkili", "mahkemeleri yetkilidir"] },
    { id: "odeme", label: "Ödeme günü", terms: ["ödeme"] },
    { id: "kullanim", label: "Kullanım amacı", terms: ["konut amaçlı", "kullanılacaktır"] },
    { id: "tadilat", label: "Tadilat izni", terms: ["tadilat"] },
    { id: "nusha", label: "Nüsha sayısı", terms: ["nüsha"] },
    { id: "kefil", label: "Kefil", terms: ["kefil", "müteselsil kefalet"] },
  ],
};

describe("B-24: clause splitting and the checklist", () => {
  it("splits a ten-clause contract into its clauses", () => {
    const clauses = splitClauses(KIRA);
    // Ten numbered clauses plus the unnumbered heading block.
    expect(clauses.filter((c) => c.number !== "")).toHaveLength(10);
    expect(clauses.find((c) => c.number === "4")?.text).toContain("Depozito");
  });

  it("gives every checklist item one of the three states", () => {
    const findings = runChecklist(splitClauses(KIRA), KIRA_CHECKLIST);
    expect(findings).toHaveLength(10);
    for (const finding of findings) {
      expect(["VAR", "YOK", "BELIRSIZ"]).toContain(finding.state);
    }
    expect(findings.find((f) => f.itemId === "depozito")?.state).toBe("VAR");
    expect(findings.find((f) => f.itemId === "depozito")?.clauseNumbers).toContain("4");
    expect(findings.find((f) => f.itemId === "artis")?.state).toBe("VAR");
    // Absent terms are YOK — never "eksik", never "risk".
    expect(findings.find((f) => f.itemId === "tahliye")?.state).toBe("YOK");
    expect(findings.find((f) => f.itemId === "damga")?.state).toBe("YOK");
    expect(findings.find((f) => f.itemId === "kefil")?.state).toBe("YOK");
  });

  it("marks a weak-term-only match BELİRSİZ", () => {
    const findings = runChecklist(splitClauses(KIRA), {
      id: "x",
      title: "x",
      items: [{ id: "sigorta", label: "Sigorta", terms: ["dask poliçesi"], weakTerms: ["sigorta", "mecur"] }],
    });
    expect(findings[0]?.state).toBe("BELIRSIZ");
  });
});

describe("B-24: the word 'risk' is reserved for hash-bound lines", () => {
  const quote = "Sentetik konut kirasında artış oranı bir önceki kira yılına ait TÜFE ortalamasını geçemez.";
  const evidence = [
    {
      evidenceId: "ev-tbk344",
      label: "6098 sayılı TBK m. 344 (SENTETİK)",
      quote,
      quoteSha256: sha256HexUtf8(quote),
    },
  ];

  it("keeps a sourced risk line and strips the word from an unsourced one", () => {
    const report = reviewContract(
      {
        text: KIRA,
        checklist: KIRA_CHECKLIST,
        evidence,
        observations: [
          { clauseIndex: 5, text: "Artış oranı bakımından risk vardır.", evidenceId: "ev-tbk344" },
          { clauseIndex: 8, text: "Tadilat maddesi riskli görünüyor; riskleri değerlendirin." },
        ],
      },
      { now: NOW },
    );

    const sourced = report.clauses.flatMap((c) => c.observations).filter((o) => o.sourced);
    const unsourced = report.clauses.flatMap((c) => c.observations).filter((o) => !o.sourced);
    expect(sourced).toHaveLength(1);
    expect(sourced[0]?.text).toContain("risk");
    expect(sourced[0]?.evidenceLabel).toBe("6098 sayılı TBK m. 344 (SENTETİK)");
    expect(unsourced).toHaveLength(1);
    expect(unsourced[0]?.text.startsWith(KAYNAKSIZ_PREFIX)).toBe(true);
    expect(unsourced[0]?.text.toLocaleLowerCase("tr-TR")).not.toContain("risk");
  });

  it("demotes an observation whose evidence does not hash to its own digest", () => {
    const report = reviewContract(
      {
        text: KIRA,
        checklist: KIRA_CHECKLIST,
        evidence: [{ ...evidence[0]!, quoteSha256: "0".repeat(64) }],
        observations: [
          { clauseIndex: 5, text: "Bu madde risk taşır.", evidenceId: "ev-tbk344" },
        ],
      },
      { now: NOW },
    );
    const observation = report.clauses.flatMap((c) => c.observations)[0];
    expect(observation?.sourced).toBe(false);
    expect(observation?.text).toContain(KAYNAKSIZ_PREFIX);
    expect(observation?.text.toLocaleLowerCase("tr-TR")).not.toContain("risk");
  });

  it("strips every Turkish inflection of the word", () => {
    expect(stripRiskWords("Risk, riski, riskli, risklerin")).toBe(
      "gözlem, gözlem, gözlem, gözlem",
    );
  });
});

describe("B-24 + B-13 router", () => {
  const app = (): Hono => {
    const router = new Hono();
    router.route(
      "/",
      createContractsRouter({
        now: NOW,
        checklists: new InMemoryChecklistStore([KIRA_CHECKLIST]),
        resolveCitation: async (citation) =>
          citation.raw.includes("344")
            ? { kunye: "6098 sayılı TBK m. 344 (SENTETİK)", currency: "IN_FORCE" }
            : { absent: true },
      }),
    );
    return router;
  };

  const post = async (path: string, body: unknown): Promise<Response> =>
    app().request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("audits a petition in one request", async () => {
    const response = await post("/v1/citation-audit", { text: PETITION, asOf: "2026-06-01" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: { kunye: string; bucket: string }[];
      asOf: string;
    };
    expect(body.asOf).toBe("2026-06-01");
    expect(body.rows.length).toBeGreaterThanOrEqual(5);
    expect(body.rows.filter((r) => r.bucket === "NOT_FOUND").every((r) => r.kunye === "")).toBe(
      true,
    );
  });

  it("refuses a request with no date and one with no document", async () => {
    expect((await post("/v1/citation-audit", { text: PETITION })).status).toBe(400);
    expect((await post("/v1/citation-audit", { asOf: "2026-06-01" })).status).toBe(400);
  });

  it("previews the citations without spending the lookups", async () => {
    const response = await post("/v1/citation-audit/preview", { text: PETITION });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { citations: { raw: string }[] };
    expect(body.citations.length).toBeGreaterThanOrEqual(5);
  });

  it("reviews a contract against a saved checklist", async () => {
    const response = await post("/v1/contracts/review", {
      text: KIRA,
      checklistId: "kira-v1",
      documentTitle: "Kira sözleşmesi (SENTETİK)",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      findings: { itemId: string; state: string }[];
      totals: Record<string, number>;
      notices: string[];
    };
    expect(body.findings).toHaveLength(10);
    expect(body.totals.VAR + body.totals.YOK + body.totals.BELIRSIZ).toBe(10);
    expect(body.notices.some((n) => n.includes("yapay zekâ kullanmaz"))).toBe(true);
  });

  it("answers 404 for an unknown checklist and 400 for none at all", async () => {
    expect((await post("/v1/contracts/review", { text: KIRA, checklistId: "yok" })).status).toBe(404);
    expect((await post("/v1/contracts/review", { text: KIRA })).status).toBe(400);
  });

  it("exports the checked report as a DOCX through the shared exporter contract", async () => {
    const router = new Hono();
    router.route(
      "/",
      createContractsRouter({
        now: NOW,
        checklists: new InMemoryChecklistStore([KIRA_CHECKLIST]),
        exportExec: async ({ args }) => {
          const outIndex = args.indexOf("--out");
          const outPath = args[outIndex + 1];
          if (outIndex < 0 || outPath === undefined) throw new Error("missing output");
          await writeFile(outPath, Buffer.from([80, 75, 3, 4, 99, 111, 110, 116, 114, 97, 99, 116]));
          return { code: 0, stderr: "" };
        },
      }),
    );
    const response = await router.request("/v1/contracts/review/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: KIRA,
        checklistId: "kira-v1",
        documentTitle: "Kira sözleşmesi (SENTETİK)",
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toContain("Inceleme Raporu.docx");
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
  });

  it("saves a checklist and runs it on a second contract", async () => {
    const router = app();
    const saved = await router.request("/v1/contracts/checklists/ticari-v1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "ticari-v1",
        title: "Ticari sözleşme listesi",
        items: [{ id: "gizlilik", label: "Gizlilik", terms: ["gizlilik"] }],
      }),
    });
    expect(saved.status).toBe(200);
    const listed = await router.request("/v1/contracts/checklists");
    const body = (await listed.json()) as { checklists: { id: string }[] };
    expect(body.checklists.map((c) => c.id)).toContain("ticari-v1");

    const review = await router.request("/v1/contracts/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "MADDE 1 - Taraflar gizlilik yükümlülüğü altındadır.",
        checklistId: "ticari-v1",
      }),
    });
    expect(review.status).toBe(200);
    const report = (await review.json()) as { findings: { state: string }[] };
    expect(report.findings[0]?.state).toBe("VAR");
  });
});
