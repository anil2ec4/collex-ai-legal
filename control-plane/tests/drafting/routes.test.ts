/**
 * Drafting router contract (offline; hono app.request, no sockets):
 * create/get/list/versions/revise/templates/export, typed 400s, the
 * fake-exec DOCX/UDF contract and evidence resolution through the injected
 * answer store / file port.
 */

import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";

import {
  asciiSafe,
  contentDisposition,
  createDraftingRouter,
  exportFailureDetail,
  exportFileName,
  EXPORT_TIMEOUT_MS,
  UDF_EXPERIMENTAL_NOTE,
  type DraftDocxExecRequest,
} from "../../src/drafting/routes.js";
import { InMemoryDraftStore, type DraftStore, type DraftSummary } from "../../src/drafting/store.js";
import { DRAFT_PERSIST_FAILED_MESSAGE_TR } from "../../src/store/persistNotice.js";
import {
  CONFLICT_POINTER_SENTENCE,
  DRAFT_REVIEW_BANNER,
  LOCAL_TENANT_ID,
} from "../../src/drafting/types.js";
import type { Draft, StoredAnswerLike } from "../../src/drafting/types.js";
import { CHUNK_TEXT, conflictedAnswer, davaRequest, uploadChunk } from "./fixtures.js";

type App = ReturnType<typeof createDraftingRouter>;

