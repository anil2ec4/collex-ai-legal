/**
 * W21 R2-22: what the deterministic extractor can read, and what it reports
 * it could not.
 *
 * The defect this locks: extract-v2 looked month names up by a spelling that
 * kept ş/ı/ğ/ü, so "15 Eylül 2023" (and every date in Şubat, Mayıs, Ağustos,
 * Kasım, Aralık) was never read, and amounts were read only as "45.000 TL".
 * The review grid's census then wrote "Belgenin tamamında tarih bulunmadı"
 * for a fully read contract full of dates. These cases fail on extract-v2.
 */

import { describe, expect, it } from "vitest";
import { detectRelations, type ComparableObservation } from "../../src/exhaustive/contradictions.js";
import {
  EXTRACTOR_VERSION,
  extractPropositions,
  unparsedValueMentions,
  type PropositionDraft,
} from "../../src/exhaustive/observations.js";
import { runExhaustiveAnalysis, type ScopedDocument } from "../../src/exhaustive/runner.js";

const MONTHS: ReadonlyArray<readonly [string, string]> = [
  ["Ocak", "01"], ["Şubat", "02"], ["Mart", "03"], ["Nisan", "04"], ["Mayıs", "05"], ["Haziran", "06"],
  ["Temmuz", "07"], ["Ağustos", "08"], ["Eylül", "09"], ["Ekim", "10"], ["Kasım", "11"], ["Aralık", "12"],
];

/** Turkish upper case (i → İ, ı → I), as a typed heading spells it. */
function upperTr(word: string): string {
  return word.replace(/i/gu, "İ").replace(/ı/gu, "I").toUpperCase();
}

/** Turkish lower case (İ → i, I → ı). */
function lowerTr(word: string): string {
  return word.replace(/İ/gu, "i").replace(/I/gu, "ı").toLowerCase();
}

/** The name typed without Turkish letters ("Eylul", "Subat"). */
function asciiSpelling(word: string): string {
  return word.replace(/ş/gu, "s").replace(/Ş/gu, "S").replace(/ı/gu, "i").replace(/ğ/gu, "g").replace(/ü/gu, "u");
}

function dates(text: string): string[] {
  return extractPropositions(text)
    .filter((draft) => draft.kind === "date")
    .map((draft) => draft.normalizedValue);
}

/** Amounts as the matter analysis reads them (no foreign currency). */
function amounts(text: string): PropositionDraft[] {
  return extractPropositions(text).filter((draft) => draft.kind === "amount");
}

/** Amounts as the review grid's census reads them (foreign currency too). */
function censusAmounts(text: string): PropositionDraft[] {
  return extractPropositions(text, { foreignAmounts: true }).filter((draft) => draft.kind === "amount");
}

/** A one-page, fully text-layered document, for the matter-analysis runner. */
function onePageDocument(fileId: string, text: string): ScopedDocument {
  const length = [...text].length;
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    documentVersionId: `${fileId}-v1`,
    canonicalText: text,
    spans: [{ chunkId: `${fileId}-c0`, ordinal: 0, startChar: 0, endChar: length }],
    segments: [
      {
        locatorKind: "page",
        locatorLabel: "1",
        startChar: 0,
        endChar: length,
        extractionMethod: "pdf_text_layer",
        extractionStatus: "EXTRACTED",
      },
    ],
  };
}

/** A no-break space, the typographic thousands separator. */
const NBSP = String.fromCharCode(0x00a0);

