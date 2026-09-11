"""Atıf Denetim Raporu → DOCX (``collex.citation-audit/v1``) — W14 · B-13.

The report a lawyer keeps in the file to show, six months later, that the
citations were checked before the petition was filed: one row per citation
with three columns that matter — **bulundu / bulunamadı / belirsiz**, the
currency **as of the petition's date**, and who reviewed it, when, with what
note (B-36).

Three rules this writer enforces and the self-check proves on the artifact:

1. **An unresolved citation renders an EMPTY künye cell.** Never a guess,
   never a reconstructed reference. The producer already refuses to
   synthesize one; this writer refuses to print anything in its place.
2. **"bulunamadı" and "belirsiz" are different columns of meaning** and the
   legend says so verbatim: the first is our positive finding that the
   authority is not in the sources we search (the hallucination signal); the
   second is a statement about OUR coverage.
3. **The currency verdict is dated.** The header prints "Yürürlük durumu
   GG.AA.YYYY tarihine göre" — a 2019 petition citing a provision repealed in
   2021 was correct when it was written.

Requires ``python-docx`` (the ``export`` extra), like the other DOCX writers.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt, RGBColor

from export import text as T
from export.errors import ExportError, ExportRefused

AUDIT_SCHEMA = "collex.citation-audit/v1"
FORMAT_NAME = "denetim-docx"

#: A4, same geometry contract as the petition writer (B-02).
A4_WIDTH_CM = 21.0
A4_HEIGHT_CM = 29.7
MARGIN_CM = 2.0

TITLE = "ATIF DENETİM RAPORU"

REVIEW_BANNER = "Bu rapor makine üretimidir; her satırı avukat incelemesi gerektirir."

#: The empty-cell rule, printed where a reader can see it.
EMPTY_CELL_NOTE = (
    "Çözümlenemeyen atıfın künye hücresi BOŞ bırakılmıştır; sistem künye uydurmaz."
)

#: Bucket legend — the two negative buckets do NOT mean the same thing.
BUCKET_LEGEND: tuple[tuple[str, str], ...] = (
    ("bulundu", "Kaynak bulundu ve künyesi doğrulandı."),
    (
        "bulunamadı",
        "Bu atıf, taradığımız kaynaklarda bulunamadı. Uydurulmuş bir künye"
        " olabilir; kaynağı elle teyit edin.",
    ),
    (
        "belirsiz",
        "Karar verilemedi: atıf kapsamımızın dışında, kaynağa erişilemedi ya da"
        " referans çözümlenemeyecek kadar eksik. Bu, kaynağın YOKLUĞU anlamına"
        " gelmez.",
    ),
)

#: B-36's honesty boundary, verbatim.
REVIEW_RECORD_DISCLAIMER = (
    "Bu rapor bir doğrulama değildir: sistem doğrulamaz, avukatın doğruladığını"
    " kaydeder."
)

VERIFICATION_INCOMPLETE_LINE = (
    "Doğrulama tamamlanmadı: bu belgedeki kaynaklar, KAYNAKSIZ paragraflar ve"
    " karşı içtihat avukat tarafından tek tek onaylanmadan dışa aktarıldı."
)

STYLE_TITLE = "CollexDenetimBaslik"
STYLE_WARNING = "CollexDenetimUyari"
STYLE_FIELD = "CollexDenetimAlan"
STYLE_LEGEND = "CollexDenetimSozluk"

_TABLE_HEADERS = (
    "Atıf",
    "Durum",
    "Künye",
    "Yürürlük",
    "Alıntı",
    "Aleyhe kayıt",
    "İnceleyen / tarih / not",
)

_ISO_DATE = re.compile(r"\A(\d{4})-(\d{2})-(\d{2})\Z")


class AuditFormatError(ExportError):
    """The input JSON is not a valid ``collex.citation-audit/v1`` report."""


@dataclass(frozen=True)
class AuditRow:
    raw: str
    count: int
    bucket_label: str
    kunye: str
    currency_label: str
    quote_label: str
    contrary: tuple[str, ...]
    reason: str
    review: str


@dataclass(frozen=True)
class AuditReport:
    as_of: str
    document_title: str
    generated_at: str
    rows: tuple[AuditRow, ...]
    totals: dict[str, int]
    review_complete: bool
    notices: tuple[str, ...]


def _require(payload: Any, key: str, *, where: str) -> Any:
    if key not in payload:
        raise AuditFormatError(f"{where}: '{key}' alanı eksik")
    return payload[key]


def _text(value: Any, *, where: str, key: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise AuditFormatError(f"{where}: '{key}' metin değil")
    return value


def parse_audit(payload: Any) -> AuditReport:
    """Strictly parse a ``collex.citation-audit/v1`` object."""
    if not isinstance(payload, dict):
        raise AuditFormatError("rapor bir JSON nesnesi değil")
    schema = payload.get("schema", AUDIT_SCHEMA)
    if schema != AUDIT_SCHEMA:
        raise AuditFormatError(f"desteklenmeyen şema: {schema!r} (beklenen {AUDIT_SCHEMA})")
    as_of = _text(_require(payload, "asOf", where="rapor"), where="rapor", key="asOf")
    if _ISO_DATE.match(as_of) is None:
        raise AuditFormatError("rapor: 'asOf' YYYY-AA-GG biçiminde olmalı")

    rows_raw = payload.get("rows")
    if not isinstance(rows_raw, list):
        raise AuditFormatError("rapor: 'rows' listesi eksik")
    rows: list[AuditRow] = []
    for index, row in enumerate(rows_raw):
        if not isinstance(row, dict):
            raise AuditFormatError(f"rows[{index}] bir nesne değil")
        where = f"rows[{index}]"
        review = row.get("review") or {}
        if not isinstance(review, dict):
            raise AuditFormatError(f"{where}: 'review' nesne değil")
        contrary_raw = row.get("contrary") or []
        if not isinstance(contrary_raw, list):
            raise AuditFormatError(f"{where}: 'contrary' liste değil")
        contrary: list[str] = []
        for item in contrary_raw:
            if not isinstance(item, dict):
                raise AuditFormatError(f"{where}: 'contrary' girdisi nesne değil")
            kunye = _text(item.get("kunye"), where=where, key="contrary.kunye")
            note = _text(item.get("note"), where=where, key="contrary.note")
            contrary.append(f"{kunye} — {note}" if note else kunye)
        count = row.get("count", 0)
        if not isinstance(count, int) or count < 0:
            raise AuditFormatError(f"{where}: 'count' geçersiz")
        rows.append(
            AuditRow(
                raw=_text(_require(row, "raw", where=where), where=where, key="raw"),
                count=count,
                bucket_label=_text(row.get("bucketLabel"), where=where, key="bucketLabel"),
                # THE RULE: whatever the producer left empty stays empty here.
                kunye=_text(row.get("kunye"), where=where, key="kunye"),
                currency_label=_text(row.get("currencyLabel"), where=where, key="currencyLabel"),
                quote_label=_text(row.get("quoteVerifiedLabel"), where=where, key="quoteVerifiedLabel"),
                contrary=tuple(contrary),
                reason=_text(row.get("reason"), where=where, key="reason"),
                review=_review_cell(review, where=where),
            )
        )

    totals_raw = payload.get("totals") or {}
    if not isinstance(totals_raw, dict):
        raise AuditFormatError("rapor: 'totals' nesne değil")
    totals = {str(k): int(v) for k, v in totals_raw.items() if isinstance(v, int)}

    notices_raw = payload.get("notices") or []
    if not isinstance(notices_raw, list) or not all(isinstance(n, str) for n in notices_raw):
        raise AuditFormatError("rapor: 'notices' geçersiz")

    return AuditReport(
        as_of=as_of,
        document_title=_text(payload.get("documentTitle"), where="rapor", key="documentTitle"),
        generated_at=_text(payload.get("generatedAt"), where="rapor", key="generatedAt"),
        rows=tuple(rows),
        totals=totals,
        review_complete=bool(payload.get("reviewComplete", False)),
        notices=tuple(notices_raw),
    )


def _review_cell(review: dict[str, Any], *, where: str) -> str:
    if review.get("reviewed") is not True:
        return "incelenmedi"
    by = _text(review.get("by"), where=where, key="review.by")
    at = _text(review.get("at"), where=where, key="review.at")
    note = _text(review.get("note"), where=where, key="review.note")
    parts = [by or "(ad kaydedilmemiş)"]
    if at:
        parts.append(T.human_timestamp(at))
    if note:
        parts.append(note)
    return " · ".join(parts)


def load_audit(path: str | Path) -> AuditReport:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise AuditFormatError(f"rapor dosyası okunamadı: {exc}") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AuditFormatError(f"rapor JSON değil: {exc}") from exc
    return parse_audit(payload)


# --------------------------------------------------------------------------
# Document construction
# --------------------------------------------------------------------------


def _ensure_style(document: Any, name: str, base: str) -> Any:
    for existing in document.styles:
        if existing.name == name:
            return existing
    style = document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = document.styles[base]
    return style


def _register(document: Any) -> None:
    normal = document.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(11)

    title = _ensure_style(document, STYLE_TITLE, "Normal")
    title.font.bold = True
    title.font.size = Pt(16)

    warning = _ensure_style(document, STYLE_WARNING, "Normal")
    warning.font.bold = True
    warning.font.color.rgb = RGBColor(0xB0, 0x00, 0x00)

    field = _ensure_style(document, STYLE_FIELD, "Normal")
    field.font.size = Pt(10)
    field.paragraph_format.space_after = Pt(2)

    legend = _ensure_style(document, STYLE_LEGEND, "Normal")
    legend.font.size = Pt(9)
    legend.paragraph_format.space_after = Pt(2)


def _para(document: Any, value: str, style: str | None = None, *, bold: bool = False) -> Any:
    paragraph = document.add_paragraph(style=style)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    if value:
        run = paragraph.add_run(value)
        if bold or style in (STYLE_TITLE, STYLE_WARNING):
            run.bold = True
    return paragraph


def human_date(value: str) -> str:
    return T.human_date(value)


def build_audit_document(report: AuditReport, *, system_version: str) -> Any:
    document = Document()
    for section in document.sections:
        section.page_width = Cm(A4_WIDTH_CM)
        section.page_height = Cm(A4_HEIGHT_CM)
        section.top_margin = Cm(MARGIN_CM)
        section.bottom_margin = Cm(MARGIN_CM)
        section.left_margin = Cm(MARGIN_CM)
        section.right_margin = Cm(MARGIN_CM)
    _register(document)

    _para(document, REVIEW_BANNER, STYLE_WARNING)
    _para(document, TITLE, STYLE_TITLE)
    if report.document_title:
        _para(document, f"Belge: {report.document_title}", STYLE_FIELD)
    # The dated currency statement — never "as of today".
    _para(
        document,
        f"Yürürlük durumu {human_date(report.as_of)} tarihine göre değerlendirilmiştir.",
        STYLE_FIELD,
        bold=True,
    )
    if report.generated_at:
        _para(document, f"Rapor tarihi: {T.human_timestamp(report.generated_at)}", STYLE_FIELD)
    _para(
        document,
        "Özet: "
        + " · ".join(
            f"{label}: {report.totals.get(code, 0)}"
            for code, label in (("FOUND", "bulundu"), ("NOT_FOUND", "bulunamadı"), ("UNCERTAIN", "belirsiz"))
        ),
        STYLE_FIELD,
        bold=True,
    )
    if not report.review_complete:
        _para(document, VERIFICATION_INCOMPLETE_LINE, STYLE_WARNING)
    _para(document, REVIEW_RECORD_DISCLAIMER, STYLE_WARNING)

    # ---- the table --------------------------------------------------------
    table = document.add_table(rows=1, cols=len(_TABLE_HEADERS))
    table.style = "Table Grid"
    header = table.rows[0].cells
    for index, label in enumerate(_TABLE_HEADERS):
        header[index].text = label
        for paragraph in header[index].paragraphs:
            for run in paragraph.runs:
                run.bold = True

    for row in report.rows:
        cells = table.add_row().cells
        cells[0].text = row.raw if row.count <= 1 else f"{row.raw} ({row.count}×)"
        cells[1].text = row.bucket_label
        # THE EMPTY-CELL RULE: nothing is invented in this cell.
        cells[2].text = row.kunye
        cells[3].text = row.currency_label
        cells[4].text = row.quote_label
        cells[5].text = "\n".join(row.contrary)
        cells[6].text = row.review
        if row.reason:
            note = cells[1].add_paragraph()
            note_run = note.add_run(row.reason)
            note_run.font.size = Pt(8)

    # ---- legend + notices --------------------------------------------------
    _para(document, "")
    _para(document, "Durum sözlüğü", STYLE_FIELD, bold=True)
    for label, meaning in BUCKET_LEGEND:
        _para(document, f"{label}: {meaning}", STYLE_LEGEND)
    _para(document, EMPTY_CELL_NOTE, STYLE_LEGEND)
    for notice in report.notices:
        _para(document, notice, STYLE_LEGEND)
    _para(document, f"Üretim: {system_version}", STYLE_LEGEND)
    _para(document, REVIEW_BANNER, STYLE_WARNING)
    return document


# --------------------------------------------------------------------------
# Read-back + self-check
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class AuditDocxReport:
    paragraph_texts: tuple[str, ...]
    table_rows: tuple[tuple[str, ...], ...]
    full_text: str


def read_audit_report(path: str | Path) -> AuditDocxReport:
    document = Document(str(path))
    texts = [p.text for p in document.paragraphs]
    rows: list[tuple[str, ...]] = []
    for table in document.tables:
        for row in table.rows:
            rows.append(tuple(cell.text for cell in row.cells))
    return AuditDocxReport(
        paragraph_texts=tuple(texts),
        table_rows=tuple(rows),
        full_text="\n".join([*texts, *(" | ".join(r) for r in rows)]),
    )


def _self_check(path: Path, report: AuditReport) -> None:
    produced = read_audit_report(path)
    failures: list[str] = []

    if not produced.paragraph_texts or produced.paragraph_texts[0] != REVIEW_BANNER:
        failures.append("ZORUNLU_UYARI: inceleme bandı ilk paragraf değil")
    if human_date(report.as_of) not in produced.full_text:
        failures.append("ASOF_TARIHI: yürürlük tarihi belgede yok")
    if len(produced.table_rows) != len(report.rows) + 1:
        failures.append(
            f"SATIR_SAYISI: tabloda {len(produced.table_rows) - 1} satır var,"
            f" raporda {len(report.rows)}"
        )
    else:
        for row, written in zip(report.rows, produced.table_rows[1:]):
            # The künye cell is EMPTY exactly when the producer left it empty.
            if written[2].strip() != row.kunye.strip():
                failures.append("KUNYE_HUCRESI: künye hücresi rapordakiyle birebir değil")
                break
            if row.kunye.strip() == "" and written[2].strip() != "":
                failures.append("KUNYE_HUCRESI: çözümlenemeyen atıf için künye yazılmış")
                break
    for label, _meaning in BUCKET_LEGEND:
        if label not in produced.full_text:
            failures.append(f"SOZLUK: '{label}' durum sözlüğü belgede yok")
    if EMPTY_CELL_NOTE not in produced.paragraph_texts:
        failures.append("SOZLUK: boş künye kuralı belgede yazılı değil")
    if REVIEW_RECORD_DISCLAIMER not in produced.paragraph_texts:
        failures.append("DOGRULAMA_KAYDI: dürüstlük cümlesi belgede yok")
    if not report.review_complete and VERIFICATION_INCOMPLETE_LINE not in produced.paragraph_texts:
        failures.append("DOGRULAMA_KAYDI: 'doğrulama tamamlanmadı' satırı belgede yok")

    if failures:
        raise ExportRefused("Denetim raporu kendisiyle doğrulanamadı", failures)


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class AuditExportResult:
    path: Path
    format: str
    row_count: int
    found: int
    not_found: int
    uncertain: int

    def summary(self) -> str:
        return " | ".join(
            [
                f"DENETIM-DOCX yazıldı: {self.path}",
                f"atıf: {self.row_count}",
                f"bulundu: {self.found}",
                f"bulunamadı: {self.not_found}",
                f"belirsiz: {self.uncertain}",
            ]
        )


def export_audit_docx(
    report: AuditReport,
    out_path: str | Path,
    *,
    system_version: str | None = None,
) -> AuditExportResult:
    """Build, write-to-temp, re-open, self-check, then publish."""
    from export import __version__

    version = system_version or f"ColleX export {__version__}"
    document = build_audit_document(report, system_version=version)

    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(
        prefix=f".{target.stem}-", suffix=".docx.tmp", dir=str(target.parent)
    )
    os.close(handle)
    tmp_path = Path(tmp_name)
    try:
        document.save(str(tmp_path))
        _self_check(tmp_path, report)
        os.replace(tmp_path, target)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    return AuditExportResult(
        path=target,
        format=FORMAT_NAME,
        row_count=len(report.rows),
        found=report.totals.get("FOUND", 0),
        not_found=report.totals.get("NOT_FOUND", 0),
        uncertain=report.totals.get("UNCERTAIN", 0),
    )
