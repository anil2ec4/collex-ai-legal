"""Unit tests for the retrieval benchmark metrics.

A tiny synthetic gold/result pair with hand-computed expected metrics. The nDCG
calculation is worked out longhand in the comments so the expected constants can
be checked by eye against the formula, independent of the implementation.
"""

from __future__ import annotations

import json
import math

import benchmark  # noqa: E402  (path injected by conftest.py)


# --------------------------------------------------------------------------
# Synthetic fixtures
#
# Five gold queries covering the metric surfaces:
#   q_exact  exact_reference, expected {A}
#   q_fact   fact_pattern,    expected {B, C}
#   q_temp   temporal,        expected {D}
#   q_contra contrary_authority, expected {E}, contrary {F}
#   q_noans  no_answer,       expected {},  acceptable_abstention true
# --------------------------------------------------------------------------
GOLD = [
    {"id": "q_exact", "task_type": "exact_reference",
     "expected_documents": ["A"], "contrary_authorities": [],
     "acceptable_abstention": False},
    {"id": "q_fact", "task_type": "fact_pattern",
     "expected_documents": ["B", "C"], "contrary_authorities": [],
     "acceptable_abstention": False},
    {"id": "q_temp", "task_type": "temporal",
     "expected_documents": ["D"], "contrary_authorities": [],
     "acceptable_abstention": False},
    {"id": "q_contra", "task_type": "contrary_authority",
     "expected_documents": ["E"], "contrary_authorities": ["F"],
     "acceptable_abstention": False},
    {"id": "q_noans", "task_type": "no_answer",
     "expected_documents": [], "contrary_authorities": [],
     "acceptable_abstention": True},
]

RESULTS = [
    # A at rank 1 -> exact reference correct; recall/rr/ndcg all perfect.
    {"id": "q_exact", "ranked_document_ids": ["A", "Z"], "latency_ms": 10.0},
    # relevant {B, C} at ranks 2 and 3 (X irrelevant at rank 1).
    {"id": "q_fact", "ranked_document_ids": ["X", "B", "C"], "latency_ms": 20.0},
    # D missing from the ranking -> temporal wrong, recall 0.
    {"id": "q_temp", "ranked_document_ids": ["Y", "Z"], "latency_ms": 30.0},
    # E at rank 1, contrary authority F also present at rank 2 -> contrary recall 1.
    {"id": "q_contra", "ranked_document_ids": ["E", "F"], "latency_ms": 40.0},
    # correctly abstains (empty ranking).
    {"id": "q_noans", "ranked_document_ids": [], "abstained": True},
]

KS = [1, 3]


def _report():
    return benchmark.compute_metrics(GOLD, RESULTS, ks=KS)


def test_recall_at_k():
    m = _report()["metrics"]
    # Per-query recall (queries with relevant docs: q_exact, q_fact, q_temp, q_contra):
    #   recall@1: q_exact=1 (A@1), q_fact=0 (X@1), q_temp=0 (miss), q_contra=1 (E@1)
    #            mean = (1 + 0 + 0 + 1) / 4 = 0.5
    #   recall@3: q_exact=1, q_fact=1 (B,C in top3), q_temp=0, q_contra=1
    #            mean = (1 + 1 + 0 + 1) / 4 = 0.75
    assert math.isclose(m["recall@1"], 0.5, rel_tol=0, abs_tol=1e-9)
    assert math.isclose(m["recall@3"], 0.75, rel_tol=0, abs_tol=1e-9)


def test_mrr():
    m = _report()["metrics"]
    # Reciprocal ranks: q_exact=1/1, q_fact=1/2 (B@2), q_temp=0, q_contra=1/1
    # MRR = (1 + 0.5 + 0 + 1) / 4 = 0.625
    assert math.isclose(m["mrr"], 0.625, rel_tol=0, abs_tol=1e-9)


