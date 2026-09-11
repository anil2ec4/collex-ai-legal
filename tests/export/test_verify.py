"""Integrity verification: the gate every export has to pass.

These tests are the reason the product can claim "verifiable evidence". They
assert that the verifier catches each way a bundle can lie about its own
provenance, and that an export built on a lying bundle never reaches disk.
"""

from __future__ import annotations

import copy
import hashlib
from pathlib import Path
from typing import Any

import pytest

from export.bundle import parse_bundle
from export.errors import BundleFormatError, ExportRefused
from export.plan import assert_citation_closure, build_citation_plan
from export.verify import sha256_utf8, verify_bundle, verify_bundle_or_refuse


def test_generated_fixtures_verify_clean(qualified_bundle, abstain_bundle):
    """The checked-in fixtures carry REAL hashes and offsets."""
    for bundle in (qualified_bundle, abstain_bundle):
        report = verify_bundle(bundle)
        assert report.ok, [str(f) for f in report.failures]
        # Both fixtures ship canonical texts, so the strongest check ran:
        # canonical text -> contentSha256, and the code-point span -> quote.
        assert report.text_verified_ids
        assert not report.hash_only_ids


def test_quote_hashes_are_recomputed_not_trusted(qualified_bundle):
    for entry in qualified_bundle.evidence:
        assert sha256_utf8(entry.quote) == entry.quote_sha256
        canonical = qualified_bundle.texts[entry.document_version_id]
        assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == entry.content_sha256
        assert canonical[entry.locator.start_char : entry.locator.end_char] == entry.quote


def test_single_character_tamper_is_detected(qualified_payload, tamper):
    """One changed character in one quote is enough to fail the whole export."""
    mutated = parse_bundle(tamper(qualified_payload, 0))
    report = verify_bundle(mutated)

    assert not report.ok
    codes = {f.code for f in report.failures}
    assert "QUOTE_HASH_MISMATCH" in codes
    # The bundle ships canonical text, so the offset check independently
    # catches the same tamper — two failures, not one lucky one.
    assert "OFFSET_TEXT_MISMATCH" in codes

    with pytest.raises(ExportRefused):
        verify_bundle_or_refuse(mutated)


def test_tamper_is_caught_without_canonical_texts(qualified_payload, tamper):
    """Hash-only bundles (no ``texts``) still catch a tampered quote."""
    mutated = tamper(qualified_payload, 1)
    mutated.pop("texts")
    report = verify_bundle(parse_bundle(mutated))

    assert not report.ok
    assert {f.code for f in report.failures} == {"QUOTE_HASH_MISMATCH"}
    assert report.hash_only_ids
    assert not report.text_verified_ids


def test_invented_citation_is_refused(qualified_payload):
    """A claim citing an evidence id that is not in the bundle is fatal."""
    mutated = copy.deepcopy(qualified_payload)
    mutated["claims"][0]["evidenceIds"].append("ev-does-not-exist")
    bundle = parse_bundle(mutated)

    report = verify_bundle(bundle)
    assert not report.ok
    assert {f.code for f in report.failures} == {"UNKNOWN_EVIDENCE_ID"}

    with pytest.raises(ExportRefused, match="ev-does-not-exist"):
        build_citation_plan(bundle)


def test_offset_span_must_match_quote_length(qualified_payload):
    mutated = copy.deepcopy(qualified_payload)
    mutated["evidence"][0]["locator"]["endChar"] += 5
    report = verify_bundle(parse_bundle(mutated))

    assert not report.ok
    codes = {f.code for f in report.failures}
    assert "LOCATOR_SPAN_MISMATCH" in codes


def test_content_hash_mismatch_is_detected(qualified_payload):
    """Editing the canonical text without editing the quote is caught too."""
    mutated = copy.deepcopy(qualified_payload)
    version_id = mutated["evidence"][0]["documentVersionId"]
    mutated["texts"][version_id] = mutated["texts"][version_id] + " ek metin"
    report = verify_bundle(parse_bundle(mutated))

    assert not report.ok
    assert "CONTENT_HASH_MISMATCH" in {f.code for f in report.failures}


