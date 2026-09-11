-- 20260903100000_ai_audit_and_scale_indexes.sql
-- W14: cloud-AI audit ledger (B-23) + list-endpoint scale indexes (B-32).
--
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): the FIRST object this
-- file creates and the LAST. A single mid-file probe is exactly what made a
-- half-applied migration read as complete (ENGRISK E3), so this file names
-- both ends and the ledger records it only when both resolve.
-- [LEDGER SENTINEL] regclass:app_private.ai_calls
-- [LEDGER SENTINEL] regclass:app_private.answers_filescope_gin
-- [LEDGER SENTINEL] policy:app_private.ai_calls.ai_calls_tenant
--
-- Three probes, not two, and the middle one is the reason: this file creates
-- objects on TWO tables. `ai_calls` is its own, but `answers_filescope_gin`
-- lives on a table ANOTHER migration owns, so a database where
-- app_private.answers was dropped and rebuilt keeps the ai_calls half and
-- loses the index — "applied" by the first and last probe, with the 119x
-- index silently gone. Naming the index too makes that state re-appliable.
--
-- Local-testable: yes (no pgvector).
--
-- ---------------------------------------------------------------------
-- 1. app_private.ai_calls — what left this machine, and when (B-23)
-- ---------------------------------------------------------------------
--
-- The Ankara Barosu HUBİTEM guide requires client data to be anonymised
-- before it reaches an AI tool, and TBB's 28.08.2026 guidance keeps final
-- responsibility with the lawyer. Under KVKK m.9 (as amended by law 7499)
-- the LAWYER is the data controller for a transfer abroad. All three need
-- the same thing from us: a record the lawyer can read.
--
-- WHAT IS NOT HERE: the text. No prompt, no document body, no model output.
-- A ledger holding the prompt would be a second, forgotten copy of the
-- client's file — more dangerous than the thing it audits. Only the shape of
-- the call is stored: how many characters, roughly how many tokens, which
-- route, which file, which model, and whether masking was applied.

create table if not exists app_private.ai_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  called_at timestamptz not null default now(),
  -- 'analyze-document' | 'ocr' | 'draft-paragraph'
  route text not null check (length(route) between 1 and 64),
  model text not null check (length(model) between 1 and 200),
  -- Size only. Never the content.
  chars integer not null check (chars >= 0),
  input_tokens integer not null check (input_tokens >= 0),
  file_id text,
  matter_id uuid,
  draft_id text,
  section_id text,
  -- True when intake/ai masking replaced identifiers before sending.
  masked boolean not null default false
);

comment on table app_private.ai_calls is
  'Cloud-AI audit ledger (W14 B-23). Shape of each call only: never the '
  'prompt, the document text or the model output. A ledger that stored the '
  'text would be a second copy of the client file.';

-- The two questions asked of this table: "what did I send lately?" (the
-- Settings page, newest first) and "am I over the ceiling?" (a rolling hour
-- / the current day). One index answers both.
create index if not exists ai_calls_tenant_time_idx
  on app_private.ai_calls (tenant_id, called_at desc);

-- ---------------------------------------------------------------------
-- 2. answers_filescope_gin — GET /v1/answers?fileId= (B-32)
-- ---------------------------------------------------------------------
--
-- ENGRISK measured this one on a 2 000-answer probe database: the fileId
-- filter ran a Seq Scan over the jsonb result column at 15.5 ms, and the
-- console issues it on EVERY document page open. With this GIN index the
-- same query is 0.087 ms — 119x — and the index is about 128 kB.
--
-- The predicate in `answerStore.list` must be written as
--   result -> 'fileScope' @> '{"fileIds":["<id>"]}'::jsonb
-- to match this expression EXACTLY; a differently-shaped but logically
-- equivalent predicate will not use the index. That is why the expression is
-- spelled out here rather than indexing the whole `result` column: a
-- whole-column jsonb_path_ops index would be far larger and would still not
-- help a containment test on a nested key.
--
-- CORRECTED 2026-09-02 (W14 F-PERF, V-2) — comment only, no SQL change.
-- The two sentences above and the `comment on index` below both prescribed a
-- BARE ARRAY on the right-hand side (WRONG, do not copy this one):
--   [WRONG]  result -> 'fileScope' @> '["<id>"]'::jsonb
-- which DOES use this index and matches NOTHING: `result -> 'fileScope'` is
-- an OBJECT (`{"fileIds":[...],"includeCorpus":false}`), so a bare JSON ARRAY
-- is never contained in it. Measured on a 2 000-answer probe database
-- (`collex_perf_test`, 02.09.2026): the array form plans a Bitmap Index Scan
-- in 0.029 ms and returns 0 rows; the object form plans the same Bitmap Index
-- Scan and returns the correct 6 rows. Meanwhile the product was sending a
-- THIRD shape — `result @> '{"fileScope":{"fileIds":["<id>"]}}'` — which is
-- correct but cannot use this index and ran `Seq Scan on answers`
-- (1.683 ms, Rows Removed by Filter: 2024, `idx_scan = 0`). So the index was
-- right, the query was wrong, and this comment sent the next reader at the
-- one shape that is wrong in the other direction. `answerStore.list` now
-- issues the object form and `control-plane/tests/store/persistence.test.ts`
-- asserts the Bitmap Index Scan AND the row count together, because either
-- assertion alone would have passed on the array form.
create index if not exists answers_filescope_gin
  on app_private.answers using gin ((result -> 'fileScope') jsonb_path_ops);

comment on index app_private.answers_filescope_gin is
  'GET /v1/answers?fileId= (W14 B-32). Requires the predicate to be written '
  'as result -> ''fileScope'' @> ''{"fileIds":["<id>"]}''::jsonb — an '
  'equivalent but differently shaped expression will not use this index, and '
  'a bare ["<id>"] array uses it but matches nothing (fileScope is an '
  'object). Corrected W14 F-PERF, V-2.';

-- ---------------------------------------------------------------------
-- 3. Row-level security (ADR-011: tenancy on every table that holds
--    client data, no exceptions — this table names files and matters)
-- ---------------------------------------------------------------------

alter table app_private.ai_calls enable row level security;

-- Idempotent: a re-application (see the third ledger probe above) must not
-- fail on an already-existing policy. `create policy` has no
-- `if not exists` form.
drop policy if exists ai_calls_tenant on app_private.ai_calls;

create policy ai_calls_tenant on app_private.ai_calls
  for all
  using (tenant_id = app_private.current_tenant_id())
  with check (tenant_id = app_private.current_tenant_id());

-- Supabase role grants (no-op on the local scratch cluster, where these
-- roles do not exist). RLS still constrains every granted statement.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert on app_private.ai_calls to authenticated;
  end if;
end
$$;
