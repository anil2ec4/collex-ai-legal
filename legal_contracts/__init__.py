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
    classify_exception_chain,
    failure_marker,
    failure_fields,
    failure_from_marker,
    FAILURE_KIND_ERROR_NAMES,
    FAILURE_MARKER_RE,
    ProviderError,
    InvalidToolInput,
    UpstreamContractError,
    UpstreamNotFound,
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
    "classify_exception_chain",
    "failure_marker",
    "failure_fields",
    "failure_from_marker",
    "FAILURE_KIND_ERROR_NAMES",
    "FAILURE_MARKER_RE",
    "ProviderError",
    "InvalidToolInput",
    "UpstreamContractError",
    "UpstreamNotFound",
]
