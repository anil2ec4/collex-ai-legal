"""Verify the authenticated Streamable HTTP MCP handshake on localhost."""

from __future__ import annotations

import asyncio
import os

from fastmcp import Client


async def main() -> None:
    url = os.getenv("MCP_TEST_URL", "http://127.0.0.1:8765/mcp/")
    token = os.getenv("MCP_API_TOKEN", "").strip()
    if len(token) < 32:
        raise RuntimeError("MCP_API_TOKEN must contain at least 32 characters")

    async with Client(url, auth=token) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools}

    assert len(tools) in {54, 55}, f"unexpected tool count: {len(tools)}"
    assert "search_bedesten_unified" in names
    assert "search_mevzuat" in names
    assert "search_btk_decisions" in names
    print(f"authenticated HTTP MCP handshake passed: {len(tools)} tools")


if __name__ == "__main__":
    asyncio.run(main())
