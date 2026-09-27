"""HEURISTIC legal analysis over extracted upload text — v1, honest.

Everything in this module is pattern-based ("heuristic v1"): regexes over
the canonical text, no model, no network. That is a deliberate, DOCUMENTED
limitation, not a hidden one:

* every claim carries ``source: "heuristic"`` (the contract's marker);
* when few signals are found, a warning says so explicitly instead of the
  response looking confidently empty;
* nothing here is evidence — analysis output is intake metadata to help a
  lawyer orient in the file, and the export/verifier path never accepts it
  as a citation.

What it finds:

* references — :func:`legal_reference.parser.parse_references` (the exact
  parser shared with the corpus pipeline, including abbreviation
  resolution: "TCK m. 157" -> 5237).
* parties    — dilekçe header lines ("DAVACI : Ad Soyad", DAVALI, MÜŞTEKİ,
  SANIK, VEKİL(İ), MÜDAFİ, KATILAN, ALACAKLI, BORÇLU, ...), plus "Av. Ad
  Soyad" attorney names anywhere in the text (role "vekil").
* dates      — dd.mm.yyyy / dd/mm/yyyy and Turkish long form
  ("12 Mayıs 2024"), validated as real calendar dates, each with +-40
  characters of context.
* claims     — sentences containing talep/istem markers ('talep',
  'isteminde', 'davanın kabulü', 'tazminat', '... karar verilmesini',
  'hükmedilmesini').
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date

from legal_reference.normalize import turkish_lower
from legal_reference.parser import parse_references

FEW_SIGNALS_WARNING = (
    "sezgisel analiz (heuristik v1) az sinyal buldu — taraf/atıf/tarih/talep"
    " çıkarımı eksik olabilir; sonuçlar delil değildir"
)

# Signal count below which the honesty warning above is emitted.
FEW_SIGNALS_THRESHOLD = 3

#: The talep list is a PREVIEW the lawyer reads row by row (each row has a
#: "Taslağa talep olarak aktar" button). A long upload can carry thousands of
#: talep sentences; past this many the list stops and a warning says how many
#: exist — never a silent cut. The full text stays searchable in the document.
MAX_PREVIEW_CLAIMS = 200


def claims_capped_warning(total: int) -> str:
    return (
        f"talep listesi ilk {MAX_PREVIEW_CLAIMS} cümleyle sınırlandı; belgede"
        f" {total} talep cümlesi bulundu — tamamı belge metninde duruyor"
    )

_ROLE_WORDS = {
    "davacı": "davacı",
    "davacılar": "davacı",
    "davalı": "davalı",
    "davalılar": "davalı",
    "müşteki": "müşteki",
    "şikayetçi": "müşteki",
    "sanık": "sanık",
    "katılan": "katılan",
    "müdafi": "müdafi",
    "müdafii": "müdafi",
    "vekili": "vekil",
    "vekilleri": "vekil",
    "vekil": "vekil",
    "alacaklı": "alacaklı",
    "borçlu": "borçlu",
    "kiralayan": "kiralayan",
    "kiracı": "kiracı",
    # W14 B-37: the roles two real fixtures used and this module could not
    # see. DAILYFLOW measured "KİRAYA VEREN: Ali Yılmaz" written in plain
    # sight in kira_sozlesmesi.txt and the analysis reporting NO client at
    # all; the ihtarname's "İHTAR EDEN" / "MUHATAP" were likewise invisible.
    # A lease and a notice are the two most common documents a solo
    # practice uploads, so this was not an edge case.
    "muhatap": "muhatap",
    "muhataplar": "muhatap",
    "keşideci": "ihtar eden",
    "işçi": "işçi",
    "işveren": "işveren",
    "malik": "malik",
    "borçlular": "borçlu",
    "alacaklılar": "alacaklı",
}

#: Multi-word role labels, matched BEFORE the single words above (longest
#: first). "KİRAYA VEREN" is a two-word role: the old single-word alternation
#: could never match it, so the landlord of every lease was dropped.
_MULTIWORD_ROLES = {
    "kiraya veren": "kiralayan",
    "kiraya verenler": "kiralayan",
    "ihtar eden": "ihtar eden",
    "ihtar edenler": "ihtar eden",
    "i̇htar eden": "ihtar eden",
    "taşınmaz maliki": "malik",
}

# "DAVACI : Ayşe Yılmaz", "DAVALI VEKİLİ: Av. X Y", "Alacaklı : ..." —
# role word(s) at line start, colon, name on the same line. Compound roles
# like "DAVACI VEKİLİ" resolve to the LAST role word (the vekil).
#: Every label form, longest first so "KİRAYA VEREN" wins over "VEREN".
#: Case-insensitive matching is done with re.IGNORECASE + turkish_lower on
#: the captured label, so "KİRACI", "Kiracı" and "kiracı" are one rule
#: instead of three alternations (the old pattern enumerated case variants
#: by hand and still missed forms).
_ROLE_LABELS = sorted(
    set(_ROLE_WORDS) | set(_MULTIWORD_ROLES),
    key=lambda w: (-len(w), w),
)

#: "DAVACI : Ayşe Yılmaz", "DAVALI VEKİLİ: Av. X Y", "KİRAYA VEREN: Ali
#: Yılmaz" — label at line start, colon, name on the same line. A compound
#: label ("DAVACI VEKİLİ") resolves to its LAST role word (the vekil).
#: Turkish dotted/dotless I makes str.lower() unusable here, so the pattern
#: matches the raw label and `_role_of_label` folds it with turkish_lower.
_PARTY_LINE_RE = re.compile(
    r"(?mi)^[ \t]*((?:[A-ZÇĞİÖŞÜa-zçğıöşüI\u0130\u0131]+[ \t]+){0,3}?"
    r"(?:" + "|".join(
        re.escape(label).replace(r"\ ", r"[ \t]+") for label in _ROLE_LABELS
    ) + r"))"
    r"[ \t]*:[ \t]*(.+)$"
)

# Attorney names: "Av. Mehmet Demir" — 1..3 capitalized words after "Av."
_AVUKAT_RE = re.compile(
    r"Av\.[ \t]+((?:[A-ZÇĞİÖŞÜ][a-zçğıöşüA-ZÇĞİÖŞÜ.\-']+[ \t]+){0,2}"
    r"[A-ZÇĞİÖŞÜ][a-zçğıöşüA-ZÇĞİÖŞÜ.\-']+)"
)

_NUMERIC_DATE_RE = re.compile(
    r"(?<![0-9./])([0-3]?[0-9])[./]([01]?[0-9])[./]((?:19|20)[0-9]{2})"
    r"(?![0-9./])"
)

_TR_MONTHS = {
    "ocak": 1, "şubat": 2, "mart": 3, "nisan": 4, "mayıs": 5,
    "haziran": 6, "temmuz": 7, "ağustos": 8, "eylül": 9, "ekim": 10,
    "kasım": 11, "aralık": 12,
}

_LONG_DATE_RE = re.compile(
    r"(?<![0-9])([0-3]?[0-9])[ \t]+"
    r"(Ocak|OCAK|ocak|Şubat|ŞUBAT|şubat|Mart|MART|mart|Nisan|NİSAN|nisan"
    r"|Mayıs|MAYIS|mayıs|Haziran|HAZİRAN|haziran|Temmuz|TEMMUZ|temmuz"
    r"|Ağustos|AĞUSTOS|ağustos|Eylül|EYLÜL|eylül|Ekim|EKİM|ekim"
    r"|Kasım|KASIM|kasım|Aralık|ARALIK|aralık)"
    r"[ \t]+((?:19|20)[0-9]{2})(?![0-9])"
)

_CLAIM_MARKERS = (
    "talep",           # talep, talepleri, talep ederiz, talep olunur
    "taleb",           # talebi, talebimiz, talebin — consonant softening;
                       # the comment above used to claim "talep" matched these
    "isteminde",
    "istemiyle",
    "davanın kabulü",
    "tazminat",
    "karar verilmesini",
    "hükmedilmesin",   # hükmedilmesine / hükmedilmesini
)

# W12-FIX2 (P2-3): markers match at a WORD START only — "talep" in
# "talepleri" yes, in "istalep"/"kartalep" no; a marker may still continue
# into a suffix (Turkish agglutination: "talebimiz", "tazminata").
_CLAIM_MARKER_RE = re.compile(
    r"(?<![^\W\d_])(?:" + "|".join(re.escape(m) for m in _CLAIM_MARKERS) + ")"
)

# Party role words for claim tagging (P2-3): which side a talep sentence
# belongs to. Compound "davacı vekili" keeps the side (davacı), because the
# vekil speaks for that party.
_CLAIM_PARTY_RE = re.compile(
    r"(?<![^\W\d_])(davacı|davalı|müşteki|şikayetçi|sanık|katılan|alacaklı|borçlu"
    r"|kiracı|kiralayan|kiraya veren|işçi|işveren)([\w']*)(?![\w'])(\s+aleyh)?"
)

#: The only suffixes under which a role word names the side that SPEAKS:
#: the bare nominative ("Davacı vekili … talep etmektedir") and its plural.
#: A case-marked role word names the side the demand is aimed AT —
#: "davalıdan tahsiline" (ablative), "davalıya yükletilmesine" (dative),
#: "davacının talebinin reddine" (genitive) — and used to be reported as the
#: speaker: the davacı's own SONUÇ VE İSTEM came back tagged "davalı".
_CLAIM_PARTY_SPEAKER_SUFFIXES = frozenset({"", "lar", "ler"})

#: Two-word / synonym role forms folded onto the canonical role word.
_CLAIM_ROLE_ALIASES = {"kiraya veren": "kiralayan", "şikayetçi": "müşteki"}

#: Words whose trailing dot is an ABBREVIATION, never a sentence end
#: (compared after turkish_lower). A split there cut "1475 sayılı Kanun m. 14
#: uyarınca kıdem … talep edilmektedir." into "14 uyarınca kıdem …", and the
#: document page's "Taslağa talep olarak aktar" copied that stump into the
#: lawyer's draft with its statutes gone.
_ABBREVIATIONS = frozenset({
    "m", "md", "mad", "mdd", "maddesi", "no", "nu", "nolu", "sy", "sayılı",
    "av", "dr", "prof", "doç", "yrd", "öğr", "gör", "bkz", "krş", "vb", "vs",
    "vd", "vdv", "s", "sh", "c", "bk", "ek", "hd", "cd", "hgk", "cgk", "ibk",
    "iddk", "ybk", "d", "daire", "yarg", "e", "k", "t", "ltd", "şti", "tic",
    "san", "a", "ş", "sk", "sok", "cad", "mah", "apt", "blv", "kat", "tel",
})
_SPLIT_CANDIDATE_RE = re.compile(r"[.!?;]\s+|\n{2,}")
_TOKEN_BEFORE_DOT_RE = re.compile(r"(\S+)\.$")


def _is_abbreviation_dot(text: str, dot_index: int) -> bool:
    """True when the "." at ``dot_index`` closes an abbreviation or an
    ordinal ("m.", "E.", "A.Ş.", "Av.", "9. HD", "HGK.") rather than a
    sentence. Wrongly keeping two sentences together costs a longer claim;
    wrongly splitting one costs its statute — so the doubt merges."""
    m = _TOKEN_BEFORE_DOT_RE.search(text, max(0, dot_index - 40), dot_index + 1)
    if m is None:
        return False
    token = m.group(1).lstrip("(\"'“‘«[")
    if not token:
        return False
    if "." in token:                       # A.Ş, T.C, Ltd.Şti
        return True
    if token.isdigit():                    # ordinal: "9. Hukuk Dairesi"
        return len(token) <= 3
    if len(token) == 1:                    # single letter: "E.", "K."
        return True
    if token.isupper() and len(token) <= 5:  # HD, HGK, İBK, TCK
        return True
    return turkish_lower(token) in _ABBREVIATIONS


def split_sentences(text: str) -> list[str]:
    """Sentences of ``text`` for the claim heuristics, abbreviation-aware.

    Cuts after ".", "!", "?", ";" plus whitespace, and at blank lines —
    except that a "." closing an
    abbreviation or an ordinal is not a cut."""
    pieces: list[str] = []
    start = 0
    for m in _SPLIT_CANDIDATE_RE.finditer(text):
        if text[m.start()] == "." and _is_abbreviation_dot(text, m.start()):
            continue
        cut = m.start() + 1 if text[m.start()] in ".!?;" else m.start()
        pieces.append(text[start:cut])
        start = m.end()
    pieces.append(text[start:])
    return pieces

_WS_RE = re.compile(r"\s+")

DATE_CONTEXT_RADIUS = 40


def _collapse(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


#: Shown at a truncated edge of a context window, so a reader can tell a
#: clipped quotation from a complete one.
CONTEXT_ELLIPSIS = "…"


def context_window(text: str, start: int, end: int, radius: int) -> str:
    """`radius` code points around [start, end), cut at WORD BOUNDARIES.

    W14 B-37. UXAUDIT measured all SEVEN date contexts in the document
    preview starting or ending in the middle of a word ("… SONUÇ VE İSTE").
    A preview whose every line is visibly broken reads as a broken product,
    and worse, a half-word can change what the fragment appears to say.

    The window is only ever SHRUNK to a boundary, never grown past the
    radius, and a truncated edge is marked with an ellipsis so a clipped
    fragment is never mistaken for a complete sentence.
    """
    lo = max(0, start - radius)
    hi = min(len(text), end + radius)
    # Pull the left edge FORWARD to the start of a whole word.
    if lo > 0:
        while lo < start and not text[lo - 1].isspace():
            lo += 1
    # Pull the right edge BACK to the end of a whole word.
    if hi < len(text):
        while hi > end and not text[hi].isspace():
            hi -= 1
    body = _collapse(text[lo:hi])
    if not body:
        return _collapse(text[start:end])
    prefix = CONTEXT_ELLIPSIS + " " if lo > 0 else ""
    suffix = " " + CONTEXT_ELLIPSIS if hi < len(text) else ""
    return f"{prefix}{body}{suffix}"


def _clean_party_name(raw: str) -> str:
    """Trim a header-line name: cut at TC/adres markers and parentheses."""
    name = raw.strip()
    name = re.split(r"[(\[]|,?\s+T\.?C\.?\s*(?:Kimlik|No)| - ", name)[0]
    return _collapse(name).strip(" .,:;-")


def _turkish_date_iso(day: str, month: int, year: str) -> str | None:
    try:
        return date(int(year), month, int(day)).isoformat()
    except ValueError:
        return None


def _role_of_label(label: str) -> str | None:
    """Canonical role for a header label, multi-word forms included.

    A compound label keeps its LAST role word ("DAVACI VEKİLİ" -> vekil,
    because the vekil is the person named on that line).
    """
    folded = _collapse(turkish_lower(label))
    if folded in _MULTIWORD_ROLES:
        return _MULTIWORD_ROLES[folded]
    words = folded.split()
    # Longest trailing multi-word label wins ("DAVALI KİRAYA VEREN").
    for size in (3, 2):
        if len(words) >= size:
            tail = " ".join(words[-size:])
            if tail in _MULTIWORD_ROLES:
                return _MULTIWORD_ROLES[tail]
    for word in reversed(words):
        role = _ROLE_WORDS.get(word)
        if role:
            return role
    return None


def _party_identity(name: str) -> str:
    """De-duplication key for a person: the normalized NAME alone.

    W14 B-37. The key used to be (name, role), so the SAME attorney found
    once through the header line ("VEKİLİ: Av. Ayşe Kaya") and once through
    the free-text "Av. …" rule produced two entries whenever the two paths
    disagreed by a title or a punctuation mark — DAILYFLOW measured exactly
    that on ihtarname.docx. W12-FIX2 de-duplicated `references` and `dates`
    and never came back for `parties`.

    Identity ignores the "Av." title and any trailing punctuation, so
    "Av. Ayşe Kaya" and "Ayşe Kaya" are one person.
    """
    folded = turkish_lower(_collapse(name)).strip(" .,:;-")
    for title in ("av. ", "avukat ", "sayın "):
        if folded.startswith(title):
            folded = folded[len(title):].strip()
    return folded


def extract_parties(text: str) -> list[dict]:
    parties: list[dict] = []
    by_identity: dict[str, dict] = {}

    def _add(name: str, role: str | None) -> None:
        name = _clean_party_name(name)
        if len(name) < 3:
            return
        # turkish_lower, not str.casefold: casefold('İ') yields 'i' + a
        # combining dot (two code points) and never equals 'i'.
        identity = _party_identity(name)
        existing = by_identity.get(identity)
        if existing is not None:
            # Same person, seen again. Keep the FIRST spelling (the header
            # line is the more formal one) and fill in a role we did not
            # have; record a genuinely different role additively rather
            # than silently dropping it.
            if role and "role" not in existing:
                existing["role"] = role
            elif role and existing.get("role") != role:
                also = existing.setdefault("alsoRoles", [])
                if role not in also:
                    also.append(role)
            return
        entry: dict = {"name": name}
        if role:
            entry["role"] = role
        by_identity[identity] = entry
        parties.append(entry)

    for m in _PARTY_LINE_RE.finditer(text):
        _add(m.group(2), _role_of_label(m.group(1)))

    for m in _AVUKAT_RE.finditer(text):
        _add(f"Av. {m.group(1)}", "vekil")

    return parties


#: Max gap (code points) between a legislation ref and a following article
#: ref for the two to be one citation ("TCK m. 157" parses as two adjacent
#: spans: the abbreviation and the article).
_REF_MERGE_GAP = 3

#: Longest block (code points) handed to the reference parser in one call.
#: ``legal_reference.parser.parse_references`` keeps every accepted span in
#: a list and scans it for each new candidate, i.e. it is quadratic in the
#: number of references: one call over a 3.6 M-character upload (30 000
#: paragraphs) took ~110 s, while the same text parsed paragraph by
#: paragraph takes ~3 s. References never span a blank line, so parsing per
#: paragraph block (and splitting an overlong block at line/sentence ends)
#: yields the same references with spans re-based to the full text.
_REF_BLOCK_MAX_CHARS = 8_000

_BLANK_LINE_RE = re.compile(r"\n[ \t]*\n")

# A sentence end usable as a cut: a period after a word of >= 4 lowercase
# letters, then whitespace, then an uppercase letter. Abbreviation dots
# ("m.", "E.", "K.", "Av.", "9.") never qualify, so "TCK m. 157",
# "E. 2021/123" and "9. Hukuk Dairesi" are never split across blocks.
_SENTENCE_CUT_RE = re.compile(
    r"(?<=[a-zçğıöşü]{4})[.!?]\s+(?=[A-ZÇĞİÖŞÜ])"
)


def _split_overlong(offset: int, block: str) -> list[tuple[int, str]]:
    """Cut a block longer than the cap at the last newline or sentence end
    before the cap (falling back to a hard cut), keeping absolute offsets."""
    pieces: list[tuple[int, str]] = []
    start = 0
    while len(block) - start > _REF_BLOCK_MAX_CHARS:
        limit = start + _REF_BLOCK_MAX_CHARS
        cut = block.rfind("\n", start, limit)
        if cut <= start:
            cut = -1
            for m in _SENTENCE_CUT_RE.finditer(block, start, limit):
                if m.end() > start:
                    cut = m.end()
        if cut <= start:
            cut = limit
        pieces.append((offset + start, block[start:cut]))
        start = cut
    pieces.append((offset + start, block[start:]))
    return pieces


def _reference_blocks(text: str) -> list[tuple[int, str]]:
    """(absolute offset, block) pairs covering ``text`` in order."""
    blocks: list[tuple[int, str]] = []
    position = 0
    for m in _BLANK_LINE_RE.finditer(text):
        if m.start() > position:
            blocks.extend(_split_overlong(position, text[position:m.start()]))
        position = m.end()
    if position < len(text):
        blocks.extend(_split_overlong(position, text[position:]))
    return blocks


def _parse_references_blockwise(text: str) -> list:
    """``parse_references`` per block, spans re-based onto ``text``."""
    parsed: list = []
    for offset, block in _reference_blocks(text):
        if not block.strip():
            continue
        for ref in parse_references(block):
            if offset:
                span = (ref.span[0] + offset, ref.span[1] + offset)
                ref = replace(ref, span=span)
            parsed.append(ref)
    return parsed


def _reference_key(entry: dict) -> tuple:
    """Identity of a reference for de-duplication (P2-3): the resolved
    fields, never the raw surface form ("TCK m. 157" == "TCK m.157")."""
    return (
        entry.get("legislationNo", ""),
        entry.get("articleNo", ""),
        entry.get("docketNo", ""),
        entry.get("decisionNo", ""),
        turkish_lower(entry.get("court", "")),
    )


#: How far back a bare "madde N" may look for the law it belongs to.
#: A short form refers to the statute named just before it, in the same
#: paragraph — never one three pages up.
_ARTICLE_CONTEXT_CHARS = 400
_ARTICLE_HEADING_RE = re.compile(r"(?mi)^[ \t]*madde[ \t]+[0-9]+[ \t]*[-–—]")


def _resolve_short_forms(entries: list[dict], text: str) -> None:
    """Attach the governing legislation to a bare article reference.

    W14 B-37. UXAUDIT measured "TBK m. 315" and a later bare "m. 315" listed
    as TWO separate references, which reads as two authorities where there
    is one. A bare article number that follows a legislation reference in
    the same paragraph, within `_ARTICLE_CONTEXT_CHARS`, is that law's
    article; after resolution it de-duplicates onto the same row.

    Entries carry an internal `_span`; it is stripped before the result
    leaves this module.
    """
    last_law: tuple[str, int] | None = None  # (legislationNo, end offset)
    context_laws: set[str] = set()
    previous_end = 0
    for entry in entries:
        span = entry.get("_span")
        # A document's own numbered clause starts a new context even when
        # PDF extraction retains only a single newline between clauses.
        if span is not None:
            if _BLANK_LINE_RE.search(text[previous_end:span[0]]):
                context_laws.clear()
                last_law = None
            previous_end = span[1]
            line_start = text.rfind("\n", 0, span[0]) + 1
            heading = _ARTICLE_HEADING_RE.match(text, line_start)
            if heading is not None and span[0] < heading.end():
                last_law = None
                context_laws.clear()
                continue
        if entry.get("legislationNo"):
            if span is not None:
                last_law = (entry["legislationNo"], span[1])
                context_laws.add(entry["legislationNo"])
            continue
        if entry.get("docketNo") or entry.get("decisionNo") or entry.get("court"):
            continue  # a case citation, not an article
        if not entry.get("articleNo") or span is None or last_law is None:
            continue
        if len(context_laws) != 1:
            continue  # more than one instrument: proximity is not ownership
        law_no, law_end = last_law
        if not (0 <= span[0] - law_end <= _ARTICLE_CONTEXT_CHARS):
            continue
        # Never cross a blank line: a new paragraph is a new context, and
        # a lease's "Madde 3" three paragraphs below a TBK citation is a
        # clause of the lease, not an article of the code.
        if _BLANK_LINE_RE.search(text[law_end:span[0]]):
            continue
        entry["legislationNo"] = law_no
        entry["resolvedFromContext"] = True


def _is_legal_reference(entry: dict) -> bool:
    """True when the entry names an actual authority.

    A bare "Madde 3" with no law in sight is a CONTRACT CLAUSE, not a legal
    citation — UXAUDIT found a lease's own article numbers listed under
    "ATIFLAR" as if they were statute articles. Those go to the `ambiguous`
    bucket, which the console shows as "belirsiz" and which is never
    presented as a citation (GLOBAL's three-bucket rule: matched /
    ambiguous / not found).
    """
    return bool(
        entry.get("legislationNo")
        or entry.get("docketNo")
        or entry.get("decisionNo")
        or entry.get("court")
    )


def _dedupe_references(entries: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: dict[tuple, dict] = {}
    for entry in entries:
        key = _reference_key(entry)
        if key in seen:
            seen[key]["count"] += 1
            continue
        entry["count"] = 1
        seen[key] = entry
        out.append(entry)
    return out


def _strip_internal(entries: list[dict]) -> list[dict]:
    for entry in entries:
        entry.pop("_span", None)
    return entries


def split_references(text: str) -> tuple[list[dict], list[dict]]:
    """(matched, ambiguous) — the two non-empty buckets of B-37.

    "not found" is the third bucket and needs no list: it is both being
    empty, which ``analyze`` already reports through FEW_SIGNALS_WARNING.
    """
    entries = _extract_references_all(text)
    _resolve_short_forms(entries, text)
    matched = _dedupe_references([e for e in entries if _is_legal_reference(e)])
    ambiguous = _dedupe_references([e for e in entries if not _is_legal_reference(e)])
    return _strip_internal(matched), _strip_internal(ambiguous)


def extract_references(text: str) -> list[dict]:
    """Distinct LEGAL references in first-seen order; a repeated citation is
    ONE entry with ``count`` (W12-FIX2, P2-3: a 40-page dilekçe that cites
    TCK m.157 on every page used to list it forty times).

    W14 B-37: an article number with no law behind it is no longer here —
    it is in the ambiguous bucket (:func:`split_references`).
    """
    return split_references(text)[0]


def _extract_references_all(text: str) -> list[dict]:
    parsed = _parse_references_blockwise(text)
    refs: list[dict] = []
    i = 0
    while i < len(parsed):
        ref = parsed[i]
        entry: dict = {"raw": ref.raw, "_span": ref.span}
        # The shared parser's short-form inference is document-wide. Recheck
        # article ownership here under the upload's paragraph/heading bounds.
        if ref.legislation_no and not (ref.kind == "short_form" and ref.article_no):
            entry["legislationNo"] = ref.legislation_no
        if ref.article_no:
            entry["articleNo"] = ref.article_no
        if ref.docket_no:
            entry["docketNo"] = ref.docket_no
        if ref.decision_no:
            entry["decisionNo"] = ref.decision_no
        if ref.court:
            entry["court"] = ref.court
        # "TCK m. 157" arrives as a legislation ref immediately followed by
        # an article ref; the contract's flat entry carries both fields, so
        # merge the adjacent pair into one reference.
        if (
            ref.kind == "legislation"
            and i + 1 < len(parsed)
            and parsed[i + 1].kind == "article"
            and 0 <= parsed[i + 1].span[0] - ref.span[1] <= _REF_MERGE_GAP
        ):
            nxt = parsed[i + 1]
            entry["raw"] = text[ref.span[0]:nxt.span[1]] or (
                f"{ref.raw} {nxt.raw}"
            )
            if nxt.article_no:
                entry["articleNo"] = nxt.article_no
            entry["_span"] = (ref.span[0], nxt.span[1])
            i += 1
        refs.append(entry)
        i += 1
    return refs


def extract_dates(text: str) -> list[dict]:
    found: list[tuple[int, int, str]] = []
    for m in _NUMERIC_DATE_RE.finditer(text):
        iso = _turkish_date_iso(m.group(1), int(m.group(2)), m.group(3))
        if iso:
            found.append((m.start(), m.end(), iso))
    for m in _LONG_DATE_RE.finditer(text):
        month = _TR_MONTHS.get(turkish_lower(m.group(2)))
        if month is None:
            continue
        iso = _turkish_date_iso(m.group(1), month, m.group(3))
        if iso:
            found.append((m.start(), m.end(), iso))

    # One entry per calendar date (P2-3): the first occurrence keeps its
    # context, repeats add to ``count`` — a lease that names its own date on
    # every page is one date, not thirty.
    results: list[dict] = []
    by_iso: dict[str, dict] = {}
    for start, end, iso in sorted(found):
        if iso in by_iso:
            by_iso[iso]["count"] += 1
            continue
        # +-40 chars around the MATCH, trimmed to whole words (B-37).
        entry = {
            "date": iso,
            "context": context_window(text, start, end, DATE_CONTEXT_RADIUS),
            "count": 1,
        }
        by_iso[iso] = entry
        results.append(entry)
    return results


def claim_party(sentence: str) -> str | None:
    """The side a talep sentence speaks for, when exactly ONE role word
    appears (davacı/davalı/...); None when none or several do. Heuristic —
    the console warns that the adversary's talep can appear here too."""
    roles = {
        _CLAIM_ROLE_ALIASES.get(m.group(1), _ROLE_WORDS.get(m.group(1), m.group(1)))
        for m in _CLAIM_PARTY_RE.finditer(turkish_lower(sentence))
        # Only a bare nominative role word names the speaker; "davalı
        # aleyhine" and every case-marked form name the side addressed.
        if m.group(2) in _CLAIM_PARTY_SPEAKER_SUFFIXES and m.group(3) is None
    }
    return next(iter(roles)) if len(roles) == 1 else None


