"""Tenant file intake: quarantine -> extraction -> analysis -> ingest.

Brief section 11.1 (secure upload pipeline) and the analysis half of 11.5,
LOCAL SINGLE-USER MODE. The lane processes an uploaded file end-to-end:

    quarantine (size cap, magic-byte/MIME sniff, zip safety)
    -> born-digital text extraction (PDF/DOCX/TXT/UDF; NO OCR — fail closed)
    -> NFC canonical text
    -> heuristic legal analysis (parties/references/dates/claims)
    -> tenant-scoped ingest through the EXISTING ingestion machinery
       (snapshot -> identity -> version -> paragraph chunks -> embedding jobs)
    -> immutable original stored at var/uploads/<sha256><ext>

Honesty notes (do not weaken):

* Analysis is HEURISTIC v1 (see intake/analysis.py) — regex/pattern based,
  no model. Findings are labeled ``source: "heuristic"`` and a warning is
  emitted when few signals are found.
* Scanned PDFs FAIL CLOSED with a typed EXTRACTION_FAILED and the warning
  "taranmış PDF — OCR bu modda devre dışı". The MISTRAL_API_KEY OCR lane is
  out of scope here (brief 11.2 is a separate quality-gated lane).
* UDF is READ-ONLY (brief 11.3): originals are stored byte-for-byte and
  never re-serialized; nothing here writes or modifies a UDF.
* Local single-user mode: every tenant row uses ``LOCAL_TENANT_ID`` and the
  connection is the scratch superuser, so RLS is bypassed. This is the
  ACCEPTED, documented posture for local mode — a multi-tenant deployment
  must connect through a role subject to the 20260826060000 policies.
"""

from __future__ import annotations

from intake.errors import (
    ExtractionFailedError,
    IntakeError,
    InvalidRequestError,
    NotFoundError,
    UnsupportedTypeError,
)
from intake.ingest import (
    LOCAL_TENANT_ID,
    IntakeResult,
    delete_file,
    list_files,
    process_file,
    show_file,
)

__all__ = [
    "ExtractionFailedError",
    "IntakeError",
    "IntakeResult",
    "InvalidRequestError",
    "LOCAL_TENANT_ID",
    "NotFoundError",
    "UnsupportedTypeError",
    "delete_file",
    "list_files",
    "process_file",
    "show_file",
]
