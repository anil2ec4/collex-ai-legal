/**
 * iCalendar (RFC 5545) feed for deadlines and hearings — W14, B-17.
 *
 * Why a file and not an integration: De Jure ships hearing/tebligat tracking
 * as a Pro-only module (80.000 ₺/yıl); our answer is a plain `.ics` the lawyer
 * subscribes to (or double-clicks) in Outlook / Google Takvim. No OAuth, no
 * account, no data leaving the machine — the bytes are produced here and
 * downloaded over 127.0.0.1.
 *
 * Contract decisions:
 *  - A **deadline** is an all-day event (`DTSTART;VALUE=DATE`), because a
 *    procedural period ends on a DAY, not at a clock time. DTEND is the day
 *    after (RFC 5545 all-day DTEND is exclusive).
 *  - A **hearing** is a timed event of 60 minutes anchored to
 *    `TZID=Europe/Istanbul`, and the file carries a VTIMEZONE component for
 *    it (fixed +03:00 since 2016 — no DST rule, so one STANDARD component is
 *    the whole truth). Emitting the zone beats a floating time: Outlook shows
 *    the same wall-clock hour no matter what the machine's zone is.
 *  - `DEADLINE_DISCLAIMER` is embedded VERBATIM in the DESCRIPTION of every
 *    event that shows a computed date (CLAUDE.md invariant). It is embedded in
 *    hearing events too: a hearing card is read next to the deadlines.
 *  - Every line is folded at 75 octets and every text value escaped
 *    (`\\`, `;`, `,`, newline) per RFC 5545 §3.3.11.
 *
 * Pure: no clock beyond the injected `dtstamp`, no I/O, no store.
 */

import { DEADLINE_DISCLAIMER } from "../deadlines/rules.js";
import {
  HEARING_KIND_LABELS,
  ISO_DATE_RE,
  HHMM_RE,
  type HearingKind,
} from "./types.js";

export const ICS_PRODID = "-//ColleX//Dava Takvimi//TR";
export const ICS_TZID = "Europe/Istanbul";
/** Default length of a hearing block when no end time is known (minutes). */
export const HEARING_DEFAULT_MINUTES = 60;

export type IcsEventKind = "deadline" | "hearing";

export interface IcsEvent {
  /** Stable per item: the matter item id (UID = `<itemId>@collex.local`). */
  uid: string;
  kind: IcsEventKind;
  /** ISO 'YYYY-MM-DD'. */
  date: string;
  /** 'HH:MM' local (Europe/Istanbul); ignored for a deadline. */
  time?: string;
  summary: string;
  /** Free description lines; the disclaimer is appended by the builder. */
  description?: string;
  location?: string;
  /** How many days before the event the calendar should remind (0 = none). */
  alarmDaysBefore?: number;
  /**
   * Additive (27.09.2026): RFC 5545 §3.8.1.11 STATUS. Absent = CONFIRMED.
   * A postponed hearing is CANCELLED on its old date, so a subscribed
   * calendar strikes the old entry instead of keeping it as confirmed; it
   * gets no alarm either.
   */
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
}

/** RFC 5545 §3.3.11 text escaping. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,")
    .replace(/\r\n|\r|\n/gu, "\\n");
}

/**
 * Fold one content line at 75 OCTETS (RFC 5545 §3.1). UTF-8 aware: a fold
 * never lands inside a multi-byte character, so "İzmir 3. Asliye Hukuk"
 * survives a fold intact.
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let first = true;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    // Continuation lines start with one space, which counts toward the 75.
    const cap = first ? 75 : 74;
    if (currentBytes + size > cap) {
      out.push(first ? current : ` ${current}`);
      first = false;
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current !== "") out.push(first ? current : ` ${current}`);
  return out.join("\r\n");
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD'. */
export function icsDate(iso: string): string {
  return iso.replace(/-/gu, "");
}

