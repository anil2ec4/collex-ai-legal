"""(c) P0-2 regression: appending v2 of kanun-5237 after v1.

This is the test the whole temporal lane exists for. Before the
2026-08-27 correction of 20260826020000, ``system_period`` defaulted to
``tstzrange(now(), 'infinity', '[)')``. ``'infinity'`` is a FINITE
timestamptz value, so ``upper_inf()`` was ALWAYS false: the close-on-append
trigger's guard never fired, the "one open version" unique index covered
zero rows, and every "current version" query returned nothing while
``system_period @> now()`` returned every version ever written.

What is asserted here:
  * a second version is appended (not replaced, not rejected);
  * the previous version is CLOSED (upper_inf false, upper bound set);
  * exactly ONE open version exists for the document;
  * the closed version stays fully readable as history;
  * effective_period is closed at the amendment's commencement date, so
    the two published texts never cover the same calendar day;
  * the AMENDED madde's chunk changes while every UNCHANGED madde keeps a
    byte-identical content_sha256 across the two versions.
"""

from __future__ import annotations

import json

import psycopg
import pytest

from ingestion.pipeline import Pipeline
from ingestion.ports import FixtureSource

V1 = "kanun_5237_v1.json"
V2 = "kanun_5237_v2.json"
EXTERNAL_ID = "kanun-5237"


def _ingest(dsn, corpus_dir, filename):
    return Pipeline(dsn, FixtureSource(corpus_dir, include=[filename])).run()


def _versions(conn):
    return conn.execute(
        "select v.id, v.version_label, v.status::text,"
        "       upper_inf(v.system_period), upper(v.system_period),"
        "       v.effective_period::text"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = %s"
        " order by v.created_at, v.id",
        (EXTERNAL_ID,),
    ).fetchall()


@pytest.fixture()
def two_versions(dsn, corpus_dir, conn):
    first = _ingest(dsn, corpus_dir, V1)
    assert first.published == 1, first.outcomes
    second = _ingest(dsn, corpus_dir, V2)
    assert second.published == 1, second.outcomes
    return first, second


def test_second_version_is_appended_not_replaced(two_versions, conn):
    rows = _versions(conn)
    assert len(rows) == 2, rows
    assert [r[1] for r in rows] == ["v1-20050601", "v2-20260115-7999"]
    assert [r[2] for r in rows] == ["published", "published"]


def test_previous_version_system_period_is_closed(two_versions, conn):
    rows = _versions(conn)
    (_id1, _l1, _s1, v1_open, v1_upper, _p1) = rows[0]
    (_id2, _l2, _s2, v2_open, v2_upper, _p2) = rows[1]

    assert v1_open is False, "previous version stayed open (P0-2 regression)"
    assert v1_upper is not None, "closed version has no upper bound"
    assert v2_open is True, "the new version is not the current one"
    assert v2_upper is None


def test_exactly_one_open_version_per_document(two_versions, conn):
    open_rows = conn.execute(
        "select v.document_id, count(*)"
        " from legal.document_versions v"
        " where upper_inf(v.system_period)"
        " group by 1 having count(*) <> 1"
    ).fetchall()
    assert open_rows == [], f"documents with != 1 open version: {open_rows}"

    current = conn.execute(
        "select v.version_label from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = %s and upper_inf(v.system_period)",
        (EXTERNAL_ID,),
    ).fetchall()
    assert current == [("v2-20260115-7999",)]


def test_a_second_open_version_is_rejected_by_the_unique_backstop(
    two_versions, conn
):
    """document_versions_one_current_uq must be a live constraint."""
    closed_id = _versions(conn)[0][0]
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute(
            "update legal.document_versions"
            " set system_period = tstzrange(lower(system_period), null, '[)')"
            " where id = %s",
            (closed_id,),
        )


def test_closed_version_remains_readable_history(two_versions, conn):
    closed_id = _versions(conn)[0][0]
    text, n_chunks = conn.execute(
        "select v.canonical_text,"
        "       (select count(*) from legal.chunks c"
        "         where c.document_version_id = v.id)"
        " from legal.document_versions v where v.id = %s",
        (closed_id,),
    ).fetchone()
    assert "bir yıldan beş yıla kadar hapis" in text, (
        "the superseded text must survive verbatim for point-in-time"
        " citation"
    )
    assert n_chunks > 0, "closed version lost its chunks"


