import pytest

from intake import ingest
from intake.errors import ExtractionFailedError, NotFoundError


def refresh(*args, **kwargs):
    fn = getattr(ingest, "reanalyze_file", None)
    assert callable(fn), "Stored files need a reanalysis operation"
    return fn(*args, **kwargs)


def test_refresh_uses_stored_original_and_preserves_identity(dsn, conn, uploads_dir, store_dir, monkeypatch):
    first = ingest.process_file(uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir)
    fresh = {"parties": [], "references": [], "dates": [], "claims": [], "revision": 2}
    monkeypatch.setattr(ingest.analysis_mod, "analyze", lambda _: (fresh, []))
    result = refresh(dsn, first.file_id, store_dir=store_dir)
    assert result["fileId"] == first.file_id
    assert result["name"] == first.name
    assert result["sha256"] == first.sha256
    assert result["analysis"] == fresh
    assert conn.execute("select count(*) from legal.document_versions").fetchone()[0] == 1


def test_refresh_refuses_changed_original_without_publishing(dsn, conn, uploads_dir, store_dir):
    first = ingest.process_file(uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir)
    original = store_dir / f"{first.sha256}.txt"
    original.write_bytes(b"changed text that must never become a new upload")
    with pytest.raises(ExtractionFailedError, match="bütünlük"):
        refresh(dsn, first.file_id, store_dir=store_dir)
    assert conn.execute("select count(*) from legal.documents").fetchone()[0] == 1
    assert original.read_bytes() == b"changed text that must never become a new upload"


def test_refresh_cannot_read_another_tenants_original(dsn, uploads_dir, store_dir):
    first = ingest.process_file(uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir)
    with pytest.raises(NotFoundError):
        refresh(dsn, first.file_id, "00000000-0000-0000-0000-000000000002", store_dir=store_dir)


def test_refresh_missing_original_is_explicit(dsn, uploads_dir, store_dir):
    first = ingest.process_file(uploads_dir / "metin_ornek.txt", dsn, store_dir=store_dir)
    (store_dir / f"{first.sha256}.txt").unlink()
    with pytest.raises(NotFoundError, match="özgün"):
        refresh(dsn, first.file_id, store_dir=store_dir)
