/**
 * B-24 · the rule-based contract review met real contract shapes (2026-09-27).
 *
 * An investigator ran five contract forms (a kira form with GENEL / ÖZEL
 * ŞARTLAR, an iş sözleşmesi written as "MADDE n-BAŞLIK", a lisans sözleşmesi,
 * a mixed-marker danışmanlık sözleşmesi and a contract made only of negative
 * sentences) through `POST /v1/contracts/review`. Every block below is one
 * CONFIRMED defect of that run, pinned so it cannot come back:
 *
 *  1. a clause that IS there reported YOK (Turkish I, circumflex, suffixes);
 *  2. a clause that is NOT there reported VAR (substring, privative, negation)
 *     and weak terms that did not behave as the editor label says;
 *  3. a finding in Özel Şart 1 reported as "Madde 1" and attached to Genel 1;
 *  4. the clause splitter merging, inventing and mis-attaching clauses;
 *  5. no excerpt, so the lawyer could not catch any of the above;
 *  6. "RİSKLİ" → "gözlemİ", a self-hashed fabricated source printed as
 *     sourced, an out-of-range observation silently dropped, "<b>" escaped.
 *
 * All fixtures are SENTETİK; only their SHAPE is taken from the run.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  KAYNAKSIZ_PREFIX,
  reviewContract,
  runChecklist,
  splitClauses,
  stripRiskWords,
  verifyReviewEvidence,
  type Checklist,
  type ChecklistFinding,
  type ChecklistItem,
} from "../../src/contracts/clauseReview.js";
import { createContractsRouter, InMemoryChecklistStore } from "../../src/contracts/routes.js";
import { sha256HexUtf8 } from "../../src/verification/validator.js";

const NOW = () => new Date("2026-09-27T09:00:00.000Z");

function check(text: string, items: ChecklistItem[]): ChecklistFinding[] {
  return runChecklist(splitClauses(text), { id: "t", title: "t", items });
}

function stateOf(text: string, terms: string[], weakTerms?: string[]): string {
  const item: ChecklistItem = { id: "x", label: "x", terms };
  if (weakTerms !== undefined) item.weakTerms = weakTerms;
  return check(text, [item])[0]!.state;
}

// ---------------------------------------------------------------------------
// 1 · FALSE "YOK": a present clause reported absent
// ---------------------------------------------------------------------------

describe("1 · a clause that is there is never reported YOK", () => {
  it("(a) folds the Turkish I on both sides: IBAN, ISTAC, YETKILI MAHKEME, ISTANBUL", () => {
    const text = [
      "MADDE 9 - YETKILI MAHKEME",
      "Uyuşmazlıklarda ISTANBUL mahkemeleri yetkilidir.",
      "MADDE 10 - ÖDEME",
      "Kira bedeli TR12 0006 IBAN numaralı hesaba yatırılır.",
      "MADDE 11 - TAHKİM",
      "Uyuşmazlık ISTAC kuralları uyarınca çözülür.",
      "MADDE 12 - tebligat",
      "Adresler tebligat adresidir.",
    ].join("\n");
    expect(stateOf(text, ["yetkili mahkeme"])).toBe("VAR");
    expect(stateOf(text, ["istanbul"])).toBe("VAR");
    expect(stateOf(text, ["iban"])).toBe("VAR");
    expect(stateOf(text, ["istac"])).toBe("VAR");
    // …and the other direction: the term is written in capitals.
    expect(stateOf(text, ["TEBLİGAT"])).toBe("VAR");
    expect(stateOf(text, ["İSTANBUL"])).toBe("VAR");
  });

  it("(b) folds the circumflex: cezaî, Hukukî, Kâr, FİKRÎ; and the izafet hyphen ceza-i", () => {
    const text = [
      "1. İhlalde cezaî şart ödenir.",
      "2. Hukukî sorumluluk saklıdır.",
      "3. Kâr payı dağıtılır.",
      "4. FİKRÎ MÜLKİYET hakları Lisans Veren'e aittir.",
      "5. Ağır ihmal hâlinde ceza-i şart talep edilebilir.",
    ].join("\n");
    expect(stateOf(text, ["cezai şart"])).toBe("VAR");
    expect(stateOf(text, ["hukuki sorumluluk"])).toBe("VAR");
    expect(stateOf(text, ["kar payı"])).toBe("VAR");
    expect(stateOf(text, ["fikri mülkiyet"])).toBe("VAR");
    const cezai = check(text, [{ id: "c", label: "Cezai şart", terms: ["cezai şart"] }])[0]!;
    expect(cezai.clauseNumbers).toEqual(["1", "5"]);
  });

  it("(c) matches suffixed and sound-changed forms of every term word", () => {
    const text = [
      "1- Kiracı, kira bedelini ödemede temerrüde düşerse kiraya veren sözleşmeyi feshedeceğini bildirebilir.",
      "2- Kiracı kiralananı ayrıca düzenlenen tahliye taahhütnamesiyle boşaltmayı kabul etmiştir.",
      "3- SORUMLULUĞUN SINIRLANDIRILMASI",
      "4- Rekabet yasağına aykırılık hâlinde tazminat ödenir.",
      "5- Taraflar akdin feshi hâlinde hükmün uygulanacağını kabul eder.",
    ].join("\n");
    expect(stateOf(text, ["temerrüt"])).toBe("VAR");
    expect(stateOf(text, ["fesih"])).toBe("VAR");
    expect(stateOf(text, ["tahliye taahhüdü"])).toBe("VAR");
    expect(stateOf(text, ["sorumluluk sınırlaması"])).toBe("VAR");
    expect(stateOf(text, ["rekabet yasağı"])).toBe("VAR");
    expect(stateOf(text, ["akit"])).toBe("VAR");
    expect(stateOf(text, ["hüküm"])).toBe("VAR");
  });
});

// ---------------------------------------------------------------------------
// 2 · FALSE "VAR": an absent clause reported present
// ---------------------------------------------------------------------------

describe("2 · a clause that is not there is never reported VAR", () => {
  it("(a) a term word must start a word: 'sla' is not inside Maslak or ARSLAN", () => {
    const text = [
      "MADDE 1- TARAFLAR",
      "Maslak Mah. adresindeki işveren ile Zeynep ARSLAN arasında akdedilmiştir.",
    ].join("\n");
    expect(stateOf(text, ["sla"])).toBe("YOK");
    // …while a real SLA still counts, inflected with an apostrophe.
    expect(stateOf(`${text}\nMADDE 2- HİZMET\nSLA'da belirtilen süreler uygulanır.`, ["sla"])).toBe("VAR");
  });

  it("(a) a term followed by the privative -siz/-sız/-suz/-süz does not match", () => {
    const text = "1. Ödeme faizsiz yapılır.\n2. Kiracıdan depozitosuz teslim alınır.";
    expect(stateOf(text, ["faiz"])).toBe("YOK");
    expect(stateOf(text, ["depozito"])).toBe("YOK");
    expect(stateOf("1. Gecikmede yıllık %24 faiz işler.", ["faiz"])).toBe("VAR");
  });

  it("(b) a matched sentence with a negative predicate is BELİRSİZ, with the reason said", () => {
    const text = [
      "ARAÇ KİRALAMA SÖZLEŞMESİ",
      "",
      "1. Kiraya veren, aracı kiracıya 12 ay süreyle kiralamıştır.",
      "2. Kiracıdan depozito alınmamıştır.",
      "3. Taraflar arasında rekabet yasağı bulunmamaktadır.",
      "4. Bu sözleşmede cezai şart kararlaştırılmamıştır.",
      "5. Taraflar tahkim yoluna başvurmayacaklarını kabul ederler.",
      "6. Kira bedeli 18.000 TL olup her ayın 1'inde ödenir.",
      "7. Teminat yoktur.",
    ].join("\n");
    const findings = check(text, [
      { id: "depozito", label: "Depozito", terms: ["depozito"] },
      { id: "rekabet", label: "Rekabet yasağı", terms: ["rekabet yasağı"] },
      { id: "cezai", label: "Cezai şart", terms: ["cezai şart"] },
      { id: "tahkim", label: "Tahkim", terms: ["tahkim"] },
      { id: "teminat", label: "Teminat", terms: ["teminat"] },
      { id: "odeme", label: "Ödeme", terms: ["kira bedeli"] },
    ]);
    for (const id of ["depozito", "rekabet", "cezai", "tahkim", "teminat"]) {
      const finding = findings.find((f) => f.itemId === id)!;
      expect(finding.state, id).toBe("BELIRSIZ");
      expect(finding.reasonCode, id).toBe("NEGATED");
      expect(finding.reason, id).toContain("olumsuz ifade");
      expect(finding.matches[0]?.negated, id).toBe(true);
    }
    expect(findings.find((f) => f.itemId === "odeme")!.state).toBe("VAR");
  });

  it("(b) a conditional '-madığı takdirde' is not a negation of the clause", () => {
    const text = "1. Kiracı kira bedelini ödemediği takdirde temerrüde düşer.";
    expect(stateOf(text, ["temerrüt"])).toBe("VAR");
  });

  it("(b) one clean sentence anywhere keeps the item VAR", () => {
    const text = [
      "MADDE 7 – GİZLİLİK",
      "İşçi gizli bilgileri üçüncü kişilere açıklamayacaktır.",
    ].join("\n");
    const finding = check(text, [{ id: "g", label: "Gizlilik", terms: ["gizlilik", "gizli"] }])[0]!;
    expect(finding.state).toBe("VAR");
  });

  it("(c) weak terms behave as the editor label says: strong wins, weak-only is BELİRSİZ", () => {
    const both = "1. Kiracı 50.000 TL depozito verir; bu teminat iade edilir.";
    const strong = check(both, [
      { id: "d", label: "Depozito", terms: ["depozito"], weakTerms: ["teminat"] },
    ])[0]!;
    expect(strong.state).toBe("VAR");
    expect(strong.matchedTerm).toBe("depozito");
    expect(strong.matches.every((m) => m.strength === "strong")).toBe(true);

    const weakOnly = check("1. Kiracı teminat verir.", [
      { id: "d", label: "Depozito", terms: ["depozito"], weakTerms: ["teminat"] },
    ])[0]!;
    expect(weakOnly.state).toBe("BELIRSIZ");
    expect(weakOnly.reasonCode).toBe("WEAK_ONLY");
    expect(weakOnly.matchedTerm).toBe("teminat");
    expect(weakOnly.reason).toContain("şüpheli");
  });
});

// ---------------------------------------------------------------------------
// 3 · the clause reference
// ---------------------------------------------------------------------------

const KIRA_FORM = [
  "KİRA SÖZLEŞMESİ",
  "",
  "Kiracı                                  : Mehmet YILMAZ",
  "Kira Bedelinin Ne Şekilde Ödeneceği     : TR12 0006 4000 IBAN numaralı hesaba",
  "Kiranın Başlangıcı                      : 01.10.2026",
  "",
  "GENEL ŞARTLAR",
  "",
  "1- Kiracı, kiralananı özenle kullanmak ve komşulara saygı göstermekle yükümlüdür.",
  "2- Kiracı, kiralananı başkasına kiraya veremez, alt kira sözleşmesi yapamaz.",
  "3- Kiracı, kira bedelini ödemede temerrüde düşerse kiraya veren, kiracıya yazılı olarak en az",
  "30 günlük süre vererek bu süre içinde ödeme yapılmazsa sözleşmeyi feshedeceğini bildirebilir.",
  "4- Sözleşmenin damga vergisi kiracı tarafından ödenecektir.",
  "",
  "ÖZEL ŞARTLAR",
  "",
  "1- Kiracı sözleşmenin imzası sırasında 50.000,00 TL tutarında güvence bedelini bir bankada",
  "vadeli tasarruf hesabına yatırmıştır.",
  "2- Kiracı, 30.09.2027 tarihinde kiralananı boşaltacağını ayrıca düzenlenen tahliye taahhütnamesiyle kabul etmiştir.",
  "",
  "KİRAYA VEREN                                   KİRACI",
].join("\n");

const KIRA_LIST: Checklist = {
  id: "kira",
  title: "Kira",
  items: [
    { id: "depozito", label: "Depozito", terms: ["depozito", "güvence bedeli"] },
    { id: "tahliye", label: "Tahliye taahhüdü", terms: ["tahliye taahhüdü"] },
    { id: "altkira", label: "Alt kira", terms: ["alt kira"] },
    { id: "iban", label: "IBAN", terms: ["iban"] },
  ],
};

describe("3 · a finding names the clause it was found in", () => {
  const report = reviewContract({ text: KIRA_FORM, checklist: KIRA_LIST }, { now: NOW });
  const clauseOf = (index: number) => report.clauses.find((c) => c.index === index)!;

  it("reports Özel Şart 1 as 'Özel Şartlar 1', never as a bare 'Madde 1'", () => {
    const depozito = report.findings.find((f) => f.itemId === "depozito")!;
    expect(depozito.state).toBe("VAR");
    expect(depozito.clauseLabels).toEqual(["Özel Şartlar 1"]);
    const altKira = report.findings.find((f) => f.itemId === "altkira")!;
    expect(altKira.clauseLabels).toEqual(["Genel Şartlar 2"]);
  });

  it("attaches the item to the clause it was found in, keyed by index", () => {
    const depozito = report.findings.find((f) => f.itemId === "depozito")!;
    expect(depozito.clauseIndexes).toHaveLength(1);
    const ozel1 = clauseOf(depozito.clauseIndexes[0]!);
    expect(ozel1.label).toBe("Özel Şartlar 1");
    expect(ozel1.itemIds).toContain("depozito");
    // Genel Şart 1 shares the number "1" and must NOT carry the item.
    const genel1 = report.clauses.find((c) => c.label === "Genel Şartlar 1")!;
    expect(genel1.itemIds).not.toContain("depozito");
    const tahliye = report.findings.find((f) => f.itemId === "tahliye")!;
    expect(tahliye.state).toBe("VAR");
    expect(clauseOf(tahliye.clauseIndexes[0]!).label).toBe("Özel Şartlar 2");
    expect(report.clauses.find((c) => c.label === "Genel Şartlar 2")!.itemIds).toEqual(["altkira"]);
  });

  it("calls the unnumbered leading block 'Giriş'", () => {
    expect(report.clauses[0]?.label).toBe("Giriş");
    expect(report.findings.find((f) => f.itemId === "iban")!.clauseLabels).toEqual(["Giriş"]);
  });

  it("keeps plain 'Madde n' labels when the numbering never restarts", () => {
    const plain = reviewContract(
      {
        text: "BAŞLIK\n\nMADDE 1 - Taraflar A ve B.\nMADDE 2 - Depozito alınır.",
        checklist: { id: "x", title: "x", items: [{ id: "d", label: "D", terms: ["depozito"] }] },
      },
      { now: NOW },
    );
    expect(plain.findings[0]!.clauseLabels).toEqual(["Madde 2"]);
  });
});

// ---------------------------------------------------------------------------
// 4 · splitting
// ---------------------------------------------------------------------------

describe("4 · the clause splitter", () => {
  it("accepts 'MADDE n-BAŞLIK' with no space after the dash", () => {
    const clauses = splitClauses(
      [
        "MADDE 1-TARAFLAR",
        "A ile B arasında.",
        "MADDE 2-KİRA BEDELİ",
        "Kira 10.000 TL.",
        "MADDE 3-DEPOZİTO",
        "Depozito alınır.",
      ].join("\n"),
    );
    expect(clauses.map((c) => c.number)).toEqual(["1", "2", "3"]);
    expect(clauses[2]?.text).toContain("Depozito alınır.");
  });

  it("does not merge 'MADDE 5-ÜCRET' or 'MADDE 4-İHTİLAFLARIN ÇÖZÜMÜ' into the previous clause", () => {
    const clauses = splitClauses(
      [
        "MADDE 3",
        "ÜCRET VE ÖDEME ŞARTLARI",
        "3.1. Aylık danışmanlık ücreti 75.000 TL + KDV'dir.",
        "3.2. Ücret, faturanın tebliğinden itibaren 10 gün içinde ödenir.",
        "",
        "MADDE 4-İHTİLAFLARIN ÇÖZÜMÜ",
        "İhtilaflarda Ankara Mahkemeleri yetkilidir.",
        "MADDE 5-ÜCRET",
        "İşçiye aylık brüt ücret ödenir.",
      ].join("\n"),
    );
    expect(clauses.map((c) => c.number)).toEqual(["3", "3.1", "3.2", "4", "5"]);
    // the bare "MADDE 3" line takes the heading below it as its title
    expect(clauses[0]?.text).toContain("ÜCRET VE ÖDEME ŞARTLARI");
    expect(clauses[0]?.title).toBe("ÜCRET VE ÖDEME ŞARTLARI");
    expect(clauses.find((c) => c.number === "3.2")?.text).not.toContain("İHTİLAF");
  });

  it("attaches a heading-only line to the FOLLOWING clause", () => {
    const clauses = splitClauses(
      [
        "MADDE 4-İHTİLAFLARIN ÇÖZÜMÜ",
        "İhtilaflarda Ankara Mahkemeleri yetkilidir.",
        "",
        "SÖZLEŞMENİN FESHİ",
        "Madde 5 – Taraflardan her biri 30 gün önceden yazılı bildirimde bulunarak sözleşmeyi",
        "feshedebilir.",
      ].join("\n"),
    );
    expect(clauses.map((c) => c.number)).toEqual(["4", "5"]);
    expect(clauses[0]?.text).not.toContain("FESHİ");
    expect(clauses[1]?.text).toContain("SÖZLEŞMENİN FESHİ");
    expect(clauses[1]?.title).toBe("SÖZLEŞMENİN FESHİ");
  });

  it("never makes a wrapped line that starts with a number, a date or an amount into a clause", () => {
    const clauses = splitClauses(
      [
        "1. Sözleşme aşağıdaki tarihte başlar:",
        "01.10.2026 tarihinden itibaren 12 ay sürer.",
        "2. Bedel, fatura tarihinden itibaren",
        "30 gün içinde ödenir; ancak ağır ihmal hâlinde son",
        "3 aylık ücret tutarında ceza-i şart istenebilir.",
        "3.Kiracı depozito verir.",
        "4. Kira bedeli",
        "2.500 TL olarak",
        "12. ay sonunda yenilenir.",
      ].join("\n"),
    );
    expect(clauses.map((c) => c.number)).toEqual(["1", "2", "3", "4"]);
    expect(clauses[0]?.text).toContain("01.10.2026 tarihinden");
    expect(clauses[1]?.text).toContain("30 gün içinde");
    expect(clauses[1]?.text).toContain("3 aylık ücret");
    expect(clauses[3]?.text).toContain("12. ay sonunda");
  });

  it("accepts every documented marker shape", () => {
    const clauses = splitClauses(
      [
        "Madde 1 – Birinci.",
        "MADDE 2 Ikinci.",
        "Md. 3 – Üçüncü.",
        "Madde 4: Dördüncü.",
        "5. Beşinci.",
        "6- Altıncı.",
        "7) Yedinci.",
        "7.1. Yedinci bir.",
        "7.2 Yedinci iki.",
      ].join("\n"),
    );
    expect(clauses.map((c) => c.number)).toEqual(["1", "2", "3", "4", "5", "6", "7", "7.1", "7.2"]);
  });

  it("does not take a lower-case cross-reference ('madde 5'te') for a marker", () => {
    const clauses = splitClauses("1. Taraflar,\nmadde 5'te yazılı süreye uyar.\n2. İkinci.");
    expect(clauses.map((c) => c.number)).toEqual(["1", "2"]);
  });
});

// ---------------------------------------------------------------------------
// 5 · the excerpt
// ---------------------------------------------------------------------------

describe("5 · every VAR/BELİRSİZ finding carries a verbatim excerpt", () => {
  it("quotes the matched sentence and names its clause index", () => {
    const report = reviewContract({ text: KIRA_FORM, checklist: KIRA_LIST }, { now: NOW });
    const depozito = report.findings.find((f) => f.itemId === "depozito")!;
    expect(depozito.excerpt).toBe(
      "Kiracı sözleşmenin imzası sırasında 50.000,00 TL tutarında güvence bedelini bir bankada vadeli tasarruf hesabına yatırmıştır.",
    );
    expect(depozito.excerptClauseIndex).toBe(depozito.clauseIndexes[0]);
    expect(depozito.matches[0]?.clauseLabel).toBe("Özel Şartlar 1");
    expect(depozito.matches[0]?.term).toBe("güvence bedeli");
    // the excerpt is the contract's own sentence, never the folded search form
    const temerrut = check(KIRA_FORM, [{ id: "t", label: "T", terms: ["temerrüt"] }])[0]!;
    expect(temerrut.excerpt).toContain("temerrüde düşerse");
    const yok = report.findings.find((f) => f.itemId === "altkira" && f.state === "YOK");
    expect(yok).toBeUndefined();
  });

  it("a YOK finding has no excerpt", () => {
    const finding = check("1. Kira bedeli ödenir.", [{ id: "d", label: "D", terms: ["depozito"] }])[0]!;
    expect(finding.state).toBe("YOK");
    expect(finding.excerpt).toBe("");
    expect(finding.excerptClauseIndex).toBeNull();
    expect(finding.matches).toEqual([]);
  });

  it("cuts a long sentence at word boundaries with '…', at most 300 code points", () => {
    const filler = Array.from({ length: 80 }, (_, i) => `sözcük${i}`).join(" ");
    const text = `1. ${filler} depozito 𝒜𝒷𝒸 ${filler} sonu.`;
    const finding = check(text, [{ id: "d", label: "D", terms: ["depozito"] }])[0]!;
    const cps = Array.from(finding.excerpt);
    expect(cps.length).toBeLessThanOrEqual(300);
    expect(finding.excerpt.startsWith("…")).toBe(true);
    expect(finding.excerpt.endsWith("…")).toBe(true);
    expect(finding.excerpt).toContain("depozito 𝒜𝒷𝒸");
    // every word in the window is a whole word of the source
    for (const word of finding.excerpt.replace(/…/gu, "").trim().split(" ")) {
      expect(text.split(/\s+/u)).toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// 6 · observations
// ---------------------------------------------------------------------------

describe("6 · the word 'risk' and the source of an observation", () => {
  it("replaces the stem and keeps the suffix, in the right case", () => {
    expect(stripRiskWords("Bu sınırlama yüksek RİSKLİ bir düzenlemedir.")).toBe(
      "Bu sınırlama yüksek GÖZLEMLİ bir düzenlemedir.",
    );
    expect(stripRiskWords("Riskin tamamı müşteriye yüklenmiş.")).toBe(
      "Gözlemin tamamı müşteriye yüklenmiş.",
    );
    expect(stripRiskWords("riskli, riskleri, RISK")).toBe("gözlemli, gözlemleri, GÖZLEM");
    expect(stripRiskWords("RİSKLİ")).not.toContain("gözlemİ");
  });

  const fakeQuote = "Bu metni ben uydurdum; hiçbir kanunda geçmez.";
  const fabricated = {
    evidenceId: "ev-uydurma",
    label: "TBK m. 999",
    quote: fakeQuote,
    quoteSha256: sha256HexUtf8(fakeQuote),
  };

  it("a quote hashed against its own digest is NOT a source", () => {
    const report = reviewContract(
      {
        text: KIRA_FORM,
        checklist: KIRA_LIST,
        evidence: [fabricated],
        observations: [{ clauseIndex: 1, text: "Bu hüküm ciddi risk taşır.", evidenceId: "ev-uydurma" }],
      },
      { now: NOW },
    );
    const observation = report.clauses.flatMap((c) => c.observations)[0]!;
    expect(observation.sourced).toBe(false);
    expect(observation.text.startsWith(`${KAYNAKSIZ_PREFIX} — `)).toBe(true);
    expect(observation.evidenceLabel).toBe("");
    expect(observation.text).not.toMatch(/r[iıİI]sk/iu);
  });

  const realQuote = "Kiracı, kira bedelini ödemekle yükümlüdür (SENTETİK).";
  const answers = {
    get: (runId: string) =>
      runId === "run-1"
        ? {
            result: {
              runId: "run-1",
              claims: [],
              evidence: [
                {
                  evidenceId: "ev-1",
                  source: "MEVZUAT",
                  title: "Türk Borçlar Kanunu",
                  legislationNo: "6098",
                  article: "313",
                  quote: realQuote,
                  quoteSha256: sha256HexUtf8(realQuote),
                  contentSha256: "0".repeat(64),
                },
              ],
            },
          }
        : undefined,
  };

  it("a quote the answer store holds under that run IS a source, with the store's label", async () => {
    const offered = [
      { evidenceId: "ev-1", runId: "run-1", label: "TBK m. 999", quote: realQuote, quoteSha256: sha256HexUtf8(realQuote) },
      { ...fabricated, runId: "run-1" },
    ];
    const verified = await verifyReviewEvidence(offered, answers);
    expect([...verified.keys()]).toEqual(["ev-1"]);
    const report = reviewContract(
      {
        text: KIRA_FORM,
        checklist: KIRA_LIST,
        evidence: offered,
        observations: [
          { clauseIndex: 1, text: "Kira ödemesi bakımından risk vardır.", evidenceId: "ev-1" },
          { clauseIndex: 1, text: "Bu hüküm ciddi risk taşır.", evidenceId: "ev-uydurma" },
        ],
      },
      { now: NOW, verifiedEvidence: verified },
    );
    const [sourced, unsourced] = report.clauses.flatMap((c) => c.observations);
    expect(sourced?.sourced).toBe(true);
    expect(sourced?.text).toContain("risk");
    // the label is the store's, never the request's "TBK m. 999"
    expect(sourced?.evidenceLabel).not.toContain("999");
    expect(sourced?.evidenceLabel).toContain("6098");
    expect(unsourced?.sourced).toBe(false);
  });

  it("an observation for a clause that does not exist is returned unattached, not dropped", () => {
    const report = reviewContract(
      {
        text: KIRA_FORM,
        checklist: KIRA_LIST,
        observations: [{ clauseIndex: 999, text: "Bu gözlem kaybolacak mı?" }],
      },
      { now: NOW },
    );
    expect(report.clauses.flatMap((c) => c.observations)).toHaveLength(0);
    expect(report.unattachedObservations).toHaveLength(1);
    expect(report.unattachedObservations[0]?.clauseIndex).toBe(999);
    expect(report.unattachedObservations[0]?.text).toContain("Bu gözlem kaybolacak mı?");
    expect(report.unattachedObservations[0]?.note).toContain("hiçbir maddeye eklenmedi");
  });

  it("keeps an observation's text as plain text: no entity escapes, no invisible characters", () => {
    const report = reviewContract(
      {
        text: KIRA_FORM,
        checklist: KIRA_LIST,
        observations: [
          { clauseIndex: 0, text: "<b>x</b> & y" },
          { clauseIndex: 0, text: "ri\u200bsk taşıyan hüküm" },
        ],
      },
      { now: NOW },
    );
    const [html, hidden] = report.clauses[0]!.observations;
    expect(html?.text).toBe(`${KAYNAKSIZ_PREFIX} — <b>x</b> & y`);
    expect(html?.text).not.toContain("&lt;");
    expect(html?.text).not.toContain("&amp;");
    expect(hidden?.text).toBe(`${KAYNAKSIZ_PREFIX} — gözlem taşıyan hüküm`);
  });
});

// ---------------------------------------------------------------------------
// The router: evidence is verified against the answer store, or not at all
// ---------------------------------------------------------------------------

describe("router · evidence resolution", () => {
  const quote = "Kiracı, kira bedelini ödemekle yükümlüdür (SENTETİK).";
  const answers = {
    get: (runId: string) =>
      runId === "run-9"
        ? {
            result: {
              runId: "run-9",
              claims: [],
              evidence: [
                {
                  evidenceId: "ev-9",
                  source: "MEVZUAT",
                  title: "Türk Borçlar Kanunu",
                  legislationNo: "6098",
                  article: "313",
                  quote,
                  quoteSha256: sha256HexUtf8(quote),
                  contentSha256: "0".repeat(64),
                },
              ],
            },
          }
        : undefined,
  };
  const body = {
    text: KIRA_FORM,
    checklist: KIRA_LIST,
    evidence: [
      { evidenceId: "ev-9", runId: "run-9", label: "TBK m. 313", quote, quoteSha256: sha256HexUtf8(quote) },
    ],
    observations: [{ clauseIndex: 1, text: "Risk vardır.", evidenceId: "ev-9" }],
  };
  const post = async (app: Hono) =>
    (await (
      await app.request("/v1/contracts/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as { clauses: { observations: { sourced: boolean; text: string }[] }[] };

  it("is sourced when the answer store holds the quote under that run", async () => {
    const app = createContractsRouter({ now: NOW, checklists: new InMemoryChecklistStore(), answers });
    const report = await post(app);
    expect(report.clauses.flatMap((c) => c.observations)[0]?.sourced).toBe(true);
  });

  it("is KAYNAKSIZ when no answer store is wired, whatever the request says", async () => {
    const app = createContractsRouter({ now: NOW, checklists: new InMemoryChecklistStore() });
    const report = await post(app);
    const observation = report.clauses.flatMap((c) => c.observations)[0];
    expect(observation?.sourced).toBe(false);
    expect(observation?.text).toBe(`${KAYNAKSIZ_PREFIX} — Gözlem vardır.`);
  });
});
