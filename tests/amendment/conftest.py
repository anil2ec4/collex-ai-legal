# tests/amendment/conftest.py
"""Offline setup + fakes for the amendment-resolver test suite.

Env vars are blanked BEFORE any project import (mirroring
scripts/smoke_check.py lines 10-13) so nothing in this suite can ever reach
the network, regardless of the caller's shell environment or the repo .env.
The suite itself imports only ``legal_reference`` (no server modules), but the
guard keeps the suite safe even if a future test pulls in more.
"""

import os
import sys
from pathlib import Path

os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""
# Fixed 40-char dummy token (never a real credential).
os.environ["MCP_API_TOKEN"] = "0123456789abcdef0123456789abcdef01234567"

# Make repo-root packages importable no matter where pytest is invoked from.
_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from datetime import date  # noqa: E402
from difflib import SequenceMatcher  # noqa: E402
from typing import Optional, Sequence  # noqa: E402

import pytest  # noqa: E402

from legal_reference.normalize import normalize_turkish_search  # noqa: E402
from legal_reference.resolver import AmendmentTargetResolver, CandidateLaw  # noqa: E402

# ---------------------------------------------------------------------------
# Canned corpus: realistic Turkish laws, including deliberately confusable
# pairs (old/new TCK, BK, TTK sharing subjects; 6102 vs 6112 similar numbers)
# and the omnibus/amending law 7418 itself (for the negative test).
# ---------------------------------------------------------------------------

CORPUS = [
    CandidateLaw(
        mevzuat_id="mv-5237", name="Türk Ceza Kanunu", legislation_no="5237",
        effective_start=date(2005, 6, 1), aliases=("TCK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-765", name="Türk Ceza Kanunu", legislation_no="765",
        mulga=True, effective_start=date(1926, 7, 1), effective_end=date(2005, 6, 1),
        aliases=("eski TCK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-6098", name="Türk Borçlar Kanunu", legislation_no="6098",
        effective_start=date(2012, 7, 1), aliases=("TBK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-818", name="Borçlar Kanunu", legislation_no="818",
        mulga=True, effective_start=date(1926, 10, 4), effective_end=date(2012, 7, 1),
    ),
    CandidateLaw(
        mevzuat_id="mv-4721", name="Türk Medenî Kanunu", legislation_no="4721",
        effective_start=date(2002, 1, 1), aliases=("TMK", "Türk Medeni Kanunu"),
    ),
    CandidateLaw(
        mevzuat_id="mv-5271", name="Ceza Muhakemesi Kanunu", legislation_no="5271",
        effective_start=date(2005, 6, 1), aliases=("CMK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-2004", name="İcra ve İflas Kanunu", legislation_no="2004",
        effective_start=date(1932, 9, 4), aliases=("İİK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-213", name="Vergi Usul Kanunu", legislation_no="213",
        effective_start=date(1961, 1, 10), aliases=("VUK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-6102", name="Türk Ticaret Kanunu", legislation_no="6102",
        effective_start=date(2012, 7, 1), aliases=("TTK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-6762", name="Türk Ticaret Kanunu", legislation_no="6762",
        mulga=True, effective_start=date(1957, 1, 1), effective_end=date(2012, 7, 1),
        aliases=("eski TTK",),
    ),
    CandidateLaw(
        mevzuat_id="mv-6112",
        name="Radyo ve Televizyonların Kuruluş ve Yayın Hizmetleri Hakkında Kanun",
        legislation_no="6112", effective_start=date(2011, 3, 3),
    ),
    CandidateLaw(
        mevzuat_id="mv-5651",
        name=(
            "İnternet Ortamında Yapılan Yayınların Düzenlenmesi ve Bu Yayınlar "
            "Yoluyla İşlenen Suçlarla Mücadele Edilmesi Hakkında Kanun"
        ),
        legislation_no="5651", effective_start=date(2007, 5, 23),
    ),
    CandidateLaw(
        mevzuat_id="mv-7418",
        name="Basın Kanunu ile Bazı Kanunlarda Değişiklik Yapılmasına Dair Kanun",
        legislation_no="7418", effective_start=date(2022, 10, 18),
    ),
]


def _near_number(a: str, b: str) -> bool:
    """Same length and exactly one differing digit ("6102" vs "6112")."""
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1


class FakeSearchPort:
    """Offline SearchPort double over the canned corpus.

    Simulates an imperfect upstream lexical search: number lookups also
    return near-miss numbers (one digit off), and name lookups return every
    law whose normalized name/alias is a substring match or sufficiently
    similar. Records every call in ``self.calls`` so tests can assert what
    the resolver actually queried (crucial for the amending-law negative
    test).
    """

    def __init__(self, corpus: Optional[Sequence[CandidateLaw]] = None) -> None:
        self.corpus = list(corpus if corpus is not None else CORPUS)
        self.calls: list = []

    async def search_exact(
        self,
        *,
        legislation_no: str = "",
        name: str = "",
        as_of=None,
    ) -> Sequence[CandidateLaw]:
        self.calls.append(
            {"legislation_no": legislation_no, "name": name, "as_of": as_of}
        )
        if legislation_no:
            wanted = legislation_no.strip().lstrip("0") or "0"
            exact = [c for c in self.corpus if c.legislation_no == wanted]
            near = [
                c
                for c in self.corpus
                if c.legislation_no != wanted
                and _near_number(c.legislation_no or "", wanted)
            ]
            return exact + near
        if name:
            query = normalize_turkish_search(name)
            hits = []
            for c in self.corpus:
                for target in (c.name, *c.aliases):
                    t = normalize_turkish_search(target)
                    if (
                        query == t
                        or query in t
                        or t in query
                        or SequenceMatcher(None, query, t).ratio() >= 0.65
                    ):
                        hits.append(c)
                        break
            return hits
        return []


@pytest.fixture
def fake_port() -> FakeSearchPort:
    return FakeSearchPort()


@pytest.fixture
def resolver(fake_port: FakeSearchPort) -> AmendmentTargetResolver:
    return AmendmentTargetResolver(fake_port)
