"""DOCX export of an evidence bundle — the deliverable a lawyer opens in Word.

Requires the optional extra: ``pip install .[export]`` (``python-docx``). The
rest of :mod:`export` stays standard-library only so the MCP server itself
does not grow a Word dependency.

Document layout (``collex.export.evidence-report/v1``)
-----------------------------------------------------
1. Title + SENTETİK banner (when the bundle says so) + lawyer-review notice.
2. ``Belge Künyesi`` — soru, değerlendirme tarihi (as-of, GG.AA.YYYY), durum
   (insan diliyle), belge üretim zamanı, kaynak/atıf sayıları, bütünlük
   doğrulama özeti; ham enum + ISO damgalar ``Teknik künye`` alt tablosunda.
3. ``Cevap Gövdesi`` — one block per claim: the claim text, then a dedicated
   citation line carrying the numbered markers ``[1][2]``.
4. ``Her Sonucun Ne Kadar Sağlam Dayandığı`` — five confidence dimensions.
5. ``Çelişen Otoriteler`` — always present, explicit when empty.
6. ``Dayanak Bulunamayan Sonuçlar`` — always present, explicit when empty.
7. ``Hangi Kaynak Neden Kullanılamadı``.
8. ``KAYNAKLAR`` — per entry: mahkeme/daire, E./K., tarih, mevzuat/madde, the
   EXACT quote as a block quote, alıntı SHA-256, belge içerik SHA-256, the
   quote's place in the source text, kaynak URL. Machine ids (document
   version/document/evidence) were dropped in W15: a lawyer cannot read or
   use them, and the künye + date + URL already locate the source.
9. ``DOĞRULAMA`` — how a reader re-verifies a quote by opening the source and
   comparing it, without trusting this system.

Every page carries the machine-generated / lawyer-review-required footer
(brief 11.5), plus a ``DENEME VERİSİ`` tag when applicable.

Why custom paragraph styles
---------------------------
``CollexQuote``, ``CollexAtif`` and ``CollexKaynakBaslik`` are not cosmetic.
They make the produced document machine-parseable, which is what lets
:func:`export_docx` re-open the file it just wrote and prove that the citation
markers in the body and the entries in KAYNAKLAR are the same set — the
"never invent, never drop a citation" guarantee, checked on the real artifact
rather than on the in-memory plan. They also keep untrusted quote text out of
the marker scan, so a quote containing the literal string ``[3]`` cannot
forge a citation.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Inches, Pt, RGBColor

from export import text as T
from export.bundle import (
    CONFIDENCE_DIMENSIONS,
    CONFIDENCE_LEGEND,
    EvidenceBundle,
    EvidenceEntry,
)
from export.errors import ExportRefused
from export.plan import (
    CitationPlan,
    assert_citation_closure,
    build_citation_plan,
    meta_rows,
    tech_rows,
)
from export.result import ExportResult
from export.verify import VerificationReport, verify_bundle_or_refuse

FORMAT_NAME = "docx"

#: Paragraph style carrying an exact quote (one paragraph per quote line).
STYLE_QUOTE = "CollexQuote"
#: Paragraph style carrying ONLY citation markers, e.g. "Atıflar: [1][2]".
STYLE_CITATION = "CollexAtif"
#: Paragraph style of a KAYNAKLAR entry heading, e.g. "[1] Başlık".
STYLE_SOURCE_HEADING = "CollexKaynakBaslik"
#: Paragraph style of a claim's prose.
STYLE_CLAIM = "CollexTespit"
#: Paragraph style of a warning banner (synthetic / lawyer review).
STYLE_WARNING = "CollexUyari"
#: Paragraph style of a KAYNAKLAR field line ("Etiket: değer").
STYLE_FIELD = "CollexAlan"

_MARKER = re.compile(r"\[(\d+)\]")
_SOURCE_HEADING = re.compile(r"\A\[(\d+)\]\s")


# --------------------------------------------------------------------------
# Reading a produced report back (self-check + tests)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class DocxReport:
    """Machine view of a produced ``.docx``, parsed back from the file."""

    #: Citation numbers that appear in the answer body's citation lines.
    body_numbers: frozenset[int]
    #: KAYNAKLAR entry numbers, in document order.
    appendix_numbers: tuple[int, ...]
    #: Exact quote text per KAYNAKLAR entry number.
    quotes: dict[int, str] = field(default_factory=dict)
    #: Heading texts, in document order.
    headings: tuple[str, ...] = ()
    #: Footer paragraph texts of every section.
    footer_texts: tuple[str, ...] = ()
    #: All body + table text, newline joined (for coarse "is X present" checks).
    full_text: str = ""

    def has_section(self, heading: str) -> bool:
        return any(h.strip() == heading for h in self.headings)


def _paragraph_style_name(paragraph: Any) -> str:
    style = paragraph.style
    return "" if style is None else (style.name or "")


def read_docx_report(path: str | Path) -> DocxReport:
    """Parse a ColleX evidence report back out of a ``.docx`` file."""
    document = Document(str(path))

    body: set[int] = set()
    appendix: list[int] = []
    quotes: dict[int, list[str]] = {}
    headings: list[str] = []
    texts: list[str] = []
    current: int | None = None

    for paragraph in document.paragraphs:
        style_name = _paragraph_style_name(paragraph)
        content = paragraph.text
        texts.append(content)
        if style_name == STYLE_SOURCE_HEADING:
            match = _SOURCE_HEADING.match(content)
            if match is None:
                raise ExportRefused(
                    "KAYNAKLAR girişi numarasız yazılmış: " + content[:80]
                )
            current = int(match.group(1))
            appendix.append(current)
            quotes.setdefault(current, [])
        elif style_name == STYLE_QUOTE:
            if current is None:
                raise ExportRefused("bir alıntı, hiçbir KAYNAKLAR girişine bağlı değil")
            quotes[current].append(content)
        elif style_name == STYLE_CITATION:
            body.update(int(m.group(1)) for m in _MARKER.finditer(content))
        elif style_name.startswith("Heading") or style_name == "Title":
            headings.append(content)

    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                texts.append(cell.text)

    footers: list[str] = []
    for section in document.sections:
        for paragraph in section.footer.paragraphs:
            footers.append(paragraph.text)

    return DocxReport(
        body_numbers=frozenset(body),
        appendix_numbers=tuple(appendix),
        quotes={n: "\n".join(lines) for n, lines in quotes.items()},
        headings=tuple(headings),
        footer_texts=tuple(footers),
        full_text="\n".join(texts),
    )


# --------------------------------------------------------------------------
# Building the document
# --------------------------------------------------------------------------


def _ensure_style(document: Any, name: str, base: str) -> Any:
    styles = document.styles
    for existing in styles:
        if existing.name == name:
            return existing
    style = styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = styles[base]
    return style


def _register_styles(document: Any) -> None:
    quote = _ensure_style(document, STYLE_QUOTE, "Quote")
    quote.paragraph_format.left_indent = Inches(0.35)
    quote.paragraph_format.space_after = Pt(0)
    quote.font.italic = False

    citation = _ensure_style(document, STYLE_CITATION, "Normal")
    citation.font.bold = True
    citation.paragraph_format.space_after = Pt(2)

    heading = _ensure_style(document, STYLE_SOURCE_HEADING, "Heading 2")

    claim = _ensure_style(document, STYLE_CLAIM, "Normal")
    claim.paragraph_format.space_after = Pt(4)

    warning = _ensure_style(document, STYLE_WARNING, "Normal")
    warning.font.bold = True
    warning.font.color.rgb = RGBColor(0xB0, 0x00, 0x00)

    field_style = _ensure_style(document, STYLE_FIELD, "Normal")
    field_style.font.size = Pt(9)
    field_style.paragraph_format.space_after = Pt(0)

    # Touch so linters/readers see these are intentionally configured objects.
    assert heading is not None


def _add_page_number_field(paragraph: Any) -> None:
    """Append a live ``PAGE`` field so every printed page is identifiable."""
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
    """Mandatory per-page footer (brief 11.5)."""
    for section in document.sections:
        section.different_first_page_header_footer = False
        footer = section.footer
        footer.is_linked_to_previous = False
        paragraphs = footer.paragraphs
        first = paragraphs[0] if paragraphs else footer.add_paragraph()
        first.text = ""
        first.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = first.add_run(T.LAWYER_REVIEW_FOOTER)
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


def _para(document: Any, text_value: str, style: str | None = None) -> Any:
    paragraph = document.add_paragraph(style=style)
    if text_value:
        paragraph.add_run(text_value)
    return paragraph


def _add_quote_block(document: Any, quote: str) -> None:
    """Write ``quote`` verbatim, one paragraph per line, in the quote style.

    Splitting on ``\\n`` here (rather than letting python-docx insert
    ``<w:br/>``) keeps the read-back join unambiguous, and tabs round-trip as
    ``<w:tab/>``. Carriage returns are rejected earlier by
    :mod:`export.verify`, because XML line-ending normalization would silently
    change them and break the hash.
    """
    for line in quote.split("\n"):
        _para(document, line, STYLE_QUOTE)


def _add_meta_table(document: Any, rows: Any) -> None:
    table = document.add_table(rows=0, cols=2)
    table.style = "Table Grid"
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].text = label
        cells[1].text = value


def _add_confidence_table(document: Any, bundle: EvidenceBundle) -> None:
    header = ["Sonuç", "Karar", *[label for _, label in CONFIDENCE_DIMENSIONS]]
    table = document.add_table(rows=1, cols=len(header))
    table.style = "Table Grid"
    for cell, label in zip(table.rows[0].cells, header):
        cell.text = label
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.bold = True
    for index, claim in enumerate(bundle.claims, start=1):
        values = claim.confidence.as_dict()
        cells = table.add_row().cells
        cells[0].text = f"{index}. Sonuç"
        cells[1].text = T.VERDICT_TR[claim.verdict]
        for offset, (key, _) in enumerate(CONFIDENCE_DIMENSIONS, start=2):
            cells[offset].text = T.pct(values[key])
    _para(document, T.CONFIDENCE_NOTE, STYLE_WARNING)
    _para(document, "Sütunların anlamı:", STYLE_FIELD)
    for label, meaning in CONFIDENCE_LEGEND:
        _para(document, f"{label}: {meaning}", STYLE_FIELD)


def _add_source_entry(document: Any, number: int, entry: EvidenceEntry) -> None:
    _para(document, f"[{number}] {entry.title}", STYLE_SOURCE_HEADING)

    def field_line(label: str, value: str) -> None:
        _para(document, f"{label}: {value}", STYLE_FIELD)

    if entry.court:
        field_line("Mahkeme/Daire", entry.court)
    ek: list[str] = []
    if entry.docket_no:
        ek.append(f"E. {entry.docket_no}")
    if entry.decision_no:
        ek.append(f"K. {entry.decision_no}")
    if ek:
        field_line("Esas/Karar", ", ".join(ek))
    if entry.decision_date:
        field_line("Tarih", T.human_date(entry.decision_date))
    if entry.legislation_no:
        field_line("Mevzuat No", entry.legislation_no)
    if entry.locator.article:
        field_line("Madde", f"m. {entry.locator.article}")
    if entry.locator.paragraph:
        field_line("Fıkra/Bent", entry.locator.paragraph)
    if entry.locator.page is not None:
        field_line("Sayfa", str(entry.locator.page))
    if entry.authority_label:
        tier = "" if entry.authority_tier is None else f" (kademe {entry.authority_tier})"
        field_line("Otorite", f"{entry.authority_label}{tier}")
    if entry.currentness_status:
        field_line(
            "Güncellik",
            T.CURRENTNESS_TR.get(entry.currentness_status, entry.currentness_status),
        )
    field_line("Sonuç yönü", T.SONUC_YONU_TR.get(entry.stance, entry.stance))
    if entry.synthetic:
        _para(
            document,
            f"{T.SYNTHETIC_FOOTER_TAG} — bu kaynak gerçek değildir; programı"
            " denemek için üretilmiş bir örnek metindir.",
            STYLE_WARNING,
        )

    _para(document, "Alıntı (birebir):", STYLE_FIELD)
    _add_quote_block(document, entry.quote)

    field_line("Alıntının parmak izi (SHA-256)", entry.quote_sha256)
    field_line("Belgenin parmak izi (SHA-256)", entry.content_sha256)
    # W15: bu belge "Kanıt Paketi"dir — dilekçe değil, DENETİM belgesidir. Bir
    # önceki tur nüsha numarasını buradan silmişti; onsuz okuyucu "aynı tarihli
    # metin"den fazlasını eşleştiremez ve alıntının HANGİ nüshadan alındığını
    # bir daha bulamaz. Türkçe etiketle geri kondu.
    field_line("Kaynağın bu nüshasının numarası", entry.document_version_id)
    field_line(
        "Alıntının kaynak metindeki yeri",
        f"{entry.locator.start_char}–{entry.locator.end_char}",
    )
    field_line("Kaynak", entry.source)
    field_line("Kaynak URL", T.safe_url(entry.source_url))
    field_line("Alınma zamanı", T.human_timestamp(entry.retrieved_at))


def build_document(
    bundle: EvidenceBundle,
    plan: CitationPlan,
    report: VerificationReport,
    *,
    generated_at: str,
    system_version: str,
) -> Any:
    """Build the in-memory ``Document``. No I/O, no verification side effects."""
    document = Document()
    _register_styles(document)
    _build_footer(document, synthetic=bundle.synthetic)

    document.add_heading(T.TITLE, level=0)

    banner = T.synthetic_notice(bundle)
    if banner:
        _para(document, banner, STYLE_WARNING)
    _para(document, T.LAWYER_REVIEW_FOOTER, STYLE_WARNING)

    # ---- künye ------------------------------------------------------------
    document.add_heading(T.H_META, level=1)
    _add_meta_table(
        document,
        meta_rows(
            bundle,
            plan,
            generated_at=generated_at,
            integrity_summary=report.summary(),
        ),
    )
    # Ham enum'lar, ISO damgalar ve pipeline kimliği ayrı alt tabloda kalır:
    # avukat künyesi Türkçe, makine künyesi eksiksiz.
    document.add_heading(T.H_TECH_META, level=2)
    _add_meta_table(
        document,
        tech_rows(
            bundle,
            generated_at=generated_at,
            system_version=system_version,
        ),
    )
    _para(document, "")
    _para(document, T.LAWYER_REVIEW_NOTICE)
    if report.warnings:
        _para(document, "Doğrulama uyarıları:", STYLE_FIELD)
        for warning in report.warnings:
            _para(document, str(warning), STYLE_FIELD)

    # ---- answer body ------------------------------------------------------
    document.add_heading(T.H_BODY, level=1)
    if bundle.is_abstention:
        _para(document, T.ABSTENTION_TEXT, STYLE_CLAIM)
    elif not bundle.claims:
        _para(document, "(Bu belgede sonuç yok.)", STYLE_CLAIM)
    else:
        for index, claim in enumerate(bundle.claims, start=1):
            document.add_heading(
                f"{index}. Sonuç — {T.VERDICT_TR[claim.verdict]}",
                level=2,
            )
            _para(document, claim.text, STYLE_CLAIM)
            supporting = plan.supporting_markers(claim)
            _para(
                document,
                "Atıflar: " + (supporting if supporting else "(doğrulanmış atıf yok)"),
                STYLE_CITATION,
            )
            contrary = plan.contrary_markers(claim)
            if contrary:
                _para(document, f"Karşıt kaynaklar: {contrary}", STYLE_CITATION)
            _para(
                document,
                f"Nitelik: {T.TREATMENT_TR.get(claim.treatment, claim.treatment)}"
                f" | esasa etkili: {'evet' if claim.material else 'hayır'}",
                STYLE_FIELD,
            )
            if claim.verdict == "INSUFFICIENT_EVIDENCE":
                _para(
                    document,
                    "Bu sonuç kaynak denetiminden geçemedi ve KAYNAKSIZ"
                    " kabul edilir; karara dayanak yapılmamalıdır.",
                    STYLE_WARNING,
                )
            for reason in claim.reasons:
                _para(document, f"Gerekçe: {reason}", STYLE_FIELD)

    # ---- confidence -------------------------------------------------------
    document.add_heading(T.H_CONFIDENCE, level=1)
    if bundle.claims:
        _add_confidence_table(document, bundle)
    else:
        _para(document, "(Sonuç yok.)")

    # ---- conflicting authorities -----------------------------------------
    document.add_heading(T.H_CONFLICT, level=1)
    conflicted = [
        c
        for c in bundle.claims
        if c.verdict == "CONFLICTING_AUTHORITIES" or c.contrary_evidence_ids
    ]
    if conflicted and not bundle.is_abstention:
        _para(
            document,
            "Aşağıdaki sonuçlarda kaynaklar arasında çelişki var; iki taraf da"
            " gizlenmeden sunulmaktadır:",
        )
        for claim in conflicted:
            supporting = plan.supporting_markers(claim) or "(yok)"
            contrary = plan.contrary_markers(claim) or "(yok)"
            _para(
                document,
                f"{claim.claim_id}: destekleyen {supporting} — karşıt {contrary}",
                STYLE_CITATION,
            )
    else:
        _para(document, "Kaynaklar arasında çelişki bulunamadı.")

    # ---- abstention -------------------------------------------------------
    document.add_heading(T.H_ABSTAIN, level=1)
    if bundle.is_abstention:
        _para(document, T.ABSTENTION_TEXT)
        _para(document, T.NO_CITATION_IN_ABSTENTION, STYLE_WARNING)
        _para(
            document,
            "Değerlendirilen ancak yayımlanmayan kaynak sayısı:"
            f" {len(bundle.evidence)}.",
            STYLE_FIELD,
        )
    else:
        abstained = [c for c in bundle.claims if c.is_abstained]
        if abstained:
            _para(
                document,
                "Aşağıdaki sonuçlar için yeterli doğrulanabilir kaynak yoktur;"
                " kaynaksız kabul edilir ve karara dayanak yapılamaz:",
            )
            for claim in abstained:
                _para(
                    document,
                    f"{claim.claim_id} — {T.VERDICT_TR[claim.verdict]}",
                    STYLE_FIELD,
                )
        else:
            _para(document, "Dayanak bulunamayan sonuç yok.")

    # ---- machine reasons --------------------------------------------------
    if bundle.reasons:
        document.add_heading(T.H_REASONS, level=1)
        for reason in bundle.reasons:
            _para(document, reason, STYLE_FIELD)

    # ---- sources ----------------------------------------------------------
    document.add_heading(T.H_SOURCES, level=1)
    if plan.entries:
        for number, entry in plan.entries:
            _add_source_entry(document, number, entry)
    else:
        _para(document, "Bu belgede numaralandırılmış kaynak YOKTUR (0 atıf).")
        _para(document, T.NO_CITATION_IN_ABSTENTION, STYLE_WARNING)
    if plan.uncited:
        _para(
            document,
            "Değerlendirilen ancak hiçbir sonuçta atıf yapılmayan"
            f" {len(plan.uncited)} kaynak vardır; bunlar bilerek"
            " numaralandırılmamıştır.",
            STYLE_FIELD,
        )

    # ---- verification -----------------------------------------------------
    document.add_heading(T.H_VERIFY, level=1)
    _para(document, T.VERIFY_INTRO)
    for step_no, step in enumerate(T.VERIFY_STEPS, start=1):
        _para(document, f"{step_no}. {step}")
    _para(document, T.VERIFY_SELF_CHECK)
    _para(document, T.UDF_NOTICE, STYLE_WARNING)
    _para(document, T.LAWYER_REVIEW_FOOTER, STYLE_WARNING)
    if banner:
        _para(document, banner, STYLE_WARNING)
    return document


def _self_check(path: Path, bundle: EvidenceBundle, plan: CitationPlan) -> None:
    """Re-open the written file and prove it says what the plan promised."""
    produced = read_docx_report(path)

    assert_citation_closure(
        produced.body_numbers,
        produced.appendix_numbers,
        expected=plan.numbered_ids,
        where="DOCX çıktısı",
    )

    duplicates = [
        n for n in set(produced.appendix_numbers)
        if produced.appendix_numbers.count(n) > 1
    ]
    if duplicates:
        raise ExportRefused(
            "DOCX çıktısı: aynı atıf numarası birden çok KAYNAKLAR girişinde",
            [f"ATIF_BUTUNLUGU: tekrar eden numara {sorted(duplicates)}"],
        )

    failures: list[str] = []
    for number, entry in plan.entries:
        written = produced.quotes.get(number)
        if written is None:
            failures.append(f"[{number}] için alıntı bloğu yazılmamış")
        elif written != entry.quote:
            failures.append(
                f"[{number}] alıntısı belgede değişmiş"
                f" (kanıt {entry.evidence_id}); dosya birebir değil"
            )
    if failures:
        raise ExportRefused(
            "DOCX çıktısı: alıntılar kanıt paketiyle birebir aynı değil",
            [f"ALINTI_BUTUNLUGU: {f}" for f in failures],
        )

    if not any(T.LAWYER_REVIEW_FOOTER in footer for footer in produced.footer_texts):
        raise ExportRefused(
            "DOCX çıktısı: zorunlu 'avukat incelemesi' altbilgisi yazılamadı"
        )
    for heading in (T.H_SOURCES, T.H_VERIFY, T.H_CONFLICT, T.H_ABSTAIN):
        if not produced.has_section(heading):
            raise ExportRefused(f"DOCX çıktısı: zorunlu bölüm eksik — {heading}")
    if bundle.synthetic and T.SYNTHETIC_FOOTER_TAG not in "\n".join(
        (*produced.footer_texts, produced.full_text)
    ):
        raise ExportRefused(
            "DOCX çıktısı: sentetik paket SENTETİK olarak etiketlenmemiş"
        )


def export_docx(
    bundle: EvidenceBundle,
    out_path: str | Path,
    *,
    generated_at: str | None = None,
    system_version: str | None = None,
) -> ExportResult:
    """Verify, build, write-to-temp, re-open, self-check, then publish.

    The file only ever appears at ``out_path`` after it has been re-parsed and
    proven to carry exactly the planned citations with byte-identical quotes.
    Any failure raises :class:`export.errors.ExportRefused` and removes the
    temporary file, so a rejected export leaves nothing behind.
    """
    from export import REPORT_FORMAT, __version__

    report = verify_bundle_or_refuse(bundle)
    plan = build_citation_plan(bundle)
    # Local time with explicit offset: the human künye shows GG.AA.YYYY HH:MM
    # "(yerel saat)", the Teknik künye keeps the full ISO stamp.
    stamp = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    version = system_version or f"ColleX export {__version__} ({REPORT_FORMAT})"

    document = build_document(
        bundle, plan, report, generated_at=stamp, system_version=version
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
        _self_check(tmp_path, bundle, plan)
        os.replace(tmp_path, target)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    return ExportResult(
        path=target,
        format=FORMAT_NAME,
        citation_count=len(plan.entries),
        uncited_count=len(plan.uncited),
        verification=report,
        synthetic=bundle.synthetic,
    )