#: Headings that open the operative demands of a Turkish dilekçe. The block
#: after one of these is what the lawyer actually asked the court for.
#:
#: Matched case-INSENSITIVELY on the raw text; the Turkish dotted/dotless I
#: makes a hand-written case alternation unreliable, so `re.IGNORECASE` plus
#: an explicit `İ`/`I` class does the work.
_DEMAND_HEADING_RE = re.compile(
    r"(?m)^[ \t]*(?:"
    r"SONUÇ[ \t]+VE[ \t]+(?:İSTEM|TALEP)"
    r"|NETİCE[ \t\-‐-―]*İ?[ \t]+TALEP"
    r"|TALEP[ \t]+SONUCU"
    r"|İSTEM[ \t]+VE[ \t]+SONUÇ"
    r"|SONUÇ[ \t]+VE[ \t]+İSTEMLERİMİZ"
    r")[ \t]*:?[ \t]*(?:$|(?=\S))",
    re.IGNORECASE,
)

#: A numbered demand item: "1-", "2.", "3)" at a line start, or right after
#: a comma/semicolon (Turkish petitions run the items together as one
#: sentence, which is exactly why the sentence splitter could not see them).
_DEMAND_ITEM_RE = re.compile(
    r"(?m)(?:^|(?<=[,;\n]))[ \t]*(\d{1,2})[ \t]*[-.)][ \t]*"
)