def test_ndcg_at_10_hand_calc():
    m = _report()["metrics"]
    # nDCG@10 is averaged over the four queries that have relevant documents.
    #
    # q_exact: relevant {A}, ranked [A, Z].
    #   DCG  = gain(A@1)/log2(1+1) = 1/log2(2) = 1/1 = 1.0
    #   IDCG = 1 relevant packed at rank 1 = 1/log2(2) = 1.0
    #   nDCG = 1.0 / 1.0 = 1.0
    #
    # q_fact: relevant {B, C}, ranked [X, B, C].
    #   DCG  = gain(B@2)/log2(2+1) + gain(C@3)/log2(3+1)
    #        = 1/log2(3) + 1/log2(4)
    #        = 0.6309297535714575 + 0.5
    #        = 1.1309297535714575
    #   IDCG = 2 relevant packed at ranks 1,2 = 1/log2(2) + 1/log2(3)
    #        = 1.0 + 0.6309297535714575 = 1.6309297535714575
    #   nDCG = 1.1309297535714575 / 1.6309297535714575 = 0.6934264036172708
    #
    # q_temp: relevant {D}, ranked [Y, Z]  -> D absent -> DCG 0 -> nDCG 0.0
    #
    # q_contra: relevant {E}, ranked [E, F].
    #   DCG  = gain(E@1)/log2(2) = 1.0 ; IDCG = 1.0 ; nDCG = 1.0
    #
    # mean nDCG@10 = (1.0 + 0.6934264036172708 + 0.0 + 1.0) / 4
    #             = 2.6934264036172708 / 4
    #             = 0.6733566009043177
    # Report metrics are rounded to 6 decimals (benchmark._round_metrics), so
    # compare at that precision.
    expected = (1.0 + 0.6934264036172708 + 0.0 + 1.0) / 4
    assert math.isclose(m["ndcg@10"], round(expected, 6), rel_tol=0, abs_tol=1e-9)
    assert math.isclose(m["ndcg@10"], 0.673357, rel_tol=0, abs_tol=1e-9)


def test_exact_reference_accuracy():
    report = _report()
    # Only q_exact is an exact_reference query; A is at rank 1 -> 1/1 = 1.0
    assert report["counts"]["exact_reference_queries"] == 1
    assert math.isclose(report["metrics"]["exact_reference_accuracy"], 1.0)


def test_contrary_authority_recall():
    report = _report()
    # Only q_contra has contrary authorities ({F}); F is in the ranking -> 1/1 = 1.0
    assert report["counts"]["contrary_authority_queries"] == 1
    assert math.isclose(report["metrics"]["contrary_authority_recall"], 1.0)


def test_temporal_accuracy():
    report = _report()
    # Only q_temp is temporal; D is missing from the ranking -> 0/1 = 0.0
    assert report["counts"]["temporal_queries"] == 1
    assert math.isclose(report["metrics"]["temporal_accuracy"], 0.0)


def test_abstention_accuracy():
    report = _report()
    # q_noans acceptably abstains and the result is an empty ranking -> 1/1 = 1.0
    assert report["counts"]["abstention_queries"] == 1
    assert math.isclose(report["metrics"]["abstention_accuracy"], 1.0)


def test_latency_percentiles():
    report = _report()
    latency = report["latency"]
    # Latencies present: [10, 20, 30, 40] (q_noans has none).
    # p50 (linear interpolation) = 25.0 ; p95 = 38.5
    assert latency["count"] == 4
    assert math.isclose(latency["p50_ms"], 25.0)
    assert math.isclose(latency["p95_ms"], 38.5)


def test_missing_result_scored_as_empty():
    # Drop q_temp's result entirely: it must be counted missing and scored 0,
    # never silently ignored.
    results = [r for r in RESULTS if r["id"] != "q_temp"]
    report = benchmark.compute_metrics(GOLD, results, ks=KS)
    assert report["counts"]["missing_results"] == 1
    # temporal_accuracy still 0 (q_temp now empty ranking) and recall unaffected upward.
    assert math.isclose(report["metrics"]["temporal_accuracy"], 0.0)
    assert math.isclose(report["metrics"]["recall@3"], 0.75, abs_tol=1e-9)


def test_pure_metric_helpers():
    # Direct checks on the building blocks.
    assert benchmark.recall_at_k(["A", "B"], {"B"}, 1) == 0.0
    assert benchmark.recall_at_k(["A", "B"], {"B"}, 2) == 1.0
    assert benchmark.recall_at_k(["A"], set(), 5) == 1.0  # nothing relevant -> perfect
    assert benchmark.reciprocal_rank(["A", "B", "C"], {"C"}) == 1.0 / 3.0
    assert benchmark.reciprocal_rank(["A"], {"Z"}) == 0.0
    assert benchmark.ndcg_at_k(["A"], set(), 10) == 1.0
    assert benchmark.ndcg_at_k(["Z"], {"A"}, 10) == 0.0


def test_cli_writes_report(tmp_path):
    gold_path = tmp_path / "gold.jsonl"
    results_path = tmp_path / "results.jsonl"
    out_path = tmp_path / "report.json"
    gold_path.write_text(
        "\n".join(json.dumps(g, ensure_ascii=False) for g in GOLD) + "\n",
        encoding="utf-8",
    )
    results_path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in RESULTS) + "\n",
        encoding="utf-8",
    )
    rc = benchmark.main(
        [
            "--gold", str(gold_path),
            "--results", str(results_path),
            "--out", str(out_path),
            "--k", "1", "3",
            "--quiet",
        ]
    )
    assert rc == 0
    report = json.loads(out_path.read_text(encoding="utf-8"))
    assert math.isclose(report["metrics"]["mrr"], 0.625, abs_tol=1e-9)
