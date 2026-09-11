/**
 * InMemoryDraftStore (W12 contract [P]): versions per draftId, latest on
 * get, list/versions summaries, matter filter, bounded capacity.
 */

import { describe, expect, it } from "vitest";

import { composeDraft } from "../../src/drafting/composer.js";
import { reviseDraft } from "../../src/drafting/revise.js";
import { InMemoryDraftStore, summarizeDraft } from "../../src/drafting/store.js";
import { davaRequest } from "./fixtures.js";

const NOW = () => new Date("2026-09-02T12:00:00.000Z");

describe("InMemoryDraftStore", () => {
  it("stores every put as a version, returns the latest, lists history", async () => {
    const store = new InMemoryDraftStore();
    const v1 = composeDraft(davaRequest(), undefined, { now: NOW, draftId: "dft-a" });
    store.put(v1);
    const v2 = reviseDraft(v1, { sections: v1.sections.map((s) => ({ id: s.id, paragraphs: s.paragraphs })) }, {
      trustEntailment: false,
      now: () => new Date("2026-09-02T12:05:00.000Z"),
    }).draft;
    store.put(v2);

    expect(store.get("dft-a")?.version).toBe(2);
    expect(store.size).toBe(1);
    await store.warm("dft-a"); // no-op
    const versions = await store.versions("dft-a");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1]).toEqual(summarizeDraft(v2));
    expect(versions[1]?.createdAt).toBe("2026-09-02T12:05:00.000Z");
    expect(await store.versions("dft-yok")).toEqual([]);
  });

  it("lists one summary per draft, newest first, filtered by matterId and limited", async () => {
    const store = new InMemoryDraftStore();
    const request = davaRequest();
    const a = composeDraft({ ...request, matter: { ...request.matter, matterId: "m-1" } }, undefined, {
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      draftId: "dft-a",
    });
    const b = composeDraft(request, undefined, { now: () => new Date("2026-09-02T00:00:00.000Z"), draftId: "dft-b" });
    store.put(a);
    store.put(b);
    const all = await store.list();
    expect(all.map((d) => d.draftId)).toEqual(["dft-b", "dft-a"]);
    expect(all[1]).toMatchObject({ matterId: "m-1", kind: "dilekce", template: "dava-dilekcesi", unsupportedCount: 2 });
    expect(all[0]?.matterId).toBeNull();
    expect((await store.list({ matterId: "m-1" })).map((d) => d.draftId)).toEqual(["dft-a"]);
    expect(await store.list({ limit: 1 })).toHaveLength(1);
  });

  it("detachMatter nulls the matter on every version of every draft that named it (W12-FIX)", async () => {
    const store = new InMemoryDraftStore();
    const request = davaRequest();
    const a = composeDraft({ ...request, matter: { ...request.matter, matterId: "m-1" } }, undefined, { now: NOW, draftId: "dft-a" });
    store.put(a);
    store.put(reviseDraft(a, { sections: a.sections.map((s) => ({ id: s.id, paragraphs: s.paragraphs })) }, { trustEntailment: false, now: NOW }).draft);
    const b = composeDraft({ ...request, matter: { ...request.matter, matterId: "m-2" } }, undefined, { now: NOW, draftId: "dft-b" });
    store.put(b);
    await store.detachMatter("m-1");
    expect(store.get("dft-a")?.matterId).toBeNull();
    expect((await store.versions("dft-a")).map((v) => v.matterId)).toEqual([null, null]);
    expect(store.get("dft-b")?.matterId).toBe("m-2");
    expect(await store.list({ matterId: "m-1" })).toEqual([]);
    expect(await store.persisted("dft-a")).toBe(true);
  });

  it("evicts the oldest draft (all its versions) beyond capacity", () => {
    const store = new InMemoryDraftStore(2);
    for (const id of ["dft-1", "dft-2", "dft-3"]) {
      store.put(composeDraft(davaRequest(), undefined, { now: NOW, draftId: id }));
    }
    expect(store.get("dft-1")).toBeUndefined();
    expect(store.get("dft-3")).toBeDefined();
    expect(() => new InMemoryDraftStore(0)).toThrow(RangeError);
  });
});
