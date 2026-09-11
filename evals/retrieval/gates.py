"""Derived metrics and HARD INVARIANT GATES for the fixture-corpus baseline.

Pure functions over the JSON payload produced by
``evals/retrieval/measure_retrieval.ts`` (bundled and run by
``scripts/run_evals.py``). Nothing here touches the database, the network or
the filesystem, so ``evals/tests`` can exercise every gate offline.

METRIC DEFINITIONS (each one is the exact arithmetic used in the report)
-----------------------------------------------------------------------
``citation_resolvability``
    numerator   = ranked hits that became an EvidenceRef in the product's
                  evidence pack AND whose document resolves in the independent
                  Python checker (no DOCUMENT_NOT_FOUND / EVIDENCE_NOT_FOUND).
    denominator = every ranked hit returned across all gold queries.
    A retrieved hit that cannot be turned into a resolvable citation is a
    failure, not an omission. MUST be 1.0.

``quote_hash_integrity``
    numerator   = evidence records passing ALL four deterministic checks of
                  evals/citations/check_citations.py (offset in range, quote ==
                  code-point slice, sha256(quote) == quoteSha256,
                  sha256(canonical) == contentSha256).
    denominator = evidence records emitted, DEDUPLICATED by the deterministic
                  evidence id (sha256 of version id + span), because the same
                  passage cited by two queries is one citation to verify.
    An evidence record additionally counts as verified only when its
    ``contentSha256`` equals the hash INGESTION stored for that version. The
    evidence pack recomputes the content hash from the text it just fetched, so
    that round trip is self-consistent by construction; comparing against the
    stored hash is what actually detects canonical text drifting away from what
    was recorded at ingest time.
    MUST be 1.0.

``lane_contribution``
    How many ranked hits each retrieval lane contributed. A lane with zero
    contribution is not "fine": it means that lane is adding no recall on this
    corpus, and the report must say so instead of hiding it inside an average.

``fabricated_ids``
    Count of identifiers returned by retrieval or by the evidence pack that do
    not exist in the corpus inventory read straight out of the database:
    unknown chunk id, unknown document id, unknown document version id.
    MUST be 0.

``cross_tenant_leak_indicators``
    Count of ranked hits whose document is not ``scope = 'public'`` (or which
    carry a non-null ``tenant_id``). The public corpus search must never return
    a tenant-scoped document. MUST be 0.

``abbreviation_form_accuracy``
    Over gold records with ``reference_form == "abbreviation"``: the fraction
    whose ``expected_documents`` are ALL present in the top-10 unit ids.
    (The full-name twin of each pair is scored the same way as
    ``full_name_form_accuracy`` so the two are directly comparable.)

``abbreviation_form_parity``
    Over ``parity_group``s that contain exactly one abbreviation-form and one
    full-name-form record: the fraction whose top-10 unit-id lists are
    IDENTICAL, in the same order. This is the strict form of "TCK m.157"
    behaving exactly like "5237 sayılı Türk Ceza Kanunu m.157".

``abstention_precision`` / ``abstention_recall``
    A run "abstains" on a query when retrieval returned zero hits.
    precision = abstained-and-should-have / abstained
    recall    = abstained-and-should-have / should-have (acceptable_abstention)
    Precision is 1.0 by convention when the system never abstained (no false
    abstentions were possible); that convention is stated in the report.

``coverage_gate_metrics`` (W12 lane B)
    The ANSWER-layer abstention: retrieval returned nothing, OR the
    question-coverage gate (control-plane/src/answer/coverage.ts) refused the
    validated passages. The driver runs the product's own gate function and
    reports per query ``answer_abstained`` plus the coverage it measured.
    Precision/recall are computed exactly as above but over
    ``answer_abstained``; in addition ``false_answer_abstentions`` lists the
    queries WITH expected documents on which the gate abstained — a
    product-level false abstention, reported as a tripwire (not a hard gate,
    because the gate is lexical by design and its limits are documented).

``answer_level_metrics`` (W12-B2, REPORT ONLY — no gate)
    Outcomes of the REAL ``AnswerPipeline`` (evals/answer/measure_answers.ts:
    cap, drafter, verifier, finalization) per gold query:
    ``status_counts``; ``false_abstentions`` = answerable rows
    (``acceptable_abstention`` false) whose status is ABSTAIN;
    ``false_answers`` = no_answer rows whose status is anything but ABSTAIN;
    ``finalizable_rate`` = finalizable answers / answerable rows;
    ``expected_unit_in_evidence_rate`` = answerable rows whose evidence pack
    cites at least one ``expected_documents`` unit. Rows the pipeline threw
    on are listed as ``error_queries`` and excluded from the ratios; gold
    rows with no result line are listed as ``missing_queries``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

# Reason codes from evals/citations/check_citations.py that mean "the citation
# does not resolve at all" (as opposed to "it resolves but does not verify").
UNRESOLVABLE_REASONS = frozenset({"DOCUMENT_NOT_FOUND", "EVIDENCE_NOT_FOUND"})

TOP_K_FOR_FORM_METRICS = 10


# --------------------------------------------------------------------------
# payload -> benchmark inputs
# --------------------------------------------------------------------------

def ranked_unit_ids(result: dict[str, Any]) -> list[str]:
    """Unit ids for one query's ranked hits, best first.

    A hit whose chunk id is absent from the corpus inventory has ``unitId``
    null; it is kept in the ranking under its raw chunk id so it can never
    silently match a gold id, and it is counted as a fabricated id.
    """
    out: list[str] = []
    for hit in result.get("ranked", []):
        unit_id = hit.get("unitId")
        out.append(str(unit_id) if unit_id is not None else str(hit.get("chunkId")))
    return out


def to_benchmark_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert the driver payload into benchmark.py result records."""
    records: list[dict[str, Any]] = []
    for result in payload.get("results", []):
        records.append({
            "id": result["id"],
            "ranked_document_ids": ranked_unit_ids(result),
            "latency_ms": result.get("latency_ms"),
            "abstained": bool(result.get("abstained", False)),
        })
    return records


