/**
 * /v1/ai/* router contract (offline; hono app.request, fake fetch, fake
 * stores): status, consent + configuration gates, analyze-document quote
 * verification, OCR guards + shape, draft-paragraph entailment stripping and
 * the KAYNAKSIZ path, typed upstream failures — and no key in any log line.
 */

import { afterEach, describe, expect, it } from "vitest";

import { AI_ENV, createAiAdapter, resolveAiConfig } from "../../src/ai/config.js";
import { OCR_MAX_BYTES } from "../../src/ai/ocr.js";
import {
  NOTE_AI_KAYNAKLI,
  NOTE_AI_KAYNAKSIZ,
  NOTE_AI_KAYNAKSIZ_DENETLENEMEDI,
  NOTE_AI_KAYNAKSIZ_DUZENLEYICI,
  RATIONALE_JUDGE_UNREADABLE_TR,
  WARNING_AI_PARAGRAPH,
  WARNING_AI_PARAGRAPH_UNCHECKED,
} from "../../src/ai/paragraph.js";
import {
  AI_LOCKED_SECTION_MESSAGE_TR,
  AI_NOT_CONFIGURED_MESSAGE,
  LOCAL_TENANT_ID,
  createAiRouter,
  type AiRouterDeps,
} from "../../src/ai/routes.js";
import type { AiDraftLike, DraftPatch, ReviseFn } from "../../src/ai/types.js";
import { captureConsole, fakeAnthropic, userText, type ReplyFn } from "./fakeAnthropic.js";
import { CHUNK_1_TEXT, KEY, sampleChunks, sampleDraft, syntheticPdf } from "./fixtures.js";

/* ------------------------------ harness ------------------------------ */

interface HarnessOptions {
  configured?: boolean;
  reply?: ReplyFn;
  files?: AiRouterDeps["files"];
  drafts?: AiRouterDeps["drafts"];
  revise?: ReviseFn;
  now?: () => Date;
  analysisTokenBudget?: number;
  ocrBatchSize?: number;
  useDefaultLog?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const config = options.configured === false ? null : resolveAiConfig({ [AI_ENV.apiKey]: KEY });
  const fake = fakeAnthropic(options.reply ?? (() => ({ toolInput: {} })));
  const logs: string[] = [];
  const adapter =
    config === null
      ? undefined
      : createAiAdapter(config, fake.fetchImpl, { retryBaseDelayMs: 0, sleep: async () => {} });
  const app = createAiRouter({
    config,
    ...(adapter !== undefined ? { adapter } : {}),
    ...(options.files !== undefined ? { files: options.files } : {}),
    ...(options.drafts !== undefined ? { drafts: options.drafts } : {}),
    ...(options.revise !== undefined ? { revise: options.revise } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.analysisTokenBudget !== undefined
      ? { analysisTokenBudget: options.analysisTokenBudget }
      : {}),
    ...(options.ocrBatchSize !== undefined ? { ocrBatchSize: options.ocrBatchSize } : {}),
    ...(options.useDefaultLog === true ? {} : { log: (line: string) => logs.push(line) }),
  });
  return { app, calls: fake.calls, logs };
}

function jsonPost(app: ReturnType<typeof createAiRouter>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `consent: null` omits the field (an explicit `undefined` would re-apply the default). */
function pdfForm(bytes: Buffer | Uint8Array, name: string, consent: string | null = "true") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "application/pdf" }), name);
  if (consent !== null) form.append("useCloudAi", consent);
  return form;
}

function filesPort(chunks = sampleChunks()) {
  const seen: { fileIds: readonly string[]; tenantId: string }[] = [];
  return {
    seen,
    files: {
      getChunks: async (fileIds: readonly string[], tenantId: string) => {
        seen.push({ fileIds, tenantId });
        return fileIds.includes("file-1") ? chunks : [];
      },
    },
  };
}

function draftStore(initial: AiDraftLike = sampleDraft()) {
  const store = new Map<string, AiDraftLike>([[initial.draftId, initial]]);
  const warmed: string[] = [];
  const puts: AiDraftLike[] = [];
  return {
    store,
    warmed,
    puts,
    drafts: {
      get: (id: string) => store.get(id),
      put: (draft: AiDraftLike) => {
        puts.push(draft);
        store.set(draft.draftId, draft);
      },
      warm: async (id: string) => {
        warmed.push(id);
      },
    },
  };
}

/** Applies the patch literally; `force` lets a test simulate a stricter reviser. */
function fakeRevise(force: { supported?: boolean } = {}) {
  const calls: { draft: AiDraftLike; patch: DraftPatch; opts: { trustEntailment: boolean } }[] = [];
  const revise: ReviseFn = (draft, patch, opts) => {
    calls.push({ draft, patch, opts });
    const next = structuredClone(draft) as AiDraftLike;
    next.version = (draft.version ?? 1) + 1;
    for (const patched of patch.sections) {
      const section = next.sections.find((s) => s.id === patched.id);
      if (section === undefined) continue;
      section.paragraphs = patched.paragraphs.map((p) => ({
        id: p.id,
        text: p.text,
        evidenceIds: [...p.evidenceIds],
        supported: force.supported ?? p.supported ?? p.evidenceIds.length > 0,
        role: p.role,
        ...(p.note !== undefined ? { note: p.note } : {}),
        ...(p.binding !== undefined ? { binding: p.binding } : {}),
      }));
    }
    next.unsupportedCount = next.sections.reduce(
      (n, s) => n + s.paragraphs.filter((p) => !p.supported).length,
      0,
    );
    return { draft: next, issues: [] };
  };
  return { calls, revise };
}

