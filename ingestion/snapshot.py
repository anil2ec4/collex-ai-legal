"""Immutable source snapshots (legal.source_snapshots) with raw dedupe.

Every fetch from an upstream produces at most one snapshot row per distinct
raw payload: the table's unique index (source, external_id, raw_sha256)
makes re-fetching identical bytes a no-op. Snapshot rows are never updated
or deleted by the pipeline (immutability is an audit property).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import psycopg
from psycopg.types.json import Json

from ingestion.ports import RawFetch

PARSER_NAME = "fixture-json"
PARSER_VERSION = "1.0.0"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class SnapshotResult:
    snapshot_id: str
    raw_sha256: str
    created: bool


def ensure_snapshot(
    conn: psycopg.Connection,
    *,
    source: str,
    fetch: RawFetch,
    parser_name: str = PARSER_NAME,
    parser_version: str = PARSER_VERSION,
    correlation_id: str | None = None,
) -> SnapshotResult:
    """Insert the snapshot for ``fetch`` unless identical bytes exist.

    Returns the existing or newly created row id. Runs inside the caller's
    transaction; the pipeline commits it in a SHORT transaction of its own
    so the audit record survives downstream parse/index failures.
    """
    raw_hash = sha256_hex(fetch.raw_bytes)
    row = conn.execute(
        "insert into legal.source_snapshots"
        " (source, external_id, requested_url, final_url, retrieved_at,"
        "  http_status, media_type, raw_sha256, parser_name, parser_version,"
        "  request_correlation_id, metadata)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " on conflict (source, external_id, raw_sha256) do nothing"
        " returning id",
        (
            source,
            fetch.ref.external_id,
            fetch.retrieved_url,
            fetch.final_url,
            fetch.retrieved_at,
            fetch.http_status,
            fetch.media_type,
            raw_hash,
            parser_name,
            parser_version,
            correlation_id,
            Json({}),
        ),
    ).fetchone()
    if row is not None:
        return SnapshotResult(str(row[0]), raw_hash, True)
    existing = conn.execute(
        "select id from legal.source_snapshots"
        " where source = %s and external_id = %s and raw_sha256 = %s",
        (source, fetch.ref.external_id, raw_hash),
    ).fetchone()
    if existing is None:  # pragma: no cover - conflict implies existence
        raise RuntimeError("snapshot conflict without an existing row")
    return SnapshotResult(str(existing[0]), raw_hash, False)
