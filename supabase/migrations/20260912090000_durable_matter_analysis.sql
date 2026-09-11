-- 20260912090000_durable_matter_analysis.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): the FIRST object this
-- file adds (a column on a W19 table), the widened CHECK in the middle, the
-- first table it creates, and the LAST object (a policy).
-- [LEDGER SENTINEL] column:app_private.matter_analysis_runs.identity_key
-- [LEDGER SENTINEL] constraint:app_private.matter_observations.matter_observations_kind_check_v2
-- [LEDGER SENTINEL] regclass:app_private.matter_intel_items
-- [LEDGER SENTINEL] policy:app_private.matter_intel_links.matter_intel_links_tenant
--
-- W20 — durable, resumable Matter analysis + derived Matter Intelligence.
--
-- Why W19's ledger was not enough
-- -------------------------------
-- W19 wrote the census before the work, but executed the whole map phase in
-- memory inside one HTTP request and persisted observations only when it had
-- finished. A process that died at unit 846 therefore lost units 1..845's
-- observations even though the census said they were pending — "resumable"
-- in the schema, not in fact. This file adds what a real worker needs:
--
--   * a LEASE per unit (lease_owner / lease_expires_at), so a unit claimed by
--     a worker that died is recognisably stale and can be re-claimed;
--   * retry accounting (attempts / max_attempts / available_at), so one
--     poison unit ends in a TERMINAL failure instead of looping forever;
--   * a stable OBSERVATION KEY with a unique index, so re-processing a unit
--     after a lost acknowledgement cannot duplicate findings;
--   * a frozen run IDENTITY (identity_key + snapshot) — tenant, matter, task,
--     files, pinned document VERSION ids, builder/extractor/model versions —
--     so an interrupted run is only ever resumed by a request for exactly the
--     same work, and never silently re-pointed at a newer document version.
--
-- Version semantics (ADR-034): a run is an IMMUTABLE SNAPSHOT. It pins the
-- document version ids it was created over and keeps reading those versions
-- even if a newer version is published meanwhile (old versions are retained,
-- see the version-transition migration). A new request after a source change
-- has a different identity and gets a new run. The ledger and every
-- observation therefore always name the same version.
--
-- Derived intelligence is a CACHE
-- -------------------------------
-- matter_intel_items is the lawyer-facing layer (entities, events, claims,
-- evidence, contradictions, open questions, red-team points). Every item is
-- tied to one or more stored observations through matter_intel_sources, and
-- every observation carries the exact version/offset/quote hash it came
-- from. A deferred constraint trigger refuses to COMMIT an item that has no
-- source row: provenance is enforced by the database, not by convention.
--
-- Local-testable: yes (no pgvector).

-- ---------------------------------------------------------------------
-- runs: identity, snapshot, lease, cancellation
-- ---------------------------------------------------------------------

alter table app_private.matter_analysis_runs
  add column if not exists identity_key text
    check (identity_key is null or identity_key ~ '^[0-9a-f]{64}$'),
  add column if not exists snapshot jsonb not null default '{}'::jsonb,
  add column if not exists model_schema_version text,
  add column if not exists provider text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists stage_attempts integer not null default 0
    check (stage_attempts >= 0),
  add column if not exists max_stage_attempts integer not null default 3
    check (max_stage_attempts > 0),
  -- What the reduce stage produced (counts, synthesis report). Never the
  -- findings themselves: those are rows in matter_intel_items.
  add column if not exists result_summary jsonb not null default '{}'::jsonb;

comment on column app_private.matter_analysis_runs.identity_key is
  'sha256 over the frozen run identity (tenant, matter, task, files, pinned '
  'version ids, unit builder, extractor, model schema, model/provider). An '
  'interrupted run is resumed only by a request with the same identity.';