def test_effective_periods_do_not_overlap(two_versions, conn):
    rows = _versions(conn)
    assert rows[0][5] == "[2005-06-01,2026-01-15)", rows[0][5]
    assert rows[1][5] == "[2026-01-15,)", rows[1][5]

    overlaps = conn.execute(
        "select a.id, b.id"
        " from legal.document_versions a"
        " join legal.document_versions b"
        "   on b.document_id = a.document_id and b.id <> a.id"
        " where a.status = 'published' and b.status = 'published'"
        "   and a.effective_period && b.effective_period"
    ).fetchall()
    assert overlaps == [], f"published versions overlap in time: {overlaps}"


def test_only_the_amended_madde_changed(two_versions, conn):
    """Unchanged maddeler keep an identical content hash across versions."""
    rows = conn.execute(
        "select c.article_no, c.paragraph_no, v.version_label,"
        "       c.content_sha256"
        " from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = %s",
        (EXTERNAL_ID,),
    ).fetchall()

    by_key: dict[tuple, dict[str, str]] = {}
    for article, paragraph, label, sha in rows:
        by_key.setdefault((article, paragraph), {})[label] = sha

    changed = {
        key for key, shas in by_key.items()
        if len(shas) == 2 and len(set(shas.values())) == 2
    }
    unchanged = {
        key for key, shas in by_key.items()
        if len(shas) == 2 and len(set(shas.values())) == 1
    }

    assert changed == {("157", "1")}, (
        f"expected only madde 157/1 to change, changed={sorted(changed)}"
    )
    assert ("141", "1") in unchanged and ("168", "1") in unchanged
    # Maddeler after the amendment shift in offset but not in content.
    assert ("158", "1") in unchanged, (
        "a madde after the amended one changed hash — offsets must not"
        " leak into content_sha256"
    )
    assert len(unchanged) == len(by_key) - 1


def test_backdated_append_fails_loudly_instead_of_overlapping(
    dsn, corpus_dir, conn, tmp_path
):
    """An append that commences BEFORE the current text must not publish.

    The close-on-append trigger only closes periods that start earlier than
    the incoming one, so a backdated crawl cannot be reconciled
    automatically — deciding which of two texts was in force on a shared
    day is an editorial call. The EXCLUDE constraint therefore rejects it,
    the publish transaction rolls back, and the run reports a failure
    rather than silently creating an ambiguous temporal record.
    """
    _ingest(dsn, corpus_dir, V1)
    assert len(_versions(conn)) == 1

    payload = json.loads(
        (corpus_dir / V2).read_text(encoding="utf-8")
    )
    payload["dates"]["effective_start"] = "2000-01-01"  # before v1
    payload["_meta"]["version_label"] = "backdated"
    (tmp_path / "backdated.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )

    result = Pipeline(dsn, FixtureSource(tmp_path)).run()

    assert result.published == 0
    assert result.failed == 1
    assert "ExclusionViolation" in (result.outcomes[0].error or ""), (
        result.outcomes[0].error
    )

    rows = _versions(conn)
    assert len(rows) == 1, "the rejected version was left behind"
    assert rows[0][5] == "[2005-06-01,)", (
        f"the surviving version's period was mutated: {rows[0][5]}"
    )
    assert rows[0][3] is True, "the surviving version was wrongly closed"


def test_reingesting_v1_after_v2_reports_reverted_content(dsn, corpus_dir,
                                                          two_versions, conn):
    """Upstream rolling back to an older text is a distinct outcome.

    unique (document_id, content_sha256) makes re-appending the old hash
    impossible, so the pipeline must report it rather than silently
    inserting a duplicate or crashing.
    """
    again = _ingest(dsn, corpus_dir, V1)

    assert again.published == 0
    assert again.reverted == 1
    assert [o.action for o in again.outcomes] == ["reverted_content"]
    assert len(_versions(conn)) == 2, "a duplicate version row was created"
