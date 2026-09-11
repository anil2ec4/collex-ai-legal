-- 20260912110000_review_tables.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): FIRST and LAST object
-- created by this file.
-- [LEDGER SENTINEL] regclass:app_private.review_tables
-- [LEDGER SENTINEL] policy:app_private.review_table_cells.review_table_cells_tenant
--
-- W20 — the multi-document review grid, persisted and resumable.
--
-- Until now the grid lived in the browser: the console looped over
-- (document x question) and called /v1/answer once per cell. Closing the tab
-- or restarting the server threw every finished cell away, a failed cell
-- could only be retried by re-running the whole grid, and nothing recorded
-- which document VERSION a cell was answered over. This schema moves the
-- grid to the server without changing what a cell IS:
--
--   review_tables          the definition: title, matter/scope, options
--   review_table_columns   the questions, each with a MODE
--   review_table_rows      the documents, pinned to the version they had
--   review_table_cells     one row per (document x question): state, the
--                          answer, its provenance and verifier state
--
-- A cell is its own unit of work with a lease and a retry budget, exactly as
-- an analysis unit is, so one cell can be retried alone and a restart
-- resumes at the next unfinished cell.
--
-- Column MODE is the honesty mechanism: `answer` is targeted retrieval
-- (top-K) and is labelled as such; `extract_dates` / `extract_amounts` /
-- `extract_ratios` walk EVERY analysis unit of the row's document and carry
-- their own processing coverage, so "all dates in this document" is never
-- answered from a ranking.
--
-- Local-testable: yes (no pgvector).

create table if not exists app_private.review_tables (
  table_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  matter_id uuid references app_private.matters(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'cancelled')),
  generator_version text not null,
  -- The selection the table was asked to cover (file ids), verbatim.
  scope jsonb not null default '{}'::jsonb,
  -- Request options every cell is generated with (asOf, model use, ...).
  options jsonb not null default '{}'::jsonb,
  cancel_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists review_tables_matter_idx
  on app_private.review_tables (tenant_id, matter_id, created_at desc);

create table if not exists app_private.review_table_columns (
  table_id uuid not null
    references app_private.review_tables(table_id) on delete cascade,
  column_no integer not null check (column_no >= 1),
  tenant_id uuid not null,
  question text not null check (length(question) between 1 and 1000),
  mode text not null default 'answer'
    check (mode in ('answer', 'extract_dates', 'extract_amounts',
                    'extract_ratios')),
  primary key (table_id, column_no)
);

create table if not exists app_private.review_table_rows (
  table_id uuid not null
    references app_private.review_tables(table_id) on delete cascade,
  row_no integer not null check (row_no >= 1),
  tenant_id uuid not null,
  file_id text not null,
  file_name text,
  -- The version the row was created over. A newer upload of the same file
  -- does not silently change what a finished cell was answered from.
  document_version_id uuid
    references legal.document_versions(id) on delete set null,
  primary key (table_id, row_no),
  unique (table_id, file_id)
);

create table if not exists app_private.review_table_cells (
  table_id uuid not null,
  row_no integer not null,
  column_no integer not null,
  tenant_id uuid not null,
  state text not null default 'pending'
    check (state in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  -- The answer, as the pipeline produced it (status + rendered text).
  answer_status text,
  answer_text text check (answer_text is null or length(answer_text) <= 8000),
  -- What the verifier concluded about the answer's support, or the
  -- exhaustive extraction's coverage verdict.
  support_state text
    check (support_state is null or support_state in
           ('verified', 'partially_verified', 'unverified', 'abstained',
            'no_evidence', 'exhaustive_complete', 'exhaustive_incomplete')),
  -- Citations: [{fileId, documentVersionId, startChar, endChar,
  -- quoteSha256, locator}] — the same provenance every answer carries.
  provenance jsonb not null default '[]'::jsonb,
  processing_coverage jsonb,
  answer_run_id text,
  generator_version text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (table_id, row_no, column_no),
  foreign key (table_id, row_no)
    references app_private.review_table_rows(table_id, row_no) on delete cascade,
  foreign key (table_id, column_no)
    references app_private.review_table_columns(table_id, column_no)
    on delete cascade
);

create index if not exists review_table_cells_claim_idx
  on app_private.review_table_cells (table_id, available_at)
  where state = 'pending';

create index if not exists review_table_cells_lease_idx
  on app_private.review_table_cells (lease_expires_at)
  where state = 'running';

alter table app_private.review_tables enable row level security;
create policy review_tables_tenant on app_private.review_tables
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.review_table_columns enable row level security;
create policy review_table_columns_tenant on app_private.review_table_columns
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.review_table_rows enable row level security;
create policy review_table_rows_tenant on app_private.review_table_rows
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.review_table_cells enable row level security;
create policy review_table_cells_tenant on app_private.review_table_cells
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete
      on app_private.review_tables,
         app_private.review_table_columns,
         app_private.review_table_rows,
         app_private.review_table_cells
      to authenticated;
  end if;
end
$$;
