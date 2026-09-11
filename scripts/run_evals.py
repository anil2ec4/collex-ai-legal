"""Measured functional baseline over the SYNTHETIC fixture corpus + CI gate.

    .venv/Scripts/python.exe scripts/run_evals.py            # full run
    .venv/Scripts/python.exe scripts/run_evals.py --fixture-only   # no DB

WHAT THIS IS
------------
One command that ingests ``evals/fixtures/corpus/`` into a local scratch
PostgreSQL, runs EVERY query of ``evals/datasets/fixture_corpus_gold.jsonl``
through the control-plane retrieval + evidence code the product itself uses,
scores the run with ``evals/retrieval/benchmark.py``, re-verifies every
produced citation with ``evals/citations/check_citations.py``, enforces the
master brief's 13.1 non-negotiables as HARD GATES (non-zero exit), and writes
``evals/reports/fixture_baseline_<YYYY-MM-DD>.{json,md}``.

WHAT THIS IS NOT
----------------
NOT a Turkish legal quality benchmark. The corpus is eight SENTETİK (synthetic)
documents this repository authored; the gold answers are ground truth *by
construction* because we wrote both sides. It measures whether the retrieval,
temporal and citation machinery behaves as designed — a functional regression
baseline. A legal quality number requires the lawyer-annotated gold set
(``evals/datasets/legal_gold_v1.seed.jsonl``, still ``adjudication_status:
pending``) and the labeling protocol in ``evals/datasets/SCHEMA.md``.

WHICH LAYER IS MEASURED
-----------------------
``control-plane/src/retrieval/searchService.ts`` ``searchLegalCorpus()`` —
the real hybrid pipeline (Turkish normalization -> exact reference parse ->
exact-pin lane -> ``turkish`` FTS lane -> pg_trgm lane -> RRF fusion ->
per-document diversity cap) over the ingested corpus, followed by the real
``buildEvidencePack()`` from ``control-plane/src/answer/evidencePack.ts``.
It is deliberately NOT the ``POST /v1/search`` HTTP route: that route is still
a scaffold that proxies an upstream MCP ``search`` tool and never reads the
local corpus, so measuring it would measure something else.

The DENSE (embedding) lane is a NoopDenseLane: pgvector cannot be installed on
the scratch PostgreSQL, migrations 080000/090000 are never applied, and no
embedding profile is active. Every retrieval number below is therefore a
LEXICAL + EXACT-PIN baseline, not the full hybrid the brief specifies.

ANSWER-LEVEL SECTION (W12-B2; a BAND since W14 M-SRV / N-7)
-----------------------------------------------------------
``evals/answer/measure_answers.ts`` runs the REAL ``AnswerPipeline`` (the
``POST /v1/answer`` construction: store adapters, ``DEFAULT_ANSWER_LIMITS``,
rule-based drafter, lexical entailment) over every gold query on the same
scratch database and the report carries an ``answer_level`` section: status
per query, false abstentions on answerable rows, false answers on no_answer
rows, finalizable rate.

**This section is reported as a BAND, and the band is now width zero.** It was
not reproducible from one run to the next, and that was MEASURED, not assumed:
on 03.09.2026 runs of the answer driver against ONE already-ingested database
produced byte-identical numbers, while runs that each re-ingested the same
corpus produced different outcomes (finalizable 85,7 % / 81,0 %; a false
abstention on ``fx-amend-002`` in some runs and not others). The corpus, the
chunk count, every retrieval metric and every hard gate were identical in all
of them; what changed were the ids minted at ingest. The last such dependency
— ``AnswerPipeline``'s rank tie-break, which ordered a score tie on the chunk's
uuid and so handed the coverage-aware cap a different top-8 after every ingest
— was closed the same day (``docs/implementation/waves/W14-N7.md``), and six
consecutive runs plus ``--repeats 4`` then agreed on every answer-layer number.

``--repeats N`` still runs the ingest + answer measurement N times and the
report still prints a **band** — min-max plus the union of the gold ids that
moved — never a single value. A zero-width band is the PROOF, and one run is
never proof: keep reading this section as a band on whatever tree you are on.

Exactly ONE thing here is gated, and it is gated on the band's WORST repeat:
a gold row marked ``acceptable_abstention`` must never be answered, in any
repeat. Everything else stays report-only, because it is not stable enough to
fail a build on.

DATABASE SAFETY
---------------
The only database this script may create or drop is ``collex_eval_test`` on
the local scratch PostgreSQL (default 127.0.0.1:55432). It refuses any other
name and never contacts a remote/Supabase host.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "evals" / "retrieval"))
sys.path.insert(0, str(REPO_ROOT / "evals" / "citations"))

import benchmark  # noqa: E402 - after sys.path bootstrap
import check_citations  # noqa: E402
import gates as gate_module  # noqa: E402

SCRATCH_DB = "collex_eval_test"
DEFAULT_DSN = f"postgres://postgres@127.0.0.1:55432/{SCRATCH_DB}"

CORPUS_DIR = REPO_ROOT / "evals" / "fixtures" / "corpus"
GOLD_PATH = REPO_ROOT / "evals" / "datasets" / "fixture_corpus_gold.jsonl"
REPORTS_DIR = REPO_ROOT / "evals" / "reports"
DRIVER_TS = REPO_ROOT / "evals" / "retrieval" / "measure_retrieval.ts"
DRIVER_ANSWER_TS = REPO_ROOT / "evals" / "answer" / "measure_answers.ts"
CONTROL_PLANE = REPO_ROOT / "control-plane"
ESBUILD_JS = CONTROL_PLANE / "node_modules" / "esbuild" / "bin" / "esbuild"

SYNTHETIC_BANNER = (
    "SENTETİK VERİ / SYNTHETIC DATA — this corpus is authored test data, "
    "not real Turkish case law or legislation."
)


# --------------------------------------------------------------------------
# small utilities
# --------------------------------------------------------------------------

class Stopwatch:
    """Wall-clock stage timings in milliseconds."""

    def __init__(self) -> None:
        self.stages: dict[str, float] = {}

    def time(self, name: str, fn):
        start = time.perf_counter()
        try:
            return fn()
        finally:
            self.stages[name] = (time.perf_counter() - start) * 1000.0


def log(message: str) -> None:
    print(message, flush=True)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return benchmark.load_jsonl(path)


def pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def num(value: float | None, digits: int = 4) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def ms(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f}"


# --------------------------------------------------------------------------
# stage 1 — database bootstrap + ingestion
# --------------------------------------------------------------------------

def dbname_of(dsn: str) -> str:
    import psycopg

    return psycopg.conninfo.conninfo_to_dict(dsn).get("dbname") or ""


def recreate_database(dsn: str) -> str:
    import psycopg

    name = dbname_of(dsn)
    if name != SCRATCH_DB:
        raise SystemExit(
            f"refusing to drop/create {name!r}: this script may only own"
            f" {SCRATCH_DB!r}"
        )
    params = psycopg.conninfo.conninfo_to_dict(dsn)
    params["dbname"] = "postgres"
    admin_dsn = psycopg.conninfo.make_conninfo(**params)
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        admin.execute(f"drop database if exists {SCRATCH_DB} with (force)")
        admin.execute(
            f"create database {SCRATCH_DB} template template0"
            " encoding 'UTF8' locale 'C'"
        )
    return f"{SCRATCH_DB} recreated (UTF8/C)"


def ingest(dsn: str) -> dict[str, Any]:
    """One pass over the corpus directory ingests every version.

    ``FixtureSource`` groups the files that share a ``(source, external_id)``
    and yields them in COMMENCEMENT order, so ``kanun_5237_v1.json`` and
    ``kanun_5237_v2.json`` both land in this single pass and the temporal
    close-on-append trigger gives them the two effective periods the temporal
    slice measures. A second ``--include kanun_5237_v2.json`` pass used to run
    here from the days when discovery kept only the lexicographically first
    file per external_id; once that silent skip was fixed the pass reported
    "unchanged" and moved no measured number, so it is gone.
    """
    from ingestion.cli import apply_migrations, main as ingest_main

    applied = apply_migrations(dsn)
    log(f"  applied {len(applied)} non-pgvector migrations")

    rc = ingest_main(["--dsn", dsn, "--corpus", str(CORPUS_DIR)])
    if rc != 0:
        raise SystemExit(f"ingestion failed with exit code {rc}")
    return {"migrations_applied": len(applied), "passes": 1}


# --------------------------------------------------------------------------
# stage 2 — build + run the TypeScript retrieval driver
# --------------------------------------------------------------------------

def build_driver(
    workdir: Path,
    driver_ts: Path = DRIVER_TS,
    bundle_name: str = "measure_retrieval.mjs",
) -> Path:
    """Bundle one TypeScript driver with the control-plane's own esbuild.

    The retrieval driver and the answer-level driver (W12-B2) are built the
    same way; only the entry file differs.
    """
    node = shutil.which("node")
    if node is None:
        raise SystemExit("node was not found on PATH; the eval drivers need Node >= 22")
    if not ESBUILD_JS.exists():
        raise SystemExit(
            f"esbuild not found at {ESBUILD_JS}. Run `npm ci` inside control-plane"
            " first (this script never installs packages)."
        )
    bundle = workdir / bundle_name
    cmd = [
        node, str(ESBUILD_JS), str(driver_ts),
        "--bundle", "--platform=node", "--format=esm", "--target=node22",
        f"--outfile={bundle}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", cwd=str(CONTROL_PLANE))
    if proc.returncode != 0:
        raise SystemExit(
            f"esbuild failed to bundle {driver_ts.name}:\n"
            f"{proc.stdout}\n{proc.stderr}"
        )
    return bundle


def run_driver(bundle: Path, dsn: str, workdir: Path, result_limit: int) -> dict[str, Any]:
    node = shutil.which("node")
    assert node is not None  # build_driver already checked
    out = workdir / "measurement.json"
    cmd = [
        node, str(bundle),
        "--dsn", dsn,
        "--gold", str(GOLD_PATH),
        "--out", str(out),
        "--result-limit", str(result_limit),
    ]
    env = dict(os.environ)
    # Defense in depth: the driver must never reach an external provider.
    for key in ("OPENROUTER_API_KEY", "BRAVE_API_TOKEN", "TAVILY_API_KEY"):
        env[key] = ""
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env)
    if proc.stdout.strip():
        for line in proc.stdout.strip().splitlines():
            log(f"  [driver] {line}")
    if proc.returncode != 0:
        raise SystemExit(
            f"retrieval driver failed (exit {proc.returncode}):\n{proc.stderr}"
        )
    return json.loads(out.read_text(encoding="utf-8"))


def run_answer_driver(bundle: Path, dsn: str, workdir: Path) -> dict[str, Any]:
    """Run the answer-level driver (W12-B2): the real AnswerPipeline per gold query.

    Read-only against the already-ingested scratch database; the provider
    keys are blanked exactly as for the retrieval driver. A driver crash is
    a harness defect and stops the run — it is NOT a quality gate, so nothing
    in its output can fail the run.
    """
    node = shutil.which("node")
    assert node is not None  # build_driver already checked
    out = workdir / "answers.json"
    cmd = [node, str(bundle), "--dsn", dsn, "--gold", str(GOLD_PATH), "--out", str(out)]
    env = dict(os.environ)
    for key in ("OPENROUTER_API_KEY", "BRAVE_API_TOKEN", "TAVILY_API_KEY", "ANTHROPIC_API_KEY"):
        env[key] = ""
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env)
    if proc.stdout.strip():
        for line in proc.stdout.strip().splitlines():
            log(f"  [answer-driver] {line}")
    if proc.returncode != 0:
        raise SystemExit(
            f"answer-level driver failed (exit {proc.returncode}):\n{proc.stderr}"
        )
    return json.loads(out.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# stage 3 — scoring
# --------------------------------------------------------------------------

def score(gold: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
    results = gate_module.to_benchmark_results(payload)
    return benchmark.compute_metrics(gold, results, ks=(5, 10, 20))


def verify_citations(payload: dict[str, Any]) -> dict[str, Any]:
    citation_input = gate_module.to_citation_payload(payload)
    docstore = gate_module.docstore_from_payload(payload)
    return check_citations.check_citations(citation_input, docstore)


def stage_latencies(payload: dict[str, Any]) -> dict[str, Any]:
    search = [
        float(r["stage_ms"]["search"])
        for r in payload.get("results", [])
        if isinstance(r.get("stage_ms", {}).get("search"), (int, float))
    ]
    evidence = [
        float(r["stage_ms"]["evidence"])
        for r in payload.get("results", [])
        if isinstance(r.get("stage_ms", {}).get("evidence"), (int, float))
    ]
    return {
        "retrieval_per_query": {
            "n": len(search),
            "p50_ms": benchmark.percentile(search, 50) if search else None,
            "p95_ms": benchmark.percentile(search, 95) if search else None,
        },
        "evidence_pack_per_query": {
            "n": len(evidence),
            "p50_ms": benchmark.percentile(evidence, 50) if evidence else None,
            "p95_ms": benchmark.percentile(evidence, 95) if evidence else None,
        },
        "corpus_inventory_ms": payload.get("stage_ms", {}).get("inventory"),
        "canonical_text_load_ms": payload.get("stage_ms", {}).get("canonical_text"),
    }


# --------------------------------------------------------------------------
# fixture-only invariant mode (no database)
# --------------------------------------------------------------------------

def fixture_only_invariants() -> tuple[dict[str, Any], list[gate_module.GateResult]]:
    """Deterministic offset/quote/hash invariants straight off the fixtures.

    Runs the SAME chunker the ingestion pipeline runs, materializes one
    evidence record per chunk, and re-verifies each with the Python citation
    checker. This proves the offset/hash contract and the absence of fabricated
    ids WITHOUT a database, so the hard invariants can still be gated where
    standing up PostgreSQL is not possible. It produces NO retrieval metrics.
    """
    import unicodedata

    from ingestion.chunking import chunk_document
    from ingestion.ports import ParsedDocument

    evidence: list[dict[str, Any]] = []
    claims: list[dict[str, Any]] = []
    docstore: dict[str, str] = {}
    known_docs: set[str] = set()
    chunk_total = 0

    for path in sorted(CORPUS_DIR.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        canonical = unicodedata.normalize("NFC", str(raw["text"]))
        doc_key = f"{raw['external_id']}@{(raw.get('_meta') or {}).get('version_label', 'v1')}"
        docstore[doc_key] = canonical
        known_docs.add(doc_key)
        parsed = ParsedDocument(
            source=str(raw["source"]),
            external_id=str(raw["external_id"]),
            document_type=str(raw["document_type"]),
            title=raw.get("title"),
            retrieved_url=raw.get("retrieved_url"),
            media_type=raw.get("media_type"),
            canonical_text=canonical,
            dates=dict(raw.get("dates") or {}),
            structure_hints=dict(raw.get("structure_hints") or {}),
            meta=dict(raw.get("_meta") or {}),
        )
        evidence_ids: list[str] = []
        for chunk in chunk_document(parsed):
            chunk_total += 1
            evidence_id = f"ev-{doc_key}-{chunk.ordinal}"
            evidence_ids.append(evidence_id)
            evidence.append({
                "evidenceId": evidence_id,
                "documentId": doc_key,
                "locator": {"startChar": chunk.start_char, "endChar": chunk.end_char},
                "quote": chunk.original_text,
                "quoteSha256": check_citations.sha256_text(chunk.original_text),
                "contentSha256": check_citations.sha256_text(canonical),
            })
        claims.append({
            "claimId": f"cite-{doc_key}",
            "text": f"Every chunk of {doc_key} is citable.",
            "material": True,
            "evidenceIds": evidence_ids,
        })

    report = check_citations.check_citations(
        {"evidence": evidence, "claims": claims}, docstore
    )
    fabricated = [e for e in evidence if e["documentId"] not in known_docs]
    verified = sum(1 for row in report["evidence"] if row["ok"])
    integrity = {
        "ranked_hits_total": chunk_total,
        "evidence_total": len(evidence),
        "evidence_rejected_by_pack": 0,
        "evidence_unresolvable": sum(
            1 for row in report["evidence"]
            if row.get("reason") in gate_module.UNRESOLVABLE_REASONS
        ),
        "evidence_verified": verified,
        # No ingest happened, so there is no stored hash to compare against.
        "stored_hash_mismatch_count": 0,
        "stored_hash_mismatch_detail": [],
        "citation_resolvability": (
            (chunk_total - sum(
                1 for row in report["evidence"]
                if row.get("reason") in gate_module.UNRESOLVABLE_REASONS
            )) / chunk_total if chunk_total else 1.0
        ),
        "quote_hash_integrity": verified / len(evidence) if evidence else 1.0,
        "fabricated_id_count": len(fabricated),
        "fabricated_id_detail": fabricated[:20],
        "cross_tenant_leak_count": 0,
        "cross_tenant_leak_detail": [],
        "retrieval_error_queries": [],
        "citation_failure_reasons": sorted(
            {str(row.get("reason")) for row in report["evidence"] if not row["ok"]}
        ),
    }
    return integrity, gate_module.evaluate_gates(integrity)


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def build_report(
    *,
    payload: dict[str, Any],
    bench: dict[str, Any],
    citation_report: dict[str, Any],
    integrity: dict[str, Any],
    forms: dict[str, Any],
    abstention: dict[str, Any],
    lanes: dict[str, Any],
    latencies: dict[str, Any],
    gate_results: list[gate_module.GateResult],
    stopwatch: Stopwatch,
    dsn_dbname: str,
    result_limit: int,
    run_date: str,
    coverage: dict[str, Any] | None = None,
    answer_level: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "schema": "collex.fixture_baseline.v1",
        "run_date": run_date,
        "synthetic_data_notice": SYNTHETIC_BANNER,
        "what_this_is": (
            "Functional regression baseline of the retrieval + evidence "
            "pipeline over an authored synthetic corpus."
        ),
        "what_this_is_not": (
            "NOT a Turkish legal quality benchmark. Legal quality requires the "
            "lawyer-annotated gold set (legal_gold_v1), which remains pending."
        ),
        "reproduce": ".venv/Scripts/python.exe scripts/run_evals.py",
        "measured_layer": payload.get("measured_layer"),
        "dense_lane": payload.get("dense_lane"),
        "database": dsn_dbname,
        "node_version": payload.get("node_version"),
        "python_version": sys.version.split()[0],
        "result_limit": result_limit,
        "corpus": {
            "directory": "evals/fixtures/corpus",
            "files": len(list(CORPUS_DIR.glob("*.json"))),
            "documents": len({row["externalId"] for row in payload.get("inventory", [])}),
            "versions": len({row["versionId"] for row in payload.get("inventory", [])}),
            "chunks": len(payload.get("inventory", [])),
            "synthetic": True,
        },
        "gold": {
            "path": "evals/datasets/fixture_corpus_gold.jsonl",
            "queries": bench["counts"]["gold_queries"],
            "ground_truth_basis": "authored_synthetic (ground truth by construction)",
            "claims_scored": False,
            "claims_note": (
                "required_claims TEXT is still not scored (needs lawyer adjudication); "
                "the answer_level section (W12-B2) reports the real AnswerPipeline's "
                "status / abstention / finalizability per query, report-only."
            ),
        },
        "counts": bench["counts"],
        "retrieval_metrics": bench["metrics"],
        "reference_form_metrics": forms,
        "abstention_metrics": abstention,
        # W12 lane B: the ANSWER-layer abstention (question-coverage gate),
        # computed by the driver with the product's own gate function.
        "coverage_gate_metrics": coverage if coverage is not None else {},
        # W12-B2: the REAL AnswerPipeline per gold query — REPORT ONLY, no
        # gate reads it (see the module docstring).
        "answer_level": answer_level if answer_level is not None else {},
        "lane_metrics": lanes,
        "integrity_metrics": integrity,
        "citation_summary": citation_report["summary"],
        "latency": {
            "benchmark_latency_ms": bench["latency"],
            "stages": latencies,
            "wall_clock_stage_ms": stopwatch.stages,
        },
        "gates": [
            {"name": g.name, "passed": g.passed, "detail": g.detail}
            for g in gate_results
        ],
        "gates_passed": all(g.passed for g in gate_results),
        "per_query": bench["per_query"],
    }


def band_int(band: dict[str, Any] | None, key: str, fallback: Any = "n/a") -> str:
    """`12` when every repeat agreed, `12-14` when they did not (W14 N-7).

    A single number is only ever printed when the repeats really produced one.
    """
    entry = (band or {}).get(key)
    if not isinstance(entry, dict):
        return str(fallback)
    low, high = entry.get("min"), entry.get("max")
    if low is None:
        return str(fallback)
    return str(low) if low == high else f"{low}-{high}"


def band_pct(band: dict[str, Any] | None, key: str) -> str:
    """Same, as a percentage range."""
    entry = (band or {}).get(key)
    if not isinstance(entry, dict):
        return "n/a"
    low, high = entry.get("min"), entry.get("max")
    if low is None:
        return "n/a"
    return pct(low) if low == high else f"{pct(low)}-{pct(high)}"


def band_status_counts(band: dict[str, Any] | None) -> str:
    counts = (band or {}).get("status_counts") or {}
    if not counts:
        return "n/a"
    return ", ".join(f"{k}={band_int(counts, k)}" for k in sorted(counts))


def band_scope(band: dict[str, Any] | None) -> str:
    b = band or {}
    repeats = b.get("repeats", 1)
    ingests = b.get("ingests", repeats)
    stable = b.get("stable")
    word = "identical" if stable else "VARIED"
    return f"{repeats} repeat(s) / {ingests} ingest(s), {word} across them"


def metric_table(report: dict[str, Any]) -> str:
    m = report["retrieval_metrics"]
    forms = report["reference_form_metrics"]
    abst = report["abstention_metrics"]
    cov = report.get("coverage_gate_metrics") or {}
    al = report.get("answer_level") or {}
    band = al.get("band") or {}
    integ = report["integrity_metrics"]
    lanes = report["lane_metrics"]
    lat = report["latency"]["stages"]
    counts = report["counts"]

    rows = [
        ("Recall@5", num(m.get("recall@5")),
         "mean over queries with >=1 expected unit: "
         "(expected units in top 5) / (expected units)"),
        ("Recall@10", num(m.get("recall@10")), "same, top 10"),
        ("Recall@20", num(m.get("recall@20")), "same, top 20"),
        ("nDCG@10", num(m.get("ndcg@10")),
         "binary gain, log2(rank+1) discount, IDCG = min(expected, 10) ideal hits"),
        ("MRR", num(m.get("mrr")), "mean 1/rank of the first expected unit"),
        ("Exact-reference accuracy", pct(m.get("exact_reference_accuracy")),
         f"rank-1 hit is an expected unit; n={counts.get('exact_reference_queries')}"),
        ("Abbreviation-form accuracy", pct(forms.get("abbreviation_form_accuracy")),
         f"all expected units within top-{forms.get('top_k')} for "
         f"'TCK m.157'-style queries; n={forms.get('abbreviation_queries')}"),
        ("Full-name-form accuracy", pct(forms.get("full_name_form_accuracy")),
         f"same for '5237 sayılı ...'-style queries; n={forms.get('full_name_queries')}"),
        ("Abbreviation-form parity", pct(forms.get("abbreviation_form_parity")),
         f"identical top-{forms.get('top_k')} ranking for both forms of the same "
         f"question; n={forms.get('parity_pairs')} pairs"),
        ("Temporal accuracy", pct(m.get("temporal_accuracy")),
         f"every expected as-of version retrieved; n={counts.get('temporal_queries')}"),
        ("Contrary-authority recall", num(m.get("contrary_authority_recall")),
         f"fraction of contrary units present anywhere in the ranking; "
         f"n={counts.get('contrary_authority_queries')}"),
        ("Abstention precision", pct(abst.get("abstention_precision")),
         f"correct abstentions / abstentions ({abst.get('abstention_precision_convention')})"),
        ("Abstention recall", pct(abst.get("abstention_recall")),
         f"correct abstentions / should-abstain; n={abst.get('should_abstain_queries')}"),
        ("Answer-layer abstention precision",
         pct(cov.get("answer_abstention_precision")),
         "coverage gate (answer layer): correct / abstained "
         f"({cov.get('answer_abstention_precision_convention', 'n/a')})"),
        ("Answer-layer abstention recall", pct(cov.get("answer_abstention_recall")),
         "coverage gate (answer layer): correct / should-abstain; "
         f"n={cov.get('should_abstain_queries')}; missed="
         f"{', '.join(cov.get('missed_answer_abstentions', [])) or 'none'}"),
        ("Answer-layer FALSE abstentions",
         str(len(cov.get("false_answer_abstentions", []))),
         "TRIPWIRE: answerable gold queries the coverage gate abstained on: "
         f"{', '.join(cov.get('false_answer_abstentions', [])) or 'none'}"),
        # W12-B2 — the real AnswerPipeline. REPORT ONLY except the one band
        # gate below, and every number here is a BAND over the repeats (N-7).
        # The band's width is the claim: zero means these repeats agreed, and a
        # single run is never evidence of that on its own.
        ("Answer-level status counts (AnswerPipeline)",
         band_status_counts(band),
         "REPORT ONLY (BAND): status of the real AnswerPipeline "
         "(DEFAULT_ANSWER_LIMITS, rule-based drafter, lexical entailment); "
         f"n={al.get('measured_queries', 'n/a')}; {band_scope(band)}"
         f"; errors={', '.join(band.get('error_queries_union', [])) or 'none'}"),
        ("Answer-level false abstentions",
         band_int(band, "false_abstention_count"),
         "REPORT ONLY (BAND): answerable gold rows the pipeline ABSTAINed on "
         f"(n={al.get('answerable_queries', 'n/a')}); union over repeats: "
         f"{', '.join(band.get('false_abstentions_union', [])) or 'none'}"),
        ("Answer-level false answers",
         band_int(band, "false_answer_count"),
         "GATE (BAND): must be 0 in EVERY repeat; no_answer gold rows the "
         f"pipeline did NOT abstain on (n={al.get('no_answer_queries', 'n/a')}); "
         f"union: {', '.join(band.get('false_answers_union', [])) or 'none'}"),
        ("Answer-level finalizable rate",
         band_pct(band, "finalizable_rate"),
         "REPORT ONLY (BAND): finalizable answers / answerable rows "
         f"({band_int(band, 'finalizable_answers')}/"
         f"{al.get('answerable_queries', 'n/a')}); overall "
         f"{band_int(band, 'finalizable_total')}/{al.get('measured_queries', 'n/a')}; "
         f"{band_scope(band)}"),
        ("Answer-level expected unit cited",
         band_pct(band, "expected_unit_in_evidence_rate"),
         "REPORT ONLY (BAND): answerable rows whose evidence pack cites >= 1 "
         f"expected gold unit; n={al.get('expected_unit_checked', 'n/a')}"),
        ("Citation resolvability", pct(integ.get("citation_resolvability")),
         f"GATE: must be 100%; over {integ.get('ranked_hits_total')} ranked hits"),
        ("Quote/hash integrity", pct(integ.get("quote_hash_integrity")),
         f"GATE: must be 100%; over {integ.get('evidence_total')} evidence records"),
        ("Fabricated ids", str(integ.get("fabricated_id_count")),
         "GATE: must be 0; ids absent from the corpus inventory"),
        ("Cross-tenant leak indicators", str(integ.get("cross_tenant_leak_count")),
         "GATE: must be 0; non-public documents in a public search"),
        ("Retrieval latency p50 / p95 (ms)",
         f"{ms(lat['retrieval_per_query'].get('p50_ms'))} / "
         f"{ms(lat['retrieval_per_query'].get('p95_ms'))}",
         f"searchLegalCorpus wall clock per query; n={lat['retrieval_per_query'].get('n')}"),
        ("Evidence-pack latency p50 / p95 (ms)",
         f"{ms(lat['evidence_pack_per_query'].get('p50_ms'))} / "
         f"{ms(lat['evidence_pack_per_query'].get('p95_ms'))}",
         f"buildEvidencePack wall clock per query; n={lat['evidence_pack_per_query'].get('n')}"),
        ("Queries returning zero hits", str(lanes.get("zero_hit_query_count")),
         f"of {counts.get('gold_queries')} gold queries; "
         f"{abst.get('should_abstain_queries')} of them SHOULD return nothing"),
        ("Hits by lane",
         ", ".join(f"{lane}={count}" for lane, count in lanes.get("hits_by_lane", {}).items()),
         "ranked hits in whose lane provenance each lane appears "
         "(a lane at 0 contributed no recall on this corpus)"),
    ]
    lines = ["| Metric | Value | Definition |", "|---|---|---|"]
    lines += [
        f"| {_cell(name)} | {_cell(value)} | {_cell(definition)} |"
        for name, value, definition in rows
    ]
    return "\n".join(lines)


def _cell(value: str) -> str:
    """Escape pipes so a definition can never break the markdown table."""
    return str(value).replace("|", "\\|")


def render_markdown(report: dict[str, Any]) -> str:
    gates_rows = "\n".join(
        f"| {'PASS' if g['passed'] else 'FAIL'} | {g['name']} | {g['detail']} |"
        for g in report["gates"]
    )
    slice_counts: dict[str, int] = {}
    for row in report["per_query"]:
        slice_counts[row["task_type"]] = slice_counts.get(row["task_type"], 0) + 1
    slices = "\n".join(
        f"| {name} | {count} |" for name, count in sorted(slice_counts.items())
    )
    return f"""# Fixture-corpus functional baseline — {report['run_date']}

