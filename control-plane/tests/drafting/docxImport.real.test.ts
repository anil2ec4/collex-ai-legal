/**
 * REAL "Word'de düzelttim, geri yükle" round trip (W22), venv Python end to end:
 *
 *   composed draft → GET /export?format=docx (real export.cli, hidden identity)
 *   → edited the way a lawyer edits in Word (tests/export/docx_word_edit.py:
 *     a changed sentence, ONE altered letter inside a quote, an added
 *     paragraph, a deleted one, a pending tracked change written as raw XML,
 *     an edit inside the locked karşı içtihat section, an edited citation line)
 *   → POST /v1/drafts/{id}/import-docx (real read-back) → the diff, BEFORE
 *     anything is saved → confirm → a new version through reviseDraft.
 *
 * Plus the refusals: a DOCX of another draft, a DOCX without identity, the
 * same file after the draft moved on, and a Word-like re-save that must keep
 * the identity. Skips visibly (an INVERSE marker) when the venv is absent.
 */

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { composeDraft } from "../../src/drafting/composer.js";
import { PLACEHOLDER_UNFILLED } from "../../src/drafting/placeholders.js";
import { createDraftingRouter } from "../../src/drafting/routes.js";
import { InMemoryDraftStore } from "../../src/drafting/store.js";
import type { Draft } from "../../src/drafting/types.js";
import { davaRequest, karsitEvidence, minimalRequestFor, tckEvidence, tckPack } from "./fixtures.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PYTHON =
  process.platform === "win32"
    ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
    : join(REPO_ROOT, ".venv", "bin", "python");
const HAVE_PYTHON = existsSync(PYTHON);
const EDIT_HELPER = join(REPO_ROOT, "tests", "export", "docx_word_edit.py");

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((done) => {
    execFile(PYTHON, ["-X", "utf8", ...args], { cwd: REPO_ROOT, timeout: 120_000 }, (error, _stdout, stderr) => {
      done({ code: error === null ? 0 : 1, stderr: stderr ?? "" });
    });
  });
}

type Op = Record<string, string>;

async function wordEdit(workDir: string, source: Buffer, ops: Op[], name: string): Promise<Buffer> {
  const inPath = join(workDir, `${name}-in.docx`);
  const outPath = join(workDir, `${name}-out.docx`);
  const opsPath = join(workDir, `${name}.json`);
  await writeFile(inPath, source);
  await writeFile(opsPath, JSON.stringify(ops), "utf8");
  const done = await run([EDIT_HELPER, inPath, outPath, opsPath]);
  expect(done.code, done.stderr).toBe(0);
  return readFile(outPath);
}

function setup(drafts: Draft[]) {
  const store = new InMemoryDraftStore();
  for (const draft of drafts) store.put(draft);
  const app = createDraftingRouter({
    store,
    repoRoot: REPO_ROOT,
    pythonPath: PYTHON,
    now: () => new Date("2026-09-27T10:00:00.000Z"),
    log: () => {},
  });
  return { app, store };
}

