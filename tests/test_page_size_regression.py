# tests/test_page_size_regression.py
"""page_size contract regression tests for the legislation search tools.

The legislation search path accepts page_size 1..20 only. These tests pin:
- schema validation: 1 and 20 accepted, 0 and 21 rejected;
- the legacy resilient helper clamps oversized page_size values to 20.

All network traffic is mocked with respx (the Bedesten legislation search
POST goes to https://bedesten.adalet.gov.tr/mevzuat/searchDocuments).
"""

import json

import httpx
import pytest
import respx
from fastmcp import Client
from fastmcp.exceptions import ToolError

import mevzuat_mcp_server
from mcp_server_main import app
from mevzuat_bedesten_models import BedSearchResult
from mevzuat_models import MevzuatSearchRequestNew

BEDESTEN_SEARCH_URL = "https://bedesten.adalet.gov.tr/mevzuat/searchDocuments"

# Minimal valid (empty) Bedesten search response.
BEDESTEN_EMPTY_RESPONSE = {
    "data": {"mevzuatList": [], "total": 0, "start": 0},
    "metadata": {"FMTY": "SUCCESS"},
}

LEGACY_LEGISLATION_SEARCH_TOOLS = (
    "search_kanun",
    "search_khk",
    "search_tuzuk",
    "search_kurum_yonetmelik",
    "search_teblig",
    "search_cbk",
    "search_cbyonetmelik",
    "search_cbbaskankarar",
    "search_cbgenelge",
)

ALL_PAGE_SIZE_TOOLS = ("search_mevzuat",) + LEGACY_LEGISLATION_SEARCH_TOOLS


def _tool_args(tool_name: str, page_size: int) -> dict:
    """Minimal arguments for one legislation search tool."""
    if tool_name == "search_mevzuat":
        return {"mevzuat_adi": "kanun", "page_size": page_size}
    return {"aranacak_ifade": "vergi", "page_size": page_size}


@pytest.mark.parametrize("tool_name", ALL_PAGE_SIZE_TOOLS)
@pytest.mark.parametrize("page_size", [1, 20])
@respx.mock
async def test_page_size_accepted(tool_name: str, page_size: int):
    route = respx.post(BEDESTEN_SEARCH_URL).mock(
        return_value=httpx.Response(200, json=BEDESTEN_EMPTY_RESPONSE)
    )

    async with Client(app) as client:
        result = await client.call_tool(tool_name, _tool_args(tool_name, page_size))

    assert result is not None
    assert route.called, "search must hit the (mocked) Bedesten endpoint"

    # The accepted page_size must be forwarded verbatim to the API payload.
    sent = json.loads(route.calls.last.request.content.decode("utf-8"))
    assert sent["data"]["pageSize"] == page_size


@pytest.mark.parametrize("tool_name", ALL_PAGE_SIZE_TOOLS)
@pytest.mark.parametrize("page_size", [0, 21])
@respx.mock
async def test_page_size_rejected(tool_name: str, page_size: int):
    route = respx.post(BEDESTEN_SEARCH_URL).mock(
        return_value=httpx.Response(200, json=BEDESTEN_EMPTY_RESPONSE)
    )

    async with Client(app) as client:
        with pytest.raises(ToolError):
            await client.call_tool(tool_name, _tool_args(tool_name, page_size))

    assert not route.called, "rejected page_size must never reach the network"


async def test_legacy_helper_clamps_page_size_to_20(monkeypatch):
    """_search_documents_resilient clamps oversized page_size with min(..., 20)."""
    captured = {}

    class _FakeBedestenClient:
        async def search_documents(self, **kwargs):
            captured.update(kwargs)
            return BedSearchResult(documents=[], total_results=0, start=0)

    monkeypatch.setattr(mevzuat_mcp_server, "bedesten_client", _FakeBedestenClient())

    request = MevzuatSearchRequestNew(
        mevzuat_tur="Kanun",
        aranacak_ifade="vergi",
        page_size=50,  # model allows up to 100; the helper must clamp
    )
    result = await mevzuat_mcp_server._search_documents_resilient(request)

    assert captured["page_size"] == 20
    assert result.page_size == 20