#: Two consecutive blank lines end the demand block (the signature block).
_DEMAND_BLOCK_END_RE = re.compile(r"\n[ \t]*\n[ \t]*\n")


def extract_demand_items(text: str) -> list[dict]:
    """Numbered items of the SONUÇ VE İSTEM block, in order.

    W14 B-37. UXAUDIT measured the previous behaviour on a real dilekçe: the
    numbered demands (fesih, tahliye, 148.500 TL) were MISSED entirely and
    two subordinate clauses were reported instead — the sentence splitter
    swallowed the whole block as one 300-character "claim" because it
    contains no sentence-ending punctuation until the very end. The
    operative part of a petition is the one part a preview must not get
    wrong.
    """
    match = _DEMAND_HEADING_RE.search(text)
    if match is None:
        return []
    block = text[match.end():]
    # The block ends at the signature / date area or a blank-line-separated
    # heading in capitals; a conservative cut keeps only what follows the
    # heading up to two consecutive blank lines.
    end = _DEMAND_BLOCK_END_RE.search(block)
    if end is not None:
        block = block[: end.start()]

    marks = list(_DEMAND_ITEM_RE.finditer(block))
    if not marks:
        return []
    items: list[dict] = []
    for index, mark in enumerate(marks):
        stop = marks[index + 1].start() if index + 1 < len(marks) else len(block)
        body = _collapse(block[mark.end():stop]).strip(" ,;")
        if len(body) < 5:
            continue
        item: dict = {
            "text": body,
            "source": "heuristic",
            # Additive: the number as written, so the console can show
            # "1)" without re-parsing the text.
            "ordinal": int(mark.group(1)),
            "fromDemandBlock": True,
        }
        party = claim_party(body)
        if party:
            item["party"] = party
        items.append(item)
    return items


