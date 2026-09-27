"""No MCP tool response may carry driver, TLS or upstream prose on failure.

MEASURED, 27.09.2026 (W22 open item, STATUS "W22'nin AÇIK bıraktıkları"):
with the network down the BTK and GİB document tools answered
``error_message: "Failed to retrieve BTK document: [SSL:
CERTIFICATE_VERIFY_FAILED] certificate verify failed: …"`` / ``"Request
failed: [SSL: …]"``, and the conditional 55th tool ``search_bedesten_semantic``
answered ``{"status": "error", "message": str(e)}``. A follow-up audit that
called all 54 (+1) tools under SSL / connect / timeout / 5xx / garbage
failures, each carrying a sentinel in the driver or upstream text, found the
same leak on 40 more tool×mode pairs: every tool that re-raises (FastMCP
wraps it as ``"Error calling tool 'x': <str(exc)>"``), the KİK / Rekabet /
Sayıştay / KVKK document clients, the health probe's ``reason``, Bedesten's
own ``FMTE`` text through all 26 legislation tools, a Bedesten document
whose conversion failed (the error sentence was returned AS the document),
and one silent empty list (KVKK search under any outage).

Every failure now carries the typed shape — ``error_code`` (a FailureKind),
``retryable``, ``retry_after``, ``status_code``, ``error`` and ``message`` =
``"<KIND> retry_after=N.N: <safe message>"`` — or, for a tool that raises, an
MCP tool error whose text is that marker. The raw text goes to the server log
only. Everything here is offline: respx intercepts every host.
"""

import base64
import importlib.util
import json
import os
import ssl
from pathlib import Path
from typing import Any, Dict

import httpx
import pytest
import respx
from fastmcp import Client

import mcp_server_main
from bedesten_rate_limit import bedesten_rate_limiter
from legal_contracts import (
    FailureKind,
    InvalidToolInput,
    UpstreamContractError,
    classify_exception,
    classify_exception_chain,
    failure_fields,
    failure_from_marker,
    failure_marker,
)

SENTINEL = "ZZLEAK"
TLS_TEXT = f"[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed {SENTINEL}"
FAILURE_KINDS = {k.value for k in FailureKind}
TYPED_KEYS = ("error", "error_code", "status_code", "retry_after", "retryable", "message")

# mode -> (respx route kwargs, expected kind)
MODES: Dict[str, Any] = {
    "ssl": ({"side_effect": httpx.ConnectError(TLS_TEXT)}, "UNAVAILABLE"),
    "connect": ({"side_effect": httpx.ConnectError(f"{SENTINEL} connection refused")}, "UNAVAILABLE"),
    "timeout": ({"side_effect": httpx.ReadTimeout(f"{SENTINEL} timed out")}, "TIMEOUT"),
    "raw_ssl": ({"side_effect": ssl.SSLError(1, f"{SENTINEL} raw ssl")}, "UNAVAILABLE"),
    "server_500": ({"return_value": httpx.Response(500, text=f"{SENTINEL} oops")}, "UNAVAILABLE"),
}
GARBAGE = httpx.Response(
    200, text=f"<html><body>{SENTINEL} bakim</body></html>", headers={"Content-Type": "text/html"}
)


@pytest.fixture(autouse=True)
def _pristine_limiter():
    bedesten_rate_limiter.reset()
    yield
    bedesten_rate_limiter.reset()


