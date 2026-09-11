"""Source ports: where raw documents come from.

``SourcePort`` is the contract the pipeline consumes:

    list_documents() -> iterable of DocumentRef  (discover)
    fetch_raw(ref)   -> RawFetch                 (raw bytes + fetch metadata)
    parse(fetch)     -> ParsedDocument           (canonical text + hints)

``FixtureSource`` reads the synthetic corpus under
``evals/fixtures/corpus/`` (JSON files, schema: source, external_id,
document_type, title, retrieved_url, media_type, text,
dates{decision/publication/effective_start}, structure_hints, _meta).
It yields EVERY file — several files may describe successive versions of
one logical document, and they are yielded in commencement order. The only
way to ingest a subset is ``include``, which the caller states explicitly.

``BedestenSource`` is a typed SKELETON against the canonical Bedesten
legislation client (``mevzuat_bedesten_client.BedestenClient``). It is
LIVE-UNTESTED and raises ``NotImplementedError`` — see its docstring.
"""

from __future__ import annotations

import fnmatch
import json
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, Protocol, Sequence

if TYPE_CHECKING:  # pragma: no cover - typing only, no runtime import cost
    from mevzuat_bedesten_client import BedestenClient


@dataclass(frozen=True)
class DocumentRef:
    """One discoverable document within a source."""

    external_id: str
    locator: str  # file path (fixtures) or upstream id/url (live sources)


@dataclass(frozen=True)
class RawFetch:
    """Raw bytes of one fetch, with the metadata the snapshot table needs."""

    ref: DocumentRef
    raw_bytes: bytes
    retrieved_url: str | None
    final_url: str | None
    media_type: str | None
    http_status: int | None
    retrieved_at: datetime


@dataclass(frozen=True)
class ParsedDocument:
    """Parsed/normalized document ready for identity + versioning.

    ``canonical_text`` is ALWAYS NFC-normalized; all chunk offsets index
    into it in Unicode code points (Python str semantics == PostgreSQL
    character semantics under UTF-8).
    """

    source: str
    external_id: str
    document_type: str
    title: str | None
    retrieved_url: str | None
    media_type: str | None
    canonical_text: str
    dates: dict[str, Any] = field(default_factory=dict)
    structure_hints: dict[str, Any] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def scope(self) -> str:
        return str(self.meta.get("scope", "public"))

    @property
    def tenant_id(self) -> str | None:
        value = self.meta.get("tenant_id")
        return str(value) if value else None

    @property
    def version_label(self) -> str | None:
        value = self.meta.get("version_label")
        return str(value) if value else None


class SourcePort(Protocol):
    """Contract every source adapter satisfies (brief 6.9: discover/fetch)."""

    @property
    def source_name(self) -> str: ...

    def list_documents(self) -> Iterable[DocumentRef]: ...

    def fetch_raw(self, ref: DocumentRef) -> RawFetch: ...

    def parse(self, fetch: RawFetch) -> ParsedDocument: ...