function jsonPost(app: App, body: unknown, path = "/v1/drafts") {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonPut(app: App, path: string, body: unknown) {
  return app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createDraft(app: App, body: unknown = davaRequest()): Promise<Draft> {
  const response = await jsonPost(app, body);
  expect(response.status).toBe(200);
  return (await response.json()) as Draft;
}

/** A stored answer with only the SUPPORTED claim (for revise/versions tests). */
function supportedAnswer(): StoredAnswerLike {
  const answer = conflictedAnswer();
  return { result: { ...answer.result, claims: [answer.result.claims[0]!] } };
}

describe("GET /v1/draft-templates", () => {
  it("lists the fourteen templates with their required fields and field groups", async () => {
    const app = createDraftingRouter();
    const response = await app.request("/v1/draft-templates");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      templates: { id: string; kind: string; requiredFields: string[] }[];
      fieldGroups: string[];
    };
    expect(body.templates).toHaveLength(14);
    expect(body.templates.map((t) => t.id)).toContain("kira-sozlesmesi");
    expect(body.templates.map((t) => t.id)).toContain("vekalet-ucret-sozlesmesi");
    expect(body.fieldGroups).toContain("Mahkeme ve dosya");
    for (const template of body.templates) {
      expect(template.requiredFields.length).toBeGreaterThan(0);
    }
  });

  it("carries typed, grouped, human-labeled fields for form builders (contract B + W12)", async () => {
    const app = createDraftingRouter();
    const response = await app.request("/v1/draft-templates");
    const body = (await response.json()) as {
      templates: {
        id: string;
        requiredFields: string[];
        fields: { path: string; label: string; required: boolean; kind?: string; group?: string; help?: string }[];
      }[];
    };
    for (const template of body.templates) {
      expect(template.fields.length).toBeGreaterThan(0);
      for (const required of template.requiredFields) {
        const field = template.fields.find((f) => f.path === `matter.${required}`);
        expect(field, `${template.id}: ${required}`).toBeDefined();
        expect(field!.required).toBe(true);
        expect(field!.label).not.toContain("ekBilgiler");
      }
      for (const field of template.fields) expect(field.group).toBeDefined();
    }
    const cevap = body.templates.find((t) => t.id === "cevap-dilekcesi")!;
    const usul = cevap.fields.find((f) => f.path === "matter.ekBilgiler.usulItirazlari")!;
    expect(usul.kind).toBe("list");
    expect(usul.help).toContain("HMK m.116");
  });
});

describe("POST /v1/drafts", () => {
  it("answers typed 400s for garbage, schema violations and unknown templates", async () => {
    const app = createDraftingRouter();

    const notJson = await app.request("/v1/drafts", { method: "POST", body: "{{{" });
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as { error: { kind: string } }).error.kind).toBe(
      "INVALID_REQUEST",
    );

    const badShape = await jsonPost(app, { kind: "dilekce" });
    expect(badShape.status).toBe(400);

    const unknownTemplate = await jsonPost(app, davaRequest({ template: "yok" }));
    expect(unknownTemplate.status).toBe(400);
    const body = (await unknownTemplate.json()) as {
      error: { kind: string; issues: { path: string }[] };
    };
    expect(body.error.kind).toBe("INVALID_REQUEST");
    expect(body.error.issues[0]?.path).toBe("template");
  });

  it("enforces template requiredFields as a 400 with dotted paths", async () => {
    const app = createDraftingRouter();
    const response = await jsonPost(app, {
      kind: "dilekce",
      template: "istinaf-basvuru",
      matter: davaRequest().matter,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: { path: string }[] } };
    expect(body.error.issues.map((i) => i.path)).toContain("matter.ekBilgiler.karar");
  });

  it("400 issues carry human labels and Turkish messages (contract C)", async () => {
    const app = createDraftingRouter();

    const kunye = await jsonPost(app, {
      kind: "dilekce",
      template: "istinaf-basvuru",
      matter: davaRequest().matter,
    });
    const kunyeBody = (await kunye.json()) as {
      error: { message: string; issues: { path: string; label?: string; message: string }[] };
    };
    expect(kunyeBody.error.message).not.toMatch(/[a-z]+ request/);
    const kararIssue = kunyeBody.error.issues.find((i) => i.path === "matter.ekBilgiler.karar");
    expect(kararIssue?.label).toContain("İstinafa konu karar");
    expect(kararIssue?.message).toContain("zorunlu");

    const eksik = await jsonPost(app, {
      kind: "dilekce",
      template: "dava-dilekcesi",
      matter: { taraflar: [{ ad: "A", rol: "Davacı" }], talepler: ["x"] },
    });
    expect(eksik.status).toBe(400);
    const eksikBody = (await eksik.json()) as {
      error: { message: string; issues: { path: string; label?: string; message: string }[] };
    };
    expect(eksikBody.error.message).toContain("doğrulanamadı");
    const olayIssue = eksikBody.error.issues.find((i) => i.path === "matter.olaylar");
    expect(olayIssue).toBeDefined();
    expect(olayIssue!.label).toContain("Olaylar");
    expect(olayIssue!.message).not.toBe("Required");

    // HMK m.119 identity numbers are validated with Turkish messages.
    const tckn = await jsonPost(app, {
      ...davaRequest(),
      matter: { ...davaRequest().matter, taraflar: [{ ad: "A", rol: "Davacı", tckn: "12" }] },
    });
    expect(tckn.status).toBe(400);
    const tcknBody = (await tckn.json()) as { error: { issues: { path: string; message: string }[] } };
    expect(tcknBody.error.issues[0]?.path).toBe("matter.taraflar.0.tckn");
    expect(tcknBody.error.issues[0]?.message).toContain("11 rakam");
  });

  it("creates, stores and returns the draft; GET round-trips it", async () => {
    const app = createDraftingRouter();
    const draft = await createDraft(app);
    expect(draft.draftId).toMatch(/^dft-/);
    expect(draft.version).toBe(1);
    expect(draft.reviewRequired).toBe(true);
    expect(draft.unsupportedCount).toBe(2);
    expect(draft.warnings[0]).toBe(DRAFT_REVIEW_BANNER);

    const fetched = await app.request(`/v1/drafts/${draft.draftId}`);
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as Draft).draftId).toBe(draft.draftId);

    const missing = await app.request("/v1/drafts/dft-yok");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { kind: string } }).error.kind).toBe("NOT_FOUND");
  });

  it("accepts console line-form inputs: parties, events, requests and ekBilgiler lists as strings", async () => {
    const app = createDraftingRouter();
    const draft = await createDraft(app, {
      kind: "dilekce",
      template: "cevap-dilekcesi",
      matter: {
        taraflar: "Davalı : Veli Kaya\nDavacı : Ayşe Yılmaz",
        olaylar: "05.01.2025 — Sentetik olay bir\nSentetik olay iki",
        talepler: "Davanın reddine\nYargılama giderlerinin davacıya yükletilmesine",
        ekBilgiler: {
          usulItirazlari: "Yetki itirazı\nGörev itirazı\nDerdestlik itirazı",
        },
      },
    });
    const usul = draft.sections.find((s) => s.id === "usul")!.paragraphs.filter((p) => p.role === "liste");
    expect(usul.map((p) => p.text)).toEqual(["1. Yetki itirazı", "2. Görev itirazı", "3. Derdestlik itirazı"]);
    const taraflar = draft.sections.find((s) => s.id === "taraflar")!.paragraphs.map((p) => p.text);
    expect(taraflar).toEqual(["DAVALI : Veli Kaya", "DAVACI : Ayşe Yılmaz"]);
    const esas = draft.sections.find((s) => s.id === "esas")!.paragraphs;
    expect(esas[0]?.text).toBe("1. (05.01.2025) Sentetik olay bir");
    expect(esas[1]?.text).toBe("2. Sentetik olay iki");
    const sonuc = draft.sections.find((s) => s.id === "sonuc")!.paragraphs.map((p) => p.text);
    expect(sonuc).toContain("2. Yargılama giderlerinin davacıya yükletilmesine");
  });

  it("stores matter.matterId and lists drafts per matter", async () => {
    const app = createDraftingRouter();
    const request = davaRequest();
    const owned = await createDraft(app, { ...request, matter: { ...request.matter, matterId: "m-1" } });
    expect(owned.matterId).toBe("m-1");
    await createDraft(app);

    const all = (await (await app.request("/v1/drafts")).json()) as { drafts: DraftSummary[] };
    expect(all.drafts).toHaveLength(2);
    expect(all.drafts[0]).toMatchObject({ version: 1, kind: "dilekce", template: "dava-dilekcesi", title: "Dava Dilekçesi" });

    const mine = (await (await app.request("/v1/drafts?matterId=m-1")).json()) as { drafts: DraftSummary[] };
    expect(mine.drafts.map((d) => d.draftId)).toEqual([owned.draftId]);
    expect(mine.drafts[0]?.matterId).toBe("m-1");

    const none = (await (await app.request("/v1/drafts?matterId=m-yok")).json()) as { drafts: DraftSummary[] };
    expect(none.drafts).toEqual([]);
    expect((await app.request("/v1/drafts?limit=0")).status).toBe(400);
  });
});

