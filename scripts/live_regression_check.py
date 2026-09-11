"""Opt-in live regression checks for the local unified Yargı MCP.

This script calls official upstreams sequentially.  Bedesten calls use the
server's shared limiter; do not run multiple copies in parallel.
"""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from typing import Any

from fastmcp import Client
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

import mcp_server_main  # noqa: E402


def _payload(result: Any) -> Any:
    structured = getattr(result, "structured_content", None)
    if structured is not None:
        return structured
    content = getattr(result, "content", None)
    if content:
        return "\n".join(getattr(item, "text", str(item)) for item in content)
    return str(result)


def _text(value: Any) -> str:
    return str(value)


def _assert_usable(name: str, payload: Any, *, allow_empty: bool = False) -> None:
    text = _text(payload).lower()
    bad = (
        "unexpected error",
        "timed out",
        "timeout",
        "name_not_resolved",
        "error fetching content",
        "rate limited",
        "no content found",
        "'error':",
        "traceback",
    )
    assert not any(marker in text for marker in bad), f"{name}: {payload}"
    if isinstance(payload, dict):
        for key in ("error", "error_message"):
            if payload.get(key):
                raise AssertionError(f"{name}: {payload[key]}")
        result_text = payload.get("result")
        if isinstance(result_text, str) and result_text.lower().startswith("error"):
            raise AssertionError(f"{name}: {result_text}")
    if not allow_empty:
        assert payload not in (None, "", {}, []), f"{name}: empty result"


