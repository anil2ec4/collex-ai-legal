/**
 * W14 · L-FIX — the cross-lane defects, each pinned by the behaviour a lawyer
 * would have seen.
 *
 * These are integration tests over the MOUNTED app (`createApp` + hono's
 * `app.request()`), because every one of them was a wiring defect: the lane
 * code was right and the seam between two lanes was empty. A unit test on
 * either side would have stayed green through all of it — several did.
 *
 * Fully offline: fake stores, a fake exporter runner, no socket, no SQL.
 */

import { describe, expect, it } from "vitest";
import { createApp, FILE_NOT_FOUND_MESSAGE_TR } from "../../src/api/server.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import { InMemoryAnswerStore } from "../../src/api/answerService.js";
import { InMemoryDraftStore } from "../../src/drafting/store.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import type { FilesReadStore } from "../../src/files/store.js";
import type { Draft } from "../../src/drafting/types.js";
import {
  Q_NORM_CONTENT,
  StubCorpus,
  laneError,
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  STANDARD_FACTS,
  standardTexts,
} from "../pipeline/fakes.js";

const LIVE_ID = "0123456789abcdef";
const DEAD_ID = "fedcba9876543210";

interface ErrorBody {
  error: { kind: string; message: string; missingFileIds?: string[] };
}

function pipeline(): AnswerPipeline {
  return new AnswerPipeline({
    retrieval: new StubCorpus(() => ok([hitTck("v1")])),
    texts: standardTexts(),
    versionFacts: factsPort(STANDARD_FACTS),
    ...deterministicOptions(),
  });
}

/** A files store that knows about exactly one live upload. */
function filesStoreWith(ids: readonly string[]): FilesReadStore {
  return {
    async listFiles() {
      return [];
    },
    async showFile() {
      return undefined;
    },
    async existingFileIds(fileIds: readonly string[]) {
      return fileIds.filter((id) => ids.includes(id));
    },
  } as unknown as FilesReadStore;
}

function draft(over: Partial<Draft> = {}): Draft {
  return {
    schema: "collex.draft/v1",
    draftId: "d-lfix-1",
    version: 1,
    kind: "dilekce",
    template: "dava-dilekcesi",
    title: "İhtarname taslağı",
    matterId: null,
    createdAt: "2026-09-02T09:00:00.000Z",
    updatedAt: "2026-09-02T09:00:00.000Z",
    unsupportedCount: 0,
    sections: [],
    evidence: [],
    ...over,
  } as unknown as Draft;
}

// ---------------------------------------------------------------------------
// (b) B-26 — a question asked over a DELETED document
// ---------------------------------------------------------------------------

