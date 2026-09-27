"""DOCX rendering of a ColleX draft (``collex.draft/v1``) — dilekçe/sözleşme.

The TypeScript drafting composer (``control-plane/src/drafting/composer.ts``)
produces a Draft whose every paragraph declares its evidence discipline:
``supported:true`` with ``evidenceIds`` (bound to validated evidence),
``supported:true`` without ids (beyan/İRADE — party statements, contractual
will), or ``supported:false`` (a legal assertion WITHOUT verified backing).
This module turns that JSON into the Word document a lawyer edits — without
ever weakening the discipline:

1. **Evidence closure is re-verified before a byte is written.** A paragraph
   citing an evidence id that is not in the draft's own evidence list, a
   quote that no longer hashes to its recorded ``quoteSha256``, or an
   inconsistent ``unsupportedCount`` refuses the export
   (:class:`export.errors.ExportRefused`, CLI exit 2, nothing written).
   The parser and the verification live in :mod:`export.draft` and are
   shared with the UDF writer.
2. **Unsupported paragraphs are rendered loudly** — prefixed ``⚠ KAYNAKSIZ``
   in a distinct style — and are NEVER silently dropped.
3. **Every page carries the mandatory banner** ``Bu taslak makine
   üretimidir; avukat incelemesi zorunludur.`` (first-page body banner +
   per-page footer), plus the ``SENTETİK`` notice whenever the draft says its
   evidence came from the synthetic fixture corpus.
4. **No hash and no evidence UUID inside the court text (W12).** A body
   citation reads ``Dayanak [K-n]: <künye>``; the draft's own
   ``ek-dogrulama`` section carries the short verification summary and the
   DAYANAK KAYNAKLARI appendix after the document carries the full hashes,
   each entry headed ``[K-n]`` and closed by its ``Kanıt kimliği`` line —
   which is exactly what lets the read-back map every ``K-n`` back to an
   evidence id and prove the citation closure on the real artifact.
5. The written file is re-opened and parsed back before it is moved into
   place: banner, footer, every paragraph line, every citation line and every
   KAYNAKSIZ marker are proven present on the real artifact.

Requires the optional extra ``python-docx`` (``pip install '.[export]'``),
exactly like :mod:`export.bundle_docx`.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Cm, Inches, Pt, RGBColor

from export import text as T
from export.draft import (
    DEFAULT_EXPORT_MODE,
    DIRECTION_KARSIT,
    DRAFT_REVIEW_BANNER,
    DRAFT_SCHEMA,
    EK_DOGRULAMA_SECTION_ID,
    KARSI_ICTIHAT_SECTION_ID,
    KAYNAKSIZ_PREFIX,
    VERIFICATION_INCOMPLETE_LINE,
    Draft,
    DraftEvidence,
    DraftFormatError,
    DraftParagraph,
    DraftSection,
    ExportMode,
    citation_ref,
    expected_citations,
    load_draft,
    paragraph_lines,
    parse_draft,
    refuse_unfilled_placeholders,
    short_hash,
    verify_draft_or_refuse,
)
from export.errors import ExportError, ExportRefused

__all__ = [
    "DIRECTION_KARSIT",
    "DRAFT_REVIEW_BANNER",
    "DRAFT_SCHEMA",
    "DRAFT_SYNTHETIC_BANNER",
    "Draft",
    "DraftEvidence",
    "DraftFormatError",
    "DraftParagraph",
    "DraftSection",
    "EK_DOGRULAMA_SECTION_ID",
    "ExportError",
    "ExportMode",
    "ExportRefused",
    "FORMAT_NAME",
    "KARSI_ICTIHAT_INTRO",
    "KARSI_ICTIHAT_NOTE",
    "KARSI_ICTIHAT_SECTION_ID",
    "KAYNAKSIZ_PREFIX",
    "PetitionExportResult",
    "PetitionReport",
    "build_petition_document",
    "export_petition_docx",
    "load_draft",
    "parse_draft",
    "read_petition_report",
    "verify_draft_or_refuse",
]

FORMAT_NAME = "dilekce-docx"

# --- Page geometry (W14 · B-02) -------------------------------------------
# python-docx defaults to US Letter (8.5 x 11 in). Turkish courts and UYAP
# expect A4; W13-DAILYFLOW measured 7772400 x 10058400 EMU on the produced
# petition. Margins follow the common Turkish dilekçe practice (2.5 cm all
# round, a little wider at the top for the court's stamp).
A4_WIDTH_CM = 21.0
A4_HEIGHT_CM = 29.7
MARGIN_TOP_CM = 3.0
MARGIN_BOTTOM_CM = 2.5
MARGIN_SIDE_CM = 2.5

DRAFT_SYNTHETIC_BANNER = (
    "DENEME VERİSİ — Bu taslaktaki kaynaklar gerçek değildir; programı"
    " denemek için üretilmiş örnek metinlerdir, gerçek Türk mevzuatı veya"
    " mahkeme kararı değildir."
)

# --- Karşı içtihat (contract collex.draft/v1, additive) --------------------
# The TS composer may emit (a) a ``direction`` field on evidence entries
# ("destekleyen" | "karşıt" | "yön belirtmez") and (b) an optional section
# with id ``karsi-ictihat``. Both are ADDITIVE: an old draft without them
# renders exactly as before. A contrary authority must never look like a
# supporting one on the printed page — that is finding #1 of the lawyer
# critique, and it is enforced by the self-check below.

#: Loud intro paragraph under the karşı içtihat section heading.
KARSI_ICTIHAT_INTRO = (
    "⚠ Bu bölümdeki kararlar talebin AKSİ yönündedir; dilekçenin dayanağı"
    " değildir. Dilekçeye alınıp alınmayacağına ve nasıl karşılanacağına"
    " avukat karar verir."
)

#: Red-flag note printed next to every contrary evidence entry.
KARSI_ICTIHAT_NOTE = (
    "⚠ Bu karar talebin aksi yönündedir; dilekçeye alınıp alınmayacağına"
    " avukat karar verir."
)

#: Citation-line prefix for contrary evidence — never "Dayanak".
CONTRARY_CITATION_PREFIX = "Karşı içtihat"

# Paragraph styles. Named so the produced document is machine-parseable: the
# self-check (and the tests) find citations and KAYNAKSIZ paragraphs by STYLE,
# so body text containing look-alike strings cannot forge either.
STYLE_WARNING = "CollexTaslakUyari"
STYLE_KAYNAKSIZ = "CollexTaslakKaynaksiz"
STYLE_BASLIK = "CollexTaslakBaslikSatiri"
STYLE_TARAF = "CollexTaslakTaraf"
STYLE_BODY = "CollexTaslakGovde"
STYLE_IMZA = "CollexTaslakImza"
STYLE_CITATION = "CollexTaslakAtif"
STYLE_FIELD = "CollexTaslakAlan"
STYLE_QUOTE = "CollexTaslakAlinti"
STYLE_EK = "CollexTaslakEkDogrulama"

_CITATION_LINE = re.compile(r"\A(?:Dayanak|Karşı içtihat) \[([^\]\s]+)\]: ")
#: The `annex=none` citation shape: no machine reference, künye only (B-02).
_CITATION_LINE_NO_REF = re.compile(r"\A(?:Dayanak|Karşı içtihat): ")
_K_REF = re.compile(r"\AK-(\d+)\Z")
_APPENDIX_HEAD = re.compile(r"\A\[K-(\d+)\] ")
_KIMLIK = re.compile(r"\ADenetim dosyasındaki kaydı: (\S+)\Z")


# --------------------------------------------------------------------------
# Document construction
# --------------------------------------------------------------------------


def _ensure_style(document: Any, name: str, base: str) -> Any:
    styles = document.styles
    for existing in styles:
        if existing.name == name:
            return existing
    style = styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = styles[base]
    return style


def _apply_page_geometry(document: Any) -> None:
    """A4 portrait with Turkish dilekçe margins on EVERY section (B-02)."""
    for section in document.sections:
        section.page_width = Cm(A4_WIDTH_CM)
        section.page_height = Cm(A4_HEIGHT_CM)
        section.top_margin = Cm(MARGIN_TOP_CM)
        section.bottom_margin = Cm(MARGIN_BOTTOM_CM)
        section.left_margin = Cm(MARGIN_SIDE_CM)
        section.right_margin = Cm(MARGIN_SIDE_CM)


def _register_styles(document: Any) -> None:
    # 12pt serif body (brief 11.5 deliverable quality).
    normal = document.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(12)

    warning = _ensure_style(document, STYLE_WARNING, "Normal")
    warning.font.bold = True
    warning.font.color.rgb = RGBColor(0xB0, 0x00, 0x00)

    kaynaksiz = _ensure_style(document, STYLE_KAYNAKSIZ, "Normal")
    kaynaksiz.font.bold = True
    kaynaksiz.font.color.rgb = RGBColor(0xB0, 0x00, 0x00)
    kaynaksiz.paragraph_format.left_indent = Inches(0.2)

    baslik = _ensure_style(document, STYLE_BASLIK, "Normal")
    baslik.font.bold = True
    baslik.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    baslik.paragraph_format.space_after = Pt(10)

    taraf = _ensure_style(document, STYLE_TARAF, "Normal")
    taraf.font.bold = True
    taraf.paragraph_format.space_after = Pt(2)

    body = _ensure_style(document, STYLE_BODY, "Normal")
    body.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    body.paragraph_format.space_after = Pt(6)

    imza = _ensure_style(document, STYLE_IMZA, "Normal")
    imza.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    imza.paragraph_format.space_after = Pt(2)

    citation = _ensure_style(document, STYLE_CITATION, "Normal")
    citation.font.size = Pt(10)
    citation.paragraph_format.left_indent = Inches(0.35)
    citation.paragraph_format.space_after = Pt(2)

    field_style = _ensure_style(document, STYLE_FIELD, "Normal")
    field_style.font.size = Pt(9)
    field_style.paragraph_format.space_after = Pt(0)

    quote = _ensure_style(document, STYLE_QUOTE, "Quote")
    quote.paragraph_format.left_indent = Inches(0.35)
    quote.paragraph_format.space_after = Pt(0)
    quote.font.italic = False

    ek = _ensure_style(document, STYLE_EK, "Normal")
    ek.font.size = Pt(9)
    ek.paragraph_format.space_after = Pt(2)


def _add_page_number_field(paragraph: Any) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def _build_footer(document: Any, *, synthetic: bool) -> None:
    """Mandatory per-page footer: review banner (+ SENTETİK tag) + page no."""
    for section in document.sections:
        section.different_first_page_header_footer = False
        footer = section.footer
        footer.is_linked_to_previous = False
        paragraphs = footer.paragraphs
        first = paragraphs[0] if paragraphs else footer.add_paragraph()
        first.text = ""
        first.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = first.add_run(DRAFT_REVIEW_BANNER)
        run.bold = True
        run.font.size = Pt(8)
        if synthetic:
            tag = footer.add_paragraph()
            tag.alignment = WD_ALIGN_PARAGRAPH.CENTER
            tag_run = tag.add_run(
                f"{T.SYNTHETIC_FOOTER_TAG} — gerçek Türk mevzuatı veya"
                " mahkeme kararı değildir"
            )
            tag_run.bold = True
            tag_run.font.size = Pt(8)
        page = footer.add_paragraph()
        page.alignment = WD_ALIGN_PARAGRAPH.CENTER
        page_run = page.add_run("Sayfa ")
        page_run.font.size = Pt(8)
        _add_page_number_field(page)


# --- Direct formatting (W14 · B-02) ---------------------------------------
# The styles above already carry bold and alignment, but Word (and python-docx)
# report an INHERITED value as None: W13-DAILYFLOW read 236/236 paragraphs as
# `bold=False, alignment=None`, and a lawyer opening the file in Word saw an
# unformatted wall of text. Every paragraph therefore also carries the value
# directly, so what the reader (and the read-back) sees is what we intended.
_STYLE_ALIGNMENT: dict[str, Any] = {
    STYLE_BASLIK: WD_ALIGN_PARAGRAPH.CENTER,
    STYLE_IMZA: WD_ALIGN_PARAGRAPH.RIGHT,
    STYLE_BODY: WD_ALIGN_PARAGRAPH.JUSTIFY,
    STYLE_TARAF: WD_ALIGN_PARAGRAPH.LEFT,
    STYLE_QUOTE: WD_ALIGN_PARAGRAPH.JUSTIFY,
    STYLE_CITATION: WD_ALIGN_PARAGRAPH.LEFT,
    STYLE_FIELD: WD_ALIGN_PARAGRAPH.LEFT,
    STYLE_EK: WD_ALIGN_PARAGRAPH.LEFT,
    STYLE_KAYNAKSIZ: WD_ALIGN_PARAGRAPH.JUSTIFY,
    STYLE_WARNING: WD_ALIGN_PARAGRAPH.LEFT,
}

#: Styles whose runs are bold on the page (court address, party labels, marks).
_BOLD_STYLES = frozenset({STYLE_BASLIK, STYLE_TARAF, STYLE_WARNING, STYLE_KAYNAKSIZ})


def _para(document: Any, text_value: str, style: str | None = None) -> Any:
    paragraph = document.add_paragraph(style=style)
    if style is not None:
        alignment = _STYLE_ALIGNMENT.get(style)
        if alignment is not None:
            paragraph.alignment = alignment
    if text_value:
        run = paragraph.add_run(text_value)
        if style in _BOLD_STYLES:
            run.bold = True
    return paragraph


_ROLE_STYLES = {
    "baslik": STYLE_BASLIK,
    "taraflar": STYLE_TARAF,
    "imza": STYLE_IMZA,
    "ekDogrulama": STYLE_EK,
}


def citation_line(
    entry: DraftEvidence, number: int, *, contrary: bool, include_ref: bool
) -> str:
    """The citation line printed under a paragraph.

    W12: K-n reference + künye only — no hash, no UUID in the court text.
    W14 · B-02: with ``annex=none`` there is no DAYANAK KAYNAKLARI list for a
    ``[K-n]`` to point at, so the machine reference is dropped and the line
    reads as a Turkish petition citation: ``Dayanak: <künye>``.
    """
    prefix = CONTRARY_CITATION_PREFIX if contrary else "Dayanak"
    ref = f" [{citation_ref(number)}]" if include_ref else ""
    return f"{prefix}{ref}: {entry.label}"


def _add_draft_paragraph(
    document: Any,
    paragraph: DraftParagraph,
    by_id: dict[str, DraftEvidence],
    numbering: dict[str, int],
    *,
    contrary_section: bool = False,
    mode: ExportMode = DEFAULT_EXPORT_MODE,
) -> None:
    style = (
        STYLE_KAYNAKSIZ
        if not paragraph.supported and mode.show_marks
        else _ROLE_STYLES.get(paragraph.role, STYLE_BODY)
    )
    for line in paragraph_lines(paragraph, marks=mode.show_marks):
        _para(document, line, style)
    if not paragraph.supported and paragraph.note and mode.show_marks:
        _para(document, f"Not: {paragraph.note}", STYLE_CITATION)
    elif contrary_section and paragraph.note:
        # Contract A: karşı içtihat paragraphs carry the lawyer-decision note;
        # it is printed loudly, never dropped — a contrary authority must not
        # read as a supporting one in ANY mode.
        _para(document, f"⚠ {paragraph.note}", STYLE_WARNING)
    for evidence_id in paragraph.evidence_ids:
        entry = by_id[evidence_id]  # closure verified before building
        contrary = contrary_section or entry.is_contrary
        _para(
            document,
            citation_line(
                entry,
                numbering[evidence_id],
                contrary=contrary,
                include_ref=mode.include_annex,
            ),
            STYLE_CITATION,
        )
        if contrary:
            _para(document, KARSI_ICTIHAT_NOTE, STYLE_WARNING)


def _add_meta_table(document: Any, draft: Draft, generated_at: str, version: str) -> None:
    # Human rows first (GG.AA.YYYY); the raw ISO stamps and the system version
    # stay available in the single "Teknik künye" row at the bottom.
    rows = [
        ("Belge türü", draft.title),
        ("Sürüm", str(draft.version)),
        ("Oluşturulma", T.human_timestamp(draft.created_at)),
    ]
    if draft.updated_at:
        rows.append(("Son düzenleme", T.human_timestamp(draft.updated_at)))
    if draft.matter_id:
        rows.append(("Dosya", draft.matter_label))
    rows.extend(
        [
            ("Belge üretim zamanı", T.human_timestamp(generated_at)),
            (
                "Hukukî dayanağı doğrulanamayan paragraf",
                f"{draft.unsupported_count} (belgede ⚠ KAYNAKSIZ diye"
                " işaretlidir; dayanağı avukat eklemelidir)",
            ),
            ("Bağlı kaynak", str(len(draft.evidence))),
        ]
    )
    contrary_count = sum(1 for entry in draft.evidence if entry.is_contrary)
    if contrary_count:
        rows.append(
            (
                "Karşı içtihat kaydı",
                f"{contrary_count} — talebin aksi yönünde; avukat değerlendirmesi şart",
            )
        )
    rows.extend(
        [
            ("İnceleme durumu", "AVUKAT İNCELEMESİ ZORUNLU"),
            (
                "Teknik künye",
                f"taslak kimliği: {draft.draft_id} · şablon: {draft.template}"
                f" ({draft.kind}) · oluşturulma (ISO): {draft.created_at} ·"
                f" üretim (ISO): {generated_at} · sistem sürümü: {version}",
            ),
        ]
    )
    table = document.add_table(rows=0, cols=2)
    table.style = "Table Grid"
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].text = label
        cells[1].text = value


def _add_appendix_entry(document: Any, index: int, entry: DraftEvidence) -> None:
    _para(document, f"[{citation_ref(index)}] {entry.label}", STYLE_TARAF)
    _para(document, f"Kaynak: {T.source_label_tr(entry.source)}", STYLE_FIELD)
    if entry.direction:
        # Additive contract-A field; absent on older drafts.
        _para(document, f"Yönü: {entry.direction}", STYLE_FIELD)
        if entry.is_contrary:
            _para(document, KARSI_ICTIHAT_NOTE, STYLE_WARNING)
    if not entry.is_upload:
        _para(document, "Alıntı (birebir):", STYLE_FIELD)
        for line in entry.quote.split("\n"):
            _para(document, line, STYLE_QUOTE)
    # W15: görünen satır avukat Türkçesidir; onu DENETLENEBİLİR kılan değerler
    # hemen altındadır. Bu ek dilekçeden çıkarılabilen denetim katmanıdır — bir
    # önceki tur bu üç satırı tümüyle silmişti ve "birebir uyuştu" cümlesi
    # kimsenin sınayamayacağı bir iddiaya dönüşmüştü. Ayrıca belgeyi geri okuyan
    # kapanım denetimi [K-n] atıflarını kanıt kaydına yalnız bu satır üzerinden
    # bağlayabiliyor; satır gidince her atıf "tanımsız" görünüyordu.
    _para(document, "Alıntı denetimi: kaynağıyla birebir uyuştu", STYLE_FIELD)
    if not entry.is_upload:
        _para(
            document,
            f"Alıntının parmak izi: {entry.quote_sha256} (Teknik adı: SHA-256)",
            STYLE_FIELD,
        )
        _para(document, f"Belgenin parmak izi: {entry.content_sha256}", STYLE_FIELD)
    _para(document, f"Denetim dosyasındaki kaydı: {entry.evidence_id}", STYLE_FIELD)


def build_petition_document(
    draft: Draft,
    *,
    generated_at: str,
    system_version: str,
    mode: ExportMode = DEFAULT_EXPORT_MODE,
) -> Any:
    """Build the in-memory Document. No I/O, no verification side effects."""
    document = Document()
    _apply_page_geometry(document)
    _register_styles(document)
    _build_footer(document, synthetic=draft.synthetic)

    # ---- mandatory first-page banner -------------------------------------
    # The banner survives EVERY mode: `marks=none` removes reviewer ink from
    # the body, never the statement that this is a machine draft (trap §C.2).
    _para(document, DRAFT_REVIEW_BANNER, STYLE_WARNING)
    if draft.synthetic:
        banner = DRAFT_SYNTHETIC_BANNER
        if draft.synthetic_notice:
            banner = f"{banner} Taslak notu: {draft.synthetic_notice}"
        _para(document, banner, STYLE_WARNING)
    # B-36: while any review box is unticked, the document says so — in every
    # mode, because that is exactly the sentence a filing copy must not hide.
    if not draft.review_complete:
        _para(document, VERIFICATION_INCOMPLETE_LINE, STYLE_WARNING)

    document.add_heading(f"{draft.title} ({mode.label})", level=0)
    if mode.include_annex:
        _add_meta_table(document, draft, generated_at, system_version)
        _para(document, "")

        if draft.warnings:
            document.add_heading("Uyarılar", level=1)
            for warning in draft.warnings:
                _para(document, warning, STYLE_FIELD)

    # ---- body -------------------------------------------------------------
    by_id = draft.evidence_by_id()
    numbering = draft.numbering()
    for section in draft.sections:
        # B-02: the machine-owned verification section is APPARATUS, not body.
        if section.section_id == EK_DOGRULAMA_SECTION_ID and not mode.include_annex:
            continue
        contrary_section = section.section_id == KARSI_ICTIHAT_SECTION_ID
        if section.title:
            document.add_heading(section.title, level=1)
        if contrary_section:
            # Contract A: contrary case law gets its own heading AND a loud
            # intro — it must never read like a supporting authority.
            _para(document, KARSI_ICTIHAT_INTRO, STYLE_WARNING)
        for paragraph in section.paragraphs:
            _add_draft_paragraph(
                document,
                paragraph,
                by_id,
                numbering,
                contrary_section=contrary_section,
                mode=mode,
            )

    if not mode.include_annex:
        # The clean filing copy stops here: no appendix, no schema tag, no
        # application instruction. The hash package is a SEPARATE file.
        return document

    # ---- evidence appendix -------------------------------------------------
    document.add_heading("DAYANAK KAYNAKLARI", level=1)
    _para(
        document,
        "Bu ek, dilekçede atıf yapılan her kaynağın künyesini ve alıntısını"
        " gösterir. Dilekçeyi mahkemeye verirken bu eki çıkarabilirsiniz;"
        " ek ayrı bir dosya olarak da alınabilir.",
        STYLE_FIELD,
    )
    if draft.evidence:
        for index, entry in enumerate(draft.evidence, start=1):
            _add_appendix_entry(document, index, entry)
    else:
        _para(document, "Bu taslağa bağlanmış doğrulanmış kaynak yoktur.", STYLE_FIELD)

    # ---- closing notices ----------------------------------------------------
    _para(document, T.UDF_NOTICE, STYLE_WARNING)
    _para(document, DRAFT_REVIEW_BANNER, STYLE_WARNING)
    return document


# --------------------------------------------------------------------------
# Read-back + self-check on the real artifact
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PetitionReport:
    """Machine view of a produced draft ``.docx``, parsed back from disk."""

    paragraph_texts: tuple[str, ...]
    kaynaksiz_texts: tuple[str, ...]
    #: Evidence ids the body cites, in order — ``K-n`` references resolved
    #: through the appendix's ``[K-n]`` / ``Kanıt kimliği`` pairs.
    citation_ids: tuple[str, ...]
    footer_texts: tuple[str, ...]
    headings: tuple[str, ...] = ()
    full_text: str = ""
    #: Raw body references as written (``K-n``), in order (W12).
    citation_refs: tuple[str, ...] = ()
    #: Additive (W14 · B-02): the full citation LINES, found by STYLE. Body
    #: text may legitimately begin with "Dayanak: " (the HUKUKÎ SEBEPLER
    #: paragraph does), so the closure check must never match on text alone.
    citation_lines: tuple[str, ...] = ()
    #: ``n -> evidence id`` map read from the appendix (W12).
    numbering: tuple[tuple[int, str], ...] = ()


def read_petition_report(path: str | Path) -> PetitionReport:
    document = Document(str(path))
    texts: list[str] = []
    kaynaksiz: list[str] = []
    refs: list[str] = []
    citation_lines: list[str] = []
    headings: list[str] = []
    kmap: dict[int, str] = {}
    current_k: int | None = None
    for paragraph in document.paragraphs:
        style_name = "" if paragraph.style is None else (paragraph.style.name or "")
        content = paragraph.text
        texts.append(content)
        if style_name == STYLE_KAYNAKSIZ:
            kaynaksiz.append(content)
        elif style_name == STYLE_CITATION:
            match = _CITATION_LINE.match(content)
            if match is not None:
                refs.append(match.group(1))
                citation_lines.append(content)
            elif _CITATION_LINE_NO_REF.match(content) is not None:
                citation_lines.append(content)
        elif style_name.startswith("Heading") or style_name == "Title":
            headings.append(content)
        elif style_name == STYLE_TARAF:
            head = _APPENDIX_HEAD.match(content)
            current_k = int(head.group(1)) if head is not None else None
        elif style_name == STYLE_FIELD and current_k is not None:
            kimlik = _KIMLIK.match(content)
            if kimlik is not None:
                kmap[current_k] = kimlik.group(1)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                texts.append(cell.text)
    footers: list[str] = []
    for section in document.sections:
        for paragraph in section.footer.paragraphs:
            footers.append(paragraph.text)
    ids: list[str] = []
    for ref in refs:
        k = _K_REF.match(ref)
        # A K-n the appendix cannot resolve stays raw, so the closure check
        # fails loudly instead of silently matching nothing.
        ids.append(kmap.get(int(k.group(1)), ref) if k is not None else ref)
    return PetitionReport(
        paragraph_texts=tuple(texts),
        kaynaksiz_texts=tuple(kaynaksiz),
        citation_ids=tuple(ids),
        footer_texts=tuple(footers),
        headings=tuple(headings),
        full_text="\n".join(texts),
        citation_refs=tuple(refs),
        citation_lines=tuple(citation_lines),
        numbering=tuple(sorted(kmap.items())),
    )


def _expected_body_citation_lines(draft: Draft, mode: ExportMode) -> list[str]:
    """Every citation line the body must carry, in document order (B-02)."""
    by_id = draft.evidence_by_id()
    numbering = draft.numbering()
    out: list[str] = []
    for section in draft.sections:
        if section.section_id == EK_DOGRULAMA_SECTION_ID and not mode.include_annex:
            continue
        contrary_section = section.section_id == KARSI_ICTIHAT_SECTION_ID
        for paragraph in section.paragraphs:
            for evidence_id in paragraph.evidence_ids:
                entry = by_id[evidence_id]
                out.append(
                    citation_line(
                        entry,
                        numbering[evidence_id],
                        contrary=contrary_section or entry.is_contrary,
                        include_ref=mode.include_annex,
                    )
                )
    return out


def _self_check(path: Path, draft: Draft, mode: ExportMode = DEFAULT_EXPORT_MODE) -> None:
    """Re-open the written file and prove it says what the draft promised."""
    produced = read_petition_report(path)
    failures: list[str] = []

    if not produced.paragraph_texts or produced.paragraph_texts[0] != DRAFT_REVIEW_BANNER:
        failures.append("ZORUNLU_UYARI: ilk sayfa bandı ilk paragraf değil")
    if not any(DRAFT_REVIEW_BANNER in footer for footer in produced.footer_texts):
        failures.append("ZORUNLU_UYARI: sayfa altbilgisinde inceleme bandı yok")
    if draft.synthetic and T.SYNTHETIC_FOOTER_TAG not in "\n".join(
        (*produced.footer_texts, produced.full_text)
    ):
        failures.append("SENTETIK_ETIKETI: sentetik taslak SENTETİK olarak etiketlenmemiş")
    # B-36: the "not verified yet" line is not optional while a box is open.
    if not draft.review_complete and VERIFICATION_INCOMPLETE_LINE not in produced.paragraph_texts:
        failures.append("DOGRULAMA_KAYDI: 'doğrulama tamamlanmadı' satırı belgede yok")

    written = set(produced.paragraph_texts)
    expected_kaynaksiz = 0
    for section in draft.sections:
        if section.section_id == EK_DOGRULAMA_SECTION_ID and not mode.include_annex:
            continue
        for paragraph in section.paragraphs:
            if not paragraph.supported:
                expected_kaynaksiz += 1
            for line in paragraph_lines(paragraph, marks=mode.show_marks):
                if line and line not in written:
                    failures.append(
                        f"EKSIK_PARAGRAF: {paragraph.paragraph_id} paragrafının satırı"
                        " belgede yok"
                    )
                    break

    # `marks=none` prints no KAYNAKSIZ-styled paragraph at all; the count the
    # draft declares is still verified by `verify_draft_or_refuse`.
    expected_marked = expected_kaynaksiz if mode.show_marks else 0
    if len(produced.kaynaksiz_texts) != expected_marked or any(
        not text.startswith(KAYNAKSIZ_PREFIX) for text in produced.kaynaksiz_texts
    ):
        failures.append(
            "KAYNAKSIZ_ISARETI: KAYNAKSIZ paragraf sayısı/işareti belgede tutmuyor"
            f" (beklenen {expected_marked}, yazılan {len(produced.kaynaksiz_texts)})"
        )

    evidence_ids = {entry.evidence_id for entry in draft.evidence}
    if mode.include_annex:
        if list(produced.citation_ids) != expected_citations(draft):
            failures.append("ATIF_KAPANIMI: yazılan dayanak atıfları taslaktakiyle birebir değil")
        for cited in produced.citation_ids:
            if cited not in evidence_ids:
                failures.append(f"ATIF_KAPANIMI: belgede tanımsız kanıt atıfı {cited}")
        for ref in produced.citation_refs:
            if _K_REF.match(ref) is None:
                failures.append(f"ATIF_BICIMI: gövdede K-n olmayan atıf {ref}")
        # The appendix numbering must be the draft's own numbering, entry for entry.
        expected_numbering = tuple(
            (index, entry.evidence_id) for index, entry in enumerate(draft.evidence, start=1)
        )
        if produced.numbering != expected_numbering:
            failures.append("KANIT_NUMARASI: ekteki [K-n] numaralandırması taslakla birebir değil")
    else:
        # No appendix to resolve K-n through, so the closure is proven on the
        # printed künye lines instead — same strictness, different alphabet.
        expected_lines = _expected_body_citation_lines(draft, mode)
        if list(produced.citation_lines) != expected_lines:
            failures.append("ATIF_KAPANIMI: yazılan dayanak atıfları taslaktakiyle birebir değil")
        if any("[K-" in line for line in produced.paragraph_texts):
            failures.append("NIHAI_TEMIZLIK: nihai kopyada makine atıf numarası ([K-n]) kaldı")
        if any(KAYNAKSIZ_PREFIX in line for line in produced.paragraph_texts):
            failures.append("NIHAI_TEMIZLIK: nihai kopyada ekran işareti (KAYNAKSIZ) kaldı")

    # Contract A: contrary case law must be loudly marked on the artifact.
    if any(
        section.section_id == KARSI_ICTIHAT_SECTION_ID for section in draft.sections
    ) and KARSI_ICTIHAT_INTRO not in produced.paragraph_texts:
        failures.append(
            "KARSI_ICTIHAT: karşı içtihat bölümünün uyarı girişi belgede yok"
        )
    if any(entry.is_contrary for entry in draft.evidence):
        # "Yönü: karşıt" lives in the DAYANAK KAYNAKLARI appendix; with
        # `annex=none` the appendix is gone, but the BODY marking (the loud
        # intro, the "Karşı içtihat:" prefix and the note below every contrary
        # citation) is still mandatory — checked immediately below.
        if mode.include_annex and f"Yönü: {DIRECTION_KARSIT}" not in produced.paragraph_texts:
            failures.append(
                "KARSI_ICTIHAT: karşıt kanıt için 'Yönü: karşıt' satırı belgede yok"
            )
        if KARSI_ICTIHAT_NOTE not in produced.paragraph_texts:
            failures.append(
                "KARSI_ICTIHAT: karşıt kanıt uyarı notu belgede yok"
            )

    if failures:
        raise ExportRefused(
            "DOCX çıktısı taslağın kendisiyle doğrulanamadı", failures
        )


# --------------------------------------------------------------------------
# Public export entry point
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PetitionExportResult:
    path: Path
    format: str
    paragraph_count: int
    unsupported_count: int
    citation_count: int
    synthetic: bool
    #: Additive (W14 · B-02): "TASLAK" (annex/marks on) or "NİHAİ" (clean copy).
    mode_label: str = "TASLAK"

    def summary(self) -> str:
        parts = [
            f"DILEKCE-DOCX yazıldı ({self.mode_label}): {self.path}",
            f"paragraf: {self.paragraph_count}",
            f"KAYNAKSIZ: {self.unsupported_count}",
            f"atıf: {self.citation_count}",
        ]
        if self.synthetic:
            parts.append(T.SYNTHETIC_FOOTER_TAG)
        return " | ".join(parts)


def export_petition_docx(
    draft: Draft,
    out_path: str | Path,
    *,
    generated_at: str | None = None,
    system_version: str | None = None,
    mode: ExportMode = DEFAULT_EXPORT_MODE,
) -> PetitionExportResult:
    """Verify, build, write-to-temp, re-open, self-check, then publish.

    The file only ever appears at ``out_path`` after the draft's evidence
    closure verified AND the written document was re-parsed and proven to
    carry the banner, every paragraph, every KAYNAKSIZ marker and exactly the
    planned citations. Any failure raises :class:`ExportRefused` (or an OSError)
    and removes the temporary file — a refused export leaves nothing behind.
    """
    from export import __version__

    verify_draft_or_refuse(draft)
    # 27.09.2026: the NİHAİ copy may not carry an unfilled system placeholder
    # (an additional, filing-copy-only gate; the one above is unchanged).
    refuse_unfilled_placeholders(draft, mode)
    # Local time with explicit offset: the human künye shows GG.AA.YYYY HH:MM
    # "(yerel saat)", the Teknik künye row keeps the full ISO stamp.
    stamp = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    # W14 B-02 (DAILYFLOW #9): the evidence-bundle schema tag
    # (collex.export.evidence-report/v1) is NOT this document's schema and
    # has no business in a petition a court reads. Human line, human words.
    version = system_version or f"ColleX export {__version__}"

    document = build_petition_document(
        draft, generated_at=stamp, system_version=version, mode=mode
    )

    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(
        prefix=f".{target.stem}-", suffix=".docx.tmp", dir=str(target.parent)
    )
    os.close(handle)
    tmp_path = Path(tmp_name)
    try:
        document.save(str(tmp_path))
        _self_check(tmp_path, draft, mode)
        os.replace(tmp_path, target)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    citation_count = len(expected_citations(draft))
    paragraph_count = sum(len(section.paragraphs) for section in draft.sections)
    return PetitionExportResult(
        path=target,
        format=FORMAT_NAME,
        paragraph_count=paragraph_count,
        unsupported_count=draft.unsupported_count,
        citation_count=citation_count,
        synthetic=draft.synthetic,
        mode_label=mode.label,
    )


# Kept importable for callers that used the private helper name.
_short_hash = short_hash