def _dump(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _assert_no_raw_text(text: str, context: str) -> None:
    assert SENTINEL not in text, f"{context}: raw text reached the wire: {text[:400]}"
    assert "SSL" not in text and "CERTIFICATE" not in text, f"{context}: {text[:400]}"


def _assert_typed(payload: Dict[str, Any], kind: str, context: str) -> None:
    for key in TYPED_KEYS:
        assert key in payload, f"{context}: missing typed field {key}: {payload}"
    assert payload["error_code"] == kind, f"{context}: {payload['error_code']} != {kind}"
    assert payload["message"].startswith(f"{kind} retry_after="), context
    assert payload["retryable"] is (kind in {"UNAVAILABLE", "TIMEOUT", "RATE_LIMITED"}), context
    _assert_no_raw_text(_dump(payload), context)


async def _call(app, tool: str, args: Dict[str, Any]):
    async with Client(app) as client:
        return await client.call_tool_mcp(tool, args)


async def _payload(app, tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    result = await _call(app, tool, args)
    assert result.isError is False, f"{tool}: {result.content[0].text[:300]}"
    return json.loads(result.content[0].text)


# --- legal_contracts: the shared vocabulary ---------------------------------


def test_provider_error_is_classified_as_authored():
    refusal = classify_exception(InvalidToolInput("ozelge_id must be a positive integer"))
    assert refusal.kind is FailureKind.INVALID_REQUEST and refusal.retryable is False
    assert refusal.safe_message == "ozelge_id must be a positive integer"
    shape = classify_exception(UpstreamContractError("Upstream did not return a PDF document."))
    assert shape.kind is FailureKind.PARSER_ERROR and shape.retryable is False
    # Still a ValueError: every existing ``except ValueError`` keeps catching it.
    assert isinstance(InvalidToolInput("x"), ValueError)


def test_marker_round_trip_matches_the_control_plane_rule():
    for kind, retryable, expect_retryable in (
        (FailureKind.UNAVAILABLE, True, True),
        (FailureKind.UNAVAILABLE, False, False),
        (FailureKind.TIMEOUT, True, True),
        (FailureKind.NOT_FOUND, False, False),
        (FailureKind.PARSER_ERROR, False, False),
    ):
        original = classify_exception(
            UpstreamContractError("safe text", kind=kind, retryable=retryable)
        )
        marker = failure_marker(original)
        back = failure_from_marker("wrapper prefix: " + marker)
        assert back is not None and back.kind is kind
        assert back.retryable is expect_retryable
        assert back.safe_message == "safe text"
        assert failure_fields(back)["message"] == marker
    assert failure_from_marker("Özelge 5 not found") is None
    assert failure_from_marker("") is None


def test_openai_sdk_errors_are_classified_not_unexpected():
    """The embedding SDK ships its own HTTP stack (httpx2), so its errors are
    not httpx errors and used to classify as "Unexpected upstream failure"."""
    openai = pytest.importorskip("openai")
    httpx2 = pytest.importorskip("httpx2")
    request = httpx2.Request("POST", "https://openrouter.ai/api/v1/embeddings")

    try:
        try:
            raise httpx2.ConnectError(TLS_TEXT, request=request)
        except httpx2.ConnectError as cause:
            raise openai.APIConnectionError(request=request) from cause
    except openai.APIConnectionError as exc:
        conn = classify_exception_chain(exc)
    assert conn.kind is FailureKind.UNAVAILABLE and conn.retryable is True

    timeout = classify_exception_chain(openai.APITimeoutError(request=request))
    assert timeout.kind is FailureKind.TIMEOUT

    def status_error(cls, status, headers=None):
        response = httpx2.Response(status, request=request, headers=headers or {})
        return cls(f"{SENTINEL} body", response=response, body=None)

    limited = classify_exception_chain(
        status_error(openai.RateLimitError, 429, {"Retry-After": "7"})
    )
    assert limited.kind is FailureKind.RATE_LIMITED and limited.retry_after_ms == 7000
    assert classify_exception_chain(
        status_error(openai.AuthenticationError, 401)
    ).kind is FailureKind.UNAUTHORIZED
    server = classify_exception_chain(status_error(openai.InternalServerError, 503))
    assert server.kind is FailureKind.UNAVAILABLE and server.upstream_status == 503
    for failure in (conn, timeout, limited, server):
        _assert_no_raw_text(failure_marker(failure), "openai")


# --- BTK document (the W22 open item) ---------------------------------------

BTK_PDF_URL = "https://www.btk.gov.tr/uploads/kararlar/karar-2026-1.pdf"


@pytest.mark.parametrize("mode", sorted(MODES))
@respx.mock
async def test_btk_document_failure_is_typed(mode):
    spec, kind = MODES[mode]
    respx.route().mock(**spec)
    payload = await _payload(
        mcp_server_main.app, "get_btk_document_markdown", {"pdf_url": BTK_PDF_URL}
    )
    assert payload["markdown_chunk"] is None
    assert payload["error_message"].startswith(f"{kind} retry_after=")
    _assert_typed(payload, kind, f"btk/{mode}")


@respx.mock
async def test_btk_document_html_page_at_a_pdf_url_is_a_parse_failure():
    """A 200 HTML maintenance page at a .pdf URL used to be converted and
    returned AS the decision text."""
    respx.route().mock(return_value=GARBAGE)
    payload = await _payload(
        mcp_server_main.app, "get_btk_document_markdown", {"pdf_url": BTK_PDF_URL}
    )
    assert payload["markdown_chunk"] is None
    _assert_typed(payload, "PARSER_ERROR", "btk/garbage")


async def test_btk_document_bad_url_is_the_callers_to_fix():
    payload = await _payload(
        mcp_server_main.app,
        "get_btk_document_markdown",
        {"pdf_url": "https://example.com/x.pdf"},
    )
    assert payload["error_code"] == "INVALID_REQUEST"
    assert payload["retryable"] is False


@respx.mock
async def test_btk_document_success_carries_no_error_fields():
    from tests.intake.pdf_fixtures import build_multipage_pdf

    respx.route().mock(
        return_value=httpx.Response(
            200,
            content=build_multipage_pdf([["BTK Kurul Karari metni"]]),
            headers={"Content-Type": "application/pdf"},
        )
    )
    payload = await _payload(
        mcp_server_main.app, "get_btk_document_markdown", {"pdf_url": BTK_PDF_URL}
    )
    assert payload["markdown_chunk"]
    assert payload["error_message"] is None
    for key in TYPED_KEYS:
        assert key not in payload, key


# --- GİB özelge document (the W22 open item) --------------------------------


@pytest.mark.parametrize("mode", sorted(MODES))
@respx.mock
async def test_gib_document_failure_is_typed(mode):
    spec, kind = MODES[mode]
    respx.route().mock(**spec)
    payload = await _payload(
        mcp_server_main.app, "get_gib_ozelge_document_markdown", {"ozelge_id": 38849}
    )
    assert payload["markdown_chunk"] is None
    assert payload["error_message"].startswith(f"{kind} retry_after=")
    _assert_typed(payload, kind, f"gib/{mode}")


@respx.mock
async def test_gib_document_garbage_is_a_parse_failure():
    respx.route().mock(return_value=GARBAGE)
    payload = await _payload(
        mcp_server_main.app, "get_gib_ozelge_document_markdown", {"ozelge_id": 38849}
    )
    _assert_typed(payload, "PARSER_ERROR", "gib/garbage")


@respx.mock
async def test_gib_document_absent_is_not_found_not_an_outage():
    respx.route().mock(
        return_value=httpx.Response(
            200, json={"resultContainer": {"content": [], "totalElements": 0}}
        )
    )
    payload = await _payload(
        mcp_server_main.app, "get_gib_ozelge_document_markdown", {"ozelge_id": 38849}
    )
    _assert_typed(payload, "NOT_FOUND", "gib/absent")


@respx.mock
async def test_gib_document_success_carries_no_error_fields():
    respx.route().mock(
        return_value=httpx.Response(
            200,
            json={
                "resultContainer": {
                    "content": [
                        {
                            "id": 38849,
                            "title": "KDV oranı hk.",
                            "ozelgeNo": "E-1",
                            "description": "<p>Özelge metni burada.</p>",
                        }
                    ],
                    "totalElements": 1,
                }
            },
        )
    )
    payload = await _payload(
        mcp_server_main.app, "get_gib_ozelge_document_markdown", {"ozelge_id": 38849}
    )
    assert payload["markdown_chunk"] and "Özelge metni" in payload["markdown_chunk"]
    assert payload["error_message"] is None
    for key in TYPED_KEYS:
        assert key not in payload, key


# --- The other document clients the audit caught ----------------------------


@pytest.mark.parametrize("mode", ["ssl", "raw_ssl"])
@respx.mock
async def test_kik_rekabet_sayistay_documents_carry_no_driver_text(mode):
    spec, kind = MODES[mode]
    respx.route().mock(**spec)
    cases = (
        ("get_kik_v2_document_markdown", {"gundemMaddesiId": "abc"}),
        ("get_rekabet_kurumu_document", {"karar_id": "abc"}),
        ("get_sayistay_document_unified", {"decision_id": "1", "decision_type": "genel_kurul"}),
        ("search_kik_v2_decisions", {"karar_metni": "ihale"}),
    )
    for tool, args in cases:
        payload = await _payload(mcp_server_main.app, tool, args)
        _assert_typed(payload, kind, f"{tool}/{mode}")


@respx.mock
async def test_kik_search_upstream_body_never_reaches_the_wire():
    """A pydantic error on KİK's response model quoted the upstream body in
    ``input_value``; an HTTP error used to append ``e.response.text``."""
    respx.route().mock(
        return_value=httpx.Response(200, json={"unexpected": f"{SENTINEL} body"})
    )
    payload = await _payload(
        mcp_server_main.app, "search_kik_v2_decisions", {"karar_metni": "ihale"}
    )
    _assert_typed(payload, "PARSER_ERROR", "kik/shape")


@pytest.mark.parametrize("mode", sorted(MODES))
@respx.mock
async def test_kvkk_search_outage_is_never_a_silent_empty_list(mode, monkeypatch):
    monkeypatch.setattr(mcp_server_main.kvkk_client_instance, "brave_api_token", "offline-test")
    spec, kind = MODES[mode]
    respx.route().mock(**spec)
    payload = await _payload(mcp_server_main.app, "search_kvkk_decisions", {"keywords": "veri"})
    assert payload["decisions"] == []
    _assert_typed(payload, kind, f"kvkk-search/{mode}")


@respx.mock
async def test_kvkk_document_failure_is_typed(monkeypatch):
    monkeypatch.setattr(mcp_server_main.kvkk_client_instance, "brave_api_token", "offline-test")
    respx.route().mock(side_effect=httpx.ConnectError(TLS_TEXT))
    payload = await _payload(
        mcp_server_main.app,
        "get_kvkk_document_markdown",
        {"decision_url": "https://www.kvkk.gov.tr/Icerik/7288/2021-1303"},
    )
    _assert_typed(payload, "UNAVAILABLE", "kvkk-doc/ssl")


@respx.mock
async def test_bedesten_unconvertible_document_is_not_returned_as_text():
    """An unsupported mime type used to come back as the DOCUMENT
    ("Unsupported content type: … Unable to convert to markdown.")."""
    respx.route().mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "content": base64.b64encode(b"PK\x03\x04").decode("ascii"),
                    "mimeType": "application/zip",
                    "version": 1,
                },
                "metadata": {"FMTY": "SUCCESS"},
            },
        )
    )
    payload = await _payload(
        mcp_server_main.app, "get_bedesten_document_markdown", {"documentId": "730113500"}
    )
    body = payload["markdown_content"]
    assert body.startswith("ERROR (upstream_parse_error, HTTP 502): PARSER_ERROR retry_after=")
    assert "Unsupported content type:" not in body


