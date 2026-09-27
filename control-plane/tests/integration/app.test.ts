/**
 * Integration wave: ONE hono app with files + research + drafting mounted,
 * driven fully offline through app.request() — a FAKE intake-CLI runner
 * (canned CLI JSON), a fake files read store and the scripted research
 * gateway. No socket, no database, no child process.
 *
 * These tests pin the WIRE CONTRACTS the operator console depends on:
 * contract #1 (files), #2 (research) and #3 (drafting) all served by the
 * same createApp() the real server (scripts/serve.mjs) constructs.
 */

import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";

import { API_VERSION, createApp } from "../../src/api/server.js";
import type { IntakeExec, IntakeExecRequest } from "../../src/files/routes.js";
import type {
  FileDetail,
  FileListEntry,
  FilesReadStore,
} from "../../src/files/store.js";
import type { DraftDocxExecRequest } from "../../src/drafting/routes.js";
import type { Draft, DraftFileChunk } from "../../src/drafting/types.js";
import { DRAFT_REVIEW_BANNER } from "../../src/drafting/types.js";
import { AnswerPipeline } from "../../src/pipeline/answerPipeline.js";
import { InMemoryAnswerStore } from "../../src/api/answerService.js";
import { InMemoryMatterStore } from "../../src/matters/store.js";
import type { MatterStore } from "../../src/matters/types.js";
import type { ResearchRunView } from "../../src/research/routes.js";
import {
  Q_NORM_CONTENT,
  STANDARD_FACTS,
  StubCorpus,
  deterministicOptions,
  factsPort,
  hitTck,
  ok,
  standardTexts,
} from "../pipeline/fakes.js";
import { happyScripts, QUESTION, ScriptedGateway } from "../research/helpers.js";

const DSN = "postgres://postgres@127.0.0.1:55432/collex_fake_test";
const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Canned IntakeResult JSON, field-for-field the intake CLI --json shape. */
function cannedUploadResult(): Record<string, unknown> {
  return {
    fileId: SHA.slice(0, 16),
    name: "dilekce_ornek.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sha256: SHA,
    sizeBytes: 24_211,
    kind: "docx",
    extraction: { chars: 2_143, chunkCount: 6, ocr: false },
    analysis: {
      parties: [{ name: "Ayşe Yılmaz", role: "Davacı" }],
      references: [{ raw: "5237 sayılı Kanun m. 157", legislationNo: "5237", articleNo: "157" }],
      dates: [{ date: "2025-03-10", context: "sözleşme tarihi" }],
      claims: [{ text: "Alacağın tahsili talep edilmiştir." }],
    },
    warnings: [],
  };
}

function cannedCliError(kind: string, message: string): Record<string, unknown> {
  return { error: { kind, message } };
}

/** Fake read store over one in-memory file record. */
function fakeStore(): FilesReadStore & { deleted: string[] } {
  const entry: FileListEntry = {
    fileId: SHA.slice(0, 16),
    name: "dilekce_ornek.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sha256: SHA,
    kind: "docx",
    uploadedAt: "2026-08-27T10:00:00.000Z",
    chars: 2_143,
    chunkCount: 1,
    // W12-API2: page statistics travel on the list row too.
    pages: { pageCount: 2, pagesWithText: 1, emptyPages: [2] },
  };
  const chunkText =
    "Sentetik protokolün 4. maddesi uyarınca taraflar aylık mutabakat toplantısı yapar.";
  const chunk: DraftFileChunk = {
    fileId: entry.fileId,
    fileName: entry.name,
    chunkId: "11111111-1111-1111-1111-111111111111",
    ordinal: 0,
    text: chunkText,
    startChar: 0,
    endChar: [...chunkText].length,
    contentSha256: SHA,
  };
  const detail: FileDetail = {
    ...entry,
    extraction: { chars: entry.chars, chunkCount: 1, ocr: false },
    analysis: cannedUploadResult()["analysis"] as Record<string, unknown>,
    warnings: [],
    chunks: [
      {
        chunkId: chunk.chunkId,
        ordinal: 0,
        preview: chunkText,
        startChar: 0,
        endChar: chunk.endChar,
      },
    ],
  };
  return {
    deleted: [],
    listFiles: async () => [entry],
    showFile: async (fileId: string) => (fileId === entry.fileId ? detail : undefined),
    getChunks: async (fileIds: readonly string[]) =>
      fileIds.includes(entry.fileId) ? [chunk] : [],
  };
}

interface MadeApp {
  app: ReturnType<typeof createApp>;
  execCalls: IntakeExecRequest[];
  draftExecCalls: DraftDocxExecRequest[];
  store: ReturnType<typeof fakeStore>;
  answerStore: InMemoryAnswerStore;
}

