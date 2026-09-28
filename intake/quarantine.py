"""Upload quarantine: size cap, magic-byte/MIME sniff, ZIP safety.

Everything here runs BEFORE any parser sees the bytes (brief 11.1:
"quarantine -> magic-byte/MIME validation -> archive bomb checks"). The
verified MIME comes from the CONTENT, never from the filename; the
extension is only cross-checked against the sniffed container and a
mismatch is a typed 415-style rejection.

ZIP safety (DOCX and UDF are both ZIP containers):

* entry count cap (``ZIP_MAX_ENTRIES``)
* per-entry and total uncompressed size caps
* per-entry compression ratio cap (only for entries above a floor, so a
  30-byte header entry compressed to 1 byte is not a false positive)
* path traversal (``..`` components, absolute paths, drive letters) reject
* encrypted entries reject
* NO nested-zip descent: an entry that is itself a zip archive (by name
  suffix) is rejected outright, and nothing in this package ever opens an
  inner archive. (W22: ``open_document_container`` opens a UYAP download
  .zip exactly one level deep through these same gates and hands each
  document back as BYTES; each one then meets ``verify_upload`` — and its
  own ZIP gates — as a separate upload. See the section at the end.)

Header honesty limitation (documented, not hidden): the caps validate the
sizes DECLARED in the zip central directory. Python's ``zipfile`` enforces
the declared size on read (``ZipExtFile`` truncates at ``file_size`` and
fails the CRC check on mismatch), so a lying header cannot expand past the
cap at extraction time either — but a hostile archive rejected here is
rejected on its declared shape.

No network access exists anywhere in this package. XML inside the
containers is parsed later (intake/extract.py) with defusedxml for UDF —
DTD/entity/external-reference processing explicitly refused — and with
python-docx (lxml) for DOCX, whose default parser neither loads external
DTDs nor fetches over the network (``no_network=True`` is lxml's default);
the archive shape those parsers see has already passed the caps above.
"""

from __future__ import annotations

import hashlib
import re
import io
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

from intake.errors import InvalidRequestError, UnsupportedTypeError

#: Upload cap in MiB — THE single source for the limit. The TypeScript
#: pre-check (control-plane/src/files/routes.ts, UPLOAD_CAP_MIB) mirrors this
#: value and control-plane/tests/files/uploadCap.test.ts parses THIS line to
#: pin the two together, so they cannot drift.
#:
#: Why 25 and not 100 (W12-F decision): the ZIP-bomb gates below are
#: independent of this cap (per-entry/total 50 MB, ratio 100x) and would stay
#: safe, but the upload path is one synchronous intake-CLI process with a
#: 180 s budget and no progress channel. pypdf extracts text at roughly
#: 50-100 ms per born-digital page; a 100 MB text PDF (thousands of pages)
#: would run 4-8 minutes and turn a clean up-front rejection into a 3-minute
#: hang followed by a 504. 25 MB (~1 000-1 500 pages) fits the budget with
#: the batched indexer. Raise it only together with a streaming/progress
#: upload path.
#:
#: W14 B-19 asks for 40 (UYAP itself accepts 40 MB per document, TRMARKET).
#: The technical blocker is gone — ``intake/extract.py`` ``PDF_MAX_PAGES``
#: (B-33) now refuses an over-long PDF in about two seconds instead of
#: burning the whole 180 s budget — but the value has THREE sources that
#: must move together (this line, ``control-plane/src/files/routes.ts``
#: ``UPLOAD_CAP_MIB``, and ``control-plane/tests/files/uploadCap.test.ts``
#: which parses this comment), and the latter two belong to another lane in
#: this wave. Changing only this one would break the "change both or
#: neither" invariant, so the raise is handed over as an integration
#: request instead of half-applied here.
UPLOAD_CAP_MIB = 25

# Patched down by tests; keep it a module attribute.
MAX_FILE_BYTES = UPLOAD_CAP_MIB * 1024 * 1024

ZIP_MAX_ENTRIES = 200
ZIP_MAX_ENTRY_UNCOMPRESSED = 50 * 1024 * 1024
ZIP_MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024
ZIP_MAX_COMPRESSION_RATIO = 100.0
# Ratio is only meaningful for entries with real bulk; tiny XML parts
# legitimately compress > 100x.
ZIP_RATIO_FLOOR_BYTES = 64 * 1024

