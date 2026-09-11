# tests/test_health_state.py
"""Health tool observability: the additive 'rate_limiter' block.

check_government_servers_health ALWAYS probes both upstreams (Yargitay's
karararama endpoint and the Bedesten API), so this test mocks every outbound
HTTP request with respx — explicit routes for the two known upstreams plus a
catch-all — guaranteeing zero real network traffic while exercising the real
tool path through the in-memory FastMCP Client.

The 'rate_limiter' field is ADDITIVE: all pre-existing response fields must
stay present and unchanged in shape.
"""

import httpx
import respx

from fastmcp import Client

from bedesten_rate_limit import bedesten_rate_limiter
from mcp_server_main import app


YARGITAY_OK = {"data": {"recordsTotal": 3, "data": []}}
BEDESTEN_OK = {"data": {"total": 5, "emsalKararList": []}}


@respx.mock
async def test_health_tool_exposes_rate_limiter_state():
    respx.post("https://karararama.yargitay.gov.tr/aramalist").mock(
        return_value=httpx.Response(200, json=YARGITAY_OK)
    )
    respx.post(
        "https://bedesten.adalet.gov.tr/emsal-karar/searchDocuments"
    ).mock(return_value=httpx.Response(200, json=BEDESTEN_OK))
    # Catch-all so an unexpected probe fails fast with a local 200 instead of
    # ever leaving the process.
    respx.route().mock(return_value=httpx.Response(200, json={}))

    async with Client(app) as client:
        result = await client.call_tool("check_government_servers_health", {})
    payload = result.structured_content

    # --- Existing contract fields: unchanged (additive-only guarantee) ---
    for key in (
        "overall_status",
        "healthy_servers",
        "total_servers",
        "servers",
        "check_timestamp",
    ):
        assert key in payload, f"pre-existing health field missing: {key}"
    assert payload["overall_status"] == "healthy"
    assert payload["healthy_servers"] == 2
    assert payload["total_servers"] == 2
    assert payload["servers"]["yargitay"]["status"] == "healthy"
    assert payload["servers"]["bedesten"]["status"] == "healthy"

    # --- New additive block: presence + shape ---
    rate_limiter = payload["rate_limiter"]
    assert isinstance(rate_limiter, dict)

    bucket = rate_limiter["bucket"]
    assert set(bucket) == {"capacity", "refill_per_s", "tokens", "not_before_in_s"}
    assert bucket["capacity"] > 0
    assert bucket["refill_per_s"] > 0
    assert bucket["tokens"] >= 0
    assert bucket["not_before_in_s"] >= 0

    assert rate_limiter["max_wait_s"] > 0
    assert rate_limiter["bulkhead_max_concurrent"] >= 1

    breakers = rate_limiter["breakers"]
    assert isinstance(breakers, dict)
    # The Bedesten health probe above went through the limiter's "search"
    # failure domain, so its breaker must exist and be CLOSED after a 200.
    assert "search" in breakers
    search_breaker = breakers["search"]
    assert set(search_breaker) == {
        "state",
        "window_samples",
        "window_failures",
        "open_remaining_s",
    }
    assert search_breaker["state"] in {"CLOSED", "OPEN", "HALF_OPEN"}
    assert search_breaker["state"] == "CLOSED"


@respx.mock
async def test_health_tool_matches_live_limiter_singleton():
    """The block must be sourced from the shared process-wide limiter."""
    respx.post("https://karararama.yargitay.gov.tr/aramalist").mock(
        return_value=httpx.Response(200, json=YARGITAY_OK)
    )
    respx.post(
        "https://bedesten.adalet.gov.tr/emsal-karar/searchDocuments"
    ).mock(return_value=httpx.Response(200, json=BEDESTEN_OK))
    respx.route().mock(return_value=httpx.Response(200, json={}))

    async with Client(app) as client:
        result = await client.call_tool("check_government_servers_health", {})
    payload = result.structured_content

    live_state = bedesten_rate_limiter.get_state()
    reported = payload["rate_limiter"]
    # Static configuration values must match the singleton exactly (dynamic
    # values like 'tokens' may drift between the two snapshots).
    assert reported["bucket"]["capacity"] == live_state["bucket"]["capacity"]
    assert reported["bucket"]["refill_per_s"] == live_state["bucket"]["refill_per_s"]
    assert reported["max_wait_s"] == live_state["max_wait_s"]
    assert (
        reported["bulkhead_max_concurrent"]
        == live_state["bulkhead_max_concurrent"]
    )
    assert set(reported["breakers"]) == set(live_state["breakers"])
