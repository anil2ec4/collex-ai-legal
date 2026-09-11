/**
 * Corpus-lane query expansion (2026-09-10; RESEARCH.md ledger, P0-11
 * "synonyms untouched" — no longer).
 *
 * WHAT IT DOES. Between normalization and the lexical lane, `searchPipeline`
 * asks this module which rows of the planner's concept table the query
 * reaches and collects their synonym terms. The lexical lane then searches
 * those terms as OR-alternatives NEXT TO the reader's words — never instead
 * of them — at a discounted weight (chunkStore's
 * DEFAULT_EXPANSION_TERM_WEIGHT), and the pipeline result reports exactly
 * which terms were added so the console can say "şu eş anlamlılar da
 * arandı" instead of silently searching words the lawyer never typed.
 *
 * WHY THE PLANNER'S TABLE AND NOT A NEW ONE. `planner/intake.ts::CONCEPT_TABLE`
 * is the one authored, lawyer-readable synonym source this project has
 * (120+ rows: key, expansion terms, optional statutory anchors). The live
 * research planner already expands round-1 queries from it; the local corpus
 * lane was the only retriever that ignored it. Reusing the table means one
 * place to review and one place to fix.
 *
 * WHAT IT DOES NOT DO — three guarantees the lexical lane enforces and this
 * module documents:
 *   1. an expansion term can never ADMIT a passage on its own (the lane's
 *      flat coverage rule counts query lexemes only, and its weighted rule
 *      demands at least one query lexeme), so recall can only grow;
 *   2. an expansion term can never OUTRANK the reader's own word at the same
 *      rank (its IDF is discounted by the expansion weight);
 *   3. a term already present in the query is never added twice — the
 *      reader's word stays a query lexeme at full weight.
 *
 * FIRING RULE. Same as the planner's own (intake.ts, "HOW A CONCEPT FIRES"):
 * whole words, Turkish suffix tolerance, a multi-word term fires when all its
 * distinctive words appear anywhere in the query. The concepts are ordered
 * most-specific-first (compareConceptSpecificity) so the cap keeps the rows
 * that say the most about the question, not the generic parent ("kira").
 */

import {
  CONCEPT_TABLE,
  compareConceptSpecificity,
  conceptTokens,
  firedTableEntries,
  tableEntryFires,
} from "../planner/intake.js";
import { DEFAULT_EXPANSION_TERM_WEIGHT } from "../store/chunkStore.js";

export interface QueryExpansion {
  /** Concept keys the query reached, most specific first (after the cap). */
  concepts: string[];
  /**
   * Synonym / related terms searched as OR-alternatives, in the order they
   * were added. Empty when no concept fired or expansion is disabled.
   */
  terms: string[];
  /** Weight of an expansion lexeme relative to a query lexeme (0..1). */
  weight: number;
  /** The cap that was applied to `terms` (0 = expansion disabled). */
  limit: number;
}

/**
 * At most eight added terms. A round cap, not a fitted one: the concept
 * table's rows carry three to four terms each, so eight is "the two most
 * specific concepts, fully" — enough to reach a passage that uses the
 * institution's other name, not enough to turn a question into a word cloud.
 */
export const DEFAULT_QUERY_EXPANSION_LIMIT = 8;

export interface ExpandQueryOptions {
  /** Max terms added; 0 disables expansion. Default DEFAULT_QUERY_EXPANSION_LIMIT. */
  limit?: number;
  /** Reported weight; default DEFAULT_EXPANSION_TERM_WEIGHT. */
  weight?: number;
}

export function emptyExpansion(limit: number, weight: number): QueryExpansion {
  return { concepts: [], terms: [], weight, limit };
}

/**
 * Expand a NORMALIZED query (normalizeTurkishSearch form — the table is
 * authored in that form). Pure and deterministic: the same query always
 * yields the same expansion.
 */
export function expandQuery(
  normalizedQuery: string,
  options: ExpandQueryOptions = {},
): QueryExpansion {
  const limit = Math.max(0, Math.trunc(options.limit ?? DEFAULT_QUERY_EXPANSION_LIMIT));
  const weight = options.weight ?? DEFAULT_EXPANSION_TERM_WEIGHT;
  if (limit === 0) return emptyExpansion(limit, weight);

  const tokens = conceptTokens(normalizedQuery);
  if (tokens.length === 0) return emptyExpansion(limit, weight);

  const fired = Object.entries(CONCEPT_TABLE)
    .filter(([key, entry]) => firedTableEntries(key, entry, tokens).length > 0)
    .map(([key]) => key)
    .sort(compareConceptSpecificity(normalizedQuery));

  const concepts: string[] = [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const key of fired) {
    if (terms.length >= limit) break;
    const entry = CONCEPT_TABLE[key];
    if (entry === undefined) continue;
    let added = false;
    for (const term of entry.terms) {
      if (terms.length >= limit) break;
      if (seen.has(term)) continue;
      // Guarantee 3: the reader already wrote this — it stays a query lexeme.
      if (tableEntryFires(term, tokens)) continue;
      seen.add(term);
      terms.push(term);
      added = true;
    }
    if (added) concepts.push(key);
  }
  return { concepts, terms, weight, limit };
}