SUPPORTED_KINDS = ("pdf", "docx", "txt", "udf")

MIME_BY_KIND = {
    "pdf": "application/pdf",
    "docx": ("application/vnd.openxmlformats-officedocument"
             ".wordprocessingml.document"),
    "txt": "text/plain",
    # UDF has no IANA registration; this is the local convention the API
    # echoes back. The original bytes are stored untouched regardless.
    "udf": "application/vnd.uyap.udf",
}

_EXT_BY_KIND = {"pdf": ".pdf", "docx": ".docx", "txt": ".txt", "udf": ".udf"}

_NESTED_ARCHIVE_SUFFIXES = (".zip", ".jar", ".7z", ".rar", ".gz", ".tar")


@dataclass(frozen=True)
class VerifiedFile:
    """Outcome of quarantine: content-verified identity of the upload."""

    kind: str          # 'pdf' | 'docx' | 'txt' | 'udf'
    mime: str          # verified MIME (from content, never the filename)
    sha256: str        # hex sha256 of the ORIGINAL bytes
    size_bytes: int

    @property
    def extension(self) -> str:
        return _EXT_BY_KIND[self.kind]


def _extension_kind(name: str) -> str:
    suffix = PurePosixPath(name.replace("\\", "/")).suffix.lower()
    for kind, ext in _EXT_BY_KIND.items():
        if suffix == ext:
            return kind
    raise UnsupportedTypeError(
        f"desteklenmeyen dosya uzantısı: {suffix or '(yok)'} —"
        " kabul edilenler: .pdf, .docx, .txt, .udf"
    )


def _entry_is_traversal(name: str) -> bool:
    """True for absolute paths, drive letters, or any '..' component."""
    if name.startswith(("/", "\\")):
        return True
    # 'C:evil' / 'C:/evil' — PureWindowsPath sees the drive either way.
    if PureWindowsPath(name).drive:
        return True
    parts = name.replace("\\", "/").split("/")
    return any(part == ".." for part in parts)


def _check_zip_safety(data: bytes) -> zipfile.ZipFile:
    """Validate archive shape; returns the opened ZipFile on success."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except zipfile.BadZipFile as exc:
        raise UnsupportedTypeError(f"bozuk ZIP kapsayıcı: {exc}") from exc

    if len(infos) == 0:
        raise UnsupportedTypeError("boş ZIP kapsayıcı")
    if len(infos) > ZIP_MAX_ENTRIES:
        raise InvalidRequestError(
            f"ZIP girdi sayısı sınırı aşıldı: {len(infos)} > {ZIP_MAX_ENTRIES}"
        )

    total_uncompressed = 0
    for info in infos:
        if info.flag_bits & 0x1:
            raise InvalidRequestError(
                f"şifreli ZIP girdisi reddedildi: {info.filename!r}"
            )
        if _entry_is_traversal(info.filename):
            raise InvalidRequestError(
                f"ZIP path traversal girişimi reddedildi: {info.filename!r}"
            )
        lower_name = info.filename.lower()
        if lower_name.endswith(_NESTED_ARCHIVE_SUFFIXES):
            raise InvalidRequestError(
                "iç içe arşiv reddedildi (nested zip descent yok):"
                f" {info.filename!r}"
            )
        if info.file_size > ZIP_MAX_ENTRY_UNCOMPRESSED:
            raise InvalidRequestError(
                f"ZIP girdisi açılmış boyut sınırını aşıyor:"
                f" {info.filename!r} ({info.file_size} bayt)"
            )
        total_uncompressed += info.file_size
        if total_uncompressed > ZIP_MAX_TOTAL_UNCOMPRESSED:
            raise InvalidRequestError(
                "ZIP toplam açılmış boyut sınırı aşıldı"
                f" (> {ZIP_MAX_TOTAL_UNCOMPRESSED} bayt)"
            )
        if (
            info.file_size >= ZIP_RATIO_FLOOR_BYTES
            and info.compress_size > 0
            and info.file_size / info.compress_size > ZIP_MAX_COMPRESSION_RATIO
        ):
            raise InvalidRequestError(
                "ZIP sıkıştırma oranı sınırı aşıldı (arşiv bombası şüphesi):"
                f" {info.filename!r}"
            )
    return zf


def _looks_like_text(data: bytes) -> bool:
    """Content sniff for plain text: no NULs, decodable as UTF-8 or
    windows-1254 (Turkish latin-5). The DECODING decision with its warning
    lives in intake/extract.py; this only answers "is this a text file"."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        # UTF-16 with a BOM (Notepad's "Unicode"): NUL bytes are expected.
        sample = data[: 65536 - (65536 % 2)]
        try:
            text = sample.decode("utf-16")
        except UnicodeDecodeError:
            return False
        return "\x00" not in text
    if b"\x00" in data:
        return False
    sample = data[:65536]
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError:
        pass
    try:
        sample.decode("windows-1254")
        return True
    except UnicodeDecodeError:
        return False