describe("R2-22 · every Turkish month name is read, however it is written", () => {
  it("the rules changed, so the extractor version did (runs cannot mix observations of two rule sets)", () => {
    // extract-v6 (third verifier round): which amounts are read changed again ("TL 2,5 katı", "7500 Türk\nLirası"; see the last block).
    expect(EXTRACTOR_VERSION).toBe("extract-v7");
  });

  for (const [month, mm] of MONTHS) {
    it(`${month}: title case, upper case, lower case, ASCII spelling and decomposed (NFD) text`, () => {
      const spellings = new Set([month, upperTr(month), lowerTr(month), asciiSpelling(month), month.normalize("NFD")]);
      for (const spelling of spellings) {
        const text = `Sözleşme 15 ${spelling} 2023 tarihinde imzalanmıştır.`;
        expect(dates(text), JSON.stringify(spelling)).toEqual([`2023-${mm}-15`]);
        // The quote still slices back out of the text it came from.
        const [draft] = extractPropositions(text);
        expect(text).toContain(draft!.quote);
        // Nothing was left unread in it.
        expect(unparsedValueMentions(text, "date"), JSON.stringify(spelling)).toEqual([]);
      }
    });
  }

  it("the finding's own contract: both long-form dates are read", () => {
    const text =
      "Kira sözleşmesi 15 Eylül 2023 tarihinde imzalanmıştır. Kira bedeli aylık 45.000,00.-TL olarak" +
      " belirlenmiştir. Tahliye tarihi 31 Ağustos 2025'tir.";
    expect(dates(text)).toEqual(["2023-09-15", "2025-08-31"]);
    expect(amounts(text).map((draft) => draft.normalizedValue)).toEqual(["4500000"]);
    expect(unparsedValueMentions(text, "date")).toEqual([]);
    expect(unparsedValueMentions(text, "amount")).toEqual([]);
  });

  it("reads ISO dates and still refuses impossible ones", () => {
    expect(dates("Belge 2023-09-15 tarihinde oluşturuldu.")).toEqual(["2023-09-15"]);
    expect(dates("Belge 2023-02-30 tarihinde oluşturuldu.")).toEqual([]);
    expect(dates("32 Ocak 2024 tarihinde")).toEqual([]);
  });

  it("a month name inside the value is not part of its topic key", () => {
    const [draft] = extractPropositions("İhtarname 11 Mart 2024 tarihinde tebliğ edilmiştir.");
    expect(draft!.subject).not.toMatch(/mart/u);
    expect(draft!.subject).toContain("ihtarnam");
  });
});

describe("R2-22 · amount spellings, with the currency kept", () => {
  const TRY_CASES: ReadonlyArray<readonly [string, string]> = [
    ["Kira bedeli 45.000 TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45.000,00.-TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45.000.- TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45.000-TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45.000,- TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45.000 TRY olarak ödenmiştir.", "4500000"],
    ["Kira bedeli ₺45.000 olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45.000 ₺ olarak ödenmiştir.", "4500000"],
    ["Kira bedeli TL 45.000 olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45 000 TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 45 bin TL olarak ödenmiştir.", "4500000"],
    ["Kira bedeli 1,5 milyon TL olarak ödenmiştir.", "150000000"],
    ["Kira bedeli 1.200,50 Türk Lirası olarak ödenmiştir.", "120050"],
    ["KİRA BEDELİ 1.200,50 TÜRK LİRASI OLARAK ÖDENMİŞTİR.", "120050"],
  ];
  for (const [text, value] of TRY_CASES) {
    it(`TL: ${text}`, () => {
      const found = amounts(text);
      expect(found.map((draft) => [draft.predicate, draft.normalizedValue])).toEqual([["tutar", value]]);
      expect(text).toContain(found[0]!.quote);
      expect(unparsedValueMentions(text, "amount")).toEqual([]);
    });
  }

  const FOREIGN_CASES: ReadonlyArray<readonly [string, string, string]> = [
    ["Bedel 1.500 EUR olarak ödenmiştir.", "150000 EUR", "tutar:EUR"],
    ["Bedel €1.500 olarak ödenmiştir.", "150000 EUR", "tutar:EUR"],
    ["Bedel 1.500 Avro olarak ödenmiştir.", "150000 EUR", "tutar:EUR"],
    ["Bedel USD 2.000,50 olarak ödenmiştir.", "200050 USD", "tutar:USD"],
    ["Bedel $2.000 olarak ödenmiştir.", "200000 USD", "tutar:USD"],
    ["Bedel 2.000 ABD Doları olarak ödenmiştir.", "200000 USD", "tutar:USD"],
    ["Bedel £300 olarak ödenmiştir.", "30000 GBP", "tutar:GBP"],
    // Was "CHF 750": a bare number after a code is not amount-shaped ("TL 12 eşit taksit"); see the second verifier round.
    ["Bedel CHF 750,00 olarak ödenmiştir.", "75000 CHF", "tutar:CHF"],
  ];
  for (const [text, value, predicate] of FOREIGN_CASES) {
    it(`foreign (census): ${text}`, () => {
      expect(censusAmounts(text).map((draft) => [draft.predicate, draft.normalizedValue])).toEqual([[predicate, value]]);
    });
  }

  it("45.000 TL and 45.000 EUR are never equal and never compared", () => {
    const [tl] = censusAmounts("Ödenen kira bedeli 45.000 TL olarak kayda geçmiştir.");
    const [eur] = censusAmounts("Ödenen kira bedeli 45.000 EUR olarak kayda geçmiştir.");
    expect(tl!.normalizedValue).not.toBe(eur!.normalizedValue);
    const observation = (draft: PropositionDraft, id: string, fileId: string): ComparableObservation => ({
      observationId: id,
      kind: draft.kind,
      subject: draft.subject,
      predicate: draft.predicate,
      normalizedValue: draft.normalizedValue,
      fileId,
      unitNo: 1,
      statement: draft.statement,
    });
    // Same topic (the currency is part of the value, not the topic) ...
    expect(tl!.subject).toBe(eur!.subject);
    // ... and still no relation: different currencies are not compared.
    expect(detectRelations([observation(tl!, "o1", "f1"), observation(eur!, "o2", "f2")])).toEqual([]);
  });

  it("never reads a scaled amount by its tail: '45 bin 500 TL' is not 500 TL", () => {
    const text = "Bedel 45 bin 500 TL olarak ödenmiştir.";
    expect(amounts(text)).toEqual([]);
    expect(unparsedValueMentions(text, "amount")).toEqual(["Bedel 45 bin 500 TL olarak"]);
  });

  it("a written-out repetition of a read amount is not an unread amount", () => {
    const text = "Bedel 45.000,00 TL (Kırkbeşbin Türk Lirası) olarak ödenmiştir.";
    expect(amounts(text).map((draft) => draft.normalizedValue)).toEqual(["4500000"]);
    expect(unparsedValueMentions(text, "amount")).toEqual([]);
  });
});