-- At most ONE active run per identity: two concurrent POSTs for the same
-- work cannot both create a census.
create unique index if not exists matter_analysis_runs_active_identity_uq
  on app_private.matter_analysis_runs (tenant_id, identity_key)
  where status in ('queued', 'mapping', 'aggregating', 'reducing')
    and identity_key is not null;

create index if not exists matter_analysis_runs_lease_idx
  on app_private.matter_analysis_runs (status, lease_expires_at)
  where status in ('queued', 'mapping', 'aggregating', 'reducing');

-- ---------------------------------------------------------------------
-- units: lease + retry accounting
-- ---------------------------------------------------------------------

alter table app_private.matter_analysis_units
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists max_attempts integer not null default 3
    check (max_attempts > 0),
  add column if not exists model_schema_version text,
  add column if not exists rejected_quotes integer not null default 0
    check (rejected_quotes >= 0),
  -- Model items that failed the strict output schema (not a quote problem).
  add column if not exists invalid_items integer not null default 0
    check (invalid_items >= 0),
  add column if not exists observation_count integer not null default 0
    check (observation_count >= 0);

create index if not exists matter_analysis_units_claim_idx
  on app_private.matter_analysis_units (run_id, available_at, unit_no)
  where state = 'pending';

create index if not exists matter_analysis_units_lease_idx
  on app_private.matter_analysis_units (lease_expires_at)
  where state = 'running';

-- ---------------------------------------------------------------------
-- observations: stable identity, origin, widened kinds
-- ---------------------------------------------------------------------

alter table app_private.matter_observations
  add column if not exists observation_key text
    check (observation_key is null or observation_key ~ '^[0-9a-f]{64}$'),
  add column if not exists origin text not null default 'deterministic'
    check (origin in ('deterministic', 'model')),
  add column if not exists provider text,
  add column if not exists model_schema_version text;

alter table app_private.matter_observations
  drop constraint if exists matter_observations_kind_check;
alter table app_private.matter_observations
  drop constraint if exists matter_observations_kind_check_v2;
alter table app_private.matter_observations
  add constraint matter_observations_kind_check_v2 check (kind in (
    'proposition', 'event', 'entity', 'issue', 'question', 'claim',
    'evidence_link', 'fact', 'defense', 'evidence', 'legal_issue', 'request',
    'procedural_event', 'credibility_issue', 'possible_conflict'));

-- Idempotency: the same (run, unit, extractor, proposition identity) can be
-- written any number of times and exists once. NULL keys (W19 rows) are
-- distinct under a unique index, so old data is untouched.
create unique index if not exists matter_observations_key_uq
  on app_private.matter_observations (run_id, observation_key);

-- ---------------------------------------------------------------------
-- Matter Intelligence: items, their source spans, and links between items
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_intel_items (
  item_id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.matter_analysis_runs(run_id) on delete cascade,
  tenant_id uuid not null,
  matter_id uuid not null
    references app_private.matters(id) on delete cascade,
  item_kind text not null check (item_kind in (
    'entity', 'event', 'fact', 'claim', 'defense', 'evidence', 'legal_issue',
    'request', 'procedural_event', 'credibility_issue', 'contradiction',
    'question', 'missing_support', 'favorable_point', 'unfavorable_point',
    'opposing_theory', 'weakness', 'unsupported_proposition',
    'contrary_evidence', 'procedural_vulnerability', 'hypothetical_argument')),
  -- Stable within a run; re-running the reduce stage upserts, never doubles.
  item_key text not null check (length(item_key) between 1 and 200),
  title text not null check (length(title) between 1 and 500),
  body text check (body is null or length(body) <= 4000),
  occurred_on date,
  date_precision text
    check (date_precision is null or date_precision in
           ('exact', 'month', 'year', 'approximate')),
  party_role text check (party_role is null or length(party_role) <= 100),
  stance text
    check (stance is null or stance in
           ('favorable', 'unfavorable', 'neutral', 'unknown')),
  support_status text
    check (support_status is null or support_status in
           ('supported', 'opposed', 'ambiguous', 'unsupported', 'disputed')),
  -- A hypothetical argument is ALWAYS labelled hypothetical and nothing else
  -- ever is: the red-team lane may argue, but it may not pass an argument
  -- off as a finding.
  hypothetical boolean not null default false,
  confidence real
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  producer text not null check (producer in ('deterministic', 'model')),
  producer_version text not null,
  model_id text,
  provider text,
  -- Small, kind-specific extras (entity type, normalized value, ...). The
  -- facts a reviewer filters on are real columns above.
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, item_kind, item_key),
  constraint matter_intel_items_hypothetical
    check ((item_kind = 'hypothetical_argument') = hypothetical)
);

