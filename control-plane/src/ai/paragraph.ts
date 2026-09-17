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
 * W21 R2-29: an id whose judgement is unreadable or self-contradicting is
 * NOT CHECKED (uncheckedRow): stripped like a shortfall, but its row says it
 * was not checked instead of carrying a measured score, and the rest of the
 * paragraph survives. A paragraph left with no citation because of it carries
 * NOTE_AI_KAYNAKSIZ_DENETLENEMEDI (not the measured-shortfall note) and the
 * draft gets WARNING_AI_PARAGRAPH_UNCHECKED (aiParagraphNote /
 * aiParagraphDraftWarnings).
 *
 * The reviser's verdict is authoritative: when it rejects a binding the judge
 * kept, the paragraph is KAYNAKSIZ with NOTE_AI_KAYNAKSIZ_DUZENLEYICI (not the
 * "no evidence passed" note) and the response's `kaynakli` is false. W21: the
 * verdict is read off the paragraph as SAVED, which the product reviser may
 * have renamed on append / insertAfter (locateRevisedParagraph); a paragraph
 * that cannot be found there is never reported as sourced.
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

/**
 * W21: note on an AI paragraph whose binding the judge KEPT but the stricter
 * reviser (drafting/revise.ts, e.g. karşıt or uploaded evidence under a legal
 * role) rejected. The reviser's verdict stands and the paragraph is
 * KAYNAKSIZ, but NOTE_AI_KAYNAKSIZ would say that no evidence passed the
 * threshold, which is not what happened.
 */
export const NOTE_AI_KAYNAKSIZ_DUZENLEYICI =
  "KAYNAKSIZ — AI taslak; entailment eşiğini (≥%85) geçen kanıt bağı taslağın dayanak " +
  "kurallarınca kabul edilmedi; avukat eklemeli";

/** Draft-level warning appended by every AI revision. */
export const WARNING_AI_PARAGRAPH =
  "Bu taslakta bulut yapay zekâ (Anthropic) tarafından yazılmış paragraf var; " +
  "kaynak bağları entailment ile doğrulandı, metin avukat incelemesi olmadan kullanılamaz.";

/**
 * W21 R2-29: note on an AI paragraph that kept no citation while at least one
 * binding could NOT be checked. NOTE_AI_KAYNAKSIZ says the evidence was
 * measured and fell short of the threshold; for a binding the judge gave no
 * usable answer on, that would record a measurement that never happened.
 */
export const NOTE_AI_KAYNAKSIZ_DENETLENEMEDI =
  "KAYNAKSIZ — AI taslak; kanıt bağlarından en az biri denetlenemedi (hakemin yanıtı okunamadı), " +
  "hiçbir kanıt bağı paragrafa yazılmadı; avukat eklemeli";

/**
 * W21 R2-29: draft-level warning for an AI paragraph with a binding the judge
 * could not check. It stands beside WARNING_AI_PARAGRAPH (which says the
 * bindings were checked by entailment) and replaces it when nothing was kept.
 */
export const WARNING_AI_PARAGRAPH_UNCHECKED =
  "Bu taslakta bulut yapay zekâ (Anthropic) tarafından yazılmış ve kanıt bağlarından en az biri " +
  "denetlenemeyen paragraf var; denetlenemeyen bağlar paragrafa yazılmadı ve doğrulanmış sayılmaz, " +
  "metin avukat incelemesi olmadan kullanılamaz.";

export interface EntailmentRow {
  evidenceId: string;
  score: number;
  entails: boolean;
  rationale: string;
  /** true iff score is a usable probability ≥ threshold AND entails. */
  kept: boolean;
  /**
   * W21 R2-29: false when the judge gave NO usable answer for this evidence
   * id (a malformed or self-contradicting reply). Its `score` is then a
   * placeholder 0, not a measurement, and the binding is never kept. Absent
   * on a row the judge actually scored.
   */
  checked?: false;
}

/** Rationale of a binding the judge could not check (R2-29). */
export const RATIONALE_JUDGE_UNREADABLE_TR =
  "denetlenemedi — hakemin yanıtı okunamadı ya da kendi içinde çelişkiliydi; " +
  "bu kanıt bağı paragrafa yazılmadı";

