/**
 * Quote integrity gate (W14 · B-01).
 *
 * WHY THIS EXISTS. A lawyer opened the editor, attached evidence K-1 to a
 * paragraph, and then edited the text INSIDE the quoted passage
 * (`üç yıldan yedi yıla` -> `beş yıldan on yıla`, `MADDE 157` -> `MADDE 158`).
 * Nothing caught it: the chip stayed whole, no `⚠ KAYNAKSIZ` appeared, the
 * save returned `issues: []`, and the export produced a document in which a
 * FABRICATED criminal penalty carried a "Dayanak [K-1]" attribution
 * (W13-UXAUDIT P0-1). The single promise this product makes was broken in
 * the one place it is supposed to hold.
 *
 * The old guard (`composer.ts::evidenceOverlaps`) is LEXICAL: 70 % of the
 * quote's unique tokens plus every number-like token. Turkish statutes write
 * durations and penalties in WORDS (`üç yıldan yedi yıla`, `otuz gün`), so
 * `extractNumbers` never sees them, and changing two words out of thirty-five
 * does not move a 0.7 floor. `157 -> 158` survived too, because `157` was
 * still present elsewhere in the paragraph (the künye).
 *
 * THE RULE NOW. If a paragraph carries an `evidenceId`, that evidence's
 * canonical quote must be present in the paragraph as an EXACT SUBSTRING of
 * the canonical text. No threshold, no scoring. The lexical floor keeps its
 * job only for text that is NOT a quote.
 *
 * CANONICALIZATION (mirrored verbatim by `export/draft.py::canonical_quote_text`
 * — change both or neither):
 *   1. fold the render guard's entity escapes back (`&lt;` `&gt;` `&#40;`
 *      `&#58;` `&#46;` and finally `&amp;`), because paragraph text has been
 *      through `sanitizeMarkdown` while `evidence.quote` is stored raw;
 *   2. drop zero-width / BiDi controls (they are invisible, so they must not
 *      decide whether a citation holds);
 *   3. NFC-normalize (ADR-003: canonical text is NFC);
 *   4. collapse every whitespace run to one space and trim.
 *
 * Step 4 makes the check insensitive to re-wrapping and to a newline becoming
 * a space, and to NOTHING else: one changed letter, digit or word breaks it.
 *
 * OFFSET DISCIPLINE. Everything here is substring search and `String.replace`
 * over whole strings — no `.length` / `.slice` arithmetic over canonical text
 * (ADR-003).
 */

/** Machine code carried by the issue, the warning and the export refusal. */
export const QUOTE_ALTERED = "QUOTE_ALTERED";

/** The lawyer-Turkish half of that code; shown before the code, everywhere. */
export const QUOTE_ALTERED_MESSAGE_TR =
  "alıntı metni kaynağındakinden farklı";

/** Zero-width and BiDi controls (same set the render guard strips). */
const INVISIBLE_CHARS = new RegExp(
  "[\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]",
  "gu",
);

/** Entity escapes the render guard can introduce, folded back before compare. */
const ENTITY_FOLDS: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/&lt;/gu, "<"],
  [/&gt;/gu, ">"],
  [/&#40;/gu, "("],
  [/&#58;/gu, ":"],
  [/&#46;/gu, "."],
  // `&amp;` LAST: folding it first could manufacture one of the escapes above.
  [/&amp;/gu, "&"],
]);

/**
 * The canonical comparison form of a piece of draft text. Identical output is
 * produced by `export/draft.py::canonical_quote_text`.
 */
export function canonicalQuoteText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of ENTITY_FOLDS) out = out.replace(pattern, replacement);
  return out
    .replace(INVISIBLE_CHARS, "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * True when `paragraphText` still contains `quote` verbatim (canonical form).
 * An empty quote never binds anything: a citation with no text to verify is
 * not a citation.
 */
export function paragraphContainsQuote(paragraphText: string, quote: string): boolean {
  const needle = canonicalQuoteText(quote);
  if (needle === "") return false;
  return canonicalQuoteText(paragraphText).includes(needle);
}

/** One paragraph whose citation no longer holds. */
export interface QuoteIntegrityFinding {
  paragraphId: string;
  sectionId: string;
  evidenceId: string;
  /** "K-3" when the entry is numbered in this document, else the raw id. */
  ref: string;
}

/** The minimal draft shape this gate needs (structurally typed on purpose). */
interface QuoteCheckableDraft {
  sections: readonly {
    id: string;
    paragraphs: readonly { id: string; text: string; evidenceIds: readonly string[] }[];
  }[];
  evidence: readonly { evidenceId: string; quote: string }[];
}

/**
 * Every citation in the document whose quote is no longer present verbatim.
 * Empty array = the draft may be written. This is the TypeScript half of the
 * export gate; `export/draft.py::verify_draft_or_refuse` runs the identical
 * check on the artifact path, so Markdown (rendered here) and DOCX/UDF
 * (rendered by Python) refuse the same drafts for the same reason.
 */
export function findAlteredQuotes(draft: QuoteCheckableDraft): QuoteIntegrityFinding[] {
  const quotes = new Map<string, string>();
  const numbers = new Map<string, number>();
  draft.evidence.forEach((entry, index) => {
    if (quotes.has(entry.evidenceId)) return;
    quotes.set(entry.evidenceId, entry.quote);
    numbers.set(entry.evidenceId, index + 1);
  });
  const findings: QuoteIntegrityFinding[] = [];
  for (const section of draft.sections) {
    for (const paragraph of section.paragraphs) {
      for (const evidenceId of paragraph.evidenceIds) {
        const quote = quotes.get(evidenceId);
        // An id that is not in the evidence list is a DIFFERENT failure
        // (BILINMEYEN_KANIT), owned by the exporter's closure check.
        if (quote === undefined) continue;
        if (paragraphContainsQuote(paragraph.text, quote)) continue;
        const n = numbers.get(evidenceId);
        findings.push({
          paragraphId: paragraph.id,
          sectionId: section.id,
          evidenceId,
          ref: n === undefined ? evidenceId : `K-${n}`,
        });
      }
    }
  }
  return findings;
}

/**
 * The message a broken binding produces — Turkish first, machine code after
 * it in parentheses (W13-BACKLOG B-27: a machine code is never shown alone).
 */
export function quoteAlteredMessage(evidenceId: string, ref?: string): string {
  const shown = ref !== undefined && ref !== "" ? `${ref} (${evidenceId})` : evidenceId;
  return (
    `'${shown}' alıntısı paragraf metninde birebir bulunamadı: ${QUOTE_ALTERED_MESSAGE_TR}` +
    ` (${QUOTE_ALTERED}). Atıf yazılmadı; paragraf KAYNAKSIZ işaretlendi.` +
    " Alıntıyı metne birebir geri alın veya atfı kaldırın."
  );
}
