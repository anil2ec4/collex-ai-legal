"""Tests for the derived metrics and HARD INVARIANT GATES (evals/retrieval/gates.py).

Every gate is exercised in BOTH directions: a clean payload must pass it, and a
payload carrying exactly that defect must fail it. A gate that cannot be shown
to fail is not a gate.

Fully offline: pure dicts, no database, no network.
"""

from __future__ import annotations

import copy
import hashlib

import gates
from check_citations import check_citations


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


DOC_A = "MADDE 1 - Birinci madde metni.\nMADDE 2 - İkinci madde metni."
DOC_B = "GEREKÇE: Sentetik gerekçe metni."

VERSION_A = "11111111-1111-4111-8111-111111111111"
VERSION_B = "22222222-2222-4222-8222-222222222222"


def _evidence(version_id: str, text: str, start: int, end: int, evidence_id: str):
    quote = text[start:end]
    return {
        "evidenceId": evidence_id,
        "chunkId": f"chunk-{evidence_id}",
        "documentId": f"doc-{version_id}",
        "documentVersionId": version_id,
        "locator": {"startChar": start, "endChar": end},
        "quote": quote,
        "quoteSha256": sha(quote),
        "contentSha256": sha(text),
    }


def clean_payload() -> dict:
    """One healthy run: two queries, two verified citations, no defects."""
    ev_a = _evidence(VERSION_A, DOC_A, 0, DOC_A.index("\n"), "ev-a")
    ev_b = _evidence(VERSION_B, DOC_B, 0, len(DOC_B), "ev-b")
    return {
        "measured_layer": "test",
        "dense_lane": "noop",
        "stage_ms": {"inventory": 1.0, "canonical_text": 2.0},
        "inventory": [
            {
                "chunkId": "chunk-ev-a", "documentId": f"doc-{VERSION_A}",
                "versionId": VERSION_A, "unitId": "kanun-1@v1#madde-1",
                "externalId": "kanun-1", "versionLabel": "v1",
                "scope": "public", "tenantId": None, "status": "published",
                "storedVersionSha256": sha(DOC_A),
            },
            {
                "chunkId": "chunk-ev-b", "documentId": f"doc-{VERSION_B}",
                "versionId": VERSION_B, "unitId": "karar-1@v1#bolum-gerekce",
                "externalId": "karar-1", "versionLabel": "v1",
                "scope": "public", "tenantId": None, "status": "published",
                "storedVersionSha256": sha(DOC_B),
            },
        ],
        "canonical_texts": {VERSION_A: DOC_A, VERSION_B: DOC_B},
        "results": [
            {
                "id": "q-hit", "task_type": "exact_reference", "as_of": "2026-01-01",
                "question": "kanun 1 madde 1", "status": "ok", "warnings": [],
                "abstained": False, "latency_ms": 4.0,
                "stage_ms": {"search": 4.0, "evidence": 0.5},
                "ranked": [{
                    "rank": 1, "chunkId": "chunk-ev-a", "documentId": f"doc-{VERSION_A}",
                    "documentVersionId": VERSION_A, "unitId": "kanun-1@v1#madde-1",
                    "scope": "public", "tenantId": None, "pinned": True,
                    "fusedScore": 0.0, "lanes": [{"lane": "exact", "rank": 1, "score": 1}],
                }],
                "evidence": [ev_a],
                "rejected_evidence": [],
            },
            {
                "id": "q-abstain", "task_type": "no_answer", "as_of": "2026-01-01",
                "question": "korpusta olmayan bir soru", "status": "ok",
                "warnings": [], "abstained": True, "latency_ms": 2.0,
                "stage_ms": {"search": 2.0, "evidence": 0.1},
                "ranked": [], "evidence": [], "rejected_evidence": [],
            },
            {
                "id": "q-lexical", "task_type": "fact_pattern", "as_of": "2026-01-01",
                "question": "gerekçe", "status": "ok", "warnings": [],
                "abstained": False, "latency_ms": 6.0,
                "stage_ms": {"search": 6.0, "evidence": 0.4},
                "ranked": [{
                    "rank": 1, "chunkId": "chunk-ev-b", "documentId": f"doc-{VERSION_B}",
                    "documentVersionId": VERSION_B, "unitId": "karar-1@v1#bolum-gerekce",
                    "scope": "public", "tenantId": None, "pinned": False,
                    "fusedScore": 0.03,
                    "lanes": [{"lane": "lexical", "rank": 1, "score": 0.1}],
                }],
                "evidence": [ev_b],
                "rejected_evidence": [],
            },
        ],
    }


