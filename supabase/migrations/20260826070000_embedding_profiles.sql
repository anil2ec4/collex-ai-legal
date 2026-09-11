-- 20260826070000_embedding_profiles.sql
-- Embedding profile registry (model/dimension/normalization identity).
-- Adapted from the master build brief section 7.3 — table only; the vector
-- columns/partitions live in 20260826080000_vector_embeddings.sql so that
-- everything up to and including this migration runs on a Postgres
-- WITHOUT pgvector (local scratch verification).
--
-- Local-testable: yes (no pgvector).
--
-- Ledger bootstrap probe (W14 B-05): this file creates exactly ONE
-- object, so its first and last object are the same relation.
-- [LEDGER SENTINEL] regclass:legal.embedding_profiles

create table legal.embedding_profiles (
  profile_key text primary key,
  provider text not null,
  model text not null,
  dimensions integer not null,
  distance_metric text not null check (distance_metric = 'cosine'),
  normalization_version text not null,
  chunker_version text not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  -- 1024-dim lane only: model/dimension changes require a NEW profile
  -- (new partition + backfill + A/B eval + atomic switch), never silent
  -- mixing in an existing column.
  check (dimensions = 1024)
);
