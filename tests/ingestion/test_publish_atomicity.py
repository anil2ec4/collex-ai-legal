"""(d) Publish atomicity: never a half-indexed, visible version.

Brief 6.9: "Yeni version, indeksleri yarım halde kullanıcıya görünür
yapmamalı." The pipeline puts identity resolution, the version append, all
chunk inserts, the embedding-job enqueue and the final flip to 'published'
in ONE transaction, so a fault anywhere inside it leaves nothing behind.

The fault is injected mid-chunking (after some chunks have already been
handed to the indexer) via the Pipeline's ``chunk_fn`` seam — that is the
realistic failure shape, and it proves the rollback covers partially
written chunks rather than only an all-or-nothing pre-insert failure.

The immutable snapshot row is DELIBERATELY exempt: it is the audit record
of the fetch and is committed first, on purpose, so a failed parse still
leaves evidence of what was retrieved.
"""

from __future__ import annotations

import pytest

from ingestion import chunking
from ingestion.pipeline import Pipeline
from ingestion.ports import FixtureSource

TARGET = "kanun_6098_v1.json"
EXTERNAL_ID = "kanun-6098"


class InjectedFailure(RuntimeError):
    """Marker so the test cannot accidentally pass on a different error."""


def _exploding_chunk_fn(after: int):
    """Yield ``after`` real chunks, then raise."""

    def chunk_fn(parsed):
        for index, chunk in enumerate(chunking.chunk_document(parsed)):
            if index >= after:
                raise InjectedFailure(
                    f"injected fault after {after} chunks"
                )
            yield chunk

    return chunk_fn


def _counts(conn) -> tuple[int, int, int, int]:
    return conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from legal.chunks),"
        " (select count(*) from app_private.jobs)"
    ).fetchone()


def test_fault_mid_chunking_leaves_nothing_published(dsn, corpus_dir, conn):
    source = FixtureSource(corpus_dir, include=[TARGET])
    total_chunks = len(
        chunking.chunk_document(source.parse(
            source.fetch_raw(next(iter(source.list_documents())))
        ))
    )
    assert total_chunks > 2, "fixture too small to fail *mid*-chunking"

    result = Pipeline(
        dsn, source, chunk_fn=_exploding_chunk_fn(total_chunks - 1)
    ).run()

    assert result.published == 0
    assert result.failed == 1
    assert "InjectedFailure" in (result.outcomes[0].error or "")

    docs, versions, chunks, jobs = _counts(conn)
    assert versions == 0, "a version row survived a failed ingest"
    assert chunks == 0, "partially inserted chunks survived"
    assert jobs == 0, "an embedding job was enqueued for an unpublished run"
    assert docs == 0, "the logical document row survived a failed ingest"

    # The audit record of the fetch is intentionally kept.
    snapshots = conn.execute(
        "select count(*) from legal.source_snapshots where external_id = %s",
        (EXTERNAL_ID,),
    ).fetchone()[0]
    assert snapshots == 1, (
        "the immutable snapshot must survive a downstream failure"
    )


def test_clean_rerun_after_a_failure_completes(dsn, corpus_dir, conn):
    source = FixtureSource(corpus_dir, include=[TARGET])
    failed = Pipeline(dsn, source, chunk_fn=_exploding_chunk_fn(1)).run()
    assert failed.failed == 1

    clean = Pipeline(dsn, FixtureSource(corpus_dir, include=[TARGET])).run()

    assert clean.failed == 0
    assert clean.published == 1
    # The snapshot was already there, so no new one is written.
    assert clean.snapshots_created == 0

    docs, versions, chunks, jobs = _counts(conn)
    assert (docs, versions) == (1, 1)
    assert chunks == clean.total_chunks > 0
    assert jobs == 2
    assert conn.execute(
        "select count(*) from legal.source_snapshots"
    ).fetchone()[0] == 1, "the re-run duplicated the snapshot"

    status, is_open = conn.execute(
        "select v.status::text, upper_inf(v.system_period)"
        " from legal.document_versions v"
    ).fetchone()
    assert (status, is_open) == ("published", True)


def test_one_document_failing_does_not_block_the_others(dsn, corpus_dir,
                                                        conn):
    """Per-document isolation: the run reports, then keeps going."""

    def selective_fault(parsed):
        if parsed.external_id == EXTERNAL_ID:
            raise InjectedFailure("only this document fails")
        yield from chunking.chunk_document(parsed)

    result = Pipeline(
        dsn, FixtureSource(corpus_dir), chunk_fn=selective_fault
    ).run()

    assert result.failed == 1
    assert result.published == len(result.outcomes) - 1
    failures = [o for o in result.outcomes if o.action == "failed"]
    assert [o.external_id for o in failures] == [EXTERNAL_ID]

    surviving = conn.execute(
        "select count(*) from legal.documents where external_id = %s",
        (EXTERNAL_ID,),
    ).fetchone()[0]
    assert surviving == 0
    # One version per successfully published FILE; the corpus carries two
    # crawls of one statute, so documents < versions.
    assert conn.execute(
        "select count(*) from legal.document_versions"
    ).fetchone()[0] == result.published


def test_chunker_producing_nothing_is_a_failure_not_an_empty_publish(
    dsn, corpus_dir, conn
):
    result = Pipeline(
        dsn, FixtureSource(corpus_dir, include=[TARGET]),
        chunk_fn=lambda parsed: iter(()),
    ).run()

    assert result.failed == 1
    assert "chunker produced no chunks" in (result.outcomes[0].error or "")
    assert _counts(conn)[1] == 0, "an unchunked version was left behind"


def test_injected_failure_marker_is_actually_reached(corpus_dir):
    """Guard against the fault injector silently never firing."""
    source = FixtureSource(corpus_dir, include=[TARGET])
    parsed = source.parse(
        source.fetch_raw(next(iter(source.list_documents())))
    )
    with pytest.raises(InjectedFailure):
        list(_exploding_chunk_fn(1)(parsed))