GOLD = [
    {"id": "q-hit", "task_type": "exact_reference",
     "expected_documents": ["kanun-1@v1#madde-1"], "contrary_authorities": [],
     "acceptable_abstention": False, "reference_form": "abbreviation",
     "parity_group": "p1"},
    {"id": "q-abstain", "task_type": "no_answer", "expected_documents": [],
     "contrary_authorities": [], "acceptable_abstention": True,
     "reference_form": "none", "parity_group": None},
    {"id": "q-lexical", "task_type": "fact_pattern",
     "expected_documents": ["karar-1@v1#bolum-gerekce"], "contrary_authorities": [],
     "acceptable_abstention": False, "reference_form": "full_name",
     "parity_group": "p1"},
]


def _integrity(payload: dict) -> dict:
    citation_input = gates.to_citation_payload(payload)
    docstore = gates.docstore_from_payload(payload)
    report = check_citations(citation_input, docstore)
    return gates.integrity_metrics(payload, report)


def _gate(payload: dict, name_fragment: str):
    for gate in gates.evaluate_gates(_integrity(payload)):
        if name_fragment in gate.name:
            return gate
    raise AssertionError(f"no gate matching {name_fragment!r}")


# --------------------------------------------------------------------------
# happy path
# --------------------------------------------------------------------------

def test_clean_payload_passes_every_gate():
    for gate in gates.evaluate_gates(_integrity(clean_payload())):
        assert gate.passed, f"{gate.name} failed on a clean payload: {gate.detail}"


def test_clean_payload_metrics():
    integrity = _integrity(clean_payload())
    assert integrity["citation_resolvability"] == 1.0
    assert integrity["quote_hash_integrity"] == 1.0
    assert integrity["fabricated_id_count"] == 0
    assert integrity["cross_tenant_leak_count"] == 0
    assert integrity["evidence_total"] == 2
    assert integrity["ranked_hits_total"] == 2


# --------------------------------------------------------------------------
# each gate must be provably breakable
# --------------------------------------------------------------------------

def test_quote_hash_gate_fails_on_a_tampered_quote_hash():
    payload = clean_payload()
    payload["results"][0]["evidence"][0]["quoteSha256"] = "0" * 64
    gate = _gate(payload, "quote_hash_integrity")
    assert not gate.passed


def test_quote_hash_gate_fails_when_the_quote_does_not_match_the_offsets():
    payload = clean_payload()
    evidence = payload["results"][0]["evidence"][0]
    evidence["quote"] = "Uydurulmuş alıntı"
    evidence["quoteSha256"] = sha(evidence["quote"])
    gate = _gate(payload, "quote_hash_integrity")
    assert not gate.passed


def test_quote_hash_gate_fails_when_the_document_hash_drifted():
    payload = clean_payload()
    payload["results"][0]["evidence"][0]["contentSha256"] = sha("başka bir metin")
    gate = _gate(payload, "quote_hash_integrity")
    assert not gate.passed


def test_quote_hash_gate_fails_when_the_text_drifted_from_the_stored_hash():
    """The check the self-consistent pack round trip CANNOT catch.

    buildEvidencePack recomputes contentSha256 from the text it just fetched,
    so text + hash always agree with each other. Only comparing against the
    hash ingestion recorded detects canonical text that changed underneath.
    """
    payload = clean_payload()
    payload["inventory"][0]["storedVersionSha256"] = sha("ingest sırasında başka bir metin")
    integrity = _integrity(payload)
    assert integrity["stored_hash_mismatch_count"] == 1
    assert not _gate(payload, "quote_hash_integrity").passed


def test_stored_hash_check_is_skipped_for_versions_absent_from_the_inventory():
    payload = clean_payload()
    payload["inventory"][0].pop("storedVersionSha256")
    integrity = _integrity(payload)
    assert integrity["stored_hash_mismatch_count"] == 0