/**
 * The row for an evidence id whose judgement could not be read. Fail closed:
 * the binding is not kept, and the row says it was NOT checked rather than
 * posing as a measured shortfall.
 */
export function uncheckedRow(evidenceId: string): EntailmentRow {
  return {
    evidenceId,
    score: 0,
    entails: false,
    rationale: RATIONALE_JUDGE_UNREADABLE_TR,
    kept: false,
    checked: false,
  };
}

/**
 * The note an AI paragraph carries, from its judge rows. A kept binding makes
 * it sourced; with nothing kept, an unchecked binding (R2-29) gets the
 * "denetlenemedi" note, never the measured-shortfall NOTE_AI_KAYNAKSIZ.
 */
export function aiParagraphNote(rows: readonly EntailmentRow[]): string {
  if (rows.some((row) => row.kept)) return NOTE_AI_KAYNAKLI;
  return rows.some((row) => row.checked === false) ? NOTE_AI_KAYNAKSIZ_DENETLENEMEDI : NOTE_AI_KAYNAKSIZ;
}

/**
 * Draft-level warnings an AI revision adds, from its judge rows (R2-29).
 * WARNING_AI_PARAGRAPH ("kaynak bağları entailment ile doğrulandı") is left
 * out when nothing was kept and a binding went unchecked: no check happened
 * that it could describe. Any unchecked binding adds the unchecked warning.
 */
export function aiParagraphDraftWarnings(rows: readonly EntailmentRow[]): string[] {
  const anyKept = rows.some((row) => row.kept);
  const anyUnchecked = rows.some((row) => row.checked === false);
  const out: string[] = [];
  if (anyKept || !anyUnchecked) out.push(WARNING_AI_PARAGRAPH);
  if (anyUnchecked) out.push(WARNING_AI_PARAGRAPH_UNCHECKED);
  return out;
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

/** Every paragraph id a draft holds (taken BEFORE revising, for locateRevisedParagraph). */
export function paragraphIds(draft: AiDraftLike): Set<string> {
  return new Set(draft.sections.flatMap((section) => section.paragraphs.map((p) => p.id)));
}

/**
 * W21: find the AI paragraph in the REVISED draft. A replace keeps its id. A
 * new paragraph (append / insertAfter) can come back under another id: the
 * product reviser (drafting/revise.ts) gives every id the stored draft does
 * not know a fresh one. It is then the one paragraph of the target section
 * whose id the pre-revise draft did not have and whose text is the text that
 * was sent (the reviser's own additions, such as a sebepler placeholder,
 * carry other text). None, or more than one: undefined — the caller must not
 * call the paragraph sourced.
 */
export function locateRevisedParagraph(
  revised: AiDraftLike,
  idsBefore: ReadonlySet<string>,
  target: { sectionId: string; paragraphId: string; text: string },
): { section: AiDraftSection; paragraph: AiDraftParagraph } | undefined {
  const byId = findParagraph(revised, target.paragraphId);
  if (byId !== undefined) return byId;
  const section = revised.sections.find((s) => s.id === target.sectionId);
  if (section === undefined) return undefined;
  const added = section.paragraphs.filter((p) => !idsBefore.has(p.id) && p.text === target.text);
  return added.length === 1 ? { section, paragraph: added[0] as AiDraftParagraph } : undefined;
}

/**
 * The revision note the AI writer hands the reviser; the reviser copies it
 * into the draft's warnings as "Düzenleme notu: …". W21: it is rewritten to
 * the KAYNAKSIZ form when the saved paragraph did not end up sourced.
 */
export function aiRevisionNote(model: string, sourced: boolean): string {
  return `AI paragraf (${model}) — ${sourced ? "kaynaklı" : "KAYNAKSIZ"}`;
}

/** Recount KAYNAKSIZ paragraphs after a note/supported adjustment. */
export function recountUnsupported(draft: AiDraftLike): number {
  return draft.sections.reduce(
    (count, section) => count + section.paragraphs.filter((p) => !p.supported).length,
    0,
  );
}
