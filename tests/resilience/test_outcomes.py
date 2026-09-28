"""legal_contracts: FailureKind taxonomy, outcome envelopes, classifier."""

import json
from datetime import datetime

import httpx
import pytest

from bedesten_rate_limit import BedestenCircuitOpen, BedestenRateLimited
from legal_contracts import (
    ErrorOutcome,
    FailureKind,
    OkOutcome,
    PartialOutcome,
    ProviderFailure,
    classify_exception,
    error,
    ok,
    partial,
)


def _status_error(status: int, headers=None) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://bedesten.adalet.gov.tr/mevzuat/searchDocuments")
    response = httpx.Response(status, request=request, headers=headers or {})
    return httpx.HTTPStatusError("boom", request=request, response=response)


def test_failure_kind_enum_is_complete():
    assert {kind.value for kind in FailureKind} == {
        "RATE_LIMITED",
        "TIMEOUT",
        "UNAVAILABLE",
        "INVALID_REQUEST",
        "UNAUTHORIZED",
        "PARSER_ERROR",
        "NOT_FOUND",
    }


def test_outcome_envelopes_carry_provider_observed_at_warnings():
    ok_outcome = ok("bedesten", data={"x": 1}, warnings=["w1"])
    assert isinstance(ok_outcome, OkOutcome)
    assert ok_outcome.status == "ok"
    assert ok_outcome.provider == "bedesten"
    assert ok_outcome.warnings == ["w1"]
    # observed_at must be parseable ISO 8601.
    datetime.fromisoformat(ok_outcome.observed_at)

    failure = ProviderFailure(
        kind=FailureKind.TIMEOUT, retryable=True, safe_message="timed out"
    )
    partial_outcome = partial("bedesten", data=[1], failure=failure)
    assert isinstance(partial_outcome, PartialOutcome)
    assert partial_outcome.status == "partial"
    assert partial_outcome.failure.kind is FailureKind.TIMEOUT

    error_outcome = error("bedesten", failure)
    assert isinstance(error_outcome, ErrorOutcome)
    assert error_outcome.status == "error"
    assert error_outcome.failure.correlation_id


def test_classifier_timeout():
    failure = classify_exception(httpx.ConnectTimeout("slow"))
    assert failure.kind is FailureKind.TIMEOUT
    assert failure.retryable is True


def test_classifier_http_status_codes():
    f429 = classify_exception(_status_error(429, headers={"Retry-After": "2"}))
    assert f429.kind is FailureKind.RATE_LIMITED
    assert f429.retryable is True
    assert f429.retry_after_ms == 2000
    assert f429.upstream_status == 429

    f500 = classify_exception(_status_error(500))
    assert f500.kind is FailureKind.UNAVAILABLE
    assert f500.retryable is True

    f404 = classify_exception(_status_error(404))
    assert f404.kind is FailureKind.NOT_FOUND
    assert f404.retryable is False

    for status in (401, 403):
        failure = classify_exception(_status_error(status))
        assert failure.kind is FailureKind.UNAUTHORIZED
        assert failure.retryable is False

    f400 = classify_exception(_status_error(400))
    assert f400.kind is FailureKind.INVALID_REQUEST


def test_an_upstream_access_rule_is_not_the_lawyers_query():
    # 29.09.2026, live: KİK answered 428 Precondition Required and the report
    # told the lawyer the query was invalid. No rephrasing fixes that.
    for status in (405, 406, 409, 412, 426, 428, 451):
        failure = classify_exception(_status_error(status))
        assert failure.kind is FailureKind.UNAVAILABLE, status
        assert failure.retryable is False, status
        assert failure.upstream_status == status
    for status in (400, 413, 414, 422):
        assert classify_exception(_status_error(status)).kind is FailureKind.INVALID_REQUEST, status
    f408 = classify_exception(_status_error(408))
    assert f408.kind is FailureKind.TIMEOUT and f408.retryable is True
    assert classify_exception(_status_error(410)).kind is FailureKind.NOT_FOUND


def test_classifier_connect_error_and_parse_error():
    unavailable = classify_exception(httpx.ConnectError("refused"))
    assert unavailable.kind is FailureKind.UNAVAILABLE
    assert unavailable.retryable is True

    try:
        json.loads("<html>")
    except json.JSONDecodeError as exc:
        parse_failure = classify_exception(exc)
    assert parse_failure.kind is FailureKind.PARSER_ERROR
    assert parse_failure.retryable is False


def test_classifier_bedesten_limiter_exceptions():
    limited = classify_exception(BedestenRateLimited(2.0, source="upstream"))
    assert limited.kind is FailureKind.RATE_LIMITED
    assert limited.retry_after_ms == 2000
    assert limited.upstream_status == 429

    open_failure = classify_exception(BedestenCircuitOpen("search", 12.0))
    assert open_failure.kind is FailureKind.UNAVAILABLE
    assert open_failure.retryable is True
    assert open_failure.retry_after_ms == 12000


def test_classifier_unknown_exception_is_safe():
    failure = classify_exception(RuntimeError("secret internals"))
    assert failure.kind is FailureKind.UNAVAILABLE
    assert "secret" not in failure.safe_message


def test_chain_classifier_looks_through_a_wrapper():
    """BTK's client re-wraps: ``raise Exception(f"Failed ...: {e}")``."""
    from legal_contracts import classify_exception_chain

    try:
        try:
            raise httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] boom")
        except Exception as inner:
            raise Exception(f"Failed to search BTK decisions: {inner}")
    except Exception as caught:
        wrapped = caught
    failure = classify_exception_chain(wrapped)
    assert failure.kind is FailureKind.UNAVAILABLE
    assert failure.retryable is True
    assert "SSL" not in failure.safe_message
    # the plain classifier still reports the wrapper as unknown
    assert classify_exception(wrapped).retryable is False


def test_chain_classifier_keeps_unknown_when_nothing_is_known():
    from legal_contracts import classify_exception_chain

    failure = classify_exception_chain(RuntimeError("secret internals"))
    assert failure.kind is FailureKind.UNAVAILABLE
    assert failure.retryable is False
    assert "secret" not in failure.safe_message


def test_failure_marker_is_the_shared_machine_prefix():
    from legal_contracts import classify_exception_chain, failure_marker

    assert failure_marker(classify_exception_chain(httpx.ConnectError("x"))) == (
        "UNAVAILABLE retry_after=30.0: Could not reach the upstream service."
    )
    assert failure_marker(classify_exception_chain(RuntimeError("x"))) == (
        "UNAVAILABLE retry_after=0.0: Unexpected upstream failure."
    )
    assert failure_marker(classify_exception(TimeoutError())).startswith(
        "TIMEOUT retry_after=30.0: "
    )
