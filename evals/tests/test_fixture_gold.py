"""Integrity tests for the fixture-corpus gold set.

Unlike ``legal_gold_v1.seed.jsonl`` (unvalidated lawyer-pending drafts), every
record in ``fixture_corpus_gold.jsonl`` has ground truth BY CONSTRUCTION: the
corpus is synthetic and this repository authored both the documents and the
expected answers. These tests keep that claim true — every expected unit id
must actually be derivable from a shipped fixture file, so the gold set cannot
drift away from the corpus it describes.

Fully offline: reads JSON files only, no database, no network.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

EVALS = Path(__file__).resolve().parents[1]
GOLD = EVALS / "datasets" / "fixture_corpus_gold.jsonl"
CORPUS = EVALS / "fixtures" / "corpus"

REQUIRED_FIELDS = {
    "id", "question", "as_of", "task_type", "source_scope",
    "expected_documents", "required_primary_sources", "required_claims",
    "contrary_authorities", "acceptable_abstention", "reference_form",
    "parity_group", "leak_probe", "corpus", "ground_truth_basis",
    "annotators", "adjudication_status",
}

ALLOWED_TASK_TYPES = {
    "exact_reference", "fact_pattern", "temporal", "temporal_amendment",
    "contrary_authority", "multi_source", "no_answer", "adversarial_injection",
}

ALLOWED_REFERENCE_FORMS = {"full_name", "abbreviation", "docket", "none"}

# <external_id>@<version_label>#<structural path segments joined by "/">
UNIT_ID_RE = re.compile(r"^(?P<external>[^@#]+)@(?P<version>[^@#]+)#(?P<path>[^@#]+)$")

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _load_gold() -> list[dict]:
    records = []
    for line in GOLD.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def _corpus_index() -> dict[tuple[str, str], dict]:
    """{(external_id, version_label): fixture} over every corpus file."""
    index: dict[tuple[str, str], dict] = {}
    for path in sorted(CORPUS.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        meta = raw.get("_meta") or {}
        index[(str(raw["external_id"]), str(meta.get("version_label", "v1")))] = raw
    return index


def _all_unit_ids(record: dict) -> list[str]:
    ids = list(record.get("expected_documents", []))
    ids += list(record.get("required_primary_sources", []))
    ids += list(record.get("contrary_authorities", []))
    for claim in record.get("required_claims", []):
        ids += list(claim.get("supporting_passages", []))
    return [str(i) for i in ids]


def test_gold_is_valid_jsonl_with_unique_ids():
    records = _load_gold()
    assert records, "fixture gold set is empty"
    ids = [r["id"] for r in records]
    assert len(ids) == len(set(ids)), "duplicate gold ids"


def test_required_fields_and_enums():
    for record in _load_gold():
        missing = REQUIRED_FIELDS - record.keys()
        assert not missing, f"{record.get('id')} missing {missing}"
        assert record["task_type"] in ALLOWED_TASK_TYPES, record["id"]
        assert record["reference_form"] in ALLOWED_REFERENCE_FORMS, record["id"]
        assert ISO_DATE_RE.match(record["as_of"]), record["id"]
        assert record["corpus"] == "fixture_corpus_v1"
        assert record["ground_truth_basis"] == "authored_synthetic"
        assert record["adjudication_status"] == "by_construction"
        for claim in record["required_claims"]:
            assert {"claim", "supporting_passages", "material"} <= claim.keys()


def test_slice_coverage():
    """Every slice the lane must cover is actually present."""
    counts = Counter(r["task_type"] for r in _load_gold())
    for required in (
        "exact_reference", "fact_pattern", "temporal",
        "temporal_amendment", "contrary_authority", "no_answer",
    ):
        assert counts[required] >= 2, f"slice {required} has {counts[required]} queries"


def test_no_answer_records_expect_nothing_and_allow_abstention():
    for record in _load_gold():
        if record["task_type"] == "no_answer":
            assert record["expected_documents"] == [], record["id"]
            assert record["required_primary_sources"] == [], record["id"]
            assert record["acceptable_abstention"] is True, record["id"]
        else:
            assert record["expected_documents"], record["id"]
            assert record["acceptable_abstention"] is False, record["id"]


def test_required_primary_sources_subset_of_expected():
    for record in _load_gold():
        expected = set(record["expected_documents"])
        primary = set(record["required_primary_sources"])
        assert primary <= expected, f"{record['id']}: {primary - expected}"


def test_every_unit_id_resolves_to_a_shipped_fixture():
    """The ground-truth claim: each expected unit exists in the corpus.

    The structural path segment is checked against what the ingestion chunker
    actually produces for that fixture, so a gold id can never point at an
    article/section the corpus does not contain.
    """
    import sys

    repo_root = EVALS.parent
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    import unicodedata

    from ingestion.chunking import chunk_document
    from ingestion.ports import ParsedDocument

    index = _corpus_index()
    paths_by_key: dict[tuple[str, str], set[str]] = {}
    for key, raw in index.items():
        parsed = ParsedDocument(
            source=str(raw["source"]),
            external_id=str(raw["external_id"]),
            document_type=str(raw["document_type"]),
            title=raw.get("title"),
            retrieved_url=raw.get("retrieved_url"),
            media_type=raw.get("media_type"),
            canonical_text=unicodedata.normalize("NFC", str(raw["text"])),
            dates=dict(raw.get("dates") or {}),
            structure_hints=dict(raw.get("structure_hints") or {}),
            meta=dict(raw.get("_meta") or {}),
        )
        paths_by_key[key] = {
            "/".join(chunk.structural_path) for chunk in chunk_document(parsed)
        }

    for record in _load_gold():
        for unit_id in _all_unit_ids(record):
            match = UNIT_ID_RE.match(unit_id)
            assert match, f"{record['id']}: malformed unit id {unit_id!r}"
            key = (match["external"], match["version"])
            assert key in index, f"{record['id']}: no fixture for {key}"
            assert match["path"] in paths_by_key[key], (
                f"{record['id']}: {unit_id} names a structural path the chunker"
                f" does not produce for {key}"
            )


def test_public_scope_for_every_expected_unit():
    """Gold must never expect a tenant-scoped document from a public search."""
    index = _corpus_index()
    for record in _load_gold():
        for unit_id in _all_unit_ids(record):
            match = UNIT_ID_RE.match(unit_id)
            assert match
            raw = index[(match["external"], match["version"])]
            scope = (raw.get("_meta") or {}).get("scope", "public")
            assert scope == "public", (
                f"{record['id']}: {unit_id} is scope={scope}; a public corpus"
                " search must never be expected to return it"
            )


def test_parity_groups_pair_one_abbreviation_with_one_full_name():
    groups: dict[str, list[dict]] = {}
    for record in _load_gold():
        group = record.get("parity_group")
        if group:
            groups.setdefault(group, []).append(record)
    assert groups, "no abbreviation/full-name parity pairs defined"
    for group, members in groups.items():
        assert len(members) == 2, f"parity group {group} has {len(members)} members"
        forms = {m["reference_form"] for m in members}
        assert forms == {"abbreviation", "full_name"}, f"{group}: {forms}"
        # The two questions must differ ONLY in how the law is referenced,
        # otherwise the parity metric measures something else.
        assert len({m["as_of"] for m in members}) == 1, group
        assert len({tuple(m["expected_documents"]) for m in members}) == 1, group


def test_at_least_one_cross_tenant_leak_probe_exists():
    probes = [r for r in _load_gold() if r.get("leak_probe")]
    assert probes, "no leak_probe query; the tenant-isolation tripwire is missing"
    for probe in probes:
        assert probe["acceptable_abstention"] is True


def test_corpus_fixtures_are_labelled_synthetic():
    for path in sorted(CORPUS.glob("*.json")):
        meta = (json.loads(path.read_text(encoding="utf-8")).get("_meta") or {})
        assert meta.get("synthetic") is True, f"{path.name} is not marked synthetic"
        assert "SENTET" in str(meta.get("notice", "")).upper(), path.name
