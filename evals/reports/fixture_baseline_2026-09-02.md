# Fixture-corpus functional baseline — 2026-09-02

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
| Gold set | `evals/datasets/fixture_corpus_gold.jsonl` — 34 queries, authored_synthetic (ground truth by construction) |
| Claims scored | False — required_claims TEXT is still not scored (needs lawyer adjudication); the answer_level section (W12-B2) reports the real AnswerPipeline's status / abstention / finalizability per query, report-only. |
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
| Abstention recall | 92.3% | correct abstentions / should-abstain; n=13 |
| Answer-layer abstention precision | 100.0% | coverage gate (answer layer): correct / abstained (measured) |
| Answer-layer abstention recall | 100.0% | coverage gate (answer layer): correct / should-abstain; n=13; missed=none |
| Answer-layer FALSE abstentions | 0 | TRIPWIRE: answerable gold queries the coverage gate abstained on: none |
| Answer-level status counts (AnswerPipeline) | ABSTAIN=14, COMPLETE=13, PARTIAL=3, QUALIFIED=4 | REPORT ONLY (BAND): status of the real AnswerPipeline (DEFAULT_ANSWER_LIMITS, rule-based drafter, lexical entailment); n=34; 4 repeat(s) / 4 ingest(s), identical across them; errors=none |
| Answer-level false abstentions | 1 | REPORT ONLY (BAND): answerable gold rows the pipeline ABSTAINed on (n=21); union over repeats: fx-amend-002 |
| Answer-level false answers | 0 | GATE (BAND): must be 0 in EVERY repeat; no_answer gold rows the pipeline did NOT abstain on (n=13); union: none |
| Answer-level finalizable rate | 81.0% | REPORT ONLY (BAND): finalizable answers / answerable rows (17/21); overall 17/34; 4 repeat(s) / 4 ingest(s), identical across them |
| Answer-level expected unit cited | 95.2% | REPORT ONLY (BAND): answerable rows whose evidence pack cites >= 1 expected gold unit; n=21 |
| Citation resolvability | 100.0% | GATE: must be 100%; over 128 ranked hits |
| Quote/hash integrity | 100.0% | GATE: must be 100%; over 35 evidence records |
| Fabricated ids | 0 | GATE: must be 0; ids absent from the corpus inventory |
| Cross-tenant leak indicators | 0 | GATE: must be 0; non-public documents in a public search |
| Retrieval latency p50 / p95 (ms) | 8.1 / 19.9 | searchLegalCorpus wall clock per query; n=34 |
| Evidence-pack latency p50 / p95 (ms) | 0.3 / 1.1 | buildEvidencePack wall clock per query; n=34 |
| Queries returning zero hits | 12 | of 34 gold queries; 13 of them SHOULD return nothing |
| Hits by lane | exact=36, lexical=67, trigram=5, dense=0, relation=17, citation=12 | ranked hits in whose lane provenance each lane appears (a lane at 0 contributed no recall on this corpus) |

## Gold slice distribution

| task_type | queries |
|---|---|
| contrary_authority | 2 |
| exact_reference | 9 |
| fact_pattern | 4 |
| no_answer | 13 |
| temporal | 3 |
| temporal_amendment | 3 |

## Hard invariant gates (master brief 13.1)

| Result | Gate | Detail |
|---|---|---|
| PASS | citation_resolvability == 100% | 100.00% of 128 candidate passage(s) resolved to verified-document evidence |
| PASS | quote_hash_integrity == 100% | 35/35 evidence records passed offset+quote+quote-hash+content-hash (+0 stored-hash mismatch vs. what ingestion recorded) |
| PASS | fabricated_ids == 0 | 0 identifier(s) absent from the corpus inventory |
| PASS | cross_tenant_leak_indicators == 0 | 0 non-public hit(s) in a public corpus search |
| PASS | no retrieval lane total failure | queries whose every retrieval lane failed: none |
| PASS | no gold query dropped | 0 gold queries had no result line |
| PASS | answer-layer false answers == 0 (every repeat) | worst repeat: 0 no_answer gold row(s) answered over 4 repeat(s) / 4 ingest(s); ids: none |

Overall: **PASS**

## Citation checker summary

