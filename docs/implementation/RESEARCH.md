# Research ledger

Dated ledger of research findings and open questions. Protocol (brief §15.4):

- Prefer official documents, model cards, academic papers or upstream repos
  for technical topics; never present vendor marketing as independent fact.
- Every finding records URL (when applicable), publication/access date, and a
  class: `verified` (doğrulandı) / `marketing` (pazarlama) / `historical`
  (tarihsel) / `inference` (çıkarım).
- Do not invent what was not found; record the search performed and the
  missing evidence instead.
- Note which ADR/implementation decision each finding changes.
- **Time-sensitive facts (prices, model availability, Terms) must be
  re-verified at implementation day and again at release day.** Entries below
  marked "verify at implementation/release day" are stale-by-default.
- No network access => do not present old knowledge as current; record a
  blocker and continue offline work.

## Ledger

Newest first. `verified (executed)` means a command was run on this machine and
its exit code recorded.

| Date | Topic | Finding (summary) | Class | Affects | Re-verify? |
|---|---|---|---|---|---|
| 2026-09-10 | **Corpus-lane ranking: IDF-aware lexical lane, weighted RRF, synonym expansion, one Turkish analyzer** | `chunkStore.ts::lexicalSearch` (coverage mode) now (a) ranks by `ts_rank_cd(..., 1)` (length normalization) times the BM25-IDF share of the query the chunk carries — IDF from per-lexeme document frequencies probed through the GIN index (`vector @@ 'lexeme'`), cached per connection with a TTL and invalidated by the upload/delete routes (no `ts_stat` scan); and (b) admits on the flat `ceil(minCoverage × terms)` rule **OR** an IDF-weighted minimum-should-match at the SAME floor — a union, so the admitted set is a superset of the pre-change set for every query (property test in `tests/store/retrieval.test.ts` block (m), which re-runs the old predicate as the floor). The 0.25 / 0.4 / 0.85 gates are unchanged. `rrf.ts` gained optional per-list weights (defaults 1 = SQL parity); `hybrid.ts::DEFAULT_LANE_WEIGHTS` = lexical 1, trigram 0.7, dense 1 (exact pins are placed first by construction; trigram is the fallback lane and should not outweigh an exact lexeme match at equal rank; dense is unmeasured, P0-12). `retrieval/queryExpansion.ts` expands the corpus-lane query from `planner/intake.ts::CONCEPT_TABLE` (same firing rule as the planner), searched as OR-alternatives at half a query lexeme's IDF; an expansion lexeme can re-rank but never admit a passage on its own; the pipeline result reports `expansion:{concepts,terms,weight,limit}` and `laneWeights` additively. `retrieval/turkishAnalyzer.ts` now owns the stemmer, dotted/dotless-I folding and final-consonant softening used by `answer/coverage.ts` (re-exported, unchanged) and `planner/intake.ts`; there is no Python stemmer to mirror, so no parity fixture was touched. **Observed on the SYNTHETIC fixture only, no number claimed:** for the one query the suite pinned (`haksız fiil tazminatı`), length normalization moved the note whose text IS the query to rank 1 of the lexical lane, which is what the fixture was authored to expect — all three lexemes have equal df there, so IDF did not separate them. Nothing here has been measured on a gold set | verified (executed: `npx tsc --noEmit`, `npx vitest run` incl. the scratch-PG store suite) | P0-11 (synonym lane now exists, unmeasured), P0-19 (the floor is unchanged; the weighted path is additive), ADR-007 | on the adjudicated gold set — re-measure ranking AND the 0.7 trigram weight before any claim |
| 2026-09-10 | **W18 — related-search ranking is now a scored, explainable heuristic** | `compareRelatedRows` orders by an additive `relevance.score` (weights in `RELEVANCE_WEIGHTS`: subject agreement, query agreement, Turkish-lowercased lexeme overlap of the run queries with title+snippet, merci weight, BANDED recency — bands so that a date cannot reorder a tie group the source itself ranked, the W17 defect) and falls back to the W17 keys as tie-break; rows without a score sort exactly as before. Every response carries `ranking:"colleX-heuristic"`, the five signals and the matched lexemes per row, and a note saying the model was never measured on real decisions. `RELATED_RANKING_DISCLAIMER` and `SEMANTIC_RERANK_DISCLAIMER` are unchanged (console tests pin them). Query generation folds same-lexeme / contained / near-identical candidates (`NEAR_DUPLICATE_JACCARD`) and reports them in `collapsedQueries[]` so the cap is spent on distinct searches. The semantic rerank embeds up to `MAX_EMBED_WINDOWS_PER_DOCUMENT` overlapping `MAX_EMBED_CODE_POINTS` windows per full text (`codePointWindows` in `research/semanticPassages.ts`) and takes the maximum window cosine, so reasoning past the head is no longer invisible; the caller may widen the head with `rerankDocuments` (clamped to `MAX_RERANK_DOCUMENTS`). All fail-closed rules and the local-E5 label suppression are re-asserted with fakes. **Relevance quality on real law remains unmeasured**; nothing here is an isabet claim | verified (executed: `tsc --noEmit`, vitest on `tests/sources`, `tests/retrieval`, `tests/research`, `tests/pipeline/console.test.ts` with `COLLEX_NO_DOTENV=1`) | `sources/relatedSearch.ts`, `sources/searchService.ts`, `sources/routes.ts`, `retrieval/semanticRerank.ts`, `research/semanticPassages.ts`; tests `sources/relatedRelevance.test.ts`, `retrieval/semanticRerankWindows.test.ts` | when a gold set of real related decisions exists — the weights are chosen, not fitted |
| 2026-08-27 | **`'infinity'` is finite in PostgreSQL** | `upper_inf(tstzrange(now(),'infinity','[)'))` is **false**: `'infinity'` is a finite `timestamptz` value, not an unbounded range endpoint. The temporal model's close-on-append trigger and its "one open version" partial index were therefore dead code from the start | verified (executed, PG 18.1) | ADR-012; migrations `020000`, `100000` | no — language semantics |
| 2026-08-27 | **`websearch_to_tsquery` ANDs every token** | A 7–20 token legal question becomes a fully conjunctive tsquery that a one-or-two-sentence chunk cannot satisfy. Measured on the fixture corpus: the TCK m.157 question produced **0 rows** conjunctively and **33 rows** with the same lexemes ORed; the lane returned 0 hits on all 25 gold questions while every surrounding link (config, generated column, normalizer version, index) was healthy | verified (executed) | ADR-007 | no — operator semantics; but the 0.25 floor **must** be re-measured on a real corpus |
| 2026-08-27 | **RLS does not inherit** | Enabling row security on a parent table grants no protection to child tables that carry their own SELECT grant. Reproduced with a non-superuser probe role holding exactly the grants the migration issued | verified (executed) | ADR-011; migration `060000` | no |
| 2026-08-27 | **pgvector is not installable on this machine** | No Windows SDK for a source build and no Docker. Consequence: migrations `080000`/`090000` are pglast-syntax-validated only and **never executed**; the dense lane is a `NoopDenseLane` in every measurement | verified (executed / attempted) | ADR-004, ADR-005; RISKS #2 | when a pgvector-capable target exists |
| 2026-08-27 | **Turkish snowball FTS: real gain, not a solved problem** | Measured on PG 18.1: `to_tsvector('turkish','dolandırıcılığın cezası dolandırıcılık')` unifies the genitive and bare forms under `dolandırıcılık`, while `simple` keeps them distinct — recall 1.00 vs 0.00 for that query on the fixture corpus. **Known limits, also measured:** `zamanaşımı` → `zamanaş` but `zamanaşımının` → `zamanaşım` (two stems, no match), and neither config folds dotted/dotless I (`ıstanbul` vs `istanbul` share no lexeme; covered by the `pg_trgm` `word_similarity` lane instead) | verified (executed) | P0-11; migration `110000`; keeps `simple` as the A/B baseline | on the adjudicated gold set |
| 2026-08-27 | **`similarity()` is symmetric and unusable at chunk length** | `similarity(search_text, query)` is a set similarity: a 20-character query against a 200-character chunk scores ~0.14 however exactly the phrase occurs. Measured: `'ıstanbul bölge adliye mahkemesi'` vs the İSTANBUL chunk → `similarity` 0.273, `word_similarity` **0.935**. The trigram lane now uses `word_similarity` | verified (executed) | trigram lane in `chunkStore.ts` | on a real corpus |
| 2026-08-27 | **Cross-language reference-parser parity is pinnable** | One fixture file (`evals/fixtures/reference_parity.json`: 28 abbreviations, 100 cases) is asserted by both `tests/contracts/test_parser_parity.py` and `control-plane/tests/parser-parity.test.ts`, so a divergence fails CI in both languages | verified (executed) | ADR-003; abbreviation handling | every CI run |
| 2026-08-26 | Repo audit | Three local checkouts; `yargi-mcp-independent` dirty worktree is the substantive fork (54/55 tools, fail-closed credentials); no local commits since 2026-07-28 | verified (local evidence) | ADR-001 | on remote fetch |
| 2026-08-26 | Secret incident | Embedded Brave/Tavily fallbacks in committed history (cb318fa, c3bc9e1, 7f78f87, e900bc0/e26f09a); upstream public on GitHub+PyPI | verified (local git evidence) | incident record, ADR-001, CI gates | after rotation |
| 2026-08-26 | Offline smoke | 54 tools, shared limiter, disabled-key paths, auth, fake semantic rerank — PASS | verified (executed) | PLAN Phase 0 gate | every CI run |
| 2026-08-26 | Bedesten rate limit | ~10 req/30s per source IP measured 2026-05-08; 429 with Retry-After: 30; in-process bucket cap 1, refill 6.5 s, max wait 65 s | verified (code + past measurement) | ADR-006 | at implementation day (upstream may change) |
| 2026-07/08 snapshot | Embedding candidates | voyage-4 (1024, ~$0.06/M at research time), text-embedding-3-large (dimensions=1024, ~$0.13/M), BGE-M3 (1024 self-host), voyage-law-2, Jina v3 (license risk); Nemotron free route: no SLA, 2048 dims > HNSW vector limit | mixed: verified/marketing | ADR-004 | **verify at implementation/release day** (price/availability/license) |
| 2026-07/08 snapshot | pgvector | HNSW `vector` index limited to <= 2000 dims; `halfvec(1024)` halves raw storage | verified (docs at research time) | ADR-004, ADR-005 | verify against actual Supabase runtime (P0-10) |
| 2026-07/08 snapshot | FSEK m.31 / Ek m.8 | Freedom to use officially published legislation/judgments vs. separate sui generis database-producer protection for substantial-investment databases | inference + verified statute reading — **not** a legal opinion | source-register, legal templates | lawyer review (blocked) |
| 2026-08-26 | Competitor claims (Apilex, dejure.ai, Harvey, Legora) | Recorded in brief §4 with evidence classes; product claims are largely marketing-classed | marketing/historical | product priorities only | at release day if used |

