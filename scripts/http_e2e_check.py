"""Run an authenticated Streamable HTTP MCP check entirely on localhost."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
import sys
import time

import httpx


ROOT = Path(__file__).resolve().parents[1]
TOKEN = "local-http-audit-token-0123456789abcdef"


def _start_server() -> subprocess.Popen:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.Popen(
        [sys.executable, str(ROOT / "scripts" / "run_http_audit_server.py")],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )


def _wait_until_ready(process: subprocess.Popen) -> None:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"local MCP server exited with code {process.returncode}")
        try:
            response = httpx.get("http://127.0.0.1:8765/health", timeout=1)
            if response.status_code == 200 and response.json().get("status") == "healthy":
                return
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(0.25)
    raise TimeoutError("local MCP server did not become ready within 45 seconds")


async def main() -> None:
    process = _start_server()
    try:
        await asyncio.to_thread(_wait_until_ready, process)
        os.environ["MCP_API_TOKEN"] = TOKEN
        os.environ["MCP_TEST_URL"] = "http://127.0.0.1:8765/mcp/"

        from http_transport_check import main as check_transport

        await check_transport()
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    asyncio.run(main())
