/**
 * Store-layer retrieval queries over the legal corpus (brief 8.6, minus the
 * dense/pgvector lane, which is not runnable on the local scratch Postgres).
 *
 * Lanes implemented here:
 *   (a) lexicalSearch    — FTS over the 'turkish' config by default
 *                          (search_tsv_tr from migration 20260826110000) with
 *                          'simple' (search_tsv) kept as the comparison
 *                          baseline; "coverage" mode ORs the query lexemes,
 *                          admits on a flat OR an IDF-weighted minimum-should-
 *                          match, and ranks by length-normalized ts_rank_cd
 *                          times the IDF share carried (2026-09-10);
 *                          "strict" keeps websearch_to_tsquery;
 *   (b) trigramSearch    — pg_trgm word_similarity lane (see below);
 *   (c) exactPinLookup   — deterministic metadata lookups for parsed exact
 *                          references (legislation/article, docket/decision);
 *                          results are PINNED and never displaced by scores;
 *   (d) fetchCanonicalText — canonical text + content hash for evidence
 *                          building;
 *   (e) listInForceVersions — the temporal projection the lanes above filter
 *                          through, exposed so the "exactly one version per
 *                          document per as_of" invariant is directly testable.
 *
 * ---------------------------------------------------------------------------
 * corrected 2026-08-27 — schema drift found by the first integration run
 * (control-plane/tests/store/). The draft below was written against an older
 * shape of supabase/migrations and was never executed. Three real defects:
 *
 *  D1  TEMPORAL AMBIGUITY. The filter was
 *        (v.effective_period is null or v.effective_period @> as_of)
 *      which returns EVERY undated published version of a document IN
 *      ADDITION TO the one actually in force on as_of. After the 2026-08-27
 *      corrections the schema can express "exactly one version" and the
 *      filter must use it:
 *        * document_versions_effective_no_overlap (20260826020000) makes at
 *          most ONE published DATED version cover any calendar day;
 *        * document_versions_one_current_uq (20260826100000) makes at most
 *          ONE version per document carry an open (upper_inf) system_period.
 *      So the rule is now: a dated version in force on as_of, OR — only when
 *      no dated version covers as_of — the undated version that is still the
 *      current record in SYSTEM time. Both branches are single-valued per
 *      document, and they are mutually exclusive by construction, which is
 *      what makes "one text in force on date X" have one answer.
 *      NOTE the asymmetry, it is deliberate: the DATED branch must NOT
 *      require upper_inf(system_period), because appending v2 closes v1's
 *      system_period (that is what the close-on-append trigger does), and v1
 *      is still the correct answer for an as_of inside its effective range.
 *      system_period is transaction time; as_of is valid time.
 *
 *  D2  TENANT BLINDNESS. The filter hard-coded d.scope = 'public', so a
 *      tenant's own documents were unreachable through every search lane
 *      while fetchCanonicalText (id lookup, no scope filter) could still read
 *      them. The scope test now mirrors the RLS predicate from
 *      20260826060000: public rows, plus rows of the caller's own tenant as
 *      resolved by app_private.current_tenant_id(). With no tenant context
 *      the function returns NULL, "tenant_id = NULL" is NULL (not true), and
 *      the behaviour is byte-identical to the old public-only filter. This is
 *      defence in depth, NOT the security boundary: RLS is. See the
 *      fetchCanonicalText note below.
 *
 *  D4  LEXICAL LANE STRUCTURALLY DEAD (found 2026-08-27 by the fixture-corpus
 *      eval run: "Hits by lane: exact=36, lexical=0, trigram=5"). The lane
 *      matched with
 *        search_tsv_tr @@ websearch_to_tsquery('turkish', <question>)
 *      and websearch_to_tsquery ANDs every token it is given. A legal question
 *      is 7-20 tokens long; a chunk is one or two sentences. Measured on the
 *      fixture corpus, EVERY ONE of the 25 gold questions produced a fully
 *      conjunctive tsquery that no chunk could satisfy:
 *        "5237 sayılı Türk Ceza Kanunu m. 157 uyarınca dolandırıcılık suçunun
 *         temel şeklinin cezası nedir?"
 *          -> '5237' & 'sayıl' & 'türk' & 'ceza' & 'kan' & 'm' & '157' &
 *             'uyar' & 'dolandırıcılık' & 'suç' & 'temel' & 'şekli' &
 *             'cezas' & 'ne'
 *          -> 0 rows (the same lexemes ORed: 33 rows)
 *      Every link AROUND the query operator was healthy and was checked
 *      individually: the 'turkish' config exists on this build, search_tsv_tr
 *      is a STORED GENERATED column so every ingested row is populated
 *      (55/55 non-empty), index and query side already used the same config,
 *      normalizer_version was 'trnorm-v1' on every row, and the lane was not
 *      erroring (no lane failure was ever recorded). The operator alone was
 *      the defect.
 *      FIX: `mode: "coverage"` (the new default) builds the tsquery from the
 *      lexemes of `to_tsvector(<config>, <query>)` — i.e. from the INDEX-SIDE
 *      analysis of the query itself, which makes stemmer parity structural
 *      rather than something two code paths have to agree about — ORs them for
 *      index-usable candidate generation, and then requires the chunk to cover
 *      at least `minCoverage` of those lexemes. Ranking stays ts_rank_cd.
 *      `mode: "strict"` keeps the old conjunctive websearch_to_tsquery, both
 *      as the A/B baseline and because a caller that types websearch operators
 *      ("quoted phrase", -negation) means them.
 *
 *  D3  TRIGRAM LANE UNUSABLE AT REAL CHUNK LENGTH. The lane used
 *      similarity(search_text, query), which is a SYMMETRIC set similarity:
 *      a 20-character query against a 200-character chunk scores ~0.14 no
 *      matter how exactly the phrase occurs in it, so with the documented
 *      0.25 cutoff the lane could only ever fire on chunks about as short as
 *      the query. Measured on the fixture corpus (PostgreSQL 18.1):
 *        query 'ıstanbul bölge adliye mahkemesi' vs the İSTANBUL chunk
 *          similarity      = 0.273   (barely over the cutoff, and it decays
 *                                     to noise as the chunk grows)
 *          word_similarity = 0.935
 *      word_similarity(query, text) is "best similarity between the query and
 *      any word-boundary-aligned extent of the text", which is exactly the
 *      lane's documented job ("fuzzy phrase matching / short exact-ish
 *      strings") and is length-stable. The lane now uses it, with the cutoff
 *      raised to 0.5 (measured separation on the fixture corpus: real phrase
 *      hits 0.59-1.00, incidental term overlap 0.30-0.43).
 * ---------------------------------------------------------------------------
 *
 * All search lanes share one provenance projection and one visibility filter
 * (scope + published + the D1 temporal rule).
 */

import type { Sql, SqlRow } from "./db.js";
import {
  asFloat,
  asInt,
  asIntOrNull,
  asText,
  asTextArray,
  asTextOrNull,
} from "./db.js";
import type { ParsedReference } from "../retrieval/referenceParser.js";

// --------------------------------------------------------------------------
// Shapes
// --------------------------------------------------------------------------

/**
 * Identity of the normalizer this control-plane normalizes QUERIES with
 * (retrieval/normalize.ts :: normalizeTurkishSearch, byte-for-byte mirror of
 * legal_reference/normalize.py). legal.chunks.normalizer_version records the
 * normalizer that produced each row's search_text (migration 20260826030000,
 * P3). When the two disagree the lexical/trigram lanes are comparing strings
 * produced by different rules, so recall is silently unspecified for those
 * rows — the pipeline surfaces that as a warning rather than dropping them.
 */
export const QUERY_NORMALIZER_VERSION = "trnorm-v1";

/** Full provenance for one chunk hit (chunk + version + document). */
export interface ChunkProvenance {
  chunkId: string;
  documentVersionId: string;
  documentId: string;
  ordinal: number;
  articleNo: string | null;
  paragraphNo: string | null;
  structuralPath: string[];
  /** Unicode code-point offsets into document_versions.canonical_text. */
  startChar: number;
  endChar: number;
  originalText: string;
  /** sha256 hex of the UTF-8 bytes of original_text. */
  chunkSha256: string;
  /** sha256 hex of the UTF-8 bytes of the version's canonical_text. */
  versionSha256: string;
  /** legal.chunks.normalizer_version — the normalizer behind search_text. */
  normalizerVersion: string;
  title: string | null;
  source: string;
  externalId: string;
  canonicalSourceUrl: string | null;
  documentType: string;
  legislationNo: string | null;
  docketNo: string | null;
  decisionNo: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  decisionDate: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  publicationDate: string | null;
  tokenCount: number | null;
  /**
   * legal.documents.scope ('public' | 'tenant'). Additive (W12): the answer
   * layer marks tenant-scoped passages as `origin: "upload"` so a reader can
   * tell "yüklediğiniz belge" from corpus authority. Absent only on rows
   * produced by a projection that did not select it.
   */
  scope?: string;
}

/** One scored row from a ranked lane (lexical or trigram). */
export interface ScoredChunk {
  provenance: ChunkProvenance;
  /** Lane-native score: ts_rank_cd (lexical), word_similarity (trigram). */
  score: number;
  /**
   * Fraction of the QUERY's distinct lexemes this chunk carries, in [0,1].
   * Set by the lexical lane in "coverage" mode; undefined elsewhere. Exposed
   * because it, not the score, is what the coverage floor is applied to, so a
   * caller (and a test) can see why a row was admitted or dropped.
   */
  coverage?: number;
  /**
   * Additive (2026-09-10): IDF-weighted coverage of the ORIGINAL query
   * lexemes in [0,1] — the share of the query's total inverse document
   * frequency this chunk carries. A chunk matching one rare term scores
   * higher here than one matching one ubiquitous term, while `coverage`
   * treats them alike. Set by the lexical lane in "coverage" mode.
   */
  weightedCoverage?: number;
  /** Additive: the original query lexemes this chunk carries (stemmed form). */
  matchedLexemes?: string[];
  /** Additive: how many EXPANSION lexemes (synonyms) this chunk carries. */
  expansionMatches?: number;
}

