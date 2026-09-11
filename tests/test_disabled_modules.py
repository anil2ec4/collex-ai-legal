# tests/test_disabled_modules.py
"""Fail-closed behavior for credential-gated modules.

With BRAVE_API_TOKEN / TAVILY_API_KEY blanked (see conftest.py), the KVKK,
BDDK and Sigorta Tahkim search tools must return STRUCTURED disabled errors
instead of letting raw client exceptions escape.
"""

from mcp_server_main import app


async def test_kvkk_search_returns_structured_disabled_error():
    tools = await app.get_tools()
    result = await tools["search_kvkk_decisions"].run({"keywords": "test"})
    payload = result.structured_content
    assert "KVKK module disabled" in payload["error"]
    assert "BRAVE_API_TOKEN" in payload["error"]
    assert payload["decisions"] == []


async def test_bddk_search_returns_structured_disabled_error():
    tools = await app.get_tools()
    result = await tools["search_bddk_decisions"].run({"keywords": "test"})
    payload = result.structured_content
    assert "BDDK module disabled" in payload["error"]
    assert "TAVILY_API_KEY" in payload["error"]
    assert payload["decisions"] == []


async def test_sigorta_tahkim_search_returns_structured_disabled_error():
    tools = await app.get_tools()
    result = await tools["search_sigorta_tahkim_decisions"].run({"keywords": "kasko"})
    payload = result.structured_content
    assert "Sigorta Tahkim module disabled" in payload["error"]
    assert "TAVILY_API_KEY" in payload["error"]
    assert payload["decisions"] == []


async def test_kvkk_document_returns_structured_disabled_error():
    tools = await app.get_tools()
    result = await tools["get_kvkk_document_markdown"].run(
        {"decision_url": "https://www.kvkk.gov.tr/Icerik/1/test", "page_number": 1}
    )
    payload = result.structured_content
    assert "KVKK module disabled" in payload["error_message"]


async def test_bddk_document_returns_structured_disabled_error():
    tools = await app.get_tools()
    result = await tools["get_bddk_document_markdown"].run(
        {"document_id": "1", "page_number": 1}
    )
    payload = result.structured_content
    assert "BDDK module disabled" in payload["error"]