def test_carriage_return_in_quote_is_refused(qualified_payload):
    """A quote containing \\r cannot survive OOXML, so it is not exportable."""
    mutated = copy.deepcopy(qualified_payload)
    entry = mutated["evidence"][0]
    quote = entry["quote"][:20] + "\r" + entry["quote"][21:]
    entry["quote"] = quote
    entry["quoteSha256"] = hashlib.sha256(quote.encode("utf-8")).hexdigest()
    mutated.pop("texts")

    report = verify_bundle(parse_bundle(mutated))
    assert not report.ok
    assert "QUOTE_CONTROL_CHARS" in {f.code for f in report.failures}


def test_duplicate_evidence_id_is_refused(qualified_payload):
    mutated = copy.deepcopy(qualified_payload)
    mutated["evidence"].append(copy.deepcopy(mutated["evidence"][0]))
    report = verify_bundle(parse_bundle(mutated))

    assert not report.ok
    assert "DUPLICATE_EVIDENCE_ID" in {f.code for f in report.failures}


def test_uncited_evidence_is_a_warning_not_a_failure(qualified_bundle):
    """Retrieved-but-uncited sources are reported, never silently dropped."""
    report = verify_bundle(qualified_bundle)
    assert report.ok
    assert "UNCITED_EVIDENCE" in {w.code for w in report.warnings}

    plan = build_citation_plan(qualified_bundle)
    assert len(plan.uncited) == 1
    assert plan.uncited[0].evidence_id == "ev-filler-dilekce"


def test_abstain_plan_has_no_citations(abstain_bundle):
    plan = build_citation_plan(abstain_bundle)
    assert plan.entries == ()
    assert plan.numbered_ids == frozenset()
    # The evidence still exists in the bundle and is reported as uncited.
    assert len(plan.uncited) == len(abstain_bundle.evidence) == 1


@pytest.mark.parametrize(
    "body, appendix, expected, detail",
    [
        # A marker in the body with no appendix entry: a dangling citation.
        ({1, 2}, {1}, None, "KAYNAKLAR girişi yok"),
        # An appendix entry nothing points at: an orphan.
        ({1}, {1, 2}, None, "gövdede atıf yok"),
        # Planned but never written: a dropped citation.
        ({1}, {1}, {1, 2}, "düşürülmüş atıf"),
        # Written but never planned: an invented citation.
        ({1, 2}, {1, 2}, {1}, "uydurulmuş atıf"),
    ],
)
def test_closure_check_rejects_broken_citation_graphs(body, appendix, expected, detail):
    with pytest.raises(ExportRefused) as excinfo:
        assert_citation_closure(body, appendix, expected=expected)
    assert detail in excinfo.value.report()


def test_closure_check_passes_when_everything_agrees():
    assert assert_citation_closure({1, 2}, {1, 2}, expected={1, 2}) is None


@pytest.mark.parametrize(
    "mutation, message",
    [
        ({"schema": "something/else"}, "desteklenmeyen şema"),
        ({"status": "MAYBE"}, "bilinmeyen değer"),
    ],
)
def test_malformed_bundles_are_rejected(
    qualified_payload: dict[str, Any], mutation: dict[str, Any], message: str
):
    payload = copy.deepcopy(qualified_payload)
    payload.update(mutation)
    with pytest.raises(BundleFormatError, match=message):
        parse_bundle(payload)


def test_missing_required_field_is_rejected(qualified_payload):
    payload = copy.deepcopy(qualified_payload)
    del payload["evidence"][0]["quoteSha256"]
    with pytest.raises(BundleFormatError, match="quoteSha256"):
        parse_bundle(payload)


def test_confidence_outside_unit_interval_is_rejected(qualified_payload):
    payload = copy.deepcopy(qualified_payload)
    payload["claims"][0]["confidence"]["entailment"] = 1.4
    with pytest.raises(BundleFormatError, match=r"\[0,1\]"):
        parse_bundle(payload)


def test_refused_export_leaves_no_file(qualified_payload, tamper, tmp_path: Path):
    """A refusal must not leave a partial or stale document behind."""
    pytest.importorskip("docx")
    from export.bundle_docx import export_docx
    from export.bundle_markdown import export_markdown

    bundle = parse_bundle(tamper(qualified_payload, 0))
    docx_target = tmp_path / "cevap.docx"
    md_target = tmp_path / "cevap.md"

    with pytest.raises(ExportRefused):
        export_docx(bundle, docx_target)
    with pytest.raises(ExportRefused):
        export_markdown(bundle, md_target)

    assert not docx_target.exists()
    assert not md_target.exists()
    # No temp leftovers either.
    assert list(tmp_path.iterdir()) == []
