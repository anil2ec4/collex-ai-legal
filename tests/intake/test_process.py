"""End-to-end intake integration tests against collex_intake_test.

The invariants asserted on chunks are THE SAME ones scripts/db_local_check
enforces on the corpus: code-point offset slice equality (checked in both
Python and SQL) and per-chunk sha256. Tenant isolation is asserted in both
directions: uploads never appear as public documents and the public corpus
is untouched by upload ingest/delete.
"""

from __future__ import annotations

import hashlib
import socket
import time

import pytest

from ingestion.pipeline import Pipeline
from ingestion.ports import FixtureSource
from intake.errors import (
    ExtractionFailedError,
    NotFoundError,
    StoreUnavailableError,
)
from intake.ingest import (
    LOCAL_TENANT_ID,
    UPLOAD_SOURCE,
    delete_file,
    list_files,
    process_file,
    show_file,
)
from tests.intake.pdf_fixtures import mixed_pdf


def _closed_loopback_port() -> int:
    """A port nothing listens on: bind, read the number, release it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

HAPPY_FIXTURES = [
    ("dilekce_ornek.docx", "docx"),
    ("sozlesme_ornek.pdf", "pdf"),
    ("metin_ornek.txt", "txt"),
    ("udf_ornek.udf", "udf"),
]


@pytest.mark.parametrize("filename,kind", HAPPY_FIXTURES)
def test_happy_path_per_format(dsn, conn, uploads_dir, store_dir,
                               filename, kind):
    result = process_file(uploads_dir / filename, dsn, store_dir=store_dir)

    assert result.kind == kind
    assert result.action == "published"
    assert result.upload_action == "created"
    assert result.chars > 0
    assert result.chunk_count > 0
    assert len(result.sha256) == 64
    assert result.file_id == result.sha256[:16]
    body = result.to_json_dict()
    assert body["extraction"]["ocr"] is False
    assert body["action"] == "created"
    assert "message" not in body
    # The analysis contract is ADDITIVE: the four original buckets are always
    # present; W14 B-37 added `referencesAmbiguous` (article numbers with no
    # law behind them, kept visible but never shown as a citation).
    assert {"parties", "references", "dates", "claims"} <= set(body["analysis"])
    assert "referencesAmbiguous" in body["analysis"]
    if kind == "pdf":
        assert body["extraction"]["pages"] == 1
        assert body["pages"] == {
            "pageCount": 1, "pagesWithText": 1, "emptyPages": [],
        }
    else:
        assert "pages" not in body["extraction"]
        assert "pages" not in body

    # Tenant document exists with the local tenant; nothing public leaked.
    row = conn.execute(
        "select d.scope, d.tenant_id::text, d.document_type, d.source"
        " from legal.documents d where d.external_id = %s",
        (result.file_id,),
    ).fetchone()
    assert row == ("tenant", LOCAL_TENANT_ID, "upload", UPLOAD_SOURCE)

    # Chunk invariants, Python AND SQL (db_local_check parity).
    chunk_rows = conn.execute(
        "select c.original_text, c.start_char, c.end_char, c.content_sha256,"
        "       v.canonical_text,"
        "       (c.original_text = substring(v.canonical_text"
        "          from c.start_char + 1 for c.end_char - c.start_char))"
        " from legal.chunks c"
        " join legal.document_versions v on v.id = c.document_version_id"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = %s order by c.ordinal",
        (result.file_id,),
    ).fetchall()
    assert len(chunk_rows) == result.chunk_count
    for original, start, end, sha, canonical, sql_equal in chunk_rows:
        assert canonical[start:end] == original          # Python slice
        assert sql_equal is True                          # SQL substring
        assert hashlib.sha256(
            original.encode("utf-8")
        ).hexdigest() == sha

    # Original stored byte-for-byte under the content hash.
    stored = store_dir / f"{result.sha256}{'.' + kind}"
    assert stored.read_bytes() == (uploads_dir / filename).read_bytes()

    # Embedding jobs enqueued (rows only; no worker locally).
    jobs = conn.execute(
        "select count(*) from app_private.jobs where queue = 'embedding'"
    ).fetchone()[0]
    assert jobs > 0


def test_analysis_finds_planted_signals(dsn, uploads_dir, store_dir):
    result = process_file(
        uploads_dir / "dilekce_ornek.docx", dsn, store_dir=store_dir
    )
    a = result.analysis
    roles = {p["name"]: p.get("role") for p in a["parties"]}
    assert roles.get("Ayşe Yılmaz") == "davacı"
    assert roles.get("Mustafa Kaya") == "davalı"
    assert roles.get("Av. Mehmet Demir") == "vekil"
    assert any(r.get("legislationNo") == "5237" for r in a["references"])
    assert any(r.get("docketNo") == "2021/123" for r in a["references"])
    assert any(d["date"] == "2024-05-12" for d in a["dates"])
    assert any(d["date"] == "2024-06-03" for d in a["dates"])
    assert a["claims"] and all(
        c["source"] == "heuristic" for c in a["claims"]
    )


def test_reupload_same_file_same_id_no_new_version(dsn, conn, uploads_dir,
                                                   store_dir):
    first = process_file(
        uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir
    )
    second = process_file(
        uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir
    )
    assert second.file_id == first.file_id
    assert second.action == "unchanged"
    assert second.chunk_count == first.chunk_count
    assert any("daha önce yüklen" in w for w in second.warnings)
    # The wire says so explicitly (W12-F), in lawyer Turkish.
    body = second.to_json_dict()
    assert body["action"] == "already-existed"
    assert body["message"] == "Bu belge zaten yüklüydü"

    docs, versions, snaps = conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from legal.source_snapshots)"
    ).fetchone()
    assert (docs, versions, snaps) == (1, 1, 1)


def test_reupload_refreshes_analysis_without_rewriting_evidence(
    dsn, conn, uploads_dir, store_dir, monkeypatch
):
    from intake import analysis as analysis_module

    path = uploads_dir / "metin_ornek.txt"
    first = process_file(path, dsn, store_dir=store_dir)
    before = conn.execute(
        "select id, canonical_text, content_sha256, created_at from legal.document_versions"
    ).fetchall()
    chunks = conn.execute("select id, content_sha256 from legal.chunks order by id").fetchall()
    conn.execute(
        "update legal.document_versions set metadata = jsonb_set("
        "metadata, '{fixture_meta,upload,reviewerNote}', '\"korunmalı\"'::jsonb)"
    )
    conn.commit()
    fresh = {"parties": [], "references": [], "dates": [], "claims": [], "revisionProbe": 2}
    monkeypatch.setattr(analysis_module, "analyze", lambda _: (fresh, ["güncel analiz uyarısı"]))
    second = process_file(path, dsn, store_dir=store_dir)
    detail = show_file(dsn, first.file_id)
    assert detail["analysis"] == fresh
    assert "güncel analiz uyarısı" in detail["warnings"]
    assert second.action == "unchanged"
    assert conn.execute(
        "select id, canonical_text, content_sha256, created_at from legal.document_versions"
    ).fetchall() == before
    assert conn.execute("select id, content_sha256 from legal.chunks order by id").fetchall() == chunks
    assert conn.execute(
        "select metadata #>> '{fixture_meta,upload,reviewerNote}' from legal.document_versions"
    ).fetchone()[0] == "korunmalı"


def test_scanned_pdf_fails_closed_typed(dsn, conn, uploads_dir, store_dir):
    with pytest.raises(ExtractionFailedError) as exc:
        process_file(uploads_dir / "taranmis.pdf", dsn, store_dir=store_dir)
    assert exc.value.kind == "EXTRACTION_FAILED"
    assert "taranmış PDF — OCR bu modda devre dışı" in exc.value.warnings
    # Nothing was written anywhere.
    assert conn.execute(
        "select count(*) from legal.documents"
    ).fetchone()[0] == 0
    assert not store_dir.exists() or not list(store_dir.iterdir())


def test_mixed_pdf_is_ingested_with_scanned_pages_reported(dsn, conn, tmp_path,
                                                          store_dir):
    """1 text page + 9 empty pages: the text is stored, the nine empty
    pages are reported in the result, the CLI JSON and the stored metadata
    (so GET /v1/files/{id} can show them) — never silently lost."""
    pdf = tmp_path / "karisik.pdf"
    pdf.write_bytes(mixed_pdf(text_pages=1, empty_pages=9))

    result = process_file(pdf, dsn, store_dir=store_dir)
    assert result.action == "published"
    assert result.pages == 10
    assert result.page_stats is not None
    assert result.page_stats.pages_with_text == 1
    assert "SCANNED_PAGES:9" in result.warnings

    body = result.to_json_dict()
    assert body["pages"] == {
        "pageCount": 10, "pagesWithText": 1,
        "emptyPages": [2, 3, 4, 5, 6, 7, 8, 9, 10],
    }
    assert "SCANNED_PAGES:9" in body["warnings"]

    detail = show_file(dsn, result.file_id)
    assert detail["pages"] == body["pages"]
    listed = next(item for item in list_files(dsn) if item["fileId"] == result.file_id)
    assert listed["pages"] == body["pages"]
    assert listed["sizeBytes"] == result.size_bytes
    assert detail["sizeBytes"] == result.size_bytes
    assert "SCANNED_PAGES:9" in detail["warnings"]

    # Persisted under the version metadata for the TS read store.
    stored = conn.execute(
        "select v.metadata -> 'fixture_meta' -> 'upload' -> 'page_stats'"
        " from legal.document_versions v"
        " join legal.documents d on d.id = v.document_id"
        " where d.external_id = %s",
        (result.file_id,),
    ).fetchone()[0]
    assert stored == body["pages"]


def test_unreachable_database_is_typed_and_bounded(uploads_dir, store_dir):
    """Closed loopback port: the connect must fail within the 5 s connect
    timeout (never the minutes-long TCP retransmit hang) and surface as the
    typed STORE_UNAVAILABLE with its fixed Turkish message."""
    dsn = f"postgres://postgres@127.0.0.1:{_closed_loopback_port()}/collex_intake_test"
    started = time.monotonic()
    with pytest.raises(StoreUnavailableError) as exc:
        process_file(uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir)
    elapsed = time.monotonic() - started
    assert elapsed < 10, f"connect took {elapsed:.1f}s"
    assert exc.value.kind == "STORE_UNAVAILABLE"
    assert exc.value.http_status == 503
    assert exc.value.message == "Yerel veritabanına ulaşılamadı."
    assert exc.value.to_json_dict() == {
        "error": {"kind": "STORE_UNAVAILABLE",
                  "message": "Yerel veritabanına ulaşılamadı."},
    }
    # W14 B-33 (ENGRISK E11): the write order is now original-bytes FIRST,
    # database second, so an unreachable database leaves the ORIGINAL on disk
    # and no database row. That is the deliberately chosen bad state: a
    # re-upload cleans it up completely and nothing is lost. The state this
    # replaces was the dangerous one — a database row with NO original, where
    # re-uploading the same bytes answered "Bu belge zaten yüklüydü" and the
    # user could not recover by doing the right thing.
    orphan = list(store_dir.iterdir()) if store_dir.exists() else []
    assert len(orphan) == 1, f"expected exactly the orphaned original, got {orphan}"
    assert orphan[0].suffix == ".txt"
    # And it is the WHOLE document, byte-exact — never a truncated file whose
    # name is the sha256 of something else.
    source_bytes = (uploads_dir / "metin_ornek.txt").read_bytes()
    assert orphan[0].read_bytes() == source_bytes
    assert (
        hashlib.sha256(source_bytes).hexdigest() == orphan[0].stem
    ), "the stored original's name must be the sha256 of its actual content"
    # No .part litter is left behind by the atomic write.
    assert not list(store_dir.glob("*.part"))

    # list/show/delete take the same bounded, typed path.
    for call in (
        lambda: list_files(dsn),
        lambda: show_file(dsn, "deadbeef00000000"),
        lambda: delete_file(dsn, "deadbeef00000000", store_dir=store_dir),
    ):
        started = time.monotonic()
        with pytest.raises(StoreUnavailableError):
            call()
        assert time.monotonic() - started < 10


def test_list_and_show(dsn, uploads_dir, store_dir):
    result = process_file(
        uploads_dir / "dilekce_ornek.docx", dsn, store_dir=store_dir
    )

    files = list_files(dsn)
    assert len(files) == 1
    entry = files[0]
    assert entry["fileId"] == result.file_id
    assert entry["name"] == "dilekce_ornek.docx"
    assert entry["kind"] == "docx"
    assert entry["sha256"] == result.sha256
    assert entry["chars"] == result.chars
    assert entry["chunkCount"] == result.chunk_count
    assert entry["sizeBytes"] == result.size_bytes
    assert entry["uploadedAt"]

    detail = show_file(dsn, result.file_id)
    assert detail["fileId"] == result.file_id
    assert detail["sizeBytes"] == result.size_bytes
    assert detail["analysis"]["parties"]
    assert len(detail["chunks"]) == result.chunk_count
    for chunk in detail["chunks"]:
        assert len(chunk["preview"]) <= 240
        assert chunk["endChar"] > chunk["startChar"]
        assert set(chunk) == {
            "chunkId", "ordinal", "preview", "startChar", "endChar"
        }


def test_delete_removes_everything(dsn, conn, uploads_dir, store_dir):
    result = process_file(
        uploads_dir / "udf_ornek.udf", dsn, store_dir=store_dir
    )
    stored = store_dir / f"{result.sha256}.udf"
    assert stored.exists()

    outcome = delete_file(dsn, result.file_id, store_dir=store_dir)
    assert outcome["deleted"] == result.file_id

    counts = conn.execute(
        "select"
        " (select count(*) from legal.documents),"
        " (select count(*) from legal.document_versions),"
        " (select count(*) from legal.chunks),"
        " (select count(*) from legal.source_snapshots),"
        " (select count(*) from app_private.jobs where queue = 'embedding')"
    ).fetchone()
    assert counts == (0, 0, 0, 0, 0)
    assert not stored.exists()

    with pytest.raises(NotFoundError):
        show_file(dsn, result.file_id)
    with pytest.raises(NotFoundError):
        delete_file(dsn, result.file_id, store_dir=store_dir)


def test_public_corpus_untouched_by_upload_lifecycle(dsn, conn, corpus_dir,
                                                     uploads_dir, store_dir):
    # Seed one PUBLIC corpus document through the normal pipeline.
    corpus_result = Pipeline(
        dsn, FixtureSource(corpus_dir, include=["kanun_5237_v1.json"])
    ).run()
    assert corpus_result.published == 1

    def snapshot_public():
        return conn.execute(
            "select d.external_id, v.content_sha256,"
            "       (select count(*) from legal.chunks c"
            "         where c.document_version_id = v.id)"
            " from legal.documents d"
            " join legal.document_versions v on v.document_id = d.id"
            " where d.scope = 'public' order by d.external_id"
        ).fetchall()

    before = snapshot_public()
    assert before, "public seed must exist"

    result = process_file(
        uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir
    )
    # Uploads are invisible to the public scope...
    assert conn.execute(
        "select count(*) from legal.documents"
        " where scope = 'public' and source = %s",
        (UPLOAD_SOURCE,),
    ).fetchone()[0] == 0
    # ...and the tenant listing does not include public documents.
    assert [f["fileId"] for f in list_files(dsn)] == [result.file_id]

    delete_file(dsn, result.file_id, store_dir=store_dir)
    assert snapshot_public() == before
