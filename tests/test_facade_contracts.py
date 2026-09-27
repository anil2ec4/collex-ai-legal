"""Failure-contract matrix over the public Bedesten-backed tool surface.

For every upstream failure mode a caller can realistically hit
(429 with Retry-After, a connect-error storm that opens the circuit breaker,
timeout, 500, HTML garbage), each public facade must return a STRUCTURED
result carrying a machine-readable error indication:

* never a raw MCP protocol error (the caller cannot see retry_after, and a
  protocol error is indistinguishable from a server bug), and
* never a silent empty list (indistinguishable from "no Turkish case law
  matches this query").

Facades covered: search_bedesten_unified, get_bedesten_document_markdown,
fetch, search (Deep Research) and search_kanun (representative of the 26
mounted legislation tools).

Everything is offline: respx intercepts every POST to the Bedesten host, and
tests/conftest.py has already blanked the provider credentials.
"""

import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx
import pytest
import respx
from fastmcp import Client

import mcp_server_main
import mevzuat_mcp_server
from bedesten_rate_limit import bedesten_rate_limiter

BEDESTEN_HOST = "bedesten.adalet.gov.tr"

# legal_contracts.FailureKind — mirrored by control-plane/src/types.ts.
FAILURE_KINDS = {
    "RATE_LIMITED",
    "TIMEOUT",
    "UNAVAILABLE",
    "INVALID_REQUEST",
    "UNAUTHORIZED",
    "PARSER_ERROR",
    "NOT_FOUND",
}

HTML_GARBAGE = (
    "<html><body><h1>503 - Bakim calismasi</h1>"
    "<p>Sistem gecici olarak hizmet veremiyor.</p></body></html>"
)

FAILURE_MODES: Dict[str, Dict[str, Any]] = {
    "rate_limited_429": {
        "return_value": httpx.Response(429, headers={"Retry-After": "1"})
    },
    "timeout": {"side_effect": httpx.ReadTimeout("upstream timed out")},
    "connect_error": {"side_effect": httpx.ConnectError("connection refused")},
    "server_error_500": {"return_value": httpx.Response(500, text="oops")},
    "html_garbage": {
        "return_value": httpx.Response(
            200, text=HTML_GARBAGE, headers={"Content-Type": "text/html"}
        )
    },
}

EMPTY_COURT_SEARCH = {
    "data": {"emsalKararList": [], "total": 0, "start": 0},
    "metadata": {"FMTY": "SUCCESS"},
}


@pytest.fixture(autouse=True)
def _offline_limiter(monkeypatch):
    """Deterministic, fast limiter + a pristine breaker/bucket per test.

    The shared limiter is a process-wide singleton: without this the 429 pause
    and breaker state of one test would leak into the next.
    """
    monkeypatch.setattr(bedesten_rate_limiter, "_capacity", 1000, raising=False)
    monkeypatch.setattr(bedesten_rate_limiter, "_refill_seconds", 0.001, raising=False)
    # Small end-to-end budget so the single 429 retry fails fast instead of
    # sleeping through the upstream Retry-After pause.
    monkeypatch.setattr(bedesten_rate_limiter, "max_wait", 0.25, raising=False)
    # Two failures are enough to open a breaker here (production: 8 of 16).
    monkeypatch.setattr(bedesten_rate_limiter, "_breaker_min_samples", 2, raising=False)
    monkeypatch.setattr(bedesten_rate_limiter, "_breaker_window_size", 4, raising=False)
    bedesten_rate_limiter.reset()

    cache = mevzuat_mcp_server.bedesten_client._cache
    if cache is not None:
        cache._store.clear()
    yield
    if cache is not None:
        cache._store.clear()
    bedesten_rate_limiter.reset()


def _payload(result) -> Dict[str, Any]:
    """Extract the structured payload from a fastmcp CallToolResult."""
    structured = getattr(result, "structured_content", None)
    if structured:
        return structured
    content = result if isinstance(result, list) else result.content
    return json.loads(content[0].text)


