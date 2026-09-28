"""Sayıştay search rows whose text columns arrive as null.

28.09.2026, the lawyer's machine, live: a Daire row carried ``ILAMNO: null``.
The client passed ``None`` explicitly, which bypasses the model's ``""``
default, so pydantic rejected the row and the WHOLE Daire search failed.
A null text column is the empty string; the row survives.
"""

from __future__ import annotations

import asyncio
import os

os.environ["OPENROUTER_API_KEY"] = ""
os.environ["BRAVE_API_TOKEN"] = ""
os.environ["TAVILY_API_KEY"] = ""

import httpx  # noqa: E402

from sayistay_mcp_module.client import SayistayApiClient  # noqa: E402
from sayistay_mcp_module.models import DaireSearchRequest  # noqa: E402

DAIRE_ROW = {
    "Id": 101,
    "YARGILAMADAIRESI": 3,
    "KARARTRH": "12.03.2024",
    "KARARNO": "45",
    "ILAMNO": None,
    "MADDENO": 2,
    "KAMUIDARESITURU": None,
    "HESAPYILI": 2022,
    "WEBKARARKONUSU": "Harcırah",
    "WEBKARARMETNI": None,
}


def test_a_daire_row_with_null_text_columns_is_kept() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/KararlarDaire/DataTablesList")
        return httpx.Response(200, json={"data": [DAIRE_ROW], "recordsTotal": 1, "recordsFiltered": 1, "draw": 1})

    async def run():
        client = SayistayApiClient()
        await client.http_client.aclose()
        client.http_client = httpx.AsyncClient(
            base_url="https://www.sayistay.gov.tr", transport=httpx.MockTransport(handler)
        )
        client.csrf_tokens["daire"] = "token"
        try:
            return await client.search_daire_decisions(DaireSearchRequest())
        finally:
            await client.http_client.aclose()

    result = asyncio.run(run())
    assert len(result.decisions) == 1
    decision = result.decisions[0]
    assert decision.ilam_no == ""
    assert decision.kamu_idaresi_turu == ""
    assert decision.web_karar_metni == ""
    assert decision.karar_no == "45"
