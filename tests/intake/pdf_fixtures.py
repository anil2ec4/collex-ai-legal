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


#: A digital line a scanner or an e-signature tool adds on top of a scanned
#: image: long enough to pass the 50-character sparse gate, but it is NOT the
#: page body (W21 #25).
SIGNATURE_FOOTER = [
    "Bu belge 5070 sayılı Kanun uyarınca güvenli elektronik imza ile imzalanmıştır.",
    "Doğrulama kodu: AB12-CD34-EF56",
]

# One 1x1 grey pixel: the image CONTENT never matters here, only where and
# how large the content stream draws it.
_IMAGE_OBJ = (
    b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1"
    b" /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream"
)


def build_image_pdf(pages: list[dict]) -> bytes:
    """Pages that DRAW an image, the way a scan does (W21 #25 fixtures).

    Each page is a dict:
      ``lines``   text-layer lines (drawn after the image, like an overlay)
      ``image``   ``(width, height)`` in points, or None for no image
      ``how``     ``"xobject"`` (default), ``"form"`` (the image wrapped in a
                  Form XObject, as many scanners write it) or ``"inline"``
      ``tiles``   draw the image as this many equal horizontal strips that
                  together fill ``image`` (default 1; a scanner writing a
                  page as strips, W21 #25)
      ``image_ref`` the indirect reference the page's /XObject entry uses
                  (default ``"5 0 R"``; e.g. ``"99 0 R"`` for a DANGLING
                  reference to an object the file does not contain)
      ``indirect`` (``how="form"`` only, R2-35) write the form's /Matrix and
                  /Subtype as INDIRECT references to separate objects — spec
                  valid, and pypdf's ``.get()`` does not resolve them
    The page is A4 (595 x 842 points).
    """
    if not pages:
        raise ValueError("at least one page is required")
    diff = " ".join(["128"] + ["/" + g for g in _GLYPH_NAMES])
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 4 0 R >>",
        b"<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ["
        + diff.encode() + b"] >>",
        _IMAGE_OBJ,  # object 5
    ]
    kids: list[int] = []
    for spec in pages:
        lines = spec.get("lines") or []
        image = spec.get("image")
        how = spec.get("how", "xobject")
        tiles = int(spec.get("tiles", 1))
        image_ref = str(spec.get("image_ref", "5 0 R")).encode()
        stream = bytearray()
        xobjects = b""
        if image is not None and tiles > 1:
            width, height = image
            strip = height / tiles
            for n in range(tiles):
                stream += f"q {width} 0 0 {strip} 0 {n * strip} cm\n".encode() + b"/Im1 Do\nQ\n"
            xobjects = b" /XObject << /Im1 " + image_ref + b" >>"
        elif image is not None:
            width, height = image
            place = f"q {width} 0 0 {height} 0 0 cm\n".encode()
            if how == "inline":
                stream += place + b"BI /W 1 /H 1 /CS /G /BPC 8 ID \x80\nEI\nQ\n"
            elif how == "form":
                form = b"/Im1 Do\n"
                subtype, matrix = b"/Form", b""
                if spec.get("indirect"):
                    objects.append(b"[1 0 0 1 0 0]")
                    matrix = b" /Matrix " + str(len(objects)).encode() + b" 0 R"
                    objects.append(b"/Form")
                    subtype = str(len(objects)).encode() + b" 0 R"
                objects.append(
                    b"<< /Type /XObject /Subtype " + subtype + b" /BBox [0 0 1 1]" + matrix
                    + b" /Resources << /XObject << /Im1 5 0 R >> >> /Length "
                    + str(len(form)).encode() + b" >>\nstream\n" + form + b"endstream"
                )
                stream += place + b"/Fx1 Do\nQ\n"
                xobjects = b" /XObject << /Fx1 " + str(len(objects)).encode() + b" 0 R >>"
            else:
                stream += place + b"/Im1 Do\nQ\n"
                xobjects = b" /XObject << /Im1 " + image_ref + b" >>"
        if lines:
            stream += b"BT\n/F1 9 Tf\n12 TL\n40 40 Td\n"
            for line in lines:
                stream += b"(" + _encode_pdf_text(line) + b") Tj\nT*\n"
            stream += b"ET\n"
        objects.append(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
            + bytes(stream) + b"endstream"
        )
        content_no = len(objects)
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]"
            b" /Resources << /Font << /F1 3 0 R >>" + xobjects + b" >> /Contents "
            + str(content_no).encode() + b" 0 R >>"
        )
        kids.append(len(objects))
    objects[1] = (
        b"<< /Type /Pages /Kids ["
        + b" ".join(f"{k} 0 R".encode() for k in kids)
        + b"] /Count " + str(len(kids)).encode() + b" >>"
    )
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


def scanned_page(**extra) -> dict:
    """A full-page scan carrying only the e-signature footer as text."""
    return {"lines": list(SIGNATURE_FOOTER), "image": (595, 842), **extra}
