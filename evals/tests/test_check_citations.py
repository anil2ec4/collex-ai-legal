"""Unit tests for the deterministic citation checker.

Builds a small document store on disk and a claims+evidence payload with one
passing claim and one crafted instance of each failure mode from the brief 9.3
validator: OFFSET_OUT_OF_RANGE, QUOTE_OFFSET_MISMATCH, QUOTE_HASH_MISMATCH,
DOCUMENT_VERSION_MISMATCH, plus DOCUMENT_NOT_FOUND and EVIDENCE_NOT_FOUND.
"""

from __future__ import annotations

import json

import check_citations as cc  # noqa: E402 (path injected by conftest.py)

# A Turkish canonical text with multi-byte characters, to exercise code-point
# (not UTF-16 / not UTF-8-byte) offsets.
CANONICAL = (
    "Kusurlu ve hukuka aykırı bir fiille başkasına zarar veren, "
    "bu zararı gidermekle yükümlüdür."
)


def _write_store(tmp_path):
    store_dir = tmp_path / "docs"
    store_dir.mkdir()
    (store_dir / "doc1.json").write_text(
        json.dumps({"documentId": "doc-1", "canonical_text": CANONICAL},
                   ensure_ascii=False),
        encoding="utf-8",
    )
    return store_dir


def _good_evidence(evidence_id="ev-ok"):
    # Code-point slice [0:7] == "Kusurlu".
    start, end = 0, 7
    quote = CANONICAL[start:end]
    assert quote == "Kusurlu"
    return {
        "evidenceId": evidence_id,
        "documentId": "doc-1",
        "locator": {"startChar": start, "endChar": end},
        "quote": quote,
        "quoteSha256": cc.sha256_text(quote),
        "contentSha256": cc.sha256_text(CANONICAL),
    }


def test_valid_evidence_passes(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    result = cc.check_evidence(_good_evidence(), store)
    assert result["ok"] is True
    assert result["reason"] is None


def test_offset_out_of_range(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    ev = _good_evidence()
    ev["locator"] = {"startChar": 5, "endChar": 10_000}  # end beyond length
    result = cc.check_evidence(ev, store)
    assert result["ok"] is False
    assert result["reason"] == cc.OFFSET_OUT_OF_RANGE


def test_offset_out_of_range_inverted(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    ev = _good_evidence()
    ev["locator"] = {"startChar": 7, "endChar": 7}  # end <= start
    result = cc.check_evidence(ev, store)
    assert result["ok"] is False
    assert result["reason"] == cc.OFFSET_OUT_OF_RANGE


def test_quote_offset_mismatch(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    ev = _good_evidence()
    # Offsets select "Kusurlu" but the quote claims something else.
    ev["quote"] = "hukuka"
    ev["quoteSha256"] = cc.sha256_text("hukuka")
    result = cc.check_evidence(ev, store)
    assert result["ok"] is False
    assert result["reason"] == cc.QUOTE_OFFSET_MISMATCH


def test_quote_hash_mismatch(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    ev = _good_evidence()
    # Quote matches the slice, but the declared quote hash is wrong.
    ev["quoteSha256"] = "0" * 64
    result = cc.check_evidence(ev, store)
    assert result["ok"] is False
    assert result["reason"] == cc.QUOTE_HASH_MISMATCH


def test_document_version_mismatch(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    ev = _good_evidence()
    # Quote + quote hash correct, but the content hash points at another version.
    ev["contentSha256"] = cc.sha256_text(CANONICAL + " (değiştirilmiş sürüm)")
    result = cc.check_evidence(ev, store)
    assert result["ok"] is False
    assert result["reason"] == cc.DOCUMENT_VERSION_MISMATCH


def test_document_not_found(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))
    ev = _good_evidence()
    ev["documentId"] = "doc-does-not-exist"
    result = cc.check_evidence(ev, store)
    assert result["ok"] is False
    assert result["reason"] == cc.DOCUMENT_NOT_FOUND


def test_full_report_and_claim_rollup(tmp_path):
    store = cc.load_document_store(_write_store(tmp_path))

    good = _good_evidence("ev-ok")
    bad_hash = _good_evidence("ev-bad")
    bad_hash["quoteSha256"] = "0" * 64  # QUOTE_HASH_MISMATCH

    payload = {
        "evidence": [good, bad_hash],
        "claims": [
            {"claimId": "c-pass", "text": "geçer", "material": True,
             "evidenceIds": ["ev-ok"]},
            {"claimId": "c-fail-evidence", "text": "kalır", "material": True,
             "evidenceIds": ["ev-bad"]},
            {"claimId": "c-missing-evidence", "text": "yok", "material": True,
             "evidenceIds": ["ev-nonexistent"]},
            {"claimId": "c-no-evidence", "text": "boş", "material": True,
             "evidenceIds": []},
        ],
    }

    report = cc.check_citations(payload, store)

    by_id = {c["claimId"]: c for c in report["claims"]}
    assert by_id["c-pass"]["ok"] is True
    assert by_id["c-fail-evidence"]["ok"] is False
    assert by_id["c-missing-evidence"]["ok"] is False
    # A material claim with no evidence at all cannot be supported.
    assert by_id["c-no-evidence"]["ok"] is False

    # EVIDENCE_NOT_FOUND surfaced for the dangling reference.
    missing_reasons = [
        c["reason"] for c in by_id["c-missing-evidence"]["evidence"] if not c["ok"]
    ]
    assert cc.EVIDENCE_NOT_FOUND in missing_reasons

    summary = report["summary"]
    assert summary["claims_total"] == 4
    assert summary["claims_passed"] == 1
    assert summary["evidence_total"] == 2
    assert summary["evidence_passed"] == 1
    assert summary["all_passed"] is False


def test_cli_exit_codes(tmp_path):
    store_dir = _write_store(tmp_path)

    passing = {
        "evidence": [_good_evidence("ev-ok")],
        "claims": [{"claimId": "c-1", "material": True, "evidenceIds": ["ev-ok"]}],
    }
    pass_input = tmp_path / "pass.json"
    pass_input.write_text(json.dumps(passing, ensure_ascii=False), encoding="utf-8")
    pass_out = tmp_path / "pass_report.json"
    rc_pass = cc.main(
        ["--input", str(pass_input), "--docstore", str(store_dir),
         "--out", str(pass_out), "--quiet"]
    )
    assert rc_pass == 0

    bad = _good_evidence("ev-bad")
    bad["contentSha256"] = "0" * 64
    failing = {
        "evidence": [bad],
        "claims": [{"claimId": "c-1", "material": True, "evidenceIds": ["ev-bad"]}],
    }
    fail_input = tmp_path / "fail.json"
    fail_input.write_text(json.dumps(failing, ensure_ascii=False), encoding="utf-8")
    fail_out = tmp_path / "fail_report.json"
    rc_fail = cc.main(
        ["--input", str(fail_input), "--docstore", str(store_dir),
         "--out", str(fail_out), "--quiet"]
    )
    assert rc_fail == 1
