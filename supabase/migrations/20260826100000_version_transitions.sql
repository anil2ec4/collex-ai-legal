-- 20260826100000_version_transitions.sql
-- Append-time closing of the previous "current" document version.
--
-- Ledger bootstrap probe (ingestion/migrations.py, W12-FIX2): the trigger
-- IS this migration — the reviewer's example of a file a timestamp rule
-- would have recorded as applied on a database that never ran it.
-- Multi-sentinel (W14 B-05): function (first), trigger, unique index (last).
-- [LEDGER SENTINEL] regprocedure:legal.close_previous_current_version()
-- [LEDGER SENTINEL] trigger:legal.document_versions.document_versions_close_previous
-- [LEDGER SENTINEL] regclass:legal.document_versions_one_current_uq
--
-- corrected 2026-08-27:
--   1. Until the same-day correction of 20260826020000, system_period
--      defaulted to tstzrange(now(), 'infinity', '[)'). 'infinity' is a
--      FINITE timestamptz value, so upper_inf() was always false and this
--      whole file was dead code: the trigger's guard never fired and the
--      unique partial index below covered zero rows. With the default now
--      tstzrange(now(), null, '[)') both are live. This file is unchanged
--      in that respect — it was always the intended mechanism — but its
--      regression test (tests/ingestion/test_versioning.py, and c10 in
--      scripts/db_local_check.py) is new.
--   2. The trigger now ALSO closes the previous version's open
--      effective_period, because 20260826020000 gained an EXCLUDE
--      constraint forbidding two published versions of one document from
--      covering the same calendar day. Doing it here keeps ONE
--      authoritative mechanism in the database for every writer instead of
--      requiring each caller to remember the close.
--
-- Local-testable: yes (NO pgvector required). This file is applied and
-- exercised for real by scripts/db_local_check.py, which classifies
-- migrations by the pgvector marker each dependent file opens its header
-- with rather than by filename ordering, by tests/ingestion against
-- collex_ingest_test, and by `python -m ingestion.cli --apply-migrations`.
--
-- Design decision (see also ingestion/versioning.py module docstring):
-- closing the previous current version happens in the DATABASE via a
-- BEFORE INSERT trigger rather than in application code. Rationale:
--   * the invariant "at most one open system_period per document" must hold
--     no matter which code path appends a version (pipeline, backfill,
--     manual SQL), so it belongs to the schema;
--   * the trigger runs inside the same transaction as the insert, so the
--     close + append are atomic by construction;
--   * a unique partial index backs the invariant declaratively as well.
--
-- Semantics, system time: when a new version row is inserted with an
-- open-ended system_period [t_new, ), every other open version of the same
-- document is closed to [t_old, t_new). If t_old == t_new (two appends in
-- the same statement timestamp) the closed range is empty, which is valid
-- and still "not current". If t_new < t_old the tstzrange constructor
-- raises, which is the correct loud failure for clock-skewed appends.
--
-- Semantics, valid (effective) time: when the new row carries an
-- open-ended effective_period [d_new, ), every other version of the same
-- document whose effective_period is also open-ended and STARTS EARLIER is
-- closed to [d_old, d_new) — "the previous consolidated text was in force
-- until the amendment took effect". Rows are left alone when:
--   * the new row has no effective_period or a bounded one (nothing to
--     supersede: the caller stated the exact validity window itself);
--   * the older row has no effective_period (validity unknown — guessing
--     would fabricate legal metadata);
--   * d_old >= d_new (a backdated or same-day append). That case is NOT
--     silently patched up: it falls through to the
--     document_versions_effective_no_overlap EXCLUDE constraint in
--     20260826020000 and fails loudly, because deciding which of two texts
--     in force on the same day wins is an editorial call, not a trigger's.

create or replace function legal.close_previous_current_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if upper_inf(new.system_period) then
    update legal.document_versions v
       set system_period = tstzrange(lower(v.system_period),
                                     lower(new.system_period), '[)')
     where v.document_id = new.document_id
       and v.id <> new.id
       and upper_inf(v.system_period);
  end if;

  if new.effective_period is not null
     and not isempty(new.effective_period)
     and upper_inf(new.effective_period)
     and lower(new.effective_period) is not null then
    update legal.document_versions v
       set effective_period = daterange(lower(v.effective_period),
                                        lower(new.effective_period), '[)')
     where v.document_id = new.document_id
       and v.id <> new.id
       and v.effective_period is not null
       and upper_inf(v.effective_period)
       and lower(v.effective_period) is not null
       and lower(v.effective_period) < lower(new.effective_period);
  end if;

  return new;
end;
$$;

comment on function legal.close_previous_current_version() is
  'BEFORE INSERT trigger on legal.document_versions. (1) Closes every other '
  'open (upper_inf) system_period row of the same document at the new '
  'row''s lower(system_period), keeping "one current version per document" '
  'true inside the appending transaction. (2) Closes every earlier-starting '
  'open effective_period of the same document at the new row''s effective '
  'start, so two published versions never cover the same calendar day '
  '(EXCLUDE document_versions_effective_no_overlap).';

create trigger document_versions_close_previous
  before insert on legal.document_versions
  for each row
  execute function legal.close_previous_current_version();

-- Declarative backstop for the same invariant: at most ONE open (current)
-- version per logical document.
create unique index document_versions_one_current_uq
  on legal.document_versions (document_id)
  where upper_inf(system_period);
