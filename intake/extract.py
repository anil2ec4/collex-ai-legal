"""Text extraction per verified kind (local OCR only when detected; fail closed).

* PDF   — pypdf, born-digital text layer only, judged PER PAGE: a page
          whose extracted text (stripped) is shorter than
          ``PDF_MIN_CHARS_PER_PAGE`` has no usable text layer.
          - NO page has text (and local OCR, when present, read nothing)
            -> the file is a scanned PDF and extraction FAILS CLOSED with a
            typed EXTRACTION_FAILED whose warning says WHY (W21): "taranmış
            PDF — OCR bu modda devre dışı" only when there is no local OCR;
            when OCR ran and failed on every page it says so instead.
          - SOME pages have text (a mixed scan) -> the text pages are
            ingested and the empty ones are reported LOUDLY: the outcome
            carries ``page_stats`` (pageCount / pagesWithText /
            emptyPages) and two warnings — the machine code
            ``SCANNED_PAGES:<n>`` (console dictionary key) and a Turkish
            sentence naming the page numbers. A page that carries no
            text is never silently absent from the evidence.
          The OCR lane (MISTRAL_API_KEY, brief 11.2 with its quality
          gates) is OUT OF SCOPE for local intake v1.
          - An IMAGE-BACKED page (its drawn images together cover at least
            ``PDF_IMAGE_PAGE_MIN_COVERAGE`` of the page — one full-page scan
            or a scan cut into strips or tiles) whose text layer is
            short (< ``PDF_IMAGE_PAGE_TEXT_CHARS``) — a scan carrying only a
            stamp or an e-signature footer — is NOT a read page (W21 #25):
            it goes to local OCR when one exists and is otherwise recorded
            SPARSE with an ``IMAGE_TEXT_PAGES:<n>`` warning, so no review
            can call the file completely read on its strength. Before W21
            such a page was EXTRACTED and only the stamp was indexed.
          - R2-32: OCR only ADDS to an image-backed page's exact text layer.
            An OCR line that is an exact copy of text-layer words, or a near
            copy anchored by at least three exact words (a misreading), is
            dropped. A line that only NEARLY matches a text-layer value with
            weaker anchoring (a lone date, amount or "ESAS NO : 2024/128") is
            WITHHELD: a misread copy and a distinct value look the same, so it
            is neither added (citable) nor silently lost — the page is SPARSE
            with an ``OCR_WITHHELD_LINES_PAGES:<n>`` warning. A text-layer word
            another OCR line already re-read cannot be re-read twice, so a
            distinct "11.03.2024" next to a re-read footer's "12.03.2024" is
            kept. When OCR finds nothing beyond the text layer the page stays a
            text-layer page, SPARSE + ``IMAGE_TEXT_PAGES``: that echo never
            vouches for the image (a faint scan whose OCR re-read only its
            footer looks the same), and the sentence never calls the page a scan.
          - R2-33: a page local OCR read with low confidence or only a few
            characters is SPARSE AND listed in ``sparse_pages``, with an
            ``OCR_LOW_CONFIDENCE_PAGES:<n>`` warning whose sentence names the
            cause per page (low confidence, a few characters, or a few
            characters beyond a short text layer).
          - Local OCR has ONE time budget per file (``OCR_TOTAL_BUDGET_S``,
            W21 #30); pages it did not reach stay unread and are reported
            with ``OCR_BUDGET_EXCEEDED:<n>``.
          - ``page_stats`` are computed AFTER OCR (W21 #29): ``emptyPages``
            lists only pages nothing read, ``ocrPages`` the pages local OCR
            read.
          - A fail-closed scanned PDF carries one bare machine code in its
            warnings (CD1): ``SCANNED_PDF_NO_OCR``, ``SCANNED_PDF_OCR_FAILED``
            or ``SCANNED_PDF_OCR_NOT_APPLIED``.
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

import inspect
import io
import re
import time
import unicodedata
import zipfile
from collections import Counter
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Callable

from intake.errors import ExtractionFailedError
from intake.ocr import (
    LOW_CONFIDENCE,
    OCR_MIN_PAGE_S,
    OCR_TOTAL_BUDGET_S,
    PAGE_TIMEOUT_S,
    OcrPageResult,
    OcrProvider,
    resolve_ocr_provider,
    sigterm_stops_ocr,
)
from ingestion.locators import (
    SegmentInput,
    SourceSegment,
    build_segmented_canonical,
)

PDF_MIN_CHARS_PER_PAGE = 10
# A warning threshold, never a reason to discard short but meaningful text.
PDF_SPARSE_CHARS_PER_PAGE = 50
#: W21 (#25): an image-backed page (a scan) with fewer text-layer characters
#: than this has NOT been read by its text layer — the body is in the image.
#: A born-digital page of body text runs well past this; a scanner's stamp,
#: a Bates number or an e-signature verification footer does not.
PDF_IMAGE_PAGE_TEXT_CHARS = 400
#: Share of the page area the drawn images must cover TOGETHER for the page
#: to count as image-backed (a scan), rather than a page with a logo or a
#: signature. Summed, not the largest single image: a scanner that writes a
#: page as strips or tiles (or MRC regions) draws no single image this large.
PDF_IMAGE_PAGE_MIN_COVERAGE = 0.5

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
#: W21: the same fail-closed outcome when local OCR WAS available. Saying
#: "OCR is disabled" there hid the real cause (OCR ran and read nothing).
SCANNED_PDF_OCR_FAILED_WARNING = (
    "taranmış PDF — yerel OCR denendi ama hiçbir sayfa okunamadı"
)
#: Local OCR was available but no page qualified for it (every page carries
#: a few characters of text layer, e.g. only a page number), so it did not run.
SCANNED_PDF_OCR_NOT_APPLIED_WARNING = (
    "taranmış PDF — sayfalarda çok az metin var; yerel OCR bu sayfalara uygulanmadı"
)
#: W21 #30: local OCR ran out of its time budget before it read any page.
SCANNED_PDF_OCR_BUDGET_WARNING = (
    "taranmış PDF — yerel OCR süre sınırı içinde hiçbir sayfayı okuyamadı"
)

#: CD1: ONE bare machine code per fail-closed cause, carried in the same
#: ``warnings`` array as the Turkish sentence, so the console switches on a
#: code instead of matching prose. NO_OCR: no local provider (or OCR off);
#: OCR_FAILED: local OCR tried and read nothing (or ran out of time);
#: OCR_NOT_APPLIED: every page has only a tiny text layer, so OCR never ran.
SCANNED_PDF_NO_OCR_CODE = "SCANNED_PDF_NO_OCR"
SCANNED_PDF_OCR_FAILED_CODE = "SCANNED_PDF_OCR_FAILED"
SCANNED_PDF_OCR_NOT_APPLIED_CODE = "SCANNED_PDF_OCR_NOT_APPLIED"
#: W21 #30: ``OCR_BUDGET_EXCEEDED:<n>`` — n pages the OCR budget did not reach.
OCR_BUDGET_EXCEEDED_CODE = "OCR_BUDGET_EXCEEDED"
#: W21 #25: ``IMAGE_TEXT_PAGES:<n>`` — n image-backed pages of which only a
#: short text layer was read.
IMAGE_TEXT_PAGES_CODE = "IMAGE_TEXT_PAGES"
#: R2-33: ``OCR_LOW_CONFIDENCE_PAGES:<n>`` — n pages local OCR read with low
#: confidence or only a few characters (SPARSE; listed in ``sparsePages``).
OCR_LOW_CONFIDENCE_PAGES_CODE = "OCR_LOW_CONFIDENCE_PAGES"

#: R2-32: ``OCR_WITHHELD_LINES_PAGES:<n>`` — n pages where OCR lines
#: that nearly match a text-layer value were neither added nor dropped
#: silently (SPARSE; listed in ``sparsePages``).
OCR_WITHHELD_LINES_PAGES_CODE = "OCR_WITHHELD_LINES_PAGES"

#: R2-32: an OCR word may be a misreading of a text-layer word when both are
#: at least this long and nearly equal (one misread digit or letter:
#: 12.08.2024 for 12.03.2024). Words that fold to the same string are equal.
_FUZZY_WORD_MIN_CHARS = 4
_FUZZY_WORD_MIN_RATIO = 0.8
#: Share of an OCR line's words that must match the text layer, in order and
#: within a window about the line's length, for the line to be a (near) copy.
_OCR_COPY_MIN_SHARE = 0.8
#: A near copy is dropped silently only when at least this many of its words
#: match EXACTLY and near-matched words are at most half the exact ones: then
#: the line's own words show it re-reads that text-layer line. With fewer
#: anchors ("ESAS NO : 2024/128" against "2024/123", a lone date) a misread
#: copy cannot be told from a distinct value, so the line is withheld.
_COPY_MIN_EXACT_WORDS = 3
#: How many withheld lines the warning quotes, and how long each quote is.
_WITHHELD_QUOTED = 3
_WITHHELD_QUOTE_CHARS = 40
#: A word: letters/digits, joined by inner punctuation (dates, amounts, codes).
_WORD_RE = re.compile(r"\w+(?:[.,:/-]\w+)*")

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
    #: Pages that contributed text (text layer OR local OCR).
    pages_with_text: int
    #: 1-based page numbers NOTHING read: the text layer is missing/too short
    #: and local OCR did not read them either (W21 #29: a page OCR read is
    #: listed in ``ocr_pages``, never here).
    empty_pages: tuple[int, ...]
    #: Pages read only in part: a sparse text layer; (W21 #25) an image-backed
    #: page of which only a short text layer was read and whose image nothing
    #: verified; (R2-33) a page local OCR read with low confidence or only a
    #: few characters; or (R2-32) a page local OCR read whose near-copy lines
    #: were withheld — such an OCR page is ALSO listed in ``ocr_pages``.
    sparse_pages: tuple[int, ...] = ()
    #: 1-based page numbers local OCR read (wire ``ocrPages``).
    ocr_pages: tuple[int, ...] = ()

    def to_json_dict(self) -> dict:
        result = {
            "pageCount": self.page_count,
            "pagesWithText": self.pages_with_text,
            "emptyPages": list(self.empty_pages),
        }
        if self.sparse_pages:
            result["sparsePages"] = list(self.sparse_pages)
        if self.ocr_pages:
            result["ocrPages"] = list(self.ocr_pages)
        return result


def scanned_pages_warning(stats: PageStats, *, ocr_available: bool = False) -> str:
    """Turkish sentence for a mixed PDF: which pages carry no text layer.

    ``ocr_available`` (W21): when a local OCR engine existed but these pages
    were not sent to it, the sentence must not claim OCR is disabled.
    """
    listed = ", ".join(str(p) for p in stats.empty_pages[:_SCANNED_PAGES_LISTED])
    if len(stats.empty_pages) > _SCANNED_PAGES_LISTED:
        listed += ", …"
    tail = "yerel OCR bu sayfalara uygulanmadı" if ocr_available else "OCR bu modda devre dışı"
    return (
        f"{len(stats.empty_pages)} / {stats.page_count} sayfada metin katmanı"
        f" yok (taranmış olabilir): sayfa {listed} — bu sayfalar dizine"
        f" alınmadı; {tail}"
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


def extract_pdf(
    data: bytes,
    ocr: OcrProvider | None | object = _DETECT,
    *,
    ocr_budget_s: float = OCR_TOTAL_BUDGET_S,
    clock: Callable[[], float] = time.monotonic,
) -> ExtractionOutcome:
    """Extract a PDF page by page (see the module docstring).

    ``ocr_budget_s`` is the time ALL local OCR of this file may take (W21
    #30); ``clock`` is injectable so the budget can be tested without sleeping.
    """
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

    stripped_len = [len(t.strip()) for t in page_texts]
    # W21 (#25): a scanned page whose text layer holds only a stamp or an
    # e-signature footer is NOT a read page — its body is in the image. Only
    # pages with a SHORT, non-empty text layer are examined (empty pages go to
    # OCR anyway; long text layers are real body text), which keeps the extra
    # content-stream pass off the born-digital bulk of a 600-page file.
    image_backed: set[int] = {
        index
        for index, length in enumerate(stripped_len)
        if 0 < length < PDF_IMAGE_PAGE_TEXT_CHARS
        and _page_image_coverage(reader.pages[index], reader) >= PDF_IMAGE_PAGE_MIN_COVERAGE
    }

    # W20 phase 10: pages with NO text layer — and, W21, image-backed pages
    # with only a short text layer — go through the local OCR boundary when
    # a local engine exists. The recognized text is placed in the page's OWN
    # slot below (same page number, extraction_method 'ocr'), so provenance
    # stays "s. N" of the original PDF. A page OCR cannot read (or that the
    # time budget did not reach) is never counted as read.
    provider = resolve_ocr_provider() if ocr is _DETECT else ocr
    candidates = [
        index for index, length in enumerate(stripped_len)
        if length == 0 or index in image_backed
    ]
    ocr_results, ocr_failed, ocr_skipped = _run_local_ocr(
        provider, data, candidates, budget_s=ocr_budget_s, clock=clock
    )

    # R2-32: OCR may only ADD to an image-backed page's exact text layer.
    # Tesseract reads the RENDERED page, so it re-reads visible text too — a
    # born-digital page over a letterhead or watermark image, a signature
    # footer, the short page of a searchable scan — misreadings included. A
    # second, garbled copy of the same sentence would be citable, and a
    # misread amount found only in that copy would pass as a unique quote.
    # Lines that re-read the text layer are dropped. A line that only NEARLY
    # matches a text-layer value without enough exact words around it cannot
    # be told apart from a distinct value (a lone "11.03.2024" next to a
    # footer's "12.03.2024"), so it is withheld and the page is never counted
    # as fully read. A page where OCR found nothing beyond its text layer (an
    # "echo") stays a text-layer page.
    ocr_texts: dict[int, str] = {}
    ocr_echo: dict[int, OcrPageResult] = {}
    withheld: dict[int, tuple[str, ...]] = {}
    for index in sorted(ocr_results):
        split = _split_ocr_lines(page_texts[index], ocr_results[index].text)
        if split.withheld:
            withheld[index] = split.withheld
        if split.added is None:
            ocr_echo[index] = ocr_results.pop(index)
        else:
            ocr_texts[index] = split.added
    # An echo never vouches for the page image, however confident and however
    # long the text layer: a faint or handwritten scan whose OCR re-read only
    # a crisp e-signature footer (UYAP footers run past 200 characters) looks
    # exactly like a short born-digital page over a letterhead image. Both
    # stay SPARSE below.

    # Page statistics AFTER OCR (W21 #29): a page local OCR read is not an
    # empty page any more — reporting it as "no text, cannot be quoted" would
    # contradict the page's own OCR segment.
    empty_pages = tuple(
        index + 1
        for index, length in enumerate(stripped_len)
        if length < PDF_MIN_CHARS_PER_PAGE and index not in ocr_results
    )
    text_sparse = tuple(
        index + 1
        for index, length in enumerate(stripped_len)
        if PDF_MIN_CHARS_PER_PAGE <= length < PDF_SPARSE_CHARS_PER_PAGE
        and index not in ocr_results
        and index not in ocr_echo
    )
    # Image-backed pages whose short text layer is all that was read and
    # whose image nothing verified: OCR absent, failed, out of time, or an
    # OCR echo (R2-32). Pages under the 10-character gate are already listed
    # as empty.
    image_unverified = tuple(
        index + 1
        for index in sorted(image_backed)
        if stripped_len[index] >= PDF_MIN_CHARS_PER_PAGE
        and index not in ocr_results
    )
    # R2-33: pages local OCR read with low confidence or barely at all are
    # counted as read, never as fully read — in the statistics too.
    ocr_unsure = tuple(
        index + 1
        for index in sorted(ocr_results)
        if _ocr_unsure(ocr_results[index], ocr_texts[index])
    )
    # R2-32: an OCR page with withheld near-copy lines is read in part only.
    ocr_withheld = tuple(index + 1 for index in sorted(ocr_results) if index in withheld)
    stats = PageStats(
        page_count=pages,
        pages_with_text=pages - len(empty_pages),
        empty_pages=empty_pages,
        sparse_pages=tuple(sorted(
            set(text_sparse) | set(image_unverified) | set(ocr_unsure) | set(ocr_withheld)
        )),
        ocr_pages=tuple(sorted(index + 1 for index in ocr_results)),
    )
    if stats.pages_with_text == 0:
        # Fail closed: this is (most likely) a scanned PDF and nothing read
        # it. Never pretend an empty text layer is the document. W21: the
        # warning names the actual cause — "OCR disabled" is only true when
        # there was no local provider at all — and carries ONE bare machine
        # code (CD1) so the console never has to match Turkish prose.
        total_chars = sum(stripped_len)
        if provider is None:
            reason, code = SCANNED_PDF_WARNING, SCANNED_PDF_NO_OCR_CODE
        elif ocr_failed or ocr_echo:
            # R2-32: OCR that found nothing beyond a few text-layer
            # characters read no page either; it was not "not applied".
            reason, code = SCANNED_PDF_OCR_FAILED_WARNING, SCANNED_PDF_OCR_FAILED_CODE
        elif ocr_skipped:
            # OCR ran out of time before it read any page.
            reason, code = SCANNED_PDF_OCR_BUDGET_WARNING, SCANNED_PDF_OCR_FAILED_CODE
        else:
            reason, code = SCANNED_PDF_OCR_NOT_APPLIED_WARNING, SCANNED_PDF_OCR_NOT_APPLIED_CODE
        failure_warnings = [reason, code]
        if ocr_failed:
            failure_warnings.append(f"OCR_FAILED_PAGES:{len(ocr_failed)}")
        if ocr_skipped:
            failure_warnings.append(f"{OCR_BUDGET_EXCEEDED_CODE}:{len(ocr_skipped)}")
        raise ExtractionFailedError(
            "PDF metin katmanı yok denecek kadar az"
            f" (~{total_chars} karakter / {pages} sayfa);"
            f" {reason}",
            warnings=failure_warnings,
        )
    warnings: list[str] = []
    if text_sparse:
        listed = _listed(text_sparse)
        warnings.append(
            f"{len(text_sparse)} sayfada çok az metin çıkarıldı (sayfa {listed}); "
            "yalnız başlık veya sayfa numarası okunmuş olabilir. Bu sayfaların "
            "tamamının okunduğu doğrulanmadı; aslını kontrol edin. Çıkarılan kısa "
            "metin korundu, görüntü içeriğine OCR uygulanmadı."
        )
    if image_unverified:
        # W21 (#25): machine code first (console dictionary), then the
        # sentence. These pages are SPARSE below, so the exhaustive review
        # records a gap and never calls the file completely read. R2-32: the
        # sentence says what is known — a large image and a short text layer —
        # and never calls a page a scan whose image text went unread: a
        # born-digital page over a letterhead image looks exactly the same.
        not_read = [p for p in image_unverified if (p - 1) not in ocr_echo]
        echoed = [p for p in image_unverified if (p - 1) in ocr_echo and (p - 1) not in withheld]
        echoed_withheld = [p for p in image_unverified if (p - 1) in ocr_echo and (p - 1) in withheld]
        causes: list[tuple[str, list[int]]] = []
        if not_read:
            causes.append((
                "yerel OCR bu okumada kullanılmadı"
                if provider is None
                else "yerel OCR bu sayfaları okuyamadı ya da süre sınırı nedeniyle okumadı",
                not_read,
            ))
        if echoed:
            causes.append((
                "yerel OCR görüntüde bu kısa metinden başka yazı bulmadı; bu, görüntüde"
                " başka yazı olmadığını göstermez (silik ya da el yazısı bir gövdeyi OCR"
                " hiç okuyamamış olabilir)",
                echoed,
            ))
        if echoed_withheld:
            # R2-32: OCR did read something more — lines too close to a
            # text-layer value to add or to drop (their own warning follows).
            causes.append((
                "yerel OCR görüntüde bu kısa metnin dışında yalnız ona çok benzeyen, metne"
                " eklenmeyen satırlar okudu (ayrı uyarıda); bu, görüntüde başka yazı"
                " olmadığını göstermez",
                echoed_withheld,
            ))
        tail = "; ".join(
            cause if len(causes) == 1 else f"{cause} (sayfa {_listed(listed_pages)})"
            for cause, listed_pages in causes
        )
        warnings.append(f"{IMAGE_TEXT_PAGES_CODE}:{len(image_unverified)}")
        warnings.append(
            f"{len(image_unverified)} sayfa, sayfanın büyük bölümünü kaplayan bir görüntü"
            f" ve yalnız kısa bir metin katmanı taşıyor (sayfa {_listed(image_unverified)}):"
            " bu kısa metin (ör. imza doğrulama satırı, damga ya da kısa bir sayfanın"
            " yazısı) okundu; görüntüde başka yazı olup olmadığı doğrulanamadı —"
            f" {tail}. Bu sayfaların tamamının okunduğu doğrulanmadı; aslını kontrol edin."
        )
    # Pages that neither the text layer nor local OCR could read.
    unread = stats.empty_pages
    if unread:
        # Mixed scan: ingest what has a text layer, say exactly what has
        # not. Machine code first (console dictionary), then the sentence.
        warnings.append(f"{SCANNED_PAGES_CODE}:{len(unread)}")
        if ocr_results or ocr_echo or ocr_failed or ocr_skipped:
            warnings.append(
                f"{len(unread)} sayfa ne metin katmanıyla ne yerel OCR ile okunabildi"
                f" (sayfa {_listed(unread)}); bu sayfalar okunmamış sayılır."
            )
        else:
            warnings.append(scanned_pages_warning(stats, ocr_available=provider is not None))
    if ocr_results:
        read = stats.ocr_pages
        warnings.append(f"OCR_PAGES:{len(read)}")
        warnings.append(
            f"{len(read)} sayfa yerel OCR ile okundu (sayfa {_listed(read)}); OCR metni"
            " hata içerebilir, alıntıları belgenin aslıyla karşılaştırın."
        )
    if ocr_unsure:
        # R2-33: machine code first (console dictionary), then the sentence,
        # which names the actual cause per page: low confidence, only a few
        # characters read, or (a page with a text layer) only a few characters
        # found beyond that text layer — never "low confidence" at 0.9.
        groups: dict[str, list[int]] = {}
        for page in ocr_unsure:
            cause = _ocr_unsure_cause(ocr_results[page - 1], ocr_texts[page - 1], stripped_len[page - 1])
            groups.setdefault(cause, []).append(page)
        tail = "; ".join(
            cause if len(groups) == 1 else f"{cause} (sayfa {_listed(listed_pages)})"
            for cause, listed_pages in groups.items()
        )
        warnings.append(f"{OCR_LOW_CONFIDENCE_PAGES_CODE}:{len(ocr_unsure)}")
        warnings.append(
            f"{len(ocr_unsure)} sayfada yerel OCR'ın okuması eksik ya da belirsiz kaldı"
            f" (sayfa {_listed(ocr_unsure)}): {tail}. Bu sayfaların tamamının okunduğu"
            " doğrulanmadı ve bu sayfalarda aramanın sonuç vermemesi, aranan ifadenin"
            " orada geçmediğini göstermez. Aslını kontrol edin."
        )
    if withheld:
        # R2-32: what was withheld is named (quoted in the warning, which is
        # never citable), so the value is neither a quote nor silently gone.
        withheld_pages = tuple(sorted(index + 1 for index in withheld))
        quoted = [
            f"s. {index + 1}: «{_short_quote(line)}»"
            for index in sorted(withheld)
            for line in withheld[index]
        ]
        examples = ", ".join(quoted[:_WITHHELD_QUOTED]) + (", …" if len(quoted) > _WITHHELD_QUOTED else "")
        warnings.append(f"{OCR_WITHHELD_LINES_PAGES_CODE}:{len(withheld_pages)}")
        warnings.append(
            f"{len(withheld_pages)} sayfada yerel OCR'ın okuduğu bazı satırlar metin"
            f" katmanındaki bir ifadeye çok benzediği için metne eklenmedi (sayfa"
            f" {_listed(withheld_pages)}; eklenmeyenler: {examples}): bunlar metin katmanının yanlış"
            " okunmuş bir kopyası da olabilir, sayfada ayrıca geçen farklı bir değer (ör."
            " başka bir tarih, tutar ya da esas numarası) de. Bu satırlar aramada çıkmaz"
            " ve alıntılanamaz; bu sayfaların tamamının okunduğu doğrulanmadı — aslını"
            " kontrol edin."
        )
    if ocr_failed:
        warnings.append(f"OCR_FAILED_PAGES:{len(ocr_failed)}")
    if ocr_skipped:
        warnings.append(f"{OCR_BUDGET_EXCEEDED_CODE}:{len(ocr_skipped)}")
        warnings.append(
            f"{len(ocr_skipped)} sayfaya yerel OCR, belge başına süre sınırı"
            f" ({int(ocr_budget_s)} sn) dolduğu için uygulanmadı (sayfa"
            f" {_listed(tuple(ocr_skipped))}); bu sayfalar okunmamış sayılır."
            " Belgeyi bölüp parçaları ayrı yükleyin."
        )
    # Build the canonical text and the page map in ONE pass, so every
    # code-point range in the result can name the physical page it came
    # from. The per-page status is decided by THIS lane's thresholds (the
    # same ones that produced `stats`), not re-derived by the builder.
    blocks = [
        _ocr_block(
            index, ocr_results[index], text_layer=text, ocr_text=ocr_texts[index],
            withheld=index in withheld,
        )
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
            # counted as read, never as verified. W21 (#25): so is an
            # image-backed page whose image nothing verified (R2-32: an OCR
            # echo never verifies it).
            extraction_method=(
                "none" if not text.strip() else "pdf_text_layer"
            ),
            extraction_status=(
                "UNREADABLE"
                if stripped_len[index] == 0
                else "SPARSE"
                if stripped_len[index] < PDF_SPARSE_CHARS_PER_PAGE
                or index in image_backed
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


def _listed(page_numbers: tuple[int, ...] | list[int]) -> str:
    """Page numbers for a Turkish sentence, cut after the first few."""
    listed = ", ".join(str(p) for p in list(page_numbers)[:_SCANNED_PAGES_LISTED])
    if len(page_numbers) > _SCANNED_PAGES_LISTED:
        listed += ", …"
    return listed


def _accepts_timeout(provider: object) -> bool:
    """Does this provider's ``ocr_page`` take the per-page ``timeout_s``?"""
    try:
        params = inspect.signature(provider.ocr_page).parameters  # type: ignore[attr-defined]
    except (TypeError, ValueError, AttributeError):
        return False
    return "timeout_s" in params or any(
        p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()
    )


def _run_local_ocr(
    provider: OcrProvider | None,
    data: bytes,
    candidates: list[int],
    *,
    budget_s: float,
    clock: Callable[[], float],
) -> tuple[dict[int, OcrPageResult], list[int], list[int]]:
    """OCR the candidate pages within ONE overall time budget (W21 #30).

    Returns (results by 0-based index, 1-based pages OCR failed on, 1-based
    pages the budget did not reach). A page is only started when at least
    ``OCR_MIN_PAGE_S`` of the budget is left, and it may take no more than
    what is left (nor more than ``PAGE_TIMEOUT_S``). One failing page never
    sinks the file.
    """
    results: dict[int, OcrPageResult] = {}
    failed: list[int] = []
    skipped: list[int] = []
    if provider is None or not candidates:
        return results, failed, skipped
    pass_timeout = _accepts_timeout(provider)
    deadline = clock() + budget_s
    with sigterm_stops_ocr():
        for index in candidates:
            remaining = deadline - clock()
            if remaining < OCR_MIN_PAGE_S:
                skipped.append(index + 1)
                continue
            try:
                if pass_timeout:
                    result = provider.ocr_page(
                        data, index, timeout_s=min(float(PAGE_TIMEOUT_S), remaining)
                    )
                else:
                    result = provider.ocr_page(data, index)
            except Exception:  # noqa: BLE001 - one page never sinks the file
                failed.append(index + 1)
                continue
            if result.text.strip():
                results[index] = result
            else:
                failed.append(index + 1)
    return results, failed, skipped


#: How deep Form XObjects are followed when looking for a drawn image.
_MAX_FORM_DEPTH = 3


class _FormNestingTooDeep(Exception):
    """A Form XObject nested deeper than ``_MAX_FORM_DEPTH`` was drawn: its
    content is not measured, so the page's image coverage is UNKNOWN (the
    caller's conservative fallback decides), never 0 (W21 closing re-check)."""


def _xobjects_of(resources: object) -> dict:
    """Name -> resolved XObject of a (resolved) /Resources dictionary.

    Never raises (W21 #25 regression): a dangling reference (pypdf's
    non-strict mode resolves it to None), a non-dictionary entry or an
    unreadable /XObject dictionary is left out. Such an entry cannot be drawn
    by any renderer either, so it is not an image on the page.
    """
    from pypdf.generic import DictionaryObject

    try:
        if not isinstance(resources, DictionaryObject):
            return {}
        xobjects = resources.get("/XObject")
        if xobjects is None:
            return {}
        xobjects = xobjects.get_object()
        if not isinstance(xobjects, DictionaryObject):
            return {}
        entries = list(xobjects.items())
    except Exception:  # noqa: BLE001 - malformed resources name no drawable image
        return {}
    resolved: dict = {}
    for name, ref in entries:
        try:
            obj = ref.get_object()
        except Exception:  # noqa: BLE001 - one broken entry never sinks the page
            continue
        if isinstance(obj, DictionaryObject):
            resolved[name] = obj
    return resolved


def _drawn_image_area(operations: list, xobjects: dict, det: float, depth: int, reader: object) -> float:
    """Total area (user-space units squared) the page's images are drawn at.

    Only the determinant of the current transformation matrix matters for
    an area, so q/Q/cm are tracked as one scalar: an image XObject (or an
    inline image) is drawn on the unit square, i.e. at |det| units squared.
    The areas are SUMMED (W21 #25): a scan written as strips, tiles or MRC
    regions draws no single large image, yet together they are the page.
    Overlaps can push the sum past the page; the caller clamps to 1.0.
    """
    from pypdf.generic import ContentStream

    best = 0.0
    stack: list[float] = []
    for operands, operator in operations:
        if operator == b"q":
            stack.append(det)
        elif operator == b"Q":
            if stack:
                det = stack.pop()
        elif operator == b"cm" and len(operands) == 6:
            a, b, c, d = (float(v) for v in operands[:4])
            det *= a * d - b * c
        elif operator == b"INLINE IMAGE":
            best += abs(det)
        elif operator == b"Do" and operands:
            target = xobjects.get(operands[0])
            if target is None:
                continue
            # R2-35: /Subtype, /Matrix and /Resources may be indirect
            # references (spec-valid); pypdf's .get() does not resolve them.
            subtype = _resolved(target.get("/Subtype"))
            if subtype == "/Image":
                best += abs(det)
            elif subtype == "/Form" and depth >= _MAX_FORM_DEPTH:
                raise _FormNestingTooDeep()
            elif subtype == "/Form":
                form_det = det
                matrix = _resolved(target.get("/Matrix"))
                if matrix is not None and len(matrix) == 6:
                    ma, mb, mc, md = (float(_resolved(v)) for v in list(matrix)[:4])
                    form_det *= ma * md - mb * mc
                form_resources = _resolved(target.get("/Resources"))
                inner = (
                    _xobjects_of(form_resources)
                    if form_resources is not None
                    else xobjects
                )
                inner_ops = ContentStream(target, reader).operations
                best += _drawn_image_area(inner_ops, inner, form_det, depth + 1, reader)
    return best


#: An inline image operator ("BI … ID … EI") as a whole token in a raw content stream.
_INLINE_IMAGE_OPERATOR = re.compile(rb"(?<![A-Za-z0-9])BI(?![A-Za-z0-9])")


def _resolved(value: object) -> object:
    """An indirect reference resolved to its object; anything else as is (R2-35).

    Raises when the reference cannot be resolved, so the caller's analysis
    fails and the conservative fallback decides.
    """
    get_object = getattr(value, "get_object", None)
    return get_object() if callable(get_object) else value


def _page_image_coverage(page: object, reader: object) -> float:
    """Share of the page area (0..1) covered by its drawn images, summed.

    Read from the content stream without decoding any image. Best effort by
    design, and it errs toward "not verified" (R2-35): when the drawing cannot
    be analysed, a page that MAY draw an image — an image XObject, a Form
    XObject (signing and merging tools wrap the scanned original in one) or an
    inline image — gets 1.0. An unknown page is treated as a possible scan,
    never as a fully read one.

    NEVER raises (W21 #25 regression): ``extract_pdf`` calls this outside the
    pypdf parse guard, so an exception here used to escape as an uncaught
    AttributeError (a 500 on upload, an aborted batch) for a PDF whose text
    layer had been read perfectly well. An /XObject entry that resolves to no
    dictionary (a dangling reference) cannot be drawn by any renderer and is
    not an image on the page.
    """
    try:
        resources = _resolved(page.get("/Resources"))  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 - unreadable resources name no XObject
        resources = None
    xobjects = _xobjects_of(resources)
    try:
        box = page.mediabox  # type: ignore[attr-defined]
        page_area = abs(float(box.width) * float(box.height))
    except Exception:  # noqa: BLE001 - see docstring: unknown -> possible scan
        return _coverage_when_unanalysable(page, xobjects)
    if page_area <= 0:
        return _coverage_when_unanalysable(page, xobjects)
    try:
        contents = page.get_contents()  # type: ignore[attr-defined]
        if contents is None:
            return 0.0
        # No XObject at all and no inline-image operator: nothing on the page
        # can be an image, so the operator parse is skipped (W21 review: on
        # vector-heavy PDFs it doubled the text-layer time).
        if not xobjects and not _INLINE_IMAGE_OPERATOR.search(contents.get_data()):
            return 0.0
        area = _drawn_image_area(contents.operations, xobjects, 1.0, 0, reader)
    except Exception:  # noqa: BLE001 - see docstring: unknown -> possible scan
        return _coverage_when_unanalysable(page, xobjects)
    return min(1.0, area / page_area)


def _coverage_when_unanalysable(page: object, xobjects: dict) -> float:
    """R2-35: 1.0 when a page whose drawing could not be measured MAY draw an
    image (image XObject, Form XObject, XObject of unknown kind, inline image
    or an unreadable content stream), else 0.0. Never raises.
    """
    for obj in xobjects.values():
        try:
            subtype = _resolved(obj.get("/Subtype"))
        except Exception:  # noqa: BLE001 - an XObject of unknown kind may be the scan
            return 1.0
        if subtype in ("/Image", "/Form"):
            return 1.0
    try:
        contents = page.get_contents()  # type: ignore[attr-defined]
        if contents is None:
            return 0.0
        return 1.0 if _INLINE_IMAGE_OPERATOR.search(contents.get_data()) else 0.0
    except Exception:  # noqa: BLE001 - a stream nobody can read is not called read
        return 1.0


def _fold_words(text: str) -> list[str]:
    """Words of ``text`` folded for comparison: case, Turkish dotless i and
    diacritics removed (OCR drops or swaps them), inner punctuation kept."""
    folded = unicodedata.normalize("NFKD", text.replace("İ", "i").replace("ı", "i"))
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch)).casefold()
    return _WORD_RE.findall(folded)


