/**
 * Turkish Markdown rendering of a Draft (GET /v1/drafts/{id}/export?format=md).
 *
 * Rules, in the order a reader meets them:
 *  1. The FIRST line is the mandatory review banner — a machine draft is
 *     never final (brief 11.5).
 *  2. SENTETİK notice right after, whenever the draft's evidence came from
 *     the synthetic fixture corpus.
 *  3. Every unsupported paragraph is prefixed "⚠ KAYNAKSIZ — ": an unsourced
 *     legal claim is shown loudly, never silently included.
 *  4. Paragraph text was sanitized at compose time (renderGuard). Roles whose
 *     text BEGINS with user content (başlık, taraflar, konu, imza) are
 *     additionally emitted bold, so an injected "SYSTEM: ..." can never open
 *     a top-level line — it always sits inside emphasized, labeled context.
 *  5. Citations render under their paragraph as "Dayanak [K-n]: label" —
 *     no hash and no evidence UUID inside the court text (W12). The
 *     machine-owned `ek-dogrulama` section (part of the draft) carries the
 *     short verification summary; the full hashes live in the DAYANAK
 *     KAYNAKLARI appendix after the document.
 */

import { formatTimestampTr } from "./input.js";
import { evidenceNumbering, evidenceRef, sourceLabelTr } from "./appendix.js";
import {
  DEFAULT_EXPORT_MODE,
  EK_DOGRULAMA_SECTION_ID,
  VERIFICATION_INCOMPLETE_LINE,
  includesAnnex,
  isReviewComplete,
  modeLabel,
  showsMarks,
  type ExportMode,
} from "./exportMode.js";
import {
  DRAFT_REVIEW_BANNER,
  KAYNAKSIZ_PREFIX,
  type Draft,
  type DraftEvidence,
  type DraftParagraph,
} from "./types.js";

/** Roles whose first token is user-provided; rendered bold (see rule 4). */
const BOLD_ROLES = new Set(["baslik", "taraflar", "konu", "imza"]);

const SYNTHETIC_LINE =
  "DENEME VERİSİ — Bu taslaktaki kaynaklar gerçek değildir; programı denemek" +
  " için üretilmiş örnek metinlerdir, gerçek Türk mevzuatı veya mahkeme" +
  " kararı değildir.";

function findEvidence(draft: Draft, evidenceId: string): DraftEvidence | undefined {
  return draft.evidence.find((entry) => entry.evidenceId === evidenceId);
}

function renderParagraph(
  draft: Draft,
  numbering: ReadonlyMap<string, number>,
  paragraph: DraftParagraph,
  out: string[],
  mode: ExportMode,
): void {
  const marks = showsMarks(mode);
  const annex = includesAnnex(mode);
  let text = paragraph.text;
  if (BOLD_ROLES.has(paragraph.role) && text !== "") {
    text = text
      .split("\n")
      .map((line) => (line.trim() === "" ? line : `**${line}**`))
      .join("\n");
  }
  if (!paragraph.supported && marks) {
    text = `${KAYNAKSIZ_PREFIX} — ${text}`;
    if (paragraph.note !== undefined) text = `${text}\n(${paragraph.note})`;
  } else if (paragraph.role === "karsiIctihat" && paragraph.note !== undefined) {
    // Contract A: the avukat-decides note travels VISIBLY with every
    // contrary-authority paragraph, on every surface and in every mode.
    text = `${text}\n(⚠ ${paragraph.note})`;
  }
  out.push("", text);
  for (const evidenceId of paragraph.evidenceIds) {
    const entry = findEvidence(draft, evidenceId);
    if (entry === undefined) continue; // exporter-side closure check refuses this case
    const prefix = entry.direction === "karşıt" ? "Karşı içtihat" : "Dayanak";
    // B-02: with no appendix there is nothing for a [K-n] to point at, so the
    // line reads as a Turkish petition citation: "Dayanak: <künye>".
    const ref = annex ? ` [${evidenceRef(numbering, evidenceId)}]` : "";
    out.push(`> ${prefix}${ref}: ${entry.label}`);
  }
}

export interface RenderDraftMarkdownOptions {
  /** Additive (W12-FIX2): the matter's title, shown instead of its UUID. */
  matterTitle?: string;
  /** Additive (W14 · B-02): annex/marks; defaults to today's behaviour. */
  mode?: ExportMode;
}

