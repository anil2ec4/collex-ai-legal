-- 20260902120000_matters_persistence.sql
-- Matter workspace ("Davalarım"), durable answers/drafts, lawyer settings.
--
-- diagnosis (audit of 02.09.2026, P0):
--
--   Every answer and every draft the control-plane produced lived ONLY in a
--   bounded in-memory map (InMemoryAnswerStore capacity 32, InMemoryDraftStore
--   capacity 64). Two consequences were measured on the running product:
--     * a restart of serve.mjs lost every answer and draft — the evidence
--       bundle a lawyer had just exported could no longer be re-opened by
--       runId (GET /v1/answers/{runId} -> 404);
--     * the 33rd question silently evicted the 1st: a lawyer working through
--       a file over a morning lost the earliest results without any signal.
--   There was also no matter/case concept at all (nothing tied an upload, an
--   answer and a draft to the same dispute), no lawyer profile for the vekil
--   block of a petition, and no place to keep deadlines.
--
-- fix: five tenant-scoped tables under app_private, written through by the
-- TS stores (control-plane/src/store/answerStore.ts, draftStore.ts,
-- control-plane/src/matters/store.ts, control-plane/src/settings/store.ts):
--
--   app_private.matters       one row per dava dosyası (matter);
--   app_private.matter_items  polymorphic children of a matter: file /
--                             answer / draft / note / event / deadline, with
--                             the item body in jsonb (payload) and an
--                             optional reference into another store (ref_id:
--                             fileId, runId, draftId);
--   app_private.answers       one row per answer run (result + evidence
--                             bundle WITH canonical texts, so the exporter's
--                             full-chain verification keeps working after a
--                             restart);
--   app_private.drafts        append-only draft VERSIONS, pk (draft_id,
--                             version_no); "the draft" is its highest
--                             version;
--   app_private.settings      (tenant_id, key) -> jsonb; keys 'profile' and
--                             'preferences'.
--
-- Tenancy (ADR-011): every table carries tenant_id and RLS resolves tenancy
-- through app_private.current_tenant_id() exactly like research_runs;
-- matter_items additionally resolves through the OWNING MATTER, so a child
-- row can never be visible (or writable) when its parent is not. No table
-- here has a plain grant without a policy. Local single-user mode connects
-- as the owner (RLS bypass), which is the documented posture of the
-- product; the policies exist so the same schema is safe on a real
-- multi-tenant runtime.
--
-- Idempotent on purpose (create ... if not exists / drop policy if exists):
-- this migration is the first one that ensure-db applies to an EXISTING
-- database through the new migration ledger (ingestion/migrations.py,
-- app_private.schema_migrations), and it is re-applied by
-- scripts/db_local_check.py to prove that.
--
-- NOTE the ledger table app_private.schema_migrations is deliberately NOT
-- created here. The ledger code creates it and treats "ledger absent or
-- empty while legal.documents exists" as the bootstrap signal for databases
-- that predate the ledger; a migration creating an empty ledger would turn
-- every such database into "nothing applied" and replay the whole chain.
--
-- Local-testable: yes (no pgvector).
--
-- Ledger bootstrap sentinel (ingestion/migrations.py): on a pre-ledger
-- database this file is recorded as applied when the relation below already
-- exists, and applied otherwise. The line must start with the marker.
-- Multi-sentinel (W14 B-05). The single probe below named a table created
-- at ~line 180 while the RLS block runs at 229-283: ENGRISK applied the
-- first 228 lines on a scratch database and bootstrap recorded the file
-- as applied, leaving five app_private tables WITHOUT row security and
-- without policies, forever (--ensure-db never revisits a recorded file).
-- The last probe now names the LAST object the file creates.
-- [LEDGER SENTINEL] regclass:app_private.matters
-- [LEDGER SENTINEL] app_private.settings
-- [LEDGER SENTINEL] policy:app_private.settings.settings_tenant

-- ---------------------------------------------------------------------
-- matters
-- ---------------------------------------------------------------------

