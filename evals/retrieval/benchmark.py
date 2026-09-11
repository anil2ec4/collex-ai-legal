"""Retrieval benchmark metrics for the Turkish legal gold set.

Computes the retrieval-layer metrics named in the master build brief (section 8.1
and 13.1): Recall@K, nDCG@10, MRR, exact-reference accuracy, contrary-authority
recall, temporal accuracy, plus p50/p95 latency from an optional timing field.

Everything here is deterministic and offline: it reads a gold JSONL and a results
JSONL and prints/writes a JSON report. No network, no model calls.

Gold record fields consumed (see ../datasets/SCHEMA.md):
    id, task_type, expected_documents, contrary_authorities, acceptable_abstention

Results record shape (one JSON object per line):
    {"id": "<gold id>", "ranked_document_ids": ["docA", "docB", ...],
     "latency_ms": 123.4}          # latency_ms optional
    # For an abstention answer, use "ranked_document_ids": [] (or "abstained": true).

CLI:
    python evals/retrieval/benchmark.py --gold gold.jsonl --results results.jsonl \
        --out report.json [--k 5 10 20] [--quiet]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable

DEFAULT_KS = (5, 10, 20)

# Task types whose "expected_documents" carry an exact reference (a specific
# statute article or a specific E./K. decision) that must be retrieved at rank 1.
EXACT_REFERENCE_TASK_TYPES = frozenset({"exact_reference"})

# Task types that assert the law as-of a date; temporal accuracy is scored on these.
TEMPORAL_TASK_TYPES = frozenset({"temporal", "temporal_amendment"})


# --------------------------------------------------------------------------- io
def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    """Read a JSONL file into a list of dicts, skipping blank lines."""
    records: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:  # pragma: no cover - defensive
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
    return records


def index_by_id(records: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for record in records:
        record_id = record.get("id")
        if record_id is None:
            raise ValueError("record without 'id' field")
        out[str(record_id)] = record
    return out


# --------------------------------------------------------------- per-query math
def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """Fraction of relevant documents found within the first k ranked ids.

    Returns 1.0 by convention when there are no relevant documents (nothing to
    miss); callers that want to treat no-answer queries separately should filter
    them out before aggregating.
    """
    if not relevant:
        return 1.0
    top = ranked[:k]
    hits = sum(1 for doc in relevant if doc in top)
    return hits / len(relevant)


def reciprocal_rank(ranked: list[str], relevant: set[str]) -> float:
    """1/rank of the first relevant document (1-indexed), else 0.0."""
    for position, doc in enumerate(ranked, start=1):
        if doc in relevant:
            return 1.0 / position
    return 0.0


def dcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """Binary-gain DCG using the log2(rank+1) discount (rank 1-indexed).

    gain_i = 1 if ranked[i] is relevant else 0
    DCG = sum over i in [1..k] of gain_i / log2(i + 1)
    """
    total = 0.0
    for position, doc in enumerate(ranked[:k], start=1):
        if doc in relevant:
            total += 1.0 / math.log2(position + 1)
    return total


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    """Normalised DCG@k with binary relevance.

    IDCG is the DCG of the ideal ranking: min(len(relevant), k) relevant docs
    packed into the top positions. Returns 1.0 when there is nothing relevant
    (perfect by convention), matching recall_at_k's no-relevant handling.
    """
    if not relevant:
        return 1.0
    ideal_hits = min(len(relevant), k)
    idcg = sum(1.0 / math.log2(position + 1) for position in range(1, ideal_hits + 1))
    if idcg == 0.0:
        return 0.0
    return dcg_at_k(ranked, relevant, k) / idcg


def percentile(values: list[float], pct: float) -> float:
    """Linear-interpolation percentile (same method as numpy's default).

    pct is in [0, 100]. Empty input returns 0.0.
    """
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100.0) * (len(ordered) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return ordered[int(rank)]
    fraction = rank - low
    return ordered[low] + (ordered[high] - ordered[low]) * fraction


# --------------------------------------------------------------- aggregation
def _ranked_ids(result: dict[str, Any]) -> list[str]:
    ranked = result.get("ranked_document_ids", [])
    if not isinstance(ranked, list):
        raise ValueError(
            f"result {result.get('id')!r}: 'ranked_document_ids' must be a list"
        )
    return [str(doc) for doc in ranked]


def compute_metrics(
    gold: list[dict[str, Any]],
    results: list[dict[str, Any]],
    ks: Iterable[int] = DEFAULT_KS,
) -> dict[str, Any]:
    """Compute the full retrieval metric report.

    Missing results (a gold id with no matching result line) are scored as an
    empty ranking (recall 0, rr 0, ndcg 0) and counted under 'missing_results'
    so a silently dropped query cannot inflate the score.
    """
    ks = sorted(set(int(k) for k in ks))
    results_by_id = index_by_id(results)

    # per-query records for aggregation and for the detail section
    per_query: list[dict[str, Any]] = []

    recall_sums = {k: 0.0 for k in ks}
    recall_counts = {k: 0 for k in ks}  # queries with >=1 relevant doc
    ndcg10_sum = 0.0
    ndcg10_count = 0
    rr_sum = 0.0
    rr_count = 0

    exact_total = 0
    exact_correct = 0
    contrary_total = 0
    contrary_recall_sum = 0.0
    temporal_total = 0
    temporal_correct = 0

    abstention_total = 0
    abstention_correct = 0

    latencies: list[float] = []
    missing_results = 0

    for gold_record in gold:
        gold_id = str(gold_record["id"])
        task_type = gold_record.get("task_type", "")
        expected = set(str(d) for d in gold_record.get("expected_documents", []))
        contrary = set(str(d) for d in gold_record.get("contrary_authorities", []))
        acceptable_abstention = bool(gold_record.get("acceptable_abstention", False))

        result = results_by_id.get(gold_id)
        if result is None:
            missing_results += 1
            ranked: list[str] = []
            abstained = False
            latency = None
        else:
            ranked = _ranked_ids(result)
            abstained = bool(result.get("abstained", False)) or (
                len(ranked) == 0 and "abstained" in result
            )
            latency = result.get("latency_ms")

        if isinstance(latency, (int, float)):
            latencies.append(float(latency))

        query_row: dict[str, Any] = {"id": gold_id, "task_type": task_type}

        # Recall@k / nDCG@10 / MRR only score queries that have relevant docs.
        if expected:
            for k in ks:
                recall_sums[k] += recall_at_k(ranked, expected, k)
                recall_counts[k] += 1
            n10 = ndcg_at_k(ranked, expected, 10)
            ndcg10_sum += n10
            ndcg10_count += 1
            query_row["ndcg@10"] = round(n10, 6)
            rr = reciprocal_rank(ranked, expected)
            rr_sum += rr
            rr_count += 1
            query_row["reciprocal_rank"] = round(rr, 6)
            for k in ks:
                query_row[f"recall@{k}"] = round(recall_at_k(ranked, expected, k), 6)

        # Exact-reference accuracy: the single expected doc must be at rank 1.
        if task_type in EXACT_REFERENCE_TASK_TYPES and expected:
            exact_total += 1
            correct = bool(ranked) and ranked[0] in expected
            exact_correct += int(correct)
            query_row["exact_reference_correct"] = correct

        # Contrary-authority recall: of the contrary authorities, how many appear
        # anywhere in the ranked list.
        if contrary:
            contrary_total += 1
            found = sum(1 for doc in contrary if doc in ranked)
            score = found / len(contrary)
            contrary_recall_sum += score
            query_row["contrary_authority_recall"] = round(score, 6)

        # Temporal accuracy: for temporal task types, the dated expected doc(s)
        # must be retrieved (all of them present in the ranking).
        if task_type in TEMPORAL_TASK_TYPES and expected:
            temporal_total += 1
            correct = expected.issubset(set(ranked))
            temporal_correct += int(correct)
            query_row["temporal_correct"] = correct

        # Abstention handling for no-answer queries.
        if acceptable_abstention:
            abstention_total += 1
            correct = abstained or len(ranked) == 0
            abstention_correct += int(correct)
            query_row["abstention_correct"] = correct

        per_query.append(query_row)

    metrics: dict[str, Any] = {}
    for k in ks:
        metrics[f"recall@{k}"] = (
            recall_sums[k] / recall_counts[k] if recall_counts[k] else None
        )
    metrics["ndcg@10"] = ndcg10_sum / ndcg10_count if ndcg10_count else None
    metrics["mrr"] = rr_sum / rr_count if rr_count else None
    metrics["exact_reference_accuracy"] = (
        exact_correct / exact_total if exact_total else None
    )
    metrics["contrary_authority_recall"] = (
        contrary_recall_sum / contrary_total if contrary_total else None
    )
    metrics["temporal_accuracy"] = (
        temporal_correct / temporal_total if temporal_total else None
    )
    metrics["abstention_accuracy"] = (
        abstention_correct / abstention_total if abstention_total else None
    )

    latency_block = {
        "count": len(latencies),
        "p50_ms": percentile(latencies, 50) if latencies else None,
        "p95_ms": percentile(latencies, 95) if latencies else None,
    }

    report = {
        "counts": {
            "gold_queries": len(gold),
            "scored_results": len(results),
            "missing_results": missing_results,
            "exact_reference_queries": exact_total,
            "contrary_authority_queries": contrary_total,
            "temporal_queries": temporal_total,
            "abstention_queries": abstention_total,
        },
        "metrics": _round_metrics(metrics),
        "latency": latency_block,
        "per_query": per_query,
    }
    return report


def _round_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in metrics.items():
        out[key] = round(value, 6) if isinstance(value, float) else value
    return out


# --------------------------------------------------------------------- cli
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compute retrieval benchmark metrics from a gold + results JSONL pair."
    )
    parser.add_argument("--gold", required=True, help="Path to gold JSONL.")
    parser.add_argument("--results", required=True, help="Path to results JSONL.")
    parser.add_argument("--out", required=True, help="Path to write the JSON report.")
    parser.add_argument(
        "--k",
        type=int,
        nargs="+",
        default=list(DEFAULT_KS),
        help="Cutoffs for Recall@K (default: 5 10 20).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Do not print the headline metrics to stdout.",
    )
    args = parser.parse_args(argv)

    gold = load_jsonl(args.gold)
    results = load_jsonl(args.results)
    report = compute_metrics(gold, results, ks=args.k)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    if not args.quiet:
        print(f"Wrote report to {out_path}")
        for key, value in report["metrics"].items():
            print(f"  {key}: {value}")
        latency = report["latency"]
        print(
            f"  latency p50/p95 ms: {latency['p50_ms']}/{latency['p95_ms']} "
            f"(n={latency['count']})"
        )
        if report["counts"]["missing_results"]:
            print(
                f"  WARNING: {report['counts']['missing_results']} gold queries had "
                "no matching result line (scored as empty ranking)."
            )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
