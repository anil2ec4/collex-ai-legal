/**
 * API-facing glue for the hybrid retrieval pipeline.
 *
 * Responsibilities:
 *  - zod validation of the raw (untrusted) request body;
 *  - running searchPipeline against the store;
 *  - mapping the result onto the Outcome envelope (brief 6.5): contained
 *    lane failures become status "partial" with warnings (brief principle 8
 *    — partial results instead of all-or-nothing); only a total failure of
 *    every result-bearing lane, or an invalid request, becomes "error".
 *    Normalizer drift (chunks indexed under a different normalizer than the
 *    one that normalized the query) is reported as a warning on an otherwise
 *    "ok" outcome: the data is there, its recall guarantee is not.
 *
 * StoreOutcome<T> mirrors Outcome<T> from capabilities/types.ts field for
 * field; it only widens the provider tag with "STORE" because the local
 * corpus store is not one of the upstream provider codes. An Outcome<T> is
 * structurally assignable to StoreOutcome<T> (additive-only widening).
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeTurkishSearch } from "./normalize.js";
import {
  CORPUS_UNAVAILABLE,
  CORPUS_UNAVAILABLE_MESSAGE_TR,
  isCorpusUnavailable,
  isCorpusUnavailableCode,
} from "./corpusErrors.js";
import type { Sql } from "../store/db.js";
import type {
  FailureKind,
  ProviderCode,
  ProviderFailure,
} from "../capabilities/types.js";
import {
  searchPipeline,
  type DenseLane,
  type LaneName,
  type RankedHit,
  type SearchPipelineResult,
} from "./hybrid.js";

// --------------------------------------------------------------------------
// Outcome envelope (widened provider tag)
// --------------------------------------------------------------------------

export type StoreProvider = ProviderCode | "STORE";

export type StoreOutcome<T> =
  | {
      status: "ok";
      data: T;
      provider: StoreProvider;
      observedAt: string;
      warnings: string[];
    }
  | {
      status: "partial";
      data: T;
      provider: StoreProvider;
      observedAt: string;
      warnings: string[];
      error: ProviderFailure;
    }
  | {
      status: "error";
      provider: StoreProvider;
      observedAt: string;
      error: ProviderFailure;
      /**
       * Additive (W12): set when EVERY result-bearing lane failed for a
       * connection-class reason (see corpusErrors.ts). `error.safeMessage`
       * then carries the Turkish user-facing sentence, never driver text.
       */
      reasonCode?: typeof CORPUS_UNAVAILABLE;
    };

const PROVIDER: StoreProvider = "STORE";

// --------------------------------------------------------------------------
// Request schema
// --------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

