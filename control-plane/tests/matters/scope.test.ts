/**
 * Matter query scope (W19 phase C) — "search everything in THIS matter".
 *
 * The properties under test:
 *  - a matter expands to ITS OWN uploads, server-side, so the browser never
 *    has to enumerate a hundred file ids;
 *  - scope NEVER widens: naming a file that is not in the matter is refused
 *    by name, not silently dropped and not silently allowed;
 *  - one file may belong to MANY matters, and membership is a link, never a
 *    copy;
 *  - a store that cannot answer is not reported as an empty matter.
 */

import { describe, expect, it } from "vitest";
import {
  MATTER_SCOPE_MAX_FILES,
  matterFileIds,
  resolveMatterScope,
} from "../../src/matters/scope.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";

function clock(start = "2026-09-11T09:00:00.000Z"): () => Date {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

async function matterWithFiles(
  store: MatterStore,
  title: string,
  fileIds: readonly string[],
): Promise<string> {
  const matter = await store.create({ title });
  for (const fileId of fileIds) {
    await store.addItem(matter.id, {
      kind: "file",
      refId: fileId,
      payload: { fileName: `${fileId}.pdf` },
    });
  }
  return matter.id;
}

describe("resolveMatterScope", () => {
  it("expands a matter to its own uploads without the caller listing them", async () => {
    const store = new InMemoryMatterStore(clock());
    const matterId = await matterWithFiles(store, "Kira davası", ["f1", "f2", "f3"]);

    const outcome = await resolveMatterScope(store, { matterId });

    expect(outcome.kind).toBe("RESOLVED");
    if (outcome.kind !== "RESOLVED") return;
    expect(outcome.fileIds).toEqual(["f1", "f2", "f3"]);
    expect(outcome.matterId).toBe(matterId);
    expect(outcome.matterFileCount).toBe(3);
    // Matter evidence only, unless the caller asks for the corpus.
    expect(outcome.includeCorpus).toBe(false);
  });

  it("keeps the corpus out by default and unions it only on request", async () => {
    const store = new InMemoryMatterStore(clock());
    const matterId = await matterWithFiles(store, "Dosya", ["f1"]);

    const off = await resolveMatterScope(store, { matterId });
    const on = await resolveMatterScope(store, { matterId, includeCorpus: true });

    expect(off.kind === "RESOLVED" && off.includeCorpus).toBe(false);
    expect(on.kind === "RESOLVED" && on.includeCorpus).toBe(true);
  });

  it("collapses a document linked to the same matter twice", async () => {
    const store = new InMemoryMatterStore(clock());
    const matterId = await matterWithFiles(store, "Dosya", ["f1", "f1", "f2"]);

    const outcome = await resolveMatterScope(store, { matterId });

    expect(outcome.kind === "RESOLVED" && outcome.fileIds).toEqual(["f1", "f2"]);
  });

  it("ignores non-file items when resolving membership", async () => {
    const store = new InMemoryMatterStore(clock());
    const matterId = await matterWithFiles(store, "Dosya", ["f1"]);
    await store.addItem(matterId, { kind: "note", payload: { text: "not" } });
    await store.addItem(matterId, {
      kind: "answer",
      refId: "run-1",
      payload: { question: "s", status: "COMPLETE", mode: "local" },
    });

    expect(await matterFileIds(store, matterId)).toEqual(["f1"]);
  });

  // -- Scope never widens ---------------------------------------------------

  it("verifies explicit file ids against the matter instead of trusting them", async () => {
    const store = new InMemoryMatterStore(clock());
    const matterId = await matterWithFiles(store, "Dosya A", ["a1", "a2"]);

    const outcome = await resolveMatterScope(store, { matterId, fileIds: ["a1"] });

    expect(outcome.kind === "RESOLVED" && outcome.fileIds).toEqual(["a1"]);
  });

  it("refuses BY NAME a file that is not in the named matter", async () => {
    const store = new InMemoryMatterStore(clock());
    const matterId = await matterWithFiles(store, "Dosya A", ["a1", "a2"]);
    await matterWithFiles(store, "Dosya B", ["b1"]);

    const outcome = await resolveMatterScope(store, {
      matterId,
      fileIds: ["a1", "b1"],
    });

    expect(outcome.kind).toBe("FILES_OUTSIDE_MATTER");
    if (outcome.kind !== "FILES_OUTSIDE_MATTER") return;
    // Named, so the reader can see WHICH document was refused — a silent
    // drop would hide a mistake, a silent pass would cross matters.
    expect(outcome.outside).toEqual(["b1"]);
  });

  // -- Scenario D: two matters, no leakage ---------------------------------

  it("scenario D: a question scoped to matter A cannot reach matter B", async () => {
    const store = new InMemoryMatterStore(clock());
    const a = await matterWithFiles(store, "Dosya A", ["a1", "a2"]);
    const b = await matterWithFiles(store, "Dosya B", ["b1", "b2"]);

    const scopedA = await resolveMatterScope(store, { matterId: a });
    const scopedB = await resolveMatterScope(store, { matterId: b });

    expect(scopedA.kind === "RESOLVED" && scopedA.fileIds).toEqual(["a1", "a2"]);
    expect(scopedB.kind === "RESOLVED" && scopedB.fileIds).toEqual(["b1", "b2"]);
    // No id appears in both scopes.
    const inA = new Set(scopedA.kind === "RESOLVED" ? scopedA.fileIds : []);
    for (const id of scopedB.kind === "RESOLVED" ? scopedB.fileIds : []) {
      expect(inA.has(id)).toBe(false);
    }
  });

  // -- Scenario E: one file, two matters ------------------------------------

  it("scenario E: the same document may belong to two matters", async () => {
    const store = new InMemoryMatterStore(clock());
    const a = await matterWithFiles(store, "Dosya A", ["shared", "a1"]);
    const b = await matterWithFiles(store, "Dosya B", ["shared", "b1"]);

    const scopedA = await resolveMatterScope(store, { matterId: a });
    const scopedB = await resolveMatterScope(store, { matterId: b });

    expect(scopedA.kind === "RESOLVED" && scopedA.fileIds).toContain("shared");
    expect(scopedB.kind === "RESOLVED" && scopedB.fileIds).toContain("shared");
    // Membership is a LINK: the document id is the same object in both
    // scopes, so nothing downstream needs a second copy of its text,
    // chunks or embeddings.
    expect(scopedA.kind === "RESOLVED" && scopedA.fileIds).not.toContain("b1");
    expect(scopedB.kind === "RESOLVED" && scopedB.fileIds).not.toContain("a1");
  });

  it("scenario E: unlinking from one matter leaves the other scope intact", async () => {
    const store = new InMemoryMatterStore(clock());
    const a = await matterWithFiles(store, "Dosya A", ["shared"]);
    const b = await matterWithFiles(store, "Dosya B", ["shared"]);

    const items = await store.listItems(a);
    await store.removeItem(a, items[0]!.itemId);

    expect((await resolveMatterScope(store, { matterId: a })).kind).toBe("MATTER_EMPTY");
    const stillB = await resolveMatterScope(store, { matterId: b });
    expect(stillB.kind === "RESOLVED" && stillB.fileIds).toEqual(["shared"]);
  });

  // -- Typed refusals -------------------------------------------------------

  it("an unknown matter is NOT_FOUND, never an empty search", async () => {
    const store = new InMemoryMatterStore(clock());
    const outcome = await resolveMatterScope(store, {
      matterId: "11111111-2222-3333-4444-555555555555",
    });
    expect(outcome.kind).toBe("MATTER_NOT_FOUND");
  });

  it("a matter with no documents is EMPTY, never an empty search", async () => {
    const store = new InMemoryMatterStore(clock());
    const matter = await store.create({ title: "Boş dosya" });
    const outcome = await resolveMatterScope(store, { matterId: matter.id });
    expect(outcome.kind).toBe("MATTER_EMPTY");
  });

  it("a store that throws is UNAVAILABLE, not an empty matter", async () => {
    const broken = {
      ...new InMemoryMatterStore(clock()),
      get: async () => {
        throw new Error("connection lost");
      },
    } as unknown as MatterStore;

    const outcome = await resolveMatterScope(broken, {
      matterId: "11111111-2222-3333-4444-555555555555",
    });

    // "I could not read the matter" and "this matter has no documents" are
    // different facts; only one of them is the lawyer's problem.
    expect(outcome.kind).toBe("STORE_UNAVAILABLE");
  });

  it("refuses a matter larger than the server ceiling instead of truncating", async () => {
    const store = new InMemoryMatterStore(clock());
    const ids = Array.from({ length: MATTER_SCOPE_MAX_FILES + 1 }, (_, i) => `f${i}`);
    const matterId = await matterWithFiles(store, "Çok büyük dosya", ids);

    const outcome = await resolveMatterScope(store, { matterId });

    expect(outcome.kind).toBe("MATTER_TOO_LARGE");
    if (outcome.kind !== "MATTER_TOO_LARGE") return;
    expect(outcome.fileCount).toBe(MATTER_SCOPE_MAX_FILES + 1);
    expect(outcome.limit).toBe(MATTER_SCOPE_MAX_FILES);
  });

  it("expands a matter far past the 50-id request cap", async () => {
    // The point of resolving server-side: 120 documents is an ordinary
    // litigation matter and cannot be typed into `filters.fileIds`.
    const store = new InMemoryMatterStore(clock());
    const ids = Array.from({ length: 120 }, (_, i) => `f${i}`);
    const matterId = await matterWithFiles(store, "Büyük dosya", ids);

    const outcome = await resolveMatterScope(store, { matterId });

    expect(outcome.kind === "RESOLVED" && outcome.fileIds.length).toBe(120);
  });

  // -- Backwards compatibility ---------------------------------------------

  it("without a matter, explicit file ids pass through unchanged (legacy)", async () => {
    const store = new InMemoryMatterStore(clock());
    const outcome = await resolveMatterScope(store, {
      fileIds: ["x1", "x2"],
      includeCorpus: true,
    });
    expect(outcome.kind === "RESOLVED" && outcome.fileIds).toEqual(["x1", "x2"]);
    expect(outcome.kind === "RESOLVED" && outcome.includeCorpus).toBe(true);
    expect(outcome.kind === "RESOLVED" && outcome.matterId).toBeUndefined();
  });

  it("an empty scope resolves to no scope at all", async () => {
    const store = new InMemoryMatterStore(clock());
    const outcome = await resolveMatterScope(store, {});
    expect(outcome.kind === "RESOLVED" && outcome.fileIds).toEqual([]);
  });
});
