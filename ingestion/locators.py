"""Source locators: canonical code-point ranges -> a place in the ORIGINAL file.

Why this module exists
----------------------
``intake/extract.py`` reads a PDF page by page and then flattens the pages
into one string (``_tidy`` joins the cleaned, non-empty blocks with a blank
line).  After that join nothing in the system could say WHICH PAGE a given
canonical offset came from: the evidence chain stopped at
"document version + code-point range", and a lawyer checking a quote against
the paper file had no page to turn to.

This module keeps the two together.  It rebuilds the canonical text from
per-source blocks and, in the same pass, records for every block the
half-open code-point range ``[start_char, end_char)`` it occupies in that
text.  A chunk (or a quote) can then be mapped back to a physical page.

The offset invariant (ADR-003) is preserved exactly
---------------------------------------------------
Offsets are Unicode CODE POINTS over NFC canonical text; hashes are sha256
over the UTF-8 encoding of that same text.  Nothing here changes either.

What DOES change is *when* NFC runs.  ``_tidy`` produces a pre-NFC string
that ``intake/ingest.py`` normalizes afterwards, so any span measured during
the join could drift the moment NFC composed a decomposed sequence (``i``
followed by U+0307 collapsing to one code point is a length change, and
Turkish text is full of such sequences).  Here each block is NFC-normalized
FIRST and the spans are measured on the normalized pieces, so the ranges are
measured against the FINAL canonical text and cannot drift.

The concatenation of NFC pieces around the two-newline separator is itself
already NFC, because U+000A is a starter (combining class 0) with no
canonical composition with either neighbour: it ends one combining sequence
and begins another.  That argument is not trusted on its own --
:func:`build_segmented_canonical` verifies it at run time (NFC idempotence
plus per-segment bounds and ordering checks) and, when the check fails,
returns NO segments rather than a wrong map.  A missing page map is a
visible gap; a wrong one is a false citation.

Unreadable blocks are recorded, never dropped
---------------------------------------------
A page whose text layer is empty contributes nothing to the canonical text,
but it still gets a segment with an EMPTY range (``start_char ==
end_char``) at the position where its content would have been.  That is what
lets an exhaustive run say "page 7 of 12 could not be read" instead of
quietly reporting 11 pages as the whole document.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Sequence

#: Block separator used by ``intake.extract._tidy``. Kept here so the two
#: cannot drift apart; ``tests/intake/test_locators.py`` asserts they agree.
SEGMENT_SEPARATOR = "\n\n"

_MULTI_BLANK_RE = re.compile(r"\n{3,}")

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

#: What kind of place in the original file a segment names.
#:
#: ``page`` is the only PHYSICAL locator and is used only where the format
#: really has stable pages (PDF).  For everything else an honest structural
#: locator is used instead of a made-up page number: a DOCX has no fixed
#: pagination until it is rendered, so claiming "page 4" for a DOCX would be
#: a fabricated citation.
LOCATOR_KINDS = ("page", "paragraph", "block", "section")

#: How the text of a segment was obtained.
EXTRACTION_METHODS = (
    "pdf_text_layer",
    "ocr",
    "docx_paragraph",
    "docx_table",
    "plain_text",
    "udf_xml",
    "none",
)

#: Readability of a segment, for processing-coverage accounting.
#:
#: ``EXTRACTED``  -- usable text was obtained.
#: ``SPARSE``     -- some text was obtained but so little that the page was
#:                   probably an image with a header; counted as read, and
#:                   flagged.
#: ``UNREADABLE`` -- no usable text. NEVER counted as processed.
EXTRACTION_STATUSES = ("EXTRACTED", "SPARSE", "UNREADABLE")


@dataclass(frozen=True)
class SegmentInput:
    """One block of source text before cleaning, with where it came from."""

    locator_kind: str
    locator_label: str
    text: str
    extraction_method: str
    #: When None the status is derived from the cleaned length (see
    #: :func:`build_segmented_canonical`); pass a value to override, which is
    #: what the PDF lane does so its own sparse/empty thresholds win.
    extraction_status: str | None = None
    ordinal: int | None = None


@dataclass(frozen=True)
class SourceSegment:
    """A block's half-open code-point range in the canonical text."""

    segment_no: int
    locator_kind: str
    locator_label: str
    start_char: int
    end_char: int
    extraction_method: str
    extraction_status: str

    @property
    def char_count(self) -> int:
        return self.end_char - self.start_char

    @property
    def is_readable(self) -> bool:
        return self.extraction_status != "UNREADABLE"

    def to_json_dict(self) -> dict:
        return {
            "segmentNo": self.segment_no,
            "locatorKind": self.locator_kind,
            "locatorLabel": self.locator_label,
            "startChar": self.start_char,
            "endChar": self.end_char,
            "extractionMethod": self.extraction_method,
            "extractionStatus": self.extraction_status,
        }

    @staticmethod
    def from_json_dict(raw: dict) -> "SourceSegment":
        return SourceSegment(
            segment_no=int(raw["segmentNo"]),
            locator_kind=str(raw["locatorKind"]),
            locator_label=str(raw["locatorLabel"]),
            start_char=int(raw["startChar"]),
            end_char=int(raw["endChar"]),
            extraction_method=str(raw["extractionMethod"]),
            extraction_status=str(raw["extractionStatus"]),
        )


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def clean_block(block: str) -> str:
    """Exactly ``intake.extract._tidy``'s per-block cleaning, factored out."""
    block = block.replace("\r\n", "\n").replace("\r", "\n")
    return _MULTI_BLANK_RE.sub("\n\n", block).strip()