| Field | Value |
|---|---|
| claims passed | 22 / 22 |
| evidence passed | 35 / 35 |
| all passed | True |

## Wall-clock stages (ms)

| Stage | ms |
|---|---|
| driver_bundle | 106.4 |
| answer_driver_bundle | 96.8 |
| database_recreate | 251.0 |
| ingestion | 405.6 |
| answer_measurement | 1014.1 |
| retrieval_measurement | 510.2 |
| scoring | 0.5 |
| citation_check | 0.6 |

## Lane contribution

| Lane | ranked hits | sole contributor |
|---|---|---|
| exact | 36 | 32 |
| lexical | 67 | 59 |
| trigram | 5 | 0 |
| dense | 0 | 0 |
| relation | 17 | 17 |
| citation | 12 | 12 |

Queries that returned nothing at all: 12
(fx-noanswer-001, fx-noanswer-002, fx-noanswer-003, fx-noanswer-004, fx-noanswer-005, fx-noanswer-006, fx-noanswer-007, fx-noanswer-008, fx-noanswer-009, fx-noanswer-010, fx-nearmiss-001, fx-nearmiss-002).

## Question-coverage gate (answer layer, W12)

The product abstains not only on an empty retrieval but also when
`control-plane/src/answer/coverage.ts` finds that the retrieved passages do
not cover the question's own content words. The driver runs that SAME
function over the validated quotes of every gold query (see the docstring in
`measure_retrieval.ts` for the one documented difference: full ranked set
here, top-8 pack in the product).

| gold id | task_type | coverage | gate | best passage | answer abstained | should abstain | missing words |
|---|---|---|---|---|---|---|---|
| fx-exact-001 | exact_reference | 66.7% | bypassed-by-reference | 2 | False | False | temel |
| fx-exact-002 | exact_reference | 66.7% | bypassed-by-reference | 2 | False | False | temel |
| fx-exact-003 | exact_reference | 50.0% | bypassed-by-reference | 2 | False | False | haksız, sorumluluğunun, genel |
| fx-exact-004 | exact_reference | 40.0% | bypassed-by-reference | 2 | False | False | haksız, sorumluluğunun, genel |
| fx-exact-005 | exact_reference | 63.6% | bypassed-by-reference | 4 | False | False | suçu, tanımlanmıştır |
| fx-exact-006 | exact_reference | 60.0% | bypassed-by-reference | 3 | False | False | suçu, tanımlanmıştır |
| fx-exact-007 | exact_reference | 100.0% | bypassed-by-reference | 2 | False | False | - |
| fx-exact-008 | exact_reference | 100.0% | bypassed-by-reference | 2 | False | False | - |
| fx-exact-009 | exact_reference | 100.0% | bypassed-by-reference | 4 | False | False | - |
| fx-fact-001 | fact_pattern | 100.0% | passed | 13 | False | False | - |
| fx-fact-002 | fact_pattern | 77.8% | passed | 7 | False | False | suçu, oluşturur |
| fx-fact-003 | fact_pattern | 92.3% | passed | 10 | False | False | uygun |
| fx-fact-004 | fact_pattern | 86.7% | passed | 7 | False | False | hâkim |
| fx-temporal-001 | temporal | 22.2% | bypassed-by-reference | 2 | False | False | haziran, tarihinde, yürürlükte, öngörülen, alt, üst, sınırı |
| fx-temporal-002 | temporal | 33.3% | bypassed-by-reference | 3 | False | False | mart, yürürlükte, öngörülen, alt, üst, sınırı |
| fx-temporal-003 | temporal | 25.0% | bypassed-by-reference | 1 | False | False | ocak, tarihi, metni |
| fx-amend-001 | temporal_amendment | 100.0% | bypassed-by-reference | 1 | False | False | - |
| fx-amend-002 | temporal_amendment | 100.0% | bypassed-by-reference | 1 | False | False | - |
| fx-amend-003 | temporal_amendment | 64.7% | passed | 3 | False | False | temel, artıran, torba |
| fx-contrary-001 | contrary_authority | 44.4% | passed | 5 | False | False | alıp, aksi, yönde, yargıtay, kararı |
| fx-contrary-002 | contrary_authority | 76.5% | passed | 6 | False | False | yoksa, suçu |
| fx-noanswer-001 | no_answer | 0.0% | failed | 0 | True | True | tüketicinin, korunması, ayıplı, maldan, doğan, seçimlik, haklar |
| fx-noanswer-002 | no_answer | 0.0% | failed | 0 | True | True | icra, iflas, birinci, haciz, ihbarnamesine, itiraz, süresi, gündür |
| fx-noanswer-003 | no_answer | 0.0% | failed | 0 | True | True | danıştay, dairesi, kararında, hükmedilmiştir |
| fx-noanswer-004 | no_answer | 0.0% | failed | 0 | True | True | kadıköy, taşınmaz, ayşe, yılmaz, açtığı, kira, bedelinin, tespiti, davasında, mahkeme, karar, verdi |
| fx-noanswer-005 | no_answer | 0.0% | failed | 0 | True | True | uzay, uydu, çarpışmasında, sorumluluk, belirlenir |
| fx-noanswer-006 | no_answer | 0.0% | failed | 0 | True | True | kripto, varlık, borsası, lisans, şartları |
| fx-noanswer-007 | no_answer | 0.0% | failed | 0 | True | True | miras, bırakanın, dijital, hesapları, mirasçılara, geçer |
| fx-noanswer-008 | no_answer | 0.0% | failed | 0 | True | True | izinsiz, drone, uçuşunun, cezası |
| fx-noanswer-009 | no_answer | 0.0% | failed | 0 | True | True | boşanma, davasında, evcil, hayvanın, velayeti |
| fx-noanswer-010 | no_answer | 0.0% | failed | 0 | True | True | yapay, zekâ, üretilen, eserlerde, telif, hakkı, aittir |
| fx-nearmiss-001 | no_answer | 0.0% | failed | 0 | True | True | kira, sözleşmesinde, depozito, iadesi |
| fx-nearmiss-002 | no_answer | 0.0% | failed | 0 | True | True | trafik, kazasında, araç, değer, kaybı, tazminatı, hesaplanır |
| fx-nearmiss-003 | no_answer | 33.3% | failed | 2 | True | True | kartı, aidatının, iadesi, talep |

