/**
 * Turkish search-side normalization (Master Build Brief section 8.4).
 *
 * IMPORTANT: this normalizer is for the *search field only*. The original
 * canonical document text is never modified; offsets/hashes are always
 * computed against the canonical NFC text, not against this normalized form.
 *
 * Byte-for-byte mirror of `legal_reference/normalize.py`. The cross-language
 * fixture `evals/fixtures/reference_parity.json` pins that equivalence: both
 * `normalize.test.ts` and `tests/contracts/test_parser_parity.py` assert the
 * exact same normalized string for the exact same inputs.
 */
export function normalizeTurkishSearch(input: string): string {
  return input
    .normalize("NFC")
    .replace(/­/g, "") // soft hyphen
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[“”„‟]/g, '"')
    .replace(/[’‘]/g, "'")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The letters {@link foldTurkishForFilter} folds AFTER Turkish lowercasing,
 * and what they become. The SQL side of every filter uses the SAME pair in
 * `translate(…)`, so the database and the in-memory stores agree.
 */
export const TR_FILTER_FOLD_FROM = "ıçğöşüâîû";
export const TR_FILTER_FOLD_TO = "icgosuaiu";

/**
 * The SQL fold maps BOTH cases of every Turkish letter before `lower()`:
 * under a C / C.UTF-8 database locale `lower()` folds ASCII only, and
 * "ŞÜKRÜ" stayed upper case (measured on PostgreSQL 16, C.UTF-8). What is
 * left for `lower()` is then plain ASCII, which every locale folds alike.
 */
export const TR_FILTER_SQL_FROM = "İIıŞşĞğÜüÖöÇçÂâÎîÛû";
export const TR_FILTER_SQL_TO = "iiissgguuooccaaiiuu";

/**
 * Case- and diacritic-insensitive key for the "contains" filters a lawyer
 * types into a search box (files, matters, matter items).
 *
 * 27.09.2026: `ILIKE` and `plainto_tsquery` fold case with the DATABASE
 * locale, which knows no Turkish dotless ı — "KIDEM", "TANIK" and "YILMAZ"
 * found nothing, and "bilirkisi" typed on a keyboard without Turkish letters
 * never met "bilirkişi". For FILTERS only — never for citation text, quote
 * integrity or reference parsing.
 */
export function foldTurkishForFilter(input: string): string {
  let out = "";
  for (const ch of normalizeTurkishSearch(input)) {
    const at = TR_FILTER_FOLD_FROM.indexOf(ch);
    out += at >= 0 ? TR_FILTER_FOLD_TO[at] : ch;
  }
  return out;
}

/**
 * LENGTH-PRESERVING lowercase + punctuation unification for MATCHING only.
 *
 * Unlike {@link normalizeTurkishSearch} this never strips soft hyphens and
 * never collapses whitespace, so every character keeps its index. The
 * reference parser runs all of its regexes over this "shadow" copy and slices
 * the ORIGINAL NFC text with the resulting spans, which is what lets `raw`
 * keep its real casing while matching stays case-insensitive.
 *
 * The dotted/dotless mapping is applied EXPLICITLY (İ -> i, I -> ı) before a
 * plain `toLowerCase()` rather than relying on `toLocaleLowerCase("tr-TR")`,
 * because Python's `str.lower()` on U+0130 produces a two-code-point sequence
 * ("i" + U+0307). Doing the substitution first keeps both languages
 * length-preserving and identical.
 *
 * Mirror of `shadow_fold` in `legal_reference/normalize.py`.
 */
export function shadowFold(input: string): string {
  return input
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[“”„‟]/g, '"')
    .replace(/[’‘]/g, "'");
}
