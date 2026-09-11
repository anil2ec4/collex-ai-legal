"""Deterministic citation / evidence checker.

Implements the deterministic evidence checks from the master build brief
(section 9.2 evidence contract, section 9.3 validator). Given a claims+evidence
JSON document and a directory of canonical documents, it verifies, for every
piece of evidence, that:

  1. OFFSET IN RANGE     - 0 <= startChar < endChar <= len(canonical_text)
  2. QUOTE == SLICE      - canonical_text[startChar:endChar] equals the quote
  3. QUOTE HASH          - sha256(quote) equals quoteSha256
  4. CONTENT HASH        - sha256(canonical_text) equals contentSha256

Offset policy (brief 9.3): offsets are **Unicode scalar (code point) offsets**,
i.e. plain Python string indices. This is a single canonical standard shared by
every language binding; do NOT feed UTF-16 code-unit offsets (JS `.length`) or
UTF-8 byte offsets here. Hashes are computed over the UTF-8 encoding of the text.

A claim passes only if every evidence id it references resolves and passes all
four checks. The report lists per-claim and per-evidence pass/fail with a reason
code on failure, using the brief's vocabulary:

  OFFSET_OUT_OF_RANGE, QUOTE_OFFSET_MISMATCH, QUOTE_HASH_MISMATCH,
  DOCUMENT_VERSION_MISMATCH   (plus DOCUMENT_NOT_FOUND, EVIDENCE_NOT_FOUND)

Input JSON shape (brief 9.2, snake_case or camelCase accepted):

  {
    "evidence": [
      {
        "evidenceId": "ev-1",
        "documentId": "doc-1",
        "locator": {"startChar": 0, "endChar": 5},
        "quote": "hello",
        "quoteSha256": "...",
        "contentSha256": "..."
      }
    ],
    "claims": [
      {"claimId": "c-1", "text": "...", "material": true, "evidenceIds": ["ev-1"]}
    ]
  }

Document store: a directory of *.json files, each
  {"documentId": "doc-1", "canonical_text": "..."}
(or "document_id"/"canonicalText"). Files are keyed by their document id.

CLI:
  python evals/citations/check_citations.py --input claims.json \
      --docstore ./docs --out report.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

# --- reason codes ---------------------------------------------------------
OFFSET_OUT_OF_RANGE = "OFFSET_OUT_OF_RANGE"
QUOTE_OFFSET_MISMATCH = "QUOTE_OFFSET_MISMATCH"
QUOTE_HASH_MISMATCH = "QUOTE_HASH_MISMATCH"
DOCUMENT_VERSION_MISMATCH = "DOCUMENT_VERSION_MISMATCH"
DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"
EVIDENCE_NOT_FOUND = "EVIDENCE_NOT_FOUND"


def sha256_text(value: str) -> str:
    """SHA-256 hex digest of the UTF-8 encoding of a string."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _get(record: dict[str, Any], *names: str, default: Any = None) -> Any:
    """Return the first present key among names (camelCase/snake_case tolerant)."""
    for name in names:
        if name in record:
            return record[name]
    return default


# --- document store -------------------------------------------------------
def load_document_store(docstore_dir: str | Path) -> dict[str, str]:
    """Load every *.json file in a directory into {document_id: canonical_text}."""
    directory = Path(docstore_dir)
    if not directory.is_dir():
        raise NotADirectoryError(f"document store not a directory: {directory}")
    store: dict[str, str] = {}
    for path in sorted(directory.glob("*.json")):
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        document_id = _get(data, "documentId", "document_id", default=path.stem)
        canonical = _get(data, "canonical_text", "canonicalText")
        if canonical is None:
            raise ValueError(f"{path}: missing canonical_text")
        store[str(document_id)] = canonical
    return store


