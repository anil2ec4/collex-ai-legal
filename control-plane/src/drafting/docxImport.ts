/**
 * "Word'de düzelttim, geri yükle" (W22) — a VERIFIED Word round trip.
 *
 *   POST /v1/drafts/{id}/import-docx   multipart: file (+ confirm, previewFingerprint)
 *
 * Competitors ship a Word add-in. ColleX instead embeds a hidden,
 * tamper-evident identity in every DOCX it exports
 * (`export/draft_identity.py`: a custom XML part carrying the draft id, the
 * version, every rendered paragraph's id + canonical-text sha256 + the
 * `quoteSha256` of each quote it cites, plus hidden `_cxp<n>` bookmarks around
 * every paragraph's text) and, when the edited file comes back:
 *
 *  1. runs the SAME upload quarantine as `/v1/files` (25 MiB cap here and in
 *     `intake/quarantine.py`, magic-byte sniff, ZIP-bomb caps) in the Python
 *     read-back, which returns the identity, whether its digest still holds,
 *     and the body as it reads with every tracked change ACCEPTED — and how
 *     many tracked changes are still pending, so the lawyer is TOLD;
 *  2. refuses, in Turkish and typed, a DOCX with no identity, with an edited
 *     identity, of ANOTHER draft, of an older version, or whose identity does
 *     not describe this draft's stored text;
 *  3. aligns every Word paragraph back to the draft — by its hidden bookmark
 *     where present, by text otherwise — and returns a per-paragraph diff
 *     (unchanged / changed / added / deleted) WITHOUT saving; the diff already
 *     carries each paragraph's gate outcome, computed by a dry run of the one
 *     revise function (`reviseDraft` is pure);
 *  4. on the lawyer's confirm (the same file again, with `confirm=true` and
 *     the preview's `fileSha256` as `previewFingerprint`) saves a new version through
 *     `reviseDraft` — so the quote-integrity gate (QUOTE_ALTERED), the
 *     KAYNAKSIZ discipline and every other rule run UNCHANGED. The locked
 *     sections (`ek-dogrulama`, `karsi-ictihat`) are never edited this way:
 *     their edits are reported and not applied. Placeholder text survives the
 *     round trip as text, so the NİHAİ copy's placeholder refusal still sees
 *     it.
 *
 * Nothing here softens a gate. The identity grants nothing a console save
 * (`PUT /v1/drafts/{id}`) would not; it only makes sure the diff is computed
 * against the draft the file really came from.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { MAX_UPLOAD_BYTES, UPLOAD_CAP_MIB, safeUploadName } from "../files/routes.js";
import { DraftValidationError } from "./composer.js";
import { canonicalQuoteText } from "./quoteIntegrity.js";
import { reviseDraft, type DraftPatch, type DraftPatchParagraph, type ReviseIssue } from "./revise.js";
import type { DraftStore } from "./store.js";
import {
  EK_DOGRULAMA_SECTION_ID,
  KARSI_ICTIHAT_SECTION_ID,
  type Draft,
  type DraftParagraph,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants and Turkish sentences
// ---------------------------------------------------------------------------

/** Sections a Word round trip may never edit (same set as the AI lane's). */
export const DOCX_IMPORT_LOCKED_SECTION_IDS: ReadonlySet<string> = new Set([
  EK_DOGRULAMA_SECTION_ID,
  KARSI_ICTIHAT_SECTION_ID,
]);

/** Read-back process timeout: a hung Python must not hold the request. */
export const DOCX_READ_TIMEOUT_MS = 60_000;

/** Similarity floor for a paragraph whose hidden bookmark was lost. */
export const TEXT_ALIGN_MIN_DICE = 0.6;

export const DOCX_IDENTITY_MISSING = "DOCX_IDENTITY_MISSING";
export const DOCX_IDENTITY_INVALID = "DOCX_IDENTITY_INVALID";
export const DOCX_OTHER_DRAFT = "DOCX_OTHER_DRAFT";
export const DOCX_IDENTITY_MISMATCH = "DOCX_IDENTITY_MISMATCH";
export const IMPORT_PREVIEW_MISMATCH = "IMPORT_PREVIEW_MISMATCH";

export const DOCX_IDENTITY_MISSING_MESSAGE_TR =
  "Bu Word dosyasında ColleX taslak kimliği yok: ColleX'ten dışa aktarılmış bir taslak değil" +
  " ya da gizli kimlik bölümü silinmiş. Geri yükleme yalnız ColleX'in bu taslak için ürettiği" +
  " DOCX ile yapılır; taslağı yeniden Word'e aktarıp düzeltmelerinizi oraya taşıyın.";