## Open P0 questions (brief §15.1) — before coding-complete / production ingestion

Each item: mark answer + evidence when resolved; all are
"verify at implementation/release day" class until then.

| # | Question | Status |
|---|---|---|
| P0-1 | Canonical production source: which repo/branch/image actually deploys? Remote vs. local checkout diff? | OPEN (no remote fetch performed) |
| P0-2 | Secret incident: which commits/images/logs/deployments received the old embedded tokens; are they revoked? | OPEN — **pending user rotation** (incident record) |
| P0-3 | Tool source register: upstream owner, endpoint, Terms, rate limit, cache/full-text/commercial reuse for ~55 tools | OPEN (skeleton in docs/legal/source-register.yaml, all `blocked`) |
| P0-4 | Bedesten terms: is full-text storage, bulk backfill and re-serving explicitly permitted? | OPEN |
| P0-5 | FSEK/database right: public text vs. third-party database/editorial layer boundary | OPEN (lawyer) |
| P0-6 | ColleX role analysis: controller/processor and VERBİS status | OPEN (lawyer; legal-basis-matrix.md) |
| P0-7 | Cross-border transfer: Supabase/LLM/embedding/reranker/OCR/telemetry DPA/no-training/retention/region/subprocessor matrix | OPEN (cross-border-transfer-assessment.md) |
| P0-8 | TBB June 2026 AI guidance: full text, professional-secrecy/human-oversight/verification duties, binding vs. advisory | OPEN (lawyer) |
| P0-9 | Real corpus profile: documents, unique versions, chunks, token distribution; duplicate and parse-failure rates | OPEN (needs sampling run) |
| P0-10 | Supabase runtime: Postgres/pgvector/extension versions, HNSW/halfvec support, region, backup/PITR | OPEN (no live project; ADR-005) |
| P0-11 | Turkish FTS: `simple` vs. trigram vs. synonym vs. Turkish config, measured on gold set | **PARTIAL** — `turkish` vs `simple` and `similarity` vs `word_similarity` measured on the SYNTHETIC fixture corpus (see the 2026-08-27 ledger rows); both configs kept side by side pending the adjudicated gold set. Synonym expansion from the concept table is now WIRED into the corpus lane (2026-09-10 ledger row) but UNMEASURED on any gold set |
| P0-12 | Embedding/reranker bake-off: 1024-d hosted/local candidates, latency/cost/privacy | OPEN (ADR-004 defines the gate) |
| P0-13 | Historical law source: reliable source for historical legislation versions + validity metadata | OPEN |
| P0-14 | Amendment ground truth: how to label amendment/repeal/effectivity relations | OPEN |
| P0-15 | Bedesten fetch perception: is the reported unreliability wrapper, timeout, parser, serialization or upstream? | **PARTIAL** — the instrument now exists and passes offline: `tests/resilience/test_fetch_parity.py` proves `fetch` and `get_bedesten_document_markdown` return identical normalized text and equal `content_sha256` on the same fixture, and `tests/test_facade_contracts.py` proves no facade returns a silent empty list. Attributing the *live* perception still needs a sequential `live_regression_check.py` run |
| P0-16 | Duplicate resolution: canonical/snapshot relation for the same decision on different portals | OPEN |
| P0-17 | Threat model and adversarial corpus | **PARTIAL** — threat-model.md v1 written and every row now cites the test that enforces it; `evals/datasets/adversarial_v1.jsonl` exists and is exercised by `control-plane/tests/security/corpus.test.ts` and the console/pipeline tests. Rows 3, 9, 12 remain phase-gated on the not-yet-built upload lane |
| P0-18 | Gold set v1: two independent lawyer labels + adjudication | OPEN (seed set only; all 40 records `pending`, `annotators: []`) |
| P0-19 | *(new 2026-08-27)* Is the `0.25` lexical coverage floor right on a real corpus? Measured separation on the synthetic corpus is real but narrow (absent-subject questions peak 0.143–0.200; answerable ones 0.25–0.89) | OPEN — blocked on a real corpus; ADR-007, RISKS #5. 2026-09-10: an IDF-weighted minimum-should-match now runs at the same floor as a UNION with the flat rule (never fewer passages); the floor itself was not moved |
| P0-20 | *(new 2026-08-27)* Does the stance marker table hold on real Turkish decisions? It is an auditable phrase table, not a model, and has never been reviewed by a lawyer | OPEN — lawyer review; ADR-008 |

## Blockers requiring user/external action

| Blocker | Smallest user action | Tracked in |
|---|---|---|
| Key rotation (Brave, Tavily) | Revoke + reissue in provider dashboards | incident record §5; RISKS #1 |
| **A pgvector-capable Postgres** | Provide one (Supabase project or another machine) — it cannot be built on this one | RISKS #2; P0-10, P0-12 |
| Lawyer review of docs/legal/* | Engage reviewing lawyer | source-register `legal_review`; RISKS #7 |
| Live Supabase project | Provision project + share config (**no Supabase MCP, ever**) | ADR-005; SUPABASE-SETUP.md |
| Lawyer-adjudicated gold set | Schedule a labeling session for two independent lawyers | P0-18; RISKS #4 |
| Remote repo state | Permit/perform `git fetch` comparison | P0-1 |
