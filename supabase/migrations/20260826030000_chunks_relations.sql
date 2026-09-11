-- 20260826030000_chunks_relations.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): FIRST and LAST
-- object created by this file; bootstrap needs both.
-- [LEDGER SENTINEL] regclass:legal.chunks
-- [LEDGER SENTINEL] regclass:legal.document_relations
-- [LEDGER SENTINEL] regclass:legal.document_relations_from_idx
--
-- Structural chunks with exact provenance + document relations.
-- Adapted from the master build brief section 7.2, WITHOUT any embedding
-- columns (embeddings live in separate profile-keyed tables, see
-- 20260826080000_vector_embeddings.sql).
--
-- corrected 2026-08-27 (P2 + P3; fixed in place because nothing has ever
-- been applied to a real database):
--
--   P2 chunk overlap — DECISION: chunks of one version MUST NOT overlap,
--   enforced by an EXCLUDE constraint. Reasoning: exact-citation provenance
--   (brief 5/8.5) requires a position -> chunk mapping that is a FUNCTION,
--   not a relation. If two chunks could both cover code point 1 234, then
--   "which chunk is this quote from" has two answers, the quote_sha256 in
--   app_private.evidence_items could verify against either, and a
--   currentness/authority decision attached to one chunk would silently not
--   apply to the other copy of the same sentence. The in-tree chunkers
--   (ingestion/chunking.py: legislation madde/fıkra, decision sections,
--   generic paragraphs) all emit strictly disjoint half-open spans, so this
--   constraint costs nothing today and turns a future overlapping-window
--   chunker into a loud failure rather than silent citation ambiguity.
--   If a long-madde sliding window is ever genuinely needed, the supported
--   shape is a SEPARATE retrieval-only projection keyed to these canonical
--   chunks (parent/child), never overlapping rows in this table.
--
--   P3 normalizer drift — search_text carried no record of WHICH normalizer
--   produced it, while two implementations exist in-tree
--   (legal_reference/normalize.py :: normalize_turkish_search and
--   control-plane/src/retrieval/normalize.ts :: normalizeTurkishSearch).
--   A normalizer_version column now names the authoritative one on every
--   row, so a normalizer change is detectable (and backfillable) instead of
--   silently splitting the lexical index into two incompatible halves.
--
-- Local-testable: yes (needs pg_trgm + btree_gist in schema "extensions").

create table legal.chunks (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null
    references legal.document_versions(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  structural_path text[] not null default '{}',
  article_no text,
  paragraph_no text,
  -- Unicode code-point offsets into document_versions.canonical_text.
  -- Invariant (checked by scripts/db_local_check.py):
  --   original_text = substring(canonical_text from start_char + 1
  --                             for end_char - start_char)
  -- which equals Python's canonical_text[start_char:end_char].
  start_char integer not null check (start_char >= 0),
  end_char integer not null check (end_char > start_char),
  original_text text not null,
  search_text text not null,
  -- Identity of the normalizer that produced search_text. 'trnorm-v1' is
  -- legal_reference/normalize.py :: normalize_turkish_search (NFC, soft
  -- hyphen strip, dash/quote unification, Turkish-locale lowercase,
  -- whitespace collapse), mirrored byte-for-byte by
  -- control-plane/src/retrieval/normalize.ts :: normalizeTurkishSearch and
  -- referenced as legal.embedding_profiles.normalization_version. Changing
  -- the normalizer means a NEW value here plus a backfill — never a silent
  -- in-place redefinition.
  normalizer_version text not null default 'trnorm-v1',
  -- sha256 hex of the UTF-8 bytes of original_text (pre-normalization).
  -- Exact citations always verify against this hash.
  content_sha256 text not null check (length(content_sha256) = 64),
  token_count integer,
  search_tsv tsvector generated always as
    (to_tsvector('simple'::regconfig, coalesce(search_text, ''))) stored,
  metadata jsonb not null default '{}'::jsonb,
  unique (document_version_id, ordinal),
  -- Kept alongside the EXCLUDE below: this is a plain btree and is what
  -- answers "give me the chunk at exactly [a, b)" cheaply; the GiST
  -- exclusion index is not an equality-lookup structure.
  unique (document_version_id, start_char, end_char),
  -- P2 DECISION (see header): position -> chunk must be unambiguous, so
  -- half-open [start_char, end_char) spans of one version may never
  -- overlap. Needs btree_gist for the uuid "=" GiST operator class.
  constraint chunks_no_overlap_within_version
    exclude using gist (
      document_version_id with =,
      int4range(start_char, end_char) with &&
    )
);

comment on constraint chunks_no_overlap_within_version on legal.chunks is
  'Exact-citation provenance requires a single chunk per code-point '
  'position. Overlapping retrieval windows, if ever needed, belong in a '
  'separate projection keyed to these canonical chunks.';

create index chunks_version_idx
  on legal.chunks (document_version_id, ordinal);

create index chunks_fts_gin
  on legal.chunks using gin (search_tsv);

-- Trigram index for fuzzy phrase matching. pg_trgm is installed in the
-- "extensions" schema, so the operator class must be schema-qualified;
-- "extensions.gin_trgm_ops" is valid CREATE INDEX syntax and does not
-- depend on search_path (verified against local scratch Postgres 18).
create index chunks_search_trgm
  on legal.chunks using gin (search_text extensions.gin_trgm_ops);

create table legal.document_relations (
  id uuid primary key default gen_random_uuid(),
  from_document_version_id uuid not null
    references legal.document_versions(id) on delete cascade,
  to_document_id uuid not null
    references legal.documents(id) on delete cascade,
  kind legal.relation_kind not null,
  source_chunk_id uuid references legal.chunks(id) on delete set null,
  target_locator jsonb not null default '{}'::jsonb,
  valid_period daterange,
  resolution_status text not null
    check (resolution_status in ('resolved', 'ambiguous', 'manual', 'rejected')),
  confidence numeric(5,4),
  resolver_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index document_relations_target_idx
  on legal.document_relations (to_document_id, kind);

-- FK helper index for version-side lookups and cascades.
create index document_relations_from_idx
  on legal.document_relations (from_document_version_id, kind);