async def _call(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Call one public tool through the in-memory MCP surface.

    A raw exception here means the tool leaked a protocol error, which is
    exactly what this module forbids, so nothing is caught.
    """
    async with Client(mcp_server_main.app) as client:
        return _payload(await client.call_tool(tool, args))


@dataclass
class Probe:
    """One facade's answer, normalised for contract assertions."""

    tool: str
    items: List[Any]          # the tool's result list; must be [] on failure
    marker: str               # machine-readable error indication ("" if absent)
    code: Optional[str]       # error_code, when the tool exposes one
    typed: bool               # True when the marker must be "<KIND> retry_after=N.N: ..."
    payload: Dict[str, Any]


async def probe_search_bedesten_unified() -> Probe:
    payload = await _call("search_bedesten_unified", {"phrase": "mülkiyet hakkı"})
    return Probe(
        tool="search_bedesten_unified",
        items=payload["decisions"],
        marker=payload.get("message", ""),
        code=payload.get("error_code"),
        typed=True,
        payload=payload,
    )


async def probe_get_bedesten_document_markdown() -> Probe:
    payload = await _call(
        "get_bedesten_document_markdown", {"documentId": "730113500"}
    )
    body = payload.get("markdown_content") or ""
    # "ERROR (<error>, HTTP <status>): <KIND> retry_after=N.N: <safe message>"
    marker = body.split("): ", 1)[1] if body.startswith("ERROR (") else ""
    return Probe(
        tool="get_bedesten_document_markdown",
        # This tool returns a document, not a list; an error body stands in for
        # "no content", so the emptiness check is on the parsed marker instead.
        items=[],
        marker=marker,
        code=marker.split(" ", 1)[0] if marker else None,
        typed=True,
        payload=payload,
    )


async def probe_fetch() -> Probe:
    payload = await _call("fetch", {"id": "730113500"})
    return Probe(
        tool="fetch",
        items=[],
        marker=payload.get("message", ""),
        code=payload.get("error_code"),
        typed=True,
        payload=payload,
    )


async def probe_deep_research_search() -> Probe:
    payload = await _call("search", {"query": "mülkiyet hakkı"})
    return Probe(
        tool="search",
        items=payload["results"],
        marker=payload.get("message", ""),
        code=payload.get("error_code"),
        typed=True,
        payload=payload,
    )


async def probe_search_kanun() -> Probe:
    payload = await _call("search_kanun", {"aranacak_ifade": "mülkiyet"})
    return Probe(
        tool="search_kanun",
        items=payload["documents"],
        marker=payload.get("error_message") or "",
        code=None,
        # The nine legislation tools carry their indication in error_message;
        # only the rate-limit/circuit paths use the typed prefix (their model
        # is owned by another lane and cannot gain fields).
        typed=False,
        payload=payload,
    )


PROBES = (
    probe_search_bedesten_unified,
    probe_get_bedesten_document_markdown,
    probe_fetch,
    probe_deep_research_search,
    probe_search_kanun,
)


def assert_structured_failure(probe: Probe, mode: str) -> None:
    context = f"{probe.tool} under {mode}"
    assert probe.items == [], f"{context}: expected an empty result list"
    assert probe.marker, (
        f"{context}: returned a SILENT EMPTY result — no error indication in "
        f"{sorted(probe.payload)}"
    )
    if not probe.typed:
        return
    kind = probe.marker.split(" ", 1)[0]
    assert kind in FAILURE_KINDS, f"{context}: '{kind}' is not a FailureKind"
    assert "retry_after=" in probe.marker, f"{context}: no retry_after in marker"
    assert probe.code == kind, f"{context}: error_code {probe.code!r} != {kind!r}"


@pytest.mark.parametrize("mode", sorted(FAILURE_MODES))
@respx.mock
async def test_every_facade_returns_a_structured_error(mode):
    respx.route(method="POST", host=BEDESTEN_HOST).mock(**FAILURE_MODES[mode])
    for probe_fn in PROBES:
        assert_structured_failure(await probe_fn(), mode)


@respx.mock
async def test_open_breaker_is_structured_and_never_touches_the_network():
    """The connect-error storm row: once the breaker trips, callers fail fast.

    A raw BedestenCircuitOpen used to escape the court tools as an MCP protocol
    error while the 26 legislation tools returned a structured payload for the
    very same outage.
    """
    route = respx.route(method="POST", host=BEDESTEN_HOST).mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    # Storm both failure domains open ("search" and "document").
    for _ in range(2):
        await _call("search_bedesten_unified", {"phrase": "mülkiyet"})
        await _call("get_bedesten_document_markdown", {"documentId": "730113500"})

    breakers = bedesten_rate_limiter.get_state()["breakers"]
    assert breakers["search"]["state"] == "OPEN"
    assert breakers["document"]["state"] == "OPEN"

    calls_before = route.call_count
    for probe_fn in PROBES:
        probe = await probe_fn()
        assert_structured_failure(probe, "open_breaker")
        if probe.typed:
            assert probe.code == "UNAVAILABLE", probe.tool
        assert "retry_after=" in probe.marker, probe.tool

    # Fail-fast means exactly that: no request left the process.
    assert route.call_count == calls_before


@respx.mock
async def test_deep_research_search_short_circuits_under_a_429_storm(monkeypatch):
    """One 429 must not cost five serialized bucket pauses.

    The token bucket and the circuit breaker are shared across all five court
    types, so once the first court is rate limited the rest cannot succeed —
    they would only sleep through the same pause while holding bulkhead slots.
    With production Retry-After values (30-60s) that turned a single 'search'
    call into minutes of wall time.
    """
    # A budget that lets the single 429 retry actually wait out one pause, so
    # the per-court cost is real and the difference is measurable.
    monkeypatch.setattr(bedesten_rate_limiter, "max_wait", 3.0, raising=False)
    bedesten_rate_limiter.reset()

    route = respx.route(method="POST", host=BEDESTEN_HOST).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "1"})
    )

    start = time.monotonic()
    payload = await _call("search", {"query": "mülkiyet hakkı"})
    elapsed = time.monotonic() - start

    assert payload["results"] == []
    assert payload["error_code"] == "RATE_LIMITED"
    assert payload["short_circuited"] is True
    assert payload["partial_results"] is False
    assert float(payload["retry_after"]) > 0
    assert [entry["court"] for entry in payload["failed_courts"]] == ["Yargıtay"]

    # Only the first court reached the network (1 request + its single retry);
    # without the break this is 5 courts x 2 requests and ~5 pauses.
    assert route.call_count <= 2, route.call_count
    assert elapsed < 4.0, f"search took {elapsed:.1f}s; it did not short-circuit"


