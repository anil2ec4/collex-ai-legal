"""(a) Full-corpus ingest and the exact-provenance invariants.

The whole synthetic corpus is ingested into the scratch database and then
every stored chunk is checked TWICE for the same property:

  * in Python  -- ``original_text == canonical_text[start_char:end_char]``
  * in SQL     -- ``original_text = substring(canonical_text from
                   start_char + 1 for end_char - start_char)``

Agreement between the two is the point: it proves the offsets are Unicode
CODE POINT offsets (Python str semantics == PostgreSQL character semantics
under UTF-8) and not byte offsets, on real Turkish text full of two-byte
characters. ``sha256(original_text)`` is likewise verified both ways.
"""

from __future__ import annotations

import hashlib

from ingestion.chunking import NORMALIZER_VERSION
from ingestion.pipeline import DEFAULT_EMBEDDING_PROFILES, Pipeline
from ingestion.ports import FixtureSource

# The corpus holds EIGHT files describing SEVEN logical documents: two of
# them (kanun_5237_v1/_v2) are successive versions of the same statute.
# Discovery yields every file — it used to dedupe them to the
# lexicographically first filename and silently drop the amended text — so a
# default run ingests 8 files into 7 documents and 8 versions.
EXPECTED_FILES = 8
EXPECTED_DOCUMENTS = 7
EXPECTED_VERSIONS = 8


def _run(dsn, corpus_dir, include=None) -> object:
    return Pipeline(dsn, FixtureSource(corpus_dir, include=include)).run()


def test_full_corpus_ingest_populates_all_three_levels(dsn, corpus_dir, conn):
    result = _run(dsn, corpus_dir)

    assert result.failed == 0, [
        (o.external_id, o.error) for o in result.outcomes if o.error
    ]
    assert result.published == EXPECTED_FILES
    assert len(result.outcomes) == EXPECTED_FILES

    docs, snaps, versions, chunks = conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.source_snapshots),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from legal.chunks)"
    ).fetchone()
    assert docs == EXPECTED_DOCUMENTS
    assert snaps == EXPECTED_FILES
    assert versions == EXPECTED_VERSIONS
    assert chunks > 0
    assert chunks == result.total_chunks

    # Every version reached the published state (nothing half-indexed).
    statuses = conn.execute(
        "select distinct status from legal.document_versions"
    ).fetchall()
    assert statuses == [("published",)]

    # Both scopes are represented (the dilekçe fixture is tenant-scoped).
    scopes = dict(conn.execute(
        "select scope::text, count(*) from legal.documents group by 1"
    ).fetchall())
    assert scopes == {"public": 6, "tenant": 1}


def test_no_corpus_file_is_silently_skipped(dsn, corpus_dir, conn):
    """Discovery drops nothing.

    ``FixtureSource`` used to dedupe files sharing a ``(source, external_id)``
    to the lexicographically FIRST filename, so one pass over the corpus
    ingested ``kanun_5237_v1.json`` and SILENTLY SKIPPED
    ``kanun_5237_v2.json`` — with nothing in the run report saying so. A
    caller who did not know to run a second pass got a corpus missing the
    amended text of TCK 157 and no way to tell.
    """
    result = _run(dsn, corpus_dir)

    files = sorted(p.name for p in corpus_dir.glob("*.json"))
    assert len(files) == EXPECTED_FILES
    assert result.failed == 0
    # One outcome per FILE, not one per logical document.
    assert len(result.outcomes) == len(files)

    # Both crawls of kanun-5237 are present, as two versions of ONE document.
    labels = conn.execute(
        "select v.version_label from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = 'kanun-5237'"
        " order by lower(v.effective_period)"
    ).fetchall()
    assert [row[0] for row in labels] == ["v1-20050601", "v2-20260115-7999"]

    # ...and the version machinery ordered them by commencement, so the
    # amended text is the one in force today and the superseded text is
    # closed rather than overlapping.
    periods = conn.execute(
        "select v.effective_period::text from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = 'kanun-5237'"
        " order by lower(v.effective_period)"
    ).fetchall()
    assert [row[0] for row in periods] == [
        "[2005-06-01,2026-01-15)",
        "[2026-01-15,)",
    ]

    # The amended article's text differs across the two versions — i.e. the
    # second file was really ingested, not merely counted.
    texts = conn.execute(
        "select v.version_label, c.original_text from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = 'kanun-5237' and c.article_no = '157'"
    ).fetchall()
    by_label = dict(texts)
    assert "bir yıldan beş yıla kadar hapis" in by_label["v1-20050601"]
    assert "üç yıldan yedi yıla kadar hapis" in by_label["v2-20260115-7999"]