export const searchRequestSchema = z
  .object({
    query: z.string().min(1, "query must not be empty").max(2000),
    asOf: isoDate.optional(),
    filters: z
      .object({
        sources: z.array(z.string().min(1).max(200)).max(50).optional(),
        documentTypes: z.array(z.string().min(1).max(200)).max(50).optional(),
        /**
         * Additive court/date narrowing (2026-08 wave, contract D). Applied
         * as a deterministic post-filter over the ranked hits — see
         * `passesCourtDateFilters` for the exact semantics (norm texts are
         * never dropped by a court/date filter).
         */
        courtTypes: z.array(z.string().min(1).max(200)).max(20).optional(),
        dateFrom: isoDate.optional(),
        dateTo: isoDate.optional(),
        /**
         * Additive (W14/B-16): daire, yıl aralığı and hariç tutulacak
         * kelimeler. Sent only when the caller sets them; see
         * `passesCourtDateFilters` for the exact semantics.
         */
        chambers: z.array(z.string().min(1).max(40)).max(20).optional(),
        yearFrom: z.number().int().min(1900).max(2100).optional(),
        yearTo: z.number().int().min(1900).max(2100).optional(),
        excludeTerms: z.array(z.string().min(1).max(80)).max(10).optional(),
        /**
         * Additive (W12, contract [R]): file scope — restrict the lanes to
         * these uploaded documents (intake fileIds); `includeCorpus` unions
         * the public corpus back in. See chunkStore.StoreSearchFilters.
         */
        fileIds: z.array(z.string().min(1).max(200)).max(50).optional(),
        includeCorpus: z.boolean().optional(),
        /**
         * Additive (W21, review-table version pin): read EXACTLY these
         * uploaded versions instead of the current ones. See
         * chunkStore.StoreSearchFilters.documentVersionIds.
         */
        documentVersionIds: z.array(z.string().uuid()).max(50).optional(),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        resultLimit: z.number().int().min(1).max(100).optional(),
        lexicalLimit: z.number().int().min(1).max(200).optional(),
        trigramLimit: z.number().int().min(1).max(200).optional(),
        denseLimit: z.number().int().min(1).max(200).optional(),
        rrfK: z.number().int().min(1).max(1000).optional(),
        /**
         * Per-lane RRF multipliers (hybrid.ts DEFAULT_LANE_WEIGHTS). Positive
         * and at most 1: a caller may DISCOUNT a lane, never amplify one —
         * the same direction rule as the trigram threshold clamp.
         */
        laneWeights: z
          .object({
            lexical: z.number().gt(0).max(1).optional(),
            trigram: z.number().gt(0).max(1).optional(),
            dense: z.number().gt(0).max(1).optional(),
          })
          .strict()
          .optional(),
        /** Max synonym terms the corpus-lane expansion may add; 0 disables it. */
        expansionLimit: z.number().int().min(0).max(32).optional(),
        trigramMinSimilarity: z.number().min(0).max(1).optional(),
        perDocumentCap: z.number().int().min(1).max(20).optional(),
        /**
         * Text-search config for the lexical lane ("turkish" default,
         * "simple" = comparison baseline). An unknown config name makes the
         * lexical lane fail inside Postgres, which surfaces — by design — as
         * a contained lane failure and a "partial" outcome.
         */
        lexicalConfig: z.string().min(1).max(64).optional(),
        /**
         * Lexical query construction. "coverage" (default) ORs the query's
         * lexemes and applies lexicalMinCoverage; "strict" is the original
         * conjunctive websearch_to_tsquery, kept so the two can be measured
         * against each other on a gold set (brief 8.6) and so a caller who
         * typed websearch operators can have them honoured.
         */
        lexicalMode: z.enum(["coverage", "strict"]).optional(),
        /** "Minimum should match" fraction for the coverage mode. */
        lexicalMinCoverage: z.number().min(0).max(1).optional(),
        /** Coverage floor for the divergence-completion pass. */
        contraryMinCoverage: z.number().min(0).max(1).optional(),
        /** Max opposing-authority hits; 0 disables the pass. */
        contraryLimit: z.number().int().min(0).max(50).optional(),
        /** How many top hits are re-parsed for outbound citations. */
        citationSeedCount: z.number().int().min(0).max(20).optional(),
        /** Max hits admitted by citation expansion; 0 disables it. */
        citationExpansionLimit: z.number().int().min(0).max(50).optional(),
        /**
         * How many top hits seed the citator (relation) lane; 0 disables it.
         * Exposed for the same reason as citationSeedCount: the lane is an
         * enrichment with a cost (one relation lookup per seed document), and
         * a caller comparing "with citator" against "without" — or one that
         * wants strictly lexical behaviour — must be able to say so instead of
         * being told 400 by `.strict()`.
         */
        relationSeedCount: z.number().int().min(0).max(20).optional(),
        /** Max hits admitted by the citator lane; 0 disables it. */
        relationLimit: z.number().int().min(0).max(50).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export interface SearchServiceDependencies {
  denseLane?: DenseLane;
}

// --------------------------------------------------------------------------
// Court/date filters (contract D) — shared with the live research lane
// --------------------------------------------------------------------------

export interface CourtDateFilters {
  courtTypes?: readonly string[];
  dateFrom?: string;
  dateTo?: string;
  /**
   * Additive (W14/B-16): the filters a litigator actually needs next to the
   * court list. All three are OPTIONAL and absent means "no narrowing", so a
   * caller that sends none behaves exactly as before.
   *
   *  - `chambers`: daire ("3. HD", "HGK", "10. D"); matched the same
   *    Turkish-normalized way as `courtTypes`, against the row's court/title;
   *  - `yearFrom`/`yearTo`: yıl aralığı over the decision date, inclusive;
   *  - `excludeTerms`: hariç tutulacak kelimeler, matched against the row's
   *    title (a hit is DROPPED, and the caller counts the drop).
   */
  chambers?: readonly string[];
  yearFrom?: number;
  yearTo?: number;
  excludeTerms?: readonly string[];
}

/**
 * Deterministic court/date admission test for one retrieved row.
 *
 * Semantics (documented, deliberately conservative):
 *  - only a RULING (a row carrying an E./K. number or a decision date) is
 *    subject to the filter; a norm text passes untouched — the filter
 *    narrows case law, it never hides the statute being asked about;
 *  - `courtTypes` matches when ANY requested type appears (Turkish-
 *    normalized substring) in the row's court / document type / title;
 *  - `dateFrom`/`dateTo` compare the ruling's ISO decision date
 *    lexicographically; a ruling WITHOUT a decision date is kept — dropping
 *    what cannot be measured would silently hide possibly relevant
 *    authority.
 */
export function passesCourtDateFilters(
  row: {
    documentType?: string | null;
    title?: string | null;
    court?: string | null;
    decisionDate?: string | null;
    docketNo?: string | null;
    decisionNo?: string | null;
  },
  filters: CourtDateFilters | undefined,
): boolean {
  if (filters === undefined) return true;
  const isRuling =
    (row.decisionDate !== undefined && row.decisionDate !== null && row.decisionDate !== "") ||
    (row.docketNo !== undefined && row.docketNo !== null && row.docketNo !== "") ||
    (row.decisionNo !== undefined && row.decisionNo !== null && row.decisionNo !== "");
  if (!isRuling) return true;

  const haystack = normalizeTurkishSearch(
    [row.court ?? "", row.documentType ?? "", row.title ?? ""].join(" "),
  );

  const courtTypes = (filters.courtTypes ?? []).filter((t) => t.trim() !== "");
  if (courtTypes.length > 0) {
    const matched = courtTypes.some((type) =>
      haystack.includes(normalizeTurkishSearch(type)),
    );
    if (!matched) return false;
  }

  // Daire (W14/B-16). Same normalization as the court filter; a row that names
  // no chamber at all is KEPT, exactly as an undated ruling is kept — dropping
  // what cannot be measured would hide possibly relevant authority.
  const chambers = (filters.chambers ?? []).filter((t) => t.trim() !== "");
  if (chambers.length > 0) {
    const matched = chambers.some((chamber) =>
      haystack.includes(normalizeTurkishSearch(chamber)),
    );
    if (!matched) return false;
  }

  // Hariç tutulacak kelimeler (W14/B-16): an excluded term anywhere in the
  // row's identity drops the row.
  const excludeTerms = (filters.excludeTerms ?? []).filter((t) => t.trim() !== "");
  if (
    excludeTerms.length > 0 &&
    excludeTerms.some((term) => haystack.includes(normalizeTurkishSearch(term)))
  ) {
    return false;
  }

  const day =
    row.decisionDate === undefined || row.decisionDate === null
      ? undefined
      : row.decisionDate.slice(0, 10);
  if (day !== undefined && day !== "") {
    if (filters.dateFrom !== undefined && day < filters.dateFrom) return false;
    if (filters.dateTo !== undefined && day > filters.dateTo) return false;
    // Yıl aralığı (W14/B-16), inclusive at both ends.
    const year = Number.parseInt(day.slice(0, 4), 10);
    if (Number.isFinite(year)) {
      if (filters.yearFrom !== undefined && year < filters.yearFrom) return false;
      if (filters.yearTo !== undefined && year > filters.yearTo) return false;
    }
  }
  return true;
}

/** Apply the court/date filters to a ranked hit list (order preserved). */
function applyCourtDateFilters(
  hits: RankedHit[],
  filters: CourtDateFilters | undefined,
): RankedHit[] {
  if (
    filters === undefined ||
    ((filters.courtTypes === undefined || filters.courtTypes.length === 0) &&
      (filters.chambers === undefined || filters.chambers.length === 0) &&
      (filters.excludeTerms === undefined || filters.excludeTerms.length === 0) &&
      filters.yearFrom === undefined &&
      filters.yearTo === undefined &&
      filters.dateFrom === undefined &&
      filters.dateTo === undefined)
  ) {
    return hits;
  }
  return hits.filter((hit) =>
    passesCourtDateFilters(
      {
        documentType: hit.provenance.documentType,
        title: hit.provenance.title ?? hit.provenance.externalId,
        decisionDate: hit.provenance.decisionDate,
        docketNo: hit.provenance.docketNo,
        decisionNo: hit.provenance.decisionNo,
      },
      filters,
    ),
  );
}

// --------------------------------------------------------------------------
// Service
// --------------------------------------------------------------------------

/**
 * Backstop for the version pin (W21). Every lane already selects pinned rows
 * in SQL (chunkStore.visibilityFilter, chunkVectorStore.scopedVectors); this
 * drops any non-public hit whose version is not pinned, so a lane that ever
 * failed to honour the pin contributes NOTHING rather than a passage from
 * another version of the document.
 */
function keepPinnedVersions(
  hits: RankedHit[],
  pins: readonly string[] | undefined,
): RankedHit[] {
  if (pins === undefined) return hits;
  const allowed = new Set(pins.map((id) => id.toLowerCase()));
  return hits.filter(
    (hit) =>
      hit.provenance.scope === "public" ||
      allowed.has(hit.documentVersionId.toLowerCase()),
  );
}

/** Lanes that can actually produce hits (dense is a noop until pgvector). */
const CORE_LANES: readonly LaneName[] = ["exact", "lexical", "trigram"];

export async function searchLegalCorpus(
  sql: Sql,
  input: unknown,
  dependencies: SearchServiceDependencies = {},
): Promise<StoreOutcome<RankedHit[]>> {
  const observedAt = new Date().toISOString();

  const parsed = searchRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      provider: PROVIDER,
      observedAt,
      error: failure("INVALID_REQUEST", false, formatZodError(parsed.error)),
    };
  }
  const request = parsed.data;

  let result: SearchPipelineResult;
  try {
    result = await searchPipeline(sql, request.query, {
      ...(request.asOf !== undefined ? { asOf: request.asOf } : {}),
      ...(request.filters !== undefined ? { filters: request.filters } : {}),
      ...(request.limits !== undefined ? { limits: request.limits } : {}),
      ...(dependencies.denseLane !== undefined
        ? { denseLane: dependencies.denseLane }
        : {}),
    });
  } catch (error) {
    // searchPipeline contains per-lane failures; reaching here means the
    // pipeline itself broke (e.g. the pool is gone) — a full error.
    if (isCorpusUnavailable(error)) {
      return {
        status: "error",
        provider: PROVIDER,
        observedAt,
        error: failure("UNAVAILABLE", true, CORPUS_UNAVAILABLE_MESSAGE_TR),
        reasonCode: CORPUS_UNAVAILABLE,
      };
    }
    return {
      status: "error",
      provider: PROVIDER,
      observedAt,
      error: failure("UNAVAILABLE", true, safeMessage(error)),
    };
  }

  // Court/date narrowing (contract D) is a deterministic post-filter over
  // the ranked hits; when the request carries none of the three fields this
  // is the identity function and nothing changes.
  const hits = keepPinnedVersions(
    applyCourtDateFilters(result.hits, request.filters),
    request.filters?.documentVersionIds,
  );

  if (result.laneFailures.length === 0) {
    // Normalizer drift is a data-quality warning, not a lane failure: every
    // lane answered and the hits are usable, but the operator must know that
    // some rows were indexed under different normalization rules.
    return {
      status: "ok",
      data: hits,
      provider: PROVIDER,
      observedAt,
      warnings: [...result.normalizerWarnings],
    };
  }

  // A connection-class failure is reported by CODE, never by the driver's
  // prose: "lane lexical failed: CORPUS_UNAVAILABLE (ECONNREFUSED)" tells an
  // operator everything, and tells a lawyer nothing they should not see.
  const unavailable = (f: { code?: string; message: string }): boolean =>
    isCorpusUnavailableCode(f.code, f.message);
  const warnings = [
    ...result.laneFailures.map((f) =>
      unavailable(f)
        ? `lane ${f.lane} failed: ${CORPUS_UNAVAILABLE}${f.code !== undefined ? ` (${f.code})` : ""}`
        : `lane ${f.lane} failed: ${f.message}`,
    ),
    ...result.normalizerWarnings,
  ];

  const attemptedCore = result.lanesAttempted.filter((lane) =>
    CORE_LANES.includes(lane),
  );
  const failedCore = new Set(
    result.laneFailures
      .map((f) => f.lane)
      .filter((lane) => CORE_LANES.includes(lane)),
  );
  const survivingCore = attemptedCore.filter((lane) => !failedCore.has(lane));

  if (survivingCore.length === 0) {
    // Every lane that could have produced hits failed: no usable signal.
    const coreFailures = result.laneFailures.filter((f) => CORE_LANES.includes(f.lane));
    if (coreFailures.length > 0 && coreFailures.every(unavailable)) {
      return {
        status: "error",
        provider: PROVIDER,
        observedAt,
        error: failure("UNAVAILABLE", true, CORPUS_UNAVAILABLE_MESSAGE_TR),
        reasonCode: CORPUS_UNAVAILABLE,
      };
    }
    return {
      status: "error",
      provider: PROVIDER,
      observedAt,
      error: failure(
        "UNAVAILABLE",
        true,
        `all retrieval lanes failed: ${warnings.join("; ")}`,
      ),
    };
  }

  return {
    status: "partial",
    data: hits,
    provider: PROVIDER,
    observedAt,
    warnings,
    error: failure("UNAVAILABLE", true, warnings[0] ?? "lane failure"),
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function failure(
  kind: FailureKind,
  retryable: boolean,
  message: string,
): ProviderFailure {
  return {
    kind,
    retryable,
    correlationId: randomUUID(),
    safeMessage: truncate(message, 500),
  };
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