describe("POST /v1/drafts — evidence via the injected answer store", () => {
  it("warms the store, reuses claims, writes the conflicted claim's supporting side (audit #3)", async () => {
    const warmed: string[] = [];
    const app = createDraftingRouter({
      answers: {
        get: (runId) => (runId === "run-1" ? conflictedAnswer() : undefined),
        warm: async (runId) => {
          warmed.push(runId);
        },
      },
    });
    const draft = await createDraft(app, { ...davaRequest(), evidence: { runId: "run-1" } });

    expect(warmed).toEqual(["run-1"]);
    expect(draft.evidence).toHaveLength(2);
    const directions = new Map(draft.evidence.map((e) => [e.evidenceId, e.direction]));
    expect(directions.get("ev-tck157")).toBe("yön belirtmez");
    expect(directions.get("ev-karsit")).toBe("karşıt");
    expect(draft.synthetic).toBe(true);
    // Contract A end to end: the contrary decision is NOT a Dayanak.
    const sebepler = draft.sections.find((s) => s.id === "hukuki-sebepler");
    expect(sebepler?.paragraphs.every((p) => !p.evidenceIds.includes("ev-karsit"))).toBe(true);
    const karsi = draft.sections.find((s) => s.id === "karsi-ictihat");
    expect(karsi?.paragraphs[0]?.evidenceIds).toEqual(["ev-karsit"]);
    // Both claims are written; the conflicted one carries the pointer sentence.
    const degerlendirme = draft.sections
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.role === "hukukiDegerlendirme");
    expect(degerlendirme).toHaveLength(2);
    expect(degerlendirme.every((p) => p.supported && p.evidenceIds.includes("ev-tck157"))).toBe(true);
    expect(degerlendirme.filter((p) => p.text.includes(CONFLICT_POINTER_SENTENCE))).toHaveLength(1);
    expect(draft.unsupportedCount).toBe(0);
    // Human warning names both sides; no raw enum, no claim id.
    const humanWarning = draft.warnings.find((w) => w.includes("çelişki"));
    expect(humanWarning).toContain("E. 2023/7810");
    expect(humanWarning).toContain("KARŞI İÇTİHAT");
    expect(draft.warnings.some((w) => w.includes("CONFLICTING_AUTHORITIES"))).toBe(false);
    expect(draft.warnings.some((w) => /claim-/.test(w))).toBe(false);
    expect(
      draft.machineWarnings!.some(
        (w) => w.includes("claim-celiskili") && w.includes("CONFLICTING_AUTHORITIES"),
      ),
    ).toBe(true);
    // Labels render decision dates GG.AA.YYYY.
    expect(draft.evidence.find((e) => e.evidenceId === "ev-karsit")?.label).toContain("T. 24.06.2024");
  });

  it("rejects an unknown runId with a typed 400", async () => {
    const app = createDraftingRouter({ answers: { get: () => undefined } });
    const response = await jsonPost(app, { ...davaRequest(), evidence: { runId: "run-yok" } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: { path: string }[] } };
    expect(body.error.issues[0]?.path).toBe("evidence.runId");
  });

  it("rejects runId evidence when no answer store is configured", async () => {
    const app = createDraftingRouter();
    const response = await jsonPost(app, { ...davaRequest(), evidence: { runId: "run-1" } });
    expect(response.status).toBe(400);
  });
});