@dataclass(frozen=True)
class OcrLineSplit:
    """How one page's OCR reading relates to its text layer (R2-32)."""

    #: OCR lines the text layer does not hold, in reading order; ``None`` when
    #: no line with words is left (an echo: OCR added nothing).
    added: str | None
    #: Lines that NEARLY match a text-layer value without enough exact words to
    #: show they re-read it: neither added (citable) nor silently dropped.
    withheld: tuple[str, ...] = ()


def _near_layer_words(word: str, candidates: list[str], cache: dict[str, tuple[str, ...]]) -> tuple[str, ...]:
    """Text-layer words ``word`` may be a misreading of, most similar first."""
    if word not in cache:
        near: list[tuple[float, str]] = []
        if len(word) >= _FUZZY_WORD_MIN_CHARS:
            for candidate in candidates:
                matcher = SequenceMatcher(None, word, candidate, autojunk=False)
                if (
                    matcher.real_quick_ratio() < _FUZZY_WORD_MIN_RATIO
                    or matcher.quick_ratio() < _FUZZY_WORD_MIN_RATIO
                ):
                    continue
                ratio = matcher.ratio()
                if ratio >= _FUZZY_WORD_MIN_RATIO:
                    near.append((ratio, candidate))
        near.sort(key=lambda item: (-item[0], item[1]))
        cache[word] = tuple(candidate for _ratio, candidate in near)
    return cache[word]