def test_resolvability_gate_fails_when_the_evidence_pack_rejected_a_hit():
    payload = clean_payload()
    payload["results"][0]["rejected_evidence"] = [
        {"chunkId": "chunk-ev-a", "documentVersionId": VERSION_A,
         "reason": "OFFSET_OUT_OF_RANGE"}
    ]
    payload["results"][0]["evidence"] = []
    gate = _gate(payload, "citation_resolvability")
    assert not gate.passed


def test_resolvability_gate_fails_when_a_citation_points_at_an_unknown_document():
    payload = clean_payload()
    payload["canonical_texts"].pop(VERSION_B)
    gate = _gate(payload, "citation_resolvability")
    assert not gate.passed


def test_fabricated_id_gate_fails_on_a_hit_outside_the_inventory():
    payload = clean_payload()
    payload["results"][0]["ranked"][0]["chunkId"] = "chunk-does-not-exist"
    payload["results"][0]["ranked"][0]["unitId"] = None
    integrity = _integrity(payload)
    assert integrity["fabricated_id_count"] >= 1
    assert not _gate(payload, "fabricated_ids").passed


def test_fabricated_id_gate_fails_on_evidence_for_an_unknown_version():
    payload = clean_payload()
    payload["results"][0]["evidence"][0]["documentVersionId"] = "99999999-9999-4999-8999-999999999999"
    assert not _gate(payload, "fabricated_ids").passed


def test_cross_tenant_gate_fails_when_a_tenant_document_is_returned():
    payload = clean_payload()
    payload["results"][0]["ranked"][0]["scope"] = "tenant"
    payload["results"][0]["ranked"][0]["tenantId"] = "00000000-0000-4000-8000-0000000000aa"
    gate = _gate(payload, "cross_tenant_leak")
    assert not gate.passed


def test_lane_failure_gate_fails_when_every_lane_failed_for_a_query():
    payload = clean_payload()
    payload["results"][0]["status"] = "error"
    gate = _gate(payload, "no retrieval lane total failure")
    assert not gate.passed


def test_missing_result_gate_fails_when_a_query_was_dropped():
    integrity = _integrity(clean_payload())
    passing = gates.evaluate_gates(integrity, {"missing_results": 0})
    failing = gates.evaluate_gates(integrity, {"missing_results": 1})
    assert [g for g in passing if "dropped" in g.name][0].passed
    assert not [g for g in failing if "dropped" in g.name][0].passed


# --------------------------------------------------------------------------
# derived metrics
# --------------------------------------------------------------------------

def test_ranked_unit_ids_falls_back_to_the_chunk_id_when_unmapped():
    result = {"ranked": [{"chunkId": "c1", "unitId": None},
                         {"chunkId": "c2", "unitId": "u2"}]}
    assert gates.ranked_unit_ids(result) == ["c1", "u2"]


def test_to_benchmark_results_shape():
    records = gates.to_benchmark_results(clean_payload())
    assert [r["id"] for r in records] == ["q-hit", "q-abstain", "q-lexical"]
    assert records[0]["ranked_document_ids"] == ["kanun-1@v1#madde-1"]
    assert records[1]["ranked_document_ids"] == []
    assert records[1]["abstained"] is True


def test_citation_payload_deduplicates_shared_evidence():
    payload = clean_payload()
    # The same passage cited by two queries is ONE citation to verify.
    payload["results"][2]["evidence"] = copy.deepcopy(payload["results"][0]["evidence"])
    citation_input = gates.to_citation_payload(payload)
    assert len(citation_input["evidence"]) == 1
    assert len(citation_input["claims"]) == 2


def test_citation_payload_keys_the_docstore_by_version_id():
    citation_input = gates.to_citation_payload(clean_payload())
    docstore = gates.docstore_from_payload(clean_payload())
    for record in citation_input["evidence"]:
        assert record["documentId"] in docstore


def test_abstention_metrics_precision_and_recall():
    metrics = gates.abstention_metrics(GOLD, clean_payload())
    assert metrics["abstained_queries"] == 1
    assert metrics["should_abstain_queries"] == 1
    assert metrics["abstention_precision"] == 1.0
    assert metrics["abstention_recall"] == 1.0
    assert metrics["false_abstentions"] == []


def test_abstention_precision_drops_on_a_false_abstention():
    payload = clean_payload()
    payload["results"][0]["ranked"] = []
    payload["results"][0]["abstained"] = True
    metrics = gates.abstention_metrics(GOLD, payload)
    assert metrics["abstained_queries"] == 2
    assert metrics["abstention_precision"] == 0.5
    assert metrics["false_abstentions"] == ["q-hit"]