describe("POST /v1/drafts — evidence via the injected file port (audit #4)", () => {
  it("lists the file as Ek-1, never drafts chunk text, offers suggested facts", async () => {
    let seenTenant = "";
    const chunk = uploadChunk();
    const app = createDraftingRouter({
      files: {
        getChunks: async (fileIds, tenantId) => {
          seenTenant = tenantId;
          return fileIds.includes("file-1") ? [chunk] : [];
        },
      },
    });
    const draft = await createDraft(app, { ...davaRequest(), evidence: { fileIds: ["file-1"] } });

    expect(seenTenant).toBe(LOCAL_TENANT_ID);
    expect(draft.evidence).toHaveLength(1);
    expect(draft.evidence[0]?.source).toBe("UPLOAD");
    expect(draft.evidence[0]?.fileId).toBe("file-1");
    expect(draft.evidence[0]?.chunkId).toBe("chunk-1");
    // No paragraph is bound to the chunk; the chunk text never becomes prose.
    const bound = draft.sections.flatMap((s) => s.paragraphs).filter((p) => p.evidenceIds.length > 0);
    expect(bound).toHaveLength(0);
    expect(draft.sections.flatMap((s) => s.paragraphs).some((p) => p.text.includes("DAVACI : Ayşe Yılmaz."))).toBe(false);
    // One DELİLLER line per file with the 8-char content hash.
    const deliller = draft.sections.find((s) => s.id === "deliller")!.paragraphs.map((p) => p.text);
    // 27.09.2026: the human title, no file extension (the full name stays in
    // EK — DOĞRULAMA below, which identifies the exact file).
    expect(deliller).toEqual(["Ek-1: protokol (dosyaya eklediğiniz belge)"]);
    // Fact-like sentences are offered with GG.AA.YYYY dates, not inserted.
    expect(draft.suggestedFacts.length).toBeGreaterThanOrEqual(2);
    expect(draft.suggestedFacts.map((f) => f.tarih)).toContain("12.05.2024");
    expect(draft.suggestedFacts.map((f) => f.tarih)).toContain("03.06.2024");
    expect(draft.suggestedFacts.every((f) => f.fileId === "file-1" && f.chunkId === "chunk-1")).toBe(true);
    // ... and the legal slots stay loudly KAYNAKSIZ.
    const sebepler = draft.sections.find((s) => s.id === "hukuki-sebepler");
    expect(sebepler?.paragraphs.some((p) => !p.supported)).toBe(true);
    expect(draft.warnings.some((w) => w.includes("hukukî dayanak değildir"))).toBe(true);
  });

  it("rejects an unknown fileId with a typed 400", async () => {
    const app = createDraftingRouter({ files: { getChunks: async () => [] } });
    const response = await jsonPost(app, { ...davaRequest(), evidence: { fileIds: ["yok"] } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: { path: string }[] } };
    expect(body.error.issues[0]?.path).toBe("evidence.fileIds");
  });
});

