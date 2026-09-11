"""Embedding-job enqueue into app_private.jobs (idempotent).

One job per (document version, embedding profile). Idempotency key
``embed:<version_id>:<profile_key>`` under queue ``embedding`` rides the
table's ``jobs_inflight_key_uq``: enqueueing again (pipeline re-run, crash
replay) while the job is still queued or running is a no-op. Workers claim
rows through ``app_private.claim_jobs`` (migration 20260826050000) —
nothing here performs any model/network call.

That unique index is PARTIAL (``where status in ('queued', 'running')``),
so the ``on conflict`` clause MUST repeat the predicate for PostgreSQL to
infer the arbiter index; without it the insert fails with "no unique or
exclusion constraint matching the ON CONFLICT specification". The partial
shape is deliberate — see the P3 note in the migration header: terminal
rows keep their key as audit history, and a key becomes reusable once the
work reaches a terminal state (dead-letter replay, profile backfill).
"""

from __future__ import annotations

from typing import Sequence

import psycopg
from psycopg.types.json import Json

EMBEDDING_QUEUE = "embedding"

# Must match jobs_inflight_key_uq's predicate exactly (20260826050000).
INFLIGHT_STATES = ("queued", "running")
_ON_CONFLICT = (
    " on conflict (queue, idempotency_key)"
    " where status in ('queued', 'running') do nothing"
)


def idempotency_key(version_id: str, profile_key: str) -> str:
    return f"embed:{version_id}:{profile_key}"


def enqueue_embedding_jobs(
    conn: psycopg.Connection,
    *,
    version_id: str,
    profiles: Sequence[str],
) -> int:
    """Enqueue one embedding job per profile; returns rows actually added."""
    enqueued = 0
    for profile_key in profiles:
        cur = conn.execute(
            "insert into app_private.jobs (queue, idempotency_key, payload)"
            " values (%s, %s, %s)" + _ON_CONFLICT,
            (
                EMBEDDING_QUEUE,
                idempotency_key(version_id, profile_key),
                Json({
                    "document_version_id": version_id,
                    "profile_key": profile_key,
                    "reason": "ingest",
                }),
            ),
        )
        enqueued += cur.rowcount
    return enqueued
