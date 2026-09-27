# Architecture Decision Records

Format per record: context, candidates, decision, rationale/evidence,
consequences, rollout, rollback. Status values: `accepted`, `proposed`,
`superseded`.

Last updated: 2026-09-11.

Index: ADR-001..006 were taken on 2026-08-26 (repo, runtime split, offsets,
embeddings, Supabase delivery, resilience). ADR-007..015 were taken on
2026-08-27 and record the decisions behind the retrieval, data-integrity and
export work that landed after ADR-006 — several of them forced by defects that
measurement or adversarial review found, which is noted in each record.
ADR-016..021 were taken on 2026-09-02 (wave W12) and record the matter
workspace and durable stores, the question-coverage abstention gate, the
opt-in cloud AI lane, the experimental UDF export, the migration ledger and
the "uploads are exhibits" rule. Their as-implemented evidence lives in
`docs/implementation/waves/W12-{A..F,INTEGRATION}.md`. ADR-022 (the drafting
relevance gate) and the amendments to ADR-016, ADR-020 and ADR-021 were
recorded after the second fix round (`W12-FIX2.md`) by the CLOSEOUT pass.
**ADR-023..028 were taken on 2026-09-02 (wave W14)** and record the
quote-integrity gate, the export modes, `localGuard`, the multi-sentinel
ledger (amending ADR-020 again), the local library and the citation audit.
Their as-implemented evidence lives in
`docs/implementation/waves/W14-L-{EVID,SAFE,SOURCES}.md` and
`W14-L-FIX.md`.
**ADR-029..033 were taken on 2026-09-11 (wave W19)** and record the
evidence-grade Matter intelligence work: physical source provenance
(canonical ranges -> PDF pages, unreadable pages as rows), Matter query
scope resolved server-side, dense-lane provenance hydration as a security
boundary, the exhaustive Matter analysis census with DERIVED processing
coverage, and the trusted-local inference boundary with its LOCAL_ONLY
data policy.

---

## ADR-001 — Canonical repository is `yargi-mcp-independent`

- **Status:** accepted (2026-08-26)
- **Context:** The workspace contains three checkouts: `mevzuat-mcp` (clean,
  HEAD 5671233, 26 tools), `yargi-mcp` (clean, HEAD 0e51ca4, 28/29 tools) and
  `yargi-mcp-independent` (same HEAD 0e51ca4 plus a large dirty worktree).
  All three share HEAD lineage; no local commits since 2026-07-28.
- **Candidates:** (a) continue from upstream `yargi-mcp`; (b) continue from
  standalone `mevzuat-mcp`; (c) make `yargi-mcp-independent` canonical.
- **Decision:** (c) `yargi-mcp-independent` is canonical. The two siblings are
  read-only stale references and must never be a deploy source.
- **Rationale / evidence:** the dirty worktree contains the substantive
  refactor: removal of hardcoded credential fallbacks (fail-closed), the
  mounted `mevzuat_mcp_server.py` app producing the unified 54/55-tool surface,
  the shared `bedesten_rate_limit.py` limiter, `scripts/` offline+live checks,
  and the renamed package `yargi-mevzuat-mcp-independent` v1.0.0 in
  `pyproject.toml`. `yargi-mcp` additionally carries the embedded-token
  security incident in its history (see incident record), disqualifying it as
  a deploy source.
- **Consequences:** the uncommitted dirty state is precious; it is backed up at
  workspace level (`../_baseline-backup/2026-08-26/`) and must not be reverted.
- **Rollout:** all lanes work only in this repo. **Rollback:** none — reverting
  to the siblings would reintroduce the secret incident surface.

---

## ADR-002 — Keep the Python/FastMCP provider layer; add a TypeScript control-plane (no rewrite)

- **Status:** accepted (2026-08-26)
- **Context:** The target product needs planning, budgets, durable research
  state and verification (brief §6.3), which do not belong in the provider
  gateway. The existing Python layer embeds years of parser/upstream knowledge
  across 14 institution modules.
- **Candidates:** (a) rewrite everything in TypeScript; (b) grow the Python
  server into a monolith with planning inside; (c) keep Python/FastMCP as the
  provider gateway and add a separate Node/TypeScript research control-plane.
- **Decision:** (c). Python keeps: upstream calls, schema validation,
  timeouts/rate limits/retries, typed errors, raw snapshots, canonical fetch,
  provider health, backward-compatible tool façade. TypeScript control-plane
  owns: request/context validation, issue decomposition, capability selection,
  budgets/policy, run/step state, evidence assembly, generation+verification,
  streaming, the ColleX API/MCP surface.
- **Rationale:** a rewrite would discard verified upstream behavior (WebForms
  scraping, SSL quirks, null-safety fixes) with zero user value; LLM planning
  and matter memory must not live next to raw upstream credentials/parsers.
- **Consequences:** two runtimes; a shared contract is required — hence the
  Outcome taxonomy mirroring (ADR-006) and offset policy fixtures (ADR-003).
- **Rollout:** control-plane grows behind its own tests (`npm run typecheck`,
  vitest); the 54/55 MCP surface stays untouched. **Rollback:** control-plane
  is additive and can be removed without touching the provider layer.

---

## ADR-003 — Citation offset policy: Unicode code points over NFC canonical text; sha256 over UTF-8

- **Status:** accepted (2026-08-26)
- **Context:** Citations must resolve to exact passages across two runtimes.
  Python indexes strings by Unicode code points; JavaScript strings are UTF-16
  code units; byte offsets differ again (UTF-8). Turkish text is rich in
  multi-byte characters (ğ, ş, İ, ı), so any ambiguity corrupts offsets.
- **Candidates:** (a) UTF-8 byte offsets; (b) UTF-16 code-unit offsets
  (JS-native); (c) Unicode code-point offsets over NFC-normalized canonical
  text.
- **Decision:** (c). Canonical text is NFC-normalized at ingestion; all chunk
  and citation offsets are counted in Unicode code points over that canonical
  text; content hashes are sha256 over the UTF-8 encoding of the same
  canonical text.
- **Rationale:** code points are the only offset unit both runtimes can compute
  losslessly (Python natively; JS via code-point-aware iteration); NFC removes
  composed/decomposed ambiguity before offsets are assigned; sha256/UTF-8 is a
  stable, language-neutral content identity.
- **Evidence:** cross-language fixtures in
  `control-plane/fixtures/offset_policy.json` — the same fixture file is
  asserted by both the pytest suite and the vitest suite, so any divergence in
  offset arithmetic fails CI in both languages.
- **Consequences:** JS code must never use `.length`/`.slice` code-unit
  arithmetic on canonical text without conversion; original (pre-NFC) source
  bytes are preserved separately in raw snapshots.
- **Rollout:** enforced from the first migration/chunker. **Rollback:** none —
  changing the unit later invalidates every stored offset.

---

## ADR-004 — Embedding strategy: free Nemotron-2048 route is baseline only; production is a 1024-d profile bake-off gated on gold-set evals

- **Status:** accepted (2026-08-26); model choice itself **open** pending evals
- **Context:** The current default embedding route is OpenRouter
  `nvidia/llama-nemotron-embed-vl-1b-v2:free` at dimension 2048. The free
  route has no SLA, and 2048 dims exceed pgvector's HNSW `vector` index limit
  guidance (<= 2000 dims) for the planned index type. There is no Turkish
  legal gold set measured against it yet.
- **Candidates (production profile, all 1024-d):** self-hosted `BAAI/bge-m3`;
  hosted `voyage-4`; hosted `text-embedding-3-large` with `dimensions=1024`.
- **Decision:** keep Nemotron-2048 strictly as the prototyping **baseline**;
  run a three-way 1024-d bake-off on the lawyer-labeled gold set
  (Recall@20, nDCG@10, MRR, exact-reference accuracy, contrary-authority
  recall, temporal accuracy, latency, cost) before any production profile is
  fixed. Each model/dimension/config is a separate **embedding profile** with
  its own partition; profiles and their scores are never mixed in one vector
  space. HNSW indexing constraint: vector dimension must be <= 2000 (1024-d
  profiles satisfy this; the 2048-d baseline does not get an HNSW index).
- **Rationale:** eval-before-scale (brief §6.1/№10, §8.1-8.2); privacy lanes
  may route L2/L3 content to the self-hosted candidate while L0 public corpus
  uses hosted — split winners are acceptable, mixed spaces are not.
- **Consequences:** re-embedding cost on profile switch is explicit and
  budgeted (brief §8.3); the schema keys chunks by embedding profile.
- **Rollout:** shadow retrieval + eval-gated profile switch. **Rollback:**
  previous profile partition remains intact until the new one passes gates.

---

## ADR-005 — Supabase delivery this session: files + instructions only; local scratch Postgres for verification

- **Status:** accepted (2026-08-26)
- **Context:** No live Supabase project is provisioned, and the user has
  banned Supabase (and Resend) MCP tool usage in this workspace session. The
  data-plane schema still has to be written and verified now.
- **Candidates:** (a) provision a live Supabase project; (b) write migrations
  untested; (c) ship migrations + setup instructions as files and verify them
  against a local scratch PostgreSQL 18 instance.
- **Decision:** (c). `supabase/migrations/*.sql` is authored and parse-checked
  in CI (pglast) and applied to a local scratch PG18 (port 55432, see
  RUNBOOK) via `scripts/db_local_check.py`. No remote DB calls of any kind.
- **Rationale:** honors the hard rule (no Supabase MCP), still gives executable
  evidence that migrations reset/upgrade cleanly.
- **Consequences:** pgvector behavior on the actual Supabase runtime (versions,
  HNSW/halfvec support, region, PITR) remains an open P0 research item and a
  listed risk until a live project exists.
- **Rollout:** when the user provisions Supabase, apply the same migration
  chain from zero. **Rollback:** migrations carry paired down/reset paths and
  are tested for clean re-apply locally.

---

## ADR-006 — Resilience policy: single retry owner in the limiter; endpoint-keyed breaker; bulkhead; typed Outcome taxonomy

- **Status:** accepted (2026-08-26)
- **Context:** Nine legislation tools plus the court family share one Bedesten
  upstream and one process-wide token bucket; the common-mode failure profile
  (brief §3.6) demands containment, not magic: no retry storms, no silent
  empty results, typed observable failures.
- **Candidates:** (a) per-tool ad-hoc retries; (b) library-level retries in
  every client; (c) a single retry owner in the shared limiter plus an
  endpoint-keyed circuit breaker and a bulkhead, with a typed Outcome
  taxonomy at the contract boundary.
- **Decision:** (c). Rules:
  - Retry is owned by exactly one layer — the shared rate limiter performs the
    single Retry-After-aware 429 retry; nested retries are forbidden.
  - Circuit breakers key on the real upstream endpoint/failure domain, never
    on the tool name (nine aliases = one breaker key).
  - A bulkhead separates court and legislation traffic so neither starves the
    other.
  - Failures surface as the typed Outcome taxonomy
    (`ok / partial / error` with `FailureKind` = RATE_LIMITED, TIMEOUT,
    UNAVAILABLE, INVALID_REQUEST, UNAUTHORIZED, PARSER_ERROR, NOT_FOUND),
    defined in `legal_contracts/outcomes.py` and mirrored 1:1 by
    `control-plane/src/capabilities/types.ts`.
  - Upstream failure is never returned as an empty list; stale cache results
    are `partial` with an explicit freshness warning.
- **Rationale:** brief §6.6 rules; single-owner retry keeps the worst case at
  one extra request per call; endpoint keying keeps one Bedesten outage from
  producing nine independent breaker states.
- **Consequences:** the in-process limiter is a single-worker constraint;
  multi-replica quota needs Postgres lease/token state or an established
  distributed limiter before scaling out (tracked in RISKS.md).
- **Rollout:** taxonomy first (additive fields on existing responses), then
  breaker/bulkhead behind contract regression tests for all nine aliases.
- **Rollback:** breaker/bulkhead can be disabled by config; the taxonomy is
  additive and stays.
- **Amendment 2026-08-27 (admission epochs, deadline-bounded bulkhead).** The
  breaker as first built could be corrupted by a *stale outcome*: a call
  admitted under one breaker generation could report its success or failure
  after the breaker had already transitioned, so a slow failure from the
  previous CLOSED period could re-open a breaker that a probe had just
  closed. Every admission is now tagged with the breaker's state generation
  (`epoch`) and an outcome whose epoch no longer matches the current
  generation is dropped rather than counted
  (`bedesten_rate_limit.py`, `_Admission.epoch` / `generation`). The bulkhead
  is likewise deadline-bounded instead of unbounded-queueing, so a saturated
  lane fails fast and typed rather than parking callers indefinitely.
  Evidence: `tests/resilience/test_breaker_epochs.py`,
  `tests/resilience/test_bulkhead.py`,
  `tests/resilience/test_breaker.py`, `tests/test_facade_contracts.py`
  (the failure-contract matrix over `search_bedesten_unified`,
  `get_bedesten_document_markdown`, `fetch`, Deep-Research `search`,
  `search_kanun`) — all inside the 1046-test pytest run.
  The Deep-Research `search` facade specifically no longer returns a silent
  empty list on upstream failure; that is asserted in
  `tests/test_facade_contracts.py`.

---

## ADR-007 — Lexical lane uses "minimum should match" coverage, not conjunctive `websearch_to_tsquery`

- **Status:** accepted (2026-08-27)
- **Context:** The measured fixture-corpus baseline of 2026-08-27 reported
  `Hits by lane: exact=36, lexical=0, trigram=5`. The lexical lane contributed
  **zero** hits on all 25 gold questions, and contrary-authority recall was
  `0.0000`. The cause was not a broken index: `search_tsv_tr` is a STORED
  GENERATED column and was populated on 55/55 rows, the `turkish` config
  existed on the build, index side and query side already used the same
  config, `normalizer_version` was `trnorm-v1` everywhere, and the lane never
  recorded a failure. The defect was the *operator*:
  `websearch_to_tsquery` AND-joins every token it is given, so a 7–20 token
  legal question becomes a fully conjunctive tsquery that a one-or-two-sentence
  chunk can never satisfy. Measured: the question
  `"5237 sayılı Türk Ceza Kanunu m. 157 uyarınca dolandırıcılık suçunun temel
  şeklinin cezası nedir?"` produced 0 rows conjunctively and 33 rows with the
  same lexemes ORed.
- **Candidates:** (a) keep `websearch_to_tsquery` and rely on the dense lane to
  cover natural language — impossible here, pgvector is absent on this machine
  and the dense lane is a `NoopDenseLane` (RISKS.md); (b) `plainto_tsquery`,
  which is still a
  pure AND; (c) OR the query lexemes and rank by `ts_rank_cd` with no floor —
  every chunk sharing one stopword-ish lexeme becomes a candidate; (d) OR the
  lexemes for candidate generation and require the chunk to cover at least a
  fraction of them ("minimum should match").
- **Decision:** (d). `mode: "coverage"` is the new default in
  `control-plane/src/store/chunkStore.ts`. The tsquery is built from the
  lexemes of `to_tsvector(<config>, <query>)` — i.e. from the **index-side**
  analysis of the query itself, which makes stemmer parity structural instead
  of something two code paths have to agree about — those lexemes are ORed for
  index-usable candidate generation, and a chunk is kept only if it covers at
  least `minCoverage` of them. Ranking stays `ts_rank_cd`. The old behavior
  survives as `mode: "strict"`, both as the measured A/B baseline and because
  a caller who types websearch operators (quoted phrase, leading `-`, `or`)
  means them.
