"""UYAP UDF rendering of a ColleX draft (``collex.draft/v1``) — DENEYSEL.

A UDF file is a zip archive whose ``content.xml`` carries the document text
in one ``<content>`` CDATA block and a list of ``<elements>/<paragraph>``
entries addressing that text by offset. This writer produces that shape
from a draft's plain paragraphs and section headings (the SAME element
structure :func:`intake.extract.extract_udf` reads back, so a produced file
round-trips through the intake lane), with the mandatory review banner as
the first line and every KAYNAKSIZ paragraph loudly marked.

What this is NOT: a signed or UYAP-validated document. The format was
reverse-engineered from public UDF samples; the produced file must be opened
in the UYAP Doküman Editörü and checked by the lawyer before use —
``deneysel — UYAP Doküman Editörü'nde açarak doğrulayın`` is printed inside
the document and reported on every API/CLI surface. The system never signs,
never files to UYAP and never touches a PIN/token/private key.

Discipline is identical to the DOCX writer (:mod:`export.petition`):

1. The evidence closure is re-verified BEFORE a byte is written
   (:func:`export.draft.verify_draft_or_refuse`; CLI exit 2 on refusal).
2. The written zip is re-opened and parsed back: banner first, every
   paragraph line present, KAYNAKSIZ count exact, citation references in
   body order, and every paragraph element's offset span pointing at the
   line it claims — or the file is removed and the export refused.

Offsets: the UYAP editor is a Java application, so ``startOffset`` and
``length`` are UTF-16 code units (Java ``String`` indices), NOT Unicode code
points. Turkish text is entirely BMP so both agree; the writer nevertheless
computes UTF-16 units explicitly and the self-check slices in that domain.
This is a deliberate, documented exception to the repo's code-point offset
rule (ADR-003), which governs canonical-text hashes and citations — not a
foreign editor's file format.

Standard-library only (``zipfile`` + ``xml``); ``defusedxml`` is used for
the read-back when installed.
"""

from __future__ import annotations

import io
import os
import re
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from xml.sax.saxutils import escape as xml_escape

from export import text as T
from export.draft import (
    DEFAULT_EXPORT_MODE,
    DRAFT_REVIEW_BANNER,
    EK_DOGRULAMA_SECTION_ID,
    KARSI_ICTIHAT_SECTION_ID,
    KAYNAKSIZ_PREFIX,
    VERIFICATION_INCOMPLETE_LINE,
    Draft,
    DraftEvidence,
    ExportMode,
    citation_ref,
    expected_citations,
    paragraph_lines,
    refuse_unfilled_placeholders,
    verify_draft_or_refuse,
)
from export.errors import ExportRefused

FORMAT_NAME = "dilekce-udf"

#: Verbatim on every surface that mentions the udf format.
UDF_EXPERIMENTAL_NOTE = "deneysel — UYAP Doküman Editörü'nde açarak doğrulayın"

#: Second line of every produced UDF (after the review banner).
UDF_EXPERIMENTAL_LINE = (
    "Bu UDF dosyası deneyseldir ve imzasızdır; UYAP Doküman Editörü'nde"
    " açarak doğrulayın."
)

DRAFT_SYNTHETIC_BANNER = (
    "DENEME VERİSİ — Bu taslaktaki kaynaklar gerçek değildir; programı"
    " denemek için üretilmiş örnek metinlerdir, gerçek Türk mevzuatı veya"
    " mahkeme kararı değildir."
)

#: Same wording as export.petition (contract A on every surface).
KARSI_ICTIHAT_INTRO = (
    "⚠ Bu bölümdeki kararlar talebin AKSİ yönündedir; dilekçenin dayanağı"
    " değildir. Dilekçeye alınıp alınmayacağına ve nasıl karşılanacağına"
    " avukat karar verir."
)
KARSI_ICTIHAT_NOTE = (
    "⚠ Bu karar talebin aksi yönündedir; dilekçeye alınıp alınmayacağına"
    " avukat karar verir."
)
CONTRARY_CITATION_PREFIX = "Karşı içtihat"

#: UDF template version the public samples carry.
UDF_FORMAT_ID = "1.8"

