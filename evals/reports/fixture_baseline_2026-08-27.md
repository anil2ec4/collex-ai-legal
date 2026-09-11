# Fixture-corpus functional baseline — 2026-08-27

> **SENTETİK VERİ / SYNTHETIC DATA — this corpus is authored test data, not real Turkish case law or legislation.**

**What this is:** Functional regression baseline of the retrieval + evidence pipeline over an authored synthetic corpus.

**What this is NOT:** NOT a Turkish legal quality benchmark. Legal quality requires the lawyer-annotated gold set (legal_gold_v1), which remains pending.

Reproduce: `.venv/Scripts/python.exe scripts/run_evals.py`

## Run configuration

| Field | Value |
|---|---|
| Measured layer | control-plane searchLegalCorpus (exact-pin + turkish FTS + pg_trgm + RRF); dense lane = NoopDenseLane (pgvector absent) |
| Dense (embedding) lane | `noop` — pgvector absent, no embedding profile |
| Database | `collex_eval_test` (local scratch PostgreSQL) |
| Result limit | 20 |
| Corpus | 8 synthetic fixture files -> 7 logical documents / 8 versions / 55 chunks |
| Gold set | `evals/datasets/fixture_corpus_gold.jsonl` — 25 queries, authored_synthetic (ground truth by construction) |
| Claims scored | False — required_claims are carried for the future answer-layer eval; this run scores retrieval and citation integrity only. |
| Python / Node | 3.13.14 / v24.15.0 |

## Measured metrics

| Metric | Value | Definition |
|---|---|---|
| Recall@5 | 0.9429 | mean over queries with >=1 expected unit: (expected units in top 5) / (expected units) |
| Recall@10 | 1.0000 | same, top 10 |
| Recall@20 | 1.0000 | same, top 20 |
| nDCG@10 | 0.9156 | binary gain, log2(rank+1) discount, IDCG = min(expected, 10) ideal hits |
| MRR | 0.9024 | mean 1/rank of the first expected unit |
| Exact-reference accuracy | 100.0% | rank-1 hit is an expected unit; n=9 |
| Abbreviation-form accuracy | 100.0% | all expected units within top-10 for 'TCK m.157'-style queries; n=6 |
| Full-name-form accuracy | 100.0% | same for '5237 sayılı ...'-style queries; n=7 |
| Abbreviation-form parity | 100.0% | identical top-10 ranking for both forms of the same question; n=4 pairs |
| Temporal accuracy | 100.0% | every expected as-of version retrieved; n=6 |
| Contrary-authority recall | 1.0000 | fraction of contrary units present anywhere in the ranking; n=3 |
| Abstention precision | 100.0% | correct abstentions / abstentions (measured) |
| Abstention recall | 100.0% | correct abstentions / should-abstain; n=4 |
| Citation resolvability | 100.0% | GATE: must be 100%; over 125 ranked hits |
| Quote/hash integrity | 100.0% | GATE: must be 100%; over 35 evidence records |
| Fabricated ids | 0 | GATE: must be 0; ids absent from the corpus inventory |
| Cross-tenant leak indicators | 0 | GATE: must be 0; non-public documents in a public search |
| Retrieval latency p50 / p95 (ms) | 8.9 / 20.1 | searchLegalCorpus wall clock per query; n=25 |
| Evidence-pack latency p50 / p95 (ms) | 0.5 / 1.1 | buildEvidencePack wall clock per query; n=25 |
| Queries returning zero hits | 4 | of 25 gold queries; 4 of them SHOULD return nothing |
| Hits by lane | exact=48, lexical=66, trigram=5, dense=0, relation=15 | ranked hits in whose lane provenance each lane appears (a lane at 0 contributed no recall on this corpus) |

## Gold slice distribution

| task_type | queries |
|---|---|
| contrary_authority | 2 |
| exact_reference | 9 |
| fact_pattern | 4 |
| no_answer | 4 |
| temporal | 3 |
| temporal_amendment | 3 |

## Hard invariant gates (master brief 13.1)

