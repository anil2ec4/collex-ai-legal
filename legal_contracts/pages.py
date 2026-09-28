"""Evidence that an upstream answered with an ERROR PAGE instead of a document.

MEASURED, 27.09.2026 (W22 follow-up audit): five document tools
(Uyuşmazlık, KİK, Sayıştay, Sigorta Tahkim, BDDK) returned whatever body a
200 carried as ``markdown_content`` — an HTML maintenance page, a JSON error
object — so an outage was sealed downstream as the decision's text. A failure
page must be a typed failure, never document text.

The decision is taken ONLY from evidence the response itself carries, never
from a guess about what a decision "looks like":

* **content type / magic bytes** — a PDF source that did not send a PDF
  (``%PDF-`` within the first KiB), or an HTML source that sent JSON;
* **known error-page markers** in the page's ``<title>`` / ``<h1>`` (the
  default pages of IIS, ASP.NET, nginx, Apache, F5 and the Turkish
  maintenance/not-found titles) and a closed list of unambiguous server
  strings in the head of the body (``Server Error in '…' Application``,
  ``The requested URL was rejected``). The body TEXT of a page is never
  searched for words like "bulunamadı": a decision may say that;
* **an empty body**, or a document whose extracted text is empty.

What this cannot see, and says so: a 200 HTML page with no marker at all is
indistinguishable from a decision page for a source whose decision page is
HTML; it is returned as the document, as before.
"""

from __future__ import annotations

import html as _html
import re
from typing import Optional

from legal_contracts.outcomes import (
    FailureKind,
    ProviderError,
    UpstreamContractError,
    UpstreamNotFound,
)

PDF_MAGIC = b"%PDF-"
_HEAD_BYTES = 4096

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)
_H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1\s*>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")

# Checked in this order against the <title>/<h1> text only. A bare number is
# never evidence ("403 sayılı Kanun" is a heading a decision may carry): a
# status code counts only next to its reason phrase or an "Error" word.
_NOT_FOUND_HEADING = re.compile(
    r"\b404\b\s*[-–:]?\s*(?:not found|file or directory not found)|\berror 404\b"
    r"|\bnot found\b|cannot be found|sayfa bulunamad|kay[ıi]t bulunamad"
    r"|belge bulunamad|karar bulunamad",
    re.IGNORECASE,
)
_ERROR_HEADING = re.compile(
    r"\b50[0-4]\b\s*[-–:]?\s*(?:internal server error|bad gateway"
    r"|service (?:temporarily )?unavailable|gateway time-?out)|\berror 50[0-4]\b"
    r"|\b403\b\s*[-–:]?\s*forbidden|service (?:temporarily )?unavailable|bad gateway"
    r"|gateway time-?out|internal server error|runtime error|server error in"
    r"|request rejected|access denied|eri[şs]im engellendi|bak[ıi]m [çc]al[ıi][şs]mas"
    r"|sistem bak[ıi]m|under maintenance|sunucu hatas|hizmet veremiyor"
    r"|hizmet verememektedir|ge[çc]ici olarak hizmet",
    re.IGNORECASE,
)
# Unambiguous default server strings, searched in the head of the body.
_ERROR_BODY_MARKERS = re.compile(
    r"Server Error in '[^']*' Application|The requested URL was rejected"
    r"|<center>nginx</center>|Apache/\d[\d.]* Server at",
    re.IGNORECASE,
)


class UpstreamErrorPage(ProviderError):
    """The upstream answered 2xx with its own error page."""

    kind = FailureKind.UNAVAILABLE


def is_pdf(body: bytes) -> bool:
    """True when the PDF magic header occurs in the first KiB."""
    return PDF_MAGIC in (body or b"")[:1024]


def _heading_text(head: str) -> str:
    parts = []
    for regex in (_TITLE_RE, _H1_RE):
        for match in regex.finditer(head):
            parts.append(_html.unescape(_TAG_RE.sub(" ", match.group(1))))
    return " ".join(" ".join(parts).split())


def error_page_failure(body: bytes | str) -> Optional[ProviderError]:
    """The typed failure an HTML error page announces, or ``None``."""
    if isinstance(body, bytes):
        head = body[:_HEAD_BYTES].decode("utf-8", errors="replace")
    else:
        head = (body or "")[:_HEAD_BYTES]
    heading = _heading_text(head)
    if heading and _NOT_FOUND_HEADING.search(heading):
        return UpstreamNotFound("Upstream returned a 'not found' page instead of the document.")
    if (heading and _ERROR_HEADING.search(heading)) or _ERROR_BODY_MARKERS.search(head):
        return UpstreamErrorPage("Upstream returned an error page instead of the document.")
    return None


def _looks_like_json(body: bytes) -> bool:
    stripped = (body or b"")[:64].lstrip()
    return stripped[:1] in (b"{", b"[")


def check_document_body(
    body: bytes, content_type: str = "", *, expect: str
) -> None:
    """Raise the typed failure when a 2xx body is not the expected document.

    ``expect``: ``"pdf"`` (the source serves PDFs), ``"html"`` (the decision
    page itself is HTML) or ``"pdf_or_html"`` (decided by the content type).
    Returns ``None`` when nothing in the response contradicts a document.
    """
    body = body or b""
    content_type = (content_type or "").lower()
    if not body.strip():
        raise UpstreamContractError("Upstream returned an empty document.")
    if expect == "pdf_or_html":
        expect = "pdf" if "pdf" in content_type else "html"
    if expect == "pdf":
        if is_pdf(body):
            return
        page = error_page_failure(body)
        if page is not None:
            raise page
        raise UpstreamContractError("Upstream did not return a PDF document.")
    # HTML decision page.
    if "json" in content_type or _looks_like_json(body):
        raise UpstreamContractError("Upstream returned data instead of the document page.")
    page = error_page_failure(body)
    if page is not None:
        raise page


def require_document_text(text: Optional[str]) -> str:
    """The extracted document text, or PARSER_ERROR when there is none."""
    if text is None or not text.strip():
        raise UpstreamContractError("Upstream document has no readable text.")
    return text
