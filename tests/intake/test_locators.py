"""Source-locator map: canonical ranges resolve to physical PDF pages.

The three properties under test are the ones the citation chain depends on:

1. **No offset drift.** The text the builder produces is byte-identical to
   ``NFC(_tidy(blocks))`` — the string the pipeline stored before this
   module existed — so the page map is measured against the SAME canonical
   text every chunk offset and every quote hash already use. This is
   measured over adversarial Unicode rather than argued from the standard.
2. **Pages resolve exactly.** A phrase planted on page 137 of a 200-page PDF
   resolves to page 137, and the canonical slice at that range is still the
   exact planted text.
3. **Unreadable pages are recorded, never dropped.** A page with no text
   layer keeps a segment with an EMPTY range, so processing coverage can see
   that it exists and was not read.
"""

from __future__ import annotations

import unicodedata

import pytest

from intake import extract
from ingestion.locators import (
    SEGMENT_SEPARATOR,
    SegmentInput,
    build_segmented_canonical,
    clean_block,
    format_locator,
    locator_for_range,
    segments_for_range,
)
from tests.intake.pdf_fixtures import build_multipage_pdf

# ---------------------------------------------------------------------------
# 1. No offset drift
# ---------------------------------------------------------------------------

#: Inputs chosen to break a naive builder:
#:  - "s" + U+0327 composes to "ş" under NFC (a LENGTH change), which is
#:    exactly the drift that would corrupt spans measured before NFC;
#:  - a combining mark as the FIRST character of a block probes the join
#:    boundary the module header reasons about;
#:  - astral characters occupy two UTF-16 units but one code point, which is
#:    the ADR-003 unit;
#:  - CRLF and 3+ newline runs exercise the cleaning rules.
_ADVERSARIAL_BLOCKS = [
    ["Birinci blok", "İkinci blok"],
    ["şehir plani", "güvenlik"],
    ["́ mark leads this block", "sonraki"],
    ["satir\r\nsonu", "cok\n\n\n\nbosluk"],
    ["astral \U0001F600 karakter", "son"],
    ["   ", "yalniz bu blok dolu", ""],
    ["tek blok"],
    ["ilk", "   ", "\t\n ", "son"],
]


@pytest.mark.parametrize("blocks", _ADVERSARIAL_BLOCKS)
def test_builder_text_equals_nfc_of_the_historical_tidy(blocks: list[str]) -> None:
    """The canonical text does not change, so no stored offset moves."""
    historical = unicodedata.normalize("NFC", extract._tidy(list(blocks)))
    text, _ = build_segmented_canonical(
        [
            SegmentInput("block", str(i + 1), b, "plain_text", ordinal=i + 1)
            for i, b in enumerate(blocks)
        ]
    )
    assert text == historical


@pytest.mark.parametrize("blocks", _ADVERSARIAL_BLOCKS)
def test_every_segment_slices_out_of_the_canonical_text(blocks: list[str]) -> None:
    """The map is exact: each segment's range IS that block's canonical text."""
    text, segments = build_segmented_canonical(
        [
            SegmentInput("block", str(i + 1), b, "plain_text", ordinal=i + 1)
            for i, b in enumerate(blocks)
        ]
    )
    assert segments, "builder refused to certify a map it should have certified"
    for segment, raw in zip(segments, blocks):
        expected = unicodedata.normalize("NFC", clean_block(raw))
        assert text[segment.start_char : segment.end_char] == expected


#: Written with explicit escapes, never as a literal glyph: whether a source
#: file happens to be saved decomposed is an accident of the editor, and
#: these fixtures have to be the decomposed form on purpose.
DECOMPOSED_S_CEDILLA = "şehir"    # s + COMBINING CEDILLA -> U+015F
DECOMPOSED_G_BREVE = "ğuvenlik"   # g + COMBINING BREVE   -> U+011F


def test_composition_really_changes_length_in_the_fixture() -> None:
    """Guard the guard: the drift fixtures must actually compose.

    If these ever stopped composing, the drift tests would pass vacuously,
    so the property they depend on is asserted directly.
    """
    for decomposed in (DECOMPOSED_S_CEDILLA, DECOMPOSED_G_BREVE):
        assert len(unicodedata.normalize("NFC", decomposed)) < len(decomposed), decomposed


def test_offsets_do_not_drift_when_nfc_composes_an_earlier_block() -> None:
    """The exact failure a pre-NFC measurement would have produced.

    Measured before NFC, page 2's range would start one code point too far
    to the right for every code point composition removed from page 1.
    """
    text, segments = build_segmented_canonical([
        SegmentInput("page", "1", DECOMPOSED_S_CEDILLA, "pdf_text_layer", ordinal=1),
        SegmentInput("page", "2", DECOMPOSED_G_BREVE, "pdf_text_layer", ordinal=2),
    ])

    assert text[segments[0].start_char : segments[0].end_char] == unicodedata.normalize(
        "NFC", DECOMPOSED_S_CEDILLA
    )
    assert text[segments[1].start_char : segments[1].end_char] == unicodedata.normalize(
        "NFC", DECOMPOSED_G_BREVE
    )
    naive_start_of_page_two = len(DECOMPOSED_S_CEDILLA) + len(SEGMENT_SEPARATOR)
    assert segments[1].start_char < naive_start_of_page_two


