"""Integrity tests for the seed gold set and adversarial fixtures.

These guard the shipped JSONL files: valid JSON per line, required fields, the
brief 8.1 slice distribution, and the invariant that every seed record is still
an unvalidated draft (pending / no annotators).
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

DATASETS = Path(__file__).resolve().parents[1] / "datasets"
GOLD_SEED = DATASETS / "legal_gold_v1.seed.jsonl"
ADVERSARIAL = DATASETS / "adversarial_v1.jsonl"

GOLD_REQUIRED_FIELDS = {
    "id", "question", "as_of", "task_type", "source_scope",
    "expected_documents", "required_primary_sources", "required_claims",
    "contrary_authorities", "acceptable_abstention", "annotators",
    "adjudication_status",
}

# Expected seed counts per task_type (brief 8.1 slices, scaled to 40 seeds).
EXPECTED_TASK_TYPE_COUNTS = {
    "exact_reference": 8,
    "fact_pattern": 8,
    "temporal": 6,
    "temporal_amendment": 5,
    "contrary_authority": 5,
    "multi_source": 4,
    "no_answer": 3,
    "adversarial_injection": 1,
}


def _load(path):
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def test_gold_seed_count():
    records = _load(GOLD_SEED)
    assert len(records) == 40


def test_gold_seed_ids_unique():
    records = _load(GOLD_SEED)
    ids = [r["id"] for r in records]
    assert len(ids) == len(set(ids))


def test_gold_seed_required_fields():
    for record in _load(GOLD_SEED):
        missing = GOLD_REQUIRED_FIELDS - record.keys()
        assert not missing, f"{record.get('id')} missing {missing}"
        for claim in record["required_claims"]:
            assert {"claim", "supporting_passages", "material"} <= claim.keys()


def test_gold_seed_slice_distribution():
    counts = Counter(r["task_type"] for r in _load(GOLD_SEED))
    assert dict(counts) == EXPECTED_TASK_TYPE_COUNTS


def test_gold_seed_all_unvalidated_drafts():
    # The whole point: these are drafts pending lawyer annotation.
    for record in _load(GOLD_SEED):
        assert record["adjudication_status"] == "pending", record["id"]
        assert record["annotators"] == [], record["id"]


def test_gold_seed_no_answer_records_abstain():
    for record in _load(GOLD_SEED):
        if record["task_type"] in {"no_answer"}:
            assert record["acceptable_abstention"] is True, record["id"]
            assert record["expected_documents"] == [], record["id"]


def test_gold_seed_contains_injection_in_question():
    # At least one adversarial record must carry an embedded instruction in the
    # question text itself (brief lane requirement).
    records = _load(GOLD_SEED)
    injection = [r for r in records if r["task_type"] == "adversarial_injection"]
    assert injection, "expected an adversarial_injection record"
    assert any("SYSTEM:" in r["question"] for r in injection)


def test_adversarial_fixture_count_and_fields():
    records = _load(ADVERSARIAL)
    assert len(records) == 12
    required = {"id", "threat", "vector", "payload", "expected_behavior",
                "must_not", "trust_boundary"}
    ids = set()
    for record in records:
        assert required <= record.keys(), record.get("id")
        assert record["trust_boundary"] == "UNTRUSTED_DATA"
        assert record["expected_behavior"], record["id"]
        assert record["must_not"], record["id"]
        ids.add(record["id"])
    assert len(ids) == 12


def test_adversarial_threat_coverage():
    threats = {r["threat"] for r in _load(ADVERSARIAL)}
    # Spot-check that the core brief 12.4 threat classes are represented.
    for expected in {
        "prompt_injection", "html_markdown_exfil", "ssrf",
        "cross_tenant_leak", "fabricated_citation", "citation_tampering",
    }:
        assert expected in threats, expected
