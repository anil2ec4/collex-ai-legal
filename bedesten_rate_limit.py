"""Process-wide rate limiting for every Bedesten API client.

Court decisions, legislation, and health checks all share the same upstream
source-IP quota.  Keeping the limiter in one module prevents each client from
creating an independent bucket and accidentally multiplying request volume.

Resilience layers (applied in ``BedestenRateLimiter.post``):

1. Circuit breaker per endpoint failure-domain ("search" vs "document" path
   classes) — trips on timeouts, connect errors and 5xx responses; 429 is
   back-pressure, not a health signal, and never trips the breaker.  Every
   admission is tagged with the breaker's state *generation* (epoch), so an
   outcome that lands after the breaker changed state (client timeouts are
   30-60s while the open window is 30s) is discarded instead of corrupting
   the HALF_OPEN probe.
2. Bulkhead — a per-endpoint-class semaphore so document-fetch bursts cannot
   starve searches while queueing on the shared token bucket.  Queueing on
   the semaphore is bounded by the same ``BEDESTEN_RATE_MAX_WAIT_S`` deadline
   that bounds token-bucket waiting, so ``max_wait`` is an end-to-end
   guarantee rather than a per-stage one.
3. Token bucket + one Retry-After-aware retry for 429 responses (unchanged
   behaviour; ``Retry-After`` now also accepts the HTTP-date form).

``get_state()`` exposes a diagnostic snapshot (breaker states, bucket tokens,
pause window) for a health tool to consume.  It is intentionally NOT wired
into ``mcp_server_main.py`` here — the health-tool lane owns that wiring.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Deque, Dict, NamedTuple, Optional, Tuple

import httpx


logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        if value <= 0:
            raise ValueError
        return value
    except ValueError:
        logger.warning("Invalid %s; using %s", name, default)
        return default


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
        if value <= 0:
            raise ValueError
        return value
    except ValueError:
        logger.warning("Invalid %s; using %s", name, default)
        return default


class BedestenRateLimited(Exception):
    """Raised when Bedesten should not receive another request yet."""

    def __init__(self, retry_after: float, source: str = "local") -> None:
        self.retry_after = max(0.1, float(retry_after))
        self.source = source
        super().__init__(
            f"rate limited; retry after {self.retry_after:.1f} seconds"
        )


class BedestenUnavailable(Exception):
    """Base class for 'Bedesten looks unhealthy' failures."""


class BedestenCircuitOpen(BedestenUnavailable):
    """Raised without touching the network while a circuit breaker is open."""

    def __init__(self, endpoint_class: str, retry_after: float) -> None:
        self.endpoint_class = endpoint_class
        self.retry_after = max(0.1, float(retry_after))
        super().__init__(
            f"bedesten circuit open for '{endpoint_class}'; "
            f"retry after {self.retry_after:.1f} seconds"
        )


def _endpoint_class(url: str) -> str:
    """Map an endpoint URL to its failure-domain key.

    Callers pass paths like ``/searchDocuments``,
    ``/emsal-karar/searchDocuments`` (-> "search") or
    ``/getDocumentContent``, ``/mevzuatMaddeTree``, ``/getGerekceContent``
    (-> "document").  The key must stay stable: breaker state and bulkheads
    are held per key.
    """
    tail = url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1].lower()
    return "search" if "search" in tail else "document"


def _parse_retry_after(raw: str) -> Optional[float]:
    """Parse a Retry-After header value (delta-seconds or HTTP-date)."""
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        pass
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt - datetime.now(timezone.utc)).total_seconds()


class _TokenBucket:
    def __init__(self, capacity: int, refill_per_s: float) -> None:
        self.capacity = float(capacity)
        self.refill_per_s = float(refill_per_s)
        self._tokens = float(capacity)
        self._last = time.monotonic()
        self._not_before = 0.0
        self._lock: Optional[asyncio.Lock] = None
        self._lock_loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_lock(self) -> asyncio.Lock:
        # asyncio primitives bind to the first loop that uses them; recreate
        # the lock when a new loop appears (sequential test loops).  With a
        # single production loop this branch runs exactly once.
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    async def acquire(self, max_wait: Optional[float]) -> None:
        deadline = time.monotonic() + max_wait if max_wait is not None else None
        while True:
            async with self._get_lock():
                now = time.monotonic()
                if now < self._not_before:
                    wait_s = self._not_before - now
                else:
                    self._tokens = min(
                        self.capacity,
                        self._tokens + (now - self._last) * self.refill_per_s,
                    )
                    self._last = now
                    if self._tokens >= 1.0:
                        self._tokens -= 1.0
                        return
                    wait_s = (1.0 - self._tokens) / self.refill_per_s

            if deadline is not None:
                remaining = deadline - time.monotonic()
                if wait_s > remaining:
                    raise BedestenRateLimited(wait_s, source="local")
            await asyncio.sleep(wait_s)

    def pause(self, seconds: float) -> None:
        now = time.monotonic()
        self._not_before = max(self._not_before, now + seconds)
        self._tokens = 0.0
        self._last = now


class _Admission(NamedTuple):
    """Ticket handed out by :meth:`_CircuitBreaker.before_request`.

    ``epoch`` is the breaker's state generation at admission time; ``is_probe``
    marks the single request that was admitted to resolve a HALF_OPEN state.
    Outcomes must be reported with the ticket they were admitted under so a
    slow in-flight request cannot apply its result to a *later* breaker state.
    """

    epoch: int
    is_probe: bool


class _CircuitBreaker:
    """Sliding-window circuit breaker for one endpoint failure-domain.

    States: CLOSED (normal), OPEN (fail fast), HALF_OPEN (one probe in
    flight).  Failures are timeouts, connect errors and 5xx responses; 429 is
    intentionally not counted.  The ``clock`` is injectable for tests.

    Every state transition that changes what an outcome *means* (a trip, and a
    HALF_OPEN -> CLOSED recovery) bumps ``generation``.  Requests carry the
    generation they were admitted under, and outcomes from a stale generation
    are dropped: upstream client timeouts (30-60s) routinely exceed the open
    window (30s), so without this a request admitted while CLOSED would land
    its failure during HALF_OPEN, re-trip the breaker with a fresh window and
    turn the real probe's success into a no-op.
    """

    def __init__(
        self,
        key: str,
        *,
        window_size: int,
        min_samples: int,
        failure_ratio: float,
        open_seconds: float,
        clock=time.monotonic,
    ) -> None:
        self.key = key
        self.min_samples = min_samples
        self.failure_ratio = failure_ratio
        self.open_seconds = open_seconds
        self._clock = clock
        # Sliding window of outcome samples; True marks a failure.
        self._samples: Deque[bool] = deque(maxlen=window_size)
        self.state = "CLOSED"
        self._opened_at = 0.0
        # Bumped on every trip and on every HALF_OPEN -> CLOSED recovery.
        self.generation = 0

    def before_request(self) -> _Admission:
        """Admit or reject one request.

        Returns the admission ticket (state generation + probe flag); the
        ticket's ``is_probe`` is True when this call becomes the single
        HALF_OPEN probe.  Raises BedestenCircuitOpen while the breaker is open
        (or while a probe is already in flight).
        """
        if self.state == "CLOSED":
            return _Admission(self.generation, False)
        if self.state == "OPEN":
            remaining = self.open_seconds - (self._clock() - self._opened_at)
            if remaining > 0:
                raise BedestenCircuitOpen(self.key, remaining)
            self.state = "HALF_OPEN"
            logger.info("Bedesten breaker '%s' HALF_OPEN; sending probe", self.key)
            return _Admission(self.generation, True)
        # HALF_OPEN: exactly one probe allowed at a time.
        raise BedestenCircuitOpen(self.key, 1.0)

    def _is_stale(self, admission: _Admission) -> bool:
        if admission.epoch == self.generation:
            return False
        logger.debug(
            "Bedesten breaker '%s' dropping stale outcome from epoch %d "
            "(current %d)",
            self.key,
            admission.epoch,
            self.generation,
        )
        return True

    def record_success(self, admission: _Admission) -> None:
        if self._is_stale(admission):
            return
        if self.state == "HALF_OPEN":
            # Only the admitted probe may resolve a HALF_OPEN state.
            if not admission.is_probe:
                return
            self.state = "CLOSED"
            self.generation += 1
            self._samples.clear()
            logger.info("Bedesten breaker '%s' probe succeeded; CLOSED", self.key)
            return
        if self.state == "CLOSED" and not admission.is_probe:
            self._samples.append(False)

    def record_failure(self, admission: _Admission) -> None:
        if self._is_stale(admission):
            return
        if self.state == "HALF_OPEN":
            if admission.is_probe:
                self._trip()
            return
        if self.state != "CLOSED" or admission.is_probe:
            return
        self._samples.append(True)
        if len(self._samples) >= self.min_samples:
            failures = sum(self._samples)
            if failures / len(self._samples) >= self.failure_ratio:
                self._trip()

    def abort_probe(self, admission: _Admission) -> None:
        """The probe produced no health signal (e.g. 429 / local limit)."""
        if not admission.is_probe or self._is_stale(admission):
            return
        if self.state == "HALF_OPEN":
            # Keep the original _opened_at (and the generation, since nothing
            # was learned) so the next caller may probe again as soon as the
            # rate-limit pause clears.
            self.state = "OPEN"

    def _trip(self) -> None:
        self.state = "OPEN"
        self.generation += 1
        self._opened_at = self._clock()
        self._samples.clear()
        logger.warning(
            "Bedesten breaker '%s' OPEN for %.1fs", self.key, self.open_seconds
        )

    def snapshot(self) -> Dict[str, object]:
        remaining = 0.0
        if self.state == "OPEN":
            remaining = max(
                0.0, self.open_seconds - (self._clock() - self._opened_at)
            )
        return {
            "state": self.state,
            "window_samples": len(self._samples),
            "window_failures": int(sum(self._samples)),
            "open_remaining_s": round(remaining, 3),
        }


class BedestenRateLimiter:
    """Conservative limiter shared by all Bedesten operations in this process."""

    def __init__(self, clock=None) -> None:
        self._clock = clock or time.monotonic
        self._capacity = _env_int("BEDESTEN_RATE_CAPACITY", 1)
        self._refill_seconds = _env_float("BEDESTEN_RATE_REFILL_S", 6.5)
        self.max_wait = _env_float("BEDESTEN_RATE_MAX_WAIT_S", 65.0)
        # Circuit breaker configuration (see _CircuitBreaker).
        self._breaker_window_size = _env_int("BEDESTEN_BREAKER_WINDOW_SIZE", 16)
        self._breaker_min_samples = _env_int("BEDESTEN_BREAKER_MIN_SAMPLES", 8)
        self._breaker_failure_ratio = _env_float("BEDESTEN_BREAKER_FAILURE_RATIO", 0.5)
        self._breaker_open_seconds = _env_float("BEDESTEN_BREAKER_OPEN_S", 30.0)
        # Bulkhead configuration: bound per-endpoint-class concurrency so a
        # burst of document fetches cannot occupy every waiter slot on the
        # shared token bucket (which mirrors the real per-IP upstream quota).
        self._bulkhead_max = _env_int("BEDESTEN_BULKHEAD_MAX_CONCURRENT", 2)
        self._bucket = _TokenBucket(
            capacity=self._capacity,
            refill_per_s=1.0 / self._refill_seconds,
        )
        self._breakers: Dict[str, _CircuitBreaker] = {}
        self._bulkheads: Dict[
            str, Tuple[asyncio.AbstractEventLoop, asyncio.Semaphore]
        ] = {}

    # ------------------------------------------------------------------
    # Internal component accessors
    # ------------------------------------------------------------------
    def _breaker(self, key: str) -> _CircuitBreaker:
        breaker = self._breakers.get(key)
        if breaker is None:
            breaker = _CircuitBreaker(
                key,
                window_size=self._breaker_window_size,
                min_samples=self._breaker_min_samples,
                failure_ratio=self._breaker_failure_ratio,
                open_seconds=self._breaker_open_seconds,
                clock=self._clock,
            )
            self._breakers[key] = breaker
        return breaker

    def _bulkhead(self, key: str) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        entry = self._bulkheads.get(key)
        if entry is None or entry[0] is not loop:
            # Semaphores bind to one loop; recreate on a new loop (tests).
            semaphore = asyncio.Semaphore(self._bulkhead_max)
            self._bulkheads[key] = (loop, semaphore)
            return semaphore
        return entry[1]

    # ------------------------------------------------------------------
    # Public API (backward compatible)
    # ------------------------------------------------------------------
    async def acquire(self, operation: str, deadline: Optional[float] = None) -> None:
        """Take one token from the shared bucket.

        ``deadline`` is an absolute ``time.monotonic()`` instant; when given it
        replaces ``max_wait`` so that time already spent queueing elsewhere
        (the bulkhead, a previous 429 retry) counts against the same budget.
        """
        if deadline is None:
            max_wait = self.max_wait
        else:
            max_wait = max(0.0, deadline - time.monotonic())
        try:
            await self._bucket.acquire(max_wait=max_wait)
        except BedestenRateLimited as exc:
            logger.warning(
                "Bedesten local rate limit for %s; retry after %.1fs",
                operation,
                exc.retry_after,
            )
            raise

    async def _acquire_bulkhead(
        self,
        semaphore: asyncio.Semaphore,
        key: str,
        operation: str,
        deadline: float,
    ) -> None:
        """Enter the per-endpoint-class bulkhead within the deadline budget.

        An unbounded semaphore wait would make BEDESTEN_RATE_MAX_WAIT_S a lie:
        a caller could block for many multiples of it before ever reaching the
        token bucket.  Waiting here is bounded by the same deadline and fails
        with the typed local rate-limit error.  ``asyncio.Semaphore.acquire``
        returns its slot on cancellation, so the timeout cannot leak a slot,
        and no bucket token has been taken at this point.
        """
        remaining = deadline - time.monotonic()
        if remaining > 0:
            try:
                await asyncio.wait_for(semaphore.acquire(), timeout=remaining)
                return
            except asyncio.TimeoutError:
                pass
        retry_after = self._refill_seconds
        logger.warning(
            "Bedesten bulkhead '%s' saturated for %s; max_wait=%.1fs exhausted, "
            "retry after %.1fs",
            key,
            operation,
            self.max_wait,
            retry_after,
        )
        raise BedestenRateLimited(retry_after, source="local")

    def from_429(self, response: httpx.Response, operation: str) -> BedestenRateLimited:
        raw = response.headers.get("Retry-After", "")
        retry_after = _parse_retry_after(raw)
        if retry_after is None:
            retry_after = 30.0

        retry_after = max(1.0, min(retry_after, 60.0)) + 0.5
        self._bucket.pause(retry_after)
        logger.warning(
            "Bedesten upstream 429 for %s; retry after %.1fs",
            operation,
            retry_after,
        )
        return BedestenRateLimited(retry_after, source="upstream")

    async def post(
        self,
        client: httpx.AsyncClient,
        url: str,
        operation: str,
        **kwargs,
    ) -> httpx.Response:
        """POST with breaker + bulkhead + shared bucket and one 429 retry.

        Every stage (bulkhead queueing, token-bucket waiting, the 429 retry)
        shares one ``max_wait`` deadline, and the breaker outcome is reported
        against the admission ticket so a stale in-flight result cannot be
        applied to a newer breaker state.
        """
        key = _endpoint_class(url)
        breaker = self._breaker(key)
        # Fail fast while the breaker is open: no token consumed, no queueing.
        admission = breaker.before_request()
        deadline = time.monotonic() + self.max_wait
        semaphore = self._bulkhead(key)
        try:
            await self._acquire_bulkhead(semaphore, key, operation, deadline)
        except BedestenRateLimited:
            # Never entered the bulkhead: nothing to release, and the probe (if
            # this was one) produced no health signal.
            breaker.abort_probe(admission)
            raise
        outcome_recorded = False
        try:
            last_error: Optional[BedestenRateLimited] = None
            for attempt in range(2):
                await self.acquire(operation, deadline=deadline)
                try:
                    response = await client.post(url, **kwargs)
                except httpx.TransportError:
                    # Timeouts and connect errors are breaker failures.
                    breaker.record_failure(admission)
                    outcome_recorded = True
                    raise
                if response.status_code == 429:
                    # Back-pressure, not a health signal: pause the bucket
                    # and retry once; never counted by the breaker.
                    last_error = self.from_429(response, operation)
                    if attempt == 0:
                        logger.info(
                            "Bedesten %s will retry once after %.1fs",
                            operation,
                            last_error.retry_after,
                        )
                    continue
                if response.status_code >= 500:
                    breaker.record_failure(admission)
                else:
                    breaker.record_success(admission)
                outcome_recorded = True
                return response
            assert last_error is not None
            raise last_error
        finally:
            semaphore.release()
            if not outcome_recorded:
                breaker.abort_probe(admission)

    def get_state(self) -> Dict[str, object]:
        """Diagnostic snapshot for health tooling (read-only)."""
        now = time.monotonic()
        bucket = self._bucket
        tokens = bucket._tokens
        if now >= bucket._not_before:
            tokens = min(
                bucket.capacity,
                bucket._tokens + max(0.0, now - bucket._last) * bucket.refill_per_s,
            )
        return {
            "bucket": {
                "capacity": bucket.capacity,
                "refill_per_s": bucket.refill_per_s,
                "tokens": round(tokens, 3),
                "not_before_in_s": round(max(0.0, bucket._not_before - now), 3),
            },
            "max_wait_s": self.max_wait,
            "bulkhead_max_concurrent": self._bulkhead_max,
            "breakers": {
                breaker_key: breaker.snapshot()
                for breaker_key, breaker in self._breakers.items()
            },
        }

    def reset(self) -> None:
        """Restore a pristine limiter state (same env-derived configuration).

        Used by offline tests between event loops; safe in production but
        normally never needed there.
        """
        self._bucket = _TokenBucket(
            capacity=self._capacity,
            refill_per_s=1.0 / self._refill_seconds,
        )
        self._breakers = {}
        self._bulkheads = {}


bedesten_rate_limiter = BedestenRateLimiter()
