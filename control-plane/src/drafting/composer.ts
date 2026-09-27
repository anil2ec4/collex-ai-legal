/**
 * Evidence-bound draft composer (brief 11.5, drafting half; W12 lane C).
 *
 * `composeDraft(request, evidencePack?)` fills a template's sections from the
 * matter fields and — for the legal slots only — from VALIDATED evidence:
 *
 *  - narrative facts, party identity, requests and contractual clauses are
 *    the user's own statements/will: `supported:true`,
 *    note "beyan/İRADE — kanıt gerektirmez";
 *  - HUKUKÎ DEĞERLENDİRME paragraphs are built ONLY from the evidence pack's
 *    claims. Each carries `evidenceIds` and `supported:true` — but an id is
 *    attached ONLY when the paragraph's text lexically contains the quoted
 *    passage (`evidenceOverlaps`). A claim whose evidence does not overlap
 *    its own text keeps its slot but is demoted to `supported:false`
 *    KAYNAKSIZ — a citation is never faked;
 *  - HUKUKÎ SEBEPLER lists ONLY the entries the document relies on: cited by
 *    a usable claim, or whose (kanun no, madde) / esas no appears in the
 *    talepler/olaylar/instructions text. Every other validated entry goes to
 *    `draft.unusedEvidence` and never enters the document (audit #2: TCK
 *    m.155/158/168 under a kapora claim);
 *  - a CONFLICTED run keeps its supporting-side assessment paragraphs and
 *    appends the fixed pointer sentence to the karşı içtihat section (audit
 *    #3: a conflicted matter used to lose every assessment);
 *  - uploaded-file chunks NEVER become hukukî değerlendirme (audit #4). They
 *    yield one DELİLLER line per file and `draft.suggestedFacts` — never
 *    auto-inserted;
 *  - hashes and UUIDs leave the body (audit #5): body citations are "K-n"
 *    references and the machine-owned final section `ek-dogrulama` carries
 *    the verification summary;
 *  - a legal slot with NO usable evidence yields (when the template marks it
 *    zorunlu) a `supported:false` paragraph with the KAYNAKSIZ note. Those —
 *    and only those — are what `unsupportedCount` counts.
 *
 * SECURITY: every user-provided string (party names, facts, requests,
 * ekBilgiler values, başlık) is stored as PLAIN TEXT (27.09.2026): character
 * hygiene only — controls and zero-width/BiDi characters dropped — and inline
 * fields are folded to one line so an injected newline cannot start a fresh
 * top-level line in any later markdown/docx context. It is NOT entity-escaped
 * here any more: the escapes of the render guard were printed verbatim into
 * the filed DOCX/UDF ("Yılmaz &amp; Kaya"). Each surface escapes for its own
 * medium — the console assigns `textContent`, the Python writers escape XML,
 * and the Markdown export runs `escapeMarkdownText` when it renders.
 */

import { randomUUID } from "node:crypto";
import { extractNumbers, tokenize } from "../llm/lexicalEntailment.js";
import { parseReferences } from "../retrieval/referenceParser.js";
import { paragraphContainsQuote } from "./quoteIntegrity.js";
import {
  ALEYHE_KAYNAK_YOK_TEXT,
  CONFLICT_POINTER_SENTENCE,
  DRAFT_SCHEMA,
  DRAFT_REVIEW_BANNER,
  KARSI_ICTIHAT_SECTION_ID,
  KARSI_ICTIHAT_SECTION_TITLE,
  KAYNAKSIZ_STUB_DEGERLENDIRME_ESIK,
  KAYNAKSIZ_STUB_DEGERLENDIRME_KAYNAK_YOK,
  KAYNAKSIZ_STUB_SEBEPLER,
  NOTE_ALEYHE_YOK,
  NOTE_BEYAN,
  NOTE_KARSIT,
  NOTE_KAYNAKLI,
  NOTE_KAYNAKSIZ,
  NOTE_OLAY_ANLATISI,
  type Draft,
  type DraftClaim,
  type DraftEvidence,
  type DraftEvidencePack,
  type DraftParagraph,
  type DraftParty,
  type DraftRequest,
  type DraftSection,
  type DraftSuggestedFact,
  type DraftUploadInfo,
  type DraftVekil,
  type SlotKind,
} from "./types.js";
import {
  KAPSAM_GENIS,
  KAPSAM_KEY,
  KAPSAM_KISA,
  KAPSAM_SABIT_CUMLE,
  OLAY_ANLATISI_KEY,
  getTemplate,
  validateEkBilgiler,
  validateRequiredFields,
  type DraftTemplate,
  type FieldIssue,
  type TemplateField,
  type TemplateSection,
  type TemplateSlot,
} from "./templates.js";
import {
  addresseeDative,
  dateSortKey,
  formatDateTr,
  istanbulDateIso,
  narrativeSearchSuggestion,
  splitLines,
  splitNarrativeSentences,
  todayTr,
} from "./input.js";
import {
  findUnfilledPlaceholders,
  missingFieldPlaceholder,
  placeholderTokens,
  placeholderWarning,
} from "./placeholders.js";
import { computeDeadline } from "../deadlines/calc.js";
import { DEADLINE_DISCLAIMER } from "../deadlines/rules.js";
import { extractDateTr } from "./evidence.js";
import {
  assessEvidenceRelevance,
  isIrrelevant,
  relevanceWarning,
  type RelevanceAssessment,
} from "./relevance.js";
import {
  buildEkDogrulamaSection,
  draftPlainText,
  groupUploads,
  inlineText,
  karsiIctihatParagraphText,
  sebeplerParagraphText,
  uploadDelillerLine,
} from "./appendix.js";

/**
 * Fraction of a quote's unique content tokens that must appear in a paragraph
 * before the quote's evidence id may be attached to it. Evidence-bound
 * paragraphs embed their quotes verbatim, so legitimate attachments sit at
 * ~1.0; unrelated evidence lands near 0. The number check is hard for the
 * same reason it is hard in lexicalEntailment: "5237" vs "5271" changes the
 * law being cited.
 */
export const QUOTE_OVERLAP_FLOOR = 0.7;

/**
 * True when `paragraphText` lexically contains `quote`: token overlap at or
 * above the floor AND every number-like token of the quote present.
 *
 * W14/B-01: this is NO LONGER the binding guard. It is kept, exported and
 * tested because it is the right (and only sensible) measure for text that is
 * NOT a verbatim quote; the binding decision is made by
 * `evidenceBindingHolds` below, which additionally demands exact containment.
 * A lexical floor cannot see a Turkish penalty written in words
 * (`üç yıldan yedi yıla` -> `beş yıldan on yıla`) — that is W13-UXAUDIT P0-1.
 */
export function evidenceOverlaps(paragraphText: string, quote: string): boolean {
  const quoteTokens = [...new Set(tokenize(quote))];
  if (quoteTokens.length === 0) return false;
  const paragraphTokens = new Set(tokenize(paragraphText));
  let matched = 0;
  for (const token of quoteTokens) if (paragraphTokens.has(token)) matched += 1;
  if (matched / quoteTokens.length < QUOTE_OVERLAP_FLOOR) return false;
  const paragraphNumbers = extractNumbers(paragraphText);
  for (const n of extractNumbers(quote)) {
    if (!paragraphNumbers.has(n)) return false;
  }
  return true;
}

/**
 * THE binding guard (W14 · B-01). A paragraph may carry an evidence id only
 * while it still contains that evidence's quote verbatim, in the canonical
 * form both runtimes agree on (`quoteIntegrity.ts`, mirrored by
 * `export/draft.py`). Strictly stronger than `evidenceOverlaps`: exact
 * containment implies full token and number overlap.
 */
export function evidenceBindingHolds(paragraphText: string, quote: string): boolean {
  return paragraphContainsQuote(paragraphText, quote);
}

/** Raised when the request cannot be composed; routes answer a typed 400. */
export class DraftValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: FieldIssue[],
  ) {
    super(message);
    this.name = "DraftValidationError";
  }
}

export interface ComposeOptions {
  now?: () => Date;
  draftId?: string;
}