describe("R2-22 · unparsedValueMentions names what the census could not read", () => {
  it("dates: a month without a day, an impossible or two-digit-year numeric date", () => {
    expect(unparsedValueMentions("Ödeme Eylül 2023 ayında yapılmıştır.", "date")).toEqual(["Ödeme Eylül 2023 ayında"]);
    expect(unparsedValueMentions("Tebligat 31.02.2023 tarihinde yapılmıştır.", "date")).toEqual([
      "Tebligat 31.02.2023 tarihinde yapılmıştır",
    ]);
    expect(unparsedValueMentions("Tebligat 15.09.23 tarihinde yapılmıştır.", "date")).toEqual(["Tebligat 15.09.23 tarihinde yapılmıştır"]);
  });

  it("dates: a month-like word far from any number, or a read date, is not a mention", () => {
    expect(unparsedValueMentions("Aralık verilmeden yapılan ödemeler ayrıca incelenmelidir.", "date")).toEqual([]);
    expect(unparsedValueMentions("Sözleşme 01.02.2023 tarihinde imzalanmıştır.", "date")).toEqual([]);
  });

  it("amounts: a decimal point or English grouping the patterns do not read", () => {
    expect(unparsedValueMentions("Bedel 1.5 milyon TL olarak belirlenmiştir.", "amount")).toEqual([
      "Bedel 1.5 milyon TL olarak",
    ]);
    expect(unparsedValueMentions("Bedel USD 1,500.00 olarak belirlenmiştir.", "amount")).toEqual([
      "Bedel USD 1,500.00",
    ]);
  });

  it("amounts: a currency word with no number near it is not a mention; ratios have no check", () => {
    expect(unparsedValueMentions("Bedel TL cinsinden ödenecektir.", "amount")).toEqual([]);
    expect(unparsedValueMentions("Oran %80 olarak belirlenmiştir.", "ratio")).toEqual([]);
  });
});

/**
 * Verifier round. extract-v3 fed "<minor> <CODE>" foreign amounts to the
 * matter analysis, whose contradictions.ts reads every amount as TL kuruş:
 * "1.500 EUR" vs "1.600 EUR" came out as "150000 EUR ve 160000 EUR", and a
 * 0.33% EUR gap a CONTRADICTION where the same TL gap is a TENSION. v3 also
 * refused every amount written after another number and a space, and read
 * "1 500 TL" as 1.500 TL. Each block below fails on extract-v3.
 */
