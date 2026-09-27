/**
 * POST /v1/deadlines/from-notice — the HTTP end of "Tebligattan süreye",
 * and the confirm path: the proposal's ready `matterItem` filed twice through
 * the EXISTING `POST /v1/matters/{id}/items:batch` is stored once.
 */

import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/server.js";
import { createNoticeDeadlineRouter, type NoticeFilePort } from "../../src/deadlines/noticeRoutes.js";
import { DEADLINE_DISCLAIMER } from "../../src/deadlines/rules.js";
import type { NoticeReading } from "../../src/deadlines/serviceNotice.js";
import type { DraftFileChunk } from "../../src/drafting/types.js";
import type { FilesReadStore } from "../../src/files/store.js";
import { createMattersRouter } from "../../src/matters/routes.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import { GEREKCELI_KARAR, PTT_MAZBATA, UETS_RECEIPT, UETS_RECEIPT_CONFLICTING } from "./noticeSamples.js";

const FILE_ID = "0123456789abcdef";

function chunksOf(text: string, fileId = FILE_ID): DraftFileChunk[] {
  // Two chunks with a one-character gap (a line break the chunker dropped).
  const cps = Array.from(text);
  const cut = cps.indexOf("\n", Math.floor(cps.length / 2));
  return [
    { fileId, fileName: "uets-alindi.pdf", chunkId: "c0", ordinal: 0, text: cps.slice(0, cut).join(""), startChar: 0, endChar: cut, contentSha256: "x" },
    { fileId, fileName: "uets-alindi.pdf", chunkId: "c1", ordinal: 1, text: cps.slice(cut + 1).join(""), startChar: cut + 1, endChar: cps.length, contentSha256: "x" },
  ];
}

function filePort(
  files: Record<string, DraftFileChunk[]>,
  opts: { throws?: boolean; existing?: string[] } = {},
): NoticeFilePort & { calls: number } {
  const port = {
    calls: 0,
    async getChunks(ids: readonly string[]): Promise<DraftFileChunk[]> {
      port.calls += 1;
      if (opts.throws === true) throw new Error("connect ECONNREFUSED 127.0.0.1:55432");
      return ids.flatMap((id) => files[id] ?? []);
    },
    async existingFileIds(ids: readonly string[]): Promise<string[]> {
      return ids.filter((id) => (opts.existing ?? Object.keys(files)).includes(id));
    },
  };
  return port;
}

