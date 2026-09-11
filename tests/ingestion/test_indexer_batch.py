"""Batched chunk insertion (W12-F) is row-for-row the old one-INSERT loop.

What must not change when ``insert_chunks`` batches through
``executemany``: the rows (every column, including offsets and hashes),
the ordinal conflict arbiter (re-insert = 0 rows), the streaming contract
(a generator that raises mid-way aborts the uncommitted insert) and the
return value (rows ACTUALLY inserted, conflicts excluded).
"""

from __future__ import annotations

import hashlib

import psycopg
import pytest

from ingestion import chunking, identity, indexer, snapshot, versioning
from ingestion.ports import FixtureSource, ParsedDocument, RawFetch


def _fetch_and_parse(corpus_dir, name: str) -> tuple[RawFetch, ParsedDocument]:
    source = FixtureSource(corpus_dir, include=[name])
    fetch = source.fetch_raw(next(iter(source.list_documents())))
    return fetch, source.parse(fetch)


def _new_version(conn: psycopg.Connection, fetch: RawFetch,
                 parsed: ParsedDocument) -> str:
    """Snapshot + identity + a 'parsed' version, no chunks yet — the state
    the pipeline is in when it calls ``insert_chunks``."""
    snap = snapshot.ensure_snapshot(conn, source=parsed.source, fetch=fetch)
    doc = identity.resolve_document(
        conn,
        source=parsed.source,
        external_id=parsed.external_id,
        document_type=parsed.document_type,
        scope=parsed.scope,
        tenant_id=parsed.tenant_id,
        title=parsed.title,
        canonical_source_url=parsed.retrieved_url,
    )
    return versioning.append_version(
        conn,
        document_id=doc.document_id,
        snapshot_id=snap.snapshot_id,
        parsed=parsed,
        content_hash=versioning.content_sha256(parsed.canonical_text),
        status="parsed",
    )


def _stored_rows(conn, version_id: str) -> list[tuple]:
    return conn.execute(
        "select ordinal, structural_path, article_no, paragraph_no,"
        "       start_char, end_char, original_text, search_text,"
        "       normalizer_version, content_sha256, token_count, metadata"
        " from legal.chunks where document_version_id = %s order by ordinal",
        (version_id,),
    ).fetchall()


@pytest.mark.parametrize("batch_size", [1, 3, 500])
def test_batched_rows_equal_the_chunker_output_exactly(dsn, conn, corpus_dir,
                                                       batch_size):
    fetch, parsed = _fetch_and_parse(corpus_dir, "kanun_5237_v1.json")
    chunks = chunking.chunk_document(parsed)
    assert len(chunks) > 3, "fixture too small to exercise batching"

    version_id = _new_version(conn, fetch, parsed)
    inserted = indexer.insert_chunks(
        conn, version_id, iter(chunks), batch_size=batch_size
    )
    assert inserted == len(chunks)

    stored = _stored_rows(conn, version_id)
    assert len(stored) == len(chunks)
    for chunk, row in zip(chunks, stored):
        (ordinal, path, article, paragraph, start, end, original, search,
         normalizer, sha, tokens, metadata) = row
        assert ordinal == chunk.ordinal
        assert path == list(chunk.structural_path)
        assert article == chunk.article_no
        assert paragraph == chunk.paragraph_no
        assert (start, end) == (chunk.start_char, chunk.end_char)
        assert original == chunk.original_text
        assert search == chunk.search_text
        assert normalizer == chunk.normalizer_version
        assert sha == chunk.content_sha256
        assert sha == hashlib.sha256(original.encode("utf-8")).hexdigest()
        assert tokens == chunk.token_count
        assert metadata == chunk.metadata
        # The provenance invariant every batch must keep.
        assert parsed.canonical_text[start:end] == original


def test_chunk_row_is_the_exact_parameter_tuple(corpus_dir):
    _, parsed = _fetch_and_parse(corpus_dir, "kanun_5237_v1.json")
    chunk = chunking.chunk_document(parsed)[0]
    row = indexer.chunk_row("v-1", chunk)
    assert len(row) == 13
    assert row[0] == "v-1"
    assert row[1] == chunk.ordinal
    assert row[2] == list(chunk.structural_path)
    assert row[5:8] == (chunk.start_char, chunk.end_char, chunk.original_text)
    assert row[9] == chunk.normalizer_version
    assert row[10] == chunk.content_sha256


def test_reinsert_reports_zero_rows_via_the_ordinal_arbiter(dsn, conn,
                                                            corpus_dir):
    fetch, parsed = _fetch_and_parse(corpus_dir, "yargitay_karar_1.json")
    chunks = chunking.chunk_document(parsed)
    version_id = _new_version(conn, fetch, parsed)

    assert indexer.insert_chunks(conn, version_id, chunks) == len(chunks)
    # Same rows again: on conflict do nothing -> rowcount sums to 0.
    assert indexer.insert_chunks(conn, version_id, chunks) == 0
    assert len(_stored_rows(conn, version_id)) == len(chunks)

    # A batch mixing existing and new ordinals counts only the new rows.
    extra = chunking.chunk_generic(
        parsed.canonical_text + "\n\nEK PARAGRAF sentetik ek metin.",
        root="ek",
    )
    fresh = [c for c in extra if c.ordinal >= len(chunks)]
    assert fresh, "the appended paragraph must yield a new ordinal"
    assert indexer.insert_chunks(conn, version_id, chunks + fresh) == len(fresh)


def test_generator_failure_mid_stream_leaves_nothing_committed(dsn, conn,
                                                              corpus_dir):
    """Streaming contract: the indexer pulls chunks lazily, so a generator
    that raises mid-way stops the batch; inside the pipeline's transaction
    a rollback then discards every row of the batch (batch_size=1 makes
    rows 0 and 1 reach the server before the fault)."""
    fetch, parsed = _fetch_and_parse(corpus_dir, "kanun_6098_v1.json")
    chunks = chunking.chunk_document(parsed)
    assert len(chunks) > 2

    class Boom(RuntimeError):
        pass

    seen: list[int] = []

    def exploding():
        for index, chunk in enumerate(chunks):
            if index == 2:
                raise Boom("mid-stream")
            seen.append(index)
            yield chunk

    with psycopg.connect(dsn) as tx:  # NOT autocommit: one transaction
        version_id = _new_version(tx, fetch, parsed)
        with pytest.raises(Boom):
            indexer.insert_chunks(tx, version_id, exploding(), batch_size=1)
        tx.rollback()

    assert seen == [0, 1], "the generator was not consumed lazily"
    assert conn.execute("select count(*) from legal.chunks").fetchone()[0] == 0
    assert conn.execute(
        "select count(*) from legal.document_versions"
    ).fetchone()[0] == 0


def test_batch_size_must_be_positive(conn):
    with pytest.raises(ValueError):
        indexer.insert_chunks(conn, "00000000-0000-0000-0000-000000000000",
                              iter(()), batch_size=0)