describe("R2-22 verifier round · a foreign amount is never reported at the wrong magnitude", () => {
  it("the matter analysis leaves foreign amounts out; the grid census still reads them", () => {
    const text = "Kiracı teminat bedeli olarak 1.500 EUR yatırmıştır.";
    expect(amounts(text)).toEqual([]);
    expect(censusAmounts(text).map((draft) => [draft.predicate, draft.normalizedValue])).toEqual([["tutar:EUR", "150000 EUR"]]);
    // Its span is still consumed: never misread as a TL amount, never named as unread.
    expect(unparsedValueMentions(text, "amount")).toEqual([]);
  });

  it("the verifier's pairs: no EUR relation at all; the TL pairs keep their verdicts", () => {
    const relations = (left: string, right: string) =>
      runExhaustiveAnalysis([onePageDocument("f1", left), onePageDocument("f2", right)]).relations;
    expect(
      relations("Kiracı teminat bedeli olarak 1.500 EUR yatırmıştır.", "Kiracı teminat bedeli olarak 1.600 EUR yatırmıştır."),
    ).toEqual([]);
    expect(
      relations("Kiracı teminat bedeli olarak 150.000 EUR yatırmıştır.", "Kiracı teminat bedeli olarak 150.500 EUR yatırmıştır."),
    ).toEqual([]);
    const near = relations(
      "Kiracı teminat bedeli olarak 150.000 TL yatırmıştır.",
      "Kiracı teminat bedeli olarak 150.500 TL yatırmıştır.",
    );
    expect(near.map((relation) => relation.relation)).toEqual(["TENSION"]);
    const apart = relations("Kiracı teminat bedeli olarak 1.500 TL yatırmıştır.", "Kiracı teminat bedeli olarak 1.600 TL yatırmıştır.");
    expect(apart.map((relation) => relation.relation)).toEqual(["CONTRADICTION"]);
    expect(apart[0]!.rationale).toContain("1.500 TL ve 1.600 TL");
  });
});

