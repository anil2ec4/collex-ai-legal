"""(h) Amendment relations: resolved, ambiguous, and never silent.

``legal.document_relations`` is the index the citator retrieval lane reads
(``control-plane/src/store/chunkStore.ts :: citatorLookup``). What it stores
is therefore load-bearing in two opposite directions:

* an edge that is WRONG makes the product assert a change that did not
  happen, with a citation attached;
* an edge that is MISSING makes the product answer "nothing amended this
  provision" when the truth is "we failed to resolve the target".

So the contract these tests pin is not "relations get written". It is:
resolved edges are written with their confidence and resolver identity;
an ambiguous target is written as ambiguous and NEVER promoted to resolved;
and an edge that cannot be stored at all is reported on the run outcome
instead of disappearing.

Everything here is SENTETİK: tiny purpose-built documents in a tmp corpus,
not the fixture corpus, so an assertion cannot pass by memorising a gold
answer.
"""

from __future__ import annotations

import json
from pathlib import Path

from ingestion.pipeline import Pipeline
from ingestion.ports import FixtureSource
from ingestion.relations import RELATION_RESOLVER_VERSION

TARGET_TEXT = (
    "MADDE 5 - (1) Sentetik hedef hükümdür; bu metin gerçek mevzuat "
    "değildir.\n\n"
    "MADDE 6 - (1) İkinci sentetik hedef hükümdür.\n"
)

AMENDING_TEXT = (
    "MADDE 1 - (1) 1111 sayılı Sentetik Hedef Kanunun 5 inci maddesinin "
    "birinci fıkrasında yer alan \"hedef\" ibaresi \"amaç\" şeklinde "
    "değiştirilmiştir.\n\n"
    "MADDE 2 - (1) Bu Kanun yayımı tarihinde yürürlüğe girer.\n"
)


def _write(directory: Path, name: str, payload: dict) -> None:
    payload.setdefault("_meta", {})["synthetic"] = True
    payload["_meta"].setdefault("notice", "SENTETİK TEST VERİSİ")
    payload["_meta"].setdefault("scope", "public")
    (directory / name).write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def _target(external_id: str = "test-kanun-1111",
            legislation_no: str = "1111") -> dict:
    return {
        "source": "fixture-relations",
        "external_id": external_id,
        "document_type": "kanun",
        "title": f"{legislation_no} sayılı Sentetik Hedef Kanun",
        "retrieved_url": "https://example.invalid/fixture/" + external_id,
        "media_type": "application/json",
        "dates": {"publication": "2020-01-01", "effective_start": "2020-01-01"},
        "structure_hints": {"kind": "legislation",
                            "legislation_no": legislation_no},
        "text": TARGET_TEXT,
        "_meta": {"version_label": "v1-20200101"},
    }


def _amending(amendments: list[dict]) -> dict:
    return {
        "source": "fixture-relations",
        "external_id": "test-torba-9001",
        "document_type": "kanun",
        "title": "9001 sayılı Sentetik Değişiklik Kanunu",
        "retrieved_url": "https://example.invalid/fixture/test-torba-9001",
        "media_type": "application/json",
        "dates": {"publication": "2026-01-01",
                  "effective_start": "2026-01-01"},
        "structure_hints": {
            "kind": "legislation",
            "legislation_no": "9001",
            "amendments": amendments,
        },
        "text": AMENDING_TEXT,
        "_meta": {"version_label": "v1-20260101"},
    }


AMENDS_1111_ARTICLE_5 = {
    "changing_article": "1",
    "action": "AMENDS",
    "target_legislation_no": "1111",
    "target_external_id": "test-kanun-1111",
    "target_article": "5",
    "target_paragraph": "1",
}


def _run(dsn: str, directory: Path):
    return Pipeline(dsn, FixtureSource(directory)).run()


def _relations(conn) -> list[tuple]:
    return conn.execute(
        "select r.kind::text, r.resolution_status, r.confidence,"
        "       r.resolver_version,"
        "       r.target_locator ->> 'legislation_no',"
        "       r.target_locator ->> 'article',"
        "       c.article_no, tgt.external_id"
        " from legal.document_relations r"
        " left join legal.chunks c on c.id = r.source_chunk_id"
        " join legal.documents tgt on tgt.id = r.to_document_id"
        " order by 5, 6"
    ).fetchall()


def test_a_resolved_amendment_is_stored_with_its_provenance(dsn, conn,
                                                            tmp_path):
    _write(tmp_path, "a_target.json", _target())
    _write(tmp_path, "b_amending.json", _amending([AMENDS_1111_ARTICLE_5]))

    result = _run(dsn, tmp_path)

    assert result.failed == 0, [(o.external_id, o.error) for o in result.outcomes]
    assert result.total_relations == 1
    assert result.unresolved_relations == []

    rows = _relations(conn)
    assert len(rows) == 1
    kind, status, confidence, resolver, target_no, article, src_article, tgt = rows[0]
    assert (kind, status, target_no, article, tgt) == (
        "AMENDS", "resolved", "1111", "5", "test-kanun-1111",
    )
    # The edge points at the exact passage that made the change, not at the
    # instrument as a whole.
    assert src_article == "1"
    assert resolver == RELATION_RESOLVER_VERSION
    assert confidence is not None and 0 <= float(confidence) <= 1