Gate outcomes: {'bypassed-by-reference': 14, 'failed': 13, 'passed': 7}.
False answer-layer abstentions (answerable queries the gate refused):
none.
Missed answer-layer abstentions (no_answer queries that still got an answer):
none.

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
`4 repeat(s) / 4 ingest(s), identical across them` for this report.
Only ONE thing here is gated and it is gated on the band's worst repeat:
**no_answer gold rows answered must be 0 in every repeat**.

Status counts: ABSTAIN=14, COMPLETE=13, PARTIAL=3, QUALIFIED=4 ·
false abstentions (answerable rows → ABSTAIN): 1 (fx-amend-002) ·
false answers (no_answer rows → not ABSTAIN): 0 (none) ·
finalizable rate: 81.0% ·
expected unit cited: 95.2% ·
errors: none.

The per-query table below is the LAST repeat only; a row that differs between
repeats is named in the union lists above.

| gold id | task_type | status | finalizable | claims | evidence | gate | expected cited | should abstain | reasons |
|---|---|---|---|---|---|---|---|---|---|
| fx-exact-001 | exact_reference | COMPLETE | True | 4 | 4 | bypassed-by-reference | True | False | - |
| fx-exact-002 | exact_reference | COMPLETE | True | 4 | 4 | bypassed-by-reference | True | False | - |
| fx-exact-003 | exact_reference | PARTIAL | False | 1 | 2 | bypassed-by-reference | True | False | NOT_FINALIZABLE, QUESTION_PARTIALLY_COVERED |
| fx-exact-004 | exact_reference | COMPLETE | True | 1 | 2 | bypassed-by-reference | True | False | - |
| fx-exact-005 | exact_reference | COMPLETE | True | 2 | 3 | bypassed-by-reference | True | False | - |
| fx-exact-006 | exact_reference | COMPLETE | True | 2 | 3 | bypassed-by-reference | True | False | - |
| fx-exact-007 | exact_reference | COMPLETE | True | 1 | 3 | bypassed-by-reference | True | False | - |
| fx-exact-008 | exact_reference | COMPLETE | True | 1 | 3 | bypassed-by-reference | True | False | - |
| fx-exact-009 | exact_reference | COMPLETE | True | 8 | 8 | bypassed-by-reference | True | False | - |
| fx-fact-001 | fact_pattern | QUALIFIED | True | 7 | 8 | passed | True | False | CONFLICTING_AUTHORITIES:claim-ev-835dc7fe06cdfe5e:ev-9014d22eb5bbaab4, CONFLICTING_AUTHORITIES:claim-ev-65fb2f30dd215345:ev-9014d22eb5bbaab4, CONFLICTING_AUTHORITIES:claim-ev-a4401eb301049be8:ev-9014d22eb5bbaab4 |
| fx-fact-002 | fact_pattern | COMPLETE | True | 3 | 4 | passed | True | False | - |
| fx-fact-003 | fact_pattern | COMPLETE | True | 3 | 3 | passed | True | False | - |
| fx-fact-004 | fact_pattern | COMPLETE | True | 6 | 7 | passed | True | False | - |
| fx-temporal-001 | temporal | PARTIAL | False | 1 | 1 | bypassed-by-reference | True | False | NOT_FINALIZABLE, QUESTION_PARTIALLY_COVERED, TEMPORAL_COMPARISON_MISSING |
| fx-temporal-002 | temporal | PARTIAL | False | 1 | 1 | bypassed-by-reference | True | False | NOT_FINALIZABLE, QUESTION_PARTIALLY_COVERED, TEMPORAL_COMPARISON_MISSING |
| fx-temporal-003 | temporal | QUALIFIED | True | 1 | 1 | bypassed-by-reference | True | False | TEMPORAL_COMPARISON_MISSING |
| fx-amend-001 | temporal_amendment | COMPLETE | True | 1 | 1 | bypassed-by-reference | True | False | - |
| fx-amend-002 | temporal_amendment | ABSTAIN | False | 0 | 0 | failed | False | False | QUESTION_NOT_COVERED, ABSTENTION_NOT_FINALIZABLE |
| fx-amend-003 | temporal_amendment | COMPLETE | True | 8 | 8 | passed | True | False | - |
| fx-contrary-001 | contrary_authority | QUALIFIED | True | 6 | 8 | passed | True | False | CONFLICTING_AUTHORITIES:claim-ev-65fb2f30dd215345:ev-9014d22eb5bbaab4, CONFLICTING_AUTHORITIES:claim-ev-835dc7fe06cdfe5e:ev-9014d22eb5bbaab4 |
| fx-contrary-002 | contrary_authority | QUALIFIED | True | 6 | 8 | passed | True | False | CONFLICTING_AUTHORITIES:claim-ev-65fb2f30dd215345:ev-f66dfd2535514779+ev-9014d22eb5bbaab4, CONFLICTING_AUTHORITIES:claim-ev-835dc7fe06cdfe5e:ev-f66dfd2535514779+ev-9014d22eb5bbaab4, CONFLICTING_AUTHORITIES:claim-ev-a4401eb301049be8:ev-f66dfd2535514779+ev-9014d22eb5bbaab4 |
| fx-noanswer-001 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-002 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-003 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-004 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-005 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-006 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-007 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-008 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-009 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-noanswer-010 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-nearmiss-001 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-nearmiss-002 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | NO_EVIDENCE, ABSTENTION_NOT_FINALIZABLE |
| fx-nearmiss-003 | no_answer | ABSTAIN | False | 0 | 0 | failed | None | True | QUESTION_NOT_COVERED, ABSTENTION_NOT_FINALIZABLE |

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
| fx-noanswer-005 | no_answer | n/a | n/a | n/a |
| fx-noanswer-006 | no_answer | n/a | n/a | n/a |
| fx-noanswer-007 | no_answer | n/a | n/a | n/a |
| fx-noanswer-008 | no_answer | n/a | n/a | n/a |
| fx-noanswer-009 | no_answer | n/a | n/a | n/a |
| fx-noanswer-010 | no_answer | n/a | n/a | n/a |
| fx-nearmiss-001 | no_answer | n/a | n/a | n/a |
| fx-nearmiss-002 | no_answer | n/a | n/a | n/a |
| fx-nearmiss-003 | no_answer | n/a | n/a | n/a |

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