const paragraphReply =
  (
    scores: Record<string, { score: number; entails: boolean }>,
    evidenceIds = ["ev-1", "ev-2"],
    text = "5237 sayılı Kanun m. 157 uyarınca fiil dolandırıcılık suçunu oluşturur.",
  ): ReplyFn =>
  (body) => {
    const tool = body.tools[0]!.name;
    if (tool === "write_paragraph") return { toolInput: { text, evidenceIds } };
    if (tool === "assess_entailment") {
      const content = String(body.messages[0]!.content);
      const id = Object.keys(scores).find((key) =>
        content.includes(`<untrusted_evidence id="${key}">`),
      );
      const judged = id !== undefined ? scores[id]! : { score: 0, entails: false };
      return { toolInput: { ...judged, rationale: judged.entails ? "uyuyor" : "uymuyor" } };
    }
    return { toolInput: {} };
  };

/* ------------------------------- status ------------------------------ */

describe("GET /v1/ai/status", () => {
  it("configured: model, per-request consent, data leaves machine, canlı sınanmadı", async () => {
    const { app } = harness();
    const response = await app.request("/v1/ai/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["configured"]).toBe(true);
    expect(body["model"]).toBe("claude-sonnet-5");
    expect(body["consent"]).toBe("per-request");
    expect(body["dataLeavesMachine"]).toBe(true);
    expect(body["liveTested"]).toBe(false);
    const notes = body["notes"] as string[];
    expect(notes.some((n) => /canlı sınanmadı/i.test(n))).toBe(true);
    // W15: "bu makineden ÇIKAR" -> "bu bilgisayardan ÇIKAR" (kanonik sözlük).
    // Ölçülen davranış aynı: notlardan biri, verinin bu bilgisayardan ÇIKTIĞINI
    // büyük harfle söylemek zorundadır.
    expect(notes.some((n) => n.includes("bu bilgisayardan ÇIKAR"))).toBe(true);
    expect(notes.some((n) => n.includes("claude-sonnet-5"))).toBe(true);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("unconfigured: configured:false, model null, still per-request", async () => {
    const { app } = harness({ configured: false });
    const body = (await (await app.request("/v1/ai/status")).json()) as Record<string, unknown>;
    expect(body["configured"]).toBe(false);
    expect(body["model"]).toBeNull();
    expect(body["consent"]).toBe("per-request");
    expect((body["notes"] as string[]).some((n) => n.includes("anahtar yok"))).toBe(true);
  });
});

/* ------------------------------- gates ------------------------------- */

describe("consent and configuration gates", () => {
  it("every POST answers 400 AI_CONSENT_REQUIRED without useCloudAi === true", async () => {
    const { app, calls } = harness({ files: filesPort().files });
    const kinds: string[] = [];
    for (const body of [
      { fileId: "file-1" },
      { fileId: "file-1", useCloudAi: "true" },
      { fileId: "file-1", useCloudAi: 1 },
    ]) {
      const response = await jsonPost(app, "/v1/ai/analyze-document", body);
      expect(response.status).toBe(400);
      kinds.push(((await response.json()) as { error: { kind: string } }).error.kind);
    }
    const ocr = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(syntheticPdf(1), "a.pdf", null),
    });
    expect(ocr.status).toBe(400);
    kinds.push(((await ocr.json()) as { error: { kind: string } }).error.kind);
    const paragraph = await jsonPost(app, "/v1/ai/draft-paragraph", {
      draftId: "dft-1",
      sectionId: "hd",
      instructions: "yaz",
      evidenceIds: [],
    });
    expect(paragraph.status).toBe(400);
    kinds.push(((await paragraph.json()) as { error: { kind: string } }).error.kind);
    expect(kinds).toEqual(Array(5).fill("AI_CONSENT_REQUIRED"));
    expect(calls).toHaveLength(0);
  });

  it("answers 503 AI_NOT_CONFIGURED with the exact Turkish message when no key is set", async () => {
    const { app } = harness({ configured: false, files: filesPort().files });
    const expected = { error: { kind: "AI_NOT_CONFIGURED", message: AI_NOT_CONFIGURED_MESSAGE } };
    expect(AI_NOT_CONFIGURED_MESSAGE).toBe(
      "Bulut yapay zekâ kapalı — ANTHROPIC_API_KEY tanımlı değil.",
    );

    const analyze = await jsonPost(app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(analyze.status).toBe(503);
    expect(await analyze.json()).toEqual(expected);

    const ocr = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(syntheticPdf(1), "a.pdf"),
    });
    expect(ocr.status).toBe(503);
    expect(await ocr.json()).toEqual(expected);

    const paragraph = await jsonPost(app, "/v1/ai/draft-paragraph", {
      draftId: "dft-1",
      sectionId: "hd",
      instructions: "yaz",
      evidenceIds: [],
      useCloudAi: true,
    });
    expect(paragraph.status).toBe(503);
    expect(await paragraph.json()).toEqual(expected);
  });

  it("rejects garbage JSON and schema violations with Turkish issues", async () => {
    const { app } = harness({ files: filesPort().files });
    const garbage = await app.request("/v1/ai/analyze-document", { method: "POST", body: "{{{" });
    expect(garbage.status).toBe(400);
    const bad = await jsonPost(app, "/v1/ai/analyze-document", {
      fileId: "",
      useCloudAi: true,
      maskMode: "mask",
      focus: "x",
      ekstra: 1,
    });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as {
      error: { kind: string; issues: { path: string; message: string }[] };
    };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["fileId", "focus", "ekstra"]),
    );
    for (const issue of body.error.issues) expect(issue.message).not.toBe("Required");
  });
});

/* -------------------------- analyze-document ------------------------- */

