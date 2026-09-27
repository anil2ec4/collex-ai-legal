/**
 * W22 "Word'de düzelttim, geri yükle" — contract tests with a FAKE read-back
 * process (no Python): the typed Turkish refusals, the preview/confirm
 * handshake, and the alignment rules the real round trip
 * (`docxImport.real.test.ts`) exercises end to end.
 */

import { describe, expect, it } from "vitest";

import { composeDraft } from "../../src/drafting/composer.js";
import {
  DOCX_IDENTITY_INVALID,
  DOCX_IDENTITY_MISMATCH,
  DOCX_IDENTITY_MISSING,
  DOCX_OTHER_DRAFT,
  IMPORT_PREVIEW_MISMATCH,
  alignDocxImport,
  applyPlan,
  canonicalTextSha256,
  checkDocxIdentity,
  type DocxReadback,
  type DraftDocxReadRequest,
  type DraftDocxReadResult,
} from "../../src/drafting/docxImport.js";
import { createDraftingRouter } from "../../src/drafting/routes.js";
import { InMemoryDraftStore } from "../../src/drafting/store.js";
import type { Draft } from "../../src/drafting/types.js";
import { UPLOAD_CAP_MIB } from "../../src/files/routes.js";
import { davaRequest, karsitEvidence, tckEvidence, tckPack } from "./fixtures.js";

const SHA = "a".repeat(64);
const NOW = () => new Date("2026-09-27T10:00:00.000Z");

function dava(id = "dft-imp-1"): Draft {
  const draft = composeDraft(
    davaRequest(),
    tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }, karsitEvidence()] }),
    { now: () => new Date("2026-09-02T09:00:00.000Z") },
  );
  return { ...draft, draftId: id };
}

type Block = DocxReadback["blocks"][number];

/** What export/draft_identity.py reads back from an untouched TASLAK export. */
function simulateReadback(draft: Draft, opts: { annex?: string; marks?: string } = {}): DocxReadback {
  const annex = opts.annex ?? "full";
  const marks = opts.marks ?? "all";
  const blocks: Block[] = [];
  const paragraphs: NonNullable<DocxReadback["identity"]>["paragraphs"] = [];
  const add = (b: Omit<Block, "index" | "pendingChange">): void => {
    blocks.push({ ...b, index: blocks.length, pendingChange: false });
  };
  add({ kind: "paragraph", style: "CollexTaslakUyari", text: "Bu taslak makine üretimidir; avukat incelemesi zorunludur.", marks: [] });
  add({ kind: "heading", style: "Title", text: `${draft.title} (TASLAK)`, marks: [] });
  const numbering = new Map(draft.evidence.map((e, i) => [e.evidenceId, i + 1]));
  let n = 0;
  for (const section of draft.sections) {
    if (section.id === "ek-dogrulama" && annex === "none") continue;
    if (section.title !== "") add({ kind: "heading", style: "Heading 1", text: section.title, marks: [] });
    for (const p of section.paragraphs) {
      n += 1;
      const lines = p.text.split("\n");
      if (!p.supported && marks === "all") lines[0] = `⚠ KAYNAKSIZ — ${lines[0]}`;
      for (const line of lines) add({ kind: "paragraph", style: "CollexTaslakGovde", text: line, marks: [n] });
      for (const id of p.evidenceIds) {
        const entry = draft.evidence.find((e) => e.evidenceId === id);
        add({ kind: "paragraph", style: "CollexTaslakAtif", text: `Dayanak [K-${numbering.get(id)}]: ${entry?.label ?? ""}`, marks: [] });
      }
      paragraphs.push({
        n,
        id: p.id,
        sectionId: section.id,
        role: p.role,
        supported: p.supported,
        lines: lines.length,
        textSha256: canonicalTextSha256(p.text),
        quotes: p.evidenceIds.map((id) => ({
          evidenceId: id,
          quoteSha256: draft.evidence.find((e) => e.evidenceId === id)?.quoteSha256 ?? "",
        })),
      });
    }
  }
  if (annex === "full") add({ kind: "heading", style: "Heading 1", text: "DAYANAK KAYNAKLARI", marks: [] });
  const apparatus = blocks.filter((b) => b.marks.length === 0 && b.text !== "").map((b) => canonicalTextSha256(b.text));
  return {
    schema: "collex.draft-docx-readback/v1",
    identityStatus: "OK",
    identity: {
      schema: "collex.draft-identity/v1",
      draftId: draft.draftId,
      version: draft.version,
      template: draft.template,
      exportMode: { annex, marks },
      paragraphs,
      apparatusSha256: apparatus,
    },
    blocks,
    trackedChanges: { pending: false, insertions: 0, deletions: 0, moves: 0, formatting: 0 },
    fileSha256: SHA,
  };
}

