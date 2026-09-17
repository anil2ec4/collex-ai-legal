-- 20260913090000_analysis_stages.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): the FIRST object this
-- file adds (a column on a W19 table), the replaced CHECK in the middle, the
-- table it creates, and the LAST object (a policy).
-- [LEDGER SENTINEL] column:app_private.matter_analysis_units.extraction_state
-- [LEDGER SENTINEL] constraint:app_private.matter_intel_items.matter_intel_items_kind_check_v2
-- [LEDGER SENTINEL] regclass:app_private.matter_analysis_tasks
-- [LEDGER SENTINEL] policy:app_private.matter_analysis_tasks.matter_analysis_tasks_tenant
--
-- W21 — analytical completeness.
--
-- W20 proved that every selected unit of source text was READ. That is
-- necessary and not sufficient: the reduce stage then weighed only the first
-- 25 claims, showed each claim 8 lexically-similar candidates, and let the
-- synthesis see the first 40 findings. A run could therefore read 928/928
-- pages and still have analysed a prefix.
--
-- This migration adds the durable state that makes the LATER stages as
-- honest as the reading stage:
--
--   * per-unit EXTRACTION accounting (a unit can be read and still have its
--     structured extraction truncated or unverifiable);
--   * matter_analysis_tasks: one durable, leased row per analytical task —
--     every claim, every defense, every semantic contradiction batch, every
--     synthesis group at every level of the hierarchy — so a crash during
--     synthesis group 6 of 10 keeps groups 1..5 and nothing is recomputed or
--     duplicated;
--   * the two analytical coverage layers stored on the run next to (never
--     inside) the W19 processing coverage;
--   * intelligence item kinds for source-linked intermediate summaries, and
--     support states that say HOW MUCH was searched before "no support".
--
-- Additive only. No older migration is edited.
-- Local-testable: yes (no pgvector).

-- ---------------------------------------------------------------------
-- units: extraction accounting
-- ---------------------------------------------------------------------

alter table app_private.matter_analysis_units
  -- not_required  the task extracts no model items for this unit
  -- succeeded     every model item was located, nothing truncated
  -- incomplete    the unit was read but part of its extraction could not be
  --               verified or was cut at a response limit
  -- failed        extraction itself failed (the unit then fails too)
  add column if not exists extraction_state text
    check (extraction_state is null or extraction_state in
           ('not_required', 'succeeded', 'incomplete', 'failed')),
  add column if not exists generated_items integer not null default 0
    check (generated_items >= 0),
  add column if not exists accepted_items integer not null default 0
    check (accepted_items >= 0),
  add column if not exists ambiguous_quotes integer not null default 0
    check (ambiguous_quotes >= 0),
  add column if not exists truncated_responses integer not null default 0
    check (truncated_responses >= 0),
  add column if not exists continuation_passes integer not null default 0
    check (continuation_passes >= 0),
  add column if not exists repair_passes integer not null default 0
    check (repair_passes >= 0);

-- ---------------------------------------------------------------------
-- runs: the analytical coverage layers
-- ---------------------------------------------------------------------

-- `coverage` stays the W19 SOURCE-processing coverage and keeps its meaning.
-- These two are separate on purpose: all pages read is not the same claim as
-- all claims weighed.
alter table app_private.matter_analysis_runs
  add column if not exists extraction_coverage jsonb not null default '{}'::jsonb,
  add column if not exists intelligence_coverage jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- intelligence items: summary kinds and search-aware support states
-- ---------------------------------------------------------------------

alter table app_private.matter_intel_items
  drop constraint if exists matter_intel_items_item_kind_check;
alter table app_private.matter_intel_items
  drop constraint if exists matter_intel_items_kind_check_v2;
