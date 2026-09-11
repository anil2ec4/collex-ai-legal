"""Start a localhost-only HTTP server with an isolated offline test environment."""

from __future__ import annotations

import os

os.environ["MCP_API_TOKEN"] = "local-http-audit-token-0123456789abcdef"
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8765, workers=1, log_level="warning")
