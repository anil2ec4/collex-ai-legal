-- 20260904090000_hearing_kind_and_search_indexes.sql
-- W14 L-FIX: the DDL the parallel build lanes asked for and none of them owned.
--
-- Ledger bootstrap probes (multi-sentinel, W14 B-05): the FIRST object this
-- file creates and the LAST, plus the middle object that lives on a table
-- another migration owns.
-- [LEDGER SENTINEL] constraint:app_private.matter_items.matter_items_kind_check
-- [LEDGER SENTINEL] regclass:app_private.answers_question_trgm
-- [LEDGER SENTINEL] regclass:app_private.matter_items_hearing_date_idx
--
-- WHY A `constraint:` PROBE, AND WHY IT IS FIRST.
-- This file's primary effect is an ALTER, not a CREATE: it widens the
-- `matter_items.kind` CHECK so a hearing can be stored at all. An ALTER
-- creates no relation, so under the pre-L-FIX grammar the only probeable
-- objects here were the three indexes at the bottom — and a database that had
-- the indexes but still carried the OLD five-value CHECK would have read as
-- "applied" while every hearing insert kept failing with SQLSTATE 23514.
-- That is exactly the half-applied blindness B-05 closed for the matters
-- migration, so `ingestion/migrations.py` and `control-plane/src/store/
-- health.ts` gained a `constraint` kind (pg_constraint, same three-part shape
-- as `policy`) and this file declares it as its FIRST probe.
--
-- Local-testable: yes (no pgvector).
--
-- ---------------------------------------------------------------------
-- 1. matter_items.kind gains 'hearing'  (W14 B-17, L-MATTER request 1)
-- ---------------------------------------------------------------------
--
-- DIAGNOSIS (L-MATTER, W14-L-MATTER.md §1 and open item 1). B-17 shipped the
-- calendar, the hearing item type, the .ics feed and `MATTER_ITEM_KINDS`
-- carrying 'hearing' in control-plane/src/matters/types.ts. The database did
-- not: `app_private.matter_items.kind` was pinned to the six W12 kinds by an
-- inline CHECK, so `PgMatterStore.addItems` caught SQLSTATE 23514 and turned
-- it into a typed 503 with a Turkish sentence ("Duruşma kaydı için yerel
-- veritabanı güncellenmeli"). Correct behaviour for a schema that was behind,
-- and a feature that could not be used: in Pg mode — which is every real
-- install — no hearing could be recorded. In-memory mode worked, which is why
-- the whole test suite was green over a product that could not save a hearing.
--
-- The CHECK created inline by 20260902120000 is auto-named
-- `matter_items_kind_check` by PostgreSQL; the drop/add pair below is
-- idempotent and re-appliable, and the constraint keeps that exact name so
-- the sentinel above resolves.
--
-- SCOPE. Only 'hearing' is added, and deliberately. L-LEGAL §5.5 PROPOSED an
-- 'expense' kind for storing a harç computation on a matter, but no lane
-- implemented it: `MATTER_ITEM_KINDS` does not carry it, so the router's zod
-- enum rejects 'expense' with a 400 long before any INSERT. Widening the
-- database for a value the API cannot send would be schema vaporware. The
-- same holds for 'task' / 'contact' / 'correspondence' — 'contact' in
-- particular is NOT a matter item at all: B-42 gave contacts their own table
-- (app_private.contacts, via PgContactStore). When a lane implements one of
-- these, it comes with its own migration and its own constraint probe.

alter table app_private.matter_items
  drop constraint if exists matter_items_kind_check;

alter table app_private.matter_items
  add constraint matter_items_kind_check
  check (kind in ('file', 'answer', 'draft', 'note', 'event', 'deadline', 'hearing'));

comment on constraint matter_items_kind_check on app_private.matter_items is
  'Mirror of MATTER_ITEM_KINDS in control-plane/src/matters/types.ts. '
  'Add a value here ONLY together with the TypeScript enum: the router '
  'validates against that enum first, so a database-only value is '
  'unreachable and a TypeScript-only value is a 503 at insert time.';

-- ---------------------------------------------------------------------
-- 2. Search / list indexes  (W14 B-29 + B-32, L-MATTER request 2)
-- ---------------------------------------------------------------------
--
-- `answers_filescope_gin` and `ai_calls_tenant_time_idx` landed with the AI
-- audit migration (20260903100000); the three below did not, because they
-- serve queries L-MATTER wrote in the same wave.
--
-- gin_trgm_ops needs pg_trgm, which 20260826010000 installs into the
-- `extensions` schema; the operator classes are therefore schema-qualified.

-- B-29 general search: `where question ilike '%q%'` over app_private.answers.
create index if not exists answers_question_trgm
  on app_private.answers using gin (question extensions.gin_trgm_ops);

-- B-29 general search: the same shape over draft titles, which is also what
-- GET /v1/drafts?q= runs (PgDraftStore.list).
create index if not exists drafts_title_trgm
  on app_private.drafts using gin (title extensions.gin_trgm_ops);

-- B-17 calendar: "the next hearings, date ascending" reads one jsonb key of
-- one kind. A partial index on the extracted text date is both small and
-- exactly the query's shape (PgMatterStore.upcomingHearings orders on
-- `payload ->> 'date'` with `kind = 'hearing'`).
create index if not exists matter_items_hearing_date_idx
  on app_private.matter_items ((payload ->> 'date'))
  where kind = 'hearing';

comment on index app_private.matter_items_hearing_date_idx is
  'Upcoming hearings (W14 B-17). Partial on kind = ''hearing'' and keyed on '
  'the extracted payload date, matching PgMatterStore.upcomingHearings.';

-- ---------------------------------------------------------------------
-- 3. No RLS change
-- ---------------------------------------------------------------------
--
-- Every table touched here already has row security and a policy from
-- 20260902120000 (matter_items resolves tenancy through its owning matter,
-- ADR-011). Widening a CHECK and adding indexes changes neither, so the
-- /v1/health `rls` count stays 18 and this file adds no policy.