async function exportDocx(app: ReturnType<typeof createDraftingRouter>, draftId: string, query = ""): Promise<Buffer> {
  const response = await app.request(`/v1/drafts/${draftId}/export?format=docx${query}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

async function importDocx(
  app: ReturnType<typeof createDraftingRouter>,
  draftId: string,
  bytes: Buffer,
  confirm?: { fileSha256: string },
) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), "Dava Dilekçesi - v1.docx");
  if (confirm !== undefined) {
    form.append("confirm", "true");
    form.append("previewFingerprint", confirm.fileSha256);
  }
  const response = await app.request(`/v1/drafts/${draftId}/import-docx`, { method: "POST", body: form });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

function dava(id: string): Draft {
  const draft = composeDraft(
    davaRequest(),
    tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }, karsitEvidence()] }),
    { now: () => new Date("2026-09-02T09:00:00.000Z") },
  );
  return { ...draft, draftId: id };
}

const OPS: Op[] = [
  // A changed sentence in AÇIKLAMALAR (a statement of fact).
  { op: "replace_text", contains: "satış görüşmesi", new: "2. (10.03.2025) Taraflar arasında sentetik bir satış görüşmesi yapılmış ve tutanağa geçirilmiştir." },
  // ONE letter inside the quote a HUKUKÎ SEBEPLER paragraph cites.
  { op: "replace_in", contains: "Dayanak: 5237 sayılı", old: "beş yıla", new: "beş yıle" },
  // A new paragraph typed after that legal ground — no source.
  { op: "insert_after", contains: "Dayanak: 5237 sayılı", text: "Davalının eylemi ayrıca haksız fiil niteliğindedir." },
  // A deleted paragraph.
  { op: "delete", contains: "Ödenen bedel iade edilmemiş" },
  // A PENDING tracked insertion (raw w:ins).
  { op: "tracked_insert", contains: "Sentetik alacağın 50.000 TL", text: " yasal faiziyle birlikte" },
  // An edit inside the LOCKED karşı içtihat section.
  { op: "replace_in", contains: "Yargıtay 15. Ceza Dairesi, E. 2023/7810", old: "Somut olayda", new: "Somut olayımızda" },
  // An edited citation line (machine apparatus).
  { op: "replace_in", contains: "Dayanak [K-1]:", old: "m. 157", new: "m. 158" },
];

describe("real Word round trip (venv Python)", () => {
  it.skipIf(!HAVE_PYTHON)(
    "diffs a Word-edited draft before saving, then saves it through every gate",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "collex-docx-rt-"));
      try {
        const draft = dava("dft-roundtrip-1");
        const { app, store } = setup([draft]);
        const exported = await exportDocx(app, draft.draftId);
        const edited = await wordEdit(workDir, exported, OPS, "duzelt");

        // ---- preview: nothing saved yet ------------------------------------
        const preview = await importDocx(app, draft.draftId, edited);
        expect(preview.status, JSON.stringify(preview.body)).toBe(200);
        expect(preview.body["saved"]).toBe(false);
        expect(store.get(draft.draftId)?.version).toBe(1);
        const summary = preview.body["import"];
        const entries = summary.paragraphs as Array<Record<string, any>>;
        const byId = (id: string) => entries.find((e) => e.paragraphId === id) as Record<string, any>;

        expect(byId("p-aciklamalar-7").status).toBe("changed");
        expect(byId("p-aciklamalar-7").matchedBy).toBe("kimlik");
        expect(byId("p-aciklamalar-7").after).toContain("tutanağa geçirilmiştir");
        expect(byId("p-aciklamalar-7").outcome.kaynaksiz).toBe(false);

        const altered = byId("p-hukuki-sebepler-10");
        expect(altered.status).toBe("changed");
        expect(altered.outcome.quoteAltered).toBe(true);
        expect(altered.outcome.kaynaksiz).toBe(true);
        expect(altered.outcome.evidenceIds).toEqual([]);
        expect(altered.outcome.issues.map((i: { code?: string }) => i.code)).toContain("QUOTE_ALTERED");

        const added = entries.filter((e) => e.status === "added");
        expect(added).toHaveLength(1);
        expect(added[0]?.sectionId).toBe("hukuki-sebepler");
        expect(added[0]?.after).toBe("Davalının eylemi ayrıca haksız fiil niteliğindedir.");
        expect(added[0]?.outcome.kaynaksiz).toBe(true);

        expect(byId("p-aciklamalar-8").status).toBe("deleted");
        expect(byId("p-aciklamalar-8").applied).toBe(true);

        const tracked = byId("p-sonuc-13");
        expect(tracked.status).toBe("changed");
        expect(tracked.pendingTrackedChange).toBe(true);
        expect(tracked.after).toContain("yasal faiziyle birlikte");
        expect(summary.trackedChanges.pending).toBe(true);
        expect(summary.trackedChanges.message).toContain("KABUL EDİLMİŞ");

        const karsi = byId("p-karsi-ictihat-19");
        expect(karsi.status).toBe("changed");
        expect(karsi.locked).toBe(true);
        expect(karsi.applied).toBe(false);
        expect(karsi.note).toContain("uygulanmadı");

        expect(summary.ignoredLines.map((l: { text: string }) => l.text)).toContain(
          "Dayanak [K-1]: 5237 sayılı Türk Ceza Kanunu (SENTETİK), m. 158",
        );
        expect(byId("p-baslik-1").status).toBe("unchanged");
        expect(summary.counts).toMatchObject({ changed: 4, added: 1, deleted: 1, notApplied: 1 });

        // ---- confirm: a new version through reviseDraft --------------------
        const saved = await importDocx(app, draft.draftId, edited, { fileSha256: summary.fileSha256 });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect(saved.body["version"]).toBe(2);
        expect(saved.body["import"].saved).toBe(true);
        const v2 = store.get(draft.draftId) as Draft;
        expect(v2.version).toBe(2);
        const para = (id: string) => v2.sections.flatMap((s) => s.paragraphs).find((p) => p.id === id);
        expect(para("p-aciklamalar-8")).toBeUndefined();
        expect(para("p-aciklamalar-7")?.text).toContain("tutanağa geçirilmiştir");
        expect(para("p-hukuki-sebepler-10")?.supported).toBe(false);
        expect(para("p-hukuki-sebepler-10")?.evidenceIds).toEqual([]);
        const sebepler = v2.sections.find((s) => s.id === "hukuki-sebepler");
        const typed = sebepler?.paragraphs.find((p) => p.text === "Davalının eylemi ayrıca haksız fiil niteliğindedir.");
        expect(typed?.supported).toBe(false);
        // The locked section is exactly as it was stored.
        expect(v2.sections.find((s) => s.id === "karsi-ictihat")).toEqual(
          draft.sections.find((s) => s.id === "karsi-ictihat"),
        );
        expect(v2.unsupportedCount).toBe(2);
        expect(v2.warnings.some((w) => w.startsWith("Düzenleme notu: Word'den geri yükleme (sürüm 1 DOCX)"))).toBe(true);
        expect((saved.body["issues"] as Array<{ code?: string }>).some((i) => i.code === "QUOTE_ALTERED")).toBe(true);

        // The saved version exports again — its dropped citation no longer claims the altered quote.
        const reexport = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`);
        expect(reexport.status).toBe(200);

        // ---- the same file again: the draft has moved on --------------------
        const stale = await importDocx(app, draft.draftId, edited);
        expect(stale.status).toBe(409);
        expect(stale.body["error"].kind).toBe("VERSION_CONFLICT");
        expect(stale.body["error"].message).toContain("1. sürümünden");
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    240_000,
  );

  it.skipIf(!HAVE_PYTHON)(
    "refuses a DOCX of another draft and a DOCX with no identity; a re-save keeps the identity",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "collex-docx-rt-"));
      try {
        const a = dava("dft-roundtrip-a");
        const b = dava("dft-roundtrip-b");
        const { app, store } = setup([a, b]);
        const docxB = await exportDocx(app, b.draftId);

        const other = await importDocx(app, a.draftId, docxB);
        expect(other.status).toBe(409);
        expect(other.body["error"].kind).toBe("DOCX_OTHER_DRAFT");
        expect(other.body["error"].message).toContain("başka bir taslağa ait");
        expect(other.body["error"].docxDraftId).toBe(b.draftId);

        // A Word document the lawyer wrote from scratch: no identity.
        const plainPath = join(workDir, "duz.docx");
        const made = await run([
          "-c",
          `import docx; d = docx.Document(); d.add_paragraph("Kendi dilekçem."); d.save(${JSON.stringify(plainPath)})`,
        ]);
        expect(made.code, made.stderr).toBe(0);
        const none = await importDocx(app, a.draftId, await readFile(plainPath));
        expect(none.status).toBe(422);
        expect(none.body["error"].kind).toBe("DOCX_IDENTITY_MISSING");
        expect(none.body["error"].message).toContain("ColleX taslak kimliği yok");

        // Word-like re-save (python-docx opens and saves): identity intact, no change.
        const resaved = await wordEdit(workDir, docxB, [{ op: "resave" }], "resave");
        const preview = await importDocx(app, b.draftId, resaved);
        expect(preview.status, JSON.stringify(preview.body)).toBe(200);
        expect(preview.body["import"].counts).toMatchObject({ changed: 0, added: 0, deleted: 0, notApplied: 0 });
        expect(preview.body["import"].ignoredLines).toEqual([]);
        expect(store.get(b.draftId)?.version).toBe(1);

        // The clean filing copy (NİHAİ) carries the same identity.
        const nihai = await exportDocx(app, b.draftId, "&annex=none&marks=none");
        const fromNihai = await importDocx(app, b.draftId, nihai);
        expect(fromNihai.status, JSON.stringify(fromNihai.body)).toBe(200);
        expect(fromNihai.body["import"].exportMode).toEqual({ annex: "none", marks: "none" });
        expect(fromNihai.body["import"].counts).toMatchObject({ changed: 0, added: 0, deleted: 0 });
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    240_000,
  );

  it.skipIf(!HAVE_PYTHON)(
    "keeps an unfilled placeholder as text, so the NİHAİ copy's placeholder refusal still sees it",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "collex-docx-rt-"));
      try {
        const base = composeDraft(minimalRequestFor("cevap-dilekcesi"), tckPack({ evidence: [] }), {
          now: () => new Date("2026-09-02T09:00:00.000Z"),
        });
        const draft = { ...base, draftId: "dft-roundtrip-yer" };
        const token = "[Usul itirazları — doldurun veya bu bölümü silin]";
        expect(draft.sections.some((s) => s.paragraphs.some((p) => p.text.includes(token)))).toBe(true);
        const { app, store } = setup([draft]);
        const exported = await exportDocx(app, draft.draftId);
        const edited = await wordEdit(
          workDir,
          exported,
          [{ op: "replace_in", contains: "Sentetik talep.", old: "Sentetik talep.", new: "Sentetik talep (düzeltildi)." }],
          "yer",
        );
        const preview = await importDocx(app, draft.draftId, edited);
        expect(preview.status, JSON.stringify(preview.body)).toBe(200);
        const saved = await importDocx(app, draft.draftId, edited, { fileSha256: preview.body["import"].fileSha256 });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const v2 = store.get(draft.draftId) as Draft;
        expect(v2.sections.some((s) => s.paragraphs.some((p) => p.text.includes(token)))).toBe(true);

        // The clean filing copy of the imported version is refused exactly as
        // before the round trip: the placeholder is still unfilled.
        const nihai = await app.request(`/v1/drafts/${draft.draftId}/export?format=docx&annex=none&marks=none`);
        expect(nihai.status).toBe(409);
        expect(((await nihai.json()) as { error: { code?: string } }).error.code).toBe(PLACEHOLDER_UNFILLED);
        // …while the TASLAK copy still exports (it prints the placeholder visibly).
        expect((await app.request(`/v1/drafts/${draft.draftId}/export?format=docx`)).status).toBe(200);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    240_000,
  );

  it.skipIf(HAVE_PYTHON)("SKIPPED: repo venv interpreter not found — real Word round trip not exercised", () => {
    expect(HAVE_PYTHON).toBe(false);
  });
});
