# -*- coding: utf-8 -*-
"""W14 B-44 — the upstream residue stays deleted.

ARCH S13 measured the cost of leaving it: roughly 200 KB of files describing
a deployment contract this fork does not have — a FastAPI SaaS demo
(``example_fastapi_app.py``, 80 KB), a Redis session store nothing imports,
a ``Dockerfile`` and ``railway.json``, a stale partial ``control-plane/dist``
that ``ts-loader.mjs`` never reads, and ``control-plane/test/`` with four
never-executed copies of real suites. The ARCH author reports losing time to
``dist/`` specifically: an agent (or a person) reading this repo finds the
old answer and believes it.

CLAUDE.md already says any doc claiming Clerk/OAuth, Fly.io, Upstash/Redis
or Stripe is "stale upstream residue — do not trust or restore it". This
test makes that sentence enforceable instead of advisory.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

#: Deleted in W14 B-44, with the reason each one was residue.
DELETED = {
    "example_fastapi_app.py": "FastAPI SaaS demo for a deployment contract this fork does not have",
    "migration_app.py": "one-off upstream migration helper, referenced by nothing",
    "redis_session_store.py": "Upstash/Redis session store; this fork has no Redis",
    "Dockerfile": "container deploy; this product runs on the lawyer's own machine",
    "railway.json": "Railway deployment manifest; there is no hosted deployment",
    "control-plane/dist": "stale partial build; ts-loader.mjs reads src/, never dist/",
    "control-plane/test": "four never-executed copies of tests/ (vitest includes only tests/**)",
}


@pytest.mark.parametrize("relative", sorted(DELETED))
def test_upstream_residue_is_not_restored(relative: str):
    target = REPO_ROOT / relative
    assert not target.exists(), (
        f"{relative} is back. It was deleted in W14 B-44 because it is "
        f"{DELETED[relative]}. If it is genuinely needed, say so in a report "
        "first — CLAUDE.md's rule is that this class of file must not be "
        "trusted or restored."
    )


def test_nothing_imports_the_deleted_python_modules():
    """A deletion that leaves a dangling import is worse than the file."""
    modules = ["example_fastapi_app", "migration_app", "redis_session_store"]
    offenders: list[str] = []
    skip_dirs = {
        ".git", ".venv", "node_modules", "__pycache__", ".pytest_cache",
        "build", "dist", "docs", ".ruff_cache",
    }
    for path in REPO_ROOT.rglob("*.py"):
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.name == Path(__file__).name:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for module in modules:
            if f"import {module}" in text or f"from {module}" in text:
                offenders.append(f"{path.relative_to(REPO_ROOT)} -> {module}")
    assert offenders == [], f"dangling imports of deleted modules: {offenders}"


#: Files exempted from the raw-NUL rule.
#:
#: EMPTIED by W14 L-FIX (02.09.2026). The two entries L-SAFE had to leave
#: in place during the parallel phase belonged to other lanes:
#:   control-plane/src/retrieval/hybrid.ts               (a U+0000 join
#:       separator in ``stableKey``, now the named constant ``SEP``)
#:   control-plane/tests/capabilities/localLibrary.test.ts (a U+0000 path
#:       in a failure test)
#: Both now spell the character as the ``\u0000`` escape. That is the
#: IDENTICAL string value to the JavaScript engine — no behaviour changed —
#: and it leaves the file as text for grep, diff and every editor.
#:
#: SHRINK this list; never grow it. An entry here is a source file that
#: ``grep`` silently skips as binary.
NUL_BYTE_ALLOWLIST: set[str] = set()


def test_no_source_file_carries_a_raw_NUL_byte():
    """ARCH S11 found a raw NUL byte inside a TypeScript source file.

    The consequence is not cosmetic: `file` reports the source as `data`,
    `grep` treats it as binary and SKIPS it, so a search for a symbol simply
    does not find it and the reader concludes it is not there — which is
    exactly how a build agent ends up "fixing" something that was already
    there, or missing something that was.
    """
    offenders: list[str] = []
    skip_dirs = {
        ".git", ".venv", "node_modules", "__pycache__", ".pytest_cache",
        "build", "dist", ".ruff_cache", "var", "demo-output",
    }
    for pattern in ("*.py", "*.ts", "*.mjs", "*.sql", "*.cmd"):
        for path in REPO_ROOT.rglob(pattern):
            if any(part in skip_dirs for part in path.parts):
                continue
            relative = path.relative_to(REPO_ROOT).as_posix()
            if relative in NUL_BYTE_ALLOWLIST:
                continue
            try:
                if b"\x00" in path.read_bytes():
                    offenders.append(relative)
            except OSError:
                continue
    assert offenders == [], (
        "source files containing a raw NUL byte (grep skips these as binary): "
        f"{offenders}. Write the escape instead of the raw byte."
    )


def test_the_nul_byte_allowlist_only_names_files_that_still_have_one():
    """A stale allowlist entry hides the next occurrence in that file."""
    stale = [
        name
        for name in NUL_BYTE_ALLOWLIST
        if not (REPO_ROOT / name).exists() or b"\x00" not in (REPO_ROOT / name).read_bytes()
    ]
    assert stale == [], (
        f"these files no longer carry a raw NUL byte: {stale}. Remove them "
        "from NUL_BYTE_ALLOWLIST so a future one is caught."
    )


def test_the_repo_root_declares_exactly_one_version():
    """B-34: `VERSION` is the single source and matches pyproject.toml."""
    import re

    version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), version
    pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    declared = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE)
    assert declared is not None, "pyproject.toml has no version"
    assert version == declared.group(1), (
        f"VERSION says {version} but pyproject.toml says {declared.group(1)};"
        " ARCH §6.1 counted three disagreeing version numbers — do not add a"
        " fourth."
    )