export function renderDraftMarkdown(draft: Draft, options: RenderDraftMarkdownOptions = {}): string {
  const mode = options.mode ?? DEFAULT_EXPORT_MODE;
  const annex = includesAnnex(mode);
  const out: string[] = [DRAFT_REVIEW_BANNER];
  if (draft.synthetic) {
    out.push("", SYNTHETIC_LINE);
    if (draft.syntheticNotice !== undefined) out.push(`(${draft.syntheticNotice})`);
  }
  // B-36: while any review box is unticked, the document says so — in every
  // mode, because that is exactly the sentence a filing copy must not hide.
  if (!isReviewComplete(draft.reviewChecklist)) out.push("", VERIFICATION_INCOMPLETE_LINE);

  const version = typeof draft.version === "number" ? draft.version : 1;
  out.push("", `# ${draft.title} (${modeLabel(mode)})`);
  if (annex) {
    out.push(
      "",
      `- Belge türü: ${draft.title}`,
      `- Sürüm: ${version}`,
      `- Oluşturulma: ${formatTimestampTr(draft.createdAt)}`,
    );
    if (draft.updatedAt !== undefined) out.push(`- Son düzenleme: ${formatTimestampTr(draft.updatedAt)}`);
    if (draft.matterId !== undefined && draft.matterId !== null) {
      const title = options.matterTitle?.trim();
      out.push(`- Dosya: ${title !== undefined && title !== "" ? title : draft.matterId}`);
    }
    out.push(
      `- Hukukî dayanağı doğrulanamayan paragraf sayısı: ${draft.unsupportedCount}` +
        " (belgede ⚠ KAYNAKSIZ diye işaretlidir; dayanağı avukat eklemelidir)",
      `- İnceleme durumu: AVUKAT İNCELEMESİ ZORUNLU`,
      // W15 · degismezler §2: teknik bilgi silinmez, bir katman asagi iner.
      `- Teknik künye: taslak kimliği: ${draft.draftId} · şablon: ${draft.template} (${draft.kind})`,
    );

    if (draft.warnings.length > 0) {
      out.push("", "## Uyarılar", "");
      for (const warning of draft.warnings) out.push(`- ${warning}`);
    }
  }

  const numbering = evidenceNumbering(draft.evidence);
  for (const section of draft.sections) {
    if (section.id === EK_DOGRULAMA_SECTION_ID && !annex) continue;
    if (section.title !== "") out.push("", `## ${section.title}`);
    for (const paragraph of section.paragraphs) {
      renderParagraph(draft, numbering, paragraph, out, mode);
    }
  }

  if (!annex) {
    // The clean filing copy stops here: no appendix, no schema tag, no
    // application instruction. The hash package is a SEPARATE file.
    out.push("");
    return out.join("\n");
  }

  out.push(
    "",
    "## DAYANAK KAYNAKLARI",
    "",
    "Bu ek, dilekçede atıf yapılan her kaynağın künyesini ve alıntısını gösterir." +
      " Dilekçeyi mahkemeye verirken bu eki çıkarabilirsiniz; ek ayrı bir dosya" +
      " olarak da alınabilir.",
    "",
  );
  if (draft.evidence.length === 0) {
    out.push("(Bu taslağa bağlanmış doğrulanmış kaynak yoktur.)");
  } else {
    draft.evidence.forEach((entry, index) => {
      out.push(
        `${index + 1}. [K-${index + 1}] ${entry.label}`,
        `   - Kaynak: ${sourceLabelTr(entry.source)}`,
      );
      if (entry.direction !== undefined) out.push(`   - Yönü: ${entry.direction}`);
      // W15: görünen satır avukat Türkçesidir; onu DENETLENEBİLİR kılan değer
      // hemen altında, teknik adıyla birlikte durur. Bu ek zaten dilekçeden
      // çıkarılabilen denetim katmanıdır — değeri buradan da silmek, "birebir
      // uyuştu" cümlesini kimsenin sınayamayacağı bir iddiaya çevirirdi.
      out.push(
        `   - Alıntı denetimi: kaynağıyla birebir uyuştu`,
        `   - Alıntının parmak izi: ${entry.quoteSha256} (Teknik adı: SHA-256)`,
        `   - Belgenin parmak izi: ${entry.contentSha256}`,
        `   - Denetim dosyasındaki kaydı: ${entry.evidenceId}`,
      );
    });
  }

  out.push("", "---", "", DRAFT_REVIEW_BANNER, "");
  return out.join("\n");
}
