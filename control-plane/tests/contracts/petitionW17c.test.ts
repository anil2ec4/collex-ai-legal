/**
 * W17/c — nine realistic petitions met the karşı dilekçe analizi.
 *
 * An investigator wrote nine petitions in the shapes Turkish practice
 * actually uses (iş davası, kira/tahliye, itirazın iptali, ceza istinafı,
 * idari dava, cevap dilekçesi, ceza savunması, and two stress shapes: hard
 * line wraps and look-alike article numbers) and posted them to a running
 * server. Every case below is a defect measured there. The fixtures are
 * trimmed excerpts; the parties, numbers and decisions are SENTETİK — only
 * the SHAPE is real, and the shape is the only thing a parser reads.
 */

import { describe, expect, it } from "vitest";
import {
  CONTRARY_LANE_LABEL_TR,
  NO_CONTRARY_BASE_TERM_TR,
  analyzePetition,
  contraryBaseTerm,
  documentContraryTerm,
  extractClaims,
  isDocumentListHeading,
  isPreambleLine,
  stripEvaluativeWords,
  EVALUATIVE_WORD_PLACEHOLDER,
  type ContrarySearchPort,
} from "../../src/contracts/petitionAnalysis.js";
import {
  auditCitations,
  extractAuditCitations,
  pairArticlesWithTheirLaw,
  type CitationResolver,
} from "../../src/contracts/citationAudit.js";
import { createContractsRouter } from "../../src/contracts/routes.js";
import { createCorpusCitationResolver } from "../../src/contracts/corpusResolver.js";
import { parseReferences } from "../../src/retrieval/referenceParser.js";
import { decisionCourtVerdict } from "../../src/store/chunkStore.js";

const ASOF = "2025-03-01";
const NOW = () => new Date("2025-03-02T09:00:00.000Z");
const quiet = { now: NOW, monotonic: () => 0 };
const emptySearch: ContrarySearchPort = async () => [];

/** Rows attributed to the claim whose text contains `marker`. */
async function claimOf(text: string, marker: string) {
  const report = await analyzePetition({ text, asOf: ASOF }, { ...quiet, contrarySearch: emptySearch });
  const claim = report.claims.find((entry) => entry.claim.text.includes(marker));
  if (claim === undefined) throw new Error(`no claim containing ${marker}`);
  return { report, claim };
}

// ---------------------------------------------------------------------------
// 1 — the most common statute form is attributed to its own claim
// ---------------------------------------------------------------------------

const KIRA_3 = [
  "AÇIKLAMALAR :",
  "",
  "3-) Davalıya verilen 30 günlük süre içinde kira borcu ödenmemiştir. 6098 sayılı Türk" +
    " Borçlar Kanunu'nun 315. maddesi uyarınca kiracının kira bedelini ödememesi hâlinde" +
    " kiraya veren sözleşmeyi feshedebilir.",
].join("\n");

const CEZA_1 = [
  "İSTİNAF SEBEPLERİMİZ :",
  "",
  "1. Sanığa isnat edilen suçun unsurları oluşmamıştır. 5237 sayılı TCK'nın 158/1-f" +
    " maddesinde düzenlenen suçun oluşabilmesi için bilişim sisteminin araç olarak" +
    " kullanılması gerekir.",
].join("\n");