def test_abstention_precision_convention_when_never_abstaining():
    payload = clean_payload()
    payload["results"][1]["abstained"] = False
    payload["results"][1]["ranked"] = [{
        "chunkId": "chunk-ev-a", "documentId": f"doc-{VERSION_A}",
        "documentVersionId": VERSION_A, "unitId": "kanun-1@v1#madde-1",
        "scope": "public", "tenantId": None, "lanes": [],
    }]
    metrics = gates.abstention_metrics(GOLD, payload)
    assert metrics["abstained_queries"] == 0
    assert metrics["abstention_precision"] == 1.0
    assert "convention" in metrics["abstention_precision_convention"]
    assert metrics["missed_abstentions"] == ["q-abstain"]


def test_form_metrics_parity_pair_detection():
    metrics = gates.form_metrics(GOLD, clean_payload())
    assert metrics["parity_pairs"] == 1
    assert metrics["abbreviation_queries"] == 1
    assert metrics["full_name_queries"] == 1
    assert metrics["abbreviation_form_accuracy"] == 1.0
    # The two members of the pair returned different rankings here.
    assert metrics["abbreviation_form_parity"] == 0.0


def test_form_metrics_parity_is_one_when_both_forms_rank_identically():
    payload = clean_payload()
    payload["results"][2]["ranked"] = copy.deepcopy(payload["results"][0]["ranked"])
    metrics = gates.form_metrics(GOLD, payload)
    assert metrics["abbreviation_form_parity"] == 1.0


def test_lane_metrics_count_hits_and_zero_hit_queries():
    metrics = gates.lane_metrics(clean_payload())
    assert metrics["hits_by_lane"] == {
        "exact": 1, "lexical": 1, "trigram": 0, "dense": 0, "relation": 0,
        "citation": 0,
    }
    assert metrics["sole_contributor_by_lane"]["exact"] == 1
    assert metrics["zero_hit_queries"] == ["q-abstain"]
    assert metrics["zero_hit_query_count"] == 1


def test_lane_metrics_attribute_a_citation_expansion_hit():
    """W12: expansion hits now carry lane "citation"; the table must list it."""
    payload = clean_payload()
    payload["results"][0]["ranked"].append({
        "rank": 2, "chunkId": "chunk-ev-b", "documentId": f"doc-{VERSION_B}",
        "documentVersionId": VERSION_B, "unitId": "karar-1@v1#bolum-gerekce",
        "scope": "public", "tenantId": None, "pinned": False, "fusedScore": 0.0,
        "lanes": [{"lane": "citation", "rank": 1, "score": 0.0}],
    })
    metrics = gates.lane_metrics(payload)
    assert metrics["hits_by_lane"]["citation"] == 1
    assert metrics["sole_contributor_by_lane"]["citation"] == 1
    ranked_total = sum(len(r.get("ranked", [])) for r in payload["results"])
    assert sum(metrics["hits_by_lane"].values()) == ranked_total


# --------------------------------------------------------------------------
# answer-layer abstention (question-coverage gate, W12)
# --------------------------------------------------------------------------

def _with_coverage(payload: dict) -> dict:
    """Attach the driver's coverage record to every result."""
    payload = copy.deepcopy(payload)
    for result in payload["results"]:
        abstained = bool(result["abstained"])
        result["answer_abstained"] = abstained
        result["coverage"] = {
            "ratio": 0.0 if abstained else 1.0,
            "gate": "failed" if abstained else "passed",
            "floor": 0.4,
            "lexemes": ["madde"], "covered": [] if abstained else ["madde"],
            "missing": ["madde"] if abstained else [],
            "passages": 0 if abstained else 1, "bestPassageCovered": 0 if abstained else 1,
        }
    return payload


def test_coverage_gate_metrics_on_a_clean_payload():
    metrics = gates.coverage_gate_metrics(GOLD, _with_coverage(clean_payload()))
    assert metrics["measured_queries"] == 3
    assert metrics["answer_abstained_queries"] == 1
    assert metrics["should_abstain_queries"] == 1
    assert metrics["answer_abstention_precision"] == 1.0
    assert metrics["answer_abstention_recall"] == 1.0
    assert metrics["false_answer_abstentions"] == []
    assert metrics["missed_answer_abstentions"] == []
    assert metrics["gate_counts"] == {"failed": 1, "passed": 2}
    assert [row["id"] for row in metrics["per_query"]] == ["q-hit", "q-abstain", "q-lexical"]


