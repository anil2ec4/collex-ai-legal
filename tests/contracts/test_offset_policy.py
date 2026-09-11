"""Cross-language offset-policy parity checks (Python side).

Validates control-plane/fixtures/offset_policy.json with plain Python string
slicing + hashlib, proving that:
  * offsets are Unicode CODE POINT indices (Python str indices) into the NFC
    canonical text;
  * SHA-256-over-UTF-8 hashes match;
  * the fixture set contains at least one case where UTF-16 slicing would
    return the wrong text (the must-fail witness for the TypeScript side).

No server modules are imported; this must stay stdlib-only and offline.
Regenerate fixtures with: .venv/Scripts/python.exe scripts/gen_offset_fixtures.py
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path

import pytest

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "control-plane"
    / "fixtures"
    / "offset_policy.json"
)

FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
CASES = FIXTURE["cases"]
CASE_IDS = [case["name"] for case in CASES]


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def utf16_units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def test_policy_header() -> None:
    policy = FIXTURE["policy"]
    assert policy["offset_unit"] == "unicode_code_points"
    assert policy["normal_form"] == "NFC"
    assert policy["hash"] == "sha256_hex_over_utf8"


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_canonical_text_is_nfc(case: dict) -> None:
    text = case["canonical_text"]
    assert unicodedata.normalize("NFC", text) == text


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_code_point_slice_matches_expected_quote(case: dict) -> None:
    text = case["canonical_text"]
    start, end = case["start"], case["end"]
    assert 0 <= start < end <= len(text)
    assert text[start:end] == case["expected_quote"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_hashes_match(case: dict) -> None:
    assert sha256_hex(case["expected_quote"]) == case["expected_quote_sha256"]
    assert sha256_hex(case["canonical_text"]) == case["expected_content_sha256"]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_utf16_metadata_is_consistent(case: dict) -> None:
    text = case["canonical_text"]
    start, end = case["start"], case["end"]
    utf16_start = utf16_units(text[:start])
    utf16_end = utf16_units(text[:end])
    assert utf16_start == case["utf16_start"]
    assert utf16_end == case["utf16_end"]
    assert case["utf16_differs"] == (utf16_start != start or utf16_end != end)


def test_fixture_contains_utf16_must_fail_witness() -> None:
    """At least one case must discriminate code points from UTF-16 units."""
    assert any(case["utf16_differs"] for case in CASES)


def test_nfd_source_normalizes_to_canonical() -> None:
    nfd_cases = [case for case in CASES if "nfd_source_text" in case]
    assert nfd_cases, "fixture set must include an NFD-input case"
    for case in nfd_cases:
        nfd = case["nfd_source_text"]
        assert nfd != case["canonical_text"]
        assert unicodedata.normalize("NFC", nfd) == case["canonical_text"]
        # Offsets computed for NFC must NOT generally be valid for the NFD
        # spelling — that is exactly why validators normalize first.
        assert len(nfd) != len(case["canonical_text"])
