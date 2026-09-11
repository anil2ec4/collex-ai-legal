"""Command line entry point.

Two input modes, exactly one of which must be given:

    # evidence bundle -> lawyer deliverable (docx/md)
    C:/.../.venv/Scripts/python.exe -m export.cli \
        --bundle evidence_bundle.json --out cevap.docx --format docx

    # collex.draft/v1 (dilekçe/sözleşme taslağı) -> DOCX
    C:/.../.venv/Scripts/python.exe -m export.cli \
        --draft taslak.json --out dilekce.docx --format dilekce-docx

    # collex.draft/v1 -> UYAP UDF (DENEYSEL — UYAP Doküman Editörü'nde açarak doğrulayın)
    C:/.../.venv/Scripts/python.exe -m export.cli \
        --draft taslak.json --out dilekce.udf --format dilekce-udf

Exit codes are part of the contract — a caller must be able to tell
"the pipeline handed me garbage" from "the evidence did not hold up":

    0  export written and self-verified
    1  usage error, unreadable file, or a malformed bundle/draft
    2  EXPORT REFUSED — a quote, hash, offset or citation failed to verify

Nothing is written on a non-zero exit.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from export import REPORT_FORMAT, __version__
from export.bundle import load_bundle
from export.draft import ANNEX_CHOICES, ANNEX_FULL, MARKS_ALL, MARKS_CHOICES
from export.errors import BundleFormatError, ExportRefused

EXIT_OK = 0
EXIT_USAGE = 1
EXIT_REFUSED = 2

DRAFT_FORMATS = ("dilekce-docx", "dilekce-udf")
#: W14 · B-13: the Atıf Denetim Raporu, produced from --audit.
AUDIT_FORMATS = ("denetim-docx",)
#: W14 · B-24: the Sözleşme İnceleme Raporu, produced from --review.
REVIEW_FORMATS = ("inceleme-docx",)
#: W14 · B-30: the whole matter as one archive, produced from --package.
PACKAGE_FORMATS = ("dosya-paketi-zip",)
FORMATS = (
    "docx", "md", *DRAFT_FORMATS, *AUDIT_FORMATS, *REVIEW_FORMATS, *PACKAGE_FORMATS
)
_SUFFIX_FORMAT = {".docx": "docx", ".md": "md", ".markdown": "md", ".udf": "dilekce-udf"}

UDF_EXPERIMENTAL_NOTE = "deneysel — UYAP Doküman Editörü'nde açarak doğrulayın"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m export.cli",
        description=(
            "ColleX kanıt paketini avukat teslimine dönüştürür (DOCX/Markdown)."
            " Paketteki her alıntı, dosya yazılmadan ÖNCE kendi SHA-256 özeti"
            " ve kod noktası aralığıyla yeniden doğrulanır; tek bir alıntı"
            " doğrulanamazsa hiçbir dosya yazılmaz (çıkış kodu 2)."
            f" Taslaklar için dilekce-docx ve dilekce-udf ({UDF_EXPERIMENTAL_NOTE})."
        ),
    )
    parser.add_argument(
        "--bundle",
        default=None,
        help="collex.answer.evidence-bundle/v1 JSON dosyası",
    )
    parser.add_argument(
        "--draft",
        default=None,
        help=(
            "collex.draft/v1 JSON dosyası (dilekçe/sözleşme taslağı;"
            f" --format dilekce-docx | dilekce-udf — udf {UDF_EXPERIMENTAL_NOTE})"
        ),
    )
    parser.add_argument(
        "--audit",
        default=None,
        help=(
            "collex.citation-audit/v1 JSON dosyası (Atıf Denetim Raporu;"
            " --format denetim-docx)"
        ),
    )
    parser.add_argument(
        "--review",
        default=None,
        help=(
            "collex.contract-review/v1 JSON dosyası (Sözleşme İnceleme Raporu;"
            " --format inceleme-docx)"
        ),
    )
    parser.add_argument(
        "--package",
        default=None,
        help=(
            "collex.matter-package/v1 JSON planı (dosya paketi ZIP;"
            " --format dosya-paketi-zip)"
        ),
    )
    parser.add_argument("--out", required=True, help="yazılacak dosya yolu")
    parser.add_argument(
        "--format",
        choices=FORMATS,
        default=None,
        help="çıktı biçimi; verilmezse --out uzantısından çıkarılır (varsayılan docx)",
    )
    parser.add_argument(
        "--generated-at",
        default=None,
        help="belge üretim zaman damgası (yeniden üretilebilir çıktı için)",
    )
    # W14 · B-02: two ADDITIVE switches, defaults = today's behaviour.
    parser.add_argument(
        "--annex",
        choices=ANNEX_CHOICES,
        default=ANNEX_FULL,
        help=(
            "yalnızca --draft: 'full' (varsayılan) künye, uyarılar, EK — DOĞRULAMA"
            " ve DAYANAK KAYNAKLARI eklerini yazar; 'none' yalnızca dilekçe"
            " gövdesini yazar (kanıt/hash paketi ayrı dosyadır)"
        ),
    )
    parser.add_argument(
        "--marks",
        choices=MARKS_CHOICES,
        default=MARKS_ALL,
        help=(
            "yalnızca --draft: 'all' (varsayılan) ekran işaretlerini"
            " ('⚠ KAYNAKSIZ —', 'Not: …') yazar; 'none' yazmaz."
            " Doğrulama zorunluluğu HER İKİ durumda da aynıdır."
        ),
    )
    parser.add_argument(
        "--quiet", action="store_true", help="başarı özetini yazdırma"
    )
    parser.add_argument(
        "--version", action="version", version=f"ColleX export {__version__} ({REPORT_FORMAT})"
    )
    return parser


def _resolve_format(explicit: str | None, out: str) -> str:
    if explicit is not None:
        return explicit
    return _SUFFIX_FORMAT.get(Path(out).suffix.lower(), "docx")


def _run_draft_export(args: "argparse.Namespace") -> int:
    """The --draft path: collex.draft/v1 -> DOCX (export.petition) or UDF (export.udf)."""
    fmt = args.format or (
        "dilekce-udf" if Path(args.out).suffix.lower() == ".udf" else "dilekce-docx"
    )
    if fmt not in DRAFT_FORMATS:
        print(
            "--draft yalnızca 'dilekce-docx' veya 'dilekce-udf' biçimiyle"
            f" kullanılabilir (verilen: {fmt})",
            file=sys.stderr,
        )
        return EXIT_USAGE

    from export.draft import DraftFormatError, ExportMode, load_draft

    try:
        draft = load_draft(args.draft)
    except DraftFormatError as exc:
        print(f"GEÇERSİZ TASLAK: {exc}", file=sys.stderr)
        return EXIT_USAGE

    mode = ExportMode(annex=args.annex, marks=args.marks)

    try:
        if fmt == "dilekce-udf":
            from export.udf import export_udf

            result = export_udf(draft, args.out, generated_at=args.generated_at, mode=mode)
        else:
            try:
                from export.petition import export_petition_docx
            except ImportError as exc:  # pragma: no cover - depends on install
                print(
                    "Dilekçe DOCX çıktısı için python-docx gerekli."
                    " Kurulum: pip install '.[export]'"
                    f" (ayrıntı: {exc})",
                    file=sys.stderr,
                )
                return EXIT_USAGE
            result = export_petition_docx(
                draft, args.out, generated_at=args.generated_at, mode=mode
            )
    except ExportRefused as exc:
        print(exc.report(), file=sys.stderr)
        return EXIT_REFUSED
    except OSError as exc:
        print(f"DOSYA YAZILAMADI: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if not args.quiet:
        print(result.summary())
    return EXIT_OK


def _run_audit_export(args: "argparse.Namespace") -> int:
    """The --audit path: collex.citation-audit/v1 -> DOCX (export.audit)."""
    fmt = args.format or "denetim-docx"
    if fmt not in AUDIT_FORMATS:
        print(
            f"--audit yalnızca 'denetim-docx' biçimiyle kullanılabilir (verilen: {fmt})",
            file=sys.stderr,
        )
        return EXIT_USAGE
    try:
        from export.audit import AuditFormatError, export_audit_docx, load_audit
    except ImportError as exc:  # pragma: no cover - depends on install
        print(
            "Denetim raporu için python-docx gerekli. Kurulum: pip install '.[export]'"
            f" (ayrıntı: {exc})",
            file=sys.stderr,
        )
        return EXIT_USAGE

    try:
        report = load_audit(args.audit)
    except AuditFormatError as exc:
        print(f"GEÇERSİZ DENETİM RAPORU: {exc}", file=sys.stderr)
        return EXIT_USAGE

    try:
        result = export_audit_docx(report, args.out)
    except ExportRefused as exc:
        print(exc.report(), file=sys.stderr)
        return EXIT_REFUSED
    except OSError as exc:
        print(f"DOSYA YAZILAMADI: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if not args.quiet:
        print(result.summary())
    return EXIT_OK


def _run_review_export(args: "argparse.Namespace") -> int:
    """The --review path: collex.contract-review/v1 -> DOCX (export.review)."""
    fmt = args.format or "inceleme-docx"
    if fmt not in REVIEW_FORMATS:
        print(
            f"--review yalnızca 'inceleme-docx' biçimiyle kullanılabilir (verilen: {fmt})",
            file=sys.stderr,
        )
        return EXIT_USAGE
    try:
        from export.review import ReviewFormatError, export_review_docx, load_review
    except ImportError as exc:  # pragma: no cover - depends on install
        print(
            "İnceleme raporu için python-docx gerekli. Kurulum: pip install '.[export]'"
            f" (ayrıntı: {exc})",
            file=sys.stderr,
        )
        return EXIT_USAGE

    try:
        report = load_review(args.review)
    except ReviewFormatError as exc:
        print(f"GEÇERSİZ İNCELEME RAPORU: {exc}", file=sys.stderr)
        return EXIT_USAGE

    try:
        result = export_review_docx(report, args.out)
    except ExportRefused as exc:
        print(exc.report(), file=sys.stderr)
        return EXIT_REFUSED
    except OSError as exc:
        print(f"DOSYA YAZILAMADI: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if not args.quiet:
        print(result.summary())
    return EXIT_OK


def _run_package_export(args: "argparse.Namespace") -> int:
    """The --package path: collex.matter-package/v1 -> ZIP (export.package)."""
    fmt = args.format or "dosya-paketi-zip"
    if fmt not in PACKAGE_FORMATS:
        print(
            f"--package yalnızca 'dosya-paketi-zip' biçimiyle kullanılabilir (verilen: {fmt})",
            file=sys.stderr,
        )
        return EXIT_USAGE

    from export.package import PackageFormatError, export_matter_package, load_plan

    try:
        plan = load_plan(args.package)
    except PackageFormatError as exc:
        print(f"GEÇERSİZ PAKET PLANI: {exc}", file=sys.stderr)
        return EXIT_USAGE

    try:
        result = export_matter_package(plan, args.out, generated_at=args.generated_at)
    except ExportRefused as exc:
        print(exc.report(), file=sys.stderr)
        return EXIT_REFUSED
    except OSError as exc:
        print(f"DOSYA YAZILAMADI: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if not args.quiet:
        print(result.summary())
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    given = [
        name
        for name in ("bundle", "draft", "audit", "review", "package")
        if getattr(args, name) is not None
    ]
    if len(given) != 1:
        print(
            "--bundle, --draft, --audit, --review veya --package seçeneklerinden tam"
            " olarak biri verilmelidir",
            file=sys.stderr,
        )
        return EXIT_USAGE

    if args.package is not None:
        return _run_package_export(args)

    if args.review is not None:
        return _run_review_export(args)

    if args.audit is not None:
        return _run_audit_export(args)

    if args.draft is not None:
        return _run_draft_export(args)

    fmt = _resolve_format(args.format, args.out)
    if fmt in DRAFT_FORMATS:
        print(f"'{fmt}' biçimi yalnızca --draft girdisiyle kullanılabilir", file=sys.stderr)
        return EXIT_USAGE
    if fmt in AUDIT_FORMATS:
        print(f"'{fmt}' biçimi yalnızca --audit girdisiyle kullanılabilir", file=sys.stderr)
        return EXIT_USAGE
    if fmt in REVIEW_FORMATS:
        print(f"'{fmt}' biçimi yalnızca --review girdisiyle kullanılabilir", file=sys.stderr)
        return EXIT_USAGE
    if fmt in PACKAGE_FORMATS:
        print(f"'{fmt}' biçimi yalnızca --package girdisiyle kullanılabilir", file=sys.stderr)
        return EXIT_USAGE

    try:
        bundle = load_bundle(args.bundle)
    except BundleFormatError as exc:
        print(f"GEÇERSİZ KANIT PAKETİ: {exc}", file=sys.stderr)
        return EXIT_USAGE

    try:
        if fmt == "docx":
            try:
                from export.bundle_docx import export_docx
            except ImportError as exc:  # pragma: no cover - depends on install
                print(
                    "DOCX çıktısı için python-docx gerekli."
                    " Kurulum: pip install '.[export]'"
                    f" (ayrıntı: {exc})",
                    file=sys.stderr,
                )
                return EXIT_USAGE
            result = export_docx(
                bundle, args.out, generated_at=args.generated_at
            )
        else:
            from export.bundle_markdown import export_markdown

            result = export_markdown(
                bundle, args.out, generated_at=args.generated_at
            )
    except ExportRefused as exc:
        print(exc.report(), file=sys.stderr)
        return EXIT_REFUSED
    except OSError as exc:
        print(f"DOSYA YAZILAMADI: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if not args.quiet:
        print(result.summary())
        for warning in result.verification.warnings:
            print(f"  {warning}")
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover - process entry point
    sys.exit(main())
