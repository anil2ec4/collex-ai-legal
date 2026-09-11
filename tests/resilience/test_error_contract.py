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