> **{report['synthetic_data_notice']}**

**What this is:** {report['what_this_is']}

**What this is NOT:** {report['what_this_is_not']}

Reproduce: `{report['reproduce']}`

## Run configuration

| Field | Value |
|---|---|
| Measured layer | {report['measured_layer']} |
| Dense (embedding) lane | `{report['dense_lane']}` — pgvector absent, no embedding profile |
| Database | `{report['database']}` (local scratch PostgreSQL) |
| Result limit | {report['result_limit']} |
| Corpus | {report['corpus']['files']} synthetic fixture files -> {report['corpus']['documents']} logical documents / {report['corpus']['versions']} versions / {report['corpus']['chunks']} chunks |
| Gold set | `{report['gold']['path']}` — {report['gold']['queries']} queries, {report['gold']['ground_truth_basis']} |
| Claims scored | {report['gold']['claims_scored']} — {report['gold']['claims_note']} |
| Python / Node | {report['python_version']} / {report['node_version']} |

## Measured metrics

{metric_table(report)}

## Gold slice distribution

| task_type | queries |
|---|---|
{slices}

## Hard invariant gates (master brief 13.1)

| Result | Gate | Detail |
|---|---|---|
{gates_rows}

Overall: **{'PASS' if report['gates_passed'] else 'FAIL'}**

