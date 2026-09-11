"""Export error taxonomy.

Two distinct failure modes, because they mean very different things to a
lawyer and therefore get different CLI exit codes:

``BundleFormatError`` (exit 1)
    The input is not a well-formed ``collex.answer.evidence-bundle/v1``.
    Nothing was even attempted; this is an integration bug upstream.

``ExportRefused`` (exit 2)
    The bundle parsed, but its own integrity claims do not hold — a quote
    does not hash to its recorded ``quoteSha256``, an offset span does not
    match its quote, a claim cites an evidence id that is not in the bundle,
    or the written document's citations did not round-trip. The export is
    ABORTED and no file is left behind. This is the whole point of the
    product: an unverifiable export is worse than none.
"""

from __future__ import annotations

from typing import Sequence


class ExportError(Exception):
    """Base class for every error raised by :mod:`export`."""


class BundleFormatError(ExportError):
    """The input JSON is not a valid evidence bundle."""


class ExportRefused(ExportError):
    """Integrity check failed; the export was aborted on purpose."""

    def __init__(self, message: str, findings: Sequence[object] = ()) -> None:
        super().__init__(message)
        self.message = message
        #: :class:`export.verify.IntegrityFinding` values, when available.
        self.findings = tuple(findings)

    def report(self) -> str:
        """Multi-line Turkish operator-facing explanation."""
        lines = [f"DIŞA AKTARMA REDDEDİLDİ: {self.message}"]
        for finding in self.findings:
            lines.append(f"  - {finding}")
        lines.append(
            "  Doğrulanamayan bir kanıt paketi hiç dışa aktarılmaz;"
            " hatalı belge, belge olmamasından daha kötüdür."
        )
        return "\n".join(lines)