function makeIntegrationApp(options: {
  /** Scripted per-call exit/stdout of the fake intake CLI. */
  cli?: (request: IntakeExecRequest) => { code: number; stdout: string };
  withResearchGateway?: boolean;
  docxBytes?: Buffer;
  /** Matter store override (a failing one proves the link-warning path). */
  matterStore?: MatterStore;
} = {}): MadeApp {
  const execCalls: IntakeExecRequest[] = [];
  const draftExecCalls: DraftDocxExecRequest[] = [];
  const store = fakeStore();
  const answerStore = new InMemoryAnswerStore();
  const cli =
    options.cli ??
    ((): { code: number; stdout: string } => ({
      code: 0,
      stdout: JSON.stringify(cannedUploadResult()),
    }));
  const filesExec: IntakeExec = async (request) => {
    execCalls.push(request);
    const scripted = cli(request);
    return { code: scripted.code, stdout: scripted.stdout, stderr: "" };
  };
  const app = createApp({
    answerPipeline: new AnswerPipeline({
      retrieval: new StubCorpus(() => ok([hitTck("v1")])),
      texts: standardTexts(),
      versionFacts: factsPort(STANDARD_FACTS),
      ...deterministicOptions(),
    }),
    answerStore,
    filesDsn: DSN,
    filesStore: store,
    filesExec,
    python: { path: "C:/fake/venv/python.exe", repoRoot: "C:/fake/repo" },
    draftingExec: async (request) => {
      draftExecCalls.push(request);
      const outIndex = request.args.indexOf("--out");
      await writeFile(
        request.args[outIndex + 1] as string,
        options.docxBytes ?? Buffer.from("PK-sahte-docx"),
      );
      return { code: 0, stderr: "" };
    },
    ...(options.withResearchGateway === true
      ? {
          researchGateway: new ScriptedGateway(happyScripts()),
          researchProbe: async () => ({ gateway: "ok" as const, toolCount: 54 }),
        }
      : {}),
    ...(options.matterStore !== undefined ? { matterStore: options.matterStore } : {}),
  });
  return { app, execCalls, draftExecCalls, store, answerStore };
}

/**
 * A matter store that answers every read and the create, but whose
 * `addItem` fails (the local database dropped the connection mid-link):
 * exactly the situation in which a record exists but cannot be filed.
 */
function failingLinkMatterStore(): MatterStore {
  const inner = new InMemoryMatterStore();
  return {
    list: (opts) => inner.list(opts),
    create: (input) => inner.create(input),
    get: (id) => inner.get(id),
    update: (id, patch) => inner.update(id, patch),
    remove: (id) => inner.remove(id),
    listItems: (matterId) => inner.listItems(matterId),
    getItem: (matterId, itemId) => inner.getItem(matterId, itemId),
    addItem: async () => {
      throw Object.assign(new Error("connection terminated 127.0.0.1:55432"), { code: "57P01" });
    },
    updateItem: (matterId, itemId, patch) => inner.updateItem(matterId, itemId, patch),
    removeItem: (matterId, itemId) => inner.removeItem(matterId, itemId),
    listDeadlines: (opts) => inner.listDeadlines(opts),
  };
}

async function pollUntilSettled(app: ReturnType<typeof createApp>, runId: string): Promise<ResearchRunView> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const poll = await app.request(`/v1/research/runs/${runId}`);
    expect(poll.status).toBe(200);
    const view = (await poll.json()) as ResearchRunView;
    if (view.state !== "running") return view;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("run never settled");
}

function uploadForm(name: string, bytes: Buffer | string): FormData {
  const form = new FormData();
  form.append("file", new File([bytes], name), name);
  return form;
}

async function jsonPost(
  app: ReturnType<typeof createApp>,
  url: string,
  body: unknown,
): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Files (/v1/files*) — contract #1
// ---------------------------------------------------------------------------