def extract_claims(text: str) -> list[dict]:
    """Demands, numbered items first.

    The numbered SONUÇ VE İSTEM items lead (they ARE the demand); talep
    sentences found elsewhere follow, minus anything already covered by an
    item, so the same demand is never listed twice.
    """
    claims: list[dict] = extract_demand_items(text)
    demand_items: list[str] = [turkish_lower(c["text"]) for c in claims]
    seen: set[str] = set(demand_items)
    for raw in split_sentences(text):
        sentence = _collapse(raw)
        if not (15 <= len(sentence) <= 600):
            continue
        low = turkish_lower(sentence)
        if not _CLAIM_MARKER_RE.search(low):
            continue
        if low in seen:
            continue
        # A sentence that merely re-wraps the demand block (it contains an
        # item verbatim) adds nothing. Checked against the demand ITEMS only:
        # checking every earlier sentence was quadratic, and a 30 000-
        # paragraph upload spent a minute here.
        if any(item in low for item in demand_items):
            continue
        seen.add(low)
        claim: dict = {"text": sentence, "source": "heuristic"}
        party = claim_party(sentence)
        if party:
            claim["party"] = party
        claims.append(claim)
    return claims


def analyze(text: str) -> tuple[dict, list[str]]:
    """Run all heuristics. Returns (analysis dict, warnings).

    W14 B-37 adds `referencesAmbiguous` (additive): article numbers with no
    law behind them. GLOBAL's three-bucket rule is what the console shows —
    **eşleşti** (`references`), **belirsiz** (`referencesAmbiguous`) and
    **bulunamadı** (both empty, which is what FEW_SIGNALS_WARNING says).
    Keeping the ambiguous ones visible but SEPARATE is the point: a lease's
    own "Madde 3" must be findable, and must never look like TBK m. 3.
    """
    references, ambiguous = split_references(text)
    analysis = {
        "parties": extract_parties(text),
        "references": references,
        "referencesAmbiguous": ambiguous,
        "dates": extract_dates(text),
        "claims": extract_claims(text),
    }
    warnings: list[str] = []
    if len(analysis["claims"]) > MAX_PREVIEW_CLAIMS:
        warnings.append(claims_capped_warning(len(analysis["claims"])))
        analysis["claims"] = analysis["claims"][:MAX_PREVIEW_CLAIMS]
    signal_count = sum(len(v) for v in analysis.values())
    if signal_count < FEW_SIGNALS_THRESHOLD:
        warnings.append(FEW_SIGNALS_WARNING)
    return analysis, warnings
