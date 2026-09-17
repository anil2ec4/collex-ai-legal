"""W21 platform lane: explicit local-OCR capability states + the status CLI.

Detection is exercised with a monkeypatched ``shutil.which`` and
``intake.ocr._run`` — no OCR process is started and nothing is installed.
One test runs the REAL ``python -m intake.ocr --status`` entry point (with
OCR switched off, so it is deterministic on every machine).

The invariant under all of it is unchanged from W20: only OCR_READY yields
a provider, and a scanned page stays UNREADABLE unless OCR actually read it.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from intake import extract as extract_mod
from intake import ocr as ocr_mod
from intake.errors import ExtractionFailedError
from intake.ocr import (
    OCR_DISABLED,
    OCR_EXECUTABLE_MISSING,
    OCR_FAILED,
    OCR_RASTERIZER_MISSING,
    OCR_READY,
    OCR_STATES,
    OCR_TURKISH_DATA_MISSING,
    OcrError,
    OcrPageResult,
    TesseractCliProvider,
    detect_ocr_capability,
    parse_tesseract_languages,
    resolve_ocr_provider,
)
from tests.intake.pdf_fixtures import build_multipage_pdf, mixed_pdf

REPO_ROOT = Path(__file__).resolve().parents[2]

# Paths that must never reach the status JSON (a home folder is private).
FAKE_TESSERACT = "/Users/avukat/gizli-klasor/bin/tesseract"
FAKE_PDFTOPPM = "/Users/avukat/gizli-klasor/bin/pdftoppm"
HEADER = 'List of available languages in "/opt/homebrew/share/tessdata/" (3):'
STATUS_KEYS = {"state", "provider", "languages", "rasterizer", "messageTr"}


def _listing(stdout: str, *, code: int = 0, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        ["tesseract", "--list-langs"], code, stdout=stdout.encode("utf-8"), stderr=stderr.encode("utf-8")
    )


@pytest.fixture()
def tools(monkeypatch: pytest.MonkeyPatch):
    """Configurable which() + ``tesseract --list-langs`` result; records spawns."""
    state: dict = {
        "which": {"tesseract": FAKE_TESSERACT, "pdftoppm": FAKE_PDFTOPPM},
        "result": _listing(f"{HEADER}\neng\nosd\ntur\n"),
        "calls": [],
    }

    def which(name: str):
        return state["which"].get(name)

    def run(args, *, timeout, stdin=None):
        state["calls"].append(list(args))
        result = state["result"]
        if isinstance(result, BaseException):
            raise result
        return result

    monkeypatch.setattr(shutil, "which", which)
    monkeypatch.setattr(ocr_mod, "_run", run)
    ocr_mod.clear_ocr_detection_cache()
    yield state
    ocr_mod.clear_ocr_detection_cache()


class FailingOcr:
    """Every page it is asked about fails (or recognizes nothing)."""

    name = "failing-ocr"

    def __init__(self, *, empty_text: bool = False):
        self.calls: list[int] = []
        self._empty = empty_text

    def ocr_page(self, pdf_bytes: bytes, page_index: int) -> OcrPageResult:
        self.calls.append(page_index)
        if self._empty:
            return OcrPageResult(text="   ", confidence=0.9, engine=self.name)
        raise OcrError(f"sayfa {page_index + 1} okunamadı")


# ---------------------------------------------------------------------------
# Capability states
# ---------------------------------------------------------------------------


def test_the_six_states_are_the_documented_codes():
    assert OCR_STATES == (
        "OCR_READY",
        "OCR_DISABLED",
        "OCR_EXECUTABLE_MISSING",
        "OCR_TURKISH_DATA_MISSING",
        "OCR_RASTERIZER_MISSING",
        "OCR_FAILED",
    )


@pytest.mark.parametrize("mode", ["off", "OFF", " off "])
def test_off_is_disabled_and_starts_no_process(tools, mode):
    capability = detect_ocr_capability({"COLLEX_OCR": mode})
    assert capability.state == OCR_DISABLED
    assert capability.available is False
    assert tools["calls"] == []
    assert resolve_ocr_provider({"COLLEX_OCR": mode}) is None


def test_an_unrecognized_mode_fails_closed_as_disabled(tools):
    capability = detect_ocr_capability({"COLLEX_OCR": "bulut"})
    assert capability.state == OCR_DISABLED
    assert capability.available is False
    assert tools["calls"] == []


def test_missing_tesseract_is_executable_missing(tools):
    tools["which"]["tesseract"] = None
    capability = detect_ocr_capability({})
    assert capability.state == OCR_EXECUTABLE_MISSING
    assert "tesseract" in capability.reason
    assert tools["calls"] == []
    status = capability.status_dict()
    assert status["provider"] is None
    assert status["rasterizer"] == "pdftoppm"
    assert resolve_ocr_provider({}) is None


def test_both_programs_missing_names_both(tools):
    tools["which"] = {}
    capability = detect_ocr_capability({})
    assert capability.state == OCR_EXECUTABLE_MISSING
    assert "tesseract" in capability.reason and "pdftoppm" in capability.reason


def test_a_non_zero_list_langs_exit_is_a_detection_failure_even_if_it_prints_tur(tools):
    # The pre-W21 check never read the return code: this broken engine,
    # which still printed "tur", was reported as READY.
    tools["result"] = _listing(f"{HEADER}\ntur\n", code=1)
    capability = detect_ocr_capability({})
    assert capability.state == OCR_FAILED
    assert capability.available is False
    assert resolve_ocr_provider({}) is None


@pytest.mark.parametrize(
    "error",
    [OSError("exec format error"), subprocess.TimeoutExpired(["tesseract"], 20)],
    ids=["oserror", "timeout"],
)
def test_list_langs_that_cannot_run_is_a_detection_failure(tools, error):
    tools["result"] = error
    capability = detect_ocr_capability({})
    assert capability.state == OCR_FAILED
    assert capability.state != OCR_TURKISH_DATA_MISSING


def test_missing_turkish_data(tools):
    tools["result"] = _listing(f"{HEADER}\neng\nosd\n")
    capability = detect_ocr_capability({})
    assert capability.state == OCR_TURKISH_DATA_MISSING
    assert capability.languages == ("eng", "osd")
    assert capability.status_dict()["provider"] == "tesseract"


def test_a_stray_tur_token_is_not_turkish_data(tools):
    # Whitespace-token matching accepted this; line parsing does not.
    tools["result"] = _listing(
        f"{HEADER}\nWarning: tur could not be loaded\neng\nturk\ntur_vert\n"
    )
    capability = detect_ocr_capability({})
    assert capability.state == OCR_TURKISH_DATA_MISSING
    assert "tur" not in capability.languages


def test_old_tesseract_that_lists_on_stderr_is_read(tools):
    tools["result"] = _listing("", stderr=f"{HEADER}\neng\ntur\n")
    capability = detect_ocr_capability({})
    assert capability.state == OCR_READY
    assert capability.languages == ("eng", "tur")


def test_missing_rasterizer_with_turkish_data(tools):
    tools["which"]["pdftoppm"] = None
    capability = detect_ocr_capability({})
    assert capability.state == OCR_RASTERIZER_MISSING
    assert "pdftoppm" in capability.reason
    assert "tur" in capability.languages
    status = capability.status_dict()
    assert status["rasterizer"] is None
    assert status["provider"] == "tesseract"
    assert resolve_ocr_provider({}) is None


def test_ready_only_when_everything_is_present(tools):
    capability = detect_ocr_capability({"COLLEX_OCR": "auto"})
    assert capability.state == OCR_READY
    assert capability.available is True
    assert capability.engine == "tesseract"
    assert tools["calls"] == [[FAKE_TESSERACT, "--list-langs"]]
    provider = resolve_ocr_provider({"COLLEX_OCR": "tesseract"})
    assert isinstance(provider, TesseractCliProvider)


def test_language_lines_are_parsed_exactly():
    output = "\n".join([HEADER, "eng", "  tur  ", "script/Latin", "Error opening data file x", ""])
    assert parse_tesseract_languages(output) == ("eng", "tur", "script/Latin")
    assert parse_tesseract_languages("") == ()


def test_status_shape_carries_no_paths(tools):
    for setup in (
        lambda s: None,
        lambda s: s["which"].__setitem__("pdftoppm", None),
        lambda s: s.__setitem__("result", _listing(f"{HEADER}\neng\n")),
        lambda s: s.__setitem__("result", _listing("", code=3)),
    ):
        tools["which"] = {"tesseract": FAKE_TESSERACT, "pdftoppm": FAKE_PDFTOPPM}
        tools["result"] = _listing(f"{HEADER}\ntur\n")
        setup(tools)
        status = detect_ocr_capability({}).status_dict()
        assert set(status) == STATUS_KEYS
        assert status["state"] in OCR_STATES
        wire = json.dumps(status, ensure_ascii=False)
        assert "gizli-klasor" not in wire
        assert "/Users/" not in wire


# ---------------------------------------------------------------------------
# Per-process cache
# ---------------------------------------------------------------------------


def test_process_environment_detection_is_cached(tools, monkeypatch):
    monkeypatch.setenv("COLLEX_OCR", "auto")
    first = detect_ocr_capability()
    second = detect_ocr_capability()
    assert first is second
    assert resolve_ocr_provider() is not None
    assert len(tools["calls"]) == 1

    monkeypatch.setenv("COLLEX_OCR", "off")  # a different key re-detects
    assert detect_ocr_capability().state == OCR_DISABLED
    monkeypatch.setenv("COLLEX_OCR", "auto")
    assert detect_ocr_capability() is first
    assert len(tools["calls"]) == 1

    ocr_mod.clear_ocr_detection_cache()
    detect_ocr_capability()
    assert len(tools["calls"]) == 2


def test_an_explicit_environment_is_never_cached(tools):
    detect_ocr_capability({})
    detect_ocr_capability({})
    assert len(tools["calls"]) == 2


def test_a_batch_of_pdfs_detects_once(tools, monkeypatch):
    monkeypatch.setenv("COLLEX_OCR", "auto")
    tools["result"] = _listing(f"{HEADER}\neng\n")  # no Turkish -> no provider
    for _ in range(3):
        outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=1, empty_pages=1))
        assert any(w.startswith("SCANNED_PAGES:1") for w in outcome.warnings)
    assert len(tools["calls"]) == 1


# ---------------------------------------------------------------------------
# The status CLI
# ---------------------------------------------------------------------------


def test_status_cli_prints_one_json_object(tools, monkeypatch, capsys):
    monkeypatch.setenv("COLLEX_OCR", "auto")
    assert ocr_mod.main(["--status"]) == 0
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert len(lines) == 1
    status = json.loads(lines[0])
    assert set(status) == STATUS_KEYS
    assert status["state"] == OCR_READY
    assert status["provider"] == "tesseract"
    assert status["rasterizer"] == "pdftoppm"
    assert "gizli-klasor" not in lines[0]


def test_status_cli_requires_the_status_flag():
    with pytest.raises(SystemExit) as caught:
        ocr_mod.main([])
    assert caught.value.code != 0


def test_real_module_entry_point_runs(tmp_path):
    env = dict(os.environ)
    env["COLLEX_OCR"] = "off"
    completed = subprocess.run(  # noqa: S603 - fixed interpreter, list args
        [sys.executable, "-m", "intake.ocr", "--status"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        timeout=120,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr.decode("utf-8", "replace")
    lines = [line for line in completed.stdout.decode("utf-8").splitlines() if line.strip()]
    assert len(lines) == 1
    status = json.loads(lines[0])
    assert set(status) == STATUS_KEYS
    assert status["state"] == OCR_DISABLED
    assert status["provider"] is None


# ---------------------------------------------------------------------------
# Honest extraction messages when OCR was on
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("empty_text", [False, True], ids=["raises", "reads-nothing"])
def test_ocr_that_fails_on_every_page_says_it_failed(empty_text):
    provider = FailingOcr(empty_text=empty_text)
    with pytest.raises(ExtractionFailedError) as caught:
        extract_mod.extract_pdf(mixed_pdf(text_pages=0, empty_pages=2), ocr=provider)
    assert provider.calls == [0, 1]
    warnings = caught.value.warnings
    assert warnings[0] == extract_mod.SCANNED_PDF_OCR_FAILED_WARNING
    assert "OCR_FAILED_PAGES:2" in warnings
    assert "devre dışı" not in str(caught.value)
    assert all("devre dışı" not in w for w in warnings)


def test_without_any_provider_the_disabled_message_is_unchanged():
    with pytest.raises(ExtractionFailedError) as caught:
        extract_mod.extract_pdf(mixed_pdf(text_pages=0, empty_pages=2), ocr=None)
    # CD1 (W21 #28): the sentence is unchanged, and ONE bare machine code now
    # travels with it — the console switches on the code, not on the prose.
    assert caught.value.warnings == [
        extract_mod.SCANNED_PDF_WARNING,
        extract_mod.SCANNED_PDF_NO_OCR_CODE,
    ]


def test_pages_not_sent_to_ocr_do_not_claim_ocr_is_disabled():
    # Every page carries a tiny text layer (a page number), so none of them
    # is sent to OCR — but OCR was available, so "disabled" would be a lie.
    provider = FailingOcr()
    with pytest.raises(ExtractionFailedError) as caught:
        extract_mod.extract_pdf(build_multipage_pdf([["12"], ["13"]]), ocr=provider)
    assert provider.calls == []
    # CD1: sentence + its bare machine code (the pinned pre-W21 list had
    # only the sentence; the code is the W21 #28 fix, not a regression).
    assert caught.value.warnings == [
        extract_mod.SCANNED_PDF_OCR_NOT_APPLIED_WARNING,
        extract_mod.SCANNED_PDF_OCR_NOT_APPLIED_CODE,
    ]


# ---------------------------------------------------------------------------
# CD1: the fail-closed causes carry ONE bare machine code each
# ---------------------------------------------------------------------------


def test_cd1_each_fail_closed_cause_carries_exactly_one_bare_code():
    """W21 #28: the console must never have to regex Turkish prose to tell
    "no OCR on this computer" from "OCR ran and read nothing" from "OCR was
    not applied". Each cause carries exactly one of the three CD1 codes."""
    codes = {
        extract_mod.SCANNED_PDF_NO_OCR_CODE,
        extract_mod.SCANNED_PDF_OCR_FAILED_CODE,
        extract_mod.SCANNED_PDF_OCR_NOT_APPLIED_CODE,
    }
    assert codes == {"SCANNED_PDF_NO_OCR", "SCANNED_PDF_OCR_FAILED", "SCANNED_PDF_OCR_NOT_APPLIED"}

    cases = [
        (None, mixed_pdf(text_pages=0, empty_pages=2), extract_mod.SCANNED_PDF_NO_OCR_CODE),
        (FailingOcr(), mixed_pdf(text_pages=0, empty_pages=2), extract_mod.SCANNED_PDF_OCR_FAILED_CODE),
        (FailingOcr(empty_text=True), mixed_pdf(text_pages=0, empty_pages=1), extract_mod.SCANNED_PDF_OCR_FAILED_CODE),
        (FailingOcr(), build_multipage_pdf([["12"], ["13"]]), extract_mod.SCANNED_PDF_OCR_NOT_APPLIED_CODE),
    ]
    for provider, data, expected in cases:
        with pytest.raises(ExtractionFailedError) as caught:
            extract_mod.extract_pdf(data, ocr=provider)
        warnings = caught.value.warnings
        present = [w for w in warnings if w in codes]
        assert present == [expected], warnings
        # The code is bare (no ":n" suffix) and sits in the same array as the
        # Turkish sentence, exactly as the CD1 contract says.
        assert all(":" not in w for w in present)
        assert any(w.startswith("taranmış PDF") for w in warnings)
        # The error JSON the CLI prints carries the same array.
        assert caught.value.to_json_dict()["error"]["warnings"] == warnings


def test_a_mixed_scan_whose_ocr_fails_keeps_the_pages_unreadable():
    provider = FailingOcr()
    outcome = extract_mod.extract_pdf(mixed_pdf(text_pages=1, empty_pages=2), ocr=provider)
    by_label = {s.locator_label: s for s in outcome.segments}
    for label in ("2", "3"):
        assert by_label[label].extraction_status == "UNREADABLE"
        assert by_label[label].extraction_method == "none"
        assert by_label[label].start_char == by_label[label].end_char
    assert "OCR_FAILED_PAGES:2" in outcome.warnings
    assert all("devre dışı" not in w for w in outcome.warnings)


def test_a_mixed_scan_page_ocr_never_saw_names_the_real_reason():
    data = build_multipage_pdf([
        ["Sayfa 1", "Bu sayfanın metin katmanı vardır ve okunabilir durumdadır."],
        ["7"],
    ])
    provider = FailingOcr()
    outcome = extract_mod.extract_pdf(data, ocr=provider)
    assert provider.calls == []
    assert any("yerel OCR bu sayfalara uygulanmadı" in w for w in outcome.warnings)
    assert all("devre dışı" not in w for w in outcome.warnings)