describe("POST /v1/files (fake intake CLI)", () => {
  it("uploads through the CLI contract and returns the IntakeResult 200 body", async () => {
    const { app, execCalls } = makeIntegrationApp();
    const res = await app.request("/v1/files", {
      method: "POST",
      body: uploadForm("dilekce_ornek.docx", Buffer.from("PK\u0003\u0004fake")),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & {
      extraction: Record<string, unknown>;
      analysis: { parties: Array<{ name: string }> };
    };

    // Contract #1 response shape, field for field.
    expect(body["fileId"]).toBe(SHA.slice(0, 16));
    expect(body["name"]).toBe("dilekce_ornek.docx");
    expect(body["mime"]).toContain("wordprocessingml");
    expect(body["sha256"]).toBe(SHA);
    expect(body["sizeBytes"]).toBe(24_211);
    expect(body["kind"]).toBe("docx");
    expect(body.extraction).toMatchObject({ chars: 2_143, chunkCount: 6, ocr: false });
    expect(body.analysis.parties[0]?.name).toBe("Ayşe Yılmaz");
    expect(body["warnings"]).toEqual([]);

    // The CLI was driven exactly per contract: venv python, repo cwd,
    // -X utf8 -m intake.cli --dsn <dsn> --file <tmp> --json.
    expect(execCalls).toHaveLength(1);
    const call = execCalls[0]!;
    expect(call.pythonPath).toBe("C:/fake/venv/python.exe");
    expect(call.cwd).toBe("C:/fake/repo");
    expect(call.args.slice(0, 4)).toEqual(["-X", "utf8", "-m", "intake.cli"]);
    expect(call.args[call.args.indexOf("--dsn") + 1]).toBe(DSN);
    const filePath = call.args[call.args.indexOf("--file") + 1] as string;
    expect(filePath.endsWith("dilekce_ornek.docx")).toBe(true);
    expect(call.args).toContain("--json");
  });

  it("maps the CLI's UNSUPPORTED_TYPE to a typed 415", async () => {
    const { app } = makeIntegrationApp({
      cli: () => ({
        code: 2,
        stdout: JSON.stringify(
          cannedCliError("UNSUPPORTED_TYPE", "uzantı ile içerik uyuşmuyor"),
        ),
      }),
    });
    const res = await app.request("/v1/files", {
      method: "POST",
      body: uploadForm("resim.png", Buffer.from("PNGdata")),
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("UNSUPPORTED_TYPE");
  });

  it("maps EXTRACTION_FAILED to 422 and rejects a missing file field as 400", async () => {
    const { app } = makeIntegrationApp({
      cli: () => ({
        code: 2,
        stdout: JSON.stringify(cannedCliError("EXTRACTION_FAILED", "çıkarılan metin boş")),
      }),
    });
    const res = await app.request("/v1/files", {
      method: "POST",
      body: uploadForm("taranmis.pdf", Buffer.from("%PDF-1.4 fake")),
    });
    expect(res.status).toBe(422);

    const empty = new FormData();
    const missing = await app.request("/v1/files", { method: "POST", body: empty });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { kind: string } }).error.kind).toBe(
      "INVALID_REQUEST",
    );
  });

  it("pre-checks the 25MB cap without invoking the CLI", async () => {
    const { app, execCalls } = makeIntegrationApp();
    const big = new FormData();
    // A File that CLAIMS a >25MB size without allocating it is not
    // constructible portably, so allocate a sparse-ish buffer once.
    big.append("file", new File([Buffer.alloc(25 * 1024 * 1024 + 1)], "buyuk.txt"));
    const res = await app.request("/v1/files", { method: "POST", body: big });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("boyutu");
    expect(execCalls).toHaveLength(0);
  });
});

describe("GET/DELETE /v1/files (fake store + fake CLI)", () => {
  it("lists files in the {files:[...]} envelope", async () => {
    const { app } = makeIntegrationApp();
    const res = await app.request("/v1/files");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: FileListEntry[] };
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({
      fileId: SHA.slice(0, 16),
      name: "dilekce_ornek.docx",
      kind: "docx",
      chars: 2_143,
    });
  });

  it("W12-API2: list rows carry the page statistics the detail read reports", async () => {
    const { app } = makeIntegrationApp();
    const list = (await (await app.request("/v1/files")).json()) as { files: FileListEntry[] };
    expect(list.files[0]!.pages).toEqual({ pageCount: 2, pagesWithText: 1, emptyPages: [2] });
    const detail = (await (await app.request(`/v1/files/${SHA.slice(0, 16)}`)).json()) as FileDetail;
    expect(detail.pages).toEqual(list.files[0]!.pages);
  });

  it("returns the detail with extraction, analysis and chunk previews", async () => {
    const { app } = makeIntegrationApp();
    const res = await app.request(`/v1/files/${SHA.slice(0, 16)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileDetail;
    expect(body.extraction.ocr).toBe(false);
    expect((body.analysis["parties"] as Array<{ name: string }>)[0]?.name).toBe("Ayşe Yılmaz");
    expect(body.chunks).toHaveLength(1);
    expect(body.chunks[0]?.preview).toContain("Sentetik protokolün");

    const missing = await app.request("/v1/files/yok");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { kind: string } }).error.kind).toBe("NOT_FOUND");
  });

  it("deletes through the CLI (204) and maps NOT_FOUND to 404", async () => {
    const { app, execCalls } = makeIntegrationApp({
      cli: (request) =>
        request.args.includes("--delete") && request.args.includes(SHA.slice(0, 16))
          ? { code: 0, stdout: JSON.stringify({ deleted: SHA.slice(0, 16) }) }
          : { code: 2, stdout: JSON.stringify(cannedCliError("NOT_FOUND", "dosya yok")) },
    });
    const res = await app.request(`/v1/files/${SHA.slice(0, 16)}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(execCalls[0]!.args).toContain("--delete");

    const missing = await app.request("/v1/files/yok", { method: "DELETE" });
    expect(missing.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Research (/v1/research*) — contract #2
// ---------------------------------------------------------------------------

describe("POST /v1/research through the mounted app", () => {
  it("answers the typed 502 when no MCP gateway is configured", async () => {
    const { app } = makeIntegrationApp(); // no researchGateway, no mcp
    const res = await jsonPost(app, "/v1/research", { question: QUESTION });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("runs live research over the scripted gateway and returns the research block", async () => {
    const { app } = makeIntegrationApp({ withResearchGateway: true });
    const res = await jsonPost(app, "/v1/research", { question: QUESTION });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schema: string;
      research: { mode: string; toolCalls: unknown[]; upstream: { healthy: boolean } };
    };
    expect(body.schema).toBe("collex.answer.result/v1");
    expect(body.research.mode).toBe("live");
    expect(body.research.toolCalls.length).toBeGreaterThan(0);
    expect(body.research.upstream.healthy).toBe(true);
  });

  it("reports gateway health through the injected probe", async () => {
    const { app } = makeIntegrationApp({ withResearchGateway: true });
    const res = await app.request("/v1/research/health");
    expect(res.status).toBe(200);
    // `state` is additive (W12-F, contract [H]); the integration wave feeds
    // the launcher's real child state through createApp.
    expect(await res.json()).toEqual({ gateway: "ok", toolCount: 54, state: "ok" });

    const { app: offline } = makeIntegrationApp();
    const down = await offline.request("/v1/research/health");
    expect(down.status).toBe(503);
    const downBody = (await down.json()) as { gateway: string; state: string };
    expect(downBody.gateway).toBe("unreachable");
    expect(downBody.state).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// Drafting (/v1/draft-templates, /v1/drafts*) — contract #3
// ---------------------------------------------------------------------------

const MATTER_ONLY_DRAFT = {
  kind: "dilekce",
  template: "dava-dilekcesi",
  matter: {
    baslik: "İSTANBUL NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE",
    taraflar: [
      { ad: "Ayşe Yılmaz", rol: "Davacı" },
      { ad: "Veli Kaya", rol: "Davalı" },
    ],
    // The matter NAMES the researched provision: under the W12-FIX2
    // relevance gate a criminal provision seeds a hukuk davası dilekçesi
    // only when the lawyer's own text references it.
    olaylar: [
      {
        tarih: "2025-03-10",
        metin: "Sentetik bir satış görüşmesi yapılmıştır; davalının eylemi 5237 sayılı Kanun m. 157 kapsamındadır.",
      },
    ],
    talepler: ["Sentetik alacağın 50.000 TL olarak davalıdan tahsiline"],
  },
};

describe("drafting routes through the mounted app", () => {
  it("lists the 14 templates (8 dilekçe + 6 sözleşme) with fieldGroups", async () => {
    const { app } = makeIntegrationApp();
    const res = await app.request("/v1/draft-templates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      templates: Array<{ id: string; kind: string }>;
      fieldGroups: string[];
    };
    expect(body.templates).toHaveLength(14);
    expect(body.templates.map((t) => t.id)).toContain("dava-dilekcesi");
    // W16: hukukî mütalaa is filed under `dilekce` because it is a drafted
    // legal document with a signature block, not a two-party contract.
    expect(body.templates.filter((t) => t.kind === "dilekce")).toHaveLength(8);
    expect(body.templates.filter((t) => t.kind === "sozlesme")).toHaveLength(6);
    expect(body.fieldGroups.length).toBeGreaterThan(0);
  });

  it("creates a matter-only draft: legal slots are loudly KAYNAKSIZ", async () => {
    const { app } = makeIntegrationApp();
    const res = await jsonPost(app, "/v1/drafts", MATTER_ONLY_DRAFT);
    expect(res.status).toBe(200);
    const draft = (await res.json()) as Draft;
    expect(draft.reviewRequired).toBe(true);
    expect(draft.unsupportedCount).toBeGreaterThan(0);
    expect(draft.warnings[0]).toBe(DRAFT_REVIEW_BANNER);
    const marked = draft.sections
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.supported === false);
    expect(marked.length).toBe(draft.unsupportedCount);
  });

  it("binds evidence.runId to an answer THIS app produced (shared answer store)", async () => {
    const { app } = makeIntegrationApp();
    const answered = await jsonPost(app, "/v1/answer", {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
    });
    expect(answered.status).toBe(200);
    const { runId } = (await answered.json()) as { runId: string };

    const res = await jsonPost(app, "/v1/drafts", {
      ...MATTER_ONLY_DRAFT,
      evidence: { runId },
    });
    expect(res.status).toBe(200);
    const draft = (await res.json()) as Draft;
    expect(draft.evidence.length).toBeGreaterThan(0);
    const evidenceIds = new Set(draft.evidence.map((e) => e.evidenceId));
    const bound = draft.sections
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.evidenceIds.length > 0);
    expect(bound.length).toBeGreaterThan(0);
    for (const paragraph of bound) {
      for (const id of paragraph.evidenceIds) expect(evidenceIds.has(id)).toBe(true);
    }
    // The fixture corpus answer is SENTETİK and the draft says so.
    expect(draft.synthetic).toBe(true);

    // Unknown runId keeps failing loudly.
    const unknown = await jsonPost(app, "/v1/drafts", {
      ...MATTER_ONLY_DRAFT,
      evidence: { runId: "run-yok" },
    });
    expect(unknown.status).toBe(400);
  });

  it("binds evidence.fileIds through the files store (DraftingFilePort)", async () => {
    const { app } = makeIntegrationApp();
    const res = await jsonPost(app, "/v1/drafts", {
      ...MATTER_ONLY_DRAFT,
      evidence: { fileIds: [SHA.slice(0, 16)] },
    });
    expect(res.status).toBe(200);
    const draft = (await res.json()) as Draft;
    expect(draft.evidence.some((e) => e.source === "UPLOAD")).toBe(true);
    const deliller = draft.sections.find((s) => s.id === "deliller");
    // 27.09.2026: the DELİLLER line names the exhibit by its human title (no
    // file extension); the full file name stays in EK — DOĞRULAMA.
    expect(deliller?.paragraphs.some((p) => p.text.startsWith("Ek-1: dilekce_ornek ("))).toBe(true);
  });

  it("exports markdown with the review banner as the FIRST line", async () => {
    const { app } = makeIntegrationApp();
    const created = await jsonPost(app, "/v1/drafts", MATTER_ONLY_DRAFT);
    const draft = (await created.json()) as Draft;
    const res = await app.request(`/v1/drafts/${draft.draftId}/export?format=md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text.split("\n")[0]).toBe(DRAFT_REVIEW_BANNER);
    expect(text).toContain("KAYNAKSIZ");
  });

  it("exports DOCX through the injected runner with the export.cli contract", async () => {
    const { app, draftExecCalls } = makeIntegrationApp();
    const created = await jsonPost(app, "/v1/drafts", MATTER_ONLY_DRAFT);
    const draft = (await created.json()) as Draft;
    const res = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("wordprocessingml");

    expect(draftExecCalls).toHaveLength(1);
    const call = draftExecCalls[0]!;
    // The python/repoRoot deps flow from createApp into the drafting router.
    expect(call.pythonPath).toBe("C:/fake/venv/python.exe");
    expect(call.cwd).toBe("C:/fake/repo");
    expect(call.args).toContain("export.cli");
    expect(call.args[call.args.indexOf("--format") + 1]).toBe("dilekce-docx");
  });
});

// ---------------------------------------------------------------------------
// W12 integration: matters, auto-linking, persistence sinks, settings,
// deadlines, cloud-AI status — all through the ONE mounted app.
// ---------------------------------------------------------------------------

interface MatterPage {
  matter: { id: string; title: string; status: string };
  items: Record<
    "files" | "answers" | "drafts" | "notes" | "events" | "deadlines",
    Array<{ itemId: string; kind: string; refId: string | null; payload: Record<string, unknown> }>
  >;
}

async function createMatter(app: ReturnType<typeof createApp>, title = "Yılmaz / Kira tahliye"): Promise<string> {
  const res = await jsonPost(app, "/v1/matters", { title, client: "Ayşe Yılmaz", opposing: "Veli Kaya" });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function matterPage(app: ReturnType<typeof createApp>, id: string): Promise<MatterPage> {
  const res = await app.request(`/v1/matters/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as MatterPage;
}

const MISSING_MATTER = "00000000-0000-4000-8000-00000000dead";

describe("W12: matters CRUD through the mounted app", () => {
  it("creates, lists, reads, patches and deletes a matter with typed errors", async () => {
    const { app } = makeIntegrationApp();
    const id = await createMatter(app);

    const list = await app.request("/v1/matters");
    expect(list.status).toBe(200);
    const rows = ((await list.json()) as { matters: Array<{ id: string; counts: { answers: number } }> }).matters;
    expect(rows.map((m) => m.id)).toContain(id);
    expect(rows[0]!.counts.answers).toBe(0);

    const page = await matterPage(app, id);
    expect(page.matter.title).toBe("Yılmaz / Kira tahliye");
    expect(page.items.answers).toEqual([]);

    const patched = await app.request(`/v1/matters/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "beklemede", court: "İstanbul 3. Sulh Hukuk" }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { status: string }).status).toBe("beklemede");

    const deadlines = await app.request("/v1/matters/deadlines");
    expect(deadlines.status).toBe(200);
    expect(((await deadlines.json()) as { deadlines: unknown[]; today: string }).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect((await app.request(`/v1/matters/${id}`, { method: "DELETE" })).status).toBe(204);
    const gone = await app.request(`/v1/matters/${id}`);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: { kind: string } }).error.kind).toBe("MATTER_NOT_FOUND");
  });
});

describe("W12: /v1/answer auto-links to a matter", () => {
  it("files the answer as an `answer` item and lists it under the matter", async () => {
    const { app } = makeIntegrationApp();
    const id = await createMatter(app);
    const answered = await jsonPost(app, "/v1/answer", {
      question: Q_NORM_CONTENT,
      asOf: "2025-06-01",
      matterId: id,
    });
    expect(answered.status).toBe(200);
    const body = (await answered.json()) as { runId: string; status: string; warnings: string[] };
    expect(body.warnings.some((w) => w.startsWith("MATTER_LINK_FAILED"))).toBe(false);

    const page = await matterPage(app, id);
    expect(page.items.answers).toHaveLength(1);
    const item = page.items.answers[0]!;
    expect(item.kind).toBe("answer");
    expect(item.refId).toBe(body.runId);
    expect(item.payload["question"]).toBe(Q_NORM_CONTENT);
    expect(item.payload["status"]).toBe(body.status);
    expect(item.payload["mode"]).toBe("local");
    // The matter page merges the live summary in.
    expect(item.payload["evidenceCount"]).toBe(1);

    const listed = await app.request(`/v1/answers?matterId=${id}`);
    expect(listed.status).toBe(200);
    const answers = ((await listed.json()) as { answers: Array<{ runId: string; matterId: string | null; mode: string }> }).answers;
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ runId: body.runId, matterId: id, mode: "local" });
  });

  it("refuses a matterId that does not exist with 404 MATTER_NOT_FOUND before any work", async () => {
    const corpus = new StubCorpus(() => ok([hitTck("v1")]));
    const answerStore = new InMemoryAnswerStore();
    const app = createApp({
      answerPipeline: new AnswerPipeline({
        retrieval: corpus,
        texts: standardTexts(),
        versionFacts: factsPort(STANDARD_FACTS),
        ...deterministicOptions(),
      }),
      answerStore,
    });
    const res = await jsonPost(app, "/v1/answer", { question: Q_NORM_CONTENT, matterId: MISSING_MATTER });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("MATTER_NOT_FOUND");
    expect(corpus.calls).toHaveLength(0);
    expect(answerStore.size).toBe(0);

    // A non-UUID is rejected by the schema (400), never silently accepted.
    const bad = await jsonPost(app, "/v1/answer", { question: Q_NORM_CONTENT, matterId: "dosya-1" });
    expect(bad.status).toBe(400);
  });
});

describe("W12: drafts auto-link and inherit the matter on revision", () => {
  it("POST with matter.matterId files a draft item; PUT bumps its version; the listing filters by matter", async () => {
    const { app } = makeIntegrationApp();
    const id = await createMatter(app);
    const created = await jsonPost(app, "/v1/drafts", {
      ...MATTER_ONLY_DRAFT,
      matter: { ...MATTER_ONLY_DRAFT.matter, matterId: id },
    });
    expect(created.status).toBe(200);
    const draft = (await created.json()) as Draft;
    expect(draft.matterId).toBe(id);
    expect(draft.version).toBe(1);

    let page = await matterPage(app, id);
    expect(page.items.drafts).toHaveLength(1);
    expect(page.items.drafts[0]).toMatchObject({
      kind: "draft",
      refId: draft.draftId,
    });
    expect(page.items.drafts[0]!.payload).toMatchObject({
      title: draft.title,
      template: "dava-dilekcesi",
      version: 1,
    });

    // Revise: resend every section, edit one beyan paragraph.
    const sections = draft.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({
        id: s.id,
        paragraphs: s.paragraphs.map((p) => ({
          id: p.id,
          text: p.id === draft.sections.find((x) => x.id === "aciklamalar")?.paragraphs[0]?.id ? `${p.text} (ek cümle)` : p.text,
          evidenceIds: p.evidenceIds,
          role: p.role,
        })),
      }));
    const revised = await app.request(`/v1/drafts/${draft.draftId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections, note: "test" }),
    });
    expect(revised.status).toBe(200);
    const v2 = (await revised.json()) as Draft & { issues: unknown[] };
    expect(v2.version).toBe(2);
    expect(v2.matterId).toBe(id);
    expect(Array.isArray(v2.issues)).toBe(true);

    page = await matterPage(app, id);
    expect(page.items.drafts).toHaveLength(1); // same item, updated — no duplicate
    expect(page.items.drafts[0]!.payload["version"]).toBe(2);

    const versions = await app.request(`/v1/drafts/${draft.draftId}/versions`);
    // Wire order is ascending regardless of the store wired (contract [P]).
    expect(((await versions.json()) as { versions: Array<{ version: number }> }).versions.map((v) => v.version)).toEqual([1, 2]);

    const listed = await app.request(`/v1/drafts?matterId=${id}`);
    const rows = ((await listed.json()) as { drafts: Array<{ draftId: string; version: number }> }).drafts;
    expect(rows).toEqual([expect.objectContaining({ draftId: draft.draftId, version: 2 })]);
    const other = await app.request(`/v1/drafts?matterId=${MISSING_MATTER}`);
    expect(((await other.json()) as { drafts: unknown[] }).drafts).toEqual([]);
  });

  it("refuses matter.matterId of a missing matter with 404 before composing", async () => {
    const { app } = makeIntegrationApp();
    const res = await jsonPost(app, "/v1/drafts", {
      ...MATTER_ONLY_DRAFT,
      matter: { ...MATTER_ONLY_DRAFT.matter, matterId: MISSING_MATTER },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("MATTER_NOT_FOUND");
    const listed = await app.request("/v1/drafts");
    expect(((await listed.json()) as { drafts: unknown[] }).drafts).toEqual([]);
  });
});

describe("W12: /v1/files auto-links an upload", () => {
  it("multipart matterId files a `file` item with the file name", async () => {
    const { app, execCalls } = makeIntegrationApp();
    const id = await createMatter(app);
    const form = uploadForm("dilekce_ornek.docx", Buffer.from("PK\u0003\u0004fake"));
    form.append("matterId", id);
    const res = await app.request("/v1/files", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileId: string; warnings: string[] };
    expect(body.fileId).toBe(SHA.slice(0, 16));
    expect(body.warnings).toEqual([]);
    expect(execCalls).toHaveLength(1);

    const page = await matterPage(app, id);
    expect(page.items.files).toHaveLength(1);
    expect(page.items.files[0]).toMatchObject({ kind: "file", refId: SHA.slice(0, 16) });
    expect(page.items.files[0]!.payload["fileName"]).toBe("dilekce_ornek.docx");
  });

  it("refuses an unknown matterId with 404 and never runs the intake CLI", async () => {
    const { app, execCalls } = makeIntegrationApp();
    const form = uploadForm("dilekce_ornek.docx", Buffer.from("PK\u0003\u0004fake"));
    form.append("matterId", MISSING_MATTER);
    const res = await app.request("/v1/files", { method: "POST", body: form });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("MATTER_NOT_FOUND");
    expect(execCalls).toHaveLength(0);
  });
});

describe("W12: live research persists into the shared answer store", () => {
  it("a sync run is stored, filed under its matter, draftable and exportable with texts", async () => {
    const { app, answerStore } = makeIntegrationApp({ withResearchGateway: true });
    const id = await createMatter(app);
    const res = await jsonPost(app, "/v1/research", { question: QUESTION, matterId: id });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { runId: string; status: string; warnings: string[] };
    expect(result.warnings.some((w) => w.startsWith("MATTER_LINK_FAILED"))).toBe(false);
    expect(answerStore.get(result.runId)?.mode).toBe("live");

    const stored = await app.request(`/v1/answers/${result.runId}`);
    expect(stored.status).toBe(200);
    expect(((await stored.json()) as { runId: string }).runId).toBe(result.runId);

    const page = await matterPage(app, id);
    expect(page.items.answers).toHaveLength(1);
    expect(page.items.answers[0]).toMatchObject({ refId: result.runId });
    expect(page.items.answers[0]!.payload["mode"]).toBe("live");

    const listed = await app.request("/v1/answers?limit=5");
    const rows = ((await listed.json()) as { answers: Array<{ runId: string; mode: string }> }).answers;
    expect(rows).toEqual([expect.objectContaining({ runId: result.runId, mode: "live" })]);

    // The live run's runId feeds drafting like a local one.
    const drafted = await jsonPost(app, "/v1/drafts", { ...MATTER_ONLY_DRAFT, evidence: { runId: result.runId } });
    expect(drafted.status).toBe(200);
    const draft = (await drafted.json()) as Draft;
    expect(draft.evidence.length).toBeGreaterThan(0);

    // …and the bundle with the fetched canonical texts is downloadable.
    const bundle = await app.request(`/v1/answers/${result.runId}/evidence-bundle?texts=true`);
    expect(bundle.status).toBe(200);
    const body = (await bundle.json()) as { texts: Record<string, string>; evidence: Array<{ documentVersionId: string }> };
    expect(typeof body.texts).toBe("object");
    for (const item of body.evidence) expect(typeof body.texts[item.documentVersionId]).toBe("string");
  });

  it("an async run (/v1/research/start) lands in the store and under the matter when done", async () => {
    const { app } = makeIntegrationApp({ withResearchGateway: true });
    const id = await createMatter(app);
    const started = await jsonPost(app, "/v1/research/start", { question: QUESTION, matterId: id });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };

    let state = "";
    for (let attempt = 0; attempt < 100 && state !== "done" && state !== "failed"; attempt += 1) {
      const poll = await app.request(`/v1/research/runs/${runId}`);
      expect(poll.status).toBe(200);
      state = ((await poll.json()) as { state: string }).state;
      if (state === "running") await new Promise((r) => setTimeout(r, 20));
    }
    expect(state).toBe("done");

    expect((await app.request(`/v1/answers/${runId}`)).status).toBe(200);
    const page = await matterPage(app, id);
    expect(page.items.answers.map((i) => i.refId)).toEqual([runId]);

    const refused = await jsonPost(app, "/v1/research/start", { question: QUESTION, matterId: MISSING_MATTER });
    expect(refused.status).toBe(404);
  });
});

describe("W12-API2: live origin, run-level link warnings and event sources through the mounted app", () => {
  it("a live run marks every passage origin 'live' on the result, the bundle and the stored entry", async () => {
    const { app, answerStore } = makeIntegrationApp({ withResearchGateway: true });
    const res = await jsonPost(app, "/v1/research", { question: QUESTION });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      runId: string;
      evidence: Array<{ origin?: string; currentness: { status: string } }>;
      bundle: { evidence: Array<{ origin?: string }> };
      markdown: string;
    };
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((e) => e.origin === "live")).toBe(true);
    expect(result.bundle.evidence.every((e) => e.origin === "live")).toBe(true);
    // Live text is assessed like corpus text: never the upload exemption.
    expect(result.evidence.every((e) => e.currentness.status !== "NOT_APPLICABLE")).toBe(true);
    expect(result.markdown).toContain("Kaynak türü: canlı resmî kaynak");

    const stored = answerStore.get(result.runId)!;
    expect(stored.mode).toBe("live");
    expect(stored.result.evidence.every((e) => e.origin === "live")).toBe(true);
    expect(stored.bundle.evidence.every((e) => e.origin === "live")).toBe(true);
    const served = (await (await app.request(`/v1/answers/${result.runId}/evidence-bundle`)).json()) as {
      evidence: Array<{ origin?: string }>;
    };
    expect(served.evidence.every((e) => e.origin === "live")).toBe(true);
  });

  it("GET /v1/research/runs/{id} always carries warnings — empty when the matter link succeeded", async () => {
    const { app } = makeIntegrationApp({ withResearchGateway: true });
    const id = await createMatter(app);
    const started = await jsonPost(app, "/v1/research/start", { question: QUESTION, matterId: id });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    const view = await pollUntilSettled(app, runId);
    expect(view.state).toBe("done");
    expect(view.warnings).toEqual([]);
    expect((await matterPage(app, id)).items.answers.map((i) => i.refId)).toEqual([runId]);
  });

  it("a background run whose matter link fails reports MATTER_LINK_FAILED in warnings, before `done`, and is still stored", async () => {
    const { app, answerStore } = makeIntegrationApp({
      withResearchGateway: true,
      matterStore: failingLinkMatterStore(),
    });
    const id = await createMatter(app); // create works; only addItem fails
    const started = await jsonPost(app, "/v1/research/start", { question: QUESTION, matterId: id });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };

    // The FIRST non-running poll already carries the warning: it is recorded
    // before the state flips, so a poller that stops at `done` sees it.
    const view = await pollUntilSettled(app, runId);
    expect(view.state).toBe("done");
    expect(view.result?.runId).toBe(runId);
    expect(view.warnings).toHaveLength(1);
    expect(view.warnings[0]).toMatch(/^MATTER_LINK_FAILED:Kayıt dava dosyasına bağlanamadı/u);
    // Driver text never reaches the client.
    expect(JSON.stringify(view)).not.toContain("57P01");
    expect(JSON.stringify(view)).not.toContain("connection terminated");

    // The answer itself exists and is servable; the matter simply has no item.
    expect(answerStore.get(runId)?.mode).toBe("live");
    expect((await app.request(`/v1/answers/${runId}`)).status).toBe(200);
    expect((await matterPage(app, id)).items.answers).toEqual([]);

    // The synchronous route reports the same failure in its own body (unchanged).
    const sync = await jsonPost(app, "/v1/research", { question: QUESTION, matterId: id });
    expect(sync.status).toBe(200);
    const body = (await sync.json()) as { warnings: string[] };
    expect(body.warnings.filter((w) => w.startsWith("MATTER_LINK_FAILED:"))).toHaveLength(1);
  });

  it("matter events accept source belge:<fileId> as well as belge:<fileId>:<chunkId>", async () => {
    const { app } = makeIntegrationApp();
    const id = await createMatter(app);
    const fileId = SHA.slice(0, 16);
    const two = await jsonPost(app, `/v1/matters/${id}/items`, {
      kind: "event",
      refId: fileId,
      payload: { date: "2025-03-10", title: "Sözleşme tarihi (belge analizi)", source: `belge:${fileId}` },
    });
    expect(two.status).toBe(201);
    expect(((await two.json()) as { payload: Record<string, unknown> }).payload).toEqual({
      date: "2025-03-10",
      title: "Sözleşme tarihi (belge analizi)",
      source: `belge:${fileId}`,
      verified: false,
    });
    const three = await jsonPost(app, `/v1/matters/${id}/items`, {
      kind: "event",
      refId: fileId,
      payload: { date: "2025-03-11", title: "Teslim", source: `belge:${fileId}:11111111-1111-1111-1111-111111111111` },
    });
    expect(three.status).toBe(201);
    const bad = await jsonPost(app, `/v1/matters/${id}/items`, {
      kind: "event",
      payload: { date: "2025-03-12", title: "x", source: `belge:${fileId}:a:b` },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { issues: Array<{ path: string }> } }).error.issues[0]?.path).toBe("payload.source");
    expect((await matterPage(app, id)).items.events).toHaveLength(2);
  });
});

describe("W12: deadlines, cloud-AI status, settings and health through the mounted app", () => {
  it("serves the deadline rules and computes a deadline", async () => {
    const { app } = makeIntegrationApp();
    const rules = await app.request("/v1/deadlines/rules");
    expect(rules.status).toBe(200);
    const body = (await rules.json()) as { rules: Array<{ id: string }>; disclaimer: string };
    // The rule set GROWS (W14 B-11 adds rules and corrects two that stated
    // repealed law). This suite is the mounted-app contract, not the rule
    // inventory: `tests/deadlines/rules.test.ts` owns the exact count.
    expect(body.rules.length).toBeGreaterThanOrEqual(30);
    expect(body.rules.some((rule) => rule.id === "hmk-cevap")).toBe(true);
    expect(body.disclaimer).toContain("Süre hesabı bilgi amaçlıdır");

    const computed = await jsonPost(app, "/v1/deadlines/compute", { ruleId: "hmk-cevap", startDate: "2026-01-05" });
    expect(computed.status).toBe(200);
    const result = (await computed.json()) as { dueDate: string; dueDateTr: string; steps: string[] };
    expect(result.dueDate).toBe("2026-01-19");
    expect(result.dueDateTr).toBe("19.01.2026");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("reports cloud AI as not configured and gates every POST on consent, then configuration", async () => {
    const { app } = makeIntegrationApp();
    const status = await app.request("/v1/ai/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ configured: false, model: null, liveTested: false, provider: "anthropic" });

    const noConsent = await jsonPost(app, "/v1/ai/analyze-document", { fileId: SHA.slice(0, 16) });
    expect(noConsent.status).toBe(400);
    expect(((await noConsent.json()) as { error: { kind: string } }).error.kind).toBe("AI_CONSENT_REQUIRED");

    const consented = await jsonPost(app, "/v1/ai/analyze-document", {
      fileId: SHA.slice(0, 16),
      useCloudAi: true,
      // B-23: a masking choice is mandatory on every cloud call.
      maskMode: "mask",
    });
    expect(consented.status).toBe(503);
    expect(((await consented.json()) as { error: { kind: string } }).error.kind).toBe("AI_NOT_CONFIGURED");
  });

  it("round-trips the lawyer settings (full replace)", async () => {
    const { app } = makeIntegrationApp();
    const initial = await app.request("/v1/settings");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ profile: { ad: "" }, preferences: { theme: "system" } });

    const saved = await app.request("/v1/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { ad: "Av. Ayşe Yılmaz", baro: "İstanbul" }, preferences: { theme: "dark" } }),
    });
    expect(saved.status).toBe(200);
    const again = (await (await app.request("/v1/settings")).json()) as {
      profile: { ad: string; baro: string; sicilNo: string };
      preferences: { theme: string; showDemoPresets: boolean };
    };
    expect(again.profile).toMatchObject({ ad: "Av. Ayşe Yılmaz", baro: "İstanbul", sicilNo: "" });
    expect(again.preferences).toMatchObject({ theme: "dark", showDemoPresets: true });
  });

  it("composes /v1/health: db off without sql, mcp from the gateway, ai off, counts and version", async () => {
    const { app } = makeIntegrationApp({ withResearchGateway: true });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "ok",
      registeredToolCount: 54,
      db: "off",
      dbName: null,
      migrations: null,
      mcp: "ok",
      ai: { configured: false, model: null, liveTested: false },
      demoCorpus: false,
      corpus: null,
      templates: 14,
    });
    // B-34: the build label comes from the repo-root VERSION file now.
    expect(body["version"]).toBe(API_VERSION);
    expect(typeof body["deadlineRules"]).toBe("number");
    // B-05 / B-03 additive fields.
    expect(body).toHaveProperty("rls");
    expect(body).toHaveProperty("backup");

    const { app: offline } = makeIntegrationApp();
    expect(((await (await offline.request("/v1/health")).json()) as { mcp: string }).mcp).toBe("off");

    // The launcher's declared child state wins over the derived one.
    const starting = createApp({ mcpState: () => "starting", dbName: "collex_demo" });
    const declared = (await (await starting.request("/v1/health")).json()) as { mcp: string; demoCorpus: boolean; dbName: string };
    expect(declared.mcp).toBe("starting");
    expect(declared.demoCorpus).toBe(true);
    expect(declared.dbName).toBe("collex_demo");
    const research = await starting.request("/v1/research/health");
    expect(research.status).toBe(503);
    expect(((await research.json()) as { state: string }).state).toBe("starting");
  });
});
