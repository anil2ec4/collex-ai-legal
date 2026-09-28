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
import re
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


def _retry_after_ms_from_response(response: Any) -> Optional[int]:
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    try:
        raw = headers.get("Retry-After", "")
    except Exception:  # a foreign headers object; the hint is optional
        return None
    try:
        return int(float(raw) * 1000)
    except (TypeError, ValueError):
        return None


_RETRYABLE_KINDS = frozenset(
    {FailureKind.RATE_LIMITED, FailureKind.TIMEOUT, FailureKind.UNAVAILABLE}
)


class ProviderError(Exception):
    """A failure the gateway detected ITSELF, already typed.

    Raised (or recorded) where a client knows exactly what went wrong without
    an exception to classify — an input it refuses, a document the upstream
    says does not exist, a body that is not the documented shape. The message
    is AUTHORED here and is therefore safe to put on the wire; it must never
    be built from upstream or driver text. ``classify_exception`` returns the
    carried failure unchanged.
    """

    kind: FailureKind = FailureKind.UNAVAILABLE

    def __init__(
        self,
        safe_message: str,
        *,
        kind: Optional[FailureKind] = None,
        retryable: Optional[bool] = None,
        upstream_status: Optional[int] = None,
    ) -> None:
        super().__init__(safe_message)
        if kind is not None:
            self.kind = kind
        self.safe_message = safe_message
        self.retryable = (
            retryable if retryable is not None else self.kind in _RETRYABLE_KINDS
        )
        self.upstream_status = upstream_status

    def failure(self) -> ProviderFailure:
        return ProviderFailure(
            kind=self.kind,
            retryable=self.retryable,
            upstream_status=self.upstream_status,
            safe_message=self.safe_message,
        )


class InvalidToolInput(ProviderError, ValueError):
    """The caller's own argument was refused before any upstream call.

    A ``ValueError`` too, so existing ``except ValueError`` handlers still
    catch it; the control plane reads it as INVALID_REQUEST — the one kind
    that tells the lawyer the QUERY, not the source, needs changing.
    """

    kind = FailureKind.INVALID_REQUEST


class UpstreamContractError(ProviderError, ValueError):
    """The upstream answered, but not in the documented shape (PARSER_ERROR)."""

    kind = FailureKind.PARSER_ERROR


class UpstreamNotFound(ProviderError):
    """The upstream answered that the requested record does not exist."""

    kind = FailureKind.NOT_FOUND


TLS_CERTIFICATE_SAFE_MESSAGE = "Upstream TLS certificate could not be verified."

_CERT_VERIFY_WORDING = re.compile(r"CERTIFICATE_VERIFY_FAILED|certificate verify failed", re.IGNORECASE)


def _is_certificate_failure(exc: BaseException) -> bool:
    """True when the chain holds a TLS CERTIFICATE verification failure.

    Distinguished from "could not reach" because the fix is different: the
    host answered, but its certificate chain did not verify against the
    trust store (ColleX never turns verification off to get past it). The
    driver text is read here for classification only and never echoed.
    """
    seen: set[int] = set()
    current: Optional[BaseException] = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ssl.SSLCertVerificationError):
            return True
        if _CERT_VERIFY_WORDING.search(str(current) or ""):
            return True
        current = current.__cause__ or current.__context__
    return False


def _unreachable(exc: BaseException) -> ProviderFailure:
    """A transport failure: UNAVAILABLE, retryable; a certificate failure says so."""
    return ProviderFailure(
        kind=FailureKind.UNAVAILABLE,
        retryable=True,
        safe_message=(
            TLS_CERTIFICATE_SAFE_MESSAGE
            if _is_certificate_failure(exc)
            else "Could not reach the upstream service."
        ),
    )


