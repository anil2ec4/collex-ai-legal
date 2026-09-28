"""Run uvicorn, and exit when the parent that started us is gone.

serve-mcp.mjs keeps this process's stdin as an open pipe and never writes to
it. When serve-mcp ends in ANY way - a clean shutdown, a crash, or a SIGKILL
that skips every exit handler - the operating system closes that pipe, the
read below returns EOF, and this process exits. Before this (27.09.2026) a
killed serve-mcp left its uvicorn child orphaned (ppid 1) still holding the
MCP port, and the next start could not bind it.

Usage (argv after the module name is uvicorn's own):
    python -m uvicorn_watchdog uvicorn asgi_app:app --host 127.0.0.1 --port 8898

The command line still contains "uvicorn asgi_app", the pattern the stop
scripts (ColleX-Durdur.cmd, deploy/macos/collex-env.sh) match on.
"""

from __future__ import annotations

import os
import runpy
import sys
import threading


def _exit_when_parent_is_gone() -> None:
    try:
        while sys.stdin.buffer.read(65536):
            pass
    except Exception:  # noqa: BLE001 - any read failure means the pipe is gone
        pass
    os._exit(0)


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] != "uvicorn":
        sys.stderr.write("usage: python -m uvicorn_watchdog uvicorn <app> [uvicorn options]\n")
        raise SystemExit(2)
    threading.Thread(target=_exit_when_parent_is_gone, name="parent-watchdog", daemon=True).start()
    sys.argv = sys.argv[1:]
    runpy.run_module("uvicorn", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
