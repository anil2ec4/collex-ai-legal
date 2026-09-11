"""Cross-language reference-parser parity checks (Python side).

``evals/fixtures/reference_parity.json`` is the SINGLE specification shared by

  * ``legal_reference/parser.py``                        (this file)
  * ``control-plane/src/retrieval/referenceParser.ts``   (parser-parity.test.ts)

Both implementations must reproduce every serialized reference exactly, and
both normalizers must agree byte-for-byte on every corpus input. That is the
systemic fix for the divergence that let the TypeScript parser emit legally
wrong captures (RG issue numbers as law numbers, "25/II" read as "25/I",
"K. 2021/5678 sayılı kararı" read as legislation 5678) while the Python parser
quietly supported forms the TypeScript one had never heard of.

No server modules are imported; this stays offline and stdlib-only apart from
``legal_reference``. Regenerate fixtures with:
  .venv/Scripts/python.exe scripts/gen_reference_fixtures.py
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import pytest

from legal_reference.abbreviations import ABBREVIATIONS
from legal_reference.normalize import normalize_turkish_search
from legal_reference.parser import parse_references

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "evals"
    / "fixtures"
    / "reference_parity.json"
)

FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
CASES = FIXTURE["cases"]
CASE_IDS = [case["name"] for case in CASES]

REQUIRED_GROUPS = {
    "legislation", "abbreviation", "article", "court", "gazette", "guard",
    "multi",
}

# The abbreviations a Turkish lawyer types every day. Losing any of these
# silently re-breaks the exact-reference lane.
REQUIRED_ABBREVIATIONS = {
    "TCK": "5237", "CMK": "5271", "TBK": "6098", "TMK": "4721",
    "HMK": "6100", "İİK": "2004", "TTK": "6102", "VUK": "213",
    "İYUK": "2577", "KVKK": "6698", "İŞK": "4857", "ANAYASA": "2709",
    "AATUHK": "6183", "KDVK": "3065", "GVK": "193", "KVK": "5520",
    "SSGSSK": "5510", "İMARK": "3194", "TKHK": "6502", "FSEK": "5846",
    "SERPK": "6362", "KABK": "5326", "CGTİHK": "5275", "ETCK": "765",
    "HUMK": "1086",
}

MULGA_ABBREVIATIONS = {"ETCK", "HUMK", "ETTK", "EBK", "CMUK"}


def serialize(ref) -> dict:
    """Language-neutral dict for one parsed reference.

    Kept in lockstep with ``scripts/gen_reference_fixtures.py`` and with
    ``serialize()`` in ``control-plane/tests/parser-parity.test.ts``.
    """
    return {
        "kind": ref.kind,
        "raw": ref.raw,
        "span": [ref.span[0], ref.span[1]],
        "legislation_no": ref.legislation_no,
        "article_no": ref.article_no,
        "docket_no": ref.docket_no,
        "decision_no": ref.decision_no,
        "year": ref.year,
        "name": ref.name,
        "article_kind": ref.article_kind,
        "paragraph": ref.paragraph,
        "clause": ref.clause,
        "abbreviation": ref.abbreviation,
        "canonical_name": ref.canonical_name,
        "mulga": bool(ref.mulga),
        "court": ref.court,
        "chamber": ref.chamber,
        "docket_kind": ref.docket_kind,
        "decision_date": ref.decision_date,
        "rg_date": ref.rg_date,
        "rg_no": ref.rg_no,
    }


# ---------------------------------------------------------------------------
# Fixture shape
# ---------------------------------------------------------------------------


def test_policy_header() -> None:
    policy = FIXTURE["policy"]
    assert policy["normal_form"] == "NFC"
    assert policy["offset_unit"] == "unicode_code_points"
    assert policy["bmp_only"] is True
    assert FIXTURE["generated_by"] == "scripts/gen_reference_fixtures.py"


def test_corpus_is_large_enough() -> None:
    assert len(CASES) >= 70, "the parity corpus is the drift alarm; keep it big"


def test_corpus_covers_every_family() -> None:
    groups = {case["group"] for case in CASES}
    assert REQUIRED_GROUPS <= groups, REQUIRED_GROUPS - groups


def test_guard_cases_expect_nothing() -> None:
    guards = [case for case in CASES if case["group"] == "guard"]
    assert len(guards) >= 10
    for case in guards:
        assert case["expected"] == [], case["name"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_case_text_is_nfc_and_bmp(case: dict) -> None:
    text = case["text"]
    assert unicodedata.normalize("NFC", text) == text
    # UTF-16 (JavaScript) and code point (Python) indices only agree on BMP
    # text; every real Turkish citation is BMP.
    assert all(ord(char) <= 0xFFFF for char in text)


# ---------------------------------------------------------------------------
# Abbreviation table
# ---------------------------------------------------------------------------


def test_abbreviation_table_matches_fixture() -> None:
    actual = [
        {
            "key": entry.key,
            "legislation_no": entry.legislation_no,
            "canonical_name": entry.canonical_name,
            "mulga": entry.mulga,
            "variants": list(entry.variants),
        }
        for entry in ABBREVIATIONS
    ]
    assert actual == FIXTURE["abbreviations"]


def test_required_abbreviations_present() -> None:
    by_key = {entry["key"]: entry for entry in FIXTURE["abbreviations"]}
    for key, number in REQUIRED_ABBREVIATIONS.items():
        assert key in by_key, key
        assert by_key[key]["legislation_no"] == number, key


def test_historical_instruments_are_flagged() -> None:
    by_key = {entry["key"]: entry for entry in FIXTURE["abbreviations"]}
    for key in MULGA_ABBREVIATIONS:
        assert by_key[key]["mulga"] is True, key


def test_abbreviation_numbers_are_unique() -> None:
    numbers = [entry["legislation_no"] for entry in FIXTURE["abbreviations"]]
    assert len(numbers) == len(set(numbers))


# ---------------------------------------------------------------------------
# Parser parity
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_parse_matches_fixture(case: dict) -> None:
    actual = [serialize(ref) for ref in parse_references(case["text"])]
    assert actual == case["expected"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_spans_slice_back_to_raw(case: dict) -> None:
    text = case["text"]
    for ref in parse_references(text):
        start, end = ref.span
        assert text[start:end] == ref.raw


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_parser_never_mutates_input(case: dict) -> None:
    text = case["text"]
    snapshot = str(text)
    parse_references(text)
    assert text == snapshot


# ---------------------------------------------------------------------------
# Normalizer parity (the reviewer confirmed agreement on 21 inputs; this locks
# it in across the whole corpus)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_normalizer_matches_fixture(case: dict) -> None:
    assert normalize_turkish_search(case["text"]) == case["normalized"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_normalizer_is_idempotent(case: dict) -> None:
    once = case["normalized"]
    assert normalize_turkish_search(once) == once
