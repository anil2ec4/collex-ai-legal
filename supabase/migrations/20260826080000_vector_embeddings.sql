-- 20260826080000_vector_embeddings.sql
-- [REQUIRES PGVECTOR] Vector embedding storage: public partitioned table
-- (one list partition + one HNSW graph per embedding profile) and the
-- tenant-private table with mandatory tenant/matter scoping + RLS.
-- Adapted from the master build brief section 7.3.
--
-- Local-testable: NO — the local scratch Postgres has no pgvector.
-- scripts/db_local_check.py validates this file's syntax offline with
-- pglast but does NOT execute it. On Supabase, enable the "vector"
-- extension first (Dashboard -> Database -> Extensions), then push.

create extension if not exists vector with schema extensions;

-- Public corpus embeddings, partitioned by profile so each production
-- profile owns a separate partition AND a separate HNSW ANN graph.
create table legal.public_chunk_embeddings_1024 (
  profile_key text not null
    references legal.embedding_profiles(profile_key) on delete restrict,
  chunk_id uuid not null references legal.chunks(id) on delete cascade,
  embedding extensions.vector(1024) not null,
  embedded_at timestamptz not null default now(),
  input_sha256 text not null check (length(input_sha256) = 64),
  primary key (profile_key, chunk_id)
) partition by list (profile_key);

-- Profile: voyage-4-1024-v1 (seeded in supabase/seed.sql).
create table legal.public_chunk_embeddings_voyage4_1024
  partition of legal.public_chunk_embeddings_1024
  for values in ('voyage-4-1024-v1');

create index public_embeddings_voyage4_hnsw
  on legal.public_chunk_embeddings_voyage4_1024
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Profile: bge-m3-1024-v1 (seeded in supabase/seed.sql).
create table legal.public_chunk_embeddings_bge_m3_1024
  partition of legal.public_chunk_embeddings_1024
  for values in ('bge-m3-1024-v1');

create index public_embeddings_bge_m3_hnsw
  on legal.public_chunk_embeddings_bge_m3_1024
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Tenant-private embeddings: NEVER share the public ANN graph. tenant_id
-- and matter_id are mandatory on every row; RLS enforces tenant isolation.
-- User-facing private queries must run with the user's JWT/RLS context or
-- via narrow SECURITY INVOKER functions that take the tenant from verified
-- auth context — never from model output. The service-role key must never
-- reach a client.
create table app_private.private_chunk_embeddings_1024 (
  profile_key text not null
    references legal.embedding_profiles(profile_key) on delete restrict,
  chunk_id uuid not null references legal.chunks(id) on delete cascade,
  tenant_id uuid not null,
  matter_id uuid not null,
  embedding extensions.vector(1024) not null,
  embedded_at timestamptz not null default now(),
  input_sha256 text not null check (length(input_sha256) = 64),
  primary key (profile_key, chunk_id)
);

create index private_embeddings_tenant_idx
  on app_private.private_chunk_embeddings_1024 (tenant_id, matter_id);

create index private_embeddings_hnsw
  on app_private.private_chunk_embeddings_1024
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table app_private.private_chunk_embeddings_1024
  enable row level security;

create policy private_embeddings_tenant
  on app_private.private_chunk_embeddings_1024
  for all
  using (tenant_id = app_private.current_tenant_id())
  with check (tenant_id = app_private.current_tenant_id());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on app_private.private_chunk_embeddings_1024 to authenticated;
  end if;
end
$$;