async def main() -> None:
    tools = await mcp_server_main.app.get_tools()
    assert len(tools) == 55, f"expected 55 tools with OpenRouter enabled, got {len(tools)}"

    client = await Client(mcp_server_main.app).__aenter__()
    # Schema regressions that previously made default calls fail or overrun.
    assert tools["search_mevzuat"].parameters["properties"]["page_size"]["default"] == 20
    assert tools["search_mevzuat"].parameters["properties"]["page_size"]["maximum"] == 20
    assert "page_number" in tools["get_mevzuat_gerekce"].parameters["properties"]
    assert tools["search_emsal_detailed_decisions"].parameters["properties"]["semantic"]["default"] is False
    assert tools["search_bedesten_semantic"].parameters["properties"]["candidate_limit"]["default"] == 5

    async def call(name: str, arguments: dict[str, Any], timeout: float = 180) -> Any:
        started = time.monotonic()
        result = await asyncio.wait_for(client.call_tool(name, arguments), timeout=timeout)
        payload = _payload(result)
        elapsed = time.monotonic() - started
        print(f"PASS {name}: {elapsed:.2f}s", flush=True)
        return payload

    # The nine formerly Playwright-bound legislation searches now use Bedesten.
    legacy_searches = {
        "search_kanun": "ceza",
        "search_teblig": "vergi",
        "search_cbk": "bakanlık",
        "search_cbyonetmelik": "yönetmelik",
        "search_cbbaskankarar": "karar",
        "search_cbgenelge": "genelge",
        "search_khk": "kamu",
        "search_tuzuk": "tüzük",
        "search_kurum_yonetmelik": "yönetmelik",
    }
    legacy_results: dict[str, dict[str, Any]] = {}
    for name, query in legacy_searches.items():
        payload = await call(
            name,
            {"aranacak_ifade": query, "aranacak_yer": 1, "page_size": 1},
        )
        _assert_usable(name, payload)
        assert isinstance(payload, dict) and payload.get("documents"), f"{name}: no documents"
        legacy_results[name] = payload

    # Representative content and search-within paths for every legacy type.
    within_map = {
        "search_kanun": "search_within_kanun",
        "search_teblig": "search_within_teblig",
        "search_cbk": "search_within_cbk",
        "search_cbyonetmelik": "search_within_cbyonetmelik",
        "search_cbbaskankarar": "search_within_cbbaskankarar",
        "search_cbgenelge": "search_within_cbgenelge",
        "search_khk": "search_within_khk",
        "search_tuzuk": "search_within_tuzuk",
        "search_kurum_yonetmelik": "search_within_kurum_yonetmelik",
    }
    for search_name, within_name in within_map.items():
        document = legacy_results[search_name]["documents"][0]
        payload = await call(
            within_name,
            {
                "mevzuat_no": document["mevzuat_no"],
                "keyword": "ve",
                "semantic": False,
                "max_results": 1,
            },
        )
        _assert_usable(within_name, payload, allow_empty=True)

    for search_name, get_name in (
        ("search_teblig", "get_teblig_content"),
        ("search_cbbaskankarar", "get_cbbaskankarar_content"),
        ("search_cbgenelge", "get_cbgenelge_content"),
    ):
        document = legacy_results[search_name]["documents"][0]
        payload = await call(get_name, {"mevzuat_no": document["mevzuat_no"]})
        _assert_usable(get_name, payload)

    # Bedesten legislation: default page size, bounded content and rationale.
    mevzuat = await call("search_mevzuat", {"mevzuat_no": "5237", "mevzuat_tur": "KANUN", "page_size": 1})
    _assert_usable("search_mevzuat", mevzuat)
    mevzuat_text = _text(mevzuat)
    mevzuat_id_match = re.search(r"mevzuatId:\s*(\d+)", mevzuat_text)
    assert mevzuat_id_match, mevzuat_text[:1000]
    content = await call(
        "get_mevzuat_content",
        {"mevzuat_id": mevzuat_id_match.group(1), "page_number": 1, "page_size": 3000},
    )
    _assert_usable("get_mevzuat_content", content)
    assert "page 1/" in _text(content)

    gerekce_match = re.search(r"gerekceId:\s*(\d+)", mevzuat_text)
    if gerekce_match:
        rationale = await call(
            "get_mevzuat_gerekce",
            {"gerekce_id": gerekce_match.group(1), "page_number": 1, "page_size": 3000},
        )
        _assert_usable("get_mevzuat_gerekce", rationale)
        assert "page 1/" in _text(rationale)
    else:
        print("SKIP get_mevzuat_gerekce: 5237 search result has no gerekceId")

    # Backends reported as timing out: test independently, not in a request burst.
    emsal = await call("search_emsal_detailed_decisions", {"keyword": "muvazaa", "page_number": 1})
    _assert_usable("search_emsal_detailed_decisions", emsal)

    uyusmazlik = await call("search_uyusmazlik_decisions", {"icerik": "görev", "page_number": 1})
    _assert_usable("search_uyusmazlik_decisions", uyusmazlik)

    rekabet = await call("search_rekabet_kurumu_decisions", {"PdfText": "rekabet", "page": 1})
    _assert_usable("search_rekabet_kurumu_decisions", rekabet)

    # Search -> document chains that were incorrectly reported as universally broken.
    bedesten = await call(
        "search_bedesten_unified",
        {"phrase": "muvazaa", "court_types": ["YARGITAYKARARI"], "pageNumber": 1},
    )
    _assert_usable("search_bedesten_unified", bedesten)
    bedesten_id = re.search(r"documentId[\"']?\s*[:=]\s*[\"']([^\"']+)", _text(bedesten))
    if bedesten_id:
        document = await call("get_bedesten_document_markdown", {"documentId": bedesten_id.group(1)})
        _assert_usable("get_bedesten_document_markdown", document)
    else:
        print("SKIP get_bedesten_document_markdown: could not parse search ID")

    kik = await call("search_kik_v2_decisions", {"karar_no": "2025/UH.II-1801"})
    _assert_usable("search_kik_v2_decisions", kik)
    kik_id = re.search(r"gundemMaddesiId[\"']?\s*[:=]\s*[\"']([^\"']+)", _text(kik))
    if kik_id:
        kik_doc = await call("get_kik_v2_document_markdown", {"gundemMaddesiId": kik_id.group(1)})
        _assert_usable("get_kik_v2_document_markdown", kik_doc)
    else:
        print("SKIP get_kik_v2_document_markdown: could not parse search ID")

    gib = await call("search_gib_ozelge", {"kanunNo": "3065", "pageSize": 1})
    _assert_usable("search_gib_ozelge", gib)
    gib_id = re.search(r"(?:ozelge_id|id)[\"']?\s*[:=]\s*(\d+)", _text(gib))
    if gib_id:
        gib_doc = await call("get_gib_ozelge_document_markdown", {"ozelge_id": int(gib_id.group(1))})
        _assert_usable("get_gib_ozelge_document_markdown", gib_doc)
    else:
        print("SKIP get_gib_ozelge_document_markdown: could not parse search ID")

    semantic = await call(
        "search_bedesten_semantic",
        {
            "initial_keyword": "muvazaa",
            "query": "Miras bırakandan kalan taşınmazın muvazaalı satış nedeniyle tapu iptali",
            "court_types": ["YARGITAYKARARI"],
            "candidate_limit": 2,
            "top_k": 2,
        },
        timeout=180,
    )
    _assert_usable("search_bedesten_semantic", semantic)

    # These are deliberately disabled until the user supplies optional keys.
    for name, args, expected in (
        ("search_kvkk_decisions", {"keywords": "test"}, "BRAVE_API_TOKEN"),
        ("search_bddk_decisions", {"keywords": "test"}, "TAVILY_API_KEY"),
        ("search_sigorta_tahkim_decisions", {"keywords": "test"}, "TAVILY_API_KEY"),
    ):
        payload = await call(name, args)
        assert expected in _text(payload), f"{name}: missing clear disabled message"

    print("LIVE REGRESSION PASSED")

    await client.__aexit__(None, None, None)

if __name__ == "__main__":
    asyncio.run(main())