def test_text_is_already_nfc_so_the_ingest_normalize_is_a_no_op() -> None:
    text, segments = build_segmented_canonical(
        [SegmentInput("page", "1", "şehir plani", "pdf_text_layer", ordinal=1)]
    )
    assert unicodedata.normalize("NFC", text) == text
    assert segments[0].end_char == len(text)


def test_separator_matches_the_extractor_join() -> None:
    """If ``_tidy`` ever changes its separator this test fails loudly."""
    assert extract._tidy(["a", "b"]) == "a" + SEGMENT_SEPARATOR + "b"


# ---------------------------------------------------------------------------
# 2. Unreadable blocks are recorded, never dropped
# ---------------------------------------------------------------------------


def test_empty_block_keeps_an_empty_segment_in_document_order() -> None:
    text, segments = build_segmented_canonical(
        [
            SegmentInput("page", "1", "birinci sayfa", "pdf_text_layer", ordinal=1),
            SegmentInput("page", "2", "   ", "none", "UNREADABLE", ordinal=2),
            SegmentInput("page", "3", "ucuncu sayfa", "pdf_text_layer", ordinal=3),
        ]
    )
    assert len(segments) == 3
    unreadable = segments[1]
    assert unreadable.extraction_status == "UNREADABLE"
    assert unreadable.char_count == 0
    assert unreadable.is_readable is False
    # Parked between the two readable pages, not at 0 and not at the end.
    assert segments[0].end_char == unreadable.start_char
    assert unreadable.end_char < segments[2].start_char
    # It contributed nothing, so the text reads as if it were not there.
    assert text == "birinci sayfa" + SEGMENT_SEPARATOR + "ucuncu sayfa"


def test_an_empty_segment_never_claims_a_quote() -> None:
    _, segments = build_segmented_canonical(
        [
            SegmentInput("page", "1", "dolu", "pdf_text_layer", ordinal=1),
            SegmentInput("page", "2", "", "none", "UNREADABLE", ordinal=2),
        ]
    )
    # The whole readable range resolves to page 1 only.
    assert [s.locator_label for s in segments_for_range(segments, 0, 4)] == ["1"]


# ---------------------------------------------------------------------------
# 3. Resolution
# ---------------------------------------------------------------------------


def test_locator_formats_single_page_and_page_range() -> None:
    _, segments = build_segmented_canonical(
        [
            SegmentInput("page", "7", "yedinci sayfa metni", "pdf_text_layer", ordinal=7),
            SegmentInput("page", "8", "sekizinci sayfa metni", "pdf_text_layer", ordinal=8),
        ]
    )
    assert locator_for_range(segments, 0, 5) == "s. 7"
    # A quote that runs across the page break names both pages.
    assert locator_for_range(segments, 0, segments[1].end_char) == "s. 7-8"


def test_empty_range_resolves_to_nothing() -> None:
    _, segments = build_segmented_canonical(
        [SegmentInput("page", "1", "metin", "pdf_text_layer", ordinal=1)]
    )
    assert segments_for_range(segments, 3, 3) == ()
    assert format_locator(()) is None


def test_paragraph_locator_reads_as_a_paragraph_not_a_page() -> None:
    """A DOCX has no physical pages; the label must not pretend otherwise."""
    _, segments = build_segmented_canonical(
        [SegmentInput("paragraph", "12", "paragraf metni", "docx_paragraph", ordinal=12)]
    )
    assert locator_for_range(segments, 0, 4) == "par. 12"


# ---------------------------------------------------------------------------
# 4. End to end over a real multi-page PDF
# ---------------------------------------------------------------------------

PLANTED = "GIZLI IBARE ALFA VE BETA BURADA GECER"
PLANTED_PAGE = 137
TOTAL_PAGES = 200


#: Long enough that every page clears PDF_SPARSE_CHARS_PER_PAGE, so the
#: fixture exercises fully-readable pages; the SPARSE state has its own test.
_BODY = (
    "Bu sayfanin govde metnidir ve dosyanin okunabilir bir sayfasi"
    " oldugunu gostermek icin yeterince uzundur."
)


def _two_hundred_page_pdf() -> bytes:
    pages: list[list[str]] = []
    for number in range(1, TOTAL_PAGES + 1):
        if number == PLANTED_PAGE:
            pages.append([f"Sayfa {number}", PLANTED, _BODY])
        else:
            pages.append([f"Sayfa {number}", f"{number}. sayfa. {_BODY}"])
    return build_multipage_pdf(pages)


