"""Error contract of the nine-tool legislation search path (offline, respx).

Verifies that upstream failures (429 / timeout / 500 / HTML garbage) always
yield a structured error_message — never a silent empty documents list — and
that the legislation client re-raises BedestenRateLimited and preserves the
real cause of document-content failures.
"""

import httpx
import pytest
import respx

import mevzuat_mcp_server
from bedesten_rate_limit import BedestenRateLimited
from mevzuat_bedesten_client import BedestenContentError
from mevzuat_models import MevzuatSearchRequestNew

SEARCH_URL = "https://bedesten.adalet.gov.tr/mevzuat/searchDocuments"
DOC_URL = "https://bedesten.adalet.gov.tr/mevzuat/getDocumentContent"

NINE_SEARCH_TOOLS = [
    "search_kanun",
    "search_teblig",
    "search_cbk",
    "search_cbyonetmelik",
    "search_cbbaskankarar",
    "search_cbgenelge",
    "search_khk",
    "search_tuzuk",
    "search_kurum_yonetmelik",
]


@pytest.fixture(autouse=True)
def _clear_legislation_client_cache():
    cache = mevzuat_mcp_server.bedesten_client._cache
    if cache is not None:
        cache._store.clear()
    yield
    if cache is not None:
        cache._store.clear()


def make_request(**overrides) -> MevzuatSearchRequestNew:
    params = dict(
        mevzuat_tur="Kanun",
        aranacak_ifade="test",
        aranacak_yer=3,
        tam_cumle=False,
        mevzuat_no=None,
        baslangic_tarihi=None,
        bitis_tarihi=None,
        page_number=1,
        page_size=10,
    )
    params.update(overrides)
    return MevzuatSearchRequestNew(**params)


@respx.mock
async def test_429_returns_parseable_rate_limited_error():
    respx.post(SEARCH_URL).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "1"})
    )
    result = await mevzuat_mcp_server._search_documents_resilient(make_request())
    assert result.documents == []
    assert result.error_message is not None
    assert result.error_message.startswith("RATE_LIMITED retry_after=")
    retry_after = float(result.error_message.split("retry_after=")[1].split(":")[0])
    assert retry_after > 0


@respx.mock
async def test_timeout_sets_error_message():
    respx.post(SEARCH_URL).mock(side_effect=httpx.ConnectTimeout("timed out"))
    result = await mevzuat_mcp_server._search_documents_resilient(make_request())
    assert result.documents == []
    assert result.error_message


@respx.mock
async def test_500_sets_error_message_mentioning_status():
    respx.post(SEARCH_URL).mock(return_value=httpx.Response(500, text="oops"))
    result = await mevzuat_mcp_server._search_documents_resilient(make_request())
    assert result.documents == []
    assert result.error_message
    assert "500" in result.error_message


@respx.mock
async def test_html_garbage_sets_error_message():
    respx.post(SEARCH_URL).mock(
        return_value=httpx.Response(
            200,
            text="<html><body>Bakim calismasi</body></html>",
            headers={"Content-Type": "text/html"},
        )
    )
    result = await mevzuat_mcp_server._search_documents_resilient(make_request())
    assert result.documents == []
    assert result.error_message


@respx.mock
async def test_legitimate_empty_result_keeps_error_message_none():
    respx.post(SEARCH_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {"mevzuatList": [], "total": 0, "start": 0},
                "metadata": {"FMTY": "SUCCESS"},
            },
        )
    )
    result = await mevzuat_mcp_server._search_documents_resilient(make_request())
    assert result.documents == []
    assert result.error_message is None


@respx.mock
async def test_nine_tools_never_return_silent_empty_on_upstream_failure():
    respx.post(SEARCH_URL).mock(side_effect=httpx.ConnectTimeout("boom"))
    tools = await mevzuat_mcp_server.app.get_tools()
    for name in NINE_SEARCH_TOOLS:
        result = await tools[name].run({"aranacak_ifade": "test"})
        payload = result.structured_content
        assert payload["documents"] == [], name
        assert payload.get("error_message"), name


@respx.mock
async def test_search_kanun_tool_surfaces_rate_limit_metadata():
    respx.post(SEARCH_URL).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "1"})
    )
    tools = await mevzuat_mcp_server.app.get_tools()
    result = await tools["search_kanun"].run({"aranacak_ifade": "test"})
    payload = result.structured_content
    assert payload["documents"] == []
    assert payload["error_message"].startswith("RATE_LIMITED retry_after=")