# --- Tools that RAISE: FastMCP's "Error calling tool 'x': <str(exc)>" -------

RAISING_TOOLS = (
    ("search_emsal_detailed_decisions", {"keyword": "kira"}),
    ("get_emsal_document_markdown", {"id": "123"}),
    ("search_uyusmazlik_decisions", {"icerik": "kira"}),
    ("search_anayasa_unified", {"decision_type": "norm_denetimi", "keywords": ["mülkiyet"]}),
)


@pytest.mark.parametrize("mode", ["ssl", "raw_ssl"])
@respx.mock
async def test_raising_tools_answer_a_typed_marker(mode):
    spec, kind = MODES[mode]
    respx.route().mock(**spec)
    for tool, args in RAISING_TOOLS:
        result = await _call(mcp_server_main.app, tool, args)
        text = result.content[0].text
        assert result.isError is True, tool
        assert text.startswith(f"{kind} retry_after="), (tool, text)
        _assert_no_raw_text(text, tool)


@respx.mock
async def test_unknown_exception_is_unavailable_not_retryable():
    respx.route().mock(side_effect=RuntimeError(f"{SENTINEL} boom"))
    result = await _call(mcp_server_main.app, "search_emsal_detailed_decisions", {"keyword": "kira"})
    text = result.content[0].text
    assert result.isError is True
    assert text == "UNAVAILABLE retry_after=0.0: Unexpected upstream failure."


