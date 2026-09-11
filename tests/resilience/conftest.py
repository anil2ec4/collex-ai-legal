"""Offline test bootstrap for the resilience suite.

Blank every provider credential BEFORE any server module gets imported, so no
test can reach the real network via configured keys (see
scripts/smoke_check.py lines 10-13 for the canonical pattern).  This conftest
must stay self-sufficient: do not rely on any parent tests/conftest.py.
"""

import os
import pathlib
import sys

# --- Must run before importing any server module ---------------------------
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
os.environ["MCP_API_TOKEN"] = "offline-smoke-token-0123456789abcdef"

# Fast shared-limiter configuration so offline tests never sleep 6.5s per
# token.  Applies only to this pytest process; production defaults are
# unchanged.
os.environ["BEDESTEN_RATE_CAPACITY"] = "100"
os.environ["BEDESTEN_RATE_REFILL_S"] = "0.01"
os.environ["BEDESTEN_RATE_MAX_WAIT_S"] = "5"

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import pytest  # noqa: E402

from bedesten_rate_limit import bedesten_rate_limiter  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_shared_limiter():
    """Give every test a pristine shared limiter (bucket, breakers, bulkheads).

    Also re-creates asyncio primitives so the singleton survives the fresh
    event loop pytest-asyncio provides per test.
    """
    bedesten_rate_limiter.reset()
    yield
    bedesten_rate_limiter.reset()
