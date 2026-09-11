"""Search-side Turkish text normalization.

Mirrors the ``normalizeTurkishSearch`` TypeScript function from the master
build brief (section 8.4):

    NFC normalize
    -> strip soft hyphens (U+00AD)
    -> unify dash variants to '-'
    -> unify curly quotes to straight quotes
    -> lowercase with Turkish locale semantics
    -> collapse whitespace
    -> trim

IMPORTANT: This function is SEARCH-SIDE ONLY. It must never be used to mutate
original/legal source text. Store the original text untouched and keep the
normalized form in a separate search field (brief 8.4: "Orijinal metni asla
degistirme; normalize edilmis arama alanini ayri tut").

Turkish casing note: Python's ``str.lower()`` does not implement Turkish
locale rules -- ``'I'.lower()`` yields ``'i'`` (wrong for Turkish, should be
dotless ``'ı'``) and ``'İ'.lower()`` yields ``'i' + U+0307`` (combining dot,
also wrong). We therefore translate ``'I' -> 'ı'`` and ``'İ' -> 'i'`` FIRST,
then apply ``str.lower()`` for the remaining characters, which is correct and
length-preserving for Turkish text.
"""

from __future__ import annotations

import re
import unicodedata

__all__ = ["normalize_turkish_search", "shadow_fold", "turkish_lower"]

# Dash variants (hyphen, non-breaking hyphen, figure dash, en dash, em dash)
# unified to ASCII '-'. Same set as the brief's /[‐‑‒–—]/ character class.
_DASH_MAP = {ord(c): "-" for c in "‐‑‒–—"}

# Curly double quotes -> '"', curly single quotes -> "'".
_QUOTE_MAP = {ord(c): '"' for c in "“”„‟"}
_QUOTE_MAP.update({ord(c): "'" for c in "‘’"})

# Turkish-specific lowercase mappings applied BEFORE str.lower().
_TR_LOWER_MAP = {ord("I"): "ı", ord("İ"): "i"}  # I -> ı, İ -> i

_WS_RE = re.compile(r"\s+")


def turkish_lower(text: str) -> str:
    """Lowercase ``text`` with Turkish (tr-TR) dotted/dotless-i semantics.

    ``'I' -> 'ı'`` and ``'İ' -> 'i'`` are applied before ``str.lower()`` so
    the dotted/dotless distinction survives. Length-preserving for Turkish
    input (the only unconditional multi-char lowercase mapping in Unicode,
    U+0130, is translated away first).
    """
    return text.translate(_TR_LOWER_MAP).lower()


def shadow_fold(text: str) -> str:
    """LENGTH-PRESERVING lowercase + punctuation unification for matching.

    Unlike :func:`normalize_turkish_search` this never strips soft hyphens
    and never collapses whitespace, so every character keeps its index. The
    reference parser runs all of its regexes over this "shadow" copy and
    slices the ORIGINAL NFC text with the resulting spans, which is what lets
    ``raw`` keep its real casing while matching stays case-insensitive.

    Mirrored byte-for-byte by ``shadowFold`` in
    ``control-plane/src/retrieval/normalize.ts``.
    """
    return text.translate(_TR_LOWER_MAP).lower().translate(_DASH_MAP).translate(
        _QUOTE_MAP
    )


def normalize_turkish_search(text: str) -> str:
    """Return the search-side normalized form of ``text``.

    Never use the return value to overwrite the original text; it exists only
    for matching/indexing (separate search field).
    """
    normalized = unicodedata.normalize("NFC", text)
    normalized = normalized.replace("­", "")  # soft hyphen
    normalized = normalized.translate(_DASH_MAP)
    normalized = normalized.translate(_QUOTE_MAP)
    normalized = turkish_lower(normalized)
    normalized = _WS_RE.sub(" ", normalized)
    return normalized.strip()
