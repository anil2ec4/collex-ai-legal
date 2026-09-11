"""Typed view + integrity verification of a ColleX draft (``collex.draft/v1``).

Standard-library only, on purpose: the DOCX writer (:mod:`export.petition`,
needs ``python-docx``) and the UDF writer (:mod:`export.udf`, zip + XML from
the standard library) share ONE strict parser and ONE verification routine.
A draft that fails here is refused by every format the same way
(:class:`export.errors.ExportRefused`, CLI exit 2, nothing written).

The TypeScript drafting composer (``control-plane/src/drafting/composer.ts``)
produces the JSON. W12 additions (``version``, ``matterId``, ``updatedAt``,
``unusedEvidence``, ``suggestedFacts``, paragraph ``binding``, the
``ek-dogrulama`` section, ``fileId``/``chunkId`` on uploads) are ADDITIVE:
an older draft without them parses exactly as before.

Body citations reference evidence as ``K-n`` — the 1-based position of the
entry in the draft's evidence list. Hashes and evidence UUIDs never enter
the court text; they live in the DAYANAK KAYNAKLARI appendix each writer
prints after the document.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from export.errors import ExportError, ExportRefused

DRAFT_SCHEMA = "collex.draft/v1"

#: Mandatory wording — identical to ``DRAFT_REVIEW_BANNER`` in
#: ``control-plane/src/drafting/types.ts``. Change both or neither.
DRAFT_REVIEW_BANNER = "Bu taslak makine üretimidir; avukat incelemesi zorunludur."

#: Visible marker on every unsupported paragraph (mirrors the TS renderer).
KAYNAKSIZ_PREFIX = "⚠ KAYNAKSIZ"

#: Section id the composer uses for contrary case law (contract A).
KARSI_ICTIHAT_SECTION_ID = "karsi-ictihat"

#: Section id of the machine-owned verification appendix (W12).
EK_DOGRULAMA_SECTION_ID = "ek-dogrulama"

#: ``direction`` value marking contrary evidence (contract A).
DIRECTION_KARSIT = "karşıt"

#: Source value of uploaded (tenant) documents.
SOURCE_UPLOAD = "UPLOAD"

# --------------------------------------------------------------------------
# Presentation mode (W14 · B-02) — "taslak kopyası" vs "nihai dosyalama kopyası"
# --------------------------------------------------------------------------
#
# W13-DAILYFLOW measured the produced dava dilekçesi: 77 % of the Markdown
# (10 162 of 13 207 bytes) and 189 of 236 DOCX paragraphs were a SHA-256
# appendix nothing in the body cited; the lawyer's own HUKUKÎ SEBEPLER
# paragraph carried a "⚠ KAYNAKSIZ" screen stamp; the page was US Letter.
# The document could not be filed.
#
# Two ADDITIVE switches fix that without touching the gate. Defaults are
# today's behaviour, so every existing caller keeps its content:
#
#   annex = full | none   -> machine metadata (künye table, Uyarılar list,
#                            EK — DOĞRULAMA section, DAYANAK KAYNAKLARI
#                            appendix, format notices) is printed or omitted.
#                            The evidence package remains available as its own
#                            file (export/bundle*.py) — it is separated, never
#                            lost.
#   marks = all  | none   -> the SCREEN marks (`⚠ KAYNAKSIZ —` prefix and the
#                            `Not: …` reviewer lines) are printed or omitted.
#
# WHAT NEITHER SWITCH TOUCHES (trap §C.2): `verify_draft_or_refuse` — quote
# hashes, citation closure, the KAYNAKSIZ count and the B-01 quote-integrity
# check — runs identically in every mode. `marks=none` on an unverifiable
# draft still refuses. Removing the ink does not remove the discipline.

ANNEX_FULL = "full"
ANNEX_NONE = "none"
MARKS_ALL = "all"
MARKS_NONE = "none"

ANNEX_CHOICES = (ANNEX_FULL, ANNEX_NONE)
MARKS_CHOICES = (MARKS_ALL, MARKS_NONE)

#: File-name discriminator so the two copies never get mixed up on disk.
LABEL_TASLAK = "TASLAK"
LABEL_NIHAI = "NİHAİ"


@dataclass(frozen=True)
class ExportMode:
    """How much of the machine apparatus a produced document carries."""

    annex: str = ANNEX_FULL
    marks: str = MARKS_ALL

    def __post_init__(self) -> None:
        if self.annex not in ANNEX_CHOICES:
            raise ValueError(f"annex 'full' veya 'none' olmalı (verilen: {self.annex!r})")
        if self.marks not in MARKS_CHOICES:
            raise ValueError(f"marks 'all' veya 'none' olmalı (verilen: {self.marks!r})")

    @property
    def include_annex(self) -> bool:
        return self.annex == ANNEX_FULL

    @property
    def show_marks(self) -> bool:
        return self.marks == MARKS_ALL

    @property
    def is_final(self) -> bool:
        """True for the clean filing copy (no annex AND no screen marks)."""
        return not self.include_annex and not self.show_marks

    @property
    def label(self) -> str:
        return LABEL_NIHAI if self.is_final else LABEL_TASLAK


DEFAULT_EXPORT_MODE = ExportMode()

# --------------------------------------------------------------------------
# Pre-filing review record (W14 · B-36)
# --------------------------------------------------------------------------
#
# HONESTY BOUNDARY, written on every surface: we do not verify — we RECORD
# that the lawyer verified. The three boxes live on the draft version, so
# they come back after a restart and land in the Atıf Denetim Raporu (B-13).

#: The three boxes, in the order they are shown, with their Turkish labels.
REVIEW_CHECKLIST_ITEMS: tuple[tuple[str, str], ...] = (
    ("citationsOpened", "Her [K-n] kaynağını açıp okudum"),
    ("unsupportedReviewed", "Her ⚠ KAYNAKSIZ paragrafı gözden geçirdim"),
    ("contraryRead", "KARŞI İÇTİHAT bölümünü okudum"),
)

#: Printed in the exported document while any box is unchecked.
VERIFICATION_INCOMPLETE_LINE = (
    "Doğrulama tamamlanmadı: bu belgedeki kaynaklar, KAYNAKSIZ paragraflar ve"
    " karşı içtihat avukat tarafından tek tek onaylanmadan dışa aktarıldı."
)

#: The honesty sentence itself — identical wording on every surface.
REVIEW_RECORD_DISCLAIMER = (
    "Bu kayıt bir doğrulama değildir: sistem doğrulamaz, avukatın"
    " doğruladığını kaydeder."
)


@dataclass(frozen=True)
class ReviewMark:
    """One recorded review act: who ticked it, when, with what note."""

    checked: bool = False
    at: str = ""
    by: str = ""
    note: str = ""


#: Machine code of a broken quote binding (W14 · B-01). Mirrors
#: ``QUOTE_ALTERED`` in ``control-plane/src/drafting/quoteIntegrity.ts``.
QUOTE_ALTERED = "QUOTE_ALTERED"

#: Lawyer-Turkish half of that code; written BEFORE the code, everywhere.
QUOTE_ALTERED_MESSAGE_TR = "alıntı değiştirildi — kanıt bağı koptu"


class DraftFormatError(ExportError):
    """The input JSON is not a valid ``collex.draft/v1`` draft (CLI exit 1)."""


def sha256_utf8(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Quote integrity (W14 · B-01) — the SECOND half of the gate
# --------------------------------------------------------------------------
#
# ``verify_draft_or_refuse`` used to check only that each evidence entry still
# hashed to its own ``quoteSha256``. That says nothing about the DOCUMENT: a
# lawyer could edit the text INSIDE a quoted passage in the editor and the
# export still wrote "Dayanak [K-1]" next to a fabricated criminal penalty
# (W13-UXAUDIT P0-1). A paragraph that carries an evidence id must still
# contain that evidence's quote, verbatim, in the canonical form below.
#
# The canonicalization is a VERBATIM mirror of ``canonicalQuoteText`` in
# ``control-plane/src/drafting/quoteIntegrity.ts``. Change both or neither.
# Paragraph text has been through the TS render guard while ``quote`` is
# stored raw, so the guard's entity escapes are folded back before comparing;
# invisible characters are dropped (they must not decide a citation); the text
# is NFC-normalized (ADR-003); whitespace runs collapse to one space. Nothing
# else is forgiven — one changed letter, digit or word breaks the binding.

_INVISIBLE_CHARS = re.compile(
    "[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]"
)
_WHITESPACE = re.compile(r"\s+")

#: ``&amp;`` LAST: folding it first could manufacture one of the others.
_ENTITY_FOLDS: tuple[tuple[str, str], ...] = (
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&#40;", "("),
    ("&#58;", ":"),
    ("&#46;", "."),
    ("&amp;", "&"),
)


def canonical_quote_text(value: str) -> str:
    """Canonical comparison form of draft text (mirrors the TS function)."""
    out = value
    for entity, literal in _ENTITY_FOLDS:
        out = out.replace(entity, literal)
    out = _INVISIBLE_CHARS.sub("", out)
    out = unicodedata.normalize("NFC", out)
    return _WHITESPACE.sub(" ", out).strip()


def paragraph_contains_quote(paragraph_text: str, quote: str) -> bool:
    """True when the paragraph still contains the quote verbatim (canonical)."""
    needle = canonical_quote_text(quote)
    if needle == "":
        return False
    return needle in canonical_quote_text(paragraph_text)


def short_hash(digest: str, size: int = 12) -> str:
    return digest[:size] + "…" if len(digest) > size else digest


# --------------------------------------------------------------------------
# Typed draft view (strict consuming mirror of the TS producer)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class DraftParagraph:
    paragraph_id: str
    text: str
    evidence_ids: tuple[str, ...]
    supported: bool
    note: str
    role: str


@dataclass(frozen=True)
class DraftSection:
    section_id: str
    title: str
    paragraphs: tuple[DraftParagraph, ...]


@dataclass(frozen=True)
class DraftEvidence:
    evidence_id: str
    label: str
    source: str
    title: str
    quote: str
    quote_sha256: str
    content_sha256: str
    #: Additive contract-A field: "destekleyen" | "karşıt" | "yön belirtmez";
    #: empty string when the (older) draft does not carry it.
    direction: str = ""
    #: Additive (W12): decision date as the producer stored it (ISO or empty).
    decision_date: str = ""

    @property
    def is_contrary(self) -> bool:
        return self.direction == DIRECTION_KARSIT

    @property
    def is_upload(self) -> bool:
        return self.source == SOURCE_UPLOAD


@dataclass(frozen=True)
class Draft:
    draft_id: str
    kind: str
    template: str
    title: str
    created_at: str
    sections: tuple[DraftSection, ...]
    evidence: tuple[DraftEvidence, ...]
    unsupported_count: int
    warnings: tuple[str, ...]
    synthetic: bool
    synthetic_notice: str = ""
    #: Additive (W12): 1 for a fresh draft; PUT increments.
    version: int = 1
    #: Additive (W12): owning matter, or None.
    matter_id: str | None = None
    #: Additive (W12): ISO stamp of the last revision, or empty.
    updated_at: str = ""
    #: Additive (W12-FIX2): the matter's title for the "Dosya" meta row
    #: (the API fills it from the matter store; absent = the id is shown).
    matter_title: str = ""
    #: Additive (W14 · B-36): the lawyer's pre-filing review record, keyed by
    #: the ids of :data:`REVIEW_CHECKLIST_ITEMS`. Absent on older drafts.
    review_checklist: dict[str, ReviewMark] = field(default_factory=dict)
    #: Additive (W14 · B-36): per-evidence review record (evidenceId -> mark).
    evidence_review: dict[str, ReviewMark] = field(default_factory=dict)

    @property
    def review_complete(self) -> bool:
        """True only when ALL THREE boxes are ticked (B-36)."""
        return all(
            self.review_checklist.get(key, ReviewMark()).checked
            for key, _ in REVIEW_CHECKLIST_ITEMS
        )

    @property
    def matter_label(self) -> str:
        """What the "Dosya" row shows: the title when known, else the id."""
        return self.matter_title or (self.matter_id or "")

    def evidence_by_id(self) -> dict[str, DraftEvidence]:
        return {entry.evidence_id: entry for entry in self.evidence}

    def numbering(self) -> dict[str, int]:
        """evidence_id -> 1-based ``K-n`` number (first occurrence wins)."""
        out: dict[str, int] = {}
        for index, entry in enumerate(self.evidence, start=1):
            out.setdefault(entry.evidence_id, index)
        return out


def citation_ref(number: int) -> str:
    """The body reference for the n-th evidence entry: ``K-n``."""
    return f"K-{number}"


# ---------------------------------------------------------------------------
# W14 phase C · N-3 — a machine token never LEADS a sentence in the document
# ---------------------------------------------------------------------------
#
# MEASURED (W14-F-VERIFY §4.4, §6 N-3). The NİHAİ copy came out with zero
# machine strings; the TASLAK copy — the one the lawyer actually reads while
# revising — opened a warning with a BARE evidence id:
#
#   Düzenleme uyarısı: 'ev-f4d62195ca825b82' alıntısı paragraf metninde
#   birebir bulunamadı: … (QUOTE_ALTERED). …
#
# `ev-f4d62195ca825b82` says nothing to a lawyer, and it is the first thing
# the sentence shows. The rule the rest of the product already follows
# (W13-BACKLOG B-27): the Turkish comes first and the machine token appears in
# parentheses AT MOST — which `(QUOTE_ALTERED)` already satisfied and the
# evidence id did not.
#
# The rewrite happens here, in the parser, so EVERY exporter that reads a
# `Draft` (`petition.py`, `udf.py`, the package) shows the same discipline and
# none of them has to remember it. The warning's own wording is untouched
# apart from the reference: this is a presentation rule, not a translation,
# and the id is never dropped — an id the reader cannot act on is still the id
# the developer needs, so it moves into the parentheses rather than away.

#: An evidence id as the control-plane mints it (`ev-` + digest) — and as the
#: fixtures write it (`ev-tck157`), because a test id is just as unreadable to
#: a lawyer as a hash.
_EVIDENCE_ID_PATTERN = r"ev-[0-9A-Za-z][0-9A-Za-z_-]{3,63}"
_EVIDENCE_ID_RE = re.compile(rf"\b{_EVIDENCE_ID_PATTERN}\b")

#: `'ev-…'` or `'K-3 (ev-…)'` — how `quoteAlteredMessage` refers to evidence.
_QUOTED_EVIDENCE_REF_RE = re.compile(
    rf"'(?:(?P<ref>K-\d+)\s*\()?(?P<id>{_EVIDENCE_ID_PATTERN})\)?'"
)


def presentable_warning(text: str, numbering: dict[str, int] | None = None) -> str:
    """Turkish first, evidence id in parentheses (N-3).

    ``numbering`` maps an evidence id to its ``K-n`` number so the reader gets
    the reference they can actually find in the document; without it the
    sentence still reads, it just says "bir kanıtın" instead of "K-1 numaralı
    kanıtın".
    """
    numbers = numbering or {}

    def _quoted(match: re.Match[str]) -> str:
        evidence_id = match.group("id")
        ref = match.group("ref")
        if ref is None:
            number = numbers.get(evidence_id)
            ref = citation_ref(number) if number is not None else None
        subject = f"{ref} numaralı kanıtın" if ref else "bir kanıtın"
        return f"{subject} (kanıt kimliği: {evidence_id})"

    out = _QUOTED_EVIDENCE_REF_RE.sub(_quoted, text)

    # Anything the quoted form did not catch: an id standing on its own in the
    # running text. It is wrapped where it stands — never removed.
    def _bare(match: re.Match[str]) -> str:
        start = match.start()
        head = out[:start]
        if head.rstrip().endswith("(") or head.rstrip().endswith("kimliği:"):
            return match.group(0)  # already inside a parenthetical
        opened = head.rfind("(")
        if opened != -1 and opened > head.rfind(")"):
            return match.group(0)  # inside an open parenthesis
        return f"(kanıt kimliği: {match.group(0)})"

    out = _EVIDENCE_ID_RE.sub(_bare, out)

    # A sentence must still begin with a word: "bir kanıtın …" at position 0
    # becomes "Bir kanıtın …".
    if out[:1].islower() and not out.startswith("ev-"):
        out = out[:1].upper() + out[1:]
    return out


def _require_str(payload: Any, key: str, *, where: str, allow_empty: bool = False) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or (not allow_empty and value == ""):
        raise DraftFormatError(f"{where}: '{key}' alanı eksik veya geçersiz")
    if "\r" in value:
        # XML line-ending normalization would silently rewrite CR, breaking
        # the self-check and any hash over the text. The TS composer never
        # emits CR; seeing one means the file was tampered with in transit.
        raise DraftFormatError(f"{where}: '{key}' alanı CR (\\r) içeriyor")
    return value


def _optional_str(payload: Any, key: str, *, where: str) -> str:
    value = payload.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise DraftFormatError(f"{where}: '{key}' metin değil")
    if "\r" in value:
        raise DraftFormatError(f"{where}: '{key}' alanı CR (\\r) içeriyor")
    return value


def _parse_review_marks(
    raw: Any, *, where: str, allowed: set[str] | None
) -> dict[str, ReviewMark]:
    """Parse an additive review-record map; absent/None yields an empty map."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise DraftFormatError(f"{where}: nesne olmalı")
    out: dict[str, ReviewMark] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or key == "":
            raise DraftFormatError(f"{where}: geçersiz anahtar")
        if allowed is not None and key not in allowed:
            # Unknown keys are IGNORED, not fatal: the record is additive and
            # a newer console must not break an older exporter.
            continue
        if not isinstance(value, dict):
            raise DraftFormatError(f"{where}.{key}: nesne olmalı")
        checked = value.get("checked", False)
        if not isinstance(checked, bool):
            raise DraftFormatError(f"{where}.{key}: 'checked' bool değil")
        out[key] = ReviewMark(
            checked=checked,
            at=_optional_str(value, "at", where=f"{where}.{key}"),
            by=_optional_str(value, "by", where=f"{where}.{key}"),
            note=_optional_str(value, "note", where=f"{where}.{key}"),
        )
    return out