def test_coverage_gate_reports_a_false_answer_abstention():
    """A query WITH expected documents on which the gate abstained is a
    product-level false abstention and must be named, never averaged away."""
    payload = _with_coverage(clean_payload())
    payload["results"][2]["answer_abstained"] = True
    payload["results"][2]["coverage"]["gate"] = "failed"
    metrics = gates.coverage_gate_metrics(GOLD, payload)
    assert metrics["false_answer_abstentions"] == ["q-lexical"]
    assert metrics["answer_abstention_precision"] == 0.5


def test_coverage_gate_reports_a_missed_answer_abstention():
    """Retrieval found passages AND the gate let them through on a no_answer
    query: the near-miss the gate could not catch, listed by id."""
    payload = _with_coverage(clean_payload())
    payload["results"][1]["abstained"] = False
    payload["results"][1]["answer_abstained"] = False
    payload["results"][1]["coverage"]["gate"] = "passed"
    metrics = gates.coverage_gate_metrics(GOLD, payload)
    assert metrics["missed_answer_abstentions"] == ["q-abstain"]
    assert metrics["answer_abstention_recall"] == 0.0


def test_coverage_gate_falls_back_to_retrieval_abstention_without_coverage():
    """An older payload with no coverage record is still scorable, and says so."""
    metrics = gates.coverage_gate_metrics(GOLD, clean_payload())
    assert metrics["measured_queries"] == 0
    assert metrics["gate_counts"] == {"n/a": 3}
    assert metrics["answer_abstention_recall"] == 1.0


# --------------------------------------------------------------------------
# answer-level (AnswerPipeline) outcomes — report only, W12-B2
# --------------------------------------------------------------------------

def answer_payload() -> dict:
    """What evals/answer/measure_answers.ts writes for the three GOLD rows."""
    return {
        "measured_layer": "test AnswerPipeline",
        "results": [
            {
                "id": "q-hit", "task_type": "exact_reference", "status": "COMPLETE",
                "finalizable": True, "claims": 1, "reasons": [],
                "coverage": {"gate": "bypassed-by-reference", "ratio": 1.0},
                "evidence": [{"chunkId": "chunk-ev-a", "unitId": "kanun-1@v1#madde-1",
                              "origin": "corpus", "currentness": "IN_FORCE"}],
            },
            {
                "id": "q-abstain", "task_type": "no_answer", "status": "ABSTAIN",
                "finalizable": False, "claims": 0,
                "reasons": ["NO_EVIDENCE", "ABSTENTION_NOT_FINALIZABLE"],
                "coverage": {"gate": "failed", "ratio": 0.0}, "evidence": [],
            },
            {
                "id": "q-lexical", "task_type": "fact_pattern", "status": "QUALIFIED",
                "finalizable": False, "claims": 1,
                "reasons": ["ENTAILMENT_BELOW_THRESHOLD:c1", "NOT_FINALIZABLE"],
                "coverage": {"gate": "passed", "ratio": 0.8},
                "evidence": [{"chunkId": "chunk-ev-b", "unitId": "karar-1@v1#bolum-gerekce",
                              "origin": "corpus", "currentness": "IN_FORCE"}],
            },
        ],
    }


def test_answer_level_metrics_on_a_clean_payload():
    metrics = gates.answer_level_metrics(GOLD, answer_payload())
    assert metrics["measured_queries"] == 3
    assert metrics["missing_queries"] == []
    assert metrics["error_queries"] == []
    assert metrics["status_counts"] == {"ABSTAIN": 1, "COMPLETE": 1, "QUALIFIED": 1}
    assert metrics["answerable_queries"] == 2
    assert metrics["no_answer_queries"] == 1
    assert metrics["false_abstentions"] == [] and metrics["false_abstention_count"] == 0
    assert metrics["false_answers"] == [] and metrics["false_answer_count"] == 0
    assert metrics["correct_abstentions"] == ["q-abstain"]
    # One of the two answerable rows finalized.
    assert metrics["finalizable_answers"] == 1
    assert metrics["finalizable_rate"] == 0.5
    assert metrics["finalizable_total"] == 1
    assert metrics["finalizable_rate_overall"] == 1 / 3
    # Both answerable rows cite an expected unit.
    assert metrics["expected_unit_checked"] == 2
    assert metrics["expected_unit_in_evidence_rate"] == 1.0
    assert [row["id"] for row in metrics["per_query"]] == ["q-hit", "q-abstain", "q-lexical"]
    assert metrics["per_query"][1]["expected_in_evidence"] is None


