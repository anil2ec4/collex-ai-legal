/**
 * Civil-date helpers: strict ISO parsing, GG.AA.YYYY formatting, Turkish
 * weekday names and HMK m.92/2 month arithmetic (corresponding day, else the
 * month's last day). Pure UTC math — no time-zone drift.
 */

import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  addYears,
  compareDates,
  daysBetween,
  daysInMonth,
  formatTrLong,
  isWeekend,
  parseIsoDate,
  toIsoDate,
  toTrDate,
  weekdayIndex,
  weekdayName,
} from "../../src/deadlines/dates.js";

describe("parseIsoDate", () => {
  it("accepts real calendar days only", () => {
    expect(parseIsoDate("2026-09-03")).toEqual({ year: 2026, month: 9, day: 3 });
    expect(parseIsoDate("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
    for (const bad of [
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-9-3",
      "03.09.2026",
      "",
      "2026-09-03T00:00:00Z",
      "1899-12-31",
      "2201-01-01",
    ]) {
      expect(parseIsoDate(bad), bad).toBeUndefined();
    }
  });
});

describe("weekdays and formatting", () => {
  it("names weekdays in Turkish, Pazartesi first", () => {
    expect(weekdayName({ year: 2026, month: 9, day: 3 })).toBe("Perşembe");
    expect(weekdayName({ year: 2026, month: 8, day: 30 })).toBe("Pazar");
    expect(weekdayName({ year: 2026, month: 9, day: 7 })).toBe("Pazartesi");
    expect(weekdayIndex({ year: 2026, month: 9, day: 7 })).toBe(0);
    expect(isWeekend({ year: 2026, month: 9, day: 5 })).toBe(true);
    expect(isWeekend({ year: 2026, month: 9, day: 4 })).toBe(false);
  });

  it("formats GG.AA.YYYY for users and YYYY-MM-DD on the wire", () => {
    const date = { year: 2026, month: 9, day: 3 };
    expect(toTrDate(date)).toBe("03.09.2026");
    expect(toIsoDate(date)).toBe("2026-09-03");
    expect(formatTrLong(date)).toBe("03.09.2026 (Perşembe)");
  });
});

describe("day arithmetic", () => {
  it("adds days across month and year boundaries without drift", () => {
    expect(toIsoDate(addDays({ year: 2026, month: 3, day: 28 }, 3))).toBe("2026-03-31");
    expect(toIsoDate(addDays({ year: 2026, month: 12, day: 25 }, 14))).toBe("2027-01-08");
    expect(toIsoDate(addDays({ year: 2028, month: 2, day: 28 }, 1))).toBe("2028-02-29");
    expect(toIsoDate(addDays({ year: 2026, month: 1, day: 1 }, -1))).toBe("2025-12-31");
  });

  it("measures whole days and compares", () => {
    expect(daysBetween({ year: 2026, month: 9, day: 3 }, { year: 2026, month: 9, day: 17 })).toBe(14);
    expect(compareDates({ year: 2026, month: 9, day: 3 }, { year: 2026, month: 9, day: 4 })).toBe(-1);
    expect(compareDates({ year: 2026, month: 9, day: 3 }, { year: 2026, month: 9, day: 3 })).toBe(0);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("month arithmetic (HMK m.92/2)", () => {
  it("31 Ocak + 1 ay clamps to the last day of Şubat", () => {
    expect(addMonths({ year: 2027, month: 1, day: 31 }, 1)).toEqual({
      date: { year: 2027, month: 2, day: 28 },
      clamped: true,
    });
    expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
      date: { year: 2028, month: 2, day: 29 },
      clamped: true,
    });
  });

  it("keeps the corresponding day when it exists", () => {
    expect(addMonths({ year: 2026, month: 3, day: 15 }, 1)).toEqual({
      date: { year: 2026, month: 4, day: 15 },
      clamped: false,
    });
    expect(addMonths({ year: 2026, month: 12, day: 15 }, 2)).toEqual({
      date: { year: 2027, month: 2, day: 15 },
      clamped: false,
    });
    expect(addMonths({ year: 2026, month: 3, day: 31 }, 6).date).toEqual({ year: 2026, month: 9, day: 30 });
  });

  it("year arithmetic clamps 29 Şubat", () => {
    expect(addYears({ year: 2028, month: 2, day: 29 }, 1)).toEqual({
      date: { year: 2029, month: 2, day: 28 },
      clamped: true,
    });
    expect(addYears({ year: 2026, month: 2, day: 28 }, 1).date).toEqual({ year: 2027, month: 2, day: 28 });
  });
});