def test_an_unresolvable_target_is_reported_not_dropped(dsn, conn, tmp_path):
    """The failure mode a citator must never have: a silently missing edge."""
    # No target document is ingested at all, so nothing can be pointed at.
    _write(tmp_path, "b_amending.json", _amending([
        {**AMENDS_1111_ARTICLE_5, "target_external_id": "does-not-exist"},
    ]))

    result = _run(dsn, tmp_path)

    assert result.failed == 0
    assert result.total_relations == 0
    assert _relations(conn) == []

    unresolved = result.unresolved_relations
    assert len(unresolved) == 1, unresolved
    external_id, edge = unresolved[0]
    assert external_id == "test-torba-9001"
    assert edge.action == "AMENDS"
    assert edge.target_legislation_no == "1111"
    assert edge.reason.startswith("NO_LOCAL_TARGET_DOCUMENT:")


def test_an_ambiguous_target_is_stored_as_ambiguous_never_as_resolved(
    dsn, conn, tmp_path
):
    """Two candidates carry the same number: nobody may silently pick one.

    The resolver refuses to select when two candidates sit above the
    threshold within its margin. The edge is still RECORDED — dropping it
    would be the silent-loss failure above — but it is recorded with the
    status that says a human still has to confirm it, and the retrieval lane
    follows only 'resolved' rows.
    """
    _write(tmp_path, "a_target.json", _target())
    _write(tmp_path, "a_target_twin.json",
           _target(external_id="test-kanun-1111-twin"))
    _write(tmp_path, "b_amending.json", _amending([AMENDS_1111_ARTICLE_5]))

    result = _run(dsn, tmp_path)

    assert result.failed == 0
    assert result.total_relations == 1
    rows = _relations(conn)
    assert len(rows) == 1
    _kind, status, confidence, _resolver, _no, _article, _src, target = rows[0]
    assert status == "ambiguous", (
        "a two-candidate number match was promoted to a confirmed edge"
    )
    # Nothing was selected, so no confidence is claimed.
    assert confidence is None
    # It still points at the document the hint named, so a reviewer has
    # something concrete to confirm or reject.
    assert target == "test-kanun-1111"

    # The evidence column keeps the resolver's own account of the decision.
    evidence = conn.execute(
        "select evidence from legal.document_relations"
    ).fetchone()[0]
    assert evidence["resolver_decision"] == "ambiguous"
    assert evidence["structure_hint"]["target_legislation_no"] == "1111"
    assert any("manual" in note.lower() for note in evidence["resolver_notes"])


def test_an_instrument_is_never_a_target_of_its_own_amendment(dsn, conn,
                                                              tmp_path):
    """The classic wrong-changing-id bug, reported rather than stored."""
    _write(tmp_path, "b_amending.json", _amending([
        {**AMENDS_1111_ARTICLE_5,
         "target_legislation_no": "9001",
         "target_external_id": "test-torba-9001"},
    ]))

    result = _run(dsn, tmp_path)

    assert result.total_relations == 0
    assert _relations(conn) == []
    assert [edge.reason for _id, edge in result.unresolved_relations] == [
        "SELF_REFERENCE_SKIPPED",
    ]


def test_an_unsupported_action_is_refused_out_loud(dsn, conn, tmp_path):
    _write(tmp_path, "a_target.json", _target())
    _write(tmp_path, "b_amending.json", _amending([
        {**AMENDS_1111_ARTICLE_5, "action": "MENTIONS"},
    ]))

    result = _run(dsn, tmp_path)

    assert result.total_relations == 0
    assert [edge.reason for _id, edge in result.unresolved_relations] == [
        "UNSUPPORTED_ACTION:MENTIONS",
    ]


def test_relations_are_derived_data_and_never_accumulate(dsn, conn, tmp_path):
    _write(tmp_path, "a_target.json", _target())
    _write(tmp_path, "b_amending.json", _amending([AMENDS_1111_ARTICLE_5]))

    _run(dsn, tmp_path)
    before = conn.execute(
        "select count(*) from legal.document_relations"
    ).fetchone()[0]
    _run(dsn, tmp_path)
    _run(dsn, tmp_path)
    after = conn.execute(
        "select count(*) from legal.document_relations"
    ).fetchone()[0]

    assert before == 1
    assert after == 1, "re-ingesting duplicated a derived edge"


def test_a_document_with_no_amendment_hints_writes_no_relations(dsn, conn,
                                                                tmp_path):
    _write(tmp_path, "a_target.json", _target())

    result = _run(dsn, tmp_path)

    assert result.total_relations == 0
    assert result.unresolved_relations == []
    assert _relations(conn) == []
