-- 20260826050000_jobs.sql
-- Idempotent Postgres job queue + FOR UPDATE SKIP LOCKED claim function.
-- Adapted from the master build brief section 7.5.
--
-- Ledger bootstrap probe (ingestion/migrations.py, W12-FIX2): the reaper is
-- the P2c correction below — a database with the jobs table but without
-- the reaper does NOT have this file.
-- Multi-sentinel (W14 B-05): FIRST object + LAST object.
-- [LEDGER SENTINEL] regclass:app_private.jobs
-- [LEDGER SENTINEL] regprocedure:app_private.reap_stuck_jobs(interval)
--
-- corrected 2026-08-27 (P2 + P3; fixed in place because nothing has ever
-- been applied to a real database):
--
--   P2a claim_jobs ignored max_attempts. A permanently failing job was
--   re-claimed forever (measured: attempts climbed to 6 with max_attempts
--   = 5) and there was no state in which the queue ever gave up. The claim
--   predicate now carries "attempts < max_attempts", and jobs_claim_idx
--   INCLUDEs both columns so the cap is checked from the index.
--
--   P2b there was no failure path at all: a worker that caught an error had
--   nothing to call, so a failed job either stayed 'running' forever or was
--   hand-rolled differently by every caller, with no backoff.
--   app_private.fail_job(job_id, error, backoff) is now the single failure
--   path — it records last_error, releases the lease, schedules the retry
--   at now() + backoff, and flips the row to 'dead' once attempts have
--   reached max_attempts.
--
--   P2c a worker that crashed mid-job left its row in 'running' with a
--   stale lease and nothing ever reclaimed it. app_private.reap_stuck_jobs
--   (lease) requeues (or kills, when the cap is reached) every 'running'
--   row whose locked_at is older than the lease.
--
--   P3 unique (queue, idempotency_key) was total. DECISION: it is now
--   PARTIAL over the in-flight states ('queued', 'running'). Rationale:
--   uniqueness exists to stop the same unit of work being IN FLIGHT twice,
--   and that is exactly what the partial index guarantees. A total index
--   additionally froze the key forever, which means a 'dead' job could only
--   be replayed after a fix by DELETING the row — destroying the very
--   last_error audit trail that made the dead-letter row worth keeping —
--   and a profile backfill could never re-request work for a
--   (version, profile) pair whose earlier job had succeeded. Terminal rows
--   ('succeeded', 'failed', 'dead') are retained as history and their keys
--   become reusable. Producers MUST therefore spell the predicate in their
--   upsert so the partial index is inferable:
--     insert ... on conflict (queue, idempotency_key)
--       where status in ('queued', 'running') do nothing
--   (see ingestion/jobs.py, which does exactly this).
--
-- Local-testable: yes (no pgvector).

