"""Canonical fetch contract parity: 'fetch' vs 'get_bedesten_document_markdown'.

Both tools go through BedestenApiClient.get_document_as_markdown, so a fixed
fixture document must yield byte-identical markdown and a matching
content_sha256 through either tool (via the in-memory fastmcp Client).
"""

import base64
import hashlib
import json

import httpx
import respx
from fastmcp import Client

import mcp_server_main

DOC_URL = "https://bedesten.adalet.gov.tr/emsal-karar/getDocumentContent"

FIXTURE_HTML = (
    "<html><body>"
    "<h1>Yargitay 1. Hukuk Dairesi</h1>"
    "<p>Esas No: 2024/123 Karar No: 2024/456</p>"
    "<p>Sabit fikstur karar metni. Taraflar arasindaki uyusmazlik incelendi.</p>"
    "</body></html>"
)


def _fixture_response() -> httpx.Response:
    content_b64 = base64.b64encode(FIXTURE_HTML.encode("utf-8")).decode("ascii")
    return httpx.Response(
        200,
        json={
            "data": {"content": content_b64, "mimeType": "text/html", "version": 1},
            "metadata": {"FMTY": "SUCCESS"},
        },
    )


def _payload(result):
    """Extract the structured payload from a fastmcp CallToolResult."""
    structured = getattr(result, "structured_content", None)
    if structured:
        return structured
    content = result if isinstance(result, list) else result.content
    return json.loads(content[0].text)


def _normalize(text: str) -> str:
    return "\n".join(line.rstrip() for line in (text or "").strip().splitlines())


@respx.mock
async def test_fetch_and_document_markdown_return_identical_content():
    respx.post(DOC_URL).mock(return_value=_fixture_response())

    async with Client(mcp_server_main.app) as client:
        fetch_result = await client.call_tool("fetch", {"id": "730113500"})
        doc_result = await client.call_tool(
            "get_bedesten_document_markdown", {"documentId": "730113500"}
        )

    fetch_payload = _payload(fetch_result)
    doc_payload = _payload(doc_result)

    fetch_text = fetch_payload["text"]
    doc_markdown = doc_payload["markdown_content"]
    assert fetch_text
    assert doc_markdown

    # Parity: same normalized markdown from both facades.
    assert _normalize(fetch_text) == _normalize(doc_markdown)

    # Canonical contract fields are present and consistent.
    expected_sha = hashlib.sha256(doc_markdown.encode("utf-8")).hexdigest()
    assert doc_payload["content_sha256"] == expected_sha
    assert (
        hashlib.sha256(fetch_text.encode("utf-8")).hexdigest()
        == doc_payload["content_sha256"]
    )
    assert doc_payload["retrieved_at"]

    # The fetch facade exposes the same source document metadata.
    assert fetch_payload["metadata"]["source_url"] == doc_payload["source_url"]
    assert fetch_payload["metadata"]["mime_type"] == doc_payload["mime_type"]