/** One deterministic exact-reference hit; pinned, never score-displaced. */
export interface PinnedChunk {
  provenance: ChunkProvenance;
  /** Human-auditable reason, e.g. "legislation_no=5237 article_no=157". */
  pinReason: string;
}

export interface StoreSearchFilters {
  /** Restrict to these legal.documents.source values. */
  sources?: string[];
  /** Restrict to these legal.documents.document_type values. */
  documentTypes?: string[];
  /**
   * FILE SCOPE (W12 lane B, contract [R]). When non-empty, the lanes search
   * the caller's UPLOADED documents — `legal.documents.scope = 'tenant'`,
   * `external_id = any(fileIds)` (the intake lane's fileId is the
   * `external_id`; see files/store.ts and intake/ingest.py) — owned by the
   * current tenant, or by the local single-user tenant when no tenant context
   * is set on the connection. Without this the default visibility filter is
   * "public OR current tenant", and in local mode no tenant context is ever
   * set, so an uploaded document was unreachable by every answer lane. The
   * citator lane is skipped under file scope (an upload has no amendment
   * edges); the other lanes run unchanged inside the narrowed set.
   */
  fileIds?: string[];
  /**
   * Under file scope only: also admit the public corpus (union). Default
   * false — "answer from my document" must not quietly become "answer from my
   * document plus whatever the corpus says".
   */
  includeCorpus?: boolean;
  /**
   * VERSION PIN (W21, review tables). When present, the caller's uploaded
   * (tenant) rows are restricted to EXACTLY these document version ids, and
   * the pin REPLACES the as-of/current-version test for them: an upload is
   * undated, so a superseded upload version fails `upper_inf(system_period)`
   * and could never be read otherwise. It never widens — the fileIds and
   * tenant tests still apply, public rows follow `includeCorpus` with their
   * usual as-of test, and a list with no well-formed id matches no uploaded
   * row. Every lane that uses `visibilityFilter` honours it; the dense
   * pre-filter honours it in chunkVectorStore.scopedVectors.
   */
  documentVersionIds?: string[];
}

/**
 * The local single-user tenant (same value as drafting/types.ts and the
 * intake lane; re-declared here on purpose — the store layer must not import
 * the drafting lane). Used ONLY as the fallback owner for file scope when the
 * connection carries no tenant context.
 */
export const LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** True when the filters narrow retrieval to uploaded documents. */
export function isFileScope(filters: StoreSearchFilters | undefined): boolean {
  return filters?.fileIds !== undefined && filters.fileIds.length > 0;
}

export interface LaneQueryOptions {
  /** ISO date (YYYY-MM-DD); versions must be in force on this date. */
  asOf: string;
  limit: number;
  filters?: StoreSearchFilters;
}

export interface CanonicalTextRecord {
  documentVersionId: string;
  documentId: string;
  canonicalText: string;
  /** sha256 hex of the UTF-8 bytes of canonicalText (stored value). */
  contentSha256: string;
}

/** One document version selected by the as-of temporal projection. */
export interface InForceVersion {
  documentId: string;
  documentVersionId: string;
  source: string;
  externalId: string;
  /** daterange rendered as text, or null for an undated version. */
  effectivePeriod: string | null;
  /** True when this row is also the current record in SYSTEM time. */
  systemCurrent: boolean;
}

// --------------------------------------------------------------------------
// Shared fragments
// --------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertIsoDate(asOf: string): void {
  if (!ISO_DATE_RE.test(asOf)) {
    throw new RangeError(`asOf must be an ISO date (YYYY-MM-DD), got "${asOf}"`);
  }
}

/** chunk + version + document provenance projection (aliased snake_case). */
function provenanceProjection(sql: Sql) {
  return sql`
    c.id as chunk_id,
    c.document_version_id as document_version_id,
    d.id as document_id,
    c.ordinal as ordinal,
    c.article_no as article_no,
    c.paragraph_no as paragraph_no,
    c.structural_path as structural_path,
    c.start_char as start_char,
    c.end_char as end_char,
    c.original_text as original_text,
    c.content_sha256 as chunk_sha256,
    c.normalizer_version as normalizer_version,
    c.token_count as token_count,
    v.content_sha256 as version_sha256,
    v.legislation_no as legislation_no,
    v.docket_no as docket_no,
    v.decision_no as decision_no,
    v.decision_date::text as decision_date,
    v.publication_date::text as publication_date,
    d.title as title,
    d.source as source,
    d.external_id as external_id,
    d.canonical_source_url as canonical_source_url,
    d.document_type as document_type,
    d.scope::text as scope`;
}

/**
 * Scope + published + as-of visibility, plus optional source/document_type
 * filters. See D1/D2 in the module header for why this shape and not the
 * simpler nullable-safe one.
 *
 * Index support (all pre-existing): documents PK / partial tenant identity
 * indexes for the scope test; document_versions_effective_gist for both
 * effective_period range tests; the unique (document_id, content_sha256)
 * whose leading column serves the correlated NOT EXISTS; and
 * document_versions_current_idx for the upper_inf(system_period) branch.
 */
function visibilityFilter(
  sql: Sql,
  asOf: string,
  filters: StoreSearchFilters | undefined,
) {
  const sources = filters?.sources;
  const documentTypes = filters?.documentTypes;
  // Scope test. Default: the RLS mirror (public rows + the caller's tenant).
  // File scope: ONLY the named uploads of the current tenant (falling back
  // to the local single-user tenant when the connection carries no tenant
  // context), optionally unioned with the public corpus. `external_id` is
  // the upload's fileId; the tenant test stays so a fileId can never reach
  // another tenant's row even on an RLS-bypassing connection.
  const fileIds = filters?.fileIds ?? [];
  // VERSION PIN (W21). With `documentVersionIds`, the caller's uploaded rows
  // are EXACTLY those versions: the pin REPLACES the as-of test for them
  // instead of being ANDed onto it (an undated, superseded upload version
  // fails `upper_inf(system_period)`, so an ANDed pin would read nothing).
  // The scope tests are the same ones, so a pin never widens; public rows
  // keep the as-of test; a pin list with no well-formed id matches no
  // uploaded row. Fragments are built lazily so an unused one is never made.
  const pins = filters?.documentVersionIds?.filter((id) => UUID_RE.test(id));
  const temporalTest = () => sql`
    (
      v.effective_period @> ${asOf}::date
      or (
        v.effective_period is null
        and upper_inf(v.system_period)
        and not exists (
          select 1
          from legal.document_versions vx
          where vx.document_id = v.document_id
            and vx.status = 'published'
            and vx.effective_period @> ${asOf}::date
        )
      )
    )`;
  const fileScopeTenant = () => sql`
        d.scope = 'tenant'
        and d.tenant_id = coalesce(
          (select app_private.current_tenant_id()),
          ${LOCAL_TENANT_ID}::uuid
        )
        and d.external_id = any(${fileIds}::text[])`;
  const narrowing = () => sql`
    ${sources !== undefined && sources.length > 0 ? sql`and d.source = any(${sources})` : sql``}
    ${documentTypes !== undefined && documentTypes.length > 0 ? sql`and d.document_type = any(${documentTypes})` : sql``}`;
  if (pins !== undefined) {
    const pinTest = pins.length > 0 ? sql`v.id = any(${pins}::uuid[])` : sql`false`;
    const pinnedScope =
      fileIds.length > 0
        ? sql`
    (
      (${fileScopeTenant()} and ${pinTest})
      ${filters?.includeCorpus === true ? sql`or (d.scope = 'public' and ${temporalTest()})` : sql``}
    )`
        : sql`
    (
      (d.scope = 'public' and ${temporalTest()})
      or (
        d.scope = 'tenant'
        and d.tenant_id = (select app_private.current_tenant_id())
        and ${pinTest}
      )
    )`;
    return sql`
    ${pinnedScope}
    and v.status = 'published'
    ${narrowing()}`;
  }
  const scopeTest =
    fileIds.length > 0
      ? sql`
    (
      (${fileScopeTenant()})
      ${filters?.includeCorpus === true ? sql`or d.scope = 'public'` : sql``}
    )`
      : sql`
    (
      d.scope = 'public'
      or d.tenant_id = (select app_private.current_tenant_id())
    )`;
  return sql`
    ${scopeTest}
    and v.status = 'published'
    and ${temporalTest()}
    ${narrowing()}`;
}

/**
 * Deterministic tie-break for the ranked lanes.
 *
 * The lanes used to break score ties on `c.id`, which is a RANDOM UUID minted
 * at ingest. Two ingests of the same corpus therefore produced two different
 * rankings for the same query, and — because the per-document cap and the
 * result limit are applied in rank order — two different RESULT SETS. Measured
 * on 2026-08-27: two consecutive runs of the identical build over the identical
 * fixture corpus returned 108 and 109 ranked hits and disagreed on
 * full-name-form accuracy (100.0% vs 85.7%). A retrieval result that is not
 * reproducible cannot be audited, regression-tested, or cited.
 *
 * (source, external_id, ordinal) is stable across ingests and, under the
 * visibility filter's one-version-per-document rule, unique among the rows any
 * single query can see. `c.id` stays as a last resort so the ordering is total
 * even if that rule is ever relaxed.
 */
function stableTieBreak(sql: Sql) {
  return sql`d.source asc, d.external_id asc, c.ordinal asc, c.id asc`;
}

/**
 * The same rule for a RELATION row (citator lane), and for the same reason.
 *
 * `legal.document_relations.id` is minted by `gen_random_uuid()` at ingest, so
 * ordering that ends on it makes two ingests of the SAME corpus return two
 * different edge orders — measured on 03.09.2026: re-ingesting the fixture
 * corpus swapped two AMENDS edges from one source chunk, which moved a gold
 * row's answer status between runs and made the eval's answer layer look
 * non-deterministic (W14-M-SRV N-7).
 *
 * `fd` is the relation's OTHER document (the amending instrument for an
 * inbound edge, the cited target for an outbound one) and `(source,
 * external_id)` is its corpus identity, stable across ingests. The target
 * locator separates two edges from one instrument to different articles of one
 * law. `r.id` stays last so the ordering is total even when every stable key
 * ties.
 */
