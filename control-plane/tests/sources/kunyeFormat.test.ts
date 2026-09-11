/**
 * W17 — how a search row is printed as a künye, and how its date is printed.
 *
 * MEASURED, 06.09.2026 against a live probe server (`collex_demo`, real MCP
 * gateway): the aleyhe-kaynak rows of a real petition report all looked like
 *
 *   Yargıtay 11. Hukuk Dairesi · Yargıtay 11. Hukuk Dairesi E. 2026/5892
 *   K. 2026/4208 · 2026/5892 · 2026/4208
 *
 * because the lane joined `court`, `title`, `docketNo` and `decisionNo` blindly
 * and the provider's `title` already contained all three. One of the same rows
 * carried `decisionDate: "6006-09-20"`, which was printed as a bare date.
 */

import { describe, expect, it } from "vitest";
import {
  KUNYE_YEAR_MAX,
  KUNYE_YEAR_MIN,
  UNREADABLE_DATE_TR,
  formatDecisionDateNote,
  formatSourceKunye,
} from "../../src/sources/searchService.js";

describe("W17 · formatSourceKunye", () => {
  it("prints the real row ONCE, not three times", () => {
    const line = formatSourceKunye({
      court: "Yargıtay 11. Hukuk Dairesi",
      title: "Yargıtay 11. Hukuk Dairesi E. 2026/5892 K. 2026/4208",
      docketNo: "2026/5892",
      decisionNo: "2026/4208",
    });
    expect(line).toBe("Yargıtay 11. Hukuk Dairesi E. 2026/5892 K. 2026/4208");
    // NON-VACUITY: the chamber and each number appear exactly once.
    const occurrences = (needle: string): number => line.split(needle).length - 1;
    expect(occurrences("Yargıtay 11. Hukuk Dairesi")).toBe(1);
    expect(occurrences("2026/5892")).toBe(1);
    expect(occurrences("2026/4208")).toBe(1);
  });

  it("adds the file numbers when the title does not carry them", () => {
    expect(
      formatSourceKunye({
        court: "Danıştay 10. Daire",
        title: "İdari işlemin iptali istemi",
        docketNo: "2024/117",
        decisionNo: "2025/882",
      }),
    ).toBe("Danıştay 10. Daire · İdari işlemin iptali istemi · E. 2024/117 K. 2025/882");
  });

  it("keeps a title that says something the court line does not", () => {
    const line = formatSourceKunye({
      court: "Yargıtay 15. Hukuk Dairesi",
      title: "Eser sözleşmesinden kaynaklanan alacak",
    });
    expect(line).toBe("Yargıtay 15. Hukuk Dairesi · Eser sözleşmesinden kaynaklanan alacak");
  });

  it("prints only the half it has", () => {
    expect(formatSourceKunye({ court: "Yargıtay 3. HD", docketNo: "2020/1" })).toBe(
      "Yargıtay 3. HD · E. 2020/1",
    );
    expect(formatSourceKunye({ title: "Karar" })).toBe("Karar");
    expect(formatSourceKunye({})).toBe("");
  });

  it("never repeats a part the line already carries, whatever the case", () => {
    // Turkish folding: "YARGITAY" and "Yargıtay" are the same court.
    const line = formatSourceKunye({
      court: "YARGITAY 9. HUKUK DAİRESİ",
      title: "Yargıtay 9. Hukuk Dairesi kararı",
    });
    expect(line.toLocaleLowerCase("tr-TR").split("yargıtay").length - 1).toBe(1);
  });
});

describe("W17 · formatDecisionDateNote", () => {
  it("labels the date and writes it the way a lawyer writes it", () => {
    expect(formatDecisionDateNote("2026-07-13")).toBe("Karar tarihi: 13.07.2026");
  });

  it("refuses to print an impossible year as a date", () => {
    // The row that was actually served.
    expect(formatDecisionDateNote("6006-09-20")).toBe(UNREADABLE_DATE_TR);
    expect(formatDecisionDateNote(`${KUNYE_YEAR_MIN - 1}-01-01`)).toBe(UNREADABLE_DATE_TR);
    expect(formatDecisionDateNote(`${KUNYE_YEAR_MAX + 1}-01-01`)).toBe(UNREADABLE_DATE_TR);
    // NON-VACUITY: the bounds themselves are accepted.
    expect(formatDecisionDateNote(`${KUNYE_YEAR_MIN}-01-01`)).toContain("Karar tarihi");
    expect(formatDecisionDateNote(`${KUNYE_YEAR_MAX}-12-31`)).toContain("Karar tarihi");
  });

  it("refuses a malformed date rather than passing provider text through", () => {
    expect(formatDecisionDateNote("13.07.2026")).toBe(UNREADABLE_DATE_TR);
    expect(formatDecisionDateNote("2026-13-01")).toBe(UNREADABLE_DATE_TR);
    expect(formatDecisionDateNote("2026-00-10")).toBe(UNREADABLE_DATE_TR);
    expect(formatDecisionDateNote("yakında")).toBe(UNREADABLE_DATE_TR);
  });

  it("says nothing at all when the source published no date", () => {
    // Absent is not "unreadable": the row simply carried no date.
    expect(formatDecisionDateNote(undefined)).toBe("");
    expect(formatDecisionDateNote("   ")).toBe("");
  });

  it("never reads as a finding about the decision itself", () => {
    expect(UNREADABLE_DATE_TR).toContain("Kaynak");
    expect(UNREADABLE_DATE_TR).not.toContain("yok");
  });
});
