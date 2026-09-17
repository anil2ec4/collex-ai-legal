"""Tenant ingest of quarantined uploads through the EXISTING pipeline.

Reuse, never reinvent: ``process_file`` builds a one-document
``UploadSource`` (an ``ingestion.ports.SourcePort``) and runs the SAME
``ingestion.pipeline.Pipeline`` the fixture corpus uses. That buys, for
free and with the same invariants ``scripts/db_local_check.py`` enforces:

* immutable snapshot with raw sha256 dedupe (``legal.source_snapshots``);
* logical identity ``(tenant_id, source='UPLOAD', external_id)`` where
  ``external_id = sha256(file)[:16]`` — re-uploading identical bytes
  resolves to the SAME document and the SAME fileId;
* append-only version with NFC canonical text + content hash — identical
  text is "unchanged", never a duplicate version;
* paragraph chunks (``structure_hints.kind = 'generic'`` ->
  ``ingestion.chunking.chunk_generic``) with code-point offsets, per-chunk
  sha256 and non-overlap, all validated before SQL and constrained in SQL;
* embedding-job enqueue (rows only; no worker/model call happens locally).

fileId note: the first 16 hex characters of the file's sha256. Deterministic
by content (the re-upload contract) and unique for any realistic local
corpus; a 64-bit prefix collision is accepted for single-user local mode
and would surface loudly as an identity clash, not silently.

Tenancy: everything is written with ``scope='tenant'`` and
``LOCAL_TENANT_ID``. The local connection is the scratch superuser, so RLS
is bypassed — ACCEPTED and documented for single-user local mode.

The original bytes are stored at ``var/uploads/<sha256><ext>`` (``var/`` is
git-ignored), written with ``write_bytes`` so Windows never rewrites line
endings. Signed UDF originals therefore stay byte-for-byte (brief 11.3).
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
import unicodedata
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

import psycopg
from psycopg.types.json import Jsonb

from ingestion import segments as segments_mod
from ingestion.migrations import REPO_ROOT
from ingestion.pipeline import Pipeline, connect_local
from ingestion.ports import DocumentRef, ParsedDocument, RawFetch
from intake import analysis as analysis_mod
from intake import extract, quarantine
from intake.errors import (
    ExtractionFailedError,
    NotFoundError,
    StoreUnavailableError,
)

LOCAL_TENANT_ID = "00000000-0000-0000-0000-000000000001"

UPLOAD_SOURCE = "UPLOAD"
UPLOAD_DOCUMENT_TYPE = "upload"

def resolve_data_dir(env: dict[str, str] | None = None) -> Path:
    """THE data directory, shared with ``control-plane/scripts/serve.mjs``.

    W14 B-34 (ARCH S2). The lawyer's data lives INSIDE the code checkout
    (``<repo>/var``) and the path contains non-ASCII characters, so moving
    the folder breaks the install and changing the checkout risks the data.
    ``COLLEX_DATA_DIR`` is the one knob that separates them, and both
    runtimes read the SAME variable so the pid files, the stop sentinel and
    the upload originals never end up in two different places.

    The DEFAULT deliberately stays ``<repo>/var`` in this wave: flipping it
    to ``%LOCALAPPDATA%\\ColleX\\data`` requires migrating an existing
    installation's originals, and moving a lawyer's only copy of their
    documents is not a side effect of another change. `serve.mjs`
    ``resolveDataDir`` carries the same note.
    """
    import os

    source = os.environ if env is None else env
    configured = (source.get("COLLEX_DATA_DIR") or "").strip()
    return Path(configured).resolve() if configured else REPO_ROOT / "var"


DEFAULT_STORE_DIR = resolve_data_dir() / "uploads"

#: fileId length in hex chars (64-bit sha256 prefix; see module docstring).
FILE_ID_HEX_CHARS = 16

_PREVIEW_CHARS = 240

#: Wire ``action`` of POST /v1/files (additive): a brand-new document vs.
#: identical bytes/text already present (no new version was created).
ACTION_CREATED = "created"
ACTION_ALREADY_EXISTED = "already-existed"

#: Turkish message the API shows for ``already-existed``.
ALREADY_EXISTED_MESSAGE = "Bu belge zaten yüklüydü"

#: R2-34: stored with the document when a re-read of identical text could not
#: re-judge how its pages were read (the stored page map describes other
#: ranges, or this reading produced no page map).
PAGE_STATUS_RESYNC_REFUSED_TR = (
    "Sayfaların okunma durumu yeniden değerlendirilemedi: kayıtlı sayfa eşlemesi"
    " bu okumayla örtüşmüyor. Kayıtlı sayfa durumları değiştirilmedi; dosya"
    " incelemesi bu belgenin sayfalarını eski değerlendirmeyle sayıyor olabilir."
    " Belgenin aslını kontrol edin."
)


@contextmanager
def _store_guard() -> Iterator[None]:
    """Map a dead/unreachable database onto the typed STORE_UNAVAILABLE.

    ``connect_local`` bounds the wait (connect_timeout=5); this turns the
    resulting ``psycopg.OperationalError`` into the fixed-message error the
    CLI prints as ``{"error":{"kind":"STORE_UNAVAILABLE",...}}`` (exit 2).
    The driver text (which can carry the DSN) never reaches the caller.
    """
    try:
        yield
    except psycopg.OperationalError as exc:
        raise StoreUnavailableError() from exc


#: The page-statistics warning local OCR leaves (intake/extract.py).
_OCR_PAGES_WARNING = re.compile(r"OCR_PAGES:[1-9]\d*")


@dataclass(frozen=True)
class IntakeResult:
    """Matches the POST /v1/files 200 body (contract #1) field-for-field."""

    file_id: str
    name: str
    mime: str
    sha256: str
    size_bytes: int
    kind: str
    chars: int
    chunk_count: int
    pages: int | None
    analysis: dict
    warnings: list[str] = field(default_factory=list)
    #: Pipeline action for observability: 'published' | 'unchanged'
    #: | 'reverted_content'. Additive; the wire carries ``upload_action``.
    action: str = "published"
    #: PDF per-page text-layer statistics (additive wire field ``pages``).
    page_stats: extract.PageStats | None = None

    @property
    def used_ocr(self) -> bool:
        """Local OCR read at least one page (``ocrPages`` or ``OCR_PAGES:n``)."""
        if self.page_stats is not None and self.page_stats.ocr_pages:
            return True
        return any(_OCR_PAGES_WARNING.fullmatch(str(w)) for w in self.warnings)

    @property
    def upload_action(self) -> str:
        """'created' for a freshly published document, else
        'already-existed' (identical bytes or identical text seen before)."""
        return (
            ACTION_CREATED if self.action == "published"
            else ACTION_ALREADY_EXISTED
        )

    def to_json_dict(self) -> dict:
        extraction: dict[str, Any] = {
            "chars": self.chars,
            "chunkCount": self.chunk_count,
            # W21 (#29): true when local OCR read at least one page — the same
            # rule the control plane applies (files/store.ts extractionUsedOcr).
            "ocr": self.used_ocr,
        }
        if self.pages is not None:
            extraction["pages"] = self.pages
        body: dict[str, Any] = {
            "fileId": self.file_id,
            "name": self.name,
            "mime": self.mime,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
            "kind": self.kind,
            "extraction": extraction,
            "analysis": self.analysis,
            "warnings": list(self.warnings),
            # Additive (W12-F): explicit created / already-existed.
            "action": self.upload_action,
        }
        if self.upload_action == ACTION_ALREADY_EXISTED:
            body["message"] = ALREADY_EXISTED_MESSAGE
        if self.page_stats is not None:
            # Additive (W12-F): per-page text-layer statistics for PDFs.
            body["pages"] = self.page_stats.to_json_dict()
        return body


class UploadSource:
    """One-document SourcePort over an already-quarantined upload."""

    def __init__(
        self,
        *,
        external_id: str,
        name: str,
        data: bytes,
        mime: str,
        canonical_text: str,
        meta: dict,
        segments: tuple = (),
    ) -> None:
        self._external_id = external_id
        self._name = name
        self._data = data
        self._mime = mime
        self._canonical_text = canonical_text
        self._meta = meta
        #: Source-locator map for ``canonical_text`` (ingestion/locators.py).
        #: Handed to the pipeline through ``structure_hints`` so it is
        #: written in the same transaction as the version and its chunks.
        self._segments = segments

    @property
    def source_name(self) -> str:
        return UPLOAD_SOURCE

    def list_documents(self) -> Iterable[DocumentRef]:
        yield DocumentRef(external_id=self._external_id, locator=self._name)

    def fetch_raw(self, ref: DocumentRef) -> RawFetch:
        return RawFetch(
            ref=ref,
            raw_bytes=self._data,
            retrieved_url=None,
            final_url=None,
            media_type=self._mime,
            http_status=None,
            retrieved_at=datetime.now(timezone.utc),
        )

    def parse(self, fetch: RawFetch) -> ParsedDocument:
        return ParsedDocument(
            source=UPLOAD_SOURCE,
            external_id=self._external_id,
            document_type=UPLOAD_DOCUMENT_TYPE,
            title=self._name,
            retrieved_url=None,
            media_type=self._mime,
            canonical_text=self._canonical_text,
            dates={},
            structure_hints={
                "kind": "generic",
                "segments": [s.to_json_dict() for s in self._segments],
            },
            meta=self._meta,
        )


def _store_original(
    data: bytes, verified: quarantine.VerifiedFile, store_dir: Path
) -> Path:
    """Write the original bytes ATOMICALLY, and repair a short/broken file.

    W14 B-33 (ENGRISK E6/E11) fixed three defects here:

    1. ``write_bytes`` is not atomic. A crash, a full disk or an antivirus
       lock mid-write left a PARTIAL file whose NAME is the sha256 of the
       whole document — the file name lied about its content, which in an
       evidence system is the worst possible failure mode. Now: write to
       ``<sha>.part``, ``fsync``, then ``os.replace`` (atomic on NTFS and
       POSIX alike).
    2. ``if not target.exists()`` treated any existing file as correct, so
       a truncated original was never repaired: re-uploading the same bytes
       (the user's correct instinct) said "already uploaded" and changed
       nothing. Now the size is checked against the verified size and a
       mismatch is rewritten.
    3. See ``process_file``: this runs BEFORE the database publish, not
       after.
    """
    store_dir.mkdir(parents=True, exist_ok=True)
    target = store_dir / f"{verified.sha256}{verified.extension}"
    try:
        intact = target.exists() and target.stat().st_size == verified.size_bytes
    except OSError:
        intact = False
    if intact:
        return target

    # Unique temp name: two concurrent intakes of the SAME document must not
    # write the same .part file (os.replace then makes the last one win, and
    # both wrote identical bytes anyway).
    tmp = store_dir / f"{verified.sha256}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part"
    try:
        with open(tmp, "wb") as handle:
            # No newline translation: the original stays byte-exact.
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    finally:
        # A failed write must not leave .part litter next to the originals.
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
    return target


def process_file(
    path: str | Path,
    dsn: str,
    tenant_id: str = LOCAL_TENANT_ID,
    *,
    store_dir: str | Path | None = None,
) -> IntakeResult:
    """Quarantine, extract, analyze and ingest one uploaded file.

    Raises a typed :class:`intake.errors.IntakeError` on any policy or
    extraction failure; on success the tenant document, its version,
    paragraph chunks and embedding-job rows exist in the database and the
    original bytes are stored under ``store_dir``.
    """
    path = Path(path)
    if not path.is_file():
        raise NotFoundError(f"dosya bulunamadı: {path}")
    data = path.read_bytes()
    name = path.name

    verified = quarantine.verify_upload(name, data)
    outcome = extract.extract_text(verified.kind, data)
    warnings = list(outcome.warnings)

    canonical = unicodedata.normalize("NFC", outcome.text)
    if not canonical.strip():
        raise ExtractionFailedError(
            "çıkarılan metin boş", warnings=warnings
        )

    # The segment ranges were measured against `outcome.text`. The builder
    # normalizes each block first, so this pass is a no-op and the ranges
    # stay valid. If it is ever NOT a no-op the ranges have drifted, and a
    # drifted page map cites the wrong page — so it is dropped, loudly,
    # rather than shipped.
    segments = outcome.segments
    if segments and canonical != outcome.text:
        segments = ()
        warnings.append(
            "sayfa eşlemesi doğrulanamadı; alıntılar sayfa numarası"
            " taşımayacak"
        )

    analysis, analysis_warnings = analysis_mod.analyze(canonical)
    warnings.extend(analysis_warnings)

    file_id = verified.sha256[:FILE_ID_HEX_CHARS]
    page_stats_json = (
        outcome.page_stats.to_json_dict()
        if outcome.page_stats is not None else None
    )
    meta = {
        "scope": "tenant",
        "tenant_id": tenant_id,
        "upload": {
            "name": name,
            "mime": verified.mime,
            "kind": verified.kind,
            "sha256": verified.sha256,
            "size_bytes": verified.size_bytes,
            "pages": outcome.pages,
            # Additive (W14 B-32): the canonical-text length, written ONCE at
            # upload. `GET /v1/files` used to compute `length(v.canonical_text)`
            # per row, and ENGRISK measured that ONE expression as 91% of the
            # query time (148.9 ms -> 12.4 ms over 2 000 documents): PostgreSQL
            # has to pull every document's canonical text out of TOAST storage
            # just to count its characters. Reading it from metadata is the
            # same number without the detoast. The files lane keeps a
            # `coalesce(metadata -> 'upload' ->> 'chars', length(...))`
            # transition path so documents uploaded before this wave still
            # report a length.
            "chars": len(canonical),
            # Additive (W12-F): read back by show_file and the TS store.
            "page_stats": page_stats_json,
            "analysis": analysis,
            "warnings": warnings,
        },
    }

    source = UploadSource(
        external_id=file_id,
        name=name,
        data=data,
        mime=verified.mime,
        canonical_text=canonical,
        meta=meta,
        segments=segments,
    )

    # W14 B-33 (ENGRISK E11): the ORIGINAL BYTES ARE WRITTEN FIRST.
    #
    # It used to be the other way round — publish, then store. Any failure in
    # between (full disk, permission, antivirus lock, hard kill) left the
    # document IN the database with no original on disk: /v1/files listed it,
    # "ask this document" worked, and the original was gone. Worse, uploading
    # the same bytes again — the user's correct instinct — made the pipeline
    # answer `unchanged` and the console say "Bu belge zaten yüklüydü", so the
    # right move could not fix anything either.
    #
    # In this order the bad state is "original on disk, no database row",
    # which a re-upload cleans up completely and which loses nothing.
    resolved_store_dir = Path(store_dir) if store_dir else DEFAULT_STORE_DIR
    _store_original(data, verified, resolved_store_dir)

    with _store_guard():
        result = Pipeline(dsn, source).run()
    assert len(result.outcomes) == 1
    doc_outcome = result.outcomes[0]
    if doc_outcome.action == "failed":
        if doc_outcome.error_type == "OperationalError":
            # The connection died mid-ingest: a store problem, not a
            # document problem — typed 503, driver text withheld.
            raise StoreUnavailableError(warnings=warnings)
        raise ExtractionFailedError(
            f"belge veritabanına alınamadı: {doc_outcome.error}",
            warnings=warnings,
        )

    resynced: segments_mod.SegmentResync | None = None
    if doc_outcome.action == "published":
        chunk_count = doc_outcome.chunks_inserted
    else:
        # unchanged / reverted_content: same bytes (or same text) as an
        # existing version — count the chunks that version already has.
        with _store_guard(), connect_local(dsn) as conn:
            # R2-34: identical text does not mean identical page statuses —
            # the stored page map is re-judged together with the metadata.
            resynced = refresh_derived_fields(
                conn,
                version_id=doc_outcome.version_id,
                tenant_id=tenant_id,
                file_id=file_id,
                canonical=canonical,
                segments=segments,
                analysis=analysis,
                warnings=warnings,
                page_stats_json=page_stats_json,
            )
            row = conn.execute(
                "select count(*) from legal.chunks"
                " where document_version_id = %s",
                (doc_outcome.version_id,),
            ).fetchone()
        chunk_count = int(row[0])
        warnings.append(
            "aynı içerik daha önce yüklenmiş — mevcut belge döndürüldü,"
            " yeni sürüm oluşturulmadı"
        )
        if resynced is not None and resynced.updated:
            # Told once in the response, not stored: the stored statuses and
            # page_stats now say it themselves.
            note = f"{resynced.updated} sayfanın okunma durumu bu okumaya göre güncellendi"
            if resynced.downgraded:
                note += (
                    f"; {resynced.downgraded} sayfa artık tamamı okunmuş sayılmıyor"
                )
            warnings.append(note)

    return IntakeResult(
        file_id=file_id,
        name=name,
        mime=verified.mime,
        sha256=verified.sha256,
        size_bytes=verified.size_bytes,
        kind=verified.kind,
        chars=len(canonical),
        chunk_count=chunk_count,
        pages=outcome.pages,
        analysis=analysis,
        warnings=warnings,
        action=doc_outcome.action,
        page_stats=outcome.page_stats,
    )


def refresh_derived_fields(
    conn: psycopg.Connection,
    *,
    version_id: str,
    tenant_id: str,
    file_id: str,
    canonical: str,
    segments: Iterable,
    analysis: dict,
    warnings: list[str],
    page_stats_json: dict | None,
) -> segments_mod.SegmentResync:
    """Re-derive what a re-read of an EXISTING version's identical text
    changes, in the caller's transaction (R2-34).

    Identical text does not mean identical page statuses: a newer extractor
    can re-judge a page without changing a character (W21 #25: a scan carrying
    only an e-signature footer is SPARSE, no longer EXTRACTED). The file page
    reads ``page_stats`` / ``warnings`` from the version metadata and the
    exhaustive review reads the stored segment rows, so both move to the new
    verdict together — never "sparse" on the file page and "fully read" in the
    review. When the stored page map cannot be re-judged the refusal sentence
    is appended to ``warnings`` (and stored with them).

    Re-analysis is derived metadata, not a new source version: only calculated
    fields are merged; original identity, timestamps, reviewer metadata,
    canonical text and all chunks are preserved.
    """
    resynced = segments_mod.resync_segments(conn, version_id, tuple(segments))
    if resynced.refused:
        warnings.append(PAGE_STATUS_RESYNC_REFUSED_TR)
    conn.execute(
        "update legal.document_versions v set metadata = jsonb_set("
        " v.metadata, '{fixture_meta,upload}',"
        " (v.metadata #> '{fixture_meta,upload}') || %s::jsonb)"
        " from legal.documents d where v.document_id = d.id"
        " and v.id = %s and d.scope = 'tenant' and d.source = %s"
        " and d.tenant_id = %s and d.external_id = %s",
        (Jsonb({
            "analysis": analysis,
            "warnings": warnings,
            "page_stats": page_stats_json,
            "chars": len(canonical),
            "analysis_updated_at": datetime.now(timezone.utc).isoformat(),
        }), version_id, UPLOAD_SOURCE, tenant_id, file_id),
    )
    return resynced


# ---------------------------------------------------------------------------
# list / show / delete over scope='tenant' UPLOAD documents
# ---------------------------------------------------------------------------

_CURRENT_VERSION_JOIN = (
    " from legal.documents d"
    " join legal.document_versions v"
    "   on v.document_id = d.id and upper_inf(v.system_period)"
    " where d.scope = 'tenant' and d.source = %s and d.tenant_id = %s"
)


def _upload_meta(metadata: dict | None) -> dict:
    """The upload block written by process_file (under fixture_meta)."""
    if not metadata:
        return {}
    fixture_meta = metadata.get("fixture_meta") or {}
    return fixture_meta.get("upload") or {}


def list_files(dsn: str, tenant_id: str = LOCAL_TENANT_ID) -> list[dict]:
    """GET /v1/files shape: one row per tenant upload document."""
    with _store_guard(), connect_local(dsn) as conn:
        # One grouped count join instead of a correlated per-row subquery
        # (mirrors control-plane/src/files/store.ts listFiles).
        rows = conn.execute(
            "select d.external_id, d.title, v.created_at,"
            "       length(v.canonical_text), v.metadata,"
            "       coalesce(cc.chunk_count, 0)"
            " from legal.documents d"
            " join legal.document_versions v"
            "   on v.document_id = d.id and upper_inf(v.system_period)"
            " left join (select document_version_id,"
            "                   count(*) as chunk_count"
            "            from legal.chunks group by 1) cc"
            "   on cc.document_version_id = v.id"
            " where d.scope = 'tenant' and d.source = %s"
            "   and d.tenant_id = %s"
            " order by v.created_at, d.external_id",
            (UPLOAD_SOURCE, tenant_id),
        ).fetchall()
    files = []
    for external_id, title, created_at, chars, metadata, chunk_count in rows:
        upload = _upload_meta(metadata)
        entry = {
            "fileId": str(external_id),
            "name": upload.get("name") or title or "",
            "mime": upload.get("mime") or "",
            "sha256": upload.get("sha256") or "",
            "kind": upload.get("kind") or "",
            "uploadedAt": created_at.isoformat(),
            "chars": int(chars),
            "chunkCount": int(chunk_count),
        }
        # Additive parity with the TypeScript files read store: these fields
        # are metadata-only and remain absent for legacy rows that predate
        # the intake measurement.
        if isinstance(upload.get("size_bytes"), int) and upload["size_bytes"] >= 0:
            entry["sizeBytes"] = upload["size_bytes"]
        if isinstance(upload.get("page_stats"), dict):
            entry["pages"] = upload["page_stats"]
        files.append(entry)
    return files


def show_file(
    dsn: str, file_id: str, tenant_id: str = LOCAL_TENANT_ID
) -> dict:
    """GET /v1/files/{id} shape: detail incl. analysis + chunk previews."""
    with _store_guard(), connect_local(dsn) as conn:
        row = conn.execute(
            "select d.external_id, d.title, v.id, v.created_at,"
            "       length(v.canonical_text), v.metadata"
            + _CURRENT_VERSION_JOIN
            + " and d.external_id = %s",
            (UPLOAD_SOURCE, tenant_id, file_id),
        ).fetchone()
        if row is None:
            raise NotFoundError(f"dosya kaydı bulunamadı: {file_id!r}")
        external_id, title, version_id, created_at, chars, metadata = row
        chunk_rows = conn.execute(
            "select id, ordinal, original_text, start_char, end_char"
            " from legal.chunks where document_version_id = %s"
            " order by ordinal",
            (version_id,),
        ).fetchall()

    upload = _upload_meta(metadata)
    chunks = []
    for chunk_id, ordinal, original_text, start_char, end_char in chunk_rows:
        preview = " ".join(original_text.split())
        if len(preview) > _PREVIEW_CHARS:
            preview = preview[: _PREVIEW_CHARS - 1] + "…"
        chunks.append({
            "chunkId": str(chunk_id),
            "ordinal": int(ordinal),
            "preview": preview,
            "startChar": int(start_char),
            "endChar": int(end_char),
        })
    detail: dict[str, Any] = {
        "fileId": str(external_id),
        "name": upload.get("name") or title or "",
        "mime": upload.get("mime") or "",
        "sha256": upload.get("sha256") or "",
        "kind": upload.get("kind") or "",
        "uploadedAt": created_at.isoformat(),
        "chars": int(chars),
        "chunkCount": len(chunks),
        "analysis": upload.get("analysis") or {},
        "warnings": upload.get("warnings") or [],
        "chunks": chunks,
    }
    if isinstance(upload.get("size_bytes"), int) and upload["size_bytes"] >= 0:
        detail["sizeBytes"] = upload["size_bytes"]
    if isinstance(upload.get("page_stats"), dict):
        # Additive (W12-F): PDF per-page text-layer statistics.
        detail["pages"] = upload["page_stats"]
    return detail


def reanalyze_file(
    dsn: str,
    file_id: str,
    tenant_id: str = LOCAL_TENANT_ID,
    *,
    store_dir: str | Path | None = None,
) -> dict:
    """Reprocess verified original bytes, preserving the existing file identity.

    Never accept a client path or process an original whose stored digest no
    longer matches. A private temporary copy closes the hash/read race between
    verification and the normal quarantine/extraction pipeline.
    """
    detail = show_file(dsn, file_id, tenant_id)
    digest = detail["sha256"]
    kind = detail["kind"]
    if (len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)
            or digest[:FILE_ID_HEX_CHARS] != file_id
            or kind not in ("pdf", "docx", "txt", "udf")):
        raise ExtractionFailedError("Belgenin özgün dosya kimliği doğrulanamadı.")
    root = Path(store_dir) if store_dir else DEFAULT_STORE_DIR
    try:
        with (root / f"{digest}.{kind}").open("rb") as source:
            data = source.read(quarantine.MAX_FILE_BYTES + 1)
    except OSError:
        raise NotFoundError("Belgenin özgün dosyası bulunamadı veya okunamadı.") from None
    if len(data) > quarantine.MAX_FILE_BYTES or hashlib.sha256(data).hexdigest() != digest:
        raise ExtractionFailedError("Özgün dosyanın bütünlük kontrolü başarısız; analiz yenilenmedi.")
    with tempfile.TemporaryDirectory(prefix="collex-reanalysis-") as work:
        original_name = Path(detail["name"]).name
        safe_name = original_name if Path(original_name).suffix.lower() == f".{kind}" else f"document.{kind}"
        path = Path(work) / safe_name
        path.write_bytes(data)
        process_file(path, dsn, tenant_id, store_dir=root)
    return show_file(dsn, file_id, tenant_id)