alter table app_private.matter_intel_items
  add constraint matter_intel_items_kind_check_v2 check (item_kind in (
    'entity', 'event', 'fact', 'claim', 'defense', 'evidence', 'legal_issue',
    'request', 'procedural_event', 'credibility_issue', 'contradiction',
    'question', 'missing_support', 'favorable_point', 'unfavorable_point',
    'opposing_theory', 'weakness', 'unsupported_proposition',
    'contrary_evidence', 'procedural_vulnerability', 'hypothetical_argument',
    -- W21: source-linked intermediate (per group) and final summaries of the
    -- hierarchical review. Every one still needs a source row (trigger).
    'issue_summary', 'review_summary'));

-- "No support" is only a finding when the search behind it was complete:
--   unsupported               nothing supports it after EVERY evidence item
--                             of the matter was compared with it
--   no_support_in_candidates  nothing supports it among the candidates that
--                             were compared; the rest of the evidence was not
--   search_incomplete         part of the comparison failed or never ran
--   not_weighed               the claim was never compared at all
alter table app_private.matter_intel_items
  drop constraint if exists matter_intel_items_support_status_check;
alter table app_private.matter_intel_items
  drop constraint if exists matter_intel_items_support_status_check_v2;
alter table app_private.matter_intel_items
  add constraint matter_intel_items_support_status_check_v2 check (
    support_status is null or support_status in (
      'supported', 'opposed', 'ambiguous', 'unsupported', 'disputed',
      'no_support_in_candidates', 'search_incomplete', 'not_weighed'));

-- ---------------------------------------------------------------------
-- durable analytical tasks
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_analysis_tasks (
  task_id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.matter_analysis_runs(run_id) on delete cascade,
  tenant_id uuid not null,
  --   plan                 a marker: this planning step has been done once
  --   weigh_claim          one claim against one batch of candidate evidence
  --   weigh_defense        the same for a defense
  --   contradiction_group  one batch of free-text proposition pairs
  --   synthesis_group      level 1: one batch of findings of one group
  --   synthesis_reduce     level >= 2: one batch of lower-level summaries
  stage text not null
    check (stage in ('plan', 'weigh_claim', 'weigh_defense',
                     'contradiction_group', 'synthesis_group',
                     'synthesis_reduce')),
  -- Stable within a run: re-planning after a crash inserts nothing twice.
  task_key text not null check (length(task_key) between 1 and 300),
  level integer not null default 0 check (level >= 0),
  seq integer not null default 0 check (seq >= 0),
  state text not null default 'pending'
    check (state in ('pending', 'running', 'done', 'failed', 'excluded')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  -- What the task is asked (ids and short statements, never whole documents)
  -- and what it answered. The answer is the durable intermediate result the
  -- next level reads; it is written in the same statement that marks the
  -- task done, under the lease.
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text check (error is null or length(error) <= 1000),
  exclusion_reason text
    check (exclusion_reason is null or length(exclusion_reason) <= 500),
  schema_version text not null,
  model_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, stage, task_key),
  -- An exclusion is never silent: it always carries its reason.
  constraint matter_analysis_tasks_excluded_reason
    check ((state = 'excluded') = (exclusion_reason is not null))
);

create index if not exists matter_analysis_tasks_claim_idx
  on app_private.matter_analysis_tasks (tenant_id, available_at)
  where state = 'pending';

create index if not exists matter_analysis_tasks_lease_idx
  on app_private.matter_analysis_tasks (tenant_id, lease_expires_at)
  where state = 'running';

create index if not exists matter_analysis_tasks_run_idx
  on app_private.matter_analysis_tasks (run_id, stage, state);

-- ---------------------------------------------------------------------
-- Row-level security (direct tenant scope, as the W19/W20 tables)
-- ---------------------------------------------------------------------

alter table app_private.matter_analysis_tasks enable row level security;
drop policy if exists matter_analysis_tasks_tenant on app_private.matter_analysis_tasks;
create policy matter_analysis_tasks_tenant on app_private.matter_analysis_tasks
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete
      on app_private.matter_analysis_tasks
      to authenticated;
  end if;
end
$$;
