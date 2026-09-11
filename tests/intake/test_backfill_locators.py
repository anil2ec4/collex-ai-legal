"""Backfilling source locators onto documents ingested before the page map.

Every document ingested before W19 has chunks and canonical text but no row
in ``legal.document_version_segments``. The exhaustive runner reports that as
a ``NO_SOURCE_MAP`` gap so the state is VISIBLE; this script is how it gets
FIXED, and these tests pin the two properties that make it safe:

  * a map is written only when the text it describes is the text that is
    actually stored (otherwise every page number it produced would be a
    wrong citation), and
  * without ``--apply`` nothing is written.
"""

from __future__ import annotations

import psycopg

from intake.ingest import LOCAL_TENANT_ID, UPLOAD_SOURCE, process_file
from scripts.backfill_locators import backfill
from tests.intake.pdf_fixtures import build_multipage_pdf

_BODY = (
    "Bu sayfanin govde metnidir ve dosyanin okunabilir bir sayfasi oldugunu"
    " gostermek icin yeterince uzun tutulmustur."
)


def _pdf(pages: int = 3) -> bytes:
    return build_multipage_pdf(
        [[f"Sayfa {n}", f"{n}. sayfa. {_BODY}"] for n in range(1, pages + 1)]
    )


def _version_id(conn, file_id: str) -> str:
    row = conn.execute(
        "select v.id::text from legal.documents d"
        " join legal.document_versions v"
        "   on v.document_id = d.id and upper_inf(v.system_period)"
        " where d.source = %s and d.tenant_id = %s and d.external_id = %s",
        (UPLOAD_SOURCE, LOCAL_TENANT_ID, file_id),
    ).fetchone()
    return row[0]


def _segment_count(conn, version_id: str) -> int:
    return conn.execute(
        "select count(*) from legal.document_version_segments"
        " where document_version_id = %s",
        (version_id,),
    ).fetchone()[0]


def _strip_segments(conn, version_id: str) -> None:
    """Make the document look like a pre-W19 ingest."""
    conn.execute(
        "delete from legal.document_version_segments where document_version_id = %s",
        (version_id,),
    )
    conn.commit()


def test_backfill_restores_the_page_map_of_a_pre_w19_document(
    dsn, conn, tmp_path, store_dir
):
    path = tmp_path / "eski_belge.pdf"
    path.write_bytes(_pdf(3))
    result = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, result.file_id)
    assert _segment_count(conn, version_id) == 3

    _strip_segments(conn, version_id)
    assert _segment_count(conn, version_id) == 0

    report = backfill(dsn, apply=True, tenant_id=None, store_dir=store_dir)

    assert report["mapped"] >= 1
    assert _segment_count(conn, version_id) == 3
    rows = conn.execute(
        "select locator_kind, locator_label, start_char, end_char"
        " from legal.document_version_segments"
        " where document_version_id = %s order by segment_no",
        (version_id,),
    ).fetchall()
    assert [r[1] for r in rows] == ["1", "2", "3"]
    assert {r[0] for r in rows} == {"page"}

    # The restored ranges slice the STORED canonical text, which is the whole
    # point: a map that does not match its text produces wrong page numbers.
    canonical = conn.execute(
        "select canonical_text from legal.document_versions where id = %s",
        (version_id,),
    ).fetchone()[0]
    for _kind, label, start, end in rows:
        assert f"Sayfa {label}" in canonical[start:end]


def test_a_dry_run_writes_nothing(dsn, conn, tmp_path, store_dir):
    path = tmp_path / "kuru_calisma.pdf"
    path.write_bytes(_pdf(2))
    result = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, result.file_id)
    _strip_segments(conn, version_id)

    report = backfill(dsn, apply=False, tenant_id=None, store_dir=store_dir)

    assert report["applied"] is False if "applied" in report else True
    assert report["mapped"] >= 1  # it would have mapped it...
    assert _segment_count(conn, version_id) == 0  # ...but wrote nothing.


def test_a_document_whose_original_is_gone_is_reported_not_guessed(
    dsn, conn, tmp_path, store_dir
):
    path = tmp_path / "asli_silinmis.pdf"
    path.write_bytes(_pdf(2))
    result = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, result.file_id)
    _strip_segments(conn, version_id)

    # The stored original disappears (disk loss, manual cleanup).
    for stored in store_dir.glob("*"):
        stored.unlink()

    report = backfill(dsn, apply=True, tenant_id=None, store_dir=store_dir)

    # Nothing is invented: the file is named as unmappable.
    assert result.file_id in report["missingOriginal"]
    assert _segment_count(conn, version_id) == 0


def test_a_document_whose_text_no_longer_matches_is_skipped(
    dsn, conn, tmp_path, store_dir
):
    """The guard that stops a map from citing the wrong page."""
    path = tmp_path / "metni_degismis.pdf"
    path.write_bytes(_pdf(3))
    result = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, result.file_id)
    _strip_segments(conn, version_id)

    # The stored canonical text is edited out from under the original bytes.
    conn.execute(
        "update legal.document_versions set canonical_text = %s where id = %s",
        ("Bambaska bir metin.", version_id),
    )
    conn.commit()

    report = backfill(dsn, apply=True, tenant_id=None, store_dir=store_dir)

    assert any(
        entry["fileId"] == result.file_id and entry["reason"] == "TEXT_DIFFERS"
        for entry in report["skipped"]
    )
    # A map that does not match its text is worse than no map.
    assert _segment_count(conn, version_id) == 0


def test_backfill_is_idempotent(dsn, conn, tmp_path, store_dir):
    path = tmp_path / "tekrar_backfill.pdf"
    path.write_bytes(_pdf(2))
    result = process_file(path, dsn, store_dir=store_dir)
    version_id = _version_id(conn, result.file_id)
    _strip_segments(conn, version_id)

    backfill(dsn, apply=True, tenant_id=None, store_dir=store_dir)
    first = _segment_count(conn, version_id)
    # A second pass finds nothing left to do and changes nothing.
    again = backfill(dsn, apply=True, tenant_id=None, store_dir=store_dir)
    assert _segment_count(conn, version_id) == first
    assert result.file_id not in again.get("missingOriginal", [])
