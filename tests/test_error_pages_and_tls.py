"""An upstream error page is a typed failure, and TLS is verified (W22 follow-up).

Two findings of the 54(+1)-tool failure-text audit (27.09.2026):

1. Five document tools (Uyuşmazlık, KİK, Sayıştay, Sigorta Tahkim, BDDK)
   returned whatever body a 200 carried as ``markdown_content`` — a
   maintenance page, an ASP.NET error screen, a JSON error object — so an
   outage could be sealed downstream as the decision's own text. The pages
   below are the real shapes such servers send (IIS, ASP.NET, nginx, F5,
   Turkish maintenance / not-found titles). The decision is taken only from
   evidence the response carries (legal_contracts/pages.py): the magic bytes
   of a PDF source, JSON where HTML was due, a known error-page title or a
   default server string, an empty body or empty extracted text.

2. The health probe and both KİK contexts ran with certificate verification
   OFF (``verify=False`` / ``CERT_NONE``) since the upstream import, with no
   reason recorded in the code, the comments or the history — and the KİK
   document URL is named by the upstream's own ``GetSorgulamaUrl`` answer.
   Verification is back on; a certificate failure reads as its own typed
   reason, and the KİK document fetch cannot leave the KİK hosts.

Offline: respx intercepts every host.
"""

import json
import re
import ssl
from pathlib import Path
from typing import Any, Dict

import httpx
import pytest
import respx
from fastmcp import Client

import mcp_server_main
from bedesten_rate_limit import bedesten_rate_limiter
from legal_contracts import FailureKind, classify_exception_chain
from legal_contracts.pages import check_document_body, error_page_failure

REPO_ROOT = Path(__file__).resolve().parents[1]

# --- Realistic error pages ----------------------------------------------------

IIS_503 = (
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN""http://www.w3.org/TR/html4/strict.dtd">\r\n'
    "<HTML><HEAD><TITLE>Service Unavailable</TITLE>\r\n"
    '<META HTTP-EQUIV="Content-Type" Content="text/html; charset=us-ascii"></HEAD>\r\n'
    "<BODY><h2>Service Unavailable</h2>\r\n<hr><p>HTTP Error 503. The service is unavailable.</p>\r\n"
    "</BODY></HTML>\r\n"
)
ASPNET_YELLOW = (
    "<!DOCTYPE html>\n<html>\n    <head>\n        <title>Runtime Error</title>\n"
    '        <meta name="viewport" content="width=device-width" />\n    </head>\n'
    '    <body bgcolor="white">\n'
    "            <span><H1>Server Error in '/' Application.<hr width=100% size=1 color=silver></H1>\n"
    "            <h2> <i>Runtime Error</i> </h2></span>\n"
    "            <b> Description: </b>An application error occurred on the server.\n"
    "    </body>\n</html>\n"
)
NGINX_502 = (
    "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n"
    "<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n"
    "</body>\r\n</html>\r\n"
)
F5_REJECTED = (
    "<html><head><title>Request Rejected</title></head><body>"
    "The requested URL was rejected. Please consult with your administrator.<br><br>"
    "Your support ID is: 1234567890123456789<br><br>"
    "<a href='javascript:history.back();'>[Go Back]</a></body></html>"
)
TR_MAINTENANCE = (
    "<!DOCTYPE html><html lang='tr'><head><meta charset='utf-8'>"
    "<title>Bakım Çalışması</title></head><body><h1>Sistem Bakımı</h1>"
    "<p>Sistemimiz geçici olarak hizmet verememektedir. Lütfen daha sonra tekrar deneyiniz.</p>"
    "</body></html>"
)
TR_NOT_FOUND = (
    "<!DOCTYPE html><html lang='tr'><head><meta charset='utf-8'>"
    "<title>Sayfa Bulunamadı</title></head><body><h1>404</h1>"
    "<p>Aradığınız sayfa bulunamadı.</p></body></html>"
)
JSON_ERROR = '{"Message":"An error has occurred.","ExceptionMessage":"Object reference not set"}'

