-- 20260911110000_matter_analysis.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): FIRST and LAST
-- object created by this file; bootstrap needs both.
-- [LEDGER SENTINEL] regclass:app_private.matter_analysis_runs
-- [LEDGER SENTINEL] regclass:app_private.matter_observation_relations
-- [LEDGER SENTINEL] policy:app_private.matter_observation_relations.matter_observation_relations_tenant
--
-- Exhaustive Matter analysis (W19 phase G) + derived Matter intelligence
-- (phase H).
--
-- What this is for
-- ----------------
-- `/v1/answer` is top-K retrieval: it finds the best passages for a question.
-- That is the right shape for "what is the limitation period", and it is
-- mathematically incapable of answering "find EVERY contradiction in this
-- file", because top-K is a ranking, not a census. This schema is the census:
-- a durable ledger of every unit of the selected scope, what happened to it,
-- and what was derived from it.
--
-- Three tables, three different lifetimes
-- ---------------------------------------
--   matter_analysis_runs   one exhaustive review. Survives restarts.
--   matter_analysis_units  the CENSUS. One row per unit of work, with the
--                          source hash that makes resumption safe.
--   matter_observations    what was derived. Always points back to source.
--
-- Derived intelligence is a CACHE, never a source
-- -----------------------------------------------
-- Every observation carries the document version, the canonical range and
-- the quote hash it came from, plus the extractor/prompt/model version that
-- produced it. That is what lets a stale observation be invalidated (the
-- source hash changed) instead of quietly outliving the document it
-- describes. The source of truth remains file -> immutable version ->
-- canonical offsets -> exact quote.
--
-- Why not overload app_private.matter_items
-- -----------------------------------------
-- matter_items.payload is the lawyer's own workspace (notes, deadlines,
-- linked files). Writing a large machine-generated blob into it would mix
-- what the user recorded with what a model guessed, and the two have
-- different trust and different invalidation rules.
--
-- Local-testable: yes (no pgvector).

