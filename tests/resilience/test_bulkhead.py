"""Bulkhead: per-endpoint-class concurrency is bounded by the semaphore.

The second half of this module covers the deadline guarantee: queueing on the
bulkhead used to be unbounded and uncounted, so BEDESTEN_RATE_MAX_WAIT_S was
only a token-bucket budget and a caller could block for many multiples of it.
"""

import asyncio
import time

import httpx
import pytest

from bedesten_rate_limit import (
    BedestenRateLimited,
    BedestenRateLimiter,
    _TokenBucket,
)


class ConcurrencyTrackingClient:
    """Fake httpx client recording the maximum number of in-flight posts."""

    def __init__(self) -> None:
        self.current = 0
        self.max_concurrent = 0
        self.calls = 0

    async def post(self, url, **kwargs):
        self.calls += 1
        self.current += 1
        self.max_concurrent = max(self.max_concurrent, self.current)
        await asyncio.sleep(0.02)
        self.current -= 1
        return httpx.Response(200)


def make_limiter() -> BedestenRateLimiter:
    limiter = BedestenRateLimiter()
    # Instant token bucket so only the bulkhead bounds concurrency.
    limiter._bucket = _TokenBucket(capacity=1000, refill_per_s=100000.0)
    return limiter


async def test_default_bulkhead_bounds_concurrency_at_two():
    limiter = make_limiter()
    client = ConcurrencyTrackingClient()
    await asyncio.gather(
        *(
            limiter.post(client, "/getDocumentContent", "test-op")
            for _ in range(8)
        )
    )
    assert client.calls == 8
    assert client.max_concurrent == 2


async def test_bulkhead_limit_is_env_configurable(monkeypatch):
    monkeypatch.setenv("BEDESTEN_BULKHEAD_MAX_CONCURRENT", "3")
    limiter = make_limiter()
    client = ConcurrencyTrackingClient()
    await asyncio.gather(
        *(
            limiter.post(client, "/getDocumentContent", "test-op")
            for _ in range(9)
        )
    )
    assert client.max_concurrent == 3


async def test_bulkhead_is_per_endpoint_class(monkeypatch):
    """Document bursts must not starve searches: each class has its own lane."""
    monkeypatch.setenv("BEDESTEN_BULKHEAD_MAX_CONCURRENT", "1")
    limiter = make_limiter()
    client = ConcurrencyTrackingClient()
    await asyncio.gather(
        limiter.post(client, "/getDocumentContent", "doc-op"),
        limiter.post(client, "/getDocumentContent", "doc-op"),
        limiter.post(client, "/searchDocuments", "search-op"),
        limiter.post(client, "/searchDocuments", "search-op"),
    )
    # One in-flight per class -> global peak of 2 despite the per-class cap 1.
    assert client.max_concurrent == 2


# ---------------------------------------------------------------------------
# Deadline guarantee: bulkhead queueing counts toward BEDESTEN_RATE_MAX_WAIT_S
# ---------------------------------------------------------------------------


class GateClient:
    """Holds its bulkhead slot inside post() until the gate is released."""

    def __init__(self, gate: asyncio.Event) -> None:
        self.gate = gate
        self.calls = 0

    async def post(self, url, **kwargs):
        self.calls += 1
        await self.gate.wait()
        return httpx.Response(200)


def make_saturating_limiter(max_wait: float) -> BedestenRateLimiter:
    limiter = BedestenRateLimiter()
    # 5 tokens, effectively no refill: token consumption is directly countable.
    limiter._bucket = _TokenBucket(capacity=5, refill_per_s=0.0001)
    limiter._bulkhead_max = 1
    limiter.max_wait = max_wait
    return limiter