def test_answer_level_reports_a_false_abstention():
    """An answerable row the PIPELINE abstained on is named, never averaged."""
    payload = answer_payload()
    payload["results"][0].update({"status": "ABSTAIN", "finalizable": False, "claims": 0,
                                  "evidence": [], "reasons": ["QUESTION_NOT_COVERED"]})
    metrics = gates.answer_level_metrics(GOLD, payload)
    assert metrics["false_abstentions"] == ["q-hit"]
    assert metrics["false_abstention_count"] == 1
    assert metrics["finalizable_rate"] == 0.0
    assert metrics["status_counts"] == {"ABSTAIN": 2, "QUALIFIED": 1}


def test_answer_level_reports_a_false_answer():
    """A no_answer row that got any status but ABSTAIN is a false answer."""
    payload = answer_payload()
    payload["results"][1].update({"status": "COMPLETE", "finalizable": True, "claims": 1})
    metrics = gates.answer_level_metrics(GOLD, payload)
    assert metrics["false_answers"] == ["q-abstain"]
    assert metrics["false_answer_count"] == 1
    assert metrics["correct_abstentions"] == []
    # The finalizable RATE is over answerable rows only; the overall count
    # still sees the finalized false answer.
    assert metrics["finalizable_rate"] == 0.5
    assert metrics["finalizable_total"] == 2


def test_answer_level_lists_missing_and_error_rows():
    payload = answer_payload()
    payload["results"].pop(2)
    payload["results"][0].update({"status": "ERROR", "finalizable": False,
                                  "error": "IntakeValidationError: question too short"})
    metrics = gates.answer_level_metrics(GOLD, payload)
    assert metrics["missing_queries"] == ["q-lexical"]
    assert metrics["error_queries"] == ["q-hit"]
    assert metrics["measured_queries"] == 2
    # An errored row is neither a false abstention nor an answer.
    assert metrics["false_abstentions"] == []
    assert metrics["answerable_queries"] == 0
    assert metrics["finalizable_rate"] is None
    assert metrics["expected_unit_checked"] == 0
    assert metrics["per_query"][0]["error"].startswith("IntakeValidationError")


def test_answer_level_expected_unit_miss_is_counted():
    payload = answer_payload()
    payload["results"][2]["evidence"][0]["unitId"] = "karar-1@v1#bolum-hukum"
    metrics = gates.answer_level_metrics(GOLD, payload)
    assert metrics["expected_unit_in_evidence_rate"] == 0.5
    assert metrics["per_query"][2]["expected_in_evidence"] is False


def test_lane_metrics_attribute_every_ranked_hit_to_some_lane():
    """A lane missing from the table loses its hits SILENTLY.

    ``lane_metrics`` intersects each hit's lane names with its own tuple, so a
    lane it does not list is not reported as zero — its hits are attributed to
    nothing at all and the per-lane counts stop summing to the ranked total.
    That is exactly what happened when the citator lane shipped as ``relation``.
    """
    payload = clean_payload()
    payload["results"][1]["ranked"].append({
        "rank": 2, "chunkId": "chunk-ev-a", "documentId": f"doc-{VERSION_A}",
        "documentVersionId": VERSION_A, "unitId": "kanun-1@v1#madde-1",
        "scope": "public", "tenantId": None, "pinned": False, "fusedScore": 0.0,
        "lanes": [{"lane": "relation", "rank": 1, "score": 1}],
    })

    metrics = gates.lane_metrics(payload)
    assert metrics["hits_by_lane"]["relation"] == 1
    assert metrics["sole_contributor_by_lane"]["relation"] == 1

    ranked_total = sum(len(r.get("ranked", [])) for r in payload["results"])
    assert sum(metrics["hits_by_lane"].values()) == ranked_total


