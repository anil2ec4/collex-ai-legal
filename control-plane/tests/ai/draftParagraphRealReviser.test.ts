/**
 * W21 · POST /v1/ai/draft-paragraph through the PRODUCT reviser
 * (drafting/revise.ts reviseDraft), not the id-preserving fake of
 * routes.test.ts.
 *
 * The reviser renames a paragraph whose id the stored draft does not know,
 * so on append / insertAfter the AI paragraph comes back under a fresh id.
 * The response's `kaynakli`, `paragraph` and the saved draft (paragraph
 * note, draft warnings) must all describe the paragraph as it was SAVED:
 * a binding the judge kept but the reviser rejected is never reported as
 * "kaynaklı", whichever way the paragraph was placed.
 */

import { describe, expect, it } from "vitest";

import { AI_ENV, createAiAdapter, resolveAiConfig } from "../../src/ai/config.js";
import {
  NOTE_AI_KAYNAKLI,
  NOTE_AI_KAYNAKSIZ_DUZENLEYICI,
  aiRevisionNote,
  locateRevisedParagraph,
  paragraphIds,
} from "../../src/ai/paragraph.js";
import { createAiRouter } from "../../src/ai/routes.js";
import type { AiDraftLike, ReviseFn } from "../../src/ai/types.js";
import { composeDraft } from "../../src/drafting/composer.js";
import { reviseDraft, type DraftPatch as DraftRevisePatch } from "../../src/drafting/revise.js";
import type { Draft } from "../../src/drafting/types.js";
import {
  davaRequest,
  karsitEvidence,
  tck158Evidence,
  tckEvidence,
  tckPack,
} from "../drafting/fixtures.js";
import { fakeAnthropic, type ReplyFn } from "./fakeAnthropic.js";
import { KEY } from "./fixtures.js";

const NOW = () => new Date("2026-09-02T11:00:00.000Z");
const MODEL = "claude-sonnet-5";
const SECTION = "hukuki-sebepler";
const TEXT = "5237 sayılı Kanun m. 157 uyarınca fiil dolandırıcılık suçunu oluşturur.";
const JUDGED_LINE = `Düzenleme notu: ${aiRevisionNote(MODEL, true)}`;
const FINAL_KAYNAKSIZ_LINE = `Düzenleme notu: ${aiRevisionNote(MODEL, false)}`;

/** The same adapter the server mounts (api/server.ts). */
const productRevise: ReviseFn = (draft, patch, opts) =>
  reviseDraft(draft as unknown as Draft, patch as unknown as DraftRevisePatch, opts) as unknown as ReturnType<ReviseFn>;

function composed(): AiDraftLike {
  return composeDraft(
    davaRequest(),
    tckPack({ evidence: [{ ...tckEvidence(), direction: "destekleyen" }, tck158Evidence(), karsitEvidence()] }),
    { now: NOW },
  ) as unknown as AiDraftLike;
}

