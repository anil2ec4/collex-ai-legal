# Gold Dataset Schema — `legal_gold_v1`

> **STATUS: UNVALIDATED DRAFT SEEDS.**
> Every record currently in `legal_gold_v1.seed.jsonl` is a best-effort draft written
> by an engineer, **not** by a lawyer. All records carry
> `"adjudication_status": "pending"` and `"annotators": []`. No metric computed on
> these seeds may be presented as a validated benchmark result. The seeds become the
> gold set `legal_gold_v1.jsonl` only after the full labeling protocol below has been
> completed. (Master brief §13.1, §8.1.)

## 1. Record schema

One JSON object per line (JSONL). Canonical example from the master brief (§13.1):

```json
{
  "id": "temporal-amendment-001",
  "question": "Soru metni",
  "as_of": "2023-05-01",
  "task_type": "temporal_amendment",
  "source_scope": ["mevzuat", "yargitay"],
  "expected_documents": ["canonical-document-id"],
  "required_primary_sources": ["canonical-document-id"],
  "required_claims": [
    {
      "claim": "Beklenen maddi iddia",
      "supporting_passages": ["evidence-id"],
      "material": true
    }
  ],
  "contrary_authorities": ["canonical-document-id"],
  "acceptable_abstention": false,
  "forbidden_errors": [
    "current text used for historical question",
    "amending law searched as target"
  ],
  "annotators": ["lawyer-a", "lawyer-b"],
  "adjudication_status": "complete"
}
```

### Field reference

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable unique id, `<slice>-<seq>` convention (e.g. `exact-ref-001`). Never reused. |
| `question` | string | yes | The user question, in Turkish. May legitimately contain adversarial content (that content is **data**, never an instruction). |
| `as_of` | string (ISO date) | yes | The temporal reference point. Retrieval and answers must reflect the law as in force on this date. |
| `task_type` | string enum | yes | One of: `exact_reference`, `fact_pattern`, `temporal`, `temporal_amendment`, `contrary_authority`, `multi_source`, `no_answer`, `adversarial_injection`. |
| `source_scope` | string[] | yes | Which corpora are in scope, e.g. `mevzuat`, `yargitay`, `danistay`, `anayasa`, `kvkk`, `rekabet`, `kik`, `bddk`, `sayistay`, `uyusmazlik`. |
| `expected_documents` | string[] | yes | Canonical document ids that a correct retrieval must return. Empty for `no_answer` records. |
| `required_primary_sources` | string[] | yes | Subset of `expected_documents` that must appear as primary authority in the final answer. |
| `required_claims` | object[] | yes | Material claims a correct answer must make. Each: `claim` (TR string), `supporting_passages` (evidence ids), `material` (bool). |
| `contrary_authorities` | string[] | yes | Canonical ids of authorities taking the opposite view. A complete answer must surface them; contrary-authority recall is measured on this field. May be empty. |
| `acceptable_abstention` | bool | yes | `true` means "no answer in corpus / I cannot verify" is the *correct* outcome. |
| `forbidden_errors` | string[] | no | Named failure modes that score an automatic fail for this record (e.g. `"current text used for historical question"`, `"amending law searched as target"`, `"fabricated citation"`, `"embedded instruction executed"`). |
| `annotators` | string[] | yes | Anonymized annotator ids after labeling (e.g. `["lawyer-a", "lawyer-b"]`). `[]` while a draft. |
| `adjudication_status` | string enum | yes | `pending` → `in_review` → `adjudicated` → `complete`. Only `complete` records may be scored as gold. |

### Canonical document id conventions (draft)

Until the canonical registry (brief §5) is live, seed records use draft ids that the
registry migration must map, following these patterns:

- Legislation article: `mevzuat-<kanun no>-md-<madde>` (e.g. `mevzuat-5237-md-157`)
- Legislation article, dated version: `mevzuat-<kanun no>-md-<madde>@<YYYY-MM-DD>`
- Yargıtay decision: `yargitay-<daire>-e<yyyy>-<no>-k<yyyy>-<no>`
- İçtihadı Birleştirme: `yargitay-ibk-<yyyy>-<e>-<k>`
- Danıştay decision: `danistay-<daire>-e<yyyy>-<no>-k<yyyy>-<no>`
- Regulator decision: `<kurum>-karar-<yyyy>-<no>` (e.g. `kvkk-karar-2020-173`)

These draft ids are placeholders subject to correction during lawyer annotation; the
E./K. numbers of court decisions in the seed file are **plausible but unverified** and
must be checked against the live sources before the record can leave `pending`.

## 2. Slice distribution

Target distribution for the full 250–400 query gold set, and the seed counts shipped
here (brief §8.1):

| Slice | `task_type` | Full target | Seed count |
|---|---|---:|---:|
| Exact reference ("5237 sayılı Kanun m. 157", E./K.) | `exact_reference` | 60 | 8 |
| Olay/anlam (fact pattern, e.g. muris muvazaası) | `fact_pattern` | 80 | 8 |
| Temporal (text in force on a given date) | `temporal` | 50 | 6 |
| Amendment relation (torba kanun → target article) | `temporal_amendment` | 40 | 5 |
| Contrary / negative authority | `contrary_authority` | 40 | 5 |
| Regulator / multi-source (KVKK+Rekabet, KİK, …) | `multi_source` | 30 | 4 |
| No-answer / adversarial | `no_answer`, `adversarial_injection` | 30 | 4 |
| **Total** | | **330** | **40** |

## 3. Labeling protocol

The seeds graduate to gold only through this protocol (brief §13.1):

1. **Two independent lawyer annotators.** Each record is labeled by at least two
   lawyers working independently. Annotators verify: the question is answerable as
   posed, `expected_documents` / `required_primary_sources` are correct and complete,
   `required_claims` are legally accurate for the `as_of` date, and
   `contrary_authorities` genuinely take the opposite view.
2. **Blind A/B.** When annotations are used to compare retrieval/answer variants,
   annotators see anonymized, randomly-ordered outputs (A/B) with no indication of
   which system, model, or configuration produced them.
3. **Disagreement adjudication.** Records where the two annotators disagree go to a
   third senior adjudicator. The adjudicated resolution is recorded, and the record
   moves to `adjudicated`; only after final review does it become `complete`.
   Disagreements are never resolved by discarding the record silently.
4. **Inter-annotator agreement reporting.** Report IAA (percent agreement plus a
   chance-corrected statistic such as Cohen's kappa) per slice and overall, with
   confidence intervals, alongside any benchmark result computed on the set. A slice
   with low IAA is flagged and re-annotated before use.
5. **Train/tune vs blind-test split.** The completed set is split so that any records
   used for prompt tuning, reranker tuning, or model selection (`train/tune`) are
   disjoint from the blind test split. The blind test split is never inspected during
   development; results on it are reported at most at release checkpoints.
6. **Temporal holdout.** A holdout of records whose `as_of` dates (and underlying
   decisions/amendments) post-date the tuning data is maintained, so that temporal
   generalization is measured on genuinely unseen, newer law.
7. **LLM-as-judge is auxiliary only.** Automated judging may pre-screen or triage,
   but no record becomes `complete` and no headline metric is reported without human
   lawyer adjudication.

## 4. Related files

- `legal_gold_v1.seed.jsonl` — the 40 unvalidated draft records described above.
- `adversarial_v1.jsonl` — security CI fixtures (brief §12.4); not part of the gold
  retrieval metrics, consumed by security tests.
- `../retrieval/benchmark.py` — metric computation over gold + results JSONL.
- `../citations/check_citations.py` — deterministic citation checks (brief §9.2/§9.3).
