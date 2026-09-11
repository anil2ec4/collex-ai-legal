/**
 * Paragraph evidence binding: the re-declared constants are pinned to their
 * originals, the threshold fails closed, and the PUT-style patch is built
 * around the right anchor.
 */

import { describe, expect, it } from "vitest";

import {
  ENTAILMENT_THRESHOLD,
  NOTE_KAYNAKSIZ,
  buildParagraphPatch,
  judgeRow,
  pickRole,
  recountUnsupported,
  toEvidenceRef,
} from "../../src/ai/paragraph.js";
import { LOCAL_TENANT_ID } from "../../src/ai/routes.js";
import type { AiDraftLike, DraftPatchParagraph } from "../../src/ai/types.js";
import { ENTAILMENT_THRESHOLD as FINALIZE_THRESHOLD } from "../../src/verification/finalize.js";
import {
  LOCAL_TENANT_ID as DRAFTING_TENANT_ID,
  NOTE_KAYNAKSIZ as DRAFTING_NOTE_KAYNAKSIZ,
} from "../../src/drafting/types.js";

function draft(): AiDraftLike {
  return {
    draftId: "dft-1",
    kind: "dilekce",
    title: "Dava Dilekçesi",
    version: 1,
    sections: [
      {
        id: "hd",
        title: "HUKUKÎ DEĞERLENDİRME",
        paragraphs: [
          { id: "p1", text: "bir", evidenceIds: [], supported: true, role: "hukukiDegerlendirme", note: "beyan" },
          {
            id: "p2",
            text: "iki",
            evidenceIds: ["ev-1"],
            supported: true,
            role: "hukukiDegerlendirme",
            binding: { kind: "entailment", score: 0.9, judge: "claude-sonnet-5" },
          },
        ],
      },
      { id: "imza", title: "", paragraphs: [{ id: "s1", text: "imza", evidenceIds: [], supported: true, role: "imza" }] },
    ],
    evidence: [],
    unsupportedCount: 0,
    warnings: [],
  };
}

const NEW: DraftPatchParagraph = { id: "p-ai", text: "yeni", evidenceIds: [], role: "hukukiDegerlendirme" };

describe("re-declared constants stay pinned to their originals", () => {
  it("ENTAILMENT_THRESHOLD, NOTE_KAYNAKSIZ and LOCAL_TENANT_ID", () => {
    expect(ENTAILMENT_THRESHOLD).toBe(FINALIZE_THRESHOLD);
    expect(ENTAILMENT_THRESHOLD).toBe(0.85);
    expect(NOTE_KAYNAKSIZ).toBe(DRAFTING_NOTE_KAYNAKSIZ);
    expect(LOCAL_TENANT_ID).toBe(DRAFTING_TENANT_ID);
  });
});

describe("judgeRow fails closed", () => {
  it("keeps only usable scores at/above the threshold with entails:true", () => {
    expect(judgeRow("e", { score: 0.85, entails: true, rationale: "" }).kept).toBe(true);
    expect(judgeRow("e", { score: 0.849, entails: true, rationale: "" }).kept).toBe(false);
    expect(judgeRow("e", { score: 0.99, entails: false, rationale: "" }).kept).toBe(false);
    expect(judgeRow("e", { score: Number.NaN, entails: true, rationale: "" }).kept).toBe(false);
    expect(judgeRow("e", { score: Number.POSITIVE_INFINITY, entails: true, rationale: "" }).kept).toBe(false);
    expect(judgeRow("e", { score: 1.5, entails: true, rationale: "" }).kept).toBe(false);
  });
});

describe("buildParagraphPatch", () => {
  it("appends, inserts after, replaces in place — and preserves existing bindings", () => {
    const appended = buildParagraphPatch(draft(), { sectionId: "hd" }, NEW, "not").patch!;
    expect(appended.sections.map((s) => s.id)).toEqual(["hd", "imza"]);
    expect(appended.sections[0]!.paragraphs.map((p) => p.id)).toEqual(["p1", "p2", "p-ai"]);
    expect(appended.sections[0]!.paragraphs[0]!.binding).toBe("lexical");
    expect(appended.sections[0]!.paragraphs[1]!.binding).toEqual({
      kind: "entailment",
      score: 0.9,
      judge: "claude-sonnet-5",
    });
    expect(appended.note).toBe("not");

    const inserted = buildParagraphPatch(draft(), { sectionId: "hd", insertAfter: "p1" }, NEW, "").patch!;
    expect(inserted.sections[0]!.paragraphs.map((p) => p.id)).toEqual(["p1", "p-ai", "p2"]);

    const replaced = buildParagraphPatch(draft(), { sectionId: "hd", paragraphId: "p2" }, NEW, "").patch!;
    expect(replaced.sections[0]!.paragraphs.map((p) => p.id)).toEqual(["p1", "p-ai"]);
  });

  it("reports unknown targets as issues instead of guessing", () => {
    expect(buildParagraphPatch(draft(), { sectionId: "yok" }, NEW, "").issues[0]!.path).toBe("sectionId");
    expect(buildParagraphPatch(draft(), { sectionId: "hd", paragraphId: "yok" }, NEW, "").issues[0]!.path).toBe("paragraphId");
    expect(buildParagraphPatch(draft(), { sectionId: "hd", insertAfter: "yok" }, NEW, "").issues[0]!.path).toBe("insertAfter");
  });
});

describe("helpers", () => {
  it("pickRole inherits the anchor's role, then the last paragraph's, then a legal default", () => {
    const section = draft().sections[0]!;
    expect(pickRole(section, { sectionId: "hd", paragraphId: "p1" })).toBe("hukukiDegerlendirme");
    expect(pickRole({ id: "x", title: "", paragraphs: [] }, { sectionId: "x" })).toBe("hukukiDegerlendirme");
    expect(pickRole(draft().sections[1]!, { sectionId: "imza" })).toBe("imza");
  });

  it("recountUnsupported and toEvidenceRef", () => {
    const d = draft();
    d.sections[0]!.paragraphs[0]!.supported = false;
    expect(recountUnsupported(d)).toBe(1);
    const ref = toEvidenceRef(
      {
        evidenceId: "ev-1",
        label: "L",
        source: "MEVZUAT",
        title: "T",
        article: "157",
        quote: "q",
        quoteSha256: "a",
        contentSha256: "b",
      },
      "2026-09-02T00:00:00.000Z",
    );
    expect(ref.evidenceId).toBe("ev-1");
    expect(ref.locator).toEqual({ article: "157", startChar: 0, endChar: 0 });
    expect(ref.quote).toBe("q");
  });
});
