/**
 * Matters router (W12-A, contract [M]) — offline, InMemoryMatterStore +
 * InMemoryAnswerStore + a fake draft listing. Every route, every typed error
 * kind, the cross-store attach/detach, and the live-summary merge.
 */

import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { InMemoryAnswerStore, type StoredAnswer } from "../../src/api/answerService.js";
import {
  ITEM_PAYLOAD_TOO_LARGE_MESSAGE_TR,
  MAX_ITEM_PAYLOAD_BYTES,
  REF_ID_IMMUTABLE_MESSAGE_TR,
  createMattersRouter,
  validateItemPayload,
} from "../../src/matters/routes.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import {
  deriveMatterSummary,
  type Matter,
  type MatterItem,
  type MatterStore,
  type MatterSummary,
} from "../../src/matters/types.js";

interface ErrorBody {
  error: { kind: string; message: string; issues?: Array<{ path: string; message: string }> };
}

function clock(start = "2026-09-02T09:00:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

function harness(overrides: { drafts?: Parameters<typeof createMattersRouter>[0]["drafts"] } = {}) {
  const now = clock();
  const store = new InMemoryMatterStore(now);
  const answers = new InMemoryAnswerStore(8);
  const app = createMattersRouter({ store, answers, now, ...overrides });
  const json = async (path: string, init?: RequestInit) => {
    const res = await app.request(path, init);
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  const post = (path: string, body: unknown) =>
    json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const patch = (path: string, body: unknown) =>
    json(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const del = (path: string) => json(path, { method: "DELETE" });
  return { app, store, answers, now, json, post, patch, del };
}

const storedAnswer = (runId: string, question: string, matterId?: string | null): StoredAnswer => ({
  runId,
  result: {
    runId,
    question,
    status: "COMPLETE",
    finalizable: true,
    evidence: [{ evidenceId: "e1" }, { evidenceId: "e2" }],
  } as unknown as StoredAnswer["result"],
  bundle: { schema: "collex.answer.evidence-bundle/v1" } as StoredAnswer["bundle"],
  storedAt: "2026-09-01T10:00:00.000Z",
  mode: "local",
  ...(matterId !== undefined ? { matterId } : {}),
});

async function createMatter(h: ReturnType<typeof harness>, title = "Yılmaz / Kira tahliye"): Promise<Matter> {
  const res = await h.post("/v1/matters", { title, client: "Ayşe Yılmaz", opposing: "Veli Kaya" });
  expect(res.status).toBe(201);
  return res.body as Matter;
}

describe("POST /v1/matters", () => {
  it("creates a matter with defaults and answers 201", async () => {
    const h = harness();
    const res = await h.post("/v1/matters", { title: "  Yılmaz / Kira tahliye  " });
    expect(res.status).toBe(201);
    const matter = res.body as Matter;
    expect(matter.title).toBe("Yılmaz / Kira tahliye");
    expect(matter.kind).toBe("dava");
    expect(matter.status).toBe("acik");
    expect(matter.client).toBe("");
    expect(matter.notes).toBe("");
    expect(matter.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(matter.createdAt).toBe(matter.updatedAt);
  });

  it("rejects a missing title, an unknown kind and an unknown field — in Turkish", async () => {
    const h = harness();
    const missing = await h.post("/v1/matters", {});
    expect(missing.status).toBe(400);
    const body = missing.body as ErrorBody;
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.message).toMatch(/doğrulanamadı/);
    expect(body.error.issues?.[0]).toEqual({ path: "title", message: "Bu alan zorunludur." });

    const badKind = await h.post("/v1/matters", { title: "x", kind: "ceza" });
    expect(badKind.status).toBe(400);
    expect((badKind.body as ErrorBody).error.issues?.[0]?.message).toMatch(/dava, danismanlik/);

    // V-19: the issue NAMES the stray key. zod reports `unrecognized_keys` at
    // the parent object, so this used to arrive as `path: ""` — an issue no
    // screen can point at.
    const unknown = await h.post("/v1/matters", { title: "x", surprise: 1 });
    expect(unknown.status).toBe(400);
    expect((unknown.body as ErrorBody).error.issues?.[0]).toEqual({
      path: "surprise",
      message: "Tanınmayan alan.",
    });

    const notJson = await h.json("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect((notJson.body as ErrorBody).error.message).toBe("İstek gövdesi JSON olmalı.");
  });
});

describe("GET /v1/matters", () => {
  it("lists summaries newest-activity first with counts and no deadline", async () => {
    const h = harness();
    const a = await createMatter(h, "Birinci dosya");
    const b = await createMatter(h, "İkinci dosya");
    const res = await h.json("/v1/matters");
    expect(res.status).toBe(200);
    const { matters } = res.body as { matters: MatterSummary[] };
    expect(matters.map((m) => m.id)).toEqual([b.id, a.id]);
    expect(matters[0]).toMatchObject({
      counts: { files: 0, answers: 0, drafts: 0, notes: 0, events: 0, deadlines: 0 },
      nextDeadline: null,
    });
    expect(matters[0]?.lastActivityAt).toBe(b.updatedAt);
    // Summaries do not carry the free-text notes.
    expect("notes" in (matters[0] as object)).toBe(false);
  });

  it("filters by status and by a Turkish case-insensitive query", async () => {
    const h = harness();
    await createMatter(h, "Yılmaz / Kira tahliye");
    const created = await h.post("/v1/matters", { title: "Demir / İşe iade", client: "Mehmet Demir" });
    const other = created.body as Matter;
    await h.patch(`/v1/matters/${other.id}`, { status: "kapali" });

    const open = (await h.json("/v1/matters?status=acik")).body as { matters: MatterSummary[] };
    expect(open.matters.map((m) => m.title)).toEqual(["Yılmaz / Kira tahliye"]);

    const byClient = (await h.json("/v1/matters?q=ayşe")).body as { matters: MatterSummary[] };
    expect(byClient.matters.map((m) => m.title)).toEqual(["Yılmaz / Kira tahliye"]);

    const byTitle = (await h.json("/v1/matters?q=%C4%B0%C5%9Fe")).body as { matters: MatterSummary[] };
    expect(byTitle.matters.map((m) => m.title)).toEqual(["Demir / İşe iade"]);

    const bad = await h.json("/v1/matters?status=silinmis");
    expect(bad.status).toBe(400);
    expect((bad.body as ErrorBody).error.issues?.[0]?.path).toBe("status");
  });
});

describe("GET / PATCH / DELETE /v1/matters/{id}", () => {
  it("answers MATTER_NOT_FOUND for a non-uuid and an unknown uuid", async () => {
    const h = harness();
    for (const path of ["/v1/matters/not-a-uuid", "/v1/matters/00000000-0000-4000-8000-00000000dead"]) {
      const res = await h.json(path);
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).error).toEqual({
        kind: "MATTER_NOT_FOUND",
        message: "Dava dosyası bulunamadı.",
      });
    }
    expect((await h.patch("/v1/matters/00000000-0000-4000-8000-00000000dead", { title: "x" })).status).toBe(404);
    expect((await h.del("/v1/matters/00000000-0000-4000-8000-00000000dead")).status).toBe(404);
  });

  it("returns the matter with items grouped by kind, and patches fields", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const detail = await h.json(`/v1/matters/${matter.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({
      matter,
      items: {
        files: [],
        answers: [],
        drafts: [],
        notes: [],
        events: [],
        deadlines: [],
        hearings: [],
      },
    });

    const patched = await h.patch(`/v1/matters/${matter.id}`, { court: "İstanbul 3. Sulh Hukuk", docketNo: "2026/123" });
    expect(patched.status).toBe(200);
    const updated = patched.body as Matter;
    expect(updated.court).toBe("İstanbul 3. Sulh Hukuk");
    expect(updated.docketNo).toBe("2026/123");
    expect(updated.client).toBe("Ayşe Yılmaz");
    expect(updated.updatedAt > matter.updatedAt).toBe(true);

    const bad = await h.patch(`/v1/matters/${matter.id}`, { status: "arşiv" });
    expect(bad.status).toBe(400);

    const gone = await h.del(`/v1/matters/${matter.id}`);
    expect(gone.status).toBe(204);
    expect((await h.json(`/v1/matters/${matter.id}`)).status).toBe(404);
  });
});

describe("items", () => {
  it("validates payloads per kind with Turkish issues", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const base = `/v1/matters/${matter.id}/items`;

    const noText = await h.post(base, { kind: "note", payload: {} });
    expect(noText.status).toBe(400);
    expect((noText.body as ErrorBody).error.issues?.[0]).toEqual({
      path: "payload.text",
      message: "Bu alan zorunludur.",
    });

    const badDate = await h.post(base, { kind: "deadline", payload: { title: "Cevap", dueDate: "16.09.2026" } });
    expect(badDate.status).toBe(400);
    expect((badDate.body as ErrorBody).error.issues?.[0]?.path).toBe("payload.dueDate");
    expect((badDate.body as ErrorBody).error.issues?.[0]?.message).toMatch(/ISO/);

    const badKind = await h.post(base, { kind: "invoice", payload: {} });
    expect(badKind.status).toBe(400);
    expect((badKind.body as ErrorBody).error.issues?.[0]?.path).toBe("kind");

    const badSource = await h.post(base, { kind: "event", payload: { date: "2026-09-10", title: "Duruşma", source: "uyap" } });
    expect(badSource.status).toBe(400);
    expect((badSource.body as ErrorBody).error.issues?.[0]?.path).toBe("payload.source");

    // V-19: a stray field on the item body is named by its own path. It used
    // to arrive as `path: ""` — zod reports `unrecognized_keys` at the parent
    // object, and the parent of a top-level key is the body itself — so no
    // screen could point at the field the caller has to remove. (The per-kind
    // payload schemas are deliberately NOT strict: additive payload keys are
    // part of the contract, see the next test.)
    const strayTop = await h.post(base, { kind: "note", payload: { text: "x" }, bilinmeyenAlan: 2 });
    expect(strayTop.status).toBe(400);
    expect((strayTop.body as ErrorBody).error.issues?.[0]).toEqual({
      path: "bilinmeyenAlan",
      message: "Tanınmayan alan.",
    });

    const unknownMatter = await h.post("/v1/matters/00000000-0000-4000-8000-00000000dead/items", {
      kind: "note",
      payload: { text: "x" },
    });
    expect(unknownMatter.status).toBe(404);
    expect((unknownMatter.body as ErrorBody).error.kind).toBe("MATTER_NOT_FOUND");
  });

  it("fills payload defaults and keeps additive keys", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const base = `/v1/matters/${matter.id}/items`;
    const note = await h.post(base, { kind: "note", payload: { text: "Müvekkil arandı." } });
    expect(note.status).toBe(201);
    expect((note.body as MatterItem).payload).toEqual({ text: "Müvekkil arandı.", source: "manual" });

    const event = await h.post(base, {
      kind: "event",
      refId: "abcdef0123456789",
      payload: { date: "2026-09-10", title: "Duruşma", source: "belge:abcdef0123456789:chunk-1", extra: { page: 3 } },
    });
    expect(event.status).toBe(201);
    const item = event.body as MatterItem;
    expect(item.refId).toBe("abcdef0123456789");
    expect(item.payload).toEqual({
      date: "2026-09-10",
      title: "Duruşma",
      source: "belge:abcdef0123456789:chunk-1",
      verified: false,
      extra: { page: 3 },
    });

    expect(validateItemPayload("file", { fileName: "dilekce.docx" })).toEqual({
      ok: true,
      payload: { fileName: "dilekce.docx" },
    });
    expect(validateItemPayload("draft", {})).toEqual({
      ok: true,
      payload: { title: "", template: "", version: 1 },
    });
  });

  it("accepts the two `belge:` event source forms and refuses every other shape (W12-API2)", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const base = `/v1/matters/${matter.id}/items`;

    // Two segments: a date the upload analysis found, no chunk identity.
    const two = await h.post(base, {
      kind: "event",
      refId: "abcdef0123456789",
      payload: { date: "2026-09-10", title: "Sözleşme tarihi", source: "belge:abcdef0123456789" },
    });
    expect(two.status).toBe(201);
    expect((two.body as MatterItem).payload).toEqual({
      date: "2026-09-10",
      title: "Sözleşme tarihi",
      source: "belge:abcdef0123456789",
      verified: false,
    });
    // Three segments: traceable to one chunk (unchanged).
    const three = await h.post(base, {
      kind: "event",
      payload: { date: "2026-09-11", title: "Teslim", source: "belge:abcdef0123456789:chunk-1" },
    });
    expect(three.status).toBe(201);

    for (const source of ["belge:", "belge:a:b:c", "belge:a b", "belge::c", "uyap", "ai"]) {
      const bad = await h.post(base, { kind: "event", payload: { date: "2026-09-12", title: "x", source } });
      expect(bad.status, source).toBe(400);
      const issue = (bad.body as ErrorBody).error.issues?.[0];
      expect(issue?.path).toBe("payload.source");
      expect(issue?.message).toBe(
        "Kaynak: manual, belge:<dosya kimliği> veya belge:<dosya kimliği>:<parça kimliği> olmalı.",
      );
    }

    // The two-segment form also survives a PATCH merge.
    const itemId = (two.body as MatterItem).itemId;
    const patched = await h.patch(`${base}/${itemId}`, { payload: { verified: true } });
    expect(patched.status).toBe(200);
    expect((patched.body as MatterItem).payload).toMatchObject({ source: "belge:abcdef0123456789", verified: true });
  });

  it("derives counts and the earliest OPEN deadline; PATCH merges the payload", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const base = `/v1/matters/${matter.id}/items`;
    const later = (await h.post(base, { kind: "deadline", payload: { title: "İstinaf", dueDate: "2026-10-01" } }))
      .body as MatterItem;
    const sooner = (await h.post(base, { kind: "deadline", payload: { title: "Cevap", dueDate: "2026-09-16" } }))
      .body as MatterItem;
    await h.post(base, { kind: "note", payload: { text: "n" } });

    let list = (await h.json("/v1/matters")).body as { matters: MatterSummary[] };
    expect(list.matters[0]?.counts).toEqual({
      files: 0,
      answers: 0,
      drafts: 0,
      notes: 1,
      events: 0,
      deadlines: 2,
      hearings: 0,
    });
    // W14 (B-26): the row now says how many days are left and whether the
    // date has passed, so the console cannot show an overdue date as "next".
    expect(list.matters[0]?.nextDeadline).toEqual({
      itemId: sooner.itemId,
      title: "Cevap",
      dueDate: "2026-09-16",
      daysLeft: 14,
      overdue: false,
    });
    expect(list.matters[0]?.overdueCount).toBe(0);

    // Shallow merge: only status changes, title/dueDate survive.
    const done = await h.patch(`${base}/${sooner.itemId}`, { payload: { status: "tamam" } });
    expect(done.status).toBe(200);
    expect((done.body as MatterItem).payload).toEqual({
      title: "Cevap",
      dueDate: "2026-09-16",
      status: "tamam",
      source: "manual",
    });
    list = (await h.json("/v1/matters")).body as { matters: MatterSummary[] };
    expect(list.matters[0]?.nextDeadline?.itemId).toBe(later.itemId);
    expect(list.matters[0]?.lastActivityAt).toBe((done.body as MatterItem).updatedAt);

    const badMerge = await h.patch(`${base}/${later.itemId}`, { payload: { dueDate: "yarın" } });
    expect(badMerge.status).toBe(400);

    const unknownItem = await h.patch(`${base}/00000000-0000-4000-8000-00000000dead`, { payload: {} });
    expect(unknownItem.status).toBe(404);
    expect((unknownItem.body as ErrorBody).error).toEqual({ kind: "ITEM_NOT_FOUND", message: "Dosya kaydı bulunamadı." });

    expect((await h.del(`${base}/${later.itemId}`)).status).toBe(204);
    expect((await h.del(`${base}/${later.itemId}`)).status).toBe(404);
    list = (await h.json("/v1/matters")).body as { matters: MatterSummary[] };
    expect(list.matters[0]?.counts.deadlines).toBe(1);
    expect(list.matters[0]?.nextDeadline).toBeNull();
  });
});

describe("GET /v1/matters/deadlines", () => {
  it("lists open deadlines across matters by due date, with the matter title and today", async () => {
    const h = harness();
    const a = await createMatter(h, "A dosyası");
    const b = await createMatter(h, "B dosyası");
    await h.post(`/v1/matters/${a.id}/items`, { kind: "deadline", payload: { title: "A-geç", dueDate: "2026-10-05" } });
    await h.post(`/v1/matters/${b.id}/items`, { kind: "deadline", payload: { title: "B-erken", dueDate: "2026-09-08" } });
    await h.post(`/v1/matters/${a.id}/items`, {
      kind: "deadline",
      payload: { title: "A-bitti", dueDate: "2026-09-03", status: "tamam" },
    });

    const all = await h.json("/v1/matters/deadlines");
    expect(all.status).toBe(200);
    const body = all.body as { deadlines: Array<MatterItem & { matterTitle: string }>; today: string };
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // W14 (B-26): the default window is today .. today+30, so "A-geç"
    // (2026-10-05, 33 days out) is NOT in the default body any more. The
    // panel used to serialize every deadline the practice ever recorded.
    expect(body.deadlines.map((d) => [d.payload["title"], d.matterTitle])).toEqual([
      ["B-erken", "B dosyası"],
    ]);
    const wide = (await h.json("/v1/matters/deadlines?until=2026-12-31")).body as {
      deadlines: Array<MatterItem & { matterTitle: string }>;
    };
    expect(wide.deadlines.map((d) => [d.payload["title"], d.matterTitle])).toEqual([
      ["B-erken", "B dosyası"],
      ["A-geç", "A dosyası"],
    ]);

    const soon = (await h.json("/v1/matters/deadlines?until=2026-09-16")).body as { deadlines: MatterItem[] };
    expect(soon.deadlines.map((d) => d.payload["title"])).toEqual(["B-erken"]);

    const bad = await h.json("/v1/matters/deadlines?until=16.09.2026");
    expect(bad.status).toBe(400);
    expect((bad.body as ErrorBody).error.issues?.[0]?.path).toBe("until");
  });
});

describe("answers and drafts across stores", () => {
  it("files an answer under the matter (attach), fills its payload, merges live facts, detaches on delete", async () => {
    const h = harness();
    h.answers.put(storedAnswer("run-1", "Kira tahliye şartları nelerdir?"));
    const matter = await createMatter(h);

    const created = await h.post(`/v1/matters/${matter.id}/items`, { kind: "answer", refId: "run-1" });
    expect(created.status).toBe(201);
    expect((created.body as MatterItem).payload).toEqual({
      question: "Kira tahliye şartları nelerdir?",
      status: "COMPLETE",
      mode: "local",
    });
    expect(h.answers.get("run-1")?.matterId).toBe(matter.id);
    expect(await h.answers.list({ matterId: matter.id })).toHaveLength(1);

    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as { items: { answers: MatterItem[] } };
    expect(detail.items.answers[0]?.payload).toMatchObject({
      question: "Kira tahliye şartları nelerdir?",
      status: "COMPLETE",
      mode: "local",
      evidenceCount: 2,
      finalizable: true,
      answeredAt: "2026-09-01T10:00:00.000Z",
    });

    const itemId = (created.body as MatterItem).itemId;
    expect((await h.del(`/v1/matters/${matter.id}/items/${itemId}`)).status).toBe(204);
    expect(h.answers.get("run-1")?.matterId).toBeNull();

    // Deleting the matter detaches too.
    await h.post(`/v1/matters/${matter.id}/items`, { kind: "answer", refId: "run-1" });
    expect(h.answers.get("run-1")?.matterId).toBe(matter.id);
    expect((await h.del(`/v1/matters/${matter.id}`)).status).toBe(204);
    expect(h.answers.get("run-1")?.matterId).toBeNull();
  });

  it("deleting a matter tells the draft store to detach its drafts (W12-FIX)", async () => {
    const detached: string[] = [];
    const h = harness({
      drafts: {
        list: async () => [],
        detachMatter: async (matterId: string) => {
          detached.push(matterId);
        },
      },
    });
    const matter = await createMatter(h);
    expect((await h.del(`/v1/matters/${matter.id}`)).status).toBe(204);
    expect(detached).toEqual([matter.id]);
    // A failing detach never fails the delete.
    const h2 = harness({
      drafts: {
        list: async () => [],
        detachMatter: async () => {
          throw new Error("store down");
        },
      },
    });
    const m2 = await createMatter(h2);
    expect((await h2.del(`/v1/matters/${m2.id}`)).status).toBe(204);
  });

  it("filing the same record twice is idempotent: one item, 200 with the existing itemId (W12-FIX)", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const first = await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "file",
      refId: "0123456789abcdef",
      payload: { fileName: "cevap.docx" },
    });
    expect(first.status).toBe(201);
    const again = await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "file",
      refId: "0123456789abcdef",
      payload: { fileName: "cevap (kopya).docx" },
    });
    expect(again.status).toBe(200);
    expect((again.body as MatterItem).itemId).toBe((first.body as MatterItem).itemId);
    // The payload is refreshed, the count is not.
    expect((again.body as MatterItem).payload).toMatchObject({ fileName: "cevap (kopya).docx" });
    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as { items: { files: MatterItem[] } };
    expect(detail.items.files).toHaveLength(1);
    // A different record is still a new item; notes never dedupe.
    expect((await h.post(`/v1/matters/${matter.id}/items`, { kind: "file", refId: "fedcba9876543210" })).status).toBe(201);
    expect((await h.post(`/v1/matters/${matter.id}/items`, { kind: "note", payload: { text: "a" } })).status).toBe(201);
    expect((await h.post(`/v1/matters/${matter.id}/items`, { kind: "note", payload: { text: "a" } })).status).toBe(201);
  });

  it("an answer asked over uploads files with its fileScope and the matter page keeps it (W12-API2)", async () => {
    const h = harness();
    h.answers.put({
      ...storedAnswer("run-belge", "Depozito ne zaman iade edilir?"),
      result: {
        ...(storedAnswer("run-belge", "Depozito ne zaman iade edilir?").result as unknown as Record<string, unknown>),
        fileScope: { fileIds: ["abcdef0123456789"], includeCorpus: false },
      } as unknown as StoredAnswer["result"],
    });
    const matter = await createMatter(h);
    const created = await h.post(`/v1/matters/${matter.id}/items`, { kind: "answer", refId: "run-belge" });
    expect(created.status).toBe(201);
    expect((created.body as MatterItem).payload).toEqual({
      question: "Depozito ne zaman iade edilir?",
      status: "COMPLETE",
      mode: "local",
      fileScope: { fileIds: ["abcdef0123456789"], includeCorpus: false },
    });
    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as { items: { answers: MatterItem[] } };
    expect(detail.items.answers[0]?.payload).toMatchObject({
      mode: "local",
      evidenceCount: 2,
      fileScope: { fileIds: ["abcdef0123456789"], includeCorpus: false },
    });
    expect((await h.answers.list({ fileId: "abcdef0123456789" })).map((s) => s.runId)).toEqual(["run-belge"]);
  });

  it("an answer item whose run is unknown keeps the caller's payload", async () => {
    const h = harness();
    const matter = await createMatter(h);
    const res = await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "answer",
      refId: "run-gone",
      payload: { question: "Eski soru", status: "ABSTAIN", mode: "live" },
    });
    expect(res.status).toBe(201);
    expect((res.body as MatterItem).payload).toEqual({ question: "Eski soru", status: "ABSTAIN", mode: "live" });
    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as { items: { answers: MatterItem[] } };
    expect(detail.items.answers[0]?.payload).toEqual({ question: "Eski soru", status: "ABSTAIN", mode: "live" });
  });

  it("merges the live draft summary over the stored draft payload", async () => {
    const h = harness({
      drafts: {
        list: async ({ matterId }) => [
          {
            draftId: "dft-1",
            version: 3,
            template: "dava-dilekcesi",
            title: "Dava Dilekçesi",
            unsupportedCount: 2,
            createdAt: "2026-09-02T08:00:00.000Z",
            matterId: matterId ?? null,
          },
        ],
      },
    });
    const matter = await createMatter(h);
    await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "draft",
      refId: "dft-1",
      payload: { title: "Eski başlık", template: "dava-dilekcesi", version: 1 },
    });
    const detail = (await h.json(`/v1/matters/${matter.id}`)).body as { items: { drafts: MatterItem[] } };
    expect(detail.items.drafts[0]?.payload).toEqual({
      title: "Dava Dilekçesi",
      template: "dava-dilekcesi",
      version: 3,
      unsupportedCount: 2,
      createdAt: "2026-09-02T08:00:00.000Z",
    });
  });
});

describe("failure posture", () => {
  it("a throwing store is a typed 503 STORE_UNAVAILABLE, never a stack trace", async () => {
    const dead: MatterStore = {
      list: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:55432 postgres://secret");
      },
      create: async () => {
        throw new Error("down");
      },
      get: async () => {
        throw new Error("down");
      },
      update: async () => {
        throw new Error("down");
      },
      remove: async () => {
        throw new Error("down");
      },
      listItems: async () => {
        throw new Error("down");
      },
      getItem: async () => {
        throw new Error("down");
      },
      addItem: async () => {
        throw new Error("down");
      },
      updateItem: async () => {
        throw new Error("down");
      },
      removeItem: async () => {
        throw new Error("down");
      },
      listDeadlines: async () => {
        throw new Error("down");
      },
    };
    const app: Hono = createMattersRouter({ store: dead });
    for (const [path, init] of [
      ["/v1/matters", undefined],
      ["/v1/matters/deadlines", undefined],
      ["/v1/matters/00000000-0000-4000-8000-000000000001", undefined],
      [
        "/v1/matters",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) },
      ],
    ] as Array<[string, RequestInit | undefined]>) {
      const res = await app.request(path, init);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        error: { kind: "STORE_UNAVAILABLE", message: "Yerel veritabanına ulaşılamadı; dava dosyaları şu an açılamıyor." },
      });
      expect(text).not.toContain("secret");
    }
  });
});

describe("deriveMatterSummary", () => {
  it("takes lastActivityAt from the newest item and ignores closed / undated deadlines", () => {
    const matter: Matter = {
      id: "m",
      title: "t",
      client: "",
      opposing: "",
      court: "",
      docketNo: "",
      kind: "dava",
      status: "acik",
      notes: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const item = (itemId: string, kind: MatterItem["kind"], payload: Record<string, unknown>, at: string): MatterItem => ({
      itemId,
      matterId: "m",
      kind,
      refId: null,
      payload,
      createdAt: at,
      updatedAt: at,
    });
    const summary = deriveMatterSummary(matter, [
      item("d1", "deadline", { title: "kapalı", dueDate: "2026-09-03", status: "tamam" }, "2026-09-02T00:00:00.000Z"),
      item("d2", "deadline", { title: "tarihsiz" }, "2026-09-02T00:00:00.000Z"),
      item("d3", "deadline", { title: "açık", dueDate: "2026-09-20", status: "acik" }, "2026-09-05T00:00:00.000Z"),
      item("f1", "file", { fileName: "x.pdf" }, "2026-09-04T00:00:00.000Z"),
    ], "2026-09-02");
    expect(summary.counts).toEqual({
      files: 1,
      answers: 0,
      drafts: 0,
      notes: 0,
      events: 0,
      deadlines: 3,
      hearings: 0,
    });
    expect(summary.nextDeadline).toEqual({
      itemId: "d3",
      title: "açık",
      dueDate: "2026-09-20",
      daysLeft: 18,
      overdue: false,
    });
    expect(summary.lastActivityAt).toBe("2026-09-05T00:00:00.000Z");
  });
});

describe("W12-FIX2: item payload cap (P2-13) and immutable refId (P2-19)", () => {
  it("refuses an item payload over 64 KiB with 413 on POST and PATCH", async () => {
    expect(MAX_ITEM_PAYLOAD_BYTES).toBe(64 * 1024);
    const h = harness();
    const matter = await createMatter(h);
    const big = await h.post(`/v1/matters/${matter.id}/items`, {
      kind: "note",
      payload: { text: "ş".repeat(20_000), extra: "x".repeat(MAX_ITEM_PAYLOAD_BYTES) },
    });
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: { kind: "PAYLOAD_TOO_LARGE", message: ITEM_PAYLOAD_TOO_LARGE_MESSAGE_TR } });
    expect(await h.store.listItems(matter.id)).toEqual([]);

    const note = await h.post(`/v1/matters/${matter.id}/items`, { kind: "note", payload: { text: "kısa not" } });
    expect(note.status).toBe(201);
    const itemId = (note.body as { itemId: string }).itemId;
    const grow = await h.patch(`/v1/matters/${matter.id}/items/${itemId}`, {
      payload: { extra: "x".repeat(MAX_ITEM_PAYLOAD_BYTES) },
    });
    expect(grow.status).toBe(413);
    expect((await h.store.getItem(matter.id, itemId))?.payload).toEqual({ text: "kısa not", source: "manual" });
  });

  it("refuses a refId change on file/answer/draft items (400), allows it on notes", async () => {
    const h = harness();
    const matter = await createMatter(h);
    h.answers.put(storedAnswer("run-1", "Soru"));
    const answer = await h.post(`/v1/matters/${matter.id}/items`, { kind: "answer", refId: "run-1" });
    expect(answer.status).toBe(201);
    const itemId = (answer.body as { itemId: string }).itemId;
    const moved = await h.patch(`/v1/matters/${matter.id}/items/${itemId}`, { refId: "run-2" });
    expect(moved.status).toBe(400);
    expect((moved.body as { error: { issues: { path: string; message: string }[] } }).error.issues).toEqual([
      { path: "refId", message: REF_ID_IMMUTABLE_MESSAGE_TR },
    ]);
    expect((await h.store.getItem(matter.id, itemId))?.refId).toBe("run-1");
    expect(h.answers.get("run-1")?.matterId).toBe(matter.id);
    // The same refId (a no-op) and a payload-only patch are fine.
    expect((await h.patch(`/v1/matters/${matter.id}/items/${itemId}`, { refId: "run-1", payload: { status: "PARTIAL" } })).status).toBe(200);
    const note = await h.post(`/v1/matters/${matter.id}/items`, { kind: "note", payload: { text: "not" } });
    const noteId = (note.body as { itemId: string }).itemId;
    expect((await h.patch(`/v1/matters/${matter.id}/items/${noteId}`, { refId: "abcdef0123456789" })).status).toBe(200);
  });
});
