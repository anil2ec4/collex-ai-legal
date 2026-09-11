/**
 * W17/b — the petition shapes that are NOT a cevap dilekçesi.
 *
 * The whole of W17/b was measured on one real cevap dilekçesi, and an
 * adversarial audit then asked the obvious next question: what does the same
 * code do to an istinaf dilekçesi, a ceza savunma, an icra itirazı? Every case
 * below is a defect that audit found and that two independent skeptics failed
 * to refute. All fixtures are SENTETİK; only their SHAPE is real, and the
 * shape is the only thing a parser reads.
 */

import { describe, expect, it } from "vitest";
import {
  analyzePetition,
  extractClaims,
  isDocumentListHeading,
  isPreambleLine,
} from "../../src/contracts/petitionAnalysis.js";
import { extractAuditCitations } from "../../src/contracts/citationAudit.js";

const ASOF = "2026-03-01";
const NOW = () => new Date("2026-03-02T09:00:00.000Z");

// ---------------------------------------------------------------------------
// An unclassifiable ground is not a document list
// ---------------------------------------------------------------------------

const SAVUNMA = [
  "İZMİR 2. ASLİYE CEZA MAHKEMESİ'NE",
  "",
  "DOSYA NO : 2026/91 Esas",
  "SANIK : Ali Demir",
  "MÜDAFİ : Av. Ahmet Yılmaz",
  "",
  "SAVUNMAMIZ",
  "",
  "1. Sanığın eylemi suç oluşturmamaktadır.",
  "",
  "2. Şikayet süresi geçmiştir.",
  "",
  "DELİLLER : Dosya kapsamı, tanık beyanları.",
  "",
  "SONUÇ VE İSTEM : Beraatine karar verilmesini talep ederiz.",
].join("\n");

