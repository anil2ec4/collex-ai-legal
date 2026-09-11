# W12 — DOCS-1: documentation for the W12 backend (part 1)

Date: 02.09.2026. Lane: DOCS-1. Scope: the engineering and user documents
that describe the integrated W12 backend. **Not** touched (by ownership):
`STATUS.md`, `FINAL_REPORT.md`, `TRACEABILITY.md`, `docs/DEMO.md`,
`KULLANIM-REHBERI.md`, `README-INDEPENDENT.md`, and any code, test,
migration or console file. Those four status documents still quote
"5 şablon / 18 yol / 5 senaryo / 17 checks" and get their final numbers in
the STATUS/FINAL_REPORT refresh after the UI lanes.

Sources read before writing: `W12-A..F.md`, `W12-INTEGRATION.md`,
`W12-UI-SPEC.md`, `docs/implementation/AI.md`, plus the files themselves
where a doc makes a claim about them (`ingestion/migrations.py` constants,
`supabase/migrations/20260902120000_matters_persistence.sql` header and
sentinel line, `control-plane/scripts/serve.mjs` flags/log lines/pid files,
`control-plane/scripts/demo.mjs` flags, `ColleX-Baslat.cmd`,
`ColleX-Durdur.cmd`, `intake/quarantine.py` / `files/routes.ts`
`UPLOAD_CAP_MIB`, `tests/ingestion/test_migrations_ledger.py` test names,
the `src/*` directory listings, `openapi.yaml` path count = 35).
Competitor cells added to `COMPETITIVE.md` come from a live fetch of
`dejure.ai/dilekce`, `dejure.ai` and `apilex.ai/tr/platform` on 02.09.2026.

No feature was invented: every mechanism named below is one a lane report
or the integration report says was delivered and tested, and the three
"unverified" surfaces (deadline rules `dogrulanmadi`, UDF `deneysel`, AI
`liveTested:false`) are carried as such into every document.

## What changed, per file