export const DOCX_IDENTITY_INVALID_MESSAGE_TR =
  "Bu Word dosyasındaki ColleX taslak kimliği bozulmuş ya da değiştirilmiş (parmak izi tutmuyor);" +
  " dosyanın hangi taslaktan geldiği güvenle bilinemediği için geri yüklenmedi.";
export const DOCX_TRACKED_CHANGES_NOTICE_TR =
  "Belgede kabul ya da reddedilmemiş izlenen değişiklikler var: metin, bütün değişiklikler KABUL" +
  " EDİLMİŞ hâliyle okundu (eklenenler içeride, silinenler dışarıda). İstemediğiniz bir değişiklik" +
  " varsa Word'de Gözden Geçir → Reddet ile karara bağlayıp dosyayı yeniden yükleyin.";
export const DOCX_LOCKED_NOTE_TR =
  "Bu bölüm makine tarafından korunur (karşı içtihat ya da doğrulama eki); Word'deki değişiklik" +
  " uygulanmadı. Karşı içtihat bölümünü ColleX'in düzenleme ekranından yönetin.";
export const DOCX_APPARATUS_NOTE_TR =
  "Dayanak satırları, uyarılar ve DAYANAK KAYNAKLARI eki makine tarafından yeniden üretilir;" +
  " Word'de değiştirilen bu satır uygulanmadı.";

export function otherDraftMessage(docxDraftId: string): string {
  return (
    `Bu Word dosyası başka bir taslağa ait (taslak kimliği: ${docxDraftId}); bu taslağa yüklenemez.` +
    " Doğru taslağı açıp dosyayı onun üzerinden geri yükleyin."
  );
}

export function staleVersionMessage(docxVersion: number, currentVersion: number): string {
  return (
    `Bu Word dosyası taslağın ${docxVersion}. sürümünden alınmış; taslak şimdi ${currentVersion}.` +
    " sürümde. Düzeltmeleriniz eski sürümün üzerine kurulu olduğu için doğrudan yüklenmedi (sonraki" +
    " sürümdeki değişiklikler kaybolurdu): güncel sürümü Word'e aktarıp düzeltmelerinizi oraya taşıyın."
  );
}

export const DOCX_IDENTITY_MISMATCH_MESSAGE_TR =
  "Bu Word dosyasındaki kimlik bu taslağın kayıtlı metniyle uyuşmuyor (paragraf ya da alıntı" +
  " parmak izi farklı); dosya bu taslağın bu sürümünden üretilmemiş görünüyor ve geri yüklenmedi.";

// ---------------------------------------------------------------------------
// Read-back shape (export/draft_identity.py, collex.draft-docx-readback/v1)
// ---------------------------------------------------------------------------

const identityParagraphSchema = z.object({
  n: z.number().int().min(1),
  id: z.string(),
  sectionId: z.string(),
  role: z.string(),
  supported: z.boolean(),
  lines: z.number().int().min(0),
  textSha256: z.string(),
  quotes: z.array(z.object({ evidenceId: z.string(), quoteSha256: z.string() })),
});

const readbackSchema = z.object({
  schema: z.literal("collex.draft-docx-readback/v1"),
  identityStatus: z.enum(["OK", "MISSING", "DIGEST_MISMATCH", "MALFORMED", "AMBIGUOUS"]),
  identity: z
    .object({
      schema: z.literal("collex.draft-identity/v1"),
      draftId: z.string(),
      version: z.number().int(),
      template: z.string(),
      exportMode: z.object({ annex: z.string(), marks: z.string() }),
      paragraphs: z.array(identityParagraphSchema),
      apparatusSha256: z.array(z.string()),
    })
    .nullable(),
  blocks: z.array(
    z.object({
      index: z.number().int(),
      kind: z.enum(["paragraph", "heading", "table"]),
      style: z.string(),
      text: z.string(),
      marks: z.array(z.number().int()),
      pendingChange: z.boolean(),
    }),
  ),
  trackedChanges: z.object({
    pending: z.boolean(),
    insertions: z.number().int(),
    deletions: z.number().int(),
    moves: z.number().int(),
    formatting: z.number().int(),
  }),
  fileSha256: z.string(),
});

export type DocxReadback = z.infer<typeof readbackSchema>;
type IdentityParagraph = z.infer<typeof identityParagraphSchema>;

