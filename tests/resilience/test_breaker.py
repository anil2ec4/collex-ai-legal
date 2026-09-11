"""Circuit breaker: opens on failures, half-open probe, 429 never trips it.

The breaker takes an injectable clock, so no test sleeps for the 30s open
window — a FakeClock advances time instantly.
"""

import time

import httpx
import pytest

from bedesten_rate_limit import (
    BedestenCircuitOpen,
    BedestenRateLimited,
    BedestenRateLimiter,
    _TokenBucket,
)


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeClient:
    """Duck-typed httpx.AsyncClient: pops one scripted outcome per post."""

    def __init__(self, outcomes) -> None:
        self.outcomes = list(outcomes)
        self.calls = 0

    async def post(self, url, **kwargs):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def make_limiter(clock) -> BedestenRateLimiter:
    limiter = BedestenRateLimiter(clock=clock)
    # Instant token bucket so only breaker behaviour is measured.
    limiter._bucket = _TokenBucket(capacity=1000, refill_per_s=100000.0)
    return limiter


async def _fail_n_times(limiter, client, n, exc_type, endpoint="/searchDocuments"):
    for _ in range(n):
        with pytest.raises(exc_type):
            await limiter.post(client, endpoint, "test-op")


async def test_eight_connect_errors_open_the_breaker_and_fail_fast():
    clock = FakeClock()
    limiter = make_limiter(clock)
    client = FakeClient([httpx.ConnectError("boom")] * 8)

    await _fail_n_times(limiter, client, 8, httpx.ConnectError)

    snapshot = limiter.get_state()["breakers"]["search"]
    assert snapshot["state"] == "OPEN"

    # While OPEN the call fails fast, without touching the network.
    start = time.monotonic()
    with pytest.raises(BedestenCircuitOpen) as exc_info:
        await limiter.post(client, "/searchDocuments", "test-op")
    assert time.monotonic() - start < 0.5
    assert client.calls == 8
    assert exc_info.value.retry_after > 0
    assert exc_info.value.endpoint_class == "search"


async def test_timeouts_and_5xx_count_as_breaker_failures():
    clock = FakeClock()
    limiter = make_limiter(clock)
    # 4 timeouts + 4 server errors = 8 failures in the window.
    client = FakeClient(
        [httpx.ReadTimeout("slow")] * 4 + [httpx.Response(500)] * 4
    )
    await _fail_n_times(limiter, client, 4, httpx.ReadTimeout)
    for _ in range(4):
        response = await limiter.post(client, "/searchDocuments", "test-op")
        assert response.status_code == 500  # returned; caller raises for status
    assert limiter.get_state()["breakers"]["search"]["state"] == "OPEN"


async def test_half_open_probe_success_closes_the_breaker():
    clock = FakeClock()
    limiter = make_limiter(clock)
    failing = FakeClient([httpx.ConnectError("boom")] * 8)
    await _fail_n_times(limiter, failing, 8, httpx.ConnectError)
    assert limiter.get_state()["breakers"]["search"]["state"] == "OPEN"

    # Still open before the 30s window elapses.
    clock.advance(29.0)
    with pytest.raises(BedestenCircuitOpen):
        await limiter.post(failing, "/searchDocuments", "test-op")

    # After 30s one HALF_OPEN probe is admitted; success closes the breaker.
    clock.advance(1.1)
    ok_client = FakeClient([httpx.Response(200), httpx.Response(200)])
    response = await limiter.post(ok_client, "/searchDocuments", "test-op")
    assert response.status_code == 200
    assert limiter.get_state()["breakers"]["search"]["state"] == "CLOSED"

    # Follow-up requests flow normally.
    response = await limiter.post(ok_client, "/searchDocuments", "test-op")
    assert response.status_code == 200


async def test_half_open_probe_failure_reopens_the_breaker():
    clock = FakeClock()
    limiter = make_limiter(clock)
    failing = FakeClient([httpx.ConnectError("boom")] * 9)
    await _fail_n_times(limiter, failing, 8, httpx.ConnectError)

    clock.advance(30.1)
    # The probe itself fails -> straight back to OPEN for another window.
    with pytest.raises(httpx.ConnectError):
        await limiter.post(failing, "/searchDocuments", "test-op")
    assert limiter.get_state()["breakers"]["search"]["state"] == "OPEN"
    with pytest.raises(BedestenCircuitOpen):
        await limiter.post(failing, "/searchDocuments", "test-op")


async def test_429_does_not_trip_the_breaker():
    clock = FakeClock()
    limiter = make_limiter(clock)
    # Neutralize the 429 pause so this test does not sleep.
    limiter._bucket.pause = lambda seconds: None
    responses = [httpx.Response(429, headers={"Retry-After": "1"})] * 12
    client = FakeClient(responses)

    # Each post consumes two 429s (initial + single retry) -> 6 posts = 12.
    for _ in range(6):
        with pytest.raises(BedestenRateLimited):
            await limiter.post(client, "/searchDocuments", "test-op")

    snapshot = limiter.get_state()["breakers"]["search"]
    assert snapshot["state"] == "CLOSED"
    assert snapshot["window_failures"] == 0


async def test_breaker_is_keyed_per_endpoint_class():
    clock = FakeClock()
    limiter = make_limiter(clock)
    failing = FakeClient([httpx.ConnectError("boom")] * 8)
    await _fail_n_times(
        limiter, failing, 8, httpx.ConnectError, endpoint="/getDocumentContent"
    )
    breakers = limiter.get_state()["breakers"]
    assert breakers["document"]["state"] == "OPEN"

    # The search failure-domain is unaffected.
    ok_client = FakeClient([httpx.Response(200)])
    response = await limiter.post(ok_client, "/searchDocuments", "test-op")
    assert response.status_code == 200
    assert limiter.get_state()["breakers"]["search"]["state"] == "CLOSED"


async def test_get_state_exposes_bucket_and_breaker_diagnostics():
    clock = FakeClock()
    limiter = make_limiter(clock)
    ok_client = FakeClient([httpx.Response(200)])
    await limiter.post(ok_client, "/searchDocuments", "test-op")

    state = limiter.get_state()
    assert set(state) >= {"bucket", "max_wait_s", "bulkhead_max_concurrent", "breakers"}
    assert state["bucket"]["capacity"] > 0
    assert "tokens" in state["bucket"]
    assert "not_before_in_s" in state["bucket"]
    assert state["breakers"]["search"]["state"] == "CLOSED"