async def test_argument_validation_text_is_left_for_invalid_request():
    """FastMCP's own argument validation is the ONE failure that is the
    caller's to fix; failureText.ts keys INVALID_REQUEST on its wording."""
    result = await _call(mcp_server_main.app, "get_gib_ozelge_document_markdown", {})
    assert result.isError is True
    assert "validation error for call[get_gib_ozelge_document_markdown]" in result.content[0].text


async def test_input_refusal_is_a_typed_invalid_request():
    result = await _call(mcp_server_main.app, "get_emsal_document_markdown", {"id": " "})
    assert result.isError is True
    assert result.content[0].text.startswith("INVALID_REQUEST retry_after=0.0: ")


# --- Health probe ------------------------------------------------------------


@respx.mock
async def test_health_probe_reason_names_the_class_not_the_driver():
    respx.route().mock(side_effect=httpx.ConnectError(TLS_TEXT))
    payload = await _payload(mcp_server_main.app, "check_government_servers_health", {})
    for name in ("yargitay", "bedesten"):
        server = payload["servers"][name]
        assert server["status"] == "unhealthy"
        assert server["reason"].startswith("Connection error: ")
        assert server["error_code"] == "UNAVAILABLE"
        assert server["retryable"] is True
    _assert_no_raw_text(_dump(payload), "health")