function stableRelationTieBreak(sql: Sql) {
  return sql`fd.source asc, fd.external_id asc,
    coalesce(r.target_locator ->> 'legislation_no', '') asc,
    coalesce(r.target_locator ->> 'article', '') asc,
    r.id asc`;
}

export function mapProvenanceRow(row: SqlRow): ChunkProvenance {
  const scope = asTextOrNull(row, "scope");
  return {
    ...(scope !== null ? { scope } : {}),
    chunkId: asText(row, "chunk_id"),
    documentVersionId: asText(row, "document_version_id"),
    documentId: asText(row, "document_id"),
    ordinal: asInt(row, "ordinal"),
    articleNo: asTextOrNull(row, "article_no"),
    paragraphNo: asTextOrNull(row, "paragraph_no"),
    structuralPath: asTextArray(row, "structural_path"),
    startChar: asInt(row, "start_char"),
    endChar: asInt(row, "end_char"),
    originalText: asText(row, "original_text"),
    chunkSha256: asText(row, "chunk_sha256"),
    versionSha256: asText(row, "version_sha256"),
    normalizerVersion: asText(row, "normalizer_version"),
    title: asTextOrNull(row, "title"),
    source: asText(row, "source"),
    externalId: asText(row, "external_id"),
    canonicalSourceUrl: asTextOrNull(row, "canonical_source_url"),
    documentType: asText(row, "document_type"),
    legislationNo: asTextOrNull(row, "legislation_no"),
    docketNo: asTextOrNull(row, "docket_no"),
    decisionNo: asTextOrNull(row, "decision_no"),
    decisionDate: asTextOrNull(row, "decision_date"),
    publicationDate: asTextOrNull(row, "publication_date"),
    tokenCount: asIntOrNull(row, "token_count"),
  };
}

// --------------------------------------------------------------------------
// (a) Lexical lane
// --------------------------------------------------------------------------

/**
 * How the query text is turned into a tsquery.
 *
 *  "coverage" (default) — OR the lexemes of `to_tsvector(config, query)` for
 *    candidate generation, then keep only chunks covering at least
 *    `minCoverage` of them. This is the "minimum should match" shape every
 *    natural-language retriever needs: a question is many words, a passage is
 *    few, and demanding all of them retrieves nothing (see D4).
 *
 *  "strict" — the original `websearch_to_tsquery`, which ANDs bare terms and
 *    honours websearch operators (quoted phrase, leading `-`, `or`). Correct
 *    when the caller typed operators and meant them; kept as the measured A/B
 *    baseline against "coverage".
 */
export type LexicalQueryMode = "coverage" | "strict";

/**
 * Default "minimum should match" fraction for the coverage mode: a chunk is a
 * candidate when it carries at least a QUARTER of the question's distinct
 * lexemes (ceil, so a 4-lexeme question needs 1 and a 20-lexeme question
 * needs 5).
 *
 * A round quarter, not a fitted optimum. What the fixture corpus MEASURES
 * about it (Postgres 18.1, 55 chunks, the 25-question gold set) is the
 * separation it has to live in, and the number is reported here rather than
 * tuned to it: the four questions whose subject matter is absent from the
 * corpus peak at 0.200 / 0.200 / 0.200 / 0.143 coverage, while every question
 * the corpus can actually answer reaches 0.25-0.89. So a quarter sits inside
 * a real gap — but a NARROW one, and the gap is a property of an eight-file
 * synthetic corpus, not evidence about Turkish law. Treat the default as a
 * starting point to be re-measured on a real corpus, not as a validated
 * constant. Callers override it per query (the divergence-completion pass
 * deliberately runs lower).
 */
export const DEFAULT_LEXICAL_MIN_COVERAGE = 0.25;

export interface LexicalSearchOptions extends LaneQueryOptions {
  /**
   * Text-search configuration name. "turkish" (default) uses the stored
   * search_tsv_tr column; "simple" uses the stored search_tsv baseline
   * column; any other name computes to_tsvector on the fly (slow; intended
   * for config experiments — an unknown name makes Postgres raise, which the
   * search service surfaces as a contained lane failure).
   */
  config?: string;
  /** Query construction; see {@link LexicalQueryMode}. Default "coverage". */
  mode?: LexicalQueryMode;
  /**
   * Coverage floor in [0,1] for `mode: "coverage"`; default
   * {@link DEFAULT_LEXICAL_MIN_COVERAGE}. 0 disables the floor (pure OR).
   */
  minCoverage?: number;
  /**
   * Additive (2026-09-10): synonym / concept-expansion terms searched as
   * OR-alternatives NEXT TO the query. Their lexemes never count toward the
   * flat `minCoverage` rule (so the admitted set can only grow, never shrink)
   * and weigh `expansionWeight` times a query lexeme's IDF in the ranking.
   */
  expansionTerms?: readonly string[];
  /** Multiplier on an expansion lexeme's IDF; default DEFAULT_EXPANSION_TERM_WEIGHT. */
  expansionWeight?: number;
}

/**
 * Expansion lexemes weigh half a query lexeme (2026-09-10). A round value,
 * not a fitted one: the reader's own word must always outrank the synonym
 * the table supplied, and one half keeps two matched synonyms equal to one
 * matched query word — no single expansion can outweigh what the reader
 * wrote. Re-measure on a real corpus before moving it.
 */
export const DEFAULT_EXPANSION_TERM_WEIGHT = 0.5;

/**
 * Document-frequency cache lifetime. Chunks are written by the Python intake
 * process, which cannot reach this process's memory, so the cache expires on
 * a clock as well as on {@link invalidateLexicalStats}; one minute keeps a
 * freshly uploaded document's vocabulary out of the statistics for at most
 * that long, and the statistics only shape RANKING and the weighted
 * admission path — the flat coverage rule sees every row immediately.
 */
export const LEXICAL_DF_CACHE_TTL_MS = 60_000;

interface DfCache {
  /** Bumped by invalidateLexicalStats(); a stale generation is a miss. */
  generation: number;
  /** count(*) of legal.chunks visible to this connection, and when read. */
  total: { value: number; at: number } | undefined;
  /** config + "\u0000" + lexeme -> document frequency, and when read. */
  df: Map<string, { value: number; at: number }>;
}

/** One cache per pool/client object; a new client starts cold. */
const DF_CACHES = new WeakMap<object, DfCache>();
let dfGeneration = 0;

/**
 * Drop every cached document-frequency statistic (all connections). Called
 * by the upload and delete routes after the intake CLI reports success, and
 * usable by tests. Cheap: it only advances a generation counter.
 */
export function invalidateLexicalStats(): void {
  dfGeneration += 1;
}

function dfCacheFor(sql: Sql): DfCache {
  const key = sql as unknown as object;
  const existing = DF_CACHES.get(key);
  if (existing !== undefined && existing.generation === dfGeneration) return existing;
  const fresh: DfCache = { generation: dfGeneration, total: undefined, df: new Map() };
  DF_CACHES.set(key, fresh);
  return fresh;
}

/**
 * BM25's IDF: ln(1 + (N - df + 0.5) / (df + 0.5)). Always positive, so a
 * lexeme that no chunk carries (df = 0) simply weighs the most — it still
 * cannot match, exactly as under the flat rule, but it is not silently
 * dropped from the denominator either.
 */
export function bm25Idf(df: number, total: number): number {
  const d = Math.max(0, df);
  const n = Math.max(d, total);
  return Math.log(1 + (n - d + 0.5) / (d + 0.5));
}

/**
 * The lexemes `to_tsvector(config, text)` produces, in the SAME configuration
 * that produced the stored vector — so query and index cannot stem
 * differently. Empty input analyses to an empty array.
 */
export async function analyzeQueryLexemes(
  sql: Sql,
  config: string,
  text: string,
): Promise<string[]> {
  if (text.trim() === "") return [];
  const rows = await sql`
    select tsvector_to_array(to_tsvector(${config}::regconfig, ${text})) as lex`;
  const lex = rows[0]?.["lex"];
  return Array.isArray(lex) ? lex.map((v) => String(v)) : [];
}

export interface LexemeStats {
  /** Chunks visible to this connection (RLS applies). */
  total: number;
  /** Lexeme -> number of chunks whose vector carries it. */
  df: Map<string, number>;
  /** Lexeme -> BM25 IDF against `total`. */
  idf: Map<string, number>;
  /** How many lookups were answered from the cache (for tests/diagnostics). */
  cacheHits: number;
}

/**
 * Per-lexeme document frequency over legal.chunks, one GIN probe per
 * UNCACHED lexeme (`vector @@ 'lexeme'::tsquery`), never a full `ts_stat`
 * scan: the query only ever needs its own ten-odd lexemes and a cold
 * `ts_stat` over a large corpus would cost more than the search it serves.
 * Results are cached per connection object for {@link LEXICAL_DF_CACHE_TTL_MS}
 * or until {@link invalidateLexicalStats}.
 */
