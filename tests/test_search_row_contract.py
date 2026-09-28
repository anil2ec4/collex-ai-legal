"""The control plane can read every provider's search rows.

`control-plane/src/research/payloads.ts` turns a search tool's JSON into rows
using three tables: the keys that hold the row list (`GENERIC_ARRAY_KEYS`),
the fields that hold a row's id (`GENERIC_ID_FIELDS`) and the fields that hold
the source's own record count (`TOTAL_RECORD_FIELDS`). A row without a
readable id is DROPPED, silently: the source then reads "no result".

29.09.2026, the lawyer's machine, live: Sayıştay reported 727 records and no
row survived (its ids are integers), GİB's list key `ozelgeler` was never
read, AYM rows carry `decision_page_url` and Sigorta rows `document_id`,
neither listed. Every one of them looked like "this archive has nothing".

This test reads those tables out of the TypeScript source and checks them
against the Python models the tools actually return, so a renamed or new
field fails here instead of in front of the lawyer.
"""

from __future__ import annotations

import importlib
import re
import typing
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PAYLOADS = (REPO / "control-plane" / "src" / "research" / "payloads.ts").read_text(encoding="utf-8")


def _string_array(name: str) -> list[str]:
    match = re.search(name + r"\s*=\s*\[(.*?)\]\s*as const;", PAYLOADS, re.S)
    assert match is not None, name
    return re.findall(r'"([^"]+)"', match.group(1))


def _id_fields() -> dict[str, list[str]]:
    match = re.search(r"GENERIC_ID_FIELDS[^=]*=\s*Object\.freeze\(\{(.*?)\}\);", PAYLOADS, re.S)
    assert match is not None
    table: dict[str, list[str]] = {}
    for tool, fields in re.findall(r"(\w+):\s*\[([^\]]*)\]", match.group(1)):
        table[tool] = re.findall(r'"([^"]+)"', fields)
    return table


ARRAY_KEYS = _string_array("GENERIC_ARRAY_KEYS")
TOTAL_FIELDS = _string_array("TOTAL_RECORD_FIELDS")
ID_FIELDS = _id_fields()

# tool -> (response model, row models). The row models are what the tool's
# list holds; every one of them must expose at least one listed id field.
CONTRACT: dict[str, tuple[str, list[str]]] = {
    "search_anayasa_unified": (
        "anayasa_mcp_module.models:AnayasaUnifiedSearchResult",
        [
            "anayasa_mcp_module.models:AnayasaDecisionSummary",
            "anayasa_mcp_module.models:AnayasaBireyselReportDecisionSummary",
        ],
    ),
    "search_uyusmazlik_decisions": (
        "uyusmazlik_mcp_module.models:UyusmazlikSearchResponse",
        ["uyusmazlik_mcp_module.models:UyusmazlikApiDecisionEntry"],
    ),
    "search_emsal_detailed_decisions": (
        "emsal_mcp_module.models:CompactEmsalSearchResult",
        ["emsal_mcp_module.models:EmsalApiDecisionEntry"],
    ),
    "search_kik_v2_decisions": (
        "kik_mcp_module.models_v2:KikV2SearchResult",
        ["kik_mcp_module.models_v2:KikV2CompactDecision"],
    ),
    "search_kvkk_decisions": (
        "kvkk_mcp_module.models:KvkkSearchResult",
        ["kvkk_mcp_module.models:KvkkDecisionSummary"],
    ),
    "search_rekabet_kurumu_decisions": (
        "rekabet_mcp_module.models:RekabetSearchResult",
        ["rekabet_mcp_module.models:RekabetDecisionSummary"],
    ),
    "search_sayistay_unified": (
        "sayistay_mcp_module.models:SayistayUnifiedSearchResult",
        [
            "sayistay_mcp_module.models:GenelKurulDecision",
            "sayistay_mcp_module.models:TemyizKuruluDecision",
            "sayistay_mcp_module.models:DaireDecision",
        ],
    ),
    "search_bddk_decisions": (
        "bddk_mcp_module.models:BddkSearchResult",
        ["bddk_mcp_module.models:BddkDecisionSummary"],
    ),
    "search_btk_decisions": (
        "btk_mcp_module.models:BtkSearchResult",
        ["btk_mcp_module.models:BtkDecisionSummary"],
    ),
    "search_gib_ozelge": (
        "gib_mcp_module.models:GibSearchResult",
        ["gib_mcp_module.models:GibOzelgeSummary"],
    ),
    "search_sigorta_tahkim_decisions": (
        "sigorta_tahkim_mcp_module.models:SigortaTahkimSearchResult",
        ["sigorta_tahkim_mcp_module.models:SigortaTahkimDecisionSummary"],
    ),
}


def _load(ref: str):
    module, name = ref.split(":")
    return getattr(importlib.import_module(module), name)


def _scalar_id_type(annotation) -> bool:
    """str / int (or Optional of them, or a URL type that serialises to text)."""
    args = typing.get_args(annotation) or (annotation,)
    for arg in args:
        if arg is type(None):
            continue
        if arg in (str, int):
            return True
        if "Url" in getattr(arg, "__name__", ""):
            return True
    return False


def test_every_generic_search_tool_is_covered_by_this_contract() -> None:
    assert set(ID_FIELDS) == set(CONTRACT), sorted(set(ID_FIELDS) ^ set(CONTRACT))


@pytest.mark.parametrize("tool", sorted(CONTRACT))
def test_the_row_list_key_is_read(tool: str) -> None:
    response = _load(CONTRACT[tool][0])
    list_fields = [
        name
        for name, field in response.model_fields.items()
        if typing.get_origin(field.annotation) in (list, typing.List)
    ]
    assert any(name in ARRAY_KEYS for name in list_fields), (tool, list_fields, ARRAY_KEYS)


@pytest.mark.parametrize("tool", sorted(CONTRACT))
def test_every_row_model_exposes_a_listed_id_field(tool: str) -> None:
    for ref in CONTRACT[tool][1]:
        model = _load(ref)
        present = [f for f in ID_FIELDS[tool] if f in model.model_fields]
        assert present, (tool, ref, ID_FIELDS[tool], sorted(model.model_fields))
        # The first listed field the row carries is the one payloads.ts reads;
        # it must be text or an integer (payloads.ts accepts both).
        assert _scalar_id_type(model.model_fields[present[0]].annotation), (tool, ref, present[0])


@pytest.mark.parametrize("tool", sorted(CONTRACT))
def test_a_published_record_count_is_read(tool: str) -> None:
    response = _load(CONTRACT[tool][0])
    counts = [name for name in response.model_fields if name.startswith("total") and name != "total_pages"]
    for name in counts:
        assert name in TOTAL_FIELDS, (tool, name, TOTAL_FIELDS)


def test_the_filtered_count_wins_over_the_archive_size() -> None:
    # Sayıştay sends DataTables' recordsTotal (the whole archive) as
    # total_records and recordsFiltered (the matches) as total_filtered; the
    # first field present is the one shown, so the filtered one comes first.
    assert TOTAL_FIELDS.index("total_filtered") < TOTAL_FIELDS.index("total_records")
    assert TOTAL_FIELDS.index("recordsFiltered") < TOTAL_FIELDS.index("recordsTotal")