/** Strictly parse the read-back JSON; `undefined` = not a read-back. */
export function parseDocxReadback(value: unknown): DocxReadback | undefined {
  const parsed = readbackSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Identity check
// ---------------------------------------------------------------------------

export interface DocxImportRefusal {
  status: 409 | 422;
  kind: string;
  message: string;
  extra?: Record<string, unknown>;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** sha256 of canonical text — the value `export/draft_identity.py` records. */
export function canonicalTextSha256(text: string): string {
  return sha256Hex(canonicalQuoteText(text));
}

/**
 * The identity must name THIS draft, THIS version, and describe its stored
 * text and quotes exactly. Returns the refusal, or undefined when it holds.
 */
export function checkDocxIdentity(draft: Draft, readback: DocxReadback): DocxImportRefusal | undefined {
  if (readback.identityStatus === "MISSING" || readback.identity === null) {
    return { status: 422, kind: DOCX_IDENTITY_MISSING, message: DOCX_IDENTITY_MISSING_MESSAGE_TR };
  }
  if (readback.identityStatus !== "OK") {
    return {
      status: 422,
      kind: DOCX_IDENTITY_INVALID,
      message: DOCX_IDENTITY_INVALID_MESSAGE_TR,
      extra: { identityStatus: readback.identityStatus },
    };
  }
  const identity = readback.identity;
  if (identity.draftId !== draft.draftId) {
    return {
      status: 409,
      kind: DOCX_OTHER_DRAFT,
      message: otherDraftMessage(identity.draftId),
      extra: { docxDraftId: identity.draftId },
    };
  }
  const currentVersion = typeof draft.version === "number" ? draft.version : 1;
  if (identity.version !== currentVersion) {
    return {
      status: 409,
      kind: "VERSION_CONFLICT",
      message: staleVersionMessage(identity.version, currentVersion),
      extra: { currentVersion, docxVersion: identity.version },
    };
  }
  const stored = new Map<string, DraftParagraph>();
  for (const section of draft.sections) {
    for (const paragraph of section.paragraphs) stored.set(paragraph.id, paragraph);
  }
  const quoteSha = new Map(draft.evidence.map((entry) => [entry.evidenceId, entry.quoteSha256]));
  const seen = new Set<string>();
  const mismatch = (): DocxImportRefusal => ({
    status: 409,
    kind: DOCX_IDENTITY_MISMATCH,
    message: DOCX_IDENTITY_MISMATCH_MESSAGE_TR,
  });
  for (const entry of identity.paragraphs) {
    const paragraph = stored.get(entry.id);
    if (paragraph === undefined || seen.has(entry.id)) return mismatch();
    seen.add(entry.id);
    if (canonicalTextSha256(paragraph.text) !== entry.textSha256) return mismatch();
    for (const quote of entry.quotes) {
      if (quoteSha.get(quote.evidenceId) !== quote.quoteSha256) return mismatch();
    }
  }
  // Every stored body paragraph must be in the identity (the verification
  // appendix is legitimately absent from an annex=none copy).
  for (const section of draft.sections) {
    if (section.id === EK_DOGRULAMA_SECTION_ID) continue;
    for (const paragraph of section.paragraphs) {
      if (!seen.has(paragraph.id)) return mismatch();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Alignment and diff
// ---------------------------------------------------------------------------

export type DocxImportStatus = "unchanged" | "changed" | "added" | "deleted";

export interface DocxImportOutcome {
  /** Whether the paragraph will carry (or keeps) a verified source. */
  supported: boolean;
  evidenceIds: string[];
  /** true = the saved paragraph is marked KAYNAKSIZ. */
  kaynaksiz: boolean;
  /** true = one of its quotes was altered and that citation is dropped. */
  quoteAltered: boolean;
  issues: ReviseIssue[];
}

export interface DocxImportEntry {
  status: DocxImportStatus;
  sectionId: string;
  sectionTitle: string;
  /** Existing paragraph id (unchanged / changed / deleted). */
  paragraphId?: string;
  /** How a Word paragraph was matched: hidden bookmark ("kimlik") or text ("metin"). */
  matchedBy?: "kimlik" | "metin";
  before?: string;
  after?: string;
  /** In a locked section: the edit is reported and NOT applied. */
  locked: boolean;
  /** Whether confirming saves this entry's change. */
  applied: boolean;
  /** A tracked change is still pending in this paragraph (read as accepted). */
  pendingTrackedChange: boolean;
  outcome?: DocxImportOutcome;
  note?: string;
}

export interface DocxIgnoredEdit {
  text: string;
  reason: string;
}

export interface DocxImportPlan {
  entries: DocxImportEntry[];
  ignored: DocxIgnoredEdit[];
  patch: DraftPatch;
  /** entry index for each patch paragraph, by `${sectionIndex}.${paragraphIndex}`. */
  patchEntry: Map<string, number>;
}

const HEADING_APPENDIX = canonicalQuoteText("DAYANAK KAYNAKLARI");
const HEADING_WARNINGS = canonicalQuoteText("Uyarılar");
const KAYNAKSIZ_LEAD = /^\s*⚠?\s*KAYNAKSIZ\s*[—–-]\s*/u;
const CITATION_LIKE = /^\s*(?:Dayanak|Karşı içtihat)(?:\s*\[K-\d+\])?\s*:/u;
const WARNING_LIKE = /^\s*⚠/u;
const APPARATUS_STYLES: ReadonlySet<string> = new Set([
  "CollexTaslakUyari",
  "CollexTaslakAtif",
  "CollexTaslakAlan",
  "CollexTaslakAlinti",
]);

function tokens(text: string): Set<string> {
  return new Set(
    canonicalQuoteText(text)
      .toLocaleLowerCase("tr")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t !== ""),
  );
}

function dice(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 && y.size === 0) return 1;
  let common = 0;
  for (const t of x) if (y.has(t)) common += 1;
  return (2 * common) / (x.size + y.size);
}

interface Collected {
  lines: string[];
  firstBlock: number;
  pending: boolean;
  matchedBy: "kimlik" | "metin";
}

interface Loose {
  text: string;
  block: number;
  sectionId: string | undefined;
  pending: boolean;
  used: boolean;
}

function joinLines(lines: readonly string[]): string {
  return lines.map((line) => line.replace(/\s+$/u, "")).join("\n").replace(/^\n+|\n+$/gu, "");
}

/**
 * Align the Word body to the stored draft and build the revise patch.
 * Pure: no I/O, no clock. `checkDocxIdentity` must have passed.
 */
export function alignDocxImport(draft: Draft, readback: DocxReadback): DocxImportPlan {
  const identity = readback.identity;
  if (identity === null) throw new Error("alignDocxImport: identity missing");
  const annexFull = identity.exportMode.annex === "full";
  const byN = new Map<number, IdentityParagraph>(identity.paragraphs.map((p) => [p.n, p]));
  const apparatus = new Set(identity.apparatusSha256);
  const storedById = new Map<string, { paragraph: DraftParagraph; sectionId: string }>();
  for (const section of draft.sections) {
    for (const paragraph of section.paragraphs) storedById.set(paragraph.id, { paragraph, sectionId: section.id });
  }
  const titleToSection = new Map<string, string>();
  for (const section of draft.sections) {
    const title = canonicalQuoteText(section.title);
    if (title !== "" && !titleToSection.has(title)) titleToSection.set(title, section.id);
  }
  const sectionTitle = (sectionId: string): string =>
    draft.sections.find((s) => s.id === sectionId)?.title ?? "";

  const collected = new Map<number, Collected>();
  const loose: Loose[] = [];
  const ignored: DocxIgnoredEdit[] = [];
  let section: string | undefined;
  let zone: "body" | "warnings" | "appendix" = "body";

  const isApparatus = (text: string): boolean => apparatus.has(canonicalTextSha256(text));

  for (const block of readback.blocks) {
    if (block.kind === "table") continue;
    const canon = canonicalQuoteText(block.text);
    if (zone === "appendix") {
      if (canon !== "" && !isApparatus(block.text)) ignored.push({ text: block.text, reason: DOCX_APPARATUS_NOTE_TR });
      continue;
    }
    if (block.kind === "heading" && block.marks.length === 0) {
      if (block.style === "Title") continue;
      if (annexFull && canon === HEADING_APPENDIX) {
        zone = "appendix";
        continue;
      }
      if (canon === HEADING_WARNINGS) {
        zone = "warnings";
        continue;
      }
      const target = titleToSection.get(canon);
      if (target !== undefined) {
        section = target;
        zone = "body";
        continue;
      }
      if (isApparatus(block.text)) continue;
      // A heading the lawyer typed: treated as text below.
    }
    const marks = block.marks.filter((n) => byN.has(n));
    if (marks.length > 0) {
      const n = Math.min(...marks);
      const entry = byN.get(n) as IdentityParagraph;
      const slot = collected.get(n) ?? { lines: [], firstBlock: block.index, pending: false, matchedBy: "kimlik" as const };
      let text = block.text;
      if (slot.lines.length === 0 && !entry.supported) text = text.replace(KAYNAKSIZ_LEAD, "");
      slot.lines.push(text);
      slot.pending = slot.pending || block.pendingChange;
      collected.set(n, slot);
      section = entry.sectionId;
      zone = "body";
      continue;
    }
    if (canon === "") continue;
    if (isApparatus(block.text)) continue;
    if (zone === "warnings") {
      ignored.push({ text: block.text, reason: DOCX_APPARATUS_NOTE_TR });
      continue;
    }
    if (
      APPARATUS_STYLES.has(block.style) &&
      (CITATION_LIKE.test(block.text) || WARNING_LIKE.test(block.text) || block.text.startsWith("Not: "))
    ) {
      // An edited machine line (a citation, a warning, a reviewer note).
      ignored.push({ text: block.text, reason: DOCX_APPARATUS_NOTE_TR });
      continue;
    }
    loose.push({ text: block.text, block: block.index, sectionId: section, pending: block.pendingChange, used: false });
  }

  // ---- text alignment for paragraphs whose bookmark was lost --------------
  const storedText = (p: IdentityParagraph): string => storedById.get(p.id)?.paragraph.text ?? "";
  const unmatched = identity.paragraphs.filter((p) => !collected.has(p.n));
  const stripLead = (p: IdentityParagraph, text: string): string =>
    p.supported ? text : text.replace(KAYNAKSIZ_LEAD, "");
  for (const p of unmatched) {
    const want = canonicalQuoteText(storedText(p));
    // (a) exact: `lines` consecutive loose blocks in the same section.
    let hit: Loose[] | undefined;
    for (let i = 0; i < loose.length && hit === undefined; i += 1) {
      const first = loose[i] as Loose;
      if (first.used || (first.sectionId !== undefined && first.sectionId !== p.sectionId)) continue;
      const span = Math.max(1, p.lines);
      const run = loose.slice(i, i + span);
      if (run.length !== span || run.some((l) => l.used)) continue;
      const joined = stripLead(p, joinLines(run.map((l) => l.text)));
      if (canonicalQuoteText(joined) === want) hit = run;
    }
    // (b) similar: one block in the same section, best Dice above the floor.
    if (hit === undefined) {
      let best: Loose | undefined;
      let bestScore = TEXT_ALIGN_MIN_DICE;
      for (const l of loose) {
        if (l.used || l.sectionId !== p.sectionId) continue;
        const score = dice(stripLead(p, l.text), storedText(p));
        if (score >= bestScore) {
          best = l;
          bestScore = score;
        }
      }
      if (best !== undefined) hit = [best];
    }
    if (hit === undefined) continue;
    for (const l of hit) l.used = true;
    collected.set(p.n, {
      lines: hit.map((l, i) => (i === 0 ? stripLead(p, l.text) : l.text)),
      firstBlock: (hit[0] as Loose).block,
      pending: hit.some((l) => l.pending),
      matchedBy: "metin",
    });
  }

  // ---- entries + patch ------------------------------------------------------
  const firstEditable = draft.sections.find((s) => !DOCX_IMPORT_LOCKED_SECTION_IDS.has(s.id))?.id;
  interface Item {
    key: number;
    entry: DocxImportEntry;
    patch?: DraftPatchParagraph;
  }
  const itemsBySection = new Map<string, Item[]>();
  const push = (sectionId: string, item: Item): void => {
    const list = itemsBySection.get(sectionId) ?? [];
    list.push(item);
    itemsBySection.set(sectionId, list);
  };

  // Matched and deleted identity paragraphs, in identity order.
  const lastKey = new Map<string, number>();
  for (const p of identity.paragraphs) {
    const stored = storedById.get(p.id);
    if (stored === undefined) continue;
    const locked = DOCX_IMPORT_LOCKED_SECTION_IDS.has(p.sectionId);
    const got = collected.get(p.n);
    const base = {
      sectionId: p.sectionId,
      sectionTitle: sectionTitle(p.sectionId),
      paragraphId: p.id,
      locked,
    };
    const keepPatch: DraftPatchParagraph = {
      id: p.id,
      text: stored.paragraph.text,
      evidenceIds: [...stored.paragraph.evidenceIds],
      role: stored.paragraph.role,
    };
    if (got === undefined) {
      const key = (lastKey.get(p.sectionId) ?? -1) + 0.25;
      lastKey.set(p.sectionId, key);
      push(p.sectionId, {
        key,
        entry: {
          ...base,
          status: "deleted",
          before: stored.paragraph.text,
          applied: !locked,
          pendingTrackedChange: false,
          ...(locked ? { note: DOCX_LOCKED_NOTE_TR } : {}),
        },
        ...(locked ? { patch: keepPatch } : {}),
      });
      continue;
    }
    lastKey.set(p.sectionId, got.firstBlock);
    const after = joinLines(got.lines);
    const unchanged = canonicalQuoteText(after) === canonicalQuoteText(stored.paragraph.text);
    const status: DocxImportStatus = unchanged ? "unchanged" : "changed";
    push(p.sectionId, {
      key: got.firstBlock,
      entry: {
        ...base,
        status,
        matchedBy: got.matchedBy,
        before: stored.paragraph.text,
        ...(unchanged ? {} : { after }),
        applied: !locked || unchanged,
        pendingTrackedChange: got.pending,
        ...(locked && !unchanged ? { note: DOCX_LOCKED_NOTE_TR } : {}),
      },
      // Unchanged (or locked) paragraphs are re-sent EXACTLY as stored, so the
      // round trip can never rewrite text the lawyer did not touch.
      patch: unchanged || locked ? keepPatch : { ...keepPatch, text: after },
    });
  }

  // Added paragraphs: whatever loose text nobody claimed.
  for (const l of loose) {
    if (l.used) continue;
    const sectionId = l.sectionId ?? firstEditable ?? draft.sections[0]?.id ?? "";
    const locked = DOCX_IMPORT_LOCKED_SECTION_IDS.has(sectionId);
    push(sectionId, {
      key: l.block,
      entry: {
        status: "added",
        sectionId,
        sectionTitle: sectionTitle(sectionId),
        after: l.text,
        locked,
        applied: !locked,
        pendingTrackedChange: l.pending,
        ...(locked ? { note: DOCX_LOCKED_NOTE_TR } : {}),
      },
      ...(locked ? {} : { patch: { text: l.text } }),
    });
  }

  const entries: DocxImportEntry[] = [];
  const patchEntry = new Map<string, number>();
  const patchSections: DraftPatch["sections"] = [];
  for (const draftSection of draft.sections) {
    if (draftSection.id === EK_DOGRULAMA_SECTION_ID) {
      // Machine-owned and regenerated by reviseDraft: never sent. Its diff
      // entries are still shown (locked, not applied).
      const items = (itemsBySection.get(draftSection.id) ?? []).sort((a, b) => a.key - b.key);
      for (const item of items) entries.push(item.entry);
      continue;
    }
    const items = (itemsBySection.get(draftSection.id) ?? []).sort((a, b) => a.key - b.key);
    const paragraphs: DraftPatchParagraph[] = [];
    const sectionIndex = patchSections.length;
    let previousRole: string | undefined;
    for (const item of items) {
      const entryIndex = entries.push(item.entry) - 1;
      if (item.patch === undefined) continue;
      const patchParagraph: DraftPatchParagraph = { ...item.patch };
      if (patchParagraph.id === undefined && previousRole !== undefined) {
        // A paragraph typed in Word takes the kind of the paragraph it was
        // typed after (Word's Enter continues it): a new sentence after a
        // legal assessment is a legal assertion, and without a source it is
        // KAYNAKSIZ — reviseDraft decides that, not this module.
        patchParagraph.role = previousRole;
      }
      if (patchParagraph.role !== undefined) previousRole = patchParagraph.role;
      patchEntry.set(`${sectionIndex}.${paragraphs.length}`, entryIndex);
      paragraphs.push(patchParagraph);
    }
    patchSections.push({ id: draftSection.id, paragraphs });
  }

  const counts = countEntries(entries);
  const noteParts = [
    `Word'den geri yükleme (sürüm ${identity.version} DOCX): ${counts.changed} değişen,` +
      ` ${counts.added} eklenen, ${counts.deleted} silinen paragraf`,
  ];
  if (counts.notApplied + ignored.length > 0) {
    noteParts.push(`${counts.notApplied + ignored.length} değişiklik korunan bölümde olduğu için uygulanmadı`);
  }
  if (readback.trackedChanges.pending) noteParts.push("izlenen değişiklikler kabul edilmiş hâliyle okundu");
  const patch: DraftPatch = { sections: patchSections, note: `${noteParts.join("; ")}.` };
  return { entries, ignored, patch, patchEntry };
}

export interface DocxImportCounts {
  unchanged: number;
  changed: number;
  added: number;
  deleted: number;
  /** Edits in locked sections (reported, not applied). */
  notApplied: number;
  pendingTrackedChanges: number;
}

export function countEntries(entries: readonly DocxImportEntry[]): DocxImportCounts {
  const counts: DocxImportCounts = {
    unchanged: 0,
    changed: 0,
    added: 0,
    deleted: 0,
    notApplied: 0,
    pendingTrackedChanges: 0,
  };
  for (const entry of entries) {
    counts[entry.status] += 1;
    if (entry.status !== "unchanged" && !entry.applied) counts.notApplied += 1;
    if (entry.pendingTrackedChange) counts.pendingTrackedChanges += 1;
  }
  return counts;
}

/**
 * Run the revise function over the plan (pure — nothing is stored) and write
 * each paragraph's gate outcome onto its diff entry.
 */
export function applyPlan(
  draft: Draft,
  plan: DocxImportPlan,
  now: () => Date,
): { draft: Draft; issues: ReviseIssue[] } {
  const result = reviseDraft(draft, plan.patch, { trustEntailment: false, now });
  const storedIds = new Set<string>();
  for (const section of draft.sections) for (const p of section.paragraphs) storedIds.add(p.id);
  const issuesByEntry = new Map<number, ReviseIssue[]>();
  for (const issue of result.issues) {
    const match = /^sections\.(\d+)\.paragraphs\.(\d+)/u.exec(issue.path);
    if (match === null) continue;
    const entryIndex = plan.patchEntry.get(`${match[1]}.${match[2]}`);
    if (entryIndex === undefined) continue;
    const list = issuesByEntry.get(entryIndex) ?? [];
    list.push(issue);
    issuesByEntry.set(entryIndex, list);
  }
  plan.patch.sections.forEach((patchSection, sectionIndex) => {
    const revisedSection = result.draft.sections.find((s) => s.id === patchSection.id);
    const fresh = (revisedSection?.paragraphs ?? []).filter((p) => !storedIds.has(p.id));
    let freshCursor = 0;
    patchSection.paragraphs.forEach((patchParagraph, paragraphIndex) => {
      const entryIndex = plan.patchEntry.get(`${sectionIndex}.${paragraphIndex}`);
      if (entryIndex === undefined) return;
      const entry = plan.entries[entryIndex] as DocxImportEntry;
      const revised =
        patchParagraph.id !== undefined && storedIds.has(patchParagraph.id)
          ? revisedSection?.paragraphs.find((p) => p.id === patchParagraph.id)
          : fresh[freshCursor++];
      const issues = issuesByEntry.get(entryIndex) ?? [];
      if (revised === undefined) {
        entry.outcome = { supported: false, evidenceIds: [], kaynaksiz: false, quoteAltered: false, issues };
        return;
      }
      entry.outcome = {
        supported: revised.supported,
        evidenceIds: [...revised.evidenceIds],
        kaynaksiz: !revised.supported,
        quoteAltered: issues.some((i) => i.code === "QUOTE_ALTERED"),
        issues,
      };
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Read-back process
// ---------------------------------------------------------------------------

export interface DraftDocxReadRequest {
  pythonPath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface DraftDocxReadResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type DraftDocxReadExec = (request: DraftDocxReadRequest) => Promise<DraftDocxReadResult>;

/** execFile + argument array (never a shell); stdout carries the JSON. */
export const defaultDraftDocxReadExec: DraftDocxReadExec = ({ pythonPath, args, cwd, timeoutMs }) =>
  new Promise((resolvePromise) => {
    try {
      execFile(
        pythonPath,
        args,
        { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof (error as { code?: unknown }).code === "number"
                ? (error as unknown as { code: number }).code
                : 1;
          const timedOut = error !== null && (error as { killed?: boolean }).killed === true;
          resolvePromise({ code, stdout: stdout ?? "", stderr: stderr ?? "", timedOut });
        },
      );
    } catch (error) {
      resolvePromise({ code: 1, stdout: "", stderr: `okuyucu başlatılamadı: ${String((error as Error).message)}` });
    }
  });

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export interface DraftDocxImportDeps {
  store: DraftStore;
  exec: DraftDocxReadExec;
  pythonPath: string;
  repoRoot: string;
  now: () => Date;
  log: (line: string) => void;
  draftIdPattern: RegExp;
  withPersistOutcome: (draft: Draft) => Promise<Record<string, unknown>>;
}

const READ_ERROR_STATUS: Readonly<Record<string, 400 | 415 | 422>> = {
  INVALID_REQUEST: 400,
  UNSUPPORTED_TYPE: 415,
  EXTRACTION_FAILED: 422,
};

function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1];
  if (last === undefined) return undefined;
  try {
    return JSON.parse(last) as unknown;
  } catch {
    return undefined;
  }
}

export function registerDraftDocxImportRoute(app: Hono, deps: DraftDocxImportDeps): void {
  const notFound = (c: Context) => c.json({ error: { kind: "NOT_FOUND", message: "Taslak bulunamadı." } }, 404);

  app.post("/v1/drafts/:id/import-docx", async (c) => {
    const id = c.req.param("id");
    if (!deps.draftIdPattern.test(id)) return notFound(c);
    await deps.store.warm?.(id);
    if (deps.store.get(id) === undefined) return notFound(c);

    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      body = {};
    }
    const upload = body["file"];
    if (
      upload === null ||
      upload === undefined ||
      typeof upload === "string" ||
      typeof (upload as File).arrayBuffer !== "function"
    ) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: "Geri yükleme isteği Word dosyasını taşımalı ('file' alanı, multipart/form-data).",
          },
        },
        400,
      );
    }
    const file = upload as File;
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message: `Belge boyutu sınırı aşıldı: ${(file.size / 1_048_576).toFixed(1)} MB > ${UPLOAD_CAP_MIB} MB.`,
          },
        },
        400,
      );
    }
    const confirmRaw = body["confirm"];
    if (confirmRaw !== undefined && confirmRaw !== "true" && confirmRaw !== "false") {
      return c.json(
        { error: { kind: "INVALID_REQUEST", message: "'confirm' alanı 'true' ya da 'false' olmalı." } },
        400,
      );
    }
    const confirm = confirmRaw === "true";
    const confirmedSha =
      typeof body["previewFingerprint"] === "string" ? (body["previewFingerprint"] as string) : undefined;
    if (confirm && (confirmedSha === undefined || !/^[0-9a-f]{64}$/u.test(confirmedSha))) {
      return c.json(
        {
          error: {
            kind: "INVALID_REQUEST",
            message:
              "Onay için önizlemenin verdiği dosya parmak izi de gönderilmeli: kaydedilen, önizlediğiniz" +
              " dosyanın ta kendisi olmalı (previewFingerprint).",
          },
        },
        400,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "collex-docx-import-"));
    let readback: DocxReadback | undefined;
    try {
      const tempPath = join(workDir, "geri-yukleme.docx");
      await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
      const result = await deps.exec({
        pythonPath: deps.pythonPath,
        args: [
          "-X",
          "utf8",
          "-m",
          "export.draft_identity",
          "--read",
          tempPath,
          "--name",
          safeUploadName(file.name ?? "") || "geri-yukleme.docx",
        ],
        cwd: deps.repoRoot,
        timeoutMs: DOCX_READ_TIMEOUT_MS,
      });
      const parsed = lastJsonLine(result.stdout);
      if (result.code === 0 && result.timedOut !== true) readback = parseDocxReadback(parsed);
      if (readback === undefined) {
        const error =
          parsed !== null && typeof parsed === "object"
            ? (parsed as { error?: { kind?: unknown; message?: unknown } }).error
            : undefined;
        const kind = typeof error?.kind === "string" ? error.kind : undefined;
        if (result.code === 1 && kind !== undefined && READ_ERROR_STATUS[kind] !== undefined) {
          return c.json(
            {
              error: {
                kind,
                message: typeof error?.message === "string" ? error.message : "Word dosyası okunamadı.",
              },
            },
            READ_ERROR_STATUS[kind] as 400 | 415 | 422,
          );
        }
        const correlationId = randomUUID();
        deps.log(
          `[collex] IMPORT_FAILED id=${correlationId} draftId=${id} code=${result.code}` +
            ` timedOut=${result.timedOut === true} stderr=${JSON.stringify(result.stderr.slice(0, 2000))}`,
        );
        return c.json(
          {
            error: {
              kind: "IMPORT_FAILED",
              message: "Word dosyası okunamadı; hiçbir şey kaydedilmedi.",
              detail: `Ayrıntı sunucu günlüğüne yazıldı (kayıt no: ${correlationId}).`,
              correlationId,
            },
          },
          500,
        );
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }

    // The stored draft is read AFTER the file was read, and nothing awaits
    // between here and `store.put`: no other version can land in between.
    const draft = deps.store.get(id);
    if (draft === undefined) return notFound(c);
    const refusal = checkDocxIdentity(draft, readback);
    if (refusal !== undefined) {
      return c.json({ error: { kind: refusal.kind, message: refusal.message, ...(refusal.extra ?? {}) } }, refusal.status);
    }
    if (confirm && confirmedSha !== readback.fileSha256) {
      return c.json(
        {
          error: {
            kind: IMPORT_PREVIEW_MISMATCH,
            message:
              "Onaylanan dosya önizlenen dosya değil (parmak izi farklı); hiçbir şey kaydedilmedi." +
              " Dosyayı yeniden yükleyip önizlemeyi tekrar inceleyin.",
          },
        },
        409,
      );
    }

    const plan = alignDocxImport(draft, readback);
    let result;
    try {
      result = applyPlan(draft, plan, deps.now);
    } catch (error) {
      if (error instanceof DraftValidationError) {
        return c.json({ error: { kind: "INVALID_REQUEST", message: error.message, issues: error.issues } }, 400);
      }
      throw error;
    }
    const counts = countEntries(plan.entries);
    const summary = {
      draftId: draft.draftId,
      baseVersion: readback.identity?.version ?? draft.version,
      fileSha256: readback.fileSha256,
      exportMode: readback.identity?.exportMode,
      counts: { ...counts, ignoredLines: plan.ignored.length },
      trackedChanges: {
        ...readback.trackedChanges,
        ...(readback.trackedChanges.pending ? { message: DOCX_TRACKED_CHANGES_NOTICE_TR } : {}),
      },
      unsupportedCountAfter: result.draft.unsupportedCount,
      paragraphs: plan.entries,
      ignoredLines: plan.ignored,
      issues: result.issues,
    };
    if (!confirm) {
      return c.json({ saved: false, import: summary }, 200);
    }
    deps.store.put(result.draft);
    return c.json(
      { ...(await deps.withPersistOutcome(result.draft)), issues: result.issues, import: { ...summary, saved: true } },
      200,
    );
  });
}