| Result | Gate | Detail |
|---|---|---|
| PASS | citation_resolvability == 100% | 100.00% of 125 candidate passage(s) resolved to verified-document evidence |
| PASS | quote_hash_integrity == 100% | 35/35 evidence records passed offset+quote+quote-hash+content-hash (+0 stored-hash mismatch vs. what ingestion recorded) |
| PASS | fabricated_ids == 0 | 0 identifier(s) absent from the corpus inventory |
| PASS | cross_tenant_leak_indicators == 0 | 0 non-public hit(s) in a public corpus search |
| PASS | no retrieval lane total failure | queries whose every retrieval lane failed: none |
| PASS | no gold query dropped | 0 gold queries had no result line |

Overall: **PASS**

## Citation checker summary

| Field | Value |
|---|---|
| claims passed | 21 / 21 |
| evidence passed | 35 / 35 |
| all passed | True |

## Wall-clock stages (ms)

| Stage | ms |
|---|---|
| database_recreate | 602.7 |
| ingestion | 380.6 |
| driver_bundle | 99.6 |
| retrieval_measurement | 393.9 |
| scoring | 0.5 |
| citation_check | 0.5 |

## Lane contribution

| Lane | ranked hits | sole contributor |
|---|---|---|
| exact | 48 | 44 |
| lexical | 66 | 58 |
| trigram | 5 | 0 |
| dense | 0 | 0 |
| relation | 15 | 15 |

Queries that returned nothing at all: 4
(fx-noanswer-001, fx-noanswer-002, fx-noanswer-003, fx-noanswer-004).

## Per-query detail

| gold id | task_type | recall@10 | nDCG@10 | RR |
|---|---|---|---|---|
| fx-exact-001 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-002 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-003 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-004 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-005 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-006 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-007 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-008 | exact_reference | 1.000 | 1.000 | 1.000 |
| fx-exact-009 | exact_reference | 1.000 | 0.951 | 1.000 |
| fx-fact-001 | fact_pattern | 1.000 | 1.000 | 1.000 |
| fx-fact-002 | fact_pattern | 1.000 | 1.000 | 1.000 |
| fx-fact-003 | fact_pattern | 1.000 | 0.920 | 1.000 |
| fx-fact-004 | fact_pattern | 1.000 | 1.000 | 1.000 |
| fx-temporal-001 | temporal | 1.000 | 1.000 | 1.000 |
| fx-temporal-002 | temporal | 1.000 | 1.000 | 1.000 |
| fx-temporal-003 | temporal | 1.000 | 1.000 | 1.000 |
| fx-amend-001 | temporal_amendment | 1.000 | 1.000 | 1.000 |
| fx-amend-002 | temporal_amendment | 1.000 | 0.414 | 0.200 |
| fx-amend-003 | temporal_amendment | 1.000 | 0.501 | 0.250 |
| fx-contrary-001 | contrary_authority | 1.000 | 0.591 | 0.500 |
| fx-contrary-002 | contrary_authority | 1.000 | 0.850 | 1.000 |
| fx-noanswer-001 | no_answer | n/a | n/a | n/a |
| fx-noanswer-002 | no_answer | n/a | n/a | n/a |
| fx-noanswer-003 | no_answer | n/a | n/a | n/a |
| fx-noanswer-004 | no_answer | n/a | n/a | n/a |

## Caveats that must travel with these numbers

1. The corpus is **SENTETİK**: 8 authored fixture
   files. Recall over 7 documents is not
   comparable to recall over Turkish law, and no number here says anything
   about legal quality.
2. The dense/embedding lane is a no-op (`noop`). This is a
   lexical + exact-pin baseline only.
3. `required_claims` in the gold set are **not scored** here; claim correctness
   needs the answer layer and lawyer adjudication.
4. Only the gate rows are invariants. Every other row is a regression tripwire
   for this corpus, not a quality claim about the product.
5. Read the **Lane contribution** table before quoting recall: a lane at zero
   hits means that lane contributed no recall on these queries.
