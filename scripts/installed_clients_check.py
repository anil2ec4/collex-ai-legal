"""Verify the exact Yargı MCP commands installed for local clients."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import tomllib

from fastmcp import Client
from fastmcp.client.transports import StdioTransport


ROOT = Path(__file__).resolve().parents[1]
CODEX_CONFIG = Path.home() / ".codex" / "config.toml"
CLAUDE_CODE_CONFIG = Path.home() / ".claude.json"
CLAUDE_DESKTOP_CONFIG = (
    Path.home() / "AppData" / "Roaming" / "Claude" / "claude_desktop_config.json"
)


def _load_targets() -> list[tuple[str, dict]]:
    codex = tomllib.loads(CODEX_CONFIG.read_text(encoding="utf-8"))
    claude_code = json.loads(CLAUDE_CODE_CONFIG.read_text(encoding="utf-8"))
    claude_desktop = json.loads(CLAUDE_DESKTOP_CONFIG.read_text(encoding="utf-8"))

    return [
        ("Codex", codex["mcp_servers"]["yargi-mevzuat"]),
        ("Claude Code", claude_code["mcpServers"]["yargi-mevzuat"]),
        ("Claude Desktop", claude_desktop["mcpServers"]["yargi-mevzuat"]),
    ]


async def main() -> None:
    for client_name, config in _load_targets():
        command = config["command"]
        args = list(config.get("args", []))
        cwd = config.get("cwd")
        transport = StdioTransport(command=command, args=args, cwd=cwd)
        async with Client(transport, timeout=300, init_timeout=90) as client:
            tools = await client.list_tools()
        names = {tool.name for tool in tools}
        assert len(tools) in {54, 55}, (client_name, len(tools))
        assert {"search_bedesten_unified", "search_mevzuat", "search_btk_decisions"} <= names
        print(f"{client_name}: stdio handshake passed ({len(tools)} tools)")


if __name__ == "__main__":
    asyncio.run(main())