# --- single evidence check ------------------------------------------------
def check_evidence(evidence: dict[str, Any], store: dict[str, str]) -> dict[str, Any]:
    """Run the four deterministic checks on one evidence record.

    Returns {"evidenceId", "ok": bool, "reason": str|None, ...}. Checks run in the
    brief's order and stop at the first failure.
    """
    evidence_id = str(_get(evidence, "evidenceId", "evidence_id", default=""))
    document_id = str(_get(evidence, "documentId", "document_id", default=""))
    locator = _get(evidence, "locator", default={}) or {}
    start = _get(locator, "startChar", "start_char")
    end = _get(locator, "endChar", "end_char")
    quote = _get(evidence, "quote", default="")
    quote_sha = _get(evidence, "quoteSha256", "quote_sha256", default="")
    content_sha = _get(evidence, "contentSha256", "content_sha256", default="")

    base = {"evidenceId": evidence_id, "documentId": document_id}

    canonical = store.get(document_id)
    if canonical is None:
        return {**base, "ok": False, "reason": DOCUMENT_NOT_FOUND}

    # 1. offset in range
    if (
        not isinstance(start, int)
        or not isinstance(end, int)
        or start < 0
        or end <= start
        or end > len(canonical)
    ):
        return {**base, "ok": False, "reason": OFFSET_OUT_OF_RANGE}

    # 2. quote == codepoint slice
    exact = canonical[start:end]
    if exact != quote:
        return {**base, "ok": False, "reason": QUOTE_OFFSET_MISMATCH}

    # 3. quote hash
    if sha256_text(exact) != quote_sha:
        return {**base, "ok": False, "reason": QUOTE_HASH_MISMATCH}

    # 4. document version hash
    if sha256_text(canonical) != content_sha:
        return {**base, "ok": False, "reason": DOCUMENT_VERSION_MISMATCH}

    return {**base, "ok": True, "reason": None}


# --- whole document -------------------------------------------------------
def check_citations(payload: dict[str, Any], store: dict[str, str]) -> dict[str, Any]:
    """Check every claim in the payload against the document store.

    A claim passes iff all evidence it references resolves and passes all checks.
    Evidence not referenced by any claim is still validated and reported under
    'evidence', but only referenced evidence affects a claim's verdict.
    """
    evidence_list = payload.get("evidence", []) or []
    claims = payload.get("claims", []) or []

    evidence_results: dict[str, dict[str, Any]] = {}
    for evidence in evidence_list:
        result = check_evidence(evidence, store)
        evidence_results[result["evidenceId"]] = result

    claim_reports: list[dict[str, Any]] = []
    claims_passed = 0
    for claim in claims:
        claim_id = str(_get(claim, "claimId", "claim_id", default=""))
        evidence_ids = [str(e) for e in _get(claim, "evidenceIds", "evidence_ids", default=[])]
        material = bool(claim.get("material", False))

        checks: list[dict[str, Any]] = []
        claim_ok = True
        for evidence_id in evidence_ids:
            result = evidence_results.get(evidence_id)
            if result is None:
                checks.append(
                    {"evidenceId": evidence_id, "ok": False, "reason": EVIDENCE_NOT_FOUND}
                )
                claim_ok = False
                continue
            checks.append(result)
            if not result["ok"]:
                claim_ok = False

        # A material claim with no evidence at all cannot be "supported".
        if not evidence_ids:
            claim_ok = False

        claims_passed += int(claim_ok)
        claim_reports.append(
            {
                "claimId": claim_id,
                "material": material,
                "ok": claim_ok,
                "evidence": checks,
            }
        )

    evidence_passed = sum(1 for r in evidence_results.values() if r["ok"])
    report = {
        "summary": {
            "claims_total": len(claims),
            "claims_passed": claims_passed,
            "claims_failed": len(claims) - claims_passed,
            "evidence_total": len(evidence_results),
            "evidence_passed": evidence_passed,
            "evidence_failed": len(evidence_results) - evidence_passed,
            "all_passed": claims_passed == len(claims)
            and evidence_passed == len(evidence_results),
        },
        "claims": claim_reports,
        "evidence": list(evidence_results.values()),
    }
    return report


# --- cli ------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run deterministic citation/evidence checks (brief 9.2/9.3)."
    )
    parser.add_argument("--input", required=True, help="claims+evidence JSON file.")
    parser.add_argument(
        "--docstore", required=True, help="Directory of canonical document JSON files."
    )
    parser.add_argument("--out", required=True, help="Path to write the JSON report.")
    parser.add_argument("--quiet", action="store_true", help="Suppress stdout summary.")
    args = parser.parse_args(argv)

    with open(args.input, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    store = load_document_store(args.docstore)
    report = check_citations(payload, store)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    if not args.quiet:
        summary = report["summary"]
        print(f"Wrote report to {out_path}")
        print(
            f"  claims: {summary['claims_passed']}/{summary['claims_total']} passed; "
            f"evidence: {summary['evidence_passed']}/{summary['evidence_total']} passed"
        )
        for claim in report["claims"]:
            if not claim["ok"]:
                reasons = ", ".join(
                    f"{c['evidenceId']}:{c['reason']}"
                    for c in claim["evidence"]
                    if not c["ok"]
                )
                print(f"  FAIL claim {claim['claimId']}: {reasons or 'no evidence'}")

    # Exit non-zero when any check failed, so the harness can gate CI.
    return 0 if report["summary"]["all_passed"] else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
