/**
 * Ports the answer pipeline depends on.
 *
 * Every port is a plain interface so the pipeline runs identically against the
 * local Postgres corpus (storeAdapters.ts) and against in-memory fakes in the
 * offline test suite. No port is allowed to throw for an expected failure:
 * adapters translate provider/DB errors into a typed `status: "error"`, which
 * the pipeline turns into a PARTIAL answer with a warning instead of a crash.
 */

import type { RankedHit } from "../retrieval/hybrid.js";

export interface CorpusSearchLimits {
  resultLimit?: number;
  lexicalLimit?: number;
  trigramLimit?: number;
  trigramMinSimilarity?: number;
  perDocumentCap?: number;
}

export interface CorpusSearchFilters {
  /** legal.documents.source values. */
  sources?: string[];
  /** legal.documents.document_type values. */
  documentTypes?: string[];
  /**
   * Additive (2026-08 wave, cross-lane contract D): restrict RULINGS to
   * these court types (normalized substring match against the hit's
   * document type / title). Norm texts pass untouched — a court filter
   * narrows the case law, it never hides the statute being asked about.
   */
  courtTypes?: string[];
  /** Additive: keep rulings decided ON/AFTER this ISO date (YYYY-MM-DD). */
  dateFrom?: string;
  /** Additive: keep rulings decided ON/BEFORE this ISO date (YYYY-MM-DD). */
  dateTo?: string;
  /**
   * Additive (W12 lane B, contract [R]): restrict retrieval to these uploaded
   * documents (intake fileIds = legal.documents.external_id, scope 'tenant').
   * The citator lane is skipped; evidence from them carries origin "upload".
   */
  fileIds?: string[];
  /** Under file scope only: union with the public corpus. Default false. */
  includeCorpus?: boolean;
  /**
   * Additive (W21, review-table version pin): restrict the caller's UPLOADED
   * rows to EXACTLY these document versions (legal.document_versions.id).
   * The pin replaces the current-version test for those rows — a superseded
   * upload version stays readable by its id — and it never widens: the
   * fileIds and tenant tests still apply, and public rows follow
   * includeCorpus as before. See chunkStore.StoreSearchFilters.
   */
  documentVersionIds?: string[];
}

export interface CorpusSearchRequest {
  query: string;
  /** ISO date (YYYY-MM-DD); versions must be in force on this date. */
  asOf: string;
  filters?: CorpusSearchFilters;
  limits?: CorpusSearchLimits;
}

export interface CorpusSearchResult {
  status: "ok" | "partial" | "error";
  hits: RankedHit[];
  /** Contained lane failures; present on "partial". */
  warnings: string[];
  /** Safe message; present on "error". */
  error?: string;
  /**
   * Additive (W12): typed cause when the corpus could not be reached at all
   * (connection refused/timed out, database missing, server shutting down).
   * When set, `error` carries the Turkish user-facing message and never
   * driver text; the pipeline reports reason/warning CORPUS_UNAVAILABLE.
   */
  errorCode?: "CORPUS_UNAVAILABLE";
}

/** Hybrid retrieval over the local legal corpus. Must not throw. */
export interface CorpusRetrievalPort {
  readonly name: string;
  search(request: CorpusSearchRequest): Promise<CorpusSearchResult>;
}

/**
 * Version-level facts the chunk provenance projection does not carry: the
 * deciding court/chamber and the effective period bounds. Both are needed for
 * authority classification and currentness assessment.
 */
export interface VersionFacts {
  documentVersionId: string;
  /** Court + chamber joined, e.g. "Yargıtay 15. Ceza Dairesi". */
  court?: string;
  /** Inclusive lower bound of effective_period as an ISO date. */
  effectiveFrom?: string;
  /** Exclusive upper bound of effective_period as an ISO date. */
  effectiveTo?: string;
  /**
   * Additive (W18): provenance of the version. `true` = the synthetic fixture
   * corpus (`fixture_meta.synthetic: true`), `false` = a document the local
   * library published from a real source (`ingestion/library.py` writes
   * `fixture_meta.synthetic: false`). Absent when the store did not say.
   */
  synthetic?: boolean;
}

/** Must not throw; an unavailable store yields an empty map. */
export interface VersionFactsPort {
  fetch(documentVersionIds: readonly string[]): Promise<Map<string, VersionFacts>>;
}

export type { RankedHit } from "../retrieval/hybrid.js";
