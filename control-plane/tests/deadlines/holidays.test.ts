/**
 * Holiday table (2429 sayılı Kanun fixed days + Diyanet religious dates
 * 2025–2028), half-day eves as working days, working-day roll helpers and the
 * adli tatil window.
 */

import { describe, expect, it } from "vitest";

import { toIsoDate } from "../../src/deadlines/dates.js";
import {
  RELIGIOUS_CALENDAR_YEARS,
  adliTatilRange,
  firstWorkingDayOnOrAfter,
  halfDayInfo,
  holidaysForYear,
  isAdliTatil,
  isHoliday,
  isWorkingDay,
  nextWorkingDay,
  periodTouchesAdliTatil,
  religiousCalendarCovers,
} from "../../src/deadlines/holidays.js";

describe("2026 holiday table", () => {
  it("contains the seven fixed statutory days (2429 sayılı Kanun), 15 Temmuz included", () => {
    for (const iso of [
      "2026-01-01",
      "2026-04-23",
      "2026-05-01",
      "2026-05-19",
      "2026-07-15",
      "2026-08-30",
      "2026-10-29",
    ]) {
      const info = isHoliday(iso);
      expect(info, iso).toBeDefined();
      expect(info?.kind).toBe("ulusal");
      expect(info?.source).toContain("2429");
    }
    expect(isHoliday("2026-07-15")?.name).toBe("Demokrasi ve Millî Birlik Günü");
  });

  it("Ramazan Bayramı 20–22 Mart 2026 and Kurban Bayramı 27–30 Mayıs 2026 are full holidays; eves are half-days", () => {
    expect(isHoliday("2026-03-20")?.name).toContain("Ramazan Bayramı 1.");
    expect(isHoliday("2026-03-21")?.name).toContain("2.");
    expect(isHoliday("2026-03-22")?.name).toContain("3.");
    expect(isHoliday("2026-03-23")).toBeUndefined();
    expect(isHoliday("2026-03-19")).toBeUndefined();
    expect(halfDayInfo("2026-03-19")?.kind).toBe("yarim");

    expect(isHoliday("2026-05-27")?.name).toContain("Kurban Bayramı 1.");
    expect(isHoliday("2026-05-30")?.name).toContain("4.");
    expect(isHoliday("2026-05-31")).toBeUndefined();
    expect(halfDayInfo("2026-05-26")).toBeDefined();
    // Conservative choice: the eve counts as a working day (earlier deadline).
    expect(isWorkingDay("2026-05-26")).toBe(true);
    expect(isHoliday("2026-05-27")?.source).toContain("Diyanet");
  });

  it("28 Ekim is a half-day working day; 29 Ekim a holiday", () => {
    expect(halfDayInfo("2026-10-28")?.name).toContain("28 Ekim");
    expect(isWorkingDay("2026-10-28")).toBe(true);
    expect(isWorkingDay("2026-10-29")).toBe(false);
  });

  it("lists markers sorted and sourced", () => {
    const list = holidaysForYear(2026);
    const dates = list.map((entry) => entry.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    expect(list.filter((entry) => entry.kind === "ulusal")).toHaveLength(7);
    expect(list.filter((entry) => entry.kind === "dini")).toHaveLength(7);
    expect(list.filter((entry) => entry.kind === "yarim")).toHaveLength(3);
    for (const entry of list) {
      expect(entry.source.length).toBeGreaterThan(0);
      if (entry.kind === "dini") expect(entry.source).toContain("Diyanet takvimi — doğrulayın");
    }
  });

  it("covers 2025–2028 for religious dates and says so", () => {
    expect(RELIGIOUS_CALENDAR_YEARS).toEqual([2025, 2026, 2027, 2028]);
    expect(religiousCalendarCovers(2024)).toBe(false);
    expect(religiousCalendarCovers(2027)).toBe(true);
    // Outside the covered years fixed days still exist, religious ones do not.
    expect(isHoliday("2030-08-30")).toBeDefined();
    expect(holidaysForYear(2030).filter((entry) => entry.kind === "dini")).toHaveLength(0);
    // Sanity on the other covered years' first days.
    expect(isHoliday("2025-03-30")?.name).toContain("Ramazan");
    expect(isHoliday("2025-06-06")?.name).toContain("Kurban");
    expect(isHoliday("2027-03-09")?.name).toContain("Ramazan");
    expect(isHoliday("2027-05-16")?.name).toContain("Kurban");
    expect(isHoliday("2028-02-26")?.name).toContain("Ramazan");
    expect(isHoliday("2028-05-05")?.name).toContain("Kurban");
  });
});

describe("working-day helpers", () => {
  it("nextWorkingDay skips a bayram block plus the weekend: 26.05.2026 -> 01.06.2026", () => {
    expect(toIsoDate(nextWorkingDay({ year: 2026, month: 5, day: 26 }))).toBe("2026-06-01");
  });

  it("firstWorkingDayOnOrAfter keeps a working day and rolls Saturday to Monday", () => {
    expect(toIsoDate(firstWorkingDayOnOrAfter({ year: 2026, month: 9, day: 3 }))).toBe("2026-09-03");
    expect(toIsoDate(firstWorkingDayOnOrAfter({ year: 2026, month: 9, day: 5 }))).toBe("2026-09-07");
    // 30.08.2026 is a Sunday AND Zafer Bayramı -> Monday 31.08.2026.
    expect(toIsoDate(firstWorkingDayOnOrAfter({ year: 2026, month: 8, day: 30 }))).toBe("2026-08-31");
  });

  it("isWorkingDay rejects an unparsable string instead of throwing", () => {
    expect(isWorkingDay("2026-02-30")).toBe(false);
    expect(isHoliday("garbage")).toBeUndefined();
  });
});

describe("adli tatil (HMK m.102 / İYUK m.61)", () => {
  it("runs 20 Temmuz–31 Ağustos inclusive", () => {
    expect(adliTatilRange(2026)).toEqual({
      start: { year: 2026, month: 7, day: 20 },
      end: { year: 2026, month: 8, day: 31 },
    });
    expect(isAdliTatil({ year: 2026, month: 7, day: 19 })).toBe(false);
    expect(isAdliTatil({ year: 2026, month: 7, day: 20 })).toBe(true);
    expect(isAdliTatil({ year: 2026, month: 8, day: 31 })).toBe(true);
    expect(isAdliTatil({ year: 2026, month: 9, day: 1 })).toBe(false);
  });

  it("periodTouchesAdliTatil uses the half-open window (after, upTo]", () => {
    expect(periodTouchesAdliTatil({ year: 2026, month: 7, day: 10 }, { year: 2026, month: 7, day: 19 })).toBe(false);
    expect(periodTouchesAdliTatil({ year: 2026, month: 7, day: 10 }, { year: 2026, month: 7, day: 20 })).toBe(true);
    expect(periodTouchesAdliTatil({ year: 2026, month: 8, day: 31 }, { year: 2026, month: 9, day: 10 })).toBe(false);
    expect(periodTouchesAdliTatil({ year: 2026, month: 8, day: 30 }, { year: 2026, month: 9, day: 10 })).toBe(true);
    expect(periodTouchesAdliTatil({ year: 2026, month: 12, day: 1 }, { year: 2027, month: 9, day: 1 })).toBe(true);
  });
});
