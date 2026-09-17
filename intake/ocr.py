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

Diagnostics (W21)
-----------------
Detection reports ONE explicit state, never free prose alone:

    OCR_READY                 tesseract + Turkish data + pdftoppm all present
    OCR_DISABLED              COLLEX_OCR=off (or an unrecognized value)
    OCR_EXECUTABLE_MISSING    no ``tesseract`` on PATH
    OCR_TURKISH_DATA_MISSING  ``tesseract --list-langs`` ran but lists no ``tur``
    OCR_RASTERIZER_MISSING    no ``pdftoppm`` on PATH
    OCR_FAILED                detection itself errored (``--list-langs`` could
                              not start, timed out or exited non-zero)

Only OCR_READY yields a provider; every other state leaves scanned pages
UNREADABLE. Detection is cached per process for the process environment, so
a batch of PDFs spawns ``tesseract --list-langs`` once, not once per file.
``python -m intake.ocr --status`` prints the state as one JSON object
``{state, provider, languages, rasterizer, messageTr}`` — tool NAMES only,
never paths or environment values.

Time (W21 #30)
--------------
The whole intake runs under the control plane's 180 s
``INTAKE_EXEC_TIMEOUT_MS``. OCR therefore has ONE overall budget per file
(``OCR_TOTAL_BUDGET_S``, enforced by ``intake/extract.py``) and one shared
budget per page for rasterize + recognize together (``PAGE_TIMEOUT_S``, never
more than what is left of the file budget). Pages the budget did not reach
stay unread and are reported (``OCR_BUDGET_EXCEEDED:<n>``); the upload still
succeeds with honest partial coverage instead of being killed. While OCR runs
on POSIX, a SIGTERM (the intake timeout) ends the intake through an exception
so the running ``pdftoppm``/``tesseract`` child is killed with it rather than
left behind (``sigterm_stops_ocr``). Windows terminates the intake without a
signal, so there the budget is the only protection.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Mapping, Protocol

OCR_ENV = "COLLEX_OCR"
#: A page whose mean word confidence is below this is recorded SPARSE.
LOW_CONFIDENCE = 0.60
#: Seconds allowed per page for rasterize + recognize TOGETHER (one shared
#: budget: pdftoppm gets it, tesseract gets what pdftoppm left). W21 #30:
#: before, each program got the full value, so a page could take 2 x 120 s.
PAGE_TIMEOUT_S = 120
#: W21 #30: seconds ALL local OCR of one file may take. The intake process is
#: killed at 180 s (control-plane/src/files/routes.ts INTAKE_EXEC_TIMEOUT_MS);
#: text-layer extraction, chunking and indexing need the rest. Pages the
#: budget does not reach stay unread and are reported, never guessed.
OCR_TOTAL_BUDGET_S = 90
#: A page is not started with less than this left of the file budget: it
#: could not finish, and a half-run page only costs time.
OCR_MIN_PAGE_S = 5
#: Rasterization resolution; 300 dpi is the usual floor for body text.
RASTER_DPI = 300
#: Seconds allowed for ``tesseract --list-langs`` during detection.
DETECT_TIMEOUT_S = 20
#: The tessdata language the provider reads with; detection requires it.
OCR_LANGUAGE = "tur"

#: Capability states (W21). One code per distinct cause, so health and the
#: operator can tell "switched off" from "installed but no Turkish data"
#: without matching Turkish prose.
OCR_READY = "OCR_READY"
OCR_DISABLED = "OCR_DISABLED"
OCR_EXECUTABLE_MISSING = "OCR_EXECUTABLE_MISSING"
OCR_TURKISH_DATA_MISSING = "OCR_TURKISH_DATA_MISSING"
OCR_RASTERIZER_MISSING = "OCR_RASTERIZER_MISSING"
OCR_FAILED = "OCR_FAILED"
OCR_STATES = (
    OCR_READY,
    OCR_DISABLED,
    OCR_EXECUTABLE_MISSING,
    OCR_TURKISH_DATA_MISSING,
    OCR_RASTERIZER_MISSING,
    OCR_FAILED,
)

#: Every non-ready message ends with the consequence, in plain Turkish.
_UNREAD_TAIL = "taranmış sayfalar okunmamış sayılır."


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
    """A local OCR engine. ``page_index`` is 0-based.

    ``timeout_s`` (W21 #30) is the most this one page may take; extract.py
    passes it only to providers whose ``ocr_page`` accepts it, so a provider
    written before the budget existed keeps working (the file budget is then
    checked between pages).
    """

    name: str

    def ocr_page(
        self, pdf_bytes: bytes, page_index: int, timeout_s: float | None = None
    ) -> OcrPageResult: ...


@dataclass(frozen=True)
class OcrCapability:
    """What detection found — shown in health, never guessed."""

    available: bool
    engine: str | None
    reason: str
    #: One of OCR_STATES. ``available`` is True exactly when this is OCR_READY.
    state: str = OCR_FAILED
    #: Languages ``tesseract --list-langs`` reported; empty when not asked.
    languages: tuple[str, ...] = ()
    #: Name of the rasterizer found ("pdftoppm"), or None.
    rasterizer: str | None = None
    # Resolved executables, used to build the provider. Never serialized:
    # a path can name the operator's home folder.
    tesseract_path: str | None = field(default=None, repr=False, compare=False)
    pdftoppm_path: str | None = field(default=None, repr=False, compare=False)

    def to_json_dict(self) -> dict:
        return {
            "available": self.available,
            "engine": self.engine,
            "reason": self.reason,
            "state": self.state,
        }

    def status_dict(self) -> dict:
        """The ``--status`` wire shape (control-plane/src/ocr/ocrStatus.ts)."""
        return {
            "state": self.state,
            "provider": "tesseract" if self.tesseract_path is not None else None,
            "languages": list(self.languages),
            "rasterizer": self.rasterizer,
            "messageTr": self.reason,
        }


def _run(args: list[str], *, timeout: float, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    # Argument list, no shell: a file name can never become a command.
    # subprocess.run kills the child on TimeoutExpired and on any other
    # exception raised while it waits (see sigterm_stops_ocr).
    return subprocess.run(  # noqa: S603 - fixed executables, list arguments
        args,
        input=stdin,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


#: The clock the per-page budget is measured with (a module attribute so a
#: test can drive it without touching the process-wide time.monotonic).
_clock = time.monotonic


def _on_sigterm(signum: int, _frame: object) -> None:
    # SystemExit is a BaseException: the per-page "one page never sinks the
    # file" handler (``except Exception``) does not swallow it, and
    # subprocess.run kills its running child before re-raising it.
    raise SystemExit(128 + signum)


@contextlib.contextmanager
def sigterm_stops_ocr(enabled: bool | None = None) -> Iterator[None]:
    """While OCR runs, turn SIGTERM into SystemExit (W21 #30).

    The control plane kills a stuck intake with SIGTERM (execFile timeout).
    Without a handler Python dies at once and the pdftoppm/tesseract child it
    was waiting on keeps running, orphaned, on an 8 GB machine. With this
    handler the exception unwinds through ``subprocess.run``, which kills the
    child. Installed only on POSIX in the main thread (``enabled`` overrides
    the platform check for tests); the previous handler is always restored.
    """
    if enabled is None:
        enabled = os.name == "posix"
    if not enabled or threading.current_thread() is not threading.main_thread():
        yield
        return
    try:
        previous = signal.getsignal(signal.SIGTERM)
        signal.signal(signal.SIGTERM, _on_sigterm)
    except (ValueError, OSError, AttributeError):  # pragma: no cover - exotic host
        yield
        return
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


class TesseractCliProvider:
    """``pdftoppm`` (one page -> PNG) + ``tesseract`` (PNG -> TSV words)."""

    name = "tesseract"

    def __init__(self, tesseract: str, pdftoppm: str, language: str = "tur") -> None:
        self._tesseract = tesseract
        self._pdftoppm = pdftoppm
        self._language = language

    def ocr_page(
        self, pdf_bytes: bytes, page_index: int, timeout_s: float | None = None
    ) -> OcrPageResult:
        page_no = page_index + 1
        # ONE budget for the page: rasterize and recognize share it (W21 #30).
        budget = float(PAGE_TIMEOUT_S) if timeout_s is None else min(float(PAGE_TIMEOUT_S), timeout_s)
        if budget <= 0:
            raise OcrError(f"sayfa {page_no} için OCR süresi kalmadı")
        started = _clock()
        with tempfile.TemporaryDirectory(prefix="collex-ocr-") as work:
            source = Path(work) / "page.pdf"
            source.write_bytes(pdf_bytes)
            prefix = Path(work) / "page"
            try:
                raster = _run(
                    [
                        self._pdftoppm, "-r", str(RASTER_DPI), "-f", str(page_no), "-l", str(page_no),
                        "-png", "-singlefile", str(source), str(prefix),
                    ],
                    timeout=budget,
                )
            except subprocess.TimeoutExpired as exc:
                raise OcrError(f"sayfa {page_no} süre sınırında görüntüye çevrilemedi") from exc
            image = prefix.with_suffix(".png")
            if raster.returncode != 0 or not image.is_file():
                raise OcrError(f"sayfa {page_no} görüntüye çevrilemedi")
            remaining = budget - (_clock() - started)
            if remaining <= 0:
                raise OcrError(f"sayfa {page_no} için OCR süresi doldu")
            try:
                result = _run(
                    [self._tesseract, str(image), "stdout", "-l", self._language, "tsv"],
                    timeout=remaining,
                )
            except subprocess.TimeoutExpired as exc:
                raise OcrError(f"sayfa {page_no} süre sınırında OCR ile okunamadı") from exc
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


_LANG_HEADER_RE = re.compile(r"^list of available languages", re.IGNORECASE)
#: One tessdata entry per line: "tur", "eng", "osd", "script/Latin".
_LANG_LINE_RE = re.compile(r"^[A-Za-z0-9_.+\-/]+$")


def parse_tesseract_languages(output: str) -> tuple[str, ...]:
    """Language entries of ``tesseract --list-langs`` output, one per line.

    The header line ("List of available languages in ... (N):") is skipped
    and only lines that consist of a single tessdata name count. A warning
    such as "Error opening data file .../tur.traineddata" is NOT a language
    line, so a stray "tur" token can never pass for installed Turkish data
    (the pre-W21 check split everything on whitespace and could).
    """
    languages: list[str] = []
    for raw in output.splitlines():
        line = raw.strip()
        if line == "" or _LANG_HEADER_RE.match(line):
            continue
        if _LANG_LINE_RE.match(line):
            languages.append(line)
    return tuple(languages)


def _disabled(reason: str) -> OcrCapability:
    return OcrCapability(False, None, reason, state=OCR_DISABLED)


def _detect(env: Mapping[str, str]) -> OcrCapability:
    mode = (env.get(OCR_ENV) or "auto").strip().lower()
    if mode == "off":
        return _disabled(f"Taranmış sayfaları okuma (OCR) kapalı; {_UNREAD_TAIL}")
    if mode not in ("auto", "tesseract"):
        return _disabled(f"OCR ayarı tanınmadı, OCR kapalı tutuluyor; {_UNREAD_TAIL}")
    tesseract = shutil.which("tesseract")
    pdftoppm = shutil.which("pdftoppm")
    rasterizer = "pdftoppm" if pdftoppm is not None else None
    if tesseract is None:
        missing = "tesseract" if pdftoppm is not None else "tesseract, pdftoppm"
        return OcrCapability(
            False, None,
            f"Bu bilgisayarda OCR programı bulunamadı ({missing}); {_UNREAD_TAIL}",
            state=OCR_EXECUTABLE_MISSING, rasterizer=rasterizer, pdftoppm_path=pdftoppm,
        )
    try:
        listed = _run([tesseract, "--list-langs"], timeout=DETECT_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        listed = None
    if listed is None or listed.returncode != 0:
        # Detection itself failed. Never report this as "Turkish data
        # missing": the engine may be broken, not merely unconfigured.
        return OcrCapability(
            False, None,
            f"OCR programı (tesseract) denetlenirken hata oluştu; {_UNREAD_TAIL}",
            state=OCR_FAILED, rasterizer=rasterizer,
            tesseract_path=tesseract, pdftoppm_path=pdftoppm,
        )
    stdout = listed.stdout.decode("utf-8", errors="replace")
    # Old tesseract releases print the list on stderr; read it only when
    # stdout carried no language line at all.
    languages = parse_tesseract_languages(stdout) or parse_tesseract_languages(
        listed.stderr.decode("utf-8", errors="replace")
    )
    if OCR_LANGUAGE not in languages:
        return OcrCapability(
            False, None,
            f"OCR programı var ama Türkçe dil verisi (tur) kurulu değil; {_UNREAD_TAIL}",
            state=OCR_TURKISH_DATA_MISSING, languages=languages, rasterizer=rasterizer,
            tesseract_path=tesseract, pdftoppm_path=pdftoppm,
        )
    if pdftoppm is None:
        return OcrCapability(
            False, None,
            f"Sayfaları görüntüye çeviren program (pdftoppm) bulunamadı; {_UNREAD_TAIL}",
            state=OCR_RASTERIZER_MISSING, languages=languages,
            tesseract_path=tesseract,
        )
    return OcrCapability(
        True, "tesseract",
        "Yerel OCR hazır (tesseract, Türkçe). OCR ile okunan metin hata içerebilir;"
        " alıntıları belgenin aslıyla karşılaştırın.",
        state=OCR_READY, languages=languages, rasterizer=rasterizer,
        tesseract_path=tesseract, pdftoppm_path=pdftoppm,
    )


#: Per-process detection cache for the PROCESS environment only. Keyed by
#: everything detection reads, so flipping COLLEX_OCR or PATH re-detects.
_DETECTION_CACHE: dict[tuple[str, str, str], OcrCapability] = {}


def _cache_key(env: Mapping[str, str]) -> tuple[str, str, str]:
    return (
        (env.get(OCR_ENV) or "auto").strip().lower(),
        env.get("PATH", ""),
        env.get("TESSDATA_PREFIX", ""),
    )


def clear_ocr_detection_cache() -> None:
    """Forget cached detection (tests; an operator who just installed tur)."""
    _DETECTION_CACHE.clear()


def detect_ocr_capability(env: Mapping[str, str] | None = None) -> OcrCapability:
    """Find a usable local engine. Pure detection: nothing is installed.

    ``env=None`` reads the process environment and is cached per process;
    an explicit mapping is always detected afresh (tests, the status CLI's
    callers) and never touches the cache.
    """
    if env is not None:
        return _detect(env)
    key = _cache_key(os.environ)
    cached = _DETECTION_CACHE.get(key)
    if cached is None:
        cached = _detect(os.environ)
        _DETECTION_CACHE[key] = cached
    return cached


def resolve_ocr_provider(env: Mapping[str, str] | None = None) -> OcrProvider | None:
    """The provider to use, or None (then scanned pages stay UNREADABLE)."""
    capability = detect_ocr_capability(env)
    if (
        not capability.available
        or capability.tesseract_path is None
        or capability.pdftoppm_path is None
    ):
        return None
    return TesseractCliProvider(capability.tesseract_path, capability.pdftoppm_path)


def main(argv: list[str] | None = None) -> int:
    """``python -m intake.ocr --status``: one JSON object on stdout, exit 0.

    Exit 0 means "detection ran and the state is printed", whatever the
    state is — a missing engine is information, not a crash. The object
    carries tool names only, never paths or environment values.
    """
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):  # pragma: no cover - exotic stdout
        pass
    parser = argparse.ArgumentParser(prog="python -m intake.ocr")
    parser.add_argument("--status", action="store_true", required=True,
                        help="print the local OCR capability state as JSON")
    parser.parse_args(argv)
    print(json.dumps(detect_ocr_capability().status_dict(), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
