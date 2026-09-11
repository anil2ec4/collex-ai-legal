"""Multi-page synthetic PDF builder for the intake page-statistics tests.

Same hand-authored PDF grammar as ``evals/fixtures/uploads/_generate.py``
(Helvetica + WinAnsi with a /Differences array for Turkish glyphs), but
with N pages, each of which may carry a text layer or be EMPTY (an image
scan without OCR looks exactly like an empty content stream to pypdf).
"""

from __future__ import annotations

_TURKISH_DIFF = {
    "ş": 128, "ğ": 129, "ı": 130, "İ": 131, "Ş": 132, "Ğ": 133,
}
_GLYPH_NAMES = ["scedilla", "gbreve", "dotlessi", "Idotaccent",
                "Scedilla", "Gbreve"]


def _encode_pdf_text(line: str) -> bytes:
    out = bytearray()
    for ch in line:
        if ch in _TURKISH_DIFF:
            out.append(_TURKISH_DIFF[ch])
            continue
        try:
            encoded = ch.encode("cp1252")
        except UnicodeEncodeError:
            encoded = b"?"
        for byte in encoded:
            if byte in (0x28, 0x29, 0x5C):  # ( ) \ need escaping
                out.append(0x5C)
            out.append(byte)
    return bytes(out)


def build_multipage_pdf(pages: list[list[str]]) -> bytes:
    """One page per entry; an empty list of lines = a page with no text
    layer. Returns valid PDF bytes (xref table included)."""
    if not pages:
        raise ValueError("at least one page is required")

    diff = " ".join(["128"] + ["/" + g for g in _GLYPH_NAMES])
    font_obj = (b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica"
                b" /Encoding %d 0 R >>")
    encoding_obj = (b"<< /Type /Encoding /BaseEncoding /WinAnsiEncoding"
                    b" /Differences [" + diff.encode() + b"] >>")

    # Object numbering: 1 catalog, 2 pages, 3 font, 4 encoding, then per
    # page: page object + content stream.
    objects: list[bytes] = [b"", b"", b"", b""]
    kids: list[int] = []
    for lines in pages:
        stream = bytearray()
        if lines:
            stream += b"BT\n/F1 11 Tf\n14 TL\n50 780 Td\n"
            for line in lines:
                stream += b"(" + _encode_pdf_text(line) + b") Tj\nT*\n"
            stream += b"ET\n"
        page_no = len(objects) + 1
        content_no = page_no + 1
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]"
            b" /Resources << /Font << /F1 3 0 R >> >> /Contents "
            + str(content_no).encode() + b" 0 R >>"
        )
        objects.append(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
            + bytes(stream) + b"endstream"
        )
        kids.append(page_no)

    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = (
        b"<< /Type /Pages /Kids [" +
        b" ".join(f"{k} 0 R".encode() for k in kids) +
        b"] /Count " + str(len(kids)).encode() + b" >>"
    )
    objects[2] = font_obj % 4
    objects[3] = encoding_obj

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n").encode()
    return bytes(out)


TEXT_PAGE = [
    "SENTETİK TEST BELGESİDİR — gerçek kişi, olay veya dosya içermez.",
    "Bu sayfa gerçek bir metin katmanı taşır; TCK m. 157 uyarınca",
    "dolandırıcılık suçu için 5237 sayılı Kanun uygulanır.",
]


def mixed_pdf(text_pages: int, empty_pages: int) -> bytes:
    """``text_pages`` pages with text followed by ``empty_pages`` blank ones."""
    return build_multipage_pdf(
        [list(TEXT_PAGE)] * text_pages + [[]] * empty_pages
    )
