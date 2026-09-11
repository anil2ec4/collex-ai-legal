"""(b) Re-ingesting an identical corpus must be a complete no-op.

"Idempotent" here means byte-level: no new snapshot (the raw payload hash
already exists), no new version (the content hash already exists), no new
chunk, no new job — and the existing rows are not rewritten either, which is
checked by comparing the full row identity sets before and after.

A NOTE ON THE OUTCOME NAMES. This corpus deliberately carries a document's
version HISTORY: ``kanun_5237_v1.json`` and ``kanun_5237_v2.json`` are two
crawls of one statute, and since 2026-08-27 discovery yields both instead of
silently dropping the second. On a re-run the v1 file therefore matches a
version that is no longer the current one, and ``find_version_by_hash``
reports that as ``reverted_content`` — the name for "upstream's current text
went back to something we have seen before". Here it means something
narrower and much duller: "we re-read a historical version we already
store". The DATABASE outcome is identical either way (nothing is written),
which is what these tests assert; telling the two apart would need the
pipeline to compare commencement dates, and that is a separate decision from
the discovery fix.
"""

from __future__ import annotations

from ingestion.pipeline import Pipeline
from ingestion.ports import FixtureSource


def _snapshot_of_world(conn) -> dict[str, list]:
    return {
        "documents": conn.execute(
            "select id, source, external_id, scope::text, tenant_id"
            " from legal.documents order by id"
        ).fetchall(),
        "snapshots": conn.execute(
            "select id, raw_sha256 from legal.source_snapshots order by id"
        ).fetchall(),
        "versions": conn.execute(
            "select id, document_id, content_sha256, status::text,"
            "       system_period::text, effective_period::text"
            " from legal.document_versions order by id"
        ).fetchall(),
        "chunks": conn.execute(
            "select id, document_version_id, ordinal, start_char, end_char,"
            "       content_sha256 from legal.chunks order by id"
        ).fetchall(),
        "jobs": conn.execute(
            "select id, queue, idempotency_key, status"
            " from app_private.jobs order by id"
        ).fetchall(),
    }


def test_reingesting_identical_corpus_changes_nothing(dsn, corpus_dir, conn):
    first = Pipeline(dsn, FixtureSource(corpus_dir)).run()
    assert first.failed == 0
    assert first.published > 0
    before = _snapshot_of_world(conn)

    second = Pipeline(dsn, FixtureSource(corpus_dir)).run()

    assert second.failed == 0
    assert second.published == 0
    assert second.snapshots_created == 0
    assert second.total_chunks == 0
    assert second.total_jobs == 0
    # Every file is accounted for, and nothing new was written. The single
    # non-"unchanged" outcome is the SUPERSEDED crawl of kanun-5237, whose
    # content hash matches a version that is no longer current (see module
    # docstring); it writes nothing either.
    assert len(second.outcomes) == len(first.outcomes)
    assert second.unchanged + second.reverted == len(first.outcomes)
    assert [o.external_id for o in second.outcomes
            if o.action == "reverted_content"] == ["kanun-5237"]

    after = _snapshot_of_world(conn)
    for table, rows in before.items():
        assert after[table] == rows, f"{table} changed on re-ingest"


def test_third_run_is_still_a_no_op(dsn, corpus_dir, conn):
    """Convergence, not just first-repeat equality."""
    for _ in range(3):
        Pipeline(dsn, FixtureSource(corpus_dir)).run()
    counts = conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.source_snapshots),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from app_private.jobs)"
    ).fetchone()
    docs, snaps, versions, jobs = counts
    # One snapshot and one version per FILE (a document may have several
    # versions), one job per (version, profile).
    assert snaps == versions
    assert docs < versions, "the two-version fixture is no longer represented"
    assert jobs == versions * 2  # two embedding profiles


def test_unchanged_outcome_points_at_the_open_version(dsn, corpus_dir, conn):
    """Regression for the old 'infinity' default.

    ``upper_inf(system_period)`` was permanently false, so
    ``find_version_by_hash`` reported every unchanged re-crawl as
    ``reverted_content`` — an alarming outcome name for the most ordinary
    event in the pipeline.
    """
    Pipeline(dsn, FixtureSource(corpus_dir)).run()
    second = Pipeline(dsn, FixtureSource(corpus_dir)).run()

    assert {o.action for o in second.outcomes} == {
        "unchanged", "reverted_content",
    }
    for outcome in second.outcomes:
        is_open = conn.execute(
            "select upper_inf(system_period) from legal.document_versions"
            " where id = %s",
            (outcome.version_id,),
        ).fetchone()[0]
        if outcome.action == "unchanged":
            assert is_open, (
                f"{outcome.external_id}: 'unchanged' pointed at a closed"
                " version"
            )
        else:
            # The other name is only ever used for a version that is NOT the
            # current one — that distinction is the whole point of the pair.
            assert not is_open, (
                f"{outcome.external_id}: '{outcome.action}' pointed at the"
                " open version"
            )
