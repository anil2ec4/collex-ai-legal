"""Structural chunking with exact Unicode code-point offsets.

Offset contract (matches legal.chunks + scripts/db_local_check.py):

* ``start_char``/``end_char`` index into the version's NFC
  ``canonical_text`` in Unicode CODE POINTS — i.e. Python ``str`` slicing
  semantics, equal to PostgreSQL ``substring(... from start_char + 1 for
  end_char - start_char)`` under UTF-8. Never byte offsets.
* ``original_text == canonical_text[start_char:end_char]`` EXACTLY;
  ``content_sha256`` is the sha256 hex of ``original_text``'s UTF-8 bytes.
* ``search_text`` is ``legal_reference.normalize.normalize_turkish_search``
  applied to ``original_text`` (search-side only; never fed back into
  original text). Every chunk records WHICH normalizer produced it in
  ``normalizer_version``; ``legal.chunks.normalizer_version`` stores it, so
  a normalizer change is detectable instead of silently splitting the
  lexical index into two incompatible halves (two normalizers exist
  in-tree: this one and its TypeScript mirror
  ``control-plane/src/retrieval/normalize.ts``).

Chunks of one version may never OVERLAP: exact-citation provenance needs a
position -> chunk mapping that is a function, and
``legal.chunks.chunks_no_overlap_within_version`` (migration 20260826030000)
enforces it in the database. ``_validate`` rejects an overlapping chunker
result here too, so a bug surfaces before it reaches SQL.

Chunkers:

* legislation — madde/fikra boundaries. The madde-header pattern is
  adapted from ``article_search.split_into_articles`` (same header
  grammar: optional EK/GEÇİCİ/MÜKERRER prefix, optional markdown bold,
  MADDE/Madde + number) but rewritten to be offset-preserving: we chunk
  the canonical text in place instead of extracting stripped strings.
* decision — section splitter over ÖZET/OLAY/GEREKÇE/HÜKÜM headings,
  with the pre-heading caption (court/E./K. block) as ``bolum-baslik``.
* generic — blank-line separated paragraphs (fallback for tenant uploads
  such as dilekçe fixtures).

Chunks need not cover every character of the canonical text (headings
between maddeler stay unchunked), but each chunk's slice equality is
asserted before it leaves this module.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Iterator, Sequence

from ingestion.ports import ParsedDocument
from legal_reference.normalize import normalize_turkish_search, turkish_lower

CHUNKER_VERSION = "chunker-v1"

# Identity of the normalizer that produces ``search_text``. Must match
# legal.chunks.normalizer_version's default and
# legal.embedding_profiles.normalization_version (supabase/seed.sql).
NORMALIZER_VERSION = "trnorm-v1"


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    structural_path: tuple[str, ...]
    article_no: str | None
    paragraph_no: str | None
    start_char: int
    end_char: int
    original_text: str
    search_text: str
    content_sha256: str
    token_count: int
    normalizer_version: str = NORMALIZER_VERSION
    metadata: dict = field(default_factory=dict)


# Madde header — adapted from article_search.split_into_articles (kept in
# sync with its grammar), anchored per line and offset-preserving.
_MADDE_RE = re.compile(
    r"(?m)^[ \t]*\*{0,2}"
    r"(?:(EK|Ek|GEÇİCİ|Geçici|MÜKERRER|Mükerrer)\s+)?"
    r"(?:MADDE|Madde)\s+(\d+)\s*\*{0,2}\s*[-–—]?"
)

# KİTAP/KISIM/BÖLÜM headings terminate the previous madde block.
_HEADING_RE = re.compile(
    r"(?m)^[ \t]*(?:[A-ZÇĞİÖŞÜ]+[ \t]+)?(?:KİTAP|KISIM|BÖLÜM|AYIRIM)[ \t]*$"
)

# Fıkra marker "(n)". Candidates are filtered to line starts (or the
# position immediately after the madde header) and to sequential 1..n
# numbering, so in-text references like "(2016)" never split a fıkra.
_FIKRA_RE = re.compile(r"\((\d+)\)")

_DECISION_SECTION_RE = re.compile(r"(?m)^[ \t]*(ÖZET|OLAY|GEREKÇE|HÜKÜM)[ \t]*:")
_SECTION_SLUGS = {"ÖZET": "ozet", "OLAY": "olay",
                  "GEREKÇE": "gerekce", "HÜKÜM": "hukum"}

_PARAGRAPH_RE = re.compile(r"[^\n]+(?:\n[^\n]+)*")

#: Upper bound (code points) on one GENERIC chunk. A 3.4 MB UYAP dosya
#: dökümü exported as TXT has no blank line, so the blank-line paragraph
#: rule produced ONE 3,359,999-character chunk; "Belgeye sor" then took
#: 349 s and returned a 20 MB answer quoting the whole file (reviewed
#: 02.09.2026). An oversize paragraph is split at line ends, then at
#: sentence ends, then hard — always on code-point offsets, never
#: overlapping, so every piece stays an exact slice of the canonical text.
MAX_GENERIC_CHUNK_CHARS = 4000

_SENTENCE_END_RE = re.compile(r"[.!?;:]\s")


def _split_oversize(canonical: str, start: int, end: int) -> list[tuple[int, int]]:
    """Split [start, end) into pieces of at most MAX_GENERIC_CHUNK_CHARS.

    Boundaries are chosen in order of preference inside each window: the
    last newline, else the last sentence end, else the last whitespace,
    else a hard cut. Pieces are returned as (start, end) offsets that the
    caller trims; they never overlap and cover the span in order.
    """
    pieces: list[tuple[int, int]] = []
    cursor = start
    limit = MAX_GENERIC_CHUNK_CHARS
    while end - cursor > limit:
        window_end = cursor + limit
        window = canonical[cursor:window_end]
        cut = window.rfind("\n")
        if cut < limit // 4:
            last_sentence = None
            for m in _SENTENCE_END_RE.finditer(window):
                last_sentence = m.end()
            if last_sentence is not None and last_sentence >= limit // 4:
                cut = last_sentence
            else:
                space = window.rfind(" ")
                cut = space if space >= limit // 4 else limit
        if cut <= 0:
            cut = limit
        pieces.append((cursor, cursor + cut))
        cursor += cut
    if cursor < end:
        pieces.append((cursor, end))
    return pieces

# Keyed by turkish_lower(prefix): ascii slug + human-facing spelling
# (article_no mirrors article_search's "Geçici 3" form).
_PREFIX_FORMS = {
    "ek": ("ek", "Ek"),
    "geçici": ("gecici", "Geçici"),
    "mükerrer": ("mukerrer", "Mükerrer"),
}


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _trim(text: str, start: int, end: int) -> tuple[int, int]:
    """Shrink [start, end) to strip leading/trailing whitespace."""
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _make_chunk(
    canonical: str,
    ordinal: int,
    start: int,
    end: int,
    structural_path: Sequence[str],
    article_no: str | None = None,
    paragraph_no: str | None = None,
) -> Chunk:
    start, end = _trim(canonical, start, end)
    if end <= start:
        raise ValueError(f"empty chunk at [{start}:{end}]")
    original = canonical[start:end]
    search = normalize_turkish_search(original)
    return Chunk(
        ordinal=ordinal,
        structural_path=tuple(structural_path),
        article_no=article_no,
        paragraph_no=paragraph_no,
        start_char=start,
        end_char=end,
        original_text=original,
        search_text=search,
        content_sha256=_sha256_hex(original),
        token_count=len(search.split()),
        normalizer_version=NORMALIZER_VERSION,
        metadata={},
    )


def _madde_label(prefix: str | None, number: str) -> tuple[str, str]:
    """Return (article_no, path slug) for a madde header match."""
    if prefix:
        slug_prefix, pretty = _PREFIX_FORMS[turkish_lower(prefix)]
        return f"{pretty} {number}", f"madde-{slug_prefix}-{number}"
    return number, f"madde-{number}"


def _fikra_markers(
    canonical: str, block_start: int, block_end: int, header_end: int
) -> list[tuple[int, int]]:
    """Line-anchored, sequential (position, number) fıkra markers."""
    candidates: list[tuple[int, int]] = []
    for m in _FIKRA_RE.finditer(canonical, block_start, block_end):
        abs_start = m.start()
        at_line_start = abs_start > 0 and canonical[abs_start - 1] == "\n"
        right_after_header = (
            abs_start >= header_end
            and canonical[header_end:abs_start].strip() == ""
        )
        if at_line_start or right_after_header:
            candidates.append((abs_start, int(m.group(1))))
    sequential: list[tuple[int, int]] = []
    expected = 1
    for pos, num in candidates:
        if num == expected:
            sequential.append((pos, num))
            expected += 1
    return sequential


def chunk_legislation(canonical: str) -> list[Chunk]:
    matches = list(_MADDE_RE.finditer(canonical))
    if not matches:
        return chunk_generic(canonical, root="belge")
    boundaries = sorted(
        {m.start() for m in matches}
        | {h.start() for h in _HEADING_RE.finditer(canonical)}
        | {len(canonical)}
    )
    chunks: list[Chunk] = []
    ordinal = 0
    for m in matches:
        block_start = m.start()
        block_end = next(b for b in boundaries if b > block_start)
        article_no, madde_slug = _madde_label(m.group(1), m.group(2))
        markers = _fikra_markers(canonical, block_start, block_end, m.end())
        if markers:
            for i, (pos, num) in enumerate(markers):
                c_start = block_start if i == 0 else pos
                c_end = markers[i + 1][0] if i + 1 < len(markers) else block_end
                chunks.append(_make_chunk(
                    canonical, ordinal, c_start, c_end,
                    (madde_slug, f"fikra-{num}"),
                    article_no=article_no, paragraph_no=str(num),
                ))
                ordinal += 1
        else:
            chunks.append(_make_chunk(
                canonical, ordinal, block_start, block_end,
                (madde_slug,), article_no=article_no,
            ))
            ordinal += 1
    return chunks


def chunk_decision(canonical: str) -> list[Chunk]:
    matches = list(_DECISION_SECTION_RE.finditer(canonical))
    if not matches:
        return chunk_generic(canonical, root="karar")
    chunks: list[Chunk] = []
    ordinal = 0
    preamble_start, preamble_end = _trim(canonical, 0, matches[0].start())
    if preamble_end > preamble_start:
        chunks.append(_make_chunk(
            canonical, ordinal, preamble_start, preamble_end,
            ("bolum-baslik",),
        ))
        ordinal += 1
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(canonical)
        slug = _SECTION_SLUGS[m.group(1)]
        chunks.append(_make_chunk(
            canonical, ordinal, start, end, (f"bolum-{slug}",),
        ))
        ordinal += 1
    return chunks


def chunk_generic(canonical: str, root: str = "paragraf") -> list[Chunk]:
    chunks: list[Chunk] = []
    ordinal = 0
    for m in _PARAGRAPH_RE.finditer(canonical):
        start, end = _trim(canonical, m.start(), m.end())
        if end <= start:
            continue
        spans = (
            _split_oversize(canonical, start, end)
            if end - start > MAX_GENERIC_CHUNK_CHARS
            else [(start, end)]
        )
        for piece_start, piece_end in spans:
            piece_start, piece_end = _trim(canonical, piece_start, piece_end)
            if piece_end <= piece_start:
                continue
            chunks.append(_make_chunk(
                canonical, ordinal, piece_start, piece_end,
                (f"{root}-{ordinal + 1}",),
            ))
            ordinal += 1
    return chunks


def _validate(canonical: str, chunks: list[Chunk]) -> list[Chunk]:
    last_ordinal = -1
    spans: list[tuple[int, int, int]] = []
    for chunk in chunks:
        if chunk.ordinal != last_ordinal + 1:
            raise AssertionError("chunk ordinals must be contiguous from 0")
        last_ordinal = chunk.ordinal
        if canonical[chunk.start_char:chunk.end_char] != chunk.original_text:
            raise AssertionError(
                f"offset invariant violated at ordinal {chunk.ordinal}"
            )
        if _sha256_hex(chunk.original_text) != chunk.content_sha256:
            raise AssertionError(
                f"chunk hash mismatch at ordinal {chunk.ordinal}"
            )
        spans.append((chunk.start_char, chunk.end_char, chunk.ordinal))
    # Non-overlap (mirrors chunks_no_overlap_within_version in SQL): sort by
    # start and require each span to begin at or after the previous end.
    spans.sort()
    for (prev_start, prev_end, prev_ord), (start, _end, ordinal) in zip(
        spans, spans[1:]
    ):
        if start < prev_end:
            raise AssertionError(
                f"chunk spans overlap: ordinal {prev_ord}"
                f" [{prev_start}:{prev_end}) and ordinal {ordinal}"
                f" starting at {start}"
            )
    return chunks


def chunk_document(parsed: ParsedDocument) -> list[Chunk]:
    """Dispatch on structure_hints.kind and validate every chunk."""
    kind = str(parsed.structure_hints.get("kind", "generic"))
    canonical = parsed.canonical_text
    if kind == "legislation":
        chunks = chunk_legislation(canonical)
    elif kind == "decision":
        chunks = chunk_decision(canonical)
    else:
        chunks = chunk_generic(canonical)
    return _validate(canonical, chunks)


def iter_chunks(parsed: ParsedDocument) -> Iterator[Chunk]:
    """Generator form used by the pipeline (streaming into the indexer)."""
    yield from chunk_document(parsed)
