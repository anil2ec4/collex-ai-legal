# tests/amendment/test_abbreviations.py
"""Tests for the Turkish legal abbreviation table (brief 6.8 / 8.4).

Turkish lawyers cite by abbreviation far more often than by number, so this
table is what makes "TCK m. 157" a HIGH-confidence exact reference instead of
an abstain. These tests pin the mapping itself; the parser/resolver wiring is
covered in test_parser.py / test_resolver.py, and cross-language parity in
tests/contracts/test_parser_parity.py.
"""

import re

from legal_reference.abbreviations import (
    ABBREVIATIONS,
    abbreviation_alternation,
    literal_pattern,
    lookup_abbreviation,
    lookup_by_number,
)


class TestTableIntegrity:
    def test_keys_and_numbers_are_unique(self):
        keys = [entry.key for entry in ABBREVIATIONS]
        numbers = [entry.legislation_no for entry in ABBREVIATIONS]
        assert len(keys) == len(set(keys))
        assert len(numbers) == len(set(numbers))

    def test_every_entry_has_a_number_and_canonical_name(self):
        for entry in ABBREVIATIONS:
            assert entry.legislation_no.isdigit(), entry.key
            assert entry.canonical_name.strip(), entry.key
            assert entry.variants, entry.key

    def test_required_abbreviations_map_to_the_right_law(self):
        expected = {
            "TCK": "5237", "CMK": "5271", "TBK": "6098", "TMK": "4721",
            "HMK": "6100", "İİK": "2004", "TTK": "6102", "VUK": "213",
            "İYUK": "2577", "KVKK": "6698", "İŞK": "4857", "ANAYASA": "2709",
            "AATUHK": "6183", "KDVK": "3065", "GVK": "193", "KVK": "5520",
            "SSGSSK": "5510", "İMARK": "3194", "TKHK": "6502", "FSEK": "5846",
            "SERPK": "6362", "KABK": "5326", "CGTİHK": "5275",
        }
        for key, number in expected.items():
            entry = lookup_abbreviation(key)
            assert entry is not None, key
            assert entry.legislation_no == number, key

    def test_historical_instruments_are_flagged_mulga(self):
        # A citation to eTCK/HUMK/eTTK is legitimate but HISTORICAL; the flag
        # is what stops the resolver from answering with current law.
        for key, number in [
            ("ETCK", "765"), ("HUMK", "1086"), ("ETTK", "6762"),
            ("EBK", "818"), ("CMUK", "1412"),
        ]:
            entry = lookup_abbreviation(key)
            assert entry is not None and entry.mulga is True, key
            assert entry.legislation_no == number

    def test_current_instruments_are_not_flagged(self):
        for key in ["TCK", "TBK", "TTK", "HMK", "CMK"]:
            assert lookup_abbreviation(key).mulga is False, key

    def test_bk_is_deliberately_absent(self):
        # "bk." is Turkish for "bakınız" (= see); mapping it to the Borçlar
        # Kanunu would turn every cross-reference into a bogus law hit.
        assert lookup_abbreviation("BK") is None
        assert all("BK" not in entry.variants for entry in ABBREVIATIONS)


class TestLookup:
    def test_lookup_is_case_and_apostrophe_insensitive(self):
        for written in ["TCK", "tck", "Tck", "TCK'nın", "TCK'nun", "tck'nin"]:
            assert lookup_abbreviation(written).legislation_no == "5237", written

    def test_dotted_and_dotless_i_spellings_collapse(self):
        for written in ["İİK", "IIK", "İIK", "IİK", "iik", "ıık"]:
            assert lookup_abbreviation(written).legislation_no == "2004", written

    def test_multi_token_variants(self):
        assert lookup_abbreviation("İş K.").legislation_no == "4857"
        assert lookup_abbreviation("İş Kanunu").legislation_no == "4857"
        assert lookup_abbreviation("Kabahatler Kanunu").legislation_no == "5326"

    def test_unknown_and_empty_input(self):
        assert lookup_abbreviation("") is None
        assert lookup_abbreviation("XYZK") is None

    def test_lookup_by_number(self):
        assert lookup_by_number("5237").key == "TCK"
        assert lookup_by_number("05237").key == "TCK"  # leading zeros stripped
        assert lookup_by_number("765").mulga is True
        assert lookup_by_number(None) is None
        assert lookup_by_number("999999") is None


class TestAlternation:
    def test_alternation_is_a_valid_regex(self):
        compiled = re.compile(abbreviation_alternation())
        assert compiled.search("tck") is not None

    def test_longest_variant_wins(self):
        # KVKK must never be split into KVK + K.
        compiled = re.compile(abbreviation_alternation())
        assert compiled.match("kvkk").group(0) == "kvkk"

    def test_literal_pattern_folds_dotted_i(self):
        assert literal_pattern("İİK") == "[iı][iı]k"
        assert literal_pattern("İş K.") == "[iı]ş\\s+k\\."
