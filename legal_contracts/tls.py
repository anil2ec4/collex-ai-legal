"""The ONE way a gateway client builds its TLS context: always verified.

W22 follow-up (27–28.09.2026): six clients reached government hosts with
certificate verification OFF (httpx ``verify`` false / verify mode "none") — the health
probe, both KİK contexts, Emsal, Uyuşmazlık, Danıştay and Yargıtay. Every one
arrived with the upstream import (commit 1223b37) with no reason recorded
beyond "as per original user code"; none is needed for anything a verified
connection cannot do. They now verify against certifi's trust store (the
store httpx itself uses) with the hostname checked, and
``tests/test_error_pages_and_tls.py`` pins that NO gateway file turns
verification off.

``legacy_server=True`` adds only what an old TLS stack needs to complete a
handshake — ``OP_LEGACY_SERVER_CONNECT`` (no RFC 5746 secure renegotiation)
and a wider cipher list — and never touches identity checks. Only a client
whose code documents that need may ask for it (today: KİK).

A certificate that does not verify is a typed failure, never a reason to
switch verification off: ``legal_contracts.outcomes`` classifies it as
UNAVAILABLE "Upstream TLS certificate could not be verified." and the
control plane marks it ``detail: "TLS_CERTIFICATE"`` ("Kaynağın güvenlik
sertifikası doğrulanamadı"). The fix for a host with an incomplete chain is
to add the missing intermediate for that host, not to trust everything.
UNMEASURED against the live hosts: this environment's network policy blocks
*.gov.tr.
"""

from __future__ import annotations

import ssl

# The cipher list the KİK client has always offered; it widens CIPHERS only.
LEGACY_CIPHERS = "ALL:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA"


def verified_ssl_context(*, legacy_server: bool = False) -> ssl.SSLContext:
    """A certificate-verifying, hostname-checking client context."""
    try:
        import certifi

        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover - certifi ships with httpx
        context = ssl.create_default_context()
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    if legacy_server:
        if hasattr(ssl, "OP_LEGACY_SERVER_CONNECT"):
            context.options |= ssl.OP_LEGACY_SERVER_CONNECT
        context.set_ciphers(LEGACY_CIPHERS)
    return context
