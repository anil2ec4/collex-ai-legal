/**
 * System placeholders in a draft, and the NİHAİ-copy gate that refuses them
 * (27.09.2026).
 *
 * THE DEFECT. The clean filing copy (`annex=none&marks=none`) came out with
 * machine placeholders printed as ordinary body text:
 *
 *   KARŞI DAVA — [Karşı dava talebi varsa buraya yazın; yoksa bu bölümü silin]
 *   KARARIN ÖZETİ — [Kararın özeti — doldurun]
 *   İlk derece kararı: [İlk derece kararı (Mahkeme, E./K., T.) — doldurun].
 *   … dayanak mevzuat avukat tarafından eklenmelidir.
 *
 * The bracketed ones were `supported:true`, so nothing counted them; the
 * KAYNAKSIZ stub lost its ⚠ mark under `marks=none` and read as the lawyer's
 * own sentence. A document that says "doldurun" to a judge is a filed
 * defect, and the copy whose whole purpose is to be filed is where it must
 * stop.
 *
 * THE RULE. The composer records, on each paragraph it writes, the exact
 * system strings it put there (`DraftParagraph.placeholders`). A token is
 * "unfilled" while it is still present in the paragraph's text — a lawyer who
 * types the decision summary over "[Kararın özeti — doldurun]" removes it,
 * one who deletes the paragraph removes it. The NİHAİ copy is refused while
 * any token is unfilled; the TASLAK copies keep printing them, visibly.
 *
 * Drafts stored before this field existed carry no tokens, so the same test
 * runs over a CLOSED list derived from the templates themselves (every
 * bracketed default an address/list/clause slot can write), the
 * "[<alan> — doldurun]" form the composer has always used for a missing
 * field, and the three KAYNAKSIZ stub sentences. User text is never scanned
 * for anything else: "[bkz. Ek-1]" typed by the lawyer is not a placeholder.
 *
 * WHAT THIS DOES NOT TOUCH. `verify_draft_or_refuse` and the quote-integrity
 * gate run identically in every mode (ADR-024). This is an ADDITIONAL gate on
 * the filing copy only — it makes NİHAİ stricter, never any copy looser —
 * and `export/draft.py::refuse_unfilled_placeholders` applies the identical
 * test to the tokens this module writes into the JSON it hands the exporter,
 * so the two layers refuse the same drafts.
 */

import { DRAFT_TEMPLATES } from "./templates.js";
import {
  EK_DOGRULAMA_SECTION_ID,
  KAYNAKSIZ_STUBS,
  type Draft,
  type DraftParagraph,
} from "./types.js";

/** Machine code of the refusal; the Turkish sentence always comes first. */
export const PLACEHOLDER_UNFILLED = "PLACEHOLDER_UNFILLED";

/** Prefix of the one composer/revise warning that lists open placeholders. */
export const PLACEHOLDER_WARNING_PREFIX = "Doldurulmamış yer tutucu:";

/** A bracketed segment of SYSTEM text: "[DAVANIN GÖRÜLDÜĞÜ]", "[… — doldurun]". */
const BRACKET_TOKEN = /\[[^[\]\n]{1,300}\]/gu;

/** The composer's missing-field form, for drafts that predate the field. */
const LEGACY_FIELD_PLACEHOLDER = /\[[^[\]\n]{1,300} — doldurun[^[\]\n]{0,120}\]/gu;

/** Bracketed tokens of a piece of SYSTEM text (a template default). */
export function placeholderTokens(systemText: string | undefined): string[] {
  if (systemText === undefined || systemText === "") return [];
  return [...new Set(systemText.match(BRACKET_TOKEN) ?? [])];
}

/** The composer's wording for a field that was not given. */
export function missingFieldPlaceholder(label: string): string {
  return `[${label} — doldurun]`;
}

let knownTokens: readonly string[] | undefined;

/** Every bracketed default any template can write (closed, derived once). */
function templateTokens(): readonly string[] {
  if (knownTokens !== undefined) return knownTokens;
  const out = new Set<string>();
  for (const template of DRAFT_TEMPLATES) {
    for (const section of template.sections) {
      for (const slot of section.slots) {
        for (const text of [slot.text, slot.emptyText, slot.textSureGecti]) {
          for (const token of placeholderTokens(text)) out.add(token);
        }
      }
    }
  }
  knownTokens = Object.freeze([...out]);
  return knownTokens;
}

