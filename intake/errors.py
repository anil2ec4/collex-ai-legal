"""Typed intake errors mirroring the /v1/files HTTP contract.

The TS API shells to ``intake.cli`` and maps ``error.kind`` to a status:

    INVALID_REQUEST   -> 400
    UNSUPPORTED_TYPE  -> 415
    EXTRACTION_FAILED -> 422
    NOT_FOUND         -> 404   (additive; delete/show of an unknown fileId)
    STORE_UNAVAILABLE -> 503   (additive; the local PostgreSQL did not answer
                                within the bounded connect timeout — see
                                ingestion.pipeline.connect_local)

Messages are user-facing Turkish where they explain a legal-workflow
consequence (e.g. the OCR fail-closed message) and terse English/Turkish
mixes elsewhere; both are data, never markup. STORE_UNAVAILABLE carries a
FIXED Turkish message and never the driver's text (a psycopg error string
can contain the DSN).
"""

from __future__ import annotations


class IntakeError(Exception):
    """Base typed intake error. ``kind`` mirrors the API error taxonomy."""

    kind = "INVALID_REQUEST"
    http_status = 400

    def __init__(self, message: str, *, warnings: list[str] | None = None):
        super().__init__(message)
        self.message = message
        #: Warnings that were already accumulated when the failure occurred
        #: (e.g. the OCR fail-closed notice). The CLI includes them in the
        #: error JSON so the API can surface them.
        self.warnings = list(warnings or [])

    def to_json_dict(self) -> dict:
        body: dict = {"error": {"kind": self.kind, "message": self.message}}
        if self.warnings:
            body["error"]["warnings"] = self.warnings
        return body


class InvalidRequestError(IntakeError):
    kind = "INVALID_REQUEST"
    http_status = 400


class UnsupportedTypeError(IntakeError):
    kind = "UNSUPPORTED_TYPE"
    http_status = 415


class ExtractionFailedError(IntakeError):
    kind = "EXTRACTION_FAILED"
    http_status = 422


class NotFoundError(IntakeError):
    kind = "NOT_FOUND"
    http_status = 404


#: The ONLY message a STORE_UNAVAILABLE error carries (contract [X]).
STORE_UNAVAILABLE_MESSAGE = "Yerel veritabanına ulaşılamadı."


class StoreUnavailableError(IntakeError):
    """The local database could not be reached (connection refused, connect
    timeout, server shutting down). Raised by intake.ingest from every
    psycopg OperationalError so the CLI prints the typed JSON and exits 2
    within the connect-timeout budget instead of hanging."""

    kind = "STORE_UNAVAILABLE"
    http_status = 503

    def __init__(self, message: str = STORE_UNAVAILABLE_MESSAGE, **kw):
        super().__init__(message, **kw)
