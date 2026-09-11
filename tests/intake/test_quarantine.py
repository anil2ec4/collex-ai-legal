"""Quarantine unit tests (no database needed).

Covers the brief 11.1 parser-safety gates: size cap, magic-byte/MIME
sniff with extension cross-check, and every ZIP safety rule (entry count,
per-entry/total uncompressed caps, compression ratio, path traversal,
encrypted entries, nested archives).
"""

from __future__ import annotations

import io
import zipfile

import pytest

from intake import quarantine
from intake.errors import InvalidRequestError, UnsupportedTypeError


def _zip_bytes(entries: dict[str, bytes], *, compress=zipfile.ZIP_DEFLATED,
               docx_shape: bool = True) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compress) as zf:
        if docx_shape:
            zf.writestr("[Content_Types].xml", b"<Types/>")
            zf.writestr("word/document.xml", b"<w:document/>")
        for name, data in entries.items():
            info = zipfile.ZipInfo(name)
            info.compress_type = compress
            zf.writestr(info, data)
    return buf.getvalue()


# --- size cap ---------------------------------------------------------------

def test_oversize_rejected(monkeypatch):
    monkeypatch.setattr(quarantine, "MAX_FILE_BYTES", 100)
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("a.txt", b"x" * 101)
    assert "boyutu" in str(exc.value)


def test_empty_file_rejected():
    with pytest.raises(InvalidRequestError):
        quarantine.verify_upload("a.txt", b"")


# --- magic/extension sniff --------------------------------------------------

def test_pdf_magic_accepted(uploads_dir):
    data = (uploads_dir / "sozlesme_ornek.pdf").read_bytes()
    verified = quarantine.verify_upload("sozlesme_ornek.pdf", data)
    assert verified.kind == "pdf"
    assert verified.mime == "application/pdf"
    assert len(verified.sha256) == 64
    assert verified.size_bytes == len(data)


def test_extension_vs_magic_mismatch_rejected(uploads_dir):
    # DOCX bytes presented as .pdf: content wins, mismatch is typed 415.
    data = (uploads_dir / "dilekce_ornek.docx").read_bytes()
    with pytest.raises(UnsupportedTypeError) as exc:
        quarantine.verify_upload("kilik-degistirmis.pdf", data)
    assert "uyuşmuyor" in str(exc.value)


def test_plain_text_as_docx_rejected():
    with pytest.raises(UnsupportedTypeError):
        quarantine.verify_upload("sahte.docx", "sadece metin".encode())


def test_unknown_extension_rejected():
    with pytest.raises(UnsupportedTypeError):
        quarantine.verify_upload("resim.png", b"\x89PNG\r\n\x1a\n data")


def test_unrecognized_binary_rejected():
    with pytest.raises(UnsupportedTypeError):
        quarantine.verify_upload("garip.txt", b"\x00\x01\x02\x03binary")


# --- zip safety -------------------------------------------------------------

def test_zip_bomb_fixture_rejected(uploads_dir):
    data = (uploads_dir / "zip_bomba.docx").read_bytes()
    assert len(data) < quarantine.MAX_FILE_BYTES  # bomb is small on disk
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("zip_bomba.docx", data)
    message = str(exc.value)
    assert "boyut" in message or "oran" in message


def test_traversal_entry_rejected():
    data = _zip_bytes({"../../evil.txt": b"kacak"})
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("kacak.docx", data)
    assert "traversal" in str(exc.value)


def test_absolute_path_entry_rejected():
    data = _zip_bytes({"/etc/passwd": b"kacak"})
    with pytest.raises(InvalidRequestError):
        quarantine.verify_upload("kacak.docx", data)


def test_nested_zip_entry_rejected():
    inner = _zip_bytes({}, docx_shape=True)
    data = _zip_bytes({"word/embedded.zip": inner})
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("kacak.docx", data)
    assert "nested" in str(exc.value) or "arşiv" in str(exc.value)


def test_entry_count_cap(monkeypatch):
    monkeypatch.setattr(quarantine, "ZIP_MAX_ENTRIES", 3)
    data = _zip_bytes({f"word/media/f{i}.bin": b"x" for i in range(5)})
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("cok-girdili.docx", data)
    assert "girdi sayısı" in str(exc.value)


def test_total_uncompressed_cap(monkeypatch):
    monkeypatch.setattr(quarantine, "ZIP_MAX_TOTAL_UNCOMPRESSED", 1024)
    data = _zip_bytes({"word/media/a.bin": b"y" * 2048})
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("toplam.docx", data)
    assert "toplam" in str(exc.value)


def test_compression_ratio_cap():
    # 1 MB of zeros deflates far past 100x and is above the ratio floor.
    data = _zip_bytes({"word/media/zeros.bin": b"\x00" * (1024 * 1024)})
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("oran.docx", data)
    assert "oran" in str(exc.value)


def test_encrypted_entry_rejected():
    data = _zip_bytes({"word/gizli.bin": b"gizli"})
    # Forge the encryption flag bit in both local and central headers.
    data = bytearray(data)
    idx = data.find(b"word/gizli.bin")
    assert idx != -1
    # Flip flag bits at every header occurrence of this entry.
    pos = 0
    while True:
        pos = data.find(b"PK", pos)
        if pos == -1:
            break
        sig = bytes(data[pos:pos + 4])
        if sig == b"PK\x03\x04":
            flag_at = pos + 6
        elif sig == b"PK\x01\x02":
            flag_at = pos + 8
        else:
            pos += 2
            continue
        name_field = data.find(b"word/gizli.bin", pos, pos + 200)
        if name_field != -1:
            data[flag_at] |= 0x1
        pos += 4
    with pytest.raises(InvalidRequestError) as exc:
        quarantine.verify_upload("sifreli.docx", bytes(data))
    assert "şifreli" in str(exc.value)


def test_udf_shape_recognized(uploads_dir):
    data = (uploads_dir / "udf_ornek.udf").read_bytes()
    verified = quarantine.verify_upload("udf_ornek.udf", data)
    assert verified.kind == "udf"


def test_zip_without_known_shape_rejected():
    data = _zip_bytes({"rasgele.bin": b"x"}, docx_shape=False)
    with pytest.raises(UnsupportedTypeError):
        quarantine.verify_upload("bilinmez.docx", data)