describe("PUT /v1/drafts/{id} and versions", () => {
  function evidenceApp(): App {
    return createDraftingRouter({
      answers: { get: (runId) => (runId === "run-1" ? supportedAnswer() : undefined) },
      now: () => new Date("2026-09-02T10:00:00.000Z"),
    });
  }

  it("baseVersion: a stale editor is refused with 409 VERSION_CONFLICT; the current one saves (W12-FIX)", async () => {
    const app = evidenceApp();
    const draft = await createDraft(app);
    const sections = draft.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({ id: s.id, paragraphs: s.paragraphs.map((p) => ({ id: p.id, text: p.text, evidenceIds: p.evidenceIds, role: p.role })) }));
    const first = await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections, baseVersion: 1 });
    expect(first.status).toBe(200);
    expect(((await first.json()) as Draft).version).toBe(2);

    // Tab B still holds version 1.
    const stale = await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections, baseVersion: 1 });
    expect(stale.status).toBe(409);
    const conflict = (await stale.json()) as { error: { kind: string; message: string; currentVersion: number; baseVersion: number } };
    expect(conflict.error.kind).toBe("VERSION_CONFLICT");
    expect(conflict.error.currentVersion).toBe(2);
    expect(conflict.error.baseVersion).toBe(1);
    expect(conflict.error.message).toContain("sürüm 2");
    // Nothing was written.
    expect(((await (await app.request(`/v1/drafts/${draft.draftId}`)).json()) as Draft).version).toBe(2);

    const current = await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections, baseVersion: 2 });
    expect(current.status).toBe(200);
    expect(((await current.json()) as Draft).version).toBe(3);
    // Without baseVersion the old behaviour stays (last writer wins).
    expect((await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections })).status).toBe(200);
    expect((await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections, baseVersion: 0 })).status).toBe(400);
  });

  it("a version that did not reach the database is said so: persisted:false + Turkish warning (W12-FIX)", async () => {
    const memory = new InMemoryDraftStore();
    let ok = true;
    const store: DraftStore = {
      put: (d) => memory.put(d),
      get: (id) => memory.get(id),
      warm: (id) => memory.warm(id),
      list: (o) => memory.list(o),
      versions: (id) => memory.versions(id),
      persisted: async () => ok,
    };
    const app = createDraftingRouter({ store, now: () => new Date("2026-09-02T10:00:00.000Z") });
    const created = (await (await jsonPost(app, davaRequest())).json()) as Draft & { persisted: boolean };
    expect(created.persisted).toBe(true);
    expect(created.warnings.some((w) => w.includes("veritabanına yazılamadı"))).toBe(false);

    ok = false;
    const sections = created.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({ id: s.id, paragraphs: s.paragraphs.map((p) => ({ id: p.id, text: p.text, evidenceIds: p.evidenceIds, role: p.role })) }));
    const res = await jsonPut(app, `/v1/drafts/${created.draftId}`, { sections });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Draft & { persisted: boolean; machineWarnings?: string[] };
    expect(body.persisted).toBe(false);
    expect(body.warnings).toContain(DRAFT_PERSIST_FAILED_MESSAGE_TR);
    expect(body.machineWarnings?.some((w) => w.startsWith("DRAFT_PERSIST_FAILED:"))).toBe(true);
    // The stored draft itself does not carry the transient warning.
    expect(memory.get(created.draftId)?.warnings).not.toContain(DRAFT_PERSIST_FAILED_MESSAGE_TR);
    const again = (await (await jsonPost(app, davaRequest())).json()) as Draft & { persisted: boolean };
    expect(again.persisted).toBe(false);
  });

  it("revises into version 2, keeps the binding when the quote survives, lists versions", async () => {
    const app = evidenceApp();
    const draft = await createDraft(app, { ...davaRequest(), evidence: { runId: "run-1" } });
    const sections = draft.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({
        id: s.id,
        paragraphs: s.paragraphs.map((p) => ({ id: p.id, text: p.text, evidenceIds: p.evidenceIds, role: p.role })),
      }));
    // Edit a fact paragraph; leave the bound paragraphs intact.
    const aciklamalar = sections.find((s) => s.id === "aciklamalar")!;
    aciklamalar.paragraphs[0]!.text = "1. (05.01.2025) Davalı, davacıya sentetik bir vaatte bulunmuştur (düzenlendi).";
    const response = await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections, note: "Olay 1 düzeltildi." });
    expect(response.status).toBe(200);
    const revised = (await response.json()) as Draft & { issues: unknown[] };
    expect(revised.version).toBe(2);
    expect(revised.issues).toEqual([]);
    expect(revised.updatedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(revised.unsupportedCount).toBe(0);
    expect(revised.sections.find((s) => s.id === "aciklamalar")?.paragraphs[0]?.text).toContain("(düzenlendi)");
    expect(revised.sections[revised.sections.length - 1]?.id).toBe("ek-dogrulama");
    expect(revised.warnings.some((w) => w.startsWith("Sürüm 2:"))).toBe(true);
    expect(revised.warnings.some((w) => w === "Düzenleme notu: Olay 1 düzeltildi.")).toBe(true);

    const latest = (await (await app.request(`/v1/drafts/${draft.draftId}`)).json()) as Draft;
    expect(latest.version).toBe(2);
    const versions = (await (await app.request(`/v1/drafts/${draft.draftId}/versions`)).json()) as {
      versions: DraftSummary[];
    };
    expect(versions.versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await app.request("/v1/drafts/dft-yok/versions")).status).toBe(404);
  });

  it("demotes a legal paragraph whose quote was edited away and refuses entailment over HTTP", async () => {
    const app = evidenceApp();
    const draft = await createDraft(app, { ...davaRequest(), evidence: { runId: "run-1" } });
    const sections = draft.sections
      .filter((s) => s.id !== "ek-dogrulama")
      .map((s) => ({
        id: s.id,
        paragraphs: s.paragraphs.map((p) => ({ id: p.id, text: p.text, evidenceIds: p.evidenceIds, role: p.role })),
      }));
    const sebepler = sections.find((s) => s.id === "hukuki-sebepler")!;
    sebepler.paragraphs[0]!.text = "Dayanak: TCK m. 157 (alıntı silindi).";
    const aciklamalar = sections.find((s) => s.id === "aciklamalar")!;
    const legal = aciklamalar.paragraphs.find((p) => p.role === "hukukiDegerlendirme")!;
    (legal as { binding?: unknown }).binding = { kind: "entailment", score: 0.95, judge: "test-judge" };
    legal.text = "Anlamsal yeniden yazım: dolandırıcılık cezası verilir.";

    const response = await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections });
    expect(response.status).toBe(200);
    const revised = (await response.json()) as Draft & {
      issues: { path: string; message: string; code?: string }[];
    };
    expect(revised.version).toBe(2);
    expect(revised.unsupportedCount).toBe(2);
    // W14 · B-01: the PUT response carries the machine code on the wire.
    expect(revised.issues.some((i) => i.code === "QUOTE_ALTERED")).toBe(true);
    expect(revised.issues.some((i) => i.message.includes("entailment"))).toBe(true);
    // The TCK entry is no longer cited -> unusedEvidence; the contrary
    // decision stays cited by its own karşı içtihat section.
    expect(revised.evidence.map((e) => e.evidenceId)).toEqual(["ev-karsit"]);
    expect(revised.unusedEvidence.map((e) => e.evidenceId)).toEqual(["ev-tck157"]);
    const ek = revised.sections.find((s) => s.id === "ek-dogrulama");
    expect(ek?.paragraphs.some((p) => p.text.startsWith("K-1 — Yargıtay"))).toBe(true);
    expect(ek?.paragraphs.some((p) => p.text.includes("m. 157"))).toBe(false);
  });

  it("answers typed 400s for an unknown section, a bad body and a missing draft", async () => {
    const app = evidenceApp();
    const draft = await createDraft(app);
    const unknown = await jsonPut(app, `/v1/drafts/${draft.draftId}`, {
      sections: [{ id: "yok-boyle-bolum", paragraphs: [] }],
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { issues: { path: string }[] } }).error.issues[0]?.path).toBe(
      "sections.0.id",
    );
    const bad = await jsonPut(app, `/v1/drafts/${draft.draftId}`, { sections: "x" });
    expect(bad.status).toBe(400);
    expect((await jsonPut(app, "/v1/drafts/dft-yok", { sections: [] })).status).toBe(404);
  });
});