def verify_upload(name: str, data: bytes) -> VerifiedFile:
    """Quarantine gate. Raises a typed IntakeError or returns VerifiedFile.

    ``kind`` is decided by CONTENT (magic bytes / container shape) and the
    extension must AGREE with it; a .pdf that is really a zip, or a .docx
    that is really plain text, is rejected as UNSUPPORTED_TYPE.
    """
    if not name:
        raise InvalidRequestError("dosya adı boş")
    if len(data) == 0:
        raise InvalidRequestError("boş dosya")
    if len(data) > MAX_FILE_BYTES:
        raise InvalidRequestError(
            f"dosya boyutu sınırı aşıldı: {len(data)} > {MAX_FILE_BYTES} bayt"
        )

    ext_kind = _extension_kind(name)

    if data.startswith(b"%PDF"):
        content_kind = "pdf"
    elif data.startswith(b"PK\x03\x04"):
        zf = _check_zip_safety(data)
        names = set(zf.namelist())
        if "[Content_Types].xml" in names and "word/document.xml" in names:
            content_kind = "docx"
        elif any(PurePosixPath(n).name == "content.xml" for n in names):
            content_kind = "udf"
        else:
            raise UnsupportedTypeError(
                "ZIP kapsayıcı tanınmadı: ne DOCX (word/document.xml)"
                " ne UDF (content.xml) yapısı bulundu"
            )
    elif _looks_like_text(data):
        content_kind = "txt"
    else:
        raise UnsupportedTypeError(
            "dosya içeriği tanınmadı (magic-byte sniff başarısız):"
            " PDF, DOCX, UDF veya düz metin değil"
        )

    if content_kind != ext_kind:
        raise UnsupportedTypeError(
            f"uzantı ile içerik uyuşmuyor: uzantı {ext_kind!r},"
            f" içerik {content_kind!r}"
        )

    return VerifiedFile(
        kind=content_kind,
        mime=MIME_BY_KIND[content_kind],
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )


# ---------------------------------------------------------------------------
# Document CONTAINER (W22, "UYAP'tan indirdiğim klasörü dosyalarıma dağıt")
# ---------------------------------------------------------------------------
#
# A lawyer who downloads a case file from UYAP Avukat Portal often gets ONE
# .zip holding the documents (.udf, .pdf, sometimes .docx/.txt). Accepting
# that .zip is safe ONLY if it passes the very same gates as any other ZIP
# the quarantine opens, so this function adds no gate of its own and relaxes
# none:
#
# * the SAME size cap as a single upload (``MAX_FILE_BYTES``) for the whole
#   container — a download larger than that is refused with the remedy
#   (extract it and give the folder), never truncated;
# * the SAME ``_check_zip_safety`` (entry count, per-entry and total
#   uncompressed size, compression ratio, traversal, encryption, and the
#   nested-archive refusal: a .zip/.rar/.7z INSIDE the container rejects the
#   whole container);
# * the container is opened ONE level deep and no further. Each document it
#   carries leaves as bytes and must pass ``verify_upload`` on its own, like a
#   file the lawyer extracted by hand — a .udf or .docx entry is itself a ZIP
#   and meets its own ZIP gates there. Nothing here opens an inner archive.
#
# A container that is itself a DOCX or a UDF is a document, not a folder
# download, and is refused with that sentence.

#: Extensions a container entry must carry to be treated as a document.
CONTAINER_DOCUMENT_SUFFIXES = (".pdf", ".docx", ".txt", ".udf")

