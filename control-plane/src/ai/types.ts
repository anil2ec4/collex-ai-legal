/**
 * Structural (local) types the cloud-AI lane depends on.
 *
 * W12 rule: lanes do not import modules other lanes are creating in the same
 * wave. The files store (lane F), the draft store (lanes A/C) and lane C's
 * `reviseDraft` are therefore consumed through these local shapes, which
 * mirror the shared contract text ([P], [D]) and are satisfied structurally
 * by the real implementations at integration time. Nothing here is exported
 * over HTTP as-is; the wire shapes live in analysis.ts / ocr.ts / routes.ts.
 */

/** One chunk of an uploaded (tenant) document — mirrors DraftFileChunk. */
export interface AiFileChunk {
  fileId: string;
  fileName: string;
  chunkId: string;
  ordinal: number;
  /** Exact canonical chunk text (code-point offsets into the file text). */
  text: string;
  startChar: number;
  endChar: number;
  /** SHA-256 hex over the UTF-8 bytes of the file's full extracted text. */
  contentSha256: string;
}

/** The slice of the files store this lane reads through. */
export interface AiFilesPort {
  getChunks(fileIds: readonly string[], tenantId: string): Promise<AiFileChunk[]>;
  showFile?(fileId: string): Promise<unknown>;
}

/** Paragraph shape shared by Draft (lane C) and the revise patch. */
export interface AiDraftParagraph {
  id: string;
  text: string;
  evidenceIds: string[];
  supported: boolean;
  note?: string;
  role: string;
  /** Lane C additive: how the evidence binding was established. */
  binding?: unknown;
}

export interface AiDraftSection {
  id: string;
  title: string;
  paragraphs: AiDraftParagraph[];
}

/** Mirrors DraftEvidence (drafting/types.ts) — the fields this lane uses. */
export interface AiDraftEvidence {
  evidenceId: string;
  label: string;
  source: string;
  title: string;
  court?: string;
  decisionDate?: string;
  docketNo?: string;
  decisionNo?: string;
  legislationNo?: string;
  article?: string;
  quote: string;
  quoteSha256: string;
  contentSha256: string;
  direction?: string;
}

/** The slice of a Draft the paragraph writer reads and patches. */
export interface AiDraftLike {
  draftId: string;
  kind: string;
  title: string;
  sections: AiDraftSection[];
  evidence: AiDraftEvidence[];
  unsupportedCount: number;
  warnings: string[];
  /** Lane C additive: 1 for new drafts; every revision increments. */
  version?: number;
}

/** Draft persistence slice (contract [P]; warm() loads a missing id). */
export interface AiDraftStore {
  get(draftId: string): AiDraftLike | undefined;
  put(draft: AiDraftLike): void;
  warm?(draftId: string): Promise<void>;
  /** Additive (W12-FIX): outcome of the last `put` (a memory store answers true). */
  persisted?(draftId: string): Promise<boolean>;
}

/** Contract [D]: paragraph binding inside a PUT /v1/drafts/{id} patch. */
export type DraftPatchBinding =
  | "lexical"
  | { kind: "entailment"; score: number; judge: string };

export interface DraftPatchParagraph {
  id: string;
  text: string;
  evidenceIds: string[];
  role: string;
  binding?: DraftPatchBinding;
  /** Additive hints; lane C may honour or recompute them. */
  note?: string;
  supported?: boolean;
}

export interface DraftPatch {
  sections: Array<{ id: string; paragraphs: DraftPatchParagraph[] }>;
  evidenceUse?: Record<string, boolean>;
  note?: string;
}

export interface ReviseIssue {
  path: string;
  message: string;
}

/** Lane C's exported reviseDraft, injected (contract [D]). */
export type ReviseFn = (
  draft: AiDraftLike,
  patch: DraftPatch,
  opts: { trustEntailment: boolean; now: () => Date },
) => { draft: AiDraftLike; issues: ReviseIssue[] };