@respx.mock
async def test_legitimate_empty_result_carries_no_error_fields():
    """Guard against false positives: a real 'no results' must stay clean."""
    respx.route(method="POST", host=BEDESTEN_HOST).mock(
        return_value=httpx.Response(200, json=EMPTY_COURT_SEARCH)
    )

    unified = await _call("search_bedesten_unified", {"phrase": "zzzz"})
    assert unified["decisions"] == []
    assert unified["total_records"] == 0
    for key in ("error", "error_code", "message", "retry_after"):
        assert key not in unified, key

    deep = await _call("search", {"query": "zzzz"})
    assert deep["results"] == []
    for key in ("error", "error_code", "message", "failed_courts"):
        assert key not in deep, key


# --- Regulator facades (Rekabet, BTK, GİB) ----------------------------------
# MEASURED DEFECT, 27.09.2026: with the network down, POST /v1/sources/search
# {"sources":["rekabet"]} answered 200 with okSources:["rekabet"],
# failedSources:[] and the console printed "Kaynaklar cevap verdi; sonuç
# gerçekten boş." All three tool wrappers caught EVERY exception and returned
# the model's empty result with no error field (GİB's client even swallowed it
# one layer further down). They now carry the court facades' typed fields.
#
# Their upstreams are not Bedesten, so every host is intercepted here; no
# request leaves the process.

REGULATOR_FAILURE_MODES = (
    "rate_limited_429",
    "timeout",
    "connect_error",
    "server_error_500",
    "html_garbage",
)


async def probe_search_rekabet() -> Probe:
    payload = await _call("search_rekabet_kurumu_decisions", {"PdfText": "hakim durum"})
    return Probe(
        tool="search_rekabet_kurumu_decisions",
        items=payload["decisions"],
        marker=payload.get("message", ""),
        code=payload.get("error_code"),
        typed=True,
        payload=payload,
    )


async def probe_search_btk() -> Probe:
    payload = await _call("search_btk_decisions", {"keywords": "numara taşıma"})
    return Probe(
        tool="search_btk_decisions",
        items=payload["decisions"],
        marker=payload.get("message", ""),
        code=payload.get("error_code"),
        typed=True,
        payload=payload,
    )


async def probe_search_gib() -> Probe:
    payload = await _call("search_gib_ozelge", {"keywords": "KDV oranı"})
    return Probe(
        tool="search_gib_ozelge",
        items=payload["ozelgeler"],
        marker=payload.get("message", ""),
        code=payload.get("error_code"),
        typed=True,
        payload=payload,
    )