/** Day after an ISO date (all-day DTEND is exclusive). */
export function nextIsoDay(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

/** UTC instant -> 'YYYYMMDDTHHMMSSZ'. */
export function icsStamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/gu, "").slice(0, 15)}Z`;
}

/** Local wall clock 'YYYY-MM-DD' + 'HH:MM' + minutes -> 'YYYYMMDDTHHMMSS'. */
export function icsLocalDateTime(date: string, time: string, addMinutes = 0): string {
  const [h, m] = time.split(":");
  const base = Date.parse(`${date}T${h}:${m}:00Z`);
  if (!Number.isFinite(base)) return `${icsDate(date)}T000000`;
  const moved = new Date(base + addMinutes * 60_000);
  return `${moved.toISOString().replace(/[-:]/gu, "").slice(0, 15)}`;
}

/**
 * The single VTIMEZONE ColleX emits. Türkiye has been on a permanent +03:00
 * offset since 08.09.2016 (no summer time), so one STANDARD component with
 * equal FROM/TO offsets describes it completely for every date this product
 * can hold.
 */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${ICS_TZID}`,
  "X-LIC-LOCATION:Europe/Istanbul",
  "BEGIN:STANDARD",
  "TZNAME:+03",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export interface BuildIcsOptions {
  /** X-WR-CALNAME — what Outlook shows as the calendar's name. */
  calendarName: string;
  /** DTSTAMP for every VEVENT (injected so the output is deterministic). */
  dtstamp: Date;
}

/**
 * Render a complete VCALENDAR. CRLF line endings, as RFC 5545 requires; the
 * response is served as `text/calendar; charset=utf-8`.
 */
export function buildIcs(events: readonly IcsEvent[], options: BuildIcsOptions): string {
  const stamp = icsStamp(options.dtstamp);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    `X-WR-TIMEZONE:${ICS_TZID}`,
    ...VTIMEZONE,
  ];
  for (const event of events) {
    if (!ISO_DATE_RE.test(event.date)) continue;
    const description = [event.description ?? "", DEADLINE_DISCLAIMER]
      .filter((part) => part !== "")
      .join("\n\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(event.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (event.kind === "hearing" && event.time !== undefined && HHMM_RE.test(event.time)) {
      lines.push(`DTSTART;TZID=${ICS_TZID}:${icsLocalDateTime(event.date, event.time)}`);
      lines.push(
        `DTEND;TZID=${ICS_TZID}:${icsLocalDateTime(event.date, event.time, HEARING_DEFAULT_MINUTES)}`,
      );
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(nextIsoDay(event.date))}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    if (event.location !== undefined && event.location !== "") {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    }
    const status = event.status ?? "CONFIRMED";
    lines.push(`STATUS:${status}`);
    lines.push(status === "CANCELLED" ? "TRANSP:TRANSPARENT" : "TRANSP:OPAQUE");
    const alarm = status === "CANCELLED" ? 0 : (event.alarmDaysBefore ?? 0);
    if (alarm > 0) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`TRIGGER:-P${Math.floor(alarm)}D`);
      lines.push(`DESCRIPTION:${escapeIcsText(event.summary)}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** SUMMARY prefix of a postponed hearing (27.09.2026). */
export const POSTPONED_SUMMARY_PREFIX = "ERTELENDİ — ";

/**
 * Turkish summary of a hearing row (calendar + .ics share it).
 *
 * 27.09.2026: the hearing's own `title` ("Bilirkişi raporuna itiraz") is part
 * of the summary — it used to be dropped, so two hearings of one matter read
 * the same in the calendar — and a postponed hearing opens with
 * "ERTELENDİ — ".
 */
export function hearingSummary(
  matterTitle: string,
  kind: HearingKind,
  court: string,
  options: { title?: string; postponed?: boolean } = {},
): string {
  const label = HEARING_KIND_LABELS[kind] ?? HEARING_KIND_LABELS.durusma;
  const title = (options.title ?? "").trim();
  const parts = [label, title, matterTitle].filter((p) => p !== "");
  const head = parts.join(" — ");
  const summary = court === "" ? head : `${head} (${court})`;
  return options.postponed === true ? `${POSTPONED_SUMMARY_PREFIX}${summary}` : summary;
}