# --------------------------------------------------------------------------
# W14 M-SRV / N-7 — the answer-layer BAND and the one gate that reads it
# --------------------------------------------------------------------------
#
# The answer layer is not reproducible from one INGEST to the next: measured
# 03.09.2026, three runs of the answer driver against ONE already-ingested
# database were byte-identical, while four runs that each re-ingested the same
# corpus gave two different outcomes. So the report prints a band and exactly
# one thing is gated on it — a gold row marked `acceptable_abstention` must
# never be answered, in ANY repeat.


def _answer_run(**over) -> dict:
    """One repeat's answer-level metric dict, in the shape gates.py produces."""
    run = {
        "measured_queries": 34,
        "answerable_queries": 21,
        "no_answer_queries": 13,
        "status_counts": {"ABSTAIN": 13, "COMPLETE": 14, "PARTIAL": 3, "QUALIFIED": 4},
        "false_abstentions": [],
        "false_abstention_count": 0,
        "false_answers": [],
        "false_answer_count": 0,
        "error_queries": [],
        "missing_queries": [],
        "finalizable_answers": 18,
        "finalizable_total": 18,
        "finalizable_rate": 18 / 21,
        "finalizable_rate_overall": 18 / 34,
        "expected_unit_in_evidence_rate": 0.952,
    }
    run.update(over)
    return run


def test_answer_band_reports_a_range_and_names_the_rows_that_moved():
    steady = _answer_run()
    moved = _answer_run(
        status_counts={"ABSTAIN": 14, "COMPLETE": 12, "PARTIAL": 3, "QUALIFIED": 5},
        false_abstentions=["fx-amend-002"],
        false_abstention_count=1,
        finalizable_answers=17,
        finalizable_total=17,
        finalizable_rate=17 / 21,
    )
    band = gates.answer_level_band([steady, moved], ingests=2)

    assert band["repeats"] == 2 and band["ingests"] == 2
    # The band must NOT claim stability it does not have.
    assert band["stable"] is False
    assert band["false_abstention_count"]["min"] == 0
    assert band["false_abstention_count"]["max"] == 1
    assert band["status_counts"]["COMPLETE"]["min"] == 12
    assert band["status_counts"]["COMPLETE"]["max"] == 14
    # The row that moved is NAMED, so a reader can go look at it.
    assert band["false_abstentions_union"] == ["fx-amend-002"]


def test_answer_band_calls_identical_repeats_stable():
    band = gates.answer_level_band([_answer_run(), _answer_run()], ingests=2)
    assert band["stable"] is True
    assert band["finalizable_rate"]["min"] == band["finalizable_rate"]["max"]


def test_answer_band_gate_passes_when_no_repeat_answered_a_no_answer_row():
    band = gates.answer_level_band([_answer_run(), _answer_run()], ingests=2)
    gate = gates._answer_band_gate(band)
    assert gate.passed, gate.detail
    assert "0 no_answer gold row(s) answered over 2 repeat(s)" in gate.detail


def test_answer_band_gate_fails_when_ONE_repeat_answered_a_no_answer_row():
    """NON-VACUITY: one bad repeat out of many is still a failure.

    "It only happened in one of four runs" is not a defence for answering a
    question the corpus cannot answer — that is the failure this product
    exists to prevent, and the gate reads the band's WORST repeat.
    """
    band = gates.answer_level_band(
        [
            _answer_run(),
            _answer_run(false_answers=["fx-noanswer-004"], false_answer_count=1),
            _answer_run(),
            _answer_run(),
        ],
        ingests=4,
    )
    gate = gates._answer_band_gate(band)
    assert not gate.passed
    assert "fx-noanswer-004" in gate.detail


def test_evaluate_gates_carries_the_band_gate_only_when_a_band_is_given():
    integrity = _integrity(clean_payload())
    names = [g.name for g in gates.evaluate_gates(integrity, {"missing_results": 0})]
    assert not any("false answers" in n for n in names)

    bad = gates.answer_level_band(
        [_answer_run(false_answers=["fx-noanswer-001"], false_answer_count=1)],
        ingests=1,
    )
    results = gates.evaluate_gates(integrity, {"missing_results": 0}, bad)
    band_gates = [g for g in results if "false answers" in g.name]
    assert len(band_gates) == 1
    assert not band_gates[0].passed