async def test_bulkhead_wait_is_bounded_by_max_wait():
    """A saturated bulkhead must fail with the typed error inside max_wait."""
    limiter = make_saturating_limiter(max_wait=0.25)
    gate = asyncio.Event()
    blocker_client = GateClient(gate)

    blocker = asyncio.create_task(
        limiter.post(blocker_client, "/searchDocuments", "blocker")
    )
    # Let the blocker take the only slot.
    while blocker_client.calls == 0:
        await asyncio.sleep(0.005)

    start = time.monotonic()
    with pytest.raises(BedestenRateLimited) as exc_info:
        # wait_for keeps the pre-fix (unbounded) behaviour from hanging the
        # suite: without the deadline this raises TimeoutError instead.
        await asyncio.wait_for(
            limiter.post(GateClient(gate), "/searchDocuments", "waiter"),
            timeout=5.0,
        )
    elapsed = time.monotonic() - start

    assert exc_info.value.source == "local"
    assert exc_info.value.retry_after > 0
    # It waited its budget (not an instant reject) but no longer.
    assert 0.2 <= elapsed < 1.5, elapsed

    gate.set()
    await blocker


async def test_bulkhead_timeout_does_not_consume_a_bucket_token():
    """The rejected caller must not burn upstream quota it never used."""
    limiter = make_saturating_limiter(max_wait=0.2)
    gate = asyncio.Event()
    blocker_client = GateClient(gate)

    blocker = asyncio.create_task(
        limiter.post(blocker_client, "/searchDocuments", "blocker")
    )
    while blocker_client.calls == 0:
        await asyncio.sleep(0.005)

    tokens_before = limiter.get_state()["bucket"]["tokens"]
    with pytest.raises(BedestenRateLimited):
        await asyncio.wait_for(
            limiter.post(GateClient(gate), "/searchDocuments", "waiter"),
            timeout=5.0,
        )
    tokens_after = limiter.get_state()["bucket"]["tokens"]
    assert tokens_after == pytest.approx(tokens_before, abs=0.01)

    gate.set()
    await blocker


async def test_bulkhead_slot_is_released_after_a_timeout_and_after_success():
    """No slot leak: the lane must be usable again once the blocker drains."""
    limiter = make_saturating_limiter(max_wait=0.2)
    gate = asyncio.Event()
    blocker_client = GateClient(gate)

    blocker = asyncio.create_task(
        limiter.post(blocker_client, "/searchDocuments", "blocker")
    )
    while blocker_client.calls == 0:
        await asyncio.sleep(0.005)

    with pytest.raises(BedestenRateLimited):
        await asyncio.wait_for(
            limiter.post(GateClient(gate), "/searchDocuments", "waiter"),
            timeout=5.0,
        )

    gate.set()
    await blocker

    # The single slot is free again for two more sequential requests.
    for _ in range(2):
        response = await asyncio.wait_for(
            limiter.post(GateClient(gate), "/searchDocuments", "after"),
            timeout=5.0,
        )
        assert response.status_code == 200


async def test_timed_out_waiters_do_not_shrink_the_lane():
    """A partial slot leak would silently halve throughput after one outage."""
    limiter = make_saturating_limiter(max_wait=0.2)
    limiter._bulkhead_max = 2
    limiter._bucket = _TokenBucket(capacity=1000, refill_per_s=100000.0)

    gate = asyncio.Event()
    blockers = [GateClient(gate), GateClient(gate)]
    held = [
        asyncio.create_task(limiter.post(c, "/searchDocuments", "blocker"))
        for c in blockers
    ]
    while any(c.calls == 0 for c in blockers):
        await asyncio.sleep(0.005)

    # Both slots are taken: two more callers must time out, not queue forever.
    for _ in range(2):
        with pytest.raises(BedestenRateLimited):
            await asyncio.wait_for(
                limiter.post(GateClient(gate), "/searchDocuments", "waiter"),
                timeout=5.0,
            )

    gate.set()
    await asyncio.gather(*held)

    # Full concurrency must be restored: exactly 2 in flight, not 1 or 0.
    tracker = ConcurrencyTrackingClient()
    await asyncio.wait_for(
        asyncio.gather(
            *(limiter.post(tracker, "/searchDocuments", "after") for _ in range(6))
        ),
        timeout=5.0,
    )
    assert tracker.calls == 6
    assert tracker.max_concurrent == 2