async function write(
  evidenceIds: string[],
  placement: { paragraphId?: string; insertAfter?: string } = {},
) {
  const draft = composed();
  const idsBefore = paragraphIds(draft);
  const store = new Map<string, AiDraftLike>([[draft.draftId, draft]]);
  const config = resolveAiConfig({ [AI_ENV.apiKey]: KEY })!;
  const reply: ReplyFn = (body) => {
    const tool = body.tools[0]!.name;
    if (tool === "write_paragraph") return { toolInput: { text: TEXT, evidenceIds } };
    return { toolInput: { entails: true, score: 0.95, rationale: "uyuyor" } };
  };
  const fake = fakeAnthropic(reply);
  const adapter = createAiAdapter(config, fake.fetchImpl, { retryBaseDelayMs: 0, sleep: async () => {} });
  const app = createAiRouter({
    config,
    adapter,
    drafts: {
      get: (id) => store.get(id),
      put: (d) => {
        store.set(d.draftId, d);
      },
      warm: async () => {},
    },
    revise: productRevise,
    now: NOW,
    log: () => {},
  });
  const response = await app.request("/v1/ai/draft-paragraph", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftId: draft.draftId,
      sectionId: SECTION,
      instructions: "Yaz.",
      evidenceIds,
      useCloudAi: true,
      ...placement,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, any>;
  const saved = store.get(draft.draftId)!;
  const savedParagraph = saved.sections
    .find((s) => s.id === SECTION)!
    .paragraphs.find((p) => p.text === TEXT)!;
  return { draft, idsBefore, body, saved, savedParagraph };
}

function firstSebepParagraphId(): string {
  return composed().sections.find((s) => s.id === SECTION)!.paragraphs[0]!.id;
}

describe("W21 · draft-paragraph with the product reviser: `kaynakli` is the SAVED paragraph's state", () => {
  for (const [label, placement] of [
    ["append", {}],
    ["insertAfter", { insertAfter: firstSebepParagraphId() }],
  ] as const) {
    it(`${label}: the reviser renames the new paragraph and rejects the karşıt binding — never 'kaynaklı'`, async () => {
      const { idsBefore, body, saved, savedParagraph } = await write(["ev-karsit"], placement);
      // The reviser really did rename it (the case the id lookup alone missed).
      expect(idsBefore.has(savedParagraph.id)).toBe(false);
      expect(savedParagraph.id).not.toMatch(/-ai-/u);
      expect(savedParagraph.supported).toBe(false);
      expect(savedParagraph.note).toBe(NOTE_AI_KAYNAKSIZ_DUZENLEYICI);

      expect(body["kaynakli"]).toBe(false);
      expect(body["paragraph"]["id"]).toBe(savedParagraph.id);
      expect(body["paragraph"]["supported"]).toBe(false);
      expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ_DUZENLEYICI);
      // The judge's own verdict is still reported on the row.
      expect(body["entailment"].map((row: { kept: boolean }) => row.kept)).toEqual([true]);
      const warnings = body["warnings"] as string[];
      expect(warnings.some((w) => w.includes("kabul etmedi"))).toBe(true);
      expect(warnings.some((w) => w.includes("taslakta bırakmadı") || w.includes("bulunamadı"))).toBe(false);

      // The draft's revision note says what was saved, not what the judge said.
      expect(saved.warnings).not.toContain(JUDGED_LINE);
      expect(saved.warnings).toContain(FINAL_KAYNAKSIZ_LINE);
      expect(body["draft"]["warnings"]).toEqual(saved.warnings);
    });
  }

  it("replace in place: same verdict, and the draft warning no longer says '— kaynaklı'", async () => {
    const paragraphId = firstSebepParagraphId();
    const { body, saved, savedParagraph } = await write(["ev-karsit"], { paragraphId });
    expect(savedParagraph.id).toBe(paragraphId);
    expect(savedParagraph.supported).toBe(false);
    expect(savedParagraph.note).toBe(NOTE_AI_KAYNAKSIZ_DUZENLEYICI);
    expect(body["kaynakli"]).toBe(false);
    expect(body["paragraph"]["note"]).toBe(NOTE_AI_KAYNAKSIZ_DUZENLEYICI);
    expect(saved.warnings).not.toContain(JUDGED_LINE);
    expect(saved.warnings).toContain(FINAL_KAYNAKSIZ_LINE);
  });

  it("partial: the reviser keeps the supporting binding and drops the karşıt one — sourced, and the dropped one is named", async () => {
    const paragraphId = firstSebepParagraphId();
    const { body, saved, savedParagraph } = await write(["ev-tck157", "ev-karsit"], { paragraphId });
    expect(savedParagraph.supported).toBe(true);
    expect(savedParagraph.evidenceIds).toEqual(["ev-tck157"]);
    expect(savedParagraph.note).toBe(NOTE_AI_KAYNAKLI);
    expect(body["kaynakli"]).toBe(true);
    expect(body["paragraph"]["evidenceIds"]).toEqual(["ev-tck157"]);
    const warnings = body["warnings"] as string[];
    const dropped = warnings.find((w) => w.includes("dayanak kurallarınca kabul edilmedi"));
    expect(dropped).toBeDefined();
    expect(dropped).toContain("ev-karsit");
    expect(dropped).not.toContain("ev-tck157");
    expect(saved.warnings).toContain(JUDGED_LINE);
  });

  for (const [label, placement] of [
    ["append", {}],
    ["insertAfter", { insertAfter: firstSebepParagraphId() }],
  ] as const) {
    it(`non-vacuity (${label}): an accepted binding on a renamed paragraph is sourced, with the AI note on the SAVED paragraph`, async () => {
      const { idsBefore, body, saved, savedParagraph } = await write(["ev-tck157"], placement);
      expect(idsBefore.has(savedParagraph.id)).toBe(false);
      expect(savedParagraph.supported).toBe(true);
      expect(savedParagraph.evidenceIds).toEqual(["ev-tck157"]);
      expect(savedParagraph.note).toBe(NOTE_AI_KAYNAKLI);
      expect(body["kaynakli"]).toBe(true);
      expect(body["paragraph"]["id"]).toBe(savedParagraph.id);
      expect(body["paragraph"]["supported"]).toBe(true);
      expect((body["warnings"] as string[]).some((w) => w.includes("kabul etmedi") || w.includes("kabul edilmedi"))).toBe(false);
      expect(saved.warnings).toContain(JUDGED_LINE);
      expect(saved.warnings).not.toContain(FINAL_KAYNAKSIZ_LINE);
    });
  }
});

