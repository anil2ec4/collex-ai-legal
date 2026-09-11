"""Conftest for cross-language contract tests.

Deliberately minimal: these tests validate shared fixtures (JSON files) with
the standard library only and must NOT import any MCP server module, so they
stay runnable offline and independent of provider credentials.

Provider env vars are still blanked defensively so that accidentally added
imports fail closed rather than making network calls (same pattern as
scripts/smoke_check.py lines 10-13).
"""

import os

os.environ.setdefault("OPENROUTER_API_KEY", "")
os.environ.setdefault("BRAVE_API_TOKEN", "")
os.environ.setdefault("TAVILY_API_KEY", "")
os.environ.setdefault("MCP_API_TOKEN", "offline-smoke-token-0123456789abcdef")