def _failure_from_http_status(status: int, response: Any = None) -> ProviderFailure:
    """One status → kind table for httpx, httpx2 (openai) and friends."""
    if status == 429:
        return ProviderFailure(
            kind=FailureKind.RATE_LIMITED,
            retryable=True,
            retry_after_ms=_retry_after_ms_from_response(response),
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
    if status == 408:
        return ProviderFailure(
            kind=FailureKind.TIMEOUT,
            retryable=True,
            upstream_status=status,
            safe_message="Upstream timed out waiting for the request (HTTP 408).",
        )
    if status == 410:
        return ProviderFailure(
            kind=FailureKind.NOT_FOUND,
            retryable=False,
            upstream_status=status,
            safe_message="Requested resource is gone upstream (HTTP 410).",
        )
    if status in (400, 413, 414, 422):
        return ProviderFailure(
            kind=FailureKind.INVALID_REQUEST,
            retryable=False,
            upstream_status=status,
            safe_message=f"Upstream rejected the request (HTTP {status}).",
        )
    # Every other 4xx (405, 406, 409, 412, 415, 426, 428, 451, ...) is a rule
    # of the upstream's that this CLIENT does not meet - an access or contract
    # change on their side, not something the lawyer's query caused. 29.09.2026,
    # live: KİK answered 428 Precondition Required and the lawyer read "arama
    # isteği bu kaynak için geçersiz", i.e. "rephrase" - which no rephrasing
    # can fix (W22: an outage must never tell the lawyer to rephrase).
    return ProviderFailure(
        kind=FailureKind.UNAVAILABLE,
        retryable=False,
        upstream_status=status,
        safe_message=f"Upstream refused the request (HTTP {status}); its access rules may have changed.",
    )


def _classify_foreign_client_exception(exc: BaseException) -> Optional[ProviderFailure]:
    """SDK exceptions that are not ``httpx`` (the embedding lane's openai SDK).

    The openai SDK ships its own HTTP stack (``httpx2``), so its transport
    and status errors are NOT ``httpx`` instances and used to classify as
    "unexpected" — an OpenRouter outage then read like a server bug. Both
    packages are imported lazily; neither is a hard dependency here.
    """
    try:
        import openai  # type: ignore

        if isinstance(exc, openai.APITimeoutError):
            return ProviderFailure(
                kind=FailureKind.TIMEOUT,
                retryable=True,
                safe_message="Upstream request timed out.",
            )
        if isinstance(exc, openai.APIConnectionError):
            return _unreachable(exc)
        if isinstance(exc, openai.APIStatusError):
            return _failure_from_http_status(
                int(exc.status_code), getattr(exc, "response", None)
            )
    except ImportError:  # pragma: no cover - openai is optional
        pass
    try:
        import httpx2  # type: ignore

        if isinstance(exc, httpx2.TimeoutException):
            return ProviderFailure(
                kind=FailureKind.TIMEOUT,
                retryable=True,
                safe_message="Upstream request timed out.",
            )
        if isinstance(exc, httpx2.HTTPStatusError):
            return _failure_from_http_status(
                exc.response.status_code, exc.response
            )
        if isinstance(exc, httpx2.TransportError):
            return _unreachable(exc)
    except ImportError:  # pragma: no cover - httpx2 comes with openai only
        pass
    return None


def classify_exception(exc: BaseException) -> ProviderFailure:
    """Map an exception raised by a provider call to a ProviderFailure.

    Covers the gateway's own typed ``ProviderError``, httpx transport/status
    errors, the openai SDK's (httpx2) errors, JSON/pydantic parse errors, and
    the Bedesten limiter exceptions (imported lazily to keep this module free
    of gateway dependencies).
    """
    if isinstance(exc, ProviderError):
        return exc.failure()

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
        return _failure_from_http_status(exc.response.status_code, exc.response)

    foreign = _classify_foreign_client_exception(exc)
    if foreign is not None:
        return foreign

    if isinstance(exc, (httpx.ConnectError, httpx.NetworkError, httpx.TransportError)):
        return _unreachable(exc)

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
        return _unreachable(exc)

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


# The court facades' ``error`` names and default HTTP statuses per kind
# (mcp_server_main.bedesten_failure_fields has used them since W12).
FAILURE_KIND_ERROR_NAMES = {
    "RATE_LIMITED": ("rate_limit_exceeded", 429),
    "TIMEOUT": ("upstream_timeout", 504),
    "UNAVAILABLE": ("service_unavailable", 503),
    "PARSER_ERROR": ("upstream_parse_error", 502),
    "NOT_FOUND": ("not_found", 404),
    "UNAUTHORIZED": ("unauthorized", 401),
    "INVALID_REQUEST": ("invalid_request", 400),
}


def failure_fields(failure: ProviderFailure) -> dict:
    """The typed failure fields every structured tool payload carries.

    ``error`` / ``error_code`` / ``status_code`` / ``retry_after`` /
    ``retryable`` / ``message`` — the keys and meanings of the court
    facades, read by ONE reader in the control plane
    (control-plane/src/research/payloads.ts ``failureFromRecord``).
    ``message`` is the shared marker and never carries driver or upstream
    text.
    """
    kind = failure.kind.value
    error_name, default_status = FAILURE_KIND_ERROR_NAMES.get(
        kind, ("service_unavailable", 503)
    )
    if failure.retry_after_ms is not None:
        retry_after = failure.retry_after_ms / 1000.0
    else:
        retry_after = 30.0 if failure.retryable else 0.0
    return {
        "error": error_name,
        "error_code": kind,
        "status_code": failure.upstream_status or default_status,
        "retry_after": f"{retry_after:.1f}",
        "retryable": failure.retryable,
        "message": failure_marker(failure),
    }


FAILURE_MARKER_RE = re.compile(
    r"\b(" + "|".join(k.value for k in FailureKind) + r") retry_after=(\d+(?:\.\d+)?): ?"
)


def failure_from_marker(text: Optional[str]) -> Optional[ProviderFailure]:
    """Read back a ``failure_marker`` line (anywhere in ``text``).

    Used where a client could only hand a STRING across (an ``error_message``
    field) and the tool facade still owes the caller the typed fields. The
    retryable rule mirrors ``classifyFailureText`` in
    control-plane/src/gateway/failureText.ts: a transient kind is retryable,
    except UNAVAILABLE with ``retry_after=0.0`` (the unknown answer). Returns
    ``None`` when the text carries no marker.
    """
    if not text:
        return None
    match = FAILURE_MARKER_RE.search(text)
    if match is None:
        return None
    kind = FailureKind(match.group(1))
    seconds = float(match.group(2))
    retry_after_ms = int(round(seconds * 1000)) if seconds > 0 else None
    retryable = kind in _RETRYABLE_KINDS and (
        retry_after_ms is not None or kind is not FailureKind.UNAVAILABLE
    )
    message = text[match.end():].strip() or "Upstream failure."
    return ProviderFailure(
        kind=kind,
        retryable=retryable,
        retry_after_ms=retry_after_ms,
        safe_message=message,
    )