// ---------------------------------------------------------------------------
// Sanitization helpers — user strings are untrusted (brief 12.1 rule 3)
// ---------------------------------------------------------------------------

/** A user string as single-line plain text (names, titles, items). */
function inline(value: string): string {
  return inlineText(value);
}

/** Turkish upper-case (İ/ı-correct). */
function upperTr(value: string): string {
  return value.toLocaleUpperCase("tr-TR");
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** ekBilgiler value as a sanitized inline string, or undefined. */
function bilgiString(ek: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = ek?.[key];
  if (typeof value === "string" && value.trim() !== "") return inline(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * ekBilgiler value as a sanitized string array, or undefined. Accepts an
 * array OR a multiline string (console textareas) — the W12 fix for the
 * usul itirazları / deliller / özel şartlar loss.
 */
function bilgiList(ek: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const items = splitLines(ek?.[key]).map(inline).filter((item) => item !== "");
  return items.length > 0 ? items : undefined;
}

/** "Av. Ad Soyad" — prefix once, never twice. */
function avName(ad: string): string {
  const clean = inline(ad);
  return /^av\.?\s/iu.test(clean) ? clean : `Av. ${clean}`;
}

/** "Av. X (İstanbul Barosu, Sicil No: 123)" */
function vekilLine(vekil: DraftVekil): string {
  const details: string[] = [];
  if (nonEmpty(vekil.baro)) details.push(inline(vekil.baro));
  if (nonEmpty(vekil.sicilNo)) details.push(`Sicil No: ${inline(vekil.sicilNo)}`);
  return details.length > 0 ? `${avName(vekil.ad)} (${details.join(", ")})` : avName(vekil.ad);
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface ComposeState {
  request: DraftRequest;
  template: DraftTemplate;
  pack: DraftEvidencePack | undefined;
  warnings: string[];
  machineWarnings: string[];
  paragraphCounter: number;
  /** Evidence ids actually attached to at least one paragraph. */
  citedEvidenceIds: Set<string>;
  createdAt: string;
  now: Date;
  /** Memoized HUKUKÎ SEBEPLER entry selection. */
  sebepler?: DraftEvidence[];
  /**
   * Relevance verdict per non-upload evidence id (W12-FIX2, relevance.ts).
   * Entries with an irrelevant verdict never seed a hukukî değerlendirme,
   * a HUKUKÎ SEBEP or a karşı içtihat paragraph.
   */
  relevance: Map<string, RelevanceAssessment>;
  /** Memoized usable claims (relevance-filtered; warnings emitted once). */
  usable?: DraftClaim[];
  /**
   * 27.09.2026: true when the draft's own dates show the template's statutory
   * period (`template.sure`) has run out; slots then use `textSureGecti`.
   */
  sureGecti: boolean;
  /** Ids of `liste` paragraphs that are only an emptyText placeholder. */
  emptyListParagraphs: Set<string>;
}

function nextParagraph(
  state: ComposeState,
  sectionId: string,
  role: SlotKind,
  text: string,
  init: Partial<Pick<DraftParagraph, "evidenceIds" | "supported" | "note" | "placeholders">> = {},
): DraftParagraph {
  state.paragraphCounter += 1;
  const paragraph: DraftParagraph = {
    id: `p-${sectionId}-${state.paragraphCounter}`,
    text,
    evidenceIds: init.evidenceIds ?? [],
    supported: init.supported ?? true,
    role,
  };
  const note = init.note ?? NOTE_BEYAN;
  if (note !== "") paragraph.note = note;
  // Only tokens the paragraph really carries: a system string the text does
  // not contain is not a placeholder of this paragraph.
  const placeholders = [...new Set(init.placeholders ?? [])].filter((t) => t !== "" && text.includes(t));
  if (placeholders.length > 0) paragraph.placeholders = placeholders;
  for (const id of paragraph.evidenceIds) state.citedEvidenceIds.add(id);
  return paragraph;
}

function fieldFor(state: ComposeState, key: string): TemplateField | undefined {
  return state.template.fields.find((f) => f.path === `matter.ekBilgiler.${key}`);
}

// ---------------------------------------------------------------------------
// Olay anlatısı — the lawyer's own free-text account (W16 şerit E, ADR-021)
// ---------------------------------------------------------------------------

/**
 * The account as the lawyer typed it, or undefined.
 *
 * It is read ONLY on a template that offers the field. A value sent to a
 * template without it is left alone: a free-text block silently appearing in
 * a document whose form never asked for one is the kind of surprise this
 * product does not do.
 */
function narrativeText(state: ComposeState): string | undefined {
  if (fieldFor(state, OLAY_ANLATISI_KEY) === undefined) return undefined;
  const value = state.request.matter.ekBilgiler?.[OLAY_ANLATISI_KEY];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The account as document paragraphs: one per blank-line-separated block,
 * sanitized and folded to a single line.
 *
 * EVERY one of them is `supported:false` (ADR-021, W16 şerit E). This is not
 * a punishment and not a defect report — it is the literal truth the export
 * then prints: the paragraph is the lawyer's own statement and is not bound
 * to a verified source. The composer's warning says exactly that, so the
 * "⚠ KAYNAKSIZ" stamp on it cannot be read as "we could not find law for it".
 * Nothing here ever carries an `evidenceIds` entry, so an account can never
 * become a Dayanak by any later path either.
 */
function narrativeParagraphs(state: ComposeState, sectionId: string): DraftParagraph[] {
  const text = narrativeText(state);
  if (text === undefined) return [];
  return text
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => inline(block))
    .filter((block) => block !== "")
    .map((block) =>
      nextParagraph(state, sectionId, "olaylar", block, {
        supported: false,
        note: NOTE_OLAY_ANLATISI,
      }),
    );
}

/** How many dated sentences of an account may be offered as facts. */
export const MAX_NARRATIVE_FACTS = 12;

/**
 * Dated sentences of the account, offered as `suggestedFacts`.
 *
 * Only DATED sentences (W16 şerit E step 1a): a sentence with no date is not
 * a chronology item, and the account itself is already in the document as
 * beyan. The date extractor is the ONE the upload lane uses
 * (`evidence.ts::extractDateTr`) — two spellings of "the date we found" would
 * be two products. `fileId`/`chunkId` stay ABSENT: an account has no file and
 * no passage, and a made-up provenance is worse than a missing one.
 */
function narrativeFacts(text: string): DraftSuggestedFact[] {
  const out: DraftSuggestedFact[] = [];
  const seen = new Set<string>();
  for (const sentence of splitNarrativeSentences(text)) {
    const tarih = extractDateTr(sentence);
    if (tarih === undefined) continue;
    const metin = inline(sentence);
    if (metin === "") continue;
    const key = metin.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tarih, metin, kaynak: "olay-anlatisi" });
    if (out.length >= MAX_NARRATIVE_FACTS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dayanak kapsamı — "kısa" / "geniş" (W16 şerit E)
// ---------------------------------------------------------------------------

/** The two scopes, as the composer reasons about them. */
export type DayanakKapsami = "kisa" | "genis";

/**
 * The scope the request chose, or undefined when the template offers no
 * choice, the field is empty, or the value is not one of the two. An
 * unrecognized value is REPORTED and treated as "kısa": a scope we did not
 * understand must not silently widen the source set.
 */
function kapsamOf(state: ComposeState): DayanakKapsami | undefined {
  if (fieldFor(state, KAPSAM_KEY) === undefined) return undefined;
  const raw = state.request.matter.ekBilgiler?.[KAPSAM_KEY];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLocaleLowerCase("tr-TR");
  if (value === "") return undefined;
  if (value === KAPSAM_GENIS.toLocaleLowerCase("tr-TR")) return "genis";
  if (value === KAPSAM_KISA.toLocaleLowerCase("tr-TR")) return "kisa";
  state.warnings.push(
    `Dayanak kapsamı olarak '${inline(raw)}' anlaşılmadı; kısa kapsam uygulandı.` +
      ` Seçenekler: ${KAPSAM_KISA} / ${KAPSAM_GENIS}.`,
  );
  return undefined;
}

/**
 * Put `value` into every `{key}` of `text` — without doubling what the
 * template already says around it (27.09.2026):
 *  - a value that ends with the word the template writes right after the
 *    placeholder loses that word ("{sure} gün" + "7 (yedi) gün" printed
 *    "7 (yedi) gün gün");
 *  - a value that ends with "." before a template "." loses its own period
 *    ("{karar}." + "… K. 2026/40." printed "K. 2026/40..").
 */
export function fillPlaceholder(text: string, key: string, value: string): string {
  const marker = `{${key}}`;
  const parts = text.split(marker);
  if (parts.length === 1) return text;
  let out = parts[0] as string;
  for (let i = 1; i < parts.length; i += 1) {
    const after = parts[i] as string;
    let filled = value;
    const nextWord = /^\s+(\p{L}+)/u.exec(after)?.[1];
    if (nextWord !== undefined) {
      const lastWord = /\s(\p{L}+)$/u.exec(filled)?.[1];
      if (
        lastWord !== undefined &&
        lastWord.toLocaleLowerCase("tr-TR") === nextWord.toLocaleLowerCase("tr-TR")
      ) {
        filled = filled.replace(/\s+\p{L}+$/u, "");
      }
    }
    if (after.startsWith(".")) filled = filled.replace(/\.+$/u, "");
    out += filled + after;
  }
  return out;
}

/** A filled clause and the system placeholders it carries. */
interface FilledClause {
  text: string;
  placeholders: string[];
}

// ---------------------------------------------------------------------------
// Süre — may the document say "süresi içinde"? (27.09.2026)
// ---------------------------------------------------------------------------

/**
 * The date a decision künye names, as YYYY-MM-DD: the one after "T." first
 * ("…, K. 2026/4, T. 01.02.2026"), else the last full date in the line.
 * Undefined when the künye carries no readable date.
 */
export function decisionDateOf(kunye: string): string | undefined {
  const marked = /\bT\.?\s*:?\s*(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2})/u.exec(kunye)?.[1];
  if (marked !== undefined) return dateSortKey(marked);
  const all = [...kunye.matchAll(/\b(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2})\b/gu)];
  const last = all[all.length - 1]?.[1];
  return last === undefined ? undefined : dateSortKey(last);
}

/**
 * THE DEFECT. An icra itiraz with a tebliğ of 03.08.2026 and a dilekçe dated
 * 27.09.2026 still said "işbu itiraz İİK m.62/1'deki yedi günlük süre içinde
 * yapılmaktadır" — a filed document asserting a timeliness its own dates
 * contradict. And an istinaf accepted a tebliğ date earlier than the decision
 * it served, without a word.
 *
 * THE RULE. The last day is computed by the deadlines engine
 * (`computeDeadline`, the SAME rule the Süreler screen uses) from the
 * template's `sure`. When the document's own date — `matter.tarih`, else
 * today in Türkiye — is after it, `state.sureGecti` switches every slot that
 * has a `textSureGecti` to the wording that keeps the tebliğ FACT and drops
 * the "süresi içinde" CLAIM, and a loud warning (with the deadline
 * disclaimer, verbatim: it shows a computed date) says why. Nothing here
 * refuses a draft: a late filing can still be made (e.g. İİK m.65), it just
 * may not say it is on time.
 */
function assessTimeliness(state: ComposeState): void {
  const sure = state.template.sure;
  if (sure === undefined) return;
  const ek = state.request.matter.ekBilgiler;
  const rawStart = ek?.[sure.baslangicKey];
  if (typeof rawStart !== "string" || rawStart.trim() === "") return;
  const label = fieldFor(state, sure.baslangicKey)?.label ?? sure.baslangicKey;
  const start = dateSortKey(rawStart);
  if (start === undefined) {
    state.warnings.push(
      `'${label}' tarih olarak okunamadı (${inline(rawStart)}); belgedeki süre ifadesi` +
        " hesaplanan son günle karşılaştırılamadı — süreyi Süreler ekranında doğrulayın.",
    );
    return;
  }
  if (sure.kararKey !== undefined) {
    const rawKarar = ek?.[sure.kararKey];
    const kararDate = typeof rawKarar === "string" ? decisionDateOf(rawKarar) : undefined;
    if (kararDate !== undefined && start < kararDate) {
      state.warnings.push(
        `⚠ TARİH TUTARSIZ: kararın tebliğ tarihi (${formatDateTr(start)}) kararın kendi` +
          ` tarihinden (${formatDateTr(kararDate)}) önce görünüyor; bir karar verilmeden` +
          " tebliğ edilemez. Tarihlerden biri yanlış yazılmış olabilir — tebliğ tarihini ve" +
          " karar künyesini kontrol edin.",
      );
    }
  }
  let computed;
  try {
    computed = computeDeadline({ ruleId: sure.ruleId, startDate: start });
  } catch {
    // A date the engine cannot use (e.g. not a real calendar day) leaves the
    // text as written; the engine's own screen will say why.
    return;
  }
  const own = state.request.matter.tarih;
  const docDate =
    (own !== undefined && own.trim() !== "" ? dateSortKey(own) : undefined) ??
    istanbulDateIso(state.now);
  if (docDate <= computed.dueDate) return;
  state.sureGecti = true;
  state.warnings.push(
    `⚠ SÜRE GEÇMİŞ GÖRÜNÜYOR: ${label} ${formatDateTr(start)}; ` +
      `'${computed.rule?.title ?? sure.ruleId}' için hesaplanan son gün ${computed.dueDateTr},` +
      ` belge tarihi ${formatDateTr(docDate)} bu günden sonradır. Taslak bu nedenle "süresi` +
      ` içinde" DEMİYOR; süreyi ve varsa gecikme sebebini avukat kontrol etmelidir.` +
      ` ${DEADLINE_DISCLAIMER}`,
  );
}

/** Why a placeholder-only section is not in the draft (27.09.2026). */
function omittedSectionWarning(state: ComposeState, section: TemplateSection): string {
  const slot = section.slots.find((s) => s.kind === "liste" && s.omitSectionWhenEmpty === true);
  const field = slot?.bilgiKey !== undefined ? fieldFor(state, slot.bilgiKey) : undefined;
  const label = field?.label ?? section.title;
  return (
    `'${label}' alanı boş bırakıldığı için ${section.title} bölümü taslağa yazılmadı;` +
    " gerekiyorsa alanı doldurup taslağı yeniden oluşturun." +
    (field?.help !== undefined ? ` ${field.help}` : "")
  );
}

function fillHukum(state: ComposeState, slot: TemplateSlot): FilledClause | undefined {
  const ek = state.request.matter.ekBilgiler;
  const authored =
    state.sureGecti && slot.textSureGecti !== undefined ? slot.textSureGecti : (slot.text ?? "");
  // Placeholders are taken from the AUTHORED text and from the missing-field
  // form below — never from a value the lawyer typed ("[bkz. Ek-1]").
  const placeholders = placeholderTokens(authored);
  let text = authored;
  for (const key of slot.bilgi ?? []) {
    if (!text.includes(`{${key}}`)) continue;
    const field = fieldFor(state, key);
    const label = field?.label ?? key;
    let value = bilgiString(ek, key);
    if (value !== undefined && field?.kind === "date") value = formatDateTr(value);
    if (value === undefined) {
      if (slot.omitIfMissing === true) return undefined;
      // Human placeholder (W12): the field's label, never the machine key.
      const token = missingFieldPlaceholder(label);
      text = text.replaceAll(`{${key}}`, token);
      placeholders.push(token);
      state.warnings.push(
        `'${label}' alanı verilmedi; ilgili hüküm '${token}' olarak bırakıldı.`,
      );
    } else {
      text = fillPlaceholder(text, key, value);
    }
  }
  return { text, placeholders };
}

/** True when the relevance gate parked this evidence id. */
function gated(state: ComposeState, evidenceId: string): boolean {
  const verdict = state.relevance.get(evidenceId)?.verdict;
  // W16 şerit E — dayanak kapsamı. "Geniş" DOĞRULAMAYI değil, İLGİLİLİK
  // SÜZGECİNİ açar: sorunun sözcükleriyle örtüşmediği için park edilen bir
  // kaynak (NOT_RELEVANT) bağlanabilir hâle gelir. Alan uyuşmazlığı
  // (DOMAIN_MISMATCH) HER İKİ kapsamda da kapalı kalır — bir kira dilekçesine
  // ceza dairesi kararı koymak genişlik değil gürültüdür (W12-FIX2).
  // Alıntı bütünlüğü, atıf kapanımı ve KAYNAKSIZ sayımı iki kapsamda AYNIDIR.
  if (verdict === "NOT_RELEVANT" && kapsamOf(state) === "genis") return false;
  return isIrrelevant(verdict);
}

/**
 * Usable claims: pack claims whose validated evidence list is non-empty
 * AFTER the relevance gate. A claim resting only on evidence the gate parked
 * (a TCK m.157 claim under a kira cevap dilekçesi) is not written at all —
 * not as a Dayanak, not as KAYNAKSIZ prose — and is reported once.
 */
function usableClaims(state: ComposeState): DraftClaim[] {
  if (state.usable !== undefined) return state.usable;
  if (state.pack === undefined) return (state.usable = []);
  const out: DraftClaim[] = [];
  for (const claim of state.pack.claims) {
    if (claim.evidenceIds.length === 0) continue;
    const kept = claim.evidenceIds.filter((id) => !gated(state, id));
    if (kept.length === 0) {
      const codes = [...new Set(claim.evidenceIds.map((id) => state.relevance.get(id)?.verdict ?? "?"))];
      state.machineWarnings.push(
        `${claim.claimId}: dayandığı kanıtlar bu belgeyle alakasız görünüyor (${codes.join("+")}); taslağa yazılmadı.`,
      );
      continue;
    }
    out.push(kept.length === claim.evidenceIds.length ? claim : { ...claim, evidenceIds: kept });
  }
  return (state.usable = out);
}

function evidenceById(state: ComposeState, id: string): DraftEvidence | undefined {
  return state.pack?.evidence.find((entry) => entry.evidenceId === id);
}

/** Uploaded files in the pack (summaries first; grouped entries as fallback). */
function packUploads(state: ComposeState): DraftUploadInfo[] {
  if (state.pack === undefined) return [];
  if (state.pack.uploads !== undefined && state.pack.uploads.length > 0) return state.pack.uploads;
  return groupUploads(state.pack.evidence);
}

// ---- party block (HMK m.119) ------------------------------------------------

/** "av. ayşe kaya" for "Av. Ayşe Kaya" and "Ayşe Kaya": one person, one key. */
function vekilKey(ad: string): string {
  return avName(ad).toLocaleLowerCase("tr-TR").replace(/\s+/gu, " ");
}

/**
 * The vekil printed under a party (HMK m.119/1-c: the vekil's ADDRESS is a
 * mandatory element). 27.09.2026: a client-side party whose own record names
 * the vekil (ad/baro/sicil, no address) used to shadow the matter-level vekil
 * entirely, so `matter.vekil.adres` never reached the petition. When both
 * records name the SAME lawyer they are merged, the party's own fields
 * winning; a different lawyer on the party record is never given the other
 * lawyer's address.
 */
function partyVekil(taraf: DraftParty, matterVekil: DraftVekil | undefined): DraftVekil | undefined {
  const own = taraf.vekil;
  if (matterVekil === undefined) return own;
  if (own === undefined) return matterVekil;
  if (!nonEmpty(own.ad) || !nonEmpty(matterVekil.ad) || vekilKey(own.ad) !== vekilKey(matterVekil.ad)) {
    return own;
  }
  const merged: DraftVekil = { ...matterVekil };
  for (const [key, value] of Object.entries(own) as [keyof DraftVekil, string | undefined][]) {
    if (typeof value === "string" && value.trim() !== "") merged[key] = value;
  }
  return merged;
}

function partyParagraphs(state: ComposeState, sectionId: string): DraftParagraph[] {
  const { matter } = state.request;
  const out: DraftParagraph[] = [];
  const add = (text: string): void => {
    out.push(nextParagraph(state, sectionId, "taraflar", text));
  };
  if (nonEmpty(matter.esasNo)) add(`DOSYA NO : ${inline(matter.esasNo)}`);

  const firstClient = matter.taraflar.find(
    (t) => !inline(t.rol).toLocaleLowerCase("tr-TR").includes("vekil"),
  );
  matter.taraflar.forEach((taraf) => {
    let head = `${upperTr(inline(taraf.rol))} : ${inline(taraf.ad)}`;
    if (nonEmpty(taraf.tckn)) head += ` (T.C. Kimlik No: ${inline(taraf.tckn)})`;
    else if (nonEmpty(taraf.vkn)) head += ` (Vergi No: ${inline(taraf.vkn)})`;
    add(head);
    if (nonEmpty(taraf.adres)) add(`Adres : ${inline(taraf.adres)}`);
    const vekil = partyVekil(taraf, taraf === firstClient ? matter.vekil : undefined);
    if (vekil !== undefined && nonEmpty(vekil.ad)) {
      add(`VEKİLİ : ${vekilLine(vekil)}`);
      if (nonEmpty(vekil.adres)) add(`Adres : ${inline(vekil.adres)}`);
    }
  });
  if (nonEmpty(matter.davaDegeri)) add(`DAVA DEĞERİ : ${inline(matter.davaDegeri)}`);
  return out;
}

// ---- signature block -------------------------------------------------------

function signatureParagraphs(
  state: ComposeState,
  sectionId: string,
  slot?: TemplateSlot,
): DraftParagraph[] {
  const { matter } = state.request;
  const ek = matter.ekBilgiler;
  const date = nonEmpty(matter.tarih) ? formatDateTr(inline(matter.tarih)) : todayTr(state.now);
  const yer = bilgiString(ek, "yer");
  const dateLine = yer !== undefined ? `${yer}, ${date}` : date;
  const lines: DraftParagraph[] = [nextParagraph(state, sectionId, "imza", dateLine)];

  if (state.template.kind === "sozlesme") {
    for (const taraf of matter.taraflar) {
      lines.push(
        nextParagraph(
          state,
          sectionId,
          "imza",
          `${upperTr(inline(taraf.rol))} : ${inline(taraf.ad)} — (imza)`,
        ),
      );
    }
    return lines;
  }

  // Dilekçe: matter.vekil first, then the first party that carries a vekil.
  let vekil: DraftVekil | undefined;
  let owner: DraftParty | undefined;
  if (matter.vekil !== undefined && nonEmpty(matter.vekil.ad)) {
    vekil = matter.vekil;
    owner = matter.taraflar.find(
      (t) => !inline(t.rol).toLocaleLowerCase("tr-TR").includes("vekil"),
    );
  } else {
    owner = matter.taraflar.find((t) => t.vekil !== undefined && nonEmpty(t.vekil.ad));
    vekil = owner?.vekil;
  }
  if (vekil !== undefined) {
    // 27.09.2026: `rolSatiri:false` (hukukî mütalaa) — the lawyer signs the
    // opinion in their own name, not as "MÜTALAA İSTEYEN VEKİLİ".
    if (slot?.rolSatiri !== false) {
      const role = owner !== undefined ? `${upperTr(inline(owner.rol))} VEKİLİ` : "VEKİL";
      lines.push(nextParagraph(state, sectionId, "imza", role));
    }
    lines.push(nextParagraph(state, sectionId, "imza", `${vekilLine(vekil)} — (imza)`));
    return lines;
  }
  if (slot?.rolSatiri === false) {
    // A lawyer's own document with no lawyer named: never signed by a party
    // (the old fallback signed a mütalaa as "MÜTALAA İSTEYEN — Mehmet
    // Yılmaz"). A visible placeholder; the NİHAİ copy refuses it.
    const token = missingFieldPlaceholder("Belgeyi imzalayan avukat");
    lines.push(nextParagraph(state, sectionId, "imza", `${token} — (imza)`, { placeholders: [token] }));
    return lines;
  }
  // Legacy shape: a party whose role already says "vekili", else the first party.
  const imzaci =
    matter.taraflar.find((t) => inline(t.rol).toLocaleLowerCase("tr-TR").includes("vekil")) ??
    matter.taraflar[0];
  if (imzaci !== undefined) {
    lines.push(nextParagraph(state, sectionId, "imza", upperTr(inline(imzaci.rol))));
    lines.push(nextParagraph(state, sectionId, "imza", `${inline(imzaci.ad)} — (imza)`));
  }
  return lines;
}

// ---- legal assessment -------------------------------------------------------

function assessmentParagraph(
  state: ComposeState,
  sectionId: string,
  claim: DraftClaim,
): DraftParagraph | undefined {
  // Paragraph text is the claim text itself: citation label + verbatim
  // quotes, exactly what RuleBasedDrafter emitted — never new prose. A
  // conflicted claim additionally carries the fixed pointer sentence.
  const base = `Doğrulanmış kaynak uyarınca — ${draftPlainText(claim.text)}`;
  const text = claim.conflicted === true ? `${base} ${CONFLICT_POINTER_SENTENCE}` : base;
  const attached: string[] = [];
  let uploadOnly = true;
  for (const evidenceId of claim.evidenceIds) {
    const entry = evidenceById(state, evidenceId);
    if (entry === undefined) {
      uploadOnly = false;
      state.warnings.push(
        "Bir hukukî değerlendirme, belgede bulunmayan bir kaynağa atıf yaptı;" +
          " atıf yazılmadı.",
      );
      continue;
    }
    if (entry.source === "UPLOAD") {
      // Audit #4: an uploaded document is an exhibit, never a legal source.
      continue;
    }
    uploadOnly = false;
    if (entry.direction === "karşıt") {
      // Defense in depth: the drafter never drafts contrary claims, but
      // a contrary passage must not back an affirmative assessment.
      state.warnings.push(
        "Talebin aksi yönündeki bir karar, hukukî değerlendirmeye dayanak yazılmadı;" +
          " karar KARŞI İÇTİHAT bölümünde listelendi.",
      );
      continue;
    }
    if (!evidenceBindingHolds(text, entry.quote)) {
      // W14/B-01: exact containment, not a lexical floor.
      state.warnings.push(
        "Bir kaynağın alıntısı paragraf metninde birebir bulunmadığı için o" +
          " kaynağa atıf yazılmadı; alıntıyı metne geri alın ya da atfı kaldırın.",
      );
      continue;
    }
    attached.push(evidenceId);
  }
  if (attached.length === 0 && uploadOnly && claim.evidenceIds.length > 0) {
    state.machineWarnings.push(
      `${claim.claimId}: yalnızca yüklenen belge parçalarına dayanıyor; hukukî değerlendirmeye yazılmadı (UPLOAD_NOT_LEGAL_SOURCE).`,
    );
    return undefined;
  }
  if (attached.length === 0 && claim.conflicted === true) {
    // The supporting side of a conflicted claim did not survive the guards;
    // its contrary side is already in the karşı içtihat section.
    state.machineWarnings.push(
      `${claim.claimId}: CONFLICTING_AUTHORITIES — destekleyen taraf bağlanamadı; paragraf yazılmadı.`,
    );
    return undefined;
  }
  if (attached.length === 0) {
    // The claim's own evidence did not survive the overlap guard: the
    // text stays visible but is demoted — never a fabricated citation.
    return nextParagraph(state, sectionId, "hukukiDegerlendirme", text, {
      supported: false,
      note: NOTE_KAYNAKSIZ,
    });
  }
  if (claim.conflicted === true) {
    state.machineWarnings.push(
      `${claim.claimId}: CONFLICTING_AUTHORITIES — destekleyen taraf paragraf olarak yazıldı; karşı içtihat ayrı bölümde; işaret cümlesi eklendi.`,
    );
  }
  return nextParagraph(state, sectionId, "hukukiDegerlendirme", text, {
    evidenceIds: attached,
    note: NOTE_KAYNAKLI,
  });
}

// ---- HUKUKÎ SEBEPLER selection (audit #2) -----------------------------------

function normalizeNo(value: string): string {
  return value.replace(/\s+/gu, "").replace(/^0+/u, "");
}

/**
 * The matter's own words: talepler + olaylar + konu + instructions, plus
 * every other string-valued ekBilgiler entry (for a sözleşme the substance
 * — hizmetKonusu, mecur, görev — lives there; a contract has no olaylar).
 */
function matterText(request: DraftRequest): string {
  const { matter } = request;
  const extras = Object.entries(matter.ekBilgiler ?? {})
    .filter((pair): pair is [string, string] => typeof pair[1] === "string")
    .map(([, value]) => value);
  return [
    ...matter.talepler,
    ...matter.olaylar.map((o) => o.metin),
    request.instructions ?? "",
    ...extras,
  ].join("\n");
}

interface MatterReferences {
  laws: Set<string>;
  lawArticles: Set<string>;
  dockets: Set<string>;
}

/** (kanun no, madde) pairs and dockets the matter text itself mentions. */
function matterReferences(state: ComposeState): MatterReferences {
  const text = matterText(state.request);
  const laws = new Set<string>();
  const lawArticles = new Set<string>();
  const dockets = new Set<string>();
  // The parser emits "TBK m. 344" as TWO refs — a legislation ref and an
  // article ref with adjacent spans. Pair an article with the law that
  // immediately precedes it; a bare article with no law in front is ignored.
  const refs = [...parseReferences(text)].sort(
    (a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0),
  );
  let currentLaw: { no: string; end: number } | undefined;
  for (const ref of refs) {
    const start = ref.span?.[0];
    const end = ref.span?.[1];
    if (ref.legislationNo !== undefined) {
      const no = normalizeNo(ref.legislationNo);
      laws.add(no);
      currentLaw = end === undefined ? undefined : { no, end };
      if (ref.articleNo !== undefined) lawArticles.add(`${no}|${normalizeNo(ref.articleNo)}`);
      continue;
    }
    if (ref.kind === "article" && ref.articleNo !== undefined) {
      if (currentLaw !== undefined && start !== undefined && start - currentLaw.end <= 4) {
        lawArticles.add(`${currentLaw.no}|${normalizeNo(ref.articleNo)}`);
      }
      currentLaw = undefined;
      continue;
    }
    if (ref.docketNo !== undefined) dockets.add(normalizeNo(ref.docketNo));
    if (ref.decisionNo !== undefined) dockets.add(normalizeNo(ref.decisionNo));
    currentLaw = undefined;
  }
  // Bare "2023/7810" mentions count too (a docket typed without "E.").
  for (const match of text.matchAll(/\b\d{4}\s*\/\s*\d{1,6}\b/gu)) dockets.add(normalizeNo(match[0]));
  return { laws, lawArticles, dockets };
}

function isLegislation(entry: DraftEvidence): boolean {
  return entry.legislationNo !== undefined && entry.legislationNo !== "";
}

function isDecision(entry: DraftEvidence): boolean {
  return (
    (entry.docketNo !== undefined && entry.docketNo !== "") ||
    (entry.decisionNo !== undefined && entry.decisionNo !== "")
  );
}

/** True when the matter text names this entry by (kanun no, madde) or esas/karar no. */
function referencedByMatter(entry: DraftEvidence, refs: MatterReferences): boolean {
  if (isLegislation(entry)) {
    const no = normalizeNo(entry.legislationNo as string);
    return (
      refs.laws.has(no) &&
      (entry.article === undefined ||
        entry.article === "" ||
        refs.lawArticles.has(`${no}|${normalizeNo(entry.article)}`) ||
        ![...refs.lawArticles].some((pair) => pair.startsWith(`${no}|`)))
    );
  }
  if (isDecision(entry)) {
    return (
      (entry.docketNo !== undefined && refs.dockets.has(normalizeNo(entry.docketNo))) ||
      (entry.decisionNo !== undefined && refs.dockets.has(normalizeNo(entry.decisionNo)))
    );
  }
  return false;
}

/**
 * Evidence entries usable as HUKUKÎ SEBEPLER: mevzuat first, then emsal —
 * but ONLY entries the document relies on: cited by a usable claim, or
 * referenced by (kanun no, madde) / esas no in the matter text. Contrary
 * evidence is never a dayanak (contract A); uploads are exhibits; entries
 * the relevance gate parked (W12-FIX2) never appear here.
 */
function sebeplerEntries(state: ComposeState): DraftEvidence[] {
  if (state.sebepler !== undefined) return state.sebepler;
  if (state.pack === undefined) return (state.sebepler = []);
  const claimCited = new Set<string>();
  for (const claim of usableClaims(state)) for (const id of claim.evidenceIds) claimCited.add(id);
  const refs = matterReferences(state);
  const seen = new Set<string>();
  const mevzuat: DraftEvidence[] = [];
  const emsal: DraftEvidence[] = [];
  for (const entry of state.pack.evidence) {
    if (seen.has(entry.evidenceId)) continue;
    seen.add(entry.evidenceId);
    if (entry.direction === "karşıt") continue;
    if (entry.source === "UPLOAD") continue;
    if (gated(state, entry.evidenceId)) continue;
    const referenced = claimCited.has(entry.evidenceId) || referencedByMatter(entry, refs);
    if (!referenced) continue;
    if (isLegislation(entry)) mevzuat.push(entry);
    else if (isDecision(entry)) emsal.push(entry);
  }
  return (state.sebepler = [...mevzuat, ...emsal]);
}

// ---- slot dispatch ----------------------------------------------------------

function slotParagraphs(
  state: ComposeState,
  section: { id: string },
  slot: TemplateSlot,
): DraftParagraph[] {
  const { matter } = state.request;
  const ek = matter.ekBilgiler;

  switch (slot.kind) {
    case "baslik": {
      let text: string;
      let placeholders: string[] = [];
      if (nonEmpty(matter.baslik)) text = inline(matter.baslik);
      else if (nonEmpty(matter.mahkeme) && state.template.kind === "dilekce") {
        // 27.09.2026: the court's own dative ("YARGITAY'A", not
        // "YARGITAY'NA"), and an input that already carries one is not
        // suffixed twice ("MAHKEMESİ'NE'NE").
        text = addresseeDative(upperTr(inline(matter.mahkeme)));
      } else {
        // The template's default address ("[DAVANIN GÖRÜLDÜĞÜ] MAHKEMESİ'NE")
        // is a placeholder until the lawyer names the court.
        text = slot.text ?? "";
        placeholders = placeholderTokens(text);
      }
      return text === "" ? [] : [nextParagraph(state, section.id, "baslik", text, { placeholders })];
    }

    case "taraflar":
      return partyParagraphs(state, section.id);

    case "konu": {
      const authored =
        state.sureGecti && slot.textSureGecti !== undefined ? slot.textSureGecti : slot.text;
      const own = bilgiString(ek, "konu");
      const text = own ?? authored ?? "";
      const placeholders = own === undefined ? placeholderTokens(authored) : [];
      return text === "" ? [] : [nextParagraph(state, section.id, "konu", text, { placeholders })];
    }

    case "olaylar": {
      // Chronological when every event carries a parseable date; otherwise
      // given order is preserved (a partial sort would reorder the story).
      const keyed = matter.olaylar.map((o) => ({ olay: o, key: dateSortKey(o.tarih) }));
      const olaylar = keyed.every((k) => k.key !== undefined)
        ? [...keyed].sort((a, b) => (a.key as string).localeCompare(b.key as string))
        : keyed;
      const events = olaylar.map(({ olay }, index) => {
        const tarih = nonEmpty(olay.tarih) ? `(${formatDateTr(inline(olay.tarih))}) ` : "";
        return nextParagraph(
          state,
          section.id,
          "olaylar",
          `${index + 1}. ${tarih}${inline(olay.metin)}`,
        );
      });
      // W16 şerit E: the lawyer's own account follows the numbered events, in
      // the SAME section and as beyan (`supported:false`) — never numbered
      // into the chronology, because it was not entered as one.
      return [...events, ...narrativeParagraphs(state, section.id)];
    }

    case "arabuluculuk": {
      const ara = matter.arabuluculuk;
      if (ara === undefined) return [];
      if (ara.yapildi) {
        const tarih = nonEmpty(ara.tarih) ? `${formatDateTr(inline(ara.tarih))} tarihli son tutanakla ` : "";
        const sonuc = nonEmpty(ara.sonuc) ? inline(ara.sonuc) : "anlaşma sağlanamamıştır";
        return [
          nextParagraph(
            state,
            section.id,
            "arabuluculuk",
            `Dava şartı arabuluculuk: ${tarih}arabuluculuk görüşmesi yapılmış, ${sonuc};` +
              " son tutanak dilekçe ekinde sunulmaktadır (HUAK m.18/A).",
          ),
        ];
      }
      state.warnings.push(
        "Arabuluculuk dava şartına tabi uyuşmazlıklarda (iş, ticari, tüketici, kira vb.)" +
          " başvuru yapılmadan açılan dava usulden reddedilir (HUAK m.18/A-2); avukat" +
          " kontrol etmelidir.",
      );
      return [
        nextParagraph(
          state,
          section.id,
          "arabuluculuk",
          "Uyuşmazlık için dava şartı arabuluculuk başvurusu yapılmamıştır.",
        ),
      ];
    }

    case "hukukiDegerlendirme": {
      const claims = usableClaims(state);
      const paragraphs: DraftParagraph[] = [];
      for (const claim of claims) {
        const paragraph = assessmentParagraph(state, section.id, claim);
        if (paragraph !== undefined) paragraphs.push(paragraph);
      }
      if (paragraphs.length === 0) {
        if (slot.zorunlu !== true) return [];
        return [
          nextParagraph(state, section.id, "hukukiDegerlendirme", legalGapText(state), {
            supported: false,
            note: NOTE_KAYNAKSIZ,
            // The stub is an instruction to the lawyer, not court text: the
            // NİHAİ copy refuses while it stands (placeholders.ts).
            placeholders: [legalGapText(state)],
          }),
        ];
      }
      return paragraphs;
    }

    case "hukukiSebepler": {
      const entries = sebeplerEntries(state);
      if (entries.length === 0) {
        if (slot.zorunlu !== true) return [];
        return [
          nextParagraph(
            state,
            section.id,
            "hukukiSebepler",
            KAYNAKSIZ_STUB_SEBEPLER,
            { supported: false, note: NOTE_KAYNAKSIZ, placeholders: [KAYNAKSIZ_STUB_SEBEPLER] },
          ),
        ];
      }
      return entries.map((entry) =>
        nextParagraph(state, section.id, "hukukiSebepler", sebeplerParagraphText(entry), {
          evidenceIds: [entry.evidenceId],
          note: NOTE_KAYNAKLI,
        }),
      );
    }

    case "deliller": {
      const paragraphs: DraftParagraph[] = [];
      let n = 0;
      for (const item of bilgiList(ek, "deliller") ?? []) {
        n += 1;
        paragraphs.push(nextParagraph(state, section.id, "deliller", `${n}. ${item}`));
      }
      packUploads(state).forEach((upload, index) => {
        paragraphs.push(
          nextParagraph(state, section.id, "deliller", uploadDelillerLine(index + 1, upload)),
        );
      });
      if (paragraphs.length === 0) {
        paragraphs.push(
          nextParagraph(
            state,
            section.id,
            "deliller",
            "Deliller, delil listesi ile birlikte ayrıca bildirilecektir.",
          ),
        );
      }
      return paragraphs;
    }

    case "talepler": {
      // A dilekçe petitions a court; a hukukî mütalaa states an opinion. The
      // template decides the wrapper: an absent `giris`/`kapanis` keeps the
      // petition wording, "" drops the line (W16 şerit E).
      const giris = slot.giris ?? "Yukarıda arz ve izah olunan nedenlerle;";
      const kapanis = slot.kapanis ?? "karar verilmesini saygıyla arz ve talep ederiz.";
      const paragraphs: DraftParagraph[] = [];
      if (giris !== "") {
        paragraphs.push(nextParagraph(state, section.id, "talepler", giris));
      }
      matter.talepler.forEach((talep, index) => {
        paragraphs.push(
          nextParagraph(state, section.id, "talepler", `${index + 1}. ${inline(talep)}`),
        );
      });
      if (kapanis !== "") {
        paragraphs.push(nextParagraph(state, section.id, "talepler", kapanis));
      }
      return paragraphs;
    }

    case "imza":
      return signatureParagraphs(state, section.id, slot);

    case "hukum": {
      const clause = fillHukum(state, slot);
      if (clause === undefined || clause.text === "") return [];
      return [
        nextParagraph(state, section.id, "hukum", clause.text, { placeholders: clause.placeholders }),
      ];
    }

    case "liste": {
      const items = slot.bilgiKey === undefined ? undefined : bilgiList(ek, slot.bilgiKey);
      if (items === undefined) {
        const empty = slot.emptyText ?? "";
        if (empty === "") return [];
        const placeholders = placeholderTokens(empty);
        const paragraph = nextParagraph(state, section.id, "liste", empty, { placeholders });
        if (slot.omitSectionWhenEmpty === true && placeholders.length > 0) {
          state.emptyListParagraphs.add(paragraph.id);
        }
        return [paragraph];
      }
      return items.map((item, index) =>
        nextParagraph(state, section.id, "liste", `${index + 1}. ${item}`),
      );
    }

    case "karsiIctihat": {
      // A template that DECLARES this slot owns its aleyhe section: the
      // composer writes the contrary sources here instead of appending its
      // own section (see composeDraft). `zorunlu` means the section may not
      // be left empty — with no contrary source among the draft's own
      // sources the fixed "bulunamadı ≠ yok" sentence is written instead.
      const paragraphs = contraryParagraphs(state, section.id);
      if (paragraphs.length > 0) return paragraphs;
      if (slot.zorunlu !== true) return [];
      return [
        nextParagraph(state, section.id, "karsiIctihat", ALEYHE_KAYNAK_YOK_TEXT, {
          note: NOTE_ALEYHE_YOK,
        }),
      ];
    }

    case "ekDogrulama":
      // Never a template slot: the composer appends this section itself.
      return [];
  }
}

/** Wording of the mandatory-slot placeholder when no evidence was supplied. */
function legalGapText(state: ComposeState): string {
  return state.pack === undefined || state.pack.claims.length === 0
    ? KAYNAKSIZ_STUB_DEGERLENDIRME_KAYNAK_YOK
    : KAYNAKSIZ_STUB_DEGERLENDIRME_ESIK;
}

/**
 * The karşı içtihat section (contract A): one paragraph per contrary
 * evidence entry, each carrying the fixed avukat-decides note. Returns
 * undefined when the pack has no contrary entry — the section is optional
 * and never rendered empty.
 */
/**
 * W16: the contrary paragraphs, built once and used from TWO places — the
 * composer's own appended section (below) and a template that DECLARES a
 * `karsiIctihat` slot and therefore owns its aleyhe section (hukukî mütalaa).
 * Factoring it out is what keeps those two surfaces from drifting: the gate,
 * the dedupe and the fixed avukat-decides note are written once.
 */
function contraryParagraphs(state: ComposeState, sectionId: string): DraftParagraph[] {
  if (state.pack === undefined) return [];
  const seen = new Set<string>();
  const paragraphs: DraftParagraph[] = [];
  for (const entry of state.pack.evidence) {
    if (entry.direction !== "karşıt") continue;
    if (seen.has(entry.evidenceId)) continue;
    seen.add(entry.evidenceId);
    // A contrary decision from another field of law is noise, not a warning
    // the lawyer must weigh (W12-FIX2): it stays in unusedEvidence.
    if (gated(state, entry.evidenceId)) continue;
    paragraphs.push(
      nextParagraph(state, sectionId, "karsiIctihat", karsiIctihatParagraphText(entry), {
        evidenceIds: [entry.evidenceId],
        note: NOTE_KARSIT,
      }),
    );
  }
  return paragraphs;
}

function karsiIctihatSection(state: ComposeState): DraftSection | undefined {
  const paragraphs = contraryParagraphs(state, KARSI_ICTIHAT_SECTION_ID);
  if (paragraphs.length === 0) return undefined;
  return {
    id: KARSI_ICTIHAT_SECTION_ID,
    title: KARSI_ICTIHAT_SECTION_TITLE,
    paragraphs,
  };
}

/**
 * Where the karşı içtihat section belongs: right after the last section that
 * carries a HUKUKÎ SEBEPLER paragraph (the reader meets the contrary
 * authority immediately after the dayanaklar), otherwise before a trailing
 * signature-only section, otherwise at the end.
 */
export function karsiIctihatIndex(sections: readonly DraftSection[]): number {
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const section = sections[i] as DraftSection;
    if (section.paragraphs.some((p) => p.role === "hukukiSebepler")) return i + 1;
  }
  const last = sections[sections.length - 1];
  if (last !== undefined && last.paragraphs.every((p) => p.role === "imza")) {
    return sections.length - 1;
  }
  return sections.length;
}

/**
 * Split the pack's validated entries into the document's closure set
 * (`evidence`) and the entries the document does not use (`unusedEvidence`).
 * Uploaded exhibits always stay in `evidence` — the DELİLLER lines and the
 * doğrulama section describe them by file.
 */
export function partitionEvidence(
  entries: readonly DraftEvidence[],
  sections: readonly DraftSection[],
  /** W12-FIX2: relevance-gate reasons to stamp on parked entries. */
  unusedReasons?: ReadonlyMap<string, "DOMAIN_MISMATCH" | "NOT_RELEVANT">,
): { evidence: DraftEvidence[]; unusedEvidence: DraftEvidence[] } {
  const cited = new Set<string>();
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      for (const id of paragraph.evidenceIds) cited.add(id);
    }
  }
  const evidence: DraftEvidence[] = [];
  const unusedEvidence: DraftEvidence[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.evidenceId)) continue;
    seen.add(entry.evidenceId);
    if (entry.source === "UPLOAD" || cited.has(entry.evidenceId)) {
      // An entry pulled into the document (evidenceUse:true) sheds the gate's mark.
      const { unusedReason: _dropped, ...used } = entry;
      evidence.push(used);
    } else {
      const reason = unusedReasons?.get(entry.evidenceId);
      unusedEvidence.push(reason !== undefined ? { ...entry, unusedReason: reason } : { ...entry });
    }
  }
  return { evidence, unusedEvidence };
}