describe("R2-22 verifier round · an amount after a date, year or item number is read; an ambiguous join is not guessed", () => {
  const READ: ReadonlyArray<readonly [string, string]> = [
    ["15.09.2023 45.000,00 TL kira ödemesi", "4500000"],
    ["Ekim 2023 45.000 TL", "4500000"],
    ["Fatura No 1234 1.500,00 TL", "150000"],
    ["Fatura No 1234 500 TL", "50000"],
    ["Belge 2023-09-15 500 TL tahsil edildi", "50000"],
    ["Saat 14:30 500 TL tahsil edildi", "50000"],
    ["Taksit 3 15.000 TL", "1500000"],
    ["12 540.000 TL", "54000000"],
    ["Kira bedeli 45 000 TL", "4500000"],
    ["Bedel 1 050 000 TL", "105000000"],
    [`Bedel 1${NBSP}500 TL`, "150000"],
    ["TL 45 000 ödendi", "4500000"],
  ];
  for (const [text, value] of READ) {
    it(`read: ${JSON.stringify(text)}`, () => {
      expect(amounts(text).map((draft) => draft.normalizedValue)).toEqual([value]);
      expect(unparsedValueMentions(text, "amount")).toEqual([]);
    });
  }

  // "1 500 TL" may be item 1 and 500 TL, or 1.500 TL: neither is guessed,
  // and the census names the text as unread.
  const AMBIGUOUS: ReadonlyArray<readonly [string, string]> = [
    ["1 500 TL", "1 500 TL"],
    ["Taksit 3 500 TL", "Taksit 3 500 TL"],
    ["Taksit 3 500,00 TL", "Taksit 3 500,00 TL"],
    ["TL 3 500 ödendi", "TL 3 500"],
    ["₺3 500 ödendi", "₺3 500"],
  ];
  for (const [text, mention] of AMBIGUOUS) {
    it(`not guessed, named as unread: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text)).toEqual([]);
      expect(unparsedValueMentions(text, "amount")).toEqual([mention]);
    });
  }

  it("the matter analysis keeps a payment table's amounts", () => {
    const table = ["15.09.2023 45.000,00 TL kira ödemesi", "15.10.2023 46.000,00 TL kira ödemesi", "Taksit 3 15.000 TL"].join("\n");
    const { observations } = runExhaustiveAnalysis([onePageDocument("odeme", table)]);
    expect(
      observations.filter((observation) => observation.propositionKind === "amount").map((observation) => observation.normalizedValue),
    ).toEqual(["4500000", "4600000", "1500000"]);
  });
});

/** The relations the matter analysis reports between two one-page documents. */
function relationsBetween(left: string, right: string) {
  return runExhaustiveAnalysis([onePageDocument("f1", left), onePageDocument("f2", right)]).relations;
}

/**
 * Second verifier round. extract-v4 read ANY number after a currency code as
 * an amount, even on the next line ("Ödemeler TL 12 eşit taksitte" -> 12 TL,
 * "USD/TL 2023 yılı" -> 2.023 TL, "para birimi: TL" + "4." -> 4 TL, and a
 * "4 TL ve 5 TL" contradiction from two article numbers), and joined every
 * plain-space group after the first ("45 000 540 000 TL" -> 45.000.540.000 TL,
 * a contradiction against "540 000 TL"). Neither is guessed now. Each block
 * below fails on extract-v4.
 */
describe("R2-22 second verifier round · a number after a currency is an amount only when it is shaped like one, on its line", () => {
  // A count, a year, a term, an unshaped figure: never read, named as unread.
  const NOT_AN_AMOUNT: ReadonlyArray<readonly [string, string]> = [
    ["Ödemeler TL 12 eşit taksitte yapılır.", "Ödemeler TL 12 eşit"],
    ["Kur farkı USD/TL 2023 yılı ortalamasına göre hesaplanır.", "Kur farkı USD/TL 2023"],
    ["Döviz: USD 12 ay vadeli", "Döviz: USD 12 ay"],
    ["Bedel USD 500 ödenecektir.", "Bedel USD 500"],
    ["Bedel CHF 750 olarak ödenmiştir.", "Bedel CHF 750"],
    ["Bedel ₺ 500 ödenecektir.", "Bedel ₺ 500"],
    ["Bedel € 12 ödendi", "Bedel € 12 ödendi"],
    ["Bedel USD 2 bina ödenecektir.", "Bedel USD 2 bina"],
  ];
  for (const [text, mention] of NOT_AN_AMOUNT) {
    it(`not read, named: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text)).toEqual([]);
      expect(unparsedValueMentions(text, "amount")).toEqual([mention]);
    });
  }

  // A currency and a number on different lines are not one amount, but the
  // pair is named. This used to pin [] ("no digit shares the currency's
  // line"): the third verifier round showed that the same silence dropped a
  // wrapped real amount ("7500" / "TL ödemeyi") from a COMPLETE census.
  const ACROSS_LINES: ReadonlyArray<readonly [string, string]> = [
    ["Bedelin para birimi: TL\n4. Kiranın ödenmesi her ay yapılır.", "Bedelin para birimi: TL 4. Kiranın"],
    ["Tutar TL\n1. Kira bedeli", "Tutar TL 1. Kira"],
    ["Madde 45\nTL cinsinden ödeme yapılır.", "Madde 45 TL cinsinden"],
  ];
  for (const [text, mention] of ACROSS_LINES) {
    it(`not one amount across a line, named: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text)).toEqual([]);
      expect(unparsedValueMentions(text, "amount")).toEqual([mention]);
    });
  }

  // Amount-shaped numbers, scale words and a symbol against its digits are still read.
  const STILL_READ: ReadonlyArray<readonly [string, string]> = [
    ["Bedel TL 45.000 ödenecektir.", "4500000"],
    ["Bedel TL45.000 ödenecektir.", "4500000"],
    ["Bedel TL 12,50 ödenecektir.", "1250"],
    ["Bedel USD 1.500,00 ödenecektir.", "150000 USD"],
    ["Bedel EUR 1,5 milyon ödenecektir.", "150000000 EUR"],
    ["Bedel USD 2 milyon ödenecektir.", "200000000 USD"],
    ["Bedel € 1.500 ödenecektir.", "150000 EUR"],
    ["Bedel ₺500 ödenecektir.", "50000"],
    ["Kira bedeli\n45.000,00\nTL olarak ödenir.", "4500000"],
    ["Kira bedeli 45 bin\nTL olarak ödenir.", "4500000"],
    ["Bedel 45.000 TL 12 eşit taksitte ödenir.", "4500000"],
  ];
  for (const [text, value] of STILL_READ) {
    it(`still read: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text).map((draft) => draft.normalizedValue)).toEqual([value]);
      expect(unparsedValueMentions(text, "amount")).toEqual([]);
    });
  }

  it("the matter analysis reports no contradiction between two article numbers or two exchange-rate years", () => {
    expect(
      relationsBetween(
        "Kira bedeli ve para birimi: TL\n4. Kiranın ödenmesi her ayın ilk haftasında yapılır.",
        "Kira bedeli ve para birimi: TL\n5. Kiranın ödenmesi her ayın ilk haftasında yapılır.",
      ),
    ).toEqual([]);
    expect(
      relationsBetween("Sözleşmede EUR/TL 2023 yılı ortalama kuru esas alınır.", "Sözleşmede EUR/TL 2024 yılı ortalama kuru esas alınır."),
    ).toEqual([]);
    // A real pair written with a code still is one.
    const real = relationsBetween("Kiracı teminat olarak TL 1.500 yatırmıştır.", "Kiracı teminat olarak TL 1.600 yatırmıştır.");
    expect(real.map((relation) => relation.relation)).toEqual(["CONTRADICTION"]);
    expect(real[0]!.rationale).toContain("1.500 TL ve 1.600 TL");
  });
});

