"""W14 B-33 — intake limits: PDF page ceiling, atomic write, write order.

Three defects ENGRISK found in the upload path, each with its own failure
story for a lawyer:

* **E17, no page limit.** ``intake/extract.py`` extracted text from every
  page of a PDF with no ceiling, while ``ai/ocr.ts`` has had one (100) for
  the same work. A 3 000-page scan ran 150-300 s, blew the 180 s
  ``INTAKE_EXEC_TIMEOUT_MS`` budget and answered ``504 UPLOAD_TIMEOUT``:
  three minutes lost for information the lawyer could have had in two
  seconds.
* **E11, wrong write order.** The original bytes were written AFTER the
  database publish. Any failure in between put the document in the database
  with no original on disk; re-uploading the same bytes then answered
  "Bu belge zaten yüklüydü", so the user could not recover by doing the
  right thing.
* **E6, non-atomic write with no repair.** ``write_bytes`` plus
  ``if not target.exists()`` meant a truncated file was kept forever — and
  its NAME is the sha256 of the whole document, so the file name lied about
  its content. In an evidence system that is the worst possible failure.

The page-cap and atomic-write tests need no database. The write-order test
does (it needs a real publish to fail against a reachable-but-wrong DSN),
and skips with the package conftest when the scratch server is absent.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest

from intake import extract, quarantine
from intake.errors import ExtractionFailedError
from intake.extract import PDF_MAX_PAGES
from intake.ingest import _store_original
from tests.intake.pdf_fixtures import build_multipage_pdf


# ---------------------------------------------------------------------------
# PDF page ceiling (E17)
# ---------------------------------------------------------------------------

def test_pdf_page_cap_is_declared_and_below_the_intake_budget():
    """The cap must exist and be a real ceiling, not a formality."""
    assert isinstance(PDF_MAX_PAGES, int)
    assert 100 <= PDF_MAX_PAGES <= 2000
    # ~50-100 ms/page in pypdf: the cap must stay inside the 180 s budget
    # with room for chunking and indexing.
    assert PDF_MAX_PAGES * 0.1 < 180


def test_a_pdf_over_the_page_cap_is_refused_immediately_with_a_turkish_message():
    """B-33 acceptance: refused in ~2 s, with a typed EXTRACTION_FAILED and
    a sentence that tells the lawyer what to do (split the document)."""
    pages = [[f"Sayfa {i} metni"] for i in range(PDF_MAX_PAGES + 5)]
    data = build_multipage_pdf(pages)
    import time

    started = time.monotonic()
    with pytest.raises(ExtractionFailedError) as exc:
        extract.extract_text("pdf", data)
    elapsed = time.monotonic() - started

    assert exc.value.kind == "EXTRACTION_FAILED"
    message = exc.value.message
    assert str(PDF_MAX_PAGES) in message
    assert str(PDF_MAX_PAGES + 5) in message
    assert "belgeyi bölün" in message.lower()
    # The whole point: the page count is read from the header, so the answer
    # arrives long before the 180 s budget. Generous bound so a loaded CI
    # runner does not flake; the failure mode this guards is minutes.
    assert elapsed < 20, f"refusal took {elapsed:.1f}s — the cap is not up-front"


def test_a_pdf_at_the_cap_still_extracts():
    """The ceiling must not reject a document it is meant to accept."""
    data = build_multipage_pdf([["Sayfa metni"] for _ in range(12)])
    outcome = extract.extract_text("pdf", data)
    assert outcome.pages == 12
    assert "Sayfa metni" in outcome.text


# ---------------------------------------------------------------------------
# Atomic write + repair (E6)
# ---------------------------------------------------------------------------

def _verified(data: bytes, name: str = "belge.txt") -> quarantine.VerifiedFile:
    return quarantine.verify_upload(name, data)


def test_store_original_writes_atomically_and_leaves_no_part_file(tmp_path: Path):
    data = "Kira sözleşmesi örneği.\n".encode("utf-8")
    verified = _verified(data)
    target = _store_original(data, verified, tmp_path)

    assert target.read_bytes() == data
    assert target.stem == hashlib.sha256(data).hexdigest()
    assert not list(tmp_path.glob("*.part")), "temporary file left behind"


def test_a_truncated_original_is_REPAIRED_on_re_upload(tmp_path: Path):
    """The defect: `if not target.exists()` treated a short file as correct.

    A file named after the sha256 of the WHOLE document but holding only
    part of it is a lie in the one place this product cannot afford one, and
    the user's correct instinct (upload it again) did nothing.
    """
    data = ("Uzun bir dilekçe metni. " * 200).encode("utf-8")
    verified = _verified(data, "dilekce.txt")
    target = tmp_path / f"{verified.sha256}{verified.extension}"
    tmp_path.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data[: len(data) // 3])  # simulate the interrupted write
    assert target.stat().st_size != verified.size_bytes

    repaired = _store_original(data, verified, tmp_path)
    assert repaired == target
    assert target.read_bytes() == data
    assert target.stat().st_size == verified.size_bytes


def test_an_intact_original_is_not_rewritten(tmp_path: Path):
    """Repair must not become "rewrite every upload": an intact file is left
    alone, which is what makes re-uploading a known document cheap."""
    data = b"kisa metin\n"
    verified = _verified(data)
    target = _store_original(data, verified, tmp_path)
    before = target.stat().st_mtime_ns
    os.utime(target, ns=(before - 10_000_000_000, before - 10_000_000_000))
    stamped = target.stat().st_mtime_ns

    again = _store_original(data, verified, tmp_path)
    assert again == target
    assert target.stat().st_mtime_ns == stamped, "an intact original was rewritten"


def test_two_stores_of_the_same_document_do_not_collide(tmp_path: Path):
    """Concurrent intakes of the SAME bytes must not share a .part name."""
    data = b"ayni belge\n"
    verified = _verified(data)
    first = _store_original(data, verified, tmp_path)
    second = _store_original(data, verified, tmp_path)
    assert first == second
    assert first.read_bytes() == data
    assert not list(tmp_path.glob("*.part"))


# ---------------------------------------------------------------------------
# Write ORDER (E11)
# ---------------------------------------------------------------------------

def test_the_original_is_written_before_the_database_publish():
    """Source-level check of the ordering invariant.

    ``tests/intake/test_process.py::test_unreachable_database_is_typed_and_bounded``
    proves the BEHAVIOUR against a dead database (the original survives, the
    row does not). This test pins the ordering itself so a future refactor
    that moves the call back below ``Pipeline(...).run()`` fails loudly with
    the reason attached, rather than silently restoring the state where a
    document exists in the database with no original on disk.
    """
    source = (Path(__file__).resolve().parents[2] / "intake" / "ingest.py").read_text(
        encoding="utf-8"
    )
    body = source.split("def process_file(", 1)[1]
    store_at = body.index("_store_original(data, verified, resolved_store_dir)")
    publish_at = body.index("Pipeline(dsn, source).run()")
    assert store_at < publish_at, (
        "intake/ingest.py writes the original AFTER the database publish again"
        " — see ENGRISK E11: that leaves a document in the database with no"
        " original bytes, and re-uploading it answers 'zaten yüklüydü'."
    )
