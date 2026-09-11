"""Born-digital text extraction per verified kind (NO OCR — fail closed).

* PDF   — pypdf, born-digital text layer only, judged PER PAGE: a page
          whose extracted text (stripped) is shorter than
          ``PDF_MIN_CHARS_PER_PAGE`` has no usable text layer.
          - NO page has text -> the file is a scanned PDF and extraction
            FAILS CLOSED with a typed EXTRACTION_FAILED carrying the
            warning "taranmış PDF — OCR bu modda devre dışı".
          - SOME pages have text (a mixed scan) -> the text pages are
            ingested and the empty ones are reported LOUDLY: the outcome
            carries ``page_stats`` (pageCount / pagesWithText /
            emptyPages) and two warnings — the machine code
            ``SCANNED_PAGES:<n>`` (console dictionary key) and a Turkish
            sentence naming the page numbers. A page that carries no
            text is never silently absent from the evidence.
          The OCR lane (MISTRAL_API_KEY, brief 11.2 with its quality
          gates) is OUT OF SCOPE for local intake v1.
          Known limit (documented, not hidden): a scan whose every page
          carries a real text header (>= PDF_MIN_CHARS_PER_PAGE) passes
          this gate; only the header text is indexed.
* DOCX  — python-docx: paragraphs AND tables, in document order
          (``Document.iter_inner_content``). Table rows are flattened to
          "cell | cell | cell" lines. python-docx parses with lxml, whose
          default parser does not load external DTDs and has
          ``no_network=True``; the archive itself has already passed
          intake/quarantine.py.
* TXT   — UTF-8 first (BOM tolerated via utf-8-sig); on failure falls back
          to windows-1254 (Turkish latin-5) WITH a warning naming the
          assumption.
* UDF   — read-only (brief 11.3): the zip's ``content.xml`` is parsed with
          defusedxml.ElementTree (DTD/entity/external refs refused) and the
          ``<content>`` element's text (CDATA in real files) is taken; when
          no ``<content>`` element exists, all text nodes are used. UDF is
          NEVER written, re-serialized or modified here.

The extracted text keeps paragraph structure as blank-line-separated blocks
so the generic paragraph chunker (ingestion/chunking.py::chunk_generic)
produces one chunk per paragraph with exact code-point offsets.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from intake.errors import ExtractionFailedError
from intake.ocr import LOW_CONFIDENCE, OcrPageResult, OcrProvider, resolve_ocr_provider
from ingestion.locators import (
    SegmentInput,
    SourceSegment,
    build_segmented_canonical,
)

PDF_MIN_CHARS_PER_PAGE = 10
# A warning threshold, never a reason to discard short but meaningful text.
PDF_SPARSE_CHARS_PER_PAGE = 50

#: Page ceiling for ONE upload (W14 B-33; ENGRISK E17).
#:
#: There was no page limit at all while ``ai/ocr.ts`` has had one (100) for
#: the same work. pypdf extracts text at roughly 50-100 ms per born-digital
#: page, so a 3 000-page scan ran 150-300 s, blew the 180 s
#: ``INTAKE_EXEC_TIMEOUT_MS`` budget and answered ``504 UPLOAD_TIMEOUT``
#: after three minutes — information the lawyer could have had in two
#: seconds. The page count is read from the PDF header BEFORE any text is
#: extracted, so refusal is immediate.
#:
#: 600 rather than OCR's 100: a full case file printed to one PDF genuinely
#: runs to several hundred pages, and 600 born-digital pages fit inside the
#: budget (~30-60 s) with the batched indexer. Above that the honest answer
#: is "split the document", not a three-minute hang.
PDF_MAX_PAGES = 600

SCANNED_PDF_WARNING = "taranmış PDF — OCR bu modda devre dışı"

#: Machine warning code for a MIXED PDF (some pages without a text layer).
#: Wire form: ``SCANNED_PAGES:<empty page count>``. The console translates
#: the code; the Turkish sentence built by ``scanned_pages_warning`` travels
#: alongside it for readers without the dictionary (CLI text mode).
SCANNED_PAGES_CODE = "SCANNED_PAGES"

#: How many page numbers the Turkish sentence lists before "…".
_SCANNED_PAGES_LISTED = 15

_MULTI_BLANK_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class PageStats:
    """Per-page text-layer statistics of a PDF (additive wire field
    ``pages`` on the intake result and GET /v1/files/{id})."""

    page_count: int
    pages_with_text: int
    #: 1-based page numbers whose text layer is missing/too short.
    empty_pages: tuple[int, ...]
    sparse_pages: tuple[int, ...] = ()

    def to_json_dict(self) -> dict:
        result = {
            "pageCount": self.page_count,
            "pagesWithText": self.pages_with_text,
            "emptyPages": list(self.empty_pages),
        }
        if self.sparse_pages:
            result["sparsePages"] = list(self.sparse_pages)
        return result


def scanned_pages_warning(stats: PageStats) -> str:
    """Turkish sentence for a mixed PDF: which pages carry no text layer."""
    listed = ", ".join(str(p) for p in stats.empty_pages[:_SCANNED_PAGES_LISTED])
    if len(stats.empty_pages) > _SCANNED_PAGES_LISTED:
        listed += ", …"
    return (
        f"{len(stats.empty_pages)} / {stats.page_count} sayfada metin katmanı"
        f" yok (taranmış olabilir): sayfa {listed} — bu sayfalar dizine"
        " alınmadı; OCR bu modda devre dışı"
    )


@dataclass
class ExtractionOutcome:
    """Extracted text with page count, warnings and the source-locator map.

    ``text`` is NFC-normalized whenever ``segments`` is non-empty, because
    the segment builder normalizes each block before measuring its range
    (``ingestion/locators.py``); ``intake/ingest.py`` normalizes again and that
    second pass is then a no-op. Extractors that do not (yet) produce
    segments still return the historical pre-NFC ``_tidy`` string.
    """

    text: str
    pages: int | None = None
    warnings: list[str] = field(default_factory=list)
    #: PDF only: per-page text-layer statistics (None for other kinds).
    page_stats: PageStats | None = None
    #: Additive: where each block of ``text`` came from in the ORIGINAL file
    #: (physical page for PDF, structural locator otherwise). Empty when the
    #: locator builder could not verify the map — never a guessed map.
    segments: tuple[SourceSegment, ...] = ()


def _tidy(blocks: list[str]) -> str:
    """Join non-empty blocks with blank lines; normalize newlines."""
    cleaned: list[str] = []
    for block in blocks:
        block = block.replace("\r\n", "\n").replace("\r", "\n")
        block = _MULTI_BLANK_RE.sub("\n\n", block).strip()
        if block:
            cleaned.append(block)
    return "\n\n".join(cleaned)


#: Sentinel: resolve the OCR provider from the environment (COLLEX_OCR).
_DETECT: object = object()


def extract_pdf(data: bytes, ocr: OcrProvider | None | object = _DETECT) -> ExtractionOutcome:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ExtractionFailedError("şifreli PDF desteklenmiyor")
        pages = len(reader.pages)
        # B-33: refuse BEFORE extracting a single page. Reading the page
        # count costs milliseconds; extracting 3 000 pages costs minutes and
        # ends in a 504 that tells the lawyer nothing useful.
        if pages > PDF_MAX_PAGES:
            raise ExtractionFailedError(
                f"Belge {pages} sayfa; en fazla {PDF_MAX_PAGES} sayfa"
                " işlenebilir — belgeyi bölün."
            )
        page_texts = [(page.extract_text() or "") for page in reader.pages]
    except ExtractionFailedError:
        raise
    except Exception as exc:  # pypdf raises a zoo of parse errors
        raise ExtractionFailedError(
            f"PDF ayrıştırılamadı: {type(exc).__name__}: {exc}"
        ) from exc

    if pages == 0:
        raise ExtractionFailedError("PDF sayfa içermiyor")

    # W20 phase 10: pages with NO text layer go through the local OCR
    # boundary when a local engine exists. The recognized text is placed in
    # the page's OWN slot below (same page number, extraction_method 'ocr'),
    # so provenance stays "s. N" of the original PDF. A page OCR cannot read
    # stays UNREADABLE; with no engine at all nothing changes.
    provider = resolve_ocr_provider() if ocr is _DETECT else ocr
    ocr_results: dict[int, OcrPageResult] = {}
    ocr_failed: list[int] = []
    if provider is not None:
        for index, text in enumerate(page_texts):
            if text.strip():
                continue
            try:
                result = provider.ocr_page(data, index)
            except Exception:  # noqa: BLE001 - one page never sinks the file
                ocr_failed.append(index + 1)
                continue
            if result.text.strip():
                ocr_results[index] = result
            else:
                ocr_failed.append(index + 1)

    total_chars = sum(len(t.strip()) for t in page_texts)
    empty_pages = tuple(
        index + 1
        for index, text in enumerate(page_texts)
        if len(text.strip()) < PDF_MIN_CHARS_PER_PAGE
    )
    stats = PageStats(
        page_count=pages,
        pages_with_text=pages - len(empty_pages),
        empty_pages=empty_pages,
        sparse_pages=tuple(index + 1 for index, text in enumerate(page_texts)
                           if PDF_MIN_CHARS_PER_PAGE <= len(text.strip()) < PDF_SPARSE_CHARS_PER_PAGE),
    )
    if stats.pages_with_text == 0 and not ocr_results:
        # Fail closed: this is (most likely) a scanned PDF and this mode
        # has no OCR. Never pretend an empty text layer is the document.
        raise ExtractionFailedError(
            "PDF metin katmanı yok denecek kadar az"
            f" (~{total_chars} karakter / {pages} sayfa);"
            f" {SCANNED_PDF_WARNING}",
            warnings=[SCANNED_PDF_WARNING],
        )
    warnings: list[str] = []
    if stats.sparse_pages:
        listed = ", ".join(str(p) for p in stats.sparse_pages[:_SCANNED_PAGES_LISTED])
        if len(stats.sparse_pages) > _SCANNED_PAGES_LISTED:
            listed += ", …"
        warnings.append(
            f"{len(stats.sparse_pages)} sayfada çok az metin çıkarıldı (sayfa {listed}); "
            "yalnız başlık veya sayfa numarası okunmuş olabilir. Bu sayfaların "
            "tamamının okunduğu doğrulanmadı; aslını kontrol edin. Çıkarılan kısa "
            "metin korundu, görüntü içeriğine OCR uygulanmadı."
        )
    # Pages that neither the text layer nor local OCR could read.
    unread = tuple(p for p in empty_pages if (p - 1) not in ocr_results)
    if unread:
        # Mixed scan: ingest what has a text layer, say exactly what has
        # not. Machine code first (console dictionary), then the sentence.
        warnings.append(f"{SCANNED_PAGES_CODE}:{len(unread)}")
        if ocr_results or ocr_failed:
            listed = ", ".join(str(p) for p in unread[:_SCANNED_PAGES_LISTED])
            warnings.append(
                f"{len(unread)} sayfa ne metin katmanıyla ne yerel OCR ile okunabildi"
                f" (sayfa {listed}); bu sayfalar okunmamış sayılır."
            )
        else:
            warnings.append(scanned_pages_warning(stats))
    if ocr_results:
        read = sorted(index + 1 for index in ocr_results)
        listed = ", ".join(str(p) for p in read[:_SCANNED_PAGES_LISTED])
        warnings.append(f"OCR_PAGES:{len(read)}")
        warnings.append(
            f"{len(read)} sayfa yerel OCR ile okundu (sayfa {listed}); OCR metni"
            " hata içerebilir, alıntıları belgenin aslıyla karşılaştırın."
        )
    if ocr_failed:
        warnings.append(f"OCR_FAILED_PAGES:{len(ocr_failed)}")
    # Build the canonical text and the page map in ONE pass, so every
    # code-point range in the result can name the physical page it came
    # from. The per-page status is decided by THIS lane's thresholds (the
    # same ones that produced `stats`), not re-derived by the builder.
    empty_set = set(stats.empty_pages)
    sparse_set = set(stats.sparse_pages)
    blocks = [
        _ocr_block(index, ocr_results[index])
        if index in ocr_results
        else SegmentInput(
            locator_kind="page",
            locator_label=str(index + 1),
            text=text,
            # The status must agree with what the page CONTRIBUTED, or the
            # ledger contradicts itself: a page below the 10-character gate
            # can still carry a few characters (a printed folio such as
            # "- 2 -"), and those characters ARE in the canonical text and
            # ARE citable. Calling that page UNREADABLE while a quote cites
            # it is the one thing the locator ledger must never do. So an
            # EMPTY page is UNREADABLE and a nearly-empty one is SPARSE:
            # counted as read, never as verified.
            extraction_method=(
                "none" if not text.strip() else "pdf_text_layer"
            ),
            extraction_status=(
                "UNREADABLE"
                if not text.strip()
                else "SPARSE"
                if (index + 1) in empty_set or (index + 1) in sparse_set
                else "EXTRACTED"
            ),
            ordinal=index + 1,
        )
        for index, text in enumerate(page_texts)
    ]
    canonical, segments = build_segmented_canonical(blocks)
    if not segments:
        # The builder refused to certify the map. Say so instead of
        # shipping page numbers nobody verified.
        warnings.append(
            "sayfa eşlemesi çıkarılamadı; alıntılar sayfa numarası"
            " taşımayacak"
        )
    return ExtractionOutcome(
        text=canonical, pages=pages, warnings=warnings,
        page_stats=stats, segments=segments,
    )


def _ocr_block(index: int, result: OcrPageResult) -> SegmentInput:
    """A page read by local OCR, in its own page slot."""
    stripped = result.text.strip()
    unsure = (
        (result.confidence is not None and result.confidence < LOW_CONFIDENCE)
        or len(stripped) < PDF_SPARSE_CHARS_PER_PAGE
    )
    return SegmentInput(
        locator_kind="page",
        locator_label=str(index + 1),
        text=result.text,
        extraction_method="ocr",
        # Low confidence: counted as read, never as verified (SPARSE).
        extraction_status="SPARSE" if unsure else "EXTRACTED",
        ordinal=index + 1,
        confidence=result.confidence,
    )


def extract_docx(data: bytes) -> ExtractionOutcome:
    import docx  # python-docx (the [intake] extra)
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        document = docx.Document(io.BytesIO(data))
        blocks: list[SegmentInput] = []
        for index, item in enumerate(document.iter_inner_content()):
            if isinstance(item, Paragraph):
                blocks.append(
                    SegmentInput(
                        locator_kind="paragraph",
                        locator_label=str(index + 1),
                        text=item.text,
                        extraction_method="docx_paragraph",
                        ordinal=index + 1,
                    )
                )
            elif isinstance(item, Table):
                rows = []
                for row in item.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        rows.append(" | ".join(cells))
                blocks.append(
                    SegmentInput(
                        locator_kind="paragraph",
                        locator_label=str(index + 1),
                        text="\n".join(rows),
                        extraction_method="docx_table",
                        ordinal=index + 1,
                    )
                )
    except Exception as exc:
        raise ExtractionFailedError(
            f"DOCX ayrıştırılamadı: {type(exc).__name__}: {exc}"
        ) from exc
    # A DOCX has NO stable physical pages until it is rendered, so the
    # locator is the structural one it really has (paragraph/table ordinal).
    # Inventing a page number here would be a fabricated citation.
    canonical, segments = build_segmented_canonical(blocks)
    return ExtractionOutcome(text=canonical, segments=segments)


def extract_txt(data: bytes) -> ExtractionOutcome:
    warnings: list[str] = []
    try:
        # utf-8-sig strips a BOM when present and is plain UTF-8 otherwise.
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("windows-1254")
        except UnicodeDecodeError as exc:
            raise ExtractionFailedError(
                "metin dosyası ne UTF-8 ne windows-1254 olarak çözülebildi"
            ) from exc
        warnings.append(
            "karakter kodlaması windows-1254 (Türkçe latin-5) VARSAYILDI —"
            " dosya UTF-8 değil"
        )
    # A flat text file has no pages and no reliable internal structure: the
    # honest locator is the whole document as one block.
    canonical, segments = build_segmented_canonical(
        [SegmentInput("block", "1", text, "plain_text", ordinal=1)]
    )
    return ExtractionOutcome(text=canonical, warnings=warnings, segments=segments)


def extract_udf(data: bytes) -> ExtractionOutcome:
    # DTD, entity expansion and external references are refused by
    # defusedxml (DTDForbidden/EntitiesForbidden/ExternalReferenceForbidden)
    # rather than merely unfetched — see the module docstring.
    from defusedxml import ElementTree as SafeET

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        content_name = next(
            (n for n in zf.namelist()
             if PurePosixPath(n).name == "content.xml"),
            None,
        )
        if content_name is None:
            raise ExtractionFailedError("UDF içinde content.xml bulunamadı")
        root = SafeET.fromstring(zf.read(content_name))
    except ExtractionFailedError:
        raise
    except Exception as exc:
        raise ExtractionFailedError(
            f"UDF ayrıştırılamadı: {type(exc).__name__}: {exc}"
        ) from exc

    def _local(tag: object) -> str:
        return str(tag).rsplit("}", 1)[-1].lower()

    content_elems = [
        el for el in root.iter() if _local(el.tag) == "content"
    ]
    if content_elems:
        raw = "\n\n".join(
            "".join(el.itertext()) for el in content_elems
        )
    else:
        raw = "".join(root.itertext())
    if not raw.strip():
        raise ExtractionFailedError("UDF content.xml metin içermiyor")
    canonical, segments = build_segmented_canonical(
        [SegmentInput("block", "1", raw, "udf_xml", ordinal=1)]
    )
    return ExtractionOutcome(text=canonical, segments=segments)


_EXTRACTORS = {
    "pdf": extract_pdf,
    "docx": extract_docx,
    "txt": extract_txt,
    "udf": extract_udf,
}


def extract_text(kind: str, data: bytes, ocr: OcrProvider | None | object = _DETECT) -> ExtractionOutcome:
    """Dispatch to the extractor for a quarantine-verified kind.

    ``ocr`` only matters for PDFs: the default resolves a LOCAL engine from
    the environment (none on a machine without one); ``None`` disables it.
    """
    outcome = extract_pdf(data, ocr) if kind == "pdf" else _EXTRACTORS[kind](data)
    if not outcome.text.strip():
        raise ExtractionFailedError(
            f"{kind} dosyasından metin çıkarılamadı (boş içerik)",
            warnings=outcome.warnings,
        )
    return outcome