def parse_draft(payload: Any) -> Draft:
    """Strictly parse a ``collex.draft/v1`` object; raise DraftFormatError."""
    if not isinstance(payload, dict):
        raise DraftFormatError("taslak bir JSON nesnesi değil")
    schema = payload.get("schema", DRAFT_SCHEMA)
    if schema != DRAFT_SCHEMA:
        raise DraftFormatError(f"desteklenmeyen şema: {schema!r} (beklenen {DRAFT_SCHEMA})")
    if payload.get("reviewRequired") is not True:
        raise DraftFormatError(
            "reviewRequired=true olmayan taslak geçersizdir: makine taslağı"
            " avukat incelemesi olmadan nihai olamaz"
        )
    kind = _require_str(payload, "kind", where="taslak")
    if kind not in ("dilekce", "sozlesme"):
        raise DraftFormatError(f"bilinmeyen taslak türü: {kind!r}")

    sections_raw = payload.get("sections")
    if not isinstance(sections_raw, list) or not sections_raw:
        raise DraftFormatError("taslak: 'sections' listesi eksik veya boş")
    sections: list[DraftSection] = []
    for s_index, section in enumerate(sections_raw):
        if not isinstance(section, dict):
            raise DraftFormatError(f"sections[{s_index}] bir nesne değil")
        where = f"sections[{s_index}]"
        title = section.get("title", "")
        if not isinstance(title, str):
            raise DraftFormatError(f"{where}: 'title' metin değil")
        paragraphs_raw = section.get("paragraphs")
        if not isinstance(paragraphs_raw, list):
            raise DraftFormatError(f"{where}: 'paragraphs' listesi eksik")
        paragraphs: list[DraftParagraph] = []
        for p_index, paragraph in enumerate(paragraphs_raw):
            if not isinstance(paragraph, dict):
                raise DraftFormatError(f"{where}.paragraphs[{p_index}] bir nesne değil")
            p_where = f"{where}.paragraphs[{p_index}]"
            evidence_ids = paragraph.get("evidenceIds", [])
            if not isinstance(evidence_ids, list) or not all(
                isinstance(e, str) and e for e in evidence_ids
            ):
                raise DraftFormatError(f"{p_where}: 'evidenceIds' geçersiz")
            supported = paragraph.get("supported")
            if not isinstance(supported, bool):
                raise DraftFormatError(f"{p_where}: 'supported' bool değil")
            note = paragraph.get("note", "")
            if not isinstance(note, str):
                raise DraftFormatError(f"{p_where}: 'note' metin değil")
            role = paragraph.get("role", "govde")
            if not isinstance(role, str):
                raise DraftFormatError(f"{p_where}: 'role' metin değil")
            paragraphs.append(
                DraftParagraph(
                    paragraph_id=_require_str(paragraph, "id", where=p_where),
                    text=_require_str(paragraph, "text", where=p_where),
                    evidence_ids=tuple(evidence_ids),
                    supported=supported,
                    note=note,
                    role=role,
                )
            )
        sections.append(
            DraftSection(
                section_id=_require_str(section, "id", where=where),
                title=title,
                paragraphs=tuple(paragraphs),
            )
        )

    evidence_raw = payload.get("evidence", [])
    if not isinstance(evidence_raw, list):
        raise DraftFormatError("taslak: 'evidence' bir liste değil")
    evidence: list[DraftEvidence] = []
    for e_index, entry in enumerate(evidence_raw):
        if not isinstance(entry, dict):
            raise DraftFormatError(f"evidence[{e_index}] bir nesne değil")
        e_where = f"evidence[{e_index}]"
        title = _require_str(entry, "title", where=e_where)
        label = entry.get("label", title)
        if not isinstance(label, str) or label == "":
            label = title
        direction = entry.get("direction", "")
        if not isinstance(direction, str):
            raise DraftFormatError(f"{e_where}: 'direction' metin değil")
        evidence.append(
            DraftEvidence(
                evidence_id=_require_str(entry, "evidenceId", where=e_where),
                label=label,
                source=_require_str(entry, "source", where=e_where),
                title=title,
                quote=_require_str(entry, "quote", where=e_where),
                quote_sha256=_require_str(entry, "quoteSha256", where=e_where),
                content_sha256=_require_str(entry, "contentSha256", where=e_where),
                direction=direction,
                decision_date=_optional_str(entry, "decisionDate", where=e_where),
            )
        )

    unsupported_count = payload.get("unsupportedCount")
    if not isinstance(unsupported_count, int) or unsupported_count < 0:
        raise DraftFormatError("taslak: 'unsupportedCount' geçersiz")
    warnings_raw = payload.get("warnings", [])
    if not isinstance(warnings_raw, list) or not all(isinstance(w, str) for w in warnings_raw):
        raise DraftFormatError("taslak: 'warnings' geçersiz")
    synthetic = payload.get("synthetic", False)
    if not isinstance(synthetic, bool):
        raise DraftFormatError("taslak: 'synthetic' bool değil")
    synthetic_notice = payload.get("syntheticNotice", "")
    if not isinstance(synthetic_notice, str):
        raise DraftFormatError("taslak: 'syntheticNotice' metin değil")

    version = payload.get("version", 1)
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise DraftFormatError("taslak: 'version' 1 veya daha büyük bir tam sayı olmalı")
    matter_id = payload.get("matterId")
    if matter_id is not None and not isinstance(matter_id, str):
        raise DraftFormatError("taslak: 'matterId' metin veya null olmalı")
    updated_at = _optional_str(payload, "updatedAt", where="taslak")
    matter_title = _optional_str(payload, "matterTitle", where="taslak")
    review_checklist = _parse_review_marks(
        payload.get("reviewChecklist"),
        where="taslak.reviewChecklist",
        allowed={key for key, _ in REVIEW_CHECKLIST_ITEMS},
    )
    evidence_review = _parse_review_marks(
        payload.get("evidenceReview"), where="taslak.evidenceReview", allowed=None
    )

    title = payload.get("title", "")
    if not isinstance(title, str) or title == "":
        title = _require_str(payload, "template", where="taslak")

    # N-3: the exported document shows the Turkish first and the evidence id
    # in parentheses at most. Normalized HERE so every exporter inherits it.
    numbering = {entry.evidence_id: index for index, entry in enumerate(evidence, start=1)}
    warnings = tuple(presentable_warning(w, numbering) for w in warnings_raw)

    return Draft(
        draft_id=_require_str(payload, "draftId", where="taslak"),
        kind=kind,
        template=_require_str(payload, "template", where="taslak"),
        title=title,
        created_at=_require_str(payload, "createdAt", where="taslak"),
        sections=tuple(sections),
        evidence=tuple(evidence),
        unsupported_count=unsupported_count,
        warnings=warnings,
        synthetic=synthetic,
        synthetic_notice=synthetic_notice,
        version=version,
        matter_id=matter_id,
        updated_at=updated_at,
        matter_title=matter_title,
        review_checklist=review_checklist,
        evidence_review=evidence_review,
    )