export async function lexemeDocumentFrequencies(
  sql: Sql,
  config: string,
  lexemes: readonly string[],
  now: number = Date.now(),
): Promise<LexemeStats> {
  const cache = dfCacheFor(sql);
  const fresh = (at: number): boolean => now - at < LEXICAL_DF_CACHE_TTL_MS;
  const vector = vectorColumn(sql, config);
  const distinct = [...new Set(lexemes)];
  const df = new Map<string, number>();
  const missing: string[] = [];
  let cacheHits = 0;
  for (const lexeme of distinct) {
    const hit = cache.df.get(config + "\u0000" + lexeme);
    if (hit !== undefined && fresh(hit.at)) {
      df.set(lexeme, hit.value);
      cacheHits += 1;
    } else {
      missing.push(lexeme);
    }
  }

  let total: number;
  if (cache.total !== undefined && fresh(cache.total.at)) {
    total = cache.total.value;
    cacheHits += 1;
  } else {
    const rows = await sql`select count(*)::int as total from legal.chunks c`;
    const totalRow = rows[0];
    total = totalRow === undefined ? 0 : asInt(totalRow, "total");
    cache.total = { value: total, at: now };
  }

  if (missing.length > 0) {
    // quote_literal(term)::tsquery parses the lexeme as a tsquery LITERAL —
    // no dictionary runs, so the already-stemmed lexeme is probed verbatim
    // (the same construction the main query uses for its OR-list).
    const rows = await sql`
      select
        t.term,
        (select count(*)::int from legal.chunks c
          where ${vector} @@ quote_literal(t.term)::tsquery) as df
      from unnest(${sql.array(missing)}::text[]) as t(term)`;
    for (const row of rows) {
      const term = String(row["term"]);
      const value = asInt(row, "df");
      df.set(term, value);
      cache.df.set(config + "\u0000" + term, { value, at: now });
    }
    for (const term of missing) if (!df.has(term)) df.set(term, 0);
  }

  const idf = new Map<string, number>();
  for (const [term, value] of df) idf.set(term, bm25Idf(value, total));
  return { total, df, idf, cacheHits };
}

function vectorColumn(sql: Sql, config: string) {
  return config === "turkish"
    ? sql`c.search_tsv_tr`
    : config === "simple"
      ? sql`c.search_tsv`
      : sql`to_tsvector(${config}::regconfig, c.search_text)`;
}

export async function lexicalSearch(
  sql: Sql,
  queryText: string,
  options: LexicalSearchOptions,
): Promise<ScoredChunk[]> {
  assertIsoDate(options.asOf);
  const config = options.config ?? "turkish";
  const mode: LexicalQueryMode = options.mode ?? "coverage";
  const minCoverage = options.minCoverage ?? DEFAULT_LEXICAL_MIN_COVERAGE;
  if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 1) {
    throw new RangeError(
      `minCoverage must be a number in [0,1], got ${String(options.minCoverage)}`,
    );
  }
  const vector = vectorColumn(sql, config);

  if (mode === "strict") {
    const tsquery = sql`websearch_to_tsquery(${config}::regconfig, ${queryText})`;
    const rows = await sql`
      select
        ${provenanceProjection(sql)},
        ts_rank_cd(${vector}, ${tsquery})::float8 as score
      from legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      where ${visibilityFilter(sql, options.asOf, options.filters)}
        and ${vector} @@ ${tsquery}
      order by score desc, ${stableTieBreak(sql)}
      limit ${options.limit}`;
    return rows.map((row) => ({
      provenance: mapProvenanceRow(row),
      score: asFloat(row, "score"),
    }));
  }

  // Coverage mode (IDF-aware since 2026-09-10; RESEARCH.md ledger).
  //
  // Three round-trips, deliberately:
  //   1. analyse the query (and the expansion terms) with the SAME text-search
  //      configuration that produced the indexed vector, so the two sides
  //      cannot stem differently — that parity is structural here;
  //   2. look up each lexeme's document frequency (cached per connection,
  //      see lexemeDocumentFrequencies) and turn it into a BM25 IDF;
  //   3. run the ranked query with the lexemes and their weights bound as
  //      parallel arrays.
  //
  // ADMISSION — a chunk is a candidate when EITHER
  //   (a) the flat rule holds: matched >= ceil(minCoverage * term_count),
  //       byte-for-byte the pre-2026-09-10 rule, so the admitted set can only
  //       GROW relative to it (recall never drops — pinned by a test); or
  //   (b) the IDF-weighted rule holds: the chunk carries at least one query
  //       lexeme AND the IDF it carries (query lexemes at full weight,
  //       expansion lexemes at expansionWeight) reaches minCoverage of the
  //       query's total IDF. A rare term is worth more than a common one, so
  //       "one rare word out of five" can pass where "one 'karar' out of
  //       five" cannot. The floor itself (minCoverage) is NOT lowered.
  // An expansion lexeme alone admits nothing: rule (b) demands a query
  // lexeme, and rule (a) never counts expansions. Synonyms re-rank and widen
  // the weighted path; they do not open the gate on their own.
  //
  // RANKING — ts_rank_cd with normalization 1 (rank / (1 + ln(length)), the
  // length normalization) multiplied by the weighted IDF share the chunk
  // carries, expansions included at their discount. ts_rank_cd already rewards
  // proximity; the IDF factor makes it prefer the chunk that carries the
  // reader's RARE words over the one that repeats the common ones.
  //
  // The tsquery is rebuilt from already-stemmed lexemes via quote_literal +
  // a ::tsquery CAST, which parses tsquery LITERAL syntax and applies no
  // dictionary (running them back through to_tsquery would stem them a second
  // time). Every lexeme is quoted and every untrusted value is a bound
  // parameter, so there is no injection surface: a query of
  // "'; drop table legal.chunks; --" analyses to zero lexemes and returns
  // zero rows before any ranked SQL runs.
  const expansionWeight = options.expansionWeight ?? DEFAULT_EXPANSION_TERM_WEIGHT;
  if (!Number.isFinite(expansionWeight) || expansionWeight < 0 || expansionWeight > 1) {
    throw new RangeError(
      `expansionWeight must be a number in [0,1], got ${String(options.expansionWeight)}`,
    );
  }
  const lexemes = await analyzeQueryLexemes(sql, config, queryText);
  if (lexemes.length === 0) return [];
  const lexemeSet = new Set(lexemes);
  const expansionText = (options.expansionTerms ?? []).join(" ");
  const expansionLexemes =
    expansionText.trim() === ""
      ? []
      : (await analyzeQueryLexemes(sql, config, expansionText)).filter(
          (lexeme) => !lexemeSet.has(lexeme),
        );

  const stats = await lexemeDocumentFrequencies(sql, config, [...lexemes, ...expansionLexemes]);
  const idfOf = (lexeme: string): number => stats.idf.get(lexeme) ?? bm25Idf(0, stats.total);
  const queryIdf = lexemes.map(idfOf);
  const expansionIdf = expansionLexemes.map((lexeme) => expansionWeight * idfOf(lexeme));
  const idfTotal = queryIdf.reduce((a, b) => a + b, 0);
  const rankTotal = idfTotal + expansionIdf.reduce((a, b) => a + b, 0);
  const allLexemes = [...lexemes, ...expansionLexemes];

  const rows = await sql`
    with q as (
      select
        ${sql.array(lexemes)}::text[] as lex,
        ${sql.array(queryIdf.map(String))}::float8[] as idf,
        ${sql.array(expansionLexemes)}::text[] as xlex,
        ${sql.array(expansionIdf.map(String))}::float8[] as xidf,
        ${lexemes.length}::int as term_count,
        ${idfTotal}::float8 as idf_total,
        ${rankTotal}::float8 as rank_total,
        (
          select array_to_string(array_agg(quote_literal(term)), ' | ')
          from unnest(${sql.array(allLexemes)}::text[]) as term
        )::tsquery as tsq
    )
    select
      ${provenanceProjection(sql)},
      (ts_rank_cd(${vector}, q.tsq, 1)::float8
        * ((m.matched_idf + m.expansion_idf) / q.rank_total))::float8 as score,
      (m.matched::float8 / q.term_count::float8) as coverage,
      (m.matched_idf / q.idf_total)::float8 as weighted_coverage,
      m.matched_terms,
      m.expansion_matches
    from q
    cross join legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id
    cross join lateral (
      select
        coalesce(mt.terms, '{}'::text[]) as matched_terms,
        coalesce(cardinality(mt.terms), 0) as matched,
        coalesce(mt.idf_sum, 0)::float8 as matched_idf,
        coalesce(xt.idf_sum, 0)::float8 as expansion_idf,
        coalesce(xt.n, 0) as expansion_matches
      from (select tsvector_to_array(${vector}) as arr) tv
      left join lateral (
        select array_agg(w.term order by w.ord) as terms, sum(w.idf) as idf_sum
        from unnest(q.lex, q.idf) with ordinality as w(term, idf, ord)
        where w.term = any(tv.arr)
      ) mt on true
      left join lateral (
        select count(*)::int as n, sum(w.idf) as idf_sum
        from unnest(q.xlex, q.xidf) as w(term, idf)
        where w.term = any(tv.arr)
      ) xt on true
    ) m
    where ${visibilityFilter(sql, options.asOf, options.filters)}
      and ${vector} @@ q.tsq
      and (
        m.matched >= ceil(${minCoverage}::float8 * q.term_count::float8)
        or (
          m.matched >= 1
          and (m.matched_idf + m.expansion_idf) / q.rank_total >= ${minCoverage}::float8
        )
      )
    order by score desc, weighted_coverage desc, coverage desc, ${stableTieBreak(sql)}
    limit ${options.limit}`;

  return rows.map((row) => {
    const matched = row["matched_terms"];
    return {
      provenance: mapProvenanceRow(row),
      score: asFloat(row, "score"),
      coverage: asFloat(row, "coverage"),
      weightedCoverage: asFloat(row, "weighted_coverage"),
      matchedLexemes: Array.isArray(matched) ? matched.map((v) => String(v)) : [],
      expansionMatches: asInt(row, "expansion_matches"),
    };
  });
}

// --------------------------------------------------------------------------
// (b) Trigram fallback lane
// --------------------------------------------------------------------------

export interface TrigramSearchOptions extends LaneQueryOptions {
  /**
   * Minimum extensions.word_similarity(query, search_text); default 0.5.
   * See D3 in the module header for why this is word_similarity and not the
   * symmetric similarity() the draft used.
   */
  minSimilarity?: number;
  /**
   * Wall budget for THIS lane in milliseconds; default
   * {@link DEFAULT_TRIGRAM_BUDGET_MS}. 0 means "no lane budget", i.e. the
   * connection's own statement_timeout is the only bound. See
   * {@link TrigramBudgetExceededError} for why the lane needs its own.
   */
  budgetMs?: number;
}