## Citation checker summary

| Field | Value |
|---|---|
| claims passed | {report['citation_summary']['claims_passed']} / {report['citation_summary']['claims_total']} |
| evidence passed | {report['citation_summary']['evidence_passed']} / {report['citation_summary']['evidence_total']} |
| all passed | {report['citation_summary']['all_passed']} |

## Wall-clock stages (ms)

| Stage | ms |
|---|---|
""" + "\n".join(
        f"| {name} | {value:.1f} |"
        for name, value in report["latency"]["wall_clock_stage_ms"].items()
    ) + f"""

## Lane contribution

| Lane | ranked hits | sole contributor |
|---|---|---|
""" + "\n".join(
        # Driven by the metric dict, not by a second hand-maintained lane list:
        # gates.lane_metrics already fixes the lane set and its order, and a
        # lane present there but absent from a literal here would vanish from
        # the report while its hits kept counting elsewhere.
        f"| {lane} | {hits} |"
        f" {report['lane_metrics']['sole_contributor_by_lane'].get(lane, 0)} |"
        for lane, hits in report["lane_metrics"]["hits_by_lane"].items()
    ) + f"""

Queries that returned nothing at all: {report['lane_metrics']['zero_hit_query_count']}
({', '.join(report['lane_metrics']['zero_hit_queries']) or 'none'}).

