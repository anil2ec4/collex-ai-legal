-- 20260826010000_extensions_and_schemas.sql
-- Extensions, schemas and shared enums for the ColleX legal data plane.
--
-- Ledger bootstrap probes (ingestion/migrations.py; multi-sentinel W14 B-05).
-- FIRST object created by this file, and LAST: bootstrap records the file
-- only when BOTH resolve, so a half-applied file can never read as complete.
-- btree_gist alone was never enough — an extension is shared, another tool
-- may have installed it (ENGRISK §4.2).
-- [LEDGER SENTINEL] extension:btree_gist
-- [LEDGER SENTINEL] type:legal.relation_kind
--
-- corrected 2026-08-27: added btree_gist. The GiST exclusion constraints
-- introduced by the same-day corrections to 20260826020000 (one published
-- effective_period per document) and 20260826030000 (non-overlapping chunk
-- spans per version) both need a GiST equality operator class for uuid,
-- which only btree_gist provides. Nothing has ever been applied to a real
-- database (docs/implementation/SUPABASE-SETUP.md), so the extension is
-- added here at the head of the chain rather than in a patch migration.
--
-- Local-testable: yes (needs pg_trgm + pgcrypto + btree_gist only; pgvector
-- is NOT required by this migration — the vector lane lives in
-- 20260826080000+).
--
-- On Supabase the "extensions" schema already exists and pg_trgm/pgcrypto/
-- btree_gist are all available; every statement here is idempotent-safe for
-- that case ("if not exists").

create schema if not exists extensions;

-- pg_trgm: trigram similarity / gin_trgm_ops for fuzzy lexical search.
create extension if not exists pg_trgm with schema extensions;

-- pgcrypto: digest() etc. Note gen_random_uuid() itself is built into
-- PostgreSQL 13+ (pg_catalog), so primary key defaults work even without
-- pgcrypto; we still install it for digest()/hmac() usage.
create extension if not exists pgcrypto with schema extensions;

-- btree_gist: btree-style operator classes (uuid =, int4 =, ...) usable in
-- a GiST index, which is what lets an EXCLUDE constraint combine a scalar
-- equality key with a range overlap key. Note the opclass lookup for an
-- EXCLUDE/index element is a catalog-wide default-opclass lookup, NOT a
-- search_path lookup, so installing btree_gist into "extensions" is enough
-- and the constraints do not need to schema-qualify the operator class
-- (verified on local scratch PostgreSQL 18.1).
create extension if not exists btree_gist with schema extensions;

-- Canonical legal corpus (public + tenant documents).
create schema if not exists legal;

-- Tenant-private research state, jobs, private embeddings. Never exposed
-- through PostgREST's public schema list.
create schema if not exists app_private;

-- Enums -----------------------------------------------------------------

create type legal.document_scope as enum ('public', 'tenant');

create type legal.document_status as enum
  ('discovered', 'parsed', 'indexed', 'published', 'failed', 'withdrawn');

create type legal.relation_kind as enum
  ('AMENDS', 'REPEALS', 'CITES', 'INTERPRETS', 'OVERRULES', 'RELATED');
