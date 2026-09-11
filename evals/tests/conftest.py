"""Path setup so the eval harness modules import without an installed package.

The eval scripts live in sibling directories (evals/retrieval, evals/citations)
rather than an installed package, so add them to sys.path for the test session.
Kept minimal and offline; no network, no server imports.
"""

from __future__ import annotations

import sys
from pathlib import Path

EVALS_DIR = Path(__file__).resolve().parents[1]

for sub in ("retrieval", "citations"):
    candidate = EVALS_DIR / sub
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))
