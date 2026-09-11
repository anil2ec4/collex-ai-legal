"""What a successful export reports back to its caller."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from export import text as T
from export.verify import VerificationReport


@dataclass(frozen=True)
class ExportResult:
    """Outcome of a completed export. Only ever built AFTER verification."""

    path: Path
    format: str
    #: Number of KAYNAKLAR entries written (0 for an honest abstention).
    citation_count: int
    #: Sources present in the bundle but cited by no claim.
    uncited_count: int
    verification: VerificationReport
    synthetic: bool

    def summary(self) -> str:
        parts = [
            f"{self.format.upper()} yazıldı: {self.path}",
            f"atıf: {self.citation_count}",
            f"bütünlük: {self.verification.summary()}",
        ]
        if self.uncited_count:
            parts.append(f"atıfsız kaynak: {self.uncited_count}")
        if self.synthetic:
            parts.append(T.SYNTHETIC_FOOTER_TAG)
        return " | ".join(parts)
