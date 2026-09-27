"""Typed error taxonomy and outcome envelopes for provider gateways.

This module mirrors the TypeScript contract used by the control plane:

* ``FailureKind`` — closed enum of provider failure classes.
* ``ProviderFailure`` — machine-readable failure record safe to surface to
  clients (``safe_message`` must never contain secrets or raw HTML).
* ``OkOutcome`` / ``PartialOutcome`` / ``ErrorOutcome`` — result envelopes
  carrying ``provider``, ``observed_at`` (ISO 8601 UTC) and ``warnings``.
* ``classify_exception`` — maps httpx (and Bedesten limiter) exceptions to a
  ``ProviderFailure`` so every gateway reports failures uniformly.
"""

from __future__ import annotations

import json
import socket
import ssl
from datetime import datetime, timezone
from enum import Enum
from typing import Any, List, Literal, Optional
from uuid import uuid4

import httpx
from pydantic import BaseModel, Field, ValidationError


class FailureKind(str, Enum):
    """Closed taxonomy of provider failure classes."""

    RATE_LIMITED = "RATE_LIMITED"
    TIMEOUT = "TIMEOUT"
    UNAVAILABLE = "UNAVAILABLE"
    INVALID_REQUEST = "INVALID_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    PARSER_ERROR = "PARSER_ERROR"
    NOT_FOUND = "NOT_FOUND"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_correlation_id() -> str:
    return uuid4().hex


class ProviderFailure(BaseModel):
    """Machine-readable description of one upstream failure."""

    kind: FailureKind
    retryable: bool
    retry_after_ms: Optional[int] = Field(
        None, description="Suggested wait before retrying, in milliseconds."
    )
    upstream_status: Optional[int] = Field(
        None, description="Upstream HTTP status code, when one was received."
    )
    correlation_id: str = Field(default_factory=_new_correlation_id)
    safe_message: str = Field(
        ..., description="Human-readable message safe to show to end users."
    )


class _OutcomeBase(BaseModel):
    provider: str
    observed_at: str = Field(default_factory=_utc_now_iso)
    warnings: List[str] = Field(default_factory=list)


class OkOutcome(_OutcomeBase):
    """Complete success."""

    status: Literal["ok"] = "ok"
    data: Any = None


class PartialOutcome(_OutcomeBase):
    """Some data was produced, but at least one sub-operation failed."""

    status: Literal["partial"] = "partial"
    data: Any = None
    failure: Optional[ProviderFailure] = None


class ErrorOutcome(_OutcomeBase):
    """No usable data; the failure explains why."""

    status: Literal["error"] = "error"
    failure: ProviderFailure


def ok(provider: str, data: Any = None, warnings: Optional[List[str]] = None) -> OkOutcome:
    return OkOutcome(provider=provider, data=data, warnings=warnings or [])


def partial(
    provider: str,
    data: Any = None,
    failure: Optional[ProviderFailure] = None,
    warnings: Optional[List[str]] = None,
) -> PartialOutcome:
    return PartialOutcome(
        provider=provider, data=data, failure=failure, warnings=warnings or []
    )


def error(
    provider: str,
    failure: ProviderFailure,
    warnings: Optional[List[str]] = None,
) -> ErrorOutcome:
    return ErrorOutcome(provider=provider, failure=failure, warnings=warnings or [])


def _retry_after_ms_from_response(response: httpx.Response) -> Optional[int]:
    raw = response.headers.get("Retry-After", "")
    try:
        return int(float(raw) * 1000)
    except (TypeError, ValueError):
        return None


