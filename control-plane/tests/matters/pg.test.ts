/**
 * REAL SQL tests for the W14 store additions, on `collex_matter_test`.
 *
 * Scratch-database discipline (CLAUDE.md): this file creates and drops ONLY
 * `collex_matter_test` — the name is a module constant, so no other database
 * can be named — and SKIPS cleanly with an always-running marker when the
 * local PostgreSQL 18 at 127.0.0.1:55432 is unreachable. Everything is
 * loopback-local; `collex_local` is never touched.
 *
 * What real SQL proves here that a fake cannot:
 *  - PgMatterStore.addItems writes N records in ONE statement (B-18);
 *  - listHearings / searchItems / listRecentItems return what the router
 *    promises (B-17, B-29, B-43);
 *  - `nextDeadline` skips the past against real rows (B-26);
 *  - PgAnswerStore `q` / `status` really filter and `remove` really deletes,
 *    and `matterTitle` comes from the join (B-26);
 *  - PgDraftStore.getVersionBody returns an OLD version's body and `remove`
 *    drops every version (B-26).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { StoredAnswer } from "../../src/api/answerService.js";
import { PgAnswerStore } from "../../src/store/answerStore.js";
import { PgDraftStore, type StorableDraft } from "../../src/store/draftStore.js";
import { createDb, type Sql } from "../../src/store/db.js";
import { ItemKindUnsupportedError, PgMatterStore } from "../../src/matters/store.js";
import { PgContactStore } from "../../src/matters/contacts.js";
import { planMigrations } from "../store/testDb.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 300_000 });

const TEST_DB_NAME = "collex_matter_test";
const HOST_PORT = process.env["COLLEX_TEST_DB_HOSTPORT"] ?? "127.0.0.1:55432";
const ADMIN_URL = "postgres://postgres@" + HOST_PORT + "/postgres";
const TEST_DB_URL = "postgres://postgres@" + HOST_PORT + "/" + TEST_DB_NAME;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

let available = false;
let unavailableReason = "";
{
  const admin = postgres(ADMIN_URL, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await admin`select 1`;
    available = true;
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : String(error);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function resetDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe("drop database if exists " + TEST_DB_NAME + " with (force)");
    await admin.unsafe(
      "create database " + TEST_DB_NAME + " template template0 encoding 'UTF8' locale 'C'",
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function dropDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe("drop database if exists " + TEST_DB_NAME + " with (force)");
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const TENANT = "00000000-0000-0000-0000-000000000001";

const answer = (runId: string, question: string, status: string, matterId?: string): StoredAnswer => ({
  runId,
  result: {
    schema: "collex.answer.result/v1",
    runId,
    question,
    status,
    finalizable: status === "COMPLETE",
    evidence: [{ evidenceId: "e1" }],
  } as unknown as StoredAnswer["result"],
  bundle: { schema: "collex.answer.evidence-bundle/v1" } as unknown as StoredAnswer["bundle"],
  storedAt: "2026-09-02T10:00:00.000Z",
  question,
  ...(matterId !== undefined ? { matterId } : {}),
});

const draft = (draftId: string, version: number, updatedAt: string): StorableDraft & {
  updatedAt: string;
  body: string;
} => ({
  draftId,
  version,
  kind: "dilekce",
  template: "cevap-dilekcesi",
  title: "Cevap dilekçesi",
  createdAt: "2026-09-02T09:00:00.000Z",
  unsupportedCount: 0,
  matterId: null,
  updatedAt,
  body: `sürüm ${version}`,
});

describe.skipIf(!available)("W14 stores against real SQL (collex_matter_test)", () => {
  let db: Sql;

  beforeAll(async () => {
    await resetDatabase();
    const plan = await planMigrations();
    const runner = postgres(TEST_DB_URL, { max: 1, connect_timeout: 10, onnotice: () => undefined });
    try {
      for (const file of plan.runnable) {
        await runner.unsafe(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
      }
    } finally {
      await runner.end({ timeout: 10 });
    }
    db = createDb({ url: TEST_DB_URL, max: 2, applicationName: "collex-w14-matter-test" });
  });

  afterAll(async () => {
    if (db !== undefined) await db.end({ timeout: 5 });
    await dropDatabase();
  });

  it("B-18: addItems writes 12 records in ONE statement and keeps them all", async () => {
    const store = new PgMatterStore({ sql: db, tenantId: TENANT });
    const matter = await store.create({ title: "Kronoloji dosyası" });
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      kind: "event" as const,
      payload: {
        date: `2026-0${(i % 9) + 1}-1${i % 10}`,
        title: `Belgeden çıkarılan olay ${i}`,
        source: "belge:0123456789abcdef",
        verified: false,
      },
    }));
    const created = await store.addItems(matter.id, inputs);
    expect(created).toHaveLength(12);
    const items = await store.listItems(matter.id);
    expect(items.filter((i) => i.kind === "event")).toHaveLength(12);
    // The matter's updated_at moved with the newest item (one touch, not 12).
    const reloaded = await store.get(matter.id);
    expect(reloaded!.updatedAt >= matter.updatedAt).toBe(true);
  });

  it("B-26: nextDeadline skips the past and overdueCount counts it, against real rows", async () => {
    const store = new PgMatterStore({ sql: db, tenantId: TENANT });
    const matter = await store.create({ title: "Süre dosyası" });
    await store.addItems(matter.id, [
      { kind: "deadline", payload: { title: "Geçmiş", dueDate: "2026-07-15", status: "acik" } },
      { kind: "deadline", payload: { title: "Gerçek sonraki", dueDate: "2026-09-08", status: "acik" } },
      { kind: "deadline", payload: { title: "Bitti", dueDate: "2026-09-05", status: "tamam" } },
    ]);
    const rows = await store.list({ today: "2026-09-02" });
    const row = rows.find((r) => r.id === matter.id)!;
    expect(row.nextDeadline).toMatchObject({ title: "Gerçek sonraki", dueDate: "2026-09-08", daysLeft: 6 });
    expect(row.overdueCount).toBe(1);

    // The list endpoint's window: `from` drops the past, `until` caps it.
    const windowed = await store.listDeadlines({ from: "2026-09-02", until: "2026-10-02" });
    expect(windowed.map((d) => d.payload["title"])).toContain("Gerçek sonraki");
    expect(windowed.map((d) => d.payload["title"])).not.toContain("Geçmiş");
  });

  it("B-29/B-43: searchItems and listRecentItems read real payload text", async () => {
    const store = new PgMatterStore({ sql: db, tenantId: TENANT });
    const matter = await store.create({ title: "Arama dosyası", client: "Ayşe Yılmaz" });
    await store.addItems(matter.id, [
      { kind: "note", payload: { text: "Depozito 3 aylık kira bedeli kadar alınmış.", source: "manual" } },
      { kind: "event", payload: { date: "2026-03-01", title: "Depozito ödendi", source: "manual" } },
      { kind: "note", payload: { text: "İlgisiz not", source: "manual" } },
    ]);
    const hits = await store.searchItems({ q: "depozito", limit: 10 });
    expect(hits.map((h) => h.kind).sort()).toEqual(["event", "note"]);
    expect(hits.every((h) => h.matterTitle === "Arama dosyası")).toBe(true);
    // Wildcards in the needle are neutralised, not interpreted.
    expect(await store.searchItems({ q: "%", limit: 10 })).toEqual([]);

    const recent = await store.listRecentItems(matter.id, 2);
    expect(recent).toHaveLength(2);

    const byQuery = await store.list({ q: "yılmaz", today: "2026-09-02" });
    expect(byQuery.map((m) => m.id)).toContain(matter.id);
  });

  it("B-17: a hearing is stored, listed and calendar-ordered — or refused with a typed error", async () => {
    const store = new PgMatterStore({ sql: db, tenantId: TENANT });
    const matter = await store.create({ title: "Duruşma dosyası" });
    const payload = {
      date: "2026-09-18",
      time: "10:00",
      court: "İzmir 3. Sulh Hukuk",
      salon: "Salon 1",
      kind: "durusma",
      status: "planlandi",
    };
    let accepted = true;
    try {
      await store.addItems(matter.id, [{ kind: "hearing", payload }]);
    } catch (error) {
      // The `matter_items.kind` CHECK constraint does not list 'hearing' yet
      // (the ALTER is L-SAFE's migration — see the L-MATTER report's
      // integrationRequests). Until it lands the lawyer must get ONE Turkish
      // sentence, never a driver error, and that is what is asserted here.
      expect(error).toBeInstanceOf(ItemKindUnsupportedError);
      accepted = false;
    }
    if (accepted) {
      const hearings = await store.listHearings({ from: "2026-09-02", until: "2026-10-02" });
      expect(hearings.map((h) => h.payload["date"])).toContain("2026-09-18");
      const rows = await store.list({ today: "2026-09-02" });
      expect(rows.find((r) => r.id === matter.id)?.nextHearing).toMatchObject({
        date: "2026-09-18",
        time: "10:00",
      });
    } else {
      expect(await store.listHearings({})).toEqual([]);
    }
  });

  it("B-26: answers filter by q/status, carry matterTitle, and remove() really deletes", async () => {
    const matters = new PgMatterStore({ sql: db, tenantId: TENANT });
    const matter = await matters.create({ title: "Cevap dosyası" });
    const store = new PgAnswerStore({ sql: db, tenantId: TENANT, log: () => undefined });
    store.put(answer("run-a", "Depozito iadesi nasıl istenir?", "COMPLETE", matter.id));
    store.put(answer("run-b", "Kira tespiti davası ne zaman açılır?", "PARTIAL"));
    store.put(answer("run-c", "Depozito faizi işler mi?", "ABSTAIN"));
    await store.flush();

    const byQuestion = await store.list({ q: "depozito" });
    expect(byQuestion.map((a) => a.runId).sort()).toEqual(["run-a", "run-c"]);
    const byStatus = await store.list({ status: "PARTIAL" });
    expect(byStatus.map((a) => a.runId)).toEqual(["run-b"]);
    const both = await store.list({ q: "depozito", status: "COMPLETE" });
    expect(both.map((a) => a.runId)).toEqual(["run-a"]);
    expect(both[0]?.matterTitle).toBe("Cevap dosyası");
    // A wildcard in the needle matches nothing (it is escaped, not applied).
    expect(await store.list({ q: "%" })).toEqual([]);

    expect(await store.remove("run-b")).toBe(true);
    expect(await store.remove("run-b")).toBe(false);
    expect((await store.list({})).map((a) => a.runId).sort()).toEqual(["run-a", "run-c"]);
    // Gone from the cache too, so a later GET cannot resurrect it.
    expect(store.get("run-b")).toBeUndefined();
    await store.warm("run-b");
    expect(store.get("run-b")).toBeUndefined();
  });

  it("B-26: an OLD draft version's body is readable and remove() drops every version", async () => {
    const store = new PgDraftStore({ sql: db, tenantId: TENANT, log: () => undefined });
    store.put(draft("d-1", 1, "2026-09-02T09:07:29.992Z"));
    store.put(draft("d-1", 2, "2026-09-02T09:09:41.100Z"));
    await store.flush();

    const v1 = await store.getVersionBody("d-1", 1);
    expect(v1?.["body"]).toBe("sürüm 1");
    const v2 = await store.getVersionBody("d-1", 2);
    expect(v2?.["body"]).toBe("sürüm 2");
    expect(await store.getVersionBody("d-1", 9)).toBeUndefined();

    // UXAUDIT P1-4: the version rows must not all report the same timestamp.
    const versions = await store.versions("d-1");
    expect(versions.map((v) => v.updatedAt)).toEqual([
      "2026-09-02T09:09:41.100Z",
      "2026-09-02T09:07:29.992Z",
    ]);
    const listed = await store.list({});
    expect(listed.find((d) => d.draftId === "d-1")?.updatedAt).toBe("2026-09-02T09:09:41.100Z");
    expect((await store.list({ q: "cevap" })).map((d) => d.draftId)).toContain("d-1");
    expect(await store.list({ q: "icra" })).toEqual([]);

    expect(await store.remove("d-1")).toBe(true);
    expect(await store.remove("d-1")).toBe(false);
    expect(await store.versions("d-1")).toEqual([]);
  });

  it("UXAUDIT P1-3: the listing returns EXACTLY the rows in app_private.matters", async () => {
    // The audit saw six matters in the console's selector while the API
    // returned two and SQL held two, and left the cause open. The listing
    // endpoint is exonerated here: `list()` is compared row-for-row against a
    // direct count of the table, so it cannot invent a matter. (The ghost
    // option comes from the console's localStorage fallback — see the
    // L-MATTER report; the fix is L-CONSOLE's B-10.)
    const store = new PgMatterStore({ sql: db, tenantId: TENANT });
    const listed = await store.list({ today: "2026-09-02" });
    const rows = await db`
      select id from app_private.matters where tenant_id = ${TENANT} order by id`;
    expect(listed.map((m) => m.id).sort()).toEqual(rows.map((r) => String(r["id"])).sort());
    // A matter of ANOTHER tenant is never listed for this one.
    const other = new PgMatterStore({
      sql: db,
      tenantId: "00000000-0000-0000-0000-0000000000ff",
    });
    expect(await other.list({})).toEqual([]);
  });

  it("B-42: contacts round-trip through app_private.settings", async () => {
    const store = new PgContactStore({ sql: db, tenantId: TENANT });
    expect(await store.list()).toEqual([]);
    await store.save([
      {
        id: "c1",
        ad: "Ayşe Yılmaz",
        tckn: "10000000146",
        vkn: "",
        adres: "İzmir",
        telefon: "",
        eposta: "",
        uetsAdresi: "",
        rol: "muvekkil",
        notlar: "",
        createdAt: "2026-09-02T09:00:00.000Z",
        updatedAt: "2026-09-02T09:00:00.000Z",
      },
    ]);
    const back = await store.list();
    expect(back).toHaveLength(1);
    expect(back[0]?.ad).toBe("Ayşe Yılmaz");
    expect(back[0]?.rol).toBe("muvekkil");
    // The settings document is replaced, never appended to.
    await store.save([]);
    expect(await store.list()).toEqual([]);
  });
});

describe("W14 stores (environment unavailable)", () => {
  it.skipIf(available)(
    "skips cleanly: scratch PostgreSQL at 127.0.0.1:55432 is not reachable",
    () => {
      expect(unavailableReason).not.toBe("");
    },
  );
  it("always runs: the probe database name is a constant, so no other name can be created", () => {
    expect(TEST_DB_NAME).toBe("collex_matter_test");
    expect(TEST_DB_URL.endsWith("/collex_matter_test")).toBe(true);
  });
});