class FixtureSource:
    """Reads the synthetic JSON corpus from a directory.

    ``include`` restricts discovery to the given filename glob patterns
    (e.g. ``["kanun_5237_v2.json"]``). That is the ONLY way a file in the
    directory is not ingested, and the caller names it explicitly.

    EVERY VERSION IS INGESTED, IN COMMENCEMENT ORDER (fixed 2026-08-27).
    ------------------------------------------------------------------
    This class used to dedupe files sharing a ``(source, external_id)``
    to the lexicographically FIRST filename, so one pass over
    ``evals/fixtures/corpus`` ingested ``kanun_5237_v1.json`` and SILENTLY
    SKIPPED ``kanun_5237_v2.json``. Callers that wanted the second version
    had to know to run a second pass naming the file — and a caller that
    did not know got a corpus missing a version, with nothing in the run
    report saying so. A silent skip in an ingestion pipeline is a
    correctness hazard well past fixtures: "the document is not in the
    index" and "the document was dropped during discovery" look identical
    downstream.

    Discovery now yields every file. Files that share a logical identity
    are yielded together, ordered by COMMENCEMENT (``dates.effective_start``,
    then ``dates.publication``, then filename), because that is the order in
    which the version machinery can append them: appending a version closes
    the previous one's open ``effective_period`` at the new commencement
    date, and the ``document_versions_effective_no_overlap`` EXCLUDE
    constraint rejects a backdated append outright (see
    ingestion/versioning.py and tests/ingestion/test_versioning.py). An
    undated version sorts first, since "no commencement recorded" cannot be
    placed after a dated one.

    Groups keep the order in which their first file appears, so adding a
    second version of one document does not reshuffle the rest of the run.
    """

    def __init__(
        self,
        corpus_dir: Path | str,
        include: Sequence[str] | None = None,
    ) -> None:
        self.corpus_dir = Path(corpus_dir)
        self.include = tuple(include) if include else None

    @property
    def source_name(self) -> str:
        return "fixture-corpus"

    def _files(self) -> list[Path]:
        files = sorted(self.corpus_dir.glob("*.json"))
        if self.include is not None:
            files = [
                f for f in files
                if any(fnmatch.fnmatch(f.name, pat) for pat in self.include)
            ]
        return files

    @staticmethod
    def _commencement(obj: dict[str, Any]) -> str:
        """Sort key for one file's place in its document's history."""
        dates = obj.get("dates") or {}
        for key in ("effective_start", "publication", "decision"):
            value = dates.get(key)
            if value:
                return str(value)
        return ""  # undated: cannot be placed after a dated version

    def list_documents(self) -> Iterable[DocumentRef]:
        groups: dict[tuple[str, str], list[tuple[str, str, Path]]] = {}
        order: list[tuple[str, str]] = []
        for path in self._files():
            obj = json.loads(path.read_text(encoding="utf-8"))
            key = (str(obj["source"]), str(obj["external_id"]))
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append((self._commencement(obj), path.name, path))

        for key in order:
            for _commencement, _name, path in sorted(groups[key]):
                yield DocumentRef(external_id=key[1], locator=str(path))

    def fetch_raw(self, ref: DocumentRef) -> RawFetch:
        path = Path(ref.locator)
        raw = path.read_bytes()
        obj = json.loads(raw.decode("utf-8"))
        url = obj.get("retrieved_url")
        return RawFetch(
            ref=ref,
            raw_bytes=raw,
            retrieved_url=url,
            final_url=url,
            media_type=obj.get("media_type"),
            http_status=200,
            retrieved_at=datetime.now(timezone.utc),
        )

    def parse(self, fetch: RawFetch) -> ParsedDocument:
        obj = json.loads(fetch.raw_bytes.decode("utf-8"))
        canonical = unicodedata.normalize("NFC", str(obj["text"]))
        return ParsedDocument(
            source=str(obj["source"]),
            external_id=str(obj["external_id"]),
            document_type=str(obj["document_type"]),
            title=obj.get("title"),
            retrieved_url=obj.get("retrieved_url"),
            media_type=obj.get("media_type"),
            canonical_text=canonical,
            dates=dict(obj.get("dates") or {}),
            structure_hints=dict(obj.get("structure_hints") or {}),
            meta=dict(obj.get("_meta") or {}),
        )


class BedestenSource:
    """SKELETON adapter over the canonical Bedesten legislation client.

    STATUS: LIVE-UNTESTED. This class exists so the pipeline's SourcePort
    seam is demonstrably satisfiable by the real upstream client
    (``mevzuat_bedesten_client.BedestenClient``) without this lane making
    any network call. Every method raises ``NotImplementedError`` until a
    live-integration lane wires and verifies it against the real API
    (respecting the shared process-wide Bedesten rate limiter and the
    single-worker constraint documented in CLAUDE.md).

    Intended mapping (kept in sync with the client's current signatures):

    * ``list_documents``  -> ``BedestenClient.search_documents(...)``
      pages, yielding one ``DocumentRef`` per ``mevzuatId``.
    * ``fetch_raw``       -> ``BedestenClient.get_document_content(
      mevzuat_id)`` raw payload bytes (base64 HTML decoded upstream),
      hashed as-is for snapshot dedupe.
    * ``parse``           -> markdown/plain-text extraction +
      ``unicodedata.normalize('NFC', ...)`` into ``ParsedDocument`` with
      ``structure_hints={'kind': 'legislation', 'legislation_no': ...}``.

    The client is async; a worker should drive it with ``asyncio.run`` (or
    a shared event loop), never per-chunk. The constructor takes an
    optional pre-built client for dependency injection in future tests.
    """

    def __init__(
        self,
        client: "BedestenClient | None" = None,
        mevzuat_ids: Sequence[str] = (),
    ) -> None:
        if client is None:
            # Deferred import: importing ingestion.ports must not pull the
            # httpx/rate-limiter stack unless a Bedesten source is built.
            from mevzuat_bedesten_client import BedestenClient as _Client
            client = _Client()
        self._client = client
        self._mevzuat_ids = tuple(mevzuat_ids)

    @property
    def source_name(self) -> str:
        return "bedesten-mevzuat"

    def list_documents(self) -> Iterable[DocumentRef]:
        raise NotImplementedError(
            "BedestenSource is a live-untested skeleton; discovery via "
            "BedestenClient.search_documents is not wired in this lane."
        )

    def fetch_raw(self, ref: DocumentRef) -> RawFetch:
        raise NotImplementedError(
            "BedestenSource is a live-untested skeleton; fetching via "
            "BedestenClient.get_document_content is not wired in this lane."
        )

    def parse(self, fetch: RawFetch) -> ParsedDocument:
        raise NotImplementedError(
            "BedestenSource is a live-untested skeleton; Bedesten payload "
            "parsing is not wired in this lane."
        )