def _digit_changed(word: str, layer_word: str) -> bool:
    """The two words differ where a DIGIT stands on both sides (11.03.2024
    against 12.03.2024), or a digit is only on one side as an insertion
    (2024/1234 against 2024/123): a distinct value, not a misreading. A digit
    read as a letter or back (6 and G, 0 and O) is an OCR confusion."""
    matcher = SequenceMatcher(None, word, layer_word, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        ours, theirs = word[i1:i2], layer_word[j1:j2]
        if tag == "replace" and any(c.isdigit() for c in ours) and any(c.isdigit() for c in theirs):
            return True
        if tag in ("insert", "delete") and any(c.isdigit() for c in ours + theirs):
            return True
    return False


def _contiguous_at(words: list[str], layer: list[str | None]) -> int | None:
    """Where ``words`` occur word for word in ``layer``, if anywhere."""
    size = len(words)
    for start in range(len(layer) - size + 1):
        if layer[start:start + size] == words:
            return start
    return None


def _aligned(words: list[str], layer: list[str | None]) -> list[tuple[int, int]]:
    """Best in-order match of ``words`` inside ONE window of ``layer`` about as
    long as ``words`` (scattered common words do not add up): (layer
    position, word index) pairs. Claimed layer positions are ``None``."""
    width = len(words) + max(2, len(words) // 4)
    wanted = set(words)
    best: list[tuple[int, int]] = []
    for start in range(max(1, len(layer) - width + 1)):
        window = layer[start:start + width]
        if wanted.isdisjoint(window):
            continue
        matcher = SequenceMatcher(None, window, words, autojunk=False)
        pairs = [
            (start + block.a + offset, block.b + offset)
            for block in matcher.get_matching_blocks()
            for offset in range(block.size)
        ]
        if len(pairs) > len(best):
            best = pairs
            if len(best) == len(words):
                break
    return best


def _split_ocr_lines(text_layer: str, ocr_text: str) -> OcrLineSplit:
    """Split one page's OCR reading against its text layer (R2-32).

    Every text-layer word can be re-read ONCE: an OCR line that re-reads a
    stretch of the text layer claims it, and a later line cannot claim the
    same words again. In order:

    1. exact copies (the line's words occur word for word) are dropped;
    2. near copies — at least ``_OCR_COPY_MIN_SHARE`` of the words match in
       order, at least ``_COPY_MIN_EXACT_WORDS`` of them exactly and
       near-matched words are at most half the exact ones — are misreadings
       of that stretch and are dropped;
    3. any other line whose words match that well only with a near-matched
       word (a lone date, an amount, a case number off by one digit) is
       WITHHELD: a misread copy and a distinct value look the same;
    4. everything else is kept, in reading order.
    """
    layer_words = _fold_words(text_layer)
    if not layer_words:
        return OcrLineSplit(added=ocr_text)
    lines = ocr_text.splitlines()
    folded = [_fold_words(line) for line in lines]
    vocabulary = set(layer_words)
    candidates = sorted(word for word in vocabulary if len(word) >= _FUZZY_WORD_MIN_CHARS)
    near_cache: dict[str, tuple[str, ...]] = {}
    free: list[str | None] = list(layer_words)
    unclaimed = Counter(layer_words)

    def claim(positions) -> None:
        for position in positions:
            word = free[position]
            if word is not None:
                unclaimed[word] -= 1
                free[position] = None

    def as_layer_words(words: list[str]) -> list[str]:
        # A word the text layer holds exactly stays itself (a second exact
        # occurrence is not a misreading of another word); any other word
        # becomes the most similar text-layer word still unclaimed.
        mapped: list[str] = []
        for word in words:
            if word not in vocabulary:
                word = next(
                    (c for c in _near_layer_words(word, candidates, near_cache) if unclaimed[c] > 0),
                    word,
                )
            mapped.append(word)
        return mapped

    def near_enough(mapped: list[str]) -> list[tuple[int, int]]:
        # An upper bound first: fewer unclaimed layer words than the copy share
        # cannot align that well, so most body lines skip the alignment.
        available = sum(min(count, unclaimed[word]) for word, count in Counter(mapped).items())
        if available < _OCR_COPY_MIN_SHARE * len(mapped):
            return []
        return _aligned(mapped, free)

    verdict = ["keep"] * len(lines)
    # Longest lines first: they carry the most evidence of what they re-read.
    order = sorted((i for i, words in enumerate(folded) if words), key=lambda i: -len(folded[i]))
    for i in order:
        start = _contiguous_at(folded[i], free)
        if start is not None:
            claim(range(start, start + len(folded[i])))
            verdict[i] = "copy"
        elif _contiguous_at(folded[i], list(layer_words)) is not None:
            verdict[i] = "copy"  # its exact words are on the page already
    # Lines whose near-matched words are only misread LETTERS claim first; a
    # line that differs in a DIGIT (a printed older footer with another date)
    # may be a distinct value, so it claims a stretch only when no letter-only
    # re-reading of that stretch is left. Otherwise the distinct line was
    # dropped and the misread copy of the text layer was added (W21 closing
    # re-check).
    for digits_allowed in (False, True):
        for i in order:
            words = folded[i]
            if verdict[i] != "keep" or len(words) < _COPY_MIN_EXACT_WORDS:
                continue
            mapped = as_layer_words(words)
            pairs = near_enough(mapped)
            if not digits_allowed and any(
                mapped[b] != words[b] and _digit_changed(words[b], mapped[b]) for _p, b in pairs
            ):
                continue
            exact = sum(1 for _position, b in pairs if mapped[b] == words[b])
            near = len(pairs) - exact
            if (
                len(pairs) >= _OCR_COPY_MIN_SHARE * len(words)
                and exact >= _COPY_MIN_EXACT_WORDS
                and 2 * near <= exact
            ):
                claim(position for position, _b in pairs)
                verdict[i] = "copy"
    for i in order:
        words = folded[i]
        if verdict[i] != "keep":
            continue
        mapped = as_layer_words(words)
        pairs = near_enough(mapped)
        if len(pairs) >= _OCR_COPY_MIN_SHARE * len(words) and any(mapped[b] != words[b] for _p, b in pairs):
            verdict[i] = "withheld"
    adds = any(verdict[i] == "keep" and folded[i] for i in range(len(lines)))
    kept = [line for i, line in enumerate(lines) if verdict[i] == "keep"]
    withheld = tuple(" ".join(line.split()) for i, line in enumerate(lines) if verdict[i] == "withheld")
    return OcrLineSplit(added="\n".join(kept) if adds else None, withheld=withheld)


def _ocr_text_beyond_layer(text_layer: str, ocr_text: str) -> str | None:
    """What OCR read BEYOND the page's text layer (R2-32): the OCR text without
    the lines that re-read the text layer and without withheld lines, or
    ``None`` when nothing is left (an echo)."""
    return _split_ocr_lines(text_layer, ocr_text).added


def _short_quote(line: str) -> str:
    """A withheld OCR line, shortened for the warning sentence."""
    if len(line) <= _WITHHELD_QUOTE_CHARS:
        return line
    return line[:_WITHHELD_QUOTE_CHARS].rstrip() + "…"


def _ocr_unsure_cause(result: OcrPageResult, contributed: str, text_layer_chars: int) -> str:
    """Why a page OCR read is not fully read (R2-33), in Turkish."""
    low = result.confidence is not None and result.confidence < LOW_CONFIDENCE
    few = len(contributed.strip()) < PDF_SPARSE_CHARS_PER_PAGE
    if low and few:
        return "yerel OCR bu sayfalarda düşük güvenle ve yalnız birkaç karakter okuyabildi"
    if low:
        return "yerel OCR bu sayfaları düşük güvenle okudu"
    if text_layer_chars:
        return (
            "sayfaların kısa metin katmanı okundu; yerel OCR görüntüde bunun ötesinde yalnız"
            " birkaç karakter buldu ve görüntüde başka yazı olup olmadığı doğrulanamadı"
        )
    return "yerel OCR bu sayfalarda yalnız birkaç karakter okuyabildi"


def _ocr_unsure(result: OcrPageResult, contributed: str | None = None) -> bool:
    """Low confidence, or only a few characters read: counted as read, never
    as verified (SPARSE). ``contributed`` is the OCR text the page actually
    gained (R2-32/R2-33); by default what OCR read."""
    text = result.text if contributed is None else contributed
    return (
        (result.confidence is not None and result.confidence < LOW_CONFIDENCE)
        or len(text.strip()) < PDF_SPARSE_CHARS_PER_PAGE
    )


def _ocr_block(
    index: int,
    result: OcrPageResult,
    text_layer: str = "",
    ocr_text: str | None = None,
    withheld: bool = False,
) -> SegmentInput:
    """A page read by local OCR, in its own page slot.

    ``text_layer`` (W21 #25): an image-backed page may carry a short digital
    text layer (an e-signature footer, a stamp). Those exact characters are
    kept in front of the OCR text in the same page slot — OCR may garble a
    verification code the text layer holds verbatim. ``ocr_text`` (R2-32) is
    what OCR read BEYOND that layer; lines re-reading the layer are not
    repeated, so no misread second copy becomes citable. ``withheld``: OCR
    lines that nearly match a text-layer value were left out, so the page is
    read in part only.
    """
    added = result.text if ocr_text is None else ocr_text
    layer = text_layer.strip()
    return SegmentInput(
        locator_kind="page",
        locator_label=str(index + 1),
        text=f"{layer}\n\n{added}" if layer else added,
        extraction_method="ocr",
        # Low confidence, only a few characters added, or near-copy lines
        # withheld: counted as read, never as verified (SPARSE).
        extraction_status="SPARSE" if withheld or _ocr_unsure(result, added) else "EXTRACTED",
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