describe("W17/c #1 · a statute cited in the document's own words belongs to its claim", () => {
  it("records the VERBATIM citation, not a join of two parser fragments", () => {
    const raws = extractAuditCitations(KIRA_3).flatMap((c) => c.rawForms ?? [c.raw]);
    expect(raws).toContain("6098 sayılı Türk Borçlar Kanunu'nun 315. maddesi");
    // The old spelling — never written by the document — is gone.
    expect(raws).not.toContain("6098 sayılı Türk Borçlar Kanunu 315. maddesi");
    const ceza = extractAuditCitations(CEZA_1).flatMap((c) => c.rawForms ?? [c.raw]);
    expect(ceza).toContain("5237 sayılı TCK'nın 158/1-f maddesinde");
  });

  it("attributes the row to the claim and does NOT mark its citing sentence KAYNAKSIZ", async () => {
    for (const [text, marker, sentence] of [
      [KIRA_3, "3-)", "315. maddesi uyarınca"],
      [CEZA_1, "1.", "158/1-f"],
    ] as const) {
      const { claim } = await claimOf(text, marker);
      expect(claim.citations.length, text).toBe(1);
      expect(claim.unsourced.some((finding) => finding.alinti.includes(sentence))).toBe(false);
      // NON-VACUITY: the claim's uncited opening sentence IS still flagged.
      expect(claim.unsourced.length).toBe(1);
    }
  });

  it("binds a citation to a sentence by POSITION even across a hard line wrap", async () => {
    const text = [
      "AÇIKLAMALAR :",
      "2- Davacının talebi hukuken dinlenemez. 6098 sayılı Türk Borçlar",
      "Kanunu'nun 344. maddesi uyarınca yeni kira bedeli hâkimce belirlenir.",
    ].join("\n");
    const { claim } = await claimOf(text, "2-");
    expect(claim.citations.map((row) => row.raw)).toEqual([
      "6098 sayılı Türk Borçlar Kanunu'nun 344. maddesi",
    ]);
    expect(claim.unsourced.map((finding) => finding.sentenceIndex)).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// 2 — an article is paired with a statute only when it is really its article
// ---------------------------------------------------------------------------

describe("W17/c #2 · no invented statute–article pairing", () => {
  it("never pairs a contract clause with the statute of an earlier sentence", () => {
    const text =
      "Kiracının borcu asli edimdir (TBK m. 313). Ayrıca kira sözleşmesinin 8. maddesi" +
      " gereğince gecikme cezası kararlaştırılmıştır.";
    const articles = extractAuditCitations(text).map((c) => c.parsed?.articleNo);
    expect(articles).toEqual(["313"]);
  });

  it("never pairs across a sentence, nor over a long gap", () => {
    expect(
      extractAuditCitations("TBK m. 344 uyarınca bedel belirlenir. Şartname 12. maddesinde açıktır.")
        .map((c) => c.parsed?.articleNo),
    ).toEqual(["344"]);
    const far =
      "6098 sayılı Kanun ile düzenlenen ve uygulamada çok tartışılan yenileme kurumunun" +
      " 5. maddesi";
    expect(extractAuditCitations(far).map((c) => c.raw)).toEqual(["6098 sayılı Kanun"]);
  });

  it("'7445 s. K.' is a statute: its article is not handed to the previous law", () => {
    const rows = extractAuditCitations("TBK m. 344 ile birlikte 7445 s. K. m. 3 uygulanır.");
    const keys = rows.map((c) => `${c.parsed?.legislationNo}/${c.parsed?.articleNo ?? ""}`);
    expect(keys).toEqual(["6098/344", "7445/3"]);
    expect(keys).not.toContain("6098/3");
  });

  it("NON-VACUITY: the ordinary adjacent forms still pair", () => {
    const paired = pairArticlesWithTheirLaw(
      parseReferences("6098 sayılı Kanun m. 299 ile 5237 sayılı Kanun m. 157"),
      "6098 sayılı Kanun m. 299 ile 5237 sayılı Kanun m. 157",
    );
    expect(paired.map((r) => `${r.legislationNo}/${r.articleNo ?? ""}`)).toEqual([
      "6098/299",
      "5237/157",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3 — a partial outage is not "arandı, bulunamadı"
// ---------------------------------------------------------------------------

describe("W17/c #3 · a source that did not answer is named, never read as 'no result'", () => {
  const SAVUNMA = [
    "AÇIKLAMALAR",
    "1. Sanığın eylemi TCK m. 157 kapsamında dolandırıcılık suçunu oluşturmaz.",
  ].join("\n");

  it("no row + a failed source = ARAMA_BASARISIZ naming the source", async () => {
    const report = await analyzePetition(
      { text: SAVUNMA, asOf: ASOF },
      { ...quiet, contrarySearch: async () => ({ hits: [], failedSources: ["Yargıtay"] }) },
    );
    const lanes = report.claims.flatMap((claim) => claim.contrary.lanes);
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(lane.state).toBe("ARAMA_BASARISIZ");
      expect(lane.stateLabel).toBe(CONTRARY_LANE_LABEL_TR.ARAMA_BASARISIZ);
      expect(lane.reason).toContain("Yargıtay");
    }
  });

  it("rows from the sources that answered are kept, and the missing source is named", async () => {
    const report = await analyzePetition(
      { text: SAVUNMA, asOf: ASOF },
      {
        ...quiet,
        contrarySearch: async () => ({
          hits: [{ kunye: "Danıştay 1. D. E. 2020/1 K. 2020/2 (SENTETİK)" }],
          failedSources: ["Yargıtay"],
        }),
      },
    );
    const first = report.claims.flatMap((claim) => claim.contrary.lanes)[0];
    expect(first?.state).toBe("BULUNDU");
    expect(first?.reason).toContain("Yargıtay");
  });
});

// ---------------------------------------------------------------------------
// 4 — a decision is identified by its court too
// ---------------------------------------------------------------------------

describe("W17/c #4 · a decision's court is part of its identity", () => {
  it("keeps the court when a date sits between the court and the docket", () => {
    for (const text of [
      "Yargıtay 9. HD'nin 12.03.2021 tarih ve 2020/1111 E., 2021/2222 K. sayılı ilamı",
      "Y.9.HD. 12.03.2021 T. 2020/1111 E. 2021/2222 K. sayılı kararında",
    ]) {
      const decision = parseReferences(text).find((r) => r.kind === "court_decision");
      expect(decision?.court, text).toBe("YARGITAY");
      expect(decision?.chamber, text).toBe("9. HD");
    }
    expect(parseReferences("Dn. 10. D. E. 2019/5555 K. 2021/6666")[0]?.court).toBe("DANISTAY");
    expect(parseReferences("YHGK 2014/22-1234 E., 2016/789 K.")[0]?.chamber).toBe("HGK");
  });

  it("a stored decision of another court never matches", () => {
    const danistay = parseReferences("Danıştay 10. D. 2023/4521 E., 2024/1187 K.")[0]!;
    expect(decisionCourtVerdict(danistay, "Yargıtay", "15. Ceza Dairesi")).toBe("mismatch");
    const yargitay = parseReferences("Yargıtay 15. CD 2023/4521 E., 2024/1187 K.")[0]!;
    expect(decisionCourtVerdict(yargitay, "Yargıtay", "15. Ceza Dairesi")).toBe("match");
    expect(decisionCourtVerdict(yargitay, "Yargıtay", "3. Hukuk Dairesi")).toBe("mismatch");
  });

  it("the audit never looks a decision up without its court, and never as 'found'", async () => {
    const asked: unknown[] = [];
    const resolve = createCorpusCitationResolver({
      lookup: async (references, options) => {
        asked.push({ references, options });
        return [];
      },
    });
    const bare = parseReferences("E. 2023/4521, K. 2024/1187")[0]!;
    const out = await resolve({ raw: bare.raw, count: 1, parsed: bare }, ASOF);
    expect(out?.kunye).toBeUndefined();
    expect(out?.uncertainReason ?? "").toContain("hangi mahkemeye ait");
    expect(asked).toEqual([]);
    // With a court the lookup runs, and it demands the court to match.
    const named = parseReferences("Yargıtay 15. CD E. 2023/4521, K. 2024/1187")[0]!;
    await resolve({ raw: named.raw, count: 1, parsed: named }, ASOF);
    expect(asked).toHaveLength(1);
    expect((asked[0] as { options: { requireCourtMatch?: boolean } }).options.requireCourtMatch).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 5 — a request reported by someone else is not the petition's request
// ---------------------------------------------------------------------------

const SAVUNMA_P7 = [
  "ESAS HAKKINDAKİ MÜTALAAYA KARŞI SAVUNMALARIMIZ",
  "",
  "1- Cumhuriyet savcısı, mütalaasında sanığın TCK m. 142/1-b uyarınca nitelikli hırsızlık" +
    " suçundan cezalandırılmasına karar verilmesini istemiştir. Oysa olay günü sanık," +
    " işyerinden hiç ayrılmamıştır." +
    " Kamera kayıtları bunu açıkça göstermektedir.",
  "",
  "SONUÇ VE TALEP : Sanığın BERAATİNE karar verilmesini saygılarımızla arz ve talep ederiz.",
].join("\n");

describe("W17/c #5 · TALEP is the petition's OWN closing request", () => {
  it("a ground that REPORTS the prosecutor's request is still a ground", async () => {
    const { claim } = await claimOf(SAVUNMA_P7, "Cumhuriyet savcısı");
    expect(claim.claim.kind).not.toBe("TALEP");
    // …so it is scanned and searched like every other ground.
    expect(claim.unsourced.map((finding) => finding.alinti)).toContain(
      "Oysa olay günü sanık, işyerinden hiç ayrılmamıştır.",
    );
    expect(claim.contrary.baseTerm).toBe("hırsızlık");
    expect(claim.contrary.lanes.length).toBeGreaterThan(0);
  });

  it("the real request is TALEP, and its card says WHY no search ran", async () => {
    const { claim } = await claimOf(SAVUNMA_P7, "BERAATİNE");
    expect(claim.claim.kind).toBe("TALEP");
    expect(claim.contrary.lanes).toEqual([]);
    // It used to say no legal concept could be recognised — a false reason.
    expect(claim.contrary.note).not.toBe(NO_CONTRARY_BASE_TERM_TR);
    expect(claim.contrary.note).toContain("talebi");
  });
});

// ---------------------------------------------------------------------------
// 6 — the petition's structure: headings, lists, preamble, signature
// ---------------------------------------------------------------------------

describe("W17/c #6 · the closed lists know the forms petitions use", () => {
  it("recognises the headings the old table missed", () => {
    for (const heading of [
      "SONUÇ VE TALEP",
      "SONUÇ VE TALEPLERİMİZ",
      "TALEP SONUCU",
      "HUKUKİ DEĞERLENDİRME",
      "HUKUKİ SEBEP",
      "YASAL NEDENLER",
      "USULE İLİŞKİN İTİRAZLARIMIZ",
      "ESASA İLİŞKİN CEVAPLARIMIZ",
      "İSTİNAF NEDENLERİ",
      "TEMYİZ NEDENLERİ",
      "OLAYLARIN ÖZETİ",
      "DELİLLERİMİZ",
      "EK LİSTESİ",
    ]) {
      const claims = extractClaims(`${heading}:\n\n1- Davacı bu başlık altında bir cümle yazmıştır.`);
      expect(claims.map((claim) => claim.heading), heading).toEqual([`${heading}:`]);
    }
  });

  it("folds the ASCII capital I a keyboard without Turkish letters types", () => {
    const claims = extractClaims(
      [
        "HUKUKI SEBEPLER : TBK m. 344.",
        "DELILLER : Kira sözleşmesi.",
        "SONUC VE ISTEM : Davanın reddine karar verilmesini talep ederiz.",
      ].join("\n"),
    );
    expect(claims.map((claim) => claim.kind)).toEqual(["HUKUKI_SEBEP", "DIGER", "TALEP"]);
    expect(isDocumentListHeading("DELILLER")).toBe(true);
    expect(isPreambleLine("VEKILI : Av. Gülşen TAŞ")).toBe(true);
  });

  it("EKLER is a document list, not a label that orphans its items", async () => {
    const text = [
      "SONUÇ VE TALEP : Davanın reddine karar verilmesini saygıyla arz ederim.",
      "EKLER : 1- Vekâletname",
      "2- Kira sözleşmesi",
    ].join("\n");
    const report = await analyzePetition({ text, asOf: ASOF }, quiet);
    const items = report.claims.filter((entry) => entry.claim.text.includes("sözleşmesi"));
    expect(items).toHaveLength(1);
    expect(items[0]?.claim.kind).not.toBe("TALEP");
    expect(isDocumentListHeading(items[0]?.claim.heading ?? "")).toBe(true);
  });

  it("keeps preamble labels, addresses, titles and e-signatures out of the claims", () => {
    const text = [
      "YÜRÜTMENİN DURDURULMASI TALEPLİDİR",
      "",
      "İSTANBUL BÖLGE ADLİYE MAHKEMESİ",
      "İLGİLİ CEZA DAİRESİ BAŞKANLIĞI'NA",
      "                 Gönderilmek Üzere",
      "",
      "DAVACI\t\t: Mehmet KARACA",
      "\t\t  Atatürk Mah. Gül Sok. No: 5/3 Ümraniye/İSTANBUL",
      "ARABULUCULUK\t: İstanbul Arabuluculuk Bürosu 2025/48213",
      "SUÇ : Nitelikli dolandırıcılık",
      "HÜKÜM TARİHİ : 14.11.2024",
      "CEVAP VEREN DAVALI : Hüseyin ERDEM",
      "DAVANIN ÖZETİ : İşlemin iptali talebidir.",
      "KARŞI DAVACI : Sentetik A.Ş.",
      "VERGİ NO : 1234567890",
      "",
      "AÇIKLAMALAR",
      "",
      "1. Müvekkil davalı şirkette çalışmıştır.",
      "",
      "20.02.2025",
      "Davacı Vekili",
      "Av. Zeynep ÖZTÜRK",
      "(e-imzalıdır)",
      "e-imza",
      "Saygılarımızla,",
      "Davacı Vekili Av. Zeynep ÖZTÜRK",
    ].join("\n");
    expect(extractClaims(text).map((claim) => claim.text)).toEqual([
      "1. Müvekkil davalı şirkette çalışmıştır.",
    ]);
    // NON-VACUITY: a sentence that merely mentions a vekil is still a claim,
    // and a nominative court name BELOW the preamble is still text.
    expect(isPreambleLine("Davalı vekili duruşmada bu beyanı açıkça geri almıştır.")).toBe(false);
    expect(
      extractClaims("AÇIKLAMALAR\n\n1. Görevli yer\n\nİSTANBUL BÖLGE ADLİYE MAHKEMESİ").map(
        (claim) => claim.text,
      ),
    ).toEqual(["1. Görevli yer", "İSTANBUL BÖLGE ADLİYE MAHKEMESİ"]);
  });
});

// ---------------------------------------------------------------------------
// 7 — a hard line wrap does not open a claim
// ---------------------------------------------------------------------------

describe("W17/c #7 · claim markers only where a claim can begin", () => {
  const WRAP = [
    "AÇIKLAMALAR :",
    "1- Davacı ile müvekkil arasında konut kira sözleşmesi bulunmaktadır.",
    "2- Davacının tespit talebi hukuken dinlenemez. Nitekim Yargıtay",
    "3. Hukuk Dairesi'nin 2022/7788 E., 2023/1122 K. sayılı ilamında bu belirtilmiştir." +
      " Ayrıca 6098 sayılı Kanun'un",
    "344. maddesi uyarınca yeni bedel TÜFE ortalamasını geçemez.",
    "3- Davalı, kira bedelini her ay düzenli olarak ödemiştir.",
  ].join("\n");

  it("reads a wrapped number as the text it is", () => {
    const claims = extractClaims(WRAP);
    expect(claims.map((claim) => claim.number)).toEqual(["1", "2", "3"]);
    expect(claims[1]?.text).toContain("Yargıtay 3. Hukuk Dairesi'nin");
    expect(claims[1]?.text).toContain("Kanun'un 344. maddesi");
  });

  it("splits lettered grounds, keeps the separator required", () => {
    const claims = extractClaims(
      [
        "II. HUKUKİ DEĞERLENDİRME",
        "a) İtirazın iptali davası İİK m. 67 uyarınca bir yıl içinde açılabilir.",
        "b) Faturaya sekiz gün içinde itiraz edilmemiştir (TTK m. 21/2).",
        "c) 14.03.2024 tarihli sözleşme de bunu doğrular.",
      ].join("\n"),
    );
    expect(claims.map((claim) => claim.number)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// 8 — a citation the claim never made is never attached to it
// ---------------------------------------------------------------------------

describe("W17/c #8 · no look-alike article is attached to a claim", () => {
  const SUBSTR = [
    "AÇIKLAMALAR :",
    "",
    "1- Davacı ehliyetsizdir; TBK m. 34 bu konuda açıktır.",
    "",
    "2- Kira bedelinin belirlenmesinde TBK m. 344 uygulanır ve HMK m. 119 uyarınca dilekçe eksiksizdir.",
    "",
    "3- Dava şartları HMK m. 114 kapsamında re'sen incelenir; ayrıca HMK m. 11 yetki kuralı uygulanmaz.",
  ].join("\n");

  it("attaches exactly the articles each claim cites", async () => {
    const report = await analyzePetition({ text: SUBSTR, asOf: ASOF }, quiet);
    expect(report.claims.map((entry) => entry.citations.map((row) => row.raw))).toEqual([
      ["TBK m. 34"],
      ["TBK m. 344", "HMK m. 119"],
      ["HMK m. 114", "HMK m. 11"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 9 — every article of a list is audited
// ---------------------------------------------------------------------------

describe("W17/c #9 · article lists and ranges", () => {
  it("audits every listed article of one statute", () => {
    const keys = (text: string) =>
      extractAuditCitations(text).map((c) => `${c.parsed?.legislationNo}/${c.parsed?.articleNo}`);
    expect(keys("6098 s. TBK m. 299, 313, 315, 347, 350, 352; 2004 s. İİK m. 269 vd.")).toEqual([
      "6098/299",
      "6098/313",
      "6098/315",
      "6098/347",
      "6098/350",
      "6098/352",
      "2004/269",
    ]);
    expect(keys("TBK m. 474 ve 475 uyarınca")).toEqual(["6098/474", "6098/475"]);
    expect(keys("4857 s. K. m. 53-59 hükümleri")).toEqual(["4857/53", "4857/59"]);
    // Only the numbers the document wrote: no invented 54..58.
    expect(keys("4857 s. K. m. 53-59 hükümleri")).not.toContain("4857/54");
  });

  it("recognises the AYM başvuru number written first", () => {
    const decision = parseReferences("Anayasa Mahkemesi'nin 2014/1234 başvuru numaralı kararı")[0];
    expect(decision?.kind).toBe("court_decision");
    expect(decision?.court).toBe("AYM");
    expect(decision?.docketKind).toBe("basvuru");
  });
});

// ---------------------------------------------------------------------------
// 10 — a citations[] body keeps distinct articles distinct
// ---------------------------------------------------------------------------

describe("W17/c #10 · POST citations[] audits the ARTICLE, not the statute", () => {
  it("two articles of one law are two rows, each asked about its article", async () => {
    const asked: string[] = [];
    const resolver: CitationResolver = async (citation) => {
      asked.push(`${citation.parsed?.legislationNo}/${citation.parsed?.articleNo ?? ""}`);
      return {};
    };
    const report = await auditCitations(
      { citations: [{ raw: "TBK m. 344" }, { raw: "TBK m. 315" }], asOf: ASOF },
      resolver,
      { now: NOW },
    );
    expect(report.rows.map((row) => row.raw)).toEqual(["TBK m. 344", "TBK m. 315"]);
    expect(asked).toEqual(["6098/344", "6098/315"]);
  });
});

// ---------------------------------------------------------------------------
// 12 — the smaller honesty defects
// ---------------------------------------------------------------------------

describe("W17/c #12 · smaller defects", () => {
  it("an AYM bireysel başvuru is UNCERTAIN with its own honest sentence", async () => {
    const resolve = createCorpusCitationResolver({ lookup: async () => [] });
    const basvuru = parseReferences("AYM, B. No: 2014/1234")[0]!;
    const out = await resolve({ raw: basvuru.raw, count: 1, parsed: basvuru }, ASOF);
    expect(out?.uncertainReason ?? "").toContain("başvuru numarasıyla");
    expect(out?.uncertainReason ?? "").not.toContain("E./K. bilgisi eksik");
  });

  it("an impossible petition date is a typed 400 in Turkish, before any work", async () => {
    const app = createContractsRouter({ now: NOW });
    for (const path of ["/v1/contracts/petition-analysis", "/v1/citation-audit"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "TBK m. 344 uygulanır.", asOf: "2025-13-45" }),
      });
      expect(res.status, path).toBe(400);
      const body = (await res.json()) as { error: { issues?: { path: string; message: string }[] } };
      const issue = body.error.issues?.find((entry) => entry.path === "asOf");
      expect(issue?.message ?? "").toMatch(/takvim/u);
    }
    // The engines refuse it too, whoever calls them.
    await expect(analyzePetition({ text: "x", asOf: "2025-02-30" })).rejects.toThrow(/takvim/u);
  });

  it("a body that is not an object names the body, in Turkish", async () => {
    const app = createContractsRouter({ now: NOW });
    for (const payload of ['"metin"', "[]", "null"]) {
      const res = await app.request("/v1/contracts/petition-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { issues?: { path: string; message: string }[] } };
      for (const issue of body.error.issues ?? []) {
        expect(issue.path, payload).not.toBe("");
        expect(issue.message).not.toMatch(/Expected|received/u);
      }
      expect((body.error.issues ?? []).length).toBeGreaterThan(0);
    }
  });

  it("'saymak' and 'Kaymakamlığı' are not the Anayasa Mahkemesi", async () => {
    const text = [
      "AÇIKLAMALAR",
      "1. Davacının kira artışını haklı saymak mümkün değildir; sanık Kadıköy Kaymakamlığı'nda" +
        " görevlidir.",
    ].join("\n");
    const { claim } = await claimOf(text, "saymak");
    expect(claim.contrary.flavor).toBe("general");
    // NON-VACUITY: the court itself still switches the flavour.
    const aym = await claimOf(
      ["AÇIKLAMALAR", "1. AYM'nin kira kararına göre bu işlem yapılamaz."].join("\n"),
      "AYM",
    );
    expect(aym.claim.contrary.flavor).toBe("aym");
  });

  it("the specific institution is not outvoted by the generic word inside it", () => {
    const text =
      "Kıdem tazminatı ödenmemiştir. Kıdem tazminatı hesabı yanlıştır. Kıdem tazminatı" +
      " faizi istenir. Ayrıca tazminat istenir.";
    expect(documentContraryTerm(text, [])).toBe("kıdem tazminatı");
  });

  it("a statute's NAME is not the institution a paragraph argues about", () => {
    expect(
      contraryBaseTerm(
        "2004 sayılı İcra ve İflas Kanunu'nun 269 vd. maddeleri gereğince icra yoluyla" +
          " tahliye mümkündür.",
      ),
    ).not.toBe("iflas");
  });

  it("strips assessment words, never a place name or a legal institution", () => {
    expect(stripEvaluativeWords("Olay Hatay'da gerçekleşmiştir.")).toBe(
      "Olay Hatay'da gerçekleşmiştir.",
    );
    expect(stripEvaluativeWords("Davalının eylemi haksız fiildir.")).toBe(
      "Davalının eylemi haksız fiildir.",
    );
    expect(stripEvaluativeWords("İşletmenin kusursuz sorumluluğu vardır.")).toBe(
      "İşletmenin kusursuz sorumluluğu vardır.",
    );
    expect(stripEvaluativeWords("Davalı kusurlu değildir.")).toBe("Davalı kusurlu değildir.");
    // NON-VACUITY: an assessment of the claim is still removed.
    expect(stripEvaluativeWords("İtiraz haksız ve hatalıdır.")).toBe(
      `İtiraz ${EVALUATIVE_WORD_PLACEHOLDER} ve ${EVALUATIVE_WORD_PLACEHOLDER}.`,
    );
  });
});