/** Number of KAYNAKSIZ paragraphs across sections. */
export function countUnsupported(sections: readonly DraftSection[]): number {
  return sections.reduce(
    (count, section) => count + section.paragraphs.filter((p) => !p.supported).length,
    0,
  );
}

/**
 * Compose a Draft. Throws `DraftValidationError` for an unknown template or
 * missing required fields (the API maps it to a typed 400).
 */
export function composeDraft(
  request: DraftRequest,
  evidencePack?: DraftEvidencePack,
  options: ComposeOptions = {},
): Draft {
  const template = getTemplate(request.template);
  if (template === undefined) {
    throw new DraftValidationError("bilinmeyen şablon", [
      { path: "template", message: `şablon bulunamadı: ${request.template}` },
    ]);
  }
  if (template.kind !== request.kind) {
    throw new DraftValidationError("şablon türü uyuşmuyor", [
      {
        path: "kind",
        message: `'${template.id}' şablonunun türü '${template.kind}'; istek '${request.kind}' dedi`,
      },
    ]);
  }
  const fieldIssues = validateRequiredFields(
    template,
    request.matter as unknown as Record<string, unknown>,
  );
  if (fieldIssues.length > 0) {
    throw new DraftValidationError("zorunlu şablon alanları eksik", fieldIssues);
  }
  const ekIssues = validateEkBilgiler(template, request.matter.ekBilgiler);
  if (ekIssues.length > 0) {
    throw new DraftValidationError("ek bilgiler doğrulanamadı", ekIssues);
  }

  const now = (options.now ?? (() => new Date()))();
  const createdAt = now.toISOString();
  const state: ComposeState = {
    request,
    template,
    pack: evidencePack,
    warnings: [],
    machineWarnings: [],
    paragraphCounter: 0,
    citedEvidenceIds: new Set(),
    createdAt,
    now,
    relevance: new Map(),
    sureGecti: false,
    emptyListParagraphs: new Set(),
  };

  // 27.09.2026: decided ONCE, before any slot is filled — the "süresi
  // içinde" sentences and the tebliğ/karar date check read the matter's own
  // dates through the deadlines engine (see assessTimeliness).
  assessTimeliness(state);

  // Relevance gate (W12-FIX2): decided ONCE, before any slot is filled, from
  // the template's field of law, the matter's own words and its explicit
  // references. The verdicts drive usableClaims / sebeplerEntries /
  // karsiIctihatSection below and stamp unusedEvidence at the end.
  if (evidencePack !== undefined) {
    const refs = matterReferences(state);
    state.relevance = assessEvidenceRelevance({
      templateDomain: template.domain,
      matterText: matterText(request),
      entries: evidencePack.evidence,
      referenced: (entry) => referencedByMatter(entry, refs),
    });
  }

  const sections: DraftSection[] = [];
  for (const section of template.sections) {
    const paragraphs: DraftParagraph[] = [];
    for (const slot of section.slots) {
      paragraphs.push(...slotParagraphs(state, section, slot));
    }
    // A section whose every slot produced nothing (all optional) is omitted.
    if (paragraphs.length === 0) continue;
    // 27.09.2026: a section whose ONLY content is an emptyText placeholder
    // of a list that may be absent (KARŞI DAVA, DEF'İLER) does not exist in
    // the document. It used to reach the NİHAİ copy as
    // "[Karşı dava talebi varsa buraya yazın; yoksa bu bölümü silin]".
    if (paragraphs.every((p) => state.emptyListParagraphs.has(p.id))) {
      state.warnings.push(omittedSectionWarning(state, section));
      continue;
    }
    sections.push({ id: section.id, title: section.title, paragraphs });
  }

  // Contrary authority gets its own clearly-labeled section (contract A);
  // it never appears under HUKUKÎ SEBEPLER (see sebeplerEntries).
  const karsi = karsiIctihatSection(state);
  if (karsi !== undefined) {
    sections.splice(karsiIctihatIndex(sections), 0, karsi);
  }

  const unusedReasons = new Map<string, "DOMAIN_MISMATCH" | "NOT_RELEVANT">();
  for (const [evidenceId, assessment] of state.relevance) {
    if (isIrrelevant(assessment.verdict)) unusedReasons.set(evidenceId, assessment.verdict);
  }
  const { evidence, unusedEvidence } = partitionEvidence(
    evidencePack?.evidence ?? [],
    sections,
    unusedReasons,
  );

  // Machine-owned final section: verification summary (W12, audit #5).
  const ekDogrulama = buildEkDogrulamaSection(evidence, sections);
  if (ekDogrulama !== undefined) sections.push(ekDogrulama);

  const unsupportedCount = countUnsupported(sections);

  const warnings: string[] = [DRAFT_REVIEW_BANNER];
  // Relevance gate report: the parked entries by identity (machine line per
  // entry, ONE human sentence) — only for entries that really ended up unused.
  const parked = unusedEvidence.filter((entry) => entry.unusedReason !== undefined);
  if (parked.length > 0) {
    for (const entry of parked) state.machineWarnings.push(`${entry.unusedReason}:${entry.evidenceId}`);
    state.warnings.push(
      relevanceWarning(
        template.domain,
        parked.filter((e) => e.unusedReason === "DOMAIN_MISMATCH").length,
        parked.filter((e) => e.unusedReason === "NOT_RELEVANT").length,
      ),
    );
  }
  if (unsupportedCount > 0) {
    warnings.push(
      `${unsupportedCount} paragraf KAYNAKSIZ: hukukî dayanağı doğrulanamadı ve` +
        " belirgin biçimde işaretlendi. Avukat tamamlamadan kullanılamaz.",
    );
  }
  const synthetic = evidencePack?.synthetic === true;
  if (synthetic) {
    warnings.push(
      "DENEME VERİSİ: bu taslaktaki kaynaklar gerçek değildir; programı denemek" +
        " için üretilmiş örnek metinlerdir.",
    );
  }
  const merelyUncited = unusedEvidence.filter((entry) => entry.unusedReason === undefined).length;
  if (merelyUncited > 0) {
    warnings.push(
      `${merelyUncited} doğrulanmış kaynak taslakta kullanılmadı: hiçbir tespit ve` +
        " talep/olay metni bu kaynağa atıf yapmıyor. Gerekirse düzenleme ekranından" +
        " (kanıt kullanımı) eklenebilir.",
    );
  }
  const uploadFacts = evidencePack?.suggestedFacts ?? [];
  if (uploadFacts.length > 0) {
    warnings.push(
      `Yüklenen belgelerden ${uploadFacts.length} olası olgu cümlesi çıkarıldı ve` +
        " 'önerilen olgular' listesine alındı; dilekçeye OTOMATİK EKLENMEDİ — avukat" +
        " seçerek ekler.",
    );
  }
  // W16 şerit E: the account's DATED sentences join the same list, tagged with
  // their own origin. They are OFFERS, exactly like the upload ones: the
  // account is already in the document as beyan, and a suggestion the lawyer
  // did not pick may never appear in the text.
  const narrative = narrativeText(state);
  const accountFacts = narrative === undefined ? [] : narrativeFacts(narrative);
  if (accountFacts.length > 0) {
    warnings.push(
      `Olay anlatınızdan ${accountFacts.length} tarihli cümle 'önerilen olgular'` +
        " listesine alındı; dilekçeye OTOMATİK EKLENMEDİ — avukat seçerek ekler.",
    );
  }
  const suggestedFacts = [...uploadFacts, ...accountFacts];
  // W16 şerit E: the scope is recorded on the document itself. The fixed
  // sentence goes with it, because "geniş" is the one place a lawyer could
  // reasonably expect MORE TEXT — and what it actually buys is more sources.
  const kapsam = kapsamOf(state);
  if (kapsam !== undefined) {
    warnings.push(
      `Dayanak kapsamı: ${kapsam === "genis" ? KAPSAM_GENIS : KAPSAM_KISA}.` +
        ` ${KAPSAM_SABIT_CUMLE} Her iki kapsamda da aynı doğrulama çalışır.`,
    );
  }
  // 27.09.2026: one line while any system placeholder / KAYNAKSIZ stub is
  // still in the text — the NİHAİ copy is refused until they are gone.
  const openPlaceholders = placeholderWarning(findUnfilledPlaceholders({ sections }));
  if (openPlaceholders !== undefined) warnings.push(openPlaceholders);
  if (request.instructions !== undefined && request.instructions.trim() !== "") {
    // Instructions steer template choice upstream; they are recorded so a
    // reviewer can see them, but they NEVER generate legal prose directly.
    warnings.push(`Kullanıcı talimatı (bilgi amaçlı): ${inline(request.instructions)}`);
  }
  warnings.push(...state.warnings);

  const draft: Draft = {
    schema: DRAFT_SCHEMA,
    draftId: options.draftId ?? `dft-${randomUUID()}`,
    kind: request.kind,
    template: template.id,
    title: template.title,
    createdAt,
    version: 1,
    reviewRequired: true,
    sections,
    evidence,
    unusedEvidence,
    suggestedFacts: suggestedFacts.map((fact) => ({ ...fact })),
    unsupportedCount,
    warnings,
    synthetic,
  };
  if (request.matter.matterId !== undefined) draft.matterId = request.matter.matterId;
  if (state.machineWarnings.length > 0) draft.machineWarnings = [...state.machineWarnings];
  if (evidencePack?.syntheticNotice !== undefined) {
    draft.syntheticNotice = evidencePack.syntheticNotice;
  }
  return draft;
}
