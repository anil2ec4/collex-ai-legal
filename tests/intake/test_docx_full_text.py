"""DOCX intake reads the document as the lawyer last saw it (27.09.2026).

Found by uploading a real-style dilekçe: python-docx's ``Paragraph.text``
drops runs inside ``w:ins`` (tracked insertions), ``iter_inner_content``
skips block-level content controls (``w:sdt``), footnotes and headers are
never opened, and ``row.cells`` repeats a merged cell. The searchable text
missed the lawyer's own edits, a Yargıtay künye in a dipnot and the
letterhead, and doubled an amount.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from intake import extract

docx = pytest.importorskip("docx")

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _base_docx() -> bytes:
    document = docx.Document()
    document.add_paragraph("İSTANBUL 5. İŞ MAHKEMESİ'NE")
    document.add_paragraph("PLACEHOLDER_TRACKED")
    table = document.add_table(rows=2, cols=3)
    table.cell(0, 0).text = "Kalem"
    table.cell(0, 1).text = "Tutar"
    merged = table.cell(1, 0).merge(table.cell(1, 1))
    merged.text = "487.350,25 TL kıdem"
    table.cell(1, 2).text = "brüt"
    document.add_paragraph("PLACEHOLDER_SDT")
    document.add_paragraph("PLACEHOLDER_FOOTNOTE_REF")
    section = document.sections[0]
    section.header.paragraphs[0].text = "Av. Mehmet Öztürk Hukuk Bürosu"
    section.footer.paragraphs[0].text = "Av. Mehmet Öztürk Hukuk Bürosu"  # same text: written once
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def _patch(data: bytes) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename == "word/document.xml":
                xml = body.decode("utf-8")
                xml = xml.replace(
                    "<w:p><w:r><w:t>PLACEHOLDER_TRACKED</w:t></w:r></w:p>",
                    "<w:p><w:r><w:t xml:space=\"preserve\">Fesih bildirimi </w:t></w:r>"
                    "<w:ins w:id=\"1\" w:author=\"Av\" w:date=\"2026-09-01T00:00:00Z\">"
                    "<w:r><w:t xml:space=\"preserve\">Beşiktaş 12. Noterliği'nin 03.10.2023 tarih ve 18876 yevmiye numaralı ihtarnamesiyle </w:t></w:r></w:ins>"
                    "<w:del w:id=\"2\" w:author=\"Av\" w:date=\"2026-09-01T00:00:00Z\">"
                    "<w:r><w:delText>SİLİNEN ESKİ METİN </w:delText></w:r></w:del>"
                    "<w:r><w:t>tebliğ edilmiştir.</w:t></w:r></w:p>",
                )
                xml = xml.replace(
                    "<w:p><w:r><w:t>PLACEHOLDER_SDT</w:t></w:r></w:p>",
                    "<w:sdt><w:sdtPr><w:alias w:val=\"Talep\"/></w:sdtPr><w:sdtContent>"
                    "<w:p><w:r><w:t>Giydirilmiş brüt ücret 61.200 TL'dir.</w:t></w:r></w:p>"
                    "</w:sdtContent></w:sdt>",
                )
                xml = xml.replace(
                    "<w:p><w:r><w:t>PLACEHOLDER_FOOTNOTE_REF</w:t></w:r></w:p>",
                    "<w:p><w:r><w:t>Emsal karar için bkz.</w:t></w:r>"
                    "<w:r><w:footnoteReference w:id=\"1\"/></w:r></w:p>",
                )
                assert "PLACEHOLDER" not in xml, "fixture patch did not apply"
                body = xml.encode("utf-8")
            elif item.filename == "[Content_Types].xml":
                body = body.replace(
                    b"</Types>",
                    b'<Override PartName="/word/footnotes.xml" ContentType="application/'
                    b'vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
                )
            elif item.filename == "word/_rels/document.xml.rels":
                body = body.replace(
                    b"</Relationships>",
                    b'<Relationship Id="rIdFn1" Type="http://schemas.openxmlformats.org/'
                    b'officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
                )
            dst.writestr(item, body)
        dst.writestr(
            "word/footnotes.xml",
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:footnotes xmlns:w="{W}">'
            f'<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
            f'<w:footnote w:id="1"><w:p><w:r><w:t>Yargıtay HGK 2019/9-123 E., 2021/456 K.</w:t></w:r></w:p></w:footnote>'
            f"</w:footnotes>",
        )
    return out.getvalue()


def test_docx_reads_insertions_content_controls_footnotes_and_headers_once():
    outcome = extract.extract_docx(_patch(_base_docx()))
    text = outcome.text
    # Tracked insertion: in. Tracked deletion: out.
    assert "18876 yevmiye numaralı ihtarnamesiyle tebliğ edilmiştir." in text
    assert "SİLİNEN ESKİ METİN" not in text
    assert extract.DOCX_TRACKED_CHANGES_WARNING in outcome.warnings
    # Block-level content control.
    assert "Giydirilmiş brüt ücret 61.200 TL'dir." in text
    # Footnote, with its own locator.
    assert "Yargıtay HGK 2019/9-123 E., 2021/456 K." in text
    labels = {(s.locator_kind, s.locator_label) for s in outcome.segments}
    assert ("block", "dipnot 1") in labels
    # Header/footer letterhead, written once.
    assert text.count("Av. Mehmet Öztürk Hukuk Bürosu") == 1
    # A merged cell is read once, not twice.
    assert text.count("487.350,25 TL kıdem") == 1


def test_a_plain_docx_gets_no_tracked_changes_warning():
    document = docx.Document()
    document.add_paragraph("Sade bir paragraf.")
    out = io.BytesIO()
    document.save(out)
    outcome = extract.extract_docx(out.getvalue())
    assert outcome.warnings == []
    assert "Sade bir paragraf." in outcome.text


def test_utf16_text_with_bom_is_accepted_and_decoded():
    from intake import quarantine

    raw = "DAVACI : Ayşe Yılmaz\nİstanbul 5. İş Mahkemesi'ne\n".encode("utf-16")
    verified = quarantine.verify_upload("tanik.txt", raw)
    assert verified.kind == "txt"
    outcome = extract.extract_txt(raw)
    assert "Ayşe Yılmaz" in outcome.text and "İş Mahkemesi" in outcome.text
    assert any("UTF-16" in w for w in outcome.warnings)
    # A binary blob with NULs and no BOM is still refused.
    with pytest.raises(Exception):
        quarantine.verify_upload("x.txt", b"ab\x00\x00cd")