#: Longest path component written for an entry (the rest is cut, suffix kept).
_CONTAINER_COMPONENT_MAX = 120

_UNSAFE_COMPONENT_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


@dataclass(frozen=True)
class ContainerEntry:
    """One document carried by a container: a SAFE relative path + bytes."""

    path: str   # POSIX relative path, every component sanitized
    data: bytes


@dataclass(frozen=True)
class ContainerContents:
    documents: tuple[ContainerEntry, ...]
    #: Relative paths of entries that are not documents (html, xml, ...),
    #: reported by name, never treated as failures.
    skipped: tuple[str, ...]


def _entry_display_name(info: zipfile.ZipInfo) -> str:
    """The entry name as the lawyer's computer wrote it.

    An archive made on a Turkish Windows without the UTF-8 flag (bit 11)
    stores names in the OEM code page (cp857); ``zipfile`` decodes those as
    cp437, which turns "Bilirkişi" into "Bilirki₧i". Re-decoding is exact
    for such archives and a no-op when the flag is set.
    """
    name = info.filename
    if info.flag_bits & 0x800:
        return name
    try:
        return name.encode("cp437").decode("cp857")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name


def _safe_component(part: str) -> str:
    cleaned = _UNSAFE_COMPONENT_CHARS.sub("_", part).strip().strip(".")
    if not cleaned:
        return "_"
    if len(cleaned) > _CONTAINER_COMPONENT_MAX:
        suffix = PurePosixPath(cleaned).suffix
        cleaned = cleaned[: _CONTAINER_COMPONENT_MAX - len(suffix)] + suffix
    return cleaned


def _safe_relative_path(name: str) -> str:
    parts = [
        _safe_component(part)
        for part in name.replace("\\", "/").split("/")
        if part not in ("", ".")
    ]
    return "/".join(parts)


def open_document_container(name: str, data: bytes) -> ContainerContents:
    """Open a UYAP download .zip ONE level deep, through the ZIP gates.

    Raises a typed IntakeError (400/415) exactly like ``verify_upload``;
    returns the documents as bytes under sanitized relative paths plus the
    non-document entries by name.
    """
    if not name:
        raise InvalidRequestError("dosya adı boş")
    if PurePosixPath(name.replace("\\", "/")).suffix.lower() != ".zip":
        raise UnsupportedTypeError(
            "toplu belge arşivi .zip uzantılı olmalı; klasörü doğrudan da"
            " verebilirsiniz"
        )
    if len(data) == 0:
        raise InvalidRequestError("boş dosya")
    if len(data) > MAX_FILE_BYTES:
        raise InvalidRequestError(
            f"arşiv boyutu sınırı aşıldı: {len(data)} > {MAX_FILE_BYTES} bayt"
            " — arşivi bilgisayarınızda açıp klasörü verin"
        )
    if not data.startswith(b"PK\x03\x04"):
        raise UnsupportedTypeError(
            "dosya bir ZIP arşivi değil (magic-byte sniff başarısız)"
        )
    zf = _check_zip_safety(data)
    names = set(zf.namelist())
    if ("[Content_Types].xml" in names and "word/document.xml" in names) or any(
        PurePosixPath(n).name == "content.xml" for n in names
    ):
        raise UnsupportedTypeError(
            "bu dosya bir belge (Word ya da UYAP belgesi), belge arşivi değil;"
            " tek belge olarak yükleyin"
        )

    documents: list[ContainerEntry] = []
    skipped: list[str] = []
    used: set[str] = set()
    for info in zf.infolist():
        if info.is_dir():
            continue
        rel = _safe_relative_path(_entry_display_name(info))
        if not rel:
            continue
        if PurePosixPath(rel).suffix.lower() not in CONTAINER_DOCUMENT_SUFFIXES:
            skipped.append(rel)
            continue
        unique = rel
        counter = 2
        while unique.lower() in used:
            path = PurePosixPath(rel)
            unique = str(path.with_name(f"{path.stem} ({counter}){path.suffix}"))
            counter += 1
        used.add(unique.lower())
        # ZipExtFile enforces the DECLARED size and the CRC, so an entry
        # cannot expand past what _check_zip_safety already accepted.
        documents.append(ContainerEntry(path=unique, data=zf.read(info)))
    return ContainerContents(documents=tuple(documents), skipped=tuple(skipped))