# A decision page that must NOT be taken for an error page: its title is the
# decision, its heading cites "403 sayılı" and its body says "bulunamadığından".
DECISION_PAGE = (
    "<!DOCTYPE html><html lang='tr'><head><meta charset='utf-8'>"
    "<title>Kurul Kararı 2024/UH.I-1234</title></head><body>"
    "<h1>4734 sayılı Kanun ve 403 sayılı Karar uyarınca inceleme</h1>"
    "<p>Başvuru sahibinin iddialarını destekler nitelikte belge bulunamadığından "
    "başvurunun reddine karar verildi. Sayfa bulunamadı ibaresi de bir alıntıdır.</p>"
    "</body></html>"
)


def _html(text: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, text=text, headers={"Content-Type": "text/html; charset=utf-8"})


@pytest.fixture(autouse=True)
def _pristine_limiter():
    bedesten_rate_limiter.reset()
    yield
    bedesten_rate_limiter.reset()


async def _call(tool: str, args: Dict[str, Any]):
    async with Client(mcp_server_main.app) as client:
        return await client.call_tool_mcp(tool, args)


async def _payload(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    result = await _call(tool, args)
    assert result.isError is False, result.content[0].text[:300]
    return json.loads(result.content[0].text)


# --- legal_contracts.pages: the evidence rules -------------------------------


@pytest.mark.parametrize(
    "page, kind",
    [
        (IIS_503, FailureKind.UNAVAILABLE),
        (ASPNET_YELLOW, FailureKind.UNAVAILABLE),
        (NGINX_502, FailureKind.UNAVAILABLE),
        (F5_REJECTED, FailureKind.UNAVAILABLE),
        (TR_MAINTENANCE, FailureKind.UNAVAILABLE),
        (TR_NOT_FOUND, FailureKind.NOT_FOUND),
    ],
)
def test_known_error_pages_are_recognised(page, kind):
    failure = error_page_failure(page)
    assert failure is not None and failure.kind is kind


def test_a_decision_page_is_not_an_error_page():
    """Guard: body words and a bare statute number are never evidence."""
    assert error_page_failure(DECISION_PAGE) is None
    check_document_body(DECISION_PAGE.encode("utf-8"), "text/html", expect="html")


@pytest.mark.parametrize(
    "body, content_type, expect, kind",
    [
        (b"", "text/html", "html", FailureKind.PARSER_ERROR),
        (b"   \n", "application/pdf", "pdf", FailureKind.PARSER_ERROR),
        (JSON_ERROR.encode(), "application/json", "html", FailureKind.PARSER_ERROR),
        (JSON_ERROR.encode(), "text/html", "html", FailureKind.PARSER_ERROR),
        (b"<html><body>no marker</body></html>", "text/html", "pdf", FailureKind.PARSER_ERROR),
        (TR_MAINTENANCE.encode(), "text/html", "pdf", FailureKind.UNAVAILABLE),
        (TR_NOT_FOUND.encode(), "text/html", "pdf_or_html", FailureKind.NOT_FOUND),
    ],
)
def test_check_document_body_raises_the_typed_failure(body, content_type, expect, kind):
    with pytest.raises(Exception) as raised:
        check_document_body(body, content_type, expect=expect)
    assert classify_exception_chain(raised.value).kind is kind


def test_a_pdf_passes_the_pdf_check():
    from tests.intake.pdf_fixtures import build_multipage_pdf

    check_document_body(build_multipage_pdf([["karar"]]), "application/pdf", expect="pdf")
    check_document_body(build_multipage_pdf([["karar"]]), "application/pdf", expect="pdf_or_html")


# --- Uyuşmazlık (a PDF source; the tool raises on failure) --------------------

UYUSMAZLIK_URL = "https://kararlar.uyusmazlik.gov.tr/Karar/Getir/123"


@pytest.mark.parametrize(
    "response, kind",
    [
        (_html(IIS_503), "UNAVAILABLE"),
        (_html(TR_NOT_FOUND), "NOT_FOUND"),
        (httpx.Response(200, text=JSON_ERROR, headers={"Content-Type": "application/json"}), "PARSER_ERROR"),
        (httpx.Response(200, content=b"", headers={"Content-Type": "application/pdf"}), "PARSER_ERROR"),
    ],
)
@respx.mock
async def test_uyusmazlik_error_page_is_not_a_document(response, kind):
    respx.route().mock(return_value=response)
    result = await _call("get_uyusmazlik_document_markdown_from_url", {"document_url": UYUSMAZLIK_URL})
    assert result.isError is True
    assert result.content[0].text.startswith(f"{kind} retry_after="), result.content[0].text


@respx.mock
async def test_uyusmazlik_pdf_is_still_a_document():
    from tests.intake.pdf_fixtures import build_multipage_pdf

    respx.route().mock(
        return_value=httpx.Response(
            200,
            content=build_multipage_pdf([["Uyusmazlik Mahkemesi karari"]]),
            headers={"Content-Type": "application/pdf"},
        )
    )
    payload = await _payload("get_uyusmazlik_document_markdown_from_url", {"document_url": UYUSMAZLIK_URL})
    assert "Uyusmazlik Mahkemesi karari" in payload["markdown_content"]


# --- KİK (an HTML source reached through GetSorgulamaUrl) --------------------

KIK_API = "https://ekapv2.kik.gov.tr/b_ihalearaclari/api/KurulKararlari/GetSorgulamaUrl"
KIK_DOC = re.compile(r"https://ekap\.kik\.gov\.tr/EKAP/Vatandas/KurulKararGoster\.aspx.*")


def _kik_routes(document_response: httpx.Response, sorgulama_url: str | None = None):
    respx.post(KIK_API).mock(
        return_value=httpx.Response(
            200,
            json={"sorgulamaUrl": sorgulama_url or "https://ekap.kik.gov.tr/EKAP/Vatandas/KurulKararGoster.aspx"},
        )
    )
    return respx.get(url__regex=KIK_DOC.pattern).mock(return_value=document_response)


@pytest.mark.parametrize(
    "response, kind",
    [
        (_html(ASPNET_YELLOW), "UNAVAILABLE"),
        (_html(F5_REJECTED), "UNAVAILABLE"),
        (httpx.Response(200, text=JSON_ERROR, headers={"Content-Type": "application/json"}), "PARSER_ERROR"),
        (_html(""), "PARSER_ERROR"),
    ],
)
@respx.mock
async def test_kik_error_page_is_not_a_document(response, kind):
    _kik_routes(response)
    payload = await _payload("get_kik_v2_document_markdown", {"gundemMaddesiId": "abc"})
    assert payload["markdown_content"] == ""
    assert payload["error_code"] == kind
    assert payload["error_message"].startswith(f"{kind} retry_after=")


@respx.mock
async def test_kik_decision_page_is_still_a_document():
    _kik_routes(_html(DECISION_PAGE))
    payload = await _payload("get_kik_v2_document_markdown", {"gundemMaddesiId": "abc"})
    assert "bulunamadığından" in payload["markdown_content"]
    assert "error_code" not in payload


@respx.mock
async def test_kik_document_never_leaves_the_kik_hosts():
    """``GetSorgulamaUrl`` is upstream text; a URL it names elsewhere is not followed."""
    elsewhere = respx.get(url__regex=r"https://evil\.example\.com/.*").mock(
        return_value=_html(DECISION_PAGE)
    )
    kik = _kik_routes(_html(DECISION_PAGE), sorgulama_url="https://evil.example.com/steal")
    payload = await _payload("get_kik_v2_document_markdown", {"gundemMaddesiId": "abc"})
    assert not elsewhere.called
    assert kik.called
    assert payload["source_url"].startswith("https://ekap.kik.gov.tr/")
    for bad in ("http://ekap.kik.gov.tr/x", "https://ekap.kik.gov.tr.evil.com/x", "https://kik.gov.tr@evil.com/"):
        from kik_mcp_module.client_v2 import KIK_DOCUMENT_FALLBACK_URL, kik_document_url

        assert kik_document_url(bad) == KIK_DOCUMENT_FALLBACK_URL, bad


# --- Sayıştay (an HTML source) ------------------------------------------------


@pytest.mark.parametrize(
    "response, kind",
    [(_html(NGINX_502), "UNAVAILABLE"), (_html(TR_MAINTENANCE), "UNAVAILABLE"), (_html(TR_NOT_FOUND), "NOT_FOUND")],
)
@respx.mock
async def test_sayistay_error_page_is_not_a_document(response, kind):
    respx.route().mock(return_value=response)
    payload = await _payload(
        "get_sayistay_document_unified", {"decision_id": "1", "decision_type": "genel_kurul"}
    )
    assert payload["markdown_content"] is None
    assert payload["error_code"] == kind


@respx.mock
async def test_sayistay_decision_page_is_still_a_document():
    respx.route().mock(return_value=_html(DECISION_PAGE))
    payload = await _payload(
        "get_sayistay_document_unified", {"decision_id": "1", "decision_type": "genel_kurul"}
    )
    assert "bulunamadığından" in payload["markdown_content"]
    assert "error_code" not in payload


# --- Sigorta Tahkim (a PDF source) --------------------------------------------


@pytest.mark.parametrize(
    "response, kind",
    [
        (_html(TR_MAINTENANCE), "UNAVAILABLE"),
        (_html("<html><body>beklenmedik</body></html>"), "PARSER_ERROR"),
        (_html(TR_NOT_FOUND), "NOT_FOUND"),
    ],
)
@respx.mock
async def test_sigorta_error_page_is_not_a_document(response, kind):
    respx.route().mock(return_value=response)
    payload = await _payload("get_sigorta_tahkim_document_markdown", {"issue_number": "64"})
    assert payload["markdown_content"] == ""
    assert payload["error_code"] == kind


async def test_sigorta_bad_issue_number_is_invalid_request():
    payload = await _payload("get_sigorta_tahkim_document_markdown", {"issue_number": "abc"})
    assert payload["error_code"] == "INVALID_REQUEST"


# --- BDDK (PDF or HTML by content type; four URL patterns) --------------------


@pytest.fixture
def _bddk_on(monkeypatch):
    monkeypatch.setattr(mcp_server_main.bddk_client_instance, "tavily_api_key", "offline-test")


@respx.mock
async def test_bddk_all_patterns_404_is_not_found(_bddk_on):
    respx.route().mock(return_value=httpx.Response(404, text="Not Found"))
    payload = await _payload("get_bddk_document_markdown", {"document_id": "310"})
    assert payload["error_code"] == "NOT_FOUND"


@respx.mock
async def test_bddk_all_patterns_503_is_an_outage_not_not_found(_bddk_on):
    respx.route().mock(return_value=httpx.Response(503, text=IIS_503))
    payload = await _payload("get_bddk_document_markdown", {"document_id": "310"})
    assert payload["error_code"] == "UNAVAILABLE"


@pytest.mark.parametrize(
    "response, kind",
    [
        (_html(IIS_503), "UNAVAILABLE"),
        (httpx.Response(200, text=JSON_ERROR, headers={"Content-Type": "application/json"}), "PARSER_ERROR"),
        (httpx.Response(200, content=b"<html>x</html>", headers={"Content-Type": "application/pdf"}), "PARSER_ERROR"),
    ],
)
@respx.mock
async def test_bddk_error_page_is_not_a_document(response, kind, _bddk_on):
    respx.route().mock(return_value=response)
    payload = await _payload("get_bddk_document_markdown", {"document_id": "310"})
    assert payload["markdown_content"] == ""
    assert payload["error_code"] == kind


# --- TLS: verification is on, and its failure has its own reason ------------

TLS_TEXT = "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate"


def test_certificate_failure_is_its_own_typed_reason():
    wrapped = httpx.ConnectError(TLS_TEXT)
    failure = classify_exception_chain(wrapped)
    assert failure.kind is FailureKind.UNAVAILABLE and failure.retryable is True
    assert failure.safe_message == "Upstream TLS certificate could not be verified."
    direct = classify_exception_chain(ssl.SSLCertVerificationError(1, "x"))
    assert direct.safe_message == "Upstream TLS certificate could not be verified."
    # An ordinary outage keeps its own sentence.
    assert classify_exception_chain(httpx.ConnectError("connection refused")).safe_message == (
        "Could not reach the upstream service."
    )


@respx.mock
async def test_kik_document_certificate_failure_reads_as_such():
    respx.post(KIK_API).mock(side_effect=httpx.ConnectError(TLS_TEXT))
    respx.get(url__regex=KIK_DOC.pattern).mock(side_effect=httpx.ConnectError(TLS_TEXT))
    payload = await _payload("get_kik_v2_document_markdown", {"gundemMaddesiId": "abc"})
    assert payload["error_code"] == "UNAVAILABLE"
    assert payload["error_message"] == (
        "UNAVAILABLE retry_after=30.0: Upstream TLS certificate could not be verified."
    )
    assert "SSL" not in json.dumps(payload) and "issuer" not in json.dumps(payload)


def test_kik_contexts_verify_certificates():
    from kik_mcp_module.client_v2 import KikV2ApiClient, legacy_compatible_ssl_context

    context = legacy_compatible_ssl_context()
    assert context.verify_mode is ssl.CERT_REQUIRED
    assert context.check_hostname is True
    if hasattr(ssl, "OP_LEGACY_SERVER_CONNECT"):
        assert context.options & ssl.OP_LEGACY_SERVER_CONNECT
    client = KikV2ApiClient()
    pool_context = client.http_client._transport._pool._ssl_context
    assert pool_context.verify_mode is ssl.CERT_REQUIRED
    assert pool_context.check_hostname is True


@respx.mock
async def test_kik_document_client_is_built_with_a_verifying_context(monkeypatch):
    import kik_mcp_module.client_v2 as kik_module

    seen = []
    real_client = httpx.AsyncClient

    class SpyClient(real_client):
        def __init__(self, *args, **kwargs):
            seen.append(kwargs.get("verify", True))
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(kik_module.httpx, "AsyncClient", SpyClient)
    _kik_routes(_html(DECISION_PAGE))
    await _payload("get_kik_v2_document_markdown", {"gundemMaddesiId": "abc"})
    assert seen, "the document client was not built"
    for verify in seen:
        assert verify is not False
        if isinstance(verify, ssl.SSLContext):
            assert verify.verify_mode is ssl.CERT_REQUIRED and verify.check_hostname


@respx.mock
async def test_health_probe_verifies_certificates(monkeypatch):
    seen = []
    real_client = httpx.AsyncClient

    class SpyClient(real_client):
        def __init__(self, *args, **kwargs):
            seen.append(kwargs.get("verify", True))
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(mcp_server_main.httpx, "AsyncClient", SpyClient)
    monkeypatch.setattr(mcp_server_main, "_health_check_client", None)
    respx.route().mock(side_effect=httpx.ConnectError(TLS_TEXT))
    payload = await _payload("check_government_servers_health", {})
    assert len(seen) == 2, seen
    assert all(verify is not False for verify in seen), seen
    for name in ("yargitay", "bedesten"):
        assert payload["servers"][name]["reason"] == (
            "Connection error: Upstream TLS certificate could not be verified."
        )


# Clients that STILL turn verification off. They came with the upstream
# import, their sources could not be measured from here (the network policy
# blocks *.gov.tr), and changing them is the lead's decision. Pinned so that
# no NEW site can appear unnoticed, and so the two fixed here cannot return.
VERIFY_OFF_ALLOWED = {
    "danistay_mcp_module/client.py",
    "emsal_mcp_module/client.py",
    "uyusmazlik_mcp_module/client.py",
    "yargitay_mcp_module/client.py",
}
_VERIFY_OFF = re.compile(r"verify\s*=\s*False|CERT_NONE|check_hostname\s*=\s*False")


def test_no_new_host_is_reached_with_verification_off():
    offenders = set()
    candidates = list(REPO_ROOT.glob("*.py")) + list(REPO_ROOT.glob("*_mcp_module/*.py"))
    candidates += list((REPO_ROOT / "legal_contracts").glob("*.py"))
    for path in candidates:
        for line in path.read_text(encoding="utf-8").splitlines():
            code = line.split("#", 1)[0]
            if _VERIFY_OFF.search(code):
                offenders.add(path.relative_to(REPO_ROOT).as_posix())
    assert offenders <= VERIFY_OFF_ALLOWED, sorted(offenders - VERIFY_OFF_ALLOWED)
    assert "mcp_server_main.py" not in offenders
    assert "kik_mcp_module/client_v2.py" not in offenders
