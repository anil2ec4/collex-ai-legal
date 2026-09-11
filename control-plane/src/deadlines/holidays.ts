/**
 * Turkish official holidays (2429 sayılı Ulusal Bayram ve Genel Tatiller
 * Hakkında Kanun) and the adli tatil window (HMK m.102 / İYUK m.61).
 *
 * Fixed-date holidays are statutory and stable. Religious holidays move with
 * the lunar calendar; the dates below follow the Diyanet İşleri Başkanlığı
 * calendar for 2025–2028 — "Diyanet takvimi — doğrulayın": verify against the
 * published calendar every year, they are data, not law.
 *
 * Half-day eves (bayram arifesi from 13:00, 28 Ekim from 13:00 — 2429 m.2)
 * are deliberately NOT counted as holidays: treating them as working days
 * yields the EARLIER, conservative deadline. The calculator surfaces them as
 * a note instead. Administrative leave days (idari izin) announced around
 * bayrams are not statutory holidays and never extend a period.
 */

import {
  addDays,
  compareDates,
  isWeekend,
  parseIsoDate,
  toIsoDate,
  type CivilDate,
} from "./dates.js";

export type HolidayKind = "ulusal" | "dini" | "yarim";

export interface HolidayInfo {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  kind: HolidayKind;
  /** Statutory basis or calendar source (Turkish, user-facing). */
  source: string;
}

const SOURCE_2429 = "2429 sayılı Kanun m.1–2";
const SOURCE_DIYANET = "Diyanet takvimi — doğrulayın";

