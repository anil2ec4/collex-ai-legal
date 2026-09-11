"""Authoritative Turkish legal abbreviation table (TCK, TBK, İİK, ...).

Turkish lawyers overwhelmingly cite legislation by abbreviation ("TCK m. 157",
"İİK 89", "TBK 49") rather than by number, so an exact-reference lane that
only understands "<no> sayılı <ad> Kanunu" misses the most common query form
entirely. This module is the single source of truth mapping the standard
abbreviations to (legislation number, canonical name), including the
historical/mülga instruments a citation may legitimately point at.

Design notes
------------
* Every entry carries an explicit ``mulga`` flag. A hit on a repealed
  instrument must be FLAGGED (the resolver adds a note and sets
  ``is_mulga``), never silently resolved as if it were current law.
* Matching happens on the length-preserving "shadow" fold (see
  ``normalize.shadow_fold``), so casing, curly quotes and dash variants are
  already unified. Dotted/dotless ``i`` is deliberately folded into a
  ``[iı]`` character class per position, so "İİK", "IIK", "İIK" and "IİK" all
  match the same entry.
* Inflected forms are handled by the parser via an optional ``'<ek>``
  apostrophe suffix ("TCK'nın", "İİK'nun", "TTK'nın", "Anayasa'nın").
* ``guard`` holds an extra regex assertion appended after a variant to kill a
  known false positive (e.g. "Anayasa Mahkemesi" is a COURT, not the
  Constitution).

The exact same table is mirrored in
``control-plane/src/retrieval/referenceParser.ts``; the cross-language parity
fixture (``evals/fixtures/reference_parity.json``) pins both copies so drift
breaks CI in both languages.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from .normalize import shadow_fold

__all__ = [
    "ABBREVIATIONS",
    "LawAbbreviation",
    "abbreviation_alternation",
    "literal_pattern",
    "lookup_abbreviation",
    "lookup_by_number",
]


@dataclass(frozen=True)
class LawAbbreviation:
    """One abbreviation -> legislation mapping."""

    key: str                 # canonical uppercase key ("TCK")
    legislation_no: str      # "5237"
    canonical_name: str      # "Türk Ceza Kanunu"
    mulga: bool = False      # repealed instrument (flag, never hide)
    variants: tuple = ()     # written forms recognised in text
    guard: str = ""          # extra regex assertion appended after a variant


# NOTE ON OMISSIONS: "BK" (Borçlar Kanunu) is deliberately NOT a variant --
# "bk." is also the Turkish abbreviation for "bakınız" (= "see"), which would
# turn every cross-reference into a bogus legislation hit. Only the explicit
# "eBK" / "eski BK" forms are accepted.
ABBREVIATIONS: tuple = (
    LawAbbreviation("TCK", "5237", "Türk Ceza Kanunu", False, ("TCK",)),
    LawAbbreviation(
        "ETCK", "765", "Türk Ceza Kanunu (765 sayılı)", True,
        ("ETCK", "eTCK", "eski TCK", "mülga TCK"),
    ),
    LawAbbreviation("CMK", "5271", "Ceza Muhakemesi Kanunu", False, ("CMK",)),
    LawAbbreviation(
        "CMUK", "1412", "Ceza Muhakemeleri Usulü Kanunu", True, ("CMUK",),
    ),
    LawAbbreviation("TBK", "6098", "Türk Borçlar Kanunu", False, ("TBK",)),
    LawAbbreviation(
        "EBK", "818", "Borçlar Kanunu (818 sayılı)", True,
        ("eBK", "eski BK", "mülga BK"),
    ),
    LawAbbreviation("TMK", "4721", "Türk Medenî Kanunu", False, ("TMK", "MK")),
    LawAbbreviation("HMK", "6100", "Hukuk Muhakemeleri Kanunu", False, ("HMK",)),
    LawAbbreviation(
        "HUMK", "1086", "Hukuk Usulü Muhakemeleri Kanunu", True, ("HUMK",),
    ),
    LawAbbreviation(
        "İİK", "2004", "İcra ve İflas Kanunu", False, ("İİK", "IIK", "İIK", "IİK"),
    ),
    LawAbbreviation("TTK", "6102", "Türk Ticaret Kanunu", False, ("TTK",)),
    LawAbbreviation(
        "ETTK", "6762", "Türk Ticaret Kanunu (6762 sayılı)", True,
        ("ETTK", "eTTK", "eski TTK"),
    ),
    LawAbbreviation("VUK", "213", "Vergi Usul Kanunu", False, ("VUK",)),
    LawAbbreviation(
        "İYUK", "2577", "İdari Yargılama Usulü Kanunu", False, ("İYUK", "IYUK"),
    ),
    LawAbbreviation(
        "KVKK", "6698", "Kişisel Verilerin Korunması Kanunu", False, ("KVKK",),
    ),
    LawAbbreviation(
        "İŞK", "4857", "İş Kanunu", False, ("İş K.", "İş Kanunu", "İşK"),
    ),
    LawAbbreviation(
        "ANAYASA", "2709", "Türkiye Cumhuriyeti Anayasası", False,
        ("Anayasa",),
        guard=r"(?!\s*(?:mahkeme|mahkemesi|mahkemesinin|mahkemesince))",
    ),
    LawAbbreviation(
        "AATUHK", "6183",
        "Amme Alacaklarının Tahsil Usulü Hakkında Kanun", False, ("AATUHK",),
    ),
    LawAbbreviation(
        "KDVK", "3065", "Katma Değer Vergisi Kanunu", False,
        ("KDVK", "KDV Kanunu"),
    ),
    LawAbbreviation("GVK", "193", "Gelir Vergisi Kanunu", False, ("GVK",)),
    LawAbbreviation("KVK", "5520", "Kurumlar Vergisi Kanunu", False, ("KVK",)),
    LawAbbreviation(
        "SSGSSK", "5510",
        "Sosyal Sigortalar ve Genel Sağlık Sigortası Kanunu", False,
        ("SSGSSK", "SGK Kanunu"),
    ),
    LawAbbreviation(
        "İMARK", "3194", "İmar Kanunu", False, ("İmar Kanunu", "İmar K."),
    ),
    LawAbbreviation(
        "TKHK", "6502", "Tüketicinin Korunması Hakkında Kanun", False, ("TKHK",),
    ),
    LawAbbreviation(
        "FSEK", "5846", "Fikir ve Sanat Eserleri Kanunu", False, ("FSEK",),
    ),
    LawAbbreviation(
        "SERPK", "6362", "Sermaye Piyasası Kanunu", False,
        ("SerPK", "SPKn"),
    ),
    LawAbbreviation(
        "KABK", "5326", "Kabahatler Kanunu", False, ("Kabahatler Kanunu", "KabK"),
    ),
    LawAbbreviation(
        "CGTİHK", "5275",
        "Ceza ve Güvenlik Tedbirlerinin İnfazı Hakkında Kanun", False,
        ("CGTİHK", "CGTIHK"),
    ),
)

_WS_RE = re.compile(r"\s+")


def _canonical_key(written: str) -> str:
    """Normalise a written abbreviation to its lookup key.

    Folds case/punctuation, collapses whitespace, drops any Turkish
    apostrophe suffix ("TCK'nın" -> "TCK") and unifies dotted/dotless i.
    """
    folded = shadow_fold(written)
    folded = folded.split("'", 1)[0]
    folded = _WS_RE.sub(" ", folded).strip()
    return folded.replace("ı", "i")


_BY_KEY: dict = {}
for _entry in ABBREVIATIONS:
    for _variant in _entry.variants:
        _BY_KEY.setdefault(_canonical_key(_variant), _entry)
    _BY_KEY.setdefault(_canonical_key(_entry.key), _entry)

_BY_NUMBER: dict = {entry.legislation_no: entry for entry in ABBREVIATIONS}


def lookup_abbreviation(written: str) -> Optional[LawAbbreviation]:
    """Return the entry for a written abbreviation, or None."""
    if not written:
        return None
    return _BY_KEY.get(_canonical_key(written))


def lookup_by_number(legislation_no: Optional[str]) -> Optional[LawAbbreviation]:
    """Return the entry for an explicit legislation number, or None."""
    if not legislation_no:
        return None
    return _BY_NUMBER.get(str(legislation_no).strip().lstrip("0") or "0")


# Characters that must be backslash-escaped inside a regex. Deliberately a
# FIXED set (not re.escape) because JavaScript's unicode-mode regexes reject
# useless escapes such as "\'", and the TypeScript port must build the exact
# same pattern.
_RE_SPECIAL = set(".*+?^${}()|[]\\")


def literal_pattern(text: str) -> str:
    """Regex source matching ``text`` verbatim on shadow-folded input.

    Spaces become ``\\s+`` and every dotted/dotless ``i`` becomes ``[iı]`` so
    that "İİK"/"IIK"/"İIK"/"IİK" and "DANIŞTAY"/"Danıştay" all match. Mirrored
    by ``literalPattern`` in the TypeScript parser.
    """
    parts: list = []
    for char in shadow_fold(text):
        if char.isspace():
            parts.append(r"\s+")
        elif char in "iı":
            parts.append("[iı]")
        elif char in _RE_SPECIAL:
            parts.append("\\" + char)
        else:
            parts.append(char)
    return "".join(parts)


_variant_pattern = literal_pattern


def abbreviation_alternation() -> str:
    """Alternation of every variant, longest first (deterministic order).

    Longest-first ordering matters: "KVKK" must win over "KVK", and
    "İş Kanunu" over "İş K.".
    """
    items: list = []
    for entry in ABBREVIATIONS:
        for variant in entry.variants:
            items.append((_variant_pattern(variant) + entry.guard, shadow_fold(variant)))
    items.sort(key=lambda pair: (-len(pair[1]), pair[1]))
    return "|".join(pattern for pattern, _ in items)