/**
 * Default per-lane wall budget for the trigram lane (W14 F-PERF, V-1).
 *
 * WHY A LANE BUDGET AND NOT THE CONNECTION'S. `createDb` sets
 * statement_timeout to 15 s for the whole connection, which is the right
 * bound for "a query that runs this long is a bug". It is the WRONG bound for
 * ONE lane of a multi-lane answer: an answer runs the trigram lane once for
 * the primary question and once for each contrary-authority probe, so a
 * saturated corpus paid 15 s three or four times over and the whole answer
 * took 45-60 s before returning ABSTAIN (measured end to end over HTTP on
 * 02.09.2026, probe database collex_perf_test, 20 000 chunks, avg search_text
 * 4 974 code points: p50 59 458 ms for "depozito iadesi", four lanes cut at
 * 15 s each, `trace.retrieve` 59 277 ms).
 *
 * 2 500 ms is chosen against a MEASURED cost model, not by taste: the recheck
 * cost of `<%` is linear in the text it scans, ~0.17 microseconds per code
 * point per candidate row (L-FIX section 6, re-confirmed here), so 2.5 s is
 * roughly 6 000 rows of 2 500 code points — comfortably above every selective
 * query measured on this machine (1.87 ms at 20 000 chunks) and far below the
 * point where a lawyer is left staring at a spinner. A lane that exceeds it
 * degrades honestly (RETRIEVAL_LANE_DEGRADED) instead of eating the answer's
 * whole 60 s budget.
 */
export const DEFAULT_TRIGRAM_BUDGET_MS = 2_500;

/** SQLSTATE PostgreSQL raises when a statement_timeout fires. */
const SQLSTATE_QUERY_CANCELED = "57014";

/**
 * The trigram lane ran past its own budget and was cancelled.
 *
 * Distinct from a generic lane failure on purpose: "the corpus is unreachable"
 * and "this lane is too slow on this corpus at this size" are different facts
 * and the warning a reader sees must not merge them. The message carries the
 * budget so the number on screen is the number that was enforced.
 */
export class TrigramBudgetExceededError extends Error {
  readonly code = "TRIGRAM_BUDGET_EXCEEDED";
  readonly budgetMs: number;
  constructor(budgetMs: number) {
    super(
      `trigram lane exceeded its ${budgetMs} ms budget (TRIGRAM_BUDGET_EXCEEDED)`,
    );
    this.name = "TrigramBudgetExceededError";
    this.budgetMs = budgetMs;
  }
}

/** True when `error` is a PostgreSQL statement_timeout cancellation. */
function isQueryCanceled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === SQLSTATE_QUERY_CANCELED
  );
}

/** Budgets must be a non-negative finite number of milliseconds. */
function assertBudget(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `budgetMs must be a non-negative number of milliseconds, got ${String(value)}`,
    );
  }
  return Math.floor(value);
}

/**
 * Transaction-local settings the trigram lane runs under (W14 B-06).
 *
 * `pg_trgm.word_similarity_threshold` is what the `<%` operator compares
 * against, so it MUST equal the lane's own `minSimilarity` or the operator
 * and the score in the SELECT list would describe two different cutoffs.
 *
 * WHICH THRESHOLD EVERY NUMBER BELOW BELONGS TO (W14 phase C, N-1).
 * ------------------------------------------------------------------
 * This block used to quote its speed-ups without saying at what
 * `pg_trgm.word_similarity_threshold` they were taken, and the reader was
 * entitled to assume they described the product. They do not describe the
 * ANSWER path. There are two defaults in this repository:
 *
 *   `retrieval/hybrid.ts  :: DEFAULT_SEARCH_LIMITS.trigramMinSimilarity = 0.5`
 *   `api/answerService.ts :: DEFAULT_ANSWER_LIMITS.trigramMinSimilarity = 0.35`
 *
 * and `clampAnswerLimits` may only raise a request's value, so `/v1/answer`
 * runs this lane at **0.35 and never at 0.5**. EVERY measurement in this
 * comment — the ~440x below, L-ANSWER's ~9 700x, F-PERF's 0.329 ms — was
 * taken at **0.5**, on a corpus where 0.5 made the GIN candidate set empty
 * and 0.35 did not (W14-F-VERIFY §2.2/§2.3 re-measured exactly that: the
 * same selective query cost 2.06 ms at 0.5 and 18 069 ms at 0.35, with
 * `enable_seqscan` making no difference at 0.35). Those numbers are real and
 * they are NOT a statement about `/v1/answer`.
 *
 * WHAT THIS LANE'S OWN PROBE MEASURED (W14 phase C, database
 * `collex_srv_test`: 20 000 chunks, avg search_text 5 749 code points, 26 MB
 * heap / 255 MB total / 19 MB `chunks_search_trgm`, 200-word SENTETIK
 * vocabulary, PostgreSQL 18, 03.09.2026), running THIS file's own SQL under
 * `EXPLAIN (ANALYZE, BUFFERS)`:
 *
 *   saturated query "depozito iadesi"
 *     0.35 seqscan off 38 343 ms · on 38 435 ms   (Bitmap Index Scan, rows=20 000)
 *     0.50 seqscan off 38 483 ms · on 38 408 ms   (same plan, same rows)
 *   selective query "kuantum mekaniginde dalga fonksiyonu"
 *     0.35 seqscan off 8 ms · on 1 ms             (Bitmap Index Scan, rows=0)
 *     0.50 seqscan off 1 ms · on 1 ms             (same plan, same rows)
 *
 * So on THIS corpus the threshold changed nothing and the setting changed
 * nothing: the planner chose the bitmap path unaided in all eight cells. The
 * honest conclusion is that both the 9 700x and the "no such thing as a
 * selective query at 0.35" finding are properties of a particular corpus's
 * trigram overlap with a particular query — not of the threshold, and not of
 * the setting. Neither is safe to quote as a product figure.
 *
 * WHY THE ANSWER PATH KEEPS 0.35 (measured, not assumed). Raising
 * `DEFAULT_ANSWER_LIMITS.trigramMinSimilarity` to 0.5 was tried and reverted:
 * `scripts/run_evals.py --run-date 2026-09-03` still passed all six hard
 * gates with identical Recall@5/10/20 (0.9429 / 1.0000 / 1.0000), identical
 * contrary-authority recall (1.0000, n=3), identical lane distribution
 * (trigram=5) and identical expected-unit-cited (95.2%) — but the answer-level
 * status counts moved COMPLETE 13 -> 14 / QUALIFIED 5 -> 4, and the row that
 * moved is `fx-amend-003`, which LOST its `CONFLICTING_AUTHORITIES` reasons.
 * The higher threshold buys no measured time on the probe above and costs a
 * caveat the reader was being given. So 0.35 stays, the two defaults stay
 * different on purpose, and what actually bounds this lane is
 * `DEFAULT_TRIGRAM_FALLBACK_MIN_HITS` (it only runs when the primary lanes
 * came up short) and `DEFAULT_TRIGRAM_BUDGET_MS` — not the threshold.
 *
 * `enable_seqscan = off` is a planner correction, not a preference, and the
 * reason is measured AT THRESHOLD 0.5 (probe database `collex_answer_test`,
 * 20 006 chunks, avg search_text 5 633 code points, PostgreSQL 18,
 * 02.09.2026):
 * `search_text` is large enough to live in TOAST, so `legal.chunks` is a
 * 5.5 MB / 691-page heap while the real per-row work is a detoast plus a
 * trigram extraction of ~5.6 kB. The planner prices one `<%` call at
 * cpu_operator_cost (0.0025) and therefore costs the whole sequential scan
 * at 941 units — against a measured 20 000 ms — and chooses it over the
 * 81 MB `chunks_search_trgm` GIN index. Turning the sequential path off for
 * THIS transaction restores the plan the index was created for; on a
 * selective query the same statement went 20 774 ms -> 47 ms (~440x) with an
 * identical result set. Both settings are `is_local = true`, so they end
 * with the transaction and touch no other query.
 *
 * W14 L-FIX — WHY THE SETTING STAYS, and what was tried instead.
 * Probe database `collex_fix_test`, rebuilt at 20 000 chunks (avg search_text
 * 4 903 code points, 39 MB heap + 119 MB TOAST, 23 MB trigram index),
 * 02.09.2026 — **all four items measured at threshold 0.5**:
 *
 *  1. `alter function extensions.word_similarity_op(text,text) cost N` — the
 *     principled replacement for the setting — was measured at N = 1, 10,
 *     100, 1 000 and 10 000. The plan did NOT change at any value (total cost
 *     349.8 -> 474.8; Seq Scan throughout), because the planner prices the
 *     operator against its own row ESTIMATE for the chunk scan, which is
 *     tiny. A cost that cannot move the plan cannot replace the setting.
 *  2. A bounded candidate set was rejected as unsound, not as expensive: the
 *     GIN `%>` condition already IS the tightest necessary condition for
 *     `a <% b`, and the ordering key is the score, which is only known AFTER
 *     the recheck — so any further truncation drops rows the result set
 *     requires. The acceptance criterion ("the result set stays what it is
 *     today") forbids it.
 *  3. The residual cost is measured and linear in the TEXT SCANNED, not in
 *     the plan: over the same 20 000 rows, `<%` against left(search_text, n)
 *     took 791 ms (n=250), 1 597 ms (500), 3 363 ms (1 000), 6 855 ms (2 000)
 *     and 16 746 ms (4 903) — ~0.17 microseconds per code point per row.
 *     That is trigram extraction over the candidate text, which no schema or
 *     storage change removes.
 *  4. On that saturated probe corpus the setting made no material difference
 *     (16.9 s with, 17.9 s without) because the GIN candidate set is every
 *     row; on the selective corpus L-ANSWER measured it was ~490x — again at
 *     threshold 0.5. Removing it would therefore regress a measured case; on
 *     this lane's own probe (above) it improved none, at either threshold.
 *     It stays, because a setting that is worth 490x in ONE measured case and
 *     costs nothing measurable in the others is not worth deleting — but the
 *     sentence "it wins 9 700x" must not be repeated about `/v1/answer`.
 *
 * WHAT BOUNDS THE LANE, then, is not the plan: a `statement_timeout` cuts a
 * saturated lane off, the failure becomes a lane failure, and the answer
 * comes back from the surviving lanes carrying `RETRIEVAL_LANE_DEGRADED` —
 * the console draws it. That whole path is pinned by
 * tests/integration/lfix.test.ts, which is what was actually missing: the
 * cost was known and the visibility was not.
 *
 * W14 F-PERF (V-1) closed the half L-FIX left open, and it did NOT do it by
 * making the recheck cheaper — that cost is a property of trigram extraction
 * over the candidate text and no schema change removes it. It did it by
 * asking a different question: WHEN must this lane run at all, and HOW LONG
 * may it run when it does.
 *
 *   * `hybrid.ts` now runs the lane as the FALLBACK its own name has always
 *     claimed it is (see DEFAULT_TRIGRAM_FALLBACK_MIN_HITS there): a query
 *     whose trigrams saturate a corpus is, structurally, a query whose WORDS
 *     are everywhere in that corpus, and those are exactly the queries the
 *     FTS lane answers first. Measured here: the saturated case never pays
 *     the recheck any more.
 *   * {@link DEFAULT_TRIGRAM_BUDGET_MS} bounds the lane at 2 500 ms for the
 *     residual case — a query the FTS lane cannot answer AND whose trigrams
 *     still saturate — so it degrades in 2.5 s instead of eating 15 s of a
 *     60 s answer budget, four times over.
 *
 * WHAT WAS TRIED AND NOT SHIPPED (measured 02.09.2026, `collex_perf_test`):
 * a stored short "search key" column (`left(search_text, n)`) with its own
 * trigram index. It works and it is fast — but it is fast by NOT LOOKING at
 * the rest of the passage, so a phrase past code point n stops being found.
 * With the fallback gate in place it buys nothing the gate has not already
 * bought, and it would buy it with silent recall loss, so it stays out. The
 * numbers are in docs/implementation/waves/W14-F-PERF.md.
 */