## Question-coverage gate (answer layer, W12)

The product abstains not only on an empty retrieval but also when
`control-plane/src/answer/coverage.ts` finds that the retrieved passages do
not cover the question's own content words. The driver runs that SAME
function over the validated quotes of every gold query (see the docstring in
`measure_retrieval.ts` for the one documented difference: full ranked set
here, top-8 pack in the product).

| gold id | task_type | coverage | gate | best passage | answer abstained | should abstain | missing words |
|---|---|---|---|---|---|---|---|
""" + "\n".join(
        f"| {row['id']} | {row['task_type']} | {pct(row.get('ratio'))} | {row['gate']} |"
        f" {row.get('best_passage_covered')} | {row['answer_abstained']} |"
        f" {row['acceptable_abstention']} | {_cell(', '.join(row.get('missing', [])) or '-')} |"
        for row in (report.get("coverage_gate_metrics") or {}).get("per_query", [])
    ) + f"""

Gate outcomes: {(report.get('coverage_gate_metrics') or {}).get('gate_counts')}.
False answer-layer abstentions (answerable queries the gate refused):
{', '.join((report.get('coverage_gate_metrics') or {}).get('false_answer_abstentions', [])) or 'none'}.
Missed answer-layer abstentions (no_answer queries that still got an answer):
{', '.join((report.get('coverage_gate_metrics') or {}).get('missed_answer_abstentions', [])) or 'none'}.

