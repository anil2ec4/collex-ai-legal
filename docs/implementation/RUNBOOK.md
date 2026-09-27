# Runbook

Operational procedures for the Bağımsız Yargı ve Mevzuat MCP / ColleX repo.
Last updated: **2026-09-03** (W12 backend integrated; FIX-2 limits, ledger
grammar and launcher semantics folded in by the CLOSEOUT pass; the phase-C
backup-archive naming folded into §14). Commands show Windows (Git Bash /
PowerShell) paths; POSIX equivalents use `.venv/bin/python`.

Every command in §§1–9 was executed on 2026-08-27 and re-run on 2026-09-03
(most recently by the phase-M closing round, `waves/W14-M-CLOSE.md`: **all
nine offline commands** — `tsc`, `vitest`, `pytest`, `smoke_check.py`,
`http_e2e_check.py`, `live_local_gateway_check.py`, `db_local_check.py`,
`run_evals.py` and `demo.mjs` — were run sequentially on the final tree and
**all nine exited 0, with no failing test**). Two caveats belong here.
**`vitest` is reproducible again**: the one test that used to lose a race
with a 1 ms budget was fixed in phase M and the suite has now come back green
nine consecutive times (STATUS S2/S39), so a red run there is a finding to
investigate, not something to re-run away. **`run_evals.py` is not, in one
layer**: its hard gates and retrieval metrics are reproducible, but its
**report-only answer-layer rows still move** (six consecutive runs moved this
round; STATUS S6/S40 and RISKS #34). Never treat a single run's finalizable
rate or status distribution as a measurement — use `--repeats N`, which prints
those rows as a band and names the gold rows that moved.
**This runbook quotes no counts**: the expected output of every check is a
row of `docs/implementation/STATUS.md` → "Ölçülen sayılar" (**S1–S40**),
cited by id below, so a re-measurement changes one table. Exceptions are
sections that say explicitly that they need a resource this machine does not
have (live upstreams, a pgvector-capable Postgres, a Supabase project, an
`ANTHROPIC_API_KEY`, the UYAP Doküman Editörü). Those are marked and never
reported as verified. **§15 (launcher and lifecycle) is the section a solo
lawyer's machine actually runs.**

> **Two standing rules.**
> **(a)** Never use Supabase or Resend remote services (or their MCP tools)
> from this repo's tooling. Nothing here has ever touched a live Supabase
> project. All database work is local files + a local scratch PostgreSQL.
> **(b)** Never run the pgvector migrations (`20260826080000`,
> `20260826090000`) locally. They are syntax-validated with pglast only.

## 1. Local setup from a clean clone

```bash
git clone <repo-url> yargi-mcp-independent
cd yargi-mcp-independent

# Python 3.13 venv via uv (system Python 3.14 is NOT supported)
uv sync --python 3.13            # runtime deps
uv sync --group dev              # + dev/test deps

# Environment: copy the template, fill values ONLY via editor/secret manager.
cp .env.example .env             # never print, log or commit .env

# Node (control-plane); Node >= 22
cd control-plane && npm ci && cd ..
```

Local-tooling-only dependency (not a runtime dependency of the MCP server):

```bash
uv pip install --python .venv/Scripts/python.exe "psycopg[binary]"
```

**If `uv sync --group dev` fails** on this checkout (the non-ASCII path
`yargı-anıl` breaks the editable build), install into the existing venv
instead — this is the documented fallback and the one this machine uses:

```bash
uv pip install --python .venv/Scripts/python.exe <package>
```

Do **not** use bare `python`, and do **not** use `uv run` / `uv sync` against
this venv for ad-hoc work: `uv run` re-syncs and can remove packages. Always
call the interpreter directly.

Verify the setup (all offline, all verified 2026-09-02; expected output =
STATUS rows S4, S3, S1/S2):

```bash
.venv/Scripts/python.exe scripts/smoke_check.py                 # exit 0 — STATUS S4 (54 tools)
.venv/Scripts/python.exe -m pytest tests evals/tests -q         # exit 0 — STATUS S3
cd control-plane && npx tsc --noEmit && npx vitest run && cd ..  # exit 0 — STATUS S1 + S2 (4 env skips, see §3)
```

## 2. Running the MCP server

stdio MCP (Claude Desktop / 5ire / local clients):

```bash
.venv/Scripts/python.exe mcp_server_main.py
```

HTTP MCP (single worker — see §8):

```bash
.venv/Scripts/python.exe -m uvicorn asgi_app:app --host 127.0.0.1 --port 8000
curl -s http://127.0.0.1:8000/health
```

HTTP auth: set `REQUIRE_HTTP_AUTH=true` and an `MCP_API_TOKEN` of >= 32 chars;
restrict `ALLOWED_ORIGINS`. With `BRAVE_API_TOKEN` / `TAVILY_API_KEY` empty the
KVKK/BDDK/Sigorta tools respond with explicit disabled/missing-credential
results (fail-closed) — that is expected behavior, not an outage.

## 3. Test suites

Offline (safe anytime; CI runs these on every push/PR):

| Suite | Command | Verified 2026-09-02 (expected output = STATUS row) |
|---|---|---|
| Unit / contract / eval-harness | `.venv/Scripts/python.exe -m pytest tests evals/tests -q` | exit 0 — **S3** (includes the 30k-paragraph intake timing test, the generic-chunk cap tests, the FIX-2 ledger-probe and ön-inceleme tests) |
| Offline MCP smoke (54 tools) | `.venv/Scripts/python.exe scripts/smoke_check.py` | exit 0 — **S4** |
| Offline HTTP e2e | `.venv/Scripts/python.exe scripts/http_e2e_check.py` | exit 0 — **S5** |
| Control-plane typecheck | `cd control-plane && npx tsc --noEmit` | exit 0 — **S1** |
| Control-plane tests | `cd control-plane && npx vitest run` | exit 0 — **S2** (4 env skips explained below) |
| Migrations vs. scratch PG | `.venv/Scripts/python.exe scripts/db_local_check.py` | exit 0 — **S7** (c14 = matters migration, RLS, idempotent re-apply, ledger bootstrap through the probes) |
| Measured eval gate | `.venv/Scripts/python.exe scripts/run_evals.py --run-date 2026-09-02` | exit 0 — **S8** (`evals/reports/fixture_baseline_2026-09-02.*`) |
| End-to-end demo (6 scenarios) | `node control-plane/scripts/demo.mjs` | exit 0 — **S9** |
| Live loopback MCP transport | `.venv/Scripts/python.exe scripts/live_local_gateway_check.py` | exit 0 — **S6** |
| OpenAPI sanity | `pyyaml` parse + `$ref` walk of `control-plane/src/api/openapi.yaml` | **S10** |
| Ledger / launcher / token (FIX-2) | `pytest tests/ingestion/test_migrations_ledger.py`; `vitest run tests/integration/launcher.test.ts tests/integration/serve.test.ts tests/store/persistence.test.ts` (PG + venv) | **S20**, **S22** |

**About the 4 vitest skips:** they are the honest "environment unavailable"
marker tests inside `tests/drafting/real-export.test.ts`,
`tests/store/persistence.test.ts`, `tests/integration/serve.test.ts` and
`tests/integration/real-exec.test.ts`. When the scratch PostgreSQL and the
venv are present (as on this machine) the REAL tests in those files run and
the marker skips; when they are absent the real tests skip and the marker
reports why. A run that shows more than 4 skips means a resource was missing.

Focused suites you will want while working (all offline unless noted):

```bash
cd control-plane
npx vitest run tests/matters tests/settings tests/store/persistence.test.ts   # matters/settings/Pg stores (needs PG: collex_persist_test)
npx vitest run tests/answer tests/store/corpusErrors.test.ts                  # coverage gate, answer honesty, typed corpus failures
npx vitest run tests/drafting                                                 # drafting v2, revise, UDF/DOCX real export (needs venv)
npx vitest run tests/deadlines                                                # 73 tests, pure TS
npx vitest run tests/ai                                                       # 65 tests, fake fetch — no network, no key
npx vitest run tests/files tests/research tests/integration                   # files/research/mounted app
cd ..
.venv/Scripts/python.exe -m pytest tests/ingestion/test_migrations_ledger.py tests/intake/test_ensure_db.py -q   # ledger probes + ensure-db (needs PG)
.venv/Scripts/python.exe -m pytest tests/export -q                            # DOCX/Markdown/UDF exporters incl. UDF round trip (count: STATUS S3 note)
.venv/Scripts/python.exe -m pytest tests/intake tests/ingestion -q            # intake + ingestion incl. the 30k-paragraph timing gate (< 60 s)
```

`npm ci` is required inside `control-plane/` before the vitest, demo, serve and
eval-gate commands. **Do not run `npm install` and do not edit
`control-plane/package.json`** — the dependency set is fixed
(typescript, vitest, zod, hono, `@hono/node-server`, postgres@3.4.9).

Live checks (opt-in, **real upstreams and real keys**, **sequential only —
never two at once**; court and legislation share one Bedesten quota).
**Not run by this runbook's verification pass — they require live upstream
access and consume quota:**

```bash
.venv/Scripts/python.exe scripts/live_regression_check.py
.venv/Scripts/python.exe scripts/live_remaining_check.py
.venv/Scripts/python.exe scripts/embedding_quality_check.py   # needs OPENROUTER_API_KEY
```

In GitHub these exist only in `.github/workflows/live-checks.yml`
(`workflow_dispatch`, one script per run). `ci.yml` must stay fully offline.

## 4. Scratch PostgreSQL: bring-up, database ownership, teardown

One local throwaway PostgreSQL 18 cluster on port **55432** serves every
database-backed check. Nothing here ever reaches a remote database (ADR-005).

### 4.1 Bring-up

```bash
# One-time init (scratch dir OUTSIDE the repo)
initdb -D "$HOME/pg-scratch-yargi" -U postgres -E UTF8 --locale=C

# Start on the non-default port 55432 (avoids clashing with a system Postgres)
pg_ctl -D "$HOME/pg-scratch-yargi" -o "-p 55432" \
       -l "$HOME/pg-scratch-yargi/pg.log" start

# Sanity
psql -h 127.0.0.1 -p 55432 -U postgres -c "select version();"
```

On Windows, `initdb` / `pg_ctl` / `psql` come from the PostgreSQL `bin`
directory (add it to `PATH` or call with the full path). Connection defaults
used by every script: host `127.0.0.1`, port `55432`, user `postgres`, **no
password**. `scripts/db_local_check.py` honours `COLLEX_DB_HOST`,
`COLLEX_DB_PORT`, `COLLEX_DB_USER`; `scripts/run_evals.py` honours
`COLLEX_EVAL_DSN`; the control-plane scripts honour `COLLEX_DB_URL`.

**You do not create the working databases by hand.** Each script creates and
drops exactly one, and refuses any other name:

| Database | Owned by | Purpose |
|---|---|---|
| `collex_mig_test` | `scripts/db_local_check.py` | Migration + invariant verification (18 checks) |
| `collex_eval_test` | `scripts/run_evals.py` | Measured fixture-corpus baseline + hard gates |
| `collex_ingest_test` | `ingestion/cli.py` and `tests/ingestion/` | Ingestion pipeline tests |
| `collex_intake_test` | `tests/intake/`, `control-plane/tests/integration/` (real-exec) | Intake + upload contract tests |
| `collex_persist_test` | `tests/ingestion/test_migrations_ledger.py`, `control-plane/tests/store/persistence.test.ts` | Ledger + Pg store tests (run them sequentially; each drops it at the end) |
| `collex_retrieval_test`, `collex_quality_test` | `control-plane/tests/store/retrieval.test.ts`, `tests/quality/retrievalQuality.test.ts` | Real-SQL retrieval tests |
| `collex_demo` | `control-plane/scripts/demo.mjs` (read by `serve.mjs --dsn …/collex_demo`) | End-to-end demo + **probe target**. Since W12-F the demo **refuses to drop it while it holds tenant uploads** (`scope='tenant' and source='UPLOAD'`), exit 3 with the `intake.cli --list/--delete` hint; pass `--force-drop-uploads` only for uploads you made yourself |
| `collex_local` | `intake.cli --ensure-db` (create-only), `serve.mjs` default, the launcher | **The lawyer's persistent product database.** Never dropped, never used by a test, never given probe data |

Two lanes must never share a database name. If you add a lane, give it a new
`collex_*` name and make its script refuse every other name, as the ones above
do.

### 4.2 pgvector — deliberately absent

pgvector **cannot be installed on this machine** (no Windows SDK for a source
build, no Docker). Consequences that must be stated wherever embeddings come
up:

- migrations `20260826080000_vector_embeddings.sql` and
  `20260826090000_hybrid_search.sql` are **pglast-syntax-validated only and
  must NEVER be executed here**;
- the dense retrieval lane is a `NoopDenseLane` in every measurement, so every
  reported retrieval number is **exact-pin + lexical + trigram + citator**
  only;
- `scripts/db_local_check.py` classifies migrations by the pgvector marker in
  each file's header (not by filename order) and reports the skipped
  statements in check (e).

### 4.3 Teardown / reset

```bash
# Stop the cluster
pg_ctl -D "$HOME/pg-scratch-yargi" -o "-p 55432" stop

# Full reset: stop, delete the data dir, re-run §4.1
rm -rf "$HOME/pg-scratch-yargi"
```

Nothing outside that directory is touched. Dropping a single working database
is also safe — the owning script recreates it on the next run.

## 5. Ingesting the fixture corpus

```bash
.venv/Scripts/python.exe -m ingestion.cli \
    --dsn postgres://postgres@127.0.0.1:55432/collex_ingest_test \
    --corpus evals/fixtures/corpus \
    --recreate-db --apply-migrations
```

`--apply-migrations` applies missing non-pgvector migrations, including
`version_transitions`, through the shared ledger before ingesting. An
existing schema is checked through its sentinels instead of replayed.
`--recreate-db` drops and recreates
**`collex_ingest_test` only**; any other database name aborts the run.
`--include <glob>` restricts discovery to the named files — the ONLY way a
file in the corpus directory is not ingested. Discovery otherwise yields
**every version** of a document, in commencement order, so one pass over
`evals/fixtures/corpus` loads both `kanun_5237_v1.json` and
`kanun_5237_v2.json`. The corpus is **SENTETİK** authored test data — see
`docs/DEMO.md`.

## 6. End-to-end demo (it is a test, not a slideshow)

To retain the existing demo database and tenant uploads, use
`node control-plane/scripts/demo.mjs --keep --python .venv/Scripts/python.exe`.
This still ingests the fixture corpus and runs the scenarios; it does not
drop the database. The 2026-09-08 repeat passed with the uploaded public PDF
preserved (STATUS S70). `--skip-ingest` also retains the database but requires
the fixture corpus to be present already.

```bash
node control-plane/scripts/demo.mjs
```

Verified 2026-09-02: **exit 0, 6/6 scenarios PASS** — S1 SUPPORTED 8/8,
S2 ABSTENTION 8/8, S3 CONTRARY 7/7, S4 TEMPORAL 7/7, S5 TAMPER 7/7,
**S6 DOSYA BAĞI 10/10** (matter auto-linking of an upload, an answer and a
draft; wrong `matterId` → 404 before any work).

It recreates `collex_demo`, runs the Python ingestion CLI **once** (one pass
ingests every version of every document in commencement order, so 5237 v1 and
v2 both land and the temporal scenario has two effective periods to
distinguish), drives six scenarios through the real HTTP surface, writes
`demo-output/`
(`report.md`, `summary.json`, `S1.json`…`S6.json`) and **exits non-zero if any
scenario misses its expected state**. S6 runs against the in-memory stores
(the `createApp` default); the persistent Pg stores are proven separately by
`tests/store/persistence.test.ts` and the HTTP probe in
`W12-INTEGRATION.md` §6.

Flags: `--keep` (reuse the database), `--skip-ingest`, `--out <dir>`,
`--dsn <url>`, `--python <exe>`, **`--force-drop-uploads`** (the demo refuses
to drop `collex_demo` while it contains tenant uploads — exit 3 and a hint
listing `intake.cli --list` / `--delete`; the flag overrides that for uploads
you made yourself). Full narrative: `docs/DEMO.md`.

## 7. Operator console and the local HTTP API

```bash
node control-plane/scripts/serve.mjs
# console : http://127.0.0.1:8787/  (also /console)
# health  : http://127.0.0.1:8787/v1/health
# answer  : POST http://127.0.0.1:8787/v1/answer   {question, asOf?, filters?{fileIds,includeCorpus}, useCloudAi?, matterId?}
```

`node control-plane/scripts/serve.mjs --port 8799 --dsn <url> [--with-mcp
[--mcp-port 8898]]` overrides the defaults. The **default DSN is
`collex_local`** (the product database, created by `intake.cli --ensure-db`);
point `--dsn` at `…/collex_demo` after §6 to serve the fixture corpus. What
it prints at start (W12), in this order:

```
[collex] veritabanı: ÇALIŞMIYOR — ColleX-Baslat.cmd ile başlatın (…)         ← DOWN: exit 1, nothing else happens
[collex] veritabanı: collex_local yok: … intake.cli … --ensure-db …           ← MISSING db/schema: continues; file/answer routes answer a typed 503
[collex] HATA: 8787 portu kullanımda — … ColleX-Durdur.cmd …                  ← EADDRINUSE: exit 1 (HTTP binds BEFORE the MCP child starts)
[collex] konsol : http://127.0.0.1:8787/
[collex] health : http://127.0.0.1:8787/v1/health
[collex] korpus : collex_local (yerel Postgres, durum: hazır | ŞEMA EKSİK)
[collex] db     : Veritabanı (collex_local) bağlı; 11/11 migrasyon uygulanmış.   ← checkDatabase, 3 s race; ledger count
[collex] kayıt  : kalıcı (app_private.answers/drafts/matters/settings) | bellek içi
[collex] ai     : açık (<model>) | kapalı (ANTHROPIC_API_KEY yok)             ← never the key
[collex] mcp    : kapalı | açık (http://127.0.0.1:8898, canlı /v1/research; uvicorn pid N)
[collex] repo   : <path>
[collex] pid    : <node pid> (var/collex.pid)
```

`kayıt : kalıcı` means answers, drafts, matters and settings are written
through to PostgreSQL (ADR-016); `bellek içi` means the database was not
`ok` at start and the bounded in-memory stores are in use — nothing survives
a restart in that mode, which is exactly the pre-W12 behaviour. With
`--with-mcp` the MCP gateway child starts in the **background**: `/v1/health`
reports `mcp: starting` (measured ~100 ms after bind) then `ok` (~4.7 s), and
a child that dies later flips it to `down` without killing the API
(`/v1/research*` answer a typed 502 meanwhile).

Operational facts to know before showing it to anyone:

- it binds **127.0.0.1 only and has no authentication** — it is a local
  operator tool, not a service;
- without `--with-mcp` no provider gateway is configured, so `/v1/search`
  and `/v1/research*` answer a typed 502/503 by design; answers come from the
  **local corpus** (and, with `filters.fileIds`, from the lawyer's own
  uploads) and the process makes no network call unless a request carries
  `useCloudAi:true` **and** `ANTHROPIC_API_KEY` is set (§16);
- the page assigns no markup (`textContent` only), is LF-only with one
  `<style>` and one `<script>`, pins its own inline script and style with
  SHA-256 in the served CSP, and disables remote images and scripts
  (`tests/pipeline/console.test.ts`). Do not "improve" it by injecting HTML.

`/v1/health` (contract [H], `W12-INTEGRATION.md` §5) never throws and always
answers 200 with `db` (`ok|missing|down|off`), `dbName`, `migrations`
(`{applied, expected, missing}`), `mcp` (`off|starting|ok|down`), `ai`
(`{configured, model, liveTested}`), `demoCorpus`, `corpus`
(`{publicDocuments, uploads}` — uploads counts `source='UPLOAD'` rows, the
same rows `/v1/files` lists), `templates: 13`, `deadlineRules: 41`,
`registeredToolCount: 54`, `version: "1.0.0"` (W14 B-34: read from the
repo-root `VERSION` file, not a hand-edited constant), and the W14 additions
**`rls: {expected, present}`** (a full database has 18; `present < expected`
means a migration ran half-way and the console draws it red),
**`backup: BackupSummary | null`** (`null` = never backed up, which is a RED
banner, not a blank) and **`migrations.unknown[]`** (files the ledger records
that are not on disk — the database is NEWER than this build). Worst case with the
database down is ~3 s (one timeout); with it up, < 100 ms. Since FIX-2
`migrations.missing` is derived exactly as Python derives it: every runnable
migration's `[LEDGER SENTINEL]` probe is resolved in one round trip
(`resolveSentinels`, the same SQL CASE as `ingestion/migrations.py`), so a
file whose relation/function/trigger/column is absent is reported missing
even when a ledger row exists (`tests/store/persistence.test.ts`: drop the
version-transitions trigger → `missing: [20260826100000_version_transitions.sql]`).

**Request limits and answer budgets (W12-FIX2).** These are constants, not
environment variables; change them in code and re-run the pinned tests:

| Constant (file) | Value | Effect |
|---|---|---|
| `JSON_BODY_LIMIT_BYTES` (`src/api/server.ts`) | 1 MiB | non-multipart body above it → `413 PAYLOAD_TOO_LARGE` before any route (`hono/body-limit`; `Content-Length` honoured, chunked bodies counted) |
| `MULTIPART_BODY_LIMIT_BYTES` (`src/api/server.ts`) | 40 MiB | multipart ceiling; the 25 MiB upload cap and the 32 MiB OCR cap still apply per route |
| `MAX_ITEM_PAYLOAD_BYTES` (`src/matters/routes.ts`) | 64 KiB | one matter item payload on POST/PATCH → 413 |
| `DEFAULT_ANSWER_TIME_BUDGET_MS` (`src/pipeline/answerPipeline.ts`; `AnswerPipelineOptions.timeBudgetMs`, 0 = off) | 60 000 ms | checked BETWEEN pipeline stages on the trace clock: over budget → drafter skipped, cloud judge → local, status PARTIAL, `finalizable:false`, reason + warning `TIME_BUDGET_EXCEEDED`. It cannot interrupt one slow port call |
| `DEFAULT_MAX_QUOTE_CODE_POINTS` (`src/answer/evidencePack.ts`; `maxQuoteCodePoints`, 0 = off) | 4 000 | a longer passage is cut to the window with the most question lexemes; offsets/quote/`quoteSha256` describe the shown window; `EvidenceView.quoteTruncated`, warning `QUOTE_TRUNCATED` |
| `MAX_STORED_TEXT_BYTES` (`src/api/answerService.ts`) | 5 MiB | canonical texts above it are not stored with the answer; warning `STORED_WITHOUT_TEXTS`; `?texts=true` then carries none and the exporter verifies by quote digest |
| **Answer cache ceiling** (`src/api/answerService.ts`, `InMemoryAnswerStore`) | 32 runs × ≤ 5 MiB ≈ **160 MB theoretical** | The bound is the run count, not the bytes; the byte ceiling above is what makes the product of the two finite. W13's engineering-risk lane measured **181,6 MB working set after 250 answers with no leak** — the cache evicts oldest-first and the process does not grow without bound. With the durable store a run that left the cache is loaded back from `app_private.answers` |
| `PDF_MAX_PAGES` (`intake/extract.py`) | **600** | W14 B-33. Read from the PDF header BEFORE a single page is extracted; over it, a typed `EXTRACTION_FAILED` in under a second instead of burning the whole 180 s budget and answering 504 |
| `BATCH_MAX_FILES` (`intake/cli.py`) | **200** | W14 B-19. `--dir` refuses a larger tree UP FRONT, so a folder dropped by mistake cannot run for hours |
| `UPLOAD_CAP_MIB` (`intake/quarantine.py`) | 25 | unchanged. ONE source of truth; `control-plane/src/files/routes.ts` mirrors it and a test parses the Python line |
| `AI_MAX_CALLS_PER_HOUR` (`src/ai/ledger.ts`) | **60** | W14 B-23. Checked on ALL THREE cloud routes BEFORE the model call → `429 AI_RATE_LIMITED` with `limits` and `usage` in the body |
| `AI_MAX_INPUT_TOKENS_PER_DAY` (`src/ai/ledger.ts`) | **400 000** | as above |
| `LONG_QUESTION_CODE_POINTS` (`src/pipeline/questionIntent.ts`) | **400** | W14 B-08. Above it the coverage gate is measured on the EXTRACTED legal question and a second primary query is planned. A documented, not a measured, constant: the audited short forms were 40–120 code points and the audited narrative 1 178 |
| `MAX_CONTACTS` (`src/matters/contacts.ts`) | **2 000** | W14 B-42. A solo practice, not a CRM; the contacts document is one jsonb row |
| Batch item ceiling (`src/matters/routes.ts`) | **50 records** | W14 B-18. `MAX_ITEM_PAYLOAD_BYTES` still applies to EACH record; a malformed record rejects the whole request and writes nothing |
| `MCP_START_DEADLINE_MS` (`scripts/serve.mjs`) | **60 000 ms** | W14 B-45. After it `mcpState` becomes `down` and says "canlı araştırma için sunucuyu yeniden başlatın" |
| `BACKUP_STALE_AFTER_DAYS` (`src/backup/runner.ts`) | **7** | W14 B-03. Older than this and `/v1/health.backup.stale` is true (orange) |

Measured with them (FIX-2, port 8881 / `collex_demo`): a 3 MB synthetic TXT
uploads in 8.7 s (12 833 paragraphs) and "Belgeye sor" answers COMPLETE in
4.1 s over the API (STATUS S21).

Failure bodies from the two child processes (`POST /v1/files` →
`INTAKE_FAILED`, `GET /v1/drafts/{id}/export` → `EXPORT_FAILED` /
`EXPORT_REFUSED`) carry `detail: "Ayrıntı sunucu günlüğüne yazıldı (kayıt
no: <uuid>)"` and `correlationId`; the child's stderr (up to 2 000 chars) is
only in the server window, on the line `[collex] INTAKE_FAILED id=…` /
`EXPORT_FAILED id=…`. Grep the window for the id the user quotes. A file id
that is not 16 hex characters, or a draft id outside
`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`, is answered 404 before any process
starts.

Export an evidence bundle from a running server:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/evidence-bundle \
  -H 'content-type: application/json' \
  -d '{"question":"TCK m. 157 dolandırıcılık suçunun cezası nedir?","asOf":"2025-06-01","includeTexts":true}' \
  > bundle.json
```

### 7.1 Backup and restore (W14 B-03)

```bash
node control-plane/scripts/backup.mjs --database collex_local --out D:/ColleX-Yedek
node control-plane/scripts/backup.mjs --verify D:/ColleX-Yedek/<klasör>
node control-plane/scripts/backup.mjs --dump-name D:/ColleX-Yedek/<klasör>   # W14 phase C
# or, for the lawyer: ColleX-Yedekle.cmd  /  ColleX-Geri-Yukle.cmd
```

A backup is **three parts, and two of them are not a backup**:
`<database>.dump` (`pg_dump -Fc`), `uploads/` (the original bytes) and
**`yedek.json`** — the manifest carrying the schema identity, the date, the
database name and the SIZE and SHA-256 of every file. `readLastBackup` SKIPS
a folder without a manifest: it does not count as a backup.

**W14 phase C (V-14): the archive is named after the database it holds.**
Until that pass the file was ALWAYS `collex_local.dump` while the manifest
recorded the real database, so `ColleX-Geri-Yukle.cmd`'s existence check only
worked by accident. Now `backupDumpFileName(database)` DERIVES the name and
sanitizes it (anything outside `[A-Za-z0-9_.-]` becomes `_`, leading dots
become `_`, an empty name becomes `veritabani`), so no database name can
produce a path separator, a parent-directory reference or a hidden file;
`verifyBackup`, the new `--dump-name` mode and the restore `.cmd` all read the
name from `yedek.json`. **For `collex_local` the name is unchanged
(`collex_local.dump`)**, so an existing backup folder keeps working. A folder
with no manifest makes `--dump-name` exit 1 with empty stdout, and the `.cmd`
stops with "Bu klasor bir ColleX yedegi degil".

Non-negotiable properties, all test-pinned:

- taking a backup **never writes to the product database** (`pg_dump` reads
  one snapshot);
- `execFile` with an argument array — **no shell**;
- **restore never starts with `drop database`**: the existing database is
  RENAMED to `collex_local_eski_<tarih>`, and `pg_restore` runs with
  `--exit-on-error`;
- `robocopy /E` **merges** the originals and never deletes; `/MIR` and
  `/PURGE` are forbidden by a test;
- the verify pass prints the `pg_policies` count too — a safety net for the
  RLS invariant (ADR-026).

Every surface that reports a backup repeats the warning verbatim: *"Bu klasör
müvekkil verisi içerir — şifreli bir diske koyun (Windows'ta BitLocker, Mac'te
FileVault ile şifrelenmiş bir disk)."* (27.09.2026: it used to name BitLocker
only; the production host is a Mac mini.)

Deliberately NOT built: PITR / WAL archiving, `pg_basebackup`, a scheduled
task, encryption. The backup is manual and the lawyer must run it.

**Disaster drill.** `control-plane/tests/integration/backup.test.ts` really
does it against `collex_safe_test` — create data → real `pg_dump` → verify the
manifest → **destroy the database** → real `pg_restore --exit-on-error` →
prove row-for-row and byte-for-byte equality including Turkish characters. It
refuses to run `resetDrillDb` against any database but its own. The "rebuild
the cluster from scratch" half of the acceptance was NOT done: that would
destroy the PostgreSQL every lane shares (STATUS).

### 7.2 The W14 endpoints, and why none of them may be drawn yet

`W14-L-FIX` §1.1 recorded the status codes measured over real HTTP against
`collex_demo`. The routers are mounted and their dependencies wired, so a
`curl` works today:

```bash
curl -s http://127.0.0.1:8787/v1/sources/manifest        # coverage manifest
curl -s http://127.0.0.1:8787/v1/fees/tariffs?year=2026  # 20 lines, 17 with amount:null
curl -s http://127.0.0.1:8787/v1/contracts/checklists
curl -s http://127.0.0.1:8787/v1/matters/calendar.ics    # text/calendar
curl -s "http://127.0.0.1:8787/v1/search/all?q=tahliye"
curl -s -X POST http://127.0.0.1:8787/v1/citation-audit \
  -H 'content-type: application/json' \
  -d '{"text":"…dilekçe metni…","asOf":"2026-06-01"}'
```

**The console does not draw these screens yet** (W14 phase B). That is the
vaporware gate, not an oversight: a card whose endpoint answers 404 is drawn
DISABLED with the reason written into it, and a feature that has not landed
gets no card at all.

## 8. Evidence-bundle export CLI

```bash
.venv/Scripts/python.exe -m export.cli \
    --bundle bundle.json --out kanit-paketi.md   --format md
.venv/Scripts/python.exe -m export.cli \
    --bundle bundle.json --out kanit-paketi.docx --format docx
```

Verified 2026-08-27 on the demo's `demo-output/S1.json` bundle: **exit 0** for
both formats, "8 alıntının tamamı doğrulandı; 8 tanesi kanonik metin + offset
karşılaştırmasıyla", output marked `SENTETİK VERİ`.

Without a running server, take the bundle straight out of the demo output:

```bash
.venv/Scripts/python.exe -c "import json,pathlib; d=json.load(open('demo-output/S1.json',encoding='utf-8')); pathlib.Path('bundle.json').write_text(json.dumps(d['artifacts']['bundle'],ensure_ascii=False),encoding='utf-8')"
```

**Exit codes are part of the contract:** `0` written and self-verified,
`1` usage/format error, **`2` export REFUSED — a citation could not be
verified**. On any non-zero exit **no file is written** (the DOCX path writes
to a temporary file, verifies, then `os.replace`s). Details:
`docs/implementation/EXPORT.md`, contract rationale: ADR-014.

Draft (dilekçe) exports use the same CLI with `--draft`:

```bash
.venv/Scripts/python.exe -m export.cli --draft taslak.json --out dilekce.docx --format dilekce-docx
.venv/Scripts/python.exe -m export.cli --draft taslak.json --out dilekce.udf  --format dilekce-udf   # DENEYSEL
```

Over HTTP: `GET /v1/drafts/{id}/export?format=md|docx|udf`. **UDF is
deneysel** (ADR-019): the file is unsigned, its second line says so, the
response carries `X-ColleX-Experimental: udf`, and it has **never been opened
in the UYAP Doküman Editörü** — only round-tripped through this repo's own
UDF reader. Open it in the official editor and check before relying on it.

## 9. Measured eval gate

```bash
.venv/Scripts/python.exe scripts/run_evals.py
```

Verified 2026-08-27: **exit 0, RESULT: PASS**. It creates and drops
`collex_eval_test` (that name only), ingests `evals/fixtures/corpus`, drives
every gold query through the real control-plane retrieval + evidence path,
scores it, writes a dated report into `evals/reports/`, and **exits 1** if
citation resolvability < 100%, quote/hash integrity < 100%, any fabricated id
appears, or any cross-tenant leak indicator appears (brief §13.1).

Useful flags:

| Flag | Effect |
|---|---|
| `--fixture-only` | DB-free deterministic invariants only (offset/quote/hash/fabricated-id). This is what CI's `python-offline` job runs. |
| `--skip-ingest` | Re-measure an already-ingested `collex_eval_test` (iteration, and how the gate-failure proof is reproduced) |
| `--reports-dir <dir>` | Write reports somewhere other than `evals/reports/` — **use this if another lane owns the reports directory** |
| `--result-limit`, `--run-date`, `--keep-raw`, `--skip-report` | measurement/report knobs |

Prerequisites: the scratch PostgreSQL of §4, `psycopg` in the venv, Node ≥ 22,
and `npm ci` already run in `control-plane/` (the script bundles the TypeScript
driver with the esbuild already in control-plane's lockfile; it installs
nothing).

**Reading the output honestly:** the corpus is synthetic. Only the four gate
rows are invariants; every other metric is a regression tripwire for this
corpus. Read the "Hits by lane" table before quoting any recall number — the
dense lane is at 0 because pgvector is absent. Never present a fixture number
as a legal-quality benchmark.

## 10. Live loopback gateway verification

```bash
.venv/Scripts/python.exe scripts/live_local_gateway_check.py
```

Verified 2026-08-27: **exit 0**. It launches the **real** server
(`uvicorn asgi_app:app` on `127.0.0.1:8899`) as a subprocess with every
provider credential blanked and HTTP auth enforced, then drives the real MCP
streamable-HTTP transport with a plain-Node client
(`control-plane/scripts/live-gateway-check.mjs`, no dependencies, no imports
from `control-plane/src`):

```
initialize -> notifications/initialized -> tools/list (EXACTLY 54)
  -> tools/call search_kvkk_decisions (structured 'module disabled')
  -> POST /mcp/ without Authorization -> 401
```

Despite the name it is **loopback-only with zero external traffic** — it is
safe to run any time and belongs in the offline set. The Node script can also
be pointed at an already-running server:

```bash
node control-plane/scripts/live-gateway-check.mjs http://127.0.0.1:8899 <bearer-token>
```

## 11. Dirty-baseline backup and restore

The user's pre-fix working-tree state is preserved OUTSIDE the repo at
`../_baseline-backup/2026-08-26/`:

- `HEAD.txt`, `git-status-snapshot.txt`, `stash-list.txt` — recorded state
- `dirty-tracked.patch` — diff of the tracked dirty files (**contains the old
  secret values — never commit, never paste**)
- full copies of the key untracked files (`mevzuat_mcp_server.py`,
  `bedesten_rate_limit.py`, `scripts/` etc.)

Rules:

- NEVER `git checkout/reset/stash/commit` over the dirty state to "clean up".
- Restore a single damaged file by copying it back (prefer the full-file
  copies over the patch).
- Full worktree restore (last resort): confirm `git rev-parse HEAD` matches
  `HEAD.txt`, then `git apply ../_baseline-backup/2026-08-26/dirty-tracked.patch`
  on a clean checkout of that HEAD, then copy the untracked files back.
- After the dirty state is committed (user decision): delete or move the
  backup to secured storage — incident checklist item
  (`docs/security/incident-2026-08-26-embedded-tokens.md` §5).

## 12. Provider outage behavior

- **Bedesten (courts + legislation + health)**: all nine legislation tools,
  `search_bedesten_unified`, the Bedesten fetch paths and the health tool sink
  into one upstream and one process-wide token bucket (cap 1, refill 1/6.5 s,
  max wait 65 s). On 429 the limiter itself performs the single
  Retry-After-aware retry; callers must not add their own. A repeated
  connect-error pattern opens the endpoint-keyed circuit breaker; an outcome
  arriving from a superseded admission epoch is dropped rather than counted,
  so a slow failure cannot re-open a breaker a probe just closed. The bulkhead
  is deadline-bounded: a saturated lane fails fast and typed instead of
  queueing forever. A Bedesten outage takes the whole family down together —
  expected common-mode behavior; verify other families (Anayasa, KİK,
  Rekabet, …) still respond before escalating.
- **Emsal**: separate `EMSAL_RATE_*` bucket; independent of Bedesten.
- **Brave / Tavily lanes**: quota exhaustion or a provider error surfaces as a
  structured error; an EMPTY key surfaces as disabled-credential — check which
  one you are seeing before rotating or raising limits.
- **OpenRouter embedding lane**: free-route throttling degrades semantic tools
  only; an unset key means a 54-tool surface, which is the normal state.
- Never respond to an outage by raising worker count or loosening
  `BEDESTEN_RATE_*` — that converts an outage into a quota ban (RISKS.md).
- Record every incident: timestamp, failing family, upstream status codes,
  limiter waits, and whether errors were typed correctly. **A failure
  presenting as an empty result list is a BUG** — `tests/test_facade_contracts.py`
  exists to prevent exactly that; file it.

Diagnosis order: `check_government_servers_health` tool → one manual
`live_regression_check.py` run (sequential!) → upstream status from a browser.

## 13. Key rotation

Full incident context and the authoritative checklist:
`docs/security/incident-2026-08-26-embedded-tokens.md` (**still OPEN**).

Routine rotation procedure (also used for the pending incident rotation):

1. Create the new key in the provider dashboard (Brave Search API / Tavily /
   OpenRouter / Mistral).
2. Update the deployment environment or local `.env` **via editor or secret
   manager only** — never echo the value into a shell, log or document.
3. Restart the server process (env is read at startup).
4. Verify with the single relevant live script (e.g. one KVKK search for
   Brave) — sequential, once.
5. Revoke the old key at the provider.
6. Record the rotation (date, key NAME, reason — **never the value**) in the
   incident record.
7. Confirm CI `secret-scan` stays green on the next push.

For SEC-2026-08-26-001 specifically: rotate Brave and Tavily first, treat the
old values as public, then work through the remaining checklist items (old
deployments out of traffic, baseline backup secured or deleted, optional
history purge AFTER rotation).

## 15. The lawyer's launcher: `ColleX-Baslat.cmd` / `ColleX-Durdur.cmd` (W12-F)

Both files sit at the repo root and work relative to their own location
(`cd /d "%~dp0"`; `chcp 65001` stays because the path contains non-ASCII
characters). They assume the scoop PostgreSQL cluster at
`%USERPROFILE%\scoop\apps\postgresql\current` on port 55432, loopback only.

**Start** (double-click `ColleX-Baslat.cmd`):

0. If `http://127.0.0.1:8787/v1/health` already answers 200 → only opens the
   browser and exits.
1. Kills stale `ColleX Sunucu` windows — **W14 (B-34/E12b): only after a
   liveness check.** If a pid file exists and that pid really is a
   `serve.mjs`, nothing is killed and the launcher goes straight to waiting.
   It also verifies (E18) that the cluster's `show data_directory` matches
   `%PGDATA_DIR%` and STOPS with a Turkish explanation ("Dosyalariniz
   duruyor") if it does not — pointing the product at the wrong cluster is
   how a lawyer concludes their files are gone.
2. Checks `node`, `control-plane\scripts\serve.mjs`, `pg_ctl.exe`; starts
   PostgreSQL if `pg_isready` fails (log: `%TEMP%\collex-postgres.log`).
3. `intake.cli --dsn …/collex_local --ensure-db --list` — **create-only**,
   never drops, and (ADR-020) applies any migration the ledger says is
   missing. This is how `collex_local` received `20260902120000`. Its
   output goes to `%TEMP%\collex-ensure-db.log`. **Since FIX-2 (P2-16) a
   non-zero exit STOPS the launcher** (`exit /b 1`, after `pause`): with
   `STORE_UNAVAILABLE` in the log it prints "Yerel veritabanina ulasilamadi
   (STORE_UNAVAILABLE): PostgreSQL 127.0.0.1:55432 baglanti kabul etmiyor."
   and the two log paths; otherwise "Veritabani semasi hazirlanamadi
   (intake.cli --ensure-db basarisiz)." and the log path. The server is
   never started without a schema.
4. Starts `node control-plane\scripts\serve.mjs --port 8787 --with-mcp` in
   its own window titled `ColleX Sunucu`. `serve.mjs` generates the MCP
   bearer token and hands it to `serve-mcp.mjs` **in the child's
   environment (`MCP_API_TOKEN`)** — never on the command line;
   `serve-mcp.mjs --token …` throws (FIX-2, P2-15;
   `tests/integration/serve.test.ts` inspects the real process list).
5. Polls `/v1/health` with PowerShell `Invoke-WebRequest` (2 s × 30 = 60 s)
   and opens the browser **only on 200**; on failure it prints which
   server-window message to look at (`veritabanı: ÇALIŞMIYOR` → PostgreSQL
   log; `portu kullanımda` → run the stopper).

**Stop** (`ColleX-Durdur.cmd`), in order. **W14 (B-34) put a GRACEFUL step
first:** the stopper drops `<COLLEX_DATA_DIR>/collex.stop` and waits up to
6 s. `serve.mjs` polls that sentinel every 500 ms and, on seeing it, calls
`flush()` + `sql.end()` and only THEN removes its pid file — so **the pid
file disappearing means the records were written**. Until W14 the shutdown
path had never run in production, because `taskkill /F` cannot run exit
hooks. Only if the pid file is still there after 6 s does the old sequence
run (FIX-2, P2-16): the `ColleX
Sunucu` window → the pid files `var\collex-mcp.pid` and `var\collex.pid`
(each pid goes through `:killpid`, which kills it **only if its CommandLine
matches `serve\.mjs|serve-mcp\.mjs|uvicorn asgi_app`** — a reused pid
belonging to another program is left alone; the file is deleted either way)
→ every process whose CommandLine matches that pattern (PowerShell
`Get-CimInstance Win32_Process`, the stopper's own `$PID` excluded) →
`pg_ctl -m fast stop`. **There is no `netstat`/port-based kill any more:** a
foreign process listening on 8787 or 8898 is never touched; if one holds the
port, `serve.mjs` reports `portu kullanımda` and it is the user's call.
`tests/integration/launcher.test.ts` parses both batch files and fails if a
`netstat`/`LISTENING`/PID kill comes back.

**pid files.** `serve.mjs` writes `var/collex.pid` (node) and
`var/collex-mcp.pid` (uvicorn pid from the child's ready line) and removes
them on a clean shutdown. A **hard kill on Windows cannot run exit hooks**,
so the files survive; `serve.mjs` overwrites them at the next start and the
stopper deletes them (after the command-line check above). A stale pid file
is therefore **not** proof of a running server — the launcher trusts
`/v1/health`, never the pid file. The MCP child itself is protected by
`serve-mcp.mjs --parent-stdin`: when the parent's stdin pipe closes, uvicorn
shuts down (verified: hard-killing `serve.mjs` left no listener on the MCP
port and the uvicorn pid was gone).

**Ports.** 8787 = console + API (`--port`); 8898 = MCP gateway under
`--with-mcp` (`--mcp-port`; if a stale uvicorn holds it, the next free port
up to +20 is used and reported in Turkish); 8899 = the loopback port used by
`scripts/live_local_gateway_check.py`; 55432 = PostgreSQL; 8000 = the manual
uvicorn HTTP MCP example in §2. Ports 88xx were assigned to the W12 lanes for
probes and are free again.

**Environment variables the launcher path honours** (names only):
`ANTHROPIC_API_KEY`, `COLLEX_AI_MODEL`, `COLLEX_AI_BASE_URL`,
`COLLEX_AI_TOOL_CHOICE` (cloud AI, §16 — set them in the `ColleX Sunucu`
window's environment or as user-level Windows variables, **not in `.env`**);
`COLLEX_NO_DOTENV=1`, `LOG_LEVEL=WARNING` and `MCP_API_TOKEN` are set by
`serve.mjs`/`serve-mcp.mjs` for the MCP child so it neither reads `.env` nor
floods the window and never shows its token in a process list;
`COLLEX_DB_URL` for the control-plane DSN. The answer budget and body limits
are code constants (§7), not environment variables. The full name list is in
`CLAUDE.md`.

## 16. Cloud AI (Anthropic) — opt-in, never live-tested here

Default state: **OFF**. `GET /v1/ai/status` → `configured:false`, and every
`POST /v1/ai/*` answers `503 AI_NOT_CONFIGURED` (after `400
AI_CONSENT_REQUIRED` when the body lacks `useCloudAi:true`). To enable:

```bat
rem in the window that will run ColleX-Baslat.cmd / serve.mjs — never in .env
set ANTHROPIC_API_KEY=...
set COLLEX_AI_MODEL=claude-sonnet-5      rem optional; claude-opus-5 for higher quality/cost
```

Then `serve.mjs` prints `ai : açık (<model>)`. Consent is **per request**
(`useCloudAi:true` in JSON, `'true'` in multipart); there is no remembered
consent. What leaves the machine per endpoint, the KVKK note and the error
map are in `docs/implementation/AI.md`. **Nothing has been run against the
live API on this machine** — every behaviour is proven with a fake `fetch`
(65 tests). First live evidence is the manual, paid smoke script:

```bash
node control-plane/scripts/ai-live-smoke.mjs --dry-run   # plan only, no network (verified exit 0; key printed as [gizli])
node control-plane/scripts/ai-live-smoke.mjs             # 3 PAID calls on SENTETİK text; record the result in AI.md §7
```

## 17. Deadline rules (`/v1/deadlines`) — 16 verified, 25 still `dogrulanmadi`

`GET /v1/deadlines/rules` lists **41** source-cited rules (STATUS S10; four
are note-only with `computable:false`). W14 B-11 changed three things.

**(a) Two rules were WRONG and are fixed.** `iik-icra-mahkemesi-istinaf` said
"10 gün, tefhimden" — 7499 s.K. removed "tefhim veya" from İİK m.363/1 and
changed "on gündür" to "iki haftadır" (footnote 135), so the rule is now
**2 hafta / tebliğden** with a `transition` block recording
`effectiveFrom: 2024-06-01`. `hmk-islah` said "davanın her aşamasında sadece
bir kez"; HMK m.176/2 says **"Aynı davada, taraflar ancak bir kez ıslah
yoluna başvurabilir"** — a materially different rule, and the text is now
verbatim.

**(b) 16 rules are `dogrulandi`.** The build session for W14 DID have network
through the `yargi-mevzuat` MCP tools, and 38 article texts were pulled from
mevzuat.gov.tr on 02.09.2026. A rule may flip only **with the article text in
hand**, and `tests/deadlines/rules.test.ts` now REJECTS a sourceless
`dogrulandi`: the source must name the article (`m.NNN`), the access date
(GG.AA.YYYY) and mevzuat.gov.tr, and may not contain "bilgisine dayanır" or
"çekilmedi".

**(c) 25 rules are still `dogrulanmadi`**, and each carries a
`nasilDogrulanir` sentence saying which article to open and what to compare.
The remaining list (`W14-L-LEGAL` §8.1): HMK m.127/136/345/347/366/96, CMK
m.273/291/173, İYUK m.7/16/45/46/8/61/20A, İİK m.16/67/68, 6216 m.47, 6502
m.70, 4857 m.20, 6183 m.58, 7036 m.3.

To verify one, read the article in force, set `period` in
`control-plane/src/deadlines/rules.ts` if it differs, and flip `verified` to
`{ status: 'dogrulandi', date, source: <the article text you read, with the
access date and mevzuat.gov.tr> }`. `tests/deadlines/calc.test.ts` holds the
expected dates and must move with the rule.

**Additive fields you will see.** `adliTatileTabi` is three-valued
(`true | false | "belirsiz"`); **seven** rules are `"belirsiz"`, meaning the
adli-tatil treatment is disputed. The computation then does NOT apply the
HMK m.104 extension — it returns the **short and safe** date — and the
interface is required to show both. `adliTatilApplies` (the boolean the
calculation reads) stays and is `false` for those seven.

Every computation still carries the verbatim `DEADLINE_DISCLAIMER`, which
W14 rewrote to name the product rather than "uygulama" (in legal Turkish
"uygulama" means settled case law, so the old sentence read as "settled case
law is not responsible"):

> Süre hesabı bilgi amaçlıdır; tebliğ usulü, adli tatil ve özel süreler avukatça kontrol edilmelidir — kaçırılan süreden ColleX sorumlu değildir.

It is verbatim in every `/v1/deadlines/compute` response, on every card, in
every export **and in every `.ics` VEVENT's `DESCRIPTION`** (W14 B-17). A
quick mechanism check:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/deadlines/compute -H 'content-type: application/json' \
  -d '{"ruleId":"hmk-istinaf","startDate":"2026-07-15"}'
# dueDate 2026-09-07 (07.09.2026 Pazartesi), adliTatil.applied=true, dueDateWithoutExtension 2026-07-29, verified.status=dogrulanmadi
```

### 17.1 "Tebligattan süreye" — `POST /v1/deadlines/from-notice`

The UETS-integration chain competitors sell, done locally and without
credentials: the lawyer gives ColleX the served document and gets the
deadline PROPOSAL, with every fact quoted from the document.

- **Input** (zod-strict, `fieldIssues`): exactly one of `fileId` (an upload,
  read through the same files store as `/v1/files`; a malformed id is 404
  before the store) or `text` (pasted, at most
  `MAX_NOTICE_TEXT_CODE_POINTS` = 400 000 code points; the app's 1 MiB JSON
  limit applies first). Optional choices: `candidateId` (pick among the
  reading's `dateCandidates`) **or** `tebligDate` (typed, `YYYY-MM-DD`) —
  never both — and `ruleId` (a computable rule).
- **Reader** (`src/deadlines/serviceNotice.ts`, producer version
  `NOTICE_READER_VERSION = "tebligat-okuyucu-v1"`): deterministic, rule-based,
  no model. Offsets are code points over the NFC text; for an upload the
  chunks are placed at their own offsets and gaps are filled with line breaks
  (`text.gapCodePoints`). A scanned tebligat reaches it only as text that
  `intake/ocr.py` produced (fail-closed); an upload with no text is
  `422 NOTICE_TEXT_EMPTY`.
- **Dates**: a physical tebliğ date (`FIZIKI_TEBLIG`, from a "Tebliğ
  Tarihi:" field or a mazbata's "… tarihinde … imzasına tebliğ edildi"
  sentence), or an e-tebligat ulaşma date (`ETEBLIGAT_ULASMA`) to which the
  7201 s.K. m.7/a fifth-day rule is applied — **five calendar days, never
  rolled over a weekend or holiday** (rolling would move the start later,
  the unsafe direction; a warning says so, and the rule itself is marked
  `basisStatus: "dogrulanmadi"` because its article text was not compared in
  ColleX). A printed deemed date that agrees with ulaşma + 5 merges into the
  same candidate; one that disagrees is a second candidate and the answer is
  `SECIM_GEREKLI` — nothing is computed until the lawyer chooses. No readable
  date is `OKUNAMADI`: ColleX never guesses one. Every other date is listed in
  `ignoredDates` with its reason (karar / yazım / dava tarihi, kesinleşme
  şerhi, okunma / gönderim tarihi, a court decision's künye date, a tebliğ
  NARRATED inside the served document, …).
- **Rules**: from what was served (the receipt's "Evrak Türü" field first,
  else the document's own heading) and the court class (gerekçeli karar of a
  hukuk ilk derece → `hmk-istinaf`, BAM hukuk → `hmk-temyiz`, ceza →
  `cmk-istinaf`, icra hukuk → `iik-icra-mahkemesi-istinaf`, idare/vergi →
  `iyuk-istinaf`; dava dilekçesi → `hmk-cevap` / `iyuk-cevap`; ödeme emri
  Örnek 7 / 10 / 13 / 6183 → `iik-odeme-emri-itiraz` / `iik-kambiyo-itiraz` /
  `iik-kira-odeme-emri-itiraz` / `amme-odeme-emri-dava`, an unreadable form
  offers both itiraz rules; bilirkişi raporu → `hmk-bilirkisi-rapor-itiraz`;
  …). `NOTICE_RULE_IDS` is validated against `DEADLINE_RULES` at module load.
  Each computation is `computeDeadline` verbatim — adli tatil, holidays,
  `adliTatileTabi`, `verified` and `DEADLINE_DISCLAIMER` exactly as
  `/v1/deadlines/compute` returns them.
- **Nothing is written.** Each computed proposal carries `matterItem`, a
  ready item for `POST /v1/matters/{id}/items:batch`; the batch route's
  (kind, dueDate, title) duplicate key turns a second confirm into a
  `DUPLICATE` skip, and the filed deadline flows into the matter calendar and
  its `.ics` like any other.

```bash
curl -s -X POST http://127.0.0.1:8787/v1/deadlines/from-notice -H 'content-type: application/json' \
  -d '{"text":"ELEKTRONİK TEBLİGAT\nGönderici Birim: İstanbul 12. Asliye Hukuk Mahkemesi\nEvrak Türü: Gerekçeli Karar\nMuhataba Ulaştırıldığı Tarih: 27.10.2026"}'
# dateStatus OKUNDU, dateCandidates[0] ETEBLIGAT_ULASMA 2026-10-27 -> tebligDate 2026-11-01,
# proposals[0].ruleId hmk-istinaf, computation.dueDate 2026-11-16, matterItem ready (not filed)
```

Console: "Süre hesapla" → "Tebligattan süre çıkar" (select an upload, upload a
new one, or paste the text; quotes, proposal, disclaimer, "Onayla ve dosyaya
ekle"). Tests: `control-plane/tests/deadlines/serviceNotice.test.ts`,
`noticeRoutes.test.ts` (samples in `noticeSamples.ts`).

## 14. Moving to a real Postgres / Supabase target

Step-by-step: `docs/implementation/SUPABASE-SETUP.md`. Summary of what changes:

1. Apply the migration chain **from zero**, in filename order, including
   `080000` and `090000` — those two run there and **only** there — and
   `20260902120000_matters_persistence.sql` (the matter workspace). Decide
   once whether that database is tracked by the Supabase CLI's history or by
   this repo's ledger (`ingestion/migrations.py`, ADR-020) — not both. If
   the ledger is chosen on a database loaded by hand, its bootstrap records
   exactly the files whose `-- [LEDGER SENTINEL] <kind>:<name>` probe
   resolves there (`regclass` / `regprocedure` / `extension` /
   `column:<schema.table>.<col>` / `trigger:<schema.table>.<name>`; a bare
   name is a regclass) and applies the rest, in one transaction for the
   ledger table plus the bootstrap rows.
2. Re-run the equivalent of `scripts/db_local_check.py`'s invariants against
   that target, then `scripts/run_evals.py` pointed at it.
3. Only then are hybrid retrieval, the `hybrid_search_public_1024` RRF
   function and any embedding-profile decision measurable. Until then ADR-004
   keeps the production embedding profile undecided.
4. Nothing in this repo's tooling may call a Supabase MCP tool to do it.
