-- 20260826060000_rls.sql
-- Row Level Security for tenant isolation.
--
-- Ledger bootstrap probe (ingestion/migrations.py, W12-FIX2): every policy
-- below resolves tenancy through this function; it exists iff this file ran.
-- Multi-sentinel (W14 B-05): the function is the FIRST object; the LAST
-- object is the final policy. Policies 73-281 used to sit AFTER the only
-- probe, so a run that stopped in the middle left tables without row
-- security and the ledger said "applied" (ENGRISK E3).
-- [LEDGER SENTINEL] regprocedure:app_private.current_tenant_id()
-- [LEDGER SENTINEL] policy:app_private.claim_evidence.claim_evidence_tenant
--
-- corrected 2026-08-27 (P0 CROSS-TENANT CONTENT LEAK; fixed in place
-- because nothing has ever been applied to a real database — see
-- docs/implementation/SUPABASE-SETUP.md):
--
--   RLS was enabled on legal.documents ONLY, while the grants block at the
--   bottom of this file handed "authenticated" a plain SELECT on
--   legal.document_versions, legal.chunks and legal.document_relations.
--   Those three tables had NO row security at all, so the documents policy
--   protected nothing but the metadata row: any authenticated session, of
--   any tenant, could read another tenant's document_versions.canonical_text
--   and chunks.original_text — i.e. the full text of the other tenant's
--   documents — simply by selecting from the child table directly and never
--   mentioning legal.documents. legal.document_relations leaked the tenant's
--   citation graph the same way. This was reproduced on the local scratch
--   database with a non-superuser probe role holding exactly the grants
--   below; the regression test now lives in
--   scripts/db_local_check.py (c9) and tests/ingestion/test_rls_leak.py.
--
--   Fix: RLS is enabled on all three child tables with SELECT policies that
--   resolve tenancy through the OWNING DOCUMENT — versions join to
--   legal.documents, chunks join through legal.document_versions to
--   legal.documents, and relations require BOTH endpoints to be visible.
--   Public rows stay readable by everyone. service_role / table owner /
--   the ingestion role continue to bypass RLS, so the pipeline is
--   unaffected.
--
-- Local-testable: yes (no pgvector).
--
-- Tenant contract
-- ---------------
-- app_private.current_tenant_id() resolves the caller's tenant uuid from,
-- in order:
--   1. current_setting('request.jwt.claim.tenant_id')  -- Supabase legacy
--      per-claim GUC form,
--   2. current_setting('request.jwt.claims')::jsonb ->> 'tenant_id'
--      -- Supabase current form (whole JWT claims object as JSON),
--   3. current_setting('app.tenant_id')                -- local testing:
--      SET app.tenant_id = '<uuid>';
-- All reads use missing_ok = true, so an unset GUC yields NULL (no tenant
-- context => tenant-scoped rows are invisible / unwritable).
-- On Supabase the JWT must therefore carry a "tenant_id" claim (custom
-- access token hook or app_metadata mapping). service_role bypasses RLS.

create or replace function app_private.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.tenant_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id',
    nullif(current_setting('app.tenant_id', true), '')
  )::uuid
$$;

comment on function app_private.current_tenant_id() is
  'Tenant uuid from JWT claim tenant_id (request.jwt.claim.tenant_id or '
  'request.jwt.claims->>tenant_id) with local-test fallback app.tenant_id. '
  'NULL when no tenant context is set.';

-- legal.documents: public corpus readable by everyone; tenant rows only
-- visible/writable within their own tenant. Public-scope writes are the
-- ingestion pipeline's job and run as service_role/owner (RLS bypass), so
-- no public-write policy is defined here.
alter table legal.documents enable row level security;

create policy documents_select on legal.documents
  for select
  using (
    scope = 'public'
    or (scope = 'tenant' and tenant_id = app_private.current_tenant_id())
  );

create policy documents_insert on legal.documents
  for insert
  with check (
    scope = 'tenant' and tenant_id = app_private.current_tenant_id()
  );

create policy documents_update on legal.documents
  for update
  using (scope = 'tenant' and tenant_id = app_private.current_tenant_id())
  with check (scope = 'tenant' and tenant_id = app_private.current_tenant_id());

create policy documents_delete on legal.documents
  for delete
  using (scope = 'tenant' and tenant_id = app_private.current_tenant_id());

