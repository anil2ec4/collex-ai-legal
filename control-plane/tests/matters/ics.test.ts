/**
 * W14 (B-17) — hearing item, calendar endpoint and the .ics feed.
 *
 * KABUL (W13-BACKLOG B-17): a hearing is added to a matter; it shows up in the
 * calendar next to the deadlines; the .ics carries the right DATE **and TIME**
 * and its DESCRIPTION contains `DEADLINE_DISCLAIMER` verbatim; the preparation
 * card lists the matter's open deadlines and its last three documents; this
 * file checks the RFC 5545 mandatory fields and the disclaimer.
 */

import { describe, expect, it } from "vitest";
import { DEADLINE_DISCLAIMER } from "../../src/deadlines/rules.js";
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  hearingSummary,
  icsLocalDateTime,
  nextIsoDay,
} from "../../src/matters/ics.js";
import { createMattersRouter } from "../../src/matters/routes.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import type { Matter, MatterItem, MatterSummary } from "../../src/matters/types.js";

function clock(start = "2026-09-02T09:00:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

function harness() {
  const now = clock();
  const store = new InMemoryMatterStore(now);
  const app = createMattersRouter({ store, now });
  const json = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  const post = (path: string, body: unknown) =>
    json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const raw = (path: string) => app.request(path);
  return { app, store, now, json, post, raw };
}

async function createMatter(h: ReturnType<typeof harness>, title = "Yılmaz / Kira tahliye"): Promise<Matter> {
  return (await h.post("/v1/matters", { title, client: "Ayşe Yılmaz" })).body as Matter;
}

/** Unfold a folded .ics body back into logical lines (RFC 5545 §3.1). */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/gu, "").split("\r\n");
}

/** DESCRIPTION lines of the VEVENTs only (a VALARM carries one too). */
function eventDescriptions(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inAlarm = false;
  for (const line of lines) {
    if (line === "BEGIN:VALARM") inAlarm = true;
    else if (line === "END:VALARM") inAlarm = false;
    else if (!inAlarm && line.startsWith("DESCRIPTION:")) out.push(line);
  }
  return out;
}

