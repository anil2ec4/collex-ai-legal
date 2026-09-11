"""Local OCR provider boundary (W20 phase 10).

A scanned PDF page has no text layer. Until W20 such a page was reported
honestly as ``UNREADABLE`` and blocked any claim that the whole file had been
read — and that remains exactly the behaviour when no local OCR runtime is
present. This module adds the boundary through which a LOCAL OCR engine can
turn such a page into text:

    original PDF page -> OCR -> page text -> the SAME segment/page model
    (extraction_method = 'ocr') -> canonical text -> chunks -> analysis units
    -> processing coverage

There is no detached "OCR copy" of the document: OCR text is placed in the
page's own slot of the canonical text, so every locator ("s. 7") still names
the physical page it came from.

Rules
-----
* Local only. Nothing here calls a cloud service. The existing cloud OCR route
  (POST /v1/ai/ocr) is a separate, opt-in, consent-gated feature and is
  refused under the LOCAL_ONLY data boundary.
* Capability is DETECTED, never assumed: ``resolve_ocr_provider`` returns
  ``None`` unless the required executables exist and the Turkish language
  data is installed. ``None`` means "no OCR" and the page stays UNREADABLE.
* Nothing is installed or downloaded by this module.
* ``COLLEX_OCR`` selects the behaviour: ``auto`` (default: use a detected
  local engine), ``off`` (never OCR), ``tesseract`` (require it; report why
  it is unavailable).
* OCR text is machine output. A page read by OCR carries method ``ocr`` and a
  confidence; a low-confidence page is recorded ``SPARSE`` so it is counted
  as read but never as verified, and the exhaustive review refuses to call
  the file completely read on its strength.

The Tesseract provider shells out with argument LISTS (never a shell string)
to ``pdftoppm`` (poppler) to rasterize one page and ``tesseract`` to read it.
Both must be installed by the operator; see docs/implementation/LOCAL-OCR.md.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

OCR_ENV = "COLLEX_OCR"
#: A page whose mean word confidence is below this is recorded SPARSE.
LOW_CONFIDENCE = 0.60
#: Seconds allowed per page for rasterize + recognize together.
PAGE_TIMEOUT_S = 120
#: Rasterization resolution; 300 dpi is the usual floor for body text.
RASTER_DPI = 300


@dataclass(frozen=True)
class OcrPageResult:
    """Text recognized on one page, with the engine's own confidence."""

    text: str
    #: Mean word confidence in [0, 1], or None when the engine gave none.
    confidence: float | None
    engine: str


class OcrError(Exception):
    """One page could not be recognized. The page stays UNREADABLE."""


class OcrProvider(Protocol):
    """A local OCR engine. ``page_index`` is 0-based."""

    name: str

    def ocr_page(self, pdf_bytes: bytes, page_index: int) -> OcrPageResult: ...


@dataclass(frozen=True)
class OcrCapability:
    """What detection found — shown in health, never guessed."""

    available: bool
    engine: str | None
    reason: str

    def to_json_dict(self) -> dict:
        return {"available": self.available, "engine": self.engine, "reason": self.reason}


def _run(args: list[str], *, timeout: int, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    # Argument list, no shell: a file name can never become a command.
    return subprocess.run(  # noqa: S603 - fixed executables, list arguments
        args,
        input=stdin,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


class TesseractCliProvider:
    """``pdftoppm`` (one page -> PNG) + ``tesseract`` (PNG -> TSV words)."""

    name = "tesseract"

    def __init__(self, tesseract: str, pdftoppm: str, language: str = "tur") -> None:
        self._tesseract = tesseract
        self._pdftoppm = pdftoppm
        self._language = language

    def ocr_page(self, pdf_bytes: bytes, page_index: int) -> OcrPageResult:
        page_no = page_index + 1
        with tempfile.TemporaryDirectory(prefix="collex-ocr-") as work:
            source = Path(work) / "page.pdf"
            source.write_bytes(pdf_bytes)
            prefix = Path(work) / "page"
            raster = _run(
                [
                    self._pdftoppm, "-r", str(RASTER_DPI), "-f", str(page_no), "-l", str(page_no),
                    "-png", "-singlefile", str(source), str(prefix),
                ],
                timeout=PAGE_TIMEOUT_S,
            )
            image = prefix.with_suffix(".png")
            if raster.returncode != 0 or not image.is_file():
                raise OcrError(f"sayfa {page_no} görüntüye çevrilemedi")
            result = _run(
                [self._tesseract, str(image), "stdout", "-l", self._language, "tsv"],
                timeout=PAGE_TIMEOUT_S,
            )
            if result.returncode != 0:
                raise OcrError(f"sayfa {page_no} OCR ile okunamadı")
        return parse_tesseract_tsv(result.stdout.decode("utf-8", errors="replace"), self.name)


def parse_tesseract_tsv(tsv: str, engine: str = "tesseract") -> OcrPageResult:
    """Rebuild page text (lines in reading order) and mean word confidence."""
    lines: dict[tuple[int, int, int], list[str]] = {}
    confidences: list[float] = []
    for row_no, row in enumerate(tsv.splitlines()):
        if row_no == 0:
            continue  # header
        cells = row.split("\t")
        if len(cells) < 12:
            continue
        try:
            level = int(cells[0])
            key = (int(cells[2]), int(cells[3]), int(cells[4]))  # block, par, line
            conf = float(cells[10])
        except ValueError:
            continue
        word = cells[11].strip()
        if level != 5 or word == "":
            continue
        lines.setdefault(key, []).append(word)
        if conf >= 0:
            confidences.append(conf / 100.0)
    text = "\n".join(" ".join(words) for _key, words in sorted(lines.items()))
    confidence = round(sum(confidences) / len(confidences), 4) if confidences else None
    return OcrPageResult(text=text, confidence=confidence, engine=engine)


def detect_ocr_capability(env: dict[str, str] | None = None) -> OcrCapability:
    """Find a usable local engine. Pure detection: nothing is installed."""
    env = os.environ if env is None else env
    mode = (env.get(OCR_ENV) or "auto").strip().lower()
    if mode == "off":
        return OcrCapability(False, None, f"{OCR_ENV}=off: OCR kapalı")
    if mode not in ("auto", "tesseract"):
        return OcrCapability(False, None, f"{OCR_ENV} değeri tanınmadı; OCR kapalı")
    tesseract = shutil.which("tesseract")
    pdftoppm = shutil.which("pdftoppm")
    if tesseract is None or pdftoppm is None:
        missing = ", ".join(
            name for name, path in (("tesseract", tesseract), ("pdftoppm", pdftoppm)) if path is None
        )
        return OcrCapability(False, None, f"yerel OCR programı bulunamadı: {missing}")
    try:
        langs = _run([tesseract, "--list-langs"], timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return OcrCapability(False, None, "tesseract çalıştırılamadı")
    listed = (langs.stdout + langs.stderr).decode("utf-8", errors="replace").split()
    if "tur" not in listed:
        return OcrCapability(False, None, "tesseract Türkçe dil verisi (tur) kurulu değil")
    return OcrCapability(True, "tesseract", "yerel tesseract + pdftoppm bulundu")


def resolve_ocr_provider(env: dict[str, str] | None = None) -> OcrProvider | None:
    """The provider to use, or None (then scanned pages stay UNREADABLE)."""
    capability = detect_ocr_capability(env)
    if not capability.available:
        return None
    tesseract = shutil.which("tesseract")
    pdftoppm = shutil.which("pdftoppm")
    if tesseract is None or pdftoppm is None:  # raced with an uninstall
        return None
    return TesseractCliProvider(tesseract, pdftoppm)