#: Fixed zip timestamp — the same draft always produces the same bytes.
_ZIP_DATE = (2026, 1, 1, 0, 0, 0)

_CITATION_LINE = re.compile(r"\A(?:Dayanak|Karşı içtihat) \[([^\]\s]+)\]: ")
_K_REF = re.compile(r"\AK-(\d+)\Z")
_APPENDIX_HEAD = re.compile(r"\A\[K-(\d+)\] ")
_KIMLIK = re.compile(r"\ADenetim dosyasındaki kaydı: (\S+)\Z")
#: Characters XML 1.0 cannot carry at all (the TS guard strips them too).
_XML_ILLEGAL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


# --------------------------------------------------------------------------
# Line plan
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class UdfLine:
    """One paragraph of the produced document."""

    text: str
    #: banner | heading | body | kaynaksiz | note | citation | field | contrary
    kind: str

    @property
    def bold(self) -> bool:
        return self.kind in ("banner", "heading", "kaynaksiz", "contrary")

    @property
    def alignment(self) -> int:
        """UDF paragraph alignment: 0 left · 1 centre · 2 right · 3 justify.

        W14 · B-02 (W13-DAILYFLOW #3): every UDF paragraph used to be written
        with ``Alignment="0"``, so the three outputs had three different
        format fidelities. One format contract now: the court address is
        centred, the signature block right-aligned, body text justified.
        """
        if self.kind == "baslik":
            return 1
        if self.kind == "imza":
            return 2
        if self.kind in ("body", "kaynaksiz"):
            return 3
        return 0