describe("W17/b · an unclassified ground is not called an evidence list", () => {
  it("recognises a list only from the heading that declares one", () => {
    expect(isDocumentListHeading("DELİLLER")).toBe(true);
    expect(isDocumentListHeading("DELİLLER :")).toBe(true);
    expect(isDocumentListHeading("EKLER")).toBe(true);
    // NON-VACUITY: the argumentative sections are never lists.
    expect(isDocumentListHeading("SAVUNMAMIZ")).toBe(false);
    expect(isDocumentListHeading("AÇIKLAMALAR")).toBe(false);
    expect(isDocumentListHeading("")).toBe(false);
  });

  it("searches a defence ground and scans it for unsourced statements", async () => {
    const report = await analyzePetition(
      { text: SAVUNMA, asOf: ASOF },
      { contrarySearch: async () => [], monotonic: () => 0, now: NOW },
    );
    const ground = report.claims.find((entry) => entry.claim.number === "1");
    expect(ground?.claim.heading).toBe("SAVUNMAMIZ");
    // MEASURED before the fix: this ground came back kind "diğer" and carried
    // "Bu blok bir iddia değil, bir liste (deliller/ekler) olduğu için…".
    expect(ground?.contrary.note ?? "").not.toContain("liste (deliller/ekler)");
    expect(ground?.unsourced.length).toBeGreaterThan(0);
    // NON-VACUITY: the real list still IS treated as one.
    const list = report.claims.find((entry) => entry.claim.heading === "DELİLLER");
    expect(list?.contrary.note).toContain("liste (deliller/ekler)");
    expect(list?.unsourced).toEqual([]);
  });

  it("keeps the defence lawyer's own name out of the claims", () => {
    const texts = extractClaims(SAVUNMA).map((claim) => claim.text);
    expect(texts.some((t) => t.includes("Av. Ahmet Yılmaz"))).toBe(false);
    expect(texts.some((t) => t.includes("Ali Demir"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Numbering and headings a real petition actually uses
// ---------------------------------------------------------------------------

const ITIRAZ = [
  "İZMİR 5. İCRA MÜDÜRLÜĞÜ'NE",
  "",
  "DOSYA NO : 2026/1187 Esas",
  "İTİRAZ EDEN (BORÇLU) : Mehmet Öz",
  "TEBLİĞ TARİHİ : 12.02.2026",
  "",
  "I. AÇIKLAMALAR",
  "",
  "1-) Borç, taraflar arasındaki sözleşmenin 5. maddesi uyarınca zaten ödenmiştir.",
  "",
  "2-) Alacaklının dayandığı senet üzerindeki imza müvekkile ait değildir.",
  "",
  "(3) Takip konusu alacak İİK m. 33 uyarınca zamanaşımına uğramıştır.",
  "",
  "II. HUKUKÎ SEBEPLER : İİK m. 62, İİK m. 33 ve ilgili sair mevzuat.",
  "",
  "III. SONUÇ VE İSTEM : Takibin iptaline karar verilmesini talep ederiz.",
].join("\n");

describe("W17/b · the numbering Turkish lawyers actually type", () => {
  const claims = extractClaims(ITIRAZ);

  it("splits the three grounds into three claims", () => {
    // MEASURED before the fix: all three ran together into ONE claim, and on
    // the full shape the whole body came back as a single "talep".
    expect(claims.filter((c) => c.number === "1")).toHaveLength(1);
    expect(claims.filter((c) => c.number === "2")).toHaveLength(1);
    expect(claims.filter((c) => c.number === "3")).toHaveLength(1);
    const first = claims.find((c) => c.number === "1");
    expect(first?.text).toContain("zaten ödenmiştir");
    expect(first?.text).not.toContain("imza müvekkile ait değildir");
  });

  it("reads a Roman-numbered heading as a heading", () => {
    const headings = new Set(claims.map((c) => c.heading));
    // The stored heading is the line the DOCUMENT wrote, numbering included.
    expect([...headings].some((h) => h.includes("AÇIKLAMALAR"))).toBe(true);
    expect([...headings].some((h) => h.includes("HUKUKÎ SEBEPLER"))).toBe(true);
    expect([...headings].some((h) => h.includes("SONUÇ VE İSTEM"))).toBe(true);
  });

  it("does not read a date as numbering", () => {
    const dated = extractClaims("14.03.2024 tarihli sözleşme feshedilmiştir.");
    expect(dated[0]?.number).toBe("");
    expect(dated[0]?.text).toContain("14.03.2024");
  });
});

describe("W17/b · the addressee and the party labels", () => {
  it("recognises every office's apostrophe form", () => {
    for (const line of [
      "İZMİR 5. İCRA MÜDÜRLÜĞÜ'NE",
      "İZMİR CUMHURİYET BAŞSAVCILIĞI'NA",
      "İZMİR 2. SULH HUKUK MAHKEMESİ'NE",
      "ANKARA BÖLGE ADLİYE MAHKEMESİ 4. HUKUK DAİRESİ'NE",
    ]) {
      expect(isPreambleLine(line)).toBe(true);
    }
  });

  it("recognises the compound role labels", () => {
    for (const line of [
      "MÜDAFİ : Av. Ahmet Yılmaz",
      "İTİRAZ EDEN (BORÇLU) : Mehmet Öz",
      "İSTİNAF EDEN (DAVALI) : Yılmaz İnşaat A.Ş.",
      "TEBLİĞ TARİHİ : 12.02.2026",
      "DAVALI VEKİLİ : Av. Selin Aydın",
    ]) {
      expect(isPreambleLine(line)).toBe(true);
    }
  });

  it("still refuses a sentence that merely opens with one of those words", () => {
    expect(isPreambleLine("İtiraz eden borçlu, ödemeyi süresinde yapmıştır.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A clause of the parties' own contract is not a statute
// ---------------------------------------------------------------------------

describe("W17/b · a contract clause is not a legal citation", () => {
  it("keeps it out of the citation audit", () => {
    expect(
      extractAuditCitations("Borç, sözleşmenin 5. maddesi uyarınca ödenmiştir."),
    ).toEqual([]);
  });

  it("does not promote its paragraph to a legal claim", () => {
    const claims = extractClaims(ITIRAZ);
    expect(claims.find((c) => c.number === "1")?.kind).toBe("VAKIA");
    // NON-VACUITY: the ground that cites İİK m. 33 IS a legal claim.
    expect(claims.find((c) => c.number === "3")?.kind).toBe("HUKUKI_SEBEP");
  });

  it("leaves the sentence in the claim, so nothing is hidden", () => {
    const first = extractClaims(ITIRAZ).find((c) => c.number === "1");
    expect(first?.text).toContain("sözleşmenin 5. maddesi");
  });
});

// ---------------------------------------------------------------------------
// One authority, several spellings
// ---------------------------------------------------------------------------

describe("W17/b · a merged citation keeps every spelling the document used", () => {
  const TEXT =
    "Bu süre, TTK m. 23/1-c anlamında derhal bildirim ölçütünü aşmaktadır." +
    "\n\nHUKUKÎ SEBEPLER : TTK m. 23 ve ilgili sair mevzuat.";

  it("records both forms on the one row", () => {
    const found = extractAuditCitations(TEXT);
    const row = found.find((c) => c.raw.startsWith("TTK"));
    expect(row?.count).toBe(2);
    expect(row?.rawForms).toEqual(["TTK m. 23/1-c", "TTK m. 23"]);
  });

  it("attributes the row to the block that wrote the shorter form", async () => {
    const report = await analyzePetition({ text: TEXT, asOf: ASOF }, { now: NOW });
    const grounds = report.claims.find(
      (entry) => entry.claim.heading === "HUKUKÎ SEBEPLER",
    );
    // MEASURED before the fix: the row was keyed under "TTK m. 23/1-c", which
    // is not a substring of this block, so the block's card counted one
    // citation fewer than the sentence above it plainly cites.
    expect(grounds?.citations.length).toBeGreaterThan(0);
    expect(grounds?.citations.some((r) => r.rawForms.includes("TTK m. 23"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The state names say only what was measured
// ---------------------------------------------------------------------------

const CEVAP_TAZMINAT = [
  "İZMİR 1. ASLİYE HUKUK MAHKEMESİ'NE",
  "",
  "AÇIKLAMALAR",
  "",
  "1. Davacı manevi tazminat talep etmektedir; koşulları oluşmamıştır.",
].join("\n");

describe("W17/b · a lane that returned rows does not claim they are contrary", () => {
  it("neither the label nor the meaning asserts an unmeasured direction", async () => {
    const report = await analyzePetition(
      { text: CEVAP_TAZMINAT, asOf: ASOF },
      {
        contrarySearch: async () => [{ kunye: "Yargıtay 4. HD E. 2020/1 K. 2021/2" }],
        monotonic: () => 0,
        now: NOW,
      },
    );
    const found = report.claims
      .flatMap((entry) => entry.contrary.lanes)
      .find((lane) => lane.state === "BULUNDU");
    expect(found).toBeDefined();
    // MEASURED: the badge read "aleyhe kaynak bulundu" over five Yargıtay
    // 11. HD (ticaret) decisions in an eser sözleşmesi case, and one decision
    // was asserted as authority against two unrelated claims. Nothing in the
    // pipeline reads what a returned decision says.
    expect(found?.stateLabel).toBe("sorgu sonuç getirdi");
    expect(found?.stateLabel).not.toContain("aleyhe");
  });
});
