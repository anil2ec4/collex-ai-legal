# `fixture_corpus_gold.jsonl` — gold set for the SYNTHETIC fixture corpus

> **SENTETİK VERİ.** Every document this gold set refers to lives in
> `evals/fixtures/corpus/` and is **authored test data**, not real Turkish
> legislation or case law. Nothing measured on it is a legal quality result.

## 1. Why this file exists next to `legal_gold_v1.seed.jsonl`

The two files answer different questions and must never be confused:

| | `legal_gold_v1.seed.jsonl` | `fixture_corpus_gold.jsonl` (this file) |
|---|---|---|
| Underlying documents | real Turkish law | **synthetic**, authored in this repo |
| Ground truth comes from | lawyers (protocol in `SCHEMA.md`) — **not yet done** | **construction**: we wrote the corpus and the answers together |
| `adjudication_status` | `pending` (unvalidated drafts) | `by_construction` |
| Scorable today? | **No** | **Yes**, as a *functional* baseline |
| What a number on it means | nothing yet | the retrieval/temporal/citation machinery behaved (or stopped behaving) as designed |
| Legal quality claim | pending lawyer annotation | **never** |

A run over this file is a regression tripwire. It can tell you that exact
reference resolution broke, that the `TCK` ↔ `5237 sayılı` parity regressed,
that a temporal query started returning the wrong version, or that a citation
stopped hash-verifying. It cannot tell you that the product answers Turkish
legal questions well.

## 2. Unit ids: the retrieval unit, not the document

`expected_documents`, `required_primary_sources`, `contrary_authorities` and
`required_claims[].supporting_passages` all use a **unit id**:

```
<external_id>@<version_label>#<structural path joined by "/">

kanun-5237@v1-20050601#madde-157/fikra-1
kanun-5237@v2-20260115-7999#madde-157/fikra-1
kanun-6098@v1-20120701#madde-49/fikra-2
kanun-7999@v1-20260115#madde-1/fikra-1
yargitay-15cd-2024-1187@v1#bolum-gerekce
kvkk-2025-1834@v1#bolum-hukum
```

Three deliberate properties:

1. **Chunk granularity, not document granularity.** The corpus has 7 logical
   documents; scoring Recall@20 over 7 documents would be meaningless. The
   retrieval unit is the chunk the pipeline actually ranks — a madde/fıkra for
   legislation, a section for decisions.
2. **Version-pinned.** `kanun-5237` has two versions with different effective
   periods (`[2005-06-01, 2026-01-15)` and `[2026-01-15, )`). The version label
   in the id is what makes the temporal slice scorable: retrieving the right
   article but the wrong version is a *miss*, not a hit.
3. **Stable across ingests.** The database assigns fresh UUIDs on every ingest,
   so UUIDs can never appear in a checked-in gold file. `scripts/run_evals.py`
   joins retrieval output back to these ids after the fact; the join never
   reorders or filters what retrieval returned.

`evals/tests/test_fixture_gold.py::test_every_unit_id_resolves_to_a_shipped_fixture`
re-derives the structural paths with the real ingestion chunker and fails if any
gold id names a passage the corpus does not contain.

## 3. Fields

Everything in `SCHEMA.md` §1 applies, plus:

| Field | Type | Meaning |
|---|---|---|
| `reference_form` | `full_name` \| `abbreviation` \| `docket` \| `none` | How the query names the authority. Drives the abbreviation-form metrics. |
| `parity_group` | string \| null | Two records sharing a group ask the **same question** and differ **only** in `reference_form` (`"TCK m. 157"` vs `"5237 sayılı Türk Ceza Kanunu m. 157"`). Enforced by test. |
| `leak_probe` | bool | The query's only lexical match is the tenant-scoped fixture. A hit on it is a cross-tenant leak. |
| `corpus` | string | `fixture_corpus_v1`. |
| `ground_truth_basis` | string | `authored_synthetic`. |
| `adjudication_status` | string | `by_construction` — deliberately outside the lawyer pipeline's `pending → complete` ladder so it can never be mistaken for an adjudicated legal gold record. |

`required_claims` are carried for the future answer-layer evaluation. The
current baseline **does not score them**: there is no answer generation in the
measured path, and claim correctness would need lawyer adjudication anyway.

## 4. Slice coverage

| Slice | `task_type` | queries | What it probes |
|---|---|---|---|
| Exact reference | `exact_reference` | 9 | `TCK m.157`, `TBK m.49`, `m.155`, `m.158` in both reference forms + an E./K. docket lookup |
| Fact pattern | `fact_pattern` | 4 | no citation in the query; lexical/trigram recall only |
| Temporal | `temporal` | 3 | pre-amendment (2025-06-01), post-amendment (2026-03-01), and the day-before-commencement edge (2026-01-10) |
| Amendment target | `temporal_amendment` | 3 | torba 7999 → TCK m.157 and TBK m.49 |
| Contrary authority | `contrary_authority` | 2 | the deliberately contradictory Yargıtay pair (2024/1187 vs 2024/2356) |
| No answer / abstention | `no_answer` | 4 | out-of-corpus law, out-of-corpus docket, and the tenant leak probe |
| **Total** | | **25** | |

## 5. Running it

```bash
.venv/Scripts/python.exe scripts/run_evals.py
```

See `evals/reports/BASELINE.md` for what the produced numbers do and do not
mean, and `evals/reports/fixture_baseline_<date>.md` for a measured run.
