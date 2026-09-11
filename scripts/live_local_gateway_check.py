"""LIVE local gateway check — loopback only, zero external traffic.

Launches the REAL HTTP server (uvicorn + asgi_app:app) as a subprocess on
127.0.0.1:8899 with blanked provider credentials and HTTP auth enforced, then
drives the MCP streamable HTTP transport end-to-end with a plain-Node client
(control-plane/scripts/live-gateway-check.mjs):

    initialize -> tools/list (54 tools) -> tools/call search_kvkk_decisions
    (structured 'module disabled' content) -> unauthorized probe (401)

This closes the "HttpMcpGateway / live gateway never verified" gap at the
transport level: a real TCP listener, real uvicorn worker, real auth
middleware — with every provider key blanked so no request can ever leave
the loopback interface.

Usage:
    .venv/Scripts/python.exe scripts/live_local_gateway_check.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 8899
BASE_URL = f"http://{HOST}:{PORT}"
# Fixed dummy token (>=32 chars, never a real credential).
MCP_API_TOKEN = "local-gateway-check-token-0123456789abcd"
NODE_CHECK = REPO_ROOT / "control-plane" / "scripts" / "live-gateway-check.mjs"
HEALTH_TIMEOUT_S = 60.0


def _venv_python() -> str:
    candidates = [
        REPO_ROOT / ".venv" / "Scripts" / "python.exe",  # Windows
        REPO_ROOT / ".venv" / "bin" / "python",  # POSIX
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _server_env() -> dict:
    env = dict(os.environ)
    # Blank every provider credential BEFORE the server imports its modules:
    # load_dotenv() never overrides variables that are already set, so the
    # subprocess stays fully offline even with a populated .env present.
    env["OPENROUTER_API_KEY"] = ""
    env["BRAVE_API_TOKEN"] = ""
    env["TAVILY_API_KEY"] = ""
    env["MISTRAL_API_KEY"] = ""
    env["MCP_API_TOKEN"] = MCP_API_TOKEN
    env["REQUIRE_HTTP_AUTH"] = "true"
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _poll_health(deadline: float) -> None:
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE_URL}/health", timeout=2.0) as response:
                if response.status == 200:
                    body = response.read().decode("utf-8", "replace")
                    print(f"[wrapper] /health ready: {body}")
                    return
        except (urllib.error.URLError, OSError, ValueError) as exc:
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"server never became healthy on {BASE_URL}: {last_error}")


def main() -> int:
    node = shutil.which("node")
    if node is None:
        print("ERROR: node not found on PATH; cannot run the gateway client")
        return 1
    if not NODE_CHECK.exists():
        print(f"ERROR: missing node check script: {NODE_CHECK}")
        return 1

    python = _venv_python()
    server_cmd = [
        python,
        "-m",
        "uvicorn",
        "asgi_app:app",
        "--host",
        HOST,
        "--port",
        str(PORT),
        "--log-level",
        "warning",
    ]
    print(f"[wrapper] launching real HTTP server: {' '.join(server_cmd)}")
    server = subprocess.Popen(
        server_cmd,
        cwd=str(REPO_ROOT),
        env=_server_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        deadline = time.monotonic() + HEALTH_TIMEOUT_S
        while True:
            if server.poll() is not None:
                output = server.stdout.read() if server.stdout else ""
                print(output)
                print(f"ERROR: server exited early with code {server.returncode}")
                return 1
            try:
                _poll_health(min(deadline, time.monotonic() + 2.0))
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    print(f"ERROR: /health not ready within {HEALTH_TIMEOUT_S:.0f}s")
                    return 1

        check = subprocess.run(
            [node, str(NODE_CHECK), BASE_URL, MCP_API_TOKEN],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if check.stdout:
            print(check.stdout, end="")
        if check.stderr:
            print(check.stderr, end="", file=sys.stderr)
        if check.returncode != 0:
            print(f"ERROR: node gateway check failed with exit code {check.returncode}")
            return check.returncode
        print("[wrapper] live local gateway check PASSED")
        return 0
    finally:
        # ALWAYS terminate the server, whatever happened above.
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=10)
        print(f"[wrapper] server stopped (exit code {server.returncode})")


if __name__ == "__main__":
    sys.exit(main())