def _utf16_len(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


#: Draft paragraph roles that get their own UDF alignment (B-02).
_ROLE_KINDS = {"baslik": "baslik", "imza": "imza"}


def build_udf_lines(
    draft: Draft,
    *,
    generated_at: str,
    system_version: str,
    mode: ExportMode = DEFAULT_EXPORT_MODE,
) -> list[UdfLine]:
    """The full line plan, in document order. Pure; no I/O."""
    lines: list[UdfLine] = [
        UdfLine(DRAFT_REVIEW_BANNER, "banner"),
        UdfLine(UDF_EXPERIMENTAL_LINE, "banner"),
    ]
    if draft.synthetic:
        banner = DRAFT_SYNTHETIC_BANNER
        if draft.synthetic_notice:
            banner = f"{banner} Taslak notu: {draft.synthetic_notice}"
        lines.append(UdfLine(banner, "banner"))
    if not draft.review_complete:
        lines.append(UdfLine(VERIFICATION_INCOMPLETE_LINE, "banner"))

    lines.append(UdfLine(f"{draft.title} ({mode.label})", "heading"))
    if mode.include_annex:
        meta = [
            f"Belge türü: {draft.title}",
            f"Sürüm: {draft.version}",
            f"Oluşturulma: {T.human_timestamp(draft.created_at)}",
        ]
        if draft.updated_at:
            meta.append(f"Son düzenleme: {T.human_timestamp(draft.updated_at)}")
        if draft.matter_id:
            meta.append(f"Dosya: {draft.matter_label}")
        meta.extend(
            [
                f"Belge üretim zamanı: {T.human_timestamp(generated_at)}",
                "Hukukî dayanağı doğrulanamayan paragraf:"
                f" {draft.unsupported_count} (belgede ⚠ KAYNAKSIZ diye"
                " işaretlidir; dayanağı avukat eklemelidir)",
                f"Bağlı kaynak: {len(draft.evidence)}",
                "İnceleme durumu: AVUKAT İNCELEMESİ ZORUNLU",
                f"Teknik künye: taslak kimliği: {draft.draft_id} · şablon:"
                f" {draft.template} ({draft.kind}) · oluşturulma (ISO):"
                f" {draft.created_at} · üretim (ISO): {generated_at} · sistem"
                f" sürümü: {system_version}",
            ]
        )
        lines.extend(UdfLine(item, "field") for item in meta)

        if draft.warnings:
            lines.append(UdfLine("Uyarılar", "heading"))
            lines.extend(UdfLine(w, "field") for w in draft.warnings)

    numbering = draft.numbering()
    by_id = draft.evidence_by_id()
    for section in draft.sections:
        if section.section_id == EK_DOGRULAMA_SECTION_ID and not mode.include_annex:
            continue
        contrary_section = section.section_id == KARSI_ICTIHAT_SECTION_ID
        if section.title:
            lines.append(UdfLine(section.title, "heading"))
        if contrary_section:
            lines.append(UdfLine(KARSI_ICTIHAT_INTRO, "contrary"))
        for paragraph in section.paragraphs:
            if not paragraph.supported and mode.show_marks:
                kind = "kaynaksiz"
            elif section.section_id == EK_DOGRULAMA_SECTION_ID:
                kind = "field"
            else:
                kind = _ROLE_KINDS.get(paragraph.role, "body")
            for line in paragraph_lines(paragraph, marks=mode.show_marks):
                lines.append(UdfLine(line, kind))
            if not paragraph.supported and paragraph.note and mode.show_marks:
                lines.append(UdfLine(f"Not: {paragraph.note}", "note"))
            elif contrary_section and paragraph.note:
                lines.append(UdfLine(f"⚠ {paragraph.note}", "contrary"))
            for evidence_id in paragraph.evidence_ids:
                entry = by_id[evidence_id]  # closure verified before building
                contrary = contrary_section or entry.is_contrary
                prefix = CONTRARY_CITATION_PREFIX if contrary else "Dayanak"
                ref = f" [{citation_ref(numbering[evidence_id])}]" if mode.include_annex else ""
                lines.append(UdfLine(f"{prefix}{ref}: {entry.label}", "citation"))
                if contrary:
                    lines.append(UdfLine(KARSI_ICTIHAT_NOTE, "contrary"))

    if not mode.include_annex:
        return lines

    lines.append(UdfLine("DAYANAK KAYNAKLARI", "heading"))
    if draft.evidence:
        for index, entry in enumerate(draft.evidence, start=1):
            lines.extend(_appendix_lines(index, entry))
    else:
        lines.append(UdfLine("Bu taslağa bağlanmış doğrulanmış kaynak yoktur.", "field"))

    lines.append(UdfLine(T.UDF_FILE_NOTICE, "banner"))
    lines.append(UdfLine(UDF_EXPERIMENTAL_LINE, "banner"))
    lines.append(UdfLine(DRAFT_REVIEW_BANNER, "banner"))
    return lines


def _appendix_lines(index: int, entry: DraftEvidence) -> list[UdfLine]:
    out = [UdfLine(f"[{citation_ref(index)}] {entry.label}", "heading")]
    out.append(UdfLine(f"Kaynak: {T.source_label_tr(entry.source)}", "field"))
    if entry.direction:
        out.append(UdfLine(f"Yönü: {entry.direction}", "field"))
        if entry.is_contrary:
            out.append(UdfLine(KARSI_ICTIHAT_NOTE, "contrary"))
    if not entry.is_upload:
        out.append(UdfLine("Alıntı (birebir):", "field"))
        out.extend(UdfLine(line, "body") for line in entry.quote.split("\n"))
    # W15: görünen satır avukat Türkçesi, denetlenebilir değerler onun altında.
    # Bu ek dilekçeden çıkarılabilen denetim katmanıdır; belgeyi geri okuyan
    # kapanım denetimi [K-n] atıflarını kanıt kaydına yalnız bu satırdan bağlar.
    out.append(UdfLine("Alıntı denetimi: kaynağıyla birebir uyuştu", "field"))
    if not entry.is_upload:
        out.append(
            UdfLine(f"Alıntının parmak izi: {entry.quote_sha256} (Teknik adı: SHA-256)", "field")
        )
        out.append(UdfLine(f"Belgenin parmak izi: {entry.content_sha256}", "field"))
    out.append(UdfLine(f"Denetim dosyasındaki kaydı: {entry.evidence_id}", "field"))
    return out


# --------------------------------------------------------------------------
# content.xml
# --------------------------------------------------------------------------


def _cdata(text_value: str) -> str:
    # A literal "]]>" inside the text would terminate the CDATA section.
    return "<![CDATA[" + text_value.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def render_content_xml(lines: list[UdfLine]) -> str:
    """The ``content.xml`` document: CDATA text + paragraph elements."""
    text_parts: list[str] = []
    elements: list[str] = []
    offset = 0
    for line in lines:
        clean = _XML_ILLEGAL.sub("", line.text.replace("\n", " "))
        chunk = clean + "\n"
        length = _utf16_len(chunk)
        elements.append(
            f'<paragraph Alignment="{line.alignment}" LeftIndent="0.0" RightIndent="0.0"'
            ' LineSpacing="0.0" SpaceAbove="0.0" SpaceBelow="6.0">'
            f'<content startOffset="{offset}" length="{length}"'
            f' family="Times New Roman" size="12"'
            f' bold="{"true" if line.bold else "false"}"'
            f' description="{xml_escape(line.kind)}"/>'
            "</paragraph>"
        )
        text_parts.append(chunk)
        offset += length
    body = "".join(text_parts)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<template format_id="{UDF_FORMAT_ID}">\n'
        f"<content>{_cdata(body)}</content>\n"
        "<properties><pageFormat mediaSizeName=\"1\" leftMargin=\"70.86614\""
        " rightMargin=\"70.86614\" topMargin=\"56.692913\" bottomMargin=\"56.692913\""
        " paperOrientation=\"1\" headerFOffset=\"20.0\" footerFOffset=\"20.0\"/></properties>\n"
        '<elements resetPageCount="false">\n'
        + "\n".join(elements)
        + "\n</elements>\n</template>\n"
    )


