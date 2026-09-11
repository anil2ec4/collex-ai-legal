/**
 * Draft revision (W12 lane C, contract [D]):
 *
 *   reviseDraft(draft, patch, { trustEntailment, now }) -> { draft, issues }
 *
 * A lawyer edits paragraphs in the console (PUT /v1/drafts/{id}) or a
 * server-side writer (lane E's paragraph writer) proposes text. Either way
 * the evidence discipline is re-applied on EVERY save — an edit can never
 * launder an unsupported claim into a supported one:
 *
 *  - sections must be known to the template (plus the composer-appended
 *    `karsi-ictihat` / `ek-dogrulama`) and keep the template's order;
 *  - paragraph ids either exist in the draft or are generated; text is
 *    sanitized through the render guard;
 *  - every evidence id must be in the draft's evidence OR unusedEvidence
 *    (citing an unused entry pulls it into the document);
 *  - a lexical binding (the default) must pass `evidenceOverlaps` — the
 *    quote's tokens AND numbers must survive in the paragraph text;
 *  - an entailment binding is accepted ONLY with `trustEntailment:true`
 *    (server-side judge); over HTTP the paragraph becomes KAYNAKSIZ and an
 *    issue says why;
 *  - "karşıt" evidence is never bound under hukuki-sebepler or a legal role,
 *    and an uploaded exhibit never backs a legal role;
 *  - `evidenceUse` toggles move entries between HUKUKÎ SEBEPLER and
 *    unusedEvidence; the karşı içtihat section cannot be silently dropped;
 *  - the `ek-dogrulama` section is machine-owned and regenerated; the
 *    unsupported count, warnings and version are recomputed.
 *
 * Structural problems (unknown template/section, wrong order, duplicate
 * section) throw `DraftValidationError` (HTTP 400, nothing saved); binding
 * problems are SOFT: the paragraph is kept (demoted) and reported in
 * `issues` and in the draft's warnings, so the reviewer sees them on every
 * surface.
 */

import { sanitizeMarkdown } from "../security/renderGuard.js";
import {
  DraftValidationError,
  countUnsupported,
  evidenceBindingHolds,
  karsiIctihatIndex,
  partitionEvidence,
} from "./composer.js";
import { QUOTE_ALTERED, quoteAlteredMessage } from "./quoteIntegrity.js";
import { REVIEW_CHECKLIST_IDS, type ReviewMark } from "./exportMode.js";
import {
  buildEkDogrulamaSection,
  evidenceNumbering,
  evidenceRef,
  sebeplerParagraphText,
} from "./appendix.js";
import { formatTimestampTr } from "./input.js";
import { getTemplate, type DraftTemplate } from "./templates.js";
import {
  DRAFT_REVIEW_BANNER,
  EK_DOGRULAMA_SECTION_ID,
  KARSI_ICTIHAT_SECTION_ID,
  KARSI_ICTIHAT_SECTION_TITLE,
  LEGAL_ROLES,
  NOTE_BEYAN,
  NOTE_KARSIT,
  NOTE_KAYNAKLI,
  NOTE_KAYNAKSIZ,
  SLOT_KINDS,
  type Draft,
  type DraftBinding,
  type DraftEvidence,
  type DraftParagraph,
  type DraftSection,
  type SlotKind,
} from "./types.js";

export interface DraftPatchParagraph {
  /** Existing paragraph id, or absent/unknown for a new paragraph. */
  id?: string;
  text: string;
  evidenceIds?: string[];
  role?: string;
  binding?: DraftBinding;
}

export interface DraftPatchSection {
  id: string;
  paragraphs: DraftPatchParagraph[];
}

/** What a client may say about one review box (W14 · B-36). */
export interface ReviewMarkPatch {
  checked: boolean;
  by?: string;
  note?: string;
}

export interface DraftPatch {
  sections: DraftPatchSection[];
  /** evidenceId -> use it as a HUKUKÎ SEBEP (true) or park it (false). */
  evidenceUse?: Record<string, boolean>;
  /** Free-text revision note (recorded in warnings). */
  note?: string;
  /** Additive (W14 · B-36): the three pre-filing boxes, by id. */
  reviewChecklist?: Record<string, ReviewMarkPatch>;
  /** Additive (W14 · B-36): per-evidence review state, by evidenceId. */
  evidenceReview?: Record<string, ReviewMarkPatch>;
}