def classify_exception(exc: BaseException) -> ProviderFailure:
    """Map an exception raised by a provider call to a ProviderFailure.

    Covers httpx transport/status errors, JSON/pydantic parse errors, and the
    Bedesten limiter exceptions (imported lazily to keep this module free of
    gateway dependencies).
    """
    # Bedesten limiter exceptions (lazy import; no hard dependency).
    try:
        from bedesten_rate_limit import BedestenCircuitOpen, BedestenRateLimited

        if isinstance(exc, BedestenRateLimited):
            return ProviderFailure(
                kind=FailureKind.RATE_LIMITED,
                retryable=True,
                retry_after_ms=int(exc.retry_after * 1000),
                upstream_status=429 if exc.source == "upstream" else None,
                safe_message=(
                    f"Rate limited; retry after {exc.retry_after:.1f} seconds."
                ),
            )
        if isinstance(exc, BedestenCircuitOpen):
            return ProviderFailure(
                kind=FailureKind.UNAVAILABLE,
                retryable=True,
                retry_after_ms=int(exc.retry_after * 1000),
                safe_message=(
                    "Upstream temporarily unavailable (circuit open); "
                    f"retry after {exc.retry_after:.1f} seconds."
                ),
            )
    except ImportError:  # pragma: no cover - bedesten module always present here
        pass

    if isinstance(exc, httpx.TimeoutException):
        return ProviderFailure(
            kind=FailureKind.TIMEOUT,
            retryable=True,
            safe_message="Upstream request timed out.",
        )

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 429:
            return ProviderFailure(
                kind=FailureKind.RATE_LIMITED,
                retryable=True,
                retry_after_ms=_retry_after_ms_from_response(exc.response),
                upstream_status=status,
                safe_message="Upstream rate limit exceeded.",
            )
        if status == 404:
            return ProviderFailure(
                kind=FailureKind.NOT_FOUND,
                retryable=False,
                upstream_status=status,
                safe_message="Requested resource was not found upstream.",
            )
        if status in (401, 403):
            return ProviderFailure(
                kind=FailureKind.UNAUTHORIZED,
                retryable=False,
                upstream_status=status,
                safe_message="Upstream rejected the request as unauthorized.",
            )
        if status >= 500:
            return ProviderFailure(
                kind=FailureKind.UNAVAILABLE,
                retryable=True,
                upstream_status=status,
                safe_message=f"Upstream server error (HTTP {status}).",
            )
        return ProviderFailure(
            kind=FailureKind.INVALID_REQUEST,
            retryable=False,
            upstream_status=status,
            safe_message=f"Upstream rejected the request (HTTP {status}).",
        )

    if isinstance(exc, (httpx.ConnectError, httpx.NetworkError, httpx.TransportError)):
        return ProviderFailure(
            kind=FailureKind.UNAVAILABLE,
            retryable=True,
            safe_message="Could not reach the upstream service.",
        )

    if isinstance(exc, (json.JSONDecodeError, UnicodeDecodeError, ValidationError)):
        return ProviderFailure(
            kind=FailureKind.PARSER_ERROR,
            retryable=False,
            safe_message="Upstream response could not be parsed.",
        )

    # Standard-library transport failures (a client that does not use httpx,
    # or a TLS/DNS failure raised below it). TimeoutError also covers
    # asyncio.TimeoutError on Python 3.11+.
    if isinstance(exc, TimeoutError):
        return ProviderFailure(
            kind=FailureKind.TIMEOUT,
            retryable=True,
            safe_message="Upstream request timed out.",
        )
    if isinstance(exc, (ssl.SSLError, ConnectionError, socket.gaierror)):
        return ProviderFailure(
            kind=FailureKind.UNAVAILABLE,
            retryable=True,
            safe_message="Could not reach the upstream service.",
        )

    # Unknown failure: treat as non-retryable unavailability without leaking
    # internal details into the safe message.
    return ProviderFailure(
        kind=FailureKind.UNAVAILABLE,
        retryable=False,
        safe_message=_UNKNOWN_FAILURE_MESSAGE,
    )


_UNKNOWN_FAILURE_MESSAGE = "Unexpected upstream failure."


def classify_exception_chain(exc: BaseException) -> ProviderFailure:
    """``classify_exception`` that looks THROUGH wrapper exceptions.

    Several provider clients re-wrap the real cause
    (``raise Exception(f"Failed to search ...: {e}")`` inside an ``except``),
    which hides an ``httpx.ConnectError`` behind a bare ``Exception`` and made
    an unreachable source classify as "unexpected". The chain
    (``__cause__``, else the implicit ``__context__``) is walked until a link
    classifies as something KNOWN; only when no link does is the unknown
    answer returned. The safe message never carries the wrapper's text.
    """
    seen: set[int] = set()
    current: Optional[BaseException] = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        failure = classify_exception(current)
        if failure.safe_message != _UNKNOWN_FAILURE_MESSAGE:
            return failure
        current = current.__cause__ or current.__context__
    return classify_exception(exc)


def failure_marker(failure: ProviderFailure) -> str:
    """The machine-parseable failure line every gateway lane shares.

    ``"<KIND> retry_after=N.N: <safe message>"`` — the prefix the Bedesten and
    legislation lanes already emit, read by the control plane's
    ``classifyFailureText`` (control-plane/src/gateway/failureText.ts). A
    retryable failure without an upstream hint suggests 30 s, a
    non-retryable one 0 s (the same defaults as ``bedesten_failure_fields``).
    """
    if failure.retry_after_ms is not None:
        retry_after = failure.retry_after_ms / 1000.0
    else:
        retry_after = 30.0 if failure.retryable else 0.0
    return f"{failure.kind.value} retry_after={retry_after:.1f}: {failure.safe_message}"