create table if not exists app_private.matters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  title text not null check (length(title) between 1 and 300),
  client text not null default '',
  opposing text not null default '',
  court text not null default '',
  docket_no text not null default '',
  kind text not null default 'dava'
    check (kind in ('dava', 'danismanlik', 'sozlesme', 'icra', 'diger')),
  status text not null default 'acik'
    check (status in ('acik', 'beklemede', 'kapali')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_private.matters is
  'Dava dosyası (matter): the workspace unit a solo lawyer files uploads, '
  'answers, drafts, notes, events and deadlines under. Tenant-scoped.';

create index if not exists matters_tenant_created_idx
  on app_private.matters (tenant_id, created_at desc);

create index if not exists matters_tenant_status_idx
  on app_private.matters (tenant_id, status);

-- ---------------------------------------------------------------------
-- matter_items
-- ---------------------------------------------------------------------

create table if not exists app_private.matter_items (
  item_id uuid primary key default gen_random_uuid(),
  matter_id uuid not null
    references app_private.matters(id) on delete cascade,
  tenant_id uuid not null,
  kind text not null
    check (kind in ('file', 'answer', 'draft', 'note', 'event', 'deadline')),
  -- Reference into another store: fileId / runId / draftId. Free text on
  -- purpose (fileIds are sha256 prefixes, draftIds carry a prefix).
  ref_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_private.matter_items is
  'Children of a matter. payload conventions (control-plane/src/matters/'
  'types.ts): file {fileName}; answer {question,status,mode}; draft '
  '{title,template,version}; note {text,source}; event {date,title,source,'
  'verified}; deadline {title,dueDate,ruleId?,startDate?,computed?,status,'
  'source}. ref_id: fileId / runId / draftId.';

create index if not exists matter_items_tenant_matter_created_idx
  on app_private.matter_items (tenant_id, matter_id, created_at desc);

create index if not exists matter_items_matter_kind_idx
  on app_private.matter_items (matter_id, kind);

-- "Bugün / bu hafta" panel: open deadlines by due date across all matters.
-- dueDate is the ISO 'YYYY-MM-DD' string of the payload, which orders
-- correctly as text.
create index if not exists matter_items_deadline_due_idx
  on app_private.matter_items (tenant_id, (payload ->> 'dueDate'))
  where kind = 'deadline';

-- ---------------------------------------------------------------------
-- answers
-- ---------------------------------------------------------------------

create table if not exists app_private.answers (
  run_id text primary key,
  tenant_id uuid not null,
  matter_id uuid
    references app_private.matters(id) on delete set null,
  question text not null default '',
  status text not null,
  mode text not null default 'local' check (mode in ('local', 'live')),
  finalizable boolean not null default false,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  as_of date,
  -- collex.answer.result/v1 as returned by POST /v1/answer.
  result jsonb not null,
  -- collex.answer.evidence-bundle/v1 WITH the canonical texts, so the Python
  -- exporter can still re-derive every quote from its offsets later.
  bundle jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_private.answers is
  'Durable answer runs (result + evidence bundle with texts). Written '
  'through by PgAnswerStore; matter_id is attached from the matter page.';

create index if not exists answers_tenant_created_idx
  on app_private.answers (tenant_id, created_at desc);

create index if not exists answers_matter_idx
  on app_private.answers (matter_id);

-- ---------------------------------------------------------------------
-- drafts (append-only versions)
-- ---------------------------------------------------------------------

create table if not exists app_private.drafts (
  draft_id text not null,
  version_no integer not null check (version_no >= 1),
  tenant_id uuid not null,
  matter_id uuid
    references app_private.matters(id) on delete set null,
  kind text not null,
  template text not null,
  title text not null default '',
  unsupported_count integer not null default 0
    check (unsupported_count >= 0),
  -- collex.draft/v1 body, whole.
  body jsonb not null,
  created_at timestamptz not null default now(),
  -- The primary key is scanned backward for "the latest version", so no
  -- separate (draft_id, version_no desc) index is needed.
  primary key (draft_id, version_no)
);

comment on table app_private.drafts is
  'Draft versions: every PUT /v1/drafts/{id} appends (draft_id, version_no). '
  'GET returns the highest version_no. Written through by PgDraftStore.';

create index if not exists drafts_tenant_created_idx
  on app_private.drafts (tenant_id, created_at desc);

create index if not exists drafts_matter_idx
  on app_private.drafts (matter_id);

-- ---------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------

create table if not exists app_private.settings (
  tenant_id uuid not null,
  key text not null check (length(key) between 1 and 100),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

comment on table app_private.settings is
  'Per-tenant settings documents: ''profile'' (lawyer identity for the '
  'vekil block) and ''preferences'' (defaults, theme, demo presets).';

-- ---------------------------------------------------------------------
-- Row Level Security (ADR-011)
-- ---------------------------------------------------------------------
--
-- Predicate shape follows 20260826060000: the tenant lookup is written as
-- the scalar subquery "(select app_private.current_tenant_id())" so it is
-- hoisted to a one-shot InitPlan. current_tenant_id() is NULL without a
-- tenant context, and "tenant_id = NULL" is NULL (not true), so a session
-- without context sees and writes nothing here.

alter table app_private.matters enable row level security;

drop policy if exists matters_tenant on app_private.matters;
create policy matters_tenant on app_private.matters
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

-- matter_items: through the OWNING MATTER (child of a tenant row), and the
-- denormalized tenant_id must agree with the caller on write so a row can
-- never be inserted under a matter of one tenant with the tenant_id of
-- another.
alter table app_private.matter_items enable row level security;

drop policy if exists matter_items_tenant on app_private.matter_items;
create policy matter_items_tenant on app_private.matter_items
  for all
  using (
    exists (
      select 1
      from app_private.matters m
      where m.id = matter_id
        and m.tenant_id = (select app_private.current_tenant_id())
    )
  )
  with check (
    tenant_id = (select app_private.current_tenant_id())
    and exists (
      select 1
      from app_private.matters m
      where m.id = matter_id
        and m.tenant_id = (select app_private.current_tenant_id())
    )
  );

alter table app_private.answers enable row level security;

drop policy if exists answers_tenant on app_private.answers;
create policy answers_tenant on app_private.answers
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.drafts enable row level security;

drop policy if exists drafts_tenant on app_private.drafts;
create policy drafts_tenant on app_private.drafts
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

alter table app_private.settings enable row level security;

drop policy if exists settings_tenant on app_private.settings;
create policy settings_tenant on app_private.settings
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

-- Supabase role grants (no-op on the local scratch Postgres, where the role
-- does not exist). RLS constrains every granted statement above.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema app_private to authenticated;
    grant select, insert, update, delete
      on app_private.matters,
         app_private.matter_items,
         app_private.answers,
         app_private.drafts,
         app_private.settings
      to authenticated;
  end if;
end
$$;
