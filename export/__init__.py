"""ColleX lawyer-facing export: evidence bundle -> reviewable deliverable.

The TypeScript answer pipeline emits a structured evidence bundle
(``collex.answer.evidence-bundle/v1``; see
``control-plane/src/answer/renderer.ts``). This package turns that bundle
into a document a Turkish lawyer can actually work with — a ``.docx`` for
Word/UYAP Editör round-trips, or plain Markdown — WITHOUT ever weakening the
evidence chain that makes the product worth anything.

Design rules (Master Build Brief 9.2, 9.4, 11.3, 11.5):

1. **An unverifiable export is worse than no export.** Every quote in the
   bundle is re-checked against the bundle's own hashes (and, when the bundle
   ships its canonical texts, against the code-point offsets too) BEFORE a
   single byte is written. One failure and nothing is written at all —
   :func:`export.verify.verify_bundle` / :class:`export.errors.ExportRefused`.
2. **No invented and no dropped citations.** Citation numbering is derived
   from the claims, every referenced evidence id must resolve, and the
   produced ``.docx`` is re-opened and re-parsed before it is moved into
   place: the citation markers in the answer body and the entries in the
   KAYNAKLAR appendix must be the same set, in both directions.
3. **Machine-generated, lawyer review mandatory.** Every page carries that
   footer (brief 11.5). The model never signs, never files to UYAP, never
   touches a PIN, token or private key, and never writes signed UDF.
4. **Synthetic data stays labelled.** When the bundle declares itself
   synthetic, every human-visible surface says ``SENTETİK`` (repo honesty
   rule; the local corpus under ``evals/fixtures/corpus`` is not real
   Turkish case law).

Import layering — deliberate: this module and everything it re-exports are
**standard-library only**, so ``import export`` works in a lean install of
the MCP server. ``python-docx`` is an OPTIONAL extra
(``pip install .[export]``) and is imported only inside
:mod:`export.bundle_docx`.
"""

from __future__ import annotations

from export.errors import BundleFormatError, ExportError, ExportRefused
from export.bundle import (
    BUNDLE_SCHEMA,
    ClaimEntry,
    Confidence,
    EvidenceBundle,
    EvidenceEntry,
    Locator,
    load_bundle,
    parse_bundle,
)
from export.plan import CitationPlan, build_citation_plan
from export.verify import (
    IntegrityFinding,
    VerificationReport,
    verify_bundle,
    verify_bundle_or_refuse,
)

__version__ = "1.0.0"

#: Identifier of the human-readable report layout produced by this package.
#: Bumped only when the section structure changes in a way a reader would
#: notice; recorded in every exported document's meta block.
REPORT_FORMAT = "collex.export.evidence-report/v1"

__all__ = [
    "BUNDLE_SCHEMA",
    "BundleFormatError",
    "CitationPlan",
    "ClaimEntry",
    "Confidence",
    "EvidenceBundle",
    "EvidenceEntry",
    "ExportError",
    "ExportRefused",
    "IntegrityFinding",
    "Locator",
    "REPORT_FORMAT",
    "VerificationReport",
    "__version__",
    "build_citation_plan",
    "load_bundle",
    "parse_bundle",
    "verify_bundle",
    "verify_bundle_or_refuse",
]
