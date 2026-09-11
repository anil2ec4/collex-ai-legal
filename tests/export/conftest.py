"""Fixtures for the export suite — fully offline, no provider credentials.

These tests never touch the network, the database, or any MCP server module.
The env blanking below mirrors ``tests/conftest.py`` and
``scripts/smoke_check.py``: ``load_dotenv()`` never overrides an already-set
variable, so blanking here makes every credential-gated path fail closed no
matter what is in the caller's shell or in the repo ``.env``.

The bundle fixtures under ``fixtures/`` are generated from the SYNTHETIC
corpus in ``evals/fixtures/corpus`` by ``fixtures/_build_fixtures.py``; every
hash and offset in them is real, which is what makes the verification tests
mean something. They are not real Turkish case law.
"""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Fail closed before anything can import a credential-gated module.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
os.environ["MCP_API_TOKEN"] = "offline-pytest-dummy-token-0123456789abc"

from export.bundle import EvidenceBundle, parse_bundle  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
QUALIFIED_JSON = FIXTURE_DIR / "bundle_sentetik_serhli.json"
ABSTAIN_JSON = FIXTURE_DIR / "bundle_sentetik_cekimser.json"

#: Fixed timestamp so exported documents are byte-reproducible in tests.
GENERATED_AT = "2026-08-26T12:00:00+00:00"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture()
def generated_at() -> str:
    """Fixed document-generation stamp so exports are reproducible in tests."""
    return GENERATED_AT


@pytest.fixture()
def qualified_payload() -> dict[str, Any]:
    """Raw JSON of the QUALIFIED bundle (mutable copy)."""
    return _load_json(QUALIFIED_JSON)


@pytest.fixture()
def abstain_payload() -> dict[str, Any]:
    """Raw JSON of the ABSTAIN bundle (mutable copy)."""
    return _load_json(ABSTAIN_JSON)


@pytest.fixture()
def qualified_bundle(qualified_payload: dict[str, Any]) -> EvidenceBundle:
    return parse_bundle(qualified_payload)


@pytest.fixture()
def abstain_bundle(abstain_payload: dict[str, Any]) -> EvidenceBundle:
    return parse_bundle(abstain_payload)


@pytest.fixture()
def tamper() -> Callable[[dict[str, Any], int, str], dict[str, Any]]:
    """Return a copy of a payload with one character changed inside a quote.

    The hashes are deliberately LEFT ALONE — that is exactly the attack the
    export must catch: a document whose visible text no longer matches the
    provenance it advertises.
    """

    def _tamper(
        payload: dict[str, Any], index: int = 0, replacement: str = "X"
    ) -> dict[str, Any]:
        mutated = copy.deepcopy(payload)
        quote = mutated["evidence"][index]["quote"]
        position = len(quote) // 2
        original = quote[position]
        swapped = replacement if original != replacement else "Y"
        mutated["evidence"][index]["quote"] = (
            quote[:position] + swapped + quote[position + 1 :]
        )
        assert mutated["evidence"][index]["quote"] != quote
        assert len(mutated["evidence"][index]["quote"]) == len(quote)
        return mutated

    return _tamper


@pytest.fixture()
def write_payload(tmp_path: Path) -> Callable[[dict[str, Any], str], Path]:
    """Write a bundle payload to a temp JSON file and return its path."""

    def _write(payload: dict[str, Any], name: str = "bundle.json") -> Path:
        path = tmp_path / name
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
        return path

    return _write
