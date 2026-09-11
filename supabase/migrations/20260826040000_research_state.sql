-- 20260826040000_research_state.sql
-- Durable research state (runs, steps, evidence, claims).
-- Adapted from the master build brief section 7.4.
--
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): FIRST and LAST
-- object created by this file; bootstrap needs both.
-- [LEDGER SENTINEL] type:legal.run_status
-- [LEDGER SENTINEL] regclass:app_private.claim_evidence
--
-- Local-testable: yes (no pgvector).

create type legal.run_status as enum
  ('queued', 'running', 'partial', 'verifying', 'complete', 'failed', 'cancelled');

create table app_private.research_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  matter_id uuid,
  user_id uuid not null,
  status legal.run_status not null default 'queued',
  question text not null,
  as_of date,
  plan jsonb,
  budgets jsonb not null,
  spent jsonb not null default '{}'::jsonb,
  config_snapshot jsonb not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index research_runs_tenant_idx
  on app_private.research_runs (tenant_id, created_at desc);

create table app_private.research_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.research_runs(id) on delete cascade,
  ordinal integer not null,
  capability text not null,
  idempotency_key text not null,
  input jsonb not null,
  outcome jsonb,
  status text not null,
  started_at timestamptz,
  completed_at timestamptz,
  unique (run_id, ordinal),
  unique (run_id, idempotency_key)
);

create table app_private.evidence_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.research_runs(id) on delete cascade,
  chunk_id uuid not null references legal.chunks(id) on delete restrict,
  document_version_id uuid not null
    references legal.document_versions(id) on delete restrict,
  quote text not null,
  start_char integer not null,
  end_char integer not null,
  quote_sha256 text not null,
  source_authority jsonb not null,
  currentness jsonb not null,
  retrieval_trace jsonb not null
);

create index evidence_items_run_idx
  on app_private.evidence_items (run_id);

create table app_private.claims (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references app_private.research_runs(id) on delete cascade,
  ordinal integer not null,
  text text not null,
  material boolean not null default true,
  status text not null check
    (status in ('supported', 'qualified', 'conflicted', 'unsupported')),
  confidence jsonb not null,
  unique (run_id, ordinal)
);

create table app_private.claim_evidence (
  claim_id uuid not null references app_private.claims(id) on delete cascade,
  evidence_id uuid not null
    references app_private.evidence_items(id) on delete cascade,
  relation text not null check
    (relation in ('supports', 'qualifies', 'contradicts')),
  entailment jsonb not null,
  primary key (claim_id, evidence_id, relation)
);
