/**
 * Pure Reciprocal Rank Fusion over a lexical and a semantic ranked list.
 *
 * Mirrors the SQL function `legal.hybrid_search_public_1024` from the Master
 * Build Brief section 8.6 exactly:
 *
 *   score(id) = coalesce(1 / (k + lexical_rank), 0)
 *             + coalesce(1 / (k + semantic_rank), 0)
 *
 * with 1-based ranks and a FULL OUTER JOIN between the two lists. The SQL
 * leaves tie order unspecified; here ties are broken by id ascending so the
 * function is fully deterministic and property-testable.
 *
 * WEIGHTED VARIANT (additive, 2026-09-10). An optional fourth argument gives
 * each list a multiplier: score(id) = w_lex / (k + lexical_rank)
 * + w_sem / (k + semantic_rank). Both default to 1, which is byte-identical
 * to the SQL function above, so every existing caller and test is unchanged.
 * hybrid.ts uses it to say that a passage the Turkish FTS lane ranked first
 * outweighs one the fuzzy trigram fallback ranked first — see
 * DEFAULT_LANE_WEIGHTS there for the documented ordering.
 */

export interface RrfFused {
  id: string;
  /** Fused RRF score (higher is better). */
  score: number;
  /** 1-based rank in the lexical list, or null when absent (mirrors SQL NULL). */
  lexicalRank: number | null;
  /** 1-based rank in the semantic list, or null when absent (mirrors SQL NULL). */
  semanticRank: number | null;
}

export const DEFAULT_RRF_K = 60;

/** Per-list multipliers for {@link reciprocalRankFusion}; 1 = unweighted. */
export interface RrfWeights {
  lexical?: number;
  semantic?: number;
}

export const DEFAULT_RRF_WEIGHTS: Readonly<Required<RrfWeights>> = Object.freeze({
  lexical: 1,
  semantic: 1,
});

/** A lane weight must be a positive finite number; 0 would silence a lane. */
export function assertLaneWeight(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} weight must be a positive finite number, got ${value}`);
  }
  return value;
}

/**
 * Fuse two ranked candidate lists. Inputs are ordered best-first; each id may
 * appear at most once per list (duplicate ranks are ill-defined, so throw).
 */
export function reciprocalRankFusion(
  lexicalIds: readonly string[],
  semanticIds: readonly string[],
  k: number = DEFAULT_RRF_K,
  weights: RrfWeights = DEFAULT_RRF_WEIGHTS,
): RrfFused[] {
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError(`rrf_k must be a positive finite number, got ${k}`);
  }
  const wLex = assertLaneWeight(weights.lexical ?? DEFAULT_RRF_WEIGHTS.lexical, "lexical");
  const wSem = assertLaneWeight(weights.semantic ?? DEFAULT_RRF_WEIGHTS.semantic, "semantic");
  assertUnique(lexicalIds, "lexical");
  assertUnique(semanticIds, "semantic");

  const fused = new Map<string, RrfFused>();

  lexicalIds.forEach((id, index) => {
    const rank = index + 1;
    fused.set(id, { id, score: wLex / (k + rank), lexicalRank: rank, semanticRank: null });
  });

  semanticIds.forEach((id, index) => {
    const rank = index + 1;
    const existing = fused.get(id);
    if (existing) {
      existing.semanticRank = rank;
      existing.score += wSem / (k + rank);
    } else {
      fused.set(id, { id, score: wSem / (k + rank), lexicalRank: null, semanticRank: rank });
    }
  });

  return [...fused.values()].sort(
    (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function assertUnique(ids: readonly string[], label: string): void {
  const seen = new Set(ids);
  if (seen.size !== ids.length) {
    throw new RangeError(`duplicate ids in ${label} ranked list`);
  }
}