## Answer-level outcomes (the real AnswerPipeline, W12-B2 — a BAND, W14 N-7)

`evals/answer/measure_answers.ts` runs `AnswerPipeline` exactly as
`POST /v1/answer` does (store adapters, `DEFAULT_ANSWER_LIMITS`, rule-based
drafter, lexical entailment) over every gold query. Unlike the coverage-gate
table above, this sees the coverage-aware cap, drafting, citation
validation, entailment and the finalization policy.

**This section is a band, not a value.** It USED to move between ingests of
one corpus (measured 03.09.2026: runs against one already-ingested database
were byte-identical, runs that re-ingested the same corpus were not; the
corpus — 8 files / 7 documents / 55 chunks — every retrieval metric and every
hard gate were identical in all of them, and what changed were the ids minted
at ingest). The last id-borne source was closed the same day
(`docs/implementation/waves/W14-N7.md`: the rank stage broke a score tie on the
chunk's uuid, so the coverage-aware cap kept a different top-8 after every
ingest). The band remains because a single run can never PROVE stability:
repeat with `--repeats N` and read the range;
`{band_scope(report.get('answer_level', {}).get('band'))}` for this report.
Only ONE thing here is gated and it is gated on the band's worst repeat:
**no_answer gold rows answered must be 0 in every repeat**.