create index if not exists matter_intel_items_matter_idx
  on app_private.matter_intel_items (tenant_id, matter_id, item_kind);

create index if not exists matter_intel_items_run_idx
  on app_private.matter_intel_items (run_id, item_kind);

create table if not exists app_private.matter_intel_sources (
  item_id uuid not null
    references app_private.matter_intel_items(item_id) on delete cascade,
  observation_id uuid not null
    references app_private.matter_observations(observation_id) on delete cascade,
  tenant_id uuid not null,
  -- basis    the span the item was read from
  -- mention  another place the same thing is named
  -- support / oppose / ambiguous  the span's stance toward a claim
  role text not null
    check (role in ('basis', 'mention', 'support', 'oppose', 'ambiguous')),
  primary key (item_id, observation_id, role)
);

create index if not exists matter_intel_sources_observation_idx
  on app_private.matter_intel_sources (observation_id);

create table if not exists app_private.matter_intel_links (
  from_item_id uuid not null
    references app_private.matter_intel_items(item_id) on delete cascade,
  to_item_id uuid not null
    references app_private.matter_intel_items(item_id) on delete cascade,
  tenant_id uuid not null,
  link_kind text not null check (link_kind in (
    'supports', 'opposes', 'ambiguous', 'concerns_issue', 'contradicts',
    'weakens', 'answers')),
  rationale text check (rationale is null or length(rationale) <= 2000),
  confidence real
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  producer text not null check (producer in ('deterministic', 'model')),
  primary key (from_item_id, to_item_id, link_kind),
  constraint matter_intel_links_distinct check (from_item_id <> to_item_id)
);

create index if not exists matter_intel_links_to_idx
  on app_private.matter_intel_links (to_item_id);

-- Provenance is enforced at COMMIT: an item inserted without at least one
-- source row makes the whole transaction fail. Deferred, so the item and its
-- sources can be written in either order inside one transaction.
create or replace function app_private.matter_intel_item_requires_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app_private.matter_intel_items i
              where i.item_id = new.item_id)
     and not exists (select 1 from app_private.matter_intel_sources s
                      where s.item_id = new.item_id) then
    raise exception 'matter intelligence item % has no source span', new.item_id
      using errcode = '23514';
  end if;
  return null;
end
$$;

drop trigger if exists matter_intel_items_require_source
  on app_private.matter_intel_items;
create constraint trigger matter_intel_items_require_source
  after insert on app_private.matter_intel_items
  deferrable initially deferred
  for each row execute function app_private.matter_intel_item_requires_source();

-- ---------------------------------------------------------------------
-- Row-level security (direct tenant scope, as the W19 tables)
-- ---------------------------------------------------------------------

alter table app_private.matter_intel_items enable row level security;
create policy matter_intel_items_tenant on app_private.matter_intel_items
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.matter_intel_sources enable row level security;
create policy matter_intel_sources_tenant on app_private.matter_intel_sources
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.matter_intel_links enable row level security;
create policy matter_intel_links_tenant on app_private.matter_intel_links
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete
      on app_private.matter_intel_items,
         app_private.matter_intel_sources,
         app_private.matter_intel_links
      to authenticated;
  end if;
end
$$;