@respx.mock
async def test_search_documents_reraises_bedesten_rate_limited():
    respx.post(SEARCH_URL).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "1"})
    )
    with pytest.raises(BedestenRateLimited) as exc_info:
        await mevzuat_mcp_server.bedesten_client.search_documents(phrase="x")
    assert exc_info.value.source == "upstream"
    assert exc_info.value.retry_after > 0


@respx.mock
async def test_get_document_plain_text_surfaces_real_cause():
    respx.post(DOC_URL).mock(return_value=httpx.Response(500, text="oops"))
    with pytest.raises(BedestenContentError) as exc_info:
        await mevzuat_mcp_server.bedesten_client.get_document_plain_text("999001")
    assert "500" in str(exc_info.value)
    assert exc_info.value.mevzuat_id == "999001"


@respx.mock
async def test_get_document_plain_text_empty_success_returns_empty_string():
    respx.post(DOC_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {"content": "", "mimeType": "text/html"},
                "metadata": {"FMTY": "SUCCESS"},
            },
        )
    )
    plain = await mevzuat_mcp_server.bedesten_client.get_document_plain_text("999002")
    assert plain == ""


# --- The STRING-returning legislation tools (27.09.2026) --------------------
# MEASURED DEFECT: with the network down, search_within_mevzuat answered
# isError:false with the text "Error fetching content for mevzuatId 6098:
# [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: ..." and
# POST /v1/sources/within returned it to the lawyer as a 200 result; the live
# research trace counted search_within_kanun as an "ok" call. A failure is now
# a typed MCP tool error: isError:true, text "<KIND> retry_after=N.N: <safe>".

STRING_TOOL_CALLS = [
    ("get_mevzuat_content", {"mevzuat_id": "6098"}),
    ("search_within_mevzuat", {"mevzuat_id": "6098", "keyword": "kira"}),
    ("search_within_kanun", {"mevzuat_no": "6098", "keyword": "kira"}),
    ("search_within_teblig", {"mevzuat_no": "1", "keyword": "kira"}),
    ("search_mevzuat", {"phrase": "kira"}),
    ("get_mevzuat_gerekce", {"gerekce_id": "1"}),
    ("get_mevzuat_madde_tree", {"mevzuat_id": "1"}),
]


@respx.mock
async def test_string_tools_raise_a_typed_error_instead_of_returning_error_text():
    from fastmcp import Client
    from bedesten_rate_limit import bedesten_rate_limiter

    respx.route(host="bedesten.adalet.gov.tr").mock(
        side_effect=httpx.ConnectError(
            "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"
        )
    )
    bedesten_rate_limiter.reset()
    try:
        async with Client(mevzuat_mcp_server.app) as client:
            for tool, args in STRING_TOOL_CALLS:
                result = await client.call_tool_mcp(tool, args)
                text = result.content[0].text
                assert result.isError is True, (tool, text)
                assert text.startswith("UNAVAILABLE retry_after="), (tool, text)
                # No TLS internals, no English wrapper prose on the wire.
                assert "SSL" not in text and "CERTIFICATE" not in text, (tool, text)
    finally:
        bedesten_rate_limiter.reset()


@respx.mock
async def test_string_tool_genuine_no_match_is_still_a_normal_result():
    """Guard: an answered search with zero matches is NOT an error."""
    import base64
    from fastmcp import Client
    from bedesten_rate_limit import bedesten_rate_limiter

    body = "<p>MADDE 1 - Bu Kanun sözleşmeleri düzenler.</p>"
    respx.post(DOC_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "content": base64.b64encode(body.encode("utf-8")).decode("ascii"),
                    "mimeType": "text/html",
                },
                "metadata": {"FMTY": "SUCCESS"},
            },
        )
    )
    bedesten_rate_limiter.reset()
    try:
        async with Client(mevzuat_mcp_server.app) as client:
            result = await client.call_tool_mcp(
                "search_within_mevzuat", {"mevzuat_id": "999003", "keyword": "zzzqqq"}
            )
        assert result.isError is False
        assert result.content[0].text.startswith("No articles matching")
    finally:
        bedesten_rate_limiter.reset()


@respx.mock
async def test_client_error_message_is_typed_and_carries_no_driver_text():
    respx.post(SEARCH_URL).mock(
        side_effect=httpx.ConnectError(
            "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"
        )
    )
    result = await mevzuat_mcp_server._search_documents_resilient(make_request())
    assert result.documents == []
    assert result.error_message.startswith("UNAVAILABLE retry_after=")
    assert "SSL" not in result.error_message
