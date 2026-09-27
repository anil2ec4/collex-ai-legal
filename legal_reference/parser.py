"""Exact parser for Turkish legal references (brief sections 6.8 / 8.4).

Extracts structured references from free text WITHOUT mutating it:

- legislation:    "5237 sayılı Türk Ceza Kanunu", "6098 sayılı Kanun", KHK/CBK,
                  "6098 s. TBK", and BARE ABBREVIATIONS ("TCK m. 157",
                  "İİK'nun 89 uncu maddesi", "Anayasa'nın 36'ncı maddesi")
                  resolved through :mod:`legal_reference.abbreviations`,
                  including the keyword-less shorthand lawyers actually type
                  ("TBK 49", "İİK 89", "HMK 177", "TTK 5/A", "VUK 359")
- article:        "m. 157", "md. 157", "madde 157", "157. madde",
                  "157 nci maddesi", "6/A maddesi", "ek madde 5",
                  "geçici madde 2", "geçici 11 inci maddesi",
                  "91/1. maddesi", "m.6/1-a", "madde 25/II"
                  (fıkra -> ``paragraph``, bent -> ``clause``)
- court_decision: "E. 2021/123, K. 2022/456" with E/K variants
                  (Esas/Karar spelled out, ':' / '.' / '-' separators,
                  suffix style "2021/123 E., 2022/456 K."), Yargıtay HGK/CGK
                  hyphenated dockets ("2017/9-1234 E."), AYM bireysel başvuru
                  ("B. No: 2019/12345"), plus the deciding COURT/CHAMBER
                  ("Yargıtay 9. HD", "Danıştay 10. D", "HGK", "AYM Genel
                  Kurul") so an E./K. pair is no longer ambiguous across
                  chambers
- official_gazette (bonus): "26/9/2004 tarihli ve 25611 sayılı Resmî Gazete"

False-positive guards:

- "m." as metre: "100 m. yükseklikte" never yields an article reference — the
  bare "m." form requires a digit AFTER the dot and must not be preceded by a
  number (negative lookbehind), so measurements do not match.
- Initials ("M. Kemal", "E. Yılmaz"): article/court patterns require the
  numeric payload (digits / YYYY/NNN dockets), so name initials do not match.
- Bare counts ("3 madde eklenmiştir"): the suffix article form requires an
  ordinal, a dot, or a sub-number, so plain counts do not match.
- Years ("2004 yılında"): legislation requires the "sayılı"/"s." keyword and a
  law-type word (or a known abbreviation) in the name, so bare years do not
  match.
- "NNNNN sayılı Resmî Gazete" is parsed as an official_gazette (or skipped),
  never as legislation; "K. 2021/5678 sayılı kararı" is a DECISION, never
  legislation no. 5678.
- Implausible docket years (outside 1900..2099) are rejected.
- "Anayasa Mahkemesi" is a court, never the Constitution (2709).

Matching strategy: the input is NFC-normalized once, then a LENGTH-PRESERVING
lowercase/dash/quote transform (:func:`normalize.shadow_fold`) produces a
shadow "match text". All regexes run on the shadow text; captured spans index
into the NFC text so ``raw`` (and names/article numbers) keep their original
casing. Soft hyphens are kept in the shadow text to preserve offsets (a soft
hyphen inside a keyword is a rare edge case and is documented as unsupported).

PORTABILITY: every pattern here avoids ``\\b``, ``\\w`` and ``\\d`` because
those classes mean DIFFERENT things in Python (Unicode-aware) and JavaScript
(ASCII-only) — "ı" is a word character for one and not the other. Explicit
character classes (``_WCH``) and ``[0-9]`` keep the TypeScript port in
``control-plane/src/retrieval/referenceParser.ts`` byte-for-byte equivalent;
``evals/fixtures/reference_parity.json`` pins that equivalence in CI.

Known limitations (documented, additive fixes welcome):

- Bare law names without a number and without an abbreviation entry
  ("Türk Ticaret Kanunu uyarınca") are not parsed; the resolver still accepts
  hand-built name-only references.
- Omnibus-law titles ("... Kanunu ile Bazı Kanunlarda Değişiklik ...") are
  captured lazily up to the first law-type word.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, replace
from typing import Optional

from .abbreviations import (
    abbreviation_alternation,
    literal_pattern,
    lookup_abbreviation,
    lookup_by_number,
)
from .normalize import shadow_fold, turkish_lower

__all__ = [
    "ParsedReference",
    "parse_references",
    "SHORT_FORM_KIND",
    "is_unresolved_short_form",
]

# ---------------------------------------------------------------------------
# ParsedReference
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedReference:
    """One parsed reference. Field names mirror the brief's TS interface.

    ``kind`` is one of ``legislation | article | court_decision`` (per the
    brief) plus the additive ``official_gazette`` and ``short_form`` kinds.
    Every other field is ADDITIVE to the brief's interface.

    ``short_form`` (W14/B-38) is a Turkish ANAPHORIC citation -- "anılan
    karar", "aynı yönde", "agk.", "aynı Kanunun 344 uncu maddesi", or a bare
    article number repeated later in the same text. Its identity fields carry
    the RESOLVED target when the context supplies one, and are ALL ``None``
    when it cannot be resolved. An unresolved short form is the "belirsiz"
    bucket: it must never be rendered as a full citation
    (:func:`is_unresolved_short_form`).
    """

    kind: str  # "legislation" | "article" | "court_decision" | "official_gazette" | "short_form"
    raw: str
    legislation_no: Optional[str] = None
    article_no: Optional[str] = None
    docket_no: Optional[str] = None
    decision_no: Optional[str] = None
    year: Optional[int] = None
    # --- additive fields ---
    name: Optional[str] = None           # legislation name as written in text
    article_kind: Optional[str] = None   # "madde" | "ek" | "geçici"
    paragraph: Optional[str] = None      # fıkra ("1", "II")
    clause: Optional[str] = None         # bent ("a")
    abbreviation: Optional[str] = None   # canonical abbreviation key ("TCK")
    canonical_name: Optional[str] = None  # canonical law name for the abbrev
    mulga: bool = False                  # target is a repealed instrument
    court: Optional[str] = None          # "YARGITAY" | "DANISTAY" | "AYM" | ...
    chamber: Optional[str] = None        # "9. HD" | "HGK" | "10. D" | "1. BOLUM"
    docket_kind: Optional[str] = None    # "esas" | "basvuru"
    decision_date: Optional[str] = None  # "T. 12.05.2022" date as written
    rg_date: Optional[str] = None        # official gazette date as written
    rg_no: Optional[str] = None          # official gazette issue number
    span: tuple = field(default=(0, 0))  # (start, end) into the NFC text


# ---------------------------------------------------------------------------
# Portable character classes (see the PORTABILITY note in the module docstring)
# ---------------------------------------------------------------------------

# Word characters for Turkish legal text. Used instead of \w / \b so that the
# Python and TypeScript engines agree on every boundary.
_WCH = "0-9A-Za-zÇĞİÖŞÜçğıöşüÂÎÛâîû_"
_NB = f"(?<![{_WCH}])"   # not preceded by a word character
_NA = f"(?![{_WCH}])"    # not followed by a word character

# Turkish ordinal suffixes used in article references ("157 nci", "3 üncü").
_ORDINALS = r"(?:ıncı|inci|uncu|üncü|ncı|nci|ncu|ncü)"

# Ordinal WORDS, for "birinci fıkrası" / "Birinci Bölüm".
_ORDINAL_WORDS = {
    "birinci": "1", "ikinci": "2", "üçüncü": "3", "dördüncü": "4",
    "beşinci": "5", "altıncı": "6", "yedinci": "7", "sekizinci": "8",
    "dokuzuncu": "9", "onuncu": "10",
}
_ORDINAL_WORD_ALT = "|".join(sorted(_ORDINAL_WORDS, key=len, reverse=True))


_lit = literal_pattern


def _alt(items) -> str:
    """Alternation of literals, longest first (deterministic)."""
    ordered = sorted(set(items), key=lambda s: (-len(s), s))
    return "|".join(_lit(item) for item in ordered)


# ---------------------------------------------------------------------------
# Court / chamber vocabulary
# ---------------------------------------------------------------------------

_INSTITUTIONS = {
    "yargıtay": "YARGITAY",
    "danıştay": "DANISTAY",
    "anayasa mahkemesi": "AYM",
    "aym": "AYM",
    "uyuşmazlık mahkemesi": "UYUSMAZLIK",
    "sayıştay": "SAYISTAY",
    "bölge adliye mahkemesi": "BAM",
    "bölge idare mahkemesi": "BIM",
    "bam": "BAM",
    "bim": "BIM",
}

# Chamber words -> canonical code. Inflected forms are listed explicitly
# rather than matched with a trailing "\w*" so that the generic "d" (Danıştay
# "10. D") can never swallow the start of an unrelated word.
_CHAMBER_WORDS = {
    "hukuk genel kurulunun": "HGK", "hukuk genel kurulu": "HGK",
    "ceza genel kurulunun": "CGK", "ceza genel kurulu": "CGK",
    "idari dava daireleri kurulunun": "IDDK",
    "idari dava daireleri kurulu": "IDDK",
    "vergi dava daireleri kurulunun": "VDDK",
    "vergi dava daireleri kurulu": "VDDK",
    "idari dava dairesinin": "IDD", "idari dava dairesi": "IDD",
    "hukuk dairesinin": "HD", "hukuk dairesi": "HD",
    "ceza dairesinin": "CD", "ceza dairesi": "CD",
    "genel kurulunun": "GENEL KURUL", "genel kurulu": "GENEL KURUL",
    "genel kurul": "GENEL KURUL",
    "bölümünün": "BOLUM", "bölümü": "BOLUM", "bölüm": "BOLUM",
    "hgk": "HGK", "cgk": "CGK", "iddk": "IDDK", "vddk": "VDDK",
    # Compact Yargıtay forms a petition writes without a space.
    "yhgk": "HGK", "ycgk": "CGK",
    "hd": "HD", "cd": "CD", "idd": "IDD",
    "dairesinin": "D", "dairesince": "D", "dairesi": "D", "daire": "D",
    "d": "D",
}

# Chambers that identify a court all by themselves (no institution needed).
_CHAMBER_STANDALONE = [
    "hukuk genel kurulunun", "hukuk genel kurulu",
    "ceza genel kurulunun", "ceza genel kurulu",
    "idari dava daireleri kurulunun", "idari dava daireleri kurulu",
    "vergi dava daireleri kurulunun", "vergi dava daireleri kurulu",
    "hgk", "cgk", "yhgk", "ycgk", "iddk", "vddk",
]

# Abbreviated institution names written in front of a chamber: "Y.9.HD.",
# "Y. HGK", "Dn. 10. D.". Recognised ONLY when a chamber follows -- a bare
# "Y." or "Dn." is an initial, not a court (W17/c).
_ABBREVIATED_INSTITUTIONS = {
    "y": "YARGITAY", "yarg": "YARGITAY",
    "dn": "DANISTAY", "dan": "DANISTAY",
}

# Chambers that need a leading number to stand alone ("9. HD", "4. CD").
_CHAMBER_NUMBERED = [
    "hukuk dairesinin", "hukuk dairesi", "ceza dairesinin", "ceza dairesi",
    "idari dava dairesinin", "idari dava dairesi", "hd", "cd", "idd",
]

# Institution implied by a standalone chamber.
_CHAMBER_IMPLIES = {
    "HGK": "YARGITAY", "CGK": "YARGITAY",
    "IDDK": "DANISTAY", "VDDK": "DANISTAY",
}

_CH_ORDINAL = (
    r"(?:(?P<chno>[0-9]{1,2})\s*\.\s*|(?P<chord>" + _ORDINAL_WORD_ALT + r")\s+)?"
)

_COURT_RE = re.compile(
    _NB
    + r"(?:"
    + r"(?P<inst>" + _alt(_INSTITUTIONS) + r")(?:'[a-zçğıöşü]{1,8})?"
    + r"(?:\s*,?\s*" + _CH_ORDINAL
    + r"(?P<chword>" + _alt(_CHAMBER_WORDS) + r")(?:'[a-zçğıöşü]{1,8})?)?"
    + r"|(?P<chword2>" + _alt(_CHAMBER_STANDALONE) + r")(?:'[a-zçğıöşü]{1,8})?"
    + r"|(?P<chno3>[0-9]{1,2})\s*\.\s*(?P<chword3>" + _alt(_CHAMBER_NUMBERED)
    + r")(?:'[a-zçğıöşü]{1,8})?"
    # W17/c -- "Y.9.HD.", "Y. HGK", "Dn. 10. D.": an abbreviated institution
    # counts ONLY with a chamber after it.
    + r"|(?P<ainst>" + _alt(_ABBREVIATED_INSTITUTIONS) + r")\s*\.\s*"
    + r"(?:(?P<chno4>[0-9]{1,2})\s*\.\s*(?P<chword4>" + _alt(_CHAMBER_WORDS) + r")"
    + r"|(?P<chword5>" + _alt(_CHAMBER_STANDALONE) + r"))(?:'[a-zçğıöşü]{1,8})?"
    + r")"
    + _NA
)

# A date written between a court and its docket ("12.03.2021 tarih ve").
_GAP_DATE = r"[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}"
_GAP_DATE_RE = re.compile(_GAP_DATE)

# Text tolerated between a court mention and the docket it belongs to.
#
# W17/c -- MEASURED: "Yargıtay 9. HD'nin 12.03.2021 tarih ve 2020/1111 E.,
# 2021/2222 K." and "Y.9.HD. 12.03.2021 T. 2020/1111 E. 2021/2222 K." lost
# their court, because the date between the chamber and the docket was not a
# tolerated gap. The gap now accepts the decision date and its connectors
# ("tarih", "tarihli", "T.", "ve", "günlü") and nothing else.
_COURT_GAP_RE = re.compile(
    r"[\s,;:.'\"\-]*"
    r"(?:(?:kararı|kararında|kararının|kararıyla|karar|ilamı|ilamında|ilam"
    r"|sayılı|tarihli|tarih|günlü|ve|t|n[iıuü]n|[iıuü]n"
    r"|" + _GAP_DATE + r")[\s,;:.'\"\-]*){0,5}"
)

# ---------------------------------------------------------------------------
# Patterns (run on the lowered shadow text)
# ---------------------------------------------------------------------------

# Official Gazette: "26/9/2004 tarihli ve 25611 sayılı Resmî Gazete".
_RG_RE = re.compile(
    r"(?P<date>[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4})\s+tarihl[iı]\s+ve\s+"
    r"(?P<no>[0-9]{4,6})\s+(?:mükerrer\s+)?sayılı\s+(?:mükerrer\s+)?"
    r"resm[iî]\s+gazete"
)

# Docket/decision payload. The optional "-NNN" tail is the Yargıtay HGK/CGK
# form "2017/9-1234" (year / chamber - sequence).
_DOCKET = r"[0-9]{4}\s*/\s*[0-9]{1,6}(?:\s*-\s*[0-9]{1,6})?"

# Optional "T. 12.05.2022" decision date tail.
_TDATE = (
    r"(?:\s*[,;]?\s*t(?:ar[iı]h[" + _WCH + r"]*)?\s*[.:]?\s*"
    r"(?P<tdate>[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}))?"
)

# Court decision, prefix style: "E. 2021/123, K. 2022/456" and variants
# ("Esas No: 2021/123; Karar No: 2022/456", "E.2021/123-K.2022/456", "ve").
_COURT_PREFIX_RE = re.compile(
    _NB + r"e(?:sas[" + _WCH + r"]*)?(?:\s*no)?\s*[.:]?\s*(?P<docket>" + _DOCKET + r")"
    r"\s*[,;-]?\s*(?:ve\s+)?"
    r"k(?:arar[" + _WCH + r"]*)?(?:\s*no)?\s*[.:]?\s*(?P<decision>" + _DOCKET + r")"
    + _TDATE
)

# Court decision, suffix style: "2021/123 E., 2022/456 K." / "... esas ... karar".
_COURT_SUFFIX_RE = re.compile(
    r"(?<![0-9/.])(?P<docket>" + _DOCKET + r")\s*e(?:sas[" + _WCH + r"]*)?\.?"
    r"\s*[,;-]?\s*(?:ve\s+)?"
    r"(?P<decision>" + _DOCKET + r")\s*k(?:arar[" + _WCH + r"]*)?\.?" + _NA
    + _TDATE
)

# Yargıtay HGK/CGK style docket standing alone: "2017/9-1234 E." (no K. yet).
_DOCKET_ONLY_RE = re.compile(
    r"(?<![0-9/.])(?P<docket>[0-9]{4}\s*/\s*[0-9]{1,6}\s*-\s*[0-9]{1,6})"
    r"\s*e(?:sas[" + _WCH + r"]*)?\.?" + _NA
)

# AYM bireysel başvuru: "B. No: 2019/12345", "Başvuru Numarası: 2019/12345".
_BASVURU_RE = re.compile(
    _NB + r"(?:b\s*\.\s*|başvuru\s+)(?:no|numarası|numaralı)\s*[.:]?\s*"
    r"(?P<docket>[0-9]{4}\s*/\s*[0-9]{1,6})" + _NA
)

# AYM bireysel başvuru, number FIRST: "Anayasa Mahkemesi'nin 2014/1234
# başvuru numaralı kararı", "2014/1234 B. No". W17/c -- measured: this form
# produced no reference at all.
_BASVURU_SUFFIX_RE = re.compile(
    r"(?<![0-9/.])(?P<docket>[0-9]{4}\s*/\s*[0-9]{1,6})\s+"
    r"(?:başvuru\s+(?:numaralı|numarası|no)|b\s*\.\s*no)" + _NA
)

_ABBREV_ALT = abbreviation_alternation()

# Legislation: "<no> sayılı <name ending in a law-type word or abbreviation>".
# The name is REQUIRED to end in a law-type word (or a known abbreviation) so
# that "2 sayılı liste", "25611 sayılı Resmî Gazete" and "5678 sayılı kararı"
# are never treated as legislation.
#
# W17/c -- "7445 s. K.", "7445 S.K." and "7445 sayılı K." are how a petition
# abbreviates "sayılı Kanun". MEASURED: none of them was a statute, so the next
# bare "m. 3" was handed to whatever law came before it ("TBK m. 344 ... 7445
# s. K. m. 3" became "TBK m. 3"). The "K." must stand as a word of its own.
_LAW_RE = re.compile(
    r"(?<![0-9/.])(?P<no>[0-9]{1,5})\s+(?:(?:sayılı|s\.)\s+|s\.\s*(?=k\.))"
    r"(?!resm[iî]\s+gazete)"
    r"(?P<name>[^,.;:'\"\n]*?"
    r"(?:kanun\s+hükmünde\s+kararname[" + _WCH + r"]*"
    r"|cumhurbaşkanlığı\s+kararnamesi[" + _WCH + r"]*"
    r"|khk|kanun[" + _WCH + r"]*"
    r"|(?<![" + _WCH + r"])k\."
    r"|(?:" + _ABBREV_ALT + r")))" + _NA
)

_ABBREV_HEAD = (
    _NB + r"(?P<abbr>" + _ABBREV_ALT + r")(?P<suffix>'[a-zçğıöşü]{1,8})?" + _NA
)

# Ek / geçici articles: "ek madde 5", "geçici madde 2", "geçici 11 inci maddesi".
# In the "<n> ... madde" branch the ordinal is REQUIRED so that counts like
# "ek 3 madde eklenmiştir" do not match.
_EK_GECICI_RE = re.compile(
    _NB + r"(?P<akind>ek|geçici)\s+"
    r"(?:madde\s*(?P<n1>[0-9]{1,4})" + _NA
    + r"|(?P<n2>[0-9]{1,4})\s*'?\s*" + _ORDINALS + r"\s+madde[" + _WCH + r"]*)"
)

# The article payload shared by the suffix and prefix forms:
#   157        -> art
#   6/A        -> art + sub (letter)   => article_no "6/A"
#   91/1       -> art + sub (digits)   => article_no "91", paragraph "1"
#   25/II      -> art + sub (roman)    => article_no "25", paragraph "II"
#   6/1-a      -> art + sub + clause   => article_no "6", paragraph "1",
#                                         clause "a"
def _article_token(prefix: str) -> str:
    return (
        rf"(?P<{prefix}art>[0-9]{{1,4}})"
        # NOTE: "II" folds to "ıı" (I -> dotless ı), so the Roman-numeral class
        # must accept BOTH dotted and dotless i.
        rf"(?:\s*/\s*(?P<{prefix}sub>[0-9]{{1,3}}|[iıvx]{{1,4}}|[a-zçğıöşü]))?"
        rf"(?:\s*-\s*(?P<{prefix}clause>[a-zçğıöşü]))?"
    )


# Optional trailing fıkra: "... maddesinin birinci fıkrası", "... 1. fıkrası".
def _fikra_tail(prefix: str) -> str:
    return (
        rf"(?:\s*,?\s*(?:(?P<{prefix}fno>[0-9]{{1,2}})\s*(?:\.\s*|'?\s*"
        + _ORDINALS
        + rf"\s+)?|(?P<{prefix}fword>"
        + _ORDINAL_WORD_ALT
        + rf")\s+)fıkra[{_WCH}]*)?"
    )


# Suffix article: "157. madde", "157 nci maddesi", "6/A maddesi", "91/1. maddesi".
_ART_SUFFIX_RE = re.compile(
    r"(?<![0-9/.])(?<![" + _WCH + r"])"
    + _article_token("s")
    + r"(?P<ssep>\s*\.\s*|\s*'?\s*" + _ORDINALS + r"\s+|\s+)"
    + r"madde[" + _WCH + r"]*"
    + _fikra_tail("s")
)

# Prefix article: "madde 157", "md. 157", "m. 157", "m. 6/A", "m.6/1-a".
# Bare "m." must not be preceded by a number ("100 m." is a measurement) and
# always requires a digit after it (so "100 m. yükseklikte" never matches).
_ART_PREFIX_RE = re.compile(
    r"(?:" + _NB + r"madde|" + _NB + r"md\.?|(?<![0-9])(?<![0-9]\s)" + _NB + r"m\.)\s*"
    + _article_token("p")
    + _NA
    + _fikra_tail("p")
)

# Bare abbreviation, optionally followed by a KEYWORD-LESS article number --
# the shorthand lawyers actually type: "TBK 49", "İİK 89", "HMK 177",
# "CMK 100", "TMK 706", "TTK 5/A", "VUK 359". The negative lookahead hands
# "İİK 89 uncu maddesi" / "İYUK 7. madde" back to the article passes, which
# know how to read the ordinal/fıkra tail.
_ABBREV_RE = re.compile(
    _ABBREV_HEAD
    + r"(?:\s+"
    + _article_token("a")
    + _NA
    + r"(?!\s*(?:\.\s*|'?\s*" + _ORDINALS + r"\s+)?madde)"
    + _fikra_tail("a")
    + r")?"
)

# ---------------------------------------------------------------------------
# Article lists and ranges after a prefix article -- W17/c
# ---------------------------------------------------------------------------
#
# MEASURED on real petitions: "6098 s. TBK m. 299, 313, 315, 347, 350, 352"
# yielded ONLY m. 299, "TBK m. 474 ve 475" only m. 474. Each listed number is
# now its OWN article reference whose span is the number itself, so every
# reference still slices back to its raw text. A range ("m. 53-59") is
# represented by its two endpoints: the numbers between them are not written
# in the document. Mirrors the TypeScript block of the same name.

# What may NOT follow a list item: a date/decimal, a percent, a unit, a law
# number or a number that opens its own suffix article.
_LIST_ITEM_GUARD = (
    r"(?!\s*[./]\s*[0-9])"
    r"(?!\s*%)"
    r"(?![.'’]?\s*(?:"
    r"(?:gün|yıl|hafta|saat|dakika|lira|kuruş|sayılı|numara|tarih|esas|karar|fıkra|bent|madde"
    r"|ıncı|inci|uncu|üncü|ncı|nci|ncu|ncü)[" + _WCH + r"]*"
    r"|(?:ay|aylık|ayda|aya|ayı|ayın|tl|try|usd|eur|adet|kişi|kez|defa|no|nolu|e|k|md|m|s)"
    + _NA
    + r"))"
)

# ", 313" / " ve 475" -- one more article of the list.
_LIST_ITEM_RE = re.compile(
    r"(?:\s*,\s*|\s+ve\s+)" + _article_token("l") + _NA + _LIST_ITEM_GUARD
)

# "-59" -- the upper end of a range whose lower end was just read.
_RANGE_END_RE = re.compile(
    r"\s*-\s*(?P<rend>[0-9]{1,4})" + _NA + _LIST_ITEM_GUARD
)

# Upper bound on list items read after one article (a runaway guard).
_MAX_LIST_ITEMS = 64

# A "TCK 2005"-shaped number is a YEAR, not an article: bare article numbers
# in that range are rejected (real article numbers reach at most ~1030, e.g.
# TMK 1030).
_ARTICLE_YEAR_MIN, _ARTICLE_YEAR_MAX = 1900, 2099

_YEAR_MIN, _YEAR_MAX = 1900, 2099

# ---------------------------------------------------------------------------
# Turkish short-form (anaphoric) citations -- W14/B-38
# ---------------------------------------------------------------------------
#
# eyecite recognizes English short forms ("supra", "id.", "ibid.") as their own
# citation class. The Turkish equivalents are "anılan karar", "aynı yönde",
# "yukarıda anılan", "mezkûr", "söz konusu" and the abbreviation "agk."
# (anılan geçen karar), plus the plain repetition of an article number after
# the owning instrument was named once.
#
# A parser that ignores them makes the opposing-party citation audit SILENTLY
# incomplete, which is the worst failure mode this product has. So they are
# recognized as `short_form` references, resolved from context when the context
# supplies a target and left EXPLICITLY unresolved ("belirsiz") when it does
# not -- never promoted to a full citation.

#: The additive reference kind for a Turkish anaphoric citation.
SHORT_FORM_KIND = "short_form"

# "anılan karar", "aynı yöndeki karar", "mezkûr ilam", "agk." ... The marker
# itself is the reference: there is no number in the text to hang it on.
_SHORTFORM_DECISION_RE = re.compile(
    _NB
    + r"(?:"
    + r"a\s*\.?\s*g\s*\.?\s*k\s*\."
    + r"|(?:yukarıda\s+)?anılan\s+(?:karar|ilam|içtiha[td]|hüküm|hükm)[" + _WCH + r"]*"
    + r"|(?:mezkûr|mezkur|söz\s+konusu)\s+(?:karar|ilam|içtiha[td])[" + _WCH + r"]*"
    + r"|aynı\s+(?:yönde|doğrultuda)(?:ki)?"
    + r")"
)

# The anaphoric head that OWNS a following article number: "aynı Kanunun",
# "anılan Kanun'un", "mezkûr Yönetmeliğin", "söz konusu Tebliğin". Anchored at
# the end of the window immediately before the article reference.
_SHORTFORM_ARTICLE_HEAD_RE = re.compile(
    r"(?:yukarıda\s+anılan|anılan|aynı|mezkûr|mezkur|söz\s+konusu)\s+"
    r"(?:kanun|yasa|mevzuat|yönetmeli[kğ]|tüzü[kğ]|kararname|tebli[gğ]|genelge)[" + _WCH + r"]*"
    r"['\u2019]?[" + _WCH + r"]*\s*$"
)

#: How far back the anaphoric head is looked for, in code points.
_SHORTFORM_WINDOW = 80

# An article whose OWN instrument is restated right next to it is a FULL
# citation, not a short form: "TCK m. 157" repeated fifty times is fifty
# complete citations, however often it occurs. Only the gap below counts as
# "restated next to it": a possessive suffix, punctuation and whitespace.
_OWNED_GAP_RE = re.compile(r"^['\u2019]?[" + _WCH + r"]*[\s,;:.()\-]*$")

#: Longest gap that still counts as ownership, in code points.
_OWNED_GAP_MAX = 16

#: Fields copied onto a short form that resolves to a LEGISLATION target.
_LEGISLATION_CARRY = (
    "legislation_no",
    "name",
    "abbreviation",
    "canonical_name",
    "mulga",
)

#: Fields copied onto a short form that resolves to a DECISION target.
_DECISION_CARRY = (
    "docket_no",
    "decision_no",
    "year",
    "court",
    "chamber",
    "docket_kind",
)


def is_unresolved_short_form(ref) -> bool:
    """True for a short form whose target could not be resolved ("belirsiz").

    Such a reference must never be rendered as a full citation: it says a
    citation is THERE, not which one.
    """
    return (
        ref.kind == SHORT_FORM_KIND
        and ref.legislation_no is None
        and ref.docket_no is None
    )


_ROMAN_RE = re.compile(r"^(?:I{1,3}|IV|V|VI{1,3}|IX|X|XI{1,2})$")


def _valid_docket(value: str) -> bool:
    year = int(value.split("/", 1)[0])
    return _YEAR_MIN <= year <= _YEAR_MAX


def _squash(value: str) -> str:
    """Remove internal whitespace from a docket/article token ("2021 / 12")."""
    return re.sub(r"\s+", "", value)


def _collapse(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _chamber_code(word: str) -> Optional[str]:
    key = _collapse(word).replace("ı", "i")
    return _CHAMBER_WORDS.get(key)


def _institution_code(word: str) -> Optional[str]:
    key = _collapse(word).replace("ı", "i")
    for name, code in _INSTITUTIONS.items():
        if name.replace("ı", "i") == key:
            return code
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_references(text: str) -> list:
    """Parse all recognizable legal references from ``text``.

    Returns ``ParsedReference`` items sorted by their position in the text.
    The input text is never mutated; ``raw`` slices come from the
    NFC-normalized copy of the input.
    """
    if not text:
        return []

    nfc = unicodedata.normalize("NFC", text)
    low = shadow_fold(nfc)
    # shadow_fold() is length-preserving for Turkish input; guard anyway so
    # spans can never silently misalign on exotic input.
    if len(low) != len(nfc):  # pragma: no cover - defensive
        low = turkish_lower(nfc)

    refs: list = []
    taken: list = []

    def is_free(start: int, end: int) -> bool:
        return all(end <= s or start >= e for s, e in taken)

    def claim(start: int, end: int) -> None:
        taken.append((start, end))

    # ---- court / chamber mentions (attached to dockets, never emitted alone)
    courts: list = []
    for m in _COURT_RE.finditer(low):
        inst = m.group("inst")
        ainst = m.group("ainst")
        chword = (
            m.group("chword") or m.group("chword2") or m.group("chword3")
            or m.group("chword4") or m.group("chword5")
        )
        chno = m.group("chno") or m.group("chno3") or m.group("chno4")
        chord = m.group("chord")
        if inst:
            code = _institution_code(inst)
        elif ainst:
            code = _ABBREVIATED_INSTITUTIONS.get(_collapse(ainst))
        else:
            code = None
        chamber_code = _chamber_code(chword) if chword else None
        if code is None and chamber_code is None:
            continue
        if code is None and chamber_code is not None:
            code = _CHAMBER_IMPLIES.get(chamber_code)
        if chamber_code is not None:
            number = chno or (_ORDINAL_WORDS.get(chord) if chord else None)
            chamber = f"{int(number)}. {chamber_code}" if number else chamber_code
        else:
            chamber = None
        courts.append((m.start(), m.end(), code, chamber))

    def court_for(start: int):
        """Court/chamber immediately preceding position ``start``, if any."""
        best = None
        for c_start, c_end, code, chamber in courts:
            if c_end > start:
                continue
            gap = low[c_end:start]
            if not _COURT_GAP_RE.fullmatch(gap):
                continue
            if not is_free(c_start, c_end):
                continue
            if best is None or c_end > best[1]:
                best = (c_start, c_end, code, chamber)
        return best

    def gap_date(start: int, end: int) -> Optional[str]:
        """The decision date written BETWEEN a court and its docket, if any."""
        found = _GAP_DATE_RE.search(low, start, end)
        if found is None:
            return None
        return nfc[found.start():found.end()]

    def decision_ref(
        m,
        *,
        docket: str,
        decision: Optional[str],
        docket_kind: str,
        default_court: Optional[str] = None,
    ) -> None:
        start, end = m.span()
        attached = court_for(start)
        court = default_court
        chamber = None
        date_between = None
        if attached is not None:
            date_between = gap_date(attached[1], start)
            start = attached[0]
            court = attached[2] or default_court
            chamber = attached[3]
        if not is_free(start, end):
            return
        claim(start, end)
        tdate = m.groupdict().get("tdate")
        refs.append(
            ParsedReference(
                kind="court_decision",
                raw=nfc[start:end],
                docket_no=docket,
                decision_no=decision,
                year=int(docket.split("/", 1)[0]),
                court=court,
                chamber=chamber,
                docket_kind=docket_kind,
                decision_date=(
                    nfc[m.start("tdate"):m.end("tdate")] if tdate else date_between
                ),
                span=(start, end),
            )
        )

    # Pass 1: official gazette (before legislation, shares "sayılı").
    for m in _RG_RE.finditer(low):
        s, e = m.span()
        if not is_free(s, e):
            continue
        claim(s, e)
        refs.append(
            ParsedReference(
                kind="official_gazette",
                raw=nfc[s:e],
                rg_date=nfc[m.start("date"):m.end("date")],
                rg_no=m.group("no"),
                year=int(m.group("date")[-4:]),
                span=(s, e),
            )
        )

    # Pass 2: court decisions (prefix then suffix style, then bare forms).
    for pattern in (_COURT_PREFIX_RE, _COURT_SUFFIX_RE):
        for m in pattern.finditer(low):
            docket = _squash(m.group("docket"))
            decision = _squash(m.group("decision"))
            if not (_valid_docket(docket) and _valid_docket(decision)):
                continue
            decision_ref(m, docket=docket, decision=decision, docket_kind="esas")

    # Pass 2b: HGK/CGK hyphenated docket without a paired karar number.
    for m in _DOCKET_ONLY_RE.finditer(low):
        docket = _squash(m.group("docket"))
        if not _valid_docket(docket):
            continue
        decision_ref(m, docket=docket, decision=None, docket_kind="esas")

    # Pass 2c: AYM bireysel başvuru ("B. No: 2019/12345").
    for m in _BASVURU_RE.finditer(low):
        docket = _squash(m.group("docket"))
        if not _valid_docket(docket):
            continue
        decision_ref(
            m, docket=docket, decision=None, docket_kind="basvuru",
            default_court="AYM",
        )
    for m in _BASVURU_SUFFIX_RE.finditer(low):
        docket = _squash(m.group("docket"))
        if not _valid_docket(docket):
            continue
        decision_ref(
            m, docket=docket, decision=None, docket_kind="basvuru",
            default_court="AYM",
        )

    def extend_article_list(start_pos: int, head: ParsedReference) -> None:
        """Read the list ("m. 299, 313") or range ("m. 53-59") after ``head``.

        Mirrors ``extendArticleList`` in the TypeScript parser.
        """
        pos = start_pos
        # Only a bare number can open a range: "m. 4/1-a" used its hyphen.
        rangeable = (
            head.paragraph is None and head.clause is None
            and (head.article_no or "").isdigit()
        )
        previous = int(head.article_no) if rangeable else 0
        for _ in range(_MAX_LIST_ITEMS):
            if rangeable:
                r = _RANGE_END_RE.match(low, pos)
                if r is not None:
                    value = int(r.group("rend"))
                    r_start, r_end = r.start("rend"), r.end()
                    if (
                        not value > previous
                        or _ARTICLE_YEAR_MIN <= value <= _ARTICLE_YEAR_MAX
                        or not is_free(r_start, r_end)
                    ):
                        return
                    claim(r_start, r_end)
                    refs.append(
                        ParsedReference(
                            kind="article",
                            raw=nfc[r_start:r_end],
                            article_no=str(value),
                            article_kind="madde",
                            span=(r_start, r_end),
                        )
                    )
                    pos = r_end
                    previous = value
                    rangeable = False
                    continue
            item = _LIST_ITEM_RE.match(low, pos)
            if item is None:
                return
            value = int(item.group("lart"))
            i_start, i_end = item.start("lart"), item.end()
            if (
                not value > 0
                or _ARTICLE_YEAR_MIN <= value <= _ARTICLE_YEAR_MAX
                or not is_free(i_start, i_end)
            ):
                return
            claim(i_start, i_end)
            reference = _article_ref(nfc, item, "l", i_start, i_end)
            refs.append(reference)
            pos = i_end
            previous = value
            rangeable = (
                reference.paragraph is None and reference.clause is None
                and (reference.article_no or "").isdigit()
            )

    # Pass 3: legislation with an explicit number.
    for m in _LAW_RE.finditer(low):
        s, e = m.span()
        if not is_free(s, e):
            continue
        claim(s, e)
        name = nfc[m.start("name"):m.end("name")].strip() or None
        number = m.group("no")
        by_name = lookup_abbreviation(name or "")
        by_number = lookup_by_number(number)
        entry = by_number or by_name
        refs.append(
            ParsedReference(
                kind="legislation",
                raw=nfc[s:e],
                legislation_no=number,
                name=name,
                abbreviation=by_name.key if by_name else None,
                canonical_name=entry.canonical_name if entry else None,
                mulga=bool(entry and entry.mulga),
                span=(s, e),
            )
        )

    # Pass 3b: BARE abbreviations ("TCK m. 157", "İİK'nun 89 uncu maddesi",
    # "TBK 49").
    for m in _ABBREV_RE.finditer(low):
        s = m.start()
        head_end = m.end("suffix") if m.group("suffix") else m.end("abbr")
        if not is_free(s, head_end):
            continue
        written = nfc[m.start("abbr"):m.end("abbr")]
        entry = lookup_abbreviation(written)
        if entry is None:  # pragma: no cover - alternation is built from table
            continue

        art_start = m.start("aart") if m.group("aart") is not None else None
        if art_start is not None:
            value = int(m.group("aart"))
            if _ARTICLE_YEAR_MIN <= value <= _ARTICLE_YEAR_MAX:
                art_start = None  # a year, not an article number
        if art_start is not None and not is_free(art_start, m.end()):
            art_start = None

        end = m.end() if art_start is not None else head_end
        claim(s, end)
        refs.append(
            ParsedReference(
                kind="legislation",
                raw=nfc[s:head_end],
                legislation_no=entry.legislation_no,
                name=written,
                abbreviation=entry.key,
                canonical_name=entry.canonical_name,
                mulga=entry.mulga,
                span=(s, head_end),
            )
        )
        if art_start is not None:
            head = _article_ref(nfc, m, "a", art_start, m.end())
            refs.append(head)
            extend_article_list(m.end(), head)

    # Pass 4: ek / geçici articles (before generic article passes so that
    # "ek madde 5" is not also captured as plain "madde 5").
    for m in _EK_GECICI_RE.finditer(low):
        s, e = m.span()
        if not is_free(s, e):
            continue
        claim(s, e)
        number = m.group("n1") or m.group("n2")
        refs.append(
            ParsedReference(
                kind="article",
                raw=nfc[s:e],
                article_no=number,
                article_kind=m.group("akind"),
                span=(s, e),
            )
        )

    # Pass 5: suffix articles ("157 nci maddesi", "157. madde", "6/A maddesi").
    for m in _ART_SUFFIX_RE.finditer(low):
        s, e = m.span()
        sep = m.group("ssep") or ""
        has_marker = "." in sep or sep.strip() != ""
        if not has_marker and m.group("ssub") is None:
            # Bare "3 madde eklenmiştir" is a COUNT, not a reference.
            continue
        if not is_free(s, e):
            continue
        claim(s, e)
        refs.append(_article_ref(nfc, m, "s", s, e))

    # Pass 6: prefix articles ("madde 157", "md. 157", "m. 157").
    for m in _ART_PREFIX_RE.finditer(low):
        s, e = m.span()
        if not is_free(s, e):
            continue
        claim(s, e)
        head = _article_ref(nfc, m, "p", s, e)
        refs.append(head)
        extend_article_list(e, head)

    refs.sort(key=lambda r: r.span[0])

    # Pass 7: Turkish short forms (W14/B-38). Runs LAST, over the references
    # the earlier passes produced, so it can resolve an anaphor against them.
    refs = _resolve_short_forms(nfc, low, refs, is_free, claim)
    refs.sort(key=lambda r: r.span[0])
    return refs


def _resolve_short_forms(nfc, low, refs, is_free, claim):
    """Recognize and resolve Turkish anaphoric citations.

    Two mechanisms, both deterministic and both left-to-right:

    1. a DECISION marker ("anılan karar", "aynı yönde", "agk.") becomes a
       short form carrying the identity of the nearest PRECEDING court
       decision; with no preceding decision it stays unresolved;
    2. an ARTICLE reference is re-kinded to a short form when it is either
       introduced by an anaphoric head ("aynı Kanunun 344 uncu maddesi") or a
       REPEAT of an article number already cited in this text ("... m. 352
       ... m. 352"). It then carries the nearest preceding legislation.

    An unresolved short form keeps every identity field ``None`` -- the
    "belirsiz" bucket. Nothing is ever invented.
    """
    out = []
    seen_articles = set()
    last_legislation = None
    last_decision = None

    for ref in refs:
        if ref.kind == "legislation":
            last_legislation = ref
            out.append(ref)
            continue
        if ref.kind == "court_decision":
            last_decision = ref
            out.append(ref)
            continue
        if ref.kind != "article":
            out.append(ref)
            continue

        key = (ref.article_kind, ref.article_no)
        repeat = key in seen_articles
        seen_articles.add(key)
        if _owned_by_adjacent_legislation(low, last_legislation, ref):
            # The instrument is written right next to the article: a full
            # citation, not an anaphor. This is also what keeps a blockwise
            # parse equal to a whole-text parse (intake/analysis.py).
            out.append(ref)
            continue
        window = low[max(0, ref.span[0] - _SHORTFORM_WINDOW):ref.span[0]]
        anaphoric = _SHORTFORM_ARTICLE_HEAD_RE.search(window) is not None
        if not (repeat or anaphoric):
            out.append(ref)
            continue

        carry = {field: None for field in _LEGISLATION_CARRY}
        carry["mulga"] = False
        if last_legislation is not None:
            for field in _LEGISLATION_CARRY:
                carry[field] = getattr(last_legislation, field)
        out.append(replace(ref, kind=SHORT_FORM_KIND, **carry))

    # Decision markers are their own references; they are appended and the
    # caller re-sorts by span.
    for m in _SHORTFORM_DECISION_RE.finditer(low):
        start, end = m.span()
        if not is_free(start, end):
            continue
        claim(start, end)
        target = None
        for candidate in out:
            if candidate.kind == "court_decision" and candidate.span[1] <= start:
                target = candidate
        carry = {field: None for field in _DECISION_CARRY}
        if target is not None:
            for field in _DECISION_CARRY:
                carry[field] = getattr(target, field)
        out.append(
            ParsedReference(
                kind=SHORT_FORM_KIND,
                raw=nfc[start:end],
                span=(start, end),
                **carry,
            )
        )

    return out


def _owned_by_adjacent_legislation(low, legislation, article) -> bool:
    """Is ``article`` written immediately after the instrument it belongs to?

    "TCK m. 157", "TCK'nın 157. maddesi" and "5237 sayılı Kanun m. 157" all
    restate the law next to the article, so the article is a FULL citation no
    matter how many times the pair repeats. Only whitespace, punctuation and a
    possessive suffix may sit in the gap, and the gap is bounded, so the answer
    depends on a LOCAL window -- which is what keeps a blockwise parse equal to
    a whole-text parse.
    """
    if legislation is None:
        return False
    gap_start, gap_end = legislation.span[1], article.span[0]
    if gap_start > gap_end or gap_end - gap_start > _OWNED_GAP_MAX:
        return False
    return _OWNED_GAP_RE.match(low[gap_start:gap_end]) is not None


def _article_ref(nfc: str, m, prefix: str, start: int, end: int) -> ParsedReference:
    """Build an article reference from a matched article token."""
    article_no = _squash(nfc[m.start(prefix + "art"):m.end(prefix + "art")])
    paragraph: Optional[str] = None
    clause: Optional[str] = None

    sub_group = prefix + "sub"
    if m.group(sub_group) is not None:
        sub_raw = _squash(nfc[m.start(sub_group):m.end(sub_group)])
        if sub_raw.isdigit():
            paragraph = str(int(sub_raw))
        else:
            # A Roman numeral after the slash is a FIKRA ("25/II"), not a
            # lettered article suffix. Multi-character Roman numerals are
            # recognized CASE-INSENSITIVELY and with dotless-i folding,
            # because hybrid search parses the lowercased query form where
            # "II" has already become "ıı".
            folded = shadow_fold(sub_raw).replace("ı", "i").upper()
            if len(sub_raw) >= 2 and _ROMAN_RE.match(folded):
                paragraph = folded
            elif sub_raw.isupper() and _ROMAN_RE.match(sub_raw):
                # Single letters stay case-sensitive: "5/I" is fıkra I but
                # "5/i" is a bent letter and "5/A" a lettered article.
                paragraph = sub_raw
            else:
                # Lettered article suffix ("6/A", "10/A") is part of the
                # article identifier itself.
                article_no = f"{article_no}/{sub_raw}"

    clause_group = prefix + "clause"
    if m.group(clause_group) is not None:
        clause = _squash(nfc[m.start(clause_group):m.end(clause_group)])

    # A list item ("l" prefix) carries no fıkra tail, so its groups may not
    # exist at all -- read them through groupdict().
    groups = m.groupdict()
    fno = groups.get(prefix + "fno")
    fword = groups.get(prefix + "fword")
    if fno is not None:
        paragraph = str(int(fno))
    elif fword is not None:
        paragraph = _ORDINAL_WORDS[fword]

    return ParsedReference(
        kind="article",
        raw=nfc[start:end],
        article_no=article_no,
        article_kind="madde",
        paragraph=paragraph,
        clause=clause,
        span=(start, end),
    )