const TRIGRAM_SEQSCAN_SETTING = "enable_seqscan";
const TRIGRAM_THRESHOLD_SETTING = "pg_trgm.word_similarity_threshold";
const TRIGRAM_TIMEOUT_SETTING = "statement_timeout";

/** The lane's SELECT, shared by the query and its EXPLAIN (one source of SQL). */
function trigramSelect(sql: Sql, queryText: string, options: TrigramSearchOptions) {
  return sql`
    select
      ${provenanceProjection(sql)},
      extensions.word_similarity(${queryText}, c.search_text)::float8 as score
    from legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id
    where ${visibilityFilter(sql, options.asOf, options.filters)}
      and ${queryText} operator(extensions.<%) c.search_text
    order by score desc, ${stableTieBreak(sql)}
    limit ${options.limit}`;
}

/** word_similarity thresholds live in [0,1]; the GUC rejects anything else. */
function assertSimilarity(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `minSimilarity must be a number in [0,1], got ${String(value)}`,
    );
  }
  return value;
}

/**
 * pg_trgm word-similarity lane: recovers phrase hits the stemmer cannot,
 * above all Turkish dotted/dotless-I query forms (a user typing ASCII
 * "ISTANBUL" normalizes to "ıstanbul", which shares NO lexeme with the
 * stored "istanbul" under either text-search config — measured, see the
 * comment table in tests/store/retrieval.test.ts).
 *
 * word_similarity() is schema-qualified so the query never depends on
 * search_path, and it stays in the SELECT list because the fused score needs
 * it — but it is NOT the predicate any more. Until W14 the WHERE clause read
 *
 *     and extensions.word_similarity(<query>, c.search_text) >= <threshold>
 *
 * which is a function call over every row: not indexable, and measured at
 * 20 774 ms / `Seq Scan on chunks` on a 20 006-chunk probe database while the
 * `chunks_search_trgm` GIN index (migration 20260826030000, gin_trgm_ops
 * supports the word-similarity operators) sat unused. At that size the lane
 * hit the 15 s statement_timeout and died with
 * RETRIEVAL_LANE_DEGRADED on EVERY answer — three lanes, 45,8 s, ABSTAIN with
 * an empty evidence set that read, on screen, as "the corpus has nothing".
 * The predicate is now the indexable `<%` operator under the
 * word_similarity_threshold GUC, which is the exact same cutoff by
 * definition (`a <% b` ⇔ `word_similarity(a,b) >= threshold`), so the result
 * set is unchanged. See TRIGRAM_SEQSCAN_SETTING for why the planner also
 * needs correcting, and explainTrigramSearch for the plan regression test.
 *
 * The three settings are transaction-local, which is why the lane runs inside
 * `sql.begin`: `set_config(..., true)` outside a transaction is discarded
 * before the next statement.
 *
 * W14 F-PERF adds the third one — `statement_timeout` — see
 * {@link DEFAULT_TRIGRAM_BUDGET_MS}. It only ever LOWERS the bound: a lane
 * budget above the connection's own timeout would be a promise this function
 * cannot keep, so passing a larger number simply leaves the connection's
 * timeout in force.
 */
export async function trigramSearch(
  sql: Sql,
  queryText: string,
  options: TrigramSearchOptions,
): Promise<ScoredChunk[]> {
  assertIsoDate(options.asOf);
  const minSimilarity = assertSimilarity(options.minSimilarity ?? 0.5);
  const budgetMs = assertBudget(options.budgetMs ?? DEFAULT_TRIGRAM_BUDGET_MS);

  let rows: SqlRow[];
  try {
    rows = (await sql.begin(async (tx) => {
      const inner = tx as unknown as Sql;
      await inner`select set_config(${TRIGRAM_THRESHOLD_SETTING}, ${String(minSimilarity)}, true)`;
      await inner`select set_config(${TRIGRAM_SEQSCAN_SETTING}, 'off', true)`;
      if (budgetMs > 0) {
        await inner`select set_config(${TRIGRAM_TIMEOUT_SETTING}, ${String(budgetMs)}, true)`;
      }
      return trigramSelect(inner, queryText, options);
    })) as unknown as SqlRow[];
  } catch (error) {
    // A cancellation under OUR OWN budget is reported as such. Without this
    // the caller could not tell "this lane is too slow here" from "the
    // database went away", and both arrived as the driver's own sentence.
    if (budgetMs > 0 && isQueryCanceled(error)) {
      throw new TrigramBudgetExceededError(budgetMs);
    }
    throw error;
  }

  return rows.map((row) => ({
    provenance: mapProvenanceRow(row),
    score: asFloat(row, "score"),
  }));
}

export interface ExplainTrigramOptions extends TrigramSearchOptions {
  /**
   * Extra transaction-local planner settings, applied after the lane's own.
   *
   * The plan regression test uses it to switch off every access path except
   * the bitmap one, which turns "did the planner happen to prefer the index
   * here?" — a cost question whose answer depends on how many documents the
   * fixture has — into "CAN this predicate be served by an index at all?",
   * which is the property that regressed. Product code never passes it.
   */
  plannerSettings?: ReadonlyArray<readonly [string, string]>;
}

/**
 * `explain (format json)` for the exact statement `trigramSearch` runs.
 *
 * Exported so a test can assert the PLAN and not only the rows: the lane
 * silently regressed to a sequential scan and nothing caught it, because no
 * test in this repository had ever looked at a query plan. Returns the raw
 * JSON plan array PostgreSQL produces.
 */
export async function explainTrigramSearch(
  sql: Sql,
  queryText: string,
  options: ExplainTrigramOptions,
): Promise<unknown> {
  assertIsoDate(options.asOf);
  const minSimilarity = assertSimilarity(options.minSimilarity ?? 0.5);

  return (await sql.begin(async (tx) => {
    const inner = tx as unknown as Sql;
    await inner`select set_config(${TRIGRAM_THRESHOLD_SETTING}, ${String(minSimilarity)}, true)`;
    await inner`select set_config(${TRIGRAM_SEQSCAN_SETTING}, 'off', true)`;
    for (const [name, value] of options.plannerSettings ?? []) {
      await inner`select set_config(${name}, ${value}, true)`;
    }
    const rows = (await inner`
      explain (format json) ${trigramSelect(inner, queryText, options)}`) as unknown as SqlRow[];
    return rows[0]?.["QUERY PLAN"];
  })) as unknown;
}

// --------------------------------------------------------------------------
// (c) Exact-pin lane
// --------------------------------------------------------------------------

/**
 * Deterministic metadata lookups for parsed exact references. Returned rows
 * are PINNED: the retrieval pipeline places them first and never lets fused
 * scores displace them (brief 8.6).
 *
 * Resolution rules:
 *  - legislation refs + article refs  -> legislation_no AND article_no;
 *  - legislation refs alone           -> all chunks of that legislation
 *                                        (ordinal order, capped by limit);
 *  - court decision refs (E./K.)      -> docket_no AND decision_no;
 *  - article refs WITHOUT legislation -> skipped (corpus-wide "madde N" is
 *                                        ambiguous; never pin on it alone).
 *
 * The reference parser resolves bare abbreviations through its
 * LAW_ABBREVIATIONS table, so "TCK m. 157" arrives here already carrying
 * legislationNo "5237" — this lane needs no abbreviation logic of its own.
 *
 * Visibility (scope/published/as-of) still applies: a reference into a
 * version that is not in force on as_of must not produce a pinned hit.
 *
 * ORDERING ACROSS SEVERAL CITED LAWS (corrected 2026-08-27). The rows used to
 * come back `order by legislation_no, ordinal`, which concatenates: for
 * "7999 sayılı Kanun ile 6098 sayılı Türk Borçlar Kanununda hangi değişiklik
 * yapılmıştır?" — two laws, no article — all NINE chunks of 6098 were pinned
 * ahead of the FIRST chunk of 7999, so the law the question is actually about
 * started at rank 10 and fell out of every top-10 measurement. The rows are
 * now INTERLEAVED round-robin across the cited legislations (ordinal order
 * within each), so every law the reader named is represented from rank 1 and
 * a limit truncates all of them evenly instead of amputating the last one.
 * With a single cited law the ordering is unchanged.
 */