describe("POST /v1/ai/analyze-document", () => {
  const analysisReply: ReplyFn = () => ({
    toolInput: {
      ozet: "Alacak davası dilekçesi.",
      taraflar: [
        { text: "Davacı: Ayşe Yılmaz", evidence: [{ chunkId: "c1", quote: "DAVACI: Ayşe Yılmaz" }] },
      ],
      talepler: [
        {
          text: "50.000 TL alacak",
          evidence: [{ chunkId: "c1", quote: "50.000 TL alacağın tahsili" }],
        },
      ],
      dayanaklar: [],
      tarihler: [{ text: "05.01.2025", evidence: [{ chunkId: "c2", quote: "05.01.2025" }] }],
      riskler: [
        { text: "Faiz talebi yok", evidence: [{ chunkId: "c1", quote: "faiz talep edilmemiştir" }] },
      ],
      eksikler: [],
      karsiArgumanlar: [],
      maddeler: [{ text: "madde", evidence: [{ chunkId: "c1", quote: "KONU" }] }],
    },
  });

  it("verifies every quote; a fabricated quote yields kaynakli:false and kaynaksizCount 1", async () => {
    const port = filesPort();
    const { app, calls } = harness({ reply: analysisReply, files: port.files });
    const response = await jsonPost(app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["schema"]).toBe("collex.ai.document-analysis/v1");
    expect(body["fileId"]).toBe("file-1");
    expect(body["fileName"]).toBe("dilekce.docx");
    expect(body["focus"]).toBe("genel");
    expect(body["model"]).toBe("claude-sonnet-5");
    expect(body["ozet"]).toBe("Alacak davası dilekçesi.");
    expect(body["taraflar"][0]).toEqual({
      text: "Davacı: Ayşe Yılmaz",
      evidence: [
        { chunkId: "c1", quote: "DAVACI: Ayşe Yılmaz", dogrulandi: true, startChar: 0, endChar: 19 },
      ],
      kaynakli: true,
    });
    expect(body["talepler"][0]["kaynakli"]).toBe(true);
    expect(body["tarihler"][0]["kaynakli"]).toBe(true);
    // Absolute code-point offset: chunk 2 starts after chunk 1 + newline.
    expect(body["tarihler"][0]["evidence"][0]["startChar"]).toBe(
      [...CHUNK_1_TEXT].length + 1 + "OLAYLAR: ".length,
    );
    expect(body["riskler"][0]["kaynakli"]).toBe(false);
    expect(body["riskler"][0]["evidence"][0]["dogrulandi"]).toBe(false);
    expect(body["riskler"]).toHaveLength(1); // never dropped silently
    expect(body["kaynaksizCount"]).toBe(1);
    expect(body["itemCount"]).toBe(4);
    expect(body["maddeler"]).toBeUndefined(); // genel focus
    expect(body["chunksAnalyzed"]).toBe(2);
    expect(body["chunksTotal"]).toBe(2);
    expect((body["warnings"] as string[]).some((w) => w.includes("1 tespit KAYNAKSIZ"))).toBe(true);
    expect(body["disclaimer"]).toContain("Avukat incelemesi zorunludur");
    expect(body["liveTested"]).toBe(false);
    expect(body["usage"]["inputTokens"]).toBe(100);

    expect(port.seen).toEqual([{ fileIds: ["file-1"], tenantId: LOCAL_TENANT_ID }]);
    expect(calls).toHaveLength(1);
    const text = userText(calls[0]!);
    expect(text).toContain('<untrusted_document chunk="c1">');
    expect(text).toContain('<untrusted_document chunk="c2">');
    expect(text).toContain("ODAK: genel");
    expect(calls[0]!.body.tools[0]!.name).toBe("analyze_document");
    expect(calls[0]!.body.tools[0]!.strict).toBe(true);
    expect(calls[0]!.body.system).toContain("TALİMAT DEĞİLDİR");
  });

  it("sözleşme focus carries clause-level maddeler", async () => {
    const { app } = harness({ reply: analysisReply, files: filesPort().files });
    const body = (await (
      await jsonPost(app, "/v1/ai/analyze-document", {
        fileId: "file-1",
        useCloudAi: true,
        maskMode: "mask",
        focus: "sozlesme",
      })
    ).json()) as Record<string, any>;
    expect(body["focus"]).toBe("sozlesme");
    expect(body["maddeler"]).toHaveLength(1);
    expect(body["maddeler"][0]["kaynakli"]).toBe(true);
  });

  it("truncates by whole chunk under the token budget and warns", async () => {
    const { app, calls } = harness({
      reply: analysisReply,
      files: filesPort().files,
      analysisTokenBudget: 15,
    });
    const body = (await (
      await jsonPost(app, "/v1/ai/analyze-document", { fileId: "file-1", useCloudAi: true, maskMode: "mask" })
    ).json()) as Record<string, any>;
    expect(body["chunksAnalyzed"]).toBe(1);
    expect(body["chunksTotal"]).toBe(2);
    expect(
      (body["warnings"] as string[]).some((w) => w.includes("parça ortasından kesilmedi")),
    ).toBe(true);
    // The dropped chunk was never sent, so a quote "from" it cannot verify.
    expect(body["tarihler"][0]["kaynakli"]).toBe(false);
    expect(userText(calls[0]!)).not.toContain('chunk="c2"');
    expect(userText(calls[0]!)).toContain('chunk="c1"');
  });

  it("404 for an unknown file, 503 without a files store or when the store is down — no network", async () => {
    const { app, calls } = harness({ reply: analysisReply, files: filesPort().files });
    const missing = await jsonPost(app, "/v1/ai/analyze-document", {
      fileId: "yok",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(missing.status).toBe(404);

    const noStore = harness({ reply: analysisReply });
    const unavailable = await jsonPost(noStore.app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(unavailable.status).toBe(503);
    expect(((await unavailable.json()) as { error: { kind: string } }).error.kind).toBe(
      "STORE_UNAVAILABLE",
    );

    const down = harness({
      reply: analysisReply,
      files: {
        getChunks: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1:55432");
        },
      },
    });
    const downResponse = await jsonPost(down.app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(downResponse.status).toBe(503);
    expect(
      ((await downResponse.json()) as { error: { message: string } }).error.message,
    ).not.toContain("ECONNREFUSED");
    expect(calls).toHaveLength(0);
    expect(noStore.calls).toHaveLength(0);
    expect(down.calls).toHaveLength(0);
  });

  it("maps upstream failures to typed errors and never logs the key", async () => {
    const captured = captureConsole();
    try {
      const failing = harness({
        reply: () => ({ status: 500 }),
        files: filesPort().files,
        useDefaultLog: true,
      });
      const response = await jsonPost(failing.app, "/v1/ai/analyze-document", {
        fileId: "file-1",
        useCloudAi: true,
        maskMode: "mask",
      });
      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: { kind: string; message: string } };
      expect(body.error.kind).toBe("AI_UPSTREAM_FAILED");
      expect(body.error.message).toContain("HTTP 500");
      expect(failing.calls).toHaveLength(3); // two retries
      expect(captured.lines.some((line) => line.includes("code=HTTP status=500"))).toBe(true);
      for (const line of captured.lines) expect(line).not.toContain(KEY);
    } finally {
      captured.restore();
    }

    const auth = harness({ reply: () => ({ status: 401 }), files: filesPort().files });
    const authResponse = await jsonPost(auth.app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(authResponse.status).toBe(502);
    expect(((await authResponse.json()) as { error: { kind: string } }).error.kind).toBe(
      "AI_AUTH_FAILED",
    );
    expect(auth.logs.join("\n")).not.toContain(KEY);

    const refused = harness({ reply: () => ({ stopReason: "refusal" }), files: filesPort().files });
    const refusedResponse = await jsonPost(refused.app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(refusedResponse.status).toBe(502);
    expect(((await refusedResponse.json()) as { error: { kind: string } }).error.kind).toBe(
      "AI_REFUSED",
    );

    const limited = harness({ reply: () => ({ status: 429 }), files: filesPort().files });
    const limitedResponse = await jsonPost(limited.app, "/v1/ai/analyze-document", {
      fileId: "file-1",
      useCloudAi: true,
      maskMode: "mask",
    });
    expect(limitedResponse.status).toBe(503);
    expect(((await limitedResponse.json()) as { error: { kind: string } }).error.kind).toBe(
      "AI_RATE_LIMITED",
    );
  });
});

/* -------------------------------- ocr -------------------------------- */

describe("POST /v1/ai/ocr", () => {
  const ocrReply: ReplyFn = (body) => {
    const text = (body.messages[0]!.content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
    const range = text.match(/İSTENEN SAYFALAR: (\d+)–(\d+)/u);
    const first = range === null ? 1 : Number(range[1]);
    const last = range === null ? 1 : Number(range[2]);
    const pages = [];
    for (let p = first; p <= last; p += 1) pages.push({ page: p, text: `sayfa ${p} metni` });
    return { toolInput: { pages } };
  };

  it("refuses a non-PDF with 415 before any network call", async () => {
    const { app, calls } = harness({ reply: ocrReply });
    const response = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(Buffer.from("bu bir PDF değil"), "sahte.pdf"),
    });
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe(
      "UNSUPPORTED_TYPE",
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses an oversize file (413) and a >100-page PDF (413) before any network call", async () => {
    const { app, calls } = harness({ reply: ocrReply });
    const big = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(Buffer.alloc(OCR_MAX_BYTES + 1), "buyuk.pdf"),
    });
    expect(big.status).toBe(413);
    expect(
      ((await big.json()) as { error: { kind: string; message: string } }).error.message,
    ).toContain("32 MB");

    const many = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(syntheticPdf(101), "uzun.pdf"),
    });
    expect(many.status).toBe(413);
    const body = (await many.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.message).toContain("101 > 100 sayfa");
    expect(calls).toHaveLength(0);

    const missing = new FormData();
    missing.append("useCloudAi", "true");
    const noFile = await app.request("/v1/ai/ocr", { method: "POST", body: missing });
    expect(noFile.status).toBe(400);
  });

  it("transcribes through the document block and returns the contract shape with provenance", async () => {
    const pdf = syntheticPdf(2);
    const { app, calls } = harness({ reply: ocrReply, now: () => new Date(2026, 8, 2, 9, 0) });
    const response = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(pdf, "tarama.pdf"),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["schema"]).toBe("collex.ai.ocr/v1");
    expect(body["fileName"]).toBe("tarama.pdf");
    expect(body["pageCount"]).toBe(2);
    expect(body["pages"]).toEqual([
      { page: 1, text: "sayfa 1 metni" },
      { page: 2, text: "sayfa 2 metni" },
    ]);
    expect(body["text"]).toBe("sayfa 1 metni\fsayfa 2 metni");
    expect(body["provenanceHeader"]).toBe(
      "AI OCR — kaynak: tarama.pdf — 02.09.2026 — claude-sonnet-5",
    );
    expect(body["warnings"]).toEqual([]);
    expect(body["model"]).toBe("claude-sonnet-5");
    expect(body["requests"]).toBe(1);
    expect(body["upload"]["fileName"]).toBe("tarama.ocr.txt");
    expect((body["upload"]["text"] as string).split("\n")[0]).toBe(body["provenanceHeader"]);
    expect(body["liveTested"]).toBe(false);

    expect(calls).toHaveLength(1);
    const content = calls[0]!.body.messages[0]!.content as Array<Record<string, any>>;
    expect(content[0]!["type"]).toBe("document");
    expect(content[0]!["source"]["media_type"]).toBe("application/pdf");
    expect(content[0]!["source"]["type"]).toBe("base64");
    expect(content[0]!["source"]["data"]).toBe(pdf.toString("base64"));
    expect(content[0]!["cache_control"]).toEqual({ type: "ephemeral" });
    expect(calls[0]!.body.tools[0]!.name).toBe("transcribe_pages");
    expect(calls[0]!.body.tool_choice["name"]).toBe("transcribe_pages");
  });

  it("batches long PDFs into page ranges", async () => {
    const { app, calls } = harness({ reply: ocrReply, ocrBatchSize: 8 });
    const response = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(syntheticPdf(20), "uzun.pdf"),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["pageCount"]).toBe(20);
    expect(body["pages"]).toHaveLength(20);
    expect(body["requests"]).toBe(3);
    expect(calls).toHaveLength(3);
    expect(body["usage"]["inputTokens"]).toBe(300);
  });

  it("surfaces a truncated transcription as a typed 502", async () => {
    const { app } = harness({
      reply: () => ({ stopReason: "max_tokens", toolInput: { pages: [] } }),
    });
    const response = await app.request("/v1/ai/ocr", {
      method: "POST",
      body: pdfForm(syntheticPdf(1), "t.pdf"),
    });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { kind: string } }).error.kind).toBe(
      "AI_OUTPUT_TRUNCATED",
    );
  });
});

