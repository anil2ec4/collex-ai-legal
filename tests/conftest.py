# tests/conftest.py
"""Shared pytest setup for the offline test suite.

This module is imported by pytest BEFORE any test module, so the environment
overrides below run before the first server-module import. This mirrors the
offline pattern used by scripts/smoke_check.py (lines 10-13): load_dotenv()
never overrides variables that are already set, so blanking them here keeps
every test fully offline and deterministic regardless of the caller's shell
environment or the repo's .env file.
"""

import os
import sys
from pathlib import Path

# Make repo-root modules importable no matter where pytest is invoked from.
_REPO_ROOT = str(Path(__file__).resolve().parents[1])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# Blank provider credentials BEFORE importing any server module so every
# credential-gated code path fails closed (module disabled) instead of
# attempting real network calls.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
# Fixed 40-char dummy token (never a real credential).
os.environ["MCP_API_TOKEN"] = "offline-pytest-dummy-token-0123456789abc"

# The process-wide Bedesten token bucket reads these at import time.
# All Bedesten traffic in tests is mocked (respx), so a large bucket keeps
# the suite fast without touching the production defaults.
os.environ["BEDESTEN_RATE_CAPACITY"] = "10000"
os.environ["BEDESTEN_RATE_REFILL_S"] = "0.001"