| File | Change |
|---|---|
| `CLAUDE.md` | Header dated 2026-09-02, status word stays **PARTIAL**. Directory map: `ingestion/` (ledger, `connect_local`, batched indexer), `intake/` (cap single source, per-page scan gate, per-block analysis, `errors.py`, ledger-aware `--ensure-db`), `export/` (`draft.py`, `udf.py`, `petition.py`), 13 migrations; TS rows for `src/store/{answerStore,draftStore,health}.ts`, `retrieval/corpusErrors.ts`, `answer/coverage.ts`, `pipeline` gate, new `src/matters`, `src/settings`, `src/deadlines`, `src/ai`, `api/{matterLink,healthReport}.ts` + openapi 35/44, `research/progress.ts` + async runs, drafting v2 (13 templates, PUT/versions/udf), files (pagination/503/504/cap mirror), scripts (demo 6 scenarios + `--force-drop-uploads`, serve lifecycle, pid files, `serve-mcp` env, `ai-live-smoke.mjs`), tests (79 files, 4 honest skips), the two `.cmd` launchers. Docs paragraph points at ADR-001..021, `waves/`, `AI.md`. Invariants added: ledger sentinel (test-enforced), console LF/single style+script/textContent, `UPLOAD_CAP_MIB` single source, deadline disclaimer verbatim + all rules `dogrulanmadi`, cloud AI only with key + per-request consent and never in `.env`, uploads are exhibits. DB table adds `collex_intake_test`, `collex_persist_test`, `collex_retrieval_test`/`collex_quality_test`, demo drop-refusal, `collex_local` "never test data", ledger behaviour of `--ensure-db`. Env names: `ANTHROPIC_API_KEY`, `COLLEX_AI_MODEL`, `COLLEX_AI_BASE_URL`, `COLLEX_AI_TOOL_CHOICE`, `COLLEX_NO_DOTENV`, `LOG_LEVEL`. Commands: counts vitest 1507/79 + 4 skips, pytest 1169, db_local_check 18/18, demo 6/6, openapi 35, 13 templates, 30 rules. "Do NOT" list: no test data in `collex_local`, no unverified-as-verified claims, no key anywhere, no gate/threshold tuning. Further reading updated |
| `docs/architecture/ADRS.md` | Header/index dated 2026-09-02. **ADR-016** durable matter workspace + write-through Pg stores + auto-linking + in-memory fallback; **ADR-017** question-coverage gate (lexical, floor 0.4, bypass-by-reference, anchoring rule, companion changes, **known limits section**); **ADR-018** cloud AI opt-in per request, gate order, key hygiene, evidence-bound outputs, **what is NOT known**; **ADR-019** UDF deneysel, UTF-16 offsets as a file-local exception to ADR-003, unsigned, **never opened in UYAP**; **ADR-020** migration ledger, bootstrap boundary `20260827120000`, sentinel rule, one-transaction apply, TS reads only, hosted-target note; **ADR-021** uploads are exhibits (`Ek-n`, `suggestedFacts`, `UPLOAD_NOT_LEGAL_SOURCE`, reviser refusals, `origin:'upload'` → PARTIAL). Each with context/candidates/decision/rationale/evidence (commands + counts from the reports)/consequences/rollout/rollback and file pointers |
| `docs/architecture/overview.md` | Dated; §2 diagram counts (6 scenarios, 18 checks); §6 seams rewritten (durable stores, no LLM planner but a per-request cloud port, uploads/matters running locally, the three labelled-unverified surfaces); new **§7** "What W12 added on top of §2 — by chain" (retrieval, answer, persistence, HTTP, drafting, deadlines, lifecycle, test counts) |
| `docs/implementation/RUNBOOK.md` | Dated; §1 counts; §3 table with 02.09 counts (1169 / 1507 / 18/18 / 6/6 / openapi 35/44), the meaning of the 4 skips, focused suites incl. which need PG/venv; §4.1 database table adds `collex_intake_test`, `collex_persist_test`, `collex_retrieval_test`/`collex_quality_test`, demo drop-refusal + `--force-drop-uploads`, `collex_local` rule; §6 demo 6/6 + S6 + flags; §7 serve.mjs flags (`--port --dsn --with-mcp --mcp-port`), default DSN `collex_local`, the exact start-up lines in order (DOWN/MISSING/EADDRINUSE, konsol/health/korpus/db/kayıt/ai/mcp/repo/pid), `kayıt` semantics, `--with-mcp` background start and `mcpState`, `/v1/health` shape and timings; §8 draft export CLI (`--draft`, `dilekce-docx`, `dilekce-udf`) + UDF caveat; new **§15** launcher/stopper flow, pid files and hard-kill behaviour, `--parent-stdin`, ports (8787/8898/8899/55432/8000), env var NAMES; new **§16** cloud AI enable/disable, per-request consent, dry-run/paid smoke; new **§17** deadline rules all `dogrulanmadi`, how to verify and flip, disclaimer, curl mechanism check; §14 hosted target adds the new migration and the "one history source" rule |
| `docs/implementation/SUPABASE-SETUP.md` | Header dated 2026-09-02, 18/18, W12 note (nothing applied remotely); inventory adds `20260902120000` with sentinel and marks the ledger boundary; new **§1.1** migration ledger rules (table created by code, bootstrap, sentinel obligation, one transaction, who uses the ledger locally) and the hosted-target consequence (Supabase CLI history vs. this ledger — pick one; idempotency note); §5 step 7 describes the five tables, RLS and indexes; §7 eleven runnable migrations and check **c14** |
| `docs/implementation/EXPORT.md` | Title/intro cover draft export; **§5 rewritten**: 5.1 formats table (md/docx/udf-deneysel), 5.2 draft structure changes (GG.AA.YYYY everywhere, `Dayanak [K-n]`, `ek-dogrulama`, DAYANAK KAYNAKLARI appendix, party/vekil block, uploads as `Ek-n`, conflict sentence, `ATIF_BICIMI`/`KANIT_NUMARASI` refusals), 5.3 UDF (structure, deneysel line verbatim, UTF-16 offsets as ADR-003 exception, write/verify chain, HTTP header, **not opened in UYAP**), 5.4 signature-chain limits unchanged + workflow; §7 test count 87 |
| `docs/implementation/PLAN.md` | Dated; Phase 4 gains the coverage gate (lexical, unvalidated); Phase 5 durable finished runs + async progress + no LLM planner; Phase 6 **PARTIAL (local)** with what exists and what does not; **Phase 7 DELIVERED LOCALLY** (ADR-016, in-memory fallback, evidence, not-done list); Phase 8 drafting v2 landed, UDF deneysel, remaining gaps; "next in order": item 6 retired, new items 7–10 (verify deadline rules, run AI smoke, open a UDF in UYAP, re-measure the 0.4 floor) |
| `docs/implementation/RISKS.md` | Dated; risk 15 retired into the retired table (durable stores, evidence); new open risks **18** coverage gate is lexical, **19** deadline rules unverified (very high impact), **20** AI live-untested, **21** UDF unverified in UYAP, **22** hard-kill pid files + last background write, **23** upload-scoped answer always PARTIAL; retired rows for ensure-db/timeout, the audit's false ŞERHLİ answer, drafting v1 defects, ingest performance/lifecycle — each with the 02.09 command/count |
| `docs/COMPETITIVE.md` | 02.09.2026 addendum: header + honesty note extended to the three unverified surfaces; two new rows **Dosya / proje çalışma alanı** and **Belgeyle sohbet / belge analizi** (Apilex/De Jure cells from the 02.09 live fetch, tagged `[doğrulandı]`/`[pazarlama]`/`[çıkarım]`; ColleX cells = matters/auto-link/persistence, file-scoped Q&A + PARTIAL limit, opt-in AI analysis live-untested); **Dilekçe üretimi** extended with De Jure's verbatim "normal ve uzun" + UDF sentences and karşı-itiraz phrasing, ColleX cell = editable drafts + versions, K-n, UDF deneysel, AI paragraph `normal/uzun` with entailment; **Arama** gains the coverage gate; **Entegrasyonlar** gains süre hesabı (all `dogrulanmadi`), launcher, UDF deneysel; §2 new item 9 **"Karşı tarafın atıflarını as-of motoruyla doğrula"** with the parts that run today and the SENTETİK caveat; "bizde olmayanlar" list updated (doğrulanmış UDF, canlı sınanmış AI, doğrulanmış süre kuralları, UETS, duruşma takibi); source table adds the three 02.09.2026 rechecks |
| `docs/README.md` | Dated with the "final numbers after the UI lanes" note; start-here rows for the W12 API (INTEGRATION → lane report → UI-SPEC), AI.md, RUNBOOK §15–17; implementation table rows refreshed (PLAN, RISKS, RUNBOOK, SUPABASE-SETUP, EXPORT) + **AI.md** row; new **`implementation/waves/`** table linking all eight W12 reports with one-line contents; ADRS row 001…021; DEMO paragraph (sixth scenario, refresh pending); COMPETITIVE paragraph; outside-docs table adds the launchers and `fixture_baseline_2026-09-02` |
| `docs/implementation/waves/W12-DOCS1.md` | this report |

