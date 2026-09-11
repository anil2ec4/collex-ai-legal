"""(e) Structural chunkers — pure unit tests, no database.

The decision chunker is the headline case: a Yargıtay/KVKK decision must
split into the sections a lawyer actually cites (özet / olay / gerekçe /
hüküm) with the caption block kept separately, because "authority" and
"stance" attach to the gerekçe and hüküm, not to the whole document.

Every assertion here also re-checks the module's core contract: each chunk
is an exact code-point slice of the canonical text, hashed over its own
UTF-8 bytes, and no two chunks of one document overlap.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata

import pytest

from ingestion.chunking import (
    NORMALIZER_VERSION,
    Chunk,
    chunk_document,
    chunk_generic,
    chunk_legislation,
)
from ingestion.ports import FixtureSource

DECISION_SECTIONS = [
    "bolum-baslik", "bolum-ozet", "bolum-olay", "bolum-gerekce",
    "bolum-hukum",
]


def _parse(corpus_dir, filename):
    source = FixtureSource(corpus_dir, include=[filename])
    ref = next(iter(source.list_documents()))
    return source.parse(source.fetch_raw(ref))


def _assert_contract(canonical: str, chunks: list[Chunk]) -> None:
    assert chunks, "chunker produced nothing"
    for chunk in chunks:
        assert canonical[chunk.start_char:chunk.end_char] == \
            chunk.original_text
        assert hashlib.sha256(
            chunk.original_text.encode("utf-8")
        ).hexdigest() == chunk.content_sha256
        assert chunk.normalizer_version == NORMALIZER_VERSION
        assert not chunk.original_text[:1].isspace()
        assert not chunk.original_text[-1:].isspace()
    spans = sorted((c.start_char, c.end_char) for c in chunks)
    for (_prev_start, prev_end), (start, _end) in zip(spans, spans[1:]):
        assert start >= prev_end, f"chunk spans overlap around {start}"
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


@pytest.mark.parametrize(
    "filename",
    ["yargitay_karar_1.json", "yargitay_karar_2.json", "kvkk_karar_1.json"],
)
def test_decision_chunker_emits_the_expected_sections(corpus_dir, filename):
    parsed = _parse(corpus_dir, filename)
    assert parsed.structure_hints["kind"] == "decision"

    chunks = chunk_document(parsed)
    _assert_contract(parsed.canonical_text, chunks)

    paths = [list(c.structural_path) for c in chunks]
    assert paths == [[section] for section in DECISION_SECTIONS], paths


def test_decision_sections_carry_the_right_text(corpus_dir):
    parsed = _parse(corpus_dir, "yargitay_karar_1.json")
    by_path = {
        c.structural_path[0]: c.original_text
        for c in chunk_document(parsed)
    }

    assert by_path["bolum-baslik"].startswith("T.C. YARGITAY")
    assert "Esas No: 2023/4521" in by_path["bolum-baslik"]
    assert by_path["bolum-ozet"].startswith("ÖZET:")
    assert by_path["bolum-olay"].startswith("OLAY:")
    assert by_path["bolum-gerekce"].startswith("GEREKÇE:")
    assert by_path["bolum-hukum"].startswith("HÜKÜM:")
    # Section boundaries must not bleed into one another.
    assert "GEREKÇE:" not in by_path["bolum-olay"]
    assert "HÜKÜM:" not in by_path["bolum-gerekce"]
    assert "ONANMASINA" in by_path["bolum-hukum"]


def test_legislation_chunker_splits_madde_and_fikra(corpus_dir):
    parsed = _parse(corpus_dir, "kanun_5237_v1.json")
    chunks = chunk_document(parsed)
    _assert_contract(parsed.canonical_text, chunks)

    labels = [(c.article_no, c.paragraph_no) for c in chunks]
    assert ("141", "1") in labels and ("141", "2") in labels
    assert ("157", "1") in labels
    assert ("158", "1") in labels and ("158", "2") in labels

    first = next(c for c in chunks if c.article_no == "141"
                 and c.paragraph_no == "1")
    assert first.original_text.startswith("MADDE 141 -"), (
        "the madde header belongs to its first fıkra"
    )
    assert list(first.structural_path) == ["madde-141", "fikra-1"]

    # In-text parenthesised numbers must not be mistaken for fıkra markers.
    for chunk in chunks:
        assert chunk.paragraph_no is None or chunk.paragraph_no.isdigit()


def test_legislation_chunker_handles_prefixed_maddeler():
    canonical = unicodedata.normalize("NFC", (
        "GEÇİCİ MADDE 3 - (1) Birinci fıkra metni.\n"
        "(2) İkinci fıkra metni.\n\n"
        "EK MADDE 8 - Ek madde metni.\n"
    ))
    chunks = chunk_legislation(canonical)
    _assert_contract(canonical, chunks)

    assert [c.article_no for c in chunks] == ["Geçici 3", "Geçici 3", "Ek 8"]
    assert list(chunks[0].structural_path) == ["madde-gecici-3", "fikra-1"]
    assert list(chunks[2].structural_path) == ["madde-ek-8"]


def test_generic_chunker_splits_on_blank_lines(corpus_dir):
    parsed = _parse(corpus_dir, "filler_dilekce.json")
    assert parsed.structure_hints["kind"] == "generic"

    chunks = chunk_document(parsed)
    _assert_contract(parsed.canonical_text, chunks)
    assert [list(c.structural_path) for c in chunks] == [
        [f"paragraf-{i + 1}"] for i in range(len(chunks))
    ]
    assert chunks[0].original_text.startswith("SAYIN İSTANBUL")
    assert "SONUÇ VE İSTEM" in chunks[-1].original_text


def test_generic_chunker_caps_a_single_paragraph_without_blank_lines():
    """W12-FIX (02.09.2026): a 3 MB TXT with no blank line used to become ONE
    chunk; every piece must stay an exact, non-overlapping slice and no piece
    may exceed MAX_GENERIC_CHUNK_CHARS."""
    from ingestion.chunking import MAX_GENERIC_CHUNK_CHARS

    line = "Satır {n}: davacı vekili tebligatı 14.08.2026 tarihinde aldı; süre bu tarihten işler.\n"
    canonical = "".join(line.format(n=n) for n in range(30_000))  # ~2.6 MB, no blank line
    chunks = chunk_generic(canonical)
    _assert_contract(canonical, chunks)
    assert len(chunks) > 500
    assert max(len(c.original_text) for c in chunks) <= MAX_GENERIC_CHUNK_CHARS
    # Pieces end at line boundaries when a newline is available.
    assert all(canonical[c.end_char:c.end_char + 1] in ("\n", "") for c in chunks)
    # The pieces cover the text in order: nothing lost between them but whitespace.
    joined = "".join(c.original_text for c in chunks)
    assert joined.replace("\n", "") == canonical.replace("\n", "")


def test_generic_chunker_caps_one_endless_sentence_stream():
    """No newline at all: sentence ends, then spaces, then a hard cut."""
    from ingestion.chunking import MAX_GENERIC_CHUNK_CHARS

    canonical = "Kiracı depozitoyu ödedi. " * 2000 + "x" * 9000
    chunks = chunk_generic(canonical)
    _assert_contract(canonical, chunks)
    assert max(len(c.original_text) for c in chunks) <= MAX_GENERIC_CHUNK_CHARS
    assert len(chunks) >= (len(canonical) // MAX_GENERIC_CHUNK_CHARS)
    # Short paragraphs are untouched.
    assert len(chunk_generic("kısa paragraf\n\nikinci paragraf")) == 2


def test_legislation_without_maddeler_falls_back_to_paragraphs():
    canonical = "Başlıksız bir metin.\n\nİkinci paragraf."
    chunks = chunk_legislation(canonical)
    _assert_contract(canonical, chunks)
    assert [list(c.structural_path) for c in chunks] == [
        ["belge-1"], ["belge-2"]
    ]


def test_chunker_rejects_overlapping_output(monkeypatch, corpus_dir):
    """_validate is the app-side mirror of chunks_no_overlap_within_version."""
    parsed = _parse(corpus_dir, "yargitay_karar_1.json")
    good = chunk_document(parsed)
    overlapping = list(good)
    victim = overlapping[2]
    overlapping[2] = Chunk(
        ordinal=victim.ordinal,
        structural_path=victim.structural_path,
        article_no=victim.article_no,
        paragraph_no=victim.paragraph_no,
        start_char=overlapping[1].start_char + 1,
        end_char=victim.end_char,
        original_text=parsed.canonical_text[
            overlapping[1].start_char + 1:victim.end_char
        ],
        search_text=victim.search_text,
        content_sha256=hashlib.sha256(
            parsed.canonical_text[
                overlapping[1].start_char + 1:victim.end_char
            ].encode("utf-8")
        ).hexdigest(),
        token_count=victim.token_count,
    )
    monkeypatch.setattr(
        "ingestion.chunking.chunk_decision", lambda _c: overlapping
    )
    with pytest.raises(AssertionError, match="overlap"):
        chunk_document(parsed)


def test_offsets_are_code_points_not_bytes(corpus_dir):
    """Turkish text is multi-byte; a byte-offset bug would show here."""
    parsed = _parse(corpus_dir, "kvkk_karar_1.json")
    canonical = parsed.canonical_text
    assert len(canonical.encode("utf-8")) > len(canonical)

    for chunk in chunk_document(parsed):
        assert canonical[chunk.start_char:chunk.end_char] == \
            chunk.original_text
        byte_slice = canonical.encode("utf-8")[
            chunk.start_char:chunk.end_char
        ]
        if byte_slice != chunk.original_text.encode("utf-8"):
            break
    else:  # pragma: no cover - defensive
        pytest.fail(
            "byte and code-point slices agreed everywhere; the fixture no"
            " longer exercises the distinction"
        )


def test_canonical_text_is_nfc_normalised(corpus_dir):
    for path in sorted(corpus_dir.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))["text"]
        parsed_text = unicodedata.normalize("NFC", raw)
        assert unicodedata.is_normalized("NFC", parsed_text)


def test_empty_input_produces_no_chunks():
    assert chunk_generic("") == []
    assert chunk_generic("   \n\n  ") == []