/* --------------------------- draft-paragraph ------------------------- */

describe("POST /v1/ai/draft-paragraph", () => {
  const request = (overrides: Record<string, unknown> = {}) => ({
    draftId: "dft-1",
    sectionId: "hd",
    instructions: "Fiilin dolandırıcılık suçunu oluşturduğunu açıkla.",
    evidenceIds: ["ev-1", "ev-2"],
    useCloudAi: true,
    ...overrides,
  });

  it("strips evidence below the entailment threshold, binds the rest, revises with trustEntailment:true", async () => {
    const store = draftStore();
    const reviser = fakeRevise();
    const { app, calls } = harness({
      reply: paragraphReply({
        "ev-1": { score: 0.92, entails: true },
        "ev-2": { score: 0.4, entails: false },
      }),
      drafts: store.drafts,
      revise: reviser.revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;

    expect(body["entailment"]).toEqual([
      { evidenceId: "ev-1", score: 0.92, entails: true, kept: true, rationale: "uyuyor" },
      { evidenceId: "ev-2", score: 0.4, entails: false, kept: false, rationale: "uymuyor" },
    ]);
    expect(body["threshold"]).toBe(0.85);
    expect(body["kaynakli"]).toBe(true);
    expect(body["paragraph"]["evidenceIds"]).toEqual(["ev-1"]);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKLI);
    expect(NOTE_AI_KAYNAKLI).toBe("AI taslak — kaynak bağı entailment ile doğrulandı (≥%85)");
    expect(body["paragraph"]["supported"]).toBe(true);
    expect(body["paragraph"]["role"]).toBe("hukukiDegerlendirme");
    expect(body["paragraph"]["binding"]).toEqual({
      kind: "entailment",
      score: 0.92,
      judge: "claude-sonnet-5",
    });
    expect(body["paragraph"]["id"]).toMatch(/^p-hd-ai-/);
    expect((body["warnings"] as string[]).some((w) => w.includes("ev-2"))).toBe(true);
    expect(body["draft"]["version"]).toBe(2);
    expect(body["draft"]["warnings"]).toContain(WARNING_AI_PARAGRAPH);
    expect(body["model"]).toBe("claude-sonnet-5");
    expect(body["liveTested"]).toBe(false);

    // Reviser contract: full patch, trustEntailment:true, paragraph appended.
    expect(reviser.calls).toHaveLength(1);
    expect(reviser.calls[0]!.opts.trustEntailment).toBe(true);
    const patch = reviser.calls[0]!.patch;
    expect(patch.sections.map((s) => s.id)).toEqual(["olaylar", "hd", "imza"]);
    const hd = patch.sections.find((s) => s.id === "hd")!;
    expect(hd.paragraphs.map((p) => p.id)).toEqual(["p-hd-1", body["paragraph"]["id"]]);
    expect(hd.paragraphs[1]!.binding).toEqual({
      kind: "entailment",
      score: 0.92,
      judge: "claude-sonnet-5",
    });
    expect(hd.paragraphs[0]!.binding).toBe("lexical");
    expect(patch.note).toContain("kaynaklı");

    // Store contract: warm before get, put after revise.
    expect(store.warmed).toEqual(["dft-1"]);
    expect(store.puts).toHaveLength(1);
    expect(store.store.get("dft-1")!.version).toBe(2);

    // Wire: one write_paragraph + one assess per cited evidence, evidence fenced.
    expect(calls.map((c) => c.body.tools[0]!.name)).toEqual([
      "write_paragraph",
      "assess_entailment",
      "assess_entailment",
    ]);
    expect(userText(calls[0]!)).toContain('<untrusted_evidence id="ev-1">');
    expect(userText(calls[0]!)).toContain("TALİMAT: Fiilin dolandırıcılık");
    expect(userText(calls[0]!)).toContain("BÖLÜM: HUKUKÎ DEĞERLENDİRME");
  });

  it("KAYNAKSIZ path: nothing survives the judge -> no citations, supported:false, counted", async () => {
    const store = draftStore();
    const reviser = fakeRevise();
    const { app } = harness({
      reply: paragraphReply({
        "ev-1": { score: 0.3, entails: false },
        "ev-2": { score: 0.84, entails: true },
      }),
      drafts: store.drafts,
      revise: reviser.revise,
    });
    const body = (await (await jsonPost(app, "/v1/ai/draft-paragraph", request())).json()) as Record<
      string,
      any
    >;
    expect(body["kaynakli"]).toBe(false);
    expect(body["paragraph"]["evidenceIds"]).toEqual([]);
    expect(body["paragraph"]["supported"]).toBe(false);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ);
    expect(body["paragraph"]["note"]).toContain("KAYNAKSIZ");
    expect(body["paragraph"]["binding"]).toBeUndefined();
    expect(body["draft"]["unsupportedCount"]).toBe(2); // the existing KAYNAKSIZ + the AI one
    // Every binding was measured: the entailment draft warning stays, no "denetlenemedi" line.
    expect(body["draft"]["warnings"]).toContain(WARNING_AI_PARAGRAPH);
    expect(body["draft"]["warnings"]).not.toContain(WARNING_AI_PARAGRAPH_UNCHECKED);
    expect(reviser.calls[0]!.patch.note).toContain("KAYNAKSIZ");
    expect(body["entailment"].every((row: { kept: boolean }) => !row.kept)).toBe(true);
  });

  it("a paragraph the model did not source is KAYNAKSIZ without any judge call", async () => {
    const store = draftStore();
    const { app, calls } = harness({
      reply: paragraphReply({}, [], "Davacı, davalının vaadine güvenerek ödeme yapmıştır."),
      drafts: store.drafts,
      revise: fakeRevise().revise,
    });
    const body = (await (await jsonPost(app, "/v1/ai/draft-paragraph", request())).json()) as Record<
      string,
      any
    >;
    expect(calls).toHaveLength(1);
    expect(body["kaynakli"]).toBe(false);
    expect(body["entailment"]).toEqual([]);
    expect((body["warnings"] as string[]).some((w) => w.includes("hiçbirine dayanmadı"))).toBe(
      true,
    );
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ);
  });

  it("never overrides a stricter reviser verdict", async () => {
    const store = draftStore();
    const { app } = harness({
      reply: paragraphReply({
        "ev-1": { score: 0.95, entails: true },
        "ev-2": { score: 0.95, entails: true },
      }),
      drafts: store.drafts,
      revise: fakeRevise({ supported: false }).revise,
    });
    const body = (await (await jsonPost(app, "/v1/ai/draft-paragraph", request())).json()) as Record<
      string,
      any
    >;
    // W21: was true — `kaynakli` now carries the reviser's final verdict, so the
    // console never reads a paragraph stored as KAYNAKSIZ as "kaynaklı sayıldı".
    expect(body["kaynakli"]).toBe(false);
    expect(body["paragraph"]["supported"]).toBe(false);
    // W21: was NOTE_AI_KAYNAKSIZ ("hiçbir kanıt entailment eşiğini geçmedi"), untrue
    // here: both bindings passed the judge and the reviser's rules rejected them.
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ_DUZENLEYICI);
    expect(body["paragraph"]["note"]).not.toMatch(/hiçbir kanıt|geçmedi/u);
    expect(body["paragraph"]["note"]).toMatch(/^KAYNAKSIZ — /u);
    // The judge's own verdict is still reported per row.
    expect(body["entailment"].map((row: { kept: boolean }) => row.kept)).toEqual([true, true]);
    expect((body["warnings"] as string[]).some((w) => w.includes("kabul etmedi"))).toBe(true);
    const saved = store.store
      .get("dft-1")!
      .sections.flatMap((s) => s.paragraphs)
      .find((p) => p.id === body["paragraph"]["id"])!;
    expect(saved.supported).toBe(false);
    expect(saved.note).toBe(NOTE_AI_KAYNAKSIZ_DUZENLEYICI);
  });

  it("W21 non-vacuity: a reviser that accepts the judged binding keeps kaynakli:true and the sourced note", async () => {
    const store = draftStore();
    const { app } = harness({
      reply: paragraphReply({ "ev-1": { score: 0.95, entails: true } }, ["ev-1"]),
      drafts: store.drafts,
      revise: fakeRevise().revise,
    });
    const body = (await (
      await jsonPost(app, "/v1/ai/draft-paragraph", request({ evidenceIds: ["ev-1"] }))
    ).json()) as Record<string, any>;
    expect(body["kaynakli"]).toBe(true);
    expect(body["paragraph"]["supported"]).toBe(true);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKLI);
    expect((body["warnings"] as string[]).some((w) => w.includes("kabul etmedi"))).toBe(false);
  });

  it("replaces in place with paragraphId, sends the existing text, sanitizes model markup", async () => {
    const store = draftStore();
    const reviser = fakeRevise();
    const { app, calls } = harness({
      reply: paragraphReply(
        { "ev-1": { score: 0.9, entails: true } },
        ["ev-1"],
        "Yeni metin <script>alert(1)</script> [link](javascript:x) m. 157.",
      ),
      drafts: store.drafts,
      revise: reviser.revise,
    });
    const body = (await (
      await jsonPost(
        app,
        "/v1/ai/draft-paragraph",
        request({ paragraphId: "p-hd-1", evidenceIds: ["ev-1"] }),
      )
    ).json()) as Record<string, any>;
    expect(body["paragraph"]["id"]).toBe("p-hd-1");
    expect(body["paragraph"]["text"]).not.toContain("<");
    expect(body["paragraph"]["text"]).not.toContain("javascript:");
    expect(body["paragraph"]["text"]).toContain("Yeni metin");
    const hd = reviser.calls[0]!.patch.sections.find((s) => s.id === "hd")!;
    expect(hd.paragraphs.map((p) => p.id)).toEqual(["p-hd-1"]);
    expect(userText(calls[0]!)).toContain("YENİDEN YAZILACAK MEVCUT PARAGRAF");

    const inserted = harness({
      reply: paragraphReply({ "ev-1": { score: 0.9, entails: true } }, ["ev-1"]),
      drafts: draftStore().drafts,
      revise: reviser.revise,
    });
    const insertedBody = (await (
      await jsonPost(
        inserted.app,
        "/v1/ai/draft-paragraph",
        request({ insertAfter: "p-hd-1", evidenceIds: ["ev-1"] }),
      )
    ).json()) as Record<string, any>;
    const hd2 = reviser.calls[1]!.patch.sections.find((s) => s.id === "hd")!;
    expect(hd2.paragraphs.map((p) => p.id)).toEqual(["p-hd-1", insertedBody["paragraph"]["id"]]);
    expect(userText(inserted.calls[0]!)).toContain("ÖNCEKİ PARAGRAF");
  });

  it("typed 404/400/503 for missing draft, section, evidence, anchors and dependencies", async () => {
    const store = draftStore();
    const { app, calls } = harness({
      reply: paragraphReply({}),
      drafts: store.drafts,
      revise: fakeRevise().revise,
    });

    expect(
      (await jsonPost(app, "/v1/ai/draft-paragraph", request({ draftId: "dft-yok" }))).status,
    ).toBe(404);
    const section = await jsonPost(app, "/v1/ai/draft-paragraph", request({ sectionId: "yok" }));
    expect(section.status).toBe(400);
    expect(
      ((await section.json()) as { error: { issues: { path: string }[] } }).error.issues[0]!.path,
    ).toBe("sectionId");
    const evidence = await jsonPost(
      app,
      "/v1/ai/draft-paragraph",
      request({ evidenceIds: ["ev-yok"] }),
    );
    expect(evidence.status).toBe(400);
    expect(
      ((await evidence.json()) as { error: { issues: { path: string }[] } }).error.issues[0]!.path,
    ).toBe("evidenceIds");
    expect(
      (await jsonPost(app, "/v1/ai/draft-paragraph", request({ paragraphId: "yok" }))).status,
    ).toBe(400);
    expect(
      (
        await jsonPost(
          app,
          "/v1/ai/draft-paragraph",
          request({ paragraphId: "p-hd-1", insertAfter: "p-hd-1" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await jsonPost(app, "/v1/ai/draft-paragraph", request({ instructions: "" }))).status,
    ).toBe(400);
    expect(calls).toHaveLength(0);
    expect(store.puts).toHaveLength(0);

    const bare = harness({ reply: paragraphReply({}) });
    const unavailable = await jsonPost(bare.app, "/v1/ai/draft-paragraph", request());
    expect(unavailable.status).toBe(503);
    expect(((await unavailable.json()) as { error: { kind: string } }).error.kind).toBe(
      "DRAFTING_UNAVAILABLE",
    );
  });

  /* W21 R2-29: a self-contradicting or unreadable judgement for ONE evidence
     id used to throw out of the judge loop, so the route answered 502 and
     discarded the paid paragraph and every other id's valid judgement. */
  const perIdJudge =
    (judged: Record<string, unknown>, text = "5237 sayılı Kanun m. 157 uyarınca fiil dolandırıcılık suçunu oluşturur."): ReplyFn =>
    (body) => {
      const tool = body.tools[0]!.name;
      if (tool === "write_paragraph") return { toolInput: { text, evidenceIds: Object.keys(judged) } };
      const content = String(body.messages[0]!.content);
      const id = Object.keys(judged).find((key) => content.includes(`<untrusted_evidence id="${key}">`));
      return { toolInput: id !== undefined ? judged[id] : {} };
    };

  it("R2-29: one self-contradicting judgement costs that binding only; the paragraph is saved with the rest", async () => {
    const store = draftStore();
    const reviser = fakeRevise();
    const { app, calls } = harness({
      reply: perIdJudge({
        "ev-1": { entails: true, score: 0.92, rationale: "uyuyor" },
        "ev-2": { entails: false, score: 0.9, rationale: "eminim: desteklemiyor" },
      }),
      drafts: store.drafts,
      revise: reviser.revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(calls.map((c) => c.body.tools[0]!.name)).toEqual([
      "write_paragraph",
      "assess_entailment",
      "assess_entailment",
    ]);
    expect(body["entailment"]).toEqual([
      { evidenceId: "ev-1", score: 0.92, entails: true, kept: true, rationale: "uyuyor" },
      {
        evidenceId: "ev-2",
        score: 0,
        entails: false,
        kept: false,
        rationale: RATIONALE_JUDGE_UNREADABLE_TR,
        checked: false,
      },
    ]);
    expect(RATIONALE_JUDGE_UNREADABLE_TR).toContain("denetlenemedi");
    expect(body["kaynakli"]).toBe(true);
    expect(body["paragraph"]["evidenceIds"]).toEqual(["ev-1"]);
    expect(body["paragraph"]["binding"]).toEqual({ kind: "entailment", score: 0.92, judge: "claude-sonnet-5" });
    const warnings = body["warnings"] as string[];
    expect(warnings.some((w) => w.includes("denetlenemedi") && w.includes("ev-2"))).toBe(true);
    // Not checked is not "below the threshold": no measured-shortfall line for ev-2.
    expect(warnings.some((w) => w.includes("eşiğinin") && w.includes("ev-2"))).toBe(false);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKLI);
    expect(body["draft"]["warnings"]).toContain(WARNING_AI_PARAGRAPH);
    expect(body["draft"]["warnings"]).toContain(WARNING_AI_PARAGRAPH_UNCHECKED);
    expect(store.puts).toHaveLength(1);
    expect(store.store.get("dft-1")!.version).toBe(2);
  });

  it("R2-29: when no judgement is readable (a 0-10 score, a broken shape) the paragraph is KAYNAKSIZ, saved, never sourced", async () => {
    const store = draftStore();
    const reviser = fakeRevise();
    const { app } = harness({
      reply: perIdJudge({
        "ev-1": { entails: true, score: 7, rationale: "10 üzerinden 7" },
        "ev-2": { entails: "evet", score: 0.95, rationale: "" },
      }),
      drafts: store.drafts,
      revise: reviser.revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["kaynakli"]).toBe(false);
    expect(body["paragraph"]["evidenceIds"]).toEqual([]);
    expect(body["paragraph"]["supported"]).toBe(false);
    expect(body["paragraph"]["binding"]).toBeUndefined();
    // Was NOTE_AI_KAYNAKSIZ ("hiçbir kanıt entailment eşiğini geçmedi"): a measured
    // shortfall recorded for bindings the judge never gave a usable answer on.
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ_DENETLENEMEDI);
    expect(body["paragraph"]["note"]).not.toMatch(/eşiğini|geçmedi/);
    expect(
      (body["entailment"] as Array<{ kept: boolean; checked?: boolean }>).map((row) => [row.kept, row.checked]),
    ).toEqual([
      [false, false],
      [false, false],
    ]);
    expect((body["warnings"] as string[]).some((w) => w.startsWith("2 kanıt bağı denetlenemedi"))).toBe(true);
    // The saved draft neither says its bindings were entailment-checked nor keeps the shortfall note.
    expect(body["draft"]["warnings"]).toContain(WARNING_AI_PARAGRAPH_UNCHECKED);
    expect(body["draft"]["warnings"]).not.toContain(WARNING_AI_PARAGRAPH);
    expect(store.puts).toHaveLength(1);
    const saved = store.store
      .get("dft-1")!
      .sections.flatMap((s) => s.paragraphs)
      .find((p) => p.id === body["paragraph"]["id"])!;
    expect(saved.note).toBe(NOTE_AI_KAYNAKSIZ_DENETLENEMEDI);
    expect(saved.supported).toBe(false);
    expect(store.store.get("dft-1")!.warnings).not.toContain(WARNING_AI_PARAGRAPH);
  });

  it("R2-29: one unreadable judgement plus one measured shortfall is still 'denetlenemedi', not 'no evidence passed'", async () => {
    const store = draftStore();
    const { app } = harness({
      reply: perIdJudge({
        "ev-1": { entails: false, score: 0.3, rationale: "uymuyor" },
        "ev-2": { entails: true, score: 1.4, rationale: "" },
      }),
      drafts: store.drafts,
      revise: fakeRevise().revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["kaynakli"]).toBe(false);
    expect(body["entailment"].map((row: { checked?: boolean }) => row.checked)).toEqual([undefined, false]);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ_DENETLENEMEDI);
    const warnings = body["warnings"] as string[];
    expect(warnings.some((w) => w.includes("eşiğinin") && w.includes("ev-1"))).toBe(true);
    expect(warnings.some((w) => w.includes("denetlenemedi") && w.includes("ev-2"))).toBe(true);
    expect(body["draft"]["warnings"]).toContain(WARNING_AI_PARAGRAPH_UNCHECKED);
    expect(body["draft"]["warnings"]).not.toContain(WARNING_AI_PARAGRAPH);
  });

  it("R2-29: a lenient reviser verdict does not bring back the measured-shortfall note", async () => {
    const store = draftStore();
    const { app } = harness({
      reply: perIdJudge({ "ev-1": { entails: false, score: 0.97, rationale: "çelişkili" } }),
      drafts: store.drafts,
      revise: fakeRevise({ supported: true }).revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request({ evidenceIds: ["ev-1"] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["kaynakli"]).toBe(false);
    expect(body["paragraph"]["supported"]).toBe(false);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ_DENETLENEMEDI);
  });

  it("R2-29 non-vacuity: a judge transport failure still fails the request and leaves the draft untouched", async () => {
    const store = draftStore();
    const { app } = harness({
      reply: (body) =>
        body.tools[0]!.name === "write_paragraph"
          ? { toolInput: { text: "Metin m. 157.", evidenceIds: ["ev-1"] } }
          : { status: 503 },
      drafts: store.drafts,
      revise: fakeRevise().revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request({ evidenceIds: ["ev-1"] }));
    expect(response.status).toBe(502);
    expect(store.puts).toHaveLength(0);
  });

  it("an upstream failure leaves the draft untouched", async () => {
    const store = draftStore();
    const { app } = harness({
      reply: () => ({ status: 503 }),
      drafts: store.drafts,
      revise: fakeRevise().revise,
    });
    const response = await jsonPost(app, "/v1/ai/draft-paragraph", request());
    expect(response.status).toBe(502);
    expect(store.puts).toHaveLength(0);
    expect(store.store.get("dft-1")!.version).toBe(1);
  });
});

describe("log hygiene", () => {
  const captured = captureConsole();
  afterEach(() => captured.restore());

  it("the default stderr logger never writes the key", async () => {
    const { app } = harness({
      reply: () => ({ status: 500 }),
      files: filesPort().files,
      useDefaultLog: true,
    });
    await jsonPost(app, "/v1/ai/analyze-document", { fileId: "file-1", useCloudAi: true, maskMode: "mask" });
    expect(captured.lines.length).toBeGreaterThan(0);
    for (const line of captured.lines) expect(line).not.toContain(KEY);
  });
});

describe("POST /v1/ai/draft-paragraph refuses the machine-owned sections (W12-FIX2, P2-17)", () => {
  it("answers 400 for ek-dogrulama and karsi-ictihat without touching the draft or the model", async () => {
    const store = draftStore();
    const reviser = fakeRevise();
    const { app, calls } = harness({ drafts: store.drafts, revise: reviser.revise });
    for (const sectionId of ["ek-dogrulama", "karsi-ictihat"]) {
      const response = await jsonPost(app, "/v1/ai/draft-paragraph", {
        draftId: "dft-1",
        sectionId,
        instructions: "Bu bölüme yaz.",
        evidenceIds: ["ev-1"],
        useCloudAi: true,
      });
      expect(response.status, sectionId).toBe(400);
      const body = (await response.json()) as { error: { kind: string; message: string; issues: { path: string }[] } };
      expect(body.error.kind).toBe("INVALID_REQUEST");
      expect(body.error.message).toBe(AI_LOCKED_SECTION_MESSAGE_TR);
      expect(body.error.issues[0]?.path).toBe("sectionId");
    }
    expect(calls).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
    expect(reviser.calls).toHaveLength(0);
  });
});
