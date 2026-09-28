"""Deterministic reading of a UYAP download (W22, "klasörü dosyalarıma dağıt").

A lawyer downloads a case file from UYAP Avukat Portal — .udf files, PDFs,
sometimes one .zip — and wants each document filed under the right matter.
Competitors do this with a browser extension bound to the lawyer's UYAP
identity; ColleX does it on the lawyer's own disk, without credentials, by
READING the documents. This module is that reading and nothing else:

* it never writes to the database and never stores an original — the scan is
  a PREVIEW; ingestion happens later, file by file, through the one intake
  path (``intake.ingest.process_file``) and only for the rows the lawyer
  confirmed;
* every value it reports carries the exact text it was read from (``quote``)
  and where (``start``/``end``: Unicode code points over the NFC canonical
  text — the same text ``process_file`` stores — or over the file NAME when
  ``source`` is ``"filename"``). A value without a span is never produced;
* it is rule-based and closed: a court line, a labelled esas / karar number,
  a title line naming the document type, a labelled date. What it cannot
  read it leaves ``None`` — it never guesses a court from a city or an esas
  from a date.

Precedence: the CONTENT wins over the file name. When both carry an esas
number and they differ, both are returned and ``esasConflict`` is true, so
the screen shows the lawyer the two readings side by side.

Header window: court, esas, karar and the type are read from the first
``HEADER_WINDOW`` code points — the first page of a UYAP document — because
the body of a petition or a decision cites OTHER files ("Yargıtay 9. HD
2019/1234 E."), and those must never be read as this file's number. Lines
that name another file (``ilk derece``, ``birleşen``) and unlabelled numbers
on citation lines are skipped for the same reason.

Scan budget: text is extracted with OCR OFF (``ocr=None``). A scanned page
therefore yields no text here and the row says so; the real intake at import
time still applies local OCR when this machine has it.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date
from pathlib import Path, PurePosixPath

from intake import extract, quarantine
from intake.errors import (
    IntakeError,
    InvalidRequestError,
    NotFoundError,
    UnsupportedTypeError,
)
from legal_reference.normalize import shadow_fold

#: Bumped whenever a reading rule changes (the preview carries it).
READER_VERSION = "uyap-okuma-v1"

#: Code points read for court / esas / karar / type: about one page.
HEADER_WINDOW = 2500
#: Code points at the END read for an unlabelled signature date.
TAIL_WINDOW = 800
#: Longest line (stripped) the tail-date rule accepts ("İstanbul, 15.03.2024").
TAIL_DATE_LINE_MAX = 40
#: Title lines considered for the document type.
TITLE_LINE_MAX = 70
TITLE_LINES_SCANNED = 40

#: Same set as intake.cli.BATCH_EXTENSIONS (kept literal to avoid a cycle).
DOCUMENT_SUFFIXES = (".pdf", ".docx", ".txt", ".udf")

# ---------------------------------------------------------------------------
# Folding (length-preserving, so spans on the fold are spans on the original)
# ---------------------------------------------------------------------------

_ASCII_FOLD = str.maketrans("çğıöşüâîû", "cgiosuaiu")


def fold(text: str) -> str:
    """Lowercase + Turkish-to-ASCII fold, ONE code point per code point.

    ``shadow_fold`` (the reference parser's length-preserving fold) is
    applied character by character and a character whose fold would change
    the length is kept as it is, so an index into the result is an index
    into ``text``. For MATCHING only; values are always sliced from the
    original text.
    """
    out: list[str] = []
    for ch in text:
        folded = shadow_fold(ch).translate(_ASCII_FOLD)
        out.append(folded if len(folded) == 1 else ch)
    return "".join(out)


def _field(value: str, text: str, start: int, end: int, source: str) -> dict:
    return {
        "value": value,
        "quote": text[start:end],
        "start": start,
        "end": end,
        "source": source,
    }


def _lines(text: str, limit: int) -> list[tuple[int, str]]:
    """(start offset, line) for every line that begins before ``limit``."""
    out: list[tuple[int, str]] = []
    pos = 0
    for line in text.split("\n"):
        if pos >= limit:
            break
        out.append((pos, line))
        pos += len(line) + 1
    return out


# ---------------------------------------------------------------------------
# Court
# ---------------------------------------------------------------------------

#: A court or office name ENDS with one of these words. The optional dative
#: suffix ("MAHKEMESİ'NE", "HAKİMLİĞİNE") is matched but kept out of the
#: value; "mahkemesinin" / "mahkemesince" do not match at all.
_COURT_END = re.compile(
    r"(mahkemesi|dairesi|hakimligi|bassavciligi)(?:'?n[ea])?(?![a-z0-9])"
)
_TC_PREFIX = re.compile(r"^\s*(?:t\s*\.\s*c\s*\.?\s+|sayin\s+)+")
#: A "LABEL :" prefix of at most 30 characters.
_LABEL = re.compile(r"^\s*([a-z][a-z .()/]{0,29}?)\s*:\s*")
#: Lines that name ANOTHER file than this one.
_OTHER_FILE = re.compile(r"ilk\s+derece|birlesen|bozma\s+ilami|istinaf\s+incelemesi\s+yapilan")
_CITATION = re.compile(
    r"yargitay|danistay|anayasa\s+mahkemesi|\bhgk\b|\bcgk\b|\bhd\b|\bcd\b|\bidd\b|"
    r"hukuk\s+dairesi|ceza\s+dairesi|sayili\s+karar|tarihli\s+karar"
)


#: Words that make a short line a title or an office, never a place name.
_NOT_A_PLACE = re.compile(
    r"karar|tutanak|zapt|zabt|rapor|dilekce|muzekkere|teblig|mahkeme|daire|"
    r"hakim|savci|sayin|esas|dosya"
)

#: "…BÖLGE ADLİYE MAHKEMESİ 9. HUKUK DAİRESİ": a numbered chamber that
#: follows the court word at once is part of the court's name.
_CHAMBER = re.compile(r"\s+\d{1,2}\s*\.\s*[a-z ]{1,30}?(dairesi)(?![a-z0-9])")


def _is_place_line(folded_line: str) -> bool:
    """A short all-letter line ("İSTANBUL ANADOLU") that can precede the
    ordinal line of a court ("5. İŞ MAHKEMESİ")."""
    stripped = folded_line.strip()
    return (
        3 <= len(stripped) <= 40
        and re.fullmatch(r"[a-z]+(?: [a-z]+){0,3}", stripped) is not None
        and _NOT_A_PLACE.search(stripped) is None
    )


def read_court(text: str) -> dict | None:
    """The first court/office line of the header, or None."""
    lines = _lines(text, HEADER_WINDOW)
    folded_lines = [(start, fold(line)) for start, line in lines]
    for index, (line_start, folded) in enumerate(folded_lines):
        if _OTHER_FILE.search(folded):
            continue
        # "MAHKEMESİ : İstanbul 5. İş Mahkemesi", "Gönderen : …": the court
        # is the VALUE after a short label, never the label itself.
        label = _LABEL.match(folded)
        search_from = label.end() if label is not None else 0
        match = _COURT_END.search(folded, search_from)
        if match is None:
            continue
        head = folded[search_from:match.start(1)]
        if _CITATION.search(head) or re.search(r"\d{4}\s*/\s*\d", head):
            continue
        begin = search_from
        prefix = _TC_PREFIX.match(folded, begin)
        if prefix is not None:
            begin = prefix.end()
        while begin < match.start(1) and folded[begin] == " ":
            begin += 1
        words_before = folded[begin:match.start(1)].strip()
        if not words_before or match.end(1) - begin > 120:
            continue
        end_in_line = match.end(1)
        chamber = _CHAMBER.match(folded, match.end())
        if chamber is not None:
            end_in_line = chamber.end(1)
        start = line_start + begin
        end = line_start + end_in_line
        # "İSTANBUL ANADOLU" on one line, "5. İŞ MAHKEMESİ" on the next (the
        # layout of a UYAP-generated first page): join the place line.
        if re.match(r"\d", words_before) and index > 0:
            prev_start, prev_folded = folded_lines[index - 1]
            if _is_place_line(prev_folded):
                start = prev_start + (len(prev_folded) - len(prev_folded.lstrip()))
        quote = text[start:end]
        value = re.sub(r"\s+", " ", quote).strip()
        return {"value": value, "quote": quote, "start": start, "end": end, "source": "content"}
    return None


# ---------------------------------------------------------------------------
# Esas / karar numbers
# ---------------------------------------------------------------------------

_NUM = r"(\d{4})\s*/\s*(\d{1,7})"

_ESAS_LABELLED = re.compile(
    r"(?:esas\s*(?:no|numarasi|sayisi)\b\.?|dosya\s*(?:no|numarasi)\b\.?|esas)\s*:?\s*" + _NUM
)
_ESAS_PREFIX = re.compile(r"(?<![a-z])e\s*\.\s*(?:no\s*[:.]?\s*)?:?\s*" + _NUM)
_ESAS_SUFFIX = re.compile(r"(?<![\d/])" + _NUM + r"\s*(?:e\s*\.|esas(?![a-z])|e\s*:)")

_KARAR_LABELLED = re.compile(
    r"karar\s*(?:no|numarasi|sayisi)\b\.?\s*:?\s*" + _NUM
)
_KARAR_PREFIX = re.compile(r"(?<![a-z])k\s*\.\s*(?:no\s*[:.]?\s*)?:?\s*" + _NUM)
_KARAR_SUFFIX = re.compile(r"(?<![\d/])" + _NUM + r"\s*(?:k\s*\.|karar(?![a-z])|k\s*:)")


def _canonical_number(year: str, number: str) -> str | None:
    y = int(year)
    n = int(number)
    if not 1950 <= y <= 2100 or n <= 0:
        return None
    return f"{y}/{n}"


def _read_number(text: str, labelled: re.Pattern, others: tuple[re.Pattern, ...]) -> dict | None:
    """First labelled number in the header; else the first unlabelled one
    that is not on a line citing another decision."""
    lines = _lines(text, HEADER_WINDOW)
    best: tuple[int, dict] | None = None
    for rank, patterns in ((0, (labelled,)), (1, others)):
        for line_start, line in lines:
            folded = fold(line)
            if _OTHER_FILE.search(folded):
                continue
            if rank == 1 and _CITATION.search(folded):
                continue
            for pattern in patterns:
                match = pattern.search(folded)
                if match is None:
                    continue
                value = _canonical_number(match.group(1), match.group(2))
                if value is None:
                    continue
                start = line_start + match.start(1)
                end = line_start + match.end(2)
                candidate = _field(value, text, start, end, "content")
                if best is None or start < best[1]["start"]:
                    best = (rank, candidate)
            if best is not None and best[0] == rank:
                break
        if best is not None:
            return best[1]
    return None


def read_esas(text: str) -> dict | None:
    return _read_number(text, _ESAS_LABELLED, (_ESAS_PREFIX, _ESAS_SUFFIX))


def read_karar(text: str) -> dict | None:
    return _read_number(text, _KARAR_LABELLED, (_KARAR_PREFIX, _KARAR_SUFFIX))


# ---------------------------------------------------------------------------
# Document type
# ---------------------------------------------------------------------------

#: Ordered most-specific first. (code, Turkish label, pattern over a folded
#: TITLE line — a short line that is not a "LABEL : value" line).
DOCUMENT_TYPES: tuple[tuple[str, str, re.Pattern], ...] = (
    ("gerekceli_karar", "Gerekçeli karar", re.compile(r"gerekceli\s+karar")),
    ("tensip_zapti", "Tensip zaptı", re.compile(r"tensip\s+(?:zapti|zabti|tutanagi)")),
    ("durusma_tutanagi", "Duruşma tutanağı",
     re.compile(r"(?:durusma|on\s+inceleme|celse)\s+(?:tutanagi|zapti|zabti)")),
    ("bilirkisi_raporu", "Bilirkişi raporu",
     re.compile(r"bilirkisi\s+(?:(?:kok|ek|ek\s+kok|ikinci)\s+)?rapor[a-z]*")),
    ("muzekkere_cevabi", "Müzekkere cevabı",
     re.compile(r"muzekkere\s+cevabi|muzekkereye\s+cevap")),
    ("tebligat", "Tebligat",
     re.compile(r"teblig\s+mazbatasi|elektronik\s+tebligat|^tebligat$|davetiye|teblig\s+evraki")),
    ("muzekkere", "Müzekkere", re.compile(r"^muzekkere$")),
    ("ara_karar", "Ara karar", re.compile(r"^ara\s+karar$")),
    ("dilekce", "Dilekçe",
     re.compile(r"(?:dava|cevap|replik|duplik|beyan|istinaf|temyiz|itiraz|islah|"
                r"feragat|ikinci\s+cevap|cevaba\s+cevap)\s+dilekcesi|^dilekce$")),
    ("karar", "Karar", re.compile(r"^(?:karar|hukum)$")),
    ("vekaletname", "Vekâletname", re.compile(r"^vekaletname$")),
    ("ihtarname", "İhtarname", re.compile(r"^ihtarname$")),
)

_TYPE_LABELS = {code: label for code, label, _ in DOCUMENT_TYPES}

#: File-name keywords (folded), same codes; looser because a name is short.
_FILENAME_TYPES: tuple[tuple[str, re.Pattern], ...] = (
    ("gerekceli_karar", re.compile(r"gerekceli")),
    ("tensip_zapti", re.compile(r"tensip")),
    ("durusma_tutanagi", re.compile(r"durusma|tutanak|celse")),
    ("bilirkisi_raporu", re.compile(r"bilirkisi")),
    ("muzekkere_cevabi", re.compile(r"muzekkere\W*cevab")),
    ("tebligat", re.compile(r"teblig|davetiye")),
    ("muzekkere", re.compile(r"muzekkere")),
    ("ara_karar", re.compile(r"ara\W*karar")),
    ("dilekce", re.compile(r"dilekce|replik|duplik|istinaf|cevap")),
    ("karar", re.compile(r"(?<![a-z])karar(?![a-z])")),
    ("vekaletname", re.compile(r"vekaletname")),
    ("ihtarname", re.compile(r"ihtarname")),
)

_ADDRESS_LINE = re.compile(r"(?:'n[ea]|hakimligine|baskanligina|mahkemesine|dairesine)\s*$")
_PETITION_LABEL = re.compile(r"^\s*(?:davaci|davali|konu|vekili|itiraz\s+eden|mudafi|sanik)\b[^:]{0,20}:")
_ILGI_MUZEKKERE = re.compile(r"^\s*ilgi\s*:.*muzekkere")


def _type_field(code: str, text: str, start: int, end: int, source: str) -> dict:
    return {
        "code": code,
        "label": _TYPE_LABELS[code],
        "quote": text[start:end],
        "start": start,
        "end": end,
        "source": source,
    }


def read_document_type(text: str) -> dict | None:
    lines = _lines(text, HEADER_WINDOW)[:TITLE_LINES_SCANNED]
    titles: list[tuple[int, str, str]] = []  # (line start + lead, folded stripped, original)
    for line_start, line in lines:
        folded = fold(line)
        stripped = folded.strip()
        if not stripped or len(stripped) > TITLE_LINE_MAX or _LABEL.match(folded):
            continue
        lead = len(folded) - len(folded.lstrip())
        titles.append((line_start + lead, stripped, line.strip()))
    for code, _label, pattern in DOCUMENT_TYPES:
        for start, stripped, original in titles:
            match = pattern.search(stripped)
            if match is not None:
                return _type_field(code, text, start + match.start(), start + match.end(), "content")
    # An institution's reply names the court's letter in its "İLGİ" line.
    for line_start, line in lines:
        folded = fold(line)
        if _ILGI_MUZEKKERE.match(folded):
            lead = len(folded) - len(folded.lstrip())
            return _type_field("muzekkere_cevabi", text, line_start + lead,
                               line_start + len(line.rstrip()), "content")
    # A petition: an address line ("…MAHKEMESİ'NE") followed by role labels.
    address = next(((s, l) for s, l in lines if _ADDRESS_LINE.search(fold(l).rstrip())), None)
    if address is not None and any(_PETITION_LABEL.match(fold(l)) for _s, l in lines):
        s, l = address
        lead = len(l) - len(l.lstrip())
        return _type_field("dilekce", text, s + lead, s + len(l.rstrip()), "content")
    return None


# ---------------------------------------------------------------------------
# Document date
# ---------------------------------------------------------------------------

_DATE = re.compile(r"(?<!\d)(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})(?!\d)")

#: Only these labels name the date OF this document (lower rank wins).
#: "Dava tarihi", "doğum tarihi", "sözleşme tarihi" … are other dates.
DATE_LABELS: dict[str, int] = {
    "karar tarihi": 1,
    "yazim tarihi": 2,
    "rapor tarihi": 2,
    "durusma tarihi": 3,
    "celse tarihi": 3,
    "oturum tarihi": 3,
    "teblig tarihi": 4,
    "tanzim tarihi": 4,
    "duzenleme tarihi": 4,
    "tarih": 5,
}


def _iso(day: str, month: str, year: str) -> str | None:
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return None


def read_document_date(text: str) -> dict | None:
    best: tuple[int, dict] | None = None
    for line_start, line in _lines(text, HEADER_WINDOW):
        folded = fold(line)
        previous_end = 0
        for match in _DATE.finditer(folded):
            segment = folded[previous_end:match.start()]
            previous_end = match.end()
            # The label is the run of words right before the date ("CELSE : 3
            # TARİH : 12/05/2025" -> "tarih"; "DAVA TARİHİ : …" -> "dava
            # tarihi", which is not this document's date). Colon optional.
            tail = re.search(r"([a-z]+(?: +[a-z]+)*) *:? *$", segment)
            words = tail.group(1).split() if tail is not None else []
            rank = next(
                (DATE_LABELS[" ".join(words[-n:])] for n in (3, 2, 1)
                 if len(words) >= n and " ".join(words[-n:]) in DATE_LABELS),
                None,
            )
            if rank is None:
                continue
            iso = _iso(match.group(1), match.group(2), match.group(3))
            if iso is None:
                continue
            candidate = _field(iso, text, line_start + match.start(), line_start + match.end(), "content")
            if best is None or rank < best[0]:
                best = (rank, candidate)
    if best is not None:
        return best[1]
    # A petition carries its date alone on a short line above the signature.
    tail_from = max(0, len(text) - TAIL_WINDOW)
    found: dict | None = None
    pos = 0
    for line in text.split("\n"):
        line_start = pos
        pos += len(line) + 1
        if line_start + len(line) < tail_from:
            continue
        stripped = line.strip()
        if not stripped or len(stripped) > TAIL_DATE_LINE_MAX:
            continue
        folded = fold(line)
        if _CITATION.search(folded):
            continue
        dates = list(_DATE.finditer(folded))
        if len(dates) != 1:
            continue
        rest = folded[:dates[0].start()] + folded[dates[0].end():]
        if re.search(r"\d", rest):
            continue
        iso = _iso(dates[0].group(1), dates[0].group(2), dates[0].group(3))
        if iso is None:
            continue
        found = _field(iso, text, line_start + dates[0].start(), line_start + dates[0].end(), "content")
    return found


# ---------------------------------------------------------------------------
# File name
# ---------------------------------------------------------------------------

#: "2024-123 Esas", "2024_123_E", "E.2024-123", "Esas No 2024 123"; a bare
#: "2024-123" only at the very start of the name and not shaped like a date.
_FILENAME_ESAS = (
    re.compile(r"(?<![0-9])(\d{4})[ \-/.]+(\d{1,7})[ \-.]*(?:e|esas)(?![a-z0-9])"),
    re.compile(r"(?<![a-z])(?:esas(?:[ .\-]*no)?|e)[ .\-]*(\d{4})[ \-/.]+(\d{1,7})(?![0-9])"),
    re.compile(r"^(\d{4})[ \-/]+(\d{1,7})(?![0-9]|[ \-/.]\d)"),
)


def read_filename(name: str) -> dict:
    """Esas number and document type from a FILE NAME (spans into ``name``)."""
    stem = PurePosixPath(name).stem
    # Underscores separate words in downloaded names; same length, so spans
    # into the folded stem are spans into the name.
    folded = fold(stem).replace("_", " ")
    esas = None
    for pattern in _FILENAME_ESAS:
        match = pattern.search(folded)
        if match is None:
            continue
        value = _canonical_number(match.group(1), match.group(2))
        if value is None:
            continue
        esas = _field(value, name, match.start(), match.end(), "filename")
        break
    doc_type = None
    for code, pattern in _FILENAME_TYPES:
        match = pattern.search(folded)
        if match is not None:
            doc_type = _type_field(code, name, match.start(), match.end(), "filename")
            break
    return {"esas": esas, "documentType": doc_type}


# ---------------------------------------------------------------------------
# One document
# ---------------------------------------------------------------------------


def read_document(name: str, text: str | None) -> dict:
    """The full reading of one document. ``text`` is the NFC canonical text
    (None when it could not be read — the name is then the only source)."""
    from_name = read_filename(name)
    reading: dict = {
        "readerVersion": READER_VERSION,
        "textRead": text is not None,
        "court": None,
        "esas": None,
        "karar": None,
        "documentType": None,
        "documentDate": None,
        "filename": from_name,
        "esasConflict": False,
    }
    if text is not None:
        reading["court"] = read_court(text)
        reading["esas"] = read_esas(text)
        reading["karar"] = read_karar(text)
        reading["documentType"] = read_document_type(text)
        reading["documentDate"] = read_document_date(text)
    # Content wins; the name fills only what the content did not carry.
    if reading["esas"] is None and from_name["esas"] is not None:
        reading["esas"] = from_name["esas"]
    elif (
        reading["esas"] is not None
        and from_name["esas"] is not None
        and reading["esas"]["source"] == "content"
        and reading["esas"]["value"] != from_name["esas"]["value"]
    ):
        reading["esasConflict"] = True
    if reading["documentType"] is None and from_name["documentType"] is not None:
        reading["documentType"] = from_name["documentType"]
    return reading


def _error(exc: IntakeError) -> dict:
    body = exc.to_json_dict()["error"]
    return {"kind": body["kind"], "message": body["message"]}


def scan_file(root: Path, path: Path) -> dict:
    """Read one file WITHOUT ingesting it: quarantine, extraction (OCR off)
    and the reading. The sha256 is over the original bytes, the same digest
    ``process_file`` records, so a duplicate check against stored uploads is
    exact."""
    data = path.read_bytes()
    row: dict = {
        "path": path.relative_to(root).as_posix(),
        "name": path.name,
        "sizeBytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "kind": None,
        "error": None,
        "warnings": [],
    }
    text: str | None = None
    try:
        verified = quarantine.verify_upload(path.name, data)
        row["kind"] = verified.kind
        outcome = extract.extract_text(verified.kind, data, None)
        row["warnings"] = list(outcome.warnings)
        text = unicodedata.normalize("NFC", outcome.text)
    except IntakeError as exc:
        row["error"] = _error(exc)
        row["warnings"] = list(exc.warnings)
    row["reading"] = read_document(path.name, text)
    return row


def _collect(directory: Path) -> tuple[list[Path], list[str]]:
    from intake.cli import BATCH_MAX_FILES

    if not directory.is_dir():
        raise NotFoundError(f"klasör bulunamadı: {directory}")
    documents: list[Path] = []
    skipped: list[str] = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() in DOCUMENT_SUFFIXES:
            documents.append(path)
        else:
            skipped.append(path.relative_to(directory).as_posix())
    if len(documents) > BATCH_MAX_FILES:
        raise InvalidRequestError(
            f"Klasörde {len(documents)} belge var; tek seferde en fazla"
            f" {BATCH_MAX_FILES} belge işlenebilir — klasörü bölün."
        )
    return documents, skipped


def unpack_container(container: Path, stage_dir: Path) -> list[str]:
    """Write a .zip download's documents under ``stage_dir`` (quarantine
    gates applied first); returns the skipped entry names."""
    contents = quarantine.open_document_container(container.name, container.read_bytes())
    stage_dir.mkdir(parents=True, exist_ok=True)
    if any(stage_dir.iterdir()):
        raise InvalidRequestError("hazırlık klasörü boş değil")
    root = stage_dir.resolve()
    for entry in contents.documents:
        target = (root / entry.path).resolve()
        if root not in target.parents:
            raise InvalidRequestError(
                f"ZIP path traversal girişimi reddedildi: {entry.path!r}"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(entry.data)
    return list(contents.skipped)


def scan(path: str | Path, *, stage_dir: str | Path | None = None) -> dict:
    """Preview a folder or a .zip download. Nothing is ingested."""
    source = Path(path)
    if source.is_dir():
        root = source
        container = "dir"
        container_skipped: list[str] = []
    elif source.is_file():
        if source.suffix.lower() != ".zip":
            raise UnsupportedTypeError(
                "önizleme bir klasör ya da .zip arşivi bekliyor"
            )
        if stage_dir is None:
            raise InvalidRequestError("ZIP önizlemesi için hazırlık klasörü gerekli")
        root = Path(stage_dir)
        container = "zip"
        container_skipped = unpack_container(source, root)
    else:
        raise NotFoundError(f"klasör ya da arşiv bulunamadı: {source}")
    documents, skipped = _collect(root)
    return {
        "readerVersion": READER_VERSION,
        "container": container,
        "root": str(root.resolve()),
        "total": len(documents),
        "skipped": container_skipped + skipped,
        "documents": [scan_file(root, doc) for doc in documents],
    }
