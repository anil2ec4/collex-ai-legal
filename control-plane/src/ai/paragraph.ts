/**
 * Server-side AI paragraph writer (POST /v1/ai/draft-paragraph) — the
 * evidence-binding half.
 *
 * The model writes ONE paragraph and names the evidence ids it relied on.
 * The server then judges, per cited evidence, whether the passage actually
 * entails the paragraph (EntailmentPort.assess) and STRIPS every id whose
 * score is below the finalization threshold. If nothing survives, the
 * paragraph is KAYNAKSIZ — kept, visibly marked, counted — never silently
 * promoted to a sourced paragraph.
 *
 * The threshold is the same number verification/finalize.ts uses
 * (ENTAILMENT_THRESHOLD = 0.85); it is re-declared here per the wave rule
 * (no cross-lane imports) and pinned by a test against the original.
 */

import { randomUUID } from "node:crypto";
import type { EvidenceRef } from "../evidence/types.js";
import type {
  AiDraftEvidence,
  AiDraftLike,
  AiDraftParagraph,
  AiDraftSection,
  DraftPatch,
  DraftPatchParagraph,
  ReviseIssue,
} from "./types.js";

/** Mirrors verification/finalize.ts ENTAILMENT_THRESHOLD (pinned by a test). */
export const ENTAILMENT_THRESHOLD = 0.85;

/** Mirrors drafting/types.ts NOTE_KAYNAKSIZ (pinned by a test). */
export const NOTE_KAYNAKSIZ = "KAYNAKSIZ — hukukî dayanak doğrulanmadı; avukat eklemeli";

/** Note on an AI paragraph whose evidence survived the entailment judge. */
export const NOTE_AI_KAYNAKLI = "AI taslak — kaynak bağı entailment ile doğrulandı (≥%85)";

/** Note on an AI paragraph that lost every citation to the judge. */
export const NOTE_AI_KAYNAKSIZ =
  "KAYNAKSIZ — AI taslak; hiçbir kanıt entailment eşiğini (≥%85) geçmedi; avukat eklemeli";

/** Draft-level warning appended by every AI revision. */
export const WARNING_AI_PARAGRAPH =
  "Bu taslakta bulut yapay zekâ (Anthropic) tarafından yazılmış paragraf var; " +
  "kaynak bağları entailment ile doğrulandı, metin avukat incelemesi olmadan kullanılamaz.";

export interface EntailmentRow {
  evidenceId: string;
  score: number;
  entails: boolean;
  rationale: string;
  /** true iff score is a usable probability ≥ threshold AND entails. */
  kept: boolean;
}

/** Fail closed: NaN/Infinity/out-of-range never pass (finalize.ts rule). */
export function isUsableScore(score: number): boolean {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1;
}

export function judgeRow(
  evidenceId: string,
  judgement: { score: number; entails: boolean; rationale: string },
): EntailmentRow {
  const kept =
    judgement.entails && isUsableScore(judgement.score) && judgement.score >= ENTAILMENT_THRESHOLD;
  return {
    evidenceId,
    score: judgement.score,
    entails: judgement.entails,
    rationale: judgement.rationale,
    kept,
  };
}

/** EvidenceRef-shaped view of a draft evidence entry for the judge port. */
export function toEvidenceRef(entry: AiDraftEvidence, retrievedAt: string): EvidenceRef {
  return {
    evidenceId: entry.evidenceId,
    documentId: "",
    documentVersionId: "",
    chunkId: "",
    source: entry.source,
    sourceUrl: "",
    title: entry.title,
    ...(entry.court !== undefined ? { court: entry.court } : {}),
    ...(entry.decisionDate !== undefined ? { decisionDate: entry.decisionDate } : {}),
    ...(entry.docketNo !== undefined ? { docketNo: entry.docketNo } : {}),
    ...(entry.decisionNo !== undefined ? { decisionNo: entry.decisionNo } : {}),
    ...(entry.legislationNo !== undefined ? { legislationNo: entry.legislationNo } : {}),
    locator: {
      ...(entry.article !== undefined ? { article: entry.article } : {}),
      startChar: 0,
      endChar: 0,
    },
    quote: entry.quote,
    quoteSha256: entry.quoteSha256,
    contentSha256: entry.contentSha256,
    retrievedAt,
  };
}

