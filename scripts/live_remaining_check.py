"""Focused live MCP-context checks for document chains and semantic search."""

from __future__ import annotations

import asyncio
import re
import time

from fastmcp import Client

from live_regression_check import _assert_usable, _payload, _text, mcp_server_main


async def main() -> None:
    async with Client(mcp_server_main.app, timeout=300) as client:
        async def call(name: str, arguments: dict, timeout: float = 240):
            started = time.monotonic()
            result = await asyncio.wait_for(client.call_tool(name, arguments), timeout)
            payload = _payload(result)
            print(f"PASS {name}: {time.monotonic() - started:.2f}s", flush=True)
            return payload

        bedesten = await call(
            "search_bedesten_unified",
            {"phrase": "muvazaa", "court_types": ["YARGITAYKARARI"], "pageNumber": 1},
        )
        _assert_usable("search_bedesten_unified", bedesten)
        bedesten_id = re.search(
            r"documentId[\"']?\s*[:=]\s*[\"']([^\"']+)", _text(bedesten)
        )
        assert bedesten_id, _text(bedesten)[:1000]
        bedesten_doc = await call(
            "get_bedesten_document_markdown", {"documentId": bedesten_id.group(1)}
        )
        _assert_usable("get_bedesten_document_markdown", bedesten_doc)

        kik = await call(
            "search_kik_v2_decisions", {"karar_no": "2025/UH.II-1801"}
        )
        _assert_usable("search_kik_v2_decisions", kik)
        kik_id = re.search(
            r"gundemMaddesiId[\"']?\s*[:=]\s*[\"']([^\"']+)", _text(kik)
        )
        assert kik_id, _text(kik)[:1000]
        kik_doc = await call(
            "get_kik_v2_document_markdown", {"gundemMaddesiId": kik_id.group(1)}
        )
        _assert_usable("get_kik_v2_document_markdown", kik_doc)

        gib = await call("search_gib_ozelge", {"kanunNo": "3065", "pageSize": 1})
        _assert_usable("search_gib_ozelge", gib)
        gib_id = re.search(r"(?:ozelge_id|id)[\"']?\s*[:=]\s*(\d+)", _text(gib))
        assert gib_id, _text(gib)[:1000]
        gib_doc = await call(
            "get_gib_ozelge_document_markdown", {"ozelge_id": int(gib_id.group(1))}
        )
        _assert_usable("get_gib_ozelge_document_markdown", gib_doc)

        semantic = await call(
            "search_bedesten_semantic",
            {
                "initial_keyword": "muvazaa",
                "query": "Miras bırakandan kalan taşınmazın muvazaalı satış nedeniyle tapu iptali",
                "court_types": ["YARGITAYKARARI"],
                "candidate_limit": 2,
                "top_k": 2,
            },
        )
        _assert_usable("search_bedesten_semantic", semantic)
        semantic_text = _text(semantic)
        assert "embedding_model" in semantic_text or "semantic_score" in semantic_text

        for name, args, expected in (
            ("search_kvkk_decisions", {"keywords": "test"}, "BRAVE_API_TOKEN"),
            ("search_bddk_decisions", {"keywords": "test"}, "TAVILY_API_KEY"),
            ("search_sigorta_tahkim_decisions", {"keywords": "test"}, "TAVILY_API_KEY"),
        ):
            payload = await call(name, args)
            assert expected in _text(payload), f"{name}: missing clear disabled message"

    print("REMAINING LIVE REGRESSION PASSED")


if __name__ == "__main__":
    asyncio.run(main())