async function post(app: { request: (url: string, init: RequestInit) => Response | Promise<Response> }, body: unknown) {
  const res = await app.request("/v1/deadlines/from-notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text === "" ? undefined : JSON.parse(text)) as Record<string, unknown> };
}

type ErrorBody = { error: { kind: string; message: string; issues?: Array<{ path: string; message: string }> } };

describe("POST /v1/deadlines/from-notice — pasted text", () => {
  it("answers 200 with the reading, the verbatim disclaimer and a ready matter item", async () => {
    const app = createNoticeDeadlineRouter();
    const res = await post(app, { text: UETS_RECEIPT });
    expect(res.status).toBe(200);
    const r = res.body as unknown as NoticeReading;
    expect(r.text.source).toBe("text");
    expect(r.dateStatus).toBe("OKUNDU");
    expect(r.tebligDate).toBe("2026-11-01");
    expect(r.disclaimer).toBe(DEADLINE_DISCLAIMER);
    expect(r.proposals[0]!.computation!.disclaimer).toBe(DEADLINE_DISCLAIMER);
    expect(r.proposals[0]!.matterItem!.kind).toBe("deadline");
  });

  it("takes the lawyer's choice: candidateId, a typed tebligDate, a ruleId", async () => {
    const app = createNoticeDeadlineRouter();
    const chosen = await post(app, { text: UETS_RECEIPT_CONFLICTING, candidateId: "t2" });
    expect(chosen.status).toBe(200);
    expect((chosen.body as unknown as NoticeReading).tebligDate).toBe("2026-10-30");
    const typed = await post(app, { text: GEREKCELI_KARAR, tebligDate: "2026-06-15", ruleId: "hmk-istinaf" });
    expect(typed.status).toBe(200);
    const r = typed.body as unknown as NoticeReading;
    expect(r.dateStatus).toBe("AVUKAT_GIRDI");
    expect(r.documentStatus).toBe("AVUKAT_SECTI");
    expect(r.proposals[0]!.computation!.dueDate).toBe("2026-06-29");
  });

  it("400 with a named field for: neither input, both inputs, an unknown field, a bad date, candidate + date", async () => {
    const app = createNoticeDeadlineRouter();
    const cases: Array<[unknown, string]> = [
      [{}, "fileId"],
      [{ text: "x", fileId: FILE_ID }, "text"],
      [{ text: PTT_MAZBATA, fazla: 1 }, "fazla"],
      [{ text: PTT_MAZBATA, tebligDate: "14.10.2026" }, "tebligDate"],
      [{ text: PTT_MAZBATA, candidateId: "t1", tebligDate: "2026-10-14" }, "tebligDate"],
      [{ text: "   " }, "text"],
      [{ text: PTT_MAZBATA, candidateId: "bir" }, "candidateId"],
    ];
    for (const [body, path] of cases) {
      const res = await post(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const err = (res.body as unknown as ErrorBody).error;
      expect(err.kind).toBe("INVALID_REQUEST");
      expect(err.issues!.map((i) => i.path)).toContain(path);
      expect(err.issues!.every((i) => i.path !== "")).toBe(true);
    }
    const notJson = await post(app, "{");
    expect(notJson.status).toBe(400);
  });

  it("400 for a candidate that the reading does not have, 400 RULE_NOT_COMPUTABLE for a note-only rule", async () => {
    const app = createNoticeDeadlineRouter();
    const missing = await post(app, { text: PTT_MAZBATA, candidateId: "t7" });
    expect(missing.status).toBe(400);
    expect((missing.body as unknown as ErrorBody).error.issues![0]!.path).toBe("candidateId");
    const noteOnly = await post(app, { text: PTT_MAZBATA, ruleId: "hmk-islah" });
    expect(noteOnly.status).toBe(400);
    expect((noteOnly.body as unknown as ErrorBody).error.kind).toBe("RULE_NOT_COMPUTABLE");
    const unknown = await post(app, { text: PTT_MAZBATA, ruleId: "uydurma" });
    expect((unknown.body as unknown as ErrorBody).error.issues![0]!.path).toBe("ruleId");
  });
});

describe("POST /v1/deadlines/from-notice — an uploaded document", () => {
  it("reads the upload's chunks at their own offsets", async () => {
    const port = filePort({ [FILE_ID]: chunksOf(UETS_RECEIPT) });
    const app = createNoticeDeadlineRouter({ files: port });
    const res = await post(app, { fileId: FILE_ID });
    expect(res.status).toBe(200);
    const r = res.body as unknown as NoticeReading;
    expect(r.text).toMatchObject({ source: "file", fileId: FILE_ID, fileName: "uets-alindi.pdf", gapCodePoints: 1 });
    const e = r.dateCandidates[0]!.evidence[0]!;
    expect(Array.from(UETS_RECEIPT).slice(e.start, e.end).join("")).toBe(e.quote);
    expect(r.proposals[0]!.matterItem!.payload.teblig.fileId).toBe(FILE_ID);
  });

  it("404 for a malformed id WITHOUT touching the store, and for an id that does not exist", async () => {
    const port = filePort({});
    const app = createNoticeDeadlineRouter({ files: port });
    const bad = await post(app, { fileId: "../../etc/passwd" });
    expect(bad.status).toBe(404);
    expect((bad.body as unknown as ErrorBody).error.kind).toBe("FILE_NOT_FOUND");
    expect(port.calls).toBe(0);
    const absent = await post(app, { fileId: "ffffffffffffffff" });
    expect(absent.status).toBe(404);
    expect(port.calls).toBe(1);
  });

  it("422 NOTICE_TEXT_EMPTY for an upload with no readable text (a scan that was not turned into text)", async () => {
    const app = createNoticeDeadlineRouter({ files: filePort({}, { existing: [FILE_ID] }) });
    const res = await post(app, { fileId: FILE_ID });
    expect(res.status).toBe(422);
    const err = (res.body as unknown as ErrorBody).error;
    expect(err.kind).toBe("NOTICE_TEXT_EMPTY");
    expect(err.message).toContain("elle girin");
  });

  it("503 STORE_UNAVAILABLE with no store, and when the store throws — the driver text never reaches the body", async () => {
    const none = await post(createNoticeDeadlineRouter(), { fileId: FILE_ID });
    expect(none.status).toBe(503);
    expect((none.body as unknown as ErrorBody).error.kind).toBe("STORE_UNAVAILABLE");
    const down = await post(createNoticeDeadlineRouter({ files: filePort({}, { throws: true }) }), { fileId: FILE_ID });
    expect(down.status).toBe(503);
    expect(JSON.stringify(down.body)).not.toContain("ECONNREFUSED");
  });
});

describe("the app mounts the route with the shared files store", () => {
  it("createApp answers /v1/deadlines/from-notice for text and for an upload", async () => {
    const chunks = chunksOf(PTT_MAZBATA);
    const filesStore = {
      listFiles: async () => [],
      showFile: async () => undefined,
      getChunks: async (ids: readonly string[]) => (ids.includes(FILE_ID) ? chunks : []),
    } as unknown as FilesReadStore;
    const app = createApp({ filesStore });
    const text = await post(app, { text: PTT_MAZBATA });
    expect(text.status).toBe(200);
    const file = await post(app, { fileId: FILE_ID });
    expect(file.status).toBe(200);
    expect((file.body as unknown as NoticeReading).tebligDate).toBe("2026-10-14");
  });
});

describe("confirm path — nothing is written by the reading; a second confirm is not filed twice", () => {
  it("files the proposal's matterItem once through items:batch and skips the duplicate", async () => {
    const reading = (await post(createNoticeDeadlineRouter(), { text: UETS_RECEIPT })).body as unknown as NoticeReading;
    const item = reading.proposals[0]!.matterItem!;

    let t = Date.parse("2026-11-02T09:00:00.000Z");
    const store = new InMemoryMatterStore(() => new Date((t += 1000)));
    const matters = createMattersRouter({ store });
    const created = await matters.request("/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Karaca / Deniz Lojistik" }),
    });
    const matterId = ((await created.json()) as { id: string }).id;
    // Reading the notice wrote nothing.
    expect(await store.listItems(matterId)).toHaveLength(0);

    const confirm = async () => {
      const res = await matters.request(`/v1/matters/${matterId}/items:batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [item] }),
      });
      return { status: res.status, body: (await res.json()) as { createdCount: number; skipped: Array<{ reason: string }> } };
    };
    const first = await confirm();
    expect(first.status).toBe(201);
    expect(first.body.createdCount).toBe(1);
    const second = await confirm();
    expect(second.status).toBe(201);
    expect(second.body.createdCount).toBe(0);
    expect(second.body.skipped.map((s) => s.reason)).toEqual(["DUPLICATE"]);

    const items = await store.listItems(matterId);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("deadline");
    expect(items[0]!.payload["dueDate"]).toBe("2026-11-16");
    expect(items[0]!.payload["source"]).toBe("hesap");
    expect((items[0]!.payload["teblig"] as { quote: string }).quote).toBe("Muhataba Ulaştırıldığı Tarih : 27.10.2026");

    // A re-read (e.g. after the console reloads) yields the same item → still one.
    const again = (await post(createNoticeDeadlineRouter(), { text: UETS_RECEIPT })).body as unknown as NoticeReading;
    expect(again.proposals[0]!.matterItem).toEqual(item);
    expect((await confirm()).body.createdCount).toBe(0);
  });
});