describe("GET /v1/drafts/{id}/export", () => {
  it("renders markdown with the banner first and a filename header", async () => {
    const app = createDraftingRouter();
    const draft = await createDraft(app);
    const response = await app.request(`/v1/drafts/${draft.draftId}/export?format=md`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toContain(`filename="Dava Dilekcesi - v1.md"`);
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''Dava%20Dilek%C3%A7esi%20-%20v1.md");
    const text = await response.text();
    expect(text.split("\n")[0]).toBe(DRAFT_REVIEW_BANNER);
  });

  it("rejects a missing/unknown format (naming udf as deneysel) and an unknown draft", async () => {
    const app = createDraftingRouter();
    const draft = await createDraft(app);
    expect((await app.request(`/v1/drafts/${draft.draftId}/export`)).status).toBe(400);
    const pdf = await app.request(`/v1/drafts/${draft.draftId}/export?format=pdf`);
    expect(pdf.status).toBe(400);
    const body = (await pdf.json()) as { error: { message: string } };
    expect(body.error.message).toContain("udf");
    expect(body.error.message).toContain(UDF_EXPERIMENTAL_NOTE);
    expect((await app.request("/v1/drafts/dft-yok/export?format=md")).status).toBe(404);
  });

  it("docx: drives the Python CLI contract through the injected runner with a 60 s timeout", async () => {
    const fakeBytes = Buffer.from("PK-sahte-docx-icerik");
    const calls: DraftDocxExecRequest[] = [];
    const app = createDraftingRouter({
      pythonPath: "C:/fake/venv/python.exe",
      repoRoot: "C:/fake/repo",
      exec: async (request) => {
        calls.push(request);
        const outIndex = request.args.indexOf("--out");
        await writeFile(request.args[outIndex + 1] as string, fakeBytes);
        return { code: 0, stderr: "" };
      },
    });
    const draft = await createDraft(app);
    const response = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toContain(`filename="Dava Dilekcesi - v1.docx"`);
    expect(response.headers.get("x-collex-experimental")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fakeBytes);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.pythonPath).toBe("C:/fake/venv/python.exe");
    expect(call.cwd).toBe("C:/fake/repo");
    expect(call.timeoutMs).toBe(EXPORT_TIMEOUT_MS);
    expect(EXPORT_TIMEOUT_MS).toBe(60_000);
    expect(call.args).toContain("-m");
    expect(call.args).toContain("export.cli");
    expect(call.args).toContain("--draft");
    expect(call.args[call.args.indexOf("--format") + 1]).toBe("dilekce-docx");
    // W12-FIX2 (P2-14): fixed temp names — the id never becomes a path segment.
    const draftPath = call.args[call.args.indexOf("--draft") + 1] as string;
    expect(draftPath).toMatch(/[\\/]draft\.json$/u);
    expect(draftPath).not.toContain(draft.draftId);
  });

  it("udf: uses --format dilekce-udf and marks the response experimental", async () => {
    const fakeBytes = Buffer.from("PK-sahte-udf-icerik");
    const calls: DraftDocxExecRequest[] = [];
    const app = createDraftingRouter({
      exec: async (request) => {
        calls.push(request);
        await writeFile(request.args[request.args.indexOf("--out") + 1] as string, fakeBytes);
        return { code: 0, stderr: "" };
      },
    });
    const draft = await createDraft(app);
    const response = await app.request(`/v1/drafts/${draft.draftId}/export?format=udf`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-collex-experimental")).toBe("udf");
    expect(response.headers.get("content-disposition")).toContain(`filename="Dava Dilekcesi - v1.udf"`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fakeBytes);
    expect(calls[0]!.args[calls[0]!.args.indexOf("--format") + 1]).toBe("dilekce-udf");
    expect((calls[0]!.args[calls[0]!.args.indexOf("--out") + 1] as string).endsWith(".udf")).toBe(true);
  });

  it("surfaces an exporter refusal as a typed 500, never a file (docx and udf)", async () => {
    const app = createDraftingRouter({
      exec: async () => ({ code: 2, stderr: "DIŞA AKTARMA REDDEDİLDİ: test" }),
    });
    const draft = await createDraft(app);
    const docx = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
    expect(docx.status).toBe(500);
    expect(((await docx.json()) as { error: { kind: string } }).error.kind).toBe("EXPORT_REFUSED");
    const udf = await app.request(`/v1/drafts/${draft.draftId}/export?format=udf`);
    expect(udf.status).toBe(500);
    const body = (await udf.json()) as { error: { kind: string; note?: string } };
    expect(body.error.kind).toBe("EXPORT_REFUSED");
    expect(body.error.note).toBe(UDF_EXPERIMENTAL_NOTE);
  });
});

describe("W12-FIX2: human export names (P2-5), no stderr echo and id shape (P2-14)", () => {
  it("names the file '<Belge> - <Dosya> - v<N>.<ext>' ASCII-safe, with the UTF-8 name in filename*", () => {
    expect(asciiSafe("Yılmaz / Kira tahliye — Şişli İÇ")).toBe("Yilmaz Kira tahliye Sisli IC");
    const name = exportFileName(
      { title: "Cevap Dilekçesi", template: "cevap-dilekcesi", version: 2, draftId: "dft-1" },
      "docx",
      "Yılmaz / Kira tahliye",
    );
    expect(name.ascii).toBe("Cevap Dilekcesi - Yilmaz Kira tahliye - v2.docx");
    expect(name.utf8).toBe("Cevap Dilekçesi - Yılmaz Kira tahliye - v2.docx");
    expect(contentDisposition(name)).toBe(
      `attachment; filename="Cevap Dilekcesi - Yilmaz Kira tahliye - v2.docx"; filename*=UTF-8''${encodeURIComponent(name.utf8)}`,
    );
    // No matter, no title: template + version; nothing ASCII left: the id.
    expect(exportFileName({ template: "ihtarname", draftId: "dft-2" }, "md").ascii).toBe("ihtarname - v1.md");
    expect(exportFileName({ title: "☃", template: "☃", draftId: "dft-3" }, "udf").ascii).toBe("v1.udf");
  });

  it("uses the matter title in the file name and the Markdown meta; the exporter gets fixed temp names + matterTitle", async () => {
    const calls: DraftDocxExecRequest[] = [];
    let handed: { matterTitle?: string } = {};
    const app = createDraftingRouter({
      matterTitle: async (matterId) => (matterId === "11111111-1111-4111-8111-111111111111" ? "Yılmaz / Kira tahliye" : undefined),
      exec: async (request) => {
        calls.push(request);
        const jsonIndex = request.args.indexOf("--draft");
        handed = JSON.parse(await readFile(request.args[jsonIndex + 1] as string, "utf8")) as { matterTitle?: string };
        const outIndex = request.args.indexOf("--out");
        await writeFile(request.args[outIndex + 1] as string, Buffer.from("PK"));
        return { code: 0, stderr: "" };
      },
    });
    const draft = await createDraft(app, {
      ...davaRequest(),
      matter: { ...davaRequest().matter, matterId: "11111111-1111-4111-8111-111111111111" },
    });
    const md = await app.request(`/v1/drafts/${draft.draftId}/export?format=md`);
    expect(md.headers.get("content-disposition")).toContain(`filename="Dava Dilekcesi - Yilmaz Kira tahliye - v1.md"`);
    expect(await md.text()).toContain("- Dosya: Yılmaz / Kira tahliye");
    const docx = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-disposition")).toContain(`filename="Dava Dilekcesi - Yilmaz Kira tahliye - v1.docx"`);
    expect(handed.matterTitle).toBe("Yılmaz / Kira tahliye");
    const args = calls[0]!.args;
    expect(args[args.indexOf("--draft") + 1]).toMatch(/[\\/]draft\.json$/u);
    expect(args[args.indexOf("--out") + 1]).toMatch(/[\\/]draft\.docx$/u);
  });

  it("EXPORT_FAILED never echoes stderr; a malformed draft id is 404 before the store and the process", async () => {
    const logged: string[] = [];
    let execCalls = 0;
    const app = createDraftingRouter({
      log: (line) => logged.push(line),
      exec: async () => {
        execCalls += 1;
        return { code: 1, stderr: "Traceback: C:\\gizli\\export\\cli.py dsn=postgres://x" };
      },
    });
    const draft = await createDraft(app);
    const res = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { kind: string; detail: string; correlationId: string } };
    expect(body.error.kind).toBe("EXPORT_FAILED");
    expect(body.error.detail).toBe(exportFailureDetail(body.error.correlationId));
    expect(JSON.stringify(body)).not.toContain("Traceback");
    expect(logged[0]).toContain(`EXPORT_FAILED id=${body.error.correlationId}`);
    expect(logged[0]).toContain("Traceback");
    for (const bad of ["..%2F..%2Fetc", "dft-1%00x", "a%20b", "-x"]) {
      const r = await app.request(`/v1/drafts/${bad}/export?format=docx`);
      expect(r.status, bad).toBe(404);
    }
    expect(execCalls).toBe(1);
  });
});
