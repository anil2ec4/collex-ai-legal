"""Offline smoke checks for the independent combined server."""

from __future__ import annotations

import asyncio
import os

# Make the check unconditionally offline, even if the caller has a populated
# shell environment or .env file. load_dotenv() will not override these values.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
os.environ["MCP_API_TOKEN"] = "offline-smoke-token-0123456789abcdef"

import httpx
import numpy as np

import emsal_semantic
from bedesten_mcp_module import client as court_bedesten
from bedesten_rate_limit import BedestenRateLimited, _TokenBucket, bedesten_rate_limiter
from emsal_mcp_module.models import EmsalApiDecisionEntry, EmsalDocumentMarkdown
from emsal_semantic import rerank_emsal_decisions
import mevzuat_bedesten_client

import asgi_app
import mcp_server_main


class _FakeEmbedder:
    model = "offline-test-embedding"
    dimension = 2

    def encode_query(self, query: str, task: str = "") -> np.ndarray:
        return np.array([1.0, 0.0], dtype=np.float32)

    def encode_documents(self, documents, titles=None) -> np.ndarray:
        return np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)


class _FakeEmsalClient:
    async def get_decision_document_as_markdown(self, document_id: str):
        text = (
            "miras muvazaası tapu iptali "
            if document_id == "1"
            else "iş hukuku kıdem tazminatı "
        ) * 20
        return EmsalDocumentMarkdown(
            id=document_id,
            markdown_content=text,
            source_url=f"https://emsal.uyap.gov.tr/karar/{document_id}",
        )


async def _check_semantic_reranking() -> None:
    original_factory = emsal_semantic.get_embedder
    emsal_semantic.get_embedder = lambda: _FakeEmbedder()
    try:
        decisions = [
            EmsalApiDecisionEntry(
                id="1", daire="1. HD", esasNo="1", kararNo="1", kararTarihi="2026"
            ),
            EmsalApiDecisionEntry(
                id="2", daire="2. HD", esasNo="2", kararNo="2", kararTarihi="2026"
            ),
        ]
        result = await rerank_emsal_decisions(
            _FakeEmsalClient(), decisions, "muris muvazaası", 2
        )
        assert result["results"][0]["id"] == "1"
        assert result["embedding_model"] == "offline-test-embedding"
    finally:
        emsal_semantic.get_embedder = original_factory


async def _check_local_rate_limit() -> None:
    bucket = _TokenBucket(capacity=1, refill_per_s=1.0)
    await bucket.acquire(max_wait=0.01)
    try:
        await bucket.acquire(max_wait=0.01)
    except BedestenRateLimited as exc:
        assert exc.source == "local"
        assert exc.retry_after > 0
    else:
        raise AssertionError("second immediate Bedesten token acquisition should be limited")


async def main() -> None:
    tools = await mcp_server_main.app.get_tools()
    assert len(tools) == 54, f"expected 54 tools, got {len(tools)}"
    for name in (
        "search_bedesten_unified",
        "search_emsal_detailed_decisions",
        "search_anayasa_unified",
        "search_uyusmazlik_decisions",
        "search_sayistay_unified",
        "search_kik_v2_decisions",
        "search_rekabet_kurumu_decisions",
        "search_kvkk_decisions",
        "search_bddk_decisions",
        "search_btk_decisions",
        "search_gib_ozelge",
        "search_sigorta_tahkim_decisions",
        "search_kanun",
        "search_teblig",
        "search_cbk",
        "search_khk",
        "search_mevzuat",
        "get_mevzuat_content",
    ):
        assert name in tools, f"missing tool: {name}"

    bedesten_schema = tools["search_bedesten_unified"].parameters
    court_enum = set(
        bedesten_schema["properties"]["court_types"]["items"]["enum"]
    )
    assert court_enum == {
        "YARGITAYKARARI",
        "DANISTAYKARAR",
        "YERELHUKUK",
        "ISTINAFHUKUK",
        "KYB",
    }

    emsal_properties = tools["search_emsal_detailed_decisions"].parameters["properties"]
    assert {"semantic", "semantic_query", "semantic_top_k"} <= set(emsal_properties)

    assert court_bedesten.bedesten_rate_limiter is bedesten_rate_limiter
    assert mevzuat_bedesten_client.bedesten_rate_limiter is bedesten_rate_limiter
    assert mcp_server_main.bedesten_rate_limiter is bedesten_rate_limiter

    kvkk_result = await tools["search_kvkk_decisions"].run({"keywords": "test"})
    bddk_result = await tools["search_bddk_decisions"].run({"keywords": "test"})
    kvkk_document = await tools["get_kvkk_document_markdown"].run(
        {"decision_url": "https://www.kvkk.gov.tr/Icerik/1/test", "page_number": 1}
    )
    bddk_document = await tools["get_bddk_document_markdown"].run(
        {"document_id": "1", "page_number": 1}
    )
    assert "KVKK module disabled" in kvkk_result.structured_content["error"]
    assert "BDDK module disabled" in bddk_result.structured_content["error"]
    assert "KVKK module disabled" in kvkk_document.structured_content["error_message"]
    assert "BDDK module disabled" in bddk_document.structured_content["error"]

    encrypted_id = mcp_server_main.kik_v2_client_instance.encrypt_document_id("177280")
    assert len(encrypted_id) == 64
    assert all(char in "0123456789abcdef" for char in encrypted_id)

    await _check_semantic_reranking()
    await _check_local_rate_limit()

    transport = httpx.ASGITransport(app=asgi_app.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        health = await client.get("/health")
        unauthorized = await client.get("/")
        unauthorized_mcp = await client.post("/mcp/")
        authorized = await client.get(
            "/", headers={"Authorization": f"Bearer {os.environ['MCP_API_TOKEN']}"}
        )
        status = await client.get(
            "/status", headers={"Authorization": f"Bearer {os.environ['MCP_API_TOKEN']}"}
        )
    assert health.status_code == 200
    assert health.json()["tools_count"] == 54
    assert unauthorized.status_code == 401
    assert unauthorized_mcp.status_code == 401
    assert authorized.status_code == 200
    assert status.status_code == 200
    assert status.json()["total_tools"] == 54

    print(
        "offline smoke checks passed: 54 tools, court inventory, shared limiter, "
        "disabled-key errors, HTTP auth"
    )


if __name__ == "__main__":
    asyncio.run(main())