create table app_private.jobs (
  id bigint generated always as identity primary key,
  queue text not null,
  idempotency_key text not null,
  payload jsonb not null,
  -- Lifecycle: queued -> running -> (succeeded | queued-with-backoff |
  -- dead). 'failed' is reserved for a worker recording a PERMANENT,
  -- non-retryable failure directly; app_private.fail_job never sets it
  -- (it either reschedules as 'queued' or gives up as 'dead').
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- P3: in-flight uniqueness only (see header). Terminal rows keep their
-- keys as audit history and do not block a later re-enqueue.
create unique index jobs_inflight_key_uq
  on app_private.jobs (queue, idempotency_key)
  where status in ('queued', 'running');

-- Claim path index. INCLUDE carries attempts/max_attempts so the
-- "attempts < max_attempts" cap is evaluated without a heap fetch.
create index jobs_claim_idx
  on app_private.jobs (queue, available_at, id)
  include (attempts, max_attempts)
  where status = 'queued';

-- Reaper path index: stale leases only.
create index jobs_stuck_lease_idx
  on app_private.jobs (locked_at)
  where status = 'running';

-- Claim up to "batch" queued jobs from "queue" for worker "worker".
-- Concurrency-safe: FOR UPDATE SKIP LOCKED means two workers claiming at
-- the same time never double-claim a row. Call this in a SHORT transaction
-- and commit BEFORE doing any network/model call — never hold the row lock
-- across slow I/O. Lease recovery (requeue of stuck 'running' rows) is the
-- reaper's job, not this function's.
-- Parameter names are part of the contract: (queue, batch, worker); inside
-- the body they are disambiguated as claim_jobs.<param> because "queue"
-- collides with the column name.
create or replace function app_private.claim_jobs(
  queue text,
  batch int,
  worker text
)
returns setof app_private.jobs
language sql
volatile
set search_path = ''
as $$
  with candidate as (
    select j.id
    from app_private.jobs j
    where j.queue = claim_jobs.queue
      and j.status = 'queued'
      and j.available_at <= now()
      -- P2a: never hand out a job that has already burned its budget.
      -- Without this the queue re-claimed a permanently failing job for
      -- ever and attempts ran past max_attempts.
      and j.attempts < j.max_attempts
    order by j.available_at, j.id
    for update skip locked
    limit claim_jobs.batch
  )
  update app_private.jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = claim_jobs.worker,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.*;
$$;

comment on function app_private.claim_jobs(text, int, text) is
  'Claim up to <batch> due, under-budget jobs from <queue> for <worker>. '
  'Skips locked rows and rows whose attempts have reached max_attempts.';

-- Record a failed attempt (P2b). The single failure path for workers:
--   * last_error is stored verbatim for the dead-letter audit trail;
--   * the lease is released (locked_at/locked_by cleared);
--   * while attempts are left, the row goes back to 'queued' and is held
--     off until now() + backoff (the caller supplies the backoff, so the
--     retry policy — fixed, exponential, jittered — stays in the worker);
--   * once attempts have reached max_attempts the row becomes 'dead' and
--     is never claimed again. available_at is left alone in that case
--     because it no longer means anything for a dead row.
-- Returns the updated row (NULL row / no row when job_id does not exist).
create or replace function app_private.fail_job(
  job_id bigint,
  error jsonb,
  backoff interval default interval '30 seconds'
)
returns app_private.jobs
language sql
volatile
set search_path = ''
as $$
  update app_private.jobs j
  set status = case
                 when j.attempts >= j.max_attempts then 'dead'
                 else 'queued'
               end,
      available_at = case
                       when j.attempts >= j.max_attempts then j.available_at
                       else now() + fail_job.backoff
                     end,
      locked_at = null,
      locked_by = null,
      last_error = fail_job.error,
      updated_at = now()
  where j.id = fail_job.job_id
  returning j.*;
$$;

comment on function app_private.fail_job(bigint, jsonb, interval) is
  'Record a failed attempt: store last_error, release the lease, retry at '
  'now() + backoff, or flip to ''dead'' once attempts >= max_attempts.';

-- Requeue crashed leases (P2c). A worker that dies mid-job leaves its row
-- in 'running' with a stale locked_at; nothing else ever reclaims it.
-- Call this periodically with a lease longer than the slowest legitimate
-- job. Rows that have already burned their budget go straight to 'dead'
-- instead of being requeued into an unclaimable state.
-- The reap is recorded in last_error so a requeue is auditable; existing
-- error content is preserved (the || merge only adds keys).
create or replace function app_private.reap_stuck_jobs(
  lease interval default interval '5 minutes'
)
returns setof app_private.jobs
language sql
volatile
set search_path = ''
as $$
  update app_private.jobs j
  set status = case
                 when j.attempts >= j.max_attempts then 'dead'
                 else 'queued'
               end,
      locked_at = null,
      locked_by = null,
      last_error = coalesce(j.last_error, '{}'::jsonb)
        || jsonb_build_object(
             'reaped_at', to_jsonb(now()),
             'reaped_from_worker', to_jsonb(j.locked_by),
             'reason', to_jsonb('lease_expired'::text)
           ),
      updated_at = now()
  where j.status = 'running'
    and j.locked_at is not null
    and j.locked_at < now() - reap_stuck_jobs.lease
  returning j.*;
$$;

comment on function app_private.reap_stuck_jobs(interval) is
  'Requeue (or kill, at the attempt cap) every ''running'' job whose lease '
  'is older than <lease>. Recovery for workers that crashed mid-job.';