# --- Legislation: Bedesten's own FMTE text -----------------------------------


def _fmte(message: str) -> httpx.Response:
    return httpx.Response(
        200, json={"data": None, "metadata": {"FMTY": "ERROR", "FMTE": message}}
    )


@respx.mock
async def test_legislation_search_never_echoes_fmte():
    respx.route().mock(return_value=_fmte(f"{SENTINEL} sunucu hatası"))
    payload = await _payload(mcp_server_main.app, "search_kanun", {"aranacak_ifade": "kira"})
    assert payload["documents"] == []
    assert payload["error_message"].startswith("UNAVAILABLE retry_after=30.0: ")
    _assert_no_raw_text(_dump(payload), "search_kanun/fmte")


@respx.mock
async def test_legislation_content_never_echoes_fmte():
    respx.route().mock(return_value=_fmte(f"{SENTINEL} sunucu hatası"))
    result = await _call(mcp_server_main.app, "get_mevzuat_content", {"mevzuat_id": "6098"})
    text = result.content[0].text
    assert result.isError is True
    assert text.startswith("UNAVAILABLE retry_after=30.0: ")
    _assert_no_raw_text(text, "get_mevzuat_content/fmte")


@respx.mock
async def test_legislation_fmte_not_found_stays_not_found():
    respx.route().mock(return_value=_fmte(f"Belge bulunamadı {SENTINEL}"))
    result = await _call(mcp_server_main.app, "get_mevzuat_content", {"mevzuat_id": "6098"})
    text = result.content[0].text
    assert result.isError is True
    assert text.startswith("NOT_FOUND retry_after=0.0: ")
    _assert_no_raw_text(text, "get_mevzuat_content/fmte-not-found")


