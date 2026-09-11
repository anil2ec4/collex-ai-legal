-- 20260912100000_private_dense_vectors.sql
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): the FIRST object this
-- file creates (the widened dimension CHECK on an older table) and the LAST
-- (a policy), plus the vector table itself.
-- [LEDGER SENTINEL] constraint:legal.embedding_profiles.embedding_profiles_dimensions_range
-- [LEDGER SENTINEL] regclass:app_private.chunk_vectors
-- [LEDGER SENTINEL] policy:app_private.chunk_vectors.chunk_vectors_tenant
--
-- W20 phase E — a real, local, pgvector-FREE dense lane for private uploads.
--
-- The profile registry could not describe the model this machine has
-- -----------------------------------------------------------------
-- legal.embedding_profiles (20260826070000) carries `check (dimensions =
-- 1024)`, written when every planned profile was a 1024-wide cloud model.
-- The local model that actually runs here (multilingual-e5-small, ONNX,
-- int8) produces 384-dimensional vectors, so the registry literally could
-- not hold a row for it. Old migrations are never edited; this file replaces
-- the equality with a range and records the local profile.
--
-- Where vectors live, and what they belong to
-- -------------------------------------------
-- tenant -> document version -> chunk -> embedding profile. NOT a matter:
-- matter membership is a RETRIEVAL FILTER applied at search time (the same
-- one lexical search uses), so one uploaded file linked to two matters has
-- one set of vectors, and unlinking it from a matter needs no re-embedding.
--
-- Why bytea and exact cosine
-- --------------------------
-- There is no pgvector on this machine and it must not become a
-- prerequisite. A private Matter holds hundreds to low thousands of chunks;
-- exact cosine over that many 384-float vectors is milliseconds in process,
-- so an ANN index would add an extension dependency for no measurable gain
-- at this scale. Vectors are stored as little-endian float32 (4 bytes per
-- dimension, enforced by a CHECK) and L2-normalized at write time, so
-- cosine similarity is a dot product. This is NOT a public-corpus ANN index
-- and nothing in the product claims one.
--
-- Staleness is detectable, not assumed away
-- -----------------------------------------
-- Each row stores the sha256 of the exact text that was embedded
-- (`input_sha256`, prompt prefix included) and the chunk's own content hash
-- at embed time (`chunk_sha256`). A worker compares them with the chunk as
-- it is now; a mismatch is a stale vector and is re-embedded, never used.
--
-- Local-testable: yes (no pgvector).

alter table legal.embedding_profiles
  drop constraint if exists embedding_profiles_dimensions_check;
alter table legal.embedding_profiles
  drop constraint if exists embedding_profiles_dimensions_range;
alter table legal.embedding_profiles
  add constraint embedding_profiles_dimensions_range
  check (dimensions between 1 and 8192);

alter table legal.embedding_profiles
  add column if not exists prompt_style text,
  add column if not exists pooling text;

-- The profile the local lane serves. Its identity is the whole row: a
-- change of model, dimension, pooling, prompt style, normalization or
-- chunker is a NEW profile key, never an edit of this one.
insert into legal.embedding_profiles
  (profile_key, provider, model, dimensions, distance_metric,
   normalization_version, chunker_version, activated_at, prompt_style,
   pooling, config)
values
  ('e5-small-384-v1', 'local-onnx',
   'intfloat/multilingual-e5-small:onnx-qint8', 384, 'cosine',
   'e5-mean-l2-v1', 'chunker-v1', now(), 'e5', 'mean',
   jsonb_build_object(
     'runtime', 'onnxruntime-cpu',
     'assetsRevision', '614241f622f53c4eeff9890bdc4f31cfecc418b3',
     'passagePrefix', 'passage: ',
     'queryPrefix', 'query: ',
     'textNormalizer', 'trnorm-v1'))
on conflict (profile_key) do nothing;

create table if not exists app_private.chunk_vectors (
  profile_key text not null
    references legal.embedding_profiles(profile_key) on delete restrict,
  chunk_id uuid not null references legal.chunks(id) on delete cascade,
  tenant_id uuid not null,
  document_version_id uuid not null
    references legal.document_versions(id) on delete cascade,
  dimensions integer not null check (dimensions between 1 and 8192),
  -- float32 little-endian, L2-normalized.
  embedding bytea not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  chunk_sha256 text not null check (length(chunk_sha256) = 64),
  embedded_at timestamptz not null default now(),
  primary key (profile_key, chunk_id),
  constraint chunk_vectors_width check (octet_length(embedding) = dimensions * 4)
);

comment on table app_private.chunk_vectors is
  'Private (tenant-upload) chunk embeddings without pgvector. Searched by '
  'exact cosine in the control plane, pre-filtered by the caller''s file '
  'scope and re-checked against the store''s visibility filter.';

create index if not exists chunk_vectors_scope_idx
  on app_private.chunk_vectors (tenant_id, profile_key, document_version_id);

alter table app_private.chunk_vectors enable row level security;
create policy chunk_vectors_tenant on app_private.chunk_vectors
  for all
  using (tenant_id = (select app_private.current_tenant_id()))
  with check (tenant_id = (select app_private.current_tenant_id()));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on app_private.chunk_vectors
      to authenticated;
  end if;
end
$$;