describe("ics builder (RFC 5545)", () => {
  it("escapes, folds at 75 octets and keeps multi-byte characters whole", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const long = `SUMMARY:${"İ".repeat(80)}`;
    const folded = foldIcsLine(long);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original characters exactly (no split surrogate,
    // no broken UTF-8 sequence).
    expect(folded.replace(/\r\n /gu, "")).toBe(long);
  });

  it("nextIsoDay / icsLocalDateTime do civil-date arithmetic", () => {
    expect(nextIsoDay("2026-02-28")).toBe("2026-03-01"); // 2026 is not a leap year
    expect(nextIsoDay("2026-12-31")).toBe("2027-01-01");
    expect(icsLocalDateTime("2026-09-16", "09:30")).toBe("20260916T093000");
    expect(icsLocalDateTime("2026-09-16", "09:30", 60)).toBe("20260916T103000");
  });

  it("writes every mandatory field and the disclaimer VERBATIM", () => {
    const ics = buildIcs(
      [
        {
          uid: "item-1@collex.local",
          kind: "hearing",
          date: "2026-09-16",
          time: "09:30",
          summary: hearingSummary("Yılmaz / Kira", "durusma", "İzmir 3. Sulh Hukuk"),
          location: "İzmir 3. Sulh Hukuk / Salon 2",
          alarmDaysBefore: 1,
        },
        {
          uid: "item-2@collex.local",
          kind: "deadline",
          date: "2026-09-20",
          summary: "Süre: Cevap — Yılmaz / Kira",
          alarmDaysBefore: 7,
        },
      ],
      { calendarName: "ColleX", dtstamp: new Date("2026-09-02T09:00:00.000Z") },
    );
    const lines = unfold(ics);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//ColleX//Dava Takvimi//TR");
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("BEGIN:VTIMEZONE");
    expect(lines).toContain("TZID:Europe/Istanbul");
    expect(lines).toContain("TZOFFSETTO:+0300");
    expect(lines).toContain("UID:item-1@collex.local");
    expect(lines).toContain("DTSTAMP:20260902T090000Z");
    // Hearing: a TIMED event in Türkiye's zone, one hour long.
    expect(lines).toContain("DTSTART;TZID=Europe/Istanbul:20260916T093000");
    expect(lines).toContain("DTEND;TZID=Europe/Istanbul:20260916T103000");
    // Deadline: an all-day event, DTEND exclusive.
    expect(lines).toContain("DTSTART;VALUE=DATE:20260920");
    expect(lines).toContain("DTEND;VALUE=DATE:20260921");
    expect(lines).toContain("TRIGGER:-P1D");
    expect(lines).toContain("TRIGGER:-P7D");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);

    // The CLAUDE.md invariant: every surface that shows a computed date
    // carries the disclaimer unchanged. Compare against the escaped form of
    // the constant, then unescape one description back to prove it round-trips.
    const escaped = escapeIcsText(DEADLINE_DISCLAIMER);
    const descriptions = eventDescriptions(lines);
    expect(descriptions).toHaveLength(2);
    for (const line of descriptions) expect(line).toContain(escaped);
    const restored = descriptions[1]!
      .slice("DESCRIPTION:".length)
      .replace(/\\n/gu, "\n")
      .replace(/\\,/gu, ",")
      .replace(/\\;/gu, ";")
      .replace(/\\\\/gu, "\\");
    expect(restored).toContain(DEADLINE_DISCLAIMER);
  });

  it("skips an event with an unusable date instead of writing a broken VEVENT", () => {
    const ics = buildIcs([{ uid: "x", kind: "deadline", date: "16.09.2026", summary: "s" }], {
      calendarName: "ColleX",
      dtstamp: new Date("2026-09-02T09:00:00.000Z"),
    });
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("hearing items and the calendar routes", () => {
  it("accepts a hearing, counts it, and reports it as nextHearing", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const created = await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "hearing",
      payload: {
        date: "2026-09-16",
        time: "09:30",
        court: "İzmir 3. Sulh Hukuk Mahkemesi",
        salon: "Salon 2",
        kind: "durusma",
        note: "Tanık dinlenecek",
      },
    });
    expect(created.status).toBe(201);
    expect((created.body as MatterItem).payload).toMatchObject({
      date: "2026-09-16",
      time: "09:30",
      kind: "durusma",
      status: "planlandi",
    });

    const list = (await h.json("/v1/matters")).body as { matters: MatterSummary[] };
    expect(list.matters[0]?.counts.hearings).toBe(1);
    expect(list.matters[0]?.nextHearing).toEqual({
      itemId: (created.body as MatterItem).itemId,
      title: "İzmir 3. Sulh Hukuk Mahkemesi",
      date: "2026-09-16",
      time: "09:30",
      kind: "durusma",
      daysLeft: 14,
    });
  });

  it("refuses a malformed hearing time / kind in lawyer Turkish", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const bad = await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "hearing",
      payload: { date: "2026-09-16", time: "9.30", kind: "toplanti" },
    });
    expect(bad.status).toBe(400);
    const issues = (bad.body as { error: { issues: Array<{ path: string; message: string }> } }).error.issues;
    expect(issues.map((i) => i.path).sort()).toEqual(["payload.kind", "payload.time"]);
    expect(issues.find((i) => i.path === "payload.time")?.message).toBe(
      "Saat SS:DD biçiminde olmalı (örn. 09:30).",
    );
  });

  it("GET /v1/matters/deadlines carries the window's hearings next to the deadlines", async () => {
    const h = harness();
    const matter = await createMatter(h);
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "deadline",
      payload: { title: "Cevap süresi", dueDate: "2026-09-16" },
    });
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "hearing",
      payload: { date: "2026-09-18", time: "10:00", court: "İzmir 3. Sulh Hukuk" },
    });
    const body = (await h.json("/v1/matters/deadlines")).body as {
      deadlines: MatterItem[];
      hearings: Array<MatterItem & { matterTitle: string }>;
      window: { from: string; until: string };
    };
    expect(body.deadlines).toHaveLength(1);
    expect(body.hearings).toHaveLength(1);
    expect(body.hearings[0]?.matterTitle).toBe("Yılmaz / Kira tahliye");
    expect(body.window).toEqual({ from: "2026-09-02", until: "2026-10-02" });
  });

  it("serves both feeds as text/calendar with the disclaimer in every event", async () => {
    const h = harness();
    const matter = await createMatter(h);
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "deadline",
      payload: { title: "Cevap süresi", dueDate: "2026-09-16" },
    });
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "hearing",
      payload: { date: "2026-09-18", time: "10:00", court: "İzmir 3. Sulh Hukuk", salon: "Salon 1" },
    });

    for (const path of ["/v1/matters/calendar.ics", `/v1/matters/${matter.id}/calendar.ics`]) {
      const res = await h.raw(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
      expect(res.headers.get("content-disposition")).toContain("attachment;");
      const lines = unfold(await res.text());
      expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
      expect(lines).toContain("DTSTART;VALUE=DATE:20260916");
      expect(lines).toContain("DTSTART;TZID=Europe/Istanbul:20260918T100000");
      expect(lines).toContain("LOCATION:İzmir 3. Sulh Hukuk / Salon 1");
      const escaped = escapeIcsText(DEADLINE_DISCLAIMER);
      const descriptions = eventDescriptions(lines);
      expect(descriptions).toHaveLength(2);
      for (const line of descriptions) expect(line).toContain(escaped);
    }

    const missing = await h.raw("/v1/matters/00000000-0000-4000-8000-00000000dead/calendar.ics");
    expect(missing.status).toBe(404);
  });

  it("the preparation card lists open deadlines, the last three documents and the chronology", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const hearing = (
      await h.post(`/v1/matters/${matter.id}/items`, {
        kind: "hearing",
        payload: { date: "2026-09-18", time: "10:00", court: "İzmir 3. Sulh Hukuk" },
      })
    ).body as MatterItem;
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "deadline",
      payload: { title: "Cevap süresi", dueDate: "2026-09-16" },
    });
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "deadline",
      payload: { title: "Kapanmış", dueDate: "2026-09-10", status: "tamam" },
    });
    for (const [i, name] of ["a.pdf", "b.pdf", "c.pdf", "d.pdf"].entries()) {
      await h.post(`/v1/matters/${matter.id}/items`, {
        kind: "file",
        refId: `000000000000000${i}`,
        payload: { fileName: name },
      });
    }
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "event",
      payload: { date: "2026-03-01", title: "Sözleşme imzalandı", source: "manual" },
    });

    const prep = await h.json(`/v1/matters/${matter.id}/hearings/${hearing.itemId}/prep`);
    expect(prep.status).toBe(200);
    const body = prep.body as {
      hearing: { date: string; kindLabel: string; daysLeft: number };
      openDeadlines: Array<{ title: string; overdue: boolean }>;
      recentFiles: Array<{ fileName: string }>;
      chronology: Array<{ title: string }>;
    };
    expect(body.hearing).toMatchObject({ date: "2026-09-18", kindLabel: "Duruşma", daysLeft: 16 });
    expect(body.openDeadlines.map((d) => d.title)).toEqual(["Cevap süresi"]);
    expect(body.recentFiles).toHaveLength(3);
    expect(body.recentFiles.map((f) => f.fileName)).toEqual(["d.pdf", "c.pdf", "b.pdf"]);
    expect(body.chronology.map((e) => e.title)).toEqual(["Sözleşme imzalandı"]);

    const wrongItem = await h.json(
      `/v1/matters/${matter.id}/hearings/00000000-0000-4000-8000-00000000dead/prep`,
    );
    expect(wrongItem.status).toBe(404);
  });
});