def build_segmented_canonical(
    blocks: Sequence[SegmentInput],
    *,
    sparse_threshold: int = 0,
) -> tuple[str, tuple[SourceSegment, ...]]:
    """Join ``blocks`` into canonical text and map each to its range.

    Returns ``(text, segments)``.  ``text`` is NFC-normalized and equals what
    ``_tidy`` would have produced for the same blocks (asserted by
    ``tests/intake/test_locators.py``), so a downstream caller that
    normalizes again sees a no-op.

    ``segments`` is EMPTY when the run-time verification fails -- the caller
    must then report that no source map is available rather than guess.
    """
    parts: list[str] = []
    segments: list[SourceSegment] = []
    cursor = 0

    for index, item in enumerate(blocks):
        cleaned = clean_block(item.text)
        normalized = unicodedata.normalize("NFC", cleaned) if cleaned else ""

        if normalized:
            if parts:
                # The separator only exists BETWEEN emitted blocks.
                cursor += len(SEGMENT_SEPARATOR)
            start = cursor
            cursor += len(normalized)
            end = cursor
            parts.append(normalized)
        else:
            # Nothing contributed: an empty range parked at the point in
            # document order where this block belongs.
            start = end = cursor

        if item.extraction_status is not None:
            status = item.extraction_status
        elif not normalized:
            status = "UNREADABLE"
        elif len(normalized) < sparse_threshold:
            status = "SPARSE"
        else:
            status = "EXTRACTED"

        segments.append(
            SourceSegment(
                segment_no=item.ordinal if item.ordinal is not None else index + 1,
                locator_kind=item.locator_kind,
                locator_label=item.locator_label,
                start_char=start,
                end_char=end,
                extraction_method=item.extraction_method,
                extraction_status=status,
            )
        )

    text = SEGMENT_SEPARATOR.join(parts)

    if not _verify(text, segments):
        return text, ()
    return text, tuple(segments)


def _verify(text: str, segments: Iterable[SourceSegment]) -> bool:
    """Every segment must lie inside ``text`` in order, and ``text`` be NFC.

    This turns the boundary argument in the module header into something the
    process actually checks on every upload.
    """
    if unicodedata.normalize("NFC", text) != text:
        return False
    length = len(text)
    previous_end = 0
    for segment in segments:
        if segment.start_char < 0 or segment.end_char > length:
            return False
        if segment.end_char < segment.start_char:
            return False
        if segment.start_char < previous_end:
            return False
        previous_end = segment.end_char
    return True


# ---------------------------------------------------------------------------
# Resolve
# ---------------------------------------------------------------------------


def segments_for_range(
    segments: Sequence[SourceSegment],
    start_char: int,
    end_char: int,
) -> tuple[SourceSegment, ...]:
    """Segments a half-open canonical range ``[start, end)`` touches.

    Empty (unreadable) segments are never returned: a range cannot have come
    from a block that contributed no characters.
    """
    if end_char <= start_char:
        return ()
    return tuple(
        segment
        for segment in segments
        if segment.char_count > 0
        and segment.start_char < end_char
        and segment.end_char > start_char
    )


#: How a locator kind is written for a lawyer.
_LOCATOR_WORDS = {
    "page": "s.",
    "paragraph": "par.",
    "block": "bölüm",
    "section": "kısım",
}


def format_locator(segments: Sequence[SourceSegment]) -> str | None:
    """Lawyer-facing label for the segments a quote spans, e.g. ``"s. 137"``.

    A quote that runs across a page break gets a range (``"s. 137-138"``).
    Returns None when there is nothing to name.
    """
    if not segments:
        return None
    kind = segments[0].locator_kind
    word = _LOCATOR_WORDS.get(kind, "")
    labels = [segment.locator_label for segment in segments]
    text = labels[0] if len(labels) == 1 else f"{labels[0]}-{labels[-1]}"
    return f"{word} {text}".strip()


def locator_for_range(
    segments: Sequence[SourceSegment],
    start_char: int,
    end_char: int,
) -> str | None:
    """Convenience: :func:`segments_for_range` then :func:`format_locator`."""
    return format_locator(segments_for_range(segments, start_char, end_char))