-- ---------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_analysis_runs (
  run_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  matter_id uuid not null
    references app_private.matters(id) on delete cascade,
  -- What the lawyer asked for. Drives which observation kinds the map stage
  -- extracts; the census is the same for all of them.
  task text not null
    check (task in ('full_review', 'contradictions', 'chronology',
                    'claim_evidence', 'red_team')),
  status text not null default 'queued'
    check (status in ('queued', 'mapping', 'aggregating', 'reducing',
                      'done', 'failed', 'cancelled')),
  -- The exact scope this run was asked to cover, so coverage is measured
  -- against what was SELECTED rather than against whatever was found.
  scope jsonb not null default '{}'::jsonb,
  -- Derived counts (see control-plane/src/exhaustive/processingCoverage.ts).
  -- `complete` is NOT stored: it is a pure function of the counts and is
  -- derived on read, so it can never drift from them.
  coverage jsonb not null default '{}'::jsonb,
  -- Identity of the analysis that produced this run's units and
  -- observations. A change here invalidates reuse.
  unit_builder_version text not null default 'units-v1',
  extractor_version text not null default 'extract-v1',
  model_id text,
  provider_trust text
    check (provider_trust is null or provider_trust in
           ('LOCAL_PROCESS', 'TRUSTED_LOCAL_NETWORK', 'CLOUD')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists matter_analysis_runs_matter_idx
  on app_private.matter_analysis_runs (tenant_id, matter_id, created_at desc);

create index if not exists matter_analysis_runs_active_idx
  on app_private.matter_analysis_runs (status, updated_at)
  where status in ('queued', 'mapping', 'aggregating', 'reducing');

-- ---------------------------------------------------------------------
-- units — THE CENSUS
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_analysis_units (
  run_id uuid not null
    references app_private.matter_analysis_runs(run_id) on delete cascade,
  -- Stable within a run: (file, version, unit ordinal).
  unit_no integer not null check (unit_no >= 1),
  tenant_id uuid not null,
  file_id text not null,
  document_version_id uuid not null
    references legal.document_versions(id) on delete cascade,
  -- Unicode code-point offsets into document_versions.canonical_text.
  start_char integer not null check (start_char >= 0),
  end_char integer not null check (end_char > start_char),
  -- sha256 hex of the UTF-8 bytes of THIS unit's canonical text. The
  -- resumption key: a unit whose hash still matches a completed row is not
  -- recomputed, and a unit whose document changed necessarily has a new hash
  -- and IS recomputed. This is what makes a restart cheap and a stale reuse
  -- impossible.
  source_sha256 text not null check (length(source_sha256) = 64),
  state text not null default 'pending'
    check (state in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  -- Why this unit contributes nothing, when it does not. An UNREADABLE unit
  -- is never counted as processed.
  skip_reason text
    check (skip_reason is null or skip_reason in
           ('UNREADABLE_NO_TEXT', 'SPARSE_TEXT', 'EXCLUDED_BY_REQUEST')),
  error text,
  -- Which analysis produced the done-state, so a version bump invalidates.
  extractor_version text,
  model_id text,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (run_id, unit_no)
);

comment on table app_private.matter_analysis_units is
  'One row per unit of an exhaustive review. This table IS the coverage '
  'claim: processing coverage is counted from it, never asserted by a model.';

create index if not exists matter_analysis_units_pending_idx
  on app_private.matter_analysis_units (run_id, state, unit_no);

create index if not exists matter_analysis_units_file_idx
  on app_private.matter_analysis_units (run_id, file_id);

-- Resumption lookup: "has this exact text already been analysed by this
-- extractor?" across runs of the same tenant.
create index if not exists matter_analysis_units_reuse_idx
  on app_private.matter_analysis_units
     (tenant_id, source_sha256, extractor_version)
  where state = 'done';

-- ---------------------------------------------------------------------
-- observations — the derived layer
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_observations (
  observation_id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.matter_analysis_runs(run_id) on delete cascade,
  tenant_id uuid not null,
  matter_id uuid not null
    references app_private.matters(id) on delete cascade,
  unit_no integer not null,
  kind text not null
    check (kind in ('proposition', 'event', 'entity', 'issue',
                    'question', 'claim', 'evidence_link')),
  -- Normalized statement, in Turkish, as extracted.
  statement text not null check (length(statement) between 1 and 4000),
  -- Normalization keys used to decide whether two observations are ABOUT the
  -- same thing (subject/predicate/time). Deliberately data, not prose, so a
  -- contradiction is a comparison a reviewer can audit.
  subject text,
  predicate text,
  -- Normalized ISO date/time when the observation carries one.
  occurred_on date,
  date_precision text
    check (date_precision is null or date_precision in
           ('exact', 'month', 'year', 'approximate')),
  -- PROVENANCE. Not optional: an observation that cannot be traced back to
  -- source text is not evidence, it is a guess.
  document_version_id uuid not null
    references legal.document_versions(id) on delete cascade,
  file_id text not null,
  start_char integer not null check (start_char >= 0),
  end_char integer not null check (end_char > start_char),
  quote text not null,
  -- sha256 of the quote, verified against canonical text exactly as every
  -- other citation in the product is.
  quote_sha256 text not null check (length(quote_sha256) = 64),
  -- The physical place a reader turns to ("s. 137"), when the document has
  -- one. NULL for formats with no stable locator.
  locator text,
  extractor_version text not null,
  model_id text,
  confidence real
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists matter_observations_run_kind_idx
  on app_private.matter_observations (run_id, kind);

create index if not exists matter_observations_matter_idx
  on app_private.matter_observations (tenant_id, matter_id, kind);

-- The contradiction engine's read: observations that talk about the same
-- subject/predicate pair, across ALL documents of the matter.
create index if not exists matter_observations_subject_idx
  on app_private.matter_observations (run_id, subject, predicate)
  where kind = 'proposition';

create index if not exists matter_observations_timeline_idx
  on app_private.matter_observations (run_id, occurred_on)
  where occurred_on is not null;

-- ---------------------------------------------------------------------
-- relations — how two observations stand to each other
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_observation_relations (
  relation_id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.matter_analysis_runs(run_id) on delete cascade,
  tenant_id uuid not null,
  left_observation_id uuid not null
    references app_private.matter_observations(observation_id) on delete cascade,
  right_observation_id uuid not null
    references app_private.matter_observations(observation_id) on delete cascade,
  -- A DIFFERENCE IS NOT AUTOMATICALLY A CONTRADICTION. The vocabulary keeps
  -- the weaker readings available so the engine is not forced to overstate:
  --   CONTRADICTION        both cannot be true
  --   TENSION              hard to reconcile, not impossible
  --   CORROBORATION        independent statements that agree
  --   INDEPENDENT          about the same subject, not in conflict
  --   INSUFFICIENT_EVIDENCE  comparable in principle, not on this text
  relation text not null
    check (relation in ('CONTRADICTION', 'TENSION', 'CORROBORATION',
                        'INDEPENDENT', 'INSUFFICIENT_EVIDENCE')),
  rationale text not null check (length(rationale) between 1 and 2000),
  detector text not null,
  confidence real
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- A person reviewed this relation and recorded a verdict.
  reviewed_by text,
  review_verdict text
    check (review_verdict is null or review_verdict in
           ('accepted', 'rejected', 'unsure')),
  created_at timestamptz not null default now(),
  -- One verdict per ordered pair per run; re-running updates rather than
  -- accumulating duplicates on restart.
  unique (run_id, left_observation_id, right_observation_id),
  -- A statement cannot contradict itself.
  constraint matter_observation_relations_distinct
    check (left_observation_id <> right_observation_id)
);

create index if not exists matter_observation_relations_run_idx
  on app_private.matter_observation_relations (run_id, relation);

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
-- Direct tenant scope, same shape as app_private.research_runs in
-- 20260826060000_rls.sql. Every table carries tenant_id explicitly so the
-- policy is a column comparison rather than a join a planner might drop.

alter table app_private.matter_analysis_runs enable row level security;
create policy matter_analysis_runs_tenant on app_private.matter_analysis_runs
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.matter_analysis_units enable row level security;
create policy matter_analysis_units_tenant on app_private.matter_analysis_units
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.matter_observations enable row level security;
create policy matter_observations_tenant on app_private.matter_observations
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.matter_observation_relations enable row level security;
create policy matter_observation_relations_tenant
  on app_private.matter_observation_relations
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete
      on app_private.matter_analysis_runs,
         app_private.matter_analysis_units,
         app_private.matter_observations,
         app_private.matter_observation_relations
      to authenticated;
  end if;
end
$$;