export interface ReviseIssue {
  path: string;
  message: string;
  /**
   * Additive (W14 · B-01): the machine code of the finding, when it has one.
   * Today the only code is `QUOTE_ALTERED`. The Turkish `message` always
   * stands on its own; `code` is for the console linter and the audit report.
   */
  code?: string;
}

export interface ReviseOptions {
  /** true only on trusted server-side paths (lane E's paragraph writer). */
  trustEntailment: boolean;
  now: () => Date;
}

export interface ReviseResult {
  draft: Draft;
  issues: ReviseIssue[];
}

const SECTION_ORDER_MESSAGE = "bölümler şablon sırasını korumalıdır";

/**
 * Merge a review patch onto the stored record (W14 · B-36).
 *
 * `undefined` in the patch = "do not touch"; a key not in `allowed` is
 * reported and IGNORED (never invented). A tick without an `at` is stamped
 * with the server's clock — the record's whole value is that the timestamp is
 * not the client's to choose. Unticking clears the stamp and the note.
 */
function applyReviewMarks(
  stored: Readonly<Record<string, ReviewMark>> | undefined,
  patched: Readonly<Record<string, ReviewMarkPatch>> | undefined,
  allowed: readonly string[],
  now: Date,
  issues: ReviseIssue[],
  path: string,
): Record<string, ReviewMark> | undefined {
  const out: Record<string, ReviewMark> = {};
  for (const [key, mark] of Object.entries(stored ?? {})) {
    if (!allowed.includes(key)) continue;
    out[key] = { ...mark };
  }
  for (const [key, mark] of Object.entries(patched ?? {})) {
    if (!allowed.includes(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: `'${key}' bu taslakta bir inceleme kalemi değil; yok sayıldı.`,
      });
      continue;
    }
    if (!mark.checked) {
      delete out[key];
      continue;
    }
    const entry: ReviewMark = { checked: true, at: now.toISOString() };
    const by = mark.by === undefined ? "" : sanitizeMarkdown(mark.by).replace(/\s+/gu, " ").trim();
    if (by !== "") entry.by = by;
    const note =
      mark.note === undefined ? "" : sanitizeMarkdown(mark.note).replace(/\s+/gu, " ").trim();
    if (note !== "") entry.note = note;
    out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** "K-3" when the entry is numbered in the document, undefined otherwise. */
function refLabel(numbering: ReadonlyMap<string, number>, evidenceId: string): string | undefined {
  const ref = evidenceRef(numbering, evidenceId);
  return ref === evidenceId ? undefined : ref;
}

function isSlotKind(value: string): value is SlotKind {
  return (SLOT_KINDS as readonly string[]).includes(value);
}

/** Previous revision lines are replaced, not accumulated. */
function isRecomputedWarning(warning: string): boolean {
  return (
    warning === DRAFT_REVIEW_BANNER ||
    /^\d+ paragraf KAYNAKSIZ:/u.test(warning) ||
    /^\d+ doğrulanmış kaynak taslakta kullanılmadı/u.test(warning) ||
    warning.startsWith("Düzenleme uyarısı:") ||
    warning.startsWith("Düzenleme notu:") ||
    /^Sürüm \d+:/u.test(warning)
  );
}

function templateSection(template: DraftTemplate, id: string) {
  return template.sections.find((s) => s.id === id);
}

/**
 * The legal role a section is made of when EVERY slot of it is legal
 * (`hukukiSebepler` / `hukukiDegerlendirme`); undefined for mixed sections
 * (AÇIKLAMALAR holds olaylar next to the assessment) and unknown ids.
 * `hukuki-sebepler` counts by id as well, as the composer treats it.
 */
function legalOnlySection(template: DraftTemplate, sectionId: string): SlotKind | undefined {
  const section = templateSection(template, sectionId);
  if (section === undefined) return sectionId === "hukuki-sebepler" ? "hukukiSebepler" : undefined;
  const kinds = section.slots.map((s) => s.kind).filter((k) => k !== "baslik" && k !== "imza");
  if (kinds.length === 0 || !kinds.every((k) => LEGAL_ROLES.has(k))) {
    return sectionId === "hukuki-sebepler" ? "hukukiSebepler" : undefined;
  }
  return kinds[0];
}

/** Default role for a brand-new paragraph in a section. */
function defaultRole(template: DraftTemplate, sectionId: string): SlotKind {
  if (sectionId === KARSI_ICTIHAT_SECTION_ID) return "karsiIctihat";
  const section = templateSection(template, sectionId);
  const first = section?.slots.find((s) => s.kind !== "baslik" && s.kind !== "imza");
  return first?.kind ?? section?.slots[0]?.kind ?? "hukum";
}

function sectionTitle(draft: Draft, template: DraftTemplate, sectionId: string): string {
  if (sectionId === KARSI_ICTIHAT_SECTION_ID) return KARSI_ICTIHAT_SECTION_TITLE;
  const existing = draft.sections.find((s) => s.id === sectionId);
  if (existing !== undefined) return existing.title;
  return templateSection(template, sectionId)?.title ?? "";
}

/** Index at which a section id sits in the template (Infinity when appended). */
function templateIndex(template: DraftTemplate, sectionId: string): number {
  const index = template.sections.findIndex((s) => s.id === sectionId);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

/**
 * Apply a patch to a draft. Throws `DraftValidationError` for structural
 * problems; returns the revised draft plus the soft issues found.
 */
export function reviseDraft(draft: Draft, patch: DraftPatch, opts: ReviseOptions): ReviseResult {
  const template = getTemplate(draft.template);
  if (template === undefined) {
    throw new DraftValidationError("bilinmeyen şablon", [
      { path: "template", message: `şablon bulunamadı: ${draft.template}` },
    ]);
  }

  // ---- structural validation -------------------------------------------
  const allowedIds = new Set<string>([
    ...template.sections.map((s) => s.id),
    KARSI_ICTIHAT_SECTION_ID,
    EK_DOGRULAMA_SECTION_ID,
  ]);
  const seenSections = new Set<string>();
  let lastTemplateIndex = -1;
  patch.sections.forEach((section, index) => {
    if (!allowedIds.has(section.id)) {
      throw new DraftValidationError("bilinmeyen bölüm", [
        { path: `sections.${index}.id`, message: `'${section.id}' bu şablonda bir bölüm değil` },
      ]);
    }
    if (seenSections.has(section.id)) {
      throw new DraftValidationError("bölüm tekrarı", [
        { path: `sections.${index}.id`, message: `'${section.id}' bölümü birden çok kez gönderildi` },
      ]);
    }
    seenSections.add(section.id);
    const position = templateIndex(template, section.id);
    if (Number.isFinite(position)) {
      if (position < lastTemplateIndex) {
        throw new DraftValidationError(SECTION_ORDER_MESSAGE, [
          { path: `sections.${index}.id`, message: `'${section.id}' bölümü şablon sırasının dışında` },
        ]);
      }
      lastTemplateIndex = position;
    }
  });

  // ---- evidence universe --------------------------------------------------
  const allEvidence = new Map<string, DraftEvidence>();
  for (const entry of [...draft.evidence, ...(draft.unusedEvidence ?? [])]) {
    if (!allEvidence.has(entry.evidenceId)) allEvidence.set(entry.evidenceId, entry);
  }
  // "K-n" labels for the issue messages (B-01): the lawyer reads chips, not UUIDs.
  const numbering = evidenceNumbering(draft.evidence);
  const existingParagraphs = new Map<string, { paragraph: DraftParagraph; sectionId: string }>();
  for (const section of draft.sections) {
    if (section.id === EK_DOGRULAMA_SECTION_ID) continue;
    for (const paragraph of section.paragraphs) {
      existingParagraphs.set(paragraph.id, { paragraph, sectionId: section.id });
    }
  }

  const issues: ReviseIssue[] = [];
  const machineWarnings: string[] = [...(draft.machineWarnings ?? [])];
  const usedIds = new Set<string>();
  let newCounter = 0;
  const freshId = (sectionId: string): string => {
    let id: string;
    do {
      newCounter += 1;
      id = `p-${sectionId}-u${newCounter}`;
    } while (usedIds.has(id) || existingParagraphs.has(id));
    return id;
  };

  // ---- paragraphs ---------------------------------------------------------
  const sections: DraftSection[] = [];
  patch.sections.forEach((patchSection, sIndex) => {
    if (patchSection.id === EK_DOGRULAMA_SECTION_ID) {
      issues.push({
        path: `sections.${sIndex}`,
        message:
          "EK — DOĞRULAMA BİLGİLERİ bölümü makine tarafından üretilir; gönderilen içerik yok sayıldı.",
      });
      return;
    }
    const paragraphs: DraftParagraph[] = [];
    patchSection.paragraphs.forEach((patchParagraph, pIndex) => {
      const path = `sections.${sIndex}.paragraphs.${pIndex}`;
      const text = sanitizeMarkdown(patchParagraph.text ?? "").trim();
      if (text === "") {
        issues.push({ path: `${path}.text`, message: "Boş paragraf atlandı." });
        return;
      }
      const existing =
        patchParagraph.id !== undefined ? existingParagraphs.get(patchParagraph.id) : undefined;
      let id: string;
      if (existing !== undefined && !usedIds.has(patchParagraph.id as string)) {
        id = patchParagraph.id as string;
      } else {
        if (patchParagraph.id !== undefined && patchParagraph.id !== "" && existing === undefined) {
          issues.push({
            path: `${path}.id`,
            message: `'${patchParagraph.id}' taslakta yok; yeni paragraf olarak eklendi.`,
          });
        }
        id = freshId(patchSection.id);
      }
      usedIds.add(id);

      let role: SlotKind;
      if (patchParagraph.role !== undefined && patchParagraph.role !== "") {
        if (isSlotKind(patchParagraph.role) && patchParagraph.role !== "ekDogrulama") {
          role = patchParagraph.role;
        } else {
          role = existing?.paragraph.role ?? defaultRole(template, patchSection.id);
          issues.push({
            path: `${path}.role`,
            message: `'${patchParagraph.role}' geçerli bir paragraf rolü değil; '${role}' kullanıldı.`,
          });
        }
      } else {
        role = existing?.paragraph.role ?? defaultRole(template, patchSection.id);
      }
      if (patchSection.id === KARSI_ICTIHAT_SECTION_ID) role = "karsiIctihat";

      // W12-FIX (02.09.2026): the discipline is decided by the TEMPLATE, not
      // by the role the client chose. A section whose slots are all legal
      // (HUKUKÎ SEBEPLER) cannot hold a "beyan" paragraph — a client that
      // sent role 'olaylar' there laundered "Davalı, TBK m.344 ve Yargıtay
      // 3. HD ... uyarınca sorumludur" into an unmarked statement with no
      // KAYNAKSIZ mark. Likewise an existing LEGAL paragraph keeps its
      // legal role: a downgrade is refused and reported.
      const legalSection = legalOnlySection(template, patchSection.id);
      if (legalSection !== undefined && !LEGAL_ROLES.has(role)) {
        issues.push({
          path: `${path}.role`,
          message:
            `'${role}' rolü bu bölümde kullanılamaz: bölüm yalnız hukukî paragraf taşır;` +
            ` '${legalSection}' rolü uygulandı (kanıt bağı yoksa KAYNAKSIZ).`,
        });
        role = legalSection;
      } else if (
        existing !== undefined &&
        LEGAL_ROLES.has(existing.paragraph.role) &&
        !LEGAL_ROLES.has(role) &&
        role !== "karsiIctihat"
      ) {
        issues.push({
          path: `${path}.role`,
          message:
            `'${existing.paragraph.role}' rolündeki bir paragraf '${role}' (beyan) rolüne` +
            " düşürülemez; hukukî rol korundu (kanıt bağı yoksa KAYNAKSIZ).",
        });
        role = existing.paragraph.role;
      }

      const legal = LEGAL_ROLES.has(role) || patchSection.id === "hukuki-sebepler";
      const attached: string[] = [];
      let acceptedBinding: DraftBinding | undefined;
      for (const evidenceId of [...new Set(patchParagraph.evidenceIds ?? [])]) {
        const entry = allEvidence.get(evidenceId);
        if (entry === undefined) {
          issues.push({
            path: `${path}.evidenceIds`,
            message: `'${evidenceId}' taslağın kanıt listesinde yok; atıf yazılmadı.`,
          });
          continue;
        }
        if (entry.direction === "karşıt" && legal) {
          issues.push({
            path: `${path}.evidenceIds`,
            message:
              `'${evidenceId}' talebin aksi yönünde bir karardır; HUKUKÎ SEBEPLER veya hukukî` +
              " değerlendirmeye dayanak yapılamaz (karşı içtihat bölümünde kalır).",
          });
          continue;
        }
        if (entry.source === "UPLOAD" && LEGAL_ROLES.has(role)) {
          issues.push({
            path: `${path}.evidenceIds`,
            message: `'${evidenceId}' yüklenen bir belgedir; hukukî dayanak olarak bağlanamaz (delil olarak kalır).`,
          });
          continue;
        }
        // W12-FIX (02.09.2026): the server keeps ITS OWN accepted entailment
        // binding on a paragraph the client did not touch. The console
        // re-submits every paragraph on Kaydet; an untouched AI paragraph
        // (same text, same evidence, stored binding entailment) used to flip
        // to KAYNAKSIZ because the client could only say "lexical". The
        // comparison is against the STORED draft, never against the patch.
        const storedBinding = existing?.paragraph.binding;
        if (
          existing !== undefined &&
          typeof storedBinding === "object" &&
          storedBinding.kind === "entailment" &&
          existing.paragraph.text === text &&
          existing.paragraph.evidenceIds.includes(evidenceId)
        ) {
          attached.push(evidenceId);
          acceptedBinding = { kind: "entailment", score: storedBinding.score, judge: storedBinding.judge };
          continue;
        }
        const binding = patchParagraph.binding ?? "lexical";
        if (binding === "lexical") {
          // W14 · B-01: EXACT containment of the canonical quote. A lexical
          // floor let "üç yıldan yedi yıla" become "beş yıldan on yıla" under
          // an intact [K-n] chip (W13-UXAUDIT P0-1).
          if (!evidenceBindingHolds(text, entry.quote)) {
            issues.push({
              path: `${path}.evidenceIds`,
              message: quoteAlteredMessage(evidenceId, refLabel(numbering, evidenceId)),
              code: QUOTE_ALTERED,
            });
            continue;
          }
          attached.push(evidenceId);
          continue;
        }
        // Entailment binding: only a trusted server-side judge may vouch.
        if (!opts.trustEntailment) {
          issues.push({
            path: `${path}.binding`,
            message:
              `'${evidenceId}' için anlamsal (entailment) bağlama bu yoldan kabul edilmez;` +
              " paragraf KAYNAKSIZ işaretlendi. Alıntıyı metne birebir alın veya sunucu" +
              " tarafı yazıcıyı kullanın.",
          });
          continue;
        }
        if (
          typeof binding.score !== "number" ||
          !Number.isFinite(binding.score) ||
          binding.score < 0 ||
          binding.score > 1 ||
          typeof binding.judge !== "string" ||
          binding.judge.trim() === ""
        ) {
          issues.push({
            path: `${path}.binding`,
            message: `'${evidenceId}' için entailment bağlaması geçersiz (skor 0-1 ve yargıç adı gerekir).`,
          });
          continue;
        }
        attached.push(evidenceId);
        acceptedBinding = { kind: "entailment", score: binding.score, judge: binding.judge };
        machineWarnings.push(
          `${id}: ${evidenceId} entailment bağlaması kabul edildi (judge=${binding.judge}, score=${binding.score.toFixed(3)}).`,
        );
      }

      const paragraph: DraftParagraph = {
        id,
        text,
        evidenceIds: attached,
        supported: LEGAL_ROLES.has(role) ? attached.length > 0 : true,
        role,
      };
      if (LEGAL_ROLES.has(role)) {
        paragraph.note = attached.length > 0 ? NOTE_KAYNAKLI : NOTE_KAYNAKSIZ;
      } else if (role === "karsiIctihat") {
        paragraph.note = NOTE_KARSIT;
      } else {
        paragraph.note = NOTE_BEYAN;
      }
      if (acceptedBinding !== undefined) paragraph.binding = acceptedBinding;
      paragraphs.push(paragraph);
    });
    if (paragraphs.length > 0) {
      sections.push({
        id: patchSection.id,
        title: sectionTitle(draft, template, patchSection.id),
        paragraphs,
      });
    }
  });

  // The karşı içtihat section cannot vanish by omission (contract A). A
  // lawyer who wants it out sends it with an empty paragraph list.
  const originalKarsi = draft.sections.find((s) => s.id === KARSI_ICTIHAT_SECTION_ID);
  if (originalKarsi !== undefined && !seenSections.has(KARSI_ICTIHAT_SECTION_ID)) {
    sections.splice(karsiIctihatIndex(sections), 0, {
      ...originalKarsi,
      paragraphs: originalKarsi.paragraphs.map((p) => ({ ...p, evidenceIds: [...p.evidenceIds] })),
    });
    for (const p of originalKarsi.paragraphs) usedIds.add(p.id);
    issues.push({
      path: "sections",
      message:
        "DEĞERLENDİRİLMESİ GEREKEN KARŞI İÇTİHAT bölümü gönderilmedi; kaldırılamaz, korundu." +
        " Çıkarmak için bölümü boş paragraf listesiyle gönderin.",
    });
  }

  // ---- evidenceUse toggles ------------------------------------------------
  const sebeplerSlot = template.sections
    .flatMap((s) => s.slots.map((slot) => ({ sectionId: s.id, slot })))
    .find((x) => x.slot.kind === "hukukiSebepler");
  const citedBy = (evidenceId: string): DraftParagraph[] =>
    sections.flatMap((s) => s.paragraphs).filter((p) => p.evidenceIds.includes(evidenceId));

  for (const [evidenceId, use] of Object.entries(patch.evidenceUse ?? {})) {
    const entry = allEvidence.get(evidenceId);
    if (entry === undefined) {
      issues.push({ path: `evidenceUse.${evidenceId}`, message: "Kanıt taslakta yok; yok sayıldı." });
      continue;
    }
    if (use) {
      if (entry.direction === "karşıt") {
        issues.push({
          path: `evidenceUse.${evidenceId}`,
          message: "Talebin aksi yönündeki karar dayanak olarak eklenemez; karşı içtihat bölümünde kalır.",
        });
        continue;
      }
      if (entry.source === "UPLOAD") {
        issues.push({
          path: `evidenceUse.${evidenceId}`,
          message: "Yüklenen belge hukukî sebep olamaz; DELİLLER listesinde kalır.",
        });
        continue;
      }
      if (citedBy(evidenceId).length > 0) continue;
      if (sebeplerSlot === undefined) {
        issues.push({
          path: `evidenceUse.${evidenceId}`,
          message: "Bu şablonda HUKUKÎ SEBEPLER bölümü yok; kanıt bir paragrafa atıfla eklenebilir.",
        });
        continue;
      }
      let target = sections.find((s) => s.id === sebeplerSlot.sectionId);
      if (target === undefined) {
        target = { id: sebeplerSlot.sectionId, title: sectionTitle(draft, template, sebeplerSlot.sectionId), paragraphs: [] };
        const position = templateIndex(template, sebeplerSlot.sectionId);
        const insertAt = sections.findIndex((s) => templateIndex(template, s.id) > position);
        sections.splice(insertAt === -1 ? sections.length : insertAt, 0, target);
      }
      // Drop the KAYNAKSIZ placeholder once a real dayanak arrives.
      target.paragraphs = target.paragraphs.filter(
        (p) => !(p.role === "hukukiSebepler" && !p.supported && p.evidenceIds.length === 0),
      );
      const id = freshId(target.id);
      usedIds.add(id);
      target.paragraphs.push({
        id,
        text: sebeplerParagraphText(entry),
        evidenceIds: [evidenceId],
        supported: true,
        note: NOTE_KAYNAKLI,
        role: "hukukiSebepler",
      });
      continue;
    }
    // use === false: remove the dayanak line; other citations stay (reported).
    let removed = 0;
    for (const section of sections) {
      const before = section.paragraphs.length;
      section.paragraphs = section.paragraphs.filter(
        (p) => !(p.role === "hukukiSebepler" && p.evidenceIds.length === 1 && p.evidenceIds[0] === evidenceId),
      );
      removed += before - section.paragraphs.length;
    }
    const remaining = citedBy(evidenceId);
    if (remaining.length > 0) {
      issues.push({
        path: `evidenceUse.${evidenceId}`,
        message:
          `Kanıt ${remaining.length} paragrafta hâlâ kullanılıyor (${remaining.map((p) => p.id).join(", ")});` +
          ` HUKUKÎ SEBEPLER satırı ${removed > 0 ? "kaldırıldı" : "yoktu"}, kanıt listeden çıkarılmadı.`,
      });
    }
  }

  // A zorunlu sebepler section that ended up empty gets its loud placeholder
  // back; an optional one is simply omitted.
  if (sebeplerSlot !== undefined) {
    const index = sections.findIndex((s) => s.id === sebeplerSlot.sectionId);
    if (index !== -1) {
      const section = sections[index] as DraftSection;
      const hasSebep = section.paragraphs.some((p) => p.role === "hukukiSebepler");
      if (!hasSebep && sebeplerSlot.slot.zorunlu === true) {
        const id = freshId(section.id);
        usedIds.add(id);
        section.paragraphs.push({
          id,
          text:
            "Hukukî sebepler doğrulanmış bir mevzuat veya karar kaynağına bağlanamadı;" +
            " dayanak mevzuat avukat tarafından eklenmelidir.",
          evidenceIds: [],
          supported: false,
          note: NOTE_KAYNAKSIZ,
          role: "hukukiSebepler",
        });
      }
      if (section.paragraphs.length === 0) sections.splice(index, 1);
    }
  }

  // ---- closure, verification section, counts --------------------------------
  const { evidence, unusedEvidence } = partitionEvidence([...allEvidence.values()], sections);
  const ekDogrulama = buildEkDogrulamaSection(evidence, sections);
  if (ekDogrulama !== undefined) sections.push(ekDogrulama);
  const unsupportedCount = countUnsupported(sections);

  const now = opts.now();
  const version = (typeof draft.version === "number" ? draft.version : 1) + 1;
  const warnings: string[] = [DRAFT_REVIEW_BANNER];
  if (unsupportedCount > 0) {
    warnings.push(
      `${unsupportedCount} paragraf KAYNAKSIZ: hukukî dayanağı doğrulanamadı ve` +
        " belirgin biçimde işaretlendi. Avukat tamamlamadan kullanılamaz.",
    );
  }
  warnings.push(...draft.warnings.filter((w) => !isRecomputedWarning(w)));
  if (unusedEvidence.length > 0) {
    warnings.push(
      `${unusedEvidence.length} doğrulanmış kaynak taslakta kullanılmadı: hiçbir tespit ve` +
        " talep/olay metni bu kaynağa atıf yapmıyor. Gerekirse düzenleme ekranından" +
        " (kanıt kullanımı) eklenebilir.",
    );
  }
  warnings.push(
    `Sürüm ${version}: ${opts.trustEntailment ? "sunucu tarafı yazıcı" : "avukat düzenlemesi"} (${formatTimestampTr(now.toISOString())}).`,
  );
  if (patch.note !== undefined && patch.note.trim() !== "") {
    warnings.push(`Düzenleme notu: ${sanitizeMarkdown(patch.note).replace(/\s*\n+\s*/g, " ").trim()}`);
  }
  for (const issue of issues) warnings.push(`Düzenleme uyarısı: ${issue.message}`);

  const revised: Draft = {
    ...draft,
    updatedAt: now.toISOString(),
    version,
    sections,
    evidence,
    unusedEvidence,
    suggestedFacts: (draft.suggestedFacts ?? []).map((f) => ({ ...f })),
    unsupportedCount,
    warnings,
    reviewRequired: true,
  };
  if (machineWarnings.length > 0) revised.machineWarnings = machineWarnings;
  else delete revised.machineWarnings;

  // ---- B-36: the pre-filing review record ----------------------------------
  // The record travels with the draft VERSION, so it survives a restart and
  // lands in the Atıf Denetim Raporu. A tick is stamped the moment it is
  // made; unticking clears the stamp. Honesty boundary: this records that the
  // LAWYER verified — the system does not verify on the lawyer's behalf.
  const reviewChecklist = applyReviewMarks(
    draft.reviewChecklist,
    patch.reviewChecklist,
    REVIEW_CHECKLIST_IDS,
    now,
    issues,
    "reviewChecklist",
  );
  if (reviewChecklist !== undefined) revised.reviewChecklist = reviewChecklist;
  else delete revised.reviewChecklist;

  const knownEvidenceIds = [...allEvidence.keys()];
  const evidenceReview = applyReviewMarks(
    draft.evidenceReview,
    patch.evidenceReview,
    knownEvidenceIds,
    now,
    issues,
    "evidenceReview",
  );
  if (evidenceReview !== undefined) revised.evidenceReview = evidenceReview;
  else delete revised.evidenceReview;
  return { draft: revised, issues };
}