// --------------------------------------------------------------------------
// (e) Provenance hydration by chunk id
// --------------------------------------------------------------------------

/**
 * Provenance rows for a set of chunk ids, subject to the SAME visibility
 * filter every ranked lane uses.
 *
 * Why this exists (W19 phase D). Every other lane returns ROWS: it selects
 * the provenance projection alongside its score, so a hit arrives complete.
 * The dense lane returns only chunk IDS — a vector index knows which vectors
 * are near the query, not what document they belong to. Before this function
 * a dense-only id was scored, ranked, given lane provenance and then silently
 * dropped at assembly because `provenanceById` had no row for it. Dense
 * retrieval could therefore only ever re-rank what the lexical lanes had
 * already found, which is the exact opposite of what a semantic lane is for.
 *
 * THIS FUNCTION IS A SECURITY BOUNDARY, not a convenience. An ANN index is a
 * separate structure that does not know about tenancy, publication status,
 * as-of dates or file scope; asking it for neighbours can return a chunk the
 * caller must not see. Re-applying `visibilityFilter` here means a dense id
 * that fails the filter produces NO row and therefore never becomes a hit —
 * the index is untrusted input, and the database decides what is visible.
 * This is why hydration is not done from a cache or from the ids alone.
 *
 * Order is not meaningful: the caller holds the ranking. Ids that resolve to
 * nothing are simply absent from the result, which the caller reports as
 * dropped rather than treating as an error.
 */
export interface ProvenanceLookupOptions {
  /** ISO date the visibility filter resolves versions as of. */
  asOf: string;
  /** The SAME filters the ranked lanes ran with. */
  filters?: StoreSearchFilters | undefined;
}

export async function chunkProvenanceByIds(
  sql: Sql,
  chunkIds: readonly string[],
  options: ProvenanceLookupOptions,
): Promise<ChunkProvenance[]> {
  assertIsoDate(options.asOf);
  // Only well-formed uuids reach the query. The index is untrusted input,
  // and one malformed id would otherwise make PostgreSQL reject the whole
  // batch — losing every LEGITIMATE dense candidate along with it.
  const ids = unique(
    chunkIds.filter((id) => typeof id === "string" && UUID_RE.test(id)),
  );
  if (ids.length === 0) return [];
  const rows = await sql`
    select ${provenanceProjection(sql)}
    from legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id
    where c.id = any(${ids}::uuid[])
      and ${visibilityFilter(sql, options.asOf, options.filters)}`;
  return rows.map(mapProvenanceRow);
}

export async function exactPinLookup(
  sql: Sql,
  references: readonly ParsedReference[],
  options: LaneQueryOptions,
): Promise<PinnedChunk[]> {
  assertIsoDate(options.asOf);

  const legislationNos = unique(
    references
      .filter((r) => r.kind === "legislation" && r.legislationNo !== undefined)
      .map((r) => r.legislationNo as string),
  );
  const articleNos = unique(
    references
      .filter((r) => r.kind === "article" && r.articleNo !== undefined)
      .map((r) => r.articleNo as string),
  );
  const decisionRefs = references.filter(
    (r) =>
      r.kind === "court_decision" &&
      r.docketNo !== undefined &&
      r.decisionNo !== undefined,
  );

  const pinned: PinnedChunk[] = [];
  const seen = new Set<string>();

  if (legislationNos.length > 0) {
    const articleCondition =
      articleNos.length > 0 ? sql`and c.article_no = any(${articleNos})` : sql``;
    // STABLE WITHIN THE PARTITION. Two visible versions of one law (the
    // fixture's "değişiklik öncesi / sonrası" pair is exactly this) both carry
    // ordinal 1, so a bare chunk-uuid tie-break decided which version got rank
    // 1 by an id minted at ingest — and the outer LIMIT then kept a different
    // chunk after every re-ingest. Measured 03.09.2026: this is what moved
    // fx-amend-002 between ABSTAIN and COMPLETE across eval runs (W14 N-7).
    const rows = await sql`
      select * from (
        select
          ${provenanceProjection(sql)},
          row_number() over (
            partition by v.legislation_no
            order by c.ordinal asc, d.source asc, d.external_id asc, c.id asc
          ) as legislation_rank
        from legal.chunks c
        join legal.document_versions v on v.id = c.document_version_id
        join legal.documents d on d.id = v.document_id
        where ${visibilityFilter(sql, options.asOf, options.filters)}
          and v.legislation_no = any(${legislationNos})
          ${articleCondition}
      ) pinned
      order by legislation_rank asc, legislation_no asc, ordinal asc,
               source asc, external_id asc, chunk_id asc
      limit ${options.limit}`;
    for (const row of rows) {
      const provenance = mapProvenanceRow(row);
      if (seen.has(provenance.chunkId)) continue;
      seen.add(provenance.chunkId);
      pinned.push({
        provenance,
        pinReason:
          articleNos.length > 0
            ? `legislation_no=${provenance.legislationNo} article_no=${provenance.articleNo}`
            : `legislation_no=${provenance.legislationNo}`,
      });
    }
  }

  for (const ref of decisionRefs) {
    const docketNo = ref.docketNo as string;
    const decisionNo = ref.decisionNo as string;
    const rows = await sql`
      select ${provenanceProjection(sql)}
      from legal.chunks c
      join legal.document_versions v on v.id = c.document_version_id
      join legal.documents d on d.id = v.document_id
      where ${visibilityFilter(sql, options.asOf, options.filters)}
        and v.docket_no = ${docketNo}
        and v.decision_no = ${decisionNo}
      order by c.ordinal asc, c.id asc
      limit ${options.limit}`;
    for (const row of rows) {
      const provenance = mapProvenanceRow(row);
      if (seen.has(provenance.chunkId)) continue;
      seen.add(provenance.chunkId);
      pinned.push({
        provenance,
        pinReason: `docket_no=${docketNo} decision_no=${decisionNo}`,
      });
    }
  }

  return pinned;
}

// --------------------------------------------------------------------------
// (d) Canonical text fetch (evidence building)
// --------------------------------------------------------------------------

/**
 * Fetch the canonical text of a document version for evidence building.
 * Direct id lookup — deliberately NOT restricted to scope/published/as-of:
 * evidence verification must be able to re-hash any version it already holds
 * a reference to. Returns null when the version does not exist.
 *
 * SECURITY: because this bypasses the visibility filter, ROW LEVEL SECURITY
 * (migration 20260826060000, legal.document_versions policy) is the ONLY
 * thing standing between a caller and another tenant's canonical_text. Run it
 * on a tenant-scoped connection. On an RLS-bypassing role (table owner,
 * service_role) it reads every tenant's text by design, so that role must
 * never serve a user-facing request. tests/store/rls.test.ts pins both halves
 * of that contract.
 */
export async function fetchCanonicalText(
  sql: Sql,
  documentVersionId: string,
): Promise<CanonicalTextRecord | null> {
  if (!UUID_RE.test(documentVersionId)) {
    throw new RangeError(
      `documentVersionId must be a UUID, got "${documentVersionId}"`,
    );
  }
  const rows = await sql`
    select
      v.id as document_version_id,
      v.document_id as document_id,
      v.canonical_text as canonical_text,
      v.content_sha256 as content_sha256
    from legal.document_versions v
    where v.id = ${documentVersionId}
    limit 1`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    documentVersionId: asText(row, "document_version_id"),
    documentId: asText(row, "document_id"),
    canonicalText: asText(row, "canonical_text"),
    contentSha256: asText(row, "content_sha256"),
  };
}

// --------------------------------------------------------------------------
// (e) Temporal projection (the invariant the lanes rely on)
// --------------------------------------------------------------------------

/**
 * The document versions visible on `asOf` under the exact same predicate the
 * search lanes use. Exposed because the D1 invariant — AT MOST ONE version
 * per document for any as_of — is a property of this predicate, and a test
 * that asserts it here covers every lane at once.
 */