-- ---------------------------------------------------------------------
-- P0 fix: the content-bearing child tables.
--
-- Predicate shape. Each policy is a single EXISTS over the owning
-- document, with the tenant lookup written as the scalar subquery
-- "(select app_private.current_tenant_id())". That form is hoisted to a
-- one-shot InitPlan instead of being re-evaluated per candidate row, which
-- matters because these policies run on the widest tables in the schema.
-- app_private.current_tenant_id() is a STABLE SQL function and therefore
-- inlinable; it returns NULL with no tenant context, and "tenant_id = NULL"
-- is NULL (not true), so a session without context sees public rows only.
--
-- Index support for the predicates (all pre-existing, no new indexes
-- needed): legal.documents(id) PK and the partial tenant identity indexes;
-- legal.document_versions(id) PK plus the unique (document_id,
-- content_sha256) whose leading column serves document_id lookups;
-- legal.chunks.document_version_id via chunks_version_idx;
-- legal.document_relations via document_relations_from_idx and
-- document_relations_target_idx.
--
-- Writes: no INSERT/UPDATE/DELETE policy is defined on these three tables,
-- so every end-user write is denied by default (RLS is deny-by-default for
-- any command without a matching policy) — and the grants block below
-- hands out SELECT only. Ingestion writes run as owner/service_role and
-- bypass RLS entirely. If a tenant-write lane is ever added here it MUST
-- carry a WITH CHECK clause identical to its USING clause, exactly like
-- the documents_insert / documents_update policies above, otherwise a
-- tenant could write rows it cannot read.
-- ---------------------------------------------------------------------

alter table legal.document_versions enable row level security;

create policy document_versions_select on legal.document_versions
  for select
  using (
    exists (
      select 1
      from legal.documents d
      where d.id = document_id
        and (
          d.scope = 'public'
          or d.tenant_id = (select app_private.current_tenant_id())
        )
    )
  );

alter table legal.chunks enable row level security;

create policy chunks_select on legal.chunks
  for select
  using (
    exists (
      select 1
      from legal.document_versions v
      join legal.documents d on d.id = v.document_id
      where v.id = document_version_id
        and (
          d.scope = 'public'
          or d.tenant_id = (select app_private.current_tenant_id())
        )
    )
  );

alter table legal.document_relations enable row level security;

-- BOTH endpoints must be visible: a relation whose source version belongs
-- to tenant A and whose target document belongs to tenant B would
-- otherwise disclose the existence (and the target_locator/evidence) of the
-- other tenant's document to whichever side could see its own end.
create policy document_relations_select on legal.document_relations
  for select
  using (
    exists (
      select 1
      from legal.document_versions v
      join legal.documents d on d.id = v.document_id
      where v.id = from_document_version_id
        and (
          d.scope = 'public'
          or d.tenant_id = (select app_private.current_tenant_id())
        )
    )
    and exists (
      select 1
      from legal.documents d2
      where d2.id = to_document_id
        and (
          d2.scope = 'public'
          or d2.tenant_id = (select app_private.current_tenant_id())
        )
    )
  );

-- app_private.research_runs: direct tenant_id scope.
alter table app_private.research_runs enable row level security;

create policy research_runs_tenant on app_private.research_runs
  for all
  using (tenant_id = app_private.current_tenant_id())
  with check (tenant_id = app_private.current_tenant_id());

-- Child tables scope through their run's tenant.
alter table app_private.research_steps enable row level security;

create policy research_steps_tenant on app_private.research_steps
  for all
  using (
    exists (
      select 1 from app_private.research_runs r
      where r.id = run_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from app_private.research_runs r
      where r.id = run_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  );

alter table app_private.evidence_items enable row level security;

create policy evidence_items_tenant on app_private.evidence_items
  for all
  using (
    exists (
      select 1 from app_private.research_runs r
      where r.id = run_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from app_private.research_runs r
      where r.id = run_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  );

alter table app_private.claims enable row level security;

create policy claims_tenant on app_private.claims
  for all
  using (
    exists (
      select 1 from app_private.research_runs r
      where r.id = run_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from app_private.research_runs r
      where r.id = run_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  );

alter table app_private.claim_evidence enable row level security;

create policy claim_evidence_tenant on app_private.claim_evidence
  for all
  using (
    exists (
      select 1
      from app_private.claims c
      join app_private.research_runs r on r.id = c.run_id
      where c.id = claim_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  )
  with check (
    exists (
      select 1
      from app_private.claims c
      join app_private.research_runs r on r.id = c.run_id
      where c.id = claim_id
        and r.tenant_id = app_private.current_tenant_id()
    )
  );

-- app_private.jobs is worker-plane only (service_role / owner). RLS is
-- enabled with NO policies: deny-by-default for any end-user role.
alter table app_private.jobs enable row level security;

-- Supabase role grants (no-op on the local scratch Postgres, where these
-- roles do not exist). RLS still constrains every granted statement — and
-- as of the 2026-08-27 correction that is actually true for
-- document_versions / chunks / document_relations as well, which is what
-- makes the SELECT grants below safe to hand to "authenticated".
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema legal to authenticated;
    grant usage on schema app_private to authenticated;
    grant select on legal.documents to authenticated;
    grant select on legal.document_versions to authenticated;
    grant select on legal.chunks to authenticated;
    grant select on legal.document_relations to authenticated;
    grant select, insert, update, delete
      on app_private.research_runs,
         app_private.research_steps,
         app_private.evidence_items,
         app_private.claims,
         app_private.claim_evidence
      to authenticated;
    grant execute on function app_private.current_tenant_id() to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema legal to anon;
    grant select on legal.documents to anon;
    grant execute on function app_private.current_tenant_id() to anon;
  end if;
end
$$;