def build_udf_bytes(lines: list[UdfLine]) -> bytes:
    """The zip archive (``content.xml`` only, deflated, fixed timestamp)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        info = zipfile.ZipInfo("content.xml", date_time=_ZIP_DATE)
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, render_content_xml(lines).encode("utf-8"))
    return buf.getvalue()


# --------------------------------------------------------------------------
# Read-back + self-check on the real artifact
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class UdfReport:
    """Machine view of a produced ``.udf``, parsed back from disk."""

    text: str
    lines: tuple[str, ...]
    #: (startOffset, length) per paragraph element, UTF-16 units.
    spans: tuple[tuple[int, int], ...]
    kaynaksiz_texts: tuple[str, ...]
    citation_refs: tuple[str, ...]
    citation_ids: tuple[str, ...]
    headings: tuple[str, ...]
    #: Additive (W14): the ``description`` of each paragraph element, in
    #: document order — the line kind the writer planned.
    kinds: tuple[str, ...] = ()
    #: Additive (W14): the ``Alignment`` of each paragraph element (B-02).
    alignments: tuple[int, ...] = ()


def _parse_xml(data: bytes) -> Any:
    try:
        from defusedxml import ElementTree as SafeET  # type: ignore[import-not-found]

        return SafeET.fromstring(data)
    except ImportError:  # pragma: no cover - depends on install
        from xml.etree import ElementTree as ET

        return ET.fromstring(data)


def read_udf_report(path: str | Path) -> UdfReport:
    with zipfile.ZipFile(str(path)) as zf:
        name = next(
            (n for n in zf.namelist() if PurePosixPath(n).name == "content.xml"), None
        )
        if name is None:
            raise ExportRefused("UDF okunamadı", ["UDF_ICERIK: content.xml yok"])
        root = _parse_xml(zf.read(name))

    def _local(tag: object) -> str:
        return str(tag).rsplit("}", 1)[-1].lower()

    content = next((el for el in list(root) if _local(el.tag) == "content"), None)
    text_value = "" if content is None else "".join(content.itertext())
    lines = tuple(text_value.split("\n"))

    spans: list[tuple[int, int]] = []
    kinds: list[str] = []
    alignments: list[int] = []
    for el in root.iter():
        if _local(el.tag) != "paragraph":
            continue
        for child in el:
            if _local(child.tag) == "content":
                spans.append((int(child.get("startOffset", "0")), int(child.get("length", "0"))))
                kinds.append(child.get("description", ""))
                alignments.append(int(el.get("Alignment", "0")))

    kaynaksiz: list[str] = []
    refs: list[str] = []
    headings: list[str] = []
    kmap: dict[int, str] = {}
    current_k: int | None = None
    for line, kind in zip(lines, kinds):
        if kind == "kaynaksiz" and line.startswith(KAYNAKSIZ_PREFIX):
            kaynaksiz.append(line)
        elif kind == "citation":
            match = _CITATION_LINE.match(line)
            if match is not None:
                refs.append(match.group(1))
        elif kind == "heading":
            headings.append(line)
            head = _APPENDIX_HEAD.match(line)
            current_k = int(head.group(1)) if head is not None else None
        elif kind == "field" and current_k is not None:
            kimlik = _KIMLIK.match(line)
            if kimlik is not None:
                kmap[current_k] = kimlik.group(1)

    ids: list[str] = []
    for ref in refs:
        k = _K_REF.match(ref)
        ids.append(kmap.get(int(k.group(1)), ref) if k is not None else ref)

    return UdfReport(
        text=text_value,
        lines=lines,
        spans=tuple(spans),
        kaynaksiz_texts=tuple(kaynaksiz),
        citation_refs=tuple(refs),
        citation_ids=tuple(ids),
        headings=tuple(headings),
        kinds=tuple(kinds),
        alignments=tuple(alignments),
    )


def _self_check(
    path: Path,
    draft: Draft,
    planned: list[UdfLine],
    mode: ExportMode = DEFAULT_EXPORT_MODE,
) -> None:
    """Re-open the written zip and prove it says what the draft promised."""
    produced = read_udf_report(path)
    failures: list[str] = []

    if not produced.lines or produced.lines[0] != DRAFT_REVIEW_BANNER:
        failures.append("ZORUNLU_UYARI: inceleme bandı ilk satır değil")
    if UDF_EXPERIMENTAL_LINE not in produced.lines:
        failures.append("DENEYSEL_NOTU: deneysel/imzasız notu belgede yok")
    if draft.synthetic and T.SYNTHETIC_FOOTER_TAG not in produced.text:
        failures.append("SENTETIK_ETIKETI: sentetik taslak SENTETİK olarak etiketlenmemiş")
    if not draft.review_complete and VERIFICATION_INCOMPLETE_LINE not in produced.lines:
        failures.append("DOGRULAMA_KAYDI: 'doğrulama tamamlanmadı' satırı belgede yok")

    written = set(produced.lines)
    expected_kaynaksiz = 0
    for section in draft.sections:
        if section.section_id == EK_DOGRULAMA_SECTION_ID and not mode.include_annex:
            continue
        for paragraph in section.paragraphs:
            if not paragraph.supported:
                expected_kaynaksiz += 1
            for line in paragraph_lines(paragraph, marks=mode.show_marks):
                if line and line.replace("\n", " ") not in written:
                    failures.append(
                        f"EKSIK_PARAGRAF: {paragraph.paragraph_id} paragrafının satırı belgede yok"
                    )
                    break

    expected_marked = expected_kaynaksiz if mode.show_marks else 0
    if len(produced.kaynaksiz_texts) != expected_marked:
        failures.append(
            "KAYNAKSIZ_ISARETI: KAYNAKSIZ paragraf sayısı belgede tutmuyor"
            f" (beklenen {expected_marked}, yazılan {len(produced.kaynaksiz_texts)})"
        )

    numbering = draft.numbering()
    if mode.include_annex:
        expected = expected_citations(draft)
        if list(produced.citation_ids) != expected:
            failures.append("ATIF_KAPANIMI: yazılan dayanak atıfları taslaktakiyle birebir değil")
        for ref in produced.citation_refs:
            if _K_REF.match(ref) is None:
                failures.append(f"ATIF_BICIMI: gövdede K-n olmayan atıf {ref}")
    else:
        expected_lines = [line.text for line in planned if line.kind == "citation"]
        produced_lines = [
            line for line, kind in zip(produced.lines, produced.kinds) if kind == "citation"
        ]
        if produced_lines != expected_lines:
            failures.append("ATIF_KAPANIMI: yazılan dayanak atıfları taslaktakiyle birebir değil")
        if any("[K-" in line for line in produced.lines):
            failures.append("NIHAI_TEMIZLIK: nihai kopyada makine atıf numarası ([K-n]) kaldı")
        if any(KAYNAKSIZ_PREFIX in line for line in produced.lines):
            failures.append("NIHAI_TEMIZLIK: nihai kopyada ekran işareti (KAYNAKSIZ) kaldı")
    if len(numbering) != len(draft.evidence):
        failures.append("KANIT_NUMARASI: kanıt numaralandırması tekil değil")

    # Every paragraph element must address exactly the line it claims.
    utf16 = produced.text.encode("utf-16-le")
    if len(produced.spans) != len(planned):
        failures.append(
            f"UDF_OGE: paragraf öğesi sayısı tutmuyor (planlanan {len(planned)}, yazılan {len(produced.spans)})"
        )
    else:
        for (start, length), line in zip(produced.spans, planned):
            sliced = utf16[start * 2 : (start + length) * 2].decode("utf-16-le", errors="replace")
            if sliced.rstrip("\n") != _XML_ILLEGAL.sub("", line.text.replace("\n", " ")):
                failures.append(f"UDF_OFFSET: {start}+{length} aralığı beklenen satırı göstermiyor")
                break

    if any(s.section_id == KARSI_ICTIHAT_SECTION_ID for s in draft.sections) and (
        KARSI_ICTIHAT_INTRO not in produced.lines
    ):
        failures.append("KARSI_ICTIHAT: karşı içtihat bölümünün uyarı girişi belgede yok")

    if failures:
        raise ExportRefused("UDF çıktısı taslağın kendisiyle doğrulanamadı", failures)


# --------------------------------------------------------------------------
# Public export entry point
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class UdfExportResult:
    path: Path
    format: str
    paragraph_count: int
    unsupported_count: int
    citation_count: int
    synthetic: bool
    experimental: bool = True
    #: Additive (W14 · B-02): "TASLAK" or "NİHAİ".
    mode_label: str = "TASLAK"

    def summary(self) -> str:
        parts = [
            f"DILEKCE-UDF yazıldı ({self.mode_label}; {UDF_EXPERIMENTAL_NOTE}): {self.path}",
            f"paragraf: {self.paragraph_count}",
            f"KAYNAKSIZ: {self.unsupported_count}",
            f"atıf: {self.citation_count}",
        ]
        if self.synthetic:
            parts.append(T.SYNTHETIC_FOOTER_TAG)
        return " | ".join(parts)


def export_udf(
    draft: Draft,
    out_path: str | Path,
    *,
    generated_at: str | None = None,
    system_version: str | None = None,
    mode: ExportMode = DEFAULT_EXPORT_MODE,
) -> UdfExportResult:
    """Verify, build, write-to-temp, re-open, self-check, then publish.

    Mirrors :func:`export.petition.export_petition_docx`: the file only ever
    appears at ``out_path`` after the draft's evidence closure verified AND
    the written zip was parsed back and proven to carry the banner, every
    paragraph, every KAYNAKSIZ marker, the planned citations and correct
    offsets. Any failure raises :class:`ExportRefused` (or an OSError) and
    removes the temporary file.
    """
    from export import __version__

    verify_draft_or_refuse(draft)
    # 27.09.2026: the NİHAİ copy may not carry an unfilled system placeholder
    # (an additional, filing-copy-only gate; the one above is unchanged).
    refuse_unfilled_placeholders(draft, mode)
    stamp = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    # W14 B-02 (DAILYFLOW #9): the evidence-bundle schema tag
    # (collex.export.evidence-report/v1) is NOT this document's schema and
    # has no business in a petition a court reads. Human line, human words.
    version = system_version or f"ColleX export {__version__}"

    lines = build_udf_lines(
        draft, generated_at=stamp, system_version=version, mode=mode
    )
    payload = build_udf_bytes(lines)

    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(
        prefix=f".{target.stem}-", suffix=".udf.tmp", dir=str(target.parent)
    )
    os.close(handle)
    tmp_path = Path(tmp_name)
    try:
        tmp_path.write_bytes(payload)
        _self_check(tmp_path, draft, lines, mode)
        os.replace(tmp_path, target)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    return UdfExportResult(
        path=target,
        format=FORMAT_NAME,
        paragraph_count=sum(len(section.paragraphs) for section in draft.sections),
        unsupported_count=draft.unsupported_count,
        citation_count=len(expected_citations(draft)),
        synthetic=draft.synthetic,
        mode_label=mode.label,
    )