export async function listInForceVersions(
  sql: Sql,
  options: LaneQueryOptions,
): Promise<InForceVersion[]> {
  assertIsoDate(options.asOf);
  const rows = await sql`
    select
      d.id as document_id,
      v.id as document_version_id,
      d.source as source,
      d.external_id as external_id,
      v.effective_period::text as effective_period,
      upper_inf(v.system_period) as system_current
    from legal.document_versions v
    join legal.documents d on d.id = v.document_id
    where ${visibilityFilter(sql, options.asOf, options.filters)}
    order by d.source asc, d.external_id asc, v.id asc
    limit ${options.limit}`;

  return rows.map((row) => ({
    documentId: asText(row, "document_id"),
    documentVersionId: asText(row, "document_version_id"),
    source: asText(row, "source"),
    externalId: asText(row, "external_id"),
    effectivePeriod: asTextOrNull(row, "effective_period"),
    systemCurrent: row["system_current"] === true,
  }));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// --------------------------------------------------------------------------
// (f) Citator lane — legal.document_relations
// --------------------------------------------------------------------------

/**
 * Which side of an amendment edge the SEED was on.
 *
 *  "inbound"  — the seed is the document that was AMENDED; the edge leads to
 *               the instrument that amended it ("which laws amend TCK 157?").
 *  "outbound" — the seed is (a version of) the AMENDING instrument; the edge
 *               leads to the provision it changed.
 */
export type RelationDirection = "inbound" | "outbound";

/** One stored amendment edge, with the provenance a reader can audit. */
export interface RelationEdge {
  relationId: string;
  /** legal.relation_kind, e.g. "AMENDS". */
  kind: string;
  direction: RelationDirection;
  /** 'resolved' | 'ambiguous' | 'manual' | 'rejected'. */
  resolutionStatus: string;
  /** Resolver confidence in [0,1], or null when nothing was selected. */
  confidence: number | null;
  resolverVersion: string;
  /** The seed document (inbound) or seed version (outbound) it matched. */
  seedId: string;
  sourceChunkId: string | null;
  targetDocumentId: string;
  targetLegislationNo: string | null;
  targetArticleNo: string | null;
}

/** Which end of the edge this passage is. */
export type RelationRole = "amending" | "amended";

export interface CitatorHit {
  provenance: ChunkProvenance;
  edge: RelationEdge;
  role: RelationRole;
}

export interface CitatorLookupOptions {
  /** ISO date (YYYY-MM-DD); both ends are resolved as of this date. */
  asOf: string;
  /** Max passages returned. */
  limit: number;
  /** Seed documents — inbound edges point AT these. */
  documentIds: readonly string[];
  /**
   * Seed PASSAGES — outbound edges start from these exact chunks. Passage
   * level, not version level, on purpose: an omnibus law amends several
   * unrelated statutes, and a reader who reached its first article has not
   * asked about the statute its second article changes.
   */
  chunkIds: readonly string[];
  /** legal.relation_kind values to follow; default AMENDS + REPEALS. */
  kinds?: readonly string[];
  filters?: StoreSearchFilters;
}

/** Relation kinds the citator follows when the caller names none. */
export const DEFAULT_CITATOR_KINDS: readonly string[] = ["AMENDS", "REPEALS"];

/**
 * The INBOUND CITATOR (plus its outbound mirror).
 *
 * Lexical retrieval connects passages that share words. An amending
 * provision and the text it amends deliberately do not: "…157 nci
 * maddesinin birinci fıkrasında yer alan '…' ibaresi '…' şeklinde
 * değiştirilmiştir" contains neither the subject matter of the article nor
 * the words a reader would use to ask about it. That edge exists as DATA —
 * `legal.document_relations`, written at ingest from the instrument's own
 * amendment structure (ingestion/relations.py) — and this is the lookup that
 * follows it.
 *
 * Both ends of a matched edge are returned:
 *  - the AMENDING passage, taken from the relation's own `source_chunk_id`,
 *    so it is the exact provision that made the change and not a guess; and
 *  - the AMENDED provision, resolved from `target_locator` (legislation +
 *    article) through the ordinary as-of visibility filter, so it arrives in
 *    the version in force on the QUESTION's date.
 *
 * WHAT IT CANNOT DO. Only `resolution_status = 'resolved'` edges are
 * followed: an ambiguous or manually-queued target is a target nobody has
 * confirmed, and a citator must not turn "we are not sure which law this
 * points at" into a citation. An edge with no `source_chunk_id`, or whose
 * amending passage is not in force on `asOf`, is dropped whole — the lane
 * never asserts a change it cannot show the text of, and never reports a
 * 2024 amendment to a question asked as of 2021. A `target_locator` with no
 * article contributes no amended passage. Nothing here searches: with no
 * seeds it returns no rows, so it can never manufacture a hit for a question
 * the corpus cannot answer.
 */
export async function citatorLookup(
  sql: Sql,
  options: CitatorLookupOptions,
): Promise<CitatorHit[]> {
  assertIsoDate(options.asOf);
  const documentIds = unique(options.documentIds);
  const chunkIds = unique(options.chunkIds);
  if (documentIds.length === 0 && chunkIds.length === 0) return [];
  if (options.limit <= 0) return [];
  const kinds = unique([...(options.kinds ?? DEFAULT_CITATOR_KINDS)]);
  if (kinds.length === 0) return [];

  const edgeColumns = sql`
    r.id as relation_id,
    r.kind::text as kind,
    r.resolution_status as resolution_status,
    r.confidence::float8 as confidence,
    r.resolver_version as resolver_version,
    r.source_chunk_id as source_chunk_id,
    r.to_document_id as target_document_id,
    r.target_locator ->> 'legislation_no' as target_legislation_no,
    r.target_locator ->> 'article' as target_article_no`;

  const edges: RelationEdge[] = [];
  if (documentIds.length > 0) {
    // MOST RECENT CHANGE FIRST. "Which instruments amended this law?" has a
    // natural order and it is not the order the rows were inserted in; a
    // reader wants the latest amendment, and the cap must fall on the oldest
    // ones rather than on an arbitrary slice.
    edges.push(
      ...(
        await sql`
          select ${edgeColumns}, r.to_document_id as seed_id
          from legal.document_relations r
          join legal.document_versions fv on fv.id = r.from_document_version_id
          join legal.documents fd on fd.id = fv.document_id
          where r.resolution_status = 'resolved'
            and r.kind::text = any(${kinds})
            and r.source_chunk_id is not null
            and r.to_document_id = any(${documentIds}::uuid[])
          order by
            lower(fv.effective_period) desc nulls last,
            fv.publication_date desc nulls last,
            ${stableRelationTieBreak(sql)}
          limit ${options.limit}`
      ).map((row) => mapEdge(row, "inbound")),
    );
  }
  if (chunkIds.length > 0) {
    edges.push(
      ...(
        await sql`
          select ${edgeColumns}, r.source_chunk_id as seed_id
          from legal.document_relations r
          join legal.documents fd on fd.id = r.to_document_id
          where r.resolution_status = 'resolved'
            and r.kind::text = any(${kinds})
            and r.source_chunk_id = any(${chunkIds}::uuid[])
          order by r.kind::text asc, ${stableRelationTieBreak(sql)}
          limit ${options.limit}`
      ).map((row) => mapEdge(row, "outbound")),
    );
  }
  if (edges.length === 0) return [];

  // AN EDGE IS ONLY AS REAL AS ITS AMENDING PASSAGE.
  //
  // `amendingPassages` runs under the ordinary as-of visibility filter, so an
  // instrument that has not commenced on the question's date produces no
  // passage — and an edge with no visible amending passage is dropped whole,
  // taking its amended-side hit with it. Without that, a question asked as of
  // 2021 would be told which article a 2024 law changed, which is not a fact
  // about the law as of 2021. It also means the lane never asserts a change
  // it cannot show the reader the text of.
  const amending = await amendingPassages(sql, edges, options);
  const live = edges.filter(
    (edge) => edge.sourceChunkId !== null && amending.has(edge.sourceChunkId),
  );
  if (live.length === 0) return [];
  const amended = await amendedPassages(sql, live, options);

  // Deterministic emission order: edge order, amending passage before the
  // provision it changed (that is the order they are read in), deduped.
  const out: CitatorHit[] = [];
  const seen = new Set<string>();
  for (const edge of live) {
    for (const hit of [
      ...(amending.get(edge.sourceChunkId as string) ?? []),
      ...(amended.get(edge.relationId) ?? []),
    ]) {
      if (out.length >= options.limit) return out;
      if (seen.has(hit.provenance.chunkId)) continue;
      seen.add(hit.provenance.chunkId);
      out.push({ ...hit, edge });
    }
  }
  return out;
}

function mapEdge(row: SqlRow, direction: RelationDirection): RelationEdge {
  return {
    relationId: asText(row, "relation_id"),
    kind: asText(row, "kind"),
    direction,
    resolutionStatus: asText(row, "resolution_status"),
    confidence: row["confidence"] === null ? null : asFloat(row, "confidence"),
    resolverVersion: asText(row, "resolver_version"),
    seedId: asText(row, "seed_id"),
    sourceChunkId: asTextOrNull(row, "source_chunk_id"),
    targetDocumentId: asText(row, "target_document_id"),
    targetLegislationNo: asTextOrNull(row, "target_legislation_no"),
    targetArticleNo: asTextOrNull(row, "target_article_no"),
  };
}

/** The passages that MADE the changes, keyed by chunk id. */
async function amendingPassages(
  sql: Sql,
  edges: readonly RelationEdge[],
  options: CitatorLookupOptions,
): Promise<Map<string, Omit<CitatorHit, "edge">[]>> {
  const chunkIds = unique(
    edges
      .map((edge) => edge.sourceChunkId)
      .filter((id): id is string => id !== null),
  );
  const out = new Map<string, Omit<CitatorHit, "edge">[]>();
  if (chunkIds.length === 0) return out;

  const rows = await sql`
    select ${provenanceProjection(sql)}
    from legal.chunks c
    join legal.document_versions v on v.id = c.document_version_id
    join legal.documents d on d.id = v.document_id
    where ${visibilityFilter(sql, options.asOf, options.filters)}
      and c.id = any(${chunkIds}::uuid[])
    order by ${stableTieBreak(sql)}`;
  for (const row of rows) {
    const provenance = mapProvenanceRow(row);
    out.set(provenance.chunkId, [{ provenance, role: "amending" }]);
  }
  return out;
}

/** The provisions that WERE changed, keyed by relation id. */
async function amendedPassages(
  sql: Sql,
  edges: readonly RelationEdge[],
  options: CitatorLookupOptions,
): Promise<Map<string, Omit<CitatorHit, "edge">[]>> {
  const out = new Map<string, Omit<CitatorHit, "edge">[]>();
  const located = edges.filter((edge) => edge.targetArticleNo !== null);
  if (located.length === 0) return out;

  // Paired lookup: (document, article) is one locator, so the pairs are
  // zipped in SQL rather than crossed — a cross would resolve an article
  // number against a document the edge never named.
  const documents = located.map((edge) => edge.targetDocumentId);
  const articles = located.map((edge) => edge.targetArticleNo as string);
  const rows = await sql`
    select
      ${provenanceProjection(sql)},
      t.ordinality::int as pair_index
    from unnest(${documents}::uuid[], ${articles}::text[])
      with ordinality as t(document_id, article_no, ordinality)
    join legal.documents d on d.id = t.document_id
    join legal.document_versions v on v.document_id = d.id
    join legal.chunks c
      on c.document_version_id = v.id and c.article_no = t.article_no
    where ${visibilityFilter(sql, options.asOf, options.filters)}
    order by t.ordinality asc, c.ordinal asc, c.id asc`;

  for (const row of rows) {
    const index = asInt(row, "pair_index") - 1;
    const edge = located[index];
    if (edge === undefined) continue;
    const provenance = mapProvenanceRow(row);
    const existing = out.get(edge.relationId);
    const hit = { provenance, role: "amended" as const };
    if (existing === undefined) out.set(edge.relationId, [hit]);
    else existing.push(hit);
  }
  return out;
}