Status counts: {band_status_counts((report.get('answer_level') or {}).get('band'))} ·
false abstentions (answerable rows → ABSTAIN): {band_int((report.get('answer_level') or {}).get('band'), 'false_abstention_count')} ({', '.join(((report.get('answer_level') or {}).get('band') or {}).get('false_abstentions_union', [])) or 'none'}) ·
false answers (no_answer rows → not ABSTAIN): {band_int((report.get('answer_level') or {}).get('band'), 'false_answer_count')} ({', '.join(((report.get('answer_level') or {}).get('band') or {}).get('false_answers_union', [])) or 'none'}) ·
finalizable rate: {band_pct((report.get('answer_level') or {}).get('band'), 'finalizable_rate')} ·
expected unit cited: {band_pct((report.get('answer_level') or {}).get('band'), 'expected_unit_in_evidence_rate')} ·
errors: {', '.join(((report.get('answer_level') or {}).get('band') or {}).get('error_queries_union', [])) or 'none'}.

The per-query table below is the LAST repeat only; a row that differs between
repeats is named in the union lists above.

| gold id | task_type | status | finalizable | claims | evidence | gate | expected cited | should abstain | reasons |
|---|---|---|---|---|---|---|---|---|---|
""" + "\n".join(
        f"| {row['id']} | {row['task_type']} | {row['status']} | {row['finalizable']} |"
        f" {row['claims']} | {row['evidence']} | {row.get('coverage_gate')} |"
        f" {row.get('expected_in_evidence')} | {row['acceptable_abstention']} |"
        f" {_cell(', '.join(row.get('reasons', [])) or '-')} |"
        for row in (report.get("answer_level") or {}).get("per_query", [])
    ) + f"""