## Consistency notes (things another lane should know)

- `docs/README.md` still describes `TRACEABILITY.md` as "30 requirements"
  and `RISKS.md` no longer says "17 open risks" — the numbers now live in
  the files, not the index, per house rule 4.
- The old risk 15 row in `RISKS.md` is kept as a numbered placeholder
  pointing at the retired table so that ADR/PLAN references to "RISKS #15"
  stay resolvable; the final STATUS refresh may renumber.
- `overview.md` §2 mermaid diagram was **not** redrawn (only the two
  counts); §7 carries the W12 additions as a text chain so the 27.08 diagram
  stays truthful for what it draws.
- `EXPORT.md` §6 ("producer-side additions not yet made" — `texts`,
  `synthetic`, `producer`) was left as is; whether `renderer.ts` now emits
  all three is a TRACEABILITY question for the final refresh, not something
  this lane could verify from the reports.

## Checks run

This lane owns no code and ran no code suite (other lanes were editing
their files at the time). What was verified:

| Check | Result |
|---|---|
| Every path named in the edited docs exists (`src/matters`, `src/settings`, `src/deadlines`, `src/ai`, `store/{answerStore,draftStore,health}.ts`, `api/{matterLink,healthReport}.ts`, `answer/coverage.ts`, `retrieval/corpusErrors.ts`, `research/progress.ts`, `export/{draft,udf}.py`, `ingestion/migrations.py`, the 13 migrations, the two `.cmd` files) | listed with `ls`/`Glob` on 02.09.2026 |
| Sentinel line present in the new migration | `grep` → line 64: `-- [LEDGER SENTINEL] app_private.settings` |
| Ledger constants match the docs | `ingestion/migrations.py`: `LEDGER_TABLE = app_private.schema_migrations`, `LEDGER_BOOTSTRAP_BOUNDARY = "20260827120000"`, `LEDGER_SENTINEL_MARKER = "[LEDGER SENTINEL]"`; test `test_bootstrap_boundary_is_a_real_migration_and_newer_ones_declare_sentinels` exists |
| `serve.mjs` flags and start-up lines quoted in RUNBOOK §7 | `grep` of `serve.mjs` (flags `--port --dsn --with-mcp --mcp-port`; log lines konsol/health/korpus/db/kayıt/repo/pid/mcp; `var/collex.pid`, `var/collex-mcp.pid`; DOWN/MISSING/EADDRINUSE messages) |
| `demo.mjs` flags incl. `--force-drop-uploads` | `grep` of `demo.mjs` header and arg parser |
| `UPLOAD_CAP_MIB = 25` in both places | `grep` of `intake/quarantine.py` and `control-plane/src/files/routes.ts` |
| `openapi.yaml` path count | `grep -c "^  /"` → 35 |
| Launcher flow described in RUNBOOK §15 | read `ColleX-Baslat.cmd` / `ColleX-Durdur.cmd` in full |
| Competitor quotes in COMPETITIVE.md | live fetch 02.09.2026 of the three pages named in the source table |
| Stale-count sweep over the owned files | `grep` for `17/17`, `5/5`, `972 passed`, `1046 passed`, `1099`, `18 paths`, `5 templates`, `ADR-001..014` in the owned files → only historical mentions inside dated evidence lines remain (ADR-011/012/013/015 quote their 2026-08-27 runs, which is correct) |

Not run: vitest, pytest, demo, db_local_check (no code changed in this
lane; the counts quoted are the integration lane's 02.09 measurements).