- **The 0.25 constant is an idiom, not a fitted optimum.**
  `DEFAULT_LEXICAL_MIN_COVERAGE = 0.25` is a round quarter (ceil: a 4-lexeme
  question needs 1 lexeme, a 20-lexeme question needs 5). What the fixture
  corpus *measures* about it is only the separation it has to live in, and
  that separation is reported rather than tuned to: the four questions whose
  subject matter is absent from the corpus peak at 0.200 / 0.200 / 0.200 /
  0.143 coverage, while every question the corpus can answer reaches
  0.25–0.89. A quarter sits inside a real gap — but a **narrow** one, and that
  gap is a property of an eight-file synthetic corpus, not evidence about
  Turkish law. **This constant must be re-measured on a real corpus before it
  is treated as validated**, and it is a listed risk (RISKS.md). Callers
  already override it per query (ADR-008's pass runs deliberately lower).
- **Evidence:** post-fix run of `scripts/run_evals.py` (exit 0) —
  the lexical lane went from **0 hits on all 25 gold questions** to being a
  leading contributor; contrary-authority recall 0.0 → 1.0; abstention
  precision 57.1% → 100% with abstention recall held at 100%; Recall@10,
  nDCG@10 and MRR all rose from 0.7302 / 0.7403 / 0.8190; zero-hit queries
  7 → 4 (exactly the four `no_answer` queries). Current point values are
  deliberately not copied here — read them from the report. Report:
  `evals/reports/fixture_baseline_2026-08-27.{json,md}`; historical pre-fix
  figures and the diagnosis are preserved in `evals/reports/BASELINE.md` §1.5
  and §1.6. Unit coverage:
  `control-plane/tests/quality/retrievalQuality.test.ts`,
  `control-plane/tests/store/retrieval.test.ts`.
- **Consequences:** the lexical lane now competes with the exact-pin lane in
  RRF, so ranking is no longer "did the query contain a parseable citation".
  A coverage floor is a recall/precision knob that a real corpus will move.
- **Rollout:** default flipped to `coverage`; `strict` retained per call.
  **Rollback:** pass `mode: "strict"` — one option, no schema change.

---

## ADR-008 — Contrary authority: symmetric divergence completion, executed in retrieval

- **Status:** accepted (2026-08-27)
- **Context:** Brief §10.2 makes a contrary-authority query mandatory for every
  material conclusion. `control-plane/src/planner/contrary.ts` generated the
  query *lanes* but nothing in the corpus retrieval path executed them, and the
  2026-08-27 baseline measured contrary-authority recall at `0.0000`.
  Similarity ranking is the problem, not an accident of it: retrieval that
  ranks by closeness to the question returns the passages that agree with its
  framing, while the decision pointing the other way uses different words and
  loses.
- **Candidates:** (a) leave it to the planner/LLM — unbounded, unmeasurable,
  and it fails exactly when the model already believes the majority view;
  (b) pick the top-ranked passage as "primary" and run a hand-built opposite
  query for it; (c) after fusion, classify the outcome polarity of the
  retrieved judicial passages and run a second, lower-floor lexical pass that
  admits any judicial passage whose outcome **differs** from one already
  present.
- **Decision:** (c), and **symmetric on purpose**. `completeDivergence` in
  `control-plane/src/retrieval/hybrid.ts` completes the split whichever side
  surfaced first, so whether the reader is told about a disagreement does not
  depend on which of two disagreeing decisions happened to rank higher — that
  is an artifact of wording. Polarity comes from
  `control-plane/src/pipeline/stance.ts`, an auditable marker table over the
  operative Turkish phrasings (`unsurları oluşmadığ…`, `beraat`,
  `davanın reddine`, … vs. `suçu oluşturduğ…`), which reads only the exact
  retrieved passage and reports which markers fired. Two rules bound it:
  **legislation is never contrary authority** (a statute states a norm; it
  does not come out either way), and a `NORM_CONTENT` question — "what does
  the provision say?" — skips the pass entirely
  (`control-plane/src/pipeline/questionIntent.ts`), because a decision holding
  a rule inapplicable to some facts is not authority against the rule's text.
  When both a negative and an affirmative marker fire the passage is
  classified NEGATIVE: over-surfacing conflict costs a lawyer one read,
  under-surfacing it costs the case.
- **Evidence:** contrary-authority recall 0.0 → 1.0 (n=3) in
  `evals/reports/fixture_baseline_2026-08-27.md`; demo scenario S3
  (`node control-plane/scripts/demo.mjs`, exit 0, S3 CONTRARY 7/7) asserts both
  sides land in the evidence set, the negative one classified `contrary`, at
  least one claim `CONFLICTING_AUTHORITIES`, and the answer `QUALIFIED` rather
  than finalized. Unit coverage: `control-plane/tests/planner/contrary.test.ts`,
  `control-plane/tests/quality/retrievalQuality.test.ts`,
  `control-plane/tests/answer/pipeline.test.ts`.
- **Consequences:** an extra database round trip per qualifying query; the
  marker table is Turkish-specific and needs review by a lawyer before it is
  trusted on real case law — it is deliberately a table a reviewer can read,
  not a model.
- **Rollout:** enabled by default; the pass is skipped for `NORM_CONTENT`
  questions and when no classifiable judicial passage is present, and its
  outcome is always reported in a typed `DivergenceReport` (never a silent
  no-op). **Rollback:** disable by setting the divergence limit to 0; the
  primary ranking is untouched.

---

## ADR-009 — One-hop outbound citation expansion, resolved as-of the question date

- **Status:** accepted (2026-08-27)
- **Context:** A passage saying "5237 sayılı Türk Ceza Kanununun 157 nci
  maddesi" is a pointer. The 2026-08-27 baseline showed the concrete failure:
  `fx-amend-001` retrieved the amending provision (7999 m.1) but not its
  target (TCK m.157 v2) — a reader given the amending provision without the
  amended text has half an answer.
- **Candidates:** (a) nothing — make the reader run a second query;
  (b) unbounded graph walk over `legal.document_relations`;
  (c) one hop, outbound only, seeded from the top hits, capped.
- **Decision:** (c). `control-plane/src/retrieval/hybrid.ts`
  (`outboundCitations` + `expandByCitation`, defaults `citationSeedCount: 5`,
  `citationExpansionLimit: 6`). Each seed passage is re-parsed with the **same
  reference parser used on the query**; a legislation reference is paired with
  the first article reference that follows it before the next legislation
  reference — which is how a Turkish citation reads, and which is why the
  chunk's own `MADDE 1 -` heading (it *precedes* the citation) is never
  mistaken for the target article. The pair is then resolved through the
  ordinary as-of-filtered pin lookup, so **the target arrives in the version
  in force on the question's date, not the version current today**.
  Self-citations are dropped.
- **Rationale:** one hop is the hop a lawyer would make by hand; it is
  bounded, explainable and attributable — every expanded hit carries a
  `CitationProvenance` naming the chunk whose text carried the citation.
  Unbounded expansion would make the evidence set unauditable and the budget
  unbounded.
- **Consequences / containment:** expansion is an *enrichment*. A failure in
  it is contained exactly like a lane failure — recorded and skipped, never
  raised — so an expansion problem can never take down a query that already
  had answers.
- **Evidence:** `control-plane/tests/quality/retrievalQuality.test.ts`,
  `control-plane/tests/store/retrieval.test.ts`; end to end in the temporal
  scenario S4 of `control-plane/scripts/demo.mjs` (exit 0, 7/7).
- **Rollout:** default on with the caps above. **Rollback:** set
  `citationSeedCount` or `citationExpansionLimit` to 0.

---

## ADR-010 — Deterministic tie-breaks on ingest-stable identity, never on a random UUID

- **Status:** accepted (2026-08-27)
- **Context:** Every ranking lane has ties (equal `ts_rank_cd`, equal
  `word_similarity`, equal pin priority). Left to the database, the tie order
  is whatever the plan happens to produce; ordering by the chunk's primary key
  is worse still, because those keys are random UUIDs regenerated on every
  ingest. Either way, two runs over the same corpus can return two different
  orders — and this project's eval harness treats a ranking change as a defect
  signal, so a non-deterministic tie makes every metric noisy and makes
  "abbreviation-form parity" (identical top-10 for two spellings of one
  citation) unprovable.
- **Candidates:** (a) leave ties to the planner; (b) order by `chunk.id`
  (random UUID); (c) order by an ingest-stable composite of the document's
  own identity.
- **Decision:** (c). Every lane's `ORDER BY` ends with the same stable tail —
  `d.source asc, d.external_id asc, c.ordinal asc, c.id asc`
  (`stableTieBreak` in `control-plane/src/store/chunkStore.ts`, applied by the
  lexical, trigram and pin lanes). `source` + `external_id` is the logical
  document identity that ingestion resolves and reuses across runs
  (`ingestion/identity.py`: `(source, external_id)` public /
  `(tenant_id, source, external_id)` tenant-scoped, backed by partial unique
  indexes in migration `20260826020000`); `ordinal` is the chunk's position in
  the document. The trailing `c.id` is only a last-resort total order.
- **Rationale:** the ordering key must survive a re-ingest, because the eval
  harness re-ingests before every measurement and then joins database UUIDs
  back to stable unit ids (`<external_id>@<version_label>#<path>`) to score.
  A random-UUID tie-break would make the gold-set numbers depend on which
  ingest produced them.
- **Evidence:** abbreviation-form parity 100.0% over 4 query pairs
  (identical top-10 ranking for `TCK m.157` and
  `5237 sayılı Türk Ceza Kanunu m.157`) in
  `evals/reports/fixture_baseline_2026-08-27.md`; the same run reproduced its
  metric table on a fresh recreate (`scripts/run_evals.py`, exit 0).
  Unit coverage: `control-plane/tests/store/retrieval.test.ts`.
- **Consequences:** ties resolve toward alphabetically earlier sources — an
  arbitrary but *stated and stable* bias, which is the point.
- **Rollout:** applied in every lane at once (a partially stable order is not
  stable). **Rollback:** none wanted; removing it re-introduces measurement
  noise.

---

## ADR-011 — RLS resolves tenancy through the owning document (P0 cross-tenant content leak)

- **Status:** accepted (2026-08-27) — fixes a **P0 defect found by adversarial
  review**
- **Context:** Migration `20260826060000_rls.sql` enabled row security on
  `legal.documents` **only**, while its grants block handed the `authenticated`
  role a plain `SELECT` on `legal.document_versions`, `legal.chunks` and
  `legal.document_relations`. Those three tables had no row security at all,
  so the documents policy protected nothing but the metadata row: any
  authenticated session, of any tenant, could read another tenant's
  `document_versions.canonical_text` and `chunks.original_text` — the **full
  text** of the other tenant's documents — by selecting from the child table
  directly and never mentioning `legal.documents`.
  `document_relations` leaked the tenant's citation graph the same way. For a
  product whose private corpus is covered by avukat sırrı, this is the worst
  class of defect the threat model names (row 3).
- **Candidates:** (a) revoke the child-table grants and force all reads
  through a view or security-definer function — moves the risk to whoever
  writes the next query; (b) denormalize `tenant_id` onto every child table
  and police it per table — two sources of truth for one fact, and a drift bug
  becomes a leak; (c) enable RLS on all three child tables with SELECT
  policies that resolve tenancy **through the owning document**.
- **Decision:** (c). Versions join to `legal.documents`; chunks join through
  `legal.document_versions` to `legal.documents`; a relation requires **both**
  endpoints to be visible. Public rows stay readable by everyone.
  `service_role` / table owner / the ingestion role continue to bypass RLS, so
  the pipeline is unaffected. Tenancy itself resolves through
  `app_private.current_tenant_id()` (JWT claim → `request.jwt.claims` →
  local `app.tenant_id` GUC), all reads `missing_ok`, so **no tenant context
  yields NULL and tenant-scoped rows become invisible** — fail-closed.
- **Rationale:** tenancy is a property of the logical document, and there is
  exactly one place that fact lives. A policy that re-states it per table can
  drift; a policy that joins to it cannot.
- **Evidence:** reproduced on the local scratch database with a non-superuser
  probe role holding exactly the grants in question, then fixed and pinned by
  two regression tests that fail if the policies are removed:
  `scripts/db_local_check.py` check **c9** ("RLS on versions/chunks/relations
  (P0 leak regression)") — asserts tenant B's `canonical_text` and
  `original_text` are unreadable by tenant A, public rows still readable,
  cross-tenant relation hidden — and `tests/ingestion/test_rls_leak.py`.
  Run of 2026-08-27: `scripts/db_local_check.py` → **17/17 PASS, exit 0**.
  The retrieval-level indicator is separately gated: `cross_tenant_leak
  _indicators == 0` is a hard gate in `scripts/run_evals.py` (exit 0).
- **Consequences:** nothing was ever applied to a live database, so the fix
  was made **in place** in the migration rather than as a follow-up migration;
  a deployment that had already applied the old file would need a corrective
  migration instead. This is stated in the migration header and in
  `docs/implementation/SUPABASE-SETUP.md`.
- **Rollout:** first apply of the chain. **Rollback:** none — reverting
  re-opens the leak.

---

## ADR-012 — Temporal close-on-append is enforced in SQL, not in application code

- **Status:** accepted (2026-08-27) — fixes a **P0 defect found by adversarial
  review**
- **Context:** System-versioning was **non-functional**. `system_period`
  defaulted to `tstzrange(now(), 'infinity', '[)')`, and `'infinity'` is a
  *finite* `timestamptz` value in PostgreSQL, so `upper_inf()` was always
  false. Consequently the close-on-append trigger's guard never fired, the
  unique partial index "at most one open version per document" covered zero
  rows, and every appended version stayed "current" forever. Nothing closed
  the previous version — the temporal model existed on paper only.
- **Candidates:** (a) have each writer close the previous version before
  appending; (b) close it in the ingestion pipeline only; (c) fix the default
  to `tstzrange(now(), null, '[)')` and keep one authoritative mechanism in
  the **database** — a `BEFORE INSERT` trigger plus a declarative unique
  partial index.
- **Decision:** (c). `20260826020000` now defaults the upper bound to `null`;
  `20260826100000_version_transitions.sql` closes, inside the appending
  transaction, (1) every other open `system_period` of the same document at
  the new row's lower bound, and (2) every earlier-starting open
  `effective_period` at the new row's effective start — "the previous
  consolidated text was in force until the amendment took effect".
  `document_versions_one_current_uq` backs the invariant declaratively.
- **Rationale:** the invariant "at most one open system period per document"
  must hold no matter which path appends a version (pipeline, backfill, manual
  SQL), so it belongs to the schema; the trigger runs in the same transaction
  as the insert, so close + append are atomic by construction.
- **What it deliberately does NOT do:** it leaves a row alone when the new row
  has no or a bounded `effective_period` (the caller stated the window), when
  the older row has no `effective_period` (validity unknown — guessing would
  fabricate legal metadata), and when the older start is not earlier
  (a backdated or same-day append). That last case falls through to the
  `document_versions_effective_no_overlap` EXCLUDE constraint and **fails
  loudly**, because deciding which of two texts in force on the same day wins
  is an editorial call, not a trigger's.
- **Evidence:** `scripts/db_local_check.py` check **c10** ("system_period
  upper_inf + one open version (P0)") explicitly proves the old `'infinity'`
  default false, that the trigger closes the previous version, and that
  exactly one open row is enforced; check **c11** proves the effective-period
  overlap rejection. `tests/ingestion/test_versioning.py` covers it from the
  Python side. Run of 2026-08-27: **17/17 PASS, exit 0**. End to end: demo
  scenario S4 (`node control-plane/scripts/demo.mjs`, exit 0, 7/7) asks the
  same question either side of the synthetic 7999 amendment and gets two
  different answers, each citing the version in force on its own date.
- **Consequences:** appends are slightly heavier (one UPDATE); clock-skewed
  appends raise from the `tstzrange` constructor, which is the correct loud
  failure.
- **Rollout:** fixed in place (nothing has ever been applied to a live
  database). **Rollback:** none — the previous state was silently wrong.

---

## ADR-013 — Chunk non-overlap within a version is a citation-provenance requirement, not a storage nicety

- **Status:** accepted (2026-08-27)
- **Context:** Chunking strategies routinely use overlapping windows to
  improve embedding recall. This product's central claim is that a citation
  resolves to *the* passage of *a* document version. If two chunks of one
  version cover overlapping code-point spans, the same sentence has two
  citable identities, two hashes and two provenance records, and "which
  passage supports this claim" stops having one answer.
- **Candidates:** (a) allow overlap and de-duplicate at citation time —
  pushes an integrity requirement into presentation logic, where it can be
  forgotten; (b) allow overlap and pick a winner by rank — non-deterministic;
  (c) forbid overlap inside a version at the schema level.
- **Decision:** (c). `legal.chunks` carries the EXCLUDE constraint
  `chunks_no_overlap_within_version` (GiST) in migration
  `20260826030000_chunks_relations.sql`; chunks of one version tile the text
  without overlap. Recall that overlap would have bought is recovered by the
  retrieval lanes (ADR-007 coverage mode, ADR-009 citation expansion,
  ADR-008 divergence completion) rather than by duplicating citable text.
- **Rationale:** offsets are the identity of a citation (ADR-003). An
  integrity rule that the database can refuse is worth more than one every
  writer must remember.
- **Evidence:** `scripts/db_local_check.py` check **c12** ("chunk non-overlap
  decision + normalizer_version") — adjacent spans accepted, overlapping span
  rejected, other versions unaffected, `normalizer_version` defaults to
  `trnorm-v1`; `tests/ingestion/test_chunking.py`. Run of 2026-08-27:
  **17/17 PASS, exit 0**. Downstream, the invariant is what makes the
  `quote_hash_integrity == 100%` gate meaningful (every evidence record
  passes offset + quote + quote-hash + content-hash; `scripts/run_evals.py`,
  exit 0).
- **Consequences:** a chunker that wants overlap for a dense lane must instead
  key overlapping windows under a separate embedding profile; it may not write
  them into `legal.chunks`.
- **Rollout:** enforced from the first migration. **Rollback:** none —
  dropping it invalidates the citation-identity claim.

---

## ADR-014 — One evidence-bundle contract (`collex.answer.evidence-bundle/v1`) shared by TypeScript and Python

- **Status:** accepted (2026-08-27)
- **Context:** The answer pipeline is TypeScript; the lawyer-facing DOCX /
  Markdown exporter is Python. Two runtimes formatting "the same" citation
  from two hand-maintained shapes is how an export ends up plausible instead
  of verifiable — a field silently defaulted on the reading side is enough.
- **Candidates:** (a) let the exporter read the internal `AnswerResult`;
  (b) define a second export-specific schema and map between them; (c) define
  one wire contract that the API *emits* and the exporter *consumes*, strictly
  on both ends.
- **Decision:** (c). `collex.answer.evidence-bundle/v1` is produced by
  `control-plane/src/answer/renderer.ts` (surfaced by
  `control-plane/src/api/server.ts` as
  `GET /v1/answers/{runId}/evidence-bundle` and `POST /v1/evidence-bundle`,
  documented in `control-plane/src/api/openapi.yaml`) and consumed by
  `export/bundle.py`. The Python side is deliberately strict: a field that is
  missing, of the wrong type, or carrying an unknown enum value raises
  `export.errors.BundleFormatError` instead of being defaulted.
- **The exporter refuses to export an unverifiable citation.** Before any file
  is written, every quote is re-verified against its own SHA-256 and its
  code-point span; if a single citation fails, **nothing is written** and the
  CLI exits **2** (exit 1 = usage/format error, exit 0 = written and
  self-verified). The DOCX path writes to a temporary file, verifies, and only
  then `os.replace`s it into place. When the bundle carries the optional
  `texts` map, verification is upgraded from "the quote hashes to its recorded
  digest" to the full chain "the canonical text hashes to `contentSha256`
  **and** that code-point span really yields this exact quote".
- **Rationale:** the same reason offsets are pinned by one cross-language
  fixture (ADR-003): a contract asserted by both sides fails loudly at the
  seam instead of quietly at the reader.
- **Evidence:** run of 2026-08-27 on the demo's S1 bundle —
  `python -m export.cli --bundle <bundle> --out kanit.md --format md`
  → exit **0**, "8 alıntının tamamı doğrulandı; 8 tanesi kanonik metin +
  offset karşılaştırmasıyla"; the same for `--format docx` → exit **0**.
  Tests: `tests/export/test_verify.py`, `tests/export/test_cli.py`,
  `tests/export/test_markdown_export.py`, `tests/export/test_docx_export.py`
  (inside the 1046-test pytest run, exit 0), and
  `control-plane/tests/answer/renderer.test.ts` /
  `control-plane/tests/pipeline/answerService.test.ts` on the producing side.
  Format reference: `docs/implementation/EXPORT.md`.
- **Consequences:** the contract is additive-only; a new optional field must
  be ignorable by an older reader. Synthetic-corpus bundles carry
  `synthetic` / `syntheticNotice`, and every human-visible surface of the
  export then says `SENTETİK`.
- **Rollout:** `v1` is in use on both sides. **Rollback:** none — the
  alternative is two divergent shapes.

---

## ADR-015 — Citator lane: amendment relations are a stored EDGE index, followed in both directions

- **Status:** accepted (2026-08-27). Recorded here from the implementation and
  its own design headers; it landed after ADR-014 and closes the last
  measured temporal failure.
- **Context:** One gold query — *"which torba amendment raised the base
  penalty for dolandırıcılık, and when did it commence?"* — asks for two
  passages **no lexical mechanism can reach**. The amending provision
  ("…157 nci maddesinin birinci fıkrasında yer alan '…' ibaresi '…' şeklinde
  değiştirilmiştir") names neither the subject matter of the article nor the
  words a reader would use to ask about it, and the amended article's own text
  says nothing about having been amended. The two share almost no vocabulary,
  so no amount of stemming, coverage tuning (ADR-007) or fuzzy matching
  connects them — and the dense lane is inert here anyway. Retrieval was not
  the missing piece; **the edge was.**
- **Candidates:** (a) more aggressive text matching — cannot work, the
  vocabulary overlap is not there; (b) resolve amendments at query time by
  parsing the amending text on demand — repeats expensive work per query and
  has no place to record the resolver's uncertainty; (c) write the edges at
  **ingest** into `legal.document_relations` and follow them at query time.
- **Decision:** (c). `ingestion/relations.py` derives edges from
  `structure_hints.amendments` on the amending document and resolves each
  target through the existing `legal_reference/resolver.py`
  (`AmendmentTargetResolver`) over a database-backed `SearchPort`.
  `control-plane/src/store/chunkStore.ts :: citatorLookup` and
  `runCitatorLane` in `control-plane/src/retrieval/hybrid.ts` follow those
  edges in **both** directions — inbound ("which instruments amend this
  provision?") and outbound ("which provisions does this passage amend?") —
  as a fifth retrieval lane named `relation`.
- **A structure hint is a CLAIM, not a resolution.** The hint names a target
  number; the number still has to match a document that actually exists in
  this database. The resolver's decision is stored as
  `resolution_status`: `resolved` (one candidate above threshold, with
  margin), `ambiguous` (several within the margin), `manual` (the resolver
  abstained). `confidence`, `resolver_version` and the verbatim hint travel
  with every row, so a reviewer can see what the machine was looking at.
- **What keeps the lane from manufacturing hits** (this is the part that
  matters for a citation-first product):
  - it is seeded **only** from passages the primary lanes already ranked, so a
    question the corpus cannot answer produces no seeds and therefore no
    hits — **the abstention guarantee is unchanged by construction, not by
    tuning**;
  - it follows **only** `resolved` edges. An ambiguous target is one nobody
    confirmed, and a citator that cited it would be inventing an authority
    chain;
  - both ends come back as real passages under the ordinary as-of visibility
    filter, so an instrument not yet in force on the question's date does not
    appear at all;
  - every admitted hit carries the edge that produced it (relation id,
    direction, role, resolver version, confidence), so "why is this here?" has
    a stored answer — and since 2026-08-27 that answer **reaches the reader**:
    `EvidenceView.retrieval.relation` carries the edge through
    `POST /v1/answer` (documented in `openapi.yaml`) and the operator console
    renders it on the source card as *"bu pasaj, aranan maddeyi DEĞİŞTİREN
    düzenlemedir"*. The citator is the first lane whose entire value IS its
    provenance, so `lanes: ["relation"]` alone was not an explanation.
    `citation` (one-hop expansion, ADR-009) and `contrary` (divergence
    completion, ADR-008) travel the same additive way;
  - an unresolvable hint is **never dropped in silence**: when no local
    document can be identified there is nothing to point the NOT NULL
    `to_document_id` at, so the edge is reported on the `DocumentOutcome` as
    an unresolved relation with a reason.
- **Index support:** migration `20260827120000_relations_index.sql` adds a
  partial index on `source_chunk_id` (where not null). The outbound citator
  asks a **passage-level** question — an omnibus (torba) law amends several
  unrelated statutes, and a reader who reached its first article has not asked
  about the statute its second article changes — which neither pre-existing
  index (`document_relations_target_idx`, `document_relations_from_idx`)
  serves, so the lane would seq-scan once a real corpus made the table large.
- **Evidence:** `scripts/db_local_check.py` → exit 0, **17/17**, applying
  **ten** non-pgvector migrations including `20260827120000`. Measured effect
  on the temporal and amendment slices: see
  `evals/reports/fixture_baseline_2026-08-27.{json,md}` (regenerated by
  `scripts/run_evals.py`) — quote the values from that file, not from here.
- **Consequences:** retrieval quality now depends on **ingest-time** edge
  extraction, which on this corpus comes from a synthetic instrument's own
  well-formed amendment structure. Real Turkish instruments will not be that
  tidy; edge coverage and resolver precision on real legislation are unmeasured
  and are a listed risk.
- **Rollout:** default on, seeded from the top hits and capped.
  **Rollback:** set `relationSeedCount` or `relationLimit` to 0 — the primary
  ranking is untouched. Both are accepted by `searchRequestSchema.limits`
  (added 2026-08-27; the schema is `.strict()`, so before that an HTTP caller
  could not tune or disable the lane at all — the request was rejected).

---

## ADR-016 — Durable matter workspace and write-through PostgreSQL stores (in-memory fallback when the database is down)

- **Status:** accepted (2026-09-02, W12 lane A + integration)
- **Context:** The 02.09.2026 audit measured, on the running product, that
  every answer and draft lived only in a bounded in-memory map
  (`InMemoryAnswerStore` capacity 32, `InMemoryDraftStore` 64): a restart of
  `serve.mjs` lost everything a lawyer had produced that morning, and the
  33rd question silently evicted the first, so `GET /v1/answers/{runId}`
  started answering 404 for an evidence bundle that had just been exported.
  There was no matter (dava dosyası) concept at all — nothing tied an upload,
  an answer and a draft to one dispute — no lawyer profile for the vekil block
  of a petition, and nowhere to keep a deadline. Phase 7 ("matter memory")
  was NOT STARTED in `PLAN.md`.
- **Candidates:** (a) keep the in-memory caches and raise their capacity —
  still lost on restart; (b) move the answer path onto the existing
  `app_private.research_runs/steps/evidence/claims` tables from migration
  `20260826040000` — a shape designed for live research steps, not for a
  stored answer with its evidence bundle, and it would have forced the
  exporter's full-chain verification (which needs canonical texts) through a
  second model; (c) add five tenant-scoped tables under `app_private`
  (`matters`, `matter_items`, `answers`, `drafts`, `settings`), keep the
  bounded in-memory cache as the read path, and write through to PostgreSQL
  in the background.
- **Decision:** (c). Migration `20260902120000_matters_persistence.sql`
  (idempotent; RLS on every table with a single `for all` policy on
  `tenant_id = app_private.current_tenant_id()`; `matter_items` additionally
  resolves through the OWNING matter per ADR-011; no pgvector). Stores:
  `control-plane/src/store/answerStore.ts` (`PgAnswerStore`: `put` updates the
  cache and upserts in the background, `warm(runId)` pulls a row back into
  the cache before a read, `list`, `attach`, `flush` for shutdown),
  `control-plane/src/store/draftStore.ts` (`PgDraftStore`: **one row per
  draft version**, pk `(draft_id, version_no)`; "the draft" is its highest
  version), `control-plane/src/matters/store.ts` (`PgMatterStore` /
  `InMemoryMatterStore`), `control-plane/src/settings/store.ts`
  (`PgSettingsStore` / `InMemorySettingsStore`). `answers.bundle` stores the
  evidence bundle **with canonical texts**, so the exporter's full-chain
  verification (ADR-014) keeps working after a restart. `serve.mjs` picks the
  Pg stores when `checkDatabase` says `ok` and falls back to the in-memory
  stores otherwise, printing the Turkish line `kayıt : bellek içi`; the
  server always starts, and the matter/answer routes answer a typed
  `503 STORE_UNAVAILABLE` rather than throwing.
  **Auto-linking** (`control-plane/src/api/matterLink.ts`): a request that
  names a `matterId` (`POST /v1/answer`, `/v1/evidence-bundle`,
  `/v1/research`, `/v1/research/start`, `/v1/drafts`, `/v1/files`) is
  pre-checked **before any work** — an unknown id is `404 MATTER_NOT_FOUND`
  and produces no orphan record (measured: pipeline calls 0, intake CLI calls
  0, drafts 0) — and once the record exists the link is made under a
  `(kind, refId)` uniqueness rule; a link failure never fails the request but
  adds `MATTER_LINK_FAILED` to `warnings` and a stderr line. One
  `answerStore` and one `draftStore` instance are shared by every router, so a
  cloud-AI paragraph lands in the same draft `GET /v1/drafts/{id}` returns.
- **Rationale:** the read path stays as fast and as simple as before; a slow
  or absent database degrades the product to what it was (in-memory), never
  to a crash; one uniqueness rule on `(kind, refId)` makes five draft
  revisions one matter item, not five; the pre-check is what keeps a typo in
  a matter id from silently creating unlinked work.
- **Evidence:** `scripts/db_local_check.py` check **c14** (35 statements
  parse with pglast, 5 tables carry RLS + policy, idempotent re-apply, ledger
  bootstrap, tenant isolation with the probe role) → **18/18 PASS**;
  `control-plane/tests/store/persistence.test.ts` (real PG,
  `collex_persist_test`), `tests/matters/routes.test.ts`,
  `tests/settings/routes.test.ts`, `tests/pipeline/answerService.test.ts`;
  mounted-app tests in `tests/integration/app.test.ts` (matters CRUD,
  auto-link for answer/draft/file/research, 404 before work, versions);
  `demo.mjs` scenario **S6 DOSYA BAĞI 10/10**; the HTTP probe transcript in
  `docs/implementation/waves/W12-INTEGRATION.md` §6 on `collex_demo`
  (`kayıt : kalıcı`, `PgAnswerStore.warm` path, `PgSettingsStore` round trip).
- **Consequences:** `PgAnswerStore.put` writes in the background, so a
  process killed before the write lands loses that one answer — `flush()` is
  called on clean shutdown, a hard kill cannot run it. `PgMatterStore.list`
  is two queries plus JS derivation, sized for one lawyer's volume. RLS is
  bypassed locally because the single-user product connects as the owner;
  the policies exist so the same schema is safe on a multi-tenant runtime and
  they are proven with a probe role, not on the app path.
  `GET /v1/drafts/{id}/versions` is pinned ascending by the linking wrapper
  regardless of store order.
- **Rollout:** applied to `collex_local` through `intake.cli --ensure-db`
  (ADR-020). **Rollback:** drop the five tables; the in-memory path is the
  same code that runs when the database is down.
- **Amendment 2026-09-02 (W12-FIX P0-2/P2-18, W12-FIX2 P1-5b).** A
  background write that fails is no longer silent: the HTTP response of
  `POST /v1/answer`, `POST/PUT /v1/drafts` and the AI paragraph writer
  carries an additive `persisted:boolean` and, when false, one Turkish
  warning (`ANSWER_PERSIST_FAILED` / `DRAFT_PERSIST_FAILED`); deleting a
  matter detaches its drafts (`detachMatter`) instead of losing versions to
  a foreign-key error, and a row whose matter is gone is written without a
  matter (`DRAFT_MATTER_GONE` / `ANSWER_MATTER_GONE`). The stored answer
  bundle is bounded: canonical texts above `MAX_STORED_TEXT_BYTES` (5 MiB)
  are not stored, the result says `STORED_WITHOUT_TEXTS`, and the exporter
  verifies by quote digest (`control-plane/tests/store/persistence.test.ts`,
  `tests/pipeline/answerService.test.ts`, `tests/api.test.ts`).

---

## ADR-017 — Question-coverage abstention gate: lexical, floor 0.4, bypassed by an explicit reference

- **Status:** accepted (2026-09-02, W12 lane B). **Known limits are part of
  the decision — read them.**
- **Context:** The 02.09.2026 audit proved on `collex_demo` that *"Kira
  sözleşmesinde depozito iadesi ne zaman yapılır?"* came back **ŞERHLİ and
  finalizable, led by TCK m.157**. Abstention fired only on an EMPTY evidence
  set, so one decision that happened to contain "sözleşme" was enough for an
  answer; one-hop citation expansion (ADR-009) stamped the expanded article
  `pinned: true, score 1`, so it led the answer; and the top-8 cap could
  drop the very passages carrying the question's distinctive words. A
  citation-first product that answers a rent-deposit question with a fraud
  provision has failed at the one thing it exists for.
- **Candidates:** (a) leave abstention to the drafter/LLM — unmeasurable,
  and no LLM is wired by default; (b) raise the retrieval floors — moves the
  problem, and the lexical lane's 0.25 floor is itself unvalidated (ADR-007);
  (c) a deterministic, offline **question-coverage gate** between evidence
  assembly and drafting: does the evidence set actually contain the
  question's content words?
- **Decision:** (c), `control-plane/src/answer/coverage.ts`.
  `assessQuestionCoverage(question, quotes)` normalises Turkish, drops
  stopwords and legal frame words (`hukuk/kanun/madde/fıkra/hüküm`, statute
  abbreviations), applies a conservative inflectional stemmer (never below 3
  code points, final-consonant softening undone so `aracı ≡ araç`), and
  reports `ratio`, `covered`, `missing`, `bestPassageCovered`. A word present
  in more than half of ≥ 4 passages is weighted 0.5 ("ceza" in a criminal
  corpus discriminates nothing). **Gate:** `bypassed-by-reference` when the
  question cites a provision/decision AND a hit is pinned; otherwise
  `passed` iff `ratio ≥ 0.4` (`DEFAULT_COVERAGE_FLOOR`) AND one passage
  anchors ≥ 2 content words (the anchoring rule is what defeats the audit
  shape: two passages each contributing one word). On failure with a
  non-empty pack the drafter is skipped, the verifier gets an EMPTY pack plus
  the report, status is `ABSTAIN` with reasons `QUESTION_NOT_COVERED` +
  `ABSTENTION_NOT_FINALIZABLE`, and the set-aside passages are listed **by
  identity only** as "yalnız kelime düzeyinde benzerlik; dayanak değil".
  Companion changes: citation expansion arrives **unpinned** on its own
  `citation` lane at 0.9× its seed's fused score (`pinned` again means only
  "the exact lane matched the QUESTION"); the rule drafter's responsiveness
  tier `ENRICHMENT` keeps an expanded passage from leading; the top-8 cap is
  coverage-aware (a capped-out passage covering an uncovered question word
  displaces the lowest non-pinned passage that adds nothing). The rendered
  answer always shows `Soru kapsamı: %N — soru sözcüklerinin kaynaklarda
  karşılığı` and, when bypassed, says so.
- **Evidence:** real pipeline over the ingested fixture corpus, answer-route
  limits: the audit question → `ABSTAIN, coverage 25%, gate failed, 8 set
  aside, missing = kira, depozito, iadesi`; S1/S3 (explicit TCK m.157) →
  `bypassed-by-reference`, unchanged; `fx-amend-003` → `QUALIFIED` at 63%
  (was a FALSE abstention before the coverage-aware cap). Eval report
  `evals/reports/fixture_baseline_2026-09-02.{json,md}` (34 gold rows = 25 +
  9 new): answer-layer abstention precision/recall **100% / 100%** (13/13),
  false abstentions 0; Recall@10 / nDCG@10 / MRR unchanged; hits by lane now
  label the 12 expansions honestly as `citation`. Tests:
  `control-plane/tests/answer/coverage.test.ts` (30),
  `tests/answer/answerHonesty.test.ts` (22), `tests/store/retrieval.test.ts`
  (real PG), `tests/quality/retrievalQuality.test.ts`, `evals/tests` (+4
  `coverage_gate_metrics`). **SENTETİK** — mechanism evidence only.
- **Known limits (binding):** the gate is **lexical**. Two substantive shared
  words in one passage at ≥ 40% weighted ratio pass it; `fx-nearmiss-003`
  ("banka" + "kredi" inside TCK m.158) is refused only by the ratio floor
  (33%) and a shorter phrasing could pass. The rendered coverage line and the
  missing-word list are the reader's defence in that case. The stopword and
  stemmer tables are hand-authored and Turkish-only; the 0.4 floor has never
  been measured on a real corpus and is a listed risk. The eval driver
  measures the gate over the full ranked set while the product measures it
  over its top-8 pack, so a cap-induced false abstention is visible only
  through the real pipeline. `questionCoverage` is deliberately NOT a sixth
  key in `claims[].confidence` (the API test and `export/bundle.py` pin
  five); it lives in `result.coverage.ratio`.
- **Consequences:** an uncovered question never reaches the drafter — cloud
  or rule-based — so the cloud lane (ADR-018) cannot "answer" a question the
  corpus does not cover. Abstention on a lexically-similar-but-irrelevant
  evidence set is now the default outcome, which is the product's promise.
- **Rollout:** default on; `AnswerPipelineOptions.coverageFloor` per
  instance. **Rollback:** floor 0 disables the gate; the reported coverage
  stays.

---

## ADR-018 — Cloud AI (Anthropic) is opt-in per request, evidence-bound, default OFF, and live-untested

- **Status:** accepted (2026-09-02, W12 lane E + integration). **No live
  call has been made**; `AI_LIVE_TESTED = false`.
- **Context:** The rule-based core cannot write prose, cannot read an
  uploaded document beyond heuristic analysis, and cannot OCR a scanned PDF
  (intake is fail-closed on scans by design). A solo lawyer wants those three
  things. The uploaded documents and draft evidence are **client data**
  (müvekkil verisi) covered by avukat sırrı and KVKK; sending them to a
  foreign processor is a decision only the lawyer can take, per document,
  and nothing the model says may be treated as a source.
- **Candidates:** (a) wire an LLM as THE drafter — every answer would depend
  on a key and on network, and the honesty guarantees would move from code to
  a prompt; (b) a server-wide "AI on/off" setting — one click and every
  later request leaks; (c) a separate lane, **OFF unless `ANTHROPIC_API_KEY`
  is set AND the request body itself carries `useCloudAi: true`**, with every
  model output re-verified by the server before it is shown.
- **Decision:** (c). `control-plane/src/ai/*` and
  `control-plane/src/llm/anthropicAdapter.ts` (raw `fetch`; the official SDK
  is outside the frozen dependency set). Surfaces: `GET /v1/ai/status`
  (`configured`, `model`, `consent: 'per-request'`, `dataLeavesMachine: true`,
  `liveTested: false`); `POST /v1/ai/analyze-document` (every finding must
  carry a `chunkId` + verbatim quote; the server checks the quote is an
  exact NFC substring with code-point offsets, else the finding stays but is
  `kaynakli:false` and `kaynaksizCount` increments); `POST /v1/ai/ocr`
  (size 32 MB / `%PDF-` / 100-page guards **before** any network call; output
  headed `AI OCR — kaynak: <dosya> — GG.AA.YYYY — <model>` and re-uploaded
  through the ordinary intake path so it is quarantined and chunked like any
  file); `POST /v1/ai/draft-paragraph` (one paragraph; each cited evidence
  id is judged by a separate entailment call and dropped below **0.85**;
  none left → the paragraph is **KAYNAKSIZ**, visible and counted, and lane
  C's stricter `reviseDraft` verdict is never overridden). `POST /v1/answer`
  with `useCloudAi:true` routes that one request through the cloud drafter
  and entailment ports; `aiUsed.label` says which drafter ran; requested but
  unconfigured → `AI_UNAVAILABLE` warning and the rule-based path continues.
  Order of gates on every POST: consent (`400 AI_CONSENT_REQUIRED`) → key
  (`503 AI_NOT_CONFIGURED`) → zod → local guards → network. The key lives in
  a module-private WeakMap; `toJSON`/`inspect` print `[gizli]`; error objects
  carry `code` + HTTP status, never body or headers. It is read from the
  server process environment (window or user-level variable) — **never from
  this repo's `.env`**, which is part of an open security incident and which
  no code path reads for it.
- **Rationale:** consent has to be a property of the request that carries
  the data, not of a session; the server, not the model, decides what is
  "kaynaklı"; the coverage gate (ADR-017) runs before the drafter so the
  cloud cannot answer an uncovered question; the same intake path for OCR
  output keeps provenance ("AI OCR" is always the first line).
- **Evidence:** `control-plane/tests/ai/*` — **65 tests, all with an
  injected fake `fetch`**: consent/config gates, exact-quote verification
  across a surrogate pair and NFC equivalence, chunk budget, OCR guards and
  batching, entailment stripping (0.92 kept / 0.40 stripped), KAYNAKSIZ path,
  retries/timeouts/refusal/truncation mapping, and "the key never leaks"
  across `error.message`, `JSON.stringify`, `inspect` and every captured
  stderr line. Integration: `tests/integration/app.test.ts` (status
  `configured:false`, consent 400, 503), `tests/api.test.ts`
  (`useCloudAi` → `AI_UNAVAILABLE`, `aiUsed.drafter:false`). Live smoke:
  `node control-plane/scripts/ai-live-smoke.mjs --dry-run` → exit 0 with no
  key shown, no network. Document: `docs/implementation/AI.md`.
- **What is NOT known (binding):** anything about the live API — whether
  forced `tool_choice` with strict schemas and the `document` block with
  `cache_control` are accepted by the named models is an assumption the
  smoke script will test first. Until AI.md's "Canlı sınama kaydı" section
  is filled in, `liveTested:false` is shown on every surface and the console
  says "canlı sınanmadı". OCR's page ceiling cannot be enforced locally for
  object-stream PDFs (warned, single request). Quote verification is strict
  exact-match, so a whitespace-normalising model produces more `kaynaksız`
  findings — honest, but strict.
- **Consequences:** the KVKK assessment (aydınlatma, açık rıza, Anthropic's
  retention terms) is the lawyer's, and the product neither makes it nor
  pretends to; it only guarantees "default off, per-request, nothing sent
  without consent, model never a source". The `claude-sonnet-5` /
  `claude-opus-5` model ids are configuration (`COLLEX_AI_MODEL`), not code.
- **Rollout:** mounted; OFF everywhere until a key exists. **Rollback:**
  unset the key — the routes answer 503 and `/v1/answer` ignores the flag
  with a warning.

---

## ADR-019 — UDF export is *deneysel*: UTF-16 offsets (a scoped exception to ADR-003), unsigned, unverified in the UYAP editor

- **Status:** accepted (2026-09-02, W12 lane C), **experimental**
- **Context:** De Jure ships UDF export, and a Turkish lawyer's filing path
  ends in the UYAP Doküman Editörü, which reads `.udf`.
  `docs/implementation/EXPORT.md` §5 had ruled direct UDF export out "until
  compatibility tests in the official editor pass and behind a separate
  feature flag". This repository has no UYAP editor to test against.
- **Candidates:** (a) keep DOCX only and let the lawyer paste into the
  editor; (b) ship UDF as a first-class format; (c) ship UDF **marked
  experimental on every surface**, unsigned, generated from the same verified
  draft the DOCX comes from, and round-tripped through this repo's own UDF
  reader as the only available check.
- **Decision:** (c). `export/udf.py` writes a zip with one `content.xml`
  (`<template format_id="1.8"><content><![CDATA[…]]></content>…<elements>
  <paragraph><content startOffset= length= …/></paragraph>…`), the element
  structure `intake/extract.py::extract_udf` already reads. Line 1 is the
  review banner; line 2 is verbatim *"Bu UDF dosyası deneyseldir ve
  imzasızdır; UYAP Doküman Editörü'nde açarak doğrulayın."*; KAYNAKSIZ
  lines are prefixed; citations are `Dayanak [K-n]: …`; the DAYANAK
  KAYNAKLARI appendix follows. **Offsets inside `content.xml` are UTF-16
  code units** because the UYAP editor is a Java application and its
  `startOffset/length` are Java string indices. This is a deliberate,
  file-local exception to ADR-003: ADR-003 governs citation offsets over
  canonical text in this system's own contracts; a foreign editor's file
  format is not that. The exception ends at the file boundary — every hash
  and offset in the draft, the DOCX and the ek-dogrulama section stays
  code-point/UTF-8. Verify-before-write, write-to-temp, re-open and
  self-check (banner, deneysel line, every paragraph line, KAYNAKSIZ count,
  `K-n` refs resolved through the appendix, each element's span slices to
  its own line), then `os.replace`. HTTP: `GET /v1/drafts/{id}/export?
  format=udf` answers `application/octet-stream` with the header
  `X-ColleX-Experimental: udf`; a bad-format 400 names udf as *deneysel*.
  CLI: `export.cli --draft … --format dilekce-udf` (also inferred from a
  `.udf` `--out`).
- **Rationale:** an experimental file that says so on its second line and
  carries the same verified content as the DOCX is more useful to the lawyer
  than a refusal, and less dangerous than a silent "supported" claim;
  choosing UTF-16 offsets is choosing to be correct for the reader that
  actually opens the file.
- **Evidence:** `tests/export/test_udf_export.py` (round trip through
  `intake.extract.extract_udf`, refusal of a tampered quote with exit 2 and
  no file, appendix-numbering refusal `KANIT_NUMARASI`), inside `tests/export`
  **87 passed**; `control-plane/tests/drafting/real-export.test.ts` (venv
  Python wrote a DOCX and a UDF from a composed draft with a bound source,
  a contrary decision and ek-dogrulama); HTTP probe in
  `W12-INTEGRATION.md` §6 (`format=udf` → 5963 bytes, PK signature,
  `X-ColleX-Experimental: udf`).
- **What is NOT verified (binding):** the file has **never been opened in
  the UYAP Doküman Editörü**. Page/paragraph attributes (`pageFormat`,
  `Alignment`, `SpaceBelow`) are best guesses from public samples and the
  repo's own fixture. The file is unsigned by design; the signature chain
  (PIN, token, private key) is untouched, as EXPORT.md §5 requires.
- **Consequences:** the console, the API header, the 400 message, the CLI
  summary and the file itself all say *deneysel*; removing any of those
  labels requires a recorded test in the official editor first. `RISKS.md`
  carries the risk.
- **Rollout:** available behind the label. **Rollback:** drop the format
  from the enum; DOCX/Markdown are unaffected.

---

## ADR-020 — Migration ledger with a bootstrap rule and a sentinel probe on every runnable migration

- **Status:** accepted (2026-09-02, W12 lane A); **amended 2026-09-02
  (W12-FIX2 #2, P1-9/P2-12)** — the amendment below supersedes the
  timestamp rule and the `<regclass>`-only header described in the original
  decision text, which is kept for the record.
- **Context:** `intake.cli --ensure-db` applied migrations only to a database
  it created **from scratch**; an existing `collex_local` — the persistent
  product store — could never receive a new migration, so ADR-016's tables
  had no way to reach the lawyer's database except by hand. At the same time
  several lanes load the chain without any ledger (`ingestion.cli
  --apply-migrations`, `db_local_check.py`, `demo.mjs`, the test harnesses),
  and a database loaded that way must not be replayed from zero.
- **Candidates:** (a) a ledger table created by a migration — an empty ledger
  on a pre-ledger database would read as "nothing applied" and replay the
  whole chain into a populated schema; (b) compare `information_schema`
  against every migration — brittle and slow; (c) a ledger table created by
  the ledger **code**, a bootstrap rule for pre-ledger databases, and a
  header sentinel on every migration newer than the boundary.
- **Decision:** (c), `ingestion/migrations.py`: `LEDGER_TABLE =
  app_private.schema_migrations` (`filename` pk, `applied_at`),
  `LEDGER_BOOTSTRAP_BOUNDARY = "20260827120000"` (the newest pre-ledger
  migration), `LEDGER_SENTINEL_MARKER = "[LEDGER SENTINEL]"`.
  `apply_missing_migrations(conn)`: if the ledger is absent or empty **and**
  `legal.documents` exists, bootstrap — every runnable migration with a
  timestamp ≤ the boundary is recorded as applied; a migration newer than the
  boundary is recorded as applied only if the relation named in its
  `-- [LEDGER SENTINEL] <regclass>` header already exists (a `psql`-loaded
  database), otherwise it is applied. Each migration runs with its own ledger
  row in **one transaction** (migration files contain no transaction control —
  verified), so a failed migration is rolled back and left unrecorded.
  **Every migration newer than the boundary MUST carry a sentinel**;
  `20260902120000_matters_persistence.sql` carries
  `-- [LEDGER SENTINEL] app_private.settings`. `intake.cli --ensure-db`
  reports `migrationsApplied / migrationsBootstrapped /
  migrationsAlreadyApplied` (additive JSON). The TypeScript side
  (`control-plane/src/store/health.ts`) only **reads** the ledger to report
  `migrations: {applied, expected, missing}` in `/v1/health`; its constants
  are pinned to the Python source by a test. No `migrate.ts` was written.
- **Rationale:** a ledger that a migration creates cannot distinguish "new
  database" from "old database that predates the ledger"; a relation named
  by the migration itself can. One applier keeps the chain in one place.
- **Evidence:** `tests/ingestion/test_migrations_ledger.py` (8: fresh
  database applies everything and records it; pre-ledger database bootstraps
  then applies the newer migration; `psql`-loaded database bootstraps via the
  sentinel without re-running; failed migration rolled back and unrecorded;
  the boundary is a real migration and every newer one declares a sentinel;
  the sentinel line must open the comment), `tests/intake/test_ensure_db.py`
  (6), `scripts/db_local_check.py` **c14** (ledger 11 rows after bootstrap →
  second run no-op) → **18/18 PASS**; on this machine
  `intake.cli --dsn …/collex_local --ensure-db --list` → `created:false,
  migrationsBootstrapped: 10, migrationsApplied:
  ["20260902120000_matters_persistence.sql"]`, then `app_private` held
  `{matters, matter_items, answers, drafts, settings, schema_migrations}`
  with `matters 0` rows (no test data written). Contract [X]: the DSN gets
  `connect_timeout=5`, and a refused connection is
  `{"error":{"kind":"STORE_UNAVAILABLE"}}`, exit 2, in well under 10 s (it
  used to hang ~3 min).
- **Consequences:** adding a migration now means adding a sentinel line
  naming a relation it creates, or the test suite fails. The other loaders
  stay ledger-less on purpose; bootstrap + sentinel is what makes their
  databases recognisable. A future hosted deployment applies the same chain
  (`docs/implementation/SUPABASE-SETUP.md`) and may then either run
  `apply_missing_migrations` or let the Supabase CLI keep its own history —
  but not both on one database.
- **Rollout:** in `intake.cli --ensure-db`, which the launcher runs on every
  start (create-only, never drops). **Rollback:** drop
  `app_private.schema_migrations`; the next `--ensure-db` bootstraps again.
- **Amendment 2026-09-02 (W12-FIX2 #2 — probe per file, atomic bootstrap).**
  The review found two defects in the rule above: (P1-9) a pre-ledger
  database was bootstrapped **by timestamp** — every file ≤ the boundary was
  recorded as applied whether or not its objects existed, so a database
  loaded from a partial chain was never repaired; (P2-12) the ledger table
  and the bootstrap rows were written in separate statements, so a crash
  between them left an empty ledger that the next run would read as "new
  database". Decision now in force:
  - **Probe grammar.** The header line is
    `-- [LEDGER SENTINEL] <kind>:<name>` with `kind` ∈ `regclass` ·
    `regprocedure` · `extension` · `column:<schema.table>.<col>` ·
    `trigger:<schema.table>.<name>`; a bare name is a `regclass` (so the
    original `app_private.settings` header stays valid). `parse_sentinel`
    validates it; `sentinel_resolves` runs ONE SQL `CASE`
    (`SENTINEL_PROBE_SQL`) that answers whether the named object exists.
  - **Every runnable migration declares a probe that proves itself** — not
    only files newer than the boundary: `010000 extension:btree_gist`,
    `020000 regclass:legal.source_snapshots`, `030000
    regclass:legal.document_relations`, `040000
    regclass:app_private.claim_evidence`, `050000
    regprocedure:app_private.reap_stuck_jobs(interval)`, `060000
    regprocedure:app_private.current_tenant_id()`, `070000
    regclass:legal.embedding_profiles`, `100000
    trigger:legal.document_versions.document_versions_close_previous`,
    `110000 column:legal.chunks.search_tsv_tr`, `20260827120000
    regclass:legal.document_relations_source_chunk_idx`, `20260902120000
    app_private.settings`.
  - **Bootstrap records a file only when its probe resolves.** There is no
    timestamp rule any more; `LEDGER_BOOTSTRAP_BOUNDARY` remains as
    documentation of where the ledger began. A `psql`-built database missing
    the version-transitions trigger and the relations index bootstraps 9
    files and applies exactly those 2.
  - **Ledger table + bootstrap rows are ONE transaction.** A crash
    mid-bootstrap leaves no ledger table, so the next run starts over.
  - **`/v1/health` follows the same rule.** `control-plane/src/store/health.ts`
    (`parseSentinel`, `resolveSentinels` — the same CASE in one round trip,
    `deriveMigrationHealth` without the boundary shortcut) reports a file
    as missing when its probe fails even if a ledger row exists, so the
    launcher's Sistem durumu and Python agree.
  - **Evidence:** `tests/ingestion/test_migrations_ledger.py` (re-pinned +
    4 new: every file declares a parseable, unique probe; grammar;
    psql-built DB → bootstrapped 9 / applied 2; every kind resolves on a
    complete database and bogus probes do not; crash mid-bootstrap leaves NO
    ledger table); `control-plane/tests/store/persistence.test.ts` (real PG:
    all 11 probes resolve; drop the trigger → `missing:
    [20260826100000_version_transitions.sql]`; restore → `[]`);
    `scripts/db_local_check.py` c14 (11 rows via probes, then no-op); real
    `collex_local`: `--ensure-db` → `created:false, migrationsApplied:[],
    migrationsBootstrapped:[], migrationsAlreadyApplied:11`. STATUS S20.
  - **Consequence for authors:** a new migration needs a probe of the right
    kind for the object it creates (a function → `regprocedure:` with its
    argument types; a column added to an existing table → `column:`; a
    trigger → `trigger:`); a `regclass` probe on a pre-existing table would
    make the file look applied on every database and is exactly what the
    per-file test rejects.

---

## ADR-021 — Uploaded document chunks are exhibits (Ek-n), never legal assessment

- **Status:** accepted (2026-09-02, W12 lane C; the file-scope answer path
  of lane B follows the same rule)
- **Context:** The 02.09.2026 drafting audit found upload chunks dumped into
  a petition's *hukukî değerlendirme* as if they were authorities, and every
  evidence entry — cited or not — listed under *HUKUKÎ SEBEPLER*. A client's
  own contract is proof of a fact; it is not a source of law, and a draft
  that cites it as *Dayanak* misleads the court and the lawyer.
- **Candidates:** (a) exclude uploads from drafting entirely — loses the
  DELİLLER list the lawyer actually wants; (b) let the drafter cite uploads
  like any evidence and rely on review; (c) make the distinction structural:
  an upload is an exhibit, may seed **suggested facts**, and can never
  produce a claim or a Dayanak line.
- **Decision:** (c). In `control-plane/src/drafting/`: uploads produce **no
  claims**; the composer writes one DELİLLER line per file — `Ek-n: <dosya>
  (yüklenen belge, <sha256 ilk 8>)` — and fills `draft.suggestedFacts`
  (date/amount/cue sentences with `fileId` + `chunkId`, capped at 25,
  **never auto-inserted**; the console inserts one only on click). A
  stored-answer claim resting only on UPLOAD entries is not written
  (`UPLOAD_NOT_LEGAL_SOURCE` in `machineWarnings`). `reviseDraft` refuses an
  UPLOAD entry under `hukuki-sebepler` or any legal role and refuses
  `evidenceUse` on upload/karşıt/unknown entries (soft issue, draft still
  produced, paragraph flagged). HUKUKÎ SEBEPLER lists only entries cited by a
  usable claim or referenced in the matter's own text; everything else goes
  to `draft.unusedEvidence` and is never rendered. On the answer side
  (ADR-017 lane), a file-scoped answer marks each evidence item
  `origin: "upload"`, renders `Kaynak türü: yüklediğiniz belge` and a
  `KAPSAM` banner, and the verifier's currentness dimension treats an upload
  as not assessable — which is why a purely upload-based answer comes back
  `PARTIAL`, never finalizable (integration note §9.1; the UI is to say
  "yüklediğiniz belge — yürürlük değerlendirilemez").
- **Rationale:** the product's promise is that a legal paragraph rests on a
  verified legal source; a rule the composer and the reviser both enforce
  cannot be forgotten by a prompt or a click.
- **Evidence:** `control-plane/tests/drafting/*` (111 passed; the file-port
  test now asserts the chunk is NOT drafted; refusal of an upload under a
  legal role), `tests/export/*` (87 passed; ek-dogrulama groups uploads per
  file), integration test "taslak POST with fileIds" and the probe in
  `W12-INTEGRATION.md` §6 (`POST /v1/drafts` with `runId` + `fileIds` →
  `evidence=12, unsupportedCount=0, suggestedFacts=2`).
- **Consequences:** `draft.evidence` keeps one entry per uploaded chunk (the
  closure set needs the ids), so the appendix lists each chunk as its own
  `[K-n]` entry, compact and without a quote block. A lawyer who wants a
  contract clause in the legal section pastes it as a fact paragraph (any
  non-legal role may cite any evidence), which is the correct place.
- **Rollout:** in force for every template. **Rollback:** none wanted.
- **Amendment 2026-09-02 (W12-FIX2 #1).** The "used or referenced" filter on
  HUKUKÎ SEBEPLER now sits behind a second, earlier filter — the drafting
  relevance gate of ADR-022 — so an entry can be parked with a stated
  `unusedReason` (`DOMAIN_MISMATCH` / `NOT_RELEVANT`) before it is ever
  considered for a Dayanak. Uploads are unaffected: they were never
  candidates for a legal paragraph and remain exhibits.

---

## ADR-022 — Drafting relevance gate: a template's field of law and the matter's own words decide what may become a Dayanak

- **Status:** accepted (2026-09-02, W12-FIX2 #1; closes W12-FIX P1-1b).
  **Known limits are part of the decision — read them.**
- **Context:** The review reproduced, on `collex_demo`, a kira cevap
  dilekçesi seeded from the S1 research run (TCK m.157) that argued TCK
  m.155/156/158/159/168 under HUKUKÎ SEBEPLER. ADR-021 had stopped uploads
  from becoming legal sources and W12-FIX P1-1 had stopped unpinned
  neighbours from leading (`CONTEXT_ONLY`), but nothing asked whether a
  *validated, pinned* criminal-law passage belonged in a private-law
  petition at all. The composer took every validated claim of the run as a
  candidate Dayanak; the only filter was "used or referenced".
- **Candidates:** (a) leave it to the lawyer's "Dayanak olarak kullan"
  toggle — the default draft would still be wrong, and a default is what a
  tired reader signs; (b) ask the cloud model whether an entry is relevant —
  unmeasurable, key-dependent, and the whole point of the drafting lane is
  that the default path is deterministic; (c) a deterministic gate built from
  two things the system already has: a **field-of-law tag** on every
  template and the **matter's own text**, judged with the same tokenizer and
  stemmer as the coverage gate (ADR-017).
- **Decision:** (c), `control-plane/src/drafting/relevance.ts`. Every
  template carries `domain` (`templates.ts`; `DraftTemplate.domain` on the
  wire: 12 × `ozel-hukuk`, `icra-itiraz-dilekcesi` = `icra`). Each evidence
  entry gets a domain from, in order, its court (ceza daireleri → `ceza`,
  hukuk daireleri → `ozel-hukuk`, Danıştay / idare-vergi mahkemeleri /
  kurullar → `idare`, icra mahkemeleri → `icra`), its legislation number
  (5237/5271/5275/5326 … → `ceza`; 6098/6100/4721/6102/4857/6325/6502 … →
  `ozel-hukuk`; 2577 … → `idare`; 2004 → `icra`), its title, and its source
  family; AYM and anything unknown are `genel`. A compatibility table says
  which evidence domains a template domain accepts (`icra` also accepts
  `ozel-hukuk`; `genel` accepts everything). The verdict per entry is
  decided **once, before any slot is written**, in this order:
  `referenced` (the composer's existing explicit-reference pin — kanun no +
  madde or esas no in the matter text — **is never dropped**) →
  `DOMAIN_MISMATCH` (incompatible domain) → `NOT_RELEVANT` (no lexical
  overlap between quote + title + label and the matter's talepler + olaylar
  + instructions + every string `ekBilgiler`, via `mapPassageCoverage`; a
  matter with no content words skips this rule) → `relevant`. Contrary
  entries are judged by domain only and stay when a kept supporting entry
  shares their domain. A claim whose evidence is entirely parked is not
  written (machine line); parked entries never enter HUKUKÎ SEBEPLER or the
  karşı içtihat section, land in `draft.unusedEvidence` with the additive
  `unusedReason`, and produce one Turkish warning plus
  `DOMAIN_MISMATCH:<id>` / `NOT_RELEVANT:<id>` machine lines. The lawyer's
  override is the existing `evidenceUse:true` on PUT ("Yine de dayanak
  olarak kullan" in the Kanıtlar sidebar under "Kullanılmayan kaynaklar
  (alakasız görünüyor)"); `partitionEvidence` strips the mark when the entry
  is pulled in. There is no auto-inclusion.
- **Rationale:** the two signals are cheap, explainable and already
  trusted elsewhere in the product (the reference parser and the coverage
  tokenizer); a wrong default in a petition is worse than a missing one; and
  a gate the composer and the reviser both read cannot be forgotten by a
  click.
- **Evidence:** `control-plane/tests/drafting/relevance.test.ts` (9: domain
  derivation, compatibility, verdict order, determinism, the S1 → kira cevap
  dilekçesi scenario with and without the reference, `NOT_RELEVANT`,
  force-use via `reviseDraft`); `tests/drafting/composer.test.ts` audit #2
  re-pinned by cause; `console.test.ts` pins the sidebar strings. Live probe
  (port 8881, `collex_demo`): S1 answer → kira cevap dilekçesi → `sebepler
  []`, `degerlendirme []`, no "5237" in the body, 4 × `DOMAIN_MISMATCH`; the
  same matter with "TCK m. 157" in the talep → m.157 as the only Dayanak
  (`W12-FIX2.md` #1, screenshot `FIX-2/fix2-01-kanitlar-alakasiz.png`).
  STATUS S11, S18; TRACEABILITY #45. **SENTETİK** — mechanism evidence only.
- **Known limits (binding):** the legislation-number tables cover the
  common codes only — an unknown number is `genel`, never gated by domain
  and only by the lexical rule; the lexical rule inherits every limit of
  ADR-017 (hand-authored Turkish stopwords and stemmer, two shared content
  words can pass); the gate is unmeasured on real law (RISKS #18 applies to
  it as much as to the coverage gate). A template's `domain` is a single
  value; a mixed-domain dispute (a criminal complaint arising from a
  contract) will park one side and needs the override.
- **Consequences:** `DraftEvidence.unusedReason` and `DraftTemplate.domain`
  are additive wire fields (`openapi.yaml`); adding a template means
  choosing its `domain`; extending the number tables is data, not logic.
- **Rollout:** on for every template. **Rollback:** setting every template's
  `domain` to `genel` disables the domain rule; the lexical rule is skipped
  for a matter without content words, so an empty matter never parks
  anything.

---

## ADR-023 — Quote integrity: a paragraph must still CONTAIN the quote it cites, or nothing is exported

- **Status:** accepted (2026-09-02, W14 B-01, lane L-EVID)
- **Context:** The product's whole claim is that a cited sentence is bound to
  a passage by digest, offset and document version. W13's UX audit (P0-1)
  broke that bond with two edits a lawyer makes every day, and the system
  said nothing. (1) The composer's `evidenceOverlaps` used a 0.7 lexical
  overlap plus a check that the numbers in the quote still appeared; rewriting
  "bir yıldan beş yıla kadar" as "beş yıldan on yıla" kept the overlap above
  the floor and `extractNumbers` never saw the spelled-out sentence. (2)
  Changing "MADDE 157" to "MADDE 158" left "157" in the künye, so the number
  check passed. Worse, the Markdown export path is rendered in TypeScript and
  never reached the Python verifier — the format most likely to be pasted into
  a brief was the one with the weakest gate.
- **Candidates:** (a) raise the overlap floor — an arbitrary number that
  trades one class of false negative for another and still cannot see a
  reversed sentence; (b) diff the paragraph against the stored quote and warn
  — a warning on an evidence bond is a warning nobody reads; (c) require
  **exact containment** in one canonical form, and refuse the export when it
  does not hold.
- **Decision:** (c). `control-plane/src/drafting/quoteIntegrity.ts` and its
  Python mirror `export/draft.py::canonical_quote_text` define ONE canonical
  comparison form — the two files change together or neither changes:
  1. fold back the render guard's entity escapes (`&lt;` `&gt;` `&#40;`
     `&#58;` `&#46;` and `&amp;` LAST), because the paragraph text has been
     through `sanitizeMarkdown` while `evidence.quote` is stored raw;
  2. drop invisible and BiDi characters — a character you cannot see may not
     decide whether a citation is valid;
  3. NFC normalize (ADR-003);
  4. collapse whitespace runs to one space and trim.
  Nothing else is forgiven. The comparison is a **substring search**, with no
  `.length`/`.slice` arithmetic anywhere. The gate stands in two independent
  layers: `PUT /v1/drafts/{id}` breaks the bond immediately
  (`issues[].code = QUOTE_ALTERED`, the paragraph falls to KAYNAKSIZ), and
  `GET /v1/drafts/{id}/export` runs `findAlteredQuotes` **before any format
  branch** and answers **409 `EXPORT_REFUSED`** with `error.code` and
  `error.paragraphs[]` — the exporter process is not spawned. `export/draft.py`
  repeats the check so a draft that entered the store another way is caught
  too. `evidenceOverlaps` was **not deleted**: it is the right measure for
  sentences OUTSIDE the quote, and it stays tested.
- **Why 409 and not 500:** an unverifiable draft is not a server failure and
  not a malformed request. It is a state of the document, and the client can
  fix it. The existing 500 `EXPORT_REFUSED` (the Python verifier's exit 2)
  stays for what it always meant.
- **Evidence:** `control-plane/tests/drafting/quoteIntegrity.test.ts` (10) —
  each of the two audited mutations is tested TWICE: first proving the OLD
  lexical gate still says "no problem" (so the regression cannot return),
  then proving the new gate refuses. `tests/export/test_cli.py` (+6): exit 2,
  `not out.exists()`, and `tmp_path.glob("*.tmp") == []`. Eleven real-HTTP
  checks in `W14-L-EVID` §3, including "marks=none does not get past the gate
  either".
- **Consequences:** a draft saved before W14 whose paragraph was edited away
  from its quote can no longer be exported until the quote is restored or the
  citation removed. That is the intended behaviour: the alternative is a
  document that looks sourced and is not.
- **Rollback:** delete the `findAlteredQuotes` call in `routes.ts` and the
  containment check in `export/draft.py`. Do not do this.

---

## ADR-024 — Export modes govern CONTENT, never verification

- **Status:** accepted (2026-09-02, W14 B-02, lane L-EVID)
- **Context:** The draft exporter produced one artifact for two irreconcilable
  audiences. A measured petition was 77 % annex: künye tables, SHA-256 lines,
  schema tags, `⚠ KAYNAKSIZ` markers and raw rule ids — everything the
  lawyer needs while reviewing and nothing a court may see. The page was US
  Letter, 236 of 236 paragraphs read `bold=False, alignment=None`, and the UDF
  set `Alignment` to 0 everywhere. So the honest document could not be filed
  and the filable document did not exist.
- **Candidates:** (a) a second template — two sources of truth for one
  document; (b) strip the annex in the console after download — the lawyer
  edits the artifact, and every edit is a chance to break a bond; (c) two
  additive query keys on the SAME exporter, with the verification path
  untouched.
- **Decision:** (c). `annex=full|none` and `marks=all|none`, both optional and
  both defaulting to today's behaviour, so no existing client changes.
  `annex=none` drops the künye table, the `Uyarılar` list, the
  `EK — DOĞRULAMA BİLGİLERİ` section, the `DAYANAK KAYNAKLARI` appendix and
  the format notes, and turns the body citation line from `Dayanak [K-n]: …`
  into `Dayanak: <künye>` (a machine number is meaningless when there is no
  annex to point at). `marks=none` drops ONLY the screen marks. The
  combination `annex=none&marks=none` is the filable copy: the file is named
  `… - v<N> - NİHAİ.<ext>` and the title says (NİHAİ). Format corrections —
  A4 21×29,7 cm, centred court address, right-aligned signature, justified
  body, explicit `bold=True` on every bold run, and the same alignment
  contract in the UDF — apply in **every** mode.
- **The line that may not move:** `verify_draft_or_refuse` — quote digests,
  citation closure, the KAYNAKSIZ count and the ADR-023 check — runs
  IDENTICALLY in every mode, and the mandatory review band and the footer are
  printed in every mode. `marks=none` on an unverifiable draft still refuses.
  **Removing the ink does not remove the discipline.** The evidence/hash
  package continues to exist as its own file (`export/bundle*.py`); it was
  never deleted, only separated.
- **Recorded deviation:** the acceptance text said `annex=full&marks=all`
  must be byte-identical to the previous output. Taking that literally would
  have made the A4 and alignment fixes — demanded by the same item —
  impossible. The interpretation applied is: **format fixes apply in every
  mode; `annex`/`marks` govern content only.** So `annex=full&marks=all` is
  not byte-identical, loses nothing in content, and a test
  (`test_cli_defaults_are_todays_behaviour`) pins the default call and the
  explicit call to the same read-back report.
- **Evidence:** `tests/export/test_filable_output.py` (19), plus the produced
  DOCX read back with python-docx: page 21,00 × 29,70 cm, one CENTER, three
  RIGHT, eight JUSTIFY, seven bold runs, and `⚠ KAYNAKSIZ` / `kiracı
  yüklemesi` / `collex.export.` / rule ids **0 times** in the final copy.
- **Amendment (27.09.2026, drafting audit):** the NİHAİ copy printed system
  placeholders ("[Kararın özeti — doldurun]", "[Karşı dava talebi varsa
  buraya yazın; yoksa bu bölümü silin]") and KAYNAKSIZ stubs addressed to the
  lawyer ("… avukat tarafından eklenmelidir.") as ordinary body text. One
  ADDITIONAL gate now applies to the filing copy only: while a paragraph
  still carries a recorded system placeholder (`DraftParagraph.placeholders`,
  a token still present in its text) the NİHAİ export is refused —
  `409 EXPORT_REFUSED / PLACEHOLDER_UNFILLED` before any format is produced
  (`drafting/placeholders.ts`), and `export/draft.py::refuse_unfilled_placeholders`
  applies the identical test to the tokens written into the exporter's JSON.
  It is deliberately NOT part of `verify_draft_or_refuse`, which still runs
  identically in every mode: the gate only makes the filing copy stricter,
  never any copy looser. `marks=none` also drops the DELİLLER screen note
  "(dosyaya eklediğiniz belge)" — a note to the lawyer, not court text.
  Evidence: `control-plane/tests/drafting/filedCopy.test.ts`,
  `tests/export/test_filed_copy.py`.

---

## ADR-025 — `localGuard`: a local-only server still needs a Host and Origin check

- **Status:** accepted (2026-09-02, W14 B-04, lane L-SAFE)
- **Context:** "It only listens on 127.0.0.1" is not a security boundary
  against a browser. W13's engineering-risk lane measured two live holes.
  (1) **DNS rebinding → READ.** A page on any domain that resolves to
  127.0.0.1 could `fetch` `/v1/answers?texts=true` and `/v1/settings` — the
  canonical text of every document the lawyer ever quoted, and their profile.
  (2) **CSRF → WRITE.** `text/plain` and `multipart/form-data` are
  CORS-safelisted, so the browser sends no preflight; a foreign page could
  POST a matter, upload a file, or call `/v1/ai/analyze-document` — where
  ADR-018's per-request consent is a BODY FIELD the attacker writes himself.
- **Candidates:** (a) add authentication to the console — a password on a
  single-user local tool is friction the user will disable, and it does not
  stop a same-origin-shaped request; (b) a CSRF token — needs state and a
  console change, and does nothing about the read hole; (c) validate what the
  browser is already forced to tell us: `Host`, `Origin`, `Sec-Fetch-Site`.
- **Decision:** (c). `control-plane/src/api/localGuard.ts`, installed as the
  **first** `app.use("*", …)` in `createApp` — before the body limiter, so a
  rejected request never reaches the pipeline, the intake process or the
  model. Three rules: a `Host` outside `127.0.0.1` / `localhost` / `::1` →
  **421**; a state-changing method with a foreign `Origin` **or** a
  `Sec-Fetch-Site` that is not `same-origin`/`none` → **403
  `FORBIDDEN_ORIGIN`**; and `cache-control: no-store`,
  `x-content-type-options: nosniff`, `referrer-policy: no-referrer` on
  `/v1/*`.
- **What deliberately keeps working:** local scripts that send no `Origin`
  (curl, `demo.mjs`, the CLI probes) are unaffected — the rule is "a FOREIGN
  origin", not "an origin". The console is same-origin. Its hash-pinned CSP
  was not touched.
- **Evidence:** `control-plane/tests/api.test.ts` `describe("B-04
  localGuard")`: four foreign hosts → 421 on `/v1/answers`, `/v1/settings`
  and `/v1/health`; a foreign-origin POST → 403 **with the fake pipeline's
  call counter at 0**; `/v1/ai/analyze-document` → 403;
  `Sec-Fetch-Site: cross-site` → 403; an origin-less POST → 400 (the route
  ran, the guard did not interfere); the three headers present on
  `GET /v1/answers/{runId}/evidence-bundle?texts=true`.
- **Consequences:** this is NOT authentication and does not claim to be. A
  process on the same machine can still call the API. The console remains
  auth-free and must never be exposed beyond 127.0.0.1.

---

## ADR-026 — A migration declares SEVERAL ledger sentinels, and bootstrap needs all of them

- **Status:** accepted (2026-09-02, W14 B-05, lane L-SAFE; amends ADR-020 as
  amended by W12-FIX2). Extended the same day by the phase-B1 lane with the
  `constraint:` kind.
- **Context:** ADR-020 gave every runnable migration ONE probe line and had
  bootstrap record a pre-ledger file when that probe resolved. W13's
  engineering-risk lane found the blind spot: `20260902120000_matters_persistence.sql`
  creates five tables and then twelve RLS policies. Its single probe named the
  FIRST object. A database where the file crashed after the tables but before
  the policies therefore looked "applied" — and stayed there, with client rows
  unprotected, because the ledger would never re-run it.
- **Candidates:** (a) wrap every migration in one transaction — most already
  are, and it does not help a database that was left half-applied before the
  rule existed; (b) checksum the file — tells you the file changed, not
  whether the database has its contents; (c) let a file declare SEVERAL
  probes and require ALL of them.
- **Decision:** (c). `ledger_sentinel` became `ledger_sentinels()` (a list);
  `ledger_sentinel` still returns the first for backward compatibility.
  Bootstrap records a file **only if every one of its probes resolves**. Every
  runnable file now probes the first AND the last object it creates. The kind
  vocabulary grew to `regclass` · `regprocedure` · `extension` · `type` ·
  `column:<schema.table>.<col>` · `trigger:<schema.table>.<name>` ·
  `policy:<schema.table>.<name>` · `constraint:<schema.table>.<name>` (a bare
  name still means `regclass`). Both runtimes — `ingestion/migrations.py` and
  `control-plane/src/store/health.ts` — resolve the same probes with the same
  SQL CASE, and a test reads the Python source and compares the statements.
  `apply_missing_migrations` now takes a session-level
  `pg_advisory_lock(hashtext('collex.migrations'))` and releases it in a
  `finally`, so two concurrent `--ensure-db` runs cannot apply the same file
  twice.
- **Why `constraint:` had to exist:** the phase-B1 migration
  `20260904090000_hearing_kind_and_search_indexes.sql` widens a CHECK. An
  ALTER creates no relation, so under the old grammar the only probeable
  objects would have been the three indexes it also creates — and a database
  that had those indexes but still carried the OLD six-value CHECK would read
  as "applied". That is the same half-application blindness this ADR exists to
  close, one migration later.
- **Additive health field:** `/v1/health.rls = {expected, present}`. A full
  database carries **18** policies. `present < expected` means exactly the
  scenario above and the console draws it red.
- **Evidence:** `tests/ingestion/test_migrations_ledger.py` (17), including a
  test that parses every runnable file's LAST column-0 `create …` statement
  and checks a probe names it; the half-applied matters scenario built for
  real (preconditions asserted: table present, policy absent, policy count 0;
  then the file is NOT bootstrapped, IS applied, and the count becomes 5); and
  two concurrent apply passes on an empty database, both succeeding with every
  file applied exactly once. `persistence.test.ts` verifies the same against
  real PostgreSQL from the TypeScript side.
- **Scope honesty:** the concurrency test uses two THREADS, not two OS
  processes. The lock is server-side and per-session, so the mechanism under
  test is identical; two processes would only have added spawn cost.

---

## ADR-027 — The local library is a queue, not an ingestion path

- **Status:** accepted (2026-09-02, W14 B-20, lane L-SOURCES). **Half
  implemented on purpose — read the consequences.**
- **Context:** Live research fetches full official documents and then throws
  them away. Asking the same question twice means going back to the network
  twice, and a document that was reachable on Monday may not be on Friday.
  The obvious move is "write what we fetched into `collex_local`".
- **Candidates:** (a) write straight into `legal.documents` /
  `document_versions` / `chunks` from TypeScript — fastest, and wrong; (b)
  keep nothing and re-fetch — today's behaviour; (c) write a provenance-complete
  RECORD to a local queue in TypeScript, and let the existing Python pipeline
  publish it later.
- **Decision:** (c). `control-plane/src/sources/localLibrary.ts` defines
  `LocalLibraryPort` = `{put, keys}` with three implementations, of which
  **`DisabledLocalLibrary` is the default** — so a server that was not started
  with `--library-dir` behaves exactly as before. The envelope is
  `collex.library.document/v1` and carries source, externalId, title,
  sourceUrl, toolName, fetchedAt, originLabel, scope, mediaType, text,
  `contentSha256`, `contentCodePoints` and the runId. `FileLocalLibrary`
  writes one JSON per document to a temp name and renames, so a reader never
  sees half a record. The dedupe key is
  `provider__externalId__sha256[0:16]`: the same text twice is a `duplicate`,
  and CHANGED text is a SEPARATE record — so the Python pipeline can later add
  a new VERSION rather than overwrite one. The provenance label is
  **"resmî kaynak"**, never "(SENTETİK)": to a lawyer that word means "this
  system invents decisions". A failed write NEVER fails the run — it becomes a
  `LIBRARY_WRITE_FAILED:<n>` warning and the answer and its quotes are
  untouched.
- **Why (a) was rejected, and why the second half is deferred rather than
  hacked:** logical identity (`ingestion/identity.py`), temporal
  close-on-append (ADR-012, `versioning.py`), NON-OVERLAPPING chunks
  (ADR-013, `chunking.py`) and citator edges (`relations.py`) live in Python.
  Re-implementing them in TypeScript would give **the same document a
  different identity depending on which runtime wrote it** — precisely the
  defect ADR-013 exists to prevent. So the ingestion half is an explicit
  integration request: a `LiveLibrarySource(SourcePort)` in
  `ingestion/live_library.py` that re-computes `contentSha256` and SKIPS AND
  REPORTS a record whose digest does not hold, plus an
  `intake.cli --ingest-library` mode that refuses any DSN other than
  `collex_local` / `collex_intake_test`. **No new table, column or migration
  is needed** — the record fits the existing schema with `scope='public'`.
- **Consequences, stated plainly:** until that lands, `collex_local` receives
  NOTHING, `/v1/health corpus.publicDocuments` does not grow, and the coverage
  manifest says `yerelKutuphaneAcik: false`. **A growing library is not
  implied anywhere.** The library is written; it is not yet a corpus.

---

## ADR-028 — The citation audit answers three buckets, and "we did not look" is not "it does not exist"

- **Status:** accepted (2026-09-02, W14 B-13, lanes L-EVID and L-FIX)
- **Context:** The most valuable thing a Turkish litigator can be handed
  today is an answer to "are the authorities in the other side's brief real,
  and are they still in force?" — the same product Clearbrief sells as a Cite
  Check Report. Every part existed here (a reference parser in two runtimes, a
  hash-verified corpus, an as-of temporal layer); what did not exist was the
  report, and, more importantly, a discipline for the cases where we cannot
  tell.
- **Candidates:** (a) two buckets, found / not found — the shape everyone
  expects, and a lie: it turns "outside our coverage" into an accusation of
  fabrication against a real decision; (b) a confidence score — a number we
  cannot defend, and §C.1 forbids it; (c) three buckets with an explicit,
  written meaning for each, and a hard rule about empty cells.
- **Decision:** (c). `FOUND` / `NOT_FOUND` / `UNCERTAIN`, and the report
  PRINTS what each one means, verbatim, including the sentence
  *"'bulunamadı' taradığımız kaynaklarda yok demektir; 'belirsiz'
  kapsamımızın dışında ya da kaynağa erişilemedi demektir — ikisi aynı şey
  değildir."* The console must draw them in three different colours; two of
  them may never be the same colour. Four rules hold the shape:
  1. **`asOf` is mandatory and is the DOCUMENT'S date**, not today. Currency
     is judged as the brief was written, and the header says so.
  2. **An unresolved citation's `kunye` is the EMPTY STRING.** The engine
     never synthesizes one, the renderer leaves the cell blank — no "?", no
     dash, no "bilinmiyor" — and the DOCX self-check verifies the empty cell
     **inside the produced archive**.
  3. **The resolver is injected, and its failure modes all fall to
     `UNCERTAIN`.** An unwired installation answers `UNCERTAIN` for every row;
     a resolver that throws yields `UNCERTAIN`. We do not accuse a citation of
     being invented on the strength of not having looked.
  4. **Quote checking is a SHA-256 comparison**, never a similarity score. A
     source that exists but whose claimed quote does not hold is `UNCERTAIN`
     with its reason written out.
- **The boundary we drew, and why (this is the important half):** the wired
  corpus resolver **can never answer `NOT_FOUND`**. The design began with one
  exception — "the law's text as of the brief's date IS in the corpus and that
  article is not in it" looked like a genuine positive finding, because ingest
  stores a legislation as one document version. That premise was audited
  against the demo corpus on 02.09.2026 and **did not hold**: `kanun-6098`
  there carries articles {1, 2, 12, 49, 50, 51} — a synthetic EXCERPT, not the
  code. Under that rule "6098 m. 5" would have been reported as **fabricated**
  to a lawyer, about a real provision. Nothing in the schema says whether a
  legislation is stored whole or in part, so the premise cannot be checked at
  run time and the conclusion cannot be drawn. The case still produces the
  most useful sentence available — which law, read as of which date, which
  article was not found — but in the **UNCERTAIN** bucket, which is where a
  statement about OUR COVERAGE belongs. `absent: true` stays in the contract
  for a resolver that CAN declare completeness (an official full-text source).
  This one cannot, and does not pretend to.
- **Consequences:** today's report is a **coverage statement plus resolved
  künyeler**, not a full citation verification, and every surface must say so
  until a completeness-declaring source is wired. `STATUS.md` lists it as one
  of the eight unverified surfaces. (Phase B2 added the console table and
  phase F left it untouched; the screen draws the empty `Bulunamadı (0)`
  bucket and writes down what the `0` means, so the limit is on the lawyer's
  screen and not only in this file.)
- **Evidence:** `control-plane/tests/drafting/contracts.test.ts` (21) — a
  five-citation synthetic brief audited in one request, currency badges
  against `asOf`, and the empty künye cell read back from the DOCX table;
  `tests/contracts/corpusResolver.test.ts` (11) tested through the `lookup`
  seam (a fake `Sql` cannot imitate postgres.js fragment composition — the
  visibility filter calls the tag while BUILDING the query, so query
  construction would consume the canned row queue and the test would be
  measuring the fake); `tests/export/test_audit_report.py` (11) including a
  broken writer → `ExportRefused`, no file, no `*.tmp`.

---
## ADR-029 — Physical source provenance: canonical ranges map to PDF pages, and unreadable pages are rows

- **Status:** accepted (2026-09-11, W19 phase A)
- **Context:** `intake/extract.py` read a PDF page by page and then flattened
  the pages into one canonical string (`_tidy` joins the cleaned, non-empty
  blocks with a blank line). After that join nothing in the system could say
  WHICH PAGE a canonical offset came from: the evidence chain stopped at
  "document version + code-point range". A lawyer checking a quote against the
  paper file had no page to turn to, and an exhaustive review had no way to
  prove it had read every page — the two properties this build exists to
  provide.
- **Candidates:** (a) re-derive the page at render time by re-extracting the
  PDF — non-deterministic, and wrong the moment pypdf changes; (b) store a
  page number on each CHUNK — chunks do not tile the text, so the headings
  between them would have no page and a quote spanning a page break could not
  be expressed; (c) store the page map as a first-class, queryable range
  table keyed to the document version.
- **Decision:** (c). `legal.document_version_segments` holds one row per
  contiguous source block — a physical PDF page, a DOCX paragraph/table, or
  the single block of a flat text file — with the half-open code-point range
  `[start_char, end_char)` it occupies in `document_versions.canonical_text`.
  `ingestion/locators.py` builds and verifies the map; `ingestion/segments.py`
  is the only writer, and it writes in the SAME transaction as the version and
  its chunks, so a document cannot be published with a half-written page map.
- **NFC runs per block, BEFORE the offsets are taken.** This is the load-
  bearing detail. `_tidy` produced a pre-NFC string that `intake/ingest.py`
  normalized afterwards, so any span measured during the join could drift the
  moment NFC composed a decomposed sequence — and Turkish text is full of
  them (`s` + U+0327 composes to `ş`, two code points becoming one). Each
  block is therefore NFC-normalized first and the spans are measured on the
  normalized pieces, so the ranges are measured against the FINAL canonical
  text and cannot drift. The concatenation of NFC pieces around the
  two-newline separator is itself NFC because U+000A is a starter with no
  canonical composition with either neighbour — but that argument is NOT
  trusted: `build_segmented_canonical` verifies NFC idempotence plus
  per-segment bounds and ordering at run time and, when the check fails,
  returns NO segments. A missing page map is a visible gap; a wrong one is a
  false citation.
- **Unreadable pages are rows, not absences.** A page with no text layer
  contributes no characters, so it is stored with an EMPTY range
  (`start_char = end_char`) parked at the position in document order where its
  content would have been. This is what lets processing coverage say "page 7
  of 12 could not be read" instead of silently reporting 11 pages as the whole
  document. The EXCLUDE constraint tolerates these rows because an empty
  `int4range` never overlaps.
- **Physical vs structural locators.** `locator_kind = 'page'` is the only
  PHYSICAL locator and is written only for formats that really have stable
  pages (PDF). A DOCX has no fixed pagination until it is rendered, so it gets
  `'paragraph'`. Writing a page number for a DOCX would be a fabricated
  citation, which is the class of error this build exists to prevent.
- **Consequences:** ADR-003 is untouched — offsets are still Unicode code
  points over NFC canonical text and hashes are still sha256 over UTF-8. One
  extra table and one extra RLS policy (18 → 19).
- **Evidence:** `tests/intake/test_locators.py` (30) proves the canonical text
  is byte-identical to `NFC(_tidy(blocks))` over adversarial Unicode, that a
  phrase planted on page 137 of a 200-page PDF resolves to `s. 137`, and that
  unreadable pages keep empty ranges. `tests/intake/test_locators_db.py` (6)
  proves the same end to end through the real intake path and PostgreSQL,
  including the slice computed BY PostgreSQL matching the Python slice.
- **Rollback:** the table is additive and nothing reads it when it is empty;
  a document with no segments simply has no locator.

---

## ADR-030 — Matter query scope is resolved on the server, and never widens

- **Status:** accepted (2026-09-11, W19 phase C)
- **Context:** `matterId` on `POST /v1/answer` meant only "file the answer
  under this matter" (contract [M]). It never reached retrieval. A lawyer who
  had put eighty documents into one matter and asked a question about it was
  answered from the whole corpus, unless the browser had ALSO enumerated all
  eighty ids into `filters.fileIds` — which it could not, because that field
  caps at 50 and the browser does not know the membership.
- **Candidates:** (a) make the browser send the ids — impossible at real
  matter sizes and a cap change would only move the wall; (b) overload
  `filters.matterId` — puts a membership lookup behind a word that means
  predicate, and the two have different failure modes (an unknown chamber is
  an empty result, an unknown matter is a 404); (c) an explicit `scope`
  object resolved server-side.
- **Decision:** (c). `scope: { matterId?, fileIds?, includeCorpus? }` on the
  answer request. `src/matters/scope.ts` resolves a matter to its own uploads
  under the caller's tenant and writes the result into the `filters.fileIds`
  the store already scopes on — so retrieval semantics are unchanged and only
  the way the list is obtained is new. Legacy `filters.fileIds` /
  `filters.includeCorpus` keep working untouched.
- **Scope NEVER widens.** Naming both a matter and explicit ids VERIFIES the
  ids against membership; anything outside is refused BY NAME (409
  `FILES_OUTSIDE_MATTER`) rather than quietly dropped or quietly allowed. The
  first would hide a mistake, the second would let a request reach another
  matter's evidence. Every other refusal is typed too — `MATTER_NOT_FOUND`,
  `MATTER_EMPTY`, `MATTER_TOO_LARGE`, `STORE_UNAVAILABLE` — because an empty
  evidence set reads on screen as "your documents do not answer this", which
  is a statement about the documents rather than about the request.
- **Two different caps, on purpose.** The 50-id cap on the request body bounds
  what a client may TYPE. `MATTER_SCOPE_MAX_FILES = 500` bounds the work one
  question can cause after the server expanded a matter, and is deliberately
  far larger: a real litigation matter holding several hundred documents is
  the case this build exists for. Beyond it the caller is told to narrow,
  never served a silently truncated "whole matter".
- **Membership is a link, never a copy.** The same file may belong to many
  matters; nothing duplicates its text, chunks or embeddings.
- **Consequences:** tenancy is structural rather than checked — the store is
  bound to one tenant, so another tenant's matter resolves to
  `MATTER_NOT_FOUND`, the same answer as a matter that does not exist (no
  existence oracle).
- **Evidence:** `control-plane/tests/matters/scope.test.ts` (16), including
  the two-matter isolation case and the shared-file case.
- **Rollback:** omit `scope`; every existing request behaves exactly as before.

---

## ADR-031 — Dense retrieval hydrates its own provenance, and the index is untrusted input

- **Status:** accepted (2026-09-11, W19 phase D)
- **Context:** `DenseLane.search()` returned only chunk ids, and
  `provenanceById` was populated only from the lexical and trigram ROWS.
  A chunk that ONLY the dense lane found was scored, ranked, given lane
  provenance — and then silently dropped at assembly (`hybrid.ts`) because no
  provenance row existed for it. Dense retrieval could therefore only ever
  re-rank what the lexical lanes had already found, which is the opposite of
  what a semantic lane is for. No test referenced the dense lane at all.
- **Candidates:** (a) have the dense lane return full rows — pushes a join
  into every future index implementation and makes the lane responsible for
  visibility, which it cannot be; (b) hydrate provenance by id after fusion.
- **Decision:** (b). `chunkProvenanceByIds` in `chunkStore.ts` fetches
  provenance for the dense-only ids, and `hybrid.ts` merges the rows into
  `provenanceById` before assembly.
- **HYDRATION IS A SECURITY BOUNDARY, not a convenience.** An approximate
  nearest-neighbour index is a separate structure that does not know about
  tenancy, publication status, as-of dates or file scope; asking it for
  neighbours can return a chunk the caller must not see. The hydration query
  re-applies the SAME `visibilityFilter` every ranked lane uses, so a dense id
  that fails the filter produces no row and never becomes a hit. The index is
  treated as untrusted input and the database decides what is visible. This is
  also why hydration is not served from a cache.
- **The lane contract was widened** to receive `filters` (every other lane
  already does), so a real dense lane can pre-filter its index — but is not
  required to, because the database re-checks regardless.
- **Honest states.** `DenseReport` carries `ACTIVE | DEGRADED | DISABLED |
  FAILED` plus `returned` / `hydrated` / `denseOnly`. `DISABLED` is not
  `HEALTHY` and `DEGRADED` is not `ACTIVE`: a reader must be able to tell
  "semantic search found nothing" from "semantic search is not running",
  because only one of those is a statement about the corpus. `denseOnly` is
  the number that says whether dense retrieval is RETRIEVING rather than
  re-ranking; a lane whose `denseOnly` is always 0 is doing the latter.
  `lanesAttempted` no longer records `"dense"` for the noop lane, which used
  to make every result claim semantic search had run.
- **Consequences:** one extra round trip per query that has dense-only ids,
  and none when there are none. A dense failure is contained like any lane
  failure.
- **Evidence:** `control-plane/tests/store/denseLane.test.ts` (14) against the
  real scratch PostgreSQL, including a query and passage chosen to share NO
  stemmed lexemes (proved first: the lexical lanes cannot find it), an
  out-of-scope dense id that never becomes a hit, and a stale index entry that
  is dropped rather than raised.
- **Rollback:** `NoopDenseLane` remains the default; nothing changes until a
  real lane is wired.

---

## ADR-032 — Exhaustive Matter analysis is a census, and processing coverage is derived

- **Status:** accepted (2026-09-11, W19 phases G+H)
- **Context:** "Review the whole file", "find all contradictions", "compare
  all witness statements" are semantically different tasks from "what is the
  limitation period". `POST /v1/answer` is top-K retrieval, and top-K is a
  ranking, not a census: it is mathematically incapable of proving it looked
  at everything, no matter how large `resultLimit` is set. The two halves of a
  contradiction are typically far apart (a claim in the petition, the expert
  report 600 pages later) and rarely share wording, so no ranked result set
  contains both.
- **Candidates:** (a) raise `resultLimit` / `perDocumentCap` — does not change
  the mathematics and silently degrades latency; (b) feed the whole matter to
  a model in one prompt — does not fit, and the answer is unauditable even
  when right; (c) a separate durable execution path that walks every unit.
- **Decision:** (c), as Map → Aggregate → Reduce over ANALYSIS UNITS, on its
  own routes (`POST/GET /v1/matters/{matterId}/analysis`). `/v1/answer` is
  untouched and stays fast.
- **Analysis units are not retrieval chunks.** A chunk is sized to be FOUND
  (one paragraph, so a citation is tight); a unit is sized to be UNDERSTOOD
  (enough surrounding text that a statement can be read with the sentence that
  qualifies it). A unit is a contiguous RUN of whole chunks, so its span is
  still an exact slice of canonical text, it maps onto chunks (hence quote
  hashes) and onto segments (hence physical pages). It spans from the first
  chunk's start to the last chunk's end INCLUDING the text between them, so an
  exhaustive review does not skip headings the chunker had no use for.
- **`processingCoverage` is a DIFFERENT CONCEPT from `coverage`.**
  `answer/coverage.ts` measures how much of the QUESTION the evidence answers
  and gates abstention; its meaning is locked by tests and is unchanged.
  `processingCoverage` measures how much of the SELECTED SCOPE was read. The
  two are independent, and an answer can have excellent question coverage over
  a matter that was only half read — which is exactly the failure this makes
  impossible to hide.
- **`complete` is DERIVED, never asserted.** It is a pure function of counts
  in one function (`deriveCoverage`): every selected file processed and none
  failed, no page left unreadable, every unit processed and none failed, no
  recorded gap. One failed unit out of 1 846, or one unreadable page, and it
  is false with the gap itemized. An empty scope is NOT complete — "I reviewed
  all zero of your documents" is not a review. No model can influence it.
  `refuseExhaustiveClaim` is the single guard any surface must call before
  rendering "tüm çelişkiler" or "dosyanın tamamı", and counts are reported
  rather than percentages because "97% covered" rounds to "covered" in a
  reader's head.
- **Durability and resumption.** Every unit is a row (`pending`) BEFORE any
  analysis begins, so the census exists even if the process dies immediately.
  The reuse key is `unitNo + sourceSha256` — BOTH halves are load-bearing. The
  hash alone is not enough: a long file legitimately contains two units with
  byte-identical text (repeated boilerplate), and keying on the hash alone
  marked the second one done without ever emitting its observations, silently
  dropping it from the census while coverage still counted it as read. This
  was found by the interruption test and fixed before the phase closed.
- **A difference is not automatically a contradiction.** The verdict
  vocabulary keeps the weaker readings available — `CONTRADICTION`,
  `TENSION`, `CORROBORATION`, `INDEPENDENT`, `INSUFFICIENT_EVIDENCE` — because
  reporting every difference as a contradiction buries the two that matter
  under forty that do not, and a lawyer stops reading the list. Comparison is
  a table a reviewer can audit: normalized values, an explicit topic-overlap
  threshold, both source spans on every verdict.
- **The topic key is a labelled heuristic.** Deriving a grammatical subject
  from Turkish free text is not something patterns can do, so "subject" is the
  significant word stems around the value and comparability is Jaccard overlap
  above `DEFAULT_SUBJECT_OVERLAP = 0.4`. It decides what is EXAMINED, never
  what is ASSERTED, so being slightly generous costs a reviewable
  `INDEPENDENT` verdict rather than a false claim. It has NOT been measured
  against real Turkish case files.
- **Consequences:** four new tables, four new RLS policies (19 → 23). The
  deterministic extractor (dates, amounts, ratios) means the engine works with
  NO model configured and is fully reproducible; a model may ADD observations
  later but never edits a span or a quote.
- **Evidence:** `control-plane/tests/exhaustive/exhaustive.test.ts` (39),
  including contradictions planted in documents far apart, an interrupted run
  that never reports complete coverage, and resumption that recomputes only
  what changed; `tests/exhaustive/exhaustiveHttp.test.ts` (11) end to end over
  HTTP against the real database.
- **Rollback:** the routes mount only when a database is configured and
  nothing else calls into the engine; removing the mount removes the feature.

---

## ADR-033 — Trusted-local inference boundary: three trust levels and a mandatory allow-list

- **Status:** accepted (2026-09-11, W19 phase F)
- **Context:** privileged legal text is about to be sent to a model. The only
  notion of "local" in the AI lane was a hardcoded `127.0.0.1` in the
  embedding config; the Anthropic adapter's base URL was never classified at
  all, and there was no way to say "this matter never leaves the machine" and
  have the system ENFORCE it rather than default to it. Provider selection was
  hardcoded to one vendor with no discriminator.
- **Candidates:** (a) a boolean `local` flag — cannot distinguish "on this
  machine" from "on a box on my LAN", which have different risk; (b) trust any
  private address — turns a configuration field into a request-forgery
  primitive; (c) three levels with an explicit allow-list for the middle one.
- **Decision:** (c). `LOCAL_PROCESS` (loopback; the bytes never touch a
  network interface), `TRUSTED_LOCAL_NETWORK` (a private-range host the
  operator listed explicitly, by `host:port`), `CLOUD` (anything else).
  A private address that is NOT listed is refused. Loopback needs no list
  because it cannot leave the machine. A DNS name is never local, even one
  that resolves to a private address today: we do not resolve DNS, and a name
  whose address record can change is not a trust boundary. Instance-metadata
  addresses are refused by name before any range test.
- **This is the OPPOSITE policy from `security/urlPolicy.ts`** and
  deliberately a separate module. That one guards outbound fetches of source
  documents, where loopback is an attack on the host and is rejected. Here
  loopback is the safest case. The two must not share a function.
- **`LOCAL_ONLY` has NO fallback.** It permits `LOCAL_PROCESS` and
  `TRUSTED_LOCAL_NETWORK` and forbids `CLOUD`. A local model being unavailable
  is a failure the caller is told about, never a licence to send the client
  file to someone else's computer. The boundary is re-checked on EVERY call,
  not only at construction: an adapter outlives one request, and a boundary
  asserted once is a boundary a later configuration change walks through.
- **Model-agnostic on purpose.** The adapter speaks the OpenAI
  chat-completions shape, which Ollama, llama.cpp's server and LM Studio all
  expose, so the model is a setting and no model family is named in code.
  Committing the product to one model in code is how you end up unable to
  measure a better one.
- **Small-machine defaults.** The intended appliance is an Apple M2 Mac mini
  with 8 GB unified memory, and it is OPTIONAL — with nothing configured the
  product works exactly as before on its deterministic ports. Concurrency
  defaults to 1 (a second concurrent generation on that hardware evicts the
  first one's cache rather than halving latency) and the context ceiling is a
  SETTING, because a model card claiming 128K context does not mean 128K fits
  in 8 GB alongside the weights.
- **NO PERFORMANCE NUMBER IS CLAIMED.** That machine has not been measured
  from here. `control-plane/scripts/probe_local_generation.mjs` is how a
  number gets produced — by running it on the box — and until it has been run
  no throughput figure may be written in STATUS.md or anywhere else.
- **The drafter port is deliberately NOT implemented.** A small local model is
  not trusted to compose a legal claim; a drafter that invents text would
  defeat the entailment gate rather than pass it. The adapter offers structured
  JSON extraction and entailment judgement, and a judge that cannot answer
  returns "not entailed" — the conservative direction, because an unsupported
  claim must never be finalized because the judge was down.
- **Evidence:** `control-plane/tests/llm/localGeneration.test.ts` (37),
  including the scenario where a cloud transport FAILS THE TEST if it is ever
  called under `LOCAL_ONLY`, and the no-fallback case where a dead local model
  does not become a cloud call.
- **Rollback:** unset the environment variables; `resolveDataBoundary`
  defaults to `ALLOW_CLOUD`, so existing installs are unchanged.

---

## ADR-034 — Durable Matter analysis: leased units, a frozen run identity, and immutable version snapshots

- **Status:** accepted (2026-09-11, W20)
- **Context:** W19's census (ADR-032) ran synchronously inside the HTTP
  request. It persisted per-unit results, so an interrupted run could be
  re-issued, but nothing resumed it: a crashed server left units `running`
  forever, there was no retry budget, no cancellation, no progress to poll,
  and a model-assisted run (minutes to hours on a small appliance) could not
  be expressed at all. Two runs over the same scope could also race each
  other, and the run did not record which document versions it had read.
- **Candidates:** (a) keep the synchronous route and raise the timeout —
  cannot survive a restart and ties a lawyer's browser tab to the work;
  (b) an in-memory queue — loses everything on restart, the exact case this
  wave exists for; (c) a job table in PostgreSQL with leases, owned by a
  worker that may run in the server process or as its own process.
- **Decision:** (c), in `20260912090000_durable_matter_analysis.sql` (additive
  — no older migration was edited) and `control-plane/src/exhaustive/
  {durableStore,worker,identity}.ts`.
  1. **POST returns 202 with the run id; nothing is analysed in the request.**
     The route only freezes the identity, takes the census of units and
     returns. `GET …/analysis/{runId}` is the progress view.
  2. **Units are claimed with `for update skip locked` and a lease**
     (`lease_owner`, `lease_expires_at`). A unit's observations are inserted
     and the unit is marked `done` **in one transaction, guarded by the
     lease**: a worker that lost its lease cannot write (it gets
     `LeaseLostError` and stops), so a stalled worker waking up late cannot
     double-write over the unit's new owner.
  3. **Stale recovery is a state transition, not a guess.** A `running` unit
     whose lease expired goes back to `pending` — or to `failed` with a
     Turkish reason when `attempts >= max_attempts` (3). Retries back off via
     `available_at`. A unit that exhausts its budget is a terminal
     `UNIT_FAILED` gap, never a silent skip.
  4. **Reduce is its own leased stage** and is claimed only when no unit is
     `pending` or `running`. It reads ONLY persisted observations (never
     in-memory state from the map stage), so a reduce after a restart sees
     exactly what a reduce without one would have.
  5. **Observation identity is content-addressed.** `observation_key` =
     sha256 over (run, unit, origin, producer version, kind, offsets,
     value), with a unique index and `on conflict do nothing`: a unit
     processed twice (crash after insert, before `done`) cannot duplicate a
     finding.
  6. **The run identity is frozen and hashed**: tenant, matter, task, the
     sorted file ids AND their document-version ids, unit-builder version,
     extractor version, model schema version and model id. At most one
     ACTIVE run may hold an identity (unique partial index); a concurrent
     POST with the same identity joins the existing run instead of starting
     a second one.
  7. **Source replacement = immutable snapshot + stale flag + new run.** A run
     reads the versions it froze; if a document is replaced mid-run, the
     worker's per-unit sha check refuses to analyse the new text under the
     old identity, and the run view reports `stale: true` with the changed
     files listed in `sourceChanged`; the remedy is a new run. A finished run
     is never silently rewritten against new text.
  8. **Cancellation is cooperative and final**: `cancel_requested_at` is set
     by the route, the worker sweeps it into `cancelled`, and a cancelled run
     is never `complete`.
- **Coverage stays derived** (ADR-032 unchanged): three reasons were added —
  `UNIT_NOT_PROCESSED` (compacted ranges of units still pending/running when
  the view is read), `SYNTHESIS_FAILED` (the reduce-stage model step failed;
  deterministic findings are kept but the run may not claim the model part)
  and `OCR_LOW_CONFIDENCE` (ADR-038).
- **Evidence:** `control-plane/tests/exhaustive/durableRun.test.ts` (lease
  loss, stale recovery, retry exhaustion, cancellation, identity join,
  source replacement, duplicate-insert idempotency),
  `durableProcess.test.ts` (**a real child process is killed with
  `SIGKILL` mid-run and a second worker process finishes the run** — same
  findings as an uninterrupted run), `exhaustiveHttp.test.ts` (202 +
  polling through the mounted app).
- **Rollback:** the W19 tables are untouched and the W19 columns keep their
  meaning; stopping the worker leaves runs `queued`, which the view reports
  as not processed.

---

## ADR-035 — The model proposes, the application locates: exact-quote extraction and evidence-bound Matter Intelligence

- **Status:** accepted (2026-09-11, W20)
- **Context:** W19's extractor was deterministic and could only see dates,
  amounts and ratios. Claims, defenses, evidence, legal issues and the
  claim↔evidence map need a model — and a model will paraphrase, re-flow
  whitespace, invent a plausible quote, or "fix" a typo in the source. Any
  of those, stored as an offset into the document, is a fabricated citation.
- **Candidates:** (a) trust the model's offsets — models cannot count code
  points; (b) fuzzy-match the model's quote — a similarity score turns a
  near-miss into a citation, which ADR-023 already forbids for drafts;
  (c) the model returns a verbatim quote and the application finds it.
- **Decision:** (c), in `control-plane/src/exhaustive/modelExtractor.ts`.
  The model's output is parsed against a strict schema (unknown keys and
  kinds rejected). For each item the application searches the unit's
  canonical text for the quote **exactly** (NFC only — no whitespace
  folding, no case folding); zero or multiple matches reject the item
  (`rejected_quotes` / `invalid_items` counters on the unit); a match gets
  **app-derived code-point offsets**, is re-sliced from the canonical text
  and re-hashed (sha256) before it is stored. Quotes shorter than 8 code
  points are rejected as ambiguous. Every stored record carries the
  provider, model id, schema version and the model's confidence.
- **Matter Intelligence is relational, never a JSON blob.**
  `app_private.matter_intel_items` (entities, events, propositions, claims,
  defenses, evidence, legal issues, contradictions, open questions, and the
  red-team kinds), `matter_intel_sources` (role `basis/mention/support/
  oppose/ambiguous`, pointing at an observation → a verified span) and
  `matter_intel_links`. A **deferred constraint trigger refuses to commit an
  item without at least one source**: an unsourced conclusion cannot exist
  in the database, whatever the application code does. Intelligence is
  rebuilt by the reduce stage from persisted observations and is replaced
  wholesale on a re-run; a changed source marks it stale (ADR-034 §7).
- **Task honesty.** `contradictions` and `chronology` are deterministic and
  always available. `claim_evidence`, `full_review` and `red_team` REQUIRE a
  model: without a configured local model the route answers `409
  MODEL_REQUIRED` and the console shows the task as text with the reason,
  not as a button. None of them is quietly downgraded to the deterministic
  subset while keeping its name. Contradiction rationale is conditional
  ("aynı olaya ilişkinse … bağlamı kaynaktan doğrulayın"), never a verdict.
- **Evidence:** `control-plane/tests/exhaustive/modelTasks.test.ts` (fake
  quotes, re-flowed whitespace, duplicate matches, out-of-schema items,
  sourceless items refused by the database trigger, model-change refusal,
  MODEL_REQUIRED), `tests/evals/bakeoff.test.ts` (the same validator scores
  models: re-flowed whitespace scores quote validity 0).
- **Consequences:** a weaker model yields FEWER items, never wrong offsets.
  **No real model has been called in this wave**; every model path is
  exercised with scripted test doubles.

---

## ADR-036 — Private dense lane: exact cosine over locally stored vectors, stale by hash, no pgvector

- **Status:** accepted (2026-09-11, W20; supersedes the "dense lane off"
  state recorded under ADR-031)
- **Context:** ADR-031 made dense results safe to consume, but no lane was
  wired: `legal.embedding_profiles` pinned `dimensions = 1024` while the
  local E5 model produces 384, pgvector is not installed on the lawyer's
  machine, and there was no worker to produce vectors.
- **Candidates:** (a) require pgvector — a prerequisite this product has
  refused since W14; (b) an external vector database — a second store to
  back up, secure and keep consistent; (c) store float32 vectors as `bytea`
  and score exactly in the application, scoped to the files in question.
- **Decision:** (c), in `20260912100000_private_dense_vectors.sql` (the
  dimension CHECK is REPLACED by a range check 1..8192 in a new migration;
  the old file is untouched) and `control-plane/src/embeddings/`.
  Vectors are keyed tenant → document version → chunk → profile, stored
  L2-normalized little-endian float32, and carry the chunk's sha256: a
  vector whose chunk text changed is STALE and is not used. The worker is a
  consumer of the existing `app_private.jobs` queue (`kind='embedding'`),
  batched, resumable and idempotent (upsert per chunk+profile), with a
  backfill for versions that have none. The E5 prompt prefixes
  (`query:` / `passage:`) are part of the profile.
- **Scope, honestly:** this is **private (uploaded-document) dense search
  with exact cosine over the file scope**. It is NOT an ANN index and it is
  NOT public-corpus semantic search; without a file scope the lane returns
  nothing. Health reports `ACTIVE` / `DEGRADED` / `DISABLED` / `FAILED` with
  a live probe latency, never a configured-therefore-working claim.
- **Evidence:** `control-plane/tests/embeddings/denseLane.test.ts`
  (staleness, tenant/version scoping, stale-job requeue, health states),
  `realE5.test.ts` (**the real multilingual-e5-small ONNX model** embeds a
  query with no lexical overlap and the lane finds the passage — a
  semantic-only hit, measured, not mocked).
- **Rollback:** start the server without `--with-local-embeddings`; the lane
  reports `DISABLED` and the lexical lanes are unchanged.

---

## ADR-037 — One provider factory, role routing, and LOCAL_ONLY enforced at every AI entry point

- **Status:** accepted (2026-09-11, W20; extends ADR-033)
- **Context:** W19 built a trusted local adapter but wired it into nothing;
  the answer pipeline still chose between the rule-based drafter and the
  cloud lane, `/v1/ai/*` and cloud embeddings ignored `LOCAL_ONLY`, and
  each future caller would have constructed its own adapter with its own
  concurrency gate.
- **Decision:** `control-plane/src/llm/providerFactory.ts` resolves ONE
  route table from the environment — roles `answer`, `verifier`,
  `matterExtraction`, `matterSynthesis`, each optionally with its own model
  (`COLLEX_LOCAL_LLM_MODEL_<ROLE>`), all sharing one request gate per
  endpoint so an 8 GB appliance never sees two concurrent generations. No
  model family is named in code. The local drafter is wired into the
  **existing** `AnswerPipeline` (no parallel answer engine) and drafts
  citation-first: it is shown only the evidence pack, with its ids, and a
  claim must name at least one id. An id it was NOT given is deliberately
  passed through unchanged, so the existing verifier sees it and records
  `CITATION_INVALID` — silently dropping it would hide that the model
  invented a citation. Every model-written claim then goes through the
  existing verifier/entailment gate with the conservative aggregation. `LOCAL_ONLY` is now enforced at every AI entry:
  `useCloudAi` is refused before any cloud code runs
  (`CLOUD_AI_REFUSED_LOCAL_ONLY`), every non-GET `/v1/ai/*` returns `403
  DATA_BOUNDARY_LOCAL_ONLY`, and the cloud embedding provider is refused
  (`EMBEDDING_REFUSED_LOCAL_ONLY`). **There is no local→cloud fallback**: a
  failed local drafter falls back to the rule-based drafter
  (`LOCAL_DRAFTER_FALLBACK`), never to a cloud model.
- **Supersedes** ADR-033's "the drafter port is deliberately NOT
  implemented": the drafter now exists, but it is citation-first and gated —
  it cannot introduce an evidence id or finalize an unsupported claim.
- **Evidence:** `control-plane/tests/pipeline/localAnswer.test.ts` (a cloud
  transport that FAILS THE TEST if called under `LOCAL_ONLY`; dead local
  model → rule-based, cloud calls 0), `tests/llm/localGeneration.test.ts`.
- **Rollback:** unset `COLLEX_LOCAL_LLM_*`; the route table reports
  `not_configured` and the pipeline is the W19 pipeline.

---

## ADR-038 — Local OCR is a detected capability, never a download, and OCR text lands in the page's own slot

- **Status:** accepted (2026-09-11, W20)
- **Decision:** `intake/ocr.py` defines an `OcrProvider` boundary and one
  implementation (`TesseractCliProvider`: `pdftoppm` → `tesseract … tsv`),
  enabled only when both binaries are already on `PATH`
  (`COLLEX_OCR=auto|off|tesseract`). Nothing is installed or downloaded by
  the product. OCR text is written into the scanned page's own segment
  (same page number, `extraction_method='ocr'`, engine confidence), so a
  citation still reads "s. N" of the physical page. Confidence below 0.60
  is stored as `SPARSE` and surfaces as the `OCR_LOW_CONFIDENCE` coverage
  gap. Cloud OCR stays a separate, consented route and is refused under
  `LOCAL_ONLY`.
- **Evidence:** `tests/intake/test_ocr.py` (fake provider; page mapping,
  low confidence, provider failure, fail-closed when absent),
  `control-plane/tests/exhaustive/ocrCoverage.test.ts`. The real-binary
  smoke test **skips on this machine** because neither binary is installed —
  an environment blocker recorded as such, not a pass.

---

## ADR-039 — The review grid is a persisted, per-cell job, and its exhaustive columns reuse analysis units

- **Status:** accepted (2026-09-11, W20)
- **Context:** the W14 review grid ran entirely in the browser: closing the
  tab lost the work, a failed cell could not be retried alone, and an
  "extract all dates" column was really a top-k retrieval question.
- **Decision:** `20260912110000_review_tables.sql` +
  `control-plane/src/reviewTables/`. The EXISTING grid UI posts to
  `POST /v1/review-tables` (no new table UI was built); rows pin a document
  version; each cell is a leased job (`pending → running → done/failed`,
  attempts, stale recovery) processed by a worker;
  `POST /v1/review-tables/{tableId}/cells/{rowNo}/{columnNo}/retry` retries
  one cell; CSV export stays (with the formula-injection guard and a
  UTF-8 BOM). `answer` columns go through the existing `AnswerPort` scoped
  to the row's file; `extract_dates|amounts|ratios` columns go through the
  analysis-unit census, so their cell says `exhaustive_complete` only when
  every unit of that document was read — a scanned page makes it
  `exhaustive_incomplete`. When the server store is unavailable the grid
  falls back to the old in-browser run and says so.
- **Evidence:** `control-plane/tests/reviewTables/reviewTables.test.ts`,
  `tests/pipeline/consoleW20.test.ts`.

---

## ADR-040 — Reading everything is not analysing everything: three coverage contracts

- **Status:** accepted (2026-09-11, W21)
- **Context:** W20 made "every selected page and unit was read" provable
  (`processingCoverage`, ADR-032/034). The stages after reading then worked on
  PREFIXES — the first 25 claims (`MAX_CLAIMS_LINKED`), 8 lexically similar
  candidates per claim (`MAX_CANDIDATES_PER_CLAIM`), the first 40 findings for
  the synthesis (`MAX_DIGEST_ENTRIES`), and an unnamed `.slice(0, 16)` on
  synthesized points — and a response over 40 items per unit was cut and
  folded into `invalid_items`. A run could therefore read 928/928 pages and be
  shown as complete while most of its claims were never weighed. The only
  signal was a note in `result_summary`.
- **Candidates:** (a) raise the constants — moves the cliff, keeps it;
  (b) widen `processingCoverage.complete` to mean "everything" — overloads a
  contract other code and tests rely on and makes it impossible to say "all
  pages read, analysis unfinished"; (c) separate, derived contracts.
- **Decision:** (c), in `control-plane/src/exhaustive/analysisCoverage.ts`:
  - `processingCoverage` keeps its W19/W20 meaning (source read) and nothing
    else — W21 even moved W20's `SYNTHESIS_FAILED` gap out of it;
  - `ExtractionCoverage` (per unit: attempted / succeeded / incomplete /
    failed; generated, grounded, malformed, not-found and ambiguous quotes,
    truncated responses, continuation and repair passes);
  - `IntelligenceCoverage` (claims and defenses weighed / failed / pending /
    unresolved, planned vs completed candidate comparisons, contradiction and
    synthesis groups processed, unresolved / failed / truncated stages);
  - `AnalysisCompleteness`, the ONE place the three are combined into the
    sentence a lawyer reads; `complete` only when all three are complete.
  Each `complete` is derived from counts in exactly one function. A claim the
  planner never gave a task counts as pending, so a planner bug cannot yield
  a complete coverage. `sourceComplete && !intelligenceComplete` is a normal,
  reported state, and the console shows it as "Dosyanın bütün sayfaları okundu,
  ancak inceleme tamamlanmadı".
- **Evidence:** `control-plane/tests/exhaustive/w21Stages.test.ts` (I, pure),
  `w21Analysis.test.ts` (I through the API and the runs list),
  `tests/pipeline/consoleW21.test.ts` (the console never composes the
  whole-analysis sentence itself).
- **Amendment (W21 hostile self-review, 2026-09-17):** round one found that
  `exhaustiveClaimRefusedBecause` could be null while weighing or synthesis had
  failed or was still running (#2): it now also refuses when
  `analysisCompleteness` is incomplete. A cancelled or save-failed run no
  longer reads "no findings came out of this review" (#3), and the gap list
  says how many lines it did not show (#4).
- **Amendment (W21 second hostile review, 2026-09-17):** a run no longer speaks
  for a matter that changed after it. A whole-matter run whose matter gained a
  document (`sourceAdded`), or whose pinned document changed, was deleted or
  left the matter (`sourceChanged`, `sourceRemoved`), is `stale`: its
  `analysisCompleteness.complete` is false, `exhaustiveClaimRefusedBecause`
  names the reason, and the list and intelligence views never call it complete.
  The snapshot records `wholeMatter`. A failed or cancelled run's gaps say what
  was not done ("tamamlanmadı"), never "henüz", and the console shows the
  stored Turkish reason.

---

## ADR-041 — Analytical stages are durable leased tasks; the reduce stage orchestrates

- **Status:** accepted (2026-09-11, W21; extends ADR-034)
- **Decision:** `20260913090000_analysis_stages.sql` adds
  `app_private.matter_analysis_tasks`: one row per analytical task — each
  claim or defense against one bounded batch of candidates, each batch of
  free-text proposition pairs, each synthesis group at each level — with
  lease, attempts, backoff, stored input and result, and a unique
  `(run_id, stage, task_key)`. Tasks are claimed with `for update skip
  locked`; the result is written in the SAME statement that marks the task
  done, guarded by the lease; stale leases are recovered; a task that
  exhausts its budget is `failed` and keeps coverage incomplete; an
  exclusion always carries its reason (CHECK constraint).
  The W20 reduce stage became an ORCHESTRATOR (`stagePlanner.ts`): claimable
  only when no unit and no task of the run is pending or running, it either
  inserts the next step's tasks with a `plan` marker in one transaction, or
  finalizes from persisted rows only. Planning passes do not consume the
  stage retry budget (`releaseAfterPlanning`).
  Per-call bounds are configuration (`COLLEX_ANALYSIS_*`, `resolveStageConfig`
  ignores values that would disable the analysis); none removes anything
  from the analysis universe. Extraction/intel/stage schema versions are in
  the frozen run identity.
- **Evidence:** `w21Analysis.test.ts` A (70/70 claims weighed, one durable
  task each) and J (the worker dies after 20 of 70 weighings; a fresh worker
  makes exactly the 50 remaining calls, no duplicate task or item).
- **Amendment (W21 second hostile review, 2026-09-17):** the stage schema is
  `stage-v3`. Finalization never writes a source naming an observation the run
  no longer holds (a file deleted mid-run): such relations and sources are
  dropped and counted, and the run finalizes as incomplete instead of failing
  on a foreign key. The contradiction planner builds its clipped texts once per
  proposition, not once per pair.
- **Amendment (W21 hostile self-review, 2026-09-17):**
  - every jsonb write goes through `wellFormedJson`, and clips never end in a
    lone surrogate; a planning pass that keeps failing closes the run as
    failed after the stage budget, with its coverage (#14);
  - the task loop checks cancellation before each task, and
    `completeStageTask` refuses a cancelled run (#15);
  - `versionMismatch` refuses a run whose intel, stage or model schema
    version differs from the running code (`stage-v2`, `mx-v3`) (#16).

---

## ADR-042 — Hybrid candidate discovery, and "no support" only as strong as the search

- **Status:** accepted (2026-09-11, W21)
- **Decision:** `candidateDiscovery.ts` ranks EVERY evidence/fact item against
  every claim with independent signals — exact references (exhibit numbers,
  docket numbers, dates, amounts, plates), significant Turkish stems, local
  embeddings (W20 private E5, when available), shared entities, temporal and
  party compatibility, document structure. When the matter has at most
  `fullSearchMaxEvidence` (48) evidence items, every claim is compared with
  all of them. Above that, the candidate set is the union of the top items by
  combined, lexical and semantic signal plus every reference match — recall
  first, never capped below the union.
  Support states (`stageFinalize.ts`): `unsupported` is used ONLY for
  NO_SUPPORT_FOUND_AFTER_COMPLETE_SEARCH (every evidence item compared, every
  comparison answered, and the extraction that produced the evidence was
  itself complete); otherwise `no_support_in_candidates`; a failed, pending or
  unanswered comparison is `search_incomplete`; a claim with no comparison is
  `not_weighed`. Only complete searches may become the red team's
  "unsupported proposition".
- **Evidence:** `w21Stages.test.ts` D (a weakly-worded supporting exhibit is
  found with embeddings and missed by lexical overlap alone; reference
  matches always included) and the search-state cases.
- **Amendment (W21 hostile self-review, 2026-09-17):** "no support after a
  complete search" now also needs the SOURCE complete (#1, #5), the universe
  is every `SUPPORT_UNIVERSE_KINDS` item, not only what the model labelled
  evidence (#6), and the universe the weighing was planned over must equal the
  universe the finalizer builds (#16 leftover). An ambiguous verdict never
  becomes `unsupported` (#7). A verdict or candidate whose ref no longer
  resolves counts as unresolved and makes the claim `search_incomplete`, with
  the counts in the run summary (#11). Party sides are read from the
  principal designation of the whole label: counterclaim qualifiers
  (`karşı`, `K.`, `mukabil`, `karşılık`) flip the side, a joined/separated
  case is undecidable, and a label naming both sides is `unknown` — counted,
  never listed as the client's (#12). Exhibit references accept the inflected
  Turkish forms and `No.lu` (#13). Weighing judges verified quotes, the
  document text stays inside the untrusted block, and fake `[eN]` or section
  labels inside it are neutralised (#8, #9).
- **Amendment (W21 second hostile review, 2026-09-17):**
  - an item whose span overlaps the claim's own span (a date window around the
    claim sentence) is not weighed against it (`selfOverlapExcluded`); the
    weighing prompt says a restatement of the claim is not support;
  - quotes are shown up to 600 (candidate) / 800 (claim) characters; a clipped
    quote is recorded and keeps the model's summary as a labelled line, and a
    "no support" reached on clipped text is never "unsupported";
  - support found while other comparisons of the claim failed is
    `search_incomplete` (with `supportsFound`), not `supported`;
  - the status carries the verified quote it was reached on (`judgedText`,
    `judgedQuote`), and the missing-support and unsupported-proposition titles
    name that quote, never the paraphrase;
  - every support-bearing kind a task extracted stays in its universe (red
    team's procedural events and credibility issues); the missing-support
    title names exactly the kinds the task's universe holds;
  - a side in a joined case ("birleşen dosya davacısı") is `unknown`; more
    exhibit spellings are read ("Ek No: 3", ASCII "numarali", any dash) and
    article numbers or amounts are not.

---

## ADR-043 — A semantic contradiction lane beside the deterministic one

- **Status:** accepted (2026-09-11, W21); model quality NOT measured
- **Decision:** `semanticContradictions.ts`. Input: verified model propositions
  only (quotes already located in the pinned source). Pairing is deterministic
  and recall-oriented (shared entity, stem overlap ≥ 0.34, local-embedding
  cosine ≥ 0.86, same date), connected pairs form groups, groups are
  classified in bounded batches as durable tasks with the vocabulary
  CONTRADICTION / TENSION / CORROBORATION / INDEPENDENT / INSUFFICIENT_EVIDENCE;
  the prompt says a language difference is not a contradiction. Relations are
  stored with detector `semantic-v1` and exposed with `lane: "semantic"`; the
  W20 value lane stays `lane: "deterministic"`. Both sides of every relation
  are stored observations with exact spans.
- **Scope:** runs in `full_review` and `red_team`. `contradictions` stays the
  deterministic task and its limit text says so. With only scripted
  classifiers available, the lane's architecture is tested; its legal quality
  is REAL_MODEL_MEASUREMENT_PENDING.
- **Amendment (W21 hostile self-review, 2026-09-17):** the lane classifies the
  two VERIFIED quotes, never the model's paraphrase; a pair without both
  quotes is not sent and keeps the lane incomplete (#8).
- **Amendment (W21 second hostile review, 2026-09-17):** a CONTRADICTION
  judged on a clipped quote is stored as a TENSION (`judgedOnClippedQuote`),
  with no follow-up question. Labels inside quotes (`[p2]`, side markers) are
  neutralised (`promptLabels.ts`).

---

## ADR-044 — Hierarchical synthesis instead of a bounded digest

- **Status:** accepted (2026-09-11, W21)
- **Decision:** `synthesisPlan.ts`. Every finding of a synthesis kind is placed
  in exactly one stable group (its legal issue, else its family) and every
  group is summarized in bounded batches (level 1); each next level summarizes
  the level below until ONE final task produces the `review_summary`. Each
  summary must cite what it was shown (an uncited summary fails the task); the
  union of observation ids travels upward, so the final summary still points at
  original spans. A failed lower task is never replaced by a guess — its
  findings are absent above it and synthesis coverage stays incomplete. Points
  beyond the per-call bound are reported as truncated.
- **Evidence:** `w21Stages.test.ts` B (100 findings: each in exactly one
  level-1 batch; the finding in the last batch is in the final task's
  provenance), `w21Analysis.test.ts` E (a final, source-linked summary).
- **Amendment (W21 hostile self-review, 2026-09-17):** level-1 synthesis
  entries carry the finding's verified basis quote next to the model's title,
  and the instruction says to rely on the quote when the two disagree; the
  group label travels inside the untrusted block (#9).
- **Amendment (W21 second hostile review, 2026-09-17):** a synthesis task that
  was not shown every lower part carries `missingParts`; the prompt bounds the
  evaluation to what it was shown and names the missing parts inside the data
  block, and the stored summary and points are `partial` with a note. A
  two-sided finding carries both quotes, and neither is presented as
  established. Forged `[oN]` / KISIM labels inside finding text are neutralised.

---

## ADR-045 — Extraction truncation is recoverable or reported

- **Status:** accepted (2026-09-11, W21; extends ADR-035)
- **Decision:** `modelExtractor.ts extractExhaustively`: a response over the
  per-call item bound is discarded and the unit is split at the text boundary
  nearest the middle and extracted again (up to 3 levels); unplaceable items
  (not found, or found more than once) get ONE repair call asking for an exact,
  unique quote, which the application locates exactly like the first; whatever
  is still truncated, malformed or unplaceable is counted and makes the unit's
  extraction `incomplete`. Ambiguous quotes are now counted separately from
  missing ones (`ambiguous_quotes`), and a quote refused by the provenance gate
  also marks the unit incomplete — failed extraction is never hidden inside a
  done unit.
- **Evidence:** `w21Stages.test.ts` C (60 items through continuation with exact
  offsets; permanently over-full responses reported; repair success and
  failure).
- **Amendment (W21 hostile self-review, 2026-09-17):** a repair is bound to an
  item only when it contains the item's original quote in order, no other
  unplaced item could claim it, and no two statements land on one span; the
  extractor version became `mx-v3` (#10).

---

## ADR-046 — A review-table row answers from its pinned version, exactly, or refuses

- **Status:** accepted (2026-09-11, W21; extends ADR-039)
- **Context:** W20 rows stored `document_version_id`, but retrieval filtered
  by file id and the temporal "current" test. After a re-upload a cell that
  was recomputed read V2 while the row still claimed V1.
- **Decision:** retrieval accepts `documentVersionIds`
  (`pipeline/ports.ts`, `retrieval/searchService.ts keepPinnedVersions`). For
  tenant rows it REPLACES the temporal test and only narrows inside the
  file and tenant scope. Every lane honours it: lexical, trigram, exact-pin,
  citation expansion, dense hydration (`embeddings/chunkVectorStore.ts`,
  `denseLane.ts`) and divergence (`store/chunkStore.ts` visibility filter).
  The worker (`reviewTables/worker.ts`):
  - refuses a pin that cannot be read exactly (`PinnedVersionRefusal`,
    terminal, no retry budget spent);
  - refuses an answer or abstention whose evidence names another version
    (`EVIDENCE_VERSION_MISMATCH`);
  - re-checks the pin AFTER the answer, so a version withdrawn while the
    cell was computed is refused, not stored as an abstention.

  The store reports `currentDocumentVersionId` (the newest PUBLISHED version;
  a failed or processing upload is never offered as current) and `stale`.
  A retry answers `CELL_BUSY` for a cell being computed before any pin
  check, and `409 ROW_VERSION_STALE` for an unreadable pin.
- **Known limit:** the dense lane only has vectors for versions the embedding
  worker processed. For a pinned, superseded version without vectors it
  contributes nothing; the lexical lanes still answer, and no other version
  is substituted. Dense health does not report this per row.
- **Evidence:** `control-plane/tests/store/retrievalVersionPin.test.ts`,
  `tests/reviewTables/versionPin.test.ts` (acceptance F and the W21 verifier
  fixes).

---

## ADR-047 — One application AI policy, decided before any port is touched; no silent local-to-cloud fallback

- **Status:** accepted (2026-09-11, W21; extends ADR-037); live-untested
- **Decision:** `control-plane/src/llm/aiPolicy.ts`. The policy variable
  `COLLEX_AI_POLICY` takes one of four values:
  - `LOCAL_ONLY`;
  - `LOCAL_PREFERRED`, the default (`AUTO` is read as it);
  - `CLOUD_ALLOWED`;
  - `DETERMINISTIC_ONLY`.

  It is combined with `COLLEX_DATA_BOUNDARY` into the effective policy and
  boundary once (`resolveEffectiveAiPolicy`, resolved once in `serve.mjs`).
  `decideProvider` is pure:
  - `DETERMINISTIC_ONLY` is always rule-based;
  - an explicit `useLocalAi` never reaches the cloud;
  - `useCloudAi` is honoured only where the policy and the boundary permit
    and a cloud is configured;
  - the default is the local model when usable, else rule-based, with
    `MODEL_UNAVAILABLE` under `LOCAL_ONLY` whether or not the request asked
    for the local model.

  An endpoint behind the local setting that is not on this computer or
  network is treated as an outside service. It is used only with
  per-request consent under `CLOUD_ALLOWED`, and the warning says an
  outside server wrote the answer.

  Matter analysis has no per-request consent. `decideModelTasks` lets the
  model tasks run only when both matter roles run on premises and the
  policy is not `DETERMINISTIC_ONLY`. The route table keeps the trust of an
  outside endpoint it refused, so health, the matter capabilities
  (`model.usable/code/reasonTr`) and the 409 message name the reason:
  `AI_POLICY_DETERMINISTIC`, `MODEL_UNAVAILABLE` (no model) or
  `MODEL_OFF_MACHINE` (the model is outside). The separate
  `analysis_worker.mjs` applies the same gate. `health.dataBoundary` now
  reports the EFFECTIVE boundary; the new `health.aiPolicy` shows the
  decision.
- **Measured (scripted endpoints, no real model):**
  - peak concurrent model calls 1 at concurrency 1, 2 at concurrency 2;
  - cloud calls under `LOCAL_ONLY` across 7 entry paths: 0.
- **Evidence:** `tests/llm/aiPolicy.test.ts`, `tests/llm/aiPolicyW21Fixes.test.ts`,
  `tests/pipeline/aiPolicyAnswer.test.ts`, `tests/exhaustive/modelTasks.test.ts`
  (W21 block).

---

## ADR-048 — OCR is a probed state with six codes; restore verifies, merges and never drops; the runtime is portable

- **Status:** accepted (2026-09-11, W21; extends ADR-038 and the W14 backup)
- **OCR:** `intake/ocr.py` reports one of six codes through
  `python -m intake.ocr --status`:
  - `OCR_READY`;
  - `OCR_DISABLED`;
  - `OCR_EXECUTABLE_MISSING`;
  - `OCR_TURKISH_DATA_MISSING`;
  - `OCR_RASTERIZER_MISSING`;
  - `OCR_FAILED`.

  `control-plane/src/ocr/ocrStatus.ts` probes once per process.
  `/v1/health.ocr` waits at most 250 ms for that answer and is `null` until
  it arrives. A failed or unparseable probe is `OCR_FAILED`, never ready.
  Only `OCR_READY` lets a scanned page be read. This machine reports
  `OCR_EXECUTABLE_MISSING`.
- **Restore:** `node control-plane/scripts/backup.mjs --restore <dir> --yes`
  (`runRestore`) runs in this order:
  1. verify the backup first;
  2. require explicit confirmation;
  3. take a safety dump;
  4. rename the existing database aside (never drop it);
  5. create the new database (`template0`, UTF8, locale C);
  6. run `pg_restore --exit-on-error`;
  7. merge the originals: same bytes stay, different bytes are set aside as
     `.eski-<stamp>`, nothing is deleted, copies use `COPYFILE_EXCL`;
  8. re-verify every original in place.

  A filesystem error after `pg_restore` is reported per file, never thrown.
  The backup CLI defaults to the same folder as the console's backup
  button. Measured: a real end-to-end restore took 2591 ms.
- **Portability:** runtime paths come from `path`/`os`, never drive letters.
  The macOS scripts in `deploy/macos/` are forced to LF by `.gitattributes`.
  `collex-env.sh` reads `~/.collex/collex.env` for both launchd and manual
  runs, and refuses an unreplaced `__…__` template placeholder with exit
  code 64.
- **Evidence:** `tests/intake/test_ocr_status.py`, `control-plane/tests/ocr/ocrStatus.test.ts`,
  `tests/backup/restore.test.ts`, `tests/portability/*`, `tests/test_portability_macos.py`.

---

## ADR-049 — Evaluation harnesses measure and never pick a winner

- **Status:** accepted (2026-09-11, W21; extends the W20 bake-off)
- **Embeddings:** `control-plane/src/evals/embeddingEval.ts`,
  `scripts/embedding_eval.mjs`. The same labelled cases run through any
  `EmbeddingPort` with the product's own query/document formatting. It
  reports:
  - R@1/3/5/10, MRR and graded nDCG@10;
  - semantic-only recall — a passage counts only when the annotator's flag
    AND the product's lexeme matcher agree it shares no content word;
  - latency p50/p95, failure codes, dimension checks, start-up time and
    memory.

  Synthetic cases are labelled as such.
- **Matter gold:** `collex.matter.gold/v1` (`matterGold.ts`,
  `evals/gold/matter-gold.schema.json`, `MATTER_GOLD_FORMAT.md`) is scored
  per category. Expected abstentions report `violated` and `unverifiable`
  separately; an unverifiable one is never counted as respected.
  Completeness is `met`, `not_met` or `unknown`. A contradiction's
  alternatives must name the side they restate. A run event is never
  credited with a finer date than its own `datePrecision`. Lawyer files
  (`*.lawyer.*`) are git-ignored.
- **Bake-off:** `semantic_contradiction` and `claim_weighing` run through
  the PRODUCTION request builders and validators. False contradiction and
  false support, the errors that become false legal conclusions, are
  measured on their own.
- **Measured** (local E5, 22 synthetic cases, re-run after the
  semantic-only fix with identical quality figures):
  - R@1 0.379, R@3 0.864, MRR 0.890, nDCG@10 0.703;
  - semantic-only R@1 0.136, R@3 0.795;
  - per-call p50 19.3 ms / p95 36.4 ms, query p50 7.2 ms;
  - start-up 2662 ms, memory 477.4 → 484.2 MiB.

  No language model was measured: REAL_MODEL_MEASUREMENT_PENDING.
- **Evidence:** `tests/evals/{embeddingEval,matterGold,bakeoffSemantic,bakeoffWeighing}.test.ts`.

---

## ADR-050 — The production host is one always-on Mac mini M2 (8 GB) running everything — designed, not validated

- **Status:** accepted as a design (2026-09-11, W21); UNVALIDATED ON PHYSICAL MAC
- **Decision:** `docs/implementation/MAC-MINI-PRODUCTION.md` lays out the
  single-machine topology:
  - PostgreSQL 18;
  - the control plane with its in-process analysis worker (model
    concurrency 1);
  - the local E5 embedder;
  - an optional local model server on `127.0.0.1:8080`;
  - Homebrew tesseract and poppler for OCR.

  Supporting pieces:
  - launchd templates `com.collex.{postgres,app,llm,backup}`;
  - `deploy/macos/collex-{env,start,stop,backup,restore}.sh`;
  - `BACKUP-RESTORE.md`;
  - `WINDOWS-TO-MAC-MIGRATION.md`, 26 numbered steps, each with commands,
    verification and rollback.

  No cloud service and no second machine is required.
  `MAC-MINI-INFERENCE.md` is kept as the interim topology (a separate
  inference box) and is not the production plan.
- **Honesty:** the 8 GB budget is an ESTIMATE. No command in these documents
  was run on a Mac, and no Mac number exists.
- **Evidence:** `tests/portability/productionHost.test.ts`, `tests/test_portability_macos.py`.

---