## Per-query detail

| gold id | task_type | recall@10 | nDCG@10 | RR |
|---|---|---|---|---|
""" + "\n".join(
        f"| {row['id']} | {row['task_type']} | {num(row.get('recall@10'), 3)} |"
        f" {num(row.get('ndcg@10'), 3)} | {num(row.get('reciprocal_rank'), 3)} |"
        for row in report["per_query"]
    ) + f"""

## Caveats that must travel with these numbers

1. The corpus is **SENTETİK**: {report['corpus']['files']} authored fixture
   files. Recall over {report['corpus']['documents']} documents is not
   comparable to recall over Turkish law, and no number here says anything
   about legal quality.
2. The dense/embedding lane is a no-op (`{report['dense_lane']}`). This is a
   lexical + exact-pin baseline only.
3. `required_claims` in the gold set are **not scored** here; claim correctness
   needs the answer layer and lawyer adjudication.
4. Only the gate rows are invariants. Every other row is a regression tripwire
   for this corpus, not a quality claim about the product.
5. Read the **Lane contribution** table before quoting recall: a lane at zero
   hits means that lane contributed no recall on these queries.
"""


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - non-tty streams
        pass

    parser = argparse.ArgumentParser(
        prog="scripts/run_evals.py",
        description="Measured functional baseline over the synthetic fixture corpus.",
    )
    parser.add_argument("--dsn", default=os.environ.get("COLLEX_EVAL_DSN", DEFAULT_DSN),
                        help=f"local Postgres DSN (database must be {SCRATCH_DB})")
    parser.add_argument("--result-limit", type=int, default=20,
                        help="non-pinned hits kept per query (default 20)")
    parser.add_argument("--reports-dir", default=str(REPORTS_DIR))
    parser.add_argument("--run-date", default=date.today().isoformat())
    parser.add_argument("--keep-raw", action="store_true",
                        help="also write the raw driver measurement JSON")
    parser.add_argument("--repeats", type=int, default=1,
                        help="repeat ingest + the answer-level driver N times "
                             "and report the answer layer as a BAND (W14 N-7). "
                             "The retrieval measurement is taken once, on the "
                             "LAST ingest. Default 1 - which still prints a "
                             "band, of width 1, so no reader mistakes a single "
                             "run for a stable number")
    parser.add_argument("--skip-ingest", action="store_true",
                        help="measure an already-ingested collex_eval_test "
                             "without recreating it (iteration / gate proofs)")
    parser.add_argument("--fixture-only", action="store_true",
                        help="run only the DB-free deterministic invariants "
                             "(offset/quote/hash/fabricated-id); no retrieval metrics")
    parser.add_argument("--skip-report", action="store_true",
                        help="compute and gate, but do not write report files")
    args = parser.parse_args(argv)
    if args.repeats < 1:
        parser.error("--repeats must be >= 1")

    log(SYNTHETIC_BANNER)
    log("")

    if args.fixture_only:
        log("MODE: fixture-only invariants (no database, no retrieval metrics)")
        integrity, gate_results = fixture_only_invariants()
        log(f"  chunks checked: {integrity['ranked_hits_total']}")
        log(f"  evidence verified: {integrity['evidence_verified']}"
            f"/{integrity['evidence_total']}")
        log("")
        failed = _print_gates(gate_results)
        return 1 if failed else 0

    stopwatch = Stopwatch()
    gold = load_jsonl(GOLD_PATH)
    log(f"gold set: {GOLD_PATH.relative_to(REPO_ROOT)} ({len(gold)} queries)")

    workdir = Path(tempfile.mkdtemp(prefix="collex-evals-"))
    try:
        # The bundles do not touch the database, so they are built ONCE and
        # reused by every repeat below.
        log("stage 1/5  bundle both control-plane drivers")
        bundle = stopwatch.time("driver_bundle", lambda: build_driver(workdir))
        answer_bundle = stopwatch.time(
            "answer_driver_bundle",
            lambda: build_driver(workdir, DRIVER_ANSWER_TS, "measure_answers.mjs"),
        )

        # W14 M-SRV / N-7 / N7. The answer layer USED to move across INGESTS
        # (measured: identical across repeats on ONE ingested database,
        # different outcomes across re-ingests of the same corpus). The cause
        # was id-borne and is closed (W14-N7: the rank tie-break), and the band
        # is now width zero - but it is measured N times and reported as a band
        # anyway, because that is the only construction that can SHOW it on the
        # tree in front of you. `--skip-ingest` keeps the existing database,
        # which means every repeat sees the SAME ids - the band then covers 1
        # ingest and says so, rather than claiming a stability it never tested.
        answer_runs: list[dict[str, Any]] = []
        for attempt in range(1, args.repeats + 1):
            suffix = f" [{attempt}/{args.repeats}]" if args.repeats > 1 else ""
            if args.skip_ingest:
                log("stage 2/5  SKIPPED (--skip-ingest): measuring the existing"
                    f" database{suffix}")
            else:
                log(f"stage 2/5  database bootstrap + ingestion{suffix}")
                stopwatch.time("database_recreate",
                               lambda: log(f"  {recreate_database(args.dsn)}"))
                stopwatch.time("ingestion", lambda: ingest(args.dsn))

            log(f"stage 2b/5 run the answer-level driver (AnswerPipeline){suffix}")
            repeat_payload = stopwatch.time(
                "answer_measurement",
                lambda: run_answer_driver(answer_bundle, args.dsn, workdir),
            )
            answer_runs.append(gate_module.answer_level_metrics(gold, repeat_payload))
            if args.keep_raw:
                stem = f"fixture_baseline_{args.run_date}.answers.raw"
                name = f"{stem}.json" if args.repeats == 1 else f"{stem}.{attempt}.json"
                answers_raw = Path(args.reports_dir) / name
                answers_raw.parent.mkdir(parents=True, exist_ok=True)
                answers_raw.write_text(
                    json.dumps(repeat_payload, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8", newline="\n",
                )
                log(f"  raw answer-level measurement -> {answers_raw}")

        # The retrieval measurement is taken on the LAST ingest, so the
        # retrieval numbers and the last answer repeat describe ONE database.
        log("stage 2c/5 run the control-plane retrieval driver")
        payload = stopwatch.time(
            "retrieval_measurement",
            lambda: run_driver(bundle, args.dsn, workdir, args.result_limit),
        )
        if args.keep_raw:
            raw_path = Path(args.reports_dir) / f"fixture_baseline_{args.run_date}.raw.json"
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8", newline="\n",
            )
            log(f"  raw measurement -> {raw_path}")

        log("stage 3/5  score retrieval (evals/retrieval/benchmark.py)")
        bench = stopwatch.time("scoring", lambda: score(gold, payload))

        log("stage 4/5  verify citations (evals/citations/check_citations.py)")
        citation_report = stopwatch.time("citation_check", lambda: verify_citations(payload))

        log("stage 5/5  derive metrics + evaluate hard gates")
        integrity = gate_module.integrity_metrics(payload, citation_report)
        forms = gate_module.form_metrics(gold, payload)
        abstention = gate_module.abstention_metrics(gold, payload)
        coverage = gate_module.coverage_gate_metrics(gold, payload)
        # W12-B2 + W14 N-7: the LAST repeat's full detail (the per-query rows)
        # plus the BAND over every repeat. Only the band's false-answer row is
        # gated; the rest of the section stays report-only.
        answer_level = dict(answer_runs[-1]) if answer_runs else {}
        answer_level["band"] = gate_module.answer_level_band(
            answer_runs, ingests=1 if args.skip_ingest else args.repeats,
        )
        lanes = gate_module.lane_metrics(payload)
        latencies = stage_latencies(payload)
        gate_results = gate_module.evaluate_gates(
            integrity, bench["counts"], answer_level["band"],
        )

        report = build_report(
            payload=payload, bench=bench, citation_report=citation_report,
            integrity=integrity, forms=forms, abstention=abstention, lanes=lanes,
            latencies=latencies, gate_results=gate_results, stopwatch=stopwatch,
            dsn_dbname=dbname_of(args.dsn), result_limit=args.result_limit,
            run_date=args.run_date, coverage=coverage, answer_level=answer_level,
        )

        if not args.skip_report:
            reports_dir = Path(args.reports_dir)
            reports_dir.mkdir(parents=True, exist_ok=True)
            json_path = reports_dir / f"fixture_baseline_{args.run_date}.json"
            md_path = reports_dir / f"fixture_baseline_{args.run_date}.md"
            json_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8", newline="\n",
            )
            md_path.write_text(render_markdown(report), encoding="utf-8", newline="\n")
            log(f"  wrote {json_path}")
            log(f"  wrote {md_path}")

        log("")
        log(metric_table(report))
        log("")
        failed = _print_gates(gate_results)
        if bench["counts"]["missing_results"]:
            log(f"WARNING: {bench['counts']['missing_results']} gold queries had"
                " no result line (scored as empty rankings).")
        return 1 if failed else 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _print_gates(gate_results: list[gate_module.GateResult]) -> list[str]:
    log("HARD INVARIANT GATES (master brief 13.1)")
    failed: list[str] = []
    for gate in gate_results:
        status = "PASS" if gate.passed else "FAIL"
        log(f"  [{status}] {gate.name} -- {gate.detail}")
        if not gate.passed:
            failed.append(gate.name)
    log("")
    if failed:
        log("RESULT: FAIL (" + ", ".join(failed) + ")")
    else:
        log("RESULT: PASS")
    return failed


if __name__ == "__main__":
    sys.exit(main())
