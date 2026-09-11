"""Stale in-flight outcomes must not corrupt the HALF_OPEN probe.

Upstream client timeouts are 30-60s while the breaker's open window is 30s, so
a request admitted while the breaker was CLOSED routinely lands its outcome
during HALF_OPEN.  Before the epoch fix:

* a stale FAILURE re-tripped the breaker with a fresh window, and the real
  probe's success became a no-op (recovery delayed a full extra window);
* a stale SUCCESS closed the breaker while the real probe was still in flight.

Each admission now carries the breaker's state generation, and only the call
actually admitted as the probe may resolve a HALF_OPEN state.
"""

import asyncio

import httpx
import pytest

from bedesten_rate_limit import (
    BedestenCircuitOpen,
    BedestenRateLimiter,
    _TokenBucket,
)

ENDPOINT = "/searchDocuments"


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class ScriptedClient:
    """Pops one scripted outcome per post (exception instance or Response)."""

    def __init__(self, outcomes) -> None:
        self.outcomes = list(outcomes)
        self.calls = 0

    async def post(self, url, **kwargs):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class GatedClient:
    """Blocks inside post() until released, then applies a scripted outcome.

    ``admitted`` is set as soon as the request has passed breaker + bulkhead +
    bucket, which is exactly the moment its admission epoch is fixed.
    """

    def __init__(self, outcome) -> None:
        self.outcome = outcome
        self.admitted = asyncio.Event()
        self.release = asyncio.Event()

    async def post(self, url, **kwargs):
        self.admitted.set()
        await self.release.wait()
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def make_limiter(clock) -> BedestenRateLimiter:
    limiter = BedestenRateLimiter(clock=clock)
    # Instant token bucket so only breaker behaviour is measured.
    limiter._bucket = _TokenBucket(capacity=1000, refill_per_s=100000.0)
    return limiter


async def _trip_breaker(limiter) -> None:
    failing = ScriptedClient([httpx.ConnectError("boom")] * 8)
    for _ in range(8):
        with pytest.raises(httpx.ConnectError):
            await limiter.post(failing, ENDPOINT, "storm")
    assert limiter.get_state()["breakers"]["search"]["state"] == "OPEN"


async def test_stale_failure_does_not_re_trip_and_probe_still_recovers():
    """Reviewer repro: stale ReadTimeout lands during the HALF_OPEN probe."""
    clock = FakeClock()
    limiter = make_limiter(clock)

    # A request admitted while the breaker is CLOSED, still in flight.
    stale = GatedClient(httpx.ReadTimeout("stale in-flight timeout"))
    stale_task = asyncio.create_task(limiter.post(stale, ENDPOINT, "stale"))
    await asyncio.wait_for(stale.admitted.wait(), timeout=2.0)

    # 8 connect errors trip the breaker; the stale request is unaffected.
    await _trip_breaker(limiter)

    # The open window elapses and one probe is admitted.
    clock.advance(30.1)
    probe = GatedClient(httpx.Response(200))
    probe_task = asyncio.create_task(limiter.post(probe, ENDPOINT, "probe"))
    await asyncio.wait_for(probe.admitted.wait(), timeout=2.0)
    assert limiter.get_state()["breakers"]["search"]["state"] == "HALF_OPEN"

    # The stale failure lands *during* HALF_OPEN. It must be discarded.
    stale.release.set()
    with pytest.raises(httpx.ReadTimeout):
        await asyncio.wait_for(stale_task, timeout=2.0)
    assert limiter.get_state()["breakers"]["search"]["state"] == "HALF_OPEN"

    # The real probe's success closes the breaker (no extra open window).
    probe.release.set()
    response = await asyncio.wait_for(probe_task, timeout=2.0)
    assert response.status_code == 200
    assert limiter.get_state()["breakers"]["search"]["state"] == "CLOSED"

    # Traffic flows again immediately, without advancing the clock further.
    ok_client = ScriptedClient([httpx.Response(200)])
    assert (await limiter.post(ok_client, ENDPOINT, "after")).status_code == 200


async def test_stale_success_does_not_close_the_breaker_behind_the_probe():
    clock = FakeClock()
    limiter = make_limiter(clock)

    stale = GatedClient(httpx.Response(200))
    stale_task = asyncio.create_task(limiter.post(stale, ENDPOINT, "stale"))
    await asyncio.wait_for(stale.admitted.wait(), timeout=2.0)

    await _trip_breaker(limiter)

    clock.advance(30.1)
    probe = GatedClient(httpx.ConnectError("still down"))
    probe_task = asyncio.create_task(limiter.post(probe, ENDPOINT, "probe"))
    await asyncio.wait_for(probe.admitted.wait(), timeout=2.0)

    # A stale 200 from the CLOSED epoch must NOT declare the upstream healthy.
    stale.release.set()
    assert (await asyncio.wait_for(stale_task, timeout=2.0)).status_code == 200
    assert limiter.get_state()["breakers"]["search"]["state"] == "HALF_OPEN"

    # Only the probe decides: it fails, so the breaker re-opens.
    probe.release.set()
    with pytest.raises(httpx.ConnectError):
        await asyncio.wait_for(probe_task, timeout=2.0)
    assert limiter.get_state()["breakers"]["search"]["state"] == "OPEN"
    with pytest.raises(BedestenCircuitOpen):
        await limiter.post(ScriptedClient([]), ENDPOINT, "blocked")


async def test_stale_outcome_after_recovery_cannot_pollute_the_new_window():
    """A CLOSED-epoch failure landing after recovery is dropped, not counted."""
    clock = FakeClock()
    limiter = make_limiter(clock)

    stale = GatedClient(httpx.ConnectError("very late"))
    stale_task = asyncio.create_task(limiter.post(stale, ENDPOINT, "stale"))
    await asyncio.wait_for(stale.admitted.wait(), timeout=2.0)

    await _trip_breaker(limiter)
    clock.advance(30.1)

    # Probe succeeds -> CLOSED with a cleared window.
    ok_client = ScriptedClient([httpx.Response(200)])
    assert (await limiter.post(ok_client, ENDPOINT, "probe")).status_code == 200
    assert limiter.get_state()["breakers"]["search"]["state"] == "CLOSED"

    stale.release.set()
    with pytest.raises(httpx.ConnectError):
        await asyncio.wait_for(stale_task, timeout=2.0)

    snapshot = limiter.get_state()["breakers"]["search"]
    assert snapshot["state"] == "CLOSED"
    # The dropped outcome must not appear in the fresh sliding window.
    assert snapshot["window_samples"] == 0
    assert snapshot["window_failures"] == 0
