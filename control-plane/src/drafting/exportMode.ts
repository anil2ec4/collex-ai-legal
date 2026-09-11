/**
 * Export presentation mode (W14 · B-02) — the TypeScript mirror of
 * `export/draft.py`'s `ExportMode`. Change both or neither.
 *
 * W13-DAILYFLOW measured the produced dava dilekçesi: 77 % of the Markdown
 * (10 162 of 13 207 bytes) was a SHA-256 appendix nothing in the body cited;
 * the DOCX was US Letter with no bold and no alignment; the lawyer's own
 * HUKUKÎ SEBEPLER paragraph carried a "⚠ KAYNAKSIZ" screen stamp. The
 * document could not be filed without heavy hand-editing.
 *
 * Two ADDITIVE query parameters fix that. Defaults are today's behaviour, so
 * every existing caller keeps exactly the content it had:
 *
 *   annex = full | none   machine apparatus (künye, Uyarılar, EK — DOĞRULAMA,
 *                         DAYANAK KAYNAKLARI) printed or omitted;
 *   marks = all  | none   screen marks (`⚠ KAYNAKSIZ —`, `(note)`) printed
 *                         or omitted.
 *
 * WHAT NEITHER TOUCHES (trap §C.2): the quote-integrity gate (B-01), the
 * evidence closure, the hash verification and `EXPORT_REFUSED`. `marks=none`
 * on an unverifiable draft still refuses. Removing the ink never removes the
 * discipline, and the evidence/hash package remains available as its own
 * file (`export/bundle*.py`) — separated, never lost.
 */

export const ANNEX_VALUES = ["full", "none"] as const;
export const MARKS_VALUES = ["all", "none"] as const;

export type AnnexMode = (typeof ANNEX_VALUES)[number];
export type MarksMode = (typeof MARKS_VALUES)[number];

export interface ExportMode {
  annex: AnnexMode;
  marks: MarksMode;
}

export const DEFAULT_EXPORT_MODE: ExportMode = Object.freeze({ annex: "full", marks: "all" });

/** Section id of the machine-owned verification appendix. */
export const EK_DOGRULAMA_SECTION_ID = "ek-dogrulama";

export const LABEL_TASLAK = "TASLAK";
export const LABEL_NIHAI = "NİHAİ";

export function includesAnnex(mode: ExportMode): boolean {
  return mode.annex === "full";
}

export function showsMarks(mode: ExportMode): boolean {
  return mode.marks === "all";
}

/** True for the clean filing copy: no apparatus AND no screen marks. */
export function isFinalCopy(mode: ExportMode): boolean {
  return !includesAnnex(mode) && !showsMarks(mode);
}

/** File-name discriminator so the two copies never get mixed up on disk. */
export function modeLabel(mode: ExportMode): string {
  return isFinalCopy(mode) ? LABEL_NIHAI : LABEL_TASLAK;
}

/** Parse the two query parameters; `undefined` = the default for that axis. */
export function parseExportMode(
  annex: string | undefined,
  marks: string | undefined,
): { ok: true; mode: ExportMode } | { ok: false; message: string } {
  if (annex !== undefined && !(ANNEX_VALUES as readonly string[]).includes(annex)) {
    return {
      ok: false,
      message:
        "annex parametresi 'full' veya 'none' olmalı. 'full' (varsayılan) doğrulama" +
        " eklerini de yazar; 'none' yalnızca dilekçe gövdesini verir.",
    };
  }
  if (marks !== undefined && !(MARKS_VALUES as readonly string[]).includes(marks)) {
    return {
      ok: false,
      message:
        "marks parametresi 'all' veya 'none' olmalı. 'all' (varsayılan) ekran" +
        " işaretlerini yazar; 'none' yazmaz — doğrulama zorunluluğu değişmez.",
    };
  }
  return {
    ok: true,
    mode: {
      annex: (annex as AnnexMode | undefined) ?? DEFAULT_EXPORT_MODE.annex,
      marks: (marks as MarksMode | undefined) ?? DEFAULT_EXPORT_MODE.marks,
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-filing review record (W14 · B-36)
// ---------------------------------------------------------------------------
//
// HONESTY BOUNDARY, written on every surface: we do not verify — we RECORD
// that the lawyer verified.

/** One recorded review act. */
export interface ReviewMark {
  checked: boolean;
  /** ISO stamp of the tick; empty while unticked. */
  at?: string;
  /** Who ticked it (the lawyer's own name from settings), when known. */
  by?: string;
  note?: string;
}

/** The three boxes, in display order, with their Turkish labels. */
export const REVIEW_CHECKLIST_ITEMS = Object.freeze([
  { id: "citationsOpened", label: "Her [K-n] kaynağını açıp okudum" },
  { id: "unsupportedReviewed", label: "Her ⚠ KAYNAKSIZ paragrafı gözden geçirdim" },
  { id: "contraryRead", label: "KARŞI İÇTİHAT bölümünü okudum" },
] as const);

export type ReviewChecklistId = (typeof REVIEW_CHECKLIST_ITEMS)[number]["id"];

export const REVIEW_CHECKLIST_IDS: readonly string[] = REVIEW_CHECKLIST_ITEMS.map((i) => i.id);

/** Printed in the exported document while any box is unchecked. */
export const VERIFICATION_INCOMPLETE_LINE =
  "Doğrulama tamamlanmadı: bu belgedeki kaynaklar, KAYNAKSIZ paragraflar ve" +
  " karşı içtihat avukat tarafından tek tek onaylanmadan dışa aktarıldı.";

/** The honesty sentence itself — identical wording on every surface. */
export const REVIEW_RECORD_DISCLAIMER =
  "Bu kayıt bir doğrulama değildir: sistem doğrulamaz, avukatın doğruladığını kaydeder.";

export function isReviewComplete(
  checklist: Readonly<Record<string, ReviewMark>> | undefined,
): boolean {
  if (checklist === undefined) return false;
  return REVIEW_CHECKLIST_IDS.every((id) => checklist[id]?.checked === true);
}
