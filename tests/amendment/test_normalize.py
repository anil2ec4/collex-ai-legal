# tests/amendment/test_normalize.py
"""Unit tests for the search-side Turkish normalizer (brief 8.4)."""

from legal_reference.normalize import normalize_turkish_search, turkish_lower


class TestTurkishCasing:
    def test_dotted_capital_i_lowers_to_plain_i(self):
        assert normalize_turkish_search("İSTANBUL") == "istanbul"

    def test_dotless_capital_i_lowers_to_dotless_i(self):
        assert normalize_turkish_search("ISPARTA") == "ısparta"

    def test_mixed_turkish_words(self):
        assert normalize_turkish_search("DIŞ İLİŞKİLER") == "dış ilişkiler"
        assert turkish_lower("İCRA VE İFLAS KANUNU") == "icra ve iflas kanunu"

    def test_no_combining_dot_artifacts(self):
        # Plain str.lower() would produce 'i' + U+0307 for 'İ'.
        result = normalize_turkish_search("İ")
        assert result == "i"
        assert "̇" not in result


class TestPunctuationUnification:
    def test_dash_variants_unified(self):
        for dash in "‐‑‒–—":
            assert normalize_turkish_search(f"a {dash} b") == "a - b"

    def test_curly_quotes_unified(self):
        assert normalize_turkish_search("“tam ifade”") == '"tam ifade"'
        assert normalize_turkish_search("kanun’un") == "kanun'un"

    def test_soft_hyphen_stripped(self):
        assert normalize_turkish_search("mad­de") == "madde"


class TestWhitespaceAndPurity:
    def test_whitespace_collapsed_and_trimmed(self):
        assert normalize_turkish_search("  a \t b\n\nc  ") == "a b c"

    def test_original_text_is_never_mutated(self):
        original = "  5237 Sayılı KANUN  "
        snapshot = str(original)
        normalize_turkish_search(original)
        assert original == snapshot  # search-side only, input untouched

    def test_empty_input(self):
        assert normalize_turkish_search("") == ""
        assert normalize_turkish_search("   ") == ""