describe("L-FIX (b) · a deleted fileId is 404 FILE_NOT_FOUND, not ABSTAIN", () => {
  const ask = (app: ReturnType<typeof createApp>, fileIds: string[]) =>
    app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: Q_NORM_CONTENT, filters: { fileIds } }),
    });

  it("refuses BEFORE retrieval and names the missing id", async () => {
    // Before this fix the empty file scope produced an ABSTAIN whose Turkish
    // read as "this document does not support your question" — a statement
    // about the document, when the document was gone.
    const app = createApp({
      answerPipeline: pipeline(),
      answerStore: new InMemoryAnswerStore(),
      filesStore: filesStoreWith([LIVE_ID]),
    });
    const res = await ask(app, [DEAD_ID]);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.kind).toBe("FILE_NOT_FOUND");
    expect(body.error.message).toBe(FILE_NOT_FOUND_MESSAGE_TR);
    expect(body.error.missingFileIds).toEqual([DEAD_ID]);
  });

  it("still answers when every named document exists", async () => {
    const app = createApp({
      answerPipeline: pipeline(),
      answerStore: new InMemoryAnswerStore(),
      filesStore: filesStoreWith([LIVE_ID]),
    });
    const res = await ask(app, [LIVE_ID]);
    expect(res.status).toBe(200);
  });

  it("reports EVERY missing id, not just the first", async () => {
    const app = createApp({
      answerPipeline: pipeline(),
      answerStore: new InMemoryAnswerStore(),
      filesStore: filesStoreWith([LIVE_ID]),
    });
    const res = await ask(app, [LIVE_ID, DEAD_ID, "aaaaaaaaaaaaaaaa"]);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.missingFileIds).toEqual([DEAD_ID, "aaaaaaaaaaaaaaaa"]);
  });

  it("a store that cannot answer the question lets the request through", async () => {
    // The check turns a wrong answer into an honest one. It must never become
    // a new way for a healthy question to fail.
    const throwing = {
      async listFiles() {
        return [];
      },
      async showFile() {
        return undefined;
      },
      async existingFileIds() {
        throw new Error("connection refused");
      },
    } as unknown as FilesReadStore;
    const app = createApp({
      answerPipeline: pipeline(),
      answerStore: new InMemoryAnswerStore(),
      filesStore: throwing,
    });
    const res = await ask(app, [DEAD_ID]);
    expect(res.status).toBe(200);
  });

  it("an app with no files store at all is unaffected", async () => {
    const app = createApp({
      answerPipeline: pipeline(),
      answerStore: new InMemoryAnswerStore(),
    });
    const res = await ask(app, [DEAD_ID]);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// (c) B-26 — DELETE /v1/drafts and /versions/{n} in the in-memory fallback
// ---------------------------------------------------------------------------

describe("L-FIX (c) · the in-memory draft store deletes and reads old versions", () => {
  function appWithDrafts() {
    const store = new InMemoryDraftStore();
    store.put(draft());
    store.put(draft({ version: 2, title: "İhtarname taslağı (2)" }));
    return { app: createApp({ draftStore: store }), store };
  }

  it("DELETE removes every version; the second call is 404", async () => {
    const { app, store } = appWithDrafts();
    const first = await app.request("/v1/drafts/d-lfix-1", { method: "DELETE" });
    expect(first.status).toBe(204);
    expect(store.get("d-lfix-1")).toBeUndefined();
    const second = await app.request("/v1/drafts/d-lfix-1", { method: "DELETE" });
    expect(second.status).toBe(404);
  });

  it("GET /versions/{n} returns an OLDER version's body — no longer 501", async () => {
    const { app } = appWithDrafts();
    const res = await app.request("/v1/drafts/d-lfix-1/versions/1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; title: string };
    expect(body.version).toBe(1);
    expect(body.title).toBe("İhtarname taslağı");
  });

  it("a version that was never written is 404, not an empty document", async () => {
    const { app } = appWithDrafts();
    const res = await app.request("/v1/drafts/d-lfix-1/versions/7");
    expect(res.status).toBe(404);
  });

  it("the store guards its own inputs", async () => {
    const store = new InMemoryDraftStore();
    store.put(draft());
    expect(await store.remove("")).toBe(false);
    expect(await store.remove("x".repeat(201))).toBe(false);
    expect(await store.getVersionBody("d-lfix-1", 0)).toBeUndefined();
    expect(await store.getVersionBody("d-lfix-1", 1.5)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /v1/drafts?q= reaches the store
// ---------------------------------------------------------------------------

describe("L-FIX · GET /v1/drafts?q= is applied, and an unknown parameter is a 400", () => {
  function appWithTitles() {
    const store = new InMemoryDraftStore();
    store.put(draft({ draftId: "d-1", title: "İhtarname — kira" }));
    store.put(draft({ draftId: "d-2", title: "Dava dilekçesi — tahliye" }));
    return createApp({ draftStore: store });
  }

  it("filters on the title", async () => {
    const res = await appWithTitles().request("/v1/drafts?q=tahliye");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drafts: Array<{ draftId: string }> };
    expect(body.drafts.map((d) => d.draftId)).toEqual(["d-2"]);
  });

  it("folds the Turkish dotted I, so 'ihtar' finds 'İhtarname'", async () => {
    const res = await appWithTitles().request("/v1/drafts?q=ihtar");
    const body = (await res.json()) as { drafts: Array<{ draftId: string }> };
    expect(body.drafts.map((d) => d.draftId)).toEqual(["d-1"]);
  });

  it("an unrecognised parameter is refused rather than silently ignored", async () => {
    // A filter that is quietly dropped returns the unfiltered list and looks
    // like an answer — the exact failure mode B-26 exists to end.
    const res = await appWithTitles().request("/v1/drafts?matter=abc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("matter");
  });
});

// ---------------------------------------------------------------------------
// Mounts the lanes could not wire themselves
// ---------------------------------------------------------------------------

describe("L-FIX · every phase-A router answers over the mounted app", () => {
  it("mounts sources, contracts, fees, contacts and the package endpoint", async () => {
    const app = createApp({});
    const paths: Array<[string, RequestInit | undefined, number[]]> = [
      ["/v1/sources/catalog", undefined, [200]],
      ["/v1/fees/tariffs", undefined, [200]],
      ["/v1/contracts/checklists", undefined, [200]],
      ["/v1/contacts", undefined, [200]],
    ];
    for (const [path, init, allowed] of paths) {
      const res = await app.request(path, init);
      expect(allowed, `${path} -> ${res.status}`).toContain(res.status);
    }
  });

  it("POST /v1/citation-audit answers with the audit schema", async () => {
    const app = createApp({});
    const res = await app.request("/v1/citation-audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "6098 sayılı Kanunun 299. maddesi", asOf: "2026-06-01" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schema: string; rows: unknown[] };
    expect(body.schema).toBe("collex.citation-audit/v1");
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("the matters search reports its document half as connected when files are wired", async () => {
    const store = new InMemoryMatterStore();
    const matter = await store.create({ title: "Kira — Şahin" });
    const documents = {
      async listFiles() {
        return [];
      },
      async showFile() {
        return undefined;
      },
      async searchChunks() {
        return [
          {
            fileId: LIVE_ID,
            fileName: "kira.pdf",
            chunkId: "c1",
            ordinal: 0,
            snippet: "depozito iadesi",
            startChar: 0,
            endChar: 15,
          },
        ];
      },
    } as unknown as FilesReadStore;
    const app = createApp({ matterStore: store, filesStore: documents });
    const res = await app.request("/v1/matters/search?q=depozito");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documentsSearched?: boolean };
    // Before the wiring this was permanently false: honest, and half a
    // feature — the lawyer's own PDFs were unreachable from "genel arama".
    expect(body.documentsSearched).toBe(true);
    expect(matter.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// B-30 — POST /v1/matters/{id}/package
// ---------------------------------------------------------------------------

describe("L-FIX · B-30 POST /v1/matters/{id}/package", () => {
  async function matterWithA(kind: "answer" | "draft", refId: string) {
    const store = new InMemoryMatterStore();
    const matter = await store.create({ title: "Kira — Şahin" });
    await store.addItem?.(matter.id, { kind, refId, payload: {} });
    return { store, matter };
  }

  it("is 404 for an unknown matter and never runs the exporter", async () => {
    let ran = false;
    const app = createApp({
      matterStore: new InMemoryMatterStore(),
      draftingExec: async () => {
        ran = true;
        return { code: 0, stderr: "" };
      },
    });
    const res = await app.request("/v1/matters/11111111-2222-4333-8444-555555555555/package", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(ran).toBe(false);
  });

  it("is 422 PACKAGE_EMPTY when the matter holds nothing packable", async () => {
    const store = new InMemoryMatterStore();
    const matter = await store.create({ title: "Boş dosya" });
    const app = createApp({ matterStore: store });
    const res = await app.request(`/v1/matters/${matter.id}/package`, { method: "POST" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.kind).toBe("PACKAGE_EMPTY");
  });

  it("builds a collex.matter-package/v1 plan and streams the ZIP back", async () => {
    const drafts = new InMemoryDraftStore();
    drafts.put(draft({ draftId: "d-pack", version: 3, title: "Dava dilekçesi" }));
    const { store, matter } = await matterWithA("draft", "d-pack");

    let seenArgs: string[] = [];
    let plan: Record<string, unknown> = {};
    const app = createApp({
      matterStore: store,
      draftStore: drafts,
      draftingExec: async ({ args }) => {
        seenArgs = args;
        const planPath = args[args.indexOf("--package") + 1] as string;
        const outPath = args[args.indexOf("--out") + 1] as string;
        const { readFile, writeFile } = await import("node:fs/promises");
        plan = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>;
        await writeFile(outPath, "PK\u0003\u0004 fake zip", "utf8");
        return { code: 0, stderr: "" };
      },
    });

    const res = await app.request(`/v1/matters/${matter.id}/package`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''");

    expect(seenArgs).toContain("--package");
    expect(seenArgs).toContain("dosya-paketi-zip");
    expect(plan["schema"]).toBe("collex.matter-package/v1");
    expect(plan["matterTitle"]).toBe("Kira — Şahin");
    const planned = plan["drafts"] as Array<{ fileName: string }>;
    expect(planned).toHaveLength(1);
    expect(planned[0]?.fileName).toContain("v3");
  });

  it("a refusing packager is 500 EXPORT_REFUSED with a correlationId and no body bytes", async () => {
    const drafts = new InMemoryDraftStore();
    drafts.put(draft({ draftId: "d-pack" }));
    const { store, matter } = await matterWithA("draft", "d-pack");
    const logged: string[] = [];
    const app = createApp({
      matterStore: store,
      draftStore: drafts,
      draftingExec: async () => ({ code: 2, stderr: "sha256 mismatch on kira.pdf" }),
    });
    void logged;
    const res = await app.request(`/v1/matters/${matter.id}/package`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { kind: string; correlationId: string; message: string };
    };
    expect(body.error.kind).toBe("EXPORT_REFUSED");
    expect(body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
    // The child's stderr never reaches the HTTP body (CLAUDE.md invariant).
    expect(JSON.stringify(body)).not.toContain("sha256 mismatch");
  });

  it("records an unreachable record in notes instead of dropping it", async () => {
    const { store, matter } = await matterWithA("answer", "run-gone");
    let plan: Record<string, unknown> = {};
    const drafts = new InMemoryDraftStore();
    drafts.put(draft({ draftId: "d-pack" }));
    await store.addItem?.(matter.id, { kind: "draft", refId: "d-pack", payload: {} });
    const app = createApp({
      matterStore: store,
      draftStore: drafts,
      draftingExec: async ({ args }) => {
        const planPath = args[args.indexOf("--package") + 1] as string;
        const outPath = args[args.indexOf("--out") + 1] as string;
        const { readFile, writeFile } = await import("node:fs/promises");
        plan = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>;
        await writeFile(outPath, "PK", "utf8");
        return { code: 0, stderr: "" };
      },
    });
    const res = await app.request(`/v1/matters/${matter.id}/package`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((plan["notes"] as string[]).join(" ")).toContain("run-gone");
  });
});

// ---------------------------------------------------------------------------
// B-06 — the trigram lane's degradation is VISIBLE
// ---------------------------------------------------------------------------

describe("L-FIX · B-06 a degraded retrieval lane reaches the answer's warnings", () => {
  /**
   * Measured 02.09.2026 on the L-FIX probe database `collex_fix_test`
   * (20 000 chunks, avg search_text 4 903 code points, 39 MB heap + 119 MB
   * TOAST, 23 MB chunks_search_trgm):
   *
   *   `<%` recheck cost is LINEAR in the text scanned —
   *     250 chars 791 ms · 500 1 597 ms · 1 000 3 363 ms · 2 000 6 855 ms ·
   *     4 903 16 746 ms, over the same 20 000 rows
   *   = ~0.17 µs per code point per row, i.e. ~0.84 ms per row at this size.
   *
   * So when the GIN candidate set is not selective the lane costs seconds,
   * and `createDb`'s 15 s `statement_timeout` (src/store/db.ts) cuts it off.
   * What must NOT happen is that the cut-off is silent: the lawyer would read
   * a thinner answer as "the corpus has nothing". This test pins the path
   * from a failed lane to the warning the console draws — L-CONSOLE's
   * integration request 3, which had no server-side test.
   */
  it("a lane that fails is reported, and the answer still comes back", async () => {
    let call = 0;
    const pipeline = new AnswerPipeline({
      retrieval: new StubCorpus(() => {
        call += 1;
        // The first plan item fails the way a statement_timeout does; the
        // rest answer, exactly as the real lanes behave.
        return call === 1
          ? laneError("lane trigram failed: canceling statement due to statement timeout")
          : ok([hitTck("v1")]);
      }),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    });
    const app = createApp({ answerPipeline: pipeline, answerStore: new InMemoryAnswerStore() });
    const res = await app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: Q_NORM_CONTENT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[] };
    const degraded = body.warnings.filter(
      (w) => w.startsWith("RETRIEVAL_ERROR:") || w.startsWith("RETRIEVAL_LANE_DEGRADED:"),
    );
    expect(degraded.length).toBeGreaterThan(0);
    // The driver's prose may name a lane, but never a connection string.
    expect(body.warnings.join(" ")).not.toContain("postgres://");
  });
});

// ---------------------------------------------------------------------------
// B-16 — the court/date filters reach /v1/answer, not only /v1/search
// ---------------------------------------------------------------------------

describe("L-FIX · B-16 answer filters accept chambers / year range / exclusions", () => {
  it("passes the four W14 filters through to retrieval verbatim", async () => {
    // L-SOURCES IR-5: `passesCourtDateFilters` has applied these since phase
    // A and `POST /v1/search` accepted them, but `answerFiltersSchema` was
    // `.strict()` without them — so the console could narrow a SEARCH and
    // not an ANSWER, and the request came back 400 "eksik veya hatalı alanlar".
    const seen: unknown[] = [];
    const app = createApp({
      answerPipeline: new AnswerPipeline({
        retrieval: new StubCorpus((request) => {
          seen.push(request.filters);
          return ok([hitTck("v1")]);
        }),
        texts: standardTexts(),
        versionFacts: factsPort(STANDARD_FACTS),
        ...deterministicOptions(),
      }),
      answerStore: new InMemoryAnswerStore(),
    });
    const filters = {
      courtTypes: ["YARGITAY"],
      chambers: ["3. HD"],
      yearFrom: 2023,
      yearTo: 2025,
      excludeTerms: ["kambiyo"],
    };
    const res = await app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: Q_NORM_CONTENT, filters }),
    });
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject(filters);
  });

  it("still refuses a filter this build does not implement", async () => {
    // The schema stays `.strict()`: a filter that is silently dropped returns
    // an unfiltered answer that looks filtered.
    const app = createApp({
      answerPipeline: pipeline(),
      answerStore: new InMemoryAnswerStore(),
    });
    const res = await app.request("/v1/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: Q_NORM_CONTENT, filters: { judgeName: "X" } }),
    });
    expect(res.status).toBe(400);
  });
});
