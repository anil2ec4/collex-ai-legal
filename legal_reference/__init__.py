"""Turkish legal reference parsing and amendment target resolution.

This package is self-contained (no MCP server imports, no network access):

- ``normalize``: search-side Turkish text normalization (never mutates originals),
- ``abbreviations``: authoritative TCK/TBK/İİK/... -> (law no, name, mülga) table,
- ``parser``: exact reference parser (law no, abbreviation, article + fıkra/bent,
  court decision + chamber, RG),
- ``resolver``: amendment -> target legislation resolver with an injected
  ``SearchPort`` so lookups can run against any backend (or a fake in tests).

The parser is mirrored by ``control-plane/src/retrieval/referenceParser.ts``;
``evals/fixtures/reference_parity.json`` pins the two implementations against
one another in CI (see ``tests/contracts/test_parser_parity.py``).
"""

from .abbreviations import (
    ABBREVIATIONS,
    LawAbbreviation,
    lookup_abbreviation,
    lookup_by_number,
)
from .normalize import normalize_turkish_search
from .parser import ParsedReference, parse_references
from .resolver import (
    AmendmentTargetResolver,
    CandidateLaw,
    ConfidenceComponents,
    ResolverResult,
    ScoredCandidate,
    SearchPort,
    TargetResolution,
)

__all__ = [
    "ABBREVIATIONS",
    "LawAbbreviation",
    "lookup_abbreviation",
    "lookup_by_number",
    "normalize_turkish_search",
    "ParsedReference",
    "parse_references",
    "AmendmentTargetResolver",
    "CandidateLaw",
    "ConfidenceComponents",
    "ResolverResult",
    "ScoredCandidate",
    "SearchPort",
    "TargetResolution",
]
