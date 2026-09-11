# Implementation plan

Source: master build brief §14.1. Effort figures are focused person-weeks for
one experienced developer and exclude external legal review, provider
approvals, production credentials and large corpus backfill wait time.

Live status lives in `docs/implementation/STATUS.md`; the mapping of
requirement → file → test → measured result lives in
`docs/implementation/TRACEABILITY.md`. This file holds the phase plan and its
gates.

Last updated: **2026-09-02**, **after W14 phase F** (W12 backend, the W13
intelligence wave, the W14 build wave with its console pass, the independent
verification lane `waves/W14-L-VERIFY.md` and the three fix lanes
`W14-F-{PERF,API,UI}`). No number is repeated here: every state cell cites a
`STATUS.md` "Ölçülen sayılar" row (S1–S40).

## Phase table (brief §14.1) with gates

"State" is where this repo actually stands on 2026-09-02, with the command
that proves it. Anything not proven by a command is not marked done. W14 did
not add a phase: it filled in phases 3, 6, 7, 8 and the first real piece of 9
(backup and a rehearsed restore), and phase F then fixed 19 of the 22 defects
the verification lane found in that work.

| Phase | Scope | Effort | Gate (exit criteria) | State (2026-09-02) |
|---|---|---:|---|---|
| 0 — Security, repo baseline, eval start | Secret incident, canonical repo, dirty-state protection, inventory, CI, gold-set skeleton, baseline | 1 wk | Rotation/revocation listed as external action; old deploys out of traffic; clean reproducible baseline; tool graph; offline CI PASS | **DONE except the user action.** CI has five jobs; `pytest` exit 0 (02.09.2026, count in STATUS S3), `smoke_check.py` 54 tools (S4), both exit 0. **Key rotation is still pending (SEC-2026-08-26-001 OPEN)** and old deployments are the user's to withdraw |
| 1 — Provider gateway resilience | Error taxonomy, canonical fetch, `page_size`, 9-tool façade, limiter/breaker/bulkhead, amendment resolver | 2-3 wk | Contract tests; no empty-on-error; fetch/markdown parity; common-mode containment; resolver curated tests | **DONE offline.** Breaker with admission epochs + deadline-bounded bulkhead + typed Outcome; `tests/test_facade_contracts.py` proves no facade returns a silent empty list (Deep Research `search` included); fetch/markdown parity proven. Live upstream regression not run (quota; user decision) |
| 2 — Canonical corpus/provenance | Migrations, snapshot/document/version/chunk/relation/job, idempotent ingestion | 2-3 wk | Every chunk resolves to exact version/hash/offset/source; dedupe/idempotency; temporal model | **DONE on the local scratch PG; NOT on any real target.** `db_local_check.py` exit 0, 18/18 (02.09.2026) — including the two P0 fixes (RLS through the owning document, SQL-enforced close-on-append), chunk non-overlap and the W12 matters migration + ledger (c14, ADR-020). `ingestion/` ingests the fixture corpus with provenance (`tests/ingestion/`). Migrations `080000`/`090000` never executed (no pgvector) |
| 3 — Hybrid retrieval | Exact parser, Turkish normalize, FTS/trigram, pgvector/HNSW, model bake-off, RRF/rerank | 3-4 wk | Gold set; Recall/nDCG/exact/latency/cost gates; persistent public corpus | **PARTIAL — the dense half is missing and scale is now measured, not assumed.** Exact-pin + `turkish` FTS (coverage mode, ADR-007) + `pg_trgm` `word_similarity` + RRF + diversity cap + citation expansion (ADR-009) + the citator/relations lane (ADR-015) + divergence completion (ADR-008) all run and are measured (`run_evals.py` exit 0, S6). W14 made the trigram lane use its index and phase F made it a budgeted fallback: over 20 000 chunks a common word went from **no answer in 47–59 s** to a real answer in **≈3,8 s**, and a document-scoped question is **71–73 ms** (S25‴, S26⁐). **The measurement's second half is the honest one:** a phrase that is nowhere in the corpus is now the SLOWEST query — **≈7,5 s, and it returns nothing**. **pgvector/HNSW and the model bake-off are still blocked**, the residual cost sits in the lexical lane, and every gate is met on a SYNTHETIC corpus only |
| 4 — Citation/verifier | Evidence pack, claim graph, deterministic quote/hash, entailment, currentness/authority/conflict, abstention | 2-3 wk | Citations resolve 100%; fabricated ID 0; no evidence-free "supported" material claim | **DONE at the mechanism level.** Four hard gates PASS by code (`run_evals.py` exits 1 if any fails; `evals/tests/test_gates.py` flips each one to FAIL). `demo.mjs` S5 rejects a one-character tamper (7/7); S2 abstains with zero source cards (8/8). Since W12-B abstention also fires on a **non-empty but off-topic** evidence set: the question-coverage gate (ADR-017; answer-layer abstention precision/recall 100%/100% on 13 no-answer rows, `fixture_baseline_2026-09-02`) — **lexical, floor 0.4, unvalidated on real law**. Answer *quality* is unmeasured (rule-based drafter; `required_claims` not scored) |
| **MVP gate** | **Search + evidence + safe sourced answers** | **10-14 wk total** | Usable evidence core on production-like staging via ColleX/API/MCP | **NOT PASSED** — no staging, no real corpus, no lawyer-validated gold set |
| 5 — Deep Research | Capability registry, planner/policy/executor/verifier, durable runs, contrary branch, budgets, resume | 3-4 wk | Beats a single-pass baseline in lawyer eval; bounded/resumable/partial-safe | **PARTIAL.** Registry (54 tools → 7 capabilities), bounded executor, planner templates, the contrary branch and the live MCP path (`/v1/research`, `/v1/research/start` + polling with lawyer-Turkish progress labels, per-call timeouts) exist and are tested (`vitest` exit 0; count in STATUS S2). Since W12 a **finished live run is durable** through the answer store (`PgAnswerStore`, `mode:'live'`); the in-flight progress feed is in-memory (16 runs, 30 min TTL). **No LLM planner is wired** (the cloud lane is a per-request drafter/entailment port, not a planner), and the "beats a baseline" gate needs the gold set. Live upstreams were unreachable from this machine during W12 (typed `UPSTREAM_UNAVAILABLE`) |
| 6 — Upload/private corpus | Object storage, quarantine/parser/OCR, private vector lane, RLS, retention/deletion | 3-5 wk | Cross-tenant 0; page provenance; full deletion; OCR gate | **PARTIAL (local).** Intake with quarantine (25 MB, magic/MIME, ZIP gates), PDF/DOCX/TXT/UDF extraction with a **per-page** text-layer gate (`SCANNED_PAGES:<n>`, fully scanned → fail-closed), `/v1/files` with pagination/503/504, file-scoped answers (`filters.fileIds`, `origin:'upload'`), `intake.cli --delete`. OCR exists only as the **opt-in cloud lane** (`/v1/ai/ocr`, live-untested). W14 added a page ceiling read from the PDF header before extraction, atomic original writes, folder intake (`--dir`, ≤ 200 files, one code path) and `GET /v1/files/{id}/original`; phase F fixed the seam that made that download 404 on every `COLLEX_DATA_DIR` installation (S31, V-4). No object storage (originals under `<COLLEX_DATA_DIR>/uploads`, default `var/uploads`), no private vector lane (pgvector absent), no retention policy engine |
| 7 — Matter memory | Matter entity/fact/timeline/instruction, user edit/delete, evidence-set follow-up | 2-3 wk | Explicit, scoped, provenanced, correctable memory | **DELIVERED LOCALLY (W12-A + integration, ADR-016).** `app_private.matters/matter_items/answers/drafts/settings` (migration `20260902120000`, RLS), `/v1/matters*` CRUD with polymorphic items (file/answer/draft/note/event/deadline), auto-linking of answers/uploads/drafts/live runs to a matter with a 404 pre-check, `/v1/answers?matterId=`, `/v1/drafts?matterId=`, `/v1/matters/deadlines`, lawyer profile in `/v1/settings`. Every item is editable/deletable (`PATCH`/`DELETE …/items/{itemId}`). **In-memory fallback when the database is down** (`kayıt : bellek içi`) — the server never refuses to start. Proven by `db_local_check` c14, `tests/store/persistence.test.ts`, `demo.mjs` S6 10/10 and the HTTP probe (`W12-INTEGRATION.md` §6). Not done: a single-user posture only (RLS bypassed locally), no UYAP sync, `PgMatterStore.list` sized for one lawyer |
| 8 — Drafting/editor | Petition/response analysis, sourced outline/paragraph, redline, DOCX, human review | 3-5 wk | No sourceless legal paragraph finalized; export/audit | **PARTIAL — drafting v2 landed (W12-C).** 13 templates with grouped/kinded fields; evidence-disciplined composer (beyan/İRADE vs bound vs **KAYNAKSIZ**, never dropped); `PUT /v1/drafts/{id}` revision with linting → version+1, version history; uploads as `Ek-n` exhibits only (ADR-021); `K-n` citations, GG.AA.YYYY dates, `ek-dogrulama` section; DOCX export re-verified on re-open (exit 2 refusal); **UDF export deneysel** (ADR-019, unverified in UYAP); optional cloud paragraph with entailment ≥ 0.85 (ADR-018, live-untested). W14 added the quote-integrity gate (ADR-023 — a tampered quote breaks the bond and refuses the export, verified in a real browser), export modes (ADR-024 — an A4, formatted NİHAİ copy with zero machine strings in it), the citation-audit report and the pre-filing checklist. Not done: petition/response *analysis* beyond heuristics and the opt-in cloud analysis, redline, a lawyer review workflow beyond the review banner, and the console halves of the checklist and the final-copy button |
| 9 — Production hardening + corpus scale | SLO, OTEL, cost caps, load, backups, DR, security, source register, rollout | 5-9 wk | Restore/failure-injection/staging/security/legal gates; deployment ready | **BARELY STARTED.** The one piece that exists is backup/restore: a manifest-verified `pg_dump` + originals, a restore that RENAMES rather than drops, and a full destroy-and-restore drill measured end to end — bytes and rows identical, a 1-byte corruption caught (S28). Everything else is untouched: no SLO/OTEL, no cost caps, no load test, no staging, no failure injection, **no backup schedule**, single-worker constraint stands, source register is 17/17 `blocked` |
| **Full product** | **Phases 0-9** | **~26-40 person-weeks** | COMPLETE with authority; otherwise DEPLOYMENT_READY | current status: **PARTIAL** (STATUS.md argues the classification) |

