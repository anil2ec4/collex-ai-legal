/**
 * W17 — what a REAL cevap dilekçesi did to the petition analysis.
 *
 * Every case in this file is a defect that was MEASURED on 06.09.2026 by
 * posting an actual Turkish eser-sözleşmesi/ayıp cevap dilekçesi to a running
 * server (`POST /v1/contracts/petition-analysis`, `collex_demo`), not one
 * imagined at a desk. The synthetic fixture in `petitionAnalysis.test.ts`
 * passed every one of these while the real document failed them, because the
 * fixture writes each heading on a line of its own and the real petition does
 * not.
 *
 * The petition is reproduced here in the shape that mattered — labelled fields
 * and inline headings — and shortened. It is SENTETİK: the parties, the file
 * number and the decision are invented, and no number in it is legal fact.
 */

import { describe, expect, it } from "vitest";
import {
  CONTRARY_NOT_AN_ASSERTION_TR,
  CONTRARY_TIME_BUDGET_MS,
  CONTRARY_TIME_BUDGET_TR,
  analyzePetition,
  documentContraryTerm,
  extractClaims,
  isPreambleLine,
  type ContrarySearchPort,
} from "../../src/contracts/petitionAnalysis.js";
import {
  extractAuditCitations,
  pairArticlesWithTheirLaw,
} from "../../src/contracts/citationAudit.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";

const ASOF = "2026-03-01";

/** The real document's shape: labelled fields, inline closing headings. */
const CEVAP = [
  "İZMİR 5. ASLİYE HUKUK MAHKEMESİ'NE",
  "",
  "DOSYA NO : 2026/418 Esas",
  "",
  "DAVALI : Yılmaz İnşaat ve Ticaret A.Ş.",
  "VEKİLİ : Av. Selin Aydın - İzmir Barosu Sicil No: 21874",
  "DAVACI : Ahmet Kaya",
  "KONU : Davacının 12.02.2026 tarihli dava dilekçesine karşı cevaplarımızın" +
    " sunulmasından ibarettir.",
  "",
  "AÇIKLAMALAR",
  "",
  "1. Davacı, müvekkil şirket ile arasında 14.03.2024 tarihinde imzalanan eser" +
    " sözleşmesi uyarınca teslim edilen dairede ayıp bulunduğunu ileri sürmekte" +
    " ve TBK m. 475 uyarınca bedelden indirim talep etmektedir.",
  "",
  "2. Öncelikle belirtmek gerekir ki davacı, TBK m. 474 uyarınca eseri teslim" +
    " aldıktan sonra gözden geçirme ve ayıpları bildirme yükümlülüğünü hiç" +
    " yerine getirmemiştir. Bu süre, TTK m. 23/1-c anlamında derhal bildirim" +
    " ölçütünü açıkça aşmaktadır.",
  "",
  "3. Kaldı ki dava konusu eksiklikler, taraflar arasında imzalanan 20.09.2024" +
    " tarihli teslim tutanağında hiç yer almamaktadır.",
  "",
  "4. Davacının talep ettiği bedel fahiştir ve hiçbir teknik dayanağı yoktur.",
  "",
  "HUKUKÎ SEBEPLER : TBK m. 474, TBK m. 475, TTK m. 23, HMK m. 119, HMK m. 129" +
    " ve ilgili sair mevzuat.",
  "",
  "DELİLLER : 14.03.2024 tarihli eser sözleşmesi, 20.09.2024 tarihli teslim" +
    " tutanağı, bilirkişi incelemesi, tanık beyanları ve her türlü yasal delil.",
  "",
  "SONUÇ VE İSTEM : Yukarıda açıklanan nedenlerle davanın reddine, yargılama" +
    " giderleri ile vekâlet ücretinin davacı üzerinde bırakılmasına karar" +
    " verilmesini vekâleten arz ve talep ederiz.",
  "",
  "Davalı Vekili",
  "Av. Selin Aydın",
].join("\n");

// ---------------------------------------------------------------------------
// D-5 — a labelled field is not a claim, however long its content
// ---------------------------------------------------------------------------

