/**
 * W20: which value pairs the contradiction engine COMPARES.
 *
 * The real-server verification of W20 showed the W19 topic key pairing a
 * contract date with a notice date ("İkisi birden doğru olamaz") while
 * missing the genuine contract-date conflict: the key was built from a
 * ±160-character window dominated by neighbouring filler. The key is now the
 * nearest stems inside the value's own clause. These 11 labeled synthetic
 * pairs are the measurement behind that change (W19 key: 6/11, clause key:
 * 10/11 at the unchanged 0.4 threshold); they pin the behaviour, and the one
 * known miss is pinned as a known miss.
 *
 * Synthetic sentences; nothing here measures real Turkish case files.
 */

import { describe, expect, it } from "vitest";
import { extractPropositions } from "../../src/exhaustive/observations.js";
import { DEFAULT_SUBJECT_OVERLAP, subjectOverlap } from "../../src/exhaustive/contradictions.js";

const FILLER =
  "Bu paragraf dosyanın hacmini artırmak için eklenmiş olup esasa ilişkin hiçbir bilgi" +
  " içermemektedir ve yalnızca metnin uzunluğunu sağlamak amacıyla buraya yazılmıştır.";

function subjectOf(sentence: string, value: string): string {
  const text = `Paragraf 1. ${FILLER}\n\n${sentence}\n\nParagraf 2. ${FILLER}`;
  const draft = extractPropositions(text).find((candidate) => candidate.quote.includes(value));
  if (draft === undefined) throw new Error(`no proposition for ${value}`);
  return draft.subject;
}

function compared(a: [string, string], b: [string, string]): boolean {
  return subjectOverlap(subjectOf(...a), subjectOf(...b)) >= DEFAULT_SUBJECT_OVERLAP;
}

const PAIRS: ReadonlyArray<readonly [string, boolean, [string, string], [string, string]]> = [
  ["contract dates", true,
    ["DAVA DILEKCESI\nDavaci Ahmet Yilmaz, kira sozlesmesi 01.02.2023 tarihinde imzalanmistir.", "01.02.2023"],
    ["BILIRKISI RAPORU\nKira sozlesmesi 01.05.2023 tarihinde imzalanmistir.", "01.05.2023"]],
  ["contract vs notice", false,
    ["BILIRKISI RAPORU\nKira sozlesmesi 01.05.2023 tarihinde imzalanmistir.", "01.05.2023"],
    ["Tahliye ihtari 11.03.2024 tarihinde teblig edilmistir.", "11.03.2024"]],
  ["amounts (ascii)", true,
    ["Odenen kira bedeli 45.000 TL olarak kayda gecmistir.", "45.000"],
    ["Inceleme sonucunda odenen kira bedeli 32.000 TL olarak tespit edilmistir.", "32.000"]],
  ["amounts (Turkish)", true,
    ["Davacının ödediği kira bedeli 45.000 TL olarak kayda geçmiştir.", "45.000"],
    ["İnceleme sonucunda ödenen kira bedeli 32.000 TL olarak tespit edilmiştir.", "32.000"]],
  ["same-subject amounts", true,
    ["Ödenen tutar 45.000 TL olarak kayda geçmiştir.", "45.000"],
    ["Ödenen tutar 32.000 TL olarak tespit edilmiştir.", "32.000"]],
  ["rent vs attorney fee", false,
    ["Kira bedeli 45.000 TL olarak ödenmiştir.", "45.000"],
    ["Vekalet ücreti 5.000 TL olarak belirlenmiştir.", "5.000"]],
  ["suit date vs contract date", false,
    ["Dava 05.01.2024 tarihinde açılmıştır.", "05.01.2024"],
    ["Kira sözleşmesi 01.02.2023 tarihinde imzalanmıştır.", "01.02.2023"]],
  ["interest ratios", true,
    ["Temerrüt faizi oranı %9 olarak uygulanmıştır.", "%9"],
    ["Temerrüt faizi oranı %12 olarak uygulanmıştır.", "%12"]],
  ["fault ratio vs interest ratio", false,
    ["Kusur oranı %80 olarak belirlenmiştir.", "%80"],
    ["Temerrüt faizi oranı %12 olarak uygulanmıştır.", "%12"]],
  ["two clauses in one sentence", false,
    ["Dava 05.01.2024 tarihinde açılmış, kira sözleşmesi ise 01.02.2023 tarihinde imzalanmıştır.", "05.01.2024"],
    ["Kira sözleşmesi 01.03.2023 tarihinde imzalanmıştır.", "01.03.2023"]],
];

describe("topic keys decide which values are compared", () => {
  it.each(PAIRS)("%s → compared: %s", (_name, expected, a, b) => {
    expect(compared(a, b)).toBe(expected);
  });

  // KNOWN MISS, pinned as such: "ihtar" and "ihtarname" stem differently, so
  // two notices served on different dates are not compared. If a better key
  // fixes this, this test fails and should become an ordinary case above.
  it.fails("notices of the same kind with different wording are compared (known miss)", () => {
    expect(
      compared(
        ["Tahliye ihtarı 11.03.2024 tarihinde tebliğ edilmiştir.", "11.03.2024"],
        ["İhtarname davalıya 18.03.2024 tarihinde tebliğ edilmiştir.", "18.03.2024"],
      ),
    ).toBe(true);
  });

  it("a key never contains the value itself", () => {
    expect(subjectOf("Ödenen tutar 45.000 TL olarak kayda geçmiştir.", "45.000")).not.toMatch(/\d/u);
  });
});
