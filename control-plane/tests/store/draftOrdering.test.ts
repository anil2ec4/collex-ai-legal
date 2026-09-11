import { describe, expect, it } from "vitest";
import type { Sql } from "../../src/store/db.js";
import { PgDraftStore, type StorableDraft } from "../../src/store/draftStore.js";

const draft = (draftId: string, title: string): StorableDraft => ({
  draftId, title, version: 1, kind: "dilekce", template: "dava-dilekcesi",
  createdAt: "2026-09-07T09:00:00.000Z", unsupportedCount: 0,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** SQL boundary double: writes commit only after the injected disk/DB delay. */
function database(beforeWrite: (value: StorableDraft) => Promise<void>) {
  const rows = new Map<string, StorableDraft>();
  const execute = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (parts.join("").includes("insert into")) {
      const value = structuredClone(values[8]) as StorableDraft;
      await beforeWrite(value);
      rows.set(value.draftId, value);
      return [];
    }
    const body = rows.get(values[1] as string);
    return body === undefined ? [] : [{ body: structuredClone(body) }];
  };
  const sql = Object.assign(execute, { json: (value: unknown) => structuredClone(value) }) as unknown as Sql;
  return { sql, rows };
}

describe("draft durability under overlapping saves", () => {
  it("a slow older write cannot overwrite the latest same-version save, even after cache eviction", async () => {
    const started = deferred();
    const release = deferred();
    const db = database(async (value) => {
      if (value.title === "önceki") { started.resolve(); await release.promise; }
    });
    const store = new PgDraftStore({ sql: db.sql, capacity: 1 });
    store.put(draft("a", "önceki"));
    await started.promise;
    store.put(draft("b", "bağımsız"));
    await store.persisted("b"); // unrelated drafts must not wait for a
    store.put(draft("a", "son düzenleme"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    await store.flush();
    expect(db.rows.get("a")?.title).toBe("son düzenleme");
    const reopened = new PgDraftStore({ sql: db.sql });
    await reopened.warm("a");
    expect(reopened.get("a")?.title).toBe("son düzenleme");
  });

  it("evicting a pending failed save cannot report success", async () => {
    const release = deferred();
    const db = database(async (value) => {
      if (value.draftId === "a") { await release.promise; throw new Error("disk write failed"); }
    });
    const store = new PgDraftStore({ sql: db.sql, capacity: 1, log: () => undefined });
    store.put(draft("a", "kaydedilemeyen"));
    store.put(draft("b", "diğer"));
    const outcome = store.persisted("a");
    release.resolve();
    expect(await outcome).toBe(false);
    await store.flush();
  });

  it("opening archived drafts respects the cache capacity", async () => {
    const db = database(async () => undefined);
    for (let i = 0; i < 5; i++) db.rows.set(String(i), draft(String(i), "arşiv"));
    const store = new PgDraftStore({ sql: db.sql, capacity: 2 });
    for (let i = 0; i < 5; i++) await store.warm(String(i));
    expect(store.size).toBe(2);
    expect(store.get("4")?.title).toBe("arşiv");
  });

  it("queued writes capture the submitted body and continue after an earlier failure", async () => {
    const release = deferred();
    const db = database(async (value) => {
      if (value.title === "önceki") { await release.promise; throw new Error("offline"); }
    });
    const store = new PgDraftStore({ sql: db.sql, log: () => undefined });
    store.put(draft("a", "önceki"));
    const submitted = draft("a", "kaydedilen");
    store.put(submitted);
    submitted.title = "henüz kaydedilmemiş";
    release.resolve();
    expect(await store.persisted("a")).toBe(true);
    expect(db.rows.get("a")?.title).toBe("kaydedilen");
  });

  it("an old archive read cannot replace a save made while it was loading", async () => {
    const release = deferred();
    const db = database(async () => undefined);
    const readSql = Object.assign(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      if (parts.join("").includes("select body")) {
        await release.promise;
        return [{ body: draft("a", "eski") }];
      }
      return db.sql(parts, ...values as never[]);
    }, { json: db.sql.json }) as unknown as Sql;
    const store = new PgDraftStore({ sql: readSql });
    const loading = store.warm("a");
    store.put(draft("a", "yeni"));
    await store.persisted("a");
    release.resolve();
    await loading;
    expect(store.get("a")?.title).toBe("yeni");
  });
});