describe("R2-22 second verifier round · a row of plain-space groups is never guessed into one amount", () => {
  const AMBIGUOUS_ROWS: ReadonlyArray<readonly [string, string]> = [
    ["Bedel 45 000 500 TL", "Bedel 45 000 500 TL"],
    ["Toplam 3 000 250 TL", "Toplam 3 000 250 TL"],
    ["Tutar 1 050 500 TL", "Tutar 1 050 500 TL"],
    ["Tutar 1 000 250 TL", "Tutar 1 000 250 TL"],
    ["Tutar 45 000 540 000 TL", "Tutar 45 000 540 000 TL"],
    ["TL 45 000 500 ödendi", "TL 45 000 500"],
    ["TL 1 050 500 ödendi", "TL 1 050 500"],
  ];
  for (const [text, mention] of AMBIGUOUS_ROWS) {
    it(`not guessed, named as unread: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text)).toEqual([]);
      expect(unparsedValueMentions(text, "amount")).toEqual([mention]);
    });
  }

  it("groups that all start with 0, or no-break spaces, are still one amount", () => {
    expect(amounts("Bedel 1 050 000 TL").map((draft) => draft.normalizedValue)).toEqual(["105000000"]);
    expect(amounts(`Bedel 1${NBSP}050${NBSP}500 TL`).map((draft) => draft.normalizedValue)).toEqual(["105050000"]);
  });

  it("the matter analysis reports no contradiction from a flattened two-column row", () => {
    expect(
      relationsBetween("Kiracı teminat bedeli 45 000 540 000 TL olarak yatırmıştır.", "Kiracı teminat bedeli 540 000 TL olarak yatırmıştır."),
    ).toEqual([]);
    // The second document's amount is still read.
    expect(amounts("Kiracı teminat bedeli 540 000 TL olarak yatırmıştır.").map((draft) => draft.normalizedValue)).toEqual(["54000000"]);
  });
});

/**
 * The review grid's census, as reviewTables/worker.ts extractCell decides it:
 * COMPLETE only when every page was read (here: one fully read unit) AND no
 * value-like text was left unread.
 */
function censusStatus(text: string, kind: "date" | "amount"): "COMPLETE" | "PARTIAL" {
  return unparsedValueMentions(text, kind).length === 0 ? "COMPLETE" : "PARTIAL";
}

/**
 * Third verifier round. extract-v5 stopped reading a bare number and a
 * currency on different lines, but unparsedValueMentions looked for a digit
 * only on the currency's own line, so a wrapped amount (pypdf keeps a visual
 * line wrap as "\n") was neither read nor named and the census said COMPLETE
 * with "tanınan biçimlerde yazılmış bir tutar bulunmadı". And a code before a
 * one-decimal figure was still money ("Kredi USD 1,5 yıl" -> 1,50 USD). Each
 * block below fails on extract-v5.
 */
describe("R2-22 third verifier round · a value split by a line wrap is named, never silently dropped", () => {
  const WRAPPED_AMOUNTS: ReadonlyArray<readonly [string, string]> = [
    ["Kiracı, aylık kira bedeli olarak 7500\nTL ödemeyi kabul ve taahhüt eder.", "kira bedeli olarak 7500 TL ödemeyi"],
    ["Davacı tarafından yatırılan 850\nTL gider avansının iadesine karar verildi.", "tarafından yatırılan 850 TL gider"],
    ["Tutar TL\n45.000,00", "Tutar TL 45.000,00"],
    ["Kira bedeli: ₺\n7500", "Kira bedeli: ₺ 7500"],
    ["Kira 7500\r\nTL olarak ödenir.", "Kira 7500 TL olarak"],
    ["Kira 7500.-\nTL olarak ödenir.", "Kira 7500.- TL olarak"],
    ["Kira 7500\n\nTL olarak ödenir.", "Kira 7500 TL olarak"],
    ["Bedel TL\n\n45.000,00 olarak ödenir.", "Bedel TL 45.000,00"],
    ["Tutar (TL)\n45.000,00", "Tutar (TL) 45.000,00"],
    ["Kira 7500\nTürk Lirası olarak ödenir.", "Kira 7500 Türk Lirası olarak"],
    ["Bedel USD\n2 milyon olarak ödenir.", "Bedel USD 2 milyon"],
  ];
  for (const [text, mention] of WRAPPED_AMOUNTS) {
    it(`not guessed, named: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text)).toEqual([]);
      expect(unparsedValueMentions(text, "amount")).toEqual([mention]);
      expect(censusStatus(text, "amount")).toBe("PARTIAL");
    });
  }

  it("the verifier's contract: its only amount wraps, so the census is PARTIAL, not an empty COMPLETE", () => {
    const contract = [
      "KİRA SÖZLEŞMESİ",
      "Kiracı, aylık kira bedeli olarak 7500",
      "TL ödemeyi kabul ve taahhüt eder. Kira her ayın ilk haftasında ödenir.",
    ].join("\n");
    expect(censusAmounts(contract)).toEqual([]);
    expect(unparsedValueMentions(contract, "amount")).toEqual(["kira bedeli olarak 7500 TL ödemeyi"]);
    expect(censusStatus(contract, "amount")).toBe("PARTIAL");
  });

  it("a month name split from its year by a wrap is named like the same text on one line", () => {
    expect(unparsedValueMentions("Ödeme Eylül 2023 ayında yapılmıştır.", "date")).toEqual(["Ödeme Eylül 2023 ayında"]);
    expect(unparsedValueMentions("Ödeme Eylül\n2023 ayında yapılmıştır.", "date")).toEqual(["Ödeme Eylül 2023 ayında yapılmıştır"]);
    expect(censusStatus("Ödeme Eylül\n2023 ayında yapılmıştır.", "date")).toBe("PARTIAL");
    // The year may follow on the next line: that date is read, and is not a mention.
    expect(dates("Sözleşme 15 Eylül\n2023 tarihinde imzalandı.")).toEqual(["2023-09-15"]);
    expect(unparsedValueMentions("Sözleşme 15 Eylül\n2023 tarihinde imzalandı.", "date")).toEqual([]);
  });

  it("a day and a month on different lines are not one date: a page number or article number is never made a day", () => {
    // extract-v5 read each of these as a precise date the text does not state (03.09.2023, 12.11.2023).
    const pageBreak = "Kiracı bu tutarı ödemiştir.\n3\nEylül 2023 tarihli ihtarname tebliğ edilmiştir.";
    expect(dates(pageBreak)).toEqual([]);
    expect(unparsedValueMentions(pageBreak, "date")).toEqual(["Eylül 2023 tarihli"]);
    const article = "Madde 12\nKasım 2023 ayında teslim yapılır.";
    expect(dates(article)).toEqual([]);
    expect(unparsedValueMentions(article, "date")).toEqual(["Kasım 2023 ayında"]);
    // A real wrap between day and month is named the same way, never guessed.
    const wrapped = "Sözleşme 15\nEylül 2023 tarihinde imzalandı.";
    expect(dates(wrapped)).toEqual([]);
    expect(unparsedValueMentions(wrapped, "date")).toEqual(["Eylül 2023 tarihinde"]);
    expect(censusStatus(wrapped, "date")).toBe("PARTIAL");
  });

  // Only a number at the facing EDGE of the neighbouring line counts; a read
  // amount's own currency is never named again.
  const NOT_A_WRAP: readonly string[] = [
    "Sözleşme 2023 yılında imzalandı\nTL cinsinden ödeme yapılır.",
    "Bedel 45.000 TL\n12 ay boyunca ödenir.",
    "Kira bedeli\n45.000,00\nTL olarak ödenir.",
    "Kira bedeli 45 bin\nTL olarak ödenir.",
    "Madde 45\nTL 45.000 ödenecektir.",
    "Aralık verilmeden yapılan ödemeler\n3 gün içinde incelenir.",
  ];
  for (const text of NOT_A_WRAP) {
    it(`nothing to name: ${JSON.stringify(text)}`, () => {
      expect(unparsedValueMentions(text, "amount")).toEqual([]);
      expect(unparsedValueMentions(text, "date")).toEqual([]);
    });
  }

  // A code or a spaced symbol before a one-decimal figure is a term or a multiple as often as money.
  const ONE_DECIMAL: ReadonlyArray<readonly [string, string]> = [
    ["Kredi USD 1,5 yıl vadelidir.", "Kredi USD 1,5"],
    ["Ödeme TL 2,5 katı olarak hesaplanır.", "Ödeme TL 2,5"],
    ["Bedel € 1,5 ödendi", "Bedel € 1,5"],
    ["Madde 12,5\nTL cinsinden ödeme yapılır.", "Madde 12,5 TL cinsinden"],
  ];
  for (const [text, mention] of ONE_DECIMAL) {
    it(`one decimal place after a currency: not read, named: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text)).toEqual([]);
      expect(unparsedValueMentions(text, "amount")).toEqual([mention]);
    });
  }

  const STILL_READ_V6: ReadonlyArray<readonly [string, string]> = [
    ["Bedel TL 12,50 ödenecektir.", "1250"],
    ["Bedel EUR 1,5 milyon ödenecektir.", "150000000 EUR"],
    ["Bedel ₺2,5 ödendi", "250"],
    ["Bedel 2,5 TL ödendi", "250"],
    ["Madde 12,50\nTL cinsinden ödeme yapılır.", "1250"],
    // A currency in two words sits on the number's line when its first word does.
    ["Kira 7500 Türk\nLirası olarak ödenir.", "750000"],
  ];
  for (const [text, value] of STILL_READ_V6) {
    it(`still read: ${JSON.stringify(text)}`, () => {
      expect(censusAmounts(text).map((draft) => draft.normalizedValue)).toEqual([value]);
      expect(unparsedValueMentions(text, "amount")).toEqual([]);
    });
  }

  it("the matter analysis builds no contradiction from a figure it no longer guesses into an amount", () => {
    // extract-v5: "12,5 TL ve 9.500 TL" and "2,5 TL ve 3,5 TL", both CONTRADICTION.
    expect(
      relationsBetween(
        "Kiracı, aylık kira bedeli olarak 12,5\nTL ödemeyi kabul eder.",
        "Kiracı, aylık kira bedeli olarak 9500 TL ödemeyi kabul eder.",
      ),
    ).toEqual([]);
    expect(relationsBetween("Ödeme TL 2,5 katı olarak hesaplanır.", "Ödeme TL 3,5 katı olarak hesaplanır.")).toEqual([]);
  });
});

describe("W21 closing re-check: an exchange rate is not an amount", () => {
  it("reads no amount from a currency pair, and names the mention instead", () => {
    for (const text of ["Kur EUR/TL 35,12 olarak alınır.", "Kur USD/TL 32,50 olarak alınır.", "EUR / TL 36,40 kuru uygulanır."]) {
      const amounts = extractPropositions(text).filter((proposition) => proposition.kind === "amount");
      expect(amounts, text).toEqual([]);
      expect(unparsedValueMentions(text, "amount").length, text).toBeGreaterThan(0);
    }
    // control: the same shapes without a pair are still read
    expect(extractPropositions("Sözleşme bedeli TL 35,12 olarak belirlendi.").filter((p) => p.kind === "amount")).toHaveLength(1);
    expect(extractPropositions("Sözleşme bedeli 45.000,00 TL olarak belirlendi.").filter((p) => p.kind === "amount")).toHaveLength(1);
  });
});
