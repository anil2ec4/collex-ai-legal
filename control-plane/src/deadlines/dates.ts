/**
 * Deterministic civil-date helpers for the deadline calculator.
 *
 * Every arithmetic step goes through `Date.UTC` so the host time zone and DST
 * transitions can never shift a day. Dates are plain `{year, month, day}`
 * records (month 1..12); the ISO wire form is `YYYY-MM-DD`, the user-facing
 * form is `GG.AA.YYYY` (contract: dates are GG.AA.YYYY on every user-facing
 * surface). No libraries.
 */

export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MS_PER_DAY = 86_400_000;

/** Weekday names, index 0 = Pazartesi … 6 = Pazar. */
export const WEEKDAY_NAMES_TR = [
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
  "Pazar",
] as const;

export type WeekdayNameTr = (typeof WEEKDAY_NAMES_TR)[number];

/** Number of days in `month` (1..12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  // Date.UTC(year, month, 0) with a 1-based month is the last day of that month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Strict `YYYY-MM-DD` parser: real calendar days only (no 2026-02-30), years
 * 1900..2200 (Date.UTC maps 0..99 to 1900..1999, so the floor also guards that).
 */
export function parseIsoDate(text: string): CivilDate | undefined {
  const match = text.match(ISO_DATE_RE);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return undefined;
  if (!isValidCivilDate(year, month, day)) return undefined;
  return { year, month, day };
}

function toUtcMs(date: CivilDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromUtcMs(ms: number): CivilDate {
  const parsed = new Date(ms);
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/**
 * Month arithmetic per HMK m.92/2 (and İİK m.19, CMK m.39/3): the period ends
 * on the day of the last month that corresponds to the start day; when that
 * month has no such day it ends on the month's last day (`clamped: true`).
 */
export function addMonths(date: CivilDate, months: number): { date: CivilDate; clamped: boolean } {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const last = daysInMonth(year, month);
  const clamped = date.day > last;
  return { date: { year, month, day: clamped ? last : date.day }, clamped };
}

export function addYears(date: CivilDate, years: number): { date: CivilDate; clamped: boolean } {
  return addMonths(date, years * 12);
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareDates(a: CivilDate, b: CivilDate): number {
  return Math.sign(toUtcMs(a) - toUtcMs(b));
}

export function sameDate(a: CivilDate, b: CivilDate): boolean {
  return compareDates(a, b) === 0;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}

/** 0 = Pazartesi … 6 = Pazar. */
export function weekdayIndex(date: CivilDate): number {
  const sundayBased = new Date(toUtcMs(date)).getUTCDay();
  return (sundayBased + 6) % 7;
}

export function weekdayName(date: CivilDate): WeekdayNameTr {
  return WEEKDAY_NAMES_TR[weekdayIndex(date)] as WeekdayNameTr;
}

export function isWeekend(date: CivilDate): boolean {
  return weekdayIndex(date) >= 5;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Wire form: YYYY-MM-DD. */
export function toIsoDate(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** User-facing form: GG.AA.YYYY. */
export function toTrDate(date: CivilDate): string {
  return `${pad2(date.day)}.${pad2(date.month)}.${date.year}`;
}

/** "03.09.2026 (Perşembe)". */
export function formatTrLong(date: CivilDate): string {
  return `${toTrDate(date)} (${weekdayName(date)})`;
}

export const MONTH_NAMES_TR = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
] as const;

export function monthNameTr(month: number): string {
  return MONTH_NAMES_TR[month - 1] ?? String(month);
}