const FIXED_HOLIDAYS: readonly { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "Yılbaşı" },
  { month: 4, day: 23, name: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { month: 5, day: 1, name: "Emek ve Dayanışma Günü" },
  { month: 5, day: 19, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { month: 7, day: 15, name: "Demokrasi ve Millî Birlik Günü" },
  { month: 8, day: 30, name: "Zafer Bayramı" },
  { month: 10, day: 29, name: "Cumhuriyet Bayramı" },
];

/**
 * First day of each bayram (Ramazan: 3 days, Kurban: 4 days); the eve is a
 * half-day. Source: Diyanet takvimi — doğrulayın.
 */
const RELIGIOUS_HOLIDAYS: Readonly<Record<number, { ramazan: string; kurban: string }>> = {
  2025: { ramazan: "2025-03-30", kurban: "2025-06-06" },
  2026: { ramazan: "2026-03-20", kurban: "2026-05-27" },
  2027: { ramazan: "2027-03-09", kurban: "2027-05-16" },
  2028: { ramazan: "2028-02-26", kurban: "2028-05-05" },
};

export const RELIGIOUS_CALENDAR_YEARS: readonly number[] = Object.keys(RELIGIOUS_HOLIDAYS)
  .map(Number)
  .sort((a, b) => a - b);

export function religiousCalendarCovers(year: number): boolean {
  return Object.prototype.hasOwnProperty.call(RELIGIOUS_HOLIDAYS, year);
}

const ORDINALS = ["1.", "2.", "3.", "4."] as const;

function religiousBlock(firstDay: string, label: string, length: number): HolidayInfo[] {
  const first = parseIsoDate(firstDay);
  if (first === undefined) return [];
  const out: HolidayInfo[] = [
    {
      date: toIsoDate(addDays(first, -1)),
      name: `${label} arifesi (saat 13.00'ten itibaren tatil)`,
      kind: "yarim",
      source: `2429 sayılı Kanun m.2 — ${SOURCE_DIYANET}`,
    },
  ];
  for (let index = 0; index < length; index += 1) {
    out.push({
      date: toIsoDate(addDays(first, index)),
      name: `${label} ${ORDINALS[index] ?? `${index + 1}.`} günü`,
      kind: "dini",
      source: SOURCE_DIYANET,
    });
  }
  return out;
}

const YEAR_CACHE = new Map<number, Map<string, HolidayInfo>>();

function yearTable(year: number): Map<string, HolidayInfo> {
  const cached = YEAR_CACHE.get(year);
  if (cached !== undefined) return cached;
  const table = new Map<string, HolidayInfo>();
  for (const fixed of FIXED_HOLIDAYS) {
    const iso = toIsoDate({ year, month: fixed.month, day: fixed.day });
    table.set(iso, { date: iso, name: fixed.name, kind: "ulusal", source: SOURCE_2429 });
  }
  const halfOctober = toIsoDate({ year, month: 10, day: 28 });
  table.set(halfOctober, {
    date: halfOctober,
    name: "Cumhuriyet Bayramı arifesi (28 Ekim saat 13.00'ten itibaren tatil)",
    kind: "yarim",
    source: SOURCE_2429,
  });
  const religious = RELIGIOUS_HOLIDAYS[year];
  if (religious !== undefined) {
    for (const entry of [
      ...religiousBlock(religious.ramazan, "Ramazan Bayramı", 3),
      ...religiousBlock(religious.kurban, "Kurban Bayramı", 4),
    ]) {
      // A full holiday wins over a half-day marker on the same date.
      const existing = table.get(entry.date);
      if (existing === undefined || (existing.kind === "yarim" && entry.kind !== "yarim")) {
        table.set(entry.date, entry);
      }
    }
  }
  YEAR_CACHE.set(year, table);
  return table;
}

/** All holiday markers of a year (full days and half-day eves), sorted by date. */
export function holidaysForYear(year: number): HolidayInfo[] {
  return [...yearTable(year).values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function toCivil(input: CivilDate | string): CivilDate | undefined {
  return typeof input === "string" ? parseIsoDate(input) : input;
}

/** Full-day statutory holiday on that date (half-day eves excluded), else undefined. */
export function isHoliday(input: CivilDate | string): HolidayInfo | undefined {
  const date = toCivil(input);
  if (date === undefined) return undefined;
  const entry = yearTable(date.year).get(toIsoDate(date));
  return entry !== undefined && entry.kind !== "yarim" ? entry : undefined;
}

/** Half-day marker (arife / 28 Ekim) on that date, else undefined. */
export function halfDayInfo(input: CivilDate | string): HolidayInfo | undefined {
  const date = toCivil(input);
  if (date === undefined) return undefined;
  const entry = yearTable(date.year).get(toIsoDate(date));
  return entry !== undefined && entry.kind === "yarim" ? entry : undefined;
}

/** Not a weekend and not a full-day holiday. Half-day eves count as working days. */
export function isWorkingDay(input: CivilDate | string): boolean {
  const date = toCivil(input);
  if (date === undefined) return false;
  return !isWeekend(date) && isHoliday(date) === undefined;
}

/** The date itself when it is a working day, else the first working day after it. */
export function firstWorkingDayOnOrAfter(date: CivilDate): CivilDate {
  let cursor = date;
  // Bounded: the longest non-working run is a bayram block plus a weekend.
  for (let guard = 0; guard < 31; guard += 1) {
    if (isWorkingDay(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** First working day strictly after `date`. */
export function nextWorkingDay(date: CivilDate): CivilDate {
  return firstWorkingDayOnOrAfter(addDays(date, 1));
}

// ---------------------------------------------------------------------------
// Adli tatil (HMK m.102) / çalışmaya ara verme (İYUK m.61): 20 Temmuz–31 Ağustos
// ---------------------------------------------------------------------------

export const ADLI_TATIL_LABEL = "20 Temmuz–31 Ağustos";

export function adliTatilRange(year: number): { start: CivilDate; end: CivilDate } {
  return { start: { year, month: 7, day: 20 }, end: { year, month: 8, day: 31 } };
}

export function isAdliTatil(date: CivilDate): boolean {
  const range = adliTatilRange(date.year);
  return compareDates(date, range.start) >= 0 && compareDates(date, range.end) <= 0;
}

/**
 * True when any day in the half-open window (after, upTo] falls inside an
 * adli tatil — used for the CMK m.331/4 warning ("süreler işlemez").
 */
export function periodTouchesAdliTatil(after: CivilDate, upTo: CivilDate): boolean {
  for (const year of new Set([after.year, upTo.year])) {
    const range = adliTatilRange(year);
    if (compareDates(range.start, upTo) <= 0 && compareDates(range.end, after) > 0) return true;
  }
  return false;
}
