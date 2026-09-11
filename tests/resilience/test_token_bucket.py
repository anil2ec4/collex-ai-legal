"""Token bucket behaviour + Retry-After parsing (numeric, HTTP-date, fallback)."""

import time
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest

from bedesten_rate_limit import (
    BedestenRateLimited,
    BedestenRateLimiter,
    _TokenBucket,
    _parse_retry_after,
)


async def test_second_immediate_acquire_raises_local_rate_limit():
    bucket = _TokenBucket(capacity=1, refill_per_s=1.0)
    await bucket.acquire(max_wait=0.01)
    with pytest.raises(BedestenRateLimited) as exc_info:
        await bucket.acquire(max_wait=0.01)
    assert exc_info.value.source == "local"
    assert exc_info.value.retry_after > 0


async def test_pause_is_honored():
    bucket = _TokenBucket(capacity=1, refill_per_s=100.0)
    bucket.pause(0.05)
    # Within the pause window a short max_wait must fail fast.
    with pytest.raises(BedestenRateLimited):
        await bucket.acquire(max_wait=0.01)
    # With enough patience the acquire succeeds only after the pause elapses.
    start = time.monotonic()
    await bucket.acquire(max_wait=1.0)
    assert time.monotonic() - start >= 0.04


def test_retry_after_numeric_seconds():
    limiter = BedestenRateLimiter()
    response = httpx.Response(429, headers={"Retry-After": "7"})
    exc = limiter.from_429(response, "test-op")
    assert exc.source == "upstream"
    assert exc.retry_after == pytest.approx(7.5)


def test_retry_after_http_date():
    limiter = BedestenRateLimiter()
    dt = datetime.now(timezone.utc) + timedelta(seconds=10)
    response = httpx.Response(
        429, headers={"Retry-After": format_datetime(dt, usegmt=True)}
    )
    exc = limiter.from_429(response, "test-op")
    # HTTP-dates have one-second resolution; allow generous slack.
    assert 8.0 <= exc.retry_after <= 12.0


def test_retry_after_http_date_in_past_clamps_to_minimum():
    limiter = BedestenRateLimiter()
    dt = datetime.now(timezone.utc) - timedelta(seconds=30)
    response = httpx.Response(
        429, headers={"Retry-After": format_datetime(dt, usegmt=True)}
    )
    exc = limiter.from_429(response, "test-op")
    assert exc.retry_after == pytest.approx(1.5)


def test_retry_after_garbage_falls_back_to_30():
    limiter = BedestenRateLimiter()
    response = httpx.Response(429, headers={"Retry-After": "not-a-date"})
    exc = limiter.from_429(response, "test-op")
    assert exc.retry_after == pytest.approx(30.5)


def test_retry_after_missing_header_falls_back_to_30():
    limiter = BedestenRateLimiter()
    exc = limiter.from_429(httpx.Response(429), "test-op")
    assert exc.retry_after == pytest.approx(30.5)


def test_parse_retry_after_helper():
    assert _parse_retry_after("") is None
    assert _parse_retry_after("12") == pytest.approx(12.0)
    assert _parse_retry_after("garbage") is None
    future = datetime.now(timezone.utc) + timedelta(seconds=42)
    parsed = _parse_retry_after(format_datetime(future, usegmt=True))
    assert parsed is not None
    assert 40.0 <= parsed <= 43.0