REGULATOR_PROBES = (probe_search_rekabet, probe_search_btk, probe_search_gib)


@pytest.mark.parametrize("mode", REGULATOR_FAILURE_MODES)
@respx.mock
async def test_regulator_facades_never_return_a_silent_empty_list(mode):
    respx.route().mock(**FAILURE_MODES[mode])
    for probe_fn in REGULATOR_PROBES:
        probe = await probe_fn()
        assert_structured_failure(probe, mode)
        if mode == "connect_error":
            assert probe.code == "UNAVAILABLE", probe.tool
        if mode == "timeout":
            assert probe.code == "TIMEOUT", probe.tool
        if mode == "rate_limited_429":
            assert probe.code == "RATE_LIMITED", probe.tool
        if mode == "server_error_500":
            assert probe.code == "UNAVAILABLE", probe.tool
        if mode == "html_garbage":
            # A 200 that is not the documented contract is a parse failure,
            # not "no decision matches".
            assert probe.code == "PARSER_ERROR", probe.tool
        # The safe message never carries the driver's own text.
        assert "connection refused" not in probe.marker, probe.tool
        assert "upstream timed out" not in probe.marker, probe.tool


@respx.mock
async def test_regulator_wrapped_tls_failure_is_unavailable():
    """BTK re-wraps the cause (``raise Exception(f"Failed ...: {e}")``).

    The classification must look THROUGH the wrapper: the real outage was an
    SSL failure, and a bare "Unexpected upstream failure" is not the same
    sentence to a lawyer.
    """
    respx.route().mock(
        side_effect=httpx.ConnectError(
            "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"
        )
    )
    probe = await probe_search_btk()
    assert_structured_failure(probe, "tls")
    assert probe.code == "UNAVAILABLE"
    assert probe.payload["retryable"] is True
    assert "SSL" not in probe.marker and "CERTIFICATE" not in probe.marker


@respx.mock
async def test_regulator_legitimate_empty_results_carry_no_error_fields():
    """Guard against false positives on the three regulator facades."""
    respx.route(host="www.rekabet.gov.tr").mock(
        return_value=httpx.Response(
            200,
            text=(
                '<html><body><div class="yazi01">Toplam : 0</div>'
                '<div id="kararList"></div></body></html>'
            ),
            headers={"Content-Type": "text/html"},
        )
    )
    respx.route(host="www.btk.tr").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    respx.route().mock(
        return_value=httpx.Response(
            200, json={"resultContainer": {"content": [], "totalElements": 0, "totalPages": 0}}
        )
    )
    for probe_fn in REGULATOR_PROBES:
        probe = await probe_fn()
        assert probe.items == [], probe.tool
        for key in ("error", "error_code", "message", "retry_after"):
            assert key not in probe.payload, (probe.tool, key)


@respx.mock
async def test_rate_limited_and_circuit_open_share_one_shape():
    """Contract parity: the two 'cannot take another request yet' failures.

    They differ only in error_code/status_code — everything a caller branches
    on is present in both, on the court side and the legislation side alike.
    """
    respx.route(method="POST", host=BEDESTEN_HOST).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "1"})
    )
    limited = await _call("search_bedesten_unified", {"phrase": "mülkiyet"})

    bedesten_rate_limiter.reset()
    respx.route(method="POST", host=BEDESTEN_HOST).mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    for _ in range(2):
        await _call("search_bedesten_unified", {"phrase": "mülkiyet"})
    circuit_open = await _call("search_bedesten_unified", {"phrase": "mülkiyet"})

    shared_keys = {
        "decisions", "total_records", "requested_page", "page_size",
        "searched_courts", "error", "error_code", "status_code",
        "retry_after", "retryable", "message",
    }
    assert shared_keys <= set(limited)
    assert shared_keys <= set(circuit_open)
    assert limited["error_code"] == "RATE_LIMITED"
    assert limited["status_code"] == 429
    assert circuit_open["error_code"] == "UNAVAILABLE"
    assert circuit_open["status_code"] == 503
    for payload in (limited, circuit_open):
        assert payload["retryable"] is True
        assert float(payload["retry_after"]) > 0
        assert payload["message"].startswith(payload["error_code"] + " retry_after=")
