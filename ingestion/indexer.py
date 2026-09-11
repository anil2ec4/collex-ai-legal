"""Idempotent chunk insertion (legal.chunks) per document version.

Versions are append-only and content-hash-keyed, so a given version's
chunk set is deterministic: re-inserting is keyed off the table's
``unique (document_version_id, ordinal)`` with ``on conflict do nothing``.
The function consumes an ITERABLE (including generators) so the pipeline
can stream chunks and so tests can inject a failure mid-iteration to
prove publish atomicity.

Note the ``on conflict`` arbiter is deliberately the ORDINAL, not the span:
re-running the same chunker over the same immutable canonical text yields
byte-identical chunks, so a conflicting ordinal is genuinely the same row.
A chunker change that moved a boundary would instead collide with
``chunks_no_overlap_within_version`` and fail loudly, which is what we
want — silently mixing two chunkers' spans inside one version would make
citation offsets ambiguous.

Batching (W12-F)
----------------
Rows are sent in batches of ``INSERT_BATCH_SIZE`` through
``cursor.executemany`` — psycopg 3 drives that in libpq pipeline mode, so
one round trip carries hundreds of rows instead of one INSERT per chunk.
A 25 MB upload (~30 000 paragraphs) used to need ~30 000 round trips and
overran the 180 s process budget the HTTP layer allows the intake CLI.

What batching does NOT change: the statement text, the parameter tuple per
row, the conflict arbiter, the transaction (everything still commits with
the version in ``ingestion.pipeline``), and the return value — psycopg 3's
``rowcount`` after ``executemany`` is the SUM over the batch, so a row
skipped by ``on conflict do nothing`` is still not counted. The streaming
contract holds too: chunks are pulled from the iterable one at a time and a
generator that raises mid-way aborts the (uncommitted) insert exactly as
before; ``tests/ingestion/test_publish_atomicity.py`` proves the rollback.
"""

from __future__ import annotations

from typing import Iterable

import psycopg
from psycopg.types.json import Json

from ingestion.chunking import Chunk

#: Rows per executemany round trip. 500 keeps a batch well under a few MB
#: of parameters even for long paragraphs while cutting round trips ~500x.
INSERT_BATCH_SIZE = 500

_INSERT_SQL = (
    "insert into legal.chunks"
    " (document_version_id, ordinal, structural_path, article_no,"
    "  paragraph_no, start_char, end_char, original_text,"
    "  search_text, normalizer_version, content_sha256, token_count,"
    "  metadata)"
    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    " on conflict (document_version_id, ordinal) do nothing"
)


def chunk_row(version_id: str, chunk: Chunk) -> tuple:
    """The exact parameter tuple one chunk is written with (shared with tests
    so the batch path can be proven row-for-row equal to the old loop)."""
    return (
        version_id,
        chunk.ordinal,
        list(chunk.structural_path),
        chunk.article_no,
        chunk.paragraph_no,
        chunk.start_char,
        chunk.end_char,
        chunk.original_text,
        chunk.search_text,
        # Written explicitly rather than left to the column default:
        # the row must record the normalizer this process actually
        # ran, not whatever the schema's default happens to say.
        chunk.normalizer_version,
        chunk.content_sha256,
        chunk.token_count,
        Json(chunk.metadata),
    )


def _flush(cur: psycopg.Cursor, rows: list[tuple]) -> int:
    cur.executemany(_INSERT_SQL, rows)
    # psycopg >= 3.1: cumulative rowcount over the whole executemany.
    return max(0, cur.rowcount)


def insert_chunks(
    conn: psycopg.Connection,
    version_id: str,
    chunks: Iterable[Chunk],
    *,
    batch_size: int = INSERT_BATCH_SIZE,
) -> int:
    """Insert chunks for ``version_id``; returns rows actually inserted."""
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    inserted = 0
    batch: list[tuple] = []
    with conn.cursor() as cur:
        for chunk in chunks:
            batch.append(chunk_row(version_id, chunk))
            if len(batch) >= batch_size:
                inserted += _flush(cur, batch)
                batch = []
        if batch:
            inserted += _flush(cur, batch)
    return inserted
