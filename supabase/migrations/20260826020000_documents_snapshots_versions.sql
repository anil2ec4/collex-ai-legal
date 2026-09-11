-- 20260826020000_documents_snapshots_versions.sql
-- Canonical documents, immutable source snapshots, append-only versions.
-- Adapted from the master build brief section 7.1.
--
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): first object this
-- file creates, one mid-file, and the LAST. Bootstrap records the file
-- only when all three resolve, so a half-applied file never reads as
-- complete.
-- [LEDGER SENTINEL] regclass:legal.documents
-- [LEDGER SENTINEL] regclass:legal.source_snapshots
-- [LEDGER SENTINEL] regclass:legal.document_versions_snapshot_idx
--
-- corrected 2026-08-27 (P0 + P1; fixed in place because nothing has ever
-- been applied to a real database — see docs/implementation/SUPABASE-SETUP.md):
--
--   1. system_period default was tstzrange(now(), 'infinity', '[)').
--      'infinity' is a FINITE timestamptz VALUE, not an unbounded range
--      endpoint, so upper_inf(system_period) was ALWAYS false. Consequences
--      of the old default:
--        * document_versions_current_idx (WHERE upper_inf(system_period))
--          indexed ZERO rows;
--        * every "current version" query written as upper_inf(system_period)
--          returned NOTHING;
--        * system_period @> now() matched EVERY version instead of one;
--        * the close-on-append trigger in 20260826100000 and its unique
--          partial backstop were both dead code.
--      The default is now tstzrange(now(), null, '[)') — a genuinely
--      unbounded upper endpoint, for which upper_inf() is true.
--
--   2. Two published versions of the same document could carry overlapping
--      effective_period ranges, so "the text in force on date X" was
--      ambiguous and hybrid_search surfaced both with no tiebreak. An
--      EXCLUDE constraint now makes that state unrepresentable. The
--      previous version's open effective_period is closed at append time by
--      the trigger in 20260826100000 (one authoritative mechanism, in the
--      database, for every writer).
--
-- Local-testable: yes (no pgvector; needs btree_gist from 20260826010000).

-- Logical document identity (one row per source document, across versions).
create table legal.documents (
  id uuid primary key default gen_random_uuid(),
  scope legal.document_scope not null,
  tenant_id uuid null,
  source text not null,
  external_id text not null,
  document_type text not null,
  jurisdiction text not null default 'TR',
  title text,
  canonical_source_url text,
  created_at timestamptz not null default now(),
  check (
    (scope = 'public' and tenant_id is null)
    or (scope = 'tenant' and tenant_id is not null)
  )
);

create unique index documents_public_identity_uq
  on legal.documents (source, external_id)
  where tenant_id is null;

create unique index documents_tenant_identity_uq
  on legal.documents (tenant_id, source, external_id)
  where tenant_id is not null;

create index documents_tenant_idx
  on legal.documents (tenant_id, document_type);

-- Immutable record of every fetch from an upstream source. Raw bytes live
-- in object storage under raw_object_key; only hashes/metadata live here.
create table legal.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  requested_url text,
  final_url text,
  retrieved_at timestamptz not null,
  http_status integer,
  media_type text,
  raw_object_key text,
  raw_sha256 text not null check (length(raw_sha256) = 64),
  parser_name text,
  parser_version text,
  request_correlation_id text,
  metadata jsonb not null default '{}'::jsonb
);

-- Same source + external id + identical raw content = one snapshot row.
create unique index source_snapshot_dedupe_uq
  on legal.source_snapshots (source, external_id, raw_sha256);

-- Append-only parsed versions of a document.
-- Offset policy: start_char/end_char on legal.chunks index into
-- canonical_text counted in Unicode CODE POINTS (PostgreSQL character
-- semantics under UTF-8 == Python str indices). Never byte offsets.
create table legal.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references legal.documents(id) on delete cascade,
  source_snapshot_id uuid not null
    references legal.source_snapshots(id) on delete restrict,
  version_label text,
  status legal.document_status not null default 'parsed',
  effective_period daterange,
  -- System (transaction) time. NULL upper bound == unbounded == "still the
  -- current row": upper_inf() is true only for a NULL endpoint, never for
  -- the finite timestamptz value 'infinity'. Do NOT reintroduce 'infinity'
  -- here (see the corrected-2026-08-27 note at the top of this file).
  system_period tstzrange not null
    default tstzrange(now(), null, '[)'),
  decision_date date,
  publication_date date,
  court text,
  chamber text,
  docket_no text,
  decision_no text,
  legislation_no text,
  canonical_text text not null,
  normalized_text text not null,
  content_sha256 text not null check (length(content_sha256) = 64),
  structure jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, content_sha256),
  -- P1: exactly one PUBLISHED text of a document may be in force on any
  -- given calendar day. Without this, "hangi metin X tarihinde yürürlükte"
  -- has more than one answer and hybrid search returns both with no
  -- tiebreak. Draft/parsed/withdrawn rows and rows with an unknown
  -- (NULL) effective_period are deliberately outside the constraint: an
  -- append lands as 'parsed' first and only becomes exclusive when it is
  -- published. The 20260826100000 trigger closes the previous open
  -- effective_period at the new version's start so a normal append never
  -- trips this; a genuine overlap is an upstream/data bug and must fail.
  constraint document_versions_effective_no_overlap
    exclude using gist (document_id with =, effective_period with &&)
    where (status = 'published' and effective_period is not null)
);

-- "Current" version lookup: open-ended system_period rows only. This is a
-- live index again now that the default upper endpoint is NULL rather than
-- the finite value 'infinity'. The matching "exactly one open row per
-- document" unique backstop lives with the close-on-append trigger in
-- 20260826100000_version_transitions.sql.
create index document_versions_current_idx
  on legal.document_versions (document_id, lower(system_period))
  where upper_inf(system_period);

-- Temporal queries ("text in force on date X"). Plain GiST works for
-- range types out of the box (built-in range_ops opclass); this particular
-- index does not need btree_gist because it covers the range column alone.
-- (The document_versions_effective_no_overlap EXCLUDE above DOES need
-- btree_gist, for the uuid "=" GiST operator class.)
create index document_versions_effective_gist
  on legal.document_versions using gist (effective_period);

-- FK helper index (delete/restrict checks and snapshot-to-version joins).
create index document_versions_snapshot_idx
  on legal.document_versions (source_snapshot_id);
