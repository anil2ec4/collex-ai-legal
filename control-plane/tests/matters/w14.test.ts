/**
 * W14 — L-MATTER: B-18 (batch chronology), B-26 (filters, deletes, overdue
 * deadlines), B-29 (general search), B-43 (activity).
 *
 * Offline: InMemoryMatterStore + InMemoryAnswerStore + injected fakes for the
 * draft and document ports.
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryAnswerStore,
  questionMatchesQuery,
  type StoredAnswer,
} from "../../src/api/answerService.js";
import {
  MAX_ITEM_PAYLOAD_BYTES,
  addIsoDays,
  createMattersRouter,
  dedupeKey,
  unknownQueryIssues,
  withoutComputed,
  type MattersRouterDeps,
} from "../../src/matters/routes.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import {
  daysBetweenIso,
  trimToWordBoundary,
  type Matter,
  type MatterItem,
  type MatterSummary,
} from "../../src/matters/types.js";

interface ErrorBody {
  error: { kind: string; message: string; issues?: Array<{ path: string; message: string }> };
}

function clock(start = "2026-09-02T09:00:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

function harness(overrides: Partial<MattersRouterDeps> = {}) {
  const now = clock();
  const store = new InMemoryMatterStore(now);
  const answers = new InMemoryAnswerStore(16);
  const app = createMattersRouter({ store, answers, now, ...overrides });
  const json = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  const post = (path: string, body: unknown) =>
    json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const del = (path: string) => json(path, { method: "DELETE" });
  return { app, store, answers, now, json, post, del };
}

async function createMatter(h: ReturnType<typeof harness>, title = "Yılmaz / Kira tahliye"): Promise<Matter> {
  return (await h.post("/v1/matters", { title, client: "Ayşe Yılmaz", opposing: "Mehmet Demir" })).body as Matter;
}

const storedAnswer = (runId: string, question: string, status = "COMPLETE"): StoredAnswer => ({
  runId,
  result: { runId, question, status, finalizable: status === "COMPLETE", evidence: [] } as never,
  bundle: {} as never,
  storedAt: "2026-09-02T09:00:00.000Z",
  question,
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("W14 helpers", () => {
  it("trimToWordBoundary never cuts mid-word (UXAUDIT P1-18)", () => {
    const text = "Kiracı 12.03.2025 tarihinde kira bedelini ödememiştir ve ihtarname gönderilmiştir";
    const cut = trimToWordBoundary(text, 30);
    expect(cut.endsWith("…")).toBe(true);
    // Every retained token is a whole token of the source.
    const tokens = cut.slice(0, -1).trim().split(" ");
    for (const token of tokens) expect(text.split(" ")).toContain(token);
    // A single long token with no space inside the window is still cut.
    expect(trimToWordBoundary("a".repeat(50), 10)).toBe(`${"a".repeat(10)}…`);
    expect(trimToWordBoundary("kısa metin", 100)).toBe("kısa metin");
  });

  it("daysBetweenIso and addIsoDays do civil-date arithmetic", () => {
    expect(daysBetweenIso("2026-09-02", "2026-09-16")).toBe(14);
    expect(daysBetweenIso("2026-09-02", "2026-07-15")).toBe(-49); // DAILYFLOW's 49-day-overdue row
    expect(addIsoDays("2026-09-02", 30)).toBe("2026-10-02");
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("unknownQueryIssues names the parameter and the allowed set", () => {
    expect(unknownQueryIssues("/v1/matters?q=a", ["q", "status"])).toEqual([]);
    const issues = unknownQueryIssues("/v1/matters?sirala=tarih", ["q", "status"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("sirala");
    expect(issues[0]?.message).toContain("Kullanılabilir: q, status.");
  });

  it("withoutComputed drops only the computed block", () => {
    const row = {
      itemId: "i",
      matterId: "m",
      kind: "deadline" as const,
      refId: null,
      payload: { title: "t", dueDate: "2026-09-16", computed: { steps: [1, 2, 3] } },
      createdAt: "",
      updatedAt: "",
      matterTitle: "",
    };
    expect(withoutComputed(row).payload).toEqual({ title: "t", dueDate: "2026-09-16" });
    expect(row.payload["computed"]).toBeDefined(); // input untouched
  });

  it("dedupeKey identifies a timeline entry by date + title, a record by ref", () => {
    const a = dedupeKey({ kind: "event", payload: { date: "2026-03-01", title: "İhtar" } });
    const b = dedupeKey({ kind: "event", payload: { date: "2026-03-01", title: "İhtar" } });
    const c = dedupeKey({ kind: "event", payload: { date: "2026-03-02", title: "İhtar" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(dedupeKey({ kind: "file", refId: "abc", payload: {} })).toBe("file ref abc");
  });

  it("questionMatchesQuery folds Turkish case", () => {
    expect(questionMatchesQuery("Depozito iadesi", "DEPOZİTO")).toBe(true);
    expect(questionMatchesQuery("Depozito iadesi", "kira")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B-26 — no more silent filters
// ---------------------------------------------------------------------------

describe("B-26: an unimplemented filter is a 400, never a silent full list", () => {
  it("refuses an unknown query parameter on every list route", async () => {
    const h = harness();
    const matter = await createMatter(h);
    for (const path of [
      "/v1/matters?sirala=tarih",
      "/v1/matters/deadlines?hepsi=1",
      "/v1/matters/search?q=kira&sayfa=2",
      `/v1/matters/${matter.id}/activity?bak=1`,
    ]) {
      const res = await h.json(path);
      expect(res.status, path).toBe(400);
      expect((res.body as ErrorBody).error.kind).toBe("INVALID_REQUEST");
      expect((res.body as ErrorBody).error.issues?.[0]?.message).toContain("Tanınmayan sorgu parametresi");
    }
  });

  it("q and status really filter GET /v1/matters", async () => {
    const h = harness();
    await createMatter(h, "Yılmaz / Kira tahliye");
    const other = (await h.post("/v1/matters", { title: "Demir / İşe iade", status: "kapali" })).body as Matter;
    const filtered = (await h.json("/v1/matters?q=kira")).body as { matters: MatterSummary[] };
    expect(filtered.matters.map((m) => m.title)).toEqual(["Yılmaz / Kira tahliye"]);
    const closed = (await h.json("/v1/matters?status=kapali")).body as { matters: MatterSummary[] };
    expect(closed.matters.map((m) => m.id)).toEqual([other.id]);
    const bad = await h.json("/v1/matters?status=arşiv");
    expect(bad.status).toBe(400);
  });
});

describe("B-26: nextDeadline skips the past; overdueCount counts it", () => {
  it("shows the deadline that is actually next, not the 49-day-overdue one", async () => {
    const h = harness();
    const matter = await createMatter(h);
    // The measured defect (DAILYFLOW): 2026-07-15 is 49 days before today
    // and used to win over the one 6 days away.
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "deadline",
      payload: { title: "Geçmiş süre", dueDate: "2026-07-15" },
    });
    const real = (
      await h.post(`/v1/matters/${matter.id}/items`, {
        kind: "deadline",
        payload: { title: "Cevap süresi", dueDate: "2026-09-08" },
      })
    ).body as MatterItem;

    const list = (await h.json("/v1/matters")).body as { matters: MatterSummary[] };
    const row = list.matters[0]!;
    expect(row.nextDeadline).toEqual({
      itemId: real.itemId,
      title: "Cevap süresi",
      dueDate: "2026-09-08",
      daysLeft: 6,
      overdue: false,
    });
    expect(row.overdueCount).toBe(1);
    expect(row.counts.deadlines).toBe(2);

    // Every open deadline overdue -> nextDeadline is null, the count is not.
    const only = (await h.post("/v1/matters", { title: "Sadece geçmiş" })).body as Matter;
    await h.post(`/v1/matters/${only.id}/items`, {
      kind: "deadline",
      payload: { title: "Kaçmış", dueDate: "2026-01-01" },
    });
    const second = (await h.json("/v1/matters")).body as { matters: MatterSummary[] };
    const onlyRow = second.matters.find((m) => m.id === only.id)!;
    expect(onlyRow.nextDeadline).toBeNull();
    expect(onlyRow.overdueCount).toBe(1);
  });

  it("the default deadlines body drops `computed` and shrinks by more than 80 %", async () => {
    const h = harness();
    const matter = await createMatter(h);
    // Four deadlines with a computed block each — the measured 9 965-byte body.
    const computed = {
      steps: Array.from({ length: 24 }, (_, i) => ({
        step: i,
        label: `Adım ${i}: adli tatil ve resmî tatil denetimi`,
        date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
        note: "HMK m.92/2 uyarınca ay sonuna sarkma denetimi yapıldı.",
      })),
      disclaimer: "x".repeat(400),
    };
    for (let i = 0; i < 4; i += 1) {
      await h.post(`/v1/matters/${matter.id}/items`, {
        kind: "deadline",
        payload: { title: `Süre ${i}`, dueDate: `2026-09-1${i}`, ruleId: "hmk-cevap", computed },
      });
    }
    const lean = JSON.stringify((await h.json("/v1/matters/deadlines")).body);
    const full = JSON.stringify((await h.json("/v1/matters/deadlines?include=computed")).body);
    expect(lean).not.toContain("HMK m.92/2 uyarınca");
    expect(full).toContain("HMK m.92/2 uyarınca");
    expect(lean.length).toBeLessThan(full.length * 0.2); // >= 80 % smaller
    const bad = await h.json("/v1/matters/deadlines?include=hepsi");
    expect(bad.status).toBe(400);
  });
});

describe("B-26: DELETE /v1/answers/{runId} and the draft record routes", () => {
  it("deletes an answer, drops its matter record, and 404s the second time", async () => {
    const h = harness();
    const matter = await createMatter(h);
    h.answers.put(storedAnswer("run-1", "Depozito iadesi nasıl istenir?"));
    const item = await h.post(`/v1/matters/${matter.id}/items`, { kind: "answer", refId: "run-1" });
    expect(item.status).toBe(201);

    expect((await h.del("/v1/answers/run-1")).status).toBe(204);
    expect((await h.del("/v1/answers/run-1")).status).toBe(404);
    expect(await h.answers.list()).toHaveLength(0);
    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as {
      items: { answers: MatterItem[] };
    };
    expect(detail.items.answers).toEqual([]);
  });

  it("deletes a draft and reads back one stored version body", async () => {
    const versions = new Map<string, Record<string, unknown>>([
      ["d1|1", { draftId: "d1", version: 1, title: "Cevap dilekçesi", body: "ilk" }],
      ["d1|2", { draftId: "d1", version: 2, title: "Cevap dilekçesi", body: "ikinci" }],
    ]);
    const drafts = {
      async list() {
        return [];
      },
      async getVersionBody(draftId: string, version: number) {
        return versions.get(`${draftId}|${version}`);
      },
      async remove(draftId: string) {
        const had = [...versions.keys()].some((k) => k.startsWith(`${draftId}|`));
        for (const key of [...versions.keys()]) if (key.startsWith(`${draftId}|`)) versions.delete(key);
        return had;
      },
    };
    const h = harness({ drafts });
    const v1 = await h.json("/v1/drafts/d1/versions/1");
    expect(v1.status).toBe(200);
    expect((v1.body as { body: string }).body).toBe("ilk");
    expect((await h.json("/v1/drafts/d1/versions/9")).status).toBe(404);
    expect((await h.json("/v1/drafts/d1/versions/sifir")).status).toBe(400);

    expect((await h.del("/v1/drafts/d1")).status).toBe(204);
    expect((await h.del("/v1/drafts/d1")).status).toBe(404);
  });

  it("answers 501 with a Turkish sentence when the store cannot delete", async () => {
    const h = harness({ drafts: { async list() { return []; } } });
    const res = await h.del("/v1/drafts/d1");
    expect(res.status).toBe(501);
    expect((res.body as ErrorBody).error.message).toContain("kalıcı depo bağlı değil");
  });
});

// ---------------------------------------------------------------------------
// B-18 — batch chronology
// ---------------------------------------------------------------------------

describe("B-18: POST /v1/matters/{id}/items:batch", () => {
  const dates = Array.from({ length: 12 }, (_, i) => ({
    kind: "event" as const,
    payload: {
      date: `2026-0${((i % 9) + 1)}-1${i % 10}`,
      title: `Belgeden çıkarılan olay ${i}`,
      source: "belge:0123456789abcdef",
      verified: false,
    },
  }));

  it("files 12 dates in ONE request, all unverified, and never duplicates them", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const first = await h.post(`/v1/matters/${matter.id}/items:batch`, { items: dates });
    expect(first.status).toBe(201);
    const body = first.body as { created: MatterItem[]; createdCount: number; skipped: unknown[] };
    expect(body.createdCount).toBe(12);
    expect(body.skipped).toEqual([]);
    for (const item of body.created) {
      expect(item.kind).toBe("event");
      expect(item.payload["verified"]).toBe(false);
      expect(item.payload["source"]).toBe("belge:0123456789abcdef");
    }

    // Pressing the button a second time adds nothing.
    const second = await h.post(`/v1/matters/${matter.id}/items:batch`, { items: dates });
    expect(second.status).toBe(201);
    const again = second.body as { createdCount: number; skipped: Array<{ reason: string }> };
    expect(again.createdCount).toBe(0);
    expect(again.skipped).toHaveLength(12);
    expect(again.skipped[0]?.reason).toBe("DUPLICATE");

    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as { items: { events: MatterItem[] } };
    expect(detail.items.events).toHaveLength(12);
  });

  it("the colon-free alias behaves identically", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const res = await h.post(`/v1/matters/${matter.id}/items/batch`, { items: dates.slice(0, 2) });
    expect(res.status).toBe(201);
    expect((res.body as { createdCount: number }).createdCount).toBe(2);
  });

  it("refuses more than 50 records, an invalid record, and an oversized one", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const tooMany = await h.post(`/v1/matters/${matter.id}/items:batch`, {
      items: Array.from({ length: 51 }, () => ({ kind: "note", payload: { text: "x" } })),
    });
    expect(tooMany.status).toBe(400);
    expect((tooMany.body as ErrorBody).error.issues?.[0]?.message).toContain("en fazla 50 kayıt");

    const badRow = await h.post(`/v1/matters/${matter.id}/items:batch`, {
      items: [
        { kind: "event", payload: { date: "2026-03-01", title: "iyi" } },
        { kind: "event", payload: { date: "01.03.2026", title: "kötü" } },
      ],
    });
    expect(badRow.status).toBe(400);
    expect((badRow.body as ErrorBody).error.issues?.[0]?.path).toBe("items.1.payload.date");

    // MAX_ITEM_PAYLOAD_BYTES applies per record, not to the whole request:
    // 30 short notes are fine, one 64 KiB note is not.
    const many = await h.post(`/v1/matters/${matter.id}/items:batch`, {
      items: Array.from({ length: 30 }, (_, i) => ({ kind: "note", payload: { text: `not ${i}` } })),
    });
    expect(many.status).toBe(201);
    const huge = await h.post(`/v1/matters/${matter.id}/items:batch`, {
      items: [{ kind: "note", payload: { text: "tek not", ek: "x".repeat(MAX_ITEM_PAYLOAD_BYTES) } }],
    });
    expect(huge.status).toBe(400);
    expect((huge.body as ErrorBody).error.issues?.[0]?.path).toBe("items.0.payload");

    // Nothing was written by any REFUSED request (the 30 accepted notes are).
    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as {
      items: { events: MatterItem[]; notes: MatterItem[] };
    };
    expect(detail.items.events).toEqual([]);
    expect(detail.items.notes).toHaveLength(30);
  });

  it("404s an unknown matter without writing anything", async () => {
    const h = harness();
    const res = await h.post("/v1/matters/00000000-0000-4000-8000-00000000dead/items:batch", {
      items: [{ kind: "note", payload: { text: "x" } }],
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// B-29 — general search
// ---------------------------------------------------------------------------

describe("B-29: GET /v1/matters/search", () => {
  const documents = {
    async searchChunks(q: string) {
      return q.toLocaleLowerCase("tr-TR").includes("depozito")
        ? [
            {
              fileId: "0123456789abcdef",
              fileName: "Kira sözleşmesi.pdf",
              chunkId: "chunk-7",
              ordinal: 7,
              snippet: "Kiracı depozito bedelini nakden ödemiştir.",
              startChar: 1200,
              endChar: 1290,
            },
          ]
        : [];
    },
  };

  it("finds a phrase that appears ONLY in a document body and anchors it", async () => {
    const h = harness({ documents });
    const res = await h.json("/v1/matters/search?q=depozito");
    expect(res.status).toBe(200);
    const body = res.body as {
      total: number;
      documentsSearched: boolean;
      groups: { documents: Array<{ fileId: string; href: string; startChar: number }> };
    };
    expect(body.documentsSearched).toBe(true);
    expect(body.groups.documents).toHaveLength(1);
    expect(body.groups.documents[0]?.fileId).toBe("0123456789abcdef");
    expect(body.groups.documents[0]?.startChar).toBe(1200);
    expect(body.groups.documents[0]?.href).toContain("#belge/0123456789abcdef");
  });

  it("groups matters, notes, events and answers under the same query", async () => {
    const h = harness({ documents });
    const matter = await createMatter(h, "Depozito uyuşmazlığı");
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "note",
      payload: { text: "Depozito 3 aylık kira bedeli kadar alınmış." },
    });
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "event",
      payload: { date: "2026-03-01", title: "Depozito ödendi" },
    });
    h.answers.put(storedAnswer("run-9", "Depozito iadesi nasıl istenir?"));

    const body = (await h.json("/v1/matters/search?q=depozito")).body as {
      total: number;
      groups: Record<string, unknown[]>;
    };
    expect(body.groups["matters"]).toHaveLength(1);
    expect(body.groups["notes"]).toHaveLength(1);
    expect(body.groups["events"]).toHaveLength(1);
    expect(body.groups["answers"]).toHaveLength(1);
    expect(body.groups["documents"]).toHaveLength(1);
    expect(body.total).toBe(5);

    // /v1/search/all is the same handler under the name the console uses.
    const alias = (await h.json("/v1/search/all?q=depozito")).body as { total: number };
    expect(alias.total).toBe(5);
  });

  it("says so honestly when the document half is not wired", async () => {
    const h = harness();
    const body = (await h.json("/v1/matters/search?q=depozito")).body as {
      documentsSearched: boolean;
      groups: { documents: unknown[] };
    };
    expect(body.documentsSearched).toBe(false);
    expect(body.groups.documents).toEqual([]);
  });

  it("refuses a query shorter than two characters", async () => {
    const h = harness();
    const res = await h.json("/v1/matters/search?q=a");
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.issues?.[0]?.message).toBe("Arama en az 2 karakter olmalı.");
  });
});

// ---------------------------------------------------------------------------
// B-43 — "nerede kalmıştım"
// ---------------------------------------------------------------------------

describe("B-43: GET /v1/matters/{id}/activity", () => {
  it("returns the last N changes of a matter in one list, newest first", async () => {
    const h = harness();
    const matter = await createMatter(h);
    await h.post(`/v1/matters/${matter.id}/items`, { kind: "file", refId: "0123456789abcdef", payload: { fileName: "ihtar.pdf" } });
    await h.post(`/v1/matters/${matter.id}/items`, { kind: "note", payload: { text: "Müvekkil aradı, tanık listesi hazırlanacak." } });
    await h.post(`/v1/matters/${matter.id}/items`, { kind: "deadline", payload: { title: "Cevap süresi", dueDate: "2026-09-16" } });

    const res = await h.json(`/v1/matters/${matter.id}/activity`);
    expect(res.status).toBe(200);
    const body = res.body as {
      matterTitle: string;
      activity: Array<{ kind: string; kindLabel: string; title: string; at: string }>;
    };
    expect(body.matterTitle).toBe("Yılmaz / Kira tahliye");
    expect(body.activity.map((a) => a.kind)).toEqual(["deadline", "note", "file"]);
    expect(body.activity.map((a) => a.kindLabel)).toEqual(["Süre", "Not", "Belge"]);
    expect(body.activity[2]?.title).toBe("ihtar.pdf");
    // Newest first.
    expect(body.activity[0]!.at >= body.activity[1]!.at).toBe(true);

    const limited = (await h.json(`/v1/matters/${matter.id}/activity?limit=1`)).body as {
      activity: unknown[];
    };
    expect(limited.activity).toHaveLength(1);

    const since = (await h.json(`/v1/matters/${matter.id}/activity?since=2099-01-01T00:00:00Z`)).body as {
      activity: unknown[];
    };
    expect(since.activity).toEqual([]);

    expect((await h.json("/v1/matters/00000000-0000-4000-8000-00000000dead/activity")).status).toBe(404);
  });
});