# --- The conditional 55th tool: search_bedesten_semantic ---------------------

REPO_ROOT = Path(__file__).resolve().parents[1]

COURT_SEARCH_ONE = {
    "data": {
        "emsalKararList": [
            {
                "documentId": "1001",
                "itemType": {"name": "YARGITAYKARARI", "description": "Yargıtay Kararı"},
                "birimAdi": "3. Hukuk Dairesi",
                "kararTarihi": "2024-01-01T00:00:00.000+00:00",
                "kararTarihiStr": "01.01.2024",
                "esasNo": "2023/1",
                "kararNo": "2024/1",
            }
        ],
        "total": 1,
        "start": 0,
    },
    "metadata": {"FMTY": "SUCCESS"},
}
COURT_DOCUMENT = {
    "data": {
        "content": base64.b64encode(
            ("<p>" + "Kiracının tahliyesi ve kira bedeli hakkında karar. " * 30 + "</p>").encode("utf-8")
        ).decode("ascii"),
        "mimeType": "text/html",
        "version": 1,
    },
    "metadata": {"FMTY": "SUCCESS"},
}
SEMANTIC_ARGS = {"initial_keyword": "kira", "query": "Kiracının tahliyesi davası hakkında karar"}


@pytest.fixture(scope="module")
def semantic_server():
    """A fresh copy of the gateway with OPENROUTER_API_KEY set, so the
    conditional 55th tool is registered. The key is a dummy: every embedder
    call is replaced by a fake and every host is intercepted by respx."""
    saved = {k: os.environ.get(k) for k in ("OPENROUTER_API_KEY", "COLLEX_NO_DOTENV")}
    os.environ["OPENROUTER_API_KEY"] = "offline-dummy-openrouter-key"
    os.environ["COLLEX_NO_DOTENV"] = "1"
    try:
        spec = importlib.util.spec_from_file_location(
            "_mcp_server_main_with_embedding_key", REPO_ROOT / "mcp_server_main.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    assert module.SEMANTIC_SEARCH_AVAILABLE is True
    return module


async def test_semantic_tool_is_registered_as_the_55th(semantic_server):
    async with Client(semantic_server.app) as client:
        names = {tool.name for tool in await client.list_tools()}
    assert "search_bedesten_semantic" in names
    assert len(names) == 55


class _FakeEmbedder:
    model = "offline-test-embedding"
    dimension = 2

    def __init__(self, error: BaseException | None = None):
        self._error = error

    def encode_query(self, query, task=""):
        import numpy as np

        if self._error is not None:
            raise self._error
        return np.array([1.0, 0.0], dtype=np.float32)

    def encode_documents(self, documents, titles=None):
        import numpy as np

        if self._error is not None:
            raise self._error
        return np.array([[1.0, 0.0]] * len(documents), dtype=np.float32)


@pytest.mark.parametrize("mode", sorted(MODES))
@respx.mock
async def test_semantic_tool_upstream_failure_is_typed(mode, semantic_server, monkeypatch):
    monkeypatch.setattr(semantic_server, "get_embedder", lambda: _FakeEmbedder())
    spec, kind = MODES[mode]
    respx.route().mock(**spec)
    payload = await _payload(semantic_server.app, "search_bedesten_semantic", SEMANTIC_ARGS)
    assert payload["status"] == "error"
    assert payload["results"] == []
    _assert_typed(payload, kind, f"semantic/{mode}")


@respx.mock
async def test_semantic_tool_garbage_is_a_parse_failure(semantic_server, monkeypatch):
    monkeypatch.setattr(semantic_server, "get_embedder", lambda: _FakeEmbedder())
    respx.route().mock(return_value=GARBAGE)
    payload = await _payload(semantic_server.app, "search_bedesten_semantic", SEMANTIC_ARGS)
    assert payload["status"] == "error"
    _assert_typed(payload, "PARSER_ERROR", "semantic/garbage")


def _openai_errors():
    openai = pytest.importorskip("openai")
    httpx2 = pytest.importorskip("httpx2")
    request = httpx2.Request("POST", "https://openrouter.ai/api/v1/embeddings")

    def status(cls, code):
        return cls(
            f"{SENTINEL} provider body",
            response=httpx2.Response(code, request=request),
            body={"error": SENTINEL},
        )

    connect = openai.APIConnectionError(message=f"{SENTINEL} Connection error.", request=request)
    connect.__cause__ = httpx2.ConnectError(TLS_TEXT, request=request)
    return (
        ("connect", connect, "UNAVAILABLE"),
        ("timeout", openai.APITimeoutError(request=request), "TIMEOUT"),
        ("rate_limited", status(openai.RateLimitError, 429), "RATE_LIMITED"),
        ("server_500", status(openai.InternalServerError, 500), "UNAVAILABLE"),
        ("unauthorized", status(openai.AuthenticationError, 401), "UNAUTHORIZED"),
    )


@respx.mock
async def test_semantic_tool_embedding_failure_is_typed(semantic_server, monkeypatch):
    respx.post(url__regex=r".*/searchDocuments$").mock(
        return_value=httpx.Response(200, json=COURT_SEARCH_ONE)
    )
    respx.post(url__regex=r".*/getDocumentContent$").mock(
        return_value=httpx.Response(200, json=COURT_DOCUMENT)
    )
    for label, error, kind in _openai_errors():
        bedesten_rate_limiter.reset()
        monkeypatch.setattr(semantic_server, "get_embedder", lambda e=error: _FakeEmbedder(e))
        payload = await _payload(semantic_server.app, "search_bedesten_semantic", SEMANTIC_ARGS)
        assert payload["status"] == "error", label
        _assert_typed(payload, kind, f"semantic-embedding/{label}")


@respx.mock
async def test_semantic_tool_every_document_failed_is_typed(semantic_server, monkeypatch):
    monkeypatch.setattr(semantic_server, "get_embedder", lambda: _FakeEmbedder())
    respx.post(url__regex=r".*/searchDocuments$").mock(
        return_value=httpx.Response(200, json=COURT_SEARCH_ONE)
    )
    respx.post(url__regex=r".*/getDocumentContent$").mock(
        side_effect=httpx.ConnectError(TLS_TEXT)
    )
    payload = await _payload(semantic_server.app, "search_bedesten_semantic", SEMANTIC_ARGS)
    assert payload["status"] == "processing_error"
    assert payload["failed_fetches"] == 1
    _assert_typed(payload, "UNAVAILABLE", "semantic/all-fetches-failed")


@respx.mock
async def test_semantic_tool_success_carries_no_error_fields(semantic_server, monkeypatch):
    monkeypatch.setattr(semantic_server, "get_embedder", lambda: _FakeEmbedder())
    respx.post(url__regex=r".*/searchDocuments$").mock(
        return_value=httpx.Response(200, json=COURT_SEARCH_ONE)
    )
    respx.post(url__regex=r".*/getDocumentContent$").mock(
        return_value=httpx.Response(200, json=COURT_DOCUMENT)
    )
    payload = await _payload(semantic_server.app, "search_bedesten_semantic", SEMANTIC_ARGS)
    assert payload["status"] == "success"
    assert payload["results"] and payload["results"][0]["document_id"] == "1001"
    for key in ("error", "error_code", "retryable"):
        assert key not in payload, key
