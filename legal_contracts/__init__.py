"""Typed provider outcome contracts shared by the Python gateway layers.

Mirrors the TypeScript contract in ``control-plane/src/types.ts``: a small,
stable taxonomy of provider failures plus ok/partial/error outcome envelopes.
"""

from legal_contracts.outcomes import (
    FailureKind,
    ProviderFailure,
    OkOutcome,
    PartialOutcome,
    ErrorOutcome,
    ok,
    partial,
    error,
    classify_exception,
)

__all__ = [
    "FailureKind",
    "ProviderFailure",
    "OkOutcome",
    "PartialOutcome",
    "ErrorOutcome",
    "ok",
    "partial",
    "error",
    "classify_exception",
]