## What the plan says to do next, in order

1. **Unblock the dense lane** (RISKS #2). Everything in Phase 3's remaining
   scope, ADR-004's model decision and Phase 9's capacity work sit behind a
   pgvector-capable Postgres.
2. **Close the secret incident** (RISKS #1) — the only Phase 0 item left.
3. **Get the gold set adjudicated** (RISKS #4). Until it exists, no retrieval
   or answer number can be called a quality result, and the MVP gate cannot be
   assessed.
4. **Measure citator edge quality on real legislation** (RISKS #8). The lane
   itself landed (ADR-015); what is unknown is how well amendment edges can be
   extracted from instruments that are not synthetic.
5. **Re-measure the 0.25 coverage floor** on a real corpus (RISKS #5).
6. ~~**Durable research runs**~~ — delivered locally in W12 (answers,
   drafts, matters and settings persist through the Pg stores, ADR-016;
   RISKS #15 retired). What remains before any multi-user use is the
   single-user posture itself (RLS bypassed locally) and the in-memory
   progress registry.
7. **Verify the remaining 25 deadline rules against the article text**
   (RISKS #19). W14 pulled 38 articles from mevzuat.gov.tr and verified 16 of
   41 (S10); the calculator's dates are only as right as the periods in
   `rules.ts`, and a missed deadline is unrecoverable. **Highest-impact item
   on this list.**
8. **Run the cloud-AI live smoke once with a key** (RISKS #20) and record
   it in `AI.md` §7; until then `liveTested:false` everywhere.
9. **Open one UDF in the UYAP Doküman Editörü** (RISKS #21) before the
   *deneysel* label can come off.
10. **Re-measure the 0.4 coverage floor** on a real corpus (RISKS #18),
    together with item 5.
11. **Enter this year's fee figures** (RISKS #24) — 17 of 20 tariff lines
    carry `amount: null` and the total refuses to be computed without them.
12. **Run one live case-law search on a networked machine** (RISKS #27). The
    server side landed in phase F; what has never happened is a single
    künye coming back from a real upstream.
13. **Close the three open verification findings** (RISKS #32: V-14, V-19,
    V-21) and put a progress line and a cancel button on corpus search
    (RISKS #25).

## Standing scope boundaries

Out of scope until the user says otherwise: any live deployment, any remote
database, **any Supabase or Resend MCP usage**, key rotation (user action),
production corpus backfill (gated on the source register), and executing the
pgvector migrations locally.

Two product boundaries W13/W14 made explicit and this plan keeps: **no UYAP or
UETS credential integration** of any kind, and **no claim measured on the
synthetic corpus may be presented as a legal-quality result**.

## Phase 0 acceptance (brief §14.2) — checked

- No loss of user changes — backup at `../_baseline-backup/2026-08-26/`; nothing
  reverted or committed.
- No legacy secret fallback in any code path — `tests/test_disabled_modules.py`,
  `smoke_check.py` disabled-key paths, gitleaks CI job.
- Offline CI deterministic — five jobs, every command mirrored locally at
  exit 0.
- 54/55 tool count pinned — `tests/test_tool_surface.py`, `smoke_check.py`,
  `http_e2e_check.py`, and now `live_local_gateway_check.py` over the real MCP
  transport.
- Known issues classified with evidence — `RESEARCH.md` ledger + P0 table,
  `RISKS.md` open/retired split.