def delete_file(
    dsn: str,
    file_id: str,
    tenant_id: str = LOCAL_TENANT_ID,
    *,
    store_dir: str | Path | None = None,
) -> dict:
    """DELETE /v1/files/{id}: remove doc -> versions -> chunks (FK
    cascade), the version's embedding-job rows, the UPLOAD snapshots and
    the stored original. Raises NotFoundError for an unknown fileId."""
    resolved_store_dir = Path(store_dir) if store_dir else DEFAULT_STORE_DIR
    with _store_guard(), connect_local(dsn) as conn:
        doc = conn.execute(
            "select id from legal.documents"
            " where scope = 'tenant' and source = %s"
            "   and tenant_id = %s and external_id = %s",
            (UPLOAD_SOURCE, tenant_id, file_id),
        ).fetchone()
        if doc is None:
            raise NotFoundError(f"dosya kaydı bulunamadı: {file_id!r}")
        document_id = doc[0]

        version_ids = [
            r[0] for r in conn.execute(
                "select id from legal.document_versions"
                " where document_id = %s",
                (document_id,),
            ).fetchall()
        ]
        # Embedding-job rows for these versions (payload-keyed; the jobs
        # table has no FK to versions by design).
        if version_ids:
            conn.execute(
                "delete from app_private.jobs"
                " where queue = 'embedding'"
                "   and payload->>'document_version_id'"
                "       = any(%s::text[])",
                ([str(v) for v in version_ids],),
            )
        # Snapshot rows carry the original sha256; collect them for stored-
        # file removal. They are deleted AFTER the document: versions
        # reference snapshots with ON DELETE RESTRICT, so the document
        # cascade (versions, chunks, relations) must run first.
        raw_hashes = [
            r[0] for r in conn.execute(
                "select raw_sha256 from legal.source_snapshots"
                " where source = %s and external_id = %s",
                (UPLOAD_SOURCE, file_id),
            ).fetchall()
        ]
        conn.execute(
            "delete from legal.documents where id = %s", (document_id,)
        )
        # Uploads are tenant data: deleting the file must not leave its raw
        # audit copy behind (unlike the public corpus, where snapshots are
        # immutable audit history).
        conn.execute(
            "delete from legal.source_snapshots"
            " where source = %s and external_id = %s",
            (UPLOAD_SOURCE, file_id),
        )
        conn.commit()

    removed_files = []
    for raw_hash in raw_hashes:
        for ext in (".pdf", ".docx", ".txt", ".udf"):
            candidate = resolved_store_dir / f"{raw_hash}{ext}"
            if candidate.exists():
                candidate.unlink()
                removed_files.append(candidate.name)
    return {
        "deleted": file_id,
        "versions": len(version_ids),
        "storedOriginalsRemoved": removed_files,
    }


__all__ = [
    "ACTION_ALREADY_EXISTED",
    "ACTION_CREATED",
    "ALREADY_EXISTED_MESSAGE",
    "DEFAULT_STORE_DIR",
    "resolve_data_dir",
    "IntakeResult",
    "LOCAL_TENANT_ID",
    "UPLOAD_DOCUMENT_TYPE",
    "UPLOAD_SOURCE",
    "UploadSource",
    "delete_file",
    "list_files",
    "process_file",
    "reanalyze_file",
    "refresh_derived_fields",
    "show_file",
]