export interface ParagraphTarget {
  sectionId: string;
  /** Replace this paragraph in place. */
  paragraphId?: string;
  /** Insert after this paragraph (omit both = append to the section). */
  insertAfter?: string;
}

/** The slot role of the new paragraph: inherit from its neighbour. */
export function pickRole(section: AiDraftSection, target: ParagraphTarget): string {
  const anchorId = target.paragraphId ?? target.insertAfter;
  if (anchorId !== undefined) {
    const anchor = section.paragraphs.find((p) => p.id === anchorId);
    if (anchor !== undefined) return anchor.role;
  }
  const last = section.paragraphs[section.paragraphs.length - 1];
  return last?.role ?? "hukukiDegerlendirme";
}

export function newParagraphId(sectionId: string): string {
  return `p-${sectionId}-ai-${randomUUID().slice(0, 8)}`;
}

/** Existing paragraphs re-enter the patch with their own binding preserved. */
function toPatchParagraph(paragraph: AiDraftParagraph): DraftPatchParagraph {
  const binding = paragraph.binding;
  const preserved =
    binding !== null &&
    typeof binding === "object" &&
    (binding as { kind?: unknown }).kind === "entailment"
      ? (binding as { kind: "entailment"; score: number; judge: string })
      : "lexical";
  return {
    id: paragraph.id,
    text: paragraph.text,
    evidenceIds: [...paragraph.evidenceIds],
    role: paragraph.role,
    binding: preserved,
    ...(paragraph.note !== undefined ? { note: paragraph.note } : {}),
    supported: paragraph.supported,
  };
}

/**
 * Build the full PUT-style patch: every section of the draft, with the
 * target section's paragraph list replaced/extended by the new paragraph.
 * Returns issues (and no patch) when the target cannot be located.
 */
export function buildParagraphPatch(
  draft: AiDraftLike,
  target: ParagraphTarget,
  paragraph: DraftPatchParagraph,
  note: string,
): { patch?: DraftPatch; issues: ReviseIssue[] } {
  const section = draft.sections.find((s) => s.id === target.sectionId);
  if (section === undefined) {
    return {
      issues: [{ path: "sectionId", message: `Taslakta '${target.sectionId}' kimlikli bölüm yok.` }],
    };
  }
  const existing = section.paragraphs.map(toPatchParagraph);
  let paragraphs: DraftPatchParagraph[];
  if (target.paragraphId !== undefined) {
    const index = existing.findIndex((p) => p.id === target.paragraphId);
    if (index === -1) {
      return {
        issues: [
          { path: "paragraphId", message: `Bölümde '${target.paragraphId}' kimlikli paragraf yok.` },
        ],
      };
    }
    paragraphs = [...existing];
    paragraphs[index] = paragraph;
  } else if (target.insertAfter !== undefined) {
    const index = existing.findIndex((p) => p.id === target.insertAfter);
    if (index === -1) {
      return {
        issues: [
          { path: "insertAfter", message: `Bölümde '${target.insertAfter}' kimlikli paragraf yok.` },
        ],
      };
    }
    paragraphs = [...existing.slice(0, index + 1), paragraph, ...existing.slice(index + 1)];
  } else {
    paragraphs = [...existing, paragraph];
  }

  const patch: DraftPatch = {
    sections: draft.sections.map((s) =>
      s.id === section.id
        ? { id: s.id, paragraphs }
        : { id: s.id, paragraphs: s.paragraphs.map(toPatchParagraph) },
    ),
    note,
  };
  return { patch, issues: [] };
}

/** Locate a paragraph by id anywhere in a draft. */
export function findParagraph(
  draft: AiDraftLike,
  paragraphId: string,
): { section: AiDraftSection; paragraph: AiDraftParagraph } | undefined {
  for (const section of draft.sections) {
    const paragraph = section.paragraphs.find((p) => p.id === paragraphId);
    if (paragraph !== undefined) return { section, paragraph };
  }
  return undefined;
}

/** Recount KAYNAKSIZ paragraphs after a note/supported adjustment. */
export function recountUnsupported(draft: AiDraftLike): number {
  return draft.sections.reduce(
    (count, section) => count + section.paragraphs.filter((p) => !p.supported).length,
    0,
  );
}