def to_citation_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Build the claims+evidence document consumed by check_citations.py.

    NOTE ON ``documentId``: check_citations keys its document store by the
    evidence's ``documentId``. Evidence is VERSION-pinned (a document with two
    versions has two different canonical texts and two different
    ``contentSha256`` values), so the store is keyed by document VERSION id and
    each evidence record's ``documentId`` carries that version id. The real
    document id stays available on the driver payload.

    Claims here are CITATION claims: one per gold query, referencing the
    evidence built from that query's hits. They measure whether every citation
    an answer could make is resolvable and hash-verified. They do NOT measure
    whether a legal claim is correct — that needs the answer layer and the
    lawyer-annotated gold set.
    """
    evidence: list[dict[str, Any]] = []
    claims: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in payload.get("results", []):
        evidence_ids: list[str] = []
        for item in result.get("evidence", []):
            evidence_id = str(item["evidenceId"])
            evidence_ids.append(evidence_id)
            if evidence_id in seen:
                continue
            seen.add(evidence_id)
            evidence.append({
                "evidenceId": evidence_id,
                "documentId": str(item["documentVersionId"]),
                "locator": {
                    "startChar": item["locator"]["startChar"],
                    "endChar": item["locator"]["endChar"],
                },
                "quote": item["quote"],
                "quoteSha256": item["quoteSha256"],
                "contentSha256": item["contentSha256"],
            })
        if evidence_ids:
            claims.append({
                "claimId": f"cite-{result['id']}",
                "text": f"Citations retrieved for gold query {result['id']}.",
                "material": True,
                "evidenceIds": evidence_ids,
            })
    return {"evidence": evidence, "claims": claims}


def docstore_from_payload(payload: dict[str, Any]) -> dict[str, str]:
    """{document_version_id: canonical_text} for the citation checker."""
    return {str(k): str(v) for k, v in payload.get("canonical_texts", {}).items()}


# --------------------------------------------------------------------------
# derived metrics
# --------------------------------------------------------------------------

def _index_gold(gold: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(record["id"]): record for record in gold}


def form_metrics(
    gold: Iterable[dict[str, Any]],
    payload: dict[str, Any],
    top_k: int = TOP_K_FOR_FORM_METRICS,
) -> dict[str, Any]:
    """Abbreviation vs full-name reference-form accuracy and strict parity."""
    gold_by_id = _index_gold(gold)
    ranked_by_id = {
        str(r["id"]): ranked_unit_ids(r)[:top_k] for r in payload.get("results", [])
    }

    per_form: dict[str, list[bool]] = {"abbreviation": [], "full_name": []}
    for gold_id, record in gold_by_id.items():
        form = record.get("reference_form")
        if form not in per_form:
            continue
        expected = {str(d) for d in record.get("expected_documents", [])}
        if not expected:
            continue
        top = set(ranked_by_id.get(gold_id, []))
        per_form[form].append(expected <= top)

    groups: dict[str, dict[str, str]] = {}
    for gold_id, record in gold_by_id.items():
        group = record.get("parity_group")
        form = record.get("reference_form")
        if not group or form not in ("abbreviation", "full_name"):
            continue
        groups.setdefault(str(group), {})[str(form)] = gold_id

    parity_rows: list[dict[str, Any]] = []
    for group, forms in sorted(groups.items()):
        if set(forms) != {"abbreviation", "full_name"}:
            continue
        abbr = ranked_by_id.get(forms["abbreviation"], [])
        full = ranked_by_id.get(forms["full_name"], [])
        parity_rows.append({
            "parity_group": group,
            "abbreviation_id": forms["abbreviation"],
            "full_name_id": forms["full_name"],
            "identical_top_k": abbr == full,
            "abbreviation_top_k": abbr,
            "full_name_top_k": full,
        })

    def mean(values: list[bool]) -> float | None:
        return (sum(1 for v in values if v) / len(values)) if values else None

    identical = [row["identical_top_k"] for row in parity_rows]
    return {
        "top_k": top_k,
        "abbreviation_form_accuracy": mean(per_form["abbreviation"]),
        "full_name_form_accuracy": mean(per_form["full_name"]),
        "abbreviation_form_parity": mean(identical),
        "abbreviation_queries": len(per_form["abbreviation"]),
        "full_name_queries": len(per_form["full_name"]),
        "parity_pairs": len(parity_rows),
        "parity_detail": parity_rows,
    }


def abstention_metrics(
    gold: Iterable[dict[str, Any]], payload: dict[str, Any]
) -> dict[str, Any]:
    """Precision/recall of "returned nothing" against acceptable_abstention."""
    gold_by_id = _index_gold(gold)
    abstained: list[str] = []
    should: list[str] = []
    correct: list[str] = []
    false_abstentions: list[str] = []
    missed: list[str] = []

    for result in payload.get("results", []):
        gold_id = str(result["id"])
        record = gold_by_id.get(gold_id)
        if record is None:
            continue
        acceptable = bool(record.get("acceptable_abstention", False))
        did_abstain = bool(result.get("abstained", False))
        if acceptable:
            should.append(gold_id)
        if did_abstain:
            abstained.append(gold_id)
        if did_abstain and acceptable:
            correct.append(gold_id)
        elif did_abstain and not acceptable:
            false_abstentions.append(gold_id)
        elif acceptable and not did_abstain:
            missed.append(gold_id)

    precision = (len(correct) / len(abstained)) if abstained else 1.0
    recall = (len(correct) / len(should)) if should else None
    return {
        "abstention_precision": precision,
        "abstention_precision_convention": (
            "1.0 by convention when the system never abstained"
            if not abstained else "measured"
        ),
        "abstention_recall": recall,
        "abstained_queries": len(abstained),
        "should_abstain_queries": len(should),
        "correct_abstentions": len(correct),
        "false_abstentions": sorted(false_abstentions),
        "missed_abstentions": sorted(missed),
    }


def coverage_gate_metrics(
    gold: Iterable[dict[str, Any]], payload: dict[str, Any]
) -> dict[str, Any]:
    """Answer-layer abstention (question-coverage gate) precision/recall.

    Falls back to the retrieval-level ``abstained`` flag for a result that
    carries no ``answer_abstained`` (an older driver payload), so the metric
    is defined for every payload shape; the report states how many queries
    actually carried a coverage record.
    """
    gold_by_id = _index_gold(gold)
    rows: list[dict[str, Any]] = []
    abstained: list[str] = []
    should: list[str] = []
    correct: list[str] = []
    false_abstentions: list[str] = []
    missed: list[str] = []
    gate_counts: dict[str, int] = {}
    measured = 0

    for result in payload.get("results", []):
        gold_id = str(result["id"])
        record = gold_by_id.get(gold_id)
        if record is None:
            continue
        coverage = result.get("coverage")
        has_coverage = isinstance(coverage, dict)
        coverage = coverage if has_coverage else {}
        if has_coverage:
            measured += 1
        gate = str(coverage.get("gate", "n/a"))
        gate_counts[gate] = gate_counts.get(gate, 0) + 1
        acceptable = bool(record.get("acceptable_abstention", False))
        did_abstain = bool(
            result.get("answer_abstained", result.get("abstained", False))
        )
        rows.append({
            "id": gold_id,
            "task_type": result.get("task_type"),
            "ratio": coverage.get("ratio"),
            "gate": gate,
            "best_passage_covered": coverage.get("bestPassageCovered"),
            "missing": list(coverage.get("missing", [])),
            "answer_abstained": did_abstain,
            "acceptable_abstention": acceptable,
        })
        if acceptable:
            should.append(gold_id)
        if did_abstain:
            abstained.append(gold_id)
        if did_abstain and acceptable:
            correct.append(gold_id)
        elif did_abstain and not acceptable:
            false_abstentions.append(gold_id)
        elif acceptable and not did_abstain:
            missed.append(gold_id)

    precision = (len(correct) / len(abstained)) if abstained else 1.0
    recall = (len(correct) / len(should)) if should else None
    return {
        "measured_queries": measured,
        "gate_counts": dict(sorted(gate_counts.items())),
        "answer_abstention_precision": precision,
        "answer_abstention_precision_convention": (
            "1.0 by convention when the system never abstained"
            if not abstained else "measured"
        ),
        "answer_abstention_recall": recall,
        "answer_abstained_queries": len(abstained),
        "should_abstain_queries": len(should),
        "correct_answer_abstentions": len(correct),
        "false_answer_abstentions": sorted(false_abstentions),
        "missed_answer_abstentions": sorted(missed),
        "per_query": rows,
    }


def answer_level_metrics(
    gold: Iterable[dict[str, Any]], payload: dict[str, Any]
) -> dict[str, Any]:
    """Answer-level (AnswerPipeline) outcomes against the gold set. REPORT ONLY.

    ``payload`` is the JSON written by ``evals/answer/measure_answers.ts``.
    Nothing here is a gate this wave: the numbers travel in the report so a
    regression in the cap/drafter/verifier chain is VISIBLE, and thresholds
    can be chosen from measured runs rather than guessed.
    """
    gold_by_id = _index_gold(gold)
    results_by_id = {str(r.get("id")): r for r in payload.get("results", [])}

    rows: list[dict[str, Any]] = []
    status_counts: dict[str, int] = {}
    false_abstentions: list[str] = []
    false_answers: list[str] = []
    correct_abstentions: list[str] = []
    error_queries: list[str] = []
    missing: list[str] = []
    answerable = 0
    no_answer = 0
    finalizable_answerable = 0
    finalizable_total = 0
    expected_checked = 0
    expected_hits = 0
    measured = 0

    for gold_id, record in gold_by_id.items():
        result = results_by_id.get(gold_id)
        if result is None:
            missing.append(gold_id)
            continue
        measured += 1
        status = str(result.get("status", "n/a"))
        status_counts[status] = status_counts.get(status, 0) + 1
        acceptable = bool(record.get("acceptable_abstention", False))
        finalizable = bool(result.get("finalizable", False))
        abstained = status == "ABSTAIN"
        errored = status == "ERROR"

        expected = {str(d) for d in record.get("expected_documents", [])}
        cited_units = {
            str(item.get("unitId"))
            for item in result.get("evidence", [])
            if item.get("unitId") is not None
        }
        expected_in_evidence: bool | None = None
        if expected and not errored:
            expected_checked += 1
            expected_in_evidence = bool(expected & cited_units)
            if expected_in_evidence:
                expected_hits += 1

        if errored:
            error_queries.append(gold_id)
        elif acceptable:
            no_answer += 1
            if abstained:
                correct_abstentions.append(gold_id)
            else:
                false_answers.append(gold_id)
        else:
            answerable += 1
            if abstained:
                false_abstentions.append(gold_id)
            if finalizable:
                finalizable_answerable += 1
        if finalizable:
            finalizable_total += 1

        coverage = result.get("coverage") or {}
        rows.append({
            "id": gold_id,
            "task_type": record.get("task_type"),
            "status": status,
            "finalizable": finalizable,
            "acceptable_abstention": acceptable,
            "claims": int(result.get("claims", 0) or 0),
            "evidence": len(result.get("evidence", [])),
            "coverage_gate": coverage.get("gate") if isinstance(coverage, dict) else None,
            "reasons": list(result.get("reasons", [])),
            "expected_in_evidence": expected_in_evidence,
            "error": result.get("error"),
        })

    return {
        "measured_layer": payload.get("measured_layer"),
        "measured_queries": measured,
        "missing_queries": sorted(missing),
        "error_queries": sorted(error_queries),
        "status_counts": dict(sorted(status_counts.items())),
        "answerable_queries": answerable,
        "no_answer_queries": no_answer,
        "false_abstentions": sorted(false_abstentions),
        "false_abstention_count": len(false_abstentions),
        "false_answers": sorted(false_answers),
        "false_answer_count": len(false_answers),
        "correct_abstentions": sorted(correct_abstentions),
        "finalizable_answers": finalizable_answerable,
        "finalizable_rate": (
            (finalizable_answerable / answerable) if answerable else None
        ),
        "finalizable_total": finalizable_total,
        "finalizable_rate_overall": (
            (finalizable_total / measured) if measured else None
        ),
        "expected_unit_checked": expected_checked,
        "expected_unit_in_evidence_rate": (
            (expected_hits / expected_checked) if expected_checked else None
        ),
        "per_query": rows,
    }


BAND_NUMERIC_KEYS = (
    "false_abstention_count",
    "false_answer_count",
    "finalizable_answers",
    "finalizable_total",
    "finalizable_rate",
    "finalizable_rate_overall",
    "expected_unit_in_evidence_rate",
    "answerable_queries",
    "no_answer_queries",
    "measured_queries",
)

BAND_UNION_KEYS = (
    "false_abstentions",
    "false_answers",
    "error_queries",
    "missing_queries",
)


def _numeric_band(values: list[Any]) -> dict[str, Any]:
    """min / max / every value, plus whether they all agree."""
    present = [v for v in values if isinstance(v, (int, float))]
    return {
        "values": values,
        "min": min(present) if present else None,
        "max": max(present) if present else None,
        "stable": len({repr(v) for v in values}) <= 1,
    }


def answer_level_band(runs: list[dict[str, Any]], ingests: int) -> dict[str, Any]:
    """Fold N answer-level metric dicts (one per repeat) into a BAND.

    WHY A BAND EXISTS (W14 M-SRV, N-7). This layer WAS not reproducible from one
    run to the next, and the reason was MEASURED, not guessed: runs of the answer
    driver against ONE already-ingested database were byte-identical, while runs
    that each re-ingested the same corpus were not. The corpus, the chunk count
    and every retrieval metric were identical in all of them; what changed were
    the ids minted at ingest.

    WHY IT STAYS (W14 N7, 03.09.2026). The last id-borne source was closed —
    `AnswerPipeline`'s rank tie-break now orders on corpus identity, not on the
    chunk's uuid — and six consecutive runs plus a `--repeats 4` band came back
    identical. The band stays anyway, because it is the only thing that can
    PROVE that on any given tree: a single run cannot show stability, and the
    day something id-borne comes back the band is what makes it visible instead
    of turning it into an argument about which run was right.

    `ingests` says how many independent ingests the band actually covers:
    repeating the driver against one ingest cannot show ingest-borne variance,
    and a band that does not know that would overstate its own stability.
    """
    band: dict[str, Any] = {
        "repeats": len(runs),
        "ingests": ingests,
        "note": (
            "Bant, art arda koşulan N ölçümün min-max aralığıdır. Genişliği "
            "sıfır olan bir bant, o koşularda bu satırın değişmediğini "
            "gösterir; tek koşu ise hiçbir zaman kararlılık kanıtı değildir "
            "(N-7)."
        ),
    }
    if not runs:
        band["stable"] = None
        return band

    for key in BAND_NUMERIC_KEYS:
        band[key] = _numeric_band([run.get(key) for run in runs])

    statuses = sorted({s for run in runs for s in (run.get("status_counts") or {})})
    band["status_counts"] = {
        status: _numeric_band([(run.get("status_counts") or {}).get(status, 0) for run in runs])
        for status in statuses
    }

    for key in BAND_UNION_KEYS:
        seen: set[str] = set()
        for run in runs:
            seen.update(str(v) for v in (run.get(key) or []))
        band[f"{key}_union"] = sorted(seen)

    band["stable"] = all(
        band[key]["stable"] for key in BAND_NUMERIC_KEYS
    ) and all(entry["stable"] for entry in band["status_counts"].values())
    return band


def lane_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    """Per-lane hit contribution and the zero-hit query list.

    ``hits`` counts ranked hits in whose lane provenance the lane appears;
    ``sole_contributor`` counts hits that lane alone produced. A lane at zero
    is reported explicitly — averaging it away would hide a dead lane.

    THIS TUPLE MUST LIST EVERY LANE ``retrieval/hybrid.ts :: LaneName`` can
    emit. Hit lane names are INTERSECTED with it, so a lane missing here is not
    reported as zero — its hits are attributed to no lane at all, and the
    per-lane counts silently stop summing to ``ranked_hits_total``. That is
    exactly what happened when the citator lane shipped as ``relation``: the
    report showed 125 ranked hits and attributed 119.
    """
    # "citation" (W12): one-hop citation expansion used to ride on "exact";
    # it now has its own lane name in retrieval/hybrid.ts.
    lanes = ("exact", "lexical", "trigram", "dense", "relation", "citation")
    hits = {lane: 0 for lane in lanes}
    sole = {lane: 0 for lane in lanes}
    zero_hit_queries: list[str] = []
    for result in payload.get("results", []):
        ranked = result.get("ranked", [])
        if not ranked:
            zero_hit_queries.append(str(result["id"]))
        for hit in ranked:
            names = {str(entry.get("lane")) for entry in hit.get("lanes", [])}
            for lane in names & set(lanes):
                hits[lane] += 1
            if len(names) == 1:
                only = next(iter(names))
                if only in sole:
                    sole[only] += 1
    return {
        "hits_by_lane": hits,
        "sole_contributor_by_lane": sole,
        "zero_hit_queries": zero_hit_queries,
        "zero_hit_query_count": len(zero_hit_queries),
    }


def integrity_metrics(
    payload: dict[str, Any], citation_report: dict[str, Any]
) -> dict[str, Any]:
    """Citation resolvability, quote/hash integrity, fabricated ids, leaks."""
    inventory = payload.get("inventory", [])
    known_chunks = {str(row["chunkId"]) for row in inventory}
    known_documents = {str(row["documentId"]) for row in inventory}
    known_versions = {str(row["versionId"]) for row in inventory}
    stored_sha_by_version = {
        str(row["versionId"]): str(row["storedVersionSha256"])
        for row in inventory
        if row.get("storedVersionSha256") is not None
    }
    # evidenceId -> contentSha256 the pack computed from the fetched text.
    pack_content_sha: dict[str, tuple[str, str]] = {}

    total_hits = 0
    fabricated: list[dict[str, Any]] = []
    leaks: list[dict[str, Any]] = []
    rejected_evidence = 0
    error_queries: list[str] = []

    for result in payload.get("results", []):
        gold_id = str(result["id"])
        if result.get("status") == "error":
            error_queries.append(gold_id)
        rejected_evidence += len(result.get("rejected_evidence", []))
        for hit in result.get("ranked", []):
            total_hits += 1
            chunk_id = str(hit.get("chunkId"))
            document_id = str(hit.get("documentId"))
            version_id = str(hit.get("documentVersionId"))
            if (
                chunk_id not in known_chunks
                or document_id not in known_documents
                or version_id not in known_versions
            ):
                fabricated.append({
                    "query": gold_id,
                    "chunkId": chunk_id,
                    "documentId": document_id,
                    "documentVersionId": version_id,
                    "kind": "unknown_retrieval_id",
                })
            if hit.get("scope") != "public" or hit.get("tenantId") is not None:
                leaks.append({
                    "query": gold_id,
                    "chunkId": chunk_id,
                    "unitId": hit.get("unitId"),
                    "scope": hit.get("scope"),
                    "tenantId": hit.get("tenantId"),
                })
        for item in result.get("evidence", []):
            pack_content_sha[str(item.get("evidenceId"))] = (
                str(item.get("documentVersionId")),
                str(item.get("contentSha256")),
            )
            if str(item.get("documentVersionId")) not in known_versions:
                fabricated.append({
                    "query": gold_id,
                    "evidenceId": item.get("evidenceId"),
                    "documentVersionId": item.get("documentVersionId"),
                    "kind": "unknown_evidence_version_id",
                })
            if str(item.get("chunkId")) not in known_chunks:
                fabricated.append({
                    "query": gold_id,
                    "evidenceId": item.get("evidenceId"),
                    "chunkId": item.get("chunkId"),
                    "kind": "unknown_evidence_chunk_id",
                })

    evidence_rows = citation_report.get("evidence", [])
    evidence_total = len(evidence_rows)
    unresolvable = [row for row in evidence_rows if row.get("reason") in UNRESOLVABLE_REASONS]

    # An evidence record is verified only if the deterministic checks pass AND
    # its content hash matches what ingestion stored for that version.
    stored_hash_mismatches: list[dict[str, Any]] = []
    verified = []
    for row in evidence_rows:
        evidence_id = str(row.get("evidenceId"))
        version_id, content_sha = pack_content_sha.get(evidence_id, ("", ""))
        stored = stored_sha_by_version.get(version_id)
        drift = stored is not None and stored != content_sha
        if drift:
            stored_hash_mismatches.append({
                "evidenceId": evidence_id,
                "documentVersionId": version_id,
                "evidence_content_sha256": content_sha,
                "stored_content_sha256": stored,
            })
        if row.get("ok") and not drift:
            verified.append(row)

    # Resolvability is measured over RANKED HITS, not over emitted evidence:
    # a hit the evidence pack refused to cite is a resolvability failure.
    resolvable_hits = max(0, total_hits - rejected_evidence - len(unresolvable))
    resolvability = (resolvable_hits / total_hits) if total_hits else 1.0
    integrity = (len(verified) / evidence_total) if evidence_total else 1.0

    return {
        "ranked_hits_total": total_hits,
        "evidence_total": evidence_total,
        "evidence_rejected_by_pack": rejected_evidence,
        "evidence_unresolvable": len(unresolvable),
        "evidence_verified": len(verified),
        "stored_hash_mismatch_count": len(stored_hash_mismatches),
        "stored_hash_mismatch_detail": stored_hash_mismatches[:20],
        "citation_resolvability": resolvability,
        "quote_hash_integrity": integrity,
        "fabricated_id_count": len(fabricated),
        "fabricated_id_detail": fabricated[:20],
        "cross_tenant_leak_count": len(leaks),
        "cross_tenant_leak_detail": leaks[:20],
        "retrieval_error_queries": error_queries,
        "citation_failure_reasons": sorted(
            {str(row.get("reason")) for row in evidence_rows if not row.get("ok")}
        ),
    }


# --------------------------------------------------------------------------
# gates
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class GateResult:
    name: str
    passed: bool
    detail: str


def evaluate_gates(
    integrity: dict[str, Any],
    benchmark_counts: dict[str, Any] | None = None,
    answer_band: dict[str, Any] | None = None,
) -> list[GateResult]:
    """The brief 13.1 non-negotiables, enforced by code.

    Any False here makes ``scripts/run_evals.py`` exit non-zero.

    ``answer_band`` (W14 M-SRV / N-7) is the answer-layer BAND over N repeats,
    from :func:`answer_level_band`. Only ONE thing in it is gated and it is
    gated on the band's worst repeat — see :func:`_answer_band_gate`. The rest
    of that section stays report-only, because it is not reproducible enough to
    fail a build on.
    """
    counts = benchmark_counts or {}
    gates = [
        GateResult(
            "citation_resolvability == 100%",
            integrity["citation_resolvability"] >= 1.0,
            f"{integrity['citation_resolvability'] * 100:.2f}% of"
            f" {integrity['ranked_hits_total']} candidate passage(s) resolved"
            " to verified-document evidence",
        ),
        GateResult(
            "quote_hash_integrity == 100%",
            integrity["quote_hash_integrity"] >= 1.0,
            f"{integrity['evidence_verified']}/{integrity['evidence_total']}"
            " evidence records passed offset+quote+quote-hash+content-hash"
            f" (+{integrity.get('stored_hash_mismatch_count', 0)} stored-hash"
            " mismatch vs. what ingestion recorded)",
        ),
        GateResult(
            "fabricated_ids == 0",
            integrity["fabricated_id_count"] == 0,
            f"{integrity['fabricated_id_count']} identifier(s) absent from the"
            " corpus inventory",
        ),
        GateResult(
            "cross_tenant_leak_indicators == 0",
            integrity["cross_tenant_leak_count"] == 0,
            f"{integrity['cross_tenant_leak_count']} non-public hit(s) in a"
            " public corpus search",
        ),
        GateResult(
            "no retrieval lane total failure",
            not integrity["retrieval_error_queries"],
            "queries whose every retrieval lane failed: "
            + (", ".join(integrity["retrieval_error_queries"]) or "none"),
        ),
    ]
    if counts:
        gates.append(
            GateResult(
                "no gold query dropped",
                int(counts.get("missing_results", 0)) == 0,
                f"{counts.get('missing_results', 0)} gold queries had no result line",
            )
        )
    if answer_band:
        gates.append(_answer_band_gate(answer_band))
    return gates


def _answer_band_gate(band: dict[str, Any]) -> GateResult:
    """The one answer-layer invariant that is gated, and it is gated on the BAND.

    W14 M-SRV / N-7. Everything else this layer reports moves between runs, so
    nothing else here may fail a build. This does not move: a gold row marked
    `acceptable_abstention` — a question the corpus CANNOT answer — must never
    come back with an answer, in ANY repeat. An answer to a question with no
    basis is the failure this whole product exists to prevent, and "it only
    happened in one of four runs" is not a defence.

    Read on the band, not on a run: `max` over every repeat, and the union of
    the offending gold ids so the failure names them.
    """
    counts = band.get("false_answer_count") or {}
    worst = counts.get("max")
    offenders = band.get("false_answers_union") or []
    repeats = band.get("repeats", 0)
    ingests = band.get("ingests", 0)
    return GateResult(
        "answer-layer false answers == 0 (every repeat)",
        worst == 0 and not offenders,
        f"worst repeat: {worst} no_answer gold row(s) answered over {repeats}"
        f" repeat(s) / {ingests} ingest(s); ids: "
        + (", ".join(str(o) for o in offenders) or "none"),
    )