def test_amendment_relations_are_written_with_their_resolution(dsn, corpus_dir,
                                                               conn):
    """The citator index is populated at ingest, with auditable provenance."""
    result = _run(dsn, corpus_dir)

    assert result.total_relations == 2
    assert result.unresolved_relations == []

    rows = conn.execute(
        "select r.kind::text, r.resolution_status, r.confidence,"
        "       r.resolver_version,"
        "       r.target_locator ->> 'legislation_no',"
        "       r.target_locator ->> 'article',"
        "       src.external_id, tgt.external_id,"
        "       c.article_no"
        " from legal.document_relations r"
        " join legal.document_versions v"
        "   on v.id = r.from_document_version_id"
        " join legal.documents src on src.id = v.document_id"
        " join legal.documents tgt on tgt.id = r.to_document_id"
        " left join legal.chunks c on c.id = r.source_chunk_id"
        " order by 5"
    ).fetchall()

    assert [(r[0], r[1], r[4], r[5], r[6], r[7], r[8]) for r in rows] == [
        ("AMENDS", "resolved", "5237", "157", "kanun-7999", "kanun-5237", "1"),
        ("AMENDS", "resolved", "6098", "49", "kanun-7999", "kanun-6098", "2"),
    ]
    for row in rows:
        assert row[2] is not None, "a stored relation carries no confidence"
        assert row[3], "a stored relation carries no resolver_version"

    # Derived data: re-deriving must not accumulate duplicates.
    _run(dsn, corpus_dir)
    assert conn.execute(
        "select count(*) from legal.document_relations"
    ).fetchone()[0] == 2


def test_every_chunk_slice_matches_in_python_and_in_sql(dsn, corpus_dir,
                                                        conn):
    _run(dsn, corpus_dir)

    rows = conn.execute(
        "select c.id, c.start_char, c.end_char, c.original_text,"
        "       c.content_sha256, c.normalizer_version, v.canonical_text,"
        "       c.original_text = substring(v.canonical_text"
        "         from c.start_char + 1 for c.end_char - c.start_char)"
        "         as sql_slice_ok,"
        "       encode(sha256(convert_to(c.original_text, 'UTF8')), 'hex')"
        "         = c.content_sha256 as sql_hash_ok"
        " from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
    ).fetchall()
    assert rows, "no chunks were stored"

    multibyte_seen = False
    for (chunk_id, start, end, original, sha, normalizer, canonical,
         sql_slice_ok, sql_hash_ok) in rows:
        assert canonical[start:end] == original, (
            f"Python slice mismatch on chunk {chunk_id}"
        )
        assert sql_slice_ok, f"SQL substring mismatch on chunk {chunk_id}"
        assert hashlib.sha256(original.encode("utf-8")).hexdigest() == sha, (
            f"Python sha256 mismatch on chunk {chunk_id}"
        )
        assert sql_hash_ok, f"SQL sha256 mismatch on chunk {chunk_id}"
        assert normalizer == NORMALIZER_VERSION
        if len(original.encode("utf-8")) > len(original):
            multibyte_seen = True

    assert multibyte_seen, (
        "no multi-byte chunk in the corpus — the code-point vs byte offset"
        " distinction would be untested"
    )


def test_chunks_do_not_overlap_within_a_version(dsn, corpus_dir, conn):
    """P2 decision: position -> chunk must be a function, not a relation."""
    _run(dsn, corpus_dir)

    overlaps = conn.execute(
        "select a.id, b.id"
        " from legal.chunks a"
        " join legal.chunks b"
        "   on b.document_version_id = a.document_version_id"
        "  and b.id <> a.id"
        "  and int4range(a.start_char, a.end_char)"
        "      && int4range(b.start_char, b.end_char)"
    ).fetchall()
    assert overlaps == [], f"overlapping chunk spans: {overlaps}"

    # And ordinals are contiguous from 0 within each version.
    gaps = conn.execute(
        "select document_version_id, min(ordinal), max(ordinal), count(*)"
        " from legal.chunks group by 1"
        " having min(ordinal) <> 0 or max(ordinal) <> count(*) - 1"
    ).fetchall()
    assert gaps == [], f"non-contiguous chunk ordinals: {gaps}"


def test_snapshot_records_the_raw_payload_hash(dsn, corpus_dir, conn):
    _run(dsn, corpus_dir)

    for path in sorted(corpus_dir.glob("*.json")):
        raw_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        stored = conn.execute(
            "select count(*) from legal.source_snapshots"
            " where raw_sha256 = %s",
            (raw_sha,),
        ).fetchone()[0]
        # EVERY file gets a snapshot: discovery skips nothing, so the audit
        # record of the fetch exists for each one.
        assert stored == 1, f"{path.name}: {stored} snapshots"


def test_embedding_jobs_enqueued_once_per_version_and_profile(dsn, corpus_dir,
                                                              conn):
    """(f) one job per (version, profile), and no duplicates on re-run."""
    result = _run(dsn, corpus_dir)
    # One job per (VERSION, profile) — the two crawls of kanun-5237 are two
    # versions and each needs its own embeddings.
    expected = EXPECTED_VERSIONS * len(DEFAULT_EMBEDDING_PROFILES)
    assert result.total_jobs == expected

    total, distinct_keys = conn.execute(
        "select count(*), count(distinct idempotency_key)"
        " from app_private.jobs where queue = 'embedding'"
    ).fetchone()
    assert total == expected
    assert distinct_keys == expected

    pairs = conn.execute(
        "select payload ->> 'document_version_id',"
        "       payload ->> 'profile_key', count(*)"
        " from app_private.jobs where queue = 'embedding'"
        " group by 1, 2 having count(*) > 1"
    ).fetchall()
    assert pairs == [], f"duplicate (version, profile) jobs: {pairs}"

    # Re-running the pipeline must not enqueue anything new.
    second = _run(dsn, corpus_dir)
    assert second.total_jobs == 0
    assert conn.execute(
        "select count(*) from app_private.jobs"
    ).fetchone()[0] == expected