function paragraphN(readback: DocxReadback, id: string): number {
  return readback.identity?.paragraphs.find((p) => p.id === id)?.n ?? -1;
}

function blockOf(readback: DocxReadback, id: string): Block {
  const n = paragraphN(readback, id);
  return readback.blocks.find((b) => b.marks.includes(n)) as Block;
}

function reindex(readback: DocxReadback): DocxReadback {
  readback.blocks.forEach((b, i) => {
    b.index = i;
  });
  return readback;
}

function harness(drafts: Draft[], reply: (req: DraftDocxReadRequest) => DraftDocxReadResult) {
  const store = new InMemoryDraftStore();
  for (const d of drafts) store.put(d);
  const calls: DraftDocxReadRequest[] = [];
  const logs: string[] = [];
  const app = createDraftingRouter({
    store,
    now: NOW,
    log: (line) => logs.push(line),
    repoRoot: "/repo",
    pythonPath: "/repo/.venv/bin/python",
    docxRead: async (req) => {
      calls.push(req);
      return reply(req);
    },
  });
  return { app, store, calls, logs };
}

async function post(app: ReturnType<typeof createDraftingRouter>, id: string, fields: Record<string, string> = {}, file = true) {
  const form = new FormData();
  if (file) form.append("file", new Blob([new Uint8Array([80, 75, 3, 4])]), "../../Dava Dilekçesi.docx");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const response = await app.request(`/v1/drafts/${id}/import-docx`, { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const ok = (readback: DocxReadback) => (): DraftDocxReadResult => ({ code: 0, stdout: `${JSON.stringify(readback)}\n`, stderr: "" });

describe("POST /v1/drafts/{id}/import-docx — refusals", () => {
  it("answers 404 for an unknown draft without starting the reader", async () => {
    const { app, calls } = harness([dava()], ok(simulateReadback(dava())));
    expect((await post(app, "dft-yok")).status).toBe(404);
    expect((await post(app, "-kotu-kimlik")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("requires a file, and enforces the same upload cap as /v1/files", async () => {
    const draft = dava();
    const { app, calls } = harness([draft], ok(simulateReadback(draft)));
    const missing = await post(app, draft.draftId, {}, false);
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain("Word dosyasını taşımalı");
    const big = new FormData();
    big.append("file", new Blob([new Uint8Array(UPLOAD_CAP_MIB * 1024 * 1024 + 1)]), "buyuk.docx");
    const response = await app.request(`/v1/drafts/${draft.draftId}/import-docx`, { method: "POST", body: big });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain(`${UPLOAD_CAP_MIB} MB`);
    expect(calls).toHaveLength(0);
  });

  it("runs the read-back shell-free with a sanitized name and maps its typed errors", async () => {
    const draft = dava();
    const { app, calls } = harness([draft], () => ({
      code: 1,
      stdout: JSON.stringify({ error: { kind: "UNSUPPORTED_TYPE", message: "Geri yükleme yalnız Word belgesi (.docx) kabul eder; yüklenen dosya PDF." } }),
      stderr: "",
    }));
    const res = await post(app, draft.draftId);
    expect(res.status).toBe(415);
    expect(res.body.error.kind).toBe("UNSUPPORTED_TYPE");
    const args = calls[0]?.args ?? [];
    expect(args.slice(0, 5)).toEqual(["-X", "utf8", "-m", "export.draft_identity", "--read"]);
    expect(args[args.indexOf("--name") + 1]).toBe("Dava Dilekçesi.docx");
    expect(calls[0]?.pythonPath).toBe("/repo/.venv/bin/python");
  });

  it("never puts the reader's stderr into the body (IMPORT_FAILED + correlationId)", async () => {
    const draft = dava();
    const { app, logs } = harness([draft], () => ({ code: 1, stdout: "", stderr: "Traceback: gizli yol /home/x" }));
    const res = await post(app, draft.draftId);
    expect(res.status).toBe(500);
    expect(res.body.error.kind).toBe("IMPORT_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("Traceback");
    expect(logs.some((l) => l.includes(res.body.error.correlationId) && l.includes("Traceback"))).toBe(true);
  });

  it("refuses a DOCX with no identity and one whose identity was edited (422, Turkish)", async () => {
    const draft = dava();
    const missing = { ...simulateReadback(draft), identityStatus: "MISSING" as const, identity: null };
    const r1 = await post(harness([draft], ok(missing)).app, draft.draftId);
    expect(r1.status).toBe(422);
    expect(r1.body.error.kind).toBe(DOCX_IDENTITY_MISSING);
    expect(r1.body.error.message).toMatch(/^Bu Word dosyasında ColleX taslak kimliği yok/u);
    const edited = { ...simulateReadback(draft), identityStatus: "DIGEST_MISMATCH" as const };
    const r2 = await post(harness([draft], ok(edited)).app, draft.draftId);
    expect(r2.status).toBe(422);
    expect(r2.body.error.kind).toBe(DOCX_IDENTITY_INVALID);
  });

  it("refuses a DOCX of another draft, of an older version, or that does not describe this draft", async () => {
    const a = dava("dft-imp-a");
    const b = dava("dft-imp-b");
    const other = await post(harness([a, b], ok(simulateReadback(b))).app, a.draftId);
    expect(other.status).toBe(409);
    expect(other.body.error.kind).toBe(DOCX_OTHER_DRAFT);
    expect(other.body.error.docxDraftId).toBe(b.draftId);

    const moved = { ...a, version: 3 };
    const stale = await post(harness([moved], ok(simulateReadback(a))).app, a.draftId);
    expect(stale.status).toBe(409);
    expect(stale.body.error.kind).toBe("VERSION_CONFLICT");
    expect(stale.body.error).toMatchObject({ currentVersion: 3, docxVersion: 1 });

    const wrongText = simulateReadback(a);
    (wrongText.identity?.paragraphs[0] as { textSha256: string }).textSha256 = "b".repeat(64);
    const r1 = await post(harness([a], ok(wrongText)).app, a.draftId);
    expect(r1.status).toBe(409);
    expect(r1.body.error.kind).toBe(DOCX_IDENTITY_MISMATCH);

    const wrongQuote = simulateReadback(a);
    const cited = wrongQuote.identity?.paragraphs.find((p) => p.quotes.length > 0);
    (cited?.quotes[0] as { quoteSha256: string }).quoteSha256 = "c".repeat(64);
    expect(checkDocxIdentity(a, wrongQuote)?.kind).toBe(DOCX_IDENTITY_MISMATCH);
  });
});

describe("POST /v1/drafts/{id}/import-docx — preview, then confirm", () => {
  it("previews without saving; confirm needs the previewed file's fingerprint", async () => {
    const draft = dava();
    const readback = simulateReadback(draft);
    blockOf(readback, "p-aciklamalar-7").text = "2. (10.03.2025) Taraflar arasında yazılı bir görüşme yapılmıştır.";
    const { app, store } = harness([draft], ok(readback));

    const preview = await post(app, draft.draftId);
    expect(preview.status).toBe(200);
    expect(preview.body.saved).toBe(false);
    expect(preview.body.import.counts).toMatchObject({ changed: 1, added: 0, deleted: 0 });
    expect(store.get(draft.draftId)?.version).toBe(1);

    const noSha = await post(app, draft.draftId, { confirm: "true" });
    expect(noSha.status).toBe(400);
    const wrong = await post(app, draft.draftId, { confirm: "true", previewFingerprint: "0".repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.kind).toBe(IMPORT_PREVIEW_MISMATCH);
    expect(store.get(draft.draftId)?.version).toBe(1);
    const bad = await post(app, draft.draftId, { confirm: "evet" });
    expect(bad.status).toBe(400);

    const saved = await post(app, draft.draftId, { confirm: "true", previewFingerprint: SHA });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.persisted).toBe(true);
    const v2 = store.get(draft.draftId) as Draft;
    expect(v2.sections.flatMap((s) => s.paragraphs).find((p) => p.id === "p-aciklamalar-7")?.text).toBe(
      "2. (10.03.2025) Taraflar arasında yazılı bir görüşme yapılmıştır.",
    );
  });
});

describe("alignDocxImport — the rules", () => {
  it("an untouched export is all unchanged and re-sends every stored text verbatim", () => {
    const draft = dava();
    const plan = alignDocxImport(draft, simulateReadback(draft));
    expect(plan.entries.every((e) => e.status === "unchanged")).toBe(true);
    expect(plan.ignored).toEqual([]);
    const result = applyPlan(draft, plan, NOW);
    const before = draft.sections.filter((s) => s.id !== "ek-dogrulama");
    const after = result.draft.sections.filter((s) => s.id !== "ek-dogrulama");
    expect(after.map((s) => s.paragraphs.map((p) => [p.id, p.text, p.supported]))).toEqual(
      before.map((s) => s.paragraphs.map((p) => [p.id, p.text, p.supported])),
    );
  });

  it("aligns by text when the hidden bookmark was lost (exact → unchanged, similar → changed)", () => {
    const draft = dava();
    const readback = simulateReadback(draft);
    blockOf(readback, "p-aciklamalar-6").marks = [];
    const lost = blockOf(readback, "p-sonuc-13");
    lost.marks = [];
    lost.text = "1. Sentetik alacağın 50.000 TL olarak davalıdan faiziyle tahsiline";
    const plan = alignDocxImport(draft, readback);
    const e6 = plan.entries.find((e) => e.paragraphId === "p-aciklamalar-6");
    expect(e6).toMatchObject({ status: "unchanged", matchedBy: "metin" });
    const e13 = plan.entries.find((e) => e.paragraphId === "p-sonuc-13");
    expect(e13).toMatchObject({ status: "changed", matchedBy: "metin" });
    expect(plan.entries.filter((e) => e.status === "added")).toEqual([]);
  });

  it("reads a KAYNAKSIZ paragraph without its screen mark", () => {
    const draft = dava();
    const sebepler = draft.sections.find((s) => s.id === "hukuki-sebepler");
    const para = sebepler?.paragraphs[0];
    if (para !== undefined) {
      para.supported = false;
      para.evidenceIds = [];
      para.text = "Hukukî sebepler avukat tarafından eklenecektir.";
    }
    draft.unsupportedCount = 1;
    const readback = simulateReadback(draft);
    expect(blockOf(readback, "p-hukuki-sebepler-10").text.startsWith("⚠ KAYNAKSIZ — ")).toBe(true);
    const plan = alignDocxImport(draft, readback);
    expect(plan.entries.find((e) => e.paragraphId === "p-hukuki-sebepler-10")?.status).toBe("unchanged");
  });

  it("a paragraph typed after a legal one inherits its kind and is KAYNAKSIZ without a source", () => {
    const draft = dava();
    const readback = simulateReadback(draft);
    const after = readback.blocks.indexOf(blockOf(readback, "p-aciklamalar-9"));
    readback.blocks.splice(after + 1, 0, {
      index: 0,
      kind: "paragraph",
      style: "CollexTaslakGovde",
      text: "Bu eylem aynı zamanda sözleşmeye aykırılık oluşturur.",
      marks: [],
      pendingChange: false,
    });
    // …and one typed after a statement of fact stays a statement.
    const afterFact = readback.blocks.indexOf(blockOf(readback, "p-aciklamalar-6"));
    readback.blocks.splice(afterFact + 1, 0, {
      index: 0,
      kind: "paragraph",
      style: "CollexTaslakGovde",
      text: "Davacı bu vaade güvenerek ödeme yapmıştır.",
      marks: [],
      pendingChange: false,
    });
    const plan = alignDocxImport(draft, reindex(readback));
    applyPlan(draft, plan, NOW);
    const added = plan.entries.filter((e) => e.status === "added");
    expect(added.map((e) => [e.after, e.outcome?.kaynaksiz])).toEqual([
      ["Davacı bu vaade güvenerek ödeme yapmıştır.", false],
      ["Bu eylem aynı zamanda sözleşmeye aykırılık oluşturur.", true],
    ]);
  });

  it("never applies an edit to the verification appendix, the karşı içtihat section or a machine line", () => {
    const draft = dava();
    const readback = simulateReadback(draft);
    blockOf(readback, "p-ek-dogrulama-1").text = "Bu bölüm silinebilir.";
    const karsi = blockOf(readback, "p-karsi-ictihat-19");
    const karsiAt = readback.blocks.indexOf(karsi);
    readback.blocks.splice(karsiAt + 1, 0, {
      index: 0,
      kind: "paragraph",
      style: "CollexTaslakGovde",
      text: "Bu karar somut olaya uymaz.",
      marks: [],
      pendingChange: false,
    });
    const citation = readback.blocks.find((b) => b.text.startsWith("Dayanak [K-1]:")) as Block;
    citation.text = citation.text.replace("m. 157", "m. 999");
    const plan = alignDocxImport(draft, reindex(readback));
    const result = applyPlan(draft, plan, NOW);
    const ek = plan.entries.find((e) => e.paragraphId === "p-ek-dogrulama-1");
    expect(ek).toMatchObject({ status: "changed", locked: true, applied: false });
    const addedKarsi = plan.entries.find((e) => e.status === "added");
    expect(addedKarsi).toMatchObject({ sectionId: "karsi-ictihat", locked: true, applied: false });
    expect(plan.ignored.map((i) => i.text)).toEqual([citation.text]);
    expect(result.draft.sections.find((s) => s.id === "karsi-ictihat")).toEqual(
      draft.sections.find((s) => s.id === "karsi-ictihat"),
    );
    // The appendix is regenerated by the reviser, never taken from Word.
    const ekAfter = result.draft.sections.find((s) => s.id === "ek-dogrulama");
    expect(ekAfter?.paragraphs.some((p) => p.text === "Bu bölüm silinebilir.")).toBe(false);
  });

  it("marks a paragraph with a pending tracked change, and the note says so", () => {
    const draft = dava();
    const readback = simulateReadback(draft);
    const block = blockOf(readback, "p-sonuc-14");
    block.text = `${block.text} (faiziyle)`;
    block.pendingChange = true;
    readback.trackedChanges = { pending: true, insertions: 1, deletions: 0, moves: 0, formatting: 0 };
    const plan = alignDocxImport(draft, readback);
    expect(plan.entries.find((e) => e.paragraphId === "p-sonuc-14")).toMatchObject({
      status: "changed",
      pendingTrackedChange: true,
    });
    expect(plan.patch.note).toContain("izlenen değişiklikler kabul edilmiş hâliyle okundu");
  });
});