describe("W17 · the preamble stops at the colon, not at 90 characters", () => {
  it("treats a long KONU field as preamble", () => {
    const line =
      "KONU : Davacının 12.02.2026 tarihli dava dilekçesine karşı" +
      " cevaplarımızın sunulmasından ibarettir.";
    // NON-VACUITY: the very length that used to defeat the check.
    expect(line.length).toBeGreaterThan(90);
    expect(isPreambleLine(line)).toBe(true);
  });

  it("still refuses a long line whose label is not a preamble field", () => {
    const line =
      "Sonuç olarak şunu belirtmek gerekir ki: davacının bütün iddiaları" +
      " dosya kapsamındaki delillerle açıkça çelişmektedir ve reddi gerekir.";
    expect(line.length).toBeGreaterThan(90);
    expect(isPreambleLine(line)).toBe(false);
  });

  it("the KONU field never becomes a claim", () => {
    const texts = extractClaims(CEVAP).map((claim) => claim.text);
    expect(texts.some((text) => text.startsWith("KONU"))).toBe(false);
    expect(texts.some((text) => text.includes("sunulmasından ibarettir"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The closing signature block
// ---------------------------------------------------------------------------

describe("W17 · the signature block is not a claim", () => {
  it("drops the role line and the lawyer's name", () => {
    const texts = extractClaims(CEVAP).map((claim) => claim.text);
    expect(texts.some((text) => text.includes("Av. Selin Aydın"))).toBe(false);
    expect(texts.some((text) => text.includes("Davalı Vekili"))).toBe(false);
  });

  it("does not swallow a sentence that merely mentions a vekil", () => {
    expect(
      isPreambleLine("Davalı vekili duruşmada bu beyanı açıkça geri almıştır."),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D-6 — a heading written on the same line as its content
// ---------------------------------------------------------------------------

describe("W17 · inline headings are headings", () => {
  const claims = extractClaims(CEVAP);

  it("files the closing sections under their own headings", () => {
    const byHeading = new Map(claims.map((claim) => [claim.heading, claim]));
    expect([...byHeading.keys()]).toContain("HUKUKÎ SEBEPLER");
    expect([...byHeading.keys()]).toContain("DELİLLER");
    expect([...byHeading.keys()]).toContain("SONUÇ VE İSTEM");
    // NON-VACUITY: before this fix all three sat under the heading the
    // document had left three sections earlier.
    expect(byHeading.get("HUKUKÎ SEBEPLER")?.heading).not.toBe("AÇIKLAMALAR");
  });

  it("gives each closing section the kind its heading declares", () => {
    const kindOf = (heading: string): string | undefined =>
      claims.find((claim) => claim.heading === heading)?.kind;
    expect(kindOf("HUKUKÎ SEBEPLER")).toBe("HUKUKI_SEBEP");
    expect(kindOf("DELİLLER")).toBe("DIGER");
    expect(kindOf("SONUÇ VE İSTEM")).toBe("TALEP");
  });

  it("keeps the content of the heading line as the claim's text", () => {
    const grounds = claims.find((claim) => claim.heading === "HUKUKÎ SEBEPLER");
    // The statutes a Turkish petition lists here must not be thrown away with
    // the label.
    expect(grounds?.text).toContain("TBK m. 474");
    expect(grounds?.text).toContain("HMK m. 129");
    expect(grounds?.text.startsWith("HUKUKÎ SEBEPLER")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D-7 — under a generic heading the paragraph's own citation decides
// ---------------------------------------------------------------------------

describe("W17 · a paragraph that cites an article is a legal claim", () => {
  const claims = extractClaims(CEVAP);
  const numbered = (n: string) => claims.find((claim) => claim.number === n);

  it("labels a cited paragraph HUKUKI_SEBEP even under AÇIKLAMALAR", () => {
    expect(numbered("2")?.heading).toBe("AÇIKLAMALAR");
    expect(numbered("2")?.kind).toBe("HUKUKI_SEBEP");
  });

  it("leaves an uncited narrative paragraph a vakıa", () => {
    expect(numbered("3")?.heading).toBe("AÇIKLAMALAR");
    expect(numbered("3")?.kind).toBe("VAKIA");
    expect(numbered("4")?.kind).toBe("VAKIA");
  });
});

// ---------------------------------------------------------------------------
// D-4 — the bare abbreviation must not survive as a second citation
// ---------------------------------------------------------------------------

describe("W17 · 'TBK m. 475' is ONE citation", () => {
  it("pairs the abbreviation with its article and drops the law row", () => {
    const paired = pairArticlesWithTheirLaw(parseReferences("TBK m. 475 uyarınca"));
    expect(paired).toHaveLength(1);
    expect(paired[0]?.raw).toBe("TBK m. 475");
    expect(paired[0]?.legislationNo).toBe("6098");
  });

  it("leaves no bare-statute row in the real petition's citation list", () => {
    const raws = extractAuditCitations(CEVAP).map((citation) => citation.raw);
    // MEASURED: the surviving "TBK" row was resolved to the statute's FIRST
    // article and printed "bulundu — … m. 1" for a document that said m. 475.
    expect(raws).not.toContain("TBK");
    expect(raws).not.toContain("TTK");
    expect(raws).not.toContain("HMK");
    expect(raws).toContain("TBK m. 475");
    expect(raws).toContain("HMK m. 129");
  });

  it("never shows an article without the statute it belongs to", () => {
    for (const raw of extractAuditCitations(CEVAP).map((c) => c.raw)) {
      if (raw.startsWith("m. ")) {
        throw new Error(`bare article row leaked into the report: ${raw}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D-8 — the contrary phase has a clock, and it reports the cut
// ---------------------------------------------------------------------------

describe("W17 · the contrary phase is bounded by wall clock", () => {
  /** A search port that never finds anything and costs nothing. */
  const emptySearch: ContrarySearchPort = async () => [];

  it("runs the first lane and then reports the rest as ÇALIŞTIRILMADI", async () => {
    let clock = 0;
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: emptySearch,
        // Every read of the clock advances it past the budget.
        monotonic: () => (clock += CONTRARY_TIME_BUDGET_MS),
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    const lanes = report.claims.flatMap((claim) => claim.contrary.lanes);
    expect(lanes.length).toBeGreaterThan(1);
    // NON-VACUITY: at least one lane still ran — a budget that searches
    // nothing at all is a different bug.
    expect(lanes.some((lane) => lane.state === "ARANDI_BULUNAMADI")).toBe(true);
    const cut = lanes.filter((lane) => lane.reason === CONTRARY_TIME_BUDGET_TR);
    expect(cut.length).toBeGreaterThan(0);
    for (const lane of cut) expect(lane.state).toBe("CALISTIRILMADI");
  });

  it("cuts nothing when the clock stands still", async () => {
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: emptySearch,
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    const lanes = report.claims.flatMap((claim) => claim.contrary.lanes);
    expect(lanes.some((lane) => lane.reason === CONTRARY_TIME_BUDGET_TR)).toBe(false);
  });

  it("says what the cut means, and never that nothing was found", () => {
    expect(CONTRARY_TIME_BUDGET_TR).toContain("çalıştırılmadı");
    expect(CONTRARY_TIME_BUDGET_TR).toContain("raporda YOK");
    expect(CONTRARY_TIME_BUDGET_TR).not.toContain("bulunamadı");
  });
});

// ---------------------------------------------------------------------------
// A list of documents is not a proposition
// ---------------------------------------------------------------------------

describe("W17 · the DELİLLER list gets no contrary search", () => {
  it("builds no lane and says why", async () => {
    let calls = 0;
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: async () => {
          calls += 1;
          return [];
        },
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    const list = report.claims.find((entry) => entry.claim.heading === "DELİLLER");
    expect(list?.claim.kind).toBe("DIGER");
    expect(list?.contrary.lanes).toEqual([]);
    expect(list?.contrary.note).toBe(CONTRARY_NOT_AN_ASSERTION_TR);
    // NON-VACUITY: the other claims DID search, so this is a targeted skip and
    // not a dead contrary phase.
    expect(calls).toBeGreaterThan(0);
  });

  it("never reads the skip as an absence of contrary authority", () => {
    expect(CONTRARY_NOT_AN_ASSERTION_TR).toContain("yapılmadı");
    expect(CONTRARY_NOT_AN_ASSERTION_TR).not.toContain("bulunamadı");
  });
});

// ---------------------------------------------------------------------------
// A request and a list carry no unsourced statement
// ---------------------------------------------------------------------------

describe("W17 · KAYNAKSIZ fires only on something that could be sourced", () => {
  it("leaves SONUÇ VE İSTEM and DELİLLER alone", async () => {
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      { monotonic: () => 0, now: () => new Date("2026-03-02T09:00:00.000Z") },
    );
    const kindOf = (heading: string) =>
      report.claims.find((entry) => entry.claim.heading === heading);
    expect(kindOf("SONUÇ VE İSTEM")?.unsourced).toEqual([]);
    expect(kindOf("DELİLLER")?.unsourced).toEqual([]);
    // NON-VACUITY: the argumentative paragraphs still produce findings, so this
    // is a targeted exemption and not a disabled check.
    const argued = report.claims
      .filter((entry) => entry.claim.kind === "VAKIA" || entry.claim.kind === "HUKUKI_SEBEP")
      .reduce((sum, entry) => sum + entry.unsourced.length, 0);
    expect(argued).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The same decision is not printed twice under one claim
// ---------------------------------------------------------------------------

describe("W17 · lanes of one claim do not repeat each other's decisions", () => {
  /** Both lanes of a claim answer with the SAME two decisions. */
  const twinSearch: ContrarySearchPort = async () => [
    { kunye: "Yargıtay 15. Hukuk Dairesi E. 2019/2145 K. 2020/1877" },
    { kunye: "Yargıtay 15. Hukuk Dairesi E. 2018/900 K. 2019/1200" },
  ];

  it("lists each decision once and says why the second lane shows none", async () => {
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: twinSearch,
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    for (const entry of report.claims) {
      const lanes = entry.contrary.lanes.filter((lane) => lane.state === "BULUNDU");
      if (lanes.length < 2) continue;
      const kunye = lanes.flatMap((lane) => lane.hits.map((hit) => hit.kunye));
      expect(new Set(kunye).size).toBe(kunye.length);
      // The later lane keeps its honest state and explains the empty list.
      const later = lanes[1];
      expect(later?.state).toBe("BULUNDU");
      expect(later?.hits).toEqual([]);
      expect(later?.reason).toContain("zaten listelendi");
      expect(later?.reason).not.toContain("bulunamadı");
      return;
    }
    throw new Error("fixture produced no claim with two BULUNDU lanes");
  });
});

// ---------------------------------------------------------------------------
// A claim that names no institution borrows the document's, and says so
// ---------------------------------------------------------------------------

describe("W17 · the document is the fallback subject", () => {
  it("searches for a paragraph that names nothing, and labels the borrowing", async () => {
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: async () => [],
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    // Paragraph 3 is pure narrative — no statute, no institution of its own.
    const narrative = report.claims.find((entry) => entry.claim.number === "3");
    expect(narrative?.contrary.baseTerm).toBe("eser sözleşmesi");
    expect(narrative?.contrary.lanes.length).toBeGreaterThan(0);
    expect(narrative?.contrary.note).toContain("dilekçenin tamamından");
    expect(narrative?.contrary.note).toContain("birebir");

    // A claim that DID name its own institution says nothing of the sort.
    const own = report.claims.find((entry) => entry.claim.number === "1");
    expect(own?.contrary.baseTerm).toBe("eser sözleşmesi");
    expect(own?.contrary.note).toBe("");
  });

  it("never borrows for a request or a document list", async () => {
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: async () => [],
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    const talep = report.claims.find((entry) => entry.claim.kind === "TALEP");
    const list = report.claims.find((entry) => entry.claim.kind === "DIGER");
    expect(talep?.contrary.baseTerm).toBe("");
    expect(list?.contrary.baseTerm).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The document's subject is one it actually writes down
// ---------------------------------------------------------------------------

describe("W17 · documentContraryTerm", () => {
  it("answers the institution the petition repeats, not one its tokens can spell", () => {
    // MEASURED: running the claim-level term extractor over the WHOLE document
    // answered "ihbar tazminatı" — an employment institution — for this
    // construction-defect file, because "bildirim" sits in one paragraph and
    // "tazminat" in another.
    expect(documentContraryTerm(CEVAP)).toBe("eser sözleşmesi");
  });

  it("refuses a term the document never writes", () => {
    const term = documentContraryTerm(CEVAP);
    expect(CEVAP.toLocaleLowerCase("tr-TR")).toContain(term.toLocaleLowerCase("tr-TR"));
    expect(term).not.toBe("ihbar tazminatı");
  });

  it("prefers the term the document repeats most", () => {
    const text =
      "Taraflar arasındaki kira sözleşmesi uyarınca kira bedeli ödenmemiştir." +
      " Kira ilişkisi devam etmektedir. Ayrıca manevi tazminat talep edilmiştir.";
    // "kira" occurs three times, "manevi tazminat" once.
    expect(documentContraryTerm(text)).toBe("kira");
  });

  it("answers empty for a document that names no institution at all", () => {
    expect(documentContraryTerm("Bu bir yazıdır. İki cümleden ibarettir.")).toBe("");
    expect(documentContraryTerm("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// One upstream call per distinct query
// ---------------------------------------------------------------------------

describe("W17 · the same query is never sent twice in one report", () => {
  it("serves every repeat of a query from the first answer", async () => {
    const sent: string[] = [];
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: async (lane) => {
          sent.push(lane.query);
          return [{ kunye: "Yargıtay 15. HD E. 2019/2145 K. 2020/1877" }];
        },
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    const built = report.claims.flatMap((entry) =>
      entry.contrary.lanes.map((lane) => lane.query),
    );
    // NON-VACUITY: the document term really is borrowed by several claims, so
    // there ARE repeats to collapse.
    expect(built.length).toBeGreaterThan(sent.length);
    expect(sent.length).toBe(new Set(sent).size);
    expect(new Set(sent)).toEqual(new Set(built));
  });

  it("keeps a repeated query out of the run budget", async () => {
    const sent: string[] = [];
    const report = await analyzePetition(
      { text: CEVAP, asOf: ASOF },
      {
        contrarySearch: async (lane) => {
          sent.push(lane.query);
          return [];
        },
        maxContraryLaneRuns: 2,
        monotonic: () => 0,
        now: () => new Date("2026-03-02T09:00:00.000Z"),
      },
    );
    expect(sent.length).toBeLessThanOrEqual(2);
    const answered = report.claims
      .flatMap((entry) => entry.contrary.lanes)
      .filter((lane) => lane.state !== "CALISTIRILMADI");
    // More lanes were answered than searches were paid for.
    expect(answered.length).toBeGreaterThan(sent.length);
  });
});