def test_two_hundred_page_pdf_maps_every_page_and_finds_the_planted_phrase() -> None:
    outcome = extract.extract_pdf(_two_hundred_page_pdf())

    # Every page is represented in provenance — not just the ones with hits.
    assert outcome.pages == TOTAL_PAGES
    assert len(outcome.segments) == TOTAL_PAGES
    assert [s.locator_label for s in outcome.segments] == [
        str(n) for n in range(1, TOTAL_PAGES + 1)
    ]
    assert all(s.extraction_status == "EXTRACTED" for s in outcome.segments)

    # The planted phrase resolves to the page it was planted on.
    at = outcome.text.index(PLANTED)
    assert locator_for_range(outcome.segments, at, at + len(PLANTED)) == (
        f"s. {PLANTED_PAGE}"
    )

    # And the range is still an exact slice of the canonical text, which is
    # what the quote hash is computed over.
    assert outcome.text[at : at + len(PLANTED)] == PLANTED
    assert unicodedata.normalize("NFC", outcome.text) == outcome.text


def test_segments_are_ordered_disjoint_and_inside_the_text() -> None:
    outcome = extract.extract_pdf(_two_hundred_page_pdf())
    previous_end = 0
    for segment in outcome.segments:
        assert segment.start_char >= previous_end
        assert segment.end_char <= len(outcome.text)
        previous_end = segment.end_char


def test_mixed_scan_records_the_unreadable_pages_as_unreadable() -> None:
    """Pages without a text layer stay in the ledger with an empty range."""
    pdf = build_multipage_pdf(
        [["Sayfa 1", _BODY], [], ["Sayfa 3", _BODY], []]
    )
    outcome = extract.extract_pdf(pdf)

    assert len(outcome.segments) == 4
    statuses = [s.extraction_status for s in outcome.segments]
    assert statuses == ["EXTRACTED", "UNREADABLE", "EXTRACTED", "UNREADABLE"]

    unreadable = [s for s in outcome.segments if not s.is_readable]
    assert [s.locator_label for s in unreadable] == ["2", "4"]
    assert all(s.char_count == 0 for s in unreadable)
    assert all(s.extraction_method == "none" for s in unreadable)

    # The existing page_stats contract is unchanged.
    assert outcome.page_stats is not None
    assert outcome.page_stats.empty_pages == (2, 4)


def test_a_page_with_a_printed_folio_only_is_SPARSE_not_UNREADABLE() -> None:
    """UNREADABLE must mean "contributed nothing", or the ledger lies.

    A scanner that reproduced the printed page number yields a page with a
    handful of characters -- below the 10-character gate, but NOT empty.
    Those characters are in the canonical text and are citable, so calling
    the page UNREADABLE while a quote cites it is the one thing the locator
    ledger must never do.
    """
    pdf = build_multipage_pdf([["Sayfa 1", _BODY], ["- 2 -"], ["Sayfa 3", _BODY]])
    outcome = extract.extract_pdf(pdf)

    middle = outcome.segments[1]
    assert middle.extraction_status == "SPARSE"
    assert middle.extraction_method == "pdf_text_layer"
    # It contributed text, so it has a real range...
    assert middle.char_count > 0
    # ...and that range slices back to exactly what the page carried.
    assert outcome.text[middle.start_char : middle.end_char] == "- 2 -"
    # A quote there cites page 2, and the page is not claimed unreadable.
    assert locator_for_range(outcome.segments, middle.start_char, middle.end_char) == "s. 2"


def test_a_truly_empty_page_is_still_UNREADABLE_with_an_empty_range() -> None:
    pdf = build_multipage_pdf([["Sayfa 1", _BODY], [], ["Sayfa 3", _BODY]])
    outcome = extract.extract_pdf(pdf)
    middle = outcome.segments[1]
    assert middle.extraction_status == "UNREADABLE"
    assert middle.extraction_method == "none"
    assert middle.char_count == 0


def test_pdf_page_map_agrees_with_page_stats() -> None:
    pdf = build_multipage_pdf([["Sayfa 1", _BODY], [], ["Sayfa 3", _BODY]])
    outcome = extract.extract_pdf(pdf)
    readable = [s for s in outcome.segments if s.is_readable]
    assert outcome.page_stats is not None
    assert len(readable) == outcome.page_stats.pages_with_text


def test_barely_readable_page_is_marked_sparse_not_extracted() -> None:
    """A page carrying only a header is flagged, not silently accepted.

    This is the known limit named in ``intake/extract.py``'s docstring: a
    scan whose pages carry a short real header passes the empty-page gate.
    The segment ledger now makes that state visible per page instead of
    letting it hide inside an aggregate count.
    """
    pdf = build_multipage_pdf([["Sayfa 1", _BODY], ["kisa baslik"]])
    outcome = extract.extract_pdf(pdf)
    assert [s.extraction_status for s in outcome.segments] == ["EXTRACTED", "SPARSE"]
    # SPARSE text is kept, so the page still has a real range.
    assert outcome.segments[1].char_count > 0
    assert outcome.page_stats is not None
    assert outcome.page_stats.sparse_pages == (2,)