/** The unfilled system placeholders of ONE paragraph, in first-seen order. */
export function livePlaceholders(paragraph: Pick<DraftParagraph, "text" | "placeholders">): string[] {
  const text = paragraph.text;
  const out: string[] = [];
  const add = (token: string): void => {
    if (token !== "" && text.includes(token) && !out.includes(token)) out.push(token);
  };
  for (const token of paragraph.placeholders ?? []) add(token);
  // Closed legacy list: drafts stored before `placeholders` existed.
  for (const token of templateTokens()) add(token);
  for (const token of text.match(LEGACY_FIELD_PLACEHOLDER) ?? []) add(token);
  for (const stub of KAYNAKSIZ_STUBS) add(stub);
  return out;
}

/** One unfilled placeholder, located. */
export interface PlaceholderFinding {
  paragraphId: string;
  sectionId: string;
  /** The section heading ("" for an unheaded block such as the address line). */
  sectionTitle: string;
  text: string;
}

/** Every unfilled placeholder of the document body, in document order. */
export function findUnfilledPlaceholders(
  draft: Pick<Draft, "sections">,
): PlaceholderFinding[] {
  const out: PlaceholderFinding[] = [];
  for (const section of draft.sections) {
    if (section.id === EK_DOGRULAMA_SECTION_ID) continue;
    for (const paragraph of section.paragraphs) {
      for (const text of livePlaceholders(paragraph)) {
        out.push({ paragraphId: paragraph.id, sectionId: section.id, sectionTitle: section.title, text });
      }
    }
  }
  return out;
}

/**
 * The draft as handed to the Python exporter: every paragraph's
 * `placeholders` is exactly its unfilled set (legacy drafts included), so
 * `export/draft.py` decides on the same tokens this module decided on.
 */
export function withLivePlaceholders(draft: Draft): Draft {
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs.map((paragraph) => {
        const { placeholders: _stored, ...rest } = paragraph;
        const live = section.id === EK_DOGRULAMA_SECTION_ID ? [] : livePlaceholders(paragraph);
        return live.length > 0 ? { ...rest, placeholders: live } : rest;
      }),
    })),
  };
}

/** Short, quotable form of a token for a sentence (stubs are long). */
function shortToken(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const points = [...flat];
  return points.length <= 80 ? flat : `${points.slice(0, 77).join("")}…`;
}

/** Where a finding sits, in words the lawyer can find on the page. */
function whereOf(finding: PlaceholderFinding): string {
  return finding.sectionTitle !== "" ? finding.sectionTitle : "başlık/imza satırı";
}

/**
 * The warning the composer and every revision write while placeholders are
 * open. ONE line, recomputed on every save.
 */
export function placeholderWarning(findings: readonly PlaceholderFinding[]): string | undefined {
  if (findings.length === 0) return undefined;
  const where = [...new Set(findings.map(whereOf))].join(", ");
  return (
    `${PLACEHOLDER_WARNING_PREFIX} taslakta ${findings.length} doldurulmamış yer tutucu veya` +
    ` avukata not satırı var (${where}). Nihai (dosyalanacak) kopya bunlar doldurulana ya da` +
    " silinene kadar alınamaz; taslak kopyası alınabilir."
  );
}

/** The refusal sentence of the NİHAİ export (Turkish first, code last). */
export function placeholderRefusalMessage(findings: readonly PlaceholderFinding[]): string {
  const named = findings
    .slice(0, 6)
    .map((f) => `'${shortToken(f.text)}' (${whereOf(f)})`)
    .join("; ");
  const more = findings.length > 6 ? ` ve ${findings.length - 6} tane daha` : "";
  return (
    "Nihai kopya REDDEDİLDİ: taslakta doldurulmamış yer tutucu veya avukata not satırı var —" +
    ` ${named}${more}. Bunları doldurun ya da paragrafı silin; işaretli taslak kopyası` +
    ` alınabilir. Dosya yazılmadı. (${PLACEHOLDER_UNFILLED})`
  );
}