describe("W21 · a paragraph the reviser did not leave in the draft is never reported as sourced", () => {
  it("judge kept the binding, reviser dropped the paragraph: kaynakli:false, supported:false, both notes say so", async () => {
    const draft = composed();
    const store = new Map<string, AiDraftLike>([[draft.draftId, draft]]);
    const config = resolveAiConfig({ [AI_ENV.apiKey]: KEY })!;
    const fake = fakeAnthropic((body) =>
      body.tools[0]!.name === "write_paragraph"
        ? { toolInput: { text: TEXT, evidenceIds: ["ev-tck157"] } }
        : { toolInput: { entails: true, score: 0.95, rationale: "uyuyor" } },
    );
    // A reviser that saves the draft (with the patch note line) but not the new paragraph.
    const dropping: ReviseFn = (d, patch) => {
      const next = structuredClone(d);
      next.version = (d.version ?? 1) + 1;
      next.warnings = [...next.warnings, `Düzenleme notu: ${patch.note}`];
      return { draft: next, issues: [] };
    };
    const app = createAiRouter({
      config,
      adapter: createAiAdapter(config, fake.fetchImpl, { retryBaseDelayMs: 0, sleep: async () => {} }),
      drafts: { get: (id) => store.get(id), put: (d) => { store.set(d.draftId, d); }, warm: async () => {} },
      revise: dropping,
      now: NOW,
      log: () => {},
    });
    const response = await app.request("/v1/ai/draft-paragraph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.draftId, sectionId: SECTION, instructions: "Yaz.", evidenceIds: ["ev-tck157"], useCloudAi: true }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body["entailment"].map((row: { kept: boolean }) => row.kept)).toEqual([true]);
    expect(body["kaynakli"]).toBe(false);
    expect(body["paragraph"]["supported"]).toBe(false);
    expect((body["warnings"] as string[]).some((w) => w.includes("paragraf kaynaklı sayılmadı"))).toBe(true);
    const saved = store.get(draft.draftId)!;
    expect(saved.warnings).not.toContain(JUDGED_LINE);
    expect(saved.warnings).toContain(FINAL_KAYNAKSIZ_LINE);
  });
});

describe("W21 · locateRevisedParagraph fails closed", () => {
  const draft = (paragraphs: Array<{ id: string; text: string }>): AiDraftLike =>
    ({
      draftId: "d",
      title: "t",
      kind: "dilekce",
      version: 2,
      sections: [
        {
          id: "s",
          title: "S",
          paragraphs: paragraphs.map((p) => ({ ...p, evidenceIds: [], supported: false, role: "hukukiSebepler" })),
        },
      ],
      evidence: [],
      unsupportedCount: 0,
      warnings: [],
    }) as unknown as AiDraftLike;

  it("by id first; else the one new paragraph of the section carrying the sent text; else undefined", () => {
    const before = new Set(["p-1"]);
    const target = { sectionId: "s", paragraphId: "p-s-ai-1", text: "AI metni" };
    expect(locateRevisedParagraph(draft([{ id: "p-1", text: "x" }, { id: "p-s-ai-1", text: "AI metni" }]), before, target)?.paragraph.id).toBe("p-s-ai-1");
    expect(locateRevisedParagraph(draft([{ id: "p-1", text: "x" }, { id: "p-s-u1", text: "AI metni" }, { id: "p-s-u2", text: "yer tutucu" }]), before, target)?.paragraph.id).toBe("p-s-u1");
    // Gone, or two candidates: nobody is guessed.
    expect(locateRevisedParagraph(draft([{ id: "p-1", text: "x" }]), before, target)).toBeUndefined();
    expect(locateRevisedParagraph(draft([{ id: "p-s-u1", text: "AI metni" }, { id: "p-s-u2", text: "AI metni" }]), before, target)).toBeUndefined();
    // An old paragraph that happens to carry the same text is not the new one.
    expect(locateRevisedParagraph(draft([{ id: "p-1", text: "AI metni" }]), before, target)).toBeUndefined();
  });
});