def load_draft(path: str | Path) -> Draft:
    """Read and strictly parse a draft JSON file."""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise DraftFormatError(f"taslak dosyası okunamadı: {exc}") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DraftFormatError(f"taslak JSON değil: {exc}") from exc
    return parse_draft(payload)


# --------------------------------------------------------------------------
# Verification — nothing is written unless the evidence closure holds
# --------------------------------------------------------------------------


def verify_draft_or_refuse(draft: Draft) -> None:
    """Refuse the export unless the draft's own integrity claims hold."""
    findings: list[str] = []

    seen: set[str] = set()
    # Note: duplicate evidence ids are a finding of their own below, so the
    # id -> entry map is only ever consulted after that check has run.
    for entry in draft.evidence:
        if entry.evidence_id in seen:
            findings.append(f"TEKRARLI_KANIT: {entry.evidence_id} birden çok kez tanımlı")
        seen.add(entry.evidence_id)
        if sha256_utf8(entry.quote) != entry.quote_sha256:
            findings.append(
                f"ALINTI_OZET_UYUSMAZLIGI: {entry.evidence_id} alıntısı kayıtlı"
                " quoteSha256 ile doğrulanamadı"
            )

    by_id = draft.evidence_by_id()
    numbering = draft.numbering()
    unsupported_actual = 0
    for section in draft.sections:
        for paragraph in section.paragraphs:
            if not paragraph.supported:
                unsupported_actual += 1
            for evidence_id in paragraph.evidence_ids:
                if evidence_id not in seen:
                    findings.append(
                        f"BILINMEYEN_KANIT: {paragraph.paragraph_id} paragrafı, taslağın"
                        f" kanıt listesinde olmayan {evidence_id} kimliğine atıf yapıyor"
                    )
                    continue
                # W14 · B-01: the document must still SAY what it cites. A
                # paragraph whose quoted passage was edited (a penalty, a
                # madde number, a date) no longer supports its citation, and
                # no format may be written from it.
                entry = by_id[evidence_id]
                if not paragraph_contains_quote(paragraph.text, entry.quote):
                    number = numbering.get(evidence_id)
                    ref = citation_ref(number) if number is not None else evidence_id
                    findings.append(
                        f"{QUOTE_ALTERED_MESSAGE_TR} ({QUOTE_ALTERED}):"
                        f" {paragraph.paragraph_id} paragrafı [{ref}] alıntısını"
                        " artık birebir içermiyor; bu atıf yazılamaz"
                    )

    if unsupported_actual != draft.unsupported_count:
        findings.append(
            "KAYNAKSIZ_SAYIMI: taslak unsupportedCount="
            f"{draft.unsupported_count} diyor ama {unsupported_actual} paragraf"
            " supported=false"
        )

    if findings:
        raise ExportRefused(
            "taslağın kanıt bütünlüğü doğrulanamadı; hiçbir dosya yazılmadı",
            findings,
        )


def paragraph_lines(paragraph: DraftParagraph, *, marks: bool = True) -> list[str]:
    """The exact document lines a draft paragraph becomes (KAYNAKSIZ aware).

    ``marks=False`` (B-02 ``marks=none``) drops the SCREEN prefix only: the
    paragraph text itself, its ``supported`` flag, the count it feeds and the
    export gate are untouched — the clean filing copy still cannot be produced
    from a draft whose citations do not verify.
    """
    lines = paragraph.text.split("\n")
    if not paragraph.supported and marks:
        lines[0] = f"{KAYNAKSIZ_PREFIX} — {lines[0]}"
    return lines


def expected_citations(draft: Draft) -> list[str]:
    """Evidence ids in body order — what the written artifact must cite."""
    return [
        evidence_id
        for section in draft.sections
        for paragraph in section.paragraphs
        for evidence_id in paragraph.evidence_ids
    ]
